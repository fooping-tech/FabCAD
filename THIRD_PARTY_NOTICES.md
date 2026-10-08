# Third-party notices / 第三者コンポーネントのライセンス

FabCAD の `LICENSE` は **FabCAD 著作権者が許諾できる独自コード**のためのライセンスです。このページに記載した第三者コンポーネントの権利を変更しません。

この一覧は **2026-10-08 時点で確認した主要な実行時依存**です。全トランジティブ依存、配布アセット、ビルド出力に含まれるコードの包括的な監査が完了したという意味ではありません。実配布物に対して追加のライセンス監査が必要です。

| コンポーネント | ライセンス・確認先 | 配布する許諾本文・注意 |
| --- | --- | --- |
| [Replicad](https://github.com/sgenoud/replicad) | `package.json` およびルート `LICENSE` は MIT | [Replicad MIT本文](licenses/replicad-MIT.txt)。[2023-08-14の上流MIT移行コミット](https://github.com/sgenoud/replicad/commit/c2c63cae2177d0b978a5cfdd9fd38f27fbc9e69b)で `packages/replicad/LICENSE` がAGPLからMITへ変更されたことを確認済み。READMEのAGPL表記は更新漏れと判断。 |
| [replicad-opencascadejs](https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs) | `package.json` は LGPL-2.1-only | [LGPL-2.1本文](licenses/LGPL-2.1.txt)。[OCCT WASMの生成元と置換手順](docs/occt-wasm-lgpl.md)を記録。実際の互換WASMでの置換・対応ソース配布条件は未検証 |
| [Open CASCADE Technology (OCCT)](https://github.com/Open-Cascade-SAS/OCCT) | LGPL-2.1 と Open CASCADE Exception 1.0 | [LGPL-2.1本文](licenses/LGPL-2.1.txt)、[OCCT特別例外](licenses/OCCT_LGPL_EXCEPTION.txt) |
| [React / React DOM](https://github.com/facebook/react) | MIT | [React MIT本文](licenses/react-MIT.txt)。npm配布物の著作権表示を保持すること |
| [Three.js](https://github.com/mrdoob/three.js) | MIT | [Three.js MIT本文](licenses/three-MIT.txt) |
| [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) | MIT | [harfbuzzjs MIT本文](licenses/harfbuzzjs-MIT.txt) |
| [opentype.js](https://github.com/opentypejs/opentype.js) | MIT | [opentype.js MIT本文](licenses/opentype.js-MIT.txt) |
| 標準搭載の8書体 | SIL Open Font License 1.1 | [フォント別の著作権表示](THIRD_PARTY_FONTS.md)、`apps/fabcad/public/fonts/*-OFL.txt` |

## 本番依存パッケージの自動ライセンス表示

ビルドで `npm run audit:licenses` を実行し、`package-lock.json` の本番外部依存に関する各パッケージの原文 `LICENSE`/`COPYING`/`NOTICE` を `dist/THIRD_PARTY_LICENSES.txt` に収集します。同時に `dist/third-party-components.json` を生成し、[第三者ライセンス画面](apps/fabcad/public/licenses.html)から参照できます。未知のライセンス種別や許諾原文が欠けるとCIを失敗させます。

対象はnpmの `!dev && !devOptional` の外部依存で、2026-10-08 時点ではMIT、ISC、LGPL-2.1-onlyの3種です。**Viteの実際のトランジティブな配布コードの完全なSBOMやC++/WASMの依存を網羅するわけではありません。** フォントは別に `THIRD_PARTY_FONTS.md` で管理します。

## Open CASCADE / LGPL の取り扱い

Open CASCADE の機能は、`replicad-opencascadejs` によりWebAssemblyとしてブラウザへ配信されます。上流[PR #263](https://github.com/sgenoud/replicad/pull/263)でOCCT 8.0.1の単一スレッドWASM用OCIイメージとSHA256ダイジェストを確認しました。追跡結果は[配布・再構築の技術文書](docs/occt-wasm-lgpl.md)に記録しています。**FabCAD独自コードのSource Availableライセンスは、LGPLコンポーネントの利用者の権利を制限しません**。

Open CASCADE の公式説明では、LGPLのライブラリについて、少なくとも利用者への通知・ライセンス全文へのアクセス、使用したライブラリの対応ソース入手手段、利用者が改変版ライブラリを使える手段を確保するよう案内しています。単に名称とリンクを表示するだけでは十分と限りません。

参照:
- [Open CASCADE 公式リポジトリ](https://github.com/Open-Cascade-SAS/OCCT)
- [OCCT のライセンス上の注意事項](https://github.com/Open-Cascade-SAS/OCCT/wiki)
- [replicad-opencascadejs ソースとビルド定義](https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs)

### 配布前の確認事項

- [x] 上流のOCCT 8.0.1、ビルドイメージ名・OCIダイジェスト、`ytt`設定とWASMビルドエントリポイントを特定（[詳細](docs/occt-wasm-lgpl.md)）。
- [x] 本番ビルドで`replicad-opencascadejs@1.1.0`のWASMを検出し、ヘッダ・SHA256・サイズを記録する`npm run audit:occt`をCIに追加。
- [ ] 実配布WASMに対応する完全なOCCTソース・パッチ・ツールチェーン・再現ビルドを確認する。
- [x] 改変互換WASMを同一オリジン上で読み込むためのビルド時オプションと単体テストを追加（[手順](docs/occt-wasm-lgpl.md)）。
- [ ] LGPLに従った対象ソース提供条件を確認し、**改変した実物WASM**の差し替え・再リンク動作を検証する。
- [ ] 著作権表示・本文へのリンクをユーザーが参照できる画面に設置し、ビルド後も利用できることを確認する。
- [x] **Replicad本体のライセンス確認**: [2023-08-14の上流コミット](https://github.com/sgenoud/replicad/commit/c2c63cae2177d0b978a5cfdd9fd38f27fbc9e69b)で開発者本人がAGPLからMITへ変更。現在の `replicad@1.1.0` はMITであることをGit履歴、LICENSE、package.json、npm公開情報で裏付け済み。READMEのAGPL文言は旧記述。なお、`replicad-opencascadejs` に含まれるOCCTのLGPL対応は別途未完了。
- [ ] ReactなどMIT系ライブラリの配布先への著作権表示の引き継ぎを検証し、トランジティブ依存を網羅する。
- [x] **標準8フォントの公開ファイル**: `npm run audit:licenses`にて各TTFと対応するOFL本文が`dist/fonts/`にあり、リポジトリに同梱された元のファイルとバイト単位で一致することをCIで検証済み。元フォント・許諾の出所と著作権表示は`THIRD_PARTY_FONTS.md`で管理する。

このチェックリストは、FabCAD の独自ソースコードに独自ライセンスを設定することとは別の課題です。
