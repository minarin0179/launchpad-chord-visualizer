// =====================
// Chord Analyzer — 曲全体のオーディオからコード進行を推定する
// DOM 非依存（Web Worker / Node の両方で動く）
//
//   extractFeatures: ダウンサンプル → オンセット包絡 → ビート追跡
//                    → ピッチサリエンス → クロマ（高音域 / 低音域）→ ビート同期
//   decodeChords:    キー推定 → テンプレート照合 → Viterbi 平滑化 → セグメント化
//
// extractFeatures は重いので Worker で実行する。分離処理（センターカット / HPSS / メロディ抑制）の
// 全組み合わせのクロマをここで作っておき、decodeChords 側でオプションに応じて選ぶ。
// decodeChords はビート単位の特徴量だけを使うので軽く、パラメータ変更時に即再計算できる。
// =====================
import { NOTE_NAMES, CHORD_TYPES } from '../constants.js';
import { FFT, downsample } from './dsp.js';

const ONSET_N      = 1024;
const ONSET_HOP    = 512;
const CHROMA_HOP   = 1024;
const TREBLE_N     = 4096;   // 時間分解能優先
const BASS_N       = 8192;   // 低音の周波数分解能優先
const MIDI_LO      = 28;     // E1
const MIDI_HI      = 96;     // C7
const N_PITCH      = MIDI_HI - MIDI_LO + 1;
const VOCAL_LO     = 55;     // G3 — メロディ抑制で主旋律を探す範囲
const VOCAL_HI     = 84;     // C6
const MIN_BPM      = 60;
const MAX_BPM      = 200;
const LOG_GAIN     = 100;    // log(1 + LOG_GAIN * 振幅) の圧縮係数
const BEAT_TIGHTNESS = 100;  // ビート間隔がテンポから外れることへのペナルティ
const HPSS_TIME_RADIUS = 4;  // HPSS 時間方向メディアン半径（フレーム）— 大きいとコードチェンジがぼける
const HPSS_FREQ_RADIUS = 8;  // HPSS 周波数方向メディアン半径（bin）
const MELODY_DOMINANCE = 1.3;  // 2 番目のピークの何倍以上なら主旋律とみなすか
const SIDE_MIN_RATIO = 0.05;   // サイド成分がミッドの何割未満ならモノラル音源とみなすか

export const DEFAULT_DECODE_OPTIONS = {
  vocabulary: 'full',   // 'triads' | 'full'
  selfTransition: 0.6,  // ビートごとに同じコードに留まる確率
  bassWeight: 0.3,      // 低音がルートと一致することへの加点
  keyBonus: 0.03,       // 推定キーのダイアトニックコードへの加点
  beta: 25,             // スコア → 対数尤度のスケール
  centerCut: false,     // 高音域クロマを L-R（サイド成分）から取る = 中央定位のボーカルを除去
  hpss: false,          // 打撃音を除去した持続音成分からクロマを取る
  melody: false,        // 各フレームで突出した主旋律の音を除去
};

// コードタイプ → 事前ペナルティ（音数の多いコードはメロディ音で誤検出しやすいので不利にする）
const VOCABULARIES = {
  triads: { maj: 0, min: 0 },
  full:   { maj: 0, min: 0, '7': 0.03, min7: 0.03, maj7: 0.04, sus4: 0.05, dim: 0.06, aug: 0.08 },
};

const NO_CHORD = { root: null, type: 'N', label: 'N.C.' };

// Krumhansl-Kessler キープロファイル
const KEY_PROFILES = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

// =====================
// Feature extraction
// =====================

