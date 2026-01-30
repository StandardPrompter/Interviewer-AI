"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    CheckCircle2,
    Star,
    TrendingUp,
    AlertTriangle,
    Target,
    ArrowRight,
    Home,
    MessageSquare
} from 'lucide-react';

interface Insights {
    summary?: string;
    strengths?: string[];
    weaknesses?: string[];
    score?: number;
    next_steps?: string[];
}

export default function ResultsPage() {
    const router = useRouter();
    const [sessionId, setSessionId] = useState('');
    const [insights, setInsights] = useState<Insights | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [userRating, setUserRating] = useState(0);
    const [feedback, setFeedback] = useState('');
    const [isSubmittingRating, setIsSubmittingRating] = useState(false);
    const [ratingSubmitted, setRatingSubmitted] = useState(false);

    useEffect(() => {
        const storedSessionId = localStorage.getItem('session_id');
        if (!storedSessionId) {
            router.push('/');
            return;
        }
        setSessionId(storedSessionId);
        fetchInsights(storedSessionId);
    }, []);

    const fetchInsights = async (session_id: string) => {
        try {
            const response = await fetch('/api/get-insights', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id }),
            });

            if (response.ok) {
                const data = await response.json();
                setInsights(data.insights);
            } else {
                const errorData = await response.json();
                setError(errorData.error || 'Failed to load insights');
            }
        } catch (err: any) {
            setError('Failed to load insights');
            console.error('Error fetching insights:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const submitRating = async () => {
        if (userRating === 0) return;

        setIsSubmittingRating(true);
        try {
            const response = await fetch('/api/save-rating', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    rating: userRating,
                    feedback: feedback,
                }),
            });

            if (response.ok) {
                setRatingSubmitted(true);
            } else {
                console.error('Failed to save rating');
            }
        } catch (err) {
            console.error('Error saving rating:', err);
        } finally {
            setIsSubmittingRating(false);
        }
    };

    if (isLoading) {
        return (
            <main className="min-h-screen bg-slate-900 flex items-center justify-center p-6 font-sans">
                <div className="max-w-md w-full bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-black/50 border border-slate-700/50 p-12 text-center space-y-8">
                    <div className="relative w-24 h-24 mx-auto">
                        <svg className="w-full h-full animate-spin" viewBox="0 0 100 100">
                            <circle className="text-slate-700 stroke-current" strokeWidth="6" cx="50" cy="50" r="40" fill="transparent" />
                            <circle
                                className="text-blue-500 stroke-current transition-all duration-500 ease-out"
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
                            <TrendingUp className="w-8 h-8 text-blue-400" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100 mb-2">Loading Your Results</h1>
                        <p className="text-slate-400">Analyzing your interview performance...</p>
                    </div>
                </div>
            </main>
        );
    }

    if (error) {
        return (
            <main className="min-h-screen bg-slate-900 flex items-center justify-center p-6 font-sans">
                <div className="max-w-md w-full bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-black/50 border border-slate-700/50 p-12 text-center space-y-8">
                    <div className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertTriangle className="w-12 h-12 text-red-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100 mb-2">Results Not Ready</h1>
                        <p className="text-slate-400 mb-6">{error}</p>
                        <button
                            onClick={() => router.push('/')}
                            className="w-full bg-blue-500 text-white h-12 rounded-2xl font-bold hover:bg-blue-600 transition-all"
                        >
                            Return Home
                        </button>
                    </div>
                </div>
            </main>
        );
    }

    if (!insights) {
        return (
            <main className="min-h-screen bg-slate-900 flex items-center justify-center p-6 font-sans">
                <div className="max-w-md w-full bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-black/50 border border-slate-700/50 p-12 text-center space-y-8">
                    <div className="w-24 h-24 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertTriangle className="w-12 h-12 text-amber-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100 mb-2">No Insights Available</h1>
                        <p className="text-slate-400 mb-6">Your interview analysis is still being processed.</p>
                        <button
                            onClick={() => fetchInsights(sessionId)}
                            className="w-full bg-blue-500 text-white h-12 rounded-2xl font-bold hover:bg-blue-600 transition-all"
                        >
                            Refresh
                        </button>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-slate-900 text-slate-100 font-sans">
            {/* Header */}
            <nav className="h-16 bg-slate-800/90 backdrop-blur-md border-b border-slate-700/50 sticky top-0 z-50 flex items-center justify-between px-8">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                        <CheckCircle2 className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-bold text-lg tracking-tight text-slate-100">Interview <span className="text-slate-400 font-medium">Results</span></span>
                </div>
                <button
                    onClick={() => router.push('/')}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl transition-all"
                >
                    <Home className="w-4 h-4" />
                    <span className="text-sm font-medium">Home</span>
                </button>
            </nav>

            <div className="max-w-4xl mx-auto p-8 space-y-8">
                {/* Score Card */}
                <div className="bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-black/50 border border-slate-700/50 p-8 text-center">
                    <div className="w-32 h-32 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <span className="text-4xl font-bold text-emerald-400">{insights?.score ?? 0}/10</span>
                    </div>
                    <h1 className="text-3xl font-bold text-slate-100 mb-4">Interview Complete!</h1>
                    <p className="text-slate-400 text-lg max-w-2xl mx-auto">{insights?.summary || 'Your interview analysis is being processed.'}</p>
                </div>

                {/* Strengths */}
                <div className="bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-black/50 border border-slate-700/50 p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-emerald-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-100">Strengths</h2>
                    </div>
                    <div className="space-y-4">
                        {Array.isArray(insights?.strengths) && insights.strengths.length > 0 ? (
                            insights.strengths.map((strength, index) => (
                                <div key={index} className="flex items-start gap-3 p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                                    <p className="text-slate-200">{strength}</p>
                                </div>
                            ))
                        ) : (
                            <p className="text-slate-400 text-center py-4">No strengths data available</p>
                        )}
                    </div>
                </div>

                {/* Areas for Improvement */}
                <div className="bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-black/50 border border-slate-700/50 p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-amber-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-100">Areas for Improvement</h2>
                    </div>
                    <div className="space-y-4">
                        {Array.isArray(insights?.weaknesses) && insights.weaknesses.length > 0 ? (
                            insights.weaknesses.map((weakness, index) => (
                                <div key={index} className="flex items-start gap-3 p-4 bg-amber-500/10 rounded-2xl border border-amber-500/20">
                                    <Target className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                                    <p className="text-slate-200">{weakness}</p>
                                </div>
                            ))
                        ) : (
                            <p className="text-slate-400 text-center py-4">No areas for improvement data available</p>
                        )}
                    </div>
                </div>

                {/* Next Steps */}
                <div className="bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-black/50 border border-slate-700/50 p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center">
                            <ArrowRight className="w-5 h-5 text-blue-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-100">Next Steps</h2>
                    </div>
                    <div className="space-y-4">
                        {Array.isArray(insights?.next_steps) && insights.next_steps.length > 0 ? (
                            insights.next_steps.map((step, index) => (
                                <div key={index} className="flex items-start gap-3 p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                                    <ArrowRight className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                                    <p className="text-slate-200">{step}</p>
                                </div>
                            ))
                        ) : (
                            <p className="text-slate-400 text-center py-4">No next steps data available</p>
                        )}
                    </div>
                </div>

                {/* Rating Section */}
                <div className="bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl shadow-black/50 border border-slate-700/50 p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center">
                            <MessageSquare className="w-5 h-5 text-purple-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-100">Rate Your Experience</h2>
                    </div>

                    {!ratingSubmitted ? (
                        <div className="space-y-6">
                            <div>
                                <p className="text-slate-400 mb-4">How would you rate your interview practice experience?</p>
                                <div className="flex items-center gap-2 justify-center">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <button
                                            key={star}
                                            onClick={() => setUserRating(star)}
                                            className={`w-12 h-12 rounded-xl transition-all ${star <= userRating
                                                ? 'bg-yellow-500 text-white shadow-lg shadow-yellow-500/20'
                                                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                                                }`}
                                        >
                                            <Star className="w-6 h-6 mx-auto" fill={star <= userRating ? 'currentColor' : 'none'} />
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-slate-300 mb-2">Additional Feedback (Optional)</label>
                                <textarea
                                    value={feedback}
                                    onChange={(e) => setFeedback(e.target.value)}
                                    placeholder="Tell us about your experience..."
                                    className="w-full h-24 bg-slate-700 border border-slate-600 rounded-2xl px-4 py-3 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                />
                            </div>

                            <button
                                onClick={submitRating}
                                disabled={userRating === 0 || isSubmittingRating}
                                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white h-14 rounded-2xl font-bold transition-all flex items-center justify-center gap-2"
                            >
                                {isSubmittingRating ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    'Submit Rating'
                                )}
                            </button>
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-100 mb-2">Thank You!</h3>
                            <p className="text-slate-400">Your feedback has been submitted successfully.</p>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}