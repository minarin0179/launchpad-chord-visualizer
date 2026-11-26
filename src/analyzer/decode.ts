/**
 * デコード — ビート同期の特徴量からコード進行を推定する。
 *
 *   キー推定 → テンプレート照合 → Viterbi 平滑化 → セグメント化
 *
 * ビート単位の特徴量だけを使うので軽く、パラメータ変更時に即再計算できる。
 */
import { chordOf, NO_CHORD_LABEL, type ChordSpec } from '../core/chord';
import { keyFromProfile, type Key } from '../core/key';
import { mod12, noteName, SEMITONES } from '../core/pitch';
import type { Segment } from '../core/segments';
import { CHORD_TYPES, MAJOR_SCALE_INTERVALS } from '../core/theory';
import {
  DEFAULT_DECODE_VALUES,
  KEY_BASS_WEIGHT,
  MAX_STAY_PROBABILITY,
  MIN_STAY_PROBABILITY,
  NO_CHORD_BASS_SHARE,
  NO_CHORD_OFFSET,
  SILENCE_RATIO,
  SILENCE_SCORE,
  TEMPLATE_EXTENSION_WEIGHT,
  TRIAD_SIZE,
  VOCABULARIES,
  type VocabularyDef,
} from './constants';
import type {
  BassVariant,
  BeatChroma,
  DecodeOptions,
  DecodeResult,
  Features,
  TrebleVariant,
  Vocabulary,
} from './types';

export const DEFAULT_DECODE_OPTIONS: Readonly<DecodeOptions> = Object.freeze({
  ...DEFAULT_DECODE_VALUES,
});

export function isVocabulary(value: unknown): value is Vocabulary {
  return typeof value === 'string' && Object.hasOwn(VOCABULARIES, value);
}

/** 高音域クロマのバリアント名（保存形式のキー）を組み立てる */
export function variantKey(source: 'mid' | 'side', hpss: boolean, melody: boolean): TrebleVariant {
  if (source === 'mid') {
    if (hpss) return melody ? 'mid-h-m' : 'mid-h';
    return melody ? 'mid-m' : 'mid';
  }
  if (hpss) return melody ? 'side-h-m' : 'side-h';
  return melody ? 'side-m' : 'side';
}

/** 分離オプションに対応する高音域クロマ（センターカットできない音源では mid にフォールバック） */
export function trebleVariantKey(
  features: Pick<Features, 'sideAvailable'>,
  { centerCut, hpss, melody }: Pick<DecodeOptions, 'centerCut' | 'hpss' | 'melody'>,
): TrebleVariant {
  return variantKey(centerCut && features.sideAvailable ? 'side' : 'mid', hpss, melody);
}

function bassVariantKey(hpss: boolean): BassVariant {
  return hpss ? 'mid-h' : 'mid';
}

/** HMM の状態 = 1 つのコード */
interface ChordState {
  readonly chord: ChordSpec;
  readonly label: string;
  readonly penalty: number;
  /** 正規化済みの 12 次元テンプレート */
  readonly template: Float64Array;
  /** 構成音がすべて推定キーのスケールに含まれる */
  readonly diatonic: boolean;
}

function buildStates(vocabulary: VocabularyDef, diatonic: ReadonlySet<number>): ChordState[] {
  const states: ChordState[] = [];
  for (const [type, penalty] of vocabulary) {
    const { intervals, symbol } = CHORD_TYPES[type];
    for (let root = 0; root < SEMITONES; root++) {
      const template = new Float64Array(SEMITONES);
      intervals.forEach((interval, index) => {
        template[mod12(root + interval)] = index >= TRIAD_SIZE ? TEMPLATE_EXTENSION_WEIGHT : 1;
      });
      const norm = Math.sqrt(template.reduce((sum, v) => sum + v * v, 0));
      for (let pc = 0; pc < SEMITONES; pc++) template[pc] /= norm;
      states.push({
        chord: chordOf(root, type),
        label: noteName(root) + symbol,
        penalty,
        template,
        diatonic: intervals.every((interval) => diatonic.has(mod12(root + interval))),
      });
    }
  }
  return states;
}

