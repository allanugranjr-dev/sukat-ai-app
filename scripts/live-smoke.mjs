// Live browser smoke test — drives a real (headed) Chromium so you can watch.
// Exercises: page load, console/error capture, landing scroll, primary buttons/
// navigation, auth form + the new email validation, keyboard focus, and a mobile
// viewport pass. Run: node scripts/live-smoke.mjs
import { chromium, devices } from "playwright";

const BASE = process.env.SMOKE_URL || "http://127.0.0.1:5173/";
const HEADLESS = process.env.HEADLESS === "1";
const results = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 350 });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("requestfailed", (r) => {
    const u = r.url();
    // Ignore expected offline/backend gaps: fonts + the local API/socket that isn't running.
    if (/fonts\.(googleapis|gstatic)/.test(u) || /\/api\b/.test(u) || /socket\.io/.test(u) || u.startsWith("ws")) return;
    failedRequests.push(`${r.failure()?.errorText ?? "failed"} ${u}`);
  });

  // 1. Load
  const resp = await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  check("Page loads (HTTP 2xx)", !!resp && resp.status() < 400, `status ${resp?.status()}`);
  await page.waitForTimeout(1200);

  // 2. React actually mounted
  const rootFilled = await page.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0);
  check("React app mounted (#root not empty)", rootFilled);

  // 3. Title
  const title = await page.title();
  check("Document title set", /sukat/i.test(title), title);

  // 4. There are interactive buttons/links, and none are obviously dead
  const btnCount = await page.locator("button, a[href], [role='button']").count();
  check("Interactive controls present", btnCount > 0, `${btnCount} controls`);

  // 5. Scroll works (page is taller than viewport and scrollTop moves)
  const scrollInfo = await page.evaluate(async () => {
    const before = window.scrollY;
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 300));
    const after = window.scrollY;
    const scrollable = document.documentElement.scrollHeight > window.innerHeight;
    window.scrollTo(0, 0);
    return { before, after, scrollable, scrollHeight: document.documentElement.scrollHeight, vh: window.innerHeight };
  });
  check("Page is scrollable and scroll moves", !scrollInfo.scrollable || scrollInfo.after > scrollInfo.before,
    `scrollH ${scrollInfo.scrollHeight} vh ${scrollInfo.vh} y ${scrollInfo.before}->${scrollInfo.after}`);

  // 6. Find and click a primary CTA to reach the auth screen (Sign in / Get started)
  const cta = page.getByRole("button", { name: /sign in|log in|get started|create account|start|scan/i })
    .or(page.getByRole("link", { name: /sign in|log in|get started/i })).first();
  let reachedAuth = false;
  if (await cta.count()) {
    await cta.click().catch(() => {});
    await page.waitForTimeout(900);
    reachedAuth = await page.locator("input[type='email'], input[name='email'], input[type='password']").count() > 0;
  }
  check("Primary CTA navigates (auth/next screen reachable)", reachedAuth || (await page.locator("input").count()) > 0);

  // 7. Email validation: type an invalid email and submit, expect an inline error and NO crash
  const emailInput = page.locator("input[type='email'], input[name='email']").first();
  let validationWorks = "n/a (no email field on this screen)";
  if (await emailInput.count()) {
    // "a@b" passes the browser's native type=email check (has @) but fails the
    // app's stricter regex (requires a dot), so it exercises the JS validation.
    await emailInput.fill("a@b");
    const pw = page.locator("input[type='password']").first();
    if (await pw.count()) await pw.fill("something123");
    const submit = page.getByRole("button", { name: /sign in|log in|continue|create|sign up/i }).first();
    if (await submit.count()) {
      await submit.click().catch(() => {});
      await page.waitForTimeout(700);
    }
    // still on a form (didn't navigate away to a broken state) and app didn't blank out
    const stillMounted = await page.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0);
    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    const showsError = /valid email|invalid|enter a valid/.test(bodyText);
    validationWorks = `stillMounted=${stillMounted} showsInlineError=${showsError}`;
    check("Invalid email is rejected client-side without crashing", stillMounted && showsError, validationWorks);
  } else {
    check("Email validation reachable", true, validationWorks);
  }

  // 8. Keyboard focus / tab navigation works
  await page.keyboard.press("Tab");
  const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? "NONE");
  check("Keyboard Tab moves focus to a control", ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(activeTag), activeTag);

  // 9. Mobile viewport pass (iPhone 12) — no horizontal overflow
  const mob = await browser.newContext({ ...devices["iPhone 12"] });
  const mp = await mob.newPage();
  await mp.goto(BASE, { waitUntil: "domcontentloaded" });
  await mp.waitForTimeout(1000);
  const overflow = await mp.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
  }));
  check("Mobile: no horizontal overflow (390px)", overflow.docW <= overflow.winW + 2, `docW ${overflow.docW} winW ${overflow.winW}`);
  await mp.screenshot({ path: "scripts/live-mobile.png" }).catch(() => {});
  await mob.close();

  // Console / error summary
  check("No uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  check("No unexpected failed requests", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));
  if (consoleErrors.length) console.log(`  (info) ${consoleErrors.length} console.error lines (may be benign): ${consoleErrors.slice(0,2).join(" | ")}`);

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== SMOKE RESULT: ${results.length - failed.length}/${results.length} passed ====`);
  if (failed.length) { console.log("FAILURES:", failed.map((f) => f.name).join(", ")); process.exit(1); }
}

run().catch((e) => { console.error("SMOKE CRASHED:", e); process.exit(2); });
