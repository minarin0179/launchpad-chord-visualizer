import { BEATS_PER_BAR } from '../config/timing';
import { formatClock } from '../core/time-format';
import type { Logger } from '../platform/logger';
import type { Action } from '../store/actions';
import type { Store } from '../store/create-store';
import { selectActiveSource, selectBeatSec, selectFollowing } from '../store/selectors';
import type { AppState } from '../store/state';
import { computeCursor } from './follow';
import { loopSeekTarget } from './loop';
import { createPlaybackClock, type PlaybackClock } from './media/clock';
import type { MediaPlayer } from './media/player';
import type { ChordSource, Loop } from './types';

/** 再生位置に合わせて毎フレーム更新するビュー */
export interface FrameView {
  /** t はコード進行上の時刻（秒） */
  frame(t: number, source: ChordSource): void;
}

function describeLoop(loop: Loop): string {
  if (loop.kind === 'off') return 'off';
  return loop.kind === 'a'
    ? `A=${formatClock(loop.a)}`
    : `${formatClock(loop.a)}–${formatClock(loop.b)}`;
}

/**
 * Song バーの実行部分: 再生位置を読み、今のコード・予告・A-B ループを進める。
 *
 * 再生位置（毎フレーム変わる値）はストアに入れず、変化のあったときだけ結果（カーソル）を dispatch する。
 */
export class SongRuntime {
  private player: MediaPlayer | null = null;
  private clock: PlaybackClock | null = null;
  private readonly views: FrameView[] = [];

  constructor(
    private readonly store: Store<AppState, Action>,
    private readonly logger: Logger,
  ) {
    store.watch(
      (state) => state.song.volume,
      (volume) => this.player?.setVolume(volume),
    );
  }

  addView(view: FrameView): void {
    this.views.push(view);
  }

  /** プレイヤーの準備ができた（null = 破棄された） */
  setPlayer(player: MediaPlayer | null): void {
    this.player = player;
    this.clock = player && createPlaybackClock(player);
  }

  /** プレイヤーから再生状態の変化が通知された */
  syncPlaying(): void {
    if (this.player)
      this.store.dispatch({ type: 'playingChanged', playing: this.player.isPlaying() });
  }

  /** コード進行上の現在時刻（秒）。プレイヤーが無ければ null */
  time(): number | null {
    const source = selectActiveSource(this.store.getState());
    return this.clock && source ? this.clock.time() + source.offsetSec : null;
  }

  // ----- 操作 -----

  togglePlay(): void {
    if (!this.player) return;
    if (this.player.isPlaying()) this.player.pause();
    else this.player.play();
  }

  /** コード進行上の時刻 t へシークする */
  seekTo(t: number): void {
    const source = selectActiveSource(this.store.getState());
    if (!this.player || !this.clock || !source) return;
    const target = Math.max(0, t - source.offsetSec);
    this.clock.notifySeek(target);
    this.player.seek(target);
  }

  backOneBar(): void {
    const t = this.time();
    if (t !== null) this.seekTo(t - BEATS_PER_BAR * selectBeatSec(this.store.getState()));
  }

  cycleLoop(): void {
    const t = this.time();
    if (t === null) return;
    this.store.dispatch({ type: 'loopCycled', t });
    this.logger.out(`Song: loop ${describeLoop(this.store.getState().song.loop)}`);
  }

  toggleFollow(): void {
    this.store.dispatch({ type: 'followSet', on: !this.store.getState().song.follow });
  }

  // ----- フレームループ -----

  /** タブが非表示でも動かし続ける必要があるか（LED を曲に追従させている・ループ再生中） */
  neededWhileHidden(): boolean {
    const state = this.store.getState();
    const active = selectFollowing(state) || state.song.loop.kind === 'ab';
    return this.player !== null && state.song.playback.playing && active;
  }

  /** @param visible false のときは画面の更新を省く */
  frame(visible: boolean): void {
    const state = this.store.getState();
    const source = selectActiveSource(state);
    if (!this.player || !this.clock || !source) return;

    // 状態変化のイベントを取りこぼしても表示がずれたままにならないよう、毎フレーム確かめる
    const playing = this.player.isPlaying();
    if (playing !== state.song.playback.playing)
      this.store.dispatch({ type: 'playingChanged', playing });

    let t = this.clock.time() + source.offsetSec;
    const loopStart = loopSeekTarget(state.song.loop, t, playing);
    if (loopStart !== null) {
      this.seekTo(loopStart);
      t = loopStart;
    }

    this.store.dispatch({
      type: 'cursorMoved',
      cursor: computeCursor({
        segments: source.segments,
        t,
        beatSec: selectBeatSec(state),
        follow: selectFollowing(state),
        practice: state.song.practice,
        playing,
      }),
    });

    if (visible) for (const view of this.views) view.frame(t, source);
  }
}
