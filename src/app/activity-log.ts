import { INSTRUMENTS } from '../config/instruments';
import { noteLabel, noteName } from '../core/pitch';
import type { Logger } from '../platform/logger';
import type { Action } from '../store/actions';
import type { Store } from '../store/create-store';
import { selectBaseNote } from '../store/selectors';
import type { AppState } from '../store/state';

/** 状態の変化をイベントログに書く（操作した場所に関係なく、結果が変わったときだけ） */
export function logStateChanges(store: Store<AppState, Action>, logger: Logger): void {
  store.subscribe((state, previous) => {
    const base = selectBaseNote(state);
    if (state.layout.capo !== previous.layout.capo) {
      const { capo } = state.layout;
      logger.out(
        `Capo ${capo >= 0 ? '+' : ''}${capo} → ${noteName(state.manual.root)} (base=${base})`,
      );
    } else if (base !== selectBaseNote(previous)) {
      logger.out(`Octave → ${noteLabel(base)} (base=${base})`);
    }
    if (state.metronome.running !== previous.metronome.running) {
      logger.out(
        state.metronome.running ? `Metronome ON — ${state.metronome.bpm} BPM` : 'Metronome OFF',
      );
    }
    if (state.song.follow !== previous.song.follow)
      logger.out(`Song: FOLLOW ${state.song.follow ? 'ON' : 'OFF'}`);
    if (state.song.practice !== previous.song.practice) {
      logger.out(`Song: practice ${state.song.practice ? 'ON' : 'OFF'}`);
    }
    for (const key of Object.keys(state.audio.samples) as (keyof typeof INSTRUMENTS)[]) {
      const status = state.audio.samples[key];
      if (status === previous.audio.samples[key] || status === 'loading') continue;
      const { label } = INSTRUMENTS[key];
      logger.log(
        status === 'loaded'
          ? `Sample loaded: ${label}`
          : `Sample load failed: ${label} (synth fallback)`,
      );
    }
  });
}
