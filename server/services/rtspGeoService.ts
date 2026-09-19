import dns from "dns";
import { LiveSource, Channel } from "../types";
import { getClientIpGeo } from "./speedTestService";
import { detectProvinceAndIspFromName, PROVINCIAL_PINYIN_MAP } from "../geo_channels";
import { normalizeProvinceName, isNationwideProvince } from "./playlistService";

export function isRtspUrl(url: string): boolean {
  if (!url) return false;
  return url.trim().toLowerCase().startsWith("rtsp://");
}

// Extract hostname or IP from RTSP or any stream URL
export function extractHostFromUrl(url: string): { host: string; port: number } {
  if (!url) return { host: "", port: 554 };
  try {
    const trimmed = url.trim();
    // Standard URL or regex fallback
    const match = trimmed.match(/^[a-zA-Z0-9+.-]+:\/\/([^:/@]+(?::\d+)?@)?([^:/]+)(?::(\d+))?/);
    if (match && match[2]) {
      const host = match[2].trim();
      const port = match[3] ? parseInt(match[3], 10) : 554;
      return { host, port: isNaN(port) ? 554 : port };
    }
  } catch (_) {}
  return { host: "", port: 554 };
}

// Detect Province and ISP for RTSP links based on URL host IP / DNS / path and context text
export async function detectRtspGeoAndIsp(
  url: string,
  contextText: string = ""
): Promise<{ province: string; isp: string }> {
  let province = "";
  let isp = "";

  const trimmedUrl = (url || "").trim();
  const urlLower = trimmedUrl.toLowerCase();

  // 1. Text-based detection from context name (e.g. channel name, category, group)
  if (contextText) {
    const textGeo = detectProvinceAndIspFromName(contextText, [trimmedUrl]);
    if (textGeo.detectedProvince && !isNationwideProvince(textGeo.detectedProvince)) {
      province = textGeo.detectedProvince;
    }
    if (textGeo.detectedIsp && textGeo.detectedIsp !== "BGP" && textGeo.detectedIsp !== "未知") {
      isp = textGeo.detectedIsp;
    }
  }

  // 2. Extract host from URL
  const { host } = extractHostFromUrl(trimmedUrl);

  if (host) {
    let resolvedIp = "";
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || (host.includes(":") && !host.includes("."));
    
    if (isIp) {
      resolvedIp = host;
    } else {
      // Hostname: attempt fast DNS lookup
      try {
        const lookupRes = await Promise.race([
          dns.promises.lookup(host),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error("DNS lookup timeout")), 2500))
        ]);
        if (lookupRes && lookupRes.address) {
          resolvedIp = lookupRes.address;
        }
      } catch (err) {
        // DNS lookup failed or timeout
      }
    }

    // 3. Query IP Geolocation for resolved IP
    if (resolvedIp) {
      try {
        const ipGeo = await getClientIpGeo(resolvedIp);
        if (ipGeo) {
          if (ipGeo.province && (!province || isNationwideProvince(province))) {
            province = ipGeo.province;
          }
          if (ipGeo.isp && (!isp || isp === "BGP" || isp === "未知" || isp === "其它")) {
            isp = ipGeo.isp;
          }
        }
      } catch (err) {
        console.warn(`[RTSP Geo Detect] Failed to resolve IP geo for ${resolvedIp}:`, err);
      }
    }

    // 4. URL path and domain keyword heuristic if still missing
    if (!province || isNationwideProvince(province)) {
      for (const [pinyin, prov] of Object.entries(PROVINCIAL_PINYIN_MAP)) {
        const pinyinPattern = new RegExp(`[/._-]${pinyin}[/._-]`, "i");
        if (pinyinPattern.test(urlLower)) {
          province = prov;
          break;
        }
      }
    }

    if (!isp || isp === "BGP" || isp === "未知" || isp === "其它") {
      if (/telecom|189\.cn|chinanet|ctc|\.dx\./i.test(urlLower)) {
        isp = "电信";
      } else if (/unicom|10010|cnc|cucc|\.lt\./i.test(urlLower)) {
        isp = "联通";
      } else if (/chinamobile|10086|cmcc|cmvideo|migu|\.yd\./i.test(urlLower)) {
        isp = "移动";
      } else if (/cbn|wasu|gehua|guangdian|broadcasting/i.test(urlLower)) {
        isp = "广电";
      }
    }
  }

  // 5. Final normalization
  if (province) {
    province = normalizeProvinceName(province);
  }

  return {
    province: province || "全国",
    isp: isp || "BGP"
  };
}

// Synchronously / Asynchronously enrich a LiveSource if it is RTSP
export async function enrichSourceIfRtsp(
  source: LiveSource,
  contextText: string = ""
): Promise<boolean> {
  if (!source || !isRtspUrl(source.url)) return false;

  const currentProv = (source.province || "").trim();
  const currentIsp = (source.isp || "").trim();

  // If both province and ISP are already concretely specified (not "全国" / "BGP" / "未知"), skip
  const needsProv = !currentProv || isNationwideProvince(currentProv);
  const needsIsp = !currentIsp || currentIsp === "BGP" || currentIsp === "未知" || currentIsp === "其它";

  if (!needsProv && !needsIsp) {
    return false;
  }

  try {
    const detected = await detectRtspGeoAndIsp(source.url, contextText);
    let changed = false;

    if (needsProv && detected.province && !isNationwideProvince(detected.province)) {
      source.province = detected.province;
      changed = true;
    }
    if (needsIsp && detected.isp && detected.isp !== "BGP" && detected.isp !== "未知") {
      source.isp = detected.isp;
      changed = true;
    }

    if (changed) {
      console.log(`[RTSP Ingest Auto-Detect] Enhanced RTSP (${source.url}) -> Province: ${source.province}, ISP: ${source.isp}`);
    }
    return changed;
  } catch (e) {
    console.warn(`[RTSP Ingest Auto-Detect] Error detecting RTSP source:`, e);
    return false;
  }
}

// Scan and enrich all existing RTSP sources in channels
export async function enrichChannelsRtspSources(channelsList: Channel[]): Promise<number> {
  let updatedCount = 0;
  const rtspTasks: { source: LiveSource; contextText: string }[] = [];

  for (const ch of channelsList) {
    for (const src of ch.sources || []) {
      if (isRtspUrl(src.url)) {
        const needsProv = !src.province || isNationwideProvince(src.province);
        const needsIsp = !src.isp || src.isp === "BGP" || src.isp === "未知" || src.isp === "其它";
        if (needsProv || needsIsp) {
          rtspTasks.push({
            source: src,
            contextText: `${ch.name} ${ch.alias?.join(" ") || ""}`
          });
        }
      }
    }
  }

  if (rtspTasks.length === 0) return 0;

  console.log(`[RTSP Geo Service] Found ${rtspTasks.length} RTSP sources to enrich with ISP and Province...`);

  // Batch process with concurrency 5
  const concurrency = 5;
  for (let i = 0; i < rtspTasks.length; i += concurrency) {
    const batch = rtspTasks.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(t => enrichSourceIfRtsp(t.source, t.contextText)));
    updatedCount += results.filter(Boolean).length;
  }

  return updatedCount;
}
