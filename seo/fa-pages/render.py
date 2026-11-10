"""Render Claude's Persian copy (content.py) into the /fa/ pages, using the
SAME visual system as the English landing (its CSS, icons, mascots, phone
mock-up, level/topic/grammar cards, dark CTA band, dark footer), in RTL.
Usage: python3 render.py /path/to/repo
Writes fa/**/index.html and fa/assets/fa-site.css (generated from index.html)."""
import hashlib, html, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from content import PAGES, SITE

REPO = sys.argv[1]
ROOT = open(os.path.join(REPO, "index.html"), encoding="utf-8").read()
LANDING = ROOT.split("<!-- LANDING:START -->", 1)[1].split("<!-- LANDING:END -->", 1)[0]
HOTJAR = "<!-- Hotjar Tracking Code" + ROOT.split("<!-- Hotjar Tracking Code", 1)[1].split("</script>", 1)[0] + "</script>"

HEAD_NAV = [("/fa/", "خانه"), ("/blog/", "درس‌ها"), ("/blog/vocabulary/", "لغت‌ها"), ("/blog/grammar/", "گرامر"),
            ("/fa/ielts/", "آیلتس"), ("/fa/mohajerat/", "مهاجرت به کانادا"), ("/fa/az-sefr/", "شروع از صفر")]
FA_PAGES = [("/fa/", "صفحهٔ اصلی"), ("/fa/ielts/", "آزمون آزمایشی آیلتس"),
            ("/fa/mohajerat/", "مهاجرت به کانادا"), ("/fa/az-sefr/", "شروع از صفر")]
LEVELS = [("/blog/a1/", "A1، مبتدی"), ("/blog/a2/", "A2، مقدماتی"), ("/blog/b1/", "B1، متوسط"),
          ("/blog/b2/", "B2، بالاتر از متوسط"), ("/blog/c1/", "C1، پیشرفته"), ("/blog/c2/", "C2، تسلط کامل")]
CRUMB = {"/fa/": "صفحهٔ اصلی", "/fa/ielts/": "آزمون آزمایشی آیلتس",
         "/fa/mohajerat/": "زبان انگلیسی برای مهاجرت به کانادا", "/fa/az-sefr/": "آموزش زبان انگلیسی از صفر"}
# Card icons (the English landing's own illustrations), picked by the card title.
ICONS = [("پادکست", "icon-podcast"), ("تلفظ", "icon-shadow"), ("چکاپ گرامر", "icon-grammar"), ("راهنمای گرامر", "lvl-b1-book"),
         ("گرامر", "icon-grammar"), ("آزمون آزمایشی", "icon-quiz"), ("آزمون", "icon-quiz"), ("معنی فارسی", "icon-photos"),
         ("فارسی به انگلیسی", "icon-quiz2"), ("شروع به فارسی", "lvl-a1-bubble"), ("استاد", "icon-teacher"),
         ("مرور فاصله‌دار", "icon-streak"), ("مرور اشتباه", "mistake-chips"), ("Tricky", "icon-target"), ("لغت", "icon-words")]
TOPIC_EN = {}
for _m in re.finditer(r'<a class="ltopic-card"[^>]*href="([^"]+)"[^>]*>.*?<b>(.*?)</b>', LANDING, re.S):
    TOPIC_EN[_m.group(1)] = html.unescape(_m.group(2))

# ---------------------------------------------------------------- text helpers
_W = r"[A-Za-z0-9]*(?:[.&'’+\-][A-Za-z0-9]+)*"
LATIN = re.compile(r"[A-Za-z]" + _W + r"(?:,? [A-Za-z0-9]" + _W + r")*")
B0, B1 = "", ""

def bdi(raw):
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
        attrs = ' target="_blank" rel="noopener"' if url.startswith("http") else ""
        body = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", html.escape(bdi(text), quote=False))
        return '<a href="%s"%s>%s</a>' % (html.escape(url), attrs, body)
    t = re.sub("(\\d+)", put, t)
    return t.replace(B0, "<bdi>").replace(B1, "</bdi>")

