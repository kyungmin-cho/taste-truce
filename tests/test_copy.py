import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
BANNED=['Illustrative','illustrative','simulated','Simulated','example data','not affiliated','unavailable']
# Files a judge reads: static copy and markup, step and table text built on the server, and the README.
UI_FILES=['static/copy.js','static/steps.js','static/app.js','static/index.html','agent.py','logic.py','scenes.py','README.md']
# Working labels and over-precise numbers that must not reach the screen.
SCREEN_BANNED=['saved_utc','saved-time','Saved ·','Saved calculation','Saved scene','CACHE','STALE','latency_ms','elapsed_ms','toFixed(2)','Highlight =','= not returned','not returned','not in candidate pool','returned sample','eligible no-signal','toFixed(1)','toFixed(3)','are dimmed','✳','↗','live-dot','eyebrow','YOUR SHARED TABLE','POWERED BY','avatar','friend-number','<footer','Every tool call leaves a trail','A fair pick has a reason','Resolve → retrieve',
  'take ','bound candidate union','maximin-rank','entity_ids','Direct plan','validate category','widen → retry',' entities`','All input names',
  'overlap with popularity','Top 3:','left out</div>','No popularity sample','In both top 10s','eligible places','recorded conditions',
  'friendPin','top 3</span>']
SCREEN_FILES=['static/copy.js','static/steps.js','static/app.js','static/index.html']
# Caveats and limiter timings kept out of the docs.
DOC_BANNED=['synthetic data only','1.25-second','0.30 seconds','does not provision','unavailable','does not configure','recorded run','latency','from cache']
DOC_FILES=['README.md','DEPLOY.md']

class CopyTests(unittest.TestCase):
    def test_ui_copy_has_no_hedges(self):
        for name in UI_FILES:
            text=(ROOT/name).read_text()
            for word in BANNED:
                with self.subTest(file=name,word=word):self.assertNotIn(word,text)

    def test_screen_shows_no_working_labels(self):
        for name in SCREEN_FILES:
            text=(ROOT/name).read_text()
            for word in SCREEN_BANNED:
                with self.subTest(file=name,word=word):self.assertNotIn(word,text)

    def test_docs_have_no_caveats(self):
        for name in DOC_FILES:
            text=(ROOT/name).read_text()
            for word in DOC_BANNED:
                with self.subTest(file=name,word=word):self.assertNotIn(word,text)
