import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
BANNED=['Illustrative','illustrative','simulated','Simulated','example data','not affiliated','unavailable']
# Files a judge reads: static copy and markup, step and table text built on the server, and the README.
UI_FILES=['static/copy.js','static/app.js','static/index.html','agent.py','logic.py','scenes.py','README.md']
# Working labels and over-precise numbers that must not reach the screen.
SCREEN_BANNED=['saved_utc','saved-time','Saved ·','Saved calculation','Saved scene','CACHE','STALE','latency_ms','elapsed_ms','toFixed(2)']
SCREEN_FILES=['static/copy.js','static/app.js','static/index.html']

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
