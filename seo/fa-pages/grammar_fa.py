"""Persian grammar guides (phase 2) — used by blog_fa.py.

Every grammar guide body is rebuilt here from the app's grammar data
(data/grammar/*.json). The old renderer left every explanation paragraph and
tip empty; this one shows them. Sections A1, A2 and B1 are written in Persian
from grammar_fa/<slug>.txt (example sentences, exercise sentences and answers
stay English). Sections B2, C1 and C2 stay English.

Translation files (grammar_fa/<slug>.txt), one entry per line, "key: value":
  i0, i1 ...            intro paragraphs
  <point>.t / .s        point title / summary
  <point>.bK            paragraph or tip K (list block: <point>.bK.J = item J)
  <point>.bK.h          table headers, separated by " | "
  <point>.bK.R          table row R, cells separated by " ‖ "; "=" keeps the English cell
  <point>.nK / .wK      example note K / mistake explanation K
  x.<exercise id>       exercise explanation (site and app-bank exercises)
  q.<exercise id>       exercise instruction prompt (when it isn't a sentence to complete)
Markdown as in the data: *English example*, **bold**, [text](/link/).
Text written by Claude for Alireza. Don't edit the wording; ask.

CLI:
  python3 seo/fa-pages/grammar_fa.py dump <slug>   # English to translate; saves grammar_fa/<slug>.src.json
  python3 seo/fa-pages/grammar_fa.py dumpx <slug>  # untranslated app-bank exercises (explanations, prompts)
  python3 seo/fa-pages/grammar_fa.py status        # coverage, missing files, stale entries

The app (js/main.js) reads the same Persian through data/grammar/fa/<slug>.json,
written by export_app() every time blog_fa.py runs.
"""
import html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FA_DIR = os.path.join(HERE, "grammar_fa")
LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"]
FA_LEVELS = {"a1", "a2", "b1"}
LV_FA = {"a1": "مبتدی", "a2": "مقدماتی", "b1": "متوسط", "b2": "بالاتر از متوسط", "c1": "پیشرفته", "c2": "تسلط کامل"}
LV_EN = {"a1": "Beginner", "a2": "Elementary", "b1": "Intermediate", "b2": "Upper-intermediate", "c1": "Advanced", "c2": "Proficiency"}
STALE = set()

# ---------------------------------------------------------------- data
_T = {}
def topics(repo):
    if repo not in _T:
        d = {}
        for lv in LEVELS:
            p = os.path.join(repo, "data", "grammar", lv + ".json")
            if os.path.exists(p):
                for t in json.load(open(p, encoding="utf-8")).get("topics", []):
                    if t["slug"] not in d:
                        d[t["slug"]] = dict(t, exercises={"items": list(t.get("exercises", {}).get("items", []))})
                    else:  # each level file carries that level's exercises
                        have = {e["id"] for e in d[t["slug"]]["exercises"]["items"]}
                        d[t["slug"]]["exercises"]["items"] += [e for e in t.get("exercises", {}).get("items", []) if e["id"] not in have]
        _T[repo] = d
    return _T[repo]

def site_exercises(t):
    return [e for e in t.get("exercises", {}).get("items", []) if e.get("use") == "site"]

def bank_exercises(t):
    return [e for e in t.get("exercises", {}).get("items", []) if e.get("use") != "site"]

def ex_units(exs):
    out = []
    for e in exs:
        if e["level"] in FA_LEVELS:
            if is_instruction(e) and e["prompt"] not in PROMPT_FA:
                out.append(("q." + e["id"], e["prompt"]))
            if e.get("explanation"):
                out.append(("x." + e["id"], e["explanation"]))
    return out

