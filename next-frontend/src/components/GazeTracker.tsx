"use client";

import { useEffect, useRef, useCallback } from 'react';
import { Eye, AlertTriangle } from 'lucide-react';
import { FaceLandmarker, FilesetResolver, FaceLandmarkerResult } from '@mediapipe/tasks-vision';

interface GazeTrackerProps {
    onGazeViolation?: () => void;
    onCalibrationComplete?: () => void;
    isActive: boolean;
    skipCalibration?: boolean;
    videoRef?: React.RefObject<HTMLVideoElement | null>;
}

// Landmark indices for head pose estimation (MediaPipe Face Mesh)
const NOSE_TIP = 1;
const LEFT_EAR = 234;
const RIGHT_EAR = 454;
const FOREHEAD = 10;
const CHIN = 152;

// Thresholds for "looking away" detection
const YAW_THRESHOLD = 25;       // degrees - head turned left/right
const PITCH_THRESHOLD = 20;     // degrees - head tilted up/down
const AWAY_DURATION_MS = 2000;  // 2 seconds of looking away = 1 violation
const DETECTION_INTERVAL_MS = 100; // Run detection every 100ms

function calculateHeadPose(landmarks: { x: number; y: number; z: number }[]) {
    const nose = landmarks[NOSE_TIP];
    const leftEar = landmarks[LEFT_EAR];
    const rightEar = landmarks[RIGHT_EAR];
    const forehead = landmarks[FOREHEAD];
    const chin = landmarks[CHIN];

    // Calculate yaw (left-right rotation)
    // When facing straight, nose x is midway between ears
    const earMidX = (leftEar.x + rightEar.x) / 2;
    const earWidth = Math.abs(rightEar.x - leftEar.x);

    // Normalized deviation of nose from ear midpoint
    // earWidth is used as a scale factor for robustness
    const yawRatio = earWidth > 0.001 ? (nose.x - earMidX) / earWidth : 0;
    // Convert to approximate degrees (empirical mapping)
    const yaw = yawRatio * 90;

    // Calculate pitch (up-down rotation)
    const faceMidY = (forehead.y + chin.y) / 2;
    const faceHeight = Math.abs(chin.y - forehead.y);

    const pitchRatio = faceHeight > 0.001 ? (nose.y - faceMidY) / faceHeight : 0;
    const pitch = pitchRatio * 90;

    return { yaw, pitch };
}

