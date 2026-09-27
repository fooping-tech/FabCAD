# FabCAD

ブラウザだけで動く、汎用パラメトリック 3D CAD です。設計した形状を、そのまま加工可能な部品データへ変換する **Fabrication Compiler** を備えています。

公開 URL: https://fooping-tech.github.io/FabCAD/

```
Parametric Sketch  →  CAD Solid  →  Generic Fabrication Compiler  →  SVG / DXF
```

バックエンドはありません。すべての処理はブラウザ内で完結し、プロジェクトは `.fabcad.json` ファイルとして保存します。

## できること

### DESIGN ワークスペース

| 分類 | 内容 |
| --- | --- |
| Sketch Create | Line、Polyline、2 点 / 3 点 / 中心の Rectangle、Circle、3 点 Circle、中心点 Arc、3 点 Arc、Ellipse、内接 / 外接 Polygon、Slot、Point、Fit Point Spline、Control Point Spline、Construction Line |
| Sketch Modify | Move、Copy、Trim、Extend、Offset、Mirror、Fillet、Chamfer、Break、Scale、Rectangular Pattern、Circular Pattern、Construction 切り替え |
| Constraints | Coincident、Horizontal、Vertical、Parallel、Perpendicular、Tangent、Equal、Concentric、Collinear、Midpoint、Fix、Symmetry |
| Dimensions | Distance、Horizontal / Vertical Distance、Angle、Radius、Diameter。値にはパラメータ式を入力できます |
| 拘束状態 | Under-constrained（残り自由度を表示）/ Fully constrained / Over-constrained。過剰拘束になる操作は拒否します |
| Profile | 交点を含めて閉領域を自動検出し、クリックで選択（複数選択可） |
| Solid | Extrude（New Body / Join / Cut / Intersect、片側・反転・対称。矢印をドラッグして距離を決められ、結果を半透明でプレビュー）、Revolve、Combine（Union / Cut / Intersect）、Fillet、Chamfer、Shell |
| Parameters | 名前付きパラメータ、単位（mm / cm / m / in / deg / rad）、式、他パラメータの参照、`sin cos tan asin acos atan atan2 sqrt abs min max floor ceil round pow` |
| Timeline | Feature History、ヒストリーマーカー、抑制（Alt + クリック）、ダブルクリックで編集 |
| 入出力 | STEP import / export、STL export、プロジェクト保存・読み込み、IndexedDB への自動保存 |

### FABRICATION ワークスペース（Laser）

| 分類 | 内容 |
| --- | --- |
| Material | MDF、Acrylic、Cardboard、Paper。厚み・kerf・fit offset を編集でき、独自の材料も追加できます |
| Board（MDF / Acrylic / Cardboard） | Panel Decomposition → Joint → Thickness Compensation → Kerf Compensation。Joint は Tab & Slot / Finger / Flat |
| Paper | Unfold → Connected Net → Fold Line → Glue Tab（幅・角度・インセット） |
| Analyzer | concave corner、acute angle、short edge、narrow tab、曲面などを警告 |
| Parts | 部品名、寸法、厚み、材料、joint、mating edge（`EdgeConnection` を明示的に保持） |
| Sheet | row / shelf packing、複数シート、90° 回転 |
| Export | SVG（mm 単位、`cut` / `fold` / `engrave` をグループ分け）、DXF。プレビューと書き出しは同一の `SheetGeometry` を使います |

## 使い方

Node.js 22 以降が必要です。

```sh
npm install
npm run dev
```

開発サーバーは http://127.0.0.1:5173/FabCAD/ で起動します。

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

`npm run build` は `dist/` を生成します。

### 基本の流れ

1. **Create Sketch** を押し、原点平面または平らな面を選びます。
2. Create ツールで形を描き、Constraints と Dimension（`D`）で形状を決めます。
3. **Finish Sketch** で 3D に戻り、**Extrude**（`E`）でプロファイルをクリックして押し出します。
4. 上部で **FABRICATION** に切り替え、材料を選びます。
5. **Parts** と **Sheet** で結果を確認し、**Export SVG** を押します。

### キーボードとマウス

