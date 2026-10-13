#!/usr/bin/env python3
"""Muse English vocabulary registry.

Deterministic half of the vocabulary-hub system. The LLM classifier (see
classify-words-prompt.md) decides where a word belongs; this module checks
that decision against the taxonomy, merges words into one registry, counts
words per page, decides which pages are indexable, and suggests which
subtopics the next lessons should fill.

Standard library only. Commands:

  python3 vocab_registry.py validate-taxonomy --taxonomy vocab-taxonomy.json
  python3 vocab_registry.py prompt --taxonomy T --registry R --lesson L.json --template classify-words-prompt.md
  python3 vocab_registry.py apply  --taxonomy T --registry R --lesson L.json --classification C.json
  python3 vocab_registry.py stats  --taxonomy T --registry R [--json]
  python3 vocab_registry.py gaps   --taxonomy T --registry R --level B1 [--today 2026-10-12]

Input formats (adapt build-blog.py to produce these):

  lesson.json:          {"url", "level", "date", "theme",
                         "words": [{"word", "pos", "meaning", "example", ...media fields}]}
  classification.json:  [{"word", "lemma", "pos", "sense_key", "primary",
                          "secondary": [], "collections": [], "confidence"}]
                        primary/secondary use "hub/subtopic" paths; primary may be null.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import tempfile
from collections import defaultdict

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
BRAND = " | Muse English"
TITLE_MAX = 65


# ---------- io ----------

def load_json(path, default=None):
    if default is not None and not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    """Atomic write, so a crash mid-build never leaves a half-written registry."""
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def lvl(level):
    return LEVELS.index(level)


# ---------- taxonomy ----------

class Taxonomy:
    def __init__(self, data):
        self.data = data
        self.version = data["taxonomy_version"]
        self.th = data["thresholds"]
        self.hubs = {h["slug"]: h for h in data["hubs"]}
        self.subtopics = {}
        for h in data["hubs"]:
            for s in h["subtopics"]:
                self.subtopics[f'{h["slug"]}/{s["slug"]}'] = dict(
                    s, hub=h["slug"], own_page=s.get("own_page", True))
        self.collections = {c["slug"]: c for c in data["collections"]}

    def validate(self):
        errors = []
        seen = {}
        for kind, slug in ([("hub", s) for s in self.hubs]
                           + [("subtopic", p.split("/")[1]) for p in self.subtopics]
                           + [("collection", s) for s in self.collections]):
            if slug in seen:
                errors.append(f"duplicate slug '{slug}' ({seen[slug]} and {kind})")
            seen[slug] = kind
            if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug):
                errors.append(f"bad slug '{slug}'")

        owners = defaultdict(set)  # keyword -> pages that would target it
        for slug, h in self.hubs.items():
            owners[h["keyword"]].add(slug)
        for path, s in self.subtopics.items():
            owners[s["keyword"]].add(path if s["own_page"] else s["hub"])
        for slug, c in self.collections.items():
            owners[c["keyword"]].add(slug)
        for kw, pages in owners.items():
            if len(pages) > 1:
                errors.append(f"keyword '{kw}' targeted by {sorted(pages)}")

        for path, s in self.subtopics.items():
            hub = self.hubs[s["hub"]]
            for item in (s, hub):
                if item["min_level"] not in LEVELS:
                    errors.append(f"bad min_level in {path}")
            if s["min_level"] in LEVELS and lvl(s["min_level"]) < lvl(hub["min_level"]):
                errors.append(f"{path} min_level is below its hub's")

        dt_ = self.data.get("discussion_topics", {})
        for name, path in list(dt_.get("map", {}).items()) + list(dt_.get("modern_additions", {}).items()):
            if path not in self.subtopics:
                errors.append(f"discussion topic '{name}' maps to unknown '{path}'")
        for name in list(dt_.get("renames", {})) + dt_.get("sensitive", {}).get("topics", []):
            if name not in dt_.get("map", {}):
                errors.append(f"'{name}' is not in discussion_topics.map")
        return errors


# ---------- classification ----------

def word_key(lemma, pos, sense_key):
    norm = lambda s: re.sub(r"\s+", " ", (s or "").strip().lower())
    return f"{norm(lemma)}|{norm(pos)}|{norm(sense_key)}"


def check_classification(c, tax):
    """Return (status, reasons). status: accepted | unplaced | review | invalid."""
    reasons = []
    for field in ("word", "lemma", "pos", "sense_key", "confidence"):
        if not c.get(field) and c.get(field) != 0:
            reasons.append(f"missing {field}")
    if reasons:
        return "invalid", reasons

    primary = c.get("primary")
    secondary = c.get("secondary") or []
    collections = c.get("collections") or []
    if primary is not None and primary not in tax.subtopics:
        reasons.append(f"unknown primary '{primary}'")
    for s in secondary:
        if s not in tax.subtopics:
            reasons.append(f"unknown secondary '{s}'")
        if s == primary:
            reasons.append("secondary repeats primary")
    if len(secondary) > tax.th["max_secondary_topics"]:
        reasons.append("too many secondary topics")
    for col in collections:
        if col not in tax.collections:
            reasons.append(f"unknown collection '{col}'")
    try:
        conf = float(c["confidence"])
    except (TypeError, ValueError):
        conf = -1
    if not 0 <= conf <= 1:
        reasons.append("confidence must be 0..1")
    if reasons:
        return "invalid", reasons

    if primary is not None and conf < tax.th["classification_min_confidence"]:
        return "review", [f"confidence {conf} below threshold"]
    if primary is None:
        return "unplaced", []
    return "accepted", []


def apply_lesson(registry, tax, lesson, classifications):
    """Merge one lesson's words into the registry. Returns a summary.

    Rules: one entry per lemma|pos|sense; the word keeps the lowest level it was
    taught at; an existing classification is never silently replaced, except a
    'review' entry that now gets a confident classification. Human-reviewed
    entries (source == "human") are never changed.
    """
    words = registry.setdefault("words", {})
    # Errors are per lesson: re-applying a lesson replaces its old errors (retry).
    registry["errors"] = [e for e in registry.get("errors", []) if e["lesson"] != lesson["url"]]
    errors = registry["errors"]
    by_word = {c.get("word", "").strip().lower(): c for c in classifications}
    level, url, date = lesson["level"], lesson["url"], lesson["date"]
    ref = {"url": url, "level": level, "date": date}
    summary = defaultdict(int)
    changed = set()

    for w in lesson["words"]:
        c = by_word.get(w["word"].strip().lower())
        if c is None:
            errors.append({"word": w["word"], "lesson": url, "reasons": ["no classification returned"]})
            summary["invalid"] += 1
            continue
        status, reasons = check_classification(c, tax)
        if status == "invalid":
            errors.append({"word": w["word"], "lesson": url, "reasons": reasons})
            summary["invalid"] += 1
            continue

        key = word_key(c["lemma"], c["pos"], c["sense_key"])
        entry = words.get(key)
        if entry is None:
            entry = {
                "key": key, "lemma": c["lemma"], "word": w["word"], "pos": c["pos"],
                "sense_key": c["sense_key"], "level": level, "first_seen": date,
                "lessons": [], "card": {k: v for k, v in w.items() if k != "word"},
                "primary": c.get("primary"), "secondary": c.get("secondary") or [],
                "collections": c.get("collections") or [], "confidence": float(c["confidence"]),
                "status": status, "source": "model", "taxonomy_version": tax.version,
            }
            words[key] = entry
            summary["new_" + status] += 1
            if status in ("accepted", "unplaced"):
                changed |= pages_for(entry, tax)
        else:
            summary["repeat"] += 1
            if lvl(level) < lvl(entry["level"]):
                # Lower level now teaches it: the card moves to that level's section.
                entry["level"] = level
                entry["card"] = {k: v for k, v in w.items() if k != "word"}
                changed |= pages_for(entry, tax)
            if entry["status"] == "review" and status == "accepted" and entry["source"] != "human":
                entry.update(primary=c["primary"], secondary=c.get("secondary") or [],
                             collections=c.get("collections") or [],
                             confidence=float(c["confidence"]), status="accepted",
                             taxonomy_version=tax.version)
                summary["review_resolved"] += 1
                changed |= pages_for(entry, tax)
        if ref not in entry["lessons"]:
            entry["lessons"].append(ref)

    registry["taxonomy_version"] = tax.version
    registry["updated"] = date
    return {"lesson": url, **dict(summary), "pages_changed": sorted(changed)}


def pages_for(entry, tax):
    """Pages whose word list includes this entry (full cards only, not secondary links)."""
    pages = set()
    p = entry.get("primary")
    if entry["status"] == "accepted" and p in tax.subtopics:
        pages.add(tax.subtopics[p]["hub"])
        if tax.subtopics[p]["own_page"]:
            pages.add(p)
    if entry["status"] in ("accepted", "unplaced"):
        pages |= {c for c in entry.get("collections", []) if c in tax.collections}
    return pages


def prompt_context(registry, tax, lesson):
    """Values for the {placeholders} in classify-words-prompt.md.

    KNOWN_SENSES lists registry entries that may be the same word, so the
    classifier reuses an existing sense_key instead of inventing a new one
    (which would split one word into two entries).
    """
    subtopics = "\n".join(f'{p} — {s["name"]} ({s["min_level"]}+)' for p, s in tax.subtopics.items())
    collections = "\n".join(f'{slug} — {c["name"]}' for slug, c in tax.collections.items())
    lesson_words = {w["word"].strip().lower() for w in lesson["words"]}
    known = sorted(
        f'{e["lemma"]} | {e["pos"]} | sense_key "{e["sense_key"]}" | {e["card"].get("meaning", "")}'
        for e in registry.get("words", {}).values()
        if e["lemma"].lower() in lesson_words or e["word"].lower() in lesson_words)
    return {"LEVEL": lesson["level"], "THEME": lesson.get("theme", ""),
            "SUBTOPICS": subtopics, "COLLECTIONS": collections,
            "KNOWN_SENSES": "\n".join(known) or "(none)",
            "WORDS_JSON": json.dumps([{k: w.get(k) for k in ("word", "pos", "meaning", "example")}
                                      for w in lesson["words"]], ensure_ascii=False, indent=1)}


def fill_prompt(template, values):
    for k, v in values.items():
        template = template.replace("{" + k + "}", v)
    return template


# ---------- stats ----------

def round_down_10(n):
    return n // 10 * 10


SMALL_WORDS = {"a", "an", "and", "at", "for", "in", "of", "on", "the", "to", "with"}
FIXED_CASE = {"english": "English", "ielts": "IELTS", "ai": "AI", "tv": "TV"}


def kw_title(keyword):
    """'at the doctor vocabulary' -> 'At the Doctor Vocabulary'. Titles lead with the target query."""
    out = []
    for i, w in enumerate(keyword.split()):
        if w in FIXED_CASE:
            out.append(FIXED_CASE[w])
        elif i and w in SMALL_WORDS:
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def page_title(keyword, n, kind="topic"):
    """<title> for a vocabulary page; the visible H1 uses the taxonomy 'name' instead.

    The word count is shown only if a 3-digit count would also fit, so a page's
    title pattern never flips as it grows. Collections lead with the count.
    """
    base = kw_title(keyword)
    if kind == "collection":
        with_count = lambda c: f"{c}+ {base} with Examples & Audio{BRAND}"
        without = f"{base} with Examples & Audio{BRAND}"
    else:
        with_count = lambda c: f"{base} with Pictures ({c}+ Words){BRAND}"
        without = f"{base} with Pictures{BRAND}"
    if n >= 10 and len(with_count(100)) <= TITLE_MAX:
        return with_count(round_down_10(n))
    return without if len(without) <= TITLE_MAX else f"{base}{BRAND}"


def compute_stats(registry, tax):
    th = tax.th["page_indexable_min_unique_words"]
    count = defaultdict(int)
    by_level = defaultdict(lambda: defaultdict(int))
    status_count = defaultdict(int)
    orphans = []
    for e in registry.get("words", {}).values():
        status_count[e["status"]] += 1
        p = e.get("primary")
        if p is not None and p not in tax.subtopics:
            orphans.append(e["key"])
            continue
        for page in pages_for(e, tax):
            count[page] += 1
            by_level[page][e["level"]] += 1
        if e["status"] == "accepted" and not tax.subtopics[p]["own_page"]:
            # Sections without their own page are still counted for planning.
            count[p] += 1
            by_level[p][e["level"]] += 1

    pages = []
    for slug, h in tax.hubs.items():
        n = count[slug]
        pages.append({"page": slug, "type": "hub", "url": f"/blog/vocabulary/{slug}/",
                      "words": n, "by_level": dict(by_level[slug]), "indexable": n >= th,
                      "h1": h["name"], "title": page_title(h["keyword"], n)})
    for path, s in tax.subtopics.items():
        n = count[path]
        has_page = s["own_page"] and n >= th
        pages.append({"page": path, "type": "subtopic",
                      "url": f"/blog/vocabulary/{path}/" if s["own_page"] else None,
                      "words": n, "by_level": dict(by_level[path]), "own_page": s["own_page"],
                      "has_page": has_page, "indexable": has_page, "h1": s["name"],
                      "title": page_title(s["keyword"], n) if has_page else None})
    for slug, c in tax.collections.items():
        n = count[slug]
        pages.append({"page": slug, "type": "collection", "url": f"/blog/vocabulary/{slug}/",
                      "words": n, "by_level": dict(by_level[slug]), "indexable": n >= th,
                      "h1": c["name"], "title": page_title(c["keyword"], n, "collection")})
    return {"taxonomy_version": tax.version, "status_counts": dict(status_count),
            "orphans_need_reclassification": orphans, "pages": pages}


# ---------- gap planning ----------

def recent_usage(registry, tax):
    """Last date each subtopic was taught at each level, derived from the registry."""
    last = {}
    for e in registry.get("words", {}).values():
        if e["status"] != "accepted" or e.get("primary") not in tax.subtopics:
            continue
        for ref in e["lessons"]:
            k = (e["primary"], ref["level"])
            if k not in last or ref["date"] > last[k]:
                last[k] = ref["date"]
    return last


def plan_gaps(registry, tax, level, today, cooldown_days=10, limit=8):
    """Rank subtopics for the next lesson at `level`.

    Priorities: push hubs over the index threshold first (finish what's started),
    then push own-page subtopics toward their own URL, skip anything taught at
    this level within the cooldown, and prefer subtopics near the lesson level.
    """
    th = tax.th["page_indexable_min_unique_words"]
    stats = {p["page"]: p for p in compute_stats(registry, tax)["pages"]}
    last = recent_usage(registry, tax)
    today_d = dt.date.fromisoformat(today)
    taught = defaultdict(list)
    for e in registry.get("words", {}).values():
        if e["status"] == "accepted" and e.get("primary") in tax.subtopics:
            taught[e["primary"]].append(e["lemma"])

    ranked = []
    for path, s in tax.subtopics.items():
        if lvl(s["min_level"]) > lvl(level):
            continue
        used = last.get((path, level))
        if used and (today_d - dt.date.fromisoformat(used)).days < cooldown_days:
            continue
        hub_n = stats[s["hub"]]["words"]
        n = stats[path]["words"]
        score, why = 0.0, []
        if hub_n < th:
            score += 3 + 2 * hub_n / th
            why.append(f"hub {s['hub']} at {hub_n}/{th}")
        if s["own_page"] and n < th:
            score += 1 + 2 * n / th
            why.append(f"subtopic at {n}/{th}")
        elif s["own_page"]:
            score += 0.5
            why.append("growing an indexable page")
        gap = lvl(level) - lvl(s["min_level"])
        if gap > 2:
            score -= 0.3 * (gap - 2)
            why.append("well below lesson level")
        ranked.append({"subtopic": path, "score": round(score, 2), "why": why,
                       "words_now": n, "avoid_lemmas": sorted(set(taught[path]))[:200]})
    ranked.sort(key=lambda r: (-r["score"], r["subtopic"]))
    return ranked[:limit]


# ---------- cli ----------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("validate-taxonomy", "prompt", "apply", "stats", "gaps"):
        p = sub.add_parser(name)
        p.add_argument("--taxonomy", required=True)
        if name != "validate-taxonomy":
            p.add_argument("--registry", required=True)
        if name in ("prompt", "apply"):
            p.add_argument("--lesson", required=True)
        if name == "prompt":
            p.add_argument("--template", required=True, help="classify-words-prompt.md")
        if name == "apply":
            p.add_argument("--classification", required=True)
        if name == "stats":
            p.add_argument("--json", action="store_true")
        if name == "gaps":
            p.add_argument("--level", required=True, choices=LEVELS)
            p.add_argument("--today", default=dt.date.today().isoformat())
            p.add_argument("--cooldown-days", type=int, default=10)
    a = ap.parse_args(argv)

    tax = Taxonomy(load_json(a.taxonomy))
    errs = tax.validate()
    if errs:
        print("TAXONOMY INVALID:\n  " + "\n  ".join(errs), file=sys.stderr)
        return 1
    if a.cmd == "validate-taxonomy":
        print(f"taxonomy {tax.version} OK: {len(tax.hubs)} hubs, "
              f"{len(tax.subtopics)} subtopics, {len(tax.collections)} collections")
        return 0

    registry = load_json(a.registry, default={"registry_version": 1, "words": {}, "errors": []})
    if a.cmd == "prompt":
        with open(a.template, encoding="utf-8") as f:
            template = f.read().split("<!-- PROMPT START -->", 1)[-1]
        print(fill_prompt(template, prompt_context(registry, tax, load_json(a.lesson))).strip())
    elif a.cmd == "apply":
        summary = apply_lesson(registry, tax, load_json(a.lesson), load_json(a.classification))
        save_json(a.registry, registry)
        print(json.dumps(summary, ensure_ascii=False, indent=1))
    elif a.cmd == "stats":
        s = compute_stats(registry, tax)
        if a.json:
            print(json.dumps(s, ensure_ascii=False, indent=1))
        else:
            print(f"status: {s['status_counts']}  orphans: {len(s['orphans_need_reclassification'])}")
            for p in s["pages"]:
                if p["words"]:
                    flag = "INDEX" if p["indexable"] else "-"
                    print(f"{flag:5} {p['words']:4}  {p['page']:45} {p['by_level']}")
    elif a.cmd == "gaps":
        print(json.dumps(plan_gaps(registry, tax, a.level, a.today, a.cooldown_days),
                         ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
