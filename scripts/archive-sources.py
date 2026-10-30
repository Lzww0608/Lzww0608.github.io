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
    dict(id='old', title='旧五代史', sourceTitle='舊五代史', author='北宋 · 薛居正等撰', kind='正史 · 纪传体', image='/images/old-five-dynasties.webp', description='五代在位皇帝本纪共 59 卷，另收梁后妃传卷 11、唐后妃传卷 49、晋后妃传卷 86、汉后妃传卷 104、周后妃传卷 121、文臣列传卷 18、126、李克用武皇纪卷 25—26、宗室、相关将领列传及十国记载所在卷 133—136；合计 96 卷，保留辑佚说明与夹注，不表示 150 卷全本已收录。', defaultChapter='old-v001'),
    dict(id='new', title='新五代史', sourceTitle='新五代史', author='北宋 · 欧阳修撰', kind='正史 · 纪传体', image='/images/new-five-dynasties.webp', description='五代皇帝本纪卷 1—12、五代家人传卷 13—20、文臣合传卷 54、相关人物列传及十国世家卷 61—70；共 44 卷，合传均整卷保留，卷 41 补充钟传等人的记载，不表示 74 卷全本已收录。', defaultChapter='new-v01'),
    dict(id='tongjian', title='资治通鉴', sourceTitle='資治通鑑', author='北宋 · 司马光等编', kind='编年史', image='', description='现收卷 266—294 的五代部分（907—959 年），另收卷 262 的晚唐记事，补充吴国相关人物的早期材料；共 30 卷，不表示全书已收录。', defaultChapter='tongjian-v266'),
    dict(id='quewen', title='五代史阙文', sourceTitle='五代史闕文', author='北宋 · 王禹偁撰', kind='史料笔记', image='', description='一卷全文及原页序文，补充五代史事异闻，宜与正史、编年史参读。', defaultChapter='quewen-v001'),
    dict(id='shibu', title='五代史补', sourceTitle='五代史補', author='北宋 · 陶岳撰', kind='史料笔记', image='', description='五卷全文，另收提要、作者序与逸文。补充五朝人物和史事，宜与正史、编年史相互参证。', defaultChapter='shibu-v001'),
    dict(id='chunqiu', title='五代春秋', sourceTitle='五代春秋', author='北宋 · 尹洙撰', kind='编年史', image='', description='上下两卷全文及提要，简明记述后梁至后周的政权与史事，可与年表和《资治通鉴》对读。', defaultChapter='chunqiu-v001'),
    dict(id='huiyao', title='五代会要', sourceTitle='五代會要', author='北宋 · 王溥撰', kind='典章制度', image='', description='三十卷全文及提要，按专题收录五代帝号、礼制、职官、刑法、赋税、军政与四裔等资料。', defaultChapter='huiyao-v001'),
    dict(id='beimeng', title='北梦琐言', sourceTitle='北夢瑣言 (四庫全書本)', author='孙光宪撰', kind='史料笔记', image='', description='选四库全书本卷 17—20，另收提要与自序。保存晚唐五代人物逸事，传闻宜与其他史料参读。', defaultChapter='beimeng-v017'),
    dict(id='kaoyi', title='资治通鉴考异', sourceTitle='資治通鑑考異 (四庫全書本)', author='北宋 · 司马光撰', kind='史料考证', image='', description='完整收录卷 28—30 的五代部分，保存不同记述的异文与取舍理由，宜与《资治通鉴》对读。', defaultChapter='kaoyi-v028'),
    dict(id='shiguochunqiu', title='十国春秋', sourceTitle='十國春秋', author='清 · 吴任臣撰', kind='十国史 · 纪传体', image='', description='现收卷 1—9、12、13 的吴国世家、本纪与人物列传，卷 15—17 的南唐烈祖、元宗、后主本纪，卷 18、19 的南唐后妃、宗室及公主列传，卷 20—25、33、34 的南唐人物列传，卷 38 的前蜀后妃宗室列传，卷 40 的前蜀文臣与诸将列传，以及卷 77 的吴越武肃王世家上。完整保留所选卷正文、标题、夹注与史家评论，不表示全书已收录。底本疑讹保留；同作品不同版本仅作校读，不作独立复证。', defaultChapter='shiguochunqiu-v004'),
    dict(id='nantanglu', title='南唐书（陆游）', sourceTitle='陸氏南唐書', author='南宋 · 陆游撰', kind='十国史 · 纪传体', image='', description='现收卷 1 的烈祖本纪、卷 3 的后主本纪、卷 13 的刘潘李严张龚列传、卷 16 的后妃诸王列传及卷 17 的杂艺、方士、节义列传，完整保留所选卷正文、标题、夹注与史家评论，不表示全书已收录。陆游与马令的两种《南唐书》分别编目；同作品不同版本仅作校读，不作独立复证。', defaultChapter='nantanglu-v001'),
    dict(id='nantangma', title='南唐书（马令）', sourceTitle='馬氏南唐書', author='北宋 · 马令撰', kind='十国史 · 纪传体', image='', description='现收卷 5 的后主书、卷 6 的女宪传及卷 10 的序文、李建勋与严续等人物记载，完整保留所选卷正文、标题、夹注与来源标点，不表示全书已收录。马令与陆游的两种《南唐书》分别编目；同作品不同版本仅作校读，不作独立复证。', defaultChapter='nantangma-v005'),
    dict(id='nantangjinshi', title='南唐近事', sourceTitle='南唐近事', author='北宋 · 郑文宝撰', kind='史料笔记', image='', description='现收卷 2 全文，保留轶事、夹注及来源标点，不表示全书已收录。传闻与人物评论按来源理解，宜与其他史料对读。', defaultChapter='nantangjinshi-v002'),
    dict(id='quantangwen', title='全唐文', sourceTitle='全唐文', author='徐铉（本卷撰文者）', kind='诗文总集 · 碑铭', image='', description='现收卷 884 全文，含徐铉所撰碑铭；本卷撰文者与总集编纂身份分开，保留正文、铭文、夹注及来源标点，不表示全书已收录。碑文所述褒赠及家世按其文体与来源分别核验。', defaultChapter='quantangwen-v884'),
    dict(id='jiuguozhi', title='九国志', sourceTitle='九國志', author='北宋 · 路振撰', kind='十国史 · 纪传体', image='', description='现收卷 2 的吴国人物列传，完整保留正文、夹注与标点，不表示全书已收录；婚家及人物异说按来源分别理解。', defaultChapter='jiuguozhi-v002'),
]
for book in BOOKS:
    book['url'] = 'https://zh.wikisource.org/wiki/' + urllib.parse.quote(book['sourceTitle'])

# Exact chapter ranges checked against each work's Wikisource contents page.
SPECS = []
for person, start, end, title in [
    ('zhu-wen', 1, 7, '梁太祖纪'), ('zhu-youzhen', 8, 10, '梁末帝纪'),
    ('li-cunxu', 27, 34, '唐庄宗纪'), ('li-siyuan', 35, 44, '唐明宗纪'),
    ('li-conghou', 45, 45, '唐闵帝纪'), ('li-congke', 46, 48, '唐末帝纪'),
    ('shi-jingtang', 75, 80, '晋高祖纪'), ('shi-chonggui', 81, 85, '晋少帝纪'),
    ('liu-zhiyuan', 99, 100, '汉高祖纪'), ('liu-chengyou', 101, 103, '汉隐帝纪'),
    ('guo-wei', 110, 113, '周太祖纪'), ('chai-rong', 114, 119, '周世宗纪'),
    ('chai-zongxun', 120, 120, '周恭帝纪'),
]:
    for volume in range(start, end + 1):
        SPECS.append(dict(id=f'old-v{volume:03}', bookId='old', volume=volume, title=f'卷 {volume} · {title}{volume-start+1}', page=f'舊五代史/卷{volume}', subjects=[person]))
SPECS.append(dict(id='old-v011', bookId='old', volume=11, title='卷 11 · 梁后妃传', page='舊五代史/卷11', subjects=['zhu-wen', 'zhu-youzhen']))
SPECS.append(dict(id='old-v012', bookId='old', volume=12, title='卷 12 · 梁宗室传（含朱友珪）', page='舊五代史/卷12', subjects=['zhu-wen', 'zhu-yougui', 'zhu-youzhen']))
# C001 retains the whole fixed shared civil-official biography, including other lives and commentary.
SPECS.append(dict(id='old-v018', bookId='old', volume=18, position=18, title='卷 18 · 梁书列传八',
                  page='舊五代史/卷18', subjects=['jing-xiang'], scanSubjects=True, fixedRevisionId=8730595))
# C003 keeps both complete fixed shared biographies and their source-qualified civil-official scope.
SPECS.append(dict(id='old-v126', bookId='old', volume=126, position=126, title='卷 126 · 周书列传六',
                  page='舊五代史/卷126', subjects=['feng-dao'], fixedRevisionId=2549907, sourceLocalSubjectsOnly=True))
SPECS.append(dict(id='new-v54', bookId='new', volume=54, position=54, title='卷 54 · 杂传第四十二',
                  page='新五代史/卷54', subjects=['feng-dao'], fixedRevisionId=1727329, sourceLocalSubjectsOnly=True))
# Li Keyong was prince of Jin during his lifetime and posthumously honoured
# as 武皇帝 by Later Tang. These annals do not add an actually reigning emperor.
for volume, label, subjects in [(25, '上', ['li-keyong']), (26, '下', ['li-keyong', 'li-cunxu'])]:
    SPECS.append(dict(id=f'old-v{volume:03}', bookId='old', volume=volume,
                      title=f'卷 {volume} · 唐武皇纪{label}（李克用）',
                      page=f'舊五代史/卷{volume}', subjects=subjects))
