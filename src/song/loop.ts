import { LOOP_MIN_BEATS } from '../config/timing';
import type { Loop } from './types';

export const LOOP_OFF: Loop = { kind: 'off' };

/**
 * A-B ボタンを押したときの遷移: なし → A 設定 → B 設定 → 解除。
 * B は A から LOOP_MIN_BEATS 拍より後のときだけ設定でき、そうでなければ解除する。
 */
export function cycleLoop(loop: Loop, t: number, beatSec: number): Loop {
  switch (loop.kind) {
    case 'off':
      return { kind: 'a', a: t };
    case 'a':
      return t > loop.a + LOOP_MIN_BEATS * beatSec ? { kind: 'ab', a: loop.a, b: t } : LOOP_OFF;
    case 'ab':
      return LOOP_OFF;
  }
}

/** 再生中に B を越えていたら、戻り先（A）を返す。戻らなくてよければ null */
export function loopSeekTarget(loop: Loop, t: number, playing: boolean): number | null {
  return loop.kind === 'ab' && playing && t >= loop.b ? loop.a : null;
}
