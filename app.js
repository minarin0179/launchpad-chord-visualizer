// =====================
// Music Theory Data
// =====================
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const CHORD_TYPES = {
  'maj':   { intervals: [0,4,7],       label: 'Major',    symbol: '' },
  'min':   { intervals: [0,3,7],       label: 'Minor',    symbol: 'm' },
  '7':     { intervals: [0,4,7,10],    label: 'Dom 7',    symbol: '7' },
  'maj7':  { intervals: [0,4,7,11],    label: 'Maj 7',    symbol: 'M7' },
  'min7':  { intervals: [0,3,7,10],    label: 'Min 7',    symbol: 'm7' },
  'dim':   { intervals: [0,3,6],       label: 'Dim',      symbol: '°' },
  'dim7':  { intervals: [0,3,6,9],     label: 'Dim 7',    symbol: '°7' },
  'aug':   { intervals: [0,4,8],       label: 'Aug',      symbol: '+' },
  'm7b5':  { intervals: [0,3,6,10],    label: 'Half-Dim', symbol: 'ø7' },
  'sus2':  { intervals: [0,2,7],       label: 'Sus2',     symbol: 'sus2' },
  'sus4':  { intervals: [0,5,7],       label: 'Sus4',     symbol: 'sus4' },
  'add9':  { intervals: [0,4,7,14],    label: 'Add9',     symbol: 'add9' },
  '9':     { intervals: [0,4,7,10,14], label: 'Dom 9',    symbol: '9' },
  'maj9':  { intervals: [0,4,7,11,14], label: 'Maj 9',    symbol: 'M9' },
  'min9':  { intervals: [0,3,7,10,14], label: 'Min 9',    symbol: 'm9' },
  '6':     { intervals: [0,4,7,9],     label: 'Maj 6',    symbol: '6' },
  'min6':  { intervals: [0,3,7,9],     label: 'Min 6',    symbol: 'm6' },
};

const SCALES = {
  'major':      { intervals: [0,2,4,5,7,9,11], label: 'Major' },
  'minor':      { intervals: [0,2,3,5,7,8,10], label: 'Nat Minor' },
  'dorian':     { intervals: [0,2,3,5,7,9,10], label: 'Dorian' },
  'mixolydian': { intervals: [0,2,4,5,7,9,10], label: 'Mixolydian' },
  'penta_maj':  { intervals: [0,2,4,7,9],      label: 'Penta Maj' },
  'penta_min':  { intervals: [0,3,5,7,10],     label: 'Penta Min' },
  'blues':      { intervals: [0,3,5,6,7,10],   label: 'Blues' },
};

const INTERVAL_NAMES = ['R','b2','2','b3','3','4','#4','5','b6','6','b7','7','(8)','b9','9'];

// =====================
// Grid Layout
// =====================
// Launchpad X Programmer mode:
//   8x8 grid: Note On/Off, note = (row+1)*10 + (col+1), i.e. 11-88
//   Top row (round): CC 91-98
//   Right column (round): Note 19, 29, 39, 49, 59, 69, 79, 89
// Musical layout: guitar-style, each row +5 semitones (perfect 4th)
const ROW_INTERVAL = 5;

// Top row CC assignments (Ableton Live style)
const CC_UP       = 91;  // Octave Up
const CC_DOWN     = 92;  // Octave Down
const CC_LEFT     = 93;  // Transpose -1
const CC_RIGHT    = 94;  // Transpose +1
// CC 95-98: reserved (future use)

// Right column note numbers
const RIGHT_COL_NOTES = [89, 79, 69, 59, 49, 39, 29, 19]; // top to bottom

// Top row labels for UI
const TOP_ROW_LABELS = ['OCT▲', 'OCT▼', '◄', '►', '', '', '', ''];
const TOP_ROW_CCS    = [91, 92, 93, 94, 95, 96, 97, 98];

function buildPadData(baseNote) {
  const pads = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const semitone = baseNote + row * ROW_INTERVAL + col;
      const pitchClass = ((semitone % 12) + 12) % 12;
      const launchpadNote = (row + 1) * 10 + (col + 1);
      pads.push({ row, col, semitone, pitchClass, launchpadNote });
    }
  }
  return pads;
}

