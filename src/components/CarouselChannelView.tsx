import React, { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Search, Link as LinkIcon, Save, RefreshCw, Wand2, CheckSquare, Square, X, Download, Eye, EyeOff, Filter, RotateCcw, Power, ShieldAlert, AlertTriangle, CheckCircle, AlertCircle, Info } from "lucide-react";
import { authFetch as fetch } from "../utils/api";
import { PRESET_CAROUSEL_PLATFORMS, getPlatformBadge, getPlatformInfo } from "../utils/carouselPlatforms";

export const CarouselChannelView = ({ fetchData, channelsData = [] }: { fetchData: () => void, channelsData?: any[] }) => {
  const [channels, setChannels] = useState<any[]>([]);
  const [unregistered, setUnregistered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", channelId: "", platform: "yy", customPlatform: "", originalId: "" });
  const [activeTab, setActiveTab] = useState<"registry" | "unregistered" | "rules">("registry");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "platform">("platform");
  const [rules, setRules] = useState<any[]>([]);
  const [ruleForm, setRuleForm] = useState({ platform: "yy", keyword: "" });
  const [customPlatform, setCustomPlatform] = useState("");
  const [ruleSearchQuery, setRuleSearchQuery] = useState("");
  const [rulePlatformFilter, setRulePlatformFilter] = useState("all");
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [presetLoading, setPresetLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);

  const [isRescanning, setIsRescanning] = useState(false);

  // Search & Ignore state for unregistered items
  const [ignoredKeys, setIgnoredKeys] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("carousel_ignored_unregistered");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showIgnored, setShowIgnored] = useState(false);
  const [unregSearchQuery, setUnregSearchQuery] = useState("");
  const [unregPlatformFilter, setUnregPlatformFilter] = useState("all");

  const toggleIgnoreUnregistered = (key: string) => {
    setIgnoredKeys(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      try {
        localStorage.setItem("carousel_ignored_unregistered", JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  };

  const batchIgnoreUnregistered = (keysToIgnore: string[]) => {
    if (keysToIgnore.length === 0) return;
    setIgnoredKeys(prev => {
      const set = new Set([...prev, ...keysToIgnore]);
      const next = Array.from(set);
      try {
        localStorage.setItem("carousel_ignored_unregistered", JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
    setSelectedUnregIds(prev => prev.filter(id => !keysToIgnore.includes(id)));
    showToast(`已将 ${keysToIgnore.length} 个未映射项移入忽略列表`, "info");
  };

  const clearAllIgnored = () => {
    setIgnoredKeys([]);
    try {
      localStorage.removeItem("carousel_ignored_unregistered");
    } catch (e) {
      console.error(e);
    }
    showToast("已清空忽略名单，已被恢复显示", "success");
  };

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => (prev?.message === message ? null : prev));
    }, 4000);
  };

  const handleRescanUnregistered = async () => {
    setIsRescanning(true);
    try {
      const res = await fetch("/api/carousel-channels-unregistered/rescan", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setUnregistered(Array.isArray(data.unregistered) ? data.unregistered : []);
        showToast(
          `重新扫描完成！已分析 ${data.scannedSourcesCount || 0} 个直播源，发现 ${data.count} 个未映射轮播直播间${data.newlyDiscoveredProxies ? `，提取 ${data.newlyDiscoveredProxies} 个新代理模板` : ''}`,
          "success"
        );
      } else {
        showToast("重新扫描失败: " + (data.error || "未知异常"), "error");
      }
    } catch (e: any) {
      showToast("重新扫描通信故障: " + (e.message || "网络错误"), "error");
    } finally {
      setIsRescanning(false);
    }
  };

  const loadRulesOnly = async () => {
    try {
      const res = await fetch("/api/carousel-discovery-rules");
      const data = await res.json();
      if (Array.isArray(data)) {
        setRules(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLoadPresetRules = async (mode: "seed" | "reset" = "seed") => {
    setPresetLoading(true);
    setShowResetConfirmModal(false);
    try {
      const res = await fetch("/api/carousel-discovery-rules/preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast((data.message || "成功加载预置特征发现规则！") + " 正在重新扫描未映射源...", "success");
        if (Array.isArray(data.rules)) {
          setRules(data.rules);
        }
        await loadData();
      } else {
        showToast("预置规则失败: " + (data.error || "网络故障"), "error");
      }
    } catch (e: any) {
      showToast("预置规则通信失败: " + (e.message || "网络错误"), "error");
    } finally {
      setPresetLoading(false);
    }
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRegistryIds, setSelectedRegistryIds] = useState<string[]>([]);
  const [proxies, setProxies] = useState<any[]>([]);
  const [selectedUnregIds, setSelectedUnregIds] = useState<string[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
        const [res1, res2, res3, res4] = await Promise.all([
          fetch("/api/carousel-channels"),
          fetch("/api/carousel-channels-unregistered"),
          fetch("/api/carousel-discovery-rules"),
          fetch("/api/carousel-proxies")
        ]);
        const d1 = await res1.json();
        const d2 = await res2.json();
        const d3 = await res3.json();
        const d4 = await res4.json();
        setChannels(Array.isArray(d1) ? d1 : []);
        setUnregistered(Array.isArray(d2) ? d2 : []);
        setRules(Array.isArray(d3) ? d3 : []);
        setProxies(Array.isArray(d4) ? d4 : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const effectiveFormPlatform = form.platform === "custom" ? (form.customPlatform.trim().toLowerCase() || "custom") : form.platform;

  const saveChannel = async () => {
    if (!form.name || !effectiveFormPlatform || !form.originalId) return alert("请填写完整的频道名称、平台和直播间 ID");

    let platformToSave = effectiveFormPlatform;
    let originalIdToSave = form.originalId.trim();

    // Validate Migu IDs vs CNTV IDs
    if (platformToSave === "migu") {
      if (/^cctv|^cgtn/i.test(originalIdToSave)) {
        platformToSave = "cntv";
        showToast("检测到央视 (cctv) 标识，已自动修正平台为 CNTV 央视", "info");
      } else if (!/^\d+$/.test(originalIdToSave)) {
        showToast("咪咕 (migu) 频道的直播间 ID 须为 8~10 位纯数字（如 631780532、708807420）。cctv1 等字符属于 CNTV (央视) 平台。", "error");
        return;
      }
    }

    const existing = channelsData?.find(c => c.name.trim().toLowerCase() === form.name.trim().toLowerCase() || (form.channelId && c.id === form.channelId));
    const payload = {
      name: (existing ? existing.name : form.name).trim(),
      platform: platformToSave,
      originalId: originalIdToSave,
      channelId: existing ? existing.id : (form.channelId || "")
    };
    try {
      if (editingId) {
        await fetch(`/api/carousel-channels/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        await fetch("/api/carousel-channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }
      setEditingId(null);
      setForm({ name: "", channelId: "", platform: "yy", customPlatform: "", originalId: "" });
      setIsModalOpen(false);
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteChannel = async (id: string) => {
    try {
      await fetch(`/api/carousel-channels/${id}`, { method: "DELETE" });
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const saveRule = async () => {
    const finalPlatform = ruleForm.platform === "custom" ? customPlatform.trim().toLowerCase() : ruleForm.platform;
    if (!finalPlatform || !ruleForm.keyword.trim()) return showToast("请填写完整的平台标识和 URL 特征关键词", "error");
    try {
      const res = await fetch("/api/carousel-discovery-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: finalPlatform, keyword: ruleForm.keyword.trim(), enabled: 1 })
      });
      if (res.ok) {
        setRuleForm({ platform: "yy", keyword: "" });
        setCustomPlatform("");
        showToast("已成功添加特征规则，正在重新扫描直播源...", "success");
        await loadData();
      } else {
        const d = await res.json().catch(() => ({}));
        showToast("保存规则失败: " + (d.error || "未知原因"), "error");
      }
    } catch (e) {
      console.error(e);
      showToast("保存规则网络错误", "error");
    }
  };

  const toggleRuleEnabled = async (r: any) => {
    const nextEnabled = r.enabled === 0 ? 1 : 0;
    try {
      const res = await fetch(`/api/carousel-discovery-rules/${r.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled })
      });
      if (res.ok) {
        showToast(nextEnabled ? "已启用规则，正在更新未映射源..." : "已停用规则，正在更新未映射源...", "info");
        await loadData();
      } else {
        showToast("切换规则状态失败", "error");
      }
    } catch (e) {
      console.error(e);
      showToast("网络通信错误", "error");
    }
  };

  const deleteRule = async (id: string) => {
    try {
      const res = await fetch(`/api/carousel-discovery-rules/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSelectedRuleIds(prev => prev.filter(i => i !== id));
        showToast("已删除特征发现规则，并更新未映射列表", "success");
        await loadData();
      } else {
        showToast("删除规则失败", "error");
      }
    } catch (e) {
      console.error(e);
      showToast("删除规则网络错误", "error");
    }
  };

  const handleBatchDeleteRules = async () => {
    if (selectedRuleIds.length === 0) return;
    if (!confirm(`确定要批量删除选中的 ${selectedRuleIds.length} 条特征规则吗？`)) return;
    try {
      const res = await fetch('/api/carousel-discovery-rules/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedRuleIds })
      });
      if (res.ok) {
        showToast(`已批量删除 ${selectedRuleIds.length} 条特征规则，并重新扫描未映射源`, "success");
        setSelectedRuleIds([]);
        await loadData();
      } else {
        showToast("批量删除规则失败", "error");
      }
    } catch (e) {
      console.error(e);
      showToast("批量删除网络通信失败", "error");
    }
  };

  const handleClearIptvRules = async () => {
    const iptvRuleIds = rules.filter(r => r.platform === 'iptv' || (r.keyword && r.keyword.toLowerCase().includes('iptv'))).map(r => r.id);
    if (iptvRuleIds.length === 0) {
      return showToast("当前规则库中未包含任何 IPTV 规则", "info");
    }
    if (!confirm(`确定要一键清理全部 ${iptvRuleIds.length} 条 IPTV 相关特征规则吗？`)) return;
    try {
      const res = await fetch('/api/carousel-discovery-rules/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: iptvRuleIds })
      });
      if (res.ok) {
        showToast(`已成功清除 ${iptvRuleIds.length} 条 IPTV 特征规则并重新扫描`, "success");
        setSelectedRuleIds(prev => prev.filter(id => !iptvRuleIds.includes(id)));
        await loadData();
      } else {
        showToast("清除 IPTV 规则失败", "error");
      }
    } catch (e) {
      console.error(e);
      showToast("网络通信故障", "error");
    }
  };

  const handleBatchDeleteRegistry = async () => {
    if (selectedRegistryIds.length === 0) return;
    if (!confirm(`确定要批量删除选中的 ${selectedRegistryIds.length} 个轮播映射吗？`)) return;
    try {
      await fetch('/api/carousel-channels/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedRegistryIds })
      });
      setSelectedRegistryIds([]);
      loadData();
    } catch(e) {
      console.error(e);
    }
  };

  const handleBatchCreateUnregistered = async () => {
    if (selectedUnregIds.length === 0) return;
    const itemsToCreate = unregistered.filter(u => selectedUnregIds.includes(`${u.platform}_${u.originalId}`));
    if (itemsToCreate.length === 0) return;
    
    const payload = itemsToCreate.map(u => ({
      name: u.sampleNames[0] || `${u.platform.toUpperCase()} ${u.originalId}`,
      platform: u.platform,
      originalId: u.originalId
    }));

    try {
      await fetch('/api/carousel-channels/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload })
      });
      setSelectedUnregIds([]);
      setActiveTab("registry");
      loadData();
    } catch(e) {
      console.error(e);
    }
  };

  const handleExportSelectedRegistry = async () => {
    if (selectedRegistryIds.length === 0) return;
    const targetChannels = channels.filter(c => selectedRegistryIds.includes(c.id));
    try {
      const res = await fetch('/api/carousel-proxies');
      const proxies = await res.json();
      const activeProxies = (Array.isArray(proxies) ? proxies : []).filter((p: any) => p.status === 'active');

      let m3uContent = "#EXTM3U\n";
      for (const channel of targetChannels) {
        const matchingProxies = activeProxies.filter((p: any) => p.platform === channel.platform);
        if (matchingProxies.length > 0) {
          for (const proxy of matchingProxies) {
            const streamUrl = proxy.urlTemplate.replace('{}', channel.originalId);
            m3uContent += `#EXTINF:-1 group-title="轮播频道",${channel.name}\n${streamUrl}\n`;
          }
        } else {
          m3uContent += `#EXTINF:-1 group-title="轮播频道",${channel.name}\n# 品牌: ${channel.platform}, ID: ${channel.originalId}\n`;
        }
      }

      const blob = new Blob([m3uContent], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `selected_carousel_channels_${targetChannels.length}个.m3u`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`已成功导出 ${targetChannels.length} 个选中轮播映射！`, "success");
    } catch(e) {
      console.error(e);
      showToast("导出失败", "error");
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const res = await fetch("/api/carousel-channels-apply", { method: "POST", headers: { "Content-Type": "application/json" }});
      const data = await res.json();
      if (data.success) {
        if (data.createdSourcesCount > 0 || data.updatedCount > 0) {
          showToast(data.message || `已成功同步生成 ${data.createdSourcesCount} 个新直播源，归类 ${data.updatedCount} 条线路（累计 ${data.totalSourcesCount} 个有效轮播源，覆盖 ${data.channelsCount} 个频道）！`, "success");
        } else if (data.totalSourcesCount > 0) {
          showToast(data.message || `所有 ${data.channelsCount} 个轮播频道的直播源（共 ${data.totalSourcesCount} 条线路）均已处于最新同步状态。`, "success");
        } else {
          showToast(data.message || `已同步 ${data.registriesCount || channels.length} 个频道映射，但未匹配到启用的轮播代理模板。请前往【轮播代理】配置并启用代理！`, "info");
        }
        loadData();
        fetchData?.();
      } else {
        showToast(data.error || "应用失败", "error");
      }
    } catch(e) {
      console.error(e);
      showToast("请求失败", "error");
    } finally {
      setApplying(false);
    }
  };

  const toggleSelectRegistry = (id: string) => {
    setSelectedRegistryIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAllRegistry = () => {
    if (selectedRegistryIds.length === channels.length) {
      setSelectedRegistryIds([]);
    } else {
      setSelectedRegistryIds(channels.map(c => c.id));
    }
  };

  // Filter and search unregistered items
  const visibleUnregistered = unregistered.filter(u => {
    const key = `${u.platform}_${u.originalId}`;
    const isIgnored = ignoredKeys.includes(key);
    
    // Check ignored mode toggle
    if (showIgnored) {
      if (!isIgnored) return false;
    } else {
      if (isIgnored) return false;
    }

    // Check platform filter
    if (unregPlatformFilter !== "all" && u.platform.toLowerCase() !== unregPlatformFilter.toLowerCase()) {
      return false;
    }

    // Check search query
    if (unregSearchQuery.trim()) {
      const query = unregSearchQuery.toLowerCase().trim();
      const matchPlatform = (u.platform || "").toLowerCase().includes(query);
      const matchId = (u.originalId || "").toLowerCase().includes(query);
      const matchName = (u.sampleNames || []).some((n: string) => n.toLowerCase().includes(query));
      return matchPlatform || matchId || matchName;
    }

    return true;
  });

  const unregPlatforms: string[] = Array.from(new Set(unregistered.map((u: any) => String(u.platform || "")))).filter(Boolean) as string[];

  const toggleSelectUnreg = (key: string) => {
    setSelectedUnregIds(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]);
  };

  const toggleSelectAllUnreg = () => {
    const allVisibleKeys = visibleUnregistered.map(u => `${u.platform}_${u.originalId}`);
    const allSelected = allVisibleKeys.length > 0 && allVisibleKeys.every(k => selectedUnregIds.includes(k));
    if (allSelected) {
      setSelectedUnregIds(prev => prev.filter(k => !allVisibleKeys.includes(k)));
    } else {
      setSelectedUnregIds(prev => Array.from(new Set([...prev, ...allVisibleKeys])));
    }
  };

  const handleDownloadActiveM3u = async () => {
    try {
      const res = await fetch('/api/carousel-proxies');
      const proxies = await res.json();
      const activeProxies = (Array.isArray(proxies) ? proxies : []).filter((p: any) => p.status === 'active');
      
      if (activeProxies.length === 0) {
        return alert("当前没有可用的轮播代理模板，请先到「代理管理」中配置或测活！");
      }

      if (channels.length === 0) {
        return alert("当前没有已配置的轮播频道映射！");
      }

      let m3uContent = "#EXTM3U\n";
      for (const channel of channels) {
        const matchingProxies = activeProxies.filter((p: any) => p.platform === channel.platform);
        for (const proxy of matchingProxies) {
          const streamUrl = proxy.urlTemplate.replace('{}', channel.originalId);
          m3uContent += `#EXTINF:-1 group-title="轮播频道",${channel.name}\n${streamUrl}\n`;
        }
      }

      const blob = new Blob([m3uContent], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `active_carousel_channels_${new Date().getTime()}.m3u`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch(e) {
      console.error(e);
      alert("导出失败，请检查网络");
    }
  };

  // Collect all known platforms from rules, channels, presets
  const knownPlatformValues = Array.from(new Set([
    ...PRESET_CAROUSEL_PLATFORMS.map(p => p.value),
    ...channels.map(c => String(c.platform || "").toLowerCase()),
    ...rules.map(r => String(r.platform || "").toLowerCase()),
    ...unregistered.map(u => String(u.platform || "").toLowerCase())
  ])).filter(Boolean);

  const extraCustomPlatforms = knownPlatformValues.filter(p => !PRESET_CAROUSEL_PLATFORMS.some(pre => pre.value === p));

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-[calc(env(safe-area-inset-top,0px)+5rem)] sm:top-6 left-3 right-3 sm:left-auto sm:right-6 z-[99999] px-4 py-3 rounded-2xl shadow-2xl border text-xs sm:text-sm font-bold flex items-center justify-between gap-3 animate-fade-in sm:max-w-md backdrop-blur-md ${
          toast.type === "success" ? "bg-emerald-50/95 text-emerald-900 border-emerald-200 shadow-emerald-900/10" :
          toast.type === "error" ? "bg-rose-50/95 text-rose-900 border-rose-200 shadow-rose-900/10" :
          "bg-indigo-50/95 text-indigo-900 border-indigo-200 shadow-indigo-900/10"
        }`}>
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {toast.type === "success" ? <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" /> :
             toast.type === "error" ? <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" /> :
             <Info className="w-4 h-4 text-indigo-600 shrink-0" />}
            <span className="leading-snug break-words">{toast.message}</span>
          </div>
          <button onClick={() => setToast(null)} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-black/5 transition shrink-0" title="关闭提示">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in">
            <div className="p-5 border-b border-slate-100 bg-rose-50/50">
              <h3 className="font-bold text-rose-800 text-base">重置特征规则库确认</h3>
              <p className="text-xs text-rose-600 mt-1">此操作将清空当前所有规则，并完整重新装载系统内置的标准特征规则库。</p>
            </div>
            <div className="p-5 text-sm text-slate-600 space-y-2">
              <p>如果您添加过自定义特征规则，重置后需要重新添加。</p>
              <p className="font-bold text-slate-800">确定要继续重置为官方预置规则库吗？</p>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button
                onClick={() => setShowResetConfirmModal(false)}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-bold text-sm hover:bg-slate-300 transition"
              >
                取消
              </button>
              <button
                onClick={() => handleLoadPresetRules('reset')}
                className="px-4 py-2 bg-rose-600 text-white rounded-lg font-bold text-sm hover:bg-rose-700 transition"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-wrap justify-between items-center bg-slate-50 gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-800 flex items-center">
              <LinkIcon className="w-5 h-5 mr-2 text-indigo-500" />
              轮播映射与特征发现
            </h2>
            <p className="text-xs text-slate-500 mt-1">统一管理网络直播间与系统频道的映射，并根据自定义特征规则自动识别提取同类直播源</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
             <button
               onClick={handleDownloadActiveM3u}
               className="px-3.5 py-2 bg-white text-slate-700 border border-slate-200 rounded-lg text-sm font-bold hover:bg-slate-100 flex items-center shadow-sm transition"
               title="将目前已配置且测活通过的轮播源一键导出为 M3U 文件"
             >
               <Download className="w-4 h-4 mr-1.5 text-indigo-600" />
               导出可用 M3U
             </button>
             <button 
               onClick={handleApply}
               disabled={applying}
               className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 flex items-center shadow-sm disabled:opacity-50 transition"
             >
               {applying ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
               {applying ? "正在批量应用..." : "一键应用生成频道源"}
             </button>
          </div>
        </div>

        <div className="px-3 sm:px-5 pt-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex justify-between items-center pb-2">
            <div className="grid grid-cols-3 sm:flex sm:items-center gap-1 bg-slate-200/70 p-1 rounded-xl w-full sm:w-auto">
               <button 
                  onClick={() => setActiveTab("registry")}
                  className={`px-2 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${activeTab === "registry" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
               >
                  <span>映射列表</span>
                  <span className="text-[10px] opacity-75">({channels.length})</span>
               </button>
               <button 
                  onClick={() => setActiveTab("unregistered")}
                  className={`px-2 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${activeTab === "unregistered" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
               >
                  <span>未映射直播源</span>
                  <span className="text-[10px] opacity-75">({unregistered.filter(u => !ignoredKeys.includes(`${u.platform}_${u.originalId}`)).length})</span>
               </button>
               <button 
                  onClick={() => setActiveTab("rules")}
                  className={`px-2 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${activeTab === "rules" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
               >
                  <span>发现规则</span>
                  <span className="text-[10px] opacity-75">({rules.length})</span>
               </button>
            </div>
          </div>
        </div>

        {activeTab === "rules" ? (
          <div className="p-0 animate-fade-in">
             <div className="p-4 bg-indigo-50/50 border-b border-indigo-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-indigo-900 leading-relaxed font-sans flex-1">
                  <span className="font-bold">特征发现机制：</span> 系统下载订阅或解析 M3U 时，会根据以下关键词规则自动捕获对应的第三方网络直播间 URL，将其归类并自动提取为通用轮播映射。规则发生增删改时，系统将自动重新扫描现有全部直播源并提取未映射项。
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button 
                    onClick={handleRescanUnregistered}
                    disabled={isRescanning}
                    className="px-3.5 py-1.5 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-60 border border-indigo-200 rounded-lg font-bold text-xs flex items-center transition shadow-xs whitespace-nowrap"
                    title="根据最新特征发现规则重新扫描现有全部直播源"
                  >
                    {isRescanning ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin text-indigo-600" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />}
                    {isRescanning ? "正在重新扫描..." : "重新扫描现有源"}
                  </button>
                  {rules.some(r => r.platform === 'iptv' || (r.keyword && r.keyword.toLowerCase().includes('iptv'))) && (
                    <button 
                      onClick={handleClearIptvRules}
                      className="px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg font-bold text-xs flex items-center transition whitespace-nowrap"
                      title="清理规则库中残留的 IPTV 规则"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1 text-rose-500" />
                      一键清除 IPTV 规则
                    </button>
                  )}
                  <button 
                    onClick={() => handleLoadPresetRules('seed')}
                    disabled={presetLoading}
                    className="px-3.5 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 rounded-lg font-bold text-xs flex items-center shadow-sm transition whitespace-nowrap"
                    title="自动补全常见已知平台（YY, 斗鱼, 虎牙, B站, 快手, 抖音, 央视, 咪咕等）识别特征"
                  >
                    {presetLoading ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 mr-1.5" />}
                    补全推荐规则
                  </button>
                  <button 
                    onClick={() => setShowResetConfirmModal(true)}
                    disabled={presetLoading}
                    className="px-3 py-1.5 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-60 border border-slate-200 rounded-lg font-bold text-xs transition whitespace-nowrap"
                  >
                    重置默认
                  </button>
                </div>
             </div>

             {/* Search and Filters Bar */}
             <div className="p-3.5 bg-white border-b border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
               <div className="flex flex-wrap items-center gap-3 flex-1">
                 <div className="relative flex-1 min-w-[180px] max-w-xs">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                   <input
                     type="text"
                     value={ruleSearchQuery}
                     onChange={e => setRuleSearchQuery(e.target.value)}
                     placeholder="搜索规则特征 / 关键词..."
                     className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                   />
                 </div>

                 <select
                   value={rulePlatformFilter}
                   onChange={e => setRulePlatformFilter(e.target.value)}
                   className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-bold"
                 >
                   <option value="all">全部平台 ({rules.length})</option>
                   {PRESET_CAROUSEL_PLATFORMS.map(p => {
                     const cnt = rules.filter(r => r.platform === p.value).length;
                     return <option key={p.value} value={p.value}>{p.label} ({cnt})</option>;
                   })}
                   {extraCustomPlatforms.map(p => {
                     const cnt = rules.filter(r => r.platform === p).length;
                     return <option key={p} value={p}>{p.toUpperCase()} ({cnt})</option>;
                   })}
                 </select>
               </div>

               {selectedRuleIds.length > 0 && (
                 <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 shrink-0 animate-fade-in">
                   <span className="text-xs font-bold text-indigo-700">
                     已选 {selectedRuleIds.length} 项
                   </span>
                   <button
                     onClick={handleBatchDeleteRules}
                     className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold transition flex items-center shadow-xs"
                   >
                     <Trash2 className="w-3 h-3 mr-1" />
                     批量删除
                   </button>
                   <button
                     onClick={() => setSelectedRuleIds([])}
                     className="p-1 text-slate-400 hover:text-slate-600 transition"
                     title="取消全选"
                   >
                     <X className="w-3.5 h-3.5" />
                   </button>
                 </div>
               )}
             </div>

             {/* Add Rule Form */}
             <div className="p-4 bg-slate-50/50 border-b border-slate-100">
               <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-1 md:col-span-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">平台标识</label>
                    <select 
                      value={ruleForm.platform} 
                      onChange={e => setRuleForm({...ruleForm, platform: e.target.value})}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-800"
                    >
                      {PRESET_CAROUSEL_PLATFORMS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                      {extraCustomPlatforms.map(p => (
                        <option key={p} value={p}>{p.toUpperCase()} (已存在平台)</option>
                      ))}
                      <option value="custom">+ 自定义平台标识...</option>
                    </select>
                  </div>

                  {ruleForm.platform === "custom" && (
                    <div className="sm:col-span-1 md:col-span-3">
                      <label className="block text-xs font-bold text-slate-500 mb-1">自定义平台代码</label>
                      <input 
                        type="text" 
                        value={customPlatform}
                        onChange={e => setCustomPlatform(e.target.value)}
                        placeholder="例如: zhibo8"
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-800"
                      />
                    </div>
                  )}

                  <div className={ruleForm.platform === "custom" ? "sm:col-span-2 md:col-span-3" : "sm:col-span-1 md:col-span-6"}>
                    <label className="block text-xs font-bold text-slate-500 mb-1">URL 特征关键词 / 正则</label>
                    <input 
                      type="text" 
                      value={ruleForm.keyword}
                      onChange={e => setRuleForm({...ruleForm, keyword: e.target.value})}
                      placeholder="例如: /yy/ 或 regex:\/yy\/[a-zA-Z0-9]+ 或 dy.php"
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>

                  <div className="sm:col-span-2 md:col-span-2 flex">
                    <button 
                      onClick={saveRule}
                      className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center justify-center shadow-sm transition whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4 mr-1.5" />
                      添加发现规则
                    </button>
                  </div>
               </div>
             </div>

             {/* Rules Table */}
             <div className="overflow-x-auto">
               <table className="w-full text-left text-sm min-w-[550px]">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                     <tr>
                        <th className="px-3 py-3 w-10 text-center whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={
                              rules.length > 0 &&
                              rules
                                .filter(r => 
                                  (rulePlatformFilter === "all" || r.platform === rulePlatformFilter) &&
                                  (!ruleSearchQuery || (r.keyword || "").toLowerCase().includes(ruleSearchQuery.toLowerCase()) || (r.platform || "").toLowerCase().includes(ruleSearchQuery.toLowerCase()))
                                )
                                .every(r => selectedRuleIds.includes(r.id))
                            }
                            onChange={(e) => {
                              const filtered = rules.filter(r => 
                                (rulePlatformFilter === "all" || r.platform === rulePlatformFilter) &&
                                (!ruleSearchQuery || (r.keyword || "").toLowerCase().includes(ruleSearchQuery.toLowerCase()) || (r.platform || "").toLowerCase().includes(ruleSearchQuery.toLowerCase()))
                              );
                              if (e.target.checked) {
                                const allFilteredIds = filtered.map(r => r.id);
                                setSelectedRuleIds(Array.from(new Set([...selectedRuleIds, ...allFilteredIds])));
                              } else {
                                const filteredSet = new Set(filtered.map(r => r.id));
                                setSelectedRuleIds(selectedRuleIds.filter(id => !filteredSet.has(id)));
                              }
                            }}
                            className="rounded text-indigo-600 border-slate-300 focus:ring-indigo-500"
                          />
                        </th>
                        <th className="px-3 py-3 w-16 text-center whitespace-nowrap">启用</th>
                        <th className="px-4 py-3 w-36 sm:w-44 whitespace-nowrap">目标平台</th>
                        <th className="px-4 py-3">识别特征 (URL 包含关键词或匹配正则即触发)</th>
                        <th className="px-4 py-3 text-right w-20 whitespace-nowrap">操作</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                     {rules
                       .filter(r => 
                         (rulePlatformFilter === "all" || r.platform === rulePlatformFilter) &&
                         (!ruleSearchQuery || (r.keyword || "").toLowerCase().includes(ruleSearchQuery.toLowerCase()) || (r.platform || "").toLowerCase().includes(ruleSearchQuery.toLowerCase()))
                       )
                       .map(r => {
                          const isEnabled = r.enabled === 1 || r.enabled === true || r.enabled === undefined;
                          const isSelected = selectedRuleIds.includes(r.id);
                          return (
                            <tr key={r.id} className={`hover:bg-slate-50 transition-colors ${!isEnabled ? "opacity-50 bg-slate-50/40" : ""} ${isSelected ? "bg-indigo-50/30" : ""}`}>
                               <td className="px-3 py-3 text-center whitespace-nowrap">
                                 <input
                                   type="checkbox"
                                   checked={isSelected}
                                   onChange={(e) => {
                                     if (e.target.checked) {
                                       setSelectedRuleIds(prev => [...prev, r.id]);
                                     } else {
                                       setSelectedRuleIds(prev => prev.filter(id => id !== r.id));
                                     }
                                   }}
                                   className="rounded text-indigo-600 border-slate-300 focus:ring-indigo-500"
                                 />
                               </td>
                               <td className="px-3 py-3 text-center whitespace-nowrap">
                                 <button
                                   onClick={() => toggleRuleEnabled(r)}
                                   className={`w-8 h-4.5 flex items-center rounded-full p-0.5 transition duration-300 ${
                                     isEnabled ? "bg-indigo-600" : "bg-slate-300"
                                   }`}
                                   title={isEnabled ? "点击停用此规则（不删除）" : "点击启用此规则"}
                                 >
                                   <div
                                     className={`bg-white w-3.5 h-3.5 rounded-full shadow-md transform transition duration-300 ${
                                       isEnabled ? "translate-x-3.5" : "translate-x-0"
                                     }`}
                                   />
                                 </button>
                               </td>
                               <td className="px-4 py-3 whitespace-nowrap">
                                  {getPlatformBadge(r.platform)}
                               </td>
                               <td className="px-4 py-3">
                                  <span className={`font-mono font-bold text-xs sm:text-sm rounded px-2 py-1 my-0.5 border break-all inline-block max-w-full ${
                                    isEnabled 
                                      ? "text-indigo-600 bg-slate-50/70 border-slate-200/80" 
                                      : "text-slate-400 bg-slate-100 border-slate-200 line-through"
                                  }`}>
                                     {r.keyword}
                                  </span>
                               </td>
                               <td className="px-4 py-3 text-right whitespace-nowrap">
                                  <button 
                                    onClick={() => deleteRule(r.id)} 
                                    className="p-1.5 text-slate-400 hover:text-rose-600 transition"
                                    title="删除此条发现规则"
                                  >
                                     <Trash2 className="w-4 h-4" />
                                  </button>
                               </td>
                            </tr>
                          );
                       })}
                     {rules.length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-center py-10 text-slate-400 space-y-3">
                            <div>暂无特征发现规则</div>
                            <button 
                              onClick={() => handleLoadPresetRules('seed')}
                              className="px-4 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-xs font-bold inline-flex items-center transition"
                            >
                              <Wand2 className="w-4 h-4 mr-1.5" />
                              一键预置推荐规则库
                            </button>
                          </td>
                        </tr>
                     )}
                     {rules.length > 0 && rules.filter(r => 
                         (rulePlatformFilter === "all" || r.platform === rulePlatformFilter) &&
                         (!ruleSearchQuery || (r.keyword || "").toLowerCase().includes(ruleSearchQuery.toLowerCase()) || (r.platform || "").toLowerCase().includes(ruleSearchQuery.toLowerCase()))
                       ).length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-slate-400">
                            未找到符合搜索条件的特征规则
                          </td>
                        </tr>
                     )}
                  </tbody>
               </table>
             </div>
          </div>
        ) : activeTab === "registry" ? (
          <div className="p-0 animate-fade-in">
             <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索频道名称、平台、或直播间 ID..."
                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <button 
                  onClick={() => {
                    setEditingId(null);
                    setForm({ name: "", channelId: "", platform: "yy", customPlatform: "", originalId: "" });
                    setIsModalOpen(true);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center justify-center shadow-sm transition whitespace-nowrap"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  添加映射
                </button>
             </div>
             
             {selectedRegistryIds.length > 0 && (
                <div className="bg-indigo-50 border-b border-indigo-100 p-3 px-4 flex flex-wrap justify-between items-center gap-2">
                  <span className="text-sm font-bold text-indigo-700">已选择 {selectedRegistryIds.length} 个映射</span>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleExportSelectedRegistry}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold transition flex items-center shadow-xs cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      导出选中轮播 (.m3u)
                    </button>
                    <button 
                      onClick={handleBatchDeleteRegistry}
                      className="px-3 py-1.5 bg-rose-100 text-rose-600 hover:bg-rose-200 rounded text-xs font-bold transition flex items-center cursor-pointer whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                      批量删除
                    </button>
                  </div>
                </div>
             )}

             {/* Platform Proxy Availability Summary Bar */}
             <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
               <div className="flex items-center gap-1.5 flex-wrap">
                 <span className="font-bold text-slate-600">各平台可用代理数:</span>
                 {Array.from(new Set(channels.map(c => (c.platform || '').toLowerCase()))).filter(Boolean).map(plat => {
                   const activeCount = proxies.filter(p => (p.platform || '').toLowerCase() === plat && p.status === 'active').length;
                   const totalCount = proxies.filter(p => (p.platform || '').toLowerCase() === plat).length;
                   return (
                     <span key={plat} className={`inline-flex items-center px-2 py-0.5 rounded-md font-medium border ${
                       activeCount > 0 ? 'bg-indigo-50/80 text-indigo-700 border-indigo-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                     }`}>
                       <span className="uppercase font-bold mr-1">{plat}</span>:
                       <span className="font-bold ml-1">{activeCount}/{totalCount}</span>
                     </span>
                   );
                 })}
               </div>
               <span className="text-[11px] text-slate-400">
                 各频道生成的直播源数 = 该平台当前启用的代理模板数
               </span>
             </div>
             
             <div className="overflow-x-auto">
               <table className="w-full text-left text-sm min-w-[540px]">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                     <tr>
                        <th className="px-4 py-3 w-10 whitespace-nowrap">
                          <input 
                             type="checkbox" 
                             checked={selectedRegistryIds.length === channels.length && channels.length > 0}
                             onChange={toggleSelectAllRegistry}
                             className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </th>
                        <th className="px-4 py-3">统一频道名</th>
                        <th className="px-4 py-3 whitespace-nowrap">平台</th>
                        <th className="px-4 py-3 whitespace-nowrap">直播间 ID</th>
                        <th className="px-4 py-3 whitespace-nowrap">已生成源</th>
                        <th className="px-4 py-3 text-right whitespace-nowrap">操作</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                     {(Array.isArray(channels) ? channels : [])
                         .filter(p => (p.name || "").toLowerCase().includes(searchQuery.toLowerCase()) || (p.originalId || "").includes(searchQuery) || (p.platform || "").toLowerCase().includes(searchQuery.toLowerCase()))
                         .sort((a, b) => sortKey === "name" ? (a.name || "").localeCompare(b.name || "") : (a.platform || "").localeCompare(b.platform || ""))
                         .map(p => {
                        const plat = (p.platform || '').toLowerCase();
                        const activeProxiesForPlat = proxies.filter(px => (px.platform || '').toLowerCase() === plat && px.status === 'active').length;
                        return (
                        <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${selectedRegistryIds.includes(p.id) ? 'bg-indigo-50/50' : ''}`}>
                           <td className="px-4 py-3 whitespace-nowrap">
                             <input 
                                type="checkbox" 
                                checked={selectedRegistryIds.includes(p.id)}
                                onChange={() => toggleSelectRegistry(p.id)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                             />
                           </td>
                           <td className="px-4 py-3 font-bold text-slate-800 break-words">
                              {p.name}
                           </td>
                           <td className="px-4 py-3 whitespace-nowrap">
                              {getPlatformBadge(p.platform)}
                           </td>
                           <td className="px-4 py-3 text-xs font-mono text-slate-600 font-bold whitespace-nowrap">
                              {p.originalId}
                           </td>
                           <td className="px-4 py-3 whitespace-nowrap">
                             {typeof p.sourceCount === 'number' && p.sourceCount > 0 ? (
                               <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                 <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
                                 {p.sourceCount} 条直播源
                               </span>
                             ) : activeProxiesForPlat > 0 ? (
                               <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                 待生成 ({activeProxiesForPlat} 代理就绪)
                               </span>
                             ) : (
                               <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">
                                 0 条 (该平台暂无可用代理)
                               </span>
                             )}
                           </td>
                           <td className="px-4 py-3 text-right whitespace-nowrap">
                              <button onClick={() => {
                                 setEditingId(p.id);
                                 const isPreset = PRESET_CAROUSEL_PLATFORMS.some(pre => pre.value === p.platform);
                                 setForm({
                                   name: p.name || "",
                                   channelId: p.channelId || "",
                                   platform: isPreset ? p.platform : "custom",
                                   customPlatform: isPreset ? "" : p.platform,
                                   originalId: p.originalId
                                 });
                                 setIsModalOpen(true);
                              }} className="p-1.5 text-slate-400 hover:text-indigo-600 transition">
                                 <Edit2 className="w-4 h-4" />
                              </button>
                              <button onClick={() => deleteChannel(p.id)} className="p-1.5 text-slate-400 hover:text-rose-600 transition ml-2">
                                 <Trash2 className="w-4 h-4" />
                              </button>
                           </td>
                        </tr>
                        );
                     })}
                     {channels.length === 0 && (
                       <tr><td colSpan={6} className="text-center py-8 text-slate-400">暂无映射数据</td></tr>
                     )}
                  </tbody>
               </table>
             </div>
          </div>
        ) : (
          <div className="p-0 animate-fade-in">
             <div className="p-4 bg-amber-50/80 text-amber-800 text-sm font-semibold border-b border-amber-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center">
                    <Search className="w-4 h-4 mr-2 shrink-0 text-amber-600" />
                    <span>在当前直播源中自动发现未配置映射的轮播直播间（已自动忽略已隔离源与频道）。</span>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-200/80 text-amber-900 border border-amber-300/60">
                    已忽略隔离源
                  </span>
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleRescanUnregistered}
                    disabled={isRescanning}
                    className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition flex items-center shadow-xs whitespace-nowrap"
                    title="从现有全部直播源中根据最新特征发现规则重新扫描提取未映射直播源"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRescanning ? 'animate-spin' : ''}`} />
                    {isRescanning ? "正在重新扫描直播源..." : "重新发现未映射源"}
                  </button>

                  <button
                    onClick={() => {
                      setShowIgnored(!showIgnored);
                      setSelectedUnregIds([]);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center border ${
                      showIgnored 
                        ? 'bg-amber-600 text-white border-amber-700 shadow-sm' 
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {showIgnored ? <Eye className="w-3.5 h-3.5 mr-1.5" /> : <EyeOff className="w-3.5 h-3.5 mr-1.5" />}
                    {showIgnored ? '返回正常列表' : `查看已忽略 (${ignoredKeys.length})`}
                  </button>

                  {showIgnored && ignoredKeys.length > 0 && (
                    <button
                      onClick={clearAllIgnored}
                      className="px-3 py-1.5 bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 rounded-lg text-xs font-bold transition flex items-center"
                      title="清空并恢复所有已被忽略的未识别源"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                      恢复全部忽略
                    </button>
                  )}
                </div>
             </div>

             <div className="p-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
               <div className="flex flex-wrap items-center gap-2 flex-1 max-w-xl">
                 <div className="relative flex-1 min-w-[200px]">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                   <input
                     type="text"
                     value={unregSearchQuery}
                     onChange={e => setUnregSearchQuery(e.target.value)}
                     placeholder="搜索平台、直播间 ID 或频道名..."
                     className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                   />
                   {unregSearchQuery && (
                     <button
                       onClick={() => setUnregSearchQuery("")}
                       className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                     >
                       <X className="w-3.5 h-3.5" />
                     </button>
                   )}
                 </div>

                 <div className="flex items-center gap-1.5">
                   <Filter className="w-3.5 h-3.5 text-slate-400" />
                   <select
                     value={unregPlatformFilter}
                     onChange={e => setUnregPlatformFilter(e.target.value)}
                     className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-bold focus:outline-none focus:border-indigo-500"
                   >
                     <option value="all">全部平台</option>
                     {unregPlatforms.map(p => {
                       const info = getPlatformInfo(p);
                       return (
                         <option key={p} value={p}>{info.label}</option>
                       );
                     })}
                   </select>
                 </div>
               </div>

               <div className="text-xs text-slate-500 font-bold">
                 显示 {visibleUnregistered.length} / 共 {unregistered.length} 项
               </div>
             </div>

             {selectedUnregIds.length > 0 && (
               <div className="bg-indigo-50 border-b border-indigo-100 p-3 px-4 flex flex-wrap justify-between items-center gap-2">
                 <span className="text-xs font-bold text-indigo-700">已选择 {selectedUnregIds.length} 个未识别项</span>
                 <div className="flex items-center gap-2">
                   {!showIgnored && (
                     <button 
                       onClick={handleBatchCreateUnregistered}
                       className="px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-xs font-bold transition flex items-center shadow-sm whitespace-nowrap"
                     >
                       <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
                       一键批量注册 (使用首个常用名)
                     </button>
                   )}
                   <button 
                     onClick={() => batchIgnoreUnregistered(selectedUnregIds)}
                     className="px-3 py-1.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded text-xs font-bold transition flex items-center whitespace-nowrap"
                   >
                     {showIgnored ? <Eye className="w-3.5 h-3.5 mr-1.5" /> : <EyeOff className="w-3.5 h-3.5 mr-1.5" />}
                     {showIgnored ? '批量取消忽略' : '批量移入忽略'}
                   </button>
                 </div>
               </div>
             )}
             
             <div className="overflow-x-auto">
               <table className="w-full text-left text-sm min-w-[580px]">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                     <tr>
                        <th className="px-4 py-3 w-10 whitespace-nowrap">
                          <input 
                             type="checkbox" 
                             checked={visibleUnregistered.length > 0 && visibleUnregistered.every(u => selectedUnregIds.includes(`${u.platform}_${u.originalId}`))}
                             onChange={toggleSelectAllUnreg}
                             className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </th>
                        <th className="px-4 py-3 w-1/5 whitespace-nowrap">平台 & ID</th>
                        <th className="px-4 py-3">当前检测到的凌乱频道名</th>
                        <th className="px-4 py-3 text-right whitespace-nowrap">操作</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                     {visibleUnregistered.map((item) => {
                        const key = `${item.platform}_${item.originalId}`;
                        const isSelected = selectedUnregIds.includes(key);
                        const isIgnored = ignoredKeys.includes(key);
                        return (
                        <tr key={key} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                           <td className="px-4 py-3 whitespace-nowrap">
                             <input 
                                type="checkbox" 
                                checked={isSelected}
                                onChange={() => toggleSelectUnreg(key)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                             />
                           </td>
                           <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex flex-col gap-1 items-start">
                                {getPlatformBadge(item.platform)}
                                <span className="text-xs font-mono font-bold text-slate-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                                  {item.originalId}
                                </span>
                              </div>
                           </td>
                           <td className="px-4 py-3 text-slate-600">
                              <div className="flex flex-wrap gap-1 max-w-sm">
                                {item.sampleNames.map((n: string, idx: number) => (
                                  <span key={idx} className="bg-slate-100 px-2 py-0.5 rounded text-xs break-all">
                                    {n}
                                  </span>
                                ))}
                              </div>
                           </td>
                           <td className="px-4 py-3 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                <button 
                                   onClick={() => {
                                      setActiveTab("registry");
                                      const isPreset = PRESET_CAROUSEL_PLATFORMS.some(pre => pre.value === item.platform);
                                      setForm({
                                        name: item.sampleNames[0] || "",
                                        channelId: "",
                                        platform: isPreset ? item.platform : "custom",
                                        customPlatform: isPreset ? "" : item.platform,
                                        originalId: item.originalId
                                      });
                                      setIsModalOpen(true);
                                   }}
                                   className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded text-xs font-bold hover:bg-indigo-100 transition whitespace-nowrap"
                                >
                                   独立编辑映射
                                </button>
                                <button
                                   onClick={() => toggleIgnoreUnregistered(key)}
                                   className={`p-1.5 rounded transition ${isIgnored ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                                   title={isIgnored ? "取消忽略此项" : "忽略此项 (不再在未识别列表中显示)"}
                                >
                                   {isIgnored ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                </button>
                              </div>
                           </td>
                        </tr>
                     )})}
                     {visibleUnregistered.length === 0 && (
                       <tr>
                         <td colSpan={4} className="text-center py-10 text-slate-400 space-y-2">
                           <p className="font-bold text-sm">
                             {showIgnored 
                               ? "当前忽略名单中没有匹配的未识别源" 
                               : (unregSearchQuery || unregPlatformFilter !== "all") 
                                 ? "没有找到符合搜索条件的未识别源" 
                                 : "目前没有未识别的杂乱轮播源"}
                           </p>
                           {(unregSearchQuery || unregPlatformFilter !== "all") && (
                             <button
                               onClick={() => { setUnregSearchQuery(""); setUnregPlatformFilter("all"); }}
                               className="text-xs text-indigo-600 font-bold hover:underline"
                             >
                               重置筛选条件
                             </button>
                           )}
                         </td>
                       </tr>
                     )}
                  </tbody>
               </table>
             </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
               <h3 className="font-bold text-slate-800">{editingId ? "编辑映射" : "添加映射"}</h3>
               <button 
                 onClick={() => {
                   setIsModalOpen(false);
                   setEditingId(null);
                   setForm({ name: "", channelId: "", platform: "yy", customPlatform: "", originalId: "" });
                 }} 
                 className="text-slate-400 hover:text-slate-600 transition"
               >
                 <X className="w-5 h-5" />
               </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">统一频道名称</label>
                <input 
                  type="text" 
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  placeholder="输入新名称，或选择已有频道"
                  list="channel-suggestions"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <datalist id="channel-suggestions">
                  {channelsData?.map(c => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">所属平台</label>
                <select 
                  value={form.platform} 
                  onChange={e => setForm({...form, platform: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-800 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  {PRESET_CAROUSEL_PLATFORMS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                  {extraCustomPlatforms.map(p => (
                    <option key={p} value={p}>{p.toUpperCase()} (已存在平台)</option>
                  ))}
                  <option value="custom">+ 自定义平台标识...</option>
                </select>
              </div>

              {form.platform === "custom" && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">自定义平台代码</label>
                  <input 
                    type="text" 
                    value={form.customPlatform}
                    onChange={e => setForm({...form, customPlatform: e.target.value})}
                    placeholder="例如: zhibo8"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono font-bold focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">直播间 ID</label>
                <input 
                  type="text" 
                  value={form.originalId}
                  onChange={e => setForm({...form, originalId: e.target.value})}
                  placeholder="例如: 12345, 9999, cctv1, lpl"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
               <button 
                 onClick={() => {
                   setIsModalOpen(false);
                   setEditingId(null);
                   setForm({ name: "", channelId: "", platform: "yy", customPlatform: "", originalId: "" });
                 }} 
                 className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-bold text-sm hover:bg-slate-300 transition"
               >
                 取消
               </button>
               <button 
                 onClick={saveChannel}
                 className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center transition"
               >
                 <Save className="w-4 h-4 mr-1.5" />
                 保存
               </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
