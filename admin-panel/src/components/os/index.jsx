import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// AquaVerse OS — shared "mission control" UI kit. Every screen composes these so
// the futuristic language stays consistent. Pure visual layer over existing data.
// ─────────────────────────────────────────────────────────────────────────────

const ease = [0.22, 0.61, 0.36, 1];

/* Glass panel with staggered fade-in + optional scanline sweep. */
export function GlassPanel({ children, className = '', delay = 0, scan = false, hover = false, ...rest }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay }}
      className={`os-panel relative overflow-hidden ${hover ? 'os-panel-hover' : ''} ${scan ? 'os-scan' : ''} ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* Number that animates up to its target value, monospace, telemetry-style. */
export function CountUp({ value, decimals = 0, className = '' }) {
  const mv = useMotionValue(0);
  const [txt, setTxt] = useState('0');
  useEffect(() => {
    const target = Number(value);
    if (!Number.isFinite(target)) { setTxt('—'); return; }
    const controls = animate(mv, target, {
      duration: 1.1, ease,
      onUpdate: (v) => setTxt(v.toFixed(decimals)),
    });
    return () => controls.stop();
  }, [value, decimals]); // eslint-disable-line
  return <span className={`mono ${className}`}>{txt}</span>;
}

/* Big KPI tile: label, animated value, unit, trailing sparkline + status glow. */
export function MetricTile({ label, value, unit, decimals = 0, accent = 'var(--accent)', spark, sub, delay = 0, danger }) {
  return (
    <GlassPanel hover delay={delay} className="p-4">
      <div className="flex items-start justify-between">
        <span className="text-[11px] uppercase tracking-[0.15em] text-mute">{label}</span>
        <span className="w-2 h-2 rounded-full os-live" style={{ color: danger ? '#f87171' : accent, background: danger ? '#f87171' : accent }} />
      </div>
      <div className="mt-2 flex items-end gap-1.5">
        <span className="text-3xl font-bold leading-none" style={{ color: 'var(--text)' }}>
          {value == null ? <span className="mono">—</span> : <CountUp value={value} decimals={decimals} />}
        </span>
        {unit && <span className="text-sm text-dim mb-0.5">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[11px]" style={{ color: danger ? '#f87171' : 'var(--text-dim)' }}>{sub}</div>}
      {spark && <Sparkline data={spark} color={accent} className="mt-3" />}
    </GlassPanel>
  );
}

/* Glowing inline sparkline (SVG). */
export function Sparkline({ data = [], color = 'var(--accent)', w = 220, h = 36, className = '' }) {
  const vals = data.filter((v) => v != null && !Number.isNaN(v));
  if (vals.length < 2) return <div className={`h-9 ${className}`} />;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (((v ?? min) - min) / span) * (h - 4) - 2;
    return [x, y];
  });
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${d} L${w},${h} L0,${h} Z`;
  const id = 'sg' + Math.round(w + h + vals[0]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`w-full ${className}`} style={{ height: h }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}

/* Radial gauge (0..100) with animated arc — the "Tesla battery ring". */
export function RadialGauge({ value = 0, label, size = 168, color = 'var(--accent)', delay = 0 }) {
  const r = size / 2 - 14;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="10" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - pct / 100) }}
          transition={{ duration: 1.3, ease, delay }}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-bold"><CountUp value={pct} /></div>
        {label && <div className="text-[10px] uppercase tracking-[0.18em] text-mute mt-0.5">{label}</div>}
      </div>
    </div>
  );
}

/* Status pill — glowing dot + text, semantic colors. */
const PILL = {
  ok:    { c: '#34d399', t: 'OK' },
  warn:  { c: '#fbbf24', t: 'WARN' },
  crit:  { c: '#f87171', t: 'CRIT' },
  idle:  { c: '#64748b', t: '—' },
  live:  { c: '#22d3ee', t: 'LIVE' },
};
export function StatusPill({ tone = 'idle', label, live = false }) {
  const p = PILL[tone] || PILL.idle;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ color: p.c, background: `${p.c}1a`, border: `1px solid ${p.c}40` }}>
      <span className={`w-1.5 h-1.5 rounded-full ${live ? 'os-live' : ''}`} style={{ background: p.c, color: p.c }} />
      {label || p.t}
    </span>
  );
}

/* Section header with an accent tick. */
export function SectionTitle({ icon, children, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide" style={{ color: 'var(--text)' }}>
        <span className="inline-block w-1 h-4 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }} />
        {icon && <span>{icon}</span>}{children}
      </h2>
      {right}
    </div>
  );
}

/* Live telemetry feed — a scrolling launch-console log. */
export function LiveFeed({ items = [], height = 240 }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [items.length]);
  return (
    <div ref={ref} className="overflow-y-auto pr-1 mono text-[11px] leading-relaxed" style={{ height }}>
      {items.length === 0 && <div className="text-mute py-6 text-center">awaiting telemetry…</div>}
      {items.map((it, i) => (
        <motion.div key={it.id || i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}
          className="flex items-center gap-2 py-0.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="text-mute shrink-0">{it.time}</span>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: it.color || 'var(--accent)' }} />
          <span className="truncate" style={{ color: 'var(--text-dim)' }}>{it.text}</span>
        </motion.div>
      ))}
    </div>
  );
}
