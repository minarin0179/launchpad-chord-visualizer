# Launchpad X Chord Visualizer — 実装リファレンス

> ユーザー向けの概要・起動方法・使い方は docs/README.md を参照。

---

## 開発

```bash
npm ci
npm run dev      # 開発サーバー（http://localhost:5173/ と /analyze.html）
npm run check    # lint + 型チェック + テスト（変更後は必ず通す）
npm run build    # dist/ に出力（型チェックは含まない）
npm run preview  # ビルド結果を http://localhost:4173/ で確認
```

- TypeScript (strict) + Vite + Vitest + ESLint（型情報つき）+ Prettier。UI フレームワークは使わない
- `packages/launchpad-x` は自作の Launchpad X ライブラリ（npm ワークスペース）。アプリは Vite のエイリアスで **TS ソースを直接 import** する（`dist/` のビルドは不要）
- デプロイは Cloudflare Pages（ビルドコマンド `npm run build`、出力ディレクトリ `dist`。設定はダッシュボード側）
- テストは実機なしで動く: 旧実装の出力との突き合わせ（`tests/golden/`）、reducer、偽の MIDI デバイスでアプリ全体を起動する統合テスト（`tests/app/boot.test.ts`）
- ESLint の主なルール: マジックナンバー禁止（定数は `src/config/` か各モジュール冒頭に名前を付けて置く）、`export let` 禁止、層ごとの import 制限（下の「層」を参照）

### 引き継ぎメモ（2026-11-26 時点）

`js/`（バニラ JS）から `src/`（TypeScript）への全面リライトを終え、切り替え済み。Launchpad 実機でメイン画面が動くことは確認済み。

**未確認（ブラウザでの手動確認が必要）**
- Song バー: YouTube / ニコニコ / ピアプロ / SoundCloud それぞれの再生と FOLLOW、曲の連続読み込み、A-B ループ、シークバーのドラッグ
- 解析ページ: タブ録音（AudioWorklet を `?worker&url` で読み込む方式に変えた）、音声ファイルの解析、Songle との切り替え
- サンプル音源: smplr を npm からバンドルした状態での発音とキャッシュ
- 非表示タブ（別ウィンドウを前面にした状態）での LED の追従
- 旧バージョンが保存した実際の localStorage データの読み込み（旧形式を模したデータではテスト済み）

**残っている作業**
- `main` へマージするときに Cloudflare Pages の設定を変える（ビルドコマンド `npm run build`、出力ディレクトリ `dist`）。変えないと旧構成（リポジトリ直下を配信）のままになり動かない。先にブランチのプレビューデプロイで確かめる
- `docs/README.md` のスクリーンショット（`docs/image.png`）は旧実装のまま（見た目は変えていないので差し替え不要のはず）

**知っておくこと**
- `tests/golden/*.json` はリライト前の実装の出力を採取したもので、採取スクリプトは旧実装と一緒に削除した（再生成できない）。意図して挙動を変えるときは、テスト側に理由を書いて期待値を上書きする
- 旧実装から意図して変えた挙動は、テストの名前に「旧実装は…」と書いてある（`grep -rn 旧実装 tests/`）
- 作業フォルダが Windows のドライブを 9p でマウントしたものだと、すべてのコマンドが遅い（`node_modules` の読み込みが律速）。WSL 側のファイルシステムに置くこと

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
- MIDI バイト列の解釈・SysEx の組み立ては `packages/launchpad-x`（`LaunchpadX` クラス）が行う。アプリ側は `noteOn` / `noteOff` / `controlChange` イベントを受けるだけ（`src/midi/device-manager.ts`）
- チャンネルは見ていない（どのチャンネルで届いても同じ扱い）

### 上段ボタン割当
> 実装: `src/app/top-row.ts` の表（ラベル・操作・LED 色を 1 か所で定義）。画面のボタンと Launchpad の両方から `pressTopRow(index, commands)` を呼ぶ

| CC  | 機能 |
|-----|------|
| 91  | Octave Up (+12) — アクション `octaveShifted` |
| 92  | Octave Down (-12) — アクション `octaveShifted` |
| 93  | Capo Down (-1) — アクション `capoShifted`（左下パッドの音とルートを同時に -1、視覚パターン固定で移調） |
| 94  | Capo Up (+1) — アクション `capoShifted`（同 +1） |
| 95  | Song: 再生 / 一時停止 |
| 96  | Song: 1小節戻る（4拍分、テンポ不明時は 2 秒） |
| 97  | Song: FOLLOW ON/OFF |
| 98  | Song: A-B ループ（A 設定 → B 設定 → 解除） |

CC 95-98 は `SongRuntime`（`src/song/runtime.ts`）の操作を呼ぶ。LED 色は同じ表の `color(state)` が状態から決める（色の定義は `src/config/roles.ts` の `TOP_ROW_LED`）。

---

## アーキテクチャ

### 層

