# Launchpad X Chord Visualizer — 実装リファレンス

> ユーザー向けの概要・起動方法・使い方は README.md を参照。

> **リライト中（ブランチ `refactor/typescript-rewrite`）**
> TypeScript + Vite への全面リライトを進めている。**新実装は `src/`**、旧実装は `js/`（切り替え時に削除）。
> - 新アプリ: `npm run dev` → `/next.html`・`/next-analyze.html`（旧アプリは `/index.html`・`/analyze.html` のまま並べて比較できる）
> - 検証: `npm run check`（lint + 型チェック + テスト）、`npm run build`
> - `tests/golden/*.json` は旧実装の出力を採取したもの（`scripts/capture-golden.mjs`）。新実装はこれと一致することをテストしている
> - **この文書の以下の内容は旧実装（`js/`）の説明**。挙動の仕様としては引き続き有効だが、ファイル名・関数名・state の形は `src/` と一致しない。切り替え時に書き直す
> - 切り替え（`index.html` を `src/` に向けて `js/` を削除）は、実機（Launchpad）と曲の再生での確認が済んでから行う

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
| 95  | Song: 再生 / 一時停止 |
| 96  | Song: 1小節戻る（4拍分、テンポ不明時は 2 秒） |
| 97  | Song: FOLLOW ON/OFF |
| 98  | Song: A-B ループ（A 設定 → B 設定 → 解除） |

CC 95-98 は `grid.js` の `setExtraTopRowHandler` 経由で `song.js` が処理し、LED 色は `led.js` の `setTopRowColorProvider` 経由で `song.js` が決める（`SONG_BTN_COLORS`）。

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
  // --- Song バー連動（js/song.js が更新）---
  follow: false,       // FOLLOW 中は再生位置のコードで root / chordType を自動更新
  practice: false,     // 練習モード（弾くコードだけ点灯。FOLLOW OFF で自動 OFF）
  chordOverride: null, // { intervals?, symbol?, bassPC?, none? } — CHORD_TYPES に無い構成音・分数コードのベース・N.C.
  scaleRoot: null,     // スケール基準音（null = コードのルート、FOLLOW 中は曲のキー）
  preview: null,       // 次のコード予告 { rootPC, pcs[], intervals, bassPC }
  previewLit: true,    // 予告の LED 点滅フェーズ
};
```

### 設定の保存・復元（`js/settings.js`）
| localStorage キー | 内容 |
|------|------|
| `launchpad-chord-visualizer:settings` | `{ root, chordType, inversion, scale, instrument, showChord, showScale, showInversion, baseNote, capo, volume, bpm }` |
| `launchpad-chord-visualizer:device` | 最後にユーザーが選んだ MIDI 出力ポート名（`''` = 「未選択」を選んだ） |
| `launchpad-chord-visualizer:song-volume` | Song プレイヤーの音量（`song.js`） |
| `launchpad-chord-visualizer:recent-songs` | 最近読み込んだ曲 `[{ url, title, artist, at }]`（新しい順・最大 10 件、`song.js`）。Songle の取得に成功した時点で追加（同じ URL は先頭へ移動）。RECENT ボタン / 空の入力欄にフォーカスで一覧、× で削除 |

- `main.js` の `restoreSettings()` がボタン群・グリッド生成前に state と DOM へ反映し、`persistSettings()` を `updateAll()`・音量・BPM・音色変更時に呼ぶ（書き込みは 300ms まとめ）
- FOLLOW 中の root / chordType / inversion は保存しない（最後に手で選んだ値を残す）
- デバイス: `populateDevices` は 保存したポート名 → 名前に `launchpad` を含むポート → 直前の選択 の順で自動選択。保存名が `''` なら自動接続しない。USB 抜き差しも `onstatechange` → `populateDevices` で自動再接続。保存はユーザーが選択欄を操作したとき（`onDeviceSelectByUser`）だけ

### Song バー仕様

#### コード進行のソース
| ソース | 取得元 | 備考 |
|--------|--------|------|
| Songle | 曲情報 `https://api.songle.jp/api/v2/song.json?url=…` → コード・ビート `https://widget.songle.jp/api/v1/song/chord.json` / `song/beat.json`（`?url=<v2 の permalink>`） | CORS 許可。URL は YouTube / ニコニコ / SoundCloud / ピアプロ（スキームなしでも可）。v2 は版（日付）なしのピアプロ URL を最新版に解決する（v1 は不可）。時刻は再生メディア基準の ms。未登録は 404 → `null`。キーは返らないのでコード構成音から推定 |
| 解析結果 | localStorage `chord-analyzer:v2:<videoId>`（analyze.html が保存） | YouTube のみ。既定オプションで `decodeChords`。保存済みの Offset を適用 |

