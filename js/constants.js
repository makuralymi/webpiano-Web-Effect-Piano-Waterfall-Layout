// ============================================================
//  constants.js  —  shared config, colors and piano layout data
// ============================================================

const C = window.CONSTANTS = {

  // Piano range
  MIDI_START:       21,   // A0
  MIDI_END:         108,  // C8
  WHITE_KEY_COUNT:  52,

  // Waterfall
  FALL_SECONDS: 2.2,      // seconds of notes visible above keyboard

  // Keyboard section height (fraction of canvas height)
  KEYBOARD_FRAC: 0.22,

  // Black‑key dimensions relative to white key
  BLACK_KEY_WIDTH_RATIO:  0.60,
  BLACK_KEY_HEIGHT_RATIO: 0.63,

  // Which semitones (C‑based, 0=C) are black
  BLACK_SEMITONES: new Set([1, 3, 6, 8, 10]),

  // ---------- Colors ----------
  BG:            '#09090f',
  BG_WATERFALL:  '#0b0b16',

  // White / black key at rest
  KEY_WHITE:     '#dedad0',
  KEY_WHITE_BOT: '#c8c4ba',
  KEY_BLACK:     '#18181c',
  KEY_BLACK_BOT: '#0e0e12',

  // Separator between adjacent white keys
  KEY_SEP:       'rgba(0,0,0,0.45)',

  // Per-track note bar colours  (fill, glow)
  TRACK_COLORS: [
    { fill: '#00d4ff', glow: 'rgba(0,212,255,0.85)'   },  // cyan
    { fill: '#ff3f80', glow: 'rgba(255,63,128,0.85)'  },  // pink
    { fill: '#ff8c00', glow: 'rgba(255,140,0,0.85)'   },  // amber
    { fill: '#b47aff', glow: 'rgba(180,122,255,0.85)' },  // violet
    { fill: '#39ff14', glow: 'rgba(57,255,20,0.85)'   },  // neon green
    { fill: '#ff4444', glow: 'rgba(255,68,68,0.85)'   },  // red
    { fill: '#00ffcc', glow: 'rgba(0,255,204,0.85)'   },  // teal
    { fill: '#ffee00', glow: 'rgba(255,238,0,0.85)'   },  // yellow
  ],

  // Particle colours (reuse accent tones)
  PARTICLE_PALETTE: [
    '#00d4ff','#ffffff','#80eaff',
    '#ff3f80','#ffaacc',
    '#ff8c00','#ffcc66',
  ],
};
