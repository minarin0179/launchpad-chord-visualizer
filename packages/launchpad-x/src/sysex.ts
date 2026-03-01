// ============================================================
// Launchpad X — SysEx message builders
// All functions return number[] ready to pass to MIDIOutput.send()
// Reference: Launchpad X Programmer's Reference Manual
// ============================================================

import {
  SYSEX_HEADER, SYSEX_IDENTITY_REQUEST,
  CMD_LAYOUT, CMD_FADER_SETUP, CMD_VELOCITY_CURVE, CMD_LED_LIGHTING,
  CMD_SCROLL_TEXT, CMD_BRIGHTNESS, CMD_SLEEP, CMD_LED_FEEDBACK,
  CMD_AFTERTOUCH, CMD_FADER_VELOCITY, CMD_LIVE_MODE,
  CMD_DRUM_RACK_MODE, CMD_DAW_MODE, CMD_DAW_STATE_CLEAR,
  CMD_DRUM_RACK_POS, CMD_NOTE_MODE_SEL, CMD_NOTE_MODE_CFG,
  LED_TYPE_STATIC, LED_TYPE_FLASHING, LED_TYPE_PULSING, LED_TYPE_RGB,
  PROGRAMMER_MODE_VALUE, LIVE_MODE_VALUE,
} from './constants.js';
import type { Layout, VelocityCurve, AftertouchType, AftertouchThreshold, FaderOrientation, DrumRackMode, LEDUpdate, ScrollTextOptions, FaderConfig } from './types.js';

// ============================================================
// Helpers
// ============================================================

function header(cmd: number): number[] {
  return [...SYSEX_HEADER, cmd];
}

function sysex(...payload: number[]): number[] {
  return [...SYSEX_HEADER, ...payload, 0xF7];
}

// ============================================================
// Identity
// ============================================================

export function buildIdentityRequest(): number[] {
  return [...SYSEX_IDENTITY_REQUEST];
}

// ============================================================
// Layout / Mode
// ============================================================

export function buildLayoutSelect(layout: Layout): number[] {
  return sysex(CMD_LAYOUT, layout);
}

export function buildProgrammerMode(): number[] {
  return sysex(CMD_LIVE_MODE, PROGRAMMER_MODE_VALUE);
}

export function buildLiveMode(): number[] {
  return sysex(CMD_LIVE_MODE, LIVE_MODE_VALUE);
}

// ============================================================
// LED lighting
// ============================================================

/**
 * Build a bulk RGB SysEx message from an array of LEDUpdate descriptors.
 * All updates are packed into a single SysEx message (max 81 entries).
 */
export function buildLEDUpdate(updates: LEDUpdate[]): number[] {
  const msg = header(CMD_LED_LIGHTING);
  for (const u of updates) {
    switch (u.type) {
      case 'static':
        msg.push(LED_TYPE_STATIC, u.pad, u.color);
        break;
      case 'rgb':
        msg.push(LED_TYPE_RGB, u.pad, u.r, u.g, u.b);
        break;
      case 'flashing':
        msg.push(LED_TYPE_FLASHING, u.pad, u.colorA, u.colorB);
        break;
      case 'pulsing':
        msg.push(LED_TYPE_PULSING, u.pad, u.color);
        break;
    }
  }
  msg.push(0xF7);
  return msg;
}

/** Build a single-pad static palette color message. */
export function buildPadPalette(pad: number, color: number): number[] {
  return sysex(CMD_LED_LIGHTING, LED_TYPE_STATIC, pad, color);
}

/** Build a single-pad RGB color message. */
export function buildPadRGB(pad: number, r: number, g: number, b: number): number[] {
  return sysex(CMD_LED_LIGHTING, LED_TYPE_RGB, pad, r, g, b);
}

/** Build a single-pad flashing color message. */
export function buildPadFlashing(pad: number, colorA: number, colorB: number): number[] {
  return sysex(CMD_LED_LIGHTING, LED_TYPE_FLASHING, pad, colorA, colorB);
}

/** Build a single-pad pulsing color message. */
export function buildPadPulsing(pad: number, color: number): number[] {
  return sysex(CMD_LED_LIGHTING, LED_TYPE_PULSING, pad, color);
}

// ============================================================
// Text scrolling
// ============================================================

/**
 * Build a text-scroll SysEx message.
 * Pass an empty string (or call buildScrollStop) to stop scrolling.
 */
