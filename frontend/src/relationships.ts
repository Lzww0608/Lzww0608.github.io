import { catalogPeople } from './person-catalog.ts';
import tenKingdomsRelationships from '../../content/person-relationships/ten-kingdoms.json' with { type: 'json' };
import type { HistoryPerson } from './types.ts';

export type RelationshipKind = 'kinship' | 'adoption' | 'service' | 'conflict' | 'succession';

export interface RelationshipNode {
  id: string;
  name: string;
  external?: boolean;
  group?: string;
  note?: string;
}

export interface RelationshipSource {
  chapterId: string;
  paragraphId: string;
  title: string;
  excerpt: string;
}

export interface PersonRelationship {
  id: string;
  from: string;
  to: string;
  kind: RelationshipKind;
  label: string;
  note?: string;
  sources: readonly RelationshipSource[];
}

export const relationshipKindLabels: Readonly<Record<RelationshipKind, string>> = {
  kinship: '亲属与姻亲',
  adoption: '收养与养育',
  service: '任职与部将',
  conflict: '冲突与交恶',
  succession: '君位交接',
};

export function buildRelationshipNodes(
  people: readonly Pick<HistoryPerson, 'id' | 'name' | 'dynasty'>[],
  contextNodes: readonly RelationshipNode[] = [],
): RelationshipNode[] {
  const byId = new Map<string, RelationshipNode>();
  for (const person of people) {
    if (!person.id.trim() || byId.has(person.id)) continue;
    byId.set(person.id, { id: person.id, name: person.name, group: person.dynasty });
  }
  for (const node of contextNodes) {
    if (!node.id.trim() || byId.has(node.id)) continue;
    byId.set(node.id, node);
  }
  return [...byId.values()];
}

export const relationshipNodes: readonly RelationshipNode[] = buildRelationshipNodes(catalogPeople, [
  {
    id: 'li-keyong', name: '李克用', external: true, group: '河东 / 晋国',
    note: '晋王李克用；新旧《五代史》中又称唐太祖、武皇。此处仅为理解本站人物关系的关联节点。',
  },
  {
    id: 'li-kerou', name: '李克柔', external: true, group: '河东 / 晋国',
    note: '李克用之弟、李嗣昭的养育者。此处为史料中明确记载的关联节点，未新增人物传记。',
  },
  {
    id: 'li-maozhen', name: '李茂贞', external: true, group: '凤翔 / 岐',
    note: '凤翔节度使、岐王李茂贞；《新五代史》符道昭传记其收道昭为养子、名继远。此处为说明已核验关系的关联节点，未新增朝代入口或人物传记。',
  },
  {
    id: 'li-renda-fuzhou', name: '李仁达', external: true, group: '福州',
    note: '福州将领李仁达，曾拥立并杀害卓俨明；此处用于解释945年的局部政权与已核验关系，未新增独立人物传记。',
  },
]);

function source(chapterId: string, paragraph: number, title: string, excerpt: string): RelationshipSource {
  return { chapterId, paragraphId: `${chapterId}-p${paragraph}`, title, excerpt };
}

