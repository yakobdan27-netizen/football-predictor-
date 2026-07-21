import type { Context } from "telegraf";
import { Telegraf } from "telegraf";
import {
  LOG_MARKET_MAP,
  pickOptionsForMarket,
} from "@/lib/prediction-log/markets-config";
import { isValidOdds } from "@/lib/prediction-log/odds-bands";
import { saveBatch } from "@/lib/prediction-log/club-store";
import { deriveBatchDateFromMatches } from "@/lib/prediction-log/batch-date";
import { deriveBatchLeague } from "@/lib/prediction-log/match-league";
import type { LogMarketKey } from "@/lib/prediction-log/types";
import { attachFixturesToBatch, resolveUpcomingFixture } from "@/lib/football-api/resolve-upcoming-fixture";
import {
  buildTelegramBatch,
  formatDecisionMessages,
  runDecisionForOwnedBatch,
} from "@/lib/telegram/decision-service";
import {
  CB,
  anotherKeyboard,
  batchesKeyboard,
  confirmKeyboard,
  fixtureKeyboard,
  leagueKeyboard,
  lineKeyboard,
  mainMenuKeyboard,
  marketDefAt,
  marketKeyboard,
  matchProgressLabel,
  needsLine,
  oddsKeyboard,
  pickKeyboard,
} from "@/lib/telegram/entry-keyboards";
import { listLeagues, listTeams } from "@/lib/telegram/team-resolve";
import { TELEGRAM_MAX_BATCH_MATCHES } from "@/lib/telegram/parse-bulk-matches";
import type { TelegramDraftMatch, TelegramSession, TelegramSessionStep, TelegramUser } from "@/lib/telegram/types";
import { listBatchesForUser } from "@/lib/telegram/ownership";
import {
  addUserBatchId,
  checkAndBumpRateLimit,
  clearSession,
  emptySession,
  getSession,
  registerTelegramUser,
  saveSession,
} from "@/lib/telegram/user-store";

const MATCH_BUILD_STEPS: TelegramSessionStep[] = [
  "await_league",
  "await_home",
  "await_away",
  "await_market",
  "await_line",
  "await_pick",
  "await_odds",
  "await_another",
];

async function ensureUser(ctx: Context): Promise<TelegramUser | null> {
  const from = ctx.from;
  if (!from) return null;
  const { user } = await registerTelegramUser({
    telegramId: String(from.id),
    username: from.username ?? null,
    displayName:
      [from.first_name, from.last_name].filter(Boolean).join(" ") ||
      from.username ||
      null,
  });
  return user;
}

/** Answer callback immediately so Telegram does not retry the update. */
async function ack(ctx: Context): Promise<void> {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch {
    // already answered / expired query — ignore
  }
}

async function gate(ctx: Context): Promise<TelegramUser | null> {
  const from = ctx.from;
  if (!from) return null;
  await ack(ctx);
  const rl = await checkAndBumpRateLimit(String(from.id));
  if (!rl.allowed) {
    await ctx.reply("You've hit today's message limit. Please try again tomorrow.");
    return null;
  }
  const user = await ensureUser(ctx);
  if (!user) return null;
  if (user.status === "blocked") {
    await ctx.reply("Access disabled. Contact support if you believe this is an error.");
    return null;
  }
  return user;
}

async function sessionOrEmpty(telegramId: string): Promise<TelegramSession> {
  return (await getSession(telegramId)) ?? (await emptySession());
}

function inCreateFlow(session: TelegramSession): boolean {
  return Boolean(session.draftBatchName);
}

/** Soft-resume: keep create flow alive when user taps an older keyboard. */
async function resumeOrRestart(
  ctx: Context,
  session: TelegramSession,
  tgId: string
): Promise<boolean> {
  if (!inCreateFlow(session)) {
    await ctx.reply(
      "No active batch in progress. Tap Create Batch to start.",
      mainMenuKeyboard()
    );
    return false;
  }
  await promptCurrentStep(ctx, session, tgId);
  return true;
}