for person, volume, title in [
    ('zhu-wen', 1, '梁本纪第一'), ('zhu-wen', 2, '梁本纪第二'),
    ('zhu-youzhen', 3, '梁本纪第三'),
    ('li-cunxu', 4, '唐本纪第四'), ('li-cunxu', 5, '唐本纪第五'),
    ('li-siyuan', 6, '唐本纪第六'), ('li-conghou', 7, '唐本纪第七（兼载末帝）'),
    ('shi-jingtang', 8, '晋本纪第八'), ('shi-chonggui', 9, '晋本纪第九'),
    ('liu-zhiyuan', 10, '汉本纪第十（兼载隐帝）'),
    ('guo-wei', 11, '周本纪第十一'),
    ('chai-rong', 12, '周本纪第十二（兼载恭帝）'),
]:
    SPECS.append(dict(id=f'new-v{volume:02}', bookId='new', volume=volume, title=f'卷 {volume} · {title}', page=f'新五代史/卷{volume:02}', subjects=[person]))
SPECS.append(dict(id='new-v13', bookId='new', volume=13, title='卷 13 · 梁家人传（含朱友珪）', page='新五代史/卷13', subjects=['zhu-wen', 'zhu-yougui', 'zhu-youzhen']))
# Complete household volumes retain other rulers' families and all source notes.
# Volume 16 is genuinely short; do not pad it to the general 1,000-character floor.
SPECS.append(dict(id='old-v049', bookId='old', volume=49, title='卷 49 · 唐书列传一',
                  page='舊五代史/卷49', subjects=['li-keyong', 'li-cunxu', 'li-siyuan', 'li-conghou', 'li-congke'], scanSubjects=True))
for volume, title, subjects in [
    (14, '唐家人传第二', ['li-keyong', 'li-cunxu']),
    (15, '唐明宗家人传第三', ['li-siyuan', 'li-conghou']),
    (16, '唐废帝家人传第四', ['li-congke']),
]:
    options = {'minimumCharacters': 800} if volume == 16 else {}
    SPECS.append(dict(id=f'new-v{volume:02}', bookId='new', volume=volume,
                      title=f'卷 {volume} · {title}', page=f'新五代史/卷{volume:02}',
                      subjects=subjects, scanSubjects=True, **options))
# Complete shared biography supplies source-qualified family references and all notes.
SPECS.append(dict(id='new-v39', bookId='new', volume=39, title='卷 39 · 杂传第二十七',
                  page='新五代史/卷39', subjects=[], scanSubjects=True))
# These complete fixed volumes preserve differing accounts of Wei Quanfeng's
# daughter and Zhong Kuangshi; omitted intervening volumes are not auto-added.
SPECS.append(dict(id='new-v41', bookId='new', volume=41, title='卷 41 · 杂传第二十九',
                  page='新五代史/卷41', subjects=[], fixedRevisionId=1721673))
SPECS.append(dict(id='tongjian-v262', bookId='tongjian', volume=262, title='卷 262 · 唐纪七十八',
                  years='900—901', page='資治通鑑/卷262', subjects=[], fixedRevisionId=1764816))
SPECS.append(dict(id='jiuguozhi-v002', bookId='jiuguozhi', volume=2, title='卷 2 · 吴人物列传',
                  page='九國志/卷二', subjects=[], fixedRevisionId=2596554))
# Preserve this complete Jin shared biography, including source-qualified family evidence.
SPECS.append(dict(id='old-v091', bookId='old', volume=91, title='卷 91 · 晋书列传六',
                  page='舊五代史/卷91', subjects=[], scanSubjects=True))
for volume, title, subjects in [
    (52, '唐列传（李嗣昭、李嗣本、李嗣恩等）', ['li-sizhao', 'li-siben', 'li-sien']),
    (53, '唐列传（李存信、李存孝等）', ['li-cunxin', 'li-cunxiao', 'li-cunjin', 'li-cunzhang', 'li-cunxian']),
    (55, '唐列传（康君立、史建瑭等，附史敬思）', ['kang-junli', 'shi-jingsi']),
    (56, '唐列传（周德威、李存审）', ['fu-cunshen']),
]:
    SPECS.append(dict(id=f'old-v{volume:03}', bookId='old', volume=volume, title=f'卷 {volume} · {title}', page=f'舊五代史/卷{volume}', subjects=subjects))
for volume, title, subjects in [
    (25, '唐臣传（符存审、史建瑭等，附史敬思）', ['fu-cunshen', 'shi-jingsi']),
    (36, '义儿传（李嗣昭等，附康君立）', ['li-siyuan', 'li-sizhao', 'li-siben', 'li-sien', 'li-cunxin', 'li-cunxiao', 'li-cunjin', 'li-cunzhang', 'li-cunxian', 'kang-junli']),
]:
    SPECS.append(dict(id=f'new-v{volume:02}', bookId='new', volume=volume, title=f'卷 {volume} · {title}', page=f'新五代史/卷{volume:02}', subjects=subjects))

# Whole biographies support Zhu Wen's generals, including men who later served
# another polity. A later dynasty's chapter classification does not change the
# date or identity of their earlier service. Preserve each complete shared volume.
for volume in [13, 16, 19, 20, 21, 22, 23, 59, 63, 64]:
    title = '梁列传' if volume < 27 else '唐列传'
    SPECS.append(dict(id=f'old-v{volume:03}', bookId='old', volume=volume,
                      title=f'卷 {volume} · {title}', page=f'舊五代史/卷{volume}', subjects=[]))
for volume in [21, 22, 23, 32, 43, 44, 45, 46]:
    title = '梁臣传' if volume <= 23 else '死节传' if volume == 32 else '杂传'
    SPECS.append(dict(id=f'new-v{volume:02}', bookId='new', volume=volume,
                      title=f'卷 {volume} · {title}', page=f'新五代史/卷{volume:02}', subjects=[]))

# Li Keyong's military officers: retain complete shared biographies, including
# later service and the lives of other people contained in the same volumes.
for volume, title in [(15, '梁列传（李罕之等）'),
                       (61, '唐列传（安金全、袁建丰等）'),
                       (65, '唐列传（李建及、石君立等）')]:
    SPECS.append(dict(id=f'old-v{volume:03}', bookId='old', volume=volume,
                      title=f'卷 {volume} · {title}', page=f'舊五代史/卷{volume}', subjects=[]))

# The shared Hedong / Later Tang topic also includes Li Cunxu's commanders.
# Keep their complete selected biographies and every attached source note.
for volume, title in [(57, '唐列传（郭崇韬）'),
                       (62, '唐列传（董璋等）'),
                       (70, '唐列传（元行钦、夏鲁奇等）'),
                       (73, '唐列传（毛璋、段凝等）'),
                       (74, '唐列传（康延孝、朱守殷等）')]:
    SPECS.append(dict(id=f'old-v{volume:03}', bookId='old', volume=volume,
                      title=f'卷 {volume} · {title}', page=f'舊五代史/卷{volume}', subjects=[]))

# Ten Kingdoms' actual rulers: preserve the whole shared 世袭/僭伪/世家
# volumes, including other people, succession narratives, and source notes.
for volume, title in [(133, '世袭列传（荆南、楚、吴越）'),
                       (134, '僭伪列传（吴、南唐、闽）'),
                       (135, '僭伪列传（燕、南汉、北汉）'),
                       (136, '僭伪列传（前蜀、后蜀）')]:
    SPECS.append(dict(id=f'old-v{volume:03}', bookId='old', volume=volume,
                      title=f'卷 {volume} · {title}', page=f'舊五代史/卷{volume}', subjects=[]))
for volume, title in [(61, '吴世家第一'), (62, '南唐世家第二'),
                       (63, '前蜀世家第三'), (64, '后蜀世家第四'),
                       (65, '南汉世家第五'), (66, '楚世家第六'),
                       (67, '吴越世家第七'), (68, '闽世家第八'),
                       (69, '南平世家第九'), (70, '东汉世家第十（北汉）')]:
    SPECS.append(dict(id=f'new-v{volume:02}', bookId='new', volume=volume,
                      title=f'卷 {volume} · {title}', page=f'新五代史/卷{volume:02}', subjects=[]))
# Complete shared volume supplies Fan Yanguang's daughter, the consort of Li Chongmei.
SPECS.append(dict(id='new-v51', bookId='new', volume=51, title='卷 51 · 杂传第三十九',
                  page='新五代史/卷51', subjects=[], scanSubjects=True))
# Preserve the complete Later Jin family volumes already captured in the archive.
SPECS.append(dict(id='old-v086', bookId='old', volume=86, title='卷 86 · 晋书列传一（后妃）',
                  page='舊五代史/卷86', subjects=[], scanSubjects=True))
SPECS.append(dict(id='new-v17', bookId='new', volume=17, title='卷 17 · 晋家人传第五',
                  page='新五代史/卷17', subjects=[], scanSubjects=True))
# Complete fixed-source Later Han family volumes. Existing cached originals remain unchanged.
SPECS.append(dict(id="old-v104", bookId="old", volume=104, title="卷 104 · 汉书列传一（后妃）",
                  page="舊五代史/卷104", subjects=[], scanSubjects=True, minimumCharacters=807))
SPECS.append(dict(id="new-v18", bookId="new", volume=18, title="卷 18 · 汉家人传第六",
                  page="新五代史/卷18", subjects=[], scanSubjects=True))
# Complete fixed-source Later Zhou family volumes. Existing cached originals remain unchanged.
SPECS.append(dict(id="old-v121", bookId="old", volume=121, title="卷 121 · 周书列传一（后妃）",
                  page="舊五代史/卷121", subjects=[], scanSubjects=True))
SPECS.append(dict(id="new-v19", bookId="new", volume=19, title="卷 19 · 周太祖家人传第七",
                  page="新五代史/卷19", subjects=[], scanSubjects=True))
# Complete fixed-source Zhou Shizong household volume; existing source bytes remain unchanged.
SPECS.append(dict(id="new-v20", bookId="new", volume=20, title="卷 20 · 周世宗家人传第八",
                  page="新五代史/卷20", subjects=[], scanSubjects=True))
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
SPECS.append(dict(id='shiguochunqiu-v004', bookId='shiguochunqiu', volume=4,
                  title='卷 4 · 吴后妃、宗室及公主', page='十國春秋/卷004',
                  subjects=['yang-xingmi', 'shi-jiantang', 'li-bian', 'song-qiqiu']))

