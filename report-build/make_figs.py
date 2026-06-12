# Generates all report figures as PNGs (matplotlib, schematic style).
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import os

OUT = os.path.join(os.path.dirname(__file__), 'figs')
os.makedirs(OUT, exist_ok=True)

C_NODE = '#dcfce7'; C_GW = '#dbeafe'; C_BROKER = '#fef9c3'; C_BACK = '#fae8ff'; C_UI = '#e0f2fe'; C_DB = '#fee2e2'
EDGE = '#334155'

def box(ax, x, y, w, h, text, fc='#f1f5f9', fs=10, bold=True):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.08",
                                fc=fc, ec=EDGE, lw=1.4))
    ax.text(x + w/2, y + h/2, text, ha='center', va='center', fontsize=fs,
            fontweight='bold' if bold else 'normal', color='#0f172a')

def arrow(ax, x1, y1, x2, y2, label='', color='#0369a1', ls='-', fs=8.5, lw=1.8, dy=0.12):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle='-|>', mutation_scale=14,
                                 color=color, lw=lw, linestyle=ls))
    if label:
        ax.text((x1+x2)/2, (y1+y2)/2 + dy, label, ha='center', va='bottom',
                fontsize=fs, color=color, fontweight='bold')

# ── Fig 1: global architecture ───────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(13, 6.2))
ax.set_xlim(0, 13); ax.set_ylim(0, 6.2); ax.axis('off')
box(ax, 0.2, 2.3, 2.1, 1.6, "SENSOR NODE\nESP32 + RA-02\nsoil · DHT22 · INA219\nservo valve\ndeep sleep", C_NODE, 9)
box(ax, 3.3, 2.3, 2.0, 1.6, "GATEWAY\nESP32 + RA-02\nWiFi bridge\npump relay", C_GW, 9)
box(ax, 6.2, 3.6, 2.2, 1.1, "HiveMQ Cloud\nMQTT/TLS :8883", C_BROKER, 9)
box(ax, 6.2, 1.4, 2.2, 1.1, "Mosquitto (LAN)\nMQTT :1883", C_BROKER, 9)
box(ax, 9.2, 2.2, 2.2, 1.8, "BACKEND\nNode/Express\nMQTT · Socket.IO\nREST · cron jobs", C_BACK, 9)
box(ax, 9.2, 4.7, 2.2, 1.1, "MongoDB Atlas\nsingle source of truth", C_DB, 9)
box(ax, 9.2, 0.2, 2.2, 1.2, "AquaVerse UI\nReact + Three.js\nNetlify / localhost", C_UI, 9)
arrow(ax, 2.3, 3.1, 3.3, 3.1, "LoRa 433 MHz\nSF7 BW125", '#16a34a')
arrow(ax, 5.3, 3.45, 6.2, 4.0, "USE_CLOUD=1", '#b45309')
arrow(ax, 5.3, 2.75, 6.2, 2.0, "USE_CLOUD=0", '#b45309')
arrow(ax, 8.4, 4.1, 9.2, 3.6, "", '#0369a1')
arrow(ax, 8.4, 1.95, 9.2, 2.5, "toggle ☁", '#0369a1')
arrow(ax, 10.3, 4.0, 10.3, 4.7, "Mongoose", '#dc2626')
arrow(ax, 10.3, 2.2, 10.3, 1.4, "REST + Socket.IO", '#0284c7')
ax.set_title("AquaVerse — Global Architecture", fontsize=14, fontweight='bold', pad=12)
plt.tight_layout(); plt.savefig(f'{OUT}/fig_architecture.png', dpi=150); plt.close()

# ── Fig 2: telemetry uplink sequence ─────────────────────────────────────────
fig, ax = plt.subplots(figsize=(12, 5.6))
actors = ['Node', 'Gateway', 'Broker', 'Backend', 'MongoDB', 'AquaVerse UI']
xs = [0.8, 2.9, 5.0, 7.1, 9.2, 11.3]
ax.set_xlim(0, 12.4); ax.set_ylim(0, 6); ax.axis('off')
for x, a in zip(xs, actors):
    box(ax, x-0.75, 5.2, 1.5, 0.6, a, C_GW if a=='Gateway' else C_NODE if a=='Node' else C_BROKER if a=='Broker' else C_BACK if a=='Backend' else C_DB if a=='MongoDB' else C_UI, 9)
    ax.plot([x, x], [0.4, 5.2], color='#94a3b8', lw=1, ls=':')
