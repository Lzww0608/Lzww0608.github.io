import importlib.util
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote, unquote

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
    'new-v20': (1699231, 17, 1909, '3b28e4ae0afb1c42fa4b8d75e61c89d2a6349441f4774d01e7cb04008a4d4ab2', '91729dbb90fbcfe8474a7f6cb9aeb55f4f5606a5bad6728467e7f8d470762cb5'),
}
ZHOU_HOUSEHOLD_BOUNDARIES = {
    'old-v121': ('后妃', '又追封梁國長公主。）〉'),
    'new-v19': ('皇后柴氏', '一作「太保」，一作「太尉」。待考。'),
    'new-v20': ('柴守禮', '他本「吾」下均有「王」字。'),
}
WU_MARRIAGE_FIXTURES = {
    'new-v41': (1721673, 26, 2183, 'b9d1c88a6be358934e75d03a1e9411a6df8ed27dd77ca9173e0166b4d070d4f1', '13a1adaea5b0ac6dd9926c48bfc349de9408f362dc24c4ec8d08ca75410a067f'),
    'tongjian-v262': (1764816, 89, 11075, '36bcbda9e91508541232473c370e5bae791a67b4878093ad8e1b129bee7bd343', '0f30d9dcfd7168abe6320b281a449cbb08fd191ecf2cf5b8950d113ac5531499'),
    'jiuguozhi-v002': (2596554, 38, 9817, 'ec218802dadd11fa43eb727b41b9acaa3bf4a4726eb631a29deda50d159fbf44', 'ead40ddf1dee3857eb75f880468cd30ba79313392fb67e19bdbc8780d44a4740'),
}
HOUSEHOLD_FIXTURES = {**TANG_HOUSEHOLD_FIXTURES, **HAN_HOUSEHOLD_FIXTURES, **ZHOU_HOUSEHOLD_FIXTURES, **WU_MARRIAGE_FIXTURES}