def units(t, bank=False):
    """(key, English) for everything in the A1–B1 sections that can be written in Persian.
    bank=True: only the app-bank exercises (the app's quiz pool; not shown on the blog)."""
    if bank:
        return ex_units(bank_exercises(t))
    out = []
    if any(p["level"] in FA_LEVELS for p in t["points"]):
        out += [("i%d" % i, s) for i, s in enumerate(t.get("intro", []))]
    for p in t["points"]:
        if p["level"] not in FA_LEVELS:
            continue
        pid = p["id"]
        out += [(pid + ".t", p["title"]), (pid + ".s", p["summary"])]
        for k, b in enumerate(p["blocks"]):
            key = "%s.b%d" % (pid, k)
            if b["type"] in ("p", "tip"):
                out.append((key, b["md"]))
            elif b["type"] == "list":
                if b.get("md"):
                    out.append((key, b["md"]))
                out += [("%s.%d" % (key, j), it) for j, it in enumerate(b.get("items", []))]
            elif b["type"] == "table":
                out.append((key + ".h", " | ".join(b["headers"])))
                for r, row in enumerate(b["rows"]):
                    out += [("%s.%d.%d" % (key, r, c), cell) for c, cell in enumerate(row)]
        out += [("%s.n%d" % (pid, k), e["note"]) for k, e in enumerate(p["examples"]) if e.get("note")]
        out += [("%s.w%d" % (pid, k), m["why"]) for k, m in enumerate(p["mistakes"]) if m.get("why")]
    return out + ex_units(site_exercises(t))

# exercise prompts that are instructions (not English sentences to complete)
PROMPT_FA = {
    "Which sentence is correct?": "کدام جمله درست است؟",
    "Which sentence is NOT correct?": "کدام جمله درست **نیست**؟",
    "Which is correct?": "کدام درست است؟",
    "Choose the correct sentence.": "جملهٔ درست را انتخاب کنید.",
    "Which is the most formal?": "کدام از همه رسمی‌تر است؟",
    "Which is the most polite?": "کدام از همه مؤدبانه‌تر است؟",
    "Which sentence is the most informal?": "کدام جمله از همه خودمانی‌تر است؟",
    "Which question is correct?": "کدام سؤال درست است؟",
    "Which sentence is NOT natural?": "کدام جمله طبیعی **نیست**؟",
    "Which sentence is the most natural?": "کدام جمله از همه طبیعی‌تر است؟",
}
ERROR_FA = "کدام بخش غلط است؟ روی همان بخش بزنید."

def is_instruction(e):
    return e["type"] != "error" and "___" not in e.get("prompt", "")

def load_fa(slug):
    p = os.path.join(FA_DIR, slug + ".txt")
    d = {}
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            k, sep, v = line.partition(": ")
            if sep and v.strip():
                d[k.strip()] = v.strip()
    sp = os.path.join(FA_DIR, slug + ".src.json")
    src = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else {}
    return d, src

class FA:
    """Persian lookup for one topic; falls back to English when missing or when the English changed."""
    def __init__(self, slug):
        self.slug = slug
        self.d, self.src = load_fa(slug)
    def ok(self, key, en):
        if key in self.src and self.src[key] != en:
            STALE.add("%s:%s" % (self.slug, key))
            return False
        return True
    def get(self, key, en):
        v = self.d.get(key)
        return v if v is not None and self.ok(key, en) else None
    def cell(self, key, r, c, en):
        v = self.d.get("%s.%d.%d" % (key, r, c))
        if v is None:
            row = self.d.get("%s.%d" % (key, r))
            if row is not None:
                parts = [x.strip() for x in row.split("‖")]
                v = parts[c] if c < len(parts) and parts[c] not in ("=", "") else None
        return v if v is not None and self.ok("%s.%d.%d" % (key, r, c), en) else None

# ---------------------------------------------------------------- markdown (inline)
_TOK = re.compile(r"(\*+|\[[^\]]*\]\([^)\s]*\))")

def md(s):
    out, stack = [], []
    for tok in _TOK.split(s or ""):
        if not tok:
            continue
        if tok[0] == "*":
            k = len(tok)
            while k > 0:
                top = stack[-1] if stack else None
                if top == "strong" and k >= 2:
                    out.append("</strong>"); stack.pop(); k -= 2
                elif top == "strong":
                    out.append("<em>"); stack.append("em"); k -= 1
                elif top == "em" and k == 1:
                    out.append("</em>"); stack.pop(); k -= 1
                elif top == "em":
                    out.append("<strong>"); stack.append("strong"); k -= 2
                elif k >= 3:
                    out.append("<em><strong>"); stack += ["em", "strong"]; k -= 3
                elif k == 2:
                    out.append("<strong>"); stack.append("strong"); k -= 2
                else:
                    out.append("<em>"); stack.append("em"); k -= 1
        elif tok[0] == "[" and re.match(r"\[[^\]]*\]\([^)\s]*\)$", tok):
            m = re.match(r"\[([^\]]*)\]\(([^)\s]*)\)$", tok)
            out.append('<a href="%s">%s</a>' % (html.escape(m.group(2)), md(m.group(1))))
        else:
            out.append(html.escape(tok, quote=False))
    out += ["</%s>" % x for x in reversed(stack)]
    return "".join(out)

