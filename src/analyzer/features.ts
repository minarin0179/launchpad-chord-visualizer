/**
 * 特徴量抽出 — 曲全体のオーディオからビート同期のクロマを作る。
 *
 *   ダウンサンプル → オンセット包絡 → ビート追跡
 *   → ピッチサリエンス → クロマ（高音域 / 低音域）→ ビート同期
 *
 * 重いので Worker で実行する。分離処理（センターカット / HPSS / メロディ抑制）の全組み合わせの
 * クロマをここで作っておき、decodeChords 側でオプションに応じて選ぶ。
 */
import { SEMITONES } from '../core/pitch';
import {
  BASS_CENTER,
  BASS_CUTOFF,
  BASS_FFT_SIZE,
  BASS_SIGMA,
  BEAT_SEARCH_FAR,
  BEAT_SEARCH_NEAR,
  BEAT_SKIP_RATIO,
  BEAT_TIGHTNESS,
  CHROMA_HOP,
  DOUBLE_TEMPO_RATIO,
  FALLBACK_BPM,
  GAUSSIAN_EXPONENT,
  HALF,
  HANN_PEAK_DIVISOR,
  HPSS_FREQ_RADIUS,
  HPSS_TIME_RADIUS,
  LOG_GAIN,
  MAX_BPM,
  MELODY_DOMINANCE,
  MELODY_NEIGHBOR_GAIN,
  MELODY_OCTAVE_GAIN,
  MELODY_TWELFTH_GAIN,
  MIDI_HI,
  MIDI_LO,
  MIN_BEAT_GAP_SEC,
  MIN_BPM,
  MIN_LAGS_FOR_TEMPO,
  OCTAVE_SEMITONES,
  ONSET_FFT_SIZE,
  ONSET_HOP,
  ONSET_MEAN_RADIUS_SEC,
  ONSET_PROGRESS_MASK,
  PITCH_COUNT,
  PITCH_MAP_MIN_WIDTH,
  PITCH_MAP_WIDTH_FACTOR,
  ROUND_SCALE,
  SIDE_MIN_RATIO,
  SPECTROGRAM_PROGRESS_MASK,
  TEMPO_PRIOR_BPM,
  TEMPO_PRIOR_OCTAVES,
  TREBLE_FADE_IN_END,
  TREBLE_FADE_IN_START,
  TREBLE_FADE_OUT_END,
  TREBLE_FADE_OUT_START,
  TREBLE_FFT_SIZE,
  TUNING_HZ,
  TUNING_MIDI,
  TWELFTH_SEMITONES,
  VOCAL_HI,
  VOCAL_LO,
  WHITEN_RADIUS,
} from './constants';
import { downsample, FFT } from './dsp';
import type { BeatChroma, ExtractOptions, Features, ProgressCallback } from './types';

const SECONDS_PER_MINUTE = 60;

const roundTo3 = (value: number): number => Math.round(value * ROUND_SCALE) / ROUND_SCALE;

function rms(x: Float32Array | Float64Array): number {
  let sq = 0;
  for (const v of x) sq += v * v;
  return Math.sqrt(sq / (x.length || 1));
}

// =====================
// オンセット包絡
// =====================

interface OnsetEnvelope {
  readonly env: Float64Array;
  /** 包絡のフレームレート（フレーム / 秒） */
  readonly frameRate: number;
}

function subtractLocalMean(x: Float64Array, radius: number): Float64Array {
  const n = x.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n, i + radius + 1);
    out[i] = Math.max(0, x[i] - (prefix[hi] - prefix[lo]) / (hi - lo));
  }
  return out;
}