export function buildScrollText(text: string, options: ScrollTextOptions = {}): number[] {
  const { loop = false, speed = 0x18, rgb, palette } = options;
  const msg = header(CMD_SCROLL_TEXT);
  msg.push(loop ? 1 : 0);
  msg.push(speed & 0x7F);
  if (palette !== undefined) {
    msg.push(0x00, palette);
  } else if (rgb) {
    msg.push(0x01, rgb[0], rgb[1], rgb[2]);
  } else {
    msg.push(0x00, 0x03); // default: red palette
  }
  for (let i = 0; i < text.length; i++) {
    msg.push(text.charCodeAt(i) & 0x7F);
  }
  msg.push(0xF7);
  return msg;
}

/** Build a message to stop text scrolling. */
export function buildScrollStop(): number[] {
  return sysex(CMD_SCROLL_TEXT);
}

// ============================================================
// Configuration
// ============================================================

export function buildBrightness(level: number): number[] {
  return sysex(CMD_BRIGHTNESS, Math.max(0, Math.min(127, level)));
}

/** Enable (1) or disable (0) LED output (sleep mode). */
export function buildSleep(on: boolean): number[] {
  return sysex(CMD_SLEEP, on ? 1 : 0);
}

/**
 * Configure LED feedback (internal note-on echoing to the grid).
 * @param internal Whether to echo internal MIDI to LEDs
 * @param external Whether to echo external MIDI to LEDs
 */
export function buildLEDFeedback(internal: boolean, external: boolean): number[] {
  return sysex(CMD_LED_FEEDBACK, internal ? 1 : 0, external ? 1 : 0);
}

/**
 * Set the velocity curve.
 * @param curve VelocityCurve enum value
 * @param fixedVelocity Used when curve is Fixed (default 0x7F)
 */
export function buildVelocityCurve(curve: VelocityCurve, fixedVelocity = 0x7F): number[] {
  return sysex(CMD_VELOCITY_CURVE, curve, fixedVelocity);
}

/**
 * Configure aftertouch.
 * @param type AftertouchType enum value
 * @param threshold AftertouchThreshold enum value (default Medium)
 */
export function buildAftertouch(type: AftertouchType, threshold: AftertouchThreshold = 1): number[] {
  return sysex(CMD_AFTERTOUCH, type, threshold);
}

/** Enable or disable fader velocity sensitivity. */
export function buildFaderVelocity(enabled: boolean): number[] {
  return sysex(CMD_FADER_VELOCITY, enabled ? 1 : 0);
}

// ============================================================
// DAW mode
// ============================================================

export function buildDAWMode(enabled: boolean): number[] {
  return sysex(CMD_DAW_MODE, enabled ? 1 : 0);
}

/**
 * Configure up to 8 DAW faders.
 * @param faders Array of FaderConfig (1–8 entries)
 * @param orientation FaderOrientation enum (Vertical=0, Horizontal=1)
 */
export function buildFaderSetup(faders: FaderConfig[], orientation: FaderOrientation): number[] {
  const msg = header(CMD_FADER_SETUP);
  msg.push(0x00, orientation);
  for (const f of faders) {
    const faderType = f.type === 'bipolar' ? 1 : 0;
    msg.push(f.index, faderType, f.cc, f.color);
  }
  msg.push(0xF7);
  return msg;
}

/** Set Drum Rack mode (note mode / simple / intelligent). */
export function buildDrumRackMode(mode: DrumRackMode): number[] {
  return sysex(CMD_DRUM_RACK_MODE, mode);
}

/**
 * Set Intelligent Drum Rack scroll position.
 * @param position Lower-left pad index (0–64)
 */
export function buildDrumRackPosition(position: number): number[] {
  return sysex(CMD_DRUM_RACK_POS, Math.max(0, Math.min(64, position)));
}

/**
 * Clear DAW state.
 * @param session Clear session layout state
 * @param drumRack Clear drum rack state
 * @param controlChanges Clear CC state
 */
export function buildDAWStateClear(session: boolean, drumRack: boolean, controlChanges: boolean): number[] {
  return sysex(CMD_DAW_STATE_CLEAR, session ? 1 : 0, drumRack ? 1 : 0, controlChanges ? 1 : 0);
}

/** Select Note mode type (chromatic or scale). */
export function buildNoteModeSelect(chromatic: boolean): number[] {
  return sysex(CMD_NOTE_MODE_SEL, chromatic ? 0 : 1);
}

/**
 * Full Note mode configuration.
 * @param chromatic true = chromatic, false = scale mode
 * @param params Raw parameter bytes (octave, transposition, MIDI ch, width, scale_type, scale_def…)
 */
export function buildNoteModeConfig(chromatic: boolean, params: number[]): number[] {
  return sysex(CMD_NOTE_MODE_CFG, chromatic ? 0 : 1, ...params);
}
