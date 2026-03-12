// ============================================================
//  waterfall.js  —  falling notes canvas renderer + note scheduler
// ============================================================

// ── NoteScheduler ────────────────────────────────────────────

class NoteScheduler {
  constructor() {
    this._events = [];   // sorted by startSec
  }

  load(noteEvents) {
    // already sorted by the parser
    this._events = noteEvents;
  }

  // Returns all events that should be visible or just active at `t`
  getVisible(t, fallSec) {
    const winStart = t - 0.2;        // notes that just ended (still fading out)
    const winEnd   = t + fallSec;    // notes not yet arrived

    const out = [];
    for (const ev of this._events) {
      if (ev.startSec > winEnd)      break;
      if (ev.endSec   < winStart)    continue;
      out.push(ev);
    }
    return out;
  }

  clear() { this._events = []; }
}

// ── Trail Sparkle System (waterfall-private) ─────────────────

const _sparks = [];
const _MAX_SPARKS = 320;

function _emitSpark(x, y, fill, glow) {
  if (_sparks.length >= _MAX_SPARKS) return;
  _sparks.push({
    x: x + (Math.random() - 0.5) * 7,
    y,
    vx: (Math.random() - 0.5) * 1.1,
    vy: -(0.5 + Math.random() * 1.6),
    life:  1.0,
    decay: 0.018 + Math.random() * 0.028,
    r:     0.7 + Math.random() * 1.4,
    fill,
    glow,
  });
}

