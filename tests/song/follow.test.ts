import { describe, expect, it } from 'vitest';
import type { Segment } from '../../src/core/segments.ts';
import { computeCursor } from '../../src/song/follow.ts';
import { cycleLoop, loopSeekTarget } from '../../src/song/loop.ts';
import { createPlaybackClock, ProgressInterpolator } from '../../src/song/media/clock.ts';
import { parseSongleChord } from '../../src/song/sources/songle-chord.ts';
import { mediaFromLocation, searchForMedia } from '../../src/song/url-params.ts';

/** [開始, 終了, コード名] からセグメントを作る */
const segmentsOf = (...defs: [number, number, string][]): Segment[] =>
  defs.map(([start, end, name]) => ({ start, end, ...parseSongleChord(name) }));

// 120 BPM（1 拍 = 0.5 秒）
const BEAT = 0.5;
const SEGMENTS = segmentsOf(
  [0, 2, 'C'],
  [2, 4, 'Am'],
  [4, 6, 'N'],
  [6, 8, 'F'],
  [8, 10, 'F'],
  [12, 14, 'G'],
);
const at = (
  t: number,
  flags: Partial<{ follow: boolean; practice: boolean; playing: boolean }> = {},
) =>
  computeCursor({
    segments: SEGMENTS,
    t,
    beatSec: BEAT,
    follow: true,
    practice: false,
    playing: true,
    ...flags,
  });

describe('computeCursor', () => {
  it('再生位置の区間を返す', () => {
    expect(at(0).segmentIndex).toBe(0);
    expect(at(2).segmentIndex).toBe(1);
    expect(at(10.5).segmentIndex).toBe(-1); // すき間
    expect(at(99).segmentIndex).toBe(-1);
  });

  it('次のコードの 1 拍前から予告する', () => {
    expect(at(1.4).previewIndex).toBeNull();
    expect(at(1.5).previewIndex).toBe(1);
    expect(at(1.99).previewIndex).toBe(1);
    expect(at(2).previewIndex).toBeNull();
  });

  it('次が N.C.・同じコードのときは予告しない', () => {
    expect(at(3.8).previewIndex).toBeNull(); // Am → N.C.
    expect(at(7.8).previewIndex).toBeNull(); // F → F
  });

  it('N.C. からコードへ、すき間からコードへも予告する', () => {
    expect(at(5.8).previewIndex).toBe(3); // N.C. → F
    expect(at(11.8).previewIndex).toBe(5); // すき間 → G（旧実装は曲頭のコードを見ていて予告できなかった）
  });

  it('FOLLOW OFF・停止中は予告しない', () => {
    expect(at(1.8, { follow: false }).previewIndex).toBeNull();
    expect(at(1.8, { playing: false }).previewIndex).toBeNull();
  });

  it('練習モードは 0.5 拍前倒しで切り替え、予告もその 1 拍前から', () => {
    expect(at(1.74, { practice: true }).segmentIndex).toBe(0);
    expect(at(1.75, { practice: true }).segmentIndex).toBe(1);
    expect(at(1.2, { practice: true }).previewIndex).toBeNull();
    expect(at(1.25, { practice: true }).previewIndex).toBe(1);
  });
});

describe('A-B ループ', () => {
  it('なし → A → A-B → なし', () => {
    const a = cycleLoop({ kind: 'off' }, 10, BEAT);
    expect(a).toEqual({ kind: 'a', a: 10 });
    const ab = cycleLoop(a, 12, BEAT);
    expect(ab).toEqual({ kind: 'ab', a: 10, b: 12 });
    expect(cycleLoop(ab, 13, BEAT)).toEqual({ kind: 'off' });
  });

  it('B が A から 1 拍以内なら解除する', () => {
    expect(cycleLoop({ kind: 'a', a: 10 }, 10.5, BEAT)).toEqual({ kind: 'off' });
    expect(cycleLoop({ kind: 'a', a: 10 }, 9, BEAT)).toEqual({ kind: 'off' });
  });

  it('再生中に B を越えたら A に戻る', () => {
    const loop = { kind: 'ab', a: 10, b: 12 } as const;
    expect(loopSeekTarget(loop, 11.9, true)).toBeNull();
    expect(loopSeekTarget(loop, 12, true)).toBe(10);
    expect(loopSeekTarget(loop, 12.5, false)).toBeNull();
    expect(loopSeekTarget({ kind: 'a', a: 10 }, 99, true)).toBeNull();
  });
});