async function promptCurrentStep(
  ctx: Context,
  session: TelegramSession,
  tgId: string
): Promise<void> {
  const step = session.step;
  if (step === "await_league" || (inCreateFlow(session) && !session.draftLeague)) {
    session.step = "await_league";
    await saveSession(tgId, session);
    await ctx.reply(
      `${matchProgressLabel(session.draftMatches.length)}\nSelect league:`,
      leagueKeyboard()
    );
    return;
  }
  if (!session.draftLeague) {
    session.step = "await_league";
    await saveSession(tgId, session);
    await ctx.reply("Select league:", leagueKeyboard());
    return;
  }
  if (
    step === "await_home" ||
    step === "await_away" ||
    !session.draftAway
  ) {
    session.step = session.draftHome ? "await_away" : "await_home";
    await saveSession(tgId, session);
    await ctx.reply(
      fixturePrompt(session),
      fixtureKeyboard({
        league: session.draftLeague,
        page: session.listPage ?? 0,
        letter: session.teamLetter,
        selectedHome: session.draftHome,
      })
    );
    return;
  }
  if (step === "await_market") {
    await ctx.reply("Select your market:", marketKeyboard(session.listPage ?? 0));
    return;
  }
  if (step === "await_line" && session.draftMarketKey) {
    const def = LOG_MARKET_MAP[session.draftMarketKey];
    await ctx.reply(`Market: ${def.label}\nSelect line:`, lineKeyboard(def));
    return;
  }
  if (step === "await_pick" && session.draftMarketKey && session.draftHome && session.draftAway) {
    await ctx.reply(
      "Your pick:",
      pickKeyboard(
        session.draftMarketKey,
        session.draftHome,
        session.draftAway,
        session.draftLine
      )
    );
    return;
  }
  if (step === "await_odds") {
    await ctx.reply("Select odds (1.00–3.00):", oddsKeyboard());
    return;
  }
  if (step === "await_another" || step === "await_confirm_batch") {
    if (session.draftMatches.length) {
      await showConfirm(ctx, session, tgId);
    } else {
      session.step = "await_league";
      await saveSession(tgId, session);
      await ctx.reply("Select league:", leagueKeyboard());
    }
    return;
  }
  await ctx.reply(
    `${matchProgressLabel(session.draftMatches.length)}\nSelect league:`,
    leagueKeyboard()
  );
}

function fixturePrompt(session: TelegramSession): string {
  const n = matchProgressLabel(session.draftMatches.length);
  const league = session.draftLeague ?? "";
  if (session.draftHome) {
    return `${n} — ${league}\n\n🏠 HOME: ${session.draftHome}\n✈️ Now tap AWAY on the right column:`;
  }
  return `${n} — ${league}\n\n🏠 left = HOME    ✈️ right = AWAY\nTap HOME first, then AWAY:`;
}

/** Edit the tapped message in place so old buttons cannot be pressed again. */
async function editWizard(
  ctx: Context,
  text: string,
  extra: ReturnType<typeof fixtureKeyboard> | ReturnType<typeof marketKeyboard> | object
): Promise<void> {
  try {
    await ctx.editMessageText(text, extra as never);
  } catch {
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch {
      // ignore
    }
    await ctx.reply(text, extra as never);
  }
}

function clearMatchDraft(session: TelegramSession): void {
  session.draftLeague = undefined;
  session.draftHome = undefined;
  session.draftAway = undefined;
  session.draftMatchDate = undefined;
  session.draftApiFixtureId = undefined;
  session.draftFixtureStatus = undefined;
  session.draftHomeApiTeamId = undefined;
  session.draftAwayApiTeamId = undefined;
  session.draftMarketKey = undefined;
  session.draftLine = undefined;
  session.draftPrediction = undefined;
  session.listPage = 0;
  session.teamLetter = undefined;
  session.awaitingCustomOdds = false;
}

