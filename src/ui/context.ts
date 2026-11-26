import type { Action } from '../store/actions';
import type { Store } from '../store/create-store';
import type { AppState } from '../store/state';

export type AppStore = Store<AppState, Action>;

/** 選択肢のボタン群を作る。戻り値の関数で、選択中のキーに active クラスを付け直す */
export function buildButtonGroup<K extends string | number>(
  container: HTMLElement,
  items: readonly { readonly key: K; readonly label: string }[],
  onSelect: (key: K) => void,
): (activeKey: K | null) => void {
  const buttons = new Map<K, HTMLButtonElement>();
  container.replaceChildren();
  for (const { key, label } of items) {
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = label;
    button.addEventListener('click', () => {
      onSelect(key);
    });
    container.appendChild(button);
    buttons.set(key, button);
  }
  return (activeKey) => {
    for (const [key, button] of buttons) button.classList.toggle('active', key === activeKey);
  };
}
