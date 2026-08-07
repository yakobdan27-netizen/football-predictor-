/**
 * Normalize phone / access-code identity for ext_users.
 * Not a security gate — just a stable label key.
 */

export function normalizePhoneOrCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Access code: alphanumeric, 4–32 chars, no spaces after normalize
  const asCode = trimmed.replace(/\s+/g, "");
  if (/^[A-Za-z0-9_-]{4,32}$/.test(asCode) && !/^\+?\d[\d\s()-]{5,}$/.test(trimmed)) {
    return asCode.toUpperCase();
  }

  const digits = trimmed.replace(/[^\d+]/g, "");
  let normalized = digits;
  if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`;
  if (!normalized.startsWith("+") && /^\d{6,15}$/.test(normalized)) {
    normalized = `+${normalized}`;
  }
  const digitCount = normalized.replace(/\D/g, "").length;
  if (digitCount < 6 || digitCount > 15) return null;
  return normalized;
}
