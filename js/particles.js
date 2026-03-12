// ============================================================
//  particles.js  —  key-press burst particle system
// ============================================================

class Particle {
  constructor(x, y, color, fast) {
    this.x     = x;
    this.y     = y;
    const spd  = fast ? (3 + Math.random() * 6) : (2 + Math.random() * 4);
    const ang  = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.85;
    this.vx    = Math.cos(ang) * spd;
    this.vy    = Math.sin(ang) * spd;
    this.life  = 1.0;
    this.decay = 0.025 + Math.random() * 0.025;
    this.r     = 1.5 + Math.random() * 2.5;
    this.color = color;
    this.gravity = 0.12;
  }

  update() {
    this.x    += this.vx;
    this.y    += this.vy;
    this.vy   += this.gravity;
    this.vx   *= 0.98;
    this.life -= this.decay;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.shadowColor = this.color;
    ctx.shadowBlur  = 6;
    ctx.fillStyle   = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * this.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── Smoke Particle ───────────────────────────────────────────

class SmokeParticle {
  constructor(x, y, color) {
    this.x     = x + (Math.random() - 0.5) * 18;
    this.y     = y;
    this.vx    = (Math.random() - 0.5) * 0.55;
    this.vy    = -(0.45 + Math.random() * 0.85);
    this.r     = 5 + Math.random() * 7;
    this.life  = 1.0;
    this.decay = 0.007 + Math.random() * 0.007;
    this.color = color;
  }

  update() {
    this.x    += this.vx + (Math.random() - 0.5) * 0.28;
    this.y    += this.vy;
    this.vy   *= 0.992;   // gentle deceleration
    this.r    += 0.20;    // expand as it drifts up
    this.life -= this.decay;
  }

  draw(ctx) {
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life * this.life * 0.11);
    ctx.shadowColor = this.color;
    ctx.shadowBlur  = this.r * 2.6;
    ctx.fillStyle   = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── ParticleSystem ───────────────────────────────────────────

class ParticleSystem {
  constructor() {
    this._particles = [];
    this._smoke     = [];
  }

  // Emit a burst from the top‑edge of a piano key
  burst(x, y, colors, count = 22) {
    for (let i = 0; i < count; i++) {
      const c = colors[Math.floor(Math.random() * colors.length)];
      this._particles.push(new Particle(x, y, c, i < 6));
    }
  }

  // Emit a slow smoke cloud from a key press
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
    // Smoke drawn first (behind sparks)
    for (const s of this._smoke) s.draw(ctx);
    for (const p of this._particles) p.draw(ctx);
  }

  clear() { this._particles = []; this._smoke = []; }
}

window.ParticleSystem = ParticleSystem;