steps = [
    (0, 1, 4.6, 'LoRa JSON ~150 B  (every 5 s)'),
    (1, 2, 4.0, 'MQTT publish  …/nodes/{id}/telemetry  (+rssi,snr)'),
    (2, 3, 3.4, 'subscribed message'),
    (3, 3, 2.85, 'parse compact keys · flush queued cmds'),
    (3, 4, 2.3, 'update Node + insert SensorReading (time-series)'),
    (3, 5, 1.7, "Socket.IO  'sensor:data' + 'node:status'"),
    (5, 5, 1.15, '3D twin store apply() → plots/HUD update'),
]
for a, b, y, lbl in steps:
    if a == b:
        ax.annotate(lbl, (xs[a]+0.1, y), fontsize=8.5, color='#334155',
                    xytext=(xs[a]+0.25, y), fontweight='bold')
        ax.add_patch(FancyArrowPatch((xs[a], y+0.15), (xs[a], y-0.15), arrowstyle='-|>', mutation_scale=10, color='#64748b'))
    else:
        arrow(ax, xs[a], y, xs[b], y, lbl, '#0369a1', fs=8.5)
ax.set_title("Scenario A — Telemetry uplink (every 5 s)", fontsize=13, fontweight='bold')
plt.tight_layout(); plt.savefig(f'{OUT}/fig_uplink.png', dpi=150); plt.close()

# ── Fig 3: valve command with ACK retry ──────────────────────────────────────
fig, ax = plt.subplots(figsize=(12, 6.4))
actors = ['UI', 'Backend', 'Broker', 'Gateway', 'Node']
xs = [0.9, 3.3, 5.7, 8.1, 10.5]
ax.set_xlim(0, 11.8); ax.set_ylim(0, 7); ax.axis('off')
for x, a in zip(xs, actors):
    box(ax, x-0.7, 6.3, 1.4, 0.55, a, C_UI if a=='UI' else C_BACK if a=='Backend' else C_BROKER if a=='Broker' else C_GW if a=='Gateway' else C_NODE, 9)
    ax.plot([x, x], [0.3, 6.3], color='#94a3b8', lw=1, ls=':')
seq = [
    (0, 1, 5.8, 'POST /valve/open {percent}', '#0369a1', '-'),
    (1, 1, 5.45, 'clearFamily() · button → "Opening…"', '#7c3aed', '-'),
    (1, 4, 5.0, 'cmd valve_open  (attempt 0)', '#0369a1', '-'),
    (1, 4, 4.4, 'LOST over LoRa ✗', '#dc2626', '--'),
    (1, 4, 3.8, 'retry #1 (+1.8 s, no echo)', '#ea580c', '-'),
    (4, 4, 3.4, 'servo soft-ramp → 90° · sendStatus()', '#16a34a', '-'),
    (4, 1, 2.9, 'echo telemetry vp:100  → ACK, stop retries', '#16a34a', '-'),
    (1, 0, 2.3, "Socket 'node:status' valve=open", '#0369a1', '-'),
    (0, 0, 1.9, 'pending cleared → button "Close valve"', '#7c3aed', '-'),
]
for a, b, y, lbl, col, ls in seq:
    if a == b:
        ax.text(xs[a]+0.15, y, lbl, fontsize=8.5, color=col, fontweight='bold', va='center')
    else:
        arrow(ax, xs[a], y, xs[b], y, lbl, col, ls, fs=8.5)
ax.text(0.4, 0.8, "Guards: 1 retry loop per node (newest click cancels older) · echo = node's REAL state · max 4 retries ×1.8 s\nUI lock: report interval 5 s + 3 s backup = 8 s · liveOn 60 s grace prevents status-blip flapping",
        fontsize=9, color='#334155')
ax.set_title("Scenario B — Valve command over a lossy link (ACK + retry ladder)", fontsize=13, fontweight='bold')
plt.tight_layout(); plt.savefig(f'{OUT}/fig_valve.png', dpi=150); plt.close()

# ── Fig 4: deep sleep duty cycle timeline ────────────────────────────────────
fig, ax = plt.subplots(figsize=(12, 4.6))
ax.set_xlim(0, 12); ax.set_ylim(0, 4.4); ax.axis('off')
def phase(x, w, label, fc, y=2.2, h=0.9):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.01,rounding_size=0.05", fc=fc, ec=EDGE, lw=1.2))
    ax.text(x+w/2, y+h/2, label, ha='center', va='center', fontsize=9, fontweight='bold')
