#!/usr/bin/env python3
"""Guard for every push and every deploy (Claude, 2026-11-12).

    python3 tools/check_app.py            # run before pushing; exit 1 if anything is wrong
    python3 tools/check_app.py --deploy   # Cloudflare Pages build command

--deploy first repairs what is safe to repair automatically, then checks:
  1. python3 seo/fa-pages/blog_fa.py .  (Persian blog frame and grammar, Persian data for the
     app, /en/ removed from the sitemaps). So the published site is Persian even if the daily
     job forgot this step.
  2. Point the ?v= hashes in index.html at the current files.
A failed check makes the Cloudflare build fail, so the broken commit is never published and
the live site stays on the last good version.

Checks:
  - js/main.js is exactly the build of src/app/*.js (tools/build_app.py --check)
  - node --check js/main.js and js/fa-ui.js (when node is installed)
  - Claude's Persian work is still there (functions + script tag), no /en/ leftovers
  - index.html ?v= hashes match the files
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'tools'))
import build_app  # noqa: E402

DEPLOY = '--deploy' in sys.argv
problems = []


def read(rel):
    with open(os.path.join(REPO, rel), encoding='utf-8') as f:
        return f.read()


def run(cmd):
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


if DEPLOY:
    code, out = run([sys.executable, 'seo/fa-pages/blog_fa.py', '.'])
    print(out.splitlines()[-1] if out else 'blog_fa: (no output)')
    if code != 0:
        problems.append('seo/fa-pages/blog_fa.py failed:\n' + out[-2000:])
    if build_app.fix_hashes():
        print('check_app: fixed ?v= hashes in index.html for this deploy')

# 1. js/main.js must be the build of src/app
if build_app.build_text() != read('js/main.js'):
    problems.append('js/main.js is not the build of src/app/*.js. Edit src/app/ and run '
                    'python3 tools/build_app.py (never edit js/main.js directly).')

# 2. syntax
if shutil.which('node'):
    for f in ('js/main.js', 'js/fa-ui.js'):
        code, out = run(['node', '--check', f])
        if code != 0:
            problems.append('%s has a syntax error:\n%s' % (f, out[-1500:]))

# 3. Claude's Persian work still in place
main_js, index = read('js/main.js'), read('index.html')
for fn, what in (('function faSync', 'Persian app UI engine (src/app/05-fa-ui-engine.js)'),
                 ('function pvBodyHTML', 'Persian sample lesson page (src/app/08-preview.js)'),
                 ('function gFaLoad', 'Persian grammar guides in the app (src/app/14-grammar.js)')):
    if not re.search(r'\b' + re.escape(fn) + r'\s*\(', main_js):
        problems.append('missing "%s": the %s was removed. Restore it from git history.' % (fn, what))
if not re.search(r'<script[^>]+src="/js/fa-ui\.js\?v=[0-9a-f]+"', index):
    problems.append('index.html lost the <script src="/js/fa-ui.js?v=…"> tag (Persian app labels).')
if 'hreflang="en"' in index:
    problems.append('index.html has hreflang="en" again (/en/ was removed on 2026-11-12).')
if 'muse_home_lang' in index:
    problems.append('index.html has the old /en/ home redirect (muse_home_lang) again.')
if os.path.exists(os.path.join(REPO, 'en', 'index.html')) and not DEPLOY:
    problems.append('en/index.html exists again (/en/ 301s to /fa/; don\'t recreate it).')
for f in sorted(os.listdir(REPO)):
    if f.startswith('sitemap') and f.endswith('.xml') and 'museenglishapp.com/en/' in read(f):
        problems.append('%s lists /en/ (run python3 seo/fa-pages/blog_fa.py . as the last step).' % f)

# 4. cache-busting hashes
for rel, name in build_app.HASHED:
    if not os.path.exists(os.path.join(REPO, rel)):
        continue
    m = re.search(re.escape(name) + r'\?v=([0-9a-f]+)', index)
    if m and m.group(1) != build_app.file_hash(rel):
        problems.append('index.html %s?v=%s but the file hash is %s (run python3 tools/build_app.py).'
                        % (name, m.group(1), build_app.file_hash(rel)))

if problems:
    print('\ncheck_app: FAILED (%d)%s' % (len(problems), ' — this deploy is blocked' if DEPLOY else ''))
    for p in problems:
        print(' - ' + p)
    sys.exit(1)
print('check_app: all checks passed' + (' — ready to deploy' if DEPLOY else ''))
