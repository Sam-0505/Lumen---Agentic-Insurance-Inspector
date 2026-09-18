# Lumen (Coverage Ghost)

**A spatial insurance claims assistant that runs entirely in a headset browser — no install, no native app.**

An adjuster puts on a Meta Quest 3 or PICO 4, opens a URL, and walks around a damaged vehicle. The app captures the vehicle from 12 angles in a WebXR passthrough session, runs each frame through a vision model, reconciles the per-angle findings into a single damage assessment, adjudicates it against policy text, and produces a colour-coded coverage report — with voice annotations transcribed on-device.

Built for **XRCC 2026** (PICO Tech Track — WebSpatial).

---

## Table of Contents

- [What makes this technically interesting](#what-makes-this-technically-interesting)
- [AI pipeline architecture](#ai-pipeline-architecture)
- [Episodic memory](#episodic-memory)
- [Spatial capture architecture](#spatial-capture-architecture)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [API reference](#api-reference)
- [Prototype scope — what is real vs. simulated](#prototype-scope--what-is-real-vs-simulated)
- [Engineering notes](#engineering-notes)
- [Setup](#setup)
- [Running on a headset](#running-on-a-headset)
- [Troubleshooting](#troubleshooting)

---

## What makes this technically interesting

Three problems had to be solved that don't show up in a typical web app:

1. **A single photo is not enough evidence.** One camera angle produces unreliable damage assessments. The scan captures 12 angle buckets around the vehicle, analyses each independently, then deterministically reconciles them — so a dent seen from three angles is one finding, not three.
2. **An LLM deciding insurance coverage in isolation is inconsistent.** The same damage can get different verdicts across runs. Coverage decisions are grounded in retrieved precedent from past claims, so the model reasons against how comparable damage was actually adjudicated before.
3. **Headset browsers are a hostile runtime.** No Web Speech API on Quest, `SharedArrayBuffer` requires specific COOP/COEP headers, `getUserMedia` needs HTTPS with a self-signed cert, and WebXR reference-space mismatches silently put geometry in the wrong place.

---

## AI pipeline architecture

The claim flows through five stages. Each stage has a single responsibility and a typed JSON contract; a failure at any stage surfaces to the UI rather than degrading into placeholder data.

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │ 1. DOCUMENT INTAKE                                                  │
 │    Licence / registration photo ──▶ vision OCR ──▶ structured       │
 │    fields (name, DL no., address, DOB, expiry)                      │
 │    Unreadable fields are reported, never invented.                  │
 └────────────────────────────┬────────────────────────────────────────┘
                              ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ 2. MULTI-ANGLE PERCEPTION            (12 buckets × 30°)             │
 │    One frame per bucket, gated on standoff distance and a 500ms     │
 │    cooldown; the bucket locks once captured                         │
 │      ──▶ POST /scan-frame ──▶ vision model ──▶ damage JSON          │
 │    Requests run in parallel as the adjuster walks the vehicle.      │
 └────────────────────────────┬────────────────────────────────────────┘
                              ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ 3. RECONCILIATION                    (deterministic, no LLM)        │
 │    mergeDamageAnalyses(): dedupes areas by normalised name,         │
 │    takes max severity by rank, unions fraud/safety flags,           │
 │    keeps the highest-cost estimate per area.                        │
 │    Deliberately not an LLM step — merging is a rule, not a          │
 │    judgement, and rules should not be re-litigated per run.         │
 └────────────────────────────┬────────────────────────────────────────┘
                              ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ 4. RETRIEVAL + ADJUDICATION                                         │
 │    a. Build query from damage type + affected area descriptions     │
 │    b. Retrieve top-3 similar past claims from episodic memory       │
 │    c. Inject as reference context alongside policy text             │
 │    d. Model returns per-area verdicts:                              │
 │         covered │ excluded │ partial │ requires_review              │
 │       + policy section cited, confidence, payout range              │
 │    Policy text always wins on conflict — precedent informs          │
 │    reasoning, it does not create coverage rules.                    │
 └────────────────────────────┬────────────────────────────────────────┘
                              ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ 5. WRITE-BACK                                                       │
 │    The decided claim is appended to episodic memory, so the next    │
 │    claim can retrieve it as precedent.                              │
 └─────────────────────────────────────────────────────────────────────┘
```

**Verdicts drive the visuals directly.** Each decision carries a colour (`green` / `red` / `amber` / `gray`) that maps to `coverageColors.js` → Three.js materials on the wireframe overlay and the sticky-note pins in 3D. The AI output *is* the render state; there is no translation layer to drift out of sync.

**Design decision — why stage 3 is not an LLM.** Reconciling 12 overlapping observations is a deduplication problem with deterministic rules (same area name → one finding, severity = max). Handing it to a model would add latency, cost, and non-determinism to a step that has an exactly correct answer. Models are used for perception and judgement; code is used for bookkeeping.

---

## Episodic memory

Coverage decisions are grounded in past claims rather than made from scratch each time.

**Retrieval → adjudicate → write back:**

```
new claim ──▶ build query from damage type + area descriptions
          ──▶ TF-IDF-style scoring across stored claims
          ──▶ top-3 precedents injected into the prompt
          ──▶ verdict cites precedent in adjuster_notes
          ──▶ decided claim written back for future retrieval
```

Real output from the pipeline (hail damage on a factory hood):

```json
{
  "coverage_decisions": [{
    "area_name": "Hood Assembly",
    "coverage_status": "green",
    "policy_section": "3.2a",
    "reason": "Hail damage to factory structural steel hood is covered under
               comprehensive coverage as per policy section 3.2a.",
    "estimated_payout_usd": { "min": 500, "max": 1500 }
  }],
  "adjuster_notes": "Consistent with past claim seed-002 where hail damage to
                     factory hood was covered under section 3.2a.",
  "retrieved_memory": [
    { "id": "seed-002", "damage_type": "Comprehensive - hail",   "score": 27.15 },
    { "id": "seed-004", "damage_type": "Collision - aftermarket", "score": 6.48 },
    { "id": "seed-003", "damage_type": "Glass damage - windshield", "score": 2.98 }
  ]
}
```

`retrieved_memory` is returned to the client, so the UI can show *why* a decision was reached — the precedent is auditable, not hidden in a prompt.

### Implementation choices

| Decision | Rationale |
|---|---|
| **TF-IDF-style scoring in plain JS** | At seed scale (dozens of claims) term-frequency weighted by inverse document frequency is sufficient. Embeddings would add a network round trip per claim and an availability dependency for a ranking problem this size. |
| **JSON file store, no SQLite** | `better-sqlite3` is a native module needing a compile toolchain. This repo has to run on judges' laptops on demo day; a dependency that can fail to build is a dependency that will. |
| **Write-back on decision** | Memory grows from real use. Run two similar claims and the second cites the first. |
| **Seed data is fabricated** | No public dataset carries the shape this needs (see below). |

### Why the seed data is hand-written

Public insurance datasets were evaluated and none fit:

| Dataset | Why it doesn't work |
|---|---|
| Kaggle *Car Damage* / *Damage Severity* | Images only — no claim text, no coverage decisions |
| AgentDS-Insurance (HuggingFace) | Has claim descriptions, but built for fraud/complexity prediction — no policy-clause references or coverage outcomes |
| Motor insurance portfolio (Open ICPSR), R `insuranceData` | Actuarial/premium data — no damage descriptions at all |

None carry the **damage-zone → coverage-decision → policy-clause** structure this pipeline reasons over. The 12 seed claims in `backend/data/seedClaims.json` are fabricated but use real industry vocabulary (claim types and severity labels borrowed from the datasets above) and cover the realistic spread: collision, hail, glass, aftermarket exclusion, wear-and-tear exclusion, pre-existing-damage denial, partial coverage, low-confidence review, and a near-total-loss escalation.

### Inspecting memory

```bash
curl localhost:3001/memory/claims                          # list all episodes
curl "localhost:3001/memory/search?q=windshield%20crack"   # retrieval only, no LLM call
node backend/scripts/testEpisodicMemory.js                 # offline test, no API key needed
```

The store lives at `backend/data/episodicMemory.json` (gitignored). Delete it to reset to clean seed state.

---

## Spatial capture architecture

### Angle-bucket scanning

Rather than recording video, the scan divides the space around the vehicle into **12 buckets of 30°**. As the adjuster walks, the app computes their azimuth relative to the vehicle centre via `atan2` and determines the current bucket. A frame is captured for that bucket only if the adjuster is far enough back for a usable shot, isn't mid-annotation, and the bucket hasn't fired in the last 500ms — then the bucket locks so it can't re-fire.

This gives even angular coverage with a bounded number of AI calls: exactly one request per bucket, twelve for a full walk-around. Walking slowly doesn't produce 400 redundant frames of the same fender. A progress ring of 12 arcs fills from grey to teal as buckets complete.

### Vehicle placement

WebXR hit-testing anchors the vehicle in real space: the adjuster taps floor points to place wheel markers, confirms, and the app computes centre, length, and scan radius from them. A distance gate pauses capture and prompts "step back" if they get too close for a usable frame. If hit-test is unavailable, it falls back to fixed forward placement.

### On-device voice notes

Meta Quest Browser has no Web Speech API (it's Google-proprietary). Voice annotation instead uses **Vosk WASM** (`vosk-browser`) — fully offline, no API key, no audio leaving the device. Pulling the trigger starts recording; partial results stream live onto a sticky-note mesh anchored at the floor point; pulling again commits the note with the azimuth it was recorded at, so notes carry directional context (Front / Left / Rear) into the review panel.

Vosk requires `SharedArrayBuffer`, which requires cross-origin isolation — hence the COOP/COEP headers in `vite.config.js`.

### Device targeting

| Device | Live camera | WebXR `immersive-ar` | Path taken |
|---|---|---|---|
| Meta Quest 3 | ✅ | ✅ | `ImmersiveScan` — full passthrough scan |
| PICO 4 | ✅ | ✅ | `ImmersiveScan`, WebSpatial panels in native shell |
| PICO emulator | ❌ (no cameras) | ❌ | `CameraCapture` fallback |
| Phone / desktop | ✅ | ❌ | `MobileScan` — same bucket logic, touch-driven |
| Apple Vision Pro | ❌ | — | **Dropped** (see below) |

**Why Vision Pro was dropped:** visionOS Safari blocks live camera feed rendering in web pages and restricts main-camera access to enterprise native apps. The entire capture flow depends on a live feed, so the target moved to Quest/PICO, whose Chromium-based browsers support `getUserMedia` with live preview.

---

## Tech stack

**Frontend** — React 19, Vite 8, Three.js 0.180, **raw WebXR Device API** (no wrapper library — session lifecycle, reference spaces, hit-testing and controller poses are managed directly), `@webspatial/react-sdk` (spatial panels), `@sparkjsdev/spark` + `@mkkellogg/gaussian-splats-3d` (Gaussian splat rendering), `vosk-browser` (offline STT)

**Backend** — Node 20+, Express 5, TAMU AI Chat (OpenAI-compatible; any OpenAI-compatible provider works)

**Model** — `protected.gpt-4.1-mini` by default: vision-capable, reliable structured JSON, ~3s round trip. Configurable via `TAMUS_AI_CHAT_MODEL`.

---

## Repository layout

```
backend/
  server.js                      Express app, dual /x and /api/x route mounting
  lib/
    tamusChat.js                 LLM client — retry w/ backoff, JSON fence stripping
    episodicMemory.js            Retrieval, scoring, write-back, prompt formatting
  routes/
    scanFrame.js                 Combined: saves frame + returns damage analysis
    analyzeDamage.js             Image → damage JSON
    checkCoverage.js             Damage + retrieved precedent → coverage decisions
    ocrDocument.js               Document image → structured fields
    memory.js                    Memory inspection endpoints
  prompts/                       System prompts — all enforce strict JSON output
  data/
    seedClaims.json              12 fabricated precedent claims (tracked)
    episodicMemory.json          Live store, seeded from above (gitignored)
  scripts/testEpisodicMemory.js  Offline retrieval test, no API key required

frontend/src/
  scenes/
    LoginScene.jsx               Agent + claim ID entry
    ScanScene.jsx                Intake state machine → capture → coverage
    ReviewScene.jsx              Live claim report from AI decisions
  components/
    ImmersiveScan.jsx            WebXR scan: placement, buckets, voice notes
    MobileScan.jsx               Phone equivalent of the bucket scan
    GaussianViewer.jsx           Splat rendering (Spark)
    CoverageOverlay.jsx          Wireframe coloured by coverage verdict
  lib/
    damageMerge.js               Deterministic multi-frame reconciliation
    api.js                       Typed API client, unwraps backend errors
    coverageColors.js            Verdict → colour mapping
    vosk.js                      Offline STT wrapper
```

---

## API reference

| Route | Purpose |
|---|---|
| `POST /ocr-document` | Document image → structured fields (licence / registration) |
| `POST /scan-frame` | Saves frame in background, returns damage analysis (one call, not two) |
| `POST /analyze-damage` | Image → damage JSON |
| `POST /check-coverage` | Damage + retrieved precedent → coverage decisions + `retrieved_memory` |
| `GET /memory/claims` | List all episodic-memory claims |
| `GET /memory/search?q=` | Retrieval only — no LLM call, useful for demoing |
| `GET /splat` | Serves the Gaussian splat asset |
| `POST /notes` | Persists voice notes for a scan |
| `GET /scan-frames/latest` | Captured frames for the review grid |
| `GET /health` | Liveness check |

Every route is mounted at both `/x` and `/api/x` so the Vite proxy and direct calls both work.

---

## Prototype scope — what is real vs. simulated

Stated plainly, because a demo that overclaims is worse than one that doesn't.

**Real and working end to end:**
- Vision OCR of documents — verified extracting name, licence number, address, DOB and expiry from a test licence
- Multi-angle damage analysis with deterministic reconciliation across 12 buckets
- Policy adjudication with episodic retrieval and precedent citation
- Offline on-device speech-to-text via Vosk WASM
- WebXR passthrough capture with hit-test placement on real Quest 3 / PICO 4 hardware
- Gaussian splat rendering in WebXR

**Simulated:**
- **Gaussian splat generation.** The rendered splat is a pre-built `final_car.spz` asset, not reconstructed from the captured frames. The World Labs Marble API accepts only 4 input images, which is far too few for vehicle reconstruction. `POST /upload-frames` and `GET /job-status/:jobId` are stubs that return a mock job ID and a completed status.
- **Policy record.** Adjudication runs against a fixed sample policy embedded in the coverage prompt rather than a policy database lookup.

**What production would need:** a photogrammetric reconstruction pipeline (e.g. InstantSplat on a cloud GPU) in place of the pre-built asset, a real policy datastore behind a retrieval tool, and human-in-the-loop review on every `requires_review` verdict before payout.

---

## Engineering notes

### Silent failure is worse than loud failure

The most instructive bug in this project: every AI route was returning `400 {"detail":"Model not found"}` because the configured model had been retired from the provider's catalog — but the app showed a complete, plausible-looking claim instead of an error.

Three independent layers conspired to hide it:

1. **Error detail discarded** — the client read `error.message` and `message` but not `detail`, so the real reason became a bare `TAMUS AI error 400`, which the frontend flattened further into `'checkCoverage failed'`.
2. **Failures treated as success** — the licence scanner caught OCR errors and advanced the flow with `null`; coverage failures were downgraded to a `console.warn`.
3. **Fabricated fallbacks** — missing driver fields fell back to plausible sample values, an empty coverage result rendered three hardcoded decisions, and the review screen discarded its props entirely (`void damageData`) to render a static PNG of a report.

Any one of these alone would be a minor code-quality issue. Stacked, they turned a total AI outage into a demo that looked like it was working — the worst possible failure mode for an insurance tool, where fabricated confidence is the specific thing that must never happen.

The fix removed every fabricated fallback: unread fields render `—`, failed scans stay on-screen with the reason, and the report renders live decisions or states plainly that none are available. Error detail now propagates from provider → backend → client, and the error message names the model so a retired-model failure is diagnosable in one read.

*Full write-up in `REVIEW.md` (BUG-08).*

### Other problems worth noting

- **WebXR reference-space mismatch** — Three.js defaults to `local-floor` internally while `session.requestReferenceSpace('unbounded')` returns a different origin, so controller rays rendered at floor level instead of hand height. Fixed by always deriving the reference space from `renderer.xr.getReferenceSpace()` so it's guaranteed to match Three.js's internal camera. (`REVIEW.md` BUG-06)
- **Provider quirk worth knowing** — Claude models on this endpoint reject `temperature: 0` (`temperature may only be set to 1 when thinking is enabled`), so swapping model families isn't a drop-in config change. GPT and Gemini models work at 0.
- **Request coupling** — frame saving and damage analysis were two separate round trips per bucket. Combined into `POST /scan-frame`, which returns the analysis immediately and persists the image via `setImmediate` afterwards, so disk I/O never blocks the response. (`REVIEW.md` BUG-05)

---

## Setup

### Prerequisites

- **Node.js 20+** (Express 5 requires ≥18, Vite 8 requires ≥20.19)
- `final_car.spz` in `backend/assets/`

### Install

```bash
cd backend && npm install
cd ../frontend && npm install
```

If Three.js raises a peer conflict:

```bash
cd frontend && npm uninstall three && npm install three@0.180.0 && npm install
```

### Backend configuration — pick one

**Option A — use the deployed backend** (no backend setup at all). Set on the frontend only:

```env
VITE_API_URL=https://coverageghost.onrender.com
```

**Option B — run locally with your own key.** The TAMU AI Chat API is restricted to Texas A&M students, so external users need an OpenAI-compatible provider.

1. In `backend/lib/tamusChat.js`, change the endpoint path from `/api/chat/completions` to `/v1/chat/completions`.
2. Create `backend/.env`:

```env
TAMUS_AI_CHAT_API_KEY=sk-...your-key
TAMUS_AI_CHAT_API_ENDPOINT=https://api.openai.com
TAMUS_AI_CHAT_MODEL=gpt-4o
PORT=3001
```

The model **must support vision**. To list what a provider offers:

```bash
curl -H "Authorization: Bearer $TAMUS_AI_CHAT_API_KEY" https://chat-api.tamu.ai/api/models
```

### Run

```bash
cd backend && node server.js      # port 3001
cd frontend && npm run dev        # https://localhost:5173
```

Vite serves HTTPS (required for `getUserMedia`). Expect a self-signed cert warning on first visit — **Advanced → Proceed**.

### Deploying

Frontend and backend deploy as separate services. Set `VITE_API_URL` on the frontend service to the backend URL. Leave it unset locally to use the Vite proxy.

---

## Running on a headset

1. Put the headset and dev machine on the same Wi-Fi.
2. Find your LAN IP — macOS: `ipconfig getifaddr en0` · Windows: `ipconfig` → IPv4 Address.
3. Open `https://YOUR_IP:5173` in Meta Quest Browser or PICO Browser.
4. Accept the certificate: **Advanced → Proceed**.
5. If the camera is blocked: Quest Settings → Apps → Browser → Permissions → Camera → Allow.

No packaging or `webspatial-builder` needed — WebXR and WebSpatial APIs work directly in the headset browser. `webspatial-builder` is only required for packaged App Store builds (and requires macOS).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| AI returns errors after working before | Provider may have retired the model — list the catalog (see Setup) and update `TAMUS_AI_CHAT_MODEL` |
| AI calls failing (non-TAMU key) | Follow Option B — change the endpoint path in `tamusChat.js` and use an OpenAI-compatible key |
| Three.js peer conflict | `npm uninstall three && npm install three@0.180.0 && npm install` |
| Headset can't connect | Allow port 5173 inbound (Windows Firewall → Inbound Rules → New Rule → TCP 5173) |
| Camera blocked on Quest | Quest Settings → Apps → Browser → Permissions → Camera → Allow |
| Self-signed cert error | Advanced → Proceed on first visit |
| WebXR won't launch | Check the COOP/COEP headers in `vite.config.js` — required for Vosk's `SharedArrayBuffer` |
| Splat not visible when deployed | Set `VITE_API_URL` on the frontend service to the backend URL |
| Grey wireframes in coverage overlay | GLB mesh names don't match AI `area_name` output — inspect at [gltf.report](https://gltf.report) |
| Voice notes not transcribing | Microphone permission must be granted in headset browser settings before entering the scan |
| `'xcodebuild' is not recognized` | `webspatial-builder` requires macOS — use browser testing instead |
