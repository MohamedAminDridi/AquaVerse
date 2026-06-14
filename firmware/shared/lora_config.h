#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// lora_config.h — SINGLE SOURCE OF TRUTH for radio parameters.
// Included by every sketch (unified_node, gateway). Any change here requires
// reflashing EVERY device on the network — params must match exactly or
// devices simply never hear each other.
// Extracted from the proven production values in smart_irrigation_node.ino
// and gateway_ra02.ino (SX1278 / RA-02 @ 433 MHz, RadioLib).
// ─────────────────────────────────────────────────────────────────────────────

#define LORA_FREQ   433.0     // MHz (RA-02 / SX1278)
#define LORA_BW     125.0     // kHz
#define LORA_SF     7         // SF7 = shortest airtime (~150 ms/pkt) → fewest collisions
#define LORA_CR     5         // coding rate 4/5
#define LORA_SYNC   0x12      // private-network sync word
#define LORA_POWER  14        // dBm (F3 adaptive radio will vary 2–17 at runtime)

// Default wiring (both existing boards use the same pins)
#define LORA_NSS    5
#define LORA_DIO0   26
#define LORA_RST    14
#define LORA_DIO1   -1

// Hard physical limit of the SX1278 FIFO — protocol.h enforces it.
#define LORA_MAX_PACKET 255
