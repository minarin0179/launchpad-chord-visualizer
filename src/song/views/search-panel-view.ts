import { formatClock } from '../../core/time-format';
import { byId, createElement } from '../../platform/dom';
import type { AppStore } from '../../ui/context';
import { parseMediaUrl } from '../media-url';
import { MEDIA_LABELS, mediaPageUrl, type Media } from '../types';

export interface SearchPanelDeps {
  readonly store: AppStore;
  /** 入力欄の内容を確定した（URL なら読み込み、それ以外は検索） */
  readonly onSubmit: (input: string) => void;
  readonly onPick: (media: Media) => void;
}

interface ListItem {
  readonly media: Media;
  readonly title: string;
  readonly meta: string;
  /** 履歴から消す（検索結果には無い） */
  readonly onRemove?: () => void;
}

/** Song バー上段: URL / 検索語の入力、LOAD / SEARCH、RECENT、候補リスト（検索結果・履歴） */
export function mountSearchPanel({ store, onSubmit, onPick }: SearchPanelDeps): void {
  const input = byId('song-url', 'input');
  const list = byId('song-results', 'ul');

  byId('song-load', 'button').addEventListener('click', () => {
    onSubmit(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onSubmit(input.value);
  });
  byId('song-recent', 'button').addEventListener('click', () => {
    store.dispatch({ type: 'recentPanelToggled' });
  });
  // 空の入力欄にフォーカスしたら履歴を出す
  input.addEventListener('focus', () => {
    if (!input.value.trim() && store.getState().song.panel.kind === 'none') {
      store.dispatch({ type: 'recentPanelOpened' });
    }
  });

  const renderItem = ({ media, title, meta, onRemove }: ListItem): HTMLLIElement => {
    const item = document.createElement('li');
    item.append(
      createElement('span', {
        className: `song-result-kind ${media.kind}`,
        text: MEDIA_LABELS[media.kind],
      }),
      createElement('span', { className: 'song-result-title', text: title }),
      createElement('span', { className: 'song-result-meta', text: meta }),
    );
    if (onRemove) {
      const remove = createElement('button', {
        className: 'song-result-remove',
        text: '×',
        title: 'Remove from history',
      });
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        onRemove();
      });
      item.appendChild(remove);
    }
    item.addEventListener('click', () => {
      onPick(media);
    });
    return item;
  };

  const itemsOf = (state: ReturnType<AppStore['getState']>): ListItem[] => {
    const { panel, recents } = state.song;
    if (panel.kind === 'results') {
      return panel.hits.map(({ media, title, artist, durationSec }) => ({
        media,
        title,
        meta: durationSec === null ? artist : `${artist} · ${formatClock(durationSec)}`,
      }));
    }
    if (panel.kind !== 'recent') return [];
    return recents.flatMap((recent) => {
      const media = parseMediaUrl(recent.url);
      if (!media) return [];
      const onRemove = (): void => {
        store.dispatch({ type: 'recentRemoved', url: recent.url });
      };
      return [{ media, title: recent.title || recent.url, meta: recent.artist, onRemove }];
    });
  };

  let shownPanel: unknown = null;
  let shownRecents: unknown = null;
  store.subscribe(render);
  render(store.getState());
  function render(state: ReturnType<AppStore['getState']>): void {
    const { panel, recents } = state.song;
    if (panel === shownPanel && recents === shownRecents) return;
    shownPanel = panel;
    shownRecents = recents;
    const items = itemsOf(state);
    list.replaceChildren(...items.map(renderItem));
    list.hidden = items.length === 0;
  }

  // 読み込みを始めたら、入力欄を正規の URL に置き換える
  store.watch(
    (state) => state.song.load,
    (load) => {
      if (load.status !== 'idle') input.value = mediaPageUrl(load.media);
    },
  );
}
