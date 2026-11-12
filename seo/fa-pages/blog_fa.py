"""Persian chrome for the generated blog pages (phase 1 of the Persian-first site).

The daily lesson job, the vocabulary builder and the grammar renderer write
English pages. This post-processor rewrites everything AROUND the learning
content into Persian (RTL): menus, footers, breadcrumbs, headings, buttons,
labels, titles/meta, and adds the Persian meaning next to every word. The
learning content itself (words, examples, podcast transcript, shadowing
sentences, grammar explanations/exercises) stays English and LTR.

Run after EVERY generation step (daily job, vocabulary rebuild, grammar rebuild):
    python3 seo/fa-pages/blog_fa.py .
It is idempotent: running it twice changes nothing; running it after the job
re-wrote a line in English converts that line again.

Text: written by Claude for Alireza. Don't edit the Persian wording; ask.
"""
import glob, html, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grammar_fa as GF

REPO = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
CSS_HREF = "/fa/assets/blog-fa.css?v=3"
MARK = '<meta name="muse-lang" content="fa">'
UNKNOWN = set()

FA_DIG = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
def fa(n):
    return str(n).translate(FA_DIG)

LV_FA = {"a1": "مبتدی", "a2": "مقدماتی", "b1": "متوسط", "b2": "بالاتر از متوسط", "c1": "پیشرفته", "c2": "تسلط کامل"}
LV_DESC = {
    "a1": "شروع از صفر: کلمه‌ها و جمله‌های پایه.",
    "a2": "گفت‌وگوهای کوتاه روزمره و گرامر ضروری.",
    "b1": "موضوع‌های واقعی و گفت‌وگوهای طولانی‌تر.",
    "b2": "کار، فرهنگ و بیان نظر.",
    "c1": "انگلیسی روان و دقیق، حتی در موضوع‌های پیچیده.",
    "c2": "ظرافت‌های زبان، در حد انگلیسی‌زبان‌ها.",
}

def norm(s):
    s = html.unescape(re.sub(r"<[^>]+>", "", s)).strip().lower()
    s = s.replace(" and ", " & ").replace("—", "-").replace("–", "-")
    return re.sub(r"\s+", " ", s)

# Full lesson themes (lesson JSON "theme" / lesson H1), normalised.
THEMES = {
    "review day": "روز مرور", "technology": "فناوری", "emotions & character": "احساسات و شخصیت",
    "travel & transport": "سفر و حمل‌ونقل", "food & cooking": "غذا و آشپزی", "money & shopping": "پول و خرید",
    "shopping & money": "خرید و پول", "health & body": "سلامت و بدن", "work & career": "کار و حرفه",
    "work & careers": "کار و حرفه", "nature & environment": "طبیعت و محیط زیست", "sports & fitness": "ورزش و تناسب اندام",
    "cities & daily life": "شهر و زندگی روزمره", "education & learning": "آموزش و یادگیری",
    "family & relationships": "خانواده و روابط", "housing & renting": "مسکن و اجاره", "fashion & style": "مد و استایل",
    "colors": "رنگ‌ها", "rooms of the house": "اتاق‌های خانه", "telling the time": "گفتن ساعت",
    "clothes & accessories": "لباس و اکسسوری", "basics (numbers)": "پایه: عددها", "days & dates": "روزها و تاریخ‌ها",
    "the art of learning": "هنر یادگیری", "travel & holidays": "سفر و تعطیلات",
    "nature & environment - pets": "طبیعت و محیط زیست: حیوانات خانگی", "my home": "خانهٔ من",
    "colors & numbers": "رنگ‌ها و عددها", "my body": "بدن من", "nature basics": "طبیعت: پایه",
    "food & kitchen": "غذا و آشپزخانه", "success & daily life": "موفقیت و زندگی روزمره", "body signals": "نشانه‌های بدن",
    "education & school life": "آموزش و زندگی مدرسه", "everyday technology": "فناوری روزمره",
    "daily routines": "کارهای روزانه", "city life": "زندگی شهری", "feelings & character": "احساسات و شخصیت",
    "culture & ideas": "فرهنگ و ایده‌ها", "the modern workplace": "محیط کار امروزی",
    "money & shopping: the language of wealth & risk": "پول و خرید: زبان ثروت و ریسک",
    "travel & transport: wayfarers & waystations": "سفر و حمل‌ونقل: مسافران و ایستگاه‌ها",
    "the science of training": "علم تمرین", "emotions & character: the inner weather": "احساسات و شخصیت: آب‌وهوای درون",
    "the strong, healthy body": "بدن قوی و سالم", "technology & society": "فناوری و جامعه",
    "money & shopping: the art of spending smart": "پول و خرید: هنر هوشمندانه خرج کردن",
    "economics & finance": "اقتصاد و امور مالی",
}
# Short labels on the level-page cards ("Family words: …").
SHORT = {
    "review day": "مرور", "travel": "سفر", "technology": "فناوری", "emotions": "احساسات", "food": "غذا",
    "money": "پول", "work": "کار", "nature": "طبیعت", "health": "سلامت", "sports": "ورزش", "education": "آموزش",
    "cities": "شهر", "family": "خانواده", "housing": "مسکن", "fashion": "مد", "colors": "رنگ‌ها",
    "telling the time": "ساعت", "days": "روزها", "rooms of the house": "اتاق‌های خانه", "basics (numbers)": "عددها",
    "clothes": "لباس", "the art of learning": "هنر یادگیری", "shopping": "خرید", "my home": "خانهٔ من",
    "nature basics": "طبیعت", "my body": "بدن من", "success": "موفقیت", "everyday technology": "فناوری روزمره",
    "body signals": "نشانه‌های بدن", "daily routines": "کارهای روزانه", "feelings": "احساسات", "city life": "زندگی شهری",
    "culture": "فرهنگ", "the science of training": "علم تمرین", "the strong, healthy body": "بدن قوی و سالم",
    "the modern workplace": "محیط کار امروزی", "economics": "اقتصاد",
}
# Vocabulary hub topics (display names, normalised) and their slugs.
TOPICS = {
    "body & health": "بدن و سلامت", "city & daily life": "شهر و زندگی روزمره", "education": "آموزش و تحصیل",
    "family & relationships": "خانواده و روابط", "feelings & personality": "احساسات و شخصیت",
    "food & drink": "غذا و نوشیدنی", "home & housing": "خانه و مسکن", "nature & animals": "طبیعت و حیوانات",
    "shopping & money": "خرید و پول", "sports & hobbies": "ورزش و سرگرمی", "technology": "فناوری",
    "travel & transport": "سفر و حمل‌ونقل", "weather & environment": "آب‌وهوا و محیط زیست", "work & jobs": "کار و شغل",
}

def theme_fa(s):
    n = norm(s)
    if n in THEMES:
        return THEMES[n]
    UNKNOWN.add("theme: " + n)
    return None

def bdi(s):
    return "<bdi>%s</bdi>" % s

# ---------------------------------------------------------------- word meanings
_WORDS = None
def words_fa():
    global _WORDS
    if _WORDS is None:
        _WORDS = {}
        try:
            for w in json.load(open(os.path.join(REPO, "data/vocab/words.json"), encoding="utf-8")):
                if w.get("meaning_fa"):
                    _WORDS.setdefault(w["word"].strip().lower(), w["meaning_fa"].strip())
        except Exception:
            pass
    return _WORDS

def lesson_json(level, date):
    try:
        return json.load(open(os.path.join(REPO, "lessons", level, date + ".json"), encoding="utf-8"))
    except Exception:
        return {}

# ---------------------------------------------------------------- shared pieces
NAV_LINKS = [("/fa/", "خانه"), ("/blog/", "درس‌ها"), ("/blog/vocabulary/", "لغت‌ها"), ("/blog/grammar/", "گرامر"), ("/fa/ielts/", "آیلتس")]

def links_html(active, cls_on='class="on"'):
    return "".join('<a href="%s"%s>%s</a>' % (h, (" " + cls_on) if h == active else "", l) for h, l in NAV_LINKS)

def lnav(active):
    return ('<nav class="lnav"><div class="wrap"><a class="llogo" href="/fa/"><img src="/icons/icon-192.png" alt="">Muse English</a>'
            '<div class="links">%s</div><a class="obtn" style="margin:0;padding:10px 22px" href="/#/signup">شروع رایگان</a></div></nav>') % links_html(active)

FOOT_LINE = ('<a href="/fa/">خانه</a> · <a href="/blog/">درس‌ها</a> · <a href="/blog/vocabulary/">لغت‌ها</a> · '
             '<a href="/blog/grammar/">گرامر</a> · <a href="/fa/ielts/">آیلتس</a> · <a href="/about/">دربارهٔ ما</a>'
             '<br>© ۲۰۲۶ <bdi>Muse English</bdi> · <a href="mailto:info@museenglishapp.com"><bdi>info@museenglishapp.com</bdi></a>')

def lfoot():
    return '<footer class="lfoot">%s</footer>' % FOOT_LINE

def head_common(t, title=None, desc=None, lang="fa", direction="rtl"):
    t = re.sub(r"<html[^>]*>", '<html lang="%s" dir="%s">' % (lang, direction), t, count=1)
    if MARK not in t:
        t = t.replace("</head>", MARK + '\n<link rel="stylesheet" href="%s">\n</head>' % CSS_HREF, 1)
    else:
        t = re.sub(r'href="/fa/assets/blog-fa\.css\?v=[^"]*"', 'href="%s"' % CSS_HREF, t)
    if 'property="og:locale"' not in t:
        t = t.replace('<meta property="og:type"', '<meta property="og:locale" content="fa_IR">\n<meta property="og:type"', 1)
    if title:
        e = html.escape(title, quote=True)
        t = re.sub(r"<title>.*?</title>", lambda m: "<title>%s</title>" % e, t, count=1, flags=re.S)
        t = re.sub(r'(<meta property="og:title" content=")[^"]*(")', lambda m: m.group(1) + e + m.group(2), t)
        t = re.sub(r'(<meta name="twitter:title" content=")[^"]*(")', lambda m: m.group(1) + e + m.group(2), t)
    if desc:
        e = html.escape(desc, quote=True)
        t = re.sub(r'(<meta name="description" content=")[^"]*(")', lambda m: m.group(1) + e + m.group(2), t)
        t = re.sub(r'(<meta property="og:description" content=")[^"]*(")', lambda m: m.group(1) + e + m.group(2), t)
        t = re.sub(r'(<meta name="twitter:description" content=")[^"]*(")', lambda m: m.group(1) + e + m.group(2), t)
    return t

def ld_fix(t, headline=None, crumbs=None, desc=None):
    """Structured data: Persian headline/breadcrumb names, inLanguage fa."""
    def fix(m):
        try:
            d = json.loads(m.group(1))
        except Exception:
            return m.group(0)
        for node in d.get("@graph", [d]):
            if node.get("@type") in ("Article", "WebPage", "CollectionPage", "LearningResource", "AboutPage"):
                node["inLanguage"] = "fa"
                if desc and "description" in node: node["description"] = desc
                if headline:
                    if "headline" in node: node["headline"] = headline
                    if "name" in node: node["name"] = headline
            if node.get("@type") == "BreadcrumbList" and crumbs:
                for it in node.get("itemListElement", []):
                    nm = it.get("name", "")
                    if nm in crumbs: it["name"] = crumbs[nm]
                    elif headline and it is node["itemListElement"][-1]: it["name"] = headline
                    if it.get("item") == "https://museenglishapp.com/": it["item"] = "https://museenglishapp.com/fa/"
        return '<script type="application/ld+json">%s</script>' % json.dumps(d, ensure_ascii=False)
    return re.sub(r'<script type="application/ld\+json">(.*?)</script>', fix, t, flags=re.S)

CRUMBS = {"Home": "خانه", "Blog": "درس‌ها", "Lessons": "درس‌ها", "Vocabulary": "لغت‌ها", "Grammar": "گرامر"}

def S(t, old, new):
    """Plain replace (idempotent because `old` is English)."""
    return t.replace(old, new)

