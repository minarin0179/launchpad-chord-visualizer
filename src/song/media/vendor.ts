/**
 * 外部のプレイヤースクリプト（Songle Widget API / SoundCloud Widget API）の読み込みと型。
 * どちらも <script> を挿入すると window にグローバルを生やす方式なので、その扱いをこのファイルに閉じ込める。
 */
import { SONGLE_WIDGET_SCRIPT, SOUNDCLOUD_WIDGET_SCRIPT } from '../../config/urls';

// ---------- Songle Widget API ----------
export interface SongleWidget {
  readonly position?: { readonly milliseconds: number };
  readonly isPlaying: boolean;
  readonly status?: string;
  volume: number;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  remove(): void;
  on(event: string, handler: () => void): void;
}

export interface SongleWidgetOptions {
  api: string;
  url: string;
  songAutoPlay: boolean;
  songAutoLoop: boolean;
  songVolume: number;
  songleWidgetSizeW: number;
  videoPlayerSizeW: number;
  videoPlayerSizeH: number;
  onReady: (widget: SongleWidget) => void;
  onError: (widget?: SongleWidget) => void;
}

export interface SongleWidgetApi {
  /** widgets.js の <script> と div#songle-widget を含む要素を返す。DOM に追加すると埋め込みプレイヤーになる */
  createSongleWidgetElement(options: SongleWidgetOptions): HTMLElement;
}

// ---------- SoundCloud Widget API ----------
export interface SoundCloudProgress {
  readonly currentPosition: number;
}

export interface SoundCloudWidget {
  bind(event: string, handler: (event: SoundCloudProgress) => void): void;
  unbind(event: string): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setVolume(percent: number): void;
}

export interface SoundCloudApi {
  Widget: ((iframe: HTMLIFrameElement) => SoundCloudWidget) & {
    readonly Events: Readonly<
      Record<'READY' | 'PLAY' | 'PAUSE' | 'FINISH' | 'SEEK' | 'PLAY_PROGRESS', string>
    > &
      Readonly<Record<string, string>>;
  };
}

declare global {
  interface Window {
    SongleWidgetAPI?: SongleWidgetApi;
    SC?: SoundCloudApi;
  }
}

const loading = new Map<string, Promise<void>>();

/** <script> を 1 回だけ読み込む（失敗したら次回また試せるようにする） */
export function loadScript(src: string): Promise<void> {
  let promise = loading.get(src);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.addEventListener('load', () => {
        resolve();
      });
      script.addEventListener('error', () => {
        loading.delete(src);
        reject(new Error(`Failed to load ${src}`));
      });
      document.head.appendChild(script);
    });
    loading.set(src, promise);
  }
  return promise;
}

export async function loadSongleApi(): Promise<SongleWidgetApi> {
  await loadScript(SONGLE_WIDGET_SCRIPT);
  if (!window.SongleWidgetAPI) throw new Error('Songle Widget API is unavailable');
  return window.SongleWidgetAPI;
}

export async function loadSoundCloudApi(): Promise<SoundCloudApi> {
  await loadScript(SOUNDCLOUD_WIDGET_SCRIPT);
  if (!window.SC) throw new Error('SoundCloud Widget API is unavailable');
  return window.SC;
}
