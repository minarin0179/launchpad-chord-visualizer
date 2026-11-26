import { chordOf, makeChord, NO_CHORD_LABEL, type ChordSpec } from '../../core/chord';
import { mod12, type PitchClass } from '../../core/pitch';
import type { ChordTypeKey } from '../../core/theory';

/** Songle のコード名を解釈した結果 */
export interface ParsedChord {
  /** null = N.C. または解釈できない名前 */
  readonly chord: ChordSpec | null;
  /** Songle の表記そのまま（N.C. は "N.C."） */
  readonly label: string;
}

const NATURAL_PITCH = new Map<string, PitchClass>([
  ['C', 0],
  ['D', 2],
  ['E', 4],
  ['F', 5],
  ['G', 7],
  ['A', 9],
  ['B', 11],
]);

/** Songle のコード接尾辞 → CHORD_TYPES のキー */
const SUFFIX_TO_TYPE = new Map<string, ChordTypeKey>([
  ['', 'maj'],
  ['m', 'min'],
  ['7', '7'],
  ['M7', 'maj7'],
  ['maj7', 'maj7'],
  ['m7', 'min7'],
  ['dim', 'dim'],
  ['dim7', 'dim7'],
  ['aug', 'aug'],
  ['+', 'aug'],
  ['m7b5', 'm7b5'],
  ['m7-5', 'm7b5'],
  ['sus2', 'sus2'],
  ['sus4', 'sus4'],
  ['sus', 'sus4'],
  ['add9', 'add9'],
  ['9', '9'],
  ['M9', 'maj9'],
  ['m9', 'min9'],
  ['6', '6'],
  ['m6', 'min6'],
]);

/** CHORD_TYPES に無い型（表示は Songle の表記のまま、構成音だけ定義） */
const EXTRA_INTERVALS = new Map<string, readonly number[]>([
  ['mM7', [0, 3, 7, 11]],
  ['7sus4', [0, 5, 7, 10]],
  ['aug7', [0, 4, 8, 10]],
  ['7b5', [0, 4, 6, 10]],
]);

/** Songle が「コードなし」に使う名前 */
const NO_CHORD_NAME = 'N';
const PITCH_NAME = /^([A-G])([#b]?)$/;
/** ルート音 + 接尾辞 + 任意の「/ベース音」。ベース音として読めない「/…」は接尾辞の一部とみなす */
const CHORD_NAME = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/;
/** 先頭が m（maj ではない）ならマイナー系 */
const MINOR_SUFFIX = /^m(?!aj)/;

function parsePitch(name: string): PitchClass | null {
  const match = PITCH_NAME.exec(name);
  const natural = match && NATURAL_PITCH.get(match[1]);
  if (!match || natural == null) return null;
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return mod12(natural + accidental);
}

/**
 * Songle のコード名（"Eb" / "C#m7" / "Ebsus2/Ab" / "N"）を解釈する。
 * 未知の型は、先頭が m ならマイナー三和音、それ以外はメジャー三和音として扱い、表記はそのまま残す。
 */
export function parseSongleChord(name: string): ParsedChord {
  if (!name || name === NO_CHORD_NAME) return { chord: null, label: NO_CHORD_LABEL };
  const match = CHORD_NAME.exec(name);
  const root = match ? parsePitch(match[1]) : null;
  if (!match || root === null) return { chord: null, label: name };

  const suffix = match[2];
  const bass = match[3] ? parsePitch(match[3]) : null;
  const type = SUFFIX_TO_TYPE.get(suffix);
  if (type) return { chord: chordOf(root, type, bass), label: name };

  const triad: ChordTypeKey = MINOR_SUFFIX.test(suffix) ? 'min' : 'maj';
  const intervals = EXTRA_INTERVALS.get(suffix) ?? chordOf(root, triad).intervals;
  return { chord: makeChord(root, triad, intervals, suffix, bass), label: name };
}
