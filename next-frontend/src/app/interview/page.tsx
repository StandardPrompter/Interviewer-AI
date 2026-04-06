"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import {
    Mic,
    MicOff,
    Play,
    Activity,
    RotateCcw,
    Pause,
    AlertTriangle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import GazeTracker from '@/components/GazeTracker';

// ── Audio constants ──────────────────────────────────────────────────────────

const TARGET_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const PROCESSOR_BUFFER_SIZE = 512;
const SESSION_RENEW_MS = 7 * 60 * 1000; // Renew at 7 min (Nova Sonic max is 8 min)

// ── Helpers ──────────────────────────────────────────────────────────────────

function float32ToInt16(float32: Float32Array): Int16Array {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToInt16Array(base64: string): Int16Array {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
}

function int16ToFloat32(int16: Int16Array): Float32Array {
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 0x8000;
    }
    return float32;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function InterviewPage() {
    const router = useRouter();
    const [sessionId, setSessionId] = useState('');
    const [transcriptMessages, setTranscriptMessages] = useState<Array<{ role: string; content: string; timestamp: string; id?: string }>>([]);
    const currentAssistantMessageRef = useRef<{ content: string; timestamp: string } | null>(null);
    const [currentAssistantMessage, setCurrentAssistantMessage] = useState<{ content: string; timestamp: string } | null>(null);
    const [isLoadingSession, setIsLoadingSession] = useState(true);
    const [showTranscript, setShowTranscript] = useState(false);

    useEffect(() => {
        const storedSessionId = localStorage.getItem('session_id');
        if (storedSessionId) {
            setSessionId(storedSessionId);
        } else {
            const newSessionId = crypto.randomUUID();
            setSessionId(newSessionId);
            localStorage.setItem('session_id', newSessionId);
        }
        setIsLoadingSession(false);
    }, []);

    // Session State
    const [isConnected, setIsConnected] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [isMicActive, setIsMicActive] = useState(true);
    const [isPaused, setIsPaused] = useState(false);
    const [isSavingTranscript, setIsSavingTranscript] = useState(false);
    const [aiStatus, setAiStatus] = useState<'listening' | 'thinking' | 'speaking'>('listening');
    const TOTAL_TIME = 20 * 60;
    const [timeLeft, setTimeLeft] = useState(TOTAL_TIME);

    // Refs for audio pipeline
    const captureContextRef = useRef<AudioContext | null>(null);
    const playbackContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const userVideoRef = useRef<HTMLVideoElement | null>(null);
    const sseAbortRef = useRef<AbortController | null>(null);
    const sessionRenewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sonicSessionIdRef = useRef<string>('');
    const stagePromptRef = useRef<string>('');
    const isStreamingRef = useRef(false);

    // Audio playback queue for smooth sequential playback
    const audioQueueRef = useRef<Float32Array[]>([]);
    const isPlayingRef = useRef(false);

    // Proctoring State
    const [stage, setStage] = useState<'interview' | 'terminated'>('interview');
    const [gazeViolations, setGazeViolations] = useState(0);
    const [showGazeWarning, setShowGazeWarning] = useState(false);

    // Interview stage tracking
    const [currentInterviewStageName, setCurrentInterviewStageName] = useState<string>('introduction');

    const interviewStages = [
        { name: 'Introduction', start: 0, end: 0.15 },
        { name: 'Technical', start: 0.15, end: 0.70 },
        { name: 'Behavioral', start: 0.70, end: 0.90 },
        { name: 'Conclusion', start: 0.90, end: 1.0 },
    ];

    const getCurrentInterviewStage = () => {
        const progress = (TOTAL_TIME - timeLeft) / TOTAL_TIME;
        return interviewStages.find(s => progress >= s.start && progress < s.end) || interviewStages[interviewStages.length - 1];
    };

    // ── Audio playback (raw PCM 24kHz) ───────────────────────────────────────

    const ensurePlaybackContext = useCallback(() => {
        if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
            playbackContextRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
        }
        return playbackContextRef.current;
    }, []);

    const drainAudioQueue = useCallback(() => {
        if (isPlayingRef.current) return;
        const chunk = audioQueueRef.current.shift();
        if (!chunk) return;

        isPlayingRef.current = true;
        const ctx = ensurePlaybackContext();
        const buffer = ctx.createBuffer(1, chunk.length, OUTPUT_SAMPLE_RATE);
        buffer.getChannelData(0).set(chunk);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
            isPlayingRef.current = false;
            drainAudioQueue();
        };
        source.start();
    }, [ensurePlaybackContext]);

    const queueAudioChunk = useCallback((base64: string) => {
        const int16 = base64ToInt16Array(base64);
        const float32 = int16ToFloat32(int16);
        audioQueueRef.current.push(float32);
        setAiStatus('speaking');
        drainAudioQueue();
    }, [drainAudioQueue]);

    const flushAudioQueue = useCallback(() => {
        audioQueueRef.current = [];
        isPlayingRef.current = false;
    }, []);

    // ── SSE reader ───────────────────────────────────────────────────────────

    const startSSEStream = useCallback(async (sid: string, systemPrompt: string) => {
        sseAbortRef.current?.abort();
        const abort = new AbortController();
        sseAbortRef.current = abort;
        // Allow mic chunks to start flowing immediately while the SSE handshake is in progress.
        sonicSessionIdRef.current = sid;
        isStreamingRef.current = true;

        try {
            const response = await fetch('/api/sonic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ systemPrompt, sessionId: sid }),
                signal: abort.signal,
            });

            if (!response.ok) {
                console.error('SSE open failed:', response.status);
                sonicSessionIdRef.current = '';
                isStreamingRef.current = false;
                return;
            }

            // Start session renewal timer
            if (sessionRenewTimerRef.current) clearTimeout(sessionRenewTimerRef.current);
            sessionRenewTimerRef.current = setTimeout(() => {
                renewSession();
            }, SESSION_RENEW_MS);

            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let assistantText = '';
            let userText = '';
            let currentRole = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;

                    try {
                        const event = JSON.parse(trimmed.slice(6));

                        switch (event.type) {
                            case 'contentStart': {
                                currentRole = event.role ?? '';
                                if (currentRole === 'ASSISTANT') {
                                    assistantText = '';
                                } else if (currentRole === 'USER') {
                                    userText = '';
                                }
                                break;
                            }
                            case 'text': {
                                const role = (event.role ?? '').toUpperCase();
                                if (role === 'ASSISTANT') {
                                    assistantText += event.content ?? '';
                                    currentAssistantMessageRef.current = {
                                        content: assistantText,
                                        timestamp: new Date().toISOString(),
                                    };
                                    setCurrentAssistantMessage({ ...currentAssistantMessageRef.current });
                                } else if (role === 'USER') {
                                    userText += event.content ?? '';
                                }
                                break;
                            }
                            case 'audio': {
                                if (event.content) {
                                    queueAudioChunk(event.content);
                                }
                                break;
                            }
                            case 'contentEnd': {
                                if (currentRole === 'ASSISTANT' && assistantText) {
                                    setTranscriptMessages(prev => [...prev, {
                                        id: crypto.randomUUID(),
                                        role: 'assistant',
                                        content: assistantText,
                                        timestamp: new Date().toISOString(),
                                    }]);
                                    currentAssistantMessageRef.current = null;
                                    setCurrentAssistantMessage(null);
                                    assistantText = '';
                                }
                                if (currentRole === 'USER' && userText) {
                                    setTranscriptMessages(prev => [...prev, {
                                        id: crypto.randomUUID(),
                                        role: 'user',
                                        content: userText,
                                        timestamp: new Date().toISOString(),
                                    }]);
                                    userText = '';
                                }
                                // If barge-in, flush playback
                                if (event.stopReason === 'INTERRUPTED') {
                                    flushAudioQueue();
                                }
                                setAiStatus('listening');
                                currentRole = '';
                                break;
                            }
                            case 'done': {
                                // Finalize any remaining text
                                if (assistantText) {
                                    setTranscriptMessages(prev => [...prev, {
                                        id: crypto.randomUUID(),
                                        role: 'assistant',
                                        content: assistantText,
                                        timestamp: new Date().toISOString(),
                                    }]);
                                    currentAssistantMessageRef.current = null;
                                    setCurrentAssistantMessage(null);
                                }
                                setAiStatus('listening');
                                isStreamingRef.current = false;
                                break;
                            }
                            case 'error': {
                                console.error('Sonic SSE error:', event.message);
                                isStreamingRef.current = false;
                                break;
                            }
                        }
                    } catch (parseErr) {
                        // Skip malformed lines
                    }
                }
            }
        } catch (err: unknown) {
            if ((err as Error).name !== 'AbortError') {
                console.error('SSE stream error:', err);
            }
            sonicSessionIdRef.current = '';
            isStreamingRef.current = false;
        } finally {
            isStreamingRef.current = false;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queueAudioChunk, flushAudioQueue]);

    // ── Audio capture (PCM 16kHz) ────────────────────────────────────────────

    const sendAudioChunk = useCallback(async (base64: string) => {
        if (!sonicSessionIdRef.current) return;
        try {
            await fetch('/api/sonic/audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: sonicSessionIdRef.current,
                    audio: base64,
                }),
            });
        } catch {
            // Network errors are transient; audio will be lost but stream continues
        }
    }, []);

    const startAudioCapture = useCallback(async () => {
        const ms = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: { ideal: true },
                noiseSuppression: { ideal: true },
                autoGainControl: { ideal: true },
            },
            video: true,
        });
        streamRef.current = ms;

        if (userVideoRef.current) {
            userVideoRef.current.srcObject = ms;
        }

        const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
        captureContextRef.current = ctx;

        const source = ctx.createMediaStreamSource(ms);
        const processor = ctx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            if (!isStreamingRef.current || isPaused) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const int16 = float32ToInt16(inputData);
            const base64 = arrayBufferToBase64(int16.buffer as ArrayBuffer);
            sendAudioChunk(base64);
        };

        source.connect(processor);
        processor.connect(ctx.destination);
    }, [sendAudioChunk, isPaused]);

    // ── Session lifecycle ────────────────────────────────────────────────────

    const closeSonicSession = useCallback(async () => {
        if (sessionRenewTimerRef.current) {
            clearTimeout(sessionRenewTimerRef.current);
            sessionRenewTimerRef.current = null;
        }

        if (sonicSessionIdRef.current) {
            try {
                await fetch('/api/sonic/audio', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: sonicSessionIdRef.current }),
                });
            } catch {
                // Best effort
            }
        }

        sseAbortRef.current?.abort();
        isStreamingRef.current = false;
        sonicSessionIdRef.current = '';
    }, []);

    const getSystemPrompt = useCallback(() => {
        const stageExtra = stagePromptRef.current ? `\n\nCurrent interview stage instructions:\n${stagePromptRef.current}` : '';
        return `You are a professional technical interviewer conducting a real-time voice interview. Ask one clear question at a time, listen carefully to the candidate's response, and follow up naturally. Keep your responses concise and conversational.${stageExtra}`;
    }, []);

    const renewSession = useCallback(async () => {
        console.log('Renewing Nova Sonic session (approaching 8-min limit)...');
        await closeSonicSession();
        const newSid = crypto.randomUUID();
        await startSSEStream(newSid, getSystemPrompt());
    }, [closeSonicSession, startSSEStream, getSystemPrompt]);

    const initRealtime = useCallback(async () => {
        if (isConnected) return;

        try {
            await startAudioCapture();
            setIsConnected(true);
            setHasStarted(true);
            setAiStatus('listening');

            const sid = crypto.randomUUID();
            await startSSEStream(sid, getSystemPrompt());
        } catch (err: unknown) {
            console.error('Connection error:', err);
        }
    }, [isConnected, startAudioCapture, startSSEStream, getSystemPrompt]);

    // ── Proctoring ───────────────────────────────────────────────────────────

    const handleMalpracticeTermination = useCallback(async () => {
        setStage('terminated');
        setAiStatus('speaking');
        await closeSonicSession();
        if (processorRef.current) processorRef.current.disconnect();
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        setIsConnected(false);
        setIsMicActive(false);
    }, [closeSonicSession]);

    const handleGazeViolation = useCallback(() => {
        if (stage !== 'interview') return;
        setGazeViolations((prev: number) => {
            const newCount = prev + 1;
            setShowGazeWarning(true);
            setTimeout(() => setShowGazeWarning(false), 3000);
            if (newCount > 5) handleMalpracticeTermination();
            return newCount;
        });
    }, [stage, handleMalpracticeTermination]);

    // ── Controls ─────────────────────────────────────────────────────────────

    const togglePause = useCallback(() => {
        setIsPaused((prev: boolean) => {
            const newState = !prev;
            if (streamRef.current) {
                streamRef.current.getAudioTracks().forEach(track => { track.enabled = !newState; });
            }
            return newState;
        });
    }, []);

    const stopSession = useCallback(async () => {
        await closeSonicSession();
        if (processorRef.current) processorRef.current.disconnect();
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (captureContextRef.current) captureContextRef.current.close().catch(() => {});
        if (playbackContextRef.current) playbackContextRef.current.close().catch(() => {});
        setIsConnected(false);

        setIsSavingTranscript(true);
        try {
            if (transcriptMessages.length > 0 && sessionId) {
                const formattedTranscript = {
                    session_id: sessionId,
                    interview_start: transcriptMessages[0]?.timestamp || new Date().toISOString(),
                    interview_end: new Date().toISOString(),
                    total_messages: transcriptMessages.length,
                    messages: transcriptMessages.map((msg, index) => ({
                        id: index + 1,
                        role: msg.role,
                        content: msg.content,
                        timestamp: msg.timestamp,
                        duration_from_start: new Date(msg.timestamp).getTime() - new Date(transcriptMessages[0]?.timestamp || msg.timestamp).getTime(),
                    })),
                    metadata: {
                        user_messages: transcriptMessages.filter(m => m.role === 'user').length,
                        assistant_messages: transcriptMessages.filter(m => m.role === 'assistant').length,
                        total_duration_ms: new Date().getTime() - new Date(transcriptMessages[0]?.timestamp || new Date().toISOString()).getTime(),
                    },
                };

                const saveResponse = await fetch('/api/save-transcript', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: sessionId, transcript: formattedTranscript }),
                });

                if (!saveResponse.ok) {
                    const errorData = await saveResponse.json().catch(() => ({}));
                    throw new Error(errorData.error || 'Failed to save transcript');
                }

                let pollAttempts = 0;
                const maxPollAttempts = 60;
                let insightsGenerated = false;

                while (pollAttempts < maxPollAttempts && !insightsGenerated) {
                    await new Promise(r => setTimeout(r, 5000));
                    try {
                        const insightsResponse = await fetch('/api/get-insights', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ session_id: sessionId }),
                        });
                        if (insightsResponse.ok) {
                            const data = await insightsResponse.json();
                            if (data.insights && data.analysis_status === 'COMPLETED') {
                                insightsGenerated = true;
                                break;
                            }
                        }
                    } catch {
                        // transient
                    }
                    pollAttempts++;
                }

                setIsSavingTranscript(false);
                router.push('/results');
            } else {
                setIsSavingTranscript(false);
                router.push('/results');
            }
        } catch (error: unknown) {
            console.error('Error in completion process:', error);
            setIsSavingTranscript(false);
            router.push('/results');
        }
    }, [closeSonicSession, router, sessionId, transcriptMessages]);

    const restartInterview = useCallback(async () => {
        await closeSonicSession();
        if (processorRef.current) processorRef.current.disconnect();
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (captureContextRef.current) captureContextRef.current.close().catch(() => {});
        flushAudioQueue();

        setIsConnected(false);
        setHasStarted(false);
        setIsPaused(false);
        setTranscriptMessages([]);
        setStage('interview');
        setGazeViolations(0);
        currentAssistantMessageRef.current = null;
        setCurrentAssistantMessage(null);
        setAiStatus('listening');
        setTimeLeft(TOTAL_TIME);
        stagePromptRef.current = '';

        await initRealtime();
    }, [closeSonicSession, flushAudioQueue, initRealtime, TOTAL_TIME]);

    // ── Effects ──────────────────────────────────────────────────────────────

    useEffect(() => {
        if (sessionId && !isLoadingSession) initRealtime();
        return () => {
            closeSonicSession();
            if (processorRef.current) processorRef.current.disconnect();
            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, isLoadingSession]);

    // Timer
    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        if (isConnected && !isPaused && timeLeft > 0) {
            interval = setInterval(() => {
                setTimeLeft((prev: number) => {
                    if (prev <= 1) {
                        clearInterval(interval);
                        stopSession();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isConnected, isPaused, timeLeft, stopSession]);

    // Stage change -> fetch new prompt and store for next session renewal
    useEffect(() => {
        if (!isConnected) return;
        const currentStage = getCurrentInterviewStage();
        const stageName = currentStage?.name.toLowerCase() || 'introduction';
        if (stageName === currentInterviewStageName) return;

        setCurrentInterviewStageName(stageName);

        const fetchStagePrompt = async () => {
            try {
                const response = await fetch('/api/get-stage-prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: sessionId, stage: stageName }),
                });
                if (!response.ok) return;
                const data = await response.json();
                if (data.prompt) {
                    stagePromptRef.current = data.prompt;
                }
            } catch {
                // non-critical
            }
        };

        fetchStagePrompt();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeLeft, isConnected, sessionId]);

    // ── Render helpers ───────────────────────────────────────────────────────

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // ── Terminated view ──────────────────────────────────────────────────────

    if (stage === 'terminated') {
        return (
            <main className="min-h-screen bg-slate-900 flex items-center justify-center p-6 font-sans">
                <div className="max-w-md w-full bg-red-900/20 backdrop-blur-xl rounded-3xl shadow-2xl border border-red-500/50 p-12 text-center space-y-8">
                    <div className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                        <AlertTriangle className="w-12 h-12 text-red-500" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-red-100 mb-4">Interview Terminated</h1>
                        <p className="text-red-200/80 mb-6">
                            Multiple malpractice violations were detected correctly by our AI proctoring system.
                        </p>
                        <div className="p-4 bg-red-950/50 rounded-xl border border-red-500/30 mb-8">
                            <p className="text-sm font-mono text-red-300">Reason: Excessive Gaze Aversion ({gazeViolations} violations)</p>
                        </div>
                        <button
                            onClick={() => {
                                const sid = localStorage.getItem('session_id');
                                router.push(`/results/${sid}`);
                            }}
                            className="w-full py-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors"
                        >
                            View Results
                        </button>
                    </div>
                </div>
            </main>
        );
    }

    // ── Saving view ──────────────────────────────────────────────────────────

    if (isSavingTranscript) {
        return (
            <main className="min-h-screen bg-slate-900 flex items-center justify-center p-6 font-sans">
                <div className="max-w-md w-full bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-black/50 border border-slate-700/50 p-12 text-center space-y-8">
                    <div className="relative w-24 h-24 mx-auto">
                        <div className="w-full h-full border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Activity className="w-8 h-8 text-blue-400 animate-pulse" />
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h1 className="text-2xl font-bold text-slate-100 mb-2">Processing Interview</h1>
                        <p className="text-slate-400">Saving transcript and generating your summary...</p>
                        <p className="text-sm text-slate-500 font-medium">Please wait, redirecting to results...</p>
                    </div>
                </div>
            </main>
        );
    }

    // ── Main interview view ──────────────────────────────────────────────────

    const currentStage = getCurrentInterviewStage();
    const progressPercent = ((TOTAL_TIME - timeLeft) / TOTAL_TIME) * 100;

    return (
        <main className="h-screen bg-slate-950 text-slate-100 font-sans flex flex-col overflow-hidden">
            {/* Gaze Tracker */}
            {stage === 'interview' && !isLoadingSession && (
                <GazeTracker
                    isActive={stage === 'interview'}
                    onGazeViolation={handleGazeViolation}
                    videoRef={userVideoRef}
                />
            )}

            {/* Top Navigation & Agenda Seeker */}
            <nav className="h-24 bg-slate-900 border-b border-slate-800 flex flex-col justify-between shrink-0 z-50">
                <div className="flex-1 flex items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Activity className="w-5 h-5 text-white" />
                        </div>
                        <span className="font-bold text-lg tracking-tight text-slate-100">Interview<span className="text-blue-500">AI</span></span>
                    </div>

                    <div className="flex flex-col items-center">
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-1">Time Remaining</span>
                        <span className={`text-2xl font-mono font-bold ${timeLeft < 60 ? 'text-red-500 animate-pulse' : 'text-slate-200'}`}>
                            {formatTime(timeLeft)}
                        </span>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${isConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
                            <span className="text-xs font-bold uppercase">{isConnected ? 'Online' : 'Offline'}</span>
                        </div>
                        <button
                            onClick={stopSession}
                            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-bold rounded-lg border border-red-500/20 transition-colors"
                        >
                            End Interview
                        </button>
                    </div>
                </div>

                {/* Agenda Seeker Bar */}
                <div className="relative h-2 bg-slate-800 w-full group">
                    <div
                        className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-1000 ease-linear"
                        style={{ width: `${progressPercent}%` }}
                    />
                    {interviewStages.map((s, idx) => (
                        <div
                            key={idx}
                            className="absolute top-0 h-full border-l border-slate-900/50 flex flex-col items-start pt-3"
                            style={{ left: `${s.start * 100}%` }}
                        >
                            <span className={`text-[10px] font-bold uppercase tracking-wider pl-1 transform -translate-y-[2px] transition-colors ${currentStage?.name === s.name ? 'text-blue-400' : 'text-slate-600'}`}>
                                {s.name}
                            </span>
                        </div>
                    ))}
                    <div
                        className="absolute top-1/2 -mt-1.5 w-3 h-3 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)] transform -translate-x-1/2 z-10 transition-all duration-1000 ease-linear"
                        style={{ left: `${progressPercent}%` }}
                    />
                </div>
            </nav>

            {/* Split Screen Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* LEFT PANEL: AI & Transcript */}
                <div className="w-1/2 bg-slate-900 border-r border-slate-800 relative flex flex-col p-6">
                    <div className="flex-1 flex flex-col items-center justify-center min-h-0 relative">
                        <div className="absolute top-0 left-0 px-3 py-1 bg-slate-800 rounded-full border border-slate-700 text-xs font-medium text-slate-400 mb-8 z-10">
                            {aiStatus === 'speaking' ? (
                                <span className="flex items-center gap-2 text-blue-400">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                    </span>
                                    Speaking...
                                </span>
                            ) : aiStatus === 'thinking' ? (
                                <span className="flex items-center gap-2 text-amber-400">
                                    <span className="animate-pulse w-2 h-2 bg-amber-400 rounded-full" />
                                    Thinking...
                                </span>
                            ) : (
                                <span className="flex items-center gap-2 text-emerald-400">
                                    <Mic className="w-3 h-3" />
                                    Listening...
                                </span>
                            )}
                        </div>

                        {/* AI Avatar */}
                        <div className="relative">
                            <div className={`absolute -inset-4 rounded-full border-2 border-dashed border-blue-500/30 transition-all duration-1000 ${aiStatus === 'speaking' ? 'animate-spin-slow opacity-100 scale-110' : 'opacity-0 scale-90'}`} />
                            <div className={`absolute -inset-1 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 blur-md transition-all duration-500 ${aiStatus === 'speaking' ? 'opacity-70 scale-105 animate-pulse' : 'opacity-0 scale-100'}`} />
                            <div className={`relative w-56 h-56 rounded-full overflow-hidden border-4 bg-slate-800 shadow-2xl transition-colors duration-300 ${aiStatus === 'speaking' ? 'border-blue-500' : 'border-slate-700'}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src="/images/avatar.png" alt="AI" className="w-full h-full object-cover" />
                                {isPaused && (
                                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                                        <Pause className="w-12 h-12 text-white" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Transcript */}
                    <div className={`mt-6 transition-all duration-500 ease-in-out flex flex-col ${showTranscript ? 'h-64' : 'h-12'}`}>
                        <div className="flex items-center justify-between mb-2 shrink-0">
                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Live Transcript</h3>
                            <button onClick={() => setShowTranscript(!showTranscript)} className="text-xs text-blue-400 hover:text-blue-300 font-medium">
                                {showTranscript ? 'Hide' : 'Show'}
                            </button>
                        </div>
                        {showTranscript && (
                            <div className="flex-1 bg-slate-950/50 rounded-xl border border-slate-800 p-4 overflow-y-auto space-y-3 shadow-inner">
                                {transcriptMessages.length === 0 && !currentAssistantMessage ? (
                                    <p className="text-slate-600 text-sm text-center py-4 italic">Conversation will appear here...</p>
                                ) : (
                                    <>
                                        {transcriptMessages.slice(-8).map((msg, i) => (
                                            <div key={msg.id ?? i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed ${msg.role === 'user' ? 'bg-blue-600/20 text-blue-100 border border-blue-500/20' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
                                                    {msg.content}
                                                </div>
                                            </div>
                                        ))}
                                        {currentAssistantMessage && currentAssistantMessage.content && (
                                            <div className="flex justify-start">
                                                <div className="max-w-[85%] px-3 py-2 rounded-lg text-sm bg-slate-800 text-slate-300 border border-slate-700 animate-pulse">
                                                    {currentAssistantMessage.content}
                                                    <span className="inline-block w-1.5 h-3 ml-1 bg-blue-400 animate-blink align-middle" />
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT PANEL: User Video & Proctoring */}
                <div className="w-1/2 bg-black relative flex flex-col">
                    <div id="user-video-container" className="flex-1 w-full h-full relative overflow-hidden bg-slate-950">
                        <video ref={userVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                        {!streamRef.current && (
                            <div className="absolute inset-0 flex items-center justify-center text-slate-700">
                                <span className="text-sm">Initializing Camera...</span>
                            </div>
                        )}
                    </div>

                    {showGazeWarning && (
                        <div className="absolute top-6 right-6 z-50 animate-in slide-in-from-right fade-in duration-300">
                            <div className="bg-red-500 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 border border-red-400">
                                <div className="p-2 bg-white/20 rounded-full">
                                    <AlertTriangle className="w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-lg">Warning Detected</h4>
                                    <p className="text-red-100 text-sm">Please keep your focus on the screen.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center px-8 z-20">
                        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700 p-2 rounded-2xl flex gap-2 shadow-2xl">
                            <button
                                onClick={togglePause}
                                className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all ${isPaused ? 'bg-amber-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                                title={isPaused ? "Resume" : "Pause"}
                            >
                                {isPaused ? <Play className="w-5 h-5 fill-current" /> : <Pause className="w-5 h-5" />}
                            </button>
                            <button
                                className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all ${isMicActive ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-red-500/20 text-red-400'}`}
                            >
                                {isMicActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                            </button>
                            <button
                                onClick={restartInterview}
                                className="w-12 h-12 flex items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all"
                                title="Restart"
                            >
                                <RotateCcw className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}
