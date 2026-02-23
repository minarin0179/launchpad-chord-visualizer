# Launchpad X Chord Visualizer — 実装リファレンス

> ユーザー向けの概要・起動方法・使い方は README.md を参照。

---

## Launchpad X MIDI仕様（Programmerモード）

### Programmerモードへの切替
```
SysEx: F0 00 20 29 02 0C 0E 01 F7
```

### パッド配置
```
[CC91][CC92][CC93][CC94][CC95][CC96][CC97][CC98][Logo99] ← 上段（丸）CC + ロゴ
[81]  [82]  [83]  [84]  [85]  [86]  [87]  [88]  [CC89]  ← 右端（丸）CC
[71]  [72]  [73]  [74]  [75]  [76]  [77]  [78]  [CC79]
[61]  [62]  [63]  [64]  [65]  [66]  [67]  [68]  [CC69]
[51]  [52]  [53]  [54]  [55]  [56]  [57]  [58]  [CC59]
[41]  [42]  [43]  [44]  [45]  [46]  [47]  [48]  [CC49]
[31]  [32]  [33]  [34]  [35]  [36]  [37]  [38]  [CC39]
[21]  [22]  [23]  [24]  [25]  [26]  [27]  [28]  [CC29]
[11]  [12]  [13]  [14]  [15]  [16]  [17]  [18]  [CC19]
```
- 8x8グリッド: **Note On/Off** — ノート番号 = `row*10 + col`（11〜88）
- 上段8ボタン: **CC** 91〜98
- 右列8ボタン: **CC** 89, 79, 69, 59, 49, 39, 29, 19（上から順）
- **ロゴボタン（右上角）: パッド番号 99** — LEDのみ制御可能（MIDI入力なし）

### LED制御（RGB SysEx）
```
F0 00 20 29 02 0C 03 [03 <pad> <r> <g> <b>]... F7
```
- ヘッダ: `F0 00 20 29 02 0C 03`
- 各LED: `03`（RGB指定タイプ） + パッド番号 + R(0-127) + G(0-127) + B(0-127)
- 複数LEDを1つのSysExメッセージにまとめて送信可能

### グリッドレイアウト（Guitar / Perfect 4th方式）
- `semitone = baseNote + row * 5 + col`
- 各行は下から上へ +5半音（完全4度）、各列は左から右へ +1半音
- デフォルトのベースノート: MIDI 36（C2）= 左下パッド

### MIDI入力
- 8x8グリッド Note On: `0x90 <note> <velocity>`（ch1）→ サステイン開始
- 8x8グリッド Note Off: `0x80 <note> 0` または `0x90 <note> 0`（ch1）→ リリース開始
- 上段ボタン: `0xB0 <cc> <value>`（CC, ch1）
- 右列ボタン: `0xB0 <cc> <value>`（CC, ch1）— CC 89,79,...,19
- ※右列はNote On送信のファームウェアもあるためコードでは両方をハンドル

### 上段ボタン割当
> 実装: `midi.js` → `handleTopRowPress(index)` → `shiftOctave(±12)` / `shiftCapo(±1)` 経由

| CC  | 機能 |
|-----|------|
| 91  | Octave Up (+12) — `shiftOctave(+1)` |
| 92  | Octave Down (-12) — `shiftOctave(-1)` |
| 93  | Capo Down (-1) — `shiftCapo(-1)`（baseNoteとrootを同時に-1、視覚パターン固定で移調） |
| 94  | Capo Up (+1) — `shiftCapo(+1)`（baseNoteとrootを同時に+1、視覚パターン固定で移調） |
| 95-98 | 未割当（将来用） |

---

## アプリのステート管理

