/**
 * タブ音声を録音する AudioWorklet（オーディオスレッドで動く）。
 * ステレオのまま CHUNK サンプルごとにメインスレッドへ送り、'flush' を受け取ったら残りを送る。
 */

// AudioWorkletGlobalScope の型（TypeScript の標準ライブラリには含まれない）
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

/** メインスレッドへ送る 1 かたまり */
export interface RecordedChunk {
  /** かたまりの先頭のフレーム番号（AudioContext の開始からのサンプル数） */
  frame: number;
  left: Float32Array;
  right: Float32Array;
  /** flush への応答（録音の最後のかたまり） */
  last?: boolean;
}

const TAB_RECORDER_NAME = 'tab-recorder';
const FLUSH_MESSAGE = 'flush';

const CHUNK = 16384;
/** 入力がまだ無いときの 1 回の処理サンプル数（Web Audio のレンダー量子） */
const RENDER_QUANTUM = 128;

class TabRecorder extends AudioWorkletProcessor {
  private left = new Float32Array(CHUNK);
  private right = new Float32Array(CHUNK);
  private count = 0;
  private start = 0;

  constructor() {
    super();
    this.port.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (data !== FLUSH_MESSAGE) return;
      const chunk: RecordedChunk = {
        frame: this.start,
        left: this.left.slice(0, this.count),
        right: this.right.slice(0, this.count),
        last: true,
      };
      this.port.postMessage(chunk);
      this.count = 0;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const [input] = inputs;
    const left = input.at(0);
    // モノラル入力なら L = R
    const right = input.at(1) ?? left;
    const length = left?.length ?? RENDER_QUANTUM;
    for (let i = 0; i < length; i++) {
      if (this.count === 0) this.start = currentFrame + i;
      this.left[this.count] = left ? left[i] : 0;
      this.right[this.count] = right ? right[i] : 0;
      this.count++;
      if (this.count === CHUNK) {
        const chunk: RecordedChunk = { frame: this.start, left: this.left, right: this.right };
        this.port.postMessage(chunk, [this.left.buffer, this.right.buffer]);
        this.left = new Float32Array(CHUNK);
        this.right = new Float32Array(CHUNK);
        this.count = 0;
      }
    }
    return true;
  }
}

registerProcessor(TAB_RECORDER_NAME, TabRecorder);
