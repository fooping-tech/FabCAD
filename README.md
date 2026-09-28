# FabCAD

ブラウザだけで動く、汎用パラメトリック 3D CAD です。設計した形状を、そのまま加工可能な部品データへ変換する **Fabrication Compiler** を備えています。

公開 URL: https://fooping-tech.github.io/FabCAD/ （紹介ページ）、CAD 本体は https://fooping-tech.github.io/FabCAD/app/

```
Parametric Sketch  →  CAD Solid  →  Generic Fabrication Compiler  →  SVG / DXF
```

バックエンドはありません。すべての処理はブラウザ内で完結し、プロジェクトは `.fabcad.json` ファイルとして保存します。

## できること

### DESIGN ワークスペース

| 分類 | 内容 |
| --- | --- |
| Sketch Create | Line、Polyline、2 点 / 3 点 / 中心の Rectangle、Circle、3 点 Circle、中心点 Arc、3 点 Arc、Ellipse、内接 / 外接 Polygon、Slot、Point、Fit Point Spline、Control Point Spline、Construction Line |
| Text | スケッチ内のテキスト。フォント、高さ、字間、行間、角度、揃え、横書き / 縦書き、線・円弧・円・スプラインに沿った配置（Text on Path）。文字列のまま保存され、あとから編集できます。輪郭はそのまま Profile になり、Extrude / Cut できます。右クリックの **Explode Text** で通常のスケッチ曲線に変換します |
| Project | 立体の稜線・面の輪郭・頂点をスケッチ平面へ投影（`P`）。投影した要素は固定され、元の立体が変わると追従します |
| Sketch Modify | Move、Copy、Trim、Extend、Offset、Mirror、Fillet、Chamfer、Break、Scale、Rectangular Pattern、Circular Pattern、Construction 切り替え |
| Constraints | Coincident、Horizontal、Vertical、Parallel、Perpendicular、Tangent、Equal、Concentric、Collinear、Midpoint、Fix、Symmetry |
| Dimensions | Distance、Horizontal / Vertical Distance、Angle、Radius、Diameter。値にはパラメータ式を入力できます |
| スナップ | 既存の点・中点・曲線へのスナップ。何もない場所では 1 mm 単位に吸着します（リボンの **Snap 1 mm** で切り替え、`Ctrl/Cmd` を押している間は無効） |
| 拘束状態 | Under-constrained（残り自由度を表示）/ Fully constrained / Over-constrained。過剰拘束になる操作は拒否します |
| Profile | 交点を含めて閉領域を自動検出し、クリックで選択（複数選択可） |
| 範囲選択 | スケッチの何もない場所からドラッグ。左から右は枠に完全に入ったものだけ（実線の枠）、右から左は枠に触れたものすべて（破線の枠）。`Shift` で追加 |
| Measure | `I`。点・線・円・面・Body を 1 つまたは 2 つ選ぶと、長さ、半径、直径、面積、体積、距離、角度を表示します。値はコピーできます。計測は保存されず、履歴にも残りません |
| Solid | Extrude（New Body / Join / Cut / Intersect、片側・反転・対称。スケッチの閉領域のほか、立体の平らな面もそのまま押し出せます。矢印をドラッグして距離を決められ、結果を半透明でプレビュー）、Revolve、Combine（Union / Cut / Intersect）、Fillet、Chamfer、Shell |
| Parameters | 名前付きパラメータ、単位（mm / cm / m / in / deg / rad）、式、他パラメータの参照、`sin cos tan asin acos atan atan2 sqrt abs min max floor ceil round pow` |
| Timeline | Feature History、ヒストリーマーカー、抑制（Alt + クリック）、ダブルクリックで編集 |
| 入出力 | STEP import / export、STL export、DXF import、スケッチの SVG / DXF 書き出し、プロジェクト保存・読み込み、IndexedDB への自動保存 |

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

### FABRICATION ワークスペース（3D Print）

スライサーに渡す前の準備をします。G-code は作りません。

