import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('archive_sources', ROOT / 'scripts/archive-sources.py')
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)

class SourceIntegrityTests(unittest.TestCase):
    def test_headers_are_removed_but_historical_notes_and_year_headings_survive(self):
        html = '<div><table class="ws-header"><tr><td>下一卷</td></tr></table><pre>莊宗同光元年</pre><p>正文〈<b>校勘按語</b>〉<br><br>第二段</p><div class="licensetpl"><p>license</p></div></div>'
        self.assertEqual(archive.extract(html), ['莊宗同光元年', '正文〈校勘按語〉', '第二段'])

    def test_no_visible_source_text_is_silently_dropped(self):
        blocks = {'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'dt', 'dd', 'li'}
        for source in (ROOT / 'content/five-dynasties/sources').glob('*.json'):
            with self.subTest(source=source.stem):
                payload = json.loads(source.read_text())
                html = payload['response']['parse']['text']['*']
                missing = []
                def visit(node):
                    if archive.excluded(node) or node.tag in blocks: return
                    if node.attrs.get('id') == 'headerContainer':
                        # Old-format headers contain only author metadata plus a preface.
                        def check_preface(item):
                            if item.tag == 'td':
                                text = archive.clean_text(item).strip()
                                if len(text) > 300: self.assertIn(text, archive.extract(html))
                                return
                            for child in item.children:
                                if isinstance(child, archive.Node): check_preface(child)
                        check_preface(node)
                        return
                    for child in node.children:
                        if isinstance(child, archive.Node): visit(child)
                        elif child.strip(): missing.append(child.strip())
                visit(archive.Document(html).root)
                self.assertEqual(missing, [], 'Text outside recognized historical blocks')
                chapter = json.loads((ROOT / 'content/five-dynasties/chapters' / source.name).read_text())
                self.assertEqual([p['original'] for p in chapter['paragraphs']], archive.extract(html))

if __name__ == '__main__': unittest.main()
