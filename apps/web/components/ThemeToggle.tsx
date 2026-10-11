"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "./Icons";

type Theme = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "tierzero-theme";

const OPTIONS: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: "system", label: "Match my system", icon: <MonitorIcon /> },
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
];

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private browsing and a blocked storage origin both throw here. The
    // choice still applies to this page; it just will not be remembered.
  }
}

/**
 * Reads the attribute the inline script in the root layout already set. Until
 * the effect has run, the pressed look comes from the stylesheet reading that
 * same attribute (data-theme-option), so the buttons never show the wrong
 * choice and then correct themselves.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const attribute = document.documentElement.getAttribute("data-theme");
    setTheme(attribute === "light" || attribute === "dark" ? attribute : "system");
  }, []);

  return (
    <div className="segmented theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={theme === null ? undefined : theme === option.value}
          aria-label={option.label}
          data-theme-option={option.value}
          data-tip={option.label}
          onClick={() => {
            setTheme(option.value);
            apply(option.value);
          }}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
