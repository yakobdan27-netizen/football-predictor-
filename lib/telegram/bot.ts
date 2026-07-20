import { Markup, Telegraf } from "telegraf";
import type { Context } from "telegraf";
import {
  buildTelegramBatch,
  formatDecisionMessages,
  runDecisionForOwnedBatch,
} from "@/lib/telegram/decision-service";
import { listBatchesForUser } from "@/lib/telegram/ownership";
import {
  isValidIsoDate,
  listLeagues,
  listTeams,
  resolveTeamInput,
  todayIsoDate,
} from "@/lib/telegram/team-resolve";
import type { TelegramSession, TelegramUser } from "@/lib/telegram/types";
import {
  checkAndBumpRateLimit,
  clearSession,
  emptySession,
  getSession,
  registerTelegramUser,
  saveSession,
  addUserBatchId,
} from "@/lib/telegram/user-store";
import { saveBatch } from "@/lib/prediction-log/club-store";
import { deriveBatchLeague } from "@/lib/prediction-log/match-league";

const CB = {
  menuCreate: "menu:create",
  menuBatches: "menu:batches",
  menuDecision: "menu:decision",
  menuHelp: "menu:help",
  menuHome: "menu:home",
  league: (name: string) => `league:${name}`,
  team: (name: string) => `team:${name}`,
  anotherYes: "another:yes",
  anotherDone: "another:done",
  dateToday: "date:today",
  decision: (batchId: string) => `decision:${batchId}`,
} as const;

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ Create Batch", CB.menuCreate)],
    [Markup.button.callback("📋 My Batches", CB.menuBatches)],
    [Markup.button.callback("🎯 Get Decision", CB.menuDecision)],
    [Markup.button.callback("ℹ️ Help", CB.menuHelp)],
  ]);
}

function leagueKeyboard() {
  const leagues = listLeagues();
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < leagues.length; i += 2) {
    const row = [
      Markup.button.callback(leagues[i]!, CB.league(leagues[i]!)),
    ];
    if (leagues[i + 1]) {
      row.push(Markup.button.callback(leagues[i + 1]!, CB.league(leagues[i + 1]!)));
    }
    rows.push(row);
  }
  rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
  return Markup.inlineKeyboard(rows);
}

function teamKeyboard(league: string, suggestions?: string[]) {
  const teams = (suggestions?.length ? suggestions : listTeams(league)).slice(0, 16);
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < teams.length; i += 2) {
    const row = [Markup.button.callback(teams[i]!, CB.team(teams[i]!))];
    if (teams[i + 1]) {
      row.push(Markup.button.callback(teams[i + 1]!, CB.team(teams[i + 1]!)));
    }
    rows.push(row);
  }
  rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
  return Markup.inlineKeyboard(rows);
}

function anotherKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("➕ Add another", CB.anotherYes),
      Markup.button.callback("✅ Done", CB.anotherDone),
    ],
  ]);
}

function dateKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`Use today (${todayIsoDate()})`, CB.dateToday)],
    [Markup.button.callback("« Menu", CB.menuHome)],
  ]);
}

function batchesKeyboard(
  batches: { id: string; batchName: string; matchCount: number }[],
  prefix: "decision"
) {
  const rows = batches.slice(0, 20).map((b) => [
    Markup.button.callback(
      `${b.batchName} (${b.matchCount})`,
      prefix === "decision" ? CB.decision(b.id) : CB.decision(b.id)
    ),
  ]);
  rows.push([Markup.button.callback("« Menu", CB.menuHome)]);
  return Markup.inlineKeyboard(rows);
}

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

