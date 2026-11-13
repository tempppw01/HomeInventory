import type { ItemType } from "@/types";

/**
 * 耐用品 / 消耗品的本地识别规则引擎。
 *
 * 为什么是本地规则:录入时需要**即时、离线、零配置、可解释、可撤销**的判断。AI 适合做
 * 「精修」,不适合做每次按键都要等的默认值。因此这里只做纯函数推断:无 React、无 IO、
 * 无网络、不引第三方依赖,同样的输入永远得到同样的结果,并且每条结论都带一句中文依据。
 *
 * 返回 `null` 表示**没有任何可靠信号**,UI 应保持静默(不要用它当默认值替用户决定);
 * 用户仍可手动切换类型,或点「AI 补全」做进一步判断。
 *
 * 规则优先级(高优先级先返回,强信号一定会赢过弱信号):
 *   1. 名称强关键词 —— confidence "high"
 *      名称里同时命中两类关键词时,**更靠前的关键词**所在类胜出(规则 4);
 *      同一位置取**更长的关键词**(「面包机」赢「面」、「油烟机」赢「油」、「水果刀」赢「水果」)。
 *   2. 分类信号 —— confidence "medium"
 *      食品 / 饮品 / 清洁 / 医药(含「医药·xx」)→ 消耗品;家电 / 数码 / 衣物 / 户外 → 耐用品。
 *      「日用 / 其他」不表态。
 *   3. 单位信号 —— kg / L / ml → 消耗品(medium);瓶 / 袋 / 盒 / 包 / 卷 → 消耗品(low);台 → 耐用品(medium)。
 *   4. 以上都没有 → `null`。
 *
 * 匹配前归一化:去掉所有空白、全角转半角、英文字母转小写。所以「洗衣液 2L」
 * 「抽纸 3 层 130 抽」「ＵＳＢ 数据线」「5 号电池」都能按子串命中。
 *
 * 已知边界与取舍(宁可给 null 或给出可解释的结论,也不做隐式猜测):
 * 自检标注集 97 条(含 3 条期望 null):整体 91/94 = 96.8%,强关键词 78/81 = 96.3%,
 * 置信度分层 high 80/83、medium 10/10、low 1/1。复跑:`npx tsx output/experience/type-guess-check.ts`。
 * - **语义本身有争议**的词按团队约定固定下来,并如实写进 reason,用户一眼能看出依据、一键改回:
 *   电池 → 消耗品、「数据线」→ 耐用品、「保鲜膜」→ 消耗品、「花盆」→ 耐用品。
 *   「纸巾盒」「药箱」这种「容器名里带消耗品词」的名字按名称判定(都 → 消耗品),语义上可争议。
 * - **仍然会误判的 3 条**(刻意不救,作为能力边界如实记录):刀削面(命中「刀」→ 耐用品)、
 *   面粉筛(命中「面」→ 消耗品)、药盒(命中「药」→ 消耗品)——都是「更靠前的关键词赢」的直接后果。
 * - 单字词(液、纸、刀、衣……)**故意保留**:宁可多识别一层,也不要让「抽纸 3 层」这种
 *   带规格的日常名落到 null。为抵消单字词误判,另加了一批**更长的保护词**(洗衣粉、油烟机、
 *   水果刀、酸奶机、电动牙刷、洗碗海绵、油壶、奶瓶、茶叶罐、咖啡杯、水果盘、保鲜盒、
 *   电池充电器、一次性手套……),它们在更靠前或同位置胜出。
 * - 只有「日用 / 其他」分类、名称无关键词、单位也不表态时返回 null(例如「儿童绘本」「备用钥匙」);
 *   名称里没有词表覆盖的日常词(如「矿泉水」)也会 null,此时分类 / 单位仍可兜底(饮品 → 消耗品)。
 */

export type KeywordGroup = {
  /** 直接进 reason 的语义分组,以类型结尾,例如「清洁消耗品」。 */
  label: string;
  type: ItemType;
  words: readonly string[];
};

/**
 * 强关键词词表。分组只影响给用户看的理由文案,不参与优先级计算;
 * 优先级只看「命中位置 → 关键词长度」,因此新词可以安全地追加到任意分组。
 * 导出仅为自检脚本做「同一个词不会同时出现在两类」的一致性审计。
 */
