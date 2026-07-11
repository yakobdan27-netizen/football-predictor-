import { existsSync } from "node:fs";
import type { Browser } from "puppeteer-core";

function guessLocalChromePath(): string | undefined {
  const fromEnv =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    process.env.CHROMIUM_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p) => existsSync(p));
}

/**
 * Launch Chromium for Livescore scraping.
 * On Vercel uses @sparticuz/chromium; locally prefers system Chrome / env path.
 */
export async function launchLivescoreBrowser(): Promise<Browser> {
  const puppeteerMod = await import("puppeteer-core");
  const puppeteer = puppeteerMod.default ?? puppeteerMod;

  const isServerless =
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    !!process.env.VERCEL ||
    process.env.LIVESCORE_FORCE_SPARTICUZ === "1";

  const localPath = !isServerless ? guessLocalChromePath() : undefined;

  if (localPath) {
    return puppeteer.launch({
      executablePath: localPath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }

  const chromiumMod = await import("@sparticuz/chromium");
  const chromium = chromiumMod.default ?? chromiumMod;
  const executablePath = await chromium.executablePath();

  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 720 },
    executablePath,
    headless: true,
  });
}

export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    /* ignore */
  }
}
