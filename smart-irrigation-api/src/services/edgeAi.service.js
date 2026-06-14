// ─────────────────────────────────────────────────────────────────────────────
// edgeAi.service — SHADOW-MODE decision + sensor-trust evaluation (v0 rules).
//
// Runs on every telemetry packet. NEVER actuates anything: the output is
// logged, streamed to the AI Brain layer, and compared against what the cloud
// actually did (agreement %). Phase 2 swaps `decide()` for the trained
// decision tree (same inputs/outputs); Phase 5 swaps `trust()` for the
// autoencoder. The interfaces are the contract.
//
// Trust checks (cheap, rule-based — the F2 prompt's baseline):
//   • nan    : DHT returned nothing (temp/hum null)
//   • rail   : soil pinned at 0 or 100 (ADC rail / disconnected probe)
//   • stuck  : soil variance ≈ 0 across the last 8 readings while at a rail
//   • jump   : |Δsoil| > 40 points between consecutive readings
// score = 1 − penalties (floor 0).  trusted = score ≥ 0.5
// ─────────────────────────────────────────────────────────────────────────────
const MODEL_VERSION = 'v0-rules';
const WIN = 8;                       // readings kept per device for trust stats

const windows = new Map();           // deviceId -> [{soil, ts}]
const lastDecision = new Map();      // deviceId -> { irr, dur }  (emit on change only)

function trust(deviceId, { soil, temp, hum }) {
  const reasons = [];
  let score = 1;

  if (temp == null || hum == null) { score -= 0.4; reasons.push('nan'); }

  if (soil == null) { score -= 0.5; reasons.push('no-soil'); }
  else {
    const w = windows.get(deviceId) || [];
    const prev = w[w.length - 1];
    if (prev && Math.abs(soil - prev.soil) > 40) { score -= 0.5; reasons.push('jump'); }
    if (soil <= 0 || soil >= 100) {
      score -= 0.3; reasons.push('rail');
      const flat = w.length >= WIN - 1 && w.every((r) => r.soil === soil);
      if (flat) { score -= 0.4; reasons.push('stuck'); }
    }
    w.push({ soil, ts: Date.now() });
    windows.set(deviceId, w.slice(-WIN));
  }

  score = Math.max(0, Math.round(score * 100) / 100);
  return { score, reasons, trusted: score >= 0.5 };
}

// v0 decision rules — deliberately simple and explainable:
//   irrigate when soil is below 35 % on TRUSTED data, outside the midday
//   evaporation window (11:00–16:00); duration scales with the deficit.
//   Untrusted data ⇒ conservative: never irrigate, only flag.
function decide({ soil, temp, hum, hour }, trustRes) {
  if (!trustRes.trusted) return { irr: false, dur: 0, why: 'untrusted-data' };
  if (soil == null)      return { irr: false, dur: 0, why: 'no-soil' };
  if (soil >= 35)        return { irr: false, dur: 0, why: 'soil-ok' };
  if (hour >= 11 && hour < 16) return { irr: false, dur: 0, why: 'midday-skip' };
  const dur = Math.min(600, Math.max(60, Math.round((35 - soil) * 12)));   // seconds
  return { irr: true, dur, why: 'soil-low' };
}

// Main entry — called by telemetryHandler for every packet.
// Returns { trust, dec, changed } ; `changed` = decision differs from the last
// one for this device (callers persist + broadcast only then, not every 5 s).
exports.evaluate = (deviceId, { soil, temp, hum, valveState }) => {
  const hour = new Date().getHours();
  const t = trust(deviceId, { soil, temp, hum });
  const d = decide({ soil, temp, hum, hour }, t);

  // shadow comparison: does the model agree with what the cloud/user is doing?
  const cloudIrrigating = valveState === 'open';
  const agree = d.irr === cloudIrrigating;

  const prev = lastDecision.get(deviceId);
  const changed = !prev || prev.irr !== d.irr || prev.dur !== d.dur;
  lastDecision.set(deviceId, { irr: d.irr, dur: d.dur });

  return {
    trust: t,
    dec: { irr: d.irr, dur: d.dur, why: d.why, agree, v: MODEL_VERSION,
           in: { soil, temp, hum, hour } },
    changed,
  };
};

exports.MODEL_VERSION = MODEL_VERSION;
