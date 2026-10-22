import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
PRIMARY,ACCENT='#28323c','#6363b0'
STYLE_FILES=['static/styles.css','static/steps.js','static/app.js','static/index.html']

def channels(value):
    value=value.lstrip('#')
    if len(value)==3:value=''.join(c*2 for c in value)
    return [int(value[i:i+2],16) for i in (0,2,4)]

def luminance(value):
    linear=[c/255/12.92 if c/255<=0.03928 else ((c/255+0.055)/1.055)**2.4 for c in channels(value)]
    return 0.2126*linear[0]+0.7152*linear[1]+0.0722*linear[2]

def contrast(a,b='#ffffff'):
    high,low=sorted([luminance(a),luminance(b)],reverse=True)
    return (high+0.05)/(low+0.05)

def css_var(name):
    return re.search(r'--'+name+r':(#[0-9a-fA-F]{6})',(ROOT/'static/styles.css').read_text()).group(1).lower()

class StyleTests(unittest.TestCase):
    def test_palette_is_primary_accent_and_grays(self):
        for name in STYLE_FILES:
            for value in re.findall(r'#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])',(ROOT/name).read_text()):
                value=value.lower();rgb=channels(value)
                with self.subTest(file=name,color=value):
                    self.assertTrue(value in (PRIMARY,ACCENT) or max(rgb)-min(rgb)<=16,value)

    def test_background_is_white(self):
        self.assertEqual(css_var('paper'),'#ffffff')

    def test_text_colors_meet_contrast(self):
        for name in ('ink','accent','muted'):
            with self.subTest(color=name):self.assertGreaterEqual(contrast(css_var(name)),4.5)
        self.assertEqual((css_var('ink'),css_var('accent')),(PRIMARY,ACCENT))

    def test_no_decorative_shapes(self):
        css=(ROOT/'static/styles.css').read_text()
        rules=re.sub(r'/\*.*?\*/','',css,flags=re.S)
        for pattern in [r'box-shadow:(?!none)',r'gradient\(',r'border-radius:(?:[3-9]|\d{2,})px',r'letter-spacing:\s*[1-9]',r'text-transform:\s*uppercase',r'border-(?:left|top):\s*[2-9]px',r'transform:\s*translate',r'scroll-behavior:\s*smooth']:
            with self.subTest(pattern=pattern):self.assertIsNone(re.search(pattern,rules))
