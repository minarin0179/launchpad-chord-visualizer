// ============================================================
// Launchpad X — Type definitions
// Reference: Launchpad X Programmer's Reference Manual
// ============================================================

/** RGB color, each channel 0–127 (Launchpad X uses 7-bit range) */
export type RGB = [number, number, number];

/** Palette color index 0–127 */
export type PaletteIndex = number;

// ============================================================
// Layout selection (SysEx command 0x00)
// ============================================================
export const enum Layout {
  Session     = 0x00, // DAW mode only
  NoteMode    = 0x01,
  CustomMode1 = 0x04, // Drum Rack
  CustomMode2 = 0x05, // Keys
  CustomMode3 = 0x06, // Lighting Drum Rack
  CustomMode4 = 0x07, // Lighting Session
  DAWFaders   = 0x0D, // DAW mode only
  Programmer  = 0x7F,
}

// ============================================================
// Configuration enums
// ============================================================
export const enum VelocityCurve {
  Low    = 0,
  Medium = 1,
  High   = 2,
  Fixed  = 3,
}

export const enum AftertouchType {
  Polyphonic = 0,
  Channel    = 1,
  Off        = 2,
}

export const enum AftertouchThreshold {
  Low    = 0,
  Medium = 1,
  High   = 2,
}

export const enum FaderOrientation {
  Vertical   = 0,
  Horizontal = 1,
}

export const enum DrumRackMode {
  NoteMode             = 0,
  SimpleDrumRack       = 1,
  IntelligentDrumRack  = 2,
}

// ============================================================
// LED update descriptor (for sendLEDs batch API)
// ============================================================
export type LEDUpdate =
  | { type: 'static';   pad: number; color: PaletteIndex }
  | { type: 'rgb';      pad: number; r: number; g: number; b: number }
  | { type: 'flashing'; pad: number; colorA: PaletteIndex; colorB: PaletteIndex }
  | { type: 'pulsing';  pad: number; color: PaletteIndex };

// ============================================================
// scrollText options
// ============================================================
export interface ScrollTextOptions {
  /** Loop the text. Default: false */
  loop?: boolean;
  /**
   * Scroll speed in pads/second.
   * Positive = right-to-left (default direction).
   * Negative values produce left-to-right scroll.
   * Default: 0x18 (24 pads/s).
   */
  speed?: number;
  /** Use RGB color for the text */
  rgb?: RGB;
  /** Use palette index for the text (takes precedence over rgb if both given) */
  palette?: PaletteIndex;
}

// ============================================================
// DAW Fader configuration
// ============================================================
export interface FaderConfig {
  /** Fader index 0–7 */
  index: number;
  type: 'unipolar' | 'bipolar';
  /** CC number sent when fader moves */
  cc: number;
  /** LED color (palette index) */
  color: PaletteIndex;
}

// ============================================================
// Universal Device Inquiry response
// ============================================================
export interface DeviceInfo {
  /** Manufacturer ID bytes */
  manufacturer: number[];
  /** Device family code */
  deviceId: number;
  /** Application firmware version (4 digits) */
  appVersion: [number, number, number, number];
  /** true if the device is in bootloader mode */
  isBootloader: boolean;
}

// ============================================================
// Platform-agnostic MIDI transport
// ============================================================
export interface MIDIOutputPort {
  send(data: number[]): void;
}

export interface MIDIInputPort {
  addMessageListener(handler: (data: Uint8Array) => void): void;
  removeMessageListener(handler: (data: Uint8Array) => void): void;
}

export interface TransportPair {
  output: MIDIOutputPort;
  input?: MIDIInputPort;
}

// ============================================================
// Events dispatched by LaunchpadX (CustomEvent detail types)
// ============================================================
export interface NoteOnDetail   { pad: number; velocity: number }
export interface NoteOffDetail  { pad: number }
export interface CCDetail       { cc: number; value: number }
export interface SysExDetail    { data: number[] }

export interface LaunchpadXEventMap {
  noteOn:        CustomEvent<NoteOnDetail>;
  noteOff:       CustomEvent<NoteOffDetail>;
  controlChange: CustomEvent<CCDetail>;
  sysex:         CustomEvent<SysExDetail>;
}