/** スペクトルフラックス（対数振幅の増加分の合計）から局所平均を引いたもの */
function onsetEnvelope(
  samples: Float32Array,
  sampleRate: number,
  onProgress: (p: number) => void,
): OnsetEnvelope {
  const fft = new FFT(ONSET_FFT_SIZE);
  const nBins = ONSET_FFT_SIZE / 2 + 1;
  const mag = new Float64Array(nBins);
  let prev = new Float64Array(nBins);
  let cur = new Float64Array(nBins);
  const gain = LOG_GAIN / (ONSET_FFT_SIZE / HANN_PEAK_DIVISOR);
  const nFrames = Math.ceil(samples.length / ONSET_HOP);
  const flux = new Float64Array(nFrames);

  for (let t = 0; t < nFrames; t++) {
    fft.magnitude(samples, t * ONSET_HOP - ONSET_FFT_SIZE / 2, mag);
    let sum = 0;
    for (let k = 0; k < nBins; k++) {
      cur[k] = Math.log1p(gain * mag[k]);
      if (t > 0 && cur[k] > prev[k]) sum += cur[k] - prev[k];
    }
    flux[t] = sum;
    [prev, cur] = [cur, prev];
    if ((t & ONSET_PROGRESS_MASK) === 0) onProgress(t / nFrames);
  }

  const frameRate = sampleRate / ONSET_HOP;
  const env = subtractLocalMean(flux, Math.round(frameRate * ONSET_MEAN_RADIUS_SEC));
  const scale = rms(env) || 1;
  for (let i = 0; i < env.length; i++) env[i] /= scale;
  onProgress(1);
  return { env, frameRate };
}

// =====================
// ビート追跡（Ellis 2007 の動的計画法）
// =====================

interface BeatTrack {
  /** ビート時刻（秒） */
  readonly beats: number[];
  /** 録音上の BPM（timeScale 倍速のまま） */
  readonly tempo: number;
}

/** ビート列の抜け（冒頭・末尾・途中の大きな空白）をテンポ周期で補間する */
function fillBeatGaps(detected: readonly number[], periodSec: number, duration: number): number[] {
  const beats = detected.length === 0 ? [0] : detected;
  const out: number[] = [];
  for (let b = beats[0] - periodSec; b > 0; b -= periodSec) out.push(b);
  out.reverse();
  for (let i = 0; i < beats.length; i++) {
    out.push(beats[i]);
    if (i + 1 < beats.length) {
      const gap = beats[i + 1] - beats[i];
      const k = Math.round(gap / periodSec);
      for (let j = 1; j < k; j++) out.push(beats[i] + (gap * j) / k);
    }
  }
  for (let b = beats[beats.length - 1] + periodSec; b < duration; b += periodSec) out.push(b);
  return out;
}

function trackBeats(
  env: Float64Array,
  frameRate: number,
  timeScale: number,
  duration: number,
): BeatTrack {
  const n = env.length;
  const framesPerMinute = frameRate * SECONDS_PER_MINUTE;
  const minLag = Math.max(2, Math.floor(framesPerMinute / (MAX_BPM * timeScale)));
  const maxLag = Math.ceil(framesPerMinute / (MIN_BPM * timeScale));
  if (n < maxLag * MIN_LAGS_FOR_TEMPO) {
    const fallbackPeriod = framesPerMinute / (FALLBACK_BPM * timeScale);
    return {
      beats: fillBeatGaps([], fallbackPeriod / frameRate, duration),
      tempo: FALLBACK_BPM * timeScale,
    };
  }

  // テンポ推定: 自己相関 × TEMPO_PRIOR_BPM 中心の対数ガウス重み
  const acf = new Float64Array(maxLag + 2);
  const scores = new Float64Array(maxLag + 2);
  let bestLag = minLag;
  for (let lag = Math.max(1, Math.floor(minLag / 2) - 1); lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    acf[lag] = s / (n - lag);
    const bpm = framesPerMinute / (lag * timeScale);
    scores[lag] =
      acf[lag] *
      Math.exp(GAUSSIAN_EXPONENT * (Math.log2(bpm / TEMPO_PRIOR_BPM) / TEMPO_PRIOR_OCTAVES) ** 2);
    if (lag >= minLag && lag <= maxLag && scores[lag] > scores[bestLag]) bestLag = lag;
  }
  // 倍テンポにも十分な周期性があれば速い方を採用する
  // （スネアの 2・4 拍で半テンポに引っ張られると、2 拍ごとのコードチェンジを取りこぼすため）
  let halfLag = Math.round(bestLag / 2);
  for (const l of [halfLag - 1, halfLag + 1]) if (l >= minLag && acf[l] > acf[halfLag]) halfLag = l;
  if (halfLag >= minLag && acf[halfLag] >= DOUBLE_TEMPO_RATIO * acf[bestLag]) bestLag = halfLag;

  // 自己相関のピークを放物線補間して周期を小数精度にする
  let period = bestLag;
  const a = acf[bestLag - 1];
  const b = acf[bestLag];
  const c = acf[bestLag + 1];
  const denom = a - 2 * b + c;
  if (denom < 0) period += (HALF * (a - c)) / denom;

  // DP: score[t] = onset[t] + max_p (score[p] − tightness × log((t − p) / period)²)
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const farthest = Math.round(BEAT_SEARCH_FAR * period);
  const nearest = Math.max(1, Math.round(period * BEAT_SEARCH_NEAR));
  for (let t = 0; t < n; t++) {
    let best = 0;
    let bestIndex = -1;
    for (let p = Math.max(0, t - farthest); p <= t - nearest; p++) {
      const v = score[p] - BEAT_TIGHTNESS * Math.log((t - p) / period) ** 2;
      if (v > best) {
        best = v;
        bestIndex = p;
      }
    }
    score[t] = env[t] + best;
    back[t] = bestIndex;
  }

  let last = Math.max(0, n - Math.round(period));
  for (let i = last; i < n; i++) if (score[i] > score[last]) last = i;
  const frames: number[] = [];
  for (let t = last; t >= 0; t = back[t]) frames.push(t);
  frames.reverse();

  return {
    beats: fillBeatGaps(
      frames.map((f) => f / frameRate),
      period / frameRate,
      duration,
    ),
    tempo: framesPerMinute / period,
  };
}