describe('再生時刻', () => {
  it('報告のばらつきをならして一定速度で進む', () => {
    let nowMs = 0;
    let raw = 0;
    const clock = createPlaybackClock({ rawTime: () => raw, isPlaying: () => true }, () => nowMs);
    clock.time();
    const steps: number[] = [];
    let previous = 0;
    for (let frame = 1; frame <= 120; frame++) {
      nowMs = frame * 16;
      // 実際の位置 ± 30 ms の報告
      raw = nowMs / 1000 + (frame % 2 === 0 ? 0.03 : -0.03);
      const t = clock.time();
      steps.push(t - previous);
      previous = t;
    }
    // 1 フレームの進みは 16 ms ± 5%（報告の ±30 ms の跳びが出ない）
    for (const step of steps.slice(1)) expect(step).toBeGreaterThan(0.0149);
    for (const step of steps.slice(1)) expect(step).toBeLessThan(0.0171);
    expect(Math.abs(previous - nowMs / 1000)).toBeLessThan(0.05);
  });

  it('大きく跳んだら（シークなど）すぐ合わせる', () => {
    let nowMs = 0;
    let raw = 5;
    const clock = createPlaybackClock({ rawTime: () => raw, isPlaying: () => true }, () => nowMs);
    expect(clock.time()).toBe(5);
    nowMs = 16;
    raw = 60;
    expect(clock.time()).toBe(60);
  });

  it('シーク直後は、プレイヤーの報告が追いつくまでシーク先の時刻を返す', () => {
    let nowMs = 0;
    let raw = 12;
    const clock = createPlaybackClock({ rawTime: () => raw, isPlaying: () => true }, () => nowMs);
    clock.time();
    clock.notifySeek(10);
    nowMs = 100;
    expect(clock.time()).toBe(10); // プレイヤーはまだ 12 秒付近を報告している
    nowMs = 200;
    raw = 10.1;
    expect(clock.time()).toBeCloseTo(10.1);
    // 報告が追いつかないまま 1 秒たったら、報告を信じる
    clock.notifySeek(30);
    nowMs = 1300;
    expect(clock.time()).toBeCloseTo(10.1);
  });

  it('間隔の粗い報告を経過時間で補間する', () => {
    let nowMs = 0;
    const progress = new ProgressInterpolator(() => nowMs);
    progress.report(3);
    nowMs = 500;
    expect(progress.time()).toBe(3); // 停止中は進まない
    progress.setPlaying(true);
    nowMs = 1000;
    expect(progress.time()).toBeCloseTo(3.5);
    progress.setPlaying(false);
    nowMs = 2000;
    expect(progress.time()).toBeCloseTo(3.5);
  });
});

describe('URL パラメータ', () => {
  it('?v= と ?url= から曲を決める', () => {
    expect(mediaFromLocation('?v=dQw4w9WgXcQ')).toMatchObject({
      kind: 'youtube',
      id: 'dQw4w9WgXcQ',
    });
    expect(mediaFromLocation('?url=https%3A%2F%2Fwww.nicovideo.jp%2Fwatch%2Fsm9')).toMatchObject({
      kind: 'niconico',
      id: 'sm9',
    });
    expect(mediaFromLocation('?url=hello')).toBeNull(); // URL でないものは読み込まない（旧実装は検索を始めていた）
    expect(mediaFromLocation('')).toBeNull();
  });

  it('読み込んだ曲を反映し、他のパラメータは残す', () => {
    const youtube = mediaFromLocation('?v=dQw4w9WgXcQ')!;
    const niconico = mediaFromLocation('?url=nico.ms/sm9')!;
    expect(searchForMedia('?clockdebug=1&url=x', youtube)).toBe('?clockdebug=1&v=dQw4w9WgXcQ');
    expect(mediaFromLocation(searchForMedia('?v=abc', niconico))).toEqual(niconico);
  });
});
