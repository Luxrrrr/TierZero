import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { PrePaint } from "../components/PrePaint";
import { THEME_KEY, prePaintScript, type PrePaintArgs } from "../lib/pre-paint";
import { SIDEBAR_ATTRIBUTE, SIDEBAR_STORAGE_KEY } from "../lib/sidebar-state";

export const metadata: Metadata = {
  title: {
    default: "TierZero",
    template: "%s · TierZero",
  },
  description: "Dashboard for a self-hosted TierZero bot.",
};

const PRE_PAINT: PrePaintArgs = [THEME_KEY, SIDEBAR_STORAGE_KEY, SIDEBAR_ATTRIBUTE];
const PRE_PAINT_SCRIPT = prePaintScript(PRE_PAINT);

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <PrePaint code={PRE_PAINT_SCRIPT} args={PRE_PAINT} />
      </head>
      <body>{children}</body>
    </html>
  );
}
