// =====================
// 設定の保存・復元（localStorage）
// リロードしても音量・BPM・音色・コード / スケール選択・トグル・カポ / オクターブを引き継ぐ。
// localStorage が使えない環境（プライベートウィンドウ等）では何もしない。
// =====================
const SETTINGS_KEY = 'launchpad-chord-visualizer:settings';
const DEVICE_KEY = 'launchpad-chord-visualizer:device';

export function loadSettings() {
  try {
    const obj = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

let _pending = null;
let _timer = null;

// 連続した変更（スライダー操作など）はまとめて 300ms 後に書き込む
export function saveSettings(obj) {
  _pending = { ...(_pending ?? loadSettings()), ...obj };
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(_pending)); } catch { /* 保存不可 */ }
    _pending = null;
  }, 300);
}

// 前回ユーザーが選んだ MIDI 出力ポート名。null = 未保存、'' = ユーザーが「未選択」にした
export function loadDeviceName() {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}

export function saveDeviceName(name) {
  try { localStorage.setItem(DEVICE_KEY, name); } catch { /* 保存不可 */ }
}
