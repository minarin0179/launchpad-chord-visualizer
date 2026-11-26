import { fromWebMIDI, LaunchpadX, RIGHT_COL_CCS, RIGHT_COL_NOTES, TOP_ROW_CCS } from 'launchpad-x';
import { MIDI_STATE_DEBOUNCE_MS, PROGRAMMER_MODE_DELAY_MS } from '../config/timing';
import { padIndexFromDevice } from '../led/frame';
import { errorMessage, type Logger } from '../platform/logger';
import type { Action } from '../store/actions';
import type { Store } from '../store/create-store';
import type { AppState, MidiAccessStatus } from '../store/state';
import { chooseOutput, matchInput } from './port-selection';

/** Launchpad 本体からの入力 */
export interface DeviceInputHandlers {
  /** メインのパッドを押した（deviceNumber は Launchpad のパッド番号） */
  padDown(padIndex: number, velocity: number, deviceNumber: number): void;
  padUp(deviceNumber: number): void;
  /** 上段ボタン（0 = 左端） */
  topRow(index: number): void;
  /** 右列ボタン（0 = 最上段）。ファームウェアによって CC または Note On で届く */
  rightColumn(index: number, via: 'cc' | 'note'): void;
}

const MIDI_OPTIONS: MIDIOptions = { sysex: true };

/** 権限が無い・拒否されたときに投げられる DOMException の名前 */
const DENIED_ERRORS = new Set(['SecurityError', 'NotAllowedError']);

function classifyAccessError(error: unknown): MidiAccessStatus {
  return error instanceof DOMException && DENIED_ERRORS.has(error.name) ? 'denied' : 'error';
}

/** 接続中の出力ポートと入力ポート */
interface Connection {
  readonly outputId: string;
  readonly inputId: string | null;
  readonly device: LaunchpadX;
}

/**
 * Web MIDI のポートを監視し、選択された出力ポートに Launchpad を接続する。
 * 選択中のポートが実際に変わったときだけ接続し直す（ポートの状態変化のたびに作り直さない）。
 */
