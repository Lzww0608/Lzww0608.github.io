import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('archive_sources', ROOT / 'scripts/archive-sources.py')
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)

class SourceIntegrityTests(unittest.TestCase):
    def test_reign_metadata_is_refreshed_without_rewriting_cached_sources(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        previous = next(chapter for chapter in catalog['chapters'] if chapter['id'] == 'new-v10').copy()
        previous['subjects'] = ['liu-zhiyuan']
        current_spec = next(item for item in archive.SPECS if item['id'] == 'new-v10')
        files = [archive.ROOT / directory / 'new-v10.json' for directory in ['sources', 'chapters']]
        before = [file.read_bytes() for file in files]
        with patch.object(archive, 'request', side_effect=AssertionError('Cached sources must not be fetched again')):
            result = archive.capture(current_spec, previous)
        self.assertEqual(result['subjects'], ['liu-zhiyuan', 'liu-chengyou'])
        self.assertEqual(result['provenance'], previous['provenance'])
        self.assertEqual([file.read_bytes() for file in files], before)

    def test_shared_annals_and_regnal_handoffs_include_the_correct_emperors(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        chapters = {chapter['id']: chapter for chapter in catalog['chapters']}
        for chapter_id, expected in {
            'new-v07': ['li-conghou', 'li-congke'],
            'new-v12': ['chai-rong', 'chai-zongxun'],
            'tongjian-v268': ['zhu-wen', 'zhu-yougui', 'zhu-youzhen'],
            'tongjian-v274': ['li-cunxu'],
            'tongjian-v275': ['li-cunxu', 'li-siyuan'],
            'tongjian-v288': ['liu-chengyou'],
            'tongjian-v292': ['chai-rong'],
            'tongjian-v294': ['chai-rong', 'chai-zongxun'],
        }.items():
            self.assertEqual(chapters[chapter_id]['subjects'], expected, chapter_id)
        self.assertEqual(archive.scanned_subjects(['太祖、高祖、世宗、少帝、隐帝'], 'huiyao'), [])
        self.assertEqual(archive.scanned_subjects(['后汉高祖：劉知遠；周世宗：柴榮；漢隱帝：承祐'], 'huiyao'), ['liu-zhiyuan', 'liu-chengyou', 'chai-rong'])

    def test_headers_are_removed_but_historical_notes_and_year_headings_survive(self):
        html = '<div><table class="ws-header"><tr><td>下一卷</td></tr></table><pre>莊宗同光元年</pre><p>正文〈<b>校勘按語</b>〉<br><br>第二段</p><div class="licensetpl"><p>license</p></div></div>'
        self.assertEqual(archive.extract(html), ['莊宗同光元年', '正文〈校勘按語〉', '第二段'])

    def test_heading_tags_are_available_without_reclassifying_short_prose(self):
        html = '<div class="ws-header"><h2>站点导航</h2></div><h2>開平元年</h2><p>開平元年</p><h3>序</h3><p>正文〈按語〉</p>'
        tagged = archive.extract(html, with_tags=True)
        self.assertEqual(tagged, [('開平元年', 'h2'), ('開平元年', 'p'), ('序', 'h3'), ('正文〈按語〉', 'p')])
        self.assertEqual([text for text, _ in tagged], archive.extract(html))

    def test_no_visible_source_text_is_silently_dropped(self):
        blocks = {'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'dt', 'dd', 'li'}
        for source in (ROOT / 'content/five-dynasties/sources').glob('*.json'):
            with self.subTest(source=source.stem):
                payload = json.loads(source.read_text())
                html = payload['response']['parse']['text']['*']
                index_page = payload.get('selection', {}).get('indexPage', False)
                extracted = archive.extract(html, index_page=index_page)
                missing = []
                def visit(node):
                    if index_page and node.tag in {'ul', 'ol'}: return
                    if index_page and 'seealso' in node.attrs.get('class', '').split(): return
                    if index_page and node.tag == 'div' and 'float: right' in node.attrs.get('style', '') and not any(isinstance(child, archive.Node) and child.tag == 'div' for child in node.children):
                        self.assertIn(archive.clean_text(node).strip(), extracted)
                        return
                    if archive.excluded(node) or node.tag in blocks: return
                    if node.attrs.get('id') == 'headerContainer':
                        # Old-format headers contain only author metadata plus a preface.
                        def check_preface(item):
                            if item.tag == 'td':
                                text = archive.clean_text(item).strip()
                                if len(text) > 300: self.assertIn(text, extracted)
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
                self.assertEqual([p['original'] for p in chapter['paragraphs']], extracted)

    def test_index_pages_retain_prefaces_and_replace_only_navigation_lists(self):
        html = '<h2>提要</h2><p>原書提要與歷史正文</p><div class="seealso">参见：另一底本</div><h2>目錄</h2><ul><li>卷一</li><li>卷二</li></ul><h2>序</h2><p>作者自序全文</p><div style="float: right;">時皇宋祀汾陰之後，歳在壬子序</div>'
        self.assertEqual(archive.extract(html, index_page=True), ['提要', '原書提要與歷史正文', '序', '作者自序全文', '時皇宋祀汾陰之後，歳在壬子序'])

if __name__ == '__main__': unittest.main()