def esc(s):
    return html.escape(s, quote=True)

def icon_for(title):
    for k, v in ICONS:
        if k in title:
            return v
    return "icon-words"

def split_item(item):
    """'**Title:** description' -> (title, description)."""
    m = re.match(r"^\*\*(.+?)[:：]\*\*\s*(.*)$", item, re.S)
    return (m.group(1), m.group(2)) if m else (None, item)

def h1_html(h1):
    for sep in ("، ", ": ", "؛ "):
        if sep in h1:
            a, b = h1.split(sep, 1)
            return '%s%s<br><span class="org">%s</span>' % (inline(a), sep.strip(), inline(b))
    return inline(h1)

# ---------------------------------------------------------------- blocks
def feature_cards(items):
    out = []
    for it in items:
        title, desc = split_item(it)
        out.append('<div class="lstep lfa-feat"><img src="/media/landing/%s.webp" alt="" loading="lazy"><h3>%s</h3><p>%s</p></div>'
                   % (icon_for(title), inline(title), inline(desc)))
    cls = "lsteps lfa-feats" + (" lfa-five" if len(items) == 5 else "") + (" lfa-six" if len(items) == 6 else "")
    return '<div class="%s">%s</div>' % (cls, "".join(out))

def level_cards(items):
    out = []
    for i in items:
        lv = i["href"].strip("/").split("/")[-1]
        code, name = i["title"].split("، ", 1)
        out.append('<a class="llevel-card llevel-%s" href="%s"><span class="llvl llvl-%s">%s</span><h3>%s</h3><p>%s</p></a>'
                   % (lv, esc(i["href"]), lv, code, inline(name), inline(i["desc"])))
    return '<div class="llevel-grid">%s</div>' % "".join(out)

def is_cards(b):
    return b["type"] == "list" and all(split_item(x)[0] for x in b["items"])

def block(b):
    t = b["type"]
    if t == "p":
        return "<p>%s</p>" % inline(b["text"])
    if t == "note":
        return '<div class="lfa-note"><p>%s</p></div>' % inline(b["text"])
    if t == "list":
        if is_cards(b):
            return feature_cards(b["items"])
        return '<ul class="lfa-list">%s</ul>' % "".join("<li>%s</li>" % inline(i) for i in b["items"])
    if t == "steps":
        return '<ol class="lfa-steps">%s</ol>' % "".join("<li>%s</li>" % inline(i) for i in b["items"])
    if t == "table":
        head = "".join("<th>%s</th>" % inline(h) for h in b["head"])
        rows = "".join("<tr>%s</tr>" % "".join("<td>%s</td>" % inline(c) for c in r) for r in b["rows"])
        return '<div class="lfa-tbl"><table><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>' % (head, rows)
    if t == "links":
        if all(re.match(r"^/blog/[abc][12]/$", i["href"]) for i in b["items"]):
            return level_cards(b["items"])
        return '<div class="lgram-grid">%s</div>' % "".join(
            '<a class="lgram-card" href="%s"><img class="lfa-gico" src="/media/landing/icon-grammar.webp" alt="" loading="lazy">'
            '<span><b>%s</b><span>%s</span></span></a>' % (esc(i["href"]), inline(i["title"]), inline(i["desc"])) for i in b["items"])
    if t == "chips":
        return '<div class="ltopic-grid">%s</div>' % "".join(
            '<a class="ltopic-card" href="%s"><img src="/media/landing/topics/topic-%s.webp" alt="" '
            'onerror="this.onerror=null;this.src=\'/media/landing/icon-words.webp\'"><span><b>%s</b><span dir="ltr">%s</span></span></a>'
            % (esc(i["href"]), i["href"].rstrip("/").split("/")[-1], inline(i["text"]), esc(TOPIC_EN.get(i["href"], "")))
            for i in b["items"])
    raise ValueError(t)

LINK_ONLY = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")

