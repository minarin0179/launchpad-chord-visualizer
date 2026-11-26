import type { Key } from '../core/key';
import type { Segment } from '../core/segments';
import type { VOCABULARIES } from './constants';

/** 高音域クロマのバリアント名（mid = L+R、side = L−R、-h = HPSS、-m = メロディ抑制）。保存形式なので変更不可 */
export type TrebleVariant =
  'mid' | 'mid-h' | 'mid-m' | 'mid-h-m' | 'side' | 'side-h' | 'side-m' | 'side-h-m';

export type BassVariant = 'mid' | 'mid-h';

/** ビートごとの 12 次元クロマ */
export type BeatChroma = number[][];

/**
 * 曲全体から抽出したビート同期の特徴量。
 * localStorage（chord-analyzer:v2:<videoId>）に JSON で保存されるので、フィールド名・意味を変えないこと。
 */
export interface Features {
  /** 曲の長さ（秒）= bounds の末尾 */
  duration: number;
  /** BPM */
  tempo: number;
  /** [0, 拍 1, …, duration]（先頭 0 と末尾 duration は拍ではない） */
  bounds: number[];
  /** サイド成分（L−R）があるか（モノラル音源は false） */
  sideAvailable: boolean;
  /** side* は sideAvailable のときだけ存在する */
  treble: Partial<Record<TrebleVariant, BeatChroma>>;
  bass: Record<BassVariant, BeatChroma>;
  /** ビートごとのエネルギー（無音判定用） */
  energy: number[];
}

export type Vocabulary = keyof typeof VOCABULARIES;

export interface DecodeOptions {
  /** 検出するコードの種類 */
  vocabulary: Vocabulary;
  /** ビートごとに同じコードに留まる確率 */
  selfTransition: number;
  /** 低音がルートと一致することへの加点 */
  bassWeight: number;
  /** 推定キーのダイアトニックコードへの加点 */
  keyBonus: number;
  /** スコア → 対数尤度のスケール */
  beta: number;
  /** 高音域クロマを L−R（サイド成分）から取る = 中央定位のボーカルを除去 */
  centerCut: boolean;
  /** 打撃音を除去した持続音成分からクロマを取る */
  hpss: boolean;
  /** 各フレームで突出した主旋律の音を除去 */
  melody: boolean;
}

export interface DecodeResult {
  key: Key;
  tempo: number;
  /** 実際に使った高音域クロマ */
  trebleKey: TrebleVariant;
  segments: Segment[];
}

/** 特徴量抽出の進捗フェーズ（この順に進む） */
export const ANALYSIS_PHASES = [
  'resample',
  'onset',
  'beats',
  'bass',
  'chroma',
  'chromaSide',
] as const;
export type AnalysisPhase = (typeof ANALYSIS_PHASES)[number];

export type ProgressCallback = (phase: AnalysisPhase, progress: number) => void;

export interface ExtractOptions {
  /** 録音の再生速度（2 倍速でスキャンしたなら 2） */
  timeScale?: number;
}
