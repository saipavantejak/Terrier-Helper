import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";
import { safeAnswerError } from "../backend/provider.js";

test("provider failures explain actionable causes without exposing raw errors", () => {
  for (const [status, expected] of [[429, /quota/], [403, /denied access/], [404, /GEMINI_MODEL/], [400, /configuration/], [503, /temporarily unavailable/]] as const) {
    const message = safeAnswerError(new ApiError({ status, message: "PRIVATE_KEY_AND_DOCUMENT_CONTENT" }));
    assert.match(message, expected);
    assert.doesNotMatch(message, /PRIVATE_KEY_AND_DOCUMENT_CONTENT/);
  }
  assert.doesNotMatch(safeAnswerError(new Error("PRIVATE_KEY_AND_DOCUMENT_CONTENT")), /PRIVATE_KEY_AND_DOCUMENT_CONTENT/);
});
