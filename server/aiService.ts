import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import path from "path";
import { detectProvinceAndIspFromName } from "./geo_channels";

export interface LogoCdnSource {
  id: string;
  name: string;
  url: string;
  type: "fanmingming" | "epg112114" | "custom";
  enabled: boolean;
  notes?: string;
}

export interface AiConfig {
  provider: "siliconflow" | "zhipu" | "deepseek" | "aliyun" | "moonshot" | "custom" | "gemini" | "builtin";
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  logoBaseFan?: string;
  logoBase112?: string;
  logoSources?: LogoCdnSource[];
}

export interface ChannelSuggestion {
  standardName: string;
  suggestedCategory: string;
  suggestedCategoryList: string[];
  logo: string;
  alias: string[];
  epgId: string;
  description?: string;
  confidence: number;
  reason: string;
}

// Default configuration presets
export const AI_PROVIDER_PRESETS = {
  siliconflow: {
    name: "硅基流动 (SiliconFlow - 推荐国内大模型)",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-7B-Instruct",
    models: [
      { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen2.5-7B-Instruct (🌟 官方永久免费/免算力)", isFree: true },
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek-V3 (超强综合大模型/高性价比)", isFree: false },
      { id: "THUDM/glm-4-9b-chat", name: "GLM-4-9B-Chat (🌟 免费模型)", isFree: true },
      { id: "internlm/internlm2_5-7b-chat", name: "书生·浦语 7B (🌟 免费模型)", isFree: true },
      { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek-R1 (深度思维推理模型)", isFree: false }
    ],
    helpUrl: "https://cloud.siliconflow.cn",
    helpText: "国内知名模型托管平台，新用户赠送免费额度，Qwen2.5-7B 与 GLM-4-9B 均免算力费用。"
  },
  zhipu: {
    name: "智谱 AI (GLM 开放平台)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    models: [
      { id: "glm-4-flash", name: "GLM-4-Flash (🌟 官方永久免费)", isFree: true },
      { id: "glm-4-air", name: "GLM-4-Air (高速轻量)", isFree: false },
      { id: "glm-4-plus", name: "GLM-4-Plus (旗舰级大模型)", isFree: false }
    ],
    helpUrl: "https://open.bigmodel.cn",
    helpText: "清华智谱官方开放平台，glm-4-flash 模型永久免费且响应迅速。"
  },
  deepseek: {
    name: "DeepSeek (深度求索官方)",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: [
      { id: "deepseek-chat", name: "DeepSeek-V3 (通用对话/极速经济)", isFree: false },
      { id: "deepseek-reasoner", name: "DeepSeek-R1 (深度推理链模型)", isFree: false }
    ],
    helpUrl: "https://platform.deepseek.com",
    helpText: "DeepSeek 官方 API，国内顶尖性价比与中文理解能力。"
  },
  aliyun: {
    name: "阿里通义千问 (DashScope 百炼)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-turbo",
    models: [
      { id: "qwen-turbo", name: "Qwen-Turbo (高速经济模型)", isFree: false },
      { id: "qwen-plus", name: "Qwen-Plus (增强推理模型)", isFree: false },
      { id: "qwen-max", name: "Qwen-Max (超大规模旗舰模型)", isFree: false }
    ],
    helpUrl: "https://bailian.console.aliyun.com",
    helpText: "阿里云百炼大模型服务平台，支持 OpenAI 兼容格式。"
  },
  moonshot: {
    name: "月之暗面 (Moonshot / Kimi)",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    models: [
      { id: "moonshot-v1-8k", name: "Moonshot-v1-8k (8K上下文)", isFree: false },
      { id: "moonshot-v1-32k", name: "Moonshot-v1-32k (32K长文本)", isFree: false }
    ],
    helpUrl: "https://platform.moonshot.cn",
    helpText: "Kimi 官方开放平台，擅长中文长文本与精细理解。"
  },
  custom: {
    name: "自定义 OpenAI 兼容接口 / 本地 Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "qwen2.5:7b",
    models: [
      { id: "qwen2.5:7b", name: "Qwen2.5 7B (本地/自建)", isFree: true },
      { id: "llama3.1", name: "Llama 3.1 (本地/自建)", isFree: true },
      { id: "custom", name: "自定义模型名称", isFree: true }
    ],
    helpUrl: "",
    helpText: "支持自建 API 反向代理、OneAPI / NewAPI 聚合中转站、以及本地 Ollama / vLLM 服务。"
  },
  gemini: {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    defaultModel: "gemini-3.7-flash",
    models: [
      { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash (极速高精)", isFree: false },
      { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite (超轻量)", isFree: false },
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (高阶复杂推理)", isFree: false }
    ],
    helpUrl: "https://aistudio.google.com",
    helpText: "Google Gemini 大模型，支持结构化 JSON 输出与高速响应。"
  },
  builtin: {
    name: "内置免配置智能规则引擎 (无需任何 API Key)",
    baseUrl: "",
    defaultModel: "builtin-engine",
    models: [
      { id: "builtin-engine", name: "内置离线智能推导与台标库 (100% 离线可用/秒级响应)", isFree: true }
    ],
    helpUrl: "",
    helpText: "无需任何外部网络大模型或 API Key，基于内置的几十万条频道词典与标准台标库秒级精准匹配。"
  }
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: "siliconflow",
  apiKey: "",
  baseUrl: "https://api.siliconflow.cn/v1",
  model: "Qwen/Qwen2.5-7B-Instruct",
  temperature: 0.1
};

const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(process.cwd(), "data"));
const AI_CONFIG_FILE = path.join(DATA_DIR, "ai_config.json");

let cachedAiConfig: AiConfig = { ...DEFAULT_AI_CONFIG };
let isLoadedFromFile = false;

export function getAiConfig(): AiConfig {
  try {
    if (fs.existsSync(AI_CONFIG_FILE)) {
      const content = fs.readFileSync(AI_CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(content);
      cachedAiConfig = { ...DEFAULT_AI_CONFIG, ...parsed };
      isLoadedFromFile = true;
    }
  } catch (err) {
    // Return cached/default
  }
  return cachedAiConfig;
}

export function saveAiConfig(cfg: Partial<AiConfig>): AiConfig {
  const current = getAiConfig();
  cachedAiConfig = { ...current, ...cfg };
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify(cachedAiConfig, null, 2), "utf-8");
  } catch (err) {
    console.error("[AiService] Failed to save AI config file:", err);
  }
  return cachedAiConfig;
}

export function resolveEffectiveAiConfig(partialOrCustom?: Partial<AiConfig>): AiConfig {
  const saved = getAiConfig();
  if (!partialOrCustom || typeof partialOrCustom !== "object") {
    return saved;
  }
  const provider = partialOrCustom.provider || saved.provider || "builtin";
  const sameProvider = provider === saved.provider;

  let apiKey = partialOrCustom.apiKey;
  // If apiKey is undefined, empty string, or contains asterisk masking (e.g. "fb33********F7Ba" or "****")
  if (apiKey === undefined || apiKey === null || apiKey.trim() === "" || apiKey.includes("*")) {
    apiKey = sameProvider ? (saved.apiKey || "") : "";
  } else {
    apiKey = apiKey.trim();
  }

  const preset = AI_PROVIDER_PRESETS[provider];
  const baseUrl = (partialOrCustom.baseUrl && partialOrCustom.baseUrl.trim())
    ? partialOrCustom.baseUrl.trim()
    : (sameProvider && saved.baseUrl ? saved.baseUrl : (preset?.baseUrl || ""));

  const model = (partialOrCustom.model && partialOrCustom.model.trim())
    ? partialOrCustom.model.trim()
    : (sameProvider && saved.model ? saved.model : (preset?.defaultModel || ""));

  const temperature = typeof partialOrCustom.temperature === "number"
    ? partialOrCustom.temperature
    : (saved.temperature !== undefined ? saved.temperature : 0.1);

  return {
    ...saved,
    provider,
    apiKey,
    baseUrl,
    model,
    temperature
  };
}

// --- Comprehensive Standard Channel Knowledge Database ---
// Covers CCTV, Provincial Satellites, Hong Kong/Macau/Taiwan, Sports, Documentaries, Kids, Movies & Specialties
interface StandardChannelInfo {
  keywords: string[];
  standardName: string;
  category: string;
  categoryList: string[];
  logo: string;
  alias: string[];
  epgId: string;
}

export const DEFAULT_LOGO_BASE_FAN = "https://live.fanmingming.com/tv";
export const DEFAULT_LOGO_BASE_112 = "https://epg.112114.xyz/logo";

export const DEFAULT_LOGO_SOURCES: LogoCdnSource[] = [
  {
    id: "fanmingming",
    name: "Fanmingming 官方台标库 (主流央视/卫视/港澳)",
    url: "https://live.fanmingming.com/tv",
    type: "fanmingming",
    enabled: true,
    notes: "适配 CCTV-1~17、各大卫视与港澳频道 (/CCTV1.png、/湖南卫视.png)"
  },
  {
    id: "epg112114",
    name: "112114 官方台标库 (地方台/港台/通用备用库)",
    url: "https://epg.112114.xyz/logo",
    type: "epg112114",
    enabled: true,
    notes: "适配地方台、港澳台与特色频道 (/民视.png、/东森新闻.png)"
  }
];

export function getLogoSources(): LogoCdnSource[] {
  const cfg = getAiConfig();
  if (Array.isArray(cfg.logoSources) && cfg.logoSources.length > 0) {
    return cfg.logoSources;
  }
  const defaultFan = (cfg.logoBaseFan && cfg.logoBaseFan.trim()) ? cfg.logoBaseFan.trim() : DEFAULT_LOGO_BASE_FAN;
  const default112 = (cfg.logoBase112 && cfg.logoBase112.trim()) ? cfg.logoBase112.trim() : DEFAULT_LOGO_BASE_112;
  return [
    {
      id: "fanmingming",
      name: "Fanmingming 官方台标库 (主流央视/卫视/港澳)",
      url: defaultFan,
      type: "fanmingming",
      enabled: true,
      notes: "适配 CCTV-1~17、各大卫视与港澳频道"
    },
    {
      id: "epg112114",
      name: "112114 官方台标库 (地方台/港台/通用备用库)",
      url: default112,
      type: "epg112114",
      enabled: true,
      notes: "适配地方台、港澳台与特色频道"
    }
  ];
}

export function getLogoBaseFan(): string {
  const sources = getLogoSources();
  const found = sources.find((s) => s.enabled && (s.type === "fanmingming" || s.id === "fanmingming"));
  if (found && found.url && found.url.trim()) {
    return found.url.trim().replace(/\/+$/, "");
  }
  const firstCustom = sources.find((s) => s.enabled && s.type === "custom");
  if (firstCustom && firstCustom.url && firstCustom.url.trim()) {
    return firstCustom.url.trim().replace(/\/+$/, "");
  }
  const firstEnabled = sources.find((s) => s.enabled);
  if (firstEnabled && firstEnabled.url && firstEnabled.url.trim()) {
    return firstEnabled.url.trim().replace(/\/+$/, "");
  }
  return DEFAULT_LOGO_BASE_FAN;
}

export function getLogoBase112(): string {
  const sources = getLogoSources();
  const found = sources.find((s) => s.enabled && (s.type === "epg112114" || s.id === "epg112114"));
  if (found && found.url && found.url.trim()) {
    return found.url.trim().replace(/\/+$/, "");
  }
  const firstCustom = sources.find((s) => s.enabled && s.type === "custom");
  if (firstCustom && firstCustom.url && firstCustom.url.trim()) {
    return firstCustom.url.trim().replace(/\/+$/, "");
  }
  const firstEnabled = sources.find((s) => s.enabled);
  if (firstEnabled && firstEnabled.url && firstEnabled.url.trim()) {
    return firstEnabled.url.trim().replace(/\/+$/, "");
  }
  return DEFAULT_LOGO_BASE_112;
}

export function resolveChannelLogo(rawLogo: string): string {
  if (!rawLogo || typeof rawLogo !== "string") return "";
  const trimmed = rawLogo.trim();
  if (!trimmed) return "";
  if (trimmed.includes("unsplash.com") || trimmed.startsWith("data:")) return trimmed;

  const fan = getLogoBaseFan();
  const epg112 = getLogoBase112();
  const sources = getLogoSources();

  // If it's a relative path or bare filename (e.g. "CCTV1.png", "/湖南卫视.png")
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    const cleanPath = trimmed.replace(/^\/+/, "");
    const isCctvOrSat = /cctv|cgtn|中央|央视|卫视/i.test(cleanPath);
    const base = isCctvOrSat ? fan : epg112;
    return `${base}/${cleanPath}`;
  }

  // 1. Check Fanmingming patterns (official .com, .cn, jsDelivr mirrors, raw github)
  const fanRegex = /^https?:\/\/(?:live\.fanmingming\.(?:com|cn)\/tv|(?:fastly|cdn|gcore|testingcf|quantil)\.jsdelivr\.net\/gh\/fanmingming\/live(?:@[^/]+)?\/tv|raw\.githubusercontent\.com\/fanmingming\/live\/[^/]+\/tv)/i;
  if (fanRegex.test(trimmed)) {
    return trimmed.replace(fanRegex, fan);
  }

  // 2. Check 112114 / Yang-1989 patterns (official epg.112114.xyz, jsDelivr mirrors, raw github)
  const epgRegex = /^https?:\/\/(?:epg\.112114\.xyz\/(?:logo|tv)|(?:fastly|cdn|gcore|testingcf|quantil)\.jsdelivr\.net\/gh\/YanG-1989\/m3u(?:@[^/]+)?\/logo|raw\.githubusercontent\.com\/YanG-1989\/m3u\/[^/]+\/logo)/i;
  if (epgRegex.test(trimmed)) {
    return trimmed.replace(epgRegex, epg112);
  }

  // 3. Check any configured sources in logoSources that might have been disabled or replaced
  for (const src of sources) {
    if (src.url && src.url.trim()) {
      const srcBase = src.url.trim().replace(/\/+$/, "");
      if (trimmed.startsWith(srcBase)) {
        if (!src.enabled) {
          const targetBase = src.type === "fanmingming" ? fan : epg112;
          return trimmed.replace(srcBase, targetBase);
        }
      }
    }
  }

  return trimmed;
}

const LOGO_BASE_FAN = "https://live.fanmingming.com/tv";
const LOGO_BASE_112 = "https://epg.112114.xyz/logo";

