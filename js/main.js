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
const playlistSelect = document.getElementById('playlist-select');
const btnPlaylistLoad = document.getElementById('btn-playlist-load');
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
const bgOpacitySlider  = document.getElementById('bg-opacity');
const bgOpacityDisplay = document.getElementById('bg-opacity-display');
const btnToggleGrid  = document.getElementById('btn-toggle-grid');
const btnTrackColors = document.getElementById('btn-track-colors');
const tcModal     = document.getElementById('track-colors-modal');
const tcModalBody = document.getElementById('tc-modal-body');
const btnTcClose  = document.getElementById('btn-tc-close');
const btnTcReset  = document.getElementById('btn-tc-reset');

// Sample download modal elements
const sampleModal      = document.getElementById('sample-modal');
const btnSampleDl      = document.getElementById('btn-sample-dl');
const btnSampleSkip    = document.getElementById('btn-sample-skip');
const sampleDlSection  = document.getElementById('sample-dl-section');
const sampleDlBarFill  = document.getElementById('sample-dl-bar-fill');
const sampleDlPct      = document.getElementById('sample-dl-pct');
const sampleDlStatus   = document.getElementById('sample-dl-status');
const btnDownloadSample = document.getElementById('btn-download-sample');

const BG_STORE_KEY = 'webpiano.customBackground.v1';
const BG_DB_NAME = 'webpiano.backgroundCache';
const BG_DB_STORE = 'images';
const BG_DB_KEY = 'active';
const SAMPLE_STATE_KEY = 'webpiano.sampleState'; // null | 'downloaded' | 'skipped'

function getSampleState() { return localStorage.getItem(SAMPLE_STATE_KEY); }
function setSampleState(v) { localStorage.setItem(SAMPLE_STATE_KEY, v); }

let _activeBgObjectUrl = null;
window.BG_IMAGE  = null;
window.BG_OPACITY = parseFloat(localStorage.getItem('webpiano.bgOpacity') ?? '0.9');
window.SHOW_GRID = localStorage.getItem('webpiano.showGrid') !== 'false';

// ── State ────────────────────────────────────────────────────
let layout     = null;
let keyboardY  = 0;
let lastTime   = performance.now();

let trackColorMap = new Map();   // trackIndex → {fill, glow}
let midiData      = null;        // parsed midi
let playlistItems = [];          // server playlist items
const _activeNotes = new Map();  // midi → {color, key, carry}

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

// Core loader — wires callbacks and fires audio.loadSamples()
function _doLoadSamples(onProgress, onComplete, onError) {
  const badge = getSampleBadge();
  badge.textContent = '音源 加载中…';
  badge.style.color = badge.style.borderColor = badge.style.textShadow = badge.style.cursor = '';
  badge.title = '';

  audio.onLoadProgress = (loaded, total) => {
    const pct = Math.round(loaded / total * 100);
    badge.textContent = `音源 ${pct}%`;
    if (onProgress) onProgress(pct);
  };
  audio.onLoadComplete = (src) => {
    const label = src === 'local' ? '本地音源 ✓' : 'CDN音源 ✓';
    badge.textContent  = label;
    badge.style.color  = '#39ff14';
    badge.style.borderColor = '#39ff14';
    badge.style.textShadow = '0 0 6px #39ff14';
    setSampleState('downloaded');
    if (onComplete) onComplete(src);
  };
  audio.onLoadError = (msg) => {
    badge.textContent  = '⚠ 需要HTTP服务器';
    badge.style.color  = '#ff4444';
    badge.style.borderColor = '#ff4444';
    badge.style.cursor = 'help';
    badge.title = msg + '\n双击 start-server.bat，然后访问 http://localhost:8000';
    if (onError) onError(msg);
  };

  audio.loadSamples();
}

