/** 1 オクターブの半音数 */
export const SEMITONES = 12;

/** ピッチクラス（0 = C, 1 = C#, …, 11 = B） */
export type PitchClass = number;

/** MIDI ノート番号（0〜127） */
export type MidiNote = number;

export const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export const MIDI_NOTE_MAX = 127;

const A4_MIDI = 69;
const A4_HZ = 440;
/** MIDI ノート 0 は C-1（C4 = 60） */
const MIDI_OCTAVE_OFFSET = -1;

/** 負の数も 0〜11 に畳み込む */
export function mod12(n: number): PitchClass {
  return ((n % SEMITONES) + SEMITONES) % SEMITONES;
}

export function noteName(pc: PitchClass): string {
  return NOTE_NAMES[mod12(pc)];
}

/** 音名 + オクターブ（例: 36 → "C2"） */
export function noteLabel(note: MidiNote): string {
  return `${noteName(note)}${Math.floor(note / SEMITONES) + MIDI_OCTAVE_OFFSET}`;
}

export function midiToFreq(note: MidiNote): number {
  return A4_HZ * 2 ** ((note - A4_MIDI) / SEMITONES);
}

/** from 以上で最も近い、ピッチクラス pc の音 */
export function nearestAtOrAbove(pc: PitchClass, from: MidiNote): MidiNote {
  return from + mod12(pc - from);
}
