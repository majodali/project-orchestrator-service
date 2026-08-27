import { describe, expect, it } from "vitest";

import { SERVICE_NAME, describeService } from "../src/index.js";

// A minimal smoke test for the skeleton itself, not a service
// feature: it proves the test runner is wired up correctly (module
// resolution, TypeScript compilation, assertions) before any real
// tool exists to test. Chunk 1 children B-E add feature tests.
describe("skeleton", () => {
  it("names the service", () => {
    expect(describeService()).toContain(SERVICE_NAME);
  });
});
