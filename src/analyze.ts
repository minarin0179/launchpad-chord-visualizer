/**
 * Chord Analyzer ページ — YouTube の再生と、解析結果 / Songle のコード進行を同期表示する。
 * このファイルが合成ルート: 状態（store）・画面（view）・プレイヤー・解析をつなぐ。
 */
import { BeatClick } from './analyze-page/beat-click';
import { captureTabAudio } from './analyze-page/capture';
import { extractInWorker } from './analyze-page/extract';
import {
  fromCache,
  INITIAL_STATE,
  reduce,
  selectCapo,
  selectResult,
  toCache,
  type StatusKind,
} from './analyze-page/state';
import { buildTimeMap, type Anchor } from './analyze-page/time-map';
import { mountAnalyzeView, ORIGIN_LABEL } from './analyze-page/view';
import {
  createYouTubePlayer,
  YouTubeClock,
  YT_STATE,
  type YouTubePlayer,
} from './analyze-page/youtube-player';
import { remapTimes } from './analyzer/features';
import { MS_PER_SECOND } from './config/timing';
import { mod12 } from './core/pitch';
import { segmentLabel } from './core/segments';
import { errorMessage } from './platform/logger';
import { browserStorage } from './platform/storage';
import { parseYouTubeId, youtubeMedia } from './song/media-url';
import {
  loadAnalysisCache,
  saveAnalysisCache,
  type AnalysisOrigin,
} from './song/sources/analysis-cache';
import { fetchSongle } from './song/sources/songle-client';
import { mediaPageUrl } from './song/types';
import { createStore } from './store/create-store';
import { applyTheme } from './ui/theme';

/** スキャン中に「録音フレーム ↔ 動画時刻」の対応点を記録する間隔（ms） */
const ANCHOR_INTERVAL_MS = 200;
/** 解析に必要な対応点の最少数（これより少ない録音は短すぎる） */
const MIN_ANCHORS = 10;
/** 動画の終わりとみなす残り時間（秒） */
const END_MARGIN_SEC = 0.3;
/** プレイヤーの状態が変わるのを待つ上限と確認間隔（ms） */
const PLAYER_WAIT_TIMEOUT_MS = 10000;
const PLAYER_POLL_MS = 50;
const PLAYER_ELEMENT_ID = 'player';

applyTheme();
const storage = browserStorage();
const store = createStore(reduce, INITIAL_STATE);
const beatClick = new BeatClick();
let player: YouTubePlayer | null = null;
let clock: YouTubeClock | null = null;
/** スキャン中だけ有効: スキャンを終わらせる */
let stopScan: ((byUser: boolean) => void) | null = null;

const update = store.dispatch;
const setStatus = (text: string, kind: StatusKind = ''): void => {
  update({ status: { text, kind } });
};
const offsetSec = (): number => store.getState().offsetMs / MS_PER_SECOND;
const currentTime = (): number | null => (clock ? clock.now() + offsetSec() : null);

/** いまの状態を保存する（解析結果も Songle 表示も無ければ保存しない） */
function save(): void {
  const state = store.getState();
  if (!state.videoId || (!state.features && !state.useSongle)) return;
  if (!saveAnalysisCache(storage, state.videoId, toCache(state, Date.now()))) {
    setStatus('ブラウザの保存領域が足りないため、解析結果を保存できませんでした', 'error');
  }
}

function waitFor(condition: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (performance.now() - started > PLAYER_WAIT_TIMEOUT_MS) {
        clearInterval(timer);
        reject(new Error('プレイヤーの応答がタイムアウトしました'));
      }
    }, PLAYER_POLL_MS);
  });
}

// =====================
// 動画の読み込み
// =====================
async function loadVideo(input: string): Promise<void> {
  const videoId = parseYouTubeId(input);
  if (!videoId) {
    setStatus('YouTube の URL を認識できません', 'error');
    return;
  }
  history.replaceState(null, '', `?v=${videoId}`);
  const cached = loadAnalysisCache(storage, videoId);
  update({ videoId, songle: null, useSongle: false, progress: 0, ...fromCache(cached) });
  beatClick.reset();

  try {
    if (player) {
      player.cueVideoById(videoId);
    } else {
      setStatus('プレイヤーを読み込み中…', 'busy');
      player = await createYouTubePlayer(PLAYER_ELEMENT_ID, videoId, (state) => {
        if (state === YT_STATE.ended) stopScan?.(false);
      });
      clock = new YouTubeClock(player);
    }
  } catch (error) {
    setStatus(`プレイヤーを読み込めません: ${errorMessage(error)}`, 'error');
    return;
  }
  // 読み込み中に別の動画が指定されていたら、そちらに任せる
  if (store.getState().videoId !== videoId) return;
  view.setScanRates(player.getAvailablePlaybackRates().filter((rate) => rate >= 1));
  update({ playerReady: true });

  // 解析済みでなければ Songle を先に試す（前回 Songle を表示していた場合も）
  const { features, origin } = store.getState();
  if (!features || cached?.useSongle) {
    if (await loadSongle(features !== null)) return;
    if (store.getState().videoId !== videoId) return;
  }
  if (features && origin)
    setStatus(`保存済みの解析結果を読み込みました（${ORIGIN_LABEL[origin]}）`, 'ok');
  else if (!features)
    setStatus(
      'Songle 未登録の動画です。SCAN でタブ音声を解析、または AUDIO FILE で音源ファイルを解析',
    );
}

