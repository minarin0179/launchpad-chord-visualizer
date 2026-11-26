import { LOGO_PAD, padNumber, TOP_ROW_CCS } from 'launchpad-x';
import { PRESSED_LED, ROLE_LED, type Rgb } from '../config/roles';
import { GRID_SIZE, type Pad } from '../core/grid';
import type { PadVisual } from '../core/pad-roles';
import type { MidiNote } from '../core/pitch';

/** LED 1 個分（pad は Launchpad のパッド番号 / CC 番号） */
export interface LedCell {
  readonly pad: number;
  readonly color: Rgb;
}

/** 全 LED の状態。並びは常に: 64 パッド（下段の左から）→ 上段 8 ボタン → ロゴ */
export type LedFrame = readonly LedCell[];

export interface LedFrameInput {
  readonly pads: readonly Pad[];
  readonly visuals: readonly PadVisual[];
  /** 鳴っている音。同じ音が出るパッドはすべて押下色にする */
  readonly heldNotes: ReadonlySet<MidiNote>;
  /** 予告の点滅フェーズ（false の間、予告のパッドは下の役割の色に戻る） */
  readonly blinkLit: boolean;
  /** 上段 8 ボタンの色（左から） */
  readonly topRow: readonly Rgb[];
  readonly logo: Rgb;
}

/** パッド（0 始まりの row / col）→ Launchpad のパッド番号 */
export function devicePadNumber(pad: Pick<Pad, 'row' | 'col'>): number {
  return padNumber(pad.row + 1, pad.col + 1);
}

/** Launchpad のパッド番号 → パッドの index（グリッド外なら null） */
export function padIndexFromDevice(deviceNumber: number): number | null {
  const DECIMAL = 10;
  const row = Math.floor(deviceNumber / DECIMAL) - 1;
  const col = (deviceNumber % DECIMAL) - 1;
  const inGrid = row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE;
  return inGrid ? row * GRID_SIZE + col : null;
}

/** 現在の表示内容から全 LED の色を決める（純粋関数） */
export function buildLedFrame({
  pads,
  visuals,
  heldNotes,
  blinkLit,
  topRow,
  logo,
}: LedFrameInput): LedFrame {
  const cells: LedCell[] = pads.map((pad, i) => {
    const visual = visuals[i];
    const role = blinkLit ? visual.role : visual.under;
    return {
      pad: devicePadNumber(pad),
      color: heldNotes.has(pad.note) ? PRESSED_LED : ROLE_LED[role],
    };
  });
  TOP_ROW_CCS.forEach((cc, i) => cells.push({ pad: cc, color: topRow[i] }));
  cells.push({ pad: LOGO_PAD, color: logo });
  return cells;
}

/** 予告の点滅が必要か（点灯と消灯で色が変わるパッドがあるか） */
export function needsBlink(visuals: readonly PadVisual[]): boolean {
  return visuals.some((visual) => visual.role !== visual.under);
}
