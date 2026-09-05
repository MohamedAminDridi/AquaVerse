// ─────────────────────────────────────────────────────────────────────────────
// rain.service — fuses the LOCAL RAIN SENSOR (ground truth, "now") with the
// OPEN-METEO FORECAST (prediction, "future").
//
// They are not competitors, they cover different time horizons:
//   • sensor  → is it raining RIGHT NOW? how hard? (authoritative, local)
//   • forecast→ will it rain, when, how much? (planning ahead)
//
// The interesting part is the third job: every time the forecast predicted rain
// we check whether the gauge actually saw it, and keep a rolling
// FORECAST CONFIDENCE per farm. A farm whose forecasts keep missing gets its
// proactive "skip irrigation, rain is coming" decisions trusted less.
//
// Sensor hardware: FC-37/YL-83 on the gateway → gives presence + intensity,
// NOT millimetres. Quantities still come from the forecast.
// See docs/RAIN_SENSOR_PLAN.md.
// ─────────────────────────────────────────────────────────────────────────────
const logger = require('../utils/logger');

const RAIN_STALE_MS = 3 * 60 * 1000;   // gateway heartbeat is 10 s; 3 min = sensor lost
const MAX_SAMPLES   = 50;              // rolling window for the confidence score

// farmId -> { raining, wetness, ts, gw }
const live = new Map();
// farmId -> [{ predicted:bool, observed:bool, ts }]
const scoreboard = new Map();
// farmId -> { predictedAt, windowEnd, observed }  (open verification window)
const pending = new Map();

/** Called from the gateway heartbeat handler on every beat that carries rain data. */
exports.ingest = (farmId, gwId, { raining, wetness }) => {
  if (raining == null) return null;
  const id = String(farmId);
  const prev = live.get(id);
  const state = { raining: !!raining, wetness: wetness ?? 0, ts: Date.now(), gw: gwId };
  live.set(id, state);

  // close any open forecast-verification window the moment real rain is seen
  const p = pending.get(id);
  if (p && state.raining) { p.observed = true; }

  if (!prev || prev.raining !== state.raining) {
    logger[state.raining ? 'info' : 'info'](
      `🌧 Rain sensor [${gwId}] → ${state.raining ? 'RAINING' : 'dry'} (wetness ${state.wetness}%)`);
  }
  return state;
};

/** Current sensor state for a farm, or null when absent/stale. */
exports.current = (farmId) => {
  const s = live.get(String(farmId));
  if (!s) return null;
  const fresh = Date.now() - s.ts < RAIN_STALE_MS;
  return { ...s, fresh, ageMs: Date.now() - s.ts };
};

/** True only when a FRESH sensor says it is raining (used to veto irrigation). */
exports.isRainingNow = (farmId) => {
  const s = exports.current(farmId);
  return !!(s && s.fresh && s.raining);
};

/**
 * Open a verification window: the forecast says rain within `hours`.
 * When the window closes we record hit/miss into the scoreboard.
 */
exports.notePrediction = (farmId, hours) => {
  const id = String(farmId);
  if (pending.has(id)) return;                     // one open window at a time
  pending.set(id, { windowEnd: Date.now() + (hours + 1) * 3.6e6, observed: false });
};

/** Close any window whose deadline passed and fold the result into the score. */
exports.settle = (farmId) => {
  const id = String(farmId);
  const p = pending.get(id);
  if (!p || Date.now() < p.windowEnd) return;
  pending.delete(id);
  const list = scoreboard.get(id) || [];
  list.push({ predicted: true, observed: p.observed, ts: Date.now() });
  scoreboard.set(id, list.slice(-MAX_SAMPLES));
  logger.info(`🌧 Forecast verification [${id}]: predicted rain → ${p.observed ? 'HIT' : 'MISS'}`);
};

/**
 * Rolling forecast confidence 0-100 (how often predicted rain actually arrived).
 * Returns null until we have at least 3 verified predictions — never fake a score.
 */
exports.confidence = (farmId) => {
  const list = scoreboard.get(String(farmId)) || [];
  if (list.length < 3) return null;
  const hits = list.filter((r) => r.observed).length;
  return Math.round((hits / list.length) * 100);
};

/**
 * The fused view used by the autopilot and the UI.
 *   sensor  = ground truth now      forecast = {rainInH, rainTotal}
 * `skipIrrigation` is the single answer the autopilot needs.
 */
exports.fuse = (farmId, forecastWx, hoursToDry) => {
  const sensor = exports.current(farmId);
  const conf   = exports.confidence(farmId);
  const rainingNow = !!(sensor && sensor.fresh && sensor.raining);

  // forecast rain is only actionable if it lands before the soil hits its target
  const rainInH = forecastWx?.rainInH ?? null;
  const forecastCovers = rainInH != null && (hoursToDry == null || rainInH <= hoursToDry);
  // if we have a confidence score and it is poor, stop trusting proactive skips
  const trustForecast = conf == null ? true : conf >= 50;

  return {
    sensor: sensor ? { raining: sensor.raining, wetness: sensor.wetness, fresh: sensor.fresh } : null,
    forecast: { rainInH, rainTotal: forecastWx?.rainTotal ?? null },
    confidence: conf,
    rainingNow,
    skipIrrigation: rainingNow || (forecastCovers && trustForecast),
    reason: rainingNow ? 'raining now (sensor)'
          : (forecastCovers && trustForecast) ? `rain forecast in ${rainInH} h`
          : null,
  };
};
