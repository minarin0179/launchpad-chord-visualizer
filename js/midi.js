import { PROGRAMMER_MODE_DELAY_MS, FN_ACTIVE_DURATION_MS, RIGHT_COL_NOTE_DURATION_MS,
         NOTE_NAMES } from './constants.js';
import { state, pads } from './state.js';
import { padEls, topRowEls, rightColEls } from './grid.js';
import { log } from './logger.js';
import { LaunchpadX, fromWebMIDI, TOP_ROW_CCS, RIGHT_COL_NOTES } from '../packages/launchpad-x/dist/index.js';

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

async function _setupMIDIAccess(access) {
  state.midiAccess = access;
  populateDevices(access);
  access.onstatechange = (e) => {
    console.log('MIDI state change:', e.port.name, e.port.state);
    populateDevices(access);
    if (!state.device) _callbacks.onStopMetronome?.();
    _callbacks.onUpdateLogoLED?.();
  };
}

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

function _setMIDIControlsEnabled(enabled) {
  document.getElementById('send-btn').disabled = !enabled;
  document.getElementById('clear-btn').disabled = !enabled;
}

// 選択した出力ポートに対応する入力ポートを探す
function _findMatchingInput(access, output) {
  const connected = [...access.inputs.values()].filter(i => i.state === 'connected');
  log(`入力ポート一覧: ${connected.map(i => `"${i.name}"`).join(', ')}`, 'out');
  if (connected.length === 0) { log('入力ポートが見つかりませんでした', 'err'); return undefined; }

  let found;

  // 戦略1: Windows パターン "MIDIOUT<N> (base)" → "MIDIIN<N> (base)"
  const mOut = output.name.match(/^MIDIOUT(\d+)\s*\((.+)\)$/i);
  if (mOut) {
    found = connected.find(i => i.name === `MIDIIN${mOut[1]} (${mOut[2]})`);
    if (found) { log(`入力マッチ(MIDIIN): "${found.name}"`, 'out'); return found; }
  }

  // 戦略2: \bIn\b ↔ \bOut\b のスワップ（"LPX MIDI In" → "LPX MIDI Out" など）
  const swapped = output.name.replace(/\b(In|Out)\b/g, m => m === 'In' ? 'Out' : 'In');
  if (swapped !== output.name) {
    found = connected.find(i => i.name === swapped);
    if (found) { log(`入力マッチ(名前スワップ): "${found.name}"`, 'out'); return found; }
  }

  // 戦略3: 出力名と完全一致する入力（"LPX MIDI" → "LPX MIDI" など同名パターン）
  found = connected.find(i => i.name === output.name);
  if (found) { log(`入力マッチ(同名): "${found.name}"`, 'out'); return found; }

  // 戦略4: 括弧内のベース名と一致（"MIDIOUT2 (LPX MIDI)" → base="LPX MIDI"）
  const baseMatch = output.name.match(/\((.+)\)/);
  if (baseMatch) {
    found = connected.find(i => i.name === baseMatch[1] || i.name.includes(baseMatch[1]));
    if (found) { log(`入力マッチ(ベース名): "${found.name}"`, 'out'); return found; }
  }

  // 戦略5: "launchpad" または "lpx" を含む入力
  found = connected.find(i => { const n = i.name.toLowerCase(); return n.includes('launchpad') || n.includes('lpx'); });
  if (found) { log(`入力マッチ(キーワード): "${found.name}"`, 'out'); return found; }

  // フォールバック: 最初の接続済み入力
  log(`入力マッチ(フォールバック): "${connected[0].name}"`, 'out');
  return connected[0];
}