/** 状態数 stateCount の HMM で最尤の状態列を返す（遷移は「留まる」か「どこかへ移る」の 2 種類だけ） */
function viterbi(
  emissions: Float64Array,
  beatCount: number,
  stateCount: number,
  stayProbability: number,
): Int32Array {
  const p = Math.min(MAX_STAY_PROBABILITY, Math.max(MIN_STAY_PROBABILITY, stayProbability));
  const stay = Math.log(p);
  const move = Math.log((1 - p) / (stateCount - 1));
  let delta = emissions.slice(0, stateCount);
  let next = new Float64Array(stateCount);
  const back = new Int32Array(beatCount * stateCount);

  for (let t = 1; t < beatCount; t++) {
    let best = 0;
    for (let s = 1; s < stateCount; s++) if (delta[s] > delta[best]) best = s;
    for (let s = 0; s < stateCount; s++) {
      const viaStay = delta[s] + stay;
      const viaMove = delta[best] + move;
      if (viaStay >= viaMove) {
        next[s] = viaStay;
        back[t * stateCount + s] = s;
      } else {
        next[s] = viaMove;
        back[t * stateCount + s] = best;
      }
      next[s] += emissions[t * stateCount + s];
    }
    [delta, next] = [next, delta];
  }

  const path = new Int32Array(beatCount);
  let state = 0;
  for (let i = 1; i < stateCount; i++) if (delta[i] > delta[state]) state = i;
  for (let t = beatCount - 1; t >= 0; t--) {
    path[t] = state;
    state = back[t * stateCount + state];
  }
  return path;
}

function estimateKey(treble: BeatChroma, bass: BeatChroma): Key {
  const profile = new Array<number>(SEMITONES).fill(0);
  treble.forEach((beat, i) => {
    for (let pc = 0; pc < SEMITONES; pc++) profile[pc] += beat[pc] + KEY_BASS_WEIGHT * bass[i][pc];
  });
  return keyFromProfile(profile);
}

/** 中央値（偶数個のときは上側の値） */
function upperMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function decodeChords(
  features: Features,
  options: Partial<DecodeOptions> = {},
): DecodeResult {
  const opt: DecodeOptions = { ...DEFAULT_DECODE_OPTIONS, ...options };
  const trebleKey = trebleVariantKey(features, opt);
  const treble = features.treble[trebleKey] ?? [];
  const bass = features.bass[bassVariantKey(opt.hpss)];
  const key = estimateKey(treble, bass);
  const beatCount = treble.length;
  if (beatCount === 0) return { key, tempo: features.tempo, trebleKey, segments: [] };

  const diatonic = new Set(
    MAJOR_SCALE_INTERVALS.map((interval) => mod12(key.tonicMajor + interval)),
  );
  // 保存データ由来の未知の値でも落ちないよう、不明な vocabulary は full として扱う
  const states = buildStates(
    VOCABULARIES[isVocabulary(opt.vocabulary) ? opt.vocabulary : 'full'],
    diatonic,
  );
  const stateCount = states.length + 1;
  const noChordState = stateCount - 1;
  const silentLevel = SILENCE_RATIO * upperMedian(features.energy);
  const flatNorm = Math.sqrt(SEMITONES);

  const emissions = new Float64Array(beatCount * stateCount);
  for (let i = 0; i < beatCount; i++) {
    const t = treble[i];
    const b = bass[i];
    let norm = 0;
    let sum = 0;
    let maxBass = 0;
    for (let pc = 0; pc < SEMITONES; pc++) {
      norm += t[pc] * t[pc];
      sum += t[pc];
      if (b[pc] > maxBass) maxBass = b[pc];
    }
    norm = Math.sqrt(norm);

    states.forEach((state, s) => {
      let dot = 0;
      for (let pc = 0; pc < SEMITONES; pc++) dot += t[pc] * state.template[pc];
      const cos = norm > 0 ? dot / norm : 0;
      const bassMatch = maxBass > 0 ? b[state.chord.root] / maxBass : 0;
      const score =
        cos + opt.bassWeight * bassMatch - state.penalty + (state.diatonic ? opt.keyBonus : 0);
      emissions[i * stateCount + s] = opt.beta * score;
    });

    const silent = features.energy[i] < silentLevel;
    const flatCos = norm > 0 ? sum / (flatNorm * norm) : 1;
    emissions[i * stateCount + noChordState] =
      opt.beta *
      (silent ? SILENCE_SCORE : flatCos - NO_CHORD_OFFSET + opt.bassWeight * NO_CHORD_BASS_SHARE);
  }

  const path = viterbi(emissions, beatCount, stateCount, opt.selfTransition);
  const segments: Segment[] = [];
  let start = 0;
  for (let i = 1; i <= beatCount; i++) {
    if (i < beatCount && path[i] === path[start]) continue;
    const state = path[start] === noChordState ? null : states[path[start]];
    segments.push({
      start: features.bounds[start],
      end: features.bounds[i],
      beats: i - start,
      chord: state?.chord ?? null,
      label: state?.label ?? NO_CHORD_LABEL,
    });
    start = i;
  }
  return { key, tempo: features.tempo, trebleKey, segments };
}
