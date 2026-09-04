import net from "net";
import { execFile } from "child_process";
import { promisify } from "util";
import { channels, ipGeoApis, autoSwitchGeoApi, saveData, carouselProxyPresets } from "../store";
import { isPrivateOrIntranetUrl } from "../utils/network";
import { isCarouselSource, normalizePlatform, formatProxyUrl } from "./carouselService";
import { getDb } from "../db/sqlite";

const execFileAsync = promisify(execFile);

// Cache for IP Geo results
const ipGeoCache = new Map<string, { province: string; isp: string; timestamp: number }>();
const IP_GEO_CACHE_TTL = 24 * 3600 * 1000; // 24 hours

export function isResponseContentInvalid(text: string, contentType = ""): { invalid: boolean; reason?: string } {
  const lowerCT = (contentType || "").toLowerCase();

  // 0. Empty or whitespace
  if (!text || !text.trim()) {
    return { invalid: true, reason: "响应内容为空(0字节)" };
  }

  const trimmed = text.trim();
  const lowerText = text.toLowerCase();

  // 1. Copyright / authentication / expired
  if (
    lowerText.includes("由于版权原因") ||
    lowerText.includes("版权原因") ||
    lowerText.includes("登录后观看") ||
    lowerText.includes("请登录后观看") ||
    lowerText.includes("版权限制") ||
    lowerText.includes("未授权") ||
    lowerText.includes("无权访问") ||
    lowerText.includes("token过期") ||
    lowerText.includes("token expired") ||
    lowerText.includes("access denied") ||
    lowerText.includes("sign error") ||
    lowerText.includes("auth fail") ||
    lowerText.includes("鉴权失败") ||
    lowerText.includes("提取失败") ||
    lowerText.includes("解析失败") ||
    lowerText.includes("无法播放") ||
    lowerText.includes("链接失效") ||
    lowerText.includes("源失效") ||
    lowerText.includes("参数错误") ||
    lowerText.includes("校验失败") ||
    lowerText.includes("链接已失效")
  ) {
    return { invalid: true, reason: "版权限制/鉴权失败/提示登录" };
  }

  // 2. Channel not found or offline
  if (
    lowerText.includes("频道不存在") ||
    lowerText.includes("播放失败") ||
    lowerText.includes("无效资源") ||
    lowerText.includes("资源不存在") ||
    lowerText.includes("已下线") ||
    lowerText.includes("节目已下线") ||
    lowerText.includes("请尝试其他") ||
    lowerText.includes("源不可用") ||
    lowerText.includes("404 not found") ||
    lowerText.includes("500 internal")
  ) {
    return { invalid: true, reason: "频道不存在或源不可用" };
  }

  // Non-zero error code
  const errCodeMatch = lowerText.match(/(?:err_?code|error_?code)\s*[:=]\s*(["']?)(-?\d+|[a-zA-Z_]+)\1/);
  if (errCodeMatch) {
    const codeVal = errCodeMatch[2];
    if (codeVal !== "0" && codeVal !== "200" && codeVal !== "success" && codeVal !== "ok") {
      return { invalid: true, reason: `接口返回错误码(${codeVal})` };
    }
  }

  // 3. Content-Type is JSON but not media M3U8
  if (lowerCT.includes("json")) {
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !lowerText.includes("#extm3u")) {
      return { invalid: true, reason: "JSON 接口返回非媒体文本" };
    }
  }

  // 4. HTML error page
  if (
    (lowerCT.includes("text/html") || trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html")) &&
    !lowerText.includes("#extm3u") && !lowerText.includes("#extinf")
  ) {
    return { invalid: true, reason: "返回 HTML 错误页" };
  }

  // 5. Blank M3U8
  if (lowerText.includes("#extm3u")) {
    if (!lowerText.includes("#extinf") && !lowerText.includes(".ts") && !lowerText.includes(".m3u8") && !lowerText.includes("http")) {
      return { invalid: true, reason: "空白 M3U8 列表" };
    }
  }

  // 6. JSON error payload
  if (lowerCT.includes("json") || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object") {
        if (obj.code !== undefined && obj.code !== 0 && obj.code !== 200 && obj.code !== "0" && obj.code !== "200") {
          return { invalid: true, reason: `JSON 错误码(${obj.code})` };
        }
        if (obj.success === false || obj.status === "error" || obj.status === false) {
          return { invalid: true, reason: "接口状态为失败" };
        }
        if (obj.message || obj.msg || obj.error) {
          const msg = String(obj.message || obj.msg || obj.error).toLowerCase();
          if (
            msg.includes("fail") ||
            (msg.includes("error") && !msg.includes("no error") && !msg.includes("error: 0")) ||
            msg.includes("不存在") ||
            msg.includes("失败") ||
            msg.includes("版权") ||
            msg.includes("登录")
          ) {
            return { invalid: true, reason: `接口返回: ${obj.message || obj.msg || obj.error}` };
          }
        }
      }
    } catch (e) {}
  }

  // 7. Plain text without media signature
  if ((lowerCT.includes("text/plain") || lowerCT.includes("text/raw")) && !lowerText.includes("#extm3u") && !lowerText.includes("#extinf")) {
    if (trimmed.length < 500 && (lowerText.includes("error") || lowerText.includes("fail") || /[\u4e00-\u9fa5]/.test(trimmed))) {
      return { invalid: true, reason: "纯文本非媒体响应" };
    }
  }

  return { invalid: false };
}

export function parseH264Sps(buf: Buffer): string | undefined {
  if (!buf || buf.length < 16) return undefined;
  for (let i = 0; i < buf.length - 12; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1))) {
      const start = buf[i + 2] === 1 ? i + 3 : i + 4;
      if (start >= buf.length) continue;
      const nalType = buf[start] & 0x1F;
      if (nalType === 7) {
        try {
          const rawSps = buf.subarray(start + 1, Math.min(buf.length, start + 80));
          const cleanBytes: number[] = [];
          for (let k = 0; k < rawSps.length; k++) {
            if (k >= 2 && rawSps[k] === 3 && rawSps[k - 1] === 0 && rawSps[k - 2] === 0) continue;
            cleanBytes.push(rawSps[k]);
          }
          const sps = Buffer.from(cleanBytes);
          let bitPos = 0;
          function readBit(): number {
            const byteIdx = Math.floor(bitPos / 8);
            const bitIdx = 7 - (bitPos % 8);
            bitPos++;
            if (byteIdx >= sps.length) return 0;
            return (sps[byteIdx] >> bitIdx) & 1;
          }
          function readUE(): number {
            let zeros = 0;
            while (readBit() === 0 && zeros < 32) zeros++;
            let val = 0;
            for (let k = 0; k < zeros; k++) {
              val = (val << 1) | readBit();
            }
            return (1 << zeros) - 1 + val;
          }
          const profileIdc = sps[0];
          bitPos = 24;
          readUE();
          if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profileIdc)) {
            const chromaFormatIdc = readUE();
            if (chromaFormatIdc === 3) readBit();
            readUE();
            readUE();
            readBit();
            const seqScalingMatrixPresentFlag = readBit();
            if (seqScalingMatrixPresentFlag) {
              const count = chromaFormatIdc !== 3 ? 8 : 12;
              for (let c = 0; c < count; c++) {
                const seqScalingListPresentFlag = readBit();
                if (seqScalingListPresentFlag) {
                  const sizeOfScalingList = c < 6 ? 16 : 64;
                  let lastScale = 8;
                  let nextScale = 8;
                  for (let j = 0; j < sizeOfScalingList; j++) {
                    if (nextScale !== 0) {
                      const deltaScale = readUE();
                      nextScale = (lastScale + deltaScale + 256) % 256;
                    }
                    lastScale = nextScale === 0 ? lastScale : nextScale;
                  }
                }
              }
            }
          }
          readUE();
          const picOrderCntType = readUE();
          if (picOrderCntType === 0) {
            readUE();
          } else if (picOrderCntType === 1) {
            readBit();
            readUE();
            readUE();
            const numRefFramesInPicOrderCntCycle = readUE();
            for (let n = 0; n < numRefFramesInPicOrderCntCycle; n++) readUE();
          }
          readUE();
          readBit();
          const picWidthInMbsMinus1 = readUE();
          const picHeightInMapUnitsMinus1 = readUE();
          const frameMbsOnlyFlag = readBit();
          const width = (picWidthInMbsMinus1 + 1) * 16;
          const heightMapUnits = picHeightInMapUnitsMinus1;
          const height = (heightMapUnits + 1) * 16 * (2 - frameMbsOnlyFlag);
          if (width >= 100 && height >= 100 && width <= 8192 && height <= 8192) {
            if (height >= 2160 || width >= 3840) return "4K";
            if (height >= 1080 || width >= 1920) return "1080p";
            if (height >= 720 || width >= 1280) return "720p";
            if (height >= 576 || width >= 720) return "576p";
            if (height >= 480 || width >= 640) return "480p";
            return `${width}x${height}`;
          }
        } catch (_) {}
      }
    }
  }
  return undefined;
}