_AR = re.compile(r"[؀-ۿ]")
_L = "A-Za-z\u00C0-\u02FF"
_RUN = re.compile(r"(?<![&#\w])/?[-+]?[%s][%s0-9'’]*(?:(?:[ ./+~→…'’-]|, )+[-+]?[%s0-9][%s0-9'’]*)*/?" % (_L, _L, _L, _L))

def md_fa(s):
    """Persian markdown: English in *…* becomes an LTR island; bare English runs are isolated."""
    h = md(s)
    def em(m):
        txt = html.unescape(re.sub(r"<[^>]+>", "", m.group(1)))
        if re.search(r"[A-Za-z]", txt) and not _AR.search(txt):
            return '<em dir="ltr">%s</em>' % m.group(1)
        return m.group(0)
    h = re.sub(r"<em>((?:(?!</?em>).)*)</em>", em, h)
    # punctuation right after an English island belongs to it (no orphan "." at a line start)
    h = re.sub(r'(<em dir="ltr">(?:(?!</?em>).)*)</em>([.,:;!?]+)', r"\1\2</em>", h)
    out, ltr = [], 0
    for part in re.split(r"(<[^>]+>)", h):
        if part.startswith("<"):
            if part.startswith('<em dir="ltr"'):
                ltr += 1
            elif part == "</em>" and ltr:
                ltr -= 1
            out.append(part)
        elif ltr:
            out.append(part)
        else:
            out.append(_RUN.sub(lambda m: "<bdi>%s</bdi>" % m.group(0), part))
    # a word-initial hyphen (-ed, -ing) must not break from its word at a line end
    return re.sub(r"(?<![A-Za-z<])-(?=[A-Za-z])", "\u2011", "".join(out))

# ---------------------------------------------------------------- rendering
def gap(h):
    return h.replace("___", '<span class="gap">___</span>')

def render_point(p, F, fa_mode):
    pid, lv = p["id"], p["level"]
    tx = (lambda key, en: (lambda v: md_fa(v) if v is not None else None)(F.get(key, en))) if fa_mode else (lambda key, en: None)
    o = []
    t = tx(pid + ".t", p["title"])
    title = t if t else ('<span dir="ltr">%s</span>' % md(p["title"]) if fa_mode else md(p["title"]))
    o.append("<h3 id='%s'>%s <span class='lvl-badge'>%s</span></h3>" % (pid, title, lv.upper()))
    s = tx(pid + ".s", p["summary"])
    o.append('<p class="psum">%s</p>' % s if s else ('<p class="psum"%s>%s</p>' % (' dir="ltr"' if fa_mode else "", md(p["summary"]))))
    for k, b in enumerate(p["blocks"]):
        key = "%s.b%d" % (pid, k)
        if b["type"] in ("p", "tip"):
            v = tx(key, b["md"])
            inner = v if v else md(b["md"])
            dl = ' dir="ltr"' if fa_mode and not v else ""
            o.append(("<div class='tip'%s><p>%s</p></div>" if b["type"] == "tip" else "<p%s>%s</p>") % (dl, inner))
        elif b["type"] == "list":
            v = tx(key, b.get("md") or "") if b.get("md") else None
            if b.get("md"):
                o.append("<p%s>%s</p>" % ("" if v or not fa_mode else ' dir="ltr"', v or md(b["md"])))
            lis = []
            for j, it in enumerate(b.get("items", [])):
                w = tx("%s.%d" % (key, j), it)
                lis.append("<li%s>%s</li>" % ("" if w or not fa_mode else ' dir="ltr"', w or md(it)))
            o.append("<ul>%s</ul>" % "".join(lis))
        elif b["type"] == "table":
            hv = F.get(key + ".h", " | ".join(b["headers"])) if fa_mode else None
            hs = [x.strip() for x in hv.split("|")] if hv else None
            if hs and len(hs) != len(b["headers"]):
                STALE.add("%s:%s.h (column count)" % (F.slug, key)); hs = None
            ths = "".join("<th>%s</th>" % (md_fa(hs[i]) if hs else ((md(h) if not fa_mode else '<span dir="ltr">%s</span>' % md(h)) if h else "")) for i, h in enumerate(b["headers"]))
            trs = []
            for r, row in enumerate(b["rows"]):
                tds = []
                for c, cell in enumerate(row):
                    v = F.cell(key, r, c, cell) if fa_mode else None
                    tds.append("<td>%s</td>" % md_fa(v) if v is not None else ("<td%s>%s</td>" % (' dir="ltr"' if fa_mode else "", md(cell))))
                trs.append("<tr>%s</tr>" % "".join(tds))
            o.append('<div class="twrap"><table><tr>%s</tr>%s</table></div>' % (ths, "".join(trs)))
    if p["examples"]:
        lis = []
        for k, e in enumerate(p["examples"]):
            note = ""
            if e.get("note"):
                v = tx("%s.n%d" % (pid, k), e["note"])
                note = " <span class='exnote' dir='rtl'>%s</span>" % v if v else " <span class='exnote'>(%s)</span>" % md(e["note"])
            lis.append("<li>%s%s</li>" % (md(e["text"]), note))
        o.append("<ul class='examples' dir='ltr'>\n%s\n</ul>" % "\n".join(lis))
    if p["mistakes"]:
        lis = []
        for k, m in enumerate(p["mistakes"]):
            why = ""
            if m.get("why"):
                v = tx("%s.w%d" % (pid, k), m["why"])
                why = " <span class='why' dir='rtl'>%s</span>" % v if v else " <span class='why'>(%s)</span>" % md(m["why"])
            lis.append("<li>❌ %s → ✅ %s%s</li>" % (md(m["wrong"]), md(m["right"]), why))
        o.append("<div class='mistakes'><p class=\"fa-l\" dir=\"rtl\" lang=\"fa\"><strong>اشتباه‌های رایج:</strong></p><ul dir='ltr'>\n%s\n</ul></div>" % "\n".join(lis))
    return "\n".join(o)

