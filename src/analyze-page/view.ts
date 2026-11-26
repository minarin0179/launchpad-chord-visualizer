import { isVocabulary } from '../analyzer/decode';
import { ANALYZE_PX_PER_SEC } from '../config/timeline';
import { scaleFitRatio } from '../core/capo';
import { keyLabel } from '../core/key';
import { findSegmentIndex, nextChordIndices, segmentLabel } from '../core/segments';
import { formatClockTenths } from '../core/time-format';
import { collectElements, createElement } from '../platform/dom';
import type { Store } from '../store/create-store';
import type { AnalysisOrigin } from '../song/sources/analysis-cache';
import { createTimelineView } from '../timeline/timeline-view';
import { drawBeats, drawChroma } from './canvases';
import {
  selectCapo,
  selectResult,
  type AnalyzeState,
  type DecodeSettings,
  type Patch,
  type Result,
} from './state';
import { beatJitterMs } from './time-map';

const ELEMENTS = {
  url: ['yt-url', 'input'],
  load: ['load-btn', 'button'],
  scanRate: ['scan-rate', 'select'],
  scan: ['scan-btn', 'button'],
  stop: ['stop-btn', 'button'],
  fileLabel: ['file-label', 'label'],
  file: ['file-input', 'input'],
  songle: ['songle-btn', 'button'],
  status: ['status', 'div'],
  progress: ['progress-bar', 'div'],
  now: ['now-chord', 'div'],
  next: ['next-chord', 'span'],
  nextIn: ['next-in', 'span'],
  key: ['info-key', 'dd'],
  tempo: ['info-tempo', 'dd'],
  segments: ['info-segments', 'dd'],
  source: ['info-source', 'dd'],
  capoDown: ['capo-down', 'button'],
  capoValue: ['capo-value', 'span'],
  capoUp: ['capo-up', 'button'],
  capoAuto: ['capo-auto', 'button'],
  capoHint: ['capo-hint', 'span'],
  vocabulary: ['opt-vocab', 'select'],
  stay: ['opt-stay', 'input'],
  stayValue: ['opt-stay-value', 'span'],
  bass: ['opt-bass', 'input'],
  bassValue: ['opt-bass-value', 'span'],
  offset: ['opt-offset', 'input'],
  offsetValue: ['opt-offset-value', 'span'],
  click: ['opt-click', 'input'],
  center: ['opt-center', 'input'],
  centerNote: ['opt-center-note', 'span'],
  hpss: ['opt-hpss', 'input'],
  melody: ['opt-melody', 'input'],
  copy: ['copy-btn', 'button'],
  timeline: ['timeline', 'div'],
  strip: ['timeline-strip', 'div'],
  blocks: ['blocks', 'div'],
  beatCanvas: ['beat-canvas', 'canvas'],
  chromaCanvas: ['chroma-canvas', 'canvas'],
  chart: ['chart', 'div'],
} as const;

export interface AnalyzeViewHandlers {
  onLoad(input: string): void;
  onScan(rate: number): void;
  onStopScan(): void;
  onFile(file: File): void;
  onSongle(): void;
  onDecodeChange(decode: DecodeSettings): void;
  /** commit = スライダーを離した（保存する） */
  onOffset(offsetMs: number, commit: boolean): void;
  onBeatClick(enabled: boolean): void;
  onCapo(change: { delta: number } | 'auto'): void;
  onSeek(t: number): void;
  onCopy(): void;
  /** コード進行上の現在時刻（プレイヤーが無ければ null） */
  getTime(): number | null;
}

export interface AnalyzeView {
  setUrl(url: string): void;
  /** スキャン速度の選択肢を、プレイヤーが対応する速度にする（既定は最速） */
  setScanRates(rates: readonly number[]): void;
  /** 再生位置に合わせて更新する（毎フレーム） */
  frame(t: number): void;
}

/** 特徴量の出所の表示名 */
export const ORIGIN_LABEL: Record<AnalysisOrigin, string> = {
  scan: 'タブスキャン',
  file: '音声ファイル',
};

const UNKNOWN = '—';
const PERCENT = 100;
const SLIDER_DECIMALS = 2;
const NEXT_IN_DECIMALS = 1;
const NO_SEGMENT = -1;