```js
const state = {
  baseNote: 36,        // 左下パッドのMIDIノート番号（オクターブ/Capoで変動）
  root: 0,             // ルート音のピッチクラス（0=C, 1=C#, ..., 11=B）
  capo: 0,             // カポオフセット（半音数）— baseNoteとrootを同時にシフトした累積量
  chordType: 'maj',    // コードタイプキー
  inversion: 0,        // 転回形インデックス
  showChord: true,     // コードトーン表示ON/OFF（ルート音は常時表示）
  showScale: true,     // スケール表示ON/OFF
  showInversion: false, // 転回形UIの表示
  scale: 'major',      // スケールタイプキー
  instrument: 'piano', // 楽器プリセットキー（INSTRUMENTS のキー）
  midiOutput: null,    // 選択中のMIDI出力ポート
  midiAccess: null,    // MIDIAccessオブジェクト
  bpm: 120,            // メトロノームBPM（40〜240）
  metronome: false,    // メトロノームON/OFF
};
```

### 色分けルール
| 種別 | 画面CSS | Launchpad RGB |
|------|---------|---------------|
| ルート音 | `--root-color` (#ff4466) | [127, 0, 40] |
| 転回ベース音（`showInversion`=true かつ `inversion`>0 時） | `.pad.bass` (#ffaa33) | [127, 80, 0] |
| コードトーン（`showChord`=true時） | `--chord-color` (#33ddff) | [0, 100, 127] |
| スケール音（`showScale`=true時） | `--scale-color` (#44ff99) | [0, 127, 60] |
| その他 | off (#000) | [0, 0, 0] |
| 上段ボタン(機能あり) | — | [60, 30, 0] (orange) |
| ロゴ（接続中） | — | [0, 100, 0] (green) |
| ロゴ（メトロノームアクセント拍） | — | [127, 127, 127] (white) |
| ロゴ（メトロノーム通常拍） | — | [60, 80, 100] (blue-white) |

---

## ロゴボタン（パッド99）とメトロノーム

### ロゴボタンの動作
| 状態 | LED |
|------|-----|
| MIDI未接続 | 消灯 |
| デバイス接続時 | 緑 [0, 100, 0] |
| デバイス切断時 | 消灯（メトロノームも自動停止） |
| CLEARボタン後 | 緑維持（`updateLogoLED()` で再点灯） |
| メトロノームON・アクセント拍（1拍目） | 白フラッシュ [127, 127, 127] → 80ms後に緑 |
| メトロノームON・通常拍（2〜4拍目） | 青白フラッシュ [60, 80, 100] → 80ms後に緑 |

### メトロノーム仕様
- 固定4拍子（`main.js` のモジュールスコープ変数 `_metroBeat` が 0〜3 を循環、state には含まれない）
- アクセント拍（beat 0）: 1200Hz / 音量0.35 / 減衰55ms — **ぴ**
- 通常拍（beat 1〜3）: 700Hz / 音量0.18 / 減衰40ms — **ぽ**
- BPM変更時はタイマーを再スタート（拍カウンターもリセット）
- MIDI未接続時はSTARTボタンを押しても起動しない

---

## 主要定数（constants.js）

| 定数 | 値 / 型 | 用途 |
|------|--------|------|
| `INTERVAL_NAMES` | `['R','b2','2','b3','3','4','#4','5','b6','6','b7','7','(8)','b9','9']` | UI インターバル表記 |
| `MAX_BASE_NOTE_OCTAVE` | `108` | オクターブ Up 上限（これ以上は `shiftOctave` が無効） |
| `MAX_BASE_NOTE_CAPO` | `115` | カポ Up 上限（これ以上は `shiftCapo` が無効） |
| `LOGO_FLASH_MS` | `80` | ロゴLEDフラッシュ後に緑に戻すまでの遅延（ms） |
| `PROGRAMMER_MODE_DELAY_MS` | `150` | Programmer Mode SysEx 送信後の待機時間（ms） |
| `CLICK_PAD_VELOCITY` | `80` | 画面パッドクリック時の固定 velocity |
| `METRO_ACCENT` | `{ freq: 1200, vol: 0.35, decay: 0.055 }` | メトロノームアクセント拍（1拍目）音定数 |
| `METRO_NORMAL` | `{ freq: 700, vol: 0.18, decay: 0.040 }` | メトロノーム通常拍（2〜4拍目）音定数 |

---

## Web Audio シンセ仕様

### 楽器プリセット（constants.js `INSTRUMENTS`）

| キー | 名称 | 特徴 |
|------|------|------|
| `synth` | Synth | triangle+sine、velocity対応アタック（5〜50ms）、0.8秒リリース |
| `piano` | Piano ★デフォルト | sine+triangle、自然減衰（2秒でほぼ消音）、鍵盤離し後0.3秒リリース |
| `organ` | Organ | 第1〜4倍音の加算合成（sine×4）、即ON/OFF（0.04秒リリース） |
| `guitar` | Guitar | sawtooth+lowpass(2500Hz)、超高速アタック→200ms急速減衰（プラック感） |
| `bass` | Bass | sine+lowpass(600Hz)、サブオクターブ、パンチのある低音 |
| `strings` | Strings | sawtooth×2（+5cent detune）+lowpass(1800Hz)、スロー・アタック（0.15〜0.4秒） |

### 共通仕様
- **プリセット構造**: `{ osc1, osc2?, harmonics?, envelope, peakVolFactor, filter? }`
  - `harmonics` あり → 加算合成モード（Organ）
  - `filter` あり → BiquadFilterNode をゲインとdestinationの間に挿入
- **エンベロープ**: `{ attackBase, attackVelRange, decayTime, sustainRatio, releaseTime }`
  - attackTime = `attackBase + (1 - velocity/127) * attackVelRange`（高velocityほど速い）
- **`activeNotes` Map**: `{ oscNodes[], gain, ctx, releaseTime }` を格納

---

## 主要な関数

| 関数 | ファイル | 役割 |
|------|---------|------|
| `buildPadData(baseNote)` | `constants.js` | 8x8パッドのデータ配列を生成 |
| `buildGridDOM(onPadDown, onPadUp, onAfterRebuild)` | `grid.js` | 9x9 DOM要素を構築（上段CC + 右列 + 8x8） |
| `updateAll()` | `main.js` | 画面更新 + Launchpad LED送信の中心関数 |
| `getChordPitchClasses()` | `music.js` | コードのピッチクラスを返す（`{ all, inverted, bassPC }`）。`bassPC` は転回ベース音のPC（基本形時は `null`） |
| `sendToLaunchpad(chordPCs, scalePCs, rootPC, bassPC)` | `led.js` | SysEx RGBメッセージをLaunchpadに送信（bassPC対応） |
| `initMIDI(callbacks)` | `midi.js` | MIDI初期化・デバイス列挙・コールバック注入の統合エントリ（`setupMIDIInput` を内部で呼ぶ） |
| `rescanMIDI()` | `midi.js` | MIDI デバイス再スキャン（RESCAN ボタン用） |
| `setupMIDIInput(access)` | `midi.js` | MIDI入力リスナー設定（CC/Note On/Off 振り分け） |
| `startNote(midiNote, velocity?, volume?, onNoteChange?)` | `audio.js` | Web Audioでサステイン音を開始（`activeNotes` Mapに登録）。`volume` は `#volume` スライダー値（0〜1） |
| `stopNote(midiNote, onNoteChange?)` | `audio.js` | 鳴っている音にリリースをかけて停止（`activeNotes` から削除） |
| `shiftOctave(delta)` | `grid.js` | baseNote を ±12半音シフト（上段CC 91/92） |
| `shiftCapo(delta)` | `grid.js` | baseNoteとrootを同時にシフト（視覚パターン固定の移調） |
| `updateCapoDisplay()` | `grid.js` | Capo UIの数値表示を更新 |
| `updateBaseNoteDisplay()` | `grid.js` | `#scale-key-label` の `data-base` 属性を更新 |
| `handleTopRowPress(index)` | `grid.js` | 上段ボタン（CC 91-98）の動作分岐（`shiftOctave` / `shiftCapo` を呼び出す） |
| `handleRightColPress(index)` | `grid.js` | 右列ボタン（Note）のハンドラ（現在はログのみ） |
| `rebuildPads()` | `grid.js` | オクターブ/Capo後にパッドデータとDOMを更新 |
| `setProgrammerMode()` | `led.js` | SysExでProgrammerモードに切替 |
| `sendLogoLED(r, g, b)` | `led.js` | パッド99（ロゴ）にRGB色を送信（単体SysEx） |
| `updateLogoLED()` | `led.js` | 接続状態に応じてロゴLEDを更新（接続中=緑、切断=消灯） |
| `playMetronomeClick(isAccent)` | `audio.js` | メトロノームのクリック音を再生（アクセント拍/通常拍で周波数・音量が異なる） |
| `buildInversionButtons()` | `main.js` | Inversion 選択ボタンをコード種別の音数に応じて動的生成 |
| `metronomeBeat()` | `main.js` | 1ビート処理（LEDフラッシュ + クリック音 + 拍カウンター更新） |
| `startMetronome()` | `main.js` | メトロノーム開始（タイマー設定・拍カウンターリセット） |
| `stopMetronome()` | `main.js` | メトロノーム停止（タイマー解除・ロゴLEDを接続色に戻す） |

---

## ファイル構成

```
index.html       HTML 構造
style.css        スタイル
js/
  constants.js   音楽理論定数・楽器プリセット・グリッド定数・buildPadData()
  state.js       グローバル state・pads (live binding)・setPads()
  logger.js      log() 関数
  audio.js       Web Audio シンセ・メトロノーム音
  music.js       コード/スケール計算・コード自動検出
  led.js         SysEx LED 制御
  grid.js        グリッド DOM・カポ・オクターブ操作
  midi.js        MIDI デバイス管理・入力ハンドリング
  main.js        エントリーポイント・updateAll・メトロノーム・全体統合
```

### モジュール依存関係（循環なし）
```
constants → (none)
state     → constants
logger    → (none)
audio     → constants, state
music     → constants, state
led       → constants, state, music, logger
grid      → constants, state, logger
midi      → constants, state, grid, logger
main      → all
```

循環依存の回避は **コールバック注入** で行う（`main.js` が各モジュールにコールバックを渡す）。

---

## UI構成（三段組レイアウト）

上段（全幅）: ヘッダー + MIDIステータス

### 左パネル（MIDI / Audio / Debug）
1. Device — デバイス選択 / RESCAN / SEND / CLEAR
2. Volume — ボリュームスライダー
3. Metronome — BPMスライダー + 数値入力 + START/STOPボタン
4. Sound — 楽器プリセット選択（6種）
5. Log — イベントログ

### 中央パネル（Launchpad）
6. 9x9パッドグリッド（上段CC + 右列 + 8x8メイン）
7. コード名・構成音・インターバル表示（転回時はスラッシュコード表記: 例 `C/E`）

### 右パネル（Chord Controls）
8. Root — 12音ボタン（ラベル色 = `--root-color`、active色 = `--root-color`、常時表示）
9. Chord（トグルボタン兼ラベル、active色 = `--chord-color`）— コードタイプ17種
10. Scale（トグルボタン兼ラベル、active色 = `--scale-color`）— スケール種別7種
11. Inversion（トグルボタン兼ラベル、active色 = #ffaa33）— 転回形選択（動的生成）/ ON時のみ展開 / ラベル: Root / 1st / 2nd / 3rd / 4th
12. Capo — ◄ 数値表示 ► RST

### トグルの挙動
| トグル | 対象ラベル要素 | OFF時の動作 |
|--------|----------------|-------------|
| Chord | `#toggle-chord`（青） | コードトーン非表示（ルート音は常時表示） / `chord-control` 非表示 |
| Scale | `#toggle-scale`（緑） | スケール音非表示 / `scale-control` + `scale-key-label` 非表示 |
| Inversion | `#toggle-inversion` | `inversion-control` 非表示（トグルボタン自体は常時表示） |
