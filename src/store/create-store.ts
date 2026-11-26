/**
 * 最小限の状態ストア。
 *
 * - 状態は不変（reduce が新しいオブジェクトを返す）
 * - 書き込みは dispatch(action) だけ
 * - 購読者は同期的に呼ばれる。購読者の中で dispatch した場合は、通知が一巡してから処理する
 *   （購読者が中途半端な順序で呼ばれないように）
 */
export type Listener<S> = (state: S, previous: S) => void;
export type Unsubscribe = () => void;

export interface Store<S, A> {
  // メソッドではなく関数のプロパティ（`const { dispatch } = store` のように取り出して使える）
  readonly getState: () => S;
  readonly dispatch: (action: A) => void;
  /** 状態が変わるたびに呼ばれる */
  readonly subscribe: (listener: Listener<S>) => Unsubscribe;
  /**
   * selector の結果が変わったときだけ呼ばれる（=== で比較）。
   * 登録時にも現在の値で 1 回呼ぶ。
   */
  readonly watch: <T>(
    selector: (state: S) => T,
    onChange: (value: T, state: S) => void,
  ) => Unsubscribe;
}

export function createStore<S, A>(reduce: (state: S, action: A) => S, initial: S): Store<S, A> {
  let state = initial;
  const listeners = new Set<Listener<S>>();
  const queue: A[] = [];
  let dispatching = false;

  const dispatch = (action: A): void => {
    queue.push(action);
    if (dispatching) return;
    dispatching = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const previous = state;
        state = reduce(previous, next);
        if (state === previous) continue;
        const current = state;
        for (const listener of [...listeners]) listener(current, previous);
      }
    } finally {
      dispatching = false;
      queue.length = 0;
    }
  };

  const subscribe = (listener: Listener<S>): Unsubscribe => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const watch = <T>(
    selector: (state: S) => T,
    onChange: (value: T, state: S) => void,
  ): Unsubscribe => {
    let last = selector(state);
    onChange(last, state);
    return subscribe((current) => {
      const value = selector(current);
      if (value === last) return;
      last = value;
      onChange(value, current);
    });
  };

  return { getState: () => state, dispatch, subscribe, watch };
}
