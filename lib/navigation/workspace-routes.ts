/**
 * Single source of truth for six merged workspaces + legacy redirects.
 * Decision Maker and Prediction Log stay standalone (not in redirect map).
 */

export type WorkspaceId =
  | "match-centre"
  | "combo-centre"
  | "goals-survival"
  | "markets-analysis"
  | "research-validation"
  | "settings-guide"
  | "teams-leagues";

export type WorkspaceTabDef = {
  id: string;
  label: string;
};

export type WorkspaceDef = {
  id: WorkspaceId;
  path: `/${WorkspaceId}`;
  title: string;
  tabs: readonly WorkspaceTabDef[];
};

export const WORKSPACES: readonly WorkspaceDef[] = [
  {
    id: "match-centre",
    path: "/match-centre",
    title: "Match Centre",
    tabs: [
      { id: "live-fixtures", label: "Live & Fixtures" },
      { id: "bets-coupon", label: "Bets Coupon" },
      { id: "next-match", label: "Next Match" },
      { id: "play-coupon", label: "Play Coupon" },
      { id: "slip-builder", label: "Slip Builder" },
    ],
  },
  {
    id: "combo-centre",
    path: "/combo-centre",
    title: "Combo Centre",
    tabs: [
      { id: "combined-odd", label: "Combined Odd" },
      { id: "extended-combo", label: "Extended Combo" },
    ],
  },
  {
    id: "goals-survival",
    path: "/goals-survival",
    title: "Goals & Survival",
    tabs: [
      { id: "half-goals", label: "Half Goals" },
      { id: "total-goals", label: "Total Goals" },
      { id: "survival-ladder", label: "Survival Ladder" },
    ],
  },
  {
    id: "markets-analysis",
    path: "/markets-analysis",
    title: "Markets Analysis",
    tabs: [
      { id: "match-corners", label: "Match Corners" },
      { id: "halftime-corners", label: "Halftime Corners" },
      { id: "draw-either-half", label: "Draw Either Half" },
    ],
  },
  {
    id: "research-validation",
    path: "/research-validation",
    title: "Research & Validation",
    tabs: [
      { id: "analysis", label: "Analysis" },
      { id: "risk-evaluation", label: "Risk & Evaluation" },
      { id: "back-test", label: "Back Test" },
    ],
  },
  {
    id: "settings-guide",
    path: "/settings-guide",
    title: "Settings & Guide",
    tabs: [
      { id: "settings", label: "Settings" },
      { id: "guide", label: "Guide" },
    ],
  },
  {
    id: "teams-leagues",
    path: "/teams-leagues",
    title: "Teams & Leagues",
    tabs: [
      { id: "teams", label: "Teams" },
      { id: "leagues", label: "Leagues" },
    ],
  },
] as const;

/** Standalone pages — never redirected into a workspace. */
export const STANDALONE_PATHS = [
  "/decision-maker",
  "/prediction-log",
] as const;

/** Eight primary nav destinations (desktop). */
export const PRIMARY_NAV = [
  { href: "/match-centre", label: "Match", desktopLabel: "Match Centre", icon: "🏟️" },
  { href: "/combo-centre", label: "Combo", desktopLabel: "Combo Centre", icon: "🎲" },
  { href: "/goals-survival", label: "Goals", desktopLabel: "Goals & Survival", icon: "⚽" },
  {
    href: "/markets-analysis",
    label: "Markets",
    desktopLabel: "Markets Analysis",
    icon: "📐",
  },
  {
    href: "/research-validation",
    label: "Research",
    desktopLabel: "Research & Validation",
    icon: "📊",
  },
  { href: "/settings-guide", label: "Settings", desktopLabel: "Settings & Guide", icon: "⚙️" },
  { href: "/teams-leagues", label: "Teams", desktopLabel: "Teams & Leagues", icon: "🏆" },
  { href: "/decision-maker", label: "Decide", desktopLabel: "Decision Maker", icon: "✅" },
  { href: "/prediction-log", label: "Log", desktopLabel: "Prediction Log", icon: "📝" },
] as const;

/** Always visible on mobile bottom bar (includes both standalones). */
export const MOBILE_PRIMARY_NAV = [
  { href: "/prediction-log", label: "Log", desktopLabel: "Prediction Log", icon: "📝" },
  { href: "/decision-maker", label: "Decide", desktopLabel: "Decision Maker", icon: "✅" },
  { href: "/match-centre", label: "Match", desktopLabel: "Match Centre", icon: "🏟️" },
  { href: "/combo-centre", label: "Combo", desktopLabel: "Combo Centre", icon: "🎲" },
  { href: "/goals-survival", label: "Goals", desktopLabel: "Goals & Survival", icon: "⚽" },
] as const;

