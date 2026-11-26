/**
 * タブ音声のキャプチャ（getDisplayMedia + AudioWorklet でステレオ PCM を録音）。
 * Chrome / Edge デスクトップ専用。埋め込みプレイヤーの音も「このタブ」の音声に含まれる。
 * センターカット（ボーカル除去）に左右の差が必要なので、ダウンミックスせず L / R のまま保持する。
 */
import type { RecordedChunk } from './tab-recorder.worklet';
import workletUrl from './tab-recorder.worklet.ts?worker&url';

/** worklet 側の定数と一致させる（worklet は別スレッドのスクリプトなので値を import できない） */
const TAB_RECORDER_NAME = 'tab-recorder';
const FLUSH_MESSAGE = 'flush';
/** 録音の最後のかたまりを待つ上限（ms） */
const FLUSH_TIMEOUT_MS = 1000;

export interface Recording {
  readonly channels: [Float32Array, Float32Array];
  readonly sampleRate: number;
  /** channels[0][0] のフレーム番号 */
  readonly baseFrame: number;
}

export interface TabCapture {
  readonly sampleRate: number;
  /** 現在のフレーム番号（録音データと動画時刻を対応付けるのに使う） */
  currentFrame(): number;
  stop(): Promise<Recording>;
}

/** Chrome 独自の指定を含む getDisplayMedia のオプション */
const DISPLAY_MEDIA_OPTIONS = {
  video: true,
  audio: {
    // スピーカーからは鳴らさずに録音だけする
    suppressLocalAudioPlayback: true,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
  },
  preferCurrentTab: true,
  selfBrowserSurface: 'include',
  surfaceSwitching: 'exclude',
  systemAudio: 'exclude',
} as DisplayMediaStreamOptions;

function assemble(chunks: readonly RecordedChunk[], sampleRate: number): Recording {
  const first = chunks.at(0);
  const last = chunks.at(-1);
  if (!first || !last)
    return { channels: [new Float32Array(0), new Float32Array(0)], sampleRate, baseFrame: 0 };
  const baseFrame = first.frame;
  const length = last.frame + last.left.length - baseFrame;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (const chunk of chunks) {
    left.set(chunk.left, chunk.frame - baseFrame);
    right.set(chunk.right, chunk.frame - baseFrame);
  }
  return { channels: [left, right], sampleRate, baseFrame };
}

/** @param onEnded ユーザーが共有を止めたときに呼ばれる */
export async function captureTabAudio(onEnded: () => void): Promise<TabCapture> {
  const stream = await navigator.mediaDevices.getDisplayMedia(DISPLAY_MEDIA_OPTIONS);
  const track = stream.getAudioTracks().at(0);
  if (!track) {
    for (const other of stream.getTracks()) other.stop();
    throw new Error(
      '音声が共有されていません。ダイアログで「タブの音声も共有する」を ON にしてください',
    );
  }
  track.addEventListener('ended', onEnded);

  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(workletUrl);
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const recorder = new AudioWorkletNode(ctx, TAB_RECORDER_NAME, {
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  // Worklet を確実に動かすため、無音にして出力へつなぐ
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(recorder).connect(sink).connect(ctx.destination);

  const chunks: RecordedChunk[] = [];
  let onFlushed: (() => void) | null = null;
  recorder.port.onmessage = ({ data }: MessageEvent<RecordedChunk>) => {
    chunks.push(data);
    if (data.last) onFlushed?.();
  };

  return {
    sampleRate: ctx.sampleRate,
    currentFrame: () => Math.round(ctx.currentTime * ctx.sampleRate),
    async stop() {
      const flushed = new Promise<void>((resolve) => {
        onFlushed = resolve;
      });
      recorder.port.postMessage(FLUSH_MESSAGE);
      await Promise.race([
        flushed,
        new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
      ]);
      source.disconnect();
      track.removeEventListener('ended', onEnded);
      for (const other of stream.getTracks()) other.stop();
      await ctx.close();
      return assemble(chunks, ctx.sampleRate);
    },
  };
}
