import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { motion } from 'framer-motion';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useAlertStore } from '../store/alertStore';
import { GlassPanel, MetricTile, RadialGauge, StatusPill, SectionTitle, LiveFeed, Sparkline, CountUp } from '../components/os';

const hhmmss = (d) => new Date(d).toLocaleTimeString('en-GB', { hour12: false });
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
const soilTone = (p) => (p == null ? '#64748b' : p < 20 ? '#f87171' : p < 40 ? '#fbbf24' : p < 70 ? '#34d399' : '#22d3ee');

/* live clock */
function MissionClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return (
    <div className="text-right">
      <div className="mono text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>{hhmmss(t)}</div>
      <div className="text-[11px] text-mute uppercase tracking-[0.15em]">
        {t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [farmsData, setFarmsData] = useState([]);
  const [alerts, setAlerts]   = useState([]);
  const [summary, setSummary] = useState(null);
  const [liveData, setLiveData] = useState({});
  const [feed, setFeed]       = useState([]);          // telemetry console
  const [sparks, setSparks]   = useState({ soil: [], nodes: [] });
  const [loading, setLoading] = useState(true);
  const [, setTick]           = useState(0);

  const token = useAuthStore((s) => s.token);
  const user  = useAuthStore((s) => s.user);
  const unreadCount = useAlertStore((s) => s.unreadCount);
  const socketRef = useRef(null);

  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 5000); return () => clearInterval(id); }, []);

  useEffect(() => {
    (async () => {
      try {
        const [farmsRes, alertsRes] = await Promise.all([
          api.get('/farms'), api.get('/alerts?acknowledged=false&limit=8'),
        ]);
        const farmList = farmsRes.data.data.farms || [];
        setAlerts(alertsRes.data.data || []);
        if (farmList.length) {
          const [nodeResults, gwResults] = await Promise.all([
            Promise.all(farmList.map((f) => api.get(`/farms/${f._id}/nodes`).then((r) => r.data.data.nodes || []).catch(() => []))),
            Promise.all(farmList.map((f) => api.get(`/farms/${f._id}/gateways`).then((r) => r.data.data.gateways || []).catch(() => []))),
          ]);
          setFarmsData(farmList.map((farm, i) => ({ farm, nodes: nodeResults[i], gateways: gwResults[i] })));
          api.get(`/analytics/farms/${farmList[0]._id}/summary?from=7d`).then((r) => setSummary(r.data.data?.summary)).catch(() => {});
        }
      } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!token || farmsData.length === 0) return;
    const s = io(import.meta.env.VITE_API_URL || undefined, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = s;
    s.on('connect', () => farmsData.forEach((fd) => s.emit('join:farm', fd.farm._id)));
    s.on('sensor:data', (d) => {
      setLiveData((prev) => ({ ...prev, [d.deviceId]: d }));
      setFarmsData((prev) => prev.map((fd) => ({ ...fd, nodes: fd.nodes.map((n) => n.device_id === d.deviceId ? { ...n, status: 'online', last_seen: new Date() } : n) })));
      setFeed((prev) => [{ id: Math.random(), time: hhmmss(Date.now()), color: soilTone(d.soil_moisture_pct),
        text: `${d.deviceId} · soil ${d.soil_moisture_pct ?? '—'}% · ${d.temperature_c ?? '—'}°C · bat ${d.battery_pct ?? '—'}%` }, ...prev].slice(0, 40));
      if (d.soil_moisture_pct != null) setSparks((p) => ({ ...p, soil: [...p.soil, d.soil_moisture_pct].slice(-40) }));
    });
    s.on('node:status', (d) => {
      const on = d.online ?? (d.status === 'online');
      setFarmsData((prev) => prev.map((fd) => ({ ...fd, nodes: fd.nodes.map((n) => n.device_id === d.device_id ? { ...n, status: on ? 'online' : 'offline' } : n) })));
    });
    s.on('gateway:status', (d) => setFarmsData((prev) => prev.map((fd) => ({ ...fd, gateways: fd.gateways.map((g) => g.device_id === d.device_id ? { ...g, status: d.status } : g) }))));
    s.on('alert:new', (a) => setAlerts((prev) => [a, ...prev].slice(0, 8)));
    return () => { socketRef.current?.disconnect(); socketRef.current = null; };
  }, [token, farmsData.length]);

  const allNodes = farmsData.flatMap((fd) => fd.nodes);
  const allGWs   = farmsData.flatMap((fd) => fd.gateways);
  const nodesOnline = allNodes.filter((n) => n.status === 'online').length;
  const nodesOff = allNodes.length - nodesOnline;
  const gwOnline = allGWs.filter((g) => g.status === 'online').length;
  const gwOff = allGWs.length - gwOnline;
  const avgSoil = (() => { const v = Object.values(liveData).map((d) => d.soil_moisture_pct).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : (summary?.avg_soil_moisture ?? null); })();

  // farm health score: node uptime (60%) + gateway uptime (25%) − alert penalty (15%)
  const upN = allNodes.length ? nodesOnline / allNodes.length : 1;
  const upG = allGWs.length ? gwOnline / allGWs.length : 1;
  const penalty = Math.min(1, (alerts.filter((a) => a.severity === 'critical').length * 0.34) + (unreadCount * 0.05));
  const health = Math.round(Math.max(0, (upN * 0.6 + upG * 0.25 + 0.15) - penalty * 0.15) * 100);
  const healthColor = health >= 85 ? '#34d399' : health >= 60 ? '#fbbf24' : '#f87171';

  const SEVCOL = { critical: '#f87171', warning: '#fbbf24', info: '#22d3ee' };

  return (
    <div className="relative space-y-5 pb-10">
      {/* ── command bar ── */}
      <GlassPanel scan className="p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-mute">
            <span className="w-2 h-2 rounded-full os-live" style={{ background: '#34d399', color: '#34d399' }} />
            AquaVerse Mission Control
          </div>
          <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--text)' }}>
            {greeting()}, {user?.name || 'Operator'}
          </h1>
          <p className="text-sm text-dim mt-0.5">
            Monitoring <span className="mono" style={{ color: 'var(--accent)' }}>{farmsData.length}</span> farm{farmsData.length !== 1 ? 's' : ''} ·
            <span className="mono" style={{ color: 'var(--accent)' }}> {allNodes.length}</span> nodes ·
            <span className="mono" style={{ color: 'var(--accent)' }}> {allGWs.length}</span> gateways
          </p>
        </div>
        <MissionClock />
      </GlassPanel>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricTile delay={0.05} label="Nodes online" value={nodesOnline} unit={`/ ${allNodes.length}`}
          danger={nodesOff > 0} sub={nodesOff > 0 ? `${nodesOff} offline` : 'all reporting'} accent="#34d399" />
        <MetricTile delay={0.1} label="Gateways" value={gwOnline} unit={`/ ${allGWs.length}`}
          danger={gwOff > 0} sub={gwOff > 0 ? `${gwOff} down` : 'all linked'} accent="#22d3ee" />
        <MetricTile delay={0.15} label="Avg soil" value={avgSoil} unit="%"
          sub="live fleet mean" accent={soilTone(avgSoil)} spark={sparks.soil} />
        <MetricTile delay={0.2} label="Active alerts" value={unreadCount}
          danger={unreadCount > 0} sub={unreadCount > 0 ? 'needs attention' : 'all clear'} accent="#fbbf24" />
      </div>

      {/* ── health + vitals + live feed ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassPanel hover delay={0.1} className="p-5 flex flex-col items-center justify-center">
          <SectionTitle>Farm Health</SectionTitle>
          <RadialGauge value={health} label="index" color={healthColor} />
          <div className="mt-3 flex gap-2">
            <StatusPill tone={upN === 1 ? 'ok' : 'warn'} label={`NODES ${Math.round(upN * 100)}%`} />
            <StatusPill tone={upG === 1 ? 'ok' : 'warn'} label={`UPLINK ${Math.round(upG * 100)}%`} />
          </div>
        </GlassPanel>

        <GlassPanel hover delay={0.15} className="p-5 lg:col-span-2">
          <SectionTitle right={<span className="text-[11px] text-mute mono">live</span>}>Telemetry Stream</SectionTitle>
          <LiveFeed items={feed} height={232} />
        </GlassPanel>
      </div>

      {/* ── system vitals row ── */}
      <GlassPanel hover delay={0.2} className="p-4">
        <SectionTitle>System Vitals</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {[
            ['MQTT broker', allGWs.length && gwOnline ? 'live' : 'idle'],
            ['Realtime link', socketRef.current ? 'live' : 'idle'],
            ['Edge AI', 'live'],
            ['Database', 'ok'],
          ].map(([k, tone], i) => (
            <div key={k} className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
              <span className="text-dim text-[12px]">{k}</span>
              <StatusPill tone={tone} live={tone === 'live'} />
            </div>
          ))}
        </div>
      </GlassPanel>

      {/* ── alerts console + farm fleet ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassPanel hover delay={0.1} className="p-5">
          <SectionTitle right={<Link to="/alerts" className="text-[11px] mono" style={{ color: 'var(--accent)' }}>VIEW ALL →</Link>}>Incident Log</SectionTitle>
          {alerts.length === 0 ? (
            <div className="py-10 text-center text-dim text-sm">✓ no active incidents</div>
          ) : (
            <div className="space-y-1.5">
              {alerts.map((a, i) => (
                <motion.div key={a._id || i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                  className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                  <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: SEVCOL[a.severity] || '#fbbf24' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] truncate" style={{ color: 'var(--text)' }}>{a.message}</p>
                    <p className="text-[10px] text-mute mono mt-0.5">{a.createdAt ? hhmmss(a.createdAt) : ''}</p>
                  </div>
                  <span className="text-[10px] font-bold uppercase shrink-0" style={{ color: SEVCOL[a.severity] || '#fbbf24' }}>{a.severity}</span>
                </motion.div>
              ))}
            </div>
          )}
        </GlassPanel>

        <GlassPanel hover delay={0.15} className="p-5">
          <SectionTitle right={<Link to="/farms" className="text-[11px] mono" style={{ color: 'var(--accent)' }}>MANAGE →</Link>}>Farm Fleet</SectionTitle>
          <div className="space-y-1.5">
            {loading && [1, 2].map((i) => <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--panel-2)' }} />)}
            {!loading && farmsData.length === 0 && <div className="py-8 text-center text-dim text-sm">no farms yet</div>}
            {farmsData.map((fd, i) => {
              const on = fd.nodes.filter((n) => n.status === 'online').length;
              const gwon = fd.gateways.filter((g) => g.status === 'online').length;
              const ok = on === fd.nodes.length && gwon === fd.gateways.length;
              return (
                <Link key={fd.farm._id} to={`/farms/${fd.farm._id}`}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
                  style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                  <div className="w-9 h-9 rounded-lg grid place-items-center font-bold text-sm shrink-0"
                    style={{ background: ok ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)', color: ok ? '#34d399' : '#fbbf24' }}>
                    {fd.farm.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>{fd.farm.name}</p>
                    <p className="text-[11px] text-mute">{fd.farm.crop_type || 'mixed'} · {fd.farm.size_ha ? `${fd.farm.size_ha} ha` : '—'}</p>
                  </div>
                  <div className="text-right mono text-[11px]">
                    <div style={{ color: on === fd.nodes.length ? '#34d399' : '#f87171' }}>🔌 {on}/{fd.nodes.length}</div>
                    <div style={{ color: gwon === fd.gateways.length ? '#22d3ee' : '#f87171' }}>📡 {gwon}/{fd.gateways.length}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </GlassPanel>
      </div>

      {/* ── live nodes grid ── */}
      {allNodes.length > 0 && (
        <div>
          <SectionTitle right={<Link to="/nodes" className="text-[11px] mono" style={{ color: 'var(--accent)' }}>ALL NODES →</Link>}>Live Nodes · {allNodes.length}</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {farmsData.flatMap((fd) => fd.nodes.map((node, i) => {
              const d = liveData[node.device_id] || {};
              const soil = d.soil_moisture_pct ?? null;
              const bat = d.battery_pct ?? node.battery_pct;
              const online = node.status === 'online';
              return (
                <GlassPanel key={node._id} hover delay={Math.min(i * 0.03, 0.4)} className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--text)' }}>{node.name}</span>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: online ? '#34d399' : '#f87171' }} />
                  </div>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-xl font-bold mono" style={{ color: soilTone(soil) }}>{soil ?? '—'}</span>
                    <span className="text-[10px] text-mute mb-0.5">% soil</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden mt-1.5" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${soil ?? 0}%`, background: soilTone(soil), boxShadow: `0 0 6px ${soilTone(soil)}` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] mono">
                    <span className="text-dim">{d.temperature_c != null ? `${d.temperature_c.toFixed(1)}°` : '—'}</span>
                    <span style={{ color: bat == null ? 'var(--text-mute)' : bat > 30 ? '#34d399' : '#f87171' }}>
                      {(d.charging ?? node.battery_charging) ? '⚡' : '🔋'} {bat ?? '—'}%
                    </span>
                  </div>
                </GlassPanel>
              );
            }))}
          </div>
        </div>
      )}
    </div>
  );
}
