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
    // For other channels, remove hyphens, spaces, and common quality tags (preserving 4k, 8k, 超高清) to improve match rates
    res = clean
      .replace(/[-_.\s]+/g, "")
      .replace(/(hd|uhd|fhd|ud|(?<!超)高清|超清(?!高)|标清|sdi|channel|tv)/g, "")
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

export const loadedDefaultAliases: DefaultAliasGroup[] = [];
export const aliasTemplateLookupMap = new Map<string, { templateName: string; aliases: string[] }>();

export function loadDefaultAliases(dataDir?: string) {
  const DATA_DIR = dataDir || path.join(process.cwd(), "data");
  const filePath = path.join(DATA_DIR, "default_aliases.txt");
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split(/\r?\n/);
      loadedDefaultAliases.length = 0;
      aliasTemplateLookupMap.clear();
      for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("|")) {
          line = line.substring(1).trim();
        }
        const parts = line.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length > 0) {
          const template = parts[0];
          const aliases = Array.from(new Set([template, ...parts]));
          const groupObj = { template, aliases };
          loadedDefaultAliases.push(groupObj);
          
          const entry = { templateName: template, aliases };
          for (const a of aliases) {
            const normA = normalizeChannelName(a);
            if (normA && !aliasTemplateLookupMap.has(normA)) {
              aliasTemplateLookupMap.set(normA, entry);
            }
          }
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