```
core/      純粋ロジック（DOM・ブラウザ API・launchpad-x に依存しない）
config/    名前付き定数
store/     状態（reducer + セレクタ）
platform/  ブラウザの機能の薄いラッパー（localStorage・ログ・DOM 取得・フレームループ）
audio/ midi/ led/   デバイスとのやり取り
ui/ song/views/ timeline/   画面
app/       部品をまたぐ処理（発音・上段ボタンの表・ログ）
main.ts / analyze.ts   合成ルート（部品を作り、つなぎ方をすべてここに書く）
```

- `core/` `config/` `store/` `analyzer/` は **DOM の型なしでコンパイルできる**（`tsconfig.pure.json`）。DOM に触ると型チェックで落ちる
- 部品同士は互いを直接 import して呼び合わない。`main.ts` がコールバックや依存を渡してつなぐ
- 状態の書き込みは `store.dispatch(action)` だけ。画面と LED は状態から描画する（DOM を状態の置き場所にしない）

### ストア（`src/store/`）

```ts
interface AppState {
  layout:    { openBaseNote, capo };        // 左下パッドの音 = openBaseNote + capo（selectBaseNote）
  manual:    { root, chordType, inversion, scale };  // 手で選んだコード・スケール
  display:   { showChord, showScale, showInversion };
  audio:     { instrument, volume, samples };        // samples: 音色 → 'loading' | 'loaded' | 'failed'
  metronome: { bpm, running };
  midi:      { access, errorMessage, outputs, preferredName, selectedOutputId, connection };
  held:      { pressId, padIndex, note }[];          // 押しているパッド
  song:      SongState;
}

interface SongState {
  volume; collapsed; recents;
  panel;      // 候補リスト: none | recent | searching | results | search-failed
  load;       // idle | fetching | unregistered | failed | loaded（media, info, sources, activeSource）
  playback:   { status: 'none' | 'loading' | 'ready' | 'error', playing, error };
  capoAuto; follow; practice; scaleChoice;
  cursor:     { segmentIndex, previewIndex };  // 再生位置の区間と予告する区間（-1 = 区間外）
  loop;       // off | { kind: 'a', a } | { kind: 'ab', a, b }
}
```

- **不変**。`reduce(state, action)`（`reducer.ts`）が新しい状態を返す。ユーザーの操作・外部イベント 1 つにつきアクション 1 つで、途中の状態を作らない（例: `songLoaded` は「ソース選択 + AUTO カポ + FOLLOW ON + 履歴追加」を 1 回で行う）
- アクションの一覧は `actions.ts`（判別共用体）。`switch` の網羅は ESLint が確認する
- 派生値は `selectors.ts` のセレクタで計算する（入力が同じなら前回の結果をそのまま返す）。主なもの: `selectBaseNote` / `selectPads` / `selectEffectiveChord` / `selectScaleRef` / `selectPreview` / `selectPadVisuals` / `selectActiveSource` / `selectBeatSec`
- `store.watch(selector, onChange)` は selector の結果が変わったときだけ呼ばれる。ビューはこれで必要な部分だけ購読する
- **ストアに入れないもの**: 再生時刻・ドラッグ中の位置・点滅の位相・フラッシュ中のロゴ色（毎フレーム変わる値）と、`MediaPlayer` / `LaunchpadX` / `AudioContext` などの実体
- `-1` を「区間外」に使う index（`cursor.segmentIndex` など）に `Array.prototype.at` を使わないこと（`-1` は末尾を返す）

### カポとレイアウト
- `layout = { openBaseNote, capo }`。左下パッドの音は常に `openBaseNote + capo` で、カポと左下パッドの音が食い違う状態は作れない
- カポを動かすと `capo` と `manual.root` を同じだけずらす（パッド上の形は変わらない = 移調）。転回形は 0 に戻す
- 左下パッドの音は 0〜`MAX_BASE_NOTE`（= 127 − 42 = 85。右上パッドが MIDI の上限を超えない範囲）。範囲外になる移動は無視する
- 手動のカポ変更（画面 / CC 93・94 / RST）は `song.capoAuto` を OFF にする。AUTO は `suggestCapo`（構成音が C メジャースケールに最も収まるカポ）を適用し、範囲外なら同じ形になる ±1 オクターブを試す
- 画面右パネルの Capo は累積値（負にもなる）、Song バーの CAPO は 0〜11 のカポ位置（`selectCapoPosition`）を表示する

### 設定の保存・復元
| localStorage キー | 内容 |
|------|------|
| `launchpad-chord-visualizer:settings` | `{ root, chordType, inversion, scale, instrument, showChord, showScale, showInversion, baseNote, capo, volume, bpm }`（`baseNote` はカポ込みの左下パッドの音） |
| `launchpad-chord-visualizer:device` | 最後にユーザーが選んだ MIDI 出力ポート名（`''` = 「未選択」を選んだ） |
| `launchpad-chord-visualizer:song-volume` | Song プレイヤーの音量 |
| `launchpad-chord-visualizer:recent-songs` | 最近読み込んだ曲 `[{ url, title, artist, at }]`（新しい順・最大 10 件）。Songle の取得に成功した時点で追加（同じ URL は先頭へ移動）。RECENT ボタン / 空の入力欄にフォーカスで一覧、× で削除 |
| `chord-analyzer:v2:<YouTube の動画 ID>` | 解析ページの結果 `{ features, source, useSongle, offsetMs, capo, capoAuto, savedAt, decodeOptions? }`。容量が足りなければ他の動画の古い結果から消す |