export const BUILTIN_CHANNEL_KNOWLEDGE: StandardChannelInfo[] = [
  // === CCTV 央视频道 ===
  {
    keywords: ["cctv1", "cctv-1", "中央一套", "中央1套", "央视一套", "cctv 1", "中央综合", "央视综合"],
    standardName: "CCTV-1 综合",
    category: "央视频道",
    categoryList: ["央视频道", "综合频道"],
    logo: `${LOGO_BASE_FAN}/CCTV1.png`,
    alias: ["CCTV1", "CCTV-1", "中央一套", "中央1套", "CCTV-1 综合", "CCTV-1 综合HD", "CCTV-1 综合 1080P", "央视一套"],
    epgId: "cctv1"
  },
  {
    keywords: ["cctv2", "cctv-2", "中央二套", "中央2套", "央视二套", "cctv 2", "中央财经", "央视财经"],
    standardName: "CCTV-2 财经",
    category: "央视频道",
    categoryList: ["央视频道", "财经资讯"],
    logo: `${LOGO_BASE_FAN}/CCTV2.png`,
    alias: ["CCTV2", "CCTV-2", "中央二套", "中央2套", "CCTV-2 财经", "CCTV-2 财经HD", "央视二套"],
    epgId: "cctv2"
  },
  {
    keywords: ["cctv3", "cctv-3", "中央三套", "中央3套", "央视三套", "cctv 3", "中央综艺", "央视综艺"],
    standardName: "CCTV-3 综艺",
    category: "央视频道",
    categoryList: ["央视频道", "影视综艺"],
    logo: `${LOGO_BASE_FAN}/CCTV3.png`,
    alias: ["CCTV3", "CCTV-3", "中央三套", "中央3套", "CCTV-3 综艺", "CCTV-3 综艺HD", "央视三套"],
    epgId: "cctv3"
  },
  {
    keywords: ["cctv4欧洲", "cctv-4欧洲", "cctv4 europe", "cctv-4 europe", "cctv4-europe", "cctv4 欧洲", "cctv-4 欧洲", "cctv4欧洲版", "cctv-4欧洲版", "中文国际欧洲", "中文国际欧洲版", "cctv4eu", "cctv4europe", "央视四套欧洲", "中央四套欧洲"],
    standardName: "CCTV-4 欧洲",
    category: "央视频道",
    categoryList: ["央视频道", "国际新闻"],
    logo: `${LOGO_BASE_FAN}/CCTV4Europe.png`,
    alias: ["CCTV4欧洲", "CCTV-4 欧洲", "CCTV-4 欧洲版", "CCTV4 Europe", "CCTV-4 Europe", "CCTV4-Europe", "CCTV-4 中文国际(欧洲版)", "CCTV-4 中文国际 欧洲", "央视四套欧洲", "中央四套欧洲"],
    epgId: "cctv4europe"
  },
  {
    keywords: ["cctv4美洲", "cctv-4美洲", "cctv4 america", "cctv-4 america", "cctv4-america", "cctv4 美洲", "cctv-4 美洲", "cctv4美洲版", "cctv-4美洲版", "中文国际美洲", "中文国际美洲版", "cctv4us", "cctv4america", "央视四套美洲", "中央四套美洲"],
    standardName: "CCTV-4 美洲",
    category: "央视频道",
    categoryList: ["央视频道", "国际新闻"],
    logo: `${LOGO_BASE_FAN}/CCTV4America.png`,
    alias: ["CCTV4美洲", "CCTV-4 美洲", "CCTV-4 美洲版", "CCTV4 America", "CCTV-4 America", "CCTV4-America", "CCTV-4 中文国际(美洲版)", "CCTV-4 中文国际 美洲", "央视四套美洲", "中央四套美洲"],
    epgId: "cctv4america"
  },
  {
    keywords: ["cctv4", "cctv-4", "中央四套", "中央4套", "央视四套", "cctv 4", "中文国际", "cctv4亚洲", "cctv-4亚洲", "cctv4 亚洲", "cctv-4 亚洲", "cctv4 asia", "cctv-4 asia", "中文国际亚洲", "中文国际亚洲版", "cctv4asia"],
    standardName: "CCTV-4 中文国际",
    category: "央视频道",
    categoryList: ["央视频道", "国际新闻"],
    logo: `${LOGO_BASE_FAN}/CCTV4.png`,
    alias: ["CCTV4", "CCTV-4", "中央四套", "CCTV-4 中文国际", "CCTV-4 亚洲", "央视四套", "CCTV4 亚洲", "CCTV-4 中文国际(亚洲版)", "中央4套"],
    epgId: "cctv4"
  },
  {
    keywords: ["cctv5+", "cctv-5+", "cctv5plus", "体育赛事", "中央五加", "央视五加", "cctv 5+"],
    standardName: "CCTV-5+ 体育赛事",
    category: "央视频道",
    categoryList: ["央视频道", "体育专区"],
    logo: `${LOGO_BASE_FAN}/CCTV5plus.png`,
    alias: ["CCTV5+", "CCTV-5+", "CCTV5plus", "中央五加", "CCTV-5+ 体育赛事", "CCTV-5+ 体育赛事HD"],
    epgId: "cctv5plus"
  },
  {
    keywords: ["cctv5", "cctv-5", "中央五套", "中央5套", "央视五套", "cctv 5", "中央体育", "央视体育"],
    standardName: "CCTV-5 体育",
    category: "央视频道",
    categoryList: ["央视频道", "体育专区"],
    logo: `${LOGO_BASE_FAN}/CCTV5.png`,
    alias: ["CCTV5", "CCTV-5", "中央五套", "中央5套", "CCTV-5 体育", "CCTV-5 体育HD", "央视五套"],
    epgId: "cctv5"
  },
  {
    keywords: ["cctv6", "cctv-6", "中央六套", "中央6套", "央视六套", "cctv 6", "中央电影", "央视电影"],
    standardName: "CCTV-6 电影",
    category: "央视频道",
    categoryList: ["央视频道", "影视剧场"],
    logo: `${LOGO_BASE_FAN}/CCTV6.png`,
    alias: ["CCTV6", "CCTV-6", "中央六套", "中央6套", "CCTV-6 电影", "CCTV-6 电影HD", "央视六套"],
    epgId: "cctv6"
  },
  {
    keywords: ["cctv7", "cctv-7", "中央七套", "中央7套", "央视七套", "cctv 7", "国防军事", "央视国防军事"],
    standardName: "CCTV-7 国防军事",
    category: "央视频道",
    categoryList: ["央视频道", "纪实军事"],
    logo: `${LOGO_BASE_FAN}/CCTV7.png`,
    alias: ["CCTV7", "CCTV-7", "中央七套", "中央7套", "CCTV-7 国防军事", "CCTV-7 军事HD", "央视七套"],
    epgId: "cctv7"
  },
  {
    keywords: ["cctv8", "cctv-8", "中央八套", "中央8套", "央视八套", "cctv 8", "央视电视剧", "中央电视剧"],
    standardName: "CCTV-8 电视剧",
    category: "央视频道",
    categoryList: ["央视频道", "影视剧场"],
    logo: `${LOGO_BASE_FAN}/CCTV8.png`,
    alias: ["CCTV8", "CCTV-8", "中央八套", "中央8套", "CCTV-8 电视剧", "CCTV-8 电视剧HD", "央视八套"],
    epgId: "cctv8"
  },
  {
    keywords: ["cctv9", "cctv-9", "中央九套", "中央9套", "央视九套", "cctv 9", "央视纪录", "中央纪录"],
    standardName: "CCTV-9 纪录",
    category: "央视频道",
    categoryList: ["央视频道", "纪实地理"],
    logo: `${LOGO_BASE_FAN}/CCTV9.png`,
    alias: ["CCTV9", "CCTV-9", "中央九套", "中央9套", "CCTV-9 纪录", "CCTV-9 纪录HD", "央视九套"],
    epgId: "cctv9"
  },
  {
    keywords: ["cctv10", "cctv-10", "中央十套", "中央10套", "央视十套", "cctv 10", "央视科教", "中央科教"],
    standardName: "CCTV-10 科教",
    category: "央视频道",
    categoryList: ["央视频道", "科教文化"],
    logo: `${LOGO_BASE_FAN}/CCTV10.png`,
    alias: ["CCTV10", "CCTV-10", "中央十套", "中央10套", "CCTV-10 科教", "CCTV-10 科教HD", "央视十套"],
    epgId: "cctv10"
  },
  {
    keywords: ["cctv11", "cctv-11", "中央十一套", "中央11套", "央视十一套", "cctv 11", "央视戏曲", "中央戏曲"],
    standardName: "CCTV-11 戏曲",
    category: "央视频道",
    categoryList: ["央视频道", "戏曲艺术"],
    logo: `${LOGO_BASE_FAN}/CCTV11.png`,
    alias: ["CCTV11", "CCTV-11", "中央十一套", "中央11套", "CCTV-11 戏曲", "CCTV-11 戏曲HD", "央视十一套"],
    epgId: "cctv11"
  },
  {
    keywords: ["cctv12", "cctv-12", "中央十二套", "中央12套", "央视十二套", "cctv 12", "社会与法", "央视社会与法"],
    standardName: "CCTV-12 社会与法",
    category: "央视频道",
    categoryList: ["央视频道", "法治社会"],
    logo: `${LOGO_BASE_FAN}/CCTV12.png`,
    alias: ["CCTV12", "CCTV-12", "中央十二套", "中央12套", "CCTV-12 社会与法", "CCTV-12 法制HD", "央视十二套"],
    epgId: "cctv12"
  },
  {
    keywords: ["cctv13", "cctv-13", "中央十三套", "中央13套", "央视十三套", "cctv 13", "央视新闻", "cctv新闻"],
    standardName: "CCTV-13 新闻",
    category: "央视频道",
    categoryList: ["央视频道", "新闻资讯"],
    logo: `${LOGO_BASE_FAN}/CCTV13.png`,
    alias: ["CCTV13", "CCTV-13", "中央十三套", "中央13套", "CCTV-13 新闻", "CCTV-13 新闻HD", "央视十三套", "央视新闻"],
    epgId: "cctv13"
  },
  {
    keywords: ["cctv14", "cctv-14", "中央十四套", "中央14套", "央视十四套", "cctv 14", "央视少儿", "cctv少儿"],
    standardName: "CCTV-14 少儿",
    category: "央视频道",
    categoryList: ["央视频道", "少儿动画"],
    logo: `${LOGO_BASE_FAN}/CCTV14.png`,
    alias: ["CCTV14", "CCTV-14", "中央十四套", "中央14套", "CCTV-14 少儿", "CCTV-14 少儿HD", "央视十四套", "央视少儿"],
    epgId: "cctv14"
  },
  {
    keywords: ["cctv15", "cctv-15", "中央十五套", "中央15套", "央视十五套", "cctv 15", "央视音乐", "cctv音乐"],
    standardName: "CCTV-15 音乐",
    category: "央视频道",
    categoryList: ["央视频道", "音乐专区"],
    logo: `${LOGO_BASE_FAN}/CCTV15.png`,
    alias: ["CCTV15", "CCTV-15", "中央十五套", "中央15套", "CCTV-15 音乐", "CCTV-15 音乐HD", "央视十五套", "央视音乐"],
    epgId: "cctv15"
  },
  {
    keywords: ["cctv16", "cctv-16", "中央十六套", "中央16套", "央视十六套", "cctv 16", "奥林匹克", "央视奥林匹克"],
    standardName: "CCTV-16 奥林匹克",
    category: "央视频道",
    categoryList: ["央视频道", "体育专区"],
    logo: `${LOGO_BASE_FAN}/CCTV16.png`,
    alias: ["CCTV16", "CCTV-16", "中央十六套", "CCTV-16 奥林匹克", "CCTV-16 奥林匹克HD", "央视十六套"],
    epgId: "cctv16"
  },
  {
    keywords: ["cctv17", "cctv-17", "中央十七套", "中央17套", "央视十七套", "cctv 17", "农业农村", "央视农业"],
    standardName: "CCTV-17 农业农村",
    category: "央视频道",
    categoryList: ["央视频道", "农业纪实"],
    logo: `${LOGO_BASE_FAN}/CCTV17.png`,
    alias: ["CCTV17", "CCTV-17", "中央十七套", "CCTV-17 农业农村", "CCTV-17 农业HD", "央视十七套"],
    epgId: "cctv17"
  },
  {
    keywords: ["cctv4k", "cctv-4k", "cctv 4k", "央视4k", "中央4k", "4k超高清"],
    standardName: "CCTV-4K 超高清",
    category: "央视频道",
    categoryList: ["央视频道", "超清专区"],
    logo: `${LOGO_BASE_FAN}/CCTV4K.png`,
    alias: ["CCTV-4K", "CCTV4K", "CCTV 4K", "央视4K", "CCTV-4K 超高清", "中央4K超高清"],
    epgId: "cctv4k"
  },
  {
    keywords: ["cctv8k", "cctv-8k", "cctv 8k", "央视8k", "中央8k", "8k超高清"],
    standardName: "CCTV-8K 超高清",
    category: "央视频道",
    categoryList: ["央视频道", "超清专区"],
    logo: `${LOGO_BASE_FAN}/CCTV8K.png`,
    alias: ["CCTV-8K", "CCTV8K", "CCTV 8K", "央视8K", "CCTV-8K 超高清"],
    epgId: "cctv8k"
  },
  // === CCTV 数字专区与付费频道 ===
  {
    keywords: ["cctv电视指南", "cctv-电视指南", "电视指南", "央视电视指南"],
    standardName: "CCTV 电视指南",
    category: "央视频道",
    categoryList: ["央视频道"],
    logo: `${LOGO_BASE_FAN}/CCTV电视指南.png`,
    alias: ["CCTV电视指南", "CCTV 电视指南", "CCTV-电视指南", "央视电视指南"],
    epgId: "cctv_guide"
  },
  {
    keywords: ["cctv文化精品", "cctv央视文化精品", "央视文化精品", "文化精品"],
    standardName: "CCTV 文化精品",
    category: "央视频道",
    categoryList: ["央视频道"],
    logo: `${LOGO_BASE_FAN}/CCTV文化精品.png`,
    alias: ["CCTV文化精品", "CCTV 文化精品", "CCTV央视文化精品", "CCTV-文化精品", "央视文化精品"],
    epgId: "cctv_culture"
  },
  {
    keywords: ["cctv女性时尚", "女性时尚", "央视女性时尚"],
    standardName: "CCTV 女性时尚",
    category: "央视频道",
    categoryList: ["央视频道"],
    logo: `${LOGO_BASE_FAN}/CCTV女性时尚.png`,
    alias: ["CCTV女性时尚", "CCTV 女性时尚", "CCTV-女性时尚", "央视女性时尚"],
    epgId: "cctv_female"
  },
  {
    keywords: ["cctv兵器科技", "兵器科技", "央视兵器科技"],
    standardName: "CCTV 兵器科技",
    category: "央视频道",
    categoryList: ["央视频道"],
    logo: `${LOGO_BASE_FAN}/CCTV兵器科技.png`,
    alias: ["CCTV兵器科技", "CCTV 兵器科技", "CCTV-兵器科技", "央视兵器科技"],
    epgId: "cctv_weapon"
  },
  {
    keywords: ["cctv央视台球", "cctv台球", "央视台球", "cctv-台球"],
    standardName: "CCTV 央视台球",
    category: "央视频道",
    categoryList: ["央视频道", "体育专区"],
    logo: `${LOGO_BASE_FAN}/CCTV央视台球.png`,
    alias: ["CCTV央视台球", "CCTV 央视台球", "CCTV台球", "CCTV 台球", "央视台球"],
    epgId: "cctv_billiards"
  },
  {
    keywords: ["cctv风云足球", "风云足球", "央视风云足球"],
    standardName: "CCTV 风云足球",
    category: "央视频道",
    categoryList: ["央视频道", "体育专区"],
    logo: `${LOGO_BASE_FAN}/CCTV风云足球.png`,
    alias: ["CCTV风云足球", "CCTV 风云足球", "风云足球", "央视风云足球"],
    epgId: "cctv_soccer"
  },
  {
    keywords: ["cctv风云剧场", "风云剧场", "央视风云剧场"],
    standardName: "CCTV 风云剧场",
    category: "央视频道",
    categoryList: ["央视频道", "影视剧场"],
    logo: `${LOGO_BASE_FAN}/CCTV风云剧场.png`,
    alias: ["CCTV风云剧场", "CCTV 风云剧场", "风云剧场", "央视风云剧场"],
    epgId: "cctv_fyjc"
  },
  {
    keywords: ["cctv第一剧场", "第一剧场", "央视第一剧场"],
    standardName: "CCTV 第一剧场",
    category: "央视频道",
    categoryList: ["央视频道", "影视剧场"],
    logo: `${LOGO_BASE_FAN}/CCTV第一剧场.png`,
    alias: ["CCTV第一剧场", "CCTV 第一剧场", "第一剧场", "央视第一剧场"],
    epgId: "cctv_dyjc"
  },
  {
    keywords: ["cctv怀旧剧场", "怀旧剧场", "央视怀旧剧场"],
    standardName: "CCTV 怀旧剧场",
    category: "央视频道",
    categoryList: ["央视频道", "影视剧场"],
    logo: `${LOGO_BASE_FAN}/CCTV怀旧剧场.png`,
    alias: ["CCTV怀旧剧场", "CCTV 怀旧剧场", "怀旧剧场", "央视怀旧剧场"],
    epgId: "cctv_hjjc"
  },
  {
    keywords: ["cctv风云音乐", "风云音乐", "央视风云音乐"],
    standardName: "CCTV 风云音乐",
    category: "央视频道",
    categoryList: ["央视频道", "音乐专区"],
    logo: `${LOGO_BASE_FAN}/CCTV风云音乐.png`,
    alias: ["CCTV风云音乐", "CCTV 风云音乐", "风云音乐", "央视风云音乐"],
    epgId: "cctv_fyyd"
  },
  {
    keywords: ["cctv高尔夫网球", "cctv高尔夫·网球", "高尔夫网球", "央视高尔夫网球"],
    standardName: "CCTV 高尔夫·网球",
    category: "央视频道",
    categoryList: ["央视频道", "体育专区"],
    logo: `${LOGO_BASE_FAN}/CCTV高尔夫网球.png`,
    alias: ["CCTV高尔夫网球", "CCTV 高尔夫网球", "CCTV 高尔夫·网球", "高尔夫网球", "央视高尔夫网球"],
    epgId: "cctv_golf"
  },
  {
    keywords: ["cctv世界地理", "世界地理", "央视世界地理"],
    standardName: "CCTV 世界地理",
    category: "央视频道",
    categoryList: ["央视频道", "新闻纪实"],
    logo: `${LOGO_BASE_FAN}/CCTV世界地理.png`,
    alias: ["CCTV世界地理", "CCTV 世界地理", "世界地理", "央视世界地理"],
    epgId: "cctv_geo"
  },
  {
    keywords: ["cctv发现之旅", "发现之旅", "央视发现之旅"],
    standardName: "CCTV 发现之旅",
    category: "央视频道",
    categoryList: ["央视频道", "新闻纪实"],
    logo: `${LOGO_BASE_FAN}/CCTV发现之旅.png`,
    alias: ["CCTV发现之旅", "CCTV 发现之旅", "发现之旅", "央视发现之旅"],
    epgId: "cctv_discovery"
  },
  {
    keywords: ["cctv中学生", "央视中学生"],
    standardName: "CCTV 中学生",
    category: "央视频道",
    categoryList: ["央视频道"],
    logo: `${LOGO_BASE_FAN}/CCTV中学生.png`,
    alias: ["CCTV中学生", "CCTV 中学生", "央视中学生"],
    epgId: "cctv_student"
  },
  {
    keywords: ["cctv卫生健康", "卫生健康", "央视卫生健康"],
    standardName: "CCTV 卫生健康",
    category: "央视频道",
    categoryList: ["央视频道"],
    logo: `${LOGO_BASE_FAN}/CCTV卫生健康.png`,
    alias: ["CCTV卫生健康", "CCTV 卫生健康", "卫生健康", "央视卫生健康"],
    epgId: "cctv_health"
  },
  {
    keywords: ["cctv老故事", "老故事", "央视老故事"],
    standardName: "CCTV 老故事",
    category: "央视频道",
    categoryList: ["央视频道", "新闻纪实"],
    logo: `${LOGO_BASE_FAN}/CCTV老故事.png`,
    alias: ["CCTV老故事", "CCTV 老故事", "老故事", "央视老故事"],
    epgId: "cctv_oldstory"
  },
  {
    keywords: ["cctv新科动漫", "新科动漫", "央视新科动漫"],
    standardName: "CCTV 新科动漫",
    category: "央视频道",
    categoryList: ["央视频道", "少儿动画"],
    logo: `${LOGO_BASE_FAN}/CCTV新科动漫.png`,
    alias: ["CCTV新科动漫", "CCTV 新科动漫", "新科动漫", "央视新科动漫"],
    epgId: "cctv_xinke"
  },
  {
    keywords: ["cctv证券资讯", "证券资讯", "央视证券资讯"],
    standardName: "CCTV 证券资讯",
    category: "央视频道",
    categoryList: ["央视频道", "财经资讯"],
    logo: `${LOGO_BASE_FAN}/CCTV证券资讯.png`,
    alias: ["CCTV证券资讯", "CCTV 证券资讯", "证券资讯", "央视证券资讯"],
    epgId: "cctv_stock"
  },
  {
    keywords: ["chc高清电影", "chc高清", "chc 高清电影"],
    standardName: "CHC 高清电影",
    category: "央视频道",
    categoryList: ["央视频道", "影视剧场"],
    logo: `${LOGO_BASE_FAN}/CHC高清电影.png`,
    alias: ["CHC 高清电影", "CHC高清电影", "CHC高清"],
    epgId: "chc_hd"
  },
  {
    keywords: ["chc动作电影", "chc动作", "chc 动作电影"],
    standardName: "CHC 动作电影",
    category: "央视频道",
    categoryList: ["央视频道", "影视剧场"],
    logo: `${LOGO_BASE_FAN}/CHC动作电影.png`,
    alias: ["CHC 动作电影", "CHC动作电影", "CHC动作"],
    epgId: "chc_action"
  },
  {
    keywords: ["chc家庭影院", "chc家庭", "chc 家庭影院"],
    standardName: "CHC 家庭影院",
    category: "央视频道",
    categoryList: ["央视频道", "影视剧场"],
    logo: `${LOGO_BASE_FAN}/CHC家庭影院.png`,
    alias: ["CHC 家庭影院", "CHC家庭影院"],
    epgId: "chc_family"
  },
  {
    keywords: ["cgtn", "cgtn英语", "cgtn英语新闻", "cgtn news", "cgtn english", "cgtn en", "cgtn1"],
    standardName: "CGTN 英语新闻",
    category: "央视频道",
    categoryList: ["央视频道", "国际新闻"],
    logo: `${LOGO_BASE_FAN}/CGTN.png`,
    alias: ["CGTN", "CGTN News", "CGTN 英语", "CGTN 英语新闻", "中国环球电视网", "CGTN English"],
    epgId: "cgtn"
  },
  {
    keywords: ["cgtn纪录", "cgtn记录", "cgtn doc", "cgtn documentary", "cgtn纪实", "cgtn纪录频道", "cgtn记录频道"],
    standardName: "CGTN 纪录频道",
    category: "央视频道",
    categoryList: ["央视频道", "纪实地理"],
    logo: `${LOGO_BASE_FAN}/CGTNDocumentary.png`,
    alias: ["CGTN 纪录", "CGTN 记录", "CGTN Documentary", "CGTN Doc", "CGTN 纪录频道", "CGTN 记录频道"],
    epgId: "cgtndoc"
  },
  {
    keywords: ["cgtn法语", "cgtn french", "cgtn francais", "cgtn français", "cgtn法语频道", "cgtn法文"],
    standardName: "CGTN 法语频道",
    category: "央视频道",
    categoryList: ["央视频道", "国际频道"],
    logo: `${LOGO_BASE_FAN}/CGTNFrench.png`,
    alias: ["CGTN 法语", "CGTN 法语频道", "CGTN French", "CGTN Français", "CGTN-Français", "CGTN-F", "CGTN法语"],
    epgId: "cgtnfrench"
  },
  {
    keywords: ["cgtn俄语", "cgtn russian", "cgtn русский", "cgtn俄语频道", "cgtn俄文"],
    standardName: "CGTN 俄语频道",
    category: "央视频道",
    categoryList: ["央视频道", "国际频道"],
    logo: `${LOGO_BASE_FAN}/CGTNRussian.png`,
    alias: ["CGTN 俄语", "CGTN 俄语频道", "CGTN Russian", "CGTN Русский", "CGTN-Russian", "CGTN-R", "CGTN俄语"],
    epgId: "cgtnrussian"
  },
  {
    keywords: ["cgtn西语", "cgtn西班牙语", "cgtn spanish", "cgtn espanol", "cgtn español", "cgtn西语频道", "cgtn西班牙语频道", "cgtn西文"],
    standardName: "CGTN 西班牙语频道",
    category: "央视频道",
    categoryList: ["央视频道", "国际频道"],
    logo: `${LOGO_BASE_FAN}/CGTNSpanish.png`,
    alias: ["CGTN 西语", "CGTN 西班牙语", "CGTN 西语频道", "CGTN Spanish", "CGTN Español", "CGTN-Spanish", "CGTN-E", "CGTN西语"],
    epgId: "cgtnspanish"
  },
  {
    keywords: ["cgtn阿语", "cgtn阿拉伯语", "cgtn arabic", "cgtn العربية", "cgtn阿语频道", "cgtn阿拉伯语频道", "cgtn阿文"],
    standardName: "CGTN 阿拉伯语频道",
    category: "央视频道",
    categoryList: ["央视频道", "国际频道"],
    logo: `${LOGO_BASE_FAN}/CGTNArabic.png`,
    alias: ["CGTN 阿语", "CGTN 阿拉伯语", "CGTN 阿语频道", "CGTN Arabic", "CGTN العربية", "CGTN-Arabic", "CGTN-A", "CGTN阿语"],
    epgId: "cgtnarabic"
  },

  // === 卫视频道 (Provincial Satellite TV) ===
  {
    keywords: ["湖南卫视", "芒果台", "hnws", "hunan tv", "湖南台"],
    standardName: "湖南卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/湖南卫视.png`,
    alias: ["湖南卫视", "湖南台", "芒果台", "湖南卫视HD", "湖南卫视 1080P", "Hunan TV"],
    epgId: "hunantv"
  },
  {
    keywords: ["浙江卫视", "蓝莓台", "zjws", "zhejiang tv", "浙江台"],
    standardName: "浙江卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/浙江卫视.png`,
    alias: ["浙江卫视", "浙江台", "中国蓝", "浙江卫视HD", "Zhejiang TV"],
    epgId: "zhejiangtv"
  },
  {
    keywords: ["江苏卫视", "荔枝台", "jsws", "jiangsu tv", "江苏台"],
    standardName: "江苏卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/江苏卫视.png`,
    alias: ["江苏卫视", "江苏台", "荔枝台", "江苏卫视HD", "Jiangsu TV"],
    epgId: "jiangsutv"
  },
  {
    keywords: ["东方卫视", "番茄台", "dfws", "dongfang tv", "上海卫视", "上海东方卫视"],
    standardName: "东方卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/东方卫视.png`,
    alias: ["东方卫视", "上海卫视", "番茄台", "东方卫视HD", "Dragon TV", "上海东方卫视"],
    epgId: "dongfangtv"
  },
  {
    keywords: ["北京卫视", "bjws", "beijing tv", "北京台卫视", "BTV卫视"],
    standardName: "北京卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/北京卫视.png`,
    alias: ["北京卫视", "北京台", "BTV卫视", "北京卫视HD", "Beijing TV"],
    epgId: "beijingtv"
  },
  {
    keywords: ["广东卫视", "gdws", "guangdong tv", "广东台卫视"],
    standardName: "广东卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/广东卫视.png`,
    alias: ["广东卫视", "广东台", "广东卫视HD", "Guangdong TV"],
    epgId: "guangdongtv"
  },
  {
    keywords: ["深圳卫视", "szws", "shenzhen tv", "深圳台卫视"],
    standardName: "深圳卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/深圳卫视.png`,
    alias: ["深圳卫视", "深圳台", "深圳卫视HD", "Shenzhen TV"],
    epgId: "shenzhentv"
  },
  {
    keywords: ["山东卫视", "sdws", "shandong tv", "山东台卫视"],
    standardName: "山东卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/山东卫视.png`,
    alias: ["山东卫视", "山东台", "山东卫视HD", "Shandong TV"],
    epgId: "shandongtv"
  },
  {
    keywords: ["安徽卫视", "ahws", "anhui tv", "安徽台卫视", "海豚台"],
    standardName: "安徽卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/安徽卫视.png`,
    alias: ["安徽卫视", "安徽台", "海豚台", "安徽卫视HD", "Anhui TV"],
    epgId: "anhuitv"
  },
  {
    keywords: ["天津卫视", "tjws", "tianjin tv", "天津台卫视"],
    standardName: "天津卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/天津卫视.png`,
    alias: ["天津卫视", "天津台", "天津卫视HD", "Tianjin TV"],
    epgId: "tianjintv"
  },
  {
    keywords: ["重庆卫视", "cqws", "chongqing tv", "重庆台卫视"],
    standardName: "重庆卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/重庆卫视.png`,
    alias: ["重庆卫视", "重庆台", "重庆卫视HD", "Chongqing TV"],
    epgId: "chongqingtv"
  },
  {
    keywords: ["四川卫视", "scws", "sichuan tv", "四川台卫视"],
    standardName: "四川卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/四川卫视.png`,
    alias: ["四川卫视", "四川台", "四川卫视HD", "Sichuan TV"],
    epgId: "sichuantv"
  },
  {
    keywords: ["河南卫视", "hnws_he", "henan tv", "河南台卫视"],
    standardName: "河南卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/河南卫视.png`,
    alias: ["河南卫视", "河南台", "河南卫视HD", "Henan TV"],
    epgId: "henantv"
  },
  {
    keywords: ["湖北卫视", "hbws", "hubei tv", "湖北台卫视"],
    standardName: "湖北卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/湖北卫视.png`,
    alias: ["湖北卫视", "湖北台", "湖北卫视HD", "Hubei TV"],
    epgId: "hubeitv"
  },
  {
    keywords: ["江西卫视", "jxws", "jiangxi tv", "江西台卫视"],
    standardName: "江西卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/江西卫视.png`,
    alias: ["江西卫视", "江西台", "江西卫视HD", "Jiangxi TV"],
    epgId: "jiangxitv"
  },
  {
    keywords: ["辽宁卫视", "lnws", "liaoning tv", "辽宁台卫视"],
    standardName: "辽宁卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/辽宁卫视.png`,
    alias: ["辽宁卫视", "辽宁台", "辽宁卫视HD", "Liaoning TV"],
    epgId: "liaoningtv"
  },
  {
    keywords: ["黑龙江卫视", "hljws", "heilongjiang tv", "黑龙江台卫视"],
    standardName: "黑龙江卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/黑龙江卫视.png`,
    alias: ["黑龙江卫视", "黑龙江台", "黑龙江卫视HD", "Heilongjiang TV"],
    epgId: "heilongjiangtv"
  },
  {
    keywords: ["河北卫视", "hebei tv", "河北台卫视"],
    standardName: "河北卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/河北卫视.png`,
    alias: ["河北卫视", "河北台", "河北卫视HD", "Hebei TV"],
    epgId: "hebeitv"
  },
  {
    keywords: ["东南卫视", "dnws", "dongnan tv", "福建东南卫视"],
    standardName: "东南卫视",
    category: "卫视频道",
    categoryList: ["卫视频道", "省级卫视"],
    logo: `${LOGO_BASE_FAN}/东南卫视.png`,
    alias: ["东南卫视", "福建东南卫视", "东南卫视HD", "Dongnan TV"],
    epgId: "dongnantv"
  },

  // === 港澳台频道 (Hong Kong, Macau & Taiwan) ===
  {
    keywords: ["民视", "民视无线台", "ftv", "民视无线", "民视1", "民视综合", "民视主频", "民视hd"],
    standardName: "民视",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道"],
    logo: `${LOGO_BASE_112}/民视.png`,
    alias: ["民视", "民视无线台", "民视综合", "FTV", "民视HD", "民视 1080P", "民视无线", "民视主频"],
    epgId: "ftv"
  },
  {
    keywords: ["台视", "台视主频", "ttv", "台湾电视", "台视综合", "台湾电视台", "台视hd"],
    standardName: "台视",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道"],
    logo: `${LOGO_BASE_112}/台视.png`,
    alias: ["台视", "台视主频", "台湾电视", "TTV", "台视HD", "台视综合", "台湾电视台"],
    epgId: "ttv"
  },
  {
    keywords: ["中视", "中视主频", "中视综合", "中视hd", "台湾中视", "中国电视公司"],
    standardName: "中视",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道"],
    logo: `${LOGO_BASE_112}/中视.png`,
    alias: ["中视", "中视主频", "台湾中视", "中视HD", "中视综合", "中国电视公司"],
    epgId: "ctv"
  },
  {
    keywords: ["华视闽南频道", "华视闽南", "华视台语", "cts minnan"],
    standardName: "华视闽南频道",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道"],
    logo: `${LOGO_BASE_112}/华视.png`,
    alias: ["华视闽南频道", "华视闽南", "华视台语台", "CTS Minnan", "华视闽南台"],
    epgId: "cts_minnan"
  },
  {
    keywords: ["华视", "华视主频", "cts", "中华电视", "华视综合", "华视hd"],
    standardName: "华视",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道"],
    logo: `${LOGO_BASE_112}/华视.png`,
    alias: ["华视", "华视主频", "中华电视", "CTS", "华视HD", "华视综合"],
    epgId: "cts"
  },
  {
    keywords: ["公视", "公共电视", "pts", "公视主频", "公视hd", "公视1台", "公视1"],
    standardName: "公视",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道"],
    logo: `${LOGO_BASE_112}/公视.png`,
    alias: ["公视", "公视主频", "公共电视", "PTS", "公视HD"],
    epgId: "pts"
  },
  {
    keywords: ["tvbs新闻", "tvbs-n", "tvbs news", "tvbs新闻台"],
    standardName: "TVBS 新闻台",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道", "新闻资讯"],
    logo: `${LOGO_BASE_112}/TVBS新闻.png`,
    alias: ["TVBS新闻", "TVBS 新闻台", "TVBS News", "TVBS-N", "TVBS新闻HD"],
    epgId: "tvbs_news"
  },
  {
    keywords: ["tvbs", "tvbs无线台", "tvbs主频", "tvbs欢乐台"],
    standardName: "TVBS 欢乐台",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道", "影视综艺"],
    logo: `${LOGO_BASE_112}/TVBS.png`,
    alias: ["TVBS", "TVBS欢乐台", "TVBS 欢乐台", "TVBS HD"],
    epgId: "tvbs"
  },
  {
    keywords: ["中天新闻", "ctitv news", "中天新闻台"],
    standardName: "中天新闻台",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道", "新闻资讯"],
    logo: `${LOGO_BASE_112}/中天新闻.png`,
    alias: ["中天新闻", "中天新闻台", "中天电视", "CTi News", "中天新闻HD"],
    epgId: "cti_news"
  },
  {
    keywords: ["东森新闻", "ebc news", "东森新闻台"],
    standardName: "东森新闻台",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道", "新闻资讯"],
    logo: `${LOGO_BASE_112}/东森新闻.png`,
    alias: ["东森新闻", "东森新闻台", "EBC News", "东森新闻HD"],
    epgId: "ebc_news"
  },
  {
    keywords: ["东森电影", "ebc movie", "东森电影台"],
    standardName: "东森电影台",
    category: "港澳台",
    categoryList: ["港澳台", "台湾频道", "影视剧场"],
    logo: `${LOGO_BASE_112}/东森电影.png`,
    alias: ["东森电影", "东森电影台", "EBC Movie", "东森电影HD"],
    epgId: "ebc_movie"
  },
  {
    keywords: ["翡翠台", "tvb翡翠台", "jade", "tvb jade", "无线翡翠台"],
    standardName: "TVB 翡翠台",
    category: "港澳台",
    categoryList: ["港澳台", "香港频道", "影视综艺"],
    logo: `${LOGO_BASE_FAN}/翡翠台.png`,
    alias: ["翡翠台", "TVB 翡翠台", "TVB Jade", "无线翡翠台", "翡翠台HD"],
    epgId: "jade"
  },
  {
    keywords: ["明珠台", "tvb明珠台", "pearl", "tvb pearl", "无线明珠台"],
    standardName: "TVB 明珠台",
    category: "港澳台",
    categoryList: ["港澳台", "香港频道", "国际新闻"],
    logo: `${LOGO_BASE_FAN}/明珠台.png`,
    alias: ["明珠台", "TVB 明珠台", "TVB Pearl", "无线明珠台", "明珠台HD"],
    epgId: "pearl"
  },
  {
    keywords: ["凤凰卫视中文台", "凤凰中文", "凤凰卫视", "phoenix chinese", "凤凰中文台"],
    standardName: "凤凰卫视中文台",
    category: "港澳台",
    categoryList: ["港澳台", "新闻资讯"],
    logo: `${LOGO_BASE_FAN}/凤凰中文.png`,
    alias: ["凤凰卫视", "凤凰卫视中文台", "凤凰中文", "Phoenix Chinese", "凤凰中文HD"],
    epgId: "phoenix_chinese"
  },
  {
    keywords: ["凤凰卫视资讯台", "凤凰资讯", "凤凰新闻", "phoenix info", "凤凰资讯台"],
    standardName: "凤凰卫视资讯台",
    category: "港澳台",
    categoryList: ["港澳台", "新闻资讯"],
    logo: `${LOGO_BASE_FAN}/凤凰资讯.png`,
    alias: ["凤凰资讯", "凤凰卫视资讯台", "凤凰资讯台", "Phoenix InfoNews", "凤凰资讯HD"],
    epgId: "phoenix_info"
  },
  {
    keywords: ["凤凰卫视香港台", "凤凰香港", "phoenix hk", "凤凰香港台"],
    standardName: "凤凰卫视香港台",
    category: "港澳台",
    categoryList: ["港澳台", "香港频道"],
    logo: `${LOGO_BASE_FAN}/凤凰香港.png`,
    alias: ["凤凰香港", "凤凰卫视香港台", "凤凰香港台", "Phoenix Hong Kong"],
    epgId: "phoenix_hk"
  },
  {
    keywords: ["澳视澳门", "tdm macau", "澳广视", "澳门电视台"],
    standardName: "澳视澳门",
    category: "港澳台",
    categoryList: ["港澳台", "澳门频道"],
    logo: `${LOGO_BASE_112}/澳视澳门.png`,
    alias: ["澳视澳门", "澳广视", "TDM Macau", "澳视澳门HD"],
    epgId: "tdm_macau"
  },
  {
    keywords: ["莲花卫视", "macau lotus", "澳门莲花卫视"],
    standardName: "澳门莲花卫视",
    category: "港澳台",
    categoryList: ["港澳台", "澳门频道"],
    logo: `${LOGO_BASE_112}/莲花卫视.png`,
    alias: ["莲花卫视", "澳门莲花卫视", "Macau Lotus TV"],
    epgId: "lotustv"
  },

  // === 体育与少儿专区 (Sports & Kids) ===
  {
    keywords: ["咪咕体育", "migu sports", "咪咕视频体育"],
    standardName: "咪咕体育",
    category: "体育专区",
    categoryList: ["体育专区", "赛事直播"],
    logo: `${LOGO_BASE_112}/咪咕体育.png`,
    alias: ["咪咕体育", "Migu Sports", "咪咕体育HD"],
    epgId: "migu_sports"
  },
  {
    keywords: ["五星体育", "上海五星体育", "great sports"],
    standardName: "五星体育",
    category: "体育专区",
    categoryList: ["体育专区", "地方频道"],
    logo: `${LOGO_BASE_FAN}/五星体育.png`,
    alias: ["五星体育", "上海五星体育", "Great Sports", "五星体育HD"],
    epgId: "wuxingtiyu"
  },
  {
    keywords: ["广东体育", "广体", "guangdong sports"],
    standardName: "广东体育",
    category: "体育专区",
    categoryList: ["体育专区", "地方频道"],
    logo: `${LOGO_BASE_FAN}/广东体育.png`,
    alias: ["广东体育", "广体", "广东体育HD", "Guangdong Sports"],
    epgId: "guangdongtiyu"
  },
  {
    keywords: ["金鹰卡通", "金鹰少儿", "aniworld", "湖南金鹰卡通"],
    standardName: "金鹰卡通",
    category: "少儿动画",
    categoryList: ["少儿动画", "卫视频道"],
    logo: `${LOGO_BASE_FAN}/金鹰卡通.png`,
    alias: ["金鹰卡通", "金鹰少儿", "Aniworld", "金鹰卡通HD", "湖南金鹰卡通"],
    epgId: "jinyingkatong"
  },
  {
    keywords: ["卡酷少儿", "北京卡酷", "kaku", "卡酷动画"],
    standardName: "卡酷少儿",
    category: "少儿动画",
    categoryList: ["少儿动画", "卫视频道"],
    logo: `${LOGO_BASE_FAN}/卡酷少儿.png`,
    alias: ["卡酷少儿", "卡酷动画", "北京卡酷少儿", "KAKU", "卡酷少儿HD"],
    epgId: "kakushaoer"
  },
  {
    keywords: ["嘉佳卡通", "广东嘉佳卡通", "jiajia cartoon"],
    standardName: "嘉佳卡通",
    category: "少儿动画",
    categoryList: ["少儿动画", "卫视频道"],
    logo: `${LOGO_BASE_FAN}/嘉佳卡通.png`,
    alias: ["嘉佳卡通", "广东嘉佳卡通", "嘉佳卡通HD", "Jiajia Cartoon"],
    epgId: "jiajiakatong"
  }
];

