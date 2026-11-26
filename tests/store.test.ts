import { describe, expect, it } from 'vitest';
import { MAX_BASE_NOTE } from '../src/core/grid.ts';
import { mod12 } from '../src/core/pitch.ts';
import { nextChordIndices, type Segment } from '../src/core/segments.ts';
import { parseSongleChord } from '../src/song/sources/songle-chord.ts';
import type { ChordSource } from '../src/song/types.ts';
import type { Action } from '../src/store/actions.ts';
import { createStore } from '../src/store/create-store.ts';
import {
  createInitialState,
  EMPTY_PERSISTED,
  selectPersistedSettings,
} from '../src/store/initial-state.ts';
import { reduce } from '../src/store/reducer.ts';
import {
  selectBaseNote,
  selectEffectiveChord,
  selectPadVisuals,
  selectPreview,
  selectScaleRef,
} from '../src/store/selectors.ts';
import type { AppState } from '../src/store/state.ts';

const run = (state: AppState, ...actions: Action[]): AppState => actions.reduce(reduce, state);

function source(names: string[], overrides: Partial<ChordSource> = {}): ChordSource {
  const segments: Segment[] = names.map((name, i) => ({
    start: i * 2,
    end: i * 2 + 2,
    ...parseSongleChord(name),
  }));
  return {
    id: 'songle',
    label: 'Songle — Test / Artist',
    key: { root: 7, mode: 'major', label: 'G', tonicMajor: 7, confidence: 0.9 },
    tempo: 120,
    segments,
    timing: { duration: names.length * 2, bounds: [0, names.length * 2] },
    offsetSec: 0,
    nextChord: nextChordIndices(segments),
    ...overrides,
  };
}

const MEDIA = {
  kind: 'youtube',
  id: 'dQw4w9WgXcQ',
  songleUrl: 'www.youtube.com/watch?v=dQw4w9WgXcQ',
} as const;
const INFO = { title: 'Test', artist: 'Artist', durationSec: 8, permalink: 'p', pageUrl: null };

const loaded = (names: string[], state = createInitialState()): AppState =>
  run(
    state,
    { type: 'songLoadStarted', media: MEDIA },
    {
      type: 'songLoaded',
      media: MEDIA,
      info: INFO,
      sources: { songle: source(names) },
      activeSource: 'songle',
      now: 1,
    },
  );

describe('ストアの基本動作', () => {
  it('watch は値が変わったときだけ呼ばれる', () => {
    const store = createStore(reduce, createInitialState());
    const seen: number[] = [];
    store.watch(
      (s) => s.manual.root,
      (root) => seen.push(root),
    );
    store.dispatch({ type: 'rootSelected', root: 5 });
    store.dispatch({ type: 'volumeChanged', volume: 10 });
    store.dispatch({ type: 'rootSelected', root: 5 });
    store.dispatch({ type: 'rootSelected', root: 7 });
    expect(seen).toEqual([0, 5, 7]);
  });

  it('購読者の中の dispatch は通知が一巡してから処理される', () => {
    const store = createStore(reduce, createInitialState());
    const order: string[] = [];
    store.subscribe((s) => {
      order.push(`a:${s.manual.root}`);
      if (s.manual.root === 1) store.dispatch({ type: 'rootSelected', root: 2 });
    });
    store.subscribe((s) => order.push(`b:${s.manual.root}`));
    store.dispatch({ type: 'rootSelected', root: 1 });
    expect(order).toEqual(['a:1', 'b:1', 'a:2', 'b:2']);
  });
});