def render_ex(e, n, F, fa_mode):
    eid = e["id"]
    v = F.get("x." + eid, e.get("explanation", "")) if fa_mode and e.get("explanation") else None
    expl = md_fa(v) if v else md(e.get("explanation", ""))
    edir = "rtl" if v else "ltr"
    o = ['<div class="exblock" id="ex-%s">' % eid]
    if e["type"] == "error":
        if fa_mode:
            o.append('<div class="exq" dir="rtl">%d. اشتباه را پیدا کنید: روی بخش غلط بزنید.</div>' % n)
        else:
            o.append('<div class="exq">%d. Find the mistake: tap the wrong part.</div>' % n)
        segs = "".join("<span class='eseg' data-idx='%d' onclick=\"pickSeg('%s', %d)\">%s</span> " % (i, eid, i, html.escape(s)) for i, s in enumerate(e.get("segments", [])))
        o.append('<div class="esent" dir="ltr">%s</div>' % segs)
        corr = html.escape(e.get("correction", ""))
        if fa_mode:
            o.append('<div class="exexpl" dir="rtl" style="display:none">شکل درست: <bdi dir="ltr">%s</bdi><br>%s</div>' % (corr, expl))
        else:
            o.append('<div class="exexpl" style="display:none">Correct: %s<br>%s</div>' % (corr, expl))
        o.append("<button class=\"excheck\" onclick=\"checkSeg('%s', %d)\">بررسی</button>" % (eid, e.get("answer") or 0))
    else:
        q = None
        if fa_mode and is_instruction(e):
            q = F.get("q." + eid, e["prompt"]) or PROMPT_FA.get(e["prompt"])
        if q:
            o.append('<div class="exq" dir="rtl">%d. %s</div>' % (n, md_fa(q)))
        else:
            o.append('<div class="exq" dir="ltr">%d. %s</div>' % (n, gap(md(e["prompt"]))))
        if e["type"] == "mcq":
            o.append("".join("<label dir=\"ltr\"><input type='radio' name='%s' value='%d'> %s</label>" % (eid, i, html.escape(x)) for i, x in enumerate(e.get("options", []))))
            btn = "<button class=\"excheck\" onclick=\"checkEx('%s', %d)\">بررسی</button>" % (eid, e.get("answer") or 0)
        else:
            o.append('<input type="text" id="%s-input" dir="ltr" placeholder="جواب را بنویسید" style="padding:8px;border:1px solid #ddd;border-radius:6px;width:200px">' % eid)
            acc = html.escape(json.dumps(e.get("accept", []), ensure_ascii=False), quote=True)
            btn = "<button class=\"excheck\" onclick=\"checkGap('%s', %s)\">بررسی</button>" % (eid, acc)
        o.append('<div class="exexpl" dir="%s" style="display:none">%s</div>' % (edir, expl))
        o.append(btn)
    o.append("</div>")
    return "\n".join(o)

