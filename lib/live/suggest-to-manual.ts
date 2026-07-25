/**
 * Opt-in bridge stub — intentionally does not write batches or manual_results.
 * A future listener may subscribe via onFixtureSettled() and surface suggestions
 * only when a pending batch exists for the exact team pair, respecting
 * existing manual/API precedence (never overwrite manually settled results).
 */
export const LIVE_TO_MANUAL_BRIDGE_ENABLED = false;
