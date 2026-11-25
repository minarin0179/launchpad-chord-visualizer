// =====================
// Song バー — YouTube 再生 + コード進行（Songle / 解析結果）をメイン画面と Launchpad に連動させる
//
// - FOLLOW 中は再生位置のコードを state.root / chordType / chordOverride に流し込む
// - カポは state.capo に一本化（曲のカポ = メイン画面のカポ。Launchpad はカポ後の形で光り、音は実音）
// - FOLLOW 中のスケールは曲のキー基準（state.scaleRoot）
// - 次のコードの 1 拍前から、その構成音を薄く点滅させて予告（state.preview）
// - 上段 CC 95-98: 再生/一時停止・1小節戻る・FOLLOW・A-B ループ
// =====================
import { CHORD_TYPES, CC_PLAY, CC_BACK, CC_FOLLOW, CC_LOOP,
         SONG_BTN_COLORS, SONG_PREVIEW_BLINK_MS } from './constants.js';
import { state } from './state.js';
import { log } from './logger.js';
import { shiftCapo, setCapoListener, setExtraTopRowHandler, topRowEls } from './grid.js';
import { setTopRowColorProvider } from './led.js';
import { parseVideoId, createPlayer, PlaybackClock, YT_STATE } from './analyze/youtube.js';
import { fetchSongle } from './analyze/songle.js';
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
  player: null,
  clock: null,
  videoId: null,
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
  return song.player?.getPlayerState?.() === YT_STATE.PLAYING;
}

function songTime() {
  return song.clock ? song.clock.now() + (current()?.offset ?? 0) : 0;
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
  const id = parseVideoId($('song-url').value);
  if (!id) { setStatus('Invalid YouTube URL', 'error'); return; }
  song.videoId = id;
  song.sources = {};
  song.sourceKey = null;
  song.loop = { a: null, b: null };
  setFollow(false, { update: false });
  const params = new URLSearchParams(location.search);
  params.set('v', id);
  history.replaceState(null, '', `?${params}`);
  $('song-analyze-link').href = `analyze.html?v=${id}`;
  $('song-body').hidden = false;
  $('song-bar').classList.remove('collapsed');

  if (song.player) {
    song.player.cueVideoById(id);
  } else {
    setStatus('Loading player…', 'busy');
    song.player = await createPlayer('song-player', id, { onStateChange: onPlayerState });
    song.clock = new PlaybackClock(song.player);
  }

  setStatus('Fetching chords…', 'busy');
  const analysis = loadAnalysisCache(id);
  if (analysis) song.sources.analysis = analysis;
  try {
    const s = await fetchSongle(id);
    if (s) {
      const by = s.song ? ` — ${s.song.title} / ${s.song.artist?.name ?? '?'}` : '';
      song.sources.songle = { ...s, label: `Songle${by}`, offset: 0 };
    }
  } catch (e) {
    log(`Songle fetch failed: ${e.message}`, 'err');
  }
  if (id !== song.videoId) return;  // 取得中に別の動画を読み込んだ

  renderSourceSelect();
  const pick = analysis?.preferred || !song.sources.songle ? (analysis ? 'analysis' : null) : 'songle';
  if (!pick) {
    renderAll();
    setStatus('No chords: not on Songle and not analyzed yet — use ANALYZE ↗ to scan', 'error');
    refreshLEDs();
    return;
  }
  selectSource(pick);
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
    setPreview(null);
  }
  $('song-follow').classList.toggle('active', on);
  if (update) _onUpdate({ quiet: true });
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
  song.player.seekTo(Math.max(0, t - (current()?.offset ?? 0)), true);
}

function togglePlay() {
  if (!song.player) return;
  if (isPlaying()) song.player.pauseVideo();
  else song.player.playVideo();
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
  $('song-play').textContent = isPlaying() ? '❚❚' : '▶';
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
  if (!src) return;
  const capo = capoPos();
  for (const seg of src.segments) {
    const el = document.createElement('div');
    el.className = 'song-block' + (seg.root === null ? ' nc' : '');
    el.style.left = `${seg.start * PX_PER_SEC}px`;
    el.style.width = `${(seg.end - seg.start) * PX_PER_SEC}px`;
    el.style.setProperty('--hue', String(mod12((seg.root ?? 0) - capo) * 30));
    el.textContent = chordLabel(seg, capo);
    blocks.appendChild(el);
    song.blockEls.push(el);
  }
}

function renderLoop() {
  const el = $('song-loop');
  const { a, b } = song.loop;
  $('song-loop-btn').classList.toggle('active', a !== null);
  $('song-loop-btn').textContent = b !== null ? 'A-B ✕' : a !== null ? 'A-B: set B' : 'A-B';
  el.hidden = a === null;
  if (a === null) return;
  el.style.left = `${a * PX_PER_SEC}px`;
  el.style.width = b === null ? '2px' : `${(b - a) * PX_PER_SEC}px`;
  el.classList.toggle('open', b === null);
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

// =====================
// Tick
// =====================
function tick() {
  requestAnimationFrame(tick);
  const src = current();
  if (!src || !song.clock) return;
  let t = songTime();

  const { a, b } = song.loop;
  if (a !== null && b !== null && isPlaying() && t >= b) {
    seekTo(a);
    t = a;
  }

  $('song-strip').style.transform = `translateX(${song.timelineWidth * PLAYHEAD_RATIO - t * PX_PER_SEC}px)`;

  const { segments } = src;
  const idx = findSegmentIndex(segments, t);
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
  const showPreview = state.follow && isPlaying() && next?.root != null
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

  $('song-load').onclick = loadSong;
  $('song-url').onkeydown = (e) => { if (e.key === 'Enter') loadSong(); };
  $('song-source').onchange = (e) => selectSource(e.target.value);
  $('song-follow').onclick = () => setFollow(!state.follow);
  $('song-play').onclick = togglePlay;
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
    if (!song.clock || !current()) return;
    const rect = $('song-timeline').getBoundingClientRect();
    seekTo(songTime() + (e.clientX - rect.left - rect.width * PLAYHEAD_RATIO) / PX_PER_SEC);
  };
  new ResizeObserver(() => { song.timelineWidth = $('song-timeline').clientWidth; }).observe($('song-timeline'));

  const initialId = new URLSearchParams(location.search).get('v');
  if (initialId) {
    $('song-url').value = `https://www.youtube.com/watch?v=${initialId}`;
    loadSong();
  }
  requestAnimationFrame(tick);
}