class SourceIntegrityTests(unittest.TestCase):
    def test_jing_xiang_shared_biography_is_one_fixed_complete_source(self):
        chapter_id = 'old-v018'
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        selected_specs = [item for item in archive.SPECS if item['id'] == chapter_id]
        selected_summaries = [item for item in catalog['chapters'] if item['id'] == chapter_id]
        self.assertEqual(len(selected_specs), 1, 'the complete shared biography must have exactly one capture spec')
        self.assertEqual(len(selected_summaries), 1, 'the complete shared biography must have exactly one public catalog entry')
        selected, summary = selected_specs[0], selected_summaries[0]
        self.assertEqual(selected['fixedRevisionId'], 8730595)
        self.assertEqual((selected['bookId'], selected['volume'], selected['position'], selected['title'], selected['page']),
                         ('old', 18, 18, '卷 18 · 梁书列传八', '舊五代史/卷18'))
        self.assertIn('jing-xiang', selected['subjects'])
        self.assertIn('jing-xiang', summary['subjects'])
        self.assertNotIn('li-yu', summary['subjects'])
        source_path = archive.ROOT / 'sources' / f'{chapter_id}.json'
        chapter_path = archive.ROOT / 'chapters' / f'{chapter_id}.json'
        source_hash = '44de6b42dc7f87ac8f277cf93c23a6c80691f32863f2d0c7ce759d55538b78de'
        chapter_hash = '20d4b29a04f90fc4dd75dba0427a7a549b6e4108f66b699236e6c7b18a0113d3'
        payload = json.loads(source_path.read_text())
        chapter = json.loads(chapter_path.read_text())
        self.assertEqual(hashlib.sha256(source_path.read_bytes()).hexdigest(), source_hash)
        self.assertEqual(hashlib.sha256(chapter_path.read_bytes()).hexdigest(), chapter_hash)
        self.assertEqual(payload['response']['parse']['title'], '舊五代史/卷18')
        self.assertEqual(payload['response']['parse']['revid'], 8730595)
        self.assertEqual(summary['provenance']['revisionId'], 8730595)
        self.assertEqual(summary['provenance']['sourceSha256'], source_hash)
        self.assertEqual(summary['provenance']['chapterSha256'], chapter_hash)
        self.assertIn('oldid=8730595', summary['provenance']['sourceUrl'])
        self.assertEqual(summary['provenance']['license'], 'CC BY-SA 4.0')
        self.assertEqual(summary['provenance']['licenseUrl'], 'https://creativecommons.org/licenses/by-sa/4.0/')
        self.assertEqual((summary['scope'], summary['paragraphCount'], summary['characterCount']), ('full', 26, 5702))
        self.assertEqual(chapter['title'], selected['title'])
        self.assertEqual(chapter['position'], 18)
        blocks = archive.extract(payload['response']['parse']['text']['*'], with_tags=True)
        self.assertEqual((len(blocks), sum(len(text) for text, _ in blocks)), (26, 5702))
        self.assertEqual([p['original'] for p in chapter['paragraphs']], [text for text, _ in blocks])
        self.assertEqual([p['id'] for p in chapter['paragraphs']], [f'{chapter_id}-p{i + 1}' for i in range(26)])
        self.assertTrue(all(p['revision'] == 1 and p['translation'] is None for p in chapter['paragraphs']))
        self.assertEqual([(i + 1, text, tag) for i, (text, tag) in enumerate(blocks) if tag.startswith('h')],
                         [(1, '張文蔚', 'h2'), (5, '薛貽矩', 'h2'), (7, '張策', 'h2'), (9, '杜曉', 'h2'),
                          (12, '敬翔', 'h2'), (19, '李振', 'h2'), (25, '贊', 'h2')])
        self.assertEqual(next(book for book in catalog['books'] if book['id'] == 'old'),
                         next(book for book in archive.BOOKS if book['id'] == 'old'))

    def test_jing_xiang_fixed_cache_reuse_keeps_new_and_old_original_bytes(self):
        chapter_ids = ['old-v011', 'old-v018']
        specs = {item['id']: item for item in archive.SPECS}
        self.assertTrue('old-v018' in specs, 'a registered fixed cache is required before reuse')
        summaries = {item['id']: item for item in json.loads((archive.ROOT / 'catalog.json').read_text())['chapters']}
        archive_root = archive.ROOT
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for kind in ['sources', 'chapters']:
                (root / kind).mkdir()
                for chapter_id in chapter_ids:
                    shutil.copyfile(archive_root / kind / f'{chapter_id}.json', root / kind / f'{chapter_id}.json')
            paths = [root / kind / f'{chapter_id}.json' for kind in ['sources', 'chapters'] for chapter_id in chapter_ids]
            before = {path: path.read_bytes() for path in paths}
            with patch.object(archive, 'ROOT', root), patch.object(archive, 'request', side_effect=AssertionError('Fixed C001 cache must never request the network')):
                regenerated = archive.capture(specs['old-v018'])
                self.assertEqual(regenerated, summaries['old-v018'])
                self.assertEqual(archive.capture(specs['old-v018'], summaries['old-v018']), summaries['old-v018'])
                self.assertEqual(archive.capture(specs['old-v011'], summaries['old-v011'])['provenance'], summaries['old-v011']['provenance'])
                wrong = json.loads(json.dumps(summaries['old-v018']))
                wrong['provenance']['revisionId'] = 8730594
                with self.assertRaisesRegex(ValueError, 'Fixed source revision changed: old-v018'):
                    archive.capture(specs['old-v018'], wrong)
            self.assertEqual({path: path.read_bytes() for path in paths}, before)

    def test_jiuguozhi_and_tongjian262_keep_distinct_book_and_volume_scopes(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        book = next(b for b in archive.BOOKS if b['id'] == 'jiuguozhi')
        saved = next(b for b in catalog['books'] if b['id'] == 'jiuguozhi')
        self.assertEqual({**saved, 'url': unquote(saved['url'])}, {**book, 'url': unquote(book['url'])})
        self.assertEqual(book['defaultChapter'], 'jiuguozhi-v002')
        self.assertIn('路振', book['author'])
        self.assertNotEqual(book['id'], 'shiguochunqiu')
        self.assertEqual(sorted(s['volume'] for s in archive.SPECS if s['bookId'] == 'tongjian'), [262, *range(266, 295)])
        current = json.loads((archive.ROOT / 'chapters/tongjian-v262.json').read_text())
        self.assertTrue(any('卷 262' in note and '晚唐' in note for note in current['notes']))
        for volume in range(266, 295):
            chapter = json.loads((archive.ROOT / 'chapters' / f'tongjian-v{volume}.json').read_text())
            self.assertTrue(any('卷 266—294' in note for note in chapter['notes']))

    def test_wu_household_selected_complete_sources_and_fixed_section_cache(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        for chapter_id, revision, blocks, characters, source_sha in [('shiguochunqiu-v001', 2554072, 22, 15138, 'ebebf01ff02e660fea03786e032b30e5f27b271fc52f54a58992c8b08b592dc9'), ('shiguochunqiu-v003', 2554071, 20, 10244, 'ff3e7892a2e6987525e6f06903030632ce11de6845ed40d8129c781c40fcff2d'), ('shiguochunqiu-v007', 2554075, 15, 5353, '9f6cee391cec39bcefa15fe1490df42c5a6956cdbecedc22957e146b09ed2c2a'), ('shiguochunqiu-v012', 2554082, 19, 3006, '5e80aeb830d68c16ad69997851e7f4e08519f43f3e77db384462f4a6a9613a06'), ('nantangjinshi-v002', 1503836, 45, 5382, '45ae3d134fcf3d9f8b3368ccf0dc2434063b002c343bbc590686bf676aeff267'), ('quantangwen-v884', 8723175, 32, 10735, 'f559cbf7c9cd08718de08c10acd8e61fcfb64a621bfb8b439d1a1ebd7d263736')]:
            selected = next(s for s in archive.SPECS if s['id'] == chapter_id)
            summary = next(c for c in catalog['chapters'] if c['id'] == chapter_id)
            payload = json.loads((archive.ROOT / 'sources' / (chapter_id + '.json')).read_text())
            chapter = json.loads((archive.ROOT / 'chapters' / (chapter_id + '.json')).read_text())
            self.assertEqual(selected['fixedRevisionId'], revision)
            self.assertEqual(payload['response']['parse']['revid'], revision)
            self.assertEqual(hashlib.sha256((archive.ROOT / 'sources' / (chapter_id + '.json')).read_bytes()).hexdigest(), source_sha)
            tagged = archive.source_blocks(payload, with_tags=True)
            self.assertEqual((len(tagged), sum(len(t) for t, _ in tagged)), (blocks, characters))
            self.assertEqual([p['original'] for p in chapter['paragraphs']], [t for t, _ in tagged])
            self.assertEqual([p['id'] for p in chapter['paragraphs']], [f'{chapter_id}-p{i + 1}' for i in range(blocks)])
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for kind in ['sources', 'chapters']:
                    (root / kind).mkdir()
                    shutil.copyfile(archive.ROOT / kind / (chapter_id + '.json'), root / kind / (chapter_id + '.json'))
                before = {p: p.read_bytes() for p in root.rglob('*.json')}
                with patch.object(archive, 'ROOT', root), patch.object(archive, 'request', side_effect=AssertionError('fixed cached source only')):
                    regenerated = archive.capture(selected, summary)
                    self.assertEqual(regenerated['provenance'], summary['provenance'])
                    if chapter_id == 'shiguochunqiu-v003':
                        self.assertIn('liu-xun-yonghe', regenerated['subjects'])
                        self.assertIn('li-yu', regenerated['subjects'])
                        self.assertIn('wu-wang-chuanzheng-wife-unnamed', regenerated['subjects'])
                        self.assertNotIn('wang-yanzhang', regenerated['subjects'])
                        self.assertNotIn('wang-jian-former-shu', regenerated['subjects'])
                        self.assertNotIn('ge-congzhou', regenerated['subjects'])
                    wrong = json.loads(json.dumps(summary)); wrong['provenance']['revisionId'] = revision + 1
                    with self.assertRaisesRegex(ValueError, 'Fixed source revision changed'):
                        archive.capture(selected, wrong)
                self.assertEqual({p: p.read_bytes() for p in root.rglob('*.json')}, before)
        payload = json.loads((archive.ROOT / 'sources/nantangjinshi-v002.json').read_text())
        self.assertEqual(archive.source_blocks(payload, True)[0], ('卷二', 'h2'))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for kind in ['sources', 'chapters']:
                (root / kind).mkdir()
                shutil.copyfile(archive.ROOT / kind / 'nantangjinshi-v002.json', root / kind / 'nantangjinshi-v002.json')
            wrong_payload = json.loads(json.dumps(payload)); wrong_payload['selection']['sourceSection']['untilHeading'] = '卷一'
            source = root / 'sources/nantangjinshi-v002.json'; source.write_text(json.dumps(wrong_payload, ensure_ascii=False))
            previous = json.loads(json.dumps(next(c for c in catalog['chapters'] if c['id'] == 'nantangjinshi-v002')))
            previous['provenance']['sourceSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
            before = {p: p.read_bytes() for p in root.rglob('*.json')}
            selected = next(s for s in archive.SPECS if s['id'] == 'nantangjinshi-v002')
            with patch.object(archive, 'ROOT', root), patch.object(archive, 'request', side_effect=AssertionError('no source requests')):
                with self.assertRaisesRegex(ValueError, 'Source section changed'):
                    archive.capture(selected, previous)
            self.assertEqual({p: p.read_bytes() for p in root.rglob('*.json')}, before)
        wrong = json.loads(json.dumps(payload)); wrong['selection']['sourceSection']['untilHeading'] = '卷一'
        with self.assertRaisesRegex(ValueError, 'Source section end changed'):
            archive.source_blocks(wrong)
        wrong = json.loads(json.dumps(payload)); wrong['selection']['sourceSection']['heading'] = '不存在的卷'
        with self.assertRaisesRegex(ValueError, 'Source section start changed'):
            archive.source_blocks(wrong)

    def test_ma_ling_fixed_complete_volume_and_cache_preservation(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        selected = next(s for s in archive.SPECS if s['id'] == 'nantangma-v010')
        book = next(b for b in archive.BOOKS if b['id'] == 'nantangma')
        self.assertEqual(selected['fixedRevisionId'], 2073807)
        self.assertEqual(book['defaultChapter'], 'nantangma-v006')
        self.assertEqual(next(b for b in catalog['books'] if b['id'] == 'nantangma'), book)
        self.assertIn('马令', book['author'])
        self.assertNotEqual(book['id'], next(b for b in archive.BOOKS if b['id'] == 'nantanglu')['id'])
        source = archive.ROOT / 'sources/nantangma-v010.json'
        payload = json.loads(source.read_text())
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), '4717f32913e21fded73e2c6fb1b037211da460df773a28538f1974d443ee5b22')
        self.assertEqual(payload['response']['parse']['revid'], 2073807)
        tagged = archive.extract(payload['response']['parse']['text']['*'], with_tags=True)
        self.assertEqual((len(tagged), sum(len(t) for t, _ in tagged), sum(tag == 'h1' for _, tag in tagged)), (17, 2801, 8))
        chapter = json.loads((archive.ROOT / 'chapters/nantangma-v010.json').read_text())
        self.assertEqual([p['original'] for p in chapter['paragraphs']], [t for t, _ in tagged])
        self.assertEqual([p['id'] for p in chapter['paragraphs']], [f'nantangma-v010-p{i+1}' for i in range(17)])
        previous = next(c for c in catalog['chapters'] if c['id'] == 'nantangma-v010')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for kind in ['sources', 'chapters']:
                (root / kind).mkdir()
                shutil.copyfile(archive.ROOT / kind / 'nantangma-v010.json', root / kind / 'nantangma-v010.json')
            paths = [root / kind / 'nantangma-v010.json' for kind in ['sources', 'chapters']]
            before = {p: p.read_bytes() for p in paths}
            with patch.object(archive, 'ROOT', root), patch.object(archive, 'request', side_effect=AssertionError('fixed cached source only')):
                self.assertEqual(archive.capture(selected, previous)['provenance'], previous['provenance'])
                wrong = json.loads(json.dumps(previous)); wrong['provenance']['revisionId'] = 838698
                with self.assertRaisesRegex(ValueError, 'Fixed source revision changed'):
                    archive.capture(selected, wrong)
            self.assertEqual({p: p.read_bytes() for p in paths}, before)


    def test_shiguochunqiu_is_a_distinct_fixed_complete_wu_volume(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        books = {book['id']: book for book in catalog['books']}
        chapter_id = 'shiguochunqiu-v004'
        summary = next(chapter for chapter in catalog['chapters'] if chapter['id'] == chapter_id)
        selected = next(item for item in archive.SPECS if item['id'] == chapter_id)
        self.assertEqual(sum(item['id'] == chapter_id for item in archive.SPECS), 1)
        self.assertEqual(sum(book['id'] == 'shiguochunqiu' for book in archive.BOOKS), 1)
        self.assertEqual(books['shiguochunqiu'], next(book for book in archive.BOOKS if book['id'] == 'shiguochunqiu'))
        self.assertEqual(books['shiguochunqiu']['defaultChapter'], chapter_id)
        self.assertIn('吴任臣', books['shiguochunqiu']['author'])
        self.assertEqual(books['chunqiu']['title'], '五代春秋')
        self.assertIn('尹洙', books['chunqiu']['author'])
        self.assertNotEqual(books['chunqiu']['defaultChapter'], chapter_id)
        source_path = archive.ROOT / 'sources' / f'{chapter_id}.json'
        chapter_path = archive.ROOT / 'chapters' / f'{chapter_id}.json'
        source_hash = '660db3111e7c57459a3e4dd72c2eabaf3651f0ae067be459afc8a7a02ccaacf2'
        chapter_hash = '8221fc539af760e214dceb5d88ecb844d24ae8bcb52a778a30fb5e1b457d39e1'
        payload = json.loads(source_path.read_text())
        chapter = json.loads(chapter_path.read_text())
        self.assertEqual(payload['response']['parse']['title'], selected['page'])
        self.assertEqual(payload['response']['parse']['revid'], 2554068)
        self.assertEqual(hashlib.sha256(source_path.read_bytes()).hexdigest(), source_hash)
        self.assertEqual(hashlib.sha256(chapter_path.read_bytes()).hexdigest(), chapter_hash)
        self.assertEqual(summary['provenance']['sourceSha256'], source_hash)
        self.assertEqual(summary['provenance']['chapterSha256'], chapter_hash)
        self.assertEqual(summary['provenance']['revisionId'], 2554068)
        self.assertIn('oldid=2554068', summary['provenance']['sourceUrl'])
        self.assertEqual(summary['provenance']['license'], 'CC BY-SA 4.0')
        self.assertEqual(summary['scope'], 'full')
        self.assertEqual(summary['paragraphCount'], 22)
        self.assertEqual(summary['characterCount'], 1748)
        tagged = archive.extract(payload['response']['parse']['text']['*'], with_tags=True)
        self.assertEqual([paragraph['original'] for paragraph in chapter['paragraphs']], [text for text, _ in tagged])
        self.assertEqual([paragraph['id'] for paragraph in chapter['paragraphs']], [f'{chapter_id}-p{i + 1}' for i in range(22)])
        self.assertTrue(all(paragraph['revision'] == 1 and paragraph['translation'] is None for paragraph in chapter['paragraphs']))
        self.assertEqual(sum(tag == 'h2' for _, tag in tagged), 5)
        self.assertEqual(tagged[0][0], '太祖太妃史氏　夫人朱氏　太后王氏　睿帝讓皇后王氏')
        self.assertTrue(chapter['paragraphs'][1]['original'].startswith('太紀史氏'))
        self.assertTrue(chapter['paragraphs'][-1]['original'].startswith('上饒公臣者'))
        self.assertTrue(any('底本讹字与原有标点保持原样' in note and '不作为独立史料复证' in note for note in chapter['notes']))

    def test_shiguochunqiu_cached_capture_preserves_itself_and_the_existing_chunqiu(self):
        catalog = json.loads((archive.ROOT / 'catalog.json').read_text())
        summaries = {chapter['id']: chapter for chapter in catalog['chapters']}
        specs = {item['id']: item for item in archive.SPECS}
        chapter_ids = ['chunqiu-v001', 'shiguochunqiu-v004']
        archive_root = archive.ROOT
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for kind in ['sources', 'chapters']:
                (root / kind).mkdir()
                for chapter_id in chapter_ids:
                    shutil.copyfile(archive_root / kind / f'{chapter_id}.json', root / kind / f'{chapter_id}.json')
            paths = [root / kind / f'{chapter_id}.json' for kind in ['sources', 'chapters'] for chapter_id in chapter_ids]
            before = {path: path.read_bytes() for path in paths}
            with patch.object(archive, 'ROOT', root), patch.object(archive, 'request', side_effect=AssertionError('Only fixed cached revisions may be used')):
                regenerated = archive.capture(specs['shiguochunqiu-v004'])
                self.assertEqual(regenerated['provenance'], summaries['shiguochunqiu-v004']['provenance'])
                for chapter_id in chapter_ids:
                    result = archive.capture(specs[chapter_id], summaries[chapter_id])
                    self.assertEqual(result['provenance'], summaries[chapter_id]['provenance'])
            self.assertEqual({path: path.read_bytes() for path in paths}, before)

    def test_household_volumes_are_complete_fixed_revision_archives(self):
        summaries = {c['id']: c for c in json.loads((archive.ROOT / 'catalog.json').read_text())['chapters']}
        specs = {s['id']: s for s in archive.SPECS}
        self.assertEqual(len(specs), len(archive.SPECS))
        self.assertEqual(sum(s['bookId'] == 'old' for s in archive.SPECS), 95)
        self.assertEqual(sum(s['bookId'] == 'new' for s in archive.SPECS), 43)
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
                page_extracted = archive.extract(html, index_page=index_page)
                extracted = archive.source_blocks(payload)
                section = payload.get('selection', {}).get('sourceSection')
                if section is not None:
                    selected = next(s for s in archive.SPECS if s['id'] == source.stem)
                    self.assertEqual(section, selected.get('sourceSection'))
                    tagged = archive.extract(html, with_tags=True, index_page=index_page)
                    starts = [i for i, (text, tag) in enumerate(tagged) if tag == 'h2' and text == section['heading']]
                    self.assertEqual(len(starts), 1)
                    start = starts[0]
                    end = next(i for i in range(start + 1, len(tagged)) if tagged[i][1] == 'h2')
                    self.assertEqual(tagged[end][0], section['untilHeading'])
                    self.assertEqual(extracted, [text for text, _ in tagged[start:end]])
                document = archive.Document(html).root
                navigation_links = set()
                if source.stem == 'quantangwen-v884':
                    def descendants(node):
                        yield node
                        for child in node.children:
                            if isinstance(child, archive.Node): yield from descendants(child)
                    expected_links = [(label, '/wiki/' + quote(title, safe='/'), title) for label, title in
                                      [('上一卷', '全唐文/卷0883'), ('下一卷', '全唐文/卷0885'), ('全唐文', '全唐文')]]
                    tables = []
                    for table in descendants(document):
                        if table.tag != 'table': continue
                        links = [node for node in descendants(table) if node.tag == 'a' and archive.clean_text(node).strip()]
                        if [(archive.clean_text(node).strip(), node.attrs.get('href'), node.attrs.get('title')) for node in links] == expected_links:
                            tables.append((table, links))
                    self.assertEqual(len(tables), 1, 'Expected one exact previous/next/work navigation table')
                    table, links = tables[0]
                    self.assertEqual(archive.clean_text(table).split(), ['上一卷', '下一卷', '全唐文'])
                    navigation_links = {id(node) for node in links}
                missing = []
                def visit(node):
                    if id(node) in navigation_links: return
                    if index_page and node.tag in {'ul', 'ol'}: return
                    if index_page and 'seealso' in node.attrs.get('class', '').split(): return
                    if index_page and node.tag == 'div' and 'float: right' in node.attrs.get('style', '') and not any(isinstance(child, archive.Node) and child.tag == 'div' for child in node.children):
                        self.assertIn(archive.clean_text(node).strip(), page_extracted)
                        return
                    if archive.excluded(node) or node.tag in blocks: return
                    if node.attrs.get('id') == 'headerContainer':
                        # Old-format headers contain only author metadata plus a preface.
                        def check_preface(item):
                            if item.tag == 'td':
                                text = archive.clean_text(item).strip()
                                if len(text) > 300: self.assertIn(text, page_extracted)
                                return
                            for child in item.children:
                                if isinstance(child, archive.Node): check_preface(child)
                        check_preface(node)
                        return
                    for child in node.children:
                        if isinstance(child, archive.Node): visit(child)
                        elif child.strip(): missing.append(child.strip())
                visit(document)
                self.assertEqual(missing, [], 'Text outside recognized historical blocks')
                chapter = json.loads((ROOT / 'content/five-dynasties/chapters' / source.name).read_text())
                self.assertEqual([p['original'] for p in chapter['paragraphs']], extracted)

    def test_index_pages_retain_prefaces_and_replace_only_navigation_lists(self):
        html = '<h2>提要</h2><p>原書提要與歷史正文</p><div class="seealso">参见：另一底本</div><h2>目錄</h2><ul><li>卷一</li><li>卷二</li></ul><h2>序</h2><p>作者自序全文</p><div style="float: right;">時皇宋祀汾陰之後，歳在壬子序</div>'
        self.assertEqual(archive.extract(html, index_page=True), ['提要', '原書提要與歷史正文', '序', '作者自序全文', '時皇宋祀汾陰之後，歳在壬子序'])

if __name__ == '__main__': unittest.main()
