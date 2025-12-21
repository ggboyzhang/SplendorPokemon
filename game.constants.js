// ========== 1) 枚举：精灵球 ==========
const Ball = Object.freeze({
  poke_ball: 0,
  heal_ball: 1,
  great_ball: 2,
  quick_ball: 3,
  ultra_ball: 4,
  master_ball: 5,
});

const BALL_KEYS = [
  "poke_ball",
  "heal_ball",
  "great_ball",
  "quick_ball",
  "ultra_ball",
  "master_ball",
];
const BALL_NAMES = ["精灵球", "治愈球", "超级球", "先机球", "高级球", "大师球"];
const BALL_IMAGES = [
  "token_image/精灵球.png",
  "token_image/治愈球.png",
  "token_image/超级球.png",
  "token_image/先机球.png",
  "token_image/高级球.png",
  "token_image/大师球.png",
];
const STORAGE_KEY = "pokemon_splendor_save_v1";

const PRIMARY_ACTION_LABELS = {
  take3: "拿取异色标记",
  take2: "拿取同色标记",
  reserve: "保留卡牌",
  buy: "捕捉",
  skip: "跳过行动",
};

const DISABLED_AI_LEVEL = -1;
const DEFAULT_AI_LEVEL = 2; // 标准
const AI_LEVEL_OPTIONS = [
  { value: DISABLED_AI_LEVEL, label: "关闭" },
  { value: 0, label: "入门" },
  { value: 1, label: "简单" },
  { value: 2, label: "标准" },
  { value: 3, label: "进阶" },
  { value: 4, label: "大师" },
];
const AI_BLUNDER_RATE = [0.6, 0.4, 0.2, 0.05, 0.0];
const AI_DELAY_MS = 420;
