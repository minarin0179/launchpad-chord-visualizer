import { buildPadData } from './constants.js';

// =====================
// Global State
// =====================
export const state = {
  baseNote: 36,   // C2 default — shifted by octave/transpose
  root: 0,
  capo: 0,        // cumulative semitone shift via ◄/►
  chordType: 'maj',
  inversion: 0,
  showChord: true,
  showScale: true,
  showInversion: false,
  scale: 'major',
  instrument: 'piano',
  midiOutput: null,
  midiAccess: null,
  bpm: 120,
  metronome: false,
  _metroTimer: null,
  _metroBeat: 0,
};

export let pads = buildPadData(state.baseNote);

// ES Modules live binding: 他モジュールから pads を再代入するためのセッター
export function setPads(newPads) {
  pads = newPads;
}
