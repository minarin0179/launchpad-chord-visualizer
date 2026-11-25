// =====================
// Song バーの再生メディア
//   YouTube / ニコニコ動画 / ピアプロ → Songle の埋め込みプレイヤー（Songle Widget API）
//   SoundCloud → SoundCloud Widget API（Songle 経由の音源 URL は SoundCloud の廃止 API を指していて再生できない）
// どちらも同じインターフェースのプレイヤーにする:
//   { kind, getTime() 秒, isPlaying(), play(), pause(), seek(秒), destroy() }
// =====================
import { parseVideoId } from './analyze/youtube.js';

export const MEDIA_LABELS = { youtube: 'YouTube', niconico: 'ニコニコ', soundcloud: 'SoundCloud', piapro: 'ピアプロ' };

// 入力 URL → { kind, id, songleUrl }。URL でない・対応外なら null
// songleUrl は Songle API に渡す形（スキームなし）。ピアプロの版（日付）なし URL は Songle 側で最新版に解決される
export function parseMediaUrl(input) {
  const s = input.trim();
  // URL の形をしていなければ検索キーワード扱い（11 文字の単語を YouTube の動画ID と誤認しないように）
  if (!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+\//i.test(s)) return null;
  const ytId = parseVideoId(s);
  if (ytId) return { kind: 'youtube', id: ytId, songleUrl: `www.youtube.com/watch?v=${ytId}` };
  let url;
  try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = url.hostname.replace(/^(www|sp|m|embed)\./, '');
  const path = url.pathname;
  let m;
  if ((host === 'nicovideo.jp' && (m = path.match(/^\/watch\/((?:sm|nm|so)?\d+)/)))
      || (host === 'nico.ms' && (m = path.match(/^\/((?:sm|nm|so)\d+)/)))) {
    return { kind: 'niconico', id: m[1], songleUrl: `www.nicovideo.jp/watch/${m[1]}` };
  }
  if (host === 'soundcloud.com' && (m = path.match(/^\/([\w-]+)\/([\w-]+)\/?$/))) {
    const id = `${m[1]}/${m[2]}`;
    return { kind: 'soundcloud', id, songleUrl: `soundcloud.com/${id}` };
  }
  if (host === 'piapro.jp' && (m = path.match(/^\/t\/([\w-]+)(?:\/(\d{14}))?/))) {
    const id = m[2] ? `${m[1]}/${m[2]}` : m[1];
    return { kind: 'piapro', id, songleUrl: `piapro.jp/t/${id}` };
  }
  return null;
}

// 入力欄・URL パラメータに使う正規の URL
export function mediaPageUrl(media) {
  return media.kind === 'youtube' ? `https://www.youtube.com/watch?v=${media.id}` : `https://${media.songleUrl}`;
}

const _scripts = {};
function loadScript(src) {
  _scripts[src] ??= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => { delete _scripts[src]; reject(new Error(`Failed to load ${src}`)); };
    document.head.appendChild(el);
  });
  return _scripts[src];
}

// ---------- Songle Widget（YouTube / ニコニコ / ピアプロ） ----------
// createSongleWidgetElement は widgets.js の <script> と div#songle-widget を返し、widgets.js がロード時にそれを埋め込みプレイヤーにする。
// position は Songle 側で補間済み（ms）
let _songleSeq = 0;

async function createSongle(container, media, { onStateChange }) {
  await loadScript('https://widget.songle.jp/v1/api.js');
  const width = Math.max(200, Math.round(container.clientWidth || 480));
  const api = `launchpad-song-${++_songleSeq}`;
  return new Promise((resolve, reject) => {
    const el = window.SongleWidgetAPI.createSongleWidgetElement({
      api,
      url: media.songleUrl,
      songAutoPlay: false,
      songAutoLoop: false,
      songleWidgetSizeW: width,
      videoPlayerSizeW: width,
      videoPlayerSizeH: Math.round(width * 9 / 16),
      onReady: (widget) => {
        ['play', 'pause', 'stop', 'finish', 'seek'].forEach(ev => widget.on(ev, () => onStateChange?.()));
        resolve({
          kind: media.kind,
          getTime: () => (widget.position?.milliseconds ?? 0) / 1000,
          isPlaying: () => !!widget.isPlaying,
          play: () => widget.play(),
          pause: () => widget.pause(),
          seek: (sec) => widget.seekTo(Math.round(Math.max(0, sec) * 1000)),
          destroy: () => { try { widget.remove(); } catch { /* 既に消えている */ } container.replaceChildren(); },
        });
      },
      onError: (widget) => reject(new Error(`Songle Widget error${widget?.status ? ` (${widget.status})` : ''}`)),
    });
    container.appendChild(el);
  });
}

