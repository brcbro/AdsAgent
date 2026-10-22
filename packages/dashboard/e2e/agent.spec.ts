import { expect, test } from "@playwright/test";
import { mockApi } from "./mock-api";

test("chat-only replies are compact rows without approval; rendered jobs show the video inline and in the queue", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_1");
  await expect(page.getByRole("heading", { level: 1, name: "Workday planning video" })).toBeVisible();

  const queue = page.getByRole("complementary", { name: "Job queue" });
  const reply = queue.getByTestId("job-reply").filter({ hasText: "Question about scripts" });
  await expect(reply.getByText("Answered in the chat")).toBeVisible();
  await expect(reply.getByRole("button", { name: "Approve" })).toHaveCount(0);

  const video = queue.getByRole("article").filter({ hasText: "Planning video" }).first();
  await expect(video.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(video.getByText("1/1 technical checks passed")).toBeVisible();

  // The same result sits in the conversation, where it is reachable on narrow screens.
  const inline = page.getByRole("log").getByTestId("job-result");
  await expect(inline).toHaveCount(1);
  await expect(inline.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(inline.getByRole("button", { name: "Request changes" })).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test("request changes records a note and drops it into the composer as the next brief", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_1");
  await page.getByRole("log").getByRole("button", { name: "Request changes" }).click();
  const dialog = page.getByRole("dialog", { name: "Request changes" });
  await dialog.getByLabel("What should change").fill("Hook is too slow");
  await dialog.getByRole("button", { name: "Send back for changes" }).click();
  await expect(dialog).toBeHidden();
  expect(api.calls.some((c) => c.path === "/api/agent/jobs/job_video/reject" && (c.body as { note: string }).note === "Hook is too slow")).toBe(true);
  await expect(page.getByLabel("Brief for the agent")).toHaveValue("Hook is too slow");
  await expect(page.getByRole("log").getByText("Changes requested")).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test("agent replies render Markdown, typing a brief sends nothing, and the draft survives switching chats", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_1");
  await expect(page.getByRole("log").locator("strong", { hasText: "German" })).toBeVisible();
  await page.getByLabel("Brief for the agent").fill("Mach es kürzer");
  await page.getByRole("navigation").getByRole("button", { name: /NVDA FOMO hook/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "NVDA FOMO hook" })).toBeVisible();
  await expect(page.getByLabel("Brief for the agent")).toHaveValue("");
  await page.getByRole("navigation").getByRole("button", { name: /Workday planning video/ }).click();
  await expect(page.getByLabel("Brief for the agent")).toHaveValue("Mach es kürzer");
  expect(api.calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
  expect(api.unexpected).toEqual([]);
});

test("suggested hooks append to the brief, and the script review shows rationale, counts and claim findings", async ({ page }) => {
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
  await expect(page.getByTestId("script-chars")).toContainText("/1500 characters");
  await expect(page.getByTestId("script-compliance")).toContainText("Claim check passed");

  const script = page.getByLabel("German script");
  await script.fill("Garantierte Gewinne für alle Anfänger, jeden einzelnen Tag und ohne Vorkenntnisse.");
  await expect(page.getByTestId("script-compliance")).toContainText("1 blocked claim");
  await expect(page.getByRole("button", { name: "Approve & produce" })).toBeDisabled();
  await script.fill("Kurz");
  await expect(page.getByTestId("script-chars")).toContainText("at least 30");
  await expect(page.getByRole("button", { name: "Approve & produce" })).toBeDisabled();
  expect(api.calls.some((c) => c.path.endsWith("/approve"))).toBe(false);
  expect(api.unexpected).toEqual([]);
});

test("sending a brief while a script awaits review asks before replacing it", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_2");
  await page.getByLabel("Brief for the agent").fill("Anderes Thema");
  await page.getByRole("button", { name: "Send brief" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Replace the script awaiting review?");
  expect(api.calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
  await dialog.getByRole("button", { name: "Keep the script" }).click();
  await expect(dialog).toBeHidden();
  expect(api.calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
  expect(api.unexpected).toEqual([]);
});

test("on a phone the queue and chat list open as drawers and the composer folds its options", async ({ page }) => {
  const api = await mockApi(page);
  await page.setViewportSize({ width: 420, height: 780 });
  await page.goto("/agent/chat_1");
  await expect(page.getByRole("complementary", { name: "Job queue" })).toHaveCount(0);
  await page.getByRole("button", { name: /Queue/ }).click();
  const drawer = page.getByRole("dialog", { name: "Job queue" });
  await expect(drawer.getByRole("complementary", { name: "Job queue" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "Chats" }).click();
  await expect(page.getByRole("dialog", { name: "Chats" }).getByRole("button", { name: "New chat" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Brief options" }).click();
  await expect(page.getByRole("group", { name: "Target duration" })).toBeVisible();
  expect(api.unexpected).toEqual([]);
});
