import { buildPadData } from './constants.js';

// =====================
// Global State
// =====================
export const state = {
  baseNote: 36,   // C2 default — shifted by octave/transpose
  root: 0,
  capo: 0,        // cumulative semitone shift via ◄/►
  chordType: 'maj',
  inversion: 0,
  showChord: true,
  showScale: true,
  showInversion: false,
  scale: 'major',
  instrument: 'piano',
  device: null,     // LaunchpadX instance (set by midi.js when a device is selected)
  midiAccess: null,
  bpm: 120,
  metronome: false,
  // --- Song（曲バー）連動 ---
  follow: false,        // true の間は再生中の曲のコードで root / chordType を自動更新
  practice: false,      // 練習モード: 弾くコードだけ点灯（スケール・予告は消灯、切替は PRACTICE_LEAD_BEATS 拍前）
  chordOverride: null,  // FOLLOW 中のコード拡張情報 { intervals?, symbol?, bassPC?, none? }（none = N.C.）
  scaleRoot: null,      // スケールの基準音。null = コードのルート、数値 = 曲のキー
  preview: null,        // 次のコードの予告 { rootPC, pcs[] }（null = 予告なし）
  previewLit: true,     // Launchpad 上の予告点滅の点灯フェーズ
};

export let pads = buildPadData(state.baseNote);

// ES Modules live binding: 他モジュールから pads を再代入するためのセッター
export function setPads(newPads) {
  pads = newPads;
}