def section(s, alt=False):
    sid = ' id="%s"' % s["id"] if s.get("id") else ""
    blocks = list(s["blocks"])
    sub = see = ""
    if blocks and blocks[0]["type"] == "p" and len(blocks) > 1 and not is_prose(blocks[1:]):
        sub = '<p class="lsec-sub">%s</p>' % inline(blocks.pop(0)["text"])
    if blocks and blocks[-1]["type"] == "p" and LINK_ONLY.fullmatch(blocks[-1]["text"].strip()):
        m = LINK_ONLY.fullmatch(blocks.pop()["text"].strip())
        see = '<a class="lsee" href="%s">%s ←</a>' % (esc(m.group(2)), inline(m.group(1)))
    inner = "".join(block(b) for b in blocks)
    if is_prose(blocks):
        inner = '<div class="lfa-prose">%s</div>' % inner
    head = '<div class="lsec-head"><div><h2>%s</h2>%s</div>%s</div>' % (inline(s["h2"]), sub, see)
    return '<section class="lsec%s"%s><div class="lwrap">%s%s</div></section>' % (" lfa-alt" if alt else "", sid, head, inner)

def is_prose(blocks):
    return any(b["type"] in ("note", "table", "steps") or (b["type"] == "list" and not is_cards(b)) for b in blocks) or \
        (blocks and all(b["type"] == "p" for b in blocks))

# ---------------------------------------------------------------- page parts
def today_section(t):
    m = re.search(r'<div class="ltoday-grid">.*?</a></div>', LANDING, re.S)
    grid = m.group(0) if m else '<div class="ltoday-grid"></div>'
    grid = grid.replace('class="ltoday-body"', 'class="ltoday-body" dir="ltr"')
    return ('<section class="lsec" id="today"><div class="lwrap"><div class="lsec-head"><div><h2>%s</h2><p class="lsec-sub">%s</p></div>'
            '<a class="lsee" href="%s">%s</a></div>%s</div></section>') % (inline(t["h2"]), inline(t["sub"]), esc(t["href"]), inline(t["see"]), grid)

def hero_visual(p):
    if p["path"] == "/fa/":
        phone = re.search(r'<div class="lphone">.*?</div></div></div>', LANDING, re.S).group(0)
        hand = "<br>".join(esc(x) for x in p.get("hand", []))
        return ('<div class="lhero-visual"><div dir="ltr" class="lfa-phone">%s</div>'
                '<img class="lmascot" src="/media/landing/mascot-hero.webp" alt="" width="200" height="200">'
                '<div class="lhand">%s</div></div>') % (phone, hand)
    img = p.get("hero_img", "/media/landing/mascot-cta.webp")
    kind = "lfa-art" if "/why-" in img else "lfa-cut"
    return '<div class="lhero-visual lfa-visual"><img class="%s" src="%s" alt="" loading="eager"></div>' % (kind, esc(img))

REFRESH = """
/* Keep today's lessons + the phone card fresh from '/' (the landing generator updates it daily). */
(function () {
  try {
    fetch('/', { cache: 'no-cache' }).then(function (r) { return r.text(); }).then(function (h) {
      var d = new DOMParser().parseFromString(h, 'text/html');
      var g = d.querySelector('#landing #today .ltoday-grid'), cur = document.querySelector('#today .ltoday-grid');
      if (g && cur) { g.querySelectorAll('.ltoday-body').forEach(function (b) { b.setAttribute('dir', 'ltr'); }); cur.replaceWith(document.importNode(g, true)); }
      var ph = d.querySelector('#landing .lphone'), curp = document.querySelector('.lfa-phone .lphone');
      if (ph && curp) curp.replaceWith(document.importNode(ph, true));
    }).catch(function () {});
  } catch (e) {}
})();"""

