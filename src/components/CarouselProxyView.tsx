import React, { useState, useEffect, useRef } from "react";
import { 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  AlertCircle, 
  RefreshCw, 
  X, 
  PlayCircle, 
  Settings, 
  Search,
  ShieldAlert,
  ShieldCheck,
  Ban,
  Layers,
  SlidersHorizontal,
  FileText,
  CheckCircle2,
  HelpCircle,
  Sparkles,
  Eye,
  EyeOff,
  Filter,
  AlertTriangle,
  Info,
  Play,
  Loader2,
  Power,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Wrench
} from "lucide-react";
import { authFetch as fetch } from "../utils/api";
import { PRESET_CAROUSEL_PLATFORMS, getPlatformBadge } from "../utils/carouselPlatforms";

export interface CarouselDisabledRule {
  id: string;
  pattern: string;
  type: "contains" | "domain" | "prefix" | "regex";
  platform: string;
  description: string;
  enabled: number | boolean;
  createdAt?: string;
}

export const DEFAULT_CAROUSEL_PRESETS: Record<string, { name: string; id: string }[]> = {
  "yy": [
    { name: "开心麻花", id: "54880976" },
    { name: "YY 官方", id: "12345" },
    { name: "YY 舞蹈", id: "76" }
  ],
  "douyu": [
    { name: "开心麻花经典小品", id: "10153463" },
    { name: "贾玲经典小品", id: "10419541" },
    { name: "龙视开心麻花街", id: "9374862" },
    { name: "英雄联盟", id: "9999" },
    { name: "Dota2", id: "1126960" }
  ],
  "huya": [
    { name: "虎牙放映厅", id: "11602077" },
    { name: "战争电影放映厅", id: "21059618" },
    { name: "悬疑放映厅", id: "26355797" },
    { name: "LPL赛事", id: "lpl" },
    { name: "楚河", id: "116361" }
  ],
  "bilibili": [
    { name: "逍遥散人", id: "1129" },
    { name: "官方赛事", id: "6" }
  ],
  "kuaishou": [
    { name: "王者荣耀", id: "kpl" },
    { name: "快手精选", id: "3x876g5g6f7" }
  ],
  "douyin": [
    { name: "抖音直播精选", id: "123456" }
  ],
  "cntv": [
    { name: "CCTV-1 综合", id: "cctv1" },
    { name: "CCTV-5 体育", id: "cctv5" }
  ],
  "migu": [
    { name: "咪咕赛事", id: "608807420" }
  ],
  "iptv": [
    { name: "IPTV 直播", id: "live" }
  ]
};

