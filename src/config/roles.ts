import type { PadRole } from '../core/pad-roles';

/** Launchpad の LED 色（各チャンネル 0〜127） */
export type Rgb = readonly [r: number, g: number, b: number];

export const LED_OFF: Rgb = [0, 0, 0];

/** パッドの役割 → LED 色 */
export const ROLE_LED: Record<PadRole, Rgb> = {
  root: [127, 0, 40],
  bass: [127, 80, 0],
  chord: [0, 100, 127],
  scale: [0, 127, 60],
  'next-root': [40, 0, 12],
  'next-chord': [0, 30, 40],
  off: LED_OFF,
};

/** 押しているパッド（同じ音が出るパッドも含む） */
export const PRESSED_LED: Rgb = [127, 127, 127];

/** ロゴ（右上）の LED */
export const LOGO_LED = {
  /** デバイス接続中 */
  connected: [0, 100, 0],
  /** メトロノームの 1 拍目 */
  accent: [127, 127, 127],
  /** メトロノームの 2〜4 拍目 */
  beat: [60, 80, 100],
} as const satisfies Record<string, Rgb>;

/** 上段ボタンの LED */
export const TOP_ROW_LED = {
  /** オクターブ / カポ（常時点灯） */
  fn: [60, 30, 0],
  /** 曲を読み込んでいないときの Song ボタン */
  unavailable: [3, 3, 3],
  /** Song ボタン: 押せるが OFF の状態 */
  idle: [12, 12, 12],
  playing: [0, 100, 0],
  paused: [20, 60, 0],
  back: [60, 30, 0],
  follow: [0, 100, 127],
  /** A 点のみ設定済み */
  loopA: [100, 100, 0],
  loopOn: [110, 0, 110],
} as const satisfies Record<string, Rgb>;

/** LED の値（0〜127）を画面の CSS 色（0〜255）にする倍率 */
const LED_TO_CSS = 2;

export function ledToCss([r, g, b]: Rgb): string {
  return `rgb(${r * LED_TO_CSS},${g * LED_TO_CSS},${b * LED_TO_CSS})`;
}

export function sameRgb(a: Rgb, b: Rgb): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** パッドの役割 → 画面の CSS クラス名（style.css の `.pad.<クラス>` と対応） */
export const ROLE_CLASS: Record<PadRole, string> = {
  root: 'root',
  bass: 'bass',
  chord: 'chord',
  scale: 'scale',
  'next-root': 'next-root',
  'next-chord': 'next-chord',
  off: 'off',
};

/** パッドの役割 → 画面の色（CSS カスタムプロパティとして :root に設定する） */
export const ROLE_CSS_COLOR: Record<
  Exclude<PadRole, 'off'>,
  { readonly variable: string; readonly color: string }
> = {
  root: { variable: '--root-color', color: '#ff4466' },
  bass: { variable: '--bass-color', color: '#ffaa33' },
  chord: { variable: '--chord-color', color: '#33ddff' },
  scale: { variable: '--scale-color', color: '#44ff99' },
  'next-root': { variable: '--next-root-color', color: '#7a1a30' },
  'next-chord': { variable: '--next-chord-color', color: '#155a6a' },
};
