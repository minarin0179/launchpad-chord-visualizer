// ES Modules: 全 import はファイル先頭にまとめる
import { NOTE_NAMES, CHORD_TYPES, SCALES, INSTRUMENTS } from './constants.js';
import { state, pads } from './state.js';
import { log } from './logger.js';
import { startNote, stopNote, getActiveNotes, playMetronomeClick } from './audio.js';
import { getChordPitchClasses, getScalePitchClasses, buildInversionButtons,
         detectChordFromActiveNotes, updateChordDisplay } from './music.js';
import { sendToLaunchpad, flashPressedPad, updateLogoLED, sendLogoLED, clearAllLEDs } from './led.js';
import { buildGridDOM, handleTopRowPress, handleRightColPress,
         shiftCapo, padEls } from './grid.js';
import { initMIDI, onDeviceSelect, populateDevices, setupMIDIInput } from './midi.js';

// =====================
// Note change callback (audio → chord detection)
// =====================
function handleNoteChange() {
  detectChordFromActiveNotes(getActiveNotes());
}

// =====================
// Main Update (central hub)
// =====================
function updateAll() {
  const maxInv = CHORD_TYPES[state.chordType].intervals.length - 1;
  if (state.inversion > maxInv) state.inversion = 0;
  buildInversionButtons(updateAll);

  const chordPCs = getChordPitchClasses();
  const scalePCs = getScalePitchClasses();
  const rootPC   = state.root;

  pads.forEach((pad, idx) => {
    const el = padEls[idx];
    if (!el) return;
    const pc = pad.pitchClass;
    const isRoot  = pc === rootPC && chordPCs.all.includes(pc);
    const isBass  = chordPCs.bassPC !== null && pc === chordPCs.bassPC;
    const isChord = chordPCs.all.includes(pc);
    const isScale = scalePCs.includes(pc);

    el.className = 'pad';
    if (isRoot) {
      el.classList.add('root');
    } else if (state.showChord && isBass) {
      el.classList.add('bass');
    } else if (state.showChord && isChord) {
      el.classList.add('chord');
    } else if (state.showScale && isScale) {
      el.classList.add('scale-only');
    } else {
      el.classList.add('off');
    }
  });

  updateChordDisplay();
  sendToLaunchpad(chordPCs.all, scalePCs, rootPC, chordPCs.bassPC);
}

// =====================
// Metronome
// =====================
function metronomeBeat() {
  const isAccent = state._metroBeat === 0;
  state._metroBeat = (state._metroBeat + 1) % 4;

  sendLogoLED(isAccent ? 127 : 60, isAccent ? 127 : 80, isAccent ? 127 : 100);
  setTimeout(() => {
    if (state.midiOutput) sendLogoLED(0, 100, 0);
  }, 80);

  playMetronomeClick(isAccent);
}

function startMetronome() {
  if (state._metroTimer) clearInterval(state._metroTimer);
  state._metroBeat = 0;
  const ms = (60 / state.bpm) * 1000;
  metronomeBeat();
  state._metroTimer = setInterval(metronomeBeat, ms);
  state.metronome = true;
  const btn = document.getElementById('metro-btn');
  btn.classList.add('active');
  btn.textContent = '■ STOP';
  log(`Metronome ON — ${state.bpm} BPM`, 'out');
}

function stopMetronome() {
  if (state._metroTimer) { clearInterval(state._metroTimer); state._metroTimer = null; }
  state.metronome = false;
  const btn = document.getElementById('metro-btn');
  btn.classList.remove('active');
  btn.textContent = '▶ START';
  updateLogoLED();
  log('Metronome OFF', 'out');
}

// =====================
// DOM: Button helpers
// =====================
function setActive(container, activeBtn) {
  container.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
  activeBtn.classList.add('active');
}

// =====================
// DOM: Root / Chord / Scale / Instrument buttons
// =====================
const rootContainer = document.getElementById('root-buttons');
NOTE_NAMES.forEach((name, i) => {
  const btn = document.createElement('button');
  btn.className = 'btn' + (i === 0 ? ' active' : '');
  btn.textContent = name;
  btn.onclick = () => { state.root = i; state.inversion = 0; updateAll(); setActive(rootContainer, btn); };
  rootContainer.appendChild(btn);
});

const chordContainer = document.getElementById('chord-buttons');
Object.entries(CHORD_TYPES).forEach(([key, val]) => {
  const btn = document.createElement('button');
  btn.className = 'btn' + (key === 'maj' ? ' active' : '');
  btn.textContent = val.label;
  btn.onclick = () => { state.chordType = key; state.inversion = 0; updateAll(); setActive(chordContainer, btn); };
  chordContainer.appendChild(btn);
});

