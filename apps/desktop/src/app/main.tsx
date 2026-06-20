import React from "react";
import ReactDOM from "react-dom/client";

import App from "@/app/App";
import { AppErrorBoundary } from "@/app/AppErrorBoundary";
import { DesktopProviders } from "@/app/providers/DesktopProviders";

import "@/assets/fonts/ibm-plex-mono/ibm-plex-mono.css";
import "@/assets/fonts/ibm-plex-sans/ibm-plex-sans.css";
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
