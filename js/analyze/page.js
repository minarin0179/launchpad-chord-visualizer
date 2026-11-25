// =====================
// Chord Analyzer ページ — YouTube 再生と解析結果の同期表示
// =====================
import { decodeChords, remapTimes, findSegmentIndex } from '../chord-analyzer/analyzer.js';
import { parseVideoId, createPlayer, PlaybackClock, YT_STATE } from './youtube.js';
import { captureTabAudio } from './capture.js';
import { fetchSongle } from './songle.js';
import { chordLabel, keyLabel, scaleFitRatio, suggestCapo, CAPO_POSITIONS } from '../chord-analyzer/capo.js';

const PX_PER_SEC = 60;
const PLAYHEAD_RATIO = 0.25;
const CACHE_PREFIX = 'chord-analyzer:v2:';  // v2: 分離処理バリアント付きの特徴量
const ANCHOR_INTERVAL_MS = 200;
const CLICK_LOOKAHEAD_SEC = 0.12;  // rAF ごとにこの先までのビートクリックを AudioContext 上で予約
// Worker の各フェーズが全体進捗のどの範囲を占めるか
const PHASES = {
  resample:   [0, 0.08, 'リサンプル'],
  onset:      [0.08, 0.18, 'オンセット検出'],
  beats:      [0.18, 0.2, 'ビート追跡'],
  bass:       [0.2, 0.35, '低音クロマ抽出'],
  chroma:     [0.35, 0.65, 'クロマ抽出（ミッド）'],
  chromaSide: [0.65, 1, 'クロマ抽出（サイド）'],
};

const $ = (id) => document.getElementById(id);

const app = {
  player: null,
  clock: null,
  videoId: null,
  features: null,   // 動画時刻にマップ済みのビート同期特徴量
  result: null,     // decodeChords の結果
  source: null,     // features の出所 'scan' | 'file'
  songle: null,     // fetchSongle の結果（未取得 / 未登録なら null）
  useSongle: false, // true の間は解析結果ではなく Songle のコード進行を表示
  capo: 0,
  capoAuto: true,   // true の間は解析・再デコードのたびに最適なカポを自動選択
  stopScan: null,
  blockEls: [],
  chipEls: [],
  activeIdx: -1,
  timelineWidth: 0,
};

// ビートクリック（検出ビートと実際のドラムのずれを耳で確認する）
const beatClick = { ctx: null, next: -1, lastT: 0 };

// =====================
// Status / UI state
// =====================
function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `az-status ${kind}`;
}

function setProgress(ratio) {
  $('progress-bar').style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
}

