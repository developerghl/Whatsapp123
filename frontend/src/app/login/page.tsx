"use client";

import { useState, useEffect, useRef } from "react";

// Small utilities used by the cartoon-eyes and the form below
interface PupilProps {
  size?: number;
  maxDistance?: number;
  pupilColor?: string;
  forceLookX?: number;
  forceLookY?: number;
}

const Pupil = ({ size = 12, maxDistance = 5, pupilColor = "black", forceLookX, forceLookY }: PupilProps) => {
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const pupilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouseX(e.clientX);
      setMouseY(e.clientY);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const calculate = () => {
    if (!pupilRef.current) return { x: 0, y: 0 };
    if (forceLookX !== undefined && forceLookY !== undefined) return { x: forceLookX, y: forceLookY };
    const r = pupilRef.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = mouseX - cx;
    const dy = mouseY - cy;
    const dist = Math.min(Math.hypot(dx, dy), maxDistance);
    const ang = Math.atan2(dy, dx);
    return { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist };
  };

  const pos = calculate();
  return (
    <div
      ref={pupilRef}
      className="rounded-full"
      style={{ width: size, height: size, backgroundColor: pupilColor, transform: `translate(${pos.x}px, ${pos.y}px)`, transition: "transform 0.1s ease-out" }}
    />
  );
};

interface EyeBallProps {
  size?: number;
  pupilSize?: number;
  maxDistance?: number;
  eyeColor?: string;
  pupilColor?: string;
  isBlinking?: boolean;
  forceLookX?: number;
  forceLookY?: number;
}

