import { describe, expect, it, vi } from 'vitest';
import { createMetronome } from '../src/audio/metronome.ts';
import { chordOf, makeChord, NO_CHORD, type EffectiveChord } from '../src/core/chord.ts';
import { GRID_SIZE as DEVICE_GRID_SIZE } from 'launchpad-x';
import { buildPads, GRID_SIZE } from '../src/core/grid.ts';
import { classifyPads } from '../src/core/pad-roles.ts';
import { mod12 } from '../src/core/pitch.ts';
import { isChordTypeKey, isScaleKey, SCALES } from '../src/core/theory.ts';
import { LOGO_LED, TOP_ROW_LED, type Rgb } from '../src/config/roles.ts';
import {
  buildLedFrame,
  devicePadNumber,
  needsBlink,
  padIndexFromDevice,
} from '../src/led/frame.ts';
import { LedSender } from '../src/led/sender.ts';
import { chooseOutput, matchInput } from '../src/midi/port-selection.ts';
import { loadGolden } from './helpers/golden.ts';

describe('LED フレーム（旧 sendToLaunchpad と一致）', () => {
  interface Case {
    input: {
      baseNote: number;
      root: number;
      chordType: string;
      inversion: number;
      showInversion: boolean;
      showChord: boolean;
      showScale: boolean;
      scale: string;
      practice?: boolean;
      previewLit?: boolean;
      scaleRoot?: number | null;
      chordOverride?: {
        none?: boolean;
        intervals?: number[];
        symbol?: string;
        bassPC?: number | null;
      } | null;
      preview?: { rootPC: number; intervals: number[]; bassPC: number | null } | null;
    };
    ledFrame?: [number, number, number, number][];
  }
  const cases = loadGolden<{ cases: Case[] }>('pad-roles').cases.filter((c) => c.ledFrame);
  const fn = TOP_ROW_LED.fn;
  const off = TOP_ROW_LED.unavailable;
  const topRow: Rgb[] = [fn, fn, fn, fn, off, off, off, off];

  it.each(cases.map((c, i) => [i, c] as const))('case %i', (_i, { input: s, ledFrame }) => {
    if (!isChordTypeKey(s.chordType) || !isScaleKey(s.scale)) throw new Error('bad case');
    const ov = s.chordOverride;
    const base = chordOf(s.root, s.chordType, ov?.bassPC ?? null);
    const chord: EffectiveChord = ov?.none
      ? NO_CHORD
      : {
          kind: 'chord',
          spec: makeChord(
            base.root,
            base.type,
            ov?.intervals ?? base.intervals,
            ov?.symbol ?? base.symbol,
            base.bass,
          ),
          inversion: s.inversion,
          origin: 'manual',
        };
    const practice = s.practice ?? false;
    const pads = buildPads(s.baseNote);
    const scaleRoot = s.scaleRoot ?? s.root;
    const visuals = classifyPads({
      pads,
      baseNote: s.baseNote,
      chord,
      showInversion: s.showInversion,
      showChord: s.showChord || practice,
      scale:
        s.showScale && !practice
          ? SCALES[s.scale].intervals.map((iv) => mod12(scaleRoot + iv))
          : null,
      practice,
      preview: s.preview
        ? makeChord(s.preview.rootPC, 'maj', s.preview.intervals, '', s.preview.bassPC)
        : null,
    });
    const frame = buildLedFrame({
      pads,
      visuals,
      heldNotes: new Set(),
      blinkLit: s.previewLit ?? true,
      topRow,
      logo: LOGO_LED.connected,
    });
    // 旧実装はロゴを別の SysEx で送っていたので、パッド + 上段の 72 個を比べる
    expect(frame.slice(0, 72).map(({ pad, color }) => [pad, ...color])).toEqual(ledFrame);
    expect(frame.at(-1)).toEqual({ pad: 99, color: LOGO_LED.connected });
  });

  it('押している音と同じ音のパッドはすべて白', () => {
    const pads = buildPads(36);
    const visuals = pads.map(() => ({ role: 'off', under: 'off' }) as const);
    const frame = buildLedFrame({
      pads,
      visuals,
      heldNotes: new Set([41]),
      blinkLit: true,
      topRow,
      logo: [0, 0, 0],
    });
    const white = frame
      .filter((cell) => cell.color[0] === 127 && cell.color[1] === 127)
      .map((cell) => cell.pad);
    expect(white).toEqual([16, 21]); // 最下段の F2 と 2 段目左端の F2
    expect(needsBlink(visuals)).toBe(false);
  });

  it('パッドグリッドの大きさがデバイスと一致する', () => {
    expect(GRID_SIZE).toBe(DEVICE_GRID_SIZE);
    expect(devicePadNumber({ row: 7, col: 7 })).toBe(88);
  });

  it('Launchpad のパッド番号 → パッドの index', () => {
    expect(padIndexFromDevice(11)).toBe(0);
    expect(padIndexFromDevice(18)).toBe(7);
    expect(padIndexFromDevice(88)).toBe(63);
    for (const outside of [10, 19, 89, 91, 99, 9, 0])
      expect(padIndexFromDevice(outside)).toBeNull();
  });
});

