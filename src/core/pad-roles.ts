import {
  chordPitchClassesWithBass,
  chordTones,
  type ChordSpec,
  type EffectiveChord,
} from './chord';
import type { Pad } from './grid';
import type { MidiNote, PitchClass } from './pitch';
import { practiceVoicing, type VoicingRole } from './practice';

/** パッドの表示上の役割。画面の CSS クラスと LED の色はこの役割から決まる */
export type PadRole = 'root' | 'bass' | 'chord' | 'scale' | 'next-root' | 'next-chord' | 'off';

export const PAD_ROLES: readonly PadRole[] = [
  'root',
  'bass',
  'chord',
  'scale',
  'next-root',
  'next-chord',
  'off',
];

export interface PadVisual {
  /** 表示する役割（予告を含む） */
  readonly role: PadRole;
  /** 予告の点滅が消えている間の役割（予告でないパッドは role と同じ） */
  readonly under: PadRole;
}

export interface PadRoleInput {
  readonly pads: readonly Pad[];
  /** 左下パッドの音（練習モードのボイシング位置の基準） */
  readonly baseNote: MidiNote;
  readonly chord: EffectiveChord;
  readonly showInversion: boolean;
  /** コードトーンを表示するか（ルートは常に表示） */
  readonly showChord: boolean;
  /** 表示するスケールの構成音。非表示なら null */
  readonly scale: readonly PitchClass[] | null;
  /** 練習モード: 弾くコードのボイシングだけを光らせる */
  readonly practice: boolean;
  /** 次のコードの予告。無ければ null */
  readonly preview: ChordSpec | null;
}

function previewRoleOf(role: VoicingRole): PadRole {
  return role === 'root' ? 'next-root' : 'next-chord';
}

/** 練習モード: 音の高さで決める。予告も練習用ボイシングで、今のコードが光っていないパッドにだけ重ねる */
function classifyForPractice(input: PadRoleInput): PadVisual[] {
  const { chord, baseNote, preview } = input;
  const now =
    chord.kind === 'chord'
      ? practiceVoicing(baseNote, chord.spec)
      : new Map<MidiNote, VoicingRole>();
  const next = preview ? practiceVoicing(baseNote, preview) : null;
  return input.pads.map((pad) => {
    const role = now.get(pad.note);
    if (role) return { role, under: role };
    const nextRole = next?.get(pad.note);
    return nextRole
      ? { role: previewRoleOf(nextRole), under: 'off' }
      : { role: 'off', under: 'off' };
  });
}

/** 通常: 音名（ピッチクラス）で決める */
function classifyByPitchClass(input: PadRoleInput): PadVisual[] {
  const { chord, showChord, scale } = input;
  const tones = chordTones(chord, input.showInversion);
  const root = chord.kind === 'chord' ? chord.spec.root : null;
  const preview = showChord ? input.preview : null;
  const previewTones = preview ? chordPitchClassesWithBass(preview) : [];

  const baseRole = (pc: PitchClass): PadRole => {
    if (pc === root) return 'root';
    if (showChord && pc === tones.bass) return 'bass';
    if (showChord && tones.all.includes(pc)) return 'chord';
    if (scale?.includes(pc)) return 'scale';
    return 'off';
  };

  return input.pads.map((pad) => {
    const under = baseRole(pad.pitchClass);
    // 予告は、今のコードで光っていないパッドにだけ重ねる
    if (!preview || under === 'root' || under === 'bass' || under === 'chord')
      return { role: under, under };
    if (pad.pitchClass === preview.root) return { role: 'next-root', under };
    if (previewTones.includes(pad.pitchClass)) return { role: 'next-chord', under };
    return { role: under, under };
  });
}

/**
 * 全パッドの表示上の役割を決める（画面と LED で共通）。
 * 練習モードではコードトーンを常に表示し、スケールは消す。
 */
export function classifyPads(input: PadRoleInput): PadVisual[] {
  return input.practice ? classifyForPractice(input) : classifyByPitchClass(input);
}
