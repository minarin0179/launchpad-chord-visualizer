import { RECENT_SONGS_MAX } from '../config/ranges';
import type { RecentEntry } from './types';

/** 先頭に追加する（同じ URL は先頭へ移動、最大 RECENT_SONGS_MAX 件） */
export function addRecent(list: readonly RecentEntry[], entry: RecentEntry): RecentEntry[] {
  return [entry, ...list.filter((r) => r.url !== entry.url)].slice(0, RECENT_SONGS_MAX);
}

export function removeRecent(list: readonly RecentEntry[], url: string): RecentEntry[] {
  return list.filter((r) => r.url !== url);
}

/** 保存データを検証して読み込む（壊れた項目は捨てる） */
export function parseRecents(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: RecentEntry[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { url, title, artist, at } = item as Record<string, unknown>;
    if (typeof url !== 'string') continue;
    entries.push({
      url,
      title: typeof title === 'string' ? title : '',
      artist: typeof artist === 'string' ? artist : '',
      at: typeof at === 'number' ? at : 0,
    });
  }
  return entries.slice(0, RECENT_SONGS_MAX);
}