function formatDraftLine(m: TelegramDraftMatch): string {
  const dateBit = m.date ? ` · ${m.date}` : "";
  const head = `${m.homeTeam} vs ${m.awayTeam} — ${m.league}${dateBit}`;
  if (!m.marketKey || !m.prediction || m.odds == null) return head;
  const def = LOG_MARKET_MAP[m.marketKey];
  const pick =
    pickOptionsForMarket(m.marketKey, m.homeTeam, m.awayTeam, m.line).find(
      (o) => o.value === m.prediction
    )?.label ?? m.prediction;
  const lineBit = m.line != null ? ` @ ${m.line}` : "";
  return `${head}\n   ${def.label}${lineBit}: ${pick} @ ${m.odds.toFixed(2)}`;
}

function previewText(batchName: string, matches: TelegramDraftMatch[]): string {
  const lines = matches.map((m, i) => `${i + 1}. ${formatDraftLine(m)}`);
  return `Preview: *${escapeMd(batchName)}* (${matches.length} match${
    matches.length === 1 ? "" : "es"
  })\n\n${lines.join("\n\n")}\n\nSave this batch?`;
}

function escapeMd(s: string): string {
  return s.replace(/([_*`\[])/g, "\\$1");
}

async function startNextMatch(ctx: Context, session: TelegramSession, tgId: string) {
  clearMatchDraft(session);
  session.step = "await_league";
  await saveSession(tgId, session);
  const n = session.draftMatches.length;
  await ctx.reply(
    `${matchProgressLabel(n)}\nSelect league:`,
    leagueKeyboard()
  );
}

let botSingleton: Telegraf | null = null;

export function getTelegramBot(): Telegraf {
  if (botSingleton) return botSingleton;

  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const bot = new Telegraf(token);

  bot.start(async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const rl = await checkAndBumpRateLimit(String(from.id));
    if (!rl.allowed) {
      await ctx.reply("You've hit today's message limit. Please try again tomorrow.");
      return;
    }
    const { user, created } = await registerTelegramUser({
      telegramId: String(from.id),
      username: from.username ?? null,
      displayName:
        [from.first_name, from.last_name].filter(Boolean).join(" ") ||
        from.username ||
        null,
    });
    if (user.status === "blocked") {
      await ctx.reply("Access disabled. Contact support if you believe this is an error.");
      return;
    }
    await clearSession(String(from.id));
    const greet = created
      ? `Welcome, ${user.displayName}! You're registered.`
      : `Welcome back, ${user.displayName}!`;
    await ctx.reply(
      `${greet}\n\nCreate a batch by tapping teams (no typing), then market + odds.\nGet Decision returns the top 3 markets per match.\n\nChoose an option:`,
      mainMenuKeyboard()
    );
  });

  bot.command("menu", async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply("Main menu:", mainMenuKeyboard());
  });

  bot.command("help", async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply(helpText(), mainMenuKeyboard());
  });

  bot.action(CB.menuHome, async (ctx) => {
    if (!(await gate(ctx))) return;
    await clearSession(String(ctx.from!.id));
    await ctx.reply("Main menu:", mainMenuKeyboard());
  });

  bot.action(CB.menuHelp, async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply(helpText(), mainMenuKeyboard());
  });

  bot.action(CB.menuCreate, async (ctx) => {
    if (!(await gate(ctx))) return;
    await saveSession(String(ctx.from!.id), {
      step: "await_batch_name",
      draftMatches: [],
      updatedAt: new Date().toISOString(),
    });
    await ctx.reply("Batch name? (e.g. Saturday card)");
  });

  bot.action(CB.menuBatches, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    const batches = await listBatchesForUser(user.id);
    if (!batches.length) {
      await ctx.reply("No batches yet. Tap Create Batch.", mainMenuKeyboard());
      return;
    }
    const lines = batches
      .map(
        (b, i) =>
          `${i + 1}. ${b.batchName} — ${b.date} — ${b.matches.length} match(es)`
      )
      .join("\n");
    await ctx.reply(`📋 Your batches:\n\n${lines}`, mainMenuKeyboard());
  });

  bot.action(CB.menuDecision, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    const batches = await listBatchesForUser(user.id);
    if (!batches.length) {
      await ctx.reply("No batches yet. Create one first.", mainMenuKeyboard());
      return;
    }
    await saveSession(String(ctx.from!.id), {
      step: "await_decision_pick",
      draftMatches: [],
      updatedAt: new Date().toISOString(),
    });
    await ctx.reply(
      "Pick a batch for Decision Maker:",
      batchesKeyboard(
        batches.map((b) => ({
          id: b.id,
          batchName: b.batchName,
          matchCount: b.matches.length,
        }))
      )
    );
  });

  bot.action(CB.dateToday, async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply(
      "Match dates are set automatically from fixtures. Tap Create Batch and enter a name.",
      mainMenuKeyboard()
    );
  });

  bot.action(/^lg:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (
      !inCreateFlow(session) &&
      session.step !== "await_league"
    ) {
      await resumeOrRestart(ctx, session, tgId);
      return;
    }
    if (!MATCH_BUILD_STEPS.includes(session.step) && session.step !== "await_league") {
      if (!inCreateFlow(session)) {
        await resumeOrRestart(ctx, session, tgId);
        return;
      }
    }
    const leagues = listLeagues();
    const league = leagues[Number(ctx.match[1])];
    if (!league) {
      await ctx.reply("Unknown league.", leagueKeyboard());
      return;
    }
    session.draftLeague = league;
    session.draftHome = undefined;
    session.draftAway = undefined;
    session.draftMarketKey = undefined;
    session.draftLine = undefined;
    session.draftPrediction = undefined;
    session.listPage = 0;
    session.teamLetter = undefined;
    session.step = "await_home";
    await saveSession(tgId, session);
    await editWizard(
      ctx,
      fixturePrompt(session),
      fixtureKeyboard({ league, page: 0 })
    );
  });

  bot.action(/^tpage:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    await showFixturePage(ctx, Number(ctx.match[1]));
  });

  bot.action(/^tlet:(.+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    await showFixtureLetter(ctx, ctx.match[1]!);
  });

  bot.action(CB.noopAway, async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply("That club is already HOME. Tap a different club on the right (✈️).");
  });

  bot.action(/^home:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (!session.draftLeague || !inCreateFlow(session)) {
      await resumeOrRestart(ctx, session, tgId);
      return;
    }
    const team = listTeams(session.draftLeague)[Number(ctx.match[1])];
    if (!team) {
      await editWizard(
        ctx,
        fixturePrompt(session),
        fixtureKeyboard({
          league: session.draftLeague,
          page: session.listPage ?? 0,
          letter: session.teamLetter,
          selectedHome: session.draftHome,
        })
      );
      return;
    }
    session.draftHome = team;
    session.draftAway = undefined;
    session.draftMarketKey = undefined;
    session.draftLine = undefined;
    session.draftPrediction = undefined;
    session.step = "await_away";
    await saveSession(tgId, session);
    await editWizard(
      ctx,
      fixturePrompt(session),
      fixtureKeyboard({
        league: session.draftLeague,
        page: session.listPage ?? 0,
        letter: session.teamLetter,
        selectedHome: team,
      })
    );
  });

  bot.action(/^away:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (!session.draftLeague || !inCreateFlow(session)) {
      await resumeOrRestart(ctx, session, tgId);
      return;
    }
    if (!session.draftHome) {
      await editWizard(
        ctx,
        `${fixturePrompt(session)}\n\n⚠️ Tap HOME on the left first.`,
        fixtureKeyboard({
          league: session.draftLeague,
          page: session.listPage ?? 0,
          letter: session.teamLetter,
        })
      );
      return;
    }
    const team = listTeams(session.draftLeague)[Number(ctx.match[1])];
    if (!team || team === session.draftHome) {
      await editWizard(
        ctx,
        `${fixturePrompt(session)}\n\n⚠️ Pick a different AWAY club on the right.`,
        fixtureKeyboard({
          league: session.draftLeague,
          page: session.listPage ?? 0,
          letter: session.teamLetter,
          selectedHome: session.draftHome,
        })
      );
      return;
    }
    session.draftAway = team;
    session.listPage = 0;
    session.teamLetter = undefined;
    session.draftMarketKey = undefined;
    session.draftLine = undefined;
    session.draftPrediction = undefined;
    await saveSession(tgId, session);
    await ctx.reply(`Looking up fixture…\n🏠 ${session.draftHome}\n✈️ ${team}`);
    const resolved = await resolveUpcomingFixture({
      homeTeam: session.draftHome,
      awayTeam: team,
      league: session.draftLeague,
    });
    if (!resolved.ok) {
      session.draftAway = undefined;
      await saveSession(tgId, session);
      const sug =
        resolved.error.suggestions?.length
          ? `\nSuggestions: ${resolved.error.suggestions.join(", ")}`
          : "";
      await ctx.reply(
        `${resolved.error.message}${sug}\n\nPick a different away club.`,
        fixtureKeyboard({
          league: session.draftLeague,
          page: session.listPage ?? 0,
          letter: session.teamLetter,
          selectedHome: session.draftHome,
        })
      );
      return;
    }
    session.draftMatchDate = resolved.fixture.matchDate;
    session.draftApiFixtureId = resolved.fixture.apiFixtureId;
    session.draftFixtureStatus = resolved.fixture.fixtureStatus;
    session.draftHomeApiTeamId = resolved.fixture.homeApiTeamId;
    session.draftAwayApiTeamId = resolved.fixture.awayApiTeamId;
    session.step = "await_market";
    await saveSession(tgId, session);
    await ctx.reply(
      `✅ Fixture · ${resolved.fixture.matchDate}\n🏠 ${session.draftHome}\n✈️ ${team}\n🏆 ${session.draftLeague}\n\nSelect your market:`,
      marketKeyboard(0)
    );
  });

  // Legacy callbacks from older keyboards still on screen (pre-fix deploy)
  bot.action(/^th:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply(
      "That button is from an old message. Tap Create Batch again, or use the newest club list (🏠 left / ✈️ right)."
    );
  });
  bot.action(/^ta:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply(
      "That button is from an old message. Use the newest club list — ✈️ right column for AWAY."
    );
  });
  bot.action(/^ph:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply("Old keyboard — use the newest message buttons.");
  });
  bot.action(/^pa:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply("Old keyboard — use the newest message buttons.");
  });
  bot.action(/^lh:(.+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply("Old keyboard — use the newest message buttons.");
  });
  bot.action(/^la:(.+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    await ctx.reply("Old keyboard — use the newest message buttons.");
  });

  bot.action(/^pm:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (!inCreateFlow(session) || !session.draftHome || !session.draftAway) {
      await resumeOrRestart(ctx, session, tgId);
      return;
    }
    session.listPage = Number(ctx.match[1]);
    session.step = "await_market";
    await saveSession(tgId, session);
    await ctx.reply("Select your market:", marketKeyboard(session.listPage));
  });

  bot.action(/^mk:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (
      !inCreateFlow(session) ||
      !session.draftHome ||
      !session.draftAway
    ) {
      await resumeOrRestart(ctx, session, tgId);
      return;
    }
    const def = marketDefAt(Number(ctx.match[1]));
    if (!def) {
      await ctx.reply("Unknown market.", marketKeyboard(0));
      return;
    }
    session.draftMarketKey = def.key;
    session.draftLine = def.defaultLine;
    session.draftPrediction = undefined;
    if (needsLine(def.key)) {
      session.step = "await_line";
      await saveSession(tgId, session);
      await ctx.reply(`Market: ${def.label}\nSelect line:`, lineKeyboard(def));
      return;
    }
    session.step = "await_pick";
    await saveSession(tgId, session);
    await ctx.reply(
      `Market: ${def.label}\nYour pick:`,
      pickKeyboard(def.key, session.draftHome, session.draftAway)
    );
  });

  bot.action(/^ln:(\d+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (
      !inCreateFlow(session) ||
      !session.draftMarketKey ||
      !session.draftHome ||
      !session.draftAway
    ) {
      await resumeOrRestart(ctx, session, tgId);
      return;
    }
    const def = LOG_MARKET_MAP[session.draftMarketKey];
    const line = def.lineOptions?.[Number(ctx.match[1])];
    if (line == null) {
      await ctx.reply("Pick a line.", lineKeyboard(def));
      return;
    }
    session.draftLine = line;
    session.step = "await_pick";
    await saveSession(tgId, session);
    await ctx.reply(
      `Line: ${line}\nYour pick:`,
      pickKeyboard(
        session.draftMarketKey,
        session.draftHome,
        session.draftAway,
        line
      )
    );
  });

  bot.action(/^pk:(.+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (
      !inCreateFlow(session) ||
      !session.draftMarketKey ||
      !session.draftHome ||
      !session.draftAway
    ) {
      await resumeOrRestart(ctx, session, tgId);
      return;
    }
    const value = ctx.match[1]!;
    const opts = pickOptionsForMarket(
      session.draftMarketKey,
      session.draftHome,
      session.draftAway,
      session.draftLine
    );
    if (!opts.some((o) => o.value === value)) {
      await ctx.reply(
        "Pick one of the options.",
        pickKeyboard(
          session.draftMarketKey,
          session.draftHome,
          session.draftAway,
          session.draftLine
        )
      );
      return;
    }
    session.draftPrediction = value;
    session.awaitingCustomOdds = false;
    session.step = "await_odds";
    await saveSession(tgId, session);
    const pickLabel = opts.find((o) => o.value === value)?.label ?? value;
    await ctx.reply(
      `Pick: ${pickLabel}\n\nSelect odds (1.00–3.00) or tap Type odds:`,
      oddsKeyboard()
    );
  });

  bot.action(/^od:(.+)$/, async (ctx) => {
    if (!(await gate(ctx))) return;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (!inCreateFlow(session)) {
      await resumeOrRestart(ctx, session, tgId);
      return;
    }
    const raw = ctx.match[1]!;
    if (raw === "custom") {
      session.awaitingCustomOdds = true;
      session.step = "await_odds";
      await saveSession(tgId, session);
      await ctx.reply("Type decimal odds (e.g. 1.85). Must be between 1.00 and 3.00.");
      return;
    }
    const odds = Number(raw);
    await commitMatchWithOdds(ctx, session, tgId, odds);
  });

  bot.action(CB.anotherYes, async (ctx) => {
    if (!(await gate(ctx))) return;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (!inCreateFlow(session)) {
      await resumeOrRestart(ctx, session, tgId);
      return;
    }
    if (session.draftMatches.length >= TELEGRAM_MAX_BATCH_MATCHES) {
      await showConfirm(ctx, session, tgId);
      return;
    }
    await startNextMatch(ctx, session, tgId);
  });

  bot.action(CB.anotherDone, async (ctx) => {
    if (!(await gate(ctx))) return;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (!inCreateFlow(session) || !session.draftMatches.length) {
      await resumeOrRestart(ctx, session, tgId);
      return;
    }
    await showConfirm(ctx, session, tgId);
  });

  bot.action(CB.confirmSave, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await saveDraftBatch(ctx, user);
  });

  bot.action(CB.confirmCancel, async (ctx) => {
    if (!(await gate(ctx))) return;
    await clearSession(String(ctx.from!.id));
    await ctx.reply("Cancelled. Nothing saved.", mainMenuKeyboard());
  });

  bot.action(/^decision:(.+)$/, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    try {
      await ctx.answerCbQuery("Computing…").catch(() => undefined);
      const result = await runDecisionForOwnedBatch(ctx.match[1]!, user.id);
      for (const msg of formatDecisionMessages(result)) {
        await ctx.reply(msg);
      }
      await ctx.reply(
        "Advisory only — the system never blocks a bet. You decide.",
        mainMenuKeyboard()
      );
    } catch (e) {
      await ctx.reply(
        e instanceof Error ? e.message : "Could not compute decision.",
        mainMenuKeyboard()
      );
    }
    await clearSession(String(ctx.from!.id));
  });

  bot.on("text", async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    const text = (ctx.message.text || "").trim();
    if (text.startsWith("/")) return;

    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);

    if (session.step === "await_batch_name") {
      if (text.length < 2) {
        await ctx.reply("Send a longer batch name.");
        return;
      }
      session.draftBatchName = text.slice(0, 80);
      session.draftMatches = [];
      clearMatchDraft(session);
      await startNextMatch(ctx, session, tgId);
      return;
    }

    if (session.step === "await_odds" && session.awaitingCustomOdds) {
      const odds = Number(text.replace(",", "."));
      await commitMatchWithOdds(ctx, session, tgId, odds);
      return;
    }

    await ctx.reply("Use the buttons to continue — no need to type club names.", mainMenuKeyboard());
  });

  botSingleton = bot;
  return bot;
}

