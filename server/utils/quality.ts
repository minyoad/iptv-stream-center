export type StreamProtocolType =
  | "HLS"
  | "HTTP-FLV"
  | "RTP-TS"
  | "HTTP-TS"
  | "RTSP"
  | "RTMP"
  | "HTTP"
  | "OTHER";

export interface StreamTypeInfo {
  type: StreamProtocolType;
  label: string;
  isRtpOrTsSlice: boolean;
  isHls: boolean;
  description: string;
}

export function isRtpOrTsSliceUrl(url: string = ""): boolean {
  if (!url) return false;
  const u = url.trim().toLowerCase();
  return (
    u.includes("/rtp/") ||
    u.includes("/tsfile/") ||
    u.startsWith("rtp://") ||
    u.startsWith("udp://") ||
    u.includes("/udp/")
  );
}

export function detectStreamType(url: string = ""): StreamTypeInfo {
  if (!url) {
    return {
      type: "OTHER",
      label: "未知",
      isRtpOrTsSlice: false,
      isHls: false,
      description: "未知流类型",
    };
  }

  const u = url.trim().toLowerCase();

  // 1. Check for /rtp/, /tsfile/, rtp://, udp:// slice streams
  if (
    u.includes("/rtp/") ||
    u.includes("/tsfile/") ||
    u.startsWith("rtp://") ||
    u.startsWith("udp://") ||
    u.includes("/udp/")
  ) {
    return {
      type: "RTP-TS",
      label: "RTP/TS切片",
      isRtpOrTsSlice: true,
      isHls: false,
      description: "包含 /rtp/ 或 /tsfile/ 的专网/切片流 (部分网络支持受限)",
    };
  }

  if (u.startsWith("rtsp://")) {
    return {
      type: "RTSP",
      label: "RTSP",
      isRtpOrTsSlice: false,
      isHls: false,
      description: "RTSP 实时流传输协议专网源",
    };
  }

  if (u.startsWith("rtmp://")) {
    return {
      type: "RTMP",
      label: "RTMP",
      isRtpOrTsSlice: false,
      isHls: false,
      description: "RTMP 实时消息传输协议流",
    };
  }

  if (u.includes(".m3u8") || u.includes("/hls/")) {
    return {
      type: "HLS",
      label: "HLS (通用)",
      isRtpOrTsSlice: false,
      isHls: true,
      description: "标准 HLS (.m3u8) 单播流 (全平台高兼容)",
    };
  }

  if (u.includes(".flv") || u.includes("/flv/")) {
    return {
      type: "HTTP-FLV",
      label: "HTTP-FLV",
      isRtpOrTsSlice: false,
      isHls: false,
      description: "HTTP-FLV 低延迟长连接流",
    };
  }

  if (u.includes(".ts") || u.includes("/ts/")) {
    return {
      type: "HTTP-TS",
      label: "HTTP-TS",
      isRtpOrTsSlice: false,
      isHls: false,
      description: "MPEG-TS 传输流源",
    };
  }

  if (u.startsWith("http://") || u.startsWith("https://")) {
    return {
      type: "HTTP",
      label: "HTTP 单播",
      isRtpOrTsSlice: false,
      isHls: false,
      description: "HTTP/HTTPS 通用单播流",
    };
  }

  return {
    type: "OTHER",
    label: "其它流",
    isRtpOrTsSlice: false,
    isHls: false,
    description: "自定义或其它流媒体协议",
  };
}

export interface QualityScoreDetail {
  score: number; // 0 to 100
  level: "excellent" | "good" | "fair" | "poor";
  levelText: string;
  breakdown: {
    statusScore: number;
    latencyScore: number;
    stabilityScore: number;
    resolutionScore: number;
    protocolScore: number;
  };
}

export function calculateQualityScore(source: {
  url?: string;
  status?: string;
  latency?: number;
  resolution?: string;
  testCount?: number;
  successCount?: number;
  isolated?: boolean;
}): QualityScoreDetail {
  if (source.isolated) {
    return {
      score: 0,
      level: "poor",
      levelText: "已隔离",
      breakdown: {
        statusScore: 0,
        latencyScore: 0,
        stabilityScore: 0,
        resolutionScore: 0,
        protocolScore: 0,
      },
    };
  }

  let statusScore = 0;
  if (source.status === "active") {
    statusScore = 45;
  } else if (source.status === "checking") {
    statusScore = 20;
  } else if (source.status === "unknown") {
    statusScore = 15;
  } else {
    statusScore = 0;
  }

  let latencyScore = 0;
  if (source.latency !== undefined && source.latency > 0) {
    if (source.latency < 100) {
      latencyScore = 25;
    } else if (source.latency < 250) {
      latencyScore = 20;
    } else if (source.latency < 500) {
      latencyScore = 15;
    } else if (source.latency < 1000) {
      latencyScore = 10;
    } else if (source.latency < 2500) {
      latencyScore = 5;
    } else {
      latencyScore = 1;
    }
  } else if (source.status === "active") {
    latencyScore = 12;
  }

  let stabilityScore = 0;
  if (source.testCount && source.testCount > 0) {
    const successRate = (source.successCount || 0) / source.testCount;
    stabilityScore = Math.round(successRate * 15);
  } else if (source.status === "active") {
    stabilityScore = 10;
  }

  let resolutionScore = 0;
  const resStr = (source.resolution || "").toLowerCase();
  if (resStr.includes("4k") || resStr.includes("2160")) {
    resolutionScore = 10;
  } else if (resStr.includes("1080")) {
    resolutionScore = 8;
  } else if (resStr.includes("720")) {
    resolutionScore = 6;
  } else if (resStr.includes("576") || resStr.includes("480")) {
    resolutionScore = 4;
  } else {
    resolutionScore = 2;
  }

  let protocolScore = 3;
  const streamInfo = detectStreamType(source.url || "");
  if (streamInfo.type === "HLS") {
    protocolScore = 5;
  } else if (streamInfo.type === "HTTP-FLV") {
    protocolScore = 4;
  } else if (streamInfo.type === "RTSP") {
    protocolScore = 3;
  } else if (streamInfo.type === "RTP-TS") {
    protocolScore = 2;
  }

  const totalScore = Math.min(
    100,
    Math.max(0, statusScore + latencyScore + stabilityScore + resolutionScore + protocolScore)
  );

  let level: "excellent" | "good" | "fair" | "poor" = "poor";
  let levelText = "较差";

  if (totalScore >= 85) {
    level = "excellent";
    levelText = "极佳";
  } else if (totalScore >= 70) {
    level = "good";
    levelText = "良好";
  } else if (totalScore >= 50) {
    level = "fair";
    levelText = "一般";
  }

  return {
    score: totalScore,
    level,
    levelText,
    breakdown: {
      statusScore,
      latencyScore,
      stabilityScore,
      resolutionScore,
      protocolScore,
    },
  };
}
