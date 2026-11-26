// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../../src/platform/logger.ts';
import { SongLoader } from '../../src/song/loader.ts';
import type { MediaPlayer, PlayerOptions } from '../../src/song/media/player.ts';
import { PlayerHost } from '../../src/song/media/player-host.ts';
import { parseMediaUrl } from '../../src/song/media-url.ts';
import { SongRuntime } from '../../src/song/runtime.ts';
import { saveAnalysisCache } from '../../src/song/sources/analysis-cache.ts';
import type { Media } from '../../src/song/types.ts';
import { createStore } from '../../src/store/create-store.ts';
import { createInitialState } from '../../src/store/initial-state.ts';
import { reduce } from '../../src/store/reducer.ts';
import { selectEffectiveChord, selectPreview } from '../../src/store/selectors.ts';
import { loadGolden } from '../helpers/golden.ts';
import type { Features } from '../../src/analyzer/types.ts';

const golden = loadGolden<{ responses: { song: unknown; chords: unknown; beats: unknown } }>(
  'songle-fetch',
);
const analyzerGolden = loadGolden<{ name: string; features: Features }[]>('analyzer');
const YOUTUBE = parseMediaUrl('https://youtu.be/dQw4w9WgXcQ')!;
const OTHER = parseMediaUrl('https://youtu.be/aaaaaaaaaaa')!;

/** テスト用のプレイヤー: 再生位置を手で動かせる */
class FakePlayer implements MediaPlayer {
  time = 0;
  playing = false;
  destroyed = false;
  volume = -1;
  readonly seeks: number[] = [];
  constructor(
    readonly kind: Media['kind'],
    readonly slot: HTMLElement,
    private readonly options: PlayerOptions,
  ) {
    slot.textContent = 'player';
  }
  rawTime = (): number => this.time;
  isPlaying = (): boolean => this.playing;
  play = (): void => {
    this.playing = true;
    this.options.onStateChange();
  };
  pause = (): void => {
    this.playing = false;
    this.options.onStateChange();
  };
  seek = (sec: number): void => {
    this.seeks.push(sec);
    this.time = sec;
  };
  setVolume = (percent: number): void => {
    this.volume = percent;
  };
  destroy = (): void => {
    this.destroyed = true;
    this.slot.remove();
  };
}

