'use client';

import { useMemo } from 'react';

/* ------------------------------------------------------------------ *
 * V-AEP Neural Face Profile — inline-SVG low-poly portrait.
 * No external assets, no WebGL, no blur filters (headless/--disable-gpu
 * safe). Deterministic (seeded mulberry32) → SSR-safe + screenshot-stable.
 * Recipe from the vaep-face-mesh-design workflow (Approach A backbone +
 * grafted nose/lip/chin coords, Poisson interior, filter-free glow).
 * ------------------------------------------------------------------ */

type P = [number, number];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* LEFT-FACING profile (normalized, y-down). Nose tip (12) = global x-min;
 * back of head (34) = global x-max; shoulders (27,28) exit the bottom. */
const PROFILE: P[] = [
  [0.5, 0.06], [0.42, 0.074], [0.36, 0.11], [0.325, 0.17], [0.305, 0.23],
  [0.3, 0.28], [0.316, 0.312], [0.294, 0.335], [0.3, 0.365], [0.275, 0.4],
  [0.235, 0.435], [0.19, 0.468], [0.155, 0.495], // 12 NOSE TIP
  [0.198, 0.506], [0.246, 0.516], [0.234, 0.536], [0.214, 0.551], [0.236, 0.566],
  [0.223, 0.586], [0.246, 0.61], [0.234, 0.635], [0.256, 0.662], // 21 CHIN TIP
  [0.3, 0.696], [0.372, 0.722], [0.42, 0.752], [0.44, 0.822], [0.454, 0.9],
  [0.47, 1.01], [0.76, 1.01], // shoulders exit bottom
  [0.702, 0.862], [0.686, 0.782], [0.702, 0.7], [0.752, 0.62], [0.8, 0.52],
  [0.83, 0.42], // 34 BACK OF HEAD (x-max)
  [0.824, 0.32], [0.78, 0.22], [0.71, 0.13], [0.62, 0.078],
];
const FEATURES: P[] = [
  [0.325, 0.3], // eye / brow
  [0.205, 0.46], // nose
  [0.24, 0.55], // lips
  [0.255, 0.64], // chin
];

/* head occupies the left ~62%; right third stays empty for particles */
const HX0 = 0.06, HX1 = 0.72, HY0 = 0.02, HY1 = 1.0;

