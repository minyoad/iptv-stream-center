import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Request } from "express";
import { LiveSource, Channel, Group } from "../types";
import { channels, groups } from "../store";
import { resolveChannelLogo, getBuildVersionInfo } from "../utils/text";
import { getDb } from "../db/sqlite";
import { getClientIpGeo } from "./speedTestService";

const DATA_DIR = path.join(process.cwd(), "data");
const PLAYLIST_CACHE_DIR = path.join(DATA_DIR, "playlist_cache");
const READABLE_DIR = path.join(DATA_DIR, "playlists_export");

if (!fs.existsSync(PLAYLIST_CACHE_DIR)) {
  fs.mkdirSync(PLAYLIST_CACHE_DIR, { recursive: true });
}
if (!fs.existsSync(READABLE_DIR)) {
  fs.mkdirSync(READABLE_DIR, { recursive: true });
}

interface ExportPlaylistCacheItem {
  content: string;
  etag: string;
  mtimeMs: number;
}

const exportPlaylistMemoryCache = new Map<string, ExportPlaylistCacheItem>();

export function invalidatePlaylistExportCache() {
  exportPlaylistMemoryCache.clear();
  try {
    if (fs.existsSync(PLAYLIST_CACHE_DIR)) {
      const files = fs.readdirSync(PLAYLIST_CACHE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(PLAYLIST_CACHE_DIR, file));
      }
    }
    if (fs.existsSync(READABLE_DIR)) {
      const files = fs.readdirSync(READABLE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(READABLE_DIR, file));
      }
    }
  } catch (_) {}
}

export function getPlaylistCacheKey(params: {
  format: string;
  category?: string;
  isp?: string;
  province?: string;
  status?: string;
  limit?: string | number;
  maxPerChannel?: string | number;
  baseUrl?: string;
  v?: string;
}): string {
  const rawKey = [
    params.format || "m3u",
    params.category || "",
    params.isp || "",
    params.province || "",
    params.status || "",
    params.limit || "",
    params.maxPerChannel || "",
    params.baseUrl || "",
    params.v || ""
  ].join("|");
  return crypto.createHash("md5").update(rawKey).digest("hex");
}

export function sortSourcesByGeo(sources: LiveSource[], clientProvince: string, clientIsp: string): LiveSource[] {
  if (!clientProvince && !clientIsp) return sources;
  
  return [...sources].sort((a, b) => {
    const getScore = (s: LiveSource) => {
      let score = 0;
      const srcProv = (s.province || "").trim();
      const srcIsp = (s.isp || "").trim();

      const normSrcProv = srcProv.replace(/省|市|自治区|特别行政区/g, "");
      const normClientProv = clientProvince.replace(/省|市|自治区|特别行政区/g, "");
      const provinceMatch = normClientProv && normSrcProv && (normSrcProv.includes(normClientProv) || normClientProv.includes(normSrcProv));
      
      const normSrcIsp = srcIsp.replace("中国", "");
      const normClientIsp = clientIsp.replace("中国", "");
      const ispMatch = normClientIsp && normSrcIsp && (normSrcIsp.includes(normClientIsp) || normClientIsp.includes(normSrcIsp));

      if (provinceMatch && ispMatch) {
        score += 100;
      } else if (provinceMatch) {
        score += 50;
      } else if (ispMatch && (srcProv === "全国" || !srcProv)) {
        score += 30;
      } else if (srcProv === "全国" || !srcProv) {
        score += 10;
      } else if (ispMatch) {
        score += 5;
      } else {
        score += 1;
      }

      if ((s.url || "").trim().toLowerCase().startsWith("rtsp://")) {
        if (!clientIsp || ispMatch || !srcIsp || srcIsp === "未知" || srcIsp.toUpperCase().includes("BGP") || srcProv === "全国") {
          score += 200;
        }
      }

      return score;
    };

    return getScore(b) - getScore(a);
  });
}

export function sortSourcesForExport(sources: LiveSource[]): LiveSource[] {
  return [...sources].sort((a, b) => {
    const statusWeightA = a.status === "active" ? 3 : (a.status === "inactive" ? 1 : 2);
    const statusWeightB = b.status === "active" ? 3 : (b.status === "inactive" ? 1 : 2);
    if (statusWeightA !== statusWeightB) {
      return statusWeightB - statusWeightA;
    }

    const isRtspA = (a.url || "").trim().toLowerCase().startsWith("rtsp://");
    const isRtspB = (b.url || "").trim().toLowerCase().startsWith("rtsp://");
    if (isRtspA !== isRtspB) {
      return isRtspA ? -1 : 1;
    }

    const latencyA = a.latency && a.latency > 0 ? a.latency : 9999;
    const latencyB = b.latency && b.latency > 0 ? b.latency : 9999;
    return latencyA - latencyB;
  });
}

