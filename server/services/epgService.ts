import fs from "fs";
import path from "path";
import zlib from "zlib";
import { XMLParser } from "fast-xml-parser";
import { EpgSource, Channel, EpgEntry, EpgCacheIndexed } from "../types";
import { channels, epgSources, githubProxy, saveData } from "../store";
import { fetchBufferWithFallback } from "../utils/network";
import {
  normalizeChannelName,
  findAliasTemplate,
  generateDefaultEpgId,
  resolveChannelLogo,
  getBuildVersionInfo
} from "../utils/text";

export const EPG_CACHE_DIR = path.join(process.cwd(), "data", "epg_cache");
export const EPG_EXPORT_XML_PATH = path.join(process.cwd(), "data", "integrated_epg.xml");
export const EPG_EXPORT_GZ_PATH = path.join(process.cwd(), "data", "integrated_epg.xml.gz");

export const loadedEpgCaches: Record<string, EpgCacheIndexed> = {};

let integratedEpgXmlCache: string | null = null;
let integratedEpgXmlGzCache: Buffer | null = null;
let integratedEpgCacheTime = 0;
let integratedEpgEtag = "";

export function invalidateIntegratedEpgCache() {
  integratedEpgXmlCache = null;
  integratedEpgXmlGzCache = null;
  integratedEpgCacheTime = 0;
  integratedEpgEtag = "";
  try {
    if (fs.existsSync(EPG_EXPORT_XML_PATH)) fs.unlinkSync(EPG_EXPORT_XML_PATH);
    if (fs.existsSync(EPG_EXPORT_GZ_PATH)) fs.unlinkSync(EPG_EXPORT_GZ_PATH);
  } catch (e) {}
}

function ensureArray<T>(val: any): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

function getText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    if (node["#text"] !== undefined) return String(node["#text"]);
    if (node.text !== undefined) return String(node.text);
    for (const key in node) {
      if (typeof node[key] === "string" && key !== "lang") {
        return node[key];
      }
    }
  }
  return "";
}

export function parseXmltvTime(timeStr: string): { dateStr: string; timeStr: string } {
  if (!timeStr) return { dateStr: "", timeStr: "" };
  const str = timeStr.trim();
  const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
  if (match) {
    const [_, y, m, d, hh, mm, ss, tz] = match;
    if (tz) {
      try {
        const isoStr = `${y}-${m}-${d}T${hh}:${mm}:${ss}${tz.slice(0, 3)}:${tz.slice(3)}`;
        const dObj = new Date(isoStr);
        if (!isNaN(dObj.getTime())) {
          const localY = dObj.getFullYear();
          const localM = String(dObj.getMonth() + 1).padStart(2, "0");
          const localD = String(dObj.getDate()).padStart(2, "0");
          const localH = String(dObj.getHours()).padStart(2, "0");
          const localMin = String(dObj.getMinutes()).padStart(2, "0");
          return {
            dateStr: `${localY}-${localM}-${localD}`,
            timeStr: `${localH}:${localMin}`
          };
        }
      } catch (_) {}
    }
    return {
      dateStr: `${y}-${m}-${d}`,
      timeStr: `${hh}:${mm}`
    };
  }
  return { dateStr: "", timeStr: "" };
}

