// =====================
// Songle (https://songle.jp/) — 登録済み楽曲のコード進行・ビートを公開 API から取得
// API は CORS 許可（Access-Control-Allow-Origin: *）なのでブラウザから直接叩ける。
// 時刻は動画（YouTube）の再生時刻基準の ms。
// =====================
import { CHORD_TYPES } from '../constants.js';
import { keyFromProfile } from '../chord-analyzer/analyzer.js';

const API_BASE = 'https://widget.songle.jp/api/v1';

const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Songle のコード接尾辞 → CHORD_TYPES のキー
const SUFFIX_TO_TYPE = {
  '': 'maj', 'm': 'min', '7': '7', 'M7': 'maj7', 'maj7': 'maj7', 'm7': 'min7',
  'dim': 'dim', 'dim7': 'dim7', 'aug': 'aug', '+': 'aug', 'm7b5': 'm7b5', 'm7-5': 'm7b5',
  'sus2': 'sus2', 'sus4': 'sus4', 'sus': 'sus4', 'add9': 'add9', '9': '9', 'M9': 'maj9',
  'm9': 'min9', '6': '6', 'm6': 'min6',
};

// CHORD_TYPES に無いもの（表示は Songle の表記のまま、構成音だけ定義）
const EXTRA_INTERVALS = {
  'mM7': [0, 3, 7, 11],
  '7sus4': [0, 5, 7, 10],
  'aug7': [0, 4, 8, 10],
  '7b5': [0, 4, 6, 10],
};

function parsePitch(name) {
  const m = /^([A-G])([#b]?)$/.exec(name);
  if (!m) return null;
  return (PITCH[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

// "Eb" / "C#m7" / "Ebsus2/Ab" / "N" → analyzer のセグメントと同じ形（root, type, label）
// 分数コードは bass、CHORD_TYPES に無い型は symbol と intervals を追加で持つ
export function parseSongleChord(name) {
  if (!name || name === 'N') return { root: null, type: 'N', label: 'N.C.' };
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(name);
  const root = m && parsePitch(m[1]);
  if (root === null || root === undefined) return { root: null, type: 'N', label: name };

  const suffix = m[2];
  const bassPC = m[3] ? parsePitch(m[3]) : null;
  const chord = { root, label: name };
  if (bassPC !== null && bassPC !== root) chord.bass = bassPC;

  const type = SUFFIX_TO_TYPE[suffix];
  if (type) return { ...chord, type };
  // 未知の型: 先頭が m（M ではない）ならマイナー、それ以外はメジャーの三和音として扱う
  const minor = /^m(?!aj)/.test(suffix);
  return {
    ...chord,
    type: minor ? 'min' : 'maj',
    symbol: suffix,
    intervals: EXTRA_INTERVALS[suffix] ?? (minor ? [0, 3, 7] : [0, 4, 7]),
  };
}

const API_V2_SONG = 'https://api.songle.jp/api/v2/song.json';

// YouTube の動画ID（11 文字）はそのまま渡せるように URL 化する
function songleUrl(source) {
  return /^[\w-]{11}$/.test(source) ? `www.youtube.com/watch?v=${source}` : source;
}

async function getJSON(path, url) {
  const res = await fetch(`${API_BASE}/${path}?url=${encodeURIComponent(url)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Songle API ${res.status}`);
  return res.json();
}

// v2 の曲情報（CORS 可）。ピアプロの版なし URL（piapro.jp/t/XXXX）も最新版に解決してくれる。
// 未登録は null。{ title, artist, duration, permalink, code, url（Songle の曲ページ） }
export async function fetchSongleSong(source) {
  const res = await fetch(`${API_V2_SONG}?syntax=camelcase&url=${encodeURIComponent(songleUrl(source))}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Songle API ${res.status}`);
  const data = (await res.json())?.data;
  if (!data) return null;
  const a = data.attributes;
  return {
    title: a.name,
    artist: { name: data.relationships?.artist?.data?.attributes?.name ?? '' },
    duration: a.durationTimeMs,
    permalink: a.permalink,
    code: a.code,
    url: data.relationships?.uri?.data?.attributes?.permalink,
  };
}

// キーワード検索（曲名・アーティスト名）。[{ title, artist, permalink, duration }]
// API は最大 40 件を返し、該当なしは 404
export async function searchSongle(query) {
  const res = await fetch(`${API_BASE}/songs/search.json?q=${encodeURIComponent(query)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Songle API ${res.status}`);
  const list = await res.json();
  return (Array.isArray(list) ? list : []).map(s => ({
    title: s.title,
    artist: s.artist?.name ?? '',
    permalink: s.permalink,
    duration: s.duration / 1000,
  }));
}

// コード区間の構成音を時間で重み付けしたピッチクラス分布からキーを推定
function estimateKeyFromSegments(segments) {
  const profile = new Array(12).fill(0);
  for (const s of segments) {
    if (s.root === null) continue;
    const d = s.end - s.start;
    const intervals = s.intervals ?? CHORD_TYPES[s.type].intervals;
    for (const iv of intervals) profile[(s.root + iv) % 12] += d;
    if (s.bass != null) profile[s.bass] += d * 0.5;
  }
  return keyFromProfile(profile);
}

// source は YouTube の動画ID、または Songle が扱う URL（YouTube / ニコニコ / SoundCloud / ピアプロ）
// 未登録なら null。登録済みなら
// { song, pageUrl, key, tempo, segments, timing: { duration, bounds } }
export async function fetchSongle(source) {
  const song = await fetchSongleSong(source);
  if (!song) return null;
  const [chordData, beatData] = await Promise.all([
    getJSON('song/chord.json', song.permalink),
    getJSON('song/beat.json', song.permalink).catch(() => null),
  ]);
  const chords = chordData?.chords;
  if (!chords?.length) return null;

  const segments = chords.map(c => ({
    start: c.start / 1000,
    end: (c.start + c.duration) / 1000,
    ...parseSongleChord(c.name),
  }));
  // 同じコードが続く区間はまとめる（タイムラインが細切れにならないように）
  const merged = [];
  for (const s of segments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === s.label && Math.abs(prev.end - s.start) < 0.01) prev.end = s.end;
    else merged.push(s);
  }

  const beats = beatData?.beats ?? [];
  const duration = Math.max(song.duration ? song.duration / 1000 : 0, merged[merged.length - 1].end);
  const bpms = beats.map(b => b.bpm).filter(Boolean).sort((a, b) => a - b);

  return {
    song,
    pageUrl: song.url ?? `https://songle.jp/songs/${encodeURIComponent(song.permalink.replace(/^https?:\/\//, ''))}`,
    key: estimateKeyFromSegments(merged),
    tempo: bpms.length ? bpms[bpms.length >> 1] : 0,
    segments: merged,
    // analyzer の features.bounds と同じ形（先頭 0・末尾 duration はビートではない）
    timing: { duration, bounds: [0, ...beats.map(b => b.start / 1000), duration] },
  };
}
