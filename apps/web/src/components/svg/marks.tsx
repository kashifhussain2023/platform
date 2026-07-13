/**
 * Small glyphs & marks: product-surface vignettes (empty-state + product-tour
 * art) and nav glyphs for a future authenticated app-shell left rail.
 * All monoline, 1.5px, currentColor unless a deliberate accent.
 */

/* ── Product-surface vignettes (empty-state + product-tour art) ────────── */
export type Vignette = 'dashboard' | 'analytics' | 'scheduling' | 'team' | 'billing';

export function ProductSurfaceVignette({ kind, className }: { kind: Vignette; className?: string }) {
  return (
    <svg viewBox="0 0 200 140" role="img" aria-label={VIGNETTE_LABEL[kind]} xmlns="http://www.w3.org/2000/svg" className={className} style={{ width: '100%', height: 'auto', fontFamily: 'var(--font-mono)' }}>
      <rect x="1" y="1" width="198" height="138" rx="8" fill="#FFF" stroke="#E5E4DD" />
      <text x="16" y="22" fontSize="9" fill="#8A8B92">{VIGNETTE_LABEL[kind].toUpperCase()}</text>
      {VIGNETTE_GLYPHS[kind]}
    </svg>
  );
}

const VIGNETTE_LABEL: Record<Vignette, string> = {
  dashboard: 'Dashboard',
  analytics: 'Analytics',
  scheduling: 'Scheduling',
  team: 'Team',
  billing: 'Billing',
};

const VIGNETTE_GLYPHS: Record<Vignette, JSX.Element> = {
  dashboard: (
    <g>
      {[40, 66, 92].map((y) => (
        <g key={y}>
          <circle cx="26" cy={y} r="7" fill="none" stroke="#14151A" strokeWidth="1.4" />
          <rect x="42" y={y - 4} width="90" height="8" rx="4" fill="#F4F3EE" />
          <circle cx="176" cy={y} r="3" fill="#34D399" />
        </g>
      ))}
    </g>
  ),
  analytics: (
    <g>
      <line x1="20" y1="40" x2="20" y2="118" stroke="#E5E4DD" />
      <line x1="20" y1="118" x2="184" y2="118" stroke="#E5E4DD" />
      {[[40, 100], [70, 88], [100, 96], [130, 70], [160, 54]].map(([x, h], i) => (
        <rect key={i} x={x} y={h} width="14" height={118 - h} fill="#EEF2FF" />
      ))}
      <polyline points="47,100 77,88 107,96 137,70 167,54" fill="none" stroke="#4F46E5" strokeWidth="1.6" />
    </g>
  ),
  scheduling: (
    <g>
      <g stroke="#E5E4DD">
        <line x1="20" y1="46" x2="180" y2="46" /><line x1="20" y1="76" x2="180" y2="76" /><line x1="20" y1="106" x2="180" y2="106" />
        <line x1="60" y1="34" x2="60" y2="120" /><line x1="100" y1="34" x2="100" y2="120" /><line x1="140" y1="34" x2="140" y2="120" />
      </g>
      <rect x="104" y="80" width="32" height="22" rx="4" fill="#6EE7B7" />
    </g>
  ),
  team: (
    <g>
      {[[34, 56], [72, 56], [110, 56]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="10" fill="none" stroke="#14151A" strokeWidth="1.4" />
          <circle cx={x} cy={y - 2} r="3.5" fill="none" stroke="#14151A" strokeWidth="1.2" />
        </g>
      ))}
      <rect x="26" y="92" width="90" height="16" rx="8" fill="#EEF2FF" />
      <text x="34" y="104" fontSize="8" fill="#4F46E5">OWNER · ADMIN</text>
    </g>
  ),
  billing: (
    <g>
      <rect x="40" y="34" width="120" height="86" rx="4" fill="#FFF" stroke="#E5E4DD" />
      <path d="M52 52h96M52 66h96M52 80h60" stroke="#E5E4DD" strokeWidth="1.4" />
      <path d="M52 100h96" stroke="#FF9A62" strokeWidth="1.6" />
      <text x="104" y="112" fontSize="9" fill="#F97316" textAnchor="end">$1,240.00</text>
    </g>
  ),
};

/* ── Nav glyphs for the authenticated app shell left rail ──────────────── */
export type NavGlyphName =
  | 'employees' | 'skills' | 'workflows' | 'scheduling' | 'approvals'
  | 'knowledge' | 'marketplace' | 'analytics' | 'billing' | 'team' | 'dashboard';

export function NavGlyph({ name, className }: { name: NavGlyphName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className={className}
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {NAV_GLYPHS[name]}
    </svg>
  );
}

const NAV_GLYPHS: Record<NavGlyphName, JSX.Element> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="11" width="7" height="10" rx="1" /><rect x="3" y="15" width="7" height="6" rx="1" /></>,
  employees: <><circle cx="9" cy="8" r="3" /><path d="M4 20c0-3 10-3 10 0" /><circle cx="17" cy="9" r="2.2" /><path d="M15 20c0-2.5 6-2.5 6 0" /></>,
  skills: <><circle cx="6" cy="12" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><path d="M8.2 11 16 7M8.2 13 16 17" /></>,
  workflows: <><rect x="3" y="9" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 12h3M12 12V6h3M12 12v6h3" /></>,
  scheduling: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><rect x="14" y="13" width="4" height="4" rx="1" fill="currentColor" stroke="none" /></>,
  approvals: <><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 11l2 2 4-4" /></>,
  knowledge: <><path d="M4 5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2z" /><path d="M20 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2z" /></>,
  marketplace: <><path d="M4 9h16l-1 11H5z" /><path d="M8 9V6a4 4 0 0 1 8 0v3" /></>,
  analytics: <><path d="M4 20V4M4 20h16" /><path d="M8 16l3-4 3 2 4-6" /></>,
  billing: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>,
  team: <><circle cx="8" cy="8" r="2.6" /><circle cx="16" cy="8" r="2.6" /><path d="M3 19c0-3.5 10-3.5 10 0M13 19c0-3 8-3 8 0" /></>,
};