SPECS.append(dict(id='shiguochunqiu-v013', bookId='shiguochunqiu', volume=13, position=13,
                  title='卷 13 · 吴列传（田頵、张颢、徐温及诸子）', page='十國春秋/卷013',
                  subjects=['zhu-wen', 'wang-jingren', 'yang-xingmi', 'yang-wo', 'yang-longyan', 'yang-pu', 'li-bian', 'li-jing-southern-tang', 'qian-liu', 'qian-yuanguan', 'song-qiqiu', 'wu-yang-xingmi-wife-zhu', 'wu-xu-wen-wife-li', 'wu-xu-wen-chen-furen', 'wu-xu-zhihui-wife-lu'], fixedRevisionId=2554081))

SPECS.append(dict(id='nantanglu-v017', bookId='nantanglu', volume=17,
                  title='卷 17 · 杂艺方士节义列传', page='陸氏南唐書/卷17',
                  subjects=['yang-pu', 'li-bian', 'li-jing-southern-tang', 'li-yu', 'wang-jipeng', 'qian-hongchu', 'song-qiqiu', 'han-xizai', 'wu-yang-lian-wife-li-yongxing'], fixedRevisionId=2073862))

SPECS.append(dict(id='nantangma-v010', bookId='nantangma', volume=10,
                  title='卷 10 · 相关人物列传', page='馬氏南唐書/卷10',
                  subjects=['yang-xingmi', 'li-bian', 'li-jing-southern-tang', 'li-yu', 'wang-yanzheng', 'song-qiqiu', 'wu-yang-xingmi-daughter-xu-jie-wife'], fixedRevisionId=2073807))

# Source-bound H64 maternal and marriage records; no global bare surname matching.
for chapter_id, added_subjects in {
    'tongjian-v267': [
        'wu-xu-wen-mother-zhou'
    ],
    'old-v134': [
        'wu-xu-wen-mother-zhou'
    ],
    'tongjian-v281': [
        'wu-xu-wen-wife-li'
    ],
    'tongjian-v276': [
        'wu-xu-wen-chen-furen'
    ],
    'nantangma-v010': [
        'wu-xu-wen-daughter-guangde'
    ],
    'tongjian-v282': [
        'wu-xu-wen-daughter-guangde'
    ]
}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *added_subjects]))

SPECS.append(dict(id='shiguochunqiu-v001', bookId='shiguochunqiu', volume=1, position=1,
                  title='卷 1 · 吴太祖世家（杨行密）', page='十國春秋/卷001', subjects=[], fixedRevisionId=2554072))
SPECS.append(dict(id='shiguochunqiu-v002', bookId='shiguochunqiu', volume=2, position=2,
                  title='卷 2 · 吴烈祖、高祖世家（杨渥、杨隆演）', page='十國春秋/卷002', subjects=['kou-yanqing', 'li-bian', 'li-chengsi', 'li-cunxu', 'liu-xun', 'liu-yan-southern-han', 'ma-yin', 'niu-cunjie', 'qian-liu', 'qian-yuanguan', 'shi-yan', 'song-qiqiu', 'wang-jian-former-shu', 'wang-jingren', 'wang-shenzhi', 'wu-xu-wen-mother-zhou', 'wu-yang-xingmi-taifei-shi', 'xu-xuan', 'yang-longyan', 'yang-pu', 'yang-wo', 'yang-xingmi', 'yuan-xiangxian', 'zhu-wen', 'zhu-yougui', 'zhu-youzhen'], sourceLocalSubjectsOnly=True, fixedRevisionId=2554063))
SPECS.append(dict(id='shiguochunqiu-v003', bookId='shiguochunqiu', volume=3, position=3,
                  title='卷 3 · 吴睿帝本纪（杨溥）', page='十國春秋/卷003', subjects=['chai-rong', 'gao-conghui', 'gao-jixing', 'han-xizai', 'li-bian', 'li-congke', 'li-cunxu', 'li-jing-southern-tang', 'li-siyuan', 'li-yu', 'liu-xun-yonghe', 'qian-hongzuo', 'qian-liu', 'shi-jingtang', 'song-qiqiu', 'wu-wang-chuanzheng-wife-unnamed', 'wu-xu-wen-chen-furen', 'wu-xu-wen-wife-li', 'wu-yang-lian-wife-li-yongxing', 'wu-yang-meng-wife', 'wu-yang-pu-empress-wang', 'wu-yang-pu-mother-wang', 'xu-xuan', 'yang-longyan', 'yang-pu', 'yang-wo', 'yang-xingmi'], sourceLocalSubjectsOnly=True, fixedRevisionId=2554071))
SPECS.append(dict(id='shiguochunqiu-v005', bookId='shiguochunqiu', volume=5, position=5,
                  title='卷 5 · 吴列传（袁袭、李神福等）', page='十國春秋/卷005', subjects=['li-bian', 'ma-yin', 'pang-shigu', 'qian-liu', 'wang-jingren', 'wang-tan', 'wu-li-shenfu-wife-unnamed', 'wu-tian-jun-mother-yin', 'yang-longyan', 'yang-wo', 'yang-xingmi', 'zhu-wen'],
                  sourceLocalSubjectsOnly=True, fixedRevisionId=2554069, minimumCharacters=5066, minimumBlocks=15))
SPECS.append(dict(id='shiguochunqiu-v006', bookId='shiguochunqiu', volume=6, position=6,
                  title='卷 6 · 吴列传（柴再用、秦裴、贾公铎等）', page='十國春秋/卷006', subjects=[], fixedRevisionId=2554073))
SPECS.append(dict(id='shiguochunqiu-v007', bookId='shiguochunqiu', volume=7, position=7,
                  title='卷 7 · 吴列传（刘信、周本、李德诚等）', page='十國春秋/卷007', subjects=[], fixedRevisionId=2554075))
SPECS.append(dict(id='shiguochunqiu-v008', bookId='shiguochunqiu', volume=8, position=8,
                  title='卷 8 · 吴列传（朱瑾、李承嗣等）', page='十國春秋/卷008', subjects=[], fixedRevisionId=2554076))
SPECS.append(dict(id='shiguochunqiu-v009', bookId='shiguochunqiu', volume=9, position=9,
                  title='卷 9 · 吴列传（王稔、曹筠、徐善等）', page='十國春秋/卷009', subjects=[], fixedRevisionId=2554077))
SPECS.append(dict(id='shiguochunqiu-v012', bookId='shiguochunqiu', volume=12, position=12,
                  title='卷 12 · 吴列传（钱亮、申渐高、朱延寿妻等）', page='十國春秋/卷012', subjects=[], fixedRevisionId=2554082))
SPECS.append(dict(id='shiguochunqiu-v021', bookId='shiguochunqiu', volume=21, position=21,
                  title='卷 21 · 南唐列传（周宗、李建勋、徐玠等）', page='十國春秋/卷021', subjects=['li-bian', 'li-jing-southern-tang', 'li-yu', 'qian-hongchu', 'song-qiqiu', 'wang-jingren', 'wu-xu-wen-daughter-guangde', 'wu-yang-xingmi-daughter-xu-jie-wife', 'yang-longyan', 'yang-pu', 'yang-xingmi', 'zhu-wen'], sourceLocalSubjectsOnly=True, fixedRevisionId=2554093, minimumCharacters=5688, minimumBlocks=16))
SPECS.append(dict(id='shiguochunqiu-v077', bookId='shiguochunqiu', volume=77, position=77,
                  title="卷 77 · 吴越武肃王世家上（钱镠）", page='十國春秋/卷077', subjects=["qian-liu","qian-yuanguan","wang-jingren","wang-shenzhi","wu-tian-jun-mother-yin","wu-yang-xingmi-daughter-qian-yuanliao-wife","yang-xingmi","zhu-wen"],
                  sourceLocalSubjectsOnly=True, fixedRevisionId=2556906, minimumCharacters=19700, minimumBlocks=14))
SPECS.append(dict(id='nantangjinshi-v002', bookId='nantangjinshi', volume=2, position=2,
                  title='卷 2 · 南唐近事', page='南唐近事', subjects=[], fixedRevisionId=1503836,
                  sourceSection={'heading': '卷二', 'untilHeading': '佚文'}))
SPECS.append(dict(id='quantangwen-v884', bookId='quantangwen', volume=884, position=884,
                  title='卷 884 · 徐铉文', page='全唐文/卷0884', subjects=[], fixedRevisionId=8723175))

