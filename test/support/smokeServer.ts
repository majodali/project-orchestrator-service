/**
 * A local server for test/smokeTestViewCheck.test.ts: the real
 * `createApp()` over Node HTTP, with a state store over a fake
 * repository, so `scripts/smoke-test.sh` can run all four of its
 * checks without AWS or GitHub. Prints `PORT <n>` once listening.
 * Every token it accepts is a fake, read from the environment.
 */

import { serve } from "@hono/node-server";

import { createApp } from "../../src/httpApp.js";
import { StateStore } from "../../src/model/store.js";
import { MINIMAL_STATE } from "./states.js";
import { FakeRepository, SHA_A } from "./view.js";

const repo = new FakeRepository();
repo.heads.set("main", SHA_A);
repo.setFile(SHA_A, "orchestration/state.json", MINIMAL_STATE);

const app = createApp({
  state: { store: new StateStore({ reader: repo, writer: repo }) },
  view: { reader: repo },
});

serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
  console.log(`PORT ${info.port}`);
});
