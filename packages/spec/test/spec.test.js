import assert from "node:assert/strict";
import test from "node:test";

import { toID, toInt } from "../dist/index.js";

test("toID preserves the supplied string", () => {
  assert.equal(toID("person:123"), "person:123");
});

test("toInt preserves integral numbers", () => {
  assert.equal(toInt(0), 0);
  assert.equal(toInt(-42), -42);
});

test("toInt rejects non-integral and non-finite numbers", () => {
  for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => toInt(value),
      new TypeError("GraphQL Int must be an integer"),
    );
  }
});
