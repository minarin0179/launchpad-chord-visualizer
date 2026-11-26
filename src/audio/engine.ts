import {
  instrumentDef,
  METRO_ACCENT,
  METRO_CLICK_RAMP_SEC,
  METRO_CLICK_TAIL_SEC,
  METRO_NORMAL,
  SILENCE_GAIN,
  synthPreset,
  type InstrumentKey,
} from '../config/instruments';
import { PERCENT_MAX } from '../config/ranges';
import type { MidiNote } from '../core/pitch';
import { errorMessage, type Logger } from '../platform/logger';
import { Sampler, type SampleStatusListener } from './sampler';
import { startSynthVoice, type Voice } from './synth-voice';

const SILENT_VOICE: Voice = { stop: () => undefined };

export interface AudioEngineDeps {
  readonly logger: Logger;
  readonly onSampleStatus: SampleStatusListener;
  /** ブラウザの自動再生制限で音が出せない状態になった / 解除された */
  readonly onBlockedChange: (blocked: boolean) => void;
}

/**
 * 発音の入口。サンプル音源を優先し、未ロード・ロード失敗時はオシレーター合成で鳴らす。
 *
 * 楽器の音（サンプル・合成の両方）は 1 つのゲインノードを通るので、音量スライダーは鳴っている音にも効く。
 * AudioContext は最初に必要になったときに作る（ブラウザはユーザー操作の前に音を出させない）。
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private instrumentBus: GainNode | null = null;
  private readonly sampler: Sampler;
  private instrument: InstrumentKey;
  private volume: number;
  private blocked = false;
  private voiceSerial = 0;

  constructor(
    private readonly deps: AudioEngineDeps,
    initial: { instrument: InstrumentKey; volumePercent: number },
  ) {
    this.sampler = new Sampler(deps.onSampleStatus);
    this.instrument = initial.instrument;
    this.volume = initial.volumePercent / PERCENT_MAX;
  }

  /** ユーザー操作（クリック・キー入力）のたびに呼ぶ。音を出せる状態にして、選択中の音色を先読みする */
  unlock(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    if (audio.ctx.state === 'suspended') {
      audio.ctx.resume().then(
        () => {
          this.setBlocked(false);
        },
        () => undefined,
      );
    }
    this.preload();
  }

  setVolume(percent: number): void {
    this.volume = percent / PERCENT_MAX;
    if (this.instrumentBus) this.instrumentBus.gain.value = this.volume;
  }

  setInstrument(instrument: InstrumentKey): void {
    this.instrument = instrument;
    this.sampler.forgetFailure(instrument);
    this.preload();
  }

  /** 1 音鳴らす。押下ごとに独立した Voice を返す（同じ音を 2 か所で押しても別々に止められる） */
  noteOn(note: MidiNote, velocity: number): Voice {
    const audio = this.ensureContext();
    if (!audio || velocity <= 0) return SILENT_VOICE;
    // MIDI 入力はユーザー操作とみなされないので、画面を一度も操作していないと音が出ない
    this.setBlocked(audio.ctx.state === 'suspended');

    if (this.sampler.usesSamples(this.instrument)) {
      const sampled = this.sampler.start(
        this.instrument,
        note,
        velocity,
        `voice-${++this.voiceSerial}`,
      );
      if (sampled) return sampled;
      // 未ロードならロードを始め、今回は合成音で鳴らす
      this.sampler.load(audio.ctx, audio.bus, this.instrument);
    }
    const preset = synthPreset(instrumentDef(this.instrument).synth);
    return startSynthVoice(audio.ctx, audio.bus, preset, note, velocity);
  }

  /** メトロノームのクリック音を delaySec 秒後に鳴らす（楽器の音量とは独立） */
  scheduleClick(accent: boolean, delaySec: number): void {
    const ctx = this.ensureContext()?.ctx;
    if (!ctx) return;
    const { freq, vol, decay } = accent ? METRO_ACCENT : METRO_NORMAL;
    const start = ctx.currentTime + Math.max(0, delaySec);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(vol, start + METRO_CLICK_RAMP_SEC);
    gain.gain.exponentialRampToValueAtTime(SILENCE_GAIN, start + decay);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + decay + METRO_CLICK_TAIL_SEC);
    osc.addEventListener('ended', () => {
      gain.disconnect();
    });
  }

  private preload(): void {
    if (!this.ctx || !this.instrumentBus) return;
    this.sampler.load(this.ctx, this.instrumentBus, this.instrument);
  }

  private setBlocked(blocked: boolean): void {
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    this.deps.onBlockedChange(blocked);
  }

  private ensureContext(): { ctx: AudioContext; bus: GainNode } | null {
    if (this.ctx && this.instrumentBus) return { ctx: this.ctx, bus: this.instrumentBus };
    try {
      const ctx = new AudioContext();
      const bus = ctx.createGain();
      bus.gain.value = this.volume;
      bus.connect(ctx.destination);
      this.ctx = ctx;
      this.instrumentBus = bus;
      return { ctx, bus };
    } catch (error) {
      this.deps.logger.error(`AudioContext failed: ${errorMessage(error)}`);
      return null;
    }
  }
}
