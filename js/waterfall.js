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
const _ripples = [];
const _MAX_RIPPLES = 220;

// Frame-rate independent FX clock for consistent emission and motion
let _fxLastMs = 0;
let _fxDt = 1 / 60;

function _beginFxFrame() {
  const now = performance.now();
  if (_fxLastMs === 0) {
    _fxLastMs = now;
    _fxDt = 1 / 60;
    return;
  }
  _fxDt = (now - _fxLastMs) / 1000;
  _fxLastMs = now;
  _fxDt = Math.max(1 / 240, Math.min(0.05, _fxDt));
}

function _emitSpark(x, y, fill, glow) {
  if (_sparks.length >= _MAX_SPARKS) return;
  _sparks.push({
    x: x + (Math.random() - 0.5) * 4,
    y,
    vx: (Math.random() - 0.5) * 0.78,
    vy: -(0.45 + Math.random() * 1.05),
    life:  1.0,
    decay: 0.024 + Math.random() * 0.035,
    r:     0.45 + Math.random() * 0.9,
    fill,
    glow,
  });
}

function _updateDrawSparks(ctx) {
  for (let i = _sparks.length - 1; i >= 0; i--) {
    const s = _sparks[i];
    const f = _fxDt * 60;
    s.x    += s.vx * f;
    s.y    += s.vy * f;
    s.vy   += 0.022 * f;   // faint gravity so they arc gently
    s.life -= s.decay * f;
    if (s.life <= 0) { _sparks.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = Math.max(0, s.life * 0.80);
    ctx.shadowColor = s.glow;
    ctx.shadowBlur  = 5;
    ctx.fillStyle   = s.life > 0.55 ? '#ffffff' : s.fill;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * Math.max(0.1, s.life), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── Smoke Trail System (waterfall-private) ───────────────────

const _smoke    = [];
const _MAX_SMOKE = 200;

function _emitSmoke(x, y, fill, strength = 1) {
  if (_smoke.length >= _MAX_SMOKE) return;
  const k = Math.max(0.6, Math.min(2.2, strength));
  _smoke.push({
    x:     x + (Math.random() - 0.5) * (14 + 10 * k),
    y,
    vx:    (Math.random() - 0.5) * (0.35 + 0.20 * k),
    vy:    -(0.65 + Math.random() * (0.75 + 0.40 * k)),
    r:     5 + Math.random() * (7 + 4 * k),
    life:  1.0,
    decay: 0.0048 + Math.random() * (0.0045 + 0.0014 * k),
    fill,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleAmp: 0.06 + Math.random() * 0.12,
    wobbleFreq: 0.8 + Math.random() * 1.2,
  });
}

function _updateDrawSmoke(ctx) {
  for (let i = _smoke.length - 1; i >= 0; i--) {
    const s = _smoke[i];
    const f = _fxDt * 60;
    s.wobblePhase += s.wobbleFreq * _fxDt;
    s.x    += (s.vx + Math.sin(s.wobblePhase) * s.wobbleAmp) * f;
    s.y    += s.vy * f;
    s.vy   *= Math.pow(0.992, f);
    s.r    += 0.18 * f;
    s.life -= s.decay * f;
    if (s.life <= 0) { _smoke.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.pow(s.life, 1.25) * 0.34);
    ctx.shadowColor = s.fill;
    ctx.shadowBlur  = s.r * 2.9;
    ctx.fillStyle   = s.fill;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();

    // Bright inner core to mimic denser smoke center
    ctx.globalAlpha = Math.max(0, Math.pow(s.life, 1.9) * 0.08);
    ctx.shadowBlur  = s.r * 0.7;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function _emitRipple(x, y, fill, strength = 1) {
  if (_ripples.length >= _MAX_RIPPLES) return;
  const k = Math.max(0.6, Math.min(2.0, strength));
  _ripples.push({
    x,
    y,
    r: 2 + Math.random() * 2,
    maxR: 14 + Math.random() * 14 * k,
    life: 1,
    decay: 0.024 + Math.random() * 0.018,
    lineW: 0.8 + Math.random() * 0.8,
    fill,
  });
}

function _updateDrawRipples(ctx) {
  for (let i = _ripples.length - 1; i >= 0; i--) {
    const rp = _ripples[i];
    const f = _fxDt * 60;
    rp.r += 1.15 * f;
    rp.life -= rp.decay * f;
    if (rp.life <= 0 || rp.r >= rp.maxR) { _ripples.splice(i, 1); continue; }

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.pow(rp.life, 1.35) * 0.55);
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = rp.fill;
    ctx.shadowBlur = 10;
    ctx.lineWidth = rp.lineW;
    ctx.beginPath();
    ctx.ellipse(rp.x, rp.y, rp.r * 1.45, rp.r * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = Math.max(0, Math.pow(rp.life, 1.1) * 0.20);
    ctx.strokeStyle = rp.fill;
    ctx.shadowBlur = 4;
    ctx.lineWidth = Math.max(0.6, rp.lineW * 0.7);
    ctx.beginPath();
    ctx.ellipse(rp.x, rp.y, rp.r * 1.85, rp.r * 0.7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ── Rising Wisp System (waterfall-private) ───────────────────

const _wisps    = [];
const _MAX_WISPS = 220;

function _emitWisp(x, y, fill) {
  if (_wisps.length >= _MAX_WISPS) return;
  _wisps.push({
    x:         x + (Math.random() - 0.5) * 16,
    y,
    vx:        (Math.random() - 0.5) * 0.40,
    vy:        -(0.20 + Math.random() * 0.48),
    r:         9 + Math.random() * 12,
    life:      1.0,
    decay:     0.0036 + Math.random() * 0.0034,
    fill,
    age:       0,
    swayAmp:   0.26 + Math.random() * 0.38,
    swayFreq:  0.028 + Math.random() * 0.024,
    swayPhase: Math.random() * Math.PI * 2,
  });
}

function _updateDrawWisps(ctx) {
  for (let i = _wisps.length - 1; i >= 0; i--) {
    const w = _wisps[i];
    const f = _fxDt * 60;
    w.age++;
    w.x    += (w.vx + Math.sin(w.age * w.swayFreq + w.swayPhase) * w.swayAmp) * f;
    w.y    += w.vy * f;
    w.vy   *= Math.pow(0.998, f);
    w.r    += 0.24 * f;
    w.life -= w.decay * f;
    if (w.life <= 0) { _wisps.splice(i, 1); continue; }
    ctx.save();
    // Outer glow
    ctx.globalAlpha = Math.max(0, Math.pow(w.life, 1.4) * 0.20);
    ctx.shadowColor = w.fill;
    ctx.shadowBlur  = w.r * 2.8;
    ctx.fillStyle   = w.fill;
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
    ctx.fill();
    // Bright white inner core
    ctx.globalAlpha = Math.max(0, Math.pow(w.life, 2.4) * 0.14);
    ctx.shadowBlur  = w.r * 0.6;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r * 0.30, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Per-note FX state for precise trigger timing
const _noteFxState = new WeakMap();

function _getNoteFxState(ev) {
  let st = _noteFxState.get(ev);
  if (!st) {
    st = { smokeCarry: 0, sparkCarry: 0, didImpact: false };
    _noteFxState.set(ev, st);
  }
  return st;
}

// ── WaterfallRenderer ────────────────────────────────────────

const WaterfallRenderer = {
  // Draw the falling notes area
  // keyboardY    — y pixel where keyboard starts (top edge)
  // currentTime  — current song time (seconds)
  // trackColorMap— Map<trackIndex, {fill, glow}>
  draw(ctx, visibleNotes, layout, keyboardY, canvasW, canvasH, currentTime, trackColorMap, fallSec) {
    _beginFxFrame();

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
      if (timeUntilStart <= 0 && timeUntilEnd > 0 && yBottom > 8) {
        const st = _getNoteFxState(ev);
        const holdLife = Math.max(0, Math.min(1, Math.min(ev.endSec - currentTime, 0.55) / 0.55));
        const sparkRate = (1.3 + holdLife * 1.9) * (key.isBlack ? 0.82 : 1.0);
        st.sparkCarry += sparkRate * _fxDt;
        while (st.sparkCarry >= 1) {
          st.sparkCarry -= 1;
          _emitSpark(nx + nw / 2 + (Math.random() - 0.5) * nw * 0.34, waterfallH - 1, tc.fill, tc.glow);
        }
      }

      // ── Smoke trail ───────────────────────────────────────
      if (timeUntilStart <= 0 && timeUntilEnd > 0 && yBottom > 8) {
        const st = _getNoteFxState(ev);
        const holdLife = Math.max(0, Math.min(1, Math.min(ev.endSec - currentTime, 0.8) / 0.8));
        const smokeRate = (1.0 + holdLife * 2.2) * (key.isBlack ? 0.76 : 1.0);
        st.smokeCarry += smokeRate * _fxDt;
        while (st.smokeCarry >= 1) {
          st.smokeCarry -= 1;
          _emitSmoke(
            nx + nw / 2 + (Math.random() - 0.5) * nw * 0.38,
            waterfallH - 1,
            tc.fill,
            0.78 + holdLife * 0.42
          );
        }
      }

      // ── Rising wisps ──────────────────────────────────────
      if (timeUntilStart <= 0 && timeUntilEnd > 0 && yBottom > 8) {
        if (Math.random() < 0.07)
          _emitWisp(nx + nw / 2 + (Math.random() - 0.5) * nw * 0.55, waterfallH - 1, tc.fill);
      }

      // ── Precise impact pulse when the bar touches keyboard line ─
      if (yBottom >= waterfallH - 1) {
        const st = _getNoteFxState(ev);
        if (!st.didImpact) {
          st.didImpact = true;
          const cx = nx + nw / 2;
          const pulseSmoke = key.isBlack ? 4 : 6;
          const pulseSpark = key.isBlack ? 3 : 5;
          for (let i = 0; i < pulseSmoke; i++)
            _emitSmoke(cx + (Math.random() - 0.5) * nw * 0.42, waterfallH - 1, tc.fill, 1.55);
          for (let i = 0; i < pulseSpark; i++)
            _emitSpark(cx + (Math.random() - 0.5) * nw * 0.36, waterfallH - 2, tc.fill, tc.glow);
          _emitWisp(cx, waterfallH - 2, tc.fill);
          _emitRipple(cx, waterfallH + 1, tc.fill, key.isBlack ? 0.9 : 1.25);
        }
      }

      // ── Piano bar highlight while key is sounding ────────
      if (timeUntilStart <= 0 && timeUntilEnd > 0) {
        const holdT = Math.max(0, Math.min(1, (ev.endSec - currentTime) / 0.22));
        const glowH = key.isBlack ? 5 : 7;
        ctx.save();
        const hg = ctx.createLinearGradient(0, waterfallH - glowH - 1, 0, waterfallH + 1);
        hg.addColorStop(0, 'rgba(255,255,255,0)');
        hg.addColorStop(0.62, `rgba(255,255,255,${(0.34 + holdT * 0.16).toFixed(2)})`);
        hg.addColorStop(1, `rgba(255,255,255,${(0.60 + holdT * 0.24).toFixed(2)})`);
        ctx.globalAlpha = key.isBlack ? 0.62 : 0.78;
        ctx.shadowColor = tc.fill;
        ctx.shadowBlur = key.isBlack ? 10 : 14;
        ctx.fillStyle = hg;
        ctx.fillRect(nx + 1, waterfallH - glowH, Math.max(1, nw - 2), glowH + 1);
        ctx.restore();
      }
    }

    // Draw keyboard ripples close to key line
    _updateDrawRipples(ctx);

    // Draw wisps (furthest back, longest lasting)
    _updateDrawWisps(ctx);

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
