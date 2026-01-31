interface WebGazer {
    setGazeListener: (callback: (data: { x: number; y: number } | null, elapsedTime: number) => void) => WebGazer;
    begin: () => Promise<void>;
    end: () => WebGazer;
    pause: () => WebGazer;
    resume: () => WebGazer;
    showVideo: (show: boolean) => WebGazer;
    showPredictionPoints: (show: boolean) => WebGazer;
    clearData: () => WebGazer;
    showFaceOverlay: (show: boolean) => WebGazer;
    showFaceFeedbackBox: (show: boolean) => WebGazer;
    params: {
        showVideo: boolean;
        mirrorVideo: boolean;
        [key: string]: unknown;
    };
}

declare global {
    interface Window {
        webgazer: WebGazer;
    }
}

export { };
