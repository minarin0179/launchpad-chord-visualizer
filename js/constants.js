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

export const INVERSION_LABELS = ['Root', '1st', '2nd', '3rd', '4th'];

// =====================
// Instrument Presets
// =====================
// オシレーター合成プリセット
// — `Synth` 音色、およびサンプル未ロード時 / CDN 到達不可時のフォールバックに使う
export const SYNTH_PRESETS = {
  synth: {
    osc1: { type: 'triangle' },
    osc2: { type: 'sine', detune: 6, volRatio: 1.0 },
    envelope: { attackBase: 0.005, attackVelRange: 0.045, decayTime: 0.07, sustainRatio: 0.5, releaseTime: 0.8 },
    peakVolFactor: 0.25,
    filter: null,
  },
  piano: {
    osc1: { type: 'sine' },
    osc2: { type: 'triangle', detune: 0, volRatio: 0.25 },
    envelope: { attackBase: 0.002, attackVelRange: 0.003, decayTime: 2.0, sustainRatio: 0.01, releaseTime: 0.3 },
    peakVolFactor: 0.45,
    filter: null,
  },
  organ: {
    harmonics: [1, 2, 3, 4],
    harmonicGains: [1.0, 0.6, 0.3, 0.15],
    envelope: { attackBase: 0.005, attackVelRange: 0, decayTime: 0, sustainRatio: 1.0, releaseTime: 0.04 },
    peakVolFactor: 0.12,
    filter: null,
  },
  guitar: {
    osc1: { type: 'sawtooth' },
    osc2: { type: 'sine', detune: 0, volRatio: 0.3 },
    envelope: { attackBase: 0.001, attackVelRange: 0.002, decayTime: 0.2, sustainRatio: 0.03, releaseTime: 0.12 },
    peakVolFactor: 0.3,
    filter: { type: 'lowpass', frequency: 2500, Q: 1 },
  },
  bass: {
    osc1: { type: 'sine' },
    osc2: { type: 'triangle', detune: -1200, volRatio: 0.2 },
    envelope: { attackBase: 0.005, attackVelRange: 0.01, decayTime: 0.05, sustainRatio: 0.7, releaseTime: 0.3 },
    peakVolFactor: 0.4,
    filter: { type: 'lowpass', frequency: 600, Q: 1 },
  },
  strings: {
    osc1: { type: 'sawtooth' },
    osc2: { type: 'sawtooth', detune: 5, volRatio: 0.7 },
    envelope: { attackBase: 0.15, attackVelRange: 0.25, decayTime: 0, sustainRatio: 1.0, releaseTime: 1.5 },
    peakVolFactor: 0.18,
    filter: { type: 'lowpass', frequency: 1800, Q: 0.7 },
  },
};

// 音色一覧（UI の Sound ボタン順）
//   gm      : GM Soundfont の音色名（null = オシレーター合成のみ）
//   synth   : サンプル未ロード時に使う SYNTH_PRESETS のキー
//   release : サンプル再生のリリース時間（秒） — 省略時 SAMPLE_RELEASE_S
//   vol     : サンプルのマスター音量（0〜127） — 省略時 SAMPLE_VOLUME
// ※ ロングトーンのループは使わない（goldst.dev のループ情報は MusyngKite に適合しない）
//    MusyngKite は全音色が 3.13 秒の減衰録音で、どこにループ区間を取っても始点と終点で
//    音量が食い違い、ループごとに音量が跳ねて脈打つ。詳細は CLAUDE.md
export const INSTRUMENTS = {
  // Keys
  piano:   { label: 'Piano',    gm: 'acoustic_grand_piano',   synth: 'piano' },
  epiano:  { label: 'E.Piano',  gm: 'electric_piano_1',       synth: 'piano' },
  harpsi:  { label: 'Harpsi',   gm: 'harpsichord',            synth: 'piano' },
  organ:   { label: 'Organ',    gm: 'drawbar_organ',          synth: 'organ',   release: 0.08 },
  church:  { label: 'Church',   gm: 'church_organ',           synth: 'organ',   release: 0.4 },
  // Guitar / Bass
  nylon:   { label: 'Nylon',    gm: 'acoustic_guitar_nylon',  synth: 'guitar' },
  steel:   { label: 'Steel',    gm: 'acoustic_guitar_steel',  synth: 'guitar' },
  eguitar: { label: 'E.Guitar', gm: 'electric_guitar_clean',  synth: 'guitar' },
  abass:   { label: 'A.Bass',   gm: 'acoustic_bass',          synth: 'bass' },
  bass:    { label: 'E.Bass',   gm: 'electric_bass_finger',   synth: 'bass' },
  // Strings / Voice
  strings: { label: 'Strings',  gm: 'string_ensemble_1',      synth: 'strings', release: 0.5 },
  violin:  { label: 'Violin',   gm: 'violin',                 synth: 'strings', release: 0.4 },
  cello:   { label: 'Cello',    gm: 'cello',                  synth: 'strings', release: 0.4 },
  choir:   { label: 'Choir',    gm: 'choir_aahs',             synth: 'strings', release: 0.5 },
  // Mallet / Wind
  vibes:   { label: 'Vibes',    gm: 'vibraphone',             synth: 'piano' },
  marimba: { label: 'Marimba',  gm: 'marimba',                synth: 'piano' },
  flute:   { label: 'Flute',    gm: 'flute',                  synth: 'strings', release: 0.25 },
  trumpet: { label: 'Trumpet',  gm: 'trumpet',                synth: 'organ',   release: 0.2 },
  sax:     { label: 'Sax',      gm: 'alto_sax',               synth: 'organ',   release: 0.2 },
  // Synth
  pad:     { label: 'Warm Pad', gm: 'pad_2_warm',             synth: 'strings', release: 0.8 },
  lead:    { label: 'Saw Lead', gm: 'lead_2_sawtooth',        synth: 'synth',   release: 0.2 },
  synth:   { label: 'Synth',    gm: null,                     synth: 'synth' },
};

// =====================
// Sampled Instruments (smplr / GM Soundfont)
// =====================
// smplr を CDN から動的 import する（オフライン時は合成音にフォールバック）
export const SMPLR_MODULE_URL = 'https://cdn.jsdelivr.net/npm/smplr@1.1.0/dist/index.mjs';
// gleitz/midi-js-soundfonts のキット名
export const SOUNDFONT_KIT = 'MusyngKite';
// デコードするノート範囲（ピアノ音域）— 範囲外は最近傍サンプルをピッチシフト
export const SAMPLE_NOTE_RANGE = [21, 108];
// サンプル再生のデフォルトリリース時間（秒）
export const SAMPLE_RELEASE_S = 0.3;
// サンプル再生のマスター音量（0〜127 の MIDI スケール）
export const SAMPLE_VOLUME = 100;

// =====================
// Grid Layout
// =====================
export const ROW_INTERVAL = 5;

export const CC_UP    = 91;  // Octave Up
export const CC_DOWN  = 92;  // Octave Down
export const CC_LEFT  = 93;  // Transpose -1
export const CC_RIGHT = 94;  // Transpose +1

export const TOP_ROW_LABELS  = ['OCT▲', 'OCT▼', '◄', '►', '', '', '', ''];

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