// input: モノラル Float32Array、または [L, R] のチャンネル配列
// timeScale: 録音の再生速度（2倍速スキャンなら 2）
// 戻り値の treble / bass はクロマのバリアント名 → ビートごとの 12 次元配列
//   treble: mid, mid-h, mid-m, mid-h-m, (side, side-h, side-m, side-h-m)   bass: mid, mid-h
export function extractFeatures(input, inputRate, { timeScale = 1 } = {}, onProgress = () => {}) {
  const channels = (Array.isArray(input) ? input : [input]).slice(0, 2);
  onProgress('resample', 0);
  const resampled = channels.map((ch, i) => {
    const r = downsample(ch, inputRate);
    onProgress('resample', (i + 1) / channels.length);
    return r;
  });
  const { sampleRate } = resampled[0];
  const left = resampled[0].samples;
  const right = resampled[1]?.samples ?? left;
  const mid = new Float32Array(left.length);
  const side = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    mid[i] = (left[i] + right[i]) / 2;
    side[i] = (left[i] - right[i]) / 2;
  }
  const sideAvailable = rms(side) > SIDE_MIN_RATIO * rms(mid);
  const duration = mid.length / sampleRate;

  const onset = onsetEnvelope(mid, sampleRate, p => onProgress('onset', p));
  onProgress('beats', 0);
  const { beats, tempo } = trackBeats(onset.env, onset.frameRate, timeScale, duration);
  const bounds = beatBounds(beats, duration);
  onProgress('beats', 1);

  const bass   = chromaVariants(mid, sampleRate, BASS_N, bassWeight, false, p => onProgress('bass', p));
  const treble = chromaVariants(mid, sampleRate, TREBLE_N, trebleWeight, true, p => onProgress('chroma', p));
  const trebleSide = sideAvailable
    ? chromaVariants(side, sampleRate, TREBLE_N, trebleWeight, true, p => onProgress('chromaSide', p))
    : {};

  const sync = (variants, prefix) => Object.fromEntries(
    Object.entries(variants).map(([name, frames]) => [prefix + name, beatSync(frames, bounds)]));

  return {
    duration,
    tempo: tempo / timeScale,
    bounds,
    sideAvailable,
    treble: { ...sync(treble, 'mid'), ...sync(trebleSide, 'side') },
    bass: sync(bass, 'mid'),
    energy: beatSyncScalar(treble[''], bounds),
  };
}

// 録音時刻 → 動画時刻 のように bounds の時間軸を変換する
export function remapTimes(features, map) {
  const bounds = [];
  let prev = 0;
  for (const b of features.bounds) {
    prev = Math.max(prev, map(b));
    bounds.push(Math.round(prev * 1000) / 1000);
  }
  return { ...features, bounds, duration: bounds[bounds.length - 1] };
}

function rms(x) {
  let sq = 0;
  for (let i = 0; i < x.length; i++) sq += x[i] * x[i];
  return Math.sqrt(sq / (x.length || 1));
}

function onsetEnvelope(samples, sr, onProgress) {
  const fft = new FFT(ONSET_N);
  const nBins = ONSET_N / 2 + 1;
  const mag = new Float64Array(nBins);
  let prev = new Float64Array(nBins);
  let cur = new Float64Array(nBins);
  const gain = LOG_GAIN / (ONSET_N / 4);
  const nFrames = Math.ceil(samples.length / ONSET_HOP);
  const flux = new Float64Array(nFrames);

  for (let t = 0; t < nFrames; t++) {
    fft.magnitude(samples, t * ONSET_HOP - ONSET_N / 2, mag);
    let sum = 0;
    for (let k = 0; k < nBins; k++) {
      cur[k] = Math.log1p(gain * mag[k]);
      if (t > 0 && cur[k] > prev[k]) sum += cur[k] - prev[k];
    }
    flux[t] = sum;
    [prev, cur] = [cur, prev];
    if ((t & 1023) === 0) onProgress(t / nFrames);
  }

  const frameRate = sr / ONSET_HOP;
  const env = subtractLocalMean(flux, Math.round(frameRate * 0.4));
  const scale = rms(env) || 1;
  for (let i = 0; i < env.length; i++) env[i] /= scale;
  onProgress(1);
  return { env, frameRate };
}

