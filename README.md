# Momentum Services

The quoting tool for Acorn's Momentum Solutions Architect Service: a
step-by-step pre-scope that scores a client's workflow against the published
Complexity Scorecard, places it in a tier, and prices Discovery, Build and
Momentum Care over 12 months, 2 years or 3 years.

Published as an internal Artifact for Acorn staff:
https://claude.ai/code/artifact/85723876-7412-4f43-b4e0-3438b1a5b8df

## What it does

One quote can carry several Momentum workflows, each scored and tiered on
its own. The rail shows the engagement, one scorecard per workflow, then the
result.

1. **The engagement.** Client, who is quoting, the date, the list of
   workflows in the quote, and how many workflows the client already has
   with Acorn (which sets where the repeat-workflow discount starts).
2. **A scorecard per workflow.** All eight factors on one page. Each factor
   shows the question to ask the client directly above three large answer
   options, with why the factor drives effort underneath. Unclear scores
   high. Choosing an option records it and nothing else.
3. **Tiers.** Each workflow's total, tier, whether the assignee floor
   rule fired, what drove it, and what simplifying a factor would save.
4. **Care and commercials.** One Care tier for the quote (Essential,
   Standard or Premier), each workflow's fee priced from its own tier;
   extended coverage on Premier; the term; the discount each workflow gets
   by order; other lines such as an Advanced Momentum uplift.
5. **Quote.** Lines grouped by workflow, Year 1, year by year with Care
   stepping up 7% at each anniversary, the total for the term, the payment
   schedule, how the build runs, what Care covers, terms. Save to the shared
   library, copy a plain-text summary, or print the client-facing sheet.

Saved quotes live in the artifact's own database, so anyone who opens the
tool sees the same library. Opening a saved quote reloads its answers and
re-prices them against the current model.

## The service guide

`docs/service-guide.html` is the client-facing *Momentum Care Service Guide*:
the delivery stages and what "done" means at each, the three protections
that start at go-live (hypercare, warranty, Care), the Care tiers and the
allowance rules, every inclusion and exclusion elaborated with how it is
handled instead, the service levels with worked business-hours examples,
how to raise a request, and the commercial terms. The prose lives in the
template; every figure is a `{{marker}}` filled from the commercial model by
`tools/build_service_guide.py`, so a price change rebuilds the guide too.
The built page is `docs/dist/momentum-care-service-guide.html`.

## The numbers

Every figure comes from `pricing/commercial-model.json`. The structure is the
*Momentum Solutions Architect Service - commercial model, rate card and
service levels* document (September 2026), client-facing sections only, with
three deliberate departures:

- **Prices are about a third of the document's.** Simple $1,450 + $3,950,
  Moderate $1,950 + $7,450, Complex $2,950 + $11,500 for Discovery + Build.
  Care stays 18 / 25 / 35% of build with floors of $1,250 / $1,950 / $2,950.
  A Complex workflow with Standard Care is $17,330 in year 1.
- **Care indexes at 7% a year**, set in `indexation.cpi_percent`, in place
  of the document's "greater of CPI or 3.5%".
- **No Programme tier.** Every workflow is Simple, Moderate or Complex by
  scorecard total; several workflows go in one quote instead.

To change a price, change it there and rebuild. Nothing in the page is typed
in by hand.

## Layout

```
pricing/commercial-model.json   every number: scorecard, tiers, prices, Care, discounts, terms
docs/service-guide.html         the service guide template: prose plus {{markers}} for every figure
docs/dist/momentum-care-service-guide.html   the built guide (generated, committed)
tools/build_service_guide.py    fills the guide's markers from the model and inlines the tokens
design-system/tokens.css        Acorn design tokens (identical to the copy in momentum-docs)
design-system/fonts.css         the Google Fonts URL
app/index.html                  the page template the build fills in
app/src/model.js                the pricing engine: score, tier, quote, schedule. No DOM
app/src/app.js                  the wizard, the running quote, the quote sheet, the library
app/src/app.css                 the tool's styles, tokens only, light and dark
app/test/model.test.mjs         the engine held to the document's worked examples
tools/build_app.py              inlines everything into app/dist/momentum-quoting-tool.html
app/dist/momentum-quoting-tool.html   the built artifact (generated, committed)
```

## Build, test, publish

```bash
python3 tools/build_app.py --selftest   # placeholders filled, nothing internal in the page
python3 tools/build_app.py              # writes app/dist/momentum-quoting-tool.html
node --test app/test/model.test.mjs     # the two calibration engagements, the floor rule,
                                        # multi-workflow discounts, the 7% schedule, extra lines
python3 tools/build_service_guide.py --selftest   # every marker filled, every published line present
python3 tools/build_service_guide.py             # writes docs/dist/momentum-care-service-guide.html
```

Then publish `app/dist/momentum-quoting-tool.html` with the Artifact tool to
the URL above, declaring the `db` capability so the shared library keeps
working. No dependencies: stdlib Python 3 and Node's built-in test runner.

## Its sibling

`stefan-maletic-acorn/momentum-docs` turns a workflow export into a process
document and carries the Momentum vocabulary this tool uses: step, path,
routing rule, form, External Momentum, a Momentum activity inside a course.
Its `pricing/` folder holds an earlier hours-per-element model at a placeholder
rate; this repository's scorecard model supersedes it for quoting.
