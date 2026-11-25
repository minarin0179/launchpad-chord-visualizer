import { CHORD_TYPES, SCALES, NOTE_NAMES, INTERVAL_NAMES, ROW_INTERVAL, PRACTICE_ANCHOR } from './constants.js';
import { state } from './state.js';

// =====================
// Music Logic
// =====================
// FOLLOW 中は state.chordOverride で CHORD_TYPES に無い構成音・分数コードのベース・N.C. を表す
export function getChordPitchClasses() {
  const ov = state.chordOverride;
  if (ov?.none) return { all: [], inverted: [], bassPC: null };
  const intervals = (ov?.intervals ?? CHORD_TYPES[state.chordType].intervals).map(i => i % 12);
  const raw = intervals.map(i => (state.root + i) % 12);
  const inv = state.showInversion ? state.inversion : 0;
  const inverted = [...raw.slice(inv), ...raw.slice(0, inv)];
  let bassPC = inv > 0 ? inverted[0] : null;
  if (ov?.bassPC != null && ov.bassPC !== state.root) bassPC = ov.bassPC;
  return { all: raw, inverted, bassPC };
}

// 点灯させるルート音（N.C. の間は null）
export function getRootPC() {
  return state.chordOverride?.none ? null : state.root;
}

export function getScaleRootPC() {
  return state.scaleRoot ?? state.root;
}

export function getScalePitchClasses() {
  const root = getScaleRootPC();
  return SCALES[state.scale].intervals.map(i => (root + i) % 12);
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

// 現在の state からピッチクラス → 表示種別を返す関数を作る（DOM・LED 共通）
// 次のコードの予告は、今のコードで光っていないパッドにだけ重ねる。
// ledPhase=true のときは state.previewLit（点滅の消灯フェーズ）も反映する
// 練習モードで光らせる音（MIDI ノート番号 → 'root' / 'chord' / 'bass' の Map。色は音名ではなく音の高さごとの役割で決める）
// - 通常: ルートを基準パッド（PRACTICE_ANCHOR、デフォルト配置なら C3）から 1 オクターブ以内に置き、基本形で積む
//   （9th などはオクターブを超えたまま）
// - 分数コード: 転回形。ベースを同じ範囲に置き、残りの構成音をベースのすぐ上に密集して積む（C/E → E G C）
// 同じ音が出るパッドは全部光らせる（どこで押さえるかは弾く人が選べる）。カポ・オクターブで範囲も動く（形は固定）
function practiceNotes() {
  const ov = state.chordOverride;
  const rootPC = getRootPC();
  if (rootPC === null) return new Map();
  const anchor = state.baseNote + PRACTICE_ANCHOR.row * ROW_INTERVAL + PRACTICE_ANCHOR.col;
  const above = (pc, from) => from + ((((pc - from) % 12) + 12) % 12);  // from 以上で最も近い pc の音
  const intervals = ov?.intervals ?? CHORD_TYPES[state.chordType].intervals;
  const roleOf = (i) => (i === 0 ? 'root' : 'chord');
  const bassPC = ov?.bassPC;

  if (bassPC != null && bassPC !== rootPC) {
    const bass = above(bassPC, anchor);
    const notes = new Map([[bass, 'bass']]);
    for (const i of intervals) {
      const pc = (rootPC + i) % 12;
      if (pc !== bassPC) notes.set(above(pc, bass + 1), roleOf(i));
    }
    return notes;
  }
  const root = above(rootPC, anchor);
  return new Map(intervals.map(i => [root + i, roleOf(i)]));
}

// classify(pc, pad?) — 練習モードは pad を渡したときだけ位置で絞り込む
export function createPadClassifier({ ledPhase = false } = {}) {
  const chord = getChordPitchClasses();
  const scalePCs = getScalePitchClasses();
  const rootPC = getRootPC();
  const p = state.preview;
  // 練習モードは弾くコードだけ（コードトーンは常に表示、スケールは消灯）
  const showChord = state.showChord || state.practice;
  const showScale = state.showScale && !state.practice;
  const showPreview = p && showChord && (!ledPhase || state.previewLit);
  const practice = state.practice ? practiceNotes() : null;
  return (pc, pad) => {
    if (practice && pad) return practice.get(pad.semitone) ?? 'off';
    const cls = classifyPad(pc, rootPC, chord.all, scalePCs, chord.bassPC, showChord, showScale);
    if (!showPreview || cls === 'root' || cls === 'bass' || cls === 'chord') return cls;
    if (pc === p.rootPC) return 'next-root';
    if (p.pcs.includes(pc)) return 'next-chord';
    return cls;
  };
}

// =====================
// Chord Display Data (DOM更新は呼び出し元が行う)
// =====================
export function getChordDisplayData() {
  const ov = state.chordOverride;
  const baseNoteName = NOTE_NAMES[state.baseNote % 12];
  const baseOctave = Math.floor(state.baseNote / 12) - 1;
  const baseInfo = `[Base: ${baseNoteName}${baseOctave}]`;
  const scaleKeyLabel = state.showScale
    ? `${NOTE_NAMES[getScaleRootPC()]} ${SCALES[state.scale].label} Scale  ${baseInfo}`
    : baseInfo;
  if (ov?.none) return { chordName: 'N.C.', noteNames: '', intNames: '', scaleKeyLabel };

  const chordPCs = getChordPitchClasses();
  const sym = ov?.symbol ?? CHORD_TYPES[state.chordType].symbol;
  const rootName = NOTE_NAMES[state.root];
  const bassName = chordPCs.bassPC !== null ? '/' + NOTE_NAMES[chordPCs.bassPC] : '';
  const noteNames = chordPCs.inverted.map(pc => NOTE_NAMES[pc]).join('  ');
  const ints = ov?.intervals ?? CHORD_TYPES[state.chordType].intervals;
  const intNames = ints.map(i => INTERVAL_NAMES[i] || `+${i}`).join(' — ');
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