def has_fa(t):
    F = FA(t["slug"])
    return bool(F.d)

def render_body(t, see_also=()):
    """The guide between the H1 and "Related grammar"."""
    F = FA(t["slug"])
    by_lv = {}
    for p in t["points"]:
        by_lv.setdefault(p["level"], []).append(p)
    exs = {}
    for e in site_exercises(t):
        exs.setdefault(e["level"], []).append(e)
    lvls = [lv for lv in LEVELS if lv in by_lv or lv in exs]
    o = ['<div class="gbody">']
    intro_fa = [F.get("i%d" % i, s) for i, s in enumerate(t.get("intro", []))] if any(p["level"] in FA_LEVELS for p in t["points"]) else []
    if intro_fa and all(intro_fa):
        o.append('<div class="gintro">%s</div>' % "".join("<p>%s</p>" % md_fa(x) for x in intro_fa))
    elif t.get("intro"):
        o.append('<div class="gintro" dir="ltr" lang="en">%s</div>' % "".join("<p>%s</p>" % md(x) for x in t["intro"]))
    o.append('<div class="level-bar" dir="ltr">%s</div>' % " · ".join("<a href='#%s'>%s</a>" % (lv, lv.upper()) for lv in lvls))
    n = 0
    for lv in lvls:
        fa_mode = lv in FA_LEVELS and any(k.startswith(tuple(p["id"] + "." for p in by_lv.get(lv, []))) for k in F.d)
        if fa_mode:
            o.append("<section id='%s' dir='rtl' lang='fa'><h2><bdi>%s</bdi> · %s</h2>" % (lv, lv.upper(), LV_FA[lv]))
        else:
            o.append("<section id='%s' dir='ltr' lang='en'><h2>%s · <span lang=\"fa\">%s</span></h2>" % (lv, lv.upper(), LV_FA[lv]))
        for p in by_lv.get(lv, []):
            o.append(render_point(p, F, fa_mode))
        if exs.get(lv):
            o.append('<h3 class="fa-l" dir="rtl" lang="fa">تمرین سطح <bdi>%s</bdi></h3>' % lv.upper())
            for e in exs[lv]:
                n += 1
                o.append(render_ex(e, n, F, fa_mode))
        o.append("</section>")
    if see_also:
        o.append("<div class='seealso'><p class=\"fa-l\" dir=\"rtl\" lang=\"fa\"><strong>همچنین ببینید:</strong></p><ul>%s</ul></div>" % "".join(see_also))
    o.append("</div>")
    return "\n".join(o)

def point_index(repo):
    idx = {}
    for slug, t in topics(repo).items():
        for p in t["points"]:
            idx.setdefault(p["id"], (slug, p))
    return idx

def see_also_links(old_html, repo):
    m = re.search(r"<div class='seealso'>(.*?)</div>", old_html, re.S)
    if not m:
        return []
    idx, out = point_index(repo), []
    for pid in re.findall(r"href='(?:/blog/grammar/[^/']+/)?#([a-z0-9-]+)'", m.group(1)):
        if pid not in idx:
            continue
        slug, p = idx[pid]
        F = FA(slug)
        v = F.get(pid + ".t", p["title"]) if p["level"] in FA_LEVELS else None
        out.append("<li><a href='/blog/grammar/%s/#%s'>%s</a></li>" % (slug, pid, md_fa(v) if v else '<span dir="ltr">%s</span>' % md(p["title"])))
    return out


# ---------------------------------------------------------------- app overlay (js/main.js)
def _app(h):
    """Blog links -> in-app links; HTML is already escaped by md()."""
    return re.sub(r'href="/blog/grammar/([a-z0-9-]+)/(?:#[^"]*)?"', r'href="#/grammar/\1"', h) if h else h

def _fa_levels(t, F):
    by_lv = {}
    for p in t["points"]:
        by_lv.setdefault(p["level"], []).append(p["id"] + ".")
    return [lv for lv in LEVELS if lv in FA_LEVELS and by_lv.get(lv) and any(k.startswith(tuple(by_lv[lv])) for k in F.d)]

