// 全 tsconfig の型チェックを並列に実行する（順番に回すとプロジェクト数だけ時間がかかる）。
//   node scripts/typecheck.mjs
import { spawn } from 'node:child_process';

const PROJECTS = [
  'tsconfig.json', // アプリ（DOM あり）
  'tsconfig.pure.json', // 純粋層（DOM なしでコンパイルできることを確かめる）
  'tsconfig.worker.json', // Worker / AudioWorklet
  'tsconfig.test.json', // テスト
  'tsconfig.node.json', // ビルド設定
];

function check(project) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsc', '-p', project, '--pretty'], {
      shell: process.platform === 'win32',
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ project, code, output }));
  });
}

const results = await Promise.all(PROJECTS.map(check));
for (const { project, code, output } of results) {
  console.log(`${code === 0 ? '✓' : '✗'} ${project}`);
  if (output.trim()) console.log(output.trimEnd());
}
process.exit(results.some((result) => result.code !== 0) ? 1 : 0);
