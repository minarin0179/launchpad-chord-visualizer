// ============================================================
// Launchpad X — Main device class
// ============================================================

import type {
  MIDIOutputPort, MIDIInputPort,
  RGB, PaletteIndex, LEDUpdate,
  ScrollTextOptions, FaderConfig, FaderOrientation, DeviceInfo,
  Layout, VelocityCurve, AftertouchType, AftertouchThreshold, DrumRackMode,
  NoteOnDetail, NoteOffDetail, CCDetail, SysExDetail,
} from './types.js';
import {
  padNumber, isGridPad, isTopRowCC, isRightColumnCC, isRightColumnNote,
  TOP_ROW_CCS, RIGHT_COL_CCS, LOGO_PAD,
} from './constants.js';
import {
  buildIdentityRequest, buildLayoutSelect, buildProgrammerMode, buildLiveMode,
  buildLEDUpdate, buildPadRGB, buildPadPalette, buildPadFlashing, buildPadPulsing,
  buildScrollText, buildScrollStop,
  buildBrightness, buildSleep, buildLEDFeedback,
  buildVelocityCurve, buildAftertouch, buildFaderVelocity,
  buildDAWMode, buildFaderSetup, buildDrumRackMode, buildDrumRackPosition,
  buildDAWStateClear, buildNoteModeSelect, buildNoteModeConfig,
} from './sysex.js';

// ============================================================
// Identity response parser
// ============================================================

/** Parse a Universal Device Inquiry SysEx response into DeviceInfo. */
function parseIdentityResponse(data: number[]): DeviceInfo | null {
  // Expected: F0 7E 00 06 02 00 20 29 <deviceId> 00 00 <v0 v1 v2 v3> F7
  if (data.length < 15) return null;
  if (data[0] !== 0xF0 || data[1] !== 0x7E || data[3] !== 0x06 || data[4] !== 0x02) return null;
  const manufacturer = [data[5], data[6], data[7]];
  const deviceId     = data[8];
  const isBootloader = deviceId === 0x11;
  const appVersion: [number, number, number, number] = [data[11], data[12], data[13], data[14]];
  return { manufacturer, deviceId, appVersion, isBootloader };
}

// ============================================================
// LaunchpadX class
// ============================================================

export class LaunchpadX extends EventTarget {
  private readonly _output: MIDIOutputPort;
  private readonly _input: MIDIInputPort | undefined;
  private readonly _midiHandler: (data: Uint8Array) => void;

  constructor(output: MIDIOutputPort, input?: MIDIInputPort) {
    super();
    this._output = output;
    this._input  = input;

    this._midiHandler = (data: Uint8Array) => this._handleMIDI(data);
    input?.addMessageListener(this._midiHandler);
  }

  /** Detach the MIDI input listener. Call when you no longer need the device. */
  destroy(): void {
    this._input?.removeMessageListener(this._midiHandler);
  }

  // ----------------------------------------------------------
  // Raw send
  // ----------------------------------------------------------

  private _send(data: number[]): void {
    this._output.send(data);
  }

  // ----------------------------------------------------------
  // Mode selection
  // ----------------------------------------------------------

  setLayout(layout: Layout): void {
    this._send(buildLayoutSelect(layout));
  }

  /** Switch to Programmer mode (layout 0x7F). */
  setProgrammerMode(): void {
    this._send(buildProgrammerMode());
  }

  /** Switch to Live mode (Note mode). */
  setLiveMode(): void {
    this._send(buildLiveMode());
  }

  // ----------------------------------------------------------
  // LED control — single pad
  // ----------------------------------------------------------

  /**
   * Set a pad to a direct RGB color.
   * @param pad  Pad number (11–88 for grid, 91–98 top row, 99 logo)
   * @param r    Red   0–127
   * @param g    Green 0–127
   * @param b    Blue  0–127
   */
  setRGB(pad: number, r: number, g: number, b: number): void {
    this._send(buildPadRGB(pad, r, g, b));
  }

