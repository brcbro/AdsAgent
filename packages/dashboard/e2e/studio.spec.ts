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

test("there is no local preview; picking an avatar selects its own voice automatically", async ({ page }) => {
  await page.goto("/studio/proj_draft");
  await expect(page.getByRole("button", { name: /local preview/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose a presenter" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a presenter" });
  // Own avatars come first; their own voice is selected with them, spoken through ElevenLabs V4.
  await dialog.getByRole("radio", { name: /My Twin/ }).click();
  const voice = dialog.getByTestId("avatar-voice");
  await expect(voice).toContainText("Meine Stimme");
  await expect(voice).toContainText("ElevenLabs V4");
  // Another look of the HeyGen library avatar brings that avatar's voice instead.
  await dialog.getByRole("radio", { name: "HeyGen library" }).click();
  await dialog.getByRole("radio", { name: /Anna Office/ }).click();
  await expect(voice).toContainText("Anna");
  await dialog.getByRole("button", { name: /Use Anna Office · Anna/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Voice: Anna · ElevenLabs V4")).toBeVisible();
});

test("a different voice is optional and kept when chosen", async ({ page }) => {
  await page.goto("/studio/proj_draft");
  await page.getByRole("button", { name: "Choose a presenter" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a presenter" });
  await dialog.getByRole("radio", { name: /My Twin/ }).click();
  await expect(dialog.getByTestId("avatar-voice")).toContainText("Meine Stimme");
  await dialog.getByRole("button", { name: "Use a different voice" }).click();
  await dialog.getByRole("radio", { name: "HeyGen voices" }).click();
  await dialog.getByRole("radio", { name: /Sabine/ }).click();
  await dialog.getByRole("button", { name: /Use My Twin · Sabine/ }).click();
  await expect(page.getByText("Voice: Sabine - Clear & Professional · ElevenLabs V4")).toBeVisible();
});

test("asks before spending HeyGen credits, and cancelling sends nothing", async ({ page }) => {
  await page.goto("/studio/proj_draft");
  await page.getByRole("button", { name: "Choose a presenter" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a presenter" });
  await picker.getByRole("radio", { name: /My Twin/ }).click();
  await picker.getByRole("button", { name: /Use My Twin · Meine Stimme/ }).click();
  await page.getByRole("button", { name: "Create avatar video" }).first().click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("HeyGen credits");
  await expect(dialog).toContainText("Meine Stimme");
  await expect(dialog).toContainText("ElevenLabs V4");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(api.calls.some((c) => c.path.endsWith("/send"))).toBe(false);
});

test("the hook editor splits the script and keeps the rest intact while typing", async ({ page }) => {
  await page.goto("/studio/proj_draft");
  await page.getByRole("button", { name: "Choose a presenter" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a presenter" });
  await picker.getByRole("radio", { name: /My Twin/ }).click();
  await picker.getByRole("button", { name: /Use My Twin · Meine Stimme/ }).click();
  const hook = page.getByLabel("Hook — presenter on screen");
  const rest = page.getByLabel("After the hook — over B-roll");
  await expect(hook).toHaveValue("Drei Regeln für dein Risikomanagement.");
  await rest.fill("Plane dein Risiko vor jedem Trade.");
  await expect(page.locator("#script")).toHaveValue("Drei Regeln für dein Risikomanagement. Plane dein Risiko vor jedem Trade.");
  // An unfinished hook must not swallow the rest of the script.
  await hook.fill("Neuer Hook ohne Punkt");
  await expect(rest).toHaveValue("Plane dein Risiko vor jedem Trade.");
  await expect(page.getByText("End the hook with . ! or ?")).toBeVisible();
  // Structure is a read-only check: Hook and Body are exactly the two boxes above, even mid-edit.
  const structure = page.getByRole("list").filter({ hasText: "Hook" }).last();
  await expect(structure.getByText("Neuer Hook ohne Punkt")).toBeVisible();
  await hook.fill("Neuer Hook.");
  await expect(page.locator("#script")).toHaveValue("Neuer Hook. Plane dein Risiko vor jedem Trade.");
  await expect(structure.locator("li")).toHaveCount(2);
  await expect(structure.locator("li").nth(0)).toContainText("Neuer Hook.");
  await expect(structure.locator("li").nth(1)).toContainText("Body");
  await expect(structure.locator("li").nth(1)).toContainText("Plane dein Risiko vor jedem Trade.");
  await expect(structure.getByText("CTA")).toHaveCount(0);
  // The presenter is on screen for the hook only: no fixed-length or whole-video choice.
  await expect(page.getByRole("radio", { name: "Fixed length" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Whole video" })).toHaveCount(0);
});

test("the avatar picker closes with Escape", async ({ page }) => {
  await page.goto("/studio/proj_draft");
  await page.getByRole("button", { name: "Choose a presenter" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a presenter" });
  await expect(dialog.getByText("My Twin")).toBeVisible();
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
