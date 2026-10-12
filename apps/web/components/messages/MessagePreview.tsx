"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { applyVariablesToMessage, isHexColor, isHttpUrl, type MessageBody, type MessageEmbed, type VariableValues } from "@tier0/core";
import { useChannels, useRoles } from "../form";

export interface PreviewContext {
  guildId: string;
  botName: string;
  /** Stand-ins for the variables, so the preview reads like the real message. */
  variables: VariableValues;
}

/**
 * What a message will look like in Discord, drawn from the draft. The colours
 * are Discord's, not the dashboard's, because the point is to show what members
 * will see there. Variables are filled in, times are shown in the viewer's own
 * timezone the way Discord does, and a role or channel mention shows its name.
 */
export function MessagePreview({ message, context, ephemeral = false }: { message: MessageBody; context: PreviewContext; ephemeral?: boolean }) {
  const { roles } = useRoles(context.guildId);
  const { channels } = useChannels(context.guildId);
  const names = useMemo(
    () => ({
      roles: new Map(roles.map((role) => [role.id, { name: role.name, color: role.color }])),
      channels: new Map(channels.map((channel) => [channel.id, channel.name])),
    }),
    [roles, channels],
  );

  const filled = useMemo(() => applyVariablesToMessage(message, context.variables), [message, context.variables]);
  const hasText = filled.content.trim() !== "";

  return (
    <div className="msg-preview" aria-label="Preview of the message in Discord">
      <span className="msg-preview-avatar" aria-hidden="true">
        {context.botName.charAt(0).toUpperCase()}
      </span>
      <div className="msg-preview-main">
        <p className="msg-preview-author">
          {context.botName} <span className="msg-preview-app">App</span>
          <small>Today at 4:12 PM</small>
        </p>
        {hasText ? <div className="msg-preview-text">{renderMarkdown(filled.content, names)}</div> : null}
        {filled.embeds.map((embed, index) => (
          <EmbedPreview key={index} embed={embed} names={names} />
        ))}
        {filled.buttons.length > 0 || filled.selects.length > 0 ? (
          <div className="msg-components">
            {chunk(filled.buttons, 5).map((row, r) => (
              <div className="msg-buttons" key={r}>
                {row.map((button, index) => {
                  const inner = (
                    <>
                      {button.emoji ? <span className="msg-button-emoji">{renderEmoji(button.emoji)}</span> : null}
                      {button.label}
                      {button.style === "link" ? (
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                        </svg>
                      ) : null}
                    </>
                  );
                  const className = `msg-button is-${button.style}${button.disabled ? " is-disabled" : ""}`;
                  return button.style === "link" ? (
                    <a key={index} className={className} href={isHttpUrl(button.url) && !button.disabled ? button.url : undefined} target="_blank" rel="noreferrer" aria-disabled={button.disabled || undefined}>
                      {inner}
                    </a>
                  ) : (
                    <span key={index} className={className} aria-disabled={button.disabled || undefined}>
                      {inner}
                    </span>
                  );
                })}
              </div>
            ))}
            {filled.selects.map((select, index) => (
              <div key={index} className={select.disabled ? "msg-select is-disabled" : "msg-select"}>
                <span className="msg-select-text">{selectText(select)}</span>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            ))}
          </div>
        ) : null}
        {filled.reactions.length > 0 ? (
          <div className="msg-reactions">
            {filled.reactions.map((reaction, index) => (
              <span key={index} className="msg-reaction">
                {renderEmoji(reaction)} <small>1</small>
              </span>
            ))}
          </div>
        ) : null}
        {ephemeral ? <p className="msg-preview-private">Only you can see this</p> : null}
        {!hasText && filled.embeds.length === 0 ? (
          <p className="msg-preview-empty">Nothing to show yet. Add some text or an embed.</p>
        ) : null}
      </div>
    </div>
  );
}

type Names = {
  roles: Map<string, { name: string; color: string }>;
  channels: Map<string, string>;
};

