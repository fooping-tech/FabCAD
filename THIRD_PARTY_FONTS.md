# Third-party fonts

FabCAD の Sketch Text に標準搭載しているフォントの一覧です。すべて SIL Open Font License 1.1（OFL-1.1）です。フォント本体と、それぞれの OFL 本文は `apps/fabcad/public/fonts/` にあります。

フォントファイルは、姉妹プロジェクト TypeFab が同梱している静的 TTF を、ファイル名も内容も変えずにコピーしたものです（サブセット化・変換・改名・改変はしていません）。TypeFab の `THIRD_PARTY_FONTS.md` によれば、これらは Google Fonts の公式リポジトリ（github.com/google/fonts）で配布されている静的 TTF です。下の「Source」はその記載に基づきます。「Copyright」は同梱している各 OFL 本文の 1 行目です。

コード上の一覧は `packages/typography/src/catalog.ts` の `BUNDLED_FONTS` です。フォントを追加・更新するときは、公式配布元の最新の OFL 本文を確認し、フォント本体と OFL 本文を必ず一緒に置き、`BUNDLED_FONTS` とこのファイルを更新してください。サブセット化・変換・改変を行う場合は Reserved Font Name 条項を確認してください。

## Zen Kaku Gothic New（既定フォント）
- License: SIL Open Font License 1.1
- Copyright: Copyright 2022 The Zen Kaku Gothic Project Authors (https://github.com/googlefonts/zen-kakugothic)
- Source: https://github.com/google/fonts/tree/main/ofl/zenkakugothicnew
- Font file: `apps/fabcad/public/fonts/ZenKakuGothicNew-Regular.ttf`
- License file: `apps/fabcad/public/fonts/ZenKakuGothicNew-OFL.txt`
- Font id: `zen`

## Shippori Mincho（しっぽり明朝）
- License: SIL Open Font License 1.1
- Copyright: Copyright 2021 The Shippori Mincho Project Authors (https://github.com/fontdasu/ShipporiMincho)
- Source: https://github.com/google/fonts/tree/main/ofl/shipporimincho
- Font file: `apps/fabcad/public/fonts/ShipporiMincho-Regular.ttf`
- License file: `apps/fabcad/public/fonts/ShipporiMincho-OFL.txt`
- Font id: `shippori`

## Zen Maru Gothic
- License: SIL Open Font License 1.1
- Copyright: Copyright 2021 The Zen Maru Gothic Project Authors (https://github.com/googlefonts/zen-marugothic)
- Source: https://github.com/google/fonts/tree/main/ofl/zenmarugothic
- Font file: `apps/fabcad/public/fonts/ZenMaruGothic-Regular.ttf`
- License file: `apps/fabcad/public/fonts/ZenMaruGothic-OFL.txt`
- Font id: `zenmaru`

## Dela Gothic One
- License: SIL Open Font License 1.1
- Copyright: Copyright 2020 The Dela Gothic Project Authors (https://github.com/syakuzen/DelaGothic)
- Source: https://github.com/google/fonts/tree/main/ofl/delagothicone
- Font file: `apps/fabcad/public/fonts/DelaGothicOne-Regular.ttf`
- License file: `apps/fabcad/public/fonts/DelaGothicOne-OFL.txt`
- Font id: `delagothic`

## RocknRoll One
- License: SIL Open Font License 1.1
- Copyright: Copyright 2020 The RocknRoll Project Authors (https://github.com/fontworks-fonts/RocknRoll)
- Source: https://github.com/google/fonts/tree/main/ofl/rocknrollone
- Font file: `apps/fabcad/public/fonts/RocknRollOne-Regular.ttf`
- License file: `apps/fabcad/public/fonts/RocknRollOne-OFL.txt`
- Font id: `rocknroll`

## Kaisei Decol
- License: SIL Open Font License 1.1
- Copyright: Copyright 2020 The Kaisei Project Authors (https://github.com/Font-Kai/Kaisei)
- Source: https://github.com/google/fonts/tree/main/ofl/kaiseidecol
- Font file: `apps/fabcad/public/fonts/KaiseiDecol-Regular.ttf`
- License file: `apps/fabcad/public/fonts/KaiseiDecol-OFL.txt`
- Font id: `kaiseidecol`

## Zen Kurenaido
- License: SIL Open Font License 1.1
- Copyright: Copyright 2021 The Zen Kurenaido Project Authors (https://github.com/googlefonts/zen-kurenaido)
- Source: https://github.com/google/fonts/tree/main/ofl/zenkurenaido
- Font file: `apps/fabcad/public/fonts/ZenKurenaido-Regular.ttf`
- License file: `apps/fabcad/public/fonts/ZenKurenaido-OFL.txt`
- Font id: `zenkurenaido`

## DotGothic16
- License: SIL Open Font License 1.1
- Copyright: Copyright 2020 The DotGothic16 Project Authors (https://github.com/fontworks-fonts/DotGothic16)
- Source: https://github.com/google/fonts/tree/main/ofl/dotgothic16
- Font file: `apps/fabcad/public/fonts/DotGothic16-Regular.ttf`
- License file: `apps/fabcad/public/fonts/DotGothic16-OFL.txt`
- Font id: `dotgothic`

## 生成した形状について

Sketch Text はフォントのグリフをアウトライン（線分と 3 次ベジェ曲線の閉じたループ）に変換して CAD の形状にします。プロジェクトファイルや書き出したデータにフォントファイルそのものは含まれません。

## ユーザーが追加したフォント

利用者が追加したフォント（TTF / OTF / WOFF）は、その利用者のブラウザの中だけで処理されます。フォントのデータはメモリ上にだけ置かれ、サーバーへ送信されることも、プロジェクトファイルに埋め込まれることも、FabCAD から再配布されることもありません。プロジェクトファイルに保存されるのはフォントの識別子（`user:<ファイル内容のハッシュ>`）と生成済みのアウトラインだけで、別のブラウザで文字を編集し直すときは、同じフォントファイルをもう一度追加する必要があります。

追加するフォントを使用・アウトライン化し、その生成物を利用するために必要な権利・許諾の確認は、利用者の責任です。

## シェーピングエンジン

文字の並べ方（カーニング、縦書き用の字形 `vert` / `vrt2`）の計算には HarfBuzz（`harfbuzzjs` パッケージの WebAssembly、MIT License）を、グリフのアウトラインの読み出しには opentype.js（MIT License）を使っています。
