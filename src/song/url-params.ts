import { parseMediaUrl, youtubeMedia } from './media-url';
import { mediaPageUrl, type Media } from './types';

/** YouTube は `?v=<動画 ID>`、それ以外は `?url=<URL>` */
const YOUTUBE_PARAM = 'v';
const URL_PARAM = 'url';

/** URL パラメータで指定された曲（起動時に自動で読み込む）。無ければ null */
export function mediaFromLocation(search: string): Media | null {
  const params = new URLSearchParams(search);
  const url = params.get(URL_PARAM);
  if (url) return parseMediaUrl(url);
  const videoId = params.get(YOUTUBE_PARAM);
  return videoId ? parseMediaUrl(mediaPageUrl(youtubeMedia(videoId))) : null;
}

/** 読み込んだ曲を URL パラメータに反映した検索文字列（"?v=…" の形。他のパラメータは残す） */
export function searchForMedia(search: string, media: Media): string {
  const params = new URLSearchParams(search);
  params.delete(YOUTUBE_PARAM);
  params.delete(URL_PARAM);
  if (media.kind === 'youtube') params.set(YOUTUBE_PARAM, media.id);
  else params.set(URL_PARAM, mediaPageUrl(media));
  return `?${params.toString()}`;
}
