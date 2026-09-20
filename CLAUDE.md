# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lumen(Coverage Ghost) is an AI-powered spatial insurance claims companion built for XRCC 2026 (PICO / WebSpatial track). It lets users scan a damaged vehicle, runs AI analysis against an insurance policy, and displays color-coded coverage decisions overlaid on a 3D wireframe model — viewable on Meta Quest or PICO headsets.

## Current Hardware Target
Primary development and testing device is **Meta Quest** (Chromium-based browser). Apple Vision Pro was tested but dropped — visionOS Safari blocks live camera feed rendering in web pages and restricts main camera access to enterprise native apps only. Meta Quest Browser supports `getUserMedia` with live video preview, `capture="environment"` file inputs, and WebXR — all required for the full demo flow.

**Note:** Web Speech API is NOT available on Meta Quest Browser (Google proprietary). Voice notes use **Vosk WASM** (`vosk-browser` npm package) — offline, free, no API key required.

# LUMEN — High Level Design
**XRCC 2026 Hackathon | Pico Tech Track**
 
---
 
## What is LUMEN?
 
LUMEN is a spatial insurance damage assessment application that runs in the browser on both **Apple Vision Pro** and **Pico headsets** — no installation required. A field insurance agent puts on a headset, captures a damaged vehicle or property scene, reviews an AI-generated gaussian splat of the damage in immersive 3D, records voice-annotated damage notes, and submits a structured insurance claim report — all from within a single spatial web experience.
 
---
 
## Hackathon Track
 
**Pico Tech Track — Path 1: WebSpatial**
 
The app is built with the WebSpatial SDK (React) and runs in the browser on both Meta Quest and PICO from a single codebase. No native app, no APK, no app store. The agent opens a URL.
 
| Requirement | How LUMEN meets it |
|---|---|
| Runs on Pico/Quest hardware | Opens in Meta Quest / Pico browser — WebXR Full Stage session |
| Built with WebSpatial | React + `@webspatial/sdk` spatial panels |
| Live camera feed | `getUserMedia` renders in Chromium-based headset browsers |
| No install required | Pure browser — zero friction for judges |

### Camera Status by Device
| Device | Live Preview | `capture` input | Notes |
|---|---|---|---|
| Meta Quest | ✅ Works | ✅ Works | Primary target |
| PICO | ✅ Works | ✅ Works | Hackathon target | 
---
 
## The Four Required Pillars
 
