import { MS_PER_SECOND } from '../../config/timing';
import { SOUNDCLOUD_ORIGIN, SOUNDCLOUD_PLAYER } from '../../config/urls';
import type { Media } from '../types';
import { ProgressInterpolator } from './clock';
import type { MediaPlayer, PlayerOptions } from './player';
import { loadSoundCloudApi } from './vendor';

/**
 * SoundCloud Widget API のプレイヤー。
 * （Songle 経由の音源 URL は SoundCloud の廃止された API を指していて再生できないので、公式の Widget を使う）
 * 再生位置の報告は数百 ms ごとなので、最後の報告からの経過時間で補間する。
 */
export async function createSoundCloudPlayer(
  slot: HTMLElement,
  media: Media,
  { volume, onStateChange }: PlayerOptions,
): Promise<MediaPlayer> {
  const api = await loadSoundCloudApi();
  const iframe = document.createElement('iframe');
  iframe.allow = 'autoplay';
  iframe.className = 'song-sc-player';
  const params = new URLSearchParams({
    url: SOUNDCLOUD_ORIGIN + media.id,
    visual: 'true',
    auto_play: 'false',
    show_comments: 'false',
  });
  iframe.src = `${SOUNDCLOUD_PLAYER}?${params.toString()}`;
  slot.appendChild(iframe);

  const events = api.Widget.Events;
  const widget = api.Widget(iframe);
  const progress = new ProgressInterpolator();
  const setPlaying = (playing: boolean): void => {
    progress.setPlaying(playing);
    onStateChange();
  };
  const report = ({ currentPosition }: { currentPosition: number }): void => {
    progress.report(currentPosition / MS_PER_SECOND);
  };

  widget.bind(events.PLAY, () => {
    setPlaying(true);
  });
  widget.bind(events.PAUSE, () => {
    setPlaying(false);
  });
  widget.bind(events.FINISH, () => {
    setPlaying(false);
  });
  widget.bind(events.PLAY_PROGRESS, report);
  widget.bind(events.SEEK, report);
  await new Promise<void>((resolve) => {
    widget.bind(events.READY, () => {
      resolve();
    });
  });

  widget.setVolume(volume);
  return {
    kind: 'soundcloud',
    rawTime: () => progress.time(),
    isPlaying: () => progress.isPlaying(),
    play: () => {
      widget.play();
    },
    pause: () => {
      widget.pause();
    },
    seek: (sec) => {
      const target = Math.max(0, sec);
      progress.report(target);
      widget.seekTo(Math.round(target * MS_PER_SECOND));
    },
    setVolume: (percent) => {
      widget.setVolume(percent);
    },
    destroy: () => {
      for (const event of Object.values(events)) widget.unbind(event);
      slot.remove();
    },
  };
}
