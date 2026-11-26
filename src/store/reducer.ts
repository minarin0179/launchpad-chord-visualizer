import { BPM_MAX, BPM_MIN, clamp, PERCENT_MAX, PERCENT_MIN } from '../config/ranges';
import { suggestCapo } from '../core/capo';
import { MAX_BASE_NOTE } from '../core/grid';
import { mod12, SEMITONES } from '../core/pitch';
import { chordTypeDef } from '../core/theory';
import { computeCursor, NO_CURSOR } from '../song/follow';
import { cycleLoop, LOOP_OFF } from '../song/loop';
import { addRecent, removeRecent } from '../song/recents';
import { mediaPageUrl } from '../song/types';
import type { Action } from './actions';
import { activeSourceOf, currentSegmentOf, selectBaseNote, selectBeatSec } from './selectors';
import type { AppState, ManualState, SongState } from './state';

const percent = (value: number): number => clamp(Math.round(value), PERCENT_MIN, PERCENT_MAX);

const withSong = (state: AppState, song: Partial<SongState>): AppState => ({
  ...state,
  song: { ...state.song, ...song },
});

// =====================
// レイアウト
// =====================

function canMoveBase(state: AppState, delta: number): boolean {
  const base = selectBaseNote(state) + delta;
  return base >= 0 && base <= MAX_BASE_NOTE;
}

function shiftOctave(state: AppState, delta: number): AppState {
  const semitones = delta * SEMITONES;
  if (!canMoveBase(state, semitones)) return state;
  return {
    ...state,
    layout: { ...state.layout, openBaseNote: state.layout.openBaseNote + semitones },
  };
}

/**
 * カポを動かす。左下パッドの音とルートを同じだけずらすので、パッド上の形は変わらない（移調）。
 * 範囲外になる移動は無視する。
 */
function shiftCapo(state: AppState, delta: number): AppState {
  if (delta === 0 || !canMoveBase(state, delta)) return state;
  return {
    ...state,
    layout: { ...state.layout, capo: state.layout.capo + delta },
    manual: { ...state.manual, root: mod12(state.manual.root + delta), inversion: 0 },
  };
}

/** AUTO が有効なら、今の曲の構成音が C メジャースケールに最も収まるカポにする */
function applyAutoCapo(state: AppState): AppState {
  const source = activeSourceOf(state.song);
  if (!state.song.capoAuto || !source) return state;
  const delta = suggestCapo(source.segments) - state.layout.capo;
  // 同じ形になるカポ（±1 オクターブ）のうち、パッドの範囲に収まるものを選ぶ
  const candidates = [delta, delta - SEMITONES, delta + SEMITONES];
  const usable = candidates.find((candidate) => canMoveBase(state, candidate));
  return usable === undefined ? state : shiftCapo(state, usable);
}

// =====================
// FOLLOW
// =====================

/** FOLLOW 中に表示していた曲のコードを、手で選んだコードとして引き継ぐ（N.C. の間は元のまま） */
function adoptSongChord(state: AppState): ManualState {
  const chord = state.song.follow ? currentSegmentOf(state.song)?.chord : null;
  if (!chord) return state.manual;
  return { ...state.manual, root: chord.root, chordType: chord.type, inversion: 0 };
}

/** FOLLOW を止める。練習モードは FOLLOW 前提なので一緒に OFF */
function stopFollow(state: AppState): AppState {
  if (!state.song.follow && !state.song.practice) return state;
  return {
    ...state,
    manual: adoptSongChord(state),
    song: {
      ...state.song,
      follow: false,
      practice: false,
      scaleChoice: null,
      cursor: { ...state.song.cursor, previewIndex: null },
    },
  };
}

function startFollow(state: AppState): AppState {
  if (state.song.follow || !activeSourceOf(state.song)) return state;
  return withSong(state, { follow: true, scaleChoice: null });
}

/** 手動でコードを選んだとき: FOLLOW を止めてから manual を書き換える */
function editManual(state: AppState, edit: (manual: ManualState) => ManualState): AppState {
  const stopped = stopFollow(state);
  return { ...stopped, manual: edit(stopped.manual) };
}

