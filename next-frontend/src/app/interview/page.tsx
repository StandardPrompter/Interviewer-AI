"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
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
            const newSessionId = uuidv4();
            setSessionId(newSessionId);
            localStorage.setItem('session_id', newSessionId);
            setIsLoadingSession(false);
        }
    }, []);

    // Session State
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [isMicActive, setIsMicActive] = useState(true);
    const [isPaused, setIsPaused] = useState(false);
    const [isSavingTranscript, setIsSavingTranscript] = useState(false);
    const [aiStatus, setAiStatus] = useState<'listening' | 'thinking' | 'speaking'>('listening');
    const TOTAL_TIME = 20 * 60; // 20 minutes
    const [timeLeft, setTimeLeft] = useState(TOTAL_TIME);

    const pcRef = useRef<RTCPeerConnection | null>(null);
    const dcRef = useRef<RTCDataChannel | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const userVideoRef = useRef<HTMLVideoElement | null>(null);

    // Proctoring State
    // Initial stage is interview because calibration is handled in /preparation
    const [stage, setStage] = useState<'interview' | 'terminated'>('interview');
    const [gazeViolations, setGazeViolations] = useState(0);
    const [showGazeWarning, setShowGazeWarning] = useState(false);

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
        if (pcRef.current) pcRef.current.close();
        if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
        if (dcRef.current) dcRef.current.close();
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


    const startInterview = useCallback(() => {
        // Only start if we are in interview stage (after calibration)
        if (stage !== 'interview') return;
        if (!dcRef.current || dcRef.current.readyState !== 'open') return;
        setHasStarted((prevHasStarted: boolean) => {
            if (prevHasStarted) return true;

            const initialMessage = `Hello! I'm ready to begin the interview. Please introduce yourself and start with the first question.`;

            // Add initial message to transcript
            setTranscriptMessages((prev) => [...prev, {
                id: uuidv4(),
                role: 'user',
                content: initialMessage,
                timestamp: new Date().toISOString()
            }]);

            const event = {
                type: "conversation.item.create",
                item: {
                    type: "message",
                    role: "user",
                    content: [{
                        type: "input_text",
                        text: initialMessage
                    }],
                },
            };
            dcRef.current?.send(JSON.stringify(event));
            dcRef.current?.send(JSON.stringify({
                type: "response.create"
            }));

            setAiStatus('speaking');
            return true;
        });
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
        if (isConnecting || isConnected) return;

        try {
            setIsConnecting(true);

            const tokenResponse = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId })
            });

            if (!tokenResponse.ok) throw new Error("Failed to get session token");

            const data = await tokenResponse.json();
            const EPHEMERAL_KEY = data.client_secret.value;

            const pc = new RTCPeerConnection();
            pcRef.current = pc;

            const audioEl = document.createElement("audio");
            audioEl.autoplay = true;
            // Append to document to ensure it's not garbage collected and can play
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
            audioRef.current = audioEl;

            pc.ontrack = (e) => {
                if (audioEl) {
                    audioEl.srcObject = e.streams[0];
                    // Explicitly try to play
                    audioEl.play().catch(e => console.error("Auto-play failed:", e));
                }
            };

            const ms = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true
            });
            streamRef.current = ms;

            if (userVideoRef.current) {
                userVideoRef.current.srcObject = ms;
            }

            const audioTrack = ms.getAudioTracks()[0];
            if (audioTrack) {
                setIsMicActive(true);
                pc.addTrack(audioTrack, ms);
            }

            const dc = pc.createDataChannel("oai-events");
            dcRef.current = dc;

            dc.addEventListener("message", async (e) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const event = JSON.parse(e.data) as any;
                console.log('📨 Received event:', event.type, event);

                // Handle assistant response start
                if (event.type === 'response.created') {
                    console.log('🤖 AI response started');
                    const newMessage = {
                        content: '',
                        timestamp: new Date().toISOString()
                    };
                    currentAssistantMessageRef.current = newMessage;
                    setCurrentAssistantMessage(newMessage);
                }

                // Handle assistant audio transcript deltas (real-time transcription of AI speech)
                // Support both old and new event names for compatibility
                if (event.type === 'response.audio_transcript.delta' || event.type === 'response.output_audio_transcript.delta') {
                    const textDelta = event.delta;
                    console.log('📝 AI audio transcript delta:', textDelta);
                    if (textDelta && currentAssistantMessageRef.current) {
                        currentAssistantMessageRef.current.content += textDelta;
                        // Update UI state for real-time display
                        setCurrentAssistantMessage(prev => prev ? {
                            ...prev,
                            content: prev.content + textDelta
                        } : null);
                    }
                }

                // Also support response.text.delta for text-only responses (fallback)
                if (event.type === 'response.text.delta') {
                    const textDelta = event.delta;
                    console.log('📝 AI text delta:', textDelta);
                    if (textDelta && currentAssistantMessageRef.current) {
                        currentAssistantMessageRef.current.content += textDelta;
                        // Update UI state for real-time display
                        setCurrentAssistantMessage((prev: { content: string, timestamp: string } | null) => prev ? {
                            ...prev,
                            content: prev.content + textDelta
                        } : null);
                    }
                }

                // Handle assistant response completion
                if (event.type === 'response.done') {
                    console.log('✅ AI response completed');

                    // First try to use the accumulated text from deltas
                    if (currentAssistantMessageRef.current && currentAssistantMessageRef.current.content.trim()) {
                        const finalContent = currentAssistantMessageRef.current.content.trim();
                        const timestamp = currentAssistantMessageRef.current.timestamp;

                        setTranscriptMessages(prev => [...prev, {
                            id: uuidv4(),
                            role: 'assistant',
                            content: finalContent,
                            timestamp: timestamp
                        }]);
                    }
                    // Fallback: try to extract from response.output if deltas didn't work
                    else if (event.response?.output) {
                        const assistantContent = event.response.output
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            .filter((o: any) => o.type === 'text')
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            .map((o: any) => o.text || o.value)
                            .join('');

                        if (assistantContent && assistantContent.trim()) {
                            setTranscriptMessages(prev => [...prev, {
                                id: uuidv4(),
                                role: 'assistant',
                                content: assistantContent.trim(),
                                timestamp: new Date().toISOString()
                            }]);
                        }
                    }

                    currentAssistantMessageRef.current = null;
                    setCurrentAssistantMessage(null);
                }

                // Handle user input transcriptions
                if (event.type === 'conversation.item.input_audio_transcription.completed') {
                    const transcription = event.transcript;
                    if (transcription && transcription.trim()) {
                        setTranscriptMessages(prev => [...prev, {
                            id: uuidv4(),
                            role: 'user',
                            content: transcription,
                            timestamp: new Date().toISOString()
                        }]);
                        console.log('✓ User transcription:', transcription);
                    }
                }

                // Handle failed transcriptions
                if (event.type === 'conversation.item.input_audio_transcription.failed') {
                    console.warn('⚠ Transcription failed:', event.error);
                    setTranscriptionErrors(prev => [...prev, event.error?.message || 'Unknown transcription error']);
                }

                // Manage AI Status based on events
                if (event.type === 'response.audio.delta') setAiStatus('speaking');
                if (event.type === 'input_audio_buffer.speech_started') setAiStatus('listening');
                if (event.type === 'response.done') setAiStatus('listening');
                if (event.type === 'input_audio_buffer.speech_stopped') setAiStatus('thinking');
                if (event.type === 'response.created') setAiStatus('thinking');
            });

            dc.addEventListener("open", () => {
                setIsConnected(true);
                setIsConnecting(false);

                // Configure session with input audio transcription enabled
                const sessionUpdate = {
                    type: "session.update",
                    session: {
                        input_audio_transcription: {
                            model: "whisper-1"
                        }
                    }
                };
                dc.send(JSON.stringify(sessionUpdate));
            });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`, {
                method: "POST",
                body: offer.sdp,
                headers: {
                    Authorization: `Bearer ${EPHEMERAL_KEY}`,
                    "Content-Type": "application/sdp",
                },
            });

            const answer: RTCSessionDescriptionInit = { type: "answer", sdp: await sdpResponse.text() };
            await pc.setRemoteDescription(answer);

        } catch (err: unknown) {
            setIsConnecting(false);
            console.error('Connection error:', err);
        }
    }, [isConnected, isConnecting, sessionId]);

    const stopSession = useCallback(async () => {
        // Close media streams first
        if (pcRef.current) pcRef.current.close();
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
        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (dcRef.current) {
            dcRef.current.close();
            dcRef.current = null;
        }

        // Reset state
        setIsConnected(false);
        setIsConnecting(false);
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
            if (pcRef.current) pcRef.current.close();
            if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
        };
    }, [sessionId, isLoadingSession, initRealtime]);

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
                    skipCalibration={true}
                    onCalibrationComplete={() => {
                        setStage('interview');
                    }}
                    onGazeViolation={handleGazeViolation}
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

            {/* Hidden Audio Element */}
            <audio ref={audioRef} autoPlay />
        </main>
    );
}