function setBusy(busy, scanning = false) {
  $('load-btn').disabled = busy;
  $('songle-btn').disabled = busy || !app.videoId;
  $('scan-btn').disabled = busy || !app.player;
  $('file-input').disabled = busy;
  $('file-label').classList.toggle('disabled', busy);
  $('stop-btn').disabled = !scanning;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, '0')}`;
}

function waitFor(cond, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const id = setInterval(() => {
      if (cond()) { clearInterval(id); resolve(); }
      else if (performance.now() - t0 > timeoutMs) { clearInterval(id); reject(new Error('プレイヤーの応答がタイムアウトしました')); }
    }, 50);
  });
}

// =====================
// Cache (localStorage, videoId 単位)
// =====================
function saveCache() {
  if (!app.videoId || (!app.features && !app.useSongle)) return;
  try {
    localStorage.setItem(CACHE_PREFIX + app.videoId, JSON.stringify({
      features: app.features,
      source: app.source,
      useSongle: app.useSongle,
      offsetMs: Number($('opt-offset').value),
      capo: app.capo,
      capoAuto: app.capoAuto,
      savedAt: Date.now(),
    }));
  } catch { /* 容量超過などは無視 */ }
}

function loadCache(videoId) {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + videoId)); } catch { return null; }
}

// =====================
// Video
// =====================
async function loadVideo() {
  const id = parseVideoId($('yt-url').value);
  if (!id) { setStatus('YouTube の URL を認識できません', 'error'); return; }
  app.videoId = id;
  history.replaceState(null, '', `?v=${id}`);

  if (app.player) {
    app.player.cueVideoById(id);
  } else {
    setStatus('プレイヤーを読み込み中…', 'busy');
    app.player = await createPlayer('player', id, {
      onStateChange: (e) => { if (e.data === YT_STATE.ENDED) app.stopScan?.(); },
    });
    app.clock = new PlaybackClock(app.player);
  }
  populateScanRates();
  setBusy(false);

  const cached = loadCache(id);
  app.songle = null;
  app.features = cached?.features ?? null;
  app.source = cached?.source ?? null;
  app.useSongle = false;
  app.result = null;
  setOffset(cached?.offsetMs ?? 0);
  app.capo = cached?.capo ?? 0;
  app.capoAuto = cached?.capoAuto ?? true;

  // 解析済みでなければ Songle を先に試す（前回 Songle 表示だった場合も）
  if (!app.features || cached.useSongle) {
    renderResult();
    if (await loadSongle({ quiet: !!app.features })) return;
  }
  if (app.features) {
    redecode();
    setStatus(`保存済みの解析結果を読み込みました（${app.source === 'scan' ? 'タブスキャン' : '音声ファイル'}）`, 'ok');
  } else {
    renderResult();
    setStatus('Songle 未登録の動画です。SCAN でタブ音声を解析、または AUDIO FILE で音源ファイルを解析');
  }
}

// =====================
// Songle
// =====================

// Songle のコード進行に切り替える。取得できたら true
// quiet: 未登録・失敗時にステータスを上書きしない（呼び出し元が続けて別の表示をする場合）
async function loadSongle({ quiet = false } = {}) {
  const videoId = app.videoId;
  if (!videoId) return false;
  setBusy(true);
  setStatus('Songle からコード進行を取得中…', 'busy');
  try {
    app.songle ??= await fetchSongle(videoId);
  } catch (e) {
    if (!quiet) setStatus(`Songle から取得できません: ${e.message}`, 'error');
    return false;
  } finally {
    setBusy(false);
  }
  if (videoId !== app.videoId) return false;  // 取得中に別の動画を読み込んだ
  if (!app.songle) {
    if (!quiet) setStatus('この動画は Songle に登録されていません', 'error');
    return false;
  }
  app.useSongle = true;
  saveCache();
  redecode();
  const { song } = app.songle;
  setStatus(`Songle のコード進行を読み込みました${song ? `（${song.title} / ${song.artist?.name ?? '—'}）` : ''}`, 'ok');
  return true;
}

// =====================
// Tab scan
// =====================

// IFrame API が許可する再生速度（通常は最大 2x）から選択肢を作り、既定は最速にする
function populateScanRates() {
  const rates = app.player.getAvailablePlaybackRates().filter(r => r >= 1);
  if (rates.length === 0) return;
  const select = $('scan-rate');
  select.replaceChildren(...rates.map(r => new Option(`${r}x`, String(r))));
  select.value = String(Math.max(...rates));
}
async function startScan() {
  const { player } = app;
  const rate = Number($('scan-rate').value);
  if (!player.getAvailablePlaybackRates().includes(rate)) {
    setStatus(`この動画は ${rate}x 再生に対応していません`, 'error');
    return;
  }

  let capture;
  try {
    capture = await captureTabAudio({ onEnded: () => app.stopScan?.() });
  } catch (e) {
    setStatus(`タブ音声のキャプチャを開始できません: ${e.message}`, 'error');
    return;
  }

  setBusy(true, true);
  setProgress(0);
  const anchors = [];  // 録音フレーム ↔ 動画時刻 の対応点
  let timer = null;
  let failure = null;
  let stoppedByUser = false;

  try {
    setStatus('スキャン準備中…', 'busy');
    // 再生速度は読み込み済みの動画にしか効かないので、一度再生してから頭出しする
    player.playVideo();
    await waitFor(() => player.getPlayerState() === YT_STATE.PLAYING);
    player.pauseVideo();
    player.setPlaybackRate(rate);
    player.seekTo(0, true);
    await waitFor(() => player.getPlaybackRate() === rate);
    player.playVideo();
    await waitFor(() => player.getPlayerState() === YT_STATE.PLAYING);

    const duration = player.getDuration();
    setStatus(`スキャン中（${rate}x）… このタブを表示したままお待ちください`, 'busy');
    await new Promise((resolve) => {
      app.stopScan = resolve;
      $('stop-btn').onclick = () => { stoppedByUser = true; resolve(); };
      timer = setInterval(() => {
        if (player.getPlayerState() !== YT_STATE.PLAYING) return;
        const video = player.getCurrentTime();
        anchors.push({ frame: capture.currentFrame(), video });
        setProgress(video / duration);
        if (video >= duration - 0.3) resolve();
      }, ANCHOR_INTERVAL_MS);
    });
  } catch (e) {
    failure = e;
  } finally {
    clearInterval(timer);
    app.stopScan = null;
  }

  const recording = await capture.stop();
  player.pauseVideo();
  player.setPlaybackRate(1);
  player.seekTo(0, true);
  setBusy(false);

  if (failure) { setStatus(`スキャン失敗: ${failure.message}`, 'error'); return; }
  if (anchors.length < 10) { setStatus('録音が短すぎます', 'error'); return; }
  if (stoppedByUser) setStatus('途中で停止しました。録音済みの範囲を解析します', 'busy');

  const { sampleRate, baseFrame } = recording;
  const startFrame = anchors[0].frame;
  const endFrame = anchors[anchors.length - 1].frame + Math.round(sampleRate * ANCHOR_INTERVAL_MS / 1000);
  const channels = recording.channels.map(ch => ch.slice(
    Math.max(0, startFrame - baseFrame),
    Math.min(ch.length, endFrame - baseFrame),
  ));
  const timeMap = buildTimeMap(anchors, startFrame, sampleRate, rate);
  await analyze(channels, sampleRate, rate, timeMap, 'scan');
}

// 録音秒 → 動画秒。offset = video - rate * rec を中央値で平滑化し区分線形補間する
// （バッファリングで止まった区間もアンカー間で吸収される）
function buildTimeMap(anchors, startFrame, sampleRate, rate) {
  const rec = anchors.map(a => (a.frame - startFrame) / sampleRate);
  const raw = anchors.map((a, i) => a.video - rate * rec[i]);
  const offset = raw.map((_, i) => {
    const win = raw.slice(Math.max(0, i - 3), i + 4).sort((a, b) => a - b);
    return win[win.length >> 1];
  });
  return (t) => {
    if (t <= rec[0]) return rate * t + offset[0];
    for (let i = 1; i < rec.length; i++) {
      if (t <= rec[i]) {
        const r = (t - rec[i - 1]) / (rec[i] - rec[i - 1] || 1);
        return rate * t + offset[i - 1] + r * (offset[i] - offset[i - 1]);
      }
    }
    return rate * t + offset[offset.length - 1];
  };
}

// =====================
// Audio file
// =====================
async function analyzeFile(file) {
  setBusy(true);
  setStatus(`${file.name} をデコード中…`, 'busy');
  try {
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    await ctx.close();
    // Worker へ transfer するため AudioBuffer 内部のバッファではなくコピーを渡す
    const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) },
      (_, c) => buffer.getChannelData(c).slice());
    await analyze(channels, buffer.sampleRate, 1, t => t, 'file');
  } catch (e) {
    setStatus(`音声ファイルを解析できません: ${e.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

// =====================
// Analysis
// =====================
function extractInWorker(channels, sampleRate, timeScale) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../chord-analyzer/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        const [from, to, label] = PHASES[data.phase];
        setProgress(from + (to - from) * data.progress);
        setStatus(`解析中: ${label}…`, 'busy');
        return;
      }
      worker.terminate();
      if (data.type === 'features') resolve(data.features);
      else reject(new Error(data.message));
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message)); };
    worker.postMessage({ channels, sampleRate, options: { timeScale } }, channels.map(ch => ch.buffer));
  });
}

