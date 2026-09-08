# Momentum Services

The quoting tool for Acorn's Momentum Solutions Architect Service: a
step-by-step pre-scope that scores a client's workflow against the published
Complexity Scorecard, places it in a tier, and prices Discovery, Build and
Momentum Care over 12 months, 2 years or 3 years.

Published as an internal Artifact for Acorn staff:
https://claude.ai/code/artifact/85723876-7412-4f43-b4e0-3438b1a5b8df

## What it does

Twelve steps in a rail, one on screen at a time.

1. **The engagement.** Client, workflow, who is quoting, and the four
   pre-scope questions that can disqualify in the first call: Studio license,
   Blueprint match, self-build capacity, external integration.
2. **The eight scorecard factors, one per step.** Each shows the question to
   ask the client, why the factor drives effort, and the 1 / 2 / 3 options
   from the commercial model. Unclear scores high.
3. **Tier.** The total, the tier, which rules fired (floor on routing data,
   ceiling on six 3s, linked workflows are a Programme), what drove it, and
   what simplifying a factor would save.
4. **Care and commercials.** Essential, Standard or Premier Care; extended
   coverage on Premier; the term; the repeat-workflow discount; other lines
   such as a Studio uplift or an integration quoted separately.
5. **Quote.** Year 1, year by year with Care stepping up 7% at each
   anniversary, the total for the term, the payment schedule, how the build
   runs, what Care covers, terms. Save to the shared library, copy a plain-text
   summary, or print the client-facing sheet.

Saved quotes live in the artifact's own database, so anyone who opens the
tool sees the same library. Opening a saved quote reloads its answers and
re-prices them against the current model.

## The numbers

Every figure comes from `pricing/commercial-model.json`, taken from the
*Momentum Solutions Architect Service - commercial model, rate card and
service levels* document (September 2026), client-facing sections only. One
deliberate departure: **Care indexes at 7% a year**, set in
`indexation.cpi_percent`, in place of the document's "greater of CPI or 3.5%".

To change a price, change it there and rebuild. Nothing in the page is typed
in by hand.

## Layout

```
pricing/commercial-model.json   every number: scorecard, tiers, prices, Care, discounts, terms
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
node --test app/test/model.test.mjs     # worked examples A and B to the dollar, the three rules,
                                        # the 7% schedule, discounts, extra lines
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