// Helper to extract exact CCTV channel identifier (prevents substring conflicts like CCTV-13 matching CCTV-1)
function extractCctvKey(clean: string): string | null {
  const isCctvExplicit = /^(?:cctv|中央|央视)/i.test(clean);

  // Check CCTV Specialty Channels
  if (/(?:cctv|央视|中央)[-_\s]*电视指南|电视指南/i.test(clean) && (isCctvExplicit || clean === "电视指南" || clean === "电视指南频道")) return "cctv_guide";
  if (/(?:cctv|央视|中央)[-_\s]*(?:央视)?文化精品|文化精品/i.test(clean) && (isCctvExplicit || clean === "文化精品" || clean === "文化精品频道")) return "cctv_culture";
  if (/(?:cctv|央视|中央)[-_\s]*女性时尚|女性时尚/i.test(clean) && (isCctvExplicit || clean === "女性时尚" || clean === "女性时尚频道")) return "cctv_female";
  if (/(?:cctv|央视|中央)[-_\s]*兵器科技|兵器科技/i.test(clean) && (isCctvExplicit || clean === "兵器科技" || clean === "兵器科技频道")) return "cctv_weapon";
  if (/(?:cctv|央视|中央)[-_\s]*(?:央视)?台球|央视台球/i.test(clean)) return "cctv_billiards";
  if (/(?:cctv|央视|中央)[-_\s]*风云足球|风云足球/i.test(clean) && (isCctvExplicit || clean === "风云足球" || clean === "风云足球频道")) return "cctv_soccer";
  if (/(?:cctv|央视|中央)[-_\s]*风云剧场|风云剧场/i.test(clean) && (isCctvExplicit || clean === "风云剧场" || clean === "风云剧场频道")) return "cctv_fyjc";
  if (/(?:cctv|央视|中央)[-_\s]*第一剧场|第一剧场/i.test(clean) && (isCctvExplicit || clean === "第一剧场" || clean === "第一剧场频道")) return "cctv_dyjc";
  if (/(?:cctv|央视|中央)[-_\s]*怀旧剧场|怀旧剧场/i.test(clean) && (isCctvExplicit || clean === "怀旧剧场" || clean === "怀旧剧场频道")) return "cctv_hjjc";
  if (/(?:cctv|央视|中央)[-_\s]*风云音乐|风云音乐/i.test(clean) && (isCctvExplicit || clean === "风云音乐" || clean === "风云音乐频道")) return "cctv_fyyd";
  if (/(?:cctv|央视|中央)[-_\s]*高尔夫/i.test(clean)) return "cctv_golf";
  if (/(?:cctv|央视|中央)[-_\s]*世界地理|世界地理/i.test(clean) && (isCctvExplicit || clean === "世界地理" || clean === "世界地理频道")) return "cctv_geo";
  if (/(?:cctv|央视|中央)[-_\s]*发现之旅|发现之旅/i.test(clean) && (isCctvExplicit || clean === "发现之旅" || clean === "发现之旅频道")) return "cctv_discovery";
  if (/(?:cctv|央视|中央)[-_\s]*中学生/i.test(clean)) return "cctv_student";
  if (/(?:cctv|央视|中央)[-_\s]*卫生健康|卫生健康/i.test(clean) && (isCctvExplicit || clean === "卫生健康" || clean === "卫生健康频道")) return "cctv_health";
  if (/(?:cctv|央视|中央)[-_\s]*老故事|老故事/i.test(clean) && (isCctvExplicit || clean === "老故事" || clean === "老故事频道")) return "cctv_oldstory";
  if (/(?:cctv|央视|中央)[-_\s]*新科动漫|新科动漫/i.test(clean) && (isCctvExplicit || clean === "新科动漫" || clean === "新科动漫频道")) return "cctv_xinke";
  if (/(?:cctv|央视|中央)[-_\s]*证券资讯|证券资讯/i.test(clean) && (isCctvExplicit || clean === "证券资讯" || clean === "证券资讯频道")) return "cctv_stock";

  // CHC channels
  if (/chc[-_\s]*高清/i.test(clean)) return "chc_hd";
  if (/chc[-_\s]*动作/i.test(clean)) return "chc_action";
  if (/chc[-_\s]*家庭/i.test(clean)) return "chc_family";

  // Check explicit 5+ / 5plus / 体育赛事
  if (/(?:cctv[-_\s]*(?:5\+|5plus)|中央五\+|中央5\+|央视五\+|央视5\+|央视体育赛事)/i.test(clean)) {
    return "cctv5plus";
  }
  // Check 4K / 8K
  if (/(?:cctv[-_\s]*4k|中央4k|央视4k)/i.test(clean)) return "cctv4k";
  if (/(?:cctv[-_\s]*8k|中央8k|央视8k)/i.test(clean)) return "cctv8k";

  // Check CCTV-4 regional editions (Europe / America / Asia)
  if (/(?:cctv[-_\s]*4|中央4|央视4|中央四|央视四|中文国际)/i.test(clean)) {
    if (/(?:欧洲|europe|eu|eur|ouzhou)/i.test(clean)) return "cctv4europe";
    if (/(?:美洲|america|us|ame|meizhou)/i.test(clean)) return "cctv4america";
    return "cctv4";
  }

  // Check CCTV named channels - MUST require explicit CCTV / 央视 / 中央 identifier
  if (/(?:央视新闻|cctv[-_\s]*新闻|中央电视台新闻)/i.test(clean)) return "cctv13";
  if (/(?:央视少儿|cctv[-_\s]*少儿|中央电视台少儿)/i.test(clean)) return "cctv14";
  if (/(?:央视奥林匹克|cctv[-_\s]*奥林匹克|cctv[-_\s]*奥运|央视奥运)/i.test(clean)) return "cctv16";
  if (/(?:央视农业|cctv[-_\s]*农业|央视农村|cctv[-_\s]*农村)/i.test(clean)) return "cctv17";
  if (/(?:央视社会与法|cctv[-_\s]*社会与法|央视法制|cctv[-_\s]*法制)/i.test(clean)) return "cctv12";
  if (/(?:央视国防军事|央视军事|cctv[-_\s]*国防军事|cctv[-_\s]*军事)/i.test(clean)) return "cctv7";
  if (/(?:央视科教|cctv[-_\s]*科教|中央电视台科教)/i.test(clean)) return "cctv10";
  if (/(?:央视戏曲|cctv[-_\s]*戏曲|中央电视台戏曲)/i.test(clean)) return "cctv11";
  if (/(?:央视音乐|cctv[-_\s]*音乐|中央电视台音乐)/i.test(clean)) return "cctv15";
  if (/(?:央视纪录|cctv[-_\s]*纪录|中央电视台纪录|央视记录|cctv[-_\s]*记录)/i.test(clean)) return "cctv9";
  if (/(?:央视财经|cctv[-_\s]*财经|中央电视台财经)/i.test(clean)) return "cctv2";
  if (/(?:央视综艺|cctv[-_\s]*综艺|中央电视台综艺)/i.test(clean)) return "cctv3";
  if (/(?:央视电视剧|cctv[-_\s]*电视剧|中央电视台电视剧)/i.test(clean)) return "cctv8";
  if (/(?:央视电影|cctv[-_\s]*电影|中央电视台电影)/i.test(clean)) return "cctv6";
  if (/(?:央视综合|cctv[-_\s]*综合|中央电视台综合)/i.test(clean)) return "cctv1";

  // Check digit numbers: MUST check 10..17 before 1..9 to avoid prefix collisions!
  const numMatch = clean.match(/(?:cctv|中央|央视)[-_\s]*(1[0-7]|[1-9])\b/i) || clean.match(/(?:cctv|中央|央视)[-_\s]*(1[0-7]|[1-9])(?:套|台|频道)?/i);
  if (numMatch) {
    return `cctv${numMatch[1]}`;
  }

  // Check Chinese numeral numbers: MUST check 十七..十 before 一..九
  const cnPairs: [string, string][] = [
    ["十七", "cctv17"],
    ["十六", "cctv16"],
    ["十五", "cctv15"],
    ["十四", "cctv14"],
    ["十三", "cctv13"],
    ["十二", "cctv12"],
    ["十一", "cctv11"],
    ["十", "cctv10"],
    ["九", "cctv9"],
    ["八", "cctv8"],
    ["七", "cctv7"],
    ["六", "cctv6"],
    ["五", "cctv5"],
    ["四", "cctv4"],
    ["三", "cctv3"],
    ["二", "cctv2"],
    ["一", "cctv1"]
  ];

  for (const [cn, epg] of cnPairs) {
    const reg = new RegExp(`(?:cctv|中央|央视)[-_\\s]*${cn}(?:套|台|频道)?`, "i");
    if (reg.test(clean)) {
      return epg;
    }
  }

  return null;
}