// Each quotation is a contiguous excerpt of an immutable archived paragraph.
// Direction means parent → child, commander → subordinate or predecessor → successor;
// siblings and antagonists use the direction only to lay out their relationship.
export const personRelationships: readonly PersonRelationship[] = [
  ...tenKingdomsRelationships as readonly PersonRelationship[],
  // Li Cunxu era service; shared facts also update the other endpoint.
  {
    "id": "li-cunxu-guo-chongtao-service",
    "from": "li-cunxu",
    "to": "guo-chongtao",
    "kind": "service",
    "label": "军职与征战",
    "note": "早事李克用，李存勖时期任枢密与伐蜀招讨使",
    "sources": [
      {
        "chapterId": "old-v057",
        "paragraphId": "old-v057-p4",
        "title": "《旧五代史》 · 卷 57 · 唐列传（郭崇韬）",
        "excerpt": "莊宗即位於魏州，崇韜加檢校太保、守兵部尚書，充樞密使。"
      },
      {
        "chapterId": "old-v057",
        "paragraphId": "old-v057-p10",
        "title": "《旧五代史》 · 卷 57 · 唐列传（郭崇韬）",
        "excerpt": "乃以繼岌為都統，崇韜為招討使。"
      }
    ]
  },
  {
    "id": "li-cunxu-yuan-xingqin-service",
    "from": "li-cunxu",
    "to": "yuan-xingqin",
    "kind": "service",
    "label": "军职与征战",
    "note": "李嗣源养子，后调入李存勖亲军",
    "sources": [
      {
        "chapterId": "new-v25",
        "paragraphId": "new-v25-p36",
        "title": "《新五代史》 · 卷 25 · 唐臣传（符存审、史建瑭等，附史敬思）",
        "excerpt": "莊宗已下魏，益選驍將自衞，聞行欽驍勇，取之為散員都部署，賜姓名曰李紹榮。"
      }
    ]
  },
  {
    "id": "li-cunxu-xia-luqi-service",
    "from": "li-cunxu",
    "to": "xia-luqi",
    "kind": "service",
    "label": "军职与征战",
    "note": "归附李存勖的亲卫将领",
    "sources": [
      {
        "chapterId": "old-v070",
        "paragraphId": "old-v070-p3",
        "title": "《旧五代史》 · 卷 70 · 唐列传（元行钦、夏鲁奇等）",
        "excerpt": "初事宣武軍為軍校，與主將不協，遂歸於莊宗，以為護衛指揮使。"
      }
    ]
  },
  {
    "id": "li-cunxu-fu-xi-service",
    "from": "li-cunxu",
    "to": "fu-xi",
    "kind": "service",
    "label": "军职与征战",
    "note": "赵军主将，后归李存勖并讨张文礼",
    "sources": [
      {
        "chapterId": "old-v059",
        "paragraphId": "old-v059-p5",
        "title": "《旧五代史》 · 卷 59 · 唐列传",
        "excerpt": "莊宗即令閻寶、史建瑭助習討文禮，乃以習為成德軍兵馬留後。"
      }
    ]
  },
  {
    "id": "fu-xi-wu-zhen-service",
    "from": "fu-xi",
    "to": "wu-zhen",
    "kind": "service",
    "label": "直属军职与征战",
    "note": "赵军将领，随符习为晋军作战并讨张文礼",
    "sources": [
      {
        "chapterId": "old-v059",
        "paragraphId": "old-v059-p8",
        "title": "《旧五代史》 · 卷 59 · 唐列传",
        "excerpt": "初為鎮州隊長，以功漸升部將，與符習從征於河上，頗得士心。"
      }
    ]
  },  {
    "id": "li-cunxu-guo-congqian-service",
    "from": "li-cunxu",
    "to": "guo-congqian",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖亲军指挥使，后发动兴教门兵变",
    "sources": [
      {
        "chapterId": "old-v034",
        "paragraphId": "old-v034-p13",
        "title": "《旧五代史》 · 卷 34 · 唐庄宗纪8",
        "excerpt": "從馬直指揮使郭從謙自本營率所部抽戈露刃，至興教門大呼，與黃甲兩軍引弓射興教門。"
      }
    ]
  },
  {
    "id": "li-cunxu-zhu-shouyin-service",
    "from": "li-cunxu",
    "to": "zhu-shouyin",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖早年侍从，后掌蕃汉马步军",
    "sources": [
      {
        "chapterId": "old-v074",
        "paragraphId": "old-v074-p6",
        "title": "《旧五代史》 · 卷 74 · 唐列传（康延孝、朱守殷等）",
        "excerpt": "同光二年，為振武節度使，不之任，仍兼領蕃漢馬步軍。"
      }
    ]
  },
  {
    "id": "li-cunxu-kang-yanxiao-service",
    "from": "li-cunxu",
    "to": "kang-yanxiao",
    "kind": "service",
    "label": "军职与征战",
    "note": "由梁归附李存勖，参与灭梁与伐蜀",
    "sources": [
      {
        "chapterId": "old-v074",
        "paragraphId": "old-v074-p1",
        "title": "《旧五代史》 · 卷 74 · 唐列传（康延孝、朱守殷等）",
        "excerpt": "翌日，賜田宅於鄴，以為捧日軍使兼南面招討指揮使、檢校司空，守博州刺史。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-yan-youzhou-service",
    "from": "li-cunxu",
    "to": "li-yan-youzhou",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖客省使，兼伐蜀招抚军职",
    "sources": [
      {
        "chapterId": "old-v070",
        "paragraphId": "old-v070-p7",
        "title": "《旧五代史》 · 卷 70 · 唐列传（元行钦、夏鲁奇等）",
        "excerpt": "郭崇韜起軍之日，以嚴為三川招撫使，嚴與先鋒使康延孝將兵五千，先驅閣道，或馳以詞說，或威以兵鋒，大軍未及，所在降下。"
      }
    ]
  },
  {
    "id": "li-cunxu-kang-sili-service",
    "from": "li-cunxu",
    "to": "kang-sili",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用亲骑军使，后从李存勖屡次征战",
    "sources": [
      {
        "chapterId": "old-v070",
        "paragraphId": "old-v070-p10",
        "title": "《旧五代史》 · 卷 70 · 唐列传（元行钦、夏鲁奇等）",
        "excerpt": "莊宗嗣位，從解圍於上黨，敗梁人於柏鄉，及平薊兵，後戰於河上，皆有功，累承製加檢校戶部尚書，右突騎指揮使。"
      }
    ]
  },
  {
    "id": "li-cunxu-zhang-jingda-service",
    "from": "li-cunxu",
    "to": "zhang-jingda",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖任命的厅直军将，后历仕后唐",
    "sources": [
      {
        "chapterId": "old-v070",
        "paragraphId": "old-v070-p12",
        "title": "《旧五代史》 · 卷 70 · 唐列传（元行钦、夏鲁奇等）",
        "excerpt": "敬達少以騎射著名，莊宗知之，召令繼父職；平河南有功，繼加檢校工部尚書。"
      }
    ]
  },
  {
    "id": "li-cunxu-zhang-qianzhao-service",
    "from": "li-cunxu",
    "to": "zhang-qianzhao",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用、李存勖时期的突骑军将",
    "sources": [
      {
        "chapterId": "old-v074",
        "paragraphId": "old-v074-p9",
        "title": "《旧五代史》 · 卷 74 · 唐列传（康延孝、朱守殷等）",
        "excerpt": "初為太原牙校，以武勇聞於流輩，武皇、莊宗之世，累補左右突騎軍使。"
      }
    ]
  },
  {
    "id": "li-cunxu-xifang-ye-service",
    "from": "li-cunxu",
    "to": "xifang-ye",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖孝义军将领",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p15",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "莊宗以為孝義軍指揮使，累從征伐皆有功。"
      }
    ]
  },
  {
    "id": "li-cunxu-sun-zhang-service",
    "from": "li-cunxu",
    "to": "sun-zhang",
    "kind": "service",
    "label": "军职与征战",
    "note": "魏博归晋后的李存勖军将",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p17",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "莊宗入鄴，累遷澶州都指揮使。"
      }
    ]
  },
  {
    "id": "li-cunxu-gao-xinggui-service",
    "from": "li-cunxu",
    "to": "gao-xinggui",
    "kind": "service",
    "label": "军职与征战",
    "note": "攻燕期间归晋的军将",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p6",
        "title": "《旧五代史》 · 卷 65 · 唐列传（李建及、石君立等）",
        "excerpt": "明宗諭以逆順之理，行珪乃降。"
      },
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p6",
        "title": "《旧五代史》 · 卷 65 · 唐列传（李建及、石君立等）",
        "excerpt": "尋以行珪為朔州刺史，曆忻、嵐二郡，遷雲州留後。"
      }
    ]
  },
  {
    "id": "li-siyuan-gao-xingzhou-service",
    "from": "li-siyuan",
    "to": "gao-xingzhou",
    "kind": "service",
    "label": "直属军职与征战",
    "note": "李嗣源部将，在李存勖晋军中征战，未因晋王索取而改换直属主将",
    "sources": [
      {
        "chapterId": "tongjian-v269",
        "paragraphId": "tongjian-v269-p43",
        "title": "《资治通鉴》 · 卷 269 · 后梁纪4",
        "excerpt": "行周辭曰：「代州養壯士，亦為大王耳，行周事代州，亦猶事大王也。代州脫行周兄弟於死，行周不忍負之。」"
      }
    ]
  },  {
    "id": "li-cunxu-suo-zitong-service",
    "from": "li-cunxu",
    "to": "suo-zitong",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖亲骑与突骑将领",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p13",
        "title": "《旧五代史》 · 卷 65 · 唐列传（李建及、石君立等）",
        "excerpt": "從莊宗定魏博，改突騎指揮使。"
      }
    ]
  },
  {
    "id": "li-cunxu-zhang-wen-service",
    "from": "li-cunxu",
    "to": "zhang-wen",
    "kind": "service",
    "label": "军职与征战",
    "note": "由梁军归入李存勖麾下的军将",
    "sources": [
      {
        "chapterId": "old-v059",
        "paragraphId": "old-v059-p17",
        "title": "《旧五代史》 · 卷 59 · 唐列传",
        "excerpt": "莊宗伐邢台，獲之，用為永清都校，曆武州刺史、山後八軍都將。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-shaowen-service",
    "from": "li-cunxu",
    "to": "li-shaowen",
    "kind": "service",
    "label": "军职与征战",
    "note": "由梁归附李存勖的军将",
    "sources": [
      {
        "chapterId": "old-v059",
        "paragraphId": "old-v059-p18",
        "title": "《旧五代史》 · 卷 59 · 唐列传",
        "excerpt": "莊宗嘉納之，賜姓名，分其兩將三千人為左右匡霸軍旅，仍令紹文、曹儒分將之。"
      }
    ]
  },
  {
    "id": "li-cunxu-an-shentong-service",
    "from": "li-cunxu",
    "to": "an-shentong",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖先锋及北京马军将领",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p3",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "審通，金全之猶子也。幼事莊宗，累有戰功，轉先鋒指揮使。同光初，為北京右廂馬軍都指揮使，屯奉化軍。"
      }
    ]
  },
  {
    "id": "li-cunxu-cao-ru-service",
    "from": "li-cunxu",
    "to": "cao-ru",
    "kind": "service",
    "label": "军职与征战",
    "note": "与李绍文共同归附李存勖的军将",
    "sources": [
      {
        "chapterId": "old-v059",
        "paragraphId": "old-v059-p18",
        "title": "《旧五代史》 · 卷 59 · 唐列传",
        "excerpt": "莊宗嘉納之，賜姓名，分其兩將三千人為左右匡霸軍旅，仍令紹文、曹儒分將之。"
      }
    ]
  },
  {
    "id": "li-cunxu-mao-zhang-service",
    "from": "li-cunxu",
    "to": "mao-zhang",
    "kind": "service",
    "label": "军职与征战",
    "note": "由沧州归附李存勖，参与河上战事及伐蜀",
    "sources": [
      {
        "chapterId": "old-v073",
        "paragraphId": "old-v073-p1",
        "title": "《旧五代史》 · 卷 73 · 唐列传（毛璋、段凝等）",
        "excerpt": "璋性凶悖，有膽略，從征河上，屢有戰功。梁平，授滄州節度使。"
      }
    ]
  },
  {
    "id": "li-cunxu-dong-zhang-service",
    "from": "li-cunxu",
    "to": "dong-zhang",
    "kind": "service",
    "label": "军职与征战",
    "note": "由梁归附李存勖，参与伐蜀并镇东川",
    "sources": [
      {
        "chapterId": "old-v062",
        "paragraphId": "old-v062-p11",
        "title": "《旧五代史》 · 卷 62 · 唐列传（董璋等）",
        "excerpt": "九月，大舉伐蜀，以璋為行營右廂馬步都虞候。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-jiji-service",
    "from": "li-cunxu",
    "to": "li-jiji",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖皇子，伐蜀行营都统",
    "sources": [
      {
        "chapterId": "old-v033",
        "paragraphId": "old-v033-p5",
        "title": "《旧五代史》 · 卷 33 · 唐庄宗纪7",
        "excerpt": "今命興聖宮使、魏王繼岌充西川四面行營都統，命侍中、樞密使郭崇韜充西川東北面行營都招討製置等使，"
      }
    ]
  },
  {
    "id": "li-cunxu-li-ye-service",
    "from": "li-cunxu",
    "to": "li-ye",
    "kind": "service",
    "label": "军职与征战",
    "note": "魏博归晋后的李存勖裨将",
    "sources": [
      {
        "chapterId": "old-v073",
        "paragraphId": "old-v073-p9",
        "title": "《旧五代史》 · 卷 73 · 唐列传（毛璋、段凝等）",
        "excerpt": "及莊宗入魏，漸轉裨將，曆數郡刺史，後遷亳州。"
      }
    ]
  },
  {
    "id": "li-cunxu-dou-tingwan-service",
    "from": "li-cunxu",
    "to": "dou-tingwan",
    "kind": "service",
    "label": "军职与征战",
    "note": "朱温旧部，李存勖时任游奕与边州军职",
    "sources": [
      {
        "chapterId": "old-v074",
        "paragraphId": "old-v074-p8",
        "title": "《旧五代史》 · 卷 74 · 唐列传（康延孝、朱守殷等）",
        "excerpt": "同光初，為復州遊奕使，奸盜屏跡，曆貝州刺史。"
      }
    ]
  },
  {
    "id": "li-cunxu-yang-yanwen-service",
    "from": "li-cunxu",
    "to": "yang-yanwen",
    "kind": "service",
    "label": "军职与征战",
    "note": "梁军旧校，李存勖时期升为裨将",
    "sources": [
      {
        "chapterId": "old-v074",
        "paragraphId": "old-v074-p10",
        "title": "《旧五代史》 · 卷 74 · 唐列传（康延孝、朱守殷等）",
        "excerpt": "楊彥溫，汴州人，本梁朝之小校也。莊宗朝，累遷裨將。"
      }
    ]
  },
  {
    "id": "li-cunxu-zhao-zaili-service",
    "from": "li-cunxu",
    "to": "zhao-zaili",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖效节军将，后被魏兵胁迫起事",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p2",
        "title": "《新五代史》 · 卷 46 · 杂传",
        "excerpt": "莊宗時，為効節指揮使，將魏兵戍瓦橋關。"
      }
    ]
  },
  {
    "id": "li-cunxu-fang-zhiwen-service",
    "from": "li-cunxu",
    "to": "fang-zhiwen",
    "kind": "service",
    "label": "军职与征战",
    "note": "魏博归晋后受李存勖任命的军将",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p16",
        "title": "《新五代史》 · 卷 46 · 杂传",
        "excerpt": "莊宗取魏博，得知溫，賜姓李氏，名曰紹英，以為澶州刺史，歷曹、貝二州刺史，戍瓦橋關。"
      }
    ]
  },
  {
    "id": "li-siyuan-wang-jianli-service",
    "from": "li-siyuan",
    "to": "wang-jianli",
    "kind": "service",
    "label": "直属军职与征战",
    "note": "李嗣源任代州刺史时的虞候将，活动于李存勖时期晋军",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p33",
        "title": "《新五代史》 · 卷 46 · 杂传",
        "excerpt": "唐明宗為代州刺史，以建立為虞候將。莊宗嘗遣女奴之代州祭祭墓，女奴侵擾代人，建立捕而笞之。"
      }
    ]
  },  {
    "id": "li-cunxu-kang-fu-service",
    "from": "li-cunxu",
    "to": "kang-fu",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖军中部属，负责相州军马",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p43",
        "title": "《新五代史》 · 卷 46 · 杂传",
        "excerpt": "莊宗嘗曰：「吾家以羊馬為生，福狀貌類胡人而豐厚，胡宜羊馬。」乃令福牧馬于相州，為小馬坊使，逾年馬大蕃滋。"
      }
    ]
  },
  {
    "id": "li-cunxu-lu-siduo-service",
    "from": "li-cunxu",
    "to": "lu-siduo",
    "kind": "service",
    "label": "军职与征战",
    "note": "由梁归李存勖，任龙武军指挥使",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p54",
        "title": "《新五代史》 · 卷 45 · 杂传",
        "excerpt": "思鐸伏地請死，莊宗慰而起之，拜龍武右廂都指揮使。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-congjing-service",
    "from": "li-cunxu",
    "to": "li-congjing",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖金枪军将，李嗣源之子",
    "sources": [
      {
        "chapterId": "new-v25",
        "paragraphId": "new-v25-p40",
        "title": "《新五代史》 · 卷 25 · 唐臣传（符存审、史建瑭等，附史敬思）",
        "excerpt": "莊宗遣金槍指揮使李從璟馳詔明宗計事。從璟，明宗子也。"
      }
    ]
  },
  {
    "id": "li-jiji-ren-huan-service",
    "from": "li-jiji",
    "to": "ren-huan",
    "kind": "service",
    "label": "伐蜀行营委任",
    "note": "李存勖伐蜀军将，由李继岌委为副招讨使",
    "sources": [
      {
        "chapterId": "old-v074",
        "paragraphId": "old-v074-p4",
        "title": "《旧五代史》 · 卷 74 · 唐列传（康延孝、朱守殷等）",
        "excerpt": "夜半，令監軍使李廷安召任圜，因署為副招討使。令圜率兵七千騎，與都指揮使梁漢顒、監軍李廷安討之。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-congke-service",
    "from": "li-cunxu",
    "to": "li-congke",
    "kind": "service",
    "label": "军职与征战",
    "note": "李存勖时期晋军将领，隶李嗣源；后来即位为后唐末帝",
    "sources": [
      {
        "chapterId": "old-v046",
        "paragraphId": "old-v046-p1",
        "title": "《旧五代史》 · 卷 46 · 唐末帝纪1",
        "excerpt": "帝衛莊宗奪土山，摧驍陣，其軍復振。"
      }
    ]
  },
  {
    "id": "li-siyuan-shi-jingtang-service",
    "from": "li-siyuan",
    "to": "shi-jingtang",
    "kind": "service",
    "label": "麾下军将",
    "note": "李嗣源麾下骑将，参与李存勖部署的河上征战",
    "sources": [
      {
        "chapterId": "old-v075",
        "paragraphId": "old-v075-p6",
        "title": "《旧五代史》 · 卷 75 · 晋高祖纪1",
        "excerpt": "是歲，莊宗即位於鄴，改元同光，遣明宗越河，懸軍深入以取鄆。鄆人始不之覺，帝以五十騎從明宗涉濟，突東門而入。"
      }
    ]
  },  {
    "id": "li-siyuan-liu-zhiyuan-service",
    "from": "li-siyuan",
    "to": "liu-zhiyuan",
    "kind": "service",
    "label": "麾下军将",
    "note": "李嗣源麾下军将，在李存勖时期随军征战",
    "sources": [
      {
        "chapterId": "old-v099",
        "paragraphId": "old-v099-p2",
        "title": "《旧五代史》 · 卷 99 · 汉高祖纪1",
        "excerpt": "初事唐明宗，列於麾下。明宗與梁人對柵於德勝，時晉高祖為梁人所襲，馬甲連革斷，帝輟騎以授之，取斷革者自跨之，徐殿其後，晉高祖感而壯之。"
      }
    ]
  },  {
    "id": "li-cunxu-he-delun-service",
    "from": "li-cunxu",
    "to": "he-delun",
    "kind": "service",
    "label": "军职与征战",
    "note": "魏博军变后归附李存勖，授云州节度但未赴任；后遭张承业杀害",
    "sources": [
      {
        "chapterId": "old-v021",
        "paragraphId": "old-v021-p26",
        "title": "《旧五代史》 · 卷 21 · 梁列传",
        "excerpt": "尋授雲州節度使，行次河東，監軍張承業留之不遣。"
      }
    ]
  },
  {
    "id": "li-cunxu-yuan-xiangxian-service",
    "from": "li-cunxu",
    "to": "yuan-xiangxian",
    "kind": "service",
    "label": "军职与征战",
    "note": "梁亡后受李存勖任命，继续镇宋州等地，赐名李绍安",
    "sources": [
      {
        "chapterId": "old-v059",
        "paragraphId": "old-v059-p15",
        "title": "《旧五代史》 · 卷 59 · 唐列传",
        "excerpt": "即日，復以象先為宋、亳、耀、輝、潁節度使，依前檢校太尉、平章事，仍賜姓，名紹安，尋令歸鎮。"
      }
    ]
  },
  {
    "id": "li-cunxu-zhu-hanbin-service",
    "from": "li-cunxu",
    "to": "zhu-hanbin",
    "kind": "service",
    "label": "军职与征战",
    "note": "梁亡后归李存勖，任左龙武统军",
    "sources": [
      {
        "chapterId": "old-v064",
        "paragraphId": "old-v064-p9",
        "title": "《旧五代史》 · 卷 64 · 唐列传",
        "excerpt": "莊宗至洛陽，漢賓自鎮入覲，復令還鎮。明年，授左龍武統軍。"
      }
    ]
  },
  {
    "id": "li-cunxu-dai-siyuan-service",
    "from": "li-cunxu",
    "to": "dai-siyuan",
    "kind": "service",
    "label": "军职与征战",
    "note": "梁亡后归附李存勖，继续镇宣化；不将梁时战功计作庄宗功劳",
    "sources": [
      {
        "chapterId": "old-v064",
        "paragraphId": "old-v064-p8",
        "title": "《旧五代史》 · 卷 64 · 唐列传",
        "excerpt": "其年，莊宗入汴，思遠自鄧州入朝，復令歸鎮。"
      }
    ]
  },
  {
    "id": "li-cunxu-kong-qing-service",
    "from": "li-cunxu",
    "to": "kong-qing",
    "kind": "service",
    "label": "军职与征战",
    "note": "梁亡后受李存勖任命，由襄州移镇昭义",
    "sources": [
      {
        "chapterId": "old-v064",
        "paragraphId": "old-v064-p12",
        "title": "《旧五代史》 · 卷 64 · 唐列传",
        "excerpt": "莊宗至洛陽，自鎮來朝，復令歸鎮，尋移昭義節度使。"
      }
    ]
  },
  {
    "id": "li-cunxu-duan-ning-service",
    "from": "li-cunxu",
    "to": "duan-ning",
    "kind": "service",
    "label": "军职与征战",
    "note": "梁亡后归李存勖，赐名李绍钦，任泰宁军节度使",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p42",
        "title": "《新五代史》 · 卷 45 · 杂传",
        "excerpt": "莊宗甚親愛之，賜姓名曰李紹欽，以為泰寧軍節度使。"
      }
    ]
  },
  {
    "id": "li-cunxu-liu-qi-service",
    "from": "li-cunxu",
    "to": "liu-qi",
    "kind": "service",
    "label": "军职与征战",
    "note": "梁亡后受李存勖任命，正授晋州节度、后移安州",
    "sources": [
      {
        "chapterId": "old-v064",
        "paragraphId": "old-v064-p13",
        "title": "《旧五代史》 · 卷 64 · 唐列传",
        "excerpt": "復命歸鎮，正授節旄，移鎮安州。"
      }
    ]
  },
  {
    "id": "li-cunxu-zhou-zhiyu-service",
    "from": "li-cunxu",
    "to": "zhou-zhiyu",
    "kind": "service",
    "label": "军职与征战",
    "note": "梁亡后归李存勖，任伐蜀前锋骑将",
    "sources": [
      {
        "chapterId": "old-v064",
        "paragraphId": "old-v064-p15",
        "title": "《旧五代史》 · 卷 64 · 唐列传",
        "excerpt": "魏王繼岌伐蜀，召為前鋒騎將。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-siyuan-service",
    "from": "li-cunxu",
    "to": "li-siyuan",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用养子及军将，后任李存勖蕃汉副总管、总管",
    "sources": [
      {
        "chapterId": "old-v035",
        "paragraphId": "old-v035-p11",
        "title": "《旧五代史》 · 卷 35 · 唐明宗纪1",
        "excerpt": "十八年十月，從莊宗大破梁將戴思遠於戚城，斬首二萬級。莊宗以帝為蕃漢副總管，加同平章事。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-sizhao-service",
    "from": "li-cunxu",
    "to": "li-sizhao",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用时期主将，后从李存勖征战，代阎宝攻镇州",
    "sources": [
      {
        "chapterId": "old-v052",
        "paragraphId": "old-v052-p11",
        "title": "《旧五代史》 · 卷 52 · 唐列传（李嗣昭、李嗣本、李嗣恩等）",
        "excerpt": "是時，閻寶為鎮人所敗，退保趙州，莊宗命嗣昭代寶攻真定。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-cunjin-service",
    "from": "li-cunxu",
    "to": "li-cunjin",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用养子与军将，后任李存勖行营马步都虞候",
    "sources": [
      {
        "chapterId": "new-v36",
        "paragraphId": "new-v36-p26",
        "title": "《新五代史》 · 卷 36 · 义儿传（李嗣昭等，附康君立）",
        "excerpt": "從莊宗戰柏鄉，遷行營馬步軍都虞候，歷慈、沁二州刺史。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-siben-service",
    "from": "li-cunxu",
    "to": "li-siben",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用养子与军将，后随李存勖攻魏博、刘鄩",
    "sources": [
      {
        "chapterId": "old-v052",
        "paragraphId": "old-v052-p21",
        "title": "《旧五代史》 · 卷 52 · 唐列传（李嗣昭、李嗣本、李嗣恩等）",
        "excerpt": "十二年，莊宗定魏博，劉鄩據莘縣，命嗣本入太原巡守都城，十三年，從破劉鄩於故元城，收洺、磁、衛三郡。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-sien-service",
    "from": "li-cunxu",
    "to": "li-sien",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用养子与军将，后任李存勖天雄军都指挥使",
    "sources": [
      {
        "chapterId": "new-v36",
        "paragraphId": "new-v36-p15",
        "title": "《新五代史》 · 卷 36 · 义儿传（李嗣昭等，附康君立）",
        "excerpt": "從莊宗入魏，遷天雄軍馬步都指揮使。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-cunzhang-service",
    "from": "li-cunxu",
    "to": "li-cunzhang",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用时期军将，后任李存勖河东马步军使",
    "sources": [
      {
        "chapterId": "new-v36",
        "paragraphId": "new-v36-p30",
        "title": "《新五代史》 · 卷 36 · 义儿传（李嗣昭等，附康君立）",
        "excerpt": "立莊宗為晉王，晉王以存璋為河東馬步軍使。"
      }
    ]
  },
  {
    "id": "li-cunxu-fu-cunshen-service",
    "from": "li-cunxu",
    "to": "fu-cunshen",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用赐姓名的军将，后为李存勖统领前锋、任节度使",
    "sources": [
      {
        "chapterId": "old-v056",
        "paragraphId": "old-v056-p16",
        "title": "《旧五代史》 · 卷 56 · 唐列传（周德威、李存审）",
        "excerpt": "十二年，魏博歸款於莊宗，遣存審率前鋒據臨清，以俟進取。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-cunxian-service",
    "from": "li-cunxu",
    "to": "li-cunxian",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用养子与军将，后奉李存勖命救援河中",
    "sources": [
      {
        "chapterId": "new-v36",
        "paragraphId": "new-v36-p33",
        "title": "《新五代史》 · 卷 36 · 义儿传（李嗣昭等，附康君立）",
        "excerpt": "天祐十八年，梁兵攻朱友謙于河中，莊宗遣存賢援友謙。"
      }
    ]
  },
  {
    "id": "li-cunxu-ding-hui-service",
    "from": "li-cunxu",
    "to": "ding-hui",
    "kind": "service",
    "label": "军职与征战",
    "note": "由梁归李克用，后任李存勖都招讨使",
    "sources": [
      {
        "chapterId": "new-v44",
        "paragraphId": "new-v44-p15",
        "title": "《新五代史》 · 卷 44 · 杂传",
        "excerpt": "莊宗立，以會為都招討使。"
      }
    ]
  },
  {
    "id": "li-cunxu-zhou-dewei-service",
    "from": "li-cunxu",
    "to": "zhou-dewei",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用骑将，后从李存勖救潞州并统军征战",
    "sources": [
      {
        "chapterId": "old-v056",
        "paragraphId": "old-v056-p5",
        "title": "《旧五代史》 · 卷 56 · 唐列传（周德威、李存审）",
        "excerpt": "是月二十四日，從莊宗再援潞州。"
      }
    ]
  },
  {
    "id": "li-cunxu-shi-jiantang-service",
    "from": "li-cunxu",
    "to": "shi-jiantang",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用时期军将，后为李存勖晋军先锋、参与柏乡及镇州之战",
    "sources": [
      {
        "chapterId": "new-v25",
        "paragraphId": "new-v25-p27",
        "title": "《新五代史》 · 卷 25 · 唐臣传（符存审、史建瑭等，附史敬思）",
        "excerpt": "十八年，晉軍討張文禮於鎮州，建瑭以先鋒兵下趙州，執其刺史王鋋。"
      }
    ]
  },
  {
    "id": "li-cunxu-an-jinquan-service",
    "from": "li-cunxu",
    "to": "an-jinquan",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用骑将，后随李存勖作战及救守太原",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p1",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "莊宗之救潞州及平河朔，皆有戰功，累為刺史，以老病退居太原。"
      }
    ]
  },
  {
    "id": "li-cunxu-an-yuanxin-service",
    "from": "li-cunxu",
    "to": "an-yuanxin",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用军将，后任李存勖内衙副都指挥使等",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p4",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "其年，改檢校司徒、武州刺史，充內衙副都指揮使、山北諸州都團練副使。從莊宗定魏博，移為博州刺史。"
      }
    ]
  },
  {
    "id": "li-cunxu-liu-xun-yonghe-service",
    "from": "li-cunxu",
    "to": "liu-xun-yonghe",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用马军旧将，后归李存勖并任襄州节度使",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p10",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "居無何，殺陝州刺史，以郡歸莊宗，曆瀛州刺史。同光初，拜左監衛大將軍。三年，授襄州節度使。"
      }
    ]
  },
  {
    "id": "li-cunxu-liu-yancong-service",
    "from": "li-cunxu",
    "to": "liu-yancong",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用军将，后随李存勖救潞州、任铁林指挥使",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p12",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "從莊宗解上黨之圍。同光初，稍遷至鐵林指揮使、磁州刺史。"
      }
    ]
  },
  {
    "id": "li-cunxu-yuan-jianfeng-service",
    "from": "li-cunxu",
    "to": "yuan-jianfeng",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用所收养的軍将，后为李存勖左厢马军指挥使",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p13",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "從莊宗解圍上黨，破柏鄉陣，累功遷右僕射、左廂馬軍指揮使。"
      }
    ]
  },
  {
    "id": "li-cunxu-zhang-jingxun-service",
    "from": "li-cunxu",
    "to": "zhang-jingxun",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用甲坊职官，后随李存勖从军并任利州留后",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p11",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "莊宗經略山東，敬詢從軍，曆博、澤、慈、隰四州刺史。"
      }
    ]
  },
  {
    "id": "li-cunxu-zhang-zunhui-service",
    "from": "li-cunxu",
    "to": "zhang-zunhui",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用牙门将，后随李存勖征战并任马步都虞候",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p16",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "莊宗定山東，遵誨以典客從，曆幽、鎮二府馬步都虞候。"
      }
    ]
  },
  {
    "id": "li-cunxu-wang-jianji-service",
    "from": "li-cunxu",
    "to": "wang-jianji",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用义儿军将，后统李存勖银枪效节亲军",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p3",
        "title": "《旧五代史》 · 卷 65 · 唐列传（李建及、石君立等）",
        "excerpt": "自莊宗至魏州，建及都總內外衙銀槍效節帳前親軍，"
      }
    ]
  },
  {
    "id": "li-cunxu-zhang-tingyu-service",
    "from": "li-cunxu",
    "to": "zhang-tingyu",
    "kind": "service",
    "label": "军职与征战",
    "note": "李克用军将，后任李存勖天雄军左厢马步都虞候",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p7",
        "title": "《旧五代史》 · 卷 65 · 唐列传（李建及、石君立等）",
        "excerpt": "莊宗定魏，補天雄軍左廂馬步都虞候，曆蔚、慈、隰三州刺史。"
      }
    ]
  },
  {
    "id": "li-cunxu-wang-sitong-service",
    "from": "li-cunxu",
    "to": "wang-sitong",
    "kind": "service",
    "label": "军职与征战",
    "note": "由幽州归李克用，后随李存勖平定山东并掌诸军",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p8",
        "title": "《旧五代史》 · 卷 65 · 唐列传（李建及、石君立等）",
        "excerpt": "從莊宗平定山東，累典諸軍。"
      }
    ]
  },
  {
    "id": "li-keyong-guo-chongtao-service",
    "from": "li-keyong",
    "to": "guo-chongtao",
    "kind": "service",
    "label": "典谒与教练使",
    "note": "李克用时期任职与后来李存勖时期掌机务分别保存。",
    "sources": [
      {
        "chapterId": "old-v057",
        "paragraphId": "old-v057-p2",
        "title": "《旧五代史》 · 卷 57 · 唐列传（郭崇韬）",
        "excerpt": "克修卒，武皇用為典謁，奉使鳳翔稱旨，署教練使。"
      }
    ]
  },
  {
    "id": "li-keyong-kang-sili-service",
    "from": "li-keyong",
    "to": "kang-sili",
    "kind": "service",
    "label": "河东军职",
    "note": "康思立先事李克用，后随李存勖征战。",
    "sources": [
      {
        "chapterId": "old-v070",
        "paragraphId": "old-v070-p10",
        "title": "《旧五代史》 · 卷 70 · 唐列传（元行钦、夏鲁奇等）",
        "excerpt": "少善騎射，事武皇為爪牙，署河東親騎軍使。"
      }
    ]
  },
  {
    "id": "li-keyong-zhang-qianzhao-service",
    "from": "li-keyong",
    "to": "zhang-qianzhao",
    "kind": "service",
    "label": "突骑军使",
    "note": "原书明确记武皇与庄宗两世的军职。",
    "sources": [
      {
        "chapterId": "old-v074",
        "paragraphId": "old-v074-p9",
        "title": "《旧五代史》 · 卷 74 · 唐列传（康延孝、朱守殷等）",
        "excerpt": "初為太原牙校，以武勇聞於流輩，武皇、莊宗之世，累補左右突騎軍使。"
      }
    ]
  },
  {
    "id": "li-siyuan-yuan-xingqin-adoption",
    "from": "li-siyuan",
    "to": "yuan-xingqin",
    "kind": "adoption",
    "label": "养父子",
    "note": "李嗣源收养元行钦；李存勖后来调取他任亲军职，赐姓名与收养不同。",
    "sources": [
      {
        "chapterId": "new-v25",
        "paragraphId": "new-v25-p36",
        "title": "《新五代史》 · 卷 25 · 唐臣传（符存审、史建瑭等，附史敬思）",
        "excerpt": "明宗撫其背而飲以酒曰：「壯士也！」因養以為子。"
      }
    ]
  },
  {
    "id": "li-cunxu-li-jiji-kinship",
    "from": "li-cunxu",
    "to": "li-jiji",
    "kind": "kinship",
    "label": "父子",
    "note": "李继岌为庄宗长子、魏王，没有即位。",
    "sources": [
      {
        "chapterId": "huiyao-v002",
        "paragraphId": "huiyao-v002-p4",
        "title": "《五代会要》 · 卷 2",
        "excerpt": "莊宗長子繼岌，魏王；"
      }
    ]
  },
  {
    "id": "li-siyuan-li-congjing-kinship",
    "from": "li-siyuan",
    "to": "li-congjing",
    "kind": "kinship",
    "label": "父子",
    "note": "原书李从璟为明宗之子，与元行钦养子身份区别。",
    "sources": [
      {
        "chapterId": "new-v25",
        "paragraphId": "new-v25-p40",
        "title": "《新五代史》 · 卷 25 · 唐臣传（符存审、史建瑭等，附史敬思）",
        "excerpt": "從璟，明宗子也。"
      }
    ]
  },
  {
    "id": "yuan-xingqin-li-congjing-conflict",
    "from": "yuan-xingqin",
    "to": "li-congjing",
    "kind": "conflict",
    "label": "击杀传诏者",
    "note": "原书记元行钦反对再遣李从璟通问，并将其杀害。",
    "sources": [
      {
        "chapterId": "new-v25",
        "paragraphId": "new-v25-p40",
        "title": "《新五代史》 · 卷 25 · 唐臣传（符存审、史建瑭等，附史敬思）",
        "excerpt": "莊宗復遣從璟通問于明宗，行欽以為不可，因擊殺從璟。"
      }
    ]
  },
  {
    "id": "guo-congqian-li-cunxu-conflict",
    "from": "guo-congqian",
    "to": "li-cunxu",
    "kind": "conflict",
    "label": "兴教门兵变",
    "note": "郭从谦率军攻击兴教门；庄宗中流矢，不能断言箭为郭本人射出。",
    "sources": [
      {
        "chapterId": "old-v034",
        "paragraphId": "old-v034-p13",
        "title": "《旧五代史》 · 卷 34 · 唐庄宗纪8",
        "excerpt": "從馬直指揮使郭從謙自本營率所部抽戈露刃，至興教門大呼，與黃甲兩軍引弓射興教門。"
      }
    ]
  },
  {
    "id": "gao-xinggui-gao-xingzhou-kinship",
    "from": "gao-xinggui",
    "to": "gao-xingzhou",
    "kind": "kinship",
    "label": "兄弟",
    "note": "此关系按当前《旧五代史》卷65所记兄弟保存。",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p6",
        "title": "《旧五代史》 · 卷 65 · 唐列传（李建及、石君立等）",
        "excerpt": "高行珪，燕人也。家世勇悍，與弟行周俱有武藝"
      }
    ]
  },
  {
    "id": "li-jiji-guo-chongtao-service",
    "from": "li-jiji",
    "to": "guo-chongtao",
    "kind": "service",
    "label": "伐蜀都统与招讨使",
    "note": "庄宗同时任命李继岌为都统、郭崇韬为招讨使；魏王行营由郭参与谋划执行。",
    "sources": [
      {
        "chapterId": "old-v057",
        "paragraphId": "old-v057-p10",
        "title": "《旧五代史》 · 卷 57 · 唐列传（郭崇韬）",
        "excerpt": "乃以繼岌為都統，崇韜為招討使。"
      }
    ]
  },
  {
    "id": "zhu-wen-dong-zhang-service",
    "from": "zhu-wen",
    "to": "dong-zhang",
    "kind": "service",
    "label": "梁军旧将",
    "note": "董璋早在朱温帐下任职，梁亡后转仕庄宗。",
    "sources": [
      {
        "chapterId": "old-v062",
        "paragraphId": "old-v062-p11",
        "title": "《旧五代史》 · 卷 62 · 唐列传（董璋等）",
        "excerpt": "璋既壯，得隸於梁祖帳下，後以軍功遷為列校。"
      }
    ]
  },
  {
    "id": "zhu-wen-zhang-wen-service",
    "from": "zhu-wen",
    "to": "zhang-wen",
    "kind": "service",
    "label": "步直小将",
    "note": "张温先仕朱温，晋军获后转任。",
    "sources": [
      {
        "chapterId": "old-v059",
        "paragraphId": "old-v059-p17",
        "title": "《旧五代史》 · 卷 59 · 唐列传",
        "excerpt": "始仕梁祖為步直小將"
      }
    ]
  },
  {
    "id": "zhu-wen-li-shaowen-service",
    "from": "zhu-wen",
    "to": "li-shaowen",
    "kind": "service",
    "label": "四镇牙校",
    "note": "张从楚先归朱温任牙校，后由庄宗赐名李绍文。",
    "sources": [
      {
        "chapterId": "old-v059",
        "paragraphId": "old-v059-p18",
        "title": "《旧五代史》 · 卷 59 · 唐列传",
        "excerpt": "歸於梁祖，為四鎮牙校"
      }
    ]
  },
  {
    "id": "yang-shihou-sun-zhang-service",
    "from": "yang-shihou",
    "to": "sun-zhang",
    "kind": "service",
    "label": "麾下军将",
    "note": "孙璋先属杨师厚，后归晋任职。",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p17",
        "title": "《旧五代史》 · 卷 61 · 唐列传（安金全、袁建丰等）",
        "excerpt": "隸梁將楊師厚麾下，稍補奉化軍使。"
      }
    ]
  },
  {
    "id": "li-hanzhi-wang-jianji-adoption",
    "from": "li-hanzhi",
    "to": "wang-jianji",
    "kind": "adoption",
    "label": "养子",
    "note": "《资治通鉴》记王建及为李罕之假子；赐李姓、典义儿军不能据此改称李克用养子。",
    "sources": [
      {
        "chapterId": "tongjian-v267",
        "paragraphId": "tongjian-v267-p128",
        "title": "《资治通鉴》卷267",
        "excerpt": "建及，許州人，姓王，李罕之之假子也。"
      }
    ]
  },
  // Li Keyong military service and separately evidenced family / transfer facts.
  {
    "id": "li-keyong-li-siyuan-service",
    "from": "li-keyong",
    "to": "li-siyuan",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用养子，统领亲骑与横冲都",
    "sources": [
      {
        "chapterId": "old-v035",
        "paragraphId": "old-v035-p2",
        "title": "《旧五代史》卷 35 · 唐明宗纪1",
        "excerpt": "武皇鎮河東，以帝掌親騎。時李存信為蕃漢大將，每總兵征討，師多不利，武皇遂選帝副之，所向克捷。"
      }
    ]
  },
  {
    "id": "li-keyong-li-cunxin-service",
    "from": "li-keyong",
    "to": "li-cunxin",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用养子，河东蕃汉都将",
    "sources": [
      {
        "chapterId": "old-v053",
        "paragraphId": "old-v053-p2",
        "title": "《旧五代史》卷 53 · 唐列传（李存信、李存孝等）",
        "excerpt": "大順二年，武皇大舉略地山東，以存信為蕃漢馬步都校，"
      }
    ]
  },
  {
    "id": "li-keyong-li-cunjin-service",
    "from": "li-keyong",
    "to": "li-cunjin",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用养子，义儿军将领",
    "sources": [
      {
        "chapterId": "old-v053",
        "paragraphId": "old-v053-p10",
        "title": "《旧五代史》卷 53 · 唐列传（李存信、李存孝等）",
        "excerpt": "重進初仕嵐州刺史湯群為部校，獻祖誅群，乃事武皇。從入關，還鎮太原，署牙職。景福中，為義兒軍使，賜姓名。"
      }
    ]
  },
  {
    "id": "li-keyong-li-siben-service",
    "from": "li-keyong",
    "to": "li-siben",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用养子，义儿军、威远军将领",
    "sources": [
      {
        "chapterId": "old-v052",
        "paragraphId": "old-v052-p21",
        "title": "《旧五代史》卷 52 · 唐列传（李嗣昭、李嗣本、李嗣恩等）",
        "excerpt": "嗣本少事武皇，為帳中紀綱，漸立戰功，得補軍校。"
      }
    ]
  },
  {
    "id": "li-keyong-li-sien-service",
    "from": "li-keyong",
    "to": "li-sien",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用养子，铁林军、突阵军将领",
    "sources": [
      {
        "chapterId": "old-v052",
        "paragraphId": "old-v052-p23",
        "title": "《旧五代史》卷 52 · 唐列传（李嗣昭、李嗣本、李嗣恩等）",
        "excerpt": "年十五，能騎射，侍武皇於振武；及鎮太原，補鐵林軍小校。"
      }
    ]
  },
  {
    "id": "li-keyong-li-cunzhang-service",
    "from": "li-keyong",
    "to": "li-cunzhang",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用部将，统领义儿军",
    "sources": [
      {
        "chapterId": "old-v053",
        "paragraphId": "old-v053-p16",
        "title": "《旧五代史》卷 53 · 唐列传（李存信、李存孝等）",
        "excerpt": "武皇初起雲中，存璋與康君立、薛志勤等為奔走交，從入關，以功授國子祭酒，累管萬勝、雄威等軍。"
      }
    ]
  },
  {
    "id": "li-keyong-li-cunxian-service",
    "from": "li-keyong",
    "to": "li-cunxian",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用养子，义儿军将领",
    "sources": [
      {
        "chapterId": "old-v053",
        "paragraphId": "old-v053-p19",
        "title": "《旧五代史》卷 53 · 唐列传（李存信、李存孝等）",
        "excerpt": "武皇破賊陳、許，存賢來歸。景福中，典義兒軍，為副兵馬使，因賜姓名。"
      }
    ]
  },
  {
    "id": "li-keyong-li-cunxiao-service",
    "from": "li-keyong",
    "to": "li-cunxiao",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用养子，前锋骑将",
    "sources": [
      {
        "chapterId": "new-v36",
        "paragraphId": "new-v36-p19",
        "title": "《新五代史》卷 36 · 义儿传（李嗣昭等，附康君立）",
        "excerpt": "太祖掠地代北得之，給事帳中，賜姓名，以為子，常從為騎將。"
      }
    ]
  },
  {
    "id": "li-keyong-yang-shihou-service",
    "from": "li-keyong",
    "to": "yang-shihou",
    "kind": "service",
    "label": "部将与军职",
    "note": "早年随李罕之入李克用军，后转仕朱温；未以梁时战功回填晋时经历",
    "sources": [
      {
        "chapterId": "new-v23",
        "paragraphId": "new-v23-p2",
        "title": "《新五代史》卷 23 · 梁臣传",
        "excerpt": "少事河陽李罕之，罕之降晉，選其麾下勁卒百人獻于晉王，師厚在籍中。"
      }
    ]
  },
  {
    "id": "li-keyong-zhou-dewei-service",
    "from": "li-keyong",
    "to": "zhou-dewei",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用骑将，后辅佐李存勖",
    "sources": [
      {
        "chapterId": "old-v056",
        "paragraphId": "old-v056-p2",
        "title": "旧五代史·周德威相关记载",
        "excerpt": "初事武皇為帳中騎督，驍勇，便騎射，膽氣智數皆過人。"
      }
    ]
  },
  {
    "id": "li-keyong-xue-zhiqin-service",
    "from": "li-keyong",
    "to": "xue-zhiqin",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用亲将，参与早年起兵",
    "sources": [
      {
        "chapterId": "old-v055",
        "paragraphId": "old-v055-p4",
        "title": "旧五代史·薛志勤相关记载",
        "excerpt": "武皇授節雁門，誌勤領代北軍使；從入關，收京城，以功授檢校工部尚書、河東右都押牙、先鋒右軍使。"
      }
    ]
  },
  {
    "id": "li-keyong-shi-jiantang-service",
    "from": "li-keyong",
    "to": "shi-jiantang",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用部将，后辅佐李存勖",
    "sources": [
      {
        "chapterId": "new-v25",
        "paragraphId": "new-v25-p25",
        "title": "新五代史·史建瑭相关记载",
        "excerpt": "建瑭少事軍中為裨校，自晉降丁會，與梁相距於潞州，建瑭已為晉兵先鋒。"
      }
    ]
  },
  {
    "id": "li-keyong-li-chengsi-service",
    "from": "li-keyong",
    "to": "li-chengsi",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用骑将，后留仕淮南",
    "sources": [
      {
        "chapterId": "old-v055",
        "paragraphId": "old-v055-p9",
        "title": "旧五代史·李承嗣相关记载",
        "excerpt": "中和二年，從武皇討賊關輔，為前鋒。"
      }
    ]
  },
  {
    "id": "li-keyong-shi-yan-service",
    "from": "li-keyong",
    "to": "shi-yan",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用亲将，后留仕淮南",
    "sources": [
      {
        "chapterId": "old-v055",
        "paragraphId": "old-v055-p12",
        "title": "旧五代史·史俨相关记载",
        "excerpt": "以便騎射給事於武皇。為帳中親將，驍果絕眾，善擒生設伏，望塵揣敵，所向皆捷。"
      }
    ]
  },
  {
    "id": "li-keyong-gai-yu-service",
    "from": "li-keyong",
    "to": "gai-yu",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用亲信军将，兼参军府谋议",
    "sources": [
      {
        "chapterId": "old-v055",
        "paragraphId": "old-v055-p13",
        "title": "旧五代史·盖寓相关记载",
        "excerpt": "武皇節制雁門，署職為都押牙，領嵐州刺史。洎移鎮太原，改左都押牙、檢校左僕射。武皇與之決事，言無不從，凡出征伐，靡不衛從。"
      }
    ]
  },
  {
    "id": "li-keyong-yi-guang-service",
    "from": "li-keyong",
    "to": "yi-guang",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用牙将，兼任使节",
    "sources": [
      {
        "chapterId": "old-v055",
        "paragraphId": "old-v055-p15",
        "title": "旧五代史·伊广相关记载",
        "excerpt": "乾寧四年，從征劉仁恭，武皇之師不利於成安寨，廣歿於賊。"
      },
      {
        "chapterId": "old-v055",
        "paragraphId": "old-v055-p17",
        "title": "旧五代史·伊广相关记载",
        "excerpt": "李承勳者，與廣同為牙將，善於奉使，名聞軍中。"
      }
    ]
  },
  {
    "id": "li-keyong-an-jinquan-service",
    "from": "li-keyong",
    "to": "an-jinquan",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用骑将，后历事庄宗、明宗",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p1",
        "title": "旧五代史·安金全相关记载",
        "excerpt": "武皇時為騎將，屢從征討。"
      }
    ]
  },
  {
    "id": "li-keyong-an-yuanxin-service",
    "from": "li-keyong",
    "to": "an-yuanxin",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用部将，曾投定州后归河东",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p4",
        "title": "旧五代史·安元信相关记载",
        "excerpt": "元信以將族子，便騎射，幼事武皇，從平巢、蔡。"
      }
    ]
  },
  {
    "id": "li-keyong-an-zhongba-service",
    "from": "li-keyong",
    "to": "an-zhongba",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用旧部，后转仕梁、蜀、后唐",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p6",
        "title": "旧五代史·安重霸相关记载",
        "excerpt": "初，自代北與明宗俱事武皇，因負罪奔梁；在梁復以罪奔蜀，蜀以蕃人善騎射，因為親將。"
      }
    ]
  },
  {
    "id": "li-keyong-liu-xun-yonghe-service",
    "from": "li-keyong",
    "to": "liu-xun-yonghe",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用骑将，后历仕后唐",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p10",
        "title": "旧五代史·刘训相关记载",
        "excerpt": "初事武皇為馬軍隊長，漸至散將。"
      }
    ]
  },
  {
    "id": "li-keyong-liu-yancong-service",
    "from": "li-keyong",
    "to": "liu-yancong",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用部将，后历仕后唐",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p12",
        "title": "旧五代史·刘彦琮相关记载",
        "excerpt": "劉彥琮，字比德，雲中人也。事武皇，累從征役。"
      }
    ]
  },
  {
    "id": "li-keyong-yuan-jianfeng-service",
    "from": "li-keyong",
    "to": "yuan-jianfeng",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用收养的军将，后辅佐庄宗、明宗",
    "sources": [
      {
        "chapterId": "new-v25",
        "paragraphId": "new-v25-p49",
        "title": "新五代史·袁建丰相关记载",
        "excerpt": "長習騎射，為鐵林都虞候，從擊王行瑜、李匡威，以功遷突陣指揮使。"
      }
    ]
  },
  {
    "id": "li-keyong-zhang-jingxun-service",
    "from": "li-keyong",
    "to": "zhang-jingxun",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用军械职官，后历任军州",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p11",
        "title": "旧五代史·张敬询相关记载",
        "excerpt": "敬詢當武皇時，專掌甲坊十五年，以稱職聞。"
      }
    ]
  },
  {
    "id": "li-keyong-zhang-zunhui-service",
    "from": "li-keyong",
    "to": "zhang-zunhui",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用牙门将，后历仕后唐",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p16",
        "title": "旧五代史·张遵诲相关记载",
        "excerpt": "遵誨奔太原，武皇以為牙門將。"
      }
    ]
  },
  {
    "id": "li-keyong-wang-jianji-service",
    "from": "li-keyong",
    "to": "wang-jianji",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用义儿军将领，后辅佐李存勖",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p1",
        "title": "旧五代史·王建及相关记载",
        "excerpt": "光啟中，罕之謁武皇於晉陽，因選部下驍勇者百人以獻，建及在籍中。後以功署牙職，典義兒軍，及賜姓名。"
      }
    ]
  },
  {
    "id": "li-keyong-shi-junli-service",
    "from": "li-keyong",
    "to": "shi-junli",
    "kind": "service",
    "label": "部将与军职",
    "note": "河东军将；先属李克柔，后属李嗣昭",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p5",
        "title": "旧五代史·石君立相关记载",
        "excerpt": "初事代州刺史李克柔，後隸李嗣昭為牙校，曆典諸軍。夾城之役，君立每出挑戰，壞汴軍柵壘，俘擒而還。"
      }
    ]
  },
  {
    "id": "li-keyong-zhang-tingyu-service",
    "from": "li-keyong",
    "to": "zhang-tingyu",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用部将，后历仕后唐",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p7",
        "title": "旧五代史·张廷裕相关记载",
        "excerpt": "幼事武皇於雲中，從平黃巢，討王行瑜，自行間漸升為小將。"
      }
    ]
  },
  {
    "id": "li-keyong-wang-sitong-service",
    "from": "li-keyong",
    "to": "wang-sitong",
    "kind": "service",
    "label": "部将与军职",
    "note": "由幽州率部归附李克用",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p8",
        "title": "旧五代史·王思同相关记载",
        "excerpt": "思同以部下兵歸太原，時年十六，武皇命為飛騰指揮使。"
      }
    ]
  },
  {
    "id": "li-keyong-li-hanzhi-service",
    "from": "li-keyong",
    "to": "li-hanzhi",
    "kind": "service",
    "label": "部将与军职",
    "note": "归附李克用的藩将，后转附朱温",
    "sources": [
      {
        "chapterId": "old-v015",
        "paragraphId": "old-v015-p10",
        "title": "旧五代史·李罕之相关记载",
        "excerpt": "乾寧二年，李克用出師以拒邠、鳳，營於渭北，天子以克用為邠州行營四面都統，克用乃表罕之為副。"
      }
    ]
  },
  {
    "id": "li-keyong-an-jinjun-service",
    "from": "li-keyong",
    "to": "an-jinjun",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用部将，受命率骑援河阳",
    "sources": [
      {
        "chapterId": "old-v015",
        "paragraphId": "old-v015-p9",
        "title": "旧五代史·安金俊相关记载",
        "excerpt": "李克用遣澤州刺史安金俊率騎助之，遂收河陽。"
      }
    ]
  },
  {
    "id": "li-keyong-li-junqing-service",
    "from": "li-keyong",
    "to": "li-junqing",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用军将，受命攻潞州",
    "sources": [
      {
        "chapterId": "new-v36",
        "paragraphId": "new-v36-p5",
        "title": "新五代史·李君庆相关记载",
        "excerpt": "二年，晉遣李君慶攻梁潞州，君慶為梁所敗，太祖酖殺君慶，嗣昭攻克之。"
      }
    ]
  },
  {
    "id": "li-keyong-xue-atan-service",
    "from": "li-keyong",
    "to": "xue-atan",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用部将，参战河阳、阴地关",
    "sources": [
      {
        "chapterId": "new-v36",
        "paragraphId": "new-v36-p21",
        "title": "新五代史·薛阿檀相关记载",
        "excerpt": "晉以李存信、薛阿檀等當濬，別遣存孝軍于趙城。"
      }
    ]
  },
  {
    "id": "li-keyong-an-xiuxiu-service",
    "from": "li-keyong",
    "to": "an-xiuxiu",
    "kind": "service",
    "label": "部将与军职",
    "note": "李克用骑将；河阳战役后事在旧史两传与新史中有分歧",
    "sources": [
      {
        "chapterId": "old-v055",
        "paragraphId": "old-v055-p2",
        "title": "旧五代史·安休休相关记载",
        "excerpt": "臨陣之次，騎將安休休叛入汴軍，君立引退。"
      },
      {
        "chapterId": "new-v36",
        "paragraphId": "new-v36-p20",
        "title": "新五代史·安休休相关记载",
        "excerpt": "遣存孝與薛阿檀、安休休等以兵七千助罕之還擊河陽。"
      }
    ]
  },
  {
    "id": "shi-jingsi-shi-jiantang-kinship",
    "from": "shi-jingsi",
    "to": "shi-jiantang",
    "kind": "kinship",
    "label": "父子",
    "sources": [
      {
        "chapterId": "old-v055",
        "paragraphId": "old-v055-p5",
        "excerpt": "史建瑭，字國寶。父敬思，雁門人，仕郡至牙校。",
        "title": "《旧五代史》相关记载"
      }
    ]
  },
  {
    "id": "li-keyong-yuan-jianfeng-adoption",
    "from": "li-keyong",
    "to": "yuan-jianfeng",
    "kind": "adoption",
    "label": "收养",
    "sources": [
      {
        "chapterId": "new-v25",
        "paragraphId": "new-v25-p49",
        "title": "《新五代史》袁建丰传",
        "excerpt": "袁建豐，不知其世家也。晉王討黃巢至華陰，闌得之，時方九歲，愛其俊爽，收養之。"
      },
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p13",
        "excerpt": "袁建豐，武皇破巢時得於華陰，年方九歲，愛其精神爽俊，俾收養之。",
        "title": "《旧五代史》相关记载"
      }
    ],
    "note": "新史记李克用收养袁建丰，旧史记李克用命人收养；不将旧史使令表述改写为亲自收养。"
  },
  {
    "id": "li-kerou-shi-junli-service",
    "from": "li-kerou",
    "to": "shi-junli",
    "kind": "service",
    "label": "早年部属",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p5",
        "excerpt": "初事代州刺史李克柔，後隸李嗣昭為牙校，曆典諸軍。",
        "title": "《旧五代史》相关记载"
      }
    ]
  },
  {
    "id": "li-sizhao-shi-junli-service",
    "from": "li-sizhao",
    "to": "shi-junli",
    "kind": "service",
    "label": "牙校与前锋",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p5",
        "excerpt": "嗣昭每出征，俾君立為前鋒，敵人畏之。",
        "title": "《旧五代史》相关记载"
      }
    ]
  },
  {
    "id": "li-hanzhi-wang-jianji-service",
    "from": "li-hanzhi",
    "to": "wang-jianji",
    "kind": "service",
    "label": "早年部属",
    "sources": [
      {
        "chapterId": "old-v065",
        "paragraphId": "old-v065-p1",
        "excerpt": "建及少事李罕之為紀綱，",
        "title": "《旧五代史》相关记载"
      }
    ]
  },
  {
    "id": "li-hanzhi-yang-shihou-service",
    "from": "li-hanzhi",
    "to": "yang-shihou",
    "kind": "service",
    "label": "早年部属",
    "sources": [
      {
        "chapterId": "new-v23",
        "paragraphId": "new-v23-p2",
        "excerpt": "少事河陽李罕之，罕之降晉，選其麾下勁卒百人獻于晉王，師厚在籍中。",
        "title": "《新五代史》相关记载"
      }
    ]
  },
  {
    "id": "li-hanzhi-fu-cunshen-service",
    "from": "li-hanzhi",
    "to": "fu-cunshen",
    "kind": "service",
    "label": "早年部属",
    "sources": [
      {
        "chapterId": "old-v056",
        "paragraphId": "old-v056-p14",
        "excerpt": "會郡人李罕之起自群盜，授光州刺史，因往依之。",
        "title": "《旧五代史》相关记载"
      }
    ]
  },
  {
    "id": "shi-yan-liu-xun-yonghe-service",
    "from": "shi-yan",
    "to": "liu-xun-yonghe",
    "kind": "service",
    "label": "随军攻陕州",
    "sources": [
      {
        "chapterId": "old-v061",
        "paragraphId": "old-v061-p10",
        "excerpt": "屬河中王氏昆仲有尋戈之役，訓從史儼攻陝州。",
        "title": "《旧五代史》相关记载"
      }
    ]
  },
  {
    "id": "zhu-wen-li-hanzhi-service",
    "from": "zhu-wen",
    "to": "li-hanzhi",
    "kind": "service",
    "label": "后期转附",
    "note": "李罕之在夺潞州后转向朱温求援，受表为昭义军节度使；与其早年的河东军职分别记录。",
    "sources": [
      {
        "chapterId": "old-v015",
        "paragraphId": "old-v015-p11",
        "title": "《旧五代史》李罕之传",
        "excerpt": "《新唐書》：全忠表罕之昭義軍節度使。"
      }
    ]
  },

  {
    id: 'li-maozhen-fu-daozhao-adoption', from: 'li-maozhen', to: 'fu-daozhao', kind: 'adoption', label: '养子',
    note: '符道昭是在投朱温以前被李茂贞收为养子、名继远；不把后来的朱温军事任职当成收养。',
    sources: [source('new-v21', 45, '《新五代史》卷21 · 符道昭传', '後依鳳翔李茂貞，茂貞愛之，養以為子，名繼遠。')],
  },
  // Zhu Wen military appointments and independently verified family/conflict facts.
  {
    "id": "zhu-wen-ge-congzhou-service",
    "from": "zhu-wen",
    "to": "ge-congzhou",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v21",
        "paragraphId": "new-v21-p30",
        "title": "新五代史·葛从周传",
        "excerpt": "太祖盡黜諸將，獨用從周、延壽為大將。"
      }
    ]
  },
  {
    "id": "zhu-wen-zhu-zhen-service",
    "from": "zhu-wen",
    "to": "zhu-zhen",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v21",
        "paragraphId": "new-v21-p16",
        "title": "新五代史·朱珍传",
        "excerpt": "珍為將，善治軍選士，太祖初鎮宣武，珍為太祖創立軍制，選將練兵甚有法。"
      }
    ]
  },
  {
    "id": "zhu-wen-li-tangbin-service",
    "from": "zhu-wen",
    "to": "li-tangbin",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v021",
        "paragraphId": "old-v021-p14",
        "title": "旧五代史·李唐宾传",
        "excerpt": "三月，太祖破瓦子寨，唐賓與王虔裕來降。時黃巢壁於陳郊，乃命唐賓摩其西焚焉。"
      }
    ]
  },
  {
    "id": "zhu-wen-pang-shigu-service",
    "from": "zhu-wen",
    "to": "pang-shigu",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v21",
        "paragraphId": "new-v21-p25",
        "title": "新五代史·庞师古传",
        "excerpt": "梁太祖鎮宣武，初得馬五百匹為騎兵，乃以師古將之，從破黃巢、秦宗權，皆有功。"
      }
    ]
  },
  {
    "id": "zhu-wen-huo-cun-service",
    "from": "zhu-wen",
    "to": "huo-cun",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v21",
        "paragraphId": "new-v21-p38",
        "title": "新五代史·霍存传",
        "excerpt": "梁得曹州，太祖以存為刺史，兼諸軍都指揮使。"
      }
    ]
  },
  {
    "id": "zhu-wen-zhang-cunjing-service",
    "from": "zhu-wen",
    "to": "zhang-cunjing",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v21",
        "paragraphId": "new-v21-p41",
        "title": "新五代史·张存敬传",
        "excerpt": "張存敬，譙郡人也。為人剛直有膽勇，少事梁太祖為將，善因危窘出奇計。"
      }
    ]
  },
  {
    "id": "zhu-wen-fu-daozhao-service",
    "from": "zhu-wen",
    "to": "fu-daozhao",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v021",
        "paragraphId": "old-v021-p8",
        "title": "旧五代史·符道昭传",
        "excerpt": "太祖素聞其名，待之甚厚。昭宗反正，奏授秦州節度使、同平章事，遣兵援送，不克而還。"
      }
    ]
  },
  {
    "id": "zhu-wen-liu-han-service",
    "from": "zhu-wen",
    "to": "liu-han",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v21",
        "paragraphId": "new-v21-p49",
        "title": "新五代史·刘捍传",
        "excerpt": "太祖初鎮宣武，以為客將，使從朱珍募兵淄青。"
      }
    ]
  },
  {
    "id": "zhu-wen-kou-yanqing-service",
    "from": "zhu-wen",
    "to": "kou-yanqing",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v21",
        "paragraphId": "new-v21-p53",
        "title": "新五代史·寇彦卿传",
        "excerpt": "太祖初就鎮，以為通引官，累遷右長直都指揮使，領洺州刺史。"
      }
    ]
  },
  {
    "id": "zhu-wen-kang-huaiying-service",
    "from": "zhu-wen",
    "to": "kang-huaiying",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v023",
        "paragraphId": "old-v023-p18",
        "title": "旧五代史·康怀英传",
        "excerpt": "太祖素聞其名，得之甚喜，尋署為軍校。"
      }
    ]
  },
  {
    "id": "zhu-wen-liu-xun-service",
    "from": "zhu-wen",
    "to": "liu-xun",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v22",
        "paragraphId": "new-v22-p11",
        "title": "新五代史·刘鄩传",
        "excerpt": "太祖賜之冠帶，飲之以酒，鄩辭以量小，太祖曰：「取兗州，量何大乎？」以為元從都押衙。"
      }
    ]
  },
  {
    "id": "zhu-wen-niu-cunjie-service",
    "from": "zhu-wen",
    "to": "niu-cunjie",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v22",
        "paragraphId": "new-v22-p21",
        "title": "新五代史·牛存节传",
        "excerpt": "乃率其徒十餘人歸梁太祖。存節為人木彊忠謹，太祖愛之，賜之名字，以為小校。"
      }
    ]
  },
  {
    "id": "zhu-wen-zhang-guiba-service",
    "from": "zhu-wen",
    "to": "zhang-guiba",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v016",
        "paragraphId": "old-v016-p14",
        "title": "旧五代史·张归霸传",
        "excerpt": "中和中，巢領徒走宛丘。時太祖在汴，奉詔南討，巢黨日窘，歸霸昆仲與葛從周、李讜等相率來降，尋補宣武軍劇職。"
      }
    ]
  },
  {
    "id": "zhu-wen-zhang-guihou-service",
    "from": "zhu-wen",
    "to": "zhang-guihou",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v016",
        "paragraphId": "old-v016-p18",
        "title": "旧五代史·张归厚传",
        "excerpt": "中和末，與兄歸霸自巢軍相率來降，太祖署為軍校。"
      }
    ]
  },
  {
    "id": "zhu-wen-zhang-guibian-service",
    "from": "zhu-wen",
    "to": "zhang-guibian",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v016",
        "paragraphId": "old-v016-p22",
        "title": "旧五代史·张归弁传",
        "excerpt": "張歸弁，字從冕。始與兄歸霸、歸厚同歸於太祖，得署為牙校。"
      }
    ]
  },
  {
    "id": "zhu-wen-wang-chongshi-service",
    "from": "zhu-wen",
    "to": "wang-chongshi",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v22",
        "paragraphId": "new-v22-p36",
        "title": "新五代史·王重师传",
        "excerpt": "秦宗權陷許州，重師脫身歸梁，從太祖平蔡，攻兗、鄆，為拔山軍指揮使。"
      }
    ]
  },
  {
    "id": "zhu-wen-xu-huaiyu-service",
    "from": "zhu-wen",
    "to": "xu-huaiyu",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v22",
        "paragraphId": "new-v22-p40",
        "title": "新五代史·徐怀玉传",
        "excerpt": "少事梁太祖，與太祖俱起微賤。懷玉為將，以雄豪自任，而勇於戰陣。從太祖鎮宣武，為永城鎮將。"
      }
    ]
  },
  {
    "id": "zhu-wen-yang-shihou-service",
    "from": "zhu-wen",
    "to": "yang-shihou",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v23",
        "paragraphId": "new-v23-p2",
        "title": "新五代史·杨师厚传",
        "excerpt": "師厚在晉，無所知名，後以罪奔于梁，太祖以為宣武軍押衙、曹州刺史。"
      }
    ]
  },
  {
    "id": "zhu-wen-wang-jingren-service",
    "from": "zhu-wen",
    "to": "wang-jingren",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v23",
        "paragraphId": "new-v23-p14",
        "title": "新五代史·王景仁传",
        "excerpt": "開平四年，以景仁為北面招討使，將韓勍、李思安等兵伐趙，行至魏州，司天監言：「太陰虧，不利行師。」太祖亟召景仁等還，已而復遣之。"
      }
    ]
  },
  {
    "id": "zhu-wen-he-gui-service",
    "from": "zhu-wen",
    "to": "he-gui",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v23",
        "paragraphId": "new-v23-p17",
        "title": "新五代史·贺瑰传",
        "excerpt": "瓌感太祖不殺，誓以身自効。從太祖平青州，以為曹州刺史。"
      }
    ]
  },
  {
    "id": "zhu-wen-wang-tan-service",
    "from": "zhu-wen",
    "to": "wang-tan",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v23",
        "paragraphId": "new-v23-p20",
        "title": "新五代史·王檀传",
        "excerpt": "少事梁太祖為小校，尚讓攻梁，戰尉氏門，檀勇出諸將，太祖奇之，遷踏白副指揮使。"
      }
    ]
  },
  {
    "id": "zhu-wen-ma-sixun-service",
    "from": "zhu-wen",
    "to": "ma-sixun",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v23",
        "paragraphId": "new-v23-p25",
        "title": "新五代史·马嗣勋传",
        "excerpt": "梁兵未至，濠州已沒，嗣勳無所歸，乃留事梁，太祖以為宣武軍元從押衙。"
      }
    ]
  },
  {
    "id": "zhu-wen-wang-qianyu-service",
    "from": "zhu-wen",
    "to": "wang-qianyu",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v021",
        "paragraphId": "old-v021-p16",
        "title": "旧五代史·王虔裕传",
        "excerpt": "太祖鎮汴，四郊多事，始議選將征討，首以虔裕綰騎兵，恒為前鋒。"
      }
    ]
  },
  {
    "id": "zhu-wen-xie-yanzhang-service",
    "from": "zhu-wen",
    "to": "xie-yanzhang",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v23",
        "paragraphId": "new-v23-p32",
        "title": "新五代史·谢彦章传",
        "excerpt": "及壯，事梁太祖為騎將。"
      }
    ]
  },
  {
    "id": "zhu-wen-wang-yanzhang-service",
    "from": "zhu-wen",
    "to": "wang-yanzhang",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v021",
        "paragraphId": "old-v021-p20",
        "title": "旧五代史·王彦章传",
        "excerpt": "彥章少從軍，隸太祖帳下，以驍勇聞。稍遷軍職，累典禁兵。從太祖征討，所至有功，常持鐵槍衝堅陷陣。"
      }
    ]
  },
  {
    "id": "zhu-wen-shi-shucong-service",
    "from": "zhu-wen",
    "to": "shi-shucong",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v43",
        "paragraphId": "new-v43-p2",
        "title": "新五代史·氏叔琮传",
        "excerpt": "梁兵擊黃巢陳、許間，叔琮戰數有功，太祖壯之，使將後院馬軍，從攻徐、兗，表宿州刺史。"
      }
    ]
  },
  {
    "id": "zhu-wen-zhu-yougong-service",
    "from": "zhu-wen",
    "to": "zhu-yougong",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v019",
        "paragraphId": "old-v019-p4",
        "title": "旧五代史·朱友恭传",
        "excerpt": "時初建左長劍都，以友恭董之。從太祖四征，稍立軍功，累遷諸軍都指揮使、檢校左僕射。"
      }
    ]
  },
  {
    "id": "zhu-wen-li-sian-service",
    "from": "zhu-wen",
    "to": "li-sian",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v019",
        "paragraphId": "old-v019-p13",
        "title": "旧五代史·李思安传",
        "excerpt": "太祖甚惜之，命副王虔裕為踏白將。"
      }
    ]
  },
  {
    "id": "zhu-wen-hu-zhen-service",
    "from": "zhu-wen",
    "to": "hu-zhen",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v016",
        "paragraphId": "old-v016-p12",
        "title": "旧五代史·胡真传",
        "excerpt": "從至梁苑，表授檢校刑部尚書，頻從破巢、蔡於陳、鄭間。尋以奇兵襲取滑州，乃署為滑州節度留後，復表為鄭滑節度使、檢校右僕射。"
      }
    ]
  },
  {
    "id": "zhu-wen-guo-yan-service",
    "from": "zhu-wen",
    "to": "guo-yan",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v021",
        "paragraphId": "old-v021-p12",
        "title": "旧五代史·郭言传",
        "excerpt": "後從太祖赴汴，初為騎軍，繼有戰功，後擢為裨校。"
      }
    ]
  },
  {
    "id": "zhu-wen-deng-jijun-service",
    "from": "zhu-wen",
    "to": "deng-jijun",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v019",
        "paragraphId": "old-v019-p16",
        "title": "旧五代史·邓季筠传",
        "excerpt": "少入黃巢軍，隸於太祖麾下。及太祖鎮汴，首署為牙將，主騎軍。"
      }
    ]
  },
  {
    "id": "zhu-wen-huang-wenjing-service",
    "from": "zhu-wen",
    "to": "huang-wenjing",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v019",
        "paragraphId": "old-v019-p18",
        "title": "旧五代史·黄文靖传",
        "excerpt": "少附於黃巢黨中，巢敗，歸於太祖，累署牙職，繼遷諸軍指揮使。從太祖南平巢、蔡，北定兗、鄆，皆有功。"
      }
    ]
  },
  {
    "id": "zhu-wen-hu-gui-service",
    "from": "zhu-wen",
    "to": "hu-gui",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v019",
        "paragraphId": "old-v019-p20",
        "title": "旧五代史·胡规传",
        "excerpt": "天復中，太祖迎駕至岐下，以規權知洽州。"
      }
    ]
  },
  {
    "id": "zhu-wen-li-dang-service",
    "from": "zhu-wen",
    "to": "li-dang",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v019",
        "paragraphId": "old-v019-p22",
        "title": "旧五代史·李谠传",
        "excerpt": "其後巢軍既敗，讜乃束身歸於太祖，署為左德勝騎軍都將。從太祖討蔡賊，頗立軍功。"
      }
    ]
  },
  {
    "id": "zhu-wen-li-chongyin-service",
    "from": "zhu-wen",
    "to": "li-chongyin",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v019",
        "paragraphId": "old-v019-p24",
        "title": "旧五代史·李重胤传",
        "excerpt": "及巢寇漸衰，乃率眾來降。太祖素識之，拔用不次，署為先鋒步軍都頭。"
      }
    ]
  },
  {
    "id": "zhu-wen-fan-jushi-service",
    "from": "zhu-wen",
    "to": "fan-jushi",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v019",
        "paragraphId": "old-v019-p26",
        "title": "旧五代史·范居实传",
        "excerpt": "事太祖，初為隊將，從討巢、蔡有功。又從朱珍收滑州，改左廂都虞候。"
      }
    ]
  },
  {
    "id": "zhu-wen-liu-kangyi-service",
    "from": "zhu-wen",
    "to": "liu-kangyi",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v021",
        "paragraphId": "old-v021-p18",
        "title": "旧五代史·刘康乂传",
        "excerpt": "中和三年，從太祖赴鎮，委以心腹，康乂枕戈擐甲，夷險無憚。其後累典親軍，襲巢破蔡，斬獲尤多，累以戰功遷元從都將。"
      }
    ]
  },
  {
    "id": "zhu-wen-wang-jingrao-service",
    "from": "zhu-wen",
    "to": "wang-jingrao",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v43",
        "paragraphId": "new-v43-p44",
        "title": "新五代史·王敬荛传",
        "excerpt": "梁太祖攻淮南，道過潁州，敬蕘供饋梁兵甚厚，太祖大喜，表敬蕘沿淮指揮使。"
      }
    ]
  },
  {
    "id": "zhu-wen-ding-hui-service",
    "from": "zhu-wen",
    "to": "ding-hui",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v44",
        "paragraphId": "new-v44-p10",
        "title": "新五代史·丁会传",
        "excerpt": "後去為盜，與梁太祖俱從黃巢。梁太祖鎮宣武，以為宣武都押衙。"
      }
    ]
  },
  {
    "id": "zhu-wen-liu-zhijun-service",
    "from": "zhu-wen",
    "to": "liu-zhijun",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v44",
        "paragraphId": "new-v44-p2",
        "title": "新五代史·刘知俊传",
        "excerpt": "少事時溥，溥與梁相攻，知俊與其麾下二千人降梁，太祖以為左開道指揮使。"
      }
    ]
  },
  {
    "id": "zhu-wen-yan-bao-service",
    "from": "zhu-wen",
    "to": "yan-bao",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v44",
        "paragraphId": "new-v44-p23",
        "title": "新五代史·阎宝传",
        "excerpt": "梁太祖時，為諸軍都虞候，常從諸將征伐，未嘗獨立戰功。"
      }
    ]
  },
  {
    "id": "zhu-wen-he-delun-service",
    "from": "zhu-wen",
    "to": "he-delun",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v44",
        "paragraphId": "new-v44-p17",
        "title": "新五代史·贺德伦传",
        "excerpt": "梁太祖兼領宣義，德倫從太祖征伐，以功累遷平盧軍節度使。"
      }
    ]
  },
  {
    "id": "zhu-wen-zhu-youqian-service",
    "from": "zhu-wen",
    "to": "zhu-youqian",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p19",
        "title": "新五代史·朱友谦传",
        "excerpt": "太祖即位，徙鎮河中，累遷中書令，封冀王。"
      }
    ]
  },
  {
    "id": "zhu-wen-huo-yanwei-service",
    "from": "zhu-wen",
    "to": "huo-yanwei",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p8",
        "title": "新五代史·霍彦威传",
        "excerpt": "後事梁太祖，太祖亦愛之，稍遷左龍驤軍使、右監門衞上將軍。"
      }
    ]
  },
  {
    "id": "zhu-wen-wang-yanqiu-service",
    "from": "zhu-wen",
    "to": "wang-yanqiu",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v064",
        "paragraphId": "old-v064-p3",
        "title": "旧五代史·王晏球传",
        "excerpt": "晏球預選，從梁祖征伐，所至立功，累遷廳子都指揮使。"
      }
    ]
  },
  {
    "id": "zhu-wen-dai-siyuan-service",
    "from": "zhu-wen",
    "to": "dai-siyuan",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v064",
        "paragraphId": "old-v064-p8",
        "title": "旧五代史·戴思远传",
        "excerpt": "戴思遠，本梁之故將也。初事梁祖，以武幹知名。開平元年，自右羽林統軍加檢校司徒，出為晉州刺史。"
      }
    ]
  },
  {
    "id": "zhu-wen-zhu-hanbin-service",
    "from": "zhu-wen",
    "to": "zhu-hanbin",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p33",
        "title": "新五代史·朱汉宾传",
        "excerpt": "太祖聞之，乃更選勇士數百人，號「落鴈都」，以漢賓為指揮使。"
      }
    ]
  },
  {
    "id": "zhu-wen-kong-qing-service",
    "from": "zhu-wen",
    "to": "kong-qing",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "old-v064",
        "paragraphId": "old-v064-p12",
        "title": "旧五代史·孔勍传",
        "excerpt": "少便騎射，為軍中小校，事梁祖漸至郡守，累遷齊州防禦使、唐鄧節度使。"
      }
    ]
  },
  {
    "id": "zhu-wen-liu-qi-service",
    "from": "zhu-wen",
    "to": "liu-qi",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p45",
        "title": "新五代史·刘玘传",
        "excerpt": "梁太祖鎮宣武，玘以軍卒補隊長，稍以戰功遷牙將，為襄州都指揮使。"
      }
    ]
  },
  {
    "id": "zhu-wen-zhou-zhiyu-service",
    "from": "zhu-wen",
    "to": "zhou-zhiyu",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p50",
        "title": "新五代史·周知裕传",
        "excerpt": "梁太祖得知裕喜甚，為置歸化軍，以知裕為指揮使，凡與晉戰所得，及兵背晉而歸梁者，皆以隸知裕。"
      }
    ]
  },
  {
    "id": "zhu-wen-yuan-xiangxian-service",
    "from": "zhu-wen",
    "to": "yuan-xiangxian",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p26",
        "title": "新五代史·袁象先传",
        "excerpt": "象先以梁甥為宣武軍內外馬步軍都指揮使，歷宿、洺、陳三州刺史。太祖即位，累遷左龍武統軍、在京馬步軍都指揮使。"
      }
    ]
  },
  {
    "id": "zhu-wen-duan-ning-service",
    "from": "zhu-wen",
    "to": "duan-ning",
    "kind": "service",
    "label": "部将",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p40",
        "title": "新五代史·段凝传",
        "excerpt": "太祖漸親信之，常使監諸軍。"
      }
    ]
  },
  {
    "id": "zhu-wen-li-zhouyi-service",
    "from": "zhu-wen",
    "to": "li-zhouyi",
    "kind": "service",
    "label": "左司马",
    "note": "此关系据朱温在世时的军事任职或受命领兵记载；人物其后的转仕、军职及结局另见生平。",
    "sources": [
      {
        "chapterId": "new-v21",
        "paragraphId": "new-v21-p45",
        "title": "新五代史·符道昭传中的李周彝记载",
        "excerpt": "太祖為元帥，初開府，而李周彝以鄜州降，以為左司馬，擇右司馬難其人，及得道昭，乃授之。"
      }
    ]
  },
  {
    "id": "zhu-wen-yougong-adoption",
    "from": "zhu-wen",
    "to": "zhu-yougong",
    "kind": "adoption",
    "label": "养子",
    "sources": [
      {
        "chapterId": "old-v019",
        "paragraphId": "old-v019-p4",
        "title": "《旧五代史》卷19",
        "excerpt": "太祖憐之，因畜為己子，賜姓，初名克讓，後改之。"
      }
    ],
    "note": "朱友恭本姓李名彦威；史载为养子，不是亲生子。"
  },
  {
    "id": "zhu-wen-youqian-adoption",
    "from": "zhu-wen",
    "to": "zhu-youqian",
    "kind": "adoption",
    "label": "养子",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p19",
        "title": "《新五代史》卷45",
        "excerpt": "太祖益憐之，乃更其名友謙，錄以為子。"
      }
    ],
    "note": "朱友谦原名简，请列朱温诸子，获改名并记入属籍。"
  },
  {
    "id": "zhu-wen-hanbin-adoption",
    "from": "zhu-wen",
    "to": "zhu-hanbin",
    "kind": "adoption",
    "label": "养子",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p32",
        "title": "《新五代史》卷45",
        "excerpt": "梁太祖以其父死戰，憐之，以為養子。"
      }
    ]
  },
  {
    "id": "ge-congzhou-xie-yanzhang-adoption",
    "from": "ge-congzhou",
    "to": "xie-yanzhang",
    "kind": "adoption",
    "label": "养子",
    "sources": [
      {
        "chapterId": "new-v23",
        "paragraphId": "new-v23-p32",
        "title": "《新五代史》卷23",
        "excerpt": "幼事葛從周，從周憐其敏惠，養以為子，授之兵法，"
      }
    ],
    "note": "葛从周是谢彦章的养父，并授其兵法。"
  },
  {
    "id": "huo-cun-yanwei-adoption",
    "from": "huo-cun",
    "to": "huo-yanwei",
    "kind": "adoption",
    "label": "养子",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p8",
        "title": "《新五代史》卷46",
        "excerpt": "少遭兵亂，梁將霍存掠得之，愛其儁爽，養以為子。"
      }
    ]
  },
  {
    "id": "zhang-guiba-guihou-siblings",
    "from": "zhang-guiba",
    "to": "zhang-guihou",
    "kind": "kinship",
    "label": "兄弟",
    "sources": [
      {
        "chapterId": "old-v016",
        "paragraphId": "old-v016-p18",
        "title": "《旧五代史》卷16",
        "excerpt": "中和末，與兄歸霸自巢軍相率來降，太祖署為軍校。"
      }
    ],
    "note": "归霸为兄，归厚为弟。"
  },
  {
    "id": "zhang-guiba-guibian-siblings",
    "from": "zhang-guiba",
    "to": "zhang-guibian",
    "kind": "kinship",
    "label": "兄弟",
    "sources": [
      {
        "chapterId": "old-v016",
        "paragraphId": "old-v016-p22",
        "title": "《旧五代史》卷16",
        "excerpt": "張歸弁，字從冕。始與兄歸霸、歸厚同歸於太祖，得署為牙校。"
      }
    ],
    "note": "归霸为兄，归弁为弟。"
  },
  {
    "id": "zhang-guihou-guibian-siblings",
    "from": "zhang-guihou",
    "to": "zhang-guibian",
    "kind": "kinship",
    "label": "兄弟",
    "sources": [
      {
        "chapterId": "old-v016",
        "paragraphId": "old-v016-p22",
        "title": "《旧五代史》卷16",
        "excerpt": "張歸弁，字從冕。始與兄歸霸、歸厚同歸於太祖，得署為牙校。"
      }
    ],
    "note": "归厚为兄，归弁为弟。"
  },
  {
    "id": "zhu-wen-yuan-xiangxian-uncle",
    "from": "zhu-wen",
    "to": "yuan-xiangxian",
    "kind": "kinship",
    "label": "舅甥",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p26",
        "title": "《新五代史》卷45",
        "excerpt": "父敬初，梁太府卿、駙馬都尉，尚太祖妹，是為萬安大長公主。象先以梁甥為宣武軍內外馬步軍都指揮使，"
      }
    ],
    "note": "袁象先之母是朱温之妹；此关系区别于军事任职。"
  },
  {
    "id": "zhang-guiba-zhu-youzhen-marriage",
    "from": "zhang-guiba",
    "to": "zhu-youzhen",
    "kind": "kinship",
    "label": "岳父女婿",
    "sources": [
      {
        "chapterId": "new-v22",
        "paragraphId": "new-v22-p28",
        "title": "《新五代史》卷22",
        "excerpt": "張歸霸，清河人也。末帝娶其女，是為德妃。"
      }
    ]
  },
  {
    "id": "zhu-zhen-li-tangbin-conflict",
    "from": "zhu-zhen",
    "to": "li-tangbin",
    "kind": "conflict",
    "label": "交恶、擅杀",
    "sources": [
      {
        "chapterId": "old-v019",
        "paragraphId": "old-v019-p11",
        "title": "《旧五代史》卷19",
        "excerpt": "唐賓素與珍不協，果怒，乃見以訴其事。珍亦怒曰：「唐賓無禮！」遂拔劍斬之，"
      }
    ],
    "note": "朱珍与李唐宾不和，后于萧县擅杀李唐宾；不是临阵共同战死。"
  },
  {
    "id": "he-gui-xie-yanzhang-conflict",
    "from": "he-gui",
    "to": "xie-yanzhang",
    "kind": "conflict",
    "label": "交恶、杀害",
    "sources": [
      {
        "chapterId": "old-v023",
        "paragraphId": "old-v023-p15",
        "title": "《旧五代史》卷23",
        "excerpt": "先是，瑰與彥章不協，是歲冬十二月，復為諸軍都虞候朱珪所構，瑰乃伏甲士，殺彥章及濮州刺史孟審澄、別將侯溫裕等於軍，以謀叛聞。"
      },
      {
        "chapterId": "new-v23",
        "paragraphId": "new-v23-p33",
        "title": "《新五代史》卷23 · 谢彦章传",
        "excerpt": "珪乃誣彥章以為將反。瓌旦享士，使珪伏甲殺之，審澄、溫裕皆見害。"
      }
    ],
    "note": "贺瑰与谢彦章不和，后与朱珪合谋伏兵杀害谢彦章等，并以谋反上报；记录史书叙述，不把谋反指控认定为史实。"
  },
  {
    "id": "liu-han-wang-chongshi-conflict",
    "from": "liu-han",
    "to": "wang-chongshi",
    "kind": "conflict",
    "label": "交恶、构陷",
    "sources": [
      {
        "chapterId": "new-v22",
        "paragraphId": "new-v22-p38",
        "title": "《新五代史》卷22",
        "excerpt": "重師與劉捍故有隙，捍嘗構之太祖，太祖疑之。"
      }
    ],
    "note": "史书记刘捍与王重师有隙并向朱温构陷；不将构陷内容当作已发生的谋叛。"
  },
  {
    "id": "liu-zhijun-kang-huaiying-conflict",
    "from": "liu-zhijun",
    "to": "kang-huaiying",
    "kind": "conflict",
    "label": "升平交战",
    "sources": [
      {
        "chapterId": "new-v44",
        "paragraphId": "new-v44-p7",
        "title": "《新五代史》卷44",
        "excerpt": "知俊大敗懷英於昇平，殺梁將許從實。"
      }
    ],
    "note": "发生在刘知俊叛梁、投李茂贞之后；此前二人也曾共同征战。"
  },
  {
    "id": "zhu-wen-liu-zhijun-conflict",
    "from": "zhu-wen",
    "to": "liu-zhijun",
    "kind": "conflict",
    "label": "反梁",
    "sources": [
      {
        "chapterId": "new-v44",
        "paragraphId": "new-v44-p6",
        "title": "《新五代史》卷44",
        "excerpt": "知俊遂叛，臣於李茂貞，以兵攻雍、華，執劉捍送于鳳翔。"
      }
    ],
    "note": "刘知俊原任朱温部将，后因诛杀旧将而恐惧，叛梁归李茂贞；任职与反梁分列。"
  },
  {
    "id": "ding-hui-li-keyong-service",
    "from": "li-keyong",
    "to": "ding-hui",
    "kind": "service",
    "label": "归晋、任将",
    "sources": [
      {
        "chapterId": "new-v44",
        "paragraphId": "new-v44-p14",
        "title": "《新五代史》卷44",
        "excerpt": "會乃降晉。晉王以會歸于太原，賜以甲第，位在諸將上。"
      }
    ],
    "note": "丁会以潞州归晋，李克用给予高位；先前任朱温部将的关系另列。"
  },
  {
    "id": "li-cunxu-yan-bao-service",
    "from": "li-cunxu",
    "to": "yan-bao",
    "kind": "service",
    "label": "归晋、招讨使",
    "sources": [
      {
        "chapterId": "new-v44",
        "paragraphId": "new-v44-p24",
        "title": "《新五代史》卷44",
        "excerpt": "晉王拜寶檢校太尉、同中書門下平章事，領天平軍節度使、東南面招討使，位在諸將上。"
      }
    ],
    "note": "阎宝以邢州归李存勖时李存勖尚为晋王。"
  },
  {
    "id": "li-cunxu-royal-zhu-youqian-service",
    "from": "li-cunxu",
    "to": "zhu-youqian",
    "kind": "service",
    "label": "归唐、任将",
    "sources": [
      {
        "chapterId": "new-v45",
        "paragraphId": "new-v45-p22",
        "title": "《新五代史》卷45",
        "excerpt": "莊宗滅梁入洛，友謙來朝，賜姓名曰李繼麟，賜予鉅萬。明年，加守太師、尚書令，賜鐵券恕死罪。"
      }
    ],
    "note": "朱友谦归后唐后受李存勖赐姓名李继麟，仍为同一人物。"
  },
  {
    "id": "li-cunxu-huo-yanwei-service",
    "from": "li-cunxu",
    "to": "huo-yanwei",
    "kind": "service",
    "label": "归唐、赐姓名",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p10",
        "title": "《新五代史》卷46",
        "excerpt": "賜姓名曰李紹真。明年，徙鎮武寧，從明宗擊契丹，明宗愛其為人，甚親厚之。"
      }
    ],
    "note": "霍彦威降后唐后受李存勖赐姓名李绍真；军事转仕与养父霍存关系分开。"
  },
  {
    "id": "li-cunxu-wang-yanqiu-service",
    "from": "li-cunxu",
    "to": "wang-yanqiu",
    "kind": "service",
    "label": "归唐、任将",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p24",
        "title": "《新五代史》卷46",
        "excerpt": "即解甲降唐，莊宗賜姓名曰李紹虔，拜齊州防禦使，戍瓦橋關。"
      }
    ]
  },
  {
    "id": "li-siyuan-huo-yanwei-service",
    "from": "li-siyuan",
    "to": "huo-yanwei",
    "kind": "service",
    "label": "辅佐即位",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p12",
        "title": "《新五代史》卷46",
        "excerpt": "莊宗崩，彥威從明宗入洛陽，首率羣臣勸進，內外機事，皆決彥威。"
      }
    ]
  },
  {
    "id": "li-siyuan-wang-yanqiu-service",
    "from": "li-siyuan",
    "to": "wang-yanqiu",
    "kind": "service",
    "label": "归德节度、讨定州",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p25",
        "title": "《新五代史》卷46",
        "excerpt": "明宗兵變，自鄴而南，遣人招晏球，晏球從至洛陽，拜歸德軍節度使。定州王都反，以晏球為招討使，"
      }
    ]
  },
  {
    "id": "duan-ning-wang-yanzhang-conflict",
    "from": "duan-ning",
    "to": "wang-yanzhang",
    "kind": "conflict",
    "label": "争功、倾轧",
    "sources": [
      {
        "chapterId": "old-v021",
        "paragraphId": "old-v021-p22",
        "title": "《旧五代史》卷21",
        "excerpt": "時段凝以賄賂交結，自求兵柄，素與彥章不協，潛害其功，陰行逗撓，遂至王師不利，竟退彥章而用段凝。"
      }
    ]
  },
  {
    "id": "duan-ning-huo-yanwei-conflict",
    "from": "huo-yanwei",
    "to": "duan-ning",
    "kind": "conflict",
    "label": "交恶",
    "sources": [
      {
        "chapterId": "new-v46",
        "paragraphId": "new-v46-p12",
        "title": "《新五代史》卷46",
        "excerpt": "彥威素與段凝、溫韜有隙，因擅捕凝、韜下獄，將殺之，"
      }
    ],
    "note": "发生在李嗣源入洛时；段凝等经劝止暂得赦免，之后的处分另见原文。"
  },
  {
    id: 'zhu-wen-yougui-parent', from: 'zhu-wen', to: 'zhu-yougui', kind: 'kinship', label: '父子',
    sources: [source('new-v13', 45, '《新五代史》卷13 · 梁家人传', '庶人友珪者，太祖初鎮宣武，略地宋，亳間，與逆旅婦人野合而生也。')],
  },
  {
    id: 'zhu-wen-youzhen-parent', from: 'zhu-wen', to: 'zhu-youzhen', kind: 'kinship', label: '父子',
    sources: [source('new-v03', 1, '《新五代史》卷3 · 梁本纪第三', '末帝，太祖第三子友貞也。')],
  },
  {
    id: 'li-keyong-cunxu-parent', from: 'li-keyong', to: 'li-cunxu', kind: 'kinship', label: '父子',
    note: '李存勖是李克用的亲子；不将十三太保专题中的所有成员一概视为养子。',
    sources: [source('old-v027', 1, '《旧五代史》卷27 · 唐庄宗本纪一', '莊宗光聖神閔孝皇帝，諱存勗，武皇帝之長子也。')],
  },
  {
    id: 'li-keyong-kerou-siblings', from: 'li-keyong', to: 'li-kerou', kind: 'kinship', label: '兄弟',
    note: '李克柔是李克用之弟。',
    sources: [source('old-v052', 2, '《旧五代史》卷52 · 李嗣昭传', '李嗣昭，字益光，武皇母弟代州刺史克柔之假子也。')],
  },
  {
    id: 'li-siyuan-conghou-parent', from: 'li-siyuan', to: 'li-conghou', kind: 'kinship', label: '父子',
    note: '新旧史对李从厚的排行记载不同，关系图仅表示两史一致的父子关系。',
    sources: [
      source('new-v07', 1, '《新五代史》卷7 · 唐愍帝本纪', '愍皇帝，明宗第五子從厚也。'),
      source('old-v045', 2, '《旧五代史》卷45 · 唐闵帝本纪', '閔帝，諱從厚，小字菩薩奴，明宗第三子也。'),
    ],
  },
  {
    id: 'li-siyuan-shi-jingtang-marriage', from: 'li-siyuan', to: 'shi-jingtang', kind: 'kinship', label: '岳父女婿',
    note: '石敬瑭娶李嗣源之女；此连线表示姻亲，不表示父子。',
    sources: [source('new-v08', 1, '《新五代史》卷8 · 晋高祖本纪', '敬瑭為人沈厚寡言，明宗愛之，妻以女，是為永寧公主，由是常隸明宗帳下，號左射軍。')],
  },
  {
    id: 'shi-jingtang-chonggui-uncle', from: 'shi-jingtang', to: 'shi-chonggui', kind: 'kinship', label: '叔侄',
    note: '石重贵的生父石敬儒为石敬瑭之兄；另有收养关系。',
    sources: [source('new-v09', 1, '《新五代史》卷9 · 晋出帝本纪', '出帝父敬儒，高祖兄也，為唐莊宗騎將，早卒，高祖以其子重貴為子。')],
  },
  {
    id: 'liu-zhiyuan-chengyou-parent', from: 'liu-zhiyuan', to: 'liu-chengyou', kind: 'kinship', label: '父子',
    sources: [source('new-v10', 8, '《新五代史》卷10 · 汉隐帝本纪', '隱帝，高祖第二子承祐也。')],
  },
  {
    id: 'chai-rong-zongxun-parent', from: 'chai-rong', to: 'chai-zongxun', kind: 'kinship', label: '父子',
    sources: [source('new-v12', 9, '《新五代史》卷12 · 周恭帝本纪', '恭皇帝，世宗第四子宗訓也。')],
  },
  {
    id: 'li-keyong-siyuan-adoption', from: 'li-keyong', to: 'li-siyuan', kind: 'adoption', label: '养子',
    sources: [source('new-v06', 1, '《新五代史》卷6 · 唐明宗本纪', '太祖養以為子，賜名嗣源。')],
  },
  {
    id: 'li-kerou-sizhao-adoption', from: 'li-kerou', to: 'li-sizhao', kind: 'adoption', label: '养育',
    note: '《旧五代史》明确称李嗣昭为李克柔假子；《新五代史》本传称李克用以金帛收取李嗣昭，命李克柔养以为子，义儿传序又将嗣昭列入李克用养子。这里保留两个层次，不合并成李克用直接养育。',
    sources: [
      source('old-v052', 2, '《旧五代史》卷52 · 李嗣昭传', '李嗣昭，字益光，武皇母弟代州刺史克柔之假子也。'),
      source('new-v36', 4, '《新五代史》卷36 · 李嗣昭传', '父言家適生兒，太祖因遺以金帛而取之，命其弟克柔養以為子。'),
      source('new-v36', 2, '《新五代史》卷36 · 义儿传', '太祖養子多矣，其可紀者九人，其一是為明宗，其次曰嗣昭、嗣本、嗣恩、存信、存孝、存進、存璋、存賢。'),
    ],
  },
  {
    id: 'li-keyong-cunxin-adoption', from: 'li-keyong', to: 'li-cunxin', kind: 'adoption', label: '养子',
    sources: [source('new-v36', 17, '《新五代史》卷36 · 李存信传', '從太祖起代北，入關破黃巢，累以功為馬步軍都指揮使，遂賜姓名，以為子。')],
  },
  {
    id: 'li-keyong-cunjin-adoption', from: 'li-keyong', to: 'li-cunjin', kind: 'adoption', label: '养子',
    sources: [source('new-v36', 25, '《新五代史》卷36 · 李存进传', '太祖攻破朔州得之，賜以姓名，養為子。')],
  },
  {
    id: 'li-keyong-siben-adoption', from: 'li-keyong', to: 'li-siben', kind: 'adoption', label: '养子',
    note: '养子关系据《新五代史》；新旧史对其最后结局有不同记载，不据此连线断定其结局。',
    sources: [source('new-v36', 13, '《新五代史》卷36 · 李嗣本传', '嗣本少事太祖，太祖愛之，賜以姓名，養為子。')],
  },
  {
    id: 'li-keyong-sien-adoption', from: 'li-keyong', to: 'li-sien', kind: 'adoption', label: '养子',
    sources: [source('new-v36', 15, '《新五代史》卷36 · 李嗣恩传', '少事太祖，能騎射，為鐵林軍將，稍以戰功遷突陣指揮使，賜姓名，以為子。')],
  },
  {
    id: 'li-keyong-cunzhang-adoption', from: 'li-keyong', to: 'li-cunzhang', kind: 'adoption', label: '史载养子',
    note: '《新五代史》义儿传开篇将李存璋列入养子；《旧五代史》本传记其从军与受遗命之事，未在此明说收养。',
    sources: [
      source('new-v36', 2, '《新五代史》卷36 · 义儿传', '太祖養子多矣，其可紀者九人，其一是為明宗，其次曰嗣昭、嗣本、嗣恩、存信、存孝、存進、存璋、存賢。'),
      source('old-v053', 16, '《旧五代史》卷53 · 李存璋传', '武皇初起雲中，存璋與康君立、薛志勤等為奔走交，從入關，以功授國子祭酒，累管萬勝、雄威等軍。'),
    ],
  },
  {
    id: 'li-keyong-cunxian-adoption', from: 'li-keyong', to: 'li-cunxian', kind: 'adoption', label: '养子',
    sources: [source('new-v36', 32, '《新五代史》卷36 · 李存贤传', '太祖擊黃巢于陳州，得之，賜以姓名，養為子。')],
  },
  {
    id: 'li-keyong-cunxiao-adoption', from: 'li-keyong', to: 'li-cunxiao', kind: 'adoption', label: '养子',
    sources: [source('new-v36', 19, '《新五代史》卷36 · 李存孝传', '太祖掠地代北得之，給事帳中，賜姓名，以為子，常從為騎將。')],
  },
  {
    id: 'li-siyuan-congke-adoption', from: 'li-siyuan', to: 'li-congke', kind: 'adoption', label: '养子',
    sources: [source('new-v07', 4, '《新五代史》卷7 · 唐废帝本纪', '魏氏有子阿三，已十餘歲，明宗養以為子，名曰從珂。')],
  },
  {
    id: 'shi-jingtang-chonggui-adoption', from: 'shi-jingtang', to: 'shi-chonggui', kind: 'adoption', label: '养子',
    note: '石敬瑭收兄长之子石重贵为子；生父仍为石敬儒。',
    sources: [source('new-v09', 1, '《新五代史》卷9 · 晋出帝本纪', '出帝父敬儒，高祖兄也，為唐莊宗騎將，早卒，高祖以其子重貴為子。')],
  },
  {
    id: 'guo-wei-chai-rong-adoption', from: 'guo-wei', to: 'chai-rong', kind: 'adoption', label: '养子',
    note: '柴荣是郭威妻子圣穆皇后的侄子，幼年在郭家长大，后被收为养子；不是郭威亲生子。',
    sources: [source('new-v12', 1, '《新五代史》卷12 · 周世宗本纪', '柴氏女適太祖，是為聖穆皇后。后兄守禮子榮，幼從姑長太祖家，以謹厚見愛，太祖遂以為子。')],
  },
  {
    id: 'li-keyong-sizhao-service', from: 'li-keyong', to: 'li-sizhao', kind: 'service', label: '部将',
    note: '李嗣昭在李克用麾下任衙内指挥使；养育关系另列于李克柔。',
    sources: [source('new-v36', 4, '《新五代史》卷36 · 李嗣昭传', '太祖愛其謹厚，常從用兵，為衙內指揮使。')],
  },
  {
    id: 'li-keyong-fu-cunshen-service', from: 'li-keyong', to: 'fu-cunshen', kind: 'service', label: '义儿军使',
    note: '史书记其任义儿军使并获赐李姓、名存审；这里不把赐姓名或义儿军任职直接等同于明确的收养记载。',
    sources: [source('new-v25', 10, '《新五代史》卷25 · 符存审传', '其後事李罕之，從罕之歸晉，晉王以為義兒軍使，賜姓李氏，名存審。')],
  },
  {
    id: 'li-keyong-shi-jingsi-service', from: 'li-keyong', to: 'shi-jingsi', kind: 'service', label: '部将',
    note: '史敬思为李克用部将，在上源驿之变中断后战死；所引史书未称其为养子。',
    sources: [source('old-v055', 5, '《旧五代史》卷55 · 史建瑭传附史敬思', '武皇節制雁門，敬思為九府都督，從入關，定京師。及鎮太原，為裨將。')],
  },
  {
    id: 'li-keyong-kang-junli-service', from: 'li-keyong', to: 'kang-junli', kind: 'service', label: '部将',
    note: '康君立参与李克用早年起兵，后任左都押牙、先锋军使；所引史书未称其为养子。',
    sources: [source('old-v055', 1, '《旧五代史》卷55 · 康君立传', '武皇授雁門節度，以君立為左都押牙，從入關，逐黃孽，收長安。武皇還鎮太原，授檢校工部尚書、先鋒軍使，')],
  },
  {
    id: 'shi-jingtang-liu-zhiyuan-service', from: 'shi-jingtang', to: 'liu-zhiyuan', kind: 'service', label: '部将',
    note: '刘知远先与石敬瑭同事李嗣源，后在石敬瑭麾下任职；此关系发生在刘知远建汉以前。',
    sources: [source('new-v10', 1, '《新五代史》卷10 · 汉高祖本纪', '與晉高祖俱事明宗為偏將，明宗及梁人戰德勝，晉高祖馬甲斷，梁兵幾及，知遠以所乘馬授之，復取高祖馬殿而還，高祖德之。高祖留守北京，知遠為押衙。')],
  },
  {
    id: 'liu-zhiyuan-guo-wei-service', from: 'liu-zhiyuan', to: 'guo-wei', kind: 'service', label: '任枢密副使',
    note: '郭威在后汉高祖刘知远时任枢密副使；此关系发生在郭威建周以前。',
    sources: [source('new-v11', 2, '《新五代史》卷11 · 周太祖本纪', '契丹滅晉，漢高祖起兵太原，即皇帝位，拜威樞密副使。')],
  },
  {
    id: 'zhu-wen-yougui-succession', from: 'zhu-wen', to: 'zhu-yougui', kind: 'succession', label: '皇位交接',
    note: '912年，朱友珪参与弑父后自立；这不是正常传位。',
    sources: [source('new-v13', 46, '《新五代史》卷13 · 梁家人传', '乾化二年六月既望，友珪於柩前即皇帝位，拜韓勍忠武軍節度使，以末帝為汴州留後，河中朱友謙為中書令。')],
  },
  {
    id: 'zhu-yougui-youzhen-succession', from: 'zhu-yougui', to: 'zhu-youzhen', kind: 'succession', label: '皇位交接',
    note: '913年，朱友珪在政变中身亡，朱友贞即位；交接连线不代表父子关系。',
    sources: [source('new-v13', 47, '《新五代史》卷13 · 梁家人传', '末帝即位，復友文官爵，廢友珪為庶人。')],
  },
  {
    id: 'li-cunxu-siyuan-succession', from: 'li-cunxu', to: 'li-siyuan', kind: 'succession', label: '皇位交接',
    note: '926年，庄宗死后李嗣源入洛阳即位；两人不是父子。',
    sources: [
      source('new-v06', 10, '《新五代史》卷6 · 唐明宗本纪', '四月丁亥，莊宗崩。己丑，入洛陽。'),
      source('new-v06', 10, '《新五代史》卷6 · 唐明宗本纪', '皇帝即位于柩前，'),
    ],
  },
  {
    id: 'li-siyuan-conghou-succession', from: 'li-siyuan', to: 'li-conghou', kind: 'succession', label: '皇位交接',
    note: '933年，明宗死后李从厚即位。',
    sources: [source('new-v07', 2, '《新五代史》卷7 · 唐愍帝本纪', '明宗病甚，遣宦者孟漢瓊召王于鄴，而明宗崩，祕其喪六日。十二月癸卯朔，發喪于西宮，皇帝即位于柩前，')],
  },
  {
    id: 'li-conghou-congke-succession', from: 'li-conghou', to: 'li-congke', kind: 'succession', label: '皇位交接',
    note: '934年，李从珂起兵，李从厚被废，随后遇害；此连线表示取代帝位。',
    sources: [source('new-v07', 7, '《新五代史》卷7 · 唐废帝本纪', '癸酉，以太后令降天子為鄂王，命王監國。乙亥，皇帝即位。')],
  },
  {
    id: 'shi-jingtang-chonggui-succession', from: 'shi-jingtang', to: 'shi-chonggui', kind: 'succession', label: '皇位交接',
    note: '942年，石敬瑭死后石重贵即位。',
    sources: [source('old-v081', 2, '《旧五代史》卷81 · 晋少帝本纪一', '是歲六月十三日乙丑，高祖崩，承遺制命柩前即皇帝位。')],
  },
  {
    id: 'liu-zhiyuan-chengyou-succession', from: 'liu-zhiyuan', to: 'liu-chengyou', kind: 'succession', label: '皇位交接',
    note: '948年，刘知远死后刘承祐即位。',
    sources: [
      source('new-v10', 8, '《新五代史》卷10 · 汉隐帝本纪', '未及封而高祖崩，祕不發喪，殺杜重威。'),
      source('new-v10', 9, '《新五代史》卷10 · 汉隐帝本纪', '乾祐元年二月辛巳，封承祐周王。是日，皇帝即位于柩前。'),
    ],
  },
  {
    id: 'guo-wei-chai-rong-succession', from: 'guo-wei', to: 'chai-rong', kind: 'succession', label: '皇位交接',
    note: '954年，郭威死后柴荣即位。',
    sources: [source('new-v12', 3, '《新五代史》卷12 · 周世宗本纪', '壬辰，太祖崩，祕不發喪。丙申，發喪，皇帝即位于柩前。')],
  },
  {
    id: 'chai-rong-zongxun-succession', from: 'chai-rong', to: 'chai-zongxun', kind: 'succession', label: '皇位交接',
    note: '959年，柴荣死后柴宗训即位。',
    sources: [source('new-v12', 10, '《新五代史》卷12 · 周恭帝本纪', '顯德六年六月癸巳，世宗崩。甲午，皇帝即位于柩前。')],
  },
  {
    id: 'li-cunxin-cunxiao-conflict', from: 'li-cunxin', to: 'li-cunxiao', kind: 'conflict', label: '交恶',
    note: '新旧史均记李存信与李存孝不和；连线表示史载冲突，不采用后世演义的排行与情节。',
    sources: [source('new-v36', 17, '《新五代史》卷36 · 李存信传', '存信與存孝俱為養子，材勇不及存孝，而存信不為之下，由是交惡，存孝所為，存信每沮激之，存孝卒得罪死。')],
  },
  {
    id: 'li-congke-shi-jingtang-conflict', from: 'li-congke', to: 'shi-jingtang', kind: 'conflict', label: '起兵对抗',
    note: '936年，石敬瑭拒绝移镇，李从珂削其官爵并遣兵讨伐；石敬瑭求援契丹，后建立后晋。',
    sources: [source('new-v08', 6, '《新五代史》卷8 · 晋高祖本纪', '廢帝下詔削奪敬瑭官爵，命張敬達等討之，敬瑭求援於契丹。')],
  },
  {
    id: 'zhu-youzhen-li-cunxu-conflict', from: 'zhu-youzhen', to: 'li-cunxu', kind: 'conflict', label: '梁唐战争',
    note: '923年，李存勖称帝建立后唐，随后灭梁，朱友贞身亡；这是战争与政权更替，不是同朝传位。',
    sources: [source('new-v03', 54, '《新五代史》卷3 · 梁本纪第三', '梁亡。〈書曰「梁亡」，見唐莊宗之立速也。四月，莊宗立，稱唐，十月，梁始亡，見唐不待滅梁而立。〉')],
  },
];

