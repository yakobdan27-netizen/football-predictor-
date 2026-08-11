/**
 * Alias normalization for core_team_alias.
 * NULL-safe; does not invent team mappings.
 */

/** Lowercase, strip punctuation/diacritics-ish, collapse whitespace. */
export function normalizeAlias(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function aliasesEqual(a: string, b: string): boolean {
  return normalizeAlias(a) === normalizeAlias(b);
}
