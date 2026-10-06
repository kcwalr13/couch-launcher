import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, stackFromUiState } from "./App.tsx";
import { api } from "./api.ts";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  // Restore the saved screen and focus; never wait more than a moment for it.
  const saved = Promise.race([
    api.getUiState().then((r) => r.state),
    new Promise<null>((r) => setTimeout(() => r(null), 1500)),
  ]).catch(() => null);
  saved.then((state) => {
    createRoot(root).render(
      <StrictMode>
        <App initial={stackFromUiState(state)} />
      </StrictMode>,
    );
  });
}
