// @vitest-environment happy-dom
/**
 * 統合テスト: 実際の HTML に main.ts を読み込み、偽の MIDI デバイスとやり取りさせる。
 * 起動時の要素の取りこぼし（HTML と JS の id の食い違い）と、部品同士のつなぎ方を確かめる。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  FakeMidiAccess,
  FakeMidiInput,
  FakeMidiOutput,
  parseLedSysex,
  PROGRAMMER_MODE_SYSEX,
} from '../helpers/fake-midi.ts';

const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8');
const output = new FakeMidiOutput('out-1', 'Launchpad X LPX MIDI Out');
const input = new FakeMidiInput('in-1', 'Launchpad X LPX MIDI In');
const access = new FakeMidiAccess();

/** 最後に届いた LED の状態（差分送信を積み重ねたもの） */
function ledState(): Map<number, [number, number, number]> {
  const leds = new Map<number, [number, number, number]>();
  for (const message of output.sent) {
    for (const [pad, color] of parseLedSysex(message) ?? []) leds.set(pad, color);
  }
  return leds;
}

const $ = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} not found`);
  return element;
};
const pads = (): HTMLElement[] => [...$('pad-grid').children] as HTMLElement[];
/** 画面上のパッド（row 0 = 最下段） */
const padAt = (row: number, col: number): HTMLElement => pads()[9 + (7 - row) * 9 + col];
const click = (element: Element): void => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const buttonIn = (containerId: string, label: string): HTMLElement => {
  const button = [...$(containerId).querySelectorAll('button')].find(
    (b) => b.textContent === label,
  );
  if (!button) throw new Error(`button "${label}" not found in #${containerId}`);
  return button;
};

beforeAll(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<script/.exec(html)![1]!;
  localStorage.clear();
  access.add(output, input);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
    },
  );
  vi.stubGlobal(
    'Worker',
    class {
      postMessage(): void {}
    },
  );
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    value: () => Promise.resolve(access),
    configurable: true,
  });
  HTMLElement.prototype.setPointerCapture = () => undefined;

  await import('../../src/main.ts');
  await vi.advanceTimersByTimeAsync(500);
});