| 操作 | 内容 |
| --- | --- |
| `Esc` | 実行中のコマンドをキャンセル |
| `Enter` | ダイアログの確定、Polyline / Spline の終了 |
| `Delete` | 選択したオブジェクトを削除 |
| `Ctrl/Cmd + Z`、`Ctrl/Cmd + Shift + Z` | Undo / Redo |
| `Ctrl/Cmd + S`、`Ctrl/Cmd + O` | 保存 / 開く |
| `F` | 全体表示 |
| スケッチ中 `L` `R` `C` `A` `D` `T` `O` `M` `P` `S` `X` | Line、Rectangle、Circle、Arc、Dimension、Trim、Offset、Move、Point、Spline、Construction |
| スケッチ中 `E` | スケッチを終了して Extrude を開始。閉領域が 1 つならそのまま選択されます |
| 3D `E` `S` | Extrude、Create Sketch |
| 3D `L` `R` `C` `A` `P` など | 平面を選ぶと、そのツールでスケッチを開始 |
| ホイール | ズーム |
| 中ボタンドラッグ | パン |
| 右ドラッグ（3D では左ドラッグも） | オービット |
| `Ctrl/Cmd` を押しながらクリック | スナップを無効化（スケッチ）、追加選択 |
| Extrude の矢印をドラッグ | 距離を変更。`Alt` を押している間は刻みなし |

ショートカットは日本語入力がオンのままでも使えます。

### スマートフォン・タブレット

幅 860 px 以下ではスマートフォン用のレイアウトになります。

| 操作 | 内容 |
| --- | --- |
| 1 本指ドラッグ | 3D ではオービット。スケッチでは描画とドラッグ |
| 2 本指 | パンとズーム |
| タップ | 選択。スケッチのツールでは点を置きます |
| 指を置いてからずらして離す | 離した位置に点を置きます（狙いを定められます） |
| 画面下の **Browser** / **Settings** | ブラウザとプロパティ、または Fabrication の設定を下から開きます |
| 画面下の **Cancel** / **Done** / **Delete** / **Finish** | `Esc`、`Enter`、`Delete`、スケッチ終了の代わり |
| 選択済みの寸法をもう一度タップ | 寸法値を編集 |

Extrude などのダイアログは主要な項目だけを表示し、**Options** で残りを開きます。

## アーキテクチャ

CAD Core と Manufacturing を分離しています。CAD Core は MDF も Glue Tab も Kerf も知りません。

```
UI (React)
  ↓
Commands / Document Model        packages/cad-document
  ↓
Feature Engine                   packages/features
  ↓
Geometry Kernel Adapter          packages/brep
  ↓
OpenCASCADE / Replicad           （packages/brep/src/replicadAdapter.ts だけが import）
```

```
CadBody（SolidTopology）
  ↓  fabricate(body, material, strategy)      packages/fabrication-core
FabricationResult（FlatPart + EdgeConnection + Warning）
  ↓  layoutParts → resolveSheetGeometry
SheetGeometry  →  preview / SVG / DXF
```

| パッケージ | 責務 |
| --- | --- |
| `packages/geometry` | ベクトル、平面、2D 曲線（線・円弧・楕円弧・ベジェ）と交点、ポリゴン、多面体トポロジ（`SolidTopology`） |
| `packages/sketch` | Sketch のデータモデル、Create / Modify ツール、Profile 検出、計測 |
| `packages/sketch-solver` | 2D 拘束ソルバー（最小ノルム Levenberg–Marquardt）、自由度と冗長・矛盾の判定、ドラッグ。`SketchSolver` インターフェースで差し替え可能 |
| `packages/cad-document` | Document、Parameters と式、Feature 定義、依存グラフ、Command と Undo / Redo、保存形式 |
| `packages/assembly` | Component、Instance、Joint、Rigid Group のデータモデル |
| `packages/brep` | `GeometryKernel` インターフェースと Replicad アダプタ |
| `packages/features` | Feature Engine。Timeline を評価して Body を作り、入力のハッシュで Feature ごとにキャッシュします |
| `packages/fabrication-core` | 材料、Strategy、`fabricate()`、Analyzer、Kerf 補正、Nesting、Sheet |
| `packages/fabrication-laser` | Board と Paper の Strategy |
| `packages/svg`、`packages/dxf` | 書き出し |
| `apps/fabcad` | React アプリ。Feature Engine と OpenCASCADE は Web Worker 内で動きます |

