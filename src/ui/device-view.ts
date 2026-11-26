import { byId, createOption } from '../platform/dom';
import type { MidiState } from '../store/state';
import type { AppStore } from './context';

export interface DeviceViewDeps {
  readonly store: AppStore;
  readonly onSelect: (outputId: string | null) => void;
  readonly onRescan: () => void;
  readonly onSend: () => void;
  readonly onClear: () => void;
}

type StatusKind = 'connected' | 'disconnected' | 'searching';

interface Status {
  readonly text: string;
  readonly kind: StatusKind;
  /** 対処方法の説明（複数行）。不要なら空 */
  readonly hint: readonly string[];
}

const NO_DEVICE_HINT = [
  'No MIDI devices found. Please check:',
  '· Another app (e.g. Ableton Live) may be holding the MIDI port exclusively (Windows)',
  '· Verify the USB cable is properly connected',
  '· Close other apps and press RESCAN',
];
const DENIED_HINT = [
  'MIDI access was denied. Check the lock icon in the address bar to allow MIDI permission.',
];
const NONE_OPTION_LABEL = '-- Select device --';

/** MIDI の状態から、ステータス表示の内容を決める */
export function describeMidiStatus(midi: MidiState): Status {
  switch (midi.access) {
    case 'pending':
      return { text: 'Searching for MIDI...', kind: 'searching', hint: [] };
    case 'unsupported':
      return { text: 'WebMIDI not supported (Chrome recommended)', kind: 'disconnected', hint: [] };
    case 'denied':
      return { text: 'MIDI access denied', kind: 'disconnected', hint: DENIED_HINT };
    case 'error':
      return {
        text: `MIDI error: ${midi.errorMessage ?? 'unknown'}`,
        kind: 'disconnected',
        hint: [],
      };
    case 'granted':
      break;
  }
  const count = midi.outputs.length;
  if (count === 0)
    return { text: 'No device — press RESCAN', kind: 'disconnected', hint: NO_DEVICE_HINT };
  const selected = midi.outputs.find((output) => output.id === midi.selectedOutputId);
  if (!selected || midi.connection === 'none') {
    return {
      text: `${count} device${count > 1 ? 's' : ''} found — none selected`,
      kind: 'searching',
      hint: [],
    };
  }
  return midi.connection === 'ready'
    ? { text: `Connected: ${selected.name}`, kind: 'connected', hint: [] }
    : { text: `Connecting: ${selected.name}…`, kind: 'searching', hint: [] };
}

/** 左パネル: デバイス選択 / RESCAN / SEND / CLEAR と、画面上部の MIDI ステータス */
export function mountDeviceView({
  store,
  onSelect,
  onRescan,
  onSend,
  onClear,
}: DeviceViewDeps): void {
  const select = byId('device-select', 'select');
  const status = byId('midi-status', 'div');
  const hint = byId('midi-hint', 'div');
  const send = byId('send-btn', 'button');
  const clear = byId('clear-btn', 'button');

  select.addEventListener('change', () => {
    onSelect(select.value || null);
  });
  byId('rescan-btn', 'button').addEventListener('click', onRescan);
  send.addEventListener('click', onSend);
  clear.addEventListener('click', onClear);

  store.watch(
    (state) => state.midi,
    (midi) => {
      select.replaceChildren(
        createOption(NONE_OPTION_LABEL, ''),
        ...midi.outputs.map((output) => createOption(output.name, output.id)),
      );
      select.value = midi.selectedOutputId ?? '';

      const described = describeMidiStatus(midi);
      status.textContent = described.text;
      status.className = described.kind;
      hint.replaceChildren(
        ...described.hint.flatMap((line, i) =>
          i === 0 ? [line] : [document.createElement('br'), line],
        ),
      );
      hint.classList.toggle('hidden', described.hint.length === 0);

      const ready = midi.connection === 'ready';
      send.disabled = !ready;
      clear.disabled = !ready;
    },
  );
}
