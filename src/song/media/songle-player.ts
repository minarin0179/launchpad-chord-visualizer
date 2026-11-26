import { VIDEO_ASPECT_RATIO } from '../../config/timeline';
import { MS_PER_SECOND } from '../../config/timing';
import type { Media } from '../types';
import type { MediaPlayer, PlayerOptions } from './player';
import { loadSongleApi, type SongleWidget } from './vendor';

/** 埋め込みプレイヤーの幅の下限と、コンテナの幅が取れないときの幅（px） */
const MIN_WIDTH = 200;
const FALLBACK_WIDTH = 480;
/** 再生状態が変わりうるイベント */
const STATE_EVENTS = ['play', 'pause', 'stop', 'finish', 'seek'] as const;

let widgetSerial = 0;

/**
 * Songle の埋め込みプレイヤー（YouTube / ニコニコ動画 / ピアプロ）。
 *
 * Songle Widget は固定 id の div#songle-widget を使うので、同時に 1 つしか作れない
 * （PlayerHost が生成と破棄を直列化する）。再生位置は Songle 側で補間済み。
 */
export async function createSonglePlayer(
  slot: HTMLElement,
  media: Media,
  { volume, onStateChange }: PlayerOptions,
): Promise<MediaPlayer> {
  const api = await loadSongleApi();
  const width = Math.max(MIN_WIDTH, Math.round(slot.clientWidth || FALLBACK_WIDTH));
  const widget = await new Promise<SongleWidget>((resolve, reject) => {
    const element = api.createSongleWidgetElement({
      api: `launchpad-song-${++widgetSerial}`,
      url: media.songleUrl,
      songAutoPlay: false,
      songAutoLoop: false,
      songVolume: volume,
      songleWidgetSizeW: width,
      videoPlayerSizeW: width,
      videoPlayerSizeH: Math.round(width * VIDEO_ASPECT_RATIO),
      onReady: resolve,
      onError: (failed) => {
        reject(new Error(`Songle Widget error${failed?.status ? ` (${failed.status})` : ''}`));
      },
    });
    slot.appendChild(element);
  });

  for (const event of STATE_EVENTS) widget.on(event, onStateChange);
  widget.volume = volume;
  return {
    kind: media.kind,
    rawTime: () => (widget.position?.milliseconds ?? 0) / MS_PER_SECOND,
    isPlaying: () => widget.isPlaying,
    play: () => {
      widget.play();
    },
    pause: () => {
      widget.pause();
    },
    seek: (sec) => {
      widget.seekTo(Math.round(Math.max(0, sec) * MS_PER_SECOND));
    },
    setVolume: (percent) => {
      widget.volume = percent;
    },
    destroy: () => {
      try {
        widget.remove();
      } catch {
        // 既に消えている
      }
      slot.remove();
    },
  };
}
