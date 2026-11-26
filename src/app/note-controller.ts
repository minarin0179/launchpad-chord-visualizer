import type { AudioEngine } from '../audio/engine';
import type { Voice } from '../audio/synth-voice';
import type { Action } from '../store/actions';
import type { Store } from '../store/create-store';
import { selectPads } from '../store/selectors';
import type { AppState } from '../store/state';

/**
 * パッドの押下 → 発音。
 *
 * 押下 1 回 = 1 ボイス。鳴らす音は押した瞬間のパッド配置で決まり、
 * 離すときは押下の識別子で止める（押している間にカポ・オクターブを変えても同じ音を止められる）。
 */
export class NoteController {
  private readonly voices = new Map<string, Voice>();

  constructor(
    private readonly store: Store<AppState, Action>,
    private readonly audio: AudioEngine,
  ) {
    // デバイスの切断などで押下が取り消されたら、対応する音も止める
    store.watch(
      (state) => state.held,
      (held) => {
        const active = new Set(held.map((h) => h.pressId));
        for (const pressId of [...this.voices.keys()]) {
          if (!active.has(pressId)) this.stopVoice(pressId);
        }
      },
    );
  }

  /** @returns 鳴らした音（パッドが無ければ null） */
  press(pressId: string, padIndex: number, velocity: number): number | null {
    const pad = selectPads(this.store.getState()).at(padIndex);
    if (!pad) return null;
    this.stopVoice(pressId);
    this.voices.set(pressId, this.audio.noteOn(pad.note, velocity));
    this.store.dispatch({ type: 'padPressed', pressId, padIndex, note: pad.note });
    return pad.note;
  }

  release(pressId: string): void {
    this.stopVoice(pressId);
    this.store.dispatch({ type: 'padReleased', pressId });
  }

  /** pressId がこの接頭辞で始まる押下をすべて離す（'' = 全部） */
  releaseAll(prefix = ''): void {
    this.store.dispatch({ type: 'padsReleased', prefix });
  }

  private stopVoice(pressId: string): void {
    this.voices.get(pressId)?.stop();
    this.voices.delete(pressId);
  }
}
