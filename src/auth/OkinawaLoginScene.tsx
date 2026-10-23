import './OkinawaLoginScene.css'

export function OkinawaLoginScene() {
  return (
    <svg className="okinawa-login-scene" viewBox="0 0 400 260" role="img" aria-label="沖繩海島風景：陽光、碧海、沙灘、赤瓦屋與扶桑花">
      <defs>
        <linearGradient id="okinawa-sky" x2="0" y2="1">
          <stop stopColor="#bce7ed" /><stop offset="1" stopColor="#f0f8e9" />
        </linearGradient>
        <linearGradient id="okinawa-sea" x2="0" y2="1">
          <stop stopColor="#409fb0" /><stop offset="1" stopColor="#a1dfd4" />
        </linearGradient>
        <clipPath id="okinawa-frame"><rect width="400" height="260" rx="22" /></clipPath>
      </defs>
      <g clipPath="url(#okinawa-frame)">
        <path fill="url(#okinawa-sky)" d="M0 0h400v260H0z" />
        <g className="okinawa-sun">
          <circle cx="310" cy="55" r="33" fill="#fff0b4" opacity=".5" />
          <circle cx="310" cy="55" r="22" fill="#f6cb6b" />
        </g>
        <g className="okinawa-clouds" fill="#fff" opacity=".8">
          <path d="M35 60q0-12 15-12 5-17 23-8 16-5 21 10 15 0 15 10z" />
          <path d="M170 36q0-9 12-9 5-13 18-6 14-5 18 8 12 0 12 7z" />
        </g>
        <path d="M0 125q45-31 85-13 25-29 62-7 26-15 58 20z" fill="#7daa86" />
        <path d="M0 126h400v134H0z" fill="url(#okinawa-sea)" />
        <g className="okinawa-waves" fill="none" stroke="#e7fbef" strokeWidth="3" strokeLinecap="round">
          <path d="M220 144q20 5 40 0m35 10q22 5 44 0M35 148q18 4 36 0" />
          <path d="M115 171q25 5 50 0m70 8q17 5 34 0m-225 3q17 5 34 0" />
        </g>
        <path d="M0 223q85-35 163-15t237-13v65H0z" fill="#f5e7bf" />
        <path className="okinawa-shore" d="M0 215q85-35 163-15t237-13" fill="none" stroke="#fffaf0" strokeWidth="7" opacity=".8" />
        <g transform="translate(53 133)">
          <path d="M0 37q39-10 83 0v10H0z" fill="#8da784" />
          <path d="M12 0h58v36H12z" fill="#fff1d4" />
          <path d="M4 2 21-20h40L79 2z" fill="#bd7353" />
          <path d="M10-1h63M15-7h52M20-13h41" stroke="#e29a71" strokeWidth="3" strokeLinecap="round" />
          <path d="M35 12h13v24H35z" fill="#7b6d54" />
          <path d="M18 11h10v12H18zm37 0h10v12H55z" fill="#91bdba" />
          <path d="M3 36h77" stroke="#c9b68d" strokeWidth="4" />
        </g>
        <g className="okinawa-palm">
          <path d="M340 242q-24-47-16-99" fill="none" stroke="#a18b5e" strokeWidth="9" />
          <path d="M325 147q-34-35-62-17 35-2 62 17m0 0q-7-44 18-50-15 24-18 50m0 0q28-36 59-16-29-3-59 16m0 0q-40-7-51 18 26-15 51-18m0 0q30 0 42 28-20-18-42-28" fill="#648e68" />
        </g>
        <g transform="translate(37 229)">
          <path d="M-20 10q0-26 23-17-10 13-23 17m23-17q19-21 31 0-17 10-31 0" fill="#73946b" />
          <g className="okinawa-flower" fill="#df8779">
            <ellipse cy="-10" rx="10" ry="14" />
            <ellipse cy="-10" rx="10" ry="14" transform="rotate(72)" />
            <ellipse cy="-10" rx="10" ry="14" transform="rotate(144)" />
            <ellipse cy="-10" rx="10" ry="14" transform="rotate(216)" />
            <ellipse cy="-10" rx="10" ry="14" transform="rotate(288)" />
            <path d="m0 0 13-14" stroke="#f6d27b" strokeWidth="3" strokeLinecap="round" />
            <circle cx="13" cy="-14" r="3" fill="#f6d27b" />
          </g>
        </g>
      </g>
    </svg>
  )
}
