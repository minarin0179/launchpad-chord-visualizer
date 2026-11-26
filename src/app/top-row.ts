import { TOP_ROW_CC, TOP_ROW_CCS, type TopRowButton } from 'launchpad-x';
import { sameRgb, TOP_ROW_LED, type Rgb } from '../config/roles';
import { selectPlayerReady } from '../store/selectors';
import type { AppState } from '../store/state';

/** 上段ボタンから実行できる操作 */
export interface TopRowCommands {
  readonly shiftOctave: (delta: 1 | -1) => void;
  readonly shiftCapo: (delta: number) => void;
  readonly togglePlay: () => void;
  readonly backOneBar: () => void;
  readonly toggleFollow: () => void;
  readonly cycleLoop: () => void;
}

interface TopRowDef {
  /** 画面のボタンに出すラベル */
  readonly label: string;
  /** Song バーの操作か（false = オクターブ / カポ） */
  readonly song: boolean;
  readonly press: (commands: TopRowCommands) => void;
  readonly color: (state: AppState) => Rgb;
}

/** Song 用のボタンは、プレイヤーの準備ができるまで「使えない」色にする */
const songColor =
  (color: (state: AppState) => Rgb) =>
  (state: AppState): Rgb =>
    selectPlayerReady(state) ? color(state) : TOP_ROW_LED.unavailable;

/** 上段 8 ボタンの割り当て（キーは本体に印字されているボタン名） */
const TOP_ROW: Record<TopRowButton, TopRowDef> = {
  up: {
    song: false,
    label: 'OCT▲',
    press: (c) => {
      c.shiftOctave(1);
    },
    color: () => TOP_ROW_LED.fn,
  },
  down: {
    song: false,
    label: 'OCT▼',
    press: (c) => {
      c.shiftOctave(-1);
    },
    color: () => TOP_ROW_LED.fn,
  },
  left: {
    song: false,
    label: '◄',
    press: (c) => {
      c.shiftCapo(-1);
    },
    color: () => TOP_ROW_LED.fn,
  },
  right: {
    song: false,
    label: '►',
    press: (c) => {
      c.shiftCapo(1);
    },
    color: () => TOP_ROW_LED.fn,
  },
  session: {
    song: true,
    label: '▶',
    press: (c) => {
      c.togglePlay();
    },
    color: songColor((s) => (s.song.playback.playing ? TOP_ROW_LED.playing : TOP_ROW_LED.paused)),
  },
  note: {
    song: true,
    label: '◄◄',
    press: (c) => {
      c.backOneBar();
    },
    color: songColor(() => TOP_ROW_LED.back),
  },
  custom: {
    song: true,
    label: 'FLW',
    press: (c) => {
      c.toggleFollow();
    },
    color: songColor((s) => (s.song.follow ? TOP_ROW_LED.follow : TOP_ROW_LED.idle)),
  },
  captureMidi: {
    song: true,
    label: 'A-B',
    press: (c) => {
      c.cycleLoop();
    },
    color: songColor((s) => {
      if (s.song.loop.kind === 'ab') return TOP_ROW_LED.loopOn;
      return s.song.loop.kind === 'a' ? TOP_ROW_LED.loopA : TOP_ROW_LED.idle;
    }),
  },
};

/** 左から順（CC 91〜98）に並べた定義 */
const TOP_ROW_ORDERED: readonly (TopRowDef & { readonly cc: number })[] = TOP_ROW_CCS.map((cc) => {
  const button = (Object.keys(TOP_ROW_CC) as TopRowButton[]).find(
    (name) => TOP_ROW_CC[name] === cc,
  );
  if (!button) throw new Error(`上段ボタン CC${cc} の割り当てがありません`);
  return { ...TOP_ROW[button], cc };
});

export const TOP_ROW_LABELS: readonly string[] = TOP_ROW_ORDERED.map((def) => def.label);
export const TOP_ROW_CC_NUMBERS: readonly number[] = TOP_ROW_ORDERED.map((def) => def.cc);

export function pressTopRow(index: number, commands: TopRowCommands): void {
  TOP_ROW_ORDERED.at(index)?.press(commands);
}

/** 上段 8 ボタンの LED 色（左から） */
export function topRowColors(state: AppState): Rgb[] {
  return TOP_ROW_ORDERED.map((def) => def.color(state));
}

/**
 * 画面の上段ボタンの点灯色（左から。点灯しないボタンは null）。
 * 点灯するのは Song 用のボタンだけで、プレイヤーの準備前と OFF 状態（idle）は点灯しない。
 */
export function topRowScreenColors(state: AppState): (Rgb | null)[] {
  const ready = selectPlayerReady(state);
  return TOP_ROW_ORDERED.map((def) => {
    if (!def.song || !ready) return null;
    const color = def.color(state);
    return sameRgb(color, TOP_ROW_LED.idle) ? null : color;
  });
}
