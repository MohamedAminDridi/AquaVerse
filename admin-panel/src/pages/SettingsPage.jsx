import { useState, useEffect } from 'react';
import api from '../services/api';

// Live MQTT broker control — local broker is always on; the cloud broker can be
// switched on/off here without redeploying. Persisted server-side.
function BrokerSection() {
  const [broker, setBroker] = useState(null);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');

  const load = () => api.get('/system/broker')
    .then((r) => { setBroker(r.data?.data?.broker || null); setErr(''); })
    .catch((e) => setErr(e.response?.data?.message || e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);  // keep the connection dots fresh
    return () => clearInterval(t);
  }, []);

  const toggleCloud = (on) => {
    setBusy(true);
    api.put('/system/broker', { cloud: on })
      .then((r) => setBroker(r.data?.data?.broker || null))
      .catch((e) => setErr(e.response?.data?.message || e.message))
      .finally(() => setBusy(false));
  };

  const Dot = ({ ok }) => (
    <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-400'}`} />
  );

  const cloud = broker?.cloud;
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">MQTT Broker</h2>
      {err && <p className="text-xs text-rose-600 bg-rose-50 px-3 py-1.5 rounded-lg">{err}</p>}

      {/* Local broker (always on) */}
      <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800 flex items-center gap-2">
            <Dot ok={broker?.local?.connected} /> Local broker
          </div>
          <div className="text-[11px] text-gray-400 font-mono truncate">{broker?.local?.url || '—'}</div>
        </div>
        <span className="text-[11px] font-semibold text-gray-400 uppercase">always on</span>
      </div>

      {/* Cloud broker (toggle) */}
      <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800 flex items-center gap-2">
            <Dot ok={cloud?.connected} /> ☁️ Cloud broker
          </div>
          <div className="text-[11px] text-gray-400 font-mono truncate">
            {cloud?.configured ? (cloud.url || 'configured') : 'not configured — set MQTT_CLOUD_URL on the server'}
          </div>
        </div>
        <button
          onClick={() => toggleCloud(!cloud?.enabled)}
          disabled={busy || !cloud?.configured}
          title={!cloud?.configured ? 'Set MQTT_CLOUD_URL in the backend env first' : ''}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
            cloud?.enabled ? 'bg-cyan-500' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white transform transition-transform ${
            cloud?.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
      <p className="text-[11px] text-gray-400">
        Cloud broker is {cloud?.enabled ? 'ON' : 'OFF'}
        {cloud?.enabled && !cloud?.connected ? ' · connecting…' : ''}.
        The gateway must point at this broker for real data to flow.
      </p>
    </section>
  );
}

// Edge-AI master switch. Rides inside every heartbeat beacon, so the whole
// farm obeys within one beacon period (≤10 s). When OFF, autonomous nodes use
// conservative rules only (never AI decisions).
function AiSection() {
  const [enabled, setEnabled] = useState(null);   // null = loading
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  useEffect(() => {
    api.get('/system/ai')
      .then((r) => setEnabled(!!r.data?.data?.ai?.enabled))
      .catch((e) => setErr(e.response?.data?.message || e.message));
  }, []);

  const toggle = () => {
    setBusy(true);
    api.put('/system/ai', { enabled: !enabled })
      .then((r) => setEnabled(!!r.data?.data?.ai?.enabled))
      .catch((e) => setErr(e.response?.data?.message || e.message))
      .finally(() => setBusy(false));
  };

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-gray-700">Edge AI</h2>
      {err && <p className="text-xs text-rose-600 bg-rose-50 px-3 py-1.5 rounded-lg">{err}</p>}
      <div className="flex items-center justify-between rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800">🧠 On-device decisions</div>
          <div className="text-[11px] text-gray-400">
            Lets nodes irrigate from their own models when the cloud is unreachable (autonomous mode)
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={busy || enabled === null}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
            enabled ? 'bg-violet-500' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white transform transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
      <p className="text-[11px] text-gray-400">
        Edge AI is {enabled === null ? '…' : enabled ? 'ON' : 'OFF'} — the flag reaches every node
        inside the next heartbeat beacon (≤10 s). With AI off, autonomous nodes never act on
        untrusted data; they alert instead.
      </p>
    </section>
  );
}

export default function SettingsPage() {
  const [saved,setSaved]=useState(false);
  const [form,setForm]=useState({ jwt_expires:'15m', cors_origin:'http://localhost:5173',
    timezone:'Africa/Tunis', smtp_host:'', smtp_port:'587', twilio_sid:'', twilio_token:'', twilio_from:'' });
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const save=()=>{ setSaved(true); setTimeout(()=>setSaved(false),2500); };
  const Field=({label,k,type='text'})=>(
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={form[k]} onChange={e=>set(k,e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
    </div>
  );
  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
      {saved && <p className="text-sm text-green-700 bg-green-50 px-4 py-2 rounded-lg">Saved (wire to backend to persist)</p>}
      <BrokerSection />
      <AiSection />
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">System</h2>
        <Field label="JWT expiry"    k="jwt_expires" />
        <Field label="CORS origin"   k="cors_origin" />
        <Field label="Timezone"      k="timezone" />
      </section>
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">SMTP</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Host" k="smtp_host" />
          <Field label="Port" k="smtp_port" />
        </div>
      </section>
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Twilio</h2>
        <Field label="Account SID" k="twilio_sid"   type="password" />
        <Field label="Auth token"  k="twilio_token" type="password" />
        <Field label="From number" k="twilio_from" />
      </section>
      <button onClick={save} className="bg-green-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-green-800">Save settings</button>
    </div>
  );
}
