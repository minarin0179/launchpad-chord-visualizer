# Launchpad X Chord Visualizer

コード名を選択するとLaunchpad XのパッドをRGBで光らせ、パッド押下で音を鳴らすWebアプリ。

## プロジェクト構成

- `index.html` — HTML構造のみ（`style.css` と `js/main.js` を外部参照）
- `style.css` — 全スタイル定義
- `js/` — ロジック（ES Modules で機能別に分割）
  - `constants.js` — 音楽理論定数・楽器プリセット・グリッド定数・LED色・`buildPadData()`
  - `state.js` — グローバル `state` オブジェクト・`pads` (live binding)・`setPads()`
  - `logger.js` — `log()` 関数
  - `audio.js` — Web Audio シンセ（`startNote` / `stopNote`）・メトロノームクリック音
  - `music.js` — コード計算・スケール計算・コード自動検出・UI表示更新
  - `led.js` — SysEx LED 制御（`sendToLaunchpad` / `flashPressedPad` / `clearAllLEDs`）
  - `grid.js` — グリッド DOM 構築・カポ・オクターブ操作
  - `midi.js` — MIDI デバイス管理・MIDI 入力ハンドリング
  - `main.js` — エントリーポイント（`updateAll`・メトロノーム・ボタン生成・全体統合）
- ビルドツール・フレームワークなし。**ローカルサーバー経由で使用**（Chrome推奨）

## 技術スタック

- **Web MIDI API** — SysEx有効（`requestMIDIAccess({ sysex: true })`）
- **Web Audio API** — オシレーターベースのシンセ音源
- **Vanilla JS / ES Modules** — フレームワーク依存なし（`import` / `export`）
- **Google Fonts** — Space Mono / Noto Sans JP

> **起動方法**: ES Modules は `file://` 不可。`python -m http.server 8080` や VS Code Live Server を使用。

---

## Launchpad X MIDI仕様（Programmerモード）

### Programmerモードへの切替
```
SysEx: F0 00 20 29 02 0C 0E 01 F7
```

### パッド配置（Programmerモード）
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
- ※右列はNote On送信のファームウェアもあるためコードでは両方をハンドル

### LED制御（RGB SysEx）
```
F0 00 20 29 02 0C 03 [03 <pad> <r> <g> <b>]... F7
```
- ヘッダ: `F0 00 20 29 02 0C 03`
- 各LED: `03`（RGB指定タイプ） + パッド番号 + R(0-127) + G(0-127) + B(0-127)
- 複数LEDを1つのSysExメッセージにまとめて送信可能
- 上段CC・右列Noteのパッドも同じ方法でLED制御可能

### MIDI入力
- 8x8グリッド Note On: `0x90 <note> <velocity>`（ch1）→ サステイン開始
- 8x8グリッド Note Off: `0x80 <note> 0` または `0x90 <note> 0`（ch1）→ リリース開始
- 上段ボタン: `0xB0 <cc> <value>`（CC, ch1）
- 右列ボタン: `0xB0 <cc> <value>`（CC, ch1）— CC 89,79,...,19

### Windows固有の注意事項
- **MIDIポートは排他的** — Ableton Live等が使用中はブラウザからアクセス不可
- 認識しない場合: 他のDAWを閉じる → RESCANボタン

---

## 音楽レイアウト

### グリッド配置（ギター/Perfect 4th方式）
- 各行は下から上へ **+5半音**（完全4度）ずつシフト
- 各列は左から右へ **+1半音** ずつ
- デフォルトのベースノート: **MIDI 36（C2）** = 左下パッド
- `semitone = baseNote + row * 5 + col`

### 上段ボタン割当
| CC  | 機能 |
|-----|------|
| 91  | Octave Up (+12) — baseNoteを+12 |
| 92  | Octave Down (-12) — baseNoteを-12 |
| 93  | Capo Down (-1) — baseNoteとrootを同時に-1（視覚パターン固定で移調） |
| 94  | Capo Up (+1) — baseNoteとrootを同時に+1（視覚パターン固定で移調） |
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
  _metroTimer: null,   // setInterval ID（内部用）
  _metroBeat: 0,       // 拍カウンター（0=アクセント拍、1〜3=通常拍）
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
- BPM範囲: 40〜240（スライダー + 数値入力の双方向同期）
- 固定4拍子（`_metroBeat` が 0〜3 を循環）
- アクセント拍（beat 0）: 1200Hz / 音量0.35 / 減衰55ms — **ぴ**
- 通常拍（beat 1〜3）: 700Hz / 音量0.18 / 減衰40ms — **ぽ**
- BPM変更時はタイマーを再スタート（拍カウンターもリセット）
- MIDI未接続時はSTARTボタンを押しても起動しない

---

## コードタイプ一覧（17種）