async function analyze(channels, sampleRate, timeScale, timeMap, source) {
  const t0 = performance.now();
  setProgress(0);
  try {
    const features = await extractInWorker(channels, sampleRate, timeScale);
    app.features = remapTimes(features, timeMap);
    app.source = source;
    app.useSongle = false;
    saveCache();
    redecode();
    setProgress(1);
    setStatus(`解析完了（${((performance.now() - t0) / 1000).toFixed(1)} 秒）`, 'ok');
  } catch (e) {
    setStatus(`解析エラー: ${e.message}`, 'error');
  }
}

function readDecodeOptions() {
  return {
    vocabulary: $('opt-vocab').value,
    selfTransition: Number($('opt-stay').value),
    bassWeight: Number($('opt-bass').value),
    centerCut: $('opt-center').checked,
    hpss: $('opt-hpss').checked,
    melody: $('opt-melody').checked,
  };
}

// タイムライン・ビート表示用の { duration, bounds }（Songle 表示中は Songle のビート）
function timing() {
  return app.useSongle ? app.songle?.timing : app.features;
}

function redecode() {
  if (app.useSongle && app.songle) {
    const { key, tempo, segments } = app.songle;
    app.result = { key, tempo, segments };
  } else if (app.features) {
    app.result = decodeChords(app.features, readDecodeOptions());
  } else {
    return;
  }
  if (app.capoAuto) app.capo = suggestCapo(app.result.segments);
  renderResult();
}

