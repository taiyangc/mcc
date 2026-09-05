"use client";
import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

/** Tracks the OS colour scheme. Panels branch on this instead of Tailwind's `dark:` variant. */
export function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return theme;
}

export default useSystemTheme;
