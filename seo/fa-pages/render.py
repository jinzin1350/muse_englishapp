"""Render Claude's Persian copy (content.py) into the /fa/ static pages.
Usage: python3 render.py /path/to/repo
Template/CSS: the existing fa/assets/fa.css (Muse's design). Text: content.py only."""
import html, json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from content import PAGES, SITE

REPO = sys.argv[1]
NAV = [("/fa/", "صفحهٔ اصلی"), ("/fa/ielts/", "آزمون آزمایشی آیلتس"),
       ("/fa/mohajerat/", "مهاجرت به کانادا"), ("/fa/az-sefr/", "شروع از صفر")]
# Header nav: Persian pages + the main English sections (lessons, grammar, vocabulary).
HEAD_NAV = [("/fa/", "خانه"), ("/blog/", "درس‌ها"), ("/blog/grammar/", "گرامر"), ("/blog/vocabulary/", "لغت‌ها"),
            ("/fa/ielts/", "آیلتس"), ("/fa/mohajerat/", "مهاجرت به کانادا"), ("/fa/az-sefr/", "شروع از صفر")]
HOTJAR = open(os.path.join(REPO, "index.html"), encoding="utf-8").read().split("<!-- Hotjar Tracking Code", 1)[1].split("</script>", 1)[0]
HOTJAR = "<!-- Hotjar Tracking Code" + HOTJAR + "</script>"
LEVELS = [("/blog/a1/", "A1، مبتدی"), ("/blog/a2/", "A2، مقدماتی"), ("/blog/b1/", "B1، متوسط"),
          ("/blog/b2/", "B2، بالاتر از متوسط"), ("/blog/c1/", "C1، پیشرفته"), ("/blog/c2/", "C2، تسلط کامل")]
HERO_IMG = {"/fa/": "/media/home/mascot-read-book.png", "/fa/ielts/": "/media/home/mascot-read-book.png",
            "/fa/mohajerat/": "/media/home/mascot-read-book.png", "/fa/az-sefr/": "/media/home/mascot-run.png"}
CRUMB = {"/fa/": "صفحهٔ اصلی", "/fa/ielts/": "آزمون آزمایشی آیلتس",
         "/fa/mohajerat/": "زبان انگلیسی برای مهاجرت به کانادا", "/fa/az-sefr/": "آموزش زبان انگلیسی از صفر"}

_W = r"[A-Za-z0-9]*(?:[.&'’+\-][A-Za-z0-9]+)*"
LATIN = re.compile(r"[A-Za-z]" + _W + r"(?:,? [A-Za-z0-9]" + _W + r")*")
B0, B1 = "", ""

def bdi(raw):
    """Isolate Latin runs so they never scramble inside RTL lines."""
    return LATIN.sub(lambda m: B0 + m.group(0) + B1, raw)

