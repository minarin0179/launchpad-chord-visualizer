import { errorMessage, type Logger } from '../platform/logger';
import type { KeyValueStorage } from '../platform/storage';
import type { Action } from '../store/actions';
import type { Store } from '../store/create-store';
import type { AppState } from '../store/state';
import type { MediaPlayer } from './media/player';
import type { PlayerHost } from './media/player-host';
import { parseMediaUrl } from './media-url';
import { analysisSource, loadAnalysisCache, prefersAnalysis } from './sources/analysis-cache';
import { fetchSongle, searchSongle, type FetchOptions } from './sources/songle-client';
import type { ChordSource, Media, SearchHit, SourceId } from './types';

export interface SongLoaderDeps {
  readonly store: Store<AppState, Action>;
  readonly logger: Logger;
  readonly storage: KeyValueStorage;
  readonly host: PlayerHost;
  /** プレイヤーの準備ができた / 破棄された */
  readonly onPlayer: (player: MediaPlayer | null) => void;
  /** プレイヤーの再生状態が変わった */
  readonly onPlayerStateChange: () => void;
  readonly fetch?: typeof fetch;
}

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

/**
 * 曲の読み込みと Songle 検索。
 *
 * 読み込みと検索は別々に中断できる（検索しても読み込み中の曲は止まらない）。
 * 新しい読み込みを始めると、前の読み込みは AbortController で中断する。
 */
export class SongLoader {
  private loading: AbortController | null = null;
  private searching: AbortController | null = null;

  constructor(private readonly deps: SongLoaderDeps) {}

  /** 入力欄の内容を処理する: 対応メディアの URL なら読み込み、それ以外は Songle を検索する */
  submit(input: string): void {
    const text = input.trim();
    if (!text) return;
    const media = parseMediaUrl(text);
    if (media) void this.load(media);
    else void this.search(text);
  }

  async load(media: Media): Promise<void> {
    const { store, logger, host, onPlayer } = this.deps;
    this.loading?.abort();
    this.searching?.abort();
    const controller = new AbortController();
    this.loading = controller;
    const { signal } = controller;

    onPlayer(null);
    store.dispatch({ type: 'songLoadStarted', media });
    void host.unmount();

    try {
      const songle = await fetchSongle(media.songleUrl, this.fetchOptions(signal));
      signal.throwIfAborted();
      // プレイヤーが Songle の埋め込みプレイヤーなので、Songle 未登録の曲は扱えない
      if (!songle) {
        store.dispatch({ type: 'songUnregistered', media });
        return;
      }
      const sources: Partial<Record<SourceId, ChordSource>> = { songle: songle.source };
      let activeSource: SourceId = 'songle';
      // 解析結果は YouTube の動画 ID 単位で保存されている
      const cached =
        media.kind === 'youtube' ? loadAnalysisCache(this.deps.storage, media.id) : null;
      const analysis = cached && analysisSource(cached);
      if (cached && analysis) {
        sources.analysis = analysis;
        if (prefersAnalysis(cached)) activeSource = 'analysis';
      }
      store.dispatch({
        type: 'songLoaded',
        media,
        info: songle.info,
        sources,
        activeSource,
        now: Date.now(),
      });
      const active = sources[activeSource];
      if (active)
        logger.out(
          `Song: ${active.label} — ${active.segments.length} chords, key ${active.key.label}`,
        );
    } catch (error) {
      if (isAbort(error) || signal.aborted) return;
      logger.error(`Songle fetch failed: ${errorMessage(error)}`);
      store.dispatch({ type: 'songLoadFailed', media, message: errorMessage(error) });
      return;
    }

    try {
      const player = await host.mount(
        media,
        { volume: store.getState().song.volume, onStateChange: this.deps.onPlayerStateChange },
        signal,
      );
      onPlayer(player);
      store.dispatch({ type: 'playerStatusChanged', status: 'ready' });
    } catch (error) {
      if (isAbort(error) || signal.aborted) return;
      logger.error(`Song player failed: ${errorMessage(error)}`);
      store.dispatch({ type: 'playerStatusChanged', status: 'error', error: errorMessage(error) });
    }
  }

  async search(query: string): Promise<void> {
    const { store } = this.deps;
    this.searching?.abort();
    const controller = new AbortController();
    this.searching = controller;
    store.dispatch({ type: 'searchStarted', query });
    try {
      const results = await searchSongle(query, this.fetchOptions(controller.signal));
      if (controller.signal.aborted) return;
      // 再生できるメディアの曲だけを候補にする
      const hits: SearchHit[] = results.flatMap(({ title, artist, permalink, durationSec }) => {
        const media = parseMediaUrl(permalink);
        return media ? [{ media, title, artist, durationSec }] : [];
      });
      store.dispatch({ type: 'searchSucceeded', query, hits });
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return;
      store.dispatch({ type: 'searchFailed', query, message: errorMessage(error) });
    }
  }

  private fetchOptions(signal: AbortSignal): FetchOptions {
    return this.deps.fetch ? { fetch: this.deps.fetch, signal } : { signal };
  }
}
