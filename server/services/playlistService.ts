import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Request } from "express";
import { LiveSource, Channel, Group } from "../types";
import {
  channels,
  groups,
  exportPlaylistMemoryCache,
  invalidatePlaylistExportCache,
  PLAYLIST_CACHE_DIR,
  READABLE_PLAYLIST_DIR as READABLE_DIR
} from "../store";
import { resolveChannelLogo, getBuildVersionInfo } from "../utils/text";
import { getDb } from "../db/sqlite";
import { getClientIpGeo } from "./speedTestService";
import { calculateQualityScore, detectStreamType } from "../utils/quality";
import { extractClientIp } from "../utils/network";

export { exportPlaylistMemoryCache, invalidatePlaylistExportCache };

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
  excludeRtp?: boolean | string;
  streamType?: string;
  sortByQuality?: boolean | string;
  preferGeneral?: boolean | string;
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
    params.v || "",
    params.excludeRtp ? "no_rtp_ts" : "",
    params.streamType || "",
    params.sortByQuality ? "quality_sort" : "",
    params.preferGeneral ? "prefer_gen" : ""
  ].join("|");
  return crypto.createHash("md5").update(rawKey).digest("hex");
}

export function normalizeProvinceName(prov: string): string {
  if (!prov) return "";
  return prov
    .trim()
    .replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g, "")
    .trim();
}

export function isNationwideProvince(prov: string): boolean {
  if (!prov) return true;
  const p = prov.trim();
  return (
    p === "" ||
    p === "全国" ||
    p === "全网" ||
    p === "通用" ||
    p === "央视" ||
    p === "卫视" ||
    p === "无" ||
    p === "未知" ||
    p === "BGP"
  );
}

export function sortSourcesByGeo(
  sources: LiveSource[],
  targetProvince: string,
  targetIsp: string
): LiveSource[] {
  const normTargetProv = targetProvince ? normalizeProvinceName(targetProvince) : "";
  const normTargetIsp = targetIsp ? targetIsp.trim().replace("中国", "") : "";
  const hasTargetProv = normTargetProv !== "" && !isNationwideProvince(targetProvince);

  return [...sources].sort((a, b) => {
    // 1. Status weight: active > unknown > inactive
    const statusWeightA = a.status === "active" ? 3 : (a.status === "inactive" ? 1 : 2);
    const statusWeightB = b.status === "active" ? 3 : (b.status === "inactive" ? 1 : 2);
    if (statusWeightA !== statusWeightB) {
      return statusWeightB - statusWeightA;
    }

    // 2. Calculate geographic & ISP matching scores
    const getMatchScore = (s: LiveSource): number => {
      let score = 0;
      const srcProv = (s.province || "").trim();
      const srcIsp = (s.isp || "").trim().replace("中国", "");
      const isSrcNationwide = isNationwideProvince(srcProv);
      const isBGP = srcIsp.toUpperCase().includes("BGP") || srcIsp.toUpperCase().includes("BPG");
      const isRtsp = (s.url || "").trim().toLowerCase().startsWith("rtsp://");

      // Province match
      if (hasTargetProv) {
        const normSrcProv = normalizeProvinceName(srcProv);
        if (normSrcProv === normTargetProv) {
          score += 200; // Exact province match
        } else if (isSrcNationwide) {
          score += 100; // Nationwide fallback
        } else {
          score -= 300; // Other province (heavily penalized)
        }
      } else {
        if (isSrcNationwide) {
          score += 100;
        }
      }

      // ISP match
      if (normTargetIsp) {
        if (srcIsp.includes(normTargetIsp) || normTargetIsp.includes(srcIsp)) {
          score += 200; // Exact ISP match
          // 核心需求：限定运营商时（如电信），电信专属 RTSP 直连专网线路稳定性极高且低延迟，置顶在最前面
          if (isRtsp) {
            score += 500;
          }
        } else if (isBGP || !srcIsp || srcIsp === "其它" || srcIsp === "其他" || srcIsp === "未知") {
          score += 80; // BGP / General fallback
        } else {
          score -= 200; // Cross ISP penalty
        }
      }

      return score;
    };

    const scoreA = getMatchScore(a);
    const scoreB = getMatchScore(b);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    // 3. Prefer general standard streams over /rtp/ or /tsfile/ if other params match
    const typeA = detectStreamType(a.url);
    const typeB = detectStreamType(b.url);
    if (typeA.isRtpOrTsSlice !== typeB.isRtpOrTsSlice) {
      return typeA.isRtpOrTsSlice ? 1 : -1;
    }

    // 4. Quality Score
    const qA = calculateQualityScore(a).score;
    const qB = calculateQualityScore(b).score;
    if (Math.abs(qA - qB) >= 8) {
      return qB - qA;
    }

    const latencyA = a.latency && a.latency > 0 ? a.latency : 9999;
    const latencyB = b.latency && b.latency > 0 ? b.latency : 9999;
    return latencyA - latencyB;
  });
}