export function isEpgDisclaimerProgram(title?: string, desc?: string): boolean {
  const rawTitle = (title || "").trim();
  const rawDesc = (desc || "").trim();
  if (!rawTitle && !rawDesc) return false;

  const disclaimerPatterns: RegExp[] = [
    /^由\s*[\S\s]+?\s*提供(节目单|服务|支持|赞助|整理|更新)?/i,
    /由\s*[\S\s]+?\s*(整理|发布|更新|赞助)提供/i,
    /由\s*【[\S\s]+?】\s*提供/i,
    /由\s*[a-zA-Z0-9_\u4e00-\u9fa5\.\:\-\@]+\s*提供(节目单|服务|支持|赞助)?/i,
    /^(本节目单|节目单|本EPG|EPG|本台节目单|本频道节目单|节目表)\s*(由|来自|更新于|制作于|由[\S\s]+?提供)/i,
    /(本节目单|节目单|本EPG|EPG|节目表)[\S\s]*?(由[\S\s]+?提供|来自[\S\s]+?|提供节目单|提供EPG)/i,
    /提供(节目单|EPG)(服务|支持)?$/i,
    /提供(节目单|EPG)服务/i,
    /^(欢迎访问|关注微信|关注公众号|加入QQ群|加入TG群|获取更多节目单|更多节目单请访问|更多节目单)/i,
    /(关注微信公众号|关注公众号|加入QQ群|加入TG群|加入微信群)[\S\s]*?(节目单|EPG|群|更新)/i,
    /更多节目单[\S\s]*?(访问|下载|关注|更新|获取)/i,
    /(epg\.pw|112114\.xyz|51zmt\.top|cntv\.cn|diyp|superepg|mytv|tiankong|livednow)[\S\s]*?(提供|节目单|服务|整理)/i,
    /^(https?:\/\/|www\.)\S+\s*(提供|节目单|EPG)?/i,
  ];

  for (const pattern of disclaimerPatterns) {
    if (pattern.test(rawTitle)) {
      return true;
    }
  }

  if (rawDesc) {
    const descPatterns: RegExp[] = [
      /由\s*[\S\s]+?\s*提供(节目单|服务|支持)?/i,
      /(本节目单|节目单|EPG)[\S\s]*?(由[\S\s]+?提供|来自[\S\s]+?)/i,
      /提供(节目单|EPG)服务/i,
    ];
    for (const pattern of descPatterns) {
      if (pattern.test(rawDesc) && /^(节目单|EPG|说明|公告|提示|00:00|今日节目|电视节目单|节目导视)$/i.test(rawTitle)) {
        return true;
      }
    }
  }

  return false;
}

export function buildEpgIndex(channelMap: Record<string, EpgEntry>): EpgCacheIndexed {
  const idMap = new Map<string, EpgEntry>();
  const nameMap = new Map<string, EpgEntry>();

  for (const [originalId, entry] of Object.entries(channelMap)) {
    if (!originalId) continue;
    
    if (entry.programs && Array.isArray(entry.programs)) {
      entry.programs = entry.programs.filter(p => !isEpgDisclaimerProgram(p.title, p.desc));
    }

    idMap.set(originalId.toLowerCase(), entry);

    const normId = normalizeChannelName(originalId);
    if (normId && !idMap.has(normId)) {
      idMap.set(normId, entry);
    }

    if (entry.displayNames && Array.isArray(entry.displayNames)) {
      for (const disp of entry.displayNames) {
        const normDisp = normalizeChannelName(disp);
        if (normDisp && !nameMap.has(normDisp)) {
          nameMap.set(normDisp, entry);
        }
      }
    }
  }

  return {
    raw: channelMap,
    idMap,
    nameMap,
  };
}

export function getEpgCache(sourceId: string): EpgCacheIndexed | null {
  const cachePath = path.join(EPG_CACHE_DIR, `${sourceId}.json`);
  if (!fs.existsSync(cachePath)) return null;
  if (loadedEpgCaches[sourceId]) {
    return loadedEpgCaches[sourceId];
  }
  try {
    const data = fs.readFileSync(cachePath, "utf-8");
    const rawMap: Record<string, EpgEntry> = JSON.parse(data);
    const indexed = buildEpgIndex(rawMap);
    loadedEpgCaches[sourceId] = indexed;
    return indexed;
  } catch (err) {
    console.error(`[EPG CACHE LOAD ERROR] for ${sourceId}:`, err);
    return null;
  }
}

export function findMatchingEpgEntry(ch: Channel, cache: EpgCacheIndexed): EpgEntry | null {
  if (!cache) return null;

  const chNameNorm = normalizeChannelName(ch.name);
  if (chNameNorm && cache.nameMap.has(chNameNorm)) {
    return cache.nameMap.get(chNameNorm)!;
  }

  if (ch.alias && Array.isArray(ch.alias)) {
    for (const a of ch.alias) {
      const aNorm = normalizeChannelName(a);
      if (aNorm && cache.nameMap.has(aNorm)) {
        return cache.nameMap.get(aNorm)!;
      }
    }
  }

  const aliasTemplate = findAliasTemplate(ch.name);
  if (aliasTemplate) {
    const tNorm = normalizeChannelName(aliasTemplate.templateName);
    if (tNorm && cache.nameMap.has(tNorm)) {
      return cache.nameMap.get(tNorm)!;
    }
    for (const a of aliasTemplate.aliases) {
      const aNorm = normalizeChannelName(a);
      if (aNorm && cache.nameMap.has(aNorm)) {
        return cache.nameMap.get(aNorm)!;
      }
    }
  }

  return null;
}

