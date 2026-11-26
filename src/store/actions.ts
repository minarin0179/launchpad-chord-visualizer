import type { InstrumentKey } from '../config/instruments';
import type { MidiNote, PitchClass } from '../core/pitch';
import type { ChordTypeKey, ScaleKey } from '../core/theory';
import type { ChordSource, Cursor, Media, SearchHit, SongInfo, SourceId } from '../song/types';
import type {
  DeviceConnection,
  DisplayToggle,
  MidiAccessStatus,
  MidiOutputInfo,
  Percent,
  PlayerStatus,
  SampleStatus,
} from './state';

/** ユーザーの操作・外部イベント 1 つにつきアクション 1 つ（途中の状態を作らない） */
export type Action =
  // ----- レイアウト -----
  | { type: 'octaveShifted'; delta: 1 | -1 }
  /** 手動のカポ変更（画面 / Launchpad）。AUTO を解除する */
  | { type: 'capoShifted'; delta: number }
  | { type: 'capoReset' }
  /** カポを曲に合わせる AUTO を有効にして、今の曲に適用する */
  | { type: 'capoAutoEnabled' }
  // ----- コード / スケール（手動操作は FOLLOW を止める） -----
  | { type: 'rootSelected'; root: PitchClass }
  | { type: 'chordTypeSelected'; chordType: ChordTypeKey }
  | { type: 'inversionSelected'; inversion: number }
  | { type: 'scaleSelected'; scale: ScaleKey }
  | { type: 'displayToggled'; key: DisplayToggle }
  // ----- 音 -----
  | { type: 'instrumentSelected'; instrument: InstrumentKey }
  | { type: 'volumeChanged'; volume: Percent }
  | { type: 'sampleStatusChanged'; instrument: InstrumentKey; status: SampleStatus }
  // ----- メトロノーム -----
  | { type: 'bpmChanged'; bpm: number }
  | { type: 'metronomeToggled' }
  // ----- MIDI -----
  | { type: 'midiAccessResolved'; access: MidiAccessStatus; errorMessage?: string }
  | {
      type: 'midiPortsChanged';
      outputs: readonly MidiOutputInfo[];
      selectedOutputId: string | null;
    }
  /** ユーザーが選択欄を操作した（選んだポート名を次回の自動接続用に覚える） */
  | { type: 'deviceSelectedByUser'; outputId: string | null }
  | { type: 'deviceConnectionChanged'; connection: DeviceConnection }
  // ----- パッド -----
  | { type: 'padPressed'; pressId: string; padIndex: number; note: MidiNote }
  | { type: 'padReleased'; pressId: string }
  /** pressId がこの接頭辞で始まる押下をすべて解放（'' = 全部） */
  | { type: 'padsReleased'; prefix: string }
  // ----- Song バー -----
  | { type: 'songVolumeChanged'; volume: Percent }
  | { type: 'songBarCollapseToggled' }
  | { type: 'searchStarted'; query: string }
  | { type: 'searchSucceeded'; query: string; hits: readonly SearchHit[] }
  | { type: 'searchFailed'; query: string; message: string }
  | { type: 'recentPanelToggled' }
  | { type: 'recentPanelOpened' }
  | { type: 'panelClosed' }
  | { type: 'recentRemoved'; url: string }
  // ----- 曲の読み込み -----
  | { type: 'songLoadStarted'; media: Media }
  | { type: 'songUnregistered'; media: Media }
  | { type: 'songLoadFailed'; media: Media; message: string }
  | {
      type: 'songLoaded';
      media: Media;
      info: SongInfo;
      sources: Readonly<Partial<Record<SourceId, ChordSource>>>;
      activeSource: SourceId;
      /** 履歴に記録する時刻（Date.now()） */
      now: number;
    }
  | { type: 'sourceSelected'; source: SourceId }
  // ----- 再生 -----
  | { type: 'playerStatusChanged'; status: PlayerStatus; error?: string }
  | { type: 'playingChanged'; playing: boolean }
  // ----- FOLLOW / ループ -----
  | { type: 'followSet'; on: boolean }
  | { type: 'practiceSet'; on: boolean }
  | { type: 'cursorMoved'; cursor: Cursor }
  /** A-B ボタン。t はコード進行上の時刻（秒） */
  | { type: 'loopCycled'; t: number };

export type ActionType = Action['type'];