// =====================
// Songle
// =====================

/**
 * Songle のコード進行に切り替える。
 * @param quiet 未登録・失敗時にステータスを書き換えない（呼び出し元が続けて別の表示をする場合）
 * @returns 切り替えられたら true
 */
async function loadSongle(quiet = false): Promise<boolean> {
  const { videoId } = store.getState();
  if (!videoId) return false;
  update({ busy: true });
  setStatus('Songle からコード進行を取得中…', 'busy');
  let songle = store.getState().songle;
  try {
    songle ??= await fetchSongle(youtubeMedia(videoId).songleUrl);
  } catch (error) {
    if (!quiet) setStatus(`Songle から取得できません: ${errorMessage(error)}`, 'error');
    return false;
  } finally {
    update({ busy: false });
  }
  // 取得中に別の動画を読み込んだ
  if (store.getState().videoId !== videoId) return false;
  if (!songle) {
    if (!quiet) setStatus('この動画は Songle に登録されていません', 'error');
    return false;
  }
  update({ songle, useSongle: true });
  save();
  setStatus(
    `Songle のコード進行を読み込みました（${songle.info.title} / ${songle.info.artist || '—'}）`,
    'ok',
  );
  return true;
}

function toggleSongle(): void {
  const { useSongle, features, origin } = store.getState();
  // Songle 表示中に押したら解析結果に戻す（解析結果が無ければ取得し直す）
  if (useSongle && features) {
    update({ useSongle: false });
    save();
    setStatus(`解析結果を表示中（${origin ? ORIGIN_LABEL[origin] : '—'}）`, 'ok');
  } else {
    void loadSongle();
  }
}

// =====================
// 解析
// =====================
async function analyze(
  channels: Float32Array[],
  sampleRate: number,
  timeScale: number,
  timeMap: (t: number) => number,
  origin: AnalysisOrigin,
): Promise<void> {
  const started = performance.now();
  update({ progress: 0 });
  try {
    const features = await extractInWorker(channels, sampleRate, timeScale, (progress, label) => {
      update({ progress, status: { text: `解析中: ${label}…`, kind: 'busy' } });
    });
    update({ features: remapTimes(features, timeMap), origin, useSongle: false, progress: 1 });
    setStatus(`解析完了（${((performance.now() - started) / MS_PER_SECOND).toFixed(1)} 秒）`, 'ok');
    save();
  } catch (error) {
    setStatus(`解析エラー: ${errorMessage(error)}`, 'error');
  }
}

async function analyzeFile(file: File): Promise<void> {
  update({ busy: true });
  setStatus(`${file.name} をデコード中…`, 'busy');
  try {
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    await ctx.close();
    // Worker へ転送するので、AudioBuffer の内部バッファではなくコピーを渡す
    const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) =>
      buffer.getChannelData(channel).slice(),
    );
    await analyze(channels, buffer.sampleRate, 1, (t) => t, 'file');
  } catch (error) {
    setStatus(`音声ファイルを解析できません: ${errorMessage(error)}`, 'error');
  } finally {
    update({ busy: false });
  }
}