function _updateDrawSparks(ctx) {
  for (let i = _sparks.length - 1; i >= 0; i--) {
    const s = _sparks[i];
    s.x    += s.vx;
    s.y    += s.vy;
    s.vy   += 0.022;   // faint gravity so they arc gently
    s.life -= s.decay;
    if (s.life <= 0) { _sparks.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = Math.max(0, s.life * 0.80);
    ctx.shadowColor = s.glow;
    ctx.shadowBlur  = 6;
    ctx.fillStyle   = s.life > 0.55 ? '#ffffff' : s.fill;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * Math.max(0.1, s.life), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── Smoke Trail System (waterfall-private) ───────────────────

const _smoke    = [];
const _MAX_SMOKE = 160;

function _emitSmoke(x, y, fill) {
  if (_smoke.length >= _MAX_SMOKE) return;
  _smoke.push({
    x:     x + (Math.random() - 0.5) * 18,
    y,
    vx:    (Math.random() - 0.5) * 0.45,
    vy:    -(0.35 + Math.random() * 0.70),
    r:     5 + Math.random() * 8,
    life:  1.0,
    decay: 0.006 + Math.random() * 0.007,
    fill,
  });
}

function _updateDrawSmoke(ctx) {
  for (let i = _smoke.length - 1; i >= 0; i--) {
    const s = _smoke[i];
    s.x    += s.vx + (Math.random() - 0.5) * 0.28;
    s.y    += s.vy;
    s.vy   *= 0.993;   // gentle deceleration
    s.r    += 0.15;    // expand as it rises
    s.life -= s.decay;
    if (s.life <= 0) { _smoke.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = Math.max(0, s.life * s.life * 0.13);
    ctx.shadowColor = s.fill;
    ctx.shadowBlur  = s.r * 3;
    ctx.fillStyle   = s.fill;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── WaterfallRenderer ────────────────────────────────────────

const WaterfallRenderer = {
  // Draw the falling notes area
  // keyboardY    — y pixel where keyboard starts (top edge)
  // currentTime  — current song time (seconds)
  // trackColorMap— Map<trackIndex, {fill, glow}>
  draw(ctx, visibleNotes, layout, keyboardY, canvasW, canvasH, currentTime, trackColorMap, fallSec) {
    const waterfallH = keyboardY;   // waterfall fills from y=0 to keyboardY

    // ── Background ──────────────────────────────────────────
    const bgGrad = ctx.createLinearGradient(0, 0, 0, waterfallH);
    bgGrad.addColorStop(0,   '#08080e');
    bgGrad.addColorStop(0.6, '#0a0a14');
    bgGrad.addColorStop(1,   '#0d0d1a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvasW, waterfallH);

    // ── Subtle horizontal grid lines ────────────────────────
    const pps = waterfallH / fallSec;  // pixels per second
    ctx.strokeStyle = 'rgba(28,28,55,0.6)';
    ctx.lineWidth   = 0.5;
    const beatH = pps * 0.5;   // one line every 0.5 s (rough)
    const gridOffset = (currentTime * pps) % beatH;
    for (let y = waterfallH - gridOffset; y > 0; y -= beatH) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasW, y);
      ctx.stroke();
    }

    // ── Note bars ────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvasW, waterfallH);
    ctx.clip();

    for (const ev of visibleNotes) {
      const key = layout.getKey(ev.midi);
      if (!key) continue;

      const tc  = trackColorMap.get(ev.trackIndex)
                  || CONSTANTS.TRACK_COLORS[ev.trackIndex % CONSTANTS.TRACK_COLORS.length];

      const timeUntilStart = ev.startSec - currentTime;
      const timeUntilEnd   = ev.endSec   - currentTime;

      const yBottom = waterfallH - timeUntilStart * pps;
      const yTop    = waterfallH - timeUntilEnd   * pps;
      const height  = Math.max(yBottom - yTop, 2);

      if (yBottom < 0 || yTop > waterfallH) continue;

      const nx = key.x + (key.isBlack ? 0 : 1);
      const nw = key.isBlack ? key.w - 1 : key.w - 2;
      const r  = Math.min(4, nw / 2, height / 2);

      // Proximity factor 0→1 as leading edge closes in during last 0.55 s
      const prox = timeUntilStart > 0
        ? Math.max(0, Math.min(1, (0.55 - timeUntilStart) / 0.55))
        : 1;

      // ── Pass 1: Outer glow (double-layer bloom) ──────────
      ctx.save();
      ctx.fillStyle   = tc.fill;
      ctx.shadowColor = tc.glow;
      ctx.shadowBlur  = key.isBlack ? 14 : 22;
      ctx.globalAlpha = 0.50 + prox * 0.28;
      ctx.beginPath();
      ctx.roundRect(nx, yTop, nw, height, r);
      ctx.fill();
      ctx.shadowBlur  = key.isBlack ? 6 : 9;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.restore();

      // ── Pass 2: Fill gradient ─────────────────────────────
      ctx.save();
      const leadBright = (0.28 + prox * 0.52).toFixed(2);
      const noteGrad = ctx.createLinearGradient(nx, yTop, nx, yBottom);
      noteGrad.addColorStop(0,    'rgba(255,255,255,0.22)');
      noteGrad.addColorStop(0.07, tc.fill);
      noteGrad.addColorStop(0.50, tc.fill);
      noteGrad.addColorStop(0.88, tc.fill);
      noteGrad.addColorStop(0.95, `rgba(255,255,255,${leadBright})`);
      noteGrad.addColorStop(1,    tc.fill);
      ctx.fillStyle = noteGrad;
      ctx.beginPath();
      ctx.roundRect(nx, yTop, nw, height, r);
      ctx.fill();

      // Left-edge specular stripe (3-D depth)
      if (nw > 6 && height > 10) {
        const sw = Math.min(nw * 0.22, 4);
        const sg = ctx.createLinearGradient(nx, 0, nx + sw, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0.28)');
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.roundRect(nx, yTop + r, sw, Math.max(1, height - r * 2), 0);
        ctx.fill();
      }

      // Top highlight stripe
      if (height > 6) {
        ctx.fillStyle = 'rgba(255,255,255,0.30)';
        ctx.beginPath();
        ctx.roundRect(nx + 1, yTop, nw - 2, Math.min(4, height * 0.35), [r, r, 0, 0]);
        ctx.fill();
      }
      ctx.restore();

      // ── Pass 3: Leading-edge flash (proximity-gated) ──────
      if (prox > 0 && timeUntilStart > 0 && yBottom > 3) {
        const edgeH = Math.min(5, height);
        ctx.save();
        ctx.globalAlpha = prox * 0.82;
        ctx.shadowColor = tc.fill;
        ctx.shadowBlur  = 20 * prox;
        const eg = ctx.createLinearGradient(0, yBottom - edgeH, 0, yBottom + 1);
        eg.addColorStop(0, 'rgba(255,255,255,0)');
        eg.addColorStop(1, 'rgba(255,255,255,0.92)');
        ctx.fillStyle = eg;
        ctx.fillRect(nx + 1, yBottom - edgeH, nw - 2, edgeH + 1);
        ctx.restore();
      }

      // ── Trail sparkles ────────────────────────────────────
      if (timeUntilStart > 0 && timeUntilStart < 0.6 && yBottom > 8) {
        if (Math.random() < prox * 0.50)
          _emitSpark(nx + nw / 2, yBottom - 2, tc.fill, tc.glow);
        if (height > 22 && Math.random() < 0.10)
          _emitSpark(nx + Math.random() * nw, yTop + Math.random() * height, tc.fill, tc.glow);
      }

      // ── Smoke trail ───────────────────────────────────────
      if (timeUntilStart > 0 && timeUntilStart < 1.4 && yBottom > 8) {
        if (Math.random() < prox * 0.18)
          _emitSmoke(nx + nw / 2 + (Math.random() - 0.5) * nw * 0.6, yBottom, tc.fill);
      }
    }

    // Draw smoke trails (behind sparkles)
    _updateDrawSmoke(ctx);

    // Draw all trail sparkles (within clipped waterfall area)
    _updateDrawSparks(ctx);

    ctx.restore();

    // ── Impact line (glowing edge between waterfall and keyboard) ──
    const lineGrad = ctx.createLinearGradient(0, 0, canvasW, 0);
    lineGrad.addColorStop(0,    'rgba(0,212,255,0)');
    lineGrad.addColorStop(0.12, 'rgba(0,212,255,0.80)');
    lineGrad.addColorStop(0.5,  'rgba(255,255,255,1.0)');
    lineGrad.addColorStop(0.88, 'rgba(255,63,128,0.80)');
    lineGrad.addColorStop(1,    'rgba(255,63,128,0)');
    ctx.fillStyle = lineGrad;
    ctx.fillRect(0, keyboardY - 2, canvasW, 3);

    // Bright core line
    ctx.globalAlpha = 0.55;
    ctx.fillStyle   = 'rgba(255,255,255,0.9)';
    ctx.fillRect(canvasW * 0.08, keyboardY - 1, canvasW * 0.84, 1);
    ctx.globalAlpha = 1;

    // Ambient glow above keyboard (taller, softer)
    const ambGrad = ctx.createLinearGradient(0, keyboardY - 50, 0, keyboardY);
    ambGrad.addColorStop(0,   'rgba(0,212,255,0)');
    ambGrad.addColorStop(0.6, 'rgba(0,212,255,0.04)');
    ambGrad.addColorStop(1,   'rgba(255,255,255,0.09)');
    ctx.fillStyle = ambGrad;
    ctx.fillRect(0, keyboardY - 50, canvasW, 50);
  },

  // Draw keyboard background + shelf
  drawBackground(ctx, keyboardY, canvasW, canvasH) {
    ctx.fillStyle = '#0c0c14';
    ctx.fillRect(0, keyboardY, canvasW, canvasH - keyboardY);
  },
};

window.NoteScheduler    = NoteScheduler;
window.WaterfallRenderer = WaterfallRenderer;
