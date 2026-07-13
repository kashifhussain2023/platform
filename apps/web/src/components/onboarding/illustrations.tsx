/**
 * Onboarding side-panel illustrations — inline SVG, no external assets.
 * Same technique as the auth Starfield/FaceMesh: deterministic hardcoded
 * points + radial-gradient glow (no blur filters, no 3D/WebGL, SSR-safe).
 */

const STAR_DOTS: [number, number][] = [
  [8, 10], [22, 6], [36, 16], [14, 28], [30, 34], [6, 46], [24, 52], [40, 60],
  [10, 70], [28, 82], [18, 90], [38, 8], [4, 58], [34, 94], [16, 4],
];

function Stars() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
      {STAR_DOTS.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 0.5 : 0.28} fill="#fff" opacity={i % 3 === 0 ? 0.55 : 0.28} />
      ))}
    </svg>
  );
}

function GlowBackdrop() {
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-violet/25 blur-[110px]" />
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-[280px] w-full bg-[linear-gradient(180deg,transparent,rgba(3,4,8,0.9))]" />
      <Stars />
    </>
  );
}

/** Step 1 — a portal ring pierced by an ascending arrow, over a glowing grid floor. */
export function LaunchIllustration() {
  return (
    <div className="absolute inset-0 bg-[#050510]">
      <GlowBackdrop />
      <svg aria-hidden className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" viewBox="0 0 100 160">
        {/* perspective grid floor */}
        <g opacity={0.35} stroke="#6D3FE0" strokeWidth={0.3}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <line key={`h${i}`} x1={10 + i * 2} y1={118 + i * 7} x2={90 - i * 2} y2={118 + i * 7} />
          ))}
          {[-3, -2, -1, 0, 1, 2, 3].map((i) => (
            <line key={`v${i}`} x1={50 + i * 6} y1={118} x2={50 + i * 13} y2={153} />
          ))}
        </g>
        <ellipse cx={50} cy={122} rx={16} ry={4} fill="#7C3AED" opacity={0.5} />
        <rect x={41} y={95} width={18} height={2} fill="url(#beam)" opacity={0.9} />
        <defs>
          <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        {/* ring */}
        <circle cx={50} cy={70} r={22} fill="none" stroke="#F4F1FF" strokeWidth={5} strokeDasharray="120 40" transform="rotate(-18 50 70)" opacity={0.92} />
        {/* arrow piercing the ring */}
        <polygon points="20,92 78,48 78,58 34,98" fill="url(#arrowFill)" />
        <polygon points="78,48 90,44 84,58 78,58" fill="url(#arrowFill)" />
        <defs>
          <linearGradient id="arrowFill" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#4C1FCB" />
            <stop offset="100%" stopColor="#9B7BF5" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

/** Step 2 — a violet-lit low-poly skyline (departments = the org you're building). */
export function SkylineIllustration() {
  const bldgs = [
    { x: 4, w: 10, h: 46 }, { x: 15, w: 8, h: 62 }, { x: 24, w: 12, h: 38 },
    { x: 37, w: 7, h: 80 }, { x: 45, w: 10, h: 54 }, { x: 56, w: 8, h: 68 },
    { x: 65, w: 13, h: 42 }, { x: 79, w: 9, h: 58 }, { x: 89, w: 10, h: 34 },
  ];
  return (
    <div className="absolute inset-0 bg-[#050510]">
      <GlowBackdrop />
      <svg aria-hidden className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMax slice" viewBox="0 0 100 100">
        {bldgs.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={100 - b.h} width={b.w} height={b.h} fill={i % 2 === 0 ? '#160B33' : '#1E1040'} stroke="#6D3FE0" strokeOpacity={0.4} strokeWidth={0.3} />
            {Array.from({ length: Math.floor(b.h / 8) }).map((_, r) => (
              <rect key={r} x={b.x + b.w * 0.2} y={100 - b.h + 6 + r * 8} width={b.w * 0.18} height={2.2} fill="#B79CFF" opacity={(i + r) % 3 === 0 ? 0.85 : 0.35} />
            ))}
          </g>
        ))}
        <polygon points="37,20 40,32 34,32" fill="#F4F1FF" opacity={0.85} />
      </svg>
    </div>
  );
}

/** Step 3 — a drifting astronaut beside a crescent planet (the crew you're hiring). */
export function AstronautIllustration() {
  return (
    <div className="absolute inset-0 bg-[#050510]">
      <GlowBackdrop />
      <svg aria-hidden className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 100 160">
        {/* crescent planet */}
        <circle cx={-6} cy={80} r={46} fill="#1B0E42" stroke="#6D3FE0" strokeOpacity={0.6} strokeWidth={0.6} />
        <circle cx={-2} cy={80} r={46} fill="#050510" />
        {/* astronaut */}
        <g transform="translate(55 70) rotate(-8)">
          {/* backpack */}
          <rect x={-9} y={2} width={12} height={20} rx={3} fill="#241650" />
          {/* body */}
          <rect x={-11} y={-2} width={22} height={30} rx={9} fill="#E9E4FB" opacity={0.92} />
          {/* helmet */}
          <circle cx={0} cy={-16} r={13} fill="#EDE9FB" />
          <circle cx={1} cy={-16} r={9.5} fill="#1B0E33" />
          <circle cx={-2} cy={-19} r={3} fill="#B79CFF" opacity={0.7} />
          {/* arms */}
          <path d="M -11 6 Q -22 2 -20 -8" stroke="#E9E4FB" strokeWidth={5} strokeLinecap="round" fill="none" />
          <path d="M 11 10 Q 20 16 16 26" stroke="#E9E4FB" strokeWidth={5} strokeLinecap="round" fill="none" />
          {/* legs */}
          <path d="M -6 27 Q -9 40 -4 48" stroke="#E9E4FB" strokeWidth={6} strokeLinecap="round" fill="none" />
          <path d="M 6 27 Q 10 38 6 47" stroke="#E9E4FB" strokeWidth={6} strokeLinecap="round" fill="none" />
        </g>
      </svg>
    </div>
  );
}
