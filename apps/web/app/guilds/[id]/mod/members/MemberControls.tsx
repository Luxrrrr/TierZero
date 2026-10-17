"use client";

import { useRouter } from "next/navigation";
import { confirmLeave } from "../../../../../lib/unsaved-guard";
import { useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { Select, type SelectOption } from "../../../../../components/form/Select";
import { cleanQuery } from "./params";

/**
 * The toolbar's form. It submits like a plain GET form, but leaves out empty
 * fields and defaults, so the address never carries a stray `q=`.
 */
export function MemberSearchForm({ action, className, children }: { action: string; className: string; children: ReactNode }) {
  const router = useRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = cleanQuery(new FormData(event.currentTarget));
    confirmLeave(() => router.push(query ? `${action}?${query}` : action));
  }
  return (
    <form className={className} method="get" action={action} role="search" onSubmit={submit}>
      {children}
    </form>
  );
}

/** A sort is one choice, not typing, so it applies as soon as it is picked, like the filter chips. */
export function SortSelect({ name, defaultValue, options, label }: { name: string; defaultValue: string; options: SelectOption[]; label: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(defaultValue);
  return (
    <span ref={anchor} className="members-sort-select">
      <Select
        name={name}
        size="sm"
        value={value}
        aria-label={label}
        options={options}
        onChange={(next) => {
          setValue(next);
          // The hidden input takes the new value on the next render, so the form is sent just after.
          setTimeout(() => anchor.current?.closest("form")?.requestSubmit(), 0);
        }}
      />
    </span>
  );
}

/**
 * The member cell holds a real link for keyboard and assistive tech; this
 * only extends the pointer target to the rest of the row.
 */
export function ClickableRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const open = (event: MouseEvent<HTMLTableRowElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("a, button, input, select")) return;
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) {
      window.open(href, "_blank");
      return;
    }
    confirmLeave(() => router.push(href));
  };
  return (
    <tr role="row" onClick={open}>
      {children}
    </tr>
  );
}
