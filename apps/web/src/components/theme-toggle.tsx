"use client";
import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
function subscribe(callback: () => void) {
  listeners.add(callback);
  const onStorage = () => {
    const theme = localStorage.getItem("xd-theme");
    document.documentElement.dataset.theme =
      theme === "light" ? "light" : "dark";
    callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}
export function ThemeToggle() {
  const light = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme === "light",
    () => false,
  );
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={light ? "Включить тёмную тему" : "Включить светлую тему"}
      onClick={() => {
        const theme = light ? "dark" : "light";
        document.documentElement.dataset.theme = theme;
        try {
          localStorage.setItem("xd-theme", theme);
        } catch {}
        listeners.forEach((callback) => callback());
      }}
    >
      {light ? "☾" : "☀"}
      <span className="theme-text">{light ? "Тёмная" : "Светлая"}</span>
    </button>
  );
}
