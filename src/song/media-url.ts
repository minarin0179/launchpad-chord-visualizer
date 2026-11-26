import { YOUTUBE_WATCH } from '../config/urls';
import type { Media } from './types';

const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_ID_LENGTH = 11;
const YOUTUBE_PATH = /^\/(?:embed|shorts|live|v)\/([\w-]{11})/;
const YOUTUBE_HOST_PREFIX = /^(www|m|music)\./;
const MEDIA_HOST_PREFIX = /^(www|sp|m|embed)\./;
const HAS_SCHEME = /^https?:\/\//i;
/** URL の形（スキームは省略可、ドメイン + パス）。11 文字の単語を動画 ID と誤認しないための判定 */
const LOOKS_LIKE_URL = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+\//i;

const NICONICO_WATCH = /^\/watch\/((?:sm|nm|so)?\d+)/;
const NICONICO_SHORT = /^\/((?:sm|nm|so)\d+)/;
const SOUNDCLOUD_TRACK = /^\/([\w-]+)\/([\w-]+)\/?$/;
/** /t/<id> または /t/<id>/<版 = 14 桁の日時> */
const PIAPRO_TRACK = /^\/t\/([\w-]+)(?:\/(\d{14}))?/;

function toUrl(input: string): URL | null {
  try {
    return new URL(HAS_SCHEME.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
}

function youtubeIdFromUrl(url: URL): string | null {
  const host = url.hostname.replace(YOUTUBE_HOST_PREFIX, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1, 1 + YOUTUBE_ID_LENGTH);
    return YOUTUBE_ID.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v');
    if (v && YOUTUBE_ID.test(v)) return v;
    return YOUTUBE_PATH.exec(url.pathname)?.[1] ?? null;
  }
  return null;
}

/** YouTube の動画 ID を取り出す（watch?v= / youtu.be / shorts / embed / live / 動画 ID 単体。スキームは省略可） */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (YOUTUBE_ID.test(s)) return s;
  if (!LOOKS_LIKE_URL.test(s)) return null;
  const url = toUrl(s);
  return url && youtubeIdFromUrl(url);
}

function niconicoId(host: string, path: string): string | null {
  if (host === 'nicovideo.jp') return NICONICO_WATCH.exec(path)?.[1] ?? null;
  if (host === 'nico.ms') return NICONICO_SHORT.exec(path)?.[1] ?? null;
  return null;
}

export function youtubeMedia(id: string): Media {
  return { kind: 'youtube', id, songleUrl: YOUTUBE_WATCH + id };
}

/**
 * 入力が対応メディアの URL なら Media を返す。URL の形でない・対応外なら null（= 検索キーワードとして扱う）。
 * ピアプロの版（日付）なし URL は Songle 側で最新版に解決される。
 */
export function parseMediaUrl(input: string): Media | null {
  const s = input.trim();
  if (!LOOKS_LIKE_URL.test(s)) return null;
  const url = toUrl(s);
  if (!url) return null;

  const youtubeId = youtubeIdFromUrl(url);
  if (youtubeId) return youtubeMedia(youtubeId);

  const host = url.hostname.replace(MEDIA_HOST_PREFIX, '');
  const path = url.pathname;
  const niconico = niconicoId(host, path);
  if (niconico) {
    return {
      kind: 'niconico',
      id: niconico,
      songleUrl: `www.nicovideo.jp/watch/${niconico}`,
    };
  }
  const soundcloud = host === 'soundcloud.com' && SOUNDCLOUD_TRACK.exec(path);
  if (soundcloud) {
    const id = `${soundcloud[1]}/${soundcloud[2]}`;
    return { kind: 'soundcloud', id, songleUrl: `soundcloud.com/${id}` };
  }
  const piapro = host === 'piapro.jp' && PIAPRO_TRACK.exec(path);
  if (piapro) {
    const id = piapro[2] ? `${piapro[1]}/${piapro[2]}` : piapro[1];
    return { kind: 'piapro', id, songleUrl: `piapro.jp/t/${id}` };
  }
  return null;
}