async function showFixturePage(ctx: Context, page: number) {
  const tgId = String(ctx.from!.id);
  const session = await sessionOrEmpty(tgId);
  if (!inCreateFlow(session) || !session.draftLeague) {
    await resumeOrRestart(ctx, session, tgId);
    return;
  }
  session.listPage = page;
  if (!session.draftHome) session.step = "await_home";
  else if (!session.draftAway) session.step = "await_away";
  await saveSession(tgId, session);
  await editWizard(
    ctx,
    fixturePrompt(session),
    fixtureKeyboard({
      league: session.draftLeague,
      page,
      letter: session.teamLetter,
      selectedHome: session.draftHome,
    })
  );
}

async function showFixtureLetter(ctx: Context, letterRaw: string) {
  const tgId = String(ctx.from!.id);
  const session = await sessionOrEmpty(tgId);
  if (!inCreateFlow(session) || !session.draftLeague) {
    await resumeOrRestart(ctx, session, tgId);
    return;
  }
  const letter = letterRaw === "_" ? undefined : letterRaw.toUpperCase();
  session.listPage = 0;
  session.teamLetter = letter;
  if (!session.draftHome) session.step = "await_home";
  else if (!session.draftAway) session.step = "await_away";
  await saveSession(tgId, session);
  await editWizard(
    ctx,
    letter
      ? `${fixturePrompt(session)}\n\nLetter: ${letter}`
      : fixturePrompt(session),
    fixtureKeyboard({
      league: session.draftLeague,
      page: 0,
      letter,
      selectedHome: session.draftHome,
    })
  );
}