// Helper to extract exact CGTN language channel identifier (prevents all CGTN channels from defaulting to English)
function extractCgtnKey(clean: string): string | null {
  if (!clean.includes("cgtn") && !clean.includes("环球电视")) return null;

  if (/(?:法语|french|francais|français|法文)/i.test(clean)) return "cgtnfrench";
  if (/(?:俄语|russian|русский|俄文)/i.test(clean)) return "cgtnrussian";
  if (/(?:西语|西班牙语|spanish|espanol|español|西文)/i.test(clean)) return "cgtnspanish";
  if (/(?:阿语|阿拉伯语|arabic|العربية|阿文)/i.test(clean)) return "cgtnarabic";
  if (/(?:纪录|记录|doc|documentary|纪实)/i.test(clean)) return "cgtndoc";
  if (/(?:英语|新闻|en|news|english|英文)/i.test(clean)) return "cgtn";

  // If simply "cgtn" or "中国环球电视网" without specific other language words
  if (/^cgtn(?:news)?$/i.test(clean) || clean === "中国环球电视网") return "cgtn";

  return null;
}

// Comprehensive clean and identifier extractor for channels
export function cleanChannelRawName(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/\[[^\]]*\]|\([^\)]*\)|（[^）]*）|【[^】]*】/g, " ")
    .replace(/(?:电信|联通|移动|广电|华数|BGP|专线|IPTV|回看|回放|测试|备用|直播|主频|线路\d*|源\d*)/gi, " ")
    .replace(/(?:1080[pP]|720[pP]|4[kK]|8[kK]|[hH][dD]|[fF][hH][dD]|[uU][hH][dD]|超清|高清|标清|蓝光|原画|HEVC|H\.?26[45]|60fps|50fps|IPV[46])/gi, " ")
    .replace(/[\s\-_]+/g, " ")
    .trim();
}