export const ITEM_TYPE_KEYWORD_GROUPS: readonly KeywordGroup[] = [
  {
    label: "食品饮品消耗品",
    type: "CONSUMABLE",
    words: [
      "酱油", "饼干", "巧克力", "奶粉", "鸡蛋", "水果", "蔬菜", "豆腐", "蜂蜜", "零食",
      "咖啡", "茶叶", "酸奶", "牛奶", "米", "面", "粉", "糖", "盐", "油", "醋", "酱",
      "肉", "鱼", "奶", "乳",
    ],
  },
  {
    label: "液体类消耗品",
    type: "CONSUMABLE",
    // 兜底单字词:「洗手液」「精华液」这类名字至少能给出可解释的消耗品结论。
    words: ["液"],
  },
  {
    label: "清洁消耗品",
    type: "CONSUMABLE",
    words: [
      "洗洁精", "洗衣液", "洗衣粉", "洗衣皂", "洗衣凝珠", "洗手液", "洗发水", "沐浴露",
      "护发素", "湿巾", "垃圾袋", "保鲜膜", "保鲜袋", "密封袋", "锡纸", "抹布", "海绵",
      "洗碗海绵", "一次性手套", "护肤品", "化妆品",
      "牙膏", "牙刷", "消毒", "酒精", "皂", "剂", "精",
    ],
  },
  {
    label: "纸品与耗材消耗品",
    type: "CONSUMABLE",
    words: [
      "打印纸", "抽纸", "卷纸", "纸巾", "笔芯", "滤芯", "胶带", "电池", "香薰",
      "蜡烛", "纸", "巾",
    ],
  },
  {
    label: "医药个护消耗品",
    type: "CONSUMABLE",
    words: ["创可贴", "胶囊", "口罩", "膏", "药", "片"],
  },
  {
    label: "宠物消耗品",
    type: "CONSUMABLE",
    words: ["猫粮", "狗粮", "猫砂"],
  },
  {
    label: "家电耐用品",
    type: "DURABLE",
    words: [
      "洗衣机", "电饭煲", "吸尘器", "吹风机", "加湿器", "净化器", "微波炉", "热水壶",
      "油烟机", "洗碗机", "燃气灶", "热水器", "净水器", "电磁炉", "咖啡机", "面包机",
      "榨汁机", "破壁机", "酸奶机", "扫地机器人", "烘干机", "电动牙刷", "吊灯", "落地灯",
      "冰箱", "空调", "电视", "投影", "烤箱", "风扇", "台灯", "插座", "插排",
    ],
  },
  {
    label: "数码耐用品",
    type: "DURABLE",
    words: [
      "数据线", "充电器", "充电宝", "电池充电器", "显示器", "路由器", "键盘", "鼠标", "硬盘", "显卡",
      "镜头", "相机", "耳机", "音箱", "平板", "手机", "电脑", "支架", "手表",
      "u盘", "移动电源",
    ],
  },
  {
    label: "家具耐用品",
    type: "DURABLE",
    words: [
      "收纳箱", "整理箱", "行李箱", "书架", "衣柜", "鞋柜", "茶几", "沙发", "花瓶",
      "垃圾桶", "瑜伽垫", "哑铃",
      "床", "桌", "椅", "凳", "柜",
    ],
  },
  {
    label: "服饰耐用品",
    type: "DURABLE",
    words: [
      "外套", "羽绒", "围巾", "手套", "背包", "衣", "裤", "裙", "鞋", "帽", "袜",
      "被", "枕",
    ],
  },
  {
    label: "厨具耐用品",
    type: "DURABLE",
    words: [
      "保温杯", "砧板", "水果刀", "水果盘", "茶杯", "咖啡杯", "酒杯", "杯子", "饭盒", "筷子", "勺子",
      "水杯", "奶瓶", "油壶", "米桶", "茶叶罐", "保鲜盒", "锅", "碗", "盘", "刀",
    ],
  },
  {
    label: "工具耐用品",
    type: "DURABLE",
    words: ["螺丝刀", "工具箱", "卷尺", "扳手", "电钻", "钳子", "拖把", "扫帚", "锤", "梯子"],
  },
  {
    label: "户外与文体耐用品",
    type: "DURABLE",
    words: [
      "登山杖", "自行车", "睡袋", "帐篷", "滑板", "头盔", "积木", "拼图", "玩具",
      "吉他", "钢琴", "乐器", "篮球", "足球", "球拍", "跳绳",
    ],
  },
  {
    label: "医疗设备耐用品",
    type: "DURABLE",
    words: ["血压计", "体温计", "血糖仪", "雾化器", "额温枪", "耳温枪", "血氧仪", "轮椅"],
  },
  {
    label: "日用耐用品",
    type: "DURABLE",
    words: ["花盆", "伞"],
  },
];

