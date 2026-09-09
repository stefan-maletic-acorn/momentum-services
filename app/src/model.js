/* The Momentum Services pricing engine.
 *
 * Pure functions over the commercial model (pricing/commercial-model.json)
 * and a set of inputs. No DOM, no state, so app/test/model.test.mjs can hold
 * it to the model and the page can call the same code. Every number comes
 * from the model; this file only does arithmetic.
 *
 *   MQ.scoreTier(model, scores)      -> the tier for one workflow and the rules that fired
 *   MQ.quote(model, inputs)          -> per-workflow lines, a year-by-year schedule, totals
 *   MQ.summaryText(model, q, inputs) -> the plain-text cut for the clipboard
 *
 * inputs: {
 *   engagement: { client, preparedBy, date, existingWorkflows },
 *   workflows:  [ { id, name, scores: {factorKey: 1|2|3} } ],
 *   careTier: "essential"|"standard"|"premier", extendedCoverage: bool, years: 1|2|3,
 *   extras: [{label, amount, kind: "oneoff"|"annual", indexed: bool}]
 * }
 */
(function (root) {
  "use strict";

  /** Round half away from zero to whole dollars, the way a spreadsheet
   *  does, so the page and the model agree to the dollar. */
  function rnd(v) {
    var sign = v < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(v) + 1e-9);
  }

  function tierByKey(model, key) {
    for (var i = 0; i < model.scorecard.tiers.length; i++) {
      if (model.scorecard.tiers[i].key === key) return model.scorecard.tiers[i];
    }
    return null;
  }

  function careTierByKey(model, key) {
    for (var i = 0; i < model.care.tiers.length; i++) {
      if (model.care.tiers[i].key === key) return model.care.tiers[i];
    }
    return null;
  }

  var ORDER = ["simple", "moderate", "complex"];

  function tierForTotal(model, total) {
    var tiers = model.scorecard.tiers;
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      if (total >= t.min && total <= t.max) return t.key;
    }
    return total > 24 ? "complex" : "simple";
  }

  /** Score the eight factors of one workflow. `scores` maps factor key to
   *  points (1, 2 or 3); an unscored factor is missing. */
  function scoreTier(model, scores) {
    var sc = model.scorecard;
    scores = scores || {};
    var total = 0, threes = 0, scored = 0;
    for (var i = 0; i < sc.factors.length; i++) {
      var pts = scores[sc.factors[i].key];
      if (pts) { total += pts; scored += 1; if (pts === 3) threes += 1; }
    }
    var complete = scored === sc.factors.length;
    var rules = [];
    var key = complete ? tierForTotal(model, total) : null;
    if (complete && scores[sc.floor_rule.factor] === sc.floor_rule.points &&
        ORDER.indexOf(key) < ORDER.indexOf(sc.floor_rule.min_tier)) {
      key = sc.floor_rule.min_tier;
      rules.push({ key: "floor", text: sc.floor_rule.text });
    }
    return {
      total: total, threes: threes, scored: scored, complete: complete,
      tierKey: key, tier: key ? tierByKey(model, key) : null, rules: rules,
    };
  }

  /** Year 1 Care fee for a workflow tier and a Care tier, from the published
   *  table, plus extended coverage where chosen and allowed. */
  function careFee(model, tierKey, careKey, extended) {
    var base = model.care.table[tierKey][careKey];
    var ext = model.care.extended_coverage;
    var extra = (extended && careKey === ext.tier) ? rnd(base * ext.percent_of_care / 100) : 0;
    return { base: base, extended: extra, total: base + extra };
  }

  /** The repeat-workflow discount for the workflow at `position` in the
   *  client's portfolio: 0 is their first workflow with Acorn. */
  function discountPercent(model, position) {
    var ps = model.discounts.repeat_workflow.positions;
    var idx = Math.max(0, Math.min(ps.length - 1, position));
    return ps[idx].percent;
  }

  /** The savings a lower score on one factor would bring: for each factor
   *  scored above 1, what tier a one-point reduction would land in. */
  function whatWouldLower(model, scores) {
    var now = scoreTier(model, scores);
    var out = [];
    if (!now.complete) return out;
    for (var i = 0; i < model.scorecard.factors.length; i++) {
      var f = model.scorecard.factors[i];
      var pts = scores[f.key];
      if (!pts || pts === 1) continue;
      var lower = f.options[0].points;
      for (var j = 0; j < f.options.length; j++) if (f.options[j].points < pts) lower = f.options[j].points;
      var copy = {}; for (var k in scores) copy[k] = scores[k];
      copy[f.key] = lower;
      var then = scoreTier(model, copy);
      if (then.tierKey !== now.tierKey && ORDER.indexOf(then.tierKey) < ORDER.indexOf(now.tierKey)) {
        var saving = (model.prices[now.tierKey].discovery + model.prices[now.tierKey].build) -
                     (model.prices[then.tierKey].discovery + model.prices[then.tierKey].build);
        var label = "";
        for (var o = 0; o < f.options.length; o++) if (f.options[o].points === lower) label = f.options[o].label;
        out.push({ factor: f.label, from: pts, to: lower, toLabel: label, tier: then.tier.label, saving: saving });
      }
    }
    return out;
  }

  function durationText(model, tierKey) {
    return model.build.duration[tierKey] || "";
  }

  /** Price an engagement of one or more workflows. */
  function quote(model, inputs) {
    var wfs = inputs.workflows || [];
    var scored = wfs.map(function (w) { return scoreTier(model, w.scores); });
    var ready = wfs.length > 0 && scored.every(function (s) { return s.complete; });
    if (!ready) return { ready: false, scores: scored };

    var careKey = inputs.careTier || "standard";
    var careTier = careTierByKey(model, careKey);
    var years = Math.max(1, Math.min(3, inputs.years || 1));
    var cpi = model.indexation.cpi_percent / 100;
    var existing = Math.max(0, parseInt((inputs.engagement || {}).existingWorkflows, 10) || 0);
    var extras = (inputs.extras || []).filter(function (e) { return e && e.label && isFinite(e.amount) && e.amount !== 0; });

    var lines = [], workflows = [], oneOff = 0, careBase = 0, careExt = 0;
    wfs.forEach(function (w, i) {
      var st = scored[i], p = model.prices[st.tierKey];
      var pct = discountPercent(model, existing + i);
      var dDisc = rnd(p.discovery * pct / 100), bDisc = rnd(p.build * pct / 100);
      var care = careFee(model, st.tierKey, careKey, !!inputs.extendedCoverage);
      var name = w.name || ("Workflow " + (i + 1));
      lines.push({ key: "discovery-" + i, wf: i, workflow: name, label: "Discovery", detail: "Workflow Design Document, confirmed scorecard, data-dependency register", amount: p.discovery, discount: dDisc, net: p.discovery - dDisc, recurs: false });
      lines.push({ key: "build-" + i, wf: i, workflow: name, label: "Build", detail: durationText(model, st.tierKey) + ", then UAT, go-live, hypercare and warranty", amount: p.build, discount: bDisc, net: p.build - bDisc, recurs: false });
      lines.push({ key: "care-" + i, wf: i, workflow: name, label: "Momentum Care, " + careTier.label, detail: "Year 1, annually in advance from go-live", amount: care.base, discount: 0, net: care.base, recurs: true });
      oneOff += (p.discovery - dDisc) + (p.build - bDisc);
      careBase += care.base; careExt += care.extended;
      workflows.push({ index: i, name: name, score: st, tierKey: st.tierKey, tier: st.tier,
                       discovery: p.discovery, build: p.build, discountPercent: pct,
                       discoveryNet: p.discovery - dDisc, buildNet: p.build - bDisc, oneOff: (p.discovery - dDisc) + (p.build - bDisc),
                       care: care, duration: durationText(model, st.tierKey), lowering: whatWouldLower(model, w.scores) });
    });
    if (careExt) {
      lines.push({ key: "extended", label: model.care.extended_coverage.label, detail: model.care.extended_coverage.percent_of_care + "% of the Care fee, all workflows", amount: careExt, discount: 0, net: careExt, recurs: true });
    }
    var annualIndexed = 0, annualFlat = 0, oneOffExtras = 0;
    extras.forEach(function (e, i) {
      var amt = rnd(e.amount), annual = e.kind === "annual";
      lines.push({ key: "extra-" + i, label: e.label, detail: annual ? (e.indexed ? "Annual, indexed at " + model.indexation.cpi_percent + "%" : "Annual, not indexed") : "One-off", amount: amt, discount: 0, net: amt, recurs: annual, indexed: !!e.indexed, extra: true });
      if (!annual) oneOffExtras += amt; else if (e.indexed) annualIndexed += amt; else annualFlat += amt;
    });

    var careY1 = careBase + careExt;
    var schedule = [];
    for (var y = 1; y <= years; y++) {
      var factor = Math.pow(1 + cpi, y - 1);
      var careY = rnd(careY1 * factor);
      var extrasY = rnd(annualIndexed * factor) + annualFlat;
      var one = y === 1 ? oneOff + oneOffExtras : 0;
      schedule.push({ year: y, factor: factor, oneOff: one, care: careY, extras: extrasY, total: one + careY + extrasY });
    }
    var contract = 0; schedule.forEach(function (s) { contract += s.total; });

    var discoveryNet = 0, buildNet = 0;
    workflows.forEach(function (w) { discoveryNet += w.discoveryNet; buildNet += w.buildNet; });
    var milestones = [{ when: "On order", what: "Discovery, in full" + (workflows.length > 1 ? ", all workflows" : ""), amount: discoveryNet }];
    if (oneOffExtras) milestones.push({ when: "On order", what: "Other one-off lines", amount: oneOffExtras });
    milestones.push({ when: "First build sprint", what: "Build, 50%", amount: rnd(buildNet / 2) });
    milestones.push({ when: "Go-live", what: "Build, 50%", amount: buildNet - rnd(buildNet / 2) });
    milestones.push({ when: "Go-live", what: "Care year 1, annually in advance", amount: careY1 + annualIndexed + annualFlat });
    for (var yy = 2; yy <= years; yy++) {
      milestones.push({ when: "Anniversary " + (yy - 1), what: "Care year " + yy + ", +" + model.indexation.cpi_percent + "%", amount: schedule[yy - 1].total });
    }

    return {
      ready: true, workflows: workflows, careTier: careTier, careExtended: careExt, years: years,
      cpiPercent: model.indexation.cpi_percent, existing: existing,
      lines: lines, schedule: schedule, contract: contract,
      year1: schedule[0].total, recurring: careY1 + annualIndexed + annualFlat,
      serviceYear1: oneOff + careY1, milestones: milestones,
      anyDiscount: workflows.some(function (w) { return w.discountPercent > 0; }),
    };
  }

  function money(model, v) {
    var neg = v < 0;
    var s = Math.abs(rnd(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + "$" + s;
  }

  /** The quote as plain text, for the clipboard. */
  function summaryText(model, q, inputs) {
    var eng = inputs.engagement || {};
    var out = [];
    out.push("Momentum Solutions Architect Service - quote");
    if (eng.client) out.push("Client: " + eng.client);
    out.push("Care: " + q.careTier.label + (q.careExtended ? " with extended coverage" : ""));
    out.push("");
    q.workflows.forEach(function (w) {
      out.push(w.name + " - " + w.tier.label + " (scorecard " + w.score.total + ")");
      out.push("  Discovery " + money(model, w.discoveryNet) + ", Build " + money(model, w.buildNet) + (w.discountPercent ? " (" + w.discountPercent + "% repeat-workflow discount)" : "") + ", Care " + money(model, w.care.base) + " a year");
    });
    q.lines.forEach(function (l) {
      if (l.wf === undefined) out.push(l.label + ": " + money(model, l.net) + (l.recurs ? " a year" : ""));
    });
    out.push("");
    q.schedule.forEach(function (s) {
      out.push("Year " + s.year + ": " + money(model, s.total) + (s.year > 1 ? " (Care +" + q.cpiPercent + "%)" : ""));
    });
    out.push("Total over " + (q.years === 1 ? "12 months" : q.years + " years") + ": " + money(model, q.contract));
    out.push("");
    out.push(model.tax_note + " Care indexes at " + q.cpiPercent + "% each anniversary.");
    return out.join("\n");
  }

  var MQ = { rnd: rnd, money: money, ORDER: ORDER, tierByKey: tierByKey, careTierByKey: careTierByKey,
             scoreTier: scoreTier, careFee: careFee, discountPercent: discountPercent, whatWouldLower: whatWouldLower,
             quote: quote, durationText: durationText, summaryText: summaryText };
  root.MQ = MQ;
  if (typeof module !== "undefined" && module.exports) module.exports = MQ;
})(typeof globalThis !== "undefined" ? globalThis : this);
