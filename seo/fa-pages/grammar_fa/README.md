# Persian grammar text (phase 2)

One file per guide: `<slug>.txt` (Persian, written by Claude for Alireza; don't edit the wording, ask).
`<slug>.src.json` is the English each entry was translated from. If the English in `data/grammar/` changes,
that entry falls back to English and `blog_fa.py` reports it, so the Persian is updated.
Format and keys: see the docstring of `../grammar_fa.py`. Coverage: `python3 seo/fa-pages/grammar_fa.py status`.

Writing rules used: A1–B1 only; English examples stay in `*…*`; a whole formula is one island
(`*visit + -ed = visited*`); notes and mistake explanations start with Persian; `←` between Persian parts.
