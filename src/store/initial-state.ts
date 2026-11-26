import { DEFAULT_INSTRUMENT, isInstrumentKey } from '../config/instruments';
import {
  BPM_DEFAULT,
  BPM_MAX,
  BPM_MIN,
  isIntegerIn,
  PERCENT_MAX,
  PERCENT_MIN,
  SONG_VOLUME_DEFAULT,
  VOLUME_DEFAULT,
} from '../config/ranges';
import { DEFAULT_BASE_NOTE, MAX_BASE_NOTE } from '../core/grid';
import { SEMITONES } from '../core/pitch';
import { chordTypeDef, isChordTypeKey, isScaleKey } from '../core/theory';
import { NO_CURSOR } from '../song/follow';
import { LOOP_OFF } from '../song/loop';
import { parseRecents } from '../song/recents';
import { selectBaseNote } from './selectors';
import type { AppState } from './state';

/** localStorage から読んだ生の値（検証前） */
export interface PersistedData {
  readonly settings: unknown;
  /** null = 未保存、'' = ユーザーが「未選択」を選んだ */
  readonly deviceName: string | null;
  readonly songVolume: unknown;
  readonly recents: unknown;
}

export const EMPTY_PERSISTED: PersistedData = {
  settings: null,
  deviceName: null,
  songVolume: null,
  recents: null,
};

/** 保存する設定の形（旧バージョンと同じ。フィールドを変えないこと） */
export interface PersistedSettings {
  root: number;
  chordType: string;
  inversion: number;
  scale: string;
  instrument: string;
  showChord: boolean;
  showScale: boolean;
  showInversion: boolean;
  /** 左下パッドの音（カポ込み） */
  baseNote: number;
  capo: number;
  volume: number;
  bpm: number;
}

const DEFAULT_STATE: AppState = {
  layout: { openBaseNote: DEFAULT_BASE_NOTE, capo: 0 },
  manual: { root: 0, chordType: 'maj', inversion: 0, scale: 'major' },
  display: { showChord: true, showScale: true, showInversion: false },
  audio: { instrument: DEFAULT_INSTRUMENT, volume: VOLUME_DEFAULT, samples: {} },
  metronome: { bpm: BPM_DEFAULT, running: false },
  midi: {
    access: 'pending',
    errorMessage: null,
    outputs: [],
    preferredName: null,
    selectedOutputId: null,
    connection: 'none',
  },
  held: [],
  song: {
    volume: SONG_VOLUME_DEFAULT,
    collapsed: false,
    recents: [],
    panel: { kind: 'none' },
    load: { status: 'idle' },
    playback: { status: 'none', playing: false, error: null },
    capoAuto: true,
    follow: false,
    practice: false,
    scaleChoice: null,
    cursor: NO_CURSOR,
    loop: LOOP_OFF,
  },
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const booleanOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** 旧バージョンは MIDI の範囲を超える高さまで保存できたので、オクターブ単位で範囲内に戻す */
function fitBaseNote(baseNote: number): number {
  let fitted = baseNote;
  while (fitted > MAX_BASE_NOTE) fitted -= SEMITONES;
  return fitted;
}

/** 保存データを検証して初期状態を作る（壊れた値・範囲外の値はデフォルトに戻す） */
export function createInitialState(persisted: PersistedData = EMPTY_PERSISTED): AppState {
  const s = asRecord(persisted.settings);
  const d = DEFAULT_STATE;

  const chordType = isChordTypeKey(s.chordType) ? s.chordType : d.manual.chordType;
  const maxInversion = chordTypeDef(chordType).intervals.length - 1;
  const hasLayout =
    Number.isInteger(s.baseNote) && Number.isInteger(s.capo) && (s.baseNote as number) >= 0;
  const capo = hasLayout ? (s.capo as number) : d.layout.capo;
  const baseNote = hasLayout ? fitBaseNote(s.baseNote as number) : selectBaseNote(d);
  const songVolume = Number(persisted.songVolume);

  return {
    ...d,
    layout: { openBaseNote: baseNote - capo, capo },
    manual: {
      root: isIntegerIn(s.root, 0, SEMITONES - 1) ? s.root : d.manual.root,
      chordType,
      inversion: isIntegerIn(s.inversion, 0, maxInversion) ? s.inversion : 0,
      scale: isScaleKey(s.scale) ? s.scale : d.manual.scale,
    },
    display: {
      showChord: booleanOr(s.showChord, d.display.showChord),
      showScale: booleanOr(s.showScale, d.display.showScale),
      showInversion: booleanOr(s.showInversion, d.display.showInversion),
    },
    audio: {
      ...d.audio,
      instrument: isInstrumentKey(s.instrument) ? s.instrument : d.audio.instrument,
      volume: isIntegerIn(s.volume, PERCENT_MIN, PERCENT_MAX) ? s.volume : d.audio.volume,
    },
    metronome: {
      bpm: isIntegerIn(s.bpm, BPM_MIN, BPM_MAX) ? s.bpm : d.metronome.bpm,
      running: false,
    },
    midi: { ...d.midi, preferredName: persisted.deviceName },
    song: {
      ...d.song,
      volume:
        persisted.songVolume != null && isIntegerIn(songVolume, PERCENT_MIN, PERCENT_MAX)
          ? songVolume
          : d.song.volume,
      recents: parseRecents(persisted.recents),
    },
  };
}

/** 保存する設定（手で選んだ値だけ。FOLLOW 中の曲のコード・スケールは含まれない） */
export function selectPersistedSettings(state: AppState): PersistedSettings {
  return {
    root: state.manual.root,
    chordType: state.manual.chordType,
    inversion: state.manual.inversion,
    scale: state.manual.scale,
    instrument: state.audio.instrument,
    showChord: state.display.showChord,
    showScale: state.display.showScale,
    showInversion: state.display.showInversion,
    baseNote: selectBaseNote(state),
    capo: state.layout.capo,
    volume: state.audio.volume,
    bpm: state.metronome.bpm,
  };
}
