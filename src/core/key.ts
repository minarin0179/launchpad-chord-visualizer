import { mod12, noteName, SEMITONES, type PitchClass } from './pitch';
import { RELATIVE_MAJOR_OFFSET } from './theory';

export type KeyMode = 'major' | 'minor';

export interface Key {
  readonly root: PitchClass;
  readonly mode: KeyMode;
  /** 例: "C" / "Am" */
  readonly label: string;
  /** 同じ構成音のメジャーキーの主音（マイナーなら平行調） */
  readonly tonicMajor: PitchClass;
  /** キープロファイルとの相関（-1〜1、小数 2 桁） */
  readonly confidence: number;
}

/** Krumhansl-Kessler キープロファイル（主音からの半音ごとの「そのキーらしさ」） */
const KEY_PROFILES: Record<KeyMode, readonly number[]> = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

const KEY_MODES: readonly KeyMode[] = ['major', 'minor'];
const CONFIDENCE_DECIMALS = 100;

function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - meanX) * (y[i] - meanY);
    varX += (x[i] - meanX) ** 2;
    varY += (y[i] - meanY) ** 2;
  }
  return varX && varY ? num / Math.sqrt(varX * varY) : 0;
}

function modeSuffix(mode: KeyMode): string {
  return mode === 'minor' ? 'm' : '';
}

/** 12 次元のピッチクラス分布から、Krumhansl-Kessler 相関で最も近いキーを返す */
export function keyFromProfile(profile: readonly number[]): Key {
  let best: { root: PitchClass; mode: KeyMode; r: number } = {
    root: 0,
    mode: 'major',
    r: -Infinity,
  };
  for (const mode of KEY_MODES) {
    for (let root = 0; root < SEMITONES; root++) {
      const rotated = profile.map((_, pc) => KEY_PROFILES[mode][mod12(pc - root)]);
      const r = pearson(profile, rotated);
      if (r > best.r) best = { root, mode, r };
    }
  }
  return {
    root: best.root,
    mode: best.mode,
    label: noteName(best.root) + modeSuffix(best.mode),
    tonicMajor: best.mode === 'major' ? best.root : mod12(best.root + RELATIVE_MAJOR_OFFSET),
    confidence: Math.round(best.r * CONFIDENCE_DECIMALS) / CONFIDENCE_DECIMALS,
  };
}

/** カポ分だけ下げたキーの表示名（カポ n のとき表示 = 実音 − n） */
export function keyLabel(key: Key, capo = 0): string {
  return noteName(key.root - capo) + modeSuffix(key.mode);
}
