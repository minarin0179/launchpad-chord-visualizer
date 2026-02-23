// =====================
// Music Theory Data
// =====================
export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export const CHORD_TYPES = {
  'maj':   { intervals: [0,4,7],       label: 'Major',    symbol: '' },
  'min':   { intervals: [0,3,7],       label: 'Minor',    symbol: 'm' },
  '7':     { intervals: [0,4,7,10],    label: 'Dom 7',    symbol: '7' },
  'maj7':  { intervals: [0,4,7,11],    label: 'Maj 7',    symbol: 'M7' },
  'min7':  { intervals: [0,3,7,10],    label: 'Min 7',    symbol: 'm7' },
  'dim':   { intervals: [0,3,6],       label: 'Dim',      symbol: '°' },
  'dim7':  { intervals: [0,3,6,9],     label: 'Dim 7',    symbol: '°7' },
  'aug':   { intervals: [0,4,8],       label: 'Aug',      symbol: '+' },
  'm7b5':  { intervals: [0,3,6,10],    label: 'Half-Dim', symbol: 'ø7' },
  'sus2':  { intervals: [0,2,7],       label: 'Sus2',     symbol: 'sus2' },
  'sus4':  { intervals: [0,5,7],       label: 'Sus4',     symbol: 'sus4' },
  'add9':  { intervals: [0,4,7,14],    label: 'Add9',     symbol: 'add9' },
  '9':     { intervals: [0,4,7,10,14], label: 'Dom 9',    symbol: '9' },
  'maj9':  { intervals: [0,4,7,11,14], label: 'Maj 9',    symbol: 'M9' },
  'min9':  { intervals: [0,3,7,10,14], label: 'Min 9',    symbol: 'm9' },
  '6':     { intervals: [0,4,7,9],     label: 'Maj 6',    symbol: '6' },
  'min6':  { intervals: [0,3,7,9],     label: 'Min 6',    symbol: 'm6' },
};

export const SCALES = {
  'major':      { intervals: [0,2,4,5,7,9,11], label: 'Major' },
  'minor':      { intervals: [0,2,3,5,7,8,10], label: 'Nat Minor' },
  'dorian':     { intervals: [0,2,3,5,7,9,10], label: 'Dorian' },
  'mixolydian': { intervals: [0,2,4,5,7,9,10], label: 'Mixolydian' },
  'penta_maj':  { intervals: [0,2,4,7,9],      label: 'Penta Maj' },
  'penta_min':  { intervals: [0,3,5,7,10],     label: 'Penta Min' },
  'blues':      { intervals: [0,3,5,6,7,10],   label: 'Blues' },
};

export const INTERVAL_NAMES = ['R','b2','2','b3','3','4','#4','5','b6','6','b7','7','(8)','b9','9'];

// =====================
// Instrument Presets
// =====================
export const INSTRUMENTS = {
  synth: {
    label: 'Synth',
    osc1: { type: 'triangle' },
    osc2: { type: 'sine', detune: 6, volRatio: 1.0 },
    envelope: { attackBase: 0.005, attackVelRange: 0.045, decayTime: 0.07, sustainRatio: 0.5, releaseTime: 0.8 },
    peakVolFactor: 0.25,
    filter: null,
  },
  piano: {
    label: 'Piano',
    osc1: { type: 'sine' },
    osc2: { type: 'triangle', detune: 0, volRatio: 0.25 },
    envelope: { attackBase: 0.002, attackVelRange: 0.003, decayTime: 2.0, sustainRatio: 0.01, releaseTime: 0.3 },
    peakVolFactor: 0.45,
    filter: null,
  },
  organ: {
    label: 'Organ',
    harmonics: [1, 2, 3, 4],
    harmonicGains: [1.0, 0.6, 0.3, 0.15],
    envelope: { attackBase: 0.005, attackVelRange: 0, decayTime: 0, sustainRatio: 1.0, releaseTime: 0.04 },
    peakVolFactor: 0.12,
    filter: null,
  },
  guitar: {
    label: 'Guitar',
    osc1: { type: 'sawtooth' },
    osc2: { type: 'sine', detune: 0, volRatio: 0.3 },
    envelope: { attackBase: 0.001, attackVelRange: 0.002, decayTime: 0.2, sustainRatio: 0.03, releaseTime: 0.12 },
    peakVolFactor: 0.3,
    filter: { type: 'lowpass', frequency: 2500, Q: 1 },
  },
  bass: {
    label: 'Bass',
    osc1: { type: 'sine' },
    osc2: { type: 'triangle', detune: -1200, volRatio: 0.2 },
    envelope: { attackBase: 0.005, attackVelRange: 0.01, decayTime: 0.05, sustainRatio: 0.7, releaseTime: 0.3 },
    peakVolFactor: 0.4,
    filter: { type: 'lowpass', frequency: 600, Q: 1 },
  },
  strings: {
    label: 'Strings',
    osc1: { type: 'sawtooth' },
    osc2: { type: 'sawtooth', detune: 5, volRatio: 0.7 },
    envelope: { attackBase: 0.15, attackVelRange: 0.25, decayTime: 0, sustainRatio: 1.0, releaseTime: 1.5 },
    peakVolFactor: 0.18,
    filter: { type: 'lowpass', frequency: 1800, Q: 0.7 },
  },
};

