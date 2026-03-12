// ============================================================
//  midi-player.js  —  MIDI playback scheduler
// ============================================================

class MidiPlayer {
  constructor(audioEngine) {
    this.audio    = audioEngine;
    this._data    = null;
    this._state   = 'stopped';   // 'stopped' | 'playing' | 'paused'

    this._speed   = 1.0;
    this._pausedAt = 0;          // song‑time when paused

    // Audio clock anchoring
    this._origin  = 0;           // audioCtx.currentTime at song‑time=0

    // Scheduling state
    this._interval     = null;
    this._schedIdx     = 0;      // next event index to audio‑schedule
    this._visualIdx    = 0;      // next event index for visual callbacks
    this._ccSchedIdx   = 0;      // next CC event index for audio scheduling
    this._ccVisualIdx  = 0;      // next CC event index for visual callbacks
    this._LOOKAHEAD    = 0.15;   // seconds ahead to schedule audio

    // Active note tracking (for noteOff)
    this._pendingOffs  = [];   // [{songTime, midi}]

    // Visual callbacks (fired by update())
    this.onNoteOn  = null;   // (midi, velocity, trackIndex) => void
    this.onNoteOff = null;   // (midi) => void
    this.onEnded   = null;   // () => void
    this.onTick    = null;   // (songTimeSec) => void
    this.onCC      = null;   // (type, cc, value, channel, trackIndex) => void

    this._prevSongTime = 0;
    // notes currently visually active
    this._activeNotes = new Map();   // midi → {endSec, trackIndex, velocity}
  }

  load(parsedData) {
    this.stop();
    this._data      = parsedData;
    this._state     = 'stopped';
    this._pausedAt  = 0;
  }

  get state()    { return this._state; }
  get duration() { return this._data ? this._data.durationSec : 0; }

  get songTime() {
    if (!this._data)         return 0;
    if (this._state === 'paused')   return this._pausedAt;
    if (this._state === 'stopped')  return 0;
    const raw = (this.audio.currentTime - this._origin) * this._speed;
    return Math.min(raw, this.duration + 0.5);
  }

  play(fromSec) {
    if (!this._data) return;
    const start = fromSec ?? (this._state === 'paused' ? this._pausedAt : 0);
    this._anchor(start);
    this._state = 'playing';
    this._startScheduler();
  }

  pause() {
    if (this._state !== 'playing') return;
    this._pausedAt = this.songTime;
    this._state    = 'paused';
    this._stopScheduler();
    this.audio.allNotesOff();
    this._pendingOffs = [];
    // Fire visual noteOff for all active notes so keys un-highlight
    if (this.onNoteOff) {
      for (const [, ev] of this._activeNotes) this.onNoteOff(ev.midi);
    }
    this._activeNotes.clear();
  }

  stop() {
    this._state    = 'stopped';
    this._pausedAt = 0;
    this._stopScheduler();
    if (this.audio) this.audio.allNotesOff();
    this._pendingOffs  = [];
    this._activeNotes.clear();
  }

  setSpeed(s) {
    const cur = this.songTime;
    this._speed = s;
    if (this._state === 'playing') {
      this._anchor(cur);
    }
  }