# Complete, fixed southern Tang sources; shared names are attributed locally.
SPECS.append({'id': 'shiguochunqiu-v015', 'bookId': 'shiguochunqiu', 'volume': 15, 'position': 15, 'title': '卷 15 · 南唐烈祖本纪（李昪）', 'page': '十國春秋/卷015', 'subjects': ['li-bian', 'yang-xingmi', 'yang-wo', 'li-jing-southern-tang', 'song-qiqiu', 'wu-xu-wen-wife-li', 'nantang-li-bian-mother-liu', 'chai-rong', 'yang-pu', 'gao-conghui', 'nantang-song-fujin', 'nantang-li-bian-consort-wang', 'nantang-fengcheng-princess', 'nantang-shengtang-princess', 'nantang-taihe-princess', 'nantang-jianchang-princess', 'wu-yang-lian-wife-li-yongxing', 'wu-yang-pu-princess-shangrao', 'zhu-wenjin', 'li-yu', 'zhu-wen', 'wu-xu-wen-daughter-guangde', 'wang-yanzheng', 'wang-yanxi', 'yang-longyan', 'shi-jingtang'], 'sourceLocalSubjectsOnly': True, 'fixedRevisionId': 2554108, 'minimumCharacters': 11097, 'minimumBlocks': 11})
SPECS.append({'id': 'shiguochunqiu-v018', 'bookId': 'shiguochunqiu', 'volume': 18, 'position': 18, 'title': '卷 18 · 南唐后妃列传', 'page': '十國春秋/卷018', 'subjects': ['li-bian', 'li-jing-southern-tang', 'nantang-li-bian-consort-wang', 'nantang-song-fujin', 'nantang-li-bian-consort-shiguang', 'li-yu', 'xu-xuan', 'han-xizai', 'ma-xie'], 'sourceLocalSubjectsOnly': True, 'fixedRevisionId': 2554090, 'minimumCharacters': 4957, 'minimumBlocks': 12})
SPECS.append({'id': 'shiguochunqiu-v019', 'bookId': 'shiguochunqiu', 'volume': 19, 'position': 19, 'title': '卷 19 · 南唐宗室及公主列传', 'page': '十國春秋/卷019', 'subjects': ['li-bian', 'li-jing-southern-tang', 'song-qiqiu', 'wu-yang-pu-princess-shangrao', 'yang-pu', 'li-yu', 'nantang-song-fujin', 'nantang-li-bian-consort-shiguang', 'chai-rong', 'han-xizai', 'xu-xuan', 'wu-yang-lian-wife-li-yongxing', 'nantang-fengcheng-princess', 'nantang-shengtang-princess', 'nantang-taihe-princess', 'nantang-jianchang-princess'], 'sourceLocalSubjectsOnly': True, 'fixedRevisionId': 2554089, 'minimumCharacters': 8034, 'minimumBlocks': 28})
SPECS.append({'id': 'nantanglu-v001', 'bookId': 'nantanglu', 'volume': 1, 'position': 1, 'title': '卷 1 · 烈祖本纪第一', 'page': '南唐書 (陸游, 四庫全書本)/卷01', 'subjects': ['li-bian', 'yang-xingmi', 'yang-wo', 'song-qiqiu', 'wu-xu-wen-wife-li', 'nantang-li-bian-mother-liu', 'li-jing-southern-tang', 'yang-pu', 'gao-conghui', 'nantang-song-fujin', 'nantang-li-bian-consort-wang', 'nantang-fengcheng-princess', 'nantang-shengtang-princess', 'nantang-taihe-princess', 'nantang-jianchang-princess', 'wu-yang-lian-wife-li-yongxing', 'wu-yang-pu-princess-shangrao', 'zhu-wenjin', 'zhu-wen', 'yang-longyan'], 'sourceLocalSubjectsOnly': True, 'fixedRevisionId': 838666, 'minimumCharacters': 3643, 'minimumBlocks': 11})
SPECS.append({'id': 'nantanglu-v016', 'bookId': 'nantanglu', 'volume': 16, 'position': 16, 'title': '卷 16 · 后妃诸王列传第十三', 'page': '南唐書 (陸游, 四庫全書本)/卷16', 'subjects': ['nantang-song-fujin', 'nantang-li-bian-consort-wang', 'li-bian', 'li-jing-southern-tang', 'nantang-li-bian-consort-shiguang', 'li-yu', 'xu-xuan', 'wu-yang-pu-princess-shangrao', 'yang-pu', 'chai-rong'], 'sourceLocalSubjectsOnly': True, 'fixedRevisionId': 838681, 'minimumCharacters': 5027, 'minimumBlocks': 20})
SPECS.append({'id': 'nantangma-v006', 'bookId': 'nantangma', 'volume': 6, 'position': 6, 'title': '卷 6 · 女宪传', 'page': '南唐書 (馬令, 四庫全書本)/卷06', 'subjects': ['nantang-song-fujin', 'li-bian', 'li-jing-southern-tang', 'nantang-li-bian-consort-shiguang', 'li-yu', 'xu-xuan', 'han-xizai', 'ma-xie', 'wu-xu-wen-daughter-guangde', 'song-qiqiu', 'wu-yang-lian-wife-li-yongxing', 'wang-yanzheng'], 'sourceLocalSubjectsOnly': True, 'fixedRevisionId': 838694, 'minimumCharacters': 4505, 'minimumBlocks': 17})

for chapter_id, related_people in {'new-v62': ['nantang-song-fujin'], 'tongjian-v283': ['nantang-song-fujin', 'nantang-li-bian-consort-shiguang'], 'shiguochunqiu-v021': ['nantang-song-fujin'], 'nantangma-v010': ['nantang-song-fujin'], 'quantangwen-v884': ['nantang-song-fujin'], 'tongjian-v285': ['nantang-song-fujin'], 'nantanglu-v017': ['nantang-song-fujin'], 'tongjian-v281': ['nantang-song-fujin']}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *related_people]))

SOUTHERN_TANG_COMPLETE_NOTES = {'shiguochunqiu-v015': ['本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。', '古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。', '本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2554108；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。'], 'shiguochunqiu-v018': ['本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。', '古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。', '本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2554090；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。'], 'shiguochunqiu-v019': ['本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。', '古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。', '本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2554089；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。'], 'nantanglu-v001': ['本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。', '古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。', '本卷据保存的维基文库四库本页面完整渲染正文整理，报告的父页修订号为838666；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。'], 'nantanglu-v016': ['本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。', '古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。', '本卷据保存的维基文库四库本页面完整渲染正文整理，报告的父页修订号为838681；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。'], 'nantangma-v006': ['本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。', '古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。', '本卷据保存的维基文库四库本页面完整渲染正文整理，报告的父页修订号为838694；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。']}

# Explicit reign and shared-annal links are metadata only. Original files and
# captured revisions stay byte-identical when the roster grows.
REIGN_SUBJECTS = {'tongjian-v266': ['zhu-wen'],
 'tongjian-v267': ['zhu-wen'],
 'tongjian-v268': ['zhu-wen', 'zhu-yougui', 'zhu-youzhen'],
 'tongjian-v269': ['zhu-youzhen'],
 'tongjian-v270': ['zhu-youzhen'],
 'tongjian-v271': ['zhu-youzhen'],
 'tongjian-v272': ['zhu-youzhen', 'li-cunxu'],
 'tongjian-v273': ['li-cunxu'],
 'tongjian-v274': ['li-cunxu'],
 'tongjian-v275': ['li-cunxu', 'li-siyuan'],
 'tongjian-v276': ['li-siyuan'],
 'tongjian-v277': ['li-siyuan'],
 'tongjian-v278': ['li-siyuan', 'li-conghou'],
 'tongjian-v279': ['li-conghou', 'li-congke'],
 'tongjian-v280': ['li-congke', 'shi-jingtang'],
 'tongjian-v281': ['shi-jingtang'],
 'tongjian-v282': ['shi-jingtang'],
 'tongjian-v283': ['shi-jingtang', 'shi-chonggui'],
 'tongjian-v284': ['shi-chonggui'],
 'tongjian-v285': ['shi-chonggui'],
 'tongjian-v286': ['liu-zhiyuan'],
 'tongjian-v287': ['liu-zhiyuan', 'liu-chengyou'],
 'tongjian-v288': ['liu-chengyou'],
 'tongjian-v289': ['liu-chengyou'],
 'tongjian-v290': ['guo-wei'],
 'tongjian-v291': ['guo-wei', 'chai-rong'],
 'tongjian-v292': ['chai-rong'],
 'tongjian-v293': ['chai-rong'],
 'tongjian-v294': ['chai-rong', 'chai-zongxun'],
 'old-v007': ['zhu-wen', 'zhu-yougui'],
 'old-v080': ['shi-jingtang', 'shi-chonggui'],
 'old-v100': ['liu-zhiyuan', 'liu-chengyou'],
 'old-v113': ['guo-wei', 'chai-rong'],
 'new-v02': ['zhu-wen', 'zhu-yougui'],
 'new-v04': ['li-keyong', 'li-cunxu'],
 'new-v07': ['li-conghou', 'li-congke'],
 'new-v10': ['liu-zhiyuan', 'liu-chengyou'],
 'new-v12': ['chai-rong', 'chai-zongxun']}
for spec in SPECS:
    if spec['id'] in REIGN_SUBJECTS:
        spec['subjects'] = REIGN_SUBJECTS[spec['id']]
    if spec['bookId'] == 'chunqiu' and spec['volume']:
        spec['subjects'] = (['zhu-wen', 'zhu-yougui', 'zhu-youzhen', 'li-cunxu', 'li-siyuan', 'li-conghou', 'li-congke']
                            if spec['volume'] == 1 else
                            ['shi-jingtang', 'shi-chonggui', 'liu-zhiyuan', 'liu-chengyou', 'guo-wei', 'chai-rong', 'chai-zongxun'])
    if spec['bookId'] in {'quewen', 'shibu', 'huiyao', 'beimeng', 'kaoyi'} and not spec.get('indexPage'):
        spec['scanSubjects'] = True

# Source-bound H60 canonical-person metadata only; preserve all unrelated specs.
for chapter_id, added_subjects in {
    'shiguochunqiu-v004': ['wu-yang-pu-empress-wang', 'wu-yang-lian-wife-li-yongxing', 'wu-yang-pu-princess-shangrao'],
    'tongjian-v278': ['wu-yang-pu-empress-wang'],
    'new-v62': ['wu-yang-lian-wife-li-yongxing'],
    'tongjian-v281': ['wu-yang-lian-wife-li-yongxing'],
}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *added_subjects]))

# Source-bound H61 wife entries only; no global bare-kinship matching.
for chapter_id, added_subjects in {
    'shiguochunqiu-v004': ['wu-yang-meng-wife'],
    'tongjian-v281': ['wu-yang-meng-wife'],
}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *added_subjects]))

# Source-bound H67 maternal records only; preserve old specs and unrelated source bytes.
for chapter_id, added_subjects in {
    "new-v67": [
        "wu-tian-jun-mother-yin"
    ],
    "shiguochunqiu-v013": [
        "wu-tian-jun-mother-yin"
    ]
}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *added_subjects]))

# Source-bound H68 Li Shenfu household records only; preserve old specs and unrelated source bytes.
for chapter_id, added_subjects in {
    "new-v61": [
        "wu-li-shenfu-wife-unnamed"
    ],
    "shiguochunqiu-v013": [
        "wu-li-shenfu-wife-unnamed"
    ]
}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *added_subjects]))

