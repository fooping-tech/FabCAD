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
| スナップ | 既存の点・中点・曲線へのスナップ。ほかの点の真上・真下・真横に来ると、その点と X または Y がそろう位置に吸着し、破線のガイドを表示します（**Snap H/V**）。点を置くときも、点をドラッグするときも働きます。何もない場所では 1 mm 単位に吸着します（**Snap 1 mm**）。どちらもリボンの Options で切り替えられ、`Ctrl/Cmd` を押している間は無効です |
| 拘束状態 | Under-constrained（残り自由度を表示）/ Fully constrained / Over-constrained。過剰拘束になる操作は拒否します |
| Profile | 交点を含めて閉領域を自動検出し、クリックで選択（複数選択可） |
| 範囲選択 | スケッチの何もない場所からドラッグ。左から右は枠に完全に入ったものだけ（実線の枠）、右から左は枠に触れたものすべて（破線の枠）。`Shift` で追加 |
| Measure | `I`。点・線・円・面・Body を 1 つまたは 2 つ選ぶと、長さ、半径、直径、面積、体積、距離、角度を表示します。値はコピーできます。計測は保存されず、履歴にも残りません |
| Solid | Extrude（New Body / Join / Cut / Intersect、片側・反転・対称。Cut / Intersect を選ぶと向きは自動で立体の側に、Join / New Body に戻すと立体の外側に切り替わります。自分で向きを選んだあとは変えません。スケッチの閉領域のほか、立体の平らな面もそのまま押し出せます。矢印をドラッグして距離を決められ、結果を半透明でプレビュー）、Revolve、Sweep（プロファイルを、線・円弧・スプラインをつないだパスに沿って掃引）、Loft（2 つ以上の断面をつなぐ。断面はスケッチの閉領域または平らな面）、Combine（Union / Cut / Intersect）、Fillet、Chamfer、Shell |
| Hole | `H`。スケッチの点に穴をあけます。1 つの Feature に複数の点を指定できます。Simple / Counterbore / Countersink、Distance / Through All、Flip |
| Pattern / Mirror | Rectangular Pattern（1 方向または 2 方向）、Circular Pattern、Mirror。対象は Feature（Extrude、Revolve、Hole、Sweep、Loft）または Body。個数・間隔・角度を持つ 1 つの Feature として保存し、コピーの集まりにはしません |
| Move / Align / Split | Move/Copy（`M`。自由移動（X・Y・Z の移動と回転）、移動、回転、点から点、コピー。移動後の形を半透明でプレビューし、矢印とリングのドラッグで位置と角度を調整）、Align（面と面、点と点）、Split Body（原点平面、構成平面、または平らな面（分割する Body 自身の面も可）で分割。両側 / 片側を残す） |
| Offset Plane | 原点平面・平らな面・ほかの構成平面から、指定した距離だけ離れた平行な構成平面を作ります。距離は正負どちらも指定でき、パラメータ式も使えます。確定する前にビューでプレビューします。タイムラインに残る Feature で、あとから距離と基準を変えられます。スケッチ平面、Mirror の平面、Split Body の平面、別の Offset Plane の基準として使えます |
| Component | 部品の定義（Component）と、それを配置したインスタンス。リボンの Assemble の **New Component**（ブラウザでドキュメントやコンポーネントを右クリックしても可）で、名前・選択した Body を入れるか・アクティブにするかを決めて作ります。Body を選んで作る（Body の右クリックメニューの **Create Component** でも可。ルートの Body でも、ほかのコンポーネントの Body でもよい）と、その Body を変える履歴（とそれが使うスケッチ）ごと新しいコンポーネントに移り（ほかの Body の面に描いたスケッチや投影は参照だけなので、結び付きません。選択していない Body も変える操作があるときは、何も移さずにその操作を知らせます）（コンポーネントから取り出した Body は、元のコンポーネントのインスタンスと同じ位置に置くので、見た目は変わりません）、何も選ばずに作ると空のコンポーネントがアクティブになり、そのあと作るスケッチと Feature はそのコンポーネントに属します。既にあるコンポーネントへは、ブラウザで Body をそのコンポーネントにドラッグ & ドロップして移せます（ドキュメントにドロップするとルートへ戻ります。配置が違うときは、見えている位置を保つ Move を 1 つ追加します）。**Instance** で同じ定義をもう 1 つ配置し、インスタンスごとに位置と回転（Move / Rotate、`M`）と表示を変えられます。インスタンスは定義を参照するだけで履歴をコピーしないので、定義を編集するとすべてのインスタンスに反映されます。コンポーネントをアクティブにする（ブラウザでダブルクリック）と、その定義を定義の座標で表示して編集します。ほかの部分は Fusion と同じように半透明で表示され、その平らな面や構成平面にスケッチを作ったり、Project で稜線や面を投影したりできます（インスタンスを動かすと、スケッチも投影も追従します）。異なるコンポーネントの Body どうしの Combine などは受け付けません |
| 複数選択 | `Shift` / `Ctrl` / `Cmd` + クリックで追加・解除。リボンまたは画面下の **Multi-Select** をオンにすると、修飾キーなしのクリック（タップ）で追加・解除できます。稜線・面・Body・スケッチの要素・ブラウザとタイムラインの項目に共通です |
| ヘルプ | ツールのアイコンを右クリック（タッチでは長押し）すると、短い説明が出ます。**Details · 詳しく見る** で、用途、必要な選択、パラメータ、制限、使用例を表示します。説明は英語と日本語の併記です。ヘルプを開いても、実行中のコマンドと選択は変わりません |
| Parameters | 名前付きパラメータ、単位（mm / cm / m / in / deg / rad）、式、他パラメータの参照、`sin cos tan asin acos atan atan2 sqrt abs min max floor ceil round pow` |
| Timeline | Feature History、ヒストリーマーカー、抑制（Alt + クリック）、ダブルクリックで編集 |
| 入出力 | STEP import / export、STL export（書き出す Body とコンポーネントを選べます。コンポーネントはインスタンスの位置ごと、または原点に 1 つ）、DXF import、スケッチの SVG / DXF 書き出し、プロジェクト保存・読み込み、IndexedDB への自動保存 |

