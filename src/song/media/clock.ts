/**
 * 再生時刻の平滑化。
 *
 * プレイヤーが報告する再生位置は、新しい報告が届くたびに数十 ms 前後に跳ぶ（タイムラインが境界でカクつく）。
 * そこで表示用の時刻は自前で一定速度に進め、報告とのずれは時間をかけて平均し、
 * 進む速さを少しだけ変えて追いつく（速度の揺れが目に見えないように）。
 * シーク・ループなどの大きな跳びはそのまま反映する。
 */
import { MS_PER_SECOND } from '../../config/timing';

/** これ以上ずれたら追従せず即座に合わせる（秒） */
const SNAP_SEC = 0.3;
/** ずれを平均する時定数（秒）。報告ごとのばらつきを均す */
const ERROR_FILTER_SEC = 0.5;
/** 平均したずれをこの時間で詰める速さにする（秒） */
const CATCH_UP_SEC = 1.0;
/** 速さの補正の上限（±5%） */
const MAX_RATE_DEVIATION = 0.05;
/** フレーム間隔の上限（秒）。タブが止まっていた間の分を一度に進めない */
const MAX_FRAME_SEC = 0.1;
/** シーク後、プレイヤーの報告が追いつくのを待つ上限（秒） */
const SEEK_SETTLE_TIMEOUT_SEC = 1.0;

export interface ClockSource {
  /** プレイヤーが報告する再生位置（秒） */
  rawTime(): number;
  isPlaying(): boolean;
}

export interface PlaybackClock {
  /** 平滑化した再生位置（秒） */
  time(): number;
  /**
   * シークしたことを知らせる。プレイヤーの報告が追いつくまでの間、シーク先の時刻を返す
   * （古い位置を見て「まだループの終わりを越えている」と判断し、シークを繰り返すのを防ぐ）。
   */
  notifySeek(targetSec: number): void;
}

export function createPlaybackClock(
  source: ClockSource,
  now: () => number = () => performance.now(),
): PlaybackClock {
  let time: number | null = null;
  let lastNow = 0;
  let rate = 1;
  let errorAverage = 0;
  let pendingSeek: { target: number; at: number } | null = null;

  const snapTo = (value: number): number => {
    time = value;
    rate = 1;
    errorAverage = 0;
    return value;
  };

  return {
    time() {
      const raw = source.rawTime();
      const current = now();
      const elapsed = Math.min((current - lastNow) / MS_PER_SECOND, MAX_FRAME_SEC);
      lastNow = current;

      if (pendingSeek) {
        const settled = Math.abs(raw - pendingSeek.target) <= SNAP_SEC;
        const timedOut = (current - pendingSeek.at) / MS_PER_SECOND > SEEK_SETTLE_TIMEOUT_SEC;
        if (!settled && !timedOut) return snapTo(pendingSeek.target);
        pendingSeek = null;
        return snapTo(raw);
      }

      const predicted = time === null ? raw : time + elapsed * rate;
      if (time === null || !source.isPlaying() || Math.abs(raw - predicted) > SNAP_SEC)
        return snapTo(raw);
      errorAverage += (raw - predicted - errorAverage) * Math.min(1, elapsed / ERROR_FILTER_SEC);
      rate =
        1 +
        Math.max(-MAX_RATE_DEVIATION, Math.min(MAX_RATE_DEVIATION, errorAverage / CATCH_UP_SEC));
      time = predicted;
      return predicted;
    },
    notifySeek(targetSec) {
      pendingSeek = { target: targetSec, at: now() };
      snapTo(targetSec);
    },
  };
}

/**
 * 間隔の粗い位置報告（SoundCloud の PLAY_PROGRESS、YouTube の getCurrentTime）を、
 * 最後の報告からの経過時間で補間する。
 */
export class ProgressInterpolator {
  private reported = 0;
  private reportedAt = 0;
  private playing = false;
  private rate = 1;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** プレイヤーから位置（秒）の報告が届いた */
  report(sec: number): void {
    this.reported = sec;
    this.reportedAt = this.now();
  }

  setPlaying(playing: boolean, rate = 1): void {
    if (playing === this.playing && rate === this.rate) return;
    this.report(this.time());
    this.playing = playing;
    this.rate = rate;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  time(): number {
    if (!this.playing) return this.reported;
    return this.reported + ((this.now() - this.reportedAt) / MS_PER_SECOND) * this.rate;
  }
}