export function getPlayableSources(sources: LiveSource[], targetIsp: string, targetProvince: string): LiveSource[] {
  let filtered = [...sources].filter(s => !s.isolated);
  
  if (targetIsp) {
    const normTargetIsp = targetIsp.trim();
    filtered = filtered.filter(src => {
      let srcIsp = (src.isp || "").trim();
      
      if (!srcIsp || srcIsp === "其它" || srcIsp === "其他") {
        const urlLower = (src.url || "").toLowerCase();
        if (urlLower.includes("chinamobile") || urlLower.includes("cmvideo") || urlLower.includes("cmcc") || urlLower.includes(".yd.") || urlLower.includes("migu")) {
          srcIsp = "移动";
        } else if (urlLower.includes("chinanet") || urlLower.includes("ctcc") || urlLower.includes("telecom") || urlLower.includes(".dx.")) {
          srcIsp = "电信";
        } else if (urlLower.includes("unicom") || urlLower.includes("cucc") || urlLower.includes(".lt.")) {
          srcIsp = "联通";
        } else if (urlLower.includes("cbn") || urlLower.includes("broadcasting") || urlLower.includes("guangdian")) {
          srcIsp = "广电";
        }
      }

      if (!srcIsp || srcIsp === "其它" || srcIsp === "其他") {
        return true;
      }
      const isBGP = srcIsp.toUpperCase().includes("BGP") || srcIsp.toUpperCase().includes("BPG");
      if (isBGP) {
        return true;
      }
      const sIsp = srcIsp.replace("中国", "");
      const tIsp = normTargetIsp.replace("中国", "");
      
      if (!sIsp) return true;

      if (sIsp.includes(tIsp) || tIsp.includes(sIsp)) {
        return true;
      }
      return false;
    });
  }

  if (targetIsp || targetProvince) {
    filtered = sortSourcesByGeo(filtered, targetProvince, targetIsp);
  }

  return filtered;
}