- **キーと保存する形は旧バージョンと互換**。フィールド名・`CHORD_TYPES` / `SCALES` / `INSTRUMENTS` のキー文字列・解析結果の特徴量の形（`src/analyzer/types.ts` の `Features`）は変えないこと
- 起動時に `loadPersisted` → `createInitialState` が検証して状態にする（壊れた値・範囲外の値はデフォルトに戻す）
- `startPersistence`（`src/platform/persistence.ts`）が状態の変化を保存する。設定は 300ms まとめて書き、ページを離れるとき・タブが隠れるときはすぐ書く
- 保存するのは `state.manual`（手で選んだ値）だけなので、FOLLOW 中の曲のコード・スケールは保存されない
- デバイス: `chooseOutput` は 保存したポート名 → 名前に `launchpad` を含むポート → 直前の選択 の順で自動選択。保存名が `''` なら自動接続しない。保存はユーザーが選択欄を操作したとき（`deviceSelectedByUser`）だけ

### MIDI デバイス（`src/midi/device-manager.ts`）
- `DeviceManager.reconcile()` は「選択中の出力ポート + 対応する入力ポート」が実際に変わったときだけ接続し直す。ポートの状態変化の通知（ポートを開くだけでも届く）は 50ms まとめて処理する
- 接続すると Programmer モードへの切替 SysEx を 1 回送り、150ms 後に `connection: 'ready'` にする。LED の送信は `ready` になってから
- 入力ポートは出力ポートの名前から推測する（`matchInput`。OS ごとに命名が違うので 5 つの規則を順に試す）
- USB の抜き差しは自動で再接続する。RESCAN は MIDI へのアクセスを取り直す

### LED（`src/led/`）
- `buildLedFrame`（純粋関数）が状態から全 LED の色を決める。並びは常に 64 パッド → 上段 8 → ロゴ の 73 個
- `LedSender` は直前に送った内容との差分だけを 1 つの SysEx で送る。接続し直したとき・SEND ボタンは全部送り直す
- 予告の点滅とロゴのフラッシュ（時間で変わる部分）は `createLedController` が管理する。点滅は `PadVisual.role`（点灯時）と `PadVisual.under`（消灯時）を切り替える

---

## Song バー

#### コード進行のソース
| ソース | 取得元 | 備考 |
|--------|--------|------|
| Songle | 曲情報 `https://api.songle.jp/api/v2/song.json?url=…` → コード・ビート `https://widget.songle.jp/api/v1/song/chord.json` / `song/beat.json`（`?url=<v2 の permalink>`） | CORS 許可。URL は YouTube / ニコニコ / SoundCloud / ピアプロ（スキームなしでも可）。v2 は版（日付）なしのピアプロ URL を最新版に解決する（v1 は不可）。時刻は再生メディア基準の ms。未登録は 404 → `null`。キーは返らないのでコード構成音から推定 |
| 解析結果 | localStorage `chord-analyzer:v2:<videoId>`（analyze.html が保存） | YouTube のみ。解析ページで調整したデコード設定（`decodeOptions`。無ければ既定値）で `decodeChords`。保存済みの Offset を適用 |

- **Songle 未登録の曲は読み込まない**（「Songle に登録されていない曲です」を表示）。プレイヤーが Songle の埋め込みプレイヤーなので、解析結果も Songle 登録済みの YouTube 曲でのみ使える
- 選択の優先順: 解析結果が「Songle ではなく解析結果を表示中」で保存されていれば解析結果、それ以外は Songle → 解析結果。両方あればセレクトで切替
- Songle のコード名の変換: `M7`→`maj7`、`m7b5`/`m7-5`→`m7b5`、`sus`→`sus4`、`+`→`aug` など。`CHORD_TYPES` に無い型（`mM7` / `7sus4` / `aug7` / `7b5` ほか）は Songle の表記をそのまま表示に使い、構成音は既知のものだけ定義（未知は先頭 `m` ならマイナー三和音、それ以外はメジャー三和音）。同じコードが続く区間は 1 つにまとめる

#### 再生メディア（`src/song/media/`）
| 対応 | URL の例 | プレイヤー |
|------|----------|-----------|
| YouTube | `youtube.com/watch?v=` / `youtu.be/` | Songle 埋め込みプレイヤー（`https://widget.songle.jp/v1/api.js` の `SongleWidgetAPI.createSongleWidgetElement`） |
| ニコニコ動画 | `nicovideo.jp/watch/sm…` / `nico.ms/sm…` | 同上 |
| ピアプロ | `piapro.jp/t/<id>`（`/<日付>` 付きも可） | 同上（mp3 モード。音源は Songle 経由の試聴 mp3） |
| SoundCloud | `soundcloud.com/<user>/<track>` | SoundCloud Widget API（`https://w.soundcloud.com/player/api.js`）。Songle 経由の音源 URL は SoundCloud の廃止 API を指していて 401 になるため |