| 分類 | 内容 |
| --- | --- |
| 向き | Body ごとに、どの向きを下にするかを選択。Auto はオーバーハングが最も少ない向き（同じなら接地面積が大きく、背が低い向き） |
| 配置 | ベッドの上に、間隔を空けて並べます |
| チェック | 造形範囲に収まるか、オーバーハング（サポートが必要な面を赤で表示）、接地面積、閉じた立体かどうか |
| 見積もり | 樹脂の体積、重さ、フィラメントの長さ、レイヤー数。体積と表面積からの概算です |
| 材料 | PLA、PETG、ABS、ASA、TPU |
| Export | 3MF（単位 mm と部品名を保持）、STL。ベッドに置いた向きと位置で書き出します |

## 使い方

Node.js 22 以降が必要です。

```sh
npm install
npm run dev
```

開発サーバーは http://127.0.0.1:5173/FabCAD/ で起動します。`/FabCAD/` が紹介ページ、`/FabCAD/app/` が CAD 本体です。

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

Fusion 360 に同じコマンドがあるものは、同じキーにしています。

| キー | スケッチ中 | 3D（スケッチの外） |
| --- | --- | --- |
| `L` | Line | 平面を選んで Line でスケッチ開始 |
| `R` | 2-Point Rectangle | 平面を選んで Rectangle でスケッチ開始 |
| `C` | Center Diameter Circle | 平面を選んで Circle でスケッチ開始 |
| `D` | Sketch Dimension | 平面を選んで Dimension でスケッチ開始 |
| `T` | Trim | 同上 |
| `O` | Offset | 同上 |
| `X` | Normal / Construction | — |
| `E` | スケッチを終了して Extrude | Extrude |
| `Q` | スケッチを終了して Extrude | Press Pull（稜線を選択中は Fillet、それ以外は Extrude） |
| `F` | Sketch Fillet | Fillet |
| `M` | Move | — |
| `I` | Measure | Measure |
| `V` | — | 選択した Body / Sketch の表示・非表示 |
| `S` | Fit Point Spline | Create Sketch |
| `P` | Project（立体の形状をスケッチ平面へ投影） | 平面を選んで Project でスケッチ開始 |
| `A` | 3-Point Arc（FabCAD 独自） | 平面を選んで Arc でスケッチ開始 |
| `F6` | 全体表示 | 全体表示 |
| `Esc` | 実行中のコマンドをキャンセル | 同左 |
| `Enter` | Polyline / Spline の終了 | ダイアログの確定 |
| `Delete` | 選択したオブジェクトを削除 | 同左 |
| `Ctrl/Cmd + Z`、`Ctrl/Cmd + Shift + Z` | Undo / Redo | 同左 |
| `Ctrl/Cmd + S`、`Ctrl/Cmd + O` | 保存 / 開く | 同左 |

3D で原点平面か平らな面を選んでから `L` `R` `C` などを押すと、その面ですぐにスケッチが始まります。立体の面にスケッチを作ると、その面の輪郭（穴を含む）が自動で投影されます。スケッチの原点は、ワールド原点をその面に下ろした位置です。

3D では、スケッチの線と閉領域を、その下にある面や原点平面より優先して選択できます。スケッチの線や閉領域をダブルクリックすると、そのスケッチの編集に入ります。

### スケッチの SVG / DXF 書き出し

スケッチを選択（または編集中に）して、右クリックメニューの **Export Sketch as SVG**、または右上の **Export → SVG — selected sketch** を選びます。単位は mm で、線・円弧・楕円・スプラインを近似せずに書き出します。Construction の線は含みません。

DXF は **Save As DXF**（右クリックメニュー）または **Export → DXF — selected sketch** です。どのソフトでも読めるように R12 形式で書き出します。線・円・円弧は `LINE` `CIRCLE` `ARC` としてそのまま、楕円とスプラインは誤差 0.01 mm 以内のポリラインになります。座標はスケッチの座標のままです。

Fusion 360 のショートカットのうち、対応するコマンドがないもの（`J` Joint、`A` Appearance、`1` `2` `3` の選択方法）は未実装です。

### テキスト

スケッチのリボンの **Text** を押し、文字を置く位置をクリックすると、ダイアログが開きます。入力した内容はその場でビューに反映されます。