# Source-bound H69 An Renyi household records only; preserve old specs and unrelated source bytes.
for chapter_id, added_subjects in {
    "shiguochunqiu-v013": [
        "wu-an-renyi-concubine-unnamed"
    ]
}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *added_subjects]))

# Source-bound H70 chapter entrances; source originals and legacy fields remain unchanged.
for chapter_id, added_subjects in {
    "shiguochunqiu-v007": [
        "li-cunxu",
        "yang-xingmi",
        "yang-longyan",
        "zhu-wen",
        "zhu-youzhen",
        "wang-jingren",
        "li-sian",
        "yang-wo",
        "qian-liu",
        "li-bian",
        "wu-li-decheng-wife-yang",
        "wu-li-decheng-daughter-jingda-wife",
        "yang-pu",
        "li-jing-southern-tang"
    ],
    "nantangjinshi-v002": [
        "han-xizai",
        "li-bian",
        "li-jing-southern-tang",
        "song-qiqiu",
        "wu-li-decheng-wife-yang",
        "li-yu"
    ],
    "quantangwen-v884": [
        "li-bian",
        "li-jing-southern-tang",
        "xu-xuan",
        "yang-xingmi",
        "wu-li-decheng-daughter-liu-chongjun-first-wife",
        "wu-li-decheng-daughter-liu-chongjun-later-wife"
    ]
}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *added_subjects]))

# Source-bound C001 canonical chapter metadata; preserve all prior subjects and source bytes.
for chapter_id, added_subjects in {
    "shiguochunqiu-v001": ["jing-xiang"],
    "shiguochunqiu-v002": ["jing-xiang"],
    "beimeng-v017": [
        "jing-xiang"
    ],
    "chunqiu-v001": [
        "jing-xiang"
    ],
    "huiyao-v001": [
        "jing-xiang"
    ],
    "huiyao-v013": [
        "jing-xiang"
    ],
    "huiyao-v024": [
        "jing-xiang"
    ],
    "kaoyi-v028": [
        "jing-xiang"
    ],
    "kaoyi-v029": [
        "jing-xiang"
    ],
    "new-v02": [
        "jing-xiang"
    ],
    "new-v03": [
        "jing-xiang"
    ],
    "new-v05": [
        "jing-xiang"
    ],
    "new-v13": [
        "jing-xiang"
    ],
    "new-v21": [
        "jing-xiang"
    ],
    "new-v23": [
        "jing-xiang"
    ],
    "new-v32": [
        "jing-xiang"
    ],
    "new-v43": [
        "jing-xiang"
    ],
    "old-v001": [
        "jing-xiang"
    ],
    "old-v002": [
        "jing-xiang"
    ],
    "old-v003": [
        "jing-xiang"
    ],
    "old-v005": [
        "jing-xiang"
    ],
    "old-v006": [
        "jing-xiang"
    ],
    "old-v007": [
        "jing-xiang"
    ],
    "old-v008": [
        "jing-xiang"
    ],
    "old-v009": [
        "jing-xiang"
    ],
    "old-v010": [
        "jing-xiang"
    ],
    "old-v015": [
        "jing-xiang"
    ],
    "old-v018": [
        "jing-xiang",
        "zhu-yougui",
        "liu-xun",
        "he-gui",
        "wang-yanzhang",
        "liu-zhijun",
        "yuan-xiangxian",
        "duan-ning",
        "guo-chongtao",
        "li-keyong",
        "ma-yin",
        "zhu-wen",
        "zhu-youzhen",
        "li-cunxu"
    ],
    "old-v019": [
        "jing-xiang"
    ],
    "old-v020": [
        "jing-xiang"
    ],
    "old-v030": [
        "jing-xiang"
    ],
    "old-v059": [
        "jing-xiang"
    ],
    "old-v063": [
        "jing-xiang"
    ],
    "old-v073": [
        "jing-xiang"
    ],
    "shibu-v001": [
        "jing-xiang"
    ],
    "tongjian-v266": [
        "jing-xiang"
    ],
    "tongjian-v268": [
        "jing-xiang"
    ],
    "tongjian-v269": [
        "jing-xiang"
    ],
    "tongjian-v270": [
        "jing-xiang"
    ],
    "tongjian-v271": [
        "jing-xiang"
    ],
    "tongjian-v272": [
        "jing-xiang"
    ]
}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *added_subjects]))


# Source-local princess identities; archive captures and original bytes stay fixed.
for chapter_id, related_people in {"shiguochunqiu-v015":["nantang-yushan-princess"],"nantanglu-v001":["nantang-yushan-princess"],"shiguochunqiu-v019":["nantang-yushan-princess","nantang-xingguo-princess"],"shiguochunqiu-v021":["nantang-xingguo-princess"]}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *related_people]))


# Source-local princess identities; archive captures and original bytes stay fixed.
for chapter_id, related_people in {"shiguochunqiu-v018":["nantang-li-jing-empress-zhong","nantang-li-jing-consort-ling"],"shiguochunqiu-v019":["nantang-li-jing-empress-zhong","nantang-taining-princess","nantang-fangyi","nantang-li-congshan-consort"],"nantanglu-v016":["nantang-li-jing-empress-zhong","nantang-li-jing-consort-ling","nantang-li-congshan-consort"],"nantangma-v006":["nantang-li-jing-empress-zhong"],"new-v62":["nantang-li-jing-empress-zhong"],"tongjian-v283":["nantang-li-jing-empress-zhong"],"tongjian-v272":["nantang-li-jing-empress-zhong"],"shiguochunqiu-v003":["nantang-li-jing-empress-zhong"],"nantanglu-v017":["nantang-geng-xiansheng"],"nantangjinshi-v002":["nantang-geng-xiansheng"]}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *related_people]))


# Source-local household identities; archive captures and original bytes stay fixed.
for chapter_id, related_people in {"shiguochunqiu-v018":["nantang-li-yu-empress-zhaohui","nantang-li-yu-younger-zhou","nantang-li-yu-baoyi-huang","nantang-li-yu-liuzhu","nantang-li-yu-palace-qiao","nantang-li-yu-yaoniang"],"nantanglu-v016":["nantang-li-yu-empress-zhaohui","nantang-li-yu-younger-zhou","nantang-li-yu-baoyi-huang","nantang-li-yu-liuzhu"],"nantangma-v006":["nantang-li-yu-empress-zhaohui","nantang-li-yu-younger-zhou","nantang-li-yu-baoyi-huang","nantang-li-jing-empress-zhong"],"shiguochunqiu-v019":["nantang-li-yu-empress-zhaohui"],"new-v62":["nantang-li-yu-empress-zhaohui"],"shiguochunqiu-v021":["nantang-li-yu-empress-zhaohui","nantang-li-yu-younger-zhou"]}.items():
    selected = next(spec for spec in SPECS if spec['id'] == chapter_id)
    selected['subjects'] = list(dict.fromkeys([*selected['subjects'], *related_people]))

# Complete source-local Southern Tang additions; retained captures and originals stay fixed.
SPECS.extend(json.loads("[{\"id\":\"shiguochunqiu-v016\",\"bookId\":\"shiguochunqiu\",\"volume\":16,\"position\":16,\"title\":\"卷 16 · 南唐元宗本纪（李璟）\",\"page\":\"十國春秋/卷016\",\"subjects\":[\"li-jing-southern-tang\",\"li-bian\",\"nantang-song-fujin\",\"nantang-li-jing-empress-zhong\",\"song-qiqiu\",\"han-xizai\",\"zhu-wenjin\",\"wang-yanxi\",\"wang-yanzheng\",\"xu-xuan\",\"shi-jingtang\",\"shi-chonggui\",\"liu-chengyou\",\"ma-xie\",\"ma-xiguang\",\"ma-yin\",\"ma-xichong\",\"guo-wei\",\"chai-rong\",\"li-yu\",\"yang-pu\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":2554620,\"minimumCharacters\":16039,\"minimumBlocks\":20},{\"id\":\"shiguochunqiu-v025\",\"bookId\":\"shiguochunqiu\",\"volume\":25,\"position\":25,\"title\":\"卷 25 · 南唐列传（张易、萧俨等）\",\"page\":\"十國春秋/卷025\",\"subjects\":[\"li-jing-southern-tang\",\"li-yu\",\"li-bian\",\"song-qiqiu\",\"han-xizai\",\"nantang-song-fujin\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":2556826,\"minimumCharacters\":6483,\"minimumBlocks\":19},{\"id\":\"shiguochunqiu-v034\",\"bookId\":\"shiguochunqiu\",\"volume\":34,\"position\":34,\"title\":\"卷 34 · 南唐列传（王栖霞、耿先生、杨保宗等）\",\"page\":\"十國春秋/卷034\",\"subjects\":[\"li-bian\",\"nantang-song-fujin\",\"xu-xuan\",\"li-jing-southern-tang\",\"song-qiqiu\",\"li-yu\",\"nantang-geng-xiansheng\",\"han-xizai\",\"nantang-yang-baozong\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":2541499,\"minimumCharacters\":3888,\"minimumBlocks\":10}]"))
SOUTHERN_TANG_COMPLETE_NOTES.update(json.loads("{\"shiguochunqiu-v016\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2554620；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"],\"shiguochunqiu-v025\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2556826；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"],\"shiguochunqiu-v034\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2541499；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"]}"))