POS = [("noun phrase", "گروه اسمی"), ("verb phrase", "گروه فعلی"), ("adjective phrase", "گروه وصفی"), ("adverbial phrase", "گروه قیدی"),
       ("phrasal verb", "فعل عبارتی"), ("proper noun", "اسم خاص"), ("uncountable noun", "اسم غیرقابل‌شمارش"), ("noun (plural)", "اسم جمع"),
       ("modal verb", "فعل وجهی"), ("auxiliary verb", "فعل کمکی"), ("noun", "اسم"), ("verb", "فعل"), ("adjective", "صفت"),
       ("adverb", "قید"), ("phrase", "عبارت"), ("idiom", "اصطلاح"), ("preposition", "حرف اضافه"), ("conjunction", "حرف ربط"),
       ("pronoun", "ضمیر"), ("number", "عدد"), ("abbreviation", "مخفف"), ("suffix", "پسوند"), ("prefix", "پیشوند"),
       ("expression", "عبارت"), ("collocation", "هم‌آیند"), ("interjection", "صوت"), ("determiner", "تعیین‌کننده"), ("plural", "جمع")]
POS_D = dict(POS)

def pos_fa(en):
    """'noun, verb' -> 'اسم، فعل · noun, verb' (Persian first, English kept for learning)."""
    raw = en.strip()
    key = raw.replace("noun, plural", "noun (plural)")
    if key in POS_D:
        fa_txt = POS_D[key]
    else:
        parts = [p.strip() for p in re.split(r"\s*[,/]\s*", key) if p.strip()]
        if not parts or any(p not in POS_D for p in parts):
            UNKNOWN.add("pos: " + raw); return '<bdi>%s</bdi>' % raw
        fa_txt = "، ".join(POS_D[p] for p in parts)
    return '%s · <bdi>%s</bdi>' % (fa_txt, raw)

def img_alt_fa(t):
    """Level artwork carries the English theme as alt text; give it the Persian theme."""
    def rep(m):
        if not re.search(r"[A-Za-z]", m.group(2)):
            return m.group(0)
        f = theme_fa(m.group(2))
        return m.group(1) + 'alt="%s"' % f if f else m.group(0)
    t = re.sub(r'(<img src="(?:/blog/img/[^"]+|https://i\.ytimg\.com/vi/[^"]+)" )alt="([^"]*)"', rep, t)
    return S(t, 'title="Muse English podcast"', 'title="پادکست Muse English"')

# ---------------------------------------------------------------- lesson pages
def all_lessons(level):
    return sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(REPO, "blog", level, "20??-??-??-*.html")))

def do_lesson(path, level, slug, lessons):
    t = open(path, encoding="utf-8").read()
    o = t
    LV = level.upper()
    date = slug[:10]
    data = lesson_json(level, date)
    words = data.get("words", []) or []
    th_en = data.get("theme") or (re.search(r"<h1>(.*?) — <span", t) or re.search(r"<h1>(.*?)</h1>", t)).group(1)
    th = theme_fa(th_en)
    th_html = th if th else bdi(html.escape(html.unescape(re.sub("<[^>]+>", "", th_en))))
    review = norm(th_en) == "review day"
    wl = [w.get("word", "") for w in words][:3]
    wl_txt = "، ".join(wl)
    n = len(words) or len(re.findall(r'<div class="wcard">|<div class="wcard"', t))

    # head
    title = ("مرور لغات انگلیسی (%s): %s" % (LV, wl_txt)) if review else ("لغات انگلیسی %s (%s): %s" % (th or norm(th_en), LV, wl_txt))
    topic_phrase = "مرور لغت‌های درس‌های قبل" if review else (th or norm(th_en))
    desc = ("درس رایگان انگلیسی سطح %s (%s) دربارهٔ %s: %s لغت تازه مثل %s با معنی فارسی، تلفظ و مثال، "
            "به‌همراه پادکست با متن کامل و تمرین شدوئینگ." % (LV, LV_FA[level], topic_phrase, fa(n), " و ".join(wl[:2])))
    t = head_common(t, title, desc)
    t = ld_fix(t, title, {**CRUMBS, LV: LV})

    # nav, crumbs, hero
    t = re.sub(r'<nav class="lnav">.*?</nav>', lambda m: lnav("/blog/"), t, count=1, flags=re.S)
    t = re.sub(r'<div class="crumbs">.*?</div>', lambda m: '<div class="crumbs"><a href="/fa/">خانه</a> / <a href="/blog/">درس‌ها</a> / <a href="/blog/%s/">%s</a></div>' % (level, LV), t, count=1, flags=re.S)
    t = re.sub(r'<span class="lvlpill">[^<]*</span>', '<span class="lvlpill"><bdi>%s</bdi>، %s</span>' % (LV, LV_FA[level]), t, count=1)
    t = re.sub(r'<h1>.*?</h1>', lambda m: '<h1>%s — <span class="org">درس انگلیسی <bdi>%s</bdi></span></h1>' % (th_html, LV), t, count=1, flags=re.S)
    t = re.sub(r'<span>📊 [^<]*</span>', '<span>📊 سطح <bdi>%s</bdi> (%s)</span>' % (LV, LV_FA[level]), t)
    t = re.sub(r'<span>📚 (\d+) new words?</span>', lambda m: '<span>📚 %s لغت تازه</span>' % fa(m.group(1)), t)
    t = S(t, '<span>🎧 daily podcast</span>', '<span>🎧 پادکست روزانه</span>')
    t = re.sub(r'<div class="lesbox"><h3>📖 What is Muse English\?</h3>\s*<p>.*?</p></div>',
               '<div class="lesbox"><h3>📖 Muse English چیست؟</h3>\n<p><strong>Muse English</strong> یک اپلیکیشن رایگان آموزش زبان انگلیسی است، '
               'با درس روزانه برای هر شش سطح، از A1 (مبتدی) تا C2 (تسلط کامل). هر روز لغت‌های تازه با معنی فارسی، یک پادکست واقعی، '
               'تمرین شدوئینگ، گرامر و آزمون دارید. <a href="/fa/">دربارهٔ اپ</a></p></div>', t, count=1, flags=re.S)

    # vocabulary + Persian meanings
    t = S(t, '<h2>📚 Vocabulary</h2>', '<h2>📚 لغت‌ها</h2>')
    t = re.sub(r'<span class="cnt">(\d+) new words?</span>', lambda m: '<span class="cnt">%s لغت تازه</span>' % fa(m.group(1)), t)
    t = S(t, '<span class="hint">Learn new words with real examples and audio.</span>',
          '<span class="hint">لغت‌های تازه با معنی فارسی، مثال واقعی و تلفظ.</span>')
    fa_map = {w.get("word", "").strip().lower(): (w.get("persian") or "").strip() for w in words}
    def add_meaning(m):
        word = html.unescape(re.sub(r"<small>.*?</small>|<[^>]+>", "", m.group(2))).strip().lower()
        mean = fa_map.get(word) or words_fa().get(word)
        out = '<div class="ww" dir="ltr">' + m.group(2) + m.group(3).replace('<div class="wm">', '<div class="wm" dir="ltr">')
        if mean:
            out += '\n<div class="wfa">%s</div>' % html.escape(mean)
        return out
    t = re.sub(r'(<div class="ww">)(.*?</div>)(\s*<span class="wpos">.*?</span>\s*<div class="wm">.*?</div>)', add_meaning, t, flags=re.S)
    t = S(t, '<div class="we">', '<div class="we" dir="ltr">')
    t = S(t, '<div class="wcard">', '<div class="wcard" dir="ltr">')
    t = re.sub(r'<span class="wpos"(?: dir="ltr")?>([a-z ,/()]+)</span>', lambda m: '<span class="wpos">%s</span>' % pos_fa(m.group(1)), t)

    # podcast, shadowing, speaking
    t = re.sub(r'<h3>Podcast: [^<]*</h3><p>Listen to today’s conversation\.</p>',
               lambda m: '<h3>پادکست: %s</h3><p>گفت‌وگوی امروز را گوش کنید.</p>' % th_html, t)
    t = S(t, '<h3>📝 Podcast Transcript</h3>', '<h3>📝 متن پادکست</h3>')
    t = S(t, '<div class="tdial">', '<div class="tdial" dir="ltr" lang="en">')
    t = S(t, '<h3>🎙 Try Shadowing <span class="free">free sample</span></h3>', '<h3>🎙 تمرین شدوئینگ <span class="free">نمونهٔ رایگان</span></h3>')
    t = S(t, '<p>Listen and repeat along with the audio. Full shadowing practice is in the app: repeat each sentence and see how many of its words the app recognised.</p>',
          '<p>گوش کنید و هم‌زمان با صدا بلند تکرار کنید. تمرین کامل شدوئینگ در اپ است: هر جمله را تکرار می‌کنید و می‌بینید اپ چند کلمه از آن را تشخیص داده است.</p>')
    t = S(t, '<div class="shline"><p>', '<div class="shline" dir="ltr"><p lang="en">')
    t = S(t, '<h3>Train your speaking</h3>', '<h3>صحبت کردن را تمرین کنید</h3>')
    t = S(t, '<p>Shadow every sentence in the Muse English app. It listens and shows how many of the words it recognised.</p>',
          '<p>در اپ Muse English همهٔ جمله‌ها را شدوئینگ کنید. اپ گوش می‌دهد و نشان می‌دهد چند کلمه از جمله‌تان را تشخیص داده است.</p>')
    t = S(t, 'Get the free app &rarr;</a>', 'اپ رایگان &larr;</a>')

    # grammar box
    t = re.sub(r'<h3><span class="pic">📝</span>Grammar: ([^<]*)</h3>', lambda m: '<h3><span class="pic">📝</span>گرامر: %s</h3>' % bdi(m.group(1)), t)
    def gram_p(m):
        body = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", m.group(2))
        body = re.sub(r"\n\s*\n", "<br><br>", body.strip())
        return m.group(1) + '<p dir="ltr" lang="en">%s</p>' % body
    t = re.sub(r'(<div class="grambox"><h3>(?:(?!</h3>).)*</h3>)<p>((?:(?!</p>).)*)</p>(?=\s*<div class="gramcta">)', gram_p, t, count=1, flags=re.S)
    t = S(t, '<h4>Master this grammar in the app</h4><p>Get clear explanations, more examples and interactive exercises.</p>',
          '<h4>این گرامر را در اپ کامل یاد بگیرید</h4><p>توضیح کامل‌تر، مثال‌های بیشتر و تمرین تعاملی.</p>')
    t = S(t, 'Practice in the app &rarr;</a>', 'تمرین در اپ &larr;</a>')
    t = re.sub(r'>Full guide &amp; exercises: ([^<]*?) &rarr;</a>', lambda m: '>راهنمای کامل و تمرین‌ها: %s &larr;</a>' % bdi(m.group(1)), t)

    # prev / next: rebuilt from the lesson list, so it never depends on the job's English line
    i = lessons.index(slug) if slug in lessons else -1
    pn = []
    if i > 0:
        pn.append('<a class="pnlink" href="/blog/%s/%s">&rarr; درس قبلی</a>' % (level, lessons[i - 1]))
    if 0 <= i < len(lessons) - 1:
        pn.append('<a class="pnlink" href="/blog/%s/%s">درس بعدی &larr;</a>' % (level, lessons[i + 1]))
    t = re.sub(r'<div class="prevnext">.*?</div>(?=<div class="hublinks">|<div class="keepbox">|\n|$)',
               lambda m: '<div class="prevnext">%s</div>' % " ".join(pn), t, count=1, flags=re.S)
    def hub(m):
        name = TOPICS.get(norm(m.group(3)))
        if not name:
            UNKNOWN.add("topic: " + norm(m.group(3)))
            name = bdi(m.group(3))
        return '<span>بیشتر: </span><a href="%s">همهٔ %s لغت «%s» با عکس</a>' % (m.group(1), fa(m.group(2)), name)
    t = re.sub(r'<span>Explore: </span><a href="([^"]+)">See all (\d+) (.+?) words with pictures</a>', hub, t)
    def hub_link(href, topic, count, orig):
        name = TOPICS.get(norm(topic))
        if not name:
            UNKNOWN.add("topic: " + norm(topic)); return orig
        return '<a href="%s">«%s»: %s لغت</a>' % (href, name, fa(count))
    t = re.sub(r'<a href="([^"]+)">Explore (\d+) (.+?) words</a>', lambda m: hub_link(m.group(1), m.group(3), m.group(2), m.group(0)), t)
    t = re.sub(r'<a href="([^"]+)">([^<]+?) vocabulary: (\d+) words</a>', lambda m: hub_link(m.group(1), m.group(2), m.group(3), m.group(0)), t)
    t = S(t, '<h3>Keep learning every day</h3><p>New lessons, podcasts and quizzes daily — free in the Muse English app.</p>',
          '<h3>هر روز ادامه بدهید</h3><p>هر روز درس، پادکست و آزمون تازه؛ رایگان در اپ Muse English.</p>')
    t = S(t, 'Open Muse English &rarr;</a>', 'باز کردن Muse English &larr;</a>')
    t = img_alt_fa(t)
    t = re.sub(r'<footer class="lfoot">.*?</footer>', lambda m: lfoot(), t, count=1, flags=re.S)
    return t, t != o

