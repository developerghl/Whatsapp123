'use client'

import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Check, MessageSquare } from 'lucide-react'
import Script from 'next/script'

function BackgroundBubbles({ mouseX, mouseY }: { mouseX: number; mouseY: number }) {
  const normX = mouseX
  const normY = mouseY

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
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
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = ((e.clientY - rect.top) / rect.height) * 2 - 1
    setMousePos({ x, y })
  }

  return (
    <>
      <Script
        src="https://links.ghloctane.com/js/form_embed.js"
        strategy="afterInteractive"
      />
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        className="relative w-full min-h-full flex items-center justify-center overflow-hidden rounded-2xl"
        style={{ background: '#fafafa', padding: '3rem 1.5rem' }}
      >
        <BackgroundBubbles mouseX={mousePos.x} mouseY={mousePos.y} />

        <div className="relative z-10 w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start lg:items-center">
          {/* LEFT: same Coming Soon marketing */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="flex flex-col justify-center"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-600 text-[11px] font-semibold uppercase tracking-widest mb-8 shadow-sm w-fit">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              Coming Soon
            </div>

            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 mb-6 leading-tight">
              Smarter SMS for your agency.
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                Every subaccount, one workflow.
              </span>
            </h1>

            <p className="text-base lg:text-lg text-slate-500 mb-10 leading-relaxed font-medium">
              Automate conversations across your agency and subaccounts, lift response rates, and scale workflows without extra overhead.
            </p>

            <div className="space-y-4">
              {[
                'Agency-wide visibility, per-subaccount control',
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

          {/* RIGHT: copy block → Octane embed */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
            className="w-full"
          >
            <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.08)] border border-slate-200/80 relative overflow-hidden flex flex-col">
              <div className="px-6 pt-8 pb-2 sm:px-8 sm:pt-10 sm:pb-0">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mb-3">
                  Get Early Access
                </h2>
                <h3 className="text-base sm:text-lg font-semibold text-slate-800 mb-2">
                  Join the waitlist for agency SMS on Octendr
                </h3>
                <p className="text-sm sm:text-[15px] text-slate-500 leading-relaxed max-w-md">
                  Tell us how to reach you—we&apos;ll notify you when SMS automation is available for your agency and subaccounts. No spam; you can unsubscribe anytime.
                </p>
              </div>

              <div className="px-4 pb-6 pt-6 sm:px-6 sm:pb-8 sm:pt-8">
                <div
                  className="rounded-2xl border border-slate-200/90 bg-gradient-to-b from-slate-50/90 to-white overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.95), 0 1px 2px rgba(15,23,42,0.04)' }}
                >
                  <div className="w-full flex flex-col">
                    <iframe
                      src="https://links.ghloctane.com/widget/form/Q1zTYoreoNcKsRSeZm8V"
                      className="w-full border-0 block"
                      style={{
                        width: '100%',
                        minHeight: 412,
                        height: 'clamp(412px, 52vh, 540px)',
                        border: 'none',
                        borderRadius: 0,
                      }}
                      id="inline-Q1zTYoreoNcKsRSeZm8V"
                      data-layout="{'id':'INLINE'}"
                      data-trigger-type="alwaysShow"
                      data-trigger-value=""
                      data-activation-type="alwaysActivated"
                      data-activation-value=""
                      data-deactivation-type="neverDeactivate"
                      data-deactivation-value=""
                      data-form-name="Form 4"
                      data-height="412"
                      data-layout-iframe-id="inline-Q1zTYoreoNcKsRSeZm8V"
                      data-form-id="Q1zTYoreoNcKsRSeZm8V"
                      title="Form 4"
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="absolute bottom-4 left-6">
          <p className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold">
            Powered by{' '}
            <a href="https://octendr.com" className="hover:text-slate-900 transition-colors">
              Octendr.com
            </a>
          </p>
        </div>
      </div>
    </>
  )
}
