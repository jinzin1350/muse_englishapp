#!/usr/bin/env python3
"""Build the A2 2026-11-05 lesson manifest from verified sources."""
import json, os

BASE = "/home/hatch/workspace/english-app-static"
DATE = "2026-11-05"
LEVEL = "a2"
MEDIA = f"{BASE}/media/{LEVEL}/{DATE}"

# Words picked by vocab-next.py (verbatim fields), with "bend" as the word
# (bank word field was "bend n, v" — the "n, v" is a POS annotation, pos is
# already "noun, verb").
words_src = [
    {"word": "available", "pos": "adjective",
     "meaning": "Able to be used or found.",
     "example": "Are there any rooms available for tonight?",
     "pronunciation": "uh-VAY-luh-bul", "persian": "در دسترس، موجود"},
    {"word": "baggage reclaim", "pos": "noun phrase",
     "meaning": "The area at an airport where you collect your bags.",
     "example": "Let's go to baggage reclaim to get our suitcases.",
     "pronunciation": "BAG-ij ree-KLAYM", "persian": "قسمت تحویل بار"},
    {"word": "beach holiday", "pos": "noun phrase",
     "meaning": "A vacation spent by the sea.",
     "example": "We want to go on a beach holiday.",
     "pronunciation": "BEECH HOL-uh-day", "persian": "تعطیلات ساحلی"},
    {"word": "bend", "pos": "noun, verb",
     "meaning": "A curve in a road or object. To curve.",
     "example": "Be careful, there's a sharp bend in the road.",
     "pronunciation": "BEND", "persian": "پیچ، خم؛ خم کردن"},
    {"word": "bicycle", "pos": "noun",
     "meaning": "A vehicle with two wheels, you pedal it.",
     "example": "I ride my bicycle to school.",
     "pronunciation": "BY-suh-kul", "persian": "دوچرخه"},
]
words = []
for w in words_src:
    words.append({
        "word": w["word"], "pos": w["pos"], "meaning": w["meaning"],
        "example": w["example"], "pronunciation": w["pronunciation"],
        "persian": w["persian"],
        "photo": f"media/{LEVEL}/{DATE}/photos/{w['word']}.jpg",
        "word_audio": f"media/{LEVEL}/{DATE}/word-audio/{w['word']}.mp3",
    })

# Grammar: comparatives-superlatives page (cycle 2)
page = json.load(open("/tmp/a2-grammar-page.json"))
ex = page["exercises"]["items"]
pick = [0, 1, 3, 4, 5, 7, 9, 11, 12, 15]  # q1,q2,q4,q5,q6,q8,q10,q12,q13,q16
gquiz = [{"question": ex[i]["prompt"], "options": ex[i]["options"],
          "answer": ex[i]["answer"]} for i in pick]

grammar = {
    "title": page["h1"],
    "explanation": (
        "We use a **comparative** to compare two things. *My bicycle is **faster than** your bicycle.*\n\n"
        "We use a **superlative** to say one thing is more than all the others in a group. *Sara had **the best** beach holiday of her life.*\n\n"
        "Short adjectives add **-er** and **-est**. *Cheap → **cheaper** → **the cheapest**. A room can be **cheaper than** another room.*\n\n"
        "Long adjectives use **more** and **the most**. *A beach holiday is **more expensive than** a day at home. It is **the most relaxing** holiday.*\n\n"
        "Some words are irregular. *Good → **better** → **the best**. Bad → **worse** → **the worst**. The bend in the road was **worse than** we thought!*\n\n"
        "We use **than** after a comparative. *A train is **faster than** a bicycle.* We use **the** before a superlative. *It is **the longest** road in the town.*\n\n"
        "**As ... as** means the same. *My bag is **as heavy as** yours.* **Not as ... as** means less. *The bus is **not as fast as** the train.*\n\n"
        "Use **much** to make a comparative stronger. *This room is **much bigger than** my old room.* Do not use *very* with a comparative."
    ),
    "examples": [
        "*This is **the most beautiful** beach I've ever seen.* (long adjective — use **the most**)",
        "*The bus is **cheaper than** the train, but it's **less comfortable**.* (**less** is the opposite of more)",
        "*My new flat is **bigger than** my old one.* (big → bigger: double the g)",
        "*English is **easier** for me **than** French.* (easy → easier)",
        "*That was **the worst** meal of my life.* (bad → the worst)",
    ],
    "practice": [
        {"q": "Rewrite with a comparative: A train is fast. A bicycle is slow.",
         "a": "A train is faster than a bicycle."},
        {"q": "Rewrite with a superlative: This beach is beautiful. It is the best beach on the island.",
         "a": "This is the most beautiful beach on the island."},
        {"q": "Rewrite with 'the best': Sara had a good beach holiday. It was the best holiday of her life.",
         "a": "It was the best beach holiday of her life."},
        {"q": "Rewrite with 'not as ... as': The bend is dangerous. The straight road is safe.",
         "a": "The straight road is not as dangerous as the bend."},
    ],
    "quiz": gquiz,
    "audio": f"media/{LEVEL}/{DATE}/grammar-en.mp3",
}

word_quiz = json.load(open("/tmp/a2-word-quiz.json"))

sentences = [l.strip() for l in open(f"{MEDIA}/shadowing-transcript.txt")
             if l.strip()]
sentence_audio = [f"media/{LEVEL}/{DATE}/shadowing-sentences/{i:03d}.mp3"
                  for i in range(1, len(sentences) + 1)]

manifest = {
    "date": DATE,
    "theme": "travel & transport",
    "level": LEVEL,
    "cefr": "A2",
    "words": words,
    "pronunciation_audio": f"media/{LEVEL}/{DATE}/pronunciation.mp3",
    "podcast": {
        "title": "Muse English: Travel and Transport",
        "audio": f"media/{LEVEL}/{DATE}/podcast.mp3",
        "cover": None,
        "transcript": f"media/{LEVEL}/{DATE}/podcast-transcript.txt",
    },
    "shadowing": {
        "title": "Sara's Beach Holiday",
        "audio": f"media/{LEVEL}/{DATE}/shadowing.mp3",
        "transcript": f"media/{LEVEL}/{DATE}/shadowing-transcript.txt",
        "sentence_audio": sentence_audio,
    },
    "quiz": word_quiz,
    "grammar": grammar,
}

out = f"{BASE}/lessons/{LEVEL}/{DATE}.json"
json.dump(manifest, open(out, "w"), ensure_ascii=False, indent=1)
print("wrote", out)

# Verify: parse + every referenced file exists and is non-empty
d = json.load(open(out))
missing = []
def check(rel):
    p = os.path.join(BASE, rel)
    if not os.path.exists(p) or os.path.getsize(p) == 0:
        missing.append(rel)
for w in d["words"]:
    check(w["photo"]); check(w["word_audio"])
check(d["pronunciation_audio"])
check(d["podcast"]["audio"]); check(d["podcast"]["transcript"])
check(d["shadowing"]["audio"]); check(d["shadowing"]["transcript"])
for s in d["shadowing"]["sentence_audio"]:
    check(s)
check(d["grammar"]["audio"])
print("sentence_audio count:", len(d["shadowing"]["sentence_audio"]),
      "vs transcript lines:", len(sentences))
print("word quiz:", len(d["quiz"]), "grammar quiz:", len(d["grammar"]["quiz"]))
print("MISSING/EMPTY:", missing if missing else "none")
assert not missing
assert len(d["shadowing"]["sentence_audio"]) == len(sentences)
print("MANIFEST OK")
