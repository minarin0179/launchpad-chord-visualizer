/** 音色の定義。キー文字列は localStorage に保存されるので変更しないこと */

export interface SynthEnvelope {
  /** アタック時間（秒）= attackBase + (1 − velocity / 127) × attackVelRange */
  readonly attackBase: number;
  readonly attackVelRange: number;
  /** ピークからサステインまでの時間（秒）。0 なら減衰なし */
  readonly decayTime: number;
  /** サステイン音量 / ピーク音量 */
  readonly sustainRatio: number;
  readonly releaseTime: number;
}

/** Web Audio の OscillatorType / BiquadFilterType のうち使うもの（この層は DOM の型に依存しない） */
export type WaveShape = 'sine' | 'triangle' | 'sawtooth' | 'square';
export type FilterShape = 'lowpass' | 'highpass' | 'bandpass';

export interface SynthFilter {
  readonly type: FilterShape;
  readonly frequency: number;
  readonly q: number;
}

interface SynthPresetBase {
  readonly envelope: SynthEnvelope;
  /** 音量 1・最大ベロシティのときのピークゲイン */
  readonly peakVolFactor: number;
  readonly filter: SynthFilter | null;
}

/** 2 オシレーター構成 */
export interface OscillatorPreset extends SynthPresetBase {
  readonly kind: 'oscillators';
  readonly osc1: { readonly type: WaveShape };
  readonly osc2: {
    readonly type: WaveShape;
    readonly detune: number;
    readonly volRatio: number;
  } | null;
}

/** 倍音の加算合成（オルガン） */
export interface AdditivePreset extends SynthPresetBase {
  readonly kind: 'additive';
  /** 基音に対する倍率とそのゲイン */
  readonly harmonics: readonly { readonly multiple: number; readonly gain: number }[];
}

export type SynthPreset = OscillatorPreset | AdditivePreset;

/**
 * オシレーター合成プリセット。
 * `Synth` 音色のほか、サンプル未ロード時 / CDN に到達できないときのフォールバックに使う。
 */
export const SYNTH_PRESETS = {
  synth: {
    kind: 'oscillators',
    osc1: { type: 'triangle' },
    osc2: { type: 'sine', detune: 6, volRatio: 1.0 },
    envelope: {
      attackBase: 0.005,
      attackVelRange: 0.045,
      decayTime: 0.07,
      sustainRatio: 0.5,
      releaseTime: 0.8,
    },
    peakVolFactor: 0.25,
    filter: null,
  },
  piano: {
    kind: 'oscillators',
    osc1: { type: 'sine' },
    osc2: { type: 'triangle', detune: 0, volRatio: 0.25 },
    envelope: {
      attackBase: 0.002,
      attackVelRange: 0.003,
      decayTime: 2.0,
      sustainRatio: 0.01,
      releaseTime: 0.3,
    },
    peakVolFactor: 0.45,
    filter: null,
  },
  organ: {
    kind: 'additive',
    harmonics: [
      { multiple: 1, gain: 1.0 },
      { multiple: 2, gain: 0.6 },
      { multiple: 3, gain: 0.3 },
      { multiple: 4, gain: 0.15 },
    ],
    envelope: {
      attackBase: 0.005,
      attackVelRange: 0,
      decayTime: 0,
      sustainRatio: 1.0,
      releaseTime: 0.04,
    },
    peakVolFactor: 0.12,
    filter: null,
  },
  guitar: {
    kind: 'oscillators',
    osc1: { type: 'sawtooth' },
    osc2: { type: 'sine', detune: 0, volRatio: 0.3 },
    envelope: {
      attackBase: 0.001,
      attackVelRange: 0.002,
      decayTime: 0.2,
      sustainRatio: 0.03,
      releaseTime: 0.12,
    },
    peakVolFactor: 0.3,
    filter: { type: 'lowpass', frequency: 2500, q: 1 },
  },
  bass: {
    kind: 'oscillators',
    osc1: { type: 'sine' },
    osc2: { type: 'triangle', detune: -1200, volRatio: 0.2 },
    envelope: {
      attackBase: 0.005,
      attackVelRange: 0.01,
      decayTime: 0.05,
      sustainRatio: 0.7,
      releaseTime: 0.3,
    },
    peakVolFactor: 0.4,
    filter: { type: 'lowpass', frequency: 600, q: 1 },
  },
  strings: {
    kind: 'oscillators',
    osc1: { type: 'sawtooth' },
    osc2: { type: 'sawtooth', detune: 5, volRatio: 0.7 },
    envelope: {
      attackBase: 0.15,
      attackVelRange: 0.25,
      decayTime: 0,
      sustainRatio: 1.0,
      releaseTime: 1.5,
    },
    peakVolFactor: 0.18,
    filter: { type: 'lowpass', frequency: 1800, q: 0.7 },
  },
} as const satisfies Record<string, SynthPreset>;

export type SynthPresetKey = keyof typeof SYNTH_PRESETS;

export function synthPreset(key: SynthPresetKey): SynthPreset {
  return SYNTH_PRESETS[key];
}

export interface InstrumentDef {
  readonly label: string;
  /** GM Soundfont の音色名（null = オシレーター合成のみ） */
  readonly gm: string | null;
  /** サンプル未ロード時に使う合成プリセット */
  readonly synth: SynthPresetKey;
  /** サンプル再生のリリース時間（秒）。省略時 SAMPLE_RELEASE_SEC */
  readonly release?: number;
}