export function parseResolution(url: string, textOrHeader?: string): string | undefined {
  if (textOrHeader) {
    const resMatch = textOrHeader.match(/RESOLUTION=(\d+)x(\d+)/i);
    if (resMatch) {
      const w = parseInt(resMatch[1], 10);
      const h = parseInt(resMatch[2], 10);
      if (h >= 2160 || w >= 3840) return "4K";
      if (h >= 1080 || w >= 1920) return "1080p";
      if (h >= 720 || w >= 1280) return "720p";
      if (h >= 576 || w >= 720) return "576p";
      if (h >= 480 || w >= 640) return "480p";
      return `${w}x${h}`;
    }
  }

  const urlLower = url.toLowerCase();
  if (/(3840x2160|2160p|4k|uhd)/i.test(urlLower)) return "4K";
  if (/(1920x1080|1080p|1080i|4m1080|7\.5m1080|8m1080)/i.test(urlLower)) return "1080p";
  if (/(1280x720|720p|720i|2m720)/i.test(urlLower)) return "720p";
  if (/(720x576|704x576|576p|576i)/i.test(urlLower)) return "576p";
  if (/(640x480|480p)/i.test(urlLower)) return "480p";

  return undefined;
}

export async function probeStreamResolutionWithFfprobe(url: string, timeoutMs = 1500): Promise<string | undefined> {
  if (isPrivateOrIntranetUrl(url)) return undefined;

  try {
    const isRtmp = url.toLowerCase().startsWith("rtmp://");
    const args = [
      "-v", "error",
      "-probesize", "500000",
      "-analyzeduration", "500000",
    ];

    if (isRtmp) {
      args.push("-rtmp_live", "live");
    } else {
      args.push("-rw_timeout", `${timeoutMs * 1000}`);
      args.push("-timeout", `${timeoutMs * 1000}`);
    }

    args.push(
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "json",
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      url
    );

    const { stdout } = await execFileAsync("ffprobe", args, { timeout: timeoutMs + 1000 });

    const data = JSON.parse(stdout);
    if (data && data.streams && data.streams.length > 0) {
      const v = data.streams[0];
      const w = parseInt(v.width, 10);
      const h = parseInt(v.height, 10);
      if (w > 0 && h > 0) {
        if (h >= 2160 || w >= 3840) return "4K";
        if (h >= 1080 || w >= 1920) return "1080p";
        if (h >= 720 || w >= 1280) return "720p";
        if (h >= 576 || w >= 720) return "576p";
        if (h >= 480 || w >= 640) return "480p";
        return `${w}x${h}`;
      }
    }
  } catch (_) {}
  return undefined;
}

