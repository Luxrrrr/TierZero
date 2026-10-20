import { createElement, Fragment, type CSSProperties, type ReactNode } from "react";
import { TRANSCRIPT_URL_ATTRS, TRANSCRIPT_VOID_TAGS, webUrl, type TranscriptNode } from "@tier0/shared-tickets";

/**
 * The transcript tree from `transcriptTree` as React elements. The downloaded
 * file writes the same tree as an HTML string, so the two only differ in how
 * an attribute is spelled. Kept free of JSX and of other dashboard files so a
 * test can render it next to the HTML version and compare them.
 */

const ATTR_NAMES: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  datetime: "dateTime",
  referrerpolicy: "referrerPolicy",
  tabindex: "tabIndex",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
};

const camel = (prop: string) => (prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()));

/** Times are drawn in the reader's zone once the page runs, after the server drew them in UTC. */
const TIME_TAGS = new Set(["time"]);

/** Dashboard controls that sit inside the channel header, which the downloaded file has no use for. */
export interface TranscriptSlots {
  header?: ReactNode;
  /** Controls placed at the end of each message, given the message's Discord id. */
  message?(messageId: string): ReactNode;
}

export function renderTranscriptNode(node: TranscriptNode, key?: number, slots?: TranscriptSlots): ReactNode {
  if (typeof node === "string") return node;
  const props: Record<string, unknown> = { key };
  for (const [name, raw] of Object.entries(node.attrs)) {
    if (raw === null || raw === undefined || raw === false) continue;
    if (TRANSCRIPT_URL_ATTRS.has(name)) {
      const url = webUrl(String(raw));
      if (url) props[name] = url;
      continue;
    }
    // An unchecked box that is never controlled: React must not warn about a missing handler.
    if (node.tag === "input" && name === "type") {
      props.type = raw;
      props.defaultChecked = false;
      continue;
    }
    props[ATTR_NAMES[name] ?? name] = raw === true ? true : raw;
  }
  if (node.style) {
    const style: Record<string, string> = {};
    for (const [prop, value] of Object.entries(node.style)) style[camel(prop)] = value;
    props.style = style as CSSProperties;
  }
  if (TIME_TAGS.has(node.tag)) props.suppressHydrationWarning = true;
  if (TRANSCRIPT_VOID_TAGS.has(node.tag)) return createElement(node.tag, props);
  const children = node.children.map((child, index) => renderTranscriptNode(child, index, slots));
  if (slots?.header && node.attrs.class === "dt-header") children.push(slots.header);
  const id = node.attrs.id;
  if (slots?.message && node.tag === "li" && typeof id === "string" && id.startsWith("dt-")) {
    const extra = slots.message(id.slice(3));
    if (extra) children.push(createElement(Fragment, { key: "message-slot" }, extra));
  }
  return createElement(node.tag, props, ...children);
}
