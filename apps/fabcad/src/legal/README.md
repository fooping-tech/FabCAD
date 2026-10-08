# 利用条件の更新

- 公開文面は `public/terms.html`、`public/privacy.html`、`public/licenses.html`。Vite の公開ファイルとして開発・ビルドの両方で提供する。
- 再同意が必要な変更は `consent.ts` の `TERMS_VERSION` と、規約ページのバージョン・施行日を同じ値に更新する。軽微な文言修正ではバージョンを据え置ける。
- 保存するのは `localStorage["fabcad.terms-consent"]` の `{ version, acceptedAt }`（ISO日時）。既存ユーザーも一致する同意がなければ同意画面が出る。
- ストレージが使えないときも現在の利用中は同意を保持し、次回起動時に再表示する。
- `ConsentGate` は同意後にエディタを読み込む。URL・フラグメントは変更しない。共有プロジェクトの読み込みは通常の `startSession()` に任せる。
- 設計保存・共有・解析・外部通信の挙動を変更するときは、ポリシーと英日ヘルプも実装と一緒に更新する。

## ソースコードと第三者OSS

- FabCAD独自コードの条件はリポジトリルートの `LICENSE`（FabCAD Source Available License v1.0）。日本語の概要は `COMMERCIAL_LICENSE.md`。
- 第三者製ライブラリの一覧は `THIRD_PARTY_NOTICES.md` と `licenses/`。標準搭載フォントは `THIRD_PARTY_FONTS.md` を参照。
- 依存バージョン、配布するWASM、フォントを更新するときは、関連する表示・ライセンス原文・配布条件を同じ変更で見直す。
- `replicad` のMIT採用は、2023-08-14の公式コミットで確認済み（READMEには旧AGPL記述あり）。OCCT系WASMのLGPL配布条件は引き続き未検証。詳細は `docs/occt-wasm-lgpl.md` とチェックリストを参照する。
