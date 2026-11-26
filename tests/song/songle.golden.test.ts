import { describe, expect, it } from 'vitest';
import { parseMediaUrl, parseYouTubeId } from '../../src/song/media-url.ts';
import { parseSongleChord } from '../../src/song/sources/songle-chord.ts';
import { fetchSongle } from '../../src/song/sources/songle-client.ts';
import { mediaPageUrl, type Media } from '../../src/song/types.ts';
import type { Key } from '../../src/core/key.ts';
import {
  chordFromLegacy,
  loadGolden,
  segmentFromLegacy,
  type LegacyChord,
  type LegacySegment,
} from '../helpers/golden.ts';

describe('parseSongleChord（旧 songle.js と一致）', () => {
  const golden = loadGolden<{ name: string; chord: LegacyChord }[]>('songle-chord');
  // 旧実装は「/」の後がベース音でない名前を丸ごと N.C. にしていた（意図的に変更。下のテスト参照）
  const changed = (name: string): boolean => /^[A-G][#b]?.*\/(?![A-G][#b]?$)/.test(name);

  it.each(golden.filter((c) => !changed(c.name)))('"$name"', ({ name, chord }) => {
    const parsed = parseSongleChord(name);
    expect(parsed.label).toBe(chord.label);
    expect(parsed.chord).toEqual(chordFromLegacy(chord));
  });

  it('ベース音として読めない「/…」は接尾辞として扱う（旧実装は N.C. になっていた）', () => {
    expect(parseSongleChord('C/9').chord).toMatchObject({
      root: 0,
      type: 'maj',
      symbol: '/9',
      bass: null,
    });
    expect(parseSongleChord('Am/9').chord).toMatchObject({ root: 9, type: 'min', symbol: 'm/9' });
  });

  it('Object.prototype のプロパティ名を接尾辞に持つ名前でも壊れない（旧実装は type が関数になっていた）', () => {
    for (const suffix of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const { chord } = parseSongleChord(`C${suffix}`);
      expect(chord).toMatchObject({ root: 0, type: 'maj', intervals: [0, 4, 7], symbol: suffix });
    }
  });
});

describe('parseMediaUrl（旧 song-media.js と一致）', () => {
  const golden =
    loadGolden<{ input: string; media: Media | null; pageUrl: string | null }[]>('media-url');
  it.each(golden)('"$input"', ({ input, media, pageUrl }) => {
    const parsed = parseMediaUrl(input);
    expect(parsed).toEqual(media);
    expect(parsed && mediaPageUrl(parsed)).toBe(pageUrl);
  });

  it('スキームなしの YouTube URL も認識する（旧実装は検索キーワード扱いだった）', () => {
    const expected = {
      kind: 'youtube',
      id: 'dQw4w9WgXcQ',
      songleUrl: 'www.youtube.com/watch?v=dQw4w9WgXcQ',
    };
    expect(parseMediaUrl('youtu.be/dQw4w9WgXcQ')).toEqual(expected);
    expect(parseMediaUrl('youtube.com/watch?v=dQw4w9WgXcQ')).toEqual(expected);
    expect(parseMediaUrl('www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')).toEqual(expected);
  });

  it('parseYouTubeId は動画 ID 単体も受け付ける（解析ページ用）', () => {
    expect(parseYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('hello world')).toBeNull();
    expect(parseYouTubeId('https://soundcloud.com/a/b')).toBeNull();
  });
});

describe('fetchSongle（旧 songle.js と一致）', () => {
  interface LegacyResult {
    song: {
      title: string;
      artist: { name: string };
      duration: number;
      permalink: string;
      url?: string;
    };
    pageUrl: string;
    key: Key;
    tempo: number;
    segments: LegacySegment[];
    timing: { duration: number; bounds: number[] };
  }
  const golden = loadGolden<{
    responses: { song: unknown; chords: unknown; beats: unknown };
    results: Record<string, LegacyResult | null>;
  }>('songle-fetch');
  const { song, chords, beats } = golden.responses;

  const reply = (body: unknown): Response =>
    typeof body === 'number'
      ? new Response('{}', { status: body })
      : new Response(JSON.stringify(body));
  const fakeFetch = (overrides: { song?: unknown; chords?: unknown; beats?: unknown }) =>
    ((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes('/api/v2/song.json')) return Promise.resolve(reply(overrides.song ?? song));
      if (url.includes('chord.json')) return Promise.resolve(reply(overrides.chords ?? chords));
      if (url.includes('beat.json')) return Promise.resolve(reply(overrides.beats ?? beats));
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;

  const withoutUri = (): unknown => {
    const copy = structuredClone(song) as { data: { relationships: { uri?: unknown } } };
    delete copy.data.relationships.uri;
    return copy;
  };

  const cases: [string, Parameters<typeof fakeFetch>[0]][] = [
    ['full', {}],
    ['noBeats', { beats: 500 }],
    ['noUri', { song: withoutUri() }],
    ['noChords', { chords: { chords: [] } }],
    ['unregistered', { song: 404 }],
  ];

  it.each(cases)('%s', async (name, overrides) => {
    const expected = golden.results[name];
    const actual = await fetchSongle('www.youtube.com/watch?v=dQw4w9WgXcQ', {
      fetch: fakeFetch(overrides),
    });
    if (!expected) {
      expect(actual).toBeNull();
      return;
    }
    expect(actual?.info).toEqual({
      title: expected.song.title,
      artist: expected.song.artist.name,
      durationSec: expected.song.duration / 1000,
      permalink: expected.song.permalink,
      pageUrl: expected.pageUrl,
    });
    expect(actual?.source.segments).toEqual(expected.segments.map(segmentFromLegacy));
    expect(actual?.source.key).toEqual(expected.key);
    // テンポ不明は 0 ではなく null で表す
    expect(actual?.source.tempo).toBe(expected.tempo || null);
    expect(actual?.source.timing).toEqual(expected.timing);
  });

  it('http(s) 以外の曲ページ URL は捨てる', async () => {
    const evil = structuredClone(song) as {
      data: { relationships: { uri: { data: { attributes: { permalink: string } } } } };
    };
    evil.data.relationships.uri.data.attributes.permalink = 'javascript:alert(1)';
    const actual = await fetchSongle('x', { fetch: fakeFetch({ song: evil }) });
    expect(actual?.info.pageUrl).toBeNull();
  });

  it('曲情報が欠けた応答は未登録として扱う（旧実装は例外になっていた）', async () => {
    expect(await fetchSongle('x', { fetch: fakeFetch({ song: { data: {} } }) })).toBeNull();
  });
});
