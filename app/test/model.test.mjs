// node --test app/test/model.test.mjs
// Holds the engine to the worked examples in the commercial model document
// and to the three scorecard rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MQ = require(path.join(here, "..", "src", "model.js"));
const model = JSON.parse(readFileSync(path.join(here, "..", "..", "pricing", "commercial-model.json"), "utf8"));
const examples = model.worked_examples.filter((e) => e.scores);

test("worked example A: supplier onboarding is Moderate, Standard Care, $24,640 then $4,240", () => {
  const ex = examples[0];
  const q = MQ.quote(model, { scores: ex.scores, careTier: ex.care, years: 3 });
  assert.equal(q.tierKey, "moderate");
  assert.equal(q.score.total, 12);
  assert.equal(q.serviceYear1, 24640);
  assert.equal(q.recurring, 4240);
  assert.deepEqual(q.schedule.map((s) => s.care), [4240, 4537, 4854]);
  assert.equal(q.contract, 24640 + 4537 + 4854);
});

test("worked example B: grievance handling is Complex, Premier Care, $49,530 then $11,380", () => {
  const ex = examples[1];
  const q = MQ.quote(model, { scores: ex.scores, careTier: ex.care, years: 1 });
  assert.equal(q.score.total, 21);
  assert.equal(q.tierKey, "complex");
  assert.deepEqual(q.score.rules, []);
  assert.equal(q.serviceYear1, 49530);
  assert.equal(q.recurring, 11380);
});

test("floor rule: a 3 on routing data lifts a total of 11 to Moderate", () => {
  const scores = { nodes: 1, transitions: 1, forms: 1, routing: 3, external: 1, course: 1, reporting: 2, visibility: 1 };
  const st = MQ.scoreTier(model, scores);
  assert.equal(st.total, 11);
  assert.equal(st.tierKey, "moderate");
  assert.equal(st.rules[0].key, "floor");
});

test("six factors at 3 still tiers by total: 20 is Complex", () => {
  const scores = { nodes: 3, transitions: 3, forms: 3, routing: 1, external: 3, course: 1, reporting: 3, visibility: 3 };
  const st = MQ.scoreTier(model, scores);
  assert.equal(st.total, 20);
  assert.equal(st.tierKey, "complex");
  assert.deepEqual(st.rules, []);
});

test("the maximum score of 24 is Complex and the minimum of 8 is Simple", () => {
  const all3 = Object.fromEntries(model.scorecard.factors.map((f) => [f.key, 3]));
  const all1 = Object.fromEntries(model.scorecard.factors.map((f) => [f.key, 1]));
  assert.equal(MQ.scoreTier(model, all3).tierKey, "complex");
  assert.equal(MQ.scoreTier(model, all1).tierKey, "simple");
  assert.equal(model.scorecard.tiers.length, 3);
});

test("an incomplete scorecard has no tier", () => {
  const st = MQ.scoreTier(model, { nodes: 2 });
  assert.equal(st.complete, false);
  assert.equal(st.tierKey, null);
  assert.equal(MQ.quote(model, { scores: { nodes: 2 } }).ready, false);
});

test("repeat-workflow discount touches Discovery and Build only", () => {
  const scores = examples[0].scores;
  const first = MQ.quote(model, { scores, careTier: "standard", repeat: "first" });
  const second = MQ.quote(model, { scores, careTier: "standard", repeat: "second" });
  const third = MQ.quote(model, { scores, careTier: "standard", repeat: "third" });
  assert.equal(second.lines[0].net, 3450 - 345);
  assert.equal(second.lines[1].net, 16950 - 1695);
  assert.equal(second.lines[2].net, first.lines[2].net);
  assert.equal(third.lines[1].net, 16950 - 2543);
  assert.equal(third.recurring, first.recurring);
});

test("extended coverage adds 20% to Premier Care and escalates with it", () => {
  const scores = examples[0].scores;
  const q = MQ.quote(model, { scores, careTier: "premier", extendedCoverage: true, years: 2 });
  assert.equal(q.care.base, 5950);
  assert.equal(q.care.extended, 1190);
  assert.equal(q.schedule[0].care, 7140);
  assert.equal(q.schedule[1].care, MQ.rnd(7140 * 1.07));
  const std = MQ.quote(model, { scores, careTier: "standard", extendedCoverage: true });
  assert.equal(std.care.extended, 0, "extended coverage is Premier only");
});

test("extra lines: one-off stays in year 1, annual repeats, indexed annual escalates", () => {
  const scores = examples[0].scores;
  const q = MQ.quote(model, { scores, careTier: "standard", years: 3, extras: [
    { label: "Data migration", amount: 1800, kind: "oneoff" },
    { label: "Advanced Momentum uplift", amount: 10800, kind: "annual", indexed: false },
    { label: "Indexed thing", amount: 1000, kind: "annual", indexed: true },
  ] });
  assert.equal(q.schedule[0].oneOff, 3450 + 16950 + 1800);
  assert.equal(q.schedule[0].extras, 11800);
  assert.equal(q.schedule[1].extras, 10800 + 1070);
  assert.equal(q.schedule[2].extras, 10800 + MQ.rnd(1000 * 1.07 * 1.07));
  assert.equal(q.schedule[2].oneOff, 0);
});

test("payment milestones add up to the contract", () => {
  const q = MQ.quote(model, { scores: examples[1].scores, careTier: "premier", years: 3, repeat: "second" });
  const sum = q.milestones.reduce((s, m) => s + m.amount, 0);
  assert.equal(sum, q.contract);
});

test("what would lower the tier names the factor and the saving", () => {
  const scores = { nodes: 2, transitions: 2, forms: 2, routing: 1, external: 1, course: 1, reporting: 1, visibility: 2 };
  const low = MQ.whatWouldLower(model, scores);
  assert.equal(low.length, 4);
  assert.equal(low[0].tier, "Simple");
  assert.equal(low[0].saving, (3450 + 16950) - (2450 + 7450));
});

test("the published Care table agrees with percent-of-build and the floors", () => {
  for (const tier of ["simple", "moderate", "complex"]) {
    for (const ct of model.care.tiers) {
      const expected = Math.max(ct.minimum, model.prices[tier].build * ct.percent_of_build / 100);
      const published = model.care.table[tier][ct.key];
      assert.ok(Math.abs(published - expected) <= 10, `${tier}/${ct.key}: ${published} vs ${expected}`);
    }
  }
});

test("money formats whole dollars with separators", () => {
  assert.equal(MQ.money(model, 24640), "$24,640");
  assert.equal(MQ.money(model, 4536.8), "$4,537");
});
