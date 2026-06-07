# Deploying AquaVerse (Netlify + always-on backend)

AquaVerse runs in **two environments at once** — localhost for dev and the cloud for
prod — using the same code. The switch is purely env vars.

## Architecture
| Piece                     | Host                         | Notes                                   |
|---------------------------|------------------------------|-----------------------------------------|
| Frontend (`admin-panel`)  | **Netlify** (static)         | Vite build                              |
| Backend (`smart-irrigation-api`) | **Render / Railway / Fly** | always-on Node: MQTT + Socket.IO + cron |
| Database                  | **MongoDB Atlas** (free)     | `MONGO_URI`                             |
| MQTT broker               | **HiveMQ Cloud** (free)      | gateway + backend both connect          |

> ❗ The backend **cannot** run on Netlify Functions — they are serverless/stateless
> and can't hold the persistent MQTT connection, the Socket.IO server, or the cron
> jobs. It needs an always-on Node host.

## 1. Backend → Render
1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo (it reads `render.yaml`).
3. Fill the secrets: `MONGO_URI`, `MQTT_BROKER_URL`, `MQTT_USERNAME/PASSWORD`,
   and `CORS_ORIGIN = http://localhost:5173,https://<your-site>.netlify.app`.
4. Deploy → note the URL, e.g. `https://aquaverse-api.onrender.com`.
   - Free plan sleeps after 15 min idle (drops MQTT). Use **Starter** for 24/7.

## 2. Frontend → Netlify
1. Netlify → **Add new site → Import** the repo.
2. **Base directory:** `admin-panel`  ·  Build: `npm run build`  ·  Publish: `dist`
   (already in `admin-panel/netlify.toml`).
3. Environment variables → `VITE_API_URL = https://aquaverse-api.onrender.com`
   (your backend URL, **no** `/api`, **no** trailing slash).
4. Deploy. SPA routing + redirects are handled by `netlify.toml`.

## 3. Point the gateway at the cloud broker
Reflash the ESP32 gateway with the HiveMQ Cloud host/credentials so real telemetry
flows to the deployed backend.

## Local dev (unchanged)
- Backend: `cd smart-irrigation-api && npm run dev`  (leave `CORS_ORIGIN` including localhost)
- Frontend: `cd admin-panel && npm run dev`  (leave `VITE_API_URL` **unset** → Vite proxy → :5000)

Because `CORS_ORIGIN` lists both origins and `VITE_API_URL` is unset locally, the
**same deployment works on Netlify and localhost simultaneously**.
