import path from "path";
import fs from "fs";
import * as OpenCC from "opencc-js";
import { detectProvinceAndIspFromName } from "../geo_channels";
import { resolveChannelLogo } from "../aiService";

export { resolveChannelLogo };

const convertTraditionalToSimplified = OpenCC.Converter({ from: "t", to: "cn" });

export function toSimplifiedChinese(str: string): string {
  if (!str) return str || "";
  try {
    return convertTraditionalToSimplified(str);
  } catch (_) {
    return str;
  }
}

export function stripBitrateAndResolution(name: string): string {
  if (!name) return "";
  let clean = name.trim();
  clean = toSimplifiedChinese(clean);

  // Remove common Chinese/English quality tags optionally appended mid-string or at the end
  // Preserve 4K, 8K, and 超高清 as they distinguish dedicated ultra-high-definition channels
  clean = clean.replace(/(?:\s+|-|_)*(?:(?<!超)高清|超清(?!高)|标清|蓝光|原画|1080[pPiI]|720[pPiI]|576[pPiI]|480[pPiI]|HEVC|hevc|H265|h265|H264|h264)+/g, " ");

  // Remove bracketed resolution or bitrate, e.g. "[1080p]", "(4M1080)", "[7.5M1080]" (keep [4K] and [8K])
  clean = clean.replace(/[\[(]\s*(?:480|576|720|1080|1280|1440|1920|2160|4320|\d+(?:\.\d+)?[MmGg]\d*)[pPiI]?\s*[\])]/gi, "");

  // Remove trailing or mid-string bandwidth and pixel specs (e.g., " 4M1080", " 7.5M1080", " 8M")
  clean = clean.replace(/(?:\s+|-|_)+(?:\d+(?:\.\d+)?[MmGg](?:[bB][pP][sS])?\d*[pPiI]?)/gi, "");

  // Remove trailing or mid-string numerical resolution tags (e.g., " 1080", " 720")
  clean = clean.replace(/(?:\s+|-|_)+(?:(?:480|576|720|1080|1280|1440|1920|2160|4320)(?:[pPiI]\d*|fps|FPS)?|\d+[pPiI]\d*)/gi, "");

  // Remove empty brackets or parentheses remaining from substitutions
  clean = clean.replace(/[\[(（【]\s*[\])）】]/g, "");
  clean = clean.replace(/(?:\s+|-|_)*[\[()（）【】\]]/g, "");

  return clean.trim();
}

const normChannelNameCache = new Map<string, string>();

