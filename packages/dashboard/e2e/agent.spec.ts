import { expect, test } from "@playwright/test";
import { mockApi } from "./mock-api";

test("chat-only replies don't offer a video or approval; rendered jobs do", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_1");
  await expect(page.getByRole("heading", { level: 1, name: "Workday planning video" })).toBeVisible();

  const queue = page.getByRole("complementary", { name: "Job queue" });
  const reply = queue.getByRole("article").filter({ hasText: "Question about scripts" });
  await expect(reply.getByText("Answered in the chat")).toBeVisible();
  await expect(reply.getByRole("button", { name: "Approve" })).toHaveCount(0);

  const video = queue.getByRole("article").filter({ hasText: "Planning video" });
  await expect(video.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(video.getByText("1/1 technical checks passed")).toBeVisible();

  expect(api.unexpected).toEqual([]);
});

test("agent replies render Markdown, and typing a brief sends nothing until it is submitted", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_1");
  await expect(page.getByRole("log").locator("strong", { hasText: "German" })).toBeVisible();
  // Typing alone must not send anything.
  await page.getByLabel("Brief for the agent").fill("Mach es kürzer");
  expect(api.calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
  expect(api.unexpected).toEqual([]);
});

test("suggested hooks from winning ads append to the brief, and the script review shows the agent's rationale", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_1");
  const chips = page.getByTestId("suggested-hooks");
  await expect(chips).toContainText("From winning ads:");
  await chips.getByRole("button", { name: /loss framed/ }).click();
  await expect(page.getByLabel("Brief for the agent")).toHaveValue(/^Hook idea: loss framed hook — Like „Hast du den NVDA-Run verpasst\?“/);
  expect(api.calls.some((c) => c.path.endsWith("/messages"))).toBe(false);

  await page.goto("/agent/chat_2");
  const rationale = page.getByTestId("script-rationale");
  await expect(rationale).toContainText("Opens loss-framed because that hook type ranks 1.6× above average");
  await expect(rationale).toContainText("hook_type:loss_framed");
  expect(api.unexpected).toEqual([]);
});