function subtractLocalMean(x, radius) {
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

function trebleWeight(m) {
  if (m < 40) return 0;
  if (m < 48) return (m - 40) / 8;
  if (m <= 84) return 1;
  return Math.max(0, (96 - m) / 12);
}

function bassWeight(m) {
  return m > 55 ? 0 : Math.exp(-0.5 * ((m - 40) / 7) ** 2);
}

// FFT bin → MIDI ピッチ の疎行列。各ピッチは近傍 bin の重み付き最大値を取る
function buildPitchMap(n, sr, pitchWeight) {
  const pw = Float64Array.from({ length: N_PITCH }, (_, i) => pitchWeight(i + MIDI_LO));
  const bins = [], pitches = [], weights = [];
  for (let k = 1; k <= n / 2; k++) {
    const p = 69 + 12 * Math.log2((k * sr / n) / 440);
    const width = Math.max(0.4, 1.2 * 12 * Math.log2((k + 1) / k));
    if (p < MIDI_LO - width || p > MIDI_HI + width) continue;
    for (let m = Math.ceil(p - width); m <= Math.floor(p + width); m++) {
      if (m < MIDI_LO || m > MIDI_HI || pw[m - MIDI_LO] === 0) continue;
      const d = (p - m) / width;
      const w = 1 - d * d;
      if (w > 0) { bins.push(k); pitches.push(m - MIDI_LO); weights.push(w); }
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

// 1 回のスペクトログラムから HPSS あり/なし（×メロディ抑制あり/なし）のクロマを作る
// キー: '' | '-h' | '-m' | '-h-m'
function chromaVariants(signal, sr, n, pitchWeight, withMelody, onProgress) {
  const map = buildPitchMap(n, sr, pitchWeight);
  const spec = logSpectrogram(signal, n, map.maxBin, p => onProgress(0.5 * p));
  const harmonic = harmonicPart(spec);
  onProgress(0.8);
  const variants = {
    '': pitchChroma(spec, map, false),
    '-h': pitchChroma(harmonic, map, false),
  };
  if (withMelody) {
    variants['-m'] = pitchChroma(spec, map, true);
    variants['-h-m'] = pitchChroma(harmonic, map, true);
  }
  onProgress(1);
  const hopSec = CHROMA_HOP / sr;
  for (const v of Object.values(variants)) v.hopSec = hopSec;
  return variants;
}

// 対数振幅スペクトログラム（bin 0..maxBin のみ保持）
function logSpectrogram(signal, n, maxBin, onProgress) {
  const fft = new FFT(n);
  const mag = new Float64Array(n / 2 + 1);
  const width = maxBin + 1;
  const gain = LOG_GAIN / (n / 4);
  const nFrames = Math.ceil(signal.length / CHROMA_HOP);
  const data = new Float32Array(nFrames * width);
  for (let t = 0; t < nFrames; t++) {
    fft.magnitude(signal, t * CHROMA_HOP - n / 2, mag);
    for (let k = 0; k < width; k++) data[t * width + k] = Math.log1p(gain * mag[k]);
    if ((t & 255) === 0) onProgress(t / nFrames);
  }
  return { data, nFrames, width };
}

// HPSS（Fitzgerald 2010）: 時間方向メディアン = 持続音、周波数方向メディアン = 打撃音
// ソフトマスク H² / (H² + P²) で持続音成分だけを残す
function harmonicPart({ data, nFrames, width }) {
  const H = new Float32Array(data.length);
  const P = new Float32Array(data.length);
  const buf = new Float32Array(2 * Math.max(HPSS_TIME_RADIUS, HPSS_FREQ_RADIUS) + 1);

  for (let k = 0; k < width; k++) {
    for (let t = 0; t < nFrames; t++) {
      let m = 0;
      for (let u = Math.max(0, t - HPSS_TIME_RADIUS); u <= Math.min(nFrames - 1, t + HPSS_TIME_RADIUS); u++) buf[m++] = data[u * width + k];
      H[t * width + k] = medianOf(buf, m);
    }
  }
  for (let t = 0; t < nFrames; t++) {
    const row = t * width;
    for (let k = 0; k < width; k++) {
      let m = 0;
      for (let j = Math.max(0, k - HPSS_FREQ_RADIUS); j <= Math.min(width - 1, k + HPSS_FREQ_RADIUS); j++) buf[m++] = data[row + j];
      P[row + k] = medianOf(buf, m);
    }
  }

  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const h2 = H[i] * H[i], p2 = P[i] * P[i];
    out[i] = h2 + p2 > 0 ? data[i] * h2 / (h2 + p2) : 0;
  }
  return { data: out, nFrames, width };
}

function medianOf(buf, m) {
  const a = buf.subarray(0, m).sort();
  return m % 2 ? a[m >> 1] : 0.5 * (a[m / 2 - 1] + a[m / 2]);
}

// フレームごとの 12 次元クロマ（+ 白色化前サリエンスの平均 = エネルギー）
function pitchChroma({ data, nFrames, width }, map, melody) {
  const sal = new Float64Array(N_PITCH);
  const white = new Float64Array(N_PITCH);
  const prefix = new Float64Array(N_PITCH + 1);
  const chroma = new Float32Array(nFrames * 12);
  const energy = new Float32Array(nFrames);

  for (let t = 0; t < nFrames; t++) {
    const row = t * width;
    sal.fill(0);
    for (let e = 0; e < map.bins.length; e++) {
      const v = map.weights[e] * data[row + map.bins[e]];
      if (v > sal[map.pitches[e]]) sal[map.pitches[e]] = v;
    }

    // 白色化: ±12 半音の局所平均を引いて広帯域ノイズ（ドラム等）を抑える
    for (let i = 0; i < N_PITCH; i++) prefix[i + 1] = prefix[i] + sal[i];
    energy[t] = prefix[N_PITCH] / N_PITCH;
    for (let i = 0; i < N_PITCH; i++) {
      const lo = Math.max(0, i - 12);
      const hi = Math.min(N_PITCH, i + 13);
      white[i] = Math.max(0, sal[i] - (prefix[hi] - prefix[lo]) / (hi - lo));
    }
    if (melody) suppressMelody(white);

    for (let i = 0; i < N_PITCH; i++) {
      if (white[i] > 0) chroma[t * 12 + (i + MIDI_LO) % 12] += white[i] * map.pitchWeight[i];
    }
  }
  return { chroma, energy, nFrames };
}

// ボーカル帯で突出した最大ピークを主旋律とみなし、その音・隣接半音・倍音（オクターブ / 12度）を弱める
function suppressMelody(white) {
  const lo = VOCAL_LO - MIDI_LO;
  const hi = VOCAL_HI - MIDI_LO;
  let top = lo;
  for (let i = lo + 1; i <= hi; i++) if (white[i] > white[top]) top = i;
  if (white[top] <= 0) return;

  let second = 0;
  for (let i = lo; i <= hi; i++) {
    if (Math.abs(i - top) <= 1 || Math.abs(i - top) === 12) continue;
    if (white[i] > second) second = white[i];
  }
  if (white[top] < MELODY_DOMINANCE * second) return;

  white[top] = 0;
  white[top - 1] *= 0.5;
  if (top + 1 < N_PITCH) white[top + 1] *= 0.5;
  if (top + 12 < N_PITCH) white[top + 12] *= 0.3;
  if (top + 19 < N_PITCH) white[top + 19] *= 0.5;
}

// Ellis (2007) の動的計画法ビートトラッカー
function trackBeats(env, fr, timeScale, duration) {
  const n = env.length;
  const minLag = Math.max(2, Math.floor(fr * 60 / (MAX_BPM * timeScale)));
  const maxLag = Math.ceil(fr * 60 / (MIN_BPM * timeScale));
  const fallbackPeriod = fr * 60 / (120 * timeScale);
  if (n < maxLag * 4) return { beats: fillBeatGaps([], fallbackPeriod / fr, duration), tempo: 120 * timeScale };

  // テンポ推定: 自己相関 × 120BPM 中心の対数ガウス重み
  const acf = new Float64Array(maxLag + 2);
  const scores = new Float64Array(maxLag + 2);
  let bestLag = minLag;
  for (let lag = Math.max(1, Math.floor(minLag / 2) - 1); lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    acf[lag] = s / (n - lag);
    const bpm = 60 * fr / (lag * timeScale);
    scores[lag] = acf[lag] * Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    if (lag >= minLag && lag <= maxLag && scores[lag] > scores[bestLag]) bestLag = lag;
  }
  // 倍テンポにも十分な周期性があれば速い方を採用する
  // （スネアの 2・4 拍で半テンポに引っ張られると、2 拍ごとのコードチェンジを取りこぼすため）
  let halfLag = Math.round(bestLag / 2);
  for (const l of [halfLag - 1, halfLag + 1]) if (l >= minLag && acf[l] > acf[halfLag]) halfLag = l;
  if (halfLag >= minLag && acf[halfLag] >= 0.4 * acf[bestLag]) bestLag = halfLag;

  let period = bestLag;
  const a = acf[bestLag - 1], b = acf[bestLag], c = acf[bestLag + 1];
  const denom = a - 2 * b + c;
  if (denom < 0) period += 0.5 * (a - c) / denom;

  // DP: score[t] = onset[t] + max_p (score[p] - tightness * log((t-p)/period)^2)
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const farthest = Math.round(2 * period);
  const nearest = Math.max(1, Math.round(period / 2));
  for (let t = 0; t < n; t++) {
    let best = 0, bi = -1;
    for (let p = Math.max(0, t - farthest); p <= t - nearest; p++) {
      const v = score[p] - BEAT_TIGHTNESS * Math.log((t - p) / period) ** 2;
      if (v > best) { best = v; bi = p; }
    }
    score[t] = env[t] + best;
    back[t] = bi;
  }

  let t = Math.max(0, n - Math.round(period));
  for (let i = t; i < n; i++) if (score[i] > score[t]) t = i;
  const frames = [];
  for (; t >= 0; t = back[t]) frames.push(t);
  frames.reverse();

  return {
    beats: fillBeatGaps(frames.map(f => f / fr), period / fr, duration),
    tempo: 60 * fr / period,
  };
}

// ビート列の抜け（冒頭・末尾・途中の大きな空白）をテンポ周期で補間する
function fillBeatGaps(beats, periodSec, duration) {
  if (beats.length === 0) beats = [0];
  const out = [];
  for (let b = beats[0] - periodSec; b > 0; b -= periodSec) out.push(b);
  out.reverse();
  for (let i = 0; i < beats.length; i++) {
    out.push(beats[i]);
    if (i + 1 < beats.length) {
      const gap = beats[i + 1] - beats[i];
      const k = Math.round(gap / periodSec);
      for (let j = 1; j < k; j++) out.push(beats[i] + gap * j / k);
    }
  }
  for (let b = beats[beats.length - 1] + periodSec; b < duration; b += periodSec) out.push(b);
  return out;
}

function beatBounds(beats, duration) {
  const bounds = [0];
  for (const b of beats) {
    if (b - bounds[bounds.length - 1] >= 0.05 && b < duration - 0.05) bounds.push(b);
  }
  bounds.push(duration);
  return bounds.map(b => Math.round(b * 1000) / 1000);
}

// ビート区間 [b_i, b_{i+1}) のフレームを平均（区間冒頭 20% は前のコードの残響が混ざるので除外）
function frameRange({ nFrames, hopSec }, start, end) {
  let f0 = Math.ceil((start + 0.2 * (end - start)) / hopSec);
  let f1 = Math.ceil(end / hopSec);
  f1 = Math.min(f1, nFrames);
  if (f1 <= f0) {
    f0 = Math.min(nFrames - 1, Math.round((start + end) / 2 / hopSec));
    f1 = f0 + 1;
  }
  return [f0, f1];
}

function beatSync(frames, bounds) {
  const out = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const [f0, f1] = frameRange(frames, bounds[i], bounds[i + 1]);
    const acc = new Array(12).fill(0);
    for (let f = f0; f < f1; f++) {
      for (let pc = 0; pc < 12; pc++) acc[pc] += frames.chroma[f * 12 + pc];
    }
    out.push(acc.map(v => Math.round((v / (f1 - f0)) * 1000) / 1000));
  }
  return out;
}

function beatSyncScalar(frames, bounds) {
  const out = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const [f0, f1] = frameRange(frames, bounds[i], bounds[i + 1]);
    let acc = 0;
    for (let f = f0; f < f1; f++) acc += frames.energy[f];
    out.push(Math.round((acc / (f1 - f0)) * 1000) / 1000);
  }
  return out;
}

// =====================
// Decoding
// =====================

// 分離オプションに対応する高音域クロマのバリアント名（センターカット不可の音源では mid にフォールバック）
export function trebleVariantKey(features, { centerCut, hpss, melody }) {
  const source = centerCut && features.sideAvailable ? 'side' : 'mid';
  return source + (hpss ? '-h' : '') + (melody ? '-m' : '');
}

export function decodeChords(features, options = {}) {
  const opt = { ...DEFAULT_DECODE_OPTIONS, ...options };
  const trebleKey = trebleVariantKey(features, opt);
  const treble = features.treble[trebleKey];
  const bass = features.bass[opt.hpss ? 'mid-h' : 'mid'];
  const key = estimateKey(treble, bass);
  const nBeats = treble.length;
  if (nBeats === 0) return { key, tempo: features.tempo, trebleKey, segments: [] };

  const diatonic = new Set(MAJOR_SCALE.map(i => (key.tonicMajor + i) % 12));
  const states = buildStates(VOCABULARIES[opt.vocabulary] ?? VOCABULARIES.full, diatonic);
  const S = states.length + 1;  // 末尾 = N.C.
  const silentLevel = 0.2 * median(features.energy);

  const emis = new Float64Array(nBeats * S);
  for (let i = 0; i < nBeats; i++) {
    const t = treble[i];
    const b = bass[i];
    let norm = 0, sum = 0, maxB = 0;
    for (let pc = 0; pc < 12; pc++) {
      norm += t[pc] * t[pc];
      sum += t[pc];
      if (b[pc] > maxB) maxB = b[pc];
    }
    norm = Math.sqrt(norm);

    for (let s = 0; s < states.length; s++) {
      const st = states[s];
      let dot = 0;
      for (let pc = 0; pc < 12; pc++) dot += t[pc] * st.template[pc];
      const cos = norm > 0 ? dot / norm : 0;
      const bassMatch = maxB > 0 ? b[st.root] / maxB : 0;
      const score = cos + opt.bassWeight * bassMatch - st.penalty + (st.diatonic ? opt.keyBonus : 0);
      emis[i * S + s] = opt.beta * score;
    }

    const silent = features.energy[i] < silentLevel;
    const flatCos = norm > 0 ? sum / (Math.sqrt(12) * norm) : 1;
    emis[i * S + S - 1] = opt.beta * (silent ? 2 : flatCos - 0.3 + opt.bassWeight * 0.3);
  }

  const path = viterbi(emis, nBeats, S, opt.selfTransition);
  const segments = [];
  let start = 0;
  for (let i = 1; i <= nBeats; i++) {
    if (i < nBeats && path[i] === path[start]) continue;
    const st = path[start] === S - 1 ? NO_CHORD : states[path[start]];
    segments.push({
      start: features.bounds[start],
      end: features.bounds[i],
      beats: i - start,
      root: st.root,
      type: st.type,
      label: st.label,
    });
    start = i;
  }
  return { key, tempo: features.tempo, trebleKey, segments };
}

// 時刻 t を含むセグメントの index（二分探索、範囲外は -1）
export function findSegmentIndex(segments, t) {
  let lo = 0, hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < segments[mid].start) hi = mid - 1;
    else if (t >= segments[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function buildStates(vocab, diatonic) {
  const states = [];
  for (const [type, penalty] of Object.entries(vocab)) {
    const { intervals, symbol } = CHORD_TYPES[type];
    for (let root = 0; root < 12; root++) {
      const template = new Float64Array(12);
      intervals.forEach((iv, idx) => { template[(root + iv) % 12] = idx >= 3 ? 0.8 : 1; });
      const norm = Math.sqrt(template.reduce((s, v) => s + v * v, 0));
      for (let pc = 0; pc < 12; pc++) template[pc] /= norm;
      const pcs = intervals.map(iv => (root + iv) % 12);
      states.push({
        root, type, penalty, template,
        label: NOTE_NAMES[root] + symbol,
        diatonic: pcs.every(pc => diatonic.has(pc)),
      });
    }
  }
  return states;
}

function viterbi(emis, n, S, pStay) {
  const p = Math.min(0.99, Math.max(0.01, pStay));
  const stay = Math.log(p);
  const move = Math.log((1 - p) / (S - 1));
  let delta = emis.slice(0, S);
  let next = new Float64Array(S);
  const back = new Int32Array(n * S);

  for (let t = 1; t < n; t++) {
    let best = 0;
    for (let s = 1; s < S; s++) if (delta[s] > delta[best]) best = s;
    for (let s = 0; s < S; s++) {
      const viaStay = delta[s] + stay;
      const viaMove = delta[best] + move;
      if (viaStay >= viaMove) { next[s] = viaStay; back[t * S + s] = s; }
      else { next[s] = viaMove; back[t * S + s] = best; }
      next[s] += emis[t * S + s];
    }
    [delta, next] = [next, delta];
  }

  const path = new Int32Array(n);
  let s = 0;
  for (let i = 1; i < S; i++) if (delta[i] > delta[s]) s = i;
  for (let t = n - 1; t >= 0; t--) {
    path[t] = s;
    s = back[t * S + s];
  }
  return path;
}

function estimateKey(treble, bass) {
  const profile = new Array(12).fill(0);
  treble.forEach((t, i) => {
    for (let pc = 0; pc < 12; pc++) profile[pc] += t[pc] + 0.5 * bass[i][pc];
  });
  let best = { root: 0, mode: 'major', r: -Infinity };
  for (const mode of ['major', 'minor']) {
    for (let root = 0; root < 12; root++) {
      const rotated = profile.map((_, pc) => KEY_PROFILES[mode][(pc - root + 12) % 12]);
      const r = pearson(profile, rotated);
      if (r > best.r) best = { root, mode, r };
    }
  }
  return {
    root: best.root,
    mode: best.mode,
    label: NOTE_NAMES[best.root] + (best.mode === 'minor' ? 'm' : ''),
    tonicMajor: best.mode === 'major' ? best.root : (best.root + 3) % 12,
    confidence: Math.round(best.r * 100) / 100,
  };
}

function pearson(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