export default function GazeTracker({
    onGazeViolation,
    onCalibrationComplete,
    isActive,
    skipCalibration = false,
    videoRef
}: GazeTrackerProps) {
    // Use refs for all mutable state to avoid stale closure issues
    const isActiveRef = useRef(isActive);
    const onGazeViolationRef = useRef(onGazeViolation);
    const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
    const detectionLoopRef = useRef<number | null>(null);
    const awayStartRef = useRef<number | null>(null);
    const gazeStatusRef = useRef<'safe' | 'warning'>('safe');
    const statusElementRef = useRef<HTMLDivElement | null>(null);
    const isInitializedRef = useRef(false);
    const fallbackVideoRef = useRef<HTMLVideoElement | null>(null);

    // Keep refs in sync with prop changes
    useEffect(() => {
        isActiveRef.current = isActive;
    }, [isActive]);

    useEffect(() => {
        onGazeViolationRef.current = onGazeViolation;
    }, [onGazeViolation]);

    // Signal calibration complete immediately since we don't need calibration
    useEffect(() => {
        if (skipCalibration && onCalibrationComplete) {
            onCalibrationComplete();
        }
    }, [skipCalibration, onCalibrationComplete]);

    const updateStatusUI = useCallback((status: 'safe' | 'warning') => {
        if (gazeStatusRef.current === status) return;
        gazeStatusRef.current = status;
        // Force re-render of status indicator via DOM manipulation for performance
        // (avoids re-rendering the entire component on every frame)
        const el = statusElementRef.current;
        if (!el) return;

        if (status === 'warning') {
            el.className = 'fixed bottom-6 left-6 z-50 px-4 py-2 rounded-xl border backdrop-blur-md transition-colors duration-300 flex items-center gap-3 shadow-lg bg-red-500/20 border-red-500/50 text-red-200';
            el.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 animate-pulse"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
                <span class="font-bold uppercase text-xs tracking-wider">Focus on Screen</span>
            `;
        } else {
            el.className = 'fixed bottom-6 left-6 z-50 px-4 py-2 rounded-xl border backdrop-blur-md transition-colors duration-300 flex items-center gap-3 shadow-lg bg-emerald-500/20 border-emerald-500/50 text-emerald-200';
            el.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                <span class="font-bold uppercase text-xs tracking-wider">Proctoring Active</span>
            `;
        }
    }, []);

    const processDetection = useCallback((result: FaceLandmarkerResult) => {
        if (!isActiveRef.current) return;

        const now = Date.now();

        if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
            // No face detected — treat as looking away after a brief grace period
            if (!awayStartRef.current) {
                awayStartRef.current = now;
            }
            updateStatusUI('warning');
        } else {
            const landmarks = result.faceLandmarks[0];
            const { yaw, pitch } = calculateHeadPose(landmarks);

            const isLookingAway = Math.abs(yaw) > YAW_THRESHOLD || Math.abs(pitch) > PITCH_THRESHOLD;

            if (isLookingAway) {
                if (!awayStartRef.current) {
                    awayStartRef.current = now;
                }
                updateStatusUI('warning');
            } else {
                // Looking at screen — reset
                awayStartRef.current = null;
                updateStatusUI('safe');
            }
        }

        // Check if away duration exceeded threshold
        if (awayStartRef.current && (now - awayStartRef.current) >= AWAY_DURATION_MS) {
            // Fire violation
            console.warn('🚨 Gaze violation: looked away for 2+ seconds');
            if (onGazeViolationRef.current) {
                onGazeViolationRef.current();
            }
            // Reset the timer so the next violation needs another 2 seconds
            awayStartRef.current = now;
        }
    }, [updateStatusUI]);

    const startDetectionLoop = useCallback((video: HTMLVideoElement) => {
        const detect = () => {
            if (!faceLandmarkerRef.current || !isActiveRef.current) {
                detectionLoopRef.current = window.setTimeout(() => {
                    detectionLoopRef.current = requestAnimationFrame(detect) as unknown as number;
                }, DETECTION_INTERVAL_MS);
                return;
            }

            if (video.readyState >= 2) { // HAVE_CURRENT_DATA
                try {
                    const result = faceLandmarkerRef.current.detectForVideo(video, Date.now());
                    processDetection(result);
                } catch (err) {
                    console.warn('Face detection frame error:', err);
                }
            }

            // Schedule next detection
            detectionLoopRef.current = window.setTimeout(() => {
                detectionLoopRef.current = requestAnimationFrame(detect) as unknown as number;
            }, DETECTION_INTERVAL_MS);
        };

        detect();
    }, [processDetection]);

    // Initialize FaceLandmarker and start detection
    useEffect(() => {
        if (isInitializedRef.current) return;

        let cancelled = false;

        const init = async () => {
            try {
                console.log('🔧 Initializing FaceLandmarker...');

                const vision = await FilesetResolver.forVisionTasks(
                    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
                );

                if (cancelled) return;

                const landmarker = await FaceLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                        delegate: 'GPU'
                    },
                    runningMode: 'VIDEO',
                    numFaces: 1,
                    outputFaceBlendshapes: false,
                    outputFacialTransformationMatrixes: false,
                });

                if (cancelled) {
                    landmarker.close();
                    return;
                }

                faceLandmarkerRef.current = landmarker;
                isInitializedRef.current = true;
                console.log('✅ FaceLandmarker initialized');

                // Get video element — prefer passed ref, otherwise create our own
                let video: HTMLVideoElement | null = videoRef?.current || null;

                if (!video) {
                    // Create a hidden video element with webcam stream
                    console.log('📹 Creating fallback video element for gaze detection...');
                    video = document.createElement('video');
                    video.setAttribute('autoplay', '');
                    video.setAttribute('playsinline', '');
                    video.style.position = 'absolute';
                    video.style.top = '-9999px';
                    video.style.left = '-9999px';
                    video.style.width = '1px';
                    video.style.height = '1px';
                    document.body.appendChild(video);
                    fallbackVideoRef.current = video;

                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                        if (cancelled) {
                            stream.getTracks().forEach(t => t.stop());
                            return;
                        }
                        video.srcObject = stream;
                        await video.play();
                    } catch (err) {
                        console.error('Failed to get webcam for gaze detection:', err);
                        return;
                    }
                }

                // Wait for video to be ready
                const waitForVideo = () => {
                    return new Promise<void>((resolve) => {
                        const check = () => {
                            if (video && video.readyState >= 2) {
                                resolve();
                            } else {
                                setTimeout(check, 100);
                            }
                        };
                        check();
                    });
                };

                await waitForVideo();
                if (cancelled) return;

                console.log('▶️ Starting gaze detection loop');
                startDetectionLoop(video);

            } catch (error) {
                console.error('Failed to initialize FaceLandmarker:', error);
                isInitializedRef.current = false;
            }
        };

        init();

        return () => {
            cancelled = true;

            // Cancel detection loop
            if (detectionLoopRef.current !== null) {
                cancelAnimationFrame(detectionLoopRef.current);
                detectionLoopRef.current = null;
            }

            // Close face landmarker
            if (faceLandmarkerRef.current) {
                faceLandmarkerRef.current.close();
                faceLandmarkerRef.current = null;
            }

            // Clean up fallback video
            if (fallbackVideoRef.current) {
                const stream = fallbackVideoRef.current.srcObject as MediaStream;
                if (stream) {
                    stream.getTracks().forEach(t => t.stop());
                }
                fallbackVideoRef.current.remove();
                fallbackVideoRef.current = null;
            }

            isInitializedRef.current = false;
        };
    }, [startDetectionLoop, videoRef]);

    if (!isActive) return null;

    return (
        <div
            ref={statusElementRef}
            className="fixed bottom-6 left-6 z-50 px-4 py-2 rounded-xl border backdrop-blur-md transition-colors duration-300 flex items-center gap-3 shadow-lg bg-emerald-500/20 border-emerald-500/50 text-emerald-200"
        >
            <Eye className="w-5 h-5" />
            <span className="font-bold uppercase text-xs tracking-wider">Proctoring Active</span>
        </div>
    );
}
