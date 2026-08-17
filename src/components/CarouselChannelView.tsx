import React, { useState, useEffect } from "react";
import { Plus, Trash2, Edit2, Search, Link as LinkIcon, Save, RefreshCw, Wand2, CheckSquare, X , Download, Eye, EyeOff, Filter, RotateCcw } from "lucide-react";
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
  const [applying, setApplying] = useState(false);
  const [presetLoading, setPresetLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);

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
    showToast(`已将 ${keysToIgnore.length} 个未识别项移入忽略列表`, "info");
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
        showToast(data.message || "成功加载预置特征发现规则！", "success");
        if (Array.isArray(data.rules)) {
          setRules(data.rules);
        } else {
          loadRulesOnly();
        }
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
  const [selectedUnregIds, setSelectedUnregIds] = useState<string[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
        const [res1, res2, res3] = await Promise.all([
          fetch("/api/carousel-channels"),
          fetch("/api/carousel-channels-unregistered"),
          fetch("/api/carousel-discovery-rules")
        ]);
        const d1 = await res1.json();
        const d2 = await res2.json();
        const d3 = await res3.json();
        setChannels(Array.isArray(d1) ? d1 : []);
        setUnregistered(Array.isArray(d2) ? d2 : []);
        setRules(Array.isArray(d3) ? d3 : []);
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
        showToast("咪咕 (migu) 频道的直播间 ID 须为 8~10 位纯数字（如 631780532）。cctv1 等字符属于 CNTV (央视) 平台。", "error");
        return;
      }
    }

    const existing = channelsData?.find(c => c.name === form.name);
    const payload = {
      name: form.name.trim(),
      platform: platformToSave,
      originalId: originalIdToSave,
      channelId: existing ? existing.id : ""
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
      await fetch("/api/carousel-discovery-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: finalPlatform, keyword: ruleForm.keyword.trim() })
      });
      setRuleForm({ platform: "yy", keyword: "" });
      setCustomPlatform("");
      showToast("已成功保存规则：" + ruleForm.keyword.trim());
      loadRulesOnly();
    } catch (e) {
      console.error(e);
      showToast("保存规则失败", "error");
    }
  };

  const deleteRule = async (id: string) => {
    try {
      await fetch(`/api/carousel-discovery-rules/${id}`, { method: "DELETE" });
      loadRulesOnly();
    } catch (e) {
      console.error(e);
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
        showToast(`已成功同步生成 ${data.createdSourcesCount || 0} 个轮播频道直播源！`, "success");
        fetchData();
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
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm font-bold flex items-center gap-2 animate-fade-in ${
          toast.type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200" :
          toast.type === "error" ? "bg-rose-50 text-rose-800 border-rose-200" :
          "bg-indigo-50 text-indigo-800 border-indigo-200"
        }`}>
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70">
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

        <div className="px-5 pt-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex justify-between items-center">
            <div className="flex space-x-1 bg-slate-200/60 p-1 rounded-lg">
               <button 
                  onClick={() => setActiveTab("registry")}
                  className={`px-4 py-1.5 rounded-md text-sm font-bold transition ${activeTab === "registry" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
               >
                  映射列表 ({channels.length})
               </button>
               <button 
                  onClick={() => setActiveTab("unregistered")}
                  className={`px-4 py-1.5 rounded-md text-sm font-bold transition ${activeTab === "unregistered" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
               >
                  未识别项发现 ({unregistered.filter(u => !ignoredKeys.includes(`${u.platform}_${u.originalId}`)).length})
               </button>
               <button 
                  onClick={() => setActiveTab("rules")}
                  className={`px-4 py-1.5 rounded-md text-sm font-bold transition ${activeTab === "rules" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
               >
                  特征发现规则 ({rules.length})
               </button>
            </div>
          </div>
        </div>

        {activeTab === "rules" ? (
          <div className="p-0 animate-fade-in">
             <div className="p-4 bg-indigo-50/50 border-b border-indigo-100 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-indigo-900 leading-relaxed font-sans">
                  <span className="font-bold">特征发现机制：</span> 系统下载订阅或解析 M3U 时，会根据以下关键词规则自动捕获对应的第三方或网络直播间 URL，将其归类并自动提取为通用轮播映射。
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleLoadPresetRules('seed')}
                    disabled={presetLoading}
                    className="px-3.5 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 rounded-lg font-bold text-xs flex items-center shadow-sm transition"
                    title="自动补全常见已知平台（YY, 斗鱼, 虎牙, B站, 快手, 抖音, 央视, 咪咕, IPTV等）识别特征"
                  >
                    {presetLoading ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 mr-1.5" />}
                    预置已知规则库
                  </button>
                  <button 
                    onClick={() => setShowResetConfirmModal(true)}
                    disabled={presetLoading}
                    className="px-3 py-1.5 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-60 border border-slate-200 rounded-lg font-bold text-xs transition"
                  >
                    重置默认
                  </button>
                </div>
             </div>

             <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-end gap-3">
                <div className="w-56">
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
                  <div className="w-40">
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

                <div className="w-72">
                  <label className="block text-xs font-bold text-slate-500 mb-1">URL 特征关键词 / 正则</label>
                  <input 
                    type="text" 
                    value={ruleForm.keyword}
                    onChange={e => setRuleForm({...ruleForm, keyword: e.target.value})}
                    placeholder="例如: /608 或 :\d+/\d{9} 或 dy.php"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <button 
                  onClick={saveRule}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center shadow-sm transition"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  添加发现规则
                </button>
             </div>

             <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                   <tr>
                      <th className="px-4 py-3 w-48">目标平台</th>
                      <th className="px-4 py-3">识别特征 (URL 包含该关键词即触发)</th>
                      <th className="px-4 py-3 text-right">操作</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   {rules.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                         <td className="px-4 py-3">
                            {getPlatformBadge(r.platform)}
                         </td>
                         <td className="px-4 py-3 font-mono font-bold text-indigo-600 bg-slate-50/50 inline-block rounded px-2 py-0.5 my-1 border border-slate-100">
                            {r.keyword}
                         </td>
                         <td className="px-4 py-3 text-right">
                            <button 
                              onClick={() => deleteRule(r.id)} 
                              className="p-1.5 text-slate-400 hover:text-rose-600 transition"
                              title="删除此条发现规则"
                            >
                               <Trash2 className="w-4 h-4" />
                            </button>
                         </td>
                      </tr>
                   ))}
                   {rules.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center py-10 text-slate-400 space-y-3">
                          <div>暂无特征发现规则</div>
                          <button 
                            onClick={() => handleLoadPresetRules('seed')}
                            className="px-4 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-xs font-bold inline-flex items-center transition"
                          >
                            <Wand2 className="w-4 h-4 mr-1.5" />
                            一键预置常见已知规则库
                          </button>
                        </td>
                      </tr>
                   )}
                </tbody>
             </table>
          </div>
        ) : activeTab === "registry" ? (
          <div className="p-0 animate-fade-in">
             <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between gap-3">
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
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center shadow-sm transition"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  添加映射
                </button>
             </div>
             
             {selectedRegistryIds.length > 0 && (
                <div className="bg-indigo-50 border-b border-indigo-100 p-3 px-4 flex justify-between items-center gap-2">
                  <span className="text-sm font-bold text-indigo-700">已选择 {selectedRegistryIds.length} 个映射</span>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleExportSelectedRegistry}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold transition flex items-center shadow-xs cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      导出选中轮播 (.m3u)
                    </button>
                    <button 
                      onClick={handleBatchDeleteRegistry}
                      className="px-3 py-1.5 bg-rose-100 text-rose-600 hover:bg-rose-200 rounded text-xs font-bold transition flex items-center cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                      批量删除
                    </button>
                  </div>
                </div>
             )}
             
             <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                   <tr>
                      <th className="px-4 py-3 w-10">
                        <input 
                           type="checkbox" 
                           checked={selectedRegistryIds.length === channels.length && channels.length > 0}
                           onChange={toggleSelectAllRegistry}
                           className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="px-4 py-3">统一频道名</th>
                      <th className="px-4 py-3">平台</th>
                      <th className="px-4 py-3">直播间 ID</th>
                      <th className="px-4 py-3 text-right">操作</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   {(Array.isArray(channels) ? channels : [])
                       .filter(p => (p.name || "").toLowerCase().includes(searchQuery.toLowerCase()) || (p.originalId || "").includes(searchQuery) || (p.platform || "").toLowerCase().includes(searchQuery.toLowerCase()))
                       .sort((a, b) => sortKey === "name" ? (a.name || "").localeCompare(b.name || "") : (a.platform || "").localeCompare(b.platform || ""))
                       .map(p => (
                      <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${selectedRegistryIds.includes(p.id) ? 'bg-indigo-50/50' : ''}`}>
                         <td className="px-4 py-3">
                           <input 
                              type="checkbox" 
                              checked={selectedRegistryIds.includes(p.id)}
                              onChange={() => toggleSelectRegistry(p.id)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                           />
                         </td>
                         <td className="px-4 py-3 font-bold text-slate-800">
                            {p.name}
                         </td>
                         <td className="px-4 py-3">
                            {getPlatformBadge(p.platform)}
                         </td>
                         <td className="px-4 py-3 text-xs font-mono text-slate-600 font-bold">
                            {p.originalId}
                         </td>
                         <td className="px-4 py-3 text-right">
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
                   ))}
                   {channels.length === 0 && (
                     <tr><td colSpan={5} className="text-center py-8 text-slate-400">暂无映射数据</td></tr>
                   )}
                </tbody>
             </table>
          </div>
        ) : (
          <div className="p-0 animate-fade-in">
             <div className="p-4 bg-amber-50/80 text-amber-800 text-sm font-semibold border-b border-amber-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center">
                  <Search className="w-4 h-4 mr-2 shrink-0 text-amber-600" />
                  <span>我们在你当前导入的直播源中，发现以下未配置映射的轮播直播间。你能为它们建立统一映射。</span>
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
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
                       className="px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-xs font-bold transition flex items-center shadow-sm"
                     >
                       <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
                       一键批量注册 (使用首个常用名)
                     </button>
                   )}
                   <button 
                     onClick={() => batchIgnoreUnregistered(selectedUnregIds)}
                     className="px-3 py-1.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded text-xs font-bold transition flex items-center"
                   >
                     {showIgnored ? <Eye className="w-3.5 h-3.5 mr-1.5" /> : <EyeOff className="w-3.5 h-3.5 mr-1.5" />}
                     {showIgnored ? '批量取消忽略' : '批量移入忽略'}
                   </button>
                 </div>
               </div>
             )}
             
             <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                   <tr>
                      <th className="px-4 py-3 w-10">
                        <input 
                           type="checkbox" 
                           checked={visibleUnregistered.length > 0 && visibleUnregistered.every(u => selectedUnregIds.includes(`${u.platform}_${u.originalId}`))}
                           onChange={toggleSelectAllUnreg}
                           className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="px-4 py-3 w-1/5">平台 & ID</th>
                      <th className="px-4 py-3">当前检测到的凌乱频道名</th>
                      <th className="px-4 py-3 text-right">操作</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   {visibleUnregistered.map((item) => {
                      const key = `${item.platform}_${item.originalId}`;
                      const isSelected = selectedUnregIds.includes(key);
                      const isIgnored = ignoredKeys.includes(key);
                      return (
                      <tr key={key} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                         <td className="px-4 py-3">
                           <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={() => toggleSelectUnreg(key)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                           />
                         </td>
                         <td className="px-4 py-3">
                            <div className="flex flex-col gap-1 items-start">
                              {getPlatformBadge(item.platform)}
                              <span className="text-xs font-mono font-bold text-slate-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                                {item.originalId}
                              </span>
                            </div>
                         </td>
                         <td className="px-4 py-3 text-slate-600">
                            <div className="flex flex-wrap gap-1">
                              {item.sampleNames.map((n: string, idx: number) => (
                                <span key={idx} className="bg-slate-100 px-2 py-0.5 rounded text-xs">
                                  {n}
                                </span>
                              ))}
                            </div>
                         </td>
                         <td className="px-4 py-3 text-right">
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
                                 className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded text-xs font-bold hover:bg-indigo-100 transition"
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