def page(p, css_v):
    path = p["path"]; url = SITE + path; home = path == "/fa/"
    nav = "".join('<a href="%s"%s>%s</a>' % (h, ' aria-current="page"' if h == path else "", l) for h, l in HEAD_NAV)
    hreflang = ""
    if home:
        hreflang = ('<link rel="alternate" hreflang="en" href="%s/en/">\n<link rel="alternate" hreflang="fa" href="%s/fa/">\n'
                    '<link rel="alternate" hreflang="x-default" href="%s/">\n') % (SITE, SITE, SITE)
    crumbs = [{"@type": "ListItem", "position": 1, "name": CRUMB["/fa/"], "item": SITE + "/fa/"}]
    if not home:
        crumbs.append({"@type": "ListItem", "position": 2, "name": CRUMB[path], "item": url})
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": url + "#webpage", "url": url, "name": p["title"], "description": p["meta_description"],
         "inLanguage": "fa", "isPartOf": {"@type": "WebSite", "@id": SITE + "/#website", "name": "Muse English", "url": SITE + "/"}},
        {"@type": "BreadcrumbList", "itemListElement": crumbs}]}
    if p.get("last_checked"):
        ld["@graph"][0]["dateModified"] = "2026-11-10"

    sub = p.get("sub") or " ".join(p["lead"])
    copy = ['<span class="lbadge">☀️ %s</span>' % inline(p["kicker"]), "<h1>%s</h1>" % h1_html(p["h1"]), '<p class="lsub">%s</p>' % inline(sub)]
    if p.get("last_checked"):
        copy.append('<p class="lfa-checked">%s</p>' % inline(p["last_checked"]))
    ctas = []
    if p.get("cta_primary"):
        ctas.append('<a class="lcta-primary" href="%s">%s ←</a>' % (esc(p["cta_primary"]["href"]), inline(p["cta_primary"]["text"])))
    if p.get("cta_secondary"):
        ctas.append('<a class="lcta-secondary" href="%s">%s</a>' % (esc(p["cta_secondary"]["href"]), inline(p["cta_secondary"]["text"])))
    if ctas:
        copy.append('<div class="lctas">%s</div>' % "".join(ctas))
    if p.get("hero_note"):
        copy.append('<p class="lfa-hnote">%s</p>' % inline(p["hero_note"]))
    if p.get("stats"):
        copy.append('<div class="lstats">%s</div>' % "".join(
            '<div class="lstat"><img src="/media/landing/%s.webp" alt=""><span><b>%s</b><span>%s</span></span></div>' % (ic, inline(b), inline(s))
            for ic, b, s in p["stats"]))
    hero = ('<section class="lhero"><div class="lwrap"><div class="lhero-grid"><div class="lhero-copy">%s</div>%s</div></div></section>'
            % ("".join(copy), hero_visual(p)))

    body = []
    if home and p.get("today"):
        body.append(today_section(p["today"]))
    for n, s in enumerate(p["sections"]):
        body.append(section(s, alt=(n % 2 == 0)))
    if p.get("faq"):
        qa = "".join("<details><summary>%s</summary><p>%s</p></details>" % (inline(f["q"]), inline(f["a"])) for f in p["faq"])
        body.append('<section class="lsec%s" id="faq"><div class="lwrap"><div class="lsec-head"><div><h2>پرسش‌های رایج</h2></div></div>'
                    '<div class="lfa-prose lfa-faq">%s</div></div></section>' % (" lfa-alt" if len(p["sections"]) % 2 == 0 else "", qa))
    if p.get("sources"):
        src = "".join('<li><a href="%s" target="_blank" rel="noopener">%s</a></li>' % (esc(s["url"]), esc(s["title"])) for s in p["sources"])
        body.append('<section class="lsec lfa-src"><div class="lwrap"><div class="lsec-head"><div><h2>منابع</h2></div></div>'
                    '<ul class="lfa-list" dir="ltr">%s</ul></div></section>' % src)
    c = p["cta_final"]
    body.append('<section class="lsec lfa-bandsec"><div class="lwrap"><div class="lcta-sec"><div class="lcta-in">'
                '<img class="lcta-mascot" src="/media/landing/mascot-cta.webp" alt="">'
                '<div><h2>%s</h2><p>%s</p><div class="lctas lfa-bandctas"><a class="lcta-primary" href="%s">%s ←</a></div></div>'
                '</div></div></div></section>' % (inline(c["title"]), inline(c["text"]), esc(c["href"]), inline(c["button"])))

    foot = ('<footer class="lfoot"><div class="lfoot-grid">'
            '<div class="lfoot-col"><div class="lfoot-brand"><img src="/icons/icon-192.png" alt=""><bdi>Muse English</bdi></div>'
            '<p class="lfa-foot-mail"><a href="mailto:info@museenglishapp.com"><bdi>info@museenglishapp.com</bdi></a></p></div>'
            '<div class="lfoot-col"><h4>یادگیری</h4><ul><li><a href="/blog/">درس‌های روزانه</a></li><li><a href="/blog/vocabulary/">لغت‌ها بر اساس موضوع</a></li><li><a href="/blog/grammar/">راهنماهای گرامر</a></li></ul></div>'
            '<div class="lfoot-col"><h4>سطح‌ها</h4><ul>%s</ul></div>'
            '<div class="lfoot-col"><h4>صفحه‌های فارسی</h4><ul>%s</ul></div>'
            '<div class="lfoot-col"><h4><bdi>Muse English</bdi></h4><ul><li><a href="/en/" lang="en" hreflang="en" data-home-lang="en"><bdi>English</bdi></a></li>'
            '<li><a href="/about/">دربارهٔ ما</a></li><li><a href="/#/signin">ورود</a></li><li><a href="/#/signup">ثبت‌نام رایگان</a></li></ul></div>'
            '</div><div class="lfoot-base">© ۲۰۲۶ <bdi>Muse English</bdi></div></footer>') % (
        "".join('<li><a href="%s">%s</a></li>' % (h, inline(l)) for h, l in LEVELS),
        "".join('<li><a href="%s">%s</a></li>' % (h, l) for h, l in FA_PAGES))
    refresh = REFRESH if home else ""
    return f"""<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#FF9600">
<!-- Text: written by Claude (seo/fa-pages/content.py). Layout: the English landing's design system. Regenerate with seo/fa-pages/render.py; don't hand-edit. -->
<title>{esc(p["title"])}</title>
<meta name="description" content="{esc(p["meta_description"])}">
<link rel="canonical" href="{url}">
{hreflang}<meta property="og:locale" content="fa_IR">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Muse English">
<meta property="og:title" content="{esc(p["title"])}">
<meta property="og:description" content="{esc(p["meta_description"])}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/media/landing/mascot-cta.webp">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="preload" href="/fa/fonts/Vazirmatn-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fa/assets/fa-site.css?v={css_v}">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
{HOTJAR}
</head>
<body>
<div id="landing">
<header class="lnav"><div class="lnav-in">
<a class="lbrand" href="/fa/"><img src="/icons/icon-192.png" alt="" width="34" height="34"><bdi>Muse English</bdi></a>
<nav class="lnav-links" aria-label="منوی اصلی">{nav}</nav>
<div class="lfa-acts"><a class="lfa-alink" href="/#/signin">ورود</a><a class="lfa-alink" href="/en/" lang="en" hreflang="en" data-home-lang="en">EN</a><a class="lnav-cta" href="/#/signup">شروع رایگان</a></div>
</div></header>
<main>
{hero}
{chr(10).join(body)}
</main>
{foot}
</div>
<script>
/* Language choice: remember it so a bare museenglishapp.com opens that home next time. */
document.addEventListener('click', function (e) {{
  var a = e.target.closest && e.target.closest('[data-home-lang]');
  if (a) {{ try {{ localStorage.setItem('muse_home_lang', a.getAttribute('data-home-lang')); }} catch (err) {{}} }}
}});{refresh}
</script>
</body>
</html>
"""

