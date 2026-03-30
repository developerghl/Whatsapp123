'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, ArrowRight, Check, MessageSquare } from 'lucide-react'

// Floating background bubbles with mouse parallax
function BackgroundBubbles({ mouseX, mouseY }: { mouseX: number; mouseY: number }) {
  const normX = mouseX
  const normY = mouseY

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Soft Mesh Gradients */}
      <div
        className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[120px]"
        style={{
          background: 'rgba(147, 197, 253, 0.3)',
          transform: `translate(${normX * -30}px, ${normY * -30}px)`,
          transition: 'transform 0.1s ease-out',
        }}
      />
      <div
        className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full blur-[150px]"
        style={{
          background: 'rgba(165, 180, 252, 0.2)',
          transform: `translate(${normX * 40}px, ${normY * 40}px)`,
          transition: 'transform 0.1s ease-out',
        }}
      />
      <div
        className="absolute top-[20%] right-[10%] w-[30%] h-[30%] rounded-full blur-[100px]"
        style={{
          background: 'rgba(216, 180, 254, 0.2)',
          transform: `translate(${normX * -20}px, ${normY * 20}px)`,
          transition: 'transform 0.1s ease-out',
        }}
      />

      {/* Faint SMS Bubbles */}
      <div
        className="absolute left-[10%] top-[20%] opacity-[0.03] text-slate-900"
        style={{ transform: `translate(${normX * -60}px, ${normY * -60}px)` }}
      >
        <MessageSquare style={{ width: 128, height: 128 }} />
      </div>
      <div
        className="absolute right-[15%] bottom-[25%] opacity-[0.03] text-slate-900"
        style={{ transform: `translate(${normX * 80}px, ${normY * 80}px)` }}
      >
        <MessageSquare style={{ width: 192, height: 192 }} />
      </div>
      <div
        className="absolute left-[40%] bottom-[10%] opacity-[0.02] text-slate-900"
        style={{ transform: `translate(${normX * -40}px, ${normY * 40}px)` }}
      >
        <MessageSquare style={{ width: 96, height: 96 }} />
      </div>
    </div>
  )
}

export default function SMSforHighLevelPage() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = ((e.clientY - rect.top) / rect.height) * 2 - 1
    setMousePos({ x, y })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email) {
      setIsSubmitted(true)
    }
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative w-full min-h-full flex items-center justify-center overflow-hidden rounded-2xl"
      style={{ background: '#fafafa', padding: '3rem 1.5rem' }}
    >
      <BackgroundBubbles mouseX={mousePos.x} mouseY={mousePos.y} />

      {/* Main Content */}
      <div className="relative z-10 w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

        {/* LEFT: Text Content */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="flex flex-col justify-center"
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 text-[11px] font-semibold uppercase tracking-widest mb-8 shadow-sm w-fit">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            Coming Soon
          </div>

          {/* Headline */}
          <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 mb-6 leading-tight">
            Smarter SMS.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              Built for LeadConnector.
            </span>
          </h1>

          {/* Subtext */}
          <p className="text-base lg:text-lg text-slate-500 mb-10 leading-relaxed font-medium">
            Automate conversations, increase response rates, and scale your workflows effortlessly.
          </p>

          {/* Bullets */}
          <div className="space-y-4">
            {[
              'Native LeadConnector integration',
              'Advanced conversational AI routing',
              'Zero-code automation builder',
            ].map((bullet, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.1, duration: 0.5 }}
                className="flex items-center gap-3 text-sm text-slate-600 font-medium"
              >
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center border border-blue-100">
                  <Check className="w-3 h-3 text-blue-600" />
                </div>
                {bullet}
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* RIGHT: Form Card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
          className="w-full"
        >
          <div className="bg-white/80 backdrop-blur-xl p-8 sm:p-10 rounded-3xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.08)] border border-white/60 relative overflow-hidden group">
            {/* Inner glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

            <AnimatePresence mode="wait">
              {!isSubmitted ? (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="relative z-10"
                >
                  <div className="mb-8">
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Get Early Access</h2>
                    <p className="text-slate-500 text-sm">
                      Join the waitlist to be the first to experience the future of LeadConnector SMS.
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                      <label htmlFor="sms-name" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 ml-1">
                        Full Name <span className="text-slate-400 font-normal capitalize tracking-normal">(Optional)</span>
                      </label>
                      <input
                        id="sms-name"
                        type="text"
                        placeholder="John Doe"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-5 py-4 rounded-2xl bg-slate-50/50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-500 focus:bg-white transition-all duration-500 text-base"
                      />
                    </div>
                    <div>
                      <label htmlFor="sms-email" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 ml-1">
                        Work Email <span className="text-blue-500">*</span>
                      </label>
                      <input
                        id="sms-email"
                        type="email"
                        required
                        placeholder="john@agency.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-5 py-4 rounded-2xl bg-slate-50/50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-500 focus:bg-white transition-all duration-500 text-base"
                      />
                    </div>

                    <motion.button
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-4 px-8 rounded-2xl transition-all duration-300 flex items-center justify-center gap-3 group shadow-xl shadow-slate-900/10 text-base mt-4"
                    >
                      Get Early Access
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </motion.button>

                    <p className="text-center text-xs text-slate-400 font-medium pt-2">
                      No spam. Unsubscribe at any time.
                    </p>
                  </form>
                </motion.div>
              ) : (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="relative z-10 py-12 text-center flex flex-col items-center justify-center min-h-[350px]"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', bounce: 0.5, delay: 0.2 }}
                    className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-6 border border-green-100 shadow-sm"
                  >
                    <CheckCircle2 className="w-10 h-10 text-green-500" />
                  </motion.div>
                  <h3 className="text-3xl font-bold text-slate-900 mb-4">You&apos;re on the list!</h3>
                  <p className="text-slate-500 text-lg max-w-sm mx-auto">
                    Thanks for your interest. We&apos;ll notify you as soon as we launch SMS for LeadConnector.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* Footer Note */}
      <div className="absolute bottom-4 left-6">
        <p className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold">
          Powered by{' '}
          <a href="https://octendr.com" className="hover:text-slate-900 transition-colors">
            Octendr.com
          </a>
        </p>
      </div>
    </div>
  )
}