function setup(
  options: { createDelayMs?: number; notFound?: boolean; fetchDelayMs?: number } = {},
) {
  const store = createStore(reduce, createInitialState());
  const logger = new Logger();
  const container = document.createElement('div');
  const players: FakePlayer[] = [];
  const host = new PlayerHost(
    container,
    async (slot, media, playerOptions) => {
      if (options.createDelayMs) await new Promise((r) => setTimeout(r, options.createDelayMs));
      const player = new FakePlayer(media.kind, slot, playerOptions);
      players.push(player);
      return player;
    },
    1000,
  );
  const runtime = new SongRuntime(store, logger);
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (options.fetchDelayMs) await new Promise((r) => setTimeout(r, options.fetchDelayMs));
    init?.signal?.throwIfAborted();
    const json = (body: unknown): Response => new Response(JSON.stringify(body));
    if (url.includes('/api/v2/song.json'))
      return options.notFound ? new Response('', { status: 404 }) : json(golden.responses.song);
    if (url.includes('chord.json')) return json(golden.responses.chords);
    if (url.includes('beat.json')) return json(golden.responses.beats);
    if (url.includes('search.json')) {
      return json([
        {
          title: 'Hit',
          artist: { name: 'A' },
          permalink: 'www.youtube.com/watch?v=dQw4w9WgXcQ',
          duration: 200000,
        },
        {
          title: 'Unplayable',
          artist: { name: 'B' },
          permalink: 'example.com/song',
          duration: 1000,
        },
      ]);
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  const loader = new SongLoader({
    store,
    logger,
    storage: localStorage,
    host,
    fetch: fetchFn,
    onPlayer: (player) => {
      runtime.setPlayer(player);
    },
    onPlayerStateChange: () => {
      runtime.syncPlaying();
    },
  });
  return { store, loader, runtime, players, container };
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('曲の読み込み', () => {
  it('Songle のコード進行を読み込み、プレイヤーを作って FOLLOW を始める', async () => {
    const { store, loader, players } = setup();
    await loader.load(YOUTUBE);
    const { song } = store.getState();
    expect(song.load).toMatchObject({
      status: 'loaded',
      activeSource: 'songle',
      info: { title: 'Test Song' },
    });
    expect(song.playback.status).toBe('ready');
    expect(song.follow).toBe(true);
    expect(players).toHaveLength(1);
    expect(players[0].volume).toBe(-1); // 音量は生成時のオプションで渡す
    expect(song.recents[0]).toMatchObject({ title: 'Test Song', artist: 'Test Artist' });
  });

  it('Songle 未登録の曲は読み込まない', async () => {
    const { store, loader, players } = setup({ notFound: true });
    await loader.load(YOUTUBE);
    expect(store.getState().song.load.status).toBe('unregistered');
    expect(players).toHaveLength(0);
    expect(store.getState().song.recents).toHaveLength(0);
  });

  it('再生位置に合わせてコードが切り替わり、予告が出る', async () => {
    const { store, loader, runtime, players } = setup();
    await loader.load(YOUTUBE);
    const player = players[0];
    player.play();
    expect(store.getState().song.playback.playing).toBe(true);

    runtime.frame(true); // 0 秒 = N.C.
    expect(selectEffectiveChord(store.getState())).toEqual({ kind: 'none' });
    player.time = 3;
    runtime.frame(true);
    expect(selectEffectiveChord(store.getState())).toMatchObject({
      spec: { root: 0, type: 'maj' },
    });
    player.time = 5.8; // 次は 6 秒から Am7
    runtime.frame(true);
    expect(selectPreview(store.getState())).toMatchObject({ root: 9, type: 'min7' });
  });

  it('A-B ループ: B を越えたら 1 回だけ A にシークする', async () => {
    const { store, loader, runtime, players } = setup();
    await loader.load(YOUTUBE);
    const player = players[0];
    player.play();
    player.time = 2;
    runtime.cycleLoop();
    player.time = 6;
    runtime.cycleLoop();
    expect(store.getState().song.loop).toEqual({ kind: 'ab', a: 2, b: 6 });

    player.seeks.length = 0;
    player.time = 6.01;
    runtime.frame(true);
    // プレイヤーがまだ古い位置を報告していても、シークを繰り返さない
    player.time = 6.02;
    runtime.frame(true);
    runtime.frame(true);
    expect(player.seeks).toEqual([2]);
  });

  it('1 小節戻る = 4 拍分（120 BPM なら 2 秒）', async () => {
    const { loader, runtime, players } = setup();
    await loader.load(YOUTUBE);
    players[0].time = 10;
    runtime.frame(true);
    runtime.backOneBar();
    expect(players[0].seeks.at(-1)).toBeCloseTo(8);
  });

  it('読み込み中に別の曲を読み込んでも、古いプレイヤーが残ったり新しいプレイヤーが消えたりしない', async () => {
    const { store, loader, players, container } = setup({ createDelayMs: 30 });
    const first = loader.load(YOUTUBE);
    await new Promise((r) => setTimeout(r, 10));
    const second = loader.load(OTHER);
    await Promise.all([first, second]);

    expect(store.getState().song.load).toMatchObject({
      status: 'loaded',
      media: { id: 'aaaaaaaaaaa' },
    });
    expect(store.getState().song.playback.status).toBe('ready');
    const alive = players.filter((p) => !p.destroyed);
    expect(alive).toHaveLength(1);
    expect(container.children).toHaveLength(1);
    expect(container.textContent).toBe('player');
  });

  it('取得中に別の曲を読み込むと、古い方の結果は捨てる', async () => {
    const { store, loader } = setup({ fetchDelayMs: 20 });
    const first = loader.load(YOUTUBE);
    const second = loader.load(OTHER);
    await Promise.all([first, second]);
    expect(store.getState().song.load).toMatchObject({
      status: 'loaded',
      media: { id: 'aaaaaaaaaaa' },
    });
  });

  it('検索しても読み込み中の曲は止まらない（旧実装は検索が読み込みを中断していた）', async () => {
    const { store, loader } = setup({ fetchDelayMs: 20 });
    const loading = loader.load(YOUTUBE);
    const searching = loader.search('hit');
    await Promise.all([loading, searching]);
    const { song } = store.getState();
    expect(song.load.status).toBe('loaded');
    expect(song.panel).toMatchObject({
      kind: 'results',
      hits: [{ title: 'Hit', artist: 'A', durationSec: 200 }],
    });
  });

  it('プレイヤーの準備が終わらなければエラーにして FOLLOW を止める', async () => {
    vi.useFakeTimers();
    const { store, loader } = setup({ createDelayMs: 5000 });
    const loading = loader.load(YOUTUBE);
    await vi.advanceTimersByTimeAsync(1500);
    await loading;
    expect(store.getState().song.playback).toMatchObject({
      status: 'error',
      error: 'Player did not become ready',
    });
    expect(store.getState().song.follow).toBe(false);
  });

  it('解析ページで保存した解析結果を、調整済みのデコード設定で使う', async () => {
    const features = analyzerGolden.find((c) => c.name === 'stereo-44100')!.features;
    const cache = {
      features,
      source: 'scan' as const,
      useSongle: false,
      offsetMs: 120,
      capo: 0,
      capoAuto: true,
      savedAt: 1,
      decodeOptions: { vocabulary: 'triads' as const },
    };
    expect(saveAnalysisCache(localStorage, YOUTUBE.id, cache)).toBe(true);
    const { store, loader } = setup();
    await loader.load(YOUTUBE);
    const { load } = store.getState().song;
    if (load.status !== 'loaded') throw new Error('not loaded');
    expect(load.activeSource).toBe('analysis');
    expect(load.sources.analysis).toMatchObject({ label: 'Analysis (tab scan)', offsetSec: 0.12 });
    // triads: 7th や sus4 は出ない
    expect(
      load.sources.analysis?.segments.every(
        (s) => !s.chord || ['maj', 'min'].includes(s.chord.type),
      ),
    ).toBe(true);
  });
});
