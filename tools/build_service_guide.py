#!/usr/bin/env python3
"""
Assemble the Momentum Care service guide into one HTML file.

    python3 tools/build_service_guide.py              writes docs/dist/momentum-care-service-guide.html
    python3 tools/build_service_guide.py --selftest   builds in memory and checks the result

The guide is docs/service-guide.html, a client-facing elaboration of the
service levels, the delivery stages, and what Momentum Care does and does
not cover. The prose lives in the template; every number in it comes from
pricing/commercial-model.json at build time, through three kinds of marker:

    {{care.coverage}}                  a value from the model, by dotted path
    {{money:prices.simple.build}}      a dollar figure, formatted
    {{block:care_tiers}}               a table or list rendered by a function below

Change a number in the model and rebuild; never edit one in the page.
"""

import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "docs", "dist", "momentum-care-service-guide.html")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def strip_css_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S).strip()


def esc(s):
    return html.escape(str(s), quote=True)


def money(v):
    return "${:,.0f}".format(v)


def lookup(model, path):
    cur = model
    for part in path.split("."):
        if isinstance(cur, list):
            cur = cur[int(part)]
        else:
            cur = cur[part]
    return cur


def hours_in_day(coverage):
    """Business hours in the coverage window, read from its '8:30am to 5:30pm' text."""
    m = re.search(r"(\d{1,2}):(\d{2})(am|pm) to (\d{1,2}):(\d{2})(am|pm)", coverage)
    if not m:
        return 9
    def minutes(h, mi, ap):
        h = int(h) % 12 + (12 if ap == "pm" else 0)
        return h * 60 + int(mi)
    return (minutes(m.group(4), m.group(5), m.group(6)) - minutes(m.group(1), m.group(2), m.group(3))) / 60.0


def clock_example(model, start_hhmm, business_hours):
    """When a response is due if a ticket lands at start_hhmm and the target is
    business_hours, inside the coverage window. Returns text like
    '10:30am the next business day'."""
    m = re.search(r"(\d{1,2}):(\d{2})(am|pm) to", model["care"]["coverage"])
    open_h = int(m.group(1)) % 12 + (12 if m.group(3) == "pm" else 0)
    open_min = open_h * 60 + int(m.group(2))
    day = hours_in_day(model["care"]["coverage"]) * 60
    sh, sm = start_hhmm.split(":")
    elapsed = int(sh) * 60 + int(sm) - open_min  # minutes already used today
    remaining_today = day - elapsed
    target = business_hours * 60
    days = 0
    while target > remaining_today:
        target -= remaining_today
        remaining_today = day
        days += 1
    due = (open_min if days else int(sh) * 60 + int(sm)) + target
    h, mi = divmod(int(due), 60)
    ap = "am" if h < 12 else "pm"
    h12 = h % 12 or 12
    when = "the same day" if days == 0 else ("the next business day" if days == 1 else "%d business days later" % days)
    return "%d:%02d%s %s" % (h12, mi, ap, when)


def parse_hours(text):
    m = re.match(r"(\d+)", text)
    return int(m.group(1)) if m else None


# --- blocks -----------------------------------------------------------------

def block_care_tiers(model):
    rows = []
    for t in model["care"]["tiers"]:
        rows.append(
            "<tr><th scope=\"row\">%s</th><td>%d%% of build, minimum %s</td><td class=\"num\">%d hrs</td><td>%s</td><td>%s</td><td>%s</td></tr>"
            % (esc(t["label"]), t["percent_of_build"], money(t["minimum"]), t["allowance_hours"], esc(t["cadence"]),
               esc(t["critical_response"]), "Yes" if t["service_credits"] else "No"))
    return ("<table><thead><tr><th>Care tier</th><th>Annual fee</th><th class=\"num\">Change allowance</th><th>Review cadence</th>"
            "<th>Critical response</th><th>Service credits</th></tr></thead><tbody>%s</tbody></table>" % "".join(rows))


