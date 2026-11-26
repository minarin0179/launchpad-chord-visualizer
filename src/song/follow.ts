import { PRACTICE_LEAD_BEATS, PREVIEW_LEAD_BEATS } from '../config/timing';
import { findSegmentIndex, type Segment } from '../core/segments';
import { NO_SEGMENT, type Cursor } from './types';

export interface CursorInput {
  readonly segments: readonly Segment[];
  /** コード進行上の時刻（秒） */
  readonly t: number;
  /** 1 拍の長さ（秒） */
  readonly beatSec: number;
  readonly follow: boolean;
  readonly practice: boolean;
  readonly playing: boolean;
}

export const NO_CURSOR: Cursor = { segmentIndex: NO_SEGMENT, previewIndex: null };

/** 練習モードは少し先のコードを光らせて、切り替わりに手が間に合うようにする */
export function litTime(t: number, beatSec: number, practice: boolean): number {
  return practice ? t + PRACTICE_LEAD_BEATS * beatSec : t;
}

/**
 * 再生位置から、今のコードの区間と予告する区間を決める。
 *
 * 予告は FOLLOW 中・再生中のみ。次の区間がコードあり かつ 今と別のコードで、
 * 開始まで PREVIEW_LEAD_BEATS 拍以内のときに出す。
 */
export function computeCursor({
  segments,
  t,
  beatSec,
  follow,
  practice,
  playing,
}: CursorInput): Cursor {
  const lit = litTime(t, beatSec, practice);
  const segmentIndex = findSegmentIndex(segments, lit);
  if (!follow || !playing) return { segmentIndex, previewIndex: null };

  // 区間のすき間・曲の頭より前（segmentIndex = -1）では、次に始まる区間を探す
  const nextIndex =
    segmentIndex === NO_SEGMENT ? segments.findIndex((s) => s.start > lit) : segmentIndex + 1;
  const next = nextIndex === NO_SEGMENT ? undefined : segments.at(nextIndex);
  if (!next?.chord) return { segmentIndex, previewIndex: null };
  const until = next.start - lit;
  const soon = until > 0 && until <= PREVIEW_LEAD_BEATS * beatSec;
  const differs = segmentIndex === NO_SEGMENT || next.label !== segments[segmentIndex].label;
  return { segmentIndex, previewIndex: soon && differs ? nextIndex : null };
}
