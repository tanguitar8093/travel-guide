import './JapanLoginScene.css'

export function JapanLoginScene() {
  return <svg className="japan-login-scene" viewBox="0 0 400 260" role="img" aria-label="日本可愛藝妓：穿著櫻花和服，拿著摺扇掩嘴微笑">
    <defs>
      <linearGradient id="japan-sky" x2="0" y2="1"><stop stopColor="#f9e8e7" /><stop offset="1" stopColor="#fff7eb" /></linearGradient>
      <clipPath id="japan-frame"><rect width="400" height="260" rx="22" /></clipPath>
    </defs>
    <g clipPath="url(#japan-frame)">
      <path fill="url(#japan-sky)" d="M0 0h400v260H0z" />
      <circle cx="315" cy="58" r="30" fill="#f2b3a4" opacity=".5" />
      <path d="m0 202 77-85 78 85m-25 0 109-103 103 103" fill="#c6d6cb" opacity=".5" />
      <path d="M0 236q100-32 200-9t200-9v42H0Z" fill="#dde7d8" />
      <g fill="none" stroke="#b39383" strokeWidth="5" strokeLinecap="round">
        <path d="M-10 34q57 4 101 47M31 42l9-29m22 49 29-15" />
      </g>
      {[{ x: 24, y: 36 }, { x: 42, y: 18 }, { x: 64, y: 61 }, { x: 91, y: 48 }, { x: 90, y: 80 }].map(({ x, y }) =>
        <g key={x} transform={`translate(${x} ${y})`} fill="#e9b3b9">
          {[0, 72, 144, 216, 288].map(angle => <ellipse key={angle} cy="-5" rx="4" ry="7" transform={`rotate(${angle})`} />)}
          <circle r="2.5" fill="#f5d88c" />
        </g>,
      )}
      <ellipse cx="207" cy="242" rx="75" ry="9" fill="#b0bcae" opacity=".25" />
      <g className="japan-geisha">
        {/* Rounded shimada hairstyle and a small floral hair ornament. */}
        <ellipse cx="200" cy="67" rx="43" ry="28" fill="#3e3b43" />
        <ellipse cx="175" cy="54" rx="22" ry="19" fill="#3e3b43" />
        <ellipse cx="221" cy="49" rx="25" ry="20" fill="#3e3b43" />
        <path d="m166 42 67 4" stroke="#deb77b" strokeWidth="4" strokeLinecap="round" />
        <circle cx="236" cy="48" r="10" fill="#cc7f8c" />
        <circle cx="247" cy="54" r="7" fill="#edb3b9" />
        <circle cx="236" cy="48" r="3" fill="#f7d99d" />
        <path d="M189 116v20h24v-20" fill="#f6d9c5" />
        {/* Soft oversized sleeves, crossed collar and obi. */}
        <path d="M178 130q-24-2-46 22l-16 58 39 13 13-40-5 57h76l-5-57 17 39 36-15-22-57q-15-20-43-20Z" fill="#b9677d" />
        <path d="m181 129 20 29 21-29-12 43h-22Z" fill="#fff2df" />
        <path d="m182 132 20 28 15-24" fill="none" stroke="#e0a3ad" strokeWidth="5" />
        <path d="M165 178h72l1 26h-74Z" fill="#e2bd78" />
        <path d="M165 185h72m-73 12h74" stroke="#f5dca7" strokeWidth="3" />
        <path d="m196 187 8-3 8 3-2 10h-12Z" fill="#a88259" />
        <g fill="#f1c5c8">
          <path d="m145 164 4-6 5 5 7 1-3 6 1 7-7-1-6 3-2-7-5-4Z" />
          <path d="m221 217 4-5 5 4 6 1-3 5 1 6-6-1-5 3-2-6-5-3Z" />
          <circle cx="177" cy="224" r="3" /><circle cx="254" cy="183" r="3" />
        </g>
        <ellipse cx="201" cy="89" rx="36" ry="40" fill="#fff2df" />
        <path d="M165 86q-8-47 34-45 43 0 39 45-20-7-30-29-11 23-43 29Z" fill="#3e3b43" />
        <path d="M176 96q5-7 11 0m28 0q5-7 11 0" fill="none" stroke="#59505a" strokeWidth="2.5" strokeLinecap="round" />
        <ellipse cx="177" cy="106" rx="7" ry="4" fill="#edb0ab" opacity=".7" />
        <ellipse cx="224" cy="106" rx="7" ry="4" fill="#edb0ab" opacity=".7" />
        <path d="M197 115q4 3 8 0" fill="none" stroke="#bd6b78" strokeWidth="2" strokeLinecap="round" />
        <g className="japan-fan">
          {/* The open fan covers her mouth; all ribs meet at her hand. */}
          <path d="M204 157 157 117q45-36 91 0Z" fill="#f2d9b0" stroke="#c49a69" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M157 117q45-36 91 0l-8 8q-37-28-75 0Z" fill="#ce8593" />
          <path d="m204 157-39-32m39 32-24-42m24 42-9-47m9 47 8-47m-8 47 24-42m-24 42 36-32" stroke="#c49a69" strokeWidth="1.3" />
          <path d="m204 157 2 9" stroke="#a67e54" strokeWidth="4" strokeLinecap="round" />
          <ellipse cx="209" cy="164" rx="8" ry="10" fill="#f6d9c5" transform="rotate(-20 209 164)" />
        </g>
      </g>
      <g className="japan-petals" fill="#e9b3b9" opacity=".85">
        <ellipse cx="114" cy="104" rx="4" ry="7" transform="rotate(-25 114 104)" />
        <ellipse cx="307" cy="141" rx="4" ry="7" transform="rotate(32 307 141)" />
        <ellipse cx="331" cy="209" rx="4" ry="7" transform="rotate(-40 331 209)" />
      </g>
    </g>
  </svg>
}
