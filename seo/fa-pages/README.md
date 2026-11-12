# Persian pages (/fa/)

- `content.py`: the Persian page text. Written by Claude for Alireza. Do not edit the wording; ask Alireza/Claude.
- `render.py`: renders `content.py` into `fa/**/index.html` using the English landing's design system
  (it generates `fa/assets/fa-site.css` from the landing CSS in the root `index.html` + an RTL layer).
  Re-run it after the landing CSS changes, so the Persian pages keep matching.
  Run: `python3 seo/fa-pages/render.py .`
- `/en/` (the English home) was removed on 2026-11-12 and 301s to `/fa/` (`_redirects`). Don't recreate it.
  `blog_fa.py` drops `/en/` from the sitemaps and deletes `en/` if something rebuilds it.
- NOTE: the live `fa/**/index.html` have the GTM snippet and the mobile hamburger menu, which `render.py` does
  not produce yet. Don't run `render.py` until it is synced, or those two are lost.

Home routing (index.html head script, "PERSIAN HOME"): a bare `/` with no app signal opens `/fa/`. Sitemap: `sitemap-fa.xml` (in robots.txt).

## Persian-first blog (`blog_fa.py`, phase 1)

The daily lesson job, the vocabulary builder and the grammar renderer write English pages. `blog_fa.py`
turns everything around the learning content into Persian (RTL): menus, footers, breadcrumbs, headings,
buttons, quiz/exercise labels, titles/meta, image alts, and adds the Persian meaning to every word card.
The learning content itself (words, examples, transcripts, grammar explanations/exercises) stays English (LTR).
Covers: `blog/` index, level pages, every lesson, `blog/vocabulary/**`, `blog/grammar/**`, `about/`.
Styles: `fa/assets/blog-fa.css` (loaded by the script; bump `CSS_HREF` `?v=` when it changes).

Run it after EVERY generation step (daily job, vocabulary rebuild, grammar rebuild), before committing:
`python3 seo/fa-pages/blog_fa.py .`
It is idempotent (a second run prints `0 files changed`). If it prints "no Persian label yet", a new
theme/topic/grammar guide needs Persian text: send that list to Claude (that part stays English until then).
Text: written by Claude for Alireza. Don't edit the Persian wording; ask.