| 項目 | 内容 |
| --- | --- |
| Text | 文字列。`Enter` で改行、`Ctrl/Cmd + Enter` で確定 |
| Font | 標準搭載の 8 書体、または読み込んだフォント |
| Height | 文字の高さ（フォントの em の高さ）。全角の漢字 1 文字の送り幅と同じです。大文字の高さはその 0.70〜0.82 倍です |
| Spacing / Line pitch | 字間（mm）と、行の送り（高さに対する倍率） |
| Angle | 反時計回りの角度 |
| Direction | Horizontal（横書き）/ Vertical（縦書き）。縦書きではフォントの縦書き用字形（`vert` / `vrt2`）を使います |
| Align | 配置点に対する左右・上下の揃え |
| Path | テキストを沿わせる線・円弧・円・スプライン。Offset（線からの距離）、Start（線に沿った開始位置）、Align、Flip（反対側・逆向き） |
| Construction | Profile を作らない補助用のテキスト |

Height、Spacing、Line pitch、Angle、Offset、Start にはパラメータ式を入力できます。

配置済みのテキストは、ダブルクリック、または右クリックの **Edit Text** で編集します。ドラッグすると配置点ごと動き、配置点には寸法や拘束を付けられます。

Extrude でテキストの文字をクリックすると、テキスト全体が Profile になります。あとで文字列やフォントを変えても、Extrude / Cut は新しい文字に追従します。彫り込むときは Operation を **Cut** にし、Direction を **Flipped** にします。

**Explode Text** はテキストを線とスプラインに変換します。変換後は文字列として編集できません。Undo 1 回でテキストに戻ります。

#### フォント

標準搭載のフォントは次の 8 書体で、すべて SIL Open Font License 1.1 です。

| フォント | 分類 |
| --- | --- |
| Zen Kaku Gothic New（既定） | ゴシック |
| Shippori Mincho | 明朝 |
| Zen Maru Gothic | 丸ゴシック |
| Dela Gothic One | デザイン |
| RocknRoll One | デザイン |
| Kaisei Decol | デザイン |
| Zen Kurenaido | 手書き |
| DotGothic16 | ドット |

フォントのファイルと OFL の本文は `apps/fabcad/public/fonts/` に、著作権表示と入手元の一覧は [`THIRD_PARTY_FONTS.md`](THIRD_PARTY_FONTS.md) にあります。フォントはテキストで最初に使うときに読み込みます（1 書体 2〜9 MB）。

Font の一覧の **Load a font file** から、手元の TTF / OTF / WOFF を読み込めます。WOFF2 と TTC（フォントコレクション）は読み込めません。

- 読み込んだフォントはブラウザの中だけで処理し、どこにも送信しません。
- フォントのファイルはプロジェクトに保存しません。プロジェクトに保存するのは、フォントの名前と ID、そのフォントで書いた文字の輪郭です。
- 読み込んだフォントは、ページを閉じると消えます。そのフォントを使ったプロジェクトを開くと「The font "…" is not available.」と表示します。テキストは保存時の輪郭のまま表示され、Extrude などもそのまま再計算できますが、同じフォントをもう一度読み込むまで編集できません。
- 読み込むフォントのライセンス（立体物への利用、商用利用など）は、利用者が確認してください。

### DXF の読み込み

**File → Import DXF…** で DXF（ASCII 形式）を選びます。スケッチの編集中ならそのスケッチへ、そうでなければ新しいスケッチ（選択中の原点平面、なければ XY）へ読み込みます。

| 項目 | 内容 |
| --- | --- |
| 対応する要素 | `LINE`、`CIRCLE`、`ARC`、`LWPOLYLINE`、`POLYLINE`（bulge の円弧を含む）、`ELLIPSE`、`SPLINE`、`POINT`、`INSERT`（ブロック。移動・回転・拡大縮小・反転・配列・入れ子） |
| 単位 | `$INSUNITS` の inch / mm / cm / m を mm に換算します。単位が書かれていないファイルは、mm か inch かを選びます |
| レイヤー | レイヤーごとに、読み込むかどうかと、Construction（補助線）にするかどうかを選べます |
| 端点 | 同じ位置の端点は 1 つの点にまとめます。閉じた輪郭はそのまま Profile になります |
| 拘束 | 付けません。読み込んだ図形は自由に動かせます |

