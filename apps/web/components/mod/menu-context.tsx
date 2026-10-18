"use client";

import { createContext, useContext } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { StaffRole, UserRef } from "@tier0/core";
import type { ContextMenuAnchor } from "../ContextMenu";
import { isKeyboardContextMenu } from "../../lib/menu-position";
import type { MenuUser, MessageRef } from "../../lib/person-menu";

/** Where a menu opens, and the control to hand focus back to when it closes. */
export interface OpenAnchor extends ContextMenuAnchor {
  opener: HTMLElement | null;
}

export interface ModMenuApi {
  guildId: string;
  /** The viewer's moderation role. Null means they only get the plain entries. */
  role: StaffRole | null;
  openPerson(user: MenuUser, anchor: OpenAnchor): void;
  openMessage(user: MenuUser, message: MessageRef, anchor: OpenAnchor): void;
}

export const ModMenuContext = createContext<ModMenuApi | null>(null);

/** The menu layer for this server, or null outside it, where nothing gets a menu. */
export function useModMenu(): ModMenuApi | null {
  return useContext(ModMenuContext);
}

export function menuUserOf(user: Pick<UserRef, "userId" | "name" | "inServer">, app = false): MenuUser {
  return { userId: user.userId, name: user.name, inServer: user.inServer, ...(app ? { app: true } : {}) };
}

function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/** Below the element's left edge, which is where a menu opened from the keyboard belongs. */
export function anchorFromElement(element: Element, opener: HTMLElement | null = element instanceof HTMLElement ? element : null): OpenAnchor {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.bottom, via: "keyboard", opener };
}

export function anchorFromEvent(event: ReactMouseEvent): OpenAnchor {
  if (isKeyboardContextMenu(event)) {
    return anchorFromElement(event.target instanceof Element ? event.target : event.currentTarget, focusedElement());
  }
  return { x: event.clientX, y: event.clientY, via: "pointer", opener: focusedElement() };
}

/**
 * Whether the browser's own menu should win. Holding Shift asks for it, as in
 * most browsers, and so does right-clicking text that is selected, where Copy
 * is what the reader wants.
 */
export function leaveNativeMenu(event: ReactMouseEvent): boolean {
  if (event.shiftKey && !isKeyboardContextMenu(event)) return true;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim() !== "" && event.target instanceof Node) {
    try {
      return selection.containsNode(event.target, true);
    } catch {
      return false;
    }
  }
  return false;
}
