/// <reference lib="webworker" />
/**
 * 一定間隔でメインスレッドに通知するだけの Worker。
 * 非表示タブではメインスレッドのタイマーが約 1 秒間隔に間引かれるが、Worker のタイマーは間引かれない。
 */
let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = ({ data }: MessageEvent<number | null>): void => {
  if (timer !== null) clearInterval(timer);
  timer =
    data === null
      ? null
      : setInterval(() => {
          self.postMessage(null);
        }, data);
};