// Fallback search in builtin channel database with deep fuzzy matching
export function matchBuiltinChannel(rawName: string): StandardChannelInfo | null {
  if (!rawName || typeof rawName !== "string") return null;

  const rawClean = cleanChannelRawName(rawName);
  const clean = (rawClean || rawName).toLowerCase().replace(/[\s\-_[\]()（）]/g, "").trim();
  if (!clean) return null;

  const isCctvOrNational = /cctv|中央|央视|cgtn|cetv/i.test(clean);

  // 1. CCTV & National TV Exact Match by Identifier
  const cctvKey = extractCctvKey(clean) || extractCctvKey(rawName.toLowerCase().replace(/[\s\-_]/g, ""));
  if (cctvKey) {
    const cctvItem = BUILTIN_CHANNEL_KNOWLEDGE.find(i => i.epgId === cctvKey);
    if (cctvItem) return cctvItem;
  }

  // 2. CGTN Specific Language Channel Match by Identifier
  const cgtnKey = extractCgtnKey(clean) || extractCgtnKey(rawName.toLowerCase().replace(/[\s\-_]/g, ""));
  if (cgtnKey) {
    const cgtnItem = BUILTIN_CHANNEL_KNOWLEDGE.find(i => i.epgId === cgtnKey);
    if (cgtnItem) return cgtnItem;
  }

  // 3. Strict Exact match on standard name or aliases or keywords
  for (const item of BUILTIN_CHANNEL_KNOWLEDGE) {
    // If input is CCTV, do NOT match non-央视 item
    if (isCctvOrNational && item.category !== "央视频道") continue;
    // If input is not CCTV, do NOT match CCTV item unless exact match
    if (!isCctvOrNational && item.category === "央视频道") {
      const itemClean = item.standardName.toLowerCase().replace(/[\s\-_[\]()（）]/g, "");
      if (itemClean !== clean) continue;
    }

    const itemClean = item.standardName.toLowerCase().replace(/[\s\-_[\]()（）]/g, "");
    if (itemClean === clean) {
      return item;
    }
    for (const a of item.alias) {
      const aClean = a.toLowerCase().replace(/[\s\-_[\]()（）]/g, "");
      if (aClean === clean) {
        return item;
      }
    }
    for (const kw of item.keywords) {
      const kwClean = kw.toLowerCase().replace(/[\s\-_[\]()（）]/g, "");
      if (clean === kwClean) {
        return item;
      }
    }
  }

  // 4. Provincial TV / Distinct Brand match (e.g. 湖南卫视, 翡翠台, 民视无线台)
  const genericBannedTerms = new Set([
    "新闻", "综合", "科教", "少儿", "影视", "都市", "生活", "公共", "法治", "经济", 
    "体育", "国际", "电影", "电视剧", "纪录", "音乐", "戏曲", "ctv", "cts", "pts", "ttv",
    "新闻频道", "科教频道", "少儿频道", "影视剧场", "体育专区", "电视剧频道", "电影频道"
  ]);

  for (const item of BUILTIN_CHANNEL_KNOWLEDGE) {
    if (isCctvOrNational && item.category !== "央视频道") continue;
    if (!isCctvOrNational && item.category === "央视频道") continue;

    const itemClean = item.standardName.toLowerCase().replace(/[\s\-_[\]()（）]/g, "");
    if (itemClean.length >= 3 && !genericBannedTerms.has(itemClean) && clean.includes(itemClean)) {
      return item;
    }
    for (const a of item.alias) {
      const aClean = a.toLowerCase().replace(/[\s\-_[\]()（）]/g, "");
      if (
        aClean.length >= 4 && 
        !genericBannedTerms.has(aClean) &&
        !aClean.startsWith("cctv") && 
        !aClean.startsWith("中央") && 
        !aClean.startsWith("cgtn") && 
        clean.includes(aClean)
      ) {
        return item;
      }
    }
  }

  return null;
}

// Built-in rule deduction for unlisted channels (e.g., local stations like "北京新闻", "广州综合")
export function deduceChannelRule(rawName: string): ChannelSuggestion {
  const builtin = matchBuiltinChannel(rawName);
  if (builtin) {
    return {
      standardName: builtin.standardName,
      suggestedCategory: builtin.category,
      suggestedCategoryList: builtin.categoryList,
      logo: resolveChannelLogo(builtin.logo),
      alias: Array.from(new Set([rawName.trim(), builtin.standardName, ...builtin.alias])),
      epgId: builtin.epgId,
      confidence: 0.99,
      reason: `匹配到内置权威电视频道库: ${builtin.standardName} (${builtin.category})`
    };
  }

  // Clean rawName for deduction
  let cleanName = cleanChannelRawName(rawName);
  if (!cleanName) cleanName = rawName.trim();

  const isCctvOrSat = /cctv|中央|央视|cgtn|cetv|卫视/i.test(cleanName);
  const geoInfo = detectProvinceAndIspFromName(rawName);
  const detectedProvince = geoInfo.detectedProvince;

  // Detect Category
  let category = "其它频道";
  let categoryList = ["其它频道"];
  const epgIdCandidate = cleanName.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (/cctv|中央|央视|cgtn|cetv/i.test(cleanName)) {
    category = "央视频道";
    categoryList = ["央视频道"];
  } else if (/卫视|凤凰/i.test(cleanName)) {
    category = "卫视频道";
    categoryList = ["卫视频道"];
  } else if (/民视|台视|中视|华视|公视|tvb|翡翠|明珠|东森|三立|中天|年代|纬来|八大|澳视|莲花|港台|viu|hoy/i.test(cleanName)) {
    category = "港澳台";
    categoryList = ["港澳台"];
  } else if (detectedProvince && detectedProvince !== "全国") {
    category = "地方频道";
    categoryList = ["地方频道", `${detectedProvince}地方`];
  } else if (/体育|足球|篮球|网球|高尔夫|乒羽|赛车|钓鱼|nba|cba/i.test(cleanName)) {
    category = "体育专区";
    categoryList = ["体育专区"];
  } else if (/电影|影院|剧场|剧集|影视频道|经典影视|大片/i.test(cleanName)) {
    category = "影视剧场";
    categoryList = ["影视剧场"];
  } else if (/少儿|卡通|动漫|动画|宝贝|幼幼|卡酷|金鹰|炫动|优漫/i.test(cleanName)) {
    category = "少儿动画";
    categoryList = ["少儿动画"];
  } else if (/新闻|资讯|纪实|纪录|地理|探索|发现/i.test(cleanName)) {
    category = "新闻纪实";
    categoryList = ["新闻纪实"];
  } else if (/北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|内蒙古|广西|西藏|宁夏|新疆|广州|深圳|成都|武汉|杭州|南京|沈阳|大连|青岛|宁波|厦门|珠江/i.test(cleanName)) {
    category = "地方频道";
    categoryList = ["地方频道"];
  }

  const base = isCctvOrSat ? getLogoBaseFan() : getLogoBase112();
  const defaultLogo = `${base}/${encodeURIComponent(cleanName)}.png`;
  const aliases = Array.from(new Set([rawName.trim(), cleanName]));

  return {
    standardName: cleanName,
    suggestedCategory: category,
    suggestedCategoryList: categoryList,
    logo: defaultLogo,
    alias: aliases,
    epgId: epgIdCandidate || "tv",
    description: deduceDetailedChannelDescription(cleanName, categoryList, epgIdCandidate),
    confidence: detectedProvince ? 0.95 : 0.88,
    reason: detectedProvince ? `识别为${detectedProvince}地方电视频道` : `智能规则分析归类为: ${category}`
  };
}

// Call OpenAI Compatible Endpoint (SiliconFlow, Zhipu GLM, DeepSeek, DashScope, Moonshot, Custom)
async function callOpenAiCompatible(config: AiConfig, prompt: string, isJson = true, attempt = 1): Promise<string> {
  const baseUrl = (config.baseUrl || "").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey.trim()}`;
  }

  const body: any = {
    model: config.model || "Qwen/Qwen2.5-7B-Instruct",
    messages: [
      {
        role: "system",
        content: "你是一个专业的电视频道元数据整理引擎，负责根据频道原始信息输出标准的中文频道名称、分类、EPG标识与台标链接。输出必须严谨并严格遵循JSON格式。"
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: config.temperature !== undefined ? config.temperature : 0.1
  };

  if (isJson) {
    if (!config.model?.includes("glm-4-flash")) {
      body.response_format = { type: "json_object" };
    }
  }

  const controller = new AbortController();
  // Extended timeout to 35s to prevent premature timeouts during batch or peak periods
  const timeoutId = setTimeout(() => controller.abort(), 35000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const rawText = await res.text();
    const isRateLimit =
      res.status === 429 ||
      res.status === 503 ||
      res.status === 502 ||
      res.status === 504 ||
      /rate\s*exceeded/i.test(rawText) ||
      /rate\s*limit/i.test(rawText) ||
      rawText.includes("1302") ||
      rawText.includes("速率限制") ||
      rawText.includes("RESOURCE_EXHAUSTED");

    if (!res.ok) {
      // Detect Zhipu GLM 1301 or content safety filter
      const isContentSafety =
        res.status === 400 &&
        (rawText.includes("1301") ||
          rawText.includes("contentFilter") ||
          rawText.includes("敏感内容") ||
          rawText.includes("不安全") ||
          rawText.includes("moderation"));

      if (isContentSafety) {
        const safetyErr: any = new Error(`AI 服务安全过滤 (1301/Sensitive): ${rawText.slice(0, 200)}`);
        safetyErr.isContentSafety = true;
        throw safetyErr;
      }

      if (isRateLimit && attempt <= 3) {
        const delayMs = Math.min(1000 * Math.pow(1.8, attempt - 1) + Math.random() * 400, 5000);
        console.warn(`[AI Service] Rate limit / Busy (HTTP ${res.status}, attempt ${attempt}/3). Backing off for ${Math.round(delayMs)}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
        return callOpenAiCompatible(config, prompt, isJson, attempt + 1);
      }
      throw new Error(`AI 服务返回 HTTP ${res.status}: ${rawText.slice(0, 300)}`);
    }

    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      if (isRateLimit && attempt <= 3) {
        const delayMs = Math.min(1000 * Math.pow(1.8, attempt - 1) + Math.random() * 400, 5000);
        console.warn(`[AI Service] Rate limit in response text (attempt ${attempt}/3). Retrying...`);
        await new Promise((r) => setTimeout(r, delayMs));
        return callOpenAiCompatible(config, prompt, isJson, attempt + 1);
      }
      throw new Error(`AI 服务响应格式异常 (${res.status}): ${rawText.slice(0, 200)}`);
    }
    
    // Check if output was blocked by finish_reason or contentFilter
    if (data?.choices?.[0]?.finish_reason === "sensitive" || (Array.isArray(data?.contentFilter) && data.contentFilter.length > 0)) {
      const safetyErr: any = new Error("AI 服务返回内容触发安全保护机制 (sensitive)");
      safetyErr.isContentSafety = true;
      throw safetyErr;
    }

    const content = data?.choices?.[0]?.message?.content || "";
    if (!content) {
      throw new Error("AI 模型未返回有效文本内容");
    }
    return content;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error("调用 AI 大模型接口超时 (超过 35 秒)");
    }
    if (err.isContentSafety) {
      throw err;
    }
    const isRateLimitOrBusy =
      err.message?.includes("503") ||
      err.message?.includes("429") ||
      err.message?.includes("1302") ||
      err.message?.includes("速率限制") ||
      /rate\s*exceeded/i.test(err.message || "") ||
      /rate\s*limit/i.test(err.message || "");

    if (isRateLimitOrBusy && attempt <= 3) {
      const delayMs = Math.min(1000 * Math.pow(1.8, attempt - 1) + Math.random() * 400, 5000);
      await new Promise((r) => setTimeout(r, delayMs));
      return callOpenAiCompatible(config, prompt, isJson, attempt + 1);
    }
    throw err;
  }
}