// Auto-start on page load and user-gesture triggers (no-op when user chose synthesizer)
function startLoadingSamples() {
  const st = getSampleState();
  if (st === 'skipped' || st === null) return;
  if (audio._loadStarted) return;
  _doLoadSamples();
}

// ── Sample modal ─────────────────────────────────────────────
function openSampleModal() {
  sampleDlSection.style.display = 'none';
  sampleDlBarFill.style.width = '0%';
  sampleDlPct.textContent = '0%';
  sampleDlStatus.textContent = '下载中…';
  btnSampleDl.disabled = false;
  btnSampleSkip.disabled = false;
  sampleModal.classList.add('open');
  sampleModal.setAttribute('aria-hidden', 'false');
}

function closeSampleModal() {
  sampleModal.classList.remove('open');
  sampleModal.setAttribute('aria-hidden', 'true');
}

function showDownloadButton() { btnDownloadSample.style.display = ''; }
function hideDownloadButton() { btnDownloadSample.style.display = 'none'; }

function initSampleState() {
  const state = getSampleState();
  if (state === 'downloaded') {
    startLoadingSamples();
  } else if (state === 'skipped') {
    showDownloadButton();
  } else {
    openSampleModal();
  }
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
restoreBackgroundState().catch(() => {
  localStorage.removeItem(BG_STORE_KEY);
});
initSampleState();

// Auto-load playlist on startup
loadPlaylistFromServer();

// ── Helpers ──────────────────────────────────────────────────
function displayName(filename) {
  return (filename || '').replace(/\.(mid|midi)$/i, '') || '未命名 MIDI';
}

function fillPlaylistOptions(items) {
  playlistSelect.innerHTML = '';

  if (!items.length) {
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'playlist 为空';
    playlistSelect.appendChild(emptyOpt);
    playlistSelect.disabled = true;
    btnPlaylistLoad.disabled = true;
    return;
  }

  items.forEach((item, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = displayName(item.name);
    playlistSelect.appendChild(opt);
  });

  playlistSelect.disabled = false;
  btnPlaylistLoad.disabled = false;
}

async function loadPlaylistItemByIndex(idx, onlyIfNoMidiLoaded) {
  const item = playlistItems[idx];
  if (!item) return;
  if (onlyIfNoMidiLoaded && midiData) return;

  try {
    const resp = await fetch(item.path);
    if (!resp.ok) throw new Error('playlist file fetch failed');
    const buf = await resp.arrayBuffer();
    loadMidi(buf, item.name);
  } catch (_) {
    // Keep UI usable when a listed file becomes unavailable.
  }
}

async function loadPlaylistFromServer() {
  try {
    const resp = await fetch('./api/playlist');
    if (!resp.ok) throw new Error('playlist api failed');
    const data = await resp.json();
    playlistItems = Array.isArray(data.files) ? data.files : [];
  } catch (_) {
    playlistItems = [];
  }

  fillPlaylistOptions(playlistItems);
  if (playlistItems.length > 0) {
    await loadPlaylistItemByIndex(0, true);
  }
}

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
  if (_activeBgObjectUrl) {
    URL.revokeObjectURL(_activeBgObjectUrl);
    _activeBgObjectUrl = null;
  }
  document.documentElement.style.setProperty('--custom-bg-image', `url("${escapeCssUrl(imageSrc)}")`);
  document.body.classList.add('has-custom-bg');
  const img = new Image();
  img.src = imageSrc;
  window.BG_IMAGE = img;
}

function applyCustomBackgroundBlob(blob) {
  if (_activeBgObjectUrl) {
    URL.revokeObjectURL(_activeBgObjectUrl);
    _activeBgObjectUrl = null;
  }
  _activeBgObjectUrl = URL.createObjectURL(blob);
  document.documentElement.style.setProperty('--custom-bg-image', `url("${escapeCssUrl(_activeBgObjectUrl)}")`);
  document.body.classList.add('has-custom-bg');
  const img = new Image();
  img.src = _activeBgObjectUrl;
  window.BG_IMAGE = img;
}

