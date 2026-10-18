"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ActionTargetDto, ModActionKind, StaffRole } from "@tier0/core";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { CopyIcon, ExternalLinkIcon, UndoIcon, UserIcon } from "../Icons";
import { useToast } from "../Toaster";
import { StateIcon } from "./ModUi";
import { ModMenuContext, type ModMenuApi, type OpenAnchor } from "./menu-context";
import { actionOptions, memberState, readStanding } from "../../app/guilds/[id]/mod/members/[userId]/actions";
import { useActionContext } from "../../app/guilds/[id]/mod/members/[userId]/useActionContext";
import {
  caseHref,
  menuName,
  messageEntries,
  messageEvidence,
  messageLink,
  personEntries,
  type MenuEntry,
  type MenuIconKey,
  type MenuUser,
  type MessageRef,
} from "../../lib/person-menu";

// The form and its styles come in only when an action is chosen.
const ActionDialogHost = dynamic(() => import("./ActionDialogHost").then((module) => module.ActionDialogHost), { ssr: false });

/** A person's standing is kept this long, so opening the menu again on the same person is instant. */
const STANDING_FRESH_MS = 15_000;

type Subject = { kind: "person"; user: MenuUser } | { kind: "message"; user: MenuUser; message: MessageRef };

interface OpenMenu {
  id: number;
  subject: Subject;
  anchor: OpenAnchor;
}

interface OpenDialog {
  kind: ModActionKind;
  user: MenuUser;
  message: MessageRef | null;
  standing: ActionTargetDto | null;
}

interface StandingState {
  userId: string;
  status: "loading" | "ready" | "failed";
  value: ActionTargetDto | null;
}

function iconFor(key: MenuIconKey): ReactNode {
  if (key === "profile") return <UserIcon />;
  if (key === "copy") return <CopyIcon />;
  if (key === "external") return <ExternalLinkIcon />;
  if (key === "reply") return <UndoIcon />;
  return <StateIcon action={key} />;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Blocked or unavailable: fall back to the old selection route.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  } catch {
    return false;
  }
}

/**
 * The right-click menu for one server's dashboard. It sits in the server's
 * layout, so one menu and one action dialog serve every page and a dialog
 * outlives the refresh that follows an action. The viewer's role arrives from
 * the layout, so no chip fetches it: people without a moderation role get the
 * plain entries and nothing else.
 */