function inPoly(x: number, y: number, poly: P[]) {
  let o = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o;
  }
  return o;
}
function distToPoly(x: number, y: number, poly: P[]) {
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const t = clamp(((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    m = Math.min(m, Math.hypot(x - (xi + t * dx), y - (yi + t * dy)));
  }
  return m;
}

type Tri = { a: number; b: number; c: number };
function delaunay(pts: P[]): Tri[] {
  const n = pts.length;
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const [x, y] of pts) {
    mnx = Math.min(mnx, x); mny = Math.min(mny, y);
    mxx = Math.max(mxx, x); mxy = Math.max(mxy, y);
  }
  const d = Math.max(mxx - mnx, mxy - mny) * 10;
  const mx = (mnx + mxx) / 2, my = (mny + mxy) / 2;
  const q = pts.slice();
  const s0 = n, s1 = n + 1, s2 = n + 2;
  q.push([mx - 2 * d, my - d], [mx, my + 2 * d], [mx + 2 * d, my - d]);
  let tris: Tri[] = [{ a: s0, b: s1, c: s2 }];
  const circ = (t: Tri) => {
    const [ax, ay] = q[t.a];
    const [bx, by] = q[t.b];
    const [cx, cy] = q[t.c];
    const dd = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-9;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / dd;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / dd;
    return { ux, uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  for (let i = 0; i < n; i++) {
    const [px, py] = q[i];
    const bad: Tri[] = [];
    for (const t of tris) {
      const c = circ(t);
      if ((px - c.ux) ** 2 + (py - c.uy) ** 2 < c.r2) bad.push(t);
    }
    const edges: [number, number][] = [];
    for (const t of bad)
      for (const e of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
        const shared = bad.some(
          (o) => o !== t && [o.a, o.b, o.c].includes(e[0]) && [o.a, o.b, o.c].includes(e[1]),
        );
        if (!shared) edges.push(e);
      }
    tris = tris.filter((t) => !bad.includes(t));
    for (const [u, v] of edges) tris.push({ a: u, b: v, c: i });
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n);
}

function buildMesh(W: number, H: number) {
  const place = (nx: number, ny: number): P => [
    (HX0 + (HX1 - HX0) * nx) * W,
    (HY0 + (HY1 - HY0) * ny) * H,
  ];
  const poly = PROFILE.map((p) => place(p[0], p[1]));
  const feats = FEATURES.map((f) => place(f[0], f[1]));
  const focus = place(0.32, 0.4);
  const rng = mulberry32(20260711);

  const R_MIN = 13, R_MAX = 34, MAX_EDGE = 54;
  const minFeat = (x: number, y: number) => {
    let m = Infinity;
    for (const f of feats) m = Math.min(m, Math.hypot(x - f[0], y - f[1]));
    return m;
  };
  const radiusAt = (x: number, y: number) => R_MIN + (R_MAX - R_MIN) * clamp(minFeat(x, y) / (0.42 * W), 0, 1);

  // contour vertices (outline seeded into the mesh)
  const contour: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const L = dist(a, b);
    const step = radiusAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) * 0.72;
    const n = Math.max(1, Math.round(L / step));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      contour.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  const cN = contour.length;

  // interior: variable-radius Bridson Poisson-disk, seeded at the face focus
  const cell = R_MIN / Math.SQRT2;
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
  const grid: number[] = new Array(gw * gh).fill(-1);
  const gi = (x: number, y: number) => Math.floor(y / cell) * gw + Math.floor(x / cell);
  const interior: P[] = [];
  const fits = (x: number, y: number) => {
    if (!inPoly(x, y, poly)) return false;
    if (distToPoly(x, y, poly) < 0.55 * R_MIN) return false;
    const r = radiusAt(x, y);
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const span = Math.ceil(R_MAX / cell) + 1;
    for (let yy = -span; yy <= span; yy++)
      for (let xx = -span; xx <= span; xx++) {
        const nx = cx + xx, ny = cy + yy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const idx = grid[ny * gw + nx];
        if (idx >= 0) {
          const qq = interior[idx];
          if (Math.hypot(qq[0] - x, qq[1] - y) < Math.min(r, radiusAt(qq[0], qq[1]))) return false;
        }
      }
    return true;
  };
  const active: number[] = [];
  let seed: P | null = null;
  for (let i = 0; i < 200 && !seed; i++) {
    const s: P = [focus[0] + (rng() - 0.5) * 60, focus[1] + (rng() - 0.5) * 60];
    if (inPoly(s[0], s[1], poly)) seed = s;
  }
  if (seed) {
    interior.push(seed);
    grid[gi(seed[0], seed[1])] = 0;
    active.push(0);
  }
  while (active.length) {
    const ai = (rng() * active.length) | 0;
    const p = interior[active[ai]];
    const r = radiusAt(p[0], p[1]);
    let placed = false;
    for (let k = 0; k < 14; k++) {
      const ang = rng() * 6.2832;
      const rr = r * (1 + rng());
      const x = p[0] + Math.cos(ang) * rr;
      const y = p[1] + Math.sin(ang) * rr;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (fits(x, y)) {
        interior.push([x, y]);
        grid[gi(x, y)] = interior.length - 1;
        active.push(interior.length - 1);
        placed = true;
      }
    }
    if (!placed) active.splice(ai, 1);
  }

  // triangulate + concavity clip
  const pts: P[] = contour.concat(interior);
  const tris = delaunay(pts).filter((t) => {
    const cx = (pts[t.a][0] + pts[t.b][0] + pts[t.c][0]) / 3;
    const cy = (pts[t.a][1] + pts[t.b][1] + pts[t.c][1]) / 3;
    if (!inPoly(cx, cy, poly)) return false;
    const mE = Math.max(dist(pts[t.a], pts[t.b]), dist(pts[t.b], pts[t.c]), dist(pts[t.c], pts[t.a]));
    return mE < MAX_EDGE;
  });

  // unique edges with opacity ramp + hot flag
  const seen = new Set<string>();
  const edges: { a: P; b: P; o: number; hot: boolean }[] = [];
  for (const t of tris)
    for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const mx = (pts[u][0] + pts[v][0]) / 2;
      const my = (pts[u][1] + pts[v][1]) / 2;
      const cp = clamp(1 - distToPoly(mx, my, poly) / 38, 0, 1);
      const fp = clamp(1 - minFeat(mx, my) / (0.2 * W), 0, 1);
      edges.push({ a: pts[u], b: pts[v], o: clamp(0.26 + 0.5 * cp + 0.26 * fp, 0.22, 0.95), hot: fp > 0.32 });
    }

  // nodes with brightness + seeded twinkle timing
  const nodes = pts.map((p, i) => {
    const cn = i < cN ? 1 : clamp(1 - distToPoly(p[0], p[1], poly) / 34, 0, 1);
    const ft = clamp(1 - minFeat(p[0], p[1]) / (0.22 * W), 0, 1);
    const b = clamp(0.26 + 0.5 * cn + 0.34 * ft, 0, 1);
    return { x: p[0], y: p[1], b, delay: rng() * 4, dur: 2.6 + rng() * 1.8 };
  });

  const blooms = nodes.filter((n) => n.b > 0.78).sort((a, b) => b.b - a.b).slice(0, 10);

  // particles + connector links (whole group drifts as one transform)
  const parts = Array.from({ length: 30 }, () => ({
    x: (0.78 + rng() * 0.21) * W,
    y: (0.12 + rng() * 0.74) * H,
    r: 0.6 + rng() * 1.1,
    o: 0.15 + rng() * 0.4,
  }));
  const links: { a: (typeof parts)[0]; b: (typeof parts)[0]; o: number }[] = [];
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const dd = Math.hypot(parts[i].x - parts[j].x, parts[i].y - parts[j].y);
      if (dd < 72) links.push({ a: parts[i], b: parts[j], o: 0.1 + 0.08 * (1 - dd / 72) });
    }

  const contourD = 'M' + poly.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L') + ' Z';
  return { edges, nodes, blooms, parts, links, contourD };
}

