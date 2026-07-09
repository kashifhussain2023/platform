import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const styles: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-50',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
