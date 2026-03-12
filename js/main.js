// ============================================================
//  main.js  —  app bootstrap, wires all modules, main render loop
// ============================================================

(function() {
'use strict';

// ── Elements ─────────────────────────────────────────────────
const canvas      = document.getElementById('main-canvas');
const ctx         = canvas.getContext('2d');
const fileInput   = document.getElementById('file-input');
const btnImport   = document.getElementById('btn-import');
const btnPlay     = document.getElementById('btn-play');
const btnStop     = document.getElementById('btn-stop');
const sliderSpeed = document.getElementById('slider-speed');
const speedDisp   = document.getElementById('speed-display');
const sliderVol   = document.getElementById('slider-volume');
const songTitle   = document.getElementById('song-title');
const songTime    = document.getElementById('song-time');
const progFill    = document.getElementById('progress-fill');
const progCursor  = document.getElementById('progress-cursor');
const progTrack   = document.getElementById('progress-track');
const btnBg       = document.getElementById('btn-bg');
const bgModal     = document.getElementById('bg-modal');
const btnBgClose  = document.getElementById('btn-bg-close');
const btnBgApplyUrl = document.getElementById('btn-bg-apply-url');
const btnBgApplyFile = document.getElementById('btn-bg-apply-file');
const btnBgClear  = document.getElementById('btn-bg-clear');
const bgUrlInput  = document.getElementById('bg-url');
const bgFileInput = document.getElementById('bg-file');

const BG_STORE_KEY = 'webpiano.customBackground.v1';

// ── State ────────────────────────────────────────────────────
let layout     = null;
let keyboardY  = 0;
let lastTime   = performance.now();

let trackColorMap = new Map();   // trackIndex → {fill, glow}
let midiData      = null;        // parsed midi

// ── Sub‑systems ──────────────────────────────────────────────
const audio     = new AudioEngine();
const player    = new MidiPlayer(audio);
const particles = new ParticleSystem();
const scheduler = new NoteScheduler();

// ── Sample loader UI ─────────────────────────────────────────
function getSampleBadge() {
  let el = document.getElementById('sample-badge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sample-badge';
    el.style.cssText = `
      font-size:11px; padding:3px 8px; border-radius:4px; white-space:nowrap;
      border:1px solid #252545; color:#5a5a80; background:#111120;
      transition: color .3s, border-color .3s;
    `;
    document.getElementById('song-info').prepend(el);
  }
  return el;
}

function startLoadingSamples() {
  const badge = getSampleBadge();
  badge.textContent = '音源 加载中…';

  audio.onLoadProgress = (loaded, total) => {
    const pct = Math.round(loaded / total * 100);
    badge.textContent = `音源 ${pct}%`;
  };
  audio.onLoadComplete = (src) => {
    const label = src === 'local' ? '本地音源 ✓' : 'CDN音源 ✓';
    badge.textContent  = label;
    badge.style.color  = '#39ff14';
    badge.style.borderColor = '#39ff14';
    badge.style.textShadow = '0 0 6px #39ff14';
  };
  audio.onLoadError = (msg) => {
    badge.textContent  = '⚠ 需要HTTP服务器';
    badge.style.color  = '#ff4444';
    badge.style.borderColor = '#ff4444';
    badge.style.cursor = 'help';
    badge.title = msg + '\n双击 start-server.bat，然后访问 http://localhost:8000';
  };

  audio.loadSamples();
}

// ── Canvas resize ────────────────────────────────────────────
function resize() {
  const controls  = document.getElementById('controls');
  const progEl    = document.getElementById('progress-track');
  const hint      = document.getElementById('kb-hint');
  const reserved  = controls.offsetHeight + progEl.offsetHeight + hint.offsetHeight;

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight - reserved;

  keyboardY = Math.round(canvas.height * (1 - CONSTANTS.KEYBOARD_FRAC));
  layout    = new KeyboardLayout(canvas.width, canvas.height - keyboardY);
}

window.addEventListener('resize', () => { resize(); });
resize();
restoreBackgroundState();

// ── Helpers ──────────────────────────────────────────────────
function trackColor(idx) {
  return CONSTANTS.TRACK_COLORS[idx % CONSTANTS.TRACK_COLORS.length];
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function noteColor(midi, trackIdx) {
  return trackColorMap.get(trackIdx) ?? trackColor(trackIdx);
}

function escapeCssUrl(url) {
  return String(url).replace(/"/g, '\\"');
}

function applyCustomBackground(imageSrc) {
  document.documentElement.style.setProperty('--custom-bg-image', `url("${escapeCssUrl(imageSrc)}")`);
  document.body.classList.add('has-custom-bg');
}

function clearCustomBackgroundVisual() {
  document.documentElement.style.setProperty('--custom-bg-image', 'none');
  document.body.classList.remove('has-custom-bg');
}

function readLocalImageAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取本地图片失败'));
    reader.readAsDataURL(file);
  });
}

async function tryCacheRemoteAsDataURL(url) {
  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) throw new Error('图片下载失败');
  const blob = await resp.blob();
  return await readLocalImageAsDataURL(blob);
}

