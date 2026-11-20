import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// Reload when the page/PWA returns after 2+ minutes in background
let hiddenAt = null;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt >= 120000) window.location.reload();
  else hiddenAt = null;
});

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
