// ============================================================
//  audio.js  —  Web Audio API engine
//  Priority: 1) local FL Studio samples  2) Salamander CDN  3) oscillator
// ============================================================

// ── Local FL Studio samples (Close Grand, 88 keys, 1 file/key) ──
// Sample N  →  MIDI note (N + 20)   [ N = 1..88, MIDI 21(A0)..108(C8) ]
const _LOCAL_BASE  = './samples_ogg/';
const _LOCAL_COUNT = 88;
function _localUrl(n)    { return `${_LOCAL_BASE}Close%20Grand%20${n}.ogg`; }
function _localMidi(n)   { return n + 20; }         // n=1 → MIDI 21 (A0)
function _localN(midi)   { return midi - 20; }       // MIDI 21 → n=1

// ── Salamander CDN fallback (sparse, 30 notes with pitch‑shifting) ──
const _SALAM_MAP = [
  { name: 'A0', midi:21},{ name:'C1', midi:24},{ name:'Ds1', midi:27},
  { name:'Fs1', midi:30},{ name:'A1', midi:33},{ name:'C2', midi:36},
  { name:'Ds2', midi:39},{ name:'Fs2', midi:42},{ name:'A2', midi:45},
  { name:'C3',  midi:48},{ name:'Ds3', midi:51},{ name:'Fs3', midi:54},
  { name:'A3',  midi:57},{ name:'C4', midi:60},{ name:'Ds4', midi:63},
  { name:'Fs4', midi:66},{ name:'A4', midi:69},{ name:'C5', midi:72},
  { name:'Ds5', midi:75},{ name:'Fs5', midi:78},{ name:'A5', midi:81},
  { name:'C6',  midi:84},{ name:'Ds6', midi:87},{ name:'Fs6', midi:90},
  { name:'A6',  midi:93},{ name:'C7', midi:96},{ name:'Ds7', midi:99},
  { name:'Fs7', midi:102},{ name:'A7', midi:105},{ name:'C8', midi:108},
];
const _SALAM_CDN  = 'https://tonejs.github.io/audio/salamander/';

// ============================================================

class AudioEngine {
  constructor() {
    this._ctx    = null;
    this._master = null;
    this._reverb = null;
    this._voices = new Map();
    this.volume  = 0.75;

    // Sampler state
    this._buffers      = new Map();   // midi → AudioBuffer
    this._samplerReady = false;
    this._loadStarted  = false;
    this._usingLocal   = false;       // true when local files loaded OK

    // Sustain pedal state
    this._sustainEvents   = [];        // [{when, on}] sorted by audio time
    this._sustainedVoices = new Map(); // midi → voice (held beyond noteOff by pedal)

    // Callbacks
    this.onLoadProgress = null;   // (loaded, total) => void
    this.onLoadComplete = null;   // (src) => void   src = 'local'|'cdn'
    this.onLoadError    = null;   // (msg) => void
  }