function setCapo(capo, auto) {
  app.capoAuto = auto;
  app.capo = auto && app.result
    ? suggestCapo(app.result.segments)
    : ((capo % CAPO_POSITIONS) + CAPO_POSITIONS) % CAPO_POSITIONS;  // 11 → 0、0 → 11 と一周する
  saveCache();
  renderResult();
}

function renderCapo() {
  const { result, capo } = app;
  $('capo-value').textContent = String(capo);
  $('capo-auto').classList.toggle('active', app.capoAuto);
  $('capo-hint').textContent = result?.segments.length
    ? `スケール内 ${Math.round(scaleFitRatio(result.segments, capo) * 100)}%`
    : '';
}

// =====================
// Rendering
// =====================
function renderResult() {
  const { result, features } = app;
  const tm = result ? timing() : null;
  const segments = result?.segments ?? [];
  app.activeIdx = -1;

  $('info-key').textContent = !result ? '—'
    : app.capo === 0 ? `${result.key.label}（${app.useSongle ? 'コードから推定' : `相関 ${result.key.confidence}`}）`
    : `${result.key.label} → Capo ${app.capo} で ${keyLabel(result.key, app.capo)}`;
  renderCapo();
  const jitter = tm && !app.useSongle ? beatJitterMs(tm.bounds) : null;
  $('info-tempo').textContent = !result || !result.tempo ? '—'
    : `${Math.round(result.tempo)} BPM` + (jitter !== null ? `（拍間隔のばらつき ±${jitter}ms）` : '');
  $('info-segments').textContent = result ? `${segments.filter(s => s.root !== null).length}` : '—';
  renderSource();
  $('songle-btn').classList.toggle('active', app.useSongle);
  $('copy-btn').disabled = !result;
  $('now-chord').textContent = '—';
  $('next-chord').textContent = '—';
  $('next-in').textContent = '';

  const blocks = $('blocks');
  const chart = $('chart');
  blocks.replaceChildren();
  chart.replaceChildren();
  app.blockEls = [];
  app.chipEls = [];
  $('timeline-strip').style.width = tm ? `${tm.duration * PX_PER_SEC}px` : '0';

  segments.forEach((seg) => {
    const label = chordLabel(seg, app.capo);
    const block = document.createElement('div');
    block.className = 'az-block' + (seg.root === null ? ' nc' : '');
    block.style.left = `${seg.start * PX_PER_SEC}px`;
    block.style.width = `${(seg.end - seg.start) * PX_PER_SEC}px`;
    block.style.setProperty('--hue', String((((seg.root ?? 0) - app.capo + 12) % 12) * 30));
    block.textContent = label;
    blocks.appendChild(block);
    app.blockEls.push(block);

    const chip = document.createElement('button');
    chip.className = 'az-chip' + (seg.root === null ? ' nc' : '');
    chip.innerHTML = `<time>${formatTime(seg.start)}</time>`;
    chip.append(label);
    chip.onclick = () => seekTo(seg.start);
    chart.appendChild(chip);
    app.chipEls.push(chip);
  });

  const centerCutUnavailable = features && !features.sideAvailable;
  $('opt-center').disabled = centerCutUnavailable;
  $('opt-center-note').textContent = centerCutUnavailable ? '無効（モノラル音源）' : 'ボーカル除去';

  drawChroma(app.useSongle ? null : features, result?.trebleKey);
  drawBeats(tm);
}