/** 解析ページの画面。状態から描画し、操作はハンドラに渡す */
export function mountAnalyzeView(
  store: Store<AnalyzeState, Patch>,
  handlers: AnalyzeViewHandlers,
): AnalyzeView {
  const el = collectElements(ELEMENTS);
  const timeline = createTimelineView(
    { viewport: el.timeline, strip: el.strip, blocks: el.blocks },
    { pxPerSec: ANALYZE_PX_PER_SEC, blockClass: 'az-block' },
  );
  let chips: HTMLButtonElement[] = [];
  let nextChord: number[] = [];
  let active = NO_SEGMENT;

  // ----- 操作 -----
  el.load.addEventListener('click', () => {
    handlers.onLoad(el.url.value);
  });
  el.url.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handlers.onLoad(el.url.value);
  });
  el.scan.addEventListener('click', () => {
    handlers.onScan(Number(el.scanRate.value));
  });
  el.stop.addEventListener('click', () => {
    handlers.onStopScan();
  });
  el.file.addEventListener('change', () => {
    const file = el.file.files?.item(0);
    if (file) handlers.onFile(file);
    el.file.value = '';
  });
  el.songle.addEventListener('click', () => {
    handlers.onSongle();
  });

  const readDecode = (): DecodeSettings => ({
    vocabulary: isVocabulary(el.vocabulary.value)
      ? el.vocabulary.value
      : store.getState().decode.vocabulary,
    selfTransition: el.stay.valueAsNumber,
    bassWeight: el.bass.valueAsNumber,
    centerCut: el.center.checked,
    hpss: el.hpss.checked,
    melody: el.melody.checked,
  });
  for (const control of [el.vocabulary, el.stay, el.bass, el.center, el.hpss, el.melody]) {
    control.addEventListener('input', () => {
      handlers.onDecodeChange(readDecode());
    });
  }
  el.offset.addEventListener('input', () => {
    handlers.onOffset(el.offset.valueAsNumber, false);
  });
  el.offset.addEventListener('change', () => {
    handlers.onOffset(el.offset.valueAsNumber, true);
  });
  el.click.addEventListener('change', () => {
    handlers.onBeatClick(el.click.checked);
  });
  el.capoDown.addEventListener('click', () => {
    handlers.onCapo({ delta: -1 });
  });
  el.capoUp.addEventListener('click', () => {
    handlers.onCapo({ delta: 1 });
  });
  el.capoAuto.addEventListener('click', () => {
    handlers.onCapo('auto');
  });
  el.copy.addEventListener('click', () => {
    handlers.onCopy();
  });
  el.timeline.addEventListener('click', (event) => {
    const t = handlers.getTime();
    if (t !== null) handlers.onSeek(timeline.timeAtClientX(event.clientX, t));
  });

  // ----- 状態 → 表示 -----
  const renderControls = (state: AnalyzeState): void => {
    el.status.textContent = state.status.text;
    el.status.className = `az-status ${state.status.kind}`;
    el.progress.style.width = `${Math.round(Math.min(1, Math.max(0, state.progress)) * PERCENT)}%`;

    el.load.disabled = state.busy;
    el.songle.disabled = state.busy || !state.videoId;
    el.scan.disabled = state.busy || !state.playerReady;
    el.file.disabled = state.busy;
    el.fileLabel.classList.toggle('disabled', state.busy);
    el.stop.disabled = !state.scanning;
    el.songle.classList.toggle('active', state.useSongle);

    const { decode } = state;
    el.vocabulary.value = decode.vocabulary;
    el.stay.valueAsNumber = decode.selfTransition;
    el.stayValue.textContent = decode.selfTransition.toFixed(SLIDER_DECIMALS);
    el.bass.valueAsNumber = decode.bassWeight;
    el.bassValue.textContent = decode.bassWeight.toFixed(SLIDER_DECIMALS);
    el.center.checked = decode.centerCut;
    el.hpss.checked = decode.hpss;
    el.melody.checked = decode.melody;
    el.offset.valueAsNumber = state.offsetMs;
    el.offsetValue.textContent = `${state.offsetMs} ms`;
    el.click.checked = state.beatClick;

    // センターカットは左右の差が必要（モノラル音源では使えない）
    const centerCutUnavailable = state.features !== null && !state.features.sideAvailable;
    el.center.disabled = centerCutUnavailable;
    el.centerNote.textContent = centerCutUnavailable ? '無効（モノラル音源）' : 'ボーカル除去';
  };

  const describeKey = (result: Result, capo: number): string => {
    if (capo !== 0) return `${result.key.label} → Capo ${capo} で ${keyLabel(result.key, capo)}`;
    const basis = result.fromSongle ? 'コードから推定' : `相関 ${result.key.confidence}`;
    return `${result.key.label}（${basis}）`;
  };

  const describeTempo = (result: Result): string => {
    if (!result.tempo) return UNKNOWN;
    const jitter = result.fromSongle ? null : beatJitterMs(result.timing.bounds);
    return `${Math.round(result.tempo)} BPM${jitter === null ? '' : `（拍間隔のばらつき ±${jitter}ms）`}`;
  };

  const renderSource = (state: AnalyzeState, result: Result | null): void => {
    if (result?.fromSongle && state.songle) {
      const { info } = state.songle;
      const name = `（${info.title} / ${info.artist || UNKNOWN}）`;
      if (!info.pageUrl) {
        el.source.textContent = `Songle${name}`;
        return;
      }
      const link = createElement('a', { text: 'Songle' });
      link.href = info.pageUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      el.source.replaceChildren(link, name);
      return;
    }
    el.source.textContent = result && state.origin ? ORIGIN_LABEL[state.origin] : UNKNOWN;
  };

  let shownResult: Result | null | undefined;
  let shownCapo = NO_SEGMENT;
  const renderResult = (state: AnalyzeState): void => {
    const result = selectResult(state);
    const capo = selectCapo(state);
    el.capoValue.textContent = String(capo);
    el.capoAuto.classList.toggle('active', state.capoAuto);
    if (result === shownResult && capo === shownCapo) return;
    shownResult = result;
    shownCapo = capo;

    const segments = result?.segments ?? [];
    nextChord = nextChordIndices(segments);
    active = NO_SEGMENT;
    el.key.textContent = result ? describeKey(result, capo) : UNKNOWN;
    el.tempo.textContent = result ? describeTempo(result) : UNKNOWN;
    el.segments.textContent = result
      ? String(segments.filter((segment) => segment.chord).length)
      : UNKNOWN;
    el.capoHint.textContent = segments.length
      ? `スケール内 ${Math.round(scaleFitRatio(segments, capo) * PERCENT)}%`
      : '';
    renderSource(state, result);
    el.copy.disabled = !result;
    el.now.textContent = UNKNOWN;
    el.next.textContent = UNKNOWN;
    el.nextIn.textContent = '';

    timeline.render(segments, result?.timing.duration ?? 0, capo);
    timeline.setActive(NO_SEGMENT);
    chips = segments.map((segment) => {
      const chip = createElement('button', { className: segment.chord ? 'az-chip' : 'az-chip nc' });
      chip.append(
        createElement('time', { text: formatClockTenths(segment.start) }),
        segmentLabel(segment, capo),
      );
      chip.addEventListener('click', () => {
        handlers.onSeek(segment.start);
      });
      return chip;
    });
    el.chart.replaceChildren(...chips);

    drawChroma(
      el.chromaCanvas,
      result?.fromSongle ? null : state.features,
      result?.trebleKey ?? null,
      ANALYZE_PX_PER_SEC,
    );
    drawBeats(el.beatCanvas, result?.timing ?? null, ANALYZE_PX_PER_SEC);
  };

  store.subscribe((state) => {
    renderControls(state);
    renderResult(state);
  });
  renderControls(store.getState());
  renderResult(store.getState());

  return {
    setUrl(url) {
      el.url.value = url;
    },
    setScanRates(rates) {
      if (rates.length === 0) return;
      el.scanRate.replaceChildren(
        ...rates.map((rate) => {
          const option = createElement('option', { text: `${rate}x` });
          option.value = String(rate);
          return option;
        }),
      );
      el.scanRate.value = String(Math.max(...rates));
    },
    frame(t) {
      const state = store.getState();
      const result = selectResult(state);
      if (!result?.segments.length) return;
      const { segments } = result;
      const capo = selectCapo(state);
      timeline.frame(t);

      const index = findSegmentIndex(segments, t);
      if (index !== active) {
        if (active !== NO_SEGMENT) chips.at(active)?.classList.remove('active');
        if (index !== NO_SEGMENT) chips.at(index)?.classList.add('active');
        timeline.setActive(index);
        active = index;
        el.now.textContent = index === NO_SEGMENT ? UNKNOWN : segmentLabel(segments[index], capo);
      }
      // 区間外（曲の頭より前・すき間・曲の後）では、次に始まるコードを探す
      const nextIndex =
        index === NO_SEGMENT
          ? segments.findIndex((segment) => segment.chord && segment.start > t)
          : nextChord[index];
      const upcoming = nextIndex === NO_SEGMENT ? undefined : segments[nextIndex];
      el.next.textContent = upcoming ? segmentLabel(upcoming, capo) : UNKNOWN;
      el.nextIn.textContent = upcoming
        ? `in ${Math.max(0, upcoming.start - t).toFixed(NEXT_IN_DECIMALS)}s`
        : '';
    },
  };
}
