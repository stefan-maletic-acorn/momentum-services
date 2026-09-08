#!/usr/bin/env python3
"""
Assemble the Momentum quoting tool into one HTML file.

    python3 tools/build_app.py              writes app/dist/momentum-quoting-tool.html
    python3 tools/build_app.py --selftest   builds in memory and checks the result

The page is app/index.html with the design tokens, the tool's stylesheet, the
commercial model and the two scripts inlined, so the one file is the whole
tool and can be published as an Artifact. Every number in the page comes
from pricing/commercial-model.json at build time.
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCES = ["model.js", "app.js"]
OUT = os.path.join(ROOT, "app", "dist", "momentum-quoting-tool.html")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def strip_css_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S).strip()


def build():
    model = json.loads(read("pricing", "commercial-model.json"))
    tokens = strip_css_comments(read("design-system", "tokens.css"))
    sources = "\n".join(read("app", "src", name) for name in SOURCES)
    page = read("app", "index.html")
    page = page.replace("/*__TOKENS_CSS__*/", tokens)
    page = page.replace("/*__APP_CSS__*/", read("app", "src", "app.css"))
    page = page.replace("__MODEL_JSON__", json.dumps(model, ensure_ascii=False).replace("</", "<\\/"))
    page = page.replace("/*__SOURCES__*/", sources.replace("</script", "<\\/script"))
    return page


def selftest():
    page = build()
    fails = []

    def check(ok, why):
        if not ok:
            fails.append(why)
            sys.stdout.write("FAIL  %s\n" % why)

    for marker in ("__TOKENS_CSS__", "__APP_CSS__", "__MODEL_JSON__", "__SOURCES__"):
        check(marker not in page, "placeholder %s was not filled" % marker)
    check(page.lstrip().startswith("<title>"), "the page does not open with its title")
    check("MQAPP.start()" in page, "the app is not started")
    check("--acorn-purple" in page and ".mq-rail" in page, "the tokens or the stylesheet are missing")
    check('"cpi_percent": 7' in page or '"cpi_percent":7' in page, "the 7% indexation is not in the page")
    check(page.count("</script>") == 3, "a source broke out of its <script>")
    check(len(page.encode("utf-8")) < 1024 * 1024, "the page is over 1 MB")
    for bad in ("Internal only", "gross margin", "A1.", "A2."):
        check(bad not in page, "the page carries internal text: %r" % bad)
    sys.stdout.write("ok    build_app: %d checks, %d failed\n" % (11, len(fails)))
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