### FABRICATION ワークスペース（Laser）

| 分類 | 内容 |
| --- | --- |
| Material | MDF、Acrylic、Cardboard、Paper。厚み・kerf・fit offset を編集でき、独自の材料も追加できます |
| Board（MDF / Acrylic / Cardboard） | まず Body を判定します。**Flat Part**（板厚と同じ厚みの 2D 形状。穴も可）は輪郭のまま 1 部品、**Rectangular Box**（直方体）は 6 枚のパネル → Joint → Thickness Compensation → Kerf Compensation。Joint は Tab & Slot / Finger / Flat。それ以外の立体は Unsupported として理由を表示し、カットデータを作りません |
| Paper（2 方向に曲がった面） | **Double curvature** で選びます。**Stop**（既定）は作らずに理由を表示。**Gores** は、地球儀のように細い帯（舟形）に分けて近似します。**Gores** の数（1 周あたり、6〜72、既定 12）で丸さと帯の幅が決まり、Body の丸い面はすべてこの数で分割します。舟形は 1 本おきに面の反対側の端（上面のまわりなど）につながり、隣との間にのりしろを置く場所を空けます |
| Paper | Unfold → Connected Net → Fold Line → 切り離した辺の継ぎ方。**Glue**（のりしろ。幅・角度・インセット）と **Tab & Slit**（タブを相手側の切り込みに差し込む。糊は不要）を選べます。Tab & Slit では、相手側に内側へ折り込むフラップが付き、その折り線（立体の稜線の位置）に切り込みが入ります。タブも内側に折って差し込むので、組み立てると継ぎ手は外から見えません。タブは立体を閉じる面（角柱の蓋など、切り離された辺の多い面）に付き、フラップと切り込みはそのまわりの面に付きます。まわりのフラップを内側に折ってから蓋を押し込むと、タブが切り込みを通って内側に入ります。タブの幅・深さ・間隔、フラップの高さ、首の長さ、ロック（タブの肩が切り込みより広い量）、クリアランスを指定できます。長い辺には複数のタブが付き、短すぎる辺はのりしろになります。展開図の切れ込みの中（蓋が側面につながる辺の隣など）では、のりしろ・フラップの側辺を切れ込みの角度に合わせ、タブは小さくして角から離れた位置に置きます |
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
| Export | 3MF（単位 mm と部品名を保持）、STL。ベッドに置いた向きと位置で書き出します。Export メニューから書き出すときは、印刷する Body とコンポーネントを窓で選べます |
| コンポーネント | コンポーネントの Body は、表示中のインスタンスの数だけ（または 1 つだけ）印刷します |

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

