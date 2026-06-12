# AquaVerse — Full Project Report
*Smart irrigation platform with a living 3D digital twin · June 2026*

---

## 1. System architecture

```
ESP32 NODE ──LoRa 433 MHz──► ESP32 GATEWAY ──MQTT/TLS──► BROKER ──► BACKEND ──REST+Socket.IO──► AQUAVERSE UI
(sensors,                    (WiFi bridge,               local      Node/Express              React + Three.js
 servo valve,                 pump relay)                Mosquitto   + MongoDB Atlas           Netlify / localhost
 deep sleep)                                             + HiveMQ
                                                         Cloud
```

| Piece | Tech | Where it runs |
|---|---|---|
| Node firmware | Arduino / ESP32 + RA-02 (SX1278) | field device |
| Gateway firmware | Arduino / ESP32 + RA-02, WiFi | field device (`USE_CLOUD` flag: local ↔ HiveMQ TLS) |
| Backend API | Node.js, Express, Mongoose, MQTT.js, Socket.IO, node-cron | localhost **and** Render (`aquaverse-api`) |
| Database | MongoDB Atlas (single source of truth for both backends) | cloud |
| Brokers | Mosquitto (LAN) + HiveMQ Cloud (TLS 8883) — backend listens to both, cloud toggleable | laptop + cloud |
| Frontend | React 18, Vite, Tailwind, Zustand, react-three-fiber/drei, Recharts | Netlify (`wicosmartirrigation`) + localhost |

---

## 2. Feature inventory

### 2.1 Node firmware (`node-firmware/smart_irrigation_node/`) — fw 2.1.0
- Sensors: capacitive soil moisture (GPIO 32), DHT22 temp/humidity, INA219 battery monitor (V/mA)
- **Coulomb-counting fuel gauge** (mAh integration, voltage reseed at rest, survives deep sleep in RTC memory, deep-sleep energy charged on wake via `DEEP_SLEEP_MA`)
- Battery: %, voltage, current, mAh, time-to-empty/full, charging detection
- **Servo valve** (GPIO 13, 0–100 % → 0–90°) with **soft-start ramp** (2°/15 ms — prevents brown-out)
- **Compact LoRa telemetry** (~140–170 B, under the 255 B limit): 1–2 char keys (`s,t,h,b,bv,bi,bm,tm,c,q,vp,p`), instant echo after every command
- **Deep-sleep duty cycle**: awake X / sleep Y, RTC-persisted, `esp_reset_reason` distinguishes wake vs reboot, valve-open *pauses* (never cancels) sleep, countdown fields (`slp/awk/nap/up`) reported each packet
- Command set: `valve_open/close`, `pump_start/stop` (logical), `sleep_now`, `sleep_config`, `wake`
- **LoRa FUOTA**: receives chunked firmware over LoRa with ACK/NACK per chunk

### 2.2 Gateway firmware (`Documents/Arduino/gateway_ra02/`) — fw 0.0.157+
- LoRa ↔ MQTT bridge, topic contract `farms/{farmId}/nodes/{id}/{telemetry|status|command|ota}`
- **One-line local ↔ cloud switch** (`USE_CLOUD`): plain MQTT :1883 or HiveMQ TLS :8883 (`WiFiClientSecure`)
- **MQTT Last Will + birth message** → backend shows gateway offline in ~9 s after power cut (keepalive 6 s)
- Pump relay (GPIO 27) driven by farm-level pump broadcasts
- Heartbeat every 10 s (rssi, ip, uptime, fw)
- OTA: downloads firmware over HTTP/HTTPS, flashes itself, or pushes to node via LoRa FUOTA

### 2.3 Backend (`smart-irrigation-api/`)
**MQTT layer**
- **Dual-broker client** — local always on, cloud connect/disconnect at runtime (`/api/system/broker` + persisted `SystemSetting`), publishes to all connected brokers
- Telemetry pipeline: compact-key parsing (old long keys still accepted), node DB update, time-series insert, Socket.IO push, valve/pump state inference (`vp>0`)
- **Pending-command queue** for sleeping nodes — flushed on the node's wake telemetry; *command families* (`valve_*`, `sleep_*`) where the newest intent voids queued siblings; 15-min TTL
- **Valve ACK + retry**: re-sends until the node's echo confirms (4 retries, 1.8 s apart); newest click cancels older loops
- Gateway LWT/birth handling → instant offline/online

**REST API** (JWT auth, role-based: admin/manager/viewer)
- Auth (register/login/refresh/me), Users (admin CRUD), Farms, Gateways, Nodes (CRUD + twin layout persistence)
- Irrigation: valve open/close/toggle (%), shared-pump reconciler (pump runs while ANY valve open), manual pump
- **Sleep API**: config (awake/sleep min), 24 h band schedule, sleep-now/wake, all queue-aware
- Schedules (cron-driven valve windows), Alerts + AlertRules engine, Analytics summary, Sensor history (24 h buckets)
- Weather (Open-Meteo live + 3-day daily forecast w/ solar score), OTA firmware upload/manage (public ESP32 download route — intentionally no-auth)
- `/api/health` public keep-alive endpoint

**Jobs (cron)**
- Offline sweep every 20 s: gateways 35 s cutoff, nodes 30 s, **sleeping nodes 1.5× duty cycle** (+ pump_state cleared on offline)
- Schedule executor, sleep band scheduler, daily sleep window, weather refresh (15 min), keep-alive self-ping (10 min, Render)

**Realtime (Socket.IO)** — farm rooms; events: `sensor:data`, `node:status`, `gateway:status`, `alert:new`, `weather:update`