# H102 complete Southern Tang source additions; old source specs and notes stay intact.
SPECS.extend(json.loads("[{\"id\":\"shiguochunqiu-v017\",\"bookId\":\"shiguochunqiu\",\"volume\":17,\"position\":17,\"title\":\"卷 17 · 南唐后主本纪\",\"page\":\"十國春秋/卷017\",\"subjects\":[\"li-yu\",\"li-jing-southern-tang\",\"li-bian\",\"nantang-li-jing-empress-zhong\",\"nantang-li-yu-empress-zhaohui\",\"nantang-li-yu-younger-zhou\",\"han-xizai\",\"xu-xuan\",\"chai-rong\",\"qian-hongchu\",\"liu-chang-southern-han\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":2554086,\"minimumCharacters\":11523,\"minimumBlocks\":18},{\"id\":\"nantanglu-v003\",\"bookId\":\"nantanglu\",\"volume\":3,\"position\":3,\"title\":\"卷 3 · 后主本纪第三\",\"page\":\"南唐書 (陸游, 四庫全書本)/卷03\",\"subjects\":[\"li-yu\",\"li-jing-southern-tang\",\"nantang-li-jing-empress-zhong\",\"nantang-li-yu-empress-zhaohui\",\"han-xizai\",\"xu-xuan\",\"nantang-li-yu-younger-zhou\",\"li-bian\",\"qian-hongchu\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":838668,\"minimumCharacters\":2941,\"minimumBlocks\":18},{\"id\":\"nantangma-v005\",\"bookId\":\"nantangma\",\"volume\":5,\"position\":5,\"title\":\"卷 5 · 后主书第五\",\"page\":\"南唐書 (馬令, 四庫全書本)/卷05\",\"subjects\":[\"li-jing-southern-tang\",\"li-yu\",\"li-bian\",\"nantang-li-jing-empress-zhong\",\"nantang-li-yu-empress-zhaohui\",\"nantang-li-yu-younger-zhou\",\"nantang-li-yu-baoyi-huang\",\"han-xizai\",\"xu-xuan\",\"meng-chang\",\"liu-chang-southern-han\",\"gao-jichong\",\"chai-rong\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":838693,\"minimumCharacters\":3989,\"minimumBlocks\":7}]"))
SOUTHERN_TANG_COMPLETE_NOTES.update(json.loads("{\"shiguochunqiu-v017\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2554086；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"],\"nantanglu-v003\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库四库本页面完整渲染正文整理，报告的父页修订号为838668；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"],\"nantangma-v005\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库四库本页面完整渲染正文整理，报告的父页修订号为838693；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"]}"))

# H103 complete Southern Tang source additions; old source specs and notes stay intact.
SPECS.extend(json.loads("[{\"id\":\"shiguochunqiu-v020\",\"bookId\":\"shiguochunqiu\",\"volume\":20,\"position\":20,\"title\":\"卷 20 · 南唐列传（徐氏、宋齐丘）\",\"page\":\"十國春秋/卷020\",\"subjects\":[\"li-bian\",\"li-jing-southern-tang\",\"li-yu\",\"xu-xuan\",\"nantang-li-yu-empress-zhaohui\",\"nantang-li-yu-younger-zhou\",\"song-qiqiu\",\"han-xizai\",\"yang-pu\",\"wu-yang-lian-wife-li-yongxing\",\"wu-yang-pu-princess-shangrao\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":2554091,\"minimumCharacters\":4609,\"minimumBlocks\":8}]"))
SOUTHERN_TANG_COMPLETE_NOTES.update(json.loads("{\"shiguochunqiu-v020\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2554091；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"]}"))

# H104 complete Southern Tang source additions; old source specs and notes stay intact.
SPECS.extend(json.loads("[{\"id\":\"shiguochunqiu-v033\",\"bookId\":\"shiguochunqiu\",\"volume\":33,\"position\":33,\"title\":\"卷 33 · 南唐列传（僧人、小长老等）\",\"page\":\"十國春秋/卷033\",\"subjects\":[\"li-bian\",\"li-jing-southern-tang\",\"song-qiqiu\",\"li-yu\",\"nantang-li-yu-baoyi-huang\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":3067127,\"minimumCharacters\":3267,\"minimumBlocks\":20}]"))
SOUTHERN_TANG_COMPLETE_NOTES.update(json.loads("{\"shiguochunqiu-v033\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为3067127；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"]}"))

# H105 complete Southern Tang source additions; old source specs and notes stay intact.
SPECS.extend(json.loads("[{\"id\":\"shiguochunqiu-v022\",\"bookId\":\"shiguochunqiu\",\"volume\":22,\"position\":22,\"title\":\"卷 22 · 南唐列传（王崇文、刘崇俊等）\",\"page\":\"十國春秋/卷022\",\"subjects\":[\"li-bian\",\"li-jing-southern-tang\",\"li-yu\",\"nantang-taining-princess\",\"chai-rong\",\"wang-yanzheng\",\"ma-xie\",\"ma-xichong\",\"wang-jingren\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":2554094,\"minimumCharacters\":5254,\"minimumBlocks\":13}]"))
SOUTHERN_TANG_COMPLETE_NOTES.update(json.loads("{\"shiguochunqiu-v022\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2554094；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"]}"))

# H106 complete Southern Tang source additions; old source specs and notes stay intact.
SPECS.extend(json.loads("[{\"id\":\"shiguochunqiu-v023\",\"bookId\":\"shiguochunqiu\",\"volume\":23,\"position\":23,\"title\":\"卷 23 · 南唐列传（严续、常梦锡等）\",\"page\":\"十國春秋/卷023\",\"subjects\":[\"li-bian\",\"li-jing-southern-tang\",\"li-yu\",\"song-qiqiu\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":2554618,\"minimumCharacters\":3355,\"minimumBlocks\":13}]"))
SOUTHERN_TANG_COMPLETE_NOTES.update(json.loads("{\"shiguochunqiu-v023\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2554618；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"]}"))

SUBJECT_NAMES = {
    'zhu-wen': ['朱溫', '朱温', '朱全忠', '朱晃'],
    'zhu-yougui': ['朱友珪', '友珪'],
    'zhu-youzhen': ['朱友貞', '朱友贞', '友貞', '朱鍠', '朱瑱'],
    'li-cunxu': ['李存勖', '李存勗', '存勖', '存勗'],
    'li-siyuan': ['李嗣源', '嗣源', '李亶'],
    'li-conghou': ['李從厚', '從厚'],
    'li-congke': ['李從珂', '從珂'],
    'shi-jingtang': ['石敬瑭', '敬瑭'],
    'shi-chonggui': ['石重貴', '重貴'],
    'liu-zhiyuan': ['劉知遠', '知遠', '劉暠'],
    'liu-chengyou': ['劉承祐', '承祐'],
    'guo-wei': ['郭威'],
    'chai-rong': ['柴榮', '郭榮'],
    'chai-zongxun': ['柴宗訓', '郭宗訓', '宗訓'],
    'li-sizhao': ['李嗣昭', '嗣昭'],
    'li-siben': ['李嗣本', '嗣本'],
    'li-sien': ['李嗣恩', '嗣恩'],
    'li-cunxin': ['李存信'],
    'li-cunjin': ['李存進', '存進'],
    'li-cunzhang': ['李存璋', '存璋'],
    'fu-cunshen': ['符存審', '李存審', '存審'],
    'li-cunxian': ['李存賢', '存賢'],
    'shi-jingsi': ['史敬思'],
    'kang-junli': ['康君立'],
    'li-cunxiao': ['李存孝', '存孝'],
}
SUBJECT_TITLES = {
    'zhu-wen': ['梁太祖', '梁祖'], 'zhu-yougui': ['梁郢王'], 'zhu-youzhen': ['梁末帝'],
    'li-cunxu': ['唐莊宗', '後唐莊宗'], 'li-siyuan': ['唐明宗', '後唐明宗'],
    'li-conghou': ['唐閔帝', '唐愍帝'], 'li-congke': ['唐末帝', '唐廢帝'],
    'shi-jingtang': ['晉高祖', '晉祖'], 'shi-chonggui': ['晉少帝', '晉出帝'],
    'liu-zhiyuan': ['後漢高祖', '漢祖'], 'liu-chengyou': ['漢隱帝'],
    'guo-wei': ['周太祖', '周祖'], 'chai-rong': ['周世宗'], 'chai-zongxun': ['周恭帝'],
}

# Display topics can grow without changing captured source files. The topic's
# variants are verified complete personal names; short forms and bare titles
# belong only in the separately reviewed person-passage rules.
GENERAL_PEOPLE = []
for topic_file in ['zhu-wen-generals.json', 'li-keyong-generals.json']:
    generals_path = ROOT / topic_file
    if generals_path.exists():
        GENERAL_PEOPLE.extend(json.loads(generals_path.read_text())['people'])

# Names shared with unrelated officers (王建), and substrings within longer
# names (王建及, 劉崇景), cannot establish a ruler's source association.
# Use the reviewed person index for cross-volume links; main biographies are
# explicitly retained through the checked readingStarts before indexing.
TEN_KINGDOM_RULERS = []
TEN_KINGDOM_CHAPTER_PEOPLE = {}
ten_kingdom_path = ROOT / 'ten-kingdoms-rulers.json'
if ten_kingdom_path.exists():
    TEN_KINGDOM_RULERS = json.loads(ten_kingdom_path.read_text())['people']
    ten_kingdom_ids = {person['id'] for person in TEN_KINGDOM_RULERS}
    passage_path = ROOT.parent / 'person-passages' / 'index.json'
    if passage_path.exists():
        for passage in json.loads(passage_path.read_text())['passages']:
            for association in passage['people']:
                if association['personId'] in ten_kingdom_ids:
                    TEN_KINGDOM_CHAPTER_PEOPLE.setdefault(passage['chapterId'], set()).add(association['personId'])

def scanned_subjects(paragraphs, book_id):
    text = '\n'.join(paragraphs)
    return [person for person, names in SUBJECT_NAMES.items()
            if any(name in text for name in names + SUBJECT_TITLES.get(person, []))]