/** ビート時刻 → 区間の境界 [0, …, duration]（近すぎるビート・曲末ぎりぎりのビートは捨てる） */
function beatBounds(beats: readonly number[], duration: number): number[] {
  const bounds = [0];
  for (const b of beats) {
    if (b - bounds[bounds.length - 1] >= MIN_BEAT_GAP_SEC && b < duration - MIN_BEAT_GAP_SEC)
      bounds.push(b);
  }
  bounds.push(duration);
  return bounds.map(roundTo3);
}

// =====================
// クロマ
// =====================

type PitchWeight = (midi: number) => number;

function trebleWeight(midi: number): number {
  if (midi < TREBLE_FADE_IN_START) return 0;
  if (midi < TREBLE_FADE_IN_END)
    return (midi - TREBLE_FADE_IN_START) / (TREBLE_FADE_IN_END - TREBLE_FADE_IN_START);
  if (midi <= TREBLE_FADE_OUT_START) return 1;
  return Math.max(0, (TREBLE_FADE_OUT_END - midi) / (TREBLE_FADE_OUT_END - TREBLE_FADE_OUT_START));
}

function bassWeight(midi: number): number {
  return midi > BASS_CUTOFF
    ? 0
    : Math.exp(GAUSSIAN_EXPONENT * ((midi - BASS_CENTER) / BASS_SIGMA) ** 2);
}

/** FFT bin → MIDI ピッチ の疎行列。各ピッチは近傍 bin の重み付き最大値を取る */
interface PitchMap {
  readonly bins: Int32Array;
  readonly pitches: Int32Array;
  readonly weights: Float64Array;
  readonly pitchWeight: Float64Array;
  readonly maxBin: number;
}

function buildPitchMap(fftSize: number, sampleRate: number, pitchWeight: PitchWeight): PitchMap {
  const pw = Float64Array.from({ length: PITCH_COUNT }, (_, i) => pitchWeight(i + MIDI_LO));
  const bins: number[] = [];
  const pitches: number[] = [];
  const weights: number[] = [];
  for (let k = 1; k <= fftSize / 2; k++) {
    const p = TUNING_MIDI + SEMITONES * Math.log2((k * sampleRate) / fftSize / TUNING_HZ);
    const width = Math.max(
      PITCH_MAP_MIN_WIDTH,
      PITCH_MAP_WIDTH_FACTOR * SEMITONES * Math.log2((k + 1) / k),
    );
    if (p < MIDI_LO - width || p > MIDI_HI + width) continue;
    for (let m = Math.ceil(p - width); m <= Math.floor(p + width); m++) {
      if (m < MIDI_LO || m > MIDI_HI || pw[m - MIDI_LO] === 0) continue;
      const d = (p - m) / width;
      const w = 1 - d * d;
      if (w > 0) {
        bins.push(k);
        pitches.push(m - MIDI_LO);
        weights.push(w);
      }
    }
  }
  return {
    bins: Int32Array.from(bins),
    pitches: Int32Array.from(pitches),
    weights: Float64Array.from(weights),
    pitchWeight: pw,
    maxBin: bins.length ? Math.max(...bins) : 0,
  };
}

