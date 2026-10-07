#!/usr/bin/env python3
"""Archive public-domain historical sources from Wikisource, without HTML execution.
Run with Python 3.9+: python3 scripts/archive-sources.py
Existing raw responses are reused, so reruns preserve the captured revision.
"""
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'content/five-dynasties'
API = 'https://zh.wikisource.org/w/api.php'
LICENSE = 'CC BY-SA 4.0'
LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
FOUNDERS = ['zhu-wen', 'li-cunxu', 'shi-jingtang', 'liu-zhiyuan', 'guo-wei']
BOOKS = [
    dict(id='old', title='旧五代史', sourceTitle='舊五代史', author='北宋 · 薛居正等撰', kind='正史 · 纪传体', image='/images/old-five-dynasties.webp', description='五位开国皇帝的本纪，共 27 卷；保留原页所载辑佚说明与夹注。', defaultChapter='old-v001'),
    dict(id='new', title='新五代史', sourceTitle='新五代史', author='北宋 · 欧阳修撰', kind='正史 · 纪传体', image='/images/new-five-dynasties.webp', description='五位开国皇帝的本纪，共 7 卷。汉本纪兼载隐帝，以完整卷收录。', defaultChapter='new-v01'),
    dict(id='tongjian', title='资治通鉴', sourceTitle='資治通鑑', author='北宋 · 司马光等编', kind='编年史', image='', description='卷 266—294，完整收录五代部分，涵盖 907—959 年，共 29 卷。', defaultChapter='tongjian-v266'),
    dict(id='quewen', title='五代史阙文', sourceTitle='五代史闕文', author='北宋 · 王禹偁撰', kind='史料笔记', image='', description='一卷全文及原页序文，补充五代史事异闻，宜与正史、编年史参读。', defaultChapter='quewen-v001'),
    dict(id='shibu', title='五代史补', sourceTitle='五代史補', author='北宋 · 陶岳撰', kind='史料笔记', image='', description='五卷全文，另收提要、作者序与逸文。补充五朝人物和史事，宜与正史、编年史相互参证。', defaultChapter='shibu-v001'),
    dict(id='chunqiu', title='五代春秋', sourceTitle='五代春秋', author='北宋 · 尹洙撰', kind='编年史', image='', description='上下两卷全文及提要，简明记述后梁至后周的政权与史事，可与年表和《资治通鉴》对读。', defaultChapter='chunqiu-v001'),
    dict(id='huiyao', title='五代会要', sourceTitle='五代會要', author='北宋 · 王溥撰', kind='典章制度', image='', description='三十卷全文及提要，按专题收录五代帝号、礼制、职官、刑法、赋税、军政与四裔等资料。', defaultChapter='huiyao-v001'),
    dict(id='beimeng', title='北梦琐言', sourceTitle='北夢瑣言 (四庫全書本)', author='孙光宪撰', kind='史料笔记', image='', description='选四库全书本卷 17—20，另收提要与自序。保存晚唐五代人物逸事，传闻宜与其他史料参读。', defaultChapter='beimeng-v017'),
    dict(id='kaoyi', title='资治通鉴考异', sourceTitle='資治通鑑考異 (四庫全書本)', author='北宋 · 司马光撰', kind='史料考证', image='', description='完整收录卷 28—30 的五代部分，保存不同记述的异文与取舍理由，宜与《资治通鉴》对读。', defaultChapter='kaoyi-v028'),
]
for book in BOOKS:
    book['url'] = 'https://zh.wikisource.org/wiki/' + urllib.parse.quote(book['sourceTitle'])

# Exact chapter ranges checked against each work's Wikisource contents page.
SPECS = []
for person, start, end, title in [
    ('zhu-wen', 1, 7, '梁太祖纪'), ('li-cunxu', 27, 34, '唐庄宗纪'),
    ('shi-jingtang', 75, 80, '晋高祖纪'), ('liu-zhiyuan', 99, 100, '汉高祖纪'),
    ('guo-wei', 110, 113, '周太祖纪'),
]:
    for volume in range(start, end + 1):
        SPECS.append(dict(id=f'old-v{volume:03}', bookId='old', volume=volume, title=f'卷 {volume} · {title}{volume-start+1}', page=f'舊五代史/卷{volume}', subjects=[person]))
