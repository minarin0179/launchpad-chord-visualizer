import { describe, expect, it } from 'vitest';
import {
  chordDisplay,
  chordOf,
  makeChord,
  NO_CHORD,
  type ChordSpec,
  type EffectiveChord,
} from '../../src/core/chord.ts';
import { buildPads } from '../../src/core/grid.ts';
import { classifyPads, type PadRole } from '../../src/core/pad-roles.ts';
import { mod12, noteLabel, noteName } from '../../src/core/pitch.ts';
import { isChordTypeKey, isScaleKey, SCALES } from '../../src/core/theory.ts';
import { loadGolden } from '../helpers/golden.ts';

interface LegacyState {
  baseNote: number;
  root: number;
  chordType: string;
  inversion: number;
  showInversion: boolean;
  showChord: boolean;
  showScale: boolean;
  scale: string;
  follow?: boolean;
  practice?: boolean;
  chordOverride?: {
    none?: boolean;
    intervals?: number[];
    symbol?: string;
    bassPC?: number | null;
  } | null;
  scaleRoot?: number | null;
  preview?: { rootPC: number; pcs: number[]; intervals: number[]; bassPC: number | null } | null;
  previewLit?: boolean;
}

interface Case {
  input: LegacyState;
  screen: string;
  led: string;
  display: { chordName: string; noteNames: string; intNames: string; scaleKeyLabel: string };
}

const golden = loadGolden<{ roleCode: Record<PadRole, string>; cases: Case[] }>('pad-roles');

function effectiveChord(s: LegacyState): EffectiveChord {
  if (!isChordTypeKey(s.chordType)) throw new Error(s.chordType);
  const ov = s.chordOverride;
  if (ov?.none) return NO_CHORD;
  const base = chordOf(s.root, s.chordType, ov?.bassPC ?? null);
  const spec = makeChord(
    base.root,
    base.type,
    ov?.intervals ?? base.intervals,
    ov?.symbol ?? base.symbol,
    base.bass,
  );
  return { kind: 'chord', spec, inversion: s.inversion, origin: s.follow ? 'song' : 'manual' };
}

function previewChord(s: LegacyState): ChordSpec | null {
  const p = s.preview;
  return p ? makeChord(p.rootPC, 'maj', p.intervals, '', p.bassPC) : null;
}

function scalePitchClasses(s: LegacyState): number[] {
  if (!isScaleKey(s.scale)) throw new Error(s.scale);
  const root = s.scaleRoot ?? s.root;
  return SCALES[s.scale].intervals.map((interval) => mod12(root + interval));
}

function classify(s: LegacyState) {
  const practice = s.practice ?? false;
  return classifyPads({
    pads: buildPads(s.baseNote),
    baseNote: s.baseNote,
    chord: effectiveChord(s),
    showInversion: s.showInversion,
    // 練習モードはコードトーンを常に表示し、スケールを消す（旧 createPadClassifier と同じ規則）
    showChord: s.showChord || practice,
    scale: s.showScale && !practice ? scalePitchClasses(s) : null,
    practice,
    preview: previewChord(s),
  });
}

describe('classifyPads（旧 createPadClassifier の出力と一致）', () => {
  it.each(golden.cases.map((c, i) => [i, c] as const))('case %i', (_i, c) => {
    const visuals = classify(c.input);
    const code = (role: PadRole): string => golden.roleCode[role];
    expect(visuals.map((v) => code(v.role)).join('')).toBe(c.screen);
    // LED は点滅の消灯フェーズで under を出す
    const lit = c.input.previewLit ?? true;
    expect(visuals.map((v) => code(lit ? v.role : v.under)).join('')).toBe(c.led);
  });
});

describe('chordDisplay（旧 getChordDisplayData の出力と一致）', () => {
  it.each(golden.cases.map((c, i) => [i, c] as const))('case %i', (_i, c) => {
    const s = c.input;
    const display = chordDisplay(effectiveChord(s), s.showInversion);
    expect(display.name).toBe(c.display.chordName);
    expect(display.notes).toBe(c.display.noteNames);
    expect(display.intervals).toBe(c.display.intNames);

    if (!isScaleKey(s.scale)) throw new Error(s.scale);
    const base = `[Base: ${noteLabel(s.baseNote)}]`;
    const scaleRoot = s.scaleRoot ?? s.root;
    const label = s.showScale
      ? `${noteName(scaleRoot)} ${SCALES[s.scale].label} Scale  ${base}`
      : base;
    expect(label).toBe(c.display.scaleKeyLabel);
  });
});
