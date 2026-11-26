import type { LEDUpdate } from 'launchpad-x';
import { LED_OFF, sameRgb, type Rgb } from '../config/roles';
import type { LedFrame } from './frame';

/**
 * LED フレームを Launchpad に送る。
 * 直前に送った内容を覚えておき、色が変わった LED だけを 1 つの SysEx にまとめて送る。
 */
export class LedSender {
  /** 最後に送った色（パッド番号 → 色）。null = デバイスの状態が分からない */
  private sent: Map<number, Rgb> | null = null;

  /** @returns 送った LED の数 */
  present(frame: LedFrame, send: (updates: LEDUpdate[]) => void): number {
    const sent = this.sent;
    const changed = sent
      ? frame.filter((cell) => !sameRgb(sent.get(cell.pad) ?? LED_OFF, cell.color))
      : frame;
    if (changed.length > 0) {
      send(changed.map(({ pad, color: [r, g, b] }) => ({ type: 'rgb', pad, r, g, b })));
    }
    this.sent = new Map(frame.map((cell) => [cell.pad, cell.color]));
    return changed.length;
  }

  /** デバイスの状態が分からなくなった（接続し直した・手動で再送する）。次の present は全 LED を送る */
  invalidate(): void {
    this.sent = null;
  }

  /** デバイス側で全消灯した。次の present は消灯以外の LED を送る */
  assumeCleared(): void {
    this.sent = new Map();
  }
}
