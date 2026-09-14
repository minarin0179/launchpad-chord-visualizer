// =====================
// Capo — 実音のコードをカポ分だけ下げて表示する
// カポ n のとき、表示 X を弾くと実音は X + n 半音になる → 表示 = 実音 - n
// =====================
import { NOTE_NAMES, CHORD_TYPES } from '../constants.js';

export const CAPO_POSITIONS = 12;  // 0〜11（12 で 1 オクターブ = 0 と同じ）

// AUTO の基準スケール（C メジャー = A ナチュラルマイナーと同じ構成音）
const REFERENCE_SCALE = new Set([0, 2, 4, 5, 7, 9, 11]);

function shiftPC(pc, capo) {
  return ((pc - capo) % 12 + 12) % 12;
}

// セグメントのカポ適用後の表示名（N.C. はそのまま）
export function chordLabel(segment, capo) {
  if (segment.root === null) return segment.label;
  return NOTE_NAMES[shiftPC(segment.root, capo)] + CHORD_TYPES[segment.type].symbol;
}

export function keyLabel(key, capo) {
  return NOTE_NAMES[shiftPC(key.root, capo)] + (key.mode === 'minor' ? 'm' : '');
}

// コード構成音のうち基準スケールに含まれる割合（演奏時間で重み付け、0〜1）
export function scaleFitRatio(segments, capo) {
  let inScale = 0, total = 0;
  for (const s of segments) {
    if (s.root === null) continue;
    const d = s.end - s.start;
    const pcs = new Set(CHORD_TYPES[s.type].intervals.map(iv => shiftPC(s.root + iv, capo)));
    for (const pc of pcs) {
      total += d;
      if (REFERENCE_SCALE.has(pc)) inScale += d;
    }
  }
  return total ? inScale / total : 0;
}

// 構成音が基準スケールに最も収まるカポ位置（同率なら低いカポを優先）
export function suggestCapo(segments) {
  let best = 0, bestRatio = -1;
  for (let capo = 0; capo < CAPO_POSITIONS; capo++) {
    const ratio = scaleFitRatio(segments, capo);
    if (ratio > bestRatio + 1e-9) { best = capo; bestRatio = ratio; }
  }
  return best;
}