/**
 * 针对导出进行线路排序：
 * - 当限定了运营商 (如 targetIsp = "电信") 时，该运营商专属的 RTSP 专网线路置顶在最前面 (电信 RTSP 线路最高优先级)，接着是该运营商其它直连源，再之后是通用备用源。
 * - 当未限定运营商 (通用全网) 时，标准 HLS/通用单播源优先，RTSP 专网源后置或排除。
 */
export function sortSourcesForExport(
  sources: LiveSource[],
  targetIsp?: string,
  sortByQuality: boolean = true,
  preferGeneral: boolean = true
): LiveSource[] {
  const normTargetIsp = targetIsp ? targetIsp.trim().replace("中国", "") : "";

  return [...sources].sort((a, b) => {
    // 1. Status weight: active > unknown > inactive
    const statusWeightA = a.status === "active" ? 3 : (a.status === "inactive" ? 1 : 2);
    const statusWeightB = b.status === "active" ? 3 : (b.status === "inactive" ? 1 : 2);
    if (statusWeightA !== statusWeightB) {
      return statusWeightB - statusWeightA;
    }

    const typeA = detectStreamType(a.url);
    const typeB = detectStreamType(b.url);
    const isRtspA = (a.url || "").trim().toLowerCase().startsWith("rtsp://");
    const isRtspB = (b.url || "").trim().toLowerCase().startsWith("rtsp://");

    // 2. ISP-Limited Priority (ISP 限定模式下的专属优化策略，如电信 RTSP 线路置顶在最前面)
    if (normTargetIsp) {
      const srcIspA = (a.isp || "").trim().replace("中国", "");
      const srcIspB = (b.isp || "").trim().replace("中国", "");
      const isMatchIspA = srcIspA.includes(normTargetIsp);
      const isMatchIspB = srcIspB.includes(normTargetIsp);

      // 核心需求：限定运营商时（如电信），该运营商专属的 RTSP 专网直连线路最高优先级，置顶在最前面！
      const isIspRtspA = isMatchIspA && isRtspA;
      const isIspRtspB = isMatchIspB && isRtspB;
      if (isIspRtspA !== isIspRtspB) {
        return isIspRtspA ? -1 : 1;
      }

      // 专属运营商线路优先于通用/BGP/跨网线路
      if (isMatchIspA !== isMatchIspB) {
        return isMatchIspA ? -1 : 1;
      }

      // 双方都匹配运营商时，RTSP 线路优先于其它协议线路
      if (isMatchIspA && isMatchIspB) {
        if (isRtspA !== isRtspB) {
          return isRtspA ? -1 : 1;
        }
      }
    } else {
      // 3. 通用全网模式：非特定 ISP 时，HLS/通用单播优先于专网切片源，且 RTSP 专网流后置避免跨网黑屏
      if (preferGeneral && typeA.isRtpOrTsSlice !== typeB.isRtpOrTsSlice) {
        return typeA.isRtpOrTsSlice ? 1 : -1;
      }
      if (isRtspA !== isRtspB) {
        return isRtspA ? 1 : -1;
      }
    }

    // 4. Quality Score ranking
    if (sortByQuality) {
      const qA = calculateQualityScore(a).score;
      const qB = calculateQualityScore(b).score;
      if (Math.abs(qA - qB) >= 5) {
        return qB - qA;
      }
    }

    const latencyA = a.latency && a.latency > 0 ? a.latency : 9999;
    const latencyB = b.latency && b.latency > 0 ? b.latency : 9999;
    return latencyA - latencyB;
  });
}

/**
 * 智能保障流类型多样性：
 * 1. 当限定了运营商 (targetIsp) 且存在该运营商专属 RTSP/优质线路时，牢牢保证其排在首位 (置顶最前面)；
 * 2. 同时在备选席位中预留通用单播源 (HLS) 备线，防止单一协议在极端网络下失效；
 * 3. 当未限定运营商时，绝不允许切片源占满全部下发名额，确保普通网络环境客户端始终能获得可播放的通用备选源。
 */
