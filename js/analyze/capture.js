// =====================
// タブ音声キャプチャ（getDisplayMedia + AudioWorklet でステレオ PCM を録音）
// Chrome / Edge デスクトップ専用。埋め込みプレイヤーの音も「このタブ」の音声に含まれる。
// センターカット（ボーカル除去）に左右差が必要なので、ダウンミックスせず L/R のまま保持する。
// =====================

const CHUNK = 16384;

const WORKLET_SRC = `
class TabRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alloc();
    this.port.onmessage = () => {
      this.port.postMessage({
        frame: this.start,
        left: this.left.slice(0, this.n),
        right: this.right.slice(0, this.n),
        last: true,
      });
      this.n = 0;
    };
  }
  alloc() {
    this.left = new Float32Array(${CHUNK});
    this.right = new Float32Array(${CHUNK});
    this.n = 0;
    this.start = 0;
  }
  process(inputs) {
    const input = inputs[0];
    const len = input.length ? input[0].length : 128;
    const l = input[0];
    const r = input[1] ?? input[0];  // モノラル入力なら L=R
    for (let i = 0; i < len; i++) {
      if (this.n === 0) this.start = currentFrame + i;
      this.left[this.n] = l ? l[i] : 0;
      this.right[this.n] = r ? r[i] : 0;
      this.n++;
      if (this.n === ${CHUNK}) {
        this.port.postMessage({ frame: this.start, left: this.left, right: this.right },
          [this.left.buffer, this.right.buffer]);
        this.alloc();
      }
    }
    return true;
  }
}
registerProcessor('tab-recorder', TabRecorder);
`;

// 戻り値: { sampleRate, currentFrame(), stop(): Promise<{ channels: [L, R], sampleRate, baseFrame }> }
export async function captureTabAudio({ onEnded } = {}) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      suppressLocalAudioPlayback: true,  // スピーカーからは鳴らさずに録音だけする
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
    },
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    systemAudio: 'exclude',
  });

  const [track] = stream.getAudioTracks();
  if (!track) {
    stream.getTracks().forEach(t => t.stop());
    throw new Error('音声が共有されていません。ダイアログで「タブの音声も共有する」を ON にしてください');
  }
  track.onended = () => onEnded?.();

  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const recorder = new AudioWorkletNode(ctx, 'tab-recorder', {
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const sink = ctx.createGain();
  sink.gain.value = 0;  // Worklet を確実に駆動させるため destination に無音で接続
  source.connect(recorder).connect(sink).connect(ctx.destination);

  const chunks = [];
  let resolveFlush;
  recorder.port.onmessage = ({ data }) => {
    chunks.push(data);
    if (data.last) resolveFlush();
  };

  return {
    sampleRate: ctx.sampleRate,
    currentFrame: () => Math.round(ctx.currentTime * ctx.sampleRate),

    async stop() {
      const flushed = new Promise(resolve => { resolveFlush = resolve; });
      recorder.port.postMessage('flush');
      await Promise.race([flushed, new Promise(r => setTimeout(r, 1000))]);
      source.disconnect();
      stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
      await ctx.close();

      if (chunks.length === 0) {
        return { channels: [new Float32Array(0), new Float32Array(0)], sampleRate: ctx.sampleRate, baseFrame: 0 };
      }
      const baseFrame = chunks[0].frame;
      const last = chunks[chunks.length - 1];
      const length = last.frame + last.left.length - baseFrame;
      const left = new Float32Array(length);
      const right = new Float32Array(length);
      for (const c of chunks) {
        left.set(c.left, c.frame - baseFrame);
        right.set(c.right, c.frame - baseFrame);
      }
      return { channels: [left, right], sampleRate: ctx.sampleRate, baseFrame };
    },
  };
}
