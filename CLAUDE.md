# Launchpad X Chord Visualizer

コード名を選択するとLaunchpad XのパッドをRGBで光らせ、パッド押下で音を鳴らすWebアプリ。

## プロジェクト構成

- `index.html` — HTML構造のみ（`style.css` と `app.js` を外部参照）
- `style.css` — 全スタイル定義
- `app.js` — 全ロジック（音楽理論データ・DOM操作・MIDI・Web Audio）
- ビルドツール・フレームワークなし。ブラウザで直接開いて使用（Chrome推奨）

## 技術スタック

- **Web MIDI API** — SysEx有効（`requestMIDIAccess({ sysex: true })`）
- **Web Audio API** — オシレーターベースのシンセ音源
- **Vanilla JS** — フレームワーク依存なし
- **Google Fonts** — Space Mono / Noto Sans JP

---

## Launchpad X MIDI仕様（Programmerモード）

### Programmerモードへの切替
```
SysEx: F0 00 20 29 02 0C 0E 01 F7
```

### パッド配置（Programmerモード）
```
[CC91][CC92][CC93][CC94][CC95][CC96][CC97][CC98]        ← 上段（丸）CC
[81]  [82]  [83]  [84]  [85]  [86]  [87]  [88]  [CC89] ← 右端（丸）CC
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
- 8x8グリッド: `0x90 <note> <velocity>`（Note On, ch1）
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

### オクターブ/トランスポーズ（上段ボタン割当）
| CC  | 機能 |
|-----|------|
| 91  | Octave Up (+12) |
| 92  | Octave Down (-12) |
| 93  | Transpose Down (-1) |
| 94  | Transpose Up (+1) |
| 95-98 | 未割当（将来用） |

---

## アプリのステート管理

```js
const state = {
  baseNote: 36,        // 左下パッドのMIDIノート番号（オクターブ/トランスポーズで変動）
  root: 0,             // ルート音のピッチクラス（0=C, 1=C#, ..., 11=B）
  chordType: 'maj',    // コードタイプキー
  inversion: 0,        // 転回形インデックス
  showScale: true,     // スケール表示ON/OFF
  dimOthers: false,    // コードトーン以外を暗くする
  showInversion: false, // 転回形UIの表示
  scale: 'major',      // スケールタイプキー
  midiOutput: null,    // 選択中のMIDI出力ポート
  midiAccess: null,    // MIDIAccessオブジェクト
};
```

### 色分けルール
| 種別 | 画面CSS | Launchpad RGB |
|------|---------|---------------|
| ルート音 | `--root-color` (#ff4466) | [127, 0, 40] |
| コードトーン | `--chord-color` (#33ddff) | [0, 100, 127] |
| スケール音 | `--scale-color` (#44ff99) | [0, 127, 60] |
| その他 | off (#000) | [0, 0, 0] |
| 暗転 | dim (#000) | [0, 0, 0] |
| 上段ボタン(機能あり) | — | [60, 30, 0] (orange) |

---

## コードタイプ一覧（17種）

Major, Minor, Dom7, Maj7, Min7, Dim, Dim7, Aug, Half-Dim(m7b5), Sus2, Sus4, Add9, Dom9, Maj9, Min9, Maj6, Min6

## スケール一覧（7種）

Major, Natural Minor, Dorian, Mixolydian, Pentatonic Major, Pentatonic Minor, Blues

---

## Web Audio シンセ仕様

- **2オシレーター**: triangle波 + sine波（+6cent デチューン）
- **ADSR風エンベロープ**: Attack 10ms → Decay 70ms → Sustain 0.5 → Release 1.2s
- ベロシティ対応（MIDI入力時）
- ボリュームスライダーで調整

---

## 主要な関数

| 関数 | 役割 |
|------|------|
| `buildPadData(baseNote)` | 8x8パッドのデータ配列を生成 |
| `buildGridDOM()` | 9x9 DOM要素を構築（上段CC + 右列 + 8x8） |
| `updateAll()` | 画面更新 + Launchpad LED送信の中心関数 |
| `sendToLaunchpad()` | SysEx RGBメッセージをLaunchpadに送信 |
| `setupMIDIInput()` | MIDI入力リスナー設定（CC/Note振り分け） |
| `playNote(midiNote, velocity?)` | Web Audioでシンセ音を再生 |
| `rebuildPads()` | オクターブ/トランスポーズ後にパッドデータとDOMを更新 |
| `setProgrammerMode()` | SysExでProgrammerモードに切替 |

---

## UI構成（上から順）

1. ヘッダー + MIDIステータス
2. デバイス選択 / RESCAN / SEND / CLEAR
3. ボリュームスライダー
4. Root選択（12音ボタン）
5. Chord選択（17種ボタン）
6. Scale選択（7種ボタン）
7. 転回形選択（動的生成）
8. トグル: 暗転 / スケール表示 / 転回形
9. 9x9パッドグリッド（上段CC + 右列 + 8x8メイン）
10. コード名・構成音・インターバル表示
11. 凡例
12. イベントログ
