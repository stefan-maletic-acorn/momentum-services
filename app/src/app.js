/* The Momentum quoting tool: a step-by-step pre-scope that ends in a quote.
 *
 * The engagement, one scorecard step per workflow, the tiers, Care and
 * commercials, and the quote. Everything is rendered from one state object;
 * every change re-renders. Saved quotes live in the artifact's database (the
 * `db` capability) when it is there, and the working draft is mirrored to
 * localStorage so a refresh does not lose a call's worth of answers.
 * Customer strings reach the DOM only through esc().
 */
(function (root) {
  "use strict";
  var MQ = root.MQ;
  var model = JSON.parse(document.getElementById("model-json").textContent);
  var DRAFT_KEY = "mq-draft-v2";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) { return MQ.money(model, v); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function uid() { return "w" + Math.random().toString(36).slice(2, 8); }
  function friendlyDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  }
  function wfName(w, i) { return (w && w.name) || ("Workflow " + (i + 1)); }

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------

  function blankInputs() {
    return {
      engagement: { client: "", preparedBy: "", date: today(), existingWorkflows: 0 },
      workflows: [{ id: uid(), name: "", scores: {} }],
      careTier: "standard", extendedCoverage: false, years: 1, extras: [],
    };
  }

  function exampleInputs() {
    var exs = model.worked_examples.filter(function (e) { return e.scores; });
    var inp = blankInputs();
    inp.engagement.client = "Example client";
    inp.workflows = exs.map(function (ex) { return { id: uid(), name: ex.name.split(",")[0], scores: Object.assign({}, ex.scores) }; });
    inp.careTier = "standard";
    inp.years = 3;
    inp.example = true;
    return inp;
  }

  /** Bring an older draft or saved quote up to the current shape. */
  function migrate(inp) {
    var out = blankInputs();
    if (!inp || typeof inp !== "object") return out;
    out.engagement = Object.assign(out.engagement, inp.engagement || {});
    delete out.engagement.checks;
    if (Array.isArray(inp.workflows) && inp.workflows.length) {
      out.workflows = inp.workflows.map(function (w, i) { return { id: w.id || uid(), name: w.name || "", scores: Object.assign({}, w.scores || {}) }; });
    } else if (inp.scores) {
      out.workflows = [{ id: uid(), name: (inp.engagement && inp.engagement.workflow) || "", scores: Object.assign({}, inp.scores) }];
    }
    delete out.engagement.workflow;
    ["careTier", "extendedCoverage", "years", "example"].forEach(function (k) { if (k in inp) out[k] = inp[k]; });
    out.extras = Array.isArray(inp.extras) ? inp.extras.map(function (x) { return Object.assign({}, x); }) : [];
    return out;
  }

  var state = {
    view: "wizard", step: 0, inputs: null,
    db: null, dbState: "connecting", quotes: [], quotesLoaded: false, savedId: null, toast: "",
  };

  function loadDraft() {
    try {
      var raw = root.localStorage.getItem(DRAFT_KEY) || root.localStorage.getItem("mq-draft-v1");
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.inputs) { state.inputs = migrate(d.inputs); state.step = d.step || 0; state.savedId = d.savedId || null; return; }
      }
    } catch (e) { /* storage may be unavailable */ }
    state.inputs = exampleInputs();
  }
  function saveDraft() {
    try { root.localStorage.setItem(DRAFT_KEY, JSON.stringify({ inputs: state.inputs, step: state.step, savedId: state.savedId })); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------
  // steps
  // ---------------------------------------------------------------------

  function steps() {
    var out = [{ key: "engagement", label: "The engagement", group: "Pre-scope" }];
    state.inputs.workflows.forEach(function (w, i) {
      out.push({ key: "scorecard", wf: i, label: wfName(w, i), group: i === 0 ? "Scorecards" : null });
    });
    out.push({ key: "tier", label: "Tiers", group: "Result" });
    out.push({ key: "care", label: "Care and commercials", group: null });
    out.push({ key: "quote", label: "Quote", group: null });
    return out;
  }

  function stepDone(s) {
    var inp = state.inputs;
    if (s.key === "engagement") return !!inp.engagement.client && inp.workflows.every(function (w) { return !!w.name; });
    if (s.key === "scorecard") return MQ.scoreTier(model, inp.workflows[s.wf].scores).complete;
    if (s.key === "tier") return inp.workflows.every(function (w) { return MQ.scoreTier(model, w.scores).complete; });
    if (s.key === "care") return !!inp.careTier;
    return false;
  }

  function currentQuote() { return MQ.quote(model, state.inputs); }
  function clampStep() { var n = steps().length; if (state.step > n - 1) state.step = n - 1; if (state.step < 0) state.step = 0; }
  function stepIndex(key, wf) {
    var ss = steps();
    for (var i = 0; i < ss.length; i++) if (ss[i].key === key && (wf === undefined || ss[i].wf === wf)) return i;
    return 0;
  }

  // ---------------------------------------------------------------------
  // rendering
  // ---------------------------------------------------------------------

  function render() {
    clampStep();
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
    var ss = steps();
    var out = ['<nav class="mq-rail" aria-label="Steps"><ol>'];
    ss.forEach(function (s, i) {
      if (s.group) out.push('<li class="group eyebrow">' + esc(s.group) + "</li>");
      var done = stepDone(s), cur = i === state.step, chip = "";
      if (s.key === "scorecard") {
        var st = MQ.scoreTier(model, state.inputs.workflows[s.wf].scores);
        if (st.scored) chip = st.complete ? st.total + " · " + st.tier.label : st.scored + " of 8";
      }
      out.push('<li><button type="button" class="rail-step' + (done ? " done" : "") + '" data-act="go" data-step="' + i + '"' + (cur ? ' aria-current="step"' : "") + ">" +
        '<span class="dot">' + (s.key === "scorecard" ? (s.wf + 1) : (done ? "✓" : "")) + "</span>" +
        '<span class="body"><span class="label">' + esc(s.label) + "</span>" +
        (chip ? '<span class="pts">' + esc(chip) + "</span>" : "") + "</span></button></li>");
    });
    out.push("</ol></nav>");
    return out.join("");
  }

  function navFooter(i) {
    var ss = steps(), prev = i > 0, next = i < ss.length - 1;
    var nextLabel = ss[i + 1] ? (ss[i + 1].key === "scorecard" ? "Next: score " + ss[i + 1].label : "Next: " + ss[i + 1].label) : "";
    return "<footer>" +
      (prev ? '<button type="button" class="btn btn-ghost" data-act="go" data-step="' + (i - 1) + '">Back</button>' : "<span></span>") +
      (next ? '<button type="button" class="btn btn-purple" data-act="go" data-step="' + (i + 1) + '">' + esc(nextLabel) + "</button>" : "") +
      "</footer>";
  }

  function stepEyebrow(i, tail) { return '<span class="eyebrow">Step ' + (i + 1) + " of " + steps().length + " · " + tail + "</span>"; }

  function renderStep() {
    var s = steps()[state.step];
    if (s.key === "engagement") return renderEngagement();
    if (s.key === "scorecard") return renderScorecard(s.wf);
    if (s.key === "tier") return renderTier();
    if (s.key === "care") return renderCare();
    return renderQuote();
  }

  function field(key, label, value, type, placeholder, extra) {
    return '<div class="field"><label for="f-' + key + '">' + esc(label) + '</label><input id="f-' + key + '" type="' + type + '" data-act="eng" data-key="' + key + '" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '"' + (extra || "") + "></div>";
  }

  function renderEngagement() {
    var e = state.inputs.engagement, wfs = state.inputs.workflows;
    var out = ['<section class="mq-card"><header>' + stepEyebrow(state.step, "Pre-scope") + "<h2>The engagement</h2>",
      '<p class="lede">' + esc(model.pre_scope.text) + "</p></header>"];
    if (state.inputs.example) {
      out.push('<div class="rule info"><div>These are the two engagements from the commercial model, loaded as one quote so you can see the tool at rest. ' +
        '<button type="button" class="btn-text" data-act="new">Start a blank quote</button> when you are on a call.</div></div>');
    }
    out.push('<div class="sec"><div class="fields">' +
      field("client", "Client", e.client, "text", "Organisation name") +
      field("preparedBy", "Prepared by", e.preparedBy, "text", "Your name") +
      field("date", "Date", e.date, "date", "") + "</div></div>");

    out.push('<div class="sec"><h3>Workflows in this quote</h3><p class="why">One line per Momentum workflow. Each gets its own scorecard and tier; Care is priced per workflow and the repeat-workflow discount applies by order.</p>');
    out.push('<div class="wf-list">');
    wfs.forEach(function (w, i) {
      out.push('<div class="wf-row"><span class="dot">' + (i + 1) + '</span>' +
        '<input type="text" aria-label="Workflow ' + (i + 1) + ' name" data-act="wf-name" data-i="' + i + '" value="' + esc(w.name) + '" placeholder="The process, in the client\'s words">' +
        '<span class="chip">' + esc(MQ.discountPercent(model, (parseInt(e.existingWorkflows, 10) || 0) + i) ? MQ.discountPercent(model, (parseInt(e.existingWorkflows, 10) || 0) + i) + "% off" : "Full price") + "</span>" +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="wf-del" data-i="' + i + '"' + (wfs.length === 1 ? " disabled" : "") + ">Remove</button></div>");
    });
    out.push('</div><div><button type="button" class="btn btn-ghost btn-sm" data-act="wf-add">Add a workflow</button></div></div>');

    out.push('<div class="sec"><h3>Repeat-workflow discount</h3><p class="why">' + esc(model.discounts.repeat_workflow.text) + " Workflows the client already has with Acorn count towards the order.</p>" +
      '<div class="fields"><div class="field"><label for="f-existingWorkflows">Workflows the client already has with Acorn</label>' +
      '<input id="f-existingWorkflows" type="number" min="0" step="1" data-act="eng" data-key="existingWorkflows" value="' + esc(e.existingWorkflows || 0) + '"></div></div></div>');
    out.push(navFooter(state.step) + "</section>");
    return out.join("");
  }

  function renderScorecard(wfIndex) {
    var w = state.inputs.workflows[wfIndex];
    var st = MQ.scoreTier(model, w.scores);
    var out = ['<section class="mq-card"><header>' + stepEyebrow(state.step, "Scorecard " + (wfIndex + 1) + " of " + state.inputs.workflows.length) +
      "<h2>" + esc(wfName(w, wfIndex)) + "</h2>",
      '<p class="lede">Eight factors, each scoring 1, 2 or 3. The total sets the tier: Simple 8 to 11, Moderate 12 to 16, Complex 17 to 24.</p></header>'];
    out.push('<div class="rule"><div><b>Score conservatively.</b> Where the answer is unclear, pick the higher score. Discovery re-scores with full information and only the difference between tiers is billed or credited.</div></div>');
    out.push('<div class="factors">');
    model.scorecard.factors.forEach(function (f, i) {
      var chosen = w.scores[f.key];
      out.push('<section class="factor-block' + (chosen ? " scored" : "") + '" id="factor-' + f.key + '">' +
        '<div class="fb-head"><span class="fb-num">' + (i + 1) + '</span><h3>' + esc(f.label) + "</h3>" +
        (chosen ? '<span class="pts">' + chosen + (chosen === 1 ? " point" : " points") + "</span>" : '<span class="pts todo">Not scored</span>') + "</div>" +
        '<p class="fb-ask">' + esc(f.ask) + "</p>" +
        '<div class="options' + (f.options.length === 2 ? " two" : "") + '" role="group" aria-label="' + esc(f.label) + ' score">');
      f.options.forEach(function (o) {
        out.push('<button type="button" class="pick opt" data-act="score" data-wf="' + wfIndex + '" data-key="' + f.key + '" data-pts="' + o.points + '"' + (chosen === o.points ? ' aria-pressed="true"' : "") + ">" +
          '<span class="pts">' + o.points + (o.points === 1 ? " point" : " points") + "</span>" +
          '<span class="txt">' + esc(o.label) + "</span>" +
          (o.points === 3 && f.key === model.scorecard.floor_rule.factor ? '<span class="hint">Floor rule: Moderate or above.</span>' : "") +
          "</button>");
      });
      out.push('</div><p class="why">' + esc(f.why) + "</p></section>");
    });
    out.push("</div>");
    out.push('<div class="score-line num">' + (st.complete ? "<b>Scorecard " + st.total + " · " + esc(st.tier.label) + ".</b> Discovery " + money(model.prices[st.tierKey].discovery) + " and Build " + money(model.prices[st.tierKey].build) + " before any discount."
      : "<b>" + st.scored + " of 8 factors scored" + (st.scored ? ", running total " + st.total : "") + ".</b> The tier appears when all eight are scored.") + "</div>");
    out.push(navFooter(state.step) + "</section>");
    return out.join("");
  }

  function renderTier() {
    var inp = state.inputs;
    var q = currentQuote();
    var out = ['<section class="mq-card"><header>' + stepEyebrow(state.step, "Result") + "<h2>Provisional tiers</h2>",
      '<p class="lede">Price is set by workflow complexity, not account size. Each workflow\'s scorecard total places it in a tier; the tier sets its Discovery and Build price.</p></header>'];
    inp.workflows.forEach(function (w, i) {
      var st = MQ.scoreTier(model, w.scores);
      out.push('<div class="sec wf-result">');
      if (!st.complete) {
        var missing = model.scorecard.factors.filter(function (f) { return !w.scores[f.key]; });
        out.push('<div class="tier-hero"><div class="score num">' + (st.scored ? st.total : "—") + "<small>" + st.scored + " of 8</small></div><div>" +
          '<div class="eyebrow">' + esc(wfName(w, i)) + '</div><div class="name">Not yet scored</div><p class="small">' + missing.length + " factor" + (missing.length === 1 ? "" : "s") + " to go: " + esc(missing.map(function (f) { return f.label; }).join(", ")) + ".</p>" +
          '<p><button type="button" class="btn btn-purple btn-sm" data-act="go" data-step="' + stepIndex("scorecard", i) + '">Score ' + esc(wfName(w, i)) + "</button></p></div></div></div>");
        return;
      }
      var p = model.prices[st.tierKey];
      var qw = q.ready ? q.workflows[i] : null;
      out.push('<div class="tier-hero"><div class="score num">' + st.total + "<small>of 24</small></div><div>" +
        '<div class="eyebrow">' + esc(wfName(w, i)) + '</div><div class="name">' + esc(st.tier.label) + "</div>" +
        '<p class="small">Discovery ' + money(p.discovery) + " and Build " + money(p.build) + (qw && qw.discountPercent ? ", less " + qw.discountPercent + "% as workflow " + (q.existing + i + 1) + " with Acorn" : "") + ". " + esc(MQ.durationText(model, st.tierKey)) + " of build, then five business days of UAT, ten of hypercare and thirty of warranty.</p></div></div>");
      st.rules.forEach(function (r) { out.push('<div class="rule"><div><b>Rule applied.</b> ' + esc(r.text) + "</div></div>"); });
      out.push('<ul class="factor-list">');
      model.scorecard.factors.forEach(function (f) {
        var pts = w.scores[f.key], lbl = "";
        f.options.forEach(function (o) { if (o.points === pts) lbl = o.label; });
        out.push('<li><span><span class="f">' + esc(f.label) + '</span><span class="o">' + esc(lbl) + "</span></span>" + '<span class="pts' + (pts === 3 ? " three" : "") + '">' + pts + "</span></li>");
      });
      out.push("</ul>");
      var lowering = MQ.whatWouldLower(model, w.scores);
      if (lowering.length) {
        out.push('<h4>What simplifying would save</h4><ul class="lower">');
        lowering.forEach(function (l) {
          out.push("<li><span>" + esc(l.factor) + " at " + esc(l.toLabel) + " would make it <b>" + esc(l.tier) + "</b></span><b class=\"num\">saves " + money(l.saving) + "</b></li>");
        });
        out.push("</ul>");
      } else if (st.tierKey === "simple") {
        out.push('<div class="rule good"><div>Already the minimum engagement: one Simple workflow.</div></div>');
      }
      out.push("</div>");
    });
    out.push('<div class="sec"><h3>The published tiers</h3><div class="tbl-wrap"><table><thead><tr><th>Tier</th><th>Score</th><th class="num">Discovery</th><th class="num">Build</th><th class="num">Care (Standard)</th><th class="num">Year 1 total</th><th>Build time</th></tr></thead><tbody>');
    model.scorecard.tiers.forEach(function (t) {
      var pr = model.prices[t.key], care = model.care.table[t.key].standard;
      var here = inp.workflows.some(function (w) { return MQ.scoreTier(model, w.scores).tierKey === t.key; });
      out.push("<tr" + (here ? ' class="current"' : "") + "><td>" + esc(t.label) + "</td><td>" + t.min + " to " + t.max + '</td><td class="num">' + money(pr.discovery) + '</td><td class="num">' + money(pr.build) + '</td><td class="num">' + money(care) + '</td><td class="num">' + money(pr.discovery + pr.build + care) + "</td><td>" + esc(model.build.duration[t.key]) + "</td></tr>");
    });
    out.push("</tbody></table></div></div>");
    out.push(navFooter(state.step) + "</section>");
    return out.join("");
  }

  function renderCare() {
    var inp = state.inputs;
    var tiers = inp.workflows.map(function (w) { return MQ.scoreTier(model, w.scores); });
    var complete = tiers.every(function (t) { return t.complete; });
    var out = ['<section class="mq-card"><header>' + stepEyebrow(state.step, "Commercials") + "<h2>Care and commercials</h2>",
      '<p class="lede">' + esc(model.care.text) + "</p></header>"];
    if (!complete) out.push('<div class="rule"><div>Score every workflow first. Care is priced from each workflow\'s tier, so the fees below appear once all tiers are known.</div></div>');
    out.push('<div class="sec"><h3>Care tier</h3><p class="why">One Care tier for the whole quote. Each workflow\'s fee is priced from its own tier.</p><div class="care-grid">');
    model.care.tiers.forEach(function (ct) {
      var total = 0, parts = [];
      if (complete) tiers.forEach(function (t, i) { var f = model.care.table[t.tierKey][ct.key]; total += f; parts.push(esc(wfName(inp.workflows[i], i)) + " " + money(f)); });
      out.push('<button type="button" class="pick care" data-act="care" data-key="' + ct.key + '"' + (inp.careTier === ct.key ? ' aria-pressed="true"' : "") + ">" +
        '<span class="name">' + esc(ct.label) + "</span>" +
        '<span class="fee num">' + (complete ? money(total) : "—") + '</span><span class="basis">a year · ' + ct.percent_of_build + "% of build, min " + money(ct.minimum) + " per workflow</span>" +
        (complete && parts.length > 1 ? '<span class="breakdown">' + parts.join(" · ") + "</span>" : "") +
        '<span class="stats">' +
        '<span class="stat"><span class="k">Allowance</span><span class="v">' + ct.allowance_hours + " hrs a year per workflow</span></span>" +
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

    var existing = parseInt(inp.engagement.existingWorkflows, 10) || 0;
    out.push('<div class="sec"><h3>Repeat-workflow discount</h3><p class="why">' + esc(model.discounts.repeat_workflow.text) + "</p><ul class=\"discount-list\">");
    inp.workflows.forEach(function (w, i) {
      var pct = MQ.discountPercent(model, existing + i);
      out.push("<li><span>" + esc(wfName(w, i)) + ' <span class="muted">· workflow ' + (existing + i + 1) + " with Acorn</span></span><b>" + (pct ? pct + "% off Discovery and Build" : "Full price") + "</b></li>");
    });
    out.push("</ul>" + (existing ? "" : '<p class="small muted">Set how many workflows the client already has on the engagement step to shift these along.</p>') + "</div>");

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
    var out = ['<section class="mq-card" id="quote-sheet"><header><span class="eyebrow no-print">Step ' + steps().length + " of " + steps().length + " · Quote</span>"];
    if (!q.ready) {
      out.push('<h2>Quote</h2><p class="lede">Score every workflow to produce a quote.</p></header>' +
        '<button type="button" class="btn btn-purple" data-act="go" data-step="' + stepIndex("tier") + '">Go to the tiers</button>' + navFooter(state.step) + "</section>");
      return out.join("");
    }
    var termLabel = q.years === 1 ? "12 months" : q.years + " years";
    var multi = q.workflows.length > 1;
    out.push('<div class="quote-head"><div><h2>' + esc(model.service.name) + "</h2>" +
      '<p class="lede">' + esc(e.client || "Client") + " · " + q.workflows.length + (multi ? " workflows" : " workflow") + "</p></div>" +
      '<dl class="meta"><dt>Prepared by</dt><dd>' + esc(e.preparedBy || "—") + "</dd><dt>Date</dt><dd>" + esc(friendlyDate(e.date)) + "</dd><dt>Care</dt><dd>" + esc(q.careTier.label) + (q.careExtended ? ", extended coverage" : "") + "</dd><dt>Term</dt><dd>" + termLabel + "</dd></dl></div></header>");

    out.push('<div class="totals">' +
      '<div class="tile lead"><span class="k">Total over ' + termLabel + '</span><span class="v num">' + money(q.contract) + "</span><span class=\"small\">" + esc(model.tax_note) + "</span></div>" +
      '<div class="tile"><span class="k">Year 1</span><span class="v num">' + money(q.year1) + '</span><span class="small muted">Discovery, Build and first year of Care</span></div>' +
      '<div class="tile"><span class="k">Recurring from year 2</span><span class="v num">' + money(q.schedule[1] ? q.schedule[1].total : MQ.rnd(q.recurring * (1 + q.cpiPercent / 100))) + '</span><span class="small muted">Care, +' + q.cpiPercent + "% each anniversary</span></div></div>");

    out.push('<div class="sec"><h3>What is included</h3><div class="tbl-wrap"><table class="lines"><thead><tr><th>Line</th><th class="num">Year 1 rate</th>' + (q.anyDiscount ? '<th class="num">Discount</th>' : "") + '<th class="num">Amount</th></tr></thead><tbody>');
    q.workflows.forEach(function (w) {
      out.push('<tr class="group"><td colspan="' + (q.anyDiscount ? 4 : 3) + '"><b>' + esc(w.name) + "</b> · " + esc(w.tier.label) + ", scorecard " + w.score.total + (w.discountPercent ? " · " + w.discountPercent + "% repeat-workflow discount" : "") + "</td></tr>");
      q.lines.filter(function (l) { return l.wf === w.index; }).forEach(function (l) {
        out.push("<tr><td>" + esc(l.label) + '<span class="detail">' + esc(l.detail) + '</span></td><td class="num">' + money(l.amount) + (l.recurs ? " / yr" : "") + "</td>" +
          (q.anyDiscount ? '<td class="num">' + (l.discount ? "-" + money(l.discount) : "—") + "</td>" : "") +
          '<td class="num">' + money(l.net) + (l.recurs ? " / yr" : "") + "</td></tr>");
      });
    });
    var other = q.lines.filter(function (l) { return l.wf === undefined; });
    if (other.length) {
      out.push('<tr class="group"><td colspan="' + (q.anyDiscount ? 4 : 3) + '"><b>Across the quote</b></td></tr>');
      other.forEach(function (l) {
        out.push("<tr><td>" + esc(l.label) + '<span class="detail">' + esc(l.detail) + '</span></td><td class="num">' + money(l.amount) + (l.recurs ? " / yr" : "") + "</td>" + (q.anyDiscount ? "<td></td>" : "") + '<td class="num">' + money(l.net) + (l.recurs ? " / yr" : "") + "</td></tr>");
      });
    }
    out.push('<tr class="total"><td>Year 1</td><td></td>' + (q.anyDiscount ? "<td></td>" : "") + '<td class="num">' + money(q.year1) + "</td></tr></tbody></table></div></div>");

    var hasExtras = q.schedule.some(function (s) { return s.extras; });
    out.push('<div class="sec"><h3>Year by year</h3><div class="tbl-wrap"><table><thead><tr><th>Year</th><th class="num">One-off</th><th class="num">Care</th>' + (hasExtras ? '<th class="num">Other annual</th>' : "") + '<th class="num">Total</th></tr></thead><tbody>');
    q.schedule.forEach(function (s) {
      out.push("<tr><td>Year " + s.year + (s.year > 1 ? ' <span class="detail">Care +' + q.cpiPercent + "% on year " + (s.year - 1) + "</span>" : "") + '</td><td class="num">' + (s.oneOff ? money(s.oneOff) : "—") + '</td><td class="num">' + money(s.care) + "</td>" +
        (hasExtras ? '<td class="num">' + (s.extras ? money(s.extras) : "—") + "</td>" : "") + '<td class="num">' + money(s.total) + "</td></tr>");
    });
    out.push('<tr class="total"><td>Total over ' + termLabel + "</td><td></td><td></td>" + (hasExtras ? "<td></td>" : "") + '<td class="num">' + money(q.contract) + "</td></tr></tbody></table></div></div>");

    out.push('<div class="sec"><h3>Payment schedule</h3><div class="tbl-wrap"><table><thead><tr><th>When</th><th>What</th><th class="num">Amount</th></tr></thead><tbody>');
    q.milestones.forEach(function (m) { out.push("<tr><td>" + esc(m.when) + "</td><td>" + esc(m.what) + '</td><td class="num">' + money(m.amount) + "</td></tr>"); });
    out.push("</tbody></table></div></div>");

    var durations = q.workflows.map(function (w) { return w.duration; }).filter(function (d, i, a) { return a.indexOf(d) === i; });
    out.push('<div class="sec"><h3>How it runs</h3><p class="why">Per workflow. Workflows in one quote are scheduled together where the release calendar allows.</p><div class="tbl-wrap"><table><thead><tr><th>Stage</th><th>Duration</th><th>What happens</th><th>Client time</th></tr></thead><tbody>');
    out.push("<tr><td>Discovery</td><td>A week or two</td><td>" + esc(model.discovery.text) + "</td><td>Two 60-minute sessions</td></tr>");
    model.build.stages.forEach(function (s) {
      var dur = s.stage === "Build" ? (durations.length === 1 ? durations[0] : durations.join(" / ")) : s.duration;
      out.push("<tr><td>" + esc(s.stage) + "</td><td>" + esc(dur) + "</td><td>" + esc(s.text) + "</td><td>" + esc(s.client_time || "—") + "</td></tr>");
    });
    out.push("</tbody></table></div></div>");

    out.push('<div class="sec"><h3>Momentum Care</h3><div class="cols"><div><h4>Covered</h4><ul>' + model.care.covered.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div>" +
      "<div><h4>Not covered</h4><ul>" + model.care.not_covered.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div></div>");
    out.push('<p class="small muted">' + esc(q.careTier.label) + " Care: " + q.careTier.allowance_hours + " hours of change allowance a year per workflow, " + esc(q.careTier.cadence.toLowerCase()) + ", critical response " + esc(q.careTier.critical_response) + ". " + esc(model.care.allowance_note) + " Coverage " + esc(model.care.coverage) + "</p></div>");

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
    var q = currentQuote();
    var out = ['<aside class="mq-side"><div class="panel"><span class="eyebrow">Running quote</span>'];
    if (q.ready) {
      out.push('<div class="big num">' + money(q.contract) + "<small>over " + (q.years === 1 ? "12 months" : q.years + " years") + ", ex GST</small></div>");
      out.push("<dl>");
      q.workflows.forEach(function (w) { out.push("<dt>" + esc(w.name) + '</dt><dd class="num">' + w.score.total + " · " + esc(w.tier.label) + "</dd>"); });
      out.push('<dt>Year 1</dt><dd class="num">' + money(q.year1) + "</dd>" +
        (q.schedule[1] ? '<dt>Year 2</dt><dd class="num">' + money(q.schedule[1].total) + "</dd>" : "") +
        (q.schedule[2] ? '<dt>Year 3</dt><dd class="num">' + money(q.schedule[2].total) + "</dd>" : "") +
        "<dt>Care</dt><dd>" + esc(q.careTier.label) + "</dd></dl>");
      out.push('<p class="note">Care +' + q.cpiPercent + "% each anniversary. Year 1 rates, AUD ex GST.</p>");
    } else {
      var scoredWfs = inp.workflows.filter(function (w) { return MQ.scoreTier(model, w.scores).complete; }).length;
      out.push('<div class="big num">' + scoredWfs + " of " + inp.workflows.length + "<small>workflow" + (inp.workflows.length === 1 ? "" : "s") + " scored</small></div>");
      out.push("<dl>");
      inp.workflows.forEach(function (w, i) {
        var st = MQ.scoreTier(model, w.scores);
        out.push("<dt>" + esc(wfName(w, i)) + '</dt><dd class="num">' + (st.complete ? st.total + " · " + esc(st.tier.label) : st.scored + " of 8") + "</dd>");
      });
      out.push("</dl>");
      out.push('<p class="note">The quote appears once every workflow has all eight factors scored.</p>');
    }
    out.push("</div>");
    if (inp.engagement.client) {
      out.push('<div class="who">' + esc(inp.engagement.client) + (state.savedId ? ' <span class="chip green">Saved</span>' : "") + "</div>");
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
      out.push('<div class="tbl-wrap"><table><thead><tr><th>Client</th><th>Workflows</th><th>Care</th><th>Term</th><th class="num">Total</th><th>Saved</th><th></th></tr></thead><tbody>');
      state.quotes.forEach(function (d) {
        var s = d.summary || {};
        var wfs = Array.isArray(s.workflows) ? s.workflows : (s.workflow ? [{ name: s.workflow, tier: s.tier, score: s.score }] : []);
        out.push("<tr><td>" + esc(s.client) + "</td><td>" + wfs.map(function (w) { return esc(w.name) + ' <span class="chip">' + esc(w.tier) + " · " + esc(w.score) + "</span>"; }).join("<br>") + "</td><td>" + esc(s.careTier) + "</td><td>" + (s.years === 1 ? "12 months" : s.years + " years") + '</td><td class="num">' + money(s.total || 0) + '</td><td class="small muted">' + esc(friendlyDate(String(d.savedAt || "").slice(0, 10))) + (s.preparedBy ? "<br>" + esc(s.preparedBy) : "") + "</td>" +
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
  function idx(el, name) { return parseInt(el.getAttribute(name), 10); }

  function onClick(ev) {
    var el = ev.target.closest("[data-act]");
    if (!el) return;
    var act = el.getAttribute("data-act");
    if (act === "go") return update(function () { state.step = idx(el, "data-step"); state.view = "wizard"; window.scrollTo(0, 0); });
    if (act === "view") return update(function () { state.view = el.getAttribute("data-view"); window.scrollTo(0, 0); });
    if (act === "new") return update(function () { state.inputs = blankInputs(); state.step = 0; state.savedId = null; state.view = "wizard"; window.scrollTo(0, 0); });
    if (act === "score") return update(function () {
      state.inputs.workflows[idx(el, "data-wf")].scores[el.getAttribute("data-key")] = idx(el, "data-pts"); delete state.inputs.example;
    });
    if (act === "wf-add") return update(function () { state.inputs.workflows.push({ id: uid(), name: "", scores: {} }); delete state.inputs.example; });
    if (act === "wf-del") return update(function () { if (state.inputs.workflows.length > 1) state.inputs.workflows.splice(idx(el, "data-i"), 1); delete state.inputs.example; });
    if (act === "care") return update(function () { state.inputs.careTier = el.getAttribute("data-key"); if (state.inputs.careTier !== model.care.extended_coverage.tier) state.inputs.extendedCoverage = false; });
    if (act === "years") return update(function () { state.inputs.years = idx(el, "data-years"); });
    if (act === "extra-add") return update(function () { state.inputs.extras.push({ label: "", amount: "", kind: "oneoff", indexed: false }); });
    if (act === "extra-del") return update(function () { state.inputs.extras.splice(idx(el, "data-i"), 1); });
    if (act === "extra-kind") return update(function () { var x = state.inputs.extras[idx(el, "data-i")]; x.kind = el.getAttribute("data-kind"); if (x.kind !== "annual") x.indexed = false; });
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
    if (act === "eng") return update(function () {
      var k = el.getAttribute("data-key");
      state.inputs.engagement[k] = k === "existingWorkflows" ? Math.max(0, parseInt(el.value, 10) || 0) : el.value; delete state.inputs.example;
    });
    if (act === "wf-name") return update(function () { state.inputs.workflows[idx(el, "data-i")].name = el.value; delete state.inputs.example; });
    if (act === "extended") return update(function () { state.inputs.extendedCoverage = el.checked; });
    if (act === "extra") return update(function () {
      var x = state.inputs.extras[idx(el, "data-i")], k = el.getAttribute("data-key");
      x[k] = k === "amount" ? (el.value === "" ? "" : Number(el.value)) : el.value;
    });
    if (act === "extra-indexed") return update(function () { state.inputs.extras[idx(el, "data-i")].indexed = el.checked; });
  }

  function onInput(ev) {
    // Keep text fields live in state without re-rendering on every keystroke.
    var el = ev.target.closest('[data-act="eng"], [data-act="wf-name"]');
    if (!el) return;
    if (el.getAttribute("data-act") === "eng") state.inputs.engagement[el.getAttribute("data-key")] = el.value;
    else state.inputs.workflows[idx(el, "data-i")].name = el.value;
    saveDraft();
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
    return { client: e.client, preparedBy: e.preparedBy, date: e.date,
             workflows: q.workflows.map(function (w) { return { name: w.name, tier: w.tier.label, score: w.score.total }; }),
             careTier: q.careTier.label, years: q.years,
             total: q.contract, year1: q.year1, recurring: q.recurring };
  }

  function saveQuote() {
    var q = currentQuote();
    if (!q.ready || !state.db) return;
    var inputs = JSON.parse(JSON.stringify(state.inputs)); delete inputs.example;
    var body = { inputs: inputs, summary: summaryFor(q), modelVersion: model.version, savedAt: new Date().toISOString() };
    var ref = state.savedId ? state.db.doc("quotes/" + state.savedId) : state.db.collection("quotes").doc();
    ref.set(body).then(function () {
      state.savedId = ref.id; state.toast = "Saved to the library."; saveDraft(); render();
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
      state.inputs = migrate(d.inputs);
      state.savedId = id; state.view = "wizard"; state.step = steps().length - 1; window.scrollTo(0, 0);
    });
  }

  function deleteQuote(id) {
    if (!state.db) return;
    var d = null; state.quotes.forEach(function (x) { if (x.id === id) d = x; });
    var name = d && d.summary ? d.summary.client : "this quote";
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

  root.MQAPP = { start: start, steps: steps, state: state };
})(typeof globalThis !== "undefined" ? globalThis : this);
