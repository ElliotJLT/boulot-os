import { describe, expect, it } from "vitest";
import { Stage, normaliseStage } from "../src/schema/status.js";

/*
 * Every stage this schema defines must survive a round trip.
 *
 * The alias table was built from values found in real files, so it knew
 * "interview" and "final_round" and did not know "interviewing", which is the
 * name this very file gives the stage. An application at interview stage was
 * read back as a lead and shown in the Prep column, and the word "interviewing"
 * ended up in its substage.
 */
describe("every canonical stage maps to itself", () => {
  for (const stage of Stage.options) {
    it(stage, () => {
      const got = normaliseStage(stage);
      expect(got.matched).toBe(true);
      expect(got.stage).toBe(stage);
      expect(got.substage).toBe(null);
    });
  }
});