# ---------------------------------------------------------------- level pages
def do_level(path, level):
    t = open(path, encoding="utf-8").read(); o = t
    LV = level.upper()
    t = head_common(t, "درس‌های روزانهٔ انگلیسی سطح %s (%s) | Muse English" % (LV, LV_FA[level]),
                    "درس‌های رایگان انگلیسی سطح %s (%s)، هر روز یک درس تازه: لغت‌های جدید با معنی فارسی و تلفظ، پادکست با متن کامل، "
                    "تمرین شدوئینگ و یک نکتهٔ گرامری. جدیدترین درس اول." % (LV, LV_FA[level]))
    t = ld_fix(t, None, CRUMBS)
    t = re.sub(r'<nav class="lnav">.*?</nav>', lambda m: lnav("/blog/"), t, count=1, flags=re.S)
    t = re.sub(r'<div class="crumbs">.*?</div>', lambda m: '<div class="crumbs"><a href="/fa/">خانه</a> / <a href="/blog/">درس‌ها</a> / %s</div>' % LV, t, count=1, flags=re.S)
    t = re.sub(r'<h1><span class="grad">%s</span>[^<]*</h1>' % LV, '<h1><span class="grad">%s</span> درس‌های سطح %s</h1>' % (LV, LV_FA[level]), t, count=1)
    t = re.sub(r'<p class="meta">Daily [A-Z0-9]+ English lessons — newest first\.</p>',
               '<p class="meta">درس‌های روزانهٔ انگلیسی سطح <bdi>%s</bdi>؛ جدیدترین درس اول. هر درس: لغت‌های تازه با معنی فارسی، پادکست با متن کامل، تمرین شدوئینگ و یک نکتهٔ گرامری.</p>' % LV, t, count=1)
    def card(m):
        pre, lst = m.group(2), m.group(3)
        lab = SHORT.get(norm(pre))
        if lab is None:
            UNKNOWN.add("short: " + norm(pre)); return m.group(0)
        txt = ("مرور لغت‌ها" if lab == "مرور" else "لغت‌های %s" % lab) + '<span class="lwl" dir="ltr">%s</span>' % lst
        return '<a class="ltheme" href="%s">%s</a>' % (m.group(1), txt)
    t = re.sub(r'<a class="ltheme" href="([^"]+)">([^<:]+?) words: ([^<]*)</a>', card, t)
    t = re.sub(r'(<a class="lgo" href="[^"]+">)&rarr;</a>', r'\1&larr;</a>', t)
    t = img_alt_fa(t)
    t = re.sub(r'<footer class="lfoot">.*?</footer>', lambda m: lfoot(), t, count=1, flags=re.S)
    return t, t != o

# ---------------------------------------------------------------- blog index
BNAV = ('<nav class="bnav"><div class="wrap"><a class="blogo" href="/fa/"><img src="/icons/icon-192.png" alt="">Muse English</a>'
        '<div class="links">%s<a class="bstart" href="/#/signup">شروع رایگان &larr;</a></div>'
        '<button class="mobbtn" aria-label="منو" onclick="document.getElementById(\'mobm\').classList.add(\'open\');document.getElementById(\'mobo\').classList.add(\'open\')">&#9776;</button></div></nav>')
MOBM = ('<div class="mobmenu" id="mobm"><button class="mobclose" aria-label="بستن" onclick="document.getElementById(\'mobm\').classList.remove(\'open\');document.getElementById(\'mobo\').classList.remove(\'open\')">&times;</button>'
        '%s<a class="bstart" href="/#/signup">شروع رایگان &larr;</a></div>')
BLOG_LV = {"a1": ("مبتدی", "شروع از صفر: کلمه‌ها و جمله‌های ساده."), "a2": ("مقدماتی", "گفت‌وگوهای روزمره و گرامر ضروری."),
           "b1": ("متوسط", "موضوع‌های واقعی و گفت‌وگوهای طولانی‌تر."), "b2": ("بالاتر از متوسط", "کار، فرهنگ و بیان نظر."),
           "c1": ("پیشرفته", "انگلیسی روان و دقیق در موضوع‌های پیچیده."), "c2": ("تسلط کامل", "روانی و دقتی نزدیک به انگلیسی‌زبان‌ها.")}

def do_blog_index(path):
    t = open(path, encoding="utf-8").read(); o = t
    t = head_common(t, "درس‌های روزانهٔ انگلیسی از A1 تا C2، رایگان | Muse English",
                    "هر روز یک درس تازهٔ انگلیسی برای هر سطح، از A1 تا C2: لغت با معنی فارسی، پادکست با متن کامل، تمرین شدوئینگ، گرامر و آزمون. رایگان و بدون ثبت‌نام.")
    t = ld_fix(t, None, CRUMBS)
    t = re.sub(r'<nav class="bnav">.*?</nav>', lambda m: BNAV % links_html("/blog/"), t, count=1, flags=re.S)
    t = re.sub(r'<div class="mobmenu" id="mobm">.*?</div>', lambda m: MOBM % links_html("/blog/"), t, count=1, flags=re.S)
    t = re.sub(r'<div class="crumbs" style="padding:0">.*?</div>', '<div class="crumbs" style="padding:0"><a href="/fa/">خانه</a> / <span style="color:#FF6B00">درس‌ها</span></div>', t, count=1, flags=re.S)
    t = S(t, '<h1>Daily English Lessons</h1><p class="meta">New lessons every day — pick your level and start learning.</p>',
          '<h1>درس‌های روزانهٔ انگلیسی</h1><p class="meta">هر روز درس تازه؛ سطح‌تان را انتخاب کنید و شروع کنید. درس‌ها بدون ثبت‌نام هم باز می‌شوند.</p>')
    for lv, (name, d) in BLOG_LV.items():
        t = re.sub(r'(<a class="bcard" href="/blog/%s/">.*?<div class="bname">)[^<]*(</div><div class="bdesc">)[^<]*(</div>)' % lv,
                   lambda m: m.group(1) + name + m.group(2) + d + m.group(3), t, count=1, flags=re.S)
    t = S(t, '<span class="bexp">Explore &rarr;</span>', '<span class="bexp">ببینید &larr;</span>')
    t = re.sub(r'<div class="bwhat"><h2>What is Muse English\?</h2>\s*<p>.*?</p>',
               '<div class="bwhat"><h2>Muse English چیست؟</h2>\n<p>Muse English یک اپلیکیشن رایگان آموزش زبان انگلیسی است، با درس روزانه برای هر شش سطح. '
               'لغت یاد می‌گیرید، پادکست گوش می‌دهید، شدوئینگ تمرین می‌کنید، گرامر می‌خوانید و آزمون می‌دهید؛ همه در یک جا و با سرعت خودتان.</p>', t, count=1, flags=re.S)
    for en, f in [('<div class="bn">Vocabulary</div><div class="bd">Learn useful words in context.</div>', '<div class="bn">لغت</div><div class="bd">لغت‌های کاربردی، در جمله.</div>'),
                  ('<div class="bn">Podcast</div><div class="bd">Listen to real English.</div>', '<div class="bn">پادکست</div><div class="bd">انگلیسی واقعی را بشنوید.</div>'),
                  ('<div class="bn">Shadowing</div><div class="bd">Speak and sound more natural.</div>', '<div class="bn">شدوئینگ</div><div class="bd">طبیعی‌تر صحبت کنید.</div>'),
                  ('<div class="bn">Grammar</div><div class="bd">Clear explanations and examples.</div>', '<div class="bn">گرامر</div><div class="bd">توضیح روشن و مثال.</div>'),
                  ('<div class="bn">Quizzes</div><div class="bd">Check your progress.</div>', '<div class="bn">آزمون</div><div class="bd">پیشرفت‌تان را بسنجید.</div>')]:
        t = S(t, en, f)
    t = S(t, 'alt="Muse English mascot"', 'alt=""')
    t = re.sub(r'(<img src="/blog/img/level-([a-c][12])\.webp" )alt="[^"]*English lessons"', lambda m: m.group(1) + 'alt="درس‌های انگلیسی سطح %s"' % LV_FA[m.group(2)], t)
    t = S(t, '<img src="/media/landing/icon-flame.webp" alt="">', '<img src="/icons/icon-192.png" alt="">')
    t = re.sub(r'(<footer class="bfoot"><div class="wrap"><a class="blogo" href=")/("[^>]*>.*?</a>\s*<span>).*?(</span>)',
               lambda m: m.group(1) + "/fa/" + m.group(2) + FOOT_LINE + m.group(3), t, count=1, flags=re.S)
    return t, t != o

# ---------------------------------------------------------------- shared: gnav pages
# Vocabulary pages, the grammar index, grammar guides and the about page are
# rebuilt in full by their generators. A page that already carries MARK has been
# converted and is skipped, so running this twice changes nothing.

FD_JS = "var fd=function(n){return String(n).replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'.charAt(d)})};"

_W = r"[A-Za-z0-9]*(?:[.&'’+\-][A-Za-z0-9]+)*"
LATIN = re.compile(r"[A-Za-z]" + _W + r"(?:,? [A-Za-z0-9]" + _W + r")*")

def fa_html(s):
    """Escape a Persian string and isolate its English runs (bidi-safe)."""
    out, last = [], 0
    for m in LATIN.finditer(s):
        out.append(html.escape(s[last:m.start()], quote=False))
        out.append("<bdi>%s</bdi>" % html.escape(m.group(0), quote=False))
        last = m.end()
    out.append(html.escape(s[last:], quote=False))
    return "".join(out)

