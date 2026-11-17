import { expect, test } from "@playwright/test";
import { mockApi } from "./mock-api";

test("one result per video: the card in the chat has the video and Approve; the Jobs panel tracks progress without repeating them", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_1");
  await expect(page.getByRole("heading", { level: 1, name: "Workday planning video" })).toBeVisible();
  // No permanent queue column: the Jobs panel opens from a button.
  await expect(page.getByRole("complementary", { name: "Jobs" })).toHaveCount(0);

  // The result card in the conversation: one player, one main button, the rest behind the menu.
  const inline = page.getByRole("log").getByTestId("job-result");
  await expect(inline).toHaveCount(1);
  await expect(inline.locator("video")).toHaveCount(1);
  await expect(inline.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(inline.getByRole("button", { name: "Open in Studio" })).toBeVisible();
  await expect(inline.getByRole("button", { name: "Request changes" })).toHaveCount(0);
  await expect(inline.getByText("Technical check passed")).toBeVisible();
  await inline.getByRole("button", { name: "More actions" }).click();
  for (const name of ["Request changes", "German script", "Quality report", "Activity"]) await expect(page.getByRole("menuitem", { name })).toBeVisible();
  await page.getByRole("menuitem", { name: "Quality report" }).click();
  const report = page.getByRole("dialog", { name: "Quality report" });
  await expect(report).toContainText("Decodes");
  await page.keyboard.press("Escape");
  await expect(report).toBeHidden();

  // The Jobs panel: chat-only replies stay quiet rows; the video job has no second player or Approve.
  await page.getByRole("button", { name: /Jobs/ }).click();
  const queue = page.getByRole("complementary", { name: "Jobs" });
  const reply = queue.getByTestId("job-reply").filter({ hasText: "Question about scripts" });
  await expect(reply.getByText("Answered in the chat")).toBeVisible();
  const video = queue.getByRole("article").filter({ hasText: "Planning video" }).first();
  await expect(video.getByText("Technical check passed")).toBeVisible();
  await expect(video.locator("video")).toHaveCount(0);
  await expect(video.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(video.getByRole("button", { name: "Open in Studio" })).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test("request changes records a note and drops it into the composer as the next brief", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_1");
  await page.getByRole("log").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Request changes" }).click();
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
  await page.getByRole("button", { name: "Ideas from winning ads" }).click();
  const ideas = page.getByTestId("suggested-hooks");
  await expect(ideas).toContainText("From winning ads");
  await ideas.getByRole("button", { name: /loss framed/ }).click();
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
  // No local preview mode; the voice follows the presenter (its own voice, ElevenLabs V4).
  await expect(page.getByRole("radio", { name: "Local preview" })).toHaveCount(0);
  // Presenter and voice are one chip: the voice shows when it is opened.
  await page.getByTestId("presenter-picker").click();
  await expect(page.getByTestId("presenter-voice")).toContainText("Anna (avatar's own) · ElevenLabs V4");
  await page.keyboard.press("Escape");
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
  await expect(page.getByRole("complementary", { name: "Jobs" })).toHaveCount(0);
  await page.getByRole("button", { name: /Jobs/ }).click();
  const drawer = page.getByRole("dialog", { name: "Jobs" });
  await expect(drawer.getByRole("complementary", { name: "Jobs" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "Chats" }).click();
  await expect(page.getByRole("dialog", { name: "Chats" }).getByRole("button", { name: "New chat" })).toBeVisible();
  await page.keyboard.press("Escape");
  // The options stay on one row of chips (scrolling sideways) instead of folding into a menu.
  const options = page.getByRole("group", { name: "Video options" });
  await expect(options).toBeVisible();
  await expect(options.getByRole("button", { name: /Video length/ })).toBeVisible();
  await expect(options.getByRole("button", { name: "Review script first" })).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test("a new chat asks what to make; a starter card fills the brief and the length chip", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_3");
  await expect(page.getByRole("heading", { name: "What video do you want to make?" })).toBeVisible();
  await expect(page.getByText("Your German video assistant")).toHaveCount(0);
  await page.getByRole("button", { name: /FOMO for beginners/ }).click();
  await expect(page.getByLabel("Brief for the agent")).toHaveValue(/^Write a punchy 30-second ad about FOMO/);
  await expect(page.getByRole("button", { name: "Video length: 30 seconds" })).toBeVisible();
  // Ideas from winning ads sit next to the cards and add a line to what is typed.
  await page.getByRole("button", { name: "Ideas from winning ads" }).first().click();
  await page.getByTestId("suggested-hooks").getByRole("button", { name: /loss framed/ }).click();
  await expect(page.getByLabel("Brief for the agent")).toHaveValue(/Hook idea: loss framed hook/);
  expect(api.calls.some((c) => c.path.endsWith("/messages"))).toBe(false);
  expect(api.unexpected).toEqual([]);
});

test("the message box is one row of chips: length menu and review toggle change what is sent", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_3");
  await page.getByLabel("Brief for the agent").fill("Ein Video über Geduld im Trading");
  await page.getByRole("button", { name: /Video length/ }).click();
  await page.getByRole("menuitem", { name: "45 seconds" }).click();
  const review = page.getByRole("button", { name: "Review script first" });
  await expect(review).toHaveAttribute("aria-pressed", "true");
  await review.click();
  await expect(review).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Send brief" }).click();
  await expect.poll(() => api.calls.find((c) => c.path === "/api/agent/sessions/chat_3/messages")?.body).toMatchObject({
    message: "Ein Video über Geduld im Trading", targetSeconds: 45, autoProduce: true, productionMode: "heygen",
  });
});

test("while a video is being made the thread shows one line of steps, and the Jobs panel shows the latest note", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_4");
  await expect(page.getByRole("status")).toContainText("Animating the HeyGen presenter");
  const steps = page.getByRole("status").getByRole("list", { name: "Progress" });
  await expect(steps.getByRole("listitem")).toHaveText(["Script", "Presenter", "Render", "Checks"]);
  await expect(steps.getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("job-result")).toHaveCount(0);
  // The Jobs button counts running jobs; the panel adds the worker's latest note.
  await page.getByRole("button", { name: /Jobs/ }).click();
  await expect(page.getByRole("complementary", { name: "Jobs" }).getByText("HeyGen: processing")).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test("the script review offers two choices; discard and revert live in the menu", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/agent/chat_2");
  const review = page.getByTestId("script-review");
  await expect(review.getByRole("button", { name: "Approve & produce" })).toBeEnabled();
  await expect(review.getByRole("button", { name: "Ask for changes" })).toBeVisible();
  await expect(review.getByRole("button", { name: "Discard" })).toHaveCount(0);
  await review.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Discard script" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Revert my edits" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await review.getByLabel("German script").fill("Hast du den NVDA-Run verpasst? Dann kennst du das Gefühl. Jetzt lernen.");
  await review.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Revert my edits" })).toBeVisible();
  expect(api.calls.some((c) => c.path.endsWith("/approve") || c.path.endsWith("/cancel"))).toBe(false);
  expect(api.unexpected).toEqual([]);
});