export function onDeviceSelect() {
  const id = document.getElementById('device-select').value;
  if (id && state.midiAccess) {
    const output = state.midiAccess.outputs.get(id);
    if (output && output.state === 'connected') {
      // 既存デバイスのリスナー解除
      state.device?.destroy();

      log(`出力ポート選択: "${output.name}"`, 'out');
      const inputPort = _findMatchingInput(state.midiAccess, output);
      const transport = fromWebMIDI(output, inputPort);
      state.device = new LaunchpadX(transport.output, transport.input);

      _setupDeviceListeners(state.device);
      _buildPadMap();
      _setMIDIControlsEnabled(true);

      state.device.setProgrammerMode();
      setTimeout(() => { _callbacks.onUpdateAll?.(); _callbacks.onUpdateLogoLED?.(); }, PROGRAMMER_MODE_DELAY_MS);
    } else {
      _callbacks.onStopMetronome?.();
      state.device?.destroy();
      state.device = null;
      _setMIDIControlsEnabled(false);
    }
  } else {
    _callbacks.onStopMetronome?.();
    state.device?.destroy();
    state.device = null;
    _setMIDIControlsEnabled(false);
  }
}

// =====================
// Pad lookup map (launchpadNote → pad, O(1))
// =====================
let _padByNote = new Map();

function _buildPadMap() {
  _padByNote = new Map(pads.map(p => [p.launchpadNote, p]));
}

/** pads 更新後に呼び出して Map を再構築する */
export function rebuildPadMap() { _buildPadMap(); }

// =====================
// MIDI Input — LaunchpadX イベントリスナー
// =====================

function addTempClass(el, cls, ms) {
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

function _handleCC(cc, value) {
  const ccIdx = TOP_ROW_CCS.indexOf(cc);
  if (ccIdx >= 0) {
    log(`CC IN: CC${cc} val=${value} (top row)`, 'in');
    _callbacks.onTopRow?.(ccIdx);
    addTempClass(topRowEls[ccIdx], 'fn-active', FN_ACTIVE_DURATION_MS);
    return;
  }
  const rcIdx = RIGHT_COL_NOTES.indexOf(cc);
  if (rcIdx >= 0) {
    log(`CC IN: CC${cc} val=${value} (right col)`, 'in');
    _callbacks.onRightCol?.(rcIdx);
    addTempClass(rightColEls[rcIdx], 'fn-active', FN_ACTIVE_DURATION_MS);
    return;
  }
  log(`CC IN: CC${cc} val=${value} (unknown)`, 'in');
}

function _handleNoteOff(pad) {
  const padObj = _padByNote.get(pad);
  if (!padObj) return;
  const padIdx = padObj.row * 8 + padObj.col;
  _callbacks.onNoteOff?.(padObj.semitone);
  if (padEls[padIdx]) {
    padEls[padIdx].classList.remove('pressed');
    _callbacks.onFlash?.(padObj, false);
  }
}

function _handleNoteOn(pad, velocity) {
  // Right column as Note（ファームウェアによっては CC ではなく Note で来る）
  const rcIdx = RIGHT_COL_NOTES.indexOf(pad);
  if (rcIdx >= 0) {
    log(`Right col IN: Note ${pad} vel=${velocity}`, 'in');
    _callbacks.onRightCol?.(rcIdx);
    addTempClass(rightColEls[rcIdx], 'pressed', RIGHT_COL_NOTE_DURATION_MS);
    return;
  }

  // メイン 8x8 グリッド
  const padObj = _padByNote.get(pad);
  if (!padObj) return;
  const padIdx = padObj.row * 8 + padObj.col;
  const noteName = NOTE_NAMES[padObj.pitchClass];
  const octave = Math.floor(padObj.semitone / 12) - 1;
  log(`Pad IN: note=${pad} → ${noteName}${octave} vel=${velocity}`, 'in');
  _callbacks.onNoteOn?.(padObj.semitone, velocity);
  if (padEls[padIdx]) {
    padEls[padIdx].classList.add('pressed');
    _callbacks.onFlash?.(padObj, true);
  }
}

function _setupDeviceListeners(device) {
  device.addEventListener('noteOn', (e) => {
    _handleNoteOn(e.detail.pad, e.detail.velocity);
  });
  device.addEventListener('noteOff', (e) => {
    _handleNoteOff(e.detail.pad);
  });
  device.addEventListener('controlChange', (e) => {
    _handleCC(e.detail.cc, e.detail.value);
  });
}
