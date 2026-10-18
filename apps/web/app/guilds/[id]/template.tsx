import type { ReactNode } from "react";

// A template remounts when the segment below it changes, which is what lets
// the page area fade in on a move between sections. Moves inside a section
// are handled by that section's own template.
export default function GuildTemplate({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
