/**
 * コード解析（オーディオ → コード進行）の定数。
 * 値を変えると保存済みの解析結果（特徴量）から得られるコード進行も変わるので注意。
 */
import type { ChordTypeKey } from '../core/theory';

// ---------- サンプリング ----------
/** 解析時のサンプリングレート（入力はここまで落としてから解析する） */
export const ANALYSIS_RATE = 22050;
/** ローパスのタップ数 = 1 出力サンプルあたりの入力サンプル数 × この値 + 1 */
export const RESAMPLE_TAPS_PER_FACTOR = 64;
/** ローパスのカットオフ（出力ナイキスト周波数に対する比 × 0.5） */
export const RESAMPLE_CUTOFF = 0.45;
/** 分数比リサンプルで事前計算する位相の最大数 */
export const RESAMPLE_MAX_PHASES = 512;

// ---------- フレーム ----------
export const ONSET_FFT_SIZE = 1024;
export const ONSET_HOP = 512;
export const CHROMA_HOP = 1024;
/** 高音域クロマの FFT サイズ（時間分解能優先） */
export const TREBLE_FFT_SIZE = 4096;
/** 低音域クロマの FFT サイズ（低音の周波数分解能優先） */
export const BASS_FFT_SIZE = 8192;
/** log(1 + LOG_GAIN × 振幅) の圧縮係数 */
export const LOG_GAIN = 100;
/** Hann 窓のコヒーレントゲイン補正（振幅 1 の正弦波のピークが n / 4 になる） */
export const HANN_PEAK_DIVISOR = 4;

// ---------- ピッチ ----------
/** 解析するピッチ範囲（MIDI ノート番号）: E1〜C7 */
export const MIDI_LO = 28;
export const MIDI_HI = 96;
export const PITCH_COUNT = MIDI_HI - MIDI_LO + 1;
/** A4 = MIDI 69 = 440 Hz */
export const TUNING_MIDI = 69;
export const TUNING_HZ = 440;
/** FFT bin をピッチに割り当てる幅（bin 間隔の半音数に対する倍率と下限） */
export const PITCH_MAP_WIDTH_FACTOR = 1.2;
export const PITCH_MAP_MIN_WIDTH = 0.4;

/** 高音域クロマの重み: 40 未満は 0、48 までで立ち上がり、84 までは 1、96 で 0 に落ちる */
export const TREBLE_FADE_IN_START = 40;
export const TREBLE_FADE_IN_END = 48;
export const TREBLE_FADE_OUT_START = 84;
export const TREBLE_FADE_OUT_END = 96;

/** 低音域クロマの重み: MIDI 40（E2）中心のガウス、55（G3）より上は 0 */
export const BASS_CENTER = 40;
export const BASS_SIGMA = 7;
export const BASS_CUTOFF = 55;

/** 白色化: ±この半音数の局所平均を引いて広帯域ノイズ（ドラム等）を抑える */
export const WHITEN_RADIUS = 12;

// ---------- メロディ抑制 ----------
/** 主旋律を探す範囲: G3〜C6 */
export const VOCAL_LO = 55;
export const VOCAL_HI = 84;
/** 最大ピークが 2 番目のピークの何倍以上なら主旋律とみなすか */
export const MELODY_DOMINANCE = 1.3;
/** 主旋律の隣接半音・オクターブ上・12 度上（第 3 倍音）に掛ける減衰 */
export const MELODY_NEIGHBOR_GAIN = 0.5;
export const MELODY_OCTAVE_GAIN = 0.3;
export const MELODY_TWELFTH_GAIN = 0.5;
export const OCTAVE_SEMITONES = 12;
export const TWELFTH_SEMITONES = 19;

// ---------- HPSS（持続音 / 打撃音の分離） ----------
/** 時間方向メディアンの半径（フレーム）— 大きいとコードチェンジがぼける */
export const HPSS_TIME_RADIUS = 4;
/** 周波数方向メディアンの半径（bin） */
export const HPSS_FREQ_RADIUS = 8;

// ---------- ステレオ ----------
/** サイド成分がミッドの何割未満ならモノラル音源とみなすか */
export const SIDE_MIN_RATIO = 0.05;

