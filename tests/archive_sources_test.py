import importlib.util
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('archive_sources', ROOT / 'scripts/archive-sources.py')
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)

TANG_HOUSEHOLD_FIXTURES = {
    'new-v51': (1727238, 57, 8801, 'c17555e997ad9b5d32c7d41a3d5c490d6b0010977dcae16da63352fe6000bc69', 'ea0d734dbc70f444b8550ef185e7fc34bb203b6b42b033207b72e5e39f913e35'),
    'old-v091': (2100871, 32, 6696, 'b35b6cb2497fd16f633b15d58d12cee57a9a8a240f6a1fe67edcb481b5c160b7', 'dae9b04f3a3d8facbb45e4cb6e0e847ea5e330ccd5d5cced9404d1aece278032'),
    'new-v39': (1721611, 54, 8718, '6629ae11baeb05043ff31a160b8aeb6db440a99581acb9f81394a78ffe3fdc3f', '9699023d15e83f7ccbf0bd85cc5593202276b3ffba77f6f9576fa098cb3a2a20'),
    'old-v049': (2186155, 31, 4667, '11a5d1ccba2d368c7d7696b62ef7b642a410d21942d70ad1dab79d8b8152d413', '623d2cf874ccc02cb9011fb96e86b642c8f96327d13a312775c807dfcb1b8f39'),
    'new-v14': (2292410, 50, 6722, '96d9d26e7382c018cde017933d3ee7fdc8e382c1e4a90d165d4f767dd8bc01a0', 'd7b4822a8deb6fea4e80733fea7690069aa6c07cb0625cafff57138da363ee77'),
    'new-v15': (1699112, 45, 5348, '113ed5705c03a6300bffdc73bccf6eab63041fa8eea291e91e53ad13cf95a9b4', '74d97cf6c579a77adcfc3da431b1bccc264b1198587252b7a2f0f7b8e6e37139'),
    'new-v16': (2292660, 10, 894, 'd491003129eff1cc9745bae27c9415f5e2ff6d2b6d9e606f6b927172d1514454', '3dff5236e6fb6fec0456c60cdfddceb9139a9e1893e9c979d5286b2e2af86574'),
}


HAN_HOUSEHOLD_FIXTURES = {
    'old-v104': (1567204, 3, 807, '717712a0b573cc75fa97497007f08064caceaacf835b6ac3a94aaf1a926e3508', 'd7164cec8fafef528a0278c140eeb554373c3c6767cdea4b2d86e055cbed9e14'),
    'new-v18': (1699189, 19, 2167, 'dbbe45b8180426d2a19dbc7a1ff79b27c3733fb2dd29344061d40261dbd14aa5', '313f4feb2b3061cb08939cc30fcbd7689953ae4faa2738bda3fba030c12b82ff'),
}
ZHOU_HOUSEHOLD_FIXTURES = {
    'old-v121': (1567208, 11, 2817, '5000c08c812ef140aeade72b3913319087ac55042f2c2208501cd1fc3a634dcc', '39c54cc6bb4a5698cac850f51e3893866059ea73e3df55540b67e1cac3835eb8'),
    'new-v19': (1699202, 17, 1301, '10ba063216f73d5d7076b0eb9fde8c65584340a5e973a9aab26d3b2bbd2808de', '423a0d33c473b59280a44b2ef6bbaa1b70d3d78f0920d5ff4fd2691ca0cc41bc'),
}
ZHOU_HOUSEHOLD_BOUNDARIES = {
    'old-v121': ('后妃', '又追封梁國長公主。）〉'),
    'new-v19': ('皇后柴氏', '一作「太保」，一作「太尉」。待考。'),
}
HOUSEHOLD_FIXTURES = {**TANG_HOUSEHOLD_FIXTURES, **HAN_HOUSEHOLD_FIXTURES, **ZHOU_HOUSEHOLD_FIXTURES}

