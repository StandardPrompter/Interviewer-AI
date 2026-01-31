"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PrepCheck from '@/components/PrepCheck';
import GazeTracker from '@/components/GazeTracker';
import { Brain, Camera } from 'lucide-react';

function PreparationContent() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [sessionId, setSessionId] = useState<string>('');
    const [executionArn, setExecutionArn] = useState<string>('');

    const [isResearching, setIsResearching] = useState(true);
    const [progress, setProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState("Initializing...");
    const [error, setError] = useState<string | null>(null);
    const [isCalibrating, setIsCalibrating] = useState(false);
    const [isCalibrated, setIsCalibrated] = useState(false);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
    const videoRef = React.useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        // Get params from URL first, then localStorage
        const urlSessionId = searchParams.get('session_id');
        const urlExecutionArn = searchParams.get('execution_arn');

        const storedSessionId = localStorage.getItem('session_id');
        const storedExecutionArn = localStorage.getItem('execution_arn');

        const finalSessionId = urlSessionId || storedSessionId;
        const finalExecutionArn = urlExecutionArn || storedExecutionArn;

        if (!finalSessionId || !finalExecutionArn) {
            setError("Missing session information. Please return to the home page.");
            setIsResearching(false); // Stop researching visual
            return;
        }

        // Ensure they are in localStorage for the next steps (Interview Page relies on this)
        localStorage.setItem('session_id', finalSessionId);
        localStorage.setItem('execution_arn', finalExecutionArn);

        setSessionId(finalSessionId);
        setExecutionArn(finalExecutionArn);

        // Initial Progress
        setProgress(30);
        setStatusMessage("Generating interviewer persona...");

        // Start Polling
        pollStepFunctionStatus(finalExecutionArn);
    }, [searchParams]);

    const pollStepFunctionStatus = async (arn: string) => {
        const maxAttempts = 300; // 10 minutes max
        let attempts = 0;

        while (attempts < maxAttempts) {
            try {
                const response = await fetch(`/api/check-step-function?executionArn=${encodeURIComponent(arn)}`);

                if (!response.ok) {
                    // If checking fails, likely network or server transient issue, warn but retry
                    console.warn("Failed to check Step Functions status, retrying...");
                } else {
                    const data = await response.json();
                    const status = data.status;

                    if (status === 'SUCCEEDED') {
                        setProgress(100);
                        setStatusMessage("Persona Ready!");
                        setIsResearching(false);
                        return;
                    } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED_OUT') {
                        throw new Error(`AI Generation ${status.toLowerCase()}`);
                    }

                    // Update progress based on status (simulating progress for long running tasks)
                    if (status === 'RUNNING') {
                        const progressValue = Math.min(95, 30 + (attempts * 0.5)); // Slower increment
                        setProgress(progressValue);

                        if (progressValue < 60) {
                            setStatusMessage("Analyzing job description & resume...");
                        } else if (progressValue < 85) {
                            setStatusMessage("Crafting behavioral questions...");
                        } else {
                            setStatusMessage("Finalizing interview simulation...");
                        }
                    }
                }

                // Wait 2 seconds before next poll
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempts++;
            } catch (error: any) {
                console.error("Error polling Step Functions:", error);
                setError(error.message || "Failed to generate interview persona.");
                setIsResearching(false);
                return;
            }
        }

        setError("Generation timed out. Please try again.");
        setIsResearching(false);
    };

    const startCalibration = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            setCameraStream(stream);
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            setIsCalibrating(true);
        } catch (err) {
            console.error("Camera access failed:", err);
            setError("Camera access is required for calibration. Please adjust your browser settings.");
        }
    };

    const handlePrepComplete = () => {
        if (!isCalibrated) {
            startCalibration();
        } else {
            router.push('/interview');
        }
    };

    const onCalibrationComplete = () => {
        setIsCalibrating(false);
        setIsCalibrated(true);
        // Clean up stream
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            setCameraStream(null);
        }
        // Auto navigate or let user click proceed
        router.push('/interview');
    };

    if (error) {
        return (
            <main className="min-h-screen bg-slate-900 flex items-center justify-center p-6 font-sans text-slate-100">
                <div className="max-w-md w-full bg-slate-800/90 backdrop-blur-xl rounded-3xl p-10 border border-red-500/30 text-center">
                    <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Brain className="w-10 h-10 text-red-400" />
                    </div>
                    <h2 className="text-2xl font-bold mb-4">Setup Failed</h2>
                    <p className="text-slate-400 mb-8">{error}</p>
                    <button
                        onClick={() => router.push('/')}
                        className="w-full py-4 bg-slate-700 hover:bg-slate-600 rounded-xl font-bold transition-all"
                    >
                        Return Home
                    </button>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-slate-900 text-slate-100">
            {isCalibrating ? (
                <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
                    {/* Camera Feed for Calibration (Needed for GazeTracker visual feedback) */}
                    <div id="user-video-container" className="absolute bottom-4 right-4 w-64 h-48 bg-black rounded-lg overflow-hidden border-2 border-slate-700 z-10 shadow-2xl">
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover transform scale-x-[-1]"
                        />
                        <div className="absolute top-2 left-2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white/80 font-mono">
                            CALIBRATION MODE
                        </div>
                    </div>

                    <GazeTracker
                        isActive={true}
                        onCalibrationComplete={onCalibrationComplete}
                    />
                </div>
            ) : (
                <PrepCheck
                    onComplete={handlePrepComplete}
                    isResearching={isResearching}
                    researchProgress={progress}
                    researchStatus={statusMessage}
                />
            )}
        </main>
    );
}

export default function PreparationPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">
                Loading...
            </div>
        }>
            <PreparationContent />
        </Suspense>
    );
}