def app_overlay(t):
    """Persian for one topic, pre-rendered for the app; None when the topic has no Persian."""
    F = FA(t["slug"])
    lvs = _fa_levels(t, F)
    if not lvs:
        return None
    fx = lambda key, en: (lambda v: _app(md_fa(v)) if v is not None else None)(F.get(key, en))
    pts = {}
    for p in t["points"]:
        if p["level"] not in lvs:
            continue
        pid = p["id"]
        bl = []
        for k, b in enumerate(p["blocks"]):
            key = "%s.b%d" % (pid, k)
            if b["type"] in ("p", "tip"):
                bl.append(fx(key, b["md"]))
            elif b["type"] == "list":
                bl.append({"md": fx(key, b["md"]) if b.get("md") else None,
                           "items": [fx("%s.%d" % (key, j), it) for j, it in enumerate(b.get("items", []))]})
            elif b["type"] == "table":
                hv = F.get(key + ".h", " | ".join(b["headers"]))
                hs = [x.strip() for x in hv.split("|")] if hv else None
                if hs and len(hs) != len(b["headers"]):
                    STALE.add("%s:%s.h (column count)" % (F.slug, key)); hs = None
                cells = []
                for r, row in enumerate(b["rows"]):
                    cr = []
                    for c, cell in enumerate(row):
                        v = F.cell(key, r, c, cell)
                        cr.append(_app(md_fa(v)) if v is not None else None)
                    cells.append(cr)
                bl.append({"h": [_app(md_fa(x)) for x in hs] if hs else None,
                           "hl": [re.sub(r"\*+", "", x) for x in hs] if hs else None, "c": cells})
            else:
                bl.append(None)
        pts[pid] = {"t": fx(pid + ".t", p["title"]), "s": fx(pid + ".s", p["summary"]), "b": bl,
                    "n": [fx("%s.n%d" % (pid, k), e["note"]) if e.get("note") else None for k, e in enumerate(p["examples"])],
                    "w": [fx("%s.w%d" % (pid, k), m["why"]) if m.get("why") else None for k, m in enumerate(p["mistakes"])]}
    intro = [F.get("i%d" % i, x) for i, x in enumerate(t.get("intro", []))]
    xs, qs = {}, {}
    for e in t.get("exercises", {}).get("items", []):
        if e["level"] not in lvs:
            continue
        if e.get("explanation"):
            v = F.get("x." + e["id"], e["explanation"])
            if v:
                xs[e["id"]] = _app(md_fa(v))
        if is_instruction(e):
            v = F.get("q." + e["id"], e["prompt"]) or PROMPT_FA.get(e["prompt"])
            if v:
                qs[e["id"]] = _app(md_fa(v))
    return {"v": 1, "lv": lvs, "lvfa": {lv: LV_FA[lv] for lv in lvs}, "err": ERROR_FA,
            "intro": [_app(md_fa(x)) for x in intro] if intro and all(intro) else None,
            "p": pts, "x": xs, "q": qs}

def export_app(repo, titles=None):
    """Write data/grammar/fa/<slug>.json (+ index.json with Persian titles). Returns files changed."""
    out_dir = os.path.join(repo, "data", "grammar", "fa")
    os.makedirs(out_dir, exist_ok=True)
    changed = 0
    def put(name, obj):
        nonlocal changed
        path = os.path.join(out_dir, name)
        txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if old != txt:
            open(path, "w", encoding="utf-8").write(txt); changed += 1
    have = set()
    for slug, t in sorted(topics(repo).items()):
        ov = app_overlay(t)
        if ov:
            put(slug + ".json", ov); have.add(slug)
    for f in os.listdir(out_dir):  # drop overlays of topics that lost their Persian
        if f.endswith(".json") and f != "index.json" and f[:-5] not in have:
            os.remove(os.path.join(out_dir, f)); changed += 1
    if titles is not None:
        put("index.json", {"titles": {k: v for k, v in sorted(titles.items()) if k in topics(repo)}, "fa": sorted(have)})
    return changed

# ---------------------------------------------------------------- CLI
def _repo():
    return os.path.abspath(os.path.join(HERE, "..", ".."))

