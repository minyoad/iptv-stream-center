import http from "http";
import https from "https";

export async function fetchBufferWithFallback(
  urlStr: string,
  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
): Promise<{ buffer: Buffer; isGzipped: boolean }> {
  const downloadDirectly = (targetUrlStr: string, maxRedirects = 5): Promise<{ buffer: Buffer; isGzipped: boolean }> => {
    return new Promise((resolve, reject) => {
      if (maxRedirects < 0) {
        return reject(new Error("Too many redirects (max 5 redirects allowed)"));
      }
      try {
        const parsedUrl = new URL(targetUrlStr);
        const isHttps = parsedUrl.protocol === "https:";
        const httpClient = isHttps ? https : http;

        const headers: Record<string, string> = {
          "User-Agent": userAgent,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept": "*/*"
        };

        const options: any = {
          method: "GET",
          headers,
          timeout: 45000,
        };

        if (isHttps) {
          options.rejectUnauthorized = false; // Bypass all certificate failures (expired, self-signed, host mismatch, etc.)
        }

        const req = httpClient.request(parsedUrl, options, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, parsedUrl.href).href;
            console.log(`[NETWORK RECOVERY] Following redirect: ${targetUrlStr} -> ${redirectUrl}`);
            return downloadDirectly(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP Error ${res.statusCode}`));
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const isGzipped = (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b);
            resolve({ buffer, isGzipped });
          });
        });

        req.on("error", (err) => {
          reject(err);
        });

        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Request timeout (20s)"));
        });

        req.end();
      } catch (err) {
        reject(err);
      }
    });
  };

  try {
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(urlStr, {
      headers: { "User-Agent": userAgent },
      signal: controller.signal,
    });
    clearTimeout(timeoutTimer);
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const isGzipped = (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b);
    return { buffer, isGzipped };
  } catch (fetchErr: any) {
    console.log(`[SYNC FETCH] Standard fetch failed for ${urlStr}: ${fetchErr.message || fetchErr}. Attempting recovery via bypass direct fetch...`);
    try {
      return await downloadDirectly(urlStr);
    } catch (fallbackErr: any) {
      // If it's a GitHub URL and proxy isn't already used, try fast public mirrors
      if ((urlStr.includes("raw.githubusercontent.com") || urlStr.includes("github.com")) && !urlStr.includes("ghproxy.net") && !urlStr.includes("ghfast.top")) {
        const mirrors = ["https://ghproxy.net/", "https://ghfast.top/"];
        for (const mirror of mirrors) {
          try {
            const mirrorUrl = `${mirror}${urlStr}`;
            console.log(`[SYNC FETCH] Attempting GitHub mirror fallback via ${mirrorUrl}...`);
            return await downloadDirectly(mirrorUrl);
          } catch (mErr) {}
        }
      }
      console.error(`[SYNC RECOVERY FAILED] ${urlStr}: ${fallbackErr.message || fallbackErr}`);
      throw new Error(fallbackErr.message || "Fetch failed");
    }
  }
}

export function isPrivateOrIntranetUrl(urlStr: string): boolean {
  if (!urlStr) return false;
  try {
    const urlLower = urlStr.toLowerCase().trim();
    if (
      urlLower.startsWith("rtsp://") ||
      urlLower.startsWith("rtmp://") ||
      urlLower.startsWith("udp://") ||
      urlLower.startsWith("rtp://") ||
      urlLower.startsWith("p2p://")
    ) {
      return true;
    }
    const withoutProtocol = urlLower.includes("://") ? urlLower.split("://")[1] : urlLower;
    const hostPort = withoutProtocol.split("/")[0].split("?")[0];
    const atIndex = hostPort.indexOf("@");
    const endpoint = atIndex === -1 ? hostPort : hostPort.substring(atIndex + 1);
    
    let host = endpoint;
    if (endpoint.startsWith("[")) {
      const closingIndex = endpoint.indexOf("]");
      if (closingIndex !== -1) {
        host = endpoint.substring(1, closingIndex);
      }
    } else if (endpoint.includes(":")) {
      host = endpoint.split(":")[0];
    }

    if (!host) return false;

    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".lan") ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("100.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return true;
    }

    const parts = host.split(".").map(Number);
    if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
      if (parts[0] >= 224 && parts[0] <= 239) return true;
    }
  } catch (e) {}
  return false;
}

