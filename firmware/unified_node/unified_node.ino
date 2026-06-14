/*
 * AquaVerse UNIFIED FIRMWARE — Phase 1 skeleton (resilient edge platform)
 * ───────────────────────────────────────────────────────────────────────────
 * ONE image for every ESP32 in the farm. WHO the board is (nodeId, farmId,
 * WiFi, ROLE) lives in NVS, set by the Serial wizard on first boot — so any
 * board can assume any role without reflashing.
 *
 * Phase 1 scope (no AI yet):
 *   • shared/protocol.h    binary control frames (magic 0xA5) + CRC16 self-test
 *   • shared/lora_config.h single source of radio truth
 *   • shared/roles.h       role + CLOUD/AUTONOMOUS mode tracker (heartbeat)
 *   • shared/storage.h     NVS provisioning
 *   • NODE role:           listens for heartbeat beacons, switches mode with
 *                          3-miss + jitter rule, reports a minimal compact-JSON
 *                          telemetry carrying `md` (mode) so the dashboard
 *                          can show CLOUD/AUTONOMOUS live.
 *   • COORDINATOR/UPLINK/GATEWAY roles: logged stubs (Phases 4+). The
 *     production gateway stays gateway_ra02.ino until parity.
 *
 * DUAL-STACK: telemetry remains compact JSON ('{' first byte); all control
 * traffic is binary (0xA5 first byte). Receivers route on byte 0.
 *
 * Non-blocking: no delay() in loop; LoRa RX is interrupt-driven (DIO0), the
 * same proven pattern as the production node firmware.
 *
 * Serial commands at runtime:  prov = re-run wizard · info = dump config
 */
#include <SPI.h>
#include <RadioLib.h>
#include <ArduinoJson.h>
#include "../shared/lora_config.h"
#include "../shared/protocol.h"
#include "../shared/roles.h"
#include "../shared/storage.h"

SX1278 radio = new Module(LORA_NSS, LORA_DIO0, LORA_RST, LORA_DIO1);

ConfigStore  store;
DeviceConfig cfg;
ModeTracker  modeTk;

volatile bool packetReady = false;
#if defined(ESP32)
void IRAM_ATTR onDio0() { packetReady = true; }
#else
void onDio0() { packetReady = true; }
#endif

uint16_t txSeq = 0;
uint32_t lastReport = 0;
#define REPORT_INTERVAL_MS 5000UL   // contract: ≥5 s (half-duplex listen window)

/* ── provisioning wizard ──────────────────────────────────────────────────── */
String promptLine(const char* label, const char* current) {
  Serial.printf("%s [%s]: ", label, current);
  String s;
  while (true) {
    while (!Serial.available()) delay(10);   // wizard only — blocking is fine here
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') break;
    s += c;
  }
  s.trim();
  Serial.println(s.length() ? s : String(current));
  return s.length() ? s : String(current);
}

void runWizard() {
  Serial.println("\n══════ AquaVerse provisioning wizard ══════");
  Serial.println("(enter = keep current value)");
  cfg.nodeId = (uint8_t)promptLine("nodeId (1-254, unique per farm)", String(cfg.nodeId).c_str()).toInt();
  promptLine("deviceId (e.g. node-2-433)", cfg.deviceId).toCharArray(cfg.deviceId, sizeof(cfg.deviceId));
  promptLine("farmId (Mongo ObjectId)",    cfg.farmId).toCharArray(cfg.farmId, sizeof(cfg.farmId));
  promptLine("WiFi SSID (used by GATEWAY/UPLINK roles)", cfg.wifiSsid).toCharArray(cfg.wifiSsid, sizeof(cfg.wifiSsid));
  promptLine("WiFi password",              cfg.wifiPass).toCharArray(cfg.wifiPass, sizeof(cfg.wifiPass));
  int r = promptLine("role (0=NODE 1=COORDINATOR 2=UPLINK 3=GATEWAY)", String((int)cfg.role).c_str()).toInt();
  cfg.role = (Role)constrain(r, 0, 3);
  cfg.provisioned = cfg.nodeId > 0 && strlen(cfg.deviceId) && strlen(cfg.farmId);
  store.save(cfg);
  Serial.printf("Saved. role=%s nodeId=%u dev=%s farm=%s\n",
                roleName(cfg.role), cfg.nodeId, cfg.deviceId, cfg.farmId);
  Serial.println("Rebooting…"); delay(300); ESP.restart();
}

/* ── radio helpers ────────────────────────────────────────────────────────── */
void armReceive() { radio.startReceive(); }

bool txRaw(const uint8_t* buf, size_t n) {
  radio.standby();
  int st = radio.transmit(buf, n);
  radio.setDio0Action(onDio0, RISING);
  armReceive();
  packetReady = false;            // TxDone raised DIO0 — don't read an empty FIFO
  return st == RADIOLIB_ERR_NONE;
}

bool txJson(JsonDocument& doc) {
  String out; serializeJson(doc, out);
  bool ok = txRaw((const uint8_t*)out.c_str(), out.length());
  Serial.printf("[TX%s] %s\n", ok ? "" : " FAIL", out.c_str());
  return ok;
}