/** タブの音声を録音しながら動画を速く再生し、録音を解析する */
async function scan(rate: number): Promise<void> {
  const target = player;
  if (!target) return;
  if (!target.getAvailablePlaybackRates().includes(rate)) {
    setStatus(`この動画は ${rate}x 再生に対応していません`, 'error');
    return;
  }
  let capture;
  try {
    capture = await captureTabAudio(() => stopScan?.(false));
  } catch (error) {
    setStatus(`タブ音声のキャプチャを開始できません: ${errorMessage(error)}`, 'error');
    return;
  }

  update({ busy: true, scanning: true, progress: 0 });
  const anchors: Anchor[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  // コールバックの中から書き換えるので、オブジェクトにまとめて持つ
  const outcome: { failure: unknown; stoppedByUser: boolean } = {
    failure: null,
    stoppedByUser: false,
  };
  const isPlaying = (): boolean => target.getPlayerState() === YT_STATE.playing;

  try {
    setStatus('スキャン準備中…', 'busy');
    // 再生速度は読み込み済みの動画にしか効かないので、一度再生してから頭出しする
    target.playVideo();
    await waitFor(isPlaying);
    target.pauseVideo();
    target.setPlaybackRate(rate);
    target.seekTo(0, true);
    await waitFor(() => target.getPlaybackRate() === rate);
    target.playVideo();
    await waitFor(isPlaying);

    const duration = target.getDuration();
    setStatus(`スキャン中（${rate}x）… このタブを表示したままお待ちください`, 'busy');
    await new Promise<void>((resolve) => {
      stopScan = (byUser) => {
        outcome.stoppedByUser = byUser;
        resolve();
      };
      timer = setInterval(() => {
        if (!isPlaying()) return;
        const video = target.getCurrentTime();
        anchors.push({ frame: capture.currentFrame(), video });
        update({ progress: video / duration });
        if (video >= duration - END_MARGIN_SEC) resolve();
      }, ANCHOR_INTERVAL_MS);
    });
  } catch (error) {
    outcome.failure = error;
  } finally {
    clearInterval(timer);
    stopScan = null;
  }

  const recording = await capture.stop();
  target.pauseVideo();
  target.setPlaybackRate(1);
  target.seekTo(0, true);
  update({ busy: false, scanning: false });

  const first = anchors.at(0);
  const last = anchors.at(-1);
  if (outcome.failure) {
    setStatus(`スキャン失敗: ${errorMessage(outcome.failure)}`, 'error');
    return;
  }
  if (!first || !last || anchors.length < MIN_ANCHORS) {
    setStatus('録音が短すぎます', 'error');
    return;
  }
  if (outcome.stoppedByUser) setStatus('途中で停止しました。録音済みの範囲を解析します', 'busy');

  const { sampleRate, baseFrame } = recording;
  const endFrame = last.frame + Math.round((sampleRate * ANCHOR_INTERVAL_MS) / MS_PER_SECOND);
  const channels = recording.channels.map((channel) =>
    channel.slice(
      Math.max(0, first.frame - baseFrame),
      Math.min(channel.length, endFrame - baseFrame),
    ),
  );
  update({ busy: true });
  await analyze(
    channels,
    sampleRate,
    rate,
    buildTimeMap(anchors, first.frame, sampleRate, rate),
    'scan',
  );
  update({ busy: false });
}

// =====================
// 画面
// =====================
function seekTo(t: number): void {
  if (!player) return;
  player.seekTo(Math.max(0, t - offsetSec()), true);
  player.playVideo();
}

async function copyJson(): Promise<void> {
  const state = store.getState();
  const result = selectResult(state);
  if (!result) return;
  const capo = selectCapo(state);
  const json = JSON.stringify({
    videoId: state.videoId,
    key: result.key.label,
    tempo: result.tempo === null ? null : Math.round(result.tempo),
    capo,
    segments: result.segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      chord: segment.label,
      shape: segmentLabel(segment, capo),
    })),
  });
  try {
    await navigator.clipboard.writeText(json);
    setStatus('解析結果の JSON をクリップボードにコピーしました', 'ok');
  } catch (error) {
    setStatus(`クリップボードにコピーできません: ${errorMessage(error)}`, 'error');
  }
}

const view = mountAnalyzeView(store, {
  onLoad: (input) => void loadVideo(input),
  onScan: (rate) => void scan(rate),
  onStopScan: () => stopScan?.(true),
  onFile: (file) => void analyzeFile(file),
  onSongle: toggleSongle,
  onDecodeChange: (decode) => {
    // デコード設定は解析結果に対するものなので、Songle 表示中なら解析結果に戻す
    const { useSongle, features } = store.getState();
    update({ decode, useSongle: useSongle && !features });
    save();
  },
  onOffset: (offsetMs, commit) => {
    update({ offsetMs });
    if (commit) save();
  },
  onBeatClick: (enabled) => {
    update({ beatClick: enabled });
    if (enabled) beatClick.enable();
  },
  onCapo: (change) => {
    // 手動: いまのカポから ±1（0〜11 で一周する）。AUTO: コード進行に合わせて選ぶ
    if (change === 'auto') update({ capoAuto: true });
    else
      update({
        capoAuto: false,
        capo: mod12(selectCapo(store.getState()) + change.delta),
      });
    save();
  },
  onSeek: seekTo,
  onCopy: () => void copyJson(),
  getTime: currentTime,
});

function tick(): void {
  requestAnimationFrame(tick);
  const t = currentTime();
  if (t === null || !player) return;
  const state = store.getState();
  const result = selectResult(state);
  if (!result) return;
  if (state.beatClick && player.getPlayerState() === YT_STATE.playing) {
    beatClick.schedule(t, result.timing.bounds, player.getPlaybackRate());
  } else {
    beatClick.reset();
  }
  view.frame(t);
}

const initialId = new URLSearchParams(location.search).get('v');
if (initialId) {
  const url = mediaPageUrl(youtubeMedia(initialId));
  view.setUrl(url);
  void loadVideo(url);
}
requestAnimationFrame(tick);
