"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowRight, Brain, Briefcase, Building, ChevronRight, Sparkles, User, CheckCircle, Shield } from 'lucide-react';

export default function LandingPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    company_name: '',
    company_url: '',
    interviewer_name: '',
    interviewer_linkedin_url: '',
    job_description: ''
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setStatusMessage("Initializing session...");

    // Generate session ID
    const newSessionId = crypto.randomUUID();

    try {
      // Step 1: Save job description to DynamoDB
      setStatusMessage("Saving job description...");

      const saveResponse = await fetch('/api/save-job-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: newSessionId,
          job_description: formData.job_description || '',
          company_name: formData.company_name,
          company_url: formData.company_url || '',
          interviewer_name: formData.interviewer_name || '',
          interviewer_linkedin_url: formData.interviewer_linkedin_url || '',
        }),
      });

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json();
        throw new Error(errorData.error || 'Failed to save job description');
      }

      if (resumeFile) {
        setStatusMessage("Uploading resume...");
        const resumeFormData = new FormData();
        resumeFormData.append('resume', resumeFile);
        resumeFormData.append('session_id', newSessionId);

        try {
          await fetch('/api/save-resume', {
            method: 'POST',
            body: resumeFormData,
          });
        } catch (error) {
          console.error("Error uploading resume:", error);
          // Continue even if resume upload fails, or handle differently
        }
      }

      setStatusMessage("Triggering persona generation...");

      // Step 2: Trigger Step Functions
      const stepFnResponse = await fetch('/api/create-persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: newSessionId,
          company_name: formData.company_name,
          company_url: formData.company_url || '',
          interviewer_name: formData.interviewer_name || '',
          interviewer_linkedin_url: formData.interviewer_linkedin_url || '',
        }),
      });

      if (!stepFnResponse.ok) {
        const errorData = await stepFnResponse.json();
        throw new Error(errorData.error || 'Failed to start Step Functions');
      }

      const stepFnData = await stepFnResponse.json();
      const executionArn = stepFnData.executionArn;

      if (!executionArn) {
        throw new Error('No execution ARN returned from Step Functions');
      }

      // Store session_id and executionArn in localStorage for backup
      localStorage.setItem('session_id', newSessionId);
      localStorage.setItem('execution_arn', executionArn);

      // Navigate to preparation page
      const params = new URLSearchParams({
        session_id: newSessionId,
        execution_arn: executionArn
      });
      router.push(`/preparation?${params.toString()}`);

    } catch (error: any) {
      console.error("Error in setup flow:", error);
      setStatusMessage(`Error: ${error.message || 'Something went wrong'}`);
      setIsSubmitting(false);
      alert(`Failed to start session: ${error.message || 'Unknown error'}`);
    }
  };

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 overflow-x-hidden selection:bg-blue-500/30 selection:text-blue-100">
      {/* Navbar */}
      <nav className="border-b border-slate-700/50 bg-slate-800/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight text-slate-100">InterviewPractice <span className="text-slate-400 font-medium">AI</span></span>
          </div>
          <div className="flex items-center gap-8">
            <a href="#" className="text-sm font-semibold text-slate-400 hover:text-slate-100 transition-colors">SignIn</a>
            <button className="bg-blue-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-600 transition-all shadow-md shadow-blue-500/20">Get Started</button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-8 py-20 lg:py-32 grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
        {/* Left: Content */}
        <div className="space-y-10">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-wider border border-blue-500/30 shadow-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Next-Gen Interview Prep</span>
            </div>
            <h1 className="text-6xl lg:text-7xl font-extrabold tracking-tight text-slate-100 leading-[1.05]">
              Master your <br />
              <span className="text-blue-400">career moves.</span>
            </h1>
            <p className="text-lg text-slate-400 max-w-lg leading-relaxed font-medium">
              Prepare with our realistic AI interviewer tailored specifically to your target role and company. Get real-time feedback on confidence, clarity, and content.
            </p>
          </div>

          <div className="flex items-center gap-10">
            <div className="flex items-center gap-4 group cursor-default">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-400 border border-emerald-500/30 group-hover:scale-110 transition-transform">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-100">10k+ Interviews</p>
                <p className="text-xs text-slate-400 font-medium">Successfully practiced</p>
              </div>
            </div>
            <div className="w-px h-10 bg-slate-700" />
            <div className="flex items-center gap-4 group cursor-default">
              <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center text-blue-400 border border-blue-500/30 group-hover:scale-110 transition-transform">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-100">Secure & Private</p>
                <p className="text-xs text-slate-400 font-medium">Your data is never shared</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Setup Form */}
        <div className="relative">
          <div className="absolute -inset-4 bg-blue-500/10 rounded-[3rem] blur-3xl opacity-50" />
          <div className="relative bg-slate-800/90 backdrop-blur-xl rounded-[2.5rem] p-10 border border-slate-700/50 shadow-2xl shadow-black/50">
            <h2 className="text-2xl font-bold text-slate-100 mb-8 flex items-center gap-3">
              <Briefcase className="w-6 h-6 text-blue-400" />
              Setup your session
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">
                  Company Name <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    required
                    name="company_name"
                    value={formData.company_name}
                    onChange={handleInputChange}
                    className="w-full bg-slate-900/50 border border-slate-700 text-slate-100 rounded-2xl px-5 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-slate-500"
                    placeholder="e.g. Nimble Work"
                    disabled={isSubmitting}
                  />
                  <Building className="absolute right-4 top-4.5 w-4 h-4 text-slate-500" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">
                  Company URL <span className="text-slate-500 text-[9px]">(optional)</span>
                </label>
                <div className="relative">
                  <input
                    name="company_url"
                    type="url"
                    value={formData.company_url}
                    onChange={handleInputChange}
                    className="w-full bg-slate-900/50 border border-slate-700 text-slate-100 rounded-2xl px-5 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-slate-500"
                    placeholder="https://www.nimblework.com/"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">
                  Interviewer Name <span className="text-slate-500 text-[9px]">(optional)</span>
                </label>
                <div className="relative">
                  <input
                    name="interviewer_name"
                    value={formData.interviewer_name}
                    onChange={handleInputChange}
                    className="w-full bg-slate-900/50 border border-slate-700 text-slate-100 rounded-2xl px-5 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-slate-500"
                    placeholder="e.g. Fahad Ali Shaikh"
                    disabled={isSubmitting}
                  />
                  <User className="absolute right-4 top-4.5 w-4 h-4 text-slate-500" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">
                  Interviewer LinkedIn URL <span className="text-slate-500 text-[9px]">(optional)</span>
                </label>
                <div className="relative">
                  <input
                    name="interviewer_linkedin_url"
                    type="url"
                    value={formData.interviewer_linkedin_url}
                    onChange={handleInputChange}
                    className="w-full bg-slate-900/50 border border-slate-700 text-slate-100 rounded-2xl px-5 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-slate-500"
                    placeholder="https://linkedin.com/in/..."
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">
                  Job Description <span className="text-slate-500 text-[9px]">(optional)</span>
                </label>
                <textarea
                  name="job_description"
                  value={formData.job_description}
                  onChange={handleInputChange}
                  className="w-full bg-slate-900/50 border border-slate-700 text-slate-100 rounded-2xl px-5 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-slate-500 min-h-[160px] resize-none"
                  placeholder="Paste the role requirements here..."
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">
                  Resume (PDF) <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    required
                    type="file"
                    accept=".pdf"
                    onChange={(e) => setResumeFile(e.target.files ? e.target.files[0] : null)}
                    className="w-full bg-slate-900/50 border border-slate-700 text-slate-100 rounded-2xl px-5 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-blue-500 text-white h-16 rounded-[1.25rem] font-bold flex items-center justify-center gap-3 hover:bg-blue-600 transition-all active:scale-[0.98] mt-4 shadow-xl shadow-blue-500/20 text-lg disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {statusMessage || 'Processing...'}
                  </>
                ) : (
                  <>
                    Launch Interview
                    <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Footer Hint */}
      <div className="max-w-7xl mx-auto px-8 py-10 border-t border-slate-700/50 flex items-center justify-center text-slate-500 text-sm font-medium">
        Advanced AI Analysis Powered by GPT-4o Realtime
      </div>
    </main>
  );
}