function saveBackgroundState(payload) {
  localStorage.setItem(BG_STORE_KEY, JSON.stringify(payload));
}

function restoreBackgroundState() {
  const raw = localStorage.getItem(BG_STORE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (!data || !data.src) return;
    applyCustomBackground(data.src);
    if (data.kind === 'url' && data.originalUrl) bgUrlInput.value = data.originalUrl;
  } catch (e) {
    localStorage.removeItem(BG_STORE_KEY);
  }
}

function openBgModal() {
  bgModal.classList.add('open');
  bgModal.setAttribute('aria-hidden', 'false');
}

function closeBgModal() {
  bgModal.classList.remove('open');
  bgModal.setAttribute('aria-hidden', 'true');
}

async function applyBackgroundFromUrl() {
  const url = bgUrlInput.value.trim();
  if (!url) return;

  applyCustomBackground(url);

  let payload = {
    kind: 'url',
    src: url,
    originalUrl: url,
    cachedAt: Date.now(),
  };

  // If CORS allows, also cache image data so it still works when URL expires.
  try {
    const dataUrl = await tryCacheRemoteAsDataURL(url);
    payload = {
      kind: 'url',
      src: dataUrl,
      originalUrl: url,
      cachedAt: Date.now(),
    };
  } catch (e) {
    // Fall back to the direct URL if cross-origin cache is not possible.
  }

  saveBackgroundState(payload);
  closeBgModal();
}

async function applyBackgroundFromFile() {
  const file = bgFileInput.files && bgFileInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('请选择图片文件');
    return;
  }

  const dataUrl = await readLocalImageAsDataURL(file);
  applyCustomBackground(dataUrl);
  saveBackgroundState({
    kind: 'file',
    src: dataUrl,
    filename: file.name,
    cachedAt: Date.now(),
  });
  closeBgModal();
}

function clearBackgroundSetting() {
  localStorage.removeItem(BG_STORE_KEY);
  clearCustomBackgroundVisual();
  bgUrlInput.value = '';
  bgFileInput.value = '';
}

// ── MIDI file loading ────────────────────────────────────────
function loadMidi(arrayBuffer, filename) {
  try {
    midiData = MidiParser.parse(arrayBuffer);
  } catch (e) {
    alert('无法解析 MIDI 文件：' + e.message);
    return;
  }

  // Assign track colours: skip track 0 if it has no notes
  trackColorMap.clear();
  let colIdx = 0;
  for (const tIdx of midiData.tracks) {
    trackColorMap.set(tIdx, CONSTANTS.TRACK_COLORS[colIdx++ % CONSTANTS.TRACK_COLORS.length]);
  }

  player.load(midiData);
  scheduler.load(midiData.noteEvents);

  const name = (filename || 'MIDI').replace(/\.(mid|midi)$/i, '');
  songTitle.textContent = name;
  songTime.textContent  = `0:00 / ${fmtTime(midiData.durationSec)}`;

  btnPlay.disabled = false;
  btnStop.disabled = false;
  setPlayIcon(false);

  // Rebuild legend
  rebuildLegend();
}