# ---------------------------------------------------------------- stylesheet
RTL_CSS = """
/* ===== Persian / RTL layer (Claude, 2026-11-10) ===== */
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:#fff}
img{max-width:100%}
#landing{font-family:"Vazirmatn",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;line-height:1.85}
#landing h1,#landing h2,#landing h3{font-family:"Fredoka","Vazirmatn",system-ui,sans-serif;letter-spacing:0}
#landing .lhero h1{line-height:1.4;font-size:clamp(30px,4.4vw,52px)}
#landing .lsec h2{line-height:1.5}
bdi{unicode-bidi:isolate}
.lnav-in{gap:18px}
.lnav-links{margin-left:0;margin-inline-start:auto;gap:16px}
.lnav-links a[aria-current="page"]{color:#E8590C;font-weight:700}
.lfa-acts{display:flex;align-items:center;gap:6px}
.lfa-alink{color:#4a5568!important;text-decoration:none;font-weight:700;font-size:14.5px;padding:6px 8px;border-radius:10px}
.lfa-alink:hover{background:#FFF3E2;color:#E8590C!important}
.lhero .lsub{max-width:560px}
.lfa-hnote{margin:-18px 0 26px;color:#8a6a3a;font-size:14px}
.lfa-checked{display:inline-block;background:#fff;border:1px solid #f5e3c2;border-radius:12px;padding:6px 12px;font-size:13.5px;color:#8a6a3a;margin:-12px 0 24px}
.lstats{justify-content:start}
.lhero-visual.lfa-visual{min-height:0;align-items:center}
.lhero-visual.lfa-visual img.lfa-art{width:min(440px,84vw);border-radius:32px;box-shadow:0 30px 60px rgba(255,140,0,.25),0 6px 18px rgba(0,0,0,.12)}
.lhero-visual.lfa-visual img.lfa-cut{width:auto;max-height:440px;max-width:80vw;filter:drop-shadow(0 22px 40px rgba(255,140,0,.32))}
@media(max-width:760px){.lhero-visual.lfa-visual img.lfa-art{width:min(320px,80vw)}.lhero-visual.lfa-visual img.lfa-cut{max-height:300px}}
.lfa-phone{position:relative;z-index:2}
.lhand{display:none}
.lmascot{right:auto;left:-3%;width:min(170px,40vw)}
#landing .lfoot a{color:#cbd5e1}
#landing .lfoot a:hover{color:#fff}
.lsec.lfa-alt{background:#FFF9F1}
.lsec-head .lsee{align-self:center}
.lfa-feats{grid-template-columns:repeat(4,1fr)}
.lfa-feats.lfa-five{grid-template-columns:repeat(5,1fr)}
.lfa-feats.lfa-six{grid-template-columns:repeat(3,1fr)}
.lfa-feat{text-align:start;background:#fff}
.lfa-feat p a{font-weight:600}
.lfa-gico{width:42px;height:42px;object-fit:contain;flex:none}
.ltopic-card{min-width:0}
.ltopic-card b{overflow-wrap:anywhere}
.llevel-card p{line-height:1.6}
.lfa-prose{max-width:860px;font-size:16.5px;color:#2b3443}
.lfa-prose>p{margin:0 0 16px}
.lfa-prose a{font-weight:600}
.lfa-list{margin:0 0 18px;padding-inline-start:1.3em}
.lfa-list li{margin:0 0 10px}
.lfa-list li::marker{color:#FF9600}
.lfa-note{background:#FFF3E2;border:1.5px dashed #FF9600;border-radius:18px;padding:16px 20px;margin:16px 0 20px}
.lfa-note p{margin:0}
.lfa-steps{list-style:none;counter-reset:s;margin:0 0 18px;padding:0;display:grid;gap:12px}
.lfa-steps li{counter-increment:s;position:relative;background:#fff;border:1px solid #f3e9d8;border-radius:18px;padding:16px 20px;padding-inline-start:66px}
.lfa-steps li::before{content:counter(s,persian);position:absolute;inset-inline-start:18px;top:15px;width:34px;height:34px;border-radius:50%;background:#FF9600;color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 4px 12px rgba(255,150,0,.35)}
.lfa-tbl{overflow-x:auto;background:#fff;border:1px solid #f3e9d8;border-radius:18px;margin:16px 0;box-shadow:0 4px 14px rgba(0,0,0,.04)}
.lfa-tbl table{border-collapse:collapse;width:100%;font-size:15px}
.lfa-tbl th,.lfa-tbl td{padding:11px 12px;text-align:center;border-bottom:1px solid #f6ecdc;white-space:nowrap}
.lfa-tbl th{background:#FFF3E2;color:#9a4a00;font-weight:800}
.lfa-tbl td:first-child,.lfa-tbl th:first-child{font-weight:800;color:#E8590C}
.lfa-tbl tr:last-child td{border-bottom:0}
.lfa-faq details{background:#fff;border:1px solid #f3e9d8;border-radius:16px;padding:14px 18px;margin-bottom:10px}
.lfa-faq details[open]{border-color:#FFC27A}
.lfa-faq summary{font-weight:700;cursor:pointer}
.lfa-faq details p{color:#5b6472;margin:8px 0 2px}
.lfa-src .lfa-list{font-size:14.5px}
.lcta-sec .lctas{margin:0}
.lfa-bandsec{padding-top:24px}
.lfa-foot-mail a{font-size:14px}
@media(max-width:1020px){.lfa-feats,.lfa-feats.lfa-five,.lfa-feats.lfa-six{grid-template-columns:repeat(2,1fr)}}
@media(max-width:760px){
  .lnav-in{flex-wrap:wrap;row-gap:4px;padding-bottom:6px}
  .lnav-links{display:flex;order:3;width:100%;margin:0;overflow-x:auto;flex-wrap:nowrap;gap:4px;scrollbar-width:none}
  .lnav-links::-webkit-scrollbar{display:none}
  .lnav-links a{white-space:nowrap;padding:5px 9px;font-size:14px}
  .lfa-acts{margin-inline-start:auto}
  .lstats{justify-content:center}
  .lfa-hnote,.lfa-checked{margin-top:-14px}
  .lmascot{left:2%;right:auto;width:118px}
  .lfa-tbl table{font-size:12.5px}
  .lfa-tbl th,.lfa-tbl td{padding:9px 4px}
  .ltopic-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .lsec{padding:44px 0}
}
@media(max-width:520px){.lfa-feats,.lfa-feats.lfa-five,.lfa-feats.lfa-six{grid-template-columns:1fr}.lbrand bdi{display:none}.lnav-cta{padding:8px 14px;font-size:14px}.ltopic-card span span{display:none}}
"""

