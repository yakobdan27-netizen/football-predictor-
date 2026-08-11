"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import {
  MOBILE_PRIMARY_NAV,
  MORE_NAV,
  PRIMARY_NAV,
  workspacePathActive,
} from "@/lib/navigation/workspace-routes";

export function Nav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTitleId = useId();
  const moreActive = MORE_NAV.some((l) => workspacePathActive(pathname, l.href));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  return (
    <>
      <header className="mobile-header">
        <span style={{ fontSize: "1.375rem" }} aria-hidden>
          ⚽
        </span>
        <span style={{ fontWeight: 700, fontSize: "1rem" }}>Football Predictor</span>
      </header>

      <header className="desktop-header">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span style={{ fontSize: "1.5rem" }}>⚽</span>
            <span style={{ fontWeight: 700, fontSize: "1.125rem" }}>Football Predictor</span>
          </Link>
          <nav className="flex flex-wrap gap-1" aria-label="Primary">
            {PRIMARY_NAV.map(({ href, desktopLabel }) => {
              const active = workspacePathActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  style={{
                    padding: "0.5rem 0.75rem",
                    borderRadius: "8px",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    background: active ? "var(--surface2)" : "transparent",
                    color: active ? "var(--accent)" : "var(--muted)",
                  }}
                >
                  {desktopLabel}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <nav className="bottom-nav" aria-label="Main navigation">
        {MOBILE_PRIMARY_NAV.map(({ href, label, icon }) => {
          const active = workspacePathActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={`bottom-nav-item${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="bottom-nav-icon" aria-hidden>
                {icon}
              </span>
              <span className="bottom-nav-label">{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`bottom-nav-item bottom-nav-more${moreOpen || moreActive ? " active" : ""}`}
          aria-expanded={moreOpen}
          aria-controls={moreTitleId}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <span className="bottom-nav-icon" aria-hidden>
            ▦
          </span>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>

      {moreOpen ? (
        <div className="nav-more-overlay" role="presentation" onClick={() => setMoreOpen(false)}>
          <div
            className="nav-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={moreTitleId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nav-more-handle" aria-hidden />
            <div className="nav-more-head">
              <h2 id={moreTitleId} className="nav-more-title">
                More
              </h2>
              <button
                type="button"
                className="btn btn-secondary nav-more-close"
                onClick={() => setMoreOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="nav-more-grid">
              {MORE_NAV.map(({ href, desktopLabel, icon }) => {
                const active = workspacePathActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`nav-more-link${active ? " active" : ""}`}
                    onClick={() => setMoreOpen(false)}
                  >
                    <span className="nav-more-link-icon" aria-hidden>
                      {icon}
                    </span>
                    <span className="nav-more-link-label">{desktopLabel}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