export function buildDiagMsg(details: {
  httpStatus?: number;
  contentType?: string;
  reason: string;
  responseSnippet?: string;
}): string {
  return JSON.stringify({
    httpStatus: details.httpStatus ?? 0,
    contentType: details.contentType || "未知",
    reason: details.reason,
    responseSnippet: (details.responseSnippet || "").trim().slice(0, 350),
    checkedAt: new Date().toISOString()
  });
}

export async function testSingleUrl(url: string, timeoutMs: number = 5000): Promise<{ status: "active" | "inactive"; latency: number; resolution?: string; diagMsg?: string }> {
  const startTime = Date.now();
  const urlLower = url.toLowerCase();
  const isNonHttp = urlLower.startsWith("rtsp://") || urlLower.startsWith("rtmp://") || urlLower.startsWith("rtp://") || urlLower.startsWith("udp://") || urlLower.startsWith("p2p://");

  if (isNonHttp) {
    try {
      const isRtmp = urlLower.startsWith("rtmp://");
      const defaultPort = isRtmp ? 1935 : 554;
      const protocolLength = url.indexOf("://") + 3;
      const withoutProtocol = url.substring(protocolLength);
      const slNameIndex = withoutProtocol.indexOf("/");
      const hostPortPart = slNameIndex === -1 ? withoutProtocol : withoutProtocol.substring(0, slNameIndex);
      
      const atIndex = hostPortPart.indexOf("@");
      const endpointPart = atIndex === -1 ? hostPortPart : hostPortPart.substring(atIndex + 1);
      
      let host = "";
      let port = defaultPort;
      
      if (endpointPart.startsWith("[")) {
        const closingBracket = endpointPart.indexOf("]");
        if (closingBracket !== -1) {
          host = endpointPart.substring(1, closingBracket);
          const remaining = endpointPart.substring(closingBracket + 1);
          if (remaining.startsWith(":")) {
            port = parseInt(remaining.substring(1), 10) || defaultPort;
          }
        } else {
          host = endpointPart;
        }
      } else {
        const colonIndex = endpointPart.lastIndexOf(":");
        if (colonIndex !== -1) {
          host = endpointPart.substring(0, colonIndex);
          port = parseInt(endpointPart.substring(colonIndex + 1), 10) || defaultPort;
        } else {
          host = endpointPart;
          port = defaultPort;
        }
      }

      if (isPrivateOrIntranetUrl(url)) {
        return {
          status: "active",
          latency: 60,
          resolution: parseResolution(url),
          diagMsg: buildDiagMsg({ httpStatus: 200, contentType: "socket/intranet", reason: "专网/内网保留地址(免检测测通)" })
        };
      }

      const socketTimeout = Math.max(timeoutMs, 4000);
      return new Promise((resolve) => {
        const socket = net.connect({
          host,
          port,
          timeout: socketTimeout
        }, async () => {
          const latency = Date.now() - startTime;
          try {
            if (urlLower.startsWith("rtsp://")) {
              socket.write(`OPTIONS rtsp://${host}:${port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: Lavf/58.29.100\r\n\r\n`);
            }
          } catch (e) {}
          socket.destroy();
          const fastRes = parseResolution(url);
          const probedRes = fastRes ? fastRes : await probeStreamResolutionWithFfprobe(url, 1000).catch(() => undefined);
          resolve({
            status: "active",
            latency,
            resolution: probedRes || fastRes,
            diagMsg: buildDiagMsg({ httpStatus: 200, contentType: "socket/stream", reason: "专有流 TCP 端口握手成功" })
          });
        });
        socket.on("error", (err: any) => {
          socket.destroy();
          if (isPrivateOrIntranetUrl(url) || urlLower.startsWith("rtsp://")) {
            resolve({
              status: "active",
              latency: 80,
              resolution: parseResolution(url),
              diagMsg: buildDiagMsg({ httpStatus: 200, contentType: "socket/stream", reason: "RTSP 缺省握手忽略断开" })
            });
          } else {
            resolve({
              status: "inactive",
              latency: Date.now() - startTime,
              diagMsg: buildDiagMsg({ httpStatus: 0, contentType: "socket/stream", reason: `Socket 连接拒绝/失败: ${err?.message || 'ECONNREFUSED'}` })
            });
          }
        });
        socket.on("timeout", () => {
          socket.destroy();
          if (isPrivateOrIntranetUrl(url) || urlLower.startsWith("rtsp://")) {
            resolve({
              status: "active",
              latency: 80,
              resolution: parseResolution(url),
              diagMsg: buildDiagMsg({ httpStatus: 200, contentType: "socket/stream", reason: "RTSP 缺省握手超时忽略" })
            });
          } else {
            resolve({
              status: "inactive",
              latency: Date.now() - startTime,
              diagMsg: buildDiagMsg({ httpStatus: 0, contentType: "socket/stream", reason: `Socket 连接握手超时 (${socketTimeout}ms)` })
            });
          }
        });
      });
    } catch (e: any) {
      if (isPrivateOrIntranetUrl(url) || urlLower.startsWith("rtsp://")) {
        return {
          status: "active",
          latency: 80,
          resolution: parseResolution(url),
          diagMsg: buildDiagMsg({ httpStatus: 200, contentType: "socket/stream", reason: "专网 RTSP 尝试建立握手" })
        };
      }
      return {
        status: "inactive",
        latency: Date.now() - startTime,
        diagMsg: buildDiagMsg({ httpStatus: 0, contentType: "socket/stream", reason: `解析目标 IP/端口异常: ${e?.message || 'Invalid address'}` })
      };
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    clearTimeout(timeoutId);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    
    if (response.ok) {
      const latency = Date.now() - startTime;
      let resolution: string | undefined = parseResolution(url);

      try {
        if (contentType.includes("mpegurl") || contentType.includes("text") || contentType.includes("json") || contentType.includes("html") || urlLower.endsWith(".m3u8")) {
          const text = await response.text();
          const contentCheck = isResponseContentInvalid(text, contentType);
          if (contentCheck.invalid) {
            return {
              status: "inactive",
              latency: Date.now() - startTime,
              diagMsg: buildDiagMsg({
                httpStatus: response.status,
                contentType,
                reason: contentCheck.reason || "包含无效流格式/防盗链鉴权失败",
                responseSnippet: text
              })
            };
          }

          const parsed = parseResolution(url, text);
          if (parsed) resolution = parsed;

          if (!resolution && text.includes("#EXTM3U")) {
            const lines = text.split("\n").map(l => l.trim());
            const subLine = lines.find(l => l && !l.startsWith("#") && (l.includes(".m3u8") || l.includes("http") || (!l.includes(".") && l.length > 2)));
            if (subLine) {
              try {
                const subUrl = new URL(subLine, response.url).href;
                const subCtrl = new AbortController();
                const subTimeout = setTimeout(() => subCtrl.abort(), 2500);
                const subRes = await fetch(subUrl, {
                  signal: subCtrl.signal,
                  headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  },
                });
                clearTimeout(subTimeout);
                if (subRes.ok) {
                  const subText = await subRes.text();
                  const subCheck = isResponseContentInvalid(subText, subRes.headers.get("content-type") || "");
                  if (subCheck.invalid) {
                    return {
                      status: "inactive",
                      latency: Date.now() - startTime,
                      diagMsg: buildDiagMsg({
                        httpStatus: subRes.status,
                        contentType: subRes.headers.get("content-type") || contentType,
                        reason: `子 M3U8 列表内容失效: ${subCheck.reason}`,
                        responseSnippet: subText
                      })
                    };
                  }
                  const subParsed = parseResolution(subUrl, subText);
                  if (subParsed) {
                    resolution = subParsed;
                  } else {
                    const subLines = subText.split("\n").map(l => l.trim());
                    const tsLine = subLines.find(l => l && !l.startsWith("#") && (l.includes(".ts") || l.includes("http") || (!l.includes(".") && l.length > 2)));
                    if (tsLine) {
                      const tsUrl = new URL(tsLine, subUrl).href;
                      const tsCtrl = new AbortController();
                      const tsTimeout = setTimeout(() => tsCtrl.abort(), 2500);
                      const tsRes = await fetch(tsUrl, {
                        signal: tsCtrl.signal,
                        headers: {
                          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        },
                      });
                      clearTimeout(tsTimeout);
                      if (tsRes.ok && tsRes.body) {
                        const reader = tsRes.body.getReader();
                        const { value } = await reader.read();
                        if (value && value.length > 0) {
                          const buf = Buffer.from(value);
                          const spsRes = parseH264Sps(buf);
                          if (spsRes) resolution = spsRes;
                        }
                        try { await reader.cancel(); } catch (_) {}
                      } else if (!tsRes.ok) {
                        return {
                          status: "inactive",
                          latency: Date.now() - startTime,
                          diagMsg: buildDiagMsg({
                            httpStatus: tsRes.status,
                            contentType: tsRes.headers.get("content-type") || "",
                            reason: `TS 音视频切片返回 HTTP ${tsRes.status} 状态`
                          })
                        };
                      }
                    }
                  }
                } else {
                  return {
                    status: "inactive",
                    latency: Date.now() - startTime,
                    diagMsg: buildDiagMsg({
                      httpStatus: subRes.status,
                      contentType: subRes.headers.get("content-type") || "",
                      reason: `子 M3U8 索引下载失败 (HTTP ${subRes.status})`
                    })
                  };
                }
              } catch (_) {}
            }
          }
        } else if (response.body) {
          const reader = response.body.getReader();
          const { value } = await reader.read();
          if (value && value.length > 0) {
            const buf = Buffer.from(value);
            const chunkText = buf.toString("utf-8");
            const contentCheck = isResponseContentInvalid(chunkText, contentType);
            if (contentCheck.invalid) {
              try { await reader.cancel(); } catch (_) {}
              return {
                status: "inactive",
                latency: Date.now() - startTime,
                diagMsg: buildDiagMsg({
                  httpStatus: response.status,
                  contentType,
                  reason: contentCheck.reason || "包含非音视频有效数据",
                  responseSnippet: chunkText
                })
              };
            }
            const spsRes = parseH264Sps(buf);
            if (spsRes) resolution = spsRes;
          }
          try { await reader.cancel(); } catch (_) {}
        }
      } catch (err: any) {}

      if (!resolution) {
        const probedRes = await probeStreamResolutionWithFfprobe(url, 1200).catch(() => undefined);
        if (probedRes) {
          resolution = probedRes;
        }
      }

      return {
        status: "active",
        latency,
        resolution,
        diagMsg: buildDiagMsg({
          httpStatus: response.status,
          contentType,
          reason: "HTTP 连通与流数据握手正常"
        })
      };
    } else {
      let errTextSnippet = "";
      try {
        errTextSnippet = await response.text();
      } catch (_) {}
      return {
        status: "inactive",
        latency: Date.now() - startTime,
        diagMsg: buildDiagMsg({
          httpStatus: response.status,
          contentType,
          reason: `服务器返回异常状态码 HTTP ${response.status} (${response.statusText || 'Error'})`,
          responseSnippet: errTextSnippet
        })
      };
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err?.name === "AbortError";
    return {
      status: "inactive",
      latency: Date.now() - startTime,
      diagMsg: buildDiagMsg({
        httpStatus: 0,
        contentType: "none",
        reason: isTimeout ? `请求超时 (服务端耗时超过 ${timeoutMs}ms 未响应)` : `网络连接失败或跨域/域名无法解析 (${err?.message || 'Connection Refused'})`
      })
    };
  }
}

export async function testCarouselProxyAvailability(proxy: { platform: string; urlTemplate: string }, timeoutMs = 6000): Promise<{ available: boolean; latency: number | null; error?: string }> {
  try {
    const plat = normalizePlatform(proxy.platform);
    const fallbacks: Record<string, string[]> = {
      "yy": ["54880976", "12345", "76"],
      "douyu": ["10153463", "10419541", "9374862", "9999"],
      "huya": ["11602077", "21059618", "26355797", "lpl"],
      "bilibili": ["1129", "6", "102"],
      "kuaishou": ["3x876g5g6f7", "kpl"],
      "douyin": ["123456"],
      "cntv": ["cctv1", "cctv5"],
      "migu": ["644368373", "608807420", "631780532"],
      "iptv": ["live"]
    };
    
    const candidateIds: string[] = [];
    const db = getDb();
    try {
      const regList = db.prepare('SELECT originalId FROM carousel_channels WHERE LOWER(platform) = ? LIMIT 5').all(plat) as any[];
      for (const r of regList) {
        if (r.originalId && !candidateIds.includes(r.originalId)) {
          candidateIds.push(r.originalId);
        }
      }
    } catch (e) {}

    const presetList = (carouselProxyPresets as any)?.[plat] || [];
    for (const p of presetList) {
      if (p.id && !candidateIds.includes(p.id)) {
        candidateIds.push(p.id);
      }
    }

    const fallbackList = fallbacks[plat] || ["12345"];
    for (const fb of fallbackList) {
      if (!candidateIds.includes(fb)) {
        candidateIds.push(fb);
      }
    }

    let lastError = "";
    const testCandidates = candidateIds.slice(0, 4);

    for (const testId of testCandidates) {
      const testUrl = formatProxyUrl(proxy.urlTemplate, testId);
      const res = await testSingleUrl(testUrl, timeoutMs || 5000);
      if (res.status === "active") {
        return { available: true, latency: res.latency };
      } else {
        lastError = "未能连通流媒体响应或流已下线";
      }
    }

    return { available: false, latency: null, error: lastError || '未获取到有效流媒体响应' };
  } catch (e: any) {
    return { available: false, latency: null, error: e?.message || '测活异常' };
  }
}

export function updateSourceDbStatus(
  channelId: string,
  sourceId: string,
  status: "active" | "inactive" | "checking" | "unknown",
  latency?: number,
  resolution?: string,
  diagMsg?: string
) {
  const channel = channels.find((c) => c.id === channelId);
  if (channel) {
    const source = channel.sources.find((s) => s.id === sourceId);
    if (source) {
      source.status = status;
      if (latency !== undefined) {
        source.latency = latency;
      }
      if (resolution) {
        source.resolution = resolution;
      }
      if (diagMsg) {
        source.diagMsg = diagMsg;
      }
      source.lastChecked = new Date().toISOString();

      const isMiguOrCarousel = isCarouselSource(source, channel) || /[?&/](?:migu|mg|miguvideo)[_./?]/i.test(source.url) || /\/(?:migu|mg|migu_live)\//i.test(source.url);
      if (status === "inactive" && isMiguOrCarousel) {
        source.isolated = true;
      }
    }
  }
}

export const testStatus: {
  status: "idle" | "running";
  total: number;
  checked: number;
  results: {
    id: string;
    channelId: string;
    url: string;
    status: "active" | "inactive";
    latency: number;
    resolution?: string;
    diagMsg?: string;
  }[];
} = {
  status: "idle",
  total: 0,
  checked: 0,
  results: [],
};

export function stopConcurrentTest() {
  testStatus.status = "idle";
}

export async function runConcurrentTest(
  selectedSources: { id: string; channelId: string; url: string }[],
  concurrency = 8
) {
  testStatus.status = "running";
  testStatus.total = selectedSources.length;
  testStatus.checked = 0;
  testStatus.results = [];

  const queue = [...selectedSources];

  const runWorker = async () => {
    while (queue.length > 0) {
      if (testStatus.status !== "running") break;
      const item = queue.shift();
      if (!item) continue;

      updateSourceDbStatus(item.channelId, item.id, "checking", undefined);

      const result = await testSingleUrl(item.url);

      updateSourceDbStatus(item.channelId, item.id, result.status, result.latency, result.resolution, result.diagMsg);

      testStatus.checked++;
      testStatus.results.push({
        id: item.id,
        channelId: item.channelId,
        url: item.url,
        status: result.status,
        latency: result.latency,
        resolution: result.resolution,
        diagMsg: result.diagMsg
      });

      // Periodic checkpoint save
      if (testStatus.checked % 20 === 0) {
        saveData();
      }
    }
  };

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(runWorker());
  }

  await Promise.all(workers);
  testStatus.status = "idle";
  saveData();
}

