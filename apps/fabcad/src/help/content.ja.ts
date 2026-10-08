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

const WINDOW_NOTE = "入力はすべて窓にあります。選択の欄をクリックして（青くなります）スケッチでクリックし、数値は入力します。結果はスケッチにプレビューされ、OK（Enter）で 1 つの操作として確定します。Cancel（Esc）ではスケッチは変わりません。";

const DIMENSIONS_NOTE =
  "描き終えると、形の大きさを決める寸法が横の窓に出ます。値を入力して Enter を押すと寸法になります" +
  "（ビューで数字を打つと、最初の値の入力が始まります）。";

const SELECT_FIRST = "先に対象を選択してから、ツールを開始します。";

const OPERATION = {
  name: "Operation",
  text:
    "New Body は新しい Body を作ります。Join は対象の Body に足し、Cut は対象から削り、" +
    "Intersect は対象と新しい立体の共通部分だけを残します。",
};

const EXPRESSIONS = "値はすべて式で入力できます。数値、パラメータ名、width / 2 + 3 のような計算式です。";

export const HELP_JA: Record<string, HelpEntry> = {
  legal: {
    title: "Terms & Privacy",
    summary: "File または About FabCAD から利用規約とプライバシーポリシーを確認できます。",
    what: ["初回利用前に同意します。同意した規約バージョンと日時をブラウザに保存し、再同意が必要な変更では初回画面を再表示します。", "設計と計算結果は IndexedDB に保存されます。共有URLには設計情報が含まれ、リンクを知る人が読み取れます。バックアップには Save project を使ってください。"],
    limitations: ["ブラウザ保存が利用できない場合、同意は今回の利用中のみ有効です。加工前に寸法・強度・安全性を確認してください。"],
  },
  // ------------------------------------------------------------------ general
  select: {
    title: "Select",
    shortcut: "Esc",
    summary: "選択、ドラッグ、編集をします。どのツールからも Esc で戻ります。",
    what: [
      "クリックで、ポインタの下にあるものを選択します。Shift、Ctrl、Cmd を押しながらクリックすると、選択に追加または解除します。",
      "スケッチでは、点や曲線をドラッグして、拘束が許す範囲で動かせます。何もない場所からドラッグすると範囲選択です。左から右は枠に完全に入ったもの、右から左は枠に触れたものを選択します。",
      "寸法をダブルクリックすると値を編集します。3D でスケッチの図形をダブルクリックすると、そのスケッチの編集に入ります。",
      "スケッチでは、曲線をダブルクリックすると、それにつながる曲線全体（矩形なら 4 辺）を選択します。投影した稜線のように、それぞれが別の点をもっていても、端が同じ位置にあればつながっているとみなします。Shift、Ctrl、Cmd を押すと、選択に追加します。",
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

  "command-palette": {
    title: "Command Palette",
    shortcut: "Ctrl/Cmd+K",
    summary: "コマンド名を入力して、どのコマンドでも実行します。",
    what: [
      "Ctrl / Cmd + K、またはヘッダーの Commands で、画面の上に入力欄が開きます。コマンド名の一部を入力し（Extrude なら \"ext\"、\"view top\"、\"export svg\" など）、矢印キーで選んで Enter で実行します。Esc で閉じます。",
      "いま実行できるコマンドだけが並びます。スケッチの中ではスケッチのツールと拘束、外では Feature と書き出し、FABRICATION では書き出しです。",
    ],
    when: ["ツールがメニューの中にあるとき、アイコンが見分けにくいとき、キーボードのほうが速いとき。"],
  },
  timeline: {
    title: "Timeline",
    summary: "設計の履歴です。Feature ごとに 1 つ、計算される順に並びます。",
    what: [
      "クリックで選択、ダブルクリックで編集、Alt を押しながらクリックで抑制します。右クリックでその工程のコマンドが出ます。",
      "左のボタンで履歴マーカーを動かすと、設計をさかのぼれます。マーカーより右の工程は計算されず、新しい工程はマーカーの位置に入ります。",
      "工程をドラッグすると、順番を入れ替えられます。置ける位置には青い線が出ます。工程は、もとにしているもの（スケッチ、平面、Body を作った工程）より後、その工程をもとにしている工程より前にしか置けず、置けない位置には赤い線が出ます。同じ Body を変えるだけの工程どうしは入れ替えられ、後の工程は前の工程が残した形に対して働きます。",
    ],
    examples: [
      "Join が「辺だけで接する」として止まったときは、つなぎの部分を足す工程をドラッグしてその前に移します。",
    ],
  },
  "timeline.copy-log": {
    title: "History Log",
    summary: "設計の履歴をテキストで表示します。結果の確認や、不具合の報告に使います。",
    what: [
      "タイムラインの左端のボタンで、作業の記録を開きます。各ステップとその状態・エラーメッセージ、各ステップの設定、各スケッチが完全に拘束されているか（残りの自由度）と閉じた輪郭の数、各 Body の大きさと構成（体積、面、離れた部分の数）が並びます。開いている間はモデルに追従します。",
      "各 Body の下には、X・Y・Z 方向の大きさ、円の直径と中心（穴）、それ以外の円弧の半径（フィレット）、面の一覧が出ます。面ごとに、曲面の種類、平らな面ならどこにあってどちらを向いているか（例: \"plane facing +Z at z = 5\"）、面積です。これを読めば、ビューを見なくても結果を設計と照らし合わせられます。",
      "最後の Fabrication (laser) には、加工されるものが出ます。材料、各 Body が何として認識されたか（Flat Part、Rectangular Box、Unfolded Net、Unsupported）、部品ごとの寸法です。",
      "Copy で、プロジェクトそのものと一緒にクリップボードへコピーします。不具合の報告に貼り付けてください。プロジェクトが含まれているので、同じ結果を計算し直せます。",
    ],
    limitations: ["自分で読み込んだフォントは、保存したプロジェクトと同じく含まれません。"],
  },

  "file.autosave": {
    title: "Autosave",
    summary: "作業中のプロジェクトをこのブラウザに保存します。保存できているかはステータスバーに出ます。",
    what: [
      "変更のたびに少し待ってから、またタブが隠れたときや閉じたときに、プロジェクトをこのブラウザ（IndexedDB）に保存します。同じブラウザで FabCAD を開き直すと元に戻ります。何もアップロードしません。",
      "ステータスバーに状態が出ます。Not autosaved yet（まだ保存していない）、Autosaving…（保存中）、Autosaved（ブラウザが書き込みを確認した）、Autosave failed（失敗）、Autosave stopped: another tab（別のタブがある）です。",
      "Autosave failed は、ブラウザが書き込みを断ったときです（容量がいっぱい、プライベートブラウズなど）。次に変更したときにもう一度保存します。Retry ですぐにやり直せます。容量がいっぱいのときは、まず 3D モデルのキャッシュを消し、次に古い Autosave を消します。",
      "Autosave stopped: another tab は、このブラウザの別のタブでも FabCAD を開いていて、そちらがこのタブより後に保存したときです。気づかないうちに上書きしないよう、このタブは保存を止めます。Keep this tab を押すと、このタブのプロジェクトで置き換えます。別のタブの版は File → Recover autosave… に残ります。",
      "復元したプロジェクトはファイルに保存していない扱いなので、New や Open で置き換える前に確認します。",
    ],
    limitations: [
      "Autosave はこの端末のこのブラウザの中だけにあります。サイトのデータを消すと消えます。ファイルとして残すには Save project を使ってください。",
      "タブを閉じたときや、スマートフォンがブラウザを止めたときも最後の保存を試みますが、必ず保存できるとは限りません。",
    ],
  },
  "file.recover": {
    title: "Recover Autosave",
    summary: "このブラウザが残している、少し前のプロジェクトの版を開きます。",
    what: [
      "File → Recover autosave… は、このブラウザの直近 5 回の Autosave を新しい順に、時刻、プロジェクト名、大きさとともに一覧にします。Open を押すと今のプロジェクトをその版で置き換えます。今のプロジェクトに変更があるときは、置き換える前に確認します。",
      "Autosave は読み込むときに壊れていないか確かめます。最新のものが壊れていたら、起動時に壊れていない一番新しいものを開き、そのことを知らせます。",
    ],
    limitations: [
      "残すのは 5 つまでです。容量がいっぱいのときは古いものを消すことがあります。",
      "開いた版はファイルに保存されていません。残すには Save project を使ってください。",
    ],
  },
  "model.stop": {
    title: "Stop Computation",
    summary: "時間のかかりすぎたモデルの計算を止めます。形状カーネルを起動し直します。",
    what: [
      "モデルの計算が 8 秒、またはそのモデルのこれまでで一番長い計算の 2 倍の時間（長いほう）続くと、ステータスバー（スマートフォンではビューの下のバー）に Stop が出ます。大きいモデルが普段どおりの時間で計算しているうちは、Stop は出ません。Stop は計算を止めて形状カーネルを起動し直します。同じモデルで同じ長い計算が始まらないよう、そのあと計算は止めたままにします（ステータスバーに Paused と出ます）。",
      "止めている間に、時間がかかった原因を変えてください。タイムラインの終わりをその工程より前に戻す、工程を無効にする、編集する、などです。Resume でモデルをもう一度計算します。",
      "Restart CAD は、形状カーネルそのものが動かなくなったときに出ます。カーネルを起動し直してモデルを計算します。",
    ],
    limitations: [
      "止めると、計算の途中の結果は捨てます。プロジェクトそのものは変わりません。",
      "もう一度計算するまで、3D ビューには何も出ません。",
    ],
  },
  "file.share-link": {
    title: "Share Link",
    summary: "このプロジェクトを開くリンクを作ります。ほかの人や別のブラウザに渡せます。",
    what: [
      "File → Share link… で、今のプロジェクトをそのまま開くリンクを作ります。スケッチ、ステップ、Body が含まれます。Copy link でクリップボードにコピーします。リンクは窓の中にも表示されるので、選択して手でコピーすることもできます。",
      "プロジェクトはリンクそのもの（アドレスの # より後ろ）に入っています。ブラウザはこの部分をサーバーに送らないので、何もアップロードされません。リンクを持っていない人はモデルを開けません。",
      "リンクを開くとプロジェクトが表示されます。このブラウザに作業中のプロジェクトがすでにあるときは、置き換える前に確認します。Cancel を選ぶと今のプロジェクトのままです。壊れたリンク（コピーのときに途中で切れたものなど）や新しい FabCAD で作ったリンクは、理由を表示して開かず、何も変えません。",
    ],
    limitations: [
      "リンクの長さは 1 MiB（1,048,576 文字）までです。それより大きいプロジェクトはこの方法では共有できません。ファイルに保存して（File → Save project）、ファイルを送ってください。",
      "チャット、メール、SNS のアプリは、長いリンクを途中で切ることがあります。リンクが開けないときは、プロジェクトのファイルを送ってください。",
      "リンクを持っている人は誰でもモデルを開けます。",
      "自分で読み込んだフォントは、保存したプロジェクトと同じく、リンクに含まれません。",
    ],
  },
  "view.software": {
    title: "Simplified 3D View (No WebGL)",
    summary: "ブラウザが WebGL を使えないため、3D ビューを簡易的な方法で描いています。",
    what: [
      "ブラウザが WebGL で描けないとき（クラウドのブラウザ、リモートデスクトップ、制限のかかったコンピューターなど）は、FabCAD が自分で 3D ビューを描きます。ビューの左下の \"No WebGL · simplified 3D view\" がその印です。",
      "面は単色の陰影で塗り、稜線とスケッチはいつもどおり描きます。面や稜線の選択、スケッチ、すべての Feature、Fabrication、書き出しは、そのまま使えます。",
    ],
    limitations: [
      "ビューの回転やズームは遅くなります。モデルやウィンドウが大きいほど遅くなります。",
      "照明はいつものビューより簡単です。",
      "寸法を正確に確かめるときは、History Log（タイムラインの左端のボタン）を読むか、Measure を使ってください。",
    ],
  },

  // ------------------------------------------------------------ sketch: create
  "solid.pick-sketch-plane": {
    title: "Create Sketch",
    shortcut: "S",
    summary: "原点平面、構成平面、または平らな面の上でスケッチを始めます。",
    what: [
      "スケッチの平面を選ぶと、その平面を正面から見た状態でスケッチの編集に入ります。",
      "面の上のスケッチは、面の輪郭を投影した状態で始まり、Body が変わると面に追従します。輪郭をまたいで描いた閉じた形は、輪郭で分割されず 1 つの Profile のままです。描いた図形の内側に、触れずに収まっている輪郭は図形を分割します。輪郭を 3 mm 外側に Offset すると、2 つの間の枠が 1 つの Profile になります。構成平面の上のスケッチは、その平面に追従します。",
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
      DIMENSIONS_NOTE,
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
      DIMENSIONS_NOTE,
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
    what: ["1 つの角、次に反対側の角をクリックします。辺には水平・垂直の拘束が付きます。", SNAP_NOTE, DIMENSIONS_NOTE],
    examples: ["描いたあと、2 つの辺に寸法（D）を付けて大きさを決めます。"],
  },
  "sketch.rectangle-3point": {
    title: "3-Point Rectangle",
    summary: "傾いた長方形を描きます。2 回のクリックで 1 辺、3 回目で幅を決めます。",
    what: ["最初の 2 回のクリックで 1 辺と角度が決まり、3 回目で幅が決まります。", SNAP_NOTE, DIMENSIONS_NOTE],
  },
  "sketch.rectangle-center": {
    title: "Center Rectangle",
    summary: "中心と 1 つの角から長方形を描きます。",
    what: ["中心、次に角をクリックします。長方形は最初の点を中心に保ちます。", DIMENSIONS_NOTE],
    when: ["ある点（スケッチの原点など）について対称な形。"],
  },
  "sketch.circle": {
    title: "Center Diameter Circle",
    shortcut: "C",
    summary: "中心と円周上の 1 点から円を描きます。",
    what: ["中心、次に円周上の点をクリックします。", SNAP_NOTE, DIMENSIONS_NOTE],
    examples: ["輪郭の内側に円を描くと、押し出したときに穴になります。"],
  },
  "sketch.circle-3point": {
    title: "3-Point Circle",
    summary: "3 つの点を通る円を描きます。",
    what: ["円周上の点を 3 つクリックします。", DIMENSIONS_NOTE],
    limitations: ["一直線に並んだ 3 点を通る円はありません。"],
  },
  "sketch.arc-3point": {
    title: "3-Point Arc",
    shortcut: "A",
    summary: "両端と、その間の 1 点から円弧を描きます。",
    what: ["始点、終点、円弧が通る点の順にクリックします。", DIMENSIONS_NOTE],
  },
  "sketch.arc-center": {
    title: "Center Point Arc",
    summary: "中心、始点、終点から円弧を描きます。",
    what: ["中心、円弧の始点、終わる位置の順にクリックします。", DIMENSIONS_NOTE],
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
      DIMENSIONS_NOTE,
    ],
    parameters: [{ name: "Sides", text: "辺の数。3 以上。1 回目のクリックの横に開く窓で指定します。プレビューも追従します。" }],
    examples: ["Sides を 6、中心を原点、2 回目のクリックを中心の真上にすると、頂点が上を向いた六角形になります。"],
  },
  "sketch.polygon-circumscribed": {
    title: "Circumscribed Polygon",
    summary: "中心と 1 辺の中点から正多角形を描きます。",
    what: ["中心、次に辺の中点をクリックします。辺は、2 回目のクリックを通る円に接します。", DIMENSIONS_NOTE],
    parameters: [{ name: "Sides", text: "辺の数。3 以上。1 回目のクリックの横に開く窓で指定します。プレビューも追従します。" }],
    when: ["六角ナットのように、向かい合う辺の距離（二面幅）が分かっているとき。"],
  },
  "sketch.slot": {
    title: "Slot",
    summary: "両端が丸い長穴を描きます。2 回のクリックで中心、3 回目で幅を決めます。",
    what: ["両端の円弧の中心を 2 つクリックし、次に幅を決める点をクリックします。", DIMENSIONS_NOTE],
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
  "sketch.point-entry": {
    title: "Typed Points",
    summary: "描いている図形の点を、クリックの代わりに入力します。",
    what: [
      "Create ツールの実行中に数字（または @、-、.）を入力すると、ビューの下に Point の入力欄が開きます。",
      "x, y でその位置に、@dx, dy で図形の直前の点からの相対位置（最初の点は原点から）に置きます。length<angle と @length<angle は極座標で、角度は X 軸から測った度です。",
      "Enter で点を置き、入力欄は次の点のために開いたままです。空のまま Enter を押すとポリラインやスプラインを終え、Esc で入力欄を閉じます。",
    ],
    parameters: [{ name: "Values", text: EXPRESSIONS }],
    examples: ["長方形：0, 0 Enter のあと @60, 40 Enter。線：0, 0 Enter、@25<30 Enter。"],
  },
  "sketch.project": {
    title: "Project",
    shortcut: "P",
    summary: "Body の稜線、面、頂点を、参照用の図形としてスケッチに取り込みます。",
    what: [
      "Body の稜線、面、頂点をクリックすると、スケッチ平面に投影した形がスケッチに加わります。",
      "曲面をクリックすると、その輪郭（スケッチ平面から見て面が裏側へ回り込む線）も加わります。横から見た円柱は長方形、球は円になります。同じ線に重なる稜線（横から見た円柱の継ぎ目など）は 1 本だけ投影します。",
      "直線・円・円弧は、Body の正確な位置・中心・半径で投影します。スケッチのスプラインから作られた曲がった稜線は、制御点のスプラインとして正確に投影します。それ以外の曲がった稜線（フィレット、Loft、Sweep の稜線、斜めの面が円柱を切る線、斜めから見た円など）は、稜線との差が 0.000001 mm 以内の、制御点のスプラインのつながりとして投影します。そのため、投影からできる Profile は Body の面とぴったり一致します。",
      "投影した図形は、Body が変わると追従します。",
      "投影した図形は Profile の参照です。描いた曲線とぶつかるところでは、描いた曲線が囲む領域を分割しません。面の縁をまたいで描いたリングは、リング全体が押し出されます。描いた図形の内側に触れずに収まっている投影した輪郭は、図形を、2 つの間の枠と内側に分割します。何も描いていないところでは、投影した図形だけで領域ができます（面そのもの、描いた穴のまわりの面、描いた線で分けた面の部分）。",
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
      "曲線をクリックすると、それにつながる曲線全体をクリックした側へオフセットしたプレビューが出て、クリックした位置の横に窓が開きます。投影した稜線のように、それぞれが別の点をもっていても、端が同じ位置にあれば 1 つのつながりとして扱い、コピーの角もつながったままになります（正方形からは正方形）。",
      "複数の曲線を選択している（ダブルクリックでつながりを選んだ、または 1 本ずつ選んだ）ときは、そのうちの 1 本をクリックすると、選択したすべての曲線をまとめてオフセットします。",
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
    summary: "図形を、点から点へ選んだ距離、または入力した距離だけ動かします。",
    what: [
      "Objects：ツールを始めたときの選択です。曲線や点をクリックして追加・除外できます。",
      "From point と To point を選ぶと X distance と Y distance が入ります。距離は直接入力もできます。",
      WINDOW_NOTE,
    ],
    parameters: [{ name: "X distance / Y distance", text: "動かす距離（mm）。" }],
    limitations: ["拘束は保たれるので、拘束された図形は最後まで動かないことがあります。"],
  },
  "sketch.modify.copy": {
    title: "Copy (Sketch)",
    summary: "図形を、点から点へ選んだ距離、または入力した距離の位置に複製します。",
    what: [
      "Objects：ツールを始めたときの選択です。曲線や点をクリックして追加・除外できます。",
      "From point と To point を選ぶと X distance と Y distance が入ります。距離は直接入力もできます。",
      WINDOW_NOTE,
    ],
    parameters: [{ name: "X distance / Y distance", text: "元の図形から複製を置く位置までの距離（mm）。" }],
  },
  "sketch.modify.scale": {
    title: "Scale",
    summary: "図形を、固定点を中心に拡大・縮小します。",
    what: ["Objects のあと、動かない点（Fixed point）を選びます。", WINDOW_NOTE],
    parameters: [{ name: "Factor", text: "2 で 2 倍、0.5 で半分になります。" }],
    limitations: ["拡大した図形の寸法は値を保つので、図形が引き戻されます。先に寸法を削除してください。"],
  },
  "sketch.modify.mirror": {
    title: "Mirror (Sketch)",
    summary: "図形を、線を軸に鏡像に複製します。",
    what: ["Objects のあと、軸にする線（Mirror line）を選びます。", WINDOW_NOTE],
    parameters: [
      {
        name: "Symmetry constraints",
        text: "コピーを元の図形と結び付け、片方を変えるともう片方も変わるようにします。",
      },
    ],
  },
  "sketch.modify.rectangular-pattern": {
    title: "Rectangular Pattern (Sketch)",
    summary: "図形を、行と列に並べて複製します。",
    what: ["Objects のあとは数値だけです。点を選ぶ必要はありません。", WINDOW_NOTE],
    parameters: [
      { name: "Count", text: "方向に沿った個数。元の図形を含みます。" },
      { name: "Rows", text: "直角の方向の行の数。Spacing と Row spacing が間隔、Direction でパターンの向き（X 軸からの角度）を変えます。" },
    ],
  },
  "sketch.modify.circular-pattern": {
    title: "Circular Pattern (Sketch)",
    summary: "図形を、中心のまわりに並べて複製します。",
    what: ["Objects のあと、中心（Center point）を選びます。", WINDOW_NOTE],
    parameters: [{ name: "Count", text: "個数。元の図形を含み、Total angle（1 周なら 360）に均等に並べます。" }],
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
      "押し出しを反対側に向けたとき（Flipped にする、または矢印をスケッチの反対側までドラッグする）、Body の中に入るなら Join が Cut に変わり、入った Body だけを削る対象にします。どの Body にも入らない向きに戻すと、Cut は Join に戻ります。",
    ],
    requires: ["スケッチの閉じた Profile、テキスト、または平らな面。"],
    parameters: [
      { name: "Extent", text: "Distance：下の値の距離だけ押し出します。To：平面、平らな面、点まで押し出します。" },
      { name: "Distance", text: "Profile を動かす距離。負の値は反対向きです。" },
      { name: "Direction", text: "One Side（片側）、Flipped（反転）、Symmetric（両側に半分ずつ）。" },
      {
        name: "To",
        text: "平面、（スケッチと平行な）平らな面、頂点、スケッチの点をクリックします。押し出し先が動くたびに長さを測り直します。Length に求めた長さが出ます。矢印をドラッグすると Distance に戻ります。",
      },
      OPERATION,
    ],
    limitations: ["1 つの Feature で使える Profile は、1 つのスケッチのものです。", "閉じていない曲線は Profile になりません。"],
    examples: ["100 × 80 の長方形を 5.5 で Extrude すると、レーザー加工で 1 枚の Flat Part になる板です。"],
  },
  "solid.revolve": {
    title: "Revolve",
    summary: "Profile を軸のまわりに回転させて立体にします。",
    what: [
      "スケッチの閉じた Profile を、軸のまわりに回します。軸は同じスケッチの線、または原点の軸です。",
      "軸のまわりのリングが角度を表します。つまみ（またはリング）をドラッグして角度を決められます。Alt（Option）を押すと細かい刻みになります。",
    ],
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
    what: [
      "選んだスケッチの点ごとに 1 つ、スケッチ平面に直角に、Body へ穴をあけます。",
      "Distance のとき、最初の点から穴の方向に矢印が出て、深さを表します。矢印をドラッグして深さを決められます。",
    ],
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
      "基準から矢印が出て、距離を表します。矢印をドラッグして距離を決められます。基準を越えて反対側にも動かせます。",
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
    what: [
      "丸める稜線をクリックします。もう一度クリックすると外れます。すべての稜線が同じ半径になります。",
      "最初の稜線に、Body の内側を向いた矢印が出て、半径を表します。矢印をドラッグして半径を決められます。",
    ],
    requires: ["1 つの Body の稜線。コマンドを開始したときに選択されていた稜線は、そのまま入ります。"],
    parameters: [{ name: "Radius", text: "丸みの半径。" }],
    limitations: [
      "1 つの Feature で指定できる半径は 1 つ、対象は 1 つの Body の稜線です。",
      "隣の稜線との間に収まらない半径では失敗します。",
      "結果が閉じた正しい立体にならないときは、壊れた Body を残さずにエラーにします（面が接線で接する稜線にごく小さい半径を付けると起こることがあります）。",
    ],
    examples: ["Multi-Select で箱の縦の稜線を 4 本選び、Fillet、5。"],
  },
  "solid.chamfer": {
    title: "Chamfer",
    summary: "Body の稜線を面取りします。",
    what: [
      "面取りする稜線をクリックします。もう一度クリックすると外れます。",
      "最初の稜線に、Body の内側を向いた矢印が出て、距離を表します。矢印をドラッグして距離を決められます。",
    ],
    requires: ["1 つの Body の稜線。コマンドを開始したときに選択されていた稜線は、そのまま入ります。"],
    parameters: [{ name: "Distance", text: "面取りの幅。両方の面で同じです。" }],
    limitations: [
      "両側で距離が同じ面取りだけです。",
      "結果が閉じた正しい立体にならないときは、壊れた Body を残さずにエラーにします。",
    ],
  },
  "solid.shell": {
    title: "Shell",
    summary: "Body の中をくり抜き、一定の厚みの壁を残します。",
    what: [
      "取り除く面をクリックします。その面が開口になり、ほかの面が壁になります。",
      "ポケット（凹み）のある平らな面も開口にできます。ポケットは、同じ厚みの壁をもつカップとして残ります。",
      "開口にする面の縁を Fillet で丸めてあると、その丸みは残り、壁の上端で内側に巻き込む丸い縁になります。",
      "最初の面に、Body の内側を向いた矢印が出て、厚みを表します。矢印をドラッグして厚みを決められます。",
    ],
    requires: ["Body と、開口にする面が 1 つ以上。"],
    parameters: [{ name: "Thickness", text: "壁の厚み。内側に取ります。" }],
    limitations: [
      "内側の半径が小さい場所など、Body が受け止められない厚みでは失敗します。",
      "開口にする面が曲面のときや、自由曲面が多いときは、オフセットに失敗することがあります。その場合は、Fillet の前に Shell をすると、たいていうまくいきます。",
    ],
  },
  "solid.combine": {
    title: "Combine",
    summary: "Body を結合する、片方から削る、共通部分を残す、のいずれかをします。",
    what: [
      "Tool の Body を、Target の Body に結合、Target から切り取り、または Target との共通部分にします。",
      "Tool の Body は使い切られ、Browser には結果をもつ Target の Body だけが残ります。履歴のマーカーを Combine より前に戻すと、Tool の Body も戻ります。",
      "結果を確かめます。閉じた正しい立体にならないとき、または操作ではありえない体積になったとき（結合した結果が元の Body より小さいなど）は、壊れた Body を残さずにエラーを出します。",
    ],
    requires: ["Target の Body と、Tool の Body が 1 つ以上。"],
    parameters: [
      { name: "Operation", text: "Join（結合）、Cut（切り取り）、Intersect（共通部分）。" },
      { name: "Keep tools", text: "Tool の Body を消さずに残します。" },
    ],
    limitations: [
      "Body は 1 つのコンポーネントに属している必要があります。異なるコンポーネントの Body と、コンポーネントのインスタンスは受け付けません。Combine で Body が別のコンポーネントに移ることはありません。",
    ],
  },
  "solid.move": {
    title: "Move/Copy",
    shortcut: "M",
    summary: "Body を移動、回転します。移動したコピーも作れます。",
    what: [
      "Free Move は、X・Y・Z 方向の移動と、Body の中心を通る X・Y・Z 軸のまわりの回転を組み合わせます。Translate は移動だけ、Rotate は選んだ軸のまわりの回転、Point to Point は点から点への移動です。",
      "移動後の Body がビューに半透明で表示され、値を入力するたびに追従します。",
      "Free Move と Translate では、X（赤）・Y（緑）・Z（青）の矢印が出ます。矢印をドラッグすると、その方向に動きます。Free Move では各軸のまわりのリングも出て、Rotate では選んだ軸のまわりにリングが 1 つ出ます。リングをドラッグすると回転します。窓の値はドラッグに合わせて変わります。ドラッグ中に Alt（Option）を押すと、細かい刻みになります。",
    ],
    requires: ["1 つ以上の Body。"],
    parameters: [
      { name: "Type", text: "Free Move（自由移動）、Translate（移動）、Rotate（回転）、Point to Point（点から点）。" },
      { name: "X, Y, Z", text: "ワールド座標の軸に沿った距離（Free Move、Translate）。" },
      { name: "X Angle, Y Angle, Z Angle", text: "Body の中心を通るワールド座標の X・Y・Z 軸のまわりの角度。度で、反時計回り。この順に回転してから距離だけ移動します（Free Move）。" },
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
    what: [
      "原点平面、構成平面、または平らな面の平面で Body を切ります。",
      "面は、分割する Body 自身の面でもかまいません。段差の上面で、その上に立っている部分を切れます。Body の外側の面では Body を切れないので、エラーになります。",
    ],
    requires: ["Body と、それを通る平面。"],
    parameters: [
      { name: "Keep", text: "Both（両方）、または平面の Positive（法線側）か Negative（反対側）だけを残します。" },
    ],
    limitations: ["切れるのは平面だけです。曲面やスケッチの線では分割できません。"],
  },

  // ----------------------------------------------------------- solid: pattern
  "solid.rectangular-pattern": {
    title: "Rectangular Pattern",
    summary: "Feature または Body を、1 方向または 2 方向に繰り返します。",
    what: [
      "Features では、その Feature がしたことを各位置でもう一度行います。Bodies では、各位置に Body を 1 つずつ作ります。",
      "各方向の矢印は最後のインスタンスの位置で終わります。矢印をドラッグすると間隔が変わります。",
    ],
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
    what: [
      "軸のまわりに並べます。1 周に等間隔、または指定した角度までです。",
      "軸のまわりのリングが、最後のインスタンスまでの角度を表します。つまみ（またはリング）をドラッグして角度を決められます。",
    ],
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
  "export.model": {
    title: "Export 3D Model",
    summary: "選んだ Body とコンポーネントを STEP または STL に書き出します。",
    what: [
      "Export → STEP… または STL… で窓が開き、ルートの Body と、コンポーネントごとにその Body が並びます。書き出すものにチェックを入れます。コンポーネントのチェックは、その Body をまとめて切り替えます。",
      "コンポーネントの Body は、表示中のインスタンスごとに、その位置に置いて書き出す（STEP では Instance/Body という名前）か、定義の位置に 1 つだけ書き出すかを選べます。",
      "最初は選択しているもの（Body、コンポーネント、インスタンス）が、何も選択していなければ表示しているものすべてが入っています。STL はすべてを 1 つのファイルに書きます。",
      "Export → 3MF / STL（parts on the bed）では、3D プリント用の同じ窓が開きます。コンポーネントは、インスタンスごとに 1 つ、または 1 つだけ印刷します。選んだ内容は 3D Print ワークスペースの選択として保存され、ファイルにはそのワークスペースがベッドに並べた部品が入ります。",
    ],
    parameters: [
      { name: "Format", text: "STEP（立体。ほかの CAD 向け）または STL（三角形。3D プリント向け）。" },
      { name: "Placement", text: "コンポーネントごとに、At its instances（インスタンスの位置）か Once, at the origin（原点に 1 つ）。" },
    ],
    limitations: ["STEP はアセンブリの構造をもたない、立体の一覧です。"],
  },
  "component.new": {
    title: "New Component",
    summary: "コンポーネントを作ります。何度でも配置できる部品の定義です。",
    what: [
      "コンポーネントは定義です。1 つの部品のスケッチ、Feature、Body をまとめます。配置はインスタンスで行います。どのインスタンスも同じ形をそれぞれの位置に表示し、定義を変えるとすべてのインスタンスに反映されます。",
      "Body を選択しているときは、その Body と、それを作った操作が新しいコンポーネントに移ります。ルートの Body でも、ほかのコンポーネントの Body でもかまいません。Body を（ビューまたは Browser で）右クリックして Create Component を選びます。その Body を変える操作と、その操作が使うスケッチ・構成平面、Combine で使い切られた Body も一緒に移ります。ほかの Body の面に描いたスケッチ、投影、面を基準にした平面は、その Body を参照するだけなので、結び付きにはなりません。選択していない Body も変える操作（2 つの Body に結合する Extrude など）があるときは、何も移さず、その操作の名前をメッセージに出します。メッセージの Show ボタンで、その操作を選択してタイムラインに表示します（タイムラインでダブルクリックすると編集できます）。操作を 1 つの Body だけを変えるように編集するか、その Body も選択してください。",
      "モデルの位置は変わりません。ルートの Body には原点にインスタンスを 1 つ置きます。コンポーネントから取り出した Body には、元のコンポーネントのインスタンスと同じ位置に、同じ表示・非表示でインスタンスを置きます。",
      "New Component（リボン、または Browser でドキュメントかコンポーネントを右クリック）で、Fusion と同じように窓が開きます。名前、選択した Body を入れるかどうか、アクティブにするかどうかを決めます。空のコンポーネントをアクティブにすると、このあと作るスケッチや Feature はそのコンポーネントに属します。Body のコンテキストメニューの Create Component は、選択した Body からすぐにコンポーネントを作ります。",
      "Browser では、定義を Components の下（Sketches、Features、Bodies つき）に、配置したインスタンスを Instances の下に表示します。",
      "既にあるコンポーネントに Body を移すときは、Browser で Body をそのコンポーネント（またはその Bodies フォルダ）にドラッグします。ドキュメントにドロップするとルートに戻ります。選択している Body はまとめて動きます。一緒に移るものは New Component と同じ決め方です。2 つのコンポーネントの配置が違うときは、移した履歴の最後に Move を 1 つ追加して、Body が見えている位置を保ちます。インスタンスが複数あるときは、最初のインスタンスに合わせます。",
    ],
    when: [
      "何度も使う部品（スペーサー、ブラケットなど）や、アセンブリの部品を分けておきたいときに。",
    ],
    requires: ["何も選択しないか、1 つのコンポーネントの Body と Feature を選択します。"],
    parameters: [
      { name: "Name", text: "コンポーネントの名前。インスタンスは Name:1、Name:2 … になります。" },
      { name: "Parent", text: "常にルートです。コンポーネントは入れ子にできません。" },
      { name: "From selected bodies", text: "Body を選択しているときに出ます。その Body を、それを変える操作と一緒に新しいコンポーネントに移します。" },
      { name: "Activate", text: "新しいコンポーネントをアクティブにし、このあと作るものをそこに属させます。" },
    ],
    limitations: [
      "コンポーネントは入れ子にできません。どのコンポーネントもルートに作ります。",
      "Browser でのドラッグにはマウス（またはペン）が必要です。タッチ操作では、Body のコンテキストメニューの Create Component で新しいコンポーネントにできます。",
      "インスタンスごとのパラメータはありません。どのインスタンスも定義のとおりに表示されます。",
    ],
    examples: [
      "何も選択せずに New Component、続けて Create Sketch と Extrude。できた Body は新しいコンポーネントに属します。Activate Root のあと Create Instance で、新しいインスタンスを横に動かします。",
    ],
  },
  "component.instance": {
    title: "Create Instance",
    summary: "選択したコンポーネントをもう 1 つ配置します。同じ定義を参照します。",
    what: [
      "Browser で選択したコンポーネント（またはインスタンスのコンポーネント、アクティブなコンポーネント）のインスタンスを追加し、Move / Rotate を開きます。",
      "インスタンスは定義を参照するだけで、何もコピーしません。定義を編集すると、すべてのインスタンスが変わります。インスタンスのコンテキストメニューの Duplicate は、そのインスタンスと同じ位置に同じことをします。",
      "インスタンスを削除しても、定義は Components に残ります。インスタンスが 1 つもなくなっても残り、Create Instance でもう一度配置できます。",
    ],
    requires: ["コンポーネントかインスタンスを選択しているか、コンポーネントがアクティブであること。"],
  },
  "component.activate": {
    title: "Activate Component",
    summary: "コンポーネントを編集します。そのスケッチ、Feature、Body だけを定義の座標で表示します。",
    what: [
      "Browser でコンポーネントをダブルクリックするか、コンテキストメニュー（またはそのインスタンスのコンテキストメニュー）の Activate Component を選びます。そのコンポーネントが定義の位置に表示され、作ったものはそのコンポーネントに属します。Fusion と同じように、ほかの部分（ルートの Body と、ほかのコンポーネントのインスタンス）は、そのコンポーネントから見た位置に半透明で表示されます。",
      "半透明の部分を足がかりにできます。その平らな面や構成平面で Create Sketch を使うと、そこにアクティブなコンポーネントのスケッチが始まります。Project では、その稜線・面・頂点を選べます。どちらも元の形状に追従し、インスタンスを動かすと、その上のスケッチや投影した線も一緒に動きます。",
      "Activate Root（リボンのボタン、コンテキストメニュー、または Browser のドキュメントのダブルクリック）でモデル全体に戻ります。ルートの Body と、すべてのインスタンスがそれぞれの位置に表示されます。",
      "ルートがアクティブなとき、インスタンスは全体として選択されます。その面や稜線はコマンドで選べません。変えるときはコンポーネントをアクティブにします。",
      "ルートがアクティブなとき、コンポーネントの構成平面はインスタンスの位置に表示されます。その平面で Create Sketch を使うと、そのコンポーネントがアクティブになり、そこでスケッチが始まります。スケッチは平面と同じコンポーネントに属します。",
    ],
    limitations: [
      "Feature は 1 つのコンポーネントの中で働きます。Combine、Join / Cut の対象、Move/Copy、パターンは、異なるコンポーネントの Body を受け付けません。ダイアログにそう表示され、OK は押せません。",
    ],
  },
  "component.move-instance": {
    title: "Move / Rotate Instance",
    shortcut: "M",
    summary: "インスタンスを配置します。原点の位置と向きを決めます。",
    what: [
      "インスタンスのコンテキストメニュー、Browser でのダブルクリック、またはインスタンスを 1 つ選択して M で開きます。値を入力するとインスタンスが追従します。OK で 1 つの操作として確定し、Cancel で元に戻します。",
      "動くのはそのインスタンスだけです。定義とほかのインスタンスは動きません。",
    ],
    requires: ["インスタンスが 1 つ。"],
    parameters: [
      { name: "X, Y, Z", text: "コンポーネントの原点を置く位置（ワールド座標）。" },
      { name: "Rotate X, Rotate Y, Rotate Z", text: "コンポーネントの原点を通るワールド座標の X、Y、Z 軸のまわりの角度。度で、反時計回り。この順に回転します。" },
    ],
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
      "Paper: 展開できるのは、平らな面、円柱、円錐、押し出した輪郭（テキスト、スプライン）の側面です。曲がった面は分けずに、1 本の帯として広げるか、その面から別の展開図を始めます。シートに（タブの分の余白を含めて）収まらない展開図は分けます。2 方向に曲がった面（球、トーラス、円形の稜線に付けた Fillet など）を持つ Body は Unsupported になります。紙は曲がりますが、伸びないためです。Double curvature を Gores にすると、その面を近似して作ります。",
      "Gores（舟形）は近似です。1 本ずつの帯は幅の方向には平らなので、丸い部分は多面体になります。Body の丸い面はすべて（円柱も含めて）、1 周あたり Gores の数だけの面に分割します（数は 1〜2 ずれることがあります）。のりしろを置く場所を空けるため、舟形は 1 本おきに、面の反対側の端につながるか、独立した部品になります。",
      "一直線に続く切り離し辺（曲がった側面に沿った、細かい面の短い辺）は、まとめて 1 つののりしろ（Tab & Slit では 1 列のタブ）にします。相手側が線から曲がって離れるところでのりしろを区切るので、曲線にも沿います。Tab & Slit は両側が一直線のときだけ使い、曲線に沿うところはのりしろになります。Tab & Slit: タブを付けるには短すぎる辺は、のりしろになります。片側にタブ、相手側にフラップが付くので、のりしろより展開図が大きくなり、大きいシートが必要になることがあります。",
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
    what: [
      "Body をベッドの上に表示し、大きさとオーバーハングを確認して、STL または 3MF を書き出します。",
      "コンポーネントの Body は、表示中のインスタンスの数だけ（インスタンスの数が個数になります）、または 1 つだけ印刷します。Bodies の一覧のコンポーネントの欄で選びます。Export → 3MF / STL（parts on the bed）でも、同じ選択の窓が開きます。",
      "ファイルはプレビューより細かい面で書き出します。曲面と実際の形のずれは 0.02 mm 以下です。",
    ],
    requires: ["1 つ以上の Body。"],
    limitations: [
      "スライス（G-code の生成）はしません。書き出したファイルをスライサーで開きます。",
      "閉じた立体でない Body（表面にすき間がある）は印刷しません。書き出しの窓でその Body に印を付け、理由を表示します。Export → 3D model → STL… なら、このチェックなしで書き出せます（メッシュを修復できるスライサー向け）。",
    ],
  },
};