def dump(slug):
    t = topics(_repo())[slug]
    U = units(t)
    os.makedirs(FA_DIR, exist_ok=True)
    json.dump(dict(U), open(os.path.join(FA_DIR, slug + ".src.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    ex = {e["id"]: e for e in site_exercises(t)}
    pts = {p["id"]: p for p in t["points"]}
    print("== %s | %s" % (slug, t["h1"]))
    rows = {}
    for k, v in U:
        m = re.match(r"(.+\.b\d+)\.(\d+)\.(\d+)$", k)
        if m:
            rows.setdefault((m.group(1), int(m.group(2))), []).append(v)
            continue
        if k.endswith(".t"):
            print("## %s [%s]" % (k[:-2], pts[k[:-2]]["level"]))
        ctx = ""
        nm = re.match(r"(.+)\.([nw])(\d+)$", k)
        if nm:
            p = pts[nm.group(1)]
            if nm.group(2) == "n":
                ctx = "  ⟨%s⟩" % p["examples"][int(nm.group(3))]["text"]
            else:
                mm = p["mistakes"][int(nm.group(3))]
                ctx = "  ⟨%s → %s⟩" % (mm["wrong"], mm["right"])
        if k.startswith("x."):
            ctx = "  ⟨%s⟩" % ex[k[2:]].get("prompt", "")
        print("%s: %s%s" % (k, v, ctx))
        if k.endswith(".h"):
            b = k[:-2]
            for r in range(100):
                cells = [v2 for k2, v2 in U if k2.startswith("%s.%d." % (b, r)) and re.match(r".+\.\d+\.\d+$", k2)]
                if not cells:
                    break
                print("%s.%d: %s" % (b, r, " ‖ ".join(cells)))

def dumpx(slug):
    """Untranslated app-bank exercises of one topic; adds their English to <slug>.src.json."""
    t = topics(_repo())[slug]
    U = units(t, bank=True)
    sp = os.path.join(FA_DIR, slug + ".src.json")
    src = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else {}
    F = FA(slug)
    todo = [(k, v) for k, v in U if k not in F.d]
    for k, v in todo:
        src[k] = v
    json.dump(src, open(sp, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    ex = {e["id"]: e for e in t["exercises"]["items"]}
    print("== %s (%d to do)" % (slug, len(todo)))
    for k, v in todo:
        e = ex[k[2:]]
        if e["type"] == "mcq":
            ans = (e.get("options") or ["?"])[e.get("answer") or 0]
        elif e["type"] == "error":
            ans = e.get("correction", "")
        else:
            ans = " / ".join(e.get("accept", []))
        print("%s: %s  ⟨%s ⇒ %s⟩" % (k, v, e.get("prompt", ""), ans))

def status():
    T = topics(_repo())
    todo, done, part = [], [], []
    for slug, t in sorted(T.items()):
        U = units(t)
        if not U:
            continue
        F = FA(slug)
        if not F.d:
            todo.append(slug); continue
        # blocks that are only an English example (*…*) don't need Persian
        main = [k for k, v in U if re.search(r"(^i\d+$|\.t$|\.s$|\.b\d+$|\.b\d+\.h$)", k)
                and re.search(r"[A-Za-z]", re.sub(r"\*[^*]*\*|\*", "", v))]
        miss = [k for k in main if k not in F.d]
        (part if miss else done).append((slug, len(miss)))
    # render once to collect stale entries
    for slug, _ in done + part:
        render_body(T[slug])
    print("translated: %d  partial: %d  not started: %d" % (len(done), len(part), len(todo)))
    bt = bd = 0
    for slug, t in T.items():
        B = units(t, bank=True)
        if B:
            d = FA(slug).d
            bt += len(B); bd += sum(1 for k, _ in B if k in d)
    print("app bank exercises: %d of %d entries in Persian" % (bd, bt))
    for s, m in part:
        print("  partial %s (%d main entries missing)" % (s, m))
    if STALE:
        print("stale (English changed since translation):\n  " + "\n  ".join(sorted(STALE)))
    print("not started: " + " ".join(todo))

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "dump":
        for s in sys.argv[2:]:
            dump(s)
    elif len(sys.argv) > 2 and sys.argv[1] == "dumpx":
        for s in sys.argv[2:]:
            dumpx(s)
    elif len(sys.argv) > 1 and sys.argv[1] == "status":
        status()
    else:
        print(__doc__)