| Pillar | Implementation |
|---|---|
| **Meta Quest / PICO** | Primary development and testing devices. Chromium-based browsers support full camera + WebXR + Web Speech API. |
| **Gaussian Splatting** | World Labs API generates a gaussian splat from captured video frames. Rendered in WebXR using Spark (World Labs' own Three.js renderer) or `gsplat.js`. |
| **WebSpatial** | All UI panels built with `@webspatial/sdk` React components. Float in 3D space alongside the gaussian splat in Full Stage mode. |
| **Insurance** | Full end-to-end insurance workflow: claim verification, document OCR, exterior + interior gaussian splat capture, AI damage annotation, claim report generation. |
 
---
 
## Important Design Decision: World Labs API
 
The gaussian splat is **generated** by the World Labs Marble model from video frames — not photogrammetrically reconstructed. For this prototype this is the correct tradeoff:
 
- No GPU server required
- No COLMAP, no nerfstudio setup
- Free tier available (~$0.12 per splat on draft quality)
- Spark renderer is purpose-built for World Labs output and supports VR headsets
**Production consideration:** In a real deployment, World Labs would be replaced with a photogrammetric reconstruction pipeline (e.g. InstantSplat on a cloud GPU via Modal) to produce legally accurate scene geometry. The prototype uses World Labs to demonstrate the spatial workflow — this distinction is documented in the submission.
 
---
 
## User Flow
 
Based on the storyboard, the agent workflow has five phases:
 
### Phase 1 — Setup
```
Agent puts on headset → opens LUMEN URL in browser
→ Login with Agent ID + Claim ID
→ Claimant info form (policy number, driver name, vehicle, incident)
→ Document scan (driving licence + insurance card via camera or file upload)
→ Tamu Chat API extracts fields via OCR → form auto-fills
→ Policy verified against backend → eligible to proceed
```
 
### Phase 2 — Capture
```
Agent enters WebXR immersive-ar session (ImmersiveScan.jsx)

Setup (two-tap car placement):
→ Head-locked panel: "Tap front bumper on ground"
→ WebXR hit-test ray → stores frontPoint in world coords
→ "Tap rear bumper on ground" → stores rearPoint
→ carCenter, carLength, scanRadius computed from the two points
→ Fallback: if hit-test unavailable, fixed 2m / 4.5m forward placement

Angle-bucket scan (Polycam-style):
→ 12 buckets at 30° intervals around car center (BUCKETS = 12 in ImmersiveScan.jsx)
→ Per XR frame: compute agent azimuth via atan2, determine bucket index
→ Distance gate: if agent < 0.8m from car edge → pause + "Step back"
→ For each bucket: one frame, gated on standoff distance + 500ms cooldown, then the bucket locks
→ Progress ring shows 12 arcs, gray → teal as buckets fill
→ Annotation: agent pulls trigger → voice note (Vosk WASM STT) recorded
  - Sticky note mesh created at floor hit point inside scan ring
  - Vosk partial results update sticky note text live as user speaks
  - Pull trigger again → note saved to voiceNotes[], POSTed to /api/notes
→ 12+ buckets filled + trigger → scan complete

Processing (ScanScene.jsx 'generating' stage):
→ Each bucket frame analyzed via /scan-frame as it is captured, then merged by
  mergeDamageAnalyses() and sent to /check-coverage
→ Fake "World Labs Marble" progress animation (6 seconds, 0→100%)
→ final_car.spz loaded as splatUrl when both AI + animation complete
```

### Phase 3 — Annotate
```
AnnotateScene receives:
→ splatUrl ('/api/splat') → GaussianViewer renders 3D splat
→ coverageDecisions → StickyNote overlays + color-coded annotation list
→ voiceNotes [{text, angle}] → Field Notes sidebar (right panel)
  - Each note shows directional label (Front/Left/Rear etc.) + transcript
  - Angle computed from actual viewer azimuth via atan2 at capture time

Agent reviews 3D model with coverage color overlay and voice note sidebar
→ Continues to ReviewScene for claim summary
```
 
### Phase 4 — Review
```
ReviewPanel shows evidence summary:
→ Exterior splat ✅ / Interior splat ✅
→ All sticky notes listed, sorted by cost contribution rank
→ Total estimated damage cost
→ Toggle between exterior and interior splats
→ Option to add more zones or proceed
```
 
### Phase 5 — Submit
```
Agent taps Submit
→ All DamageZone JSON + claim metadata sent to backend
→ Claude generates structured insurance claim report (markdown)
→ Report displayed in SubmitPanel
→ PDF exported → share sheet → email to HQ
```
 
---
 
## Architecture Overview
 
```
┌─────────────────────────────────────────────────────────┐
│  Browser (Vision Pro Safari / Pico Browser)             │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  WebSpatial React App                            │   │
│  │  ├── UI Panels (@webspatial/sdk SpatialDiv)      │   │
│  │  ├── WebXR Session (raw WebXR API + Three.js)   │   │
│  │  ├── Gaussian Splat Renderer (Spark / gsplat.js) │   │
│  │  ├── Voice Notes (Vosk WASM — offline, on-device) │   │
│  │  └── State Management (Zustand)                  │   │
│  └──────────────────┬──────────────────────────────┘   │
└─────────────────────┼───────────────────────────────────┘
                      │ HTTPS REST API
        ┌─────────────┴──────────────┐
        │                            │
┌───────▼────────┐        ┌──────────▼──────────┐
│  World Labs    │        │  Backend (FastAPI)   │
│  Marble API    │        │  Render free tier    │
│                │        │  ├── Claude API proxy│
│  Video frames  │        │  ├── OCR endpoint    │
│  → .spz splat  │        │  ├── Damage analysis │
│                │        │  ├── Report generate │
│  Free tier     │        │  └── Policy verify   │
└────────────────┘        └─────────────────────┘
```
 
---

## Commands

### Backend
```bash
cd backend
npm install
node server.js          # runs on port 3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev             # https://localhost:5173 (HTTPS required — see vite.config.js)
```

### Three.js peer conflict fix
```bash
cd frontend
npm uninstall three && npm install three@0.180.0 && npm install
```

## Environment Variables

Create `backend/.env`:
```
TAMUS_AI_CHAT_API_KEY=...        # required for all AI routes
TAMUS_AI_CHAT_API_ENDPOINT=...   # defaults to https://chat-api.tamu.ai
TAMUS_AI_CHAT_MODEL=...          # defaults to protected.gpt-4.1-mini (vision + JSON, ~3s)
PORT=3001
```

The backend uses **TAMU AI Chat** (OpenAI-compatible API), not Anthropic directly. All AI calls go through `backend/lib/tamusChat.js`.

**Model availability:** the TAMU catalog changes — `protected.gemini-2.0-flash-lite` was retired and every AI route began returning `400 {"detail":"Model not found"}`, which silently broke OCR, damage analysis and coverage. List the current catalog with:
```bash
curl -H "Authorization: Bearer $TAMUS_AI_CHAT_API_KEY" https://chat-api.tamu.ai/api/models
```
Note: Claude models on this endpoint reject `temperature: 0` ("`temperature` may only be set to 1 when thinking is enabled"), so they need a temperature change before they can be swapped in. GPT and Gemini models work with the default `temperature: 0`.

## Architecture

### Data Flow
1. **LoginScene** — user enters claim info (name, policy number)
2. **ScanScene** — captures camera frames → `POST /upload-frames` → polls `/job-status/:jobId` for a Gaussian splat (`.spz`) URL → `POST /analyze-damage` (image → Claude) → `POST /check-coverage` (damage JSON → Claude)
3. **AnnotateScene** — renders the Gaussian splat via `GaussianViewer.jsx` + overlays `CoverageOverlay.jsx` (Three.js wireframe from `.glb`) colored by coverage decisions
4. **ReviewScene** — summary of claims and payout estimates

Scene state lives entirely in `App.jsx` and is passed down as props — no global state library.

### Backend Routes (`backend/routes/`)
| Route | Purpose |
|---|---|
| `POST /upload-frames` | Accepts base64 video frames, triggers 3D reconstruction job |
| `GET /job-status/:jobId` | Polls reconstruction job; returns `{ status, progress, splatUrl }` |
| `GET /splat/:jobId` | Serves the `.spz` Gaussian splat file |
| `POST /analyze-damage` | Sends image to TAMU AI with `damagePrompt`; returns damage JSON |
| `POST /check-coverage` | Sends damage JSON + policy to TAMU AI with `coveragePrompt`; returns coverage decisions |
| `POST /ocr-document` | Sends image to TAMU AI with `ocrPrompt`; extracts structured text from policy docs |
| `POST /save-frame` | Saves a captured frame to `backend/debug-images/` |
| `GET /scan-frame` | Serves saved scan frames |
| `POST /notes` | Saves voiceNotes array to `backend/debug-images/scan-{scanId}/notes.json` |
| `POST /log` | Logs frontend debug messages to the backend terminal (dev only) |
| `GET /memory/claims` | Lists all episodic-memory claims (seed + demo-generated) |
| `GET /memory/search?q=` | Runs episodic retrieval directly — no LLM call, useful for demoing |

### Episodic Memory (`backend/lib/episodicMemory.js`)
`POST /check-coverage` retrieves the 3 most similar past claims before asking the model, injects them into the prompt as reference context, and saves the newly-decided claim back for future retrieval. The model cites precedent in `adjuster_notes`, and the response carries `retrieved_memory` showing what was matched.

- Store: `backend/data/episodicMemory.json` (gitignored, grows at runtime), seeded on first run from `backend/data/seedClaims.json` — 12 fabricated claims, since no public dataset carries damage-zone → coverage-decision → policy-clause structure.
- Retrieval: TF-IDF-style scoring in plain JS, no native deps. Delete the store file to reset to clean seed state.
- Offline test: `node scripts/testEpisodicMemory.js` (no API key needed).

### AI Prompts (`backend/prompts/`)
All prompts instruct the model to return **only valid JSON** with no markdown. `parseJsonResponse()` strips any accidental code fences.

### Coverage Color System
`coverage_decisions[].color` values (`green`, `red`, `amber`, `gray`) from Claude map directly to `coverageColors.js` → applied to Three.js `MeshStandardMaterial` in `CoverageOverlay.jsx`. GLB mesh names must match `area_name` strings from Claude output (case-insensitive substring match). Use [gltf.report](https://gltf.report) to inspect mesh names when debugging gray wireframes.

### Required Assets
- `backend/assets/final_car.spz` — Gaussian splat served via `GET /splat`

## Key Constraints

- Vite runs with HTTPS (`@vitejs/plugin-basic-ssl`) — required for `getUserMedia` camera access in headset browsers. All API calls go through the Vite proxy (`/api/*` → `http://localhost:3001`) to avoid mixed-content blocks.
- For network testing (Meta Quest / PICO), use the **Network URL** (`https://192.168.x.x:5173`), not localhost.
- Meta Quest Browser requires accepting the self-signed cert on first visit — tap "Advanced" → "Proceed".
- Camera permission must be granted to the browser in Meta Quest settings if prompted.
- `webspatial-builder run` is NOT required for PICO emulator testing — open the network URL directly in the PICO browser. Only needed for packaged App Store builds.
- WebXR `immersive-ar` passthrough scan works on real Meta Quest 3 and real PICO 4. Does NOT work on PICO emulator (no real cameras) — expected and acceptable.
- WebSpatial `volume` scene works on real PICO with native WebSpatial shell and on PICO emulator. Falls back to flat 2D on Meta Quest browser (fine for testing).
- **Vosk WASM requires `SharedArrayBuffer`** — Vite is configured with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` headers. If WebXR fails to launch on Quest, these headers may be the cause.
- **`/vosk-test.html`** — standalone test page at `frontend/public/vosk-test.html` for testing Vosk STT on desktop without needing WebXR.

## Spatial Architecture
- **WebSpatial SDK** — floating 3D UI panels for login/review/annotate. Scene configured as `volume` via `frontend/public/manifest.json` `main_scene` field.
- **WebXR `immersive-ar`** — scan phase only. Activates color passthrough on Quest 3 / PICO 4. `ImmersiveScan.jsx` manages the full scan state machine: 4-wheel placement (hit-test spheres) → confirm button → scan ring appears → angle-bucket frame capture (12 × 30° buckets) → voice annotation via Vosk WASM.
- **Wheel placement flow**: 4 spheres placed by trigger on floor → "Confirm" button appears → tap to lock wheels → `recomputeCarGeometry` → `phase = 'scanning'` → blue ring + sticky notes activate.
- **Detection in `ScanScene.jsx`**: WebSpatial shell (`/WebSpatial\//.test(userAgent)`) or Vision Pro → skips live capture, goes straight to report generation; `immersive-ar` supported → ImmersiveScan (Quest/PICO); everything else (phone **and** desktop) → MobileScan, same 12 buckets with azimuth from `deviceorientation` (`lib/heading.js`). CameraCapture is used by the document/licence screens, not the damage scan.
- **Gaussian splat**: `final_car.spz` in `backend/assets/`, served via `GET /splat`. Displayed in `GaussianViewer.jsx` (Spark renderer). Generation is faked with a 6-second animation after AI analysis completes — World Labs API only accepts 4 images which is insufficient for vehicle reconstruction.
- **Voice notes**: Captured during ImmersiveScan via Vosk WASM (offline, on-device — Web Speech API is unavailable on Quest), stored as `[{text, angle}]`. Passed through `ScanScene.onComplete` → `App.jsx` state → `AnnotateScene` Field Notes sidebar.
