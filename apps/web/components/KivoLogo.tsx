export function KivoLogo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="16" fill="#ffffff" />
      <circle cx="32" cy="32" r="8" fill="#0d1117" />
      <path
        d="M32 14 A18 18 0 0 1 50 32"
        stroke="#0d1117"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.5"
      />
      <path
        d="M32 50 A18 18 0 0 1 14 32"
        stroke="#0d1117"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.25"
      />
      <circle cx="50" cy="32" r="3" fill="#0d1117" opacity="0.7" />
    </svg>
  )
}

export function KivoLogoWithWordmark({ size = 40 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <KivoLogo size={size} />
      <span
        style={{
          fontSize: `${size * 0.5}px`,
          fontWeight: 600,
          color: '#e8eaf0',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        Kivo
      </span>
    </div>
  )
}