async function gate(ctx: Context): Promise<TelegramUser | null> {
  const from = ctx.from;
  if (!from) return null;

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

let botSingleton: Telegraf | null = null;

export function getTelegramBot(): Telegraf {
  if (botSingleton) return botSingleton;

  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

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
      `${greet}\n\nI can help you create a prediction batch and get Decision Maker picks (3 markets per match).\n\nChoose an option:`,
      mainMenuKeyboard()
    );
  });

  bot.command("menu", async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.reply("Main menu:", mainMenuKeyboard());
  });

  bot.command("help", async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.reply(helpText(), mainMenuKeyboard());
  });

  bot.action(CB.menuHome, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.answerCbQuery();
    await clearSession(String(ctx.from!.id));
    await ctx.reply("Main menu:", mainMenuKeyboard());
  });

  bot.action(CB.menuHelp, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.answerCbQuery();
    await ctx.reply(helpText(), mainMenuKeyboard());
  });

  bot.action(CB.menuCreate, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.answerCbQuery();
    await saveSession(String(ctx.from!.id), {
      step: "await_batch_name",
      draftMatches: [],
      updatedAt: new Date().toISOString(),
    });
    await ctx.reply("What's the batch name? (e.g. Weekend PL picks)");
  });

  bot.action(CB.menuBatches, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.answerCbQuery();
    const batches = await listBatchesForUser(user.id);
    if (!batches.length) {
      await ctx.reply("You have no batches yet. Tap Create Batch to start.", mainMenuKeyboard());
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
    await ctx.answerCbQuery();
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
        })),
        "decision"
      )
    );
  });

  bot.action(/^league:(.+)$/, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.answerCbQuery();
    const league = ctx.match[1]!;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (session.step !== "await_league") {
      await ctx.reply("Use the menu to start Create Batch.", mainMenuKeyboard());
      return;
    }
    session.draftLeague = league;
    session.step = "await_home";
    await saveSession(tgId, session);
    await ctx.reply(
      `League: ${league}\nSelect home team (or type the name):`,
      teamKeyboard(league)
    );
  });

  bot.action(/^team:(.+)$/, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.answerCbQuery();
    const team = ctx.match[1]!;
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    if (session.step === "await_home") {
      session.draftHome = team;
      session.step = "await_away";
      await saveSession(tgId, session);
      await ctx.reply(
        `Home: ${team}\nSelect away team (or type the name):`,
        teamKeyboard(session.draftLeague || "Premier League")
      );
      return;
    }
    if (session.step === "await_away") {
      if (team === session.draftHome) {
        await ctx.reply(
          "Away team must differ from home. Pick again.",
          teamKeyboard(session.draftLeague || "Premier League")
        );
        return;
      }
      session.draftHome = `${session.draftHome}|||${team}`;
      session.step = "await_date";
      await saveSession(tgId, session);
      await ctx.reply(
        `Away: ${team}\nMatch date? Send YYYY-MM-DD or tap Today.`,
        dateKeyboard()
      );
    }
  });

  bot.action(CB.dateToday, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.answerCbQuery();
    await finalizeMatchDate(ctx, user, todayIsoDate());
  });

  bot.action(CB.anotherYes, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.answerCbQuery();
    const tgId = String(ctx.from!.id);
    const session = await sessionOrEmpty(tgId);
    session.step = "await_league";
    session.draftLeague = undefined;
    session.draftHome = undefined;
    await saveSession(tgId, session);
    await ctx.reply("Select league for the next match:", leagueKeyboard());
  });

  bot.action(CB.anotherDone, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.answerCbQuery();
    await saveDraftBatch(ctx, user);
  });

  bot.action(/^decision:(.+)$/, async (ctx) => {
    const user = await gate(ctx);
    if (!user) return;
    await ctx.answerCbQuery("Computing…");
    const batchId = ctx.match[1]!;
    try {
      const result = await runDecisionForOwnedBatch(batchId, user.id);
      const messages = formatDecisionMessages(result);
      for (const msg of messages) {
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
        await ctx.reply("Please send a longer batch name.");
        return;
      }
      session.draftBatchName = text.slice(0, 80);
      session.step = "await_league";
      await saveSession(tgId, session);
      await ctx.reply("Select the league for the first match:", leagueKeyboard());
      return;
    }

    if (session.step === "await_home" || session.step === "await_away") {
      const league = session.draftLeague || "Premier League";
      const resolved = resolveTeamInput(league, text);
      if (!resolved.match) {
        await ctx.reply(
          `Couldn't match "${text}". Pick a suggestion or try again:`,
          teamKeyboard(league, resolved.suggestions)
        );
        return;
      }
      if (session.step === "await_home") {
        session.draftHome = resolved.match;
        session.step = "await_away";
        await saveSession(tgId, session);
        await ctx.reply(
          `Home: ${resolved.match}\nSelect away team (or type the name):`,
          teamKeyboard(league)
        );
        return;
      }
      if (resolved.match === session.draftHome) {
        await ctx.reply("Away must differ from home. Try again.", teamKeyboard(league));
        return;
      }
      session.draftHome = `${session.draftHome}|||${resolved.match}`;
      session.step = "await_date";
      await saveSession(tgId, session);
      await ctx.reply(
        `Away: ${resolved.match}\nMatch date? Send YYYY-MM-DD or tap Today.`,
        dateKeyboard()
      );
      return;
    }

    if (session.step === "await_date") {
      if (!isValidIsoDate(text) && text.toLowerCase() !== "today") {
        await ctx.reply("Send a date as YYYY-MM-DD, or tap Today.", dateKeyboard());
        return;
      }
      const date = text.toLowerCase() === "today" ? todayIsoDate() : text.trim();
      await finalizeMatchDate(ctx, user, date);
      return;
    }

    await ctx.reply("Use the menu buttons to continue.", mainMenuKeyboard());
  });

  botSingleton = bot;
  return bot;
}

