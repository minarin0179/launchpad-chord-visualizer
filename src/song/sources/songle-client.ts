/**
 * Songle（https://songle.jp/）の公開 API から、登録済みの曲のコード進行・ビートを取得する。
 * API は CORS 許可なのでブラウザから直接呼べる。時刻は再生メディア基準の ms で返ってくる。
 */
import { MS_PER_SECOND } from '../../config/timing';
import { SONGLE_API, SONGLE_SONG_PAGE } from '../../config/urls';
import {
  estimateKeyFromSegments,
  mergeAdjacentSegments,
  nextChordIndices,
  type Segment,
} from '../../core/segments';
import type { ChordSource, SongInfo } from '../types';
import { parseSongleChord } from './songle-chord';

export interface FetchOptions {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface SongleSong {
  readonly info: SongInfo;
  readonly source: ChordSource;
}

/** Songle の検索結果（メディアの判定前） */
export interface SongleSearchResult {
  readonly title: string;
  readonly artist: string;
  readonly permalink: string;
  readonly durationSec: number | null;
}

const HTTP_NOT_FOUND = 404;
const HTTP_URL = /^https?:\/\//i;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null;
}

/** ネストしたプロパティを安全にたどる */
function dig(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** 未登録（404）は null、それ以外のエラーは例外 */
async function getJson(
  url: string,
  { fetch: fetchFn = fetch, signal }: FetchOptions,
): Promise<unknown> {
  const response = await fetchFn(url, signal ? { signal } : undefined);
  if (response.status === HTTP_NOT_FOUND) return null;
  if (!response.ok) throw new Error(`Songle API ${response.status}`);
  return response.json() as Promise<unknown>;
}

const withUrl = (endpoint: string, url: string): string =>
  `${endpoint}?url=${encodeURIComponent(url)}`;

/** 曲情報。未登録なら null */
export async function fetchSongleInfo(
  songleUrl: string,
  options: FetchOptions = {},
): Promise<SongInfo | null> {
  const body = await getJson(
    `${SONGLE_API.song}?syntax=camelcase&url=${encodeURIComponent(songleUrl)}`,
    options,
  );
  const data = dig(body, 'data');
  const permalink = asString(dig(data, 'attributes', 'permalink'));
  if (!permalink) return null;
  const durationMs = asNumber(dig(data, 'attributes', 'durationTimeMs'));
  const page =
    asString(dig(data, 'relationships', 'uri', 'data', 'attributes', 'permalink')) ??
    SONGLE_SONG_PAGE + encodeURIComponent(permalink.replace(HTTP_URL, ''));
  return {
    title: asString(dig(data, 'attributes', 'name')) ?? '',
    artist: asString(dig(data, 'relationships', 'artist', 'data', 'attributes', 'name')) ?? '',
    durationSec: durationMs ? durationMs / MS_PER_SECOND : null,
    permalink,
    // 外部から来た URL をリンクに使うので、http(s) 以外（javascript: など）は捨てる
    pageUrl: HTTP_URL.test(page) ? page : null,
  };
}

/** キーワード検索（曲名・アーティスト名）。API は最大 40 件を返し、該当なしは 404 */
export async function searchSongle(
  query: string,
  options: FetchOptions = {},
): Promise<SongleSearchResult[]> {
  const body = await getJson(`${SONGLE_API.search}?q=${encodeURIComponent(query)}`, options);
  if (!Array.isArray(body)) return [];
  const results: SongleSearchResult[] = [];
  for (const item of body as unknown[]) {
    const permalink = asString(dig(item, 'permalink'));
    if (!permalink) continue;
    const durationMs = asNumber(dig(item, 'duration'));
    results.push({
      title: asString(dig(item, 'title')) ?? '',
      artist: asString(dig(item, 'artist', 'name')) ?? '',
      permalink,
      durationSec: durationMs === null ? null : durationMs / MS_PER_SECOND,
    });
  }
  return results;
}

function segmentsFromChords(chords: unknown): Segment[] {
  if (!Array.isArray(chords)) return [];
  const segments: Segment[] = [];
  for (const item of chords as unknown[]) {
    const start = asNumber(dig(item, 'start'));
    const duration = asNumber(dig(item, 'duration'));
    if (start === null || duration === null) continue;
    segments.push({
      start: start / MS_PER_SECOND,
      end: (start + duration) / MS_PER_SECOND,
      ...parseSongleChord(asString(dig(item, 'name')) ?? ''),
    });
  }
  return mergeAdjacentSegments(segments);
}

interface BeatInfo {
  readonly starts: number[];
  /** BPM の中央値。不明なら null */
  readonly tempo: number | null;
}

function beatsFrom(beats: unknown): BeatInfo {
  const list = Array.isArray(beats) ? (beats as unknown[]) : [];
  const starts = list.flatMap((beat) => {
    const start = asNumber(dig(beat, 'start'));
    return start === null ? [] : [start / MS_PER_SECOND];
  });
  const bpms = list
    .flatMap((beat) => asNumber(dig(beat, 'bpm')) ?? [])
    .filter((bpm) => bpm > 0)
    .sort((a, b) => a - b);
  return { starts, tempo: bpms.length ? bpms[bpms.length >> 1] : null };
}

/**
 * 曲情報・コード・ビートを取得する。未登録（またはコードが無い）なら null。
 * ビートの取得失敗は無視する（テンポ不明として続行）。
 */
export async function fetchSongle(
  songleUrl: string,
  options: FetchOptions = {},
): Promise<SongleSong | null> {
  const info = await fetchSongleInfo(songleUrl, options);
  if (!info) return null;
  const [chordBody, beatBody] = await Promise.all([
    getJson(withUrl(SONGLE_API.chord, info.permalink), options),
    getJson(withUrl(SONGLE_API.beat, info.permalink), options).catch((error: unknown) => {
      // 中断は握りつぶさず呼び出し元に伝える
      if (options.signal?.aborted) throw error;
      return null;
    }),
  ]);
  const segments = segmentsFromChords(dig(chordBody, 'chords'));
  const lastEnd = segments.at(-1)?.end;
  if (lastEnd === undefined) return null;

  const beats = beatsFrom(dig(beatBody, 'beats'));
  const duration = Math.max(info.durationSec ?? 0, lastEnd);
  return {
    info,
    source: {
      id: 'songle',
      label: `Songle — ${info.title} / ${info.artist || '?'}`,
      key: estimateKeyFromSegments(segments),
      tempo: beats.tempo,
      segments,
      timing: { duration, bounds: [0, ...beats.starts, duration] },
      offsetSec: 0,
      nextChord: nextChordIndices(segments),
    },
  };
}
