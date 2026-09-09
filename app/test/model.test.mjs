// node --test app/test/model.test.mjs
// Holds the engine to the commercial model: the two calibration engagements,
// the floor rule, multi-workflow discounts, the 7% schedule and the add-ons.
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
const [A, B] = examples;
const one = (ex, extra = {}) => MQ.quote(model, Object.assign({ workflows: [{ id: "w1", name: ex.name, scores: ex.scores }], careTier: ex.care, years: 1 }, extra));

test("example A: supplier onboarding is Moderate, Standard Care, $11,350 then $1,950", () => {
  const q = one(A, { years: 3 });
  assert.equal(q.workflows[0].tierKey, "moderate");
  assert.equal(q.workflows[0].score.total, 12);
  assert.equal(q.serviceYear1, A.year1_service);
  assert.equal(q.recurring, A.recurring);
  assert.deepEqual(q.schedule.map((s) => s.care), [1950, 2087, 2233]);
  assert.equal(q.contract, 11350 + 2087 + 2233);
});

test("example B: grievance handling is Complex, Premier Care, $18,480 then $4,030", () => {
  const q = one(B);
  assert.equal(q.workflows[0].score.total, 21);
  assert.equal(q.workflows[0].tierKey, "complex");
  assert.deepEqual(q.workflows[0].score.rules, []);
  assert.equal(q.serviceYear1, B.year1_service);
  assert.equal(q.recurring, B.recurring);
});

test("a Complex workflow at score 18 with Standard Care is $17,330 in year 1", () => {
  const scores = { nodes: 3, transitions: 2, forms: 3, routing: 1, external: 3, course: 1, reporting: 3, visibility: 2 };
  const q = MQ.quote(model, { workflows: [{ id: "w", name: "x", scores }], careTier: "standard", years: 1 });
  assert.equal(q.workflows[0].score.total, 18);
  assert.equal(q.year1, 2950 + 11500 + 2880);
});

test("floor rule: a 3 on routing data lifts a total of 11 to Moderate", () => {
  const scores = { nodes: 1, transitions: 1, forms: 1, routing: 3, external: 1, course: 1, reporting: 2, visibility: 1 };
  const st = MQ.scoreTier(model, scores);
  assert.equal(st.total, 11);
  assert.equal(st.tierKey, "moderate");
  assert.equal(st.rules[0].key, "floor");
});

test("the range 8 to 24 maps to exactly three tiers", () => {
  const all3 = Object.fromEntries(model.scorecard.factors.map((f) => [f.key, 3]));
  const all1 = Object.fromEntries(model.scorecard.factors.map((f) => [f.key, 1]));
  assert.equal(MQ.scoreTier(model, all3).tierKey, "complex");
  assert.equal(MQ.scoreTier(model, all1).tierKey, "simple");
  assert.equal(model.scorecard.tiers.length, 3);
});

test("an incomplete scorecard has no tier and a quote is not ready until every workflow is scored", () => {
  const st = MQ.scoreTier(model, { nodes: 2 });
  assert.equal(st.complete, false);
  assert.equal(st.tierKey, null);
  assert.equal(MQ.quote(model, { workflows: [] }).ready, false);
  const q = MQ.quote(model, { workflows: [{ id: "a", scores: A.scores }, { id: "b", scores: { nodes: 2 } }], careTier: "standard" });
  assert.equal(q.ready, false);
});

test("two workflows: the second gets 10% off Discovery and Build, Care is never discounted", () => {
  const q = MQ.quote(model, { workflows: [{ id: "a", name: "Onboarding", scores: A.scores }, { id: "b", name: "Grievance", scores: B.scores }], careTier: "standard", years: 1 });
  assert.equal(q.workflows[0].discountPercent, 0);
  assert.equal(q.workflows[1].discountPercent, 10);
  assert.equal(q.workflows[1].discoveryNet, 2950 - 295);
  assert.equal(q.workflows[1].buildNet, 11500 - 1150);
  assert.equal(q.workflows[1].care.base, 2880);
  assert.equal(q.recurring, 1950 + 2880);
  assert.equal(q.year1, (1950 + 7450 + 1950) + (2655 + 10350 + 2880));
  assert.equal(q.anyDiscount, true);
});

test("workflows the client already has shift the discount positions", () => {
  const q = MQ.quote(model, { engagement: { existingWorkflows: 1 }, workflows: [{ id: "a", scores: A.scores }, { id: "b", scores: A.scores }, { id: "c", scores: A.scores }], careTier: "essential" });
  assert.deepEqual(q.workflows.map((w) => w.discountPercent), [10, 15, 15]);
  assert.equal(MQ.discountPercent(model, 0), 0);
  assert.equal(MQ.discountPercent(model, 7), 15);
});

test("extended coverage adds 20% to Premier Care across all workflows and escalates with it", () => {
  const q = MQ.quote(model, { workflows: [{ id: "a", scores: A.scores }, { id: "b", scores: B.scores }], careTier: "premier", extendedCoverage: true, years: 2 });
  assert.equal(q.careExtended, MQ.rnd(2950 * 0.2) + MQ.rnd(4030 * 0.2));
  assert.equal(q.schedule[0].care, 2950 + 4030 + q.careExtended);
  assert.equal(q.schedule[1].care, MQ.rnd(q.schedule[0].care * 1.07));
  const std = one(A, { careTier: "standard", extendedCoverage: true });
  assert.equal(std.careExtended, 0, "extended coverage is Premier only");
});

test("extra lines: one-off stays in year 1, annual repeats, indexed annual escalates", () => {
  const q = one(A, { careTier: "standard", years: 3, extras: [
    { label: "Data migration", amount: 1800, kind: "oneoff" },
    { label: "Advanced Momentum uplift", amount: 10800, kind: "annual", indexed: false },
    { label: "Indexed thing", amount: 1000, kind: "annual", indexed: true },
  ] });
  assert.equal(q.schedule[0].oneOff, 1950 + 7450 + 1800);
  assert.equal(q.schedule[0].extras, 11800);
  assert.equal(q.schedule[1].extras, 10800 + 1070);
  assert.equal(q.schedule[2].extras, 10800 + MQ.rnd(1000 * 1.07 * 1.07));
  assert.equal(q.schedule[2].oneOff, 0);
});

test("payment milestones add up to the contract", () => {
  const q = MQ.quote(model, { engagement: { existingWorkflows: 1 }, workflows: [{ id: "a", scores: A.scores }, { id: "b", scores: B.scores }], careTier: "premier", years: 3, extras: [{ label: "x", amount: 500, kind: "oneoff" }] });
  const sum = q.milestones.reduce((s, m) => s + m.amount, 0);
  assert.equal(sum, q.contract);
});

test("what would lower the tier names the factor and the saving", () => {
  const scores = { nodes: 2, transitions: 2, forms: 2, routing: 1, external: 1, course: 1, reporting: 1, visibility: 2 };
  const low = MQ.whatWouldLower(model, scores);
  assert.equal(low.length, 4);
  assert.equal(low[0].tier, "Simple");
  assert.equal(low[0].saving, (1950 + 7450) - (1450 + 3950));
});

test("the published Care table is the greater of the floor and the percentage of build", () => {
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