// ---------- オンセット ----------
/** オンセット包絡から引く局所平均の半径（秒） */
export const ONSET_MEAN_RADIUS_SEC = 0.4;
/** 進捗を通知する間隔（フレーム数 − 1 のビットマスク） */
export const ONSET_PROGRESS_MASK = 1023;
export const SPECTROGRAM_PROGRESS_MASK = 255;

// ---------- ビート追跡 ----------
export const MIN_BPM = 60;
export const MAX_BPM = 200;
/** テンポの事前分布の中心と、対数（オクターブ）での広がり */
export const TEMPO_PRIOR_BPM = 120;
export const TEMPO_PRIOR_OCTAVES = 0.9;
/** 短すぎてテンポを推定できないときに使うテンポ */
export const FALLBACK_BPM = 120;
/** テンポ推定に必要な長さ（最長ラグの何倍か） */
export const MIN_LAGS_FOR_TEMPO = 4;
/** 倍テンポの自己相関がこの割合以上なら速い方を採用する */
export const DOUBLE_TEMPO_RATIO = 0.4;
/** ビート間隔がテンポから外れることへのペナルティ */
export const BEAT_TIGHTNESS = 100;
/** DP で前のビートを探す範囲（周期に対する倍率） */
export const BEAT_SEARCH_FAR = 2;
export const BEAT_SEARCH_NEAR = 0.5;
/** ビート境界の最小間隔・曲末の余白（秒） */
export const MIN_BEAT_GAP_SEC = 0.05;
/** ビート区間の冒頭（前のコードの残響が混ざる部分）のうち平均から除く割合 */
export const BEAT_SKIP_RATIO = 0.2;

// ---------- デコード ----------
/** エネルギーが中央値のこの割合未満のビートは無音（N.C.）とみなす */
export const SILENCE_RATIO = 0.2;
/** 無音のビートで N.C. に与えるスコア */
export const SILENCE_SCORE = 2;
/** N.C. のスコア = 平坦なスペクトルとの類似度 − この値 + bassWeight × NO_CHORD_BASS_SHARE */
export const NO_CHORD_OFFSET = 0.3;
export const NO_CHORD_BASS_SHARE = 0.3;
/** コードテンプレートで、三和音より上の音（7th など）に与える重み */
export const TEMPLATE_EXTENSION_WEIGHT = 0.8;
/** 三和音の構成音数 */
export const TRIAD_SIZE = 3;
/** 同じコードに留まる確率の下限・上限 */
export const MIN_STAY_PROBABILITY = 0.01;
export const MAX_STAY_PROBABILITY = 0.99;
/** キー推定で低音域クロマに与える重み（高音域 = 1） */
export const KEY_BASS_WEIGHT = 0.5;

// ---------- 丸め ----------
/** 時刻（秒）・クロマ・エネルギーは小数 3 桁に丸めて保存する */
export const ROUND_SCALE = 1000;

// ---------- 数式 ----------
/** ガウス関数 exp(−x² / 2) の係数 */
export const GAUSSIAN_EXPONENT = -0.5;
export const HALF = 0.5;

// ---------- 検出するコードの種類 ----------
/** コードタイプと事前ペナルティ（音数の多いコードはメロディ音で誤検出しやすいので不利にする） */
export type VocabularyDef = readonly (readonly [type: ChordTypeKey, penalty: number])[];

export const VOCABULARIES = {
  triads: [
    ['maj', 0],
    ['min', 0],
  ],
  full: [
    ['maj', 0],
    ['min', 0],
    ['7', 0.03],
    ['min7', 0.03],
    ['maj7', 0.04],
    ['sus4', 0.05],
    ['dim', 0.06],
    ['aug', 0.08],
  ],
} as const satisfies Record<string, VocabularyDef>;

/** デコードの既定値（各項目の意味は types.ts の DecodeOptions を参照） */
export const DEFAULT_DECODE_VALUES = {
  vocabulary: 'full',
  selfTransition: 0.6,
  bassWeight: 0.3,
  keyBonus: 0.03,
  beta: 25,
  centerCut: false,
  hpss: false,
  melody: false,
} as const;
