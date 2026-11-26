import { DEFAULT_DECODE_OPTIONS, decodeChords } from '../analyzer/decode';
import type { DecodeOptions, Features, TrebleVariant } from '../analyzer/types';
import { capoPosition, suggestCapo } from '../core/capo';
import type { Key } from '../core/key';
import type { Segment, Timing } from '../core/segments';
import type { AnalysisCache, AnalysisOrigin } from '../song/sources/analysis-cache';
import type { SongleSong } from '../song/sources/songle-client';

export type StatusKind = '' | 'busy' | 'ok' | 'error';

/** 解析ページで調整できるデコード設定（keyBonus / beta は既定値のまま） */
export type DecodeSettings = Pick<
  DecodeOptions,
  'vocabulary' | 'selfTransition' | 'bassWeight' | 'centerCut' | 'hpss' | 'melody'
>;

export const DEFAULT_DECODE_SETTINGS: DecodeSettings = {
  vocabulary: DEFAULT_DECODE_OPTIONS.vocabulary,
  selfTransition: DEFAULT_DECODE_OPTIONS.selfTransition,
  bassWeight: DEFAULT_DECODE_OPTIONS.bassWeight,
  centerCut: DEFAULT_DECODE_OPTIONS.centerCut,
  hpss: DEFAULT_DECODE_OPTIONS.hpss,
  melody: DEFAULT_DECODE_OPTIONS.melody,
};

export interface AnalyzeState {
  readonly videoId: string | null;
  readonly playerReady: boolean;
  /** 読み込み・解析中（操作を受け付けない） */
  readonly busy: boolean;
  readonly scanning: boolean;
  readonly status: { readonly text: string; readonly kind: StatusKind };
  /** 0〜1 */
  readonly progress: number;
  /** 動画時刻にマップ済みの特徴量 */
  readonly features: Features | null;
  readonly origin: AnalysisOrigin | null;
  /** Songle から取得したコード進行（未取得 / 未登録なら null） */
  readonly songle: SongleSong | null;
  /** true の間は解析結果ではなく Songle のコード進行を表示する */
  readonly useSongle: boolean;
  readonly capo: number;
  /** true の間は表示するコード進行に最も合うカポを自動で選ぶ */
  readonly capoAuto: boolean;
  /** コード進行の時刻補正（ms） */
  readonly offsetMs: number;
  readonly decode: DecodeSettings;
  readonly beatClick: boolean;
}

export const INITIAL_STATE: AnalyzeState = {
  videoId: null,
  playerReady: false,
  busy: false,
  scanning: false,
  status: {
    text: 'YouTube の URL を入力して LOAD（Songle 登録曲はコード進行を自動取得）',
    kind: '',
  },
  progress: 0,
  features: null,
  origin: null,
  songle: null,
  useSongle: false,
  capo: 0,
  capoAuto: true,
  offsetMs: 0,
  decode: DEFAULT_DECODE_SETTINGS,
  beatClick: false,
};

/** 状態の一部を上書きする */
export type Patch = Partial<AnalyzeState>;

export function reduce(state: AnalyzeState, patch: Patch): AnalyzeState {
  return { ...state, ...patch };
}

/** 表示するコード進行 */
export interface Result {
  readonly key: Key;
  readonly tempo: number | null;
  readonly segments: readonly Segment[];
  readonly timing: Timing;
  /** 解析結果のときに使った高音域クロマ（Songle 表示中は null） */
  readonly trebleKey: TrebleVariant | null;
  readonly fromSongle: boolean;
}

function computeResult(
  features: Features | null,
  songle: SongleSong | null,
  useSongle: boolean,
  decode: DecodeSettings,
): Result | null {
  if (useSongle && songle) {
    const { key, tempo, segments, timing } = songle.source;
    return { key, tempo, segments, timing, trebleKey: null, fromSongle: true };
  }
  if (!features) return null;
  const { key, tempo, segments, trebleKey } = decodeChords(features, decode);
  const timing = { duration: features.duration, bounds: features.bounds };
  return { key, tempo: tempo > 0 ? tempo : null, segments, timing, trebleKey, fromSongle: false };
}

let memo: { inputs: readonly unknown[]; result: Result | null } | null = null;

/** 表示するコード進行（入力が変わったときだけ計算し直す） */
export function selectResult(state: AnalyzeState): Result | null {
  const inputs = [state.features, state.songle, state.useSongle, state.decode];
  if (!memo?.inputs.every((input, i) => input === inputs[i])) {
    memo = {
      inputs,
      result: computeResult(state.features, state.songle, state.useSongle, state.decode),
    };
  }
  return memo.result;
}

/** 表示に使うカポ位置（AUTO のときはコード進行から選ぶ） */
export function selectCapo(state: AnalyzeState): number {
  const result = selectResult(state);
  return state.capoAuto && result ? suggestCapo(result.segments) : capoPosition(state.capo);
}

/** localStorage に保存する形 */
export function toCache(state: AnalyzeState, now: number): AnalysisCache {
  return {
    features: state.features,
    source: state.origin,
    useSongle: state.useSongle,
    offsetMs: state.offsetMs,
    capo: selectCapo(state),
    capoAuto: state.capoAuto,
    savedAt: now,
    decodeOptions: state.decode,
  };
}

/** 保存データから復元する状態 */
export function fromCache(cache: AnalysisCache | null): Patch {
  return {
    features: cache?.features ?? null,
    origin: cache?.source ?? null,
    offsetMs: cache?.offsetMs ?? 0,
    capo: cache?.capo ?? 0,
    capoAuto: cache?.capoAuto ?? true,
    decode: { ...DEFAULT_DECODE_SETTINGS, ...pickDecodeSettings(cache?.decodeOptions) },
  };
}

function pickDecodeSettings(options: Partial<DecodeOptions> | undefined): Partial<DecodeSettings> {
  if (!options) return {};
  const { vocabulary, selfTransition, bassWeight, centerCut, hpss, melody } = options;
  const picked = { vocabulary, selfTransition, bassWeight, centerCut, hpss, melody };
  return Object.fromEntries(Object.entries(picked).filter(([, value]) => value !== undefined));
}
