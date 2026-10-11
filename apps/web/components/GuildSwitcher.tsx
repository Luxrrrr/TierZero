"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronDownIcon } from "./Icons";
import { guildIconUrl, initialsOf } from "../lib/discord-cdn";

const MENU_MIN_WIDTH = 240;

export interface SwitcherGuild {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
}

interface Props {
  guilds: SwitcherGuild[];
  current?: SwitcherGuild;
}

/**
 * The sidebar's server picker. It is a menu rather than a listbox: choosing
 * an entry navigates instead of setting a value, so the roving focus and the
 * Enter-to-activate behavior below follow the menu button pattern.
 */
export function GuildSwitcher({ guilds, current }: Props) {
  const router = useRouter();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  // "All servers" sits at the end of the same roving-focus ring as the guilds,
  // so the count below is one more than the number of servers.
  const itemCount = guilds.length + 1;

  useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.focus();
  }, [open, active]);

  // A fixed menu does not follow its trigger when the layout moves under it.
  // A height-only resize (a mobile address bar sliding away) does not move it.
  useEffect(() => {
    if (!open) return;
    let width = window.innerWidth;
    const dismiss = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      close(true);
    };
    window.addEventListener("resize", dismiss);
    return () => window.removeEventListener("resize", dismiss);
  }, [open]);

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

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  // The menu is fixed to the viewport rather than to the sidebar: in the
  // collapsed rail the trigger is a 48px avatar, and a menu positioned inside
  // it would be clipped to that width.
  function openAt(index: number) {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPlace({ top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, MENU_MIN_WIDTH) });
    }
    setActive(index);
    setOpen(true);
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      // In the mobile drawer the document also listens for Escape to close
      // the whole drawer; this press is only meant for the menu. React's own
      // listener sits on the document in the app router, so stopping
      // propagation is not enough: the drawer's listener is on the same node.
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      close(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % itemCount);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + itemCount) % itemCount);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(itemCount - 1);
      return;
    }
    if (event.key === "Tab") {
      close(false);
    }
  }

  function go(href: string) {
    close(false);
    router.push(href);
  }

  const icon = current ? guildIconUrl(current.id, current.icon, 72) : null;

  return (
    <div className="popover-anchor">
      <button
        type="button"
        ref={triggerRef}
        className="sidebar-guild"
        data-rail-tip={current ? current.name : "Your servers"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openAt(0);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openAt(itemCount - 1);
          }
        }}
      >
        <span className="sidebar-guild-icon" aria-hidden="true">
          {icon ? (
            <img src={icon} alt="" width={36} height={36} />
          ) : current ? (
            initialsOf(current.name)
          ) : (
            "0"
          )}
        </span>
        <span className="sidebar-guild-text">
          <span className="visually-hidden">Switch server: </span>
          <span className="sidebar-guild-name">{current ? current.name : "Your servers"}</span>
          <span className="sidebar-guild-meta">
            {current
              ? `${current.memberCount.toLocaleString()} members`
              : `${guilds.length} ${guilds.length === 1 ? "server" : "servers"}`}
          </span>
        </span>
        <ChevronDownIcon className="sidebar-guild-chevron" />
      </button>

      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="Switch server"
          className="popover popover-fixed"
          style={
            place
              ? {
                  top: place.top,
                  left: place.left,
                  width: place.width,
                  // Bounded by the viewport so the last entries can be
                  // scrolled to when zoomed in.
                  maxHeight: `min(22rem, calc(100dvh - ${place.top}px - 0.5rem))`,
                }
              : undefined
          }
          onKeyDown={onMenuKeyDown}
        >
          {guilds.map((guild, index) => {
            const isCurrent = guild.id === current?.id;
            const guildIcon = guildIconUrl(guild.id, guild.icon, 48);
            return (
              <button
                key={guild.id}
                type="button"
                role="menuitem"
                tabIndex={active === index ? 0 : -1}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className={
                  "popover-item" +
                  (isCurrent ? " is-current" : "") +
                  (active === index ? " is-active" : "")
                }
                onMouseEnter={() => setActive(index)}
                onClick={() => go(`/guilds/${guild.id}`)}
              >
                <span className="avatar" aria-hidden="true">
                  {guildIcon ? (
                    <img src={guildIcon} alt="" width={24} height={24} />
                  ) : (
                    initialsOf(guild.name)
                  )}
                </span>
                <span className="popover-item-text">{guild.name}</span>
                {isCurrent ? (
                  <>
                    <CheckIcon className="check" />
                    <span className="visually-hidden">Currently open</span>
                  </>
                ) : null}
              </button>
            );
          })}

          <div className="popover-divider" role="none" />

          <button
            type="button"
            role="menuitem"
            tabIndex={active === guilds.length ? 0 : -1}
            ref={(node) => {
              itemRefs.current[guilds.length] = node;
            }}
            className={"popover-item" + (active === guilds.length ? " is-active" : "")}
            onMouseEnter={() => setActive(guilds.length)}
            onClick={() => go("/guilds")}
          >
            <span className="popover-item-text">All servers</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