const EyeBall = ({ size = 48, pupilSize = 16, maxDistance = 10, eyeColor = "white", pupilColor = "black", isBlinking = false, forceLookX, forceLookY }: EyeBallProps) => {
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const eyeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => { setMouseX(e.clientX); setMouseY(e.clientY); };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  const calc = () => {
    if (!eyeRef.current) return { x: 0, y: 0 };
    if (forceLookX !== undefined && forceLookY !== undefined) return { x: forceLookX, y: forceLookY };
    const r = eyeRef.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = mouseX - cx; const dy = mouseY - cy;
    const dist = Math.min(Math.hypot(dx, dy), maxDistance);
    const ang = Math.atan2(dy, dx);
    return { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist };
  };
  const pos = calc();
  return (
    <div ref={eyeRef} className="rounded-full flex items-center justify-center transition-all duration-150" style={{ width: size, height: isBlinking ? 2 : size, backgroundColor: eyeColor, overflow: "hidden" }}>
      {!isBlinking && (
        <div className="rounded-full" style={{ width: pupilSize, height: pupilSize, backgroundColor: pupilColor, transform: `translate(${pos.x}px, ${pos.y}px)`, transition: "transform 0.1s ease-out" }} />
      )}
    </div>
  );
};

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mouseX, setMouseX] = useState<number>(0);
  const [mouseY, setMouseY] = useState<number>(0);
  const [isPurpleBlinking, setIsPurpleBlinking] = useState(false);
  const [isBlackBlinking, setIsBlackBlinking] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isLookingAtEachOther, setIsLookingAtEachOther] = useState(false);
  const [isPurplePeeking, setIsPurplePeeking] = useState(false);
  
  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState("");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => { setMouseX(e.clientX); setMouseY(e.clientY); };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    const rand = () => Math.random() * 4000 + 3000;
    const schedule = (set: (b: boolean) => void) => {
      const t = setTimeout(() => { set(true); setTimeout(() => set(false), 150); schedule(set); }, rand());
      return t;
    };
    const t1 = schedule(setIsPurpleBlinking);
    const t2 = schedule(setIsBlackBlinking);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    if (isTyping) {
      setIsLookingAtEachOther(true);
      const t = setTimeout(() => setIsLookingAtEachOther(false), 800);
      return () => clearTimeout(t);
    }
  }, [isTyping]);

  useEffect(() => {
    if (password.length > 0 && showPassword) {
      const t = setTimeout(() => { setIsPurplePeeking(true); setTimeout(() => setIsPurplePeeking(false), 800); }, Math.random() * 3000 + 2000);
      return () => clearTimeout(t);
    } else {
      setIsPurplePeeking(false);
    }
  }, [password, showPassword]);

  const calc = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 3;
    const dx = mouseX - cx; const dy = mouseY - cy;
    return { faceX: Math.max(-15, Math.min(15, dx / 20)), faceY: Math.max(-10, Math.min(10, dy / 30)), bodySkew: Math.max(-6, Math.min(6, -dx / 120)) };
  };
  const purplePos = calc(purpleRef); const blackPos = calc(blackRef); const yellowPos = calc(yellowRef); const orangePos = calc(orangeRef);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      localStorage.setItem('user', JSON.stringify(data.user));
      // Use window.location.href instead of router.push to force full page reload
      // This ensures localStorage is properly read before dashboard loads
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
      setIsLoading(false); // Only reset loading on error
    }
    // Don't reset loading on success - let page reload handle it
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError("");
    setForgotSuccess("");
    setIsSendingOtp(true);
    
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        setOtpSent(true);
        setForgotSuccess('OTP has been sent to your email. Please check your inbox.');
      } else {
        throw new Error(data.error || 'Failed to send OTP');
      }
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : 'Failed to send OTP. Please try again.');
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError("");
    setForgotSuccess("");
    
    if (newPassword.length < 8) {
      setForgotError('Password must be at least 8 characters');
      return;
    }
    
    if (newPassword !== confirmNewPassword) {
      setForgotError('Passwords do not match');
      return;
    }
    
    setIsResettingPassword(true);
    
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotEmail,
          otp: otp,
          newPassword: newPassword
        })
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        setForgotSuccess('Password reset successfully! You can now login with your new password.');
        setTimeout(() => {
          setShowForgotPassword(false);
          setForgotEmail("");
          setOtp("");
          setNewPassword("");
          setConfirmNewPassword("");
          setOtpSent(false);
          setForgotError("");
          setForgotSuccess("");
        }, 2000);
      } else {
        throw new Error(data.error || 'Failed to reset password');
      }
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : 'Failed to reset password. Please try again.');
    } finally {
      setIsResettingPassword(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left characters */}
      <div className="relative hidden lg:flex flex-col justify-between bg-gradient-to-br from-emerald-700 via-emerald-600 to-cyan-600 p-12 text-white">
        {/* Polished gradient backdrop with animated blob */}
        <svg className="absolute inset-0 w-full h-full opacity-50" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
            <filter id="softBlur"><feGaussianBlur in="SourceGraphic" stdDeviation="40" /></filter>
          </defs>
          <path fill="url(#lg)" filter="url(#softBlur)">
            <animate attributeName="d" dur="14s" repeatCount="indefinite"
              values="M587,420Q581,500,520,560Q459,620,380,606Q301,592,244,540Q187,488,165,408Q143,328,189,259Q235,190,309,162Q383,134,454,165Q525,196,572,253Q619,310,587,420Z;
                      M596,408Q559,500,492,568Q425,636,337,611Q249,586,212,506Q175,426,177,340Q179,254,246,201Q313,148,398,150Q483,152,543,208Q603,264,613,332Q623,400,596,408Z;
                      M587,420Q581,500,520,560Q459,620,380,606Q301,592,244,540Q187,488,165,408Q143,328,189,259Q235,190,309,162Q383,134,454,165Q525,196,572,253Q619,310,587,420Z" />
          </path>
              </svg>
        {/* Radial highlights */}
        <div className="pointer-events-none absolute -top-10 -left-10 w-[420px] h-[420px] rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-10 right-10 w-[520px] h-[520px] rounded-full bg-cyan-200/10 blur-3xl" />
        {/* Floating gradient bubbles */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute left-16 top-24 size-8 rounded-full bg-white/30 animate-ping [animation-duration:3s]" />
          <div className="absolute left-40 top-52 size-10 rounded-full bg-white/20 animate-pulse" />
          <div className="absolute right-24 top-36 size-6 rounded-full bg-white/25 animate-bounce" />
          <div className="absolute right-40 bottom-24 size-7 rounded-full bg-white/20 animate-ping [animation-duration:2.5s]" />
          <div className="absolute left-24 bottom-28 size-9 rounded-full bg-white/20 animate-pulse" />
        </div>
        <div className="relative z-20 flex items-end justify-center h-[500px]">
          <div className="relative" style={{ width: '550px', height: '400px' }}>
            {/* Purple */}
            <div ref={purpleRef} className="absolute bottom-0 transition-all duration-700 ease-in-out" style={{ left: '70px', width: '180px', height: (isTyping || (password.length > 0 && !showPassword)) ? '440px' : '400px', backgroundColor: '#6C3FF5', borderRadius: '10px 10px 0 0', zIndex: 1, transform: (password.length > 0 && showPassword) ? `skewX(0deg)` : (isTyping || (password.length > 0 && !showPassword)) ? `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px)` : `skewX(${purplePos.bodySkew || 0}deg)`, transformOrigin: 'bottom center' }}>
              <div className="absolute flex gap-8 transition-all duration-700 ease-in-out" style={{ left: (password.length > 0 && showPassword) ? `20px` : isLookingAtEachOther ? `55px` : `${45 + purplePos.faceX}px`, top: (password.length > 0 && showPassword) ? `35px` : isLookingAtEachOther ? `65px` : `${40 + purplePos.faceY}px` }}>
                <EyeBall size={18} pupilSize={7} maxDistance={5} eyeColor="white" pupilColor="#2D2D2D" isBlinking={isPurpleBlinking} forceLookX={(password.length > 0 && showPassword) ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined} forceLookY={(password.length > 0 && showPassword) ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined} />
                <EyeBall size={18} pupilSize={7} maxDistance={5} eyeColor="white" pupilColor="#2D2D2D" isBlinking={isPurpleBlinking} forceLookX={(password.length > 0 && showPassword) ? (isPurplePeeking ? 4 : -4) : isLookingAtEachOther ? 3 : undefined} forceLookY={(password.length > 0 && showPassword) ? (isPurplePeeking ? 5 : -4) : isLookingAtEachOther ? 4 : undefined} />
              </div>
            </div>
            {/* Black */}
            <div ref={blackRef} className="absolute bottom-0 transition-all duration-700 ease-in-out" style={{ left: '240px', width: '120px', height: '310px', backgroundColor: '#2D2D2D', borderRadius: '8px 8px 0 0', zIndex: 2, transform: (password.length > 0 && showPassword) ? `skewX(0deg)` : isLookingAtEachOther ? `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)` : (isTyping || (password.length > 0 && !showPassword)) ? `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)` : `skewX(${blackPos.bodySkew || 0}deg)`, transformOrigin: 'bottom center' }}>
              <div className="absolute flex gap-6 transition-all duration-700 ease-in-out" style={{ left: (password.length > 0 && showPassword) ? `10px` : isLookingAtEachOther ? `32px` : `${26 + blackPos.faceX}px`, top: (password.length > 0 && showPassword) ? `28px` : isLookingAtEachOther ? `12px` : `${32 + blackPos.faceY}px` }}>
                <EyeBall size={16} pupilSize={6} maxDistance={4} eyeColor="white" pupilColor="#2D2D2D" isBlinking={isBlackBlinking} forceLookX={(password.length > 0 && showPassword) ? -4 : isLookingAtEachOther ? 0 : undefined} forceLookY={(password.length > 0 && showPassword) ? -4 : isLookingAtEachOther ? -4 : undefined} />
                <EyeBall size={16} pupilSize={6} maxDistance={4} eyeColor="white" pupilColor="#2D2D2D" isBlinking={isBlackBlinking} forceLookX={(password.length > 0 && showPassword) ? -4 : isLookingAtEachOther ? 0 : undefined} forceLookY={(password.length > 0 && showPassword) ? -4 : isLookingAtEachOther ? -4 : undefined} />
              </div>
            </div>
            {/* Orange semi circle */}
            <div ref={orangeRef} className="absolute bottom-0 transition-all duration-700 ease-in-out" style={{ left: '0px', width: '240px', height: '200px', zIndex: 3, backgroundColor: '#FF9B6B', borderRadius: '120px 120px 0 0', transform: (password.length > 0 && showPassword) ? `skewX(0deg)` : `skewX(${orangePos.bodySkew || 0}deg)`, transformOrigin: 'bottom center' }}>
              <div className="absolute flex gap-8 transition-all duration-200 ease-out" style={{ left: (password.length > 0 && showPassword) ? `50px` : `${82 + (orangePos.faceX || 0)}px`, top: (password.length > 0 && showPassword) ? `85px` : `${90 + (orangePos.faceY || 0)}px` }}>
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={(password.length > 0 && showPassword) ? -5 : undefined} forceLookY={(password.length > 0 && showPassword) ? -4 : undefined} />
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={(password.length > 0 && showPassword) ? -5 : undefined} forceLookY={(password.length > 0 && showPassword) ? -4 : undefined} />
              </div>
            </div>
            {/* Yellow */}
            <div ref={yellowRef} className="absolute bottom-0 transition-all duration-700 ease-in-out" style={{ left: '310px', width: '140px', height: '230px', backgroundColor: '#E8D754', borderRadius: '70px 70px 0 0', zIndex: 4, transform: (password.length > 0 && showPassword) ? `skewX(0deg)` : `skewX(${yellowPos.bodySkew || 0}deg)`, transformOrigin: 'bottom center' }}>
              <div className="absolute flex gap-6 transition-all duration-200 ease-out" style={{ left: (password.length > 0 && showPassword) ? `20px` : `${52 + (yellowPos.faceX || 0)}px`, top: (password.length > 0 && showPassword) ? `35px` : `${40 + (yellowPos.faceY || 0)}px` }}>
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={(password.length > 0 && showPassword) ? -5 : undefined} forceLookY={(password.length > 0 && showPassword) ? -4 : undefined} />
                <Pupil size={12} maxDistance={5} pupilColor="#2D2D2D" forceLookX={(password.length > 0 && showPassword) ? -5 : undefined} forceLookY={(password.length > 0 && showPassword) ? -4 : undefined} />
              </div>
              <div className="absolute w-20 h-[4px] bg-[#2D2D2D] rounded-full transition-all duration-200 ease-out" style={{ left: (password.length > 0 && showPassword) ? `10px` : `${40 + (yellowPos.faceX || 0)}px`, top: (password.length > 0 && showPassword) ? `88px` : `${88 + (yellowPos.faceY || 0)}px` }} />
            </div>
            </div>
          </div>
        <div className="absolute inset-0 bg-white/10 pointer-events-none" />
        </div>

      {/* Right login */}
      <div className="flex items-center justify-center p-8 bg-gray-50">
        <div className="w-full max-w-[440px] rounded-2xl bg-white/80 backdrop-blur shadow-xl ring-1 ring-gray-200 p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-extrabold tracking-tight mb-2 bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-cyan-600">Welcome back!</h1>
            <p className="text-gray-500 text-sm">Please enter your details</p>
            <div className="mx-auto mt-3 h-1 w-16 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" />
            </div>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-emerald-600">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zM2 20a10 10 0 1120 0v1H2v-1z"/></svg>
                </span>
                <input id="email" type="email" placeholder="you@example.com" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} onFocus={() => setIsTyping(true)} onBlur={() => setIsTyping(false)} required className="h-12 w-full rounded-lg border-0 ring-1 ring-gray-300 bg-white pl-10 pr-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder:text-gray-400" />
            </div>
          </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-gray-700">Password</label>
              <div className="relative">
                <input id="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12 w-full rounded-lg border-0 ring-1 ring-gray-300 bg-white pr-10 px-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700">
                  {showPassword ? (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-5.523 0-10-5-10-7s4.477-7 10-7c1.01 0 1.99.143 2.91.41M3 3l18 18"/></svg>
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
            </button>
          </div>
            </div>
            {error && <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">{error}</div>}
            <button type="submit" disabled={isLoading} className="group relative w-full h-12 rounded-xl text-white font-semibold bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 shadow-lg hover:shadow-emerald-500/30 hover:from-emerald-600 hover:via-teal-600 hover:to-cyan-700 transition-shadow disabled:opacity-50">
              <span className="absolute inset-0 rounded-xl bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              {isLoading ? 'Signing in...' : 'Log in'}
            </button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
              >
                Forgot password?
              </button>
            </div>
        </form>
      </div>
      
      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 relative">
            <button
              onClick={() => {
                setShowForgotPassword(false);
                setForgotEmail("");
                setOtp("");
                setNewPassword("");
                setConfirmNewPassword("");
                setOtpSent(false);
                setForgotError("");
                setForgotSuccess("");
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Reset Password</h2>
            <p className="text-sm text-gray-600 mb-6">Enter your email to receive an OTP</p>
            
            {forgotError && (
              <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg">
                {forgotError}
              </div>
            )}
            
            {forgotSuccess && (
              <div className="mb-4 p-3 text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg">
                {forgotSuccess}
              </div>
            )}
            
            {!otpSent ? (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <label htmlFor="forgot-email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    placeholder="you@example.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                    className="w-full h-12 rounded-lg border-0 ring-1 ring-gray-300 bg-white px-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSendingOtp}
                  className="w-full h-12 rounded-xl text-white font-semibold bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 shadow-lg hover:shadow-emerald-500/30 disabled:opacity-50"
                >
                  {isSendingOtp ? 'Sending OTP...' : 'Send OTP'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-1">
                    OTP Code
                  </label>
                  <input
                    id="otp"
                    type="text"
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    maxLength={6}
                    className="w-full h-12 rounded-lg border-0 ring-1 ring-gray-300 bg-white px-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-center text-2xl tracking-widest"
                  />
                  <p className="mt-1 text-xs text-gray-500">Enter the 6-digit code sent to your email</p>
                </div>
                
                <div>
                  <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
                    New Password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full h-12 rounded-lg border-0 ring-1 ring-gray-300 bg-white px-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                
                <div>
                  <label htmlFor="confirm-new-password" className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm New Password
                  </label>
                  <input
                    id="confirm-new-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full h-12 rounded-lg border-0 ring-1 ring-gray-300 bg-white px-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                
                <button
                  type="submit"
                  disabled={isResettingPassword}
                  className="w-full h-12 rounded-xl text-white font-semibold bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 shadow-lg hover:shadow-emerald-500/30 disabled:opacity-50"
                >
                  {isResettingPassword ? 'Resetting Password...' : 'Reset Password'}
                </button>
                
                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false);
                    setOtp("");
                    setNewPassword("");
                    setConfirmNewPassword("");
                    setForgotError("");
                    setForgotSuccess("");
                  }}
                  className="w-full text-sm text-gray-600 hover:text-gray-800"
                >
                  Back to email
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}