// =====================
// State
// =====================
const state = {
  baseNote: 36,   // C2 default — shifted by octave/transpose
  root: 0,
  chordType: 'maj',
  inversion: 0,
  showScale: true,
  dimOthers: false,
  showInversion: false,
  scale: 'major',
  midiOutput: null,
  midiAccess: null,
};

let pads = buildPadData(state.baseNote);

// =====================
// DOM: Root buttons
// =====================
const rootContainer = document.getElementById('root-buttons');
NOTE_NAMES.forEach((name, i) => {
  const btn = document.createElement('button');
  btn.className = 'btn' + (i === 0 ? ' active' : '');
  btn.textContent = name;
  btn.onclick = () => { state.root = i; state.inversion = 0; updateAll(); setActive(rootContainer, btn); };
  rootContainer.appendChild(btn);
});

// =====================
// DOM: Chord type buttons
// =====================
const chordContainer = document.getElementById('chord-buttons');
Object.entries(CHORD_TYPES).forEach(([key, val]) => {
  const btn = document.createElement('button');
  btn.className = 'btn' + (key === 'maj' ? ' active' : '');
  btn.textContent = val.label;
  btn.onclick = () => { state.chordType = key; state.inversion = 0; updateAll(); setActive(chordContainer, btn); };
  chordContainer.appendChild(btn);
});

// =====================
// DOM: Scale buttons
// =====================
const scaleContainer = document.getElementById('scale-buttons');
Object.entries(SCALES).forEach(([key, val]) => {
  const btn = document.createElement('button');
  btn.className = 'btn' + (key === 'major' ? ' active' : '');
  btn.textContent = val.label;
  btn.onclick = () => { state.scale = key; updateAll(); setActive(scaleContainer, btn); };
  scaleContainer.appendChild(btn);
});

function setActive(container, activeBtn) {
  container.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
  activeBtn.classList.add('active');
}

// =====================
// DOM: Toggles
// =====================
document.getElementById('toggle-dim').onclick = function() {
  state.dimOthers = !state.dimOthers;
  this.classList.toggle('active', state.dimOthers);
  updateAll();
};
document.getElementById('toggle-scale').onclick = function() {
  state.showScale = !state.showScale;
  this.classList.toggle('active', state.showScale);
  document.getElementById('scale-control').style.display = state.showScale ? '' : 'none';
  document.getElementById('scale-key-label').style.display = state.showScale ? '' : 'none';
  updateAll();
};
document.getElementById('toggle-inversion').onclick = function() {
  state.showInversion = !state.showInversion;
  this.classList.toggle('active', state.showInversion);
  document.getElementById('inversion-control').style.display = state.showInversion ? '' : 'none';
  updateAll();
};

// =====================
// DOM: Pad grid (9x9: top row CCs + right column + 8x8 main)
// =====================
const gridEl = document.getElementById('pad-grid');
let padEls = [];       // indexed by padIdx (row*8+col) for main 8x8
const topRowEls = [];  // indexed 0-7 for CC 91-98
const rightColEls = []; // indexed 0-7 for right column (row 7 down to 0)

function buildGridDOM() {
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
      // top-right corner (empty)
      el.className = 'pad fn-corner';
    }
    gridEl.appendChild(el);
  }

  // --- Main 8x8 grid + right column ---
  for (let row = 7; row >= 0; row--) {
    // 8 main pads
    for (let col = 0; col < 8; col++) {
      const padIdx = row * 8 + col;
      const pad = pads[padIdx];
      const el = document.createElement('div');
      el.className = 'pad off';
      el.dataset.note = NOTE_NAMES[pad.pitchClass];
      el.title = `${NOTE_NAMES[pad.pitchClass]} (MIDI ${pad.semitone})`;
      el.onpointerdown = (e) => {
        e.preventDefault();
        playNote(pad.semitone);
        el.classList.add('pressed');
      };
      el.onpointerup = () => el.classList.remove('pressed');
      el.onpointerleave = () => el.classList.remove('pressed');
      gridEl.appendChild(el);
      padEls[padIdx] = el;
    }
    // Right column button
    const rcIdx = 7 - row; // top-to-bottom index
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
    rcEl.onpointerup = () => rcEl.classList.remove('pressed');
    rcEl.onpointerleave = () => rcEl.classList.remove('pressed');
    gridEl.appendChild(rcEl);
    rightColEls[rcIdx] = rcEl;
  }
}

