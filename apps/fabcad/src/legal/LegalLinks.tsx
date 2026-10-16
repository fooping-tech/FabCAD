import type { ReactElement } from "react";
import { legalUrl } from "./urls";

export function LegalLinks(): ReactElement {
  return <nav className="legal-links" aria-label="利用条件">
    <a href={legalUrl("terms")} target="_blank" rel="noopener noreferrer">利用規約</a>
    <a href={legalUrl("privacy")} target="_blank" rel="noopener noreferrer">プライバシーポリシー</a>
    <a href={legalUrl("licenses")} target="_blank" rel="noopener noreferrer">第三者ライセンス</a>
  </nav>;
}
