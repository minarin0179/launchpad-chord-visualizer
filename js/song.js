// =====================
// Song バー — 曲の再生 + コード進行（Songle / 解析結果）をメイン画面と Launchpad に連動させる
//
// - 再生は js/song-media.js（YouTube / ニコニコ / ピアプロ = Songle 埋め込みプレイヤー、SoundCloud = Widget API）
// - URL 以外を入れると Songle をキーワード検索して候補を出す
// - FOLLOW 中は再生位置のコードを state.root / chordType / chordOverride に流し込む
// - カポは state.capo に一本化（曲のカポ = メイン画面のカポ。Launchpad はカポ後の形で光り、音は実音）
// - FOLLOW 中のスケールは曲のキー基準（state.scaleRoot）
// - 次のコードの 1 拍前から、その構成音を薄く点滅させて予告（state.preview）
// - 上段 CC 95-98: 再生/一時停止・1小節戻る・FOLLOW・A-B ループ
// =====================
import { CHORD_TYPES, CC_PLAY, CC_BACK, CC_FOLLOW, CC_LOOP,
         SONG_BTN_COLORS, SONG_PREVIEW_BLINK_MS, PRACTICE_LEAD_BEATS } from './constants.js';
import { state } from './state.js';
import { log } from './logger.js';
import { shiftCapo, setCapoListener, setExtraTopRowHandler, topRowEls } from './grid.js';
import { setTopRowColorProvider } from './led.js';
import { parseMediaUrl, mediaPageUrl, createMediaPlayer, MEDIA_LABELS } from './song-media.js';
import { fetchSongle, searchSongle } from './analyze/songle.js';
import { chordLabel, keyLabel, suggestCapo, CAPO_POSITIONS } from './chord-analyzer/capo.js';
import { decodeChords, findSegmentIndex } from './chord-analyzer/analyzer.js';
import { TOP_ROW_CCS } from '../packages/launchpad-x/dist/index.js';

const PX_PER_SEC = 50;
const PLAYHEAD_RATIO = 0.25;
const ANALYSIS_CACHE_PREFIX = 'chord-analyzer:v2:';  // analyze.html（js/analyze/page.js）の保存形式
const BAR_BEATS = 4;
const FALLBACK_BEAT_SEC = 0.5;

const $ = (id) => document.getElementById(id);
const mod12 = (n) => ((n % 12) + 12) % 12;

const song = {
  player: null,         // song-media.js のプレイヤー（{ getTime, isPlaying, play, pause, seek, destroy }）
  media: null,          // parseMediaUrl の結果
  loadSeq: 0,           // 読み込み中に別の曲を読み込んだら古い結果を捨てる
  sources: {},          // { songle?, analysis? } → { label, key, tempo, segments, timing, offset }
  sourceKey: null,
  capoAuto: true,
  internalCapo: false,  // Song 側からの shiftCapo 中は AUTO を解除しない
  activeIdx: -2,        // -2 = 未適用（次の tick で必ず適用）
  previewKey: '',
  previewTimer: null,
  loop: { a: null, b: null },
  blockEls: [],
  timelineWidth: 0,
  overviewDrag: null,   // シークバーをドラッグ中の時刻（秒、離したときにシーク）
  timeText: '',
};

let _onUpdate = () => {};  // main.js の updateAll（{ quiet } を受け取る）
let _onLEDs = () => {};    // LED だけ再送（予告の点滅・上段ボタンの色）

function current() {
  return song.sources[song.sourceKey] ?? null;
}

function capoPos() {
  return mod12(state.capo) % CAPO_POSITIONS;
}

function isPlaying() {
  return !!song.player?.isPlaying();
}

function songTime() {
  return song.player ? song.player.getTime() + (current()?.offset ?? 0) : 0;
}

// 曲プレイヤーの音量（左パネルの SONG スライダー、0〜100。localStorage に保存）
const SONG_VOLUME_KEY = 'launchpad-chord-visualizer:song-volume';

function songVolume() {
  return Number($('song-volume').value);
}