export function relationshipsForPerson(personId: string, kinds?: readonly RelationshipKind[]): PersonRelationship[] {
  return getRelationshipNeighborhood(personId, relationshipNodes, personRelationships, kinds).relationships;
}

export function getRelationshipNeighborhood(
  personId: string,
  nodes: readonly RelationshipNode[],
  edges: readonly PersonRelationship[],
  kinds?: readonly RelationshipKind[],
): {
  nodes: RelationshipNode[];
  relationships: PersonRelationship[];
} {
  const byId = new Map<string, RelationshipNode>();
  for (const node of nodes) {
    if (!node.id.trim() || byId.has(node.id)) continue;
    byId.set(node.id, node);
  }
  if (!personId.trim() || !byId.has(personId)) return { nodes: [], relationships: [] };
  const seenEdges = new Set<string>();
  const relationships = edges.filter(edge => {
    if (edge.from === edge.to || !byId.has(edge.from) || !byId.has(edge.to)) return false;
    if (edge.from !== personId && edge.to !== personId) return false;
    if (!Object.hasOwn(relationshipKindLabels, edge.kind) || (kinds && !kinds.includes(edge.kind))) return false;
    if (!edge.id.trim() || seenEdges.has(edge.id)) return false;
    seenEdges.add(edge.id);
    return true;
  });
  const ids = new Set([personId]);
  for (const edge of relationships) {
    ids.add(edge.from);
    ids.add(edge.to);
  }
  return { nodes: [...byId.values()].filter(node => ids.has(node.id)), relationships };
}

export function relationshipNeighborhood(personId: string, kinds?: readonly RelationshipKind[]): {
  nodes: RelationshipNode[];
  relationships: PersonRelationship[];
} {
  return getRelationshipNeighborhood(personId, relationshipNodes, personRelationships, kinds);
}

export function searchRelationshipNodes(
  query: string,
  nodes: readonly RelationshipNode[] = relationshipNodes,
  people: readonly Pick<HistoryPerson, 'id' | 'aliases'>[] = catalogPeople,
): RelationshipNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const aliasesById = new Map(people.map(person => [person.id, person.aliases]));
  const seenIds = new Set<string>();
  return nodes.filter(node => {
    if (!node.id.trim() || seenIds.has(node.id)) return false;
    seenIds.add(node.id);
    return [node.name, aliasesById.get(node.id) ?? '']
      .some(text => text.toLocaleLowerCase().includes(normalizedQuery));
  });
}
