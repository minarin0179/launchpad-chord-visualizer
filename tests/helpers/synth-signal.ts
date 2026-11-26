import { createRng } from './random.ts';

/** テスト用の合成音源で鳴らすコード進行（1 コード = 4 拍） */
export const SYNTH_PROGRESSION = [
  { name: 'C', root: 0, intervals: [0, 4, 7] },
  { name: 'Am', root: 9, intervals: [0, 3, 7] },
  { name: 'F', root: 5, intervals: [0, 4, 7] },
  { name: 'G7', root: 7, intervals: [0, 4, 7, 10] },
  { name: 'Em7', root: 4, intervals: [0, 3, 7, 10] },
  { name: 'FM7', root: 5, intervals: [0, 4, 7, 11] },
  { name: 'Dm', root: 2, intervals: [0, 3, 7] },
  { name: 'G', root: 7, intervals: [0, 4, 7] },
] as const;

export const SYNTH_BPM = 120;
const BEATS_PER_CHORD = 4;
const MELODY_STEPS = [12, 14, 16, 19, 16, 14, 12, 7];

const midiToFreq = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/**
 * コード進行を鳴らした合成音（ベース + 和音 + メロディ + 拍ごとのクリック）を返す。
 * 和音は左右に振り分け、メロディは中央に置く（センターカットの検証用）。
 * channels = 1 のときは L/R の平均を返す。
 */
export function synthSignal(sampleRate: number, channels: 1 | 2): Float32Array[] {
  const beatSec = 60 / SYNTH_BPM;
  const chordSec = beatSec * BEATS_PER_CHORD;
  const n = Math.round(SYNTH_PROGRESSION.length * chordSec * sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const rng = createRng(12345);
  const noise = Float32Array.from(
    { length: Math.round(0.03 * sampleRate) },
    () => rng.next() * 2 - 1,
  );

  const addTone = (
    freq: number,
    startSec: number,
    lengthSec: number,
    gainL: number,
    gainR: number,
    harmonics: number,
  ): void => {
    const start = Math.round(startSec * sampleRate);
    const len = Math.round(lengthSec * sampleRate);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 1.2);
      let v = 0;
      for (let h = 1; h <= harmonics; h++) v += Math.sin(2 * Math.PI * freq * h * t) / h;
      left[start + i] += v * env * gainL;
      right[start + i] += v * env * gainR;
    }
  };

  SYNTH_PROGRESSION.forEach((chord, c) => {
    const t0 = c * chordSec;
    addTone(midiToFreq(36 + chord.root), t0, chordSec, 0.25, 0.25, 3);
    chord.intervals.forEach((iv, k) => {
      const pan = k % 2 === 0 ? 0.8 : 0.2;
      addTone(
        midiToFreq(60 + ((chord.root + iv) % 12)),
        t0,
        chordSec,
        0.12 * pan,
        0.12 * (1 - pan),
        4,
      );
    });
    for (let b = 0; b < BEATS_PER_CHORD; b++) {
      const step = MELODY_STEPS[(c * BEATS_PER_CHORD + b) % MELODY_STEPS.length];
      addTone(midiToFreq(60 + step), t0 + b * beatSec, beatSec * 0.9, 0.1, 0.1, 2);
      const start = Math.round((t0 + b * beatSec) * sampleRate);
      for (let i = 0; i < noise.length && start + i < n; i++) {
        const v = noise[i] * 0.3 * (1 - i / noise.length);
        left[start + i] += v;
        right[start + i] += v;
      }
    }
  });

  if (channels === 2) return [left, right];
  return [left.map((v, i) => (v + right[i]) / 2)];
}
