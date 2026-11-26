import { LOOP_MARKER_WIDTH, SONG_PX_PER_SEC } from '../../config/timeline';
import { clamp } from '../../config/ranges';
import { segmentLabel } from '../../core/segments';
import { formatClock } from '../../core/time-format';
import { byId } from '../../platform/dom';
import { selectActiveSource, selectCapoPosition, selectPlayerReady } from '../../store/selectors';
import type { AppState } from '../../store/state';
import { createTimelineView, segmentHue } from '../../timeline/timeline-view';
import type { AppStore } from '../../ui/context';
import type { FrameView } from '../runtime';
import { NO_SEGMENT, type ChordSource } from '../types';

export interface PlaybackViewDeps {
  readonly store: AppStore;
  /** コード進行上の現在時刻（プレイヤーが無ければ null） */
  readonly getTime: () => number | null;
  readonly onSeek: (t: number) => void;
}

const PERCENT = 100;
const UNKNOWN = '—';
const NEXT_IN_DECIMALS = 1;

const percentOf = (sec: number, duration: number): string => `${(sec / duration) * PERCENT}%`;

/** 流れるタイムライン（クリックでシーク） */
export function mountSongTimeline({ store, getTime, onSeek }: PlaybackViewDeps): FrameView {
  const viewport = byId('song-timeline', 'div');
  const timeline = createTimelineView(
    {
      viewport,
      strip: byId('song-strip', 'div'),
      blocks: byId('song-blocks', 'div'),
      loop: byId('song-loop', 'div'),
    },
    { pxPerSec: SONG_PX_PER_SEC, blockClass: 'song-block' },
  );

  viewport.addEventListener('click', (event) => {
    const t = getTime();
    if (t !== null) onSeek(timeline.timeAtClientX(event.clientX, t));
  });

  let shownSource: ChordSource | null = null;
  let shownCapo = -1;
  const render = (state: AppState): void => {
    const source = selectActiveSource(state);
    const capo = selectCapoPosition(state);
    if (source !== shownSource || capo !== shownCapo) {
      shownSource = source;
      shownCapo = capo;
      timeline.render(source?.segments ?? [], source?.timing.duration ?? 0, capo);
    }
    timeline.setActive(source ? state.song.cursor.segmentIndex : NO_SEGMENT);
    timeline.setLoop(state.song.loop);
  };
  store.subscribe(render);
  render(store.getState());

  return {
    frame(t) {
      timeline.frame(t);
    },
  };
}

/** NOW / NEXT の表示 */
export function mountNowNext(store: AppStore): FrameView {
  const now = byId('song-now', 'div');
  const sounds = byId('song-now-real', 'div');
  const next = byId('song-next', 'span');
  const nextIn = byId('song-next-in', 'span');
  const shown = ['', '', '', ''];
  const write = (texts: readonly string[]): void => {
    [now, sounds, next, nextIn].forEach((element, i) => {
      if (texts[i] === shown[i]) return;
      shown[i] = texts[i];
      element.textContent = texts[i];
    });
  };

  return {
    frame(t, source) {
      const state = store.getState();
      const capo = selectCapoPosition(state);
      const index = state.song.cursor.segmentIndex;
      const current = index === NO_SEGMENT ? undefined : source.segments[index];
      // 区間外（曲の頭より前・すき間・曲の後）では、次に始まるコードを探す
      const nextIndex = current
        ? source.nextChord[index]
        : source.segments.findIndex((segment) => segment.chord && segment.start > t);
      const upcoming = nextIndex === NO_SEGMENT ? undefined : source.segments[nextIndex];
      write([
        current ? segmentLabel(current, capo) : UNKNOWN,
        // カポを使っているときは、形の名前の下に実音のコード名も出す
        current?.chord && capo !== 0 ? `sounds ${current.label}` : '',
        upcoming ? segmentLabel(upcoming, capo) : UNKNOWN,
        upcoming ? `in ${Math.max(0, upcoming.start - t).toFixed(NEXT_IN_DECIMALS)}s` : '',
      ]);
    },
  };
}

/** 曲全体のシークバー: コードの色帯・A-B 区間・再生位置・時刻。クリック / ドラッグでシーク */
export function mountSongOverview({ store, onSeek }: PlaybackViewDeps): FrameView {
  const bar = byId('song-overview', 'div');
  const blocks = byId('song-overview-blocks', 'div');
  const loop = byId('song-overview-loop', 'div');
  const head = byId('song-overview-head', 'div');
  const time = byId('song-time', 'span');
  /** ドラッグ中の位置（秒）。ドラッグ中は位置だけ動かし、離したときにシークする */
  let dragTime: number | null = null;
  let shownTime = '';

  const timeAt = (event: PointerEvent): number | null => {
    const source = selectActiveSource(store.getState());
    if (!source) return null;
    const rect = bar.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / rect.width, 0, 1) * source.timing.duration;
  };
  bar.addEventListener('pointerdown', (event) => {
    if (!selectPlayerReady(store.getState())) return;
    dragTime = timeAt(event);
    if (dragTime !== null) bar.setPointerCapture(event.pointerId);
  });
  bar.addEventListener('pointermove', (event) => {
    if (dragTime !== null) dragTime = timeAt(event) ?? dragTime;
  });
  bar.addEventListener('pointerup', (event) => {
    if (dragTime === null) return;
    // ドラッグ中に曲が切り替わった場合（timeAt が null）は何もしない
    const target = timeAt(event);
    dragTime = null;
    if (target !== null) onSeek(target);
  });
  bar.addEventListener('pointercancel', () => {
    dragTime = null;
  });

  let shownSource: ChordSource | null = null;
  let shownCapo = -1;
  const render = (state: AppState): void => {
    const source = selectActiveSource(state);
    const capo = selectCapoPosition(state);
    if (source !== shownSource || capo !== shownCapo) {
      shownSource = source;
      shownCapo = capo;
      if (!source) dragTime = null;
      const duration = source?.timing.duration ?? 0;
      blocks.replaceChildren(
        ...(source?.segments ?? []).map((segment) => {
          const block = document.createElement('div');
          block.className = segment.chord ? 'song-ov-block' : 'song-ov-block nc';
          block.style.left = percentOf(segment.start, duration);
          block.style.width = percentOf(segment.end - segment.start, duration);
          block.style.setProperty('--hue', segmentHue(segment, capo));
          block.title = `${segmentLabel(segment, capo)}  ${formatClock(segment.start)}`;
          return block;
        }),
      );
    }
    const { loop: range } = state.song;
    loop.hidden = range.kind === 'off' || !source;
    if (range.kind === 'off' || !source) return;
    const { duration } = source.timing;
    loop.style.left = percentOf(range.a, duration);
    loop.style.width =
      range.kind === 'ab' ? percentOf(range.b - range.a, duration) : LOOP_MARKER_WIDTH;
    loop.classList.toggle('open', range.kind === 'a');
  };
  store.subscribe(render);
  render(store.getState());

  return {
    frame(t, source) {
      const { duration } = source.timing;
      const position = clamp(dragTime ?? t, 0, duration);
      head.style.left = percentOf(position, duration);
      const text = `${formatClock(position)} / ${formatClock(duration)}`;
      if (text === shownTime) return;
      shownTime = text;
      time.textContent = text;
    },
  };
}