export function escapeXml(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case "\"": return "&quot;";
      default: return c;
    }
  });
}

export function getOrGenerateIntegratedEpgXml(): { xml: string; gz: Buffer; etag: string } {
  const now = Date.now();

  if (integratedEpgXmlCache && integratedEpgXmlGzCache && integratedEpgEtag) {
    return { xml: integratedEpgXmlCache, gz: integratedEpgXmlGzCache, etag: integratedEpgEtag };
  }

  try {
    if (fs.existsSync(EPG_EXPORT_XML_PATH) && fs.existsSync(EPG_EXPORT_GZ_PATH)) {
      const stats = fs.statSync(EPG_EXPORT_GZ_PATH);
      const xml = fs.readFileSync(EPG_EXPORT_XML_PATH, "utf-8");
      const gz = fs.readFileSync(EPG_EXPORT_GZ_PATH);
      const etag = `W/"epg-${Math.floor(stats.mtimeMs)}-${stats.size}"`;

      integratedEpgXmlCache = xml;
      integratedEpgXmlGzCache = gz;
      integratedEpgCacheTime = stats.mtimeMs;
      integratedEpgEtag = etag;

      return { xml, gz, etag };
    }
  } catch (e) {
    console.warn("[EPG DISK CACHE LOAD WARN]", e);
  }

  const { formattedTime, versionId } = getBuildVersionInfo();
  const xmlHeader = `<?xml version="1.0" encoding="utf-8"?>\n<!-- EPG Generated At: ${formattedTime} | Version: v${versionId} -->\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv generator-info-name="IPTV Channel Manager" generator-info-url="http://localhost:3000/" date="${versionId}">`;
  
  const activeEpgSources = epgSources.filter(s => s.active);
  const activeCaches = activeEpgSources
    .map(s => getEpgCache(s.id))
    .filter(Boolean) as EpgCacheIndexed[];

  const activeExportChannels = channels.filter((c) => !c.isolated);

  const channelTags = activeExportChannels.map((c) => {
    const epgIdEscaped = escapeXml(c.epgId || generateDefaultEpgId(c.name));
    const resolvedLogo = resolveChannelLogo(c.logo || "");
    return `  <channel id="${epgIdEscaped}">\n    <display-name lang="zh">${escapeXml(c.name)}</display-name>\n    <icon src="${escapeXml(resolvedLogo)}" />\n  </channel>`;
  }).join("\n");

  const programTags = activeExportChannels.map((c) => {
    const epgIdEscaped = escapeXml(c.epgId || generateDefaultEpgId(c.name));
    
    let matchedPrograms: any[] = [];
    let found = false;
    for (const cache of activeCaches) {
      const entry = findMatchingEpgEntry(c, cache);
      if (entry && entry.programs && entry.programs.length > matchedPrograms.length) {
        matchedPrograms = entry.programs;
        found = true;
      }
    }

    if (found && matchedPrograms.length > 0) {
      const cleanPrograms = matchedPrograms.filter((prog: any) => !isEpgDisclaimerProgram(prog.title, prog.desc));
      return cleanPrograms.map((prog: any) => {
        return `  <programme start="${escapeXml(prog.start)}" stop="${escapeXml(prog.stop)}" channel="${epgIdEscaped}">\n    <title lang="zh">${escapeXml(prog.title)}</title>\n    ${prog.desc ? `<desc lang="zh">${escapeXml(prog.desc)}</desc>` : ""}\n  </programme>`;
      }).join("\n");
    } else {
      return "";
    }
  }).join("\n");

  const xmlFooter = `</tv>`;
  const fullXml = `${xmlHeader}\n${channelTags}\n${programTags}\n${xmlFooter}`;
  const gzBuffer = zlib.gzipSync(Buffer.from(fullXml, "utf-8"));

  const etag = `W/"epg-${now}-${gzBuffer.length}"`;

  integratedEpgXmlCache = fullXml;
  integratedEpgXmlGzCache = gzBuffer;
  integratedEpgCacheTime = now;
  integratedEpgEtag = etag;

  try {
    fs.writeFileSync(EPG_EXPORT_XML_PATH, fullXml, "utf-8");
    fs.writeFileSync(EPG_EXPORT_GZ_PATH, gzBuffer);
  } catch (err) {
    console.error("[EPG DISK CACHE WRITE ERROR]", err);
  }

  return { xml: fullXml, gz: gzBuffer, etag };
}