- **Songle 未登録の曲は読み込まない**（「Songle に登録されていない曲です」を表示）。プレイヤーが Songle の埋め込みプレイヤーなので、解析結果も Songle 登録済みの YouTube 曲でのみ使える
- 選択の優先順: 解析結果が「Songle ではなく解析結果を表示中」で保存されていれば解析結果、それ以外は Songle → 解析結果。両方あればセレクトで切替
- Songle のコード名の変換: `M7`→`maj7`、`m7b5`/`m7-5`→`m7b5`、`sus`→`sus4`、`+`→`aug` など。`CHORD_TYPES` に無い型（`mM7` / `7sus4` / `aug7` / `7b5` ほか）は Songle の表記をそのまま表示に使い、構成音は既知のものだけ定義（未知は先頭 `m` ならマイナー三和音、それ以外はメジャー三和音）。同じコードが続く区間は 1 つにまとめる

#### 再生メディア（`js/song-media.js`）
| 対応 | URL の例 | プレイヤー |
|------|----------|-----------|
| YouTube | `youtube.com/watch?v=` / `youtu.be/` | Songle 埋め込みプレイヤー（`https://widget.songle.jp/v1/api.js` の `SongleWidgetAPI.createSongleWidgetElement`） |
| ニコニコ動画 | `nicovideo.jp/watch/sm…` / `nico.ms/sm…` | 同上 |
| ピアプロ | `piapro.jp/t/<id>`（`/<日付>` 付きも可） | 同上（mp3 モード。音源は Songle 経由の試聴 mp3） |
| SoundCloud | `soundcloud.com/<user>/<track>` | SoundCloud Widget API（`https://w.soundcloud.com/player/api.js`）。Songle 経由の音源 URL は SoundCloud の廃止 API を指していて 401 になるため |

- どちらも `{ kind, getTime() 秒, isPlaying(), play(), pause(), seek(秒), setVolume(0〜100), destroy() }` に揃える。音量は左パネルの SONG スライダー（`#song-volume`、localStorage `launchpad-chord-visualizer:song-volume`）で、生成時と変更時に反映（Songle は `widget.volume`、SoundCloud は `setVolume`）。Songle の `position` は補間済み、SoundCloud は `PLAY_PROGRESS` の報告を `performance.now()` で補間
- Songle Widget は `div#songle-widget`（id 固定）を widgets.js が拾う仕組みなので、同時に 1 つだけ。曲を替えるときは `destroy()`（`widget.remove()`）してから作り直す
- URL の形でない入力は Songle のキーワード検索（`https://widget.songle.jp/api/v1/songs/search.json?q=`、最大 40 件・該当なしは 404）。結果のうち対応メディアのものを候補リスト（`#song-results`）に出し、クリックで読み込み
- 読込後の URL: YouTube は `?v=<動画ID>`、それ以外は `?url=<URL>`。どちらも起動時に自動読込
- 解析ページ（ANALYZE ↗）は YouTube のときだけ表示

#### FOLLOW
- ソースを読み込むと自動で ON。再生位置のセグメントを `state.root` / `chordType` / `chordOverride` に適用（一時停止中のシークでも追従）
- N.C.（`N`）とコードの無い区間は `chordOverride = { none: true }` → ルート・コードトーンは消灯し、スケールだけ表示
- スケールは曲のキー基準（`scaleRoot = key.root`、`scale` は major / minor）。FOLLOW OFF で `scaleRoot = null`（コードのルート基準に戻る）
- 次コードの予告: FOLLOW 中・再生中のみ、次のセグメントがコードあり かつ 今と別のコードで、開始まで 1 拍（`60 / tempo`、不明時 0.5 秒）以内のとき。今のコードで root / chord / bass として光っていないパッドにだけ重ねる

