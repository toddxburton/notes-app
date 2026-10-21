import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      const announce = () => {
        if (registration.waiting) window.dispatchEvent(new CustomEvent("noted-update-ready"));
      };
      announce();
      registration.addEventListener("updatefound", () => {
        registration.installing?.addEventListener("statechange", announce);
      });
    }).catch(() => undefined);
  });
}