  // Called every animation frame by main.js
  update() {
    if (this._state !== 'playing') return;

    const t    = this.songTime;
    const prev = this._prevSongTime;
    this._prevSongTime = t;

    if (this.onTick) this.onTick(t);

    // Fire visual noteOn for events that fall in [prev, t]
    if (this.onNoteOn || this.onNoteOff) {
      const evts = this._data.noteEvents;

      // Advance visual index past events that started before the window
      while (this._visualIdx < evts.length && evts[this._visualIdx].startSec < prev)
        this._visualIdx++;

      // Fire noteOn for events in this frame's window
      let i = this._visualIdx;
      while (i < evts.length && evts[i].startSec <= t) {
        const ev = evts[i++];
        this._activeNotes.set(`${ev.midi}_${ev.trackIndex}`, ev);
        if (this.onNoteOn) this.onNoteOn(ev.midi, ev.velocity, ev.trackIndex);
      }

      // Check for ended notes
      for (const [k, ev] of this._activeNotes) {
        if (ev.endSec <= t) {
          this._activeNotes.delete(k);
          if (this.onNoteOff) this.onNoteOff(ev.midi);
        }
      }
    }

    // Finished?
    if (t >= this.duration + 0.3) {
      this.stop();
      if (this.onEnded) this.onEnded();
      return;
    }

    // Fire onCC for CC/pitchBend events crossing the playhead
    if (this.onCC) {
      const ccEvts = this._data.ccEvents || [];
      while (this._ccVisualIdx < ccEvts.length && ccEvts[this._ccVisualIdx].startSec < prev)
        this._ccVisualIdx++;
      let ci = this._ccVisualIdx;
      while (ci < ccEvts.length && ccEvts[ci].startSec <= t) {
        const ev = ccEvts[ci++];
        this.onCC(ev.type, ev.cc, ev.value, ev.channel, ev.trackIndex);
      }
    }
  }

  // ── Private ──────────────────────────────────────────────

  _anchor(songTime) {
    this._origin       = this.audio.currentTime - songTime / this._speed;
    this._prevSongTime = songTime;
    this._activeNotes.clear();

    // Reset note schedule indices
    const evts = this._data.noteEvents;
    this._schedIdx  = this._lowerBound(evts, songTime - 0.01);
    this._visualIdx = this._lowerBound(evts, Math.max(0, songTime - 0.05));
    this._pendingOffs = [];

    // Reset CC indices
    const ccEvts = this._data.ccEvents || [];
    this._ccSchedIdx  = this._lowerBound(ccEvts, songTime - 0.01);
    this._ccVisualIdx = this._lowerBound(ccEvts, Math.max(0, songTime - 0.05));
  }

  _lowerBound(arr, t) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].startSec < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  _startScheduler() {
    this._stopScheduler();
    this._interval = setInterval(() => this._scheduleChunk(), 25);
    this._scheduleChunk();  // run immediately
  }

  _stopScheduler() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  _scheduleChunk() {
    if (this._state !== 'playing') return;

    const audioNow  = this.audio.currentTime;
    const songNow   = (audioNow - this._origin) * this._speed;
    // horizon in song‑time: lookahead is 0.15 audio‑sec = 0.15*speed song‑sec
    const horizon   = songNow + this._LOOKAHEAD * this._speed;

    const evts      = this._data.noteEvents;

    // Schedule noteOff events
    for (let i = this._pendingOffs.length - 1; i >= 0; i--) {
      const { songT, midi } = this._pendingOffs[i];
      if (songT <= horizon) {
        const audioT = this._origin + songT / this._speed;
        this.audio.noteOff(midi, audioT);
        this._pendingOffs.splice(i, 1);
      }
    }

    // Schedule noteOn events
    while (this._schedIdx < evts.length) {
      const ev = evts[this._schedIdx];
      if (ev.startSec > horizon) break;

      if (ev.startSec >= songNow - 0.05) {
        const audioT = this._origin + ev.startSec / this._speed;
        this.audio.noteOn(ev.midi, ev.velocity, audioT);
        this._pendingOffs.push({
          songT: ev.endSec,
          midi:  ev.midi,
        });
      }
      this._schedIdx++;
    }

    // Schedule CC / pitch‑bend events with precise audio timing
    const ccEvts = this._data.ccEvents || [];
    while (this._ccSchedIdx < ccEvts.length) {
      const ev = ccEvts[this._ccSchedIdx];
      if (ev.startSec > horizon) break;
      if (ev.startSec >= songNow - 0.05) {
        const audioT = this._origin + ev.startSec / this._speed;
        this.audio.cc(ev.type, ev.cc, ev.value, audioT);
      }
      this._ccSchedIdx++;
    }
  }
}

window.MidiPlayer = MidiPlayer;
