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

// =====================
// Pad Classification (DOM・LED 両方に使う純粋関数)
// =====================
// 戻り値: 'root' | 'bass' | 'chord' | 'scale' | 'off'
export function classifyPad(pc, rootPC, chordAll, scalePCs, bassPC, showChord, showScale) {
  if (pc === rootPC) return 'root';
  if (showChord && bassPC !== null && pc === bassPC) return 'bass';
  if (showChord && chordAll.includes(pc)) return 'chord';
  if (showScale && scalePCs.includes(pc)) return 'scale';
  return 'off';
}

// =====================
// Chord Display Data (DOM更新は呼び出し元が行う)
// =====================
export function getChordDisplayData() {
  const chordPCs = getChordPitchClasses();
  const sym = CHORD_TYPES[state.chordType].symbol;
  const rootName = NOTE_NAMES[state.root];
  const bassName = chordPCs.bassPC !== null ? '/' + NOTE_NAMES[chordPCs.bassPC] : '';
  const noteNames = chordPCs.inverted.map(pc => NOTE_NAMES[pc]).join('  ');
  const ints = CHORD_TYPES[state.chordType].intervals;
  const intNames = ints.map(i => INTERVAL_NAMES[i] || `+${i}`).join(' — ');
  const baseNoteName = NOTE_NAMES[state.baseNote % 12];
  const baseOctave = Math.floor(state.baseNote / 12) - 1;
  const baseInfo = `[Base: ${baseNoteName}${baseOctave}]`;
  const scaleKeyLabel = state.showScale
    ? `${rootName} ${SCALES[state.scale].label} Scale  ${baseInfo}`
    : baseInfo;
  return { chordName: rootName + sym + bassName, noteNames, intNames, scaleKeyLabel };
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
    el.innerHTML = '<span class="detected-chord-empty">—</span>';
    return;
  }

  const html = matches.map(m => {
    const name = NOTE_NAMES[m.root] + m.typeDef.symbol + (m.bassText ? '/' + m.bassText : '');
    return `<span class="detected-chord-name${m.isExact ? ' exact' : ''}">${name}</span>`;
  }).join('<span class="detected-chord-sep"> / </span>');

  el.innerHTML = html;
}