describe('起動', () => {
  it('9 × 9 のグリッドとボタン群を作る', () => {
    expect(pads()).toHaveLength(81);
    expect($('root-buttons').children).toHaveLength(12);
    expect($('chord-buttons').children).toHaveLength(17);
    expect($('scale-buttons').children).toHaveLength(7);
    expect($('instrument-buttons').children).toHaveLength(22);
    expect(
      pads()
        .slice(0, 8)
        .map((p) => p.dataset.note),
    ).toEqual(['OCT▲', 'OCT▼', '◄', '►', '▶', '◄◄', 'FLW', 'A-B']);
  });

  it('デフォルトは C メジャー: 左下が C（ルート）', () => {
    expect(padAt(0, 0).dataset.note).toBe('C');
    expect(padAt(0, 0).classList.contains('root')).toBe(true);
    expect(padAt(0, 4).classList.contains('chord')).toBe(true); // E
    expect(padAt(0, 2).classList.contains('scale')).toBe(true); // D
    expect(padAt(0, 1).classList.contains('off')).toBe(true); // C#
    expect($('chord-name').textContent).toBe('C');
    expect($('scale-key-label').textContent).toBe('C Major Scale  [Base: C2]');
  });

  it('Launchpad に自動接続し、Programmer モードへの切替を 1 回だけ送る', () => {
    expect($('midi-status').textContent).toBe('Connected: Launchpad X LPX MIDI Out');
    expect($('midi-status').className).toBe('connected');
    expect(output.sent.filter((m) => m.join() === PROGRAMMER_MODE_SYSEX.join())).toHaveLength(1);
    expect(output.sent[0]).toEqual(PROGRAMMER_MODE_SYSEX);
    expect(input.opened).toBe(1);
    expect(($('send-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('全 LED（64 パッド + 上段 8 + ロゴ）を送る', () => {
    const leds = ledState();
    expect(leds.size).toBe(73);
    expect(leds.get(11)).toEqual([127, 0, 40]); // 左下 = ルート
    expect(leds.get(15)).toEqual([0, 100, 127]); // E = コードトーン
    expect(leds.get(13)).toEqual([0, 127, 60]); // D = スケール
    expect(leds.get(12)).toEqual([0, 0, 0]);
    expect(leds.get(91)).toEqual([60, 30, 0]); // オクターブ
    expect(leds.get(95)).toEqual([3, 3, 3]); // 曲が無いときの Song ボタン
    expect(leds.get(99)).toEqual([0, 100, 0]); // ロゴ
  });

  it('ポートの状態変化が通知されても、選択が同じなら接続し直さない', async () => {
    const before = output.sent.length;
    access.onstatechange?.();
    access.onstatechange?.();
    await vi.advanceTimersByTimeAsync(500);
    expect(output.sent).toHaveLength(before);
    expect(input.opened).toBe(1);
  });
});

describe('操作', () => {
  it('ルートとコードを選ぶと、画面と LED の変わった部分だけが更新される', () => {
    const before = output.sent.length;
    click(buttonIn('root-buttons', 'A'));
    click(buttonIn('chord-buttons', 'Min 7'));
    expect($('chord-name').textContent).toBe('Am7');
    expect($('chord-notes').textContent).toBe('A  C  E  G');
    expect(buttonIn('root-buttons', 'A').classList.contains('active')).toBe(true);
    expect(padAt(0, 0).classList.contains('chord')).toBe(true); // C は Am7 の構成音
    expect(ledState().get(11)).toEqual([0, 100, 127]);
    const updates = output.sent.slice(before).map((m) => parseLedSysex(m)?.size ?? 0);
    expect(updates.every((count) => count > 0 && count < 73)).toBe(true);
  });

  it('カポを上げるとルートと音名が一緒に動き、パッド上の形は変わらない', () => {
    const shape = pads().map((p) => p.className);
    click($('capo-up'));
    expect($('capo-display').textContent).toBe('+1');
    expect($('chord-name').textContent).toBe('A#m7');
    expect(padAt(0, 0).dataset.note).toBe('C#');
    expect(pads().map((p) => p.className)).toEqual(shape);
    click($('capo-reset'));
    expect($('capo-display').textContent).toBe('0');
    expect($('chord-name').textContent).toBe('Am7');
  });

  it('Launchpad のパッドを押すと押下表示になり、同じ音のパッドの LED が白くなる', () => {
    input.receive(0x90, 16, 100); // 最下段の左から 6 番目 = F2
    expect(padAt(0, 5).classList.contains('pressed')).toBe(true);
    expect(ledState().get(16)).toEqual([127, 127, 127]);
    expect(ledState().get(21)).toEqual([127, 127, 127]); // 2 段目の左端も同じ F2
    expect($('log').textContent).toContain('Pad IN: note=16 → F2 vel=100');

    input.receive(0x80, 16, 0);
    expect(padAt(0, 5).classList.contains('pressed')).toBe(false);
    expect(ledState().get(16)).toEqual([0, 0, 0]);
  });

  it('押しているパッドの表示は、コードを変えても消えない', () => {
    input.receive(0x90, 11, 100);
    click(buttonIn('chord-buttons', 'Major'));
    expect(padAt(0, 0).classList.contains('pressed')).toBe(true);
    input.receive(0x90, 11, 0); // ベロシティ 0 の Note On = Note Off
    expect(padAt(0, 0).classList.contains('pressed')).toBe(false);
  });

  it('押さえた音からコードを検出する', () => {
    for (const pad of [11, 15, 18]) input.receive(0x90, pad, 100); // C E G
    expect($('detected-chord-names').textContent).toContain('C');
    expect($('detected-chord-names').querySelector('.exact')?.textContent).toBe('C');
    for (const pad of [11, 15, 18]) input.receive(0x80, pad, 0);
    expect($('detected-chord-names').textContent).toBe('—');
  });

  it('上段ボタン（CC 91 / 94）でオクターブとカポを操作できる', () => {
    input.receive(0xb0, 91, 127);
    expect($('scale-key-label').textContent).toContain('[Base: C3]');
    input.receive(0xb0, 92, 127);
    input.receive(0xb0, 94, 127);
    expect($('capo-display').textContent).toBe('+1');
    input.receive(0xb0, 93, 127);
    expect($('capo-display').textContent).toBe('0');
    expect($('scale-key-label').textContent).toContain('[Base: C2]');
  });

  it('画面のパッドは押している間だけ押下表示になる（マウスを外しただけでは離れない）', () => {
    const pad = padAt(1, 0);
    const pointer = (type: string): void => {
      pad.dispatchEvent(new PointerEvent(type, { pointerId: 7, bubbles: true }));
    };
    pointer('pointerdown');
    expect(pad.classList.contains('pressed')).toBe(true);
    pointer('pointerleave');
    expect(pad.classList.contains('pressed')).toBe(true);
    pointer('pointerup');
    expect(pad.classList.contains('pressed')).toBe(false);
  });

  it('CLEAR で全消灯し、次の操作で点け直す', () => {
    click($('clear-btn'));
    expect(ledState().get(11)).toEqual([0, 0, 0]);
    expect(ledState().get(99)).toEqual([0, 100, 0]);
    click(buttonIn('root-buttons', 'C'));
    expect(ledState().get(11)).toEqual([127, 0, 40]);
  });

  it('メトロノームは拍ごとにロゴを光らせ、BPM を変えても止まらない', async () => {
    click($('metro-btn'));
    expect($('metro-btn').textContent).toBe('■ STOP');
    await vi.advanceTimersByTimeAsync(20);
    expect(ledState().get(99)).toEqual([127, 127, 127]); // 1 拍目
    await vi.advanceTimersByTimeAsync(100);
    expect(ledState().get(99)).toEqual([0, 100, 0]);
    await vi.advanceTimersByTimeAsync(420);
    expect(ledState().get(99)).toEqual([60, 80, 100]); // 2 拍目
    const slider = $('metro-bpm') as HTMLInputElement;
    slider.value = '200';
    slider.dispatchEvent(new Event('input'));
    expect($('metro-btn').textContent).toBe('■ STOP');
    click($('metro-btn'));
    expect($('metro-btn').textContent).toBe('▶ START');
  });

  it('設定を localStorage に保存する', async () => {
    click(buttonIn('root-buttons', 'D'));
    await vi.advanceTimersByTimeAsync(400);
    const saved = JSON.parse(
      localStorage.getItem('launchpad-chord-visualizer:settings') ?? '{}',
    ) as Record<string, unknown>;
    expect(saved).toMatchObject({ root: 2, chordType: 'maj', baseNote: 36, capo: 0, bpm: 200 });
  });

  it('デバイスを抜くと未接続になり、押していた音とメトロノームを止める', async () => {
    click($('metro-btn'));
    input.receive(0x90, 11, 100);
    access.remove(output, input);
    access.onstatechange?.();
    await vi.advanceTimersByTimeAsync(200);
    expect($('midi-status').textContent).toBe('No device — press RESCAN');
    expect(padAt(0, 0).classList.contains('pressed')).toBe(false);
    expect($('metro-btn').textContent).toBe('▶ START');
    expect(($('send-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('挿し直すと自動で再接続して全 LED を送り直す', async () => {
    const before = output.sent.length;
    access.add(output, input);
    access.onstatechange?.();
    await vi.advanceTimersByTimeAsync(500);
    expect($('midi-status').className).toBe('connected');
    const sent = output.sent.slice(before);
    expect(sent[0]).toEqual(PROGRAMMER_MODE_SYSEX);
    expect(parseLedSysex(sent[1])?.size).toBe(73);
  });
});
