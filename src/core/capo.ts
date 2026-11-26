import { chordPitchClassesWithBass } from './chord';
import { mod12, SEMITONES } from './pitch';
import type { Segment } from './segments';
import { MAJOR_SCALE_INTERVALS } from './theory';

/**
 * カポ — 実音のコードをカポ分だけ下げた形で弾く。
 * カポ n のとき、形 X を弾くと実音は X + n 半音になる → 表示する形 = 実音 − n。
 */

/** カポ位置は 0〜11（12 で 1 オクターブ = 0 と同じ形） */
export const CAPO_POSITIONS = SEMITONES;

/** 累積のカポ量（負やオクターブ超えもある）を 0〜11 のカポ位置にする */
export function capoPosition(capo: number): number {
  return mod12(capo);
}

/** AUTO の基準スケール（C メジャー = A ナチュラルマイナーと同じ構成音） */
const REFERENCE_SCALE: ReadonlySet<number> = new Set(MAJOR_SCALE_INTERVALS);

/** 同率とみなす誤差（浮動小数の丸め誤差で順位が入れ替わらないように） */
const TIE_EPSILON = 1e-9;

/** カポ適用後のコード構成音のうち基準スケールに含まれる割合（演奏時間で重み付け、0〜1） */
export function scaleFitRatio(segments: readonly Segment[], capo: number): number {
  let inScale = 0;
  let total = 0;
  for (const { chord, start, end } of segments) {
    if (!chord) continue;
    const duration = end - start;
    const shapes = new Set(chordPitchClassesWithBass(chord).map((pc) => mod12(pc - capo)));
    for (const pc of shapes) {
      total += duration;
      if (REFERENCE_SCALE.has(pc)) inScale += duration;
    }
  }
  return total ? inScale / total : 0;
}

/** 構成音が基準スケールに最も収まるカポ位置（同率なら低いカポを優先） */
export function suggestCapo(segments: readonly Segment[]): number {
  let best = 0;
  let bestRatio = -1;
  for (let capo = 0; capo < CAPO_POSITIONS; capo++) {
    const ratio = scaleFitRatio(segments, capo);
    if (ratio > bestRatio + TIE_EPSILON) {
      best = capo;
      bestRatio = ratio;
    }
  }
  return best;
}
