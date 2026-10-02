# CLAUDE.md

FabCAD — ブラウザで動く汎用パラメトリック 3D CAD と、レーザー加工向けの Fabrication Compiler。
公開 URL: https://fooping-tech.github.io/FabCAD/ （紹介ページ）、CAD 本体は `/FabCAD/app/`。利用者向けの説明と未実装の一覧は `README.md`（日本語）にある。

## 開発コマンド

Node.js 22 以降。npm workspaces のモノレポ。

```sh
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

- 開発サーバーは http://127.0.0.1:5173/FabCAD/ （紹介ページ）と `/FabCAD/app/`（CAD 本体）。
- 1 パッケージだけテストするときはリポジトリのルートで `npx vitest run packages/sketch` のように実行する（パッケージのディレクトリで実行するとテストが見つからない）。
- パッケージはビルドせず、`src/index.ts` を直接参照する。

## 守ること

1. **形状ごとの特別扱いを書かない。** `generateBox()` のような関数や「六角形なら」という分岐を作らない。Sketch はユーザーが描いたものが正本で、Fabrication は `SolidTopology`（面・稜線・二面角）だけから判定し、部品を作る。Board は最初に `classifyBoardBody()`（`packages/fabrication-laser/src/boardClassifier.ts`）で Flat Part / Rectangular Box / Unsupported に分け、判定の前に部品を作らない。Paper は 2 方向に曲がった面（平らに広げられない面）を `doublyCurvedFaces()`（`paperClassifier.ts`）で見つけ、あれば展開しない。利用者が Gores を選んだときだけ、`planGores()` で舟形に分けて近似する（近似であることを判定結果と警告に出す）。舟形の数は `SolidTopology` の分割で決まるので、アプリが `goreTessellation()` の値で粗い分割を要求する（`useFabrication.ts` の `facetsFor()`）。加工できると保証できない立体は Unsupported で止め、それらしい SVG を出さない（斜めの接合を Flat Joint に落として出力する、などをしない）。Case / Enclosure は立体から推測せず、専用のパラメトリックなジェネレーターとして作る。
2. **層を飛び越えない。** UI → Commands / Document → Feature Engine → `GeometryKernel` → Replicad。Replicad / OpenCASCADE を import してよいのは `packages/brep/src/replicadAdapter.ts` だけ。
3. **CAD Core は製造を知らない。** `packages/geometry`、`sketch`、`sketch-solver`、`cad-document`、`assembly`、`brep`、`features` から `fabrication-*` を import しない。製造側が CAD から受け取るのは `CadBody`（`SolidTopology`）だけ。Fabrication の設定はドキュメントの `extensions["fabrication.laser"]` に不透明なデータとして保存する。
4. **ドキュメントの変更は Command を通す。** `apps/fabcad/src/app/session.ts` の `run()` と `editSketchSolved()` を使う。ドキュメントは不変の値として扱い、書き換えない。
5. **ドキュメントのスケッチは常に解いた状態で保存する。** パラメータを変える Command は `resolveDocumentSketches()` で同じ Undo ステップの中でスケッチを解き直す。
6. **Part Geometry と Joint Geometry を混ぜない。接続は `EdgeConnection` で明示する。**
7. **プレビューと書き出しは同じ `SheetGeometry` を使う。**
8. **面と稜線を位置で覚えない。** Feature が面・稜線・頂点を参照するときは `TopologyRef`（`packages/features/src/naming.ts` の `makeFaceRef` / `makeEdgeRef`）を保存し、`resolveFaceRef` / `resolveEdgeRef` で解決する。新しい Feature を足すときは、結果の面に名前を付ける（`nameSolid` / `propagateNames`）。
9. **Feature を増やすときは 1 つのパラメトリックな Feature にする。** Pattern をコピーの集まりとして保存しない。数値はすべて式（文字列）で持ち、`featureExpressions` に載せる。
10. **`packages/typography` は CAD を知らない。** 依存してよいのは `packages/geometry` だけ。ドキュメントと文字組みが出会うのは `apps/fabcad/src/text/derive.ts` だけ。Fabrication にテキスト専用の処理を書かない。
11. **ユーザーが読み込んだフォントをプロジェクトに埋め込まない。送信もしない。**
12. **アプリ内ヘルプを実装と一緒に更新する。** ヘルプの本文は `apps/fabcad/src/help/content.ts` の `HELP` に集約している。ヘルプは英語と日本語の併記で、英語は `content.ts`、日本語は `content.ja.ts` の `HELP_JA` に同じ ID・同じ構成（項目の数と順番、パラメータ名）で書く。日本語の文中でも、ツール名・入力欄・ボタンの名前は画面の表記（英語）のまま書く。
    - 利用者が使う機能・ツールを足すときは、そのヘルプ（`HELP` と `HELP_JA` の項目）を同じ変更で足し、リボンやメニューの `help` に ID を渡す。
    - 既存の機能の動作、パラメータ、前提となる選択、制限を変えるときは、そのヘルプを英語・日本語とも同じ変更で直す。
    - ヘルプがない、または内容が古いままの機能は、実装が終わっていない。
    - `apps/fabcad/test/help.test.ts` が、Create / Modify ツール、拘束、Feature、リボンに書いた ID のすべてに項目があること、英語と日本語の構成が一致することを確認する。
13. **メニューは `ui/Popover` で出す。** 位置を CSS や座標の計算で個別に決めない。`Popover` は `document.body` の直下に描き、見えている範囲（visual viewport と safe area）に収まる位置を `ui/placement.ts` の `placeMenu()` で決める。
    - コマンドの窓（Feature のダイアログ、スケッチのツールのオプション、Text、Measure）は `ui/FloatingPanel` で出す。クリックした位置の横（`placeBeside()`）に開き、タイトルバーで動かせる。動かした位置は窓の ID ごとにセッションの間だけ覚える。開く位置は `lastViewportPoint()`（`app/appState.ts`）か、スケッチのツールなら `appState.toolPanel`。
14. **タッチのジェスチャーは `ui/gestures.ts` で判定する。** ダブルタップ（エディタのコンテキストメニュー）と長押し（ツールアイコンのヘルプ）を、ツールやコンポーネントごとに実装しない。
15. **クリックで選択するところは `isAdditiveClick()`（`app/appState.ts`）で追加選択かどうかを決める。** 修飾キーを個別に調べない。Multi-Select（`appState.multiSelect`）が効かなくなる。

## 構成

| 場所 | 内容 |
| --- | --- |
| `packages/*` | README の「アーキテクチャ」の表を参照 |
| `apps/fabcad/src/app/` | `session.ts`（ドキュメントストア・ソルバー・Worker の接続、再計算、保存）、`appState.ts`（UI の状態）、`actions.ts`（スケッチ開始、ダイアログ、削除など）、`shortcuts.ts` |
| `apps/fabcad/src/worker/` | Feature Engine と OpenCASCADE を動かす Web Worker と、その RPC |
| `apps/fabcad/src/viewport/` | Three.js のシーン（`scene.ts`）と React の `Viewport.tsx`。ピッキング、カメラ、ハイライト |
| `apps/fabcad/src/sketch/` | `SketchController.ts`（スケッチの描画と入力）、`createTools.ts`（Create ツールの定義）、`constraintTools.ts`、`render.ts` |
| `apps/fabcad/src/panels/` | Header、Ribbon、Browser、Properties、Timeline、ダイアログ |
| `apps/fabcad/index.html`、`src/landing/` | 紹介ページ。静的な HTML と CSS。掲載しているスクリーンショット（`public/landing/`）は実際のアプリを Playwright で操作して撮ったもの。画面を大きく変えたら撮り直す |
| `apps/fabcad/src/text/` | スケッチのテキスト。`typography.ts`（フォントの読み込みと、輪郭を最新に保つ処理）、`derive.ts`（`SketchText` → 輪郭。純粋な関数）、`textCommands.ts`、`TextDialog.tsx` |
| `apps/fabcad/src/measure/` | Measure。選択を幾何の基本要素に変換し、値は `packages/geometry/src/measure.ts` で計算する。ドキュメントには何も保存しない |
| `apps/fabcad/public/fonts/` | 標準搭載のフォントと OFL の本文。追加・更新したら `packages/typography/src/catalog.ts` と `THIRD_PARTY_FONTS.md` も直す |
| `apps/fabcad/src/print/` | FABRICATION ワークスペースの 3D Print。設定は `extensions["fabrication.print"]`。受け取るのは Body のメッシュ（`modelState` の tessellation）だけ |
| `apps/fabcad/src/fabrication/` | FABRICATION ワークスペース。`pipeline.ts` は React に依存しない純粋な関数。Body ごとの判定結果は `FabricationOutput.detections` |
| `apps/fabcad/src/help/` | アプリ内ヘルプ。`content.ts`（英語の本文のレジストリ `HELP` と、項目がないときの `helpFor()`）、`content.ja.ts`（日本語の本文 `HELP_JA`）、`useHelpTrigger.ts`（右クリックと長押し）、`HelpMenu.tsx`（短い説明）、`HelpOverlay.tsx`（詳細）。状態は `appState.help` だけで、ドキュメントにもコマンドにも触れない |
| `apps/fabcad/src/ui/` | `Icon.tsx`、`Menu.tsx`、`Popover.tsx`（画面内に収まるメニュー）、`FloatingPanel.tsx`（クリックの横に開く、動かせるコマンドの窓）、`placement.ts`（位置の計算。純粋な関数）、`gestures.ts`（ダブルタップと長押し。純粋な関数） |

スケッチは 3D ビューの上に重ねた 2D キャンバスに、3D カメラで投影して描く。マウス位置は視線とスケッチ平面の交点でスケッチ座標に変換する。

スケッチの位置は `SketchController.pickAt()` で決まる。順番は、既存の点・中点・曲線へのスナップ（`snapPoint`）、水平・垂直の位置合わせ（`alignPoint`。スケッチの点と、実行中のコマンドで置いた点が対象。ガイドは `drawAlignmentGuides`）、1 mm のグリッド。位置合わせの許容範囲は画面上のピクセルで決めるので、ズームに依存しない。点のドラッグも同じ `freePosition()` を通る。

ポインタ入力は `Viewport.tsx` に集約している。タッチは `pointerType === "touch"` で判別し、スケッチのツールでは指を離したときに点を置く。2 本目の指が触れたら、1 本目が始めた操作は取り消す。コンテキストメニューは、マウスでは右クリック、タッチではダブルタップで開く（1 回目のタップは通常の選択で、2 回目でその前の選択に戻してからメニューを開く）。ビューの長押しには何も割り当てていない。長押しはツールアイコンのヘルプ用。Extrude の矢印（`extrudeManipulator.ts`）は capture フェーズで `pointerdown` を受け、OrbitControls より先に処理する。

構成平面（Offset Plane）は `offset-plane` という Feature で、基準（原点平面・平らな面・ほかの構成平面）と距離の式を持つ。評価結果（平面と、画面に出す四角形）は Feature Engine が `RecomputeResult.planes` で返し、`modelState.planes` に入る。平面を参照するもの（`PlaneReference` の `{ type: "plane" }`、スケッチの `{ type: "plane" }`）は Feature の ID で参照し、依存は `featureInputPlanes()` で取る。構成平面の上のスケッチは、平面が動くと `sketchUpdates` で追従する。

キーボードショートカットは `app/shortcuts.ts`。日本語入力がオンだと `key` が `Process` になるので、`code` から文字を求めている。

テキストの輪郭は派生データで、`SketchText.outline` にキャッシュする。`outline.key` が入力（文字列、フォント、評価済みの数値、パスの形）と一致しなくなったら、`refreshTexts()` が作り直して `documentStore.amend()` で差し替える（履歴は増えない）。テキストのダイアログは `documentStore.begin()` のトランザクションの中でドキュメントを直接書き換え、OK で 1 つの履歴にまとめる。

Hole、Pattern、Mirror、Move、Align、Split、Sweep、Loft、Offset Plane のダイアログは `app/solidDialogs.ts`（ダイアログ ↔ Command の入力、検証、どの欄が何を受け取るか。純粋な関数）と `panels/SolidDialogFields.tsx`。数が評価結果で決まる Body（Pattern のインスタンスなど）は ID が `featureId:bodyId:n` で、再計算のたびに `syncBodyRecords()` でドキュメントの Body の記録を合わせる。

スケッチの Offset は、クリックでプレビュー（`appState.sketchOffset`）を出し、窓の OK か Enter で確定する。形の計算は `sketch/offsetGeometry.ts`（純粋な関数）、状態の操作は `sketch/offsetTool.ts`。オプションのあるスケッチのツールは `sketch/toolWindows.ts` の `TOOLS_WITH_WINDOW` に載せ、窓の中身は `panels/SketchToolPanel.tsx` に書く。

Project で曲面を選ぶと、稜線に加えて輪郭（シルエット）も投影する。輪郭は稜線ではないので、メッシュから `faceSilhouettes()`（`packages/brep/src/query.ts`）で求め、`source: "silhouette"` の投影として面の `TopologyRef` で覚える。

Sketch の Create ツールを足すときは `packages/sketch/src/create.ts` に関数を、`apps/fabcad/src/sketch/createTools.ts` の `CREATE_TOOLS` に定義を 1 つ追加する。

## ブラウザでの確認

`import.meta.env.DEV` のときだけ `window.__fabcad`（`documentStore`、`appState`、`modelState`、`sketchToScreen`、`worldToScreen`）を公開している。Playwright で操作するときは、これでスケッチ座標を画面座標に変換してクリックする。ヘッドレスの Chrome は `--use-gl=swiftshader --enable-unsafe-swiftshader` を付けて起動すると WebGL が動く。

タッチの操作（タップ、ダブルタップ、長押し）は、`hasTouch: true` のコンテキストで CDP の `Input.dispatchTouchEvent` を送って確認する。`page.touchscreen.tap()` は指を置いて離すまでが一瞬なので、長押しには使えない。

## 公開手順

`main` に push すると GitHub Actions が型チェック・テスト・ビルドを行い、GitHub Pages に公開する。Vite の `base` は `/FabCAD/`（`FABCAD_BASE` で変更可）。
