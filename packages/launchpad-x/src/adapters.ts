// ============================================================
// Launchpad X — Platform adapters
// Wrap Web MIDI API or Node.js midi ports into TransportPair
// ============================================================

import type { MIDIOutputPort, MIDIInputPort, TransportPair } from './types.js';

// ============================================================
// Web MIDI API adapter (browser)
// ============================================================

/**
 * Wrap a Web MIDI API MIDIOutput into MIDIOutputPort.
 * Web MIDI's send() already accepts number[], so this is a thin pass-through.
 */
function wrapWebMIDIOutput(output: MIDIOutput): MIDIOutputPort {
  return {
    send(data: number[]) {
      output.send(data);
    },
  };
}

/**
 * Wrap a Web MIDI API MIDIInput into MIDIInputPort.
 * Uses the `onmidimessage` property of MIDIInput.
 */
function wrapWebMIDIInput(input: MIDIInput): MIDIInputPort {
  const handlers = new Set<(data: Uint8Array) => void>();
  input.onmidimessage = (event: MIDIMessageEvent) => {
    if (event.data) for (const h of handlers) h(event.data);
  };
  return {
    addMessageListener(handler) { handlers.add(handler); },
    removeMessageListener(handler) {
      handlers.delete(handler);
      if (handlers.size === 0) input.onmidimessage = null;
    },
  };
}

/**
 * Create a TransportPair from Web MIDI API ports.
 *
 * @example
 * ```ts
 * const access = await navigator.requestMIDIAccess({ sysex: true });
 * const output = [...access.outputs.values()].find(o => o.name.includes('Launchpad'));
 * const input  = [...access.inputs.values()].find(i => i.name.includes('Launchpad'));
 * const transport = fromWebMIDI(output!, input);
 * const device = new LaunchpadX(transport.output, transport.input);
 * ```
 */
export function fromWebMIDI(output: MIDIOutput, input?: MIDIInput): TransportPair {
  return {
    output: wrapWebMIDIOutput(output),
    input:  input ? wrapWebMIDIInput(input) : undefined,
  };
}

// ============================================================
// Node.js adapter (node-midi / easymidi / etc.)
// ============================================================

/** Minimal interface for a Node.js MIDI output object (e.g., node-midi Output) */
export interface NodeMIDIOutput {
  sendMessage(data: number[]): void;
}

/** Minimal interface for a Node.js MIDI input object (e.g., node-midi Input) */
export interface NodeMIDIInput {
  on(event: 'message', handler: (deltaTime: number, data: number[]) => void): void;
  off?(event: 'message', handler: (deltaTime: number, data: number[]) => void): void;
  removeListener?(event: 'message', handler: (deltaTime: number, data: number[]) => void): void;
}

/**
 * Create a TransportPair from node-midi (or compatible) ports.
 *
 * @example
 * ```ts
 * import midi from 'midi';
 * const output = new midi.Output();
 * const input  = new midi.Input();
 * output.openPort(0);
 * input.openPort(0);
 * const transport = fromNodeMidi(output, input);
 * const device = new LaunchpadX(transport.output, transport.input);
 * ```
 */
export function fromNodeMidi(output: NodeMIDIOutput, input?: NodeMIDIInput): TransportPair {
  const wrappedOutput: MIDIOutputPort = {
    send(data: number[]) {
      output.sendMessage(data);
    },
  };

  let wrappedInput: MIDIInputPort | undefined;
  if (input) {
    // Map from our handler wrappers back to the node-midi handler functions
    const handlerMap = new Map<
      (data: Uint8Array) => void,
      (deltaTime: number, data: number[]) => void
    >();

    wrappedInput = {
      addMessageListener(handler) {
        const nodeHandler = (_dt: number, data: number[]) => {
          handler(new Uint8Array(data));
        };
        handlerMap.set(handler, nodeHandler);
        input.on('message', nodeHandler);
      },
      removeMessageListener(handler) {
        const nodeHandler = handlerMap.get(handler);
        if (nodeHandler) {
          (input.off ?? input.removeListener)?.('message', nodeHandler);
          handlerMap.delete(handler);
        }
      },
    };
  }

  return { output: wrappedOutput, input: wrappedInput };
}