function rebuildLegend() {
  let el = document.getElementById('track-legend');
  if (!el) {
    el = document.createElement('div');
    el.id = 'track-legend';
    document.getElementById('app').appendChild(el);
  }
  el.innerHTML = '';
  for (const [tIdx, tc] of trackColorMap) {
    const name = (midiData.trackNames && midiData.trackNames[tIdx]) || `轨道 ${tIdx + 1}`;
    const div  = document.createElement('div');
    div.className = 'track-dot';
    div.innerHTML = `<div class="track-dot-swatch" style="background:${tc.fill};box-shadow:0 0 4px ${tc.fill}"></div>${name}`;
    el.appendChild(div);
  }
}

// ── Player callbacks ─────────────────────────────────────────
player.onNoteOn = (midi, velocity, trackIdx) => {
  const tc  = noteColor(midi, trackIdx);
  layout.press(midi, tc.fill);

  // Particle burst at key top
  const key = layout.getKey(midi);
  if (key) {
    const cx = key.x + key.w / 2;
    const cy = keyboardY + (key.isBlack ? 4 : 6);
    particles.burst(cx, cy, [tc.fill, '#ffffff', 'rgba(255,255,255,0.6)'], 20);
    particles.smokeBurst(cx, cy, tc.fill, 6);
  }
};

player.onNoteOff = (midi) => {
  layout.release(midi);
};

player.onEnded = () => {
  setPlayIcon(false);
};

player.onTick = (t) => {
  if (!midiData) return;
  const pct = Math.min(1, t / midiData.durationSec) * 100;
  progFill.style.width  = pct + '%';
  progCursor.style.left = pct + '%';
  songTime.textContent  = `${fmtTime(t)} / ${fmtTime(midiData.durationSec)}`;
};

// ── Keyboard (PC) input callbacks ────────────────────────────
const kbInput = new KeyboardInput(
  (midi, vel) => {
    startLoadingSamples();   // no-op if already started
    audio.noteOn(midi, vel, null);
    const tc = trackColor(0);
    layout.press(midi, tc.fill);
    const key = layout.getKey(midi);
    if (key) {
      const cx = key.x + key.w / 2;
      const cy = keyboardY + (key.isBlack ? 4 : 6);
      particles.burst(cx, cy, [tc.fill, '#ffffff'], 16);
      particles.smokeBurst(cx, cy, tc.fill, 5);
    }
  },
  (midi) => {
    audio.noteOff(midi, null);
    layout.release(midi);
  }
);

// ── UI Controls ──────────────────────────────────────────────
btnImport.addEventListener('click', () => fileInput.click());

btnBg.addEventListener('click', openBgModal);
btnBgClose.addEventListener('click', closeBgModal);
bgModal.addEventListener('click', (e) => {
  if (e.target && e.target.dataset && e.target.dataset.close === '1') closeBgModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && bgModal.classList.contains('open')) closeBgModal();
});

btnBgApplyUrl.addEventListener('click', () => {
  applyBackgroundFromUrl().catch((err) => alert(err.message || 'URL 背景设置失败'));
});

btnBgApplyFile.addEventListener('click', () => {
  applyBackgroundFromFile().catch((err) => alert(err.message || '本地背景设置失败'));
});

btnBgClear.addEventListener('click', () => {
  clearBackgroundSetting();
  closeBgModal();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => loadMidi(e.target.result, file.name);
  reader.readAsArrayBuffer(file);
  fileInput.value = '';
  startLoadingSamples();   // begin downloading samples on first import
});

// Drag‑and‑drop
const body = document.body;
body.addEventListener('dragover', e => {
  e.preventDefault();
  getDragOverlay().classList.add('active');
});
body.addEventListener('dragleave', e => {
  if (!e.relatedTarget) getDragOverlay().classList.remove('active');
});
body.addEventListener('drop', e => {
  e.preventDefault();
  getDragOverlay().classList.remove('active');
  const file = [...e.dataTransfer.files].find(f => /\.midi?$/i.test(f.name));
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => loadMidi(ev.target.result, file.name);
  reader.readAsArrayBuffer(file);
  startLoadingSamples();
});

