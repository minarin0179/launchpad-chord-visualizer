// ES Modules: 全 import はファイル先頭にまとめる
import { NOTE_NAMES, CHORD_TYPES, SCALES, INSTRUMENTS, INVERSION_LABELS,
         CLICK_PAD_VELOCITY, BPM_MIN, BPM_MAX, BPM_DEFAULT,
         LOGO_FLASH_MS, METRO_LOGO_ACCENT, METRO_LOGO_NORMAL, LOGO_GREEN,
         MAX_BASE_NOTE_CAPO, buildPadData } from './constants.js';
import { state, pads, setPads } from './state.js';
import { log } from './logger.js';
import { startNote, stopNote, getActiveNotes, playMetronomeClick,
         selectInstrument, getAudioCtx } from './audio.js';
import { setSamplerStatusCallback, getSampleDestination } from './sampler.js';
import { createPadClassifier, detectChordFromActiveNotes, getChordDisplayData } from './music.js';
import { sendToLaunchpad, flashPressedPad, updateLogoLED, sendLogoLED, clearAllLEDs } from './led.js';
import { buildGridDOM, handleTopRowPress, handleRightColPress,
         shiftCapo, padEls, updateCapoDisplay, updateBaseNoteDisplay } from './grid.js';
import { initMIDI, onDeviceSelectByUser, rescanMIDI, rebuildPadMap } from './midi.js';
import { initSong, pauseFollow } from './song.js';
import { loadSettings, saveSettings } from './settings.js';

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
function buildInversionButtons() {
  const row = document.getElementById('inversion-row');
  row.innerHTML = '';
  const n = CHORD_TYPES[state.chordType].intervals.length;
  for (let i = 0; i < n; i++) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (i === state.inversion ? ' active' : '');
    btn.textContent = INVERSION_LABELS[i] || `${i}th`;
    btn.onclick = () => { pauseFollow(); state.inversion = i; updateAll(); };
    row.appendChild(btn);
  }
}

// =====================
// Main Update (central hub)
// =====================
// quiet: LED 送信のログを出さない（Song の FOLLOW による頻繁な更新用）
function updateAll({ quiet = false } = {}) {
  const maxInv = CHORD_TYPES[state.chordType].intervals.length - 1;
  if (state.inversion > maxInv) state.inversion = 0;

  // 視覚状態のキーを生成し、変化がなければ DOM 更新をスキップ
  // （SENDボタン用に LED 送信は常時実行）
  const key = [state.root, state.chordType, state.inversion, state.showChord, state.showScale,
    state.showInversion, state.scale, state.baseNote, state.scaleRoot, state.practice,
    JSON.stringify(state.chordOverride), JSON.stringify(state.preview)].join('|');
  if (key !== _prevUpdateKey) {
    _prevUpdateKey = key;

    // Inversion ボタン再構築
    buildInversionButtons();

    // パッドDOMクラス更新（createPadClassifier で LED と統一。予告の点滅は CSS アニメーション）
    const classify = createPadClassifier();
    pads.forEach((pad, idx) => {
      const el = padEls[idx];
      if (!el) return;
      el.className = `pad ${classify(pad.pitchClass, pad)}`;
    });

    // Root / Chord / Scale ボタンの active 状態（Song の FOLLOW でも変わるので毎回同期）
    const noChord = !!state.chordOverride?.none;
    document.getElementById('root-buttons').querySelectorAll('.btn')
      .forEach((b, i) => b.classList.toggle('active', !noChord && i === state.root));
    document.getElementById('chord-buttons').querySelectorAll('.btn')
      .forEach(b => b.classList.toggle('active', !noChord && b.dataset.key === state.chordType));
    document.getElementById('scale-buttons').querySelectorAll('.btn')
      .forEach(b => b.classList.toggle('active', b.dataset.key === state.scale));

    // コード表示テキスト（music.js の updateChordDisplay からの DOM 操作を移管）
    const d = getChordDisplayData();
    document.getElementById('chord-name').textContent      = d.chordName;
    document.getElementById('chord-notes').textContent     = d.noteNames;
    document.getElementById('chord-interval').textContent  = d.intNames;
    document.getElementById('scale-key-label').textContent = d.scaleKeyLabel;
  }

  sendToLaunchpad({ quiet });
  persistSettings();
}

// =====================
// Settings（localStorage に保存してリロード後に復元）
// =====================
// トグル: [ボタンID, state キー, OFF で隠す要素ID]
const TOGGLES = [
  ['toggle-chord',     'showChord',     ['chord-control']],
  ['toggle-scale',     'showScale',     ['scale-control', 'scale-key-label']],
  ['toggle-inversion', 'showInversion', ['inversion-control']],
];

function applyToggleDOM(toggleId, stateKey, controlIds) {
  document.getElementById(toggleId).classList.toggle('active', state[stateKey]);
  controlIds.forEach(id => document.getElementById(id).classList.toggle('hidden', !state[stateKey]));
}

function setVolumeDOM(v) {
  document.getElementById('volume').value = v;
  document.getElementById('volume-label').textContent = v + '%';
}

function setBpmDOM(v) {
  document.getElementById('metro-bpm').value = v;
  document.getElementById('metro-bpm-num').value = v;
}

