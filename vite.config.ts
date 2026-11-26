import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * ビルド対象のページ。
 * リライト中は旧アプリ (index.html / analyze.html) と新アプリ (next*.html) が並存するので、
 * 存在する新アプリのページだけをビルドする。切り替え後は index.html / analyze.html になる。
 */
const PAGES = ['next.html', 'next-analyze.html'].filter((page) => existsSync(fromRoot(page)));

/**
 * 作業フォルダが Windows のドライブを 9p でマウントしたもの（WSL2 / Dev Container）かどうか。
 * 9p ではファイルの変更通知が届かないので、開発サーバーは定期的に見に行く方式（ポーリング）に切り替える。
 */
function isOn9pMount(): boolean {
  try {
    const root = fromRoot('.').replace(/\/$/, '');
    return readFileSync('/proc/mounts', 'utf8')
      .split('\n')
      .some((line) => {
        const [, mountPoint, type] = line.split(' ');
        return type === '9p' && mountPoint !== undefined && root.startsWith(mountPoint);
      });
  } catch {
    return false;
  }
}

/** 開発サーバー / プレビューの待ち受け設定 */
const SERVER = {
  // 既定の localhost は IPv6（::1）だけで待ち受けることがあり、コンテナの外（ポート転送先）から届かない。
  // 全インターフェースで待ち受ける
  host: true,
  port: 5173,
} as const;

export default defineConfig({
  server: { ...SERVER, watch: { usePolling: isOn9pMount(), interval: 300 } },
  preview: { ...SERVER, port: 4173 },
  // Cloudflare Pages のサブパス / プレビュー URL でも動くよう相対パスで出力する
  base: './',
  resolve: {
    alias: {
      'launchpad-x': fromRoot('./packages/launchpad-x/src/index.ts'),
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: Object.fromEntries(PAGES.map((page) => [page.replace(/\.html$/, ''), fromRoot(page)])),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