/** 対数振幅スペクトログラム（bin 0..width-1 のみ保持、フレーム × bin の行優先） */
interface Spectrogram {
  readonly data: Float32Array;
  readonly nFrames: number;
  readonly width: number;
}

function logSpectrogram(
  signal: Float32Array,
  fftSize: number,
  maxBin: number,
  onProgress: (p: number) => void,
): Spectrogram {
  const fft = new FFT(fftSize);
  const mag = new Float64Array(fftSize / 2 + 1);
  const width = maxBin + 1;
  const gain = LOG_GAIN / (fftSize / HANN_PEAK_DIVISOR);
  const nFrames = Math.ceil(signal.length / CHROMA_HOP);
  const data = new Float32Array(nFrames * width);
  for (let t = 0; t < nFrames; t++) {
    fft.magnitude(signal, t * CHROMA_HOP - fftSize / 2, mag);
    for (let k = 0; k < width; k++) data[t * width + k] = Math.log1p(gain * mag[k]);
    if ((t & SPECTROGRAM_PROGRESS_MASK) === 0) onProgress(t / nFrames);
  }
  return { data, nFrames, width };
}

function medianOf(buf: Float32Array, count: number): number {
  const sorted = buf.subarray(0, count).sort();
  return count % 2 ? sorted[count >> 1] : HALF * (sorted[count / 2 - 1] + sorted[count / 2]);
}

/**
 * HPSS（Fitzgerald 2010）: 時間方向メディアン = 持続音、周波数方向メディアン = 打撃音。
 * ソフトマスク H² / (H² + P²) で持続音成分だけを残す。
 */
function harmonicPart({ data, nFrames, width }: Spectrogram): Spectrogram {
  const H = new Float32Array(data.length);
  const P = new Float32Array(data.length);
  const buf = new Float32Array(2 * Math.max(HPSS_TIME_RADIUS, HPSS_FREQ_RADIUS) + 1);

  for (let k = 0; k < width; k++) {
    for (let t = 0; t < nFrames; t++) {
      let m = 0;
      const last = Math.min(nFrames - 1, t + HPSS_TIME_RADIUS);
      for (let u = Math.max(0, t - HPSS_TIME_RADIUS); u <= last; u++)
        buf[m++] = data[u * width + k];
      H[t * width + k] = medianOf(buf, m);
    }
  }
  for (let t = 0; t < nFrames; t++) {
    const row = t * width;
    for (let k = 0; k < width; k++) {
      let m = 0;
      const last = Math.min(width - 1, k + HPSS_FREQ_RADIUS);
      for (let j = Math.max(0, k - HPSS_FREQ_RADIUS); j <= last; j++) buf[m++] = data[row + j];
      P[row + k] = medianOf(buf, m);
    }
  }

  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const h2 = H[i] * H[i];
    const p2 = P[i] * P[i];
    out[i] = h2 + p2 > 0 ? (data[i] * h2) / (h2 + p2) : 0;
  }
  return { data: out, nFrames, width };
}

/** ボーカル帯で突出した最大ピークを主旋律とみなし、その音・隣接半音・倍音（オクターブ / 12 度）を弱める */
function suppressMelody(white: Float64Array): void {
  const lo = VOCAL_LO - MIDI_LO;
  const hi = VOCAL_HI - MIDI_LO;
  let top = lo;
  for (let i = lo + 1; i <= hi; i++) if (white[i] > white[top]) top = i;
  if (white[top] <= 0) return;

  let second = 0;
  for (let i = lo; i <= hi; i++) {
    const distance = Math.abs(i - top);
    if (distance <= 1 || distance === OCTAVE_SEMITONES) continue;
    if (white[i] > second) second = white[i];
  }
  if (white[top] < MELODY_DOMINANCE * second) return;

  white[top] = 0;
  white[top - 1] *= MELODY_NEIGHBOR_GAIN;
  if (top + 1 < PITCH_COUNT) white[top + 1] *= MELODY_NEIGHBOR_GAIN;
  if (top + OCTAVE_SEMITONES < PITCH_COUNT) white[top + OCTAVE_SEMITONES] *= MELODY_OCTAVE_GAIN;
  if (top + TWELFTH_SEMITONES < PITCH_COUNT) white[top + TWELFTH_SEMITONES] *= MELODY_TWELFTH_GAIN;
}

