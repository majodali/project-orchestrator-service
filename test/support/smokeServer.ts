/**
 * A local server for test/smokeTestViewCheck.test.ts: the real
 * `createApp()` over Node HTTP, with an in-memory lease backend and a
 * fake repository, so `scripts/smoke-test.sh` can run all four of its
 * checks without AWS or GitHub. Prints `PORT <n>` once listening.
 * Every token it accepts is a fake, read from the environment.
 */

import { serve } from "@hono/node-server";

import { createApp } from "../../src/httpApp.js";
import { InMemoryLeaseBackend } from "../../src/planRegister/inMemoryLeaseBackend.js";
import { FakeRepository, SHA_A } from "./view.js";

const repo = new FakeRepository();
repo.heads.set("main", SHA_A);
repo.setFile(SHA_A, "docs/plan-register.md", "- P1-N001 [done] Root");

const app = createApp({
  planLeaseBackend: new InMemoryLeaseBackend(),
  view: { reader: repo },
});

serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
  console.log(`PORT ${info.port}`);
});
