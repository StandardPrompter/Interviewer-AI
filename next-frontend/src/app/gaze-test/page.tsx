"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import GazeTracker from '@/components/GazeTracker';

export default function GazeTestPage() {
    const [violations, setViolations] = useState(0);
    const [logs, setLogs] = useState<string[]>([]);
    const [terminated, setTerminated] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [cameraReady, setCameraReady] = useState(false);

    const addLog = useCallback((msg: string) => {
        const ts = new Date().toLocaleTimeString();
        setLogs(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 50));
    }, []);

    useEffect(() => {
        // Start camera immediately
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play();
                    setCameraReady(true);
                    addLog('Camera started');
                }
            })
            .catch(err => {
                addLog(`Camera error: ${err.message}`);
            });

        return () => {
            if (videoRef.current?.srcObject) {
                (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
            }
        };
    }, [addLog]);

    const handleGazeViolation = useCallback(() => {
        setViolations(prev => {
            const newCount = prev + 1;
            addLog(`🚨 VIOLATION #${newCount}`);
            if (newCount > 5) {
                setTerminated(true);
                addLog('❌ INTERVIEW TERMINATED — 5+ violations');
            }
            return newCount;
        });
    }, [addLog]);

    if (terminated) {
        return (
            <main className="min-h-screen bg-red-950 flex items-center justify-center p-6 text-white">
                <div className="text-center space-y-4">
                    <h1 className="text-4xl font-bold text-red-300">🚫 TERMINATED</h1>
                    <p className="text-xl">Interview terminated due to {violations} gaze violations</p>
                    <button
                        onClick={() => { setViolations(0); setTerminated(false); setLogs([]); }}
                        className="px-6 py-3 bg-red-700 hover:bg-red-600 rounded-xl font-bold"
                    >
                        Reset Test
                    </button>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-slate-950 text-white p-6">
            <h1 className="text-2xl font-bold mb-6">Gaze Detection Test Page</h1>

            <div className="grid grid-cols-2 gap-6 max-w-6xl mx-auto">
                {/* Left: Camera + Status */}
                <div className="space-y-4">
                    <div className="bg-slate-800 rounded-2xl overflow-hidden border border-slate-700">
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full aspect-video object-cover transform scale-x-[-1]"
                        />
                    </div>

                    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">Violations:</span>
                            <span className={`text-2xl font-bold ${violations > 3 ? 'text-red-400' : violations > 0 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                                {violations} / 5
                            </span>
                        </div>
                        <div className="mt-2 w-full bg-slate-700 rounded-full h-2">
                            <div
                                className={`h-2 rounded-full transition-all duration-300 ${violations > 3 ? 'bg-red-500' : violations > 0 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min(100, (violations / 5) * 100)}%` }}
                            />
                        </div>
                    </div>

                    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 text-sm text-slate-400">
                        <h3 className="font-bold text-slate-300 mb-2">Instructions:</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Look at the screen — status should say &quot;Proctoring Active&quot;</li>
                            <li>Turn your head away — status should change to &quot;Focus on Screen&quot;</li>
                            <li>Keep looking away for 2s — a violation fires</li>
                            <li>After 5 violations — page shows &quot;TERMINATED&quot;</li>
                        </ol>
                    </div>
                </div>

                {/* Right: Logs */}
                <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 max-h-[600px] overflow-y-auto">
                    <h3 className="font-bold text-slate-300 mb-3">Event Log</h3>
                    {logs.length === 0 ? (
                        <p className="text-slate-500">Waiting for events...</p>
                    ) : (
                        <div className="space-y-1 font-mono text-xs">
                            {logs.map((log, i) => (
                                <div key={i} className={`${log.includes('🚨') ? 'text-red-400' : log.includes('❌') ? 'text-red-300 font-bold' : 'text-slate-400'}`}>
                                    {log}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* GazeTracker Component */}
            {cameraReady && (
                <GazeTracker
                    isActive={true}
                    skipCalibration={true}
                    onGazeViolation={handleGazeViolation}
                    videoRef={videoRef}
                />
            )}
        </main>
    );
}
