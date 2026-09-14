// =====================
// Chord Analyzer Worker — 重い特徴量抽出をメインスレッドから分離
// in:  { channels: Float32Array[]（モノラル or [L, R]）, sampleRate, options: { timeScale } }
// out: { type: 'progress', phase, progress } | { type: 'features', features } | { type: 'error', message }
// =====================
import { extractFeatures } from './analyzer.js';

self.onmessage = ({ data }) => {
  try {
    const features = extractFeatures(data.channels, data.sampleRate, data.options,
      (phase, progress) => self.postMessage({ type: 'progress', phase, progress }));
    self.postMessage({ type: 'features', features });
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message });
  }
};
