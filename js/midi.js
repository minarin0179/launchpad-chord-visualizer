import { NOTE_NAMES, TOP_ROW_CCS, RIGHT_COL_NOTES } from './constants.js';
import { state, pads } from './state.js';
import { padEls, topRowEls, rightColEls } from './grid.js';
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
let _cbs = {};

export async function initMIDI(callbacks) {
  _cbs = callbacks;
  const statusEl = document.getElementById('midi-status');
  const hintEl   = document.getElementById('midi-hint');

  if (!navigator.requestMIDIAccess) {
    statusEl.textContent = 'WebMIDI not supported (Chrome recommended)';
    statusEl.className = 'disconnected';
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess({ sysex: true });
    state.midiAccess = access;
    populateDevices(access);
    setupMIDIInput(access);
    access.onstatechange = (e) => {
      console.log('MIDI state change:', e.port.name, e.port.state);
      populateDevices(access);
      setupMIDIInput(access);
      if (!state.midiOutput) _cbs.onStopMetronome?.();
      _cbs.onUpdateLogoLED?.();
    };
  } catch(e) {
    statusEl.textContent = 'MIDI access denied';
    statusEl.className = 'disconnected';
    hintEl.textContent = 'MIDI access was denied. Check the lock icon in the address bar to allow MIDI permission.';
    hintEl.classList.remove('hidden');
    log('MIDI access denied: ' + e.message, 'err');
  }
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
      state.midiOutput.send([0xF0, 0x00, 0x20, 0x29, 0x02, 0x0C, 0x0E, 0x01, 0xF7]);
      log('SysEx → Programmer Mode', 'out');
      setTimeout(() => { _cbs.onUpdateAll?.(); _cbs.onUpdateLogoLED?.(); }, 150);
    } else {
      _cbs.onStopMetronome?.();
      state.midiOutput = null;
      document.getElementById('send-btn').disabled = true;
      document.getElementById('clear-btn').disabled = true;
    }
  } else {
    _cbs.onStopMetronome?.();
    state.midiOutput = null;
    document.getElementById('send-btn').disabled = true;
    document.getElementById('clear-btn').disabled = true;
  }
}

// =====================
// MIDI Input (Launchpad → sound + control)
// =====================
function getLaunchpadSemitone(note) {
  const pad = pads.find(p => p.launchpadNote === note);
  return pad ? pad.semitone : undefined;
}

export function setupMIDIInput(access) {
  for (const input of access.inputs.values()) {
    input.onmidimessage = (event) => {
      const [status, data1, data2] = event.data;

      // --- CC messages (top row + right column buttons) ---
      if ((status & 0xF0) === 0xB0 && data2 > 0) {
        const ccIdx = TOP_ROW_CCS.indexOf(data1);
        if (ccIdx >= 0) {
          log(`CC IN: CC${data1} val=${data2} (top row)`, 'in');
          _cbs.onTopRow?.(ccIdx);
          if (topRowEls[ccIdx]) {
            topRowEls[ccIdx].classList.add('fn-active');
            setTimeout(() => topRowEls[ccIdx].classList.remove('fn-active'), 200);
          }
          return;
        }
        const rcIdx = RIGHT_COL_NOTES.indexOf(data1);
        if (rcIdx >= 0) {
          log(`CC IN: CC${data1} val=${data2} (right col)`, 'in');
          _cbs.onRightCol?.(rcIdx);
          if (rightColEls[rcIdx]) {
            rightColEls[rcIdx].classList.add('fn-active');
            setTimeout(() => rightColEls[rcIdx].classList.remove('fn-active'), 200);
          }
          return;
        }
        log(`CC IN: CC${data1} val=${data2} (unknown)`, 'in');
        return;
      }

      // --- Note Off ---
      if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && data2 === 0)) {
        const semitone = getLaunchpadSemitone(data1);
        if (semitone !== undefined) {
          _cbs.onNoteOff?.(semitone);
          const padIdx = pads.findIndex(p => p.launchpadNote === data1);
          if (padIdx >= 0 && padEls[padIdx]) {
            padEls[padIdx].classList.remove('pressed');
            _cbs.onFlash?.(pads[padIdx], false);
          }
        }
        return;
      }

      // --- Note On ---
      if ((status & 0xF0) === 0x90 && data2 > 0) {
        // Right column as Note (fallback — some firmware versions)
        const rcIdx = RIGHT_COL_NOTES.indexOf(data1);
        if (rcIdx >= 0) {
          log(`Right col IN: Note ${data1} vel=${data2}`, 'in');
          _cbs.onRightCol?.(rcIdx);
          if (rightColEls[rcIdx]) {
            rightColEls[rcIdx].classList.add('pressed');
            setTimeout(() => rightColEls[rcIdx].classList.remove('pressed'), 150);
          }
          return;
        }

        // Main 8x8 grid
        const semitone = getLaunchpadSemitone(data1);
        if (semitone !== undefined) {
          const noteName = NOTE_NAMES[((semitone % 12) + 12) % 12];
          const octave = Math.floor(semitone / 12) - 1;
          log(`Pad IN: note=${data1} → ${noteName}${octave} vel=${data2}`, 'in');
          _cbs.onNoteOn?.(semitone, data2);
          const padIdx = pads.findIndex(p => p.launchpadNote === data1);
          if (padIdx >= 0 && padEls[padIdx]) {
            padEls[padIdx].classList.add('pressed');
            _cbs.onFlash?.(pads[padIdx], true);
          }
        }
        return;
      }
    };
  }
}