/**
 * 音色一覧（UI の Sound ボタン順）。
 * ロングトーンのループは使わない: MusyngKite は全音色が約 3.1 秒の減衰録音で、
 * どこにループ区間を取っても音量が跳ねて脈打つ（詳細は CLAUDE.md）。
 */
export const INSTRUMENTS = {
  // Keys
  piano: { label: 'Piano', gm: 'acoustic_grand_piano', synth: 'piano' },
  epiano: { label: 'E.Piano', gm: 'electric_piano_1', synth: 'piano' },
  harpsi: { label: 'Harpsi', gm: 'harpsichord', synth: 'piano' },
  organ: { label: 'Organ', gm: 'drawbar_organ', synth: 'organ', release: 0.08 },
  church: { label: 'Church', gm: 'church_organ', synth: 'organ', release: 0.4 },
  // Guitar / Bass
  nylon: { label: 'Nylon', gm: 'acoustic_guitar_nylon', synth: 'guitar' },
  steel: { label: 'Steel', gm: 'acoustic_guitar_steel', synth: 'guitar' },
  eguitar: { label: 'E.Guitar', gm: 'electric_guitar_clean', synth: 'guitar' },
  abass: { label: 'A.Bass', gm: 'acoustic_bass', synth: 'bass' },
  bass: { label: 'E.Bass', gm: 'electric_bass_finger', synth: 'bass' },
  // Strings / Voice
  strings: { label: 'Strings', gm: 'string_ensemble_1', synth: 'strings', release: 0.5 },
  violin: { label: 'Violin', gm: 'violin', synth: 'strings', release: 0.4 },
  cello: { label: 'Cello', gm: 'cello', synth: 'strings', release: 0.4 },
  choir: { label: 'Choir', gm: 'choir_aahs', synth: 'strings', release: 0.5 },
  // Mallet / Wind
  vibes: { label: 'Vibes', gm: 'vibraphone', synth: 'piano' },
  marimba: { label: 'Marimba', gm: 'marimba', synth: 'piano' },
  flute: { label: 'Flute', gm: 'flute', synth: 'strings', release: 0.25 },
  trumpet: { label: 'Trumpet', gm: 'trumpet', synth: 'organ', release: 0.2 },
  sax: { label: 'Sax', gm: 'alto_sax', synth: 'organ', release: 0.2 },
  // Synth
  pad: { label: 'Warm Pad', gm: 'pad_2_warm', synth: 'strings', release: 0.8 },
  lead: { label: 'Saw Lead', gm: 'lead_2_sawtooth', synth: 'synth', release: 0.2 },
  synth: { label: 'Synth', gm: null, synth: 'synth' },
} as const satisfies Record<string, InstrumentDef>;

export type InstrumentKey = keyof typeof INSTRUMENTS;

export const INSTRUMENT_KEYS = Object.keys(INSTRUMENTS) as InstrumentKey[];
export const DEFAULT_INSTRUMENT: InstrumentKey = 'piano';

export function isInstrumentKey(value: unknown): value is InstrumentKey {
  return typeof value === 'string' && Object.hasOwn(INSTRUMENTS, value);
}

export function instrumentDef(key: InstrumentKey): InstrumentDef {
  return INSTRUMENTS[key];
}

// ---------- サンプル音源（smplr + GM Soundfont） ----------
/** gleitz/midi-js-soundfonts のキット名 */
export const SOUNDFONT_KIT = 'MusyngKite';
/** デコードするノート範囲（ピアノ音域）。範囲外は最近傍のサンプルをピッチシフトする */
export const SAMPLE_NOTE_RANGE = { low: 21, high: 108 } as const;
/** サンプル再生のデフォルトのリリース時間（秒） */
export const SAMPLE_RELEASE_SEC = 0.3;
/** サンプル再生のマスター音量（0〜127 の MIDI スケール） */
export const SAMPLE_VOLUME = 100;

// ---------- 合成音のエンベロープ ----------
/** 指数カーブは 0 に到達できないので、消音はこの値を目標にする */
export const SILENCE_GAIN = 0.001;
/** サステインの下限（指数リリースの開始値が 0 にならないように） */
export const MIN_SUSTAIN_GAIN = 0.0001;

// ---------- メトロノーム ----------
export interface ClickSound {
  readonly freq: number;
  readonly vol: number;
  /** 減衰時間（秒） */
  readonly decay: number;
}
/** 1 拍目（ぴ） */
export const METRO_ACCENT: ClickSound = { freq: 1200, vol: 0.35, decay: 0.055 };
/** 2〜4 拍目（ぽ） */
export const METRO_NORMAL: ClickSound = { freq: 700, vol: 0.18, decay: 0.04 };
/** クリック音の立ち上がり（秒） */
export const METRO_CLICK_RAMP_SEC = 0.002;
/** 減衰が終わってからオシレーターを止めるまでの余裕（秒） */
export const METRO_CLICK_TAIL_SEC = 0.01;
/** 何秒先までのクリックを予約しておくか / 予約を確認する間隔（ms） */
export const METRO_SCHEDULE_AHEAD_SEC = 0.12;
export const METRO_SCHEDULER_INTERVAL_MS = 25;