export async function performEpgSync(source: EpgSource): Promise<boolean> {
  try {
    let targetUrl = source.url;
    if (targetUrl.includes("github.com") && !targetUrl.includes("raw.githubusercontent.com") && !targetUrl.includes("/raw/")) {
      targetUrl = targetUrl
        .replace("github.com", "raw.githubusercontent.com")
        .replace("/blob/", "/");
    }
    if (githubProxy && (targetUrl.includes("github.com") || targetUrl.includes("githubusercontent.com"))) {
      const proxyPrefix = githubProxy.endsWith("/") ? githubProxy : `${githubProxy}/`;
      targetUrl = `${proxyPrefix}${targetUrl}`;
    }
    console.log(`[EPG SYNC] Fetching ${source.name} from: ${targetUrl}`);
    
    const { buffer, isGzipped } = await fetchBufferWithFallback(targetUrl, "IPTV-Manager-EPG-Sync-Service");
                     
    let xmlText = "";
    if (isGzipped) {
      console.log(`[EPG SYNC] Detected Gzip compression for ${source.name}. Decompressing...`);
      try {
        const decompressed = zlib.gunzipSync(buffer);
        xmlText = decompressed.toString("utf-8");
      } catch (gzErr: any) {
        throw new Error(`Gzip decompression failed: ${gzErr.message}`);
      }
    } else {
      xmlText = buffer.toString("utf-8");
    }

    if (!xmlText.trim().startsWith("<?xml") && !xmlText.includes("<tv")) {
      throw new Error("Invalid EPG XML content, missing <tv> root");
    }
    console.log(`[EPG SYNC] Parsing XML of length ${xmlText.length}...`);
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: ""
    });
    const parsed = parser.parse(xmlText);
    const channelMap: Record<string, { displayNames: string[]; programs: { start: string; stop: string; title: string; desc: string }[] }> = {};
    const channelsList = ensureArray(parsed?.tv?.channel);
    for (const ch of channelsList) {
      const originalId = (ch as any).id;
      if (!originalId) continue;
      const displayNamesList = ensureArray((ch as any)["display-name"]).map(d => getText(d).trim()).filter(Boolean);
      channelMap[originalId] = {
        displayNames: displayNamesList,
        programs: []
      };
    }
    const programmesList = ensureArray(parsed?.tv?.programme);
    for (const prog of programmesList) {
      const chId = (prog as any).channel;
      if (!chId) continue;
      const start = (prog as any).start || "";
      const stop = (prog as any).stop || "";
      const title = getText((prog as any).title);
      const desc = getText((prog as any).desc);
      
      if (isEpgDisclaimerProgram(title, desc)) {
        continue;
      }

      if (!channelMap[chId]) {
        channelMap[chId] = { displayNames: [], programs: [] };
      }
      channelMap[chId].programs.push({ start, stop, title, desc });
    }
    if (!fs.existsSync(EPG_CACHE_DIR)) {
      fs.mkdirSync(EPG_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(
      path.join(EPG_CACHE_DIR, `${source.id}.json`),
      JSON.stringify(channelMap, null, 2),
      "utf-8"
    );
    delete loadedEpgCaches[source.id];
    invalidateIntegratedEpgCache();
    source.status = "success";
    source.lastSynced = new Date().toISOString();
    source.message = `同步成功，共导入 ${Object.keys(channelMap).length} 个频道节目源`;
    saveData();
    return true;
  } catch (error: any) {
    console.error(`[EPG SYNC ERROR] ${source.name}:`, error.message);
    source.status = "failed";
    source.message = error.message;
    source.lastSynced = new Date().toISOString();
    saveData();
    return false;
  }
}
