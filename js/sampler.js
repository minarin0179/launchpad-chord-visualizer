import { INSTRUMENTS, SMPLR_MODULE_URL, SOUNDFONT_KIT,
         SAMPLE_NOTE_RANGE, SAMPLE_RELEASE_S, SAMPLE_VOLUME } from './constants.js';
import { log } from './logger.js';

// =====================
// GM Soundfont Sampler (smplr)
// =====================
// smplr を CDN から動的 import し、GM Soundfont の音色を遅延ロードする。
// - 音色は選択時 / 初回発音時にロード（未ロードの間は audio.js が合成音を鳴らす）
// - 2回目以降は Cache API (smplr の CacheStorage) から即ロード
// - CDN に到達できない場合は failed 状態になり、以後ずっと合成音にフォールバック

let smplrModule = null;   // import 済みの smplr モジュール
let smplrImport = null;   // import の進行中 Promise
let storage = null;       // smplr CacheStorage（Cache API）
let destination = null;   // 全サンプル音色の共通出力ノード

const players = new Map();  // instrumentKey → smplr インスタンス（ロード完了済み）
const loading = new Map();  // instrumentKey → ロード中 Promise
const failed  = new Set();  // ロードに失敗した instrumentKey

// ロード状況の通知コールバック（main.js が注入） — 循環依存回避のため注入
let onStatusChange = null;

export function setSamplerStatusCallback(cb) {
  onStatusChange = cb;
}

function notify(instrumentKey, status, detail) {
  if (onStatusChange) onStatusChange(instrumentKey, status, detail);
}

/** その音色がサンプル音源を使うか（gm 指定あり & ロード失敗していない） */
export function usesSamples(instrumentKey) {
  const inst = INSTRUMENTS[instrumentKey];
  return !!(inst && inst.gm) && !failed.has(instrumentKey);
}

/** ロード済みなら smplr インスタンスを返す。未ロード / 失敗時は null */
export function getSamplePlayer(instrumentKey) {
  return players.get(instrumentKey) || null;
}

/** サンプル音色がロード中か */
export function isSampleLoading(instrumentKey) {
  return loading.has(instrumentKey);
}

/** 全サンプル音色の共通出力ノード（マスターゲイン） */
export function getSampleDestination(ctx) {
  if (!destination || destination.context !== ctx) {
    destination = ctx.createGain();
    destination.gain.value = 1;
    destination.connect(ctx.destination);
  }
  return destination;
}

function importSmplr() {
  if (smplrModule) return Promise.resolve(smplrModule);
  if (!smplrImport) {
    smplrImport = import(SMPLR_MODULE_URL)
      .then(mod => { smplrModule = mod; return mod; })
      .catch(err => { smplrImport = null; throw err; });
  }
  return smplrImport;
}

/**
 * 音色のサンプルをロードする（既にロード済み / ロード中なら何もしない）。
 * 失敗しても例外は投げず、その音色を failed に入れて合成音フォールバックに任せる。
 */
export function loadSampleInstrument(ctx, instrumentKey) {
  const inst = INSTRUMENTS[instrumentKey];
  if (!inst || !inst.gm) return Promise.resolve(null);
  if (players.has(instrumentKey)) return Promise.resolve(players.get(instrumentKey));
  if (loading.has(instrumentKey)) return loading.get(instrumentKey);
  if (failed.has(instrumentKey)) return Promise.resolve(null);

  notify(instrumentKey, 'loading');

  const promise = importSmplr().then(({ Soundfont, CacheStorage }) => {
    if (!storage) storage = new CacheStorage();
    const [lo, hi] = SAMPLE_NOTE_RANGE;
    const notes = [];
    for (let n = lo; n <= hi; n++) notes.push(n);

    const player = new Soundfont(ctx, {
      instrument: inst.gm,
      kit: SOUNDFONT_KIT,
      storage,
      destination: getSampleDestination(ctx),
      volume: inst.vol ?? SAMPLE_VOLUME,
      // loadLoopData は使わない — 配信されているループ点が MusyngKite のサンプルに
      // 適合せず、ループごとに音量が跳ねて脈打つ（CLAUDE.md 参照）
      notesToLoad: { notes, fallback: 'nearest' },
    });
    return player.ready.then(() => player);
  }).then(player => {
    players.set(instrumentKey, player);
    loading.delete(instrumentKey);
    log(`Sample loaded: ${inst.label} (${inst.gm})`);
    notify(instrumentKey, 'loaded');
    return player;
  }).catch(err => {
    loading.delete(instrumentKey);
    failed.add(instrumentKey);
    log(`Sample load failed: ${inst.label} — ${err.message} (synth fallback)`);
    notify(instrumentKey, 'failed', err.message);
    return null;
  });

  loading.set(instrumentKey, promise);
  return promise;
}

/**
 * サンプルでノートを鳴らす。ロード済みでなければ null を返す（呼び出し元が合成音に回す）。
 * volume: 0.0〜1.0（#volume スライダー値）
 */
export function startSampleNote(ctx, instrumentKey, midiNote, velocity, volume) {
  const player = players.get(instrumentKey);
  if (!player) return null;

  getSampleDestination(ctx).gain.value = volume;
  const inst = INSTRUMENTS[instrumentKey];
  const stop = player.start({
    note: midiNote,
    velocity,
    stopId: midiNote,
    ampRelease: inst.release ?? SAMPLE_RELEASE_S,
  });
  return { kind: 'sample', stop };
}
