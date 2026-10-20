import './TourGuideAnimation.css'

export function TourGuideAnimation() {
  return (
    <svg className="tour-guide" viewBox="0 0 200 160" aria-hidden="true">
      <ellipse cx="96" cy="143" rx="42" ry="5" fill="#dce7dc" />
      <path className="tour-guide-trail" d="M35 143h16m99 0h15" />
      <g className="tour-guide-walk">
        <g className="tour-guide-leg tour-guide-leg-back">
          <path d="M94 99l-9 23-13 14" />
          <path className="tour-guide-shoe" d="M72 136l-8 2" />
        </g>
        <g className="tour-guide-leg tour-guide-leg-front">
          <path d="M94 99l10 22 11 15" />
          <path className="tour-guide-shoe" d="M115 136h9" />
        </g>
        <path d="M79 70q-14 0-14 17v14h13V79" fill="#d7b16c" />
        <path d="M91 69q-11 0-12 13l-2 24h29l-3-24q-1-13-12-13" fill="#648a74" />
        <path className="tour-guide-arm" d="M84 80l-9 16-10 5" />
        <path className="tour-guide-arm" d="M100 80l13 11 17-11" />
        <path className="tour-guide-pole" d="M130 109V26" />
        <path className="tour-guide-flag" d="M131 27q14-8 31 0l-5 12 5 11q-17-8-31 0Z" fill="#e7b64d" />
        <circle cx="92" cy="53" r="14" fill="#edc6a0" />
        <path d="M77 49q0-18 15-18t15 18Z" fill="#648a74" />
        <path d="M73 49h39" stroke="#456951" strokeWidth="5" strokeLinecap="round" />
        <circle cx="100" cy="55" r="1.6" fill="#465447" />
        <path d="M96 62q3 2 6-1" fill="none" stroke="#a77959" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  )
}
