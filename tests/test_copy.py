import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
BANNED=['Illustrative','illustrative','simulated','Simulated','example data','not affiliated','unavailable']
# Files whose strings reach the screen: static copy and markup, plus step and table text built on the server.
UI_FILES=['static/copy.js','static/app.js','static/index.html','agent.py','logic.py','scenes.py']

class CopyTests(unittest.TestCase):
    def test_ui_copy_has_no_hedges(self):
        for name in UI_FILES:
            text=(ROOT/name).read_text()
            for word in BANNED:
                with self.subTest(file=name,word=word):self.assertNotIn(word,text)
