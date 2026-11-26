// リライト前の旧コード (js/) の出力を tests/golden/*.json に採取する。
// 新コード (src/) のテストがこの出力と突き合わせて、挙動が変わっていないことを確認する。
// 切り替え（js/ の削除）と同時にこのスクリプトも削除する。採取済みの JSON は回帰テストとして残す。
//
//   node --experimental-strip-types scripts/capture-golden.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRng } from '../tests/helpers/random.ts';
import { synthSignal } from '../tests/helpers/synth-signal.ts';

// logger.js / music.js が触る DOM の最小スタブ
const detected = { innerHTML: '' };
globalThis.document = { getElementById: (id) => (id === 'detected-chord-names' ? detected : null) };
const realWarn = console.warn;
console.warn = () => {};

const { CHORD_TYPES, SCALES, buildPadData } = await import('../js/constants.js');
const { state, setPads } = await import('../js/state.js');
const music = await import('../js/music.js');
const led = await import('../js/led.js');
const { parseSongleChord, fetchSongle } = await import('../js/analyze/songle.js');
const { parseMediaUrl, mediaPageUrl } = await import('../js/song-media.js');
const capo = await import('../js/chord-analyzer/capo.js');
const analyzer = await import('../js/chord-analyzer/analyzer.js');

const OUT = new URL('../tests/golden/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const write = (name, data) => {
  const json = JSON.stringify(data);
  writeFileSync(new URL(name, OUT), json + '\n');
  console.log(`${name}: ${(json.length / 1024).toFixed(1)} KB`);
};

const CHORD_KEYS = Object.keys(CHORD_TYPES);
const SCALE_KEYS = Object.keys(SCALES);
const ROLE_CODE = { root: 'R', bass: 'B', chord: 'C', scale: 'S', off: '.', 'next-root': 'r', 'next-chord': 'c' };

// ---------- pads ----------
write('pads.json', [0, 24, 36, 38, 41, 48, 85].map((baseNote) => ({ baseNote, pads: buildPadData(baseNote) })));

// ---------- パッド分類 / コード表示 / LED フレーム ----------
{
  const rng = createRng(1);
  const BASE_NOTES = [36, 36, 38, 48, 24, 41];
  const EXTRA = [
    { intervals: [0, 3, 7, 11], symbol: 'mM7' },
    { intervals: [0, 5, 7, 10], symbol: '7sus4' },
    { intervals: [0, 4, 8, 10], symbol: 'aug7' },
    { intervals: [0, 4, 7], symbol: 'omit5' },
  ];
  const randomChord = () => {
    const root = rng.int(12);
    const bassPC = rng.chance(0.35) ? rng.int(12) : null;
    if (rng.chance(0.25)) return { root, chordType: rng.pick(['maj', 'min']), bassPC, ...rng.pick(EXTRA) };
    const chordType = rng.pick(CHORD_KEYS);
    return { root, chordType, bassPC, intervals: undefined, symbol: undefined };
  };

  const LED_FRAME_EVERY = 20;
  const cases = [];
  const runCase = (input) => {
    Object.assign(state, {
      follow: false, practice: false, chordOverride: null, scaleRoot: null, preview: null, previewLit: true,
      ...input,
    });
    const pads = buildPadData(state.baseNote);
    setPads(pads);
    const roles = (ledPhase) => {
      const classify = music.createPadClassifier({ ledPhase });
      return pads.map((p) => ROLE_CODE[classify(p.pitchClass, p)]).join('');
    };
    const sent = [];
    state.device = { sendLEDs: (updates) => sent.push(updates) };
    led.sendToLaunchpad({ quiet: true });
    state.device = null;
    cases.push({
      input,
      screen: roles(false),
      led: roles(true),
      display: music.getChordDisplayData(),
      // LED フレームは色の対応を確認できれば十分なので一部のケースだけ保存する
      ...(cases.length % LED_FRAME_EVERY === 0 ? { ledFrame: sent[0].map((u) => [u.pad, u.r, u.g, u.b]) } : {}),
    });
  };

  // 手動操作
  for (let i = 0; i < 500; i++) {
    const chordType = rng.pick(CHORD_KEYS);
    runCase({
      baseNote: rng.pick(BASE_NOTES),
      root: rng.int(12),
      chordType,
      inversion: rng.int(CHORD_TYPES[chordType].intervals.length),
      showInversion: rng.chance(0.5),
      showChord: rng.chance(0.75),
      showScale: rng.chance(0.75),
      scale: rng.pick(SCALE_KEYS),
    });
  }
  // FOLLOW 中（chordOverride / scaleRoot / preview / practice）
  for (let i = 0; i < 500; i++) {
    const now = randomChord();
    const none = rng.chance(0.1);
    const next = rng.chance(0.6) ? randomChord() : null;
    const nextIntervals = next && (next.intervals ?? CHORD_TYPES[next.chordType].intervals);
    const practice = rng.chance(0.4);
    runCase({
      baseNote: rng.pick(BASE_NOTES),
      root: now.root,
      chordType: now.chordType,
      inversion: 0,
      showInversion: rng.chance(0.3),
      showChord: rng.chance(0.75),
      showScale: rng.chance(0.75),
      scale: rng.pick(['major', 'minor']),
      follow: true,
      practice,
      chordOverride: none ? { none: true } : { intervals: now.intervals, symbol: now.symbol, bassPC: now.bassPC },
      scaleRoot: rng.int(12),
      preview: next && {
        rootPC: next.root,
        pcs: [...nextIntervals.map((iv) => (next.root + iv) % 12), ...(next.bassPC != null ? [next.bassPC] : [])],
        intervals: nextIntervals,
        bassPC: next.bassPC,
      },
      previewLit: rng.chance(0.5),
    });
  }
  write('pad-roles.json', { roleCode: ROLE_CODE, cases });
}

