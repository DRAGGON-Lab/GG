import type { ReactNode } from "react";

import { AppSettingsProvider } from "@/features/settings";
import { ThemeProvider } from "@/ui";

export function DesktopProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AppSettingsProvider>{children}</AppSettingsProvider>
    </ThemeProvider>
  );
}
