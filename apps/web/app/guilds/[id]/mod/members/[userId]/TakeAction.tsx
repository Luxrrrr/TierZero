"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { MemberProfile, ModActionKind, StaffRole } from "@tier0/core";
import { ChevronDownIcon, ShieldIcon } from "../../../../../../components/Icons";
import { StateIcon } from "../../../../../../components/mod/ModUi";
import { useToast } from "../../../../../../components/Toaster";
import { actionOptions, memberState, successTitle, type ActionOption } from "./actions";
import { ActionFormDialog } from "./ActionForm";
import { useActionContext } from "./useActionContext";
import "./actions.css";

interface Props {
  guildId: string;
  profile: MemberProfile;
  name: string;
  role: StaffRole;
  now: Date;
  timeZone: string;
  /** Whether the viewer can open the server's Moderation settings, to offer the link when the feature is off. */
  canConfigure: boolean;
  /** Called once an action has gone through, before the page re-reads the record. */
  onActed?(kind: ModActionKind): void;
}

/**
 * The profile's "Take action" menu button. It lists only what this role may
 * do to this member right now, and opens one focused dialog per action. The
 * page waits for the bot before showing anything new: these change Discord,
 * so there is no guess shown in the meantime.
 */
export function TakeAction({ guildId, profile, name, role, now, timeZone, canConfigure, onActed }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { state: contextState, load } = useActionContext(guildId);
  const state = memberState(profile, now);
  const switchedOff = contextState.status === "ready" ? contextState.context.disabledActions : [];
  const options = actionOptions(role, state, switchedOff);

  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [dialog, setDialog] = useState<ModActionKind | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Settings that arrive while the menu is open can remove items from it, so
  // the highlighted one is kept within the list, and focus with it.
  const activeIndex = Math.max(0, Math.min(active, options.length - 1));

  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex, options.length]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const fallbackFocus = useCallback(() => triggerRef.current, []);

  if (options.length === 0) return null;

  function openAt(index: number) {
    load();
    setActive(index);
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function choose(option: ActionOption) {
    if (option.unavailable) return;
    load();
    // Focus goes to the trigger first so the dialog returns it there, not to a
    // menu item that no longer exists once the menu closes.
    close(true);
    setDialog(option.kind);
  }

  function onMenuKeyDown(event: ReactKeyboardEvent) {
    const count = options.length;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((activeIndex + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((activeIndex - 1 + count) % count);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(count - 1);
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  const firstHeavy = options.findIndex((option) => option.heavy);

  return (
    <div className="ta">
      <button
        type="button"
        ref={triggerRef}
        className="btn btn-secondary ta-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // Settings load as soon as someone heads for the button, so actions
        // switched off for this server are gone from the menu by the time it opens.
        onPointerEnter={() => load()}
        onFocus={() => load()}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openAt(0);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openAt(options.length - 1);
          }
        }}
      >
        <ShieldIcon />
        <span>Take action</span>
        <ChevronDownIcon className="ta-chevron" />
      </button>

      {open ? (
        <div id={menuId} ref={menuRef} role="menu" aria-label={`Take action on ${name}`} className="popover ta-menu" onKeyDown={onMenuKeyDown}>
          {options.map((option, index) => (
            <MenuItem
              key={option.kind}
              option={option}
              separated={index > 0 && index === firstHeavy}
              active={activeIndex === index}
              itemRef={(node) => {
                itemRefs.current[index] = node;
              }}
              onHover={() => setActive(index)}
              onChoose={() => choose(option)}
            />
          ))}
        </div>
      ) : null}

      {dialog ? (
        <ActionFormDialog
          key={dialog}
          kind={dialog}
          guildId={guildId}
          userId={profile.user.userId}
          name={name}
          member={state}
          contextState={contextState}
          onRetry={() => load(true)}
          canConfigure={canConfigure}
          timeZone={timeZone}
          fallbackFocus={fallbackFocus}
          onClose={() => setDialog(null)}
          onDone={({ caseNumber, notes }) => {
            const kind = dialog;
            setDialog(null);
            toast.push({ kind: "success", title: successTitle(kind, name, caseNumber), detail: notes.length > 0 ? notes.join(" ") : undefined });
            onActed?.(kind);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

interface ItemProps {
  option: ActionOption;
  itemRef(node: HTMLButtonElement | null): void;
  separated: boolean;
  active: boolean;
  onHover(): void;
  onChoose(): void;
}

function MenuItem({ option, itemRef, separated, active, onHover, onChoose }: ItemProps) {
  const labelId = useId();
  const descriptionId = useId();
  const unavailable = option.unavailable !== null;
  return (
    <>
      {separated ? <div role="separator" className="popover-divider" /> : null}
      <button
        type="button"
        role="menuitem"
        ref={itemRef}
        tabIndex={active ? 0 : -1}
        className={"popover-item ta-item" + (active ? " is-active" : "")}
        data-heavy={option.heavy ? "true" : undefined}
        aria-disabled={unavailable || undefined}
        // Named by the label alone and described by the line under it, so a
        // screen reader does not read the description twice.
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        onMouseEnter={onHover}
        onClick={onChoose}
      >
        <span className="mod-actionicon ta-item-icon" data-action={unavailable ? undefined : option.kind} aria-hidden="true">
          <StateIcon action={option.kind} />
        </span>
        <span className="ta-item-text">
          <span className="ta-item-label" id={labelId}>
            {option.label}
          </span>
          <span className="ta-item-desc" id={descriptionId}>
            {option.unavailable ?? option.description}
          </span>
        </span>
      </button>
    </>
  );
}