// ボタン群・グリッドを作る前に state と DOM へ反映する
function restoreSettings() {
  const s = loadSettings();
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (isInt(s.root, 0, 11)) state.root = s.root;
  if (typeof s.chordType === 'string' && CHORD_TYPES[s.chordType]) state.chordType = s.chordType;
  if (isInt(s.inversion, 0, CHORD_TYPES[state.chordType].intervals.length - 1)) state.inversion = s.inversion;
  if (typeof s.scale === 'string' && SCALES[s.scale]) state.scale = s.scale;
  if (typeof s.instrument === 'string' && INSTRUMENTS[s.instrument]) state.instrument = s.instrument;
  for (const [id, key, controls] of TOGGLES) {
    if (typeof s[key] === 'boolean') state[key] = s[key];
    applyToggleDOM(id, key, controls);
  }
  if (isInt(s.baseNote, 0, MAX_BASE_NOTE_CAPO) && Number.isInteger(s.capo)) {
    state.baseNote = s.baseNote;
    state.capo = s.capo;
    setPads(buildPadData(state.baseNote));
  }
  if (isInt(s.volume, 0, 100)) setVolumeDOM(s.volume);
  if (isInt(s.bpm, BPM_MIN, BPM_MAX)) { state.bpm = s.bpm; setBpmDOM(s.bpm); }
}

// FOLLOW 中の root / chordType / inversion は曲が決めた値なので保存しない（最後に手で選んだ値を残す）
function persistSettings() {
  const s = {
    scale: state.scale,
    instrument: state.instrument,
    showChord: state.showChord,
    showScale: state.showScale,
    showInversion: state.showInversion,
    baseNote: state.baseNote,
    capo: state.capo,
    volume: parseInt(document.getElementById('volume').value),
    bpm: state.bpm,
  };
  if (!state.follow) Object.assign(s, { root: state.root, chordType: state.chordType, inversion: state.inversion });
  saveSettings(s);
}

restoreSettings();

// =====================
// Metronome
// =====================
function metronomeBeat() {
  const isAccent = _metroBeat === 0;
  _metroBeat = (_metroBeat + 1) % 4;

  const [r, g, b] = isAccent ? METRO_LOGO_ACCENT : METRO_LOGO_NORMAL;
  sendLogoLED(r, g, b);
  setTimeout(() => { if (state.device) sendLogoLED(...LOGO_GREEN); }, LOGO_FLASH_MS);

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
    btn.dataset.key = key;
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
  state.root,
  (i) => { pauseFollow(); state.root = i; state.inversion = 0; updateAll(); }
);

buildButtonGroup(
  'chord-buttons',
  Object.entries(CHORD_TYPES).map(([key, val]) => ({ key, label: val.label })),
  state.chordType,
  (key) => { pauseFollow(); state.chordType = key; state.inversion = 0; updateAll(); }
);

buildButtonGroup(
  'scale-buttons',
  Object.entries(SCALES).map(([key, val]) => ({ key, label: val.label })),
  state.scale,
  (key) => { state.scale = key; updateAll(); }
);

buildButtonGroup(
  'instrument-buttons',
  Object.entries(INSTRUMENTS).map(([key, val]) => ({ key, label: val.label })),
  state.instrument,
  (key) => { selectInstrument(key); persistSettings(); }
);

// =====================
// Sampled instrument load status
// =====================
const soundStatusEl = document.getElementById('sound-status');

function showSoundStatus(text) {
  soundStatusEl.textContent = text || '';
  soundStatusEl.classList.toggle('hidden', !text);
}

setSamplerStatusCallback((instrumentKey, status) => {
  const label = (INSTRUMENTS[instrumentKey] || {}).label || instrumentKey;
  const btn = document.querySelector(`#instrument-buttons .btn[data-key="${instrumentKey}"]`);
  if (btn) btn.classList.toggle('loading', status === 'loading');

  if (status === 'loading')     showSoundStatus(`Loading ${label} samples…`);
  else if (status === 'failed') showSoundStatus(`${label}: samples unavailable — using synth`);
  else if (instrumentKey === state.instrument) showSoundStatus('');
});

// 起動時に初期音色のサンプルを先読み（AudioContext が suspended でもデコードは進む）
selectInstrument(state.instrument);

// =====================
// DOM: Toggles
// =====================
for (const [toggleId, stateKey, controlIds] of TOGGLES) {
  document.getElementById(toggleId).onclick = () => {
    state[stateKey] = !state[stateKey];
    applyToggleDOM(toggleId, stateKey, controlIds);
    updateAll();
  };
}

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
  const ctx = getAudioCtx();
  if (ctx) getSampleDestination(ctx).gain.value = getVolume();
  persistSettings();
};

document.getElementById('metro-bpm').oninput = function() {
  state.bpm = parseInt(this.value);
  document.getElementById('metro-bpm-num').value = this.value;
  if (state.metronome) startMetronome();
  persistSettings();
};

document.getElementById('metro-bpm-num').onchange = function() {
  const v = Math.min(BPM_MAX, Math.max(BPM_MIN, parseInt(this.value) || BPM_DEFAULT));
  this.value = v;
  state.bpm = v;
  document.getElementById('metro-bpm').value = v;
  if (state.metronome) startMetronome();
  persistSettings();
};

document.getElementById('metro-btn').onclick = () => {
  if (state.metronome) stopMetronome();
  else if (state.device) startMetronome();
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

document.getElementById('device-select').onchange = onDeviceSelectByUser;

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
  () => { rebuildPadMap(); updateAll(); }  // onAfterRebuild (rebuildPads 後に呼ばれる)
);
updateCapoDisplay();       // 復元したカポ・オクターブを表示に反映
updateBaseNoteDisplay();

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

initSong({
  onUpdate: updateAll,
  onLEDs:   () => sendToLaunchpad({ quiet: true }),
});

log('App started');
updateAll();
