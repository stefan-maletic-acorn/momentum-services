/* The Momentum Services pricing engine.
 *
 * Pure functions over the commercial model (pricing/commercial-model.json)
 * and a set of inputs. No DOM, no state, so app/test/model.test.mjs can hold
 * it to the worked examples in the document and the page can call the same
 * code. Every number comes from the model; this file only does arithmetic.
 *
 *   MQ.scoreTier(model, scores)           -> the tier and the rules that fired
 *   MQ.quote(model, inputs)               -> lines, a year-by-year schedule, totals
 *   MQ.summaryText(model, q, inputs)      -> the plain-text cut for the clipboard
 */
(function (root) {
  "use strict";

  /** Round half away from zero to whole dollars, the way a spreadsheet
   *  does, so the page and the document agree to the dollar. */
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
      if (t.min !== null && t.max !== null && total >= t.min && total <= t.max) return t.key;
    }
    return total > 24 ? "complex" : "simple";
  }

  /**
   * Score the eight factors. `scores` maps factor key to points (1, 2 or 3);
   * an unscored factor is missing.
   */
  function scoreTier(model, scores) {
    var sc = model.scorecard;
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

  function repeatPercent(model, positionKey) {
    var ps = model.discounts.repeat_workflow.positions;
    for (var i = 0; i < ps.length; i++) if (ps[i].key === positionKey) return ps[i].percent;
    return 0;
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
        out.push({ factor: f.label, from: pts, to: lower, toLabel: label,
                   tier: then.tier.label, saving: saving });
      }
    }
    return out;
  }

  /**
   * Price an engagement.
   *
   * inputs: {
   *   scores: {factorKey: points},
   *   careTier: "essential"|"standard"|"premier", extendedCoverage: bool,
   *   repeat: "first"|"second"|"third", years: 1|2|3,
   *   extras: [{label, amount, kind: "oneoff"|"annual", indexed: bool}]
   * }
   */
  function quote(model, inputs) {
    var st = scoreTier(model, inputs.scores || {});
    if (!st.tierKey) return { ready: false, score: st };

    var tierKey = st.tierKey;
    var prices = model.prices[tierKey];
    var careKey = inputs.careTier || "standard";
    var care = careFee(model, tierKey, careKey, !!inputs.extendedCoverage);
    var pct = repeatPercent(model, inputs.repeat || "first");
    var years = Math.max(1, Math.min(3, inputs.years || 1));
    var cpi = model.indexation.cpi_percent / 100;
    var extras = (inputs.extras || []).filter(function (e) { return e && e.label && isFinite(e.amount) && e.amount !== 0; });

    var discovery = prices.discovery, build = prices.build;
    var discDiscount = rnd(discovery * pct / 100), buildDiscount = rnd(build * pct / 100);

    var lines = [
      { key: "discovery", label: "Discovery", detail: "Workflow Design Document, confirmed scorecard, data-dependency register", amount: discovery, discount: discDiscount, net: discovery - discDiscount, recurs: false },
      { key: "build", label: "Build", detail: sprintsText(model, tierKey) + ", UAT, go-live, hypercare and warranty", amount: build, discount: buildDiscount, net: build - buildDiscount, recurs: false },
      { key: "care", label: "Momentum Care, " + careTierByKey(model, careKey).label, detail: "Year 1, annually in advance from go-live", amount: care.base, discount: 0, net: care.base, recurs: true },
    ];
    if (care.extended) {
      lines.push({ key: "extended", label: model.care.extended_coverage.label, detail: model.care.extended_coverage.percent_of_care + "% of the Care fee", amount: care.extended, discount: 0, net: care.extended, recurs: true });
    }
    extras.forEach(function (e, i) {
      lines.push({ key: "extra-" + i, label: e.label, detail: e.kind === "annual" ? (e.indexed ? "Annual, indexed at " + model.indexation.cpi_percent + "%" : "Annual, not indexed") : "One-off", amount: rnd(e.amount), discount: 0, net: rnd(e.amount), recurs: e.kind === "annual", indexed: !!e.indexed, extra: true });
    });

    var oneOff = 0, careY1 = care.total, annualIndexed = 0, annualFlat = 0;
    lines.forEach(function (l) {
      if (!l.recurs) oneOff += l.net;
      else if (l.extra) { if (l.indexed) annualIndexed += l.net; else annualFlat += l.net; }
    });

    var schedule = [];
    for (var y = 1; y <= years; y++) {
      var factor = Math.pow(1 + cpi, y - 1);
      var careY = rnd(careY1 * factor);
      var extrasY = rnd(annualIndexed * factor) + annualFlat;
      schedule.push({
        year: y, factor: factor,
        oneOff: y === 1 ? oneOff : 0,
        care: careY, extras: extrasY,
        total: (y === 1 ? oneOff : 0) + careY + extrasY,
        uplift: y === 1 ? 0 : careY - rnd(careY1 * Math.pow(1 + cpi, y - 2)),
      });
    }
    var contract = 0; schedule.forEach(function (s) { contract += s.total; });

    var milestones = [
      { when: "On order", what: "Discovery, in full", amount: discovery - discDiscount },
      { when: "First build sprint", what: "Build, 50%", amount: rnd((build - buildDiscount) / 2) },
      { when: "Go-live", what: "Build, 50%", amount: (build - buildDiscount) - rnd((build - buildDiscount) / 2) },
      { when: "Go-live", what: "Care year 1, annually in advance", amount: careY1 + annualIndexed + annualFlat },
    ];
    for (var yy = 2; yy <= years; yy++) {
      milestones.push({ when: "Anniversary " + (yy - 1), what: "Care year " + yy + ", +" + model.indexation.cpi_percent + "%", amount: schedule[yy - 1].total });
    }
    var oneOffExtras = 0; lines.forEach(function (l) { if (l.extra && !l.recurs) oneOffExtras += l.net; });
    if (oneOffExtras) milestones.splice(1, 0, { when: "On order", what: "Other one-off lines", amount: oneOffExtras });

    return {
      ready: true, score: st, tierKey: tierKey, tier: st.tier,
      careTier: careTierByKey(model, careKey), care: care, repeatPercent: pct, years: years,
      cpiPercent: model.indexation.cpi_percent,
      lines: lines, schedule: schedule, contract: contract,
      year1: schedule[0].total, recurring: careY1 + annualIndexed + annualFlat,
      serviceYear1: (discovery - discDiscount) + (build - buildDiscount) + careY1,
      milestones: milestones, sprints: model.build.sprints[tierKey],
      lowering: whatWouldLower(model, inputs.scores || {}),
    };
  }

  function sprintsText(model, tierKey) {
    var n = model.build.sprints[tierKey];
    if (n === 0.5) return "Half a two-week sprint";
    return n + (n === 1 ? " two-week sprint" : " two-week sprints");
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
    var from = "";
    out.push("Momentum Solutions Architect Service - quote");
    if (eng.client) out.push("Client: " + eng.client);
    if (eng.workflow) out.push("Workflow: " + eng.workflow);
    out.push("Tier: " + q.tier.label + " (scorecard " + q.score.total + ")");
    out.push("Care: " + q.careTier.label + (q.care.extended ? " with extended coverage" : ""));
    out.push("");
    q.lines.forEach(function (l) {
      out.push(l.label + ": " + from + money(model, l.net) + (l.discount ? " (" + q.repeatPercent + "% repeat-workflow discount applied)" : "") + (l.recurs ? " a year" : ""));
    });
    out.push("");
    q.schedule.forEach(function (s) {
      out.push("Year " + s.year + ": " + from + money(model, s.total) + (s.year > 1 ? " (Care +" + q.cpiPercent + "%)" : ""));
    });
    out.push("Total over " + (q.years === 1 ? "12 months" : q.years + " years") + ": " + from + money(model, q.contract));
    out.push("");
    out.push(model.tax_note + " Care indexes at " + q.cpiPercent + "% each anniversary.");
    return out.join("\n");
  }

  var MQ = { rnd: rnd, money: money, ORDER: ORDER, tierByKey: tierByKey, careTierByKey: careTierByKey,
             scoreTier: scoreTier, careFee: careFee, whatWouldLower: whatWouldLower, quote: quote,
             sprintsText: sprintsText, summaryText: summaryText };
  root.MQ = MQ;
  if (typeof module !== "undefined" && module.exports) module.exports = MQ;
})(typeof globalThis !== "undefined" ? globalThis : this);