describe('カポ / オクターブ', () => {
  it('カポはルートと左下パッドを同じだけ動かす（パッド上の形は変わらない）', () => {
    const before = run(createInitialState(), { type: 'rootSelected', root: 4 });
    const shape = selectPadVisuals(before).map((v) => v.role);
    const after = run(before, { type: 'capoShifted', delta: 3 });
    expect(after.manual.root).toBe(7);
    expect(selectBaseNote(after)).toBe(selectBaseNote(before) + 3);
    expect(selectPadVisuals(after).map((v) => v.role)).toEqual(shape);
    expect(mod12(after.manual.root - after.layout.capo)).toBe(
      mod12(before.manual.root - before.layout.capo),
    );
  });

  it('RST はカポを 0 に戻す', () => {
    const state = run(
      createInitialState(),
      { type: 'capoShifted', delta: -4 },
      { type: 'capoReset' },
    );
    expect(state.layout).toEqual(createInitialState().layout);
    expect(state.manual.root).toBe(0);
  });

  it('右上パッドが MIDI の範囲を超える移動は無視する', () => {
    let state = createInitialState();
    for (let i = 0; i < 20; i++) state = reduce(state, { type: 'octaveShifted', delta: 1 });
    expect(selectBaseNote(state)).toBeLessThanOrEqual(MAX_BASE_NOTE);
    for (let i = 0; i < 200; i++) state = reduce(state, { type: 'capoShifted', delta: 1 });
    expect(selectBaseNote(state)).toBe(MAX_BASE_NOTE);
    for (let i = 0; i < 20; i++) state = reduce(state, { type: 'octaveShifted', delta: -1 });
    expect(selectBaseNote(state)).toBeGreaterThanOrEqual(0);
  });

  it('手動のカポ変更は AUTO を解除する', () => {
    expect(run(createInitialState(), { type: 'capoShifted', delta: 1 }).song.capoAuto).toBe(false);
  });
});

describe('FOLLOW', () => {
  it('曲を読み込むと FOLLOW が ON になり、再生位置のコードとキー基準のスケールを表示する', () => {
    const state = loaded(['G', 'Em', 'C', 'D']);
    expect(state.song.follow).toBe(true);
    expect(selectEffectiveChord(state)).toMatchObject({
      kind: 'chord',
      origin: 'song',
      spec: { root: 7 },
    });
    expect(selectScaleRef(state)).toEqual({ root: 7, scale: 'major' });
  });

  it('曲のコードは manual に書き込まれず、保存される設定にも入らない', () => {
    const before = run(
      createInitialState(),
      { type: 'rootSelected', root: 2 },
      { type: 'scaleSelected', scale: 'dorian' },
    );
    const state = run(loaded(['G', 'Em', 'C', 'D'], before), {
      type: 'cursorMoved',
      cursor: { segmentIndex: 2, previewIndex: null },
    });
    const saved = selectPersistedSettings(state);
    // AUTO カポでルートは移調されるが、形（ルート − カポ）は変わらない
    expect(mod12(saved.root - saved.capo)).toBe(2);
    expect(saved.scale).toBe('dorian');
    expect(saved.chordType).toBe('maj');
  });

  it('N.C. と区間外はコードなし', () => {
    const state = loaded(['N', 'C']);
    expect(selectEffectiveChord(state)).toEqual({ kind: 'none' });
    const outside = run(state, {
      type: 'cursorMoved',
      cursor: { segmentIndex: -1, previewIndex: null },
    });
    expect(selectEffectiveChord(outside)).toEqual({ kind: 'none' });
  });

  it('手動でコードの種類を選ぶと、曲のコードのルートを引き継いで FOLLOW を止める', () => {
    const state = run(loaded(['G', 'Em']), { type: 'chordTypeSelected', chordType: '7' });
    expect(state.song.follow).toBe(false);
    expect(state.manual).toMatchObject({ root: 7, chordType: '7', inversion: 0 });
    expect(selectScaleRef(state).root).toBe(7);
  });

  it('FOLLOW を OFF にすると練習モードも OFF、練習モードを ON にすると FOLLOW も ON', () => {
    const off = run(loaded(['G', 'Em']), { type: 'followSet', on: false });
    const practicing = run(off, { type: 'practiceSet', on: true });
    expect(practicing.song).toMatchObject({ follow: true, practice: true });
    expect(run(practicing, { type: 'followSet', on: false }).song).toMatchObject({
      follow: false,
      practice: false,
    });
  });

  it('曲が無ければ FOLLOW / 練習モードは ON にならない', () => {
    const state = run(
      createInitialState(),
      { type: 'followSet', on: true },
      { type: 'practiceSet', on: true },
    );
    expect(state.song).toMatchObject({ follow: false, practice: false });
  });

  it('FOLLOW 中のスケール変更は曲の間だけ有効', () => {
    const state = run(loaded(['G', 'Em']), { type: 'scaleSelected', scale: 'blues' });
    expect(selectScaleRef(state)).toEqual({ root: 7, scale: 'blues' });
    expect(state.manual.scale).toBe('major');
    expect(selectScaleRef(run(state, { type: 'followSet', on: false })).scale).toBe('major');
  });

  it('FOLLOW 中のカポ変更でも表示するコードは実音のまま', () => {
    const state = run(loaded(['G', 'Em']), { type: 'capoShifted', delta: 2 });
    expect(selectEffectiveChord(state)).toMatchObject({ spec: { root: 7 } });
  });

  it('予告は FOLLOW 中だけ', () => {
    const state = run(loaded(['G', 'Em']), {
      type: 'cursorMoved',
      cursor: { segmentIndex: 0, previewIndex: 1 },
    });
    expect(selectPreview(state)).toMatchObject({ root: 4, type: 'min' });
    expect(selectPreview(run(state, { type: 'followSet', on: false }))).toBeNull();
  });

  it('プレイヤーを作れなかったら FOLLOW を止める', () => {
    const state = run(loaded(['G']), {
      type: 'playerStatusChanged',
      status: 'error',
      error: 'boom',
    });
    expect(state.song.follow).toBe(false);
    expect(state.song.playback).toEqual({ status: 'error', playing: false, error: 'boom' });
  });
});

