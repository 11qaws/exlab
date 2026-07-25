import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRacePlan,
  parseRoster,
  shuffleSeeded,
} from "../app/marble/core";
import { simulateRace } from "../app/marble/simulation";

test("roster accepts two through ten participants", () => {
  assert.equal(parseRoster("가\n나").isValid, true);
  assert.equal(
    parseRoster(
      Array.from({ length: 10 }, (_, index) => `참가자${index + 1}`).join("\n"),
    ).isValid,
    true,
  );
});

test("roster preserves overflow names and blocks eleven participants", () => {
  const validation = parseRoster(
    Array.from({ length: 11 }, (_, index) => `참가자${index + 1}`).join("\n"),
  );
  assert.equal(validation.isValid, false);
  assert.equal(validation.candidates.length, 10);
  assert.deepEqual(validation.overflowNames, ["참가자11"]);
});

test("duplicate names remain separate candidates", () => {
  const validation = parseRoster("레또\n레또");
  assert.equal(validation.isValid, true);
  assert.notEqual(validation.candidates[0].id, validation.candidates[1].id);
});

test("seeded shuffle is deterministic", () => {
  const source = ["a", "b", "c", "d", "e"];
  assert.deepEqual(shuffleSeeded(source, "same"), shuffleSeeded(source, "same"));
  assert.notDeepEqual(
    shuffleSeeded(source, "same"),
    shuffleSeeded(source, "different"),
  );
});

test("physics simulation produces a stable winner for the same seeds", () => {
  const first = simulateRace(5, "race-fixed", "layout-fixed");
  const second = simulateRace(5, "race-fixed", "layout-fixed");
  assert.equal(first.fullFinishOrder.length, 5);
  assert.deepEqual(first.fullFinishOrder, second.fullFinishOrder);
  assert.ok(first.frames.length > 30);
  assert.ok(first.winnerFrameIndex >= 0);
});

test("preselected mode maps the locked result onto physical finish slots", () => {
  const candidates = parseRoster("가\n나\n다\n라").candidates;
  const simulation = simulateRace(4, "race-plan", "layout-plan");
  const plan = buildRacePlan(
    "테스트",
    candidates,
    "preselected",
    simulation,
    {
      raceSeed: "race-plan",
      resultSeed: "result-plan",
      layoutSeed: "layout-plan",
    },
  );
  assert.equal(plan.rankedCandidateIds.length, 4);
  assert.equal(new Set(plan.rankedCandidateIds).size, 4);
  assert.equal(plan.winnerId, plan.rankedCandidateIds[0]);
});

