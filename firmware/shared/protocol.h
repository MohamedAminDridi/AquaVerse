#pragma once
#include <stdint.h>
#include <string.h>
// ─────────────────────────────────────────────────────────────────────────────
// protocol.h — binary control-frame protocol for the resilience layer.
//
// DUAL-STACK DESIGN (documented decision):
//   • Telemetry / alive packets stay COMPACT JSON exactly as today — the
//     gateway, backend and dashboard keep working untouched.
//   • All NEW control traffic (heartbeat beacons, election, pump arbitration,
//     ACKs, sync) uses this compact binary frame.
//   • Discrimination is one byte: JSON always starts with '{' (0x7B); binary
//     frames always start with PROTO_MAGIC (0xA5). Every receiver checks
//     byte 0 and routes to the right parser. Zero ambiguity, zero migration.
//
// Wire format (little-endian):
//   [magic:u8][nodeId:u8][msgType:u8][term:u16][seq:u16][len:u8]
//   [payload: len ≤ PROTO_MAX_PAYLOAD][crc16:u16]
//   crc16 = CRC-16/CCITT-FALSE over bytes 0..(8+len-1)  (everything before CRC)
// ─────────────────────────────────────────────────────────────────────────────

#define PROTO_MAGIC        0xA5
#define PROTO_MAX_PAYLOAD  50
#define PROTO_HDR_LEN      8                    // magic..len inclusive
#define PROTO_MAX_FRAME    (PROTO_HDR_LEN + PROTO_MAX_PAYLOAD + 2)
#define PROTO_BROADCAST_ID 0xFF                 // nodeId meaning "everyone"

enum MsgType : uint8_t {
  MSG_SENSOR           = 0x01,  // reserved — telemetry stays JSON until Phase 6
  MSG_DECISION         = 0x02,  // F1 autonomous decision record
  MSG_HEARTBEAT        = 0x03,  // cloud/gateway beacon (payload below)
  MSG_ELECT            = 0x04,  // candidacy broadcast {score:i32}
  MSG_COORD_BEACON     = 0x05,  // coordinator alive {netTime:u32}
  MSG_CONFLICT         = 0x06,  // split-brain report {idA,scoreA,idB,scoreB}
  MSG_STEPDOWN         = 0x07,  // coordinator resigns
  MSG_PUMP_REQ         = 0x08,  // follower asks to irrigate {durS:u16}
  MSG_PUMP_GRANT       = 0x09,  // coordinator grants {toId:u8,durS:u16}
  MSG_PUMP_WAIT        = 0x0A,  // coordinator defers {toId:u8,posInQueue:u8}
  MSG_UPLINK_PROBE_REQ = 0x0B,  // coordinator asks followers to try WiFi
  MSG_UPLINK_OK        = 0x0C,  // follower reached WiFi → becomes uplink
  MSG_SYNC_DATA        = 0x0D,  // buffered-record transfer chunk
  MSG_ACK              = 0x0E,  // generic ack {ackSeq:u16,ofType:u8}
};

// HEARTBEAT payload (6 bytes): [cloudSeq:u32][flags:u8][reserved:u8]
//   flags bit0 = CLOUD_UP    (1: backend heartbeat fresh; 0: gateway alive but cloud silent)
//   flags bit1 = AI_ENABLED  (global edge-AI switch from the dashboard)
//   flags bit2 = GW_PRIORITY (a real gateway is back — coordinator must step down; Phase 4)
#define HB_FLAG_CLOUD_UP   0x01
#define HB_FLAG_AI_ENABLED 0x02
#define HB_FLAG_GW_PRIORITY 0x04

struct Frame {
  uint8_t  nodeId;
  uint8_t  type;
  uint16_t term;
  uint16_t seq;
  uint8_t  len;
  uint8_t  payload[PROTO_MAX_PAYLOAD];
};

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — standard, table-free.
static inline uint16_t protoCrc16(const uint8_t* d, size_t n) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < n; i++) {
    crc ^= (uint16_t)d[i] << 8;
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : (crc << 1);
  }
  return crc;
}

// Serialise → buf (must hold PROTO_MAX_FRAME). Returns wire length, 0 on error.
static inline size_t protoEncode(const Frame& f, uint8_t* buf) {
  if (f.len > PROTO_MAX_PAYLOAD) return 0;
  buf[0] = PROTO_MAGIC;
  buf[1] = f.nodeId;
  buf[2] = f.type;
  buf[3] = f.term & 0xFF;  buf[4] = f.term >> 8;
  buf[5] = f.seq  & 0xFF;  buf[6] = f.seq  >> 8;
  buf[7] = f.len;
  memcpy(buf + PROTO_HDR_LEN, f.payload, f.len);
  uint16_t crc = protoCrc16(buf, PROTO_HDR_LEN + f.len);
  buf[PROTO_HDR_LEN + f.len]     = crc & 0xFF;
  buf[PROTO_HDR_LEN + f.len + 1] = crc >> 8;
  return PROTO_HDR_LEN + f.len + 2;
}

// Parse buf → f. Returns true only on magic + length + CRC all valid.
static inline bool protoDecode(const uint8_t* buf, size_t n, Frame& f) {
  if (n < PROTO_HDR_LEN + 2 || buf[0] != PROTO_MAGIC) return false;
  uint8_t len = buf[7];
  if (len > PROTO_MAX_PAYLOAD || n < (size_t)(PROTO_HDR_LEN + len + 2)) return false;
  uint16_t rx  = buf[PROTO_HDR_LEN + len] | (buf[PROTO_HDR_LEN + len + 1] << 8);
  if (rx != protoCrc16(buf, PROTO_HDR_LEN + len)) return false;
  f.nodeId = buf[1];
  f.type   = buf[2];
  f.term   = buf[3] | (buf[4] << 8);
  f.seq    = buf[5] | (buf[6] << 8);
  f.len    = len;
  memcpy(f.payload, buf + PROTO_HDR_LEN, len);
  return true;
}

// Is this raw radio buffer a binary control frame (vs legacy JSON)?
static inline bool protoIsBinary(const uint8_t* buf, size_t n) {
  return n > 0 && buf[0] == PROTO_MAGIC;
}

// Heartbeat payload helpers
static inline void hbPack(uint8_t* p, uint32_t cloudSeq, uint8_t flags) {
  p[0] = cloudSeq & 0xFF; p[1] = (cloudSeq >> 8) & 0xFF;
  p[2] = (cloudSeq >> 16) & 0xFF; p[3] = (cloudSeq >> 24) & 0xFF;
  p[4] = flags; p[5] = 0;
}
static inline void hbUnpack(const uint8_t* p, uint32_t& cloudSeq, uint8_t& flags) {
  cloudSeq = (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
  flags = p[4];
}

// Compile-time/self test (call once from setup() in debug builds)
static inline bool protoSelfTest() {
  Frame a{}; a.nodeId = 7; a.type = MSG_HEARTBEAT; a.term = 1; a.seq = 42; a.len = 6;
  hbPack(a.payload, 123456, HB_FLAG_CLOUD_UP | HB_FLAG_AI_ENABLED);
  uint8_t buf[PROTO_MAX_FRAME];
  size_t n = protoEncode(a, buf);
  Frame b{};
  if (!protoDecode(buf, n, b)) return false;
  uint32_t s; uint8_t fl; hbUnpack(b.payload, s, fl);
  return b.nodeId == 7 && b.seq == 42 && s == 123456 && (fl & HB_FLAG_AI_ENABLED);
}
