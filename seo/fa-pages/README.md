# Persian pages (/fa/) and the English home (/en/)

- `content.py`: the Persian page text. Written by Claude for Alireza. Do not edit the wording; ask Alireza/Claude.
- `render.py`: renders `content.py` into `fa/**/index.html` (template: `fa/assets/fa.css`).
  Run: `python3 seo/fa-pages/render.py .`
- `make_en.py`: builds `en/index.html` (English home) from the landing block of the root `index.html`.
  Run after the landing generator changes the root landing: `python3 seo/fa-pages/make_en.py .`
  (The dated "Today's lessons" + hero card on /en/ also refresh in the browser from `/`.)

Home routing (index.html head script, "PERSIAN HOME"): a bare `/` with no app signal opens `/fa/`,
or `/en/` if the visitor chose English (`localStorage.muse_home_lang`). Sitemap: `sitemap-fa.xml` (in robots.txt).
