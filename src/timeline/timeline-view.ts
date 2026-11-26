import { HUE_PER_SEMITONE, LOOP_MARKER_WIDTH, PLAYHEAD_RATIO } from '../config/timeline';
import { mod12 } from '../core/pitch';
import { segmentLabel, type Segment } from '../core/segments';
import type { Loop } from '../song/types';

export interface TimelineElements {
  /** 表示窓（幅の基準・クリックの基準） */
  readonly viewport: HTMLElement;
  /** 横に流れる帯（曲全体の長さ） */
  readonly strip: HTMLElement;
  /** コードのブロックを入れる要素 */
  readonly blocks: HTMLElement;
  /** A-B ループの区間表示（無ければ表示しない） */
  readonly loop?: HTMLElement;
}

export interface TimelineOptions {
  /** 1 秒あたりの幅（px） */
  readonly pxPerSec: number;
  /** ブロックの CSS クラス（N.C. には ` nc`、今の区間には ` active` が付く） */
  readonly blockClass: string;
}

export interface TimelineView {
  /** コード進行を描き直す */
  render(segments: readonly Segment[], durationSec: number, capo: number): void;
  setActive(index: number): void;
  setLoop(loop: Loop): void;
  /** 再生位置に合わせて帯を動かす（毎フレーム） */
  frame(t: number): void;
  /** クリック位置の時刻（現在の再生位置 t からの相対で求める） */
  timeAtClientX(clientX: number, t: number): number;
}

/** コードのルート音（カポ適用後の形）ごとの色相 */
export function segmentHue(segment: Segment, capo: number): string {
  return String(mod12((segment.chord?.root ?? 0) - capo) * HUE_PER_SEMITONE);
}

/**
 * コード進行のタイムライン（Song バーと解析ページで共通）。
 * プレイヘッドは固定位置（幅の PLAYHEAD_RATIO）で、帯の方が流れる。
 */
export function createTimelineView(
  elements: TimelineElements,
  { pxPerSec, blockClass }: TimelineOptions,
): TimelineView {
  const { viewport, strip, blocks, loop: loopElement } = elements;
  let blockElements: HTMLElement[] = [];
  let active = -1;
  let width = viewport.clientWidth;
  new ResizeObserver(() => {
    width = viewport.clientWidth;
  }).observe(viewport);

  return {
    render(segments, durationSec, capo) {
      strip.style.width = `${durationSec * pxPerSec}px`;
      blockElements = segments.map((segment) => {
        const block = document.createElement('div');
        block.className = segment.chord ? blockClass : `${blockClass} nc`;
        block.style.left = `${segment.start * pxPerSec}px`;
        block.style.width = `${(segment.end - segment.start) * pxPerSec}px`;
        block.style.setProperty('--hue', segmentHue(segment, capo));
        block.textContent = segmentLabel(segment, capo);
        return block;
      });
      blocks.replaceChildren(...blockElements);
      const previous = active;
      active = -1;
      this.setActive(previous);
    },
    setActive(index) {
      if (index === active) return;
      // index -1 は「区間外」（Array.prototype.at の -1 = 末尾とは意味が違う）
      if (active >= 0) blockElements.at(active)?.classList.remove('active');
      if (index >= 0) blockElements.at(index)?.classList.add('active');
      active = index;
    },
    setLoop(loop) {
      if (!loopElement) return;
      loopElement.hidden = loop.kind === 'off';
      if (loop.kind === 'off') return;
      loopElement.style.left = `${loop.a * pxPerSec}px`;
      loopElement.style.width =
        loop.kind === 'ab' ? `${(loop.b - loop.a) * pxPerSec}px` : LOOP_MARKER_WIDTH;
      loopElement.classList.toggle('open', loop.kind === 'a');
    },
    frame(t) {
      strip.style.transform = `translateX(${width * PLAYHEAD_RATIO - t * pxPerSec}px)`;
    },
    timeAtClientX(clientX, t) {
      const rect = viewport.getBoundingClientRect();
      return t + (clientX - rect.left - rect.width * PLAYHEAD_RATIO) / pxPerSec;
    },
  };
}