def inline(raw):
    links = []
    def keep(m):
        links.append((m.group(1), m.group(2)))
        return "%d" % (len(links) - 1)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", keep, raw)
    t = html.escape(bdi(t), quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*([^*]+)\*(?!\w)", r"<em>\1</em>", t)
    def put(m):
        text, url = links[int(m.group(1))]
        ext = url.startswith("http")
        attrs = ' target="_blank" rel="noopener"' if ext else ""
        body = html.escape(bdi(text), quote=False)
        body = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", body)
        return '<a href="%s"%s>%s</a>' % (html.escape(url), attrs, body)
    t = re.sub("(\\d+)", put, t)
    return t.replace(B0, '<bdi>').replace(B1, '</bdi>')

def plain(raw):
    return re.sub(r"\*\*|\[|\]\([^)]*\)", "", raw)

def esc(s):
    return html.escape(s, quote=True)

def block(b):
    t = b["type"]
    if t == "p":
        return "<p>%s</p>" % inline(b["text"])
    if t == "note":
        return '<div class="notice"><p>%s</p></div>' % inline(b["text"])
    if t == "list":
        return '<ul class="fa-list">%s</ul>' % "".join("<li>%s</li>" % inline(i) for i in b["items"])
    if t == "steps":
        return '<ol class="fa-steps">%s</ol>' % "".join("<li>%s</li>" % inline(i) for i in b["items"])
    if t == "table":
        head = "".join("<th>%s</th>" % inline(h) for h in b["head"])
        rows = "".join("<tr>%s</tr>" % "".join("<td>%s</td>" % inline(c) for c in r) for r in b["rows"])
        return '<div class="tbl-wrap"><table><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>' % (head, rows)
    if t == "links":
        return '<div class="cards fa-links">%s</div>' % "".join(
            '<a class="card" href="%s"><h3>%s</h3><p>%s</p></a>' % (esc(i["href"]), inline(i["title"]), inline(i["desc"])) for i in b["items"])
    if t == "chips":
        return '<ul class="fa-chips">%s</ul>' % "".join('<li><a href="%s">%s</a></li>' % (esc(i["href"]), inline(i["text"])) for i in b["items"])
    raise ValueError(t)

def page(p):
    path = p["path"]; url = SITE + path
    nav = "".join('<a href="%s"%s>%s</a>' % (h, ' aria-current="page"' if h == path else "", l) for h, l in HEAD_NAV)
    hreflang = ""
    if path == "/fa/":
        hreflang = ('<link rel="alternate" hreflang="en" href="%s/en/">\n<link rel="alternate" hreflang="fa" href="%s/fa/">\n'
                    '<link rel="alternate" hreflang="x-default" href="%s/">\n') % (SITE, SITE, SITE)
    crumbs = [{"@type": "ListItem", "position": 1, "name": CRUMB["/fa/"], "item": SITE + "/fa/"}]
    if path != "/fa/":
        crumbs.append({"@type": "ListItem", "position": 2, "name": CRUMB[path], "item": url})
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": url + "#webpage", "url": url, "name": p["title"],
         "description": p["meta_description"], "inLanguage": "fa",
         "isPartOf": {"@type": "WebSite", "name": "Muse English", "url": SITE + "/"}},
        {"@type": "BreadcrumbList", "itemListElement": crumbs}]}
    if p.get("last_checked"):
        ld["@graph"][0]["dateModified"] = "2026-11-10"

    hero = ['<span class="kicker">%s</span>' % inline(p["kicker"]), "<h1>%s</h1>" % inline(p["h1"])]
    hero += ['<p class="lede">%s</p>' % inline(x) for x in p["lead"]]
    if p.get("badges"):
        hero.append('<ul class="fa-badges">%s</ul>' % "".join("<li>%s</li>" % inline(b) for b in p["badges"]))
    ctas = []
    if p.get("cta_primary"):
        ctas.append('<a class="btn" href="%s">%s</a>' % (esc(p["cta_primary"]["href"]), inline(p["cta_primary"]["text"])))
    if p.get("cta_secondary"):
        ctas.append('<a class="btn ghost" href="%s">%s</a>' % (esc(p["cta_secondary"]["href"]), inline(p["cta_secondary"]["text"])))
    if ctas:
        hero.append('<div class="hero-ctas">%s</div>' % "".join(ctas))
    if p.get("last_checked"):
        hero.append('<p class="hero-note">%s</p>' % inline(p["last_checked"]))

    body = []
    for s in p["sections"]:
        sid = ' id="%s"' % s["id"] if s.get("id") else ""
        body.append('<section class="blk"%s><div class="wrap fa-prose"><h2>%s</h2>%s</div></section>'
                    % (sid, inline(s["h2"]), "".join(block(b) for b in s["blocks"])))
    if p.get("faq"):
        qa = "".join("<details><summary>%s</summary><p>%s</p></details>" % (inline(f["q"]), inline(f["a"])) for f in p["faq"])
        body.append('<section class="blk"><div class="wrap fa-prose"><h2>پرسش‌های رایج</h2>%s</div></section>' % qa)
    if p.get("sources"):
        src = "".join('<li><a href="%s" target="_blank" rel="noopener"><bdi>%s</bdi></a></li>' % (esc(s["url"]), esc(s["title"])) for s in p["sources"])
        body.append('<section class="blk"><div class="wrap fa-prose"><h2>منابع</h2><ul class="fa-list src" dir="ltr">%s</ul></div></section>' % src)
    c = p["cta_final"]
    body.append('<div class="wrap"><div class="cta-band"><h2>%s</h2><p>%s</p><a class="btn" href="%s">%s</a></div></div>'
                % (inline(c["title"]), inline(c["text"]), esc(c["href"]), inline(c["button"])))

    foot_links = "".join('<li><a href="%s">%s</a></li>' % (h, l) for h, l in NAV)
    foot_levels = "".join('<li><a href="%s">%s</a></li>' % (h, inline(l)) for h, l in LEVELS)
    return f"""<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- Text: written by Claude (fa-pages-phase1-v3). Do not edit the wording here; regenerate from the copy file. -->
<title>{esc(p["title"])}</title>
<meta name="description" content="{esc(p["meta_description"])}">
<link rel="canonical" href="{url}">
{hreflang}<meta property="og:locale" content="fa_IR">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Muse English">
<meta property="og:title" content="{esc(p["title"])}">
<meta property="og:description" content="{esc(p["meta_description"])}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/icons/icon-512.png">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/icons/icon-192.png">
<link rel="preload" href="/fa/fonts/Vazirmatn-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fa/assets/fa.css?v=4">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
{HOTJAR}
</head>
<body>
<header class="fa-head"><div class="wrap fa-head-in">
<a class="fa-brand" href="/fa/"><img src="/icons/icon-192.png" alt="" width="38" height="38"><bdi>Muse English</bdi></a>
<nav class="fa-nav" aria-label="صفحه‌های فارسی">{nav}</nav>
<a class="head-link" href="/#/signin">ورود</a>
<a class="head-link" href="/en/" lang="en" hreflang="en" data-home-lang="en">EN</a>
<a class="btn sm head-cta" href="/#/signup">ثبت‌نام رایگان</a>
</div></header>
<main>
<div class="hero"><div class="wrap"><div class="hero-grid">
<div>{"".join(hero)}</div>
<div class="hero-art"><img src="{HERO_IMG[path]}" alt="" width="300" height="300"></div>
</div></div></div>
{chr(10).join(body)}
</main>
<footer class="fa-foot"><div class="wrap">
<div class="foot-grid">
<div><h4>یادگیری</h4><ul><li><a href="/blog/">درس‌های روزانه</a></li><li><a href="/blog/grammar/">راهنماهای گرامر</a></li><li><a href="/blog/vocabulary/">لغت‌ها بر اساس موضوع</a></li></ul></div>
<div><h4>سطح‌ها</h4><ul>{foot_levels}</ul></div>
<div><h4>صفحه‌های فارسی</h4><ul>{foot_links}</ul></div>
<div><h4><bdi>Muse English</bdi></h4><ul><li><a href="/en/" lang="en" hreflang="en" data-home-lang="en"><bdi>English</bdi> (نسخهٔ انگلیسی سایت)</a></li><li><a href="/about/">دربارهٔ ما</a></li><li><a href="/#/signup">ثبت‌نام رایگان</a></li><li><a href="mailto:info@museenglishapp.com"><bdi>info@museenglishapp.com</bdi></a></li></ul></div>
</div>
<div class="foot-base">© ۲۰۲۶ <bdi>Muse English</bdi></div>
</div></footer>
<script>
/* Language choice: remember it so a bare museenglishapp.com opens that home next time. */
document.addEventListener('click', function (e) {{
  var a = e.target.closest && e.target.closest('[data-home-lang]');
  if (a) {{ try {{ localStorage.setItem('muse_home_lang', a.getAttribute('data-home-lang')); }} catch (err) {{}} }}
}});
</script>
</body>
</html>
"""

for p in PAGES:
    out = os.path.join(REPO, p["path"].strip("/"), "index.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(page(p))
    print("wrote", out)
