// ============================================================
//  midi-parser.js  —  parse binary .mid files into note events
// ============================================================

const MidiParser = (() => {

  function readString(view, offset, len) {
    let s = '';
    for (let i = 0; i < len; i++)
      s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  }

  // Variable‑Length Quantity
  function readVLQ(view, offset) {
    let value = 0, read = 0, byte;
    do {
      byte   = view.getUint8(offset + read++);
      value  = (value << 7) | (byte & 0x7F);
    } while (byte & 0x80);
    return { value, read };
  }

  // Parse a single track chunk; returns raw event array with absoluteTick
  function parseTrack(view, start, length, trackIndex) {
    const end    = start + length;
    const events = [];
    let pos      = start;
    let absT     = 0;
    let running  = 0;   // running status

    while (pos < end) {
      const delta = readVLQ(view, pos);
      pos  += delta.read;
      absT += delta.value;

      let status = view.getUint8(pos);

      if (status === 0xFF) {
        // ── Meta event ──────────────────────────────────
        pos++;
        const mtype = view.getUint8(pos++);
        const mlen  = readVLQ(view, pos);
        pos += mlen.read;

        if (mtype === 0x51 && mlen.value === 3) {
          // Tempo: microseconds per beat
          const us = (view.getUint8(pos) << 16) |
                     (view.getUint8(pos + 1) << 8) |
                      view.getUint8(pos + 2);
          events.push({ absT, type: 'tempo', usPerBeat: us });
        } else if (mtype === 0x03 || mtype === 0x01) {
          // Track name / text
          let name = '';
          for (let i = 0; i < mlen.value; i++)
            name += String.fromCharCode(view.getUint8(pos + i));
          events.push({ absT, type: 'name', name, trackIndex });
        }
        pos += mlen.value;
        running = 0;

      } else if (status === 0xF0 || status === 0xF7) {
        // ── SysEx ───────────────────────────────────────
        pos++;
        const slen = readVLQ(view, pos);
        pos += slen.read + slen.value;
        running = 0;

      } else {
        // ── MIDI channel event ───────────────────────────
        if (status & 0x80) {
          running = status;
          pos++;
        } else {
          // Running status: re‑use last status byte (don't advance pos)
          status = running;
        }

        const type    = status & 0xF0;
        const channel = status & 0x0F;

        switch (type) {
          case 0x90: {   // Note On
            const note = view.getUint8(pos++);
            const vel  = view.getUint8(pos++);
            events.push({
              absT, trackIndex, channel,
              type: vel > 0 ? 'noteOn' : 'noteOff',
              note, velocity: vel,
            });
            break;
          }
          case 0x80: {   // Note Off
            const note = view.getUint8(pos++);
            const vel  = view.getUint8(pos++);
            events.push({ absT, trackIndex, channel, type: 'noteOff', note, velocity: vel });
            break;
          }
          case 0xA0:  // Aftertouch (skip)
            pos += 2;
            break;
          case 0xB0: {   // Control Change
            const cc  = view.getUint8(pos++);
            const val = view.getUint8(pos++);
            events.push({ absT, trackIndex, channel, type: 'cc', cc, value: val });
            break;
          }
          case 0xE0: {   // Pitch Bend  (-8192 … +8191)
            const lo   = view.getUint8(pos++);
            const hi   = view.getUint8(pos++);
            const bend = ((hi << 7) | lo) - 8192;
            events.push({ absT, trackIndex, channel, type: 'pitchBend', value: bend });
            break;
          }
          case 0xC0:  // Program Change (1 byte)
          case 0xD0:  // Channel Pressure (1 byte)
            pos += 1;
            break;
          default:
            pos++; // unknown, skip 1
        }
      }
    }
    return events;
  }

  // Convert absolute ticks → seconds, given a tempo map
  // tempoMap: sorted array of { absT, usPerBeat }
  function ticksToSec(tick, tempoMap, tpb) {
    let sec   = 0;
    let prevT = 0;
    let prevU = 500000; // default 120 BPM

    for (const { absT, usPerBeat } of tempoMap) {
      if (absT >= tick) break;
      sec   += (absT - prevT) / tpb * (prevU / 1e6);
      prevT  = absT;
      prevU  = usPerBeat;
    }
    sec += (tick - prevT) / tpb * (prevU / 1e6);
    return sec;
  }

  // Main parse function
  // Returns: { format, ticksPerBeat, noteEvents, durationSec, trackNames }
  function parse(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    let pos = 0;

    // ── Header ──────────────────────────────────────────
    if (readString(view, 0, 4) !== 'MThd')
      throw new Error('Not a valid MIDI file (missing MThd)');
    pos = 4;
    const headerLen   = view.getUint32(pos); pos += 4;  // should be 6
    const format      = view.getUint16(pos); pos += 2;
    const nTracks     = view.getUint16(pos); pos += 2;
    const divisionRaw = view.getUint16(pos); pos += 2;

    if (divisionRaw & 0x8000)
      throw new Error('SMPTE timecode MIDI not supported');

    const tpb = divisionRaw; // ticks per beat

    // ── Parse tracks ────────────────────────────────────
    const allRaw      = [];
    const trackNames  = [];

    for (let t = 0; t < nTracks; t++) {
      if (pos + 8 > view.byteLength) break;
      const magic = readString(view, pos, 4); pos += 4;
      const tlen  = view.getUint32(pos);      pos += 4;

      if (magic !== 'MTrk') { pos += tlen; continue; }

      const rawEvents = parseTrack(view, pos, tlen, t);
      allRaw.push(...rawEvents);
      pos += tlen;

      const nameEv = rawEvents.find(e => e.type === 'name');
      trackNames.push(nameEv ? nameEv.name : `Track ${t + 1}`);
    }

    // ── Build tempo map ──────────────────────────────────
    const tempoMap = allRaw
      .filter(e => e.type === 'tempo')
      .sort((a, b) => a.absT - b.absT);
    if (!tempoMap.length || tempoMap[0].absT > 0)
      tempoMap.unshift({ absT: 0, usPerBeat: 500000 });

    // ── Convert ticks → seconds ──────────────────────────
    const noteOnMap = new Map();  // key = `${track}_${ch}_${note}`
    const noteEvents = [];

    // Sort all events by absT (stable)
    allRaw.sort((a, b) => a.absT - b.absT || (a.type === 'noteOff' ? -1 : 1));

    let maxEnd = 0;

    for (const ev of allRaw) {
      if (ev.type !== 'noteOn' && ev.type !== 'noteOff') continue;
      if (ev.note < 21 || ev.note > 108) continue;  // outside piano range

      const key = `${ev.trackIndex}_${ev.channel}_${ev.note}`;

      if (ev.type === 'noteOn') {
        // push to stack (allow overlapping same‑note)
        if (!noteOnMap.has(key)) noteOnMap.set(key, []);
        noteOnMap.get(key).push({ absT: ev.absT, velocity: ev.velocity, track: ev.trackIndex, ch: ev.channel });
      } else {
        // noteOff
        const stack = noteOnMap.get(key);
        if (stack && stack.length) {
          const on = stack.shift();
          const startSec = ticksToSec(on.absT,  tempoMap, tpb);
          const endSec   = ticksToSec(ev.absT,  tempoMap, tpb);
          if (endSec > startSec) {
            noteEvents.push({
              midi:      ev.note,
              velocity:  on.velocity,
              startSec,
              endSec,
              trackIndex: on.track,
              channel:    on.ch,
            });
            if (endSec > maxEnd) maxEnd = endSec;
          }
        }
      }
    }

    // Close any notes that were never released
    for (const [, stack] of noteOnMap) {
      for (const on of stack) {
        const startSec = ticksToSec(on.absT, tempoMap, tpb);
        const endSec   = startSec + 0.5;
        noteEvents.push({ midi: on.note ?? 0, velocity: on.velocity, startSec, endSec,
                          trackIndex: on.track, channel: on.ch });
        if (endSec > maxEnd) maxEnd = endSec;
      }
    }

    noteEvents.sort((a, b) => a.startSec - b.startSec);

    // ── Collect CC + Pitch Bend events (ticks → seconds) ────
    const ccEvents = [];
    for (const ev of allRaw) {
      if (ev.type !== 'cc' && ev.type !== 'pitchBend') continue;
      ccEvents.push({
        startSec:   ticksToSec(ev.absT, tempoMap, tpb),
        type:       ev.type,          // 'cc' | 'pitchBend'
        cc:         ev.cc ?? null,    // controller number (null for pitchBend)
        value:      ev.value,
        channel:    ev.channel,
        trackIndex: ev.trackIndex,
      });
    }
    ccEvents.sort((a, b) => a.startSec - b.startSec);

    // Determine unique, real tracks (with at least one note)
    const trackSet = new Set(noteEvents.map(e => e.trackIndex));
    const tracks   = [...trackSet].sort((a, b) => a - b);

    return { format, tpb, noteEvents, ccEvents, durationSec: maxEnd, trackNames, tracks };
  }

  return { parse };
})();

window.MidiParser = MidiParser;