const W = 560;
const H = 500;

export function FaceMesh({ className, animate = true }: { className?: string; animate?: boolean }) {
  const M = useMemo(() => buildMesh(W, H), []);

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background:
          'radial-gradient(54% 54% at 32% 40%, rgba(124,58,237,0.46), rgba(124,58,237,0) 70%),' +
          'radial-gradient(26% 26% at 29% 38%, rgba(168,85,247,0.30), transparent 62%)',
      }}
    >
      <style>{`
        @keyframes fmTw { 0%,100% { opacity: var(--o) } 50% { opacity: 1 } }
        @keyframes fmDrift { from { transform: translate(0,0) } to { transform: translate(14px,-10px) } }
        @media (prefers-reduced-motion: no-preference) {
          .fm-anim .fm-tw { animation-name: fmTw; animation-iteration-count: infinite; animation-timing-function: ease-in-out }
          .fm-anim .fm-drift { animation: fmDrift 22s ease-in-out infinite alternate }
        }
      `}</style>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="An AI employee, visualized as a glowing low-poly human face profile"
        shapeRendering="geometricPrecision"
        className={animate ? 'fm-anim' : undefined}
        style={{ position: 'absolute', inset: 0, display: 'block' }}
      >
        <defs>
          <linearGradient id="fm-contour" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8B6EF2" />
            <stop offset="55%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#C4B5FD" />
          </linearGradient>
          <radialGradient id="fm-nodebloom">
            <stop offset="0%" stopColor="#C4B5FD" stopOpacity="0.6" />
            <stop offset="65%" stopColor="#C4B5FD" stopOpacity="0" />
            <stop offset="100%" stopColor="#C4B5FD" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* L1 mesh edges */}
        {M.edges.map((e, i) => (
          <line
            key={`e${i}`}
            x1={e.a[0]}
            y1={e.a[1]}
            x2={e.b[0]}
            y2={e.b[1]}
            stroke={e.hot ? '#8B6EF2' : '#5E3CE8'}
            strokeWidth={e.hot ? 1 : 0.7}
            opacity={e.o}
          />
        ))}

        {/* L2 drifting particle field (one transform → links stay attached) */}
        <g className="fm-drift">
          {M.links.map((l, i) => (
            <line key={`l${i}`} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="#5E3CE8" strokeWidth={0.5} opacity={l.o} />
          ))}
          {M.parts.map((p, i) => (
            <circle key={`p${i}`} cx={p.x} cy={p.y} r={p.r} fill="#8B6EF2" opacity={p.o} />
          ))}
        </g>

        {/* L3 contour halo (filter-free: wide low-opacity strokes) */}
        <path d={M.contourD} fill="none" stroke="#A855F7" strokeWidth={5} opacity={0.16} strokeLinejoin="round" />
        <path d={M.contourD} fill="none" stroke="#8B6EF2" strokeWidth={2.6} opacity={0.24} strokeLinejoin="round" />
        {/* L4 contour core */}
        <path d={M.contourD} fill="none" stroke="url(#fm-contour)" strokeWidth={1.7} opacity={0.98} strokeLinejoin="round" />

        {/* L5 node blooms */}
        {M.blooms.map((n, i) => (
          <circle key={`nb${i}`} cx={n.x} cy={n.y} r={7} fill="url(#fm-nodebloom)" />
        ))}

        {/* L6 nodes */}
        {M.nodes.map((n, i) => {
          const fill = n.b > 0.82 ? '#E9D5FF' : n.b > 0.6 ? '#C4B5FD' : n.b > 0.4 ? '#8B6EF2' : '#5E3CE8';
          const op = 0.4 + 0.6 * n.b;
          const tw = n.b > 0.55;
          return (
            <circle
              key={`n${i}`}
              cx={n.x}
              cy={n.y}
              r={0.8 + n.b * 1.4}
              fill={fill}
              className={tw ? 'fm-tw' : undefined}
              style={
                tw
                  ? ({ ['--o' as string]: op, opacity: op, animationDelay: `${n.delay.toFixed(2)}s`, animationDuration: `${n.dur.toFixed(2)}s` } as React.CSSProperties)
                  : { opacity: op }
              }
            />
          );
        })}
      </svg>
    </div>
  );
}
