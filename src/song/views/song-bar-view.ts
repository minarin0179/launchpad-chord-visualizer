import { ANALYZE_PAGE } from '../../config/urls';
import { keyLabel } from '../../core/key';
import { byId, createOption } from '../../platform/dom';
import { selectActiveSource, selectCapoPosition, selectPlayerReady } from '../../store/selectors';
import type { AppState } from '../../store/state';
import type { AppStore } from '../../ui/context';
import type { SourceId } from '../types';
import { describeSongStatus } from './status';

export interface SongBarDeps {
  readonly store: AppStore;
  readonly onTogglePlay: () => void;
  readonly onBackOneBar: () => void;
  readonly onCycleLoop: () => void;
}

const UNKNOWN = '—';
const PLAY_GLYPH = { playing: '❚❚', paused: '▶' } as const;
const COLLAPSE_GLYPH = { collapsed: '▸', open: '▾' } as const;
const LOOP_LABEL = { off: 'A-B', a: 'A-B: set B', ab: 'A-B ✕' } as const;

const isSourceId = (value: string): value is SourceId => value === 'songle' || value === 'analysis';

/**
 * Song バー本体: ソース選択・ANALYZE リンク・折りたたみ・KEY / TEMPO / CAPO・
 * 再生 / 1 小節戻る / FOLLOW / PRACTICE / A-B・ステータス行。
 */
export function mountSongBar({
  store,
  onTogglePlay,
  onBackOneBar,
  onCycleLoop,
}: SongBarDeps): void {
  const dispatch = store.dispatch;
  const bar = byId('song-bar', 'section');
  const body = byId('song-body', 'div');
  const collapse = byId('song-collapse', 'button');
  const sourceSelect = byId('song-source', 'select');
  const analyzeLink = byId('song-analyze-link', 'a');
  const key = byId('song-key', 'span');
  const tempo = byId('song-tempo', 'span');
  const capo = byId('song-capo', 'span');
  const capoAuto = byId('song-capo-auto', 'button');
  const play = byId('song-play', 'button');
  const overviewPlay = byId('song-ov-play', 'button');
  const follow = byId('song-follow', 'button');
  const practice = byId('song-practice', 'button');
  const loop = byId('song-loop-btn', 'button');
  const status = byId('song-status', 'div');

  // ----- 操作 -----
  collapse.addEventListener('click', () => {
    dispatch({ type: 'songBarCollapseToggled' });
  });
  sourceSelect.addEventListener('change', () => {
    if (isSourceId(sourceSelect.value))
      dispatch({ type: 'sourceSelected', source: sourceSelect.value });
  });
  byId('song-capo-down', 'button').addEventListener('click', () => {
    dispatch({ type: 'capoShifted', delta: -1 });
  });
  byId('song-capo-up', 'button').addEventListener('click', () => {
    dispatch({ type: 'capoShifted', delta: 1 });
  });
  capoAuto.addEventListener('click', () => {
    dispatch({ type: 'capoAutoEnabled' });
  });
  play.addEventListener('click', onTogglePlay);
  overviewPlay.addEventListener('click', onTogglePlay);
  byId('song-back', 'button').addEventListener('click', onBackOneBar);
  loop.addEventListener('click', onCycleLoop);
  follow.addEventListener('click', () => {
    dispatch({ type: 'followSet', on: !store.getState().song.follow });
  });
  practice.addEventListener('click', () => {
    const on = !store.getState().song.practice;
    dispatch({ type: 'practiceSet', on });
  });

  // ----- 状態 → 表示 -----
  store.watch(
    (state) => state.song.collapsed,
    (collapsed) => {
      bar.classList.toggle('collapsed', collapsed);
      collapse.textContent = collapsed ? COLLAPSE_GLYPH.collapsed : COLLAPSE_GLYPH.open;
    },
  );

  store.watch(
    (state) => state.song.load,
    (load) => {
      body.hidden = load.status === 'idle';
      // 解析ページは YouTube 専用
      const youtubeId =
        load.status !== 'idle' && load.media.kind === 'youtube' ? load.media.id : null;
      analyzeLink.hidden = load.status !== 'idle' && youtubeId === null;
      analyzeLink.href = youtubeId
        ? `${ANALYZE_PAGE}?v=${encodeURIComponent(youtubeId)}`
        : ANALYZE_PAGE;

      const sources = load.status === 'loaded' ? Object.values(load.sources) : [];
      sourceSelect.replaceChildren(
        ...sources.map((source) => createOption(source.label, source.id)),
      );
      sourceSelect.disabled = sources.length < 2;
      if (load.status === 'loaded') sourceSelect.value = load.activeSource;
    },
  );

  let shown = '';
  store.subscribe(render);
  render(store.getState());
  function render(state: AppState): void {
    const { song } = state;
    const source = selectActiveSource(state);
    const capoPosition = selectCapoPosition(state);
    const described = describeSongStatus(song);
    const view = {
      key: !source
        ? UNKNOWN
        : capoPosition === 0
          ? source.key.label
          : `${source.key.label} → ${keyLabel(source.key, capoPosition)} shapes`,
      tempo: source?.tempo ? `${Math.round(source.tempo)} BPM` : UNKNOWN,
      capo: String(capoPosition),
      capoAuto: song.capoAuto,
      playGlyph: song.playback.playing ? PLAY_GLYPH.playing : PLAY_GLYPH.paused,
      playable: selectPlayerReady(state),
      follow: song.follow,
      practice: song.practice,
      hasSource: source !== null,
      loop: song.loop.kind,
      status: described.text,
      statusKind: described.kind,
    };
    const signature = JSON.stringify(view);
    if (signature === shown) return;
    shown = signature;

    key.textContent = view.key;
    tempo.textContent = view.tempo;
    capo.textContent = view.capo;
    capoAuto.classList.toggle('active', view.capoAuto);
    play.textContent = view.playGlyph;
    overviewPlay.textContent = view.playGlyph;
    follow.classList.toggle('active', view.follow);
    follow.disabled = !view.hasSource;
    practice.classList.toggle('active', view.practice);
    practice.disabled = !view.hasSource;
    loop.classList.toggle('active', view.loop !== 'off');
    loop.textContent = LOOP_LABEL[view.loop];
    status.textContent = view.status;
    status.className = `song-status ${view.statusKind}`;
  }
}
