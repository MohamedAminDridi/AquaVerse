#pragma once
#include <Preferences.h>
#include "roles.h"
// ─────────────────────────────────────────────────────────────────────────────
// storage.h — NVS-backed device identity & provisioning (Preferences API).
// One firmware image for every ESP32: WHO a board is lives here, not in code.
// Set on first boot through the Serial wizard (unified_node.ino) and editable
// any time by typing `prov` into the serial console.
// ─────────────────────────────────────────────────────────────────────────────

struct DeviceConfig {
  bool     provisioned = false;
  uint8_t  nodeId      = 0;          // short id used in binary frames (1..254)
  char     deviceId[24] = "";        // human id, e.g. "node-1-433" (JSON telemetry)
  char     farmId[28]   = "";        // Mongo ObjectId string for MQTT topics
  char     wifiSsid[33] = "";
  char     wifiPass[64] = "";
  Role     role        = ROLE_NODE;
  uint16_t term        = 0;          // election term (Phase 4) — persists across reboots
};

class ConfigStore {
 public:
  bool load(DeviceConfig& c) {
    Preferences p;
    if (!p.begin("aqv", true)) return false;   // read-only namespace
    c.provisioned = p.getBool("ok", false);
    c.nodeId      = p.getUChar("nid", 0);
    p.getString("dev",  c.deviceId, sizeof(c.deviceId));
    p.getString("farm", c.farmId,   sizeof(c.farmId));
    p.getString("ssid", c.wifiSsid, sizeof(c.wifiSsid));
    p.getString("pass", c.wifiPass, sizeof(c.wifiPass));
    c.role = (Role)p.getUChar("role", ROLE_NODE);
    c.term = p.getUShort("term", 0);
    p.end();
    return c.provisioned;
  }

  void save(const DeviceConfig& c) {
    Preferences p;
    p.begin("aqv", false);
    p.putBool("ok", c.provisioned);
    p.putUChar("nid", c.nodeId);
    p.putString("dev",  c.deviceId);
    p.putString("farm", c.farmId);
    p.putString("ssid", c.wifiSsid);
    p.putString("pass", c.wifiPass);
    p.putUChar("role", (uint8_t)c.role);
    p.putUShort("term", c.term);
    p.end();
  }

  // Election term changes often (Phase 4) — tiny dedicated writer.
  void saveTerm(uint16_t term) {
    Preferences p; p.begin("aqv", false); p.putUShort("term", term); p.end();
  }

  void wipe() { Preferences p; p.begin("aqv", false); p.clear(); p.end(); }
};