export const CarouselProxyView = ({ fetchData }: { fetchData: () => void }) => {
  const [activeTab, setActiveTab] = useState<"proxies" | "disabledRules" | "test">("proxies");
  const [proxies, setProxies] = useState<any[]>([]);
  const [disabledRules, setDisabledRules] = useState<CarouselDisabledRule[]>([]);
  const [discoveryRules, setDiscoveryRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [hideBlocked, setHideBlocked] = useState(true);
  
  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3800);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // In-app Confirmation Modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const triggerConfirm = (options: {
    title: string;
    message: string;
    confirmText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  }) => {
    setConfirmModal({
      isOpen: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText || "确认",
      isDanger: options.isDanger ?? true,
      onConfirm: () => {
        setConfirmModal(null);
        options.onConfirm();
      }
    });
  };

  // Proxy management state
  const [editingProxyId, setEditingProxyId] = useState<string | null>(null);
  const [proxyForm, setProxyForm] = useState({ platform: "yy", customPlatform: "", urlTemplate: "", status: "active" });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlatformFilter, setSelectedPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "blocked">("all");
  const [sortKey, setSortKey] = useState<"platform" | "urlTemplate">("platform");
  const [testing, setTesting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [selectedProxyIds, setSelectedProxyIds] = useState<string[]>([]);
  const [singleProxyTestingId, setSingleProxyTestingId] = useState<string | null>(null);
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  const [isToolsDropdownOpen, setIsToolsDropdownOpen] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const toolsDropdownRef = useRef<HTMLDivElement>(null);

  // Close tools dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolsDropdownRef.current && !toolsDropdownRef.current.contains(event.target as Node)) {
        setIsToolsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Disabled rule management state
  const [rulesSearchQuery, setRulesSearchQuery] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<{
    pattern: string;
    type: "contains" | "domain" | "prefix" | "regex";
    platform: string;
    customPlatform: string;
    description: string;
    enabled: boolean;
  }>({
    pattern: "",
    type: "contains",
    platform: "",
    customPlatform: "",
    description: "",
    enabled: true
  });
  const [isBatchRuleModalOpen, setIsBatchRuleModalOpen] = useState(false);
  const [batchRuleForm, setBatchRuleForm] = useState({
    lines: "",
    type: "contains" as "contains" | "domain" | "prefix" | "regex",
    platform: "",
    description: ""
  });

  // URL test simulator state
  const [testUrlInput, setTestUrlInput] = useState("");
  const [urlMatchResult, setUrlMatchResult] = useState<{ matched: boolean; rule?: CarouselDisabledRule } | null>(null);

  // Test mode state
  const [testForm, setTestForm] = useState({ platform: "yy", customPlatform: "", originalId: "" });
  const [testResults, setTestResults] = useState<any[]>([]);
  const [presets, setPresets] = useState<any>({});
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetForm, setPresetForm] = useState("");

  useEffect(() => {
    loadData();
    loadDisabledRules();
    loadDiscoveryRules();
    fetchSettings();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/carousel-proxies");
      const data = await res.json();
      setProxies(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setProxies([]);
    } finally {
      setLoading(false);
    }
  };

  const loadDisabledRules = async () => {
    try {
      setRulesLoading(true);
      const res = await fetch("/api/carousel-disabled-rules");
      const data = await res.json();
      setDisabledRules(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setDisabledRules([]);
    } finally {
      setRulesLoading(false);
    }
  };

  const loadDiscoveryRules = async () => {
    try {
      const res = await fetch("/api/carousel-discovery-rules");
      const data = await res.json();
      setDiscoveryRules(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setDiscoveryRules([]);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data && data.carouselProxyPresets && Object.keys(data.carouselProxyPresets).length > 0) {
        setPresets(data.carouselProxyPresets);
      } else {
        setPresets(DEFAULT_CAROUSEL_PRESETS);
      }
    } catch (e) {
      console.error(e);
      setPresets(DEFAULT_CAROUSEL_PRESETS);
    }
  };

  const savePresets = async (customConfig?: any) => {
    try {
      const targetConfig = customConfig || JSON.parse(presetForm);
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carouselProxyPresets: targetConfig })
      });
      const data = await res.json();
      if (data.carouselProxyPresets) {
        setPresets(data.carouselProxyPresets);
      } else {
        setPresets(targetConfig);
      }
      setIsPresetModalOpen(false);
      showToast("代理测活预设配置已保存", "success");
    } catch (e: any) {
      showToast("JSON 格式错误，请检查！\n" + (e?.message || ""), "error");
    }
  };

  const resetPresetsToDefault = () => {
    setPresetForm(JSON.stringify(DEFAULT_CAROUSEL_PRESETS, null, 2));
    savePresets(DEFAULT_CAROUSEL_PRESETS);
  };

  // --- Proxy CRUD ---
  const effectiveProxyFormPlatform = proxyForm.platform === "custom" 
    ? (proxyForm.customPlatform.trim().toLowerCase() || "custom") 
    : proxyForm.platform;

  const saveProxy = async () => {
    if (!proxyForm.urlTemplate) return showToast("请输入代理模板 URL", "error");
    if (!effectiveProxyFormPlatform) return showToast("请选择或输入平台代码", "error");
    try {
      const payload = {
        platform: effectiveProxyFormPlatform,
        urlTemplate: proxyForm.urlTemplate.trim(),
        status: proxyForm.status
      };
      if (editingProxyId) {
        await fetch(`/api/carousel-proxies/${editingProxyId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        showToast("代理模板已更新", "success");
      } else {
        await fetch("/api/carousel-proxies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        showToast("代理模板已添加", "success");
      }
      setEditingProxyId(null);
      setProxyForm({ platform: "yy", customPlatform: "", urlTemplate: "", status: "active" });
      loadData();
    } catch (e: any) {
      console.error(e);
      showToast("保存失败: " + (e?.message || "网络错误"), "error");
    }
  };

  const toggleProxyStatus = async (proxy: any, force = false) => {
    if (proxy.status === 'active') {
      // Disabling proxy
      try {
        setSingleProxyTestingId(proxy.id);
        const res = await fetch(`/api/carousel-proxies/${proxy.id}/toggle-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'inactive' })
        });
        const data = await res.json();
        if (data.success) {
          showToast("代理已禁用，已从直播源列表中移除对应频道的播放源", "info");
          loadData();
          fetchData();
        } else {
          showToast(data.error || "禁用失败", "error");
        }
      } catch (e: any) {
        showToast("禁用请求失败: " + (e?.message || "网络错误"), "error");
      } finally {
        setSingleProxyTestingId(null);
      }
    } else {
      // Enabling / Restoring proxy
      try {
        setSingleProxyTestingId(proxy.id);
        const res = await fetch(`/api/carousel-proxies/${proxy.id}/toggle-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active', test: !force })
        });
        const data = await res.json();
        if (data.success && data.available) {
          showToast(`代理测试可用 (${data.latency || 0}ms)，已恢复启用并添加对应直播源`, "success");
          loadData();
          fetchData();
        } else if (!data.available) {
          showToast(`恢复失败: ${data.error || "代理连接测试不可用，未添加直播源"}`, "error");
          loadData();
        } else {
          showToast(data.message || "代理已启用", "success");
          loadData();
          fetchData();
        }
      } catch (e: any) {
        showToast("恢复测试请求失败: " + (e?.message || "网络错误"), "error");
      } finally {
        setSingleProxyTestingId(null);
      }
    }
  };

  const testSingleProxy = async (proxy: any) => {
    setSingleProxyTestingId(proxy.id);
    try {
      const res = await fetch(`/api/carousel-proxies/${proxy.id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.success && data.available) {
        showToast(`代理测试正常 (${data.latency}ms)，已设为可用并同步直播源`, "success");
      } else {
        showToast(`代理测试不可用: ${data.error || "连接失败"}，已设为禁用并移除直播源`, "error");
      }
      loadData();
      fetchData();
    } catch (e: any) {
      showToast("测试请求失败: " + (e?.message || "网络错误"), "error");
    } finally {
      setSingleProxyTestingId(null);
    }
  };

  const batchDisableProxies = () => {
    if (selectedProxyIds.length === 0) return;
    const count = selectedProxyIds.length;
    const toDisableIds = [...selectedProxyIds];
    triggerConfirm({
      title: "批量禁用代理模板",
      message: `确定批量禁用选中的 ${count} 个代理模板吗？禁用后系统将自动从对应频道中移除这些代理生成的直播源，后续可随时一键测活恢复。`,
      confirmText: `确认禁用 (${count})`,
      isDanger: false,
      onConfirm: async () => {
        setBatchActionLoading(true);
        try {
          const res = await fetch("/api/carousel-proxies/batch-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: toDisableIds, status: "inactive" })
          });
          const data = await res.json();
          if (data.success) {
            showToast(data.message || `已批量禁用 ${count} 个代理，对应直播源已移除`, "info");
            setSelectedProxyIds([]);
            loadData();
            fetchData();
          } else {
            showToast(data.error || "批量禁用失败", "error");
          }
        } catch (e: any) {
          showToast("批量禁用请求失败: " + (e?.message || "网络错误"), "error");
        } finally {
          setBatchActionLoading(false);
        }
      }
    });
  };

  const batchRestoreProxies = async (force = false) => {
    if (selectedProxyIds.length === 0) return;
    const count = selectedProxyIds.length;
    const toRestoreIds = [...selectedProxyIds];
    setBatchActionLoading(true);
    showToast(`正在批量测活恢复选中的 ${count} 个代理模板...`, "info");
    try {
      const res = await fetch("/api/carousel-proxies/batch-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: toRestoreIds, status: "active", test: !force })
      });
      const data = await res.json();
      if (data.success) {
        if (data.activatedCount > 0) {
          showToast(data.message || `已恢复 ${data.activatedCount} 个可用代理并同步添加直播源`, "success");
        } else {
          showToast(data.message || `选中的代理测试均不可用，未恢复直播源`, "error");
        }
        setSelectedProxyIds([]);
        loadData();
        fetchData();
      } else {
        showToast(data.error || "批量恢复失败", "error");
      }
    } catch (e: any) {
      showToast("批量恢复请求失败: " + (e?.message || "网络错误"), "error");
    } finally {
      setBatchActionLoading(false);
    }
  };

  const deleteProxy = (id: string) => {
    triggerConfirm({
      title: "删除代理模板",
      message: "确定删除该代理模板吗？删除后该模板将加入永久排除名单，且对应频道中的直播源将被彻底移除，系统不会再自动扫描重新添加此模板。",
      confirmText: "确认删除",
      isDanger: true,
      onConfirm: async () => {
        // Optimistic UI update
        setProxies(prev => prev.filter(p => p.id !== id));
        setSelectedProxyIds(prev => prev.filter(pid => pid !== id));
        try {
          const res = await fetch(`/api/carousel-proxies/${id}`, { method: "DELETE" });
          const data = await res.json();
          if (!res.ok || data.error) {
            showToast("删除失败: " + (data.error || "未知错误"), "error");
            loadData();
          } else {
            showToast("代理模板已删除，对应直播源已移除并加入排除名单", "success");
            loadData();
            fetchData();
          }
        } catch (e: any) {
          console.error(e);
          showToast("删除请求失败: " + (e?.message || "网络错误"), "error");
          loadData();
        }
      }
    });
  };

  const batchDeleteProxies = () => {
    if (selectedProxyIds.length === 0) return;
    const count = selectedProxyIds.length;
    const toDeleteIds = [...selectedProxyIds];
    triggerConfirm({
      title: "批量删除代理模板",
      message: `确定批量删除选中的 ${count} 个代理模板吗？删除后将自动从对应频道移除生成的直播源，并将模板加入永久排除名单。`,
      confirmText: `彻底删除 (${count})`,
      isDanger: true,
      onConfirm: async () => {
        // Optimistic UI update
        setProxies(prev => prev.filter(p => !toDeleteIds.includes(p.id)));
        setSelectedProxyIds([]);
        try {
          const res = await fetch("/api/carousel-proxies/batch-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: toDeleteIds })
          });
          const data = await res.json();
          if (!res.ok || data.error) {
            showToast("批量删除失败: " + (data.error || "未知错误"), "error");
          } else {
            showToast(`已成功批量删除 ${count} 个代理模板，对应直播源已移除`, "success");
          }
          loadData();
          fetchData();
        } catch (e: any) {
          console.error(e);
          showToast("批量删除请求失败: " + (e?.message || "网络错误"), "error");
          loadData();
        }
      }
    });
  };

  // --- Disabled Rules CRUD ---
  const effectiveRuleFormPlatform = ruleForm.platform === "custom"
    ? (ruleForm.customPlatform.trim().toLowerCase() || "")
    : ruleForm.platform;

  const saveDisabledRule = async () => {
    if (!ruleForm.pattern.trim()) return showToast("请输入规则匹配内容 (如域名或关键字)", "error");
    try {
      const payload = {
        pattern: ruleForm.pattern.trim(),
        type: ruleForm.type,
        platform: effectiveRuleFormPlatform,
        description: ruleForm.description.trim(),
        enabled: ruleForm.enabled ? 1 : 0
      };
      if (editingRuleId) {
        await fetch(`/api/carousel-disabled-rules/${editingRuleId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        showToast("禁用规则已更新", "success");
      } else {
        await fetch("/api/carousel-disabled-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        showToast("禁用规则已添加", "success");
      }
      setEditingRuleId(null);
      setRuleForm({
        pattern: "",
        type: "contains",
        platform: "",
        customPlatform: "",
        description: "",
        enabled: true
      });
      await loadDisabledRules();
      await loadData();
      fetchData();
    } catch (e: any) {
      console.error(e);
      showToast("保存规则失败: " + (e?.message || "网络错误"), "error");
    }
  };

  const toggleRuleEnabled = async (rule: CarouselDisabledRule) => {
    const nextVal = rule.enabled === 1 || rule.enabled === true ? 0 : 1;
    try {
      await fetch(`/api/carousel-disabled-rules/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextVal })
      });
      loadDisabledRules();
      loadData();
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteDisabledRule = (id: string) => {
    triggerConfirm({
      title: "删除禁用规则",
      message: "确定删除该禁用规则吗？",
      confirmText: "确认删除",
      isDanger: true,
      onConfirm: async () => {
        try {
          await fetch(`/api/carousel-disabled-rules/${id}`, { method: "DELETE" });
          showToast("禁用规则已删除", "success");
          loadDisabledRules();
        } catch (e: any) {
          console.error(e);
          showToast("删除规则失败: " + (e?.message || "网络错误"), "error");
        }
      }
    });
  };

  const handleApplyCleanup = async () => {
    triggerConfirm({
      title: "应用规则并清理违规代理",
      message: "确定立即应用所有生效中的禁用规则并彻底清理数据库中命中规则的代理模板吗？",
      confirmText: "立即清理",
      isDanger: true,
      onConfirm: async () => {
        try {
          const res = await fetch("/api/carousel-disabled-rules/apply-cleanup", { method: "POST" });
          const data = await res.json();
          if (data.success) {
            showToast(`应用清理成功！已自动清理并移除了 ${data.purgedCount} 个违规代理模板，当前剩余 ${data.remainingCount} 个有效代理。`, "success");
            loadData();
            fetchData();
          } else {
            showToast(data.error || "清理失败", "error");
          }
        } catch (e) {
          showToast("清理失败", "error");
        }
      }
    });
  };

  const handleResetPresets = (mode: "reset" | "append") => {
    const msg = mode === "reset" 
      ? "确定要重置为默认推荐的禁用发现规则吗？(这会覆盖现有规则并自动清理违规代理)"
      : "确定增量补充默认推荐规则吗？";
    triggerConfirm({
      title: mode === "reset" ? "重置预置规则" : "补充预置规则",
      message: msg,
      confirmText: "确认执行",
      isDanger: mode === "reset",
      onConfirm: async () => {
        try {
          const res = await fetch("/api/carousel-disabled-rules/preset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode })
          });
          const data = await res.json();
          if (data.success) {
            showToast(data.message || "预置规则操作成功！", "success");
            loadDisabledRules();
            loadData();
            fetchData();
          } else {
            showToast(data.error || "操作失败", "error");
          }
        } catch (e) {
          showToast("操作失败", "error");
        }
      }
    });
  };

  const handleBatchImportRules = async () => {
    if (!batchRuleForm.lines.trim()) return showToast("请输入要导入的多行规则", "error");
    try {
      const res = await fetch("/api/carousel-disabled-rules/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchRuleForm)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`批量导入完成！成功新增 ${data.addedCount} 条禁用规则，并清理了 ${data.purgedCount} 个违规代理模板。`, "success");
        setIsBatchRuleModalOpen(false);
        setBatchRuleForm({ lines: "", type: "contains", platform: "", description: "" });
        loadDisabledRules();
        loadData();
        fetchData();
      } else {
        showToast(data.error || "导入失败", "error");
      }
    } catch (e) {
      showToast("导入失败", "error");
    }
  };

  // Check URL against disabled rules
  const testUrlMatching = (url: string) => {
    if (!url.trim()) {
      setUrlMatchResult(null);
      return;
    }
    const urlLower = url.trim().toLowerCase();

    // Check hardcoded miguvideo
    if (urlLower.includes("miguvideo")) {
      setUrlMatchResult({
        matched: true,
        rule: {
          id: "core_migu",
          pattern: "miguvideo",
          type: "contains",
          platform: "",
          description: "核心系统内置规则: 忽略所有咪咕官方直链与CDN流 (miguvideo.com)",
          enabled: 1
        }
      });
      return;
    }

    for (const r of disabledRules) {
      if (r.enabled !== 1 && r.enabled !== true) continue;
      const pat = (r.pattern || "").trim();
      if (!pat) continue;
      const patLower = pat.toLowerCase();

      if (r.type === "regex") {
        try {
          if (new RegExp(pat, "i").test(url)) {
            setUrlMatchResult({ matched: true, rule: r });
            return;
          }
        } catch (e) {}
      } else if (r.type === "prefix") {
        if (urlLower.startsWith(patLower)) {
          setUrlMatchResult({ matched: true, rule: r });
          return;
        }
      } else if (r.type === "domain") {
        try {
          let host = "";
          if (url.startsWith("http://") || url.startsWith("https://")) {
            host = new URL(url).hostname.toLowerCase();
          } else {
            host = url.split("/")[0].split(":")[0].toLowerCase();
          }
          if (host === patLower || host.endsWith("." + patLower) || host.includes(patLower)) {
            setUrlMatchResult({ matched: true, rule: r });
            return;
          }
        } catch (e) {
          if (urlLower.includes(patLower)) {
            setUrlMatchResult({ matched: true, rule: r });
            return;
          }
        }
      } else {
        // contains
        if (urlLower.includes(patLower)) {
          setUrlMatchResult({ matched: true, rule: r });
          return;
        }
      }
    }

    setUrlMatchResult({ matched: false });
  };

  // --- Testing Logic ---
  const effectiveTestPlatform = testForm.platform === "custom" 
    ? (testForm.customPlatform.trim().toLowerCase() || "custom") 
    : testForm.platform;

  const handleTest = async () => {
    if (!testForm.originalId) return showToast("请输入测试用的直播间 ID", "error");
    setTesting(true);
    setTestResults([]);
    try {
      const res = await fetch("/api/carousel/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: effectiveTestPlatform,
          originalId: testForm.originalId.trim(),
          channelId: "test_probe"
        })
      });
      const data = await res.json();
      setTestResults(data.results || []);
    } catch (e) {
      console.error(e);
    } finally {
      setTesting(false);
    }
  };

  // Known platforms
  const existingProxyPlatforms: string[] = Array.from(new Set(proxies.map(p => String(p.platform || "").toLowerCase()))).filter(Boolean) as string[];
  const extraCustomPlatforms: string[] = existingProxyPlatforms.filter((p: string) => !PRESET_CAROUSEL_PLATFORMS.some(pre => pre.value === p));

  const activeDisabledRulesCount = disabledRules.filter(r => r.enabled === 1 || r.enabled === true).length;

  // Helper to check if a proxy is blocked by disabled rules or disabled discovery rules
  const checkProxyBlockedStatus = (p: any): { isBlocked: boolean; reason: string } => {
    if (!p) return { isBlocked: false, reason: "" };
    if (p.isBlocked !== undefined && p.isBlocked !== null) {
      return { isBlocked: Boolean(p.isBlocked), reason: p.blockedReason || "已命中禁用规则" };
    }
    const url = (p.urlTemplate || "").toLowerCase();
    const platform = (p.platform || "").toLowerCase();

    // 1. Check miguvideo
    if (url.includes("miguvideo")) {
      return { isBlocked: true, reason: "命中内置屏蔽规则 (miguvideo 官方直链/CDN)" };
    }

    // 2. Check disabled discovery rules (黑名单)
    for (const r of disabledRules) {
      if (r.enabled !== 1 && r.enabled !== true) continue;
      if (r.platform && r.platform.toLowerCase() !== platform) continue;
      const pat = (r.pattern || "").trim().toLowerCase();
      if (!pat) continue;

      if (r.type === "regex") {
        try {
          if (new RegExp(r.pattern, "i").test(p.urlTemplate)) {
            return { isBlocked: true, reason: `命中禁用规则 [正则]: ${r.pattern}` };
          }
        } catch (e) {}
      } else if (r.type === "prefix") {
        if (url.startsWith(pat)) {
          return { isBlocked: true, reason: `命中禁用规则 [前缀]: ${r.pattern}` };
        }
      } else if (r.type === "domain") {
        if (url.includes(pat)) {
          return { isBlocked: true, reason: `命中禁用规则 [域名]: ${r.pattern}` };
        }
      } else {
        if (url.includes(pat)) {
          return { isBlocked: true, reason: `命中禁用规则 [包含]: ${r.pattern}` };
        }
      }
    }

    // 3. Check if all discovery rules for this platform are disabled
    if (discoveryRules.length > 0) {
      const platformRules = discoveryRules.filter((dr: any) => (dr.platform || "").toLowerCase() === platform);
      if (platformRules.length > 0) {
        const hasActive = platformRules.some((dr: any) => dr.enabled === 1 || dr.enabled === true || dr.enabled === undefined);
        if (!hasActive) {
          return { isBlocked: true, reason: `所属平台 [${platform.toUpperCase()}] 特征发现规则已停用` };
        }
      }
    }

    return { isBlocked: false, reason: "" };
  };

  const blockedProxies = proxies.filter(p => checkProxyBlockedStatus(p).isBlocked);
  const blockedProxiesCount = blockedProxies.length;
  const visibleProxies = proxies.filter(p => !hideBlocked || !checkProxyBlockedStatus(p).isBlocked);

  const filteredVisibleProxies = visibleProxies
    .filter(p => {
      if (selectedPlatformFilter !== "all" && (p.platform || "").toLowerCase() !== selectedPlatformFilter.toLowerCase()) {
        return false;
      }
      const blockInfo = checkProxyBlockedStatus(p);
      if (statusFilter === "active" && (p.status !== "active" || blockInfo.isBlocked)) {
        return false;
      }
      if (statusFilter === "inactive" && (p.status === "active" || blockInfo.isBlocked)) {
        return false;
      }
      if (statusFilter === "blocked" && !blockInfo.isBlocked) {
        return false;
      }
      const q = searchQuery.trim().toLowerCase();
      return !q || (p.urlTemplate || "").toLowerCase().includes(q) || (p.platform || "").toLowerCase().includes(q);
    })
    .sort((a, b) => sortKey === "urlTemplate" ? (a.urlTemplate || "").localeCompare(b.urlTemplate || "") : (a.platform || "").localeCompare(b.platform || ""));

  const isAllVisibleSelected = filteredVisibleProxies.length > 0 && filteredVisibleProxies.every(p => selectedProxyIds.includes(p.id));

  const toggleSelectAllVisible = () => {
    if (isAllVisibleSelected) {
      const visibleIdsSet = new Set(filteredVisibleProxies.map(p => p.id));
      setSelectedProxyIds(prev => prev.filter(id => !visibleIdsSet.has(id)));
    } else {
      const visibleIds = filteredVisibleProxies.map(p => p.id);
      setSelectedProxyIds(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleSelectProxy = (id: string) => {
    setSelectedProxyIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Header & Tabs */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-800 flex items-center">
              <RefreshCw className="w-5 h-5 mr-2 text-indigo-500 shrink-0" />
              <span className="truncate">轮播直播源代理管理</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              管理轮播源代理模板，支持批量删除或禁用、测活恢复启用
            </p>
          </div>

          {/* Responsive Tabs: Grid on mobile (no overflow cutoffs or ugly scrollbars), Flex on desktop */}
          <div className="grid grid-cols-3 sm:flex sm:items-center gap-1 bg-slate-200/80 p-1 rounded-xl w-full lg:w-auto shrink-0">
            <button
              onClick={() => setActiveTab("proxies")}
              className={`px-2 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 sm:gap-1.5 ${
                activeTab === "proxies"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>代理模板</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-50 text-indigo-600 font-bold">
                {hideBlocked ? visibleProxies.length : proxies.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("disabledRules")}
              className={`px-2 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 sm:gap-1.5 ${
                activeTab === "disabledRules"
                  ? "bg-white text-rose-600 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Ban className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <span>黑名单规则</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeDisabledRulesCount > 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-500"
              }`}>
                {activeDisabledRulesCount}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("test")}
              className={`px-2 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 sm:gap-1.5 ${
                activeTab === "test"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <PlayCircle className="w-3.5 h-3.5 shrink-0" />
              <span>批量测试</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Proxies Management */}
        {activeTab === "proxies" && (
          <div className="p-0">
            {/* Streamlined Responsive Toolbar */}
            <div className="p-3 sm:p-4 bg-white border-b border-slate-100 space-y-3">
              {/* Top Controls Row */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                {/* Search & Mobile Filter Toggle */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="relative flex-1 min-w-0 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="搜索代理URL或平台..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm focus:bg-white focus:border-indigo-400 transition"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Mobile Filter Expand Button */}
                  <button
                    onClick={() => setIsMobileFilterOpen(!isMobileFilterOpen)}
                    className={`md:hidden px-3 py-2 border rounded-lg text-xs font-bold flex items-center gap-1.5 transition shrink-0 ${
                      isMobileFilterOpen || selectedPlatformFilter !== "all" || statusFilter !== "all" || sortKey !== "platform"
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                        : "bg-slate-50 border-slate-200 text-slate-700"
                    }`}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    <span>筛选</span>
                    {(selectedPlatformFilter !== "all" || statusFilter !== "all") && (
                      <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                    )}
                  </button>
                </div>

                {/* Desktop Inline Select Filters */}
                <div className="hidden md:flex items-center gap-2 shrink-0">
                  <select
                    value={selectedPlatformFilter}
                    onChange={e => setSelectedPlatformFilter(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-700 focus:bg-white"
                  >
                    <option value="all">所有平台 ({visibleProxies.length})</option>
                    {PRESET_CAROUSEL_PLATFORMS.map(p => {
                      const count = visibleProxies.filter(px => (px.platform || '').toLowerCase() === p.value).length;
                      return (
                        <option key={p.value} value={p.value}>
                          {p.shortLabel} ({count})
                        </option>
                      );
                    })}
                    {(() => {
                      const presetValues = new Set(PRESET_CAROUSEL_PLATFORMS.map(p => p.value));
                      const customPlatforms: string[] = Array.from(new Set(
                        visibleProxies
                          .map(px => (px.platform || '').toLowerCase())
                          .filter((plat): plat is string => Boolean(plat) && !presetValues.has(plat))
                      ));
                      return customPlatforms.map(plat => {
                        const count = visibleProxies.filter(px => (px.platform || '').toLowerCase() === plat).length;
                        return (
                          <option key={plat} value={plat}>
                            {plat.toUpperCase()} ({count})
                          </option>
                        );
                      });
                    })()}
                  </select>

                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as any)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-700 focus:bg-white"
                  >
                    <option value="all">所有状态 ({visibleProxies.length})</option>
                    <option value="active">
                      已启用 ({visibleProxies.filter(p => p.status === 'active' && !checkProxyBlockedStatus(p).isBlocked).length})
                    </option>
                    <option value="inactive">
                      已禁用 ({visibleProxies.filter(p => p.status !== 'active' && !checkProxyBlockedStatus(p).isBlocked).length})
                    </option>
                    <option value="blocked">
                      规则屏蔽 ({visibleProxies.filter(p => checkProxyBlockedStatus(p).isBlocked).length})
                    </option>
                  </select>

                  <select
                    value={sortKey}
                    onChange={e => setSortKey(e.target.value as any)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-700 focus:bg-white"
                  >
                    <option value="platform">按平台排序</option>
                    <option value="urlTemplate">按URL排序</option>
                  </select>
                </div>

                {/* Primary Action Buttons & Dropdown */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* More Tools Dropdown Menu */}
                  <div className="relative" ref={toolsDropdownRef}>
                    <button
                      onClick={() => setIsToolsDropdownOpen(!isToolsDropdownOpen)}
                      className={`px-3 py-2 rounded-lg font-bold text-xs flex items-center transition border ${
                        isToolsDropdownOpen
                          ? "bg-slate-100 text-slate-900 border-slate-300"
                          : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                      }`}
                      title="更多管理与工具"
                    >
                      <Wrench className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                      <span>更多工具</span>
                      <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${isToolsDropdownOpen ? "rotate-180" : ""}`} />
                    </button>

                    {isToolsDropdownOpen && (
                      <div className="absolute left-0 md:left-auto md:right-0 top-full mt-1.5 w-60 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 text-xs font-medium divide-y divide-slate-100">
                        {/* Group 1: Configuration & Scan */}
                        <div className="py-1">
                          <button
                            onClick={() => {
                              setIsToolsDropdownOpen(false);
                              setPresetForm(JSON.stringify(presets && Object.keys(presets).length > 0 ? presets : DEFAULT_CAROUSEL_PRESETS, null, 2));
                              setIsPresetModalOpen(true);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-bold"
                          >
                            <Settings className="w-3.5 h-3.5 text-slate-500" />
                            <span>测活房间与预设配置</span>
                          </button>

                          <button
                            onClick={async () => {
                              setIsToolsDropdownOpen(false);
                              setScanning(true);
                              try {
                                const res = await fetch("/api/carousel-proxies/scan-sources", { method: "POST" });
                                const data = await res.json();
                                if (data.success) {
                                  showToast(`扫描提取完成！新增发现 ${data.count} 个代理模板，当前共有 ${data.total} 个代理。`, "success");
                                  loadData();
                                  fetchData();
                                } else {
                                  showToast(data.error || "扫描提取失败", "error");
                                }
                              } catch (e) {
                                showToast("扫描请求失败", "error");
                              } finally {
                                setScanning(false);
                              }
                            }}
                            disabled={scanning}
                            className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-bold disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? "animate-spin text-indigo-600" : "text-slate-500"}`} />
                            <span>{scanning ? "正在扫描提取..." : "从现有源自动提取代理"}</span>
                          </button>
                        </div>

                        {/* Group 2: Rules & Visibility */}
                        <div className="py-1">
                          <button
                            onClick={() => {
                              setIsToolsDropdownOpen(false);
                              setActiveTab("disabledRules");
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between text-slate-700 font-bold"
                          >
                            <div className="flex items-center gap-2">
                              <Ban className="w-3.5 h-3.5 text-rose-500" />
                              <span>管理黑名单禁用规则</span>
                            </div>
                            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[10px]">
                              {activeDisabledRulesCount}条生效
                            </span>
                          </button>

                          {blockedProxiesCount > 0 && (
                            <button
                              onClick={() => {
                                setIsToolsDropdownOpen(false);
                                setHideBlocked(!hideBlocked);
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between text-slate-700 font-bold"
                            >
                              <div className="flex items-center gap-2">
                                {hideBlocked ? <Eye className="w-3.5 h-3.5 text-amber-600" /> : <EyeOff className="w-3.5 h-3.5 text-slate-500" />}
                                <span>{hideBlocked ? "显示全部已禁用代理" : "自动隐藏已禁用代理"}</span>
                              </div>
                              <span className="text-[10px] text-slate-400">({blockedProxiesCount})</span>
                            </button>
                          )}
                        </div>

                        {/* Group 3: Danger Action */}
                        {blockedProxiesCount > 0 && (
                          <div className="py-1">
                            <button
                              onClick={() => {
                                setIsToolsDropdownOpen(false);
                                triggerConfirm({
                                  title: "清理违规代理",
                                  message: `确认彻底清理并删除当前 ${blockedProxiesCount} 个命中禁用规则/停用平台的代理模板？`,
                                  confirmText: "彻底清理",
                                  isDanger: true,
                                  onConfirm: async () => {
                                    try {
                                      const res = await fetch("/api/carousel-disabled-rules/apply-cleanup", { method: "POST" });
                                      const data = await res.json();
                                      if (data.success) {
                                        showToast(`清理完成！已移除 ${data.purgedCount} 个违规代理模板。`, "success");
                                        loadData();
                                        fetchData();
                                      } else {
                                        showToast(data.error || "清理失败", "error");
                                      }
                                    } catch (e) {
                                      showToast("清理失败", "error");
                                    }
                                  }
                                });
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-rose-50 text-rose-600 font-bold flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>清理违规代理 ({blockedProxiesCount})</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Primary Test Button */}
                  <button
                    onClick={async () => {
                      setTesting(true);
                      try {
                        const res = await fetch("/api/carousel/test-all", { method: "POST" });
                        const data = await res.json();
                        if (data.success) {
                          showToast(`检测完成，共检测了 ${data.count} 个代理。`, "success");
                          fetchData();
                          loadData();
                        } else {
                          showToast(data.error || "检测失败", "error");
                        }
                      } catch (e) {
                        showToast("检测请求失败", "error");
                      } finally {
                        setTesting(false);
                      }
                    }}
                    disabled={testing}
                    className="flex-1 sm:flex-none justify-center px-3.5 py-2 bg-indigo-600 text-white rounded-lg font-bold text-xs sm:text-sm hover:bg-indigo-700 flex items-center shadow-sm disabled:opacity-50 transition whitespace-nowrap"
                  >
                    {testing ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5 mr-1.5" />}
                    <span>{testing ? "测活中..." : "一键批量测活"}</span>
                  </button>
                </div>
              </div>

              {/* Mobile Filter Drawer (Expandable) */}
              {isMobileFilterOpen && (
                <div className="md:hidden pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">所属平台</label>
                    <select
                      value={selectedPlatformFilter}
                      onChange={e => setSelectedPlatformFilter(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-700"
                    >
                      <option value="all">所有平台 ({visibleProxies.length})</option>
                      {PRESET_CAROUSEL_PLATFORMS.map(p => {
                        const count = visibleProxies.filter(px => (px.platform || '').toLowerCase() === p.value).length;
                        return (
                          <option key={p.value} value={p.value}>
                            {p.shortLabel} ({count})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">启用状态</label>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-700"
                    >
                      <option value="all">所有状态 ({visibleProxies.length})</option>
                      <option value="active">已启用</option>
                      <option value="inactive">已禁用</option>
                      <option value="blocked">规则屏蔽</option>
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">排序规则</label>
                    <select
                      value={sortKey}
                      onChange={e => setSortKey(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-700"
                    >
                      <option value="platform">按平台排序</option>
                      <option value="urlTemplate">按URL排序</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Gentle Violation Notice Banner */}
              {blockedProxiesCount > 0 && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50/70 border border-amber-200/70 rounded-lg text-xs">
                  <div className="flex items-center gap-1.5 text-amber-800 font-medium truncate">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="truncate">
                      {hideBlocked
                        ? `已根据黑名单规则自动隐藏 ${blockedProxiesCount} 个违规代理`
                        : `当前列表中包含 ${blockedProxiesCount} 个命中黑名单规则的代理`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setHideBlocked(!hideBlocked)}
                      className="text-indigo-600 hover:text-indigo-800 font-bold underline cursor-pointer"
                    >
                      {hideBlocked ? "显示" : "隐藏"}
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      onClick={() => {
                        triggerConfirm({
                          title: "清理违规代理",
                          message: `确认彻底清理并删除当前 ${blockedProxiesCount} 个命中禁用规则/停用平台的代理模板？`,
                          confirmText: "彻底清理",
                          isDanger: true,
                          onConfirm: async () => {
                            try {
                              const res = await fetch("/api/carousel-disabled-rules/apply-cleanup", { method: "POST" });
                              const data = await res.json();
                              if (data.success) {
                                showToast(`清理完成！已移除 ${data.purgedCount} 个违规代理模板。`, "success");
                                loadData();
                                fetchData();
                              } else {
                                showToast(data.error || "清理失败", "error");
                              }
                            } catch (e) {
                              showToast("清理失败", "error");
                            }
                          }
                        });
                      }}
                      className="text-rose-600 hover:text-rose-800 font-bold cursor-pointer"
                    >
                      清理违规
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Batch Action Toolbar */}
            {selectedProxyIds.length > 0 && (
              <div className="p-3 bg-indigo-50 border-b border-indigo-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-indigo-900 bg-white px-2.5 py-1 rounded-lg border border-indigo-200 shadow-xs">
                    已勾选 {selectedProxyIds.length} 个代理模板
                  </span>
                  <button
                    onClick={() => setSelectedProxyIds([])}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-bold underline cursor-pointer"
                  >
                    取消全选
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => batchRestoreProxies(false)}
                    disabled={batchActionLoading}
                    className="flex-1 sm:flex-none justify-center px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center shadow-sm disabled:opacity-50 transition whitespace-nowrap"
                    title="对选中的代理进行在线连通性测活，测试通过的代理将恢复启用并自动向对应频道添加直播源"
                  >
                    {batchActionLoading ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    批量测活恢复 ({selectedProxyIds.length})
                  </button>

                  <button
                    onClick={batchDisableProxies}
                    disabled={batchActionLoading}
                    className="flex-1 sm:flex-none justify-center px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold text-xs flex items-center shadow-sm disabled:opacity-50 transition whitespace-nowrap"
                    title="批量禁用选中的代理模板，并自动从所有对应频道中移除生成的直播源"
                  >
                    <EyeOff className="w-3.5 h-3.5 mr-1.5" />
                    批量禁用 ({selectedProxyIds.length})
                  </button>

                  <button
                    onClick={batchDeleteProxies}
                    disabled={batchActionLoading}
                    className="flex-1 sm:flex-none justify-center px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs flex items-center shadow-sm disabled:opacity-50 transition whitespace-nowrap"
                    title="彻底删除选中的代理模板，移除对应直播源并加入排除黑名单"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    批量删除 ({selectedProxyIds.length})
                  </button>
                </div>
              </div>
            )}

            {/* Mobile Card List View (< md screen: dedicated touch card layout, no horizontal collapse or vertical letter distortion) */}
            <div className="block md:hidden divide-y divide-slate-100 bg-slate-50/50 p-2.5 space-y-2.5 min-w-0">
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-white rounded-lg border border-slate-200 text-xs font-bold text-slate-600 min-w-0">
                <label className="flex items-center gap-2 cursor-pointer min-w-0">
                  <input
                    type="checkbox"
                    checked={isAllVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 shrink-0"
                  />
                  <span className="truncate">本页全选 ({filteredVisibleProxies.length})</span>
                </label>
                <span className="text-[11px] text-slate-400 font-normal shrink-0">
                  共 {visibleProxies.length} 个代理
                </span>
              </div>

              {filteredVisibleProxies.map(p => {
                const blockStatus = checkProxyBlockedStatus(p);
                const isSelected = selectedProxyIds.includes(p.id);
                const isTestingThis = singleProxyTestingId === p.id;
                const isActive = p.status === 'active' && !blockStatus.isBlocked;

                return (
                  <div
                    key={p.id}
                    className={`bg-white rounded-xl border p-3 space-y-2.5 transition shadow-xs overflow-hidden min-w-0 ${
                      isSelected
                        ? "border-indigo-400 bg-indigo-50/30 ring-1 ring-indigo-400"
                        : blockStatus.isBlocked
                        ? "border-rose-200 bg-rose-50/20"
                        : "border-slate-200"
                    }`}
                  >
                    {/* Card Header: Checkbox + Platform + Status */}
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectProxy(p.id)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer shrink-0"
                        />
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          {getPlatformBadge(p.platform)}
                          {blockStatus.isBlocked && (
                            <span className="inline-flex items-center text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded shrink-0">
                              <Ban className="w-3 h-3 mr-0.5" />已禁用
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {blockStatus.isBlocked ? (
                          <span className="inline-flex items-center text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                            <Ban className="w-3 h-3 mr-1" />规则屏蔽
                          </span>
                        ) : isActive ? (
                          <span className="inline-flex items-center text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>
                            已启用 (有源)
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[11px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                            <EyeOff className="w-3 h-3 mr-1 text-slate-400" />
                            已禁用 (无源)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Card URL Body with Ellipsis Truncation and Copy Button */}
                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 min-w-0">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div 
                          className="font-mono text-xs text-slate-800 truncate flex-1 min-w-0" 
                          title={p.urlTemplate}
                        >
                          <span className={blockStatus.isBlocked ? "line-through opacity-70" : ""}>
                            {p.urlTemplate}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(p.urlTemplate);
                            showToast("代理模板 URL 已复制到剪贴板", "success");
                          }}
                          className="text-slate-500 hover:text-indigo-600 active:scale-95 px-2 py-0.5 text-[11px] font-bold shrink-0 bg-white border border-slate-200 rounded shadow-2xs cursor-pointer transition"
                          title="复制完整 URL"
                        >
                          复制
                        </button>
                      </div>
                      {blockStatus.isBlocked && (
                        <div className="text-[11px] text-rose-500 font-sans font-medium mt-1 truncate" title={blockStatus.reason}>
                          原因: {blockStatus.reason}
                        </div>
                      )}
                    </div>

                    {/* Card Action Buttons (iOS Touch friendly) */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 min-w-0">
                      <div className="flex-1 min-w-0">
                        {isActive ? (
                          <button
                            onClick={() => toggleProxyStatus(p)}
                            disabled={isTestingThis}
                            className="w-full py-1.5 px-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-xs font-bold transition flex items-center justify-center cursor-pointer truncate"
                          >
                            {isTestingThis ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin shrink-0" /> : <EyeOff className="w-3.5 h-3.5 mr-1 text-amber-600 shrink-0" />}
                            <span className="truncate">禁用并移除源</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleProxyStatus(p)}
                            disabled={isTestingThis}
                            className="w-full py-1.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition flex items-center justify-center cursor-pointer truncate"
                          >
                            {isTestingThis ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin shrink-0" /> : <Play className="w-3.5 h-3.5 mr-1 text-emerald-600 shrink-0" />}
                            <span className="truncate">{isTestingThis ? "测活中..." : "测活并恢复"}</span>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => testSingleProxy(p)}
                          disabled={isTestingThis}
                          className="p-2 text-slate-500 hover:text-indigo-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition shrink-0 cursor-pointer"
                          title="单项连通性测活"
                        >
                          <PlayCircle className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => {
                            setEditingProxyId(p.id);
                            const isPreset = PRESET_CAROUSEL_PLATFORMS.some(pre => pre.value === p.platform);
                            if (isPreset) {
                              setProxyForm({ platform: p.platform, customPlatform: "", urlTemplate: p.urlTemplate, status: p.status });
                            } else {
                              setProxyForm({ platform: "custom", customPlatform: p.platform, urlTemplate: p.urlTemplate, status: p.status });
                            }
                          }}
                          className="p-2 text-slate-500 hover:text-indigo-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition shrink-0 cursor-pointer"
                          title="编辑"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => deleteProxy(p.id)}
                          className="p-2 text-slate-500 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 rounded-lg transition shrink-0 cursor-pointer"
                          title="删除模板"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredVisibleProxies.length === 0 && !loading && (
                <div className="text-center py-10 text-slate-400 bg-white rounded-xl border border-slate-200 p-4">
                  {proxies.length > 0 && blockedProxiesCount > 0 && hideBlocked ? (
                    <div>
                      <p>已根据禁用规则自动隐藏 {blockedProxiesCount} 个被禁用代理。</p>
                      <button onClick={() => setHideBlocked(false)} className="text-indigo-600 underline font-bold mt-2 text-xs cursor-pointer">
                        点击查看已隐藏代理
                      </button>
                    </div>
                  ) : (
                    "暂无符合条件的代理数据"
                  )}
                </div>
              )}
            </div>

            {/* Desktop Table View (>= md screen: fixed minimal width table with structured column sizing and truncation) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[760px]">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                  <tr>
                    <th className="px-3 py-3 w-12 text-center">
                      <input
                        type="checkbox"
                        checked={isAllVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                        title="全选 / 取消全选"
                      />
                    </th>
                    <th className="px-4 py-3 w-32 whitespace-nowrap">平台</th>
                    <th className="px-4 py-3 min-w-[280px]">代理模板 ({} 为频道直播间 ID)</th>
                    <th className="px-4 py-3 w-36 whitespace-nowrap">状态</th>
                    <th className="px-4 py-3 w-52 text-right whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredVisibleProxies.map(p => {
                    const blockStatus = checkProxyBlockedStatus(p);
                    const isSelected = selectedProxyIds.includes(p.id);
                    const isTestingThis = singleProxyTestingId === p.id;
                    const isActive = p.status === 'active' && !blockStatus.isBlocked;

                    return (
                      <tr key={p.id} className={`hover:bg-slate-50 transition ${isSelected ? "bg-indigo-50/40" : blockStatus.isBlocked ? "bg-rose-50/20 text-slate-500" : ""}`}>
                        <td className="px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectProxy(p.id)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {getPlatformBadge(p.platform)}
                            {blockStatus.isBlocked && (
                              <span className="inline-flex items-center text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded" title={blockStatus.reason}>
                                <Ban className="w-3 h-3 mr-1" />已禁用
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-slate-700 max-w-md min-w-0">
                          <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0 group">
                              <span 
                                className={`truncate block flex-1 ${blockStatus.isBlocked ? "line-through opacity-70" : ""}`}
                                title={p.urlTemplate}
                              >
                                {p.urlTemplate}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(p.urlTemplate);
                                  showToast("代理模板 URL 已复制到剪贴板", "success");
                                }}
                                className="text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 focus:opacity-100 px-1.5 py-0.5 text-[10px] font-sans font-bold shrink-0 bg-white border border-slate-200 rounded shadow-2xs cursor-pointer transition"
                                title="复制完整 URL"
                              >
                                复制
                              </button>
                            </div>
                            {blockStatus.isBlocked && (
                              <span className="text-[11px] text-rose-500 font-sans font-medium truncate" title={blockStatus.reason}>
                                {blockStatus.reason}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-bold whitespace-nowrap">
                          {blockStatus.isBlocked ? (
                            <span className="inline-flex items-center text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-1 rounded">
                              <Ban className="w-3 h-3 mr-1" />规则屏蔽
                            </span>
                          ) : isActive ? (
                            <span className="inline-flex items-center text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
                              已启用 (有源)
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1 rounded">
                              <EyeOff className="w-3 h-3 mr-1 text-slate-400" />
                              已禁用 (无源)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {/* Toggle status button */}
                            {isActive ? (
                              <button
                                onClick={() => toggleProxyStatus(p)}
                                disabled={isTestingThis}
                                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-xs font-bold transition flex items-center cursor-pointer"
                                title="点击禁用此代理，系统将自动移除对应频道的直播源"
                              >
                                {isTestingThis ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <EyeOff className="w-3 h-3 mr-1 text-amber-600" />}
                                禁用
                              </button>
                            ) : (
                              <button
                                onClick={() => toggleProxyStatus(p)}
                                disabled={isTestingThis}
                                className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition flex items-center cursor-pointer"
                                title="点击在线测活，可用时自动恢复启用并向频道添加直播源"
                              >
                                {isTestingThis ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1 text-emerald-600" />}
                                {isTestingThis ? "测活中..." : "恢复启用"}
                              </button>
                            )}

                            {/* Test single proxy */}
                            <button
                              onClick={() => testSingleProxy(p)}
                              disabled={isTestingThis}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 transition rounded hover:bg-slate-100 cursor-pointer"
                              title="单项连通性测活"
                            >
                              <PlayCircle className="w-4 h-4" />
                            </button>

                            {/* Edit */}
                            <button 
                              onClick={() => {
                                setEditingProxyId(p.id);
                                const isPreset = PRESET_CAROUSEL_PLATFORMS.some(pre => pre.value === p.platform);
                                if (isPreset) {
                                  setProxyForm({ platform: p.platform, customPlatform: "", urlTemplate: p.urlTemplate, status: p.status });
                                } else {
                                  setProxyForm({ platform: "custom", customPlatform: p.platform, urlTemplate: p.urlTemplate, status: p.status });
                                }
                              }} 
                              className="p-1.5 text-slate-400 hover:text-indigo-600 transition rounded hover:bg-slate-100 cursor-pointer"
                              title="编辑"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>

                            {/* Delete */}
                            <button 
                              onClick={() => deleteProxy(p.id)} 
                              className="p-1.5 text-slate-400 hover:text-rose-600 transition rounded hover:bg-slate-100 cursor-pointer"
                              title="永久删除模板并清理关联直播源"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredVisibleProxies.length === 0 && !loading && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-slate-400">
                        {proxies.length > 0 && blockedProxiesCount > 0 && hideBlocked ? (
                          <span>
                            已根据禁用规则自动隐藏 {blockedProxiesCount} 个被禁用代理。
                            <button onClick={() => setHideBlocked(false)} className="text-indigo-600 underline font-bold ml-2 cursor-pointer">
                              点击查看已隐藏代理
                            </button>
                          </span>
                        ) : (
                          "暂无符合条件的代理数据"
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Add / Edit Proxy Form */}
            <div className="p-4 bg-slate-50/50 border-t border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-1 md:col-span-4">
                  <label className="block text-xs font-bold text-slate-500 mb-1">平台标识</label>
                  <select 
                    value={proxyForm.platform} 
                    onChange={e => setProxyForm({ ...proxyForm, platform: e.target.value })}
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

                {proxyForm.platform === "custom" && (
                  <div className="sm:col-span-1 md:col-span-3">
                    <label className="block text-xs font-bold text-slate-500 mb-1">自定义平台代码</label>
                    <input 
                      type="text" 
                      value={proxyForm.customPlatform}
                      onChange={e => setProxyForm({ ...proxyForm, customPlatform: e.target.value })}
                      placeholder="例如: zhibo8"
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono font-bold"
                    />
                  </div>
                )}

                <div className={proxyForm.platform === "custom" ? "sm:col-span-2 md:col-span-3" : "sm:col-span-1 md:col-span-6"}>
                  <label className="block text-xs font-bold text-slate-500 mb-1">代理模板 URL (使用 {'{}'} 代表频道 ID)</label>
                  <input 
                    type="text" 
                    value={proxyForm.urlTemplate}
                    onChange={e => setProxyForm({ ...proxyForm, urlTemplate: e.target.value })}
                    placeholder="例如: https://lunbo.freetv.top/yy/{}"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>

                <div className="sm:col-span-2 md:col-span-2 flex gap-2">
                  <button 
                    onClick={saveProxy}
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 flex items-center justify-center shrink-0 transition whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    {editingProxyId ? "保存修改" : "添加代理模板"}
                  </button>
                  {editingProxyId && (
                    <button 
                      onClick={() => {
                        setEditingProxyId(null);
                        setProxyForm({ platform: "yy", customPlatform: "", urlTemplate: "", status: "active" });
                      }} 
                      className="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-300 shrink-0 transition whitespace-nowrap"
                    >
                      取消
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Disabled Discovery Rules (黑名单) */}
        {activeTab === "disabledRules" && (
          <div className="p-0">
            {/* Top Explanation & Quick Actions Banner */}
            <div className="p-4 bg-rose-50/40 border-b border-rose-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-rose-100 text-rose-600 rounded-xl mt-0.5">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    禁用代理发现规则
                    <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold">
                      {activeDisabledRulesCount} 条规则生效中
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                    命中以下规则的 URL 将被<b>完全忽略</b>，不会被提取或注册为轮播代理模板。用于过滤咪咕官方直链（如 <code className="text-rose-600 font-mono">miguvideo.com</code>）、各类 CDN 临时播放链或特定第三方域名。
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  onClick={handleApplyCleanup}
                  className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs flex items-center shadow-sm transition"
                  title="立即扫描并清理所有已存在的违规代理模板"
                >
                  <Ban className="w-3.5 h-3.5 mr-1.5" />
                  一键应用并清理违规代理
                </button>

                <button
                  onClick={() => setIsBatchRuleModalOpen(true)}
                  className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-lg font-bold text-xs flex items-center border border-slate-200 transition"
                >
                  <Plus className="w-3.5 h-3.5 mr-1 text-slate-500" />
                  批量导入规则
                </button>

                <button
                  onClick={() => handleResetPresets("reset")}
                  className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-lg font-bold text-xs flex items-center border border-slate-200 transition"
                  title="恢复内置推荐的咪咕CDN及常见直链忽略规则"
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-500" />
                  恢复推荐预置
                </button>
              </div>
            </div>

            {/* URL Interactive Match Simulator */}
            <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col md:flex-row items-start md:items-center gap-3">
              <div className="text-xs font-bold text-slate-600 whitespace-nowrap flex items-center gap-1">
                <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
                规则拦截实时探测：
              </div>
              <div className="flex-1 w-full flex items-center gap-2">
                <input
                  type="text"
                  placeholder="粘贴任意播放源 URL 进行测试，例如: http://play.miguvideo.com/live/xxx.m3u8"
                  value={testUrlInput}
                  onChange={e => {
                    setTestUrlInput(e.target.value);
                    testUrlMatching(e.target.value);
                  }}
                  className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono"
                />
                {testUrlInput && urlMatchResult && (
                  <div className="shrink-0 flex items-center text-xs font-bold">
                    {urlMatchResult.matched ? (
                      <span className="inline-flex items-center text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200">
                        <Ban className="w-3.5 h-3.5 mr-1" />
                        已拦截 (命中: {urlMatchResult.rule?.pattern})
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                        <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                        允许发现 (未命中禁用规则)
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Search & Rules Table */}
            <div className="p-4 bg-white border-b border-slate-100 flex items-center justify-between">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="搜索禁用规则、关键词或平台..."
                  value={rulesSearchQuery}
                  onChange={e => setRulesSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white transition"
                />
              </div>
              <span className="text-xs text-slate-400">
                共 {disabledRules.length} 条禁用发现规则
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[650px]">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 w-16 text-center whitespace-nowrap">状态</th>
                    <th className="px-4 py-3 whitespace-nowrap">匹配模式</th>
                    <th className="px-4 py-3">规则内容 (Pattern)</th>
                    <th className="px-4 py-3 whitespace-nowrap">适用平台</th>
                    <th className="px-4 py-3">规则说明</th>
                    <th className="px-4 py-3 text-right whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {disabledRules
                    .filter(r => 
                      (r.pattern || "").toLowerCase().includes(rulesSearchQuery.toLowerCase()) ||
                      (r.description || "").toLowerCase().includes(rulesSearchQuery.toLowerCase()) ||
                      (r.platform || "").toLowerCase().includes(rulesSearchQuery.toLowerCase())
                    )
                    .map(rule => {
                      const isEnabled = rule.enabled === 1 || rule.enabled === true;
                      return (
                        <tr key={rule.id} className={`hover:bg-slate-50 transition ${!isEnabled ? "opacity-60 bg-slate-50/40" : ""}`}>
                          {/* Toggle Switch */}
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <button
                              onClick={() => toggleRuleEnabled(rule)}
                              className={`w-9 h-5 flex items-center rounded-full p-0.5 transition duration-300 ${
                                isEnabled ? "bg-rose-500" : "bg-slate-300"
                              }`}
                              title={isEnabled ? "点击禁用此规则" : "点击启用此规则"}
                            >
                              <div
                                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition duration-300 ${
                                  isEnabled ? "translate-x-4" : "translate-x-0"
                                }`}
                              />
                            </button>
                          </td>

                          {/* Match Type Badge */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {rule.type === "contains" && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                包含关键词
                              </span>
                            )}
                            {rule.type === "domain" && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                域名匹配
                              </span>
                            )}
                            {rule.type === "prefix" && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                URL 前缀
                              </span>
                            )}
                            {rule.type === "regex" && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                正则表达式
                              </span>
                            )}
                          </td>

                          {/* Pattern */}
                          <td className="px-4 py-3 font-mono text-xs font-bold text-slate-800 max-w-xs md:max-w-sm min-w-0">
                            <span className="truncate block" title={rule.pattern}>
                              {rule.pattern}
                            </span>
                          </td>

                          {/* Platform */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {rule.platform ? (
                              getPlatformBadge(rule.platform)
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                全部平台通用
                              </span>
                            )}
                          </td>

                          {/* Description */}
                          <td className="px-4 py-3 text-xs text-slate-500 max-w-sm">
                            {rule.description || "-"}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button
                              onClick={() => {
                                setEditingRuleId(rule.id);
                                const isPreset = PRESET_CAROUSEL_PLATFORMS.some(pre => pre.value === rule.platform);
                                setRuleForm({
                                  pattern: rule.pattern,
                                  type: rule.type || "contains",
                                  platform: isPreset || !rule.platform ? rule.platform : "custom",
                                  customPlatform: isPreset ? "" : (rule.platform || ""),
                                  description: rule.description || "",
                                  enabled: rule.enabled === 1 || rule.enabled === true
                                });
                              }}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 transition"
                              title="编辑规则"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteDisabledRule(rule.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 transition ml-2"
                              title="删除规则"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {disabledRules.length === 0 && !rulesLoading && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-slate-400">
                        暂无禁用规则，可点击上方「恢复推荐预置」一键加载常见忽略规则。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Add / Edit Disabled Rule Form */}
            <div className="p-4 bg-slate-50 border-t border-slate-200">
              <div className="text-xs font-bold text-slate-700 mb-3 flex items-center">
                <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
                {editingRuleId ? "编辑禁用发现规则" : "添加新禁用发现规则"}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                <div className="md:col-span-4">
                  <label className="block text-xs font-bold text-slate-500 mb-1">
                    规则匹配内容 (Pattern) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={ruleForm.pattern}
                    onChange={e => setRuleForm({ ...ruleForm, pattern: e.target.value })}
                    placeholder="例如: miguvideo 或 hw-mbl-live.miguvideo.com"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-500 mb-1">匹配模式</label>
                  <select
                    value={ruleForm.type}
                    onChange={e => setRuleForm({ ...ruleForm, type: e.target.value as any })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="contains">包含关键词</option>
                    <option value="domain">域名匹配</option>
                    <option value="prefix">URL 前缀</option>
                    <option value="regex">正则表达式</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-500 mb-1">适用平台</label>
                  <select
                    value={ruleForm.platform}
                    onChange={e => setRuleForm({ ...ruleForm, platform: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    <option value="">全部平台通用</option>
                    {PRESET_CAROUSEL_PLATFORMS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                    <option value="custom">+ 自定义平台...</option>
                  </select>
                </div>

                {ruleForm.platform === "custom" && (
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-500 mb-1">平台代码</label>
                    <input
                      type="text"
                      value={ruleForm.customPlatform}
                      onChange={e => setRuleForm({ ...ruleForm, customPlatform: e.target.value })}
                      placeholder="例如: migu"
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                    />
                  </div>
                )}

                <div className={ruleForm.platform === "custom" ? "md:col-span-2" : "md:col-span-4"}>
                  <label className="block text-xs font-bold text-slate-500 mb-1">规则说明 (选填)</label>
                  <input
                    type="text"
                    value={ruleForm.description}
                    onChange={e => setRuleForm({ ...ruleForm, description: e.target.value })}
                    placeholder="例如: 忽略咪咕华为移动直播CDN域名"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-200/60">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-600">
                  <input
                    type="checkbox"
                    checked={ruleForm.enabled}
                    onChange={e => setRuleForm({ ...ruleForm, enabled: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  立即启用该规则
                </label>

                <div className="flex items-center gap-2">
                  {editingRuleId && (
                    <button
                      onClick={() => {
                        setEditingRuleId(null);
                        setRuleForm({
                          pattern: "",
                          type: "contains",
                          platform: "",
                          customPlatform: "",
                          description: "",
                          enabled: true
                        });
                      }}
                      className="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-300 transition"
                    >
                      取消
                    </button>
                  )}
                  <button
                    onClick={saveDisabledRule}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm flex items-center shadow-sm transition"
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    {editingRuleId ? "保存规则修改" : "添加禁用规则"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Test Mode */}
        {activeTab === "test" && (
          <div className="p-6">
            <div className="flex flex-wrap gap-4 mb-6">
              <div className="w-60">
                <label className="block text-xs font-bold text-slate-500 mb-1">所属平台</label>
                <select 
                  value={testForm.platform} 
                  onChange={e => setTestForm({ ...testForm, platform: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-800"
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

              {testForm.platform === "custom" && (
                <div className="w-44">
                  <label className="block text-xs font-bold text-slate-500 mb-1">自定义平台代码</label>
                  <input 
                    type="text" 
                    value={testForm.customPlatform}
                    onChange={e => setTestForm({ ...testForm, customPlatform: e.target.value })}
                    placeholder="例如: zhibo8"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono font-bold"
                  />
                </div>
              )}

              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-bold text-slate-500 mb-1">直播间 ID</label>
                <input 
                  type="text" 
                  value={testForm.originalId}
                  onChange={e => setTestForm({ ...testForm, originalId: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
                  placeholder="例如: 12345, 9999, cctv1, lpl"
                />
              </div>
            </div>

            <div className="flex gap-2 items-center mb-6 overflow-x-auto pb-2">
              <span className="text-xs font-bold text-slate-400 whitespace-nowrap">快速填入预设 ID 进行测试：</span>
              {(presets[effectiveTestPlatform] || []).map((preset: any, idx: number) => (
                <button 
                  key={idx} 
                  onClick={() => setTestForm(prev => ({ ...prev, originalId: preset.id }))} 
                  className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded text-xs font-bold transition whitespace-nowrap border border-slate-200"
                >
                  {preset.name} ({preset.id})
                </button>
              ))}
              {(presets[effectiveTestPlatform] || []).length === 0 && (
                <span className="text-xs text-slate-400">该平台暂无预设 ID，可手动输入 ID 测试</span>
              )}
              
              <button 
                onClick={() => {
                  setPresetForm(JSON.stringify(presets, null, 2));
                  setIsPresetModalOpen(true);
                }} 
                className="ml-auto p-1.5 text-slate-400 hover:text-indigo-600 transition shrink-0" 
                title="配置预设ID"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
            
            <button 
              onClick={handleTest}
              disabled={testing}
              className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 flex items-center shadow-sm disabled:opacity-50 transition"
            >
              {testing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
              {testing ? "正在逐个检测代理..." : "开始批量检测"}
            </button>

            {testResults.length > 0 && (
              <div className="mt-8">
                <h3 className="font-bold text-slate-800 mb-4 border-b border-slate-100 pb-2">检测报告 ({testResults.length} 个模板)</h3>
                <div className="bg-slate-50 rounded-xl overflow-hidden border border-slate-200">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm min-w-[450px]">
                      <thead className="bg-slate-100 text-slate-500 font-bold text-xs">
                        <tr>
                          <th className="px-4 py-3 whitespace-nowrap">代理 URL</th>
                          <th className="px-4 py-3 whitespace-nowrap">响应状态</th>
                          <th className="px-4 py-3 text-right whitespace-nowrap">延迟</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {testResults.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-mono text-xs max-w-xs sm:max-w-md min-w-0">
                              <div className="flex items-center gap-2 min-w-0 group">
                                <span className="truncate block flex-1" title={r.url}>
                                  {r.url}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(r.url);
                                    showToast("测试 URL 已复制到剪贴板", "success");
                                  }}
                                  className="text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 focus:opacity-100 px-1.5 py-0.5 text-[10px] font-sans font-bold shrink-0 bg-white border border-slate-200 rounded shadow-2xs cursor-pointer transition"
                                  title="复制完整 URL"
                                >
                                  复制
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {r.status === 'active' 
                                ? <span className="inline-flex items-center text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded"><Check className="w-3 h-3 mr-1" />可用</span>
                                : <span className="inline-flex items-center text-xs font-bold text-rose-500 bg-rose-50 px-2 py-1 rounded"><AlertCircle className="w-3 h-3 mr-1" />失效</span>
                              }
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                              {r.latency ? `${r.latency}ms` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Batch Import Rules Modal */}
      {isBatchRuleModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <FileText className="w-4 h-4 text-rose-500" />
                批量导入禁用代理发现规则
              </h3>
              <button onClick={() => setIsBatchRuleModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  每行一条规则关键词/域名/URL:
                </label>
                <textarea
                  value={batchRuleForm.lines}
                  onChange={e => setBatchRuleForm({ ...batchRuleForm, lines: e.target.value })}
                  placeholder={`miguvideo\nhw-mbl-live.miguvideo.com\nplay.miguvideo.com\naliyuncs.com`}
                  className="w-full h-44 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono focus:bg-white focus:outline-none focus:border-indigo-500"
                  spellCheck={false}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">匹配模式</label>
                  <select
                    value={batchRuleForm.type}
                    onChange={e => setBatchRuleForm({ ...batchRuleForm, type: e.target.value as any })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-800"
                  >
                    <option value="contains">包含关键词</option>
                    <option value="domain">域名匹配</option>
                    <option value="prefix">URL 前缀</option>
                    <option value="regex">正则表达式</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">适用平台</label>
                  <select
                    value={batchRuleForm.platform}
                    onChange={e => setBatchRuleForm({ ...batchRuleForm, platform: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-800"
                  >
                    <option value="">全部平台通用</option>
                    {PRESET_CAROUSEL_PLATFORMS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">统一说明 (选填)</label>
                <input
                  type="text"
                  value={batchRuleForm.description}
                  onChange={e => setBatchRuleForm({ ...batchRuleForm, description: e.target.value })}
                  placeholder="例如: 批量导入忽略域名"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button
                onClick={() => setIsBatchRuleModalOpen(false)}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-bold text-xs hover:bg-slate-300 transition"
              >
                取消
              </button>
              <button
                onClick={handleBatchImportRules}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-bold text-xs hover:bg-indigo-700 transition"
              >
                确认导入并清理
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preset ID Config Modal */}
      {isPresetModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in border border-slate-100">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">代理有效性测活房间与预设配置</h3>
                  <p className="text-[11px] text-slate-500">用于单代理测试、一键测活与恢复启用时的连通性探测</p>
                </div>
              </div>
              <button onClick={() => setIsPresetModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded transition cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2 bg-indigo-50/60 border border-indigo-100 p-3 rounded-xl">
                <div className="text-xs text-indigo-900 leading-relaxed">
                  <span className="font-bold">测活原理：</span>系统优先使用各平台已注册频道的真实房间号探测，若未找到则使用下方配置的预设房间号。支持 2xx 成功与 301/302 重定向到流媒体 CDN 识别。
                </div>
                <button
                  type="button"
                  onClick={() => {
                    triggerConfirm({
                      title: "恢复推荐测活预设",
                      message: "确认重置各平台测活房间配置为官方推荐的最佳默认预设？",
                      confirmText: "确认重置",
                      isDanger: false,
                      onConfirm: () => resetPresetsToDefault()
                    });
                  }}
                  className="px-3 py-1.5 bg-white hover:bg-indigo-50 text-indigo-700 font-bold text-xs rounded-lg border border-indigo-200 transition shrink-0 cursor-pointer shadow-2xs"
                >
                  <RefreshCw className="w-3.5 h-3.5 inline mr-1" />
                  恢复推荐预设
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  各平台测活房间号字典 (JSON 格式):
                </label>
                <textarea 
                  value={presetForm} 
                  onChange={e => setPresetForm(e.target.value)}
                  className="w-full h-64 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  spellCheck={false}
                />
              </div>

              <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                <span>支持平台键名: <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">yy</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">douyu</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">huya</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">bilibili</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">kuaishou</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">douyin</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">cntv</code>, <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">migu</code></span>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2.5">
              <button 
                type="button"
                onClick={() => setIsPresetModalOpen(false)} 
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl font-bold text-xs transition cursor-pointer"
              >
                取消
              </button>
              <button 
                type="button"
                onClick={() => savePresets()} 
                className="px-5 py-2 bg-indigo-600 text-white rounded-xl font-bold text-xs hover:bg-indigo-700 transition cursor-pointer shadow-sm"
              >
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App Toast Notification */}
      {toast && (
        <div className="fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] left-3 right-3 sm:left-auto sm:right-6 z-[99999] flex items-center justify-between gap-3 px-4 py-3 rounded-2xl shadow-2xl transition-all duration-200 border text-xs sm:text-sm font-medium animate-slide-in backdrop-blur-md bg-white/95 sm:max-w-md">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {toast.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
            {toast.type === "error" && <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />}
            {toast.type === "info" && <Info className="w-5 h-5 text-indigo-500 shrink-0" />}
            <span className={`leading-snug break-words ${
              toast.type === "success" ? "text-slate-800 font-semibold" :
              toast.type === "error" ? "text-rose-900 font-semibold" : "text-slate-800 font-semibold"
            }`}>
              {toast.message}
            </span>
          </div>
          <button 
            onClick={() => setToast(null)} 
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition shrink-0"
            title="关闭提示"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* In-App Confirmation Modal (iframe-safe, no native browser popup blocking) */}
      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9990] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in border border-slate-100">
            <div className="p-5 flex items-start gap-3.5">
              <div className={`p-2.5 rounded-full shrink-0 ${confirmModal.isDanger ? "bg-rose-100 text-rose-600" : "bg-indigo-100 text-indigo-600"}`}>
                {confirmModal.isDanger ? <AlertTriangle className="w-6 h-6" /> : <Info className="w-6 h-6" />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-slate-800 mb-1">
                  {confirmModal.title}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed break-words whitespace-pre-wrap">
                  {confirmModal.message}
                </p>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl font-bold text-xs transition cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => confirmModal.onConfirm()}
                className={`px-4 py-2 text-white rounded-xl font-bold text-xs transition cursor-pointer shadow-sm ${
                  confirmModal.isDanger 
                    ? "bg-rose-600 hover:bg-rose-700 focus:ring-2 focus:ring-rose-500" 
                    : "bg-indigo-600 hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500"
                }`}
              >
                {confirmModal.confirmText || "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
