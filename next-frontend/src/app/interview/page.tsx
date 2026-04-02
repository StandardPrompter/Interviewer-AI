"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import {
    Mic,
    MicOff,
    Play,
    Activity,
    LogOut,
    RotateCcw,
    Pause,
    AlertTriangle,
    MessageSquare,
    MessageSquareOff
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import GazeTracker from '@/components/GazeTracker';

export default function InterviewPage() {
    const router = useRouter();
    const [sessionId, setSessionId] = useState('');
    const [transcriptMessages, setTranscriptMessages] = useState<Array<{ role: string, content: string, timestamp: string, id?: string }>>([]);
    const [transcriptionErrors, setTranscriptionErrors] = useState<string[]>([]);
    const currentAssistantMessageRef = useRef<{ content: string, timestamp: string } | null>(null);
    const [currentAssistantMessage, setCurrentAssistantMessage] = useState<{ content: string, timestamp: string } | null>(null);
    const [isLoadingSession, setIsLoadingSession] = useState(true);
    const [showTranscript, setShowTranscript] = useState(false); // Default to false as requested (optional)

    useEffect(() => {
        // Get session_id from localStorage or generate new one
        const storedSessionId = localStorage.getItem('session_id');
        if (storedSessionId) {
            setSessionId(storedSessionId);
            setIsLoadingSession(false);
        } else {
            // Generate new session ID if not found
            const newSessionId = crypto.randomUUID();
            setSessionId(newSessionId);
            localStorage.setItem('session_id', newSessionId);
            setIsLoadingSession(false);
        }
    }, []);

    // Session State
    const [isConnected, setIsConnected] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [isMicActive, setIsMicActive] = useState(true);
    const [isPaused, setIsPaused] = useState(false);
    const [isSavingTranscript, setIsSavingTranscript] = useState(false);
    const [aiStatus, setAiStatus] = useState<'listening' | 'thinking' | 'speaking'>('listening');
    const TOTAL_TIME = 20 * 60; // 20 minutes
    const [timeLeft, setTimeLeft] = useState(TOTAL_TIME);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const userVideoRef = useRef<HTMLVideoElement | null>(null);
    const isProcessingRef = useRef(false);
    const audioChunksRef = useRef<Blob[]>([]);

    // Proctoring State
    // Initial stage is interview because calibration is handled in /preparation
    const [stage, setStage] = useState<'interview' | 'terminated'>('interview');
    const [gazeViolations, setGazeViolations] = useState(0);
    const [showGazeWarning, setShowGazeWarning] = useState(false);

    // Interview stage tracking for dynamic prompt switching
    const [currentInterviewStageName, setCurrentInterviewStageName] = useState<string>('introduction');
    const [interviewDecision, setInterviewDecision] = useState<{
        decision: string;
        confidence: number;
        reasoning: string;
    } | null>(null);

    // Agenda Stages logic
    const interviewStages = [
        { name: 'Introduction', start: 0, end: 0.15 }, // 0-15%
        { name: 'Technical', start: 0.15, end: 0.70 }, // 15-70%
        { name: 'Behavioral', start: 0.70, end: 0.90 }, // 70-90%
        { name: 'Conclusion', start: 0.90, end: 1.0 }, // 90-100%
    ];

    const getCurrentInterviewStage = () => {
        const progress = (TOTAL_TIME - timeLeft) / TOTAL_TIME;
        return interviewStages.find(s => progress >= s.start && progress < s.end) || interviewStages[interviewStages.length - 1];
    };

    const handleMalpracticeTermination = useCallback(async () => {
        setStage('terminated');
        setAiStatus('speaking'); // Or 'silent'

        // Stop all sessions immediately
        if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
        if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
        setIsConnected(false);
        setIsMicActive(false);

        // Optional: Save a "terminated" record to server if needed
    }, []);

    const handleGazeViolation = useCallback(() => {
        if (stage !== 'interview') return;

        setGazeViolations((prev: number) => {
            const newCount = prev + 1;
            console.warn(`Gaze violation detected! Count: ${newCount}`);

            // Show warning UI
            setShowGazeWarning(true);
            setTimeout(() => setShowGazeWarning(false), 3000);

            if (newCount > 5) {
                handleMalpracticeTermination();
            }
            return newCount;
        });
    }, [stage, handleMalpracticeTermination]);

    const sendAudioToSonic = useCallback(async (audioBlob: Blob) => {
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;
        setAiStatus('thinking');

        try {
            const formData = new FormData();
            formData.append('audio', audioBlob);
            formData.append('session_id', sessionId);
            formData.append('instructions', "You are a professional technical interviewer. Conduct a natural, conversational interview.");

            const response = await fetch('/api/sonic', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) throw new Error('Failed to send audio to Sonic');
            if (!response.body) throw new Error('No response body from Sonic');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = '';

            const playAudioFromBase64 = async (base64: string) => {
                const binaryString = window.atob(base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                
                if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
                const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
                const source = audioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContextRef.current.destination);
                source.start();
                setAiStatus('speaking');
                
                return new Promise((resolve) => {
                    source.onended = resolve;
                });
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(l => l.trim());

                for (const line of lines) {
                    try {
                        const event = JSON.parse(line);
                        if (event.type === 'text') {
                            accumulatedText += event.data;
                            setCurrentAssistantMessage({
                                content: accumulatedText,
                                timestamp: new Date().toISOString()
                            });
                        } else if (event.type === 'audio') {
                            await playAudioFromBase64(event.data);
                        } else if (event.type === 'message_stop') {
                            setTranscriptMessages(prev => [...prev, {
                                id: crypto.randomUUID(),
                                role: 'assistant',
                                content: accumulatedText,
                                timestamp: new Date().toISOString()
                            }]);
                            setCurrentAssistantMessage(null);
                            setAiStatus('listening');
                        }
                    } catch (e) {
                        console.error('Error parsing sonic event:', e, line);
                    }
                }
            }
        } catch (error) {
            console.error('Error in Sonic interaction:', error);
        } finally {
            isProcessingRef.current = false;
        }
    }, [sessionId]);

    const startInterview = useCallback(() => {
        console.log('🎯 startInterview called. stage:', stage);
        if (stage !== 'interview') return;
        
        setIsConnected(true);
        setHasStarted(true);
        setAiStatus('listening');

        // Initial greeting handled by first user interaction or automatic
    }, [stage]);

    const togglePause = useCallback(() => {
        setIsPaused((prev: boolean) => {
            const newState = !prev;
            if (streamRef.current) {
                streamRef.current.getAudioTracks().forEach(track => track.enabled = newState);
            }
            return newState;
        });
    }, []);

    const initRealtime = useCallback(async () => {
        if (isConnected) return;

        try {
            const ms = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true
            });
            streamRef.current = ms;

            if (userVideoRef.current) {
                userVideoRef.current.srcObject = ms;
            }

            // Setup MediaRecorder for VAD
            const mediaRecorder = new MediaRecorder(ms, { mimeType: 'audio/webm' });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
                audioChunksRef.current = [];
                await sendAudioToSonic(audioBlob);
                // Restart recording if session still active
                if (isConnected && !isPaused) {
                    setTimeout(() => mediaRecorder.start(), 500);
                }
            };

            // Simple VAD logic using Web Audio API
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(ms);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            let silenceStart = Date.now();
            let isSpeaking = false;

            const checkVAD = () => {
                if (!isConnected || isPaused) return;
                analyser.getByteFrequencyData(dataArray);
                const volume = dataArray.reduce((a, b) => a + b) / dataArray.length;

                if (volume > 20) { // Threshold for speaking
                    if (!isSpeaking) {
                        console.log('🎤 Speech started');
                        isSpeaking = true;
                        if (mediaRecorder.state === 'inactive') mediaRecorder.start();
                    }
                    silenceStart = Date.now();
                } else {
                    if (isSpeaking && Date.now() - silenceStart > 1500) { // 1.5s silence
                        console.log('🔇 Speech stopped');
                        isSpeaking = false;
                        if (mediaRecorder.state === 'recording') mediaRecorder.stop();
                    }
                }
                requestAnimationFrame(checkVAD);
            };
            checkVAD();

            setIsConnected(true);
            setHasStarted(true);

        } catch (err: unknown) {
            console.error('Connection error:', err);
        }
    }, [isConnected, isPaused, sendAudioToSonic]);

    const stopSession = useCallback(async () => {
        // Close media streams first
        if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
        if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
        setIsConnected(false);

        // Save transcript and generate insights
        setIsSavingTranscript(true);

        try {
            if (transcriptMessages.length > 0 && sessionId) {
                // Format transcript with metadata for better analysis
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
                        duration_from_start: new Date(msg.timestamp).getTime() - new Date(transcriptMessages[0]?.timestamp || msg.timestamp).getTime()
                    })),
                    metadata: {
                        user_messages: transcriptMessages.filter(m => m.role === 'user').length,
                        assistant_messages: transcriptMessages.filter(m => m.role === 'assistant').length,
                        total_duration_ms: new Date().getTime() - new Date(transcriptMessages[0]?.timestamp || new Date().toISOString()).getTime()
                    }
                };

                // Save transcript to S3
                const saveResponse = await fetch('/api/save-transcript', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: sessionId,
                        transcript: formattedTranscript,
                    }),
                });

                if (!saveResponse.ok) {
                    const errorData = await saveResponse.json().catch(() => ({}));
                    throw new Error(errorData.error || 'Failed to save transcript');
                }

                // Poll summary_table for insights (Lambda is triggered by S3 event)
                const maxPollAttempts = 60; // 5 minutes max
                let pollAttempts = 0;
                let insightsGenerated = false;

                while (pollAttempts < maxPollAttempts && !insightsGenerated) {
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

                    try {
                        const insightsResponse = await fetch('/api/get-insights', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ session_id: sessionId }),
                        });

                        if (insightsResponse.ok) {
                            const insightsData = await insightsResponse.json();
                            if (insightsData.insights && insightsData.analysis_status === 'COMPLETED') {
                                insightsGenerated = true;
                                break;
                            }
                        }
                    } catch (pollError) {
                        console.error("Error polling for insights:", pollError);
                    }

                    pollAttempts++;
                }

                setIsSavingTranscript(false);
                // Redirect to results page
                router.push('/results');
            } else {
                setIsSavingTranscript(false);
                // Redirect to results page
                router.push('/results');
            }
        } catch (error: unknown) {
            console.error("Error in completion process:", error);
            setIsSavingTranscript(false);
            // Redirect to results page even if there was an error
            router.push('/results');
        }
    }, [router, sessionId, transcriptMessages]);

    const restartInterview = useCallback(async () => {
        // Close current connection
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        // Reset state
        setIsConnected(false);
        setHasStarted(false);
        setIsPaused(false);
        setTranscriptMessages([]);
        setTranscriptionErrors([]);
        setStage('interview'); // Go back to interview start
        setGazeViolations(0);
        currentAssistantMessageRef.current = null;
        setCurrentAssistantMessage(null);
        setAiStatus('listening');
        setTimeLeft(TOTAL_TIME);

        // Re-initialize connection
        await initRealtime();
    }, [initRealtime, TOTAL_TIME]);

    useEffect(() => {
        if (sessionId && !isLoadingSession) initRealtime();
        return () => {
            if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
            if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, isLoadingSession]);

    useEffect(() => {
        if (isConnected && !hasStarted && stage === 'interview') {
            const timer = setTimeout(() => startInterview(), 1500);
            return () => clearTimeout(timer);
        }
    }, [isConnected, hasStarted, stage, startInterview]);

    // Timer Logic
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isConnected && !isPaused && timeLeft > 0) {
            interval = setInterval(() => {
                setTimeLeft((prev: number) => {
                    if (prev <= 1) {
                        clearInterval(interval);
                        stopSession(); // Auto-end session
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isConnected, isPaused, timeLeft, stopSession]);

    // Stage change detection - fetch new prompt when stage changes
    useEffect(() => {
        if (!isConnected) return;

        const currentStage = getCurrentInterviewStage();
        const stageName = currentStage?.name.toLowerCase() || 'introduction';

        // Only trigger if stage actually changed
        if (stageName === currentInterviewStageName) return;

        console.log(`📊 Stage changed: ${currentInterviewStageName} → ${stageName}`);
        setCurrentInterviewStageName(stageName);

        // Fetch new stage prompt from API
        const fetchStagePrompt = async () => {
            try {
                const response = await fetch('/api/get-stage-prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: sessionId,
                        stage: stageName
                    }),
                });

                if (!response.ok) {
                    console.error('Failed to fetch stage prompt:', await response.text());
                    return;
                }

                const data = await response.json();
                console.log(`✓ Received ${stageName} prompt, updating session...`);

                // Nova Sonic handles prompt updates differently than OpenAI Data channel.
                // We'll just update the instructions which will be used in the next speech turn.
                // You might want to store this in a ref or state.

            } catch (error) {
                console.error('Error fetching stage prompt:', error);
            }
        };

        fetchStagePrompt();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeLeft, isConnected, sessionId]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

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
                                const sessionId = localStorage.getItem('session_id');
                                router.push(`/results/${sessionId}`);
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
                {/* Header Content */}
                <div className="flex-1 flex items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Activity className="w-5 h-5 text-white" />
                        </div>
                        <span className="font-bold text-lg tracking-tight text-slate-100">Interview<span className="text-blue-500">AI</span></span>
                    </div>

                    {/* Timer */}
                    <div className="flex flex-col items-center">
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-1">Time Remaining</span>
                        <span className={`text-2xl font-mono font-bold ${timeLeft < 60 ? 'text-red-500 animate-pulse' : 'text-slate-200'}`}>
                            {formatTime(timeLeft)}
                        </span>
                    </div>

                    {/* Controls */}
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
                    {/* Progress Fill */}
                    <div
                        className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-1000 ease-linear"
                        style={{ width: `${progressPercent}%` }}
                    />

                    {/* Stage Markers */}
                    {interviewStages.map((s, idx) => (
                        <div
                            key={idx}
                            className="absolute top-0 h-full border-l border-slate-900/50 flex flex-col items-start pt-3"
                            style={{ left: `${s.start * 100}%` }}
                        >
                            <span className={`text-[10px] font-bold uppercase tracking-wider pl-1 transform -translate-y-[2px] transition-colors ${currentStage?.name === s.name ? 'text-blue-400' : 'text-slate-600'
                                }`}>
                                {s.name}
                            </span>
                        </div>
                    ))}

                    {/* Current Position Thumb */}
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
                    {/* AI Avatar Focus Area */}
                    <div className="flex-1 flex flex-col items-center justify-center min-h-0 relative">
                        {/* Status Label */}
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

                        {/* AI Avatar with Breathing Border */}
                        <div className="relative">
                            {/* Breathing Effect Ring */}
                            <div className={`absolute -inset-4 rounded-full border-2 border-dashed border-blue-500/30 transition-all duration-1000 ${aiStatus === 'speaking' ? 'animate-spin-slow opacity-100 scale-110' : 'opacity-0 scale-90'
                                }`} />
                            <div className={`absolute -inset-1 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 blur-md transition-all duration-500 ${aiStatus === 'speaking' ? 'opacity-70 scale-105 animate-pulse' : 'opacity-0 scale-100'
                                }`} />

                            <div className={`relative w-56 h-56 rounded-full overflow-hidden border-4 bg-slate-800 shadow-2xl transition-colors duration-300 ${aiStatus === 'speaking' ? 'border-blue-500' : 'border-slate-700'
                                }`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src="/images/avatar.png"
                                    alt="AI"
                                    className="w-full h-full object-cover"
                                />
                                {isPaused && (
                                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                                        <Pause className="w-12 h-12 text-white" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Transcript Overlay / Bottom Section */}
                    <div className={`mt-6 transition-all duration-500 ease-in-out flex flex-col ${showTranscript ? 'h-64' : 'h-12'}`}>
                        <div className="flex items-center justify-between mb-2 shrink-0">
                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Live Transcript</h3>
                            <button
                                onClick={() => setShowTranscript(!showTranscript)}
                                className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                            >
                                {showTranscript ? 'Hide' : 'Show'}
                            </button>
                        </div>

                        {showTranscript && (
                            <div className="flex-1 bg-slate-950/50 rounded-xl border border-slate-800 p-4 overflow-y-auto space-y-3 shadow-inner">
                                {transcriptMessages.length === 0 && !currentAssistantMessage ? (
                                    <p className="text-slate-600 text-sm text-center py-4 italic">Conversation will appear here...</p>
                                ) : (
                                    <>
                                        {transcriptMessages.slice(-5).map((msg, i) => (
                                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed ${msg.role === 'user' ? 'bg-blue-600/20 text-blue-100 border border-blue-500/20' : 'bg-slate-800 text-slate-300 border border-slate-700'
                                                    }`}>
                                                    {msg.content}
                                                </div>
                                            </div>
                                        ))}
                                        {currentAssistantMessage && currentAssistantMessage.content && (
                                            <div className="flex justify-start">
                                                <div className="max-w-[85%] px-3 py-2 rounded-lg text-sm bg-slate-800 text-slate-300 border border-slate-700 animate-pulse">
                                                    {currentAssistantMessage.content}
                                                    <span className="inline-block w-1.5 h-3 ml-1 bg-blue-400 animate-blink aligns-middle" />
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
                    {/* User Video Container */}
                    <div id="user-video-container" className="flex-1 w-full h-full relative overflow-hidden bg-slate-950">
                        <video
                            ref={userVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover transform scale-x-[-1]"
                        />
                        {!streamRef.current && (
                            <div className="absolute inset-0 flex items-center justify-center text-slate-700">
                                <span className="text-sm">Initializing Camera...</span>
                            </div>
                        )}
                    </div>

                    {/* Proctoring Warning Overlay */}
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

                    {/* Controls Overlay on User Side */}
                    <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center px-8 z-20">
                        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700 p-2 rounded-2xl flex gap-2 shadow-2xl">
                            <button
                                onClick={togglePause}
                                className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all ${isPaused ? 'bg-amber-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                    }`}
                                title={isPaused ? "Resume" : "Pause"}
                            >
                                {isPaused ? <Play className="w-5 h-5 fill-current" /> : <Pause className="w-5 h-5" />}
                            </button>
                            <button
                                className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all ${isMicActive ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-red-500/20 text-red-400'
                                    }`}
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
