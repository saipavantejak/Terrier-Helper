import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";
import { safeAnswerError, withModelFallback } from "../backend/provider.js";

test("provider failures explain actionable causes without exposing raw errors", () => {
  for (const [status, expected] of [[429, /quota/], [403, /denied access/], [404, /GEMINI_MODEL/], [400, /configuration/], [503, /temporarily unavailable/]] as const) {
    const message = safeAnswerError(new ApiError({ status, message: "PRIVATE_KEY_AND_DOCUMENT_CONTENT" }));
    assert.match(message, expected);
    assert.doesNotMatch(message, /PRIVATE_KEY_AND_DOCUMENT_CONTENT/);
  }
  assert.doesNotMatch(safeAnswerError(new Error("PRIVATE_KEY_AND_DOCUMENT_CONTENT")), /PRIVATE_KEY_AND_DOCUMENT_CONTENT/);
});


test("fallback recovers server failures but never bypasses quota, permissions, cancellation, or validation", async () => {
  const calls: string[] = [];
  const result = await withModelFallback("primary", "backup", async model => {
    calls.push(model);
    if (model === "primary") throw new ApiError({status: 503, message: "private"});
    return "recovered";
  });
  assert.equal(result, "recovered");
  assert.deepEqual(calls, ["primary", "backup"]);
  for (const error of [new ApiError({status: 429, message: "quota"}), new ApiError({status: 403, message: "denied"}), new Error("invalid output")]) {
    let attempts = 0;
    await assert.rejects(withModelFallback("primary", "backup", async () => { attempts++; throw error; }));
    assert.equal(attempts, 1);
  }
  const controller = new AbortController(); controller.abort();
  let attempts = 0;
  await assert.rejects(withModelFallback("primary", "backup", async () => { attempts++; throw new ApiError({status:503,message:"unavailable"}); }, controller.signal));
  assert.equal(attempts, 0);
});


test("a transient backup failure is retried, with a bounded attempt count", async () => {
  const calls: string[] = [];
  const result = await withModelFallback("primary", "backup", async model => {
    calls.push(model);
    if (calls.length < 3) throw new ApiError({status: 503, message: "unavailable"});
    return "recovered";
  });
  assert.equal(result, "recovered");
  assert.deepEqual(calls, ["primary", "backup", "backup"]);
  let attempts = 0;
  await assert.rejects(withModelFallback("primary", "backup", async () => {
    attempts++; throw new ApiError({status: 503, message: "unavailable"});
  }));
  assert.equal(attempts, 3);
});

test("cancellation during retry backoff stops further provider calls", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const pending = withModelFallback("primary", "backup", async () => {
    attempts++;
    setTimeout(() => controller.abort(), 20);
    throw new ApiError({status: 503, message: "unavailable"});
  }, controller.signal);
  await assert.rejects(pending);
  assert.equal(attempts, 1);
});