def plain(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()

def gnav_fa(t, active):
    def rep(m):
        btn = re.sub(r'aria-label="[^"]*"', 'aria-label="جست‌وجو"', m.group(1) or "")
        return ('<header class="gnav"><div class="gnav-in">\n<a class="gbrand" href="/fa/"><img src="/icons/icon-192.png" alt="">Muse English</a>\n'
                '<nav class="gnav-links" aria-label="منوی اصلی">%s</nav>\n%s<a class="gnav-cta" href="/#/signup">شروع رایگان</a>\n</div></header>') % (links_html(active), btn)
    return re.sub(r'<header class="gnav">.*?</nav>\s*(<button class="gsearch-ico".*?</button>\s*)?<a class="gnav-cta"[^>]*>[^<]*</a>\s*</div></header>',
                  rep, t, count=1, flags=re.S)

LEVEL_LIS = "".join('<li><a href="/blog/%s/"><bdi>%s</bdi> %s</a></li>' % (lv, lv.upper(), LV_FA[lv]) for lv in ("a1", "a2", "b1", "b2", "c1", "c2"))
GFOOT = ('<footer class="gfoot"><div class="gfoot-grid">\n'
         '<div class="gfoot-col"><h4>Muse English</h4><ul><li><a href="/fa/">خانه</a></li><li><a href="/about/">دربارهٔ ما</a></li>'
         '<li><a href="mailto:info@museenglishapp.com">تماس با ما</a></li></ul></div>\n'
         '<div class="gfoot-col"><h4>یادگیری</h4><ul><li><a href="/blog/">درس‌های روزانه</a></li><li><a href="/blog/vocabulary/">لغت‌ها</a></li>'
         '<li><a href="/blog/grammar/">گرامر</a></li><li><a href="/fa/ielts/">آیلتس</a></li></ul></div>\n'
         '<div class="gfoot-col"><h4>سطح‌ها</h4><ul>' + LEVEL_LIS + '</ul></div>\n'
         '</div>\n<div class="gfoot-base">© ۲۰۲۶ <bdi>Muse English</bdi> · <a href="mailto:info@museenglishapp.com"><bdi>info@museenglishapp.com</bdi></a></div>\n</footer>')

def gfoot_fa(t):
    return re.sub(r'<footer class="gfoot">.*?</footer>', lambda m: GFOOT, t, count=1, flags=re.S)

# ---------------------------------------------------------------- vocabulary
# slug: (Persian name, what the topic covers)
VT = {
    "body-health": ("بدن و سلامت", "بدن، سلامت، بیماری و مراقبت پزشکی"),
    "city-daily-life": ("شهر و زندگی روزمره", "کارهای روزانه، جاهای شهر و زندگی شهری و روستایی"),
    "education": ("آموزش و تحصیل", "مدرسه، دانشگاه و یادگیری"),
    "family-relationships": ("خانواده و روابط", "اعضای خانواده، دوستان و روابط"),
    "feelings-personality": ("احساسات و شخصیت", "احساسات، حال‌وهوا و شخصیت"),
    "food-drink": ("غذا و نوشیدنی", "غذا، نوشیدنی، آشپزی و رستوران"),
    "home-housing": ("خانه و مسکن", "اتاق‌ها، وسایل خانه و اجاره کردن خانه"),
    "nature-animals": ("طبیعت و حیوانات", "حیوانات، گیاهان، طبیعت و جغرافیا"),
    "shopping-money": ("خرید و پول", "خرید، قیمت، پرداخت و پول در موقعیت‌های روزمره"),
    "sports-hobbies": ("ورزش و سرگرمی", "ورزش، تمرین و سرگرمی"),
    "technology": ("فناوری", "دستگاه‌ها، اینترنت و زندگی دیجیتال"),
    "travel-transport": ("سفر و حمل‌ونقل", "فرودگاه، هتل، آدرس پرسیدن و وسایل نقلیه"),
    "weather-environment": ("آب‌وهوا و محیط زیست", "آب‌وهوا، فصل‌ها، بلایای طبیعی و محیط زیست"),
    "work-jobs": ("کار و شغل", "شغل‌ها، محیط کار و انگلیسی تجاری"),
}
SUB = {
    "body-parts": "اعضای بدن", "illnesses-symptoms": "بیماری‌ها و علائم", "doctor-hospital": "پیش دکتر و در بیمارستان",
    "healthy-lifestyle": "سبک زندگی سالم و عادت‌ها", "mental-health": "سلامت روان و آرامش", "medicine-public-health": "پزشکی و بهداشت عمومی",
    "daily-routine": "کارهای روزانه", "places-in-town": "جاهای شهر", "urban-rural-life": "زندگی شهری و روستایی",
    "school-classroom": "مدرسه و کلاس", "studying-exams": "درس خواندن و امتحان", "language-learning": "یادگیری زبان",
    "university": "دانشگاه", "education-issues": "نظام آموزشی و بحث‌های آن", "family-members": "اعضای خانواده",
    "friendship": "دوستی", "family-life": "زندگی خانوادگی و فرزندپروری", "love-marriage": "عشق و ازدواج",
    "emotions": "احساسات و عواطف", "personality": "شخصیت و منش", "mind-thinking": "ذهن، حافظه و فکر کردن",
    "communication": "ارتباط و بیان نظر", "fruit": "میوه‌ها", "vegetables": "سبزیجات", "meals-snacks": "وعده‌ها، تنقلات و دسرها",
    "drinks": "نوشیدنی‌ها", "groceries": "خواربار و مواد اولیه", "cooking": "آشپزی", "kitchen": "آشپزخانه",
    "restaurant": "در رستوران", "taste-texture": "مزه و بافت غذا", "diet-nutrition": "رژیم غذایی و تغذیه",
    "food-production": "تولید غذا و کشاورزی", "rooms": "اتاق‌های خانه", "furniture": "مبلمان",
    "household-items": "وسایل و لوازم خانگی", "housing-renting": "مسکن و اجاره", "animals": "حیوانات", "pets": "حیوانات خانگی",
    "plants-garden": "گیاهان و باغ", "landscapes-geography": "طبیعت و جغرافیا", "animal-welfare": "حمایت از حیوانات",
    "shops-stores": "مغازه‌ها و فروشگاه‌ها", "shopping": "خرید کردن", "money-banking": "پول و بانک",
    "personal-finance": "مدیریت پول شخصی", "economy": "اقتصاد و جهانی‌شدن", "sports": "ورزش‌ها", "fitness-gym": "تناسب اندام و باشگاه",
    "competitions-events": "مسابقه‌ها و رویدادهای ورزشی", "devices-computers": "دستگاه‌ها و کامپیوتر",
    "smartphones-apps": "گوشی هوشمند و اپلیکیشن", "internet-social-media": "اینترنت و شبکه‌های اجتماعی", "science-space": "علم و فضا",
    "ai-automation": "هوش مصنوعی و خودکارسازی", "privacy-security": "حریم خصوصی و امنیت آنلاین", "transport": "وسایل نقلیه و حمل‌ونقل",
    "directions": "پرسیدن آدرس", "airport": "در فرودگاه", "hotel": "در هتل", "holidays-tourism": "تعطیلات و گردشگری",
    "traffic-commuting": "ترافیک و رفت‌وآمد", "weather": "آب‌وهوا", "seasons": "فصل‌ها", "natural-disasters": "بلایای طبیعی",
    "pollution-recycling": "آلودگی و بازیافت", "climate-energy": "تغییرات اقلیمی و انرژی", "jobs": "شغل‌ها و حرفه‌ها",
    "workplace-office": "در محل کار", "job-search-interviews": "کاریابی و مصاحبهٔ کاری", "careers-success": "مسیر شغلی و موفقیت",
    "business": "انگلیسی تجاری", "employment-issues": "اشتغال و بازار کار",
}
PHRASE_FA = {
    "Describe a symptom.": "توصیف یک علامت بیماری.", "Ask for help.": "کمک خواستن.", "Understand instructions.": "فهمیدن دستورها.",
    "Describe how you feel.": "گفتن این‌که چه حسی دارید.", "At the pharmacy.": "در داروخانه.", "Talk about recovery.": "صحبت دربارهٔ بهبودی.",
    "Ask your teacher.": "سؤال از معلم.", "Talk about school.": "صحبت دربارهٔ مدرسه.", "Ask about vocabulary.": "پرسیدن معنی لغت.",
    "Share good news.": "گفتن خبر خوب.", "Ask a classmate.": "سؤال از همکلاسی.", "Talk about the schedule.": "صحبت دربارهٔ برنامه.",
    "Ask about someone's family.": "پرسیدن دربارهٔ خانوادهٔ کسی.", "Talk about plans.": "صحبت دربارهٔ برنامه‌ها.",
    "Describe a relationship.": "توصیف یک رابطه.", "Celebrate with someone.": "جشن گرفتن با کسی.", "Express feelings.": "بیان احساسات.",
    "Make plans.": "برنامه ریختن.", "Express happiness.": "ابراز خوشحالی.", "Comfort someone.": "دلداری دادن به کسی.",
    "Describe your mood.": "توصیف حال‌تان.", "React positively.": "واکنش مثبت.", "Express worry.": "ابراز نگرانی.",
    "Encourage someone.": "تشویق کردن کسی.", "Ask for the menu.": "منو خواستن.", "Order your food.": "سفارش غذا.",
    "Ask about the taste.": "پرسیدن مزهٔ غذا.", "Order takeaway.": "سفارش غذای بیرون‌بر.", "Ask to pay.": "درخواست صورت‌حساب.",
    "Ask about diet options.": "پرسیدن گزینه‌های رژیمی.", "Talk about the weather.": "صحبت دربارهٔ هوا.",
    "Point out animals.": "نشان دادن حیوانات.", "Suggest an activity.": "پیشنهاد یک فعالیت.", "Describe the weather.": "توصیف هوا.",
    "Describe nature.": "توصیف طبیعت.", "Warn someone.": "هشدار دادن به کسی.", "Ask about the price.": "پرسیدن قیمت.",
    "Use this in clothing stores.": "برای فروشگاه لباس.", "Ask for a different size.": "خواستن سایز دیگر.",
    "Ask for a lower price.": "تخفیف خواستن.", "Say your payment method.": "گفتن روش پرداخت.", "Ask for the fitting room.": "پرسیدن اتاق پرو.",
    "Invite someone.": "دعوت کردن کسی.", "Celebrate a victory.": "جشن گرفتن برد.", "Talk about exercise.": "صحبت دربارهٔ ورزش کردن.",
    "Ask during a game.": "سؤال وسط بازی.", "Talk about hobbies.": "صحبت دربارهٔ سرگرمی‌ها.", "Before exercise.": "قبل از ورزش.",
    "Describe a problem.": "توضیح یک مشکل.", "Ask for information.": "اطلاعات خواستن.", "Report a problem.": "گزارش یک مشکل.",
    "Talk about devices.": "صحبت دربارهٔ دستگاه‌ها.", "A common problem.": "یک مشکل رایج.", "Ask for directions.": "پرسیدن آدرس.",
    "Buy a ticket.": "خرید بلیت.", "Ask about the schedule.": "پرسیدن برنامهٔ حرکت.", "Ask about travel time.": "پرسیدن مدت سفر.",
    "Ask before sitting.": "اجازه گرفتن قبل از نشستن.", "Talk to a taxi driver.": "صحبت با رانندهٔ تاکسی.",
    "Talk about your schedule.": "صحبت دربارهٔ برنامهٔ کاری‌تان.", "Ask a coworker.": "سؤال از همکار.",
    "Plan with your team.": "برنامه‌ریزی با تیم.", "Talk to your manager.": "صحبت با مدیرتان.", "Ask about a project.": "پرسیدن دربارهٔ یک پروژه.",
    "Describe your routine.": "توصیف کارهای روزانه‌تان.",
}

def vt(slug):
    v = VT.get(slug)
    if not v:
        UNKNOWN.add("vocab topic: " + slug)
    return v

_LM = None
def lesson_meanings():
    global _LM
    if _LM is None:
        _LM = {}
        for f in sorted(glob.glob(os.path.join(REPO, "lessons", "*", "*.json"))):
            try:
                d = json.load(open(f, encoding="utf-8"))
            except Exception:
                continue
            for w in d.get("words", []) or []:
                if w.get("word") and w.get("persian"):
                    _LM.setdefault(w["word"].strip().lower(), w["persian"].strip())
    return _LM

def meaning(word):
    k = plain(word).lower()
    return words_fa().get(k) or lesson_meanings().get(k)

def do_vocab_hub(path):
    t = open(path, encoding="utf-8").read()
    if MARK in t:
        return t, False
    o = t
    n = len(re.findall(r'<a class="gcard vcard"', t))
    title = "لغات انگلیسی موضوعی با معنی فارسی و عکس | Muse English"
    desc = ("لغت‌های انگلیسی در %s موضوع، از غذا و سفر تا کار و احساسات. هر لغت با عکس، تلفظ صوتی، مثال و معنی فارسی، "
            "از سطح A1 تا C2. رایگان." % fa(n))
    t = head_common(t, title, desc)
    t = ld_fix(t, title, CRUMBS, desc)
    t = gnav_fa(t, "/blog/vocabulary/")
    t = S(t, '<div class="crumbs"><a href="/">Home</a> &rsaquo; <span>Vocabulary</span></div>',
          '<div class="crumbs"><a href="/fa/">خانه</a> &lsaquo; <span>لغت‌ها</span></div>')
    t = S(t, '<h1>Vocabulary <span class="accent">Topics</span></h1>', '<h1>لغت‌های انگلیسی <span class="accent">موضوعی</span></h1>')
    t = S(t, '<p class="gsub">Useful words, real examples and practice for everyday English. Learn vocabulary for real life situations.</p>',
          '<p class="gsub">لغت‌های کاربردی برای انگلیسیِ روزمره، دسته‌بندی‌شده بر اساس موقعیت‌های واقعی زندگی؛ هر لغت با عکس، تلفظ، مثال و معنی فارسی.</p>')
    t = S(t, '<span><i>&#128214;</i><span>Real-life words<small>Use in daily conversations</small></span></span>',
          '<span><i>&#128214;</i><span>لغت‌های زندگی واقعی<small>برای گفت‌وگوهای روزمره</small></span></span>')
    t = S(t, '<span><i>&#128172;</i><span>Example sentences<small>See how to use them</small></span></span>',
          '<span><i>&#128172;</i><span>جمله‌های نمونه<small>ببینید چطور به کار می‌روند</small></span></span>')
    t = S(t, '<span><i>&#9989;</i><span>Practice &amp; remember<small>Quizzes and exercises</small></span></span>',
          '<span><i>&#9989;</i><span>تمرین و مرور<small>آزمون و تمرین</small></span></span>')
    t = S(t, 'alt="Muse English mascot studying vocabulary"', 'alt="ماسکوت Muse English در حال یادگرفتن لغت"')

    def pill(m):
        f = m.group(2)
        if f == "all":
            lab = "همه"
        else:
            v = vt(f)
            lab = v[0] if v else m.group(3)
        return '<button class="vpill%s" data-f="%s">%s</button>' % (m.group(1) or "", f, lab)
    t = re.sub(r'<button class="vpill( on)?" data-f="([^"]+)">(.*?)</button>', pill, t)
    t = S(t, 'placeholder="Search vocabulary topics..." aria-label="Search vocabulary topics"', 'placeholder="جست‌وجوی موضوع…" aria-label="جست‌وجوی موضوع"')
    t = S(t, '<h2>&#128214; All Vocabulary Topics</h2>', '<h2>&#128214; همهٔ موضوع‌های لغت</h2>')
    t = re.sub(r'<span class="vcount" id="vcount">(\d+) topics</span>', lambda m: '<span class="vcount" id="vcount">%s موضوع</span>' % fa(m.group(1)), t)
    t = S(t, '<label>Sort by: <select id="vsort"><option value="pop">Most popular</option><option value="az">A&ndash;Z</option></select></label>',
          '<label>مرتب‌سازی: <select id="vsort"><option value="pop">محبوب‌ترین</option><option value="az">الفبایی</option></select></label>')
    t = S(t, '<p class="gsub2">Explore words you need in real life, with examples and practice.</p>',
          '<p class="gsub2">لغت‌هایی که در زندگی واقعی لازم دارید، با مثال و تمرین.</p>')

    def card(m):
        slug, title_en, rest = m.group(1), m.group(2), m.group(3)
        v = vt(slug)
        if not v:
            return m.group(0)
        name, about = v
        rest = re.sub(r'alt="[^"]*"', 'alt="تصویر لغت‌های %s"' % name, rest, count=1)
        rest = re.sub(r'<b>(.*?)</b>', lambda b: '<b>%s</b><span class="ven" dir="ltr" lang="en">%s</span>' % (name, b.group(1)), rest, count=1)
        rest = re.sub(r'<span class="vwords">(\d+) words</span>', lambda w: '<span class="vwords">%s لغت</span>' % fa(w.group(1)), rest)
        rest = re.sub(r'<span class="vdesc">.*?</span>', '<span class="vdesc">%s.</span>' % about, rest, count=1)
        rest = S(rest, '<span class="vexp">Explore words &rarr;</span>', '<span class="vexp">دیدن لغت‌ها &larr;</span>')
        return '<a class="gcard vcard" data-cat="%s" data-title="%s %s"%s</a>' % (slug, name, title_en, rest)
    t = re.sub(r'<a class="gcard vcard" data-cat="([^"]+)" data-title="([^"]*)"(.*?)</a>', card, t, flags=re.S)

    t = S(t, '<h3>&#128218; Vocabulary by category</h3>', '<h3>&#128218; لغت‌ها بر اساس موضوع</h3>')
    def side(m):
        v = vt(m.group(1))
        if not v:
            return m.group(0)
        return '<a class="vside-row" data-f="%s">%s<b>%s</b>\n<span class="vn">%s لغت</span><span class="chev">&lsaquo;</span></a>' % (m.group(1), m.group(2), v[0], fa(m.group(3)))
    t = re.sub(r'<a class="vside-row" data-f="([^"]+)">(\s*<img[^>]*>)<b>.*?</b>\s*<span class="vn">(\d+) words</span><span class="chev">&rsaquo;</span></a>', side, t, flags=re.S)
    t = S(t, '<h3>&#128293; Popular topics</h3>', '<h3>&#128293; موضوع‌های پرطرفدار</h3>')
    def pop(m):
        v = vt(m.group(1))
        if not v:
            return m.group(0)
        return '<a class="vpop" href="/blog/vocabulary/%s/">\n<span class="num">%s</span><b>%s</b><span class="chev">&lsaquo;</span></a>' % (m.group(1), fa(m.group(2)), v[0])
    t = re.sub(r'<a class="vpop" href="/blog/vocabulary/([^/]+)/">\s*<span class="num">(\d+)</span><b>.*?</b><span class="chev">&rsaquo;</span></a>', pop, t, flags=re.S)
    t = S(t, 'alt="Muse English mascot">\n<div><h2>Want to learn more words every day?</h2>\n<p>Get daily lessons, quizzes and real conversations with the Muse English app.</p></div>\n<a class="gcta-btn" href="/blog/">Start today\'s lesson &rarr;</a>',
          'alt="">\n<div><h2>می‌خواهید هر روز لغت‌های بیشتری یاد بگیرید؟</h2>\n<p>درس روزانه، آزمون و گفت‌وگوهای واقعی در اپ Muse English.</p></div>\n<a class="gcta-btn" href="/blog/">شروع درس امروز &larr;</a>')
    t = gfoot_fa(t)
    t = S(t, "<script>\ndocument.querySelectorAll('.vpill')", "<script>\n" + FD_JS + "\ndocument.querySelectorAll('.vpill')")
    t = S(t, "vis+' topics'", "fd(vis)+' موضوع'")
    return t, t != o

def do_vocab_topic(path, slug):
    t = open(path, encoding="utf-8").read()
    if MARK in t:
        return t, False
    v = vt(slug)
    if not v:
        return t, False
    o = t
    name, about = v
    cm = re.search(r'<div class="crumbs">.*?<span>(.*?)</span></div>', t, re.S)
    en = plain(cm.group(1)) if cm else name
    d_en = (re.search(r'<meta name="description" content="([^"]*)"', t) or re.search("()", "")).group(1)
    d_en = html.unescape(d_en)
    nm = re.search(r'<span>(\d+) words<small>', t)
    n = int(nm.group(1)) if nm else len(re.findall(r'<div class="wcard', t))
    sample = []
    sm = re.match(r"(.*?) and \d+ more ", d_en)
    if sm:
        sample = [s.strip() for s in sm.group(1).split(", ") if s.strip()][:3]
    lv = re.search(r"from ([ABC][12]) to ([ABC][12])", d_en) or re.search(r"<span>([ABC][12])–([ABC][12])<small>", t)
    lo, hi = (lv.group(1).lower(), lv.group(2).lower()) if lv else ("a1", "c2")

    title = "لغات انگلیسی %s با معنی فارسی و عکس | Muse English" % name
    like = ""
    if sample:
        like = "، مثل " + ("، ".join(sample[:-1]) + " و " + sample[-1] if len(sample) > 1 else sample[0])
    desc = "%s لغت انگلیسی دربارهٔ %s%s، با عکس، تلفظ صوتی، مثال و معنی فارسی؛ از سطح %s تا %s. رایگان." % (fa(n), name, like, lo.upper(), hi.upper())
    t = head_common(t, title, desc)
    t = ld_fix(t, title, {**CRUMBS, en + " Vocabulary": "لغت‌های " + name}, desc)
    t = gnav_fa(t, "/blog/vocabulary/")
    t = re.sub(r'<div class="crumbs">.*?</div>', lambda m: '<div class="crumbs"><a href="/fa/">خانه</a> &lsaquo; <a href="/blog/vocabulary/">لغت‌ها</a> &lsaquo; <span>%s</span></div>' % name, t, count=1, flags=re.S)
    t = S(t, '<span class="vbadge">&#9679; VOCABULARY</span>', '<span class="vbadge">&#9679; لغت‌ها</span>')
    t = re.sub(r'<h1>.*?</h1>', lambda m: '<h1>لغت‌های انگلیسی <span class="accent">%s</span></h1>' % name, t, count=1, flags=re.S)
    t = re.sub(r'<p class="gsub">.*?</p>', lambda m: '<p class="gsub">لغت‌ها و عبارت‌های کاربردی انگلیسی دربارهٔ %s، با عکس، تلفظ، مثال و معنی فارسی.</p>' % about, t, count=1, flags=re.S)
    conv = 'data-sec="conv"' in t
    feat = ('<div class="vfeat">\n'
            '<span><i>&#128214;</i><span>%s لغت<small>با مثال و معنی فارسی</small></span></span>\n'
            '<span><i>&#128172;</i><span>%s</span></span>\n'
            '<span><i>&#127919;</i><span>آزمون تمرینی<small>یادگیری‌تان را بسنجید</small></span></span>\n'
            '<span><i>&#128202;</i><span><bdi>%s–%s</bdi><small>از %s تا %s</small></span></span>\n</div>') % (
        fa(n), "گفت‌وگوی واقعی<small>در موقعیت روزمره</small>" if conv else "مثال‌های واقعی<small>در جمله‌های روزمره</small>",
        lo.upper(), hi.upper(), LV_FA[lo], LV_FA[hi])
    t = re.sub(r'<div class="vfeat">.*?</div>', lambda m: feat, t, count=1, flags=re.S)
    t = re.sub(r'(<div class="ghero-art vhero-art"><img src="[^"]+" )alt="[^"]*"', lambda m: m.group(1) + 'alt="لغت‌های %s"' % name, t, count=1)

    # side panel + app card
    t = S(t, '<h3>&#128218; Vocabulary Topics</h3>', '<h3>&#128218; موضوع‌های لغت</h3>')
    def trow(m):
        w = vt(m.group(2))
        return m.group(1) + (w[0] if w else m.group(3)) + "</a>"
    t = re.sub(r'(<a class="trow(?: on)?" href="/blog/vocabulary/([^/]+)/"><img[^>]*>)(.*?)</a>', trow, t)
    t = re.sub(r'<div class="appcard">.*?</div></div>', lambda m: (
        '<div class="appcard"><img src="/media/landing/mascot-cta.webp" alt="" loading="lazy">\n'
        '<b>اپ Muse English</b><p>لغت‌ها را تمرین کنید، پادکست واقعی گوش کنید و پیشرفت‌تان را ببینید. روی گوشی و کامپیوتر، در مرورگر باز می‌شود.</p>\n'
        '<div><a class="storebtn" href="/#/signup">شروع رایگان &larr;</a></div></div>'), t, count=1, flags=re.S)

    # filter pills + section heads
    def hpill(m):
        f = m.group(2)
        lab = "همهٔ لغت‌ها" if f == "all" else SUB.get(f)
        if not lab:
            UNKNOWN.add("vocab sub: " + f); lab = m.group(3)
        return '<button class="vpill hpill%s" data-f="%s">%s (%s)</button>' % (m.group(1) or "", f, lab, fa(m.group(4)))
    t = re.sub(r'<button class="vpill hpill( on)?" data-f="([^"]+)">(.*?) \((\d+)\)</button>', hpill, t)
    def hsec(m):
        f = m.group(2)
        lab = SUB.get(f)
        if not lab:
            UNKNOWN.add("vocab sub: " + f); return m.group(0)
        return m.group(1) + '<h2>%s<span class="hen" dir="ltr" lang="en">%s</span></h2>\n<p>لغت‌های رایجی که در موقعیت‌های واقعی می‌شنوید و به کار می‌برید.</p>' % (lab, m.group(3))
    t = re.sub(r'(<section class="hsec" data-sec="([^"]+)">\s*<div class="hsec-head"><span class="hico">[^<]*</span><div>)<h2>(.*?) Words</h2>\s*<p>Common words you.ll hear and use in real .*? situations\.</p>', hsec, t)
    t = re.sub(r'<h2>Useful Phrases</h2>\s*<p>Common phrases for real .*? situations\.</p>', '<h2>عبارت‌های کاربردی</h2>\n<p>جمله‌های آماده برای موقعیت‌های واقعی.</p>', t)
    t = S(t, '<h2>Listen to a Real Conversation</h2>\n<p>Hear these words and phrases in a natural conversation.</p>',
          '<h2>یک گفت‌وگوی واقعی گوش کنید</h2>\n<p>همین لغت‌ها و عبارت‌ها را در یک گفت‌وگوی طبیعی بشنوید.</p>')
    t = S(t, '<h2>Quick Quiz</h2>\n<p>Test your vocabulary knowledge.</p>', '<h2>آزمون سریع</h2>\n<p>ببینید چند لغت را یاد گرفته‌اید.</p>')
    t = re.sub(r'(<button class="seeall" data-t="[^"]+">)See all &rsaquo;</button>', r'\1همه را ببینید &lsaquo;</button>', t)

    # word cards: whole card LTR, Persian part of speech + meaning
    t = re.sub(r'<div class="wcard((?: wx)?)"((?: style="[^"]*")?)>', r'<div class="wcard\1"\2 dir="ltr">', t)
    def wbody(m):
        ww, pos = m.group(1), m.group(2).strip()
        out = '<div class="ww">%s</div><div class="wpos">%s</div>' % (ww, pos_fa(pos) if pos else "")
        mean = meaning(ww)
        if mean:
            out += '\n<div class="wfa">%s</div>' % html.escape(mean)
        return out
    t = re.sub(r'<div class="ww">(.*?)</div><div class="wpos">(.*?)</div>', wbody, t)
    t = S(t, 'aria-label="Play pronunciation"', 'aria-label="پخش تلفظ"')
    t = S(t, 'aria-label="Play phrase"', 'aria-label="پخش عبارت"')

    # phrases
    def phrase(m):
        hint = plain(m.group(2))
        f = PHRASE_FA.get(hint)
        if not f:
            UNKNOWN.add("phrase hint: " + hint); f = m.group(2)
        return '<div><b dir="ltr" lang="en">%s</b><small>%s</small></div>' % (m.group(1), f)
    t = re.sub(r'<div><b>(.*?)</b><small>(.*?)</small></div>', phrase, t)
    t = S(t, '<span class="chev">&rsaquo;</span></div>', '<span class="chev">&lsaquo;</span></div>')

    # conversation
    t = S(t, 'alt="Conversation illustration"', 'alt="تصویر گفت‌وگو"')
    t = S(t, '<button class="tbtn" data-t="transcript">View transcript</button>', '<button class="tbtn" data-t="transcript">نمایش متن گفت‌وگو</button>')
    t = S(t, '<div class="transcript" id="transcript">', '<div class="transcript" id="transcript" dir="ltr" lang="en">')

    # quiz
    t = re.sub(r'<h3>Ready to test yourself\?</h3><p>(\d+) questions &middot; pick the correct answer</p>',
               lambda m: '<h3>آماده‌اید خودتان را امتحان کنید؟</h3><p>%s سؤال &middot; جواب درست را انتخاب کنید</p>' % fa(m.group(1)), t)
    t = S(t, '<button class="qstart">Start Quiz &rarr;</button>', '<button class="qstart">شروع آزمون &larr;</button>')
    t = S(t, '<h2>Quiz: Test Yourself</h2>\n<p>Choose the correct answer for each question, then check your score.</p>',
          '<h2>آزمون: خودتان را امتحان کنید</h2>\n<p>برای هر سؤال جواب درست را انتخاب کنید و بعد نمره‌تان را ببینید.</p>')
    def qq(m):
        num, rest = m.group(1), m.group(2)
        wm = re.match(r"Which word means '(.*)'\?$", rest, re.S)
        if wm:
            body = "کدام لغت این معنی را دارد؟ ⁦'%s'⁩" % wm.group(1)
        elif rest == "What is this?":
            body = "این چیست؟"
        else:
            UNKNOWN.add("quiz question: " + re.sub(r"'.*'", "'…'", rest)); body = rest
        return '<div class="qq">سؤال %s. %s</div>' % (fa(num), body)
    t = re.sub(r'<div class="qq">Q(\d+)\. (.*?)</div>', qq, t, flags=re.S)
    t = S(t, 'alt="What is this?"', 'alt="این چیست؟"')
    t = S(t, '<button class="qcheck">Check answers</button>', '<button class="qcheck">بررسی جواب‌ها</button>')

    t = gfoot_fa(t)

    # page script
    for a, b in [
        ("var idx=0,score=0;", "var idx=0,score=0;" + FD_JS),
        (r"/^Q\d+\.\s*/", r"/^(?:Q\d+|سؤال [۰-۹]+)\.\s*/"),
        ("<span>Question '+(idx+1)+' of '+qs.length+'</span>", "<span>سؤال '+fd(idx+1)+' از '+fd(qs.length)+'</span>"),
        ("Next &rarr;</button>';", "بعدی &larr;</button>';"),
        ("(idx===qs.length-1)?'See results →':'Next →'", "(idx===qs.length-1)?'دیدن نتیجه ←':'بعدی ←'"),
        ("'Perfect! Amazing work!'", "'عالی! همه را درست جواب دادید!'"),
        ("'Great job! Keep it up!'", "'آفرین! همین‌طور ادامه بدهید!'"),
        ("'Good effort! Keep practicing!'", "'خوب بود! باز هم تمرین کنید.'"),
        ("'Keep practicing and try again!'", "'تمرین کنید و دوباره امتحان کنید!'"),
        ("<div class=\"score\">'+score+'/'+qs.length+'</div>", "<div class=\"score\">'+fd(score)+' از '+fd(qs.length)+'</div>"),
        ("Try again \\u2192", "دوباره امتحان کنید \\u2190"),
        ("b.textContent=open?'View transcript':'Hide transcript';", "b.textContent=open?'نمایش متن گفت‌وگو':'بستن متن گفت‌وگو';"),
        ("b.textContent.indexOf('See all')===0", "b.textContent.indexOf('همه را')===0"),
        ("b.innerHTML=show?'Show less &rsaquo;':'See all &rsaquo;';", "b.innerHTML=show?'کمتر &lsaquo;':'همه را ببینید &lsaquo;';"),
    ]:
        t = S(t, a, b)
    return t, t != o

def vocab_step():
    changed = 0
    base = os.path.join(REPO, "blog", "vocabulary")
    p = os.path.join(base, "index.html")
    if os.path.exists(p):
        t, ch = do_vocab_hub(p)
        if ch: write(p, t); changed += 1
    for p in sorted(glob.glob(os.path.join(base, "*", "index.html"))):
        t, ch = do_vocab_topic(p, os.path.basename(os.path.dirname(p)))
        if ch: write(p, t); changed += 1
    return changed

# ---------------------------------------------------------------- grammar
GRAM_FA = {
    "present-simple": "زمان حال ساده", "present-continuous": "زمان حال استمراری",
    "present-simple-vs-present-continuous": "حال ساده یا حال استمراری", "stative-verbs": "فعل‌های حالتی (ایستا)",
    "was-were": "was و were (گذشتهٔ فعل to be)", "past-simple": "زمان گذشتهٔ ساده", "past-continuous": "زمان گذشتهٔ استمراری",
    "past-simple-vs-past-continuous": "گذشتهٔ ساده یا گذشتهٔ استمراری", "used-to": "ساختار used to (عادت‌های گذشته)",
    "past-perfect": "زمان گذشتهٔ کامل (ماضی بعید)", "past-perfect-continuous": "گذشتهٔ کامل استمراری",
    "narrative-tenses": "زمان‌های روایی: تعریف کردن داستان در گذشته", "present-perfect": "زمان حال کامل (ماضی نقلی)",
    "for-since": "for، since و ago", "present-perfect-vs-past-simple": "حال کامل یا گذشتهٔ ساده",
    "present-perfect-continuous": "حال کامل استمراری", "will-and-shall": "will و shall", "be-going-to": "ساختار be going to",
    "will-vs-going-to": "will یا going to", "future-time-clauses": "جمله‌واره‌های زمانی آینده (when، as soon as)",
    "future-continuous-future-perfect": "آیندهٔ استمراری و آیندهٔ کامل", "be-to-be-about-to": "be about to، be due to و be to",
    "future-in-the-past": "آینده در گذشته (was going to، would)", "zero-and-first-conditional": "شرطی نوع صفر و نوع اول",
    "second-conditional": "شرطی نوع دوم", "third-conditional": "شرطی نوع سوم", "mixed-conditionals": "شرطی‌های ترکیبی",
    "conditionals-unless-provided": "unless، as long as، provided، in case و even if", "wish-if-only": "wish و if only (آرزو و حسرت)",
    "unreal-past": "گذشتهٔ غیرواقعی (it's time، would rather)", "inverted-conditionals": "شرطی‌های وارونه (Had I known)",
    "can-could-be-able-to": "can، could و be able to (توانایی و امکان)", "must-have-to": "must و have to (اجبار)",
    "should-ought-to": "should، ought to و had better (توصیه)", "may-might": "may و might (احتمال)",
    "modals-of-deduction": "فعل‌های وجهی برای حدس و استنتاج", "should-have-could-have-neednt-have": "should have، could have و needn't have",
    "requests-offers-permission": "درخواست، پیشنهاد و اجازه گرفتن", "would-like": "would like، would rather و prefer",
    "passive-voice": "جملهٔ مجهول", "passive-reporting-structures": "مجهولِ گزارشی (It is said that)",
    "causative-have-get": "ساختار سببی با have و get", "reported-speech": "نقل قول غیرمستقیم", "reporting-verbs": "فعل‌های گزارشی",
    "question-words-and-forms": "کلمه‌های پرسشی و ساختن سؤال", "indirect-questions": "سؤال‌های غیرمستقیم",
    "question-tags": "سؤال‌های کوتاه آخر جمله (Question Tags)", "so-do-i-neither-do-i": "جواب کوتاه، So do I و Neither do I",
    "gerund-or-infinitive": "اسم مصدر یا مصدر با to", "verbs-change-meaning-ing-infinitive": "فعل‌هایی که با ing و to معنی‌شان فرق می‌کند",
    "infinitive-of-purpose": "بیان هدف (to، in order to، so that)", "would-be-get-used-to": "be used to و get used to",
    "defining-relative-clauses": "جمله‌واره‌های موصولی محدودکننده", "non-defining-relative-clauses": "جمله‌واره‌های موصولی غیرمحدودکننده",
    "a-an-the": "حرف تعریف a، an و the", "the-or-no-article": "the یا بدون حرف تعریف", "plural-nouns": "اسم‌های جمع",
    "countable-uncountable-nouns": "اسم‌های قابل‌شمارش و غیرقابل‌شمارش", "possessive-s": "مالکیت با آپاستروف و s",
    "noun-modifiers-compound-nouns": "اسم‌های مرکب و اسم در نقش صفت", "subject-verb-agreement": "مطابقت فاعل و فعل",
    "this-that-these-those": "this، that، these و those (اسم‌های اشاره)", "some-any": "some و any",
    "much-many-a-few-a-little": "much، many، a lot of، a few و a little", "quantifiers": "کمیت‌نماها: all، most، each، every و none",
    "both-either-neither-not-only": "ساختارهای دوتایی: both، either، neither و not only",
    "subject-pronouns-possessive-adjectives": "ضمیرهای فاعلی و صفت‌های ملکی", "object-pronouns": "ضمیرهای مفعولی",
    "possessive-pronouns": "ضمیرهای ملکی (mine، yours)", "reflexive-reciprocal-pronouns": "ضمیرهای انعکاسی و each other",
    "comparatives-superlatives": "صفت تفضیلی و عالی", "ed-ing-adjectives": "صفت‌های ed‌دار و ing‌دار",
    "adjective-order": "ترتیب صفت‌ها", "too-enough": "too و enough", "so-such-so-that": "so، such و so that",
    "quite-rather-fairly": "quite، rather، fairly و pretty", "gradable-adjectives": "صفت‌های درجه‌پذیر و مطلق",
    "adverbs-of-manner": "قیدهای حالت", "adverbs-of-frequency": "قیدهای تکرار", "word-order": "ترتیب کلمه‌ها در جمله",
    "still-yet-already": "still، yet، already، any more و no longer", "prepositions-of-time-in-on-at": "حرف اضافهٔ زمان: in، on و at",
    "prepositions-of-place": "حرف اضافهٔ مکان", "adjectives-and-prepositions": "صفت و حرف اضافه",
    "verbs-and-prepositions": "فعل و حرف اضافه", "nouns-and-prepositions": "اسم و حرف اضافه", "phrasal-verbs": "فعل‌های عبارتی",
    "and-but-or-so-because": "حرف‌های ربط and، but، or، so و because", "time-conjunctions": "حرف‌های ربط زمانی و ترتیب رویدادها",
    "although-despite-in-spite-of": "although، despite و in spite of", "because-as-since": "because، as، since و due to (بیان دلیل)",
    "like-as-as-if": "like، as و as if", "advanced-cohesion": "انسجام متن و نشانه‌های گفتمان",
    "participle-clauses": "جمله‌واره‌های وصفی (Participle Clauses)", "ellipsis-substitution": "حذف و جایگزینی",
    "cleft-sentences": "جمله‌های شکافته و do تأکیدی", "inversion-negative-adverbials": "وارونگی بعد از قیدهای منفی",
    "fronting-for-emphasis": "جلو آوردن اجزای جمله برای تأکید", "introductory-it": "it مقدماتی (It is)",
    "nominalisation": "اسم‌سازی در انگلیسی رسمی", "hedging-distancing": "محتاط‌گویی و فاصله گرفتن از ادعا",
    "subjunctive": "وجه التزامی (I insist that he be)", "verb-to-be": "فعل to be (am، is، are)", "have-got": "have got",
    "there-is-there-are": "there is و there are", "imperatives": "جمله‌های امری", "make-or-do": "make یا do",
}
FAM_FA = {
    "present-tenses": "زمان حال: ساده و استمراری", "past-tenses": "زمان‌های گذشته در انگلیسی",
    "present-perfect-tenses": "حال کامل: ساده و استمراری", "future-forms": "زمان آینده در انگلیسی",
    "conditionals": "جمله‌های شرطی در انگلیسی", "modal-verbs": "فعل‌های وجهی در انگلیسی", "passive": "جملهٔ مجهول در انگلیسی",
    "reporting": "نقل قول غیرمستقیم و فعل‌های گزارشی", "questions": "سؤال و جواب کوتاه", "verb-patterns": "الگوهای فعل: ing یا to",
    "relative-clauses": "جمله‌واره‌های موصولی", "articles": "حرف تعریف در انگلیسی", "nouns": "اسم در انگلیسی",
    "determiners": "تعیین‌کننده‌ها و کمیت‌نماها", "pronouns": "ضمیر در انگلیسی", "adjectives-and-adverbs": "صفت و قید",
    "prepositions": "حرف اضافه و فعل عبارتی", "linking-words": "کلمه‌های ربط در انگلیسی",
    "sentence-structure": "ساختار جمله و تأکید", "academic-english": "انگلیسی آکادمیک و رسمی", "verb-basics": "فعل‌های پایه در انگلیسی",
}
GSIDE = {"a1": "گرامر پایه برای زندگی روزمره", "a2": "با اعتمادبه‌نفس بیشتر انگلیسی حرف بزنید", "b1": "موضوع‌های پیچیده‌تر گرامری",
         "b2": "دقیق‌تر حرف بزنید", "c1": "منظورتان را با جزئیات برسانید", "c2": "گرامر پیشرفته را کامل یاد بگیرید"}
LV_EN = {"a1": "Beginner", "a2": "Elementary", "b1": "Intermediate", "b2": "Upper-intermediate", "c1": "Advanced", "c2": "Proficiency"}

def short_fa(s):
    return re.sub(r"\s*\(.*?\)\s*$", "", s)

def do_grammar_index(path):
    t = open(path, encoding="utf-8").read()
    if MARK in t:
        return t, False
    o = t
    n = len(re.findall(r'<a class="gcard"', t))
    title = "گرامر انگلیسی از A1 تا C2: قاعده، مثال و تمرین | Muse English"
    desc = "راهنمای رایگان گرامر انگلیسی: %s موضوع از سطح A1 تا C2، هر کدام با قاعده، مثال، اشتباه‌های رایج و تمرین تعاملی." % fa(n)
    t = head_common(t, title, desc)
    t = ld_fix(t, title, CRUMBS, desc)
    t = gnav_fa(t, "/blog/grammar/")
    t = re.sub(r'<div class="gcrumbs">.*?</div>', '<div class="gcrumbs"><a href="/fa/">خانه</a> &nbsp;&lsaquo;&nbsp; گرامر</div>', t, count=1, flags=re.S)
    t = S(t, '<h1>Grammar <span class="org">Guides</span></h1>', '<h1>گرامر <span class="org">انگلیسی</span></h1>')
    t = S(t, '<p class="gsub">Clear explanations, real examples and practice exercises for every level (A1&ndash;C2).</p>',
          '<p class="gsub">توضیح روشن، مثال واقعی و تمرین برای هر سطح، از <bdi>A1</bdi> تا <bdi>C2</bdi>.</p>')
    for a, b in [("<b>Simple explanations</b><span>Easy to understand</span>", "<b>توضیح ساده</b><span>راحت و قابل‌فهم</span>"),
                 ("<b>Real examples</b><span>From everyday life</span>", "<b>مثال واقعی</b><span>از زندگی روزمره</span>"),
                 ("<b>Practice exercises</b><span>Check your learning</span>", "<b>تمرین</b><span>یادگیری‌تان را بسنجید</span>")]:
        t = S(t, a, b)
    t = S(t, 'alt="Atish studying English grammar"', 'alt="ماسکوت Muse English در حال یادگرفتن گرامر"')
    t = S(t, '<button class="gpill on" data-f="all">All</button>', '<button class="gpill on" data-f="all">همه</button>')
    t = S(t, 'placeholder="Search grammar topics..." aria-label="Search grammar topics"', 'placeholder="جست‌وجوی موضوع گرامر…" aria-label="جست‌وجوی موضوع گرامر"')
    t = re.sub(r'(<h2><svg.*?</svg>) All Grammar Guides</h2>', r'\1 همهٔ راهنماهای گرامر</h2>', t, count=1, flags=re.S)
    t = re.sub(r'<p id="gcount">(\d+) guides &middot; Step-by-step grammar lessons with examples and exercises\.</p>',
               lambda m: '<p id="gcount">%s راهنما &middot; درس‌های گام‌به‌گام گرامر با مثال و تمرین.</p>' % fa(m.group(1)), t)

    def fam(m):
        key, h3, cnt = m.group(1), m.group(2), m.group(3)
        f = FAM_FA.get(key)
        if not f:
            UNKNOWN.add("grammar family: " + key); f = plain(h3)
        lk = re.search(r'<a href="([^"]+)">', h3)
        inner = '<a href="%s">%s</a>' % (lk.group(1), fa_html(f)) if lk else fa_html(f)
        return '<section class="gfam" data-family="%s">\n<div class="gfam-head"><h3>%s</h3><span class="gfam-count">%s موضوع</span></div>' % (key, inner, fa(cnt))
    t = re.sub(r'<section class="gfam" data-family="([^"]+)">\s*<div class="gfam-head"><h3>(.*?)</h3><span class="gfam-count">(\d+) topics?</span></div>', fam, t)

    def gcard(m):
        lv, title_en, slug, rest = m.group(1), m.group(2), m.group(3), m.group(4)
        f = GRAM_FA.get(slug)
        if not f:
            UNKNOWN.add("grammar: " + slug); return m.group(0)
        rest = re.sub(r'<b>(.*?)</b><span class="gsub">Rules, examples &amp; exercises</span><span class="gread">Read guide &rarr;</span>',
                      lambda b: '<b dir="ltr" lang="en">%s</b><span class="gsub">%s</span><span class="gread">خواندن راهنما &larr;</span>' % (b.group(1), fa_html(f)), rest)
        return '<a class="gcard" data-level="%s" data-title="%s %s" href="/blog/grammar/%s/">%s</a>' % (lv, title_en, html.escape(f), slug, rest)
    t = re.sub(r'<a class="gcard" data-level="([^"]*)" data-title="([^"]*)" href="/blog/grammar/([^/"]+)/">(.*?)</a>', gcard, t, flags=re.S)
    t = S(t, '<div class="gempty" id="gempty" style="display:none">No guides match your search. Try another word or level.</div>',
          '<div class="gempty" id="gempty" style="display:none">راهنمایی پیدا نشد. کلمه یا سطح دیگری را امتحان کنید.</div>')
    t = S(t, '<h3>Grammar by level</h3>', '<h3>گرامر بر اساس سطح</h3>')
    t = re.sub(r'(<a class="gside-lv" href="#" data-sidelevel="([abc][12])"><span class="llvl llvl-\2">[ABC][12]</span>)<span><b>[^<]*</b><span>[^<]*</span></span><span class="gchev">&rsaquo;</span></a>',
               lambda m: m.group(1) + '<span><b>%s</b><span>%s</span></span><span class="gchev">&lsaquo;</span></a>' % (LV_FA[m.group(2)], GSIDE[m.group(2)]), t)
    t = re.sub(r'(<h3><span style="color:#FF9600">&#128293;</span>) Popular topics</h3>', r'\1 موضوع‌های پرطرفدار</h3>', t)
    def gpop(m):
        f = GRAM_FA.get(m.group(1))
        if not f:
            UNKNOWN.add("grammar: " + m.group(1)); return m.group(0)
        return '<a class="gside-pop" href="/blog/grammar/%s/"><span class="gnum">%s</span><span>%s</span><span class="gchev">&lsaquo;</span></a>' % (m.group(1), fa(m.group(2)), fa_html(short_fa(f)))
    t = re.sub(r'<a class="gside-pop" href="/blog/grammar/([^/]+)/"><span class="gnum">(\d+)</span><span>.*?</span><span class="gchev">&rsaquo;</span></a>', gpop, t)
    t = S(t, 'alt="Atish inviting you to get the app">\n<div><h2>Want to improve your grammar faster?</h2>\n<p>Get daily lessons, practice exercises and real conversations with the Muse English app.</p></div>\n<a class="gcta-btn" href="/blog/">Start today&rsquo;s lesson &rarr;</a>',
          'alt="">\n<div><h2>می‌خواهید گرامرتان سریع‌تر بهتر شود؟</h2>\n<p>درس روزانه، تمرین و گفت‌وگوهای واقعی در اپ Muse English.</p></div>\n<a class="gcta-btn" href="/blog/">شروع درس امروز &larr;</a>')
    t = gfoot_fa(t)
    t = S(t, "<script>\n(function(){\nvar fams=", "<script>\n(function(){\n" + FD_JS + "\nvar fams=")
    t = S(t, "count.textContent=vis+' guide'+(vis===1?'':'s');", "count.textContent=fd(vis)+' راهنما';")
    return t, t != o

FA_TOP = ('<header class="fa-top"><a class="fa-brand" href="/fa/"><img src="/icons/icon-192.png" alt="">Muse English</a>'
          '<nav aria-label="منوی اصلی">%s</nav><a class="fa-go" href="/#/signup">شروع رایگان</a></header>')

GRAM_JS = [
    ("alert('Pick an answer first.')", "alert('اول یک گزینه را انتخاب کنید.')"),
    ("alert('Tap the wrong part first.')", "alert('اول روی بخش غلط بزنید.')"),
    ("expl.innerHTML = (correct ? '✅ Correct! ' : '❌ Not quite. Accepted: ' + accept.join(', ')) + '<br>' + expl.innerHTML;",
     "expl.innerHTML = '<div class=\"fa-fb\" dir=\"rtl\">' + (correct ? '✅ درست است!' : '❌ درست نیست. جواب درست: <bdi dir=\"ltr\">' + accept.join(', ') + '</bdi>') + '</div>' + expl.innerHTML;"),
    ("expl.innerHTML = (correct ? '✅ Correct! ' : '❌ Not quite. ') + expl.innerHTML;",
     "expl.innerHTML = '<div class=\"fa-fb\" dir=\"rtl\">' + (correct ? '✅ درست است!' : '❌ درست نیست.') + '</div>' + expl.innerHTML;"),
]

def do_grammar_page(path, slug):
    t = open(path, encoding="utf-8").read()
    o = t
    if MARK not in t:
        t = grammar_phase1(t, slug)
    T = GF.topics(REPO).get(slug)
    if T:
        t = grammar_phase2(t, slug, T)
    return t, t != o

def grammar_phase2(t, slug, T):
    """Rebuild the guide body from data/grammar (A1–B1 in Persian where written)."""
    i = t.find("</h1>")
    if i < 0:
        return t
    i += 5
    ends = [x for x in (t.find("<h2>گرامرهای مرتبط</h2>", i), t.find('<div class="cta">', i), t.find('<footer class="fa-foot">', i)) if x >= 0]
    if not ends:
        return t
    j = min(ends)
    t = t[:i] + "\n" + GF.render_body(T, GF.see_also_links(t[i:j], REPO)) + "\n\n" + t[j:]
    if GF.has_fa(T):
        en = plain(T["h1"])
        f = GRAM_FA.get(slug) or en
        fs, es = short_fa(f), short_fa(en)
        latin = bool(re.search(r"[A-Za-z]", fs))
        lv = sorted(p["level"] for p in T["points"])
        desc = ("آموزش %s%s به زبان فارسی، با مثال‌های انگلیسی: قاعده‌ها، اشتباه‌های رایج و تمرین تعاملی، از سطح %s تا %s. رایگان در Muse English."
                % (fs, "" if latin else " (%s)" % es, lv[0].upper(), lv[-1].upper()))
        t = head_common(t, None, desc)
        t = ld_fix(t, None, None, desc)
    return t

def grammar_phase1(t, slug):
    o = t
    hm = re.search(r"<h1>(.*?)</h1>", t, re.S)
    if not hm:
        return t
    en = plain(hm.group(1))
    family = "<h2>Topics in this family</h2>" in t
    f = FAM_FA.get(slug) if family else GRAM_FA.get(slug)
    if not f:
        UNKNOWN.add("grammar: " + slug)
        f = en
    lv = sorted(set(re.findall(r"href='#([abc][12])'", t)) or set(x.lower() for x in re.findall(r"lvl-badge'>([ABC][12])<", t))) or ["a1", "c2"]
    lo, hi = lv[0].upper(), lv[-1].upper()
    fs, es = short_fa(f), short_fa(en)
    latin = bool(re.search(r"[A-Za-z]", fs))
    if family:
        title = "%s: نمای کلی و مقایسه | Muse English" % f
        desc = "نمای کلی %s، با مقایسهٔ ساختارها و لینک به آموزش کامل هر موضوع، از سطح %s تا %s." % (f, lo, hi)
    else:
        title = ("گرامر %s در انگلیسی: قاعده، مثال و تمرین | Muse English" % fs) if latin else ("گرامر %s (%s): قاعده، مثال و تمرین | Muse English" % (fs, es))
        desc = "آموزش %s%s از سطح %s تا %s: قاعده‌ها، مثال‌ها، اشتباه‌های رایج و تمرین تعاملی. رایگان در Muse English." % (fs, "" if latin else " (%s)" % es, lo, hi)
    t = head_common(t, title, desc)
    t = ld_fix(t, fs if latin else "%s (%s)" % (fs, es), {**CRUMBS, en: fs}, desc)
    for a, b in GRAM_JS:
        t = S(t, a, b)
    # generator bug: the answers array sat inside onclick="…" with raw double quotes, so gap-fill checks never ran
    t = re.sub(r'onclick="checkGap\(\'([^\']*)\', (\[[^\]]*\])\)"',
               lambda m: 'onclick="checkGap(\'%s\', %s)"' % (m.group(1), m.group(2).replace('"', '&quot;')), t)

    t = re.sub(r"<body>\s*", lambda m: "<body>\n" + FA_TOP % links_html("/blog/grammar/") + "\n", t, count=1)
    t = re.sub(r'<div class="crumbs">.*?</div>', lambda m: '<div class="crumbs"><a href="/fa/">خانه</a> / <a href="/blog/grammar/">گرامر</a> / %s</div>' % fa_html(fs), t, count=1, flags=re.S)
    h1 = fa_html(f) if f == en else '%s<span class="h1en" dir="ltr" lang="en">%s</span>' % (fa_html(f), hm.group(1))
    t = re.sub(r"<h1>.*?</h1>", lambda m: "<h1>%s</h1>" % h1, t, count=1, flags=re.S)

    # the English guide itself: one LTR block
    i = t.index("</h1>") + 5
    ends = [x for x in (t.find("<h2>Related grammar</h2>", i), t.find('<div class="cta">', i), t.find("</body>", i)) if x >= 0]
    j = min(ends)
    t = t[:i] + '\n<div class="gram-en" dir="ltr" lang="en">' + t[i:j].rstrip() + "\n</div>\n\n" + t[j:]
    for lvk, lve in LV_EN.items():
        t = S(t, "<h2>%s · %s</h2>" % (lvk.upper(), lve), '<h2>%s · <span lang="fa">%s</span></h2>' % (lvk.upper(), LV_FA[lvk]))
    t = re.sub(r"<h3>Practice: ([ABC][12])</h3>", r'<h3 class="fa-l" dir="rtl" lang="fa">تمرین سطح <bdi>\1</bdi></h3>', t)
    t = S(t, "<p><strong>Common mistakes:</strong></p>", '<p class="fa-l" dir="rtl" lang="fa"><strong>اشتباه‌های رایج:</strong></p>')
    t = S(t, "<p><strong>See also:</strong></p>", '<p class="fa-l" dir="rtl" lang="fa"><strong>همچنین ببینید:</strong></p>')
    t = re.sub(r'(<button class="excheck"[^>]*>)Check</button>', r"\1بررسی</button>", t)
    t = S(t, 'placeholder="Type your answer"', 'placeholder="جواب را بنویسید"')
    t = S(t, "<h2>Topics in this family</h2>", '<h2 class="fa-l" dir="rtl" lang="fa">موضوع‌های این بخش</h2>')
    def tcard(m):
        g = GRAM_FA.get(m.group(2))
        if not g:
            UNKNOWN.add("grammar: " + m.group(2)); return m.group(0)
        return m.group(1) + '\n<p class="tfa" dir="rtl" lang="fa">%s</p>' % fa_html(g)
    t = re.sub(r'(<div class="tcard">\s*<h3><a href="/blog/grammar/([^/"]+)/">.*?</a></h3>)', tcard, t)

    # related + CTA + footer (Persian)
    t = S(t, "<h2>Related grammar</h2>", "<h2>گرامرهای مرتبط</h2>")
    def rel(m):
        g = GRAM_FA.get(m.group(1)) or FAM_FA.get(m.group(1))
        if not g:
            UNKNOWN.add("grammar: " + m.group(1)); return m.group(0)
        return '<li><a href="/blog/grammar/%s/">%s<small dir="ltr" lang="en">%s</small></a></li>' % (m.group(1), fa_html(g), m.group(2))
    t = re.sub(r"<ul class='relgrid'>.*?</ul>", lambda u: re.sub(r'<li><a href="/blog/grammar/([^/"]+)/">(.*?)</a></li>', rel, u.group(0)), t, count=1, flags=re.S)
    t = re.sub(r'<div class="cta"><p>.*?</p>\s*<a href="/#/preview">Open today&#x27;s lesson</a></div>',
               '<div class="cta"><p>این گرامر را در جمله‌های واقعی هم ببینید: هر روز یک درس تازهٔ Muse English با صدا آماده است.</p>\n'
               '<a href="/#/preview">باز کردن درس امروز</a></div>', t, count=1, flags=re.S)
    t = t.replace("</body>", '<footer class="fa-foot">%s</footer>\n</body>' % FOOT_LINE, 1)
    return t

def grammar_step():
    changed = 0
    base = os.path.join(REPO, "blog", "grammar")
    p = os.path.join(base, "index.html")
    if os.path.exists(p):
        t, ch = do_grammar_index(p)
        if ch: write(p, t); changed += 1
    for p in sorted(glob.glob(os.path.join(base, "*", "index.html"))):
        t, ch = do_grammar_page(p, os.path.basename(os.path.dirname(p)))
        if ch: write(p, t); changed += 1
    return changed

# ---------------------------------------------------------------- about
ABOUT_BODY = """<div class="wrap"><div class="lhero"><div class="crumbs"><a href="/fa/">خانه</a> / دربارهٔ ما</div>
<h1>دربارهٔ <span class="grad">Muse English</span></h1>
<p class="meta">اپلیکیشن رایگان آموزش زبان انگلیسی، با درس روزانه برای هر سطح.</p></div>
<div class="lesbox"><h3>Muse English چیست؟</h3>
<p><strong>Muse English</strong> یک اپلیکیشن رایگان آموزش زبان انگلیسی است. هر روز برای هر شش سطح CEFR، از A1 (مبتدی) تا C2 (تسلط کامل)، یک درس تازه منتشر می‌کند؛ پس همیشه در سطحی یاد می‌گیرید که اندازهٔ خودتان است.</p></div>
<div class="lesbox"><h3>در هر درس روزانه چه هست؟</h3>
<p>هر درس این‌ها را دارد: <strong>لغت</strong> با عکس، معنی، مثال و تلفظ صوتی؛ یک <strong>پادکست</strong>، یعنی گفت‌وگوی مایا و لنا، مجری‌های ما، با لغت‌های همان روز؛ <strong>تمرین شدوئینگ</strong> با صدای باکیفیت جمله‌ها؛ یک نکتهٔ <strong>گرامری</strong> با توضیح روشن و مثال؛ و <strong>آزمون</strong> برای سنجیدن پیشرفت.</p></div>
<div class="lesbox"><h3>برای چه کسانی است؟</h3>
<p>برای هر کسی که انگلیسی یاد می‌گیرد، از مبتدیِ کامل تا پیشرفته. یک بار سطح‌تان را انتخاب کنید؛ هر صبح یک درس تازه منتظرتان است. خواندن درس‌ها در این سایت رایگان است و حساب کاربری لازم ندارد.</p></div>
<div class="lesbox"><h3>چه کسانی Muse English را ساخته‌اند؟</h3>
<p>Muse English را گروهی از معلم‌های زبان انگلیسی و برنامه‌نویس‌ها ساخته‌اند که می‌خواهند روشی را که به خودشان کمک کرد با دیگران در میان بگذارند. درس‌ها زیر نظر معلم‌های باتجربهٔ زبان آماده می‌شوند.</p></div>
<div class="lesbox"><h3>واقعاً رایگان است؟</h3>
<p>بله: درس‌ها، پادکست، لغت‌ها، تمرین شدوئینگ و آزمون‌ها رایگان‌اند.</p></div>
<div class="lesbox"><h3>تماس با ما</h3>
<p>سؤال یا پیشنهادی دارید؟ به <a href="mailto:info@museenglishapp.com"><bdi>info@museenglishapp.com</bdi></a> ایمیل بزنید.</p></div>
<div class="keepbox"><div><h3>همین امروز شروع کنید</h3><p>سطح‌تان را انتخاب کنید و اولین درس را ببینید.</p></div>
<a class="obtn" href="/blog/">دیدن درس‌ها &larr;</a></div></div>
"""

def do_about(path):
    t = open(path, encoding="utf-8").read()
    if MARK in t:
        return t, False
    o = t
    title = "دربارهٔ Muse English؛ درس روزانهٔ رایگان انگلیسی از A1 تا C2"
    desc = ("Muse English اپلیکیشن رایگان آموزش زبان انگلیسی است با درس روزانه برای هر شش سطح CEFR: لغت با معنی فارسی، "
            "پادکست، تمرین شدوئینگ، گرامر و آزمون.")
    t = head_common(t, title, desc)
    t = ld_fix(t, title, CRUMBS, desc)
    a, b = t.find('<nav class="lnav">'), t.find('<footer class="lfoot">')
    e = t.find("</footer>", b) + len("</footer>")
    if a < 0 or b < 0:
        UNKNOWN.add("about: template changed"); return o, False
    t = t[:a] + lnav("") + "\n" + ABOUT_BODY + lfoot() + t[e:]
    return t, t != o

def about_step():
    p = os.path.join(REPO, "about", "index.html")
    if not os.path.exists(p):
        return 0
    t, ch = do_about(p)
    if ch:
        write(p, t)
    return 1 if ch else 0

# ---------------------------------------------------------------- driver
def write(path, t):
    open(path, "w", encoding="utf-8").write(t)

def main():
    changed = 0
    for level in ("a1", "a2", "b1", "b2", "c1", "c2"):
        lessons = all_lessons(level)
        for slug in lessons:
            p = os.path.join(REPO, "blog", level, slug + ".html")
            t, ch = do_lesson(p, level, slug, lessons)
            if ch: write(p, t); changed += 1
        p = os.path.join(REPO, "blog", level, "index.html")
        if os.path.exists(p):
            t, ch = do_level(p, level)
            if ch: write(p, t); changed += 1
    p = os.path.join(REPO, "blog", "index.html")
    if os.path.exists(p):
        t, ch = do_blog_index(p)
        if ch: write(p, t); changed += 1
    for extra in EXTRA_STEPS:
        changed += extra()
    changed += GF.export_app(REPO, GRAM_FA)  # Persian grammar for the app: data/grammar/fa/
    print("blog_fa: %d files changed" % changed)
    if GF.STALE:
        UNKNOWN.update("grammar text changed, Persian skipped: " + x for x in GF.STALE)
    if UNKNOWN:
        print("blog_fa: no Persian label yet (left in English) — tell Claude:\n  " + "\n  ".join(sorted(UNKNOWN)))

def no_en_step():
    """/en/ was removed on 2026-11-12 (it 301s to /fa/). The sitemap generator in the daily job
    still lists it, so drop it from every sitemap here, and remove en/ if something rebuilt it."""
    n = 0
    for f in sorted(os.listdir(REPO)):
        if f.startswith("sitemap") and f.endswith(".xml"):
            p = os.path.join(REPO, f)
            t = open(p, encoding="utf-8").read()
            u = re.sub(r"[ \t]*<url>\s*<loc>https://museenglishapp\.com/en/?</loc>.*?</url>\s*?\n", "", t, flags=re.S)
            if u != t: write(p, u); n += 1
    p = os.path.join(REPO, "en", "index.html")
    if os.path.exists(p):
        os.remove(p); n += 1
        try: os.rmdir(os.path.dirname(p))
        except OSError: pass
    return n

EXTRA_STEPS = [vocab_step, grammar_step, about_step, no_en_step]

if __name__ == "__main__":
    main()
