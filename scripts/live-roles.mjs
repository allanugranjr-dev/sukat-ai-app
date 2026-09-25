// Live, headed browser test across all three roles (admin / customer / dressmaker).
// Logs into each seeded test account, walks its navigation, and asserts the
// role-specific pages render. Watch it drive a real Chromium window.
//
// Requires: MariaDB (3306), Node backend (3001), Vite --mode node (5173) all up,
// and the three seeded test accounts sharing the password below.
//
// Run:  node scripts/live-roles.mjs        (headed, slow so you can watch)
//       HEADLESS=1 node scripts/live-roles.mjs
import { chromium } from "playwright";

const BASE = process.env.SMOKE_URL || "http://127.0.0.1:5173/";
const HEADLESS = process.env.HEADLESS === "1";
const PASSWORD = process.env.TEST_PASSWORD || "TestPass123!";

const ACCOUNTS = {
  admin: "admin@local.sukatai.test",
  customer: "testcustomer@sukatai.test",
  dressmaker: "tailor@local.sukatai.test",
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function signIn(page, email) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Wait for the app shell (post-login) to appear.
  await page.waitForSelector(".app-shell[data-role]", { timeout: 15000 });
}

async function signOut(page) {
  const logout = page.getByRole("button", { name: "Log out", exact: true }).first();
  if (await logout.count()) {
    await logout.click().catch(() => {});
    await page.waitForSelector("#auth-title, input[type='email']", { timeout: 10000 }).catch(() => {});
  }
}

// Click a left-nav button; if it's a secondary item, open "More" first.
async function nav(page, label) {
  let btn = page.getByRole("button", { name: label, exact: true }).first();
  // Secondary items live behind "More" — they may be absent OR present-but-hidden.
  const visible = (await btn.count()) ? await btn.isVisible().catch(() => false) : false;
  if (!visible) {
    const more = page.getByRole("button", { name: /show more workspace pages|more/i }).first();
    if (await more.count()) { await more.click().catch(() => {}); await page.waitForTimeout(400); }
    btn = page.getByRole("button", { name: label, exact: true }).first();
  }
  if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(700); return true; }
  return false;
}

async function heading(page) {
  const h1 = page.locator("h1").first();
  return (await h1.count()) ? (await h1.innerText()).trim() : "";
}

async function testRole(browser, role, navPlan) {
  const consoleErrors = [];
  const pageErrors = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("dialog", (d) => d.dismiss().catch(() => {})); // don't actually confirm destructive prompts

  console.log(`\n---- ${role.toUpperCase()} (${ACCOUNTS[role]}) ----`);
  try {
    await signIn(page, ACCOUNTS[role]);
    const detectedRole = await page.getAttribute(".app-shell[data-role]", "data-role");
    check(`${role}: login → workspace renders`, detectedRole === role, `data-role=${detectedRole}`);

    for (const [label, expectHeadingRe] of navPlan) {
      const clicked = await nav(page, label);
      const h = await heading(page);
      const ok = clicked && expectHeadingRe.test(h);
      check(`${role}: nav "${label}" → page renders`, ok, `h1="${h}"`);
    }

    await signOut(page);
    const backToAuth = await page.locator("#auth-title, input[type='email']").count() > 0;
    check(`${role}: sign out returns to auth`, backToAuth);

    check(`${role}: no uncaught page errors`, pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
    if (consoleErrors.length) console.log(`  (info) ${consoleErrors.length} console.error lines: ${consoleErrors.slice(0, 2).join(" | ")}`);
  } catch (e) {
    check(`${role}: flow completed without crashing`, false, String(e).slice(0, 200));
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 250 });

  // [nav label, regex the resulting <h1> must match]
  await testRole(browser, "admin", [
    ["Dashboard", /admin dashboard/i],
    ["Customers", /customers/i],
    ["Orders", /all orders/i],
    ["Reports", /reports/i],
    ["Dressmakers", /dressmakers/i],
    ["Invitations", /invite a dressmaker/i],
    ["Settings", /settings/i],
  ]);

  await testRole(browser, "customer", [
    ["Overview", /your measurements/i],
    ["Start a scan", /start a new scan/i],
    ["My measurements", /my measurements/i],
    ["Orders", /my orders/i],
    ["Fittings", /fittings/i],
    ["Profile", /profile/i],
  ]);

  await testRole(browser, "dressmaker", [
    ["Dashboard", /tailor workspace/i],
    ["Measurement reviews", /measurement reviews/i],
    ["Customers", /customer directory/i],
    ["Orders", /order board/i],
    ["Fittings", /fitting schedule/i],
    ["Profile", /profile/i],
  ]);

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ROLE RESULT: ${results.length - failed.length}/${results.length} passed ====`);
  if (failed.length) { console.log("FAILURES:", failed.map((f) => f.name).join(", ")); process.exit(1); }
}

run().catch((e) => { console.error("ROLE TEST CRASHED:", e); process.exit(2); });