- どちらも `MediaPlayer`（`{ kind, rawTime() 秒, isPlaying(), play(), pause(), seek(秒), setVolume(0〜100), destroy() }`）に揃える。音量は左パネルの SONG スライダー（`#song-volume`、localStorage `launchpad-chord-visualizer:song-volume`）で、生成時と変更時に反映（Songle は `widget.volume`、SoundCloud は `setVolume`）。Songle の `position` は補間済み、SoundCloud は `PLAY_PROGRESS` の報告を `ProgressInterpolator` で補間
- 表示に使う再生時刻は `createPlaybackClock`（`clock.ts`）で平滑化する（報告のばらつきを均して一定速度で進め、ずれは ±5% の速度補正で詰める。0.3 秒以上の跳びは即座に合わせる）。シーク直後はプレイヤーの報告が追いつくまでシーク先の時刻を返す
- Songle Widget は `div#songle-widget`（id 固定）を widgets.js が拾う仕組みなので、同時に 1 つだけ。`PlayerHost` がプレイヤーの生成と破棄を 1 つずつ順番に行い、各プレイヤーは専用の枠（`div.song-player-slot`）だけを消す。準備完了を 15 秒待って来なければエラー（`PLAYER_READY_TIMEOUT_MS`）
- 読み込みと検索は別々の `AbortController` で中断する（検索しても読み込み中の曲は止まらない。新しい読み込みは前の読み込みを中断する）
- URL の形でない入力は Songle のキーワード検索（`https://widget.songle.jp/api/v1/songs/search.json?q=`、最大 40 件・該当なしは 404）。結果のうち対応メディアのものを候補リスト（`#song-results`）に出し、クリックで読み込み
- 読込後の URL: YouTube は `?v=<動画ID>`、それ以外は `?url=<URL>`。どちらも起動時に自動読込
- 解析ページ（ANALYZE ↗）は YouTube のときだけ表示

#### FOLLOW
- ソースを読み込むと自動で ON。再生位置のセグメントのコードを表示する（一時停止中のシークでも追従）。**曲のコードは `state.manual` に書き込まない**: `selectEffectiveChord` が「FOLLOW 中は再生位置のコード、それ以外は手で選んだコード」を返す
- N.C.（`N`）とコードの無い区間は `EffectiveChord` が `{ kind: 'none' }` → ルート・コードトーンは消灯し、スケールだけ表示
- スケールは曲のキー基準（`selectScaleRef`: ルート = `key.root`、種類は major / minor）。FOLLOW 中に Scale ボタンで選び直すと `song.scaleChoice` に入り、その曲の間だけ有効（保存しない）。FOLLOW OFF で手動のルート・スケールに戻る
- FOLLOW を OFF にするとき（トグル / 手動の Root・Chord・Inversion 操作）は、その時点の曲のコード（ルートと最も近い `CHORD_TYPES` の型）を `state.manual` に引き継ぐ。N.C. の間は元の手動コードのまま
- 次コードの予告（`computeCursor`）: FOLLOW 中・再生中のみ、次のセグメントがコードあり かつ 今と別のコードで、開始まで 1 拍（`60 / tempo`、不明時 0.5 秒）以内のとき。今のコードで root / chord / bass として光っていないパッドにだけ重ねる。区間のすき間・曲の頭より前では「次に始まる区間」を予告する

#### PRACTICE（練習モード）
- 光る電子ピアノのように、弾くコードだけを点灯（ルート / コードトーン / 分数コードのベース）。スケールは消灯、N.C. は全消灯
- 次コードの予告も練習用ボイシングで出す（`practiceVoicing(baseNote, chord)` を次のコードにも適用し、今のコードが光っていないパッドに `next-root` / `next-chord` で点滅。共通音は今のコードの色のまま）。開始は前倒しした切り替えの 1 拍前（`next.start − (t + PRACTICE_LEAD_BEATS 拍)` ≤ 1 拍）
- 点灯は **ボイシング 1 つ**（`src/core/practice.ts` の `practiceVoicing`）。通常は基本形、分数コードは転回形
  - ルートは基準パッド `PRACTICE_ANCHOR`（下から 3 段目・左から 3 列目、デフォルト配置で C3）から 1 オクターブ以内（C3〜B3）
  - 構成音はルートから `intervals` をそのまま積む（ルートが最低音。9th などはオクターブを超えた高さ）
  - **分数コードは転回形**: ベース（最低音）を同じ範囲（C3〜B3）に置き、残りの構成音をベースのすぐ上に密集して積む（C/E → E3 G3 C4、F/G → G3 A3 C4 F4）
  - **同じ音（MIDI ノート番号）が出るパッドは全部光らせる**（押さえる位置は弾く人が選ぶ）
  - 色は音名ではなく音の高さごとの役割（例: C/G の G2 は bass、G3 は chord）
  - カポ・オクターブで範囲も一緒に動く（形は固定）
- そのため `classifyPads` は練習モードではパッドの音の高さ（`pad.note`）で、通常は音名（`pad.pitchClass`）で分類する
- コードの切り替えは `PRACTICE_LEAD_BEATS`（0.5 拍）前倒し（NOW 表示も同じコード）
- `selectPadVisuals` が練習モードのときスケールを消し、コードトーンを `showChord` に関係なく表示
- ON にすると FOLLOW も ON。FOLLOW を OFF にする（手動のコード操作による一時停止を含む）と PRACTICE も OFF

