import React from "react";
import ReactDOM from "react-dom/client";

import App from "@/app/App";
import { AppErrorBoundary } from "@/app/AppErrorBoundary";
import { DesktopProviders } from "@/app/providers/DesktopProviders";

import "@/assets/fonts/inconsolata/inconsolata.css";
import "@/assets/fonts/inter/inter.css";
import "@/assets/fonts/newsreader/newsreader.css";
import "@/ui/theme/theme.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DesktopProviders>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </DesktopProviders>
  </React.StrictMode>,
);