def chapter_subjects(spec, paragraphs, previous_subjects=()):
    subjects = list(spec['subjects'])
    if spec.get('sourceLocalSubjectsOnly'):
        # This volume has names shared by unrelated people (the Wu and Liang
        # generals Wang Yanzhang). Keep only its reviewed local identities and
        # earlier confirmed chapter links; do not infer identities from names.
        return list(dict.fromkeys([*subjects, *previous_subjects]))
    if spec.get('scanSubjects'):
        # Keep confirmed earlier links while adding only explicit proper names
        # or polity-qualified titles. Bare 太祖/高祖/世宗 never identify a person.
        ruler_ids = {person['id'] for person in TEN_KINGDOM_RULERS}
        subjects += [person for person in previous_subjects if person not in ruler_ids] + scanned_subjects(paragraphs, spec['bookId'])
    # New people's passing mentions supplement, rather than replace, existing
    # reign/biography links. Existing originals and captures are never rewritten.
    text = '\n'.join(paragraphs)
    subjects += [person for person in ['li-sizhao', 'li-siben', 'li-sien', 'li-cunxin', 'li-cunjin', 'li-cunzhang', 'fu-cunshen', 'li-cunxian', 'shi-jingsi', 'kang-junli', 'li-cunxiao']
                 if any(name in text for name in SUBJECT_NAMES[person])]
    for person in GENERAL_PEOPLE:
        if (person.get('readingStarts', {}).get(spec['bookId']) == spec['id']
                or any(name in text for name in person['nameVariants'])):
            subjects.append(person['id'])
    for person in TEN_KINGDOM_RULERS:
        if (person.get('readingStarts', {}).get(spec['bookId']) == spec['id']
                or person['id'] in TEN_KINGDOM_CHAPTER_PEOPLE.get(spec['id'], set())):
            subjects.append(person['id'])
    return list(dict.fromkeys(subjects))

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
        if node.tag in {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'dt', 'dd', 'li'} or (index_page and node.tag == 'div' and re.search(r'float\s*:\s*right', node.attrs.get('style', '')) and not any(isinstance(child, Node) and child.tag == 'div' for child in node.children)):
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

def source_blocks(payload, with_tags=False):
    # One fixed page can contain several volumes; retain explicit source bounds.
    selection = payload.get('selection', {})
    blocks = extract(payload['response']['parse']['text']['*'], with_tags=True,
                     index_page=selection.get('indexPage', False))
    section = selection.get('sourceSection')
    if section is not None:
        if (set(section) != {'heading', 'untilHeading'}
                or not all(isinstance(section[k], str) and section[k] for k in section)):
            raise ValueError('Invalid source section')
        starts = [i for i, (text, tag) in enumerate(blocks) if tag == 'h2' and text == section['heading']]
        if len(starts) != 1: raise ValueError('Source section start changed')
        start = starts[0]
        ends = [i for i in range(start + 1, len(blocks)) if blocks[i][1] == 'h2']
        if not ends or blocks[ends[0]][0] != section['untilHeading']:
            raise ValueError('Source section end changed')
        blocks = blocks[start:ends[0]]
    return blocks if with_tags else [text for text, _ in blocks]

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
        if spec.get('fixedRevisionId'):
            cached_source = json.loads(path.read_text())
            if (previous['provenance']['revisionId'] != spec['fixedRevisionId']
                    or cached_source['response']['parse']['revid'] != spec['fixedRevisionId']):
                raise ValueError(f"Fixed source revision changed: {spec['id']}")
        cached_source = json.loads(path.read_text())
        if cached_source.get('selection', {}).get('sourceSection') != spec.get('sourceSection'):
            raise ValueError(f"Source section changed: {spec['id']}")
        cached = json.loads(chapter_path.read_text())
        return {**previous, 'subjects': chapter_subjects(spec, [p['original'] for p in cached['paragraphs']], previous['subjects'])}
    if path.exists():
        payload = json.loads(path.read_text())
    else:
        params = dict(action='parse', prop='text|revid|displaytitle', format='json', disableeditsection=1)
        params.update(oldid=spec['fixedRevisionId']) if spec.get('fixedRevisionId') else params.update(page=spec['page'])
        result = request(params)
        if 'parse' not in result: raise ValueError(f"Missing source: {spec['page']} {result}")
        payload = dict(fetchedAt=datetime.now(timezone.utc).isoformat(), response=result)
        if spec.get('sourceSection'): payload['selection'] = {'sourceSection': spec['sourceSection']}
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n')
    parsed = payload['response']['parse']
    if spec.get('fixedRevisionId') and parsed['revid'] != spec['fixedRevisionId']:
        raise ValueError(f"Fixed source revision changed: {spec['id']}")
    if parsed['title'] != spec['page']: raise ValueError(f"Unexpected redirect: {spec['page']} -> {parsed['title']}")
    if payload.get('selection', {}).get('sourceSection') != spec.get('sourceSection'):
        raise ValueError(f"Source section changed: {spec['id']}")
    html = parsed['text']['*']
    if spec.get('indexPage') and payload.get('selection') != {'indexPage': True}:
        payload['selection'] = {'indexPage': True}
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n')
    paragraphs = source_blocks(payload)
    length = sum(len(text) for text in paragraphs)
    if length < spec.get('minimumCharacters', 1000) or len(paragraphs) < spec.get('minimumBlocks', 3): raise ValueError(f"Incomplete source: {spec['id']} {length} characters / {len(paragraphs)} blocks")
    book = next(book for book in BOOKS if book['id'] == spec['bookId'])
    source_url = 'https://zh.wikisource.org/w/index.php?' + urllib.parse.urlencode(dict(title=spec['page'], oldid=parsed['revid']))
    if spec.get('sourceSection'): source_url += '#' + urllib.parse.quote(spec['sourceSection']['heading'])
    notes = [
        '本页完整收录所选卷的来源文本，保留原页正文、序文与夹注；原文使用繁体字。段落划分依来源页面的段落与空行，标题亦作为独立文字块保留。',
        '古籍原作已属公版；维基文库的整理、标点与页面文本按 CC BY-SA 4.0 署名并以相同方式共享。底本、校勘与叙事差异请参照版本信息。',
    ]
    if book['id'] == 'old': notes.append('《旧五代史》为辑佚本。正文保留《永乐大典》《册府元龟》等出处及整理者按语，不把夹注删作缺文。')
    if spec['id'] in {'old-v025', 'old-v026'}: notes.append('本卷记李克用及其先世、麾下人物与继承前后史事。李克用生前为晋王，武皇帝为后唐追尊，不表示其生前称帝。')
    if spec['id'] == 'tongjian-v262': notes.append('本页完整收录《资治通鉴》卷 262 的晚唐记事，补充吴国相关人物的早期材料。原书记年与西历年分别核验，不把邻段月日移给未明确纪日的婚家记载；其他已收卷见书籍目录，不表示全书已收录。')
    elif book['id'] == 'tongjian': notes.append('《资治通鉴》是编年史，本站收录卷 266—294 的五代部分（907—959 年）。人物筛选按各皇帝实际在位记事及政权交接关联，并非卷内出现该人物的穷尽索引。')
    if spec['id'] == 'new-v10': notes.append('此卷合记后汉高祖与隐帝，收录整卷，不将隐帝部分误标为刘知远生平。')
    if book['id'] == 'quewen': notes.append('《五代史阙文》保存史事异闻，含原页提要与序文。传闻记述应与正史、编年史相互参证，不能直接视为定论。')
    if book['id'] in {'shibu', 'beimeng'}: notes.append('本书含史事逸闻，不能将传闻直接视为定论；请与正史、编年史及《资治通鉴考异》相互参证。')
    if book['id'] == 'huiyao': notes.append('《五代会要》按典章制度分类。保留来源异体字及校注。人物关联依据卷中明确出现的姓名或带政权限定的帝号，供整卷参读。')
    if book['id'] == 'beimeng': notes.append('本站选录四库全书本卷 17—20，另收提要与作者自序，不表示全书二十卷已全部收录。')
    if book['id'] == 'kaoyi': notes.append('本站收录卷 28—30 的五代部分。本书记录史料异同及取舍理由，须与《资治通鉴》正文对应阅读。')
    if spec['id'] == 'shiguochunqiu-v002': notes.append('本页据2026年10月16日保存的维基文库标准页面卷2完整渲染正文整理，报告的父页修订号为2554063；正文涉及的Page子页版本未逐一固定。底本文字、夹注和标点照存。同作品四库本仅供版本参校，不作为独立史料复证；已收其他卷见书籍目录，不表示全书已收录。')
    if spec['id'] == 'shiguochunqiu-v003': notes.append('本页据2026年10月16日保存的维基文库标准页面卷3完整正文整理，报告的父页修订号为2554071；所引子页版本未逐一固定。底本文字、夹注和标点照存。同作品四库本仅供版本参校，不作为独立史料复证；已收其他卷见书籍目录，不表示全书已收录。')
    if spec['id'] == 'shiguochunqiu-v005': notes.append('本页据2026年10月16日保存的维基文库标准页面卷5完整渲染正文整理，报告的父页修订号为2554069；所引Page子页版本未逐一固定。底本文字、夹注和标点照存，标题单列。同作品四库本仅供版本参校，不作为独立史料复证；已收其他卷见书籍目录，不表示全书已收录。')
    if spec['id'] == 'shiguochunqiu-v021': notes.append('本页据2026年10月16日保存的维基文库标准页面卷21完整渲染正文整理，报告的父页修订号为2554093；所引Page子页版本未逐一固定。底本文字、夹注和标点照存，标题单列。同作品不同版本仅供校读，不作为独立史料复证；本次不声称另作四库本复核。已收其他卷见书籍目录，不表示全书已收录。')
    if spec['id'] == 'shiguochunqiu-v077': notes.append("本页据2026年10月16日保存的维基文库标准页面卷77完整渲染正文整理，报告的父页修订号为2556906；所引Page子页版本未逐一固定。底本原字、疑讹、重复、夹注及标点照存，标题单列；同作品不同版本仅供校读，不作为独立史料复证。已收其他卷见书籍目录，不表示全书已收录。")
    if spec['id'] == 'shiguochunqiu-v004': notes.append('本站仅收录维基文库《十国春秋》标准页面卷 4，不表示全书已收录。底本讹字与原有标点保持原样，译文及译注参校同一作品的四库本；不同版本不作为独立史料复证。')
    if spec['id'] == 'shiguochunqiu-v013': notes.append('本页完整收录维基文库《十国春秋》标准页面卷 13 的吴国人物列传，原有字词、夹注与标点保持原样；同一作品的四库本仅用于版本校读，不作为独立史料复证。已收其他卷请参见书籍目录，不表示全书已收录。')
    if book['id'] == 'nantanglu': notes.append('本站仅收录陆游《南唐书》卷 17，陆游《南唐书》与马令的同名著作分别编目；完整保留小传、夹注、史家评论及来源标点，不表示全书已收录。同作品四库本只作版本参校，不作独立复证。')
    if book['id'] == 'nantangma': notes.append('本站仅收录马令《南唐书》卷 10，与陆游的同名著作分别编目；完整保留序文、小传、夹注及来源标点，不表示全书已收录。同作品不同版本只作校读，不作独立复证。')
    if spec['id'] == 'shiguochunqiu-v007': notes.append('本页完整收录《十国春秋》标准页面卷 7，原文、夹注与标点保持原样；同作品不同版本只作校读，不作独立复证。已收其他卷请参见书籍目录，不表示全书已收录。')
    if spec['id'] == 'shiguochunqiu-v006': notes.append('本页完整收录《十国春秋》标准页面卷 6，原文、夹注与标点保持原样；同作品四库本只作版本参校，不作独立史料复证。已收其他卷见书籍目录，不表示全书已收录。婚议与嫁配按书分别理解，未明纪年的婚事不套用邻接任官年月。')
    if spec['id'] == 'shiguochunqiu-v009': notes.append('本页据2026年10月16日保存的维基文库标准页面卷9正文整理，报告的父页修订号为2554077；所引子页版本未逐一固定。底本文字、夹注和标点照存，标题单列。同作品四库本仅供版本参校，不作为独立史料复证；已收其他卷见书籍目录，不表示全书已收录。')
    if spec['id'] == 'shiguochunqiu-v012': notes.append('本页据2026年10月16日保存的维基文库标准页面卷12正文整理，报告的父页修订号为2554082；所引子页版本未逐一固定。底本文字、夹注和标点照存，标题单列。同作品不同版本仅供校读，不作为独立史料复证；已收其他卷见书籍目录，不表示全书已收录。')
    if book['id'] == 'nantangjinshi': notes.append('本页完整收录固定来源页面的卷二，从“卷二”标题起，至“佚文”标题前止；不混入同页序、卷一与佚文。原文、夹注与来源标点保持原样；史事逸闻宜与其他来源参读。')
    if book['id'] == 'quantangwen': notes.append('本页完整收录《全唐文》卷 884。来源页所署徐铉为本卷文章撰文者，不据此称其为整部总集编者。碑文、铭文与夹注均保留；褒赠、家世与叙事立场分别按来源理解。')
    if spec.get('indexPage'): notes.append('本页保留原来源的提要、序文等卷外文字。来源页的目录链接由站内可操作目录替代，不将链接列表当作历史正文。')
    if spec['id'] in SOUTHERN_TANG_COMPLETE_NOTES:
        notes = list(SOUTHERN_TANG_COMPLETE_NOTES[spec['id']])
    subjects = chapter_subjects(spec, paragraphs)
    position = spec.get('position', spec['volume'])
    chapter = dict(id=spec['id'], title=spec['title'], position=position, scope='full', sourceUrl=source_url, notes=notes, bookId=book['id'], bookTitle=book['title'], author=book['author'], editionId=book['id']+'-local-wikisource', edition='维基文库整理文本 · 本地归档', paragraphs=[dict(id=spec['id']+f'-p{index+1}', position=index+1, revision=1, original=text, translation=None) for index, text in enumerate(paragraphs)])
    chapter_path.write_text(json.dumps(chapter, ensure_ascii=False, indent=2)+'\n')
    summary = {key: value for key, value in spec.items() if key not in {'page', 'indexPage', 'minimumCharacters', 'minimumBlocks', 'scanSubjects', 'fixedRevisionId', 'sourceLocalSubjectsOnly'}}
    summary.update(subjects=subjects, position=position, scope='full', paragraphCount=len(paragraphs), characterCount=length, provenance=dict(pageTitle=spec['page'], sourceUrl=source_url, revisionId=parsed['revid'], fetchedAt=payload['fetchedAt'], license=LICENSE, licenseUrl=LICENSE_URL, contributorsUrl='https://zh.wikisource.org/w/index.php?'+urllib.parse.urlencode(dict(title=spec['page'], action='history')), sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(), chapterSha256=hashlib.sha256(chapter_path.read_bytes()).hexdigest()))
    print(f"{spec['id']}: {len(paragraphs)} blocks, {length} characters, revision {parsed['revid']}", flush=True)
    return summary