### 設計上の決まり

- **ユーザーの Sketch が正本です。** 長方形・星・多角形を特別扱いするコードはありません。長方形は 4 本の線と拘束です。
- **Fabrication は形状に依存しません。** 面・稜線・二面角だけから部品を作ります。プリズム以外の立体（角錐など）もテストしています。
- **Part Geometry と Joint Geometry を混ぜません。** `FlatPart.outline` と `FlatPart.joints` は別に保持し、最終的な `paths` で合成します。
- **接続は明示します。** 部品どうしの関係は `EdgeConnection` として立体のトポロジから作り、SVG 上の位置から推測しません。
- **寸法の式はソルバーの外で評価します。** ソルバーが受け取るのは数値だけです。
- **ドキュメントは不変の値です。** すべての変更は Command を通り、Undo / Redo の対象になります。ドラッグは 1 つの履歴にまとまります。

### 曲面の扱い

OpenCASCADE のメッシュを B-Rep の面ごとにまとめ、平面は 1 枚のポリゴン、曲面は同一平面上の三角形をまとめた小さな平面（facet）の集まりとして `SolidTopology` にします。Board は曲面を切り出せないので警告を出し、Paper は facet を帯として展開します。

### Board の厚み補正

各面の外側の面を立体の面に合わせ、板厚は内側に取ります。稜線ごとに二面角 θ と板厚 t、面の内側へのずれ m から、面内でのオフセット量を求めます。Tab & Slot のスロットを閉じた穴にするため、タブ側のパネルは `slotEdgeMargin`（初期値 3 mm）だけ内側にずらします。0 にするとスロットは外周に開いた切り欠きになります。

## テスト

```sh
npm test
```

Vitest で 270 件以上のテストを実行します。OpenCASCADE を使うテストは Node 上で WASM を読み込みます。

| 対象 | 内容 |
| --- | --- |
| CAD Core | geometry、constraints、parameter evaluation、feature recompute、dependency graph、save / load |
| Fabrication | rectangle / hexagon / star MDF、paper box、paper polygon、kerf compensation、tab / slot matching、SVG dimensions、角錐 |
| シナリオ | `apps/fabcad/test/scenarios.test.ts` が Sketch → Solver → Extrude → B-Rep → Fabrication → SVG を通しで検証 |

## GitHub Pages

`main` に push すると、GitHub Actions（`.github/workflows/pages.yml`）が型チェック・テスト・ビルドを実行し、`dist/` を Pages に公開します。リポジトリの **Settings → Pages → Source** は **GitHub Actions** にしてください。

Vite の `base` は `/FabCAD/` です。別のパスで公開する場合は環境変数で指定します。

```sh
FABCAD_BASE=/ npm run build
```

SPA ルーティングは使っていません。WebAssembly（約 23 MB、gzip で約 7 MB）は Vite がハッシュ付きのアセットとして出力し、Worker から相対 URL で読み込みます。

## 未実装・制限

| 項目 | 状態 |
| --- | --- |
| Project / Include / Intersect | データモデル（`Sketch.projections`）のみ。ソルバーは投影された要素を固定として扱います |
| Assembly | データモデルのみ。Component や Joint を操作する UI はありません |
| Sweep、Loft、Draft、Rib、Hole、Thread、Split Body | 未実装 |
| DXF import、IGES | 未実装 |
| 面・稜線の参照 | 位置で照合します。上流の変更で形が大きく変わると、Fillet などの参照が別の稜線に移ることがあります |
| Ellipse と Spline | 拘束と寸法、Trim / Extend / Offset の対象外です（切る側としては使えます） |
| 角度寸法 | 1 本目の線から 2 本目の線へ反時計回りに測ります |
| Nesting | 外接矩形による row / shelf packing のみ |
| 凹角 | Board のパネルは線で接するだけで、内側に隙間が残ります（警告を出します） |
| 範囲選択 | 未実装 |
| スマートフォン | Chrome のスマートフォン表示とタッチ入力のエミュレーションで確認しました。実機では未検証です |
| 実機での加工 | 未検証です。kerf と fit offset は材料と加工機に合わせて調整してください |

## ライセンスについて

幾何カーネルの OpenCASCADE と Replicad は LGPL-2.1 です。
