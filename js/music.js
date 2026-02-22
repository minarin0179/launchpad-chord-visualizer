import { CHORD_TYPES, SCALES, NOTE_NAMES, INTERVAL_NAMES } from './constants.js';
import { state } from './state.js';

// =====================
// Music Logic
// =====================
export function getChordPitchClasses() {
  const intervals = CHORD_TYPES[state.chordType].intervals.map(i => i % 12);
  const raw = intervals.map(i => (state.root + i) % 12);
  const inv = state.showInversion ? state.inversion : 0;
  const inverted = [...raw.slice(inv), ...raw.slice(0, inv)];
  const bassPC = inv > 0 ? inverted[0] : null;
  return { all: raw, inverted, bassPC };
}

export function getScalePitchClasses() {
  return SCALES[state.scale].intervals.map(i => (state.root + i) % 12);
}

// onUpdate: inversion ボタン押下時に呼ぶコールバック（通常は updateAll）
export function buildInversionButtons(onUpdate) {
  const row = document.getElementById('inversion-row');
  row.innerHTML = '';
  const n = CHORD_TYPES[state.chordType].intervals.length;
  const labels = ['Root', '1st', '2nd', '3rd', '4th'];
  for (let i = 0; i < n; i++) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (i === state.inversion ? ' active' : '');
    btn.textContent = labels[i] || `${i}th`;
    btn.onclick = () => { state.inversion = i; if (onUpdate) onUpdate(); };
    row.appendChild(btn);
  }
}

// コード表示テキストを更新（#chord-name / #chord-notes / #chord-interval / #scale-key-label）
export function updateChordDisplay() {
  const chordPCs = getChordPitchClasses();
  const sym = CHORD_TYPES[state.chordType].symbol;
  const rootName = NOTE_NAMES[state.root];
  const bassName = chordPCs.bassPC !== null ? '/' + NOTE_NAMES[chordPCs.bassPC] : '';
  document.getElementById('chord-name').textContent = rootName + sym + bassName;

  const noteNames = chordPCs.inverted.map(pc => NOTE_NAMES[pc]).join('  ');
  document.getElementById('chord-notes').textContent = noteNames;

  const ints = CHORD_TYPES[state.chordType].intervals;
  const intNames = ints.map(i => INTERVAL_NAMES[i] || `+${i}`);
  document.getElementById('chord-interval').textContent = intNames.join(' — ');

  const baseNoteName = NOTE_NAMES[state.baseNote % 12];
  const baseOctave = Math.floor(state.baseNote / 12) - 1;
  const baseInfo = `[Base: ${baseNoteName}${baseOctave}]`;
  if (state.showScale) {
    document.getElementById('scale-key-label').textContent =
      `${rootName} ${SCALES[state.scale].label} Scale  ${baseInfo}`;
  } else {
    document.getElementById('scale-key-label').textContent = baseInfo;
  }
}

// =====================
// Chord Detection
// =====================

// activeNotes: Map (midiNote → {...}) — audio.js の activeNotes を引数で受け取る
export function detectChordFromActiveNotes(activeNotes) {
  const pressedMidiNotes = Array.from(activeNotes.keys());

  if (pressedMidiNotes.length < 2) {
    displayDetectedChords([]);
    return;
  }

  const pressedPCSet = new Set(pressedMidiNotes.map(n => ((n % 12) + 12) % 12));
  const pressedPCs = Array.from(pressedPCSet);
  const lowestNote = Math.min(...pressedMidiNotes);
  const lowestPC = ((lowestNote % 12) + 12) % 12;

  const matches = [];

  for (const [, typeDef] of Object.entries(CHORD_TYPES)) {
    const normalizedIntervals = [...new Set(typeDef.intervals.map(i => i % 12))];

    for (let root = 0; root < 12; root++) {
      const chordPCSet = new Set(normalizedIntervals.map(i => (root + i) % 12));
      const chordPCs = Array.from(chordPCSet);

      const isExact = pressedPCs.length === chordPCs.length &&
        chordPCs.every(pc => pressedPCSet.has(pc));
      const isSubset = !isExact && chordPCs.length >= 3 &&
        chordPCs.every(pc => pressedPCSet.has(pc)) &&
        pressedPCs.length > chordPCs.length;

      if (!isExact && !isSubset) continue;

      let bassText = null;
      if (lowestPC !== root) {
        bassText = NOTE_NAMES[lowestPC];
      }

      matches.push({ root, typeDef, isExact, isRoot: lowestPC === root, bassText, noteCount: chordPCs.length });
    }
  }

  matches.sort((a, b) => {
    if (a.isExact !== b.isExact) return b.isExact - a.isExact;
    if (a.noteCount !== b.noteCount) return a.noteCount - b.noteCount;
    return b.isRoot - a.isRoot;
  });

  displayDetectedChords(matches.slice(0, 3));
}

export function displayDetectedChords(matches) {
  const el = document.getElementById('detected-chord-names');
  if (!el) return;

  if (matches.length === 0) {
    el.innerHTML = '<span style="color:var(--text-muted)">—</span>';
    return;
  }

  const html = matches.map(m => {
    const name = NOTE_NAMES[m.root] + m.typeDef.symbol + (m.bassText ? '/' + m.bassText : '');
    const color = m.isExact ? 'var(--chord-color)' : 'var(--text-muted)';
    return `<span style="color:${color}">${name}</span>`;
  }).join('<span style="color:var(--border)"> / </span>');

  el.innerHTML = html;
}