// Normalize channel names by making them lower-case and stripping all spaces/whitespace to support smart matching (e.g., "cctv-1 综合" matches "cctv-1综合")
export function normalizeChannelName(name: string): string {
  if (!name) return "";
  const cached = normChannelNameCache.get(name);
  if (cached !== undefined) return cached;

  const cleanStr = toSimplifiedChinese(name);
  const stripped = stripBitrateAndResolution(cleanStr);
  let clean = stripped.toLowerCase().replace(/\s+/g, "");

  let res = "";
  if (clean.includes("4k") || clean.includes("8k")) {
    clean = clean.replace("超高清", "");
  }
  
  // Special handling for CCTV 4K, 8K, and 超高清 to distinguish them from standard CCTV channels
  if (/^cctv/i.test(clean)) {
    if (clean.includes("4k")) {
      res = "cctv4k";
    } else if (clean.includes("8k")) {
      res = "cctv8k";
    } else if (clean.includes("超高清")) {
      res = "cctv超高清";
    }
  }

  if (!res) {
    // Custom smart matching for CCTV channels (e.g., CCTV-1, CCTV1, CCTV1HD, CCTV-1综合, CCTV-1 综合HD, cctv 1, CCTV 5+)
    const cctvMatch = clean.match(/^cctv[-_]?(\d+)(\+)?(.*)$/);
    if (cctvMatch) {
      const num = cctvMatch[1];
      const plus = cctvMatch[2] || "";
      let sub = cctvMatch[3] || "";
      
      sub = sub
        .replace(/(hd|uhd|fhd|ud|(?<!超)高清|超清(?!高)|标清|sdi|channel|tv)/g, "")
        .replace(/(频道|电视台|台|版)$/, "")
        .trim();

      // Preserve regional and continent variants for CCTV channels (e.g., CCTV-4美洲, CCTV-4欧洲, CCTV-4亚洲)
      if (sub.includes("美洲") || sub.includes("america") || sub.includes("ame")) {
        res = `cctv${num}${plus}美洲`;
      } else if (sub.includes("欧洲") || sub.includes("europe") || sub.includes("euo") || sub.includes("eur")) {
        res = `cctv${num}${plus}欧洲`;
      } else if (sub.includes("亚洲") || sub.includes("asia")) {
        res = `cctv${num}${plus}亚洲`;
      } else {
        // List of standard generic CCTV sub-category descriptors that map to the primary channel
        const genericSubs = [
          "综合", "财经", "综艺", "中文国际", "中文", "国际", "体育", "电影",
          "国防军事", "军事", "电视剧", "纪录", "科教", "戏曲", "社会与法",
          "新闻", "少儿", "音乐", "奥林匹克", "农业农村", "农业", "农村农业"
        ];

        if (sub && !genericSubs.includes(sub)) {
          res = `cctv${num}${plus}${sub}`;
        } else {
          res = `cctv${num}${plus}`;
        }
      }
    }
  }

  if (!res) {
    // For other channels, remove hyphens, spaces, and common quality tags (preserving 4k, 8k, 超高清, and acronyms like FTV, TTV, CTV, CTS, PTS, TVBS, TVB)
    res = clean
      .replace(/[-_.\s]+/g, "")
      .replace(/(fhd|uhd|hd|sd|hevc|h265|h264|1080p|720p|(?<!超)高清|超清(?!高)|标清|sdi)/g, "")
      .replace(/(?<=[^\x00-\x7f]|.{3,})tv$/g, "")
      .replace(/(频道|电视台|台)$/, "");
  }

  if (normChannelNameCache.size > 30000) {
    normChannelNameCache.clear();
  }
  normChannelNameCache.set(name, res);
  return res;
}

// Generate default epgId from channel name. CCTV5 and CCTV5+ are distinguished by keeping '+'. If processed epgId is empty, fallback to channel name.
export function generateDefaultEpgId(name: string): string {
  if (!name) return "";
  // 1. Strip bitrate and resolution first
  let clean = stripBitrateAndResolution(name);
  
  // 2. Convert to lowercase
  clean = clean.toLowerCase();

  // 3. Remove spaces, hyphens, dots, underscores, braces, brackets, and common symbol noise
  clean = clean.replace(/[-_.\s※\(\)\[\]{\\}/]+/g, "");

  // Special handling for CCTV 4K, 8K, and 超高清
  if (/^cctv/i.test(clean)) {
    if (clean.includes("4k")) return "cctv4k";
    if (clean.includes("8k")) return "cctv8k";
    if (clean.includes("超高清")) return "cctv_chaogaoqing";
  }

  // 4. Custom matching for CCTV channels (CCTV-1, CCTV5+, CCTV-6电影, etc.)
  const cctvMatch = clean.match(/^cctv[-_]?(\d+)(\+)?(.*)$/);
  if (cctvMatch) {
    const num = cctvMatch[1];
    const plus = cctvMatch[2] || "";
    let sub = cctvMatch[3] || "";
    
    sub = sub
      .replace(/(fhd|uhd|hd|sd|hevc|h265|h264|1080p|720p|(?<!超)高清|超清(?!高)|标清|sdi|channel|tv)/g, "")
      .replace(/(频道|电视台|台|版)$/, "")
      .trim();

    if (sub.includes("美洲") || sub.includes("america") || sub.includes("ame")) {
      return `cctv${num}${plus}_meizhou`;
    }
    if (sub.includes("欧洲") || sub.includes("europe") || sub.includes("euo") || sub.includes("eur")) {
      return `cctv${num}${plus}_ouzhou`;
    }
    if (sub.includes("亚洲") || sub.includes("asia")) {
      return `cctv${num}${plus}_yazhou`;
    }

    return `cctv${num}${plus}`;
  }

  // 5. Remove quality/format words but ONLY if they are not the sole text (preserving 4k, 8k, 超高清).
  const noiseRegex = /(fhd|uhd|hd|sd|hevc|h265|h264|1080p|720p|(?<!超)高清|超清(?!高)|标清|sdi|channel|tv)/g;
  let withoutNoise = clean.replace(noiseRegex, "");
  if (withoutNoise.trim().length > 0) {
    clean = withoutNoise;
  }

  // 6. Return lowercase alphanumeric/Chinese sequence, or fallback to normalized text if empty
  let processed = clean.trim();
  return processed || name.toLowerCase().trim();
}

