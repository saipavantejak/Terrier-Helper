import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
const key = "browser-test-only-access-key-32-characters";
async function admin(page: Page) {
  await page.goto("/admin");
  await expect(page.getByLabel("Administrator access key")).toBeVisible();
  await page.getByLabel("Administrator access key").fill(key);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(
    page.getByRole("heading", { name: "Manage sources" }),
  ).toBeVisible();
}
async function upload(page: Page, name: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage()
    .drawText("SYNTHETIC TEST POLICY. Tuition payment is due September 15.", {
      x: 40,
      y: 700,
      font,
      size: 12,
    });
  pdf
    .addPage()
    .drawText("Library books can be borrowed for fourteen days. " + name, {
      x: 40,
      y: 700,
      font,
      size: 12,
    });
  await page.getByLabel("Upload PDF documents").setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card.getByText("2 pages · 2 passages · keyword")).toBeVisible({
    timeout: 30000,
  });
  return card;
}
test("admin publishes; separate student can only read; withdrawal removes access; mobile layout", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await admin(page);
  const name = "publication-test.pdf";
  const card = await upload(page, name);
  const context = await browser.newContext({
    baseURL: "http://localhost:3111",
  });
  const student = await context.newPage();
  await student.goto("http://localhost:3111/");
  await expect(student.getByLabel("Upload PDF documents")).toHaveCount(0);
  await expect(
    student.getByRole("link", { name: name + " ↗", exact: true }),
  ).toHaveCount(0);
  expect(
    (await student.request.post("/api/documents", { data: {} })).status(),
  ).toBe(403);
  await card
    .getByRole("button", { name: "Publish " + name, exact: true })
    .click();
  await expect(card.getByText("Published", { exact: true })).toBeVisible();
  await student.reload();
  await expect(
    student.getByRole("link", { name: name + " ↗", exact: true }),
  ).toBeVisible();
  await student.setViewportSize({ width: 390, height: 844 });
  expect(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await card
    .getByRole("button", { name: "Withdraw " + name, exact: true })
    .click();
  await student.reload();
  await expect(
    student.getByRole("link", { name: name + " ↗", exact: true }),
  ).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await card
    .getByRole("button", { name: "Delete " + name, exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await context.close();
  expect(errors).toEqual([]);
});
test("student answer renders a citation linked to the actual published PDF (controlled model fixture)", async ({
  page,
}) => {
  await admin(page);
  const name = "citation-test.pdf";
  const card = await upload(page, name);
  await card
    .getByRole("button", { name: "Publish " + name, exact: true })
    .click();
  await expect(card.getByText("Published", { exact: true })).toBeVisible();
  const docs = await page.request.get("/api/documents");
  const doc = (await docs.json()).documents.find(
    (d: { name: string }) => d.name === name,
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.route("**/api/workspace", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), generationEnabled: true },
    });
  });
  await page.goto("/");
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        "event: answer\ndata: " +
        JSON.stringify({
          status: "answered",
          statements: [
            {
              text: "Tuition payment is due September 15.",
              citationIds: ["S1"],
            },
          ],
          citations: [
            {
              id: "S1",
              documentId: doc.id,
              name: doc.name,
              version: doc.version,
              page: 1,
              quote: "Tuition payment is due September 15.",
            },
          ],
          retrievalMode: "keyword",
          requestId: "fixture",
        }) +
        "\n\nevent: done\ndata: {}\n\n",
    }),
  );
  await page.getByLabel("Ask a question").fill("When is tuition due?");
  await page.getByRole("button", { name: "Send question" }).click();
  await page.locator("summary").click();
  await expect(page.locator("blockquote")).toContainText(
    "Tuition payment is due September 15.",
  );
  await expect(
    page.getByRole("link", { name: "Open PDF page" }),
  ).toHaveAttribute("href", `/api/documents/${doc.id}/file#page=1`);
  expect(
    (await page.request.get(`/api/documents/${doc.id}/file`)).status(),
  ).toBe(200);
  await admin(page);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete " + name, exact: true })
    .click();
});

test("greetings are conversational even when answer generation is disabled", async ({
  page,
}) => {
  await page.goto("/");
  const question = page.getByLabel("Ask a question");
  await expect(question).toBeEnabled();
  await question.fill("Hi");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(
    page.getByText("Hey! What would you like to figure out?", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Keyword retrieval", { exact: false }),
  ).toHaveCount(0);
  await question.fill("Thank you");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(
    page.getByText("You’re welcome!", { exact: false }),
  ).toBeVisible();
});

test("voluntary feedback and admin review work end to end with a signed answer fixture", async ({
  page,
  browser,
}) => {
  const { feedbackReceipt } = await import("../backend/feedback");
  const { createHash, randomUUID } = await import("node:crypto");
  await page.goto("/");
  await expect(page.getByLabel("Ask a question")).toBeEnabled();
  const owner = (await page.context().cookies()).find(
    (c) => c.name === "terrier_owner",
  )!.value;
  const question = "Feedback workflow fixture " + randomUUID();
  const result = {
    requestId: randomUUID(),
    status: "insufficient_evidence" as const,
    statements: [],
    citations: [],
    retrievalMode: "keyword" as const,
  };
  const token = feedbackReceipt(
    key,
    "institution:sfc-brooklyn",
    createHash("sha256").update(owner).digest("hex"),
    { question, answer: result },
  );
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        "event: answer\ndata: " +
        JSON.stringify({ ...result, feedbackToken: token }) +
        "\n\nevent: done\ndata: {}\n\n",
    }),
  );
  await page.getByLabel("Answer style").selectOption("plain");
  await page.getByLabel("Ask a question").fill(question);
  await page.getByRole("button", { name: "Send question" }).click();
  await page.getByRole("button", { name: "Give feedback" }).click();
  await expect(
    page.getByRole("button", { name: "Submit feedback" }),
  ).toBeDisabled();
  await page.getByLabel("Was this answer helpful?").selectOption("unhelpful");
  await page
    .getByLabel("What could be better?")
    .fill("Please review the missing source.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Submit feedback" }).click();
  await expect(
    page.getByText("Thank you. Your feedback is available for admin review."),
  ).toBeVisible();
  const context = await browser.newContext({
    baseURL: "http://localhost:3111",
  });
  const reviewer = await context.newPage();
  await admin(reviewer);
  const record = reviewer
    .getByRole("article")
    .filter({
      has: reviewer.getByRole("heading", { name: question, exact: true }),
    });
  await expect(
    record.getByText("Please review the missing source.", { exact: false }),
  ).toBeVisible();
  await record.getByRole("button", { name: "Dismiss feedback" }).click();
  await expect(
    record.getByText("unhelpful · dismissed", { exact: false }),
  ).toBeVisible();
  reviewer.once("dialog", (d) => d.accept());
  await record.getByRole("button", { name: "Delete feedback" }).click();
  await expect(record).toHaveCount(0);
  await context.close();
});
