// ============================================================
// Launchpad X — Public API
// ============================================================

// Main class
export { LaunchpadX } from './LaunchpadX.js';

// Types
export type {
  RGB,
  PaletteIndex,
  LEDUpdate,
  ScrollTextOptions,
  FaderConfig,
  DeviceInfo,
  MIDIOutputPort,
  MIDIInputPort,
  TransportPair,
  NoteOnDetail,
  NoteOffDetail,
  CCDetail,
  SysExDetail,
  LaunchpadXEventMap,
} from './types.js';

// Enums / const enums
export { Layout, VelocityCurve, AftertouchType, AftertouchThreshold, FaderOrientation, DrumRackMode } from './types.js';

// Platform adapters
export { fromWebMIDI, fromNodeMidi } from './adapters.js';
export type { NodeMIDIOutput, NodeMIDIInput } from './adapters.js';

// Pad layout constants and helpers (useful for app code)
export {
  SYSEX_HEADER,
  LOGO_PAD,
  TOP_ROW_CCS,
  RIGHT_COL_CCS,
  RIGHT_COL_NOTES,
  GRID_PAD_NUMBERS,
  padNumber,
  isGridPad,
  isTopRowCC,
  isRightColumnCC,
  isRightColumnNote,
} from './constants.js';

// Low-level SysEx builders (for advanced use)
export {
  buildIdentityRequest,
  buildLayoutSelect,
  buildProgrammerMode,
  buildLiveMode,
  buildLEDUpdate,
  buildPadRGB,
  buildPadPalette,
  buildPadFlashing,
  buildPadPulsing,
  buildScrollText,
  buildScrollStop,
  buildBrightness,
  buildSleep,
  buildLEDFeedback,
  buildVelocityCurve,
  buildAftertouch,
  buildFaderVelocity,
  buildDAWMode,
  buildFaderSetup,
  buildDrumRackMode,
  buildDrumRackPosition,
  buildDAWStateClear,
  buildNoteModeSelect,
  buildNoteModeConfig,
} from './sysex.js';