export interface DefaultAliasGroup {
  template: string;
  aliases: string[];
}

export const BUILTIN_DEFAULT_ALIASES: string[][] = [
  // Taiwan 主要无线与热门电视频道 (覆盖繁简异体字与常见命名变体)
  ["民视", "民視", "民视无线台", "民視無線台", "民视主频", "民視主頻", "民视综合", "民視綜合", "FTV", "FTV民视", "FTV民視", "民间全民电视"],
  ["民视第一台", "民視第一台", "民视第一", "FTV1"],
  ["民视台湾台", "民視台灣台", "民视台湾", "FTV Taiwan"],
  ["民视新闻台", "民視新聞台", "民视新闻", "民視新聞", "FTV News"],
  ["民视综艺台", "民視綜藝台", "民视综艺"],
  ["台视", "台視", "台视主频", "台視主頻", "台视综合", "臺灣電視", "台湾电视", "TTV", "TTV台视", "TTV台視"],
  ["台视新闻台", "台視新聞台", "台视新闻", "台視新聞", "TTV News"],
  ["台视财经台", "台視財經台", "台视财经"],
  ["台视综合台", "台視綜合台", "台视综合"],
  ["中视", "中視", "中视主频", "中視主頻", "中视无线台", "中国电视", "CTV", "CTV中视", "CTV中視"],
  ["中视新闻台", "中视新闻", "中視新聞台", "中視新聞", "CTV News"],
  ["中视经典台", "中視經典台", "中视经典"],
  ["中视菁采台", "中視菁采台", "中视精采台", "中视精彩台"],
  ["华视", "華視", "华视主频", "華視主頻", "中华电视", "CTS", "CTS华视", "CTS華視"],
  ["华视新闻资讯台", "華視新聞資訊台", "华视新闻", "華視新聞", "CTS News"],
  ["华视教育体育文化台", "華視教育體育文化台", "华视教育文化台", "华视教育"],
  ["华视闽南语频道", "華視閩南語頻道", "华视闽南", "华视台语台", "华视闽南语"],
  ["公视", "公視", "公视主频", "公視主頻", "公共电视", "PTS", "PTS公视", "PTS公視"],
  ["公视台语台", "公視台語台", "公视台湾台", "公視台灣台", "公视台语"],
  ["公视戏剧台", "公視戲劇台", "公视戏剧"],
  ["TVBS", "TVBS主频", "TVBS综合", "无线卫星电视台"],
  ["TVBS新闻台", "TVBS新聞台", "TVBS新闻", "TVBS新聞", "TVBS-NEWS", "TVBS NEWS"],
  ["TVBS欢乐台", "TVBS歡樂台", "TVBS欢乐"],
  ["TVBS精采台", "TVBS精彩台", "TVBS精采", "TVBS精彩"],
  ["三立台湾台", "三立台灣台", "三立台湾", "三立台灣"],
  ["三立都会台", "三立都會台", "三立都会", "三立都會"],
  ["三立新闻台", "三立新聞台", "三立新闻", "三立新聞", "三立新闻iNEWS", "三立新聞iNEWS", "三立iNEWS"],
  ["三立综合台", "三立 rattle", "三立綜合台", "三立综合"],
  ["东森新闻台", "東森新聞台", "东森新闻", "東森新聞", "EBC News"],
  ["东森综合台", "東森綜合台", "东森综合", "東森綜合", "EBC Variety"],
  ["东森电影台", "東森電影台", "东森电影", "東森電影", "EBC Movie"],
  ["东森洋片台", "東森洋片台", "东森洋片"],
  ["东森戏剧台", "東森戲劇台", "东森戏剧", "東森戲劇"],
  ["东森幼幼台", "東森幼幼台", "东森幼幼", "YOYO TV", "YoYo TV"],
  ["东森超视", "東森超視", "东森超视台"],
  ["东森财经新闻台", "東森財經新聞台", "东森财经", "東森財經"],
  ["中天新闻台", "中天新聞台", "中天新闻", "中天新聞", "CTi News"],
  ["中天综合台", "中天綜合台", "中天综合", "中天綜合"],
  ["中天娱乐台", "中天娛樂台", "中天娱乐"],
  ["年代新闻台", "年代新聞台", "年代新闻", "年代新聞"],
  ["年代MUCH台", "年代MUCH", "年代much台"],
  ["壹电视新闻台", "壹電視新聞台", "壹电视新闻", "壹電視新聞"],
  ["壹电视综合台", "壹電視綜合台", "壹电视综合"],
  ["纬来日本台", "緯來日本台", "纬来日本", "緯來日本"],
  ["纬来体育台", "緯來體育台", "纬来体育", "緯來體育"],
  ["纬来综合台", "緯來綜合台", "纬来综合", "緯來綜合"],
  ["纬来电影台", "緯來電影台", "纬来电影", "緯來電影"],
  ["纬来育乐台", "緯來育樂台", "纬来育乐", "緯來育樂"],
  ["纬来戏剧台", "緯來戲劇台", "纬来戏剧", "緯來戲劇"],
  ["八大第一台", "八大第一", "GTV One"],
  ["八大综合台", "八大綜合台", "八大综合", "GTV Variety"],
  ["八大戏剧台", "八大戲劇台", "八大戏剧", "GTV Drama"],
  ["非凡新闻台", "非凡新聞台", "非凡新闻", "非凡新聞"],
  ["非凡商业台", "非凡商業台", "非凡商业", "非凡商業"],
  ["镜电视新闻台", "鏡電視新聞台", "镜电视新闻", "鏡電視新聞", "镜新闻", "鏡新聞"],
  ["客家电视台", "客家電視台", "客家电视", "客家電視"],
  ["大爱电视", "大愛電視", "大爱一台", "大爱电视台", "大愛電視台"],
  ["国兴卫视", "國興衛視"],
  ["爱尔达体育1台", "愛爾達體育1台", "爱尔达体育一台", "ELTA 1"],
  ["爱尔达体育2台", "愛爾達體育2台", "爱尔达体育二台", "ELTA 2"],
  ["爱尔达体育3台", "愛爾達體育3台", "爱尔达体育三台", "ELTA 3"],
  ["爱尔达影剧台", "愛爾達影劇台", "爱尔达影剧"],
  ["爱尔达综合台", "愛爾達綜合台", "爱尔达综合"],
  ["爱尔达娱乐台", "愛爾達娛樂台", "爱尔达娱乐"],
  ["博斯运动1台", "博斯運動一台", "博斯运动一台"],
  ["博斯无限台", "博斯無限台", "博斯无限"],
  // 香港与其它
  ["翡翠台", "TVB翡翠台", "无线翡翠台"],
  ["明珠台", "TVB明珠台", "无线明珠台"],
  ["J2", "TVB J2", "J2台"],
  ["无线新闻台", "無綫新聞台", "TVB新闻台", "TVB News"],
  ["凤凰卫视中文台", "凤凰中文", "鳳凰衛視中文台"],
  ["凤凰卫视资讯台", "凤凰资讯", "鳳凰衛視資訊台"],
  // 央视与卫视
  ["CCTV-1 综合", "CCTV-1", "CCTV1", "CCTV-1综合", "CCTV1综合", "中央一台", "中央1台", "央视综合", "央视一套"],
  ["CCTV-2 财经", "CCTV-2", "CCTV2", "CCTV-2财经", "CCTV2财经", "中央二台", "中央2台", "央视财经", "央视二套"],
  ["CCTV-3 综艺", "CCTV-3", "CCTV3", "CCTV-3综艺", "CCTV3综艺", "中央三台", "中央3台", "央视综艺", "央视三套"],
  ["CCTV-4 中文国际", "CCTV-4", "CCTV4", "CCTV-4中文国际", "CCTV4中文国际", "中央四台", "中央4台", "中文国际", "央视四套"],
  ["CCTV-4 欧洲", "CCTV4欧洲", "CCTV-4欧洲", "CCTV-4 欧洲", "CCTV4 Europe", "CCTV-4 Europe", "CCTV-4 中文国际(欧洲版)", "央视四套欧洲"],
  ["CCTV-4 美洲", "CCTV4美洲", "CCTV-4美洲", "CCTV-4 美洲", "CCTV4 America", "CCTV-4 America", "CCTV-4 中文国际(美洲版)", "央视四套美洲"],
  ["CCTV-5 体育", "CCTV-5", "CCTV5", "CCTV-5体育", "CCTV5体育", "中央五台", "中央5台", "央视体育", "央视五套"],
  ["CCTV-5+ 体育赛事", "CCTV-5+", "CCTV5+", "CCTV-5+体育赛事", "CCTV5+体育赛事", "中央五加", "中央5+", "CCTV5plus", "央视体育赛事"],
  ["CCTV-6 电影", "CCTV-6", "CCTV6", "CCTV-6电影", "CCTV6电影", "中央六台", "中央6台", "央视电影", "央视六套"],
  ["CCTV-7 国防军事", "CCTV-7", "CCTV7", "CCTV-7国防军事", "CCTV7国防军事", "中央七台", "中央7台", "央视国防军事", "央视军事"],
  ["CCTV-8 电视剧", "CCTV-8", "CCTV8", "CCTV-8电视剧", "CCTV8电视剧", "中央八台", "中央8台", "央视电视剧", "央视八套"],
  ["CCTV-9 纪录", "CCTV-9", "CCTV9", "CCTV-9纪录", "CCTV9纪录", "中央九台", "中央9台", "央视纪录", "央视记录"],
  ["CCTV-10 科教", "CCTV-10", "CCTV10", "CCTV-10科教", "CCTV10科教", "中央十台", "中央10台", "央视科教"],
  ["CCTV-11 戏曲", "CCTV-11", "CCTV11", "CCTV-11戏曲", "CCTV11戏曲", "中央十一台", "中央11台", "央视戏曲"],
  ["CCTV-12 社会与法", "CCTV-12", "CCTV12", "CCTV-12社会与法", "CCTV12社会与法", "中央十二台", "中央12台", "央视社会与法", "央视法制"],
  ["CCTV-13 新闻", "CCTV-13", "CCTV13", "CCTV-13新闻", "CCTV13新闻", "中央十三台", "中央13台", "央视新闻"],
  ["CCTV-14 少儿", "CCTV-14", "CCTV14", "CCTV-14少儿", "CCTV14少儿", "中央十四台", "中央14台", "央视少儿"],
  ["CCTV-15 音乐", "CCTV-15", "CCTV15", "CCTV-15音乐", "CCTV15音乐", "中央十五台", "中央15台", "央视音乐"],
  ["CCTV-16 奥林匹克", "CCTV-16", "CCTV16", "CCTV-16奥林匹克", "CCTV16奥林匹克", "中央十六台", "中央16台", "央视奥林匹克"],
  ["CCTV-17 农业农村", "CCTV-17", "CCTV17", "CCTV-17农业农村", "CCTV17农业农村", "中央十七台", "中央17台", "央视农业农村", "央视农业"],
  ["CCTV-4K 超高清", "CCTV-4K", "CCTV4K", "CCTV-4K超高清"],
  ["CCTV-8K 超高清", "CCTV-8K", "CCTV8K", "CCTV-8K超高清"],
  ["湖南卫视", "湖南台", "芒果TV"],
  ["浙江卫视", "浙江台", "蓝莓台"],
  ["江苏卫视", "江苏台", "荔枝台"],
  ["东方卫视", "上海东方卫视", "上海卫视", "番茄台"],
  ["北京卫视", "BTV北京卫视", "北京台"],
  ["广东卫视", "广东台"],
  ["深圳卫视", "深圳台"]
];