describe('曲の読み込み', () => {
  it('AUTO カポ: 構成音が C メジャースケールに最も収まるカポを選ぶ', () => {
    // G メジャーの曲 → カポ 7 で C の形になる
    const state = loaded(['G', 'Em', 'C', 'D']);
    expect(mod12(state.layout.capo)).toBe(7);
    expect(state.song.capoAuto).toBe(true);
  });

  it('AUTO が OFF ならカポを変えない', () => {
    const manual = run(createInitialState(), { type: 'capoShifted', delta: 1 });
    expect(loaded(['G', 'Em', 'C', 'D'], manual).layout.capo).toBe(1);
  });

  it('履歴は新しい順で、同じ曲は先頭へ移動する', () => {
    const state = loaded(['G'], loaded(['C']));
    expect(state.song.recents).toHaveLength(1);
    expect(state.song.recents[0]).toMatchObject({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Test',
    });
  });

  it('読み込み直すとループと再生状態をリセットする', () => {
    const looping = run(
      loaded(['G', 'Em']),
      { type: 'loopCycled', t: 1 },
      { type: 'loopCycled', t: 3 },
    );
    expect(looping.song.loop).toEqual({ kind: 'ab', a: 1, b: 3 });
    const reloading = run(looping, { type: 'songLoadStarted', media: MEDIA });
    expect(reloading.song).toMatchObject({
      loop: { kind: 'off' },
      follow: false,
      load: { status: 'fetching' },
    });
  });

  it('ソースを切り替えるとループを解除する', () => {
    const state = run(
      createInitialState(),
      { type: 'songLoadStarted', media: MEDIA },
      {
        type: 'songLoaded',
        media: MEDIA,
        info: INFO,
        activeSource: 'songle',
        now: 1,
        sources: {
          songle: source(['G', 'Em']),
          analysis: source(['C', 'F'], { id: 'analysis', offsetSec: 0.5 }),
        },
      },
      { type: 'loopCycled', t: 1 },
      { type: 'sourceSelected', source: 'analysis' },
    );
    expect(state.song.loop).toEqual({ kind: 'off' });
    expect(state.song.load).toMatchObject({ activeSource: 'analysis' });
  });

  it('A-B ループ: B は A から 1 拍より後でないと設定できない', () => {
    const a = run(loaded(['G', 'Em']), { type: 'loopCycled', t: 1 });
    expect(run(a, { type: 'loopCycled', t: 1.4 }).song.loop).toEqual({ kind: 'off' });
    expect(run(a, { type: 'loopCycled', t: 1.6 }).song.loop).toEqual({ kind: 'ab', a: 1, b: 1.6 });
  });
});

