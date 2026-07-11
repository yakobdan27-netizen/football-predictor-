"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home", icon: "🏠", desktopLabel: "Dashboard" },
  { href: "/prediction-log", label: "Log", icon: "📝", desktopLabel: "Prediction Log" },
  { href: "/teams", label: "Teams", icon: "🏆", desktopLabel: "Teams" },
  { href: "/leagues", label: "League", icon: "🌍", desktopLabel: "Leagues" },
  { href: "/ai-learner", label: "AI", icon: "🧠", desktopLabel: "AI Learner" },
  { href: "/recommendation", label: "Reco", icon: "🎯", desktopLabel: "Recommendation" },
  { href: "/combined-odds", label: "Combo", icon: "🎲", desktopLabel: "Combined Odds" },
  { href: "/settings", label: "Set", icon: "⚙️", desktopLabel: "Settings" },
  { href: "/analysis", label: "Stats", icon: "📊", desktopLabel: "Analysis" },
  { href: "/risk", label: "Risk", icon: "🛡️", desktopLabel: "Risk & Eval" },
  { href: "/backtest", label: "Test", icon: "📈", desktopLabel: "Backtest" },
];

export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/leagues") {
      return pathname.startsWith("/leagues") || pathname.startsWith("/league-analysis");
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      <header className="mobile-header">
        <span style={{ fontSize: "1.375rem" }} aria-hidden>⚽</span>
        <span style={{ fontWeight: 700, fontSize: "1rem" }}>Football Predictor</span>
      </header>

      <header className="desktop-header">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span style={{ fontSize: "1.5rem" }}>⚽</span>
            <span style={{ fontWeight: 700, fontSize: "1.125rem" }}>Football Predictor</span>
          </Link>
          <nav className="flex flex-wrap gap-1">
            {links.map(({ href, desktopLabel }) => (
              <Link
                key={href}
                href={href}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "8px",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  background: isActive(href) ? "var(--surface2)" : "transparent",
                  color: isActive(href) ? "var(--accent)" : "var(--muted)",
                }}
              >
                {desktopLabel}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <nav className="bottom-nav" aria-label="Main navigation">
        {links.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className={`bottom-nav-item${isActive(href) ? " active" : ""}`}
            aria-current={isActive(href) ? "page" : undefined}
          >
            <span className="bottom-nav-icon" aria-hidden>{icon}</span>
            <span className="bottom-nav-label">{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