/** ソースを選んだ直後の状態: AUTO カポを適用し、FOLLOW を ON にして、再生位置の先頭から始める */
function enterSource(state: AppState): AppState {
  const source = activeSourceOf(state.song);
  if (!source) return state;
  const followed = startFollow(applyAutoCapo(withSong(state, { loop: LOOP_OFF })));
  return withSong(followed, {
    cursor: computeCursor({
      segments: source.segments,
      t: source.offsetSec,
      beatSec: selectBeatSec(followed),
      follow: true,
      practice: followed.song.practice,
      playing: false,
    }),
  });
}

// =====================
// Reducer
// =====================

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    // ----- レイアウト -----
    case 'octaveShifted':
      return shiftOctave(state, action.delta);
    case 'capoShifted':
      return shiftCapo(withSong(state, { capoAuto: false }), action.delta);
    case 'capoReset':
      return shiftCapo(withSong(state, { capoAuto: false }), -state.layout.capo);
    case 'capoAutoEnabled':
      return applyAutoCapo(withSong(state, { capoAuto: true }));

    // ----- コード / スケール -----
    case 'rootSelected':
      return editManual(state, (manual) => ({ ...manual, root: mod12(action.root), inversion: 0 }));
    case 'chordTypeSelected':
      return editManual(state, (manual) => ({
        ...manual,
        chordType: action.chordType,
        inversion: 0,
      }));
    case 'inversionSelected':
      return editManual(state, (manual) => ({
        ...manual,
        inversion: clamp(action.inversion, 0, chordTypeDef(manual.chordType).intervals.length - 1),
      }));
    case 'scaleSelected':
      // FOLLOW 中の選び直しは曲の間だけ有効（保存しない）
      return state.song.follow && activeSourceOf(state.song)
        ? withSong(state, { scaleChoice: action.scale })
        : { ...state, manual: { ...state.manual, scale: action.scale } };
    case 'displayToggled':
      return { ...state, display: { ...state.display, [action.key]: !state.display[action.key] } };

    // ----- 音 -----
    case 'instrumentSelected':
      return { ...state, audio: { ...state.audio, instrument: action.instrument } };
    case 'volumeChanged':
      return { ...state, audio: { ...state.audio, volume: percent(action.volume) } };
    case 'sampleStatusChanged':
      return {
        ...state,
        audio: {
          ...state.audio,
          samples: { ...state.audio.samples, [action.instrument]: action.status },
        },
      };

    // ----- メトロノーム -----
    case 'bpmChanged':
      return {
        ...state,
        metronome: { ...state.metronome, bpm: clamp(Math.round(action.bpm), BPM_MIN, BPM_MAX) },
      };
    case 'metronomeToggled': {
      // ロゴ LED を光らせるので、デバイス未接続では開始しない
      const running = !state.metronome.running && state.midi.connection === 'ready';
      return { ...state, metronome: { ...state.metronome, running } };
    }

    // ----- MIDI -----
    case 'midiAccessResolved':
      return {
        ...state,
        midi: { ...state.midi, access: action.access, errorMessage: action.errorMessage ?? null },
      };
    case 'midiPortsChanged':
      return {
        ...state,
        midi: { ...state.midi, outputs: action.outputs, selectedOutputId: action.selectedOutputId },
      };
    case 'deviceSelectedByUser': {
      const name = state.midi.outputs.find((output) => output.id === action.outputId)?.name ?? '';
      return {
        ...state,
        midi: { ...state.midi, selectedOutputId: action.outputId, preferredName: name },
      };
    }
    case 'deviceConnectionChanged': {
      const midi = { ...state.midi, connection: action.connection };
      if (action.connection !== 'none') return { ...state, midi };
      // デバイスが無くなったら、メトロノームと本体で押していたパッドも止める
      return {
        ...state,
        midi,
        metronome: { ...state.metronome, running: false },
        held: state.held.filter((h) => !h.pressId.startsWith('device:')),
      };
    }

    // ----- パッド -----
    case 'padPressed': {
      const { pressId, padIndex, note } = action;
      return {
        ...state,
        held: [...state.held.filter((h) => h.pressId !== pressId), { pressId, padIndex, note }],
      };
    }
    case 'padReleased': {
      const held = state.held.filter((h) => h.pressId !== action.pressId);
      return held.length === state.held.length ? state : { ...state, held };
    }
    case 'padsReleased': {
      const held = state.held.filter((h) => !h.pressId.startsWith(action.prefix));
      return held.length === state.held.length ? state : { ...state, held };
    }

    // ----- Song バー -----
    case 'songVolumeChanged':
      return withSong(state, { volume: percent(action.volume) });
    case 'songBarCollapseToggled':
      return withSong(state, { collapsed: !state.song.collapsed });
    case 'searchStarted':
      return withSong(state, { panel: { kind: 'searching', query: action.query } });
    case 'searchSucceeded':
      return withSong(state, {
        panel: { kind: 'results', query: action.query, hits: action.hits },
      });
    case 'searchFailed':
      return withSong(state, {
        panel: { kind: 'search-failed', query: action.query, message: action.message },
      });
    case 'recentPanelToggled':
      return withSong(state, {
        panel: { kind: state.song.panel.kind === 'recent' ? 'none' : 'recent' },
      });
    case 'recentPanelOpened':
      return withSong(state, { panel: { kind: 'recent' } });
    case 'panelClosed':
      return state.song.panel.kind === 'none'
        ? state
        : withSong(state, { panel: { kind: 'none' } });
    case 'recentRemoved':
      return withSong(state, { recents: removeRecent(state.song.recents, action.url) });

    // ----- 曲の読み込み -----
    case 'songLoadStarted':
      return withSong(stopFollow(state), {
        load: { status: 'fetching', media: action.media },
        playback: { status: 'none', playing: false, error: null },
        panel: { kind: 'none' },
        collapsed: false,
        cursor: NO_CURSOR,
        loop: LOOP_OFF,
      });
    case 'songUnregistered':
      return withSong(state, { load: { status: 'unregistered', media: action.media } });
    case 'songLoadFailed':
      return withSong(state, {
        load: { status: 'failed', media: action.media, message: action.message },
      });
    case 'songLoaded': {
      const { media, info, sources, activeSource, now } = action;
      const entry = { url: mediaPageUrl(media), title: info.title, artist: info.artist, at: now };
      return enterSource(
        withSong(state, {
          load: { status: 'loaded', media, info, sources, activeSource },
          playback: { status: 'loading', playing: false, error: null },
          recents: addRecent(state.song.recents, entry),
        }),
      );
    }
    case 'sourceSelected': {
      const { load } = state.song;
      if (load.status !== 'loaded' || !load.sources[action.source]) return state;
      return enterSource(withSong(state, { load: { ...load, activeSource: action.source } }));
    }

    // ----- 再生 -----
    case 'playerStatusChanged': {
      const playback = { status: action.status, playing: false, error: action.error ?? null };
      // プレイヤーを作れなかったら、追従するものが無いので FOLLOW も止める
      return withSong(action.status === 'error' ? stopFollow(state) : state, { playback });
    }
    case 'playingChanged':
      return state.song.playback.playing === action.playing
        ? state
        : withSong(state, { playback: { ...state.song.playback, playing: action.playing } });

    // ----- FOLLOW / ループ -----
    case 'followSet':
      return action.on ? startFollow(state) : stopFollow(state);
    case 'practiceSet': {
      if (!action.on) return state.song.practice ? withSong(state, { practice: false }) : state;
      // 練習モードは FOLLOW 前提なので一緒に ON にする
      const followed = startFollow(state);
      return followed.song.follow ? withSong(followed, { practice: true }) : state;
    }
    case 'cursorMoved': {
      const { segmentIndex, previewIndex } = state.song.cursor;
      return segmentIndex === action.cursor.segmentIndex &&
        previewIndex === action.cursor.previewIndex
        ? state
        : withSong(state, { cursor: action.cursor });
    }
    case 'loopCycled':
      return activeSourceOf(state.song)
        ? withSong(state, { loop: cycleLoop(state.song.loop, action.t, selectBeatSec(state)) })
        : state;
  }
}
