import { NOTE_NAMES, TOP_ROW_LABELS, TOP_ROW_CCS, RIGHT_COL_NOTES,
         CC_UP, CC_DOWN, CC_LEFT, CC_RIGHT, buildPadData,
         MAX_BASE_NOTE_OCTAVE, MAX_BASE_NOTE_CAPO } from './constants.js';
import { state, pads, setPads } from './state.js';
import { log } from './logger.js';

// =====================
// DOM references
// =====================
export let padEls = [];        // indexed by padIdx (row*8+col)
export const topRowEls = [];   // indexed 0-7 for CC 91-98
export const rightColEls = []; // indexed 0-7 top-to-bottom

// パッドイベントコールバック（buildGridDOM で一度設定し rebuildPads でも再利用）
let _onPadDown = null;       // (pad, el) => void
let _onPadUp   = null;       // (pad, el) => void
let _onAfterRebuild = null;  // () => void  ← updateAll

// =====================
// Build Grid DOM
// =====================
export function buildGridDOM(onPadDown, onPadUp, onAfterRebuild) {
  _onPadDown = onPadDown;
  _onPadUp   = onPadUp;
  _onAfterRebuild = onAfterRebuild;

  const gridEl = document.getElementById('pad-grid');
  gridEl.innerHTML = '';
  padEls = [];

  // --- Top row: CC buttons (91-98) + corner ---
  for (let i = 0; i < 9; i++) {
    const el = document.createElement('div');
    if (i < 8) {
      el.className = 'pad fn-btn';
      el.dataset.note = TOP_ROW_LABELS[i] || `CC${TOP_ROW_CCS[i]}`;
      el.title = `CC ${TOP_ROW_CCS[i]}`;
      el.onpointerdown = (e) => { e.preventDefault(); handleTopRowPress(i); };
      topRowEls[i] = el;
    } else {
      el.className = 'pad fn-corner';
    }
    gridEl.appendChild(el);
  }

  // --- Main 8x8 grid + right column ---
  for (let row = 7; row >= 0; row--) {
    for (let col = 0; col < 8; col++) {
      const padIdx = row * 8 + col;
      const pad = pads[padIdx];
      const el = document.createElement('div');
      el.className = 'pad off';
      el.dataset.note = NOTE_NAMES[pad.pitchClass];
      el.title = `${NOTE_NAMES[pad.pitchClass]} (MIDI ${pad.semitone})`;
      el.onpointerdown = (e) => { e.preventDefault(); if (_onPadDown) _onPadDown(pad, el); };
      el.onpointerup   = () => { if (_onPadUp) _onPadUp(pad, el); };
      el.onpointerleave = () => { if (_onPadUp) _onPadUp(pad, el); };
      gridEl.appendChild(el);
      padEls[padIdx] = el;
    }
    // Right column button
    const rcIdx = 7 - row;
    const rcEl = document.createElement('div');
    rcEl.className = 'pad fn-btn';
    const rcNote = RIGHT_COL_NOTES[rcIdx];
    rcEl.dataset.note = `N${rcNote}`;
    rcEl.title = `Note ${rcNote}`;
    rcEl.onpointerdown = (e) => {
      e.preventDefault();
      handleRightColPress(rcIdx);
      rcEl.classList.add('pressed');
    };
    rcEl.onpointerup    = () => rcEl.classList.remove('pressed');
    rcEl.onpointerleave = () => rcEl.classList.remove('pressed');
    gridEl.appendChild(rcEl);
    rightColEls[rcIdx] = rcEl;
  }
}

// =====================
// Octave / Capo
// =====================
export function shiftOctave(delta) {
  const newBase = state.baseNote + delta * 12;
  if (newBase < 0 || newBase > MAX_BASE_NOTE_OCTAVE) return;
  state.baseNote = newBase;
  rebuildPads();
  const noteName = NOTE_NAMES[state.baseNote % 12];
  const octave = Math.floor(state.baseNote / 12) - 1;
  log(`Octave → ${noteName}${octave} (base=${state.baseNote})`, 'out');
}

export function shiftCapo(delta) {
  const newBase = state.baseNote + delta;
  if (newBase < 0 || newBase > MAX_BASE_NOTE_CAPO) return;
  state.baseNote = newBase;
  state.root = ((state.root + delta) % 12 + 12) % 12;
  state.capo += delta;
  state.inversion = 0;
  // ルートボタンの active 更新は rebuildPads() → _onAfterRebuild (updateAll) に委譲
  rebuildPads();
  updateCapoDisplay();
  log(`Capo ${state.capo >= 0 ? '+' : ''}${state.capo} → ${NOTE_NAMES[state.root]} (base=${state.baseNote})`, 'out');
}

export function updateCapoDisplay() {
  const el = document.getElementById('capo-display');
  const c = state.capo;
  el.textContent = c === 0 ? '0' : (c > 0 ? `+${c}` : `${c}`);
  el.dataset.nonzero = c !== 0 ? 'true' : 'false';
}

export function updateBaseNoteDisplay() {
  const noteName = NOTE_NAMES[state.baseNote % 12];
  const octave = Math.floor(state.baseNote / 12) - 1;
  document.getElementById('scale-key-label').dataset.base = `${noteName}${octave}`;
}

// =====================
// Rebuild Pads (オクターブ/Capo後のパッドデータ + DOM 更新)
// =====================
export function rebuildPads() {
  const newPads = buildPadData(state.baseNote);
  setPads(newPads);

  newPads.forEach((pad, idx) => {
    const el = padEls[idx];
    if (!el) return;
    el.dataset.note = NOTE_NAMES[pad.pitchClass];
    el.title = `${NOTE_NAMES[pad.pitchClass]} (MIDI ${pad.semitone})`;
    el.onpointerdown = (e) => { e.preventDefault(); if (_onPadDown) _onPadDown(pad, el); };
    el.onpointerup   = () => { if (_onPadUp) _onPadUp(pad, el); };
    el.onpointerleave = () => { if (_onPadUp) _onPadUp(pad, el); };
  });

  updateBaseNoteDisplay();
  if (_onAfterRebuild) _onAfterRebuild();
}

// =====================
// Top row / Right column handlers
// =====================
export function handleTopRowPress(index) {
  switch (TOP_ROW_CCS[index]) {
    case CC_UP:    shiftOctave(+1); break;
    case CC_DOWN:  shiftOctave(-1); break;
    case CC_LEFT:  shiftCapo(-1);   break;
    case CC_RIGHT: shiftCapo(+1);   break;
    default:
      log(`Top row CC${TOP_ROW_CCS[index]} pressed`, 'in');
  }
}

export function handleRightColPress(index) {
  log(`Right col Note ${RIGHT_COL_NOTES[index]} pressed`, 'in');
}
