#pragma once
#include <Arduino.h>
#include "protocol.h"
// ─────────────────────────────────────────────────────────────────────────────
// roles.h — role + system-mode state machine (Phase 1 scope).
//
// Role  = WHAT this device is (runtime, persisted in NVS, any board can be any):
//   ROLE_NODE        sensor node — keeps the deep-sleep duty cycle (NODE-only!)
//   ROLE_COORDINATOR elected stand-in for a dead gateway (Phase 4) — always-on
//   ROLE_UPLINK      LoRa→MQTT bridge delegated by a coordinator (Phase 4) — always-on
//   ROLE_GATEWAY     mains-powered LoRa↔MQTT bridge — always-on
//
// Mode = HOW MUCH of the brain is reachable (derived from heartbeat beacons):
//   MODE_CLOUD       backend heartbeat flowing — cloud decides, node obeys
//   MODE_AUTONOMOUS  3 consecutive beacons missed (+0–2 s random jitter so the
//                    whole farm doesn't flip in the same instant) — the node's
//                    edge AI may decide locally (Phase 2+, and only when the
//                    dashboard's AI switch is ON)
// ─────────────────────────────────────────────────────────────────────────────

enum Role : uint8_t { ROLE_NODE = 0, ROLE_COORDINATOR = 1, ROLE_UPLINK = 2, ROLE_GATEWAY = 3 };
enum SysMode : uint8_t { MODE_CLOUD = 0, MODE_AUTONOMOUS = 1 };

static inline const char* roleName(Role r) {
  switch (r) { case ROLE_NODE: return "NODE"; case ROLE_COORDINATOR: return "COORDINATOR";
               case ROLE_UPLINK: return "UPLINK"; case ROLE_GATEWAY: return "GATEWAY"; }
  return "?";
}
static inline const char* modeName(SysMode m) { return m == MODE_CLOUD ? "CLOUD" : "AUTONOMOUS"; }

// Beacon cadence contract (backend publishes every 10 s; gateway relays).
#define HB_PERIOD_MS      10000UL
#define HB_MISS_LIMIT     3        // 3 consecutive misses → AUTONOMOUS

struct ModeTracker {
  SysMode  mode          = MODE_CLOUD;
  uint32_t lastBeaconMs  = 0;       // millis() of last beacon heard
  uint32_t lastCloudSeq  = 0;
  bool     cloudUp       = false;   // last beacon's CLOUD_UP flag
  bool     aiEnabled     = false;   // last beacon's AI_ENABLED flag (dashboard switch)
  uint32_t jitterMs      = 0;       // per-device random 0–2000 ms (set in begin())
  bool     everHeard     = false;

  void begin() { jitterMs = (uint32_t)esp_random() % 2000; lastBeaconMs = millis(); }

  // Call on every decoded MSG_HEARTBEAT frame.
  void onBeacon(const Frame& f) {
    if (f.len < 6) return;
    uint32_t seq; uint8_t flags;
    hbUnpack(f.payload, seq, flags);
    lastBeaconMs = millis();
    lastCloudSeq = seq;
    everHeard    = true;
    cloudUp      = flags & HB_FLAG_CLOUD_UP;
    aiEnabled    = flags & HB_FLAG_AI_ENABLED;
    // Gateway alive but cloud silent is ALSO autonomous (the brain is gone) —
    // the beacon keeps time/AI flags flowing while we decide locally.
    SysMode next = cloudUp ? MODE_CLOUD : MODE_AUTONOMOUS;
    announce(next, cloudUp ? "beacon: cloud up" : "beacon: gateway up, CLOUD DOWN");
  }

  // Call every loop. Handles total beacon silence (gateway dead too).
  void tick(uint32_t now) {
    uint32_t limit = HB_MISS_LIMIT * HB_PERIOD_MS + jitterMs;
    if (now - lastBeaconMs > limit)
      announce(MODE_AUTONOMOUS, "3 beacons missed");
  }

  void announce(SysMode next, const char* why) {
    if (next == mode) return;
    mode = next;
    Serial.printf("[MODE] -> %s (%s)\n", modeName(mode), why);
  }
};
