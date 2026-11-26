import { chordLabel, chordPitchClasses, type ChordSpec } from './chord';
import { keyFromProfile, type Key } from './key';
import { SEMITONES } from './pitch';

/** コード進行の 1 区間 */
export interface Segment {
  /** 開始・終了時刻（秒、再生メディア基準） */
  readonly start: number;
  readonly end: number;
  /** null = N.C.（コードなし） */
  readonly chord: ChordSpec | null;
  /** 取得元の表記のままの名前（"Eb" / "C#m7" / "N.C."） */
  readonly label: string;
  /** 区間の拍数（解析結果のみ） */
  readonly beats?: number;
}

/** 曲の時間構造 */
export interface Timing {
  /** 曲の長さ（秒） */
  readonly duration: number;
  /** [0, 拍 1, 拍 2, …, duration]（先頭 0 と末尾 duration は拍ではない） */
  readonly bounds: readonly number[];
}

/** 時刻 t を含むセグメントの index（二分探索。どの区間にも入らなければ -1） */
export function findSegmentIndex(segments: readonly Segment[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < segments[mid].start) hi = mid - 1;
    else if (t >= segments[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** カポ適用後の表示名（N.C. は取得元の表記のまま） */
export function segmentLabel(segment: Segment, capo = 0): string {
  return segment.chord ? chordLabel(segment.chord, capo) : segment.label;
}

/** これより短いすき間は連続した区間とみなす（秒） */
const MERGE_GAP_SEC = 0.01;

/** 同じコードが続く区間を 1 つにまとめる（タイムラインが細切れにならないように） */
export function mergeAdjacentSegments(segments: readonly Segment[]): Segment[] {
  const merged: Segment[] = [];
  for (const segment of segments) {
    const prev = merged.at(-1);
    if (prev?.label === segment.label && Math.abs(prev.end - segment.start) < MERGE_GAP_SEC) {
      merged[merged.length - 1] = { ...prev, end: segment.end };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

/**
 * 各セグメントについて「それより後で最初にコードがある区間」の index（無ければ -1）。
 * NEXT 表示を毎フレーム線形探索しないための前計算。末尾に「曲の最後より後」用の -1 を持たない点に注意:
 * index -1（曲の頭より前）に対する次のコードは firstChordIndex を使う。
 */
export function nextChordIndices(segments: readonly Segment[]): number[] {
  const next = new Array<number>(segments.length).fill(-1);
  let upcoming = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    next[i] = upcoming;
    if (segments[i].chord) upcoming = i;
  }
  return next;
}

/** 分数コードのベース音がキー推定に寄与する重み（構成音 = 1） */
const BASS_KEY_WEIGHT = 0.5;

/** コードの構成音を演奏時間で重み付けしたピッチクラス分布から、曲のキーを推定する */
export function estimateKeyFromSegments(segments: readonly Segment[]): Key {
  const profile = new Array<number>(SEMITONES).fill(0);
  for (const { chord, start, end } of segments) {
    if (!chord) continue;
    const duration = end - start;
    for (const pc of chordPitchClasses(chord)) profile[pc] += duration;
    if (chord.bass !== null) profile[chord.bass] += duration * BASS_KEY_WEIGHT;
  }
  return keyFromProfile(profile);
}