for person, volume, title in [
    ('zhu-wen', 1, '梁本纪第一'), ('zhu-wen', 2, '梁本纪第二'),
    ('li-cunxu', 4, '唐本纪第四'), ('li-cunxu', 5, '唐本纪第五'),
    ('shi-jingtang', 8, '晋本纪第八'), ('liu-zhiyuan', 10, '汉本纪第十（兼载隐帝）'),
    ('guo-wei', 11, '周本纪第十一'),
]:
    SPECS.append(dict(id=f'new-v{volume:02}', bookId='new', volume=volume, title=f'卷 {volume} · {title}', page=f'新五代史/卷{volume:02}', subjects=[person]))
YEARS = ['907—908', '908—911', '911—913', '913—917', '917—919', '919—922', '923', '924—925', '925—926', '926—927', '927—929', '930—932', '932—934', '934—935', '936', '937—938', '939—941', '942—944', '944—945', '945—946', '947', '947—948', '948—949', '950', '951—952', '952—954', '954—956', '956—957', '958—959']
for volume in range(266, 295):
    if volume <= 271: name, number = '后梁纪', volume-265
    elif volume <= 279: name, number = '后唐纪', volume-271
    elif volume <= 285: name, number = '后晋纪', volume-279
    elif volume <= 289: name, number = '后汉纪', volume-285
    else: name, number = '后周纪', volume-289
    # Subjects identify reign-focused reading, not every passing mention in a volume.
    subjects = (['zhu-wen'] if 266 <= volume <= 268 else
                ['li-cunxu'] if 272 <= volume <= 275 else
                ['shi-jingtang'] if 280 <= volume <= 283 else
                ['liu-zhiyuan'] if 286 <= volume <= 287 else
                ['guo-wei'] if 290 <= volume <= 291 else [])
    years = YEARS[volume-266]
    SPECS.append(dict(id=f'tongjian-v{volume}', bookId='tongjian', volume=volume, title=f'卷 {volume} · {name}{number}', years=years, page=f'資治通鑑/卷{volume}', subjects=subjects))
SPECS.append(dict(id='quewen-v001', bookId='quewen', volume=1, title='五代史阙文 · 全卷', page='五代史闕文', subjects=FOUNDERS))

# Preserve source prefaces separately from numbered volumes. Index links are navigation,
# not literary paragraphs; the unmodified source response remains archived in full.
for book_id, page, title in [
    ('shibu', '五代史補', '提要、序与逸文'),
    ('chunqiu', '五代春秋', '提要'),
    ('huiyao', '五代會要', '提要'),
    ('beimeng', '北夢瑣言 (四庫全書本)', '提要与自序'),
]:
    SPECS.append(dict(id=f'{book_id}-v000', bookId=book_id, volume=0, position=1, title=title, page=page, subjects=[], indexPage=True, minimumCharacters=250, minimumBlocks=1))
for volume, (dynasty, person) in enumerate(zip(['后梁', '后唐', '后晋', '后汉', '后周'], FOUNDERS), 1):
    SPECS.append(dict(id=f'shibu-v{volume:03}', bookId='shibu', volume=volume, position=volume+1, title=f'卷 {volume} · {dynasty}史事', page=f'五代史補/卷{volume}', subjects=[person]))
for volume, label, subjects in [(1, '卷上', FOUNDERS[:2]), (2, '卷下', FOUNDERS[2:])]:
    SPECS.append(dict(id=f'chunqiu-v{volume:03}', bookId='chunqiu', volume=volume, position=volume+1, title=label, page=f'五代春秋/{label}', subjects=subjects))
