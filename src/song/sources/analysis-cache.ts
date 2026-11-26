/**
 * 解析結果の保存（localStorage の `chord-analyzer:v2:<YouTube の動画 ID>`）。
 * analyze.html が保存し、Song バーも読む。保存済みデータを読めなくなるので、既存フィールドの名前・意味は変えないこと。
 */
import { DEFAULT_DECODE_OPTIONS, decodeChords, isVocabulary } from '../../analyzer/decode';
import type { DecodeOptions, Features } from '../../analyzer/types';
import { ANALYSIS_CACHE_PREFIX, analysisCacheKey } from '../../config/storage-keys';
import { MS_PER_SECOND } from '../../config/timing';
import { nextChordIndices } from '../../core/segments';
import {
  listKeys,
  readJson,
  removeKey,
  writeJson,
  type KeyValueStorage,
} from '../../platform/storage';
import type { ChordSource } from '../types';

/** 特徴量の出所 */
export type AnalysisOrigin = 'scan' | 'file';

export interface AnalysisCache {
  /** 動画時刻にマップ済みの特徴量（Songle しか表示していなければ null） */
  features: Features | null;
  source: AnalysisOrigin | null;
  /** true = 解析結果ではなく Songle を表示中 */
  useSongle: boolean;
  /** コード進行の時刻補正（ms） */
  offsetMs: number;
  capo: number;
  capoAuto: boolean;
  /** 保存した時刻（Date.now()） */
  savedAt: number;
  /** 解析ページで調整したデコード設定（旧バージョンの保存データには無い） */
  decodeOptions?: Partial<DecodeOptions>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every(isNumber);
const isChroma = (value: unknown): value is number[][] =>
  Array.isArray(value) && value.every(isNumberArray);

function parseFeatures(raw: unknown): Features | null {
  if (!isRecord(raw) || !isRecord(raw.treble) || !isRecord(raw.bass)) return null;
  const { duration, tempo, bounds, energy, treble, bass } = raw;
  const valid =
    isNumber(duration) &&
    isNumberArray(bounds) &&
    isNumberArray(energy) &&
    isChroma(treble.mid) &&
    isChroma(bass.mid) &&
    isChroma(bass['mid-h']);
  if (!valid) return null;
  return {
    ...(raw as unknown as Features),
    tempo: isNumber(tempo) ? tempo : 0,
    sideAvailable: raw.sideAvailable === true,
  };
}

function parseDecodeOptions(raw: unknown): Partial<DecodeOptions> | undefined {
  if (!isRecord(raw)) return undefined;
  const options: Partial<DecodeOptions> = {};
  if (isVocabulary(raw.vocabulary)) options.vocabulary = raw.vocabulary;
  for (const key of ['selfTransition', 'bassWeight', 'keyBonus', 'beta'] as const) {
    if (isNumber(raw[key])) options[key] = raw[key];
  }
  for (const key of ['centerCut', 'hpss', 'melody'] as const) {
    if (typeof raw[key] === 'boolean') options[key] = raw[key];
  }
  return options;
}

/** 保存データを検証して読む（壊れていれば null） */
export function parseAnalysisCache(raw: unknown): AnalysisCache | null {
  if (!isRecord(raw)) return null;
  const decodeOptions = parseDecodeOptions(raw.decodeOptions);
  return {
    features: parseFeatures(raw.features),
    source: raw.source === 'scan' || raw.source === 'file' ? raw.source : null,
    useSongle: raw.useSongle === true,
    offsetMs: isNumber(raw.offsetMs) ? raw.offsetMs : 0,
    capo: isNumber(raw.capo) ? raw.capo : 0,
    capoAuto: raw.capoAuto !== false,
    savedAt: isNumber(raw.savedAt) ? raw.savedAt : 0,
    ...(decodeOptions && { decodeOptions }),
  };
}

export function loadAnalysisCache(storage: KeyValueStorage, videoId: string): AnalysisCache | null {
  return parseAnalysisCache(readJson(storage, analysisCacheKey(videoId)));
}

/**
 * 保存する。容量が足りなければ、他の動画の古い解析結果から順に消して空きを作る。
 * @returns 保存できたら true
 */
export function saveAnalysisCache(
  storage: KeyValueStorage,
  videoId: string,
  cache: AnalysisCache,
): boolean {
  const key = analysisCacheKey(videoId);
  if (writeJson(storage, key, cache)) return true;
  const others = listKeys(storage)
    .filter((other) => other.startsWith(ANALYSIS_CACHE_PREFIX) && other !== key)
    .map((other) => ({
      key: other,
      savedAt: parseAnalysisCache(readJson(storage, other))?.savedAt ?? 0,
    }))
    .sort((a, b) => a.savedAt - b.savedAt);
  for (const other of others) {
    removeKey(storage, other.key);
    if (writeJson(storage, key, cache)) return true;
  }
  return false;
}

export const ANALYSIS_ORIGIN_LABEL: Record<AnalysisOrigin, string> = {
  scan: 'tab scan',
  file: 'audio file',
};

/** 解析結果が Song バーで優先されるか（解析ページで「Songle ではなく解析結果を表示中」のまま保存した） */
export function prefersAnalysis(cache: AnalysisCache): boolean {
  return cache.features !== null && !cache.useSongle;
}

/** 保存済みの特徴量を、解析ページで調整した設定でデコードしてコード進行のソースにする */
export function analysisSource(cache: AnalysisCache): ChordSource | null {
  const { features } = cache;
  if (!features) return null;
  try {
    const { key, tempo, segments } = decodeChords(features, {
      ...DEFAULT_DECODE_OPTIONS,
      ...cache.decodeOptions,
    });
    return {
      id: 'analysis',
      label: `Analysis (${cache.source ? ANALYSIS_ORIGIN_LABEL[cache.source] : 'saved'})`,
      key,
      tempo: tempo > 0 ? tempo : null,
      segments,
      timing: { duration: features.duration, bounds: features.bounds },
      offsetSec: cache.offsetMs / MS_PER_SECOND,
      nextChord: nextChordIndices(segments),
    };
  } catch {
    // 保存データが想定外の形でも Song バーは Songle だけで動かす
    return null;
  }
}
