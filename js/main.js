// ES Modules: 全 import はファイル先頭にまとめる
import { NOTE_NAMES, CHORD_TYPES, SCALES, INSTRUMENTS,
         CLICK_PAD_VELOCITY, BPM_MIN, BPM_MAX, BPM_DEFAULT,
         LOGO_FLASH_MS, METRO_LOGO_ACCENT, METRO_LOGO_NORMAL, LOGO_GREEN } from './constants.js';
import { state, pads } from './state.js';
import { log } from './logger.js';
import { startNote, stopNote, getActiveNotes, playMetronomeClick } from './audio.js';
import { getChordPitchClasses, getScalePitchClasses, classifyPad,
         detectChordFromActiveNotes, getChordDisplayData } from './music.js';
import { sendToLaunchpad, flashPressedPad, updateLogoLED, sendLogoLED, clearAllLEDs } from './led.js';
import { buildGridDOM, handleTopRowPress, handleRightColPress,
         shiftCapo, padEls } from './grid.js';
import { initMIDI, onDeviceSelect, rescanMIDI } from './midi.js';

// メトロノーム内部状態（公開 state に含めない）
let _metroTimer = null;
let _metroBeat  = 0;

// updateAll() で前回の視覚状態と比較するためのキャッシュ
let _prevUpdateKey = null;

// =====================
// Volume (DOM への直接依存を audio.js から分離)
// =====================
function getVolume() {
  return parseInt(document.getElementById('volume').value) / 100;
}

// =====================
// Note change callback (audio → chord detection)
// =====================
function handleNoteChange() {
  detectChordFromActiveNotes(getActiveNotes());
}

// =====================
// Inversion buttons (music.js からの DOM 操作を移管)
// =====================
const INVERSION_LABELS = ['Root', '1st', '2nd', '3rd', '4th'];

function buildInversionButtons() {
  const row = document.getElementById('inversion-row');
  row.innerHTML = '';
  const n = CHORD_TYPES[state.chordType].intervals.length;
  for (let i = 0; i < n; i++) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (i === state.inversion ? ' active' : '');
    btn.textContent = INVERSION_LABELS[i] || `${i}th`;
    btn.onclick = () => { state.inversion = i; updateAll(); };
    row.appendChild(btn);
  }
}

// =====================
// Main Update (central hub)
// =====================
function updateAll() {
  const maxInv = CHORD_TYPES[state.chordType].intervals.length - 1;
  if (state.inversion > maxInv) state.inversion = 0;

  const chordPCs = getChordPitchClasses();
  const scalePCs = getScalePitchClasses();
  const rootPC   = state.root;

  // 視覚状態のキーを生成し、変化がなければ DOM 更新をスキップ
  // （SENDボタン用に LED 送信は常時実行）
  const key = `${rootPC}|${state.chordType}|${state.inversion}|${state.showChord}|${state.showScale}|${state.showInversion}|${state.scale}|${state.baseNote}`;
  if (key !== _prevUpdateKey) {
    _prevUpdateKey = key;

    // Inversion ボタン再構築
    buildInversionButtons();

    // パッドDOMクラス更新（classifyPad で統一）
    pads.forEach((pad, idx) => {
      const el = padEls[idx];
      if (!el) return;
      const cls = classifyPad(pad.pitchClass, rootPC, chordPCs.all, scalePCs, chordPCs.bassPC, state.showChord, state.showScale);
      el.className = `pad ${cls}`;
    });

    // ルートボタン active 状態（grid.js の shiftCapo からの DOM 操作を移管）
    document.getElementById('root-buttons').querySelectorAll('.btn')
      .forEach((b, i) => b.classList.toggle('active', i === rootPC));

    // コード表示テキスト（music.js の updateChordDisplay からの DOM 操作を移管）
    const d = getChordDisplayData();
    document.getElementById('chord-name').textContent      = d.chordName;
    document.getElementById('chord-notes').textContent     = d.noteNames;
    document.getElementById('chord-interval').textContent  = d.intNames;
    document.getElementById('scale-key-label').textContent = d.scaleKeyLabel;
  }

  sendToLaunchpad(chordPCs.all, scalePCs, rootPC, chordPCs.bassPC);
}

// =====================
// Metronome
// =====================
function metronomeBeat() {
  const isAccent = _metroBeat === 0;
  _metroBeat = (_metroBeat + 1) % 4;

  const [r, g, b] = isAccent ? METRO_LOGO_ACCENT : METRO_LOGO_NORMAL;
  sendLogoLED(r, g, b);
  setTimeout(() => { if (state.midiOutput) sendLogoLED(...LOGO_GREEN); }, LOGO_FLASH_MS);

  playMetronomeClick(isAccent);
}

function startMetronome() {
  if (_metroTimer) clearInterval(_metroTimer);
  _metroBeat = 0;
  const ms = (60 / state.bpm) * 1000;
  metronomeBeat();
  _metroTimer = setInterval(metronomeBeat, ms);
  state.metronome = true;
  const btn = document.getElementById('metro-btn');
  btn.classList.add('active');
  btn.textContent = '■ STOP';
  log(`Metronome ON — ${state.bpm} BPM`, 'out');
}

function stopMetronome() {
  if (_metroTimer) { clearInterval(_metroTimer); _metroTimer = null; }
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

// items: { key, label }[] の配列を受け取りボタン群を生成する汎用ヘルパー
function buildButtonGroup(containerId, items, activeKey, onClick) {
  const container = document.getElementById(containerId);
  items.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className = 'btn' + (key === activeKey ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => { onClick(key); setActive(container, btn); };
    container.appendChild(btn);
  });
}

// =====================
// DOM: Root / Chord / Scale / Instrument buttons
// =====================
buildButtonGroup(
  'root-buttons',
  NOTE_NAMES.map((name, i) => ({ key: i, label: name })),
  0,
  (i) => { state.root = i; state.inversion = 0; updateAll(); }
);

buildButtonGroup(
  'chord-buttons',
  Object.entries(CHORD_TYPES).map(([key, val]) => ({ key, label: val.label })),
  'maj',
  (key) => { state.chordType = key; state.inversion = 0; updateAll(); }
);

buildButtonGroup(
  'scale-buttons',
  Object.entries(SCALES).map(([key, val]) => ({ key, label: val.label })),
  'major',
  (key) => { state.scale = key; updateAll(); }
);

buildButtonGroup(
  'instrument-buttons',
  Object.entries(INSTRUMENTS).map(([key, val]) => ({ key, label: val.label })),
  state.instrument,
  (key) => { state.instrument = key; }
);

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
  const v = Math.min(BPM_MAX, Math.max(BPM_MIN, parseInt(this.value) || BPM_DEFAULT));
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
    await rescanMIDI();
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
    startNote(pad.semitone, CLICK_PAD_VELOCITY, getVolume(), handleNoteChange);
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
  onNoteOn:        (semitone, velocity) => startNote(semitone, velocity, getVolume(), handleNoteChange),
  onNoteOff:       (semitone) => stopNote(semitone, handleNoteChange),
  onFlash:         flashPressedPad,
  onTopRow:        handleTopRowPress,
  onRightCol:      handleRightColPress,
});

log('App started');
updateAll();