describe('LED の差分送信', () => {
  const frame = (colors: Record<number, Rgb>) =>
    Object.entries(colors).map(([pad, color]) => ({ pad: Number(pad), color }));

  it('最初は全部、以降は変わった LED だけ送る', () => {
    const sender = new LedSender();
    const send = vi.fn();
    expect(sender.present(frame({ 11: [1, 2, 3], 12: [0, 0, 0] }), send)).toBe(2);
    expect(sender.present(frame({ 11: [1, 2, 3], 12: [0, 0, 0] }), send)).toBe(0);
    expect(sender.present(frame({ 11: [1, 2, 3], 12: [9, 9, 9] }), send)).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith([{ type: 'rgb', pad: 12, r: 9, g: 9, b: 9 }]);
  });

  it('invalidate 後は全部、assumeCleared 後は消灯以外を送る', () => {
    const sender = new LedSender();
    const send = vi.fn();
    const current = frame({ 11: [1, 2, 3], 12: [0, 0, 0] });
    sender.present(current, send);
    sender.invalidate();
    expect(sender.present(current, send)).toBe(2);
    sender.assumeCleared();
    expect(sender.present(current, send)).toBe(1);
  });
});

describe('MIDI ポートの選択', () => {
  const launchpad = { id: 'a', name: 'Launchpad X' };
  const other = { id: 'b', name: 'Some Synth' };
  const second = { id: 'c', name: 'Launchpad Mini' };

  it('保存した名前 → launchpad を含む名前 → 直前の選択 の順', () => {
    expect(
      chooseOutput([other, launchpad, second], {
        preferredName: 'Launchpad Mini',
        currentId: null,
      }),
    ).toBe('c');
    expect(
      chooseOutput([other, launchpad, second], { preferredName: 'Gone', currentId: 'b' }),
    ).toBe('a');
    expect(chooseOutput([other], { preferredName: null, currentId: 'b' })).toBe('b');
    expect(chooseOutput([other], { preferredName: null, currentId: 'zzz' })).toBeNull();
    expect(chooseOutput([], { preferredName: null, currentId: null })).toBeNull();
  });

  it('「未選択」を選んでいたら自動接続しない', () => {
    expect(chooseOutput([launchpad], { preferredName: '', currentId: null })).toBeNull();
  });

  it.each([
    ['MIDIOUT2 (LPX MIDI)', ['MIDIIN2 (LPX MIDI)', 'LPX MIDI'], 'MIDIIN2 (LPX MIDI)', 'midiin'],
    [
      'Launchpad X LPX MIDI Out',
      ['Other', 'Launchpad X LPX MIDI In'],
      'Launchpad X LPX MIDI In',
      'swap',
    ],
    [
      'Launchpad X MIDI 2',
      ['Launchpad X MIDI 1', 'Launchpad X MIDI 2'],
      'Launchpad X MIDI 2',
      'same-name',
    ],
    ['MIDIOUT3 (LPX MIDI)', ['Something', '2- LPX MIDI'], '2- LPX MIDI', 'base-name'],
    ['Output', ['Keys', 'LPX Input'], 'LPX Input', 'keyword'],
    ['Output', ['Keys', 'Drums'], 'Keys', 'fallback'],
  ])('%s → %s', (outputName, inputNames, expected, strategy) => {
    const inputs = inputNames.map((name, i) => ({ id: String(i), name }));
    const match = matchInput({ id: 'out', name: outputName }, inputs);
    expect(match?.input.name).toBe(expected);
    expect(match?.strategy).toBe(strategy);
  });

  it('入力ポートが無ければ null', () => {
    expect(matchInput(launchpad, [])).toBeNull();
  });
});

describe('メトロノーム', () => {
  function setup(bpm: { value: number }) {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const clicks: { accent: boolean; at: number }[] = [];
    const beats: boolean[] = [];
    const now = (): number => Date.now() / 1000;
    const metronome = createMetronome({
      getBpm: () => bpm.value,
      scheduleClick: (accent, delaySec) =>
        clicks.push({ accent, at: Math.round((now() + delaySec) * 1000) }),
      onBeat: (accent) => beats.push(accent),
      now,
    });
    return { metronome, clicks, beats };
  }

  it('1 拍目だけアクセントで、長く動かしても拍の間隔がずれない', () => {
    const { metronome, clicks, beats } = setup({ value: 120 });
    metronome.start();
    vi.advanceTimersByTime(60_000);
    metronome.stop();
    expect(clicks.slice(0, 5).map((c) => c.accent)).toEqual([true, false, false, false, true]);
    expect(clicks.slice(0, 121).map((c) => c.at)).toEqual(
      Array.from({ length: 121 }, (_, i) => i * 500),
    );
    expect(beats.length).toBeGreaterThanOrEqual(120);
    vi.useRealTimers();
  });

  it('BPM を変えても拍の位置はリセットされず、次の拍から間隔が変わる', () => {
    const bpm = { value: 120 };
    const { metronome, clicks } = setup(bpm);
    metronome.start();
    vi.advanceTimersByTime(1100); // 0, 500, 1000 ms の 3 拍
    bpm.value = 60;
    vi.advanceTimersByTime(3000);
    metronome.stop();
    expect(clicks.map((c) => c.at).slice(0, 6)).toEqual([0, 500, 1000, 1500, 2500, 3500]);
    expect(clicks.map((c) => c.accent).slice(0, 6)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
    ]);
    vi.useRealTimers();
  });

  it('止めたら予約済みのフラッシュも出さない', () => {
    const { metronome, beats } = setup({ value: 120 });
    metronome.start();
    vi.advanceTimersByTime(450);
    metronome.stop();
    const count = beats.length;
    vi.advanceTimersByTime(5000);
    expect(beats).toHaveLength(count);
    vi.useRealTimers();
  });
});