export function getOrGeneratePlaylistExport(
  params: {
    format: "m3u" | "txt";
    category?: string;
    isp?: string;
    province?: string;
    status?: string;
    limit?: string | number;
    maxPerChannel?: string | number;
    baseUrl?: string;
    v?: string;
  },
  generatorFn: () => string
): { content: string; etag: string } {
  const cacheKey = getPlaylistCacheKey(params);
  const now = Date.now();

  const memItem = exportPlaylistMemoryCache.get(cacheKey);
  if (memItem) {
    return { content: memItem.content, etag: memItem.etag };
  }

  const ext = params.format === "m3u" ? ".m3u" : ".txt";
  const filePath = path.join(PLAYLIST_CACHE_DIR, `${cacheKey}${ext}`);

  try {
    if (!fs.existsSync(PLAYLIST_CACHE_DIR)) {
      fs.mkdirSync(PLAYLIST_CACHE_DIR, { recursive: true });
    }
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, "utf-8");
      const etag = `W/"pl-${cacheKey.slice(0, 8)}-${Math.floor(stats.mtimeMs)}-${content.length}"`;
      exportPlaylistMemoryCache.set(cacheKey, { content, etag, mtimeMs: stats.mtimeMs });
      return { content, etag };
    }
  } catch (e) {
    console.warn("[PLAYLIST DISK CACHE LOAD WARN]", e);
  }

  const content = generatorFn();
  const etag = `W/"pl-${cacheKey.slice(0, 8)}-${now}-${content.length}"`;

  exportPlaylistMemoryCache.set(cacheKey, { content, etag, mtimeMs: now });

  try {
    if (!fs.existsSync(PLAYLIST_CACHE_DIR)) {
      fs.mkdirSync(PLAYLIST_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");

    if (!fs.existsSync(READABLE_DIR)) {
      fs.mkdirSync(READABLE_DIR, { recursive: true });
    }
    const parts: string[] = [params.format || "m3u"];
    if (params.category) parts.push(params.category);
    if (params.isp) parts.push(params.isp);
    if (params.province) parts.push(params.province);
    if (params.status) parts.push(`status_${params.status}`);
    const humanName = (parts.length > 1 ? parts.join("_") : parts[0] + "_all") + (params.format === "txt" ? ".txt" : ".m3u");
    fs.writeFileSync(path.join(READABLE_DIR, humanName.replace(/[<>:"/\\|?*]+/g, "_")), content, "utf-8");
  } catch (err) {
    console.error("[PLAYLIST DISK CACHE WRITE ERROR]", err);
  }

  return { content, etag };
}

export function generateM3uPlaylist(options: {
  baseUrl: string;
  isp?: string;
  province?: string;
  category?: string;
  status?: string;
  maxPerChannel?: number;
}): string {
  const { baseUrl, isp, province, category, status, maxPerChannel } = options;
  const { formattedTime, versionId } = getBuildVersionInfo();
  
  let playlistRows = [
    `#EXTM3U x-tvg-url="${baseUrl}/api/export/epg.xml.gz" build-version="${versionId}"`,
    `# Playlist Version: v${versionId}`,
    `# Generated At: ${formattedTime}`
  ];

  let filteredGroups = [...groups];
  if (category) {
    filteredGroups = filteredGroups.filter(g => g.name === category);
  }
  filteredGroups.push({ id: "g_other", name: "其它频道" });

  filteredGroups.forEach((group) => {
    if (group.isolated) return;
    channels.forEach((channel) => {
      if (channel.isolated) return;
      const isInGroup = channel.groupIds.includes(group.id);
      const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
      if (!isInGroup && !isFallback) return;
      
      let processedSources = channel.sources || [];
      processedSources = getPlayableSources(processedSources, isp || "", province || "");
      if (status && status !== "all") {
        processedSources = processedSources.filter(source => source.status === status);
      } else if (!status) {
        processedSources = processedSources.filter(source => source.status === "active");
      }
      processedSources = sortSourcesForExport(processedSources);
      
      const limit = maxPerChannel && maxPerChannel > 0 ? maxPerChannel : 15;
      const sourcesToExport = processedSources.slice(0, limit);
      sourcesToExport.forEach(bestSource => {
        const subLogo = resolveChannelLogo(channel.logo || "");
        playlistRows.push(
          `#EXTINF:-1 tvg-id="${channel.epgId}" tvg-name="${channel.name}" tvg-logo="${subLogo}" group-title="${group.name}",${channel.name}`
        );
        playlistRows.push(bestSource.url);
      });
    });
  });

  return playlistRows.join("\n");
}

export function generateTxtPlaylist(options: {
  baseUrl: string;
  isp?: string;
  province?: string;
  category?: string;
  status?: string;
  maxPerChannel?: number;
}): string {
  const { isp, province, category, status, maxPerChannel } = options;
  const { formattedTime, versionId } = getBuildVersionInfo();
  
  let playlistRows: string[] = [
    `# Playlist Version: v${versionId}`,
    `# Generated At: ${formattedTime}`,
    ""
  ];

  let filteredGroups = [...groups];
  if (category) {
    filteredGroups = filteredGroups.filter(g => g.name === category);
  }
  filteredGroups.push({ id: "g_other", name: "其它频道" });

  filteredGroups.forEach((group) => {
    if (group.isolated) return;
    let groupChannels: string[] = [];
    
    channels.forEach((channel) => {
      if (channel.isolated) return;
      const isInGroup = channel.groupIds.includes(group.id);
      const isFallback = group.id === "g_other" && (channel.groupIds.length === 0 || !channel.groupIds.some(id => groups.find(g => g.id === id)));
      if (!isInGroup && !isFallback) return;
      
      let processedSources = channel.sources || [];
      processedSources = getPlayableSources(processedSources, isp || "", province || "");
      if (status && status !== "all") {
        processedSources = processedSources.filter(source => source.status === status);
      } else if (!status) {
        processedSources = processedSources.filter(source => source.status === "active");
      }
      processedSources = sortSourcesForExport(processedSources);
      
      const limit = maxPerChannel && maxPerChannel > 0 ? maxPerChannel : 15;
      const sourcesToExport = processedSources.slice(0, limit);
      if (sourcesToExport.length > 0) {
        const urls = sourcesToExport.map(s => s.url).join("#");
        groupChannels.push(`${channel.name},${urls}`);
      }
    });
    if (groupChannels.length > 0) {
      playlistRows.push(`${group.name},#genre#`);
      playlistRows.push(...groupChannels);
    }
  });

  return playlistRows.join("\n");
}

export function preGenerateIspPlaylists() {
  const isps = ["", "电信", "联通", "移动", "广电", "BGP"];
  console.log("[CACHE] Pre-generating standard ISP playlists to data/playlists_export...");
  const baseUrl = "http://localhost:3000";
  for (const isp of isps) {
    for (const format of ["m3u", "txt"]) {
      const cacheParams = {
        format: format as "m3u" | "txt",
        isp: isp || undefined,
        baseUrl
      };
      
      getOrGeneratePlaylistExport(cacheParams, () => {
        if (format === "m3u") {
          return generateM3uPlaylist({ baseUrl, isp: isp || undefined });
        } else {
          return generateTxtPlaylist({ baseUrl, isp: isp || undefined });
        }
      });
    }
  }
}

export function parseClientApp(ua: string): string {
  if (!ua) return "未知客户端 / Direct";
  const lower = ua.toLowerCase();
  
  if (lower.includes("tivimate")) return "TiviMate";
  if (lower.includes("tvbox") || lower.includes("fongmi") || lower.includes("catvod") || lower.includes("okplayer") || lower.includes("q21")) return "TVBox / 影视仓";
  if (lower.includes("potplayer")) return "PotPlayer";
  if (lower.includes("vlc")) return "VLC Media Player";
  if (lower.includes("smarters") || lower.includes("iptv smarters")) return "IPTV Smarters";
  if (lower.includes("perfectplayer") || lower.includes("perfect player")) return "Perfect Player";
  if (lower.includes("ott navigator") || lower.includes("ottnav")) return "OTT Navigator";
  if (lower.includes("kodi")) return "Kodi";
  if (lower.includes("ffmpeg") || lower.includes("lavf") || lower.includes("mpv")) return "FFmpeg / MPV";
  if (lower.includes("curl") || lower.includes("wget")) return "cURL / Wget";
  if (lower.includes("python") || lower.includes("axios") || lower.includes("go-http-client") || lower.includes("postman")) return "API 脚本工具";
  if (lower.includes("mozilla") || lower.includes("chrome") || lower.includes("safari") || lower.includes("edge") || lower.includes("firefox")) return "Web 浏览器";
  
  return "其它播放器";
}

export function recordClientAccess(
  req: Request,
  endpoint: string,
  endpointPath: string,
  statusCode: number = 200,
  extraInfo: { responseBytes?: number; province?: string; isp?: string; customQuery?: string } = {}
) {
  const db = getDb();
  try {
    let clientIp = "";
    if (typeof req.query.ip === "string" && req.query.ip) {
      clientIp = req.query.ip;
    } else if (typeof req.query.clientIp === "string" && req.query.clientIp) {
      clientIp = req.query.clientIp;
    } else if (typeof req.headers["x-forwarded-for"] === "string") {
      clientIp = req.headers["x-forwarded-for"].split(",")[0].trim();
    } else if (Array.isArray(req.headers["x-forwarded-for"])) {
      clientIp = req.headers["x-forwarded-for"][0].trim();
    } else if (typeof req.headers["x-real-ip"] === "string") {
      clientIp = req.headers["x-real-ip"].trim();
    } else {
      clientIp = req.socket?.remoteAddress || "127.0.0.1";
    }

    if (clientIp.startsWith("::ffff:")) {
      clientIp = clientIp.substring(7);
    }

    const userAgent = (req.headers["user-agent"] || "").slice(0, 300);
    const clientApp = parseClientApp(userAgent);

    let province = extraInfo.province || (req.query.province ? String(req.query.province) : "");
    let isp = extraInfo.isp || (req.query.isp ? String(req.query.isp) : "");

    let queryParams = extraInfo.customQuery || "";
    if (!queryParams && req.query) {
      const qObj = { ...req.query };
      delete qObj.ip;
      delete qObj.clientIp;
      if (Object.keys(qObj).length > 0) {
        queryParams = JSON.stringify(qObj);
      }
    }

    const responseBytes = extraInfo.responseBytes || 0;

    const doInsert = (finalProv: string, finalIsp: string) => {
      try {
        db.prepare(`
          INSERT INTO client_access_logs (endpoint, endpointPath, clientIp, province, isp, userAgent, clientApp, queryParams, statusCode, responseBytes, accessTime)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `).run(endpoint, endpointPath, clientIp, finalProv, finalIsp, userAgent, clientApp, queryParams, statusCode, responseBytes);

        if (Math.random() < 0.05) {
          const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM client_access_logs`).get() as { cnt: number };
          if (countRow && countRow.cnt > 50000) {
            db.prepare(`DELETE FROM client_access_logs WHERE id IN (SELECT id FROM client_access_logs ORDER BY accessTime ASC LIMIT ?)`)
              .run(countRow.cnt - 50000);
          }
        }
      } catch (e) {
        console.error("[RECORD CLIENT ACCESS DB ERROR]", e);
      }
    };

    if (!province && !isp && clientIp && clientIp !== "127.0.0.1" && clientIp !== "localhost" && !clientIp.startsWith("192.168.") && !clientIp.startsWith("10.")) {
      getClientIpGeo(clientIp).then((geo) => {
        doInsert(geo.province || "", geo.isp || "");
      }).catch(() => {
        doInsert(province, isp);
      });
    } else {
      doInsert(province, isp);
    }
  } catch (err) {
    console.error("[RECORD CLIENT ACCESS ERROR]", err);
  }
}

