import { lazy, Suspense, useState, type ReactElement } from "react";
import { readBrowserConsent, saveBrowserConsent, TERMS_VERSION } from "./consent";
import "./legal.css";
import { LegalLinks } from "./LegalLinks";

// Load the editor and start its session only after agreement. Keep location.hash intact.
const Editor = lazy(async () => ({ default: (await import("../App")).App }));

export function ConsentGate(): ReactElement {
  const [accepted, setAccepted] = useState(readBrowserConsent);
  const [checked, setChecked] = useState(false);
  const [temporary, setTemporary] = useState(false);
  if (accepted) return <>
    {temporary && <div className="consent-storage-note" role="status">同意状態を保存できませんでした。今回は利用できますが、次回は再同意が必要です。</div>}
    <Suspense fallback={<main className="consent-screen" role="status">FabCADを読み込み中…</main>}><Editor /></Suspense>
  </>;
  return <main className="consent-screen">
    <form className="consent-card" onSubmit={(event) => {
      event.preventDefault();
      if (!checked) return;
      setTemporary(!saveBrowserConsent());
      setAccepted(true);
    }}>
      <p className="consent-brand">FabCAD · BETA</p>
      <h1>FabCADへようこそ</h1>
      <p>使い始める前に、利用条件とデータの扱いをご確認ください。</p>
      <ul>
        <li>加工前に寸法・強度・機械の設定と安全性を確認してください。設計や加工結果の正確性は保証していません。</li>
        <li>あなたが作った設計データ・作品の権利はあなたに帰属し、商用利用できます。第三者の権利には配慮してください。</li>
        <li>設計はこのブラウザに保存されます。大切なデータはファイルとして保存してください。共有URLを知る人は設計を読み取れます。</li>
      </ul>
      <LegalLinks />
      <label className="consent-check"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
        <span>利用規約に同意し、プライバシーポリシーを確認しました。</span>
      </label>
      <button className="btn primary consent-start" type="submit" disabled={!checked}>FabCADを使い始める</button>
      <p className="consent-version">規約バージョン {TERMS_VERSION}</p>
    </form>
  </main>;
}
