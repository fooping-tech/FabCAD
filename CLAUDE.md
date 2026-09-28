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

1. **形状ごとの特別扱いを書かない。** `generateBox()` のような関数や「プリズムなら」という分岐を作らない。Sketch はユーザーが描いたものが正本で、Fabrication は `SolidTopology`（面・稜線・二面角）だけから部品を作る。
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
| `apps/fabcad/src/fabrication/` | FABRICATION ワークスペース。`pipeline.ts` は React に依存しない純粋な関数 |

スケッチは 3D ビューの上に重ねた 2D キャンバスに、3D カメラで投影して描く。マウス位置は視線とスケッチ平面の交点でスケッチ座標に変換する。

ポインタ入力は `Viewport.tsx` に集約している。タッチは `pointerType === "touch"` で判別し、スケッチのツールでは指を離したときに点を置く。2 本目の指が触れたら、1 本目が始めた操作は取り消す。Extrude の矢印（`extrudeManipulator.ts`）は capture フェーズで `pointerdown` を受け、OrbitControls より先に処理する。

キーボードショートカットは `app/shortcuts.ts`。日本語入力がオンだと `key` が `Process` になるので、`code` から文字を求めている。

テキストの輪郭は派生データで、`SketchText.outline` にキャッシュする。`outline.key` が入力（文字列、フォント、評価済みの数値、パスの形）と一致しなくなったら、`refreshTexts()` が作り直して `documentStore.amend()` で差し替える（履歴は増えない）。テキストのダイアログは `documentStore.begin()` のトランザクションの中でドキュメントを直接書き換え、OK で 1 つの履歴にまとめる。

Hole、Pattern、Mirror、Move、Align、Split、Sweep、Loft のダイアログは `app/solidDialogs.ts`（ダイアログ ↔ Command の入力、検証、どの欄が何を受け取るか。純粋な関数）と `panels/SolidDialogFields.tsx`。数が評価結果で決まる Body（Pattern のインスタンスなど）は ID が `featureId:bodyId:n` で、再計算のたびに `syncBodyRecords()` でドキュメントの Body の記録を合わせる。

Sketch の Create ツールを足すときは `packages/sketch/src/create.ts` に関数を、`apps/fabcad/src/sketch/createTools.ts` の `CREATE_TOOLS` に定義を 1 つ追加する。

## ブラウザでの確認

`import.meta.env.DEV` のときだけ `window.__fabcad`（`documentStore`、`appState`、`modelState`、`sketchToScreen`、`worldToScreen`）を公開している。Playwright で操作するときは、これでスケッチ座標を画面座標に変換してクリックする。ヘッドレスの Chrome は `--use-gl=swiftshader --enable-unsafe-swiftshader` を付けて起動すると WebGL が動く。

## 公開手順

`main` に push すると GitHub Actions が型チェック・テスト・ビルドを行い、GitHub Pages に公開する。Vite の `base` は `/FabCAD/`（`FABCAD_BASE` で変更可）。
