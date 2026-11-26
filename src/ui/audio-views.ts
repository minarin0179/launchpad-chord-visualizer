import { INSTRUMENT_KEYS, INSTRUMENTS, type InstrumentKey } from '../config/instruments';
import { BPM_DEFAULT, BPM_MAX, BPM_MIN } from '../config/ranges';
import { byId } from '../platform/dom';
import type { AppState, SampleStatus } from '../store/state';
import type { AppStore } from './context';

/** 音量スライダー 1 本（スライダー + 「50%」のラベル） */
function mountVolumeSlider(
  store: AppStore,
  ids: { slider: string; label: string },
  select: (state: AppState) => number,
  onInput: (volume: number) => void,
): void {
  const slider = byId(ids.slider, 'input');
  const label = byId(ids.label, 'span');
  slider.addEventListener('input', () => {
    onInput(slider.valueAsNumber);
  });
  store.watch(select, (volume) => {
    slider.valueAsNumber = volume;
    label.textContent = `${volume}%`;
  });
}

/** 左パネル: 音量（INST = 楽器、SONG = 曲プレイヤー） */
export function mountVolumeView(store: AppStore): void {
  mountVolumeSlider(
    store,
    { slider: 'volume', label: 'volume-label' },
    (state) => state.audio.volume,
    (volume) => {
      store.dispatch({ type: 'volumeChanged', volume });
    },
  );
  mountVolumeSlider(
    store,
    { slider: 'song-volume', label: 'song-volume-label' },
    (state) => state.song.volume,
    (volume) => {
      store.dispatch({ type: 'songVolumeChanged', volume });
    },
  );
}

const METRONOME_LABEL = { running: '■ STOP', stopped: '▶ START' } as const;

/** 左パネル: メトロノーム（BPM スライダー + 数値入力 + START / STOP） */
export function mountMetronomeView(store: AppStore): void {
  const slider = byId('metro-bpm', 'input');
  const number = byId('metro-bpm-num', 'input');
  const button = byId('metro-btn', 'button');
  for (const input of [slider, number]) {
    input.min = String(BPM_MIN);
    input.max = String(BPM_MAX);
  }

  slider.addEventListener('input', () => {
    store.dispatch({ type: 'bpmChanged', bpm: slider.valueAsNumber });
  });
  number.addEventListener('change', () => {
    const bpm = Number.isFinite(number.valueAsNumber) ? number.valueAsNumber : BPM_DEFAULT;
    store.dispatch({ type: 'bpmChanged', bpm });
    // 範囲外の入力は丸められて状態が変わらないことがあるので、表示を状態に合わせ直す
    number.valueAsNumber = store.getState().metronome.bpm;
  });
  button.addEventListener('click', () => {
    store.dispatch({ type: 'metronomeToggled' });
  });

  store.watch(
    (state) => state.metronome.bpm,
    (bpm) => {
      slider.valueAsNumber = bpm;
      number.valueAsNumber = bpm;
    },
  );
  store.watch(
    (state) => state.metronome.running,
    (running) => {
      button.classList.toggle('active', running);
      button.textContent = running ? METRONOME_LABEL.running : METRONOME_LABEL.stopped;
    },
  );
}

export interface SoundView {
  /** ブラウザの自動再生制限で音が出せない状態かどうかを表示に反映する */
  setBlocked(blocked: boolean): void;
}

function describeSampleStatus(instrument: InstrumentKey, status: SampleStatus | undefined): string {
  const { label } = INSTRUMENTS[instrument];
  if (status === 'loading') return `Loading ${label} samples…`;
  if (status === 'failed') return `${label}: samples unavailable — using synth`;
  return '';
}

const BLOCKED_MESSAGE = 'Click anywhere on the page to enable sound';

/** 左パネル: 音色の選択と、サンプル音源のロード状況 */
export function mountSoundView(store: AppStore): SoundView {
  const container = byId('instrument-buttons', 'div');
  const status = byId('sound-status', 'div');
  const buttons = new Map<InstrumentKey, HTMLButtonElement>();
  let blocked = false;

  for (const key of INSTRUMENT_KEYS) {
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = INSTRUMENTS[key].label;
    button.addEventListener('click', () => {
      store.dispatch({ type: 'instrumentSelected', instrument: key });
    });
    container.appendChild(button);
    buttons.set(key, button);
  }

  const render = (): void => {
    const { instrument, samples } = store.getState().audio;
    for (const [key, button] of buttons) {
      button.classList.toggle('active', key === instrument);
      button.classList.toggle('loading', samples[key] === 'loading');
    }
    // 表示するのは選択中の音色の状況だけ（別の音色のロード完了で表示が残ったり消えたりしない）
    const text = blocked ? BLOCKED_MESSAGE : describeSampleStatus(instrument, samples[instrument]);
    status.textContent = text;
    status.classList.toggle('hidden', text === '');
  };
  store.watch((state) => state.audio, render);

  return {
    setBlocked(next) {
      blocked = next;
      render();
    },
  };
}
