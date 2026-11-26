import { RIGHT_COL_CCS } from 'launchpad-x';
import type { NoteController } from '../app/note-controller';
import { TOP_ROW_CC_NUMBERS, TOP_ROW_LABELS, topRowScreenColors } from '../app/top-row';
import { CLICK_PAD_VELOCITY } from '../config/ranges';
import { ledToCss, ROLE_CLASS } from '../config/roles';
import { FN_ACTIVE_DURATION_MS, RIGHT_COL_NOTE_DURATION_MS } from '../config/timing';
import { GRID_SIZE, padIndex } from '../core/grid';
import type { PadRole } from '../core/pad-roles';
import { noteName } from '../core/pitch';
import { byId, createElement, flashClass } from '../platform/dom';
import { selectPads, selectPadVisuals } from '../store/selectors';
import { PRESS_SOURCE } from '../store/state';
import type { AppStore } from './context';

export interface GridViewDeps {
  readonly store: AppStore;
  readonly notes: NoteController;
  /** 上段ボタンを押した（0 = 左端） */
  readonly onTopRow: (index: number) => void;
  /** 右列ボタンを押した（0 = 最上段） */
  readonly onRightColumn: (index: number) => void;
}

export interface GridView {
  /** Launchpad 本体で押されたボタンを画面でも一瞬光らせる */
  flashTopRow(index: number): void;
  flashRightColumn(index: number, via: 'cc' | 'note'): void;
}

const PAD_CLASS = 'pad';
const PRESSED_CLASS = 'pressed';
const FN_ACTIVE_CLASS = 'fn-active';
const SONG_LIT_CLASS = 'song-lit';
const SONG_COLOR_VARIABLE = '--song-btn';

/**
 * 9 × 9 のパッドグリッド（上段ボタン + 8 × 8 パッド + 右列ボタン）。
 * 要素は起動時に 1 回だけ作り、以降はクラスと属性だけを更新する。
 */
export function mountGridView({ store, notes, onTopRow, onRightColumn }: GridViewDeps): GridView {
  const grid = byId('pad-grid', 'div');
  grid.replaceChildren();

  // ----- 上段ボタン + 右上の空きマス -----
  const topRow = TOP_ROW_LABELS.map((label, index) => {
    const button = createElement('div', {
      className: 'pad fn-btn',
      title: `CC ${TOP_ROW_CC_NUMBERS[index]}`,
    });
    button.dataset.note = label;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      onTopRow(index);
    });
    grid.appendChild(button);
    return button;
  });
  grid.appendChild(createElement('div', { className: 'pad fn-corner' }));

  // ----- 8 × 8 パッド（画面では上の段から並べる）+ 右列ボタン -----
  const padElements = new Array<HTMLDivElement>(GRID_SIZE * GRID_SIZE);
  const rightColumn: HTMLDivElement[] = [];
  for (let row = GRID_SIZE - 1; row >= 0; row--) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const index = padIndex(row, col);
      const pad = createElement('div', { className: `${PAD_CLASS} ${ROLE_CLASS.off}` });
      attachPadPointer(pad, index, notes);
      grid.appendChild(pad);
      padElements[index] = pad;
    }
    const rightIndex = rightColumn.length;
    const cc = RIGHT_COL_CCS[rightIndex];
    const button = createElement('div', { className: 'pad fn-btn', title: `Note ${cc}` });
    button.dataset.note = `N${cc}`;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      onRightColumn(rightIndex);
      flashClass(button, PRESSED_CLASS, RIGHT_COL_NOTE_DURATION_MS);
    });
    grid.appendChild(button);
    rightColumn.push(button);
  }

  // ----- 状態 → 表示 -----
  store.watch(selectPads, (pads) => {
    pads.forEach((pad, i) => {
      const name = noteName(pad.pitchClass);
      padElements[i].dataset.note = name;
      padElements[i].title = `${name} (MIDI ${pad.note})`;
    });
  });

  const shownRoles = new Array<PadRole>(padElements.length).fill('off');
  store.watch(selectPadVisuals, (visuals) => {
    visuals.forEach(({ role }, i) => {
      if (role === shownRoles[i]) return;
      // 役割のクラスだけを差し替える（className を丸ごと書き換えると押下中の表示が消える）
      padElements[i].classList.replace(ROLE_CLASS[shownRoles[i]], ROLE_CLASS[role]);
      shownRoles[i] = role;
    });
  });

  store.watch(
    (state) => state.held,
    (held) => {
      const pressed = new Set(held.map((h) => h.padIndex));
      padElements.forEach((pad, i) => pad.classList.toggle(PRESSED_CLASS, pressed.has(i)));
    },
  );

  let shownTopRow = '';
  store.subscribe(updateTopRow);
  updateTopRow(store.getState());
  function updateTopRow(state: ReturnType<AppStore['getState']>): void {
    const colors = topRowScreenColors(state).map((color) => (color ? ledToCss(color) : ''));
    const signature = colors.join('|');
    if (signature === shownTopRow) return;
    shownTopRow = signature;
    colors.forEach((color, i) => {
      topRow[i].classList.toggle(SONG_LIT_CLASS, color !== '');
      topRow[i].style.setProperty(SONG_COLOR_VARIABLE, color);
    });
  }

  return {
    flashTopRow(index) {
      const button = topRow.at(index);
      if (button) flashClass(button, FN_ACTIVE_CLASS, FN_ACTIVE_DURATION_MS);
    },
    flashRightColumn(index, via) {
      const button = rightColumn.at(index);
      if (!button) return;
      if (via === 'cc') flashClass(button, FN_ACTIVE_CLASS, FN_ACTIVE_DURATION_MS);
      else flashClass(button, PRESSED_CLASS, RIGHT_COL_NOTE_DURATION_MS);
    },
  };
}

/**
 * パッドのポインター操作。押した要素がポインターを捕まえ続けるので、押したままパッドの外へ動かしても
 * 離すまで鳴り続ける（マウスを載せて外しただけでは何も起きない）。
 */
function attachPadPointer(pad: HTMLElement, index: number, notes: NoteController): void {
  const pressId = (event: PointerEvent): string => `${PRESS_SOURCE.pointer}${event.pointerId}`;
  pad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    pad.setPointerCapture(event.pointerId);
    notes.press(pressId(event), index, CLICK_PAD_VELOCITY);
  });
  const release = (event: PointerEvent): void => {
    notes.release(pressId(event));
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('lostpointercapture', release);
}