#### PRACTICE（練習モード）
- 光る電子ピアノのように、弾くコードだけを点灯（ルート / コードトーン / 分数コードのベース）。スケールは消灯、N.C. は全消灯
- 次コードの予告も練習用ボイシングで出す（`practiceNotes(rootPC, intervals, bassPC)` を次のコードにも適用し、今のコードが光っていないパッドに `next-root` / `next-chord` で点滅。共通音は今のコードの色のまま）。開始は前倒しした切り替えの 1 拍前（`next.start − (t + PRACTICE_LEAD_BEATS 拍)` ≤ 1 拍）
- 点灯は **ボイシング 1 つ**（`music.js` の `practiceNotes`）。通常は基本形、分数コードは転回形
  - ルートは基準パッド `PRACTICE_ANCHOR`（下から 3 段目・左から 3 列目、デフォルト配置で C3）から 1 オクターブ以内（C3〜B3）
  - 構成音はルートから `intervals` をそのまま積む（ルートが最低音。9th などはオクターブを超えた高さ）
  - **分数コードは転回形**: ベース（最低音）を同じ範囲（C3〜B3）に置き、残りの構成音をベースのすぐ上に密集して積む（C/E → E3 G3 C4、F/G → G3 A3 C4 F4）
  - **同じ音（MIDI ノート番号）が出るパッドは全部光らせる**（押さえる位置は弾く人が選ぶ）
  - 色は音名ではなく音の高さごとの役割（例: C/G の G2 は bass、G3 は chord）
  - カポ・オクターブで範囲も一緒に動く（形は固定）
- そのため分類関数は `classify(pc, pad)` とパッドも受け取る（pad を渡さない呼び出しは音名だけで分類）
- コードの切り替えは `PRACTICE_LEAD_BEATS`（0.5 拍）前倒し（NOW 表示も同じコード）
- `createPadClassifier` が `state.practice` を見てスケールを消し、コードトーンを `showChord` に関係なく表示
- ON にすると FOLLOW も ON。FOLLOW を OFF にする（手動のコード操作による一時停止を含む）と PRACTICE も OFF

#### Transport
- 1小節戻る: 現在位置から 4 拍分（`4 × 60 / tempo`）戻る
- A-B ループ: 1 回目で A、2 回目で B（A から 1 拍以上後のときのみ。そうでなければ解除）、3 回目で解除。再生中に B を越えたら A へシーク
- タイムラインのクリックでシーク（プレイヘッドは左から 25% の位置）
- タイムラインの下に曲全体のシークバー（`#song-overview`）: 左端に再生 / 一時停止（`#song-ov-play`、`#song-play` と同じ動作）、コードの色帯・再生位置・A-B 区間・`現在 / 全体` 時刻。クリックでシーク、ドラッグ中は位置だけ動かして離したときにシーク

#### 上段 Song ボタンの LED（曲未読込時は `FN_BTN_OFF_COLOR`）
| CC | 状態 | RGB |
|----|------|-----|
| 95 | 再生中 / 停止中 | [0, 100, 0] / [20, 60, 0] |
| 96 | 常時 | [60, 30, 0] |
| 97 | FOLLOW ON / OFF | [0, 100, 127] / [12, 12, 12] |
| 98 | ループ中 / A のみ設定 / なし | [110, 0, 110] / [100, 100, 0] / [12, 12, 12] |

画面の上段ボタンも同じ色で点灯する（`.pad.fn-btn.song-lit` + `--song-btn`）。