export class DeviceManager {
  private access: MIDIAccess | null = null;
  private connection: Connection | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: Store<AppState, Action>,
    private readonly logger: Logger,
    private readonly handlers: DeviceInputHandlers,
  ) {}

  /** 接続中のデバイス（Programmer モードへの切替待ちの間も返す） */
  get device(): LaunchpadX | null {
    return this.connection?.device ?? null;
  }

  /** MIDI へのアクセスを要求してポートの監視を始める（RESCAN でも呼ぶ） */
  async start(): Promise<void> {
    if (!('requestMIDIAccess' in navigator)) {
      this.store.dispatch({ type: 'midiAccessResolved', access: 'unsupported' });
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess(MIDI_OPTIONS);
      // 前回のアクセスオブジェクトの監視は外す（二重に処理しないように）
      if (this.access) this.access.onstatechange = null;
      this.access = access;
      access.onstatechange = () => {
        this.scheduleRefresh();
      };
      this.store.dispatch({ type: 'midiAccessResolved', access: 'granted' });
      this.refreshPorts();
    } catch (error) {
      const message = errorMessage(error);
      this.logger.error(`MIDI access failed: ${message}`);
      this.store.dispatch({
        type: 'midiAccessResolved',
        access: classifyAccessError(error),
        errorMessage: message,
      });
    }
  }

  /** ユーザーが選択欄でポートを選んだ（null = 未選択） */
  selectByUser(outputId: string | null): void {
    this.store.dispatch({ type: 'deviceSelectedByUser', outputId });
    this.reconcile();
  }

  /** ポートを開くだけでも状態変化が何度か通知されるので、少し待ってまとめて処理する */
  private scheduleRefresh(): void {
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.refreshPorts();
    }, MIDI_STATE_DEBOUNCE_MS);
  }

  private connectedOutputs(): MIDIOutput[] {
    return this.access
      ? [...this.access.outputs.values()].filter((port) => port.state === 'connected')
      : [];
  }

  private connectedInputs(): MIDIInput[] {
    return this.access
      ? [...this.access.inputs.values()].filter((port) => port.state === 'connected')
      : [];
  }

  private refreshPorts(): void {
    const outputs = this.connectedOutputs().map((port) => ({
      id: port.id,
      name: port.name ?? port.id,
    }));
    const { midi } = this.store.getState();
    const known = midi.outputs.map((output) => output.id).join('\n');
    if (outputs.map((output) => output.id).join('\n') !== known || midi.access !== 'granted') {
      this.logger.log(
        outputs.length
          ? `MIDI devices: ${outputs.map((o) => o.name).join(', ')}`
          : 'No MIDI devices found',
        outputs.length ? 'out' : 'err',
      );
    }
    const selectedOutputId = chooseOutput(outputs, {
      preferredName: midi.preferredName,
      currentId: midi.selectedOutputId,
    });
    this.store.dispatch({ type: 'midiPortsChanged', outputs, selectedOutputId });
    this.reconcile();
  }

  /** 選択中のポートと実際の接続を一致させる */
  private reconcile(): void {
    const { selectedOutputId } = this.store.getState().midi;
    const output = this.connectedOutputs().find((port) => port.id === selectedOutputId);
    if (!output) {
      this.disconnect();
      return;
    }
    const inputs = this.connectedInputs();
    const match = matchInput(
      { id: output.id, name: output.name ?? '' },
      inputs.map((port) => ({ id: port.id, name: port.name ?? '' })),
    );
    const input = inputs.find((port) => port.id === match?.input.id);
    if (this.connection?.outputId === output.id && this.connection.inputId === (input?.id ?? null))
      return;

    this.disconnect();
    this.logger.out(`Output: "${output.name ?? output.id}"`);
    if (input && match)
      this.logger.out(`Input: "${input.name ?? input.id}" (matched by ${match.strategy})`);
    else this.logger.error('No MIDI input port found — pad presses will not be received');
    this.connect(output, input);
  }

  private connect(output: MIDIOutput, input: MIDIInput | undefined): void {
    const transport = fromWebMIDI(output, input);
    const device = new LaunchpadX(transport.output, transport.input);
    const connection: Connection = { outputId: output.id, inputId: input?.id ?? null, device };
    this.listen(device);
    this.connection = connection;
    this.store.dispatch({ type: 'deviceConnectionChanged', connection: 'connecting' });
    try {
      device.setProgrammerMode();
    } catch (error) {
      this.logger.error(`MIDI send error: ${errorMessage(error)}`);
    }
    // Programmer モードへの切替が済むまで待ってから LED を送り始める
    setTimeout(() => {
      if (this.connection === connection) {
        this.store.dispatch({ type: 'deviceConnectionChanged', connection: 'ready' });
      }
    }, PROGRAMMER_MODE_DELAY_MS);
  }

  private disconnect(): void {
    if (!this.connection) return;
    this.connection.device.destroy();
    this.connection = null;
    this.store.dispatch({ type: 'deviceConnectionChanged', connection: 'none' });
  }

  private listen(device: LaunchpadX): void {
    device.addEventListener('noteOn', (event) => {
      const { pad, velocity } = (event as CustomEvent<{ pad: number; velocity: number }>).detail;
      const rightIndex = (RIGHT_COL_NOTES as readonly number[]).indexOf(pad);
      if (rightIndex >= 0) {
        this.handlers.rightColumn(rightIndex, 'note');
        return;
      }
      const padIndex = padIndexFromDevice(pad);
      if (padIndex !== null) this.handlers.padDown(padIndex, velocity, pad);
    });
    device.addEventListener('noteOff', (event) => {
      const { pad } = (event as CustomEvent<{ pad: number }>).detail;
      if (padIndexFromDevice(pad) !== null) this.handlers.padUp(pad);
    });
    device.addEventListener('controlChange', (event) => {
      const { cc, value } = (event as CustomEvent<{ cc: number; value: number }>).detail;
      const topIndex = (TOP_ROW_CCS as readonly number[]).indexOf(cc);
      if (topIndex >= 0) {
        this.logger.in(`CC IN: CC${cc} val=${value} (top row)`);
        this.handlers.topRow(topIndex);
        return;
      }
      const rightIndex = (RIGHT_COL_CCS as readonly number[]).indexOf(cc);
      if (rightIndex >= 0) this.handlers.rightColumn(rightIndex, 'cc');
      else this.logger.in(`CC IN: CC${cc} val=${value} (unknown)`);
    });
  }
}
