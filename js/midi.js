import { NOTE_NAMES, TOP_ROW_CCS, RIGHT_COL_NOTES,
         PROGRAMMER_MODE_DELAY_MS, FN_ACTIVE_DURATION_MS, RIGHT_COL_NOTE_DURATION_MS } from './constants.js';
import { state, pads } from './state.js';
import { padEls, topRowEls, rightColEls } from './grid.js';
import { setProgrammerMode } from './led.js';
import { log } from './logger.js';

// =====================
// MIDI Device Management
// =====================

// コールバック（main.js から注入）
// {
//   onUpdateAll, onUpdateLogoLED, onStopMetronome,
//   onNoteOn(semitone, velocity), onNoteOff(semitone),
//   onFlash(pad, isPressed),
//   onTopRow(index), onRightCol(index)
// }
let _callbacks = {};

export async function initMIDI(callbacks) {
  _callbacks = callbacks;
  const statusEl = document.getElementById('midi-status');
  const hintEl   = document.getElementById('midi-hint');

  if (!navigator.requestMIDIAccess) {
    statusEl.textContent = 'WebMIDI not supported (Chrome recommended)';
    statusEl.className = 'disconnected';
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess({ sysex: true });
    await _setupMIDIAccess(access);
  } catch(e) {
    statusEl.textContent = 'MIDI access denied';
    statusEl.className = 'disconnected';
    hintEl.textContent = 'MIDI access was denied. Check the lock icon in the address bar to allow MIDI permission.';
    hintEl.classList.remove('hidden');
    log('MIDI access denied: ' + e.message, 'err');
  }
}

// MIDI アクセスのセットアップ（initMIDI / rescanMIDI から呼ぶ共通処理）
async function _setupMIDIAccess(access) {
  state.midiAccess = access;
  populateDevices(access);
  setupMIDIInput(access);
  access.onstatechange = (e) => {
    console.log('MIDI state change:', e.port.name, e.port.state);
    populateDevices(access);
    setupMIDIInput(access);
    if (!state.midiOutput) _callbacks.onStopMetronome?.();
    _callbacks.onUpdateLogoLED?.();
  };
}

// RESCAN 用エクスポート（main.js の RESCAN ハンドラから呼ぶ）
export async function rescanMIDI() {
  const access = await navigator.requestMIDIAccess({ sysex: true });
  await _setupMIDIAccess(access);
}