制限:

- バイナリ形式の DXF、`TEXT` / `MTEXT`、`HATCH`、`DIMENSION`、`LEADER`、3D の要素（`3DFACE`、メッシュ）は読み込みません。読み込まなかった要素の種類と数はダイアログに表示します。
- 押し出し方向が Z 軸でない要素は読み込みません。Z 座標は無視します。
- 楕円弧は、誤差が長半径の約 0.02 % のスプラインになります。
- フィット点で定義された `SPLINE` は、点を通る曲線として読み込みます。AutoCAD の曲線と完全には一致しません。制御点で定義された 3 次・一様のスプラインはそのまま、それ以外は点列を通るスプラインに変換します。
- 線の色、線種、太さは読み込みません。
- 他のソフトが書き出した実際のファイルでの確認は、まだ十分ではありません。

### 右クリックメニュー

右クリック（スマートフォンでは長押し）で、カーソル位置の対象を選択してメニューを開きます。右ボタンを押したままドラッグするとオービットです。

| 状況 | メニューの内容 |
| --- | --- |
| コマンドの実行中 | OK、Cancel |
| 直前にコマンドを使った | Repeat（直前のコマンドをもう一度） |
| 稜線 | Fillet、Chamfer |
| 平らな面・原点平面 | Create Sketch、Shell |
| スケッチの閉領域・線 | Extrude、Revolve、Edit Sketch、Export Sketch as SVG、Save As DXF |
| スケッチ中のテキスト | Edit Text、Explode Text、Delete |
| Body | Show / Hide、Combine、Delete |
| タイムライン・ブラウザの項目 | Edit Feature / Edit Sketch、Suppress、Show / Hide、Delete |
| スケッチ中の線や円 | Normal / Construction、Move、Copy、Delete |
| スケッチ中の寸法 | Edit Dimension、Delete |
| スケッチ中 | Line、Rectangle、Circle、Dimension、Trim、Offset、Project、Finish Sketch |
| 常に | Undo、Redo |

Fusion 360 の円形のマーキングメニューではなく、一覧形式のメニューです。

| マウス | 内容 |
| --- | --- |
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
| 1 本指スワイプ | 3D ではオービット。スケッチでは、何もない場所なら移動、図形の上ならドラッグ |
| 2 本指スワイプ | 移動 |
| ピンチ | ズーム（指の動きと同じ倍率） |
| タップ | 選択。スケッチのツールでは点を置きます |
| 指を置いてからずらして離す | 離した位置に点を置きます（狙いを定められます） |
| 画面下の **Browser** / **Settings** | ブラウザとプロパティ、または Fabrication の設定を下から開きます |
| 画面下の **Cancel** / **Done** / **Delete** / **Finish** | `Esc`、`Enter`、`Delete`、スケッチ終了の代わり |
| 選択済みの寸法をもう一度タップ | 寸法値を編集 |
| 数値の入力欄 | 数字のキーボードが開きます。パラメータや式を入れるときは、欄の右の **abc** で文字のキーボードに切り替えます |

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
| `packages/sketch` | Sketch のデータモデル、Create / Modify ツール、Profile 検出、計測、テキスト（輪郭から Profile、Explode）、範囲選択 |
| `packages/typography` | 文字組み。フォントの読み込み、HarfBuzz によるシェーピング、横書き / 縦書き、パスに沿った配置、グリフの輪郭。CAD のドキュメントを知らない独立したモジュールです |
| `packages/sketch-solver` | 2D 拘束ソルバー（最小ノルム Levenberg–Marquardt）、自由度と冗長・矛盾の判定、ドラッグ。`SketchSolver` インターフェースで差し替え可能 |
| `packages/cad-document` | Document、Parameters と式、Feature 定義、依存グラフ、Command と Undo / Redo、保存形式 |
| `packages/assembly` | Component、Instance、Joint、Rigid Group のデータモデル |
| `packages/brep` | `GeometryKernel` インターフェースと Replicad アダプタ |
| `packages/features` | Feature Engine。Timeline を評価して Body を作り、入力のハッシュで Feature ごとにキャッシュします |
| `packages/fabrication-core` | 材料、Strategy、`fabricate()`、Analyzer、Kerf 補正、Nesting、Sheet |
| `packages/fabrication-laser` | Board と Paper の Strategy |
| `packages/fabrication-print` | 3D プリント。向き、オーバーハングの解析、見積もり、ベッドへの配置、STL / 3MF の書き出し |
| `packages/svg`、`packages/dxf` | 書き出し。`packages/dxf` は DXF の読み込み（解析とスケッチへの変換）も持ちます |
| `apps/fabcad` | React アプリ。Feature Engine と OpenCASCADE は Web Worker 内で動きます |

