/** ログの種類（画面では色分けする）: in = MIDI 入力、out = 送信・状態変化、err = エラー、info = その他 */
export type LogKind = 'in' | 'out' | 'err' | 'info';

export interface LogEntry {
  readonly message: string;
  readonly kind: LogKind;
  readonly time: Date;
}

export type LogSink = (entry: LogEntry) => void;

/**
 * イベントログ。出力先（画面の Log パネル・コンソール）は後から登録する。
 * DOM に依存しないので、ログを出すモジュールも DOM なしでテストできる。
 */
export class Logger {
  private readonly sinks = new Set<LogSink>();

  addSink(sink: LogSink): void {
    this.sinks.add(sink);
  }

  log(message: string, kind: LogKind = 'info'): void {
    const entry: LogEntry = { message, kind, time: new Date() };
    for (const sink of this.sinks) sink(entry);
  }

  in(message: string): void {
    this.log(message, 'in');
  }

  out(message: string): void {
    this.log(message, 'out');
  }

  error(message: string): void {
    this.log(message, 'err');
  }
}

/** エラーオブジェクトから表示用のメッセージを取り出す */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
