import type { AnalyzeRequest, AnalyzeResponse } from '../analyzer/protocol';
import type { AnalysisPhase, Features } from '../analyzer/types';

/** 各フェーズが全体の進捗のどの範囲を占めるか、と表示名 */
const PHASES: Record<AnalysisPhase, { from: number; to: number; label: string }> = {
  resample: { from: 0, to: 0.08, label: 'リサンプル' },
  onset: { from: 0.08, to: 0.18, label: 'オンセット検出' },
  beats: { from: 0.18, to: 0.2, label: 'ビート追跡' },
  bass: { from: 0.2, to: 0.35, label: '低音クロマ抽出' },
  chroma: { from: 0.35, to: 0.65, label: 'クロマ抽出（ミッド）' },
  chromaSide: { from: 0.65, to: 1, label: 'クロマ抽出（サイド）' },
};

/**
 * Worker で特徴量を抽出する（1 回の解析ごとに Worker を作って終わったら止める）。
 * @param onProgress 全体の進捗（0〜1）と、いまのフェーズの表示名
 */
export function extractInWorker(
  channels: Float32Array[],
  sampleRate: number,
  timeScale: number,
  onProgress: (ratio: number, label: string) => void,
): Promise<Features> {
  return new Promise<Features>((resolve, reject) => {
    const worker = new Worker(new URL('../analyzer/analyzer.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = (settle: () => void): void => {
      worker.terminate();
      settle();
    };
    worker.onmessage = ({ data }: MessageEvent<AnalyzeResponse>) => {
      switch (data.type) {
        case 'progress': {
          const { from, to, label } = PHASES[data.phase];
          onProgress(from + (to - from) * data.progress, label);
          return;
        }
        case 'features':
          finish(() => {
            resolve(data.features);
          });
          return;
        case 'error':
          finish(() => {
            reject(new Error(data.message));
          });
      }
    };
    worker.onerror = (event) => {
      finish(() => {
        reject(new Error(event.message || 'Worker を起動できません'));
      });
    };
    const request: AnalyzeRequest = { channels, sampleRate, options: { timeScale } };
    worker.postMessage(
      request,
      channels.map((channel) => channel.buffer),
    );
  });
}
