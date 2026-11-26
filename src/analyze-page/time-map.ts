/** 録音中に記録した対応点: 録音のフレーム番号 ↔ 動画の再生時刻（秒） */
export interface Anchor {
  readonly frame: number;
  readonly video: number;
}

/** ずれを中央値でならす窓（前 3 点〜後 3 点） */
const MEDIAN_BEFORE = 3;
const MEDIAN_AFTER = 4;

/**
 * 録音上の時刻（秒）→ 動画の時刻（秒）への変換を作る。
 *
 * 動画時刻 = rate × 録音時刻 + ずれ。ずれは対応点ごとに求めて中央値でならし、対応点の間は直線でつなぐ
 * （バッファリングで動画が止まった区間も、前後の対応点の間で吸収される）。
 */
export function buildTimeMap(
  anchors: readonly Anchor[],
  startFrame: number,
  sampleRate: number,
  rate: number,
): (recordedSec: number) => number {
  const recorded = anchors.map((anchor) => (anchor.frame - startFrame) / sampleRate);
  const rawOffsets = anchors.map((anchor, i) => anchor.video - rate * recorded[i]);
  const offsets = rawOffsets.map((_, i) => {
    const window = rawOffsets
      .slice(Math.max(0, i - MEDIAN_BEFORE), i + MEDIAN_AFTER)
      .sort((a, b) => a - b);
    return window[window.length >> 1];
  });
  const lastOffset = offsets.at(-1) ?? 0;

  return (t) => {
    if (recorded.length === 0 || t <= recorded[0]) return rate * t + (offsets.at(0) ?? 0);
    for (let i = 1; i < recorded.length; i++) {
      if (t <= recorded[i]) {
        const ratio = (t - recorded[i - 1]) / (recorded[i] - recorded[i - 1] || 1);
        return rate * t + offsets[i - 1] + ratio * (offsets[i] - offsets[i - 1]);
      }
    }
    return rate * t + lastOffset;
  };
}

/** 拍間隔の標準偏差（ms）。一定テンポの曲で大きければ、ビート追跡か時刻の対応が揺れている */
export function beatJitterMs(bounds: readonly number[]): number | null {
  const MS = 1000;
  const intervals: number[] = [];
  // bounds の先頭（0）と末尾（曲の長さ）は拍ではない
  for (let i = 2; i < bounds.length - 1; i++) intervals.push(bounds[i] - bounds[i - 1]);
  if (intervals.length < 2) return null;
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  return Math.round(Math.sqrt(variance) * MS);
}

/** t 以降の最初の拍の index（bounds の先頭と末尾は拍ではないので除く） */
export function firstBeatAfter(bounds: readonly number[], t: number): number {
  let lo = 1;
  let hi = bounds.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bounds[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
