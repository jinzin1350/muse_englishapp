#!/usr/bin/env python3
import json, os

MEDIA = "media/a2/2026-10-12"
sentences = [l for l in open("/home/hatch/workspace/english-app-static/media/a2/2026-10-12/shadowing-transcript.txt").read().splitlines() if l.strip()]
assert len(sentences) == 22, len(sentences)
sentence_audio = [f"{MEDIA}/shadowing-sentences/{i:03d}.mp3" for i in range(1, 23)]

words = [
    {"word": "charger", "pos": "noun",
     "meaning": "a small device that gives power to a phone battery",
     "example": "I forgot my phone charger at home.",
     "pronunciation": "CHAR-jer", "persian": "شارژر",
     "photo": f"{MEDIA}/photos/charger.jpg",
     "word_audio": f"{MEDIA}/word-audio/charger.mp3"},
    {"word": "keyboard", "pos": "noun",
     "meaning": "the set of keys you press to write on a computer",
     "example": "The keys on my keyboard are big and easy to press.",
     "pronunciation": "KEY-board", "persian": "صفحه‌کلید",
     "photo": f"{MEDIA}/photos/keyboard.jpg",
     "word_audio": f"{MEDIA}/word-audio/keyboard.mp3"},
    {"word": "wifi", "pos": "noun",
     "meaning": "a way to connect to the internet without a cable",
     "example": "Is there free wifi in this cafe?",
     "pronunciation": "WY-fy", "persian": "وای‌فای",
     "photo": f"{MEDIA}/photos/wifi.jpg",
     "word_audio": f"{MEDIA}/word-audio/wifi.mp3"},
    {"word": "email", "pos": "noun",
     "meaning": "a message you send or receive on the internet",
     "example": "She sent me an email yesterday.",
     "pronunciation": "EE-mayl", "persian": "ایمیل",
     "photo": f"{MEDIA}/photos/email.jpg",
     "word_audio": f"{MEDIA}/word-audio/email.mp3"},
    {"word": "laptop", "pos": "noun",
     "meaning": "a small computer you can carry with you",
     "example": "He opens his laptop every morning.",
     "pronunciation": "LAP-top", "persian": "لپ‌تاپ",
     "photo": f"{MEDIA}/photos/laptop.jpg",
     "word_audio": f"{MEDIA}/word-audio/laptop.mp3"},
]

quiz = [
    {"question": "What does 'charger' mean?",
     "options": ["a bag for a phone", "a small device that gives power to a phone battery",
                 "a kind of screen", "a loud bell"], "answer": 1},
    {"question": "What does 'keyboard' mean?",
     "options": ["a game for kids", "a kind of food",
                 "the set of keys you press to write on a computer", "a small bag"], "answer": 2},
    {"question": "What does 'wifi' mean?",
     "options": ["a way to connect to the internet without a cable", "a kind of phone",
                 "a TV show", "a loud bell"], "answer": 0},
    {"question": "What does 'email' mean?",
     "options": ["a paper letter", "a phone call", "a photo",
                 "a message you send or receive on the internet"], "answer": 3},
    {"question": "What does 'laptop' mean?",
     "options": ["a big TV", "a small computer you can carry with you",
                 "a kind of table", "a phone charger"], "answer": 1},
]

grammar_explanation = (
    "**a lot of** means many or much. We use it in positive sentences with countable and uncountable nouns.\n\n"
    "Use **many** with countable nouns in negative sentences and questions. Emails and chargers are countable.\n\n"
    "Use **much** with uncountable nouns in negative sentences and questions. Time and money are uncountable.\n\n"
    "**a few** is for small countable numbers, and **a little** is for small uncountable amounts. Both mean some, but not a lot.\n\n"
    "**too many** with countable nouns and **too much** with uncountable nouns mean more than you need.\n\n"
    "**enough** goes before a noun, like enough battery, and after an adjective, like fast enough.\n\n"
    "Use **any** with uncountable or plural nouns in negative sentences. Use **no** plus a noun with a positive verb for zero quantity."
)