### 設計上の決まり

- **ユーザーの Sketch が正本です。** 長方形・星・多角形を特別扱いするコードはありません。長方形は 4 本の線と拘束です。
- **Fabrication は形状に依存しません。** 面・稜線・二面角だけから部品を作ります。プリズム以外の立体（角錐など）もテストしています。
- **Part Geometry と Joint Geometry を混ぜません。** `FlatPart.outline` と `FlatPart.joints` は別に保持し、最終的な `paths` で合成します。
- **接続は明示します。** 部品どうしの関係は `EdgeConnection` として立体のトポロジから作り、SVG 上の位置から推測しません。
- **寸法の式はソルバーの外で評価します。** ソルバーが受け取るのは数値だけです。
- **面と稜線は名前で参照します。** Fillet、Chamfer、Shell、Project、面の上のスケッチなどは、面や稜線を「どの Feature が、スケッチのどの線から作ったか」という名前で覚えます（例: `extrude-2:side(sketch-1/l5)`、稜線は隣り合う 2 つの面の名前）。再計算のあとは、名前 → 由来（同じ Feature・同じスケッチ要素）→ 形の特徴（面の種類、法線、面積など）→ 位置、の順で探します。位置だけで決めるのは最後の手段です。
- **テキストは文字列が正本です。** 保存するのは文字列と書式で、輪郭はそこから作る派生データです。輪郭はスケッチの中にキャッシュするので、Profile の検出、Feature Engine、書き出しは、フォントも文字組みも必要としません。Fabrication にテキスト専用の処理はありません。
- **ドキュメントは不変の値です。** すべての変更は Command を通り、Undo / Redo の対象になります。ドラッグは 1 つの履歴にまとまります。

### 曲面の扱い

OpenCASCADE のメッシュを B-Rep の面ごとにまとめ、平面は 1 枚のポリゴン、曲面は同一平面上の三角形をまとめた小さな平面（facet）の集まりとして `SolidTopology` にします。Board は曲面を切り出せないので警告を出し、Paper は facet を帯として展開します。

### Board の厚み補正

各面の外側の面を立体の面に合わせ、板厚は内側に取ります。稜線ごとに二面角 θ と板厚 t、面の内側へのずれ m から、面内でのオフセット量を求めます。Tab & Slot のスロットを閉じた穴にするため、タブ側のパネルは `slotEdgeMargin`（初期値 3 mm）だけ内側にずらします。0 にするとスロットは外周に開いた切り欠きになります。

## テスト

```sh
npm test
```

Vitest で 500 件以上のテストを実行します。OpenCASCADE を使うテストは Node 上で WASM を読み込みます。

| 対象 | 内容 |
| --- | --- |
| CAD Core | geometry、constraints、parameter evaluation、feature recompute、dependency graph、save / load |
| Topology | 面と稜線の名前。寸法を変えたあと、Cut のあと、保存と読み込みのあとで、Fillet / Chamfer / Shell / Project / 面の上のスケッチが同じ面・稜線を指すこと |
| Text | 標準搭載のフォントを実際に読み込み、横書き・縦書き・パスに沿った配置、Profile、Extrude / Cut、文字列の変更への追従、Explode、フォントがない場合を検証 |
| DXF | 各要素の読み込み、単位の換算、レイヤー、ブロック、書き出した DXF の読み戻し |
| Fabrication | rectangle / hexagon / star MDF、paper box、paper polygon、kerf compensation、tab / slot matching、SVG dimensions、角錐 |
| シナリオ | `apps/fabcad/test/scenarios.test.ts` が Sketch → Solver → Extrude → B-Rep → Fabrication → SVG を通しで検証 |

