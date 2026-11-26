import type { LaunchpadX, LEDUpdate } from 'launchpad-x';
import { topRowColors } from '../app/top-row';
import { LED_OFF, LOGO_LED, type Rgb } from '../config/roles';
import { LOGO_FLASH_MS, PREVIEW_BLINK_MS } from '../config/timing';
import { errorMessage, type Logger } from '../platform/logger';
import type { Action } from '../store/actions';
import type { Store } from '../store/create-store';
import {
  selectDeviceReady,
  selectHeldNotes,
  selectPads,
  selectPadVisuals,
} from '../store/selectors';
import type { AppState } from '../store/state';
import { buildLedFrame, needsBlink, type LedFrame } from './frame';
import { LedSender } from './sender';

export interface LedController {
  /** 全 LED を送り直す（SEND ボタン） */
  resend(): void;
  /** 全 LED を消す（CLEAR ボタン）。次に表示内容が変わるまで消えたまま */
  clear(): void;
  /** ロゴを一瞬だけ別の色にする（メトロノームの拍） */
  flashLogo(color: Rgb): void;
}

export interface LedControllerDeps {
  readonly store: Store<AppState, Action>;
  readonly logger: Logger;
  /** 接続中のデバイス（無ければ null） */
  readonly getDevice: () => LaunchpadX | null;
}

/**
 * ストアの状態を Launchpad の LED に反映し続ける。
 * 予告の点滅とロゴのフラッシュ（時間で変わる部分）もここで管理する。
 */
export function createLedController({
  store,
  logger,
  getDevice,
}: LedControllerDeps): LedController {
  const sender = new LedSender();
  let blinkLit = true;
  let blinkTimer: ReturnType<typeof setInterval> | null = null;
  let logoFlash: Rgb | null = null;
  let logoTimer: ReturnType<typeof setTimeout> | null = null;
  /** CLEAR 後、次に状態が変わるまでパッドを消したままにする */
  let cleared = false;

  const send = (updates: LEDUpdate[]): boolean => {
    try {
      getDevice()?.sendLEDs(updates);
      return true;
    } catch (error) {
      logger.error(`MIDI send error: ${errorMessage(error)}`);
      return false;
    }
  };

  const frameOf = (state: AppState): LedFrame => {
    const frame = buildLedFrame({
      pads: selectPads(state),
      visuals: selectPadVisuals(state),
      heldNotes: new Set(selectHeldNotes(state)),
      blinkLit,
      topRow: topRowColors(state),
      logo: logoFlash ?? LOGO_LED.connected,
    });
    // CLEAR 直後はロゴ以外を消灯のままにする
    return cleared
      ? frame.map((cell, i) => (i === frame.length - 1 ? cell : { ...cell, color: LED_OFF }))
      : frame;
  };

  const present = (): number => {
    const state = store.getState();
    if (!selectDeviceReady(state)) return 0;
    return sender.present(frameOf(state), send);
  };

  const updateBlink = (state: AppState): void => {
    const blinking = selectDeviceReady(state) && needsBlink(selectPadVisuals(state));
    if (blinking && blinkTimer === null) {
      blinkTimer = setInterval(() => {
        blinkLit = !blinkLit;
        present();
      }, PREVIEW_BLINK_MS);
    } else if (!blinking && blinkTimer !== null) {
      clearInterval(blinkTimer);
      blinkTimer = null;
      blinkLit = true;
    }
  };

  store.watch(selectDeviceReady, (ready) => {
    // 接続し直したらデバイス側の LED の状態は分からないので、全部送り直す
    if (ready) sender.invalidate();
    cleared = false;
  });
  store.subscribe((state) => {
    cleared = false;
    updateBlink(state);
    present();
  });

  return {
    resend() {
      cleared = false;
      sender.invalidate();
      const count = present();
      if (count > 0) logger.out(`SysEx → RGB lighting (${count} LEDs)`);
    },
    clear() {
      const device = getDevice();
      if (!device) return;
      try {
        device.clearAll();
      } catch (error) {
        logger.error(`MIDI clear error: ${errorMessage(error)}`);
        return;
      }
      sender.assumeCleared();
      cleared = true;
      present();
      logger.out('All LEDs cleared');
    },
    flashLogo(color) {
      logoFlash = color;
      present();
      if (logoTimer !== null) clearTimeout(logoTimer);
      logoTimer = setTimeout(() => {
        logoFlash = null;
        logoTimer = null;
        present();
      }, LOGO_FLASH_MS);
    },
  };
}
