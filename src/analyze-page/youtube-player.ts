/**
 * YouTube IFrame Player API のラッパー（解析ページ用）。
 * API は <script> を挿入すると window.YT を生やし、準備ができると window.onYouTubeIframeAPIReady を呼ぶ。
 */
import { YOUTUBE_IFRAME_API } from '../config/urls';
import { ProgressInterpolator } from '../song/media/clock';

export const YT_STATE = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;

/** 使っている範囲の YT.Player */
export interface YouTubePlayer {
  cueVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
}

interface YouTubeApi {
  Player: new (
    elementId: string,
    options: {
      videoId: string;
      playerVars: Record<string, number>;
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: () => void;
      };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoading: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT) return Promise.resolve(window.YT);
  apiLoading ??= new Promise<YouTubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error('YouTube IFrame API is unavailable'));
    };
    const script = document.createElement('script');
    script.src = YOUTUBE_IFRAME_API;
    script.addEventListener('error', () => {
      // 次回の LOAD でもう一度試せるようにする
      apiLoading = null;
      reject(new Error('YouTube IFrame API を読み込めません'));
    });
    document.head.appendChild(script);
  });
  return apiLoading;
}

export async function createYouTubePlayer(
  elementId: string,
  videoId: string,
  onStateChange: (state: number) => void,
): Promise<YouTubePlayer> {
  const api = await loadYouTubeApi();
  return new Promise<YouTubePlayer>((resolve, reject) => {
    const player = new api.Player(elementId, {
      videoId,
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: () => {
          resolve(player);
        },
        onStateChange: (event) => {
          onStateChange(event.data);
        },
        onError: () => {
          reject(new Error('YouTube プレイヤーがエラーを返しました'));
        },
      },
    });
  });
}

/** getCurrentTime() は更新間隔が粗いので、再生中は最後に値が変わった時点からの経過時間で補間する */
export class YouTubeClock {
  private readonly progress = new ProgressInterpolator();
  private lastRaw = -1;

  constructor(private readonly player: YouTubePlayer) {}

  now(): number {
    const raw = this.player.getCurrentTime();
    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      this.progress.report(raw);
    }
    const playing = this.player.getPlayerState() === YT_STATE.playing;
    this.progress.setPlaying(playing, this.player.getPlaybackRate());
    return playing ? this.progress.time() : raw;
  }
}
