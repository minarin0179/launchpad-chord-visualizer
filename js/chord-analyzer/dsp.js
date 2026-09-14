// =====================
// DSP primitives（DOM 非依存: Web Worker / Node の両方で動く）
// =====================

export const ANALYSIS_RATE = 22050;

// 整数間引きで ~22kHz に落とす（窓付き sinc ローパス → 間引き）
export function downsample(samples, sampleRate) {
  const factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
  if (factor === 1) return { samples, sampleRate };

  const taps = 64 * factor + 1;
  const half = (taps - 1) / 2;
  const cutoff = 0.45 / factor;
  const h = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - half;
    const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    h[i] = sinc * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (taps - 1)));
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;

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
  return { samples: out, sampleRate: sampleRate / factor };
}

// Hann 窓付き FFT → 振幅スペクトル（テーブル事前計算）
export class FFT {
  constructor(n) {
    this.n = n;
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 1; i < n; i++) this.rev[i] = (this.rev[i >> 1] >> 1) | ((i & 1) << (bits - 1));
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos(2 * Math.PI * i / n);
      this.sin[i] = Math.sin(2 * Math.PI * i / n);
    }
    this.window = new Float64Array(n);
    for (let i = 0; i < n; i++) this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
  }

  // signal[offset .. offset+n) を解析し out[0..n/2] に振幅を書き込む（範囲外は 0 埋め）
  magnitude(signal, offset, out) {
    const { n, re, im, rev, cos, sin, window } = this;
    for (let i = 0; i < n; i++) {
      const idx = offset + i;
      re[i] = idx >= 0 && idx < signal.length ? signal[idx] * window[i] : 0;
      im[i] = 0;
    }
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
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
