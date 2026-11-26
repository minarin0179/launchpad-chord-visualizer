/** 時間に関する定数 */

/** メトロノームは 4 拍子固定。Song の「1 小節戻る」も同じ拍数 */
export const BEATS_PER_BAR = 4;
export const SECONDS_PER_MINUTE = 60;
export const MS_PER_SECOND = 1000;

/** ロゴ LED のフラッシュ後、接続色に戻すまでの時間（ms） */
export const LOGO_FLASH_MS = 80;
/** Programmer モードへの切替 SysEx を送ってから LED を送るまでの待ち時間（ms） */
export const PROGRAMMER_MODE_DELAY_MS = 150;
/** 上段・右列ボタンを Launchpad で押したとき、画面のボタンを光らせる時間（ms） */
export const FN_ACTIVE_DURATION_MS = 200;
export const RIGHT_COL_NOTE_DURATION_MS = 150;
/** MIDI ポートの状態変化をまとめて処理するための待ち時間（ms）。ポートを開くだけでも変化が通知される */
export const MIDI_STATE_DEBOUNCE_MS = 50;

/** 設定の書き込みをまとめる時間（ms）。スライダー操作などの連続した変更を 1 回にする */
export const SETTINGS_SAVE_DEBOUNCE_MS = 300;

/** 次コード予告の Launchpad 点滅の半周期（ms）。画面側の CSS アニメーションはこの 2 倍の周期 */
export const PREVIEW_BLINK_MS = 150;
/** 練習モードで次のコードに切り替える前倒し量（拍） */
export const PRACTICE_LEAD_BEATS = 0.5;
/** 次コードの予告を出し始めるタイミング（切り替えの何拍前か） */
export const PREVIEW_LEAD_BEATS = 1;
/** A-B ループの B 点は A 点からこの拍数より後でなければならない */
export const LOOP_MIN_BEATS = 1;
/** テンポが分からない曲の 1 拍の長さ（秒） */
export const FALLBACK_BEAT_SEC = 0.5;

/** 非表示タブで曲の追従を続けるときの更新間隔（ms） */
export const HIDDEN_TICK_MS = 100;

/** 再生メディアの準備完了を待つ上限（ms） */
export const PLAYER_READY_TIMEOUT_MS = 15000;

/** 1 拍の長さ（秒）。テンポ不明（null / 0 以下）のときは FALLBACK_BEAT_SEC */
export function beatSeconds(tempo: number | null | undefined): number {
  return tempo != null && tempo > 0 ? SECONDS_PER_MINUTE / tempo : FALLBACK_BEAT_SEC;
}