def block_care_fees(model):
    tiers = model["scorecard"]["tiers"]
    care = model["care"]["tiers"]
    head = "".join("<th class=\"num\">%s</th>" % esc(c["label"]) for c in care)
    rows = []
    for t in tiers:
        cells = "".join("<td class=\"num\">%s</td>" % money(model["care"]["table"][t["key"]][c["key"]]) for c in care)
        rows.append("<tr><th scope=\"row\">%s workflow <span class=\"detail\">Build %s</span></th>%s</tr>"
                    % (esc(t["label"]), money(model["prices"][t["key"]]["build"]), cells))
    return "<table><thead><tr><th>Workflow tier</th>%s</tr></thead><tbody>%s</tbody></table>" % (head, "".join(rows))


def block_service_levels(model):
    rows = []
    for s in model["service_levels"]:
        sev = s["severity"].split(" ")[0].lower()
        rows.append(
            "<tr class=\"sev-%s\"><th scope=\"row\"><span class=\"sev\">%s</span></th><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
            % (esc(sev), esc(s["severity"]), esc(s["definition"]), esc(s["response"]),
               esc(s["workaround"]) if s["workaround"] else "<span class=\"muted\">n/a</span>", esc(s["resolution"])))
    return ("<table class=\"sla\"><thead><tr><th>Severity</th><th>Definition</th><th>Response</th><th>Workaround</th><th>Resolution</th></tr></thead>"
            "<tbody>%s</tbody></table>" % "".join(rows))


def block_stages(model):
    rows = []
    for s in model["build"]["stages"]:
        rows.append("<tr><th scope=\"row\">%s</th><td>%s</td><td>%s</td><td>%s</td></tr>"
                    % (esc(s["stage"]), esc(s["duration"]), esc(s["text"]), esc(s["client_time"]) if s["client_time"] else "<span class=\"muted\">None</span>"))
    return ("<table><thead><tr><th>Stage</th><th>Duration</th><th>What happens</th><th>Your time</th></tr></thead><tbody>%s</tbody></table>"
            % "".join(rows))


def block_timeline(model):
    """The delivery period as a horizontal band: build, UAT, rework, go-live,
    then the three overlapping protections that start at go-live."""
    d = model["build"]["duration"]
    return """
<figure class="timeline" aria-labelledby="timeline-cap">
  <div class="wrap"><div class="tl-track">
    <div class="tl-seg build"><span class="k">Build</span><span class="v">%(build)s</span></div>
    <div class="tl-seg uat"><span class="k">UAT</span><span class="v">5 business days</span></div>
    <div class="tl-seg rework"><span class="k">Rework</span><span class="v">One pass</span></div>
    <div class="tl-mark"><span class="k">Go-live</span></div>
    <div class="tl-after">
      <div class="tl-bar hyper"><span class="k">Hypercare</span><span class="v">10 business days</span></div>
      <div class="tl-bar warranty"><span class="k">Warranty</span><span class="v">30 business days</span></div>
      <div class="tl-bar care"><span class="k">Momentum Care</span><span class="v">Annual, renews with the license</span></div>
    </div>
  </div></div>
  <figcaption id="timeline-cap">The delivery period. Hypercare, warranty and Care all start on the go-live date and run concurrently, so the first thirty business days are covered three ways.</figcaption>
</figure>""" % {"build": esc("%s to %s" % (d["simple"].split(" ")[0], d["complex"].split(" to ")[1]))}


def block_covered(model):
    return "".join("<li>%s</li>" % esc(t) for t in model["care"]["covered"])


def block_not_covered(model):
    return "".join("<li>%s</li>" % esc(t) for t in model["care"]["not_covered"])


def block_client_needs(model):
    return "".join("<li>%s</li>" % esc(t) for t in model["client_needs"])


def block_terms(model):
    return "".join("<div class=\"term\"><dt>%s</dt><dd>%s</dd></div>" % (esc(t["term"]), esc(t["position"])) for t in model["terms"])


def block_discovery_deliverables(model):
    return "".join("<li>%s</li>" % esc(t) for t in model["discovery"]["deliverables"])


def block_build_included(model):
    return "".join("<li>%s</li>" % esc(t) for t in model["build"]["included"])


BLOCKS = {
    "care_tiers": block_care_tiers,
    "care_fees": block_care_fees,
    "service_levels": block_service_levels,
    "stages": block_stages,
    "timeline": block_timeline,
    "covered": block_covered,
    "not_covered": block_not_covered,
    "client_needs": block_client_needs,
    "terms": block_terms,
    "discovery_deliverables": block_discovery_deliverables,
    "build_included": block_build_included,
}


