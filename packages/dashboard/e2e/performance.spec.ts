import { expect, test } from "@playwright/test";
import { mockApi } from "./mock-api";

test("leaderboard shows winners and losers, filters, and links an ad to a project", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/performance");
  await expect(page.getByRole("heading", { level: 1, name: "Performance" })).toBeVisible();

  const table = page.getByTestId("perf-leaderboard");
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("proj_1_h1_c1_9x16");
  await expect(rows.first()).toContainText("Winner");
  await expect(rows.first().getByRole("link", { name: /Workday planning/ })).toHaveAttribute("href", "/studio/proj_1");
  await expect(rows.nth(1)).toContainText("low volume");
  await expect(rows.nth(2)).toContainText("Loser");

  const show = page.getByRole("group", { name: "Show" });
  await show.getByRole("radio", { name: /Winners/ }).click();
  await expect(rows).toHaveCount(1);
  await show.getByRole("radio", { name: "All" }).click();
  await expect(rows).toHaveCount(3);

  // Open the loser, link it to a project.
  await rows.nth(2).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Old creative");
  await expect(dialog.getByRole("img", { name: /Hook rate over 7 days/ })).toBeVisible();
  await dialog.getByLabel("Linked project").selectOption("proj_1");
  await dialog.getByRole("button", { name: "Save link" }).click();
  await expect(dialog).toBeHidden();
  expect(api.calls.find((c) => c.path === "/api/performance/ads/meta%3A2/link")?.body).toEqual({ projectId: "proj_1" });

  await page.getByTestId("perf-sync").click();
  await expect(page.getByText("3 ads re-scored")).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test("Meta card shows connection and nightly state; the toggle saves the setting", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/performance");
  const card = page.getByTestId("perf-meta-card");
  await expect(card).toContainText("Configured · not synced yet");
  await expect(card).toContainText("Nightly sync after 03:00 · last 2026-10-30");
  await card.getByRole("switch", { name: "Nightly sync" }).click();
  await expect(page.getByText("Nightly sync off")).toBeVisible();
  expect(api.calls.find((c) => c.path === "/api/performance/settings")?.body).toEqual({ nightlyEnabled: false });
  expect(api.unexpected).toEqual([]);
});

test("winning patterns show lift and evidence, a pattern can be excluded, and an ad's teardown opens in its dialog", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/performance");
  const patterns = page.getByTestId("perf-patterns");
  await expect(patterns).toContainText("6 torn down · 1 need a transcript · 1 competitor");
  const cards = patterns.getByTestId("pattern-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("loss_framed");
  await expect(cards.first()).toContainText("1.6× rank");
  await expect(cards.first()).toContainText("Used in prompts");
  await expect(cards.nth(1)).toContainText("Left out of prompts");
  await expect(patterns).toContainText("Hast du den NVDA-Run verpasst?");

  await cards.first().getByRole("switch", { name: /Use pattern loss_framed/ }).click();
  expect(api.calls.find((c) => c.path === "/api/performance/patterns/hook_type%3Aloss_framed/toggle")?.body).toEqual({ disabled: true });

  await patterns.getByTestId("perf-run-teardowns").click();
  await expect(page.getByText("3 ads torn down with 3 LLM calls")).toBeVisible();

  await page.getByTestId("perf-leaderboard").locator("tbody tr").first().click();
  const dialog = page.getByRole("dialog");
  const teardown = dialog.getByTestId("perf-teardown");
  await expect(teardown).toContainText("loss_framed");
  await expect(teardown).toContainText("Cuts/10s 4");
  await expect(teardown).toContainText("Loss framing with a concrete ticker.");
  await teardown.getByRole("button", { name: "Show transcript" }).click();
  await expect(teardown).toContainText("Hol dir den Plan.");
  await teardown.getByRole("button", { name: "Re-run teardown" }).click();
  expect(api.calls.find((c) => c.path === "/api/performance/teardowns/run" && Array.isArray((c.body as { adIds?: string[] }).adIds))?.body).toEqual({ adIds: ["meta:1"] });
  expect(api.unexpected).toEqual([]);
});

test("suggestions inbox separates account actions from brief ideas; accepting records the decision", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/performance");
  const section = page.getByTestId("perf-suggestions");
  const cards = section.getByTestId("suggestion-card");
  await expect(cards).toHaveCount(3);
  await expect(section).toContainText("Account actions · 1");
  await expect(section).toContainText("For the next brief · 2");
  await expect(cards.first()).toContainText('Scale "proj_1_h1_c1_9x16"');
  await expect(cards.first()).toContainText("hook rate 38.0% vs 21.0%");
  await cards.first().getByRole("button", { name: "Accept" }).click();
  expect(api.calls.some((c) => c.path === "/api/performance/suggestions/scale_1/accept")).toBe(true);
  await page.getByRole("group", { name: "Suggestion status" }).getByRole("radio", { name: "Dismissed" }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('Pause "Old creative"');
  expect(api.unexpected).toEqual([]);
});

test("Google card shows its configuration, and the platform strip explains the per-platform ranking", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/performance");
  const card = page.getByTestId("perf-google-card");
  await expect(card).toContainText("Configured · not synced yet");
  await expect(card).toContainText("Customers 1234567890 via MCC 9999999999");
  const strip = page.getByTestId("perf-platforms");
  await expect(strip).toContainText("Meta");
  await expect(strip).toContainText("3 ads · 2 eligible · 1 winner");
  await expect(strip).toContainText("hook 24.7%");
  await expect(strip).toContainText("rank 50.0%");
  await expect(strip).toContainText("Platforms ranked separately");
  expect(api.unexpected).toEqual([]);
});

test("accepted suggestions show their measured outcome; KB briefings list, generate, and hand off to the Agent", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/performance");
  await page.getByRole("group", { name: "Suggestion status" }).getByRole("radio", { name: "Accepted" }).click();
  const outcome = page.getByTestId("perf-suggestions").getByTestId("suggestion-outcome");
  await expect(outcome).toContainText("Improved");
  await expect(outcome).toContainText("hook 20.0% → 26.0%");

  const briefings = page.getByTestId("perf-briefings");
  const card = briefings.getByTestId("briefing-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Verpasste Chancen: Der Markt wartet nicht");
  await expect(card).toContainText("hook_type:loss_framed");
  await expect(card.getByRole("link", { name: "Send to Agent" })).toHaveAttribute("href", /\/agent\?brief=Briefing%20%E2%80%9EVerpasste/);

  await briefings.getByLabel("How many briefings").selectOption("5");
  await briefings.getByTestId("perf-generate-briefings").click();
  await expect(page.getByText("5 briefings written to data/briefings/")).toBeVisible();
  expect(api.calls.find((c) => c.path === "/api/performance/briefings" && c.method === "POST")?.body).toEqual({ count: 5 });
  expect(api.unexpected).toEqual([]);
});
