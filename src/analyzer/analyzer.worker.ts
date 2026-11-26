/// <reference lib="webworker" />
/**
 * 重い特徴量抽出をメインスレッドから分離する Worker。
 * メッセージの形は protocol.ts を参照。
 */
import { extractFeatures } from './features';
import type { AnalyzeRequest, AnalyzeResponse } from './protocol';

const post = (message: AnalyzeResponse): void => {
  self.postMessage(message);
};

self.onmessage = ({ data }: MessageEvent<AnalyzeRequest>): void => {
  try {
    const features = extractFeatures(
      data.channels,
      data.sampleRate,
      data.options,
      (phase, progress) => {
        post({ type: 'progress', phase, progress });
      },
    );
    post({ type: 'features', features });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