const scaleContainer = document.getElementById('scale-buttons');
Object.entries(SCALES).forEach(([key, val]) => {
  const btn = document.createElement('button');
  btn.className = 'btn' + (key === 'major' ? ' active' : '');
  btn.textContent = val.label;
  btn.onclick = () => { state.scale = key; updateAll(); setActive(scaleContainer, btn); };
  scaleContainer.appendChild(btn);
});

const instrumentContainer = document.getElementById('instrument-buttons');
Object.entries(INSTRUMENTS).forEach(([key, val]) => {
  const btn = document.createElement('button');
  btn.className = 'btn' + (key === state.instrument ? ' active' : '');
  btn.textContent = val.label;
  btn.onclick = () => { state.instrument = key; setActive(instrumentContainer, btn); };
  instrumentContainer.appendChild(btn);
});

// =====================
// DOM: Toggles
// =====================
document.getElementById('toggle-chord').onclick = function() {
  state.showChord = !state.showChord;
  this.classList.toggle('active', state.showChord);
  document.getElementById('chord-control').classList.toggle('hidden', !state.showChord);
  updateAll();
};
document.getElementById('toggle-scale').onclick = function() {
  state.showScale = !state.showScale;
  this.classList.toggle('active', state.showScale);
  document.getElementById('scale-control').classList.toggle('hidden', !state.showScale);
  document.getElementById('scale-key-label').classList.toggle('hidden', !state.showScale);
  updateAll();
};
document.getElementById('toggle-inversion').onclick = function() {
  state.showInversion = !state.showInversion;
  this.classList.toggle('active', state.showInversion);
  document.getElementById('inversion-control').classList.toggle('hidden', !state.showInversion);
  updateAll();
};

// =====================
// DOM: Capo controls
// =====================
document.getElementById('capo-down').onclick  = () => shiftCapo(-1);
document.getElementById('capo-up').onclick    = () => shiftCapo(+1);
document.getElementById('capo-reset').onclick = () => shiftCapo(-state.capo);

// =====================
// DOM: Volume / BPM / Metro
// =====================
document.getElementById('volume').oninput = function() {
  document.getElementById('volume-label').textContent = this.value + '%';
};

document.getElementById('metro-bpm').oninput = function() {
  state.bpm = parseInt(this.value);
  document.getElementById('metro-bpm-num').value = this.value;
  if (state.metronome) startMetronome();
};

document.getElementById('metro-bpm-num').onchange = function() {
  const v = Math.min(240, Math.max(40, parseInt(this.value) || 120));
  this.value = v;
  state.bpm = v;
  document.getElementById('metro-bpm').value = v;
  if (state.metronome) startMetronome();
};

document.getElementById('metro-btn').onclick = () => {
  if (state.metronome) stopMetronome();
  else if (state.midiOutput) startMetronome();
};

// =====================
// DOM: MIDI buttons
// =====================
document.getElementById('send-btn').onclick = () => updateAll();
document.getElementById('clear-btn').onclick = () => clearAllLEDs();

document.getElementById('rescan-btn').onclick = async () => {
  const statusEl = document.getElementById('midi-status');
  statusEl.textContent = 'Rescanning...';
  statusEl.className = 'searching';
  try {
    const access = await navigator.requestMIDIAccess({ sysex: true });
    state.midiAccess = access;
    populateDevices(access);
    setupMIDIInput(access);
    access.onstatechange = (e) => {
      console.log('MIDI state change:', e.port.name, e.port.state);
      populateDevices(access);
      setupMIDIInput(access);
      if (!state.midiOutput) stopMetronome();
      updateLogoLED();
    };
  } catch(e) {
    statusEl.textContent = 'MIDI access denied';
    statusEl.className = 'disconnected';
  }
};

document.getElementById('device-select').onchange = onDeviceSelect;

// =====================
// Build grid + Init MIDI + Start
// =====================
buildGridDOM(
  (pad, el) => {
    startNote(pad.semitone, 80, handleNoteChange);
    el.classList.add('pressed');
    flashPressedPad(pad, true);
  },
  (pad, el) => {
    stopNote(pad.semitone, handleNoteChange);
    el.classList.remove('pressed');
    flashPressedPad(pad, false);
  },
  updateAll  // onAfterRebuild (rebuildPads 後に呼ばれる)
);

initMIDI({
  onUpdateAll:     updateAll,
  onUpdateLogoLED: updateLogoLED,
  onStopMetronome: stopMetronome,
  onNoteOn:        (semitone, velocity) => startNote(semitone, velocity, handleNoteChange),
  onNoteOff:       (semitone) => stopNote(semitone, handleNoteChange),
  onFlash:         flashPressedPad,
  onTopRow:        handleTopRowPress,
  onRightCol:      handleRightColPress,
});

log('App started');
updateAll();