export function ensureStreamDiversity(
  sources: LiveSource[],
  limit: number,
  targetIsp?: string
): LiveSource[] {
  if (sources.length <= limit) return sources;

  const normTargetIsp = targetIsp ? targetIsp.trim().replace("中国", "") : "";

  // 模式 A：限定了运营商（如电信）
  if (normTargetIsp) {
    const ispMatchedSources: LiveSource[] = [];
    const otherSources: LiveSource[] = [];

    for (const src of sources) {
      const srcIsp = (src.isp || "").trim().replace("中国", "");
      if (srcIsp.includes(normTargetIsp)) {
        ispMatchedSources.push(src);
      } else {
        otherSources.push(src);
      }
    }

    if (ispMatchedSources.length > 0) {
      // 优先将已排序好的专属线路（如电信 RTSP 在最前）放入输出列表
      const ispQuota = Math.min(
        ispMatchedSources.length,
        limit
      );
      const selectedIsp = ispMatchedSources.slice(0, ispQuota);
      const remainingSlots = limit - selectedIsp.length;
      const selectedOther = remainingSlots > 0 ? otherSources.slice(0, remainingSlots) : [];

      return [...selectedIsp, ...selectedOther];
    }
  }

  // 模式 B：全网通用可播放模式
  const generalSources: LiveSource[] = [];
  const rtpTsSources: LiveSource[] = [];

  for (const src of sources) {
    const typeInfo = detectStreamType(src.url);
    const isRtsp = (src.url || "").trim().toLowerCase().startsWith("rtsp://");
    if (typeInfo.isRtpOrTsSlice || isRtsp) {
      rtpTsSources.push(src);
    } else {
      generalSources.push(src);
    }
  }

  if (generalSources.length === 0 || rtpTsSources.length === 0) {
    return sources.slice(0, limit);
  }

  // 保证通用 HLS/单播源至少获得大部分名额
  const generalQuota = Math.max(1, Math.min(generalSources.length, Math.ceil(limit * 0.75)));
  const rtpTsQuota = Math.min(rtpTsSources.length, limit - generalQuota);

  const selectedGeneral = generalSources.slice(0, generalQuota);
  const selectedRtpTs = rtpTsSources.slice(0, rtpTsQuota);

  const combined = [...selectedGeneral, ...selectedRtpTs];

  if (combined.length < limit) {
    const usedIds = new Set(combined.map(s => s.id));
    for (const s of sources) {
      if (!usedIds.has(s.id)) {
        combined.push(s);
        usedIds.add(s.id);
        if (combined.length >= limit) break;
      }
    }
  }

  return combined;
}