// =====================
// Grid Layout
// =====================
export const ROW_INTERVAL = 5;

export const CC_UP    = 91;  // Octave Up
export const CC_DOWN  = 92;  // Octave Down
export const CC_LEFT  = 93;  // Transpose -1
export const CC_RIGHT = 94;  // Transpose +1

export const RIGHT_COL_NOTES = [89, 79, 69, 59, 49, 39, 29, 19]; // top to bottom
export const TOP_ROW_LABELS  = ['OCT▲', 'OCT▼', '◄', '►', '', '', '', ''];
export const TOP_ROW_CCS     = [91, 92, 93, 94, 95, 96, 97, 98];

export function buildPadData(baseNote) {
  const pads = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const semitone = baseNote + row * ROW_INTERVAL + col;
      const pitchClass = ((semitone % 12) + 12) % 12;
      const launchpadNote = (row + 1) * 10 + (col + 1);
      pads.push({ row, col, semitone, pitchClass, launchpadNote });
    }
  }
  return pads;
}

// =====================
// Launchpad X LED Colors (RGB 0-127)
// =====================
export const COLORS = {
  root:    [127, 0, 40],
  chord:   [0, 100, 127],
  scale:   [0, 127, 60],
  bass:    [127, 80, 0],
  off:     [0, 0, 0],
  pressed: [127, 127, 127],
};

// Logo LED color (RGB)
export const LOGO_GREEN       = [0, 100, 0];
// Function button LED colors (RGB)
export const FN_BTN_COLOR     = [60, 30, 0];  // 上段アクティブボタン（OCT/Capo）
export const FN_BTN_OFF_COLOR = [3, 3, 3];    // 上段非アクティブボタン
// Metronome logo flash colors (RGB)
export const METRO_LOGO_ACCENT = [127, 127, 127];
export const METRO_LOGO_NORMAL = [60, 80, 100];

// =====================
// Timing Constants (ms)
// =====================
export const LOGO_FLASH_MS             = 80;   // メトロノームロゴフラッシュ持続時間
export const PROGRAMMER_MODE_DELAY_MS  = 150;  // Programmer Mode切替後の待機時間
export const FN_ACTIVE_DURATION_MS     = 200;  // 上段ボタン fn-active クラス保持時間
export const RIGHT_COL_NOTE_DURATION_MS = 150; // 右列ボタン pressed クラス保持時間

// =====================
// BPM Range
// =====================
export const BPM_MIN     = 40;
export const BPM_MAX     = 240;
export const BPM_DEFAULT = 120;

// =====================
// Note Range Limits
// =====================
export const MAX_BASE_NOTE_OCTAVE = 108;  // オクターブ変更時の上限
export const MAX_BASE_NOTE_CAPO   = 115;  // カポ変更時の上限

// =====================
// Velocity
// =====================
export const CLICK_PAD_VELOCITY = 80;  // 画面パッドクリック時の固定 velocity

// =====================
// Metronome Click Sound
// =====================
export const METRO_ACCENT       = { freq: 1200, vol: 0.35, decay: 0.055 };
export const METRO_NORMAL       = { freq: 700,  vol: 0.18, decay: 0.04  };
export const METRO_CLICK_RAMP_S = 0.002;  // linearRampToValueAtTime 用（秒）
