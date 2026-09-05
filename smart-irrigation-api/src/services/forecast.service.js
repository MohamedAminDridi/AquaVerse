// ─────────────────────────────────────────────────────────────────────────────
// forecast.service — the server-side AI brain (F4 + advisory).
//
// For each node it: (1) measures the recent soil DRYING RATE from history,
// (2) projects soil moisture for the next 12 h, weather-adjusted (rain refills,
// heat accelerates drying), (3) flags heat/frost risk, (4) backtests the model
// on the spot for an honest accuracy %, and (5) turns all of that into plain
// recommendations ("irrigate node-1 within 3 h", "hold — rain in 2 h").
//
// Pure + explainable (linear depletion + weather deltas) — the same interface a
// trained model would later drop into. Used by the autopilot cron and the
// /api/ai/forecast + /api/ai/recommendations endpoints.
// ─────────────────────────────────────────────────────────────────────────────
const SensorReading = require('../models/SensorReading.model');
const weather       = require('./weather.service');

const HORIZON_H   = 12;     // forecast window
const DRY_TARGET  = 35;     // % soil that means "needs water" (per-node override later)
const HEAT_C      = 35;     // heat-risk threshold
const FROST_C     = 2;      // frost-risk threshold
const latest = new Map();   // deviceId -> last forecast (for REST + dashboard)

// Linear regression slope (value per hour) over [{t(ms), v}] samples.
function slopePerHour(pts) {
  if (pts.length < 3) return 0;
  const t0 = pts[0].t;
  const xs = pts.map((p) => (p.t - t0) / 3.6e6);     // hours
  const ys = pts.map((p) => p.v);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}

// Pull recent soil history for a node (ascending). Returns [{t, v}].
async function soilHistory(nodeId, hours = 24) {
  const since = new Date(Date.now() - hours * 3.6e6);
  const rows = await SensorReading.find({
    'meta.nodeId': nodeId, ts: { $gte: since }, soil_moisture_pct: { $ne: null },
  }).sort({ ts: 1 }).select('ts soil_moisture_pct').lean();
  return rows.map((r) => ({ t: new Date(r.ts).getTime(), v: r.soil_moisture_pct }));
}

// Next-N-hours rain (mm) + temp extremes from the hourly weather forecast.
async function weatherWindow(farm) {
  try {
    if (!farm.location?.lat) return null;
    const fc = await weather.getForecast(farm.location.lat, farm.location.lng, 1);
    const hours = (fc?.hourly?.time || []).map((t, i) => ({
      t: new Date(t).getTime(),
      rain: fc.hourly.precipitation?.[i] ?? 0,
      temp: fc.hourly.temperature_2m?.[i] ?? null,
    })).filter((h) => h.t >= Date.now() && h.t <= Date.now() + HORIZON_H * 3.6e6);
    if (!hours.length) return null;
    const rainTotal = hours.reduce((a, h) => a + (h.rain || 0), 0);
    const rainSoonH = hours.find((h) => h.rain > 0.4);
    const tmax = Math.max(...hours.map((h) => h.temp ?? -99));
    const tmin = Math.min(...hours.map((h) => h.temp ?? 99));
    return { rainTotal, rainInH: rainSoonH ? Math.round((rainSoonH.t - Date.now()) / 3.6e6) : null, tmax, tmin };
  } catch { return null; }
}

