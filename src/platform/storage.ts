/**
 * localStorage の薄いラッパー。
 * プライベートウィンドウなどで使えない・容量超過で書けない場合も例外を投げない。
 */
export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 何も保存しないストレージ（localStorage が使えない環境用） */
const NULL_STORAGE: KeyValueStorage = {
  length: 0,
  key: () => null,
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function browserStorage(): KeyValueStorage {
  try {
    return window.localStorage;
  } catch {
    return NULL_STORAGE;
  }
}

export function readString(storage: KeyValueStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** 保存できたら true（容量超過・保存不可なら false） */
export function writeString(storage: KeyValueStorage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** JSON として読む。未保存・壊れたデータは null */
export function readJson(storage: KeyValueStorage, key: string): unknown {
  const text = readString(storage, key);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function writeJson(storage: KeyValueStorage, key: string, value: unknown): boolean {
  return writeString(storage, key, JSON.stringify(value));
}

export function removeKey(storage: KeyValueStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // 保存不可の環境では何もしない
  }
}

/** 保存されているキーの一覧 */
export function listKeys(storage: KeyValueStorage): string[] {
  try {
    return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (key) => key !== null,
    );
  } catch {
    return [];
  }
}
