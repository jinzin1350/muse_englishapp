# Classifier prompt — Muse English vocabulary

Run once per lesson, after its words are generated and before it is published.
Build the filled prompt with:

    python3 vocab_registry.py prompt --taxonomy vocab-taxonomy.json --registry vocab-registry.json \
        --lesson lesson.json --template classify-words-prompt.md

Send the output as the user message at temperature 0, parse the reply as JSON,
save it, and pass it to `vocab_registry.py apply`. Everything below the marker
is the prompt; the placeholders are filled from the taxonomy, the registry and
the lesson, so never hard-code categories here.

<!-- PROMPT START -->
You sort English vocabulary words into the fixed Muse English taxonomy. Pages such as "Fruit Vocabulary with Pictures" are built from your answers, so a wrong placement shows a word to learners on a page where they would not expect it.

Lesson level: {LEVEL}
Lesson theme (a hint only): {THEME}

<subtopics>
{SUBTOPICS}
</subtopics>

<collections>
{COLLECTIONS}
</collections>

<known_senses>
Words already in the registry that may match words in this lesson. If a word below has the same meaning as one of these, reuse its lemma, pos and sense_key exactly.
{KNOWN_SENSES}
</known_senses>

<words>
{WORDS_JSON}
</words>

For each word, decide the following. The sense to classify is the one given by its meaning.

1. lemma: the dictionary form ("children" → "child"). Keep multi-word items whole ("give up", "on the other hand").
2. sense_key: 1–3 lowercase words naming this sense, so different meanings of one word stay separate ("bank" → "money" or "river side").
3. primary: the one subtopic where a learner would most expect to find this word on a "Subtopic Vocabulary with Pictures" page. Ask: if a learner opened that page, would this word clearly belong there?
   - Classify by the word's own meaning, not by the lesson theme. In a work lesson, "commute" goes to travel-transport/traffic-commuting.
   - If no subtopic clearly fits, use null. Do not force abstract or general words ("significant", "approach", "however") into a topic. null is correct and expected for many B2–C2 words.
   - A word's level does not limit its subtopic: the A1 word "fruit" can go to food-drink/diet-nutrition if that is where it belongs.
4. secondary: up to 2 other subtopics where the word also clearly belongs. Use [] if none.
5. collections: each collection the item belongs to, usually []:
   - phrasal-verbs: verb + particle with its own meaning ("give up")
   - idioms: meaning not predictable from the parts ("piece of cake")
   - collocations: a fixed multi-word combination ("make a decision")
   - linking-words: connects clauses or ideas ("however", "as a result")
   - academic-words: general academic vocabulary ("analyse", "significant")
6. confidence: how sure you are about primary, from 0 to 1. Go below 0.8 when two subtopics fit about equally well or the meaning is unclear. If primary is null, give your confidence that null is right.

Boundary rules:
- Dishes, snacks, desserts and meal names → food-drink/meals-snacks. Raw ingredients → food-drink/groceries. Cooking actions (boil, fry, chop) → food-drink/cooking. Utensils and appliances for cooking → food-drink/kitchen.
- Body parts → body-health/body-parts, even in a sports or clothes lesson.
- Lasting personality traits (generous, stubborn) → feelings-personality/personality. Momentary feelings (angry, relieved) → feelings-personality/emotions.
- Professions (nurse, engineer) → work-jobs/jobs, not the field they work in.
- Weather words → weather-environment/weather, even when the lesson is about travel or sports.

Examples:
- {"word": "breakfast", "meaning": "the food we eat in the morning"} → primary "food-drink/meals-snacks", secondary ["city-daily-life/daily-routine"], confidence 0.9
- {"word": "commute", "meaning": "to travel to work"} → primary "travel-transport/traffic-commuting", secondary ["city-daily-life/daily-routine"], confidence 0.9
- {"word": "nevertheless", "meaning": "despite that"} → primary null, collections ["linking-words"], confidence 0.95
- {"word": "burnout", "meaning": "exhaustion from working too much"} → primary "body-health/mental-health", secondary ["work-jobs/careers-success"], confidence 0.8

Reply with JSON only: an array with one object per input word, in input order. Copy "word" and "pos" exactly from the input.
[{"word": "...", "lemma": "...", "pos": "...", "sense_key": "...", "primary": "hub/subtopic or null", "secondary": [], "collections": [], "confidence": 0.0}]