grammar_examples = [
    "I have *a lot of* photos on my laptop. (many photos)",
    "She does not have *many* chargers. (few chargers)",
    "He wrote *a few* emails this morning. (some, not many)",
    "We have *a little* time to fix the wifi. (some, not much)",
    "You have *too many* apps on your phone. (more than you need)",
    "My wifi is fast *enough* for video calls. (good speed)",
]

grammar_practice = [
    {"q": "How many emails do you write every day?", "a": "I write a few emails every day."},
    {"q": "Do you have enough time to study English?", "a": "Yes, I have enough time."},
]

grammar_quiz = [
    {"question": "I have ___ photos on my laptop.",
     "options": ["a lot of", "much", "a little", "few"], "answer": 0},
    {"question": "Do you have ___ chargers at home?",
     "options": ["much", "many", "a little", "little"], "answer": 1},
    {"question": "We don't have ___ time today.",
     "options": ["many", "much", "a few", "few"], "answer": 1},
    {"question": "She wrote ___ emails this morning.",
     "options": ["a little", "a few", "much", "many"], "answer": 1},
    {"question": "I need ___ water, please.",
     "options": ["a few", "many", "a little", "few"], "answer": 2},
    {"question": "You have ___ apps on your phone. That's more than you need!",
     "options": ["too much", "enough", "too many", "a little"], "answer": 2},
    {"question": "He drinks ___ coffee. He should drink less.",
     "options": ["too many", "a few", "too much", "enough"], "answer": 2},
    {"question": "My wifi is fast ___ for video calls.",
     "options": ["much", "enough", "many", "a little"], "answer": 1},
    {"question": "There aren't ___ eggs in the fridge.",
     "options": ["some", "any", "no", "much"], "answer": 1},
    {"question": "We have ___ battery left. Let's charge the phone.",
     "options": ["not", "no", "any", "much"], "answer": 1},
]

manifest = {
    "date": "2026-10-12",
    "theme": "technology",
    "level": "a2",
    "cefr": "A2",
    "words": words,
    "pronunciation_audio": f"{MEDIA}/pronunciation.mp3",
    "podcast": {
        "title": "Muse English: Technology in Daily Life",
        "audio": f"{MEDIA}/podcast.mp3",
        "cover": None,
        "transcript": f"{MEDIA}/podcast-transcript.txt",
    },
    "shadowing": {
        "title": "My Tech Day",
        "audio": f"{MEDIA}/shadowing.mp3",
        "transcript": f"{MEDIA}/shadowing-transcript.txt",
        "sentence_audio": sentence_audio,
    },
    "quiz": quiz,
    "grammar": {
        "title": "9B: Quantifiers",
        "explanation": grammar_explanation,
        "examples": grammar_examples,
        "practice": grammar_practice,
        "quiz": grammar_quiz,
        "audio": f"{MEDIA}/grammar-en.mp3",
    },
}

out = "/home/hatch/workspace/english-app-static/lessons/a2/2026-10-12.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

# ---- VERIFY ----
base = "/home/hatch/workspace/english-app-static"
d = json.load(open(out, encoding="utf-8"))
assert d["date"] == "2026-10-12" and d["level"] == "a2"
assert len(d["words"]) == 5 and len(d["quiz"]) == 5 and len(d["grammar"]["quiz"]) == 10
assert len(d["shadowing"]["sentence_audio"]) == 22

def check(p):
    fp = os.path.join(base, p)
    assert os.path.isfile(fp) and os.path.getsize(fp) > 0, f"BAD: {p}"
    return os.path.getsize(fp)

for w in d["words"]:
    check(w["photo"]); check(w["word_audio"])
check(d["pronunciation_audio"])
for k in ("audio", "transcript"):
    check(d["podcast"][k])
for k in ("audio", "transcript"):
    check(d["shadowing"][k])
for p in d["shadowing"]["sentence_audio"]:
    check(p)
check(d["grammar"]["audio"])
print("MANIFEST OK:", out, "| photos 5/5, clips 5/5, quiz 5, grammar quiz 10, sentences 22/22")
