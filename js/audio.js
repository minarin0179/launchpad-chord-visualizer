import { INSTRUMENTS, METRO_ACCENT, METRO_NORMAL, METRO_CLICK_RAMP_S } from './constants.js';
import { state } from './state.js';

// =====================
// Web Audio Synth
// =====================
let audioCtx = null;
const activeNotes = new Map(); // midiNote → { oscNodes, gain, ctx, releaseTime }

export function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new AudioContext(); } catch(e) { console.error('AudioContext failed:', e); return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(e => console.warn('AudioContext resume failed:', e));
  return audioCtx;
}

export function midiNoteToFreq(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

export function getActiveNotes() {
  return activeNotes;
}

// onNoteChange: コールバック（detectChordFromActiveNotes を呼ぶ） — 循環依存回避のため注入
// volume: 0.0〜1.0 の音量（getVolume() の結果を呼び出し元から渡す）
export function startNote(midiNote, velocity = 64, volume = 0.5, onNoteChange) {
  stopNote(midiNote, onNoteChange); // retrigger: stop existing

  const ctx = getAudioCtx();
  if (!ctx) return;
  const vol = volume * (velocity / 127);
  if (vol <= 0) return;

  const freq = midiNoteToFreq(midiNote);
  const now = ctx.currentTime;
  const inst = INSTRUMENTS[state.instrument] || INSTRUMENTS.synth;

  // Master gain (envelope)
  const gain = ctx.createGain();
  const peakVol = vol * inst.peakVolFactor;
  const { attackBase, attackVelRange, decayTime, sustainRatio, releaseTime } = inst.envelope;
  const attackTime = attackBase + (1 - velocity / 127) * attackVelRange;
  const sustainVol = peakVol * sustainRatio;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peakVol, now + attackTime);
  if (decayTime > 0) {
    gain.gain.linearRampToValueAtTime(Math.max(sustainVol, 0.0001), now + attackTime + decayTime);
  }

  // Routing: gain → [filter →] destination
  if (inst.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = inst.filter.type;
    filter.frequency.value = inst.filter.frequency;
    filter.Q.value = inst.filter.Q || 1;
    gain.connect(filter);
    filter.connect(ctx.destination);
  } else {
    gain.connect(ctx.destination);
  }

  // Create oscillators
  const oscNodes = [];
  if (inst.harmonics) {
    // Organ mode: additive synthesis
    inst.harmonics.forEach((mult, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * mult, now);
      const hGain = ctx.createGain();
      hGain.gain.value = inst.harmonicGains[i];
      osc.connect(hGain);
      hGain.connect(gain);
      osc.start(now);
      oscNodes.push(osc);
    });
  } else {
    const osc1 = ctx.createOscillator();
    osc1.type = inst.osc1.type;
    osc1.frequency.setValueAtTime(freq, now);
    osc1.connect(gain);
    osc1.start(now);
    oscNodes.push(osc1);

    if (inst.osc2) {
      const osc2 = ctx.createOscillator();
      osc2.type = inst.osc2.type;
      osc2.frequency.setValueAtTime(freq, now);
      if (inst.osc2.detune) osc2.detune.setValueAtTime(inst.osc2.detune, now);
      const osc2Gain = ctx.createGain();
      osc2Gain.gain.value = inst.osc2.volRatio;
      osc2.connect(osc2Gain);
      osc2Gain.connect(gain);
      osc2.start(now);
      oscNodes.push(osc2);
    }
  }

  activeNotes.set(midiNote, { oscNodes, gain, ctx, releaseTime });
  if (onNoteChange) onNoteChange();
}

export function stopNote(midiNote, onNoteChange) {
  const note = activeNotes.get(midiNote);
  if (!note) return;
  activeNotes.delete(midiNote);

  const { oscNodes, gain, ctx, releaseTime } = note;
  const t = ctx.currentTime;

  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + releaseTime);
  oscNodes.forEach(osc => osc.stop(t + releaseTime));
  if (onNoteChange) onNoteChange();
}

// =====================
// Metronome click sound
// =====================
export function playMetronomeClick(isAccent) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const { freq, vol, decay } = isAccent ? METRO_ACCENT : METRO_NORMAL;

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'sine';
  osc.frequency.value = freq;

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + METRO_CLICK_RAMP_S);
  gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

  osc.start(now);
  osc.stop(now + decay + 0.01);
}