  /**
   * Set a pad to a palette color.
   * @param pad   Pad number
   * @param color Palette index 0–127
   */
  setPalette(pad: number, color: PaletteIndex): void {
    this._send(buildPadPalette(pad, color));
  }

  /**
   * Set a pad to flash between two palette colors.
   * Synchronized to MIDI beat clock (or 120 BPM by default).
   * @param colorA Static/base color (palette index)
   * @param colorB Flash-to color (palette index)
   */
  setFlashing(pad: number, colorA: PaletteIndex, colorB: PaletteIndex): void {
    this._send(buildPadFlashing(pad, colorA, colorB));
  }

  /**
   * Set a pad to pulse between dark and full intensity.
   * Synchronized to MIDI beat clock, period = 2 beats.
   * @param color Palette index
   */
  setPulsing(pad: number, color: PaletteIndex): void {
    this._send(buildPadPulsing(pad, color));
  }

  // ----------------------------------------------------------
  // LED control — batch
  // ----------------------------------------------------------

  /**
   * Send multiple LED updates in a single SysEx message (max 81 entries).
   * Mix of static palette, RGB, flashing, and pulsing updates is allowed.
   */
  sendLEDs(updates: LEDUpdate[]): void {
    if (updates.length === 0) return;
    this._send(buildLEDUpdate(updates));
  }

  /**
   * Turn off all LEDs (including top-row, right-column, and logo buttons).
   * Sends a bulk SysEx with all 89 addressable LEDs set to off (RGB 0,0,0).
   */
  clearAll(): void {
    const updates: LEDUpdate[] = [];
    // 8x8 grid
    for (let row = 1; row <= 8; row++) {
      for (let col = 1; col <= 8; col++) {
        updates.push({ type: 'rgb', pad: padNumber(row, col), r: 0, g: 0, b: 0 });
      }
    }
    // Top row CCs (91–98)
    for (const cc of TOP_ROW_CCS) {
      updates.push({ type: 'rgb', pad: cc, r: 0, g: 0, b: 0 });
    }
    // Right column CCs (89, 79, …, 19)
    for (const cc of RIGHT_COL_CCS) {
      updates.push({ type: 'rgb', pad: cc, r: 0, g: 0, b: 0 });
    }
    // Logo
    updates.push({ type: 'rgb', pad: LOGO_PAD, r: 0, g: 0, b: 0 });
    this._send(buildLEDUpdate(updates));
  }

  // ----------------------------------------------------------
  // Text scrolling
  // ----------------------------------------------------------

  /** Scroll text across the grid. */
  scrollText(text: string, options?: ScrollTextOptions): void {
    this._send(buildScrollText(text, options));
  }

  /** Stop text scrolling immediately. */
  stopScrollText(): void {
    this._send(buildScrollStop());
  }

  // ----------------------------------------------------------
  // Configuration
  // ----------------------------------------------------------

  /** Set the overall LED brightness (0–127). */
  setBrightness(level: number): void {
    this._send(buildBrightness(level));
  }

  /** Turn LED output on or off (power-saving sleep). */
  setPower(on: boolean): void {
    this._send(buildSleep(on));
  }

  /**
   * Configure LED feedback.
   * Controls whether incoming MIDI notes illuminate grid LEDs automatically.
   */
  setLEDFeedback(internal: boolean, external: boolean): void {
    this._send(buildLEDFeedback(internal, external));
  }

  /** Configure velocity curve. */
  setVelocityCurve(curve: VelocityCurve, fixedVelocity?: number): void {
    this._send(buildVelocityCurve(curve, fixedVelocity));
  }

  /** Configure aftertouch type and sensitivity threshold. */
  setAftertouch(type: AftertouchType, threshold?: AftertouchThreshold): void {
    this._send(buildAftertouch(type, threshold));
  }

  /** Enable or disable fader velocity. */
  setFaderVelocity(enabled: boolean): void {
    this._send(buildFaderVelocity(enabled));
  }

  // ----------------------------------------------------------
  // DAW mode
  // ----------------------------------------------------------

  /** Enable or disable DAW mode (clears all DAW state on disable). */
  setDAWMode(enabled: boolean): void {
    this._send(buildDAWMode(enabled));
  }

