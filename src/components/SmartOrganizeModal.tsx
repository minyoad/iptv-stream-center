import React, { useState } from "react";
import { 
  Sparkles, 
  Wand2, 
  CheckCircle2, 
  ArrowRight, 
  Search, 
  Filter, 
  X, 
  Layers, 
  Check, 
  AlertCircle,
  RefreshCw,
  Info,
  Building2,
  Tv2,
  MapPin
} from "lucide-react";

interface SmartOrganizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
  showFeedback: (type: "success" | "error" | "info", msg: string) => void;
}

export const SmartOrganizeModal: React.FC<SmartOrganizeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  showFeedback,
}) => {
  const [step, setStep] = useState<"config" | "preview">("config");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);

  // Config options
  const [groupingMode, setGroupingMode] = useState<"smart" | "province_only" | "keep_existing">("smart");
  const [provinceNameFormat, setProvinceNameFormat] = useState<"raw" | "suffix_local" | "suffix_province" | "suffix_channel">("raw");
  const [allowMultiGroup, setAllowMultiGroup] = useState(true);
  const [normalizeCctv, setNormalizeCctv] = useState(true);
  const [normalizeSatTv, setNormalizeSatTv] = useState(true);
  const [stripResolution, setStripResolution] = useState(true);
  const [extractIspAndProvince, setExtractIspAndProvince] = useState(true);
  const [onlyLocalChannels, setOnlyLocalChannels] = useState(false);

  // Preview data
  const [previewData, setPreviewData] = useState<{
    summary: {
      totalChannels: number;
      modifiedChannelsCount: number;
      nameChangesCount: number;
      groupChangesCount: number;
      sourcesUpdatedCount: number;
      newGroupsToCreate: string[];
    };
    changes: any[];
  } | null>(null);

  // Selection & Filter state in preview
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [previewFilter, setPreviewFilter] = useState<"all" | "name" | "group" | "source">("all");
  const [previewSearch, setPreviewSearch] = useState("");

  if (!isOpen) return null;

  const getAuthHeaders = (): Record<string, string> => {
    const pwd = localStorage.getItem("iptv_admin_password") || "";
    return {
      "Content-Type": "application/json",
      ...(pwd ? { "x-admin-password": pwd } : {}),
    };
  };

  const handleFetchPreview = async () => {
    setLoadingPreview(true);
    try {
      const res = await fetch("/api/channels/smart-organize/preview", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          groupingMode,
          provinceNameFormat,
          allowMultiGroup,
          normalizeCctv,
          normalizeSatTv,
          stripResolution,
          extractIspAndProvince,
          onlyLocalChannels,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPreviewData(data);
        // Default select all changes
        const allIds = data.changes.map((c: any) => c.channelId);
        setSelectedChannelIds(allIds);
        setStep("preview");
      } else {
        showFeedback("error", data.error || "获取对比预览失败");
      }
    } catch (err) {
      showFeedback("error", "网络请求异常，请稍后重试");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleApplyChanges = async () => {
    if (!previewData || selectedChannelIds.length === 0) {
      showFeedback("info", "请至少勾选一个要整理的频道项目");
      return;
    }

    setApplying(true);
    try {
      const selectedChanges = previewData.changes.filter((c) =>
        selectedChannelIds.includes(c.channelId)
      );

      const res = await fetch("/api/channels/smart-organize/apply", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          selectedChanges,
          options: { groupingMode, provinceNameFormat, allowMultiGroup, normalizeCctv, normalizeSatTv, stripResolution, extractIspAndProvince, onlyLocalChannels },
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showFeedback("success", data.message || "智能整理成功！");
        await onSuccess();
        onClose();
      } else {
        showFeedback("error", data.error || "应用智能整理失败");
      }
    } catch (err) {
      showFeedback("error", "网络故障，未成功应用变更");
    } finally {
      setApplying(false);
    }
  };

  // Filter changes for preview
  const filteredChanges = (previewData?.changes || []).filter((item) => {
    if (previewSearch) {
      const q = previewSearch.toLowerCase();
      const matchName = item.originalName.toLowerCase().includes(q) || item.newName.toLowerCase().includes(q);
      const matchGroup = item.targetGroupNames.some((gn: string) => gn.toLowerCase().includes(q));
      if (!matchName && !matchGroup) return false;
    }

    if (previewFilter === "name") return item.nameChanged;
    if (previewFilter === "group") return item.groupsChanged;
    if (previewFilter === "source") return item.sourcesUpdatedCount > 0;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-purple-950 p-5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl shadow-lg ring-2 ring-white/20">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
                <span>频道与分组智能整理中心</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/30 border border-purple-400/40 text-purple-200">
                  AI 智能抓取
                </span>
              </h3>
              <p className="text-xs text-slate-300 font-medium mt-0.5">
                根据频道名称自动提取省份、运营商关键字，归类建组并规范化频道命名
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {step === "config" ? (
            <div className="space-y-6 animate-fade-in">
              {/* Option 1: Grouping Mode */}
              <div className="bg-slate-50/80 border border-slate-200/80 p-5 rounded-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-xs font-bold text-slate-800">1. 分组建组与划分策略</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                  <label
                    onClick={() => setGroupingMode("smart")}
                    className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      groupingMode === "smart"
                        ? "bg-indigo-50/70 border-indigo-500 ring-2 ring-indigo-500/20 text-indigo-950 font-bold"
                        : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                          智能多维建组
                        </span>
                        {groupingMode === "smart" && <Check className="w-4 h-4 text-indigo-600" />}
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed font-normal">
                        精细划分: 央视、卫视、港澳台、4K超清及各省地方台，省份分组统一归类
                      </p>
                    </div>
                  </label>

                  <label
                    onClick={() => setGroupingMode("province_only")}
                    className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      groupingMode === "province_only"
                        ? "bg-indigo-50/70 border-indigo-500 ring-2 ring-indigo-500/20 text-indigo-950 font-bold"
                        : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <Tv2 className="w-3.5 h-3.5 text-indigo-600" />
                          纯省份建组
                        </span>
                        {groupingMode === "province_only" && <Check className="w-4 h-4 text-indigo-600" />}
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed font-normal">
                        按省份直接划分地方台分组，各省份独立成组
                      </p>
                    </div>
                  </label>

                  <label
                    onClick={() => setGroupingMode("keep_existing")}
                    className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      groupingMode === "keep_existing"
                        ? "bg-indigo-50/70 border-indigo-500 ring-2 ring-indigo-500/20 text-indigo-950 font-bold"
                        : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-indigo-600" />
                          保留自定义分组
                        </span>
                        {groupingMode === "keep_existing" && <Check className="w-4 h-4 text-indigo-600" />}
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed font-normal">
                        保留已有自定义分组，仅为未分类或处于默认备用分组的频道进行归类
                      </p>
                    </div>
                  </label>
                </div>

                {/* Sub-option: Province Group Naming Format */}
                <div className="pt-3 border-t border-slate-200/70 mt-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      省份分组命名统一风格:
                    </span>
                    <span className="text-[10px] text-slate-400">
                      💡 系统会自动优先复用现有省份分组名称，防止生成重复分组
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: "raw", label: "纯省份简称", example: "广东、浙江" },
                      { id: "suffix_local", label: "带「地方」后缀", example: "广东地方、浙江地方" },
                      { id: "suffix_province", label: "全称(省/市)", example: "广东省、上海市" },
                      { id: "suffix_channel", label: "带「频道」后缀", example: "广东频道、浙江频道" },
                    ].map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => setProvinceNameFormat(fmt.id as any)}
                        className={`p-2.5 rounded-xl border text-left transition ${
                          provinceNameFormat === fmt.id
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm font-semibold"
                            : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="text-[11px] font-bold flex items-center justify-between">
                          <span>{fmt.label}</span>
                          {provinceNameFormat === fmt.id && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className={`text-[10px] mt-0.5 font-mono ${provinceNameFormat === fmt.id ? "text-indigo-100" : "text-slate-400"}`}>
                          {fmt.example}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Multi-group option */}
                <div className="pt-3 border-t border-slate-200/70">
                  <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200 hover:border-indigo-300 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={allowMultiGroup}
                      onChange={(e) => setAllowMultiGroup(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-indigo-600 border-indigo-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        支持多重分组 (允许频道同时归入多个符合条件的分组)
                      </span>
                      <span className="text-[11px] text-indigo-800 font-medium block mt-0.5 leading-relaxed">
                        开启后，符合多特征的频道将同时加入多个分组。例如 <span className="font-mono font-bold">CCTV-5 4K</span> 将同时归入 <span className="font-mono font-bold">「央视频道」</span>、<span className="font-mono font-bold">「4K超清」</span> 和 <span className="font-mono font-bold">「体育频道」</span>；<span className="font-mono font-bold">广东体育</span> 将同时归入 <span className="font-mono font-bold">「广东」</span> 和 <span className="font-mono font-bold">「体育频道」</span>
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Option 2: Name Normalization Checkboxes */}
              <div className="bg-slate-50/80 border border-slate-200/80 p-5 rounded-2xl space-y-4">
                <div className="flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-purple-600" />
                  <h4 className="text-xs font-bold text-slate-800">2. 频道命名格式规范化处理</h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-slate-200 hover:border-slate-300 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={normalizeCctv}
                      onChange={(e) => setNormalizeCctv(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">规范 CCTV 央视频道命名</span>
                      <span className="text-[11px] text-slate-500 font-medium">
                        如: <span className="font-mono text-slate-600">cctv1</span> / <span className="font-mono text-slate-600">CCTV1高清</span> $\rightarrow$ <span className="font-mono text-indigo-600 font-bold">CCTV-1 综合</span>
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-slate-200 hover:border-slate-300 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={normalizeSatTv}
                      onChange={(e) => setNormalizeSatTv(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">规范 卫视 频道命名</span>
                      <span className="text-[11px] text-slate-500 font-medium">
                        如: <span className="font-mono text-slate-600">湖南卫视 HD</span> / <span className="font-mono text-slate-600">浙江卫视 1080p</span> $\rightarrow$ <span className="font-mono text-indigo-600 font-bold">湖南卫视</span>
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-slate-200 hover:border-slate-300 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={stripResolution}
                      onChange={(e) => setStripResolution(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">清洗画质与码率冗余后缀</span>
                      <span className="text-[11px] text-slate-500 font-medium">
                        清除 <span className="font-mono text-slate-600">[1080p]</span>、<span className="font-mono text-slate-600">4M1080</span>、<span className="font-mono text-slate-600">标清</span>、<span className="font-mono text-slate-600">超清</span> 等画质标签
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-slate-200 hover:border-slate-300 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={extractIspAndProvince}
                      onChange={(e) => setExtractIspAndProvince(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-800 block">提炼运营商/省份至线路 metadata</span>
                      <span className="text-[11px] text-slate-500 font-medium">
                        提取频道名中的 <span className="font-mono text-indigo-600">电信/联通/移动</span> 并自动写入线路属性
                      </span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-purple-50/70 border border-purple-200 hover:border-purple-300 cursor-pointer transition sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={onlyLocalChannels}
                      onChange={(e) => setOnlyLocalChannels(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-purple-600 border-purple-300 rounded focus:ring-purple-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                        仅匹配省市地方频道 (跳过央视/卫视/全国频道)
                      </span>
                      <span className="text-[11px] text-purple-800 font-medium block mt-0.5 leading-relaxed">
                        开启后，智能归类逻辑只处理名称中包含明确省、市、区地域关键字的频道 (如 <span className="font-mono font-bold">广州综合</span>、<span className="font-mono font-bold">成都公共</span>、<span className="font-mono font-bold">浦东新闻</span>)，自动跳过央视、卫视等全国性频道，避免误归入省份分组
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Info banner */}
              <div className="bg-blue-50/60 border border-blue-100 p-4 rounded-2xl flex items-start gap-3 text-xs text-blue-900">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">智能整理提示：</p>
                  <p className="text-[11px] text-blue-700 leading-relaxed font-medium">
                    点击下方“生成对比预览”后，系统会逐一分析所有频道，并显示对比清单。未创建的目标省份分组将在确认应用后自动新建，不会破坏已有频道结构。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* STEP 2: PREVIEW SCREEN */
            <div className="space-y-5 animate-fade-in">
              {/* Summary Metrics Bar */}
              {previewData && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-50 border border-slate-200/80 p-3.5 rounded-2xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">拟整理频道数</span>
                    <span className="text-lg font-black text-slate-800 font-mono">
                      {previewData.summary.modifiedChannelsCount} <span className="text-xs text-slate-400 font-normal">/ {previewData.summary.totalChannels}</span>
                    </span>
                  </div>

                  <div className="bg-purple-50/60 border border-purple-100 p-3.5 rounded-2xl space-y-1">
                    <span className="text-[10px] text-purple-600 font-bold uppercase tracking-wider block">名称规范化</span>
                    <span className="text-lg font-black text-purple-700 font-mono">
                      {previewData.summary.nameChangesCount} <span className="text-xs text-purple-400 font-normal">个</span>
                    </span>
                  </div>

                  <div className="bg-indigo-50/60 border border-indigo-100 p-3.5 rounded-2xl space-y-1">
                    <span className="text-[10px] text-indigo-600 font-bold uppercase tracking-wider block">分组重新归类</span>
                    <span className="text-lg font-black text-indigo-700 font-mono">
                      {previewData.summary.groupChangesCount} <span className="text-xs text-indigo-400 font-normal">个</span>
                    </span>
                  </div>

                  <div className="bg-emerald-50/60 border border-emerald-100 p-3.5 rounded-2xl space-y-1">
                    <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider block">自动新建分组</span>
                    <span className="text-lg font-black text-emerald-700 font-mono">
                      {previewData.summary.newGroupsToCreate.length} <span className="text-xs text-emerald-500 font-normal">个</span>
                    </span>
                  </div>
                </div>
              )}

              {/* New Groups Pill Info */}
              {previewData?.summary.newGroupsToCreate.length ? (
                <div className="bg-emerald-50/40 border border-emerald-200/80 p-3.5 rounded-2xl flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-emerald-900 shrink-0 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    即将自动创建以下新分组 ({previewData.summary.newGroupsToCreate.length} 个):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {previewData.summary.newGroupsToCreate.map((gName) => (
                      <span key={gName} className="px-2 py-0.5 bg-emerald-100 border border-emerald-200 text-emerald-800 text-[10px] font-bold rounded-lg">
                        +{gName}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Search & Filter Bar */}
              <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
                <div className="relative flex-1 sm:max-w-xs">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    placeholder="搜索拟变更频道或分组..."
                    className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-xl text-xs bg-slate-50/50 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-[11px] font-bold">
                  <button
                    onClick={() => setPreviewFilter("all")}
                    className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                      previewFilter === "all" ? "bg-white text-indigo-700 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    全部 ({previewData?.changes.length})
                  </button>
                  <button
                    onClick={() => setPreviewFilter("name")}
                    className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                      previewFilter === "name" ? "bg-white text-indigo-700 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    名称变动 ({previewData?.summary.nameChangesCount})
                  </button>
                  <button
                    onClick={() => setPreviewFilter("group")}
                    className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                      previewFilter === "group" ? "bg-white text-indigo-700 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    分组归类 ({previewData?.summary.groupChangesCount})
                  </button>
                  <button
                    onClick={() => setPreviewFilter("source")}
                    className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                      previewFilter === "source" ? "bg-white text-indigo-700 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    线路更新 ({previewData?.summary.sourcesUpdatedCount})
                  </button>
                </div>
              </div>

              {/* Table List of Changes */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white max-h-[380px] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500 tracking-wider sticky top-0 z-10 backdrop-blur-xs">
                    <tr>
                      <th className="py-2.5 px-3.5 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={
                            filteredChanges.length > 0 &&
                            filteredChanges.every((c) => selectedChannelIds.includes(c.channelId))
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              const ids = filteredChanges.map((c) => c.channelId);
                              setSelectedChannelIds((prev) => Array.from(new Set([...prev, ...ids])));
                            } else {
                              const idsToDeselect = filteredChanges.map((c) => c.channelId);
                              setSelectedChannelIds((prev) => prev.filter((id) => !idsToDeselect.includes(id)));
                            }
                          }}
                          className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                        />
                      </th>
                      <th className="py-2.5 px-3">频道名称变更对比</th>
                      <th className="py-2.5 px-3">分组变动对比</th>
                      <th className="py-2.5 px-3">提取的省份 / 运营商</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-medium">
                    {filteredChanges.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-slate-400">
                          未搜索到匹配的智能整理项目
                        </td>
                      </tr>
                    ) : (
                      filteredChanges.map((item) => {
                        const isChecked = selectedChannelIds.includes(item.channelId);
                        return (
                          <tr
                            key={item.channelId}
                            onClick={() => {
                              if (isChecked) {
                                setSelectedChannelIds((prev) => prev.filter((id) => id !== item.channelId));
                              } else {
                                setSelectedChannelIds((prev) => [...prev, item.channelId]);
                              }
                            }}
                            className={`hover:bg-slate-50 transition cursor-pointer ${
                              isChecked ? "bg-indigo-50/30" : ""
                            }`}
                          >
                            <td className="py-3 px-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedChannelIds((prev) => [...prev, item.channelId]);
                                  } else {
                                    setSelectedChannelIds((prev) => prev.filter((id) => id !== item.channelId));
                                  }
                                }}
                                className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                              />
                            </td>

                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-500 font-mono line-through decoration-slate-300">
                                  {item.originalName}
                                </span>
                                {item.nameChanged ? (
                                  <>
                                    <ArrowRight className="w-3 h-3 text-purple-500 shrink-0" />
                                    <span className="font-bold text-slate-900 bg-purple-50 px-2 py-0.5 rounded border border-purple-200/80">
                                      {item.newName}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-[10px] text-slate-400 font-normal ml-1">(保持原名)</span>
                                )}
                              </div>
                            </td>

                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                <span className="text-slate-500 text-[11px]">
                                  {item.originalGroupNames.join(", ")}
                                </span>
                                {item.groupsChanged ? (
                                  <>
                                    <ArrowRight className="w-3 h-3 text-indigo-500 shrink-0" />
                                    <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200/80">
                                      {item.targetGroupNames.join(", ")}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-[10px] text-slate-400 font-normal ml-1">(分组不变)</span>
                                )}
                              </div>
                            </td>

                            <td className="py-3 px-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {item.detectedProvince && item.detectedProvince !== "全国" ? (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold">
                                    省: {item.detectedProvince}
                                  </span>
                                ) : null}
                                {item.detectedIsp && item.detectedIsp !== "BGP" ? (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 text-[10px] font-bold">
                                    网: {item.detectedIsp}
                                  </span>
                                ) : null}
                                {!item.detectedProvince && !item.detectedIsp && (
                                  <span className="text-slate-400 text-[11px]">通用全国</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
          {step === "config" ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                取消
              </button>

              <button
                onClick={handleFetchPreview}
                disabled={loadingPreview}
                className="px-6 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition cursor-pointer flex items-center gap-2 disabled:opacity-50"
              >
                {loadingPreview ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>正在智能分析全量频道...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>生成对比预览</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep("config")}
                disabled={applying}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                返回修改规则
              </button>

              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 font-medium hidden sm:inline">
                  已勾选 <span className="font-bold text-indigo-600 font-mono">{selectedChannelIds.length}</span> 项变更
                </span>

                <button
                  onClick={handleApplyChanges}
                  disabled={applying || selectedChannelIds.length === 0}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md transition cursor-pointer flex items-center gap-2 disabled:opacity-50"
                >
                  {applying ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>正在应用整理...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>确认应用选中的整理 ({selectedChannelIds.length})</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
};
