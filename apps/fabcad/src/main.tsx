import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConsentGate } from "./legal/ConsentGate";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <ConsentGate />
  </StrictMode>,
);
