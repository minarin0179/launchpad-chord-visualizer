import { describe, expect, it } from 'vitest';
import { scaleFitRatio, suggestCapo } from '../../src/core/capo.ts';
import { detectChords } from '../../src/core/detect.ts';
import { buildPads, MAX_BASE_NOTE } from '../../src/core/grid.ts';
import { keyFromProfile, keyLabel, type Key } from '../../src/core/key.ts';
import { MIDI_NOTE_MAX } from '../../src/core/pitch.ts';
import { findSegmentIndex, segmentLabel } from '../../src/core/segments.ts';
import { formatClock, formatClockTenths } from '../../src/core/time-format.ts';
import { loadGolden, segmentFromLegacy, type LegacySegment } from '../helpers/golden.ts';

describe('buildPads（旧 buildPadData と一致）', () => {
  interface LegacyPad {
    row: number;
    col: number;
    semitone: number;
    pitchClass: number;
  }
  const golden = loadGolden<{ baseNote: number; pads: LegacyPad[] }[]>('pads');
  it.each(golden)('baseNote $baseNote', ({ baseNote, pads }) => {
    expect(
      buildPads(baseNote).map(({ row, col, note, pitchClass }) => ({
        row,
        col,
        semitone: note,
        pitchClass,
      })),
    ).toEqual(
      pads.map(({ row, col, semitone, pitchClass }) => ({ row, col, semitone, pitchClass })),
    );
  });

  it('上限の baseNote でも右上パッドが MIDI の範囲に収まる', () => {
    expect(buildPads(MAX_BASE_NOTE).at(-1)?.note).toBe(MIDI_NOTE_MAX);
  });
});

describe('detectChords（旧 detectChordFromActiveNotes と一致）', () => {
  const golden =
    loadGolden<{ notes: number[]; matches: { name: string; exact: boolean }[] }[]>('detect');
  it.each(golden)('$notes', ({ notes, matches }) => {
    expect(detectChords(notes).map(({ name, exact }) => ({ name, exact }))).toEqual(matches);
  });
});

describe('カポ（旧 capo.js と一致）', () => {
  interface Case {
    segments: LegacySegment[];
    suggested: number;
    fit: number[];
    labels: string[][];
  }
  const golden = loadGolden<Case[]>('capo');
  const CAPOS = [0, 1, 5, 11];
  it.each(golden.map((c, i) => [i, c] as const))('case %i', (_i, c) => {
    const segments = c.segments.map(segmentFromLegacy);
    expect(suggestCapo(segments)).toBe(c.suggested);
    c.fit.forEach((ratio, capo) => {
      expect(scaleFitRatio(segments, capo)).toBeCloseTo(ratio, 12);
    });
    CAPOS.forEach((capo, k) => {
      expect(segments.map((s) => segmentLabel(s, capo))).toEqual(c.labels[k]);
    });
  });
});

describe('keyFromProfile（旧 analyzer.js と一致）', () => {
  const golden = loadGolden<{ profile: number[]; key: Key; labels: string[] }[]>('key');
  const CAPOS = [0, 3, 7];
  it.each(golden.map((c, i) => [i, c] as const))('case %i', (_i, c) => {
    const key = keyFromProfile(c.profile);
    expect(key).toEqual(c.key);
    expect(CAPOS.map((capo) => keyLabel(key, capo))).toEqual(c.labels);
  });
});

describe('findSegmentIndex（旧 analyzer.js と一致）', () => {
  const golden = loadGolden<{ segments: LegacySegment[]; lookups: { t: number; index: number }[] }>(
    'find-segment',
  );
  const segments = golden.segments.map(segmentFromLegacy);
  it.each(golden.lookups)('t=$t', ({ t, index }) => {
    expect(findSegmentIndex(segments, t)).toBe(index);
  });
});

describe('時刻の整形', () => {
  it('m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(125)).toBe('2:05');
  });

  it('m:ss.s は 60.0 秒に丸まらず分に繰り上がる（旧実装は 0:60.0 を表示していた）', () => {
    expect(formatClockTenths(59.96)).toBe('1:00.0');
    expect(formatClockTenths(59.94)).toBe('0:59.9');
    expect(formatClockTenths(5.25)).toBe('0:05.3');
    expect(formatClockTenths(0)).toBe('0:00.0');
  });
});
