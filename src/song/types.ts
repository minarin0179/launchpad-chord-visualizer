import type { Key } from '../core/key';
import type { Segment, Timing } from '../core/segments';

export type MediaKind = 'youtube' | 'niconico' | 'soundcloud' | 'piapro';

export const MEDIA_LABELS: Record<MediaKind, string> = {
  youtube: 'YouTube',
  niconico: 'ニコニコ',
  soundcloud: 'SoundCloud',
  piapro: 'ピアプロ',
};

/** 再生する曲（URL から判定） */
export interface Media {
  readonly kind: MediaKind;
  /** メディア内の ID（YouTube の動画 ID、SoundCloud の user/track など） */
  readonly id: string;
  /** Songle API に渡す URL（スキームなし） */
  readonly songleUrl: string;
}

/** 入力欄・URL パラメータ・履歴に使う正規の URL */
export function mediaPageUrl(media: Media): string {
  return `https://${media.songleUrl}`;
}

/** 曲情報（Songle の応答を単位・形をそろえて持つ） */
export interface SongInfo {
  readonly title: string;
  readonly artist: string;
  /** 曲の長さ（秒）。不明なら null */
  readonly durationSec: number | null;
  /** Songle が正規化した曲の URL */
  readonly permalink: string;
  /** Songle の曲ページ（http/https のときだけ） */
  readonly pageUrl: string | null;
}

export type SourceId = 'songle' | 'analysis';

/** コード進行のソース（Songle or analyze.html の解析結果） */
export interface ChordSource {
  readonly id: SourceId;
  /** ソース選択欄に出す名前 */
  readonly label: string;
  readonly key: Key;
  /** BPM。不明なら null */
  readonly tempo: number | null;
  readonly segments: readonly Segment[];
  readonly timing: Timing;
  /** 再生時刻に足す補正（秒）。コード進行の時刻 = 再生時刻 + offsetSec */
  readonly offsetSec: number;
  /** segments[i] より後で最初にコードがある区間の index（無ければ -1） */
  readonly nextChord: readonly number[];
}

export interface SearchHit {
  readonly media: Media;
  readonly title: string;
  readonly artist: string;
  readonly durationSec: number | null;
}

/** 最近読み込んだ曲（localStorage に保存する形） */
export interface RecentEntry {
  readonly url: string;
  readonly title: string;
  readonly artist: string;
  /** 読み込んだ時刻（Date.now()） */
  readonly at: number;
}

/** A-B ループ: A のみ設定 → B も設定 → 解除 */
export type Loop =
  | { readonly kind: 'off' }
  | { readonly kind: 'a'; readonly a: number }
  | { readonly kind: 'ab'; readonly a: number; readonly b: number };

/** 再生位置から決まる、今のコードと予告するコード */
export interface Cursor {
  /** 今のコードの区間（どの区間にも入らなければ -1） */
  readonly segmentIndex: number;
  /** 予告する次のコードの区間（予告しないなら null） */
  readonly previewIndex: number | null;
}

export const NO_SEGMENT = -1;