### 2.4 Frontend (`admin-panel/`)
**AquaVerse 3D twin (FarmTwinPage — the product centerpiece)**
- Live 3D farm: terrain plots, crops (20+ species, growth tied to soil), gateway + pump models, LoRa chain links
- Day/night cycle, sun/moon, weather system (live Open-Meteo or demo override), cyberpunk night neon
- Drag-edit layout (persisted per node), plot customization (size/rotation/color/crop/label)
- **Digital layers**: Comms (real packet pulses, RSSI spectrum), Water (pipe network + per-node inner pipelines), Energy (solar/battery flows + tags), **Sleep** (countdown tags, schedule editor), Prediction (3-day future overlay re-skinning the sky), AI, Climate, Biology (roots), **🌐 All** (per-layer toggles + unified per-node floating HUD with all metrics + valve control + hide chip)
- Node HUD/labels: status (sleep-blue/green/red), soil/temp/hum/battery/RSSI, battery runtime, **schedule-projected battery life**, sleep countdown anchored to the node's own clock
- **Valve UX**: % picker, pending "⏳ Opening…" lock until device echo (8 s backup), 60 s `liveOn` grace so status blips never flap buttons/pump/spray
- Sleep control: master toggle (true device-state driven, desync warning), awake/sleep durations, 24 h band editor with presets
- Detail panel: metrics, 24 h sparklines (localStorage-cached), valve control, sleep panel — available in every layer
- Cinematic camera, top-down map, fullscreen, playback scaffold, alerts bell with fly-to
- **State persistence**: live telemetry + sleep anchors per farm in localStorage (status intentionally NOT restored)

**Other pages**: Dashboard (stats + 7-day analytics), Farms/Detail, Gateways, Nodes, Users/Detail, Alerts (ack flow), Analytics (farm→node→24 h chart), OTA manager, Settings (**cloud-broker live toggle**), Login/Register
**Shell**: collapsible sidebar (persisted), topbar alerts badge, toast stack

### 2.5 DevOps
- `render.yaml` blueprint, `DEPLOY.md` guide, `.env.example`s for both profiles, `.env.render` paste-file (gitignored)
- Dual-environment: `VITE_API_URL` switch + comma-list CORS; production log hygiene (errors-only HTTP log, per-packet logs at debug)

---

## 3. Cleanup performed (this pass)

**Deleted — confirmed unreferenced by any route, import, or page:**

| File | Why dead |
|---|---|
| `services/command.service.js` | never imported anywhere |
| `services/auth.service.js` | never imported (controller uses jwtHelper directly) |
| `services/notification.service.js` + `controllers/notification.controller.js` + `routes/notification.routes.js` + `models/Notification.model.js` | Twilio/Firebase push stack — frontend never calls `/api/notifications`, creds never configured |
| `controllers/ai.controller.js` + `routes/ai.routes.js` | placeholder fake "LSTM" predictions; frontend never calls `/api/ai` |
| `controllers/automation.controller.js` + `routes/automation.routes.js` + `models/AutomationRule.model.js` | automation CRUD with no UI and no engine hook |
| `config/redis.js` (+ server.js hook) | zero consumers of `getRedis()` — cache that cached nothing |
| `hooks/useFarmSocket.js` | superseded by `useSocket`/`useTwinTelemetry` |
| `components/charts/SensorChart.jsx`, `WaterUsageChart.jsx`, `components/ui/DataTable.jsx` | never imported |

**Dependencies removed**: `ioredis`, `twilio`, `firebase-admin` (≈ 60 MB of node_modules / faster Render builds). Run `npm install` in `smart-irrigation-api` to prune the lockfile.

**Fixed**: `AnalyticsPage` called `/nodes/undefined/history` (never worked) — now farm → node pickers → real 24 h chart.

**Kept deliberately**: AlertRules (wired into the telemetry alert engine), seeder (`npm run seed`), tests, joi validators (auth), multer (OTA uploads), `User.notifications` prefs + `Command.source` enum (harmless schema fields).

**Verified after cleanup**: backend `require('./src/app')` loads clean; `vite build` passes.

---

## 4. Known issues & honest debts

| Area | Issue |
|---|---|
| **Soil sensor** | `soil_raw=0` always — sensor dead/disconnected at GPIO 32; UI shows 100 % constantly |
| **RF reliability** | Downlink (gateway→node) loses ~half its packets; retries mask it. Strong evidence of servo electrical noise (node also went silent 30 s+ with valve open). Test: unplug servo +; fixes: cap at servo, twisted leads, `valveServo.detach()` after moves |
| **Battery calibration** | Awake draw reads ~6.6 mA (low for ESP32+LoRa — INA219 may not see the whole circuit); `DEEP_SLEEP_MA 0.5` is an assumption — tune both or projections are off |
| **Two-brain hazard** | Laptop backend (cloud toggle ON) + Render simultaneously = duplicate readings + competing crons. Rule: one brain per broker |
| **Render free tier** | Sleeps despite keep-alive if redeployed/crashed; OTA uploads wiped per deploy (ephemeral disk). Starter plan or S3 for production |
| **Secrets hygiene** | Atlas + HiveMQ passwords were pasted in chat/committed configs — rotate both; `JWT_SECRET` still placeholder on laptop |
| **TLS** | Gateway uses `setInsecure()` (encrypted, not verified) — pin ISRG Root X1 for production |
| **Tests** | Only auth has tests; MQTT pipeline/valve/sleep logic untested |
| **FarmTwinPage size** | ~4,300 lines in one file — works, but splitting into modules would help future work |

---

## 5. What I'd do next (priority order)
1. Fix the soil sensor (hardware) — the platform's core reading is currently fiction
2. Servo-noise hunt (unplug test → cap/detach) — make first-click valve the norm
3. Rotate exposed credentials
4. `npm install` in the API + push → leaner Render build
5. Split FarmTwinPage into modules when adding the next 3D feature
