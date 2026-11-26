import type { InstrumentKey } from '../config/instruments';
import type { MidiNote, PitchClass } from '../core/pitch';
import type { ChordTypeKey, ScaleKey } from '../core/theory';
import type {
  ChordSource,
  Cursor,
  Loop,
  Media,
  RecentEntry,
  SearchHit,
  SongInfo,
  SourceId,
} from '../song/types';

/** 0〜100 */
export type Percent = number;

export interface LayoutState {
  /** カポ 0 のときの左下パッドの音。オクターブ操作で ±12 */
  readonly openBaseNote: MidiNote;
  /** カポ（半音数の累積。負にもなる）。左下パッドの音 = openBaseNote + capo */
  readonly capo: number;
}

/** 手で選んだコード・スケール（FOLLOW 中の曲のコードはここに書き込まない） */
export interface ManualState {
  readonly root: PitchClass;
  readonly chordType: ChordTypeKey;
  readonly inversion: number;
  readonly scale: ScaleKey;
}

export interface DisplayState {
  /** コードトーンの表示（ルートは常に表示） */
  readonly showChord: boolean;
  readonly showScale: boolean;
  /** 転回形の UI と表示への反映 */
  readonly showInversion: boolean;
}
export type DisplayToggle = keyof DisplayState;

export type SampleStatus = 'loading' | 'loaded' | 'failed';

export interface AudioState {
  readonly instrument: InstrumentKey;
  readonly volume: Percent;
  /** サンプル音源のロード状況（未着手の音色はキーなし） */
  readonly samples: Readonly<Partial<Record<InstrumentKey, SampleStatus>>>;
}

export interface MetronomeState {
  readonly bpm: number;
  readonly running: boolean;
}

export type MidiAccessStatus = 'pending' | 'unsupported' | 'denied' | 'error' | 'granted';
export type DeviceConnection = 'none' | 'connecting' | 'ready';

export interface MidiOutputInfo {
  readonly id: string;
  readonly name: string;
}

export interface MidiState {
  readonly access: MidiAccessStatus;
  readonly errorMessage: string | null;
  /** 接続されている出力ポート */
  readonly outputs: readonly MidiOutputInfo[];
  /** 最後にユーザーが選んだポート名。null = 未保存、'' = 「未選択」を選んだ（自動接続しない） */
  readonly preferredName: string | null;
  readonly selectedOutputId: string | null;
  readonly connection: DeviceConnection;
}

/** 押しているパッド。発音する音は押した時点で確定する（押している間にカポ・オクターブが変わっても同じ音を止められる） */
export interface HeldPad {
  /** 押下の識別子（画面 = "pointer:<id>"、Launchpad = "device:<パッド番号>"） */
  readonly pressId: string;
  readonly padIndex: number;
  readonly note: MidiNote;
}

export type SongPanel =
  | { readonly kind: 'none' }
  | { readonly kind: 'recent' }
  | { readonly kind: 'searching'; readonly query: string }
  | { readonly kind: 'results'; readonly query: string; readonly hits: readonly SearchHit[] }
  | { readonly kind: 'search-failed'; readonly query: string; readonly message: string };

export type SongLoad =
  | { readonly status: 'idle' }
  | { readonly status: 'fetching'; readonly media: Media }
  | { readonly status: 'unregistered'; readonly media: Media }
  | { readonly status: 'failed'; readonly media: Media; readonly message: string }
  | {
      readonly status: 'loaded';
      readonly media: Media;
      readonly info: SongInfo;
      readonly sources: Readonly<Partial<Record<SourceId, ChordSource>>>;
      readonly activeSource: SourceId;
    };

export type PlayerStatus = 'none' | 'loading' | 'ready' | 'error';

export interface PlaybackState {
  readonly status: PlayerStatus;
  readonly playing: boolean;
  readonly error: string | null;
}

export interface SongState {
  readonly volume: Percent;
  readonly collapsed: boolean;
  readonly recents: readonly RecentEntry[];
  /** 入力欄の下に出す候補リスト */
  readonly panel: SongPanel;
  readonly load: SongLoad;
  readonly playback: PlaybackState;
  /** カポを曲に合わせて自動で選ぶ（手動で変えると OFF） */
  readonly capoAuto: boolean;
  /** 再生位置のコードを画面と Launchpad に表示する */
  readonly follow: boolean;
  /** 練習モード（弾くコードだけ点灯）。FOLLOW 中のみ */
  readonly practice: boolean;
  /** FOLLOW 中に選び直したスケール（null = 曲のキーのメジャー / マイナー） */
  readonly scaleChoice: ScaleKey | null;
  readonly cursor: Cursor;
  readonly loop: Loop;
}

export interface AppState {
  readonly layout: LayoutState;
  readonly manual: ManualState;
  readonly display: DisplayState;
  readonly audio: AudioState;
  readonly metronome: MetronomeState;
  readonly midi: MidiState;
  readonly held: readonly HeldPad[];
  readonly song: SongState;
}

/** HeldPad.pressId の接頭辞（押下の入力元） */
export const PRESS_SOURCE = {
  /** 画面のパッド（ポインター ID が続く） */
  pointer: 'pointer:',
  /** Launchpad 本体（パッド番号が続く） */
  device: 'device:',
} as const;