// Call Google Gemini API with automatic model fallback & retry on high demand (503)
async function callGeminiApi(prompt: string, attempt = 1): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY 环境变量未设置");
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { "User-Agent": "aistudio-build" }
    }
  });

  // Candidate models: primary gemini-3.7-flash, fallback gemini-2.5-flash / gemini-flash-latest
  const modelCandidates = ["gemini-3.7-flash", "gemini-2.5-flash", "gemini-flash-latest"];
  const selectedModel = modelCandidates[Math.min(attempt - 1, modelCandidates.length - 1)];

  try {
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    return response.text || "";
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const isHighDemandOrRateLimit =
      errMsg.includes("503") ||
      errMsg.includes("UNAVAILABLE") ||
      errMsg.includes("high demand") ||
      errMsg.includes("429") ||
      errMsg.includes("RESOURCE_EXHAUSTED") ||
      /rate\s*exceeded/i.test(errMsg) ||
      /rate\s*limit/i.test(errMsg) ||
      errMsg.includes("Quota");

    if (isHighDemandOrRateLimit && attempt <= 3) {
      console.warn(`[Gemini API] Model ${selectedModel} high demand/busy (attempt ${attempt}/3). Retrying with fallback model...`);
      await new Promise((r) => setTimeout(r, 800 * attempt));
      return callGeminiApi(prompt, attempt + 1);
    }

    throw new Error(`Gemini 模型服务暂时繁忙 (${selectedModel}): ${errMsg.slice(0, 200)}`);
  }
}

// Helper to extract JSON from raw markdown or text responses
function extractJsonFromText(rawText: string): any {
  if (!rawText) return null;
  let text = rawText.trim();
  // Strip ```json ... ```
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  // Find first { or [
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  let startIdx = -1;
  let endIdx = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    endIdx = text.lastIndexOf("}") + 1;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endIdx = text.lastIndexOf("]") + 1;
  }

  if (startIdx !== -1 && endIdx > startIdx) {
    text = text.substring(startIdx, endIdx);
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    if (/rate\s*exceeded/i.test(rawText) || /rate\s*limit/i.test(rawText) || rawText.includes("1302") || rawText.includes("速率限制")) {
      const rateErr: any = new Error(`AI 大模型触发速率限制: ${rawText.slice(0, 200)}`);
      rateErr.isRateLimit = true;
      throw rateErr;
    }
    return null;
  }
}

// Single Channel AI Suggestion
export async function suggestChannelMetadata(
  rawName: string,
  rawUrlOrGroup?: string,
  configOrGroups?: AiConfig | string[],
  existingGroups?: string[]
): Promise<ChannelSuggestion> {
  const trimmed = (rawName || "").trim();
  if (!trimmed) {
    throw new Error("频道名称不能为空");
  }

  const effectiveConfig: AiConfig = (configOrGroups && !Array.isArray(configOrGroups) && typeof configOrGroups === "object")
    ? resolveEffectiveAiConfig(configOrGroups as Partial<AiConfig>)
    : getAiConfig();

  // 1. First check high-confidence direct match from built-in knowledge base
  const builtin = matchBuiltinChannel(trimmed);
  if (builtin) {
    return {
      standardName: builtin.standardName,
      suggestedCategory: builtin.category,
      suggestedCategoryList: builtin.categoryList,
      logo: resolveChannelLogo(builtin.logo),
      alias: Array.from(new Set([trimmed, builtin.standardName, ...builtin.alias])),
      epgId: builtin.epgId,
      confidence: 0.99,
      reason: `匹配到标准电视频道库: ${builtin.standardName} (${builtin.category})`
    };
  }

  // 2. If provider is "builtin" or no API key configured, use rule engine
  const activeProvider = effectiveConfig?.provider || "builtin";
  const hasKey = Boolean(effectiveConfig?.apiKey?.trim() || (activeProvider === "gemini" && process.env.GEMINI_API_KEY));

  if (activeProvider === "builtin" || !hasKey) {
    return deduceChannelRule(trimmed);
  }

  // 3. Call AI Model
  try {
    const prompt = `请对以下电视频道名称进行规范化分析并输出标准元数据：
频道名称：【${trimmed}】${rawUrlOrGroup ? `\n参考信息：${rawUrlOrGroup}` : ""}

规则要求：
1. 识别标准电视频道中文名称（去除高清/4K/超清/标清/码率/回放/IPV6等格式标签）。
2. 保持央视频道序号精确对应（如 CCTV-1 综合、CCTV-13 新闻、CCTV-5+ 体育赛事），保持省市卫视与地方台规范名称。
3. 输出对应的分类、推荐epgId和高清台标。

严格按以下 JSON 格式输出：
{
  "standardName": "标准中文电视频道名称 (如 'CCTV-13 新闻', 'CCTV-1 综合', '湖南卫视', '广州综合')",
  "suggestedCategory": "最适合的一级分类 (如 '央视频道' | '卫视频道' | '地方频道' | '港澳台' | '体育专区' | '影视剧场' | '少儿动画' | '新闻纪实' | '其它频道')",
  "suggestedCategoryList": ["一级分类", "二级分类(如有)"],
  "logo": "标准高清透明台标URL (若不确定可留空或推荐 https://live.fanmingming.com/tv/xxx.png 或 https://epg.112114.xyz/logo/xxx.png)",
  "alias": ["别名1", "别名2", "常见简称", "英文字母简称"],
  "epgId": "标准 EPG 匹配标识 (如 cctv13, cctv1, hunantv)",
  "description": "频道简短描述与备注 (30字以内，如主要播放内容、频道定位、停播/合并状态等)",
  "confidence": 0.95,
  "reason": "推荐理由简述 (15字以内)"
}`;

    let rawOutput = "";
    if (activeProvider === "gemini") {
      rawOutput = await callGeminiApi(prompt);
    } else {
      rawOutput = await callOpenAiCompatible(effectiveConfig, prompt, true);
    }

    const parsed = extractJsonFromText(rawOutput);
    if (parsed && parsed.standardName) {
      let finalLogo = parsed.logo || "";
      if (!finalLogo || finalLogo.includes("undefined")) {
        const isCctvOrSat = /cctv|中央|央视|cgtn|cetv|卫视/i.test(parsed.standardName || trimmed);
        const base = isCctvOrSat ? getLogoBaseFan() : getLogoBase112();
        finalLogo = `${base}/${encodeURIComponent(parsed.standardName)}.png`;
      } else {
        finalLogo = resolveChannelLogo(finalLogo);
      }

      const allAliases = Array.from(new Set([
        trimmed,
        parsed.standardName,
        ...(Array.isArray(parsed.alias) ? parsed.alias : [])
      ])).filter(Boolean);

      return {
        standardName: String(parsed.standardName).trim(),
        suggestedCategory: String(parsed.suggestedCategory || "其它频道").trim(),
        suggestedCategoryList: Array.isArray(parsed.suggestedCategoryList) ? parsed.suggestedCategoryList : [parsed.suggestedCategory || "其它频道"],
        logo: finalLogo,
        alias: allAliases,
        epgId: String(parsed.epgId || "").trim().toLowerCase(),
        description: parsed.description ? String(parsed.description).trim() : "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.9,
        reason: parsed.reason ? String(parsed.reason) : `${effectiveConfig?.model || "AI"} 智能推导完成`
      };
    }
  } catch (err: any) {
    console.warn(`[AI Suggestion Error on '${trimmed}']:`, err.message || err);
    // Fallback to rule engine on AI failure or content safety
    const fallback = deduceChannelRule(trimmed);
    const tag = err.isContentSafety ? "(安全过滤保护，已自动切换内置知识库)" : "(AI服务受限，已自动切换内置知识库)";
    fallback.reason = `${tag} ${fallback.reason}`;
    return fallback;
  }

  return deduceChannelRule(trimmed);
}

// Batch AI Suggestion for Channel Organizer and Bulk Import with high-concurrency worker pool
export async function batchSuggestChannels(
  channelList: { id?: string; name: string; url?: string; originalGroup?: string }[],
  configOrGroups?: AiConfig | string[],
  existingGroups?: string[]
): Promise<Record<string, ChannelSuggestion>> {
  const results: Record<string, ChannelSuggestion> = {};
  if (!Array.isArray(channelList) || channelList.length === 0) return results;

  const effectiveConfig: AiConfig = (configOrGroups && !Array.isArray(configOrGroups) && typeof configOrGroups === "object")
    ? resolveEffectiveAiConfig(configOrGroups as Partial<AiConfig>)
    : getAiConfig();

  const activeProvider = effectiveConfig?.provider || "builtin";
  const hasKey = Boolean(effectiveConfig?.apiKey?.trim() || (activeProvider === "gemini" && process.env.GEMINI_API_KEY));

  // If no AI key or builtin, process all with builtin rule engine instantaneously (<10ms)
  if (activeProvider === "builtin" || !hasKey) {
    for (const ch of channelList) {
      const key = ch.id || ch.name;
      results[key] = deduceChannelRule(ch.name);
    }
    return results;
  }

  // 1. Fast Local-First Pass: Match Builtin Knowledge & High Confidence Heuristics
  const needAiList: { id: string; name: string; url?: string }[] = [];
  for (const ch of channelList) {
    const key = ch.id || ch.name;
    const builtin = matchBuiltinChannel(ch.name);
    if (builtin) {
      results[key] = {
        standardName: builtin.standardName,
        suggestedCategory: builtin.category,
        suggestedCategoryList: builtin.categoryList,
        logo: resolveChannelLogo(builtin.logo),
        alias: Array.from(new Set([ch.name.trim(), builtin.standardName, ...builtin.alias])),
        epgId: builtin.epgId,
        confidence: 0.99,
        reason: `匹配权威电视频道库: ${builtin.standardName}`
      };
    } else {
      // Check if local deduction has high confidence (e.g. CCTV, Satellite, Major Local, HK/TW)
      const localDeduced = deduceChannelRule(ch.name);
      if (localDeduced.confidence >= 0.90) {
        results[key] = localDeduced;
      } else {
        needAiList.push({ id: key, name: ch.name, url: ch.url });
      }
    }
  }

  // If all channels were resolved by high-speed local engine, return immediately
  if (needAiList.length === 0) {
    return results;
  }

  // 2. High-Concurrency Parallel AI Pool for Remaining Ambiguous Channels
  // Split into chunks of 15 items. Max 3 chunks (45 items) sent to AI for speed guarantee, others deduce locally
  const CHUNK_SIZE = 15;
  const MAX_AI_ITEMS = 45;
  const aiCandidateList = needAiList.slice(0, MAX_AI_ITEMS);
  const extraList = needAiList.slice(MAX_AI_ITEMS);

  // Instantly resolve any items beyond MAX_AI_ITEMS with local deduction
  for (const ch of extraList) {
    results[ch.id] = deduceChannelRule(ch.name);
  }

  const chunks: { id: string; name: string; url?: string }[][] = [];
  for (let i = 0; i < aiCandidateList.length; i += CHUNK_SIZE) {
    chunks.push(aiCandidateList.slice(i, i + CHUNK_SIZE));
  }

  // Worker task for a single chunk
  const processChunk = async (chunk: { id: string; name: string; url?: string }[], chunkIndex: number) => {
    try {
      const prompt = `请对以下 ${chunk.length} 个电视频道进行批量规范化分析与分类：
${JSON.stringify(chunk.map((c, idx) => ({ index: idx, id: c.id, name: c.name })), null, 2)}

规则要求：
1. 识别标准电视频道中文名称（去除高清/4K/超清/标清/码率/回放/IPV6/电信/联通/移动等格式标签）。
2. 保持央视频道序号与数字付费频道精确对应（如 CCTV-1 综合、CCTV-13 新闻、CCTV 电视指南、CCTV 兵器科技、CCTV 央视台球、CCTV 女性时尚等归为“央视频道”，严禁错误映射为“中视”或其它频道）。
3. 严格识别市级/县级/区级地方台（如“蒙城新闻频道”->“蒙城新闻”，“泗县新闻”->“泗县新闻”，“滁州科教”->“滁州科教”归为“地方频道”，严禁将地方台误识别为 CCTV-13 或 CCTV-10 等央视频道）。
4. 严格输出标准 JSON 数组，每个元素包含 id、standardName、suggestedCategory、epgId、alias、logo、reason。

格式示例：
[
  {
    "id": "频道id",
    "standardName": "标准中文电视频道名称 (如 'CCTV-13 新闻', 'CCTV 电视指南', '湖南卫视', '广东卫视', '蒙城新闻综合')",
    "suggestedCategory": "分类 ('央视频道'|'卫视频道'|'地方频道'|'港澳台'|'体育专区'|'影视剧场'|'少儿动画'|'新闻纪实'|'其它频道')",
    "epgId": "推荐epgId (如 cctv13, cctv_guide, hunantv)",
    "alias": ["别名1", "别名2"],
    "logo": "推荐台标URL (可留空)",
    "reason": "归类理由"
  }
]`;

      let rawOutput = "";
      if (activeProvider === "gemini") {
        rawOutput = await callGeminiApi(prompt);
      } else {
        rawOutput = await callOpenAiCompatible(effectiveConfig, prompt, true);
      }

      const parsedArray = extractJsonFromText(rawOutput);
      if (Array.isArray(parsedArray)) {
        for (const item of parsedArray) {
          if (item && item.id && item.standardName) {
            const originalCh = chunk.find(c => c.id === item.id);
            const originalName = originalCh ? originalCh.name : item.standardName;

            let stdName = String(item.standardName).trim();
            let cat = String(item.suggestedCategory || "其它频道").trim();
            let catList = [cat];
            let epgId = String(item.epgId || "").trim().toLowerCase();

            // Sanity Check 1: CCTV specialty corruption check (e.g. CCTV电视指南 mapped to 中视)
            if (/^cctv/i.test(originalName) && (!stdName.toLowerCase().startsWith("cctv") && !stdName.startsWith("中央") && !stdName.startsWith("央视"))) {
              const rule = deduceChannelRule(originalName);
              stdName = rule.standardName;
              cat = rule.suggestedCategory;
              catList = rule.suggestedCategoryList;
              epgId = rule.epgId;
            }

            // Sanity Check 2: Local station corruption check (e.g. 蒙城新闻/滁州科教 mapped to CCTV-13/CCTV-10)
            const localGeo = detectProvinceAndIspFromName(originalName);
            if (localGeo.detectedProvince && !/^(?:cctv|中央|央视|cgtn|cetv)/i.test(originalName) && !originalName.includes("卫视")) {
              if (stdName.toLowerCase().startsWith("cctv") || stdName.startsWith("中央") || stdName.startsWith("央视")) {
                const rule = deduceChannelRule(originalName);
                stdName = rule.standardName;
                cat = "地方频道";
                catList = ["地方频道", `${localGeo.detectedProvince}地方`];
                epgId = rule.epgId;
              }
            }

            let logo = item.logo || "";
            if (!logo || logo.includes("undefined")) {
              const isCctvOrSat = /cctv|中央|央视|cgtn|cetv|卫视/i.test(stdName);
              const base = isCctvOrSat ? getLogoBaseFan() : getLogoBase112();
              logo = `${base}/${encodeURIComponent(stdName)}.png`;
            } else {
              logo = resolveChannelLogo(logo);
            }

            results[item.id] = {
              standardName: stdName,
              suggestedCategory: cat,
              suggestedCategoryList: catList,
              logo,
              alias: Array.from(new Set([
                originalName,
                stdName,
                ...(Array.isArray(item.alias) ? item.alias : [])
              ])).filter(Boolean),
              epgId,
              confidence: 0.94,
              reason: item.reason ? String(item.reason) : `${effectiveConfig?.model || "AI"} 智能批量推导`
            };
          }
        }
      }
    } catch (err: any) {
      const isSafety = err.isContentSafety || err.message?.includes("1301") || err.message?.includes("安全过滤");
      console.warn(`[Parallel AI Chunk ${chunkIndex} Notice]:`, isSafety ? "触发内容安全保护，自动降级为内置知识库" : (err.message || err));
      
      // Fallback for this chunk
      for (const ch of chunk) {
        if (!results[ch.id]) {
          const fallback = deduceChannelRule(ch.name);
          fallback.reason = isSafety ? `(安全保护) ${fallback.reason}` : `(自动降级) ${fallback.reason}`;
          results[ch.id] = fallback;
        }
      }
    }
  };

  // Run chunks in parallel with concurrency pool of 4
  const CONCURRENCY = 4;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const activeChunks = chunks.slice(i, i + CONCURRENCY);
    await Promise.all(activeChunks.map((chunk, idx) => processChunk(chunk, i + idx)));
  }

  // Fill in any missed entries with rule engine
  for (const ch of needAiList) {
    if (!results[ch.id]) {
      results[ch.id] = deduceChannelRule(ch.name);
    }
  }

  return results;
}