#### Transport
- 1小節戻る: 現在位置から 4 拍分（`4 × 60 / tempo`）戻る
- A-B ループ（`src/song/loop.ts`）: 1 回目で A、2 回目で B（A から 1 拍より後のときのみ。そうでなければ解除）、3 回目で解除。再生中に B を越えたら A へシーク。ソースを切り替える・曲を読み込み直すと解除
- タイムラインのクリックでシーク（プレイヘッドは左から 25% の位置）
- タイムラインの下に曲全体のシークバー（`#song-overview`）: 左端に再生 / 一時停止（`#song-ov-play`、`#song-play` と同じ動作）、コードの色帯・再生位置・A-B 区間・`現在 / 全体` 時刻。クリックでシーク、ドラッグ中は位置だけ動かして離したときにシーク

#### 上段 Song ボタンの LED（プレイヤーの準備前は `TOP_ROW_LED.unavailable` = [3, 3, 3]）
| CC | 状態 | RGB |
|----|------|-----|
| 95 | 再生中 / 停止中 | [0, 100, 0] / [20, 60, 0] |
| 96 | 常時 | [60, 30, 0] |
| 97 | FOLLOW ON / OFF | [0, 100, 127] / [12, 12, 12] |
| 98 | ループ中 / A のみ設定 / なし | [110, 0, 110] / [100, 100, 0] / [12, 12, 12] |

画面の上段ボタンも同じ色で点灯する（`.pad.fn-btn.song-lit` + `--song-btn`）。

#### タブが非表示のとき
- `startTicker`（`src/platform/ticker.ts`）は表示中 `requestAnimationFrame`、非表示中は Worker のタイマー（約 100ms 間隔）でフレームを回す。別のウィンドウに隠れているだけでもブラウザは「非表示」扱いにするので、Launchpad を弾きながら別ウィンドウを見ていても LED は曲を追う
- 非表示中に動かすのは「再生中 かつ（FOLLOW 中 or A-B ループ中）」のときだけで、画面の更新は省く
- 予告の LED 点滅は通常のタイマーなので、非表示中は点滅が遅くなる（コードの切り替えは追従する）

---

## 色

