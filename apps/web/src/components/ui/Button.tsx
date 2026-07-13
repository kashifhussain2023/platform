import type { ButtonHTMLAttributes } from 'react';

/**
 * Button — V-AEP "Workforce Ledger" variants.
 *  - primary : solid indigo (app default; backward compatible)
 *  - cta     : g-cta gradient fill + shadow (marketing primary)
 *  - hire    : WARM apricot fill — reserved ONLY for "Hire" actions + the
 *              /register submit (a hire moment). Do not use elsewhere; warmth
 *              is the signal that a human decision is happening.
 *  - ghost   : hairline border, subtle
 *  - link    : indigo text with an animated underline wipe
 *  - violet  : brand violet fill + purple glow (dark surfaces, e.g. auth)
 */
type Variant = 'primary' | 'cta' | 'hire' | 'ghost' | 'link' | 'violet';
type Size = 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 ease-swiss disabled:cursor-not-allowed';

const sizes: Record<Size, string> = {
  md: 'rounded-btn px-4 py-2 text-sm',
  lg: 'rounded-btn px-6 py-3 text-base',
};

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  cta: 'bg-g-cta text-white shadow-cta hover:-translate-y-0.5 hover:shadow-lift disabled:opacity-60',
  hire: 'bg-warm-400 text-white shadow-warm hover:bg-warm-500 hover:-translate-y-0.5 disabled:opacity-60',
  ghost:
    'border border-line text-ink hover:border-line-strong hover:bg-paper-2 disabled:opacity-50',
  link: 'link-wipe px-0 py-0 text-brand-600 hover:text-brand-700',
  violet:
    'bg-violet text-white shadow-[0_0_24px_-6px_rgba(94,60,232,0.65)] hover:bg-violet-hover hover:shadow-[0_0_32px_-4px_rgba(94,60,232,0.9)] hover:-translate-y-0.5 disabled:opacity-60',
};

/** Class string for the variant — use on <Link> or <a> that should look like a button. */
export function buttonClasses(variant: Variant = 'primary', size: Size = 'md'): string {
  return `${base} ${variant === 'link' ? '' : sizes[size]} ${variants[variant]}`;
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button className={`${buttonClasses(variant, size)} ${className}`} {...props} />;
}