Major, Minor, Dom7, Maj7, Min7, Dim, Dim7, Aug, Half-Dim(m7b5), Sus2, Sus4, Add9, Dom9, Maj9, Min9, Maj6, Min6

## スケール一覧（7種）

Major, Natural Minor, Dorian, Mixolydian, Pentatonic Major, Pentatonic Minor, Blues

## 楽器一覧（6種）

Synth, Piano, Organ, Guitar, Bass, Strings

---

## Web Audio シンセ仕様

楽器は `INSTRUMENTS` オブジェクトで定義されたプリセットから選択（UIの Sound ボタン）。

### 楽器プリセット（6種）

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
  - `filter` あり → BiquadFilterNode をガインとdestinationの間に挿入
- **エンベロープ**: `{ attackBase, attackVelRange, decayTime, sustainRatio, releaseTime }`
  - attackTime = `attackBase + (1 - velocity/127) * attackVelRange`（高velocityほど速い）
- **`activeNotes` Map**: `{ oscNodes[], gain, ctx, releaseTime }` を格納（従来の osc1/osc2 から変更）
- velocity: アタック時間とピーク音量の両方に影響
- ボリュームスライダーで調整
- 画面パッドのクリックは velocity=80 固定

---

## 主要な関数

| 関数 | ファイル | 役割 |
|------|---------|------|
| `buildPadData(baseNote)` | `constants.js` | 8x8パッドのデータ配列を生成 |
| `buildGridDOM(onPadDown, onPadUp, onAfterRebuild)` | `grid.js` | 9x9 DOM要素を構築（上段CC + 右列 + 8x8） |
| `updateAll()` | `main.js` | 画面更新 + Launchpad LED送信の中心関数 |
| `getChordPitchClasses()` | `music.js` | コードのピッチクラスを返す（`{ all, inverted, bassPC }`）。`bassPC` は転回ベース音のPC（基本形時は `null`） |
| `sendToLaunchpad(chordPCs, scalePCs, rootPC, bassPC)` | `led.js` | SysEx RGBメッセージをLaunchpadに送信（bassPC対応） |
| `setupMIDIInput(access)` | `midi.js` | MIDI入力リスナー設定（CC/Note On/Off 振り分け） |
| `startNote(midiNote, velocity?, onNoteChange?)` | `audio.js` | Web Audioでサステイン音を開始（`activeNotes` Mapに登録） |
| `stopNote(midiNote, onNoteChange?)` | `audio.js` | 鳴っている音にリリースをかけて停止（`activeNotes` から削除） |
| `shiftCapo(delta)` | `grid.js` | baseNoteとrootを同時にシフト（視覚パターン固定の移調） |
| `updateCapoDisplay()` | `grid.js` | Capo UIの数値表示を更新 |
| `rebuildPads()` | `grid.js` | オクターブ/Capo後にパッドデータとDOMを更新 |
| `setProgrammerMode()` | `led.js` | SysExでProgrammerモードに切替 |
| `sendLogoLED(r, g, b)` | `led.js` | パッド99（ロゴ）にRGB色を送信（単体SysEx） |
| `updateLogoLED()` | `led.js` | 接続状態に応じてロゴLEDを更新（接続中=緑、切断=消灯） |
| `playMetronomeClick(isAccent)` | `audio.js` | メトロノームのクリック音を再生（アクセント拍/通常拍で周波数・音量が異なる） |
| `metronomeBeat()` | `main.js` | 1ビート処理（LEDフラッシュ + クリック音 + 拍カウンター更新） |
| `startMetronome()` | `main.js` | メトロノーム開始（タイマー設定・拍カウンターリセット） |
| `stopMetronome()` | `main.js` | メトロノーム停止（タイマー解除・ロゴLEDを接続色に戻す） |

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
9. Chord（トグルボタン兼ラベル、active色 = `--chord-color`）— コードタイプ17種（active色 = `--chord-color`）
10. Scale（トグルボタン兼ラベル、active色 = `--scale-color`）— スケール種別7種（active色 = `--scale-color`）
11. Inversion（トグルボタン兼ラベル、active色 = #ffaa33）— 転回形選択（動的生成）/ ON時のみ展開 / ラベル: Root / 1st / 2nd / 3rd / 4th（active色 = #ffaa33）
12. Capo — ◄ 数値表示 ► RST（視覚パターン固定で半音単位移調）

### トグルの挙動
| トグル | 対象ラベル要素 | OFF時の動作 |
|--------|----------------|-------------|
| Chord | `#toggle-chord`（青） | コードトーン非表示（ルート音は常時表示） / `chord-control` 非表示 |
| Scale | `#toggle-scale`（緑） | スケール音非表示 / `scale-control` + `scale-key-label` 非表示 |
| Inversion | `#toggle-inversion` | `inversion-control` 非表示（トグルボタン自体は常時表示） |