1. **Create Sketch** を押し、原点平面、構成平面、または平らな面を選びます。
2. Create ツールで形を描き、Constraints と Dimension（`D`）で形状を決めます。
3. **Finish Sketch** で 3D に戻り、**Extrude**（`E`）でプロファイルをクリックして押し出します。
4. 上部で **FABRICATION** に切り替え、材料を選びます。
5. **Parts** と **Sheet** で結果を確認し、**Export SVG** を押します。

### AI エージェントで操作する

画面を見てマウスとキーボードで操作する AI エージェント（computer use）に、作図を頼めます。

- **エージェント向けガイド**：[`/FabCAD/llms.txt`](https://fooping-tech.github.io/FabCAD/llms.txt)（Markdown）と [`/FabCAD/agents/`](https://fooping-tech.github.io/FabCAD/agents/)（HTML）。画面の配置、状態の読み取り方、手順、全ツールの説明。ツールの説明はアプリ内ヘルプから生成しています。
- **座標の入力**：スケッチの Create ツールの実行中に数字を打つと、`x, y`、`@dx, dy`、`@長さ<角度` で点を置けます。
- **コマンドパレット**：Ctrl / Cmd + K（ヘッダーの Commands）でコマンド名を入力して実行します。
- **作業の記録**：タイムラインの左端のボタンで、各ステップの成否と Body の体積を画面に表示します。Copy でプロジェクトも含めてコピーします。

指示を出すときは、どのブラウザで作業するか（エージェント自身の環境の中のブラウザか、自分のパソコンのブラウザか）を指定し、作業の前にガイドを読ませ、寸法と基準（どの平面、どこが原点か）を数値で伝え、最後に作業の記録で結果を確かめさせます。指示文の例は紹介ページの「For AI agents」にあります。

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
| `M` | Move（スケッチの図形） | Move/Copy（Body） |
| `H` | スケッチを終了して Hole | Hole |
| `I` | Measure | Measure |
| `V` | — | 選択した Body / Sketch / 構成平面の表示・非表示 |
| `S` | Fit Point Spline | Create Sketch |
| `P` | Project（立体の形状をスケッチ平面へ投影） | 平面を選んで Project でスケッチ開始 |
| `A` | 3-Point Arc（FabCAD 独自） | 平面を選んで Arc でスケッチ開始 |
| `F6` | 全体表示 | 全体表示 |
| `Esc` | 実行中のコマンドをキャンセル | 同左 |
| `Enter` | Polyline / Spline の終了 | ダイアログの確定 |
| `Delete` | 選択したオブジェクトを削除 | 同左 |
| `Ctrl/Cmd + Z`、`Ctrl/Cmd + Shift + Z` | Undo / Redo | 同左 |
| `Ctrl/Cmd + S`、`Ctrl/Cmd + O` | 保存 / 開く | 同左 |

3D で原点平面か平らな面を選んでから `L` `R` `C` などを押すと、その面ですぐにスケッチが始まります。立体の面にスケッチを作ると、その面の輪郭（穴を含む）が自動で投影されます。投影した輪郭は、描いた図形が囲む領域を分割しません（輪郭をまたいで描いた閉じた形は 1 つの Profile のままです）。スケッチの原点は、ワールド原点をその面に下ろした位置です。

3D では、スケッチの線と閉領域を、その下にある面や原点平面より優先して選択できます。スケッチの線や閉領域をダブルクリックすると、そのスケッチの編集に入ります。

### スケッチの SVG / DXF 書き出し

スケッチを選択（または編集中に）して、右クリックメニューの **Export Sketch as SVG**、または右上の **Export → SVG — selected sketch** を選びます。単位は mm で、線・円弧・楕円・スプラインを近似せずに書き出します。Construction の線は含みません。

DXF は **Save As DXF**（右クリックメニュー）または **Export → DXF — selected sketch** です。どのソフトでも読めるように R12 形式で書き出します。線・円・円弧は `LINE` `CIRCLE` `ARC` としてそのまま、楕円とスプラインは誤差 0.01 mm 以内のポリラインになります。座標はスケッチの座標のままです。

Fusion 360 のショートカットのうち、対応するコマンドがないもの（`J` Joint、`A` Appearance、`1` `2` `3` の選択方法）は未実装です。

### Hole、Pattern、Mirror などの選び方

ダイアログの入力欄をクリックすると、その欄が選択の対象になり、ビューでクリックしたものが入ります。もう一度クリックすると外れます。コマンドを始める前に選択しておいたものは、最初から入ります。

| コマンド | 選ぶもの |
| --- | --- |
| Hole | スケッチの点（複数可）と、穴をあける Body。先に点を描いたスケッチを用意します |
| Pattern、Mirror の対象 | Feature はタイムラインかブラウザで、またはその Feature が作った面をクリックして選びます。Body はビューかブラウザで選びます |
| 方向・軸 | X / Y / Z のボタン、直線の稜線、スケッチの線。Circular Pattern と回転では円形の稜線も選べます（その中心軸） |
| 平面 | XY / XZ / YZ のボタン、平らな面、または構成平面（ビュー、ブラウザ、タイムラインで選べます） |
| Sweep のパス | スケッチの曲線を 1 つクリックすると、つながっている曲線がまとめて入ります。`Shift` + クリックで 1 本ずつ外せます |
| Loft の断面 | クリックした順に並びます。一覧で順番の入れ替えと削除ができます |

個数、間隔、角度、直径、深さなどには、パラメータ式を入力できます。作成後は、タイムラインのダブルクリックか **Edit Feature** で同じダイアログが開きます。

Pattern、Mirror、Copy、Split でできた Body は、ブラウザに「Body001 (Mirror001)」のような名前で並び、ほかの Body と同じように選択、表示切り替え、書き出しができます。

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

Extrude でテキストの文字をクリックすると、テキスト全体が Profile になります。あとで文字列やフォントを変えても、Extrude / Cut は新しい文字に追従します。彫り込むときは Operation を **Cut** にします。

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

右クリック（タッチではダブルタップ）で、カーソル位置の対象を選択してメニューを開きます。右ボタンを押したままドラッグするとオービットです。メニューは、画面の端や下の近くで開いても、見えている範囲に収まる位置に出ます。

ツールのアイコンの右クリック（タッチでは長押し）は、そのツールのヘルプです。

| 状況 | メニューの内容 |
| --- | --- |
| コマンドの実行中 | OK、Cancel |
| 直前にコマンドを使った | Repeat（直前のコマンドをもう一度） |
| 稜線 | Fillet、Chamfer |
| 平らな面・原点平面 | Create Sketch、Offset Plane、Shell、Align |
| 構成平面 | Create Sketch、Edit Plane、Offset Plane、Show / Hide、Delete |
| スケッチの点 | Hole |
| スケッチの閉領域・線 | Extrude、Revolve、Edit Sketch、Export Sketch as SVG、Save As DXF |
| スケッチ中のテキスト | Edit Text、Explode Text、Delete |
| Body | Move/Copy、Create Component、Split Body、Mirror、Rectangular / Circular Pattern、Show / Hide、Combine、Delete |
| タイムライン・ブラウザの項目 | Edit Feature / Edit Sketch、Suppress、Show / Hide、Delete |
| ドキュメント（ブラウザの一番上） | New Component、Activate Root |
| コンポーネント（ブラウザ） | Activate Component / Activate Root、Create Instance、New Component、Rename、Show / Hide（すべてのインスタンス）、Delete |
| インスタンス | Move / Rotate、Activate Component、Duplicate、Show / Hide、Rename、Delete |
| スケッチ中の線や円 | Normal / Construction、Move、Copy、Delete |
| スケッチ中の寸法 | Edit Dimension、Delete |
| スケッチ中 | Line、Rectangle、Circle、Dimension、Trim、Offset、Project、Finish Sketch |
| 常に | Undo、Redo |

Fusion 360 の円形のマーキングメニューではなく、一覧形式のメニューです。

| マウス | 内容 |
| --- | --- |
| ホイール | ズーム |
| 中ボタンドラッグ | パン |
| トラックパッドの 2 本指スワイプ | パン（上下左右に移動。指の動きに表示が付いてきます） |
| トラックパッドのピンチ | ズーム。指の間の点を中心に、指の動きにそのまま追従します（Chrome / Edge / Safari） |
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
| ダブルタップ | コンテキストメニュー（マウスの右クリックと同じ内容）。スケッチのツールを実行中は開きません（画面下の **Cancel** / **Done** を使います） |
| ツールのアイコンを長押し | そのツールのヘルプ |
| 画面下の **Multi** | 複数選択のオン / オフ。オンの間は、タップするたびに選択に追加・解除します。**Clear** で選択を空にします |
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
| `packages/assembly` | Component、Instance（位置と回転の四元数）、Joint、Rigid Group のデータモデル |
| `packages/brep` | `GeometryKernel` インターフェースと Replicad アダプタ |
| `packages/features` | Feature Engine。Timeline を評価して Body を作り、入力のハッシュで Feature ごとにキャッシュします |
| `packages/fabrication-core` | 材料、Strategy、`fabricate()`、Analyzer、Kerf 補正、Nesting、Sheet |
| `packages/fabrication-laser` | Board と Paper の Strategy |
| `packages/fabrication-print` | 3D プリント。向き、オーバーハングの解析、見積もり、ベッドへの配置、STL / 3MF の書き出し |
| `packages/svg`、`packages/dxf` | 書き出し。`packages/dxf` は DXF の読み込み（解析とスケッチへの変換）も持ちます |
| `apps/fabcad` | React アプリ。Feature Engine と OpenCASCADE は Web Worker 内で動きます |

### 設計上の決まり

- **ユーザーの Sketch が正本です。** 長方形・星・多角形を特別扱いするコードはありません。長方形は 4 本の線と拘束です。
- **Fabrication は形状の名前に依存しません。** 面・稜線・二面角だけから判定し、部品を作ります。Board は Flat Part と Rectangular Box だけを作り、角柱・角錐・斜めの接合を含む立体は Unsupported として止めます。Paper は多面体と、円柱・円錐のように平らに広げられる曲面を展開し、2 方向に曲がった面は Unsupported として止めます。
- **Part Geometry と Joint Geometry を混ぜません。** `FlatPart.outline` と `FlatPart.joints` は別に保持し、最終的な `paths` で合成します。
- **接続は明示します。** 部品どうしの関係は `EdgeConnection` として立体のトポロジから作り、SVG 上の位置から推測しません。
- **寸法の式はソルバーの外で評価します。** ソルバーが受け取るのは数値だけです。
- **面と稜線は名前で参照します。** Fillet、Chamfer、Shell、Project、面の上のスケッチなどは、面や稜線を「どの Feature が、スケッチのどの線から作ったか」という名前で覚えます（例: `extrude-2:side(sketch-1/l5)`、稜線は隣り合う 2 つの面の名前）。再計算のあとは、名前 → 由来（同じ Feature・同じスケッチ要素）→ 形の特徴（面の種類、法線、面積など）→ 位置、の順で探します。位置だけで決めるのは最後の手段です。
- **テキストは文字列が正本です。** 保存するのは文字列と書式で、輪郭はそこから作る派生データです。輪郭はスケッチの中にキャッシュするので、Profile の検出、Feature Engine、書き出しは、フォントも文字組みも必要としません。Fabrication にテキスト専用の処理はありません。
- **ドキュメントは不変の値です。** すべての変更は Command を通り、Undo / Redo の対象になります。ドラッグは 1 つの履歴にまとまります。

### 曲面の扱い

OpenCASCADE のメッシュを B-Rep の面ごとにまとめ、平面は 1 枚のポリゴン、曲面は同一平面上の三角形をまとめた小さな平面（facet）の集まりとして `SolidTopology` にします。Board は曲面を板で作れないので Unsupported にします（円板や丸穴のある板のように、曲面が板の側面であるものは Flat Part です）。Paper は facet を帯として展開します。ただし、曲面の内側の頂点で facet の角の合計が 360° にならない（平らに広げられない）頂点が複数ある面は、2 方向に曲がった面と判定し、展開しません（`packages/fabrication-laser/src/paperClassifier.ts`）。頂点が 1 つだけの場合は円錐の先端です。Gores を選んだ場合は、面の境界から数えた段（level）ごとに facet を 1 つ前の段の facet へ折りでつなぎ、それ以外の辺を切ります（`planGores()`）。舟形の幅は Body の分割の粗さで決まるので、アプリは舟形の数に合わせた粗さの `SolidTopology` を幾何カーネルに要求します（`goreTessellation()`）。

### Board の厚み補正

Rectangular Box と判定した Body にだけ適用します。各面の外側の面を立体の面に合わせ、板厚は内側に取ります。稜線ごとに二面角 θ と板厚 t、面の内側へのずれ m から、面内でのオフセット量を求めます。Tab & Slot のスロットを閉じた穴にするため、タブ側のパネルは `slotEdgeMargin`（初期値 3 mm）だけ内側にずらします。0 にするとスロットは外周に開いた切り欠きになります。

## テスト

```sh
npm test
```

Vitest で 600 件以上のテストを実行します。OpenCASCADE を使うテストは Node 上で WASM を読み込みます。

| 対象 | 内容 |
| --- | --- |
| CAD Core | geometry、constraints、parameter evaluation、feature recompute、dependency graph、save / load |
| Topology | 面と稜線の名前。寸法を変えたあと、Cut のあと、保存と読み込みのあとで、Fillet / Chamfer / Shell / Project / 面の上のスケッチが同じ面・稜線を指すこと |
| Text | 標準搭載のフォントを実際に読み込み、横書き・縦書き・パスに沿った配置、Profile、Extrude / Cut、文字列の変更への追従、Explode、フォントがない場合を検証 |
| Solid Features | Hole、Pattern、Mirror、Move、Align、Split、Sweep、Loft を OpenCASCADE で実行し、体積を計算値と比較。個数や間隔を変えたあとの面の名前、依存グラフ、Undo / Redo、保存と読み込み |
| Offset Plane | 正負の距離、面・平面からの連鎖、パラメータへの追従、平面の上のスケッチと立体の追従、Mirror / Split での利用、Undo / Redo、保存と読み込み |
| UI の部品 | メニューの位置（画面の下端・右端、狭い画面、キーボードで狭くなった範囲）、ダブルタップと長押しの判定、ヘルプがすべてのツールにあること |
| DXF | 各要素の読み込み、単位の換算、レイヤー、ブロック、書き出した DXF の読み戻し |
| Fabrication（紙の継ぎ方） | Tab & Slit のタブと切り込みの数と位置が両側で一致すること、切り込みが稜線の位置（フラップの折り線）にあること、フラップが切り込み以外でつながっていること、タブとフラップが展開図やほかのタブと重ならないこと、短い辺でのりしろに切り替わること |
| Fabrication | Board の判定（Flat Part / Rectangular Box / Unsupported）、rectangle box MDF、paper box、paper polygon、kerf compensation、tab / slot matching、SVG dimensions |
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
| Component | 入れ子のコンポーネント、インスタンスごとのパラメータ、Joint（拘束と動き）、BOM はありません。Feature は 1 つのコンポーネントの中だけで働き、異なるコンポーネントの Body を Combine、Join / Cut、Move/Copy、Pattern することはできません（ダイアログで拒否します）。FABRICATION の Laser は、コンポーネントの Body を定義の位置で 1 つずつ扱い、インスタンスの数はまだ反映しません（3D Print はインスタンスの数だけ印刷し、STEP / STL の書き出しはインスタンスごとに配置して書けます） |
| Draft、Rib、Thread | 未実装 |
| Hole | ねじ穴、下穴、先端の円錐（ドリル形状）、「指定した面まで」はありません。穴が何も削らない向きのときはエラーになります（Flip で反転） |
| Pattern / Mirror | Feature を対象にできるのは、材料を足すか削る Feature（Extrude、Revolve、Hole、Sweep、Loft、Pattern）だけです。Fillet、Chamfer、Shell は対象にできません（Body を対象にしてください）。パスに沿った Pattern はありません |
| Sweep | パスは 1 つのスケッチ上の、線・円弧・円・スプラインです。楕円はパスにできません。ねじり、ガイドレールはありません。閉じたパスは未検証です |
| Loft | 穴のある断面、平らでない面、ガイドレールには対応していません |
| Align | 平らな面どうし、または点どうしだけです |
| Split Body | 分割に使えるのは平面（原点平面、構成平面、平らな面）だけです。曲面やスケッチの線では分割できません |
| 構成平面 | 平行にずらした平面（Offset Plane）だけです。角度を付けた平面、3 点を通る平面、曲面に接する平面はありません。Pattern / Mirror の対象にはできません |
| スナップ（水平・垂直） | 対象はスケッチの点と、実行中のコマンドで置いた点です。線の延長や曲線の接線方向には合わせません。点が多いスケッチでは吸着する場所が増えるので、邪魔なときは **Snap H/V** をオフにします |
| 面の上のスケッチと Move | 面の上のスケッチは、面が法線方向に動いたときと傾いたときに追従します。面の中での平行移動と、法線まわりの回転には追従しません |
| IGES | 未実装 |
| 面・稜線の参照 | 名前で照合します（「設計上の決まり」を参照）。1 つのスケッチ要素から複数の面ができた場合（Cut で面が 2 つに分かれたなど）は、番号で区別します。分かれ方が変わると、番号が入れ替わることがあります。STEP で読み込んだ立体の面は、面の順番で名前を付けます |
| テキスト | 右から左へ書く文字と、向きの混ざった文章には対応していません。フォントにない文字は空白になり、別のフォントでは補いません。縦書きの中の欧文は、フォントが回転した字形を持つ場合だけ横倒しになります（縦中横はありません）。輪郭どうしが重なるフォントは、重なりをまとめずにそのまま Profile にします。バリアブルフォントは既定のスタイルだけを使います。テキストは拘束・寸法・Trim などの対象ではありません（配置点を除く）。文字列にパラメータを埋め込むことはできません |
| Explode Text | 文字数が多いと、点と曲線が数千個になり、スケッチの操作が重くなります |
| Ellipse と Spline | 拘束と寸法、Trim / Extend / Offset の対象外です（切る側としては使えます） |
| 角度寸法 | 1 本目の線から 2 本目の線へ反時計回りに測ります |
| Nesting | 外接矩形による row / shelf packing のみ |
| 紙で展開できる面 | 平らな面、円柱、円錐です。2 方向に曲がった面（球、トーラス、円形の稜線の Fillet など）を持つ Body は、既定では Unsupported として理由を表示し、カットデータを作りません。**Unfold curved facets** をオフにすると、平らな面だけを切り出せます |
| 舟形（Gores） | 近似です。帯は幅の方向に平らなので、丸い部分は多面体になります。舟形の数は幾何カーネルの分割に任せているため、指定した数から 1〜2 ずれることがあり、小さい半径では三角形の面が混ざることがあります。球は、舟形を 1 段の面で横につないだ扇形の展開図になり、つないだ付近ではのりしろを置けない辺が出ます。部分的にしか回っていない面や、穴のあいた面での動作は未検証です。実際の紙での組み立ても未検証です |
| 紙の Tab & Slit | 切り込みは幅のない 1 本の切り線で、実際の幅はレーザーの切り幅です。厚い紙では Clearance を増やしてください。実際の紙での組み立ては未検証です |
| 3D プリント | スライス（G-code の生成）はしません。見積もりは概算で、サポート材は含みません。実機での造形は未検証です |
| Board の対象 | Flat Part と Rectangular Box だけです。角柱、角錐、屋根、斜めの接合、曲面のある立体は Unsupported です。Case / Enclosure の専用ジェネレーターは未実装です |
| 範囲選択 | スケッチの中だけです。3D の面・稜線・Body の範囲選択はありません（3D の左ドラッグはオービットです）。タッチ操作では使えません |
| Measure | 2 つの選択の距離は、直線どうし・平面どうしが平行なら垂直距離、それ以外は最短距離です。曲面の半径、Body どうしの最短距離、干渉チェックはありません |
| スマートフォン | Chrome のスマートフォン表示とタッチ入力のエミュレーションで確認しました。実機では未検証です |
| 実機での加工 | 未検証です。kerf と fit offset は材料と加工機に合わせて調整してください |

## ライセンスについて

幾何カーネルの OpenCASCADE と Replicad は LGPL-2.1 です。

文字組みには opentype.js（MIT）と HarfBuzz（harfbuzzjs、MIT）を使っています。

標準搭載のフォントは SIL Open Font License 1.1 です。フォントは変更せずに同梱しています。書体ごとの著作権表示、入手元、ライセンス本文の場所は [`THIRD_PARTY_FONTS.md`](THIRD_PARTY_FONTS.md) にあります。
