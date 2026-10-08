import { catalogPeople } from './person-catalog.ts';
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
  succession: '皇位交接',
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
]);

function source(chapterId: string, paragraph: number, title: string, excerpt: string): RelationshipSource {
  return { chapterId, paragraphId: `${chapterId}-p${paragraph}`, title, excerpt };
}

// Each quotation is a contiguous excerpt of an immutable archived paragraph.
// Direction means parent → child, commander → subordinate or predecessor → successor;
// siblings and antagonists use the direction only to lay out their relationship.
export const personRelationships: readonly PersonRelationship[] = [
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
