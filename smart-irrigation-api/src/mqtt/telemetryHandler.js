const SensorReading  = require('../models/SensorReading.model');
const Node           = require('../models/Node.model');
const Alert          = require('../models/Alert.model');
const alertService   = require('../services/alert.service');
const { emitToFarm } = require('../socket/socketServer');
const pendingCommands = require('./pendingCommands');
const logger         = require('../utils/logger');

/**
 * Handles: farms/{farmId}/nodes/{nodeId}/telemetry
 *
 * ESP32 payload: { id, soil, temp, hum, bat, seq }
 * Gateway adds:  { lora_rssi, lora_snr, gw, ts }
 */
module.exports = async function handleTelemetry(farmId, nodeDeviceId, payload) {
  try {
    const node = await Node.findOne({ device_id: nodeDeviceId });
    if (!node) {
      logger.warn(`⚠️  Unknown node "${nodeDeviceId}" — register it in the dashboard`);
      return;
    }

    // The node just reported → it's awake in its RX window right now. Flush any
    // commands queued while it was asleep (valve, sleep_config, wake) so they
    // land inside this listen window. Lazy require avoids a circular dep
    // (mqttClient → telemetryHandler → mqttClient).
    const { publish } = require('./mqttClient');
    const flushed = pendingCommands.flush(node.device_id, publish);
    if (flushed) logger.info(`📨 Delivered ${flushed} queued command(s) to ${nodeDeviceId} on wake`);

    // Compact ESP32 field names (LoRa-size-optimised) → meaningful names. The
    // older long keys are still accepted so a not-yet-reflashed node keeps working.
    //   s/t/h/b soil,temp,hum,battery%  ·  bv/bi/bm volts,mA,mAh  ·  tm min left
    //   c charging(0/1)  ·  q seq  ·  vp valve%  ·  p pump(0/1)
    const soil = payload.s ?? payload.soil ?? null;
    const temp = payload.t ?? payload.temp ?? null;
    const hum  = payload.h ?? payload.hum  ?? null;
    const bat  = payload.b ?? payload.bat  ?? null;
    const rssi = payload.lora_rssi ?? payload.rssi ?? null;
    const seq  = payload.q ?? payload.seq ?? null;
    // INA219 battery monitor fields
    const charging = payload.c != null ? !!payload.c : (payload.charging ?? null);  // bool: charging?
    const batV     = payload.bv ?? payload.bat_v   ?? null;   // bus voltage (V)
    const batMa    = payload.bi ?? payload.bat_ma  ?? null;   // current (mA, + discharge / − charge)
    const batMah   = payload.bm ?? payload.bat_mah ?? null;   // coulomb-counted charge remaining (mAh)
    const timeMin  = payload.tm ?? payload.time_min ?? null;  // minutes to full (charging) / empty

    // Valve / pump state. The compact packet sends only vp (valve %) and p (pump
    // 0/1); the valve open/closed state is inferred from vp>0. Long forms accepted.
    const valvePct   = payload.vp ?? payload.valve_pct ?? null;
    let   valveState = payload.valve_state ?? payload.valve ?? null;
    if (valveState == null && valvePct != null) valveState = valvePct > 0 ? 'open' : 'closed';
    let   pumpState  = payload.pump_state ?? payload.pump ?? null;
    if (pumpState == null && payload.p != null) pumpState = payload.p ? 'on' : 'off';

    // Deep-sleep duty-cycle timing reported by the node (slp/awk/nap/up). The
    // dashboard anchors its awake↔sleep countdown to these real device clocks.
    const slpOn  = payload.slp != null ? !!payload.slp : null;  // sleep mode active?
    const slpAwk = payload.awk ?? null;                          // awake window (s)
    const slpNap = payload.nap ?? null;                          // sleep window (s)
    const slpUp  = payload.up  ?? null;                          // s since this wake

    // Update node live state (including valve/pump so the DB is always accurate)
    await Node.findByIdAndUpdate(node._id, {
      status:      'online',
      last_seen:   new Date(),
      battery_pct: bat,
      ...(charging != null ? { battery_charging: charging } : {}),
      ...(batV     != null ? { battery_v: batV } : {}),
      ...(batMa    != null ? { battery_ma: batMa } : {}),
      ...(valveState != null  ? { valve_state: valveState } : {}),
      ...(valvePct   != null  ? { valve_pct:   valvePct   } : {}),
      ...(pumpState  != null  ? { pump_state:  pumpState  } : {}),
      ...(payload.fw          ? { firmware_version: payload.fw } : {}),
    });

    // Save to time-series collection — match schema exactly:
    //   ts          = timeField  (required Date)
    //   meta        = metaField  (nodeId, farmId, deviceId)
    //   soil_moisture_pct, temperature_c, humidity_pct, battery_pct, rssi
    await SensorReading.create({
      ts: payload.ts ? new Date(payload.ts) : new Date(),
      meta: {
        nodeId:   node._id,
        farmId:   node.farm,
        deviceId: node.device_id,
      },
      soil_moisture_pct: soil,
      temperature_c:     temp,
      humidity_pct:      hum,
      battery_pct:       bat,
      rssi,
    });

    // Push real-time sensor data to dashboard
    emitToFarm(farmId, 'sensor:data', {
      nodeId:            node._id,
      deviceId:          node.device_id,
      name:              node.name,
      soil_moisture_pct: soil,
      temperature_c:     temp,
      humidity_pct:      hum,
      battery_pct:       bat,
      battery_charging:  charging,
      battery_v:         batV,
      battery_ma:        batMa,
      battery_mah:       batMah,
      battery_time_min:  timeMin,
      rssi,
      seq,
      // Sleep duty-cycle timing (omitted when the node isn't duty-cycling).
      ...(slpOn  != null ? { slp_on:  slpOn  } : {}),
      ...(slpAwk != null ? { slp_awk: slpAwk } : {}),
      ...(slpNap != null ? { slp_nap: slpNap } : {}),
      ...(slpUp  != null ? { slp_up:  slpUp  } : {}),
      ts:  new Date(),
    });

    // Push valve/pump state update instantly so the 3D twin and dashboards
    // reflect the real device state without waiting for a separate status packet.
    if (valveState != null || pumpState != null) {
      emitToFarm(farmId, 'node:status', {
        device_id:  node.device_id,
        status:     'online',
        valve:      valveState,
        valve_pct:  valvePct,
        pump:       pumpState,
        fw:         payload.fw ?? null,
        ts:         new Date(),
      });
    }

    // debug: fires every report (~5 s/node) — hidden in production logs
    logger.debug(`📊 [${nodeDeviceId}] soil=${soil}% temp=${temp}°C hum=${hum}% bat=${bat}% rssi=${rssi} valve=${valveState ?? '?'} pump=${pumpState ?? '?'}`);

    // ── Battery low alert (< 30%) — 30-minute cooldown ───────────────
    if (bat !== null && bat < 30) {
      const recentBatAlert = await Alert.findOne({
        node:         node._id,
        type:         'low_battery',
        acknowledged: false,
        createdAt:    { $gt: new Date(Date.now() - 30 * 60 * 1000) },
      });
      if (!recentBatAlert) {
        const alert = await Alert.create({
          farm:      node.farm,
          node:      node._id,
          type:      'low_battery',
          severity:  bat < 15 ? 'critical' : 'warning',
          message:   `Node "${nodeDeviceId}" battery low: ${bat}%`,
          metric:    'battery_pct',
          value:     bat,
          threshold: 30,
        });
        emitToFarm(farmId, 'alert:new', alert.toObject());
        logger.warn(`🔋 Low battery alert: ${nodeDeviceId} = ${bat}%`);
      }
    }

    // ── Evaluate user-defined AlertRules ─────────────────────────────
    await alertService.checkAlertRules(node._id, node.farm, {
      soil_moisture_pct: soil,
      temperature_c:     temp,
      humidity_pct:      hum,
      battery_pct:       bat,
    });

  } catch (err) {
    logger.error(`Telemetry handler error [${nodeDeviceId}]: ${err.message}`);
  }
};