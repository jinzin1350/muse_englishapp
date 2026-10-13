# Muse English vocabulary hub system (SEO)

- `vocab-taxonomy.json` — the only list of categories: 18 hubs, 103 subtopics,
  5 collections, thresholds. Never hard-code categories elsewhere.
- `classify-words-prompt.md` — the LLM prompt that decides where each word belongs.
- `vocab_registry.py` — deterministic part: validates taxonomy and classifications,
  merges words, counts per page, decides indexability, suggests gaps. Stdlib only.
- `vocab-registry.json` — one entry per word sense (`lemma|pos|sense_key`).
  All vocabulary pages are built from it. Lesson URLs are extensionless
  (final form after Phase 1).

Rebuilding the registry from scratch takes 126 LLM calls (temperature 0);
treat this file as a data asset — never delete it.
