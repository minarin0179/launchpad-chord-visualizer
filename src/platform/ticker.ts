import { HIDDEN_TICK_MS } from '../config/timing';

export interface TickerOptions {
  /** 毎フレーム呼ばれる。visible = false のときは画面の更新を省いてよい */
  readonly onTick: (visible: boolean) => void;
  /** タブが非表示の間も動かし続ける必要があるか（曲に追従して LED を光らせている間など） */
  readonly neededWhileHidden: () => boolean;
}

/**
 * フレームループ。
 * 表示中は requestAnimationFrame、非表示中は Worker のタイマーで動かす
 * （requestAnimationFrame は非表示タブでは止まる。別のウィンドウに隠れているだけでも「非表示」になる）。
 */
export function startTicker({ onTick, neededWhileHidden }: TickerOptions): void {
  let worker: Worker | null = null;

  const frame = (): void => {
    if (document.hidden) return;
    requestAnimationFrame(frame);
    onTick(true);
  };

  const setHiddenTimer = (running: boolean): void => {
    if (!running && !worker) return;
    worker ??= createTickWorker(() => {
      if (document.hidden && neededWhileHidden()) onTick(false);
    });
    worker.postMessage(running ? HIDDEN_TICK_MS : null);
  };

  document.addEventListener('visibilitychange', () => {
    setHiddenTimer(document.hidden);
    if (!document.hidden) requestAnimationFrame(frame);
  });
  requestAnimationFrame(frame);
}

function createTickWorker(onMessage: () => void): Worker {
  const worker = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = onMessage;
  return worker;
}
