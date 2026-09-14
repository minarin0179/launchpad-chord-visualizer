// =====================
// YouTube IFrame Player API ラッパー
// =====================

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

let _apiPromise = null;

function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  _apiPromise ??= new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return _apiPromise;
}

// watch?v= / youtu.be / shorts / embed / 動画ID単体 に対応
export function parseVideoId(input) {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s);
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1, 12);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = url.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch { /* URL として解釈できない */ }
  return null;
}

export async function createPlayer(elementId, videoId, { onStateChange } = {}) {
  const YT = await loadYouTubeAPI();
  return new Promise((resolve) => {
    const player = new YT.Player(elementId, {
      videoId,
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: () => resolve(player),
        onStateChange,
      },
    });
  });
}

// getCurrentTime() は更新間隔が粗いので、再生中は performance.now() で補間する
export class PlaybackClock {
  constructor(player) {
    this.player = player;
    this.raw = -1;
    this.base = 0;
    this.basePerf = 0;
  }

  now() {
    const p = this.player;
    const raw = p.getCurrentTime();
    const perf = performance.now();
    if (p.getPlayerState() !== YT_STATE.PLAYING || raw !== this.raw) {
      this.raw = raw;
      this.base = raw;
      this.basePerf = perf;
      return raw;
    }
    return this.base + (perf - this.basePerf) / 1000 * p.getPlaybackRate();
  }
}
