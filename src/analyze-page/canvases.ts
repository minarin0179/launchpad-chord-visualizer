import type { Features, TrebleVariant } from '../analyzer/types';
import { SEMITONES } from '../core/pitch';
import type { Timing } from '../core/segments';

/** canvas の幅の上限（px）。ブラウザの制限を超えないように */
const MAX_CANVAS_WIDTH = 16000;
const BEAT_COLOR = 'rgba(255, 255, 255, 0.7)';
/** クロマの色（--chord-color と同じ水色）。強さは不透明度で表す */
const CHROMA_RGB = '51, 221, 255';

function prepare(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  height: number,
): CanvasRenderingContext2D | null {
  canvas.width = Math.min(Math.ceil(cssWidth), MAX_CANVAS_WIDTH);
  canvas.height = height;
  canvas.style.width = `${cssWidth}px`;
  return canvas.getContext('2d');
}

/** 拍の位置を 1px の縦線で描く */
export function drawBeats(
  canvas: HTMLCanvasElement,
  timing: Timing | null,
  pxPerSec: number,
): void {
  if (!timing || timing.duration <= 0) {
    canvas.width = 0;
    return;
  }
  const ctx = prepare(canvas, timing.duration * pxPerSec, 1);
  if (!ctx) return;
  const scale = canvas.width / timing.duration;
  ctx.fillStyle = BEAT_COLOR;
  // bounds の先頭（0）と末尾（曲の長さ）は拍ではない
  for (const beat of timing.bounds.slice(1, -1)) ctx.fillRect(Math.floor(beat * scale), 0, 1, 1);
}

/** 選択中の分離設定のクロマを描く（下から C → B。分離の効き具合を目で確かめられる） */
export function drawChroma(
  canvas: HTMLCanvasElement,
  features: Features | null,
  variant: TrebleVariant | null,
  pxPerSec: number,
): void {
  const chroma = features && variant ? features.treble[variant] : undefined;
  if (!features || !chroma || features.duration <= 0) {
    canvas.width = 0;
    return;
  }
  const ctx = prepare(canvas, features.duration * pxPerSec, SEMITONES);
  if (!ctx) return;
  const scale = canvas.width / features.duration;
  chroma.forEach((beat, i) => {
    const max = Math.max(...beat) || 1;
    const x = features.bounds[i] * scale;
    const width = Math.max(1, (features.bounds[i + 1] - features.bounds[i]) * scale);
    beat.forEach((value, pc) => {
      // 弱い成分が目立たないよう 2 乗で強調する
      ctx.fillStyle = `rgba(${CHROMA_RGB}, ${(value / max) ** 2})`;
      ctx.fillRect(x, SEMITONES - 1 - pc, width, 1);
    });
  });
}