/** Labeled More sheet: remaining workspaces + orphan pages. */
export const MORE_NAV = [
  {
    href: "/research-validation",
    label: "Research",
    desktopLabel: "Research & Validation",
    icon: "📊",
  },
  { href: "/settings-guide", label: "Settings", desktopLabel: "Settings & Guide", icon: "⚙️" },
  { href: "/teams-leagues", label: "Teams", desktopLabel: "Teams & Leagues", icon: "🏆" },
  { href: "/", label: "Home", desktopLabel: "Dashboard", icon: "🏠" },
  { href: "/recommendation", label: "Reco", desktopLabel: "Recommendation", icon: "🎯" },
  { href: "/ai-learner", label: "AI", desktopLabel: "AI Learner", icon: "🧠" },
] as const;

/** Legacy path (no query) → workspace path + tab id. */
export const LEGACY_REDIRECTS: Readonly<
  Record<string, { workspace: WorkspaceId; tab: string }>
> = {
  "/live": { workspace: "match-centre", tab: "live-fixtures" },
  "/bets": { workspace: "match-centre", tab: "bets-coupon" },
  "/next-matches": { workspace: "match-centre", tab: "next-match" },
  "/play": { workspace: "match-centre", tab: "play-coupon" },
  "/slips/builder": { workspace: "match-centre", tab: "slip-builder" },
  "/combined-odds": { workspace: "combo-centre", tab: "combined-odd" },
  "/combined-odds-extended": { workspace: "combo-centre", tab: "extended-combo" },
  "/highest-scoring-half": { workspace: "goals-survival", tab: "half-goals" },
  "/total-goals-analysis": { workspace: "goals-survival", tab: "total-goals" },
  "/ladder": { workspace: "goals-survival", tab: "survival-ladder" },
  "/analysis": { workspace: "research-validation", tab: "analysis" },
  "/risk": { workspace: "research-validation", tab: "risk-evaluation" },
  "/backtest": { workspace: "research-validation", tab: "back-test" },
  "/settings": { workspace: "settings-guide", tab: "settings" },
  "/guide": { workspace: "settings-guide", tab: "guide" },
  "/teams": { workspace: "teams-leagues", tab: "teams" },
  "/leagues": { workspace: "teams-leagues", tab: "leagues" },
  "/league-analysis": { workspace: "teams-leagues", tab: "leagues" },
  "/stat": { workspace: "research-validation", tab: "analysis" },
  "/conceded-half-analysis": { workspace: "goals-survival", tab: "half-goals" },
  "/half-comparison-analysis": { workspace: "goals-survival", tab: "half-goals" },
  "/corners-analysis": { workspace: "markets-analysis", tab: "match-corners" },
  "/draw-either-half-analysis": { workspace: "markets-analysis", tab: "draw-either-half" },
};

export function getWorkspace(id: WorkspaceId): WorkspaceDef {
  const w = WORKSPACES.find((x) => x.id === id);
  if (!w) throw new Error(`Unknown workspace: ${id}`);
  return w;
}

export function defaultTabId(workspace: WorkspaceDef): string {
  return workspace.tabs[0]!.id;
}

export function resolveTabId(
  workspace: WorkspaceDef,
  tabParam: string | null | undefined
): string {
  if (tabParam && workspace.tabs.some((t) => t.id === tabParam)) {
    return tabParam;
  }
  return defaultTabId(workspace);
}

export function searchParamsToURLSearchParams(
  params: Record<string, string | string[] | undefined>
): URLSearchParams {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v);
    } else {
      qs.set(key, value);
    }
  }
  return qs;
}

/**
 * Build workspace URL with tab, preserving unrelated query params.
 * Incoming `tab` is overwritten by the target tab.
 */
export function buildWorkspaceUrl(
  workspaceId: WorkspaceId,
  tab: string,
  existing?: Record<string, string | string[] | undefined> | URLSearchParams | string
): string {
  const workspace = getWorkspace(workspaceId);
  const qs =
    existing instanceof URLSearchParams
      ? new URLSearchParams(existing.toString())
      : typeof existing === "string"
        ? new URLSearchParams(
            existing.startsWith("?") ? existing.slice(1) : existing
          )
        : searchParamsToURLSearchParams(existing ?? {});
  qs.set("tab", tab);
  const q = qs.toString();
  return q ? `${workspace.path}?${q}` : `${workspace.path}?tab=${tab}`;
}

export function legacyRedirectTarget(
  legacyPath: string,
  existing?: Record<string, string | string[] | undefined> | URLSearchParams | string
): string | null {
  const mapped = LEGACY_REDIRECTS[legacyPath];
  if (!mapped) return null;
  return buildWorkspaceUrl(mapped.workspace, mapped.tab, existing);
}

export function workspacePathActive(
  pathname: string,
  href: string
): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/decision-maker" || href === "/prediction-log") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