/** フレームごとの 12 次元クロマと、白色化前サリエンスの平均（= エネルギー） */
interface FrameChroma {
  /** フレーム × 12 の行優先 */
  readonly chroma: Float32Array;
  readonly energy: Float32Array;
  readonly nFrames: number;
  /** 1 フレームの長さ（秒） */
  readonly hopSec: number;
}

function pitchChroma(
  { data, nFrames, width }: Spectrogram,
  map: PitchMap,
  melody: boolean,
  hopSec: number,
): FrameChroma {
  const salience = new Float64Array(PITCH_COUNT);
  const white = new Float64Array(PITCH_COUNT);
  const prefix = new Float64Array(PITCH_COUNT + 1);
  const chroma = new Float32Array(nFrames * SEMITONES);
  const energy = new Float32Array(nFrames);

  for (let t = 0; t < nFrames; t++) {
    const row = t * width;
    salience.fill(0);
    for (let e = 0; e < map.bins.length; e++) {
      const v = map.weights[e] * data[row + map.bins[e]];
      if (v > salience[map.pitches[e]]) salience[map.pitches[e]] = v;
    }

    for (let i = 0; i < PITCH_COUNT; i++) prefix[i + 1] = prefix[i] + salience[i];
    energy[t] = prefix[PITCH_COUNT] / PITCH_COUNT;
    for (let i = 0; i < PITCH_COUNT; i++) {
      const lo = Math.max(0, i - WHITEN_RADIUS);
      const hi = Math.min(PITCH_COUNT, i + WHITEN_RADIUS + 1);
      white[i] = Math.max(0, salience[i] - (prefix[hi] - prefix[lo]) / (hi - lo));
    }
    if (melody) suppressMelody(white);

    for (let i = 0; i < PITCH_COUNT; i++) {
      if (white[i] > 0)
        chroma[t * SEMITONES + ((i + MIDI_LO) % SEMITONES)] += white[i] * map.pitchWeight[i];
    }
  }
  return { chroma, energy, nFrames, hopSec };
}

/** 1 回のスペクトログラムから作る、分離処理ごとのクロマ */
interface ChromaVariants {
  readonly plain: FrameChroma;
  readonly harmonic: FrameChroma;
  /** メロディ抑制あり（withMelody のときだけ） */
  readonly plainMelody: FrameChroma | null;
  readonly harmonicMelody: FrameChroma | null;
}

const SPECTROGRAM_PROGRESS_SHARE = 0.5;
const HPSS_PROGRESS = 0.8;

function chromaVariants(
  signal: Float32Array,
  sampleRate: number,
  fftSize: number,
  pitchWeight: PitchWeight,
  withMelody: boolean,
  onProgress: (p: number) => void,
): ChromaVariants {
  const map = buildPitchMap(fftSize, sampleRate, pitchWeight);
  const spec = logSpectrogram(signal, fftSize, map.maxBin, (p) => {
    onProgress(SPECTROGRAM_PROGRESS_SHARE * p);
  });
  const harmonic = harmonicPart(spec);
  onProgress(HPSS_PROGRESS);
  const hopSec = CHROMA_HOP / sampleRate;
  const variants: ChromaVariants = {
    plain: pitchChroma(spec, map, false, hopSec),
    harmonic: pitchChroma(harmonic, map, false, hopSec),
    plainMelody: withMelody ? pitchChroma(spec, map, true, hopSec) : null,
    harmonicMelody: withMelody ? pitchChroma(harmonic, map, true, hopSec) : null,
  };
  onProgress(1);
  return variants;
}

// =====================
// ビート同期
// =====================

/**
 * ビート区間 [start, end) で平均するフレームの範囲。
 * 区間冒頭は前のコードの残響が混ざるので除外する。フレームが無ければ null。
 */
function frameRange(
  { nFrames, hopSec }: FrameChroma,
  start: number,
  end: number,
): [number, number] | null {
  if (nFrames === 0) return null;
  let first = Math.ceil((start + BEAT_SKIP_RATIO * (end - start)) / hopSec);
  let last = Math.min(Math.ceil(end / hopSec), nFrames);
  if (last <= first) {
    first = Math.min(nFrames - 1, Math.round((start + end) / 2 / hopSec));
    last = first + 1;
  }
  return [first, last];
}