export const loadedDefaultAliases: DefaultAliasGroup[] = [];
export const aliasTemplateLookupMap = new Map<string, { templateName: string; aliases: string[] }>();

function registerAliasGroup(template: string, aliases: string[]) {
  const merged = Array.from(new Set([template, ...aliases]));
  const groupObj = { template, aliases: merged };
  loadedDefaultAliases.push(groupObj);
  const entry = { templateName: template, aliases: merged };
  for (const a of merged) {
    const normA = normalizeChannelName(a);
    if (normA && !aliasTemplateLookupMap.has(normA)) {
      aliasTemplateLookupMap.set(normA, entry);
    }
  }
}

export function loadDefaultAliases(dataDir?: string) {
  loadedDefaultAliases.length = 0;
  aliasTemplateLookupMap.clear();

  // 1. First seed built-in knowledge base (covering Taiwan, Hong Kong, CCTV, Satellite)
  for (const item of BUILTIN_DEFAULT_ALIASES) {
    if (item.length > 0) {
      registerAliasGroup(item[0], item);
    }
  }

  // 2. Overlay custom aliases from data/default_aliases.txt if present
  const DATA_DIR = dataDir || path.join(process.cwd(), "data");
  const filePath = path.join(DATA_DIR, "default_aliases.txt");
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split(/\r?\n/);
      for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("|")) {
          line = line.substring(1).trim();
        }
        const parts = line.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length > 0) {
          registerAliasGroup(parts[0], parts);
        }
      }
      console.log(`[Aliases] Loaded ${loadedDefaultAliases.length} default channel alias templates.`);
    } catch (e) {
      console.error("[Aliases] Failed to load default_aliases.txt", e);
    }
  }
}

// Automatically load default aliases on module initialization
loadDefaultAliases();

export function findAliasTemplate(rawName: string): { templateName: string; aliases: string[] } | null {
  const normRaw = normalizeChannelName(rawName);
  if (!normRaw) return null;
  const match = aliasTemplateLookupMap.get(normRaw);
  if (match) return match;

  for (const group of loadedDefaultAliases) {
    if (group.aliases.some(a => normalizeChannelName(a) === normRaw)) {
      const found = { templateName: group.template, aliases: group.aliases };
      aliasTemplateLookupMap.set(normRaw, found);
      return found;
    }
  }
  return null;
}

export function parseIspAndProvince(name: string, streamUrls: string[] = []): { province: string; isp: string } {
  const { detectedProvince, detectedIsp } = detectProvinceAndIspFromName(name, streamUrls);
  return {
    province: detectedProvince || "全国",
    isp: detectedIsp || "BGP"
  };
}

export function getBuildVersionInfo() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const mins = pad(now.getMinutes());
  const secs = pad(now.getSeconds());

  const formattedTime = `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
  const versionId = `${year}${month}${day}${hours}${mins}${secs}`;

  return { formattedTime, versionId };
}

