import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
async function upload(page: Page) {
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
    .drawText("Library books can be borrowed for fourteen days.", {
      x: 40,
      y: 700,
      font,
      size: 12,
    });
  await page
    .getByLabel("Upload PDF documents")
    .setInputFiles({
      name: "policy-test.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
  await expect(page.getByText("2 pages · 2 passages · keyword")).toBeVisible({
    timeout: 15000,
  });
}
test("production UI uploads, indexes, persists, filters, and deletes PDFs on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Find clarity in your documents." }),
  ).toBeVisible();
  await expect(
    page.getByText("Document indexing is available.", { exact: false }),
  ).toBeVisible();
  await upload(page);
  await page.reload();
  await expect(page.getByText("2 pages · 2 passages · keyword")).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Use policy-test.pdf for questions" })
    .check();
  await expect(page.getByText("1 selected for questions")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Delete policy-test.pdf" }).click();
  await expect(page.getByText("Your library starts here.")).toBeVisible();
  expect(errors).toEqual([]);
});
test("checked answer renders evidence and links to the real uploaded PDF (model response fixture)", async ({
  page,
}) => {
  await page.route("**/api/workspace", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, generationEnabled: true },
    });
  });
  await page.goto("/");
  await upload(page);
  const documents = await page.request.get("/api/documents");
  const doc = (await documents.json()).documents[0];
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'event: progress\ndata: {"message":"Checking evidence…"}\n\n' +
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
          requestId: "browser-fixture",
        }) +
        "\n\nevent: done\ndata: {}\n\n",
    }),
  );
  await page.getByLabel("Ask a question").fill("When is tuition due?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(
    page
      .getByText("Tuition payment is due September 15.", { exact: false })
      .first(),
  ).toBeVisible();
  await page.locator("summary").click();
  await expect(page.locator("blockquote")).toContainText(
    "Tuition payment is due September 15.",
  );
  const link = page.getByRole("link", { name: "Open PDF page" });
  await expect(link).toHaveAttribute(
    "href",
    `/api/documents/${doc.id}/file#page=1`,
  );
  const pdfResponse = await page.request.get(`/api/documents/${doc.id}/file`);
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
});
