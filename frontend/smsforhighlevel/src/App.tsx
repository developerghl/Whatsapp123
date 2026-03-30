import React, { useState } from "react";
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, type MotionValue } from "framer-motion";
import { CheckCircle2, ArrowRight, Check, MessageSquare } from "lucide-react";

const BackgroundBubbles = ({ mouseX, mouseY }: { mouseX: MotionValue<number>, mouseY: MotionValue<number> }) => {
  const bgX1 = useTransform(mouseX, [-1, 1], [-30, 30]);
  const bgY1 = useTransform(mouseY, [-1, 1], [-30, 30]);
  
  const bgX2 = useTransform(mouseX, [-1, 1], [40, -40]);
  const bgY2 = useTransform(mouseY, [-1, 1], [40, -40]);
  
  const bgX3 = useTransform(mouseX, [-1, 1], [-20, 20]);
  const bgY3 = useTransform(mouseY, [-1, 1], [20, -20]);

  const floatX1 = useTransform(mouseX, [-1, 1], [-60, 60]);
  const floatY1 = useTransform(mouseY, [-1, 1], [-60, 60]);
  
  const floatX2 = useTransform(mouseX, [-1, 1], [80, -80]);
  const floatY2 = useTransform(mouseY, [-1, 1], [80, -80]);
  
  const floatX3 = useTransform(mouseX, [-1, 1], [-40, 40]);
  const floatY3 = useTransform(mouseY, [-1, 1], [40, -40]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-center justify-center">
      <motion.div style={{ x: bgX1, y: bgY1 }} className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-200/30 rounded-full blur-[120px]"/>
      <motion.div style={{ x: bgX2, y: bgY2 }} className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-indigo-200/20 rounded-full blur-[150px]"/>
      <motion.div style={{ x: bgX3, y: bgY3 }} className="absolute top-[20%] right-[10%] w-[30%] h-[30%] bg-purple-200/20 rounded-full blur-[100px]"/>

      <motion.div style={{ x: floatX1, y: floatY1 }} className="absolute left-[10%] top-[20%] opacity-[0.03] text-slate-900">
        <motion.div animate={{ y: [0, -15, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
          <MessageSquare className="w-32 h-32"/>
        </motion.div>
      </motion.div>
      
      <motion.div style={{ x: floatX2, y: floatY2 }} className="absolute right-[15%] bottom-[25%] opacity-[0.03] text-slate-900">
        <motion.div animate={{ y: [0, 20, 0] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }}>
          <MessageSquare className="w-48 h-48"/>
        </motion.div>
      </motion.div>
      
      <motion.div style={{ x: floatX3, y: floatY3 }} className="absolute left-[40%] bottom-[10%] opacity-[0.02] text-slate-900">
        <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 2 }}>
          <MessageSquare className="w-24 h-24"/>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default function App() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { damping: 50, stiffness: 400 };
  const smoothMouseX = useSpring(mouseX, springConfig);
  const smoothMouseY = useSpring(mouseY, springConfig);

  const handleMouseMove = (e: React.MouseEvent) => {
    const { clientX, clientY } = e;
    const { innerWidth, innerHeight } = window;
    const x = (clientX / innerWidth) * 2 - 1;
    const y = (clientY / innerHeight) * 2 - 1;
    mouseX.set(x);
    mouseY.set(y);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setIsSubmitted(true);
    }
  };

  return (
    <main onMouseMove={handleMouseMove} className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#fafafa] px-6 py-12 lg:p-12">
      <BackgroundBubbles mouseX={smoothMouseX} mouseY={smoothMouseY}/>

      <div className="relative z-10 w-full max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-20 items-center">
        
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, ease: "easeOut" }} className="flex flex-col justify-center max-w-xl mx-auto lg:mx-0 lg:pr-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 text-[11px] font-semibold uppercase tracking-widest mb-8 shadow-sm w-fit">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            Coming Soon
          </div>

          <h1 className="font-display text-5xl lg:text-[5.5rem] font-bold tracking-tight text-slate-900 mb-6 leading-[1.05]">
            Smarter SMS.<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              Built for LeadConnector.
            </span>
          </h1>

          <p className="text-lg lg:text-xl text-slate-500 mb-10 leading-relaxed font-medium">
            Automate conversations, increase response rates, and scale your workflows effortlessly.
          </p>

          <div className="space-y-4">
            {[
              "Native LeadConnector integration",
              "Advanced conversational AI routing",
              "Zero-code automation builder"
            ].map((bullet, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + (i * 0.1), duration: 0.5 }} className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100">
                  <Check className="w-3 h-3 text-blue-600"/>
                </div>
                {bullet}
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }} className="w-full max-w-2xl mx-auto lg:mx-0 lg:ml-auto">
          <div className="bg-white/80 backdrop-blur-xl p-8 sm:p-12 lg:p-16 rounded-[2.5rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-white/60 relative overflow-hidden group">
            
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"/>

            <AnimatePresence mode="wait">
              {!isSubmitted ? (
                <motion.div key="form-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="relative z-10">
                  <div className="mb-10">
                    <h2 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-3 font-display">Get Early Access</h2>
                    <p className="text-slate-500 text-sm lg:text-base">Join the waitlist to be the first to experience the future of LeadConnector SMS.</p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-5">
                      <div>
                        <label htmlFor="name" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 ml-1">
                          Full Name <span className="text-slate-400 font-normal capitalize tracking-normal">(Optional)</span>
                        </label>
                        <input id="name" type="text" placeholder="John Doe" value={name} onChange={(e) => setName(e.target.value)}
                          className="w-full px-6 py-5 rounded-2xl bg-slate-50/50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-500 focus:bg-white focus:shadow-[0_0_30px_-5px_rgba(59,130,246,0.25)] transition-all duration-500 text-lg"
                        />
                      </div>
                      <div>
                        <label htmlFor="email" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 ml-1">
                          Work Email <span className="text-blue-500">*</span>
                        </label>
                        <input id="email" type="email" required placeholder="john@agency.com" value={email} onChange={(e) => setEmail(e.target.value)}
                          className="w-full px-6 py-5 rounded-2xl bg-slate-50/50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-500 focus:bg-white focus:shadow-[0_0_30px_-5px_rgba(59,130,246,0.25)] transition-all duration-500 text-lg"
                        />
                      </div>
                    </div>

                    <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} type="submit" className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-5 px-8 rounded-2xl transition-all duration-300 flex items-center justify-center gap-3 group shadow-xl shadow-slate-900/10 text-lg mt-8">
                      Get Early Access
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform"/>
                    </motion.button>
                    
                    <p className="text-center text-xs text-slate-400 font-medium pt-4">
                      No spam. Unsubscribe at any time.
                    </p>
                  </form>
                </motion.div>
              ) : (
                <motion.div key="success-content" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative z-10 py-12 text-center flex flex-col items-center justify-center min-h-[400px]">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.5, delay: 0.2 }} className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-6 border border-green-100 shadow-sm">
                    <CheckCircle2 className="w-10 h-10 text-green-500"/>
                  </motion.div>
                  <h3 className="text-3xl font-bold text-slate-900 mb-4 font-display">You're on the list!</h3>
                  <p className="text-slate-500 text-lg max-w-sm mx-auto">
                    Thanks for your interest. We&apos;ll notify you as soon as we launch SMS for LeadConnector.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      <div className="absolute bottom-6 left-6 lg:left-12">
        <p className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold">
          Powered by <a href="https://octendr.com" className="hover:text-slate-900 transition-colors">Octendr.com</a>
        </p>
      </div>
    </main>
  );
}