// Forecast one node. `wx` = weatherWindow result (shared per farm).
async function forecastNode(node, wx) {
  const hist = await soilHistory(node._id, 24);
  if (hist.length < 3) return { deviceId: node.device_id, ok: false, reason: 'insufficient-history' };

  const current = hist[hist.length - 1].v;
  let dryPerH = -slopePerHour(hist.slice(-12));        // positive = drying
  if (dryPerH < 0) dryPerH = 0;                         // ignore wetting trends for risk
  // weather adjustment: heat speeds drying, rain refills
  const heatFactor = wx && wx.tmax > 28 ? 1 + (wx.tmax - 28) * 0.04 : 1;
  const effDry = dryPerH * heatFactor;

  const predictions = [];
  let soil = current;
  for (let h = 1; h <= HORIZON_H; h++) {
    soil = Math.max(0, soil - effDry);
    // Rain refill applied ONCE, at the forecast rain hour (not every hour after
    // it — that compounded a single shower into an endless top-up). ~4 mm of
    // rain ≈ 1 soil-% point is a rough field constant; a measured rain gauge
    // would replace this estimate (see docs/RAIN_SENSOR_PLAN.md).
    if (wx && wx.rainInH != null && h === wx.rainInH) soil = Math.min(100, soil + (wx.rainTotal / 4));
    predictions.push({ h, soil: Math.round(soil) });
  }
  const target = node.ai?.soilTarget ?? DRY_TARGET;
  const hitDry = predictions.find((p) => p.soil <= target);
  const hoursToDry = current <= target ? 0 : (hitDry ? hitDry.h : null);

  // honest backtest: project from 6 h ago to "now" and compare to actual now.
  let accuracy = null;
  const sixAgo = hist.find((p) => p.t >= Date.now() - 6.5 * 3.6e6);
  if (sixAgo && hist.length >= 6) {
    const past = hist.filter((p) => p.t <= sixAgo.t + 1000);
    const slope = -slopePerHour(past.slice(-8));
    const projected = Math.max(0, sixAgo.v - Math.max(0, slope) * 6);
    accuracy = Math.max(0, Math.round((1 - Math.abs(projected - current) / 100) * 100));
  }

  const fc = {
    deviceId: node.device_id, ok: true, current, target,
    dryPerH: +effDry.toFixed(2), hoursToDry, predictions, accuracy,
    heatRisk: wx ? wx.tmax >= HEAT_C : false,
    frostRisk: wx ? wx.tmin <= FROST_C : false,
    rainInH: wx?.rainInH ?? null,
    ts: Date.now(),
  };
  latest.set(node.device_id, fc);
  return fc;
}

// Build human recommendations for a farm from its node forecasts.
function recommend(forecasts) {
  const recs = [];
  for (const f of forecasts) {
    if (!f.ok) continue;
    if (f.frostRisk) recs.push({ deviceId: f.deviceId, level: 'crit', text: `❄ Frost risk — protect ${f.deviceId}` });
    if (f.rainInH != null && f.hoursToDry != null && f.rainInH <= f.hoursToDry)
      recs.push({ deviceId: f.deviceId, level: 'info', text: `🌧 Hold ${f.deviceId} — rain in ${f.rainInH} h covers it` });
    else if (f.hoursToDry === 0)
      recs.push({ deviceId: f.deviceId, level: 'warn', text: `💧 ${f.deviceId} below target now — irrigate` });
    else if (f.hoursToDry != null && f.hoursToDry <= 4)
      recs.push({ deviceId: f.deviceId, level: 'warn', text: `💧 ${f.deviceId} dries to target in ~${f.hoursToDry} h` });
    if (f.heatRisk && f.hoursToDry != null && f.hoursToDry <= 6)
      recs.push({ deviceId: f.deviceId, level: 'warn', text: `🔥 Heat spike + drying — pre-water ${f.deviceId}` });
  }
  return recs;
}

// Run the full pass for one farm: forecast every node + recommendations.
exports.runFarm = async (farm, nodes) => {
  const wx = await weatherWindow(farm);
  const forecasts = [];
  for (const n of nodes) forecasts.push(await forecastNode(n, wx));
  return { forecasts, recommendations: recommend(forecasts), weather: wx };
};

exports.latestFor = (deviceId) => latest.get(deviceId) || null;
exports.latestAll = (deviceIds) => deviceIds.map((id) => latest.get(id)).filter(Boolean);
exports.HORIZON_H = HORIZON_H;
exports.DRY_TARGET = DRY_TARGET;