function getDragOverlay() {
  let el = document.getElementById('drag-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'drag-overlay';
    el.innerHTML = '<div class="drag-icon">🎵</div><div>拖放 MIDI 文件到此处</div>';
    document.body.appendChild(el);
  }
  return el;
}

function setPlayIcon(isPlaying) {
  btnPlay.innerHTML = isPlaying
    ? '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="5" y="3" width="4" height="18" fill="currentColor"/><rect x="15" y="3" width="4" height="18" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>';
  if (isPlaying) btnPlay.classList.add('playing');
  else           btnPlay.classList.remove('playing');
}

btnPlay.addEventListener('click', () => {
  if (!midiData) return;
  startLoadingSamples();   // no-op if already started
  if (player.state === 'playing') {
    player.pause();
    setPlayIcon(false);
  } else {
    player.play();
    setPlayIcon(true);
  }
});

btnStop.addEventListener('click', () => {
  player.stop();
  setPlayIcon(false);
  progFill.style.width  = '0%';
  progCursor.style.left = '0%';
  songTime.textContent  = midiData ? `0:00 / ${fmtTime(midiData.durationSec)}` : '';
  layout && clearAllKeys();
  particles.clear();
});

function clearAllKeys() {
  for (let midi = CONSTANTS.MIDI_START; midi <= CONSTANTS.MIDI_END; midi++)
    layout.release(midi);
}

// Speed slider
sliderSpeed.addEventListener('input', () => {
  const v = sliderSpeed.value / 100;
  speedDisp.textContent = v.toFixed(2).replace(/\.?0+$/, '') + '×';
  player.setSpeed(v);
});

// Volume slider
sliderVol.addEventListener('input', () => {
  audio.setVolume(sliderVol.value / 100);
});

// Progress bar seek
progTrack.addEventListener('click', e => {
  if (!midiData) return;
  const pct  = e.offsetX / progTrack.offsetWidth;
  const seek = pct * midiData.durationSec;
  const wasPlaying = player.state === 'playing';
  player.stop();
  clearAllKeys();
  if (wasPlaying) {
    player.play(seek);
    setPlayIcon(true);
  } else {
    player._pausedAt = seek;
    player._state    = 'paused';
    const pctStr = (pct * 100).toFixed(1) + '%';
    progFill.style.width  = pctStr;
    progCursor.style.left = pctStr;
    songTime.textContent  = `${fmtTime(seek)} / ${fmtTime(midiData.durationSec)}`;
  }
});

// Space = play/pause
document.addEventListener('keydown', e => {
  if (e.key === ' ' && e.target === document.body) {
    e.preventDefault();
    btnPlay.click();
  }
});

// ── Main render loop ─────────────────────────────────────────
function loop(now) {
  requestAnimationFrame(loop);

  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // Tick player (fires visual callbacks)
  player.update();

  // Tick glow decay
  layout.tickGlow(dt);

  const t = player.songTime;

  // ── Draw ─────────────────────────────────────────────────

  // 1. Keyboard background
  WaterfallRenderer.drawBackground(ctx, keyboardY, canvas.width, canvas.height);

  // 2. Waterfall
  const visible = midiData ? scheduler.getVisible(t, CONSTANTS.FALL_SECONDS) : [];
  WaterfallRenderer.draw(
    ctx, visible, layout, keyboardY,
    canvas.width, canvas.height,
    t, trackColorMap,
    CONSTANTS.FALL_SECONDS
  );

  // 3. Particles (above keyboard plane)
  particles.update();
  particles.draw(ctx);

  // 4. Piano keyboard (drawn last, on top)
  KeyboardRenderer.draw(ctx, layout, keyboardY, canvas.width);
}

requestAnimationFrame(loop);

})();