/** 分类信号:命中即中置信度。医药用前缀匹配,兼容「医药·感冒发热」这类细分分类。 */
const CONSUMABLE_CATEGORIES = ["食品", "饮品", "清洁", "医药"] as const;
const DURABLE_CATEGORIES = ["家电", "数码", "衣物", "户外"] as const;

/** 单位信号:数值单位通常是「按量买」的消耗品;台是明确的器具量词。 */
const CONSUMABLE_UNITS_MEDIUM = ["kg", "g", "l", "ml", "千克", "克", "升", "毫升", "斤", "两"] as const;
const CONSUMABLE_UNITS_LOW = ["瓶", "袋", "盒", "包", "卷", "罐", "桶", "支"] as const;
const DURABLE_UNITS_MEDIUM = ["台"] as const;

export type ItemTypeGuess = {
  type: ItemType; // "DURABLE" | "CONSUMABLE"
  confidence: "high" | "medium" | "low";
  reason: string; // 一句中文,给 UI 直接显示,例:名称含「洗衣液」,属于清洁消耗品
  matched?: string; // 命中的关键词或分类
};

/** 去掉空白、全角转半角、英文转小写后用于子串匹配。 */
function normalize(value: string): string {
  return value
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

const typeLabel = (type: ItemType) => (type === "DURABLE" ? "耐用品" : "消耗品");

type KeywordHit = { index: number; word: string; group: KeywordGroup };

/**
 * 找最靠前的强关键词;同位置取更长的词(更具体)。
 * 两个不同关键词不可能同时满足「同位置 + 同长度」,所以结果与遍历顺序无关。
 */
function findStrongKeyword(normalizedName: string): KeywordHit | null {
  let best: KeywordHit | null = null;
  for (const group of ITEM_TYPE_KEYWORD_GROUPS) {
    for (const word of group.words) {
      const index = normalizedName.indexOf(word);
      if (index < 0) continue;
      if (!best || index < best.index || (index === best.index && word.length > best.word.length)) {
        best = { index, word, group };
      }
    }
  }
  return best;
}

/**
 * 推测物品类型。返回 `null` 表示没有信号,调用方应什么都不显示。
 */
export function guessItemType(input: { name: string; category?: string | null; unit?: string | null }): ItemTypeGuess | null {
  const name = normalize(input.name ?? "");
  const category = (input.category ?? "").trim();
  const unit = normalize(input.unit ?? "");

  const hit = name ? findStrongKeyword(name) : null;
  if (hit) {
    return {
      type: hit.group.type,
      confidence: "high",
      reason: `名称含「${hit.word}」，属于${hit.group.label}`,
      matched: hit.word,
    };
  }

  const normalizedCategory = normalize(category);
  if (normalizedCategory) {
    const categoryType: ItemType | null = CONSUMABLE_CATEGORIES.some((item) => normalizedCategory.includes(item))
      ? "CONSUMABLE"
      : DURABLE_CATEGORIES.some((item) => normalizedCategory.includes(item))
        ? "DURABLE"
        : null;
    if (categoryType) {
      return {
        type: categoryType,
        confidence: "medium",
        reason: `分类「${category}」通常属于${typeLabel(categoryType)}`,
        matched: category,
      };
    }
  }

  if (unit) {
    const match = (list: readonly string[]) => list.some((item) => item === unit);
    if (match(CONSUMABLE_UNITS_MEDIUM)) {
      return { type: "CONSUMABLE", confidence: "medium", reason: `单位「${input.unit}」通常按用量补充，属于消耗品`, matched: input.unit ?? unit };
    }
    if (match(DURABLE_UNITS_MEDIUM)) {
      return { type: "DURABLE", confidence: "medium", reason: `单位「${input.unit}」通常用于器具，属于耐用品`, matched: input.unit ?? unit };
    }
    if (match(CONSUMABLE_UNITS_LOW)) {
      return { type: "CONSUMABLE", confidence: "low", reason: `单位「${input.unit}」多见于分装物品，按消耗品处理`, matched: input.unit ?? unit };
    }
  }

  return null;
}

/** 供 UI 直接显示的短标签,例:「消耗品(依据:洗衣液)」。 */
export function guessItemTypeLabel(guess: ItemTypeGuess): string {
  const label = typeLabel(guess.type);
  return guess.matched ? `${label}(依据:${guess.matched})` : label;
}