buildGridDOM();

// --- Octave / Transpose handlers ---
function shiftOctave(delta) {
  const newBase = state.baseNote + delta * 12;
  if (newBase < 0 || newBase > 108) return;
  state.baseNote = newBase;
  rebuildPads();
  const noteName = NOTE_NAMES[state.baseNote % 12];
  const octave = Math.floor(state.baseNote / 12) - 1;
  log(`Octave → ${noteName}${octave} (base=${state.baseNote})`, 'out');
}

function shiftTranspose(delta) {
  const newBase = state.baseNote + delta;
  if (newBase < 0 || newBase > 115) return;
  state.baseNote = newBase;
  rebuildPads();
  const noteName = NOTE_NAMES[state.baseNote % 12];
  const octave = Math.floor(state.baseNote / 12) - 1;
  log(`Transpose → ${noteName}${octave} (base=${state.baseNote})`, 'out');
}

function rebuildPads() {
  pads = buildPadData(state.baseNote);
  // Update DOM data attributes and titles
  pads.forEach((pad, idx) => {
    if (padEls[idx]) {
      padEls[idx].dataset.note = NOTE_NAMES[pad.pitchClass];
      padEls[idx].title = `${NOTE_NAMES[pad.pitchClass]} (MIDI ${pad.semitone})`;
      // Rebind click with new semitone
      padEls[idx].onpointerdown = (e) => {
        e.preventDefault();
        playNote(pad.semitone);
        padEls[idx].classList.add('pressed');
      };
    }
  });
  updateBaseNoteDisplay();
  updateAll();
}

function updateBaseNoteDisplay() {
  const noteName = NOTE_NAMES[state.baseNote % 12];
  const octave = Math.floor(state.baseNote / 12) - 1;
  document.getElementById('scale-key-label').dataset.base = `${noteName}${octave}`;
}

function handleTopRowPress(index) {
  switch (TOP_ROW_CCS[index]) {
    case CC_UP:    shiftOctave(+1); break;
    case CC_DOWN:  shiftOctave(-1); break;
    case CC_LEFT:  shiftTranspose(-1); break;
    case CC_RIGHT: shiftTranspose(+1); break;
    default:
      log(`Top row CC${TOP_ROW_CCS[index]} pressed`, 'in');
  }
}

function handleRightColPress(index) {
  log(`Right col Note ${RIGHT_COL_NOTES[index]} pressed`, 'in');
}

// =====================
// Music Logic
// =====================
function getChordPitchClasses() {
  const intervals = CHORD_TYPES[state.chordType].intervals.map(i => i % 12);
  const raw = intervals.map(i => (state.root + i) % 12);
  const inv = state.showInversion ? state.inversion : 0;
  const inverted = [...raw.slice(inv), ...raw.slice(0, inv)];
  return { all: raw, inverted };
}

function getScalePitchClasses() {
  return SCALES[state.scale].intervals.map(i => (state.root + i) % 12);
}

function buildInversionButtons() {
  const row = document.getElementById('inversion-row');
  row.innerHTML = '';
  const n = CHORD_TYPES[state.chordType].intervals.length;
  const labels = ['基本形', '第1転', '第2転', '第3転', '第4転'];
  for (let i = 0; i < n; i++) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (i === state.inversion ? ' active' : '');
    btn.textContent = labels[i] || `転${i}`;
    btn.onclick = () => { state.inversion = i; updateAll(); setActive(row, btn); };
    row.appendChild(btn);
  }
}

