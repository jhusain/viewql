import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, Suspense } from "react";

import {
  Defer,
  defineFragmentView,
  defineQueryView,
} from "../dist/index.js";

test("view definitions return the supplied stateless component", () => {
  const queryView = () => null;
  const fragmentView = () => null;

  assert.equal(defineQueryView(queryView), queryView);
  assert.equal(defineFragmentView(fragmentView), fragmentView);
});

test("Defer creates a Suspense boundary", () => {
  const fallback = "Loading";
  const children = "Content";
  const element = Defer({ fallback, children });

  assert.equal(isValidElement(element), true);
  assert.equal(element.type, Suspense);
  assert.equal(element.props.fallback, fallback);
  assert.equal(element.props.children, children);
});
