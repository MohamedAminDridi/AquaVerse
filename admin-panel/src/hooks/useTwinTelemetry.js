import { useMemo } from 'react';
import { useSocket } from './useSocket';
import { useTwinStore } from '../store/twinStore';

// Subscribes to the same realtime events the dashboard uses and funnels them
// into the twin store keyed by device_id. Reuses the shared useSocket hook
// (auth, room join/leave, reconnection) so there's a single socket convention.
export function useTwinTelemetry(farmId) {
  const apply = useTwinStore((s) => s.apply);
  const setWeather = useTwinStore((s) => s.setWeather);
  const recordPacket = useTwinStore((s) => s.recordPacket);
  const firePacket = useTwinStore((s) => s.firePacket);

  const handlers = useMemo(() => ({
    // Live weather broadcast (Open-Meteo → backend → Socket.IO → 3D scene).
    // Skip while a manual demo override is active so it isn't overwritten.
    'weather:update': (w) => { if (!useTwinStore.getState().weatherLocked) setWeather(w); },
    'sensor:data': (d) => { recordPacket(d.deviceId, d.seq); firePacket(d.deviceId, -1); return apply(d.deviceId, {
      soil:   d.soil_moisture_pct,
      temp:   d.temperature_c,
      hum:    d.humidity_pct,
      bat:    d.battery_pct,
      rssi:   d.rssi,
      status: 'online',
      ...(d.battery_charging != null ? { charging: d.battery_charging } : {}),
      ...(d.battery_v != null ? { bat_v: d.battery_v } : {}),
      ...(d.battery_ma != null ? { bat_ma: d.battery_ma } : {}),
      ...(d.battery_mah != null ? { bat_mah: d.battery_mah } : {}),
      ...(d.battery_time_min != null ? { time_min: d.battery_time_min } : {}),
      // Telemetry handler now co-emits valve/pump when present in the packet
      ...(d.valve_state != null || d.valve != null
        ? { valve: d.valve_state ?? d.valve, valve_pct: d.valve_pct ?? null }
        : {}),
      ...(d.pump_state != null || d.pump != null
        ? { pump: d.pump_state ?? d.pump }
        : {}),
      // Resilience mode + AI Brain layer (shadow verdicts, sensor trust)
      ...(d.sys_mode != null ? { sysMode: d.sys_mode } : {}),
      ...(d.ai_flag  != null ? { aiFlag:  d.ai_flag  } : {}),
      ...(d.ai_dec   != null ? { aiDec:   d.ai_dec   } : {}),
      ...(d.ai_trust != null ? { aiTrust: d.ai_trust } : {}),
      // Real duty-cycle timing from the node (LoRa). slpStamp marks when slpUp
      // was measured so the countdown can extrapolate from the device clock.
      ...(d.slp_on  != null ? { slpOn: d.slp_on, slpStamp: Date.now() } : {}),
      ...(d.slp_awk != null ? { slpAwk: d.slp_awk } : {}),
      ...(d.slp_nap != null ? { slpNap: d.slp_nap } : {}),
      ...(d.slp_up  != null ? { slpUp:  d.slp_up  } : {}),
    }); },
    // Shadow AI decision changed for a node → feed the AI Brain ledger live.
    'ai:decision': (d) => useTwinStore.getState().addAiDecision(d),
    'node:status': (d) => apply(d.device_id ?? d.deviceId, {
      status: d.status,
      valve:  d.valve ?? d.valve_state,
      pump:   d.pump  ?? d.pump_state,
      ...(d.valve_pct != null ? { valve_pct: d.valve_pct } : {}),
      ...(d.fw ? { firmware_version: d.fw } : {}),
    }),
    'gateway:status': (d) => apply(d.device_id, {
      status:   d.status,
      rssi:     d.rssi,
      uptime_s: d.uptime_s,
      ...(d.fw ? { firmware_version: d.fw } : {}),
    }),
    connect:    () => useTwinStore.getState().setLive(true),
    disconnect: () => useTwinStore.getState().setLive(false),
  }), [apply, setWeather, recordPacket, firePacket]);

  return useSocket(farmId, handlers);
}
