import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chordOf, makeChord, type ChordSpec } from '../../src/core/chord.ts';
import type { Segment } from '../../src/core/segments.ts';
import { isChordTypeKey } from '../../src/core/theory.ts';

/** リライト前のコードから採取した出力（scripts/capture-golden.mjs が生成）を読む */
export function loadGolden<T>(name: string): T {
  // happy-dom 環境では URL がブラウザ版に差し替わるので、パスで解決する
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../golden/${name}.json`), 'utf8'),
  ) as T;
}

/** 旧形式のコード（Songle パーサ / 旧セグメントが持っていた形） */
export interface LegacyChord {
  root: number | null;
  type: string;
  label: string;
  bass?: number;
  symbol?: string;
  intervals?: number[];
}

export interface LegacySegment extends LegacyChord {
  start: number;
  end: number;
  beats?: number;
}

export function chordFromLegacy(legacy: LegacyChord): ChordSpec | null {
  if (legacy.root === null) return null;
  if (!isChordTypeKey(legacy.type)) throw new Error(`unknown chord type ${legacy.type}`);
  const base = chordOf(legacy.root, legacy.type, legacy.bass ?? null);
  return makeChord(
    base.root,
    base.type,
    legacy.intervals ?? base.intervals,
    legacy.symbol ?? base.symbol,
    base.bass,
  );
}

export function segmentFromLegacy(legacy: LegacySegment): Segment {
  return {
    start: legacy.start,
    end: legacy.end,
    chord: chordFromLegacy(legacy),
    label: legacy.label,
    ...(legacy.beats === undefined ? {} : { beats: legacy.beats }),
  };
}
