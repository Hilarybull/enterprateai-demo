import React, { useState, useEffect } from 'react';
import Spinner from './Spinner';

const STEPS = [
    { id: 1, text: "Initializing Market Intelligence", duration: 3000 },
    { id: 2, text: "Scanning Global Market Data", duration: 8000 },
    { id: 3, text: "Extracting Research Signals", duration: 8000 },
    { id: 4, text: "AI-Powered Scoring & Assessment", duration: 12000 },
    { id: 5, text: "Compiling Validation Report", duration: 10000 }
];

// Cap the animated progress at 90% — the API can take 2-4 minutes;
// once steps complete we stay at 90% with a "finalising" label until done.
const PROGRESS_CAP = 90;

export default function ValidationLoadingOverlay({ isVisible }) {
    const [currentStep, setCurrentStep] = useState(0);
    const [progress, setProgress] = useState(0);
    const [finalising, setFinalising] = useState(false);

    useEffect(() => {
        if (!isVisible) {
            setCurrentStep(0);
            setProgress(0);
            setFinalising(false);
            return;
        }

        let isMounted = true;

        const runSteps = async () => {
            for (let i = 0; i < STEPS.length; i++) {
                if (!isMounted) break;
                setCurrentStep(i);

                const step = STEPS[i];
                const increment = PROGRESS_CAP / STEPS.length;
                const startProgress = i * increment;
                const endProgress = (i + 1) * increment;

                const startTime = Date.now();
                while (Date.now() - startTime < step.duration) {
                    if (!isMounted) break;
                    const elapsed = Date.now() - startTime;
                    const stepProgress = elapsed / step.duration;
                    const globalProgress = startProgress + (stepProgress * (increment * 0.9));
                    setProgress(globalProgress);
                    await new Promise(r => setTimeout(r, 50));
                }

                if (isMounted) setProgress(endProgress);
            }
            // All timed steps done — hold at PROGRESS_CAP and show finalising state
            if (isMounted) {
                setProgress(PROGRESS_CAP);
                setFinalising(true);
            }
        };

        runSteps();

        return () => {
            isMounted = false;
        };
    }, [isVisible]);

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 backdrop-blur-xl transition-all duration-500">
            <div className="w-full max-w-lg p-8 mx-4 bg-white rounded-3xl shadow-2xl ring-1 ring-slate-200 animate-in fade-in zoom-in duration-300">
                <div className="flex flex-col items-center text-center">
                    <div className="relative mb-8">
                        <div className="absolute inset-0 rounded-full bg-brand-50 animate-ping opacity-25"></div>
                        <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-brand-50 text-brand-600 ring-4 ring-brand-100">
                            <svg className="w-10 h-10 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                <path d="m9 12 2 2 4-4" />
                            </svg>
                        </div>
                    </div>

                    <h3 className="text-2xl font-bold text-slate-900 mb-2">
                        Performing Validation
                    </h3>
                    <p className="text-slate-500 mb-8 max-w-xs">
                        Our multi-stage intelligence engine is analyzing your idea against real-time market data.
                    </p>

                    <div className="w-full space-y-6">
                        {/* Steps Indicator */}
                        <div className="space-y-3">
                            {STEPS.map((step, idx) => {
                                const isActive = idx === currentStep;
                                const isCompleted = idx < currentStep;

                                return (
                                    <div
                                        key={step.id}
                                        className={`flex items-center gap-3 transition-all duration-300 ${isActive ? 'translate-x-1 opacity-100' : isCompleted ? 'opacity-50' : 'opacity-30'}`}
                                    >
                                        <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${isActive ? 'bg-brand-600 text-white shadow-lg shadow-brand-200' : isCompleted ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                            {isCompleted ? (
                                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            ) : (
                                                idx + 1
                                            )}
                                        </div>
                                        <span className={`text-sm font-semibold ${isActive ? 'text-slate-900' : 'text-slate-500'}`}>
                                            {step.text}{isActive ? '...' : ''}
                                        </span>
                                        {isActive && <div className="ml-auto"><Spinner size={14} /></div>}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Progress Bar */}
                        <div className="relative pt-4">
                            <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                {finalising ? (
                                    <div className="h-full w-full relative overflow-hidden rounded-full bg-gradient-to-r from-brand-500 to-indigo-600">
                                        <div className="absolute inset-0 translate-x-[-100%] animate-[slide_1.4s_ease-in-out_infinite] bg-white/30 rounded-full" />
                                    </div>
                                ) : (
                                    <div
                                        className="h-full bg-gradient-to-r from-brand-500 to-indigo-600 transition-all duration-300 ease-out rounded-full"
                                        style={{ width: `${progress}%` }}
                                    />
                                )}
                            </div>
                            <div className="flex justify-between mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                <span>{finalising ? "Finalising results…" : "Progress"}</span>
                                <span>{finalising ? "Almost done" : `${Math.round(progress)}%`}</span>
                            </div>
                        </div>
                        <style>{`@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
                    </div>
                </div>
            </div>
        </div>
    );
}
