"use client";
import { useRef, useState, type ReactNode } from "react";
import { NavIcon } from "./nav-icon";
export function Sidebar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={toggle}
        className="mobile-menu-button"
        type="button"
        aria-label={open ? "Закрыть меню" : "Открыть меню"}
        aria-expanded={open}
        aria-controls="guild-sidebar"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <NavIcon name="menu" />
      </button>
      {open && (
        <button
          type="button"
          className="sidebar-backdrop"
          tabIndex={-1}
          aria-label="Закрыть навигацию"
          onClick={() => {
            setOpen(false);
            toggle.current?.focus();
          }}
        />
      )}
      <aside
        id="guild-sidebar"
        className="sidebar"
        data-open={open}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            toggle.current?.focus();
          }
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        {children}
      </aside>
    </>
  );
}
