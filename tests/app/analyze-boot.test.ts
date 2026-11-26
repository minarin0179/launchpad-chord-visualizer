// @vitest-environment happy-dom
/**
 * 統合テスト: 解析ページの HTML に analyze.ts を読み込む。
 * 起動時の要素の取りこぼし（HTML と JS の id の食い違い）と、保存済みの解析結果の表示を確かめる。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Features } from '../../src/analyzer/types.ts';
import { loadGolden } from '../helpers/golden.ts';

const html = readFileSync(resolve(import.meta.dirname, '../../next-analyze.html'), 'utf8');
const VIDEO_ID = 'dQw4w9WgXcQ';
const features = loadGolden<{ name: string; features: Features }[]>('analyzer').find(
  (c) => c.name === 'stereo-44100',
)!.features;

const $ = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} not found`);
  return element;
};

/** YouTube IFrame API の代わり */
class FakeYouTubePlayer {
  time = 0;
  state = 2;
  readonly seeks: number[] = [];
  constructor(_id: string, options: { events: { onReady: () => void } }) {
    queueMicrotask(options.events.onReady);
  }
  cueVideoById = (): void => undefined;
  playVideo = (): void => {
    this.state = 1;
  };
  pauseVideo = (): void => {
    this.state = 2;
  };
  seekTo = (sec: number): void => {
    this.seeks.push(sec);
    this.time = sec;
  };
  getCurrentTime = (): number => this.time;
  getDuration = (): number => 16;
  getPlayerState = (): number => this.state;
  getPlaybackRate = (): number => 1;
  setPlaybackRate = (): void => undefined;
  getAvailablePlaybackRates = (): number[] => [0.5, 1, 1.5, 2];
}

let frame: () => void = () => undefined;

beforeAll(async () => {
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<script/.exec(html)![1]!;
  localStorage.clear();
  // 旧バージョンが保存した形（decodeOptions なし）
  localStorage.setItem(
    `chord-analyzer:v2:${VIDEO_ID}`,
    JSON.stringify({
      features,
      source: 'scan',
      useSongle: false,
      offsetMs: 50,
      capo: 0,
      capoAuto: true,
      savedAt: 1,
    }),
  );
  history.replaceState(null, '', `?v=${VIDEO_ID}`);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frame = callback;
    return 0;
  });
  Object.assign(window, { YT: { Player: FakeYouTubePlayer } });
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof HTMLCanvasElement.prototype.getContext;

  await import('../../src/analyze.ts');
  await new Promise((r) => setTimeout(r, 50));
});

describe('解析ページ', () => {
  it('保存済みの解析結果を読み込んで表示する', () => {
    expect($('status').textContent).toBe('保存済みの解析結果を読み込みました（タブスキャン）');
    expect($('info-source').textContent).toBe('タブスキャン');
    expect($('info-tempo').textContent).toContain('120 BPM');
    expect(($('yt-url') as HTMLInputElement).value).toBe(
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    );
    expect($('opt-offset-value').textContent).toBe('50 ms');
    expect($('blocks').children.length).toBeGreaterThan(5);
    expect($('chart').children).toHaveLength($('blocks').children.length);
    expect(($('scan-btn') as HTMLButtonElement).disabled).toBe(false);
    expect(($('scan-rate') as HTMLSelectElement).value).toBe('2');
  });

  it('再生位置のコードと次のコードを表示する', () => {
    frame();
    expect($('now-chord').textContent).not.toBe('—');
    expect($('next-chord').textContent).not.toBe('—');
    expect($('next-in').textContent).toMatch(/^in \d+\.\ds$/);
    expect($('blocks').querySelectorAll('.active')).toHaveLength(1);
  });

  it('デコード設定を変えると表示が変わり、設定ごと保存される', () => {
    const before = $('chart').children.length;
    const vocabulary = $('opt-vocab') as HTMLSelectElement;
    vocabulary.value = 'triads';
    vocabulary.dispatchEvent(new Event('input'));
    expect($('chart').children.length).toBeLessThanOrEqual(before);
    const saved = JSON.parse(localStorage.getItem(`chord-analyzer:v2:${VIDEO_ID}`) ?? '{}') as {
      decodeOptions?: { vocabulary?: string };
      features?: unknown;
    };
    expect(saved.decodeOptions?.vocabulary).toBe('triads');
    expect(saved.features).toEqual(features);
  });

  it('カポを手動で動かすと AUTO が外れ、0〜11 で一周する', () => {
    const auto = Number($('capo-value').textContent);
    $('capo-down').dispatchEvent(new MouseEvent('click'));
    expect($('capo-auto').classList.contains('active')).toBe(false);
    expect(Number($('capo-value').textContent)).toBe((auto + 11) % 12);
    $('capo-auto').dispatchEvent(new MouseEvent('click'));
    expect(Number($('capo-value').textContent)).toBe(auto);
  });

  it('チャートのコードをクリックすると、その位置へシークして選択表示になる', () => {
    const chip = $('chart').children[2] as HTMLElement;
    chip.dispatchEvent(new MouseEvent('click'));
    frame();
    expect(chip.classList.contains('active')).toBe(true);
    expect($('now-chord').textContent).toBe(chip.lastChild?.textContent);
  });
});