## GitHub Pages

`main` に push すると、GitHub Actions（`.github/workflows/pages.yml`）が型チェック・テスト・ビルドを実行し、`dist/` を Pages に公開します。リポジトリの **Settings → Pages → Source** は **GitHub Actions** にしてください。

Vite の `base` は `/FabCAD/` です。別のパスで公開する場合は環境変数で指定します。

```sh
FABCAD_BASE=/ npm run build
```

SPA ルーティングは使っていません。Vite のマルチページ構成で、`index.html`（紹介ページ）と `app/index.html`（CAD 本体）をビルドします。WebAssembly（約 23 MB、gzip で約 7 MB）は Vite がハッシュ付きのアセットとして出力し、Worker から相対 URL で読み込みます。

## 未実装・制限

| 項目 | 状態 |
| --- | --- |
| Project | 実装済み。楕円になる投影（斜めから見た円）はスプラインで近似します |
| Include / Intersect | 未実装 |
| Assembly | データモデルのみ。Component や Joint を操作する UI はありません |
| Sweep、Loft、Draft、Rib、Hole、Thread、Split Body | 未実装 |
| IGES | 未実装 |
| 面・稜線の参照 | 名前で照合します（「設計上の決まり」を参照）。1 つのスケッチ要素から複数の面ができた場合（Cut で面が 2 つに分かれたなど）は、番号で区別します。分かれ方が変わると、番号が入れ替わることがあります。STEP で読み込んだ立体の面は、面の順番で名前を付けます |
| テキスト | 右から左へ書く文字と、向きの混ざった文章には対応していません。フォントにない文字は空白になり、別のフォントでは補いません。縦書きの中の欧文は、フォントが回転した字形を持つ場合だけ横倒しになります（縦中横はありません）。輪郭どうしが重なるフォントは、重なりをまとめずにそのまま Profile にします。バリアブルフォントは既定のスタイルだけを使います。テキストは拘束・寸法・Trim などの対象ではありません（配置点を除く）。文字列にパラメータを埋め込むことはできません |
| Explode Text | 文字数が多いと、点と曲線が数千個になり、スケッチの操作が重くなります |
| Ellipse と Spline | 拘束と寸法、Trim / Extend / Offset の対象外です（切る側としては使えます） |
| 角度寸法 | 1 本目の線から 2 本目の線へ反時計回りに測ります |
| Nesting | 外接矩形による row / shelf packing のみ |
| 3D プリント | スライス（G-code の生成）はしません。見積もりは概算で、サポート材は含みません。実機での造形は未検証です |
| 凹角 | Board のパネルは線で接するだけで、内側に隙間が残ります（警告を出します） |
| 範囲選択 | スケッチの中だけです。3D の面・稜線・Body の範囲選択はありません（3D の左ドラッグはオービットです）。タッチ操作では使えません |
| Measure | 2 つの選択の距離は、直線どうし・平面どうしが平行なら垂直距離、それ以外は最短距離です。曲面の半径、Body どうしの最短距離、干渉チェックはありません |
| スマートフォン | Chrome のスマートフォン表示とタッチ入力のエミュレーションで確認しました。実機では未検証です |
| 実機での加工 | 未検証です。kerf と fit offset は材料と加工機に合わせて調整してください |

## ライセンスについて

幾何カーネルの OpenCASCADE と Replicad は LGPL-2.1 です。

文字組みには opentype.js（MIT）と HarfBuzz（harfbuzzjs、MIT）を使っています。

標準搭載のフォントは SIL Open Font License 1.1 です。フォントは変更せずに同梱しています。書体ごとの著作権表示、入手元、ライセンス本文の場所は [`THIRD_PARTY_FONTS.md`](THIRD_PARTY_FONTS.md) にあります。
