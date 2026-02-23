# [Launchpad X Chord Visualizer](https://launchpad-chord-visualizer.pages.dev/)

![Launchpad X Chord Visualizer](image.png)

## 機能

- **コード・スケール表示** — ルート音・コードトーン・スケール音をそれぞれ異なる色でパッドに表示。押すべき音が一目でわかる
- **17種のコードタイプ** — Major / Minor / Dom7 / Maj7 / Min7 / Dim / Dim7 / Aug / Half-Dim / Sus2 / Sus4 / Add9 / Dom9 / Maj9 / Min9 / Maj6 / Min6
- **7種のスケール** — Major / Natural Minor / Dorian / Mixolydian / Pentatonic Major / Pentatonic Minor / Blues
- **転回形** — コードの最低音を変えた転回形を選択可能。スラッシュコード表記（例: `C/E`）で表示
- **コード自動検出** — 複数のパッドを同時に押さえると、構成音からコード名を自動で判定して表示
- **カポ / オクターブシフト** — 全パッドのキーをまとめて移調。カポはギターのカポタストと同じ概念で視覚パターンを変えずに移調、オクターブは音域を1オクターブ上下
- **6種のシンセ音源** — Synth / Piano / Organ / Guitar / Bass / Strings（Web Audio API）
- **メトロノーム** — 40〜240 BPM、アクセント拍 LED 連動

## 動作要件

- **Chrome ブラウザ**（Web MIDI API / Web Audio API 対応）
- Launchpad X（任意 — なくても画面上での操作・音出しは可能）

---

## 使い方

### 基本操作

1. 右パネルで **Root**（ルート音）と **Chord**（コードタイプ）を選択
2. グリッドにコード・スケール音が色分けされて表示される
3. パッドをクリック（または Launchpad X のパッドを押す）と音が鳴る

### 色分けの意味

| 色 | 意味 |
|----|------|
| 赤 | ルート音 |
| 水色 | コードトーン（ルート以外） |
| 緑 | スケール音（コードトーンを除く） |
| 橙 | 転回ベース音（Inversion ON時） |
| 黒 | 非該当 |

### カポとオクターブ

- **Capo**（右パネル下部の ◄ ► ボタン、または Launchpad 上段 3・4番目）
  視覚パターンを変えずにキーを半音単位で移調する。ギターのカポタストと同じ動作で、パッドの色パターンはそのままに全体のピッチが変わる。

- **Octave**（Launchpad 上段 1・2番目）
  グリッド全体を1オクターブ上下にシフトする。

### 転回形（Inversion）

右パネルの **Inversion** トグルをONにすると転回形の選択肢が表示される。
1st Inversion は第3音、2nd Inversion は第5音を最低音にした配置で、コード名は `C/E` のようにスラッシュ表記になる。

### コード自動検出

複数のパッドを同時に押さえたままにすると、現在鳴っている音の組み合わせからコード名を自動判定してコード名表示エリアに反映する。

### メトロノーム

左パネルの **Metronome** セクションで BPM を設定し **START** を押す。
Launchpad X 接続時はロゴ LED が拍に合わせてフラッシュする（アクセント拍は白、通常拍は青白）。
MIDI 未接続時は起動しない。

### パネル構成

| パネル | 内容 |
|--------|------|
| 左 | MIDI デバイス選択 / RESCAN / 音量 / メトロノーム / 楽器切替 / ログ |
| 中央 | 9×9 パッドグリッド（Launchpad X と同じレイアウト） |
| 右 | Root / Chord / Scale / Inversion / Capo コントロール |

---

## Launchpad X のセットアップ

1. USB で接続し、左パネルの **RESCAN** ボタンをクリック
2. デバイスが検出されるとロゴ LED が緑に点灯し、Programmer モードへ自動で切替わる
3. 接続できない場合は Ableton Live などの DAW が MIDI ポートを占有していないか確認する（Windows では MIDI ポートは排他使用）

### Launchpad 上段ボタン

| ボタン位置 | 機能 |
|-----------|------|
| 1番目（左） | Octave Up |
| 2番目 | Octave Down |
| 3番目 | Capo Down（-1半音） |
| 4番目 | Capo Up（+1半音） |

---

## ローカルで動かす

ES Modules は `file://` では動作しないため、ローカルサーバーが必要。

```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```

VS Code の Live Preview 拡張機能でも起動できる。