/* ── NODE role ────────────────────────────────────────────────────────────── */
void nodeReport() {
  // Phase 1 minimal telemetry. The production sensor stack (soil/DHT/INA219/
  // valve/sleep) is ported in later phases; the new field is `md` (mode).
  JsonDocument doc;
  doc["type"] = "telemetry";
  doc["id"]   = cfg.deviceId;
  doc["q"]    = txSeq++;
  doc["md"]   = (uint8_t)modeTk.mode;           // 0 = CLOUD, 1 = AUTONOMOUS
  doc["ai"]   = modeTk.aiEnabled ? 1 : 0;       // echo of the dashboard switch
  doc["up"]   = millis() / 1000;
  txJson(doc);
}

void loopNode(uint32_t now) {
  if (now - lastReport >= REPORT_INTERVAL_MS) { lastReport = now; nodeReport(); }
  modeTk.tick(now);
  // Phase 2: in MODE_AUTONOMOUS && aiEnabled → run decision model, drive valve.
  // Phase 1: mode is tracked, logged and reported only.
}

/* ── stub roles (Phases 4+) ───────────────────────────────────────────────── */
void loopCoordinator(uint32_t) { /* Phase 4: beacon, arbitrate pumps, aggregate */ }
void loopUplink(uint32_t)      { /* Phase 4: LoRa→MQTT bridge over WiFi */ }
void loopGateway(uint32_t)     { /* parity port of gateway_ra02 — Phase 4+ */ }

/* ── RX dispatch ──────────────────────────────────────────────────────────── */
void handleIncoming() {
  uint8_t buf[LORA_MAX_PACKET + 1];
  size_t  n = radio.getPacketLength();
  if (n == 0 || n > LORA_MAX_PACKET) { armReceive(); return; }
  int st = radio.readData(buf, n);
  armReceive();
  if (st != RADIOLIB_ERR_NONE) return;

  if (protoIsBinary(buf, n)) {
    Frame f;
    if (!protoDecode(buf, n, f)) { Serial.println("[RX] bad CRC — dropped"); return; }
    switch (f.type) {
      case MSG_HEARTBEAT: modeTk.onBeacon(f); break;
      // Phase 4: MSG_ELECT / COORD_BEACON / PUMP_* / …
      default: Serial.printf("[RX] frame type 0x%02X from #%u (ignored in Phase 1)\n", f.type, f.nodeId);
    }
    return;
  }

  // Legacy JSON path (commands addressed to us by deviceId)
  buf[n] = 0;
  JsonDocument doc;
  if (deserializeJson(doc, (const char*)buf, n)) return;
  const char* target = doc["id"] | "";
  if (strlen(target) && strcmp(target, cfg.deviceId) != 0) return;
  Serial.printf("[CMD] %s\n", (const char*)(doc["type"] | "?"));
  // Phase 2+: valve/sleep command handling ports here from production firmware.
}

/* ── setup / loop ─────────────────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\n══ AquaVerse UNIFIED fw 0.1.0 (Phase 1) ══");
  if (!protoSelfTest()) { Serial.println("[FATAL] protocol self-test failed"); }

  if (!store.load(cfg)) { runWizard(); }
  Serial.printf("[BOOT] role=%s nodeId=%u dev=%s farm=%s\n",
                roleName(cfg.role), cfg.nodeId, cfg.deviceId, cfg.farmId);

  int st = radio.begin(LORA_FREQ, LORA_BW, LORA_SF, LORA_CR, LORA_SYNC, LORA_POWER);
  if (st != RADIOLIB_ERR_NONE) { Serial.printf("[LoRa] init FAILED %d\n", st); while (true) delay(1000); }
  radio.setCRC(true);
  radio.setDio0Action(onDio0, RISING);
  armReceive();
  Serial.printf("[LoRa] %.1f MHz SF%d BW%.0f sync 0x%02X\n", LORA_FREQ, LORA_SF, LORA_BW, LORA_SYNC);

  modeTk.begin();
  Serial.printf("[MODE] start CLOUD · autonomy after %lu ms of beacon silence\n",
                (unsigned long)(HB_MISS_LIMIT * HB_PERIOD_MS + modeTk.jitterMs));
}

void loop() {
  uint32_t now = millis();
  if (packetReady) { packetReady = false; handleIncoming(); }

  switch (cfg.role) {
    case ROLE_NODE:        loopNode(now);        break;
    case ROLE_COORDINATOR: loopCoordinator(now); break;
    case ROLE_UPLINK:      loopUplink(now);      break;
    case ROLE_GATEWAY:     loopGateway(now);     break;
  }

  // runtime serial commands
  if (Serial.available()) {
    String c = Serial.readStringUntil('\n'); c.trim();
    if (c == "prov") runWizard();
    else if (c == "info") Serial.printf("[INFO] role=%s id=%u dev=%s mode=%s ai=%d term=%u\n",
      roleName(cfg.role), cfg.nodeId, cfg.deviceId, modeName(modeTk.mode), modeTk.aiEnabled, cfg.term);
  }
}
