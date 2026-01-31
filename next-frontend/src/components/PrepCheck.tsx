"use client";

import { useEffect, useState, useRef } from 'react';
import { Camera, Mic, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';

interface PrepCheckProps {
    onComplete: () => void;
    isResearching: boolean;
    researchProgress?: number;
    researchStatus?: string;
}

export default function PrepCheck({ onComplete, isResearching, researchProgress = 0, researchStatus = "Preparing..." }: PrepCheckProps) {
    const [hasCamera, setHasCamera] = useState(false);
    const [hasMic, setHasMic] = useState(false);
    const [micVolume, setMicVolume] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isChecking, setIsChecking] = useState(true);

    // Refs
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    useEffect(() => {
        checkMedia();
        return () => {
            stopMedia();
        };
    }, []);

    const stopMedia = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
    };

    const checkMedia = async () => {
        try {
            setIsChecking(true);
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            streamRef.current = stream;

            // Check video
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                setHasCamera(true);
            }

            // Check audio
            const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            const audioContext = new AudioContextClass();
            audioContextRef.current = audioContext;
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;
            source.connect(analyser);
            setHasMic(true);

            // Visualize volume
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateVolume = () => {
                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((src, a) => src + a, 0) / dataArray.length;
                setMicVolume(Math.min(100, average * 2));
                animationFrameRef.current = requestAnimationFrame(updateVolume);
            };
            updateVolume();

            setIsChecking(false);
        } catch (err: unknown) {
            console.error("Media check failed:", err);
            setError("Could not access camera or microphone. Please allow permissions to continue.");
            setIsChecking(false);
        }
    };

    const allChecksPassed = hasCamera && hasMic;

    return (
        <div className="fixed inset-0 z-50 bg-slate-900 text-slate-100 flex items-center justify-center p-6">
            <div className="max-w-5xl w-full bg-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row border border-slate-700 h-[650px] md:h-[600px]">
                {/* Left Side: Media Preview */}
                <div className="w-full md:w-1/2 p-8 border-b md:border-b-0 md:border-r border-slate-700 flex flex-col gap-6 bg-slate-800/50">
                    <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
                        System Check
                        {allChecksPassed && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
                    </h2>

                    {/* Camera Preview */}
                    <div className="relative aspect-video bg-black rounded-xl overflow-hidden border-2 border-slate-600 shadow-inner group flex-shrink-0">
                        <video
                            ref={videoRef}
                            autoPlay
                            muted
                            playsInline
                            className="w-full h-full object-cover transform scale-x-[-1]"
                        />
                        {!hasCamera && !isChecking && (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-800/80">
                                <span className="text-red-400 flex items-center gap-2">
                                    <AlertTriangle className="w-5 h-5" /> Camera not detected
                                </span>
                            </div>
                        )}
                        <div className="absolute bottom-3 left-3 px-3 py-1 bg-black/60 backdrop-blur-sm rounded-full flex items-center gap-2 text-xs font-medium">
                            <div className={`w-2 h-2 rounded-full ${hasCamera ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
                            {hasCamera ? 'Camera Active' : 'Checking...'}
                        </div>
                    </div>

                    {/* Mic Visualizer */}
                    <div className="bg-slate-700/30 p-5 rounded-2xl border border-slate-700/50">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                                <Mic className={`w-4 h-4 ${hasMic ? 'text-emerald-400' : 'text-slate-400'}`} />
                                Microphone Activity
                            </div>
                            {hasMic && <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full">DETECTED</span>}
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-500 transition-all duration-75 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                                style={{ width: `${micVolume}%` }}
                            />
                        </div>
                    </div>
                </div>

                {/* Right Side: Action & Guidelines */}
                <div className="w-full md:w-1/2 p-8 flex flex-col relative h-full">
                    {/* Guidelines List */}
                    <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                        <h2 className="text-2xl font-bold mb-6">Candidate Guidelines</h2>

                        <div className="flex gap-4 p-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
                            <div className="shrink-0 w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center text-blue-400 font-bold text-sm">1</div>
                            <div>
                                <h3 className="font-bold text-slate-200 text-sm">AI Proctoring Active</h3>
                                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                    We monitor focus. Ensure your face is visible.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-4 p-4 bg-amber-500/10 rounded-xl border border-amber-500/20">
                            <div className="shrink-0 w-8 h-8 bg-amber-500/20 rounded-full flex items-center justify-center text-amber-400 font-bold text-sm">2</div>
                            <div>
                                <h3 className="font-bold text-slate-200 text-sm">Strict Malpractice Policy</h3>
                                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                    Looking away &gt; 5 times terminates the session.
                                </p>
                            </div>
                        </div>

                        <div className="flex gap-4 p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                            <div className="shrink-0 w-8 h-8 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400 font-bold text-sm">3</div>
                            <div>
                                <h3 className="font-bold text-slate-200 text-sm">Environment</h3>
                                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                                    Sit in a quiet, well-lit room.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Footer / Action Area */}
                    <div className="mt-6 pt-6 border-t border-slate-700/50">
                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl mb-4 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-400" />
                                <p className="text-red-400 text-xs font-medium">{error}</p>
                            </div>
                        )}

                        {isResearching ? (
                            // Loading State with Circular Progress
                            <div className="w-full bg-slate-900/50 rounded-2xl p-4 flex items-center gap-4 border border-slate-700/50">
                                <div className="relative w-12 h-12 shrink-0">
                                    <svg className="w-full h-full transform -rotate-90">
                                        <circle
                                            cx="24"
                                            cy="24"
                                            r="20"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                            fill="none"
                                            className="text-slate-700"
                                        />
                                        <circle
                                            cx="24"
                                            cy="24"
                                            r="20"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                            fill="none"
                                            className="text-blue-500 transition-all duration-300 ease-out"
                                            strokeDasharray={125.6}
                                            strokeDashoffset={125.6 - (125.6 * researchProgress) / 100}
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <span className="text-[10px] font-bold text-blue-400">{Math.round(researchProgress)}%</span>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-bold text-slate-200">{researchStatus}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">Setting up your interview environment...</p>
                                </div>
                            </div>
                        ) : (
                            // Start Button
                            <button
                                onClick={onComplete}
                                disabled={!allChecksPassed}
                                className={`w-full h-14 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all ${allChecksPassed
                                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-xl hover:shadow-blue-500/25 transform hover:-translate-y-0.5 active:scale-[0.98]'
                                    : 'bg-slate-700 text-slate-500 cursor-not-allowed opacity-50'
                                    }`}
                            >
                                {allChecksPassed ? (
                                    <>
                                        Start Calibration <ArrowRight className="w-5 h-5" />
                                    </>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        Checking Devices...
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
