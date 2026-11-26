/** 外部サービスの URL */

export const SONGLE_API = {
  /** 曲情報（ピアプロの版なし URL を最新版に解決してくれる） */
  song: 'https://api.songle.jp/api/v2/song.json',
  chord: 'https://widget.songle.jp/api/v1/song/chord.json',
  beat: 'https://widget.songle.jp/api/v1/song/beat.json',
  search: 'https://widget.songle.jp/api/v1/songs/search.json',
} as const;

export const SONGLE_SONG_PAGE = 'https://songle.jp/songs/';
export const SONGLE_WIDGET_SCRIPT = 'https://widget.songle.jp/v1/api.js';

export const SOUNDCLOUD_WIDGET_SCRIPT = 'https://w.soundcloud.com/player/api.js';
export const SOUNDCLOUD_PLAYER = 'https://w.soundcloud.com/player/';
export const SOUNDCLOUD_ORIGIN = 'https://soundcloud.com/';

export const YOUTUBE_IFRAME_API = 'https://www.youtube.com/iframe_api';
/** スキームなしの YouTube 動画 URL（Songle API に渡す形） */
export const YOUTUBE_WATCH = 'www.youtube.com/watch?v=';

export const ANALYZE_PAGE = 'analyze.html';