### Song（曲バー）連動の要点
- **カポは `state.capo` に一本化**。曲のカポ（表示 = 実音 − capo）を `shiftCapo` でメインのカポに反映するので、Launchpad はカポ後の形で光り、音は実音。AUTO は `suggestCapo`、手動変更（画面 / CC93・94）で AUTO 解除（`setCapoListener`）
- `shiftCapo` は `state.root` もずらすため、FOLLOW 中はカポ変更後に現在のコードを再適用する
- Root / Chord / Inversion の手動操作は `pauseFollow()` で FOLLOW を一時停止（`chordOverride` / `scaleRoot` / `preview` をクリア）
- 次のコードの予告は切替の 1 拍前（`60 / tempo`）から。画面は CSS アニメーション、Launchpad は `SONG_PREVIEW_BLINK_MS` ごとに `previewLit` を反転して LED を再送
- 解析結果は analyze.html の localStorage（`chord-analyzer:v2:<videoId>`）を読み、既定オプションで `decodeChords` する

### 色分けルール
| 種別 | 画面CSS | Launchpad RGB |
|------|---------|---------------|
| ルート音 | `--root-color` (#ff4466) | [127, 0, 40] |
| 転回ベース音（`showInversion`=true かつ `inversion`>0 時）/ 分数コードのベース（`chordOverride.bassPC`） | `.pad.bass` (#ffaa33) | [127, 80, 0] |
| 次のコードのルート予告（`state.preview`） | `.pad.next-root`（点滅） | [40, 0, 12]（点滅） |
| 次のコードの構成音予告 | `.pad.next-chord`（点滅） | [0, 30, 40]（点滅） |
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
| `SMPLR_MODULE_URL` | jsDelivr の `smplr@1.1.0/dist/index.mjs` | サンプル音源ライブラリの動的 import 先 |
| `SOUNDFONT_KIT` | `'MusyngKite'` | gleitz/midi-js-soundfonts のキット名 |
| `SAMPLE_NOTE_RANGE` | `[21, 108]` | デコードするノート範囲（範囲外は最近傍サンプルをピッチシフト） |
| `SAMPLE_RELEASE_S` | `0.3` | サンプル再生のデフォルトリリース時間（秒） |
| `SAMPLE_VOLUME` | `100` | サンプル再生のマスター音量（0〜127 MIDIスケール） |
| `METRO_ACCENT` | `{ freq: 1200, vol: 0.35, decay: 0.055 }` | メトロノームアクセント拍（1拍目）音定数 |
| `METRO_NORMAL` | `{ freq: 700, vol: 0.18, decay: 0.040 }` | メトロノーム通常拍（2〜4拍目）音定数 |
| `CC_PLAY` / `CC_BACK` / `CC_FOLLOW` / `CC_LOOP` | `95` / `96` / `97` / `98` | 上段 Song ボタンの CC |
| `SONG_BTN_COLORS` | `{ idle, playing, paused, back, follow, loopA, loopOn }` | 上段 Song ボタンの LED 色（下記「Song バー仕様」） |
| `PRACTICE_LEAD_BEATS` | `0.5` | 練習モードで次のコードに切り替える前倒し量（拍） |
| `PRACTICE_ANCHOR` | `{ row: 2, col: 2 }` | 練習モードの基準パッド（ここから 1 オクターブ以内にルートを置く） |
| `SONG_PREVIEW_BLINK_MS` | `150` | 次コード予告の Launchpad 点滅の半周期（ms）。画面側は CSS で 0.3 秒周期 |

---

## 音源仕様

音源は2系統。**サンプル音源（GM Soundfont）が本線**で、オシレーター合成は `Synth` 音色とフォールバック用。

### サンプル音源（`sampler.js` / smplr + GM Soundfont）
- [smplr](https://github.com/danigb/smplr) を **CDN から動的 import**（`SMPLR_MODULE_URL`）。リポジトリには同梱しない
- サンプルは gleitz/midi-js-soundfonts の `MusyngKite` キット（1音色 約2〜3.5MB の ogg）
- **遅延ロード**: 音色を選択した時 / その音色で最初に発音した時にロード開始。ロード中は合成音で鳴る
- **キャッシュ**: smplr の `CacheStorage`（Cache API）経由。2回目以降は即ロード
- **フォールバック**: CDN 到達不可・ロード失敗時はその音色を `failed` に入れ、以後ずっと合成音で鳴らす（オフラインでもアプリは動く）
- 全サンプル音色は共通の GainNode（`getSampleDestination()`）経由で出力し、`#volume` スライダーがそのゲインを直接動かす
- **ロングトーンのループは使わない**（`loadLoopData` は常に無効）
  - goldst.dev がループ情報を配信している音色（organ / church / violin / cello / flute / trumpet）でも、MusyngKite のサンプルには適合しない
  - MusyngKite は全音色が **3.13 秒（137984 サンプル / 44.1kHz）の減衰録音**。どこにループ区間を取っても始点と終点で音量が食い違い、ループごとに音量が跳ねて脈打つ
  - 個別にもループ点が壊れている: `trumpet` は全88ノートがループ長 65〜416 サンプル（2〜9ms）でピッチ無関係のブザー音、`violin` は全107ノートが `loopStart=8`（≒0秒）で弓のアタックを 200ms ごとに繰り返す、`organ` は `loopStart=7` で無音からの立ち上がりを 287ms ごとに繰り返す
  - 結果として、押している間も **約3.1秒で自然に減衰して鳴り終わる**。無限サステインが必要なら `Synth` 系のオシレーター音色（`SYNTH_PRESETS`）を使う
  - 将来ループを入れるなら、ループ情報付きの別サンプルセット（`Soundfont2` + .sf2）に替える必要がある

### 音色一覧（constants.js `INSTRUMENTS`）
`{ label, gm, synth, release?, vol?, loop? }` — `gm` が GM Soundfont 音色名、`synth` が未ロード時に使う `SYNTH_PRESETS` のキー。`gm: null` はオシレーター合成のみ。

| 分類 | キー |
|------|------|
| Keys | `piano` ★デフォルト / `epiano` / `harpsi` / `organ` / `church` |
| Guitar / Bass | `nylon` / `steel` / `eguitar` / `abass` / `bass` |
| Strings / Voice | `strings` / `violin` / `cello` / `choir` |
| Mallet / Wind | `vibes` / `marimba` / `flute` / `trumpet` / `sax` |
| Synth | `pad` / `lead` / `synth`（合成のみ） |

### オシレーター合成（constants.js `SYNTH_PRESETS`）

| キー | 特徴 |
|------|------|
| `synth` | triangle+sine、velocity対応アタック（5〜50ms）、0.8秒リリース |
| `piano` | sine+triangle、自然減衰（2秒でほぼ消音）、鍵盤離し後0.3秒リリース |
| `organ` | 第1〜4倍音の加算合成（sine×4）、即ON/OFF（0.04秒リリース） |
| `guitar` | sawtooth+lowpass(2500Hz)、超高速アタック→200ms急速減衰（プラック感） |
| `bass` | sine+lowpass(600Hz)、サブオクターブ、パンチのある低音 |
| `strings` | sawtooth×2（+5cent detune）+lowpass(1800Hz)、スロー・アタック（0.15〜0.4秒） |

- **プリセット構造**: `{ osc1, osc2?, harmonics?, envelope, peakVolFactor, filter? }`
  - `harmonics` あり → 加算合成モード（organ）
  - `filter` あり → BiquadFilterNode をゲインとdestinationの間に挿入
- **エンベロープ**: `{ attackBase, attackVelRange, decayTime, sustainRatio, releaseTime }`
  - attackTime = `attackBase + (1 - velocity/127) * attackVelRange`（高velocityほど速い）

### `activeNotes` Map
音源2系統を `kind` で判別して同じ Map に入れる。`music.js` の `detectChordFromActiveNotes` はキー（MIDIノート番号）しか見ない。

| kind | 値 |
|------|----|
| `'synth'` | `{ kind, oscNodes[], gain, ctx, releaseTime }` |
| `'sample'` | `{ kind, stop }` — `stop` は smplr の `start()` が返す停止関数 |

---

## 主要な関数

| 関数 | ファイル | 役割 |
|------|---------|------|
| `buildPadData(baseNote)` | `constants.js` | 8x8パッドのデータ配列を生成 |
| `buildGridDOM(onPadDown, onPadUp, onAfterRebuild)` | `grid.js` | 9x9 DOM要素を構築（上段CC + 右列 + 8x8） |
| `updateAll()` | `main.js` | 画面更新 + Launchpad LED送信の中心関数 |
| `getChordPitchClasses()` | `music.js` | コードのピッチクラスを返す（`{ all, inverted, bassPC }`）。`bassPC` は転回ベース音 or 分数コードのベースのPC（無ければ `null`）。`chordOverride` を反映 |
| `createPadClassifier({ ledPhase? })` | `music.js` | 現在の state から `(pc, pad?) → 'root' / 'bass' / 'chord' / 'scale' / 'next-root' / 'next-chord' / 'off'` を返す関数を作る（DOM・LED 共通。練習モードは pad の位置で絞り込む） |
| `sendToLaunchpad({ quiet? })` | `led.js` | 現在の state から全パッド + 上段の LED を SysEx で一括送信（`quiet` でログ抑制） |
| `initSong({ onUpdate, onLEDs })` | `song.js` | Song バー初期化（Songle 検索・再生メディア・Songle / 解析結果・FOLLOW・カポ連動・CC 95-98・`?v=` / `?url=` 自動読込） |
| `pauseFollow()` | `song.js` | 手動のコード操作時に FOLLOW を一時停止 |
| `fetchSongle(source)` | `analyze/songle.js` | Songle から曲情報・コード・ビートを取得し `{ song, pageUrl, key, tempo, segments, timing }` を返す（`source` は YouTube の動画ID か Songle が扱う URL。未登録は `null`） |
| `fetchSongleSong(source)` | `analyze/songle.js` | v2 の曲情報 `{ title, artist, duration, permalink, code, url }`（ピアプロの版なし URL を解決） |
| `searchSongle(query)` | `analyze/songle.js` | Songle のキーワード検索 `[{ title, artist, permalink, duration }]` |
| `parseMediaUrl(input)` | `song-media.js` | URL → `{ kind: 'youtube' \| 'niconico' \| 'soundcloud' \| 'piapro', id, songleUrl }`（URL でなければ `null` = 検索） |
| `createMediaPlayer(container, media, { onStateChange })` | `song-media.js` | 共通インターフェースのプレイヤーを生成（Songle 埋め込み / SoundCloud Widget） |
| `parseSongleChord(name)` | `analyze/songle.js` | Songle のコード名（`Eb` / `C#m7` / `Ebsus2/Ab` / `N`）を analyzer のセグメント形式に変換 |
| `keyFromProfile(profile)` | `chord-analyzer/analyzer.js` | 12 次元ピッチクラス分布から Krumhansl-Kessler 相関でキーを推定 |
| `initMIDI(callbacks)` | `midi.js` | MIDI初期化・デバイス列挙・コールバック注入の統合エントリ（`setupMIDIInput` を内部で呼ぶ） |
| `rescanMIDI()` | `midi.js` | MIDI デバイス再スキャン（RESCAN ボタン用） |
| `setupMIDIInput(access)` | `midi.js` | MIDI入力リスナー設定（CC/Note On/Off 振り分け） |
| `startNote(midiNote, velocity?, volume?, onNoteChange?)` | `audio.js` | Web Audioでサステイン音を開始（`activeNotes` Mapに登録）。`volume` は `#volume` スライダー値（0〜1） |
| `stopNote(midiNote, onNoteChange?)` | `audio.js` | 鳴っている音にリリースをかけて停止（`activeNotes` から削除）。サンプル音は smplr の stop 関数を呼ぶ |
| `selectInstrument(key)` | `audio.js` | 音色を切り替え、サンプル音色ならロードを先読み開始 |
| `loadSampleInstrument(ctx, key)` | `sampler.js` | GM Soundfont 音色をロード（多重呼び出し安全・失敗しても throw しない） |
| `startSampleNote(ctx, key, midiNote, velocity, volume)` | `sampler.js` | サンプルで発音。未ロードなら `null`（呼び出し元が合成音に回す） |
| `usesSamples(key)` | `sampler.js` | その音色がサンプル音源を使うか（`gm` 指定あり かつ ロード失敗していない） |
| `getSampleDestination(ctx)` | `sampler.js` | 全サンプル音色の共通出力 GainNode（ボリューム制御点） |
| `setSamplerStatusCallback(cb)` | `sampler.js` | ロード状況（`loading` / `loaded` / `failed`）の通知先を注入 |
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
  audio.js       発音の振り分け（サンプル優先・合成フォールバック）・オシレーター合成・メトロノーム音
  sampler.js     GM Soundfont サンプル音源（smplr を CDN から動的 import・遅延ロード・キャッシュ）
  music.js       コード/スケール計算・コード自動検出
  led.js         SysEx LED 制御
  grid.js        グリッド DOM・カポ・オクターブ操作
  midi.js        MIDI デバイス管理・入力ハンドリング
  main.js        エントリーポイント・updateAll・メトロノーム・全体統合
  song.js        Song バー（Songle 検索・曲の再生 + コード進行で FOLLOW 点灯・カポ一本化・次コード予告・A-B ループ・CC 95-98）
  settings.js    設定・前回の MIDI デバイス名の保存 / 復元（localStorage）
  song-media.js  Song バーの再生メディア（YouTube / ニコニコ / ピアプロ = Songle 埋め込みプレイヤー、SoundCloud = Widget API）・URL 判定
  chord-analyzer/  オーディオ → コード進行解析（DOM 非依存、Worker / Node で動作）
    dsp.js         FFT・ダウンサンプル
    analyzer.js    extractFeatures（ビート同期クロマ。センターカット / HPSS / メロディ抑制の全組み合わせを事前計算）/ decodeChords（バリアント選択 + キー推定 + Viterbi）
    worker.js      extractFeatures を Worker で実行
    capo.js        カポ位置でのコード表示名・構成音の C メジャースケール適合率・自動カポ選択（suggestCapo）。セグメントの `bass`（分数コード）/ `symbol`・`intervals`（CHORD_TYPES に無い型）にも対応
  analyze/       YouTube 同期解析ページ（analyze.html）用
    youtube.js     IFrame Player API ラッパー・補間付き再生時刻
    capture.js     タブ音声キャプチャ（getDisplayMedia + AudioWorklet）
    songle.js      Songle 公開 API（api.songle.jp/api/v2 の曲情報 + widget.songle.jp/api/v1 のコード・ビート・検索、CORS 可）から登録済み曲を取得し、analyzer と同じセグメント形式に変換
    page.js        スキャン → 解析 → タイムライン同期表示。LOAD 時に解析キャッシュが無ければ Songle を自動取得（SONGLE ボタンで解析結果と切替）
analyze.html / analyze.css  コード解析プロトタイプページ
```

### モジュール依存関係（循環なし）
```
constants → (none)
state     → constants
logger    → (none)
sampler   → constants, logger
audio     → constants, state, sampler
music     → constants, state
led       → constants, state, music, logger
grid      → constants, state, logger
midi      → constants, state, grid, logger, settings
song-media → analyze/youtube
song      → constants, state, logger, grid, led, song-media, analyze/songle, chord-analyzer/capo, chord-analyzer/analyzer
main      → all
```

循環依存の回避は **コールバック注入** で行う（`main.js` が各モジュールにコールバックを渡す）。

---

## UI構成（三段組レイアウト）

上段（全幅）: ヘッダー + MIDIステータス + **Song バー**（URL or 検索語 / LOAD・SEARCH / ソース選択 / ANALYZE ↗ / ▾ 折りたたみ / 検索候補リスト。読込後にプレイヤー（Songle 埋め込み or SoundCloud）・NOW/NEXT・KEY/TEMPO・CAPO（AUTO）・▶ / ◄◄ / FOLLOW / A-B・タイムライン）

### 左パネル（MIDI / Audio / Debug）
1. Device — デバイス選択 / RESCAN / SEND / CLEAR
2. Volume — INST（楽器音、`#volume`）/ SONG（曲プレイヤー、`#song-volume`）の 2 本
3. Metronome — BPMスライダー + 数値入力 + START/STOPボタン
4. Sound — 音色選択（22種 / `#instrument-buttons`）+ ロード状況表示（`#sound-status`）。ロード中のボタンは `.loading` で点滅
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