// ---------- コード検出 ----------
{
  const rng = createRng(2);
  const sets = [[60], [60, 64, 67], [64, 67, 72], [60, 64, 67, 70], [57, 60, 64, 67], [60, 62, 67], [48, 55, 64, 71, 74]];
  for (let i = 0; i < 150; i++) {
    const size = 2 + rng.int(5);
    const notes = new Set();
    while (notes.size < size) notes.add(36 + rng.int(49));
    sets.push([...notes]);
  }
  const cases = sets.map((notes) => {
    music.detectChordFromActiveNotes(new Map(notes.map((n) => [n, {}])));
    const matches = [...detected.innerHTML.matchAll(/<span class="detected-chord-name( exact)?">([^<]*)<\/span>/g)]
      .map((m) => ({ name: m[2], exact: !!m[1] }));
    return { notes, matches };
  });
  write('detect.json', cases);
}

// ---------- Songle のコード名 ----------
const SONGLE_NAMES = (() => {
  const roots = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B', 'Cb', 'E#'];
  const suffixes = ['', 'm', '7', 'M7', 'maj7', 'm7', 'dim', 'dim7', 'aug', '+', 'm7b5', 'm7-5', 'sus2', 'sus4', 'sus',
    'add9', '9', 'M9', 'm9', '6', 'm6', 'mM7', '7sus4', 'aug7', '7b5', '13', 'm11', 'maj13', 'mystery', '(9)'];
  const names = ['N', '', 'X', 'H7', 'c', 'C/', '/E'];
  for (const r of roots) for (const s of suffixes) names.push(r + s);
  for (const b of ['E', 'G', 'Bb', 'C', 'F#']) for (const s of ['', 'm7', 'sus2', 'mM7', '13']) names.push(`C${s}/${b}`, `Ab${s}/${b}`);
  return names;
})();
write('songle-chord.json', SONGLE_NAMES.map((name) => ({ name, chord: parseSongleChord(name) })));

// ---------- メディア URL ----------
{
  const inputs = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'http://youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
    'https://youtu.be/dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/', 'dQw4w9WgXcQ', 'hello world', 'ヨルシカ', 'somewordhere', '',
    'https://www.nicovideo.jp/watch/sm9', 'http://nicovideo.jp/watch/sm12345678?ref=x', 'www.nicovideo.jp/watch/so38000000',
    'https://sp.nicovideo.jp/watch/nm1234', 'https://nico.ms/sm9', 'nico.ms/sm9', 'https://nico.ms/12345',
    'https://www.nicovideo.jp/watch/12345', 'https://www.nicovideo.jp/user/1',
    'https://soundcloud.com/some-user/some-track', 'soundcloud.com/some-user/some-track/',
    'https://m.soundcloud.com/some_user/track-1?in=x', 'https://soundcloud.com/some-user',
    'https://soundcloud.com/some-user/sets/playlist', 'https://soundcloud.com/a/b/c',
    'https://piapro.jp/t/AbCd', 'piapro.jp/t/AbCd/20200101123456', 'https://piapro.jp/t/Ab-Cd_1/2020010112345',
    'https://piapro.jp/content/abc', 'https://example.com/x', 'example.com/watch?v=dQw4w9WgXcQ', '  https://youtu.be/dQw4w9WgXcQ  ',
    'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
  ];
  write('media-url.json', inputs.map((input) => {
    const media = parseMediaUrl(input);
    return { input, media, pageUrl: media && mediaPageUrl(media) };
  }));
}

// ---------- カポ ----------
{
  const rng = createRng(3);
  const names = SONGLE_NAMES.filter((n) => parseSongleChord(n).root !== null || n === 'N');
  const cases = [];
  for (let i = 0; i < 60; i++) {
    let t = 0;
    const segments = Array.from({ length: 3 + rng.int(14) }, () => {
      const start = t;
      t += 0.5 + rng.int(8) * 0.5;
      return { start, end: t, ...parseSongleChord(rng.pick(names)) };
    });
    cases.push({
      segments,
      suggested: capo.suggestCapo(segments),
      fit: Array.from({ length: 12 }, (_, c) => capo.scaleFitRatio(segments, c)),
      labels: [0, 1, 5, 11].map((c) => segments.map((s) => capo.chordLabel(s, c))),
    });
  }
  write('capo.json', cases);
}

