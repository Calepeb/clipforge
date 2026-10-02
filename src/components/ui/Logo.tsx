export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 64 64" className="h-7 w-7" aria-hidden>
        <defs>
          <linearGradient id="cf-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff8a4c" />
            <stop offset="1" stopColor="#e2366f" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="url(#cf-logo)" />
        <rect x="21" y="12" width="22" height="40" rx="5" fill="none" stroke="#fff" strokeWidth="4" />
        <path d="M29 25l10 7-10 7z" fill="#fff" />
      </svg>
      <span className="text-[15px] font-bold tracking-tight">
        Clip<span className="bg-gradient-to-r from-accent to-brand-2 bg-clip-text text-transparent">Forge</span>
      </span>
    </div>
  )
}
