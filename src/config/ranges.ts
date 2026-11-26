/** 値の範囲とデフォルト値（HTML の属性もここから設定する） */

export const BPM_MIN = 40;
export const BPM_MAX = 240;
export const BPM_DEFAULT = 120;

export const PERCENT_MIN = 0;
export const PERCENT_MAX = 100;
/** 楽器音量（INST）の初期値（%） */
export const VOLUME_DEFAULT = 50;
/** 曲プレイヤー音量（SONG）の初期値（%） */
export const SONG_VOLUME_DEFAULT = 40;

/** MIDI ベロシティの上限 */
export const VELOCITY_MAX = 127;
/** 画面のパッドをクリックしたときのベロシティ */
export const CLICK_PAD_VELOCITY = 80;

/** 最近読み込んだ曲の保存件数 */
export const RECENT_SONGS_MAX = 10;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