export function populateDevices(access) {
  const sel      = document.getElementById('device-select');
  const statusEl = document.getElementById('midi-status');
  const hintEl   = document.getElementById('midi-hint');
  const prev = sel.value;
  sel.innerHTML = '<option value="">-- Select device --</option>';
  let autoSelected = false;
  let outputCount = 0;
  const deviceNames = [];

  for (const [id, output] of access.outputs) {
    if (output.state === 'disconnected') continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${output.name} [${output.state}]`;
    sel.appendChild(opt);
    deviceNames.push(output.name);
    outputCount++;
    if (!autoSelected && output.name.toLowerCase().includes('launchpad')) {
      sel.value = id;
      autoSelected = true;
    }
  }

  if (!autoSelected && prev) {
    const prevOpt = sel.querySelector(`option[value="${prev}"]`);
    if (prevOpt) sel.value = prev;
  }

  if (outputCount === 0) {
    statusEl.textContent = 'No device — press RESCAN';
    statusEl.className = 'disconnected';
    hintEl.innerHTML = 'No MIDI devices found. Please check:<br>'
      + '· Another app (e.g. Ableton Live) may be holding the MIDI port exclusively (Windows)<br>'
      + '· Verify the USB cable is properly connected<br>'
      + '· Close other apps and press RESCAN';
    hintEl.classList.remove('hidden');
  } else {
    statusEl.textContent = `Connected (${outputCount} device${outputCount > 1 ? 's' : ''})`;
    statusEl.className = 'connected';
    hintEl.classList.add('hidden');
  }

  if (outputCount > 0) {
    log(`MIDI devices: ${deviceNames.join(', ')}`, 'out');
  } else {
    log('No MIDI devices found', 'err');
  }
  onDeviceSelect();
}

export function onDeviceSelect() {
  const id = document.getElementById('device-select').value;
  if (id && state.midiAccess) {
    const output = state.midiAccess.outputs.get(id);
    if (output && output.state === 'connected') {
      state.midiOutput = output;
      document.getElementById('send-btn').disabled = false;
      document.getElementById('clear-btn').disabled = false;
      // Programmer Mode に切替後、少し待ってから LED 更新
      setProgrammerMode();
      setTimeout(() => { _callbacks.onUpdateAll?.(); _callbacks.onUpdateLogoLED?.(); }, PROGRAMMER_MODE_DELAY_MS);
    } else {
      _callbacks.onStopMetronome?.();
      state.midiOutput = null;
      document.getElementById('send-btn').disabled = true;
      document.getElementById('clear-btn').disabled = true;
    }
  } else {
    _callbacks.onStopMetronome?.();
    state.midiOutput = null;
    document.getElementById('send-btn').disabled = true;
    document.getElementById('clear-btn').disabled = true;
  }
}

// =====================
// MIDI Input (Launchpad → sound + control)
// =====================

// タイムアウト付きクラス付与（fn-active / pressed の付与・削除）
function addTempClass(el, cls, ms) {
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

function handleCC(data1, data2) {
  const ccIdx = TOP_ROW_CCS.indexOf(data1);
  if (ccIdx >= 0) {
    log(`CC IN: CC${data1} val=${data2} (top row)`, 'in');
    _callbacks.onTopRow?.(ccIdx);
    addTempClass(topRowEls[ccIdx], 'fn-active', FN_ACTIVE_DURATION_MS);
    return;
  }
  const rcIdx = RIGHT_COL_NOTES.indexOf(data1);
  if (rcIdx >= 0) {
    log(`CC IN: CC${data1} val=${data2} (right col)`, 'in');
    _callbacks.onRightCol?.(rcIdx);
    addTempClass(rightColEls[rcIdx], 'fn-active', FN_ACTIVE_DURATION_MS);
    return;
  }
  log(`CC IN: CC${data1} val=${data2} (unknown)`, 'in');
}

function handleNoteOff(data1) {
  const pad = pads.find(p => p.launchpadNote === data1);
  if (!pad) return;
  const padIdx = pad.row * 8 + pad.col;
  _callbacks.onNoteOff?.(pad.semitone);
  if (padEls[padIdx]) {
    padEls[padIdx].classList.remove('pressed');
    _callbacks.onFlash?.(pad, false);
  }
}

function handleNoteOn(data1, data2) {
  // Right column as Note (fallback — some firmware versions)
  const rcIdx = RIGHT_COL_NOTES.indexOf(data1);
  if (rcIdx >= 0) {
    log(`Right col IN: Note ${data1} vel=${data2}`, 'in');
    _callbacks.onRightCol?.(rcIdx);
    addTempClass(rightColEls[rcIdx], 'pressed', RIGHT_COL_NOTE_DURATION_MS);
    return;
  }

  // Main 8x8 grid
  const pad = pads.find(p => p.launchpadNote === data1);
  if (!pad) return;
  const padIdx = pad.row * 8 + pad.col;
  const noteName = NOTE_NAMES[pad.pitchClass];
  const octave = Math.floor(pad.semitone / 12) - 1;
  log(`Pad IN: note=${data1} → ${noteName}${octave} vel=${data2}`, 'in');
  _callbacks.onNoteOn?.(pad.semitone, data2);
  if (padEls[padIdx]) {
    padEls[padIdx].classList.add('pressed');
    _callbacks.onFlash?.(pad, true);
  }
}

export function setupMIDIInput(access) {
  for (const input of access.inputs.values()) {
    input.onmidimessage = (event) => {
      if (event.data.length < 2) return; // SysEx等の短いメッセージを無視
      const [status, data1, data2 = 0] = event.data;

      if ((status & 0xF0) === 0xB0 && data2 > 0)                                { handleCC(data1, data2);    return; }
      if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && data2 === 0)) { handleNoteOff(data1);     return; }
      if ((status & 0xF0) === 0x90 && data2 > 0)                                { handleNoteOn(data1, data2); return; }
    };
  }
}
