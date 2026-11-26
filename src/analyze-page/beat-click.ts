import { SILENCE_GAIN } from '../config/instruments';
import { firstBeatAfter } from './time-map';

/** この先までの拍のクリック音を予約しておく（秒） */
const LOOKAHEAD_SEC = 0.12;
const CLICK_HZ = 1500;
const CLICK_GAIN = 0.3;
const CLICK_DECAY_SEC = 0.03;
const CLICK_LENGTH_SEC = 0.04;
/** 再生位置がこれ以上戻った / 進んだらシークとみなして予約位置を取り直す（秒） */
const SEEK_BACK_SEC = 0.05;
const SEEK_FORWARD_SEC = 1;

/**
 * 検出した拍に合わせてクリック音を鳴らす（検出した拍と実際のドラムのずれを耳で確かめる）。
 * AudioContext はユーザー操作を起点に作る必要があるので、enable() はチェックボックスの操作から呼ぶ。
 */
export class BeatClick {
  private ctx: AudioContext | null = null;
  private next = -1;
  private lastTime = 0;

  enable(): void {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    this.reset();
  }

  /** 予約位置を取り直す（設定を切り替えたとき・拍の一覧が変わったとき） */
  reset(): void {
    this.next = -1;
  }

  /**
   * @param t コード進行上の現在時刻（秒）
   * @param bounds [0, 拍…, 曲の長さ]
   * @param rate 再生速度
   */
  schedule(t: number, bounds: readonly number[], rate: number): void {
    const { ctx } = this;
    if (!ctx) return;
    if (
      this.next < 0 ||
      t < this.lastTime - SEEK_BACK_SEC ||
      t > this.lastTime + SEEK_FORWARD_SEC
    ) {
      this.next = firstBeatAfter(bounds, t);
    }
    this.lastTime = t;
    while (this.next < bounds.length - 1 && bounds[this.next] < t + LOOKAHEAD_SEC) {
      const when = ctx.currentTime + Math.max(0, (bounds[this.next] - t) / rate);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = CLICK_HZ;
      gain.gain.setValueAtTime(CLICK_GAIN, when);
      gain.gain.exponentialRampToValueAtTime(SILENCE_GAIN, when + CLICK_DECAY_SEC);
      osc.connect(gain).connect(ctx.destination);
      osc.start(when);
      osc.stop(when + CLICK_LENGTH_SEC);
      this.next++;
    }
  }
}