  /** Configure DAW faders. */
  setupFaders(faders: FaderConfig[], orientation: FaderOrientation = 0 /* Vertical */): void {
    this._send(buildFaderSetup(faders, orientation));
  }

  /** Set Drum Rack mode. */
  setDrumRackMode(mode: DrumRackMode): void {
    this._send(buildDrumRackMode(mode));
  }

  /** Set Intelligent Drum Rack scroll position (0–64). */
  setDrumRackPosition(position: number): void {
    this._send(buildDrumRackPosition(position));
  }

  /** Clear DAW session, drum rack, or CC state. */
  clearDAWState(session: boolean, drumRack: boolean, controlChanges: boolean): void {
    this._send(buildDAWStateClear(session, drumRack, controlChanges));
  }

  // ----------------------------------------------------------
  // Note mode
  // ----------------------------------------------------------

  /** Switch Note mode between chromatic and scale. */
  setNoteModeType(chromatic: boolean): void {
    this._send(buildNoteModeSelect(chromatic));
  }

  /** Full Note mode configuration. */
  setNoteModeConfig(chromatic: boolean, params: number[]): void {
    this._send(buildNoteModeConfig(chromatic, params));
  }

  // ----------------------------------------------------------
  // Device identity
  // ----------------------------------------------------------

  /**
   * Send a Universal Device Inquiry and resolve with the parsed DeviceInfo.
   * Rejects if no response is received within 2 seconds.
   */
  queryIdentity(): Promise<DeviceInfo> {
    return new Promise((resolve, reject) => {
      if (!this._input) {
        reject(new Error('No MIDI input configured'));
        return;
      }
      const timer = setTimeout(() => {
        this._input?.removeMessageListener(handler);
        reject(new Error('Identity query timed out'));
      }, 2000);

      const handler = (data: Uint8Array) => {
        const info = parseIdentityResponse(Array.from(data));
        if (info) {
          clearTimeout(timer);
          this._input?.removeMessageListener(handler);
          resolve(info);
        }
      };
      this._input.addMessageListener(handler);
      this._send(buildIdentityRequest());
    });
  }

  // ----------------------------------------------------------
  // MIDI input handling
  // ----------------------------------------------------------

  private _handleMIDI(data: Uint8Array): void {
    if (data.length < 2) return;
    const status = data[0];
    const data1  = data[1];
    const data2  = data[2] ?? 0;

    // SysEx (may be identity response)
    if (status === 0xF0) {
      this.dispatchEvent(new CustomEvent<SysExDetail>('sysex', {
        detail: { data: Array.from(data) },
      }));
      return;
    }

    const type = status & 0xF0;

    // CC (top row / right column)
    if (type === 0xB0 && data2 > 0) {
      this.dispatchEvent(new CustomEvent<CCDetail>('controlChange', {
        detail: { cc: data1, value: data2 },
      }));
      return;
    }

    // Note Off
    if (type === 0x80 || (type === 0x90 && data2 === 0)) {
      this.dispatchEvent(new CustomEvent<NoteOffDetail>('noteOff', {
        detail: { pad: data1 },
      }));
      return;
    }

    // Note On
    if (type === 0x90 && data2 > 0) {
      this.dispatchEvent(new CustomEvent<NoteOnDetail>('noteOn', {
        detail: { pad: data1, velocity: data2 },
      }));
      return;
    }
  }

  // ----------------------------------------------------------
  // Static pad utilities (re-exported from constants for convenience)
  // ----------------------------------------------------------

  /** Convert 1-indexed (row, col) to Launchpad X pad number. */
  static padNumber = padNumber;

  /** Returns true if pad is one of the 64 main grid pads. */
  static isGridPad = isGridPad;

  /** Returns true if cc is a top-row CC number (91–98). */
  static isTopRowCC = isTopRowCC;

  /** Returns true if cc is a right-column CC number (19, 29, …, 89). */
  static isRightColumnCC = isRightColumnCC;

  /** Returns true if note is a right-column note (firmware fallback). */
  static isRightColumnNote = isRightColumnNote;
}
