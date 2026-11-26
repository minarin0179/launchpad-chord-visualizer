/** localStorage のキー。保存済みデータを読めなくなるので変更しないこと */

const APP_PREFIX = 'launchpad-chord-visualizer:';

export const STORAGE_KEYS = {
  /** 画面の設定（コード・スケール・音色・カポ・音量・BPM など） */
  settings: `${APP_PREFIX}settings`,
  /** 最後にユーザーが選んだ MIDI 出力ポート名（'' = 「未選択」を選んだ） */
  device: `${APP_PREFIX}device`,
  /** 曲プレイヤーの音量 */
  songVolume: `${APP_PREFIX}song-volume`,
  /** 最近読み込んだ曲 */
  recentSongs: `${APP_PREFIX}recent-songs`,
} as const;

/** 解析結果（analyze.html が保存し、Song バーも読む）。キーは接頭辞 + YouTube の動画 ID */
export const ANALYSIS_CACHE_PREFIX = 'chord-analyzer:v2:';

export function analysisCacheKey(videoId: string): string {
  return ANALYSIS_CACHE_PREFIX + videoId;
}