class SourceIntegrityTests(unittest.TestCase):
    def test_household_volumes_are_complete_fixed_revision_archives(self):
        summaries = {c['id']: c for c in json.loads((archive.ROOT / 'catalog.json').read_text())['chapters']}
        specs = {s['id']: s for s in archive.SPECS}
        self.assertEqual(len(specs), len(archive.SPECS))
        self.assertEqual(sum(s['bookId'] == 'old' for s in archive.SPECS), 94)
        self.assertEqual(sum(s['bookId'] == 'new' for s in archive.SPECS), 41)
        for chapter_id, (revision, count, characters, source_hash, chapter_hash) in HOUSEHOLD_FIXTURES.items():
            with self.subTest(chapter=chapter_id):
                summary = summaries[chapter_id]
                source = archive.ROOT / 'sources' / f'{chapter_id}.json'
                chapter = archive.ROOT / 'chapters' / f'{chapter_id}.json'
                payload = json.loads(source.read_text())
                contents = json.loads(chapter.read_text())
                self.assertEqual(payload['response']['parse']['title'], specs[chapter_id]['page'])
                self.assertEqual(payload['response']['parse']['revid'], revision)
                self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), source_hash)
                self.assertEqual(hashlib.sha256(chapter.read_bytes()).hexdigest(), chapter_hash)
                self.assertEqual(summary['provenance']['revisionId'], revision)
                self.assertEqual(summary['provenance']['sourceSha256'], source_hash)
                self.assertEqual(summary['provenance']['chapterSha256'], chapter_hash)
                self.assertEqual(summary['provenance']['license'], 'CC BY-SA 4.0')
                self.assertEqual(summary['paragraphCount'], count)
                self.assertEqual(summary['characterCount'], characters)
                self.assertEqual(contents['title'], specs[chapter_id]['title'])
                self.assertEqual([p['id'] for p in contents['paragraphs']], [f'{chapter_id}-p{i + 1}' for i in range(count)])
                self.assertEqual([p['original'] for p in contents['paragraphs']], archive.extract(payload['response']['parse']['text']['*']))
                self.assertEqual(sum(len(p['original']) for p in contents['paragraphs']), characters)
                self.assertTrue(all(p['revision'] == 1 and p['translation'] is None for p in contents['paragraphs']))
                if chapter_id in ZHOU_HOUSEHOLD_BOUNDARIES:
                    opening, ending = ZHOU_HOUSEHOLD_BOUNDARIES[chapter_id]
                    self.assertEqual(contents['paragraphs'][0]['original'], opening)
                    self.assertTrue(contents['paragraphs'][-1]['original'].endswith(ending))

    def test_household_cached_captures_do_not_refetch_or_rewrite(self):
        specs = {s['id']: s for s in archive.SPECS}
        archive_root = archive.ROOT
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for kind in ['sources', 'chapters']:
                (root / kind).mkdir()
                for chapter_id in HOUSEHOLD_FIXTURES:
                    shutil.copyfile(archive_root / kind / f'{chapter_id}.json', root / kind / f'{chapter_id}.json')
            paths = [root / kind / f'{chapter_id}.json' for kind in ['sources', 'chapters'] for chapter_id in HOUSEHOLD_FIXTURES]
            before = {p: p.read_bytes() for p in paths}
            with patch.object(archive, 'ROOT', root), patch.object(archive, 'request', side_effect=AssertionError('Fixed household captures must not be fetched again')):
                for chapter_id in HOUSEHOLD_FIXTURES:
                    summary = archive.capture(specs[chapter_id])
                    self.assertEqual(archive.capture(specs[chapter_id], summary)['provenance'], summary['provenance'])
            self.assertEqual({p: p.read_bytes() for p in paths}, before)

    def test_jin_shared_biography_keeps_complete_family_evidence_and_source_anomalies(self):
        source = json.loads((archive.ROOT / 'sources/old-v091.json').read_text())
        chapter = json.loads((archive.ROOT / 'chapters/old-v091.json').read_text())
        blocks = archive.extract(source['response']['parse']['text']['*'], with_tags=True)
        self.assertEqual(sum(tag.startswith('h') for _, tag in blocks), 12)
        self.assertEqual([value for value, _ in blocks], [p['original'] for p in chapter['paragraphs']])
        self.assertEqual(chapter['paragraphs'][0]['original'], '房知溫')
        self.assertIn('存審之第二字也', chapter['paragraphs'][27]['original'])
        self.assertIn('紹威之弟三子也', chapter['paragraphs'][29]['original'])
        self.assertIn('逾三年', chapter['paragraphs'][29]['original'])
        self.assertIn('尚梁普安公主', chapter['paragraphs'][29]['original'])
        self.assertTrue(chapter['paragraphs'][-1]['original'].endswith('贈司徒。'))

    def test_tang_household_volume16_keeps_the_genuine_short_source(self):
        short_spec = next(s for s in archive.SPECS if s['id'] == 'new-v16')
        self.assertEqual(short_spec['minimumCharacters'], 800)
        self.assertNotIn('minimumCharacters', next(s for s in archive.SPECS if s['id'] == 'new-v14'))
        self.assertNotIn('minimumCharacters', next(s for s in archive.SPECS if s['id'] == 'new-v15'))
        source = archive.ROOT / 'sources' / 'new-v16.json'
        original = archive.extract(json.loads(source.read_text())['response']['parse']['text']['*'])
        self.assertEqual(len(original), 10)
        self.assertEqual(sum(map(len, original)), 894)
        self.assertLess(sum(map(len, original)), 1000)
        self.assertTrue(original[-1].endswith('存之所以戒也。'))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'sources').mkdir()
            (root / 'chapters').mkdir()
            shutil.copyfile(source, root / 'sources' / source.name)
            with patch.object(archive, 'ROOT', root), patch.object(archive, 'request', side_effect=AssertionError('Use the fixed short source')):
                with self.assertRaisesRegex(ValueError, 'Incomplete source: new-v16 894 characters / 10 blocks'):
                    archive.capture({**short_spec, 'minimumCharacters': 1000})
                result = archive.capture(short_spec)
            self.assertEqual(result['paragraphCount'], 10)
            self.assertEqual(result['characterCount'], 894)
            self.assertEqual(json.loads((root / 'chapters' / 'new-v16.json').read_text())['paragraphs'][-1]['original'], original[-1])

    def test_li_keyong_annals_are_complete_archives_without_adding_a_reigning_emperor(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        summaries = {chapter['id']: chapter for chapter in catalog['chapters']}
        emperors = json.loads((archive.ROOT / 'emperors.json').read_text())['people']
        self.assertEqual(len(emperors), 14)
        self.assertNotIn('li-keyong', {person['id'] for person in emperors})
        for chapter_id, count, characters in [('old-v025', 27, 6383), ('old-v026', 42, 7678)]:
            with self.subTest(chapter=chapter_id):
                summary = summaries[chapter_id]
                chapter = json.loads((archive.ROOT / 'chapters' / f'{chapter_id}.json').read_text())
                self.assertEqual(summary['scope'], 'full')
                self.assertEqual(summary['paragraphCount'], count)
                self.assertEqual(summary['characterCount'], characters)
                self.assertEqual([p['id'] for p in chapter['paragraphs']],
                                 [f'{chapter_id}-p{position}' for position in range(1, count + 1)])
                self.assertIn('li-keyong', summary['subjects'])
                self.assertTrue(any('武皇帝为后唐追尊' in note for note in chapter['notes']))
                provenance = summary['provenance']
                self.assertEqual(provenance['license'], 'CC BY-SA 4.0')
                self.assertIn(f"oldid={provenance['revisionId']}", provenance['sourceUrl'])
                for directory, checksum in [('sources', 'sourceSha256'), ('chapters', 'chapterSha256')]:
                    self.assertEqual(hashlib.sha256((archive.ROOT / directory / f'{chapter_id}.json').read_bytes()).hexdigest(), provenance[checksum])
        chapter25 = json.loads((archive.ROOT / 'chapters/old-v025.json').read_text())
        chapter26 = json.loads((archive.ROOT / 'chapters/old-v026.json').read_text())
        self.assertTrue(chapter25['paragraphs'][0]['original'].startswith('太祖武皇帝，諱克用'))
        self.assertTrue(chapter26['paragraphs'][-1]['original'].startswith('史臣曰：武皇肇跡陰山'))
        self.assertIn('li-cunxu', summaries['old-v026']['subjects'])

    def test_li_keyong_shared_new_history_annal_keeps_cunxu_link_and_original(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        previous = next(chapter for chapter in catalog['chapters'] if chapter['id'] == 'new-v04')
        current_spec = next(item for item in archive.SPECS if item['id'] == 'new-v04')
        files = [archive.ROOT / directory / 'new-v04.json' for directory in ['sources', 'chapters']]
        before = [file.read_bytes() for file in files]
        with patch.object(archive, 'request', side_effect=AssertionError('Cached source must not be fetched again')):
            result = archive.capture(current_spec, previous)
        self.assertEqual(result['subjects'][:2], ['li-keyong', 'li-cunxu'])
        self.assertEqual(result['provenance'], previous['provenance'])
        self.assertEqual([file.read_bytes() for file in files], before)

    def test_ten_kingdoms_shared_biographies_include_late_reigns_and_short_rulers(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        summaries = {chapter['id']: chapter for chapter in catalog['chapters']}
        expected = [f'old-v{volume:03}' for volume in range(133, 137)]
        expected += [f'new-v{volume:02}' for volume in range(61, 71)]
        for chapter_id in expected:
            with self.subTest(chapter=chapter_id):
                summary = summaries[chapter_id]
                self.assertEqual(summary['scope'], 'full')
                self.assertEqual(summary['provenance']['license'], 'CC BY-SA 4.0')
                for directory, key in [('sources', 'sourceSha256'), ('chapters', 'chapterSha256')]:
                    self.assertEqual(hashlib.sha256((archive.ROOT / directory / f'{chapter_id}.json').read_bytes()).hexdigest(), summary['provenance'][key])
        def text(chapter_id):
            chapter = json.loads((archive.ROOT / 'chapters' / f'{chapter_id}.json').read_text())
            return '\n'.join(paragraph['original'] for paragraph in chapter['paragraphs'])
        self.assertIn('弟倧以次立', text('new-v67'))
        self.assertIn('卓儼明', text('new-v68'))
        self.assertIn('太平興國四年', text('new-v70'))
        self.assertIn('劉守光', text('old-v135'))
        self.assertIn('燕', summaries['old-v135']['title'])

    def test_general_biographies_are_complete_fixed_revision_archives(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        chapters = {chapter['id']: chapter for chapter in catalog['chapters']}
        expected = [f'old-v{volume:03}' for volume in [13, 16, 19, 20, 21, 22, 23, 57, 59, 62, 63, 64, 70, 73, 74]]
        expected += [f'new-v{volume:02}' for volume in [21, 22, 23, 32, 43, 44, 45, 46]]
        for chapter_id in expected:
            with self.subTest(chapter=chapter_id):
                summary = chapters[chapter_id]
                self.assertEqual(summary['scope'], 'full')
                provenance = summary['provenance']
                self.assertGreater(provenance['revisionId'], 0)
                self.assertIn(f"oldid={provenance['revisionId']}", provenance['sourceUrl'])
                self.assertEqual(provenance['license'], 'CC BY-SA 4.0')
                for directory, checksum in [('sources', 'sourceSha256'), ('chapters', 'chapterSha256')]:
                    content = (archive.ROOT / directory / f'{chapter_id}.json').read_bytes()
                    self.assertEqual(hashlib.sha256(content).hexdigest(), provenance[checksum])
                chapter = json.loads((archive.ROOT / 'chapters' / f'{chapter_id}.json').read_text())
                self.assertEqual(summary['paragraphCount'], len(chapter['paragraphs']))
                self.assertEqual(summary['characterCount'], sum(len(p['original']) for p in chapter['paragraphs']))
                self.assertTrue(all(p['revision'] == 1 and p['translation'] is None for p in chapter['paragraphs']))
        self.assertTrue(any('後事梁太祖' in p['original'] for p in json.loads((archive.ROOT / 'chapters/new-v46.json').read_text())['paragraphs']))
        self.assertTrue(any('朱漢賓' in p['original'] for p in json.loads((archive.ROOT / 'chapters/old-v064.json').read_text())['paragraphs']))

    def test_reruns_reuse_every_captured_revision_without_rewriting_originals(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        specs = {item['id']: item for item in archive.SPECS}
        paths = [archive.ROOT / directory / f"{chapter['id']}.json"
                 for chapter in catalog['chapters'] for directory in ['sources', 'chapters']]
        before = {path: path.read_bytes() for path in paths}
        with patch.object(archive, 'request', side_effect=AssertionError('Cached sources must not be fetched again')):
            for chapter in catalog['chapters']:
                result = archive.capture(specs[chapter['id']], chapter)
                self.assertEqual(result['provenance'], chapter['provenance'])
        self.assertEqual({path: path.read_bytes() for path in paths}, before)

    def test_reign_metadata_is_refreshed_without_rewriting_cached_sources(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        previous = next(chapter for chapter in catalog['chapters'] if chapter['id'] == 'new-v10').copy()
        previous['subjects'] = ['liu-zhiyuan']
        current_spec = next(item for item in archive.SPECS if item['id'] == 'new-v10')
        files = [archive.ROOT / directory / 'new-v10.json' for directory in ['sources', 'chapters']]
        before = [file.read_bytes() for file in files]
        with patch.object(archive, 'request', side_effect=AssertionError('Cached sources must not be fetched again')):
            result = archive.capture(current_spec, previous)
        self.assertEqual(result['subjects'][:2], ['liu-zhiyuan', 'liu-chengyou'])
        self.assertIn('gao-xingzhou', result['subjects'])
        self.assertEqual(result['provenance'], previous['provenance'])
        self.assertEqual([file.read_bytes() for file in files], before)

    def test_shared_annals_and_regnal_handoffs_include_the_correct_emperors(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        chapters = {chapter['id']: chapter for chapter in catalog['chapters']}
        emperors = {person['id'] for person in json.loads((archive.ROOT / 'emperors.json').read_text())['people']}
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
            self.assertEqual([person for person in chapters[chapter_id]['subjects'] if person in emperors], expected, chapter_id)
        self.assertEqual(archive.scanned_subjects(['太祖、高祖、世宗、少帝、隐帝'], 'huiyao'), [])
        self.assertEqual(archive.scanned_subjects(['后汉高祖：劉知遠；周世宗：柴榮；漢隱帝：承祐'], 'huiyao'), ['liu-zhiyuan', 'liu-chengyou', 'chai-rong'])

    def test_headers_are_removed_but_historical_notes_and_year_headings_survive(self):
        html = '<div><table class="ws-header"><tr><td>下一卷</td></tr></table><pre>莊宗同光元年</pre><p>正文〈<b>校勘按語</b>〉<br><br>第二段</p><div class="licensetpl"><p>license</p></div></div>'
        self.assertEqual(archive.extract(html), ['莊宗同光元年', '正文〈校勘按語〉', '第二段'])

    def test_heading_tags_are_available_without_reclassifying_short_prose(self):
        html = '<div class="ws-header"><h2>站点导航</h2></div><h1>人物传</h1><h2>開平元年</h2><p>開平元年</p><h3>序</h3><p>正文〈按語〉</p>'
        tagged = archive.extract(html, with_tags=True)
        self.assertEqual(tagged, [('人物传', 'h1'), ('開平元年', 'h2'), ('開平元年', 'p'), ('序', 'h3'), ('正文〈按語〉', 'p')])
        self.assertEqual([text for text, _ in tagged], archive.extract(html))

    def test_no_visible_source_text_is_silently_dropped(self):
        blocks = {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'dt', 'dd', 'li'}
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
