import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { SIDEBAR_ATTRIBUTE, SIDEBAR_STORAGE_KEY } from "../lib/sidebar-state";

export const metadata: Metadata = {
  title: {
    default: "TierZero",
    template: "%s · TierZero",
  },
  description: "Dashboard for a self-hosted TierZero bot.",
};

// Runs before the first paint so a saved light or dark choice is on the
// document by the time anything renders. Storage throws in a browser
// configured to block it, and the system preference is the right fallback.
const THEME_SCRIPT = `try{var t=localStorage.getItem("tierzero-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.removeAttribute("data-theme")}}catch(e){}`;

// The collapsed sidebar is a width, so applying it after paint would show the
// wide sidebar for a frame and then snap. Same guard as above for blocked
// storage; the expanded layout is the default.
const SIDEBAR_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})==="collapsed"){document.documentElement.setAttribute(${JSON.stringify(SIDEBAR_ATTRIBUTE)},"collapsed")}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + SIDEBAR_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
