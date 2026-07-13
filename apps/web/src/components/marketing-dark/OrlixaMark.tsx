import type { CSSProperties } from 'react';

/**
 * Orlixa brand mark (in /public/brand/Orlixa-Logo1-Photoroom.png — background
 * already removed, true alpha transparency). Every place the logo appears
 * renders this ONE file so it's pixel-identical across the whole platform.
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
      src="/brand/Orlixa-Logo1-Photoroom.png"
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
    <img src="/brand/Orlixa-Logo1-Photoroom.png" alt="Orlixa — AI Workforce Platform" style={style} className={className} />
  );
}