def derived(model):
    """Figures the template needs that are computed from the model rather than
    stored in it: the fastest critical response, business hours in a day,
    the clock worked examples."""
    tiers = model["care"]["tiers"]
    fastest = min(tiers, key=lambda t: parse_hours(t["critical_response"]))
    slowest = max(tiers, key=lambda t: parse_hours(t["critical_response"]))
    high = [s for s in model["service_levels"] if s["severity"] == "High"][0]
    return {
        "derived.fastest_critical": fastest["critical_response"],
        "derived.fastest_tier": fastest["label"],
        "derived.slowest_critical": slowest["critical_response"],
        "derived.slowest_tier": slowest["label"],
        "derived.hours_in_day": "%g" % hours_in_day(model["care"]["coverage"]),
        "derived.clock_slow": clock_example(model, "15:00", parse_hours(slowest["critical_response"])),
        "derived.clock_fast": clock_example(model, "15:00", parse_hours(fastest["critical_response"])),
        "derived.clock_high": clock_example(model, "15:00", parse_hours(high["response"])),
        "derived.credit_tiers": " and ".join(t["label"] for t in tiers if t["service_credits"]),
        "derived.no_credit_tiers": " and ".join(t["label"] for t in tiers if not t["service_credits"]),
        "derived.premier_percent": "%d" % [t for t in tiers if t["key"] == "premier"][0]["percent_of_build"],
    }


MARK = re.compile(r"\{\{(money:|block:)?([a-zA-Z0-9_.]+)\}\}")


def render(template, model):
    extra = derived(model)

    def sub(m):
        kind, path = m.group(1), m.group(2)
        if kind == "block:":
            return BLOCKS[path](model)
        if path in extra:
            return esc(extra[path])
        val = lookup(model, path)
        if kind == "money:":
            return money(val)
        return esc(val)

    return MARK.sub(sub, template)


def build():
    model = json.loads(read("pricing", "commercial-model.json"))
    tokens = strip_css_comments(read("design-system", "tokens.css"))
    page = read("docs", "service-guide.html")
    page = page.replace("/*__TOKENS_CSS__*/", tokens)
    page = render(page, model)
    return page


def selftest():
    page = build()
    model = json.loads(read("pricing", "commercial-model.json"))
    fails = []

    def check(ok, why):
        if not ok:
            fails.append(why)
            sys.stdout.write("FAIL  %s\n" % why)

    check("__TOKENS_CSS__" not in page, "the tokens placeholder was not filled")
    check(not MARK.search(page), "an unfilled marker remains: %r" % (MARK.search(page).group(0) if MARK.search(page) else ""))
    check(page.lstrip().startswith("<title>"), "the page does not open with its title")
    check(model["care"]["coverage"] in page, "the coverage window is not in the page")
    for t in model["care"]["tiers"]:
        check(t["critical_response"] in page, "%s critical response missing" % t["label"])
    for s in model["service_levels"]:
        check(esc(s["definition"]) in page, "%s definition missing" % s["severity"])
    for text in model["care"]["covered"] + model["care"]["not_covered"]:
        check(esc(text) in page, "Care line missing: %r" % text[:40])
    check(str(model["indexation"]["cpi_percent"]) + "%" in page, "the indexation figure is missing")
    check(clock_example(model, "15:00", 4) == "10:00am the next business day", "the business-hours clock is wrong")
    check(clock_example(model, "15:00", 1) == "4:00pm the same day", "the one-hour clock is wrong")
    check(len(page.encode("utf-8")) < 512 * 1024, "the page is over 512 KB")
    for bad in ("Internal only", "gross margin", "A1.", "A2.", "TODO"):
        check(bad not in page, "the page carries internal text: %r" % bad)
    n = 12 + len(model["care"]["tiers"]) + len(model["service_levels"]) + len(model["care"]["covered"]) + len(model["care"]["not_covered"])
    sys.stdout.write("ok    build_service_guide: %d checks, %d failed\n" % (n, len(fails)))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    page = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(page)
    print("wrote %s (%d bytes)" % (os.path.relpath(OUT, ROOT), len(page.encode("utf-8"))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