function EmbedPreview({ embed, names }: { embed: MessageEmbed; names: Names }) {
  const color = isHexColor(embed.color) ? embed.color : "#1e1f22";
  const safe = (value: string) => (isHttpUrl(value) ? value : null);
  const thumbnail = safe(embed.thumbnailUrl);
  const image = safe(embed.imageUrl);
  const authorIcon = safe(embed.authorIconUrl);
  const footerIcon = safe(embed.footerIconUrl);
  const titleLink = safe(embed.url);
  const authorLink = safe(embed.authorUrl);
  const rows = fieldRows(embed);
  const stamp = embed.timestamp === "" ? null : embed.timestamp === "now" ? new Date() : new Date(embed.timestamp);
  const stampText = stamp && !Number.isNaN(stamp.getTime()) ? `Today at ${formatTime(stamp)}` : null;
  const stampFull = stamp && !Number.isNaN(stamp.getTime()) && embed.timestamp !== "now" ? formatDiscordTime(stamp, "f") : stampText;

  return (
    <div className="msg-embed" style={{ borderLeftColor: color }}>
      <div className="msg-embed-body">
        <div className="msg-embed-text">
          {embed.authorName ? (
            <p className="msg-embed-author">
              {authorIcon ? <img src={authorIcon} alt="" /> : null}
              {authorLink ? <a href={authorLink}>{embed.authorName}</a> : embed.authorName}
            </p>
          ) : null}
          {embed.title ? (
            <p className="msg-embed-title">
              {titleLink ? <a href={titleLink}>{renderInline(embed.title, names)}</a> : renderInline(embed.title, names)}
            </p>
          ) : null}
          {embed.description ? <div className="msg-embed-desc">{renderMarkdown(embed.description, names)}</div> : null}
          {rows.length > 0 ? (
            <div className="msg-embed-fields">
              {rows.map((row, i) => (
                <div className="msg-embed-row" key={i} style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
                  {row.map((field, j) => (
                    <div key={j}>
                      <p className="msg-embed-field-name">{renderInline(field.name, names)}</p>
                      <div className="msg-embed-field-value">{renderMarkdown(field.value, names)}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {thumbnail ? <img className="msg-embed-thumb" src={thumbnail} alt="" /> : null}
      </div>
      {image ? <img className="msg-embed-image" src={image} alt="" /> : null}
      {embed.footerText || stampText ? (
        <p className="msg-embed-footer">
          {footerIcon ? <img src={footerIcon} alt="" /> : null}
          {embed.footerText}
          {embed.footerText && stampText ? " • " : null}
          {stampFull}
        </p>
      ) : null}
    </div>
  );
}

/** Inline fields share a row up to three at a time, the way Discord lays them out. */
function fieldRows(embed: MessageEmbed): MessageEmbed["fields"][] {
  const rows: MessageEmbed["fields"][] = [];
  let current: MessageEmbed["fields"] = [];
  for (const field of embed.fields) {
    if (!field.inline) {
      if (current.length > 0) rows.push(current);
      current = [];
      rows.push([field]);
      continue;
    }
    current.push(field);
    if (current.length === 3) {
      rows.push(current);
      current = [];
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/** The viewer's own time, which is what Discord shows everyone: each reader sees their local time. */
export function formatDiscordTime(date: Date, style: string): string {
  const base = date.getTime();
  switch (style) {
    case "t":
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    case "T":
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    case "d":
      return date.toLocaleDateString([], { year: "numeric", month: "numeric", day: "numeric" });
    case "D":
      return date.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
    case "F":
      return `${date.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })} ${formatTime(date)}`;
    case "R": {
      const seconds = Math.round((base - Date.now()) / 1000);
      const steps: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
      const formatter = new Intl.RelativeTimeFormat([], { numeric: "auto" });
      for (const [unit, size] of steps) {
        if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
      }
      return formatter.format(seconds, "second");
    }
    default:
      return `${date.toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })} ${formatTime(date)}`;
  }
}

const formatTime = (date: Date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** A unicode emoji as it is, or one of the server's custom emoji as the image Discord would draw. */
export function renderEmoji(token: string): ReactNode {
  const custom = /^<(a?):(\w+):(\d+)>$/.exec(token);
  if (!custom) return token;
  return <img className="msg-emoji" src={`https://cdn.discordapp.com/emojis/${custom[3]}.${custom[1] ? "gif" : "png"}?size=48`} alt={`:${custom[2]}:`} />;
}

const INLINE =
  /(\|\|[^|]+\|\||\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|`[^`]+`|<t:\d+(?::[tTdDfFR])?>|<@&\d+>|<#\d+>|<@!?\d+>|<a?:\w+:\d+>|@everyone|@here|https?:\/\/[^\s<>]+)/g;

/** One line of Discord formatting. Nothing here can carry markup of its own. */
export function renderInline(text: string, names: Names): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part === "") return null;
    const wrapped = (open: string, node: (children: ReactNode[]) => ReactNode) =>
      part.startsWith(open) && part.endsWith(open) && part.length > open.length * 2
        ? node(renderInline(part.slice(open.length, -open.length), names))
        : undefined;
    const strong = wrapped("**", (c) => <strong key={i}>{c}</strong>);
    if (strong) return strong;
    const under = wrapped("__", (c) => <u key={i}>{c}</u>);
    if (under) return under;
    const strike = wrapped("~~", (c) => <s key={i}>{c}</s>);
    if (strike) return strike;
    const spoiler = wrapped("||", (c) => <span key={i} className="msg-spoiler">{c}</span>);
    if (spoiler) return spoiler;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    const em = wrapped("*", (c) => <em key={i}>{c}</em>) ?? wrapped("_", (c) => <em key={i}>{c}</em>);
    if (em) return em;

    const time = /^<t:(\d+)(?::([tTdDfFR]))?>$/.exec(part);
    if (time?.[1]) return <span key={i} className="msg-mention msg-time">{formatDiscordTime(new Date(Number(time[1]) * 1000), time[2] ?? "f")}</span>;
    const role = /^<@&(\d+)>$/.exec(part);
    if (role?.[1]) {
      const found = names.roles.get(role[1]);
      return <span key={i} className="msg-mention" style={found && found.color && found.color !== "#000000" ? { color: found.color } : undefined}>@{found?.name ?? "role"}</span>;
    }
    const channel = /^<#(\d+)>$/.exec(part);
    if (channel?.[1]) return <span key={i} className="msg-mention">#{names.channels.get(channel[1]) ?? "channel"}</span>;
    if (/^<@!?\d+>$/.test(part)) return <span key={i} className="msg-mention">@user</span>;
    if (/^<a?:\w+:\d+>$/.test(part)) return <Fragment key={i}>{renderEmoji(part)}</Fragment>;
    if (part === "@everyone" || part === "@here") return <span key={i} className="msg-mention">{part}</span>;
    if (/^https?:\/\//.test(part)) return <a key={i} href={isHttpUrl(part) ? part : undefined}>{part}</a>;
    return part;
  });
}

/** Block quotes, code blocks and line breaks, with the inline formatting inside them. */
export function renderMarkdown(text: string, names: Names): ReactNode[] {
  const out: ReactNode[] = [];
  const segments = text.split(/```/);
  segments.forEach((segment, index) => {
    if (index % 2 === 1) {
      // The first line of a fenced block may name a language, which Discord does not show.
      const body = segment.replace(/^[a-zA-Z0-9+-]*\n/, "");
      out.push(<pre key={`code-${index}`} className="msg-codeblock">{body.replace(/\n$/, "")}</pre>);
      return;
    }
    const lines = segment.split("\n");
    lines.forEach((line, lineIndex) => {
      const quote = /^> ?(.*)$/.exec(line);
      const key = `${index}-${lineIndex}`;
      if (quote) {
        out.push(<span key={key} className="msg-quote">{renderInline(quote[1] ?? "", names)}</span>);
      } else if (line !== "" || lineIndex < lines.length - 1) {
        out.push(<Fragment key={key}>{renderInline(line, names)}{lineIndex < lines.length - 1 ? <br /> : null}</Fragment>);
      }
    });
  });
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

const SELECT_DEFAULT: Record<string, string> = {
  string: "Make a selection",
  user: "Select a member",
  role: "Select a role",
  mentionable: "Select a member or role",
  channel: "Select a channel",
};

/** What a closed menu shows: what starts picked, or the placeholder, or Discord's own wording. */
function selectText(select: MessageBody["selects"][number]): string {
  const picked = select.options.filter((option) => option.default).map((option) => option.label);
  if (picked.length > 0) return picked.join(", ");
  return select.placeholder.trim() !== "" ? select.placeholder : (SELECT_DEFAULT[select.kind] ?? "Make a selection");
}
