'use client';

import { useEffect } from 'react';

/**
 * Adds `nomo` to <html> when the URL carries ?nomo — forces scroll-reveal
 * elements to their final visible state. Used for deterministic screenshots
 * and as a manual "reduce motion" escape hatch. Renders nothing.
 */
export function MotionFlag() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('nomo')) {
      document.documentElement.classList.add('nomo');
    }
  }, []);
  return null;
}
