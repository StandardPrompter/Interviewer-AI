"use client";

import { useState, useRef, useEffect } from 'react';
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
    Eye,
    EyeOff,
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
    const [showTranscript, setShowTranscript] = useState(true);

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
    const [timeLeft, setTimeLeft] = useState(20 * 60); // 20 minutes in seconds

    const pcRef = useRef<RTCPeerConnection | null>(null);
    const dcRef = useRef<RTCDataChannel | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Proctoring State
    // Initial stage is calibration because preparation is handled in /preparation
    const [stage, setStage] = useState<'calibration' | 'interview' | 'terminated'>('calibration');
    const [gazeViolations, setGazeViolations] = useState(0);

    const handleGazeViolation = () => {
        if (stage !== 'interview') return;

        const newCount = gazeViolations + 1;
        setGazeViolations(newCount);
        console.warn(`Gaze violation detected! Count: ${newCount}`);

        if (newCount > 5) {
            handleMalpracticeTermination();
        }
    };

    const handleMalpracticeTermination = async () => {
        setStage('terminated');
        setAiStatus('speaking'); // Or 'silent'

        // Stop all sessions immediately
        if (pcRef.current) pcRef.current.close();
        if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
        if (dcRef.current) dcRef.current.close();
        setIsConnected(false);
        setIsMicActive(false);

        // Optional: Save a "terminated" record to server if needed
    };

    const startInterview = () => {
        // Only start if we are in interview stage (after calibration)
        if (stage !== 'interview') return;
        if (!dcRef.current || dcRef.current.readyState !== 'open') return;
        if (hasStarted) return;

        const initialMessage = `Hello! I'm ready to begin the interview. Please introduce yourself and start with the first question.`;

        // Add initial message to transcript
        setTranscriptMessages(prev => [...prev, {
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
        dcRef.current.send(JSON.stringify(event));
        dcRef.current.send(JSON.stringify({
            type: "response.create"
        }));
        setHasStarted(true);
        setAiStatus('speaking');
    };

    const togglePause = () => {
        setIsPaused(!isPaused);
        if (streamRef.current) {
            streamRef.current.getAudioTracks().forEach(track => track.enabled = isPaused);
        }
    };

    const restartInterview = async () => {
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
        setStage('calibration'); // Go back to calibration, not prep
        setGazeViolations(0);
        currentAssistantMessageRef.current = null;
        setCurrentAssistantMessage(null);
        setAiStatus('listening');

        // Re-initialize connection
        await initRealtime();
    };

    const stopSession = async () => {
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
        } catch (error: any) {
            console.error("Error in completion process:", error);
            setIsSavingTranscript(false);
            // Redirect to results page even if there was an error
            router.push('/results');
        }
    };

    const initRealtime = async () => {
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
            audioRef.current = audioEl;

            pc.ontrack = (e) => {
                if (audioEl) audioEl.srcObject = e.streams[0];
            };

            const ms = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });
            streamRef.current = ms;

            const audioTrack = ms.getAudioTracks()[0];
            if (audioTrack) {
                setIsMicActive(true);
                pc.addTrack(audioTrack, ms);
            }

            const dc = pc.createDataChannel("oai-events");
            dcRef.current = dc;

            dc.addEventListener("message", async (e) => {
                const event = JSON.parse(e.data);
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
                        setCurrentAssistantMessage(prev => prev ? {
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
                        console.log('✓ Assistant response saved (from deltas):', finalContent.substring(0, 100) + '...');
                    }
                    // Fallback: try to extract from response.output if deltas didn't work
                    else if (event.response?.output) {
                        const assistantContent = event.response.output
                            .filter((o: any) => o.type === 'text')
                            .map((o: any) => o.text || o.value)
                            .join('');

                        if (assistantContent && assistantContent.trim()) {
                            setTranscriptMessages(prev => [...prev, {
                                id: uuidv4(),
                                role: 'assistant',
                                content: assistantContent.trim(),
                                timestamp: new Date().toISOString()
                            }]);
                            console.log('✓ Assistant response saved (from output):', assistantContent.substring(0, 100) + '...');
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

        } catch (err: any) {
            setIsConnecting(false);
            console.error('Connection error:', err);
        }
    };

    useEffect(() => {
        if (sessionId && !isLoadingSession) initRealtime();
        return () => {
            if (pcRef.current) pcRef.current.close();
            if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
        };
    }, [sessionId, isLoadingSession]);

    useEffect(() => {
        if (isConnected && !hasStarted && stage === 'interview') {
            const timer = setTimeout(() => startInterview(), 1500);
            return () => clearTimeout(timer);
        }
    }, [isConnected, hasStarted, stage]);

    // Timer Logic
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isConnected && !isPaused && timeLeft > 0) {
            interval = setInterval(() => {
                setTimeLeft((prev) => {
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
    }, [isConnected, isPaused, timeLeft]);

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
                        <svg className="w-full h-full" viewBox="0 0 100 100">
                            <circle className="text-slate-700 stroke-current" strokeWidth="6" cx="50" cy="50" r="40" fill="transparent" />
                            <circle
                                className="text-blue-500 stroke-current transition-all duration-500 ease-out animate-spin"
                                strokeWidth="6"
                                strokeLinecap="round"
                                cx="50"
                                cy="50"
                                r="40"
                                fill="transparent"
                                strokeDasharray="251.2"
                                strokeDashoffset="125.6"
                                transform="rotate(-90 50 50)"
                            />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Activity className="w-8 h-8 text-blue-400 animate-pulse" />
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h1 className="text-2xl font-bold text-slate-100 mb-2">Processing Interview</h1>
                        <p className="text-slate-400">Saving transcript and generating your summary...</p>
                        <p className="text-sm text-slate-500 font-medium">Please wait, redirecting to results...</p>
                        <div className="pt-4">
                            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                                <span>This may take a few moments</span>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col">
            {/* Gaze Tracker (Active during Calibration + Interview) */}
            {(stage === 'calibration' || stage === 'interview') && !isLoadingSession && (
                <GazeTracker
                    isActive={stage === 'interview'}
                    onCalibrationComplete={() => {
                        setStage('interview');
                    }}
                    onGazeViolation={handleGazeViolation}
                />
            )}
            {/* Top Navigation */}
            <nav className="h-16 bg-slate-800/90 backdrop-blur-md border-b border-slate-700/50 sticky top-0 z-50 flex items-center justify-between px-8">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <Activity className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-bold text-lg tracking-tight text-slate-100">InterviewPractice <span className="text-slate-400 font-medium">AI</span></span>
                </div>

                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                        <div className="text-right">
                            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider leading-none mb-1">Status</p>
                            <p className={`text-xs font-bold ${isConnected ? 'text-emerald-500' : 'text-slate-400'}`}>
                                {isConnected ? 'CONNECTED' : 'CONNECTING...'}
                            </p>
                        </div>
                        <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
                    </div>
                    {/* Timer Display */}
                    <div className="bg-slate-800 rounded-xl px-4 py-2 border border-slate-700/50 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-400" />
                        <span className={`text-sm font-mono font-bold ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-slate-100'}`}>
                            {formatTime(timeLeft)}
                        </span>
                    </div>

                    {/* Transcript Toggle */}
                    <button
                        onClick={() => setShowTranscript(!showTranscript)}
                        className={`p-2 rounded-xl border border-slate-700/50 transition-all ${showTranscript ? 'bg-blue-600/20 text-blue-400 border-blue-500/30 ring-1 ring-blue-500/20' : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                            }`}
                        title={showTranscript ? "Hide Transcript" : "Show Transcript"}
                    >
                        {showTranscript ? <MessageSquare className="w-5 h-5" /> : <MessageSquareOff className="w-5 h-5" />}
                    </button>
                </div>
            </nav>

            {/* Main Content - Centered Conversation View */}
            <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-4xl mx-auto w-full">
                {/* Connection Status Indicator */}
                <div className="mb-8 flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-2xl border border-slate-700/50">
                    <span className={`w-2 h-2 rounded-full transition-all duration-300 ${aiStatus === 'speaking' ? 'bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.8)]' : aiStatus === 'thinking' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                    <span className="text-sm font-medium text-slate-300 uppercase tracking-wide">
                        {aiStatus === 'speaking' ? 'AI Speaking' : aiStatus === 'thinking' ? 'AI Thinking' : 'Listening'}
                    </span>
                </div>

                {/* Conversation Area */}
                <div className="flex-1 w-full flex flex-col items-center justify-center space-y-8 mb-8">
                    {/* AI Avatar */}
                    <div className="relative group">
                        {/* Animated Glow Effect */}
                        <div className={`absolute -inset-1 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-full blur transition-all duration-500 opacity-20 group-hover:opacity-40 pointer-events-none ${aiStatus === 'speaking' ? 'animate-pulse opacity-60' : ''}`} />

                        <div className={`absolute -inset-4 bg-blue-500/10 rounded-full blur-2xl transition-all duration-300 ${aiStatus === 'speaking' ? 'opacity-100 scale-110' : 'opacity-0 scale-90'}`} />

                        <div className={`w-48 h-48 rounded-full border-4 border-slate-700 shadow-2xl overflow-hidden relative transition-all duration-300 transform ${aiStatus === 'speaking' ? 'scale-105 ring-4 ring-blue-500/30 border-blue-500/50' : 'scale-100'}`}>
                            <img
                                src="/images/avatar.png"
                                alt="AI Interviewer"
                                className="w-full h-full object-cover"
                            />
                            {isPaused && (
                                <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center">
                                    <Pause className="w-12 h-12 text-white fill-current" />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Transcript Display */}
                    {showTranscript && (
                        <div className="w-full max-w-2xl bg-slate-800/50 rounded-2xl border border-slate-700/50 p-6 max-h-64 overflow-y-auto space-y-3">
                            {transcriptMessages.length === 0 && !currentAssistantMessage ? (
                                <div className="text-center text-slate-400 py-8">
                                    <p className="text-sm">Interview transcript will appear here...</p>
                                    <p className="text-xs mt-2 opacity-60">Start speaking to begin</p>
                                </div>
                            ) : (
                                <>
                                    {transcriptMessages.slice(-5).map((msg, idx) => (
                                        <div key={msg.id || idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[80%] rounded-xl px-4 py-2 ${msg.role === 'user'
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-slate-700 text-slate-100'
                                                }`}>
                                                <p className="text-sm">{msg.content}</p>
                                                <p className="text-xs opacity-60 mt-1">
                                                    {new Date(msg.timestamp).toLocaleTimeString()}
                                                </p>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Show current assistant message being typed in real-time */}
                                    {currentAssistantMessage && currentAssistantMessage.content && (
                                        <div className="flex justify-start">
                                            <div className="max-w-[80%] rounded-xl px-4 py-2 bg-slate-700 text-slate-100 border-2 border-blue-500/30 animate-pulse">
                                                <p className="text-sm">{currentAssistantMessage.content}</p>
                                                <p className="text-xs opacity-60 mt-1 flex items-center gap-1">
                                                    <span className="w-2 h-2 bg-blue-400 rounded-full animate-ping"></span>
                                                    AI is speaking...
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Show transcription errors if any */}
                            {transcriptionErrors.length > 0 && (
                                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                                    <p className="text-red-400 text-xs font-medium">Transcription Issues:</p>
                                    {transcriptionErrors.slice(-3).map((error, idx) => (
                                        <p key={idx} className="text-red-300 text-xs mt-1">{error}</p>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Control Buttons */}
                <div className="w-full max-w-2xl flex items-center justify-center gap-4">
                    <button
                        onClick={restartInterview}
                        className="flex-1 bg-slate-700 hover:bg-slate-600 text-white h-14 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.98] border border-slate-600"
                    >
                        <RotateCcw className="w-5 h-5" />
                        Restart
                    </button>
                    <button
                        onClick={togglePause}
                        className={`flex-1 h-14 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.98] ${isPaused
                            ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                    >
                        {isPaused ? <Play className="w-5 h-5 fill-current" /> : <Pause className="w-5 h-5 fill-current" />}
                        {isPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                        onClick={stopSession}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white h-14 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
                    >
                        <LogOut className="w-5 h-5" />
                        End Interview
                    </button>
                </div>

                {/* Mic Status Indicator */}
                <div className="mt-6 flex items-center gap-2 text-sm text-slate-400">
                    {isMicActive ? (
                        <>
                            <Mic className="w-4 h-4 text-emerald-500" />
                            <span>Microphone Active</span>
                        </>
                    ) : (
                        <>
                            <MicOff className="w-4 h-4 text-slate-500" />
                            <span>Microphone Muted</span>
                        </>
                    )}
                </div>
            </div>

            {/* Hidden Audio Element */}
            <audio ref={audioRef} autoPlay />
        </main>
    );
}