export function ModMenuProvider({ guildId, role, canConfigure, children }: { guildId: string; role: StaffRole | null; canConfigure: boolean; children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const { state: contextState, load: loadContext } = useActionContext(guildId);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [standing, setStanding] = useState<StandingState | null>(null);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const counter = useRef(0);
  const known = useRef(new Map<string, { at: number; value: ActionTargetDto }>());

  const api = useMemo<ModMenuApi>(
    () => ({
      guildId,
      role,
      openPerson: (user, anchor) => setMenu({ id: ++counter.current, subject: { kind: "person", user }, anchor }),
      openMessage: (user, message, anchor) => setMenu({ id: ++counter.current, subject: { kind: "message", user, message }, anchor }),
    }),
    [guildId, role],
  );

  // What the bot would refuse for this person is read when the menu opens, together with the
  // server's settings, and the entries stay greyed out until both are in.
  const menuId = menu?.id ?? null;
  useEffect(() => {
    if (!menu || role === null || menu.subject.user.app) return;
    loadContext();
    const userId = menu.subject.user.userId;
    const cached = known.current.get(userId);
    if (cached && Date.now() - cached.at < STANDING_FRESH_MS) {
      setStanding({ userId, status: "ready", value: cached.value });
      return;
    }
    setStanding({ userId, status: "loading", value: null });
    let live = true;
    void (async () => {
      let value: ActionTargetDto | null;
      try {
        const res = await fetch(`/api/guilds/${guildId}/mod/members/${encodeURIComponent(userId)}/standing`, { cache: "no-store" });
        value = res.ok ? readStanding(await res.json().catch(() => null)) : null;
      } catch {
        value = null;
      }
      if (value) known.current.set(userId, { at: Date.now(), value });
      if (live) setStanding({ userId, status: value ? "ready" : "failed", value });
    })();
    return () => {
      live = false;
    };
    // A new menu is a new look; the menu object itself changes with every open.
  }, [menuId, guildId, role]);

  const user = menu?.subject.user ?? null;
  const options = useMemo(() => {
    if (!user || role === null || user.app) return null;
    if (!standing || standing.userId !== user.userId || standing.status === "loading") return null;
    if (contextState.status === "idle" || contextState.status === "loading") return null;
    const state = memberState({ user: { inServer: user.inServer }, infractions: [] }, new Date(), standing.value);
    const switchedOff = contextState.status === "ready" ? contextState.context.disabledActions : [];
    return actionOptions(role, state, switchedOff, standing.value?.blocked ?? {});
  }, [user, role, standing, contextState]);

  const entries = useMemo<MenuEntry[]>(() => {
    if (!menu) return [];
    const { subject } = menu;
    return subject.kind === "person"
      ? personEntries({ guildId, role, user: subject.user, options })
      : messageEntries({ guildId, role, user: subject.user, options, message: subject.message });
  }, [menu, guildId, role, options]);

  function close(returnFocus: boolean) {
    const opener = menu?.anchor.opener ?? null;
    setMenu(null);
    if (returnFocus && opener?.isConnected) opener.focus();
  }

  function choose(entry: MenuEntry) {
    if (entry.disabled || !menu) return;
    const { effect } = entry;
    if (effect.type === "copy") {
      close(true);
      void copyText(effect.text).then((copied) =>
        toast.push(
          copied
            ? { kind: "success", title: effect.done }
            : { kind: "error", title: "Nothing was copied", detail: "The browser did not allow access to the clipboard." },
        ),
      );
    } else if (effect.type === "run") {
      close(false);
      effect.run();
    } else if (effect.type === "href") {
      close(false);
      if (!effect.external) router.push(effect.href);
    } else {
      const subject = menu.subject;
      const current = standing && standing.userId === subject.user.userId ? standing.value : null;
      // Focus goes back first, so the dialog remembers the control that opened the menu.
      close(true);
      setDialog({ kind: effect.kind, user: subject.user, message: subject.kind === "message" ? subject.message : null, standing: current });
    }
  }

  const items: ContextMenuItem[] = entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    icon: iconFor(entry.icon),
    hint: entry.hint,
    disabled: entry.disabled,
    danger: entry.danger,
    separated: entry.separated,
    href: entry.effect.type === "href" ? entry.effect.href : undefined,
    external: entry.effect.type === "href" ? entry.effect.external : undefined,
    onSelect: () => choose(entry),
  }));

  return (
    <ModMenuContext.Provider value={api}>
      {children}
      {menu ? (
        <ContextMenu
          key={menu.id}
          label={menu.subject.kind === "message" ? `Actions for the message from ${menuName(menu.subject.user)}` : `Actions for ${menuName(menu.subject.user)}`}
          items={items}
          anchor={menu.anchor}
          onClose={close}
        />
      ) : null}
      {dialog ? (
        <ActionDialogHost
          guildId={guildId}
          kind={dialog.kind}
          user={dialog.user}
          evidence={dialog.message ? messageEvidence(dialog.message) : undefined}
          messageLink={dialog.message ? messageLink(guildId, dialog.message.channelId, dialog.message.messageId) : undefined}
          standing={dialog.standing}
          contextState={contextState}
          onRetry={() => loadContext(true)}
          canConfigure={canConfigure}
          onClose={() => setDialog(null)}
          onDone={({ caseNumber, notes, title }) => {
            const target = dialog.user;
            setDialog(null);
            known.current.delete(target.userId);
            toast.push({
              kind: "success",
              title,
              detail: notes.length > 0 ? notes.join(" ") : undefined,
              ...(caseNumber !== null ? { href: caseHref(guildId, target.userId, caseNumber), hrefLabel: "View the case" } : {}),
            });
            router.refresh();
          }}
        />
      ) : null}
    </ModMenuContext.Provider>
  );
}