  // ── Context init ─────────────────────────────────────────
  _init() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._ctx.resume();
    this._master = this._ctx.createGain();
    this._master.gain.value = this.volume;
    this._master.connect(this._ctx.destination);
    this._reverb = this._buildReverb(2.2, 2.8);
    const rv = this._ctx.createGain();
    rv.gain.value = 0.18;
    this._reverb.connect(rv);
    rv.connect(this._master);
  }

  _buildReverb(dur, decay) {
    const ctx = this._ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    const c = ctx.createConvolver(); c.buffer = buf; return c;
  }

  // ── Sampler loading ──────────────────────────────────────
  async loadSamples() {
    if (this._loadStarted) return;
    this._loadStarted = true;
    this._init();

    // file:// blocks all fetch() — must use HTTP server
    if (location.protocol === 'file:') {
      console.error(
        '[WebPiano] 采样加载失败：当前使用 file:// 协议打开页面。\n' +
        '请用 HTTP 服务器打开，例如：\n' +
        '  cd "d:/project/webpiano" && python -m http.server 8000\n' +
        '然后访问 http://localhost:8000'
      );
      if (this.onLoadError) this.onLoadError('file://协议不支持加载音源，请用HTTP服务器打开');
      return;
    }

    // ── Phase 1: try local FL Studio samples ──────────────
    const localOk = await this._loadLocal();

    if (localOk >= 80) {   // accept if at least 80/88 loaded fine
      this._usingLocal = true;
      if (this.onLoadComplete) this.onLoadComplete('local');
      return;
    }

    // ── Phase 2: fall back to Salamander CDN ─────────────
    this._buffers.clear();
    this._samplerReady = false;
    await this._loadCDN();
  }

  async _loadLocal() {
    const total  = _LOCAL_COUNT;
    let   loaded = 0;

    const loadOne = async (n) => {
      try {
        const resp = await fetch(_localUrl(n));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await this._ctx.decodeAudioData(await resp.arrayBuffer());
        this._buffers.set(_localMidi(n), buf);
        this._samplerReady = true;
        loaded++;
      } catch (err) {
        if (n === 1) console.warn('[WebPiano] 本地采样加载失败:', err.message, _localUrl(n));
      }
      if (this.onLoadProgress) this.onLoadProgress(loaded, total);
    };

    await Promise.all(
      Array.from({ length: total }, (_, i) => loadOne(i + 1))
    );
    return loaded;
  }

  async _loadCDN() {
    const total  = _SALAM_MAP.length;
    let   loaded = 0;

    const loadOne = async ({ name, midi }) => {
      const url = `${_SALAM_CDN}${name}v8.mp3`;
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`${resp.status}`);
        const buf = await this._ctx.decodeAudioData(await resp.arrayBuffer());
        this._buffers.set(midi, buf);
        this._samplerReady = true;
        loaded++;
      } catch (err) {
        console.warn(`[sampler] CDN failed for ${name}:`, err.message);
      }
      if (this.onLoadProgress) this.onLoadProgress(loaded, total);
    };

    await Promise.all(_SALAM_MAP.map(loadOne));

    if (loaded === 0) {
      if (this.onLoadError) this.onLoadError('所有采样下载失败，将使用合成音效');
    } else {
      if (this.onLoadComplete) this.onLoadComplete('cdn');
    }
  }

  // ── Clock ────────────────────────────────────────────────
  get currentTime() { this._init(); return this._ctx.currentTime; }

  setVolume(v) {
    this.volume = v;
    if (this._master) this._master.gain.setTargetAtTime(v, this._ctx.currentTime, 0.01);
  }

  // ── Note on/off ──────────────────────────────────────────
  noteOn(midi, velocity, atTime) {
    this._init();
    const when = atTime ?? this._ctx.currentTime;
    this._stopVoice(midi, when);
    if (this._samplerReady) this._noteOnSampler(midi, velocity, when);
    else                    this._noteOnOsc(midi, velocity, when);
  }

  noteOff(midi, atTime) {
    if (!this._ctx) return;
    const when  = atTime ?? this._ctx.currentTime;
    const voice = this._voices.get(midi);
    if (!voice) return;
    this._voices.delete(midi);
    if (this._isSustainAt(when)) {
      this._sustainedVoices.set(midi, voice);  // hold until pedal lifts
    } else {
      this._releaseVoice(voice, when);
    }
  }

  // ── CC / Pedal ────────────────────────────────────────────
  // Called from midi-player with precise audio-clock timestamps
  cc(type, ccNum, value, audioT) {
    if (!this._ctx) this._init();
    if (type !== 'cc') return;  // ignore pitchBend etc. for now

    const when = typeof audioT === 'number' ? audioT : this._ctx.currentTime;

    if (ccNum === 64) {  // Sustain / Damper pedal
      this._sustainEvents.push({ when, on: value >= 64 });
      this._sustainEvents.sort((a, b) => a.when - b.when);
      // Prune events more than 2 s in the past
      const cutoff = this._ctx.currentTime - 2;
      while (this._sustainEvents.length && this._sustainEvents[0].when < cutoff)
        this._sustainEvents.shift();

      if (value < 64) {
        // Pedal released — let all sustained voices fade out at 'when'
        for (const voice of this._sustainedVoices.values())
          this._releaseVoice(voice, when);
        this._sustainedVoices.clear();
      }
    }
  }

  allNotesOff() {
    if (!this._ctx) return;
    const now = this._ctx.currentTime;
    for (const m of [...this._voices.keys()]) this._stopVoice(m, now);
    for (const voice of this._sustainedVoices.values()) this._releaseVoice(voice, now);
    this._sustainedVoices.clear();
    this._sustainEvents = [];
  }

  // ── Sampler implementation ───────────────────────────────
  _isSustainAt(audioTime) {
    let on = false;
    for (const ev of this._sustainEvents) {
      if (ev.when > audioTime) break;
      on = ev.on;
    }
    return on;
  }

  _releaseVoice(voice, when) {
    if (voice.isSampler) {
      const R = 0.40;
      voice.env.gain.cancelScheduledValues(when);
      voice.env.gain.setValueAtTime(voice.env.gain.value, when);
      voice.env.gain.exponentialRampToValueAtTime(0.0001, when + R);
      try { voice.src.stop(when + R + 0.05); } catch (_) {}
    } else {
      const R = 0.35;
      voice.env.gain.cancelScheduledValues(when);
      voice.env.gain.setValueAtTime(voice.env.gain.value, when);
      voice.env.gain.exponentialRampToValueAtTime(0.0001, when + R);
      voice.oscs.forEach(o => { try { o.stop(when + R + 0.02); } catch (_) {} });
    }
  }

  _findNearestBuffer(midi) {
    // Local mode: exact match always available (playbackRate = 1)
    if (this._usingLocal && this._buffers.has(midi)) return { midi, rate: 1 };

    // Sparse CDN mode: find nearest loaded sample + compute pitch ratio
    let best = null, bestDist = Infinity;
    for (const [sm] of this._buffers) {
      const d = Math.abs(sm - midi);
      if (d < bestDist) { bestDist = d; best = sm; }
    }
    if (best === null) return null;
    return { midi: best, rate: Math.pow(2, (midi - best) / 12) };
  }

  _noteOnSampler(midi, velocity, when) {
    const ctx    = this._ctx;
    const hit    = this._findNearestBuffer(midi);
    if (!hit) { this._noteOnOsc(midi, velocity, when); return; }

    const amp  = (velocity / 127) * 0.92;
    const env  = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(amp, when + 0.003);
    env.connect(this._master);
    if (this._reverb) {
      const rv = ctx.createGain(); rv.gain.value = 0.20;
      env.connect(rv); rv.connect(this._reverb);
    }

    const src = ctx.createBufferSource();
    src.buffer             = this._buffers.get(hit.midi);
    src.playbackRate.value = hit.rate;
    src.connect(env);
    src.start(when);
    src.onended = () => { if (this._voices.get(midi)?.src === src) this._voices.delete(midi); };

    this._voices.set(midi, { src, env, isSampler: true });
  }

  _noteOffSampler(midi, when) {
    const voice = this._voices.get(midi);
    if (!voice) return;
    const R = 0.40;
    voice.env.gain.cancelScheduledValues(when);
    voice.env.gain.setValueAtTime(voice.env.gain.value, when);
    voice.env.gain.exponentialRampToValueAtTime(0.0001, when + R);
    try { voice.src.stop(when + R + 0.05); } catch (_) {}
    this._voices.delete(midi);
  }

  // ── Oscillator fallback ──────────────────────────────────
  _noteOnOsc(midi, velocity, when) {
    const ctx  = this._ctx;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const amp  = (velocity / 127) * 0.55;
    const B    = 0.00002 * (midi - 21);   // inharmonicity

    const env = ctx.createGain();
    const A = 0.003, D = 0.6, S = 0.25;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(amp, when + A);
    env.gain.exponentialRampToValueAtTime(Math.max(amp * S, 0.0001), when + A + D);
    env.gain.setValueAtTime(amp * S, when + A + D);
    env.connect(this._master);
    if (this._reverb) {
      const rv = ctx.createGain(); rv.gain.value = 0.22;
      env.connect(rv); rv.connect(this._reverb);
    }

    const PARTIALS = [{n:1,a:1},{n:2,a:.55},{n:3,a:.28},{n:4,a:.14},{n:5,a:.07},{n:6,a:.03}];
    const oscs = PARTIALS.map(({ n, a }) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = n === 1 ? 'triangle' : 'sine';
      o.frequency.value = freq * n * Math.sqrt(1 + B * n * n);
      g.gain.value = a;
      o.connect(g); g.connect(env); o.start(when);
      return o;
    });
    this._voices.set(midi, { oscs, env, isSampler: false });
  }

  _noteOffOsc(midi, when) {
    const voice = this._voices.get(midi);
    if (!voice || voice.isSampler) return;
    const R = 0.35;
    voice.env.gain.cancelScheduledValues(when);
    voice.env.gain.setValueAtTime(voice.env.gain.value, when);
    voice.env.gain.exponentialRampToValueAtTime(0.0001, when + R);
    voice.oscs.forEach(o => { try { o.stop(when + R + 0.02); } catch (_) {} });
    this._voices.delete(midi);
  }

  _stopVoice(midi, when) {
    // Stop any sustained voice on the same note (prevent layering on re-press)
    const sv = this._sustainedVoices.get(midi);
    if (sv) {
      sv.env.gain.cancelScheduledValues(when);
      sv.env.gain.setValueAtTime(0, when);
      if (sv.isSampler) { try { sv.src.stop(when + 0.01); } catch (_) {} }
      else sv.oscs.forEach(o => { try { o.stop(when + 0.01); } catch (_) {} });
      this._sustainedVoices.delete(midi);
    }
    const v = this._voices.get(midi);
    if (!v) return;
    v.env.gain.cancelScheduledValues(when);
    v.env.gain.setValueAtTime(0, when);
    if (v.isSampler) { try { v.src.stop(when + 0.01); } catch (_) {} }
    else v.oscs.forEach(o => { try { o.stop(when + 0.01); } catch (_) {} });
    this._voices.delete(midi);
  }
}

window.AudioEngine = AudioEngine;
