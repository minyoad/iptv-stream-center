import React, { useState, useEffect } from "react";
import { 
  Tv, 
  RefreshCw, 
  Download, 
  Copy, 
  Check, 
  ExternalLink, 
  Sparkles, 
  Layers, 
  Radio, 
  ShieldCheck, 
  FileText,
  SlidersHorizontal,
  Film
} from "lucide-react";
import { CarouselProxyView } from "./CarouselProxyView";
import { CarouselChannelView } from "./CarouselChannelView";
import { authFetch as fetch, safeJson } from "../utils/api";

interface CarouselHubViewProps {
  fetchData: () => void;
  channelsData?: any[];
  onFeedback?: (type: "success" | "error" | "info", message: string) => void;
  initialStats?: {
    channelsCount?: number;
    proxiesCount?: number;
    activeProxiesCount?: number;
  };
}

const STATS_STORAGE_KEY = "carousel_hub_stats_cache";

function getInitialCachedStats(): {
  channelsCount: number;
  proxiesCount: number;
  activeProxiesCount: number;
  sourcesCount: number;
} {
  try {
    const raw = localStorage.getItem(STATS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.proxiesCount === "number") {
        return parsed;
      }
    }
  } catch {}
  return {
    channelsCount: 0,
    proxiesCount: 0,
    activeProxiesCount: 0,
    sourcesCount: 0
  };
}

let memoryCachedStats = getInitialCachedStats();

