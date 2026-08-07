"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";

type NavLink = {
  href: string;
  label: string;
  icon: string;
  desktopLabel: string;
};

/** Always visible in the bottom bar (thumb-reachable). */
const primaryLinks: NavLink[] = [
  { href: "/", label: "Home", icon: "🏠", desktopLabel: "Dashboard" },
  { href: "/prediction-log", label: "Log", icon: "📝", desktopLabel: "Prediction Log" },
  { href: "/live", label: "Live", icon: "🔴", desktopLabel: "Live & Fixtures" },
  { href: "/bets", label: "Bets", icon: "🎟️", desktopLabel: "Bets Coupon" },
  { href: "/recommendation", label: "Reco", icon: "🎯", desktopLabel: "Recommendation" },
  { href: "/decision-maker", label: "Decide", icon: "✅", desktopLabel: "Decision Maker" },
];

/** Opened from the More sheet on mobile; still listed in desktop header. */
const moreLinks: NavLink[] = [
  { href: "/next-matches", label: "Next", icon: "📅", desktopLabel: "Next Matches" },
  { href: "/play", label: "Play", icon: "📱", desktopLabel: "Play Coupon" },
  { href: "/teams", label: "Teams", icon: "🏆", desktopLabel: "Teams" },
  { href: "/leagues", label: "League", icon: "🌍", desktopLabel: "Leagues" },
  { href: "/ai-learner", label: "AI", icon: "🧠", desktopLabel: "AI Learner" },
  { href: "/combined-odds", label: "Combo", icon: "🎲", desktopLabel: "Combined Odds" },
  { href: "/combined-odds-extended", label: "Combo+", icon: "➕", desktopLabel: "Extended Combos" },
  { href: "/highest-scoring-half", label: "Half", icon: "⏱️", desktopLabel: "Half Goals" },
  { href: "/ladder", label: "Ladder", icon: "📶", desktopLabel: "Survival Ladder" },
  { href: "/corners-analysis", label: "Corners", icon: "📐", desktopLabel: "Corners" },
  { href: "/analysis", label: "Stats", icon: "📊", desktopLabel: "Analysis" },
  { href: "/risk", label: "Risk", icon: "🛡️", desktopLabel: "Risk & Eval" },
  { href: "/backtest", label: "Test", icon: "📈", desktopLabel: "Backtest" },
  { href: "/settings", label: "Settings", icon: "⚙️", desktopLabel: "Settings" },
  { href: "/guide", label: "Guide", icon: "📖", desktopLabel: "Guide" },
];

const allLinks = [...primaryLinks, ...moreLinks];

function linkIsActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/leagues") {
    return pathname.startsWith("/leagues") || pathname.startsWith("/league-analysis");
  }
  if (href === "/combined-odds") {
    return pathname === "/combined-odds" || pathname.startsWith("/combined-odds/");
  }
  return pathname.startsWith(href);
}

export function Nav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTitleId = useId();
  const moreActive = moreLinks.some((l) => linkIsActive(pathname, l.href));

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
          <nav className="flex flex-wrap gap-1">
            {allLinks.map(({ href, desktopLabel }) => (
              <Link
                key={href}
                href={href}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "8px",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  background: linkIsActive(pathname, href) ? "var(--surface2)" : "transparent",
                  color: linkIsActive(pathname, href) ? "var(--accent)" : "var(--muted)",
                }}
              >
                {desktopLabel}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <nav className="bottom-nav" aria-label="Main navigation">
        {primaryLinks.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className={`bottom-nav-item${linkIsActive(pathname, href) ? " active" : ""}`}
            aria-current={linkIsActive(pathname, href) ? "page" : undefined}
          >
            <span className="bottom-nav-icon" aria-hidden>
              {icon}
            </span>
            <span className="bottom-nav-label">{label}</span>
          </Link>
        ))}
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
                More pages
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
              {moreLinks.map(({ href, label, icon, desktopLabel }) => (
                <Link
                  key={href}
                  href={href}
                  className={`nav-more-link${linkIsActive(pathname, href) ? " active" : ""}`}
                  onClick={() => setMoreOpen(false)}
                >
                  <span className="nav-more-link-icon" aria-hidden>
                    {icon}
                  </span>
                  <span className="nav-more-link-label">{desktopLabel || label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
