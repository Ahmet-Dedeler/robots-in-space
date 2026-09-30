import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RecurrentPolicy, type PolicyJson } from "./policy";

// Reference obs/action pairs produced by PyTorch in tools/bake_robots.py.
for (const robot of ["g1", "h1"] as const) {
  describe(`${robot} policy`, () => {
    it("matches PyTorch outputs step by step (recurrent state included)", () => {
      const policy = new RecurrentPolicy(JSON.parse(readFileSync(`public/robots/${robot}/policy.json`, "utf8")) as PolicyJson);
      const ref = JSON.parse(readFileSync(`src/sim/robots/__fixtures__/${robot}-policy-ref.json`, "utf8")) as {
        obs: number[];
        action: number[];
      }[];
      expect(ref.length).toBeGreaterThan(4);
      for (const frame of ref) {
        const a = policy.act(frame.obs);
        frame.action.forEach((v, i) => expect(a[i]).toBeCloseTo(v, 4));
      }
    });
  });
}
