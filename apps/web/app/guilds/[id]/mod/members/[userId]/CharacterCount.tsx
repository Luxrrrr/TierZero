"use client";

import { useState } from "react";
import { counterAnnouncement, counterTone } from "./timeline";

/**
 * The "120/500" counter beside a text box. The figure itself is hidden from
 * screen readers, which would otherwise read it on every keystroke; a status
 * line beside it speaks only when the writer nears the limit and when they
 * reach it, so the box's maxLength never cuts them off without a word.
 */
export function CharacterCount({ length, limit }: { length: number; limit: number }) {
  const tone = counterTone(length, limit);
  return (
    <>
      <span className="pf-counter" data-tone={tone} aria-hidden="true">
        {length}/{limit}
      </span>
      <span className="pf-sr" role="status">
        <Frozen key={tone} text={counterAnnouncement(length, limit)} />
      </span>
    </>
  );
}

/**
 * Keyed by the tone, so the text is the count at the moment the tone changed
 * and stays put while the writer keeps typing. A live region speaks whenever
 * its text changes, so a running number would be read on every keystroke.
 */
function Frozen({ text }: { text: string }) {
  const [shown] = useState(text);
  return <>{shown}</>;
}
