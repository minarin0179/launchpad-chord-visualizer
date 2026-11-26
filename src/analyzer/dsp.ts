/**
 * DSP の基本部品（DOM 非依存: Web Worker / Node の両方で動く）。
 */
import {
  ANALYSIS_RATE,
  RESAMPLE_CUTOFF,
  RESAMPLE_MAX_PHASES,
  RESAMPLE_TAPS_PER_FACTOR,
} from './constants';

export interface Signal {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 窓付き sinc ローパス（中心を shift サンプルだけずらせる）。合計が 1 になるよう正規化する */
function lowpassKernel(taps: number, cutoff: number, shift: number): Float32Array {
  const half = (taps - 1) / 2;
  const h = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - half - shift;
    const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    h[i] = sinc * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}

/** 整数比の間引き（44.1 kHz → 22.05 kHz など） */
function decimate(samples: Float32Array, factor: number): Float32Array {
  const taps = RESAMPLE_TAPS_PER_FACTOR * factor + 1;
  const half = (taps - 1) / 2;
  const h = lowpassKernel(taps, RESAMPLE_CUTOFF / factor, 0);
  const outLen = Math.floor(samples.length / factor);
  const out = new Float32Array(outLen);
  for (let o = 0; o < outLen; o++) {
    const center = o * factor;
    const lo = Math.max(0, half - center);
    const hi = Math.min(taps, samples.length - center + half);
    let acc = 0;
    for (let i = lo; i < hi; i++) acc += samples[center + i - half] * h[i];
    out[o] = acc;
  }
  return out;
}

/** 分数比のリサンプル（48 kHz → 22.05 kHz など）。位相ごとのローパスを事前計算する多相フィルタ */
function resampleFractional(
  samples: Float32Array,
  sampleRate: number,
  phases: number,
): Float32Array {
  const ratio = sampleRate / ANALYSIS_RATE;
  const taps = 2 * Math.ceil((RESAMPLE_TAPS_PER_FACTOR * ratio) / 2) + 1;
  const half = (taps - 1) / 2;
  const kernels = Array.from({ length: phases }, (_, p) =>
    lowpassKernel(taps, RESAMPLE_CUTOFF / ratio, p / phases),
  );
  // 整数演算で長さを求める（samples.length / ratio は丸め誤差で 1 サンプル欠けることがある）
  const outLen = Math.floor((samples.length * ANALYSIS_RATE) / sampleRate);
  const out = new Float32Array(outLen);
  for (let o = 0; o < outLen; o++) {
    const position = o * ratio;
    const center = Math.floor(position);
    const h = kernels[Math.min(phases - 1, Math.floor((position - center) * phases))];
    const lo = Math.max(0, half - center);
    const hi = Math.min(taps, samples.length - center + half);
    let acc = 0;
    for (let i = lo; i < hi; i++) acc += samples[center + i - half] * h[i];
    out[o] = acc;
  }
  return out;
}

/**
 * 解析用のサンプリングレート（ANALYSIS_RATE）まで落とす。
 * ANALYSIS_RATE 以下の入力はそのまま返す（アップサンプルはしない）。
 */
export function downsample(samples: Float32Array, sampleRate: number): Signal {
  const ratio = sampleRate / ANALYSIS_RATE;
  if (ratio <= 1) return { samples, sampleRate };
  if (Number.isInteger(ratio))
    return { samples: decimate(samples, ratio), sampleRate: ANALYSIS_RATE };
  // 出力 1 サンプルごとの入力位置の小数部は、既約分数 sampleRate / ANALYSIS_RATE の分母の種類しか現れない
  const exactPhases = ANALYSIS_RATE / gcd(Math.round(sampleRate), ANALYSIS_RATE);
  const phases = Math.min(RESAMPLE_MAX_PHASES, exactPhases);
  return { samples: resampleFractional(samples, sampleRate, phases), sampleRate: ANALYSIS_RATE };
}

/** Hann 窓付き FFT → 振幅スペクトル（テーブルは事前計算。インスタンスは作業バッファを持つので再入不可） */
export class FFT {
  readonly size: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  /** n は 2 のべき乗 */
  constructor(n: number) {
    this.size = n;
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 1; i < n; i++) this.rev[i] = (this.rev[i >> 1] >> 1) | ((i & 1) << (bits - 1));
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.window = new Float64Array(n);
    for (let i = 0; i < n; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
  }

  /** signal[offset .. offset+n) を解析し、out[0..n/2] に振幅を書き込む（範囲外は 0 埋め） */
  magnitude(signal: Float32Array, offset: number, out: Float64Array): void {
    const { size: n, re, im, rev, cos, sin, window } = this;
    for (let i = 0; i < n; i++) {
      const idx = offset + i;
      re[i] = idx >= 0 && idx < signal.length ? signal[idx] * window[i] : 0;
      im[i] = 0;
    }
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (i < j) {
        const t = re[i];
        re[i] = re[j];
        re[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const halfSize = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + halfSize; j++, k += step) {
          const l = j + halfSize;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = im[l] * cos[k] - re[l] * sin[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
    for (let i = 0; i <= n / 2; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
}