function beatSync(frames: FrameChroma, bounds: readonly number[]): BeatChroma {
  const out: BeatChroma = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const acc = new Array<number>(SEMITONES).fill(0);
    const range = frameRange(frames, bounds[i], bounds[i + 1]);
    if (!range) {
      out.push(acc);
      continue;
    }
    const [first, last] = range;
    for (let f = first; f < last; f++) {
      for (let pc = 0; pc < SEMITONES; pc++) acc[pc] += frames.chroma[f * SEMITONES + pc];
    }
    out.push(acc.map((v) => roundTo3(v / (last - first))));
  }
  return out;
}

function beatSyncEnergy(frames: FrameChroma, bounds: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const range = frameRange(frames, bounds[i], bounds[i + 1]);
    if (!range) {
      out.push(0);
      continue;
    }
    const [first, last] = range;
    let acc = 0;
    for (let f = first; f < last; f++) acc += frames.energy[f];
    out.push(roundTo3(acc / (last - first)));
  }
  return out;
}

// =====================
// 公開 API
// =====================

/**
 * @param input モノラルの Float32Array、または [L, R] のチャンネル配列
 * @param inputRate 入力のサンプリングレート
 */
export function extractFeatures(
  input: Float32Array | readonly Float32Array[],
  inputRate: number,
  { timeScale = 1 }: ExtractOptions = {},
  onProgress: ProgressCallback = () => undefined,
): Features {
  const channels = (input instanceof Float32Array ? [input] : input).slice(0, 2);
  onProgress('resample', 0);
  const resampled = channels.map((channel, i) => {
    const signal = downsample(channel, inputRate);
    onProgress('resample', (i + 1) / channels.length);
    return signal;
  });
  const sampleRate = resampled[0]?.sampleRate ?? inputRate;
  const left = resampled[0]?.samples ?? new Float32Array(0);
  const right = resampled[1]?.samples ?? left;
  const mid = new Float32Array(left.length);
  const side = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    mid[i] = (left[i] + right[i]) / 2;
    side[i] = (left[i] - right[i]) / 2;
  }
  const sideAvailable = rms(side) > SIDE_MIN_RATIO * rms(mid);
  const duration = mid.length / sampleRate;

  const onset = onsetEnvelope(mid, sampleRate, (p) => {
    onProgress('onset', p);
  });
  onProgress('beats', 0);
  const { beats, tempo } = trackBeats(onset.env, onset.frameRate, timeScale, duration);
  const bounds = beatBounds(beats, duration);
  onProgress('beats', 1);

  const bass = chromaVariants(mid, sampleRate, BASS_FFT_SIZE, bassWeight, false, (p) => {
    onProgress('bass', p);
  });
  const treble = chromaVariants(mid, sampleRate, TREBLE_FFT_SIZE, trebleWeight, true, (p) => {
    onProgress('chroma', p);
  });
  const trebleSide = sideAvailable
    ? chromaVariants(side, sampleRate, TREBLE_FFT_SIZE, trebleWeight, true, (p) => {
        onProgress('chromaSide', p);
      })
    : null;

  const sync = (frames: FrameChroma | null): BeatChroma => (frames ? beatSync(frames, bounds) : []);

  return {
    duration,
    tempo: tempo / timeScale,
    bounds,
    sideAvailable,
    treble: {
      mid: sync(treble.plain),
      'mid-h': sync(treble.harmonic),
      'mid-m': sync(treble.plainMelody),
      'mid-h-m': sync(treble.harmonicMelody),
      ...(trebleSide && {
        side: sync(trebleSide.plain),
        'side-h': sync(trebleSide.harmonic),
        'side-m': sync(trebleSide.plainMelody),
        'side-h-m': sync(trebleSide.harmonicMelody),
      }),
    },
    bass: { mid: sync(bass.plain), 'mid-h': sync(bass.harmonic) },
    energy: beatSyncEnergy(treble.plain, bounds),
  };
}

/** 録音時刻 → 動画時刻 のように、bounds の時間軸を変換する（単調増加を保つ） */
export function remapTimes(features: Features, map: (t: number) => number): Features {
  const bounds: number[] = [];
  let prev = 0;
  for (const b of features.bounds) {
    prev = Math.max(prev, map(b));
    bounds.push(roundTo3(prev));
  }
  return { ...features, bounds, duration: bounds[bounds.length - 1] ?? 0 };
}