async function commitMatchWithOdds(
  ctx: Context,
  session: TelegramSession,
  tgId: string,
  odds: number
) {
  if (
    !session.draftMatchDate ||
    !session.draftApiFixtureId ||
    !session.draftLeague ||
    !session.draftHome ||
    !session.draftAway ||
    !session.draftMarketKey ||
    !session.draftPrediction
  ) {
    await resumeOrRestart(ctx, session, tgId);
    return;
  }
  if (!isValidOdds(odds)) {
    session.awaitingCustomOdds = true;
    await saveSession(tgId, session);
    await ctx.reply("Odds must be between 1.00 and 3.00. Try again or tap a button.", oddsKeyboard());
    return;
  }

  const draft: TelegramDraftMatch = {
    homeTeam: session.draftHome,
    awayTeam: session.draftAway,
    league: session.draftLeague,
    date: session.draftMatchDate,
    apiFixtureId: session.draftApiFixtureId,
    fixtureStatus: session.draftFixtureStatus,
    homeApiTeamId: session.draftHomeApiTeamId,
    awayApiTeamId: session.draftAwayApiTeamId,
    marketKey: session.draftMarketKey as LogMarketKey,
    prediction: session.draftPrediction,
    line: session.draftLine,
    odds,
    confidence: 50,
  };
  session.draftMatches.push(draft);
  clearMatchDraft(session);
  session.step = "await_another";
  await saveSession(tgId, session);

  await ctx.reply(
    `Added:\n${formatDraftLine(draft)}\n\nMatches in batch: ${session.draftMatches.length}/${TELEGRAM_MAX_BATCH_MATCHES}`,
    anotherKeyboard(session.draftMatches.length)
  );
}

