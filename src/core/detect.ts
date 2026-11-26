import { mod12, noteName, SEMITONES, type MidiNote, type PitchClass } from './pitch';
import { CHORD_TYPES, CHORD_TYPE_KEYS, type ChordTypeKey } from './theory';

export interface DetectedChord {
  readonly root: PitchClass;
  readonly type: ChordTypeKey;
  /** 最低音がルートでないときのベース音 */
  readonly bass: PitchClass | null;
  /** 押さえている音がコードの構成音と過不足なく一致 */
  readonly exact: boolean;
  /** 例: "Am7/G" */
  readonly name: string;
}

/** コードとして検出するのに必要な最少の音数 */
const MIN_NOTES = 2;
/** 余分な音を含んでいても候補にするコードの最少構成音数（2 音のコードは何にでも含まれてしまう） */
const MIN_SUBSET_CHORD_SIZE = 3;
/** 表示する候補の最大数 */
export const MAX_DETECTED_CHORDS = 3;

interface Candidate extends DetectedChord {
  readonly size: number;
}

/**
 * 押さえている音からコードの候補を返す（最大 MAX_DETECTED_CHORDS 件）。
 * 優先順: 完全一致 → 構成音の少ないコード → 最低音がルートのコード。
 */
export function detectChords(notes: readonly MidiNote[]): DetectedChord[] {
  if (notes.length < MIN_NOTES) return [];
  const pressed = new Set(notes.map(mod12));
  const lowest = mod12(Math.min(...notes));
  const candidates: Candidate[] = [];

  for (const type of CHORD_TYPE_KEYS) {
    const { intervals, symbol } = CHORD_TYPES[type];
    for (let root = 0; root < SEMITONES; root++) {
      const tones = new Set(intervals.map((interval) => mod12(root + interval)));
      const containsAll = [...tones].every((pc) => pressed.has(pc));
      if (!containsAll) continue;
      const exact = pressed.size === tones.size;
      if (!exact && tones.size < MIN_SUBSET_CHORD_SIZE) continue;
      const bass = lowest === root ? null : lowest;
      candidates.push({
        root,
        type,
        bass,
        exact,
        size: tones.size,
        name: noteName(root) + symbol + (bass === null ? '' : `/${noteName(bass)}`),
      });
    }
  }

  // Array.prototype.sort は安定ソートなので、同順位は「コード種別の定義順 → ルートの低い順」のまま
  candidates.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      a.size - b.size ||
      Number(b.bass === null) - Number(a.bass === null),
  );
  return candidates
    .slice(0, MAX_DETECTED_CHORDS)
    .map(({ root, type, bass, exact, name }) => ({ root, type, bass, exact, name }));
}