export async function getClientIpGeo(ipString: string): Promise<{ province: string; isp: string }> {
  let ip = (ipString || "").trim();
  if (ip.includes("::ffff:")) {
    ip = ip.replace("::ffff:", "");
  }
  if (
    !ip ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "localhost" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("100.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  ) {
    return { province: "", isp: "" };
  }

  const cached = ipGeoCache.get(ip);
  if (cached && Date.now() - cached.timestamp < IP_GEO_CACHE_TTL) {
    return { province: cached.province, isp: cached.isp };
  }

  let enabledApis = ipGeoApis.filter(a => a.enabled);
  if (enabledApis.length === 0) {
    ipGeoApis.forEach(a => { a.enabled = true; a.failCount = 0; });
    enabledApis = ipGeoApis;
  }

  const provinces = [
    "北京", "上海", "天津", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江",
    "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南",
    "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "台湾",
    "内蒙古", "广西", "西藏", "宁夏", "新疆", "香港", "澳门"
  ];

  const ispKeywords = [
    { keyword: "telecom", name: "电信" },
    { keyword: "unicom", name: "联通" },
    { keyword: "mobile", name: "移动" },
    { keyword: "chinanet", name: "电信" },
    { keyword: "broadband", name: "广电" },
    { keyword: "cantv", name: "广电" },
    { keyword: "chinasat", name: "广电" },
    { keyword: "tietong", name: "铁通" },
    { keyword: "电信", name: "电信" },
    { keyword: "联通", name: "联通" },
    { keyword: "移动", name: "移动" },
    { keyword: "铁通", name: "铁通" },
    { keyword: "广电", name: "广电" }
  ];

  for (const api of enabledApis) {
    try {
      const url = api.url.replace("{{ip}}", encodeURIComponent(ip));
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const buffer = await res.arrayBuffer();
        let text = "";
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch (e) {
          text = new TextDecoder("gbk").decode(buffer);
        }

        let parsedJson: any = null;
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsedJson = JSON.parse(jsonMatch[0]);
          }
        } catch (_) {}

        let matchedProvince = "";
        let matchedIsp = "";

        if (parsedJson) {
          const rawPro = parsedJson.pro || parsedJson.province || parsedJson.region || parsedJson.regionName || parsedJson.state || (parsedJson.info && parsedJson.info.prov) || "";
          const rawIsp = parsedJson.isp || parsedJson.org || parsedJson.carrier || parsedJson.operator || parsedJson.as || (parsedJson.connection && parsedJson.connection.isp) || (parsedJson.info && parsedJson.info.isp) || "";
          const rawCountry = parsedJson.country || parsedJson.country_name || (parsedJson.info && parsedJson.info.country) || "";
          const rawAddr = parsedJson.addr || "";

          const searchSpace = `${rawPro} ${rawAddr} ${text}`.toLowerCase();
          for (const p of provinces) {
            if (searchSpace.includes(p.toLowerCase())) {
              matchedProvince = p;
              break;
            }
          }

          const ispSearchSpace = `${rawIsp} ${rawAddr} ${text}`.toLowerCase();
          for (const ik of ispKeywords) {
            if (ispSearchSpace.includes(ik.keyword.toLowerCase())) {
              matchedIsp = ik.name;
              break;
            }
          }

          if (!matchedProvince && rawCountry) {
            if (rawCountry !== "China" && rawCountry !== "中国" && rawCountry !== "CN") {
              matchedProvince = rawCountry;
              if (!matchedIsp) {
                matchedIsp = rawIsp || "海外";
              }
            }
          } else if (!matchedProvince && (parsedJson.proCode === "999999" || parsedJson.pro === "英国" || parsedJson.addr?.includes("英国") || parsedJson.addr?.includes("美国") || parsedJson.addr?.includes("海外") || parsedJson.addr?.includes("日本") || parsedJson.addr?.includes("香港") || parsedJson.addr?.includes("台湾") || parsedJson.addr?.includes("新加坡") || parsedJson.addr?.includes("德国") || parsedJson.addr?.includes("法国") || parsedJson.addr?.includes("加拿大") || parsedJson.addr?.includes("澳大利亚") || parsedJson.addr?.includes("韩国"))) {
            matchedProvince = parsedJson.pro || parsedJson.addr || "海外";
            if (!matchedIsp) {
              matchedIsp = rawIsp || "海外";
            }
          }
        } else {
          const rawLower = text.toLowerCase();
          for (const p of provinces) {
            if (rawLower.includes(p.toLowerCase())) {
              matchedProvince = p;
              break;
            }
          }

          for (const ik of ispKeywords) {
            if (rawLower.includes(ik.keyword.toLowerCase())) {
              matchedIsp = ik.name;
              break;
            }
          }
        }

        if (matchedProvince || matchedIsp) {
          const geo = { province: matchedProvince, isp: matchedIsp, timestamp: Date.now() };
          ipGeoCache.set(ip, geo);
          if (api.failCount && api.failCount > 0) {
            api.failCount = 0;
            saveData();
          }
          return { province: geo.province, isp: geo.isp };
        } else {
          const fallbackGeo = { province: "", isp: "", timestamp: Date.now() };
          ipGeoCache.set(ip, fallbackGeo);
          return fallbackGeo;
        }
      } else {
        if (autoSwitchGeoApi && res.status >= 400 && res.status < 500) {
          api.failCount = (api.failCount || 0) + 1;
          if (api.failCount >= 5) {
            api.enabled = false;
            saveData();
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError" && autoSwitchGeoApi) {
        api.failCount = (api.failCount || 0) + 1;
        if (api.failCount >= 5) {
          api.enabled = false;
          saveData();
        }
      }
    }

    if (!autoSwitchGeoApi) break;
  }

  const finalFallback = { province: "", isp: "", timestamp: Date.now() };
  ipGeoCache.set(ip, finalFallback);
  return finalFallback;
}
