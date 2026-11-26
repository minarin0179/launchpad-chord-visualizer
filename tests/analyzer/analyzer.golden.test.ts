import { describe, expect, it } from 'vitest';
import { decodeChords, trebleVariantKey } from '../../src/analyzer/decode.ts';
import { downsample } from '../../src/analyzer/dsp.ts';
import { extractFeatures, remapTimes } from '../../src/analyzer/features.ts';
import {
  ANALYSIS_PHASES,
  type AnalysisPhase,
  type DecodeOptions,
  type Features,
} from '../../src/analyzer/types.ts';
import type { Key } from '../../src/core/key.ts';
import { loadGolden, segmentFromLegacy, type LegacySegment } from '../helpers/golden.ts';
import { SYNTH_PROGRESSION, synthSignal } from '../helpers/synth-signal.ts';

interface Case {
  name: string;
  sampleRate: number;
  channels: 1 | 2;
  timeScale: number;
  phases: AnalysisPhase[];
  features: Features;
  decoded: {
    options: Partial<DecodeOptions>;
    result: { key: Key; tempo: number; trebleKey: string; segments: LegacySegment[] };
  }[];
  remapped: Features;
}

const golden = loadGolden<Case[]>('analyzer');

describe.each(golden)('解析 $name（旧 analyzer.js と一致）', (c) => {
  const signal = synthSignal(c.sampleRate, c.channels);

  it('extractFeatures', () => {
    const phases: AnalysisPhase[] = [];
    const features = extractFeatures(
      c.channels === 1 ? signal[0] : signal,
      c.sampleRate,
      { timeScale: c.timeScale },
      (phase) => {
        if (phases.at(-1) !== phase) phases.push(phase);
      },
    );
    expect(phases).toEqual(c.phases);
    expect(ANALYSIS_PHASES).toEqual(expect.arrayContaining(phases));
    expect(features).toEqual(c.features);
    expect(remapTimes(features, (t) => t * 1.5 + 0.25)).toEqual(c.remapped);
  });

  it.each(c.decoded.map((d) => [JSON.stringify(d.options), d] as const))(
    'decodeChords %s',
    (_name, d) => {
      const result = decodeChords(c.features, d.options);
      expect(result.key).toEqual(d.result.key);
      expect(result.tempo).toBe(d.result.tempo);
      expect(result.trebleKey).toBe(d.result.trebleKey);
      expect(result.segments).toEqual(d.result.segments.map(segmentFromLegacy));
    },
  );
});

describe('解析の頑健性（旧実装からの修正点）', () => {
  it('合成音源のコード進行を検出できる', () => {
    const { features } = golden.find((c) => c.name === 'stereo-44100')!;
    const { segments } = decodeChords(features);
    // メロディの音でコードの種類は揺れる（Am → Am7 など）ので、ルート音の並びだけを比べる
    const roots = segments.map((s) => s.chord?.root).filter((root, i, all) => root !== all[i - 1]);
    expect(roots).toEqual(SYNTH_PROGRESSION.map((p) => p.root));
    expect(segments[0]?.label).toBe('C');
  });

  it('空の入力でも NaN を出さない', () => {
    const features = extractFeatures(new Float32Array(0), 44100);
    expect(JSON.stringify(features)).not.toContain('null');
    expect(features.bounds).toEqual([0, 0]);
    expect(() => decodeChords(features)).not.toThrow();
  });

  it('ごく短い入力でも NaN を出さない', () => {
    const features = extractFeatures(new Float32Array(100).fill(0.1), 22050);
    expect(JSON.stringify(features)).not.toContain('null');
  });

  it('48 kHz の入力も 22.05 kHz に落とす（旧実装は 24 kHz になっていた）', () => {
    const input = Float32Array.from({ length: 48000 }, (_, i) =>
      Math.sin((2 * Math.PI * 440 * i) / 48000),
    );
    const { samples, sampleRate } = downsample(input, 48000);
    expect(sampleRate).toBe(22050);
    expect(samples.length).toBe(22050);
    // 440 Hz の正弦波がそのままの周波数・振幅で残る
    const expected = (i: number): number => Math.sin((2 * Math.PI * 440 * i) / 22050);
    for (let i = 2000; i < 20000; i += 997) expect(samples[i]).toBeCloseTo(expected(i), 2);
  });

  it('48 kHz と 44.1 kHz で同じコード進行になる', () => {
    const at = (rate: number): (number | undefined)[] =>
      decodeChords(extractFeatures(synthSignal(rate, 2), rate)).segments.map((s) => s.chord?.root);
    expect(at(48000)).toEqual(at(44100));
  });

  it('センターカットできない音源は mid にフォールバックする', () => {
    expect(
      trebleVariantKey({ sideAvailable: false }, { centerCut: true, hpss: true, melody: false }),
    ).toBe('mid-h');
    expect(
      trebleVariantKey({ sideAvailable: true }, { centerCut: true, hpss: false, melody: true }),
    ).toBe('side-m');
  });
});