function initSongVolume() {
  const slider = $('song-volume');
  try {
    const saved = localStorage.getItem(SONG_VOLUME_KEY);
    if (saved !== null) slider.value = saved;
  } catch { /* localStorage 不可 */ }
  const apply = () => {
    $('song-volume-label').textContent = `${slider.value}%`;
    song.player?.setVolume(songVolume());
  };
  slider.oninput = () => {
    apply();
    try { localStorage.setItem(SONG_VOLUME_KEY, slider.value); } catch { /* localStorage 不可 */ }
  };
  apply();
}

function beatSec() {
  const tempo = current()?.tempo;
  return tempo > 0 ? 60 / tempo : FALLBACK_BEAT_SEC;
}

function setStatus(text, kind = '') {
  const el = $('song-status');
  el.textContent = text;
  el.className = `song-status ${kind}`;
}

function formatSec(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec - m * 60)).padStart(2, '0')}`;
}

// =====================
// Loading
// =====================
function loadAnalysisCache(videoId) {
  let cached;
  try { cached = JSON.parse(localStorage.getItem(ANALYSIS_CACHE_PREFIX + videoId)); } catch { return null; }
  if (!cached?.features) return null;
  let decoded;
  try { decoded = decodeChords(cached.features); } catch { return null; }
  const { key, tempo, segments } = decoded;
  return {
    label: `Analysis (${cached.source === 'scan' ? 'tab scan' : 'audio file'})`,
    key, tempo, segments,
    timing: { duration: cached.features.duration, bounds: cached.features.bounds },
    offset: (cached.offsetMs ?? 0) / 1000,
    preferred: cached.useSongle === false,
  };
}

async function loadSong() {
  const input = $('song-url').value.trim();
  if (!input) return;
  const media = parseMediaUrl(input);
  if (!media) { searchSongs(input); return; }
  hideResults();
  $('song-url').value = mediaPageUrl(media);

  const seq = ++song.loadSeq;
  song.media = media;
  song.sources = {};
  song.sourceKey = null;
  song.loop = { a: null, b: null };
  setFollow(false, { update: false });
  song.player?.destroy();
  song.player = null;
  $('song-player').replaceChildren();

  const params = new URLSearchParams(location.search);
  params.delete('v');
  params.delete('url');
  if (media.kind === 'youtube') params.set('v', media.id);
  else params.set('url', mediaPageUrl(media));
  history.replaceState(null, '', `?${params}`);
  // 解析ページは YouTube 専用
  $('song-analyze-link').hidden = media.kind !== 'youtube';
  $('song-analyze-link').href = media.kind === 'youtube' ? `analyze.html?v=${media.id}` : 'analyze.html';
  $('song-body').hidden = false;
  $('song-bar').classList.remove('collapsed');

  setStatus('Fetching chords…', 'busy');
  let songle = null;
  try {
    songle = await fetchSongle(media.songleUrl);
  } catch (e) {
    log(`Songle fetch failed: ${e.message}`, 'err');
  }
  if (seq !== song.loadSeq) return;  // 取得中に別の曲を読み込んだ

  if (!songle) {
    renderSourceSelect();
    renderAll();
    setStatus(`Songle に登録されていない曲です（${MEDIA_LABELS[media.kind]}）`, 'error');
    return;
  }
  const by = ` — ${songle.song.title} / ${songle.song.artist.name || '?'}`;
  song.sources.songle = { ...songle, label: `Songle${by}`, offset: 0 };
  const analysis = media.kind === 'youtube' ? loadAnalysisCache(media.id) : null;
  if (analysis) song.sources.analysis = analysis;
  renderSourceSelect();
  selectSource(analysis?.preferred ? 'analysis' : 'songle');

  try {
    const player = await createMediaPlayer($('song-player'), media, { onStateChange: onPlayerState, volume: songVolume() });
    if (seq !== song.loadSeq) { player.destroy(); return; }
    song.player = player;
    song.activeIdx = -2;
  } catch (e) {
    if (seq !== song.loadSeq) return;
    setStatus(`Player error: ${e.message}`, 'error');
    log(`Song player failed: ${e.message}`, 'err');
  }
  refreshLEDs();
}

// =====================
// Songle 検索（URL 以外が入力されたとき）
// =====================
async function searchSongs(query) {
  const seq = ++song.loadSeq;
  setStatus(`Searching Songle for "${query}"…`, 'busy');
  let results;
  try {
    results = await searchSongle(query);
  } catch (e) {
    setStatus(`Search failed: ${e.message}`, 'error');
    return;
  }
  if (seq !== song.loadSeq) return;
  const list = $('song-results');
  list.replaceChildren();
  const playable = results.map(r => ({ ...r, media: parseMediaUrl(r.permalink) })).filter(r => r.media);
  if (!playable.length) {
    hideResults();
    setStatus(`No songs found on Songle for "${query}"`, 'error');
    return;
  }
  for (const r of playable) {
    const li = document.createElement('li');
    const kind = document.createElement('span');
    kind.className = `song-result-kind ${r.media.kind}`;
    kind.textContent = MEDIA_LABELS[r.media.kind];
    const title = document.createElement('span');
    title.className = 'song-result-title';
    title.textContent = r.title;
    const meta = document.createElement('span');
    meta.className = 'song-result-meta';
    meta.textContent = `${r.artist} · ${formatSec(r.duration)}`;
    li.append(kind, title, meta);
    li.onclick = () => {
      $('song-url').value = mediaPageUrl(r.media);
      loadSong();
    };
    list.appendChild(li);
  }
  list.hidden = false;
  setStatus(`${playable.length} songs found — pick one`, 'ok');
}

function hideResults() {
  $('song-results').hidden = true;
  $('song-results').replaceChildren();
}

function selectSource(key) {
  song.sourceKey = key;
  const src = current();
  if (song.capoAuto) setSongCapo(suggestCapo(src.segments));
  setFollow(true, { update: false });
  renderAll();
  setStatus(`${src.label}`, 'ok');
  log(`Song: ${src.label} — ${src.segments.length} chords, key ${src.key.label}`, 'out');
  _onUpdate({ quiet: true });
}

// =====================
// Capo（state.capo に一本化）
// =====================
function setSongCapo(target) {
  song.internalCapo = true;
  shiftCapo(target - state.capo);
  song.internalCapo = false;
}

function onCapoChanged() {
  if (!song.internalCapo) song.capoAuto = false;
  // shiftCapo は state.root もずらすので、FOLLOW 中は実音のコードを適用し直す
  if (state.follow) song.activeIdx = -2;
  renderAll();
}

// =====================
// FOLLOW
// =====================
function setFollow(on, { update = true } = {}) {
  const src = current();
  if (on && !src) on = false;
  state.follow = on;
  if (on) {
    state.scaleRoot = src.key.root;
    state.scale = src.key.mode === 'minor' ? 'minor' : 'major';
    song.activeIdx = -2;
  } else {
    state.chordOverride = null;
    state.scaleRoot = null;
    state.practice = false;  // 練習モードは FOLLOW 前提
    setPreview(null);
  }
  $('song-follow').classList.toggle('active', on);
  $('song-practice').classList.toggle('active', state.practice);
  if (update) _onUpdate({ quiet: true });
}

// 練習モード: 弾くコードだけを光らせる（光る電子ピアノ風）。ON で FOLLOW も ON
function setPractice(on) {
  if (on && !current()) return;
  state.practice = on;
  if (on) setPreview(null);
  if (on && !state.follow) setFollow(true, { update: false });
  song.activeIdx = -2;
  $('song-practice').classList.toggle('active', on);
  log(`Song: practice ${on ? 'ON' : 'OFF'}`, 'out');
  _onUpdate({ quiet: true });
}

// 手動でコードを選んだら FOLLOW を一時停止（main.js から呼ぶ。updateAll は呼び出し元が行う）
export function pauseFollow() {
  if (!state.follow) return;
  setFollow(false, { update: false });
  log('Song: FOLLOW paused (manual chord change)', 'out');
}

function applySegment(seg) {
  if (!seg || seg.root === null) {
    state.chordOverride = { none: true };
    return;
  }
  state.root = seg.root;
  state.chordType = seg.type;
  state.inversion = 0;
  state.chordOverride = { intervals: seg.intervals, symbol: seg.symbol, bassPC: seg.bass ?? null };
}

// =====================
// 次のコードの予告
// =====================
function setPreview(seg) {
  const key = seg ? seg.label : '';
  if (key === song.previewKey) return false;
  song.previewKey = key;
  clearInterval(song.previewTimer);
  song.previewTimer = null;
  state.previewLit = true;
  if (!seg) {
    state.preview = null;
    return true;
  }
  const intervals = seg.intervals ?? CHORD_TYPES[seg.type].intervals;
  const pcs = intervals.map(iv => (seg.root + iv) % 12);
  if (seg.bass != null) pcs.push(seg.bass);
  state.preview = { rootPC: seg.root, pcs };
  song.previewTimer = setInterval(() => {
    state.previewLit = !state.previewLit;
    _onLEDs();
  }, SONG_PREVIEW_BLINK_MS);
  return true;
}

// =====================
// Transport / Launchpad 上段 CC 95-98
// =====================
function seekTo(t) {
  if (!song.player) return;
  song.player.seek(Math.max(0, t - (current()?.offset ?? 0)));
}

function togglePlay() {
  if (!song.player) return;
  if (isPlaying()) song.player.pause();
  else song.player.play();
}

function backOneBar() {
  if (!song.player) return;
  seekTo(songTime() - BAR_BEATS * beatSec());
}

function cycleLoop() {
  if (!current()) return;
  const t = songTime();
  const { loop } = song;
  if (loop.a === null) loop.a = t;
  else if (loop.b === null && t > loop.a + beatSec()) loop.b = t;
  else { loop.a = null; loop.b = null; }
  log(`Song: loop ${loop.a === null ? 'off' : loop.b === null ? `A=${formatSec(loop.a)}` : `${formatSec(loop.a)}–${formatSec(loop.b)}`}`, 'out');
  renderLoop();
  refreshLEDs();
}

function handleTopRow(cc) {
  switch (cc) {
    case CC_PLAY:   togglePlay(); break;
    case CC_BACK:   backOneBar(); break;
    case CC_FOLLOW: setFollow(!state.follow); break;
    case CC_LOOP:   cycleLoop(); break;
  }
}

function topRowColor(index) {
  if (!song.player) return null;
  switch (TOP_ROW_CCS[index]) {
    case CC_PLAY:   return isPlaying() ? SONG_BTN_COLORS.playing : SONG_BTN_COLORS.paused;
    case CC_BACK:   return SONG_BTN_COLORS.back;
    case CC_FOLLOW: return state.follow ? SONG_BTN_COLORS.follow : SONG_BTN_COLORS.idle;
    case CC_LOOP:   return song.loop.b !== null ? SONG_BTN_COLORS.loopOn
                         : song.loop.a !== null ? SONG_BTN_COLORS.loopA : SONG_BTN_COLORS.idle;
  }
  return null;
}

// 画面の上段ボタンにも同じ状態を反映し、LED を再送
function refreshLEDs() {
  topRowEls.forEach((el, i) => {
    if (i < 4 || !el) return;
    const c = topRowColor(i);
    const lit = c && c !== SONG_BTN_COLORS.idle;
    el.classList.toggle('song-lit', !!lit);
    el.style.setProperty('--song-btn', lit ? `rgb(${c.map(v => v * 2).join(',')})` : '');
  });
  $('song-play').textContent = $('song-ov-play').textContent = isPlaying() ? '❚❚' : '▶';
  _onLEDs();
}

function onPlayerState() {
  refreshLEDs();
}

// =====================
// Rendering
// =====================
function renderSourceSelect() {
  const sel = $('song-source');
  const entries = Object.entries(song.sources);
  sel.replaceChildren(...entries.map(([k, s]) => new Option(s.label, k)));
  sel.disabled = entries.length < 2;
}

function renderAll() {
  const src = current();
  $('song-source').value = song.sourceKey ?? '';
  const capo = capoPos();
  $('song-capo').textContent = String(capo);
  $('song-capo-auto').classList.toggle('active', song.capoAuto);
  $('song-key').textContent = !src ? '—'
    : capo === 0 ? src.key.label : `${src.key.label} → ${keyLabel(src.key, capo)} shapes`;
  $('song-tempo').textContent = src?.tempo ? `${Math.round(src.tempo)} BPM` : '—';
  $('song-follow').disabled = !src;
  $('song-practice').disabled = !src;
  renderTimeline();
  renderLoop();
  song.activeIdx = -2;
  refreshLEDs();
}

function renderTimeline() {
  const src = current();
  const blocks = $('song-blocks');
  blocks.replaceChildren();
  song.blockEls = [];
  $('song-strip').style.width = src ? `${src.timing.duration * PX_PER_SEC}px` : '0';
  const overview = $('song-overview-blocks');
  overview.replaceChildren();
  if (!src) return;
  const pct = (sec) => `${(sec / src.timing.duration) * 100}%`;
  const capo = capoPos();
  for (const seg of src.segments) {
    const el = document.createElement('div');
    el.className = 'song-block' + (seg.root === null ? ' nc' : '');
    el.style.left = `${seg.start * PX_PER_SEC}px`;
    el.style.width = `${(seg.end - seg.start) * PX_PER_SEC}px`;
    const hue = String(mod12((seg.root ?? 0) - capo) * 30);
    el.style.setProperty('--hue', hue);
    el.textContent = chordLabel(seg, capo);
    blocks.appendChild(el);
    song.blockEls.push(el);

    const ov = document.createElement('div');
    ov.className = 'song-ov-block' + (seg.root === null ? ' nc' : '');
    ov.style.left = pct(seg.start);
    ov.style.width = pct(seg.end - seg.start);
    ov.style.setProperty('--hue', hue);
    ov.title = `${chordLabel(seg, capo)}  ${formatSec(seg.start)}`;
    overview.appendChild(ov);
  }
}

function renderLoop() {
  const el = $('song-loop');
  const ov = $('song-overview-loop');
  const { a, b } = song.loop;
  $('song-loop-btn').classList.toggle('active', a !== null);
  $('song-loop-btn').textContent = b !== null ? 'A-B ✕' : a !== null ? 'A-B: set B' : 'A-B';
  el.hidden = a === null;
  ov.hidden = a === null || !current();
  if (a === null) return;
  el.style.left = `${a * PX_PER_SEC}px`;
  el.style.width = b === null ? '2px' : `${(b - a) * PX_PER_SEC}px`;
  el.classList.toggle('open', b === null);
  if (!current()) return;
  const dur = current().timing.duration;
  ov.style.left = `${(a / dur) * 100}%`;
  ov.style.width = b === null ? '2px' : `${((b - a) / dur) * 100}%`;
  ov.classList.toggle('open', b === null);
}

function renderNow(segments, idx, t) {
  const capo = capoPos();
  const seg = segments[idx];
  $('song-now').textContent = seg ? chordLabel(seg, capo) : '—';
  $('song-now-real').textContent = seg && seg.root !== null && capo !== 0 ? `sounds ${seg.label}` : '';
  const next = segments.slice(idx + 1).find(s => s.root !== null);
  $('song-next').textContent = next ? chordLabel(next, capo) : '—';
  $('song-next-in').textContent = next ? `in ${Math.max(0, next.start - t).toFixed(1)}s` : '';
}

// 曲全体のシークバー: 再生位置と時刻表示
function renderOverviewHead(src, t) {
  const dur = src.timing.duration;
  const clamped = Math.min(Math.max(t, 0), dur);
  $('song-overview-head').style.left = `${(clamped / dur) * 100}%`;
  const text = `${formatSec(clamped)} / ${formatSec(dur)}`;
  if (text !== song.timeText) {
    song.timeText = text;
    $('song-time').textContent = text;
  }
}

// クリック / ドラッグでシーク（ドラッグ中は位置だけ動かし、離したときにシーク）
function initOverviewSeek() {
  const bar = $('song-overview');
  const timeAt = (e) => {
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    return ratio * current().timing.duration;
  };
  bar.onpointerdown = (e) => {
    if (!song.player || !current()) return;
    bar.setPointerCapture(e.pointerId);
    song.overviewDrag = timeAt(e);
  };
  bar.onpointermove = (e) => {
    if (song.overviewDrag !== null) song.overviewDrag = timeAt(e);
  };
  const finish = (e, commit) => {
    if (song.overviewDrag === null) return;
    const t = commit ? timeAt(e) : null;
    song.overviewDrag = null;
    if (t !== null) seekTo(t);
  };
  bar.onpointerup = (e) => finish(e, true);
  bar.onpointercancel = (e) => finish(e, false);
}

// =====================
// Tick
// =====================
function tick() {
  requestAnimationFrame(tick);
  const src = current();
  if (!src || !song.player) return;
  let t = songTime();

  const { a, b } = song.loop;
  if (a !== null && b !== null && isPlaying() && t >= b) {
    seekTo(a);
    t = a;
  }

  $('song-strip').style.transform = `translateX(${song.timelineWidth * PLAYHEAD_RATIO - t * PX_PER_SEC}px)`;
  renderOverviewHead(src, song.overviewDrag ?? t);

  const { segments } = src;
  // 練習モードは少し先のコードを光らせて、切り替わりに手が間に合うようにする
  const idx = findSegmentIndex(segments, state.practice ? t + PRACTICE_LEAD_BEATS * beatSec() : t);
  let changed = false;
  if (idx !== song.activeIdx) {
    song.blockEls[song.activeIdx]?.classList.remove('active');
    song.blockEls[idx]?.classList.add('active');
    song.activeIdx = idx;
    if (state.follow) { applySegment(segments[idx]); changed = true; }
  }
  renderNow(segments, idx, t);

  // 次のコードが 1 拍以内に来るなら予告（再生中のみ）
  const next = segments[idx + 1];
  const until = next ? next.start - t : Infinity;
  const showPreview = state.follow && !state.practice && isPlaying() && next?.root != null
    && until > 0 && until <= beatSec() && next.label !== segments[idx]?.label;
  if (setPreview(showPreview ? next : null)) changed = true;

  if (changed) _onUpdate({ quiet: true });
}

// =====================
// Init
// =====================
export function initSong({ onUpdate, onLEDs }) {
  _onUpdate = onUpdate;
  _onLEDs = onLEDs;
  setCapoListener(onCapoChanged);
  setExtraTopRowHandler(handleTopRow);
  setTopRowColorProvider(topRowColor);

  initSongVolume();
  initOverviewSeek();
  $('song-load').onclick = loadSong;
  $('song-url').onkeydown = (e) => { if (e.key === 'Enter') loadSong(); };
  $('song-source').onchange = (e) => selectSource(e.target.value);
  $('song-follow').onclick = () => setFollow(!state.follow);
  $('song-practice').onclick = () => setPractice(!state.practice);
  $('song-play').onclick = togglePlay;
  $('song-ov-play').onclick = togglePlay;
  $('song-back').onclick = backOneBar;
  $('song-loop-btn').onclick = cycleLoop;
  $('song-capo-down').onclick = () => shiftCapo(-1);
  $('song-capo-up').onclick = () => shiftCapo(+1);
  $('song-capo-auto').onclick = () => {
    const src = current();
    song.capoAuto = true;
    if (src) setSongCapo(suggestCapo(src.segments));
    renderAll();
  };
  $('song-collapse').onclick = () => {
    const collapsed = $('song-bar').classList.toggle('collapsed');
    $('song-collapse').textContent = collapsed ? '▸' : '▾';
  };
  $('song-timeline').onclick = (e) => {
    if (!song.player || !current()) return;
    const rect = $('song-timeline').getBoundingClientRect();
    seekTo(songTime() + (e.clientX - rect.left - rect.width * PLAYHEAD_RATIO) / PX_PER_SEC);
  };
  new ResizeObserver(() => { song.timelineWidth = $('song-timeline').clientWidth; }).observe($('song-timeline'));

  // ?v=<YouTube の動画ID> / ?url=<ニコニコ・SoundCloud・ピアプロの URL> で自動読み込み
  const params = new URLSearchParams(location.search);
  const initial = params.get('url') ?? (params.get('v') && `https://www.youtube.com/watch?v=${params.get('v')}`);
  if (initial) {
    $('song-url').value = initial;
    loadSong();
  }
  requestAnimationFrame(tick);
}
