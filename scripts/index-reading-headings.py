"""Derive display-only heading metadata from the existing, verified source snapshots."""
import importlib.util
import json
import re
from urllib.parse import unquote
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('archive_sources', ROOT / 'scripts/archive-sources.py')
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


def heading_level(tag, text, book_id):
    if tag == 'h1':
        # The reading page already has its own h1; a source-level title starts
        # the internal hierarchy below it without being dropped.
        return 2
    if tag in {'h2', 'h3', 'h4', 'h5', 'h6'}:
        return int(tag[1])
    # These two archived books also use explicit textual title markers.
    if book_id == 'quewen' and text.startswith('◇') and '\n' not in text:
        return 4
    if book_id == 'tongjian':
        if re.fullmatch(r'資治通鑑\s*第\d+卷', text) or re.match(r'^【後[梁唐晉漢周]紀[^】]+】', text):
            return 2
        if tag == 'pre' and re.fullmatch(r'[^\n]+年[（(][^\n]*公元[^\n]*年[）)]', text):
            return 3
    return None


def marked_titles(html, book_id):
    # These Four Treasuries pages mark titles as self-linked spans in a poem,
    # rather than HTML headings. Only the explicit source anchors count.
    if book_id not in {'beimeng', 'kaoyi'}:
        return set()
    titles = set()
    def visit(node):
        if archive.excluded(node):
            return
        anchor_id = node.attrs.get('id')
        if node.tag == 'span' and anchor_id:
            for child in node.children:
                if isinstance(child, archive.Node) and child.tag == 'a' and unquote(child.attrs.get('href', '')) == '#' + anchor_id:
                    titles.add(archive.clean_text(child).strip())
        for child in node.children:
            if isinstance(child, archive.Node):
                visit(child)
    visit(archive.Document(html).root)
    return titles


def build_index():
    root = ROOT / 'content/five-dynasties'
    catalog = json.loads((root / 'catalog.json').read_text(encoding='utf-8'))
    headings = {}
    for summary in catalog['chapters']:
        chapter_id = summary['id']
        chapter = json.loads((root / 'chapters' / f'{chapter_id}.json').read_text(encoding='utf-8'))
        source = json.loads((root / 'sources' / f'{chapter_id}.json').read_text(encoding='utf-8'))
        html = source['response']['parse']['text']['*']
        blocks = archive.extract(html, with_tags=True, index_page=source.get('selection', {}).get('indexPage', False))
        titles = marked_titles(html, summary['bookId'])
        if [text for text, _ in blocks] != [p['original'] for p in chapter['paragraphs']]:
            raise ValueError(f'Source blocks no longer match archived originals: {chapter_id}')
        for paragraph, (text, tag) in zip(chapter['paragraphs'], blocks):
            level = heading_level(tag, text, summary['bookId'])
            if text in titles:
                level = 2 if re.fullmatch(r'(?:北夢瑣言|資治通鑑考異)卷[一二三四五六七八九十]+', text) else 3
            if summary['id'] == 'beimeng-v000' and (text == '北夢瑣言序' or text.startswith('北夢瑣言') and text.endswith('提要')):
                level = 2
            if level:
                headings[paragraph['id']] = dict(level=level, revision=paragraph['revision'], original=text)
    return headings


if __name__ == '__main__':
    index = build_index()
    output = ROOT / 'frontend/src/reading-headings.json'
    contents = json.dumps(index, ensure_ascii=False, indent=2) + '\n'
    if not output.exists() or output.read_text(encoding='utf-8') != contents:
        output.write_text(contents, encoding='utf-8')
    print(f'Prepared {len(index)} source-backed reading headings.')