// =====================
// Main Update
// =====================
function updateAll() {
  const maxInv = CHORD_TYPES[state.chordType].intervals.length - 1;
  if (state.inversion > maxInv) state.inversion = 0;
  buildInversionButtons();

  const chordPCs = getChordPitchClasses();
  const scalePCs = getScalePitchClasses();
  const rootPC = state.root;

  pads.forEach((pad, idx) => {
    const el = padEls[idx];
    const pc = pad.pitchClass;
    const isRoot = pc === rootPC && chordPCs.all.includes(pc);
    const isChord = chordPCs.all.includes(pc);
    const isScale = scalePCs.includes(pc);

    el.className = 'pad';
    if (isRoot) {
      el.classList.add('root');
    } else if (isChord) {
      el.classList.add('chord');
    } else if (state.showScale && isScale) {
      el.classList.add('scale-only');
    } else {
      el.classList.add(state.dimOthers ? 'dim' : 'off');
    }
  });

  // Chord display
  const sym = CHORD_TYPES[state.chordType].symbol;
  const rootName = NOTE_NAMES[state.root];
  document.getElementById('chord-name').textContent = rootName + sym;

  const noteNames = chordPCs.inverted.map(pc => NOTE_NAMES[pc]).join('  ');
  document.getElementById('chord-notes').textContent = noteNames;

  const ints = CHORD_TYPES[state.chordType].intervals;
  const intNames = ints.map(i => INTERVAL_NAMES[i] || `+${i}`);
  document.getElementById('chord-interval').textContent = intNames.join(' — ');

  // Scale label + base note info
  const baseNoteName = NOTE_NAMES[state.baseNote % 12];
  const baseOctave = Math.floor(state.baseNote / 12) - 1;
  const baseInfo = `[Base: ${baseNoteName}${baseOctave}]`;
  if (state.showScale) {
    document.getElementById('scale-key-label').textContent =
      `${rootName} ${SCALES[state.scale].label} Scale  ${baseInfo}`;
  } else {
    document.getElementById('scale-key-label').textContent = baseInfo;
  }

  // Send to Launchpad
  sendToLaunchpad(chordPCs.all, scalePCs, rootPC);
}

// =====================
// MIDI / Launchpad X
// =====================

// Launchpad X RGB SysEx colors (0-127)
const COLORS = {
  root:  [127, 0, 40],
  chord: [0, 100, 127],
  scale: [0, 127, 60],
  off:   [0, 0, 0],
  dim:   [0, 0, 0],
};

// =====================
// Event Log
// =====================
function log(msg, type) {
  const logDiv = document.getElementById('log');
  const entry = document.createElement('div');
  if (type) entry.className = 'log-' + type;
  const ts = new Date().toLocaleTimeString();
  entry.textContent = `[${ts}] ${msg}`;
  logDiv.appendChild(entry);
  logDiv.scrollTop = logDiv.scrollHeight;
  console.log(msg);
}

async function initMIDI() {
  const statusEl = document.getElementById('midi-status');
  const hintEl = document.getElementById('midi-hint');
  if (!navigator.requestMIDIAccess) {
    statusEl.textContent = 'WebMIDI 非対応 (Chrome推奨)';
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
    };
  } catch(e) {
    statusEl.textContent = 'MIDI アクセス拒否';
    statusEl.className = 'disconnected';
    hintEl.textContent = 'ブラウザがMIDIアクセスを拒否しました。アドレスバーの鍵アイコンからMIDI許可を確認してください。';
    hintEl.style.display = '';
    log('MIDI access denied: ' + e.message, 'err');
  }
}

