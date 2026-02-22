import { COLORS, TOP_ROW_CCS, RIGHT_COL_NOTES } from './constants.js';
import { state, pads } from './state.js';
import { getChordPitchClasses, getScalePitchClasses } from './music.js';
import { log } from './logger.js';

// =====================
// Programmer Mode
// =====================
export function setProgrammerMode() {
  if (!state.midiOutput) return;
  state.midiOutput.send([0xF0, 0x00, 0x20, 0x29, 0x02, 0x0C, 0x0E, 0x01, 0xF7]);
  log('SysEx → Programmer Mode', 'out');
}

// =====================
// Logo LED (pad 99)
// =====================
export function sendLogoLED(r, g, b) {
  if (!state.midiOutput) return;
  try {
    state.midiOutput.send([0xF0, 0x00, 0x20, 0x29, 0x02, 0x0C, 0x03,
                           0x03, 99, r, g, b,
                           0xF7]);
  } catch(e) {}
}

export function updateLogoLED() {
  if (!state.midiOutput) { sendLogoLED(0, 0, 0); return; }
  sendLogoLED(0, 100, 0); // 接続中: 緑
}

// =====================
// Pad LED Color
// =====================
export function getPadLEDColor(pitchClass) {
  const chordPCs = getChordPitchClasses();
  const scalePCs = getScalePitchClasses();
  const rootPC = state.root;
  const bassPC = chordPCs.bassPC;
  const pc = pitchClass;
  const isRoot  = pc === rootPC && chordPCs.all.includes(pc);
  const isBass  = bassPC !== null && pc === bassPC;
  const isChord = chordPCs.all.includes(pc);
  const isScale = scalePCs.includes(pc);
  if (isRoot)                          return COLORS.root;
  else if (state.showChord && isBass)  return COLORS.bass;
  else if (state.showChord && isChord) return COLORS.chord;
  else if (state.showScale && isScale) return COLORS.scale;
  else                                 return COLORS.off;
}

// 単一パッドへの SysEx RGB 送信
export function sendPadLED(launchpadNote, r, g, b) {
  if (!state.midiOutput) return;
  try {
    state.midiOutput.send([0xF0, 0x00, 0x20, 0x29, 0x02, 0x0C, 0x03,
                           0x03, launchpadNote, r, g, b,
                           0xF7]);
  } catch(e) {}
}

// 同じ semitone のパッドを全て白フラッシュ → 元の色に戻す
export function flashPressedPad(pad, isPressed) {
  if (!state.midiOutput) return;
  const samePCs = pads.filter(p => p.semitone === pad.semitone);
  if (isPressed) {
    samePCs.forEach(p => sendPadLED(p.launchpadNote, ...COLORS.pressed));
  } else {
    const [r, g, b] = getPadLEDColor(pad.pitchClass);
    samePCs.forEach(p => sendPadLED(p.launchpadNote, r, g, b));
  }
}

// 全パッド + 上段ボタンの LED を一括 SysEx 送信
export function sendToLaunchpad(chordPCs, scalePCs, rootPC, bassPC) {
  if (!state.midiOutput) return;

  const data = [0xF0, 0x00, 0x20, 0x29, 0x02, 0x0C, 0x03];

  pads.forEach(pad => {
    const pc = pad.pitchClass;
    const isRoot = pc === rootPC && chordPCs.includes(pc);
    const isBass = bassPC !== null && pc === bassPC;
    const isChord = chordPCs.includes(pc);
    const isScale = scalePCs.includes(pc);

    let color;
    if (isRoot)                          color = COLORS.root;
    else if (state.showChord && isBass)  color = COLORS.bass;
    else if (state.showChord && isChord) color = COLORS.chord;
    else if (state.showScale && isScale) color = COLORS.scale;
    else                                 color = COLORS.off;

    data.push(0x03, pad.launchpadNote, color[0], color[1], color[2]);
  });

  // 上段ボタン: OCT▲/▼・◄/► はオレンジ、残りはほぼ消灯
  const fnColor = [60, 30, 0];
  const fnOff   = [3, 3, 3];
  TOP_ROW_CCS.forEach((cc, i) => {
    const color = i < 4 ? fnColor : fnOff;
    data.push(0x03, cc, color[0], color[1], color[2]);
  });

  data.push(0xF7);
  try {
    state.midiOutput.send(data);
    log(`SysEx → RGB lighting (${pads.length + 8} LEDs)`, 'out');
  } catch(e) {
    log('MIDI send error: ' + e.message, 'err');
  }
}

// 全 LED 消灯（ロゴ pad99 は updateLogoLED で別途管理）
export function clearAllLEDs() {
  if (!state.midiOutput) return;
  const data = [0xF0, 0x00, 0x20, 0x29, 0x02, 0x0C, 0x03];
  pads.forEach(pad => data.push(0x03, pad.launchpadNote, 0, 0, 0));
  TOP_ROW_CCS.forEach(cc => data.push(0x03, cc, 0, 0, 0));
  RIGHT_COL_NOTES.forEach(n => data.push(0x03, n, 0, 0, 0));
  data.push(0xF7);
  try { state.midiOutput.send(data); } catch(e) {}
  log('All LEDs cleared', 'out');
  updateLogoLED();
}
