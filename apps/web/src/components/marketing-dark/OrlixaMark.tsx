import type { CSSProperties } from 'react';

/**
 * Orlixa brand mark — SVG assets in /public (dark-bg variants: every
 * consumer renders on a dark/void surface). Every place the logo appears
 * renders one of these two files so it stays pixel-identical across the platform.
 * `object-fit: contain` + one fixed dimension keeps the native aspect ratio.
 */

const base: CSSProperties = {
  display: 'block',
  objectFit: 'contain',
};

/** The mark, small (nav, footer, video corner). */
export function OrlixaMark({ className = '', size = 34 }: { className?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/orlixa-mark-dark.svg"
      alt="Orlixa"
      style={{ ...base, height: size, width: 'auto' }}
      className={className}
    />
  );
}

/**
 * The same mark, large (auth/onboarding shells, demo intro+outro). Pass ONE
 * of `height` or `width`; the other stays `auto` so the native aspect is kept.
 */
export function OrlixaLockup({
  className = '',
  width,
  height,
}: {
  className?: string;
  width?: number;
  height?: number;
}) {
  const style: CSSProperties =
    height != null
      ? { ...base, height, width: 'auto' }
      : { ...base, width: width ?? 280, height: 'auto' };
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/orlixa-logo-horizontal-dark.svg" alt="Orlixa — AI Workforce Platform" style={style} className={className} />
  );
}
