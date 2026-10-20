"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { UserRef } from "@tier0/shared-moderation";
import { MoreIcon } from "../Icons";
import { isContextMenuKey } from "../../lib/menu-position";
import { isMenuUser } from "../../lib/person-menu";
import { anchorFromElement, anchorFromEvent, leaveNativeMenu, menuUserOf, useModMenu } from "./menu-context";
import "./person-menu.css";

interface Props {
  user: UserRef;
  children: ReactNode;
  /** Adds the small "..." button, for touch and for people who do not right-click. */
  button?: boolean;
  /** The button is a tab stop. Left off where the content is already a focusable link, which opens the menu itself from the keyboard. */
  buttonTabbable?: boolean;
}

/**
 * Gives whatever it wraps the person menu: right-click, the context menu key,
 * Shift+F10 and, where asked, a "..." button. Outside a server's dashboard, for
 * the bot acting as automod, and for an id that is not a Discord user, it
 * renders the children and nothing else. The shared Avatar and UserChip use it,
 * so every place that draws a person gets the menu without its own code.
 */
export function PersonMenuArea({ user, children, button = false, buttonTabbable = false }: Props) {
  const menu = useModMenu();
  if (!menu || !isMenuUser(user)) return <>{children}</>;
  const target = menuUserOf(user);
  const name = user.name ?? "this member";

  function onContextMenu(event: MouseEvent) {
    if (event.defaultPrevented || leaveNativeMenu(event)) return;
    event.preventDefault();
    event.stopPropagation();
    menu?.openPerson(target, anchorFromEvent(event));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!isContextMenuKey(event.nativeEvent) || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    menu?.openPerson(target, anchorFromElement(event.target instanceof Element ? event.target : event.currentTarget));
  }

  if (!button) {
    // No box of its own, so wrapping a flex or grid child changes nothing about the layout.
    return (
      <span className="pm-area" onContextMenu={onContextMenu} onKeyDown={onKeyDown}>
        {children}
      </span>
    );
  }

  return (
    <span className="pm-host" onContextMenu={onContextMenu} onKeyDown={onKeyDown}>
      {children}
      <button
        type="button"
        className="pm-more"
        aria-haspopup="menu"
        aria-label={`Actions for ${name}`}
        tabIndex={buttonTabbable ? 0 : -1}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          menu.openPerson(target, anchorFromElement(event.currentTarget));
        }}
      >
        <MoreIcon />
      </button>
    </span>
  );
}

/**
 * Just the "..." button, for a row that lays its own content out. It shows
 * only for someone the menu applies to; the row decides when it is revealed.
 */
export function PersonMenuButton({ user, tabbable = true }: { user: UserRef; tabbable?: boolean }) {
  const menu = useModMenu();
  if (!menu || !isMenuUser(user)) return null;
  return (
    <button
      type="button"
      className="pm-more pm-more--inline"
      aria-haspopup="menu"
      aria-label={`Actions for ${user.name ?? "this member"}`}
      tabIndex={tabbable ? 0 : -1}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        menu.openPerson(menuUserOf(user), anchorFromElement(event.currentTarget));
      }}
    >
      <MoreIcon />
    </button>
  );
}
