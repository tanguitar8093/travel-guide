import './TaiwanLoginScene.css'

const dancers = [
  { x: 57, y: 163, color: '#bc6557', delay: '-.2s' },
  { x: 104, y: 176, color: '#567b83', delay: '-.4s' },
  { x: 151, y: 184, color: '#bf6d59', delay: '-.6s' },
  { x: 198, y: 188, color: '#567b83', delay: '-.8s' },
  { x: 245, y: 184, color: '#bf6d59', delay: '-1s' },
  { x: 292, y: 176, color: '#567b83', delay: '-1.2s' },
  { x: 339, y: 163, color: '#bc6557', delay: '-1.4s' },
]

export function TaiwanLoginScene() {
  return <svg className="taiwan-login-scene" viewBox="0 0 400 260" role="img" aria-label="台灣原住民豐年祭：山景前，穿著織紋節慶服飾的人們牽手跳舞">
    <defs>
      <linearGradient id="taiwan-sky" x2="0" y2="1"><stop stopColor="#bce7ed" /><stop offset="1" stopColor="#f0f8e9" /></linearGradient>
      <clipPath id="taiwan-frame"><rect width="400" height="260" rx="22" /></clipPath>
    </defs>
    <g clipPath="url(#taiwan-frame)">
      <path fill="url(#taiwan-sky)" d="M0 0h400v260H0z" />
      <circle cx="310" cy="52" r="32" fill="#fff0b4" opacity=".5" />
      <circle cx="310" cy="52" r="21" fill="#f6cb6b" />
      <g className="taiwan-clouds" fill="#fff" opacity=".8">
        <path d="M28 53q0-12 15-12 5-17 23-8 16-5 21 10 15 0 15 10z" />
        <path d="M174 34q0-9 12-9 5-13 18-6 14-5 18 8 12 0 12 7z" />
      </g>
      <path d="M-20 153 61 65q9-9 17 2l44 48 52-66q10-10 20 2l77 88 41-52q8-10 18 2l89 70z" fill="#91b9ac" />
      <path d="m-20 158 92-50 53 39 80-64 72 65 58-28 80 41v99H0z" fill="#73998a" />
      <path d="M0 163q95-22 200-5t200-4v106H0z" fill="#bbcca0" />
      <ellipse cx="200" cy="207" rx="177" ry="39" fill="#e9dcb6" />
      <ellipse cx="200" cy="204" rx="143" ry="26" fill="none" stroke="#f5eacb" strokeWidth="3" />
      {dancers.map(({ x, y, color, delay }, index) => <g key={x} transform={`translate(${x} ${y})`}>
        <ellipse cy="29" rx="16" ry="4" fill="#a39e78" opacity=".25" />
        <g className="taiwan-festival-dancer" style={{ animationDelay: delay }}>
          <path d="m-7 12-4 15m17-15 6 15" fill="none" stroke="#9c6f51" strokeWidth="6" strokeLinecap="round" />
          <path d="m-14 28 7 0m15 0h7" stroke="#655f51" strokeWidth="4" strokeLinecap="round" />
          <path d={`M-10-17q-8 8-14 ${index < 3 ? 7 : 0}m34-7q8 8 14 ${index > 3 ? 7 : 0}`} fill="none" stroke="#b98260" strokeWidth="6" strokeLinecap="round" />
          <path d="M-10-19h20l5 34h-30z" fill={color} />
          <path d="M-8-18v20M8-18v20M-13 8h26" stroke="#f5e7bf" strokeWidth="3" />
          <path d="m-8 7 4-4 4 4 4-4 4 4M-12 13h24" fill="none" stroke="#e6bd70" strokeWidth="2" />
          <path d="M-5-24v6h10v-6" fill="#b98260" />
          <path d="M-12-37q0-15 12-15t12 15v12h-24z" fill="#514c43" />
          <ellipse cy="-35" rx="10" ry="12" fill="#c8916b" />
          <path d="M-11-39q10-10 22 0v-6q-12-10-22 0z" fill="#514c43" />
          <path d="M-11-43h22" stroke={color} strokeWidth="5" />
          <path d="m-8-43 4-2 4 2 4-2 4 2" fill="none" stroke="#f5e7bf" strokeWidth="1.5" />
          <path d="M-5-31q5 5 10 0" fill="none" stroke="#845c49" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="-4" cy="-36" r="1" fill="#514c43" /><circle cx="4" cy="-36" r="1" fill="#514c43" />
        </g>
      </g>)}
      <g fill="none" stroke="#73946b" strokeWidth="3" strokeLinecap="round">
        <path d="M12 251q4-20-5-30m5 30q0-14 13-20M376 251q0-23 13-32m-13 32q-2-13-12-18" />
      </g>
      <g fill="#e8c983"><ellipse cx="7" cy="220" rx="3" ry="8" transform="rotate(-20 7 220)" /><ellipse cx="389" cy="218" rx="3" ry="8" transform="rotate(24 389 218)" /></g>
    </g>
  </svg>
}