function populateDevices(access) {
  const sel = document.getElementById('device-select');
  const statusEl = document.getElementById('midi-status');
  const hintEl = document.getElementById('midi-hint');
  const prev = sel.value;
  sel.innerHTML = '<option value="">-- デバイスを選択 --</option>';
  let autoSelected = false;
  let outputCount = 0;
  const deviceNames = [];

  for (const [id, output] of access.outputs) {
    // Skip disconnected ports
    if (output.state === 'disconnected') continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${output.name} [${output.state}]`;
    sel.appendChild(opt);
    deviceNames.push(output.name);
    outputCount++;
    // Auto-select Launchpad
    if (!autoSelected && output.name.toLowerCase().includes('launchpad')) {
      sel.value = id;
      autoSelected = true;
    }
  }

  // Restore previous selection if still available
  if (!autoSelected && prev) {
    const prevOpt = sel.querySelector(`option[value="${prev}"]`);
    if (prevOpt) sel.value = prev;
  }

  // Update status and hint based on device count
  if (outputCount === 0) {
    statusEl.textContent = 'デバイスなし — RESCANしてください';
    statusEl.className = 'disconnected';
    hintEl.innerHTML = 'MIDIデバイスが見つかりません。以下を確認してください：<br>'
      + '・Ableton Live等の他のアプリがMIDIポートを占有していないか（Windowsでは排他的）<br>'
      + '・USBケーブルが正しく接続されているか<br>'
      + '・他のアプリを閉じてからRESCANボタンを押してください';
    hintEl.style.display = '';
  } else {
    statusEl.textContent = `接続済み (${outputCount} デバイス)`;
    statusEl.className = 'connected';
    hintEl.style.display = 'none';
  }

  if (outputCount > 0) {
    log(`MIDI devices: ${deviceNames.join(', ')}`, 'out');
  } else {
    log('No MIDI devices found', 'err');
  }
  onDeviceSelect();
}

// Rescan button
document.getElementById('rescan-btn').onclick = async () => {
  const statusEl = document.getElementById('midi-status');
  statusEl.textContent = 'RESCAN 中...';
  statusEl.className = 'searching';
  // Re-request MIDI access to force refresh
  try {
    const access = await navigator.requestMIDIAccess({ sysex: true });
    state.midiAccess = access;
    populateDevices(access);
    setupMIDIInput(access);
    access.onstatechange = (e) => {
      console.log('MIDI state change:', e.port.name, e.port.state);
      populateDevices(access);
      setupMIDIInput(access);
    };
  } catch(e) {
    statusEl.textContent = 'MIDI アクセス拒否';
    statusEl.className = 'disconnected';
  }
};

document.getElementById('device-select').onchange = onDeviceSelect;

function onDeviceSelect() {
  const id = document.getElementById('device-select').value;
  if (id && state.midiAccess) {
    const output = state.midiAccess.outputs.get(id);
    if (output && output.state === 'connected') {
      state.midiOutput = output;
      document.getElementById('send-btn').disabled = false;
      document.getElementById('clear-btn').disabled = false;
      setProgrammerMode();
      setTimeout(() => updateAll(), 100);
    } else {
      state.midiOutput = null;
      document.getElementById('send-btn').disabled = true;
      document.getElementById('clear-btn').disabled = true;
    }
  } else {
    state.midiOutput = null;
    document.getElementById('send-btn').disabled = true;
    document.getElementById('clear-btn').disabled = true;
  }
}

function setProgrammerMode() {
  if (!state.midiOutput) return;
  state.midiOutput.send([0xF0, 0x00, 0x20, 0x29, 0x02, 0x0C, 0x0E, 0x01, 0xF7]);
  log('SysEx → Programmer Mode', 'out');
}

function sendToLaunchpad(chordPCs, scalePCs, rootPC) {
  if (!state.midiOutput) return;

  // SysEx RGB lighting: F0 00 20 29 02 0C 03 [03 pad r g b] ... F7
  const data = [0xF0, 0x00, 0x20, 0x29, 0x02, 0x0C, 0x03];

  pads.forEach(pad => {
    const pc = pad.pitchClass;
    const isRoot = pc === rootPC && chordPCs.includes(pc);
    const isChord = chordPCs.includes(pc);
    const isScale = scalePCs.includes(pc);

    let color;
    if (isRoot)                          color = COLORS.root;
    else if (isChord)                    color = COLORS.chord;
    else if (state.showScale && isScale) color = COLORS.scale;
    else                                 color = state.dimOthers ? COLORS.dim : COLORS.off;

    data.push(0x03, pad.launchpadNote, color[0], color[1], color[2]);
  });

  // Top row buttons — light up OCT▲, OCT▼, ◄, ► in orange
  const fnColor = [60, 30, 0];   // warm orange
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

// Manual send button
document.getElementById('send-btn').onclick = () => updateAll();

// Clear all LEDs
document.getElementById('clear-btn').onclick = () => {
  if (!state.midiOutput) return;
  const data = [0xF0, 0x00, 0x20, 0x29, 0x02, 0x0C, 0x03];
  pads.forEach(pad => {
    data.push(0x03, pad.launchpadNote, 0, 0, 0);
  });
  // Also clear top row and right column
  TOP_ROW_CCS.forEach(cc => data.push(0x03, cc, 0, 0, 0));
  RIGHT_COL_NOTES.forEach(n => data.push(0x03, n, 0, 0, 0));
  data.push(0xF7);
  try { state.midiOutput.send(data); } catch(e) {}
  log('All LEDs cleared', 'out');
};

// =====================
// Web Audio Synth
// =====================
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function midiNoteToFreq(midiNote) {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function getVolume() {
  return parseInt(document.getElementById('volume').value) / 100;
}

document.getElementById('volume').oninput = function() {
  document.getElementById('volume-label').textContent = this.value + '%';
};

function playNote(midiNote, velocity) {
  const ctx = getAudioCtx();
  const vol = getVolume() * (velocity !== undefined ? velocity / 127 : 1);
  if (vol <= 0) return;

  const freq = midiNoteToFreq(midiNote);
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, now);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(freq, now);
  osc2.detune.setValueAtTime(6, now);

  const gain = ctx.createGain();
  const peakVol = vol * 0.25;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peakVol, now + 0.01);
  gain.gain.linearRampToValueAtTime(peakVol * 0.7, now + 0.08);
  gain.gain.linearRampToValueAtTime(peakVol * 0.5, now + 0.3);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

  osc.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc2.start(now);
  osc.stop(now + 1.3);
  osc2.stop(now + 1.3);
}

// =====================
// MIDI Input (Launchpad → sound + control)
// =====================
function getLaunchpadSemitone(note) {
  const pad = pads.find(p => p.launchpadNote === note);
  return pad ? pad.semitone : undefined;
}

function setupMIDIInput(access) {
  for (const input of access.inputs.values()) {
    input.onmidimessage = (event) => {
      const [status, data1, data2] = event.data;

      // --- CC messages (top row + right column buttons) ---
      if ((status & 0xF0) === 0xB0 && data2 > 0) {
        // Top row CC 91-98
        const ccIdx = TOP_ROW_CCS.indexOf(data1);
        if (ccIdx >= 0) {
          log(`CC IN: CC${data1} val=${data2} (top row)`, 'in');
          handleTopRowPress(ccIdx);
          if (topRowEls[ccIdx]) {
            topRowEls[ccIdx].classList.add('fn-active');
            setTimeout(() => topRowEls[ccIdx].classList.remove('fn-active'), 200);
          }
          return;
        }
        // Right column CC 19,29,...,89
        const rcIdx = RIGHT_COL_NOTES.indexOf(data1);
        if (rcIdx >= 0) {
          log(`CC IN: CC${data1} val=${data2} (right col)`, 'in');
          handleRightColPress(rcIdx);
          if (rightColEls[rcIdx]) {
            rightColEls[rcIdx].classList.add('fn-active');
            setTimeout(() => rightColEls[rcIdx].classList.remove('fn-active'), 200);
          }
          return;
        }
        log(`CC IN: CC${data1} val=${data2} (unknown)`, 'in');
        return;
      }

      // --- Note On ---
      if ((status & 0xF0) === 0x90 && data2 > 0) {
        // Right column as Note (fallback — some firmware versions)
        const rcIdx = RIGHT_COL_NOTES.indexOf(data1);
        if (rcIdx >= 0) {
          log(`Right col IN: Note ${data1} vel=${data2}`, 'in');
          handleRightColPress(rcIdx);
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
          playNote(semitone, data2);
          const padIdx = pads.findIndex(p => p.launchpadNote === data1);
          if (padIdx >= 0 && padEls[padIdx]) {
            padEls[padIdx].classList.add('pressed');
            setTimeout(() => padEls[padIdx].classList.remove('pressed'), 150);
          }
        }
        return;
      }
    };
  }
}

// =====================
// Init
// =====================
log('App started');
initMIDI();
updateAll();
