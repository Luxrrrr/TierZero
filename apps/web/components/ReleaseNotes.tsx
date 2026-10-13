import type { ReactNode } from "react";

/**
 * Release notes as written on GitHub, drawn without a markdown library. They use a small part of markdown:
 * headings, bullets, paragraphs, bold, code and links. Everything else shows as plain text, and nothing in the
 * text is ever treated as HTML. Links are only followed when they are https.
 */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const token = match[0];
    if (token.startsWith("**")) out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const href = token.slice(split + 2, -1);
      if (href.startsWith("https://")) {
        out.push(
          <a key={key++} href={href} target="_blank" rel="noreferrer">
            {token.slice(1, split)}
          </a>,
        );
      } else out.push(token.slice(1, split));
    } else if (token.startsWith("https://")) {
      out.push(
        <a key={key++} href={token} target="_blank" rel="noreferrer">
          {token}
        </a>,
      );
    } else out.push(token);
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ReleaseNotes({ body, title }: { body: string; title?: string }) {
  const blocks: ReactNode[] = [];
  const lines = body.replace(/\r/g, "").split("\n");
  let list: string[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={key++}>
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={key++}>{inline(paragraph.join(" "))}</p>);
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      flushParagraph();
      const text = heading[2]!;
      // The notes open with the release's own title, which the page already shows.
      if (heading[1] === "#" && (title === undefined || text.trim() === title.trim())) continue;
      blocks.push(<h4 key={key++}>{inline(text)}</h4>);
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1]!);
    } else if (line.trim() === "") {
      flushList();
      flushParagraph();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushList();
  flushParagraph();

  return <div className="release-notes">{blocks}</div>;
}