async function showConfirm(
  ctx: Context,
  session: TelegramSession,
  tgId: string
) {
  if (!session.draftBatchName || !session.draftMatches.length) {
    await ctx.reply("Add at least one match first.", mainMenuKeyboard());
    return;
  }
  session.step = "await_confirm_batch";
  await saveSession(tgId, session);
  await ctx.reply(previewText(session.draftBatchName, session.draftMatches), {
    parse_mode: "Markdown",
    ...confirmKeyboard(),
  });
}

async function saveDraftBatch(ctx: Context, user: TelegramUser) {
  const tgId = String(ctx.from!.id);
  const session = await sessionOrEmpty(tgId);
  if (
    session.step !== "await_confirm_batch" ||
    !session.draftBatchName ||
    !session.draftMatches.length
  ) {
    await ctx.reply("Nothing to save.", mainMenuKeyboard());
    return;
  }

  const league = deriveBatchLeague(
    session.draftMatches.map((m, i) => ({
      id: `t-${i}`,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      league: m.league,
      predictions: {},
      actualResults: {},
      scored: {},
    }))
  );
  const date = deriveBatchDateFromMatches(
    session.draftMatches.map((m) => ({ matchDate: m.date }))
  );
  let batch = buildTelegramBatch({
    ownerUserId: user.id,
    batchName: session.draftBatchName,
    date,
    league,
    matches: session.draftMatches,
  });
  try {
    batch = await attachFixturesToBatch(batch);
  } catch (e) {
    await ctx.reply(
      e instanceof Error ? e.message : "Could not resolve fixtures for this batch.",
      mainMenuKeyboard()
    );
    return;
  }
  await saveBatch(batch);
  await addUserBatchId(user.id, batch.id);
  await clearSession(tgId);
  await ctx.reply(
    `✅ Batch *${escapeMd(batch.batchName)}* saved (${batch.matches.length} match${
      batch.matches.length === 1 ? "" : "es"
    }).\nUse Get Decision for the engine's top 3 markets per match.`,
    { parse_mode: "Markdown", ...mainMenuKeyboard() }
  );
}

function helpText(): string {
  return [
    "ℹ️ Help",
    "",
    "Create Batch:",
    "1) Name + league (dates come from fixtures)",
    "2) One club list: 🏠 left = HOME, ✈️ right = AWAY",
    "3) Market → line → pick → odds",
    `4) Up to ${TELEGRAM_MAX_BATCH_MATCHES} matches, then Save`,
    "",
    "Get Decision — top 3 markets per match (advisory).",
    "Always use the newest buttons in the chat.",
  ].join("\n");
}

export async function handleTelegramUpdate(update: unknown): Promise<void> {
  const bot = getTelegramBot();
  await bot.handleUpdate(update as Parameters<Telegraf["handleUpdate"]>[0]);
}
