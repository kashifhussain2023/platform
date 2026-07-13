/** Decorative auth illustrations (inline SVG, violet theme). */

/** Envelope with a check badge — email verification. */
export function EnvelopeCheck({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="Verify your email" xmlns="http://www.w3.org/2000/svg" style={{ width: 120, height: 120 }}>
      <circle cx="60" cy="60" r="52" fill="rgba(124,58,237,0.12)" stroke="rgba(139,110,242,0.35)" strokeWidth="1.5" />
      <rect x="34" y="42" width="52" height="38" rx="7" fill="none" stroke="#A78BFA" strokeWidth="2.5" />
      <path d="M36 46 L60 64 L84 46" fill="none" stroke="#A78BFA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="84" cy="78" r="15" fill="#6a30ec" />
      <path d="M77 78 l5 5 9 -10" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Padlock with a red alert badge — account locked. */
export function LockBadge({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="Account locked" xmlns="http://www.w3.org/2000/svg" style={{ width: 120, height: 120 }}>
      <circle cx="60" cy="60" r="52" fill="rgba(124,58,237,0.12)" stroke="rgba(139,110,242,0.35)" strokeWidth="1.5" />
      <path d="M44 58 v-8 a16 16 0 0 1 32 0 v8" fill="none" stroke="#A78BFA" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="38" y="58" width="44" height="34" rx="8" fill="rgba(139,110,242,0.18)" stroke="#A78BFA" strokeWidth="2.6" />
      <circle cx="60" cy="73" r="4.5" fill="#C4B5FD" />
      <rect x="57.5" y="75" width="5" height="10" rx="2.5" fill="#C4B5FD" />
      <circle cx="90" cy="34" r="13" fill="#F43F5E" />
      <path d="M90 28 v7 M90 40 v0.5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** Paper plane with a dotted trail — forgot password. */
export function PaperPlane({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 120" className={className} role="img" aria-hidden xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 'auto' }}>
      <path d="M20 96 C 50 100, 60 70, 92 66" fill="none" stroke="#6a30ec" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 6" opacity="0.6" />
      <path d="M150 30 L118 96 L110 70 L86 60 Z" fill="#7C5CF0" />
      <path d="M150 30 L110 70 L118 96 Z" fill="#5216dd" />
      <path d="M150 30 L110 70" stroke="#C4B5FD" strokeWidth="1" opacity="0.6" />
      <circle cx="170" cy="20" r="1.6" fill="#C4B5FD" />
      <circle cx="182" cy="40" r="1.2" fill="#8B6EF2" />
    </svg>
  );
}
