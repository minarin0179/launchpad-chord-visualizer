import { STORAGE_KEYS } from '../config/storage-keys';
import { SETTINGS_SAVE_DEBOUNCE_MS } from '../config/timing';
import type { Action } from '../store/actions';
import type { Store } from '../store/create-store';
import { selectPersistedSettings, type PersistedData } from '../store/initial-state';
import type { AppState } from '../store/state';
import { readJson, readString, writeJson, writeString, type KeyValueStorage } from './storage';

/** 保存済みの設定を読む（検証は createInitialState が行う） */
export function loadPersisted(storage: KeyValueStorage): PersistedData {
  return {
    settings: readJson(storage, STORAGE_KEYS.settings),
    deviceName: readString(storage, STORAGE_KEYS.device),
    songVolume: readString(storage, STORAGE_KEYS.songVolume),
    recents: readJson(storage, STORAGE_KEYS.recentSongs),
  };
}

/**
 * 状態の変化を localStorage に保存し続ける。
 * 設定はスライダー操作などで連続して変わるので、少し待ってまとめて書く。
 * ページを離れるとき・タブが隠れるときは、待っている書き込みをすぐに済ませる。
 */
export function startPersistence(store: Store<AppState, Action>, storage: KeyValueStorage): void {
  let savedSettings = JSON.stringify(selectPersistedSettings(store.getState()));
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    const settings = JSON.stringify(selectPersistedSettings(store.getState()));
    if (settings === savedSettings) return;
    savedSettings = settings;
    writeString(storage, STORAGE_KEYS.settings, settings);
  };

  store.subscribe((state) => {
    if (timer !== null || JSON.stringify(selectPersistedSettings(state)) === savedSettings) return;
    timer = setTimeout(flush, SETTINGS_SAVE_DEBOUNCE_MS);
  });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });

  let first = true;
  const afterFirst = (save: () => void): void => {
    if (!first) save();
  };
  store.watch(
    (state) => state.midi.preferredName,
    (name) => {
      afterFirst(() => name !== null && writeString(storage, STORAGE_KEYS.device, name));
    },
  );
  store.watch(
    (state) => state.song.volume,
    (volume) => {
      afterFirst(() => writeString(storage, STORAGE_KEYS.songVolume, String(volume)));
    },
  );
  store.watch(
    (state) => state.song.recents,
    (recents) => {
      afterFirst(() => writeJson(storage, STORAGE_KEYS.recentSongs, recents));
    },
  );
  first = false;
}
