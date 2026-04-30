# Coverage Ghost (Lumen)

AI-powered spatial insurance claims companion — XRCC 2026, PICO / WebSpatial track.

---

## Prerequisites

- Node.js 20+ — [nodejs.org](https://nodejs.org)
- `car_burnout_converted.spz` asset (included in zip)

---

## Setup

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

If you get a Three.js peer conflict:

```bash
cd frontend
npm uninstall three && npm install three@0.180.0 && npm install
```

### 2. AI Backend — choose one option

---

#### Option A — Use our deployed backend (easiest, no setup)

Set this environment variable on the **frontend** only:

```env
VITE_API_URL=https://coverageghost.onrender.com
```

Skip the backend install and backend `.env` entirely. The frontend will call our hosted backend directly.

---

#### Option B — Run backend locally with your own OpenAI key

> The TAMU AI Chat API is restricted to Texas A&M University students and cannot be used by external judges.

**Step 1** — Change `backend/lib/tamusChat.js` line 53:

```js
// from (TAMU endpoint path):
const response = await fetch(`${getApiBaseUrl()}/api/chat/completions`, {

// to (OpenAI endpoint path):
const response = await fetch(`${getApiBaseUrl()}/v1/chat/completions`, {
```

**Step 2** — Create `backend/.env`:

```env
TAMUS_AI_CHAT_API_KEY=sk-...your-openai-key
TAMUS_AI_CHAT_API_ENDPOINT=https://api.openai.com
TAMUS_AI_CHAT_MODEL=gpt-4o
PORT=3001
```

Model must support **vision** (image input). Works with any OpenAI-compatible provider — change the endpoint and key accordingly.

---

### 3. Place asset file

Get a `final_car.spz` into `backend/assets/`. Do not rename it.

---

## Running Locally

Start both servers in separate terminals:

**Backend** (skip if using Option A):
```bash
cd backend
node server.js
# Runs on port 3001
```

**Frontend:**
```bash
cd frontend
npm run dev
# Local:   https://localhost:5173
# Network: https://192.168.x.x:5173
```

> Vite runs HTTPS (required for camera access). On first visit you will see a self-signed cert warning — click **Advanced → Proceed**.

---

## Deploying to Production (Render / any host)

Frontend and backend are separate services. Set on the **frontend** service:

```env
VITE_API_URL=https://your-backend-url.onrender.com
```

Leave `VITE_API_URL` unset for local development — falls back to `/api` (Vite proxy).

---

## Testing on Meta Quest 3 (primary target)

1. Connect Quest and your machine to the same WiFi network
2. Find your machine's local IP:
   - Windows: `ipconfig` → IPv4 Address under WiFi adapter
   - Mac: `ipconfig getifaddr en0`
3. Open Meta Quest Browser and navigate to `https://YOUR_IP:5173`
4. Accept the self-signed cert: tap **Advanced → Proceed**
5. If camera is blocked: Quest Settings → Apps → Browser → Permissions → Camera → Allow

WebXR AR passthrough and camera work natively in Meta Quest Browser. No packaging needed.

---

## Testing on PICO (emulator or device)

1. Start frontend dev server (`npm run dev`)
2. Launch PICO Emulator from Android Studio **or** use a real PICO 4 on same WiFi
3. Open browser and navigate to `https://YOUR_IP:5173`
4. Accept the self-signed cert

WebSpatial APIs work directly in PICO OS 6 browser — no `webspatial-builder` needed.

---

## Windows Firewall (if headset can't connect)

Allow port 5173 inbound:

Windows Security → Firewall → Advanced settings → Inbound Rules → New Rule → Port → TCP → 5173 → Allow

---

## Common Issues

| Error | Fix |
|---|---|
| Three.js peer conflict | `npm uninstall three && npm install three@0.180.0 && npm install` |
| Headset can't connect | Allow port 5173 in Windows Firewall (see above) |
| Camera blocked on Quest | Quest Settings → Apps → Browser → Permissions → Camera → Allow |
| Self-signed cert error | Click Advanced → Proceed on first visit |
| 3D asset not visible (deployed) | Set `VITE_API_URL` on frontend service pointing to backend URL |
| AI calls failing (non-TAMU) | Follow Option B — change endpoint path in `tamusChat.js` + use OpenAI key |
| Gray wireframes in coverage overlay | GLB mesh names don't match AI output — inspect at [gltf.report](https://gltf.report) |
| `'xcodebuild' is not recognized` | `webspatial-builder` requires macOS — use browser testing instead |