describe('MIDI / パッド / メトロノーム', () => {
  it('メトロノームはデバイス接続中だけ開始でき、切断で止まる', () => {
    const idle = run(createInitialState(), { type: 'metronomeToggled' });
    expect(idle.metronome.running).toBe(false);
    const running = run(
      idle,
      { type: 'deviceConnectionChanged', connection: 'ready' },
      { type: 'metronomeToggled' },
    );
    expect(running.metronome.running).toBe(true);
    expect(
      run(running, { type: 'deviceConnectionChanged', connection: 'none' }).metronome.running,
    ).toBe(false);
  });

  it('切断すると本体で押していたパッドだけ解放する', () => {
    const state = run(
      createInitialState(),
      { type: 'padPressed', pressId: 'device:11', padIndex: 0, note: 36 },
      { type: 'padPressed', pressId: 'pointer:1', padIndex: 1, note: 37 },
      { type: 'deviceConnectionChanged', connection: 'none' },
    );
    expect(state.held.map((h) => h.pressId)).toEqual(['pointer:1']);
  });

  it('同じ音のパッドを 2 つ押しても別々に管理する', () => {
    const state = run(
      createInitialState(),
      { type: 'padPressed', pressId: 'pointer:1', padIndex: 5, note: 41 },
      { type: 'padPressed', pressId: 'pointer:2', padIndex: 8, note: 41 },
      { type: 'padReleased', pressId: 'pointer:1' },
    );
    expect(state.held).toEqual([{ pressId: 'pointer:2', padIndex: 8, note: 41 }]);
  });

  it('ユーザーが選んだポート名を覚える（未選択は空文字）', () => {
    const ports = run(createInitialState(), {
      type: 'midiPortsChanged',
      outputs: [{ id: 'a', name: 'Launchpad X' }],
      selectedOutputId: 'a',
    });
    expect(ports.midi.preferredName).toBeNull();
    expect(run(ports, { type: 'deviceSelectedByUser', outputId: 'a' }).midi.preferredName).toBe(
      'Launchpad X',
    );
    expect(run(ports, { type: 'deviceSelectedByUser', outputId: null }).midi.preferredName).toBe(
      '',
    );
  });

  it('BPM と音量は範囲内に丸める', () => {
    const state = run(
      createInitialState(),
      { type: 'bpmChanged', bpm: 999 },
      { type: 'volumeChanged', volume: -5 },
    );
    expect(state.metronome.bpm).toBe(240);
    expect(state.audio.volume).toBe(0);
  });
});

describe('設定の復元', () => {
  it('保存した設定を往復できる', () => {
    const state = run(
      createInitialState(),
      { type: 'rootSelected', root: 9 },
      { type: 'chordTypeSelected', chordType: 'min7' },
      { type: 'displayToggled', key: 'showInversion' },
      { type: 'inversionSelected', inversion: 2 },
      { type: 'capoShifted', delta: -2 },
      { type: 'octaveShifted', delta: 1 },
      { type: 'instrumentSelected', instrument: 'organ' },
      { type: 'bpmChanged', bpm: 90 },
    );
    const settings = JSON.parse(JSON.stringify(selectPersistedSettings(state))) as unknown;
    const restored = createInitialState({ ...EMPTY_PERSISTED, settings });
    expect(selectPersistedSettings(restored)).toEqual(selectPersistedSettings(state));
    expect(restored.layout).toEqual(state.layout);
  });

  it('旧バージョンの保存データを読める', () => {
    const settings = {
      root: 2,
      chordType: 'maj7',
      inversion: 1,
      scale: 'penta_min',
      instrument: 'epiano',
      showChord: false,
      showScale: true,
      showInversion: true,
      baseNote: 43,
      capo: 7,
      volume: 80,
      bpm: 100,
    };
    const state = createInitialState({
      settings,
      deviceName: 'Launchpad X',
      songVolume: '65',
      recents: [{ url: 'https://youtu.be/x', title: 't' }, 5],
    });
    expect(state.layout).toEqual({ openBaseNote: 36, capo: 7 });
    expect(state.manual).toEqual({ root: 2, chordType: 'maj7', inversion: 1, scale: 'penta_min' });
    expect(state.audio).toMatchObject({ instrument: 'epiano', volume: 80 });
    expect(state.midi.preferredName).toBe('Launchpad X');
    expect(state.song.volume).toBe(65);
    expect(state.song.recents).toEqual([
      { url: 'https://youtu.be/x', title: 't', artist: '', at: 0 },
    ]);
  });

  it('壊れた値・範囲外の値はデフォルトに戻す', () => {
    const state = createInitialState({
      settings: {
        root: 12,
        chordType: 'constructor',
        inversion: 9,
        scale: 'x',
        baseNote: 115,
        capo: 3,
        volume: 101,
        bpm: '120',
      },
      deviceName: null,
      songVolume: 'abc',
      recents: 'nope',
    });
    expect(state.manual).toEqual({ root: 0, chordType: 'maj', inversion: 0, scale: 'major' });
    // 旧バージョンで保存できた高すぎる baseNote はオクターブ単位で範囲内に戻す
    expect(selectBaseNote(state)).toBe(115 - 36);
    expect(state.audio.volume).toBe(50);
    expect(state.metronome.bpm).toBe(120);
    expect(state.song.volume).toBe(40);
    expect(createInitialState({ ...EMPTY_PERSISTED, settings: 'garbage' })).toEqual(
      createInitialState(),
    );
  });
});
