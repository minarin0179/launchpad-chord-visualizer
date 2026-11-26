import { beatSeconds } from '../config/timing';
import { capoPosition } from '../core/capo';
import { chordOf, NO_CHORD, type ChordSpec, type EffectiveChord } from '../core/chord';
import { buildPads, type Pad } from '../core/grid';
import { classifyPads, type PadVisual } from '../core/pad-roles';
import { mod12, type MidiNote, type PitchClass } from '../core/pitch';
import type { Segment } from '../core/segments';
import { scaleDef, type ScaleKey } from '../core/theory';
import type { ChordSource } from '../song/types';
import type { AppState, SongState } from './state';

/**
 * 入力（deps の戻り値）がすべて前回と同じ（===）なら、前回の結果を返すセレクタを作る。
 * 状態は不変なので、関係する部分が変わらなければ再計算されず、結果の参照も変わらない。
 */
function createSelector<D extends readonly unknown[], R>(
  deps: { [K in keyof D]: (state: AppState) => D[K] },
  compute: (...args: D) => R,
): (state: AppState) => R {
  let lastArgs: D | null = null;
  let lastResult: R;
  return (state) => {
    const args = deps.map((dep) => dep(state)) as unknown as D;
    if (lastArgs?.every((arg, i) => arg === args[i])) return lastResult;
    lastArgs = args;
    lastResult = compute(...args);
    return lastResult;
  };
}

// ---------- レイアウト ----------

/** 左下パッドの音 */
export const selectBaseNote = (state: AppState): MidiNote =>
  state.layout.openBaseNote + state.layout.capo;

export const selectPads: (state: AppState) => readonly Pad[] = createSelector(
  [selectBaseNote],
  buildPads,
);

/** カポ位置（0〜11） */
export const selectCapoPosition = (state: AppState): number => capoPosition(state.layout.capo);

// ---------- Song ----------

export function activeSourceOf(song: SongState): ChordSource | null {
  return song.load.status === 'loaded' ? (song.load.sources[song.load.activeSource] ?? null) : null;
}

export const selectActiveSource = (state: AppState): ChordSource | null =>
  activeSourceOf(state.song);

/** 再生位置の区間（どの区間にも入っていなければ null） */
export function currentSegmentOf(song: SongState): Segment | null {
  // segmentIndex は「区間外」を -1 で表すので、Array.prototype.at（-1 = 末尾）は使えない
  const { segmentIndex } = song.cursor;
  return segmentIndex < 0 ? null : (activeSourceOf(song)?.segments[segmentIndex] ?? null);
}

/** FOLLOW が実際に効いているか（曲が読み込まれていて FOLLOW が ON） */
export const selectFollowing = (state: AppState): boolean =>
  state.song.follow && activeSourceOf(state.song) !== null;

export const selectBeatSec = (state: AppState): number =>
  beatSeconds(selectActiveSource(state)?.tempo);

export const selectPlayerReady = (state: AppState): boolean =>
  state.song.playback.status === 'ready';

// ---------- コード / スケール ----------

const selectManualChord = createSelector(
  [
    (s: AppState) => s.manual.root,
    (s: AppState) => s.manual.chordType,
    (s: AppState) => s.manual.inversion,
  ],
  (root, chordType, inversion): EffectiveChord => ({
    kind: 'chord',
    spec: chordOf(root, chordType),
    inversion,
    origin: 'manual',
  }),
);

const selectSongChord = createSelector(
  [(s: AppState) => currentSegmentOf(s.song)],
  (segment): EffectiveChord =>
    segment?.chord
      ? { kind: 'chord', spec: segment.chord, inversion: 0, origin: 'song' }
      : NO_CHORD,
);

/** 画面と Launchpad に表示するコード: FOLLOW 中は再生位置のコード、それ以外は手で選んだコード */
export const selectEffectiveChord = (state: AppState): EffectiveChord =>
  selectFollowing(state) ? selectSongChord(state) : selectManualChord(state);

export interface ScaleRef {
  readonly root: PitchClass;
  readonly scale: ScaleKey;
}

/** 表示するスケール: FOLLOW 中は曲のキー基準、それ以外は手で選んだルート基準 */
export const selectScaleRef: (state: AppState) => ScaleRef = createSelector(
  [
    selectActiveSource,
    (s) => s.song.follow,
    (s) => s.song.scaleChoice,
    (s) => s.manual.root,
    (s) => s.manual.scale,
  ],
  (source, follow, scaleChoice, manualRoot, manualScale) =>
    follow && source
      ? {
          root: source.key.root,
          scale: scaleChoice ?? (source.key.mode === 'minor' ? 'minor' : 'major'),
        }
      : { root: manualRoot, scale: manualScale },
);

const selectScalePitchClasses = createSelector([selectScaleRef], ({ root, scale }) =>
  scaleDef(scale).intervals.map((interval) => mod12(root + interval)),
);

/** 次のコードの予告（FOLLOW 中のみ） */
export const selectPreview = (state: AppState): ChordSpec | null => {
  const { previewIndex } = state.song.cursor;
  if (previewIndex === null || !selectFollowing(state)) return null;
  return selectActiveSource(state)?.segments.at(previewIndex)?.chord ?? null;
};

/** 練習モードが実際に効いているか */
export const selectPracticing = (state: AppState): boolean =>
  state.song.practice && selectFollowing(state);

/** 全パッドの表示上の役割（画面と LED で共通） */
export const selectPadVisuals: (state: AppState) => readonly PadVisual[] = createSelector(
  [
    selectPads,
    selectBaseNote,
    selectEffectiveChord,
    (s) => s.display,
    selectScalePitchClasses,
    selectPracticing,
    selectPreview,
  ],
  (pads, baseNote, chord, display, scale, practice, preview) =>
    classifyPads({
      pads,
      baseNote,
      chord,
      showInversion: display.showInversion,
      // 練習モードは弾くコードだけ: コードトーンは常に表示し、スケールは消す
      showChord: display.showChord || practice,
      scale: display.showScale && !practice ? scale : null,
      practice,
      preview,
    }),
);

// ---------- パッド ----------

/** 鳴っている音（コード検出用） */
export const selectHeldNotes: (state: AppState) => readonly MidiNote[] = createSelector(
  [(s) => s.held],
  (held) => [...new Set(held.map((h) => h.note))],
);

// ---------- MIDI ----------

export const selectDeviceReady = (state: AppState): boolean => state.midi.connection === 'ready';
