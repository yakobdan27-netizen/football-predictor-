import { randomUUID } from "node:crypto";
import { getJson, setJson, setJsonEx } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";
import type { TelegramSession, TelegramUser } from "./types";

const SESSION_TTL_SECONDS = 60 * 60 * 6; // 6 hours — create flow is button-heavy

export async function getTelegramUserByTelegramId(
  telegramId: string
): Promise<TelegramUser | null> {
  return getJson<TelegramUser>(KV_KEYS.telegramUser(String(telegramId)));
}

export async function saveTelegramUser(user: TelegramUser): Promise<void> {
  await setJson(KV_KEYS.telegramUser(user.telegramId), user);
  const index =
    (await getJson<string[]>(KV_KEYS.telegramUsersIndex)) ?? [];
  if (!index.includes(user.telegramId)) {
    index.push(user.telegramId);
    await setJson(KV_KEYS.telegramUsersIndex, index);
  }
}

export async function registerTelegramUser(params: {
  telegramId: string;
  username?: string | null;
  displayName?: string | null;
}): Promise<{ user: TelegramUser; created: boolean }> {
  const telegramId = String(params.telegramId);
  const existing = await getTelegramUserByTelegramId(telegramId);
  if (existing) {
    const displayName =
      params.displayName?.trim() ||
      existing.displayName ||
      params.username ||
      `User ${telegramId}`;
    const username = params.username ?? existing.username;
    // Avoid a KV write on every button tap when nothing changed.
    if (
      username === existing.username &&
      displayName === existing.displayName
    ) {
      return { user: existing, created: false };
    }
    const next: TelegramUser = {
      ...existing,
      username,
      displayName,
    };
    await saveTelegramUser(next);
    return { user: next, created: false };
  }

  const user: TelegramUser = {
    id: randomUUID(),
    telegramId,
    username: params.username ?? null,
    displayName:
      params.displayName?.trim() ||
      params.username ||
      `User ${telegramId}`,
    status: "active",
    role: "external_user",
    createdAt: new Date().toISOString(),
  };
  await saveTelegramUser(user);
  return { user, created: true };
}

export async function getUserBatchIds(userId: string): Promise<string[]> {
  return (await getJson<string[]>(KV_KEYS.telegramUserBatches(userId))) ?? [];
}

export async function addUserBatchId(userId: string, batchId: string): Promise<void> {
  const ids = await getUserBatchIds(userId);
  if (!ids.includes(batchId)) {
    ids.push(batchId);
    await setJson(KV_KEYS.telegramUserBatches(userId), ids);
  }
}

export async function getSession(telegramId: string): Promise<TelegramSession | null> {
  return getJson<TelegramSession>(KV_KEYS.telegramSession(String(telegramId)));
}

export async function saveSession(
  telegramId: string,
  session: TelegramSession
): Promise<void> {
  await setJsonEx(
    KV_KEYS.telegramSession(String(telegramId)),
    { ...session, updatedAt: new Date().toISOString() },
    SESSION_TTL_SECONDS
  );
}

export async function clearSession(telegramId: string): Promise<void> {
  await setJson(KV_KEYS.telegramSession(String(telegramId)), {
    step: "idle",
    draftMatches: [],
    updatedAt: new Date().toISOString(),
  } satisfies TelegramSession);
}

export async function emptySession(): Promise<TelegramSession> {
  return {
    step: "idle",
    draftMatches: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Returns true if under daily limit; increments counter. */
export async function checkAndBumpRateLimit(
  telegramId: string,
  maxPerDay = 400
): Promise<{ allowed: boolean; count: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const key = KV_KEYS.telegramRateLimit(String(telegramId), day);
  const count = ((await getJson<number>(key)) ?? 0) + 1;
  await setJsonEx(key, count, 60 * 60 * 26);
  return { allowed: count <= maxPerDay, count };
}

/**
 * Deduplicate Telegram webhook retries (same update_id).
 * Returns true if this update should be processed.
 */
export async function claimTelegramUpdate(updateId: number): Promise<boolean> {
  const key = KV_KEYS.telegramUpdateClaim(updateId);
  const existing = await getJson<number>(key);
  if (existing != null) return false;
  await setJsonEx(key, updateId, 60 * 5);
  return true;
}
