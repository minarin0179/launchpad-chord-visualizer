import { COLORS, LOGO_GREEN, FN_BTN_COLOR, FN_BTN_OFF_COLOR } from './constants.js';
import { state, pads } from './state.js';
import { getChordPitchClasses, getScalePitchClasses, classifyPad } from './music.js';
import { log } from './logger.js';
import { TOP_ROW_CCS, LOGO_PAD } from '../packages/launchpad-x/dist/index.js';

// =====================
// Logo LED
// =====================
export function sendLogoLED(r, g, b) {
  if (!state.device) return;
  try {
    state.device.setRGB(LOGO_PAD, r, g, b);
  } catch(e) { log('MIDI send error: ' + e.message, 'err'); }
}

export function updateLogoLED() {
  if (!state.device) { sendLogoLED(0, 0, 0); return; }
  sendLogoLED(...LOGO_GREEN);
}

// =====================
// Pad LED Color
// =====================
export function getPadLEDColor(pitchClass) {
  const chordPCs = getChordPitchClasses();
  const scalePCs = getScalePitchClasses();
  const cls = classifyPad(pitchClass, state.root, chordPCs.all, scalePCs, chordPCs.bassPC, state.showChord, state.showScale);
  return COLORS[cls];
}

// 同じ semitone のパッドを全て白フラッシュ → 元の色に戻す
export function flashPressedPad(pad, isPressed) {
  if (!state.device) return;
  const samePCs = pads.filter(p => p.semitone === pad.semitone);
  const updates = [];
  if (isPressed) {
    const [r, g, b] = COLORS.pressed;
    samePCs.forEach(p => updates.push({ type: 'rgb', pad: p.launchpadNote, r, g, b }));
  } else {
    const [r, g, b] = getPadLEDColor(pad.pitchClass);
    samePCs.forEach(p => updates.push({ type: 'rgb', pad: p.launchpadNote, r, g, b }));
  }
  if (updates.length > 0) {
    try { state.device.sendLEDs(updates); } catch(e) { log('MIDI send error: ' + e.message, 'err'); }
  }
}

// 全パッド + 上段ボタンの LED を一括送信
export function sendToLaunchpad(chordPCs, scalePCs, rootPC, bassPC) {
  if (!state.device) return;

  const updates = [];

  pads.forEach(pad => {
    const cls = classifyPad(pad.pitchClass, rootPC, chordPCs, scalePCs, bassPC, state.showChord, state.showScale);
    const [r, g, b] = COLORS[cls];
    updates.push({ type: 'rgb', pad: pad.launchpadNote, r, g, b });
  });

  // 上段ボタン: OCT▲/▼・◄/► はオレンジ、残りはほぼ消灯
  TOP_ROW_CCS.forEach((cc, i) => {
    const [r, g, b] = i < 4 ? FN_BTN_COLOR : FN_BTN_OFF_COLOR;
    updates.push({ type: 'rgb', pad: cc, r, g, b });
  });

  try {
    state.device.sendLEDs(updates);
    log(`SysEx → RGB lighting (${pads.length + 8} LEDs)`, 'out');
  } catch(e) {
    log('MIDI send error: ' + e.message, 'err');
  }
}

// 全 LED 消灯（ロゴ pad99 は updateLogoLED で別途管理）
export function clearAllLEDs() {
  if (!state.device) return;
  try {
    state.device.clearAll();
  } catch(e) { log('MIDI clear error: ' + e.message, 'err'); }
  log('All LEDs cleared', 'out');
  updateLogoLED();
}