function clearCustomBackgroundVisual() {
  if (_activeBgObjectUrl) {
    URL.revokeObjectURL(_activeBgObjectUrl);
    _activeBgObjectUrl = null;
  }
  document.documentElement.style.setProperty('--custom-bg-image', 'none');
  document.body.classList.remove('has-custom-bg');
  window.BG_IMAGE = null;
}

function readLocalImageAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取本地图片失败'));
    reader.readAsDataURL(file);
  });
}

async function fetchRemoteImageBlob(url) {
  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) throw new Error('图片下载失败');
  return await resp.blob();
}

function openBgCacheDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BG_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BG_DB_STORE)) db.createObjectStore(BG_DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('无法打开背景缓存数据库'));
  });
}

async function putCachedBackgroundBlob(blob) {
  const db = await openBgCacheDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(BG_DB_STORE, 'readwrite');
    tx.objectStore(BG_DB_STORE).put(blob, BG_DB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('写入背景缓存失败'));
  });
  db.close();
}

async function getCachedBackgroundBlob() {
  const db = await openBgCacheDb();
  const blob = await new Promise((resolve, reject) => {
    const tx = db.transaction(BG_DB_STORE, 'readonly');
    const req = tx.objectStore(BG_DB_STORE).get(BG_DB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('读取背景缓存失败'));
  });
  db.close();
  return blob;
}

async function deleteCachedBackgroundBlob() {
  const db = await openBgCacheDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(BG_DB_STORE, 'readwrite');
    tx.objectStore(BG_DB_STORE).delete(BG_DB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('清理背景缓存失败'));
  });
  db.close();
}

function saveBackgroundState(payload) {
  localStorage.setItem(BG_STORE_KEY, JSON.stringify(payload));
}

