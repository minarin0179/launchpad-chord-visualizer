import { mod12, noteName, type PitchClass } from './pitch';
import { chordTypeDef, intervalName, type ChordTypeKey } from './theory';

/**
 * 構成音まで確定したコード。
 * 手動で選んだコードも曲から来たコードもこの形にそろえる
 * （CHORD_TYPES に無い型は type に近い三和音、intervals / symbol に実際の値を持つ）。
 */
export interface ChordSpec {
  readonly root: PitchClass;
  readonly type: ChordTypeKey;
  /** ルートからの音程（半音）。先頭は 0 */
  readonly intervals: readonly number[];
  /** コード名の接尾辞 */
  readonly symbol: string;
  /** 分数コードのベース音（ルートと同じなら null） */
  readonly bass: PitchClass | null;
}

/** 画面と Launchpad に表示するコード（N.C. は none） */
export type EffectiveChord =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'chord';
      readonly spec: ChordSpec;
      /** 転回形（0 = 基本形）。曲から来たコードは常に 0 */
      readonly inversion: number;
      readonly origin: 'manual' | 'song';
    };

export const NO_CHORD: EffectiveChord = { kind: 'none' };

/** N.C. の表示名 */
export const NO_CHORD_LABEL = 'N.C.';

export function chordOf(
  root: PitchClass,
  type: ChordTypeKey,
  bass: PitchClass | null = null,
): ChordSpec {
  const def = chordTypeDef(type);
  return makeChord(root, type, def.intervals, def.symbol, bass);
}

export function makeChord(
  root: PitchClass,
  type: ChordTypeKey,
  intervals: readonly number[],
  symbol: string,
  bass: PitchClass | null,
): ChordSpec {
  return { root, type, intervals, symbol, bass: bass === root ? null : bass };
}

/** コードの構成音（ピッチクラス、ベース音は含まない） */
export function chordPitchClasses(chord: ChordSpec): PitchClass[] {
  return chord.intervals.map((interval) => mod12(chord.root + interval));
}

/** 構成音 + 分数コードのベース音 */
export function chordPitchClassesWithBass(chord: ChordSpec): PitchClass[] {
  const pcs = chordPitchClasses(chord);
  if (chord.bass !== null) pcs.push(chord.bass);
  return pcs;
}

export interface ChordTones {
  /** 構成音（基本形の順） */
  readonly all: readonly PitchClass[];
  /** 転回形の順（最低音が先頭） */
  readonly inverted: readonly PitchClass[];
  /** 最低音として強調する音（転回形の最低音 or 分数コードのベース）。無ければ null */
  readonly bass: PitchClass | null;
}

const NO_TONES: ChordTones = { all: [], inverted: [], bass: null };

/** 転回形の指定は showInversion が ON のときだけ反映する */
export function chordTones(chord: EffectiveChord, showInversion: boolean): ChordTones {
  if (chord.kind === 'none') return NO_TONES;
  const all = chordPitchClasses(chord.spec);
  const inversion = showInversion ? chord.inversion : 0;
  const inverted = [...all.slice(inversion), ...all.slice(0, inversion)];
  const invertedBass = inversion > 0 ? (inverted[0] ?? null) : null;
  return { all, inverted, bass: chord.spec.bass ?? invertedBass };
}

/** コード名（カポ分だけ下げた表示名。カポ n のとき表示 = 実音 − n） */
export function chordLabel(chord: ChordSpec, capo = 0): string {
  const bass = chord.bass === null ? '' : `/${noteName(chord.bass - capo)}`;
  return noteName(chord.root - capo) + chord.symbol + bass;
}

/** 転回形の数（= 構成音の数） */
export function inversionCount(chord: ChordSpec): number {
  return chord.intervals.length;
}

export interface ChordDisplay {
  /** 例: "C/E" */
  readonly name: string;
  /** 例: "E  G  C" */
  readonly notes: string;
  /** 例: "R — 3 — 5" */
  readonly intervals: string;
}

const NOTE_SEPARATOR = '  ';
const INTERVAL_SEPARATOR = ' — ';

export function chordDisplay(chord: EffectiveChord, showInversion: boolean): ChordDisplay {
  if (chord.kind === 'none') return { name: NO_CHORD_LABEL, notes: '', intervals: '' };
  const tones = chordTones(chord, showInversion);
  const bass = tones.bass === null ? '' : `/${noteName(tones.bass)}`;
  return {
    name: noteName(chord.spec.root) + chord.spec.symbol + bass,
    notes: tones.inverted.map(noteName).join(NOTE_SEPARATOR),
    intervals: chord.spec.intervals.map(intervalName).join(INTERVAL_SEPARATOR),
  };
}
