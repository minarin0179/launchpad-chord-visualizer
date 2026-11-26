/**
 * id で要素を取得する。存在しない・タグが違うときは例外にする
 * （HTML と JS の食い違いを起動時に検出するため。黙って null を返さない）。
 */
export function byId<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tag: K,
): HTMLElementTagNameMap[K] {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} が見つかりません`);
  if (element.tagName.toLowerCase() !== tag) {
    throw new Error(`#${id} は <${tag}> ではなく <${element.tagName.toLowerCase()}> です`);
  }
  return element as HTMLElementTagNameMap[K];
}

/** { 名前: [id, タグ] } の表から、型付きの要素レジストリを作る */
export type ElementSpec = Record<string, readonly [id: string, tag: keyof HTMLElementTagNameMap]>;

export type Elements<S extends ElementSpec> = {
  readonly [K in keyof S]: HTMLElementTagNameMap[S[K][1]];
};

export function collectElements<S extends ElementSpec>(spec: S): Elements<S> {
  const entries = Object.entries(spec).map(([name, [id, tag]]) => [name, byId(id, tag)] as const);
  return Object.fromEntries(entries) as Elements<S>;
}

/** 一定時間だけクラスを付ける（押下のフィードバックなど） */
export function flashClass(element: Element, className: string, durationMs: number): void {
  element.classList.add(className);
  setTimeout(() => {
    element.classList.remove(className);
  }, durationMs);
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; title?: string } = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.className) element.className = props.className;
  if (props.text !== undefined) element.textContent = props.text;
  if (props.title) element.title = props.title;
  return element;
}

export function createOption(label: string, value: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.textContent = label;
  option.value = value;
  return option;
}
