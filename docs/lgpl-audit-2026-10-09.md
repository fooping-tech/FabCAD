# FabCAD LGPL-2.1 配布・再構築監査（2026-10-09）

対象: [PR #49](https://github.com/fooping-tech/FabCAD/pull/49)。この文書は監査の技術証拠と留保を区分するものであり、法律意見やLGPL完全準拠の証明ではありません。

## 判定表

| 論点 | 判定 | 根拠 / 残作業 |
| --- | --- | --- |
| Replicadソースの固定タグ | 確認済み | 上流注釈付きtag `v1.1.0` は commit `e4b05f67dc4e2393a876ce8c5064a9c93db05bf1` を指す。source candidateでは同一SHAを取得 |
| OCCT・OCJS依存の固定 | ソース入力のみ確認 | OCCT `b8f597c6...`、OCJS `ebd263f1...`、固定OCIイメージ・Emsdk・FreeType・RapidJSONはDEPS.jsonと資料に記録。実配布npmのWASMを**そのソースで完全再現できるかは別問題** |
| オリジナルnpm WASM再現 | **未確定** | `scripts/verify-occt-original-wasm.sh` で固定Replicad C++ラッパーとOCIイメージを用いてWASM再リンクし、npm原本とSHA-256/JS glueを比較。ラベル `occt-origin-compare` による[CI #37858352624](https://github.com/fooping-tech/FabCAD/actions/runs/37858352624)の成果物を確認すること。オリジナルOCIイメージ内のOCCT C++ライブラリが元ソースから構築されたと立証したことにはならない |
| C++ラッパー改変・再リンク | 確認済み | [CI #37777431664](https://github.com/fooping-tech/FabCAD/actions/runs/37777431664)。変更されたC++ wrapperからWASMをリンクし、Node上のCAD操作とSTEP/STLを確認 |
| 改変WASMのChromium読み込み | 限定的に確認済み | [CI #37782658677](https://github.com/fooping-tech/FabCAD/actions/runs/37782658677)でWASM HTTP取得、Worker初期化、空文書再計算は成功。非空モデルのブラウザ計算・出力の全経路は未確認 |
| ソース候補の生成 | 確認済み | [CI #37857476786](https://github.com/fooping-tech/FabCAD/actions/runs/37857476786)。固定上流ソース約70.7MB、ライセンス、再リンク手順、配布WASMメタデータを同梱しSHA-256検証。ただし対象ソース・パッチ・再リンク素材の完全性は未証明 |
| ソース候補のPages配信処理 | CI確認済み、公開未確認 | `scripts/stage-occt-source-site.sh` が同一distへアーカイブ＋マニフェストを生成。mainへの本番デプロイ後の公開検証は `scripts/verify-occt-publication.mjs` を使用。PRはDraft・未マージで本番公開は未実施 |
| 過去バージョン向けの長期保存 | **CI実装済み、実公開未確認** | Pagesは上書きデプロイなので、WASMのSHA-256とソース束のSHA-256を組み合わせた固定タグのGitHub Releaseをデプロイ前に作成する。既存Releaseは上書きせず再取得してハッシュ検証。`archiveReleaseUrl`を配布マニフェストに記録し、公開後にもCIで照合する。PR段階では本番Releaseは未生成 |
| 独自LICENSEとの整合 | 一部確認、法務判断待ち | `LICENSE` 第6節でLGPLライブラリ自体の権利と結合作品の自己改変・デバッグ目的の解析を留保している。LGPL-2.1 §6のすべての必要条件を満たすかは法律レビューが必要 |
| その他の第三者コンポーネント | 一部確認 | npm/フォント、FreeType/RapidJSONの許諾原文を配布。ただしWASMのリンク済み範囲と、配布JSのトランジティブ依存の完全SBOMは未監査 |
| 著作権・再許諾権限 | **法的未確認** | Git commit authorだけでは職務著作や第三者貢献に関する法的権利を確定できない |

## LGPL-2.1の技術的適合方式

- [LGPL-2.1原文](../licenses/LGPL-2.1.txt) 第4条はライブラリバイナリに対応するソース提供を定め、第6条は結合作品について改変・デバッグの許容と、(a)対応ソース＋必要な再リンク素材、(b)適切なshared library機構、(c)書面による提供申出、(d)ダウンロード元から同等の取得手段などを定める。
- **別ファイルの `.wasm` をブラウザからダウンロードするだけで §6(b)を満たすとは判断できない**。ブラウザWASM内部にはネイティブC++が静的にリンクされる。§6(a)/(d)等を軸にソース・改変/再リンク素材の完全性を確認する方針。
- OCCT例外は主としてOCCTヘッダから生じるオブジェクトコードの利用許諾に関するもので、他のLGPL義務全体の免除ではない。

## 公開前に必須の作業

1. 元npm `replicad-opencascadejs@1.1.0` WASMの再構築比較を評価し、差があればビルド環境・ツール・生成物を調査する。
2. 固定OCCT/OCJSソースに実際に適用されたパッチとビルド環境、配布JS glue、利用者に必要な再リンク素材の完全性を第三者が追試できる形で検証する。
3. GitHub Pagesの実際のURLに対して、アーカイブ、WASM、SHA、著作権・ライセンス表示、デプロイコミットの一致を確認する。マージ後のCI検証だけでは法的適合の証明にならない。
4. バージョン固定GitHub Releaseが公開され、過去版を含めて対応ソース候補のアーカイブをダウンロードできることを、本番デプロイ後に検証する。
5. LGPL第4条・第6条の配布条件を項目別に検証し、独自Source Available Licenseとの衝突と著作権帰属を確認する。権利・契約解釈が不明な箇所については法律専門家への相談を推奨する（LGPL自体は法律ではなく、弁護士の承認がライセンス上の必須条件ではない）。

**マージ判断**: 上記の未解決事項を「対応済み」と扱わない。PR #49はDraft維持。
