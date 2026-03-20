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

// ── Complex Flame Particle System ────────────────────────────

const _flames = [];
const _MAX_FLAMES = 1200; // Large pool for dense flame look

// Frame-rate independent FX clock
let _fxLastMs = 0;
let _fxDt = 1 / 60;
function _beginFxFrame() {
  const now = performance.now();
  if (_fxLastMs === 0) { _fxLastMs = now; _fxDt = 1/60; return; }
  _fxDt = Math.max(1/240, Math.min(0.05, (now - _fxLastMs) / 1000));
  _fxLastMs = now;
}

// Emits a group of interconnected stringy flame particles
function _emitFlame(x, y, fill, strength = 1, isImpact = false) {
  if (_flames.length >= _MAX_FLAMES) return;
  const k = Math.max(0.6, Math.min(2.5, strength));
  const count = isImpact ? 16 : 3;
  
  // They start with somewhat constrained offset to form "threads"
  const threadBaseX = x + (Math.random() - 0.5) * (6 + 8 * k);
  const threadPhase = Math.random() * Math.PI * 2;
  
  for(let i = 0; i < count; i++) {
    if (_flames.length >= _MAX_FLAMES) break;
    const isCore = Math.random() > 0.5; // High brightness core particles
    _flames.push({
      xBase: threadBaseX + (Math.random() - 0.5) * (isImpact ? 12 : 3),
      x: threadBaseX,
      y: y + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.15,
      vy: -(2.5 + Math.random() * (2.5 + 2.5 * k)),
      life: 1.0,
      decay: 0.012 + Math.random() * (0.010 + 0.008 * k) * (isImpact ? 1.4 : 1.0),
      size: 0.8 + Math.random() * 1.5,
      fill: fill,
      isCore: isCore,
      amp: 2.0 + Math.random() * (8 * k),
      freq: 0.03 + Math.random() * 0.05,
      phase: threadPhase + (Math.random() - 0.5) * 0.8,
      age: 0
    });
  }
}

function _updateDrawFlames(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = _flames.length - 1; i >= 0; i--) {
    const p = _flames[i];
    const f = _fxDt * 60;
    p.age += f;
    
    // Smooth snaking motion
    const wave = Math.sin(p.age * p.freq + p.phase) * p.amp;
    p.xBase += p.vx * f;
    p.x = p.xBase + wave;
    p.y += p.vy * f;
    p.vy *= Math.pow(0.985, f); // slightly slow down rise
    
    p.life -= p.decay * f;
    if (p.life <= 0) { _flames.splice(i, 1); continue; }
    
    const alpha = Math.max(0, p.life * (p.life > 0.5 ? 1 : p.life * 1.5));
    
    ctx.globalAlpha = alpha * (p.isCore ? 0.9 : 0.6);
    ctx.shadowColor = p.fill;
    ctx.shadowBlur = p.isCore ? 8 : 4;
    ctx.fillStyle = p.isCore ? (p.life > 0.6 ? '#ffffff' : '#e6f0ff') : p.fill;
    
    // Draw dot for the head
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.4 + p.life * 0.6), 0, Math.PI * 2);
    ctx.fill();
    
    // Draw stringy tail connecting its path to look like continuous flame/wisps
    ctx.globalAlpha = alpha * 0.5;
    ctx.shadowBlur = 0;
    const tailLen = p.size * 6 * p.life;
    ctx.fillRect(p.x - p.size*0.3, p.y, p.size*0.6, tailLen);
  }
  ctx.restore();
}

// ── Top Keyboard Burst & Glow System ─────────────────────────
const _ripples = [];
const _MAX_RIPPLES = 120;

function _emitRipple(x, y, fill, width, isImpact=false) {
  if (_ripples.length >= _MAX_RIPPLES) return;
  _ripples.push({
    x, y, width,
    life: 1.0,
    decay: isImpact ? 0.04 : 0.08, // slower decay for impact flash
    fill,
    isImpact
  });
}

