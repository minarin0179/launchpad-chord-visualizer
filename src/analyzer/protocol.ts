import type { AnalysisPhase, ExtractOptions, Features } from './types';

/** メインスレッド → Worker */
export interface AnalyzeRequest {
  /** モノラル or [L, R] */
  channels: Float32Array[];
  sampleRate: number;
  options: ExtractOptions;
}

/** Worker → メインスレッド */
export type AnalyzeResponse =
  | { type: 'progress'; phase: AnalysisPhase; progress: number }
  | { type: 'features'; features: Features }
  | { type: 'error'; message: string };