// ---------- SoundCloud（Widget API） ----------
// PLAY_PROGRESS の報告は数百 ms ごとなので、最後の報告から performance.now() で補間する
async function createSoundCloud(container, media, { onStateChange }) {
  await loadScript('https://w.soundcloud.com/player/api.js');
  const iframe = document.createElement('iframe');
  iframe.allow = 'autoplay';
  iframe.className = 'song-sc-player';
  iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(`https://soundcloud.com/${media.id}`)}&visual=true&auto_play=false&show_comments=false`;
  container.appendChild(iframe);

  const { SC } = window;
  const E = SC.Widget.Events;
  const widget = SC.Widget(iframe);
  let playing = false;
  let reported = 0;
  let reportedAt = 0;
  const report = (ms) => { reported = ms / 1000; reportedAt = performance.now(); };
  const now = () => (playing ? reported + (performance.now() - reportedAt) / 1000 : reported);
  const setPlaying = (p) => { report(now() * 1000); playing = p; onStateChange?.(); };

  widget.bind(E.PLAY, () => setPlaying(true));
  widget.bind(E.PAUSE, () => setPlaying(false));
  widget.bind(E.FINISH, () => setPlaying(false));
  widget.bind(E.PLAY_PROGRESS, (e) => report(e.currentPosition));
  widget.bind(E.SEEK, (e) => report(e.currentPosition));
  await new Promise((resolve) => widget.bind(E.READY, resolve));

  return {
    kind: 'soundcloud',
    getTime: now,
    isPlaying: () => playing,
    play: () => widget.play(),
    pause: () => widget.pause(),
    seek: (sec) => { const ms = Math.round(Math.max(0, sec) * 1000); report(ms); widget.seekTo(ms); },
    destroy: () => { Object.values(E).forEach(ev => widget.unbind(ev)); container.replaceChildren(); },
  };
}

// ---------- 再生時刻の平滑化 ----------
// Songle の position は「最後に届いた元プレイヤーの再生位置 + 届いてからの経過時間」で、新しい報告が届くたびに
// 数十 ms 前後に跳ぶ（タイムラインが境界でカクつく）。そこで表示用の時刻は自前で一定速度に進め、
// 元の時刻とのずれは時間をかけて平均し、進む速さを最大 ±5% だけ変えて追いつく（速度の揺れが目に見えないように）。
// シーク・ループ等の大きな跳びはそのまま反映する。
// ?clockdebug を付けて開くと、元の時刻が逆戻りした量をコンソールに出す
const SNAP_SEC = 0.3;        // これ以上ずれたら追従せず即座に合わせる
const ERR_FILTER_SEC = 0.5;  // ずれを平均する時定数（報告ごとのばらつきを均す）
const CATCHUP_SEC = 1.0;     // 平均したずれをこの時間で詰める速さにする
const MAX_RATE_DEV = 0.05;   // 速さの補正は ±5% まで
const CLOCK_DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('clockdebug');

function smoothTime(player) {
  const rawTime = player.getTime;
  let t = null;
  let perf = 0;
  let rate = 1;
  let errAvg = 0;
  let lastRaw = null;
  player.getTime = () => {
    const raw = rawTime();
    const p = performance.now();
    const playing = player.isPlaying();
    if (CLOCK_DEBUG && lastRaw !== null && playing && raw < lastRaw - 0.005) {
      console.log(`[clock] ${player.kind}: raw time went back ${((lastRaw - raw) * 1000).toFixed(0)} ms (${lastRaw.toFixed(3)} → ${raw.toFixed(3)})`);
    }
    lastRaw = raw;
    const dt = Math.min((p - perf) / 1000, 0.1);
    perf = p;
    const predicted = t === null ? raw : t + dt * rate;
    if (t === null || !playing || Math.abs(raw - predicted) > SNAP_SEC) {
      t = raw;
      rate = 1;
      errAvg = 0;
      return t;
    }
    errAvg += (raw - predicted - errAvg) * Math.min(1, dt / ERR_FILTER_SEC);
    rate = 1 + Math.max(-MAX_RATE_DEV, Math.min(MAX_RATE_DEV, errAvg / CATCHUP_SEC));
    t = predicted;
    return t;
  };
  return player;
}

// container の中身を作り直してプレイヤーを生成
export async function createMediaPlayer(container, media, { onStateChange } = {}) {
  container.replaceChildren();
  const player = media.kind === 'soundcloud'
    ? await createSoundCloud(container, media, { onStateChange })
    : await createSongle(container, media, { onStateChange });
  return smoothTime(player);
}
