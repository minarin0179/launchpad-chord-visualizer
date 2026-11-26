import { chordDisplay } from '../core/chord';
import { detectChords } from '../core/detect';
import { noteLabel, noteName } from '../core/pitch';
import { scaleDef } from '../core/theory';
import { byId, createElement } from '../platform/dom';
import {
  selectBaseNote,
  selectEffectiveChord,
  selectHeldNotes,
  selectScaleRef,
} from '../store/selectors';
import type { AppState } from '../store/state';
import type { AppStore } from './context';

const NOTHING_DETECTED = '—';
const DETECTED_SEPARATOR = ' / ';

/** 中央パネル: コード名・構成音・度数、スケールとベースノートのラベル、押さえている音から検出したコード */
export function mountChordDisplay(store: AppStore): void {
  const name = byId('chord-name', 'div');
  const notes = byId('chord-notes', 'div');
  const intervals = byId('chord-interval', 'div');
  const scaleLabel = byId('scale-key-label', 'div');
  const detected = byId('detected-chord-names', 'span');

  let shown = '';
  const render = (state: AppState): void => {
    const display = chordDisplay(selectEffectiveChord(state), state.display.showInversion);
    const scale = selectScaleRef(state);
    const label = `${noteName(scale.root)} ${scaleDef(scale.scale).label} Scale  [Base: ${noteLabel(selectBaseNote(state))}]`;
    const signature = [display.name, display.notes, display.intervals, label].join('\n');
    if (signature === shown) return;
    shown = signature;
    name.textContent = display.name;
    notes.textContent = display.notes;
    intervals.textContent = display.intervals;
    scaleLabel.textContent = label;
  };
  store.subscribe(render);
  render(store.getState());

  store.watch(selectHeldNotes, (held) => {
    const chords = detectChords(held);
    if (chords.length === 0) {
      detected.replaceChildren(
        createElement('span', { className: 'detected-chord-empty', text: NOTHING_DETECTED }),
      );
      return;
    }
    detected.replaceChildren(
      ...chords.flatMap((chord, i) => {
        const item = createElement('span', {
          className: chord.exact ? 'detected-chord-name exact' : 'detected-chord-name',
          text: chord.name,
        });
        const separator = createElement('span', {
          className: 'detected-chord-sep',
          text: DETECTED_SEPARATOR,
        });
        return i === 0 ? [item] : [separator, item];
      }),
    );
  });
}