function renderSource() {
  const el = $('info-source');
  if (app.useSongle && app.songle) {
    const { song, pageUrl } = app.songle;
    const link = document.createElement('a');
    link.href = pageUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Songle';
    el.replaceChildren(link, song ? `（${song.title} / ${song.artist?.name ?? '—'}）` : '');
    return;
  }
  el.textContent = !app.result ? '—' : app.source === 'scan' ? 'タブスキャン' : app.source === 'file' ? '音声ファイル' : '—';
}

// 拍間隔の標準偏差（ms）。一定テンポの曲で大きければビート追跡か時刻対応が揺れている
function beatJitterMs(bounds) {
  const intervals = [];
  for (let i = 2; i < bounds.length - 1; i++) intervals.push(bounds[i] - bounds[i - 1]);
  if (intervals.length < 2) return null;
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  return Math.round(Math.sqrt(variance) * 1000);
}

function drawBeats(features) {
  const canvas = $('beat-canvas');
  if (!features) { canvas.width = 0; return; }
  const { bounds, duration } = features;
  const cssWidth = duration * PX_PER_SEC;
  canvas.width = Math.min(Math.ceil(cssWidth), 16000);
  canvas.height = 1;
  canvas.style.width = `${cssWidth}px`;
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / duration;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  for (let i = 1; i < bounds.length - 1; i++) ctx.fillRect(Math.floor(bounds[i] * scale), 0, 1, 1);
}

// 選択中の分離設定のクロマを描画（分離の効き具合を目視で確認できる）
function drawChroma(features, trebleKey) {
  const canvas = $('chroma-canvas');
  if (!features || !trebleKey) { canvas.width = 0; return; }
  const { bounds, duration } = features;
  const treble = features.treble[trebleKey];
  const cssWidth = duration * PX_PER_SEC;
  canvas.width = Math.min(Math.ceil(cssWidth), 16000);
  canvas.height = 12;
  canvas.style.width = `${cssWidth}px`;
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / duration;
  treble.forEach((c, i) => {
    const max = Math.max(...c) || 1;
    const x = bounds[i] * scale;
    const w = Math.max(1, (bounds[i + 1] - bounds[i]) * scale);
    for (let pc = 0; pc < 12; pc++) {
      ctx.fillStyle = `rgba(51, 221, 255, ${(c[pc] / max) ** 2})`;
      ctx.fillRect(x, 11 - pc, w, 1);
    }
  });
}

function offsetSec() {
  return Number($('opt-offset').value) / 1000;
}

function setOffset(ms) {
  $('opt-offset').value = ms;
  $('opt-offset-value').textContent = `${ms} ms`;
}

function seekTo(videoTime) {
  if (!app.player) return;
  app.player.seekTo(Math.max(0, videoTime - offsetSec()), true);
  app.player.playVideo();
}

