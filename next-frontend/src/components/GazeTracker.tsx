"use client";

import Script from 'next/script';
import { useEffect, useState, useRef, useCallback } from 'react';
import { Eye, AlertTriangle, Crosshair } from 'lucide-react';

interface GazeTrackerProps {
    onGazeViolation?: () => void;
    onCalibrationComplete?: () => void;
    isActive: boolean;
}

export default function GazeTracker({ onGazeViolation, onCalibrationComplete, isActive }: GazeTrackerProps) {
    const [scriptLoaded, setScriptLoaded] = useState(false);
    const [isCalibrating, setIsCalibrating] = useState(true);
    const [calibrationPoints, setCalibrationPoints] = useState<number>(0);
    const [gazeStatus, setGazeStatus] = useState<'safe' | 'warning' | 'calibrating'>('calibrating');
    const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const checkGazeBounds = useCallback((x: number, y: number) => {
        const { innerWidth, innerHeight } = window;
        const margin = 100; // Allow some margin outside the viewport

        const isOutside = x < -margin || x > innerWidth + margin || y < -margin || y > innerHeight + margin;

        if (isOutside) {
            setGazeStatus('warning');
            if (!warningTimeoutRef.current) {
                warningTimeoutRef.current = setTimeout(() => {
                    if (onGazeViolation) onGazeViolation();
                }, 2000); // 2 seconds of looking away triggers violation
            }
        } else {
            setGazeStatus('safe');
            if (warningTimeoutRef.current) {
                clearTimeout(warningTimeoutRef.current);
                warningTimeoutRef.current = null;
            }
        }
    }, [onGazeViolation]);

    const setupWebGazer = useCallback(async () => {
        try {
            // Initialize but don't start predicting continuously yet until after calibration? 
            // Actually WebGazer needs to run to calibrate.

            if (!window.webgazer) return;

            // Clear any previous data
            window.webgazer.clearData();

            // Start the gaze tracker
            await window.webgazer.setGazeListener((data) => {
                if (data) {
                    if (!isCalibrating && isActive) {
                        checkGazeBounds(data.x, data.y);
                    }
                }
            }).begin();

            // Hide the default video feed/face overlay if desired, or style it
            // window.webgazer.showVideo(false); 
            // window.webgazer.showFaceOverlay(false);
            // window.webgazer.showFaceFeedbackBox(false);

            // For now, let's keep video helpful for user to position themselves
            const videoElement = document.getElementById('webgazerVideoFeed');
            if (videoElement) {
                videoElement.style.position = 'fixed';
                videoElement.style.bottom = '20px';
                videoElement.style.right = '20px';
                videoElement.style.zIndex = '9999';
                videoElement.style.width = '200px';
                videoElement.style.height = 'auto';
                videoElement.style.borderRadius = '12px';
                videoElement.style.border = '2px solid rgba(59, 130, 246, 0.5)'; // Blue border
                videoElement.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
                videoElement.style.display = 'block';
            }

        } catch (error) {
            console.error("Failed to initialize WebGazer:", error);
        }
    }, [isCalibrating, isActive, checkGazeBounds]);

    const stopWebGazer = useCallback(() => {
        if (window.webgazer) {
            window.webgazer.end();
            // Also need to manually remove the video element if WebGazer doesn't do it cleanly
            const videoElement = document.getElementById('webgazerVideoFeed');
            if (videoElement) videoElement.remove();
            const faceOverlay = document.getElementById('webgazerFaceOverlay');
            if (faceOverlay) faceOverlay.remove();
            const feedbackBox = document.getElementById('webgazerFaceFeedbackBox');
            if (feedbackBox) feedbackBox.remove();
        }
    }, []);

    // Initial setup when script is loaded
    useEffect(() => {
        if (scriptLoaded && window.webgazer) {
            setupWebGazer();
        }
        return () => {
            // Cleanup handled in detailed cleanup function
            stopWebGazer();
        };
    }, [scriptLoaded, setupWebGazer, stopWebGazer]);

    const handleCalibrationClick = (pointId: string) => {
        // In a real implementation, we'd track specific points. 
        // For simplicity, we just count clicks appropriately spread out.
        setCalibrationPoints(prev => prev + 1);

        // Hide the clicked point (hacky simple calibration flow)
        const btn = document.getElementById(pointId);
        if (btn) btn.style.display = 'none';

        if (calibrationPoints >= 8) { // 9 points total (0-8)
            setIsCalibrating(false);
            setGazeStatus('safe');
            // Turn off predictions markers after calibration
            window.webgazer.showPredictionPoints(false);
            if (onCalibrationComplete) onCalibrationComplete();
        }
    };

    return (
        <>
            <Script
                src="https://webgazer.cs.brown.edu/webgazer.js"
                strategy="afterInteractive"
                onLoad={() => setScriptLoaded(true)}
            />

            {/* Calibration Overlay */}
            {scriptLoaded && isCalibrating && (
                <div className="fixed inset-0 z-[100] bg-slate-900/95 flex flex-col items-center justify-center">
                    <div className="text-center mb-8 text-slate-100 max-w-lg">
                        <Crosshair className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                        <h2 className="text-2xl font-bold mb-2">Eye Calibration Required</h2>
                        <p className="text-slate-400">
                            Please click on each of the 9 red dots on the screen while looking directly at them.
                            This ensures accurate gaze detection during your interview.
                        </p>
                        <div className="mt-4 p-4 bg-slate-800 rounded-lg text-sm text-yellow-400 border border-yellow-500/20">
                            Make sure your face is well-lit and centered in the camera feed (bottom right).
                        </div>
                    </div>

                    {/* Calibration Points Grid - Absolute Positioning */}
                    {[
                        { id: 'pt-tl', top: '20px', left: '20px' },
                        { id: 'pt-tm', top: '20px', left: '50%', transform: 'translateX(-50%)' },
                        { id: 'pt-tr', top: '20px', right: '20px' },
                        { id: 'pt-ml', top: '50%', left: '20px', transform: 'translateY(-50%)' },
                        { id: 'pt-mm', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
                        { id: 'pt-mr', top: '50%', right: '20px', transform: 'translateY(-50%)' },
                        { id: 'pt-bl', bottom: '20px', left: '20px' },
                        { id: 'pt-bm', bottom: '20px', left: '50%', transform: 'translateX(-50%)' },
                        { id: 'pt-br', bottom: '20px', right: '20px' },
                    ].map((pt) => (
                        <button
                            key={pt.id}
                            id={pt.id}
                            onClick={() => handleCalibrationClick(pt.id)}
                            className="absolute w-8 h-8 bg-red-500 rounded-full border-4 border-white shadow-lg hover:scale-125 transition-transform cursor-crosshair animate-pulse"
                            style={{ ...pt }}
                        />
                    ))}
                </div>
            )}

            {/* Status Indicator (Only visible when active and not calibrating) */}
            {!isCalibrating && isActive && (
                <div className={`fixed bottom-6 left-6 z-50 px-4 py-2 rounded-xl border backdrop-blur-md transition-colors duration-300 flex items-center gap-3 shadow-lg ${gazeStatus === 'warning'
                    ? 'bg-red-500/20 border-red-500/50 text-red-200'
                    : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                    }`}>
                    {gazeStatus === 'warning' ? (
                        <>
                            <AlertTriangle className="w-5 h-5 animate-pulse" />
                            <span className="font-bold uppercase text-xs tracking-wider">Focus on Screen</span>
                        </>
                    ) : (
                        <>
                            <Eye className="w-5 h-5" />
                            <span className="font-bold uppercase text-xs tracking-wider">Proctoring Active</span>
                        </>
                    )}
                </div>
            )}
        </>
    );
}
