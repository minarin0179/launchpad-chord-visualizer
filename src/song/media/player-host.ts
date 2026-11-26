import { PLAYER_READY_TIMEOUT_MS } from '../../config/timing';
import type { Media } from '../types';
import type { MediaPlayer, PlayerOptions } from './player';
import { createSonglePlayer } from './songle-player';
import { createSoundCloudPlayer } from './soundcloud-player';

export type PlayerFactory = (
  slot: HTMLElement,
  media: Media,
  options: PlayerOptions,
) => Promise<MediaPlayer>;

const defaultFactory: PlayerFactory = (slot, media, options) =>
  media.kind === 'soundcloud'
    ? createSoundCloudPlayer(slot, media, options)
    : createSonglePlayer(slot, media, options);

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * プレイヤーの置き場所。
 *
 * プレイヤーの生成・破棄を 1 つずつ順番に行う（Songle Widget は同時に 1 つしか存在できない）。
 * 各プレイヤーは専用の枠（slot）の中に作り、破棄するときは自分の枠だけを消す
 * （作成中に次の曲へ切り替えても、後から作られたプレイヤーの DOM を巻き込まない）。
 */
export class PlayerHost {
  private queue: Promise<unknown> = Promise.resolve();
  private current: MediaPlayer | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly create: PlayerFactory = defaultFactory,
    private readonly readyTimeoutMs: number = PLAYER_READY_TIMEOUT_MS,
  ) {}

  /**
   * 今のプレイヤーを破棄して新しいプレイヤーを作る。
   * 準備が終わる前に signal が中断されたら、作ったプレイヤーを破棄して AbortError で失敗する。
   */
  mount(media: Media, options: PlayerOptions, signal: AbortSignal): Promise<MediaPlayer> {
    const result = this.queue.then(async () => {
      this.destroyCurrent();
      signal.throwIfAborted();
      const slot = document.createElement('div');
      slot.className = 'song-player-slot';
      this.container.appendChild(slot);
      let player: MediaPlayer;
      try {
        player = await withTimeout(
          this.create(slot, media, options),
          this.readyTimeoutMs,
          'Player did not become ready',
        );
      } catch (error) {
        slot.remove();
        throw error;
      }
      if (signal.aborted) {
        player.destroy();
        signal.throwIfAborted();
      }
      this.current = player;
      return player;
    });
    // 失敗しても次の mount / unmount は実行する
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** 今のプレイヤーを破棄する */
  unmount(): Promise<void> {
    const result = this.queue.then(() => {
      this.destroyCurrent();
    });
    this.queue = result;
    return result;
  }

  private destroyCurrent(): void {
    this.current?.destroy();
    this.current = null;
  }
}
