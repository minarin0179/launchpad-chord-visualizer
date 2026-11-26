import { MIN_SUSTAIN_GAIN, SILENCE_GAIN, type SynthPreset } from '../config/instruments';
import { VELOCITY_MAX } from '../config/ranges';
import { midiToFreq, type MidiNote } from '../core/pitch';

/** 鳴っている 1 音。stop() でリリースをかけて止める */
export interface Voice {
  stop(): void;
}

/**
 * オシレーター合成で 1 音鳴らす。
 * 音量（ボリュームスライダー）は destination 側のゲインで決まるので、ここではベロシティだけを反映する。
 */
export function startSynthVoice(
  ctx: AudioContext,
  destination: AudioNode,
  preset: SynthPreset,
  note: MidiNote,
  velocity: number,
): Voice {
  const now = ctx.currentTime;
  const frequency = midiToFreq(note);
  const strength = velocity / VELOCITY_MAX;
  const { attackBase, attackVelRange, decayTime, sustainRatio, releaseTime } = preset.envelope;
  // 強く弾くほどアタックが速い
  const attackTime = attackBase + (1 - strength) * attackVelRange;
  const peak = strength * preset.peakVolFactor;

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(peak, now + attackTime);
  if (decayTime > 0) {
    envelope.gain.linearRampToValueAtTime(
      Math.max(peak * sustainRatio, MIN_SUSTAIN_GAIN),
      now + attackTime + decayTime,
    );
  }

  // envelope → [filter →] destination
  const nodes: AudioNode[] = [envelope];
  if (preset.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = preset.filter.type;
    filter.frequency.value = preset.filter.frequency;
    filter.Q.value = preset.filter.q;
    envelope.connect(filter);
    filter.connect(destination);
    nodes.push(filter);
  } else {
    envelope.connect(destination);
  }

  const oscillators: OscillatorNode[] = [];
  const addOscillator = (
    type: OscillatorType,
    freq: number,
    detune: number,
    gain: number,
  ): void => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (detune) osc.detune.setValueAtTime(detune, now);
    if (gain === 1) {
      osc.connect(envelope);
    } else {
      const level = ctx.createGain();
      level.gain.value = gain;
      osc.connect(level);
      level.connect(envelope);
      nodes.push(level);
    }
    osc.start(now);
    oscillators.push(osc);
  };

  if (preset.kind === 'additive') {
    for (const { multiple, gain } of preset.harmonics)
      addOscillator('sine', frequency * multiple, 0, gain);
  } else {
    addOscillator(preset.osc1.type, frequency, 0, 1);
    if (preset.osc2)
      addOscillator(preset.osc2.type, frequency, preset.osc2.detune, preset.osc2.volRatio);
  }

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      const { gain } = envelope;
      gain.cancelScheduledValues(t);
      // 指数カーブは 0 から始められないので、アタックの途中で離した場合も下限値から減衰させる
      gain.setValueAtTime(Math.max(gain.value, MIN_SUSTAIN_GAIN), t);
      gain.exponentialRampToValueAtTime(SILENCE_GAIN, t + releaseTime);
      for (const osc of oscillators) osc.stop(t + releaseTime);
      // 鳴り終わったらノードを切り離す（つないだままだと解放されない）
      oscillators.at(-1)?.addEventListener('ended', () => {
        for (const node of [...oscillators, ...nodes]) node.disconnect();
      });
    },
  };
}
