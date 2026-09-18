import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { scanFrame } from '../lib/api';
import { mergeDamageAnalyses as mergeAnalyses } from '../lib/damageMerge';

const BUCKETS = 12;
const BUCKET_DEG = 360 / BUCKETS;
const MIN_BUCKETS_COMPLETE = 0;

// 4-wheel setup phases in order
const WHEEL_PHASES = ['setup-fl', 'setup-fr', 'setup-rr', 'setup-rl'];
const WHEEL_LABELS = ['Front-Left\nWheel', 'Front-Right\nWheel', 'Rear-Right\nWheel', 'Rear-Left\nWheel'];
const WHEEL_COLORS = [0x1a3cef, 0x1a3cef, 0x1a3cef, 0x1a3cef];

export default function ImmersiveScan({ onCapture, onExit, xrSession: providedSession }) {
  const videoRef = useRef(null);
  const sessionRef = useRef(null);

  useEffect(() => {
    let phase = 'setup-fl';
    let wheelPoints = [null, null, null, null]; // fl, fr, rr, rl
    let carCenter = null, carLength = 4.5, scanRadius = 2.5;
    let buckets = new Array(BUCKETS).fill(null);
    let voiceNotes = [];
    let annotating = false;
    let tooClose = false;
    let lastHitPoint = null;
    let lastViewerT = null, lastViewerFwd = null;
    let lastFloorY = 0; // real floor Y in current reference space, updated via hit-test
    let bucketCooldowns = new Array(BUCKETS).fill(0);
    let lastPanelDraw = 0;
    let lastRingUpdate = 0;
    let currentBucket = 0;
    let renderer, session, scene, refSpace, hitTestSource, stream;
    let ringMeshes = [];
    let stickyNotes = []; // { mesh, noteEntry } — tracked for play-button raycasts
    let activeAudio = null;       // currently playing Audio element
    let activeAudioMesh = null;   // mesh whose button is in play state
    let gripHeld = false;         // grip button currently held (recording in progress)
    let grippedStickyIdx = -1;    // index of sticky note being moved (-1 = none)
    let hoveredStickyIdx = -1;    // index of note whose edge is hovered (-1 = none)
    let draggingActiveNote = false; // trigger held on activeStickyMesh during recording
    const scanId = Date.now();
    let lastControllerPoses = []; // cached each XR frame from targetRaySpace
    let lastDebugPt = null; // last placed wheel point for on-screen debug
    let grabbedSphereIdx = -1; // index of wheel sphere currently being dragged (-1 = none)
    let activeStickyMesh = null; // the live sticky note mesh being recorded into
    let wheelsLocked = false; // true after user confirms wheel placement

    // Head-locked status panel (text only — no 2D ring)
    const mCanvas = document.createElement('canvas');
    mCanvas.width = 512; mCanvas.height = 256;
    const mc = mCanvas.getContext('2d');
    let mTex;

    // Voice note panel
    const vCanvas = document.createElement('canvas');
    vCanvas.width = 512; vCanvas.height = 300;
    const vc = vCanvas.getContext('2d');
    let vTex, vPanel;

    // AI Logs tray panel
    const logsCanvas = document.createElement('canvas');
    logsCanvas.width = 400; logsCanvas.height = 520;
    const lc = logsCanvas.getContext('2d');
    let logsTex, logsPanel;
    let aiLogs = [{
      id: 'sample-1',
      name: 'Rear bumper',
      description: 'Deep scratch with paint transfer, approximately 30cm long',
      severity: 'moderate',
      damageType: 'collision',
      saved: false,
    }];
    let damageAnalyses = [];
    const pendingAnalyses = [];

    // ── Drawing helpers ──────────────────────────────────────────────────────

    function drawSetup(stepIdx) {
      const label = WHEEL_LABELS[stepIdx];
      mc.clearRect(0, 0, 512, 256);
      mc.fillStyle = 'rgba(15,23,42,0.65)';
      rrect(mc, 0, 0, 512, 256, 32); mc.fill();
      mc.strokeStyle = WHEEL_COLORS[stepIdx] ? `#${WHEEL_COLORS[stepIdx].toString(16).padStart(6,'0')}` : '#1a3cef';
      mc.lineWidth = 3; rrect(mc, 0, 0, 512, 256, 32); mc.stroke();

      // Step dots
      mc.fillStyle = 'rgba(255,255,255,0.2)';
      for (let i = 0; i < 4; i++) {
        mc.beginPath();
        mc.arc(176 + i * 54, 36, 10, 0, Math.PI * 2);
        mc.fillStyle = i < stepIdx ? '#1a3cef' : i === stepIdx ? '#1a3cef' : 'rgba(255,255,255,0.2)';
        mc.fill();
      }

      mc.fillStyle = 'white'; mc.font = 'bold 24px Arial'; mc.textAlign = 'center';
      mc.fillText('Tap wheel on ground', 256, 80);
      mc.font = '28px Arial'; mc.fillStyle = '#1a3cef';
      label.split('\n').forEach((l, i) => mc.fillText(l, 256, 126 + i * 36));
      mc.fillStyle = 'rgba(255,255,255,0.4)'; mc.font = '17px Arial';
      mc.fillText('Pull trigger to place', 256, 210);

      // Debug: show last placed point coordinates
      if (lastDebugPt) {
        mc.fillStyle = '#454545'; mc.font = '14px monospace';
        mc.fillText(
          `last: x=${lastDebugPt.x.toFixed(3)}  y=${lastDebugPt.y.toFixed(3)}  z=${lastDebugPt.z.toFixed(3)}`,
          256, 238
        );
      }
      mTex.needsUpdate = true;
    }

    function drawConfirm() {
      mc.clearRect(0, 0, 512, 256);
      mc.fillStyle = 'rgba(15,23,42,0.65)';
      rrect(mc, 0, 0, 512, 256, 32); mc.fill();
      mc.strokeStyle = '#1a3cef'; mc.lineWidth = 3;
      rrect(mc, 0, 0, 512, 256, 32); mc.stroke();

      for (let i = 0; i < 4; i++) {
        mc.beginPath();
        mc.arc(176 + i * 54, 36, 10, 0, Math.PI * 2);
        mc.fillStyle = '#1a3cef'; mc.fill();
      }

      mc.fillStyle = 'white'; mc.font = 'bold 26px Arial'; mc.textAlign = 'center';
      mc.fillText('All 4 wheels placed!', 256, 90);
      mc.fillStyle = 'rgba(255,255,255,0.55)'; mc.font = '18px Arial';
      mc.fillText('You can still grab & adjust spheres.', 256, 130);
      mc.fillText('Tap the button below when ready.', 256, 158);
      mTex.needsUpdate = true;
    }

    function drawStatus() {
      const filled = buckets.filter(Boolean).length;
      mc.clearRect(0, 0, 512, 256);
      mc.fillStyle = 'rgba(15,23,42,0.65)';
      rrect(mc, 0, 0, 512, 256, 32); mc.fill();

      mc.fillStyle = 'white'; mc.font = 'bold 48px Arial'; mc.textAlign = 'center';
      mc.textBaseline = 'middle';
      mc.fillText(`${filled} / ${BUCKETS}`, 256, 80);
      mc.textBaseline = 'alphabetic';
      mc.font = '16px Arial'; mc.fillStyle = 'rgba(255,255,255,0.45)';
      mc.fillText('areas scanned', 256, 116);

      if (tooClose) {
        mc.fillStyle = '#f87171'; mc.font = 'bold 20px Arial';
        mc.fillText('⚠ Step back to the ring', 256, 160);
      } else if (annotating) {
        mc.fillStyle = '#1a3cef'; mc.font = 'bold 20px Arial';
        mc.fillText('🎙 Recording... pull trigger to save', 256, 160);
      } else if (filled >= MIN_BUCKETS_COMPLETE) {
        mc.fillStyle = '#1a3cef'; mc.font = 'bold 20px Arial';
        mc.fillText('✓ Click Exit Scan', 256, 160);
        mc.fillStyle = 'rgba(255,255,255,0.35)'; mc.font = '16px Arial';
        mc.fillText('or keep walking for more coverage', 256, 190);
      } else {
        mc.fillStyle = '#1a3cef'; mc.font = '18px Arial';
        mc.fillText('Walk along the ring around the car', 256, 160);
        mc.fillStyle = 'rgba(255,255,255,0.3)'; mc.font = '15px Arial';
        mc.fillText('Pull trigger to add a voice note', 256, 190);
      }
      mTex.needsUpdate = true;
    }

    function drawVoice(text) {
      vc.clearRect(0, 0, 512, 300);
      vc.fillStyle = 'rgba(15,23,42,0.65)';
      rrect(vc, 0, 0, 512, 300, 28); vc.fill();
      vc.strokeStyle = '#5e5e5e'; vc.lineWidth = 2.5;
      rrect(vc, 0, 0, 512, 300, 28); vc.stroke();
      vc.fillStyle = '#3a3a3a'; vc.font = '24px Arial'; vc.textAlign = 'center';
      vc.fillText('🎙 Field Note', 256, 46);
      vc.fillStyle = 'white'; vc.font = '19px Arial';
      const words = text.split(' ');
      let line = '', y = 86;
      for (const word of words) {
        const test = line + word + ' ';
        if (vc.measureText(test).width > 460 && line) {
          vc.fillText(line.trim(), 256, y); line = word + ' '; y += 28;
        } else { line = test; }
      }
      if (line) vc.fillText(line.trim(), 256, y);
      vc.fillStyle = 'rgba(255,255,255,0.4)'; vc.font = '16px Arial';
      vc.fillText('Pull trigger to save', 256, 268);
      vTex.needsUpdate = true;
    }

    function drawLogsTray() {
      lc.clearRect(0, 0, 400, 520);
      // Grey glassmorphic background
      lc.fillStyle = 'rgba(28,28,32,0.97)';
      rrect(lc, 0, 0, 400, 520, 20); lc.fill();
      lc.strokeStyle = 'rgba(255,255,255,0.12)'; lc.lineWidth = 1.5;
      rrect(lc, 0, 0, 400, 520, 20); lc.stroke();
      // Header
      lc.fillStyle = 'white'; lc.font = 'bold 22px Arial'; lc.textAlign = 'left';
      lc.fillText('AI Analysis', 20, 36);
      const pending = aiLogs.filter(l => !l.saved);
      lc.fillStyle = 'rgba(255,255,255,0.50)'; lc.font = '16px Arial';
      lc.fillText(`${aiLogs.length} finding${aiLogs.length !== 1 ? 's' : ''}  ·  ${pending.length} pending`, 20, 60);
      // Divider
      lc.fillStyle = 'rgba(255,255,255,0.15)'; lc.fillRect(14, 72, 372, 1);
      // Show last 3 pending items
      const visible = pending.slice(-3);
      if (visible.length === 0) {
        lc.fillStyle = 'rgba(255,255,255,0.30)'; lc.font = '17px Arial'; lc.textAlign = 'center';
        lc.fillText('Waiting for scan results…', 200, 130);
      }
      const SEVERITY_COLORS = { low: '#22c55e', moderate: '#fbbf24', severe: '#f87171', total_loss: '#ef4444' };
      const CARD_H = 148;
      visible.forEach((log, i) => {
        const cy = 82 + i * (CARD_H + 6);
        // Card
        lc.fillStyle = 'rgba(255,255,255,0.08)';
        rrect(lc, 14, cy, 372, CARD_H, 12); lc.fill();
        lc.strokeStyle = 'rgba(255,255,255,0.10)'; lc.lineWidth = 1;
        rrect(lc, 14, cy, 372, CARD_H, 12); lc.stroke();

        // Severity badge — top-right corner
        const sev = (log.severity || '').toLowerCase();
        const sevColor = SEVERITY_COLORS[sev] || '#94a3b8';
        const sevLabel = sev ? sev.replace('_', ' ') : 'unknown';
        lc.font = 'bold 13px Arial';
        const badgeW = lc.measureText(sevLabel).width + 18;
        lc.fillStyle = sevColor + '33';
        rrect(lc, 372 - badgeW - 8, cy + 12, badgeW, 22, 5); lc.fill();
        lc.fillStyle = sevColor; lc.textAlign = 'center';
        lc.fillText(sevLabel, 372 - badgeW / 2 - 8, cy + 27);

        // Area name
        lc.fillStyle = 'white'; lc.font = 'bold 18px Arial'; lc.textAlign = 'left';
        lc.fillText(log.name || 'Unknown area', 26, cy + 26);

        // Damage type row
        if (log.damageType) {
          lc.fillStyle = 'rgba(255,255,255,0.50)'; lc.font = '14px Arial'; lc.textAlign = 'left';
          lc.fillText('Type: ' + log.damageType, 26, cy + 50);
        }

        // Description (1-line clamp)
        lc.fillStyle = 'rgba(255,255,255,0.80)'; lc.font = '15px Arial'; lc.textAlign = 'left';
        const descY = log.damageType ? cy + 74 : cy + 54;
        let desc = log.description || '';
        while (desc && lc.measureText(desc + '…').width > 346) desc = desc.slice(0, -1);
        if (desc !== log.description && desc) desc += '…';
        if (desc) lc.fillText(desc, 26, descY);

        // Dismiss button
        lc.fillStyle = 'rgba(255,255,255,0.18)';
        rrect(lc, 20, cy + CARD_H - 40, 140, 30, 8); lc.fill();
        lc.fillStyle = 'rgba(255,255,255,0.80)'; lc.font = '14px Arial'; lc.textAlign = 'center';
        lc.fillText('Dismiss', 90, cy + CARD_H - 20);
        // Save button
        lc.fillStyle = '#1a3cef';
        rrect(lc, 170, cy + CARD_H - 40, 206, 30, 8); lc.fill();
        lc.fillStyle = 'white'; lc.font = 'bold 14px Arial';
        lc.fillText('Save as Note', 273, cy + CARD_H - 20);
      });
      logsTex.needsUpdate = true;
    }

    // ── Ring (world-space 3D arc segments) ──────────────────────────────────

    function createScanRing(scene) {
      ringMeshes = [];
      const geo = new THREE.SphereGeometry(0.10, 16, 16);
      for (let i = 0; i < BUCKETS; i++) {
        const a = (i / BUCKETS) * Math.PI * 2;
        const mat = new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0x888888, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, roughness: 0.3, metalness: 0.4 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(
          carCenter.x + Math.cos(a) * scanRadius,
          0.8,
          carCenter.z + Math.sin(a) * scanRadius
        );
        scene.add(mesh);
        ringMeshes.push(mesh);
      }
    }

    function updateRing() {
      ringMeshes.forEach((mesh, i) => {
        const col = i === currentBucket ? (tooClose ? 0xef4444 : 0x22c55e) : buckets[i] ? 0x22c55e : 0x383838;
        const op  = i === currentBucket ? 0.75 : 0.55;
        mesh.material.color.set(col);
        mesh.material.emissive.set(col);
        mesh.material.opacity = op;
      });
    }

    // ── Frame capture + combined API ─────────────────────────────────────────

  function captureFrame(video, bIdx, angleDeg) {
      if (buckets[bIdx]) return; // already claimed — one image per bucket
      try {
        const w = video.videoWidth || 640, h = video.videoHeight || 480;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        off.getContext('2d').drawImage(video, 0, 0);
        const b64 = off.toDataURL('image/jpeg', 0.88).split(',')[1];
        buckets[bIdx] = { angle: angleDeg }; // claim synchronously before any async
        bucketCooldowns[bIdx] = Infinity;    // stop outer loop from re-firing this bucket
        uploadAndAnalyze(b64, angleDeg, bIdx);
      } catch (_) {}
    }

    function uploadAndAnalyze(b64, angleDeg, bIdx) {
      const p = scanFrame({ frameBase64: b64, angle: angleDeg, bucketIndex: bIdx, scanId })
        .then(damage => {
          const storedDamage = { ...damage, scan_angle: angleDeg, bucket_index: bIdx };
          damageAnalyses.push(storedDamage);
          if (buckets[bIdx]) buckets[bIdx].damage = storedDamage;
          const areas = damage?.affected_areas || damage?.damaged_areas || [];
          areas.forEach(area => {
            const name = area.name || area.area_name || area.area || 'Unknown';
            aiLogs.push({
              id: String(Date.now() + Math.random()),
              name,
              description: area.description || '',
              severity: area.severity || damage.severity || '',
              damageType: area.damage_type || damage.damage_type || '',
              saved: false,
            });
          });
          if (areas.length) drawLogsTray();
        })
        .catch(e => console.warn('[ImmersiveScan] scanFrame:', e.message));
      pendingAnalyses.push(p);
    }

    function getStoredDamageAnalyses() {
      const stored = buckets.map(bucket => bucket?.damage).filter(Boolean);
      return stored.length ? stored : damageAnalyses;
    }

    function mergeDamageAnalyses() {
      return mergeAnalyses(getStoredDamageAnalyses());
    }

    function computeSharpness(d) {
      let s = 0, s2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 20) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        s += g; s2 += g * g; n++;
      }
      const m = s / n;
      return s2 / n - m * m;
    }

    function makeStickyNote(pos) {
      const c = document.createElement('canvas');
      c.width = 360; c.height = 270;
      const tex = new THREE.CanvasTexture(c);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.266, 0.2), // 4:3, half the original height
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide })
      );
      mesh.position.set(pos.x, pos.y, pos.z);
      if (lastViewerT) mesh.lookAt(lastViewerT.x, mesh.position.y, lastViewerT.z);
      mesh._noteCanvas = c;
      mesh._noteTex = tex;
      scene.add(mesh);
      updateStickyText(mesh, 'Listening...');
      return mesh;
    }

    function updateStickyText(mesh, text, edgeHighlight = false) {
      const c = mesh._noteCanvas;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 360, 270);
      ctx.fillStyle = '#545454';
      rrect(ctx, 0, 0, 360, 270, 20); ctx.fill();
      if (edgeHighlight) {
        ctx.strokeStyle = '#1a3cef'; ctx.lineWidth = 4;
        rrect(ctx, 2, 2, 356, 266, 19); ctx.stroke();
      }
      // Recording indicator bar
      rrect(ctx, 0, 0, 360, 52, 20); ctx.fillStyle = '#1c1917'; ctx.fill();
      ctx.fillRect(0, 32, 360, 20);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center';
      ctx.fillText('🎙 Recording...', 180, 34);
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px Arial'; ctx.textAlign = 'left';
      const words = text.split(' ');
      let line = '', y = 76;
      for (const w of words) {
        const test = line + w + ' ';
        if (ctx.measureText(test).width > 316 && line) { ctx.fillText(line, 22, y); line = w + ' '; y += 28; }
        else line = test;
        if (y > 248) { ctx.fillText(line.trim() + '…', 22, y); line = null; break; }
      }
      if (line) ctx.fillText(line.trim(), 22, y);
      mesh._noteTex.needsUpdate = true;
    }

    function drawTrashIcon(ctx, cx, cy, color) {
      ctx.fillStyle = color;
      ctx.fillRect(cx - 8, cy - 10, 16, 3);   // lid
      ctx.fillRect(cx - 5, cy - 13, 10, 3);   // handle
      ctx.fillRect(cx - 7, cy - 6, 14, 14);   // body
      ctx.fillStyle = '#ef4444';               // dividers (cut-outs via same bg colour trick)
      ctx.fillRect(cx - 2, cy - 4, 2, 9);
      ctx.fillRect(cx + 2, cy - 4, 2, 9);
    }

    function updateStickyFinal(mesh, noteEntry, playing = false, edgeHighlight = false) {
      const c = mesh._noteCanvas;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 360, 270);
      // Background
      ctx.fillStyle = '#545454';
      rrect(ctx, 0, 0, 360, 270, 20); ctx.fill();
      if (edgeHighlight) {
        ctx.strokeStyle = '#1a3cef'; ctx.lineWidth = 4;
        rrect(ctx, 2, 2, 356, 266, 19); ctx.stroke();
      }
      // Top bar with play + trash buttons
      rrect(ctx, 0, 0, 360, 56, 20); ctx.fillStyle = '#1c1917'; ctx.fill();
      ctx.fillRect(0, 36, 360, 20);
      // Play button circle — left (UV: u<0.15, v>0.80)
      ctx.fillStyle = noteEntry.audioUrl ? '#1a3cef' : '#6b7280';
      ctx.beginPath(); ctx.arc(34, 28, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
      if (playing) {
        // Two vertical bars (pause) drawn as rectangles — avoids emoji color override
        ctx.fillRect(27, 18, 5, 20);
        ctx.fillRect(37, 18, 5, 20);
      } else {
        ctx.fillText('▶', 36, 35);
      }
      // Trash button circle — right (UV: u>0.85, v>0.80)
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(326, 28, 20, 0, Math.PI * 2); ctx.fill();
      drawTrashIcon(ctx, 326, 28, '#fff');
      // Waveform bars between buttons
      ctx.fillStyle = '#ffffff';
      const bars = [8, 16, 24, 12, 20, 28, 14, 22, 18, 26, 10];
      bars.forEach((h, i) => {
        ctx.fillRect(76 + i * 18, 28 - h / 2, 6, h);
      });
      // Transcribed text
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'left';
      const text = noteEntry.text || '(no transcript)';
      const words = text.split(' ');
      let line = '', y = 80;
      for (const w of words) {
        const test = line + w + ' ';
        if (ctx.measureText(test).width > 316 && line) { ctx.fillText(line, 22, y); line = w + ' '; y += 26; }
        else line = test;
        if (y > 192) { ctx.fillText(line.trim() + '…', 22, y); line = null; break; }
      }
      if (line) ctx.fillText(line.trim(), 22, y);
      // Bottom geo + timestamp bar
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 210, 360, 60);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
      // Cache random coords so hover redraws don't re-randomize
      if (!noteEntry._geo) {
        const rc = (min, max) => (Math.random() * (max - min) + min).toFixed(5);
        noteEntry._geo = (noteEntry.lat != null && noteEntry.lng != null)
          ? `${noteEntry.lat.toFixed(5)}\xB0, ${noteEntry.lng.toFixed(5)}\xB0`
          : `${rc(-90, 90)}\xB0, ${rc(-180, 180)}\xB0`;
      }
      ctx.fillText(noteEntry._geo, 180, 232);
      ctx.fillText(noteEntry.timestamp || '', 180, 252);
      mesh._noteTex.needsUpdate = true;
    }

    function createAIStickyNote(text, pos) {
      const c = document.createElement('canvas');
      c.width = 360; c.height = 270;
      const tex = new THREE.CanvasTexture(c);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.266, 0.2),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide })
      );
      mesh.position.set(pos.x, pos.y, pos.z);
      if (lastViewerT) mesh.lookAt(lastViewerT.x, mesh.position.y, lastViewerT.z);
      mesh._noteCanvas = c;
      mesh._noteTex = tex;
      mesh._isAINote = true;
      scene.add(mesh);
      drawAIStickyNote(mesh, text);
      return mesh;
    }

    function drawAIStickyNote(mesh, text, edgeHighlight = false) {
      const c = mesh._noteCanvas;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 360, 270);
      ctx.fillStyle = '#545454';
      rrect(ctx, 0, 0, 360, 270, 20); ctx.fill();
      if (edgeHighlight) {
        ctx.strokeStyle = '#1a3cef'; ctx.lineWidth = 4;
        rrect(ctx, 2, 2, 356, 266, 19); ctx.stroke();
      }
      // Top bar — same height as voice note (56px)
      rrect(ctx, 0, 0, 360, 56, 20); ctx.fillStyle = '#1c1917'; ctx.fill();
      ctx.fillRect(0, 36, 360, 20);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'left';
      ctx.fillText('AI Analysis', 16, 32);
      // Trash button circle — top-right (UV: u>0.83, v>0.78), matches voice note
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(326, 28, 20, 0, Math.PI * 2); ctx.fill();
      drawTrashIcon(ctx, 326, 28, '#fff');
      // Body text — starts below the taller bar
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'left';
      const words = text.split(' ');
      let line = '', y = 80;
      for (const w of words) {
        const test = line + w + ' ';
        if (ctx.measureText(test).width > 316 && line) { ctx.fillText(line, 22, y); line = w + ' '; y += 26; }
        else line = test;
        if (y > 210) { ctx.fillText(line.trim() + '…', 22, y); line = null; break; }
      }
      if (line) ctx.fillText(line.trim(), 22, y);
      mesh._noteTex.needsUpdate = true;
    }

    // Vosk WASM offline STT state
    function rlog(msg, data) {
      console.log('[frontend]', msg, data ?? '');
      fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg, data }) }).catch(() => {});
    }

    let voskModel = null;
    let voskRecognizer = null;
    let audioContext = null;
    let voskToken = 0; // incremented on each startVosk call; stopVosk increments to cancel in-flight async
    let audioSource = null;
    let audioProcessor = null;
    let micStream = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let pendingGeo = null; // { lat, lng } fetched at note start
    let activeNoteCallbacks = null; // { mesh, noteEntry }

    function saveNotes() {
      fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, notes: voiceNotes }),
      }).then(r => r.json())
        .then(() => console.log('[vosk] notes saved, scan:', scanId))
        .catch(e => console.warn('[vosk] notes save failed:', e));
    }

    async function startVosk(meshSnapshot, noteSnapshot) {
      // Cancel any in-flight async setup from a previous call
      const myToken = ++voskToken;
      stopVoskAudio(); // ensure previous session is torn down before starting new one
      activeNoteCallbacks = { mesh: meshSnapshot, noteEntry: noteSnapshot };
      if (meshSnapshot) updateStickyText(meshSnapshot, 'Loading...');

      // 1. Load model once, cache in closure
      if (!voskModel) {
        try {
          rlog('vosk loading model...');
          const { createModel } = await import('vosk-browser');
          voskModel = await Promise.race([
            createModel('/assets/vosk-model-small-en-us-0.15.tar.gz'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
          ]);
          rlog('vosk model loaded OK');
        } catch (e) {
          rlog('vosk model load FAILED', e.message);
          if (myToken !== voskToken) return;
          if (meshSnapshot) updateStickyText(meshSnapshot, 'Model missing.\nAdd vosk-model-small-en-us-0.15.tar.gz to /assets/');
          return;
        }
      }

      if (myToken !== voskToken) return; // cancelled by stopVosk while model was loading

      // 2. Open microphone
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
          video: false,
        });
        rlog('vosk mic opened');
        audioChunks = [];
        try {
          mediaRecorder = new MediaRecorder(micStream);
          mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
          mediaRecorder.start();
        } catch (_e) { mediaRecorder = null; }
      } catch (e) {
        rlog('vosk mic denied', e.message);
        if (myToken !== voskToken) return;
        if (meshSnapshot) updateStickyText(meshSnapshot, 'Mic denied.');
        return;
      }

      if (myToken !== voskToken) { micStream?.getTracks().forEach(t => t.stop()); return; }

      // 3. Web Audio pipeline
      audioContext = new AudioContext();
      await audioContext.resume();
      audioSource = audioContext.createMediaStreamSource(micStream);
      audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      // 4. Create recognizer at the actual hardware sample rate
      voskRecognizer = new voskModel.KaldiRecognizer(audioContext.sampleRate);

      voskRecognizer.on('result', (msg) => {
        if (myToken !== voskToken) return;
        const text = msg.result?.text?.trim();
        if (!text) return;
        const prev = activeNoteCallbacks?.noteEntry?.text ?? '';
        const updated = prev ? `${prev} ${text}` : text;
        if (activeNoteCallbacks?.noteEntry) activeNoteCallbacks.noteEntry.text = updated;
        if (activeNoteCallbacks?.mesh) updateStickyText(activeNoteCallbacks.mesh, updated);
      });

      voskRecognizer.on('partialresult', (msg) => {
        if (myToken !== voskToken) return;
        const partial = msg.result?.partial?.trim();
        if (!partial) return;
        const base = activeNoteCallbacks?.noteEntry?.text ?? '';
        const display = base ? `${base} ${partial}` : partial;
        if (activeNoteCallbacks?.mesh) updateStickyText(activeNoteCallbacks.mesh, display);
      });

      audioProcessor.onaudioprocess = (e) => {
        if (!voskRecognizer) return;
        voskRecognizer.acceptWaveform(e.inputBuffer);
      };

      audioSource.connect(audioProcessor);
      audioProcessor.connect(audioContext.destination);

      if (myToken !== voskToken) { stopVoskAudio(); return; }
      if (meshSnapshot) updateStickyText(meshSnapshot, 'Listening...');
      rlog('vosk started', { sampleRate: audioContext.sampleRate });
    }

    function stopVoskAudio() {
      try { audioProcessor?.disconnect(); } catch (_) {}
      try { audioSource?.disconnect(); } catch (_) {}
      try { audioContext?.close(); } catch (_) {}
      micStream?.getTracks().forEach(t => t.stop());
      audioProcessor = null; audioSource = null; audioContext = null; micStream = null;
    }

    function stopVosk() {
      voskToken++; // cancel any in-flight startVosk async chain
      rlog('stopVosk called', { hasRecognizer: !!voskRecognizer, hasCallbacks: !!activeNoteCallbacks });
      if (voskRecognizer) {
        try { voskRecognizer.free(); } catch (_) {}
        voskRecognizer = null;
      }

      const text = activeNoteCallbacks?.noteEntry?.text?.trim() ?? '';
      rlog('stopVosk saving text', text);

      if (activeNoteCallbacks) {
        const { mesh, noteEntry } = activeNoteCallbacks;
        if (noteEntry) noteEntry.text = text;
        noteEntry.lat = pendingGeo?.lat ?? null;
        noteEntry.lng = pendingGeo?.lng ?? null;
        noteEntry.timestamp = new Date().toLocaleString();

        const finalize = () => {
          if (mesh) updateStickyFinal(mesh, noteEntry);
          stickyNotes.push({ mesh, noteEntry });
        };

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            noteEntry.audioUrl = URL.createObjectURL(blob);
            mediaRecorder = null;
            finalize();
          };
          mediaRecorder.stop();
        } else {
          noteEntry.audioUrl = null;
          mediaRecorder = null;
          finalize();
        }

        if (text) saveNotes();
      }

      stopVoskAudio();
      activeNoteCallbacks = null;
      annotating = false; activeStickyMesh = null; draggingActiveNote = false;
      vPanel.visible = false; drawStatus();
    }

    function fallbackFloorPoint(dist) {
      if (!lastViewerT || !lastViewerFwd) return null;
      return { x: lastViewerT.x + lastViewerFwd.x * dist, y: lastFloorY, z: lastViewerT.z + lastViewerFwd.z * dist };
    }

    function recomputeCarGeometry(scene) {
      const pts = wheelPoints;
      carCenter = {
        x: pts.reduce((s, p) => s + p.x, 0) / 4,
        z: pts.reduce((s, p) => s + p.z, 0) / 4,
      };
      const frontMidX = (pts[0].x + pts[1].x) / 2, frontMidZ = (pts[0].z + pts[1].z) / 2;
      const rearMidX  = (pts[2].x + pts[3].x) / 2, rearMidZ  = (pts[2].z + pts[3].z) / 2;
      carLength = Math.max(Math.sqrt((frontMidX - rearMidX) ** 2 + (frontMidZ - rearMidZ) ** 2), 2);
      const carWidth = Math.max(
        Math.sqrt((pts[0].x - pts[1].x) ** 2 + (pts[0].z - pts[1].z) ** 2),
        Math.sqrt((pts[2].x - pts[3].x) ** 2 + (pts[2].z - pts[3].z) ** 2),
        1
      );
      scanRadius = Math.sqrt((carLength / 2) ** 2 + (carWidth / 2) ** 2) + 0.3;
      // Remove existing ring meshes and rebuild
      ringMeshes.forEach(m => scene.remove(m));
      ringMeshes = [];
      createScanRing(scene);
    }

    // Returns world-space point where the controller ray hits the car bounding box, or null
    function rayBoxIntersect(poses) {
      if (!carCenter) return null;
      const box = new THREE.Box3(
        new THREE.Vector3(carCenter.x - 1.1, lastFloorY,       carCenter.z - carLength / 2),
        new THREE.Vector3(carCenter.x + 1.1, lastFloorY + 1.8, carCenter.z + carLength / 2)
      );
      for (const p of poses) {
        const origin = new THREE.Vector3(p.x, p.y, p.z);
        const quat   = new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw);
        const dir    = new THREE.Vector3(0, 0, -1).applyQuaternion(quat).normalize();
        const ray    = new THREE.Ray(origin, dir);
        const hit    = new THREE.Vector3();
        if (ray.intersectBox(box, hit)) return { x: hit.x, y: hit.y, z: hit.z };
      }
      return null;
    }

    // Returns index of the wheel sphere whose center is within 0.25m of the controller ray, or -1
    function raySphereHit(poses, spheres) {
      for (const p of poses) {
        const quat = new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
        const origin = new THREE.Vector3(p.x, p.y, p.z);
        for (let i = 0; i < spheres.length; i++) {
          if (!spheres[i].visible) continue;
          const toSphere = spheres[i].position.clone().sub(origin);
          const proj = toSphere.dot(dir);
          if (proj < 0) continue;
          const dist = origin.clone().addScaledVector(dir, proj).distanceTo(spheres[i].position);
          if (dist < 0.25) return i;
        }
      }
      return -1;
    }

    async function start() {
      // Geolocation is now fetched in ScanScene before XR session starts (Quest drops XR on permission dialogs)
      if (navigator.geolocation && !providedSession) {
        let watchId = null;
        pendingGeo = await new Promise(resolve => {
          const done = (geo) => { navigator.geolocation.clearWatch(watchId); resolve(geo); };
          watchId = navigator.geolocation.watchPosition(
            p => done({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => done(null),
            { timeout: 8000, maximumAge: 60000, enableHighAccuracy: true }
          );
          setTimeout(() => done(pendingGeo), 8000);
        });
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      } catch (e) { console.warn('[ImmersiveScan] camera:', e.message); }

      if (providedSession) {
        session = providedSession;
        sessionRef.current = session;
      } else {
        try {
          session = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['local-floor', 'unbounded'],
            optionalFeatures: ['hit-test', 'hand-tracking'],
          });
          sessionRef.current = session;
        } catch (e) { console.error('[ImmersiveScan] XR:', e); onExit(); return; }
      }

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local-floor');
      await renderer.xr.setSession(session);
      document.body.appendChild(renderer.domElement);
      renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9999;';

      refSpace = renderer.xr.getReferenceSpace();
      const viewerSpace = await session.requestReferenceSpace('viewer');
      try { hitTestSource = await session.requestHitTestSource({ space: viewerSpace }); }
      catch (e) { console.warn('[ImmersiveScan] no hit-test, using fallback'); }

      scene = new THREE.Scene();

      // Head-locked status panel
      mTex = new THREE.CanvasTexture(mCanvas);
      const mPanel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.44, 0.22),
        new THREE.MeshBasicMaterial({ map: mTex, transparent: true, depthWrite: false })
      );
      scene.add(mPanel);
      drawSetup(0);

      // Voice panel
      vTex = new THREE.CanvasTexture(vCanvas);
      vPanel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.44, 0.26),
        new THREE.MeshBasicMaterial({ map: vTex, transparent: true, depthWrite: false })
      );
      vPanel.visible = false;
      scene.add(vPanel);

      // Exit button (head-locked, top-right corner)
      const exitCanvas = document.createElement('canvas');
      exitCanvas.width = 256; exitCanvas.height = 80;
      const exitCtx = exitCanvas.getContext('2d');
      exitCtx.fillStyle = '#323232';
      rrect(exitCtx, 0, 0, 256, 80, 16); exitCtx.fill();
      exitCtx.fillStyle = 'white'; exitCtx.font = 'bold 28px Arial'; exitCtx.textAlign = 'center';
      exitCtx.fillText('✕  Exit Scan', 128, 50);
      const exitTex = new THREE.CanvasTexture(exitCanvas);
      const exitBtn = new THREE.Mesh(
        new THREE.PlaneGeometry(0.18, 0.056),
        new THREE.MeshBasicMaterial({ map: exitTex, transparent: true, depthWrite: false })
      );
      exitBtn.visible = false;
      scene.add(exitBtn);

      // Confirm wheel placement button
      const confirmCanvas = document.createElement('canvas');
      confirmCanvas.width = 256; confirmCanvas.height = 80;
      const confirmCtx = confirmCanvas.getContext('2d');
      confirmCtx.fillStyle = '#323232';
      rrect(confirmCtx, 0, 0, 256, 80, 16); confirmCtx.fill();
      confirmCtx.fillStyle = 'white'; confirmCtx.font = 'bold 28px Arial'; confirmCtx.textAlign = 'center';
      confirmCtx.fillText('✓  Confirm Wheels', 128, 50);
      const confirmTex = new THREE.CanvasTexture(confirmCanvas);
      const confirmBtn = new THREE.Mesh(
        new THREE.PlaneGeometry(0.18, 0.056),
        new THREE.MeshBasicMaterial({ map: confirmTex, transparent: true, depthWrite: false })
      );
      confirmBtn.visible = false;
      scene.add(confirmBtn);

      // AI Logs tray
      logsTex = new THREE.CanvasTexture(logsCanvas);
      logsPanel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.28, 0.364), // 400:520 ratio
        new THREE.MeshBasicMaterial({ map: logsTex, transparent: true, depthWrite: false })
      );
      logsPanel.visible = false; // shown only after wheel placement
      drawLogsTray();
      scene.add(logsPanel);

      // Wheel marker spheres
      const wheelSpheres = WHEEL_COLORS.map(col => {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.10, 16, 16),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, roughness: 0.3, metalness: 0.4 })
        );
        m.visible = false;
        scene.add(m);
        return m;
      });

      // Floor cursor — ring that follows ray-floor intersection during setup
      const cursor = new THREE.Mesh(
        new THREE.RingGeometry(0.07, 0.12, 32),
        new THREE.MeshBasicMaterial({ color: 0x1a3cef, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
      );
      cursor.rotation.x = -Math.PI / 2;
      cursor.visible = false;
      scene.add(cursor);

      // Note placement preview — small floating yellow square shown during scanning
      // so the user can see exactly where (and how far) the note will land before triggering
      const notePreviewCanvas = document.createElement('canvas');
      notePreviewCanvas.width = 128; notePreviewCanvas.height = 128;
      const npc = notePreviewCanvas.getContext('2d');
      npc.fillStyle = '#d2d2d2';
      npc.beginPath(); npc.roundRect(4, 4, 120, 120, 16); npc.fill();
      npc.strokeStyle = '#686868'; npc.lineWidth = 4;
      npc.beginPath(); npc.roundRect(4, 4, 120, 120, 16); npc.stroke();
      npc.fillStyle = '#4d4d4d'; npc.font = 'bold 52px Arial'; npc.textAlign = 'center'; npc.textBaseline = 'middle';
      npc.fillText('🎙', 64, 64);
      const notePreviewTex = new THREE.CanvasTexture(notePreviewCanvas);
      const notePreview = new THREE.Mesh(
        new THREE.PlaneGeometry(0.08, 0.08),
        new THREE.MeshBasicMaterial({ map: notePreviewTex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      );
      notePreview.visible = false;
      scene.add(notePreview);

      // Controller rays
      const rayGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -3),
      ]);
      const rayMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
      const leftRay = new THREE.Line(rayGeo, rayMat.clone());
      const rightRay = new THREE.Line(rayGeo, rayMat.clone());
      leftRay.visible = false; rightRay.visible = false;
      scene.add(leftRay, rightRay);

      const xrCam = new THREE.PerspectiveCamera();

      session.requestAnimationFrame(function loop(time, frame) {
        session.requestAnimationFrame(loop);
        if (phase === 'complete') return;

        const vp = frame.getViewerPose(refSpace);
        if (!vp) { renderer.render(scene, xrCam); return; }

        const { x: tx, y: ty, z: tz } = vp.transform.position;
        const q = vp.transform.orientation;
        const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);

        lastViewerT = { x: tx, y: ty, z: tz };
        lastViewerFwd = { x: fwd.x, y: fwd.y, z: fwd.z };

        // Head-lock status panel (top of view)
        mPanel.position.set(tx + fwd.x * 0.9, ty + 0.08 + fwd.y * 0.9, tz + fwd.z * 0.9);
        mPanel.quaternion.copy(quat);

        // Voice panel (right of status panel)
        if (vPanel.visible) {
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
          vPanel.position.set(
            tx + fwd.x * 0.88 + right.x * 0.34,
            ty - 0.04 + fwd.y * 0.88,
            tz + fwd.z * 0.88 + right.z * 0.34
          );
          vPanel.quaternion.copy(quat);
        }

        // Exit button (centred, always visible)
        {
          exitBtn.position.set(
            tx + fwd.x * 0.88,
            ty + 0.19 + fwd.y * 0.88,
            tz + fwd.z * 0.88
          );
          exitBtn.quaternion.copy(quat);
        }

        // Confirm button — centered below status panel during 'confirm' phase
        if (confirmBtn.visible) {
          confirmBtn.position.set(tx + fwd.x * 0.88, ty + 0.19 + fwd.y * 0.88, tz + fwd.z * 0.88);
          confirmBtn.quaternion.copy(quat);
        }

        // AI Logs tray (right of status panel)
        if (logsPanel.visible) {
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
          logsPanel.position.set(
            tx + fwd.x * 0.88 + right.x * 0.38,
            ty - 0.06 + fwd.y * 0.88,
            tz + fwd.z * 0.88 + right.z * 0.38
          );
          logsPanel.quaternion.copy(quat);
        }

        // Controller rays — update pose cache for floor intersection on trigger
        leftRay.visible = false; rightRay.visible = false;
        lastControllerPoses = [];
        for (const src of session.inputSources) {
          if (!src.targetRaySpace) continue;
          const rp = frame.getPose(src.targetRaySpace, refSpace);
          if (!rp) continue;
          const rt = rp.transform.position, rq = rp.transform.orientation;
          const ray = src.handedness === 'left' ? leftRay : rightRay;
          ray.position.set(rt.x, rt.y, rt.z);
          ray.quaternion.set(rq.x, rq.y, rq.z, rq.w);
          ray.visible = true;
          // Cache position + orientation so selectend can compute floor intersection
          lastControllerPoses.push({ x: rt.x, y: rt.y, z: rt.z, qx: rq.x, qy: rq.y, qz: rq.z, qw: rq.w });
        }

        // Hit-test during setup — track real floor Y in current reference space
        if (hitTestSource && WHEEL_PHASES.includes(phase)) {
          const hits = frame.getHitTestResults(hitTestSource);
          if (hits.length > 0) lastFloorY = hits[0].getPose(refSpace).transform.position.y;
        }

        // Floor cursor — follows ray intersection during setup/confirm so user sees landing point
        if (WHEEL_PHASES.includes(phase)) {
          const floorPt = rayFloorIntersect(lastControllerPoses, lastFloorY);
          if (floorPt) {
            cursor.position.set(floorPt.x, lastFloorY + 0.01, floorPt.z);
            cursor.visible = true;
          } else {
            cursor.visible = false;
          }
        } else {
          cursor.visible = false;
        }

        // Grabbed sphere follows ray-floor intersection (only when not locked)
        if (grabbedSphereIdx !== -1 && !wheelsLocked) {
          const floorPt = rayFloorIntersect(lastControllerPoses, lastFloorY);
          if (floorPt) {
            wheelSpheres[grabbedSphereIdx].position.set(floorPt.x, lastFloorY + 0.08, floorPt.z);
          }
        }

        // Hit-test during confirm phase too — update floor Y
        if (hitTestSource && phase === 'confirm') {
          const hits = frame.getHitTestResults(hitTestSource);
          if (hits.length > 0) lastFloorY = hits[0].getPose(refSpace).transform.position.y;
        }

        // Scanning logic
        if (phase === 'scanning') {
          const { x: cx, z: cz } = carCenter;
          const distFromCenter = Math.sqrt((tx - cx) ** 2 + (tz - cz) ** 2);
          tooClose = distFromCenter < (scanRadius - 0.3);
          const azDeg = ((Math.atan2(tz - cz, tx - cx) * 180 / Math.PI) + 360) % 360;
          currentBucket = Math.floor(azDeg / BUCKET_DEG) % BUCKETS;

          const video = videoRef.current;
          if (!tooClose && !annotating && video?.videoWidth > 0 && time - bucketCooldowns[currentBucket] > 500) {
            bucketCooldowns[currentBucket] = time;
            captureFrame(video, currentBucket, azDeg);
          }

          if (buckets.filter(Boolean).length >= MIN_BUCKETS_COMPLETE) exitBtn.visible = true;

          if (time - lastRingUpdate > 100) { lastRingUpdate = time; updateRing(); }
          if (time - lastPanelDraw > 150) { lastPanelDraw = time; drawStatus(); }

          // Active note: if being dragged follow controller ray, otherwise face viewer
          if (activeStickyMesh) {
            if (draggingActiveNote && lastControllerPoses.length > 0) {
              const p = lastControllerPoses[0];
              const d = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw)).normalize();
              activeStickyMesh.position.set(p.x + d.x * 1.0, p.y + d.y * 1.0, p.z + d.z * 1.0);
            }
            activeStickyMesh.lookAt(tx, activeStickyMesh.position.y, tz);
          }


          // Dragging a sticky note — follow controller ray at 1m
          if (grippedStickyIdx !== -1 && lastControllerPoses.length > 0) {
            const p = lastControllerPoses[0];
            const dir = new THREE.Vector3(0, 0, -1)
              .applyQuaternion(new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw)).normalize();
            stickyNotes[grippedStickyIdx].mesh.position.set(
              p.x + dir.x * 1.0, p.y + dir.y * 1.0, p.z + dir.z * 1.0
            );
          }

          // Edge hover detection — highlight note border when ray is near an edge
          if (!annotating && grippedStickyIdx === -1 && stickyNotes.length > 0 && lastControllerPoses.length > 0) {
            let newHover = -1;
            for (const p of lastControllerPoses) {
              const origin = new THREE.Vector3(p.x, p.y, p.z);
              const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw)).normalize();
              const hits = new THREE.Raycaster(origin, dir).intersectObjects(stickyNotes.map(n => n.mesh));
              if (hits.length > 0 && hits[0].uv) {
                const { x: u, y: v } = hits[0].uv;
                const inTrash = u > 0.83 && v > 0.78;
                const inPlay  = u < 0.15 && v > 0.80;
                const onEdge  = !inTrash && !inPlay && (u < 0.22 || u > 0.78 || v > 0.78 || v < 0.20);
                if (onEdge) { newHover = stickyNotes.findIndex(n => n.mesh === hits[0].object); break; }
              }
            }
            if (newHover !== hoveredStickyIdx) {
              // Clear old highlight
              if (hoveredStickyIdx !== -1 && hoveredStickyIdx < stickyNotes.length) {
                const old = stickyNotes[hoveredStickyIdx];
                if (old.noteEntry.isAI) drawAIStickyNote(old.mesh, old.noteEntry.text);
                else updateStickyFinal(old.mesh, old.noteEntry, activeAudioMesh === old.mesh, false);
              }
              // Apply new highlight
              if (newHover !== -1) {
                const n = stickyNotes[newHover];
                if (n.noteEntry.isAI) drawAIStickyNote(n.mesh, n.noteEntry.text, true);
                else updateStickyFinal(n.mesh, n.noteEntry, activeAudioMesh === n.mesh, true);
              }
              hoveredStickyIdx = newHover;
            }
          }
        } else {
          notePreview.visible = false;
        }

        renderer.render(scene, xrCam);
      });

      session.addEventListener('selectstart', () => {
        // During recording — any trigger press drags the active note
        if (annotating && activeStickyMesh) {
          draggingActiveNote = true;
          return;
        }
        // During scanning — trigger grabs a saved note only when hovering its edge
        if (wheelsLocked && phase === 'scanning' && !annotating) {
          if (hoveredStickyIdx !== -1) {
            grippedStickyIdx = hoveredStickyIdx;
            hoveredStickyIdx = -1;
          }
          return;
        }
        if (phase === 'complete' || wheelsLocked) return;
        // Setup phases — grab wheel spheres
        const hitIdx = raySphereHit(lastControllerPoses, wheelSpheres);
        if (hitIdx !== -1) {
          grabbedSphereIdx = hitIdx;
          wheelSpheres[hitIdx].material.color.set(0xffffff);
        }
      });

      // Trigger handler
      session.addEventListener('selectend', () => {
        console.log('[trigger] selectend phase=', phase, 'annotating=', annotating, 'tooClose=', tooClose, 'controllers=', lastControllerPoses.length);
        if (phase === 'complete') return;

        // Confirm placement button — lock wheels and start scan
        if (phase === 'confirm') {
          for (const p of lastControllerPoses) {
            const origin = new THREE.Vector3(p.x, p.y, p.z);
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw)).normalize();
            if (new THREE.Raycaster(origin, dir).intersectObject(confirmBtn).length > 0) {
              wheelsLocked = true;
              confirmBtn.visible = false;
              recomputeCarGeometry(scene);
              phase = 'scanning';
              logsPanel.visible = true;
              drawStatus();
              // Kick off first analysis immediately so the AI panel populates without waiting for bucket capture
              const video = videoRef.current;
              if (video && video.videoWidth) captureFrame(video, 0, 0);
              return;
            }
          }
          // In confirm phase, taps that miss the button can still move spheres
          // Fall through to grab logic below
        }

        // Exit button hit check
        for (const p of lastControllerPoses) {
          const origin = new THREE.Vector3(p.x, p.y, p.z);
          const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw)).normalize();
          const raycaster = new THREE.Raycaster(origin, dir);
          if (raycaster.intersectObject(exitBtn).length > 0) {
            phase = 'complete';
            fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ scanId, notes: voiceNotes }) }).catch(() => {});
            renderer.domElement.style.pointerEvents = 'none';
            // Call immediately so ScanScene transitions away from 'scan' step right away.
            // Any still-pending analyses are ignored — we use whatever came back during scanning.
            onCapture(buckets.filter(Boolean), voiceNotes, mergeDamageAnalyses());
            session.end().catch(() => {});
            return;
          }
        }

        // Release grab — update wheel point and recompute car geometry
        if (grabbedSphereIdx !== -1) {
          const sp = wheelSpheres[grabbedSphereIdx].position;
          wheelPoints[grabbedSphereIdx] = { x: sp.x, y: lastFloorY, z: sp.z };
          wheelSpheres[grabbedSphereIdx].material.color.set(WHEEL_COLORS[grabbedSphereIdx]);
          grabbedSphereIdx = -1;
          // If all 4 placed and in scanning, recompute ring
          if (wheelPoints.every(Boolean) && phase === 'scanning') recomputeCarGeometry(scene);
          return;
        }

        const phaseIdx = WHEEL_PHASES.indexOf(phase);

        if (phaseIdx !== -1) {
          // Primary: intersect the controller ray with the floor plane (y=0)
          // This places the sphere exactly where the ray beam touches the ground.
          const pt = rayFloorIntersect(lastControllerPoses, lastFloorY) ?? fallbackFloorPoint(3);

          // Debug: log viewer Y, controller Y, floor Y, and computed intersection
          console.log('[ImmersiveScan] placement debug', {
            viewerY: lastViewerT?.y?.toFixed(3),
            lastFloorY: lastFloorY?.toFixed(3),
            controllers: lastControllerPoses.map(p => ({ y: p.y.toFixed(3), qy: p.qy.toFixed(3) })),
            intersectPt: pt ? { x: pt.x.toFixed(3), y: pt.y.toFixed(3), z: pt.z.toFixed(3) } : null,
          });

          if (pt) {
            lastDebugPt = pt;
            wheelPoints[phaseIdx] = { x: pt.x, y: pt.y, z: pt.z };
            wheelSpheres[phaseIdx].position.set(pt.x, pt.y + 0.08, pt.z);
            wheelSpheres[phaseIdx].visible = true;

            const nextIdx = phaseIdx + 1;
            if (nextIdx < WHEEL_PHASES.length) {
              phase = WHEEL_PHASES[nextIdx];
              drawSetup(nextIdx);
            } else {
              // All 4 wheels placed — go to confirm phase before starting scan
              phase = 'confirm';
              drawConfirm();
              confirmBtn.visible = true;
            }
          }
          return;
        }

        if (phase === 'scanning') {
          // Release grabbed sticky note — don't run other handlers
          if (grippedStickyIdx !== -1) { grippedStickyIdx = -1; return; }
          if (draggingActiveNote) { draggingActiveNote = false; return; }
          if (annotating) { stopVosk(); return; }

          // Logs tray Save/Cancel clicks
          if (logsPanel.visible) {
            for (const p of lastControllerPoses) {
              const origin = new THREE.Vector3(p.x, p.y, p.z);
              const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw)).normalize();
              const hits = new THREE.Raycaster(origin, dir).intersectObject(logsPanel);
              if (hits.length > 0 && hits[0].uv) {
                const { x: u, y: v } = hits[0].uv;
                // Canvas y = (1 - v) * 520; items start at cy=82, each 154px (CARD_H=148 + gap 6)
                const canvasY = (1 - v) * 520;
                const pending = aiLogs.filter(l => !l.saved);
                const visible = pending.slice(-3);
                const CARD_H = 148;
                const itemIdx = Math.floor((canvasY - 82) / (CARD_H + 6));
                if (itemIdx >= 0 && itemIdx < visible.length) {
                  const btnCanvasY = 82 + itemIdx * (CARD_H + 6) + CARD_H - 40;
                  const btnCanvasYBot = btnCanvasY + 30;
                  if (canvasY >= btnCanvasY && canvasY <= btnCanvasYBot) {
                    const log = visible[itemIdx];
                    if (u < 0.40) {
                      // Cancel — remove from aiLogs
                      aiLogs = aiLogs.filter(l => l.id !== log.id);
                      drawLogsTray();
                    } else if (u > 0.43) {
                      // Save — mark saved, spawn AI sticky note near car
                      log.saved = true;
                      const angle = (currentBucket / 5) * Math.PI * 2;
                      const spawnDist = (scanRadius || 2) * 0.6;
                      const cx = carCenter ? carCenter.x : (lastViewerT?.x ?? 0);
                      const cz = carCenter ? carCenter.z : (lastViewerT?.z ?? -1.5);
                      const nx = cx + Math.cos(angle) * spawnDist;
                      const nz = cz + Math.sin(angle) * spawnDist;
                      const ny = (lastViewerT?.y ?? 1.5) - 0.3;
                      const noteText = [log.name, log.damageType ? `Type: ${log.damageType}` : null, log.severity ? `Severity: ${log.severity}` : null, log.description].filter(Boolean).join('\n');
                      const mesh = createAIStickyNote(noteText, { x: nx, y: ny, z: nz });
                      stickyNotes.push({ mesh, noteEntry: { id: log.id, text: noteText, isAI: true } });
                      drawLogsTray();
                    }
                    return;
                  }
                }
              }
            }
          }

          // Trash icon on any sticky note (UV: u>0.83, v<0.09)
          if (stickyNotes.length > 0) {
            for (const p of lastControllerPoses) {
              const origin = new THREE.Vector3(p.x, p.y, p.z);
              const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw)).normalize();
              const hits = new THREE.Raycaster(origin, dir).intersectObjects(stickyNotes.map(n => n.mesh));
              if (hits.length > 0 && hits[0].uv) {
                const { x: u, y: v } = hits[0].uv;
                if (u > 0.83 && v > 0.78) {
                  // Trash hit — delete this note
                  const hitMesh = hits[0].object;
                  const hitNote = stickyNotes.find(n => n.mesh === hitMesh);
                  if (activeAudioMesh === hitMesh) { activeAudio?.pause(); activeAudio = null; activeAudioMesh = null; }
                  scene.remove(hitMesh);
                  stickyNotes = stickyNotes.filter(n => n.mesh !== hitMesh);
                  if (hitNote?.noteEntry) {
                    if (hitNote.noteEntry.isAI) {
                      aiLogs = aiLogs.filter(l => l.id !== hitNote.noteEntry.id);
                      drawLogsTray();
                    } else {
                      voiceNotes = voiceNotes.filter(n => n.id !== hitNote.noteEntry.id);
                      saveNotes();
                    }
                  }
                  return;
                }
                // Play/pause for voice notes (non-AI)
                if (u < 0.11 && v > 0.79) {
                  const hit = stickyNotes.find(n => n.mesh === hits[0].object);
                  if (hit && !hit.noteEntry.isAI && hit.noteEntry.audioUrl) {
                    if (activeAudio && activeAudioMesh === hit.mesh) {
                      activeAudio.pause(); activeAudio = null; activeAudioMesh = null;
                      updateStickyFinal(hit.mesh, hit.noteEntry, false);
                    } else {
                      if (activeAudio) {
                        activeAudio.pause();
                        const prev = stickyNotes.find(n => n.mesh === activeAudioMesh);
                        if (prev) updateStickyFinal(prev.mesh, prev.noteEntry, false);
                      }
                      activeAudio = new Audio(hit.noteEntry.audioUrl);
                      activeAudioMesh = hit.mesh;
                      updateStickyFinal(hit.mesh, hit.noteEntry, true);
                      activeAudio.onended = () => { activeAudio = null; activeAudioMesh = null; updateStickyFinal(hit.mesh, hit.noteEntry, false); };
                      activeAudio.play().catch(() => {});
                    }
                    return;
                  }
                }
              }
            }
          }
        }
        // Note creation is on grip (squeezeend) — see handler below
      });

      // Grip press — start recording a voice note immediately
      session.addEventListener('squeezestart', () => {
        if (phase !== 'scanning' || annotating) return;
        // Place note and start recording immediately
        gripHeld = true;
        notePreview.visible = false;

        let pos = null;
        const floorHit = rayFloorIntersect(lastControllerPoses, lastFloorY);
        if (floorHit && carCenter) {
          const dx = floorHit.x - carCenter.x, dz = floorHit.z - carCenter.z;
          if (Math.sqrt(dx * dx + dz * dz) < scanRadius * 1.3)
            pos = { x: floorHit.x, y: floorHit.y + 0.07, z: floorHit.z };
        }
        if (!pos && lastControllerPoses.length > 0) {
          const p0 = lastControllerPoses[0];
          const d = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(p0.qx, p0.qy, p0.qz, p0.qw)).normalize();
          pos = { x: p0.x + d.x * 1.5, y: p0.y + d.y * 1.5, z: p0.z + d.z * 1.5 };
        }
        if (!pos) pos = fallbackFloorPoint(1.5) ?? { x: 0, y: lastFloorY + 0.07, z: -1.5 };

        activeStickyMesh = makeStickyNote(pos);

        const noteAzDeg = (carCenter && lastViewerT)
          ? ((Math.atan2(lastViewerT.z - carCenter.z, lastViewerT.x - carCenter.x) * 180 / Math.PI) + 360) % 360
          : currentBucket * BUCKET_DEG;
        const noteEntry = { id: String(Date.now()), text: '', angle: noteAzDeg, position3d: pos };
        voiceNotes.push(noteEntry);

        annotating = true;
        vPanel.visible = true;
        startVosk(activeStickyMesh, noteEntry);
        drawStatus();
      });

      // Grip release — stop recording and finalize
      session.addEventListener('squeezeend', () => {
        if (gripHeld && annotating) {
          gripHeld = false;
          stopVosk();
          return;
        }
        gripHeld = false;
      });

      session.addEventListener('end', () => {
        stopVosk();
        stream?.getTracks().forEach(t => t.stop());
        renderer.dispose();
        renderer.domElement.remove();
        if (phase === 'complete') return;
        onExit();
      });
    }

    // Preload Vosk model in background during wheel placement so first note has no delay
    (async () => {
      try {
        if (!voskModel) {
          const { createModel } = await import('vosk-browser');
          voskModel = await Promise.race([
            createModel('/assets/vosk-model-small-en-us-0.15.tar.gz'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
          ]);
          rlog('vosk preload complete');
        }
      } catch (e) { rlog('vosk preload failed', e.message); }
    })();

    start();
    return () => { sessionRef.current?.end().catch(() => {}); };
  }, []);

  return <video ref={videoRef} playsInline muted style={{ display: 'none' }} />;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Intersect cached controller ray(s) with the floor plane at floorY.
// floorY comes from hit-test so it's correct regardless of reference space type.
// Returns { x, y: floorY, z } or null if no ray reaches the floor.
function rayFloorIntersect(poses, floorY = 0) {
  for (const p of poses) {
    const quat = new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    if (Math.abs(dir.y) < 0.01) continue; // nearly horizontal — skip
    const t = (floorY - p.y) / dir.y;    // solve: p.y + t*dir.y = floorY
    if (t < 0) continue;                  // floor is behind the ray
    return { x: p.x + dir.x * t, y: floorY, z: p.z + dir.z * t };
  }
  return null;
}