| 種別 | 画面CSS | Launchpad RGB |
|------|---------|---------------|
| ルート音 | `--root-color` (#ff4466) | [127, 0, 40] |
| 転回ベース音（`showInversion`=true かつ `inversion`>0 時）/ 分数コードのベース（`ChordSpec.bass`） | `--bass-color` (#ffaa33) | [127, 80, 0] |
| 次のコードのルート予告（`selectPreview`） | `--next-root-color` (#7a1a30、点滅) | [40, 0, 12]（点滅） |
| 次のコードの構成音予告 | `--next-chord-color` (#155a6a、点滅) | [0, 30, 40]（点滅） |
| コードトーン（`showChord`=true時） | `--chord-color` (#33ddff) | [0, 100, 127] |
| スケール音（`showScale`=true時） | `--scale-color` (#44ff99) | [0, 127, 60] |
| その他 | off (#000) | [0, 0, 0] |
| 押しているパッド（同じ音が出るパッドすべて） | `.pad.pressed`（押したパッドのみ） | [127, 127, 127] |
| 上段ボタン(機能あり) | — | [60, 30, 0] (orange) |
| ロゴ（接続中） | — | [0, 100, 0] (green) |
| ロゴ（メトロノームアクセント拍） | — | [127, 127, 127] (white) |
| ロゴ（メトロノーム通常拍） | — | [60, 80, 100] (blue-white) |

色の定義は `src/config/roles.ts` に 1 か所（`ROLE_LED` = LED 色、`ROLE_CSS_COLOR` = 画面の色、`ROLE_CLASS` = CSS クラス名）。画面の色は起動時に `src/ui/theme.ts` が CSS カスタムプロパティとして `:root` に設定するので、`style.css` には値を書かない。

---

## ロゴボタン（パッド99）とメトロノーム

### ロゴボタンの動作
| 状態 | LED |
|------|-----|
| MIDI未接続 | 消灯 |
| デバイス接続時 | 緑 [0, 100, 0] |
| デバイス切断時 | 消灯（メトロノームも自動停止） |
| CLEARボタン後 | 緑維持（パッドと上段は次に表示内容が変わるまで消灯のまま） |
| メトロノームON・アクセント拍（1拍目） | 白フラッシュ [127, 127, 127] → 80ms後に緑 |
| メトロノームON・通常拍（2〜4拍目） | 青白フラッシュ [60, 80, 100] → 80ms後に緑 |

### メトロノーム仕様
- 固定4拍子（`src/audio/metronome.ts`。拍の位置は state に含まれない）
- 次の拍の時刻を足し算で進め、少し先の拍までクリック音を Web Audio の時計で予約する（`setInterval` の周期に頼らないのでずれない）
- アクセント拍（beat 0）: 1200Hz / 音量0.35 / 減衰55ms — **ぴ**
- 通常拍（beat 1〜3）: 700Hz / 音量0.18 / 減衰40ms — **ぽ**
- BPM を変えると次の拍から新しい間隔になる（止めない・拍の位置もリセットしない）
- MIDI未接続時はSTARTボタンを押しても起動しない。デバイスが切断されたら自動で止まる

---

## 主要定数

定数は `src/config/` に分野ごとに置く。そのモジュールでしか使わない値は各ファイルの冒頭に名前を付けて置く。

| ファイル | 内容 |
|------|------|
| `config/roles.ts` | 色。`ROLE_LED`（役割 → LED 色）/ `ROLE_CSS_COLOR`（役割 → 画面の色）/ `ROLE_CLASS` / `PRESSED_LED` / `LOGO_LED` / `TOP_ROW_LED` |
| `config/timing.ts` | 時間。`LOGO_FLASH_MS` 80 / `PROGRAMMER_MODE_DELAY_MS` 150 / `SETTINGS_SAVE_DEBOUNCE_MS` 300 / `PREVIEW_BLINK_MS` 150 / `PRACTICE_LEAD_BEATS` 0.5 / `PREVIEW_LEAD_BEATS` 1 / `FALLBACK_BEAT_SEC` 0.5 / `HIDDEN_TICK_MS` 100 / `PLAYER_READY_TIMEOUT_MS` 15000 / `BEATS_PER_BAR` 4 |
| `config/ranges.ts` | 範囲と初期値。`BPM_MIN` 40 / `BPM_MAX` 240 / `BPM_DEFAULT` 120 / `VOLUME_DEFAULT` 50 / `SONG_VOLUME_DEFAULT` 40 / `CLICK_PAD_VELOCITY` 80 / `RECENT_SONGS_MAX` 10 |
| `config/instruments.ts` | `INSTRUMENTS` / `SYNTH_PRESETS` / `SOUNDFONT_KIT` 'MusyngKite' / `SAMPLE_NOTE_RANGE` 21〜108 / `SAMPLE_RELEASE_SEC` 0.3 / `SAMPLE_VOLUME` 100 / `METRO_ACCENT` / `METRO_NORMAL` |
| `config/timeline.ts` | `PLAYHEAD_RATIO` 0.25 / `SONG_PX_PER_SEC` 50 / `ANALYZE_PX_PER_SEC` 60 / `HUE_PER_SEMITONE` 30 |
| `config/storage-keys.ts` | localStorage のキー |
| `config/urls.ts` | Songle / SoundCloud / YouTube の URL |
| `core/theory.ts` | `CHORD_TYPES`（17 種）/ `SCALES`（7 種）/ `INTERVAL_NAMES` / `INVERSION_LABELS` |
| `core/grid.ts` | `GRID_SIZE` 8 / `ROW_INTERVAL` 5 / `DEFAULT_BASE_NOTE` 36 / `MAX_BASE_NOTE` 85 |
| `core/practice.ts` | `PRACTICE_ANCHOR` `{ row: 2, col: 2 }`（練習モードの基準パッド） |
| `analyzer/constants.ts` | コード解析の DSP・デコードの定数（値を変えると保存済みの解析結果から得られるコード進行も変わる） |

---

## 音源仕様

音源は2系統。**サンプル音源（GM Soundfont）が本線**で、オシレーター合成は `Synth` 音色とフォールバック用。

### サンプル音源（`src/audio/sampler.ts` / smplr + GM Soundfont）
- [smplr](https://github.com/danigb/smplr)（npm の依存、バージョン固定 1.1.0）を **動的 import**（最初に必要になったときに読み込む別チャンク）。サンプルの音声ファイルは従来どおり CDN から取得する
- サンプルは gleitz/midi-js-soundfonts の `MusyngKite` キット（1音色 約2〜3.5MB の ogg）
- **遅延ロード**: 音色を選択した時 / その音色で最初に発音した時にロード開始。ロード中は合成音で鳴る
- **キャッシュ**: smplr の `CacheStorage`（Cache API）経由。2回目以降は即ロード
- **フォールバック**: CDN 到達不可・ロード失敗時はその音色を `failed` に入れて合成音で鳴らす（オフラインでもアプリは動く）。音色を選び直すと、もう一度ロードを試す
- 楽器の音（サンプル・合成の両方）は `AudioEngine` の 1 つの GainNode を通り、`#volume` スライダーがそのゲインを動かす（鳴っている音にも効く）。メトロノームのクリック音は別経路で音量スライダーの影響を受けない
- AudioContext は最初のユーザー操作（クリック・キー入力）か最初の発音で作る。MIDI 入力はユーザー操作とみなされないので、画面を一度も操作していないと音が出ない（Sound パネルに「Click anywhere on the page to enable sound」を表示）
- **ロングトーンのループは使わない**（`loadLoopData` は常に無効）
  - goldst.dev がループ情報を配信している音色（organ / church / violin / cello / flute / trumpet）でも、MusyngKite のサンプルには適合しない
  - MusyngKite は全音色が **3.13 秒（137984 サンプル / 44.1kHz）の減衰録音**。どこにループ区間を取っても始点と終点で音量が食い違い、ループごとに音量が跳ねて脈打つ
  - 個別にもループ点が壊れている: `trumpet` は全88ノートがループ長 65〜416 サンプル（2〜9ms）でピッチ無関係のブザー音、`violin` は全107ノートが `loopStart=8`（≒0秒）で弓のアタックを 200ms ごとに繰り返す、`organ` は `loopStart=7` で無音からの立ち上がりを 287ms ごとに繰り返す
  - 結果として、押している間も **約3.1秒で自然に減衰して鳴り終わる**。無限サステインが必要なら `Synth` 系のオシレーター音色（`SYNTH_PRESETS`）を使う
  - 将来ループを入れるなら、ループ情報付きの別サンプルセット（`Soundfont2` + .sf2）に替える必要がある

### 音色一覧（`src/config/instruments.ts` の `INSTRUMENTS`）
`{ label, gm, synth, release? }` — `gm` が GM Soundfont 音色名、`synth` が未ロード時に使う `SYNTH_PRESETS` のキー。`gm: null` はオシレーター合成のみ。

| 分類 | キー |
|------|------|
| Keys | `piano` ★デフォルト / `epiano` / `harpsi` / `organ` / `church` |
| Guitar / Bass | `nylon` / `steel` / `eguitar` / `abass` / `bass` |
| Strings / Voice | `strings` / `violin` / `cello` / `choir` |
| Mallet / Wind | `vibes` / `marimba` / `flute` / `trumpet` / `sax` |
| Synth | `pad` / `lead` / `synth`（合成のみ） |

### オシレーター合成（`src/config/instruments.ts` の `SYNTH_PRESETS`）

| キー | 特徴 |
|------|------|
| `synth` | triangle+sine、velocity対応アタック（5〜50ms）、0.8秒リリース |
| `piano` | sine+triangle、自然減衰（2秒でほぼ消音）、鍵盤離し後0.3秒リリース |
| `organ` | 第1〜4倍音の加算合成（sine×4）、即ON/OFF（0.04秒リリース） |
| `guitar` | sawtooth+lowpass(2500Hz)、超高速アタック→200ms急速減衰（プラック感） |
| `bass` | sine+lowpass(600Hz)、サブオクターブ、パンチのある低音 |
| `strings` | sawtooth×2（+5cent detune）+lowpass(1800Hz)、スロー・アタック（0.15〜0.4秒） |

- **プリセット構造**: `kind` で判別する 2 種類
  - `kind: 'oscillators'` → `{ osc1, osc2 | null, envelope, peakVolFactor, filter | null }`
  - `kind: 'additive'` → `{ harmonics: { multiple, gain }[], envelope, peakVolFactor, filter | null }`（organ）
  - `filter` あり → BiquadFilterNode をエンベロープと出力の間に挿入
- **エンベロープ**: `{ attackBase, attackVelRange, decayTime, sustainRatio, releaseTime }`
  - attackTime = `attackBase + (1 - velocity/127) * attackVelRange`（高velocityほど速い）

### 発音の管理（`src/app/note-controller.ts`）
- **押下 1 回 = 1 ボイス**。`state.held` に `{ pressId, padIndex, note }` を持ち、`NoteController` が `pressId → Voice`（`stop()` を持つ）を管理する
- 鳴らす音は押した瞬間のパッド配置で決まり、離すときは `pressId` で止める。押している間にカポ・オクターブを変えても同じ音を止められ、同じ音のパッドを 2 つ押しても別々に止まる
- `pressId` は画面 = `pointer:<pointerId>`、Launchpad = `device:<パッド番号>`。画面のパッドは `setPointerCapture` で捕まえ、`pointerup` / `pointercancel` / `lostpointercapture` で離す（マウスを載せて外しただけでは何も起きない）
- デバイスが切断されたら `device:` の押下をすべて解放、ウィンドウがフォーカスを失ったら `pointer:` の押下を解放する（Launchpad の押下は止めない）

---

## ファイル構成

```
index.html / style.css      メイン画面
analyze.html / analyze.css  コード解析ページ
src/
  main.ts                 メイン画面の合成ルート
  analyze.ts              解析ページの合成ルート
  core/                   純粋ロジック
    pitch.ts                mod12・音名・MIDI → 周波数
    theory.ts               CHORD_TYPES / SCALES などのテーブル
    grid.ts                 パッド配置（buildPads）
    chord.ts                ChordSpec / EffectiveChord・構成音・コード名・表示用の文字列
    pad-roles.ts            classifyPads（全パッドの役割 = 画面と LED の共通の元）
    practice.ts             練習モードのボイシング
    detect.ts               押さえた音からのコード検出
    segments.ts             Segment / Timing・区間の検索・結合・キー推定
    key.ts                  Krumhansl-Kessler によるキー推定
    capo.ts                 カポ位置・スケール適合率・自動カポ選択
    time-format.ts          m:ss / m:ss.s
  config/                 名前付き定数（上の「主要定数」）
  store/                  状態
    state.ts / actions.ts / reducer.ts / selectors.ts
    initial-state.ts        保存データの検証と初期状態・保存する形
    create-store.ts         dispatch / subscribe / watch
  platform/
    storage.ts / persistence.ts   localStorage
    logger.ts               イベントログ（出力先は後から登録）
    dom.ts                  byId（無ければ例外）・要素の生成
    ticker.ts / ticker.worker.ts  フレームループ（非表示中は Worker のタイマー）
  audio/
    engine.ts               発音の入口（サンプル優先・合成フォールバック）・音量・クリック音
    synth-voice.ts          オシレーター合成の 1 音
    sampler.ts              smplr + GM Soundfont（遅延ロード）
    metronome.ts            メトロノームのスケジューラ
  midi/
    port-selection.ts       chooseOutput / matchInput（純粋関数）
    device-manager.ts       Web MIDI のポート監視・接続・入力イベント
  led/
    frame.ts                buildLedFrame（純粋関数）・パッド番号の変換
    sender.ts               差分送信
    controller.ts           状態 → LED・予告の点滅・ロゴのフラッシュ
  app/
    note-controller.ts      押下 → 発音
    top-row.ts              上段 8 ボタンの表（ラベル・操作・LED 色）
    activity-log.ts         状態の変化をイベントログへ
  ui/                     メイン画面のビュー（mount 関数。要素を取得し、状態を購読して描画する）
    grid-view.ts / chord-controls-view.ts / chord-display-view.ts
    device-view.ts / audio-views.ts（音量・メトロノーム・音色）/ log-view.ts
    theme.ts                色・タイミングの定数を CSS カスタムプロパティに設定
  song/                   Song バー
    types.ts                Media / SongInfo / ChordSource / Loop / Cursor など
    media-url.ts            URL → Media（parseMediaUrl / parseYouTubeId）
    url-params.ts           ?v= / ?url=
    follow.ts               computeCursor（再生位置 → 今の区間・予告。純粋関数）
    loop.ts                 A-B ループの状態遷移（純粋関数）
    recents.ts              最近の曲の一覧操作
    loader.ts               曲の読み込み・Songle 検索（中断の管理）
    runtime.ts              フレームごとの処理・再生操作（再生 / シーク / 1 小節戻る / ループ）
    sources/
      songle-chord.ts         Songle のコード名 → ChordSpec
      songle-client.ts        Songle API（曲情報・コード・ビート・検索）
      analysis-cache.ts       解析結果の保存形式（読み書き・検証）と ChordSource への変換
    media/
      player.ts               MediaPlayer インターフェース
      vendor.ts               外部スクリプトの読み込みと型（window グローバルはここだけで扱う）
      songle-player.ts / soundcloud-player.ts
      clock.ts                再生時刻の平滑化・補間
      player-host.ts          プレイヤーの生成と破棄の直列化
    views/
      search-panel-view.ts    入力欄・候補リスト
      song-bar-view.ts        ソース選択・KEY / TEMPO / CAPO・操作ボタン・ステータス行
      playback-views.ts       タイムライン・NOW / NEXT・シークバー
      status.ts               ステータス行の文言（純粋関数）
  timeline/timeline-view.ts  コード進行のタイムライン（Song バーと解析ページで共通）
  analyzer/               オーディオ → コード進行（DOM 非依存。Worker / Node で動く）
    dsp.ts                  FFT・リサンプル（22.05 kHz へ。整数比は間引き、それ以外は多相フィルタ）
    features.ts             extractFeatures（ビート同期クロマ。分離処理の全組み合わせを事前計算）
    decode.ts               decodeChords（バリアント選択 + キー推定 + Viterbi）
    constants.ts / types.ts / protocol.ts（Worker とのメッセージ）/ analyzer.worker.ts
  analyze-page/           解析ページ
    state.ts                ページの状態と派生値・保存形式との変換
    view.ts                 画面
    youtube-player.ts       YouTube IFrame Player API のラッパー
    capture.ts / tab-recorder.worklet.ts  タブ音声の録音（getDisplayMedia + AudioWorklet）
    time-map.ts             録音時刻 → 動画時刻の変換
    extract.ts              Worker での特徴量抽出
    canvases.ts / beat-click.ts
packages/launchpad-x/     Launchpad X ライブラリ（LaunchpadX クラス・SysEx・Web MIDI アダプター）
tests/
  golden/                 リライト前の実装の出力（基準データ）
  helpers/                偽の MIDI デバイス・合成音源・乱数
  core/ song/ analyzer/ app/  テスト
scripts/typecheck.mjs     全 tsconfig の型チェックを並列実行
```

### データの流れ

```
操作（画面 / Launchpad） ──▶ store.dispatch(action) ──▶ reduce ──▶ 新しい state
                                                                      │
                     ┌────────────────────────────────────────────────┤
                     ▼                    ▼                           ▼
              ui/ のビュー           led/controller             platform/persistence
              （DOM を更新）     （差分を Launchpad に送信）      （localStorage に保存）

再生位置（毎フレーム） ──▶ SongRuntime.frame ──▶ computeCursor ──▶ 変わったときだけ dispatch(cursorMoved)
                                              └──▶ タイムライン / NOW・NEXT / シークバーを直接更新
```

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
