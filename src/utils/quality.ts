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
  colorClass: string;
  badgeClass: string;
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
      colorClass: "text-slate-500 bg-slate-100 border-slate-200",
      badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
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
      colorClass: "text-amber-800 bg-amber-50 border-amber-300",
      badgeClass: "bg-amber-50 text-amber-800 border-amber-300 font-bold shadow-2xs",
      description: "包含 /rtp/ 或 /tsfile/ 的特定专网/切片流 (部分网络支持较差)",
    };
  }

  if (u.startsWith("rtsp://")) {
    return {
      type: "RTSP",
      label: "RTSP",
      isRtpOrTsSlice: false,
      isHls: false,
      colorClass: "text-purple-700 bg-purple-50 border-purple-200",
      badgeClass: "bg-purple-50 text-purple-700 border-purple-200 shadow-2xs",
      description: "RTSP 实时流传输协议专网源",
    };
  }

  if (u.startsWith("rtmp://")) {
    return {
      type: "RTMP",
      label: "RTMP",
      isRtpOrTsSlice: false,
      isHls: false,
      colorClass: "text-pink-700 bg-pink-50 border-pink-200",
      badgeClass: "bg-pink-50 text-pink-700 border-pink-200 shadow-2xs",
      description: "RTMP 实时消息传输协议流",
    };
  }

  if (u.includes(".m3u8") || u.includes("/hls/")) {
    return {
      type: "HLS",
      label: "HLS (通用)",
      isRtpOrTsSlice: false,
      isHls: true,
      colorClass: "text-emerald-700 bg-emerald-50 border-emerald-200",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 shadow-2xs font-bold",
      description: "标准 HLS (.m3u8) 单播流 (全平台高兼容，跨网络推荐)",
    };
  }

  if (u.includes(".flv") || u.includes("/flv/")) {
    return {
      type: "HTTP-FLV",
      label: "HTTP-FLV",
      isRtpOrTsSlice: false,
      isHls: false,
      colorClass: "text-cyan-700 bg-cyan-50 border-cyan-200",
      badgeClass: "bg-cyan-50 text-cyan-700 border-cyan-200 shadow-2xs font-semibold",
      description: "HTTP-FLV 低延迟长连接流",
    };
  }

  if (u.includes(".ts") || u.includes("/ts/")) {
    return {
      type: "HTTP-TS",
      label: "HTTP-TS",
      isRtpOrTsSlice: false,
      isHls: false,
      colorClass: "text-blue-700 bg-blue-50 border-blue-200",
      badgeClass: "bg-blue-50 text-blue-700 border-blue-200 shadow-2xs",
      description: "MPEG-TS 传输流源",
    };
  }

  if (u.startsWith("http://") || u.startsWith("https://")) {
    return {
      type: "HTTP",
      label: "HTTP 单播",
      isRtpOrTsSlice: false,
      isHls: false,
      colorClass: "text-slate-700 bg-slate-100 border-slate-200",
      badgeClass: "bg-slate-100 text-slate-700 border-slate-200 shadow-2xs",
      description: "HTTP/HTTPS 通用单播流",
    };
  }

  return {
    type: "OTHER",
    label: "其它流",
    isRtpOrTsSlice: false,
    isHls: false,
    colorClass: "text-slate-500 bg-slate-100 border-slate-200",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
    description: "自定义或其它流媒体协议",
  };
}

export interface QualityScoreDetail {
  score: number; // 0 to 100
  level: "excellent" | "good" | "fair" | "poor";
  levelText: string; // 极佳, 良好, 一般, 较差
  badgeClass: string;
  pillBg: string;
  textColor: string;
  borderColor: string;
  breakdown: {
    statusScore: number; // Max 45
    latencyScore: number; // Max 25
    stabilityScore: number; // Max 15
    resolutionScore: number; // Max 10
    protocolScore: number; // Max 5
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
      badgeClass: "bg-orange-100 text-orange-700 border-orange-200",
      pillBg: "bg-orange-50",
      textColor: "text-orange-700",
      borderColor: "border-orange-200",
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
    // inactive
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
    protocolScore = 5; // HLS standard is highest compatibility
  } else if (streamInfo.type === "HTTP-FLV") {
    protocolScore = 4;
  } else if (streamInfo.type === "RTSP") {
    protocolScore = 3;
  } else if (streamInfo.type === "RTP-TS") {
    protocolScore = 2; // /rtp/ or /tsfile/ may fail on some networks
  }

  const totalScore = Math.min(
    100,
    Math.max(0, statusScore + latencyScore + stabilityScore + resolutionScore + protocolScore)
  );

  let level: "excellent" | "good" | "fair" | "poor" = "poor";
  let levelText = "较差";
  let badgeClass = "bg-rose-50 text-rose-700 border-rose-200";
  let pillBg = "bg-rose-50";
  let textColor = "text-rose-700";
  let borderColor = "border-rose-200";

  if (totalScore >= 85) {
    level = "excellent";
    levelText = "极佳";
    badgeClass = "bg-emerald-50 text-emerald-700 border-emerald-300 shadow-2xs font-extrabold";
    pillBg = "bg-emerald-50";
    textColor = "text-emerald-700";
    borderColor = "border-emerald-300";
  } else if (totalScore >= 70) {
    level = "good";
    levelText = "良好";
    badgeClass = "bg-blue-50 text-blue-700 border-blue-200 font-bold";
    pillBg = "bg-blue-50";
    textColor = "text-blue-700";
    borderColor = "border-blue-200";
  } else if (totalScore >= 50) {
    level = "fair";
    levelText = "一般";
    badgeClass = "bg-amber-50 text-amber-700 border-amber-200 font-semibold";
    pillBg = "bg-amber-50";
    textColor = "text-amber-700";
    borderColor = "border-amber-200";
  }

  return {
    score: totalScore,
    level,
    levelText,
    badgeClass,
    pillBg,
    textColor,
    borderColor,
    breakdown: {
      statusScore,
      latencyScore,
      stabilityScore,
      resolutionScore,
      protocolScore,
    },
  };
}
