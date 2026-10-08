# Third-party notices / 第三者コンポーネントのライセンス

FabCAD の `LICENSE` は **FabCAD 著作権者が許諾できる独自コード**のためのライセンスです。このページに記載した第三者コンポーネントの権利を変更しません。

この一覧は **2026-10-08 時点で確認した主要な実行時依存**です。全トランジティブ依存、配布アセット、ビルド出力に含まれるコードの包括的な監査が完了したという意味ではありません。実配布物に対して追加のライセンス監査が必要です。

| コンポーネント | ライセンス・確認先 | 配布する許諾本文・注意 |
| --- | --- | --- |
| [Replicad](https://github.com/sgenoud/replicad) | `package.json` およびルート `LICENSE` は MIT | [Replicad MIT本文](licenses/replicad-MIT.txt)。[2023-08-14の上流MIT移行コミット](https://github.com/sgenoud/replicad/commit/c2c63cae2177d0b978a5cfdd9fd38f27fbc9e69b)で `packages/replicad/LICENSE` がAGPLからMITへ変更されたことを確認済み。READMEのAGPL表記は更新漏れと判断。 |
| [replicad-opencascadejs](https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs) | `package.json` は LGPL-2.1-only | [LGPL-2.1本文](licenses/LGPL-2.1.txt)。実配布するWASM/JSとソース・再リンク条件を要確認 |
| [Open CASCADE Technology (OCCT)](https://github.com/Open-Cascade-SAS/OCCT) | LGPL-2.1 と Open CASCADE Exception 1.0 | [LGPL-2.1本文](licenses/LGPL-2.1.txt)、[OCCT特別例外](licenses/OCCT_LGPL_EXCEPTION.txt) |
| [React / React DOM](https://github.com/facebook/react) | MIT | [React MIT本文](licenses/react-MIT.txt)。npm配布物の著作権表示を保持すること |
| [Three.js](https://github.com/mrdoob/three.js) | MIT | [Three.js MIT本文](licenses/three-MIT.txt) |
| [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) | MIT | [harfbuzzjs MIT本文](licenses/harfbuzzjs-MIT.txt) |
| [opentype.js](https://github.com/opentypejs/opentype.js) | MIT | [opentype.js MIT本文](licenses/opentype.js-MIT.txt) |
| 標準搭載の8書体 | SIL Open Font License 1.1 | [フォント別の著作権表示](THIRD_PARTY_FONTS.md)、`apps/fabcad/public/fonts/*-OFL.txt` |

## Open CASCADE / LGPL の取り扱い

Open CASCADE の機能は、`replicad-opencascadejs` によりWebAssemblyとしてブラウザへ配信されます。**FabCAD独自コードのSource Availableライセンスは、LGPLコンポーネントの利用者の権利を制限しません**。

Open CASCADE の公式説明では、LGPLのライブラリについて、少なくとも利用者への通知・ライセンス全文へのアクセス、使用したライブラリの対応ソース入手手段、利用者が改変版ライブラリを使える手段を確保するよう案内しています。単に名称とリンクを表示するだけでは十分と限りません。

参照:
- [Open CASCADE 公式リポジトリ](https://github.com/Open-Cascade-SAS/OCCT)
- [OCCT のライセンス上の注意事項](https://github.com/Open-Cascade-SAS/OCCT/wiki)
- [replicad-opencascadejs ソースとビルド定義](https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs)

### 配布前の確認事項

- [ ] `package-lock.json` と実際のWeb配布物を照合し、WASMに含まれるOCCTの正確なバージョン・ソース・パッチ・ビルド方法を特定する。
- [ ] LGPLに従った対象ソース提供方法、利用者による改変WASMでの置換・再リンクの方法を検証し、必要な手順を文書化する。
- [ ] 著作権表示・本文へのリンクをユーザーが参照できる画面に設置し、ビルド後も利用できることを確認する。
- [x] **Replicad本体のライセンス確認**: [2023-08-14の上流コミット](https://github.com/sgenoud/replicad/commit/c2c63cae2177d0b978a5cfdd9fd38f27fbc9e69b)で開発者本人がAGPLからMITへ変更。現在の `replicad@1.1.0` はMITであることをGit履歴、LICENSE、package.json、npm公開情報で裏付け済み。READMEのAGPL文言は旧記述。なお、`replicad-opencascadejs` に含まれるOCCTのLGPL対応は別途未完了。
- [ ] ReactなどMIT系ライブラリの配布先への著作権表示の引き継ぎを検証し、トランジティブ依存を網羅する。
- [ ] フォントの再配布物にOFL本文・著作権表示が含まれていることを確認する。

このチェックリストは、FabCAD の独自ソースコードに独自ライセンスを設定することとは別の課題です。