phase(0.3, 2.2, "AWAKE  (awk s)\nTX every 5 s · RX cmds", C_NODE)
phase(2.5, 2.6, "DEEP SLEEP  (nap s)\nradio off · RTC mem kept", '#e0e7ff')
phase(5.1, 2.2, "AWAKE\nwake #n+1", C_NODE)
phase(7.3, 2.6, "DEEP SLEEP", '#e0e7ff')
phase(9.9, 1.8, "AWAKE …", C_NODE)
for x in [0.55, 1.0, 1.45, 1.9, 2.35, 5.35, 5.8, 6.25, 6.7, 7.15, 10.15, 10.6, 11.05]:
    ax.annotate('', (x, 2.2), (x, 1.85), arrowprops=dict(arrowstyle='-|>', color='#16a34a', lw=1.2))
ax.text(1.4, 1.6, 'telemetry packets (slp,awk,nap,up)', fontsize=8.5, color='#16a34a', ha='center')
ax.annotate('', (2.5, 3.45), (0.3, 3.45), arrowprops=dict(arrowstyle='<->', color='#334155'))
ax.text(1.4, 3.55, 'g_awakeSec', fontsize=9, ha='center', fontweight='bold')
ax.annotate('', (5.1, 3.45), (2.5, 3.45), arrowprops=dict(arrowstyle='<->', color='#334155'))
ax.text(3.8, 3.55, 'g_wakeIntervalSec (timer wake)', fontsize=9, ha='center', fontweight='bold')
ax.text(6.0, 0.95, "Valve open ⇒ sleep PAUSED (node must hold servo) — resumes when valve closes\n"
                   "Wake detection: esp_reset_reason()==DEEP_SLEEP keeps cycling; real reboot disables sleep\n"
                   "Commands while asleep ⇒ backend queue, flushed on first wake telemetry (9 s listen window)",
        fontsize=9, ha='center', color='#334155')
ax.set_title("Scenario C — Deep-sleep duty cycle", fontsize=13, fontweight='bold')
plt.tight_layout(); plt.savefig(f'{OUT}/fig_sleep.png', dpi=150); plt.close()

# ── Fig 5: energy chain + formulas ───────────────────────────────────────────
fig, ax = plt.subplots(figsize=(12.5, 6.0))
ax.set_xlim(0, 12.5); ax.set_ylim(0, 6.0); ax.axis('off')
box(ax, 0.3, 4.3, 2.4, 1.2, "3S Li-ion pack\n+ BMS  (9–12.6 V)", C_DB, 9)
box(ax, 3.3, 4.3, 2.2, 1.2, "LM2596 buck\n12 V → 5 V", '#fef3c7', 9)
box(ax, 6.1, 4.6, 2.0, 0.9, "ESP32 + RA-02", C_NODE, 9)
box(ax, 6.1, 3.4, 2.0, 0.9, "Servo (direct 5 V)", C_GW, 9)
box(ax, 0.3, 2.4, 2.4, 1.2, "INA219\nbus V + current mA", '#ede9fe', 9)
arrow(ax, 2.7, 4.9, 3.3, 4.9, '', '#dc2626'); arrow(ax, 5.5, 4.9, 6.1, 5.0, '', '#dc2626'); arrow(ax, 5.5, 4.7, 6.1, 3.9, '', '#dc2626')
arrow(ax, 1.5, 4.3, 1.5, 3.6, 'shunt in series', '#7c3aed')
formulas = [
    ("1. Voltage estimate (fallback / reseed)", "V_ema += 0.18·(V_oc − V_ema)      pct_v = clamp((V_ema − 9.0)/(12.6 − 9.0))·100   (±1% deadband)"),
    ("2. Coulomb counter (true fuel gauge)",   "mAh −= I_mA · Δt_h     |I|<20 mA ⇒ mAh += 0.02·(mAh_v − mAh)     clamp [0, 2500]"),
    ("3. State of charge",                      "SoC% = mAh / CAPACITY · 100"),
    ("4. Time remaining",                       "discharge (I>5):  t_min = mAh/I·60        charge (I<−40):  t_min = (CAP−mAh)/|I|·60"),
    ("5. Deep-sleep energy (unmeasurable live)", "on wake:  mAh −= DEEP_SLEEP_MA(0.5) · nap_s/3600    (mAh kept in RTC memory)"),
    ("6. Life on a sleep schedule (UI)",        "I_avg = (I_awake·T_awk + 0.5·T_nap)/(T_awk+T_nap)     life_min = mAh/I_avg·60"),
]
y = 2.95
for title, f in formulas:
    ax.text(3.2, y, title, fontsize=9.5, fontweight='bold', color='#0f172a')
    ax.text(3.4, y-0.33, f, fontsize=9, family='monospace', color='#1e3a8a')
    y -= 0.62
