import type { HelpEntry } from "./types";

/**
 * Japanese text of the help registry, shown next to the English text of `content.ts`.
 *
 * Every entry here mirrors the entry of the same id in `content.ts`: the same fields, lists of
 * the same length in the same order, the same parameter names. Titles, and the names of tools,
 * fields and buttons inside the text, are written as they appear on screen (English), so that
 * they can be found there. `apps/fabcad/test/help.test.ts` checks that the two agree.
 */

const SNAP_NOTE =
  "位置は、既存の点・中点・中心・曲線にスナップします。ほかの点の真上・真下・真横ではその点にそろい、" +
  "それ以外は Snap 1 mm がオンなら 1 mm 単位になります。Ctrl / Cmd を押している間は自由に置けます。";

const SELECT_FIRST = "先に対象を選択してから、ツールを開始します。";

const OPERATION = {
  name: "Operation",
  text:
    "New Body は新しい Body を作ります。Join は対象の Body に足し、Cut は対象から削り、" +
    "Intersect は対象と新しい立体の共通部分だけを残します。",
};

const EXPRESSIONS = "値はすべて式で入力できます。数値、パラメータ名、width / 2 + 3 のような計算式です。";

export const HELP_JA: Record<string, HelpEntry> = {
  // ------------------------------------------------------------------ general
  select: {
    title: "Select",
    shortcut: "Esc",
    summary: "選択、ドラッグ、編集をします。どのツールからも Esc で戻ります。",
    what: [
      "クリックで、ポインタの下にあるものを選択します。Shift、Ctrl、Cmd を押しながらクリックすると、選択に追加または解除します。",
      "スケッチでは、点や曲線をドラッグして、拘束が許す範囲で動かせます。何もない場所からドラッグすると範囲選択です。左から右は枠に完全に入ったもの、右から左は枠に触れたものを選択します。",
      "寸法をダブルクリックすると値を編集します。3D でスケッチの図形をダブルクリックすると、そのスケッチの編集に入ります。",
    ],
    when: ["ほかのコマンドを実行していないときの、エディタの基本の状態です。"],
    examples: [
      "右クリック（タッチではダブルタップ）で、選択に合ったコマンドが出ます。",
      "コマンドの窓（Extrude、Offset、Fillet など）は、クリックした位置のすぐ横に開きます。邪魔なときはタイトルバーをドラッグして動かせます。動かした窓は、このセッションの間はその位置に開きます。タイトルバーをダブルクリックすると、クリックした位置の横に戻ります。",
    ],
  },
  "selection.multi": {
    title: "Multi-Select",
    summary: "クリックやタップのたびに、選択に追加または解除します。Shift を押し続けるのと同じです。",
    what: [
      "Multi-Select がオンの間は、何かを選択しても、それまでの選択は外れません。選択済みのものをもう一度選ぶと、選択から外れます。",
      "選択できるものすべてに働きます。稜線、面、Body、スケッチの要素、ブラウザとタイムラインの項目です。",
    ],
    when: [
      "Shift キーのないスマートフォンやタブレットで。",
      "マウスでも、たくさんのものを順番に選ぶときに。",
    ],
    examples: [
      "Multi-Select をオンにして稜線を 4 本タップし、Fillet を開始すると、1 つの Feature で 4 本とも丸めます。",
      "Clear は、モードをオンにしたまま選択を空にします。",
    ],
    limitations: [
      "自分で複数のものを選ぶコマンド（Fillet、Chamfer、Shell、Pattern など）は、ダイアログが開いている間、Multi-Select に関係なくクリックしたものをすべて受け取ります。",
    ],
  },
  measure: {
    title: "Measure",
    shortcut: "I",
    summary: "選んだものの距離、角度、長さ、面積、体積を表示します。",
    what: [
      "1 つ選ぶと、そのものの大きさを表示します。稜線の長さ、円の半径、面の面積、Body の体積です。",
      "2 つ目を選ぶと、2 つの間の値を表示します。距離、軸ごとの距離、角度（ある場合）です。",
    ],
    requires: ["特にありません。コマンドを開始したときに選択されていたものは、そのまま計測します。"],
    limitations: [
      "計測は表示するだけで、ドキュメントには何も保存しません。寸法を残すときはスケッチの寸法を使います。",
      "一度に計測できるのは 2 つまでです。3 つ目を選ぶと、次の計測が始まります。",
    ],
  },

  // ------------------------------------------------------------ sketch: create
  "solid.pick-sketch-plane": {
    title: "Create Sketch",
    shortcut: "S",
    summary: "原点平面、構成平面、または平らな面の上でスケッチを始めます。",
    what: [
      "スケッチの平面を選ぶと、その平面を正面から見た状態でスケッチの編集に入ります。",
      "面の上のスケッチは、面の輪郭を投影した状態で始まり、Body が変わると面に追従します。構成平面の上のスケッチは、その平面に追従します。",
    ],
    requires: ["平面または平らな面。すでに選択されていれば、それをそのまま使います。"],
    limitations: ["曲面にはスケッチを作れません。"],
    examples: ["Body の上面を選択してから Create Sketch を押すと、その面にポケットの形を描けます。"],
  },
  "sketch.finish": {
    title: "Finish Sketch",
    summary: "スケッチを終了して、3D の編集に戻ります。",
    what: ["スケッチを閉じます。スケッチはタイムラインに残り、ダブルクリックでもう一度開けます。"],
  },
  "sketch.line": {
    title: "Line",
    shortcut: "L",
    summary: "直線を続けて描きます。クリックするたびに線が終わり、次の線が始まります。",
    what: [
      "線の始点と終点をクリックします。次の線は前の線の終点から始まります。Esc で終わります。",
      "ほぼ水平または垂直に描いた線は、正確に水平・垂直になり、その拘束が付きます。",
      SNAP_NOTE,
    ],
    when: ["直線でできた輪郭、補助線、Mirror の軸、回転の軸。"],
    examples: ["4 つの角をクリックし、最後に最初の点をクリックして Esc を押すと、押し出せる閉じた輪郭になります。"],
  },
  "sketch.construction-line": {
    title: "Construction Line",
    summary: "Profile に含まれない補助線を描きます。",
    what: [
      "始点と終点をクリックします。線は Construction（補助）で、位置決め、Mirror、拘束に使えますが、押し出しの対象にはなりません。",
      SNAP_NOTE,
    ],
    when: ["中心線、Mirror の軸、Revolve の軸。"],
  },
  "sketch.polyline": {
    title: "Polyline",
    summary: "いくつもの点を通る折れ線を描き、Enter で終わります。",
    what: [
      "点を順番にクリックします。Enter（タッチでは Done）またはダブルクリックで終わります。最初の点をもう一度クリックすると、閉じた形になります。",
      SNAP_NOTE,
    ],
  },
  "sketch.rectangle-2point": {
    title: "2-Point Rectangle",
    shortcut: "R",
    summary: "向かい合う 2 つの角から、辺が水平・垂直の長方形を描きます。",
    what: ["1 つの角、次に反対側の角をクリックします。辺には水平・垂直の拘束が付きます。", SNAP_NOTE],
    examples: ["描いたあと、2 つの辺に寸法（D）を付けて大きさを決めます。"],
  },
  "sketch.rectangle-3point": {
    title: "3-Point Rectangle",
    summary: "傾いた長方形を描きます。2 回のクリックで 1 辺、3 回目で幅を決めます。",
    what: ["最初の 2 回のクリックで 1 辺と角度が決まり、3 回目で幅が決まります。", SNAP_NOTE],
  },
  "sketch.rectangle-center": {
    title: "Center Rectangle",
    summary: "中心と 1 つの角から長方形を描きます。",
    what: ["中心、次に角をクリックします。長方形は最初の点を中心に保ちます。"],
    when: ["ある点（スケッチの原点など）について対称な形。"],
  },
  "sketch.circle": {
    title: "Center Diameter Circle",
    shortcut: "C",
    summary: "中心と円周上の 1 点から円を描きます。",
    what: ["中心、次に円周上の点をクリックします。", SNAP_NOTE],
    examples: ["輪郭の内側に円を描くと、押し出したときに穴になります。"],
  },
  "sketch.circle-3point": {
    title: "3-Point Circle",
    summary: "3 つの点を通る円を描きます。",
    what: ["円周上の点を 3 つクリックします。"],
    limitations: ["一直線に並んだ 3 点を通る円はありません。"],
  },
  "sketch.arc-3point": {
    title: "3-Point Arc",
    shortcut: "A",
    summary: "両端と、その間の 1 点から円弧を描きます。",
    what: ["始点、終点、円弧が通る点の順にクリックします。"],
  },
  "sketch.arc-center": {
    title: "Center Point Arc",
    summary: "中心、始点、終点から円弧を描きます。",
    what: ["中心、円弧の始点、終わる位置の順にクリックします。"],
  },
  "sketch.ellipse": {
    title: "Ellipse",
    summary: "中心、長軸の端、幅を決める点から楕円を描きます。",
    what: ["中心、長軸の端、短軸を決める点の順にクリックします。"],
    limitations: ["楕円は Sweep のパスにできません。"],
  },
  "sketch.polygon-inscribed": {
    title: "Inscribed Polygon",
    summary: "中心と 1 つの頂点から正多角形を描きます。",
    what: [
      "中心、次に頂点をクリックします。頂点は、2 回目のクリックを通る円の上に並びます。",
      "2 回目のクリックで多角形の向きも決まります。中心の真上に動かすとそろう位置に吸着するので、頂点をちょうど上に置けます。",
    ],
    parameters: [{ name: "Sides", text: "辺の数。3 以上。1 回目のクリックの横に開く窓で指定します。プレビューも追従します。" }],
    examples: ["Sides を 6、中心を原点、2 回目のクリックを中心の真上にすると、頂点が上を向いた六角形になります。"],
  },
  "sketch.polygon-circumscribed": {
    title: "Circumscribed Polygon",
    summary: "中心と 1 辺の中点から正多角形を描きます。",
    what: ["中心、次に辺の中点をクリックします。辺は、2 回目のクリックを通る円に接します。"],
    parameters: [{ name: "Sides", text: "辺の数。3 以上。1 回目のクリックの横に開く窓で指定します。プレビューも追従します。" }],
    when: ["六角ナットのように、向かい合う辺の距離（二面幅）が分かっているとき。"],
  },
  "sketch.slot": {
    title: "Slot",
    summary: "両端が丸い長穴を描きます。2 回のクリックで中心、3 回目で幅を決めます。",
    what: ["両端の円弧の中心を 2 つクリックし、次に幅を決める点をクリックします。"],
  },
  "sketch.spline-fit": {
    title: "Fit Point Spline",
    shortcut: "S",
    summary: "クリックした点を通るなめらかな曲線を描き、Enter で終わります。",
    what: ["曲線が通る点をクリックします。Enter（タッチでは Done）またはダブルクリックで終わります。"],
    limitations: ["点は 2 つ以上必要です。"],
  },
  "sketch.spline-control": {
    title: "Control Point Spline",
    summary: "クリックした点に引き寄せられるなめらかな曲線を描き、Enter で終わります。",
    what: ["クリックした点が制御多角形になります。曲線はその両端から始まり、間は多角形に沿います。"],
  },
  "sketch.point": {
    title: "Point",
    summary: "点を 1 つ置きます。穴の位置などに使います。",
    what: ["クリックした位置に点を置きます。", SNAP_NOTE],
    when: ["穴をあける位置の指定。Hole はスケッチの点を使います。"],
  },
  "sketch.text": {
    title: "Text",
    summary: "フォントで組んだ文字を置きます。輪郭は押し出しや切り抜きに使えます。",
    what: [
      "文字を置く位置をクリックし、ダイアログで文字を入力します。フォント、高さ、字間、揃えもそこで指定します。高さなどの数値は式で入力できます。",
      "テキストはあとから編集できます。輪郭は Profile になるので、閉じた図形と同じように Extrude や Cut ができます。線、円弧、円に沿わせることもできます。",
    ],
    limitations: [
      "自分で読み込んだフォントは、このコンピュータの中だけで使います。プロジェクトには保存せず、どこにも送信しません。フォントがない環境でプロジェクトを開いても、テキストは表示され、立体も作れます。",
      "Explode Text はテキストを通常の曲線に変換します。変換後はテキストとして編集できません。",
    ],
  },
  "sketch.project": {
    title: "Project",
    shortcut: "P",
    summary: "Body の稜線、面、頂点を、参照用の図形としてスケッチに取り込みます。",
    what: [
      "Body の稜線、面、頂点をクリックすると、スケッチ平面に投影した形がスケッチに加わります。",
      "曲面をクリックすると、その輪郭（スケッチ平面から見て面が裏側へ回り込む線）も加わります。横から見た円柱は長方形、球は円になります。同じ線に重なる稜線（横から見た円柱の継ぎ目など）は 1 本だけ投影します。",
      "投影した図形は、Body が変わると追従します。",
    ],
    when: ["すでにある形を基準に、寸法や拘束を付けたいとき。"],
    limitations: ["投影した図形はドラッグできません。位置は Body が決めます。"],
  },
  "sketch.dimension": {
    title: "Sketch Dimension",
    shortcut: "D",
    summary: "長さ、距離、半径、直径、角度に値を与えます。",
    what: [
      "寸法を付ける対象を選び、寸法を置く位置をクリックして、値を入力します。",
      "線 1 本は長さ。2 つの点、または点と線は距離。円や円弧は直径または半径。2 本の線は角度です。",
      EXPRESSIONS,
    ],
    limitations: ["拘束やほかの寸法と矛盾する寸法は付けられません（過剰拘束になるため）。"],
    examples: ["寸法をダブルクリックすると値を変えられ、スケッチが追従します。"],
  },
  "sketch.construction": {
    title: "Normal / Construction",
    shortcut: "X",
    summary: "図形を Construction（補助）に切り替え、または元に戻します。",
    what: [
      "Construction の図形は、位置決めや拘束に使えますが、Profile には含まれず、押し出されません。",
      "選択があるときは、選択した曲線を切り替えます。選択がないときは、これから描く図形の種類を切り替えます。",
    ],
    when: ["中心線、Mirror の軸、ボルト穴を並べる円。"],
  },

  // ------------------------------------------------------------ sketch: modify
  "sketch.modify.fillet": {
    title: "Fillet (Sketch)",
    shortcut: "F",
    summary: "2 本の線の角を、接する円弧で丸めます。",
    what: ["角で交わる 2 本の線をクリックします。線が短くなり、円弧でつながります。"],
    parameters: [{ name: "Radius", text: "円弧の半径（mm）。1 本目の線をクリックすると横に開く窓で指定します。" }],
    limitations: ["対象は 2 本の直線の角です。", "半径は、両方の線が残る大きさにします。"],
  },
  "sketch.modify.chamfer": {
    title: "Chamfer (Sketch)",
    summary: "2 本の線の角を、直線で切り落とします。",
    what: ["角で交わる 2 本の線をクリックします。線が短くなり、直線でつながります。"],
    parameters: [{ name: "Distance", text: "角から切り始める位置までの距離。両方の線で同じです。1 本目の線をクリックすると横に開く窓で指定します。" }],
    limitations: ["対象は 2 本の直線の角です。"],
  },
  "sketch.modify.trim": {
    title: "Trim",
    shortcut: "T",
    summary: "曲線のうち、最も近い交点の間の部分を削除します。",
    what: ["削除する部分をクリックします。両側の、ほかの曲線との最も近い交点で切ります。"],
    limitations: [
      "ほかの曲線と交わっていない曲線は、全体を削除します。",
      "Construction の図形では切れません。",
      "楕円とスプラインは Trim できません（切る側としては使えます）。",
    ],
  },
  "sketch.modify.extend": {
    title: "Extend",
    summary: "曲線を、次にぶつかる曲線まで延ばします。",
    what: ["延ばしたい側の端の近くをクリックします。次の交点まで延びます。"],
    limitations: ["対象は線と円弧です。", "延ばした先に何もなければ、何も起こりません。"],
  },
  "sketch.modify.break": {
    title: "Break",
    summary: "曲線を 1 点で 2 つに分けます。",
    what: ["分けたい位置で曲線をクリックします。"],
  },
  "sketch.modify.offset": {
    title: "Offset",
    shortcut: "O",
    summary: "つながった曲線を、一定の距離だけ離してコピーします。",
    what: [
      "曲線をクリックすると、それにつながる曲線全体をクリックした側へオフセットしたプレビューが出て、クリックした位置の横に窓が開きます。",
      "距離を入力するか、プレビューの曲線をつかんで動かします。Flip で反対側に切り替えます。OK（Enter）で追加し、Cancel（Esc）で取り消します。",
      "別の曲線をクリックすると、プレビュー中のオフセットを追加して、次のオフセットを始めます。",
    ],
    parameters: [
      { name: "Distance", text: "コピーまでの距離（mm）。Snap 1 mm がオンのとき、ドラッグは 1 mm 刻みです。Ctrl / Cmd を押すと細かく動きます。次のオフセットは最後に使った距離から始まります。" },
      { name: "Direction", text: "Flip：つながった曲線の反対側（閉じた形なら内側と外側）に切り替えます。" },
    ],
    limitations: ["内側の半径より大きい距離を指定すると、オフセットした形が自分自身と重なります。"],
  },
  "sketch.modify.move": {
    title: "Move (Sketch)",
    shortcut: "M",
    summary: "選択した図形を、ある点から別の点へ移動します。",
    what: [SELECT_FIRST, "移動の基準になる点、次に移動先の点をクリックします。"],
    limitations: ["拘束は保たれます。拘束された図形は、指定した位置まで動かないことがあります。"],
  },
  "sketch.modify.copy": {
    title: "Copy (Sketch)",
    summary: "選択した図形を、別の位置に複製します。",
    what: [SELECT_FIRST, "コピーの基準になる点、次にコピーを置く位置をクリックします。"],
  },
  "sketch.modify.scale": {
    title: "Scale",
    summary: "選択した図形を、1 点を基準に拡大・縮小します。",
    what: [SELECT_FIRST, "動かさない点（基準点）をクリックします。"],
    parameters: [{ name: "Factor", text: "2 で 2 倍、0.5 で半分になります。ツールを始めると開く窓で指定します。" }],
    limitations: ["拡大・縮小する図形に寸法が付いていると、寸法が値を保って元に戻します。先に寸法を削除してください。"],
  },
  "sketch.modify.mirror": {
    title: "Mirror (Sketch)",
    summary: "選択した図形を、線を軸に反転してコピーします。",
    what: [SELECT_FIRST, "軸にする線をクリックします。"],
    parameters: [
      {
        name: "Symmetry constraints",
        text: "コピーを元の図形と結び付け、片方を変えるともう片方も変わるようにします。ツールを始めると開く窓で指定します。",
      },
    ],
  },
  "sketch.modify.rectangular-pattern": {
    title: "Rectangular Pattern (Sketch)",
    summary: "選択した図形を、行と列に並べて繰り返します。",
    what: [
      SELECT_FIRST,
      "点を 2 つクリックします。その 2 点が方向と間隔になります。行はそれと直角の方向に、同じ間隔で並びます。",
    ],
    parameters: [
      { name: "Count", text: "方向に沿った個数。元の図形を含みます。1 回目のクリックの横に開く窓で指定します。" },
      { name: "Rows", text: "直角の方向の行の数。" },
    ],
  },
  "sketch.modify.circular-pattern": {
    title: "Circular Pattern (Sketch)",
    summary: "選択した図形を、中心のまわりに繰り返します。",
    what: [SELECT_FIRST, "中心をクリックします。コピーは 1 周に等間隔で並びます。"],
    parameters: [{ name: "Count", text: "個数。元の図形を含みます。ツールを始めると開く窓で指定します。" }],
  },
  "sketch.modify.toggle-construction": {
    title: "Normal / Construction",
    shortcut: "X",
    summary: "図形を Construction（補助）に切り替え、または元に戻します。",
    what: ["Options の Normal / Construction と同じコマンドです。"],
  },

  // -------------------------------------------------------------- constraints
  "constraint.coincident": {
    title: "Coincident",
    summary: "点を、別の点または曲線の上に置きます。",
    what: ["点を選び、次に点、線、円、円弧のいずれかを選びます。点はその上にとどまります。"],
    examples: ["線の端を円の上に置く。2 つの端点を 1 か所にまとめる。"],
  },
  "constraint.collinear": {
    title: "Collinear",
    summary: "2 本の線を、同じ直線の上に置きます。",
    what: ["線を 2 本選びます。"],
  },
  "constraint.concentric": {
    title: "Concentric",
    summary: "2 つの円または円弧の中心を同じにします。",
    what: ["円または円弧を 2 つ選びます。"],
  },
  "constraint.midpoint": {
    title: "Midpoint",
    summary: "点を、線の中点に保ちます。",
    what: ["点と線を選びます。"],
  },
  "constraint.fix": {
    title: "Fix / Unfix",
    summary: "図形を今の位置に固定し、または固定を解除します。",
    what: ["固定する図形を選びます。固定済みの図形を選ぶと解除します。"],
    limitations: ["スケッチの原点は常に固定されています。"],
  },
  "constraint.parallel": {
    title: "Parallel",
    summary: "2 本の線を平行にします。",
    what: ["線を 2 本選びます。"],
  },
  "constraint.perpendicular": {
    title: "Perpendicular",
    summary: "2 本の線を直角にします。",
    what: ["線を 2 本選びます。"],
  },
  "constraint.horizontal": {
    title: "Horizontal",
    summary: "線を水平にします。または 2 つの点を同じ高さにします。",
    what: ["線を 1 本、または点を 2 つ選びます。"],
    examples: ["2 つの円の中心を点として選ぶと、横に並びます。"],
  },
  "constraint.vertical": {
    title: "Vertical",
    summary: "線を垂直にします。または 2 つの点を上下に並べます。",
    what: ["線を 1 本、または点を 2 つ選びます。"],
  },
  "constraint.tangent": {
    title: "Tangent",
    summary: "線または円弧を、円または円弧になめらかに接させます。",
    what: ["線または円弧を選び、次に円または円弧を選びます。"],
  },
  "constraint.equal": {
    title: "Equal",
    summary: "2 本の線を同じ長さに、または 2 つの円・円弧を同じ半径にします。",
    what: ["線を 2 本、または円・円弧を 2 つ選びます。"],
  },
  "constraint.symmetry": {
    title: "Symmetry",
    summary: "2 つの点または線を、線を軸に対称に保ちます。",
    what: ["2 つの点または線を選び、次に軸にする線を選びます。"],
  },

  // ------------------------------------------------------------ solid: create
  "solid.extrude": {
    title: "Extrude",
    shortcut: "E",
    summary: "Profile や平らな面に厚みを付けます。Body を作る、足す、削ることができます。",
    what: [
      "スケッチの閉じた Profile を、スケッチ平面の法線方向に動かして立体にします。ビューの矢印をドラッグして距離を決められます。",
      "Body の平らな面は、スケッチを描かずにそのまま押し出せます。",
    ],
    requires: ["スケッチの閉じた Profile、テキスト、または平らな面。"],
    parameters: [
      { name: "Distance", text: "Profile を動かす距離。負の値は反対向きです。" },
      { name: "Direction", text: "One Side（片側）、Flipped（反転）、Symmetric（両側に半分ずつ）。" },
      OPERATION,
    ],
    limitations: ["1 つの Feature で使える Profile は、1 つのスケッチのものです。", "閉じていない曲線は Profile になりません。"],
    examples: ["100 × 80 の長方形を 5.5 で Extrude すると、レーザー加工で 1 枚の Flat Part になる板です。"],
  },
  "solid.revolve": {
    title: "Revolve",
    summary: "Profile を軸のまわりに回転させて立体にします。",
    what: ["スケッチの閉じた Profile を、軸のまわりに回します。軸は同じスケッチの線、または原点の軸です。"],
    requires: ["閉じた Profile と、それを横切らない軸。"],
    parameters: [{ name: "Angle", text: "360 で 1 周です。" }, OPERATION],
    limitations: ["軸はスケッチの平面の上にある必要があります。"],
  },
  "solid.sweep": {
    title: "Sweep",
    summary: "Profile をパスに沿って動かして立体にします。",
    what: ["閉じた Profile を、スケッチの曲線でできたパスに沿って運びます。Profile は、始点でのパスに対する角度を保ちます。"],
    requires: [
      "閉じた Profile。",
      "別のスケッチにあるパス。端と端がつながった線、円弧、円、スプラインです。曲線を 1 つクリックすると、つながっている曲線がまとめて入ります。",
    ],
    parameters: [OPERATION],
    limitations: [
      "ねじりとガイドレールはありません。",
      "パスは枝分かれできません。楕円はパスにできません。",
      "Profile の幅より急に曲がるパスでは、立体が自分自身に食い込みます。",
    ],
  },
  "solid.loft": {
    title: "Loft",
    summary: "2 つ以上の断面をつないで立体にします。",
    what: ["Profile と平らな面を、一覧の順番に、なめらかな面または直線的な面でつなぎます。"],
    requires: ["2 つ以上の断面。別々のスケッチの閉じた Profile、または平らな面。"],
    parameters: [
      { name: "Sections", text: "クリックで追加します。矢印で順番を入れ替えます。" },
      { name: "Ruled", text: "隣り合う断面を、なめらかな面ではなく直線でつなぎます。" },
      OPERATION,
    ],
    limitations: ["ガイドレールはありません。", "穴のある断面は、外側の輪郭だけでつなぎます。"],
  },
  "solid.hole": {
    title: "Hole",
    shortcut: "H",
    summary: "スケッチの点に穴をあけます。Simple、Counterbore、Countersink があります。",
    what: ["選んだスケッチの点ごとに 1 つ、スケッチ平面に直角に、Body へ穴をあけます。"],
    requires: ["スケッチの点（Point ツール）と Body。面の上のスケッチでは、その面の Body に穴をあけます。"],
    parameters: [
      { name: "Type", text: "Simple（単純な穴）、Counterbore（底が平らな広い段）、Countersink（円錐）。" },
      { name: "Diameter", text: "穴の直径。" },
      { name: "Extent", text: "Distance（Depth で深さを指定）または Through All（貫通）。" },
      { name: "Flip", text: "反対向きにあけます。" },
    ],
    limitations: ["ねじ穴とドリル先端の形状はありません。", "1 つの Feature の点は、すべて同じスケッチのものです。"],
  },
  "solid.offset-plane": {
    title: "Offset Plane",
    summary: "平面または平らな面に平行で、指定した距離だけ離れた構成平面を作ります。",
    what: [
      "スケッチを描ける平面を作ります。平面を指定する場所ならどこでも使えます。Create Sketch、Mirror、Split Body、別の Offset Plane の基準などです。",
      "平面はタイムラインに残る Feature です。基準にした面や平面に追従し、距離はいつでも変えられます。",
      "確定する前に平面をビューに表示し、距離を入力すると動きます。",
    ],
    requires: ["原点平面、構成平面、または平らな面。すでに選択されていれば、それをそのまま使います。"],
    parameters: [
      { name: "From", text: "基準にする平面または平らな面。XY / XZ / YZ で原点平面を選べます。" },
      {
        name: "Offset",
        text:
          "基準の法線方向の距離。面の場合は Body の外側が正です。負の値は反対向き、0 は基準と同じ位置です。" +
          EXPRESSIONS,
      },
    ],
    limitations: [
      "作れるのは平行な平面だけです。角度を付けた平面、3 点を通る平面、面に接する平面はありません。",
      "曲面は基準にできません。",
    ],
    examples: [
      "XY 平面を選択して Offset Plane、40 と入力すると、地面から 40 mm 上に平面ができ、Loft の上側の断面を描けます。",
      "編集するには、ブラウザかタイムラインで平面をダブルクリックするか、Properties で Offset を変えます。",
    ],
  },

  // ------------------------------------------------------------ solid: modify
  "solid.fillet": {
    title: "Fillet",
    shortcut: "F",
    summary: "Body の稜線を丸めます。",
    what: ["丸める稜線をクリックします。もう一度クリックすると外れます。すべての稜線が同じ半径になります。"],
    requires: ["1 つの Body の稜線。コマンドを開始したときに選択されていた稜線は、そのまま入ります。"],
    parameters: [{ name: "Radius", text: "丸みの半径。" }],
    limitations: [
      "1 つの Feature で指定できる半径は 1 つ、対象は 1 つの Body の稜線です。",
      "隣の稜線との間に収まらない半径では失敗します。",
    ],
    examples: ["Multi-Select で箱の縦の稜線を 4 本選び、Fillet、5。"],
  },
  "solid.chamfer": {
    title: "Chamfer",
    summary: "Body の稜線を面取りします。",
    what: ["面取りする稜線をクリックします。もう一度クリックすると外れます。"],
    requires: ["1 つの Body の稜線。コマンドを開始したときに選択されていた稜線は、そのまま入ります。"],
    parameters: [{ name: "Distance", text: "面取りの幅。両方の面で同じです。" }],
    limitations: ["両側で距離が同じ面取りだけです。"],
  },
  "solid.shell": {
    title: "Shell",
    summary: "Body の中をくり抜き、一定の厚みの壁を残します。",
    what: ["取り除く面をクリックします。その面が開口になり、ほかの面が壁になります。"],
    requires: ["Body と、開口にする面が 1 つ以上。"],
    parameters: [{ name: "Thickness", text: "壁の厚み。内側に取ります。" }],
    limitations: ["内側の半径が小さい場所など、Body が受け止められない厚みでは失敗します。"],
  },
  "solid.combine": {
    title: "Combine",
    summary: "Body を結合する、片方から削る、共通部分を残す、のいずれかをします。",
    what: ["Tool の Body を、Target の Body に結合、Target から切り取り、または Target との共通部分にします。"],
    requires: ["Target の Body と、Tool の Body が 1 つ以上。"],
    parameters: [
      { name: "Operation", text: "Join（結合）、Cut（切り取り）、Intersect（共通部分）。" },
      { name: "Keep tools", text: "Tool の Body を消さずに残します。" },
    ],
  },
  "solid.move": {
    title: "Move/Copy",
    shortcut: "M",
    summary: "Body を移動、回転します。移動したコピーも作れます。",
    what: ["X・Y・Z 方向の移動、軸のまわりの回転、点から点への移動ができます。"],
    requires: ["1 つ以上の Body。"],
    parameters: [
      { name: "Type", text: "Translate（移動）、Rotate（回転）、Point to Point（点から点）。" },
      { name: "X, Y, Z", text: "ワールド座標の軸に沿った距離（Translate）。" },
      { name: "Axis, Angle", text: "原点の軸、直線または円形の稜線、スケッチの線。角度は度で、反時計回り（Rotate）。" },
      { name: "From, To", text: "頂点またはスケッチの点（Point to Point）。" },
      { name: "Create copy", text: "Body を元の位置に残し、コピーを移動します。" },
    ],
  },
  "solid.align": {
    title: "Align",
    summary: "Body を動かして、その面や点を別の面や点に合わせます。",
    what: [
      "Face to Face は、2 つの平らな面が接するまで Body を回転・移動します。Point to Point は移動だけです。",
      "動くのは、最初に選んだものがある Body です。",
    ],
    requires: ["別々の Body の平らな面 2 つ、または頂点と点。"],
    parameters: [{ name: "Flip", text: "面を向かい合わせではなく、同じ向き（面一）にします。" }],
    limitations: ["Body を自分自身に合わせることはできません。"],
  },
  "solid.split": {
    title: "Split Body",
    summary: "Body を平面で 2 つに分けます。",
    what: ["原点平面、構成平面、または平らな面の平面で Body を切ります。"],
    requires: ["Body と平面。面を使う場合は、別の Body の面にします。"],
    parameters: [
      { name: "Keep", text: "Both（両方）、または平面の Positive（法線側）か Negative（反対側）だけを残します。" },
    ],
    limitations: ["切れるのは平面だけです。曲面やスケッチの線では分割できません。"],
  },

  // ----------------------------------------------------------- solid: pattern
  "solid.rectangular-pattern": {
    title: "Rectangular Pattern",
    summary: "Feature または Body を、1 方向または 2 方向に繰り返します。",
    what: ["Features では、その Feature がしたことを各位置でもう一度行います。Bodies では、各位置に Body を 1 つずつ作ります。"],
    requires: [
      "Feature（その Feature が作った面、またはタイムラインをクリック）または Body。",
      "方向。原点の軸、直線の稜線、またはスケッチの線。",
    ],
    parameters: [
      { name: "Count", text: "個数。元のものを含みます。" },
      { name: "Distance", text: "隣どうしの間隔。" },
      { name: "Second direction", text: "2 つ目の方向。個数と間隔を別に指定でき、格子状に並びます。" },
      { name: "Flip", text: "反対向きに並べます。" },
    ],
    limitations: ["スケッチと構成平面は繰り返せません。", "個数は 2000 までです。"],
  },
  "solid.circular-pattern": {
    title: "Circular Pattern",
    summary: "Feature または Body を、軸のまわりに繰り返します。",
    what: ["軸のまわりに並べます。1 周に等間隔、または指定した角度までです。"],
    requires: [
      "Feature または Body。",
      "軸。原点の軸、直線の稜線、円形の稜線（その中心軸）、またはスケッチの線。",
    ],
    parameters: [
      { name: "Count", text: "個数。元のものを含みます。" },
      { name: "Angle", text: "360 で 1 周に等間隔。それ以外では、最後の 1 つがこの角度の位置に来ます。" },
    ],
    limitations: ["スケッチと構成平面は繰り返せません。"],
  },
  "solid.mirror": {
    title: "Mirror",
    summary: "Feature または Body を、平面を挟んで反転します。",
    what: ["Feature は反対側でもう一度実行し、Body は反転したコピーを作ります。"],
    requires: ["Feature または Body と、平面。原点平面、構成平面、または平らな面。"],
    examples: ["対称な部品の半分だけを作り、その Feature を中央の平面で Mirror します。"],
  },

  // ---------------------------------------------------------- insert / manage
  "solid.import-step": {
    title: "Import STEP",
    summary: "STEP ファイル（.step、.stp）の立体を取り込みます。",
    what: ["ファイルはプロジェクトの中に保存するので、プロジェクトだけで完結します。取り込んだ Body は、ほかの Feature で加工できます。"],
    limitations: ["取り込んだ Body には履歴がなく、Body そのものは編集できません。"],
  },
  "solid.parameters": {
    title: "Parameters",
    summary: "寸法や Feature で使える、名前の付いた値を管理します。",
    what: [
      "パラメータには名前、式、単位があります。値を入力する場所に名前を書くと使えます。パラメータを変えると、それを使っているものがすべて更新されます。",
      "式には、ほかのパラメータ、+ - * /、sqrt、sin、max などの関数を使えます。",
    ],
    examples: ["thickness = 5.5 を作り、Extrude の Distance に thickness と入力します。"],
    limitations: ["パラメータどうしが循環して参照することはできません。"],
  },

  // ------------------------------------------------------------- fabrication
  "fabrication.laser": {
    title: "Laser",
    summary: "Body をレーザー加工用の平らな部品に変換し、シートに並べます。",
    what: [
      "最初に Body を判定し、結果を「Detected: …」として表示します。",
      "Flat Part: 材料と同じ厚みの 2D 形状の Body は、その輪郭のまま 1 つの部品になります。穴はそのまま残り、何も足しません。",
      "Rectangular Box: 直方体は 6 枚のパネルになります。継ぎ手は Tab & Slot、Finger、Flat から選べ、板厚を補正します。",
      "Paper（紙）は、折り線を付けて展開します。切り離した辺は、のりしろ（Glue）か、糊を使わない Tab & Slit でつなぎます。Tab & Slit では、片側にタブ、相手側に折り線へ切り込みを入れたフラップが付きます。フラップもタブも内側に折り込むので、組み立てると外からは見えません。タブは、角柱の蓋のように立体を閉じる面に付きます。まわりの面のフラップを内側に折ってから、その面を押し込むと、タブが切り込みを通って内側に入ります。",
      "部品をシートに並べ、SVG または DXF で書き出します。書き出す内容は、Sheet の表示と同じです。",
    ],
    requires: ["Body と、作るものに合った厚みの材料。"],
    parameters: [
      { name: "Material", text: "厚み、Kerf（切り幅）、Fit offset（継ぎ手のすき間）。" },
      {
        name: "Joints",
        text:
          "Board: 箱の Cap（蓋・底）と Side（側面）の継ぎ手。Paper: Glue または Tab & Slit。" +
          "タブの幅・深さ・間隔、フラップの高さ、タブが切り込みの奥で引っ掛かる量を指定できます。",
      },
      {
        name: "Double curvature",
        text:
          "Paper のみ。Stop: 2 方向に曲がった面を持つ Body は作りません。Gores: その面を、地球儀のように細い帯（舟形）に分けます。" +
          "Gores の数は 1 周あたりの本数（6〜72）です。",
      },
      { name: "Sheet", text: "大きさ、余白、部品どうしの間隔。" },
    ],
    limitations: [
      "Board（板）で作れるのは Flat Part と Rectangular Box だけです。それ以外は Unsupported になり、カットデータを作りません。箱でない角柱、角錐、錐台、屋根、斜めや曲面の壁を持つ立体などです。",
      "板が Flat Part になるのは、厚みが材料の厚みと同じとき（差が 0.1 mm 以内）だけです。",
      "箱は、どの方向も板厚の 2 倍より大きい必要があります。",
      "蓋、仕切り、切り欠きのあるケースは生成しません。",
      "Paper: 展開できるのは、平らな面、円柱、円錐です。2 方向に曲がった面（球、トーラス、円形の稜線に付けた Fillet など）を持つ Body は Unsupported になります。紙は曲がりますが、伸びないためです。Double curvature を Gores にすると、その面を近似して作ります。",
      "Gores（舟形）は近似です。1 本ずつの帯は幅の方向には平らなので、丸い部分は多面体になります。Body の丸い面はすべて（円柱も含めて）、1 周あたり Gores の数だけの面に分割します（数は 1〜2 ずれることがあります）。のりしろを置く場所を空けるため、舟形は 1 本おきに、面の反対側の端につながるか、独立した部品になります。",
      "Tab & Slit: タブを付けるには短すぎる辺は、のりしろになります。片側にタブ、相手側にフラップが付くので、のりしろより展開図が大きくなり、大きいシートが必要になることがあります。",
    ],
    examples: [
      "六角形を 5.5 で Extrude し、MDF 5.5 mm を選ぶと、1 枚のシートに六角形の部品が 1 つ並びます。",
      "縁を丸めた円柱、Paper 0.2 mm、Double curvature を Gores、Gores を 12 にします。側面に舟形が 6 本立った部品と、上面のまわりに舟形が 6 本付いた部品になります。",
      "箱、Paper 0.2 mm、Joint を Tab & Slit にします。展開図とフラップを内側に折り、タブの肩が引っ掛かるまで、それぞれの切り込みに差し込みます。",
    ],
  },
  "fabrication.print": {
    title: "3D Print",
    summary: "Body をベッドに置く向きを決め、チェックして、スライサー用のメッシュを書き出します。",
    what: ["Body をベッドの上に表示し、大きさとオーバーハングを確認して、STL または 3MF を書き出します。"],
    requires: ["1 つ以上の Body。"],
    limitations: ["スライス（G-code の生成）はしません。書き出したファイルをスライサーで開きます。"],
  },
};
