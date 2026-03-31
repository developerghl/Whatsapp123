'use client'

import Script from 'next/script'

/**
 * Full-page embedded Octane / LeadConnector form (SMS for LeadConnector nav).
 */
export default function SMSforHighLevelPage() {
  return (
    <>
      <Script
        src="https://links.ghloctane.com/js/form_embed.js"
        strategy="afterInteractive"
      />
      <div className="flex w-full flex-col -mx-4 -mt-2 sm:-mx-6 lg:-mx-8 min-h-[calc(100dvh-5.5rem)]">
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <iframe
            src="https://links.ghloctane.com/widget/form/Q1zTYoreoNcKsRSeZm8V"
            className="w-full flex-1 border-0 rounded-md"
            style={{
              width: '100%',
              height: '100%',
              minHeight: 'min(900px, calc(100dvh - 6rem))',
              border: 'none',
              borderRadius: 3,
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
    </>
  )
}