// ---------- キー推定 ----------
{
  const rng = createRng(4);
  const profiles = [new Array(12).fill(0), new Array(12).fill(1), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
  for (let i = 0; i < 80; i++) profiles.push(Array.from({ length: 12 }, () => Math.round(rng.next() * 1000) / 100));
  write('key.json', profiles.map((profile) => ({
    profile,
    key: analyzer.keyFromProfile(profile),
    labels: [0, 3, 7].map((c) => capo.keyLabel(analyzer.keyFromProfile(profile), c)),
  })));
}

// ---------- 解析（特徴量抽出 + デコード） ----------
{
  const inputs = [
    { name: 'mono-22050', sampleRate: 22050, channels: 1, timeScale: 1 },
    { name: 'stereo-44100', sampleRate: 44100, channels: 2, timeScale: 1 },
    { name: 'stereo-44100-x2', sampleRate: 44100, channels: 2, timeScale: 2 },
  ];
  const optionMatrix = [];
  for (const vocabulary of ['full', 'triads']) {
    for (const centerCut of [false, true]) for (const hpss of [false, true]) for (const melody of [false, true]) {
      optionMatrix.push({ vocabulary, centerCut, hpss, melody });
    }
  }
  optionMatrix.push({ selfTransition: 0.2 }, { selfTransition: 0.95 }, { bassWeight: 0 }, { bassWeight: 1 },
    { vocabulary: 'unknown' }, { selfTransition: 0, keyBonus: 0.2, beta: 5 });

  const cases = inputs.map(({ name, sampleRate, channels, timeScale }) => {
    const signal = synthSignal(sampleRate, channels);
    const phases = [];
    const features = analyzer.extractFeatures(channels === 1 ? signal[0] : signal, sampleRate, { timeScale },
      (phase) => { if (phases[phases.length - 1] !== phase) phases.push(phase); });
    return {
      name, sampleRate, channels, timeScale, phases, features,
      decoded: optionMatrix.map((options) => ({ options, result: analyzer.decodeChords(features, options) })),
      remapped: analyzer.remapTimes(features, (t) => t * 1.5 + 0.25),
    };
  });
  write('analyzer.json', cases);

  const { segments } = cases[1].decoded[0].result;
  write('find-segment.json', {
    segments,
    lookups: [-1, 0, 0.001, 1.999, 2, 7.5, 15.99, 16, 100].map((t) => ({ t, index: analyzer.findSegmentIndex(segments, t) })),
  });
}

// ---------- Songle API の応答整形（fetch を差し替え） ----------
{
  const song = {
    data: {
      attributes: { name: 'Test Song', durationTimeMs: 21500, permalink: 'www.youtube.com/watch?v=dQw4w9WgXcQ', code: 'abc' },
      relationships: {
        artist: { data: { attributes: { name: 'Test Artist' } } },
        uri: { data: { attributes: { permalink: 'https://songle.jp/songs/123' } } },
      },
    },
  };
  const chords = {
    chords: [
      { start: 0, duration: 2000, name: 'N' },
      { start: 2000, duration: 2000, name: 'C' },
      { start: 4000, duration: 2000, name: 'C' },
      { start: 6000, duration: 2000, name: 'Am7' },
      { start: 8000, duration: 2000, name: 'F/A' },
      { start: 10005, duration: 1995, name: 'F/A' },
      { start: 12500, duration: 1500, name: 'F/A' },
      { start: 14000, duration: 2000, name: 'GmM7' },
      { start: 16000, duration: 2000, name: 'G7sus4/D' },
      { start: 18000, duration: 3000, name: 'C' },
    ],
  };
  const beats = { beats: Array.from({ length: 40 }, (_, i) => ({ start: 250 + i * 500, bpm: i < 30 ? 120 : 118, position: (i % 4) + 1 })) };
  const responses = { song, chords, beats };
  const variants = { full: {}, noBeats: { beats: 500 }, noUri: { uri: false }, noChords: { chords: { chords: [] } }, unregistered: { song: 404 } };

  const results = {};
  for (const [name, variant] of Object.entries(variants)) {
    globalThis.fetch = async (url) => {
      const reply = (body) => (typeof body === 'number'
        ? { ok: false, status: body, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => body });
      if (url.includes('/api/v2/song.json')) {
        if (variant.song) return reply(variant.song);
        if (variant.uri === false) {
          const copy = structuredClone(song);
          delete copy.data.relationships.uri;
          return reply(copy);
        }
        return reply(song);
      }
      if (url.includes('chord.json')) return reply(variant.chords ?? chords);
      if (url.includes('beat.json')) return reply(variant.beats ?? beats);
      throw new Error(`unexpected fetch ${url}`);
    };
    results[name] = await fetchSongle('dQw4w9WgXcQ');
  }
  write('songle-fetch.json', { responses, results });
}

console.warn = realWarn;
