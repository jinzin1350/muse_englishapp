#!/usr/bin/env python3
"""Build + verify ~/workspace/english-app-static/lessons/b1/2026-10-21.json"""
import json, os, sys

BASE = '/home/hatch/workspace/english-app-static'
MEDIA = 'media/b1/2026-10-21'
LEVEL_DIR = f'{BASE}/{MEDIA}'

vocab = [
    ("aircraft", "noun", "a vehicle that flies, like a plane", "هواپیما، هواگرد", "Many aircraft fly over our house.", "AIR-kraaft"),
    ("airport", "noun", "a place where planes take off and land", "فرودگاه", "We arrived at the airport early.", "AIR-port"),
    ("at risk of", "phrase", "In a situation where something bad might happen.", "در معرض خطر", "People who smoke are at risk of lung disease.", "ut RISK uv"),
    ("available", "adjective", "Able to be used or found.", "در دسترس، موجود", "Are there any rooms available for tonight?", "uh-VAY-luh-bul"),
    ("away [distance]", "adverb", "At a distance from a place.", "دور، فاصله", "The shop is 5 miles away.", "uh-WAY"),
    ("beach", "noun", "Sandy or stony land next to the sea.", "ساحل", "We walked on the beach yesterday.", "beech"),
    ("bike", "noun", "A bicycle.", "دوچرخه", "Let's ride our bikes to the park.", "byk"),
]

def slug(w):
    return w.lower().replace(' ', '-').replace('[', '').replace(']', '')

words = []
for w, pos, meaning, persian, example, pron in vocab:
    s = slug(w)
    words.append({
        "word": w, "pos": pos, "meaning": meaning, "example": example,
        "pronunciation": pron, "persian": persian,
        "photo": f"{MEDIA}/photos/{s}.jpg",
        "word_audio": f"{MEDIA}/word-audio/{s}.mp3",
    })

quiz = json.load(open(f'{LEVEL_DIR}/word-quiz.json'))
grammar = json.load(open(f'{LEVEL_DIR}/grammar-block.json'))

transcript = [l.strip() for l in open(f'{LEVEL_DIR}/shadowing-transcript.txt').read().strip().split('\n')]
shadowing_title = transcript[0]
shadowing_sents = [l for l in transcript[1:] if l]
sentence_audio = [f"{MEDIA}/shadowing-sentences/{i:03d}.mp3" for i in range(1, len(shadowing_sents) + 1)]

manifest = {
    "date": "2026-10-21",
    "theme": "travel & transport",
    "level": "b1",
    "cefr": "B1",
    "words": words,
    "pronunciation_audio": f"{MEDIA}/pronunciation.mp3",
    "podcast": {
        "title": "Muse English: Travel and Transport",
        "audio": f"{MEDIA}/podcast.mp3",
        "cover": None,
        "transcript": f"{MEDIA}/podcast-transcript.txt",
    },
    "shadowing": {
        "title": shadowing_title,
        "audio": f"{MEDIA}/shadowing.mp3",
        "transcript": f"{MEDIA}/shadowing-transcript.txt",
        "sentence_audio": sentence_audio,
    },
    "quiz": quiz,
    "grammar": grammar,
}

out = f'{BASE}/lessons/b1/2026-10-21.json'
json.dump(manifest, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('wrote', out)

# ---- verification ----
d = json.load(open(out))
errors = []
def check(path):
    p = f'{BASE}/{path}'
    if not os.path.isfile(p): errors.append(f'MISSING: {path}'); return
    if os.path.getsize(p) == 0: errors.append(f'EMPTY: {path}')

for w in d['words']:
    check(w['photo']); check(w['word_audio'])
check(d['pronunciation_audio'])
check(d['podcast']['audio']); check(d['podcast']['transcript'])
check(d['shadowing']['audio']); check(d['shadowing']['transcript'])
for p in d['shadowing']['sentence_audio']: check(p)

# sentence count == transcript sentences
n_trans = len([l for l in open(f'{LEVEL_DIR}/shadowing-transcript.txt').read().strip().split('\n')[1:] if l.strip()])
if len(d['shadowing']['sentence_audio']) != n_trans:
    errors.append(f"sentence_audio count {len(d['shadowing']['sentence_audio'])} != transcript {n_trans}")
# photo sizes
import subprocess
for w in d['words']:
    p = f'{BASE}/{w["photo"]}'
    if os.path.isfile(p) and os.path.getsize(p) >= 120*1024:
        errors.append(f'PHOTO TOO BIG: {w["photo"]}')
# counts
print('words:', len(d['words']), '| quiz:', len(d['quiz']), '| grammar quiz:', len(d['grammar']['quiz']), '| sentence clips:', len(d['shadowing']['sentence_audio']))
if errors:
    print('ERRORS:'); [print(' -', e) for e in errors]; sys.exit(1)
print('ALL CHECKS PASSED')
