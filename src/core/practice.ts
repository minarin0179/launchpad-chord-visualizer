import type { ChordSpec } from './chord';
import { padNote } from './grid';
import { mod12, nearestAtOrAbove, type MidiNote } from './pitch';

/**
 * 練習モードの基準パッド（下から 3 段目・左から 3 列目。デフォルト配置で C3）。
 * ここから 1 オクターブ以内にルート（分数コードはベース）を置く。
 */
export const PRACTICE_ANCHOR = { row: 2, col: 2 } as const;

export type VoicingRole = 'root' | 'chord' | 'bass';

/**
 * 練習モードで光らせるボイシング（MIDI ノート番号 → 役割）。
 * 色は音名ではなく音の高さごとの役割で決まる。
 *
 * - 通常: ルートを基準パッドから 1 オクターブ以内に置き、基本形で積む（9th などはオクターブを超えたまま）
 * - 分数コード: ベースを同じ範囲に置き、残りの構成音をベースのすぐ上に密集して積む（C/E → E G C）
 *
 * カポ・オクターブで baseNote が動くと範囲も一緒に動く（形は固定）。
 */
export function practiceVoicing(baseNote: MidiNote, chord: ChordSpec): Map<MidiNote, VoicingRole> {
  const anchor = padNote(baseNote, PRACTICE_ANCHOR.row, PRACTICE_ANCHOR.col);
  const roleOf = (interval: number): VoicingRole => (interval === 0 ? 'root' : 'chord');

  if (chord.bass !== null) {
    const bass = nearestAtOrAbove(chord.bass, anchor);
    const notes = new Map<MidiNote, VoicingRole>([[bass, 'bass']]);
    for (const interval of chord.intervals) {
      const pc = mod12(chord.root + interval);
      if (pc !== chord.bass) notes.set(nearestAtOrAbove(pc, bass + 1), roleOf(interval));
    }
    return notes;
  }
  const root = nearestAtOrAbove(chord.root, anchor);
  return new Map(chord.intervals.map((interval) => [root + interval, roleOf(interval)]));
}
