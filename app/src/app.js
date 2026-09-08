/* The Momentum quoting tool: a step-by-step pre-scope that ends in a quote.
 *
 * Twelve steps in a rail: the engagement, the eight scorecard factors, the
 * tier, Care and commercials, and the quote. Everything is rendered from one
 * state object; every change re-renders. Saved quotes live in the artifact's
 * database (the `db` capability) when it is there, and the working draft is
 * mirrored to localStorage so a refresh does not lose a call's worth of
 * answers. Customer strings reach the DOM only through esc().
 */
(function (root) {
  "use strict";
  var MQ = root.MQ;
  var model = JSON.parse(document.getElementById("model-json").textContent);
  var DRAFT_KEY = "mq-draft-v1";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) { return MQ.money(model, v); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function friendlyDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  }

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------

  function blankInputs() {
    var checks = {};
    model.pre_scope.checks.forEach(function (c) { checks[c.key] = null; });
    return {
      engagement: { client: "", workflow: "", preparedBy: "", date: today(), checks: checks, notes: "" },
      scores: {}, linked: false,
      careTier: "standard", extendedCoverage: false, repeat: "first", years: 1, extras: [],
    };
  }

  function exampleInputs() {
    var ex = model.worked_examples.filter(function (e) { return e.scores; })[0];
    var inp = blankInputs();
    inp.engagement.client = "Example client";
    inp.engagement.workflow = ex.name.split(",")[0];
    inp.engagement.checks = { studio: "yes", blueprint: "no", self_build: "no", integration: "no" };
    inp.scores = Object.assign({}, ex.scores);
    inp.careTier = ex.care;
    inp.years = 3;
    inp.example = true;
    return inp;
  }

  var state = {
    view: "wizard", step: 0, inputs: null,
    db: null, dbState: "connecting", quotes: [], quotesLoaded: false, savedId: null, toast: "",
  };

  function loadDraft() {
    try {
      var raw = root.localStorage.getItem(DRAFT_KEY);
      if (raw) { var d = JSON.parse(raw); if (d && d.inputs) { state.inputs = d.inputs; state.step = d.step || 0; state.savedId = d.savedId || null; return; } }
    } catch (e) { /* storage may be unavailable */ }
    state.inputs = exampleInputs();
  }
  function saveDraft() {
    try { root.localStorage.setItem(DRAFT_KEY, JSON.stringify({ inputs: state.inputs, step: state.step, savedId: state.savedId })); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------
  // steps
  // ---------------------------------------------------------------------

  var STEPS = [{ key: "engagement", label: "The engagement", group: "Pre-scope" }];
  model.scorecard.factors.forEach(function (f, i) {
    STEPS.push({ key: "factor", factor: f, index: i, label: f.label, group: i === 0 ? "Complexity Scorecard" : null });
  });
  STEPS.push({ key: "tier", label: "Tier", group: "Result" });
  STEPS.push({ key: "care", label: "Care and commercials", group: null });
  STEPS.push({ key: "quote", label: "Quote", group: null });

  function stepDone(i) {
    var s = STEPS[i], inp = state.inputs;
    if (s.key === "engagement") return !!(inp.engagement.client && inp.engagement.workflow);
    if (s.key === "factor") return !!inp.scores[s.factor.key];
    if (s.key === "tier") return MQ.scoreTier(model, inp.scores, inp.linked).complete;
    if (s.key === "care") return !!inp.careTier;
    return false;
  }

  function currentQuote() { return MQ.quote(model, state.inputs); }

  // ---------------------------------------------------------------------
  // rendering
  // ---------------------------------------------------------------------

  function render() {
    var app = document.getElementById("app");
    var html = renderBar();
    if (state.view === "library") html += renderLibrary();
    else html += '<div class="mq-page">' + renderRail() + '<main class="mq-main">' + renderStep() + "</main>" + renderSide() + "</div>";
    app.innerHTML = html;
    var cur = app.querySelector('.mq-rail [aria-current="step"]');
    if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: "nearest" }); } catch (e) { /* ignore */ } }
  }

  function renderBar() {
    var lib = state.view === "library";
    var n = state.quotes.length;
    return '<header class="mq-bar"><div class="brand"><span class="eyebrow">Acorn Works · Momentum Services</span>' +
      "<h1>Momentum Quoting Tool</h1></div><nav>" +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="view" data-view="wizard"' + (lib ? "" : ' aria-current="page"') + ">Quote</button>" +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="view" data-view="library"' + (lib ? ' aria-current="page"' : "") + ">Library" + (state.quotesLoaded ? " (" + n + ")" : "") + "</button>" +
      '<button type="button" class="btn btn-green btn-sm" data-act="new">New quote</button>' +
      "</nav></header>";
  }

  function renderRail() {
    var out = ['<nav class="mq-rail" aria-label="Steps"><ol>'];
    STEPS.forEach(function (s, i) {
      if (s.group) out.push('<li class="group eyebrow">' + esc(s.group) + "</li>");
      var done = stepDone(i), cur = i === state.step;
      var pts = s.key === "factor" ? state.inputs.scores[s.factor.key] : null;
      out.push('<li><button type="button" class="rail-step' + (done ? " done" : "") + '" data-act="go" data-step="' + i + '"' + (cur ? ' aria-current="step"' : "") + ">" +
        '<span class="dot">' + (s.key === "factor" ? (s.index + 1) : (done ? "✓" : "")) + "</span>" +
        '<span class="label">' + esc(s.label) + "</span>" +
        (pts ? '<span class="pts">' + pts + "</span>" : "") + "</button></li>");
    });
    out.push("</ol></nav>");
    return out.join("");
  }

  function navFooter(i) {
    var prev = i > 0, next = i < STEPS.length - 1;
    var nextLabel = STEPS[i + 1] ? (STEPS[i + 1].key === "factor" ? "Next: " + STEPS[i + 1].label : STEPS[i + 1].label) : "";
    return "<footer>" +
      (prev ? '<button type="button" class="btn btn-ghost" data-act="go" data-step="' + (i - 1) + '">Back</button>' : "<span></span>") +
      (next ? '<button type="button" class="btn btn-purple" data-act="go" data-step="' + (i + 1) + '">' + esc(nextLabel) + "</button>" : "") +
      "</footer>";
  }

  function renderStep() {
    var s = STEPS[state.step];
    if (s.key === "engagement") return renderEngagement();
    if (s.key === "factor") return renderFactor(s);
    if (s.key === "tier") return renderTier();
    if (s.key === "care") return renderCare();
    return renderQuote();
  }

  function renderEngagement() {
    var e = state.inputs.engagement;
    var out = ['<section class="mq-card"><header><span class="eyebrow">Step 1 of ' + STEPS.length + " · Pre-scope</span><h2>The engagement</h2>",
      '<p class="lede">' + esc(model.pre_scope.text) + "</p></header>"];
    if (state.inputs.example) {
      out.push('<div class="rule info"><div>This is the worked example from the commercial model (supplier onboarding, Moderate, Standard Care), loaded so you can see the tool at rest. ' +
        '<button type="button" class="btn-text" data-act="new">Start a blank quote</button> when you are on a call.</div></div>');
    }
    out.push('<div class="sec"><div class="fields">' +
      field("client", "Client", e.client, "text", "Organisation name") +
      field("workflow", "Workflow", e.workflow, "text", "The process, in the client's words") +
      field("preparedBy", "Prepared by", e.preparedBy, "text", "Your name") +
      field("date", "Date", e.date, "date", "") + "</div></div>");
    out.push('<div class="sec"><h3>Four questions before the scorecard</h3><p class="why">The pre-scope exists to set the tier before the client commits, and to disqualify. Each of these is a fork in the call, not a blocker in the tool.</p>');
    out.push('<div class="fields">');
    model.pre_scope.checks.forEach(function (c) {
      var v = e.checks[c.key];
      var msg = v === "yes" ? c.yes : v === "no" ? c.no : "";
      var flagged = v && v === c.flag_when;
      out.push('<div class="check"><div class="q">' + esc(c.question) + "</div>" +
        '<div class="seg compact" role="group">' +
        '<button type="button" data-act="check" data-key="' + c.key + '" data-val="yes"' + (v === "yes" ? ' aria-pressed="true"' : "") + ">Yes</button>" +
        '<button type="button" data-act="check" data-key="' + c.key + '" data-val="no"' + (v === "no" ? ' aria-pressed="true"' : "") + ">No</button></div>" +
        (msg ? '<div class="rule' + (flagged ? "" : " good") + '"><div>' + esc(msg) + "</div></div>" : "") + "</div>");
    });
    out.push("</div></div>");
    out.push('<div class="sec"><h3>Programme check</h3><label class="toggle"><input type="checkbox" data-act="linked"' + (state.inputs.linked ? " checked" : "") + "><span><b>Multiple linked workflows, or a cross-workflow dependency.</b> " +
      '<span class="muted">' + esc(model.scorecard.programme_rule.text) + "</span></span></label></div>");
    out.push(navFooter(state.step) + "</section>");
    return out.join("");
  }

  function field(key, label, value, type, placeholder) {
    return '<div class="field"><label for="f-' + key + '">' + esc(label) + '</label><input id="f-' + key + '" type="' + type + '" data-act="eng" data-key="' + key + '" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '"></div>';
  }

  function renderFactor(s) {
    var f = s.factor, chosen = state.inputs.scores[f.key];
    var st = MQ.scoreTier(model, state.inputs.scores, state.inputs.linked);
    var out = ['<section class="mq-card"><header><span class="eyebrow">Step ' + (state.step + 1) + " of " + STEPS.length + " · Factor " + (s.index + 1) + " of 8</span><h2>" + esc(f.label) + "</h2></header>"];
    out.push('<div class="ask"><span class="eyebrow">Ask the client</span><blockquote>' + esc(f.ask) + "</blockquote></div>");
    out.push('<p class="why">' + esc(f.why) + "</p>");
    out.push('<div class="sec"><h3>Score it</h3><div class="options' + (f.options.length === 2 ? " two" : "") + '" role="group" aria-label="Score">');
    f.options.forEach(function (o) {
      out.push('<button type="button" class="pick opt" data-act="score" data-key="' + f.key + '" data-pts="' + o.points + '"' + (chosen === o.points ? ' aria-pressed="true"' : "") + ">" +
        '<span class="pts">' + o.points + (o.points === 1 ? " point" : " points") + "</span>" +
        '<span class="txt">' + esc(o.label) + "</span>" +
        (o.points === 3 && f.key === model.scorecard.floor_rule.factor ? '<span class="hint">Floor rule: Moderate or above.</span>' : "") +
        "</button>");
    });
    out.push("</div>");
    out.push('<div class="rule"><div><b>Score conservatively.</b> Where the answer is unclear, pick the higher score. Discovery re-scores with full information and only the difference between tiers is billed or credited.</div></div>');
    if (st.scored) out.push('<p class="small muted num">Running score ' + st.total + " across " + st.scored + " of 8 factors" + (st.threes ? ", " + st.threes + " at 3" : "") + ".</p>");
    out.push("</div>" + navFooter(state.step) + "</section>");
    return out.join("");
  }

  function renderTier() {
    var inp = state.inputs;
    var st = MQ.scoreTier(model, inp.scores, inp.linked);
    var out = ['<section class="mq-card"><header><span class="eyebrow">Step ' + (state.step + 1) + " of " + STEPS.length + " · Result</span><h2>Provisional tier</h2>"];
    if (!st.complete) {
      var missing = model.scorecard.factors.filter(function (f) { return !inp.scores[f.key]; });
      out.push('<p class="lede">' + missing.length + " of 8 factors still to score: " + esc(missing.map(function (f) { return f.label; }).join(", ")) + ".</p></header>");
      out.push('<button type="button" class="btn btn-purple" data-act="go" data-step="' + (STEPS.findIndex(function (s) { return s.key === "factor" && s.factor.key === missing[0].key; })) + '">Score ' + esc(missing[0].label) + "</button>");
      out.push(navFooter(state.step) + "</section>");
      return out.join("");
    }
    var q = currentQuote();
    var p = model.prices[st.tierKey];
    out.push('<p class="lede">Price is set by workflow complexity, not account size. The scorecard total places the workflow in a tier; the tier sets the Discovery and Build price.</p></header>');
    out.push('<div class="tier-hero"><div class="score num">' + st.total + "<small>of 24</small></div><div>" +
      '<div class="eyebrow">Tier</div><div class="name">' + esc(st.tier.label) + "</div>" +
      '<p class="small">' + (st.tierKey === "programme" ? esc(model.scorecard.tiers[3].text) + " Figures below are from-prices." :
        "Discovery " + money(p.discovery) + " and Build " + money(p.build) + ". " + esc(MQ.sprintsText(model, st.tierKey)) + ", then five business days of UAT, ten of hypercare and thirty of warranty.") + "</p></div></div>");
    st.rules.forEach(function (r) { out.push('<div class="rule"><div><b>Rule applied.</b> ' + esc(r.text) + "</div></div>"); });
    out.push('<div class="sec"><h3>What drove it</h3><ul class="factor-list">');
    model.scorecard.factors.forEach(function (f) {
      var pts = inp.scores[f.key], lbl = "";
      f.options.forEach(function (o) { if (o.points === pts) lbl = o.label; });
      out.push('<li><span><span class="f">' + esc(f.label) + '</span><span class="o">' + esc(lbl) + "</span></span>" + '<span class="pts' + (pts === 3 ? " three" : "") + '">' + pts + "</span></li>");
    });
    out.push("</ul></div>");
    if (q.lowering.length) {
      out.push('<div class="sec"><h3>What simplifying would save</h3><p class="why">Publishing the scorecard means the client can see what drives the price and what a simpler requirement would save. Each line is one factor scored one step lower.</p><ul class="lower">');
      q.lowering.forEach(function (l) {
        out.push("<li><span>" + esc(l.factor) + " at " + esc(l.toLabel) + " would make it <b>" + esc(l.tier) + "</b></span><b class=\"num\">saves " + money(l.saving) + "</b></li>");
      });
      out.push("</ul></div>");
    } else if (st.tierKey === "simple") {
      out.push('<div class="rule good"><div>This is already the minimum engagement: one Simple workflow.</div></div>');
    }
    out.push('<div class="sec"><h3>The published tiers</h3><div class="tbl-wrap"><table><thead><tr><th>Tier</th><th>Score</th><th class="num">Discovery</th><th class="num">Build</th><th class="num">Care (Standard)</th><th class="num">Year 1 total</th></tr></thead><tbody>');
    model.scorecard.tiers.forEach(function (t) {
      var pr = model.prices[t.key], care = model.care.table[t.key].standard, from = pr.indicative ? "from " : "";
      out.push("<tr" + (t.key === st.tierKey ? ' class="current"' : "") + "><td>" + esc(t.label) + "</td><td>" + (t.min !== null ? t.min + " to " + t.max : "Linked") + '</td><td class="num">' + from + money(pr.discovery) + '</td><td class="num">' + from + money(pr.build) + '</td><td class="num">' + from + money(care) + '</td><td class="num">' + (pr.indicative ? "Scoped" : money(pr.discovery + pr.build + care)) + "</td></tr>");
    });
    out.push("</tbody></table></div></div>");
    out.push(navFooter(state.step) + "</section>");
    return out.join("");
  }

  function renderCare() {
    var inp = state.inputs;
    var st = MQ.scoreTier(model, inp.scores, inp.linked);
    var out = ['<section class="mq-card"><header><span class="eyebrow">Step ' + (state.step + 1) + " of " + STEPS.length + " · Commercials</span><h2>Care and commercials</h2>",
      '<p class="lede">' + esc(model.care.text) + "</p></header>"];
    if (!st.complete) out.push('<div class="rule"><div>Score all eight factors first. Care is priced from the workflow tier, so the fees below will appear once the tier is known.</div></div>');
    out.push('<div class="sec"><h3>Care tier</h3><div class="care-grid">');
    model.care.tiers.forEach(function (ct) {
      var fee = st.complete ? model.care.table[st.tierKey][ct.key] : null;
      var from = st.tierKey === "programme" ? "from " : "";
      out.push('<button type="button" class="pick care" data-act="care" data-key="' + ct.key + '"' + (inp.careTier === ct.key ? ' aria-pressed="true"' : "") + ">" +
        '<span class="name">' + esc(ct.label) + "</span>" +
        '<span class="fee num">' + (fee !== null ? from + money(fee) : "—") + '</span><span class="basis">a year · ' + ct.percent_of_build + "% of build, min " + money(ct.minimum) + "</span>" +
        '<span class="stats">' +
        '<span class="stat"><span class="k">Allowance</span><span class="v">' + ct.allowance_hours + " hrs a year</span></span>" +
        '<span class="stat"><span class="k">Critical response</span><span class="v">' + esc(ct.critical_response) + "</span></span>" +
        '<span class="stat"><span class="k">Review</span><span class="v">' + esc(ct.cadence) + "</span></span>" +
        '<span class="stat"><span class="k">Service credits</span><span class="v">' + (ct.service_credits ? "Yes" : "No") + "</span></span>" +
        "</span></button>");
    });
    out.push("</div>");
    var ext = model.care.extended_coverage;
    out.push('<label class="toggle"><input type="checkbox" data-act="extended"' + (inp.extendedCoverage ? " checked" : "") + (inp.careTier !== ext.tier ? " disabled" : "") + "><span><b>" + esc(ext.label) + ".</b> " +
      '<span class="muted">' + esc(ext.text) + (inp.careTier !== ext.tier ? " Choose Premier to add it." : "") + "</span></span></label></div>");

    out.push('<div class="sec"><h3>Term</h3><p class="why">Only Care recurs. Care increases by ' + model.indexation.cpi_percent + "% at each anniversary and is invoiced annually in advance, co-terminus with the Momentum license.</p>");
    out.push('<div class="seg" role="group" aria-label="Term">' + [1, 2, 3].map(function (y) {
      return '<button type="button" data-act="years" data-years="' + y + '"' + (inp.years === y ? ' aria-pressed="true"' : "") + ">" + (y === 1 ? "12 months" : y + " years") + "</button>";
    }).join("") + "</div></div>");

    var repeatLabels = { first: "First workflow", second: "Second · 10% off", third: "Third or later · 15% off" };
    out.push('<div class="sec"><h3>Repeat workflow</h3><p class="why">' + esc(model.discounts.repeat_workflow.text) + "</p>");
    out.push('<div class="seg" role="group" aria-label="Repeat workflow">' + model.discounts.repeat_workflow.positions.map(function (p) {
      return '<button type="button" data-act="repeat" data-key="' + p.key + '"' + (inp.repeat === p.key ? ' aria-pressed="true"' : "") + ">" + esc(repeatLabels[p.key] || p.label) + "</button>";
    }).join("") + "</div></div>");

    out.push('<div class="sec"><h3>Other lines</h3><p class="why">Anything quoted alongside the service: an Advanced Momentum license uplift, a custom integration, data migration, on-site delivery. Annual lines repeat each year; tick indexed to escalate one at ' + model.indexation.cpi_percent + "% with Care.</p>");
    out.push('<div class="extras">');
    inp.extras.forEach(function (x, i) {
      out.push('<div class="extra-row">' +
        '<input type="text" aria-label="Line label" data-act="extra" data-i="' + i + '" data-key="label" value="' + esc(x.label) + '" placeholder="Label">' +
        '<input type="number" aria-label="Amount" data-act="extra" data-i="' + i + '" data-key="amount" value="' + esc(x.amount || "") + '" placeholder="Amount, AUD" min="0" step="1">' +
        '<div class="seg compact"><button type="button" data-act="extra-kind" data-i="' + i + '" data-kind="oneoff"' + (x.kind !== "annual" ? ' aria-pressed="true"' : "") + '>One-off</button><button type="button" data-act="extra-kind" data-i="' + i + '" data-kind="annual"' + (x.kind === "annual" ? ' aria-pressed="true"' : "") + ">Annual</button></div>" +
        '<label class="toggle small"><input type="checkbox" data-act="extra-indexed" data-i="' + i + '"' + (x.indexed ? " checked" : "") + (x.kind !== "annual" ? " disabled" : "") + "><span>Indexed</span></label>" +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="extra-del" data-i="' + i + '">Remove</button></div>');
    });
    out.push('<div><button type="button" class="btn btn-ghost btn-sm" data-act="extra-add">Add a line</button></div></div></div>');
    out.push(navFooter(state.step) + "</section>");
    return out.join("");
  }

  function renderQuote() {
    var inp = state.inputs, e = inp.engagement;
    var q = currentQuote();
    var out = ['<section class="mq-card" id="quote-sheet"><header><span class="eyebrow no-print">Step ' + STEPS.length + " of " + STEPS.length + " · Quote</span>"];
    if (!q.ready) {
      out.push('<h2>Quote</h2><p class="lede">Score all eight factors to produce a quote.</p></header>' +
        '<button type="button" class="btn btn-purple" data-act="go" data-step="9">Go to the tier</button>' + navFooter(state.step) + "</section>");
      return out.join("");
    }
    var from = q.indicative ? "from " : "";
    var termLabel = q.years === 1 ? "12 months" : q.years + " years";
    out.push('<div class="quote-head"><div><h2>' + esc(model.service.name) + "</h2>" +
      '<p class="lede">' + esc(e.client || "Client") + (e.workflow ? " · " + esc(e.workflow) : "") + "</p></div>" +
      '<dl class="meta"><dt>Prepared by</dt><dd>' + esc(e.preparedBy || "—") + "</dd><dt>Date</dt><dd>" + esc(friendlyDate(e.date)) + "</dd><dt>Tier</dt><dd>" + esc(q.tier.label) + " (scorecard " + q.score.total + ")</dd><dt>Care</dt><dd>" + esc(q.careTier.label) + (q.care.extended ? ", extended coverage" : "") + "</dd></dl></div></header>");
    if (q.indicative) out.push('<div class="rule"><div><b>Programme.</b> ' + esc(model.scorecard.tiers[3].text) + " Every figure here is a from-price; the engagement is scoped individually.</div></div>");
    var flagged = model.pre_scope.checks.filter(function (c) { return e.checks[c.key] === c.flag_when; });
    flagged.forEach(function (c) { out.push('<div class="rule no-print"><div><b>From the pre-scope.</b> ' + esc(c[c.flag_when]) + "</div></div>"); });

    out.push('<div class="totals">' +
      '<div class="tile lead"><span class="k">Total over ' + termLabel + '</span><span class="v num">' + from + money(q.contract) + "</span><span class=\"small\">" + esc(model.tax_note) + "</span></div>" +
      '<div class="tile"><span class="k">Year 1</span><span class="v num">' + from + money(q.year1) + '</span><span class="small muted">Discovery, Build and first year of Care</span></div>' +
      '<div class="tile"><span class="k">Recurring from year 2</span><span class="v num">' + from + money(q.schedule[1] ? q.schedule[1].total : MQ.rnd(q.recurring * (1 + q.cpiPercent / 100))) + '</span><span class="small muted">Care, +' + q.cpiPercent + "% each anniversary</span></div></div>");

    out.push("<div class=\"sec\"><h3>What is included</h3><div class=\"tbl-wrap\"><table><thead><tr><th>Line</th><th class=\"num\">Year 1 rate</th>" + (q.repeatPercent ? '<th class="num">Discount</th>' : "") + '<th class="num">Amount</th></tr></thead><tbody>');
    q.lines.forEach(function (l) {
      out.push("<tr><td>" + esc(l.label) + '<span class="detail">' + esc(l.detail) + '</span></td><td class="num">' + from + money(l.amount) + (l.recurs ? " / yr" : "") + "</td>" +
        (q.repeatPercent ? '<td class="num">' + (l.discount ? "-" + money(l.discount) : "—") + "</td>" : "") +
        '<td class="num">' + from + money(l.net) + (l.recurs ? " / yr" : "") + "</td></tr>");
    });
    out.push('<tr class="total"><td>Year 1</td><td></td>' + (q.repeatPercent ? "<td></td>" : "") + '<td class="num">' + from + money(q.year1) + "</td></tr></tbody></table></div></div>");

    out.push("<div class=\"sec\"><h3>Year by year</h3><div class=\"tbl-wrap\"><table><thead><tr><th>Year</th><th class=\"num\">One-off</th><th class=\"num\">Care</th>" + (q.schedule.some(function (s) { return s.extras; }) ? '<th class="num">Other annual</th>' : "") + '<th class="num">Total</th></tr></thead><tbody>');
    var hasExtras = q.schedule.some(function (s) { return s.extras; });
    q.schedule.forEach(function (s) {
      out.push("<tr><td>Year " + s.year + (s.year > 1 ? ' <span class="detail">Care +' + q.cpiPercent + "% on year " + (s.year - 1) + "</span>" : "") + '</td><td class="num">' + (s.oneOff ? from + money(s.oneOff) : "—") + '</td><td class="num">' + from + money(s.care) + "</td>" +
        (hasExtras ? '<td class="num">' + (s.extras ? money(s.extras) : "—") + "</td>" : "") + '<td class="num">' + from + money(s.total) + "</td></tr>");
    });
    out.push('<tr class="total"><td>Total over ' + termLabel + "</td><td></td><td></td>" + (hasExtras ? "<td></td>" : "") + '<td class="num">' + from + money(q.contract) + "</td></tr></tbody></table></div></div>");

    out.push("<div class=\"sec\"><h3>Payment schedule</h3><div class=\"tbl-wrap\"><table><thead><tr><th>When</th><th>What</th><th class=\"num\">Amount</th></tr></thead><tbody>");
    q.milestones.forEach(function (m) { out.push("<tr><td>" + esc(m.when) + "</td><td>" + esc(m.what) + '</td><td class="num">' + from + money(m.amount) + "</td></tr>"); });
    out.push("</tbody></table></div></div>");

    out.push("<div class=\"sec\"><h3>How it runs</h3><div class=\"tbl-wrap\"><table><thead><tr><th>Stage</th><th>Duration</th><th>What happens</th><th>Client time</th></tr></thead><tbody>");
    out.push("<tr><td>Discovery</td><td>A week or two</td><td>" + esc(model.discovery.text) + "</td><td>Two 60-minute sessions</td></tr>");
    model.build.stages.forEach(function (s) {
      var dur = s.stage === "Build sprints" && q.sprints !== null ? esc(MQ.sprintsText(model, q.tierKey)) : esc(s.duration);
      out.push("<tr><td>" + esc(s.stage) + "</td><td>" + dur + "</td><td>" + esc(s.text) + "</td><td>" + esc(s.client_time || "—") + "</td></tr>");
    });
    out.push("</tbody></table></div></div>");

    out.push('<div class="sec"><h3>Momentum Care</h3><div class="cols"><div><h4>Covered</h4><ul>' + model.care.covered.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div>" +
      "<div><h4>Not covered</h4><ul>" + model.care.not_covered.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div></div>");
    out.push('<p class="small muted">' + esc(q.careTier.label) + " Care: " + q.careTier.allowance_hours + " hours of change allowance a year, " + esc(q.careTier.cadence.toLowerCase()) + ", critical response " + esc(q.careTier.critical_response) + ". " + esc(model.care.allowance_note) + " Coverage " + esc(model.care.coverage) + "</p></div>");

    out.push('<details class="terms"><summary>Commercial terms and what we need from you</summary><div class="cols" style="margin-top:12px"><div><h4>Terms</h4><ul>' +
      model.terms.map(function (t) { return "<li><b>" + esc(t.term) + ".</b> " + esc(t.position) + "</li>"; }).join("") + "</ul></div><div><h4>What we need from the client</h4><ul>" +
      model.client_needs.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div></div></details>");

    out.push('<div class="actions no-print">' +
      '<button type="button" class="btn btn-green" data-act="save"' + (state.dbState === "ready" ? "" : " disabled") + ">" + (state.savedId ? "Update in library" : "Save to library") + "</button>" +
      '<button type="button" class="btn btn-ghost" data-act="copy">Copy summary</button>' +
      '<button type="button" class="btn btn-ghost" data-act="print">Print</button>' +
      (state.toast ? '<span class="toast" role="status">' + esc(state.toast) + "</span>" :
        state.dbState === "none" ? '<span class="toast">The shared library is not available in this view. Copy or print instead.</span>' :
        state.dbState === "connecting" ? '<span class="toast">Connecting to the library…</span>' : "") + "</div>");
    out.push(navFooter(state.step) + "</section>");
    return out.join("");
  }

  function renderSide() {
    var inp = state.inputs;
    var st = MQ.scoreTier(model, inp.scores, inp.linked);
    var q = currentQuote();
    var out = ['<aside class="mq-side"><div class="panel"><span class="eyebrow">Running quote</span>'];
    out.push('<div class="score-track" aria-label="Scorecard progress">' + model.scorecard.factors.map(function (f) {
      var p = inp.scores[f.key]; return '<span class="' + (p ? "p" + p : "") + '" title="' + esc(f.label) + (p ? ": " + p : "") + '"></span>';
    }).join("") + "</div>");
    if (q.ready) {
      var from = q.indicative ? "from " : "";
      out.push('<div class="big num">' + from + money(q.contract) + "<small>over " + (q.years === 1 ? "12 months" : q.years + " years") + ", ex GST</small></div>");
      out.push("<dl><dt>Scorecard</dt><dd class=\"num\">" + st.total + " · " + esc(st.tier.label) + "</dd>" +
        "<dt>Year 1</dt><dd class=\"num\">" + from + money(q.year1) + "</dd>" +
        (q.schedule[1] ? "<dt>Year 2</dt><dd class=\"num\">" + from + money(q.schedule[1].total) + "</dd>" : "") +
        (q.schedule[2] ? "<dt>Year 3</dt><dd class=\"num\">" + from + money(q.schedule[2].total) + "</dd>" : "") +
        "<dt>Care</dt><dd>" + esc(q.careTier.label) + "</dd></dl>");
      out.push('<p class="note">Care +' + q.cpiPercent + "% each anniversary. Year 1 rates, AUD ex GST.</p>");
    } else {
      out.push('<div class="big num">' + (st.scored ? st.total : "—") + "<small>" + st.scored + " of 8 factors scored</small></div>");
      out.push('<p class="note">The tier appears once all eight factors are scored. Simple is 8 to 11, Moderate 12 to 16, Complex 17 to 24.</p>');
    }
    out.push("</div>");
    if (inp.engagement.client || inp.engagement.workflow) {
      out.push('<div class="who">' + esc(inp.engagement.client) + (inp.engagement.workflow ? " · " + esc(inp.engagement.workflow) : "") + (state.savedId ? ' <span class="chip green">Saved</span>' : "") + "</div>");
    }
    out.push("</aside>");
    return out.join("");
  }

  function renderLibrary() {
    var out = ['<div class="mq-lib"><header><span class="eyebrow">Shared library</span><h2>Saved quotes</h2>',
      '<p class="muted" style="max-width:65ch">Every quote saved from this tool, by anyone who opens it. Open one to reload its answers; the quote is re-priced against the current model.</p></header>'];
    if (state.dbState === "none") out.push('<div class="empty">The shared library is not available in this view. Quotes can still be copied or printed.</div>');
    else if (!state.quotesLoaded) out.push('<div class="empty">Loading…</div>');
    else if (!state.quotes.length) out.push('<div class="empty">Nothing saved yet. Finish a quote and choose Save to library.</div>');
    else {
      out.push('<div class="tbl-wrap"><table><thead><tr><th>Client</th><th>Workflow</th><th>Tier</th><th>Care</th><th>Term</th><th class="num">Total</th><th>Saved</th><th></th></tr></thead><tbody>');
      state.quotes.forEach(function (d) {
        var s = d.summary || {};
        out.push("<tr><td>" + esc(s.client) + "</td><td>" + esc(s.workflow) + '</td><td><span class="chip">' + esc(s.tier) + " · " + esc(s.score) + "</span></td><td>" + esc(s.careTier) + "</td><td>" + (s.years === 1 ? "12 months" : s.years + " years") + '</td><td class="num">' + (s.indicative ? "from " : "") + money(s.total || 0) + '</td><td class="small muted">' + esc(friendlyDate(String(d.savedAt || "").slice(0, 10))) + (s.preparedBy ? "<br>" + esc(s.preparedBy) : "") + "</td>" +
          '<td class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="open" data-id="' + esc(d.id) + '">Open</button><button type="button" class="btn btn-ghost btn-sm" data-act="delete" data-id="' + esc(d.id) + '">Delete</button></td></tr>');
      });
      out.push("</tbody></table></div>");
    }
    out.push("</div>");
    return out.join("");
  }

  // ---------------------------------------------------------------------
  // events
  // ---------------------------------------------------------------------

  function update(fn) { fn(); state.toast = ""; saveDraft(); render(); }

  function onClick(ev) {
    var el = ev.target.closest("[data-act]");
    if (!el) return;
    var act = el.getAttribute("data-act");
    if (act === "go") return update(function () { state.step = parseInt(el.getAttribute("data-step"), 10); state.view = "wizard"; window.scrollTo(0, 0); });
    if (act === "view") return update(function () { state.view = el.getAttribute("data-view"); window.scrollTo(0, 0); });
    if (act === "new") return update(function () { state.inputs = blankInputs(); state.step = 0; state.savedId = null; state.view = "wizard"; window.scrollTo(0, 0); });
    if (act === "check") return update(function () { state.inputs.engagement.checks[el.getAttribute("data-key")] = el.getAttribute("data-val"); delete state.inputs.example; });
    if (act === "score") return update(function () {
      state.inputs.scores[el.getAttribute("data-key")] = parseInt(el.getAttribute("data-pts"), 10); delete state.inputs.example;
      if (state.step < STEPS.length - 1 && STEPS[state.step].key === "factor") { state.step += 1; window.scrollTo(0, 0); }
    });
    if (act === "care") return update(function () { state.inputs.careTier = el.getAttribute("data-key"); if (state.inputs.careTier !== model.care.extended_coverage.tier) state.inputs.extendedCoverage = false; });
    if (act === "years") return update(function () { state.inputs.years = parseInt(el.getAttribute("data-years"), 10); });
    if (act === "repeat") return update(function () { state.inputs.repeat = el.getAttribute("data-key"); });
    if (act === "extra-add") return update(function () { state.inputs.extras.push({ label: "", amount: "", kind: "oneoff", indexed: false }); });
    if (act === "extra-del") return update(function () { state.inputs.extras.splice(parseInt(el.getAttribute("data-i"), 10), 1); });
    if (act === "extra-kind") return update(function () { var x = state.inputs.extras[parseInt(el.getAttribute("data-i"), 10)]; x.kind = el.getAttribute("data-kind"); if (x.kind !== "annual") x.indexed = false; });
    if (act === "copy") return copySummary();
    if (act === "print") { window.print(); return; }
    if (act === "save") return saveQuote();
    if (act === "open") return openQuote(el.getAttribute("data-id"));
    if (act === "delete") return deleteQuote(el.getAttribute("data-id"));
  }

  function onChange(ev) {
    var el = ev.target.closest("[data-act]");
    if (!el) return;
    var act = el.getAttribute("data-act");
    if (act === "eng") return update(function () { state.inputs.engagement[el.getAttribute("data-key")] = el.value; delete state.inputs.example; });
    if (act === "linked") return update(function () { state.inputs.linked = el.checked; });
    if (act === "extended") return update(function () { state.inputs.extendedCoverage = el.checked; });
    if (act === "extra") return update(function () {
      var x = state.inputs.extras[parseInt(el.getAttribute("data-i"), 10)], k = el.getAttribute("data-key");
      x[k] = k === "amount" ? (el.value === "" ? "" : Number(el.value)) : el.value;
    });
    if (act === "extra-indexed") return update(function () { state.inputs.extras[parseInt(el.getAttribute("data-i"), 10)].indexed = el.checked; });
  }

  function onInput(ev) {
    // Keep the engagement fields live in state without re-rendering on every keystroke.
    var el = ev.target.closest('[data-act="eng"]');
    if (el) { state.inputs.engagement[el.getAttribute("data-key")] = el.value; saveDraft(); }
  }

  function copySummary() {
    var q = currentQuote();
    if (!q.ready) return;
    var text = MQ.summaryText(model, q, state.inputs);
    var done = function () { state.toast = "Summary copied."; render(); };
    var fail = function () { state.toast = "Could not copy. Select the quote and copy it by hand."; render(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
    else {
      try {
        var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta); done();
      } catch (e) { fail(); }
    }
  }

  // ---------------------------------------------------------------------
  // the shared library
  // ---------------------------------------------------------------------

  function connectDb() {
    var p = null;
    try { if (root.claude && typeof root.claude.use === "function") p = root.claude.use("db"); } catch (e) { p = null; }
    if (!p) { state.dbState = "none"; render(); return; }
    p.then(function (db) {
      if (!db) { state.dbState = "none"; render(); return; }
      state.db = db; state.dbState = "ready";
      try {
        db.collection("quotes").orderBy("savedAt", "desc").limit(500).onSnapshot(function (snap) {
          state.quotes = snap.docs.filter(function (d) { return d.exists; }).map(function (d) { return Object.assign({ id: d.id }, d.data()); });
          state.quotesLoaded = true; render();
        }, function (err) { state.dbState = "none"; state.toast = "The library stopped responding (" + (err && err.code ? err.code : "unavailable") + ")."; render(); });
      } catch (e) { state.dbState = "none"; render(); }
      render();
    }, function () { state.dbState = "none"; render(); });
  }

  function summaryFor(q) {
    var e = state.inputs.engagement;
    return { client: e.client, workflow: e.workflow, preparedBy: e.preparedBy, date: e.date,
             tier: q.tier.label, score: q.score.total, careTier: q.careTier.label, years: q.years,
             total: q.contract, year1: q.year1, recurring: q.recurring, indicative: q.indicative };
  }

  function saveQuote() {
    var q = currentQuote();
    if (!q.ready || !state.db) return;
    var inputs = JSON.parse(JSON.stringify(state.inputs)); delete inputs.example;
    var body = { inputs: inputs, summary: summaryFor(q), modelVersion: model.version, savedAt: new Date().toISOString() };
    var ref = state.savedId ? state.db.doc("quotes/" + state.savedId) : state.db.collection("quotes").doc();
    ref.set(body).then(function () {
      state.savedId = ref.id; state.toast = state.savedId ? "Saved to the library." : "Saved."; saveDraft(); render();
    }, function (err) {
      state.toast = err && err.code === "quota_exceeded" ? "The library is full. Delete an old quote and try again." : "Could not save (" + (err && err.code ? err.code : "unavailable") + "). Try once more.";
      render();
    });
  }

  function openQuote(id) {
    var d = null;
    state.quotes.forEach(function (x) { if (x.id === id) d = x; });
    if (!d || !d.inputs) return;
    update(function () {
      var inp = blankInputs();
      state.inputs = Object.assign(inp, d.inputs, { engagement: Object.assign(inp.engagement, d.inputs.engagement || {}) });
      state.savedId = id; state.step = STEPS.length - 1; state.view = "wizard"; window.scrollTo(0, 0);
    });
  }

  function deleteQuote(id) {
    if (!state.db) return;
    var d = null; state.quotes.forEach(function (x) { if (x.id === id) d = x; });
    var name = d && d.summary ? (d.summary.client + (d.summary.workflow ? " · " + d.summary.workflow : "")) : "this quote";
    if (!window.confirm("Delete " + name + " from the shared library? Everyone loses it.")) return;
    state.db.doc("quotes/" + id).delete().then(function () {
      if (state.savedId === id) state.savedId = null;
      state.toast = "Deleted."; saveDraft(); render();
    }, function () { state.toast = "Could not delete. Try once more."; render(); });
  }

  // ---------------------------------------------------------------------

  function start() {
    loadDraft();
    var app = document.getElementById("app");
    app.addEventListener("click", onClick);
    app.addEventListener("change", onChange);
    app.addEventListener("input", onInput);
    window.addEventListener("beforeprint", function () {
      var t = document.querySelector(".mq details.terms"); if (t) t.open = true;
    });
    render();
    connectDb();
  }

  root.MQAPP = { start: start, STEPS: STEPS, state: state };
})(typeof globalThis !== "undefined" ? globalThis : this);