SPECS.extend(json.loads("[{\"id\":\"shiguochunqiu-v024\",\"bookId\":\"shiguochunqiu\",\"volume\":24,\"position\":24,\"title\":\"卷 24 · 南唐列传（李金全、卢文进等）\",\"page\":\"十國春秋/卷024\",\"subjects\":[\"li-siyuan\",\"li-cunxu\",\"shi-jingtang\",\"liu-chengyou\",\"wang-yanqiu\",\"wang-yanxi\",\"wang-yanzheng\",\"li-bian\",\"li-jing-southern-tang\",\"li-yu\",\"chai-rong\",\"tang-li-cunju-consort-lu\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":2556825,\"minimumCharacters\":6530,\"minimumBlocks\":15}]"))
SOUTHERN_TANG_COMPLETE_NOTES.update(json.loads("{\"shiguochunqiu-v024\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2556825；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"]}"))

SPECS.extend(json.loads("[{\"id\":\"nantanglu-v013\",\"bookId\":\"nantanglu\",\"volume\":13,\"position\":13,\"title\":\"卷 13 · 刘潘李严张龚列传第十\",\"page\":\"南唐書 (陸游, 四庫全書本)/卷13\",\"subjects\":[\"yang-xingmi\",\"li-bian\",\"li-jing-southern-tang\",\"li-yu\",\"chai-rong\",\"wu-yang-xingmi-daughter-liu-rengui-wife\",\"yang-wo\",\"yang-longyan\",\"song-qiqiu\",\"liu-chang-southern-han\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":838678,\"minimumCharacters\":4417,\"minimumBlocks\":10}]"))
SOUTHERN_TANG_COMPLETE_NOTES.update(json.loads("{\"nantanglu-v013\":[\"完整归档所选卷正文、卷题、夹注和史家评论；不表示全书已收录。\",\"底本为固定父修订838678的已保存渲染页面，未分别固定转录子页修订；原文、段落标签与次序保持。\"]}"))

SPECS.extend(json.loads("[{\"id\":\"shiguochunqiu-v038\",\"bookId\":\"shiguochunqiu\",\"volume\":38,\"position\":38,\"title\":\"卷 38 · 前蜀后妃宗室列传\",\"page\":\"十國春秋/卷038\",\"subjects\":[\"former-shu-wang-jian-zhou\",\"former-shu-wang-jian-xu-shunsheng\",\"former-shu-wang-jian-xu-yisheng\",\"former-shu-wang-jian-zhang\",\"former-shu-wang-jian-xiao\",\"former-shu-puci-princess\",\"wang-jian-former-shu\",\"wang-yan-former-shu\",\"li-yan-youzhou\",\"li-cunxu\",\"li-siyuan\",\"li-jiji\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":2542154,\"minimumCharacters\":4444,\"minimumBlocks\":34}]"))
SOUTHERN_TANG_COMPLETE_NOTES.update(json.loads("{\"shiguochunqiu-v038\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、序论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。底本与叙事差异请参照具体译注。\",\"本卷据保存的维基文库标准页面完整渲染正文整理，报告的父页修订号为2542154；所引子页修订未逐一固定。同作品不同版本不作为独立史料复证，已收卷篇见目录，不表示全书已收录。\"]}"))

SPECS.extend(json.loads("[{\"id\":\"shiguochunqiu-v040\",\"bookId\":\"shiguochunqiu\",\"volume\":40,\"position\":40,\"title\":\"卷 40 · 前蜀列传（冯涓、周庠等）\",\"page\":\"十國春秋/卷040\",\"subjects\":[\"wang-jian-former-shu\",\"wang-yan-former-shu\",\"former-shu-wang-jian-zhou\",\"former-shu-wei-zhuang-unnamed-ji\",\"zhu-wen\"],\"sourceLocalSubjectsOnly\":true,\"fixedRevisionId\":2439569,\"minimumCharacters\":5534,\"minimumBlocks\":18}]"))
SOUTHERN_TANG_COMPLETE_NOTES.update(json.loads("{\"shiguochunqiu-v040\":[\"本页完整收录所选卷保存来源的正文、标题、夹注、史论及诗文；原文字形、标点与块次照存。\",\"古籍原作已属公版；维基文库整理文本按 CC BY-SA 4.0 署名并以相同方式共享。原书疑字、词中断句和未定训诂在译文保留边界。\",\"本卷父页修订号2439569与保存的完整渲染字节已固定；所引子页修订未逐一固定。同作品不同版本不作为独立复证，已收卷篇见目录，不表示全书已收录。\"]}"))

def main():
    ROOT.joinpath('sources').mkdir(parents=True, exist_ok=True)
    ROOT.joinpath('chapters').mkdir(exist_ok=True)
    # Two simultaneous reads, with cached responses reused on reruns.
    catalog_path = ROOT / 'catalog.json'
    previous = json.loads(catalog_path.read_text()) if catalog_path.exists() else {'chapters': []}
    previous_chapters = {chapter['id']: chapter for chapter in previous['chapters']}
    def capture_current(spec): return capture(spec, previous_chapters.get(spec['id']))
    with ThreadPoolExecutor(max_workers=2) as executor: chapters = list(executor.map(capture_current, SPECS))
    catalog = dict(schemaVersion=1, title='五代十国史料本地文库', license=LICENSE, licenseUrl=LICENSE_URL, books=BOOKS, chapters=chapters)
    ROOT.joinpath('catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n')
    print(f"Archived {len(BOOKS)} works, {len(chapters)} chapters, {sum(c['characterCount'] for c in chapters)} characters.", flush=True)

if __name__ == '__main__': main()