function _updateDrawRipples(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = _ripples.length - 1; i >= 0; i--) {
    const r = _ripples[i];
    const f = _fxDt * 60;
    r.life -= r.decay * f;
    if (r.life <= 0) { _ripples.splice(i, 1); continue; }
    
    // Ripple spreads outwards slightly
    const stretch = r.isImpact ? (1.0 + (1.0 - r.life) * 1.8) : 1.0;
    const alpha = Math.max(0, r.life);
    const w = r.width * stretch;
    
    ctx.globalAlpha = alpha * 0.8;
    ctx.shadowColor = r.fill;
    ctx.shadowBlur = r.isImpact ? 25 : 12;
    ctx.fillStyle = r.life > 0.6 ? '#ffffff' : r.fill;
    
    // Draw an intense horizontal oval (glow line)
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, w / 2, r.isImpact ? 3 : 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha * 0.4;
    ctx.ellipse(r.x, r.y, w, r.isImpact ? 6 : 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Ambient background wisps ────────────────────────────────
const _ambientParticles = [];
let _ambientCarry = 0;
function _emitAmbient(canvasW, y) {
  _ambientCarry += 15 * _fxDt;
  while(_ambientCarry >= 1) {
    _ambientCarry--;
    if (_ambientParticles.length > 250) break;
    _ambientParticles.push({
      x: Math.random() * canvasW,
      y: y,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -(0.5 + Math.random() * 2.0),
      life: 1,
      decay: 0.005 + Math.random() * 0.015,
      size: 0.5 + Math.random() * 1.2
    });
  }
}

function _updateDrawAmbient(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = _ambientParticles.length - 1; i >= 0; i--) {
    const p = _ambientParticles[i];
    const f = _fxDt * 60;
    p.x += p.vx * f;
    p.y += p.vy * f;
    p.life -= p.decay * f;
    if (p.life <= 0) { _ambientParticles.splice(i, 1); continue; }
    ctx.globalAlpha = p.life * 0.35;
    ctx.fillStyle = '#b3d4ff';
    ctx.fillRect(p.x, p.y, p.size, p.size * (2 + p.life * 2));
  }
  ctx.restore();
}

// Per-note FX state array wrapper
const _noteFxState = new WeakMap();

function _getNoteFxState(ev) {
  let st = _noteFxState.get(ev);
  if (!st) {
    st = { flameCarry: 0, rippleCarry: 0, didImpact: false };
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
    // Background image is drawn in drawBackground(); only clear when no image.
    const _hasBgImg = window.BG_IMAGE && window.BG_IMAGE.complete && window.BG_IMAGE.naturalWidth > 0;
    if (!_hasBgImg) {
      ctx.clearRect(0, 0, canvasW, waterfallH);
    }

    // Draw a subtle semi-transparent dark gradient overlaid on the background
    // to ensure the bright piano notes and particles still pop visually
    const bgGrad = ctx.createLinearGradient(0, 0, 0, waterfallH);
    if (_hasBgImg) {
      bgGrad.addColorStop(0,   'rgba(8, 8, 14, 0.28)');
      bgGrad.addColorStop(0.6, 'rgba(10, 10, 20, 0.38)');
      bgGrad.addColorStop(1,   'rgba(13, 13, 26, 0.55)');
    } else {
      bgGrad.addColorStop(0,   'rgba(8, 8, 14, 0.5)');
      bgGrad.addColorStop(0.6, 'rgba(10, 10, 20, 0.6)');
      bgGrad.addColorStop(1,   'rgba(13, 13, 26, 0.8)');
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvasW, waterfallH);

    // ── Note bars ────────────────────────────────────────────
    const pps = waterfallH / fallSec;  // pixels per second
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvasW, waterfallH);
    ctx.clip();

    for (const ev of visibleNotes) {
      const key = layout.getKey(ev.midi);
      if (!key) continue;

      const tc  = trackColorMap.get(ev.trackIndex)
                  || CONSTANTS.TRACK_COLORS[ev.trackIndex % CONSTANTS.TRACK_COLORS.length];

      // Handle gradient fill - calculate color based on MIDI note (21-108)
      const isGradient = tc.fill && tc.fill.startsWith('gradient:rainbow');
      let fillColor, glowColor;
      
      if (isGradient) {
        // Map MIDI note (21-108) to rainbow colors
        const noteRatio = (ev.midi - 21) / (108 - 21);
        const hue = noteRatio * 300; // 0° red to 300° violet (avoiding wrapping to red)
        fillColor = `hsl(${hue}, 100%, 60%)`;
        glowColor = `hsla(${hue}, 100%, 60%, 0.85)`;
      } else {
        fillColor = tc.fill;
        glowColor = tc.glow;
      }

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
      ctx.fillStyle   = fillColor;
      ctx.shadowColor = glowColor;
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
      noteGrad.addColorStop(0.07, fillColor);
      noteGrad.addColorStop(0.50, fillColor);
      noteGrad.addColorStop(0.88, fillColor);
      noteGrad.addColorStop(0.95, `rgba(255,255,255,${leadBright})`);
      noteGrad.addColorStop(1,    fillColor);
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
        ctx.shadowColor = fillColor;
        ctx.shadowBlur  = 20 * prox;
        const eg = ctx.createLinearGradient(0, yBottom - edgeH, 0, yBottom + 1);
        eg.addColorStop(0, 'rgba(255,255,255,0)');
        eg.addColorStop(1, 'rgba(255,255,255,0.92)');
        ctx.fillStyle = eg;
        ctx.fillRect(nx + 1, yBottom - edgeH, nw - 2, edgeH + 1);
        ctx.restore();
      }

      // ── Flame trail (complex twisted particles) ───────────
      if (timeUntilStart <= 0 && timeUntilEnd > 0 && yBottom > 8) {
        const st = _getNoteFxState(ev);
        const holdLife = Math.max(0, Math.min(1, Math.min(ev.endSec - currentTime, 0.8) / 0.8));
        const flameRate = (1.5 + holdLife * 3.5) * (key.isBlack ? 0.8 : 1.0);
        st.flameCarry += flameRate * _fxDt;
        const cx = nx + nw / 2;
        while (st.flameCarry >= 1) {
          st.flameCarry -= 1;
          _emitFlame(cx, waterfallH - 1, fillColor, 0.8 + holdLife * 0.6, false);
        }
        
        // Continuous emitting highlight ripples while playing
        st.rippleCarry += 8 * _fxDt;
        while (st.rippleCarry >= 1) {
          st.rippleCarry -= 1;
          _emitRipple(cx, waterfallH - 1, fillColor, nw * (2.0 + Math.random()), false);
        }
      }

      // ── Precise impact pulse when the bar touches keyboard line ─
      if (yBottom >= waterfallH - 1) {
        const st = _getNoteFxState(ev);
        if (!st.didImpact) {
          st.didImpact = true;
          const cx = nx + nw / 2;
          
          // Burst of flames
          _emitFlame(cx, waterfallH - 1, fillColor, key.isBlack ? 1.6 : 2.2, true);
          
          // Large intense ripple impact flash at the keyboard line
          _emitRipple(cx, waterfallH - 1, '#ffffff', nw * 6, true);
          _emitRipple(cx, waterfallH - 1, fillColor, nw * 10, true);
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
        ctx.shadowColor = fillColor;
        ctx.shadowBlur = key.isBlack ? 10 : 14;
        ctx.fillStyle = hg;
        ctx.fillRect(nx + 1, waterfallH - glowH, Math.max(1, nw - 2), glowH + 1);
        ctx.restore();
      }
    }

    // Draw ambient floating wisps in background
    _emitAmbient(canvasW, waterfallH - 1);
    _updateDrawAmbient(ctx);

    // Draw the main complex flame particles
    _updateDrawFlames(ctx);

    // Draw the high intensity top keyboard piano line ripples
    _updateDrawRipples(ctx);

    ctx.restore();

    // ── Impact line (glowing edge between waterfall and keyboard) ──
    const lineGrad = ctx.createLinearGradient(0, 0, canvasW, 0);
    lineGrad.addColorStop(0,    'rgba(0,212,255,0)');
    lineGrad.addColorStop(0.12, 'rgba(0,212,255,0.95)');
    lineGrad.addColorStop(0.5,  'rgba(255,255,255,1.0)');
    lineGrad.addColorStop(0.88, 'rgba(255,63,128,0.95)');
    lineGrad.addColorStop(1,    'rgba(255,63,128,0)');
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur  = 12;
    ctx.fillStyle = lineGrad;
    ctx.fillRect(0, keyboardY - 2, canvasW, 5);
    ctx.restore();

    // Bright core line
    ctx.globalAlpha = 0.88;
    ctx.fillStyle   = 'rgba(255,255,255,1.0)';
    ctx.fillRect(canvasW * 0.06, keyboardY - 1, canvasW * 0.88, 1);
    ctx.globalAlpha = 1;

    // Ambient glow above keyboard (taller, softer)
    const ambGrad = ctx.createLinearGradient(0, keyboardY - 80, 0, keyboardY);
    ambGrad.addColorStop(0,   'rgba(0,212,255,0)');
    ambGrad.addColorStop(0.5, 'rgba(0,212,255,0.06)');
    ambGrad.addColorStop(0.8, 'rgba(120,80,255,0.08)');
    ambGrad.addColorStop(1,   'rgba(255,255,255,0.18)');
    ctx.fillStyle = ambGrad;
    ctx.fillRect(0, keyboardY - 80, canvasW, 80);

    // Extra wide soft halo right at keyboardY
    const haloGrad = ctx.createLinearGradient(0, keyboardY - 24, 0, keyboardY + 4);
    haloGrad.addColorStop(0,   'rgba(255,255,255,0)');
    haloGrad.addColorStop(0.6, 'rgba(200,160,255,0.06)');
    haloGrad.addColorStop(1,   'rgba(255,255,255,0.12)');
    ctx.fillStyle = haloGrad;
    ctx.fillRect(0, keyboardY - 24, canvasW, 28);
  },

  // Draw keyboard background + shelf
  drawBackground(ctx, keyboardY, canvasW, canvasH) {
    const bgImg = window.BG_IMAGE;
    if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
      // Scale to cover the full canvas
      const scale = Math.max(canvasW / bgImg.naturalWidth, canvasH / bgImg.naturalHeight);
      const dw = bgImg.naturalWidth * scale;
      const dh = bgImg.naturalHeight * scale;
      ctx.save();
      ctx.globalAlpha = typeof window.BG_OPACITY === 'number' ? window.BG_OPACITY : 0.9;
      ctx.drawImage(bgImg, (canvasW - dw) / 2, (canvasH - dh) / 2, dw, dh);
      ctx.restore();
      // Darker tint over the keyboard area so keys remain readable
      ctx.fillStyle = 'rgba(12, 12, 20, 0.88)';
    } else {
      ctx.fillStyle = '#0c0c14';
    }
    ctx.fillRect(0, keyboardY, canvasW, canvasH - keyboardY);
  },
};

window.NoteScheduler    = NoteScheduler;
window.WaterfallRenderer = WaterfallRenderer;
