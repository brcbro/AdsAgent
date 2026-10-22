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

test("flagged clips are listed under Needs review and a confirmed category is sent to the server", async ({ page }) => {
  await page.goto("/library/broll");
  await expect(page.getByText("1 to review")).toBeVisible();
  await page.getByRole("button", { name: "Needs review" }).click();
  await expect(page.getByText("1 clips · hover to play")).toBeVisible();
  const card = page.locator("[data-needs-review]");
  await expect(card).toHaveCount(1);
  await expect(card.getByText("Review · 52%")).toBeVisible();
  await card.getByLabel("Category for desk talk").selectOption("Deep Work");
  const call = api.calls.find((c) => c.method === "POST" && c.path === "/api/broll/clips/category");
  expect(call?.body).toEqual({ file: "/clips/Community/desk.mp4", category: "Deep Work" });
  // The card leaves the review list once the server confirms.
  await expect(page.locator("[data-needs-review]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Needs review" })).toBeHidden();
});

test("Add clips uploads each file with its chosen category and refreshes the grid", async ({ page }) => {
  await page.goto("/library/broll");
  await page.getByRole("button", { name: "Add clips" }).click();
  const dialog = page.getByRole("dialog", { name: "Add clips" });
  await dialog.getByLabel("Choose clips").setInputFiles([
    { name: "typing.mp4", mimeType: "video/mp4", buffer: Buffer.from("abc") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("no") },
  ]);
  await expect(dialog.getByText("typing.mp4")).toBeVisible();
  await expect(dialog.getByText("notes.txt")).toBeHidden();
  await dialog.getByRole("button", { name: /^Upload/ }).click();
  await expect(dialog.getByLabel("Uploaded")).toBeVisible();
  const upload = api.calls.find((c) => c.method === "PUT" && c.path === "/api/broll/upload");
  expect(upload).toBeTruthy();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Classifying…")).toBeVisible();
  await expect(page.getByText("1 clip waiting for the classifier")).toBeVisible();
});

test("local paths are imported and Classify unclassified starts a run", async ({ page }) => {
  await page.goto("/library/broll");
  await page.getByRole("button", { name: "Add clips" }).click();
  const dialog = page.getByRole("dialog", { name: "Add clips" });
  await dialog.getByRole("radio", { name: "Local paths" }).click();
  await dialog.getByLabel("Files or folders on this computer").fill("D:\\footage\\a.mp4\nD:\\missing");
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(dialog.getByText("1 imported, 1 skipped")).toBeVisible();
  const call = api.calls.find((c) => c.method === "POST" && c.path === "/api/broll/import");
  expect(call?.body).toEqual({ paths: ["D:\\footage\\a.mp4", "D:\\missing"], category: "auto" });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Classify unclassified" }).click();
  expect(api.calls.some((c) => c.method === "POST" && c.path === "/api/broll/ingest/run")).toBe(true);
  await expect(page.getByTestId("broll-ingest-status")).toContainText("Classifying 1 of 1");
});
