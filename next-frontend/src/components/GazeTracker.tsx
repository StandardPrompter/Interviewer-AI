"use client";

import Script from 'next/script';
import { useEffect, useState, useRef, useCallback } from 'react';
import { Eye, AlertTriangle, Crosshair } from 'lucide-react';

interface GazeTrackerProps {
    onGazeViolation?: () => void;
    onCalibrationComplete?: () => void;
    isActive: boolean;
    skipCalibration?: boolean;
}

export default function GazeTracker({ onGazeViolation, onCalibrationComplete, isActive, skipCalibration = false }: GazeTrackerProps) {
    const [scriptLoaded, setScriptLoaded] = useState(false);
    const [isCalibrating, setIsCalibrating] = useState(!skipCalibration);
    const [calibrationPoints, setCalibrationPoints] = useState<number>(0);
    const [gazeStatus, setGazeStatus] = useState<'safe' | 'warning' | 'calibrating'>('calibrating');
    const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isInitializedRef = useRef<boolean>(false);
    const videoObserverRef = useRef<MutationObserver | null>(null);

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
            // Check if webgazer is available and not already initialized
            if (!window.webgazer || isInitializedRef.current) return;

            // Mark as initialized
            isInitializedRef.current = true;

            // Clear any previous data
            window.webgazer.clearData();

            // Configure WebGazer to avoid MediaPipe dependencies
            // We hide WebGazer's video because we render our own in InterviewPage for better control
            window.webgazer.showVideo(false);
            window.webgazer.showFaceOverlay(false); // Disable face overlay to avoid MediaPipe
            window.webgazer.showFaceFeedbackBox(false); // Disable feedback box

            // If skipping calibration, hide points immediately
            if (skipCalibration) {
                window.webgazer.showPredictionPoints(false);
            }

            // Start the gaze tracker
            await window.webgazer.setGazeListener((data) => {
                if (data) {
                    if (!isCalibrating && isActive) {
                        checkGazeBounds(data.x, data.y);
                    }
                }
            }).begin();

            // Relocate video feed to our custom container
            const relocateVideo = () => {
                const videoElement = document.getElementById('webgazerVideoFeed');
                const container = document.getElementById('user-video-container');

                if (videoElement && container) {
                    // Check if already in container
                    if (videoElement.parentElement !== container) {
                        container.appendChild(videoElement);
                    }

                    // Force styles to ensure it fits container and stays there
                    // We use setProperty with 'important' to override WebGazer's internal style updates
                    videoElement.style.setProperty('position', 'absolute', 'important');
                    videoElement.style.setProperty('top', '0', 'important');
                    videoElement.style.setProperty('left', '0', 'important');
                    videoElement.style.setProperty('width', '100%', 'important');
                    videoElement.style.setProperty('height', '100%', 'important');
                    videoElement.style.setProperty('object-fit', 'cover', 'important');
                    videoElement.style.setProperty('z-index', '10', 'important');
                    videoElement.style.setProperty('border-radius', '0', 'important');
                    videoElement.style.setProperty('margin', '0', 'important');
                    videoElement.style.setProperty('display', 'block', 'important');

                    // Also handle the face overlay canvas if it exists
                    const overlay = document.getElementById('webgazerFaceOverlay');
                    if (overlay && overlay.parentElement !== container) {
                        container.appendChild(overlay);
                        overlay.style.position = 'absolute';
                        overlay.style.top = '0';
                        overlay.style.left = '0';
                        overlay.style.width = '100%';
                        overlay.style.height = '100%';
                        overlay.style.zIndex = '20';
                    }

                    // Handle feedback box
                    const feedback = document.getElementById('webgazerFaceFeedbackBox');
                    if (feedback && feedback.parentElement !== container) {
                        container.appendChild(feedback);
                        feedback.style.zIndex = '30';
                    }

                    return true;
                }
                return false;
            };

            // Aggressive style enforcement loop
            // WebGazer might try to reset styles or position, so we force it back
            const intervalId = setInterval(relocateVideo, 100);

            // Store interval ID for cleanup
            // We'll attach it to the window object or a ref if needed, 
            // but effectively clear it on cleanup
            const cleanupInterval = () => clearInterval(intervalId);

            // Stop checking after 10 seconds (usually enough time for stabilization)
            setTimeout(cleanupInterval, 10000);

            // Also return cleanup for the useEffect
            return cleanupInterval;


        } catch (error) {
            console.error("Failed to initialize WebGazer:", error);
            isInitializedRef.current = false; // Reset on error
        }
    }, [isCalibrating, isActive, checkGazeBounds]);

    const stopWebGazer = useCallback(() => {
        if (window.webgazer && isInitializedRef.current) {
            try {
                // Try to end WebGazer gracefully
                window.webgazer.end();
            } catch (error) {
                // WebGazer's end() can throw if elements are already removed
                console.warn('WebGazer cleanup error (safe to ignore):', error);
            }

            // Disconnect observer if still active
            if (videoObserverRef.current) {
                videoObserverRef.current.disconnect();
                videoObserverRef.current = null;
            }

            // Mark as no longer initialized
            isInitializedRef.current = false;
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
