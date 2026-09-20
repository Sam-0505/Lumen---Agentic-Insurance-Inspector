# Lumen (Coverage Ghost)

**A spatial agentic insurance claims assistant that runs entirely in a headset browser (or phone) — no install, no native app.**

An adjuster puts on a Meta Quest 3 or PICO 4, opens a URL, and walks around a damaged vehicle. The app captures the vehicle from 12 angles in a WebXR passthrough session, runs each frame through a vision model, reconciles the per-angle findings into a single damage assessment, adjudicates it against policy text, and produces a colour-coded coverage report — with voice annotations transcribed on-device.

Built for **XRCC 2026** (PICO Tech Track — WebSpatial).

---

## 🔗 Live demo

### **[lumen-iwyh.onrender.com](https://lumen-iwyh.onrender.com/)**

Opens in any browser — no install, no sign-up. Backend API: [coverageghost.onrender.com](https://coverageghost.onrender.com/health)

> Both services are on Render's free tier, so the **first request after idle takes ~30–60s** to cold-start. Subsequent requests are fast.

**Try the AI without a headset** — these run in a normal browser:

| Try this | Where |
|---|---|
| Full scan flow, touch-driven | Open the link on a **phone** — same 12-bucket capture logic as the headset |
| Episodic memory retrieval (no LLM call) | [`/memory/search?q=windshield crack`](https://coverageghost.onrender.com/memory/search?q=windshield%20crack) |
| The 12 seeded precedent claims | [`/memory/claims`](https://coverageghost.onrender.com/memory/claims) |

---

## Supported devices

| Device | Live camera | WebXR `immersive-ar` | Experience |
|---|---|---|---|
| **Meta Quest 3** *(primary target)* | ✅ | ✅ | Full passthrough scan — walk around the vehicle, voice-annotate in 3D |
| **PICO 4** *(hackathon target)* | ✅ | ✅ | Full passthrough scan + WebSpatial panels in the native shell |
| **Phone** (iOS / Android) | ✅ | ❌ | Complete flow, touch-driven — same bucket logic, no headset needed |
| **Desktop browser** | ✅ | ❌ | Document scan, damage analysis and coverage report via webcam |
| PICO emulator | ❌ (no cameras) | ❌ | UI and WebSpatial panels only — capture needs real hardware |
| Apple Vision Pro | ❌ | — | **Not supported** — see [why](#device-targeting) |

Headsets need the browser's camera permission granted, and microphone permission for voice notes.

---

## Table of Contents

- [Live demo](#-live-demo)
- [Supported devices](#supported-devices)
- [What makes this technically interesting](#what-makes-this-technically-interesting)
- [AI pipeline architecture](#ai-pipeline-architecture)
- [Agentic adjudication](#agentic-adjudication)
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
2. **Not every damaged area deserves the same amount of investigation.** A clear windshield crack and a scratch with ambiguous rust in it are not the same problem, but a fixed pipeline treats every input identically — same retrieval, same context, one-shot commitment. The adjudication stage is a tool-calling agent instead: it decides per area whether it needs a policy lookup, a precedent check, both, or neither — and escalates to a human instead of guessing when the evidence genuinely doesn't support a confident verdict.
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
 │ 4. AGENTIC ADJUDICATION              (tool-calling loop)            │
 │    Model receives the merged damage JSON and three tools:           │
 │      search_policy(query)             → relevant policy clauses     │
 │      get_similar_past_claims(query)   → precedent, if it wants any  │
 │      flag_for_human_review(area, why) → escalate instead of guess   │
 │    The model — not this code — decides which tools, how many        │
 │    times, in what order, per damaged area. Loops until it returns   │
 │    final verdicts: covered │ excluded │ partial │ requires_review   │
 │    + policy section cited, confidence, payout range.                │
 │    Policy text always wins on conflict with retrieved precedent.    │
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

**Design decision — why stage 4 *is* an LLM control loop.** Unlike reconciliation, adjudication genuinely varies in how much investigation it needs, and that need isn't knowable in advance from the JSON shape alone — it depends on the actual content of the damage description. A fixed retrieve-then-prompt sequence has to over-fetch for every request to cover the hard cases, or under-investigate the hard cases to stay cheap on the easy ones. Letting the model call tools on demand means effort matches the actual ambiguity of each area — see [Agentic adjudication](#agentic-adjudication) for what this looks like in practice, with real captured traces.

---

## Agentic adjudication

`checkCoverage.js` doesn't run a fixed retrieve-then-prompt sequence. The model gets three tools and an iteration loop (`agentLoop.js`), and decides for itself — per damaged area — what it needs to look up before it's willing to commit to a verdict.

```
search_policy(query)              → relevant policy clauses, not the whole document pasted in
get_similar_past_claims(query)    → precedent, if the model wants any — not always top-3
flag_for_human_review(area, why)  → escalate instead of guessing on genuinely ambiguous evidence
```

Three real captured traces (`backend/scripts/testAgentCoverage.js`) show the effort scaling with actual ambiguity, not with a fixed step count:

| Case | Tool calls | What happened |
|---|---|---|
| Clear windshield crack | 1 | One policy lookup (`§3.1b`), done — no wasted retrieval |
| Collision + aftermarket part + rusty scratch | 6 | Investigated all three areas independently: policy lookup **and** precedent check per area, landing on 3 different verdicts (`covered` / `excluded` / `excluded`) |
| Single, extremely blurry photo | 1 | Called `flag_for_human_review` instead of guessing — no coverage verdict at all |

The third case is the one that matters most in this domain: a fixed pipeline would have been forced to output *some* verdict on unusable evidence. Recognizing "I don't have enough information" and escalating instead of fabricating confidence is the actual point of giving the model tools rather than a bigger prompt.

Real trace and output from the mixed case:

```json
{
  "coverage_decisions": [
    { "area_name": "Rear Bumper Cover",    "coverage_status": "covered",  "policy_section": "3.2b" },
    { "area_name": "Aftermarket Exhaust Tip", "coverage_status": "excluded", "policy_section": "7.1" },
    { "area_name": "Rear Quarter Panel",   "coverage_status": "excluded", "policy_section": "7.2" }
  ],
  "adjuster_notes": "Policy sections 3.2b, 7.1, and 7.2 were referenced for collision
                     damage, aftermarket parts exclusion, and pre-existing damage
                     exclusion respectively. Past claims seed-001 and seed-004
                     informed the decisions...",
  "agent_trace": [
    { "tool": "search_policy", "arguments": { "query": "rear bumper collision damage" } },
    { "tool": "search_policy", "arguments": { "query": "aftermarket parts coverage" } },
    { "tool": "search_policy", "arguments": { "query": "surface rust damage" } },
    { "tool": "get_similar_past_claims", "arguments": { "query": "rear bumper collision damage" } },
    { "tool": "get_similar_past_claims", "arguments": { "query": "aftermarket exhaust tip damage" } },
    { "tool": "get_similar_past_claims", "arguments": { "query": "surface rust on scratched panel" } }
  ],
  "agent_iterations": 2
}
```

`agent_trace` is returned to the client — the full decision path is auditable, not hidden inside a single prompt.

### Episodic memory

`get_similar_past_claims` is backed by the same TF-IDF-style retrieval used by `search_policy` (`lib/textSearch.js` — one ranking primitive, two tools). Every decided claim is written back afterward regardless of whether the model called the tool for it, so memory grows from real use — run two similar claims and the second can cite the first.

| Decision | Rationale |
|---|---|
| **Tools, not a fixed retrieval step** | The old pipeline always fetched top-3 precedent and always pasted the full policy into every prompt. The model now decides per area whether either is worth calling — see the trace table above. |
| **TF-IDF-style scoring in plain JS** | At seed scale (dozens of claims, 7 policy clauses) term-frequency weighted by inverse document frequency is sufficient. Embeddings would add a network round trip per call and an availability dependency for a ranking problem this size. |
| **JSON file store, no SQLite** | `better-sqlite3` is a native module needing a compile toolchain. This repo has to run on judges' laptops on demo day; a dependency that can fail to build is a dependency that will. |
| **Escalation is a real side effect** | `flag_for_human_review` persists to `backend/data/reviewQueue.json`, not just a string embedded in the response — a flagged area is actually retrievable by an adjuster afterward. |
| **Seed data is fabricated** | Public insurance datasets are either images without decisions, or actuarial data without damage descriptions — none carry the damage-zone → coverage-decision → policy-clause structure this reasons over. |

### Inspecting it

```bash
curl localhost:3001/memory/claims                          # all episodes, seed + demo-generated
curl "localhost:3001/memory/search?q=windshield%20crack"   # retrieval only, no LLM call
curl localhost:3001/memory/policy                           # structured clauses search_policy reads
curl localhost:3001/memory/reviews                          # areas flagged for human review
node backend/scripts/testEpisodicMemory.js                  # offline retrieval test, no API key needed
node backend/scripts/testAgentCoverage.js                   # live agent test, needs TAMUS_AI_CHAT_API_KEY
```

### A known proxy quirk, found by direct probing

Replaying an assistant tool-call message back into the conversation (required for round 2+ of the loop) needs an explicit string `content` field. The provider's own response omits `content` entirely when a message is tool-calls-only, and replaying that back with `content: null` — which the OpenAI message spec technically allows — gets rejected by this proxy's stricter schema (`Input should be a valid string`). `content: ''` satisfies both. `agentLoop.js` handles this; it's the kind of thing that silently breaks a tool loop on the second round if you don't hit it in testing.

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

`ScanScene.jsx` picks the capture path at runtime rather than branching on a device allow-list:

| Detected | Path | Capture method |
|---|---|---|
| WebSpatial shell (`/WebSpatial\//` in UA) or Vision Pro | Skips live capture | Proceeds straight to report generation — no camera feed available |
| `immersive-ar` supported | `ImmersiveScan` | WebXR passthrough: hit-test placement, azimuth from head pose |
| Everything else (phone, desktop) | `MobileScan` | Same 12 buckets, azimuth from `deviceorientation` (`lib/heading.js`) |

Both scan paths converge on an identical `onCapture(frames, notes, mergeDamageAnalyses(...))` contract, so everything downstream — reconciliation, retrieval, adjudication — is the same regardless of how the frames were captured. The phone path isn't a cut-down demo mode; it's the same pipeline with a different input surface, which is also what makes the AI testable without headset hardware.

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
    tamusChat.js                 LLM client — retry w/ backoff, tool-calling passthrough
    agentLoop.js                 Generic tool-calling loop: model decides, this executes
    coverageTools.js             search_policy / get_similar_past_claims / flag_for_human_review
    episodicMemory.js            Claim store, write-back
    textSearch.js                Shared TF-IDF-style ranking (used by both tools above)
  routes/
    scanFrame.js                 Combined: saves frame + returns damage analysis
    analyzeDamage.js             Image → damage JSON
    checkCoverage.js             Runs the agent loop → coverage decisions + agent_trace
    ocrDocument.js                Document image → structured fields
    memory.js                    Memory / policy / review-queue inspection endpoints
  prompts/                       System prompts — all enforce strict JSON output
  data/
    seedClaims.json              12 fabricated precedent claims (tracked)
    samplePolicy.json            Structured policy clauses search_policy reads (tracked)
    episodicMemory.json          Live claim store, seeded from seedClaims.json (gitignored)
    reviewQueue.json             Areas escalated via flag_for_human_review (gitignored)
  scripts/
    testEpisodicMemory.js        Offline retrieval test, no API key required
    testAgentCoverage.js         Live agent test — 3 traced scenarios, needs an API key

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
| `POST /check-coverage` | Runs the tool-calling agent loop → coverage decisions + `agent_trace` |
| `GET /memory/claims` | List all episodic-memory claims (seed + demo-generated) |
| `GET /memory/search?q=` | Episodic retrieval only — no LLM call, useful for demoing |
| `GET /memory/policy` | Structured policy clauses the `search_policy` tool reads |
| `GET /memory/reviews` | Areas the agent escalated via `flag_for_human_review` |
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
- Agentic tool-calling adjudication — real, traced tool calls against policy search, episodic precedent, and human-review escalation
- Offline on-device speech-to-text via Vosk WASM
- WebXR passthrough capture with hit-test placement on real Quest 3 / PICO 4 hardware
- Gaussian splat rendering in WebXR

**Simulated:**
- **Gaussian splat generation.** The rendered splat is a pre-built `final_car.spz` asset, not reconstructed from the captured frames. The World Labs Marble API accepts only 4 input images, which is far too few for vehicle reconstruction. `POST /upload-frames` and `GET /job-status/:jobId` are stubs that return a mock job ID and a completed status.
- **Policy record.** `search_policy` retrieves from one fixed sample policy (`backend/data/samplePolicy.json`), not a per-claimant policy database — the retrieval mechanism is real, the data behind it is a single fabricated policy.

**What production would need:** a photogrammetric reconstruction pipeline (e.g. InstantSplat on a cloud GPU) in place of the pre-built asset, `search_policy` backed by a real per-claimant policy datastore instead of one fixed document, and human-in-the-loop review actually wired to the `flag_for_human_review` queue rather than just recorded.

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

> Only needed to run or modify it locally — the [live demo](#-live-demo) needs none of this.

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
