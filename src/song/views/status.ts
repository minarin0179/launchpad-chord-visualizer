import type { SongState } from '../../store/state';
import { MEDIA_LABELS } from '../types';

export type StatusKind = '' | 'busy' | 'ok' | 'error';

export interface SongStatus {
  readonly text: string;
  readonly kind: StatusKind;
}

function describePanel(song: SongState): SongStatus | null {
  const { panel } = song;
  switch (panel.kind) {
    case 'none':
      return null;
    case 'recent':
      return song.recents.length
        ? { text: 'Recent songs — pick one', kind: 'ok' }
        : { text: 'No recent songs yet', kind: '' };
    case 'searching':
      return { text: `Searching Songle for "${panel.query}"…`, kind: 'busy' };
    case 'search-failed':
      return { text: `Search failed: ${panel.message}`, kind: 'error' };
    case 'results':
      return panel.hits.length
        ? { text: `${panel.hits.length} songs found — pick one`, kind: 'ok' }
        : { text: `No songs found on Songle for "${panel.query}"`, kind: 'error' };
  }
}

/** Song バーのステータス行。候補リストを開いている間はその状況、それ以外は曲の読み込み状況を出す */
export function describeSongStatus(song: SongState): SongStatus {
  const panel = describePanel(song);
  if (panel) return panel;
  const { load, playback } = song;
  switch (load.status) {
    case 'idle':
      return { text: '', kind: '' };
    case 'fetching':
      return { text: 'Fetching chords…', kind: 'busy' };
    case 'unregistered':
      return {
        text: `Songle に登録されていない曲です（${MEDIA_LABELS[load.media.kind]}）`,
        kind: 'error',
      };
    case 'failed':
      return { text: `Songle から取得できません: ${load.message}`, kind: 'error' };
    case 'loaded':
      if (playback.status === 'error')
        return { text: `Player error: ${playback.error ?? 'unknown'}`, kind: 'error' };
      return { text: load.sources[load.activeSource]?.label ?? '', kind: 'ok' };
  }
}