async function finalizeMatchDate(
  ctx: Context,
  user: TelegramUser,
  date: string
) {
  const tgId = String(ctx.from!.id);
  const session = await sessionOrEmpty(tgId);
  if (session.step !== "await_date" || !session.draftHome || !session.draftLeague) {
    await ctx.reply("Session expired. Start again from Create Batch.", mainMenuKeyboard());
    return;
  }
  const [home, away] = session.draftHome.split("|||");
  if (!home || !away) {
    await ctx.reply("Missing teams. Start Create Batch again.", mainMenuKeyboard());
    return;
  }
  session.draftMatches.push({
    homeTeam: home,
    awayTeam: away,
    league: session.draftLeague,
    date,
  });
  session.draftHome = undefined;
  session.draftLeague = undefined;
  session.step = "await_another";
  await saveSession(tgId, session);
  await ctx.reply(
    `Added ${home} vs ${away} (${date}).\nMatches so far: ${session.draftMatches.length}.\nAdd another?`,
    anotherKeyboard()
  );
}

async function saveDraftBatch(ctx: Context, user: TelegramUser) {
  const tgId = String(ctx.from!.id);
  const session = await sessionOrEmpty(tgId);
  if (!session.draftBatchName || !session.draftMatches.length) {
    await ctx.reply("Nothing to save. Create a batch first.", mainMenuKeyboard());
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
  const date = session.draftMatches[0]!.date;
  const batch = buildTelegramBatch({
    ownerUserId: user.id,
    batchName: session.draftBatchName,
    date,
    league,
    matches: session.draftMatches,
  });
  await saveBatch(batch);
  await addUserBatchId(user.id, batch.id);
  await clearSession(tgId);
  await ctx.reply(
    `✅ Batch *${batch.batchName}* saved with ${batch.matches.length} match(es).\nUse Get Decision to see top 3 markets per match.`,
    { parse_mode: "Markdown", ...mainMenuKeyboard() }
  );
}

function helpText(): string {
  return [
    "ℹ️ Help",
    "",
    "This bot gives external access to two features only:",
    "• Create Batch — add your matches",
    "• Get Decision — see Decision Maker's top 3 markets per match",
    "",
    "You only see your own batches. Analysis pages, auto-fill, and admin tools are not available here.",
    "Decisions are advisory — the system never blocks a bet.",
  ].join("\n");
}

export async function handleTelegramUpdate(update: unknown): Promise<void> {
  const bot = getTelegramBot();
  await bot.handleUpdate(update as Parameters<Telegraf["handleUpdate"]>[0]);
}
