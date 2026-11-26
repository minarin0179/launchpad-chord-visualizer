import type { MediaKind } from '../types';

/** 再生メディアの共通インターフェース（Songle 埋め込みプレイヤー / SoundCloud Widget をそろえる） */
export interface MediaPlayer {
  readonly kind: MediaKind;
  /** プレイヤーが報告する再生位置（秒）。報告ごとに数十 ms 揺れるので、表示には PlaybackClock を通す */
  rawTime(): number;
  isPlaying(): boolean;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  /** 0〜100 */
  setVolume(percent: number): void;
  /** プレイヤーを破棄する（自分の DOM だけを消す） */
  destroy(): void;
}

export interface PlayerOptions {
  /** 0〜100 */
  readonly volume: number;
  /** 再生 / 一時停止 / シークなど、状態が変わったときに呼ばれる */
  readonly onStateChange: () => void;
}