async function restoreBackgroundState() {
  const raw = localStorage.getItem(BG_STORE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (!data) return;

    if (data.kind === 'file-blob' || data.kind === 'url-blob') {
      const blob = await getCachedBackgroundBlob();
      if (blob) {
        applyCustomBackgroundBlob(blob);
      } else if (data.originalUrl) {
        applyCustomBackground(data.originalUrl);
      }
    } else if (data.src) {
      applyCustomBackground(data.src);
    }

    if (data.originalUrl) bgUrlInput.value = data.originalUrl;
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
    originalUrl: url,
    src: url,
    cachedAt: Date.now(),
  };

  // If CORS allows, cache image blob in IndexedDB for robust persistence.
  try {
    const blob = await fetchRemoteImageBlob(url);
    await putCachedBackgroundBlob(blob);
    payload = {
      kind: 'url-blob',
      originalUrl: url,
      cachedAt: Date.now(),
    };
  } catch (e) {
    // Fall back to direct URL when CORS or cache is unavailable.
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

  try {
    // Convert File to pure Blob to avoid DataCloneError in IndexedDB
    const buffer = await file.arrayBuffer();
    const pureBlob = new Blob([buffer], { type: file.type });
    
    applyCustomBackgroundBlob(pureBlob);
    await putCachedBackgroundBlob(pureBlob);
    
    saveBackgroundState({
      kind: 'file-blob',
      filename: file.name,
      cachedAt: Date.now(),
    });
    closeBgModal();
  } catch (e) {
    alert('应用背景图失败: ' + (e.message || '未知错误'));
  }
}

async function clearBackgroundSetting() {
  localStorage.removeItem(BG_STORE_KEY);
  await deleteCachedBackgroundBlob().catch(() => {});
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
  btnTrackColors.disabled = false;
}

// ── Track colors modal ────────────────────────────────

function _hexFromFill(fill) {
  const m = fill.match(/^#[0-9a-f]{6}$/i);
  return m ? fill : '#ffffff';
}

function _glowFromHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.85)`;
}

function openTrackColorsModal() {
  tcModalBody.innerHTML = '';
  for (const [tIdx, tc] of trackColorMap) {
    const name = (midiData.trackNames && midiData.trackNames[tIdx]) || `轨道 ${tIdx + 1}`;
    const hex  = _hexFromFill(tc.fill);

    const row = document.createElement('div');
    row.className = 'tc-row';

    // Color swatch + hidden input
    const wrap = document.createElement('div');
    wrap.className = 'tc-swatch-wrap';
    wrap.style.background = hex;

    const picker = document.createElement('input');
    picker.type  = 'color';
    picker.value = hex;
    picker.title = '点击选色';
    picker.addEventListener('input', () => {
      const newHex = picker.value;
      wrap.style.background = newHex;
      hexLabel.textContent  = newHex.toUpperCase();
      trackColorMap.set(tIdx, { fill: newHex, glow: _glowFromHex(newHex) });
      // sync legend swatch
      const swatches = document.querySelectorAll('#track-legend .track-dot-swatch');
      let i = 0;
      for (const [k] of trackColorMap) {
        if (k === tIdx && swatches[i]) {
          swatches[i].style.background = newHex;
          swatches[i].style.boxShadow  = `0 0 4px ${newHex}`;
        }
        i++;
      }
    });
    wrap.appendChild(picker);

    const label = document.createElement('span');
    label.className = 'tc-name';
    label.textContent = name;

    const hexLabel = document.createElement('span');
    hexLabel.className = 'tc-hex';
    hexLabel.textContent = hex.toUpperCase();

    row.appendChild(wrap);
    row.appendChild(label);
    row.appendChild(hexLabel);
    tcModalBody.appendChild(row);
  }
  tcModal.classList.add('open');
  tcModal.setAttribute('aria-hidden', 'false');
}

function closeTrackColorsModal() {
  tcModal.classList.remove('open');
  tcModal.setAttribute('aria-hidden', 'true');
}

function resetTrackColors() {
  let colIdx = 0;
  for (const tIdx of trackColorMap.keys()) {
    trackColorMap.set(tIdx, CONSTANTS.TRACK_COLORS[colIdx++ % CONSTANTS.TRACK_COLORS.length]);
  }
  rebuildLegend();
  openTrackColorsModal(); // refresh rows
}

// ── Player callbacks ─────────────────────────────────────────
player.onNoteOn = (midi, velocity, trackIdx) => {
  const tc  = noteColor(midi, trackIdx);
  layout.press(midi, tc.fill);

  const key = layout.getKey(midi);
  if (key) {
    const cx = key.x + key.w / 2;
    const cy = keyboardY + (key.isBlack ? 4 : 6);
    particles.burst(cx, cy, [tc.fill, '#ffffff', tc.fill, 'rgba(255,255,255,0.8)'], 12);
    particles.smokeBurst(cx, cy, tc.fill, 4);
    _activeNotes.set(midi, { color: tc.fill, key, carry: 0 });
  }
};

player.onNoteOff = (midi) => {
  layout.release(midi);
  _activeNotes.delete(midi);
};

player.onEnded = () => {
  setPlayIcon(false);
  _activeNotes.clear();
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
      particles.burst(cx, cy, [tc.fill, '#ffffff', tc.fill], 12);
      particles.smokeBurst(cx, cy, tc.fill, 4);
      _activeNotes.set(midi, { color: tc.fill, key, carry: 0 });
    }
  },
  (midi) => {
    audio.noteOff(midi, null);
    layout.release(midi);
    _activeNotes.delete(midi);
  }
);

// ── UI Controls ──────────────────────────────────────────────
btnImport.addEventListener('click', () => fileInput.click());

btnPlaylistLoad.addEventListener('click', () => {
  const idx = parseInt(playlistSelect.value, 10);
  if (!Number.isFinite(idx)) return;
  loadPlaylistItemByIndex(idx, false);
});

playlistSelect.addEventListener('change', () => {
  const idx = parseInt(playlistSelect.value, 10);
  if (!Number.isFinite(idx)) return;
  loadPlaylistItemByIndex(idx, false);
});

btnBg.addEventListener('click', openBgModal);
btnBgClose.addEventListener('click', closeBgModal);

// Sample download modal
btnSampleDl.addEventListener('click', () => {
  sampleDlSection.style.display = '';
  btnSampleDl.disabled = true;
  btnSampleSkip.disabled = true;
  _doLoadSamples(
    (pct) => {
      sampleDlBarFill.style.width = pct + '%';
      sampleDlPct.textContent = pct + '%';
    },
    () => {
      sampleDlStatus.textContent = '下载完成';
      sampleDlPct.textContent = '✓';
      setTimeout(() => closeSampleModal(), 900);
      hideDownloadButton();
    },
    (msg) => {
      sampleDlStatus.textContent = '⚠ ' + msg;
      sampleDlPct.textContent = '';
      btnSampleSkip.disabled = false;
    }
  );
});

btnSampleSkip.addEventListener('click', () => {
  setSampleState('skipped');
  closeSampleModal();
  showDownloadButton();
});

// Download button in controls bar (shown after user skips)
btnDownloadSample.addEventListener('click', () => {
  if (audio._loadStarted) return;
  btnDownloadSample.disabled = true;
  btnDownloadSample.textContent = '音源 0%';
  _doLoadSamples(
    (pct) => { btnDownloadSample.textContent = `音源 ${pct}%`; },
    () => {
      btnDownloadSample.textContent = '音源 ✓';
      btnDownloadSample.style.color = '#39ff14';
      btnDownloadSample.style.borderColor = '#39ff14';
    },
    () => {
      btnDownloadSample.textContent = '↓ 重试';
      btnDownloadSample.style.color = '#ff4444';
      btnDownloadSample.disabled = false;
    }
  );
});

// Grid toggle
btnToggleGrid.classList.toggle('active', window.SHOW_GRID);
btnToggleGrid.addEventListener('click', () => {
  window.SHOW_GRID = !window.SHOW_GRID;
  localStorage.setItem('webpiano.showGrid', window.SHOW_GRID);
  btnToggleGrid.classList.toggle('active', window.SHOW_GRID);
});

// Background opacity slider — sync initial state from persisted value
(function syncOpacityUI() {
  const pct = Math.round(window.BG_OPACITY * 100);
  bgOpacitySlider.value   = pct;
  bgOpacityDisplay.textContent = pct + '%';
})();
bgOpacitySlider.addEventListener('input', () => {
  const pct = parseInt(bgOpacitySlider.value, 10);
  window.BG_OPACITY = pct / 100;
  bgOpacityDisplay.textContent = pct + '%';
  localStorage.setItem('webpiano.bgOpacity', window.BG_OPACITY);
});

// Track colors modal
btnTrackColors.addEventListener('click', openTrackColorsModal);
btnTcClose.addEventListener('click', closeTrackColorsModal);
btnTcReset.addEventListener('click', resetTrackColors);
tcModal.addEventListener('click', (e) => {
  if (e.target && e.target.dataset && e.target.dataset.close === '1') closeTrackColorsModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tcModal.classList.contains('open')) closeTrackColorsModal();
});
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
  clearBackgroundSetting()
    .catch(() => {})
    .finally(() => closeBgModal());
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
  _activeNotes.clear();
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
  _activeNotes.clear();
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

  // Continuous particle emission for held notes
  for (const note of _activeNotes.values()) {
    note.carry += 0.9 * dt * 60;
    while (note.carry >= 1) {
      note.carry -= 1;
      const cx = note.key.x + note.key.w / 2;
      const cy = keyboardY + (note.key.isBlack ? 4 : 6);
      particles.burst(cx, cy, [note.color, '#ffffff', note.color], 1);
    }
  }

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
