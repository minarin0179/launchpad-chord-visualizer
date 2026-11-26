import { METRO_SCHEDULE_AHEAD_SEC, METRO_SCHEDULER_INTERVAL_MS } from '../config/instruments';
import { BEATS_PER_BAR, MS_PER_SECOND, SECONDS_PER_MINUTE } from '../config/timing';

export interface MetronomeDeps {
  /** いまの BPM */
  readonly getBpm: () => number;
  /** クリック音を delaySec 秒後に鳴らすよう予約する */
  readonly scheduleClick: (accent: boolean, delaySec: number) => void;
  /** 拍の瞬間に呼ばれる（ロゴ LED のフラッシュ用） */
  readonly onBeat: (accent: boolean) => void;
  /** 現在時刻（秒）。テストで差し替える */
  readonly now?: () => number;
}

export interface Metronome {
  start(): void;
  stop(): void;
}

/**
 * 4 拍子固定のメトロノーム。
 *
 * 次の拍の時刻を足し算で進めていき、少し先の拍までクリック音を予約する（setInterval の周期に頼らないのでずれない）。
 * BPM を変えると次の拍から新しい間隔になる（拍の位置はリセットしない）。
 */
export function createMetronome({ getBpm, scheduleClick, onBeat, now }: MetronomeDeps): Metronome {
  const clock = now ?? ((): number => performance.now() / MS_PER_SECOND);
  let timer: ReturnType<typeof setInterval> | null = null;
  let nextBeatAt = 0;
  let beat = 0;
  const pending = new Set<ReturnType<typeof setTimeout>>();

  const schedule = (): void => {
    const current = clock();
    // タブが長く止まっていた場合は、たまった拍をまとめて鳴らさずに今から数え直す
    if (nextBeatAt < current - METRO_SCHEDULE_AHEAD_SEC) nextBeatAt = current;
    while (nextBeatAt < current + METRO_SCHEDULE_AHEAD_SEC) {
      const accent = beat === 0;
      const delay = Math.max(0, nextBeatAt - current);
      scheduleClick(accent, delay);
      const flash = setTimeout(() => {
        pending.delete(flash);
        onBeat(accent);
      }, delay * MS_PER_SECOND);
      pending.add(flash);
      beat = (beat + 1) % BEATS_PER_BAR;
      nextBeatAt += SECONDS_PER_MINUTE / getBpm();
    }
  };

  return {
    start() {
      if (timer !== null) return;
      beat = 0;
      nextBeatAt = clock();
      schedule();
      timer = setInterval(schedule, METRO_SCHEDULER_INTERVAL_MS);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      for (const flash of pending) clearTimeout(flash);
      pending.clear();
    },
  };
}