def build_css():
    st = re.search(r"<style>\s*(/\* ---- Muse English landing.*?)</style>", ROOT, re.S).group(1)
    st = st.replace("html.app-mode #landing{display:none!important}", "").replace("html:not(.app-mode) #splash{display:none!important}", "")
    fonts = "".join("@font-face{font-family:'Vazirmatn';src:url('/fa/fonts/Vazirmatn-%s.woff2') format('woff2');font-weight:%d;font-style:normal;font-display:swap}\n" % (n, w)
                    for n, w in (("Regular", 400), ("Medium", 500), ("Bold", 700), ("ExtraBold", 800)))
    fonts += '@font-face{font-family:"Fredoka";src:url("/fonts/fredoka-700.woff2") format("woff2");font-weight:500 700;font-display:swap}\n'
    return "/* Generated by seo/fa-pages/render.py from the root landing CSS + an RTL layer. Don't hand-edit. */\n" + fonts + st + RTL_CSS

if __name__ == "__main__":
    css = build_css()
    css_v = hashlib.sha1(css.encode()).hexdigest()[:8]
    open(os.path.join(REPO, "fa", "assets", "fa-site.css"), "w", encoding="utf-8").write(css)
    for p in PAGES:
        out = os.path.join(REPO, p["path"].strip("/"), "index.html")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, "w", encoding="utf-8").write(page(p, css_v))
        print("wrote", out)
    print("css", css_v, len(css))
