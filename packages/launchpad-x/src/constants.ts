// ============================================================
// Launchpad X — Hardware constants
// Reference: Launchpad X Programmer's Reference Manual
// ============================================================

// ============================================================
// SysEx
// ============================================================

/** Manufacturer SysEx header for all Launchpad X commands */
export const SYSEX_HEADER = [0xF0, 0x00, 0x20, 0x29, 0x02, 0x0C] as const;

/** Universal Device Inquiry request (identity) */
export const SYSEX_IDENTITY_REQUEST = [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7] as const;

/** Manufacturer bytes in the identity response (Focusrite / Novation) */
export const MANUFACTURER_ID = [0x00, 0x20, 0x29] as const;

/** Device family code for Launchpad X application firmware */
export const DEVICE_FAMILY_APP  = 0x13;
/** Device family code for Launchpad X bootloader */
export const DEVICE_FAMILY_BOOT = 0x1113;

// ============================================================
// SysEx command bytes (byte after the 6-byte header)
// ============================================================

/** Layout selection (0x00): set active layout */
export const CMD_LAYOUT          = 0x00;
/** DAW Fader setup (0x01) */
export const CMD_FADER_SETUP     = 0x01;
/** Velocity curve configuration (0x04) */
export const CMD_VELOCITY_CURVE  = 0x04;
/** RGB LED lighting (0x03): static, flashing, pulsing, or direct RGB */
export const CMD_LED_LIGHTING    = 0x03;
/** Text scrolling (0x07) */
export const CMD_SCROLL_TEXT     = 0x07;
/** Brightness (0x08) */
export const CMD_BRIGHTNESS      = 0x08;
/** Sleep/LED power (0x09) */
export const CMD_SLEEP           = 0x09;
/** LED feedback enable (0x0A) */
export const CMD_LED_FEEDBACK    = 0x0A;
/** Aftertouch configuration (0x0B) */
export const CMD_AFTERTOUCH      = 0x0B;
/** Fader velocity toggle (0x0D) */
export const CMD_FADER_VELOCITY  = 0x0D;
/** Programmer/Live mode switch (0x0E) */
export const CMD_LIVE_MODE       = 0x0E;
/** DAW Drum Rack mode (0x0F) */
export const CMD_DRUM_RACK_MODE  = 0x0F;
/** DAW mode enable/disable (0x10) */
export const CMD_DAW_MODE        = 0x10;
/** DAW state clear (0x12) */
export const CMD_DAW_STATE_CLEAR = 0x12;
/** Intelligent Drum Rack position (0x13) */
export const CMD_DRUM_RACK_POS   = 0x13;
/** Note mode selection (0x15) */
export const CMD_NOTE_MODE_SEL   = 0x15;
/** Note mode full configuration (0x16) */
export const CMD_NOTE_MODE_CFG   = 0x16;

// ============================================================
// LED colourspec type bytes (first byte of each colourspec entry)
// ============================================================

/** Static palette color */
export const LED_TYPE_STATIC   = 0x00;
/** Flashing between two palette colors (A=static, B=flash target) */
export const LED_TYPE_FLASHING = 0x01;
/** Pulsing palette color */
export const LED_TYPE_PULSING  = 0x02;
/** Direct RGB color (r, g, b each 0–127) */
export const LED_TYPE_RGB      = 0x03;

// ============================================================
// Live / Programmer mode values
// ============================================================
export const LIVE_MODE_VALUE       = 0x00;
export const PROGRAMMER_MODE_VALUE = 0x01;

// ============================================================
// Pad layout — Programmer mode
// ============================================================

/** Logo button pad number (LED only, no MIDI input) */
export const LOGO_PAD = 99;

/** Top-row CC numbers, left to right (CC 91–98) */
export const TOP_ROW_CCS = [91, 92, 93, 94, 95, 96, 97, 98] as const;

/** Right-column CC numbers, top to bottom (CC 89, 79, …, 19) */
export const RIGHT_COL_CCS = [89, 79, 69, 59, 49, 39, 29, 19] as const;

/**
 * Right-column note numbers when the device sends Note On instead of CC
 * (some firmware versions). Same values as RIGHT_COL_CCS.
 */
export const RIGHT_COL_NOTES = RIGHT_COL_CCS;

/** All grid pad numbers (11–88, row*10+col, 1-indexed) */
export const GRID_PAD_NUMBERS: readonly number[] = (() => {
  const nums: number[] = [];
  for (let row = 1; row <= 8; row++) {
    for (let col = 1; col <= 8; col++) {
      nums.push(row * 10 + col);
    }
  }
  return nums;
})();

// ============================================================
// Pad helpers
// ============================================================

/**
 * Convert 1-indexed (row, col) to Launchpad X pad number (Programmer mode).
 * row 1 = bottom row, row 8 = top row.
 * col 1 = leftmost, col 8 = rightmost.
 */
export function padNumber(row: number, col: number): number {
  return row * 10 + col;
}

/** Returns true if `pad` is one of the 64 main grid pads (11–88). */
export function isGridPad(pad: number): boolean {
  const row = Math.floor(pad / 10);
  const col = pad % 10;
  return row >= 1 && row <= 8 && col >= 1 && col <= 8;
}

/** Returns true if `cc` is a top-row CC number (91–98). */
export function isTopRowCC(cc: number): boolean {
  return cc >= 91 && cc <= 98;
}

/** Returns true if `cc` is a right-column CC number (19, 29, …, 89). */
export function isRightColumnCC(cc: number): boolean {
  return RIGHT_COL_CCS.includes(cc as typeof RIGHT_COL_CCS[number]);
}

/**
 * Returns true if `note` is a right-column note number.
 * Some firmware versions send Note On instead of CC for the right column.
 */
export function isRightColumnNote(note: number): boolean {
  return RIGHT_COL_NOTES.includes(note as typeof RIGHT_COL_NOTES[number]);
}
