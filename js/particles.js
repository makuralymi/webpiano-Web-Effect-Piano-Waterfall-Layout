// ============================================================
//  particles.js  —  key-press burst particle system
// ============================================================

const _TRAIL_LEN = 7;

class Particle {
  constructor(x, y, color, fast) {
    this.xBase  = x + (Math.random() - 0.5) * 10;
    this.x      = this.xBase;
    this.y      = y;
    this.vy     = -(fast ? (1.8 + Math.random() * 2.2) : (0.8 + Math.random() * 1.4));
    this.vxBase = (Math.random() - 0.5) * 0.3;
    this.life   = 1.0;
    this.decay  = 0.004 + Math.random() * 0.008;
    this.r      = 2 + Math.random() * 3.0;
    this.color  = color;
    this.amp    = 3 + Math.random() * 8;
    this.freq   = 0.04 + Math.random() * 0.04;
    this.phase  = Math.random() * Math.PI * 2;
    this.age    = 0;
    // Ring buffer — avoids shift() O(n) copies
    this._tx    = new Float32Array(_TRAIL_LEN);
    this._ty    = new Float32Array(_TRAIL_LEN);
    this._th    = 0;   // write head
    this._tc    = 0;   // filled count
  }

  update() {
    // Record current position into ring buffer before moving
    this._tx[this._th] = this.x;
    this._ty[this._th] = this.y;
    this._th = (this._th + 1) % _TRAIL_LEN;
    if (this._tc < _TRAIL_LEN) this._tc++;
    if (this.y < 10) this.life = 0;  // early kill for stragglers that float off-screen

    this.age   += 1;
    this.xBase += this.vxBase;
    this.x      = this.xBase + Math.sin(this.age * this.freq + this.phase) * this.amp;
    this.y     += this.vy;
    this.vy    *= 0.997;
    this.life  -= this.decay;
  }

  // Draw tail as a single path — no shadowBlur (called in a batched pass)
  drawTail(ctx) {
    if (this._tc < 2) return;
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = this.r * 0.5;
    ctx.globalAlpha = this.life * 0.45;
    // Walk ring buffer oldest → newest
    const start = (this._th - this._tc + _TRAIL_LEN) % _TRAIL_LEN;
    ctx.beginPath();
    ctx.moveTo(this._tx[start], this._ty[start]);
    for (let i = 1; i < this._tc; i++) {
      const idx = (start + i) % _TRAIL_LEN;
      ctx.lineTo(this._tx[idx], this._ty[idx]);
    }
    ctx.lineTo(this.x, this.y);
    ctx.stroke();
  }

  // Draw glowing head dot (called in a separate batched pass with shadowBlur set)
  drawHead(ctx) {
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle   = this.life > 0.6 ? '#ffffff' : this.color;
    ctx.shadowColor = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * this.life, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Smoke Particle ───────────────────────────────────────────

class SmokeParticle {
  constructor(x, y, color) {
    this.x     = x + (Math.random() - 0.5) * 22;
    this.y     = y;
    this.vx    = (Math.random() - 0.5) * 0.7;
    this.vy    = -(0.5 + Math.random() * 1.1);
    this.r     = 7 + Math.random() * 10;
    this.life  = 1.0;
    this.decay = 0.006 + Math.random() * 0.006;
    this.color = color;
  }

  update() {
    this.x    += this.vx + (Math.random() - 0.5) * 0.28;
    this.y    += this.vy;
    this.vy   *= 0.992;
    this.r    += 0.28;
    this.life -= this.decay;
  }

  // No save/restore — called inside a batched smoke pass
  draw(ctx) {
    if (this.life <= 0) return;
    ctx.globalAlpha = this.life * this.life * 0.14;
    ctx.shadowColor = this.color;
    ctx.fillStyle   = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── ParticleSystem ───────────────────────────────────────────

class ParticleSystem {
  constructor() {
    this._particles = [];
    this._smoke     = [];
  }

  burst(x, y, colors, count = 28) {
    for (let i = 0; i < count; i++) {
      const c = colors[Math.floor(Math.random() * colors.length)];
      this._particles.push(new Particle(x, y, c, i < 8));
    }
  }

  smokeBurst(x, y, color, count = 7) {
    for (let i = 0; i < count; i++)
      this._smoke.push(new SmokeParticle(x, y, color));
  }

  update() {
    for (let i = this._particles.length - 1; i >= 0; i--) {
      this._particles[i].update();
      if (this._particles[i].life <= 0) this._particles.splice(i, 1);
    }
    for (let i = this._smoke.length - 1; i >= 0; i--) {
      this._smoke[i].update();
      if (this._smoke[i].life <= 0) this._smoke.splice(i, 1);
    }
  }

  draw(ctx) {
    if (this._smoke.length === 0 && this._particles.length === 0) return;

    // ── Pass 1: Smoke (fixed shadowBlur, no per-particle save/restore) ──
    if (this._smoke.length > 0) {
      ctx.save();
      ctx.shadowBlur = 28;
      for (const s of this._smoke) s.draw(ctx);
      ctx.restore();
    }

    if (this._particles.length === 0) return;

    // ── Pass 2: Tails — no shadowBlur (most expensive to skip) ──
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';
    for (const p of this._particles) p.drawTail(ctx);
    ctx.restore();

    // ── Pass 3: Glowing heads ────────────────────────────────
    ctx.save();
    ctx.shadowBlur = 14;
    for (const p of this._particles) p.drawHead(ctx);
    ctx.restore();
  }

  clear() { this._particles = []; this._smoke = []; }
}

window.ParticleSystem = ParticleSystem;
