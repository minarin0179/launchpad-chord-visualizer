import { MIDI_NOTE_MAX, mod12, type MidiNote, type PitchClass } from './pitch';

/** メインのパッドグリッドは 8 × 8 */
export const GRID_SIZE = 8;
export const PAD_COUNT = GRID_SIZE * GRID_SIZE;

/** 1 段上がるごとに +5 半音（完全 4 度）、1 列右へ +1 半音（ギターと同じ並び） */
export const ROW_INTERVAL = 5;

/** 左下パッドから右上パッドまでの半音数 */
export const MAX_PAD_OFFSET = (GRID_SIZE - 1) * ROW_INTERVAL + (GRID_SIZE - 1);

/** 左下パッドに置ける最も高い音（右上パッドが MIDI の上限を超えない範囲） */
export const MAX_BASE_NOTE = MIDI_NOTE_MAX - MAX_PAD_OFFSET;

/** デフォルトの左下パッド = C2 */
export const DEFAULT_BASE_NOTE = 36;

export interface Pad {
  /** row * GRID_SIZE + col */
  readonly index: number;
  /** 0 = 最下段 */
  readonly row: number;
  /** 0 = 左端 */
  readonly col: number;
  readonly note: MidiNote;
  readonly pitchClass: PitchClass;
}

export function padIndex(row: number, col: number): number {
  return row * GRID_SIZE + col;
}

export function padNote(baseNote: MidiNote, row: number, col: number): MidiNote {
  return baseNote + row * ROW_INTERVAL + col;
}

/** 左下パッドが baseNote のときの 64 パッド（index 順 = 下段の左から） */
export function buildPads(baseNote: MidiNote): Pad[] {
  const pads: Pad[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const note = padNote(baseNote, row, col);
      pads.push({ index: padIndex(row, col), row, col, note, pitchClass: mod12(note) });
    }
  }
  return pads;
}