export function getPlayableSources(
  sources: LiveSource[],
  targetIsp: string,
  targetProvince: string,
  options: {
    excludeRtp?: boolean;
    streamType?: string;
  } = {}
): LiveSource[] {
  let filtered = [...sources].filter(s => !s.isolated);
  
  const normTargetIsp = targetIsp ? targetIsp.trim().replace("中国", "") : "";
  const normTargetProv = targetProvince ? normalizeProvinceName(targetProvince) : "";
  const hasTargetProv = normTargetProv !== "" && !isNationwideProvince(targetProvince);

  // 0. Stream Protocol & RTP/TS Slice Filtering (针对 /rtp/、/tsfile/ 无法播放的防护方案)
  if (options.excludeRtp) {
    filtered = filtered.filter(src => {
      const typeInfo = detectStreamType(src.url);
      return !typeInfo.isRtpOrTsSlice;
    });
  }

  if (options.streamType && options.streamType !== "all") {
    const stLower = options.streamType.toLowerCase();
    filtered = filtered.filter(src => {
      const typeInfo = detectStreamType(src.url);
      if (stLower === "general" || stLower === "通用" || stLower === "公网") {
        return !typeInfo.isRtpOrTsSlice;
      }
      if (stLower === "rtp-ts" || stLower === "rtp" || stLower === "tsfile" || stLower === "切片") {
        return typeInfo.isRtpOrTsSlice;
      }
      if (stLower === "hls" || stLower === "m3u8") {
        return typeInfo.type === "HLS";
      }
      if (stLower === "flv" || stLower === "http-flv") {
        return typeInfo.type === "HTTP-FLV";
      }
      if (stLower === "ts" || stLower === "http-ts") {
        return typeInfo.type === "HTTP-TS";
      }
      if (stLower === "rtsp") {
        return typeInfo.type === "RTSP";
      }
      return true;
    });
  }

  if (normTargetIsp) {
    filtered = filtered.filter(src => {
      let srcIsp = (src.isp || "").trim();
      
      if (!srcIsp || srcIsp === "其它" || srcIsp === "其他" || srcIsp === "未知") {
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

      const isBGP = srcIsp.toUpperCase().includes("BGP") || srcIsp.toUpperCase().includes("BPG");
      const sIsp = srcIsp.replace("中国", "");

      // 1. ISP 匹配判定
      let ispMatched = false;
      if (!sIsp || srcIsp === "其它" || srcIsp === "其他" || isBGP) {
        ispMatched = true;
      } else if (sIsp.includes(normTargetIsp) || normTargetIsp.includes(sIsp)) {
        ispMatched = true;
      }

      if (!ispMatched) {
        return false;
      }

      // 2. 限定 ISP 时的省份互斥过滤
      const srcProv = (src.province || "").trim();
      if (hasTargetProv && !isNationwideProvince(srcProv)) {
        const normSrcProv = normalizeProvinceName(srcProv);
        if (normSrcProv && normSrcProv !== normTargetProv && !isBGP) {
          return false;
        }
      }

      return true;
    });
  } else if (hasTargetProv) {
    filtered = filtered.filter(src => {
      const srcProv = (src.province || "").trim();
      if (!isNationwideProvince(srcProv)) {
        const normSrcProv = normalizeProvinceName(srcProv);
        if (normSrcProv && normSrcProv !== normTargetProv) {
          const isBGP = (src.isp || "").toUpperCase().includes("BGP");
          if (!isBGP) {
            return false;
          }
        }
      }
      return true;
    });
  }

  // 3. RTSP 协议跨区域与跨运营商隔离
  // 当未限定运营商（导出全网可播放直播源）时，排除特定运营商绑定的专网 RTSP 线路；
  // 当限定运营商时，只保留该运营商或全网通用的 RTSP 线路。
  filtered = filtered.filter(src => {
    const isRtsp = (src.url || "").trim().toLowerCase().startsWith("rtsp://");
    if (!isRtsp) return true;

    const srcProv = (src.province || "").trim();
    const srcIsp = (src.isp || "").trim().replace("中国", "");
    const isNationwideSrc = isNationwideProvince(srcProv);

    if (!isNationwideSrc) {
      const normSrcProv = normalizeProvinceName(srcProv);
      if (hasTargetProv) {
        if (normSrcProv !== normTargetProv) {
          return false;
        }
      } else {
        return false;
      }
    }

    if (srcIsp && srcIsp !== "BGP" && srcIsp !== "未知" && srcIsp !== "其它") {
      if (normTargetIsp) {
        if (!srcIsp.includes(normTargetIsp) && !normTargetIsp.includes(srcIsp)) {
          return false;
        }
      } else {
        // 未指定且未识别出有效 ISP 时，导出全网可播放直播源，特定运营商专网 RTSP 无法在全网通用播放，故剔除
        return false;
      }
    }

    return true;
  });

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
    excludeRtp?: boolean | string;
    streamType?: string;
    sortByQuality?: boolean | string;
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
    if (params.excludeRtp) parts.push("no_rtp_ts");
    if (params.streamType) parts.push(`type_${params.streamType}`);
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
  excludeRtp?: boolean;
  streamType?: string;
  sortByQuality?: boolean;
}): string {
  const { baseUrl, isp, province, category, status, maxPerChannel, excludeRtp, streamType, sortByQuality } = options;
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
      processedSources = getPlayableSources(processedSources, isp || "", province || "", {
        excludeRtp,
        streamType
      });
      if (status && status !== "all") {
        processedSources = processedSources.filter(source => source.status === status);
      } else if (!status) {
        processedSources = processedSources.filter(source => source.status === "active");
      }
      processedSources = sortSourcesForExport(processedSources, isp, sortByQuality !== false);
      
      const limit = maxPerChannel && maxPerChannel > 0 ? maxPerChannel : 15;
      const sourcesToExport = ensureStreamDiversity(processedSources, limit, isp);
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
  excludeRtp?: boolean;
  streamType?: string;
  sortByQuality?: boolean;
}): string {
  const { isp, province, category, status, maxPerChannel, excludeRtp, streamType, sortByQuality } = options;
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
      processedSources = getPlayableSources(processedSources, isp || "", province || "", {
        excludeRtp,
        streamType
      });
      if (status && status !== "all") {
        processedSources = processedSources.filter(source => source.status === status);
      } else if (!status) {
        processedSources = processedSources.filter(source => source.status === "active");
      }
      processedSources = sortSourcesForExport(processedSources, isp, sortByQuality !== false);
      
      const limit = maxPerChannel && maxPerChannel > 0 ? maxPerChannel : 15;
      const sourcesToExport = ensureStreamDiversity(processedSources, limit, isp);
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
  
  if (lower.includes("mytv-android")) return "MyTV-android";
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
    const clientIp = extractClientIp(req);
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
        const serverTimeZone = process.env.SERVER_TIMEZONE || process.env.TZ || "Asia/Shanghai";
        const serverTimeStr = new Intl.DateTimeFormat("zh-CN", {
          timeZone: serverTimeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        }).format(new Date()).replace(/\//g, "-");

        db.prepare(`
          INSERT INTO client_access_logs (endpoint, endpointPath, clientIp, province, isp, userAgent, clientApp, queryParams, statusCode, responseBytes, accessTime)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(endpoint, endpointPath, clientIp, finalProv, finalIsp, userAgent, clientApp, queryParams, statusCode, responseBytes, serverTimeStr);

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
