import { byId, createElement } from '../platform/dom';
import type { LogEntry, LogKind, LogSink } from '../platform/logger';

/** ログの種類 → CSS クラス（style.css の `#log .log-*`） */
const KIND_CLASS: Record<LogKind, string> = {
  in: 'log-in',
  out: 'log-out',
  err: 'log-err',
  info: '',
};

/** 画面に残す行数（古い行から捨てる） */
const MAX_LINES = 300;

/** 左パネルの Log に 1 行ずつ追記する出力先 */
export function createLogPanelSink(): LogSink {
  const panel = byId('log', 'div');
  return ({ message, kind, time }: LogEntry) => {
    panel.appendChild(
      createElement('div', {
        className: KIND_CLASS[kind],
        text: `[${time.toLocaleTimeString()}] ${message}`,
      }),
    );
    while (panel.childElementCount > MAX_LINES) panel.firstElementChild?.remove();
    panel.scrollTop = panel.scrollHeight;
  };
}
