/**
 * 音楽理論のテーブル。
 * キー文字列（'maj' / 'penta_min' など）は localStorage に保存されるので変更しないこと。
 */

export interface ChordTypeDef {
  /** ルートからの音程（半音）。9th などは 12 を超える */
  readonly intervals: readonly number[];
  /** ボタンのラベル */
  readonly label: string;
  /** コード名の接尾辞（C + 'm7' → Cm7） */
  readonly symbol: string;
}

export const CHORD_TYPES = {
  maj: { intervals: [0, 4, 7], label: 'Major', symbol: '' },
  min: { intervals: [0, 3, 7], label: 'Minor', symbol: 'm' },
  '7': { intervals: [0, 4, 7, 10], label: 'Dom 7', symbol: '7' },
  maj7: { intervals: [0, 4, 7, 11], label: 'Maj 7', symbol: 'M7' },
  min7: { intervals: [0, 3, 7, 10], label: 'Min 7', symbol: 'm7' },
  dim: { intervals: [0, 3, 6], label: 'Dim', symbol: '°' },
  dim7: { intervals: [0, 3, 6, 9], label: 'Dim 7', symbol: '°7' },
  aug: { intervals: [0, 4, 8], label: 'Aug', symbol: '+' },
  m7b5: { intervals: [0, 3, 6, 10], label: 'Half-Dim', symbol: 'ø7' },
  sus2: { intervals: [0, 2, 7], label: 'Sus2', symbol: 'sus2' },
  sus4: { intervals: [0, 5, 7], label: 'Sus4', symbol: 'sus4' },
  add9: { intervals: [0, 4, 7, 14], label: 'Add9', symbol: 'add9' },
  '9': { intervals: [0, 4, 7, 10, 14], label: 'Dom 9', symbol: '9' },
  maj9: { intervals: [0, 4, 7, 11, 14], label: 'Maj 9', symbol: 'M9' },
  min9: { intervals: [0, 3, 7, 10, 14], label: 'Min 9', symbol: 'm9' },
  '6': { intervals: [0, 4, 7, 9], label: 'Maj 6', symbol: '6' },
  min6: { intervals: [0, 3, 7, 9], label: 'Min 6', symbol: 'm6' },
} as const satisfies Record<string, ChordTypeDef>;

export type ChordTypeKey = keyof typeof CHORD_TYPES;

export const CHORD_TYPE_KEYS = Object.keys(CHORD_TYPES) as ChordTypeKey[];

export function isChordTypeKey(value: unknown): value is ChordTypeKey {
  return typeof value === 'string' && Object.hasOwn(CHORD_TYPES, value);
}

export function chordTypeDef(key: ChordTypeKey): ChordTypeDef {
  return CHORD_TYPES[key];
}

export interface ScaleDef {
  readonly intervals: readonly number[];
  readonly label: string;
}

export const SCALES = {
  major: { intervals: [0, 2, 4, 5, 7, 9, 11], label: 'Major' },
  minor: { intervals: [0, 2, 3, 5, 7, 8, 10], label: 'Nat Minor' },
  dorian: { intervals: [0, 2, 3, 5, 7, 9, 10], label: 'Dorian' },
  mixolydian: { intervals: [0, 2, 4, 5, 7, 9, 10], label: 'Mixolydian' },
  penta_maj: { intervals: [0, 2, 4, 7, 9], label: 'Penta Maj' },
  penta_min: { intervals: [0, 3, 5, 7, 10], label: 'Penta Min' },
  blues: { intervals: [0, 3, 5, 6, 7, 10], label: 'Blues' },
} as const satisfies Record<string, ScaleDef>;

export type ScaleKey = keyof typeof SCALES;

export const SCALE_KEYS = Object.keys(SCALES) as ScaleKey[];

export function isScaleKey(value: unknown): value is ScaleKey {
  return typeof value === 'string' && Object.hasOwn(SCALES, value);
}

export function scaleDef(key: ScaleKey): ScaleDef {
  return SCALES[key];
}

/** メジャースケールの構成音（キー推定・カポの自動選択の基準） */
export const MAJOR_SCALE_INTERVALS: readonly number[] = SCALES.major.intervals;

/** ルートからの音程（半音）→ 度数の表記。範囲外は `+n` で表示する */
export const INTERVAL_NAMES = [
  'R',
  'b2',
  '2',
  'b3',
  '3',
  '4',
  '#4',
  '5',
  'b6',
  '6',
  'b7',
  '7',
  '(8)',
  'b9',
  '9',
] as const;

export function intervalName(semitones: number): string {
  return INTERVAL_NAMES[semitones] ?? `+${semitones}`;
}

export const INVERSION_LABELS = ['Root', '1st', '2nd', '3rd', '4th'] as const;

/** メジャー / マイナーの相対調の関係（A マイナーの主音は C メジャーの 3 半音下） */
export const RELATIVE_MAJOR_OFFSET = 3;
