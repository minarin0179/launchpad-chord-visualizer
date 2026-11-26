import { ROLE_CSS_COLOR } from '../config/roles';
import { PLAYHEAD_RATIO } from '../config/timeline';
import { PREVIEW_BLINK_MS } from '../config/timing';

const PERCENT = 100;
/** 点滅 1 周期 = 点灯 + 消灯 */
const BLINK_PHASES = 2;

/** 色・タイミングの定数を CSS カスタムプロパティとして :root に設定する（JS と CSS で値を二重に持たない） */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  for (const { variable, color } of Object.values(ROLE_CSS_COLOR))
    root.style.setProperty(variable, color);
  root.style.setProperty('--preview-blink', `${PREVIEW_BLINK_MS * BLINK_PHASES}ms`);
  root.style.setProperty('--playhead-ratio', `${PLAYHEAD_RATIO * PERCENT}%`);
}
