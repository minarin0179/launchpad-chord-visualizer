/** Web MIDI のテスト用の偽物（送信された SysEx を記録し、入力メッセージを注入できる） */
export class FakeMidiOutput extends EventTarget {
  readonly sent: number[][] = [];
  state: MIDIPortDeviceState = 'connected';

  constructor(
    readonly id: string,
    readonly name: string,
  ) {
    super();
  }

  send(data: Iterable<number>): void {
    this.sent.push([...data]);
  }
}

export class FakeMidiInput extends EventTarget {
  state: MIDIPortDeviceState = 'connected';
  opened = 0;

  constructor(
    readonly id: string,
    readonly name: string,
  ) {
    super();
  }

  open(): Promise<this> {
    this.opened++;
    return Promise.resolve(this);
  }

  /** デバイスからメッセージが届いたことにする */
  receive(...bytes: number[]): void {
    const event = new Event('midimessage') as Event & { data: Uint8Array };
    event.data = Uint8Array.from(bytes);
    this.dispatchEvent(event);
  }
}

export class FakeMidiAccess {
  onstatechange: (() => void) | null = null;
  readonly outputs = new Map<string, FakeMidiOutput>();
  readonly inputs = new Map<string, FakeMidiInput>();

  add(output: FakeMidiOutput, input: FakeMidiInput): void {
    this.outputs.set(output.id, output);
    this.inputs.set(input.id, input);
  }

  remove(output: FakeMidiOutput, input: FakeMidiInput): void {
    this.outputs.delete(output.id);
    this.inputs.delete(input.id);
  }
}

/** LED SysEx（F0 00 20 29 02 0C 03 [03 pad r g b]... F7）を { パッド番号: [r, g, b] } に分解する */
export function parseLedSysex(
  message: readonly number[],
): Map<number, [number, number, number]> | null {
  const header = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x03];
  if (!header.every((byte, i) => message[i] === byte)) return null;
  const leds = new Map<number, [number, number, number]>();
  for (let i = header.length; i + 4 < message.length; i += 5) {
    leds.set(message[i + 1], [message[i + 2], message[i + 3], message[i + 4]]);
  }
  return leds;
}

export const PROGRAMMER_MODE_SYSEX = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, 0x01, 0xf7];
