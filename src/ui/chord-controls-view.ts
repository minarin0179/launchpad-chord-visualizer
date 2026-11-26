import { inversionCount } from '../core/chord';
import { NOTE_NAMES } from '../core/pitch';
import { CHORD_TYPES, CHORD_TYPE_KEYS, INVERSION_LABELS, SCALE_KEYS, SCALES } from '../core/theory';
import { byId } from '../platform/dom';
import { selectEffectiveChord, selectScaleRef } from '../store/selectors';
import type { DisplayToggle } from '../store/state';
import { buildButtonGroup, type AppStore } from './context';

const HIDDEN_CLASS = 'hidden';
const ACTIVE_CLASS = 'active';

/** 表示トグル: ボタンと、OFF のときに隠す要素 */
const TOGGLES: readonly { key: DisplayToggle; button: string; controls: readonly string[] }[] = [
  { key: 'showChord', button: 'toggle-chord', controls: ['chord-control'] },
  { key: 'showScale', button: 'toggle-scale', controls: ['scale-control', 'scale-key-label'] },
  { key: 'showInversion', button: 'toggle-inversion', controls: ['inversion-control'] },
];

/** カポの表示: 0 / +n / -n */
function formatCapo(capo: number): string {
  return capo > 0 ? `+${capo}` : String(capo);
}

/** 右パネル: Root / Chord / Scale / Inversion / Capo */
export function mountChordControls(store: AppStore): void {
  const dispatch = store.dispatch;

  const setRoot = buildButtonGroup(
    byId('root-buttons', 'div'),
    NOTE_NAMES.map((label, key) => ({ key, label })),
    (root) => {
      dispatch({ type: 'rootSelected', root });
    },
  );
  const setChordType = buildButtonGroup(
    byId('chord-buttons', 'div'),
    CHORD_TYPE_KEYS.map((key) => ({ key, label: CHORD_TYPES[key].label })),
    (chordType) => {
      dispatch({ type: 'chordTypeSelected', chordType });
    },
  );
  const setScale = buildButtonGroup(
    byId('scale-buttons', 'div'),
    SCALE_KEYS.map((key) => ({ key, label: SCALES[key].label })),
    (scale) => {
      dispatch({ type: 'scaleSelected', scale });
    },
  );

  // 転回形のボタンはコードの構成音の数だけ作る
  const inversionRow = byId('inversion-row', 'div');
  let inversionButtons = 0;
  let setInversion: (active: number | null) => void = () => undefined;

  store.watch(selectEffectiveChord, (chord) => {
    // N.C. の間はどのルート・コードも選択表示にしない
    setRoot(chord.kind === 'chord' ? chord.spec.root : null);
    setChordType(chord.kind === 'chord' ? chord.spec.type : null);
    if (chord.kind !== 'chord') return;
    const count = Math.min(inversionCount(chord.spec), INVERSION_LABELS.length);
    if (count !== inversionButtons) {
      inversionButtons = count;
      setInversion = buildButtonGroup(
        inversionRow,
        INVERSION_LABELS.slice(0, count).map((label, key) => ({ key, label })),
        (inversion) => {
          dispatch({ type: 'inversionSelected', inversion });
        },
      );
    }
    setInversion(chord.inversion);
  });
  store.watch(selectScaleRef, ({ scale }) => {
    setScale(scale);
  });

  for (const { key, button, controls } of TOGGLES) {
    const toggle = byId(button, 'button');
    const targets = controls.map((id) => byId(id, 'div'));
    toggle.addEventListener('click', () => {
      dispatch({ type: 'displayToggled', key });
    });
    store.watch(
      (state) => state.display[key],
      (on) => {
        toggle.classList.toggle(ACTIVE_CLASS, on);
        for (const target of targets) target.classList.toggle(HIDDEN_CLASS, !on);
      },
    );
  }

  const capoDisplay = byId('capo-display', 'span');
  byId('capo-down', 'button').addEventListener('click', () => {
    dispatch({ type: 'capoShifted', delta: -1 });
  });
  byId('capo-up', 'button').addEventListener('click', () => {
    dispatch({ type: 'capoShifted', delta: 1 });
  });
  byId('capo-reset', 'button').addEventListener('click', () => {
    dispatch({ type: 'capoReset' });
  });
  store.watch(
    (state) => state.layout.capo,
    (capo) => {
      capoDisplay.textContent = formatCapo(capo);
      capoDisplay.dataset.nonzero = String(capo !== 0);
    },
  );
}
