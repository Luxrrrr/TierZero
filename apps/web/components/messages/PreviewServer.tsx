"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The server being edited, so every message preview can say its real name. */
export interface PreviewServer {
  name: string;
  memberCount: number;
  /** The server's icon at a size an embed would use, or empty when it has none. */
  iconUrl: string;
  /** What the bot is called on this server. */
  botName?: string;
}

const PreviewServerContext = createContext<PreviewServer | null>(null);

/** Set once around a server's pages; previews outside one keep their sample values. */
export function PreviewServerProvider({ server, children }: { server: PreviewServer | null; children: ReactNode }) {
  return <PreviewServerContext.Provider value={server}>{children}</PreviewServerContext.Provider>;
}

export function usePreviewServer(): PreviewServer | null {
  return useContext(PreviewServerContext);
}

/**
 * The variables a preview takes from the real server rather than from a
 * feature's sample, since a sample such as "Northwind" in someone else's
 * server reads as a mistake.
 */
export function serverVariables(server: PreviewServer | null): Record<string, string> {
  if (!server) return {};
  return {
    server: server.name,
    members: server.memberCount.toLocaleString("en-US"),
    "server.icon": server.iconUrl,
  };
}