def chinese_number(number):
    digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
    if number < 10: return digits[number]
    return (digits[number // 10] if number >= 20 else '') + '十' + digits[number % 10]
for volume in range(1, 31):
    SPECS.append(dict(id=f'huiyao-v{volume:03}', bookId='huiyao', volume=volume, position=volume+1, title=f'卷 {volume}', page=f'五代會要/卷{chinese_number(volume)}', subjects=FOUNDERS if volume == 1 else [], scanSubjects=volume != 1))
for volume in range(17, 21):
    SPECS.append(dict(id=f'beimeng-v{volume:03}', bookId='beimeng', volume=volume, position=volume-15, title=f'卷 {volume}', page=f'北夢瑣言 (四庫全書本)/卷{volume}', subjects=[], scanSubjects=True))
for volume, title, subjects in [(28, '后梁纪上', FOUNDERS[:1]), (29, '后梁纪下、后唐纪上', FOUNDERS[:2]), (30, '后唐纪下、后晋、后汉与后周纪', FOUNDERS[2:])]:
    SPECS.append(dict(id=f'kaoyi-v{volume:03}', bookId='kaoyi', volume=volume, title=f'卷 {volume} · {title}', page=f'資治通鑑考異 (四庫全書本)/卷{volume}', subjects=subjects))

SUBJECT_NAMES = {
    'zhu-wen': ['朱溫', '朱温', '朱全忠', '朱晃'],
    'li-cunxu': ['李存勖', '李存勗'],
    'shi-jingtang': ['石敬瑭'],
    'liu-zhiyuan': ['劉知遠'],
    'guo-wei': ['郭威'],
}
BEIMENG_TITLES = {'zhu-wen': ['梁祖', '梁太祖'], 'li-cunxu': ['莊宗'], 'shi-jingtang': ['晉高祖', '晉祖'], 'liu-zhiyuan': ['漢高祖', '漢祖'], 'guo-wei': ['周太祖', '周祖']}
HUIYAO_TITLES = {'zhu-wen': ['梁太祖'], 'li-cunxu': ['後唐莊宗'], 'shi-jingtang': ['晉高祖'], 'liu-zhiyuan': ['後漢高祖'], 'guo-wei': ['周太祖']}

def scanned_subjects(paragraphs, book_id):
    text = '\n'.join(paragraphs)
    titles = BEIMENG_TITLES if book_id == 'beimeng' else HUIYAO_TITLES
    return [person for person, names in SUBJECT_NAMES.items() if any(name in text for name in names + titles[person])]

class Node:
    def __init__(self, tag='', attrs=None):
        self.tag, self.attrs, self.children = tag, dict(attrs or []), []
    def text(self):
        return ''.join(child.text() if isinstance(child, Node) else child for child in self.children)

class Document(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node('root')
        self.stack = [self.root]
        self.feed(html)
    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID: self.stack.append(node)
    def handle_endtag(self, tag):
        for index in range(len(self.stack)-1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break
    def handle_data(self, data): self.stack[-1].children.append(data)

EXCLUDED_CLASSES = {'ws-header', 'header', 'ws-noexport', 'noprint', 'navbox', 'toc', 'licensetpl', 'licenseContainer', 'catlinks', 'mw-editsection', 'ws-license', 'acContainer', 'license'}
def excluded(node):
    classes = set(node.attrs.get('class', '').split())
    return node.tag in {'style', 'script', 'noscript'} or bool(classes & EXCLUDED_CLASSES) or node.attrs.get('id') in {'toc', 'ws-data', 'acContainer'}

def clean_text(node):
    if excluded(node): return ''
    if node.tag == 'br': return '\n'
    return ''.join(clean_text(child) if isinstance(child, Node) else child for child in node.children)

def extract(html, with_tags=False, index_page=False):
    blocks = []
    def append(value, tag):
        blocks.append((value, tag) if with_tags else value)
    def visit(node):
        if index_page and 'seealso' in node.attrs.get('class', '').split():
            return
        if index_page and (node.tag in {'ul', 'ol'} or (node.tag in {'h2', 'h3', 'h4'} and clean_text(node).strip() in {'目錄', '目録', '目录'})):
            return
        if node.attrs.get('id') == 'headerContainer':
            # The older work header also contains a long bibliographic preface.
            def preface(child):
                if child.tag == 'td':
                    value = clean_text(child).strip()
                    if len(value) > 300: append(value, 'td')
                    return
                for item in child.children:
                    if isinstance(item, Node): preface(item)
            preface(node)
            return
        if excluded(node): return
        if node.tag in {'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'dt', 'dd', 'li'} or (index_page and node.tag == 'div' and re.search(r'float\s*:\s*right', node.attrs.get('style', '')) and not any(isinstance(child, Node) and child.tag == 'div' for child in node.children)):
            value = clean_text(node)
            value = re.sub(r'[\t\r\f\v ]+', ' ', value)
            value = re.sub(r' *\n *', '\n', value).strip()
            if value:
                for part in re.split(r'\n{2,}', value):
                    if part.strip(): append(part.strip(), node.tag)
            return
        for child in node.children:
            if isinstance(child, Node): visit(child)
    visit(Document(html).root)
    return blocks

def request(params):
    url = API + '?' + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'AncientHistoryArchive/1.0 (public-domain text; https://lzww0608.github.io)', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=60) as response: return json.load(response)
        except Exception:
            if attempt == 3: raise
            time.sleep(2 ** attempt)

def capture(spec, previous=None):
    path = ROOT / 'sources' / (spec['id'] + '.json')
    chapter_path = ROOT / 'chapters' / (spec['id'] + '.json')
    if previous:
        if previous['provenance']['pageTitle'] != spec['page'] or previous['bookId'] != spec['bookId']:
            raise ValueError(f"Existing archive identity changed: {spec['id']}")
        for file, expected in [(path, previous['provenance']['sourceSha256']), (chapter_path, previous['provenance']['chapterSha256'])]:
            if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
                raise ValueError(f"Existing archive checksum changed: {spec['id']}")
        return previous
    if path.exists():
        payload = json.loads(path.read_text())
    else:
        result = request(dict(action='parse', page=spec['page'], prop='text|revid|displaytitle', format='json', disableeditsection=1))
        if 'parse' not in result: raise ValueError(f"Missing source: {spec['page']} {result}")
        payload = dict(fetchedAt=datetime.now(timezone.utc).isoformat(), response=result)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n')
    parsed = payload['response']['parse']
    if parsed['title'] != spec['page']: raise ValueError(f"Unexpected redirect: {spec['page']} -> {parsed['title']}")
    html = parsed['text']['*']
    if spec.get('indexPage') and payload.get('selection') != {'indexPage': True}:
        payload['selection'] = {'indexPage': True}
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n')
    paragraphs = extract(html, index_page=spec.get('indexPage', False))
    length = sum(len(text) for text in paragraphs)
    if length < spec.get('minimumCharacters', 1000) or len(paragraphs) < spec.get('minimumBlocks', 3): raise ValueError(f"Incomplete source: {spec['id']} {length} characters / {len(paragraphs)} blocks")
    book = next(book for book in BOOKS if book['id'] == spec['bookId'])
    source_url = 'https://zh.wikisource.org/w/index.php?' + urllib.parse.urlencode(dict(title=spec['page'], oldid=parsed['revid']))
    notes = [
        '本页完整收录所选卷的来源文本，保留原页正文、序文与夹注；原文使用繁体字。段落划分依来源页面的段落与空行，标题亦作为独立文字块保留。',
        '古籍原作已属公版；维基文库的整理、标点与页面文本按 CC BY-SA 4.0 署名并以相同方式共享。底本、校勘与叙事差异请参照版本信息。',
    ]
    if book['id'] == 'old': notes.append('《旧五代史》为辑佚本。本纪中保留《永乐大典》《册府元龟》等出处及整理者按语，不把夹注删作缺文。')
    if book['id'] == 'tongjian': notes.append('《资治通鉴》是编年史，本站收录卷 266—294 的五代部分（907—959 年）。人物筛选按开国皇帝在位时期关联，并非卷内出现该人物的穷尽索引。')
    if spec['id'] == 'new-v10': notes.append('此卷合记后汉高祖与隐帝，收录整卷，不将隐帝部分误标为刘知远生平。')
    if book['id'] == 'quewen': notes.append('《五代史阙文》保存史事异闻，含原页提要与序文。传闻记述应与正史、编年史相互参证，不能直接视为定论。')
    if book['id'] in {'shibu', 'beimeng'}: notes.append('本书含史事逸闻，不能将传闻直接视为定论；请与正史、编年史及《资治通鉴考异》相互参证。')
    if book['id'] == 'huiyao': notes.append('《五代会要》按典章制度分类。保留来源异体字及校注。人物关联依据卷中明确出现的姓名或带政权限定的帝号，供整卷参读。')
    if book['id'] == 'beimeng': notes.append('本站选录四库全书本卷 17—20，另收提要与作者自序，不表示全书二十卷已全部收录。')
    if book['id'] == 'kaoyi': notes.append('本站收录卷 28—30 的五代部分。本书记录史料异同及取舍理由，须与《资治通鉴》正文对应阅读。')
    if spec.get('indexPage'): notes.append('本页保留原来源的提要、序文等卷外文字。来源页的目录链接由站内可操作目录替代，不将链接列表当作历史正文。')
    subjects = spec['subjects']
    if spec.get('scanSubjects'):
        subjects = scanned_subjects(paragraphs, book['id'])
    position = spec.get('position', spec['volume'])
    chapter = dict(id=spec['id'], title=spec['title'], position=position, scope='full', sourceUrl=source_url, notes=notes, bookId=book['id'], bookTitle=book['title'], author=book['author'], editionId=book['id']+'-local-wikisource', edition='维基文库整理文本 · 本地归档', paragraphs=[dict(id=spec['id']+f'-p{index+1}', position=index+1, revision=1, original=text, translation=None) for index, text in enumerate(paragraphs)])
    chapter_path.write_text(json.dumps(chapter, ensure_ascii=False, indent=2)+'\n')
    summary = {key: value for key, value in spec.items() if key not in {'page', 'indexPage', 'minimumCharacters', 'minimumBlocks', 'scanSubjects'}}
    summary.update(subjects=subjects, position=position, scope='full', paragraphCount=len(paragraphs), characterCount=length, provenance=dict(pageTitle=spec['page'], sourceUrl=source_url, revisionId=parsed['revid'], fetchedAt=payload['fetchedAt'], license=LICENSE, licenseUrl=LICENSE_URL, contributorsUrl='https://zh.wikisource.org/w/index.php?'+urllib.parse.urlencode(dict(title=spec['page'], action='history')), sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(), chapterSha256=hashlib.sha256(chapter_path.read_bytes()).hexdigest()))
    print(f"{spec['id']}: {len(paragraphs)} blocks, {length} characters, revision {parsed['revid']}", flush=True)
    return summary

def main():
    ROOT.joinpath('sources').mkdir(parents=True, exist_ok=True)
    ROOT.joinpath('chapters').mkdir(exist_ok=True)
    # Two simultaneous reads, with cached responses reused on reruns.
    catalog_path = ROOT / 'catalog.json'
    previous = json.loads(catalog_path.read_text()) if catalog_path.exists() else {'chapters': []}
    previous_chapters = {chapter['id']: chapter for chapter in previous['chapters']}
    def capture_current(spec): return capture(spec, previous_chapters.get(spec['id']))
    with ThreadPoolExecutor(max_workers=2) as executor: chapters = list(executor.map(capture_current, SPECS))
    catalog = dict(schemaVersion=1, title='五代史料本地文库', license=LICENSE, licenseUrl=LICENSE_URL, books=BOOKS, chapters=chapters)
    ROOT.joinpath('catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n')
    print(f"Archived {len(BOOKS)} works, {len(chapters)} chapters, {sum(c['characterCount'] for c in chapters)} characters.", flush=True)

if __name__ == '__main__': main()