// bounds[0] = 0 と末尾 = duration はビートではないので除外し、t 以降の最初のビート index を返す
function firstBeatAfter(bounds, t) {
  let lo = 1, hi = bounds.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bounds[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function scheduleBeatClicks(t) {
  const { ctx } = beatClick;
  if (!ctx || !$('opt-click').checked || app.player.getPlayerState() !== YT_STATE.PLAYING) {
    beatClick.next = -1;
    return;
  }
  const { bounds } = timing();
  // 初回・シーク（巻き戻し or 大きな前方ジャンプ）時は予約位置を取り直す
  if (beatClick.next < 0 || t < beatClick.lastT - 0.05 || t > beatClick.lastT + 1) {
    beatClick.next = firstBeatAfter(bounds, t);
  }
  beatClick.lastT = t;
  const rate = app.player.getPlaybackRate();
  while (beatClick.next < bounds.length - 1 && bounds[beatClick.next] < t + CLICK_LOOKAHEAD_SEC) {
    const when = ctx.currentTime + Math.max(0, (bounds[beatClick.next] - t) / rate);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1500;
    gain.gain.setValueAtTime(0.3, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.03);
    osc.connect(gain).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.04);
    beatClick.next++;
  }
}

function tick() {
  requestAnimationFrame(tick);
  const segments = app.result?.segments;
  if (!segments?.length || !app.clock) return;

  const t = app.clock.now() + offsetSec();
  scheduleBeatClicks(t);
  $('timeline-strip').style.transform = `translateX(${app.timelineWidth * PLAYHEAD_RATIO - t * PX_PER_SEC}px)`;

  const idx = findSegmentIndex(segments, t);
  if (idx !== app.activeIdx) {
    app.blockEls[app.activeIdx]?.classList.remove('active');
    app.chipEls[app.activeIdx]?.classList.remove('active');
    app.blockEls[idx]?.classList.add('active');
    app.chipEls[idx]?.classList.add('active');
    app.activeIdx = idx;
    $('now-chord').textContent = idx >= 0 ? chordLabel(segments[idx], app.capo) : '—';
  }

  const next = segments.slice(idx + 1).find(s => s.root !== null);
  $('next-chord').textContent = next ? chordLabel(next, app.capo) : '—';
  $('next-in').textContent = next ? `in ${(next.start - t).toFixed(1)}s` : '';
}

// =====================
// Events
// =====================
$('load-btn').onclick = loadVideo;
$('yt-url').onkeydown = (e) => { if (e.key === 'Enter') loadVideo(); };
$('scan-btn').onclick = startScan;
$('songle-btn').onclick = () => {
  // Songle 表示中に押したら解析結果に戻す（解析結果が無ければ再取得）
  if (app.useSongle && app.features) {
    app.useSongle = false;
    saveCache();
    redecode();
    setStatus(`解析結果を表示中（${app.source === 'scan' ? 'タブスキャン' : '音声ファイル'}）`, 'ok');
  } else {
    loadSongle();
  }
};
$('file-input').onchange = (e) => {
  const [file] = e.target.files;
  if (file) analyzeFile(file);
  e.target.value = '';
};

for (const id of ['opt-vocab', 'opt-stay', 'opt-bass', 'opt-center', 'opt-hpss', 'opt-melody']) {
  $(id).oninput = () => {
    $('opt-stay-value').textContent = Number($('opt-stay').value).toFixed(2);
    $('opt-bass-value').textContent = Number($('opt-bass').value).toFixed(2);
    // デコード設定は解析結果に対するものなので、Songle 表示中なら解析結果に戻す
    if (app.useSongle && app.features) { app.useSongle = false; saveCache(); }
    redecode();
  };
}
$('opt-offset').oninput = () => { setOffset(Number($('opt-offset').value)); };
$('opt-offset').onchange = saveCache;

$('opt-click').onchange = () => {
  // AudioContext はユーザー操作起点で作る必要がある
  if ($('opt-click').checked) {
    beatClick.ctx ??= new AudioContext();
    beatClick.ctx.resume();
  }
  beatClick.next = -1;
};

$('capo-down').onclick = () => setCapo(app.capo - 1, false);
$('capo-up').onclick   = () => setCapo(app.capo + 1, false);
$('capo-auto').onclick = () => setCapo(0, true);

$('timeline').onclick = (e) => {
  if (!app.clock) return;
  const rect = $('timeline').getBoundingClientRect();
  const t = app.clock.now() + offsetSec() + (e.clientX - rect.left - rect.width * PLAYHEAD_RATIO) / PX_PER_SEC;
  seekTo(t);
};

$('copy-btn').onclick = async () => {
  const { result, videoId } = app;
  const json = JSON.stringify({
    videoId,
    key: result.key.label,
    tempo: Math.round(result.tempo),
    capo: app.capo,
    segments: result.segments.map(s => ({ start: s.start, end: s.end, chord: s.label, shape: chordLabel(s, app.capo) })),
  });
  await navigator.clipboard.writeText(json);
  setStatus('解析結果の JSON をクリップボードにコピーしました', 'ok');
};

new ResizeObserver(() => { app.timelineWidth = $('timeline').clientWidth; }).observe($('timeline'));

const initialId = new URLSearchParams(location.search).get('v');
if (initialId) {
  $('yt-url').value = `https://www.youtube.com/watch?v=${initialId}`;
  loadVideo();
}
requestAnimationFrame(tick);
