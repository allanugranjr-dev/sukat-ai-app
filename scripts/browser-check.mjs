import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const playwrightModulePath = "C:/Users/grana/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightModulePath).href);

const artifactDir = "C:/Users/grana/.gemini/antigravity/brain/58c026d3-fe08-429a-ad23-54a91bc35fb9";
if (!fs.existsSync(artifactDir)) {
  fs.mkdirSync(artifactDir, { recursive: true });
}

console.log("Launching system browser for mobile testing...");
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
} catch {
  browser = await chromium.launch({ channel: "chrome", headless: true });
}
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone 14 / mobile viewport
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const page = await context.newPage();

try {
  console.log("1. Navigating to http://127.0.0.1:5173/ ...");
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const screen1 = path.join(artifactDir, "browser_check_01_signin.png");
  await page.screenshot({ path: screen1 });
  console.log("Saved screenshot 1:", screen1);

  console.log("2. Signing in as testcustomer@sukatai.test ...");
  await page.fill('input[name="email"], input[type="email"]', "testcustomer@sukatai.test");
  await page.fill('input[name="password"], input[type="password"]', "Password123!");
  await page.click('button:has-text("Sign in")');

  await page.waitForSelector(".workspace-content, .welcome-banner", { timeout: 10000 });
  await page.waitForTimeout(1200);

  const screen2 = path.join(artifactDir, "browser_check_02_dashboard.png");
  await page.screenshot({ path: screen2 });
  console.log("Saved screenshot 2 (Dashboard & Hero):", screen2);

  console.log("3. Continuing/starting scan...");
  await page.click('.welcome-actions button:first-child, .section-header button', { force: true });
  await page.waitForTimeout(1500);

  // If in prep step:
  const isPrep = await page.$(".pose-coach-banner");
  if (isPrep) {
    console.log("On preparation step...");
    const screen3 = path.join(artifactDir, "browser_check_03_pose_coach.png");
    await page.screenshot({ path: screen3 });
    console.log("Saved screenshot 3 (AI Pose Coach):", screen3);

    const videoBtn = await page.$('.watch-video-btn, button:has-text("Watch 3D Video Demo")');
    if (videoBtn) {
      await videoBtn.click();
      await page.waitForSelector(".pose-video-modal", { timeout: 5000 });
      await page.waitForTimeout(1500);

      const screen4 = path.join(artifactDir, "browser_check_04_video_modal.png");
      await page.screenshot({ path: screen4 });
      console.log("Saved screenshot 4 (3D Video Guide Simulator):", screen4);

      const closeBtn = await page.$('button:has-text("Got it, let\'s scan"), .pose-video-modal .icon-button');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(800);
    }

    const checkboxes = await page.$$('.checklist input[type="checkbox"], .consent-box input[type="checkbox"]');
    for (const cb of checkboxes) {
      await cb.check();
    }
    await page.click('button:has-text("Continue to height")');
    await page.waitForTimeout(1200);
  }

  // If in height step:
  const isHeight = await page.$(".height-presets, #height-value");
  if (isHeight) {
    console.log("On height step...");
    const screen5 = path.join(artifactDir, "browser_check_05_height_presets.png");
    await page.screenshot({ path: screen5 });
    console.log("Saved screenshot 5 (Height Presets & Slider):", screen5);

    await page.fill('#height-value', "170");
    await page.click('button:has-text("Continue to photos")');
    await page.waitForTimeout(1500);
  }

  // Now in capture step:
  await page.waitForSelector(".capture-stage-card, .capture-stage", { timeout: 10000 });
  await page.waitForTimeout(1000);

  console.log("On photo capture step...");
  const screen6 = path.join(artifactDir, "browser_check_06_capture_stage.png");
  await page.screenshot({ path: screen6 });
  console.log("Saved screenshot 6 (Photo Capture Stage):", screen6);

  // Toggle PIP pose reference guide:
  const pipToggle = await page.$('.pose-ref-pill, button:has-text("View Pose Guide")');
  if (pipToggle) {
    await pipToggle.click();
    await page.waitForSelector(".hud-pip-guide", { timeout: 4000 });
    await page.waitForTimeout(500);

    const screen7 = path.join(artifactDir, "browser_check_07_pip_guide.png");
    await page.screenshot({ path: screen7 });
    console.log("Saved screenshot 7 (PIP Pose Guide overlay):", screen7);
  }

  console.log("All mobile browser checks executed and captured successfully!");
} catch (error) {
  console.error("Browser test error:", error);
} finally {
  await browser.close();
}