// Test AI Connection
export async function testAiConnection(rawConfig?: Partial<AiConfig>): Promise<{ success: boolean; latencyMs: number; message: string; modelOutput?: string }> {
  const config = resolveEffectiveAiConfig(rawConfig);
  const start = Date.now();
  if (config.provider === "builtin") {
    const latencyMs = Date.now() - start;
    return {
      success: true,
      latencyMs,
      message: "内置离线智能规则与台标知识库检测正常，秒级响应，无需任何外部网络或 API Key。"
    };
  }

  if (config.provider === "gemini") {
    try {
      const output = await callGeminiApi("请回复一个包含 'status': 'ok' 和 'message': 'Gemini API 连接成功' 的 JSON 对象。");
      const latencyMs = Date.now() - start;
      return {
        success: true,
        latencyMs,
        message: `Google Gemini 连接测试成功 (${latencyMs}ms)`,
        modelOutput: output
      };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      return {
        success: false,
        latencyMs,
        message: `Gemini 连接失败: ${err.message || err}`
      };
    }
  }

  // OpenAI-compatible providers
  if (!config.apiKey && config.provider !== "custom") {
    return {
      success: false,
      latencyMs: 0,
      message: `请先填写 ${AI_PROVIDER_PRESETS[config.provider]?.name || "当前供应商"} 的 API Key！`
    };
  }

  try {
    const prompt = "请用标准 JSON 格式回复一段测试信息：{\"status\": \"ok\", \"channel\": \"CCTV-1 综合\", \"message\": \"AI 大模型连通正常\"}";
    const output = await callOpenAiCompatible(config, prompt, true);
    const latencyMs = Date.now() - start;
    return {
      success: true,
      latencyMs,
      message: `成功连接大模型 ${config.model} (${latencyMs}ms)`,
      modelOutput: output
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return {
      success: false,
      latencyMs,
      message: `连接失败: ${err.message || err}`
    };
  }
}

// Comprehensive intelligent channel description and knowledge deduction engine
export function deduceDetailedChannelDescription(
  name: string,
  groupNames?: string[],
  epgId?: string
): string {
  const raw = (name || "").trim();
  const clean = raw.toLowerCase().replace(/[\s\-_]/g, "");

  if (!clean) return "电视频道直播与综合资讯服务。";

  // 1. Taiwan Sanli (三立)
  if (/三立/i.test(clean)) {
    if (/新闻|inews|财经/i.test(clean)) {
      if (/inews|财经/i.test(clean)) {
        return "台湾地区三立电视（SET）旗下的财经与即时新闻频道（台湾有线电视CH88/CH89）。聚焦台股走势、理财投资与全球财经动态。";
      }
      return "台湾地区三立电视（SET）旗下的24小时即时新闻频道（台湾有线电视CH54）。主要报道台湾政经新闻、社会焦点与政论评论节目（如《郑知道了》《新台湾加油》）。";
    }
    if (/台湾台|台语|本土/i.test(clean)) {
      return "台湾地区三立电视（SET）旗下的本土频道（台湾有线电视CH29）。主要播出台湾闽南语八点档戏剧、美食行脚与戏剧节目（如《戏说台湾》《超级夜总会》）。";
    }
    if (/都会|综合/i.test(clean)) {
      return "台湾地区三立电视（SET）旗下的都市综合频道（台湾有线电视CH30）。主打流行都市偶像剧、流行音乐与热门综艺节目。";
    }
    if (/国际|戏剧/i.test(clean)) {
      return "台湾地区三立电视（SET）旗下的影视剧场频道，播出热门华人戏剧与自制偶像剧。";
    }
    return "台湾地区三立电视（SET）旗下的主流电视机构，涵盖新闻、戏剧与综合娱乐频道。";
  }

  // 2. Taiwan Eastern TV (东森)
  if (/东森|ebc/i.test(clean)) {
    if (/新闻|news/i.test(clean)) {
      return "台湾地区东森电视（EBC）旗下的新闻旗舰频道（台湾有线电视CH51）。24小时报道台湾与全球热点新闻，代表政论与探索解密节目《关键时刻》（刘宝杰主持）。";
    }
    if (/财经|新闻2/i.test(clean)) {
      return "台湾地区东森电视（EBC）旗下的财经新闻频道（台湾有线电视CH57）。专注于台湾与全球金融股市、理财投资与产业趋势。";
    }
    if (/综合/i.test(clean)) {
      return "台湾地区东森电视（EBC）旗下的综合娱乐频道（台湾有线电视CH32）。主打热门谈话节目（如《医师好辣》）、生活资讯与综艺。";
    }
    if (/戏剧/i.test(clean)) {
      return "台湾地区东森电视（EBC）旗下的戏剧频道（台湾有线电视CH40）。主要播出热播台剧、陆剧、韩剧及优质自制剧集。";
    }
    if (/幼幼|yoyo/i.test(clean)) {
      return "台湾地区东森电视（EBC）旗下的知名儿童亲子频道（台湾有线电视CH25）。播出国内外知名动画、哥哥姐姐唱跳节目与亲子互动频道。";
    }
    if (/洋片|电影/i.test(clean)) {
      if (/洋片/i.test(clean)) {
        return "台湾地区东森电视（EBC）旗下的西方电影频道（台湾有线电视CH66）。首播好莱坞动作片、科幻大片及欧美院线佳作。";
      }
      return "台湾地区东森电视（EBC）旗下的华语电影频道（台湾有线电视CH62）。播放经典港产片、国语电影及华语院线片。";
    }
    return "台湾地区东森电视（EBC）旗下的主流电视机构，涵盖新闻、财经、戏剧与儿童娱乐。";
  }

  // 3. Taiwan CTi (中天)
  if (/中天|cti/i.test(clean)) {
    if (/新闻/i.test(clean)) {
      return "台湾地区旺旺中天媒体集团旗下的24小时新闻频道（原台湾有线电视CH52）。主要播报台湾社会政经新闻与深度政论评论（如《文茜的世界周报》《新闻龙卷风》），2020年底因NCC未予续牌转战YouTube及网络全媒体直播。";
    }
    if (/综合/i.test(clean)) {
      return "台湾地区旺旺中天媒体集团旗下的综合娱乐频道（台湾有线电视CH36）。主要播出热门综艺、谈话节目与经典戏剧。";
    }
    if (/娱乐/i.test(clean)) {
      return "台湾地区旺旺中天媒体集团旗下的娱乐频道（台湾有线电视CH39）。播出流行娱乐新闻、真人秀与流行剧集。";
    }
    return "台湾地区旺旺中天媒体集团旗下的电视与网络直播频道，涵盖新闻评论与综合娱乐。";
  }

  // 4. Taiwan TVBS
  if (/tvbs|联意/i.test(clean)) {
    if (/新闻/i.test(clean)) {
      return "台湾地区联意制作（TVBS）旗下的新闻旗舰频道（台湾有线电视CH55）。台湾首家卫星电视台新闻台，报道台湾政经新闻与深度调查（如《少康战情室》《新闻夜总会》）。";
    }
    if (/欢乐|56|42/i.test(clean)) {
      return "台湾地区TVBS旗下的综合娱乐频道（台湾有线电视CH42/CH56）。主打热门时尚生活与流行综艺（如《女人我最大》《食尚玩家》）。";
    }
    return "台湾地区TVBS旗下的主流新闻与综合娱乐频道。";
  }

  // 5. Taiwan FTV (民视)
  if (/民视|ftv/i.test(clean)) {
    if (/新闻/i.test(clean)) {
      return "台湾地区民间全民电视（FTV）旗下的新闻频道（台湾有线电视CH53）。24小时聚焦台湾本土政经与社会即时动态。";
    }
    if (/无线|主频/i.test(clean) || clean === "民视") {
      return "台湾地区民间全民电视（FTV）的主频道（台湾无线五台之一）。主要播出高收视本土闽南语八点档大戏、戏剧与综合综艺。";
    }
    return "台湾地区民间全民电视（FTV）旗下频道，主打本土闽南语戏剧与即时新闻。";
  }

  // 6. Taiwan Wireless 5 (TTV, CTV, CTS, PTS)
  if (/台视|ttv/i.test(clean)) {
    return "台湾地区台湾电视公司（TTV）主频道（台湾无线五台之一）。台湾历史最悠久的电视台，播出即时新闻、八点档戏剧与大型典礼（如金曲奖）。";
  }
  if (/中视|ctv/i.test(clean)) {
    return "台湾地区中国电视公司（CTV）主频道（台湾无线五台之一）。主要播出新闻、华语戏剧与热门综艺节目。";
  }
  if (/华视|cts/i.test(clean)) {
    return "台湾地区中华电视公司（CTS）主频道（台湾无线五台之一，公广集团成员）。主要播出新闻、公性节目与经典影视。";
  }
  if (/公视|pts|公共电视/i.test(clean)) {
    return "台湾地区公共电视文化事业基金会（PTS）旗下的公共电视台。无商业广告，主要播出高品质自制旗舰台剧（如《我们与恶的距离》）、纪录片与优质儿童节目。";
  }

  // 7. Taiwan Videoland (纬来)
  if (/纬来/i.test(clean)) {
    if (/体育/i.test(clean)) {
      return "台湾地区纬来电视网旗下的专业体育频道（台湾有线电视CH72）。全程直播CPBL中华职棒、NBA及国际顶级体育赛事。";
    }
    if (/日本/i.test(clean)) {
      return "台湾地区纬来电视网旗下的日本影视频道（台湾有线电视CH75）。同步首播日本热门日剧、综艺及流行文化节目。";
    }
    return "台湾地区纬来电视网旗下的专业主题频道。";
  }

  // 8. Hong Kong TVB (无线电视)
  if (/tvb|无线/i.test(clean)) {
    if (/翡翠|jade/i.test(clean)) {
      return "香港电视广播有限公司（TVB）旗下的粤语旗舰综合频道（香港免费电视81台）。香港收视率最高的电视台，主播TVB自制粤语剧集、新闻及大型综艺。";
    }
    if (/明珠|pearl/i.test(clean)) {
      return "香港电视广播有限公司（TVB）旗下的免费英语频道（香港免费电视84台）。首播欧美院线好莱坞大片、美剧、纪录片及英语新闻。";
    }
    if (/新闻|i-?news|互动新闻/i.test(clean)) {
      return "香港电视广播有限公司（TVB）旗下的24小时免费粤语新闻频道（香港免费电视83台）。全天候即时播报香港、内地及全球焦点新闻。";
    }
    if (/j2|tvb\s*j2/i.test(clean)) {
      return "香港TVB旗下面向年轻观众的时尚娱乐频道（香港免费电视82台）。主打潮流、动漫、年轻综艺与外购剧。";
    }
    return "香港电视广播有限公司（TVB）旗下的电视频道，涵盖粤语剧集、新闻与综艺。";
  }

  // 9. Hong Kong Phoenix TV (凤凰卫视)
  if (/凤凰|phoenix/i.test(clean)) {
    if (/资讯/i.test(clean)) {
      return "香港凤凰卫视控股旗下的24小时华语新闻频道。立足香港、面向全球华人，即时播报全球突发事件与深度财经资讯（如《华闻大生线》《时事直通车》）。";
    }
    if (/香港/i.test(clean)) {
      return "香港凤凰卫视旗下的粤语资讯综合频道。主要面向粤港澳大湾区观众，提供粤语新闻、时事分析与专题节目。";
    }
    if (/中文|主频/i.test(clean) || clean.includes("凤凰卫视")) {
      return "香港凤凰卫视控股旗下的华语综合旗舰频道。以客观报道、文化深度与国际视角著称，代表节目《时事直通车》《军情观察室》《文涛拍案》等。";
    }
    return "香港凤凰卫视旗下的华语主流电视媒体，覆盖全球华人圈。";
  }

  // 10. Macau TV (澳广视/莲花)
  if (/澳视|tdm|澳广视|澳门电视/i.test(clean)) {
    return "澳门特别行政区公共电视台（TDM澳广视）。以粤语和葡语播报澳门本地政经新闻、文化活动、博览与娱乐节目。";
  }
  if (/莲花|lotus/i.test(clean)) {
    return "澳门特别行政区澳门莲花卫视（Macau Lotus TV）。以华语播报澳门文化、博览资讯、电影与影视艺术节目。";
  }

  // 11. Hong Kong ViuTV
  if (/viutv|hk-?tv/i.test(clean)) {
    return "香港香港电视娱乐（HKTVE，电讯盈科旗下）运营的免费电视台（香港免费电视99台）。主打年轻人喜爱的自制真人秀、潮流剧集与流行音乐节。";
  }

  // 12. Global Premium (HBO, Discovery, NGC)
  if (/hbo/i.test(clean)) {
    if (/family/i.test(clean)) {
      return "华纳兄弟探索（Warner Bros. Discovery）旗下的HBO家庭电影频道。播放适合全家观赏的喜剧、动画与温馨好莱坞影片。";
    }
    return "华纳兄弟探索（Warner Bros. Discovery）旗下的全球旗舰付费电影频道。首播好莱坞院线大片及自制高品质美剧（如《权力的游戏》）。";
  }
  if (/discovery|探索/i.test(clean)) {
    return "华纳兄弟探索公司旗下的全球顶级纪实频道。播放科学探索、自然地理、历史解密与生存挑战纪录片。";
  }
  if (/national\s*geo|国家地理|nat\s*geo/i.test(clean)) {
    return "华特迪士尼公司旗下的国家地理频道（National Geographic）。播放高品质自然地理、野生动物、探险与科学纪录片。";
  }

  // 13. CCTV Series
  if (/cctv|央视|中央/i.test(clean)) {
    if (/13|新闻/i.test(clean)) {
      return "中央广播电视总台（CMG）旗下24小时新闻专业频道。全天候直播国内国际突发事件与热点报道，核心节目《新闻联播》《焦点访谈》《新闻1+1》。";
    }
    if (/1|综合/i.test(clean)) {
      return "中央广播电视总台（CMG）国家级主频道。首播《新闻联播》《焦点访谈》及国家级重大晚会与黄金档电视剧。";
    }
    if (/2|财经/i.test(clean)) {
      return "中央广播电视总台（CMG）财经专业频道。聚焦国内外经济大趋势、股市行情与理财资讯，代表节目《经济半小时》《第一时间》。";
    }
    if (/3|综艺/i.test(clean)) {
      return "中央广播电视总台（CMG）大型文艺与综艺频道。播出大型歌舞晚会、喜剧综艺与流行文艺节目，代表节目《星光大道》《开门大吉》。";
    }
    if (/4|中文国际/i.test(clean)) {
      return "中央广播电视总台（CMG）面向全球华人的中文国际频道。报道全球要闻与中华文化，代表节目《中国新闻》《海峡两岸》。";
    }
    if (/5\+|5plus|体育赛事/i.test(clean)) {
      return "中央广播电视总台（CMG）赛事赛事专业频道。全程高清/4K直播国内外顶级体育赛事（如奥运会、世界杯、欧冠、NBA）。";
    }
    if (/5|体育/i.test(clean)) {
      return "中央广播电视总台（CMG）旗舰体育频道。全天候转播国内外各大体育联赛、体育新闻《体育世界》与赛事专题。";
    }
    if (/6|电影/i.test(clean)) {
      return "中央广播电视总台（CMG）电影专业频道。首播国产新片、好莱坞影片及经典电影。";
    }
    if (/7|国防军事|军事/i.test(clean)) {
      return "中央广播电视总台（CMG）国防军事专业频道。报道国内外国防军事动态、兵器装备与军事历史。";
    }
    if (/8|电视剧/i.test(clean)) {
      return "中央广播电视总台（CMG）电视剧专业频道。全天候首播与重播国内外热门电视剧与精品剧场。";
    }
    if (/9|纪录/i.test(clean)) {
      return "中央广播电视总台（CMG）纪录片专业频道。播出自然、历史、人文、科技及社会类高品质纪录片。";
    }
    if (/10|科教/i.test(clean)) {
      return "中央广播电视总台（CMG）科学与教育频道。代表节目《百家讲坛》《探索·发现》《走进科学》。";
    }
    if (/11|戏曲/i.test(clean)) {
      return "中央广播电视总台（CMG）中国传统戏曲频道。弘扬京剧、越剧、黄梅戏及全国地方戏曲名家名段。";
    }
    if (/12|社会与法|法制/i.test(clean)) {
      return "中央广播电视总台（CMG）法制普法与社会频道。报道典型法治案件、普法宣传与社会热点专题。";
    }
    if (/14|少儿/i.test(clean)) {
      return "中央广播电视总台（CMG）少儿频道。播出优秀国产动画片、少儿科普与儿童综艺节目（如《智慧树》《大风车》）。";
    }
    if (/15|音乐/i.test(clean)) {
      return "中央广播电视总台（CMG）音乐专业频道。播出古典音乐、流行音乐演唱会及音乐颁奖盛典。";
    }
    if (/16|奥林匹克/i.test(clean)) {
      return "中央广播电视总台（CMG）与国际奥委会合作的奥林匹克频道（4K超高清）。24小时播出奥林匹克赛事与奥运文化。";
    }
    if (/17|农业农村/i.test(clean)) {
      return "中央广播电视总台（CMG）农业农村专业频道。关注乡村振兴、农业科技、三农资讯与风土人情。";
    }
    return "中央广播电视总台（CMG）旗下的国家级电视频道。";
  }

  // 14. CGTN
  if (/cgtn|环球电视/i.test(clean)) {
    return "中国国际电视台（CGTN，中央广播电视总台多语种国际传播机构）。向全球观众播报中国与国际要闻，提供客观的中国视角。";
  }

  // 15. Provincial Satellites (省级卫视)
  if (/湖南卫视|芒果/i.test(clean)) {
    return "湖南广播电视台旗下的旗舰省级卫视频道。中国内地最具影响力的省级卫视之一，主打青年流行文化、大型创新综艺与金鹰独播剧场。";
  }
  if (/浙江卫视/i.test(clean)) {
    return "浙江广播电视集团旗下的省级卫视频道。主打大型户外真人秀综艺（如《奔跑吧》《中国好声音》）与中国蓝剧场。";
  }
  if (/东方卫视|上海卫视/i.test(clean)) {
    return "上海广播电视台（SMG）旗下的省级卫视频道。立足上海、面向全国，主打海派都市文化、即时新闻资讯与精品海派综艺。";
  }
  if (/江苏卫视/i.test(clean)) {
    return "江苏省广播电视总台旗下的省级卫视频道。主打情感类综艺、大型跨年演唱会与幸福剧场。";
  }
  if (/北京卫视/i.test(clean)) {
    return "北京广播电视台旗下的省级卫视频道。立足首都、面向全国，主打文化养生、历史纪录片与品质剧场。";
  }
  if (/广东卫视/i.test(clean)) {
    return "广东广播电视台旗下的省级卫视频道。立足大湾区，主打粤港澳文化、经济资讯与华南特色文化。";
  }

  // 16. Migu / Streaming / Sports
  if (/咪咕/i.test(clean)) {
    return "中国移动咪咕公司旗下的体育与高清直播专线。全程高清转播奥运会、世界杯、五大联赛、NBA及顶级赛事。";
  }
  if (/爱奇艺|腾讯视频|优酷|哔哩哔哩|bilibili|bestv|百视通/i.test(clean)) {
    return "互联网流媒体平台专线轮播频道。24小时不间断高清轮播经典电影、热门陆剧、动漫或特色专题。";
  }

  // 17. Regional Fallbacks
  const isTaiwan = /台湾|台视|中视|华视|民视|东森|三立|中天|tvbs|纬来|公视/i.test(clean) || (groupNames && groupNames.some(g => /台湾|港台|台/i.test(g)));
  const isHongKong = /香港|tvb|翡翠|明珠|凤凰|viutv|港/i.test(clean) || (groupNames && groupNames.some(g => /香港|港台|港/i.test(g)));
  const isMacau = /澳门|澳视|莲花|澳/i.test(clean) || (groupNames && groupNames.some(g => /澳门|港台/i.test(g)));

  if (isTaiwan) {
    return `台湾地区广播电视机构旗下的频道（${raw}）。主要播报台湾地区政经新闻、本土戏剧与综合娱乐节目。`;
  }
  if (isHongKong) {
    return `香港特别行政区电视广播机构旗下的频道（${raw}）。面向粤港澳大湾区与全球观众提供粤语/英语剧集、即时新闻及综合节目。`;
  }
  if (isMacau) {
    return `澳门特别行政区电视广播机构旗下的频道（${raw}）。提供澳门本地新闻、文化博览与娱乐节目。`;
  }

  const provMatch = raw.match(/(北京|上海|天津|重庆|广东|浙江|江苏|山东|河南|四川|湖北|湖南|福建|江西|安徽|河北|山西|辽宁|吉林|黑龙江|广西|云南|贵州|陕西|甘肃|青海|海南|内蒙古|新疆|西藏|香港|澳门|台湾)/);
  if (provMatch) {
    return `${provMatch[1]}地区广播电视台旗下的电视频道（${raw}）。报道当地民生新闻、方言戏剧与地方文化资讯。`;
  }

  return `${raw} 电视频道，提供电视节目直播与综合资讯广播服务。`;
}

// AI Helper function to generate single channel description & notes
export async function describeChannelWithAi(
  channelName: string,
  groupNames?: string[],
  epgId?: string,
  existingNotes?: string,
  config?: Partial<AiConfig>
): Promise<string> {
  const trimmed = (channelName || "").trim();
  if (!trimmed) {
    throw new Error("频道名称不能为空");
  }

  const detailedFallback = deduceDetailedChannelDescription(trimmed, groupNames, epgId);

  const effectiveConfig: AiConfig = resolveEffectiveAiConfig(config || {});
  const activeProvider = effectiveConfig?.provider || "builtin";
  const hasKey = Boolean(effectiveConfig?.apiKey?.trim() || (activeProvider === "gemini" && process.env.GEMINI_API_KEY));

  if (activeProvider === "builtin" || !hasKey) {
    return detailedFallback;
  }

  const prompt = `请为以下电视频道撰写一份准确、详实且极富参考价值的频道描述与备注（控制在 40-90 字以内）：

频道名称：【${trimmed}】
${groupNames && groupNames.length > 0 ? `所属分类：${groupNames.join(", ")}\n` : ""}${epgId ? `EPG标识：${epgId}\n` : ""}${existingNotes ? `原有备注：${existingNotes}\n` : ""}知识库提示：${detailedFallback}

【严格编写规范（非常重要）】：
1. 港台及海外频道（重点）：必须明确标明【具体地区】（如台湾地区、香港特别行政区、澳门特别行政区、美国等）、【出品或运营机构/电视台】（如台湾三立电视 SET、香港TVB/电视广播有限公司、东森电视 EBC、旺旺中天 CTi、联意制作 TVBS、民视 FTV、凤凰卫视、HBO等）、【所属频道系列】（如三立新闻系列、TVB翡翠台系列等）、【主要播放内容】（如24小时即时新闻、政论爆料节目《关键时刻》《少康战情室》《郑知道了》、闽南语/粤语戏剧、八点档大戏、流行综艺等）以及【频道号或历史背景更迭】（如：台湾有线电视CH54频道、中天新闻台于2020年底转战YouTube及网络全媒体直播、TVB翡翠台为香港收视最高的粤语旗舰频道等）。
2. 央视/省级卫视/地方台：必须标明归属机构（如中央广播电视总台 CMG、湖南广播电视台、上海广播电视台 SMG 等）、频道定位及旗舰节目（如 CCTV-13 新闻频道的《新闻联播》《焦点访谈》《新闻1+1》；湖南卫视的青春流行综艺与金鹰独播剧场等）。
3. 轮播/网络/体育/特色频道：必须标明源头平台（如咪咕视频、爱奇艺、百视通 BesTV 等）及播放特色（如24小时周星驰电影轮播、4K杜比影院、KPL电竞赛事专线等）。
4. 绝不敷衍：绝对禁止输出类似“xxx电视频道，分类于 [xxx]”、“标准电视频道”等任何毫无信息量的套话模板！

严格按 JSON 格式输出：
{
  "description": "详细的频道描述与备注文字"
}`;

  try {
    let rawOutput = "";
    if (activeProvider === "gemini") {
      rawOutput = await callGeminiApi(prompt);
    } else {
      rawOutput = await callOpenAiCompatible(effectiveConfig, prompt, true);
    }

    const parsed = extractJsonFromText(rawOutput);
    let resultDesc = "";
    if (parsed && parsed.description) {
      resultDesc = String(parsed.description).trim();
    } else {
      resultDesc = rawOutput.replace(/[{}"']/g, "").trim();
    }

    if (!resultDesc || resultDesc.includes("分类于 [") || resultDesc.includes("标准电视频道") || resultDesc.length < 12) {
      return detailedFallback;
    }

    return resultDesc;
  } catch (err: any) {
    console.warn(`[AI Channel Describe Error on '${trimmed}']:`, err.message || err);
    return detailedFallback;
  }
}

// AI Helper function to batch generate channel descriptions
export async function batchDescribeChannelsWithAi(
  channelsList: Array<{ id: string; name: string; groupNames?: string[]; epgId?: string; description?: string }>,
  config?: Partial<AiConfig>
): Promise<Array<{ id: string; description: string }>> {
  if (!Array.isArray(channelsList) || channelsList.length === 0) {
    return [];
  }

  const effectiveConfig: AiConfig = resolveEffectiveAiConfig(config || {});
  const activeProvider = effectiveConfig?.provider || "builtin";
  const hasKey = Boolean(effectiveConfig?.apiKey?.trim() || (activeProvider === "gemini" && process.env.GEMINI_API_KEY));

  const fallbackMap = new Map<string, string>();
  channelsList.forEach((ch) => {
    fallbackMap.set(ch.id, deduceDetailedChannelDescription(ch.name, ch.groupNames, ch.epgId));
  });

  if (activeProvider === "builtin" || !hasKey) {
    return channelsList.map((ch) => ({
      id: ch.id,
      description: fallbackMap.get(ch.id) || `${ch.name} 电视频道`
    }));
  }

  const promptChannels = channelsList
    .map((c, i) => `${i + 1}. [ID: ${c.id}] 名称: ${c.name}, 分类: ${c.groupNames?.join("/") || "其它"}`)
    .join("\n");

  const prompt = `请为以下 ${channelsList.length} 个电视频道批量生成详细、专业、信息密集的频道描述与备注（每个频道 40-80 字以内）：

${promptChannels}

【严格编写规范（非常重要）】：
1. 港台及海外频道：必须明确标明【地区】（如台湾地区、香港特别行政区、澳门特别行政区、美国等）、【运营电视台/机构】（如台湾三立电视SET、香港TVB、东森EBC、旺旺中天CTi、TVBS、民视FTV、凤凰卫视、HBO等）、【主要播放内容与代表节目】（如24小时即时新闻、政论节目《关键时刻》《少康战情室》《郑知道了》、闽南语/粤语剧集、八点档大戏、流行综艺等）以及【频道号/历史背景】（如台湾有线电视CH54频道、中天转YouTube直播等）。
2. 央视/省级卫视/地方台：标明归属机构（如中央广播电视总台CMG、湖南广电）、频道定位与核心节目（如《新闻联播》《焦点访谈》《快乐大本营》等）。
3. 轮播/网络/体育/特色频道：标明源平台（咪咕视频、爱奇艺、百视通等）与主题内容（如周星驰电影轮播、4K影院、电竞赛事等）。
4. 绝对禁止输出类似“xxx电视频道，分类于 [xxx]”等无用句式模板！

严格按以下 JSON 数组格式输出：
[
  {
    "id": "频道ID",
    "description": "详细的频道描述与备注"
  }
]`;

  try {
    let rawOutput = "";
    if (activeProvider === "gemini") {
      rawOutput = await callGeminiApi(prompt);
    } else {
      rawOutput = await callOpenAiCompatible(effectiveConfig, prompt, true);
    }

    const parsed = extractJsonFromText(rawOutput);
    const results: Array<{ id: string; description: string }> = [];

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const id = String(item.id || "");
        let desc = String(item.description || "").trim();
        if (!desc || desc.includes("分类于 [") || desc.includes("标准电视频道") || desc.length < 12) {
          desc = fallbackMap.get(id) || "";
        }
        if (id && desc) {
          results.push({ id, description: desc });
        }
      }
    }

    channelsList.forEach((ch) => {
      if (!results.some((r) => r.id === ch.id)) {
        results.push({
          id: ch.id,
          description: fallbackMap.get(ch.id) || `${ch.name} 电视频道`
        });
      }
    });

    return results;
  } catch (err: any) {
    console.warn("[Batch Describe AI Error]:", err.message || err);
    return channelsList.map((ch) => ({
      id: ch.id,
      description: fallbackMap.get(ch.id) || `${ch.name} 电视频道`
    }));
  }
}