export const CarouselHubView: React.FC<CarouselHubViewProps> = ({
  fetchData,
  channelsData = [],
  onFeedback,
  initialStats
}) => {
  const [activeTab, setActiveTab] = useState<"channels" | "proxies" | "export">("channels");
  const [stats, setStats] = useState<{
    channelsCount: number;
    proxiesCount: number;
    activeProxiesCount: number;
    sourcesCount: number;
  }>(() => {
    let base = { ...memoryCachedStats };
    if (initialStats) {
      if (typeof initialStats.channelsCount === "number") base.channelsCount = initialStats.channelsCount;
      if (typeof initialStats.proxiesCount === "number") base.proxiesCount = initialStats.proxiesCount;
      if (typeof initialStats.activeProxiesCount === "number") base.activeProxiesCount = initialStats.activeProxiesCount;
    }
    let totalCarouselSources = 0;
    if (Array.isArray(channelsData)) {
      channelsData.forEach((ch: any) => {
        if (ch.groupIds && (ch.groupIds.includes("g_carousel") || ch.groupIds.includes("轮播频道"))) {
          totalCarouselSources += (ch.sources ? ch.sources.length : 0);
        }
      });
      base.sourcesCount = totalCarouselSources;
    }
    return base;
  });

  useEffect(() => {
    if (initialStats && (typeof initialStats.proxiesCount === "number" || typeof initialStats.channelsCount === "number")) {
      setStats(prev => {
        const next = {
          ...prev,
          channelsCount: initialStats.channelsCount ?? prev.channelsCount,
          proxiesCount: initialStats.proxiesCount ?? prev.proxiesCount,
          activeProxiesCount: initialStats.activeProxiesCount ?? prev.activeProxiesCount,
        };
        memoryCachedStats = next;
        try { localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    }
  }, [initialStats]);

  // Export settings
  const [exportFormat, setExportFormat] = useState<"m3u" | "txt">("m3u");
  const [exportStatus, setExportStatus] = useState<string>("active");
  const [maxPerChannel, setMaxPerChannel] = useState<number>(5);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState<boolean>(false);

  const loadStats = async () => {
    try {
      const [chRes, prRes] = await Promise.all([
        fetch("/api/carousel-channels").catch(() => null),
        fetch("/api/carousel-proxies").catch(() => null)
      ]);
      const chData = await safeJson(chRes, []);
      const prData = await safeJson(prRes, []);

      const channelsCount = Array.isArray(chData) ? chData.length : 0;
      const proxiesList = Array.isArray(prData) ? prData : [];
      const proxiesCount = proxiesList.length;
      const activeProxiesCount = proxiesList.filter((p: any) => p.status === "active").length;

      // Count total sources under carousel channels
      let totalCarouselSources = 0;
      channelsData.forEach((ch: any) => {
        if (ch.groupIds && (ch.groupIds.includes("g_carousel") || ch.groupIds.includes("轮播频道"))) {
          totalCarouselSources += (ch.sources ? ch.sources.length : 0);
        }
      });

      const newStats = {
        channelsCount,
        proxiesCount,
        activeProxiesCount,
        sourcesCount: totalCarouselSources
      };
      memoryCachedStats = newStats;
      try { localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(newStats)); } catch {}
      setStats(newStats);
    } catch (err) {
      console.warn("Failed to load carousel stats:", err);
    }
  };

  useEffect(() => {
    loadStats();
  }, [channelsData]);

  const handleApplyAll = async () => {
    setIsApplying(true);
    try {
      const res = await fetch("/api/carousel-channels-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await safeJson(res);
      if (res.ok) {
        if (onFeedback) {
          onFeedback("success", data.message || "轮播源同步生成完成");
        }
        await fetchData();
        await loadStats();
      } else {
        if (onFeedback) {
          onFeedback("error", data.error || "生成失败");
        }
      }
    } catch (e: any) {
      if (onFeedback) {
        onFeedback("error", "网络连接异常");
      }
    } finally {
      setIsApplying(false);
    }
  };

  const getExportUrl = (format: "m3u" | "txt") => {
    const origin = window.location.origin;
    const params = new URLSearchParams();
    params.set("category", "轮播频道");
    if (exportStatus) params.set("status", exportStatus);
    if (maxPerChannel > 0) params.set("maxPerChannel", String(maxPerChannel));
    
    return `${origin}/api/export/${format}?${params.toString()}`;
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      if (onFeedback) onFeedback("success", "已成功复制到剪贴板");
      setTimeout(() => setCopiedKey(null), 2500);
    });
  };

  return (
    <div className="space-y-6 animate-fade-in" id="carousel_hub_view">
      {/* Top Banner & Quick Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-5 sm:p-7 text-white shadow-xl shadow-indigo-950/20 border border-indigo-900/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
        <div className="space-y-1.5 max-w-xl">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-[11px] font-bold">
            <Film className="w-3.5 h-3.5" />
            <span>轮播与代理流工作台</span>
          </div>
          <h2 className="text-lg sm:text-xl font-black tracking-tight text-white flex items-center gap-2">
            轮播频道映射与代理管理
          </h2>
          <p className="text-xs text-slate-300 font-medium leading-relaxed">
            统一维护各平台（虎牙/斗鱼/Bilibili/YY等）的轮播频道映射、轮播代理加速节点，并可一键生成专属轮播播放列表供 TVBox、Kodi 等播放器订阅。
          </p>
        </div>

        {/* Action Button & Stats Pills */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-start md:justify-end">
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-white/10 text-xs font-semibold">
            <span className="text-slate-300">映射频道:</span>
            <span className="font-bold text-white font-mono">{stats.channelsCount}</span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-300">可用代理:</span>
            <span className="font-bold text-emerald-400 font-mono">{stats.activeProxiesCount}/{stats.proxiesCount}</span>
          </div>

          <button
            type="button"
            onClick={handleApplyAll}
            disabled={isApplying}
            className="px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 text-white text-xs font-bold rounded-2xl shadow-lg shadow-indigo-500/30 transition cursor-pointer flex items-center gap-2 shrink-0 touch-press"
            title="将当前映射表与可用代理模板进行交叉组合，全量同步生成/更新轮播直播线路"
          >
            <Sparkles className={`w-4 h-4 ${isApplying ? "animate-spin" : ""}`} />
            <span>{isApplying ? "正在同步生成..." : "一键应用生成所有轮播源"}</span>
          </button>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="grid grid-cols-3 sm:flex sm:items-center gap-1.5 sm:gap-2 border-b border-slate-200 pb-3" id="carousel_hub_tabs">
        <button
          type="button"
          onClick={() => setActiveTab("channels")}
          className={`px-1.5 sm:px-4 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-[11px] sm:text-xs font-bold transition flex items-center justify-center sm:justify-start gap-1 sm:gap-2 cursor-pointer touch-press w-full sm:w-auto ${
            activeTab === "channels"
              ? "bg-slate-900 text-white shadow-md shadow-slate-900/20"
              : "bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200"
          }`}
        >
          <Tv className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          <span className="truncate">
            <span className="hidden min-[380px]:inline sm:inline">轮播</span>频道映射
          </span>
          <span className={`text-[10px] px-1 py-0.5 rounded-full font-mono font-bold shrink-0 ${
            activeTab === "channels" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
          }`}>
            {stats.channelsCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("proxies")}
          className={`px-1.5 sm:px-4 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-[11px] sm:text-xs font-bold transition flex items-center justify-center sm:justify-start gap-1 sm:gap-2 cursor-pointer touch-press w-full sm:w-auto ${
            activeTab === "proxies"
              ? "bg-slate-900 text-white shadow-md shadow-slate-900/20"
              : "bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200"
          }`}
        >
          <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          <span className="truncate">
            <span className="hidden min-[380px]:inline sm:inline">轮播</span>代理服务
          </span>
          <span className={`text-[10px] px-1 py-0.5 rounded-full font-mono font-bold shrink-0 ${
            activeTab === "proxies" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
          }`}>
            {stats.activeProxiesCount}/{stats.proxiesCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("export")}
          className={`px-1.5 sm:px-4 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-[11px] sm:text-xs font-bold transition flex items-center justify-center sm:justify-start gap-1 sm:gap-2 cursor-pointer touch-press w-full sm:w-auto ${
            activeTab === "export"
              ? "bg-slate-900 text-white shadow-md shadow-slate-900/20"
              : "bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-slate-200"
          }`}
        >
          <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-indigo-400" />
          <span className="truncate">
            <span className="hidden min-[380px]:inline sm:inline">轮播</span>导出<span className="hidden min-[380px]:inline sm:inline">订阅</span>
          </span>
        </button>
      </div>

      {/* Tab Panels with Instant Switch */}
      <div className={activeTab === "channels" ? "animate-fade-in" : "hidden"}>
        <CarouselChannelView 
          fetchData={async () => {
            await fetchData();
            await loadStats();
          }} 
          channelsData={channelsData} 
        />
      </div>

      <div className={activeTab === "proxies" ? "animate-fade-in" : "hidden"}>
        <CarouselProxyView 
          fetchData={async () => {
            await fetchData();
            await loadStats();
          }} 
        />
      </div>

      {activeTab === "export" && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-7 shadow-xs animate-fade-in" id="carousel_export_panel">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                <Download className="w-5 h-5 text-indigo-600" />
                轮播专属播放接口订阅
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-1">
                仅导出“轮播频道”分组下的所有有效线路，可直接输入影视播放器或 TVBox 作为独立轮播源。
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-bold text-slate-500">格式切换:</span>
              <button
                type="button"
                onClick={() => setExportFormat("m3u")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  exportFormat === "m3u"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                M3U 格式
              </button>
              <button
                type="button"
                onClick={() => setExportFormat("txt")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                  exportFormat === "txt"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                TXT 格式
              </button>
            </div>
          </div>

          {/* Filtering Options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-50 p-4 sm:p-5 rounded-2xl border border-slate-200/80">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">线路状态筛选</label>
              <select
                value={exportStatus}
                onChange={(e) => setExportStatus(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500/50 outline-none"
              >
                <option value="active">仅导出正常在线源 (推荐)</option>
                <option value="">全部状态 (含未检测/超时)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">每个频道最大保留线路数</label>
              <select
                value={maxPerChannel}
                onChange={(e) => setMaxPerChannel(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500/50 outline-none"
              >
                <option value={1}>1 条 (最快首选)</option>
                <option value={3}>3 条 (备用冗余)</option>
                <option value={5}>5 条 (推荐)</option>
                <option value={10}>10 条</option>
                <option value={0}>不限制 (导出全部)</option>
              </select>
            </div>

            <div className="sm:col-span-2 lg:col-span-1 flex flex-col justify-end">
              <div className="text-[11px] text-slate-500 bg-white px-3 py-2 rounded-xl border border-slate-200 leading-snug">
                💡 轮播源已自动按照代理节点稳定性及延迟进行智能优选排序。
              </div>
            </div>
          </div>

          {/* Export Cards */}
          <div className="space-y-4">
            {/* Primary Subscription Link */}
            <div className="bg-slate-900 rounded-2xl p-5 text-white space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5" />
                  专属轮播 {exportFormat.toUpperCase()} 订阅地址
                </span>
                <span className="text-[10px] bg-indigo-500/30 text-indigo-200 px-2 py-0.5 rounded-full font-mono">
                  GET
                </span>
              </div>

              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <code className="text-xs text-indigo-200 font-mono break-all truncate">
                  {getExportUrl(exportFormat)}
                </code>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => copyToClipboard(getExportUrl(exportFormat), "carousel_url")}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/30 touch-press"
                >
                  {copiedKey === "carousel_url" ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === "carousel_url" ? "已复制链接" : "复制订阅链接"}</span>
                </button>

                <a
                  href={getExportUrl(exportFormat)}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>浏览器打开预览</span>
                </a>

                <a
                  href={getExportUrl(exportFormat)}
                  download={`carousel_channels.${exportFormat}`}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载文件</span>
                </a>
              </div>
            </div>

            {/* Guide & Compatibility */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 space-y-1.5">
                <div className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                  <Tv className="w-3.5 h-3.5 text-indigo-600" />
                  TVBox / 影视仓
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  在直播地址中填入上述 M3U/TXT 链接即可自动同步轮播分类，支持遥控器数字选台。
                </p>
              </div>

              <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-100 space-y-1.5">
                <div className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-600" />
                  Kodi / IPTV Simple Client
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  添加 M3U 播放列表 URL，支持台标与节目名自动识别与流式无缝缓冲。
                </p>
              </div>

              <div className="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100 space-y-1.5">
                <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  PotPlayer / VLC
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  点击“下载文件”或直接在播放器中按 Ctrl+U 粘贴链接，即可按列表播放全部轮播流。
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
