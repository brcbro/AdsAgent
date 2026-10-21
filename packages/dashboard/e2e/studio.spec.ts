import { expect, test } from "@playwright/test";
import { mockApi } from "./mock-api";

let api: Awaited<ReturnType<typeof mockApi>>;
let pageErrors: string[];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  api = await mockApi(page);
});

test.afterEach(() => {
  expect(api.unexpected, "the UI made API calls without a handler").toEqual([]);
  expect(pageErrors, "uncaught errors in the page").toEqual([]);
});

test("opens the most recent project with its status and settings", async ({ page }) => {
  await page.goto("/studio");
  await expect(page).toHaveURL(/\/studio\/proj_ready$/);
  await expect(page.getByRole("heading", { level: 1, name: "Trading FOMO — Hook A" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Script" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("All changes saved")).toBeVisible();
});

test("autosaves script edits and only sends editable fields", async ({ page }) => {
  await page.goto("/studio/proj_draft");
  const script = page.getByLabel("German script");
  await script.fill("Neues Skript für den Test.");
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 5000 });
  const save = api.calls.find((c) => c.method === "PUT" && c.path === "/api/projects/proj_draft/metadata");
  expect(save?.body).toMatchObject({ scriptDe: "Neues Skript für den Test." });
  // Pipeline-owned fields stay on the server.
  expect(save?.body).not.toHaveProperty("status");
  expect(save?.body).not.toHaveProperty("outputFile");
});

test("asks before spending credits, and cancelling sends nothing", async ({ page }) => {
  await page.goto("/studio/proj_draft");
  await page.getByRole("button", { name: "Create local preview" }).first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("ElevenLabs credits");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(api.calls.some((c) => c.path.endsWith("/local-preview"))).toBe(false);
});

test("the avatar picker closes with Escape", async ({ page }) => {
  await page.goto("/studio/proj_draft");
  await page.getByRole("button", { name: "Choose avatar" }).last().click();
  const dialog = page.getByRole("dialog", { name: "Choose a presenter" });
  await expect(dialog.getByText("Anna Office")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("command palette finds and opens a project", async ({ page }) => {
  await page.goto("/studio/proj_ready");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search projects, pages and actions…").fill("risk");
  await page.getByRole("option", { name: /Draft — Risk rules/ }).click();
  await expect(page).toHaveURL(/\/studio\/proj_draft$/);
});

test("version compare highlights changed settings", async ({ page }) => {
  await page.goto("/studio/proj_ready");
  await page.getByRole("button", { name: "Versions" }).click();
  const dialog = page.getByRole("dialog", { name: "Version history" });
  await expect(dialog.getByText("Version 2")).toBeVisible();
  await dialog.getByRole("radio", { name: /Compare/ }).click();
  await expect(page.getByRole("dialog", { name: "Compare versions" }).getByText(/\d+ differences/)).toBeVisible();
});

test("pinning a B-roll clip saves it to the project", async ({ page }) => {
  await page.goto("/studio/proj_draft");
  await page.getByRole("tab", { name: "B-roll" }).click();
  await page.getByRole("button", { name: "Pin beach walk" }).click({ force: true });
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 5000 });
  const save = api.calls.filter((c) => c.method === "PUT").at(-1);
  expect(save?.body).toMatchObject({ brollPinned: ["/clips/Lifestyle/beach.mp4"] });
});

test("dark theme can be switched on from Settings", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("projects with linked ads show a performance strip in the sidebar and a section in Settings", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/studio/proj_ready");
  const strip = page.getByTestId("project-performance");
  await expect(strip).toHaveCount(1);
  await expect(strip).toContainText("€1,235");
  await expect(strip).toContainText("38% hook");
  await expect(strip.getByLabel("1 winning ad")).toBeVisible();
  expect(api.unexpected).toEqual([]);
});

test("final review shows the project's data-backed suggestions under Settings", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/studio/proj_ready");
  await page.getByRole("tab", { name: "Settings" }).click();
  const cards = page.getByTestId("project-suggestions").getByTestId("suggestion-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Push variant h1_c1_9x16");
  await expect(cards.nth(1)).toContainText("Cut faster");
  expect(api.unexpected).toEqual([]);
});