ax.set_title("Energy subsystem — measurement chain and formulas", fontsize=13, fontweight='bold')
plt.tight_layout(); plt.savefig(f'{OUT}/fig_energy.png', dpi=150); plt.close()

# ── Fig 6: gateway power-cut LWT timeline ────────────────────────────────────
fig, ax = plt.subplots(figsize=(12, 3.8))
ax.set_xlim(0, 12); ax.set_ylim(0, 3.6); ax.axis('off')
ax.annotate('', (11.6, 1.5), (0.4, 1.5), arrowprops=dict(arrowstyle='-|>', color='#334155', lw=2))
events = [
    (0.8,  't = 0 s\npower cable pulled', '#dc2626'),
    (3.6,  't ≈ 9 s  (1.5 × keepalive 6 s)\nbroker fires LAST WILL\n{"status":"offline"}', '#b45309'),
    (6.6,  't ≈ 9.2 s\nbackend marks offline\nSocket → UI red', '#7c3aed'),
    (9.6,  'power back →\nreconnect + BIRTH\n→ online ~2 s', '#16a34a'),
]
for x, lbl, col in events:
    ax.plot([x, x], [1.35, 1.65], color=col, lw=3)
    ax.text(x, 2.0, lbl, fontsize=9, ha='center', color=col, fontweight='bold')
ax.text(6, 0.7, "Backup: sweep every 20 s (gateway cutoff 35 s · node 30 s · sleeping node 1.5×cycle + 60 s)",
        fontsize=9.5, ha='center', color='#334155')
ax.set_title("Scenario D — Gateway power cut (MQTT Last Will)", fontsize=13, fontweight='bold')
plt.tight_layout(); plt.savefig(f'{OUT}/fig_lwt.png', dpi=150); plt.close()

# ── Fig 7: cloud deployment ──────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(12.5, 5.4))
ax.set_xlim(0, 12.5); ax.set_ylim(0, 5.4); ax.axis('off')
box(ax, 0.3, 3.7, 3.6, 1.3, "FIELD\ngateway USE_CLOUD=1 → TLS\nnode ← LoRa", C_NODE, 9.5)
box(ax, 4.7, 3.7, 3.2, 1.3, "HiveMQ Cloud\nmqtts://…:8883\nuser/pass + Last Will", C_BROKER, 9.5)
box(ax, 8.8, 3.7, 3.4, 1.3, "Render — aquaverse-api\nkeep-alive ping /api/health 10 min\nlogs: errors only", C_BACK, 9.5)
box(ax, 8.8, 1.9, 3.4, 1.1, "MongoDB Atlas\nshared by laptop + Render", C_DB, 9.5)
box(ax, 4.7, 0.3, 3.2, 1.2, "Netlify\nwicosmartirrigation\nVITE_API_URL → Render", C_UI, 9.5)
box(ax, 0.3, 0.3, 3.6, 1.2, "localhost dev\nVITE_API_URL unset → Vite proxy\nlocal Mosquitto + ☁ toggle", '#f1f5f9', 9.5)
arrow(ax, 3.9, 4.35, 4.7, 4.35, 'TLS 8883', '#b45309')
arrow(ax, 7.9, 4.35, 8.8, 4.35, 'MQTT_BROKER_URL', '#0369a1')
arrow(ax, 10.5, 3.7, 10.5, 3.0, '', '#dc2626')
arrow(ax, 7.9, 1.1, 8.8, 2.2, 'REST + Socket.IO', '#0284c7')
arrow(ax, 3.9, 0.9, 4.7, 0.9, 'git push → auto-deploy', '#16a34a')
ax.text(6.2, 5.2, "Rule: ONE active brain per broker (laptop ☁ toggle OFF while Render is live)", fontsize=10,
        ha='center', fontweight='bold', color='#b91c1c')
ax.set_title("Cloud deployment topology", fontsize=13, fontweight='bold')
plt.tight_layout(); plt.savefig(f'{OUT}/fig_deploy.png', dpi=150); plt.close()

print("figures OK:", os.listdir(OUT))
