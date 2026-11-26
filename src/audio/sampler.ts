import {
  instrumentDef,
  SAMPLE_NOTE_RANGE,
  SAMPLE_RELEASE_SEC,
  SAMPLE_VOLUME,
  SOUNDFONT_KIT,
  type InstrumentKey,
} from '../config/instruments';
import type { CacheStorage, Soundfont } from 'smplr';
import type { MidiNote } from '../core/pitch';
import type { SampleStatus } from '../store/state';
import type { Voice } from './synth-voice';

/** smplr 本体は必要になるまで読み込まない（型だけを先に参照する） */
type SoundfontPlayer = Soundfont;
interface SmplrModule {
  readonly Soundfont: typeof Soundfont;
  readonly CacheStorage: typeof CacheStorage;
}

export type SampleStatusListener = (
  instrument: InstrumentKey,
  status: SampleStatus,
  detail?: string,
) => void;

/**
 * GM Soundfont のサンプル音源（smplr）。
 *
 * - smplr 本体は最初に必要になったときに読み込む（別チャンク）
 * - 音色は選択時 / 初回発音時にロードする。ロードが終わるまでは呼び出し元が合成音で鳴らす
 * - サンプルは CDN から取得し、2 回目以降は Cache API から読む
 * - ロードに失敗した音色は、選び直すまで合成音にフォールバックする（オフラインでもアプリは動く）
 */
export class Sampler {
  private smplr: Promise<SmplrModule> | null = null;
  private storage: CacheStorage | null = null;
  private readonly players = new Map<InstrumentKey, SoundfontPlayer>();
  private readonly loading = new Set<InstrumentKey>();
  private readonly failed = new Set<InstrumentKey>();

  constructor(private readonly onStatus: SampleStatusListener) {}

  /** その音色でサンプル音源を使うか（サンプルがあり、ロードに失敗していない） */
  usesSamples(instrument: InstrumentKey): boolean {
    return instrumentDef(instrument).gm !== null && !this.failed.has(instrument);
  }

  /** 音色を選び直したときに、前回の失敗を忘れてもう一度ロードを試せるようにする */
  forgetFailure(instrument: InstrumentKey): void {
    this.failed.delete(instrument);
  }

  /** サンプルをロードする（ロード済み・ロード中・失敗済みなら何もしない）。失敗しても例外は投げない */
  load(ctx: AudioContext, destination: AudioNode, instrument: InstrumentKey): void {
    const { gm } = instrumentDef(instrument);
    if (
      gm === null ||
      this.players.has(instrument) ||
      this.loading.has(instrument) ||
      this.failed.has(instrument)
    ) {
      return;
    }
    this.loading.add(instrument);
    this.onStatus(instrument, 'loading');
    this.createPlayer(ctx, destination, gm).then(
      (player) => {
        this.loading.delete(instrument);
        this.players.set(instrument, player);
        this.onStatus(instrument, 'loaded');
      },
      (error: unknown) => {
        this.loading.delete(instrument);
        this.failed.add(instrument);
        this.onStatus(instrument, 'failed', error instanceof Error ? error.message : String(error));
      },
    );
  }

  /** サンプルで 1 音鳴らす。ロード済みでなければ null（呼び出し元が合成音に回す） */
  start(instrument: InstrumentKey, note: MidiNote, velocity: number, stopId: string): Voice | null {
    const player = this.players.get(instrument);
    if (!player) return null;
    const stop = player.start({
      note,
      velocity,
      stopId,
      ampRelease: instrumentDef(instrument).release ?? SAMPLE_RELEASE_SEC,
    });
    return {
      stop: () => {
        stop();
      },
    };
  }

  private async createPlayer(
    ctx: AudioContext,
    destination: AudioNode,
    gm: string,
  ): Promise<SoundfontPlayer> {
    this.smplr ??= import('smplr').catch((error: unknown) => {
      // 読み込みに失敗したら、次の音色でもう一度試せるようにする
      this.smplr = null;
      throw error;
    });
    const smplr = await this.smplr;
    this.storage ??= smplr.CacheStorage();
    const notes = Array.from(
      { length: SAMPLE_NOTE_RANGE.high - SAMPLE_NOTE_RANGE.low + 1 },
      (_, i) => SAMPLE_NOTE_RANGE.low + i,
    );
    const player = smplr.Soundfont(ctx, {
      instrument: gm,
      kit: SOUNDFONT_KIT,
      storage: this.storage,
      destination,
      volume: SAMPLE_VOLUME,
      // loadLoopData は使わない（配信されているループ点が MusyngKite のサンプルに合わず、音量が脈打つ）
      notesToLoad: { notes, fallback: 'nearest' },
    });
    await player.ready;
    return player;
  }
}
