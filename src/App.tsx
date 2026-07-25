import React, { useState, useEffect, useMemo } from "react";
import { 
  Tv, 
  Activity, 
  Compass, 
  CheckCircle, 
  XCircle, 
  Plus, 
  Trash2,
  Archive,
  ArchiveRestore, 
  Edit2, 
  RefreshCw, 
  Download, 
  Search, 
  Filter, 
  ExternalLink,
  Copy,
  Clock,
  Settings, Settings2,
  AlertCircle,
  UploadCloud,
  Upload,
  Check,
  Calendar,
  Layers,
  Zap,
  Play,
  FileText,
  Database,
  Shield,
  GitMerge,
  ChevronUp,
  ChevronDown,
  X
} from "lucide-react";
import { Channel, LiveSource, SyncConfig, TestStatus, EpgGuide, Group, EpgSource } from "./types";
import DashboardView from "./components/DashboardView";
import StatsView from "./components/StatsView";

export default function App() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [syncConfigs, setSyncConfigs] = useState<SyncConfig[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [githubProxy, setGithubProxy] = useState("");
  const [githubProxyInput, setGithubProxyInput] = useState("");
  const [autoCreateChannel, setAutoCreateChannel] = useState(true);
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);
  const [isSavingProxy, setIsSavingProxy] = useState(false);
  const [epgSources, setEpgSources] = useState<EpgSource[]>([]);
  const [isEpgLoading, setIsEpgLoading] = useState(false);
  const [epgForm, setEpgForm] = useState({ id: "", name: "", url: "", active: true });
  const [isMappingStatusOpen, setIsMappingStatusOpen] = useState(false);
  const [epgMappingData, setEpgMappingData] = useState<any>(null);
  const [epgMappingLoading, setEpgMappingLoading] = useState(false);
  const [isEpgFormOpen, setIsEpgFormOpen] = useState(false);
  const [syncingEpgId, setSyncingEpgId] = useState<string | null>(null);
  const [isSyncingAllEpg, setIsSyncingAllEpg] = useState(false);
  const [testingStatus, setTestingStatus] = useState<TestStatus>({ status: "idle", total: 0, checked: 0, results: [] });
  const [activeTab, setActiveTab] = useState<string>("dashboard"); // dashboard, channels, sync, export, epg

  // Cron Jobs State
  const [cronJobs, setCronJobs] = useState<any[]>([]);
  const [cronLogs, setCronLogs] = useState<any[]>([]);
  const [selectedCronJob, setSelectedCronJob] = useState<any>(null);

  const fetchCronJobs = async () => {
    try {
      const res = await fetch("/api/cron-jobs");
      const data = await res.json();
      if (data.success) {
        setCronJobs(data.jobs || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchCronLogs = async (jobId: string) => {
    try {
      const res = await fetch(`/api/cron-jobs/${jobId}/logs`);
      const data = await res.json();
      if (data.success) {
        setCronLogs(data.logs || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const updateCronJob = async (job: any) => {
    try {
      const res = await fetch(`/api/cron-jobs/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      });
      if (res.ok) {
        alert("定时任务更新成功");
        fetchCronJobs();
      }
    } catch (e) {
      console.error(e);
      alert("更新失败");
    }
  };

  const runCronJobManual = async (jobId: string) => {
    try {
      alert("已触发执行...");
      const res = await fetch(`/api/cron-jobs/${jobId}/run`, { method: "POST" });
      if (res.ok) {
        alert("手动执行完成");
        fetchCronJobs();
        if (selectedCronJob?.id === jobId) fetchCronLogs(jobId);
      }
    } catch (e) {
      console.error(e);
      alert("执行出错");
    }
  };

  useEffect(() => {
    if (activeTab === "cron") {
      fetchCronJobs();
    }
  }, [activeTab]);

  useEffect(() => {
    if (selectedCronJob) {
      fetchCronLogs(selectedCronJob.id);
    }
  }, [selectedCronJob]);

  const [channelSubTab, setChannelSubTab] = useState<"channels" | "groups" | "sources">("channels");
  
  // States for interactive actions
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  
  // Loading states
  const [loading, setLoading] = useState(true);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Form states for modals/editors
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [channelForm, setChannelForm] = useState({
    name: "",
    groupIds: [] as string[],
    newGroupsString: "",
    logo: "",
    alias: "",
    epgId: ""
  });

  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<LiveSource | null>(null);
  const [sourceForm, setSourceForm] = useState({
    url: "",
    province: "全国",
    isp: "BGP"
  });

  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [editingSync, setEditingSync] = useState<SyncConfig | null>(null);
  const [syncForm, setSyncForm] = useState({
    name: "",
    url: "",
    type: "m3u" as "m3u" | "txt",
    autoSync: true,
    syncInterval: 12,
    isp: ""
  });

  // States for subscription backups and import/export
  const [isImportSubscriptionsOpen, setIsImportSubscriptionsOpen] = useState(false);
  const [importSubscriptionsContent, setImportSubscriptionsContent] = useState("");
  const [importSubscriptionsMerge, setImportSubscriptionsMerge] = useState(true); // true = merge, false = overwrite
  const [isQuickBackupAvailable, setIsQuickBackupAvailable] = useState(!!localStorage.getItem("iptv_sync_configs_backup"));

  // Progressive rendering / pagination states for large list optimizations to prevent browser out of memory (900MB+)
  const [channelPage, setChannelPage] = useState(1);
  const CHANNELS_PER_PAGE = 80;

  const [globalSourcePage, setGlobalSourcePage] = useState(1);
  const SOURCES_PER_PAGE = 200;

  // Manual Text Import paste box
  const [pasteContent, setPasteContent] = useState("");
  const [pasteType, setPasteType] = useState<"m3u" | "txt">("m3u");
  const [isImportingText, setIsImportingText] = useState(false);

  // EPG preview guide state
  const [epgGuide, setEpgGuide] = useState<EpgGuide | null>(null);
  const [epgLoading, setEpgLoading] = useState(false);

  // EPG Auto-Correction AI states
  const [aiRecommends, setAiRecommends] = useState<{ epgId: string; displayName: string; reason: string; confidence: number }[]>([]);
  const [aiRecommendLoading, setAiRecommendLoading] = useState(false);
  const [aiRecommendError, setAiRecommendError] = useState("");

  // Batch channel operations state
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [isBatchGroupModalOpen, setIsBatchGroupModalOpen] = useState(false);
  const [batchGroupForm, setBatchGroupForm] = useState<{ groupIds: string[]; mode: "replace" | "append" }>({ groupIds: [], mode: "replace" });

  // Batch live source operations state
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [sourceFilterStatus, setSourceFilterStatus] = useState<"all" | "all_with_isolated" | "active" | "inactive" | "isolated" | "unknown">("all");
  const [isBatchSourceModalOpen, setIsBatchSourceModalOpen] = useState(false);
  const [batchSourceForm, setBatchSourceForm] = useState({
    isp: "",
    province: ""
  });

  // Global bulk source operations and filter states
  const [globalSourceSearch, setGlobalSourceSearch] = useState("");
  const [globalSourceIsp, setGlobalSourceIsp] = useState("all");
  const [globalSourceProvince, setGlobalSourceProvince] = useState("all");
  const [globalSourceStatus, setGlobalSourceStatus] = useState("all");
  const [selectedGlobalSourceIds, setSelectedGlobalSourceIds] = useState<string[]>([]);
  const [isBatchGlobalSourceModalOpen, setIsBatchGlobalSourceModalOpen] = useState(false);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [primaryMergeChannelId, setPrimaryMergeChannelId] = useState<string>("auto");
  const [batchGlobalSourceForm, setBatchGlobalSourceForm] = useState({
    isp: "",
    province: "",
    status: ""
  });

  // Auto-reset current pagination page limit back to 1 when search filters change
  useEffect(() => {
    setChannelPage(1);
  }, [searchQuery, selectedCategory]);

  useEffect(() => {
    setGlobalSourcePage(1);
  }, [globalSourceSearch, globalSourceIsp, globalSourceProvince, globalSourceStatus]);

  // Option 2 Client Local Speed Test engine and dynamic state
  const [isClientTesting, setIsClientTesting] = useState(false);
  const [clientTestProgress, setClientTestProgress] = useState(0);
  const [clientTestTotal, setClientTestTotal] = useState(0);
  const [clientTestResults, setClientTestResults] = useState<{ sourceId: string; channelId: string; url: string; status: "active" | "inactive"; latency: number }[]>([]);
  const [clientTestIsp, setClientTestIsp] = useState("电信");
  const [clientTestProvince, setClientTestProvince] = useState("上海");
  const [showApiDoc, setShowApiDoc] = useState(false);
  const [clientThreadCount, setClientThreadCount] = useState(4); // concurrent threads for client probe testing
  const [clientTestOnlyActive, setClientTestOnlyActive] = useState(false); // only test currently active sources
  const [isDetectingIp, setIsDetectingIp] = useState(false);
  const [detectedIp, setDetectedIp] = useState("");

  // Custom iframe-safe Confirmation Modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmModal(null);
      }
    });
  };

  // Password-protection security management states
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  
  // States for password setting modal/form
  const [isSettingPasswordModalOpen, setIsSettingPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: ""
  });

  // Playback Export config builder parameters
  const [exportParams, setExportParams] = useState({
    isp: "",
    province: "",
    status: "",
    limit: "",
  });

  // Unique lists computed from all active live sources
  const allUniqueIspOptions = useMemo(() => {
    const list = new Set<string>();
    channels.forEach(ch => {
      if (ch.sources) {
        ch.sources.forEach(src => {
          if (src.isp) list.add(src.isp);
        });
      }
    });
    return Array.from(list);
  }, [channels]);

  const allUniqueProvinceOptions = useMemo(() => {
    const list = new Set<string>();
    channels.forEach(ch => {
      if (ch.sources) {
        ch.sources.forEach(src => {
          if (src.province) list.add(src.province);
        });
      }
    });
    return Array.from(list);
  }, [channels]);

  const filteredGlobalSources = useMemo(() => {
    const list: any[] = [];
    channels.forEach((ch) => {
      if (ch.sources) {
        ch.sources.forEach((src) => {
          list.push({
            ...src,
            channelId: ch.id,
            channelName: ch.name,
            channelLogo: ch.logo,
            channelGroupIds: ch.groupIds
          });
        });
      }
    });

    return list.filter((item) => {
      const query = globalSourceSearch.trim().toLowerCase();
      const matchesText = !query || 
        item.channelName.toLowerCase().includes(query) || 
        item.url.toLowerCase().includes(query) || 
        (item.isp && item.isp.toLowerCase().includes(query)) || 
        (item.province && item.province.toLowerCase().includes(query));

      const matchesIsp = globalSourceIsp === "all" || item.isp === globalSourceIsp;
      const matchesProvince = globalSourceProvince === "all" || item.province === globalSourceProvince;
      let matchesStatus = false;
      if (globalSourceStatus === "all") matchesStatus = !item.isolated;
      else if (globalSourceStatus === "all_with_isolated") matchesStatus = true;
      else if (globalSourceStatus === "isolated") matchesStatus = !!item.isolated;
      else matchesStatus = !item.isolated && item.status === globalSourceStatus;

      return matchesText && matchesIsp && matchesProvince && matchesStatus;
    });
  }, [channels, globalSourceSearch, globalSourceIsp, globalSourceProvince, globalSourceStatus]);

  const slicedGlobalSources = useMemo(() => {
    return filteredGlobalSources.slice(0, globalSourcePage * SOURCES_PER_PAGE);
  }, [filteredGlobalSources, globalSourcePage]);

  // Backup-specific React States and Functions
  const [backups, setBackups] = useState<any[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [manualBackupTag, setManualBackupTag] = useState("");

  const fetchBackups = async () => {
    setBackupLoading(true);
    try {
      const res = await fetch("/api/backups");
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
      } else {
        showFeedback("error", "加载备份列表失败");
      }
    } catch (err) {
      showFeedback("error", "连接备份接口通信故障");
    } finally {
      setBackupLoading(false);
    }
  };

  const createBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: manualBackupTag })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showFeedback("success", `备份已成功建立！(备注: ${data.tag})`);
        setManualBackupTag("");
        fetchBackups();
      } else {
        showFeedback("error", data.error || "创建备份失败");
      }
    } catch (err) {
      showFeedback("error", "提交备份任务中途中断");
    }
  };

  const restoreBackup = async (filename: string) => {
    triggerConfirm(
      "请确认覆盖当前全量数据？",
      `您确定要将数据恢复至备份 [${filename}] 吗？恢复操作将完全覆盖现有的所有频道别名、播放线路、分组和自动同步任务，数据覆盖不可取消。当前版本系统已为您自动暂存一个紧急防丢包。`,
      async () => {
        try {
          const res = await fetch("/api/backups/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            showFeedback("success", "系统成功恢复！所有播放频道、订阅和运行数据已刷新。");
            await fetchData();
            fetchBackups();
          } else {
            showFeedback("error", data.error || "恢复备份失败");
          }
        } catch (err) {
          showFeedback("error", "连接服务器恢复备份失败");
        }
      }
    );
  };

  const deleteBackup = async (filename: string) => {
    triggerConfirm(
      "危险：删除备份文件？",
      `您确定要永久删除备份 [${filename}] 吗？删除后将无法通过此备份找回数据，此操作不可逆，请谨慎操作。`,
      async () => {
        try {
          const res = await fetch(`/api/backups/${encodeURIComponent(filename)}`, {
            method: "DELETE"
          });
          const data = await res.json();
          if (res.ok && data.success) {
            showFeedback("success", "备份已完全删除");
            fetchBackups();
          } else {
            showFeedback("error", data.error || "删除备份失败");
          }
        } catch (err) {
          showFeedback("error", "连接服务器删除备份失败");
        }
      }
    );
  };

  const handleUploadBackupLocal = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Read the file content
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const textTask = event.target?.result as string;
        // Verify JSON parseable
        const parsed = JSON.parse(textTask);
        if (!parsed.channels && !parsed.groups) {
          showFeedback("error", "上传失败：检测到文件内不包含合法的 channels 或 groups IPTV 数据节点");
          return;
        }

        triggerConfirm(
          "上传并还原本地备份？",
          `您上传了本地外部备份 [${file.name}]。您确定要应用此备份覆盖当前系统数据库吗？当前数据将被完全覆写。系统在恢复前依然会为您暂存一份紧急恢复包。`,
          async () => {
            try {
              const res = await fetch("/api/backups/restore", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: textTask })
              });
              const data = await res.json();
              if (res.ok && data.success) {
                showFeedback("success", data.message || "本地备份文件还原成功！");
                await fetchData();
                fetchBackups();
              } else {
                showFeedback("error", data.error || "加载本地备份失败");
              }
            } catch (err) {
              showFeedback("error", "服务器还原本地文件通信异常");
            }
          }
        );
      } catch (err) {
        showFeedback("error", "解析 JSON 格式失败，请确保您上传的是合法的 json 备份文件");
      }
    };
    reader.readAsText(file);
    // Clear input so same file can be chosen again
    e.target.value = "";
  };

  useEffect(() => {
    if (isAuthenticated && activeTab === "backup") {
      fetchBackups();
    }
  }, [activeTab, isAuthenticated]);

  // Load Channels, Groups & Configurations
  const fetchData = async () => {
    try {
      const [resChannels, resSync, resGroups, resSettings] = await Promise.all([
        fetch(`/api/channels?full=true&_t=${Date.now()}`),
        fetch(`/api/sync-configs?_t=${Date.now()}`),
        fetch(`/api/groups?_t=${Date.now()}`),
        fetch(`/api/settings?_t=${Date.now()}`)
      ]);
      if (resChannels.ok) {
        const data = await resChannels.json();
        setChannels(data);
        if (data.length > 0 && !selectedChannel) {
          setSelectedChannel(data[0]);
        } else if (selectedChannel) {
          // Keep selection updated
          const fresh = data.find((c: Channel) => c.id === selectedChannel.id);
          if (fresh) setSelectedChannel(fresh);
        }
      }
      if (resSync.ok) {
        setSyncConfigs(await resSync.json());
      }
      if (resGroups.ok) {
        setGroups(await resGroups.json());
      }
      if (resSettings && resSettings.ok) {
        const settingsData = await resSettings.json();
        setGithubProxy(settingsData.githubProxy || "");
        setGithubProxyInput(settingsData.githubProxy || "");
        setAutoCreateChannel(settingsData.autoCreateChannel !== false);
      }
      await fetchEpgSourcesInternal();
    } catch (err) {
      showFeedback("error", "连接服务器读取数据失败");
    } finally {
      setLoading(false);
    }
  };

  const fetchEpgSourcesInternal = async () => {
    try {
      const res = await fetch(`/api/epg-sources?_t=${Date.now()}`);
      if (res.ok) {
        setEpgSources(await res.json());
      }
    } catch (err) {
      console.error("Failed to load EPG sources", err);
    }
  };

  const fetchEpgSources = async () => {
    setIsEpgLoading(true);
    await fetchEpgSourcesInternal();
    setIsEpgLoading(false);
  };

  // Adaptive, resilient polling for testing status
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchData();
    
    let timerId: any = null;
    let isMounted = true;

    const poll = async () => {
      try {
        const res = await fetch("/api/sources/test-status");
        if (!isMounted) return;
        
        if (res.ok) {
          const statusData = await res.json() as TestStatus;
          setTestingStatus(statusData);
          if (statusData.status === "running") {
            // Refresh channel data live to show checked progress
            const resChannels = await fetch("/api/channels?full=true");
            if (resChannels.ok && isMounted) {
              setChannels(await resChannels.json());
            }
          }
          // Poll every 2s when running, else every 10s when idle
          const nextInterval = statusData.status === "running" ? 2000 : 10000;
          timerId = setTimeout(poll, nextInterval);
        } else {
          timerId = setTimeout(poll, 10000);
        }
      } catch (err) {
        if (isMounted) {
          // Log as a warning instead of a noisy console error to avoid triggering test failures during server restarts
          console.warn("Could not retrieve speed test status (offline or server restarting). Retrying in 10s...");
          timerId = setTimeout(poll, 10000);
        }
      }
    };

    // Initial check after loading
    timerId = setTimeout(poll, 1500);

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [isAuthenticated]);

  const detectClientIpInfo = async (silent = false) => {
    setIsDetectingIp(true);
    try {
      const res = await fetch("/api/sources/detect-ip");
      if (res.ok) {
        const info = await res.json();
        if (info.ip) setDetectedIp(info.ip);
        if (info.isp) {
          const recognizedIsps = ["电信", "联通", "移动", "广电", "BGP"];
          if (recognizedIsps.includes(info.isp)) {
            setClientTestIsp(info.isp);
          } else {
            setClientTestIsp("其它");
          }
        }
        if (info.province) {
          setClientTestProvince(info.province);
        }
        if (!silent) {
          showFeedback("success", `智能识别本地网络成功！检测到 IP: ${info.ip}，网络归属 [${info.province || ""}${info.isp || ""}]`);
        }
      } else {
        if (!silent) showFeedback("error", "智能网络感探测接口被拒绝");
      }
    } catch (e) {
      if (!silent) showFeedback("error", "无法自动匹配当前设备本地的省份/运营商线路，本轮请手动选择");
    } finally {
      setIsDetectingIp(false);
    }
  };

  useEffect(() => {
    detectClientIpInfo(true);
  }, []);

  const showFeedback = (type: "success" | "error" | "info", text: string) => {
    setFeedbackMsg({ type, text });
    setTimeout(() => {
      setFeedbackMsg(null);
    }, 4500);
  };

  // Setup automated global fetch interceptor via a local scoped fetch function
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input instanceof Request ? input.url : String(input));
    if (url.startsWith("/api/")) {
      const password = localStorage.getItem("iptv_admin_password") || "";
      const headers = new Headers(init?.headers || {});
      if (password) {
        headers.set("x-admin-password", password);
      }
      const updatedInit = {
        ...init,
        headers,
      };
      const response = await window.fetch(input, updatedInit);
      
      // If server responds with 401 Unauthorized because of password requirement, trigger authentication prompt
      if (response.status === 401 && !url.includes("/api/auth/verify") && !url.includes("/api/auth/status")) {
        setIsAuthenticated(false);
        setIsAuthRequired(true);
      }
      return response;
    }
    return window.fetch(input, init);
  };

  const checkAuthStatus = async () => {
    try {
      const res = await fetch("/api/auth/status");
      if (res.ok) {
        const data = await res.json();
        if (data.passwordSet) {
          setIsAuthRequired(true);
          const savedPwd = localStorage.getItem("iptv_admin_password") || "";
          if (savedPwd) {
            // Verify stored password
            const verifyRes = await fetch("/api/auth/verify", {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({ password: savedPwd })
            });
            if (verifyRes.ok) {
              setIsAuthenticated(true);
            } else {
              localStorage.removeItem("iptv_admin_password");
              setIsAuthenticated(false);
            }
          } else {
            setIsAuthenticated(false);
          }
        } else {
          setIsAuthRequired(false);
          setIsAuthenticated(true);
        }
      }
    } catch (e) {
      console.error("Auth status query failed", e);
    } finally {
      setAuthChecking(false);
    }
  };

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const verifyRes = await fetch("/api/auth/verify", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ password: adminPasswordInput })
      });
      if (verifyRes.ok) {
        localStorage.setItem("iptv_admin_password", adminPasswordInput);
        setIsAuthenticated(true);
        showFeedback("success", "解锁成功！欢迎回到 IPTV 管理终端");
        setAdminPasswordInput("");
        await fetchData();
      } else {
         const err = await verifyRes.json();
         setAuthError(err.error || "密码错误，请重新输入");
      }
    } catch (e) {
      setAuthError("无法连接到主服务器，请检查网络后再试");
    }
  };

  const saveGithubProxy = async () => {
    setIsSavingProxy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ githubProxy: githubProxyInput })
      });
      if (res.ok) {
        const data = await res.json();
        setGithubProxy(data.githubProxy || "");
        setGithubProxyInput(data.githubProxy || "");
        showFeedback("success", "GitHub 代理加速配置已成功保存！");
      } else {
        showFeedback("error", "保存 GitHub 代理加速配置失败");
      }
    } catch (e) {
      showFeedback("error", "网络请求异常，保存代理配置失败");
    } finally {
      setIsSavingProxy(false);
    }
  };

  const handleToggleAutoCreateChannel = async (val: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ autoCreateChannel: val })
      });
      if (res.ok) {
        const data = await res.json();
        setAutoCreateChannel(data.autoCreateChannel !== false);
        showFeedback("success", `全局设置已更新：自动同步时${val ? "允许" : "静默禁止"}新建频道`);
      } else {
        showFeedback("error", "更新全局设置失败");
      }
    } catch (e) {
      showFeedback("error", "网络连接异常，更新设置失败");
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showFeedback("error", "两次输入的新密码不一致，请重试");
      return;
    }
    
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldPassword: passwordForm.oldPassword,
          newPassword: passwordForm.newPassword
        })
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        showFeedback("success", data.message || "密码操作成功！");
        if (passwordForm.newPassword) {
          localStorage.setItem("iptv_admin_password", passwordForm.newPassword);
          setIsAuthRequired(true);
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem("iptv_admin_password");
          setIsAuthRequired(false);
          setIsAuthenticated(true);
        }
        setIsSettingPasswordModalOpen(false);
        setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
      } else {
        showFeedback("error", data.error || "原密码校验失败");
      }
    } catch (e) {
      showFeedback("error", "提交密码设置任务超时或失败");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("iptv_admin_password");
    setIsAuthenticated(false);
    setIsSettingPasswordModalOpen(false);
    showFeedback("info", "已成功退出当前管理会话。已加锁。");
  };

  // Trigger Bulk Async Speed check on host
  const triggerConcurrentBulkTest = async () => {
    try {
      showFeedback("info", "大批量多线程测速接口已调用，后台运行中...");
      const res = await fetch("/api/sources/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concurrency: 8
        })
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback("success", data.message || "批量测速任务已在后台排队启动");
      } else {
        showFeedback("error", data.error || "测速启动失败");
      }
    } catch (e) {
      showFeedback("error", "网络请求出错，无法开始并发测速");
    }
  };

  // Cancel running test
  const cancelTest = async () => {
    try {
      const res = await fetch("/api/sources/test-cancel", { method: "POST" });
      if (res.ok) {
        showFeedback("info", "测速任务已发出中断指令");
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Channel CRUD Handlers
  const handleSaveChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const method = editingChannel ? "PUT" : "POST";
      const endpoint = editingChannel ? `/api/channels/${editingChannel.id}` : "/api/channels";

      let finalGroupIds = [...channelForm.groupIds];

      // Support dynamic creation of new free-text groups
      if (channelForm.newGroupsString.trim()) {
        const listNewNames = channelForm.newGroupsString
          .split(/[,;，；]/)
          .map(s => s.trim())
          .filter(Boolean);

        for (const newName of listNewNames) {
          let matchedGroup = groups.find(g => g.name.toLowerCase() === newName.toLowerCase());
          if (!matchedGroup) {
            const gRes = await fetch("/api/groups", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: newName })
            });
            if (gRes.ok) {
              const newG = await gRes.json();
              matchedGroup = newG;
              groups.push(newG); // update client state cache securely
            }
          }
          if (matchedGroup && !finalGroupIds.includes(matchedGroup.id)) {
            finalGroupIds.push(matchedGroup.id);
          }
        }
      }

      const payload = {
        name: channelForm.name,
        groupIds: finalGroupIds,
        logo: channelForm.logo,
        alias: channelForm.alias.split(",").map(s => s.trim()).filter(Boolean),
        epgId: channelForm.epgId
      };

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showFeedback("success", editingChannel ? "频道修改成功" : "添加频道成功");
        setIsChannelModalOpen(false);
        setEditingChannel(null);
        await fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "操作频道失败");
      }
    } catch (e) {
      showFeedback("error", "添加/更新频道发生故障");
    }
  };

  const handleDeleteChannel = (id: string) => {
    triggerConfirm(
      "移除频道",
      "确定移除此频道以及其包含的所有直播播放源吗？",
      async () => {
        try {
          const res = await fetch(`/api/channels/${id}`, { method: "DELETE" });
          if (res.ok) {
            showFeedback("success", "频道删除成功");
            if (selectedChannel?.id === id) {
              setSelectedChannel(null);
            }
            await fetchData();
          } else {
            showFeedback("error", "删除失败");
          }
        } catch (e) {
          showFeedback("error", "网络超时");
        }
      }
    );
  };

  const handleBatchDelete = () => {
    if (selectedChannelIds.length === 0) {
      showFeedback("info", "请先选择要删除的频道");
      return;
    }
    triggerConfirm(
      "批量删除频道",
      `确定批量删除选中的 ${selectedChannelIds.length} 个频道吗？这将同时清理关联的所有直播播放源并无法撤销！`,
      async () => {
        try {
          const res = await fetch("/api/channels/batch-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelIds: selectedChannelIds })
          });
          if (res.ok) {
            showFeedback("success", `成功批量删除 ${selectedChannelIds.length} 个频道`);
            setSelectedChannelIds([]);
            setSelectedChannel(null);
            await fetchData();
          } else {
            const err = await res.json();
            showFeedback("error", err.error || "批量删除失败");
          }
        } catch (e) {
          showFeedback("error", "网络超时");
        }
      }
    );
  };

  const handleBatchMerge = () => {
    if (selectedChannelIds.length < 2) {
      showFeedback("info", "合并频道功能需要至少选择 2 个频道项目");
      return;
    }
    setPrimaryMergeChannelId("auto");
    setIsMergeModalOpen(true);
  };

  const executeMerge = async () => {
    try {
      const res = await fetch("/api/channels/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          channelIds: selectedChannelIds,
          primaryId: primaryMergeChannelId === "auto" ? null : primaryMergeChannelId 
        })
      });
      if (res.ok) {
        const data = await res.json();
        showFeedback("success", data.message || "频道的合并已成功完成！");
        setIsMergeModalOpen(false);
        setSelectedChannelIds([]);
        setSelectedChannel(null);
        await fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "合并频道作业失败");
      }
    } catch (e) {
      showFeedback("error", "网络连接超时，请稍后重试");
    }
  };

  const openBatchGroupModal = () => {
    if (selectedChannelIds.length === 0) {
      showFeedback("info", "请先选择需要编辑分组的频道");
      return;
    }
    setBatchGroupForm({ groupIds: [], mode: "append" }); // Default to append since user requested adding/appending logic as a primary feature
    setIsBatchGroupModalOpen(true);
  };


  const handleMoveGroup = async (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === groups.length - 1) return;
    
    const newGroups = [...groups];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newGroups[index], newGroups[swapIndex]] = [newGroups[swapIndex], newGroups[index]];
    
    // Optistic UI
    setGroups(newGroups);

    try {
      const res = await fetch("/api/groups/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds: newGroups.map(g => g.id) })
      });
      if (!res.ok) {
        showFeedback("error", "重新排序失败");
        await fetchData();
      }
    } catch (e) {
      showFeedback("error", "重新排序失败");
      await fetchData();
    }
  };

  const handleMoveChannel = async (id: string, direction: 'up' | 'down') => {
    const index = channels.findIndex(c => c.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === channels.length - 1) return;
    
    const newChannels = [...channels];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newChannels[index], newChannels[swapIndex]] = [newChannels[swapIndex], newChannels[index]];
    
    // Optistic UI update
    setChannels(newChannels);

    try {
      const res = await fetch("/api/channels/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelIds: newChannels.map(c => c.id) })
      });
      if (!res.ok) {
        showFeedback("error", "重新排序失败");
        await fetchData();
      }
    } catch (e) {
      showFeedback("error", "重新排序失败");
      await fetchData();
    }
  };

  const handleBatchGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedChannelIds.length === 0) return;
    if (batchGroupForm.groupIds.length === 0) {
      showFeedback("error", "请至少选择一个分组");
      return;
    }

    try {
      const res = await fetch("/api/channels/batch-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelIds: selectedChannelIds,
          groupIds: batchGroupForm.groupIds,
          mode: batchGroupForm.mode
        })
      });

      if (res.ok) {
        showFeedback("success", `成功将已选的 ${selectedChannelIds.length} 个频道的分组更新`);
        setIsBatchGroupModalOpen(false);
        setSelectedChannelIds([]);
        await fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "批量设置分组失败");
      }
    } catch (e) {
      showFeedback("error", "网络连接异常");
    }
  };

  const handleBatchRemoveFromGroup = async () => {
    if (selectedChannelIds.length === 0) return;
    const activeGroup = groups.find(g => g.name === selectedCategory);
    if (!activeGroup) {
      showFeedback("error", "当前未选定具体分组，无法执行移除操作");
      return;
    }

    triggerConfirm(
      "从当前分组移除",
      `确定要将选中的 ${selectedChannelIds.length} 个项目从 [${activeGroup.name}] 分组中移除吗？`,
      async () => {
        try {
          const res = await fetch("/api/channels/batch-remove-group", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              channelIds: selectedChannelIds,
              groupId: activeGroup.id
            })
          });

          if (res.ok) {
            showFeedback("success", `已成功将 ${selectedChannelIds.length} 个频道从 [${activeGroup.name}] 分组中移除`);
            setSelectedChannelIds([]);
            await fetchData();
          } else {
            const err = await res.json();
            showFeedback("error", err.error || "从分组移除失败");
          }
        } catch (e) {
          showFeedback("error", "网络连接异常");
        }
      }
    );
  };

  const handleBatchSourceDelete = () => {
    if (!selectedChannel) return;
    if (selectedSourceIds.length === 0) {
      showFeedback("info", "请先选择要删除的直播线路");
      return;
    }
    triggerConfirm(
      "批量删除直播线路",
      `确定批量删除选中的 ${selectedSourceIds.length} 条直播线路吗？此操作无法撤销！`,
      async () => {
        try {
          const res = await fetch(`/api/channels/${selectedChannel.id}/sources/batch-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceIds: selectedSourceIds })
          });
          if (res.ok) {
            showFeedback("success", `成功批量删除 ${selectedSourceIds.length} 条播放线路`);
            setSelectedSourceIds([]);
            await fetchData();
          } else {
            const err = await res.json();
            showFeedback("error", err.error || "批量删除失败");
          }
        } catch (e) {
          showFeedback("error", "网络超时");
        }
      }
    );
  };

  const openBatchSourceEditModal = () => {
    if (selectedSourceIds.length === 0) {
      showFeedback("info", "请先选择需要编辑的直播线路");
      return;
    }
    setBatchSourceForm({ isp: "", province: "" });
    setIsBatchSourceModalOpen(true);
  };

  const handleBatchSourceUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChannel || selectedSourceIds.length === 0) return;
    if (!batchSourceForm.isp && !batchSourceForm.province) {
      showFeedback("error", "请至少指定运营商(ISP)或省份(Province)中的一个修改项");
      return;
    }

    try {
      const res = await fetch(`/api/channels/${selectedChannel.id}/sources/batch-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: selectedSourceIds,
          isp: batchSourceForm.isp,
          province: batchSourceForm.province
        })
      });

      if (res.ok) {
        showFeedback("success", `成功批量更新选中的 ${selectedSourceIds.length} 条直播线路`);
        setIsBatchSourceModalOpen(false);
        setSelectedSourceIds([]);
        await fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "批量更新播放线路失败");
      }
    } catch (e) {
      showFeedback("error", "网络连接异常");
    }
  };

  const handleGlobalBatchDelete = () => {
    if (selectedGlobalSourceIds.length === 0) {
      showFeedback("info", "请先选择需要批量删除的线路");
      return;
    }
    triggerConfirm(
      "批量删除全球直播线路",
      `确定要永久删除选中的 ${selectedGlobalSourceIds.length} 条播放线路吗？此操作涉及多个频道，删除后无法挽回！`,
      async () => {
        try {
          const res = await fetch("/api/sources/global-batch-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceIds: selectedGlobalSourceIds })
          });
          if (res.ok) {
            const data = await res.json();
            showFeedback("success", `成功跨频道批量删除了 ${data.count} 条播放线路`);
            setSelectedGlobalSourceIds([]);
            await fetchData();
          } else {
            const err = await res.json();
            showFeedback("error", err.error || "全域批量删除失败");
          }
        } catch (e) {
          showFeedback("error", "网络超时或连接异常");
        }
      }
    );
  };

  const handleGlobalBatchUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedGlobalSourceIds.length === 0) return;
    if (!batchGlobalSourceForm.isp && !batchGlobalSourceForm.province && !batchGlobalSourceForm.status) {
      showFeedback("error", "请至少指定运营商(ISP)、省份(Province)或线路状态中的一个修改项");
      return;
    }

    try {
      const res = await fetch("/api/sources/global-batch-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: selectedGlobalSourceIds,
          isp: batchGlobalSourceForm.isp,
          province: batchGlobalSourceForm.province,
          status: batchGlobalSourceForm.status
        })
      });

      if (res.ok) {
        const data = await res.json();
        showFeedback("success", `成功跨频道更新了 ${data.count} 条直播线路的属性配置`);
        setIsBatchGlobalSourceModalOpen(false);
        setSelectedGlobalSourceIds([]);
        await fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "全域批量更新失败");
      }
    } catch (e) {
      showFeedback("error", "网络连接故障");
    }
  };

  const handleGlobalBatchTest = async () => {
    if (selectedGlobalSourceIds.length === 0) {
      showFeedback("info", "请先选择需要测速的线路");
      return;
    }
    try {
      const res = await fetch("/api/sources/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: selectedGlobalSourceIds })
      });
      if (res.ok) {
        showFeedback("success", `已成功对已选的 ${selectedGlobalSourceIds.length} 条全球线路启动多线程测速排队中`);
        setSelectedGlobalSourceIds([]);
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "测速任务提交失败");
      }
    } catch (e) {
      showFeedback("error", "发起测速请求异常");
    }
  };

  const runClientSideProbeTest = async () => {
    // Client speed test runs independently of UI search filters/selection
    // Dynamically fetch the matching target ISP + BGP/多线/未知 sources directly from backend
    let listToTest: any[] = [];
    try {
      const queryUrl = `/api/sources/client-test-list?isp=${encodeURIComponent(clientTestIsp)}&province=${encodeURIComponent(clientTestProvince)}&onlyActive=${clientTestOnlyActive}`;
      const res = await fetch(queryUrl);
      if (res.ok) {
        const data = await res.json();
        listToTest = data.sources || [];
      }
    } catch (e) {
      console.error("无法拉取客户端代测线路清单:", e);
    }

    if (listToTest.length === 0) {
      showFeedback("info", `当前 [${clientTestIsp}] 归属及 BGP/多线 可测线路为空，请确认数据库中已包含直播源`);
      return;
    }

    setIsClientTesting(true);
    setClientTestProgress(0);
    setClientTestTotal(listToTest.length);
    setClientTestResults([]);

    const queue = [...listToTest];
    const resultsTemp: { sourceId: string; channelId: string; url: string; status: "active" | "inactive"; latency: number }[] = [];
    let processedCount = 0;

    const runWorker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;

        const startTime = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
        }, 2500); // 2.5s Timeout limit to keep feedback fast

        let status: "active" | "inactive" = "inactive";
        let latency = 9999;

        const urlLower = item.url.trim().toLowerCase();
        const isNonHttpScheme = 
          urlLower.startsWith("rtsp://") || 
          urlLower.startsWith("rtmp://") || 
          urlLower.startsWith("udp://") || 
          urlLower.startsWith("rtp://") ||
          urlLower.startsWith("p2p://");

        if (isNonHttpScheme) {
          // Special Handling for RTSP / RTMP / UDP in Browser DOM Probe:
          // Browsers cannot open raw RTSP/RTMP sockets via fetch().
          // Try HTTP fallback port (e.g. 554/1935/80) probe to test TCP connectivity without TypeError false-positives
          let fallbackUrl = "";
          if (urlLower.startsWith("rtsp://")) {
            fallbackUrl = item.url.replace(/^rtsp:\/\//i, "http://");
          } else if (urlLower.startsWith("rtmp://")) {
            fallbackUrl = item.url.replace(/^rtmp:\/\//i, "http://");
          } else {
            fallbackUrl = item.url.replace(/^(udp|rtp|p2p):\/\//i, "http://");
          }

          try {
            await fetch(fallbackUrl, {
              method: "GET",
              mode: "no-cors",
              cache: "no-cache",
              signal: controller.signal
            });
            clearTimeout(timer);
            latency = Date.now() - startTime;
            status = "active";
          } catch (err: any) {
            clearTimeout(timer);
            // Ignore AbortError (timeout) or TypeError (unsupported scheme in browser)
            if (err && err.name !== "AbortError" && err.name !== "TypeError") {
              latency = Date.now() - startTime;
              status = "active";
            } else {
              status = "inactive";
            }
          }
        } else {
          // Standard HTTP / HTTPS / HLS / FLV probe
          try {
            await fetch(item.url, {
              method: "GET",
              mode: "no-cors",
              cache: "no-cache",
              signal: controller.signal
            });
            clearTimeout(timer);
            latency = Date.now() - startTime;
            status = "active";
          } catch (err: any) {
            clearTimeout(timer);
            // CORS error indicates the target HTTP stream server is alive and responding!
            if (err && err.name !== "AbortError" && err.name !== "TypeError") {
              latency = Date.now() - startTime;
              status = "active";
            }
          }
        }

        resultsTemp.push({
          sourceId: item.id,
          channelId: item.channelId,
          url: item.url,
          status,
          latency: status === "active" ? latency : 9999
        });

        processedCount++;
        setClientTestProgress(processedCount);
        setClientTestResults([...resultsTemp]);
      }
    };

    const countOfThreads = Math.min(clientThreadCount, listToTest.length);
    const pool = Array.from({ length: countOfThreads }, runWorker);
    await Promise.all(pool);

    setIsClientTesting(false);
    showFeedback("success", `[${clientTestIsp} + BGP/多线] 探针测速完成！评估出 ${resultsTemp.filter(r => r.status === "active").length} 条可用源，可点按 [同步评估报告] 上报！`);
  };

  const submitClientSideProbeTest = async () => {
    if (clientTestResults.length === 0) {
      showFeedback("error", "暂无可用于同步的测试结果");
      return;
    }

    try {
      const res = await fetch("/api/sources/client-test-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: clientTestResults,
          clientIsp: clientTestIsp,
          clientProvince: clientTestProvince
        })
      });

      if (res.ok) {
        showFeedback("success", `已完美回传 ${clientTestResults.length} 条本地探针检测性能到主服务器，直播源数据库配置已完成热更新`);
        setClientTestResults([]);
        setClientTestProgress(0);
        setClientTestTotal(0);
        await fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "回传测试数据被拒绝");
      }
    } catch (_) {
      showFeedback("error", "无法连接远端云服务器接口");
    }
  };

  const openChannelCreate = () => {
    setEditingChannel(null);
    setAiRecommends([]);
    setAiRecommendError("");
    setChannelForm({
      name: "",
      groupIds: groups.length > 0 ? [groups[0].id] : [],
      newGroupsString: "",
      logo: "",
      alias: "",
      epgId: ""
    });
    setIsChannelModalOpen(true);
  };

  const openChannelEdit = (ch: Channel) => {
    setEditingChannel(ch);
    setAiRecommends([]);
    setAiRecommendError("");
    setChannelForm({
      name: ch.name || "",
      groupIds: ch.groupIds || [],
      newGroupsString: "",
      logo: ch.logo || "",
      alias: ch.alias ? ch.alias.join(", ") : "",
      epgId: ch.epgId || ""
    });
    setIsChannelModalOpen(true);
  };

  // Live Source CRUD Handlers
  const handleSaveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChannel) return;
    try {
      const isEdit = !!editingSource;
      const endpoint = isEdit 
        ? `/api/channels/${selectedChannel.id}/sources/${editingSource?.id}`
        : `/api/channels/${selectedChannel.id}/sources`;
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sourceForm)
      });

      if (res.ok) {
        showFeedback("success", isEdit ? "修改线路成功" : "新增线路成功");
        setIsSourceModalOpen(false);
        setEditingSource(null);
        await fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "操作线路失败");
      }
    } catch (e) {
      showFeedback("error", "操作线路出错");
    }
  };

  const handleIsolateSource = async (srcId: string, isolated: boolean) => {
    if (!selectedChannel) return;
    try {
      const res = await fetch(`/api/channels/${selectedChannel.id}/sources/${srcId}/isolate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isolated })
      });
      if (res.ok) {
        showFeedback("success", isolated ? "直播线路已隔离 (软删除)" : "直播线路已从隔离中恢复");
        await fetchData();
      } else {
        showFeedback("error", "操作失败");
      }
    } catch(e) {
      showFeedback("error", "网络超时");
    }
  };

  const handleDeleteSource = (srcId: string) => {
    if (!selectedChannel) return;
    triggerConfirm(
      "删除直播源线路",
      "确定删除这条直播线源吗？",
      async () => {
        try {
          const res = await fetch(`/api/channels/${selectedChannel.id}/sources/${srcId}`, {
            method: "DELETE"
          });
          if (res.ok) {
            showFeedback("success", "直播线路已删除");
            await fetchData();
          } else {
            showFeedback("error", "线路删除失败");
          }
        } catch(e) {
          showFeedback("error", "网络超时");
        }
      }
    );
  };

  const openSourceCreate = () => {
    setEditingSource(null);
    setSourceForm({
      url: "",
      province: "全国",
      isp: "BGP"
    });
    setIsSourceModalOpen(true);
  };

  const openSourceEdit = (src: LiveSource) => {
    setEditingSource(src);
    setSourceForm({
      url: src.url || "",
      province: src.province || "全国",
      isp: src.isp || "BGP"
    });
    setIsSourceModalOpen(true);
  };

  // Synchronizers CRUD Handlers
  const handleSaveSync = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isEdit = !!editingSync;
      const method = isEdit ? "PUT" : "POST";
      const endpoint = isEdit ? `/api/sync-configs/${editingSync?.id}` : "/api/sync-configs";

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(syncForm)
      });

      if (res.ok) {
        showFeedback("success", isEdit ? "同步订阅保存成功" : "添加同步任务成功");
        setIsSyncModalOpen(false);
        setEditingSync(null);
        await fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "配置操作失败");
      }
    } catch (e) {
      showFeedback("error", "通信失败");
    }
  };

  const handleDeleteSync = (id: string) => {
    triggerConfirm(
      "删除定时拉取任务",
      "确定移除此自动同步订阅任务么？",
      async () => {
        try {
          const res = await fetch(`/api/sync-configs/${id}`, { method: "DELETE" });
          if (res.ok) {
            showFeedback("success", "订阅已删除");
            await fetchData();
          }
        } catch (e) {
           showFeedback("error", "删除发生问题");
        }
      }
    );
  };

  // Export sync subscriptions as JSON file
  const handleExportSubscriptions = async (e: React.MouseEvent) => {
    downloadApiFile("/api/sync-configs/export", "iptv_sync_subscriptions.json", e);
  };

  // Import sync subscriptions from JSON payload
  const handleImportSubscriptions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importSubscriptionsContent.trim()) {
      showFeedback("error", "请输入或选择 JSON 订阅配置内容");
      return;
    }
    try {
      let configs: any;
      try {
        configs = JSON.parse(importSubscriptionsContent);
      } catch (parseErr) {
        showFeedback("error", "JSON 格式解析错误，请确认数据排版是否合法");
        return;
      }

      const res = await fetch("/api/sync-configs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configs: Array.isArray(configs) ? configs : [configs],
          overwrite: !importSubscriptionsMerge
        })
      });

      if (res.ok) {
        const data = await res.json();
        showFeedback("success", data.message || "成功导入订阅配置");
        setIsImportSubscriptionsOpen(false);
        setImportSubscriptionsContent("");
        await fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "导入失败");
      }
    } catch (err: any) {
      showFeedback("error", `通信失败: ${err.message || err}`);
    }
  };

  // Local/Quick Backup of subscriptions list
  const handleQuickBackupSubscriptions = () => {
    try {
      localStorage.setItem("iptv_sync_configs_backup", JSON.stringify(syncConfigs));
      setIsQuickBackupAvailable(true);
      showFeedback("success", "订阅已成功备份至浏览器缓存 (暂存盘)！");
    } catch (err) {
      showFeedback("error", "快速备份备份失败");
    }
  };

  // Local/Quick Restore of subscriptions list
  const handleQuickRestoreSubscriptions = () => {
    const backupStr = localStorage.getItem("iptv_sync_configs_backup");
    if (!backupStr) {
      showFeedback("error", "暂未找到任何备份记录");
      return;
    }
    triggerConfirm(
      "从本地快速备份还原",
      "您确定要从快速备份还原订阅源吗？这将会合并当前的订阅设置。",
      async () => {
        try {
          const res = await fetch("/api/sync-configs/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              configs: JSON.parse(backupStr),
              overwrite: false // Safe merge
            })
          });

          if (res.ok) {
            showFeedback("success", "订阅源快速恢复成功");
            await fetchData();
          } else {
            showFeedback("error", "快速恢复订阅失败");
          }
        } catch (e) {
          showFeedback("error", "快速恢复通信异常");
        }
      }
    );
  };

  const triggerManualSyncRun = async (id: string) => {
    showFeedback("info", "已启动远程 URL 下载同步解析流程...");
    try {
      const res = await fetch(`/api/sync-configs/${id}/run`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        showFeedback("success", data.message || "手动拉取并同步数据完成");
        await fetchData();
      } else {
        showFeedback("error", data.error || "拉取过程产生错误");
      }
    } catch (e) {
      showFeedback("error", "请求异常，请检查 Github URL 是否通畅");
    }
  };

  const triggerBatchSyncAll = async () => {
    if (isBatchSyncing) return;
    setIsBatchSyncing(true);
    showFeedback("info", "正在对所有已启用的订阅源发起批量同步拉取...");
    try {
      const res = await fetch("/api/sync-configs/run-all", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        showFeedback("success", data.message || "批量订阅同步已顺利完成！");
        await fetchData();
      } else {
        showFeedback("error", data.error || "批量同步发生服务错误");
      }
    } catch (e) {
      showFeedback("error", "网络连接错误，无法完成批量同步");
    } finally {
      setIsBatchSyncing(false);
    }
  };

  const toggleSyncDisabled = async (id: string, currentDisabled: boolean) => {
    try {
      const res = await fetch(`/api/sync-configs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: !currentDisabled })
      });
      if (res.ok) {
        showFeedback("success", `已成功${!currentDisabled ? "禁用" : "启用"}该同步配置！`);
        await fetchData();
      } else {
        showFeedback("error", "更新同步源状态失败");
      }
    } catch (e) {
      showFeedback("error", "网络连接异常，更改同步源状态失败");
    }
  };

  const openSyncCreate = () => {
    setEditingSync(null);
    setSyncForm({
       name: "",
       url: "",
       type: "m3u",
       autoSync: true,
       syncInterval: 12,
       isp: ""
     });
    setIsSyncModalOpen(true);
  };

  // Clean duplicate sources
  const cleanupDuplicateSources = () => {
    triggerConfirm(
      "一键清理重复线路",
      "这将会自动扫描并清理同一个电视频道内链接完全重复的直播源，保留唯一源以减少测速无效流量。确定继续吗？",
      async () => {
        try {
          const res = await fetch("/api/cleanup/duplicates", { method: "POST" });
          const data = await res.json();
          if (res.ok) {
            showFeedback("success", data.message || "重复线路清理完成");
            await fetchData();
          }
        } catch (err) {
          showFeedback("error", "系统交互错误");
        }
      }
    );
  };

  // Clean invalid sources
  const cleanupInvalidSources = () => {
    triggerConfirm(
      "一键清理失效线路",
      "这将会一键清理所有在测速中返回失败 (inactive) 的线路。确定继续吗？",
      async () => {
        try {
          const res = await fetch("/api/cleanup/inactive", { method: "POST" });
          const data = await res.json();
          if (res.ok) {
            showFeedback("success", data.message || "失效源清理完成");
            await fetchData();
          }
        } catch (err) {
          showFeedback("error", "系统交互错误");
        }
      }
    );
  };

  // File manual import (Upload / Paste text)
  const handlePasteImport = async () => {
    if (!pasteContent.trim()) {
      showFeedback("error", "请先粘贴 M3U 或 TXT 直播源文本内容");
      return;
    }
    setIsImportingText(true);
    try {
      const res = await fetch("/api/import/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: pasteContent,
          type: pasteType
        })
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback("success", data.message || "直连导入成功");
        setPasteContent("");
        await fetchData();
      } else {
        showFeedback("error", data.error || "直连导入解析失败");
      }
    } catch (err) {
      showFeedback("error", "提交至后台出错");
    } finally {
      setIsImportingText(false);
    }
  };

  // EPG Program Matches Viewer
  const lookupEPG = async (channel: Channel) => {
    setEpgLoading(true);
    try {
      const res = await fetch(`/api/epg/guide?channelId=${channel.id}`);
      if (res.ok) {
        const data = await res.json();
        setEpgGuide(data);
      } else {
        showFeedback("error", "没有为该频道匹配到相关的 EPG 信息");
      }
    } catch (err) {
      showFeedback("error", "无法加载 EPG 导视表");
    } finally {
      setEpgLoading(false);
    }
  };

  // AI Smart Correction Recommended Generator
  const runAiRecommend = async (channelId: string, channelName: string) => {
    setAiRecommendLoading(true);
    setAiRecommendError("");
    setAiRecommends([]);
    try {
      const res = await fetch("/api/epg/ai-recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, channelName })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAiRecommends(data.recommendations || []);
        if (!data.recommendations || data.recommendations.length === 0) {
          setAiRecommendError("AI 未返回推荐结果。");
        }
      } else {
        setAiRecommendError(data.error || "获取 AI 推荐失败");
      }
    } catch (err) {
      setAiRecommendError("网络连接错误或尚未配置 Gemini API Key");
    } finally {
      setAiRecommendLoading(false);
    }
  };

  // Safe Client-side Downloader to bypass __cookie_check.html in preview environments
  const downloadApiFile = async (endpoint: string, filename: string, e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    try {
      showFeedback("info", `准备下载 ${filename}...`);
      const password = localStorage.getItem("iptv_admin_password") || "";
      const headers: Record<string, string> = {};
      if (password) {
        headers["x-admin-password"] = password;
      }
      const res = await fetch(endpoint, { headers });
      if (!res.ok) {
        throw new Error(`连接失败 (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      showFeedback("success", `文件 ${filename} 下载启动成功`);
    } catch (err: any) {
      console.error("[DOWNLOAD API FILE ERROR]", err);
      showFeedback("error", `下载文件失败: ${err.message || err}`);
    }
  };

  // Filtered Channels selection
  const getUniqueCategories = () => {
    return ["all", ...groups.map(g => g.name)];
  };

  const filteredChannels = channels.filter(c => {
    const groupNames = c.groupIds.map(gId => groups.find(g => g.id === gId)?.name || "").filter(Boolean);
    const cleanQuery = searchQuery.toLowerCase().replace(/[-_.\s]+/g, "");
    const matchesSearch = !cleanQuery ||
                          c.name.toLowerCase().replace(/[-_.\s]+/g, "").includes(cleanQuery) ||
                          c.alias.some(a => a.toLowerCase().replace(/[-_.\s]+/g, "").includes(cleanQuery)) ||
                          groupNames.some(gn => gn.toLowerCase().replace(/[-_.\s]+/g, "").includes(cleanQuery));
    
    const matchesCategory = selectedCategory === "all" || c.groupIds.some(gId => {
      const g = groups.find(gl => gl.id === gId);
      return g && g.name === selectedCategory;
    });
    return matchesSearch && matchesCategory;
  });

  const slicedChannels = useMemo(() => {
    return filteredChannels.slice(0, channelPage * CHANNELS_PER_PAGE);
  }, [filteredChannels, channelPage]);

  const getExportQueries = () => {
    const parts = [];
    if (exportParams.isp) parts.push(`isp=${encodeURIComponent(exportParams.isp)}`);
    if (exportParams.province) parts.push(`province=${encodeURIComponent(exportParams.province)}`);
    if (exportParams.status) parts.push(`status=${encodeURIComponent(exportParams.status)}`);
    if (exportParams.limit) parts.push(`limit=${encodeURIComponent(exportParams.limit)}`);
    return parts.length > 0 ? "?" + parts.join("&") : "";
  };

  const getFullHostUrl = () => {
    // Falls back to current window location if URL is relative
    return `${window.location.protocol}//${window.location.host}`;
  };

  const copyTextToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showFeedback("success", "复制接口成功！已写入剪贴板。");
  };

  if (authChecking) {
    return (
      <div className="w-full min-h-screen bg-slate-900 flex flex-col items-center justify-center text-slate-100 font-sans" id="auth_checking_container">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mb-4" />
        <p className="text-sm font-semibold text-slate-400">正在安全初始化并校验管理会话...</p>
      </div>
    );
  }

  if (isAuthRequired && !isAuthenticated) {
    return (
      <div className="w-full min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans text-slate-100" id="lock_screen_container">
        <div className="max-w-md w-full bg-slate-900/60 rounded-3xl p-8 border border-slate-800 shadow-2xl flex flex-col items-center space-y-6 backdrop-blur-md">
          
          {/* Logo Shield Icon */}
          <div className="w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400 shadow-xl shadow-indigo-500/5 animate-pulse">
            <Shield className="w-8 h-8" />
          </div>
          
          <div className="text-center space-y-2">
            <h1 className="text-xl font-extrabold text-white tracking-tight">管理会话已加锁</h1>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed mx-auto">
              正在保护您的 IPTV 电视直播主板系统目录。请输入校验密码以确认您的管理身份。
            </p>
          </div>
          
          <form onSubmit={handleLogin} className="w-full space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-500 block uppercase tracking-wider">管理密码 (Password)</label>
              <input
                type="password"
                required
                value={adminPasswordInput}
                onChange={(e) => setAdminPasswordInput(e.target.value)}
                placeholder="请输入已设置的管理密码"
                className="w-full p-3.5 bg-slate-950 border border-slate-800 rounded-2xl text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition font-mono placeholder:text-slate-700"
              />
            </div>

            {authError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs font-semibold rounded-xl text-center">
                ⚠️ {authError}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs rounded-2xl transition shadow-lg shadow-indigo-600/20 cursor-pointer text-center block uppercase tracking-wider"
            >
              解锁安全终端
            </button>
          </form>
          
          <div className="text-[10px] text-slate-600 font-mono text-center">
            IPTV Stream Node Control Panel • Secured
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-slate-50 flex overflow-hidden font-sans text-slate-800" id="app_frame">
      {/* Dynamic Slide-in Status / Info Feedback Banner */}
      {feedbackMsg && (
        <div 
          className={`fixed top-4 right-4 z-50 p-4 rounded-xl shadow-lg border flex items-center gap-3 animate-slide-in max-w-sm transition-all duration-300 ${
            feedbackMsg.type === "success" 
            ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
            : feedbackMsg.type === "error" 
            ? "bg-rose-50 border-rose-100 text-rose-800" 
            : "bg-blue-50 border-blue-100 text-blue-800"
          }`}
          id="toast_message"
        >
          {feedbackMsg.type === "success" ? <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : 
           feedbackMsg.type === "error" ? <XCircle className="w-5 h-5 text-rose-600 flex-shrink-0" /> : 
           <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />}
          <p className="text-xs font-semibold">{feedbackMsg.text}</p>
        </div>
      )}

      {/* Primary Sidebar - Styled around Clean Minimalism pattern */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col flex-shrink-0" id="premium_sidebar">
        {/* Brand Header */}
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-base text-slate-900 tracking-tight block">IPTV Stream</span>
              <span className="text-[10px] text-slate-400 font-medium">直播与源管理终端</span>
            </div>
          </div>
        </div>

        {/* Unified Nav Menu */}
        <div className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          <button 
            onClick={() => setActiveTab("dashboard")}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition text-xs font-semibold ${
              activeTab === "dashboard" 
              ? "bg-blue-50/75 text-blue-700 font-bold" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
            id="nav_dashboard"
          >
            <Layers className="w-4 h-4" />
            数据概览 (Overview)
          </button>

          <button 
            onClick={async () => {
              setActiveTab("channels");
              await fetchData();
            }}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition text-xs font-semibold ${
              activeTab === "channels" 
              ? "bg-blue-50/75 text-blue-700 font-bold" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
            id="nav_channels"
          >
            <Tv className="w-4 h-4" />
            频道与线路编辑
          </button>
          
          <button 
            onClick={() => setActiveTab("stats")}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition text-xs font-semibold ${
              activeTab === "stats" 
              ? "bg-blue-50/75 text-blue-700 font-bold" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
            id="nav_stats"
          >
            <Activity className="w-4 h-4" />
            线路质量与统计
          </button>

          <button 
            onClick={() => setActiveTab("sync")}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition text-xs font-semibold ${
              activeTab === "sync" 
              ? "bg-blue-50/75 text-blue-700 font-bold" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
            id="nav_sync"
          >
            <UploadCloud className="w-4 h-4" />
            自动拉取与批量导入
          </button>

          <button 
            onClick={() => setActiveTab("export")}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition text-xs font-semibold ${
              activeTab === "export" 
              ? "bg-blue-50/75 text-blue-700 font-bold" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
            id="nav_export"
          >
            <Download className="w-4 h-4" />
            自定义播放源接口
          </button>

          <button 
            onClick={async () => {
              setActiveTab("epg");
              fetchEpgSources();
            }}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition text-xs font-semibold ${
              activeTab === "epg" 
              ? "bg-blue-50/75 text-blue-700 font-bold" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
            id="nav_epg"
          >
            <Calendar className="w-4 h-4" />
            EPG 节目单同步整合
          </button>

                    <button 
            onClick={() => setActiveTab("cron")}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition text-xs font-semibold ${
              activeTab === "cron" 
              ? "bg-blue-50/75 text-blue-700 font-bold" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
            id="nav_cron"
          >
            <Clock className={`w-4 h-4 ${activeTab === "cron" ? "text-blue-500" : "text-slate-400"}`} />
            定时任务设置
          </button>

          <button 
            onClick={() => setActiveTab("backup")}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition text-xs font-semibold ${
              activeTab === "backup" 
              ? "bg-blue-50/75 text-blue-700 font-bold" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
            id="nav_backup"
          >
            <Database className="w-4 h-4" />
            系统备份与恢复管理
          </button>

          <button 
            onClick={async () => {
              setPasswordForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
              setIsSettingPasswordModalOpen(true);
            }}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition text-xs text-left font-semibold ${
              isAuthRequired 
              ? "bg-indigo-50/40 text-indigo-700 hover:bg-indigo-50 border border-indigo-100" 
              : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
            }`}
            id="nav_security"
            type="button"
          >
            <span className="flex items-center gap-3.5">
              <Shield className="w-4 h-4" />
              安全密码保护
            </span>
            <span className={`text-[10px] scale-90 px-1.5 py-0.5 rounded font-black ${isAuthRequired ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-500"}`}>
              {isAuthRequired ? "启用" : "未设"}
            </span>
          </button>
        </div>


      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header - Structured according to Clean Minimalism Design mockup */}
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between flex-shrink-0" id="top_header">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold text-slate-800">
              {activeTab === "dashboard" && "直播管理中心一览 (Dashboard)"}
              {activeTab === "channels" && "频道列表与线路维护中心"}
              {activeTab === "stats" && "线路质量与统计分析 (Stream Statistics)"}
              {activeTab === "sync" && "M3U / TXT 网络同步订阅与自定义文件导入"}
              {activeTab === "export" && "播放接口配置生成工具"}
              {activeTab === "epg" && "EPG XML 国际电视频道节目单同步与多源整合合并中心"}
              {activeTab === "backup" && "数据备份与系统完整恢复"}
              {activeTab === "cron" && "自动化定时任务管理 (EPG & 订阅源)"}
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Realtime test action banner */}
            {testingStatus.status === "running" ? (
              <div className="flex items-center gap-3 text-xs text-amber-600 bg-amber-50/85 px-3.5 py-1.5 border border-amber-100 rounded-full font-bold">
                <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping"></span>
                <span>正在高并发多线程检测: {testingStatus.checked} / {testingStatus.total} 线路</span>
                <button 
                  onClick={cancelTest}
                  className="bg-rose-100 hover:bg-rose-200 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded-full transition"
                >
                  放弃测速
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-100/75 px-3 py-1.5 rounded-full font-semibold">
                <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                自动心跳同步: 已启用 (每分)
              </div>
            )}

            <button 
              id="top_pulse_speed_btn"
              disabled={testingStatus.status === "running"}
              onClick={triggerConcurrentBulkTest}
              className={`text-slate-50 px-4 py-2 rounded-xl text-xs font-bold border border-transparent shadow shadow-blue-500/10 transition leading-none flex items-center ${
                testingStatus.status === "running"
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 cursor-pointer"
              }`}
            >
              <Activity className="w-3.5 h-3.5 mr-1.5" />
              一键并发测速
            </button>
          </div>
        </header>

        {/* Dynamic Content Outlet with custom vertical scrolling limits */}
        <div className="flex-1 overflow-y-auto p-8" id="content_canvas_outer">
          
          {/* VIEW: DASHBOARD */}
          {activeTab === "dashboard" && (
            <DashboardView 
              channels={channels}
              syncConfigs={syncConfigs}
              onNavigate={(view) => setActiveTab(view)}
              onTriggerTest={triggerConcurrentBulkTest}
              testingStatus={testingStatus.status}
            />
          )}

          {activeTab === "stats" && (
            <StatsView channels={channels} />
          )}
          
          {/* VIEW: CHANNELS & SOURCE EDITOR */}
          {activeTab === "channels" && (
            <div className="space-y-6 animate-fade-in" id="tab_channels_view">
              
              {/* Inner sub-tab selection */}
              <div className="flex gap-2.5">
                <button
                  onClick={() => setChannelSubTab("channels")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    channelSubTab === "channels"
                    ? "bg-slate-800 text-white shadow-md shadow-slate-900/10"
                    : "bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200"
                  }`}
                >
                  <Tv className="w-3.5 h-3.5" />
                  频道与线路维护
                </button>
                <button
                  onClick={() => setChannelSubTab("groups")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    channelSubTab === "groups"
                    ? "bg-slate-800 text-white shadow-md shadow-slate-900/10"
                    : "bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  分组/分类管理 (多对多)
                </button>
                <button
                  onClick={() => setChannelSubTab("sources")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    channelSubTab === "sources"
                    ? "bg-slate-800 text-white shadow-md shadow-slate-900/10"
                    : "bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200"
                  }`}
                >
                  <Compass className="w-3.5 h-3.5" />
                  全局线路与批量管理
                </button>
              </div>

              {channelSubTab === "groups" && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6 animate-fade-in" id="groups_manager_container">
                  <div className="max-w-md space-y-3">
                    <h3 className="font-bold text-slate-800 text-sm">👥 新建或编辑分组/分类</h3>
                    <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
                      分组采用多对多（Many-to-Many）设计，频道可以归属于零个、一个或多个分组。删除分组不会删除对应的频道本身，该频道会自动关联默认备用分组。
                    </p>
                    
                    <form 
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const target = e.currentTarget;
                        const formData = new FormData(target);
                        const name = formData.get("name") as string;
                        if (!name) return;
                        
                        try {
                          const res = await fetch("/api/groups", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name })
                          });
                          if (res.ok) {
                            showFeedback("success", "分组创建成功！");
                            target.reset();
                            await fetchData();
                          } else {
                            const err = await res.json();
                            showFeedback("error", err.error || "创建分组失败");
                          }
                        } catch (err) {
                          showFeedback("error", "网络连接异常");
                        }
                      }}
                      className="flex gap-3 pt-1"
                    >
                      <input 
                        type="text" 
                        name="name" 
                        required 
                        placeholder="输入新分组名称, 如: 4K超清, 山东专区"
                        className="flex-1 text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-indigo-500 font-bold"
                      />
                      <button 
                        type="submit"
                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition cursor-pointer"
                      >
                        创建分组
                      </button>
                    </form>
                  </div>

                  <div className="border-t border-slate-100 pt-6 space-y-4">
                    <h4 className="font-bold text-slate-800 text-xs">已存在的实体直播分组目录 ({groups.length} 个)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="groups_cards_grid">
                      {groups.map((g) => {
                        const countChannels = channels.filter(c => c.groupIds.includes(g.id)).length;
                        return (
                          <div key={g.id} className="p-4 border border-slate-200 rounded-2xl bg-slate-50/50 flex items-center justify-between hover:border-slate-350 transition" id={`group_item_${g.id}`}>
                            <div className="space-y-1 pr-4 flex-1">
                              <input 
                                type="text"
                                defaultValue={g.name}
                                onBlur={async (e) => {
                                  const val = e.target.value.trim();
                                  if (!val || val === g.name) return;
                                  try {
                                    const res = await fetch(`/api/groups/${g.id}`, {
                                      method: "PUT",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ name: val })
                                    });
                                    if (res.ok) {
                                      showFeedback("success", "分组改名成功！");
                                      await fetchData();
                                    } else {
                                      e.target.value = g.name; // reset
                                      showFeedback("error", "改名失败");
                                    }
                                  } catch (err) {
                                    e.target.value = g.name;
                                    showFeedback("error", "网络故障");
                                  }
                                }}
                                className="font-bold text-slate-800 text-xs bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none hover:bg-slate-200/45 p-0.5 rounded transition w-full font-semibold"
                              />
                              <p className="text-[10px] text-slate-400 font-medium">关联频道: <span className="font-mono text-slate-600 font-bold">{countChannels}</span> 个</p>
                            </div>

                            <div className="flex flex-col items-center gap-1 mr-2">
                              <button
                                onClick={() => handleMoveGroup(groups.findIndex(x => x.id === g.id), 'up')}
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                                title="上移"
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleMoveGroup(groups.findIndex(x => x.id === g.id), 'down')}
                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                                title="下移"
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            </div>

                            <button
                              onClick={async () => {
                                if (g.id === "g_other" || g.name === "其它频道") {
                                  showFeedback("error", "系统保护的内置备用分组，无法被手动删除");
                                  return;
                                }
                                triggerConfirm(
                                  "删除分组",
                                  `确定要删除 [${g.name}] 分组吗？所属频道不会被删除，它们会自动脱离关联分组。`,
                                  async () => {
                                    try {
                                      const res = await fetch(`/api/groups/${g.id}`, { method: "DELETE" });
                                      if (res.ok) {
                                        showFeedback("success", "分组删除成功");
                                        await fetchData();
                                      } else {
                                        showFeedback("error", "删除失败");
                                      }
                                    } catch (e) {
                                      showFeedback("error", "网络故障");
                                    }
                                  }
                                );
                              }}
                              className="p-2 bg-white hover:bg-rose-50 border border-slate-250 text-slate-400 hover:text-rose-600 rounded-xl transition shadow-xs cursor-pointer"
                              title="删除此分组"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {channelSubTab === "channels" && (
                <div className="space-y-6 animate-fade-in" id="groups_inner_channels_pane">
                  {/* Filter tools and Header bar */}
                  <div className="flex flex-col md:flex-row gap-4 justify-between" id="channel_filter_panel">
                <div className="flex flex-1 flex-wrap gap-2.5">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="搜索频道、标签、别名..."
                      className="pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs bg-white w-56 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Category tag Selector pill */}
                  <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1" id="category_pills">
                    <Filter className="w-3.5 h-3.5 text-slate-400 mr-1" />
                    {getUniqueCategories().map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                          selectedCategory === cat 
                          ? "bg-blue-600 text-white" 
                          : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                        }`}
                      >
                        {cat === "all" ? "全部类型" : cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={cleanupDuplicateSources}
                    className="px-3.5 py-2 border border-orange-200 text-orange-600 hover:bg-orange-50 text-[11px] font-bold rounded-xl transition cursor-pointer flex items-center"
                  >
                    <Zap className="w-3.5 h-3.5 mr-1" />
                    清理重复源
                  </button>
                  <button 
                    onClick={cleanupInvalidSources}
                    className="px-3.5 py-2 border border-rose-200 text-rose-600 hover:bg-rose-50 text-[11px] font-bold rounded-xl transition cursor-pointer flex items-center"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    清理失效源
                  </button>
                  <button 
                    onClick={openChannelCreate}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-xl shadow-md transition cursor-pointer flex items-center"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    添加新频道
                  </button>
                </div>
              </div>

              {/* Dynamic split row grids layout */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="channels_editor_grid">
                
                {/* Left side list of channels */}
                <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 flex flex-col h-[520px] overflow-hidden" id="channels_list_card">
                  <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-2.5">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                          checked={filteredChannels.length > 0 && filteredChannels.every(ch => selectedChannelIds.includes(ch.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const idsToSelect = filteredChannels.map(ch => ch.id);
                              setSelectedChannelIds(prev => Array.from(new Set([...prev, ...idsToSelect])));
                            } else {
                              const idsToDeselect = filteredChannels.map(ch => ch.id);
                              setSelectedChannelIds(prev => prev.filter(id => !idsToDeselect.includes(id)));
                            }
                          }}
                        />
                        <span className="text-xs font-bold text-slate-700">共匹配 {filteredChannels.length} 个频道</span>
                      </div>
                      <span className="text-[10px] text-slate-400">点击任意项管理播放源</span>
                    </div>

                    {selectedChannelIds.length > 0 && (
                      <div className="flex items-center justify-between bg-blue-50/80 border border-blue-100 rounded-xl px-2.5 py-1.5 transition-all duration-200">
                        <span className="text-[10px] font-bold text-blue-700">已选 {selectedChannelIds.length} 个项目</span>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => openBatchGroupModal()}
                            className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition shadow-xs cursor-pointer flex items-center gap-1"
                          >
                            <Layers className="w-3 h-3" />
                            批量分组
                          </button>
                          {selectedCategory !== "all" && (
                            <button
                              onClick={handleBatchRemoveFromGroup}
                              className="bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition shadow-xs cursor-pointer flex items-center gap-1"
                            >
                              <XCircle className="w-3 h-3" />
                              移出分组
                            </button>
                          )}
                          <button
                            onClick={() => handleBatchDelete()}
                            className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition shadow-xs cursor-pointer flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            批量删除
                          </button>
                          {selectedChannelIds.length >= 2 && (
                            <button
                              onClick={handleBatchMerge}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition shadow-xs cursor-pointer flex items-center gap-1"
                            >
                              <GitMerge className="w-3 h-3" />
                              合并选中频道
                            </button>
                          )}
                          <button
                            onClick={() => setSelectedChannelIds([])}
                            className="bg-slate-200 hover:bg-slate-300 text-slate-600 text-[10px] font-bold px-2 py-1 rounded-lg transition cursor-pointer"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {filteredChannels.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-12 text-slate-300">
                        <Tv className="w-16 h-16 stroke-[1]" />
                        <p className="text-xs font-medium mt-3">未检索到适配该条件的电视频道</p>
                      </div>
                    ) : (
                      slicedChannels.map((ch) => {
                        const isSelected = selectedChannel?.id === ch.id;
                        const isChecked = selectedChannelIds.includes(ch.id);
                        const activeCount = ch.sources.filter(s => s.status === "active").length;
                        return (
                          <div 
                            key={ch.id}
                            onClick={async () => {
                              setSelectedChannel(ch);
                              setEpgGuide(null); // Clear EPG view since state modified
                              setSelectedSourceIds([]); // Clear source selection
                            }}
                            onDoubleClick={() => {
                              openChannelEdit(ch);
                            }}
                            className={`p-3.5 transition flex items-center justify-between cursor-pointer ${
                              isSelected ? "bg-blue-50/60 border-l-4 border-blue-600" : "hover:bg-slate-55/40"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer flex-shrink-0"
                                checked={isChecked}
                                onClick={(e) => {
                                  e.stopPropagation();
                                }}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedChannelIds(prev => [...prev, ch.id]);
                                  } else {
                                    setSelectedChannelIds(prev => prev.filter(id => id !== ch.id));
                                  }
                                }}
                              />
                              {ch.logo ? (
                                <img
                                  src={ch.logo}
                                  alt="logo"
                                  className="w-8 h-8 rounded-lg object-contain bg-slate-100 p-0.5 shadow-xs flex-shrink-0"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0 text-slate-400 shadow-xs">
                                  <Tv className="w-4 h-4" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5 truncate">
                                  {ch.name}
                                </p>
                                <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                                  EPG ID: <span className="font-mono text-[9px] text-slate-500 font-bold bg-slate-100 px-1 py-0.5 rounded">{ch.epgId}</span>
                                </p>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              {/* Count pill badge */}
                              <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                                {activeCount} / {ch.sources.length} 条有效
                              </span>
                              <span className="text-[10px] font-semibold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded max-w-28 truncate" title={ch.groupIds.map(gId => groups.find(g => g.id === gId)?.name).filter(Boolean).join(", ")}>
                                {ch.groupIds.map(gId => groups.find(g => g.id === gId)?.name).filter(Boolean).join(", ") || "其它"}
                              </span>

                              {/* Small Quick Action Panel */}
                              <div className="flex gap-1.5">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveChannel(ch.id, 'up');
                                  }}
                                  className="p-1 hover:bg-slate-100 text-slate-400 hover:text-indigo-600 rounded transition"
                                  title="上移"
                                >
                                  <ChevronUp className="w-3 h-3" />
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveChannel(ch.id, 'down');
                                  }}
                                  className="p-1 hover:bg-slate-100 text-slate-400 hover:text-indigo-600 rounded transition"
                                  title="下移"
                                >
                                  <ChevronDown className="w-3 h-3" />
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openChannelEdit(ch);
                                  }}
                                  className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-800 rounded transition"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteChannel(ch.id);
                                  }}
                                  className="p-1 hover:bg-slate-100 text-red-500 hover:text-red-700 rounded transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    {filteredChannels.length > slicedChannels.length && (
                      <div className="p-4 text-center bg-slate-50/50 border-t border-slate-100">
                        <button
                          onClick={() => setChannelPage(prev => prev + 1)}
                          className="text-[11px] font-black text-blue-600 hover:text-blue-700 bg-blue-50/80 hover:bg-blue-100 px-4 py-2 rounded-xl transition cursor-pointer"
                        >
                          显示更多频道 (已显示 {slicedChannels.length} / 共 {filteredChannels.length} 条)
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side playback playline items details view */}
                <div className="lg:col-span-7 space-y-4" id="stream_lines_control_container">
                  {selectedChannel ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5" id="line_manager_main">
                      
                      {/* Sub header for channel detail view */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                          {selectedChannel.logo ? (
                              <img 
                                src={selectedChannel.logo} 
                                alt="logo" 
                                className="w-10 h-10 rounded-xl object-contain bg-slate-50 border border-slate-100 p-1 shadow-sm" 
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 shadow-sm">
                                <Tv className="w-5 h-5" />
                              </div>
                            )}
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-slate-800 text-sm leading-tight">{selectedChannel.name}</h3>
                              <span className="bg-slate-100 text-[10px] text-slate-600 px-2 py-0.5 rounded">
                                {selectedChannel.groupIds.map(gId => groups.find(g => g.id === gId)?.name).filter(Boolean).join(", ") || "其它"}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">
                              别名(Aliases): <span className="font-mono bg-slate-50 px-1 rounded">{selectedChannel.alias.join(" / ") || "无"}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-2.5">
                          <button
                            onClick={() => lookupEPG(selectedChannel)}
                            disabled={epgLoading}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold px-3 py-1.5 rounded-xl transition cursor-pointer flex items-center"
                          >
                            <Calendar className="w-3.5 h-3.5 mr-1" />
                            {epgLoading ? "正在载入EPG..." : "匹配 EPG 导视预览"}
                          </button>
                          <button
                            onClick={openSourceCreate}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3.5 py-1.5 rounded-xl transition shadow flex items-center cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            新增加播线路
                          </button>
                        </div>
                      </div>

                      {/* Dynamic EPG timeline drawer if requested */}
                      {epgGuide && (
                        <div className="bg-indigo-50/40 p-4 rounded-xl border border-indigo-100 space-y-3" id="epg_preview_box">
                          <div className="flex justify-between items-center text-xs font-bold text-slate-700">
                            <span className="flex items-center gap-1.5 flex-wrap">
                              <Clock className="w-4 h-4 mr-1 text-indigo-600" />
                              EPG 实时节目导视表 [ {epgGuide.epgId} ]
                              {epgGuide.isSimulated && (
                                <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 text-[9px] rounded font-bold flex items-center shrink-0">
                                  ⚠️ 未成功匹配外部源 (使用本地默认模版模拟)
                                </span>
                              )}
                            </span>
                            <button className="text-[10px] text-slate-400 font-semibold cursor-pointer" onClick={()=>setEpgGuide(null)}>关闭预览</button>
                          </div>

                          {epgGuide.isSimulated && selectedChannel && (
                            <div className="bg-amber-50/60 p-3 rounded-lg border border-amber-100/60 text-xs text-amber-800 space-y-2">
                              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                                <span><b>智能校准提示：</b>当前的外部 EPG ID (<b>{epgGuide.epgId}</b>) 尚未能在启用的外部源中检索到今日节目数据。您可以使用 Gemini AI 基于频道名智能校正匹配。</span>
                                <button 
                                  onClick={() => runAiRecommend(selectedChannel.id, selectedChannel.name)}
                                  disabled={aiRecommendLoading}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] px-3 py-1.5 rounded-lg transition flex items-center shrink-0 disabled:bg-slate-300 cursor-pointer"
                                >
                                  {aiRecommendLoading ? "🤖 AI正在搜寻中..." : "🤖 启动 AI 智能校准纠错"}
                                </button>
                              </div>
                              
                              {aiRecommendError && (
                                <p className="text-[10px] text-rose-600 font-bold bg-rose-55 p-1 px-2 rounded">{aiRecommendError}</p>
                              )}

                              {aiRecommends.length > 0 && (
                                <div className="space-y-1.5 pt-1">
                                  <p className="text-[10px] font-bold text-indigo-800">Gemini AI 为您智能解析推荐的最佳匹配（点击直接自动更正并保存）：</p>
                                  <div className="flex flex-col gap-1.5">
                                    {aiRecommends.map((rec) => (
                                      <div 
                                        key={rec.epgId}
                                        onClick={async () => {
                                          try {
                                            const res = await fetch(`/api/channels/${selectedChannel.id}`, {
                                              method: "PUT",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ epgId: rec.epgId })
                                            });
                                            if (res.ok) {
                                              showFeedback("success", `EPG ID 已成功纠正为 "${rec.epgId}"`);
                                              setAiRecommends([]);
                                              await fetchData();
                                              const updatedCh = { ...selectedChannel, epgId: rec.epgId };
                                              setSelectedChannel(updatedCh);
                                              // Immediately re-trigger fetching with newly saved channel values
                                              const previewRes = await fetch(`/api/epg/guide?channelId=${selectedChannel.id}`);
                                              if (previewRes.ok) {
                                                const previewData = await previewRes.json();
                                                setEpgGuide(previewData);
                                              }
                                            } else {
                                              showFeedback("error", "更新失败");
                                            }
                                          } catch (_) {
                                            showFeedback("error", "网络连接异常");
                                          }
                                        }}
                                        className="bg-white hover:bg-indigo-50 p-2 rounded-lg border border-indigo-100 flex justify-between items-center transition cursor-pointer hover:scale-[1.005]"
                                      >
                                        <div className="space-y-0.5">
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-mono text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{rec.epgId}</span>
                                            <span className="font-bold text-slate-705 text-[10px]">({rec.displayName})</span>
                                          </div>
                                          <p className="text-[9px] text-slate-500">{rec.reason}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-0.5 shrink-0 ml-1">
                                          <span className="text-[8px] bg-emerald-50 text-emerald-700 font-bold px-1 rounded-sm">
                                            置信度: {(rec.confidence * 100).toFixed(0)}%
                                          </span>
                                          <span className="text-[8px] text-indigo-500 font-semibold">点击一键应用并重新加载 ❯</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-48 overflow-y-auto pt-1">
                            {epgGuide.programs.map((p, idx) => (
                              <div key={idx} className="p-2 bg-white rounded-lg border border-indigo-100/40 flex flex-col justify-between">
                                <span className="font-mono text-[9px] font-bold text-indigo-600">{p.time}</span>
                                <span className="text-[11px] font-semibold text-slate-700 truncate block mt-0.5">{p.title}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Display playback source lines */}
                      <div className="space-y-3" id="sources_panel_list">
                        <div className="flex flex-col gap-2.5">
                          <div className="flex justify-between items-center bg-slate-50/50 p-2.5 rounded-xl border border-slate-100">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                                checked={selectedChannel.sources.length > 0 && selectedChannel.sources.every(src => selectedSourceIds.includes(src.id))}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    const idsToSelect = selectedChannel.sources.map(src => src.id);
                                    setSelectedSourceIds(prev => Array.from(new Set([...prev, ...idsToSelect])));
                                  } else {
                                    const idsToDeselect = selectedChannel.sources.map(src => src.id);
                                    setSelectedSourceIds(prev => prev.filter(id => !idsToDeselect.includes(id)));
                                  }
                                }}
                              />
                              {(() => {
                                const filteredCount = selectedChannel.sources.filter(src => {
                                  if (sourceFilterStatus === "all") return !src.isolated;
                                  if (sourceFilterStatus === "all_with_isolated") return true;
                                  if (sourceFilterStatus === "isolated") return src.isolated;
                                  if (src.isolated) return false;
                                  return src.status === sourceFilterStatus || (sourceFilterStatus === "unknown" && src.status === "checking");
                                }).length;
                                return (
                                  <span className="text-xs font-bold text-slate-500">已接入线路列表 ({filteredCount} 条)</span>
                                );
                              })()}
                            </div>
                            <select
                              value={sourceFilterStatus}
                              onChange={(e) => setSourceFilterStatus(e.target.value as any)}
                              className="text-xs border-slate-200 rounded px-2 py-1 bg-white outline-none focus:border-blue-400"
                            >
                              <option value="all">全部状态 (默认)</option>
                              <option value="all_with_isolated">全部 (含已隔离)</option>
                              <option value="active">有效/可用</option>
                              <option value="inactive">失效/离线</option>
                              <option value="unknown">未测试</option>
                              <option value="isolated">已隔离 (软删除)</option>
                            </select>
                          </div>

                          {selectedSourceIds.length > 0 && (
                            <div className="flex items-center justify-between bg-emerald-50/80 border border-emerald-100 rounded-xl px-2.5 py-1.5 transition-all duration-200 animate-slide-in">
                              <span className="text-[10px] font-bold text-emerald-700">已选 {selectedSourceIds.length} 条线路</span>
                              <div className="flex gap-1.5 animate-fade-in">
                                <button
                                  onClick={() => openBatchSourceEditModal()}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition shadow-xs cursor-pointer flex items-center gap-1"
                                >
                                  <Layers className="w-3.5 h-3.5" />
                                  批量修改 ISP/省份
                                </button>
                                <button
                                  onClick={() => handleBatchSourceDelete()}
                                  className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition shadow-xs cursor-pointer flex items-center gap-1"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  批量删除
                                </button>
                                <button
                                  onClick={() => setSelectedSourceIds([])}
                                  className="bg-slate-200 hover:bg-slate-300 text-slate-600 text-[10px] font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        
                        {selectedChannel.sources.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-16 text-slate-350 border border-dashed rounded-2xl border-slate-200">
                            <Compass className="w-12 h-12 stroke-[1]" />
                            <p className="text-xs font-medium mt-1">此频道没有任何直播线路，点击上方按钮新增</p>
                          </div>
                        ) : (
                          <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
                            {selectedChannel.sources.filter(src => {
                                if (sourceFilterStatus === "all") return !src.isolated;
                                if (sourceFilterStatus === "all_with_isolated") return true;
                                if (sourceFilterStatus === "isolated") return src.isolated;
                                if (src.isolated) return false;
                                return src.status === sourceFilterStatus || (sourceFilterStatus === "unknown" && src.status === "checking");
                              }).map((src, index) => {
                              const isChecked = selectedSourceIds.includes(src.id);
                              return (
                                <div 
                                  key={src.id} 
                                  className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors ${
                                    isChecked ? "bg-blue-50/20 border-blue-200" :
                                    src.status === "active" ? "bg-emerald-50/15 border-emerald-100" :
                                    src.isolated ? "bg-orange-50/20 border-orange-200 opacity-75" :
                                    src.status === "inactive" ? "bg-rose-50/15 border-rose-100" : "bg-slate-50/30 border-slate-200"
                                  }`}
                                >
                                  <div className="min-w-0 flex-1 flex items-center gap-3">
                                    <input
                                      type="checkbox"
                                      className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer flex-shrink-0"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedSourceIds(prev => [...prev, src.id]);
                                        } else {
                                          setSelectedSourceIds(prev => prev.filter(id => id !== src.id));
                                        }
                                      }}
                                    />
                                    <div className="min-w-0 flex-1 space-y-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-bold text-slate-400 font-mono select-none">#{index + 1}</span>
                                        <span className="bg-slate-100 text-slate-705 font-semibold px-1.5 py-0.5 rounded text-[10px]">
                                          {src.province}
                                        </span>
                                        <span className={`font-semibold px-2 py-0.5 rounded text-[10px] ${
                                          src.isp === "电信" ? "bg-blue-50 text-blue-700" : 
                                          src.isp === "移动" ? "bg-green-50 text-green-700" : 
                                          src.isp === "联通" ? "bg-orange-50 text-orange-700" : "bg-slate-100 text-slate-600"
                                        }`}>
                                          {src.isp}
                                        </span>
                                        
                                        {/* Connectivity Latency Status Pill */}
                                        {src.status === "active" && (
                                          <span className="text-emerald-700 font-bold bg-emerald-100/50 px-1.5 py-0.5 rounded text-[10px] font-mono inline-flex items-center gap-1">
                                            <span>有效/可用</span>
                                            {src.latency !== undefined && <span className="bg-emerald-200/50 px-1 rounded text-emerald-800">{src.latency}ms</span>}
                                            {src.testCount !== undefined && src.testCount > 0 && src.successCount !== undefined && (
                                              <span className="text-emerald-600 border border-emerald-200/50 px-1 rounded" title={`测试 ${src.testCount} 次，成功 ${src.successCount} 次`}>
                                                可靠度 {Math.round((src.successCount / src.testCount) * 100)}%
                                              </span>
                                            )}
                                          </span>
                                        )}
                                        {src.status === "inactive" && (
                                          <span className="text-rose-700 font-bold bg-rose-100/50 px-1.5 py-0.5 rounded text-[10px]">
                                            失效/离线
                                          </span>
                                        )}
                                        {src.status === "checking" && (
                                          <span className="text-blue-700 font-bold bg-blue-100 animate-pulse px-1.5 py-0.5 rounded text-[10px]">
                                            测试中
                                          </span>
                                        )}
                                        {src.status === "unknown" && (
                                          <span className="text-slate-500 font-bold bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">
                                            未测试
                                          </span>
                                        )}
                                        {src.isolated && (
                                          <span className="text-orange-700 font-bold bg-orange-100 px-1.5 py-0.5 rounded text-[10px]">
                                            已隔离
                                          </span>
                                        )}
                                      </div>
                                      
                                      <p className="font-mono text-[10px] text-slate-500 truncate select-all">{src.url}</p>
                                    </div>
                                  </div>

                                  <div className="flex gap-2 flex-shrink-0 self-end sm:self-auto items-center">
                                    <button 
                                      onClick={() => openSourceEdit(src)}
                                      className="p-2 border border-slate-200 hover:border-slate-350 bg-white rounded-lg hover:bg-slate-50 transition text-slate-600 p-1.5"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    {src.isolated ? (
                                      <button
                                        onClick={() => handleIsolateSource(src.id, false)}
                                        title="恢复线路"
                                        className="p-2 border border-emerald-200 hover:border-emerald-350 bg-white rounded-lg hover:bg-emerald-50 transition text-emerald-600 p-1.5"
                                      >
                                        <ArchiveRestore className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleIsolateSource(src.id, true)}
                                        title="软删除隔离(禁止自动同步此地址)"
                                        className="p-2 border border-orange-200 hover:border-orange-350 bg-white rounded-lg hover:bg-orange-50 transition text-orange-500 p-1.5"
                                      >
                                        <Archive className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button 
                                      onClick={() => handleDeleteSource(src.id)}
                                      title="彻底删除"
                                      className="p-2 border border-rose-200 hover:border-rose-350 bg-white rounded-lg hover:bg-rose-50 transition text-rose-500 p-1.5"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-300 flex flex-col items-center justify-center min-h-[400px]" id="no_channel_selected">
                      <Tv className="w-16 h-16 stroke-[1.2] opacity-50 mb-3" />
                      <p className="text-xs font-semibold">请先在左侧频道列表中选定一个频道</p>
                      <p className="text-[11px] text-slate-400 mt-1">选定后，你可以为其增加直播线路、匹配预览 EPG 或批量删除线路。</p>
                    </div>
                  )}
                </div>

              </div>
              </div>
              )}

              {channelSubTab === "sources" && (
                <div className="space-y-6 animate-fade-in" id="global_sources_pane">
                  {/* Top Stats Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4" id="global_sources_stats">
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">当前匹配总线路</span>
                        <div className="text-xl font-black text-slate-800 mt-1 font-mono">{filteredGlobalSources.length} <span className="text-xs text-slate-500 font-sans">条</span></div>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-600 flex items-center justify-center border border-slate-100">
                        <Compass className="w-5 h-5" />
                      </div>
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">有效/可用线路</span>
                        <div className="text-xl font-black text-emerald-600 mt-1 font-mono">
                          {filteredGlobalSources.filter(s => s.status === "active").length} <span className="text-xs text-slate-500 font-sans">条</span>
                        </div>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                        <CheckCircle className="w-5 h-5" />
                      </div>
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">失效/离线线路</span>
                        <div className="text-xl font-black text-rose-600 mt-1 font-mono">
                          {filteredGlobalSources.filter(s => s.status === "inactive").length} <span className="text-xs text-slate-500 font-sans">条</span>
                        </div>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100">
                        <XCircle className="w-5 h-5" />
                      </div>
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">测试中/未测试线路</span>
                        <div className="text-xl font-black text-amber-600 mt-1 font-mono">
                          {filteredGlobalSources.filter(s => s.status === "checking" || s.status === "unknown").length} <span className="text-xs text-slate-500 font-sans">条</span>
                        </div>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
                        <Activity className="w-5 h-5" />
                      </div>
                    </div>
                  </div>

                  {/* 双驱多维度 ISP 测速工作区 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-200" id="double_speed_test_center">
                    
                    {/* 方案一 Column: 服务端极速多线程测速 */}
                    <div className="bg-white p-5 rounded-xl border border-slate-150 shadow-xs flex flex-col justify-between space-y-4" id="server_side_test_scheme">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs font-mono">①</span>
                          <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5 leading-snug">
                            <Layers className="w-4 h-4 text-indigo-550 shrink-0" />
                            方案一：服务端全网异步多线程测速（默认云端策略）
                          </h4>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
                          利用云端高带宽服务器容器，直接下发全局异步并发测速任务。可以通过下方的高级过滤器或选择列表精确隔离某一特定 ISP 线路进行分类发起！
                        </p>
                      </div>

                      <div className="bg-slate-50/60 p-4 rounded-xl space-y-3.5 border border-slate-100 text-xs text-slate-650">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                          <span className="font-bold text-[11px] text-slate-600">并发线程数 (Concurrency)：</span>
                          <div className="flex gap-1 shrink-0">
                            {[4, 8, 16, 24, 32].map((num) => (
                              <button
                                key={num}
                                onClick={() => setClientThreadCount(num)}
                                className={`px-2 py-0.5 rounded text-[10px] font-black transition cursor-pointer ${
                                  clientThreadCount === num ? "bg-indigo-600 text-white" : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"
                                }`}
                              >
                                {num}
                              </button>
                            ))}
                          </div>
                        </div>

                        {testingStatus.status === "running" ? (
                          <div className="space-y-2 py-1 animate-pulse">
                            <div className="flex justify-between items-center text-[10px] font-black text-indigo-700">
                              <span className="flex items-center gap-1">
                                <Activity className="w-3.5 h-3.5 animate-spin text-indigo-550" />
                                正在执行后端云测速中...
                              </span>
                              <span>{testingStatus.checked} / {testingStatus.total} ({Math.round((testingStatus.checked / (testingStatus.total || 1)) * 100)}%)</span>
                            </div>
                            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                              <div 
                                className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                                style={{ width: `${(testingStatus.checked / (testingStatus.total || 1)) * 100}%` }}
                              />
                            </div>
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch("/api/sources/test-cancel", { method: "POST" });
                                  if (res.ok) showFeedback("success", "已向后台终止测速");
                                } catch (_) {}
                              }}
                              className="w-full py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[10px] font-black rounded-lg transition text-center cursor-pointer"
                            >
                              🛑 强行终止云测速任务
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 pt-1">
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch("/api/sources/test", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      concurrency: clientThreadCount,
                                      isp: globalSourceIsp,
                                      province: globalSourceProvince,
                                      status: globalSourceStatus,
                                      sourceIds: selectedGlobalSourceIds.length > 0 ? selectedGlobalSourceIds : undefined
                                    })
                                  });
                                  if (res.ok) {
                                    showFeedback("success", "已成功向后台发送过滤线路并发测速命令！");
                                    setSelectedGlobalSourceIds([]);
                                  } else {
                                    const err = await res.json();
                                    showFeedback("error", err.error || "提发测速失败");
                                  }
                                } catch (_) {
                                  showFeedback("error", "连接故障");
                                }
                              }}
                              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl transition cursor-pointer shadow-md shadow-indigo-150 flex items-center justify-center gap-1.5"
                            >
                              <Zap className="w-4 h-4" />
                              {selectedGlobalSourceIds.length > 0 
                                ? `针对已选 ${selectedGlobalSourceIds.length} 条线路发起服务端测速` 
                                : "针对当前过滤器匹配的所有线路下发测速"}
                            </button>
                            <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                              💡 高频技巧：通过下方过滤器框选特定运营商或特定地域省份后，点按此按钮将只对该子类别的线路执行云测试。
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 方案二 Column: 客户端浏览器探针代测 */}
                    <div className="bg-white p-5 rounded-xl border border-slate-150 shadow-xs flex flex-col justify-between space-y-4" id="client_side_test_scheme">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center font-bold text-xs font-mono">②</span>
                            <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5 leading-snug">
                              <Compass className="w-4 h-4 text-sky-500 shrink-0" />
                              方案二：本地浏览器探针代测（极星边缘探测网络）
                            </h4>
                          </div>
                          <span className="text-[9px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-bold">100% 契合播本地</span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
                          在您的本地电脑/播放器上直接发起底层探测，完美测量您的家庭宽带（或特定城市段）向对端 IPTV 源的真实握手延迟。支持一键上报云端同步使生效。
                        </p>
                      </div>

                      <div className="bg-slate-50/60 p-4 rounded-xl space-y-3.5 border border-slate-100 text-xs text-slate-650" id="client_engine_console">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 block pb-0.5">本地宽带所属运营商</label>
                            <select
                              value={clientTestIsp}
                              onChange={(e) => setClientTestIsp(e.target.value)}
                              className="w-full text-xs p-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-sky-500 font-bold text-slate-700"
                            >
                              <option value="电信">中国电信 (Telecom)</option>
                              <option value="联通">中国联通 (Unicom)</option>
                              <option value="移动">中国移动 (Mobile)</option>
                              <option value="广电">中国广电 (Broadcast)</option>
                              <option value="BGP">三线 BGP 专线</option>
                              <option value="其它">其它网络</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 block pb-0.5">探针物理省份/归属</label>
                            <input
                              type="text"
                              value={clientTestProvince}
                              onChange={(e) => setClientTestProvince(e.target.value)}
                              placeholder="如：杭州、北京、四川"
                              className="w-full text-xs p-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-sky-500 font-bold text-slate-700"
                            />
                          </div>
                        </div>

                        {/* 测速筛选：仅测当前有效和未测试的线路 */}
                        <div className="flex items-center justify-between text-[11px] bg-sky-50/20 px-3 py-2 rounded-lg border border-sky-100/50 hover:bg-sky-50/40 transition">
                          <label className="flex items-center gap-2 cursor-pointer select-none w-full">
                            <input
                              type="checkbox"
                              checked={clientTestOnlyActive}
                              onChange={(e) => setClientTestOnlyActive(e.target.checked)}
                              className="w-3.5 h-3.5 text-sky-600 border-slate-300 rounded focus:ring-sky-500 cursor-pointer"
                            />
                            <span className="font-bold text-slate-700">仅加载与检测状态为 [有效/可用] 与 [未测试] 的物理线路（过滤失效死链）</span>
                          </label>
                          <span className="text-[10px] bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded shrink-0 font-extrabold font-mono">
                            {filteredGlobalSources.filter(s => s.status === "active" || s.status === "unknown" || s.status === "checking").length} 条
                          </span>
                        </div>

                        {/* 智能网络感知归属探测行 */}
                        <div className="flex items-center justify-between text-[10.5px] text-slate-500 bg-slate-100/50 px-3 py-2 rounded-lg border border-slate-200/60 font-sans">
                          <span className="font-bold flex items-center gap-1 text-slate-600">
                            🌐 本地公网真实 IP: <span className="font-mono text-sky-650 font-black select-all">{detectedIp || "识别中..."}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => detectClientIpInfo(false)}
                            disabled={isDetectingIp}
                            className={`px-2.5 py-1 bg-white hover:bg-sky-50 hover:text-sky-700 border border-slate-200 hover:border-sky-300 rounded-md text-sky-600 font-black cursor-pointer transition flex items-center gap-1 text-[10px] ${isDetectingIp ? "animate-pulse" : ""}`}
                          >
                            {isDetectingIp ? "🎯 探测中..." : "🔄 自动感应本地网络"}
                          </button>
                        </div>

                        {isClientTesting ? (
                          <div className="space-y-2 py-1">
                            <div className="flex justify-between items-center text-[10px] font-black text-sky-700">
                              <span className="flex items-center gap-1 animate-pulse">
                                <Activity className="w-3.5 h-3.5 animate-spin text-sky-500" />
                                浏览器探针深度评估中...
                              </span>
                              <span>{clientTestProgress} / {clientTestTotal} ({Math.round((clientTestProgress / (clientTestTotal || 1)) * 100)}%)</span>
                            </div>
                            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                              <div 
                                className="bg-sky-550 h-full rounded-full transition-all duration-300"
                                style={{ width: `${(clientTestProgress / (clientTestTotal || 1)) * 100}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 pt-1">
                            <div className="flex gap-2">
                              <button
                                onClick={runClientSideProbeTest}
                                className="flex-1 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-extrabold text-[11px] rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                              >
                                <Play className="w-3.5 h-3.5" />
                                `启动 [${clientTestIsp} + BGP多线] 全量代测`
                              </button>
                              
                              {clientTestResults.length > 0 && (
                                <button
                                  onClick={submitClientSideProbeTest}
                                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-emerald-100 shrink-0"
                                >
                                  <UploadCloud className="w-3.5 h-3.5" />
                                  同步评估报告 ({clientTestResults.length})
                                </button>
                              )}
                            </div>

                            <div className="flex justify-between items-center pt-1 leading-snug">
                              <span className="text-[10px] text-slate-400 font-bold truncate max-w-[150px]">
                                {clientTestResults.length > 0 
                                  ? `已采集: ${clientTestResults.filter(k => k.status === 'active').length} 条健康` 
                                  : "等待触发检测"}
                              </span>
                              
                              <button
                                onClick={() => setShowApiDoc(!showApiDoc)}
                                className="text-[10px] text-indigo-600 hover:underline hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <FileText className="w-3 h-3" />
                                {showApiDoc ? "关闭 API 文档说明" : "阅读 API 接口定义文档"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* 针对方案二的可扩展报告开放接口说明书 Accordion */}
                  {showApiDoc && (
                    <div className="bg-slate-900 text-slate-100 p-6 rounded-2xl border border-slate-800 space-y-4 shadow-2xl animate-fade-in font-mono text-xs" id="api_developer_docs_panel">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                        <div className="flex items-center gap-1.5 text-indigo-400 font-black text-xs">
                          <Database className="w-4 h-4 text-indigo-400" />
                          方案二：客户端/边缘硬件探针接口文档 (CLIENT PROBE SUBMISSION PROTOCOL)
                        </div>
                        <button 
                          onClick={() => setShowApiDoc(false)} 
                          className="bg-slate-800 hover:bg-slate-700 text-slate-450 hover:text-slate-100 px-3 py-1 bg-slate-850 rounded text-[10px] font-black cursor-pointer"
                        >
                          ✕ 关闭文档
                        </button>
                      </div>

                      <div className="space-y-3.5 text-slate-300 leading-relaxed font-sans shrink-0">
                        <p className="text-xs font-semibold">
                          我们提供高标准的开放 API 接口。任何外界硬件探针、机顶盒或定时脚本（如 Cron 命令行代测、Kodi 测速插件、TvBox 本地测速包）均可直接批量向该网关发送性能报告。
【协议特殊处理规则】：
1. HTTP/HTTPS/HLS/FLV：利用探针无跨域限制探针直测并计算 RTT 响应延时。
2. RTSP / RTMP：内置 RTSP(端口554) 与 RTMP(端口1935) 智能 TCP Socket 握手机制与协议端口转换降级探测，解决浏览器原生沙箱屏蔽与 TypeError 误判痛点。
                        </p>

                        <div className="space-y-1 bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] font-mono">
                          <span className="text-emerald-400 font-bold block pb-1">1. 获取待测源清单接口 (Get Target Test Sources)：</span>
                          <span className="text-white font-extrabold pr-2">GET</span>
                          <span className="text-indigo-300 select-all">/api/sources/client-test-list?isp=中国电信&province=广东&onlyActive=true</span>
                          <p className="text-[10.5px] text-slate-400 pt-1 font-sans">自动返回匹配指定运营商 (如中国电信) + 所有 BGP/多线/未知 专线的全量线路，不受管理后台 UI 筛选状态影响。</p>
                        </div>
                        <div className="space-y-1 bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] font-mono">
                          <span className="text-emerald-400 font-bold block pb-1">2. 提交测速结果报告接口 (Submit Test Report)：</span>
                          <span className="text-white font-extrabold pr-2">POST</span>
                          <span className="text-indigo-300 select-all">/api/sources/client-test-results</span>
                        </div>

                        <div className="space-y-1 bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] font-mono">
                          <span className="text-emerald-400 font-bold block pb-1">3. 协议 Payload 结构体 (Request Body JSON Schema)：</span>
                          <pre className="text-indigo-300 leading-snug overflow-x-auto select-all text-[10.5px]">
{`{
  "clientIsp": "中国电信",      // [必填] 本次测速探针网络的归属运营商名称
  "clientProvince": "广东",     // [选填] 代测网络省市归属
  "results": [                 // [必填] 测速实体报告数据数组
    {
      "sourceId": "src_8f2a10",         // 直播源线路物理唯一 ID
      "channelId": "ch_cctv1",          // 对应电视频道 ID
      "status": "active",               // 可用状态: "active"(可用) / "inactive"(断流/故障)
      "latency": 154                    // 测试得出的延迟，单位 ms
    }
  ]
}`}
                          </pre>
                        </div>

                        <div className="space-y-2 bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] font-mono">
                          <span className="text-emerald-400 font-bold block pb-1">4. 云端返回体样例 (Response Code & Format)：</span>
                          <span className="text-slate-400 leading-snug font-sans block">完成更新后返回 200 OK 实有更新数：</span>
                          <span className="text-emerald-300 block select-all">{`{"success": true, "count": 1}`}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Multi-Dimensional Filters Card */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4" id="global_sources_filters_card">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Filter className="w-4 h-4 text-indigo-505" />
                        全域线路多维智能过滤器 & 全天候排查
                      </div>
                      <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full font-bold">
                        覆盖全站 {channels.reduce((acc, c) => acc + (c.sources ? c.sources.length : 0), 0)} 条活跃广播流
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block">搜索频道或流链接</label>
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input 
                            type="text"
                            value={globalSourceSearch}
                            onChange={(e) => setGlobalSourceSearch(e.target.value)}
                            placeholder="如: cctv, m3u8, rst..."
                            className="w-full text-xs pl-8 pr-3 p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block">按归属运营商 (ISP)</label>
                        <select
                          value={globalSourceIsp}
                          onChange={(e) => setGlobalSourceIsp(e.target.value)}
                          className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-indigo-500 font-bold"
                        >
                          <option value="all">所有运营商类型 (不限)</option>
                          <option value="电信">🟢 中国电信 (Telecom)</option>
                          <option value="联通">🔴 中国联通 (Unicom)</option>
                          <option value="移动">🔵 中国移动 (Mobile)</option>
                          <option value="广电">🟣 中国广电 (Broadcast)</option>
                          <option value="BGP">🌐 多线 BGP 专网</option>
                          {allUniqueIspOptions.filter(x => !["电信", "联通", "移动", "广电", "BGP"].includes(x)).map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block">地区分区政企段 (Province)</label>
                        <select
                          value={globalSourceProvince}
                          onChange={(e) => setGlobalSourceProvince(e.target.value)}
                          className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-indigo-500 font-bold"
                        >
                          <option value="all">所有省份地区 (不限)</option>
                          <option value="全国">⭐ 全国通用</option>
                          {allUniqueProvinceOptions.filter(x => x !== "全国" && x !== "全国通用").map(x => (
                            <option key={x} value={x}>{x}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block">物理线路网络状态</label>
                        <select
                          value={globalSourceStatus}
                          onChange={(e) => setGlobalSourceStatus(e.target.value)}
                          className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-indigo-500 font-bold"
                        >
                          <option value="all">全部状态 (默认, 不含隔离)</option>
                          <option value="all_with_isolated">全部状态 (含已隔离)</option>
                          <option value="isolated">🟠 已隔离 (Isolated)</option>
                          <option value="active">🟢 有效/可用 (Active)</option>
                          <option value="inactive">🔴 失效/离线 (Inactive)</option>
                          <option value="checking">🟡 测试中 (Checking)</option>
                          <option value="unknown">⚪ 未测试 (Unknown)</option>
                        </select>
                      </div>
                    </div>

                    {(globalSourceSearch || globalSourceIsp !== "all" || globalSourceProvince !== "all" || globalSourceStatus !== "all") && (
                      <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                        <span className="text-[10px] text-slate-400 font-semibold">🔍 当前筛选出 {filteredGlobalSources.length} 条符合物理描述的直播源</span>
                        <button 
                          onClick={async () => {
                            setGlobalSourceSearch("");
                            setGlobalSourceIsp("all");
                            setGlobalSourceProvince("all");
                            setGlobalSourceStatus("all");
                          }}
                          className="text-xs font-bold text-slate-500 hover:text-indigo-650 flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          清空当前过滤条件
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Batch Actions Bar for Global Sources */}
                  {selectedGlobalSourceIds.length > 0 && (
                    <div className="bg-indigo-50/50 border border-indigo-100 p-5 rounded-2xl flex flex-col md:flex-row gap-4 items-center justify-between shadow-xs animate-slide-in" id="global_sources_batch_bar">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold font-mono shadow-md shadow-indigo-650/10">
                          {selectedGlobalSourceIds.length}
                        </div>
                        <div>
                          <div className="text-xs font-black text-indigo-950">跨频道批量操控生效中</div>
                          <p className="text-[10px] text-indigo-700 font-semibold mt-0.5">您已选定了多个电视频道的直播拉流。您可以将其一键删除、跨地域归属修改或调度测速。</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={async () => {
                            setBatchGlobalSourceForm({ isp: "", province: "", status: "" });
                            setIsBatchGlobalSourceModalOpen(true);
                          }}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition shadow-md shadow-indigo-500/10 cursor-pointer flex items-center gap-1.5"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          批量套用属性
                        </button>
                        <button
                          onClick={handleGlobalBatchTest}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition shadow-md shadow-blue-500/10 cursor-pointer flex items-center gap-1.5"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          对齐多线程测速
                        </button>
                        <button
                          onClick={handleGlobalBatchDelete}
                          className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition shadow-md shadow-rose-500/10 cursor-pointer flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          一键批量强制清空
                        </button>
                        <button
                          onClick={() => setSelectedGlobalSourceIds([])}
                          className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-xs font-bold px-4 py-2.5 rounded-xl transition-all cursor-pointer shadow-xs"
                        >
                          取消选择
                        </button>
                      </div>
                    </div>
                  )}

                  {/* List / Table of Global Sources */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden" id="global_sources_list_card">
                    {filteredGlobalSources.length === 0 ? (
                      <div className="text-center py-20 bg-slate-50/20 m-4 rounded-xl border-2 border-dashed border-slate-100 flex flex-col items-center justify-center">
                        <Compass className="w-12 h-12 text-slate-300 stroke-[1.2] mb-3" />
                        <h4 className="font-bold text-slate-800 text-sm">未能找到匹配任何流媒体线路</h4>
                        <p className="text-[11px] text-slate-400 mt-1 max-w-sm leading-relaxed font-semibold">无满足当前运营商、省份、连通性及搜素输入限制的物理线路，请清理当前过滤器重试。</p>
                      </div>
                    ) : (
                      <>
                        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                          <table className="w-full text-left border-collapse" id="global_sources_table">
                            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 shadow-xs z-10">
                              <tr className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                                <th className="py-4 px-4 w-12 text-center">
                                  <input 
                                    type="checkbox"
                                    className="w-4 h-4 text-indigo-650 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                    checked={filteredGlobalSources.length > 0 && filteredGlobalSources.every(s => selectedGlobalSourceIds.includes(s.id))}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        const allIds = filteredGlobalSources.map(s => s.id);
                                        setSelectedGlobalSourceIds(prev => Array.from(new Set([...prev, ...allIds])));
                                      } else {
                                        const allIds = filteredGlobalSources.map(s => s.id);
                                        setSelectedGlobalSourceIds(prev => prev.filter(id => !allIds.includes(id)));
                                      }
                                    }}
                                  />
                                </th>
                                <th className="py-4 px-3 w-48">所属电视频道</th>
                                <th className="py-4 px-3">全量播放播放源链接</th>
                                <th className="py-4 px-3 w-32">运营商 (ISP)</th>
                                <th className="py-4 px-3 w-32">地区省份</th>
                                <th className="py-4 px-3 w-32">网络连通状态</th>
                                <th className="py-4 px-4 w-32 text-right">线路日常管理</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs text-slate-650">
                              {slicedGlobalSources.map((item) => {
                              const isChecked = selectedGlobalSourceIds.includes(item.id);
                              return (
                                <tr key={item.id} className={`hover:bg-slate-50/50 transition-colors ${isChecked ? "bg-indigo-50/20" : item.isolated ? "bg-orange-50/10 opacity-75" : ""}`}>
                                  <td className="py-3.5 px-4 text-center">
                                    <input 
                                      type="checkbox"
                                      className="w-4 h-4 text-indigo-650 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedGlobalSourceIds(prev => [...prev, item.id]);
                                        } else {
                                          setSelectedGlobalSourceIds(prev => prev.filter(id => id !== item.id));
                                        }
                                      }}
                                    />
                                  </td>
                                  <td className="py-3.5 px-3">
                                    <div className="flex items-center gap-2">
                                      {item.channelLogo ? (
                                        <img src={item.channelLogo} alt={item.channelName} className="w-5.5 h-5.5 object-contain bg-slate-50 rounded border border-slate-100 p-0.5 shrink-0" referrerPolicy="no-referrer" />
                                      ) : (
                                        <div className="w-5.5 h-5.5 rounded bg-slate-100 text-[10px] font-black flex items-center justify-center text-slate-400 font-mono p-0.5">TV</div>
                                      )}
                                      <div className="truncate max-w-[140px]">
                                        <span className="font-extrabold text-slate-800 text-xs block truncate" title={item.channelName}>{item.channelName}</span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-3 font-mono">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate max-w-sm block text-slate-500 select-all font-semibold" title={item.url}>{item.url}</span>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(item.url);
                                          showFeedback("success", "直播源拉流链接已拷贝！");
                                        }}
                                        className="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded transition"
                                        title="拷贝流地址"
                                      >
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black border ${
                                      item.isp === "电信" ? "bg-sky-50 text-sky-700 border-sky-100" :
                                      item.isp === "联通" ? "bg-orange-50 text-orange-700 border-orange-100" :
                                      item.isp === "移动" ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                                      item.isp === "广电" ? "bg-purple-50 text-purple-700 border-purple-100" : "bg-slate-50 text-slate-600 border-slate-150"
                                    }`}>
                                      {item.isp || "BGP"}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-3">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-slate-100 text-slate-700 border border-slate-200">
                                      {item.province || "全国"}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-3">
                                    <div className="flex items-center gap-2">
                                      <span className={`w-2 h-2 rounded-full ${
                                        item.isolated ? "bg-orange-500 shadow-xs shadow-orange-500" :
                                        item.status === "active" ? "bg-emerald-500 shadow-xs shadow-emerald-500" :
                                        item.status === "inactive" ? "bg-rose-500 shadow-xs shadow-rose-500" :
                                        item.status === "checking" ? "bg-amber-500 animate-pulse shadow-xs shadow-amber-500" : "bg-slate-350"
                                      }`} />
                                      <span className="font-extrabold text-slate-700">
                                        {item.isolated ? "已隔离" :
                                         item.status === "active" ? "有效/可用" :
                                         item.status === "inactive" ? "失效/离线" :
                                         item.status === "checking" ? "测试中" : "未测试"}
                                      </span>
                                      {item.latency !== undefined && (
                                        <span className="text-[10px] text-slate-400 font-black font-mono">({item.latency}ms)</span>
                                      )}
                                      {item.testCount !== undefined && item.testCount > 0 && item.successCount !== undefined && (
                                        <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md font-bold" title={`测试 ${item.testCount} 次，成功 ${item.successCount} 次`}>
                                          可靠度 {Math.round((item.successCount / item.testCount) * 100)}%
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4 text-right space-x-2.5">
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        try {
                                          const res = await fetch(`/api/channels/${item.channelId}/sources/${item.id}/isolate`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ isolated: !item.isolated })
                                          });
                                          if (res.ok) {
                                            showFeedback("success", !item.isolated ? "直播线路已隔离 (软删除)" : "直播线路已从隔离中恢复");
                                            await fetchData();
                                          } else {
                                            showFeedback("error", "操作失败");
                                          }
                                        } catch(e) {
                                          showFeedback("error", "网络超时");
                                        }
                                      }}
                                      className={`text-[11px] font-bold ${item.isolated ? "text-emerald-600 hover:text-emerald-800" : "text-orange-600 hover:text-orange-800"} hover:underline cursor-pointer transition-all`}
                                    >
                                      {item.isolated ? "恢复" : "隔离"}
                                    </button>
                                    <button 
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        try {
                                          const res = await fetch("/api/sources/test", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ sourceIds: [item.id] })
                                          });
                                          if (res.ok) {
                                            showFeedback("success", "已向后台提交独立测速...");
                                            await fetchData();
                                          } else {
                                            showFeedback("error", "测速指令异常");
                                          }
                                        } catch (_) {
                                          showFeedback("error", "连接通信故障");
                                        }
                                      }}
                                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer transition-all"
                                    >
                                      测速
                                    </button>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const c = channels.find(ch => ch.id === item.channelId);
                                        if (c) {
                                          setSelectedChannel(c);
                                          setEditingSource(item);
                                          setSourceForm({
                                            url: item.url,
                                            province: item.province || "全国",
                                            isp: item.isp || "BGP"
                                          });
                                          setIsSourceModalOpen(true);
                                        }
                                      }}
                                      className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer transition-all"
                                    >
                                      编辑
                                    </button>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const c = channels.find(ch => ch.id === item.channelId);
                                        if (!c) return;
                                        triggerConfirm(
                                          "删除直播流线路",
                                          `您即将从电视频道 [${c.name}] 中永久物理删除此条拉流线路。确认后数据无法撤回！`,
                                          async () => {
                                            try {
                                              const res = await fetch(`/api/channels/${c.id}/sources/${item.id}`, {
                                                method: "DELETE"
                                              });
                                              if (res.ok) {
                                                showFeedback("success", "直播线路已断开连接并物理移除");
                                                await fetchData();
                                              } else {
                                                showFeedback("error", "移除直播线路失败");
                                              }
                                            } catch (_) {
                                              showFeedback("error", "连接通信失效");
                                            }
                                          }
                                        );
                                      }}
                                      className="text-[11px] font-bold text-rose-500 hover:text-rose-700 hover:underline cursor-pointer transition-all"
                                    >
                                      删除
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {filteredGlobalSources.length > slicedGlobalSources.length && (
                        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-center items-center">
                          <button
                            onClick={() => setGlobalSourcePage(prev => prev + 1)}
                            className="text-xs font-black text-indigo-650 hover:text-indigo-800 bg-indigo-50/80 hover:bg-indigo-100 px-5 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                          >
                            显示更多物理线路 (已显示 {slicedGlobalSources.length} / 共 {filteredGlobalSources.length} 条)
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW: SUBSCRIPTIONS & MANUAL BULK IMPORT */}
          {activeTab === "sync" && (
            <div className="space-y-8 animate-fade-in" id="tab_sync_view">
              
              {/* Top informational alerting banner */}
              <div className="bg-blue-50/50 p-5 rounded-2xl border border-blue-100 flex items-start gap-4" id="sync_alert">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed text-blue-900">
                  <h4 className="font-bold">支持 GitHub 直播源及本地格式快速导入</h4>
                  <p className="mt-1">
                    系统内置强劲文件语法识别器，会自动根据后缀为 M3U 或 TXT 展开智能解析：
                    <br />• <b>M3U 规范:</b> 解析包含 <code>#EXTINF</code>, <code>tvg-logo</code>, <code>group-title</code> 等参数的高级频道元数据，并映射至分类中。
                    <br />• <b>TXT (TVBox 规范):</b> 解析 <code>分类名,#genre</code> 行与其下逗号分割的频道名和线路列表，自动建立关系结构。
                  </p>
                </div>
              </div>

              {/* GitHub Proxy Acceleration Settings Card */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4" id="github_proxy_settings_card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                      <Settings className="w-5 h-5 animate-spin-hover" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-sm">GitHub 访问加速代理配置</h3>
                      <p className="text-xs text-slate-400 mt-0.5">当订阅源/同步目标包含 github.com 或 raw.githubusercontent.com 时，自动使用该代理进行解析加速</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                  <div className="relative flex-1 w-full">
                    <input
                      type="text"
                      value={githubProxyInput}
                      onChange={(e) => setGithubProxyInput(e.target.value)}
                      placeholder="例如: https://mirror.ghproxy.com  或  https://ghproxy.net"
                      className="w-full pl-4 pr-24 py-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50 text-slate-700 placeholder-slate-400 font-mono"
                    />
                    {githubProxy && (
                      <div className="absolute right-3 top-2.5 flex items-center text-emerald-600 gap-1" title="当前已启用代理">
                        <Check className="w-4 h-4 stroke-[3]" />
                        <span className="text-[10px] font-bold">已启用</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={saveGithubProxy}
                    disabled={isSavingProxy}
                    className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-xs rounded-xl shadow transition duration-150 cursor-pointer text-center flex-shrink-0"
                  >
                    {isSavingProxy ? "正在保存..." : "保存代理配置"}
                  </button>
                  {githubProxy && (
                    <button
                      onClick={async () => {
                        setIsSavingProxy(true);
                        try {
                          const res = await fetch("/api/settings", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ githubProxy: "" })
                          });
                          if (res.ok) {
                            setGithubProxy("");
                            setGithubProxyInput("");
                            showFeedback("success", "GitHub 代理已成功清除并禁用");
                          }
                        } catch (err) {
                          showFeedback("error", "清除代理失败");
                        } finally {
                          setIsSavingProxy(false);
                        }
                      }}
                      className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl transition cursor-pointer text-center flex-shrink-0"
                    >
                      清空并禁用
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-slate-400">
                  💡 注意：留空并保存即可<b>直接连接</b>拉取 GitHub 原源。如果遇到 GitHub 连接超时、无法拉取或白屏问题，推荐配置 <code>https://mirror.ghproxy.com</code> 或 <code>https://ghproxy.net</code>。
                </div>
              </div>

              {/* 同步时新建频道策略设置 */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 animate-fade-in" id="auto_create_channel_settings_card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                      <Tv className="w-5 h-5 animate-spin-hover" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-sm">自动同步频道创建策略</h3>
                      <p className="text-xs text-slate-400 mt-0.5">控制在订阅源同步过程中是否自动注册不存在的新频道分类</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-100 hover:bg-slate-100/50 transition">
                  <div className="flex-1 pr-4">
                    <span className="font-bold text-slate-700 text-xs block">允许在自动同步时创建新频道</span>
                    <span className="text-[11px] text-slate-400 mt-0.5 block leading-relaxed">
                      开启时：拉取订阅源后，若发现未录入的频道名称，将被自动生成并分类；<br />
                      关闭时：不创建任何新频道，只对系统里已被添加或存在的现有频道，维护更新其对应的直播源线路。
                    </span>
                  </div>
                  <div className="relative flex items-center shrink-0">
                    <button
                      onClick={() => handleToggleAutoCreateChannel(!autoCreateChannel)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${
                        autoCreateChannel ? "bg-indigo-600" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                          autoCreateChannel ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Grid dividing local paste vs remote subscription sync */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" id="sync_configs_grid">
                
                {/* 1. M3U Web Paste File Upload & Import */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4 flex flex-col" id="manual_upload_box">
                  <h3 className="font-bold text-slate-800 text-sm flex items-center">
                    <Zap className="w-4 h-4 mr-2 text-indigo-500" /> 手动贴入或本地列表导入
                  </h3>
                  
                  <div className="space-y-3 flex-1 flex flex-col">
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer font-semibold text-xs text-slate-600">
                        <input 
                          type="radio" 
                          name="paste_tp" 
                          checked={pasteType === "m3u"} 
                          onChange={() => setPasteType("m3u")}
                          className="text-indigo-600"
                        />
                        <span>M3U 播放列表格式</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer font-semibold text-xs text-slate-600">
                        <input 
                          type="radio" 
                          name="paste_tp" 
                          checked={pasteType === "txt"} 
                          onChange={() => setPasteType("txt")} 
                          className="text-indigo-600"
                        />
                        <span>TXT (TVBox 便捷格式)</span>
                      </label>
                    </div>

                    <textarea
                      value={pasteContent}
                      onChange={(e) => setPasteContent(e.target.value)}
                      rows={12}
                      placeholder={
                        pasteType === "m3u" 
                        ? "#EXTM3U\n#EXTINF:-1 tvg-logo=\"https://img.png\" group-title=\"央视频道\",CCTV-1 综合\nhttp://ip:port/stream.m3u8"
                        : "央视频道,#genre\nCCTV-1 综合#北京电信,http://39.134.115/stream.m3u8\n卫视频道,#genre\n湖南卫视#长沙移动,http://112.50.31/tv.m3u8"
                      }
                      className="w-full flex-1 p-4 border border-slate-200 rounded-xl font-mono text-xs bg-slate-50 focus:outline-none focus:border-indigo-500 text-slate-700 leading-normal"
                    />

                    <button
                      onClick={handlePasteImport}
                      disabled={isImportingText}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow transition duration-150 cursor-pointer text-center"
                    >
                      {isImportingText ? "正在解析文件并写入缓存..." : "开始批量一键导入直播播放源"}
                    </button>
                  </div>
                </div>

                {/* 2. Automated Scheduled GitHub Sync configurations */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col space-y-4" id="scheduled_sync_box">
                  <div className="flex justify-between items-center pb-1 flex-wrap gap-2">
                    <h3 className="font-bold text-slate-800 text-sm">GitHub 直播源自动周期同步</h3>
                    <div className="flex items-center gap-2">
                      {syncConfigs.some(cfg => !cfg.disabled) && (
                        <button
                          onClick={triggerBatchSyncAll}
                          disabled={isBatchSyncing}
                          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-3.5 py-1.5 rounded-xl font-bold text-[10px] transition cursor-pointer flex items-center gap-1 shadow-sm"
                        >
                          <RefreshCw className={`w-3 h-3 ${isBatchSyncing ? "animate-spin" : ""}`} />
                          {isBatchSyncing ? "批量同步中..." : "批量同步所有源"}
                        </button>
                      )}
                      
                      <button 
                        onClick={openSyncCreate}
                        className="text-indigo-600 hover:text-indigo-800 border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/50 px-3.5 py-1.5 rounded-xl font-bold text-[10px] transition cursor-pointer flex items-center"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        添加自动同步订阅
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-2 pb-2 border-y border-slate-100 text-[11px]" id="subscription_backup_panel">
                    <span className="text-[10px] text-slate-400 font-bold uppercase mr-1">数据订阅管理:</span>
                    <button
                      onClick={handleExportSubscriptions}
                      className="text-emerald-600 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-xl font-bold text-[10.5px] transition cursor-pointer flex items-center gap-1"
                      title="下载当前配置到本地 JSON"
                    >
                      <Download className="w-3 h-3" /> 导出备份 (JSON)
                    </button>
                    <button
                      onClick={async () => {
                        setImportSubscriptionsContent("");
                        setIsImportSubscriptionsOpen(true);
                      }}
                      className="text-violet-600 hover:text-violet-800 bg-violet-50 hover:bg-violet-100 px-2.5 py-1.5 rounded-xl font-bold text-[10.5px] transition cursor-pointer flex items-center gap-1"
                      title="通过导入 JSON 备份恢复订阅"
                    >
                      <Upload className="w-3 h-3" /> 导入备份 (JSON)
                    </button>
                    <button
                      onClick={handleQuickBackupSubscriptions}
                      className="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-xl font-bold text-[10.5px] transition cursor-pointer flex items-center gap-1"
                      title="备份到浏览器缓存中"
                    >
                      <Copy className="w-3 h-3" /> 快速暂存
                    </button>
                    {isQuickBackupAvailable && (
                      <button
                        onClick={handleQuickRestoreSubscriptions}
                        className="text-amber-600 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-xl font-bold text-[10.5px] transition cursor-pointer flex items-center gap-1"
                        title="从缓存中加载订阅"
                      >
                        <RefreshCw className="w-3 h-3" /> 快速恢复
                      </button>
                    )}
                  </div>

                  <div className="space-y-4 flex-1 overflow-y-auto max-h-[460px]">
                    {syncConfigs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-350">
                        <Compass className="w-14 h-14 stroke-[1]" />
                        <p className="text-xs font-semibold mt-2">暂无安排任何自动化定时同步源</p>
                      </div>
                    ) : (
                      syncConfigs.map((cfg) => (
                      <div 
                        key={cfg.id} 
                        className={`p-4 rounded-xl border space-y-2.5 transition duration-150 ${
                          cfg.disabled 
                            ? "border-rose-300 bg-rose-50/20 shadow-xs" 
                            : "border-slate-200 bg-slate-50/40"
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs font-bold text-slate-800">{cfg.name}</p>
                              {cfg.isp && (
                                <span className="text-[9px] bg-blue-50 text-blue-700 border border-blue-150 font-semibold px-1.5 py-0.5 rounded-sm flex items-center gap-0.5">
                                  ⚡ {cfg.isp}
                                </span>
                              )}
                              {cfg.disabled && (
                                <span className="text-[9px] bg-rose-100 text-rose-800 font-bold px-1.5 py-0.5 rounded-sm border border-rose-200">
                                  ⚠️ 连续失败被禁用
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-sm">{cfg.url}</p>
                          </div>
                          
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {/* Quick Switch Toggle */}
                            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-xl border border-slate-200 shadow-2xs hover:border-slate-300 transition">
                              <span className="text-[9.5px] font-bold text-slate-500">{cfg.disabled ? "已禁用" : "启用中"}</span>
                              <button
                                onClick={() => toggleSyncDisabled(cfg.id, !!cfg.disabled)}
                                title={cfg.disabled ? "点击启用该源自动同步" : "点击关闭该源自动同步"}
                                className={`relative inline-flex h-4 w-7.5 items-center rounded-full transition-all duration-200 focus:outline-none cursor-pointer ${
                                  !cfg.disabled ? "bg-emerald-500" : "bg-slate-200 hover:bg-slate-300"
                                }`}
                              >
                                <span
                                  className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 shadow-sm ${
                                    !cfg.disabled ? "translate-x-4" : "translate-x-1"
                                  }`}
                                />
                              </button>
                            </div>

                            <span className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                              cfg.disabled ? "bg-rose-100 text-rose-700" :
                              cfg.autoSync ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                            }`}>
                              {cfg.disabled ? "已停止" : cfg.autoSync ? `定时 ${cfg.syncInterval}h` : "手动触发"}
                            </span>
                            
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              cfg.disabled ? "bg-rose-100 text-rose-800 border border-rose-200" :
                              cfg.status === "success" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" :
                              cfg.status === "failed" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500"
                            }`}>
                              {cfg.disabled ? "临时停用" :
                               cfg.status === "success" && "同步顺畅"}
                              {!cfg.disabled && cfg.status === "failed" && "同步断流"}
                              {cfg.status === "never" && "从未触发"}
                            </span>
                          </div>
                        </div>

                        {/* Last synced metadata message banner */}
                        <div className="text-[10px] text-slate-500 bg-white p-2.5 rounded-lg border border-slate-100 flex flex-col gap-1">
                          <div className="flex justify-between items-center gap-2">
                            <span className="truncate max-w-[280px] font-medium text-slate-600">
                              {cfg.message || "准备拉取"}
                            </span>
                            <span className="text-slate-400 font-mono flex-shrink-0 bg-slate-50 px-1.5 py-0.5 rounded text-[9px]">
                              {cfg.lastSynced ? new Date(cfg.lastSynced).toLocaleTimeString() : "未同步"}
                            </span>
                          </div>
                          {cfg.consecutiveFailures && cfg.consecutiveFailures > 0 ? (
                            <div className="text-[9px] text-rose-600 flex items-center gap-1 bg-rose-50/50 p-1.5 rounded border border-rose-100 mt-1">
                              <span>⚠️ 连续重试失败计数: <b>{cfg.consecutiveFailures} / 3</b></span>
                              {cfg.disabled && <span>(已触发安全机制熔断自动禁用，需手动点击下方拉取重置)</span>}
                            </div>
                          ) : null}
                        </div>

                        {/* Quick action controls */}
                        <div className="flex justify-between pt-1">
                          <button 
                            onClick={() => triggerManualSyncRun(cfg.id)}
                            className="text-indigo-600 hover:text-indigo-800 hover:underline text-[11px] font-bold flex items-center cursor-pointer"
                          >
                            <RefreshCw className="w-3 h-3 mr-1" /> {cfg.disabled ? "重试并重新启用同步" : "立即手动拉取并覆盖同步"}
                          </button>
                            
                            <div className="flex gap-2">
                              <button 
                                onClick={async () => {
                                  setEditingSync(cfg);
                                  setSyncForm({
                                    name: cfg.name,
                                    url: cfg.url,
                                    type: cfg.type,
                                    autoSync: cfg.autoSync,
                                    syncInterval: cfg.syncInterval,
                                    isp: cfg.isp || ""
                                  });
                                  setIsSyncModalOpen(true);
                                }}
                                className="text-slate-500 hover:text-slate-800 text-[11px] hover:underline"
                              >
                                编辑设置
                              </button>
                              <span>|</span>
                              <button 
                                onClick={() => handleDeleteSync(cfg.id)}
                                className="text-red-500 hover:text-red-700 text-[11px] hover:underline"
                              >
                                彻底移除
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* VIEW: CLIENT PLAYBACK INTERFACES & EXPORT CONFIG PANEL */}
          {activeTab === "export" && (
            <div className="space-y-8 animate-fade-in" id="tab_export_view">
              
              {/* Header metadata intro */}
              <div className="bg-emerald-50/40 border border-emerald-100 p-6 rounded-2xl space-y-2 text-xs text-emerald-900" id="export_header_info">
                <h4 className="font-bold flex items-center">
                  <ExternalLink className="w-4 h-4 mr-2" /> 生成第三方播放器调用的自定义动态 API
                </h4>
                <p className="leading-relaxed">
                  本系统支持将您管理的、测速完毕的最优直播资源无缝暴露给诸如 <b>PotPlayer, Kodi, TVBox 或是 Apple Perfect Player</b> 等第三方客户端使用。
                  以下您可以直接复制全局无阻碍播放路径，亦可通过下方的多维控制网格对接口行为进行精确定制（如：仅在局域网内只输出特定运营商并处于活跃状态的线路），定制后接口将实时按需过滤！
                </p>
              </div>

              {/* API settings dynamic builder */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="export_builder_grid">
                
                {/* 1. Filtering controls pane */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4" id="api_filters_card">
                  <h3 className="font-bold text-slate-800 text-sm">定制 API 过滤条件</h3>
                  
                  <div className="space-y-4 text-xs font-semibold text-slate-600">
                    <div className="space-y-1.5">
                      <label>网络运营商 (ISP Filter)</label>
                      <select 
                        value={exportParams.isp}
                        onChange={(e) => setExportParams({...exportParams, isp: e.target.value})}
                        className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none"
                      >
                        <option value="">全部包含 (电信、移动、联通、BGP、其它)</option>
                        <option value="电信">仅拉取 ━ 中国电信线路</option>
                        <option value="联通">仅拉取 ━ 中国联通线路</option>
                        <option value="移动">仅拉取 ━ 中国移动线路</option>
                        <option value="广电">仅拉取 ━ 广电专线</option>
                        <option value="BGP">BGP / 多网线路优先</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label>检测线路可用状态 (Status Filter)</label>
                      <select 
                        value={exportParams.status}
                        onChange={(e) => setExportParams({...exportParams, status: e.target.value})}
                        className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none"
                      >
                        <option value="">全部输出 (包含未测试或异常的线路)</option>
                        <option value="active">严格筛选 (只输出高并发测速在线 active 的绿色线路)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label>限定直辖市/省份省源</label>
                      <input 
                        type="text"
                        value={exportParams.province}
                        onChange={(e) => setExportParams({...exportParams, province: e.target.value})}
                        placeholder="例如: 广东, 北京, 山东, 上海"
                        className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label>单频道最大备线输出限制 (Number limit)</label>
                      <input 
                        type="number"
                        value={exportParams.limit}
                        onChange={(e) => setExportParams({...exportParams, limit: e.target.value})}
                        placeholder="不限制"
                        className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Export URL list display */}
                <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 flex flex-col justify-between" id="api_endpoints_list_card">
                  <div className="space-y-4">
                    <h3 className="font-bold text-slate-800 text-sm">生成的专属播放和 EPG 链路</h3>
                    
                    {/* Live active dynamic preview params */}
                    {Object.values(exportParams).some(Boolean) && (
                      <div className="bg-amber-50/40 p-3 rounded-lg border border-amber-100 text-[10px] text-amber-900 leading-none">
                        当前已应用过滤条件: {exportParams.isp && `[运营商:${exportParams.isp}]`} {exportParams.status && `[高可用:${exportParams.status}]`} {exportParams.province && `[省份:${exportParams.province}]`} {exportParams.limit && `[数量限制:${exportParams.limit}]`}
                      </div>
                    )}

                    {/* M3U Dynamic API Row */}
                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-800 flex items-center">
                          <CheckCircle className="w-4 h-4 mr-1.5 text-blue-500" /> Standard M3U Playlist API
                        </span>
                        <button 
                          onClick={(e) => downloadApiFile(`/api/export/m3u${getExportQueries()}`, "iptv_channels.m3u", e)}
                          className="text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 font-bold text-[10px] bg-transparent border-none p-0 cursor-pointer"
                        >
                          立即下载文件 <Download className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 bg-white border border-slate-150 p-2.5 rounded-xl font-mono text-[10px] text-slate-600 truncate">
                          {getFullHostUrl()}/api/export/m3u{getExportQueries()}
                        </span>
                        <button 
                          onClick={() => copyTextToClipboard(`${getFullHostUrl()}/api/export/m3u${getExportQueries()}`)}
                          className="bg-slate-900 hover:bg-slate-800 text-slate-50 p-2.5 rounded-xl transition flex-shrink-0 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400">适配：Kodi, PotPlayer, Perfect Player 等全局播放器。</p>
                    </div>

                    {/* TVBox TXT Simple Text Playlist API Rows */}
                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-800 flex items-center">
                          <FileText className="w-4 h-4 mr-1.5 text-orange-500" /> TVBox (TXT Format) Config API
                        </span>
                        <button 
                          onClick={(e) => downloadApiFile(`/api/export/txt${getExportQueries()}`, "iptv_custom.txt", e)}
                          className="text-orange-600 hover:text-orange-850 hover:underline flex items-center gap-1 font-bold text-[10px] bg-transparent border-none p-0 cursor-pointer"
                        >
                          下载 TXT 源文件 <Download className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 bg-white border border-slate-150 p-2.5 rounded-xl font-mono text-[10px] text-slate-600 truncate">
                          {getFullHostUrl()}/api/export/txt{getExportQueries()}
                        </span>
                        <button 
                          onClick={() => copyTextToClipboard(`${getFullHostUrl()}/api/export/txt${getExportQueries()}`)}
                          className="bg-slate-900 hover:bg-slate-800 text-slate-50 p-2.5 rounded-xl transition flex-shrink-0 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400">适配：各类 TVBox 电视盒子客户端，直接通过短连接或源调取。</p>
                    </div>

                    {/* XMLTV XML EPG Timeline Guide row info */}
                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 space-y-4">
                      {/* Original XML */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-slate-800 flex items-center">
                            <Calendar className="w-4 h-4 mr-1.5 text-violet-500" /> XMLTV EPG (Electronic Program Guide) Feed
                          </span>
                          <button 
                            onClick={(e) => downloadApiFile("/api/export/epg.xml", "epg.xml", e)}
                            className="text-violet-600 hover:text-violet-800 hover:underline flex items-center gap-1 font-bold text-[10px] bg-transparent border-none p-0 cursor-pointer"
                          >
                            下载原始 XML 文档 <Download className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="flex-1 bg-white border border-slate-150 p-2.5 rounded-xl font-mono text-[10px] text-slate-600 truncate">
                            {getFullHostUrl()}/api/export/epg.xml
                          </span>
                          <button 
                            onClick={() => copyTextToClipboard(`${getFullHostUrl()}/api/export/epg.xml`)}
                            className="bg-slate-900 hover:bg-slate-800 text-slate-50 p-2.5 rounded-xl transition flex-shrink-0 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* GZ version */}
                      <div className="space-y-2 border-t border-slate-100 pt-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-slate-800 flex items-center">
                            <Calendar className="w-4 h-4 mr-1.5 text-violet-500" /> XMLTV EPG Gzip 压缩源 (.xml.gz 极速反馈)
                          </span>
                          <button 
                            onClick={(e) => downloadApiFile("/api/export/epg.xml.gz", "epg.xml.gz", e)}
                            className="text-violet-600 hover:text-violet-800 hover:underline flex items-center gap-1 font-bold text-[10px] bg-transparent border-none p-0 cursor-pointer"
                          >
                            下载 EPG.xml.gz <Download className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="flex-1 bg-white border border-slate-150 p-2.5 rounded-xl font-mono text-[10px] text-slate-600 truncate">
                            {getFullHostUrl()}/api/export/epg.xml.gz
                          </span>
                          <button 
                            onClick={() => copyTextToClipboard(`${getFullHostUrl()}/api/export/epg.xml.gz`)}
                            className="bg-slate-900 hover:bg-slate-800 text-slate-50 p-2.5 rounded-xl transition flex-shrink-0 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <p className="text-[10px] text-slate-400">输出完全遵循 xmltv 国际通用规范，支持 Gzip 高级压缩，电视频道 EPG epgId 动态对应，供您的播放器自动拉取显示精确时间轴海报日程。</p>
                    </div>

                  </div>
                </div>

              </div>
            </div>
          )}

          {/* VIEW: EPG MANAGEMENT & COLLOCATION */}
          {activeTab === "epg" && (
            <div className="space-y-8 animate-fade-in" id="tab_epg_view">
              
              {/* Header card explaining output and giving copyable output url */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl text-white space-y-4" id="epg_header_info">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="space-y-1">
                    <h4 className="font-bold text-sm flex items-center text-blue-400">
                      <Calendar className="w-4 h-4 mr-2" /> EPG 节目单智能同步与全网整合合并服务
                    </h4>
                    <p className="text-xs text-slate-400 max-w-2xl">
                      您可以添加多个外部 XMLTV/EPG 节目单来源。系统将自动批量拉取并将其解析为本地高速 JSON 缓存。在导出或查看 EPG 时，系统将会根据您频道的 EPG 标识符 (epgId) 智能交叉匹配、合并并合成最终独一无二的高速 EPG Feeds。
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      setIsSyncingAllEpg(true);
                      try {
                        const res = await fetch("/api/epg-sources/sync-all", { method: "POST" });
                        if (res.ok) {
                          const data = await res.json();
                          showFeedback("success", `合并成功！共对 ${data.count} 个源进行解析，其中 ${data.successCount} 个成功。`);
                          fetchEpgSources();
                        }
                      } catch (err) {
                        showFeedback("error", "一键拉取合并失败");
                      } finally {
                        setIsSyncingAllEpg(false);
                      }
                    }}
                    disabled={isSyncingAllEpg}
                    className="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800/80 disabled:text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer text-white"
                  >
                    {isSyncingAllEpg ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        <span>正在拉取外部源并合并...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>一键全网同步合并所有激活源</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="pt-4 border-t border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">整合输出 XMLTV EPG 接口</span>
                      <p className="text-xs font-mono text-emerald-400 truncate">{getFullHostUrl()}/api/export/epg.xml</p>
                      <button
                        onClick={async () => {
                          copyTextToClipboard(`${getFullHostUrl()}/api/export/epg.xml`);
                          showFeedback("success", "已复制 EPG 输出接口链接");
                        }}
                        className="mt-1 text-[10px] text-blue-400 hover:text-blue-300 hover:underline font-bold bg-transparent border-0 p-0 text-left outline-none cursor-pointer"
                      >
                        复制最终聚合 EPG 链接 ❯
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">整合输出 XMLTV EPG.XML.GZ 压缩接口</span>
                      <p className="text-xs font-mono text-emerald-400 truncate">{getFullHostUrl()}/api/export/epg.xml.gz</p>
                      <button
                        onClick={async () => {
                          copyTextToClipboard(`${getFullHostUrl()}/api/export/epg.xml.gz`);
                          showFeedback("success", "已复制 Gzip 压缩 EPG 链接");
                        }}
                        className="mt-1 text-[10px] text-blue-400 hover:text-blue-300 hover:underline font-bold bg-transparent border-0 p-0 text-left outline-none cursor-pointer"
                      >
                        复制 Gzip 压缩 EPG 链接 ❯
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Source list management */}
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-slate-50/85 p-4 rounded-xl border border-slate-100">
                  <div>
                    <h3 className="text-xs font-bold text-slate-700">EPG 节目单来源配置列表 ({epgSources.length})</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">激活的 EPG 会在执行后台/手动同步时自动拉取。系统根据频道 EPG ID 自动匹配它们。</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (isMappingStatusOpen) {
                          setIsMappingStatusOpen(false);
                        } else {
                          setIsMappingStatusOpen(true);
                          setEpgMappingLoading(true);
                          try {
                            const res = await fetch("/api/epg/mapping-status");
                            if (res.ok) {
                              const data = await res.json();
                              setEpgMappingData(data);
                            }
                          } catch(err) {
                            console.error(err);
                          } finally {
                            setEpgMappingLoading(false);
                          }
                        }
                      }}
                      className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold rounded-xl transition cursor-pointer border border-indigo-200"
                    >
                      查看 EPG 映射状态
                    </button>
                    <button
                      onClick={async () => {
                        setEpgForm({ id: "", name: "", url: "", active: true });
                        setIsEpgFormOpen(true);
                      }}
                      className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition cursor-pointer"
                    >
                      添加外部 EPG 来源
                    </button>
                  </div>
                </div>
                
                {/* EPG Mapping Status View */}
                {isMappingStatusOpen && (
                  <div className="bg-white border border-indigo-100 rounded-2xl p-6 shadow-sm mb-4 animate-fade-in">
                    <div className="flex justify-between items-center mb-4">
                      <div>
                        <h3 className="font-bold text-slate-800 text-sm">频道 EPG 匹配映射报告</h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">展示当前启用的电视频道与已缓存的 EPG 资源库匹配结果。</p>
                      </div>
                      <button onClick={() => setIsMappingStatusOpen(false)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    
                    {epgMappingLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <span className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></span>
                      </div>
                    ) : epgMappingData ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                            <p className="text-[10px] text-slate-400 font-bold mb-1">缓存 EPG 频道总数</p>
                            <p className="text-lg font-bold text-slate-700">{epgMappingData.epgTotalChannels}</p>
                          </div>
                          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                            <p className="text-[10px] text-emerald-600 font-bold mb-1">成功匹配频道</p>
                            <p className="text-lg font-bold text-emerald-700">{epgMappingData.mappedChannels.length}</p>
                          </div>
                          <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 text-center">
                            <p className="text-[10px] text-rose-600 font-bold mb-1">未匹配频道</p>
                            <p className="text-lg font-bold text-rose-700">{epgMappingData.unmappedChannels.length}</p>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                          <div className="border border-rose-100 rounded-xl overflow-hidden flex flex-col h-[300px]">
                            <div className="bg-rose-50 px-3 py-2 border-b border-rose-100 flex justify-between items-center">
                              <span className="text-[11px] font-bold text-rose-700">未匹配频道 (需处理)</span>
                              <span className="text-[10px] bg-rose-200 text-rose-800 px-1.5 rounded-full">{epgMappingData.unmappedChannels.length}</span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-white">
                              {epgMappingData.unmappedChannels.length === 0 ? (
                                <p className="text-center text-[10px] text-slate-400 py-4">完美！所有频道均已匹配 EPG</p>
                              ) : (
                                epgMappingData.unmappedChannels.map((ch: any) => (
                                  <div key={ch.id} className="flex justify-between items-center p-2 rounded-lg bg-rose-50/50 hover:bg-rose-50">
                                    <div className="truncate flex-1 pr-2">
                                      <p className="text-xs font-bold text-slate-700 truncate">{ch.name}</p>
                                      <p className="text-[9px] text-slate-400 font-mono mt-0.5 truncate">EPG_ID: {ch.epgId}</p>
                                    </div>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded border border-rose-200 text-rose-500 flex-shrink-0">未找到映射</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                          
                          <div className="border border-emerald-100 rounded-xl overflow-hidden flex flex-col h-[300px]">
                            <div className="bg-emerald-50 px-3 py-2 border-b border-emerald-100 flex justify-between items-center">
                              <span className="text-[11px] font-bold text-emerald-700">已成功匹配频道</span>
                              <span className="text-[10px] bg-emerald-200 text-emerald-800 px-1.5 rounded-full">{epgMappingData.mappedChannels.length}</span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-white">
                              {epgMappingData.mappedChannels.length === 0 ? (
                                <p className="text-center text-[10px] text-slate-400 py-4">暂无频道匹配成功</p>
                              ) : (
                                epgMappingData.mappedChannels.map((ch: any) => (
                                  <div key={ch.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-100">
                                    <div className="truncate flex-1 pr-2">
                                      <p className="text-xs font-bold text-slate-700 truncate">{ch.name}</p>
                                      <p className="text-[9px] text-slate-400 font-mono mt-0.5 truncate">映射到: {ch.matchedName} ({ch.matchedId})</p>
                                    </div>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-200 text-emerald-600 flex-shrink-0 truncate max-w-[80px]" title={ch.sourceName}>{ch.sourceName}</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                {isEpgLoading ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-xl">
                    <span className="w-6 h-6 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin"></span>
                    <span>正在加载 EPG 数据列表...</span>
                  </div>
                ) : epgSources.length === 0 ? (
                  <div className="text-center py-12 text-xs text-slate-400 bg-slate-50/50 border border-slate-100 border-dashed rounded-xl">
                    当前暂未配置任何外部 EPG 来源。
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {epgSources.map((source) => (
                      <div key={source.id} className="bg-white border border-slate-200/80 rounded-2xl p-5 hover:border-slate-300 text-xs flex flex-col justify-between space-y-4 shadow-sm relative">
                        <div className="space-y-2">
                          <div className="flex justify-between items-start gap-2">
                            <div className="space-y-1">
                              <span className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                                {source.name}
                                {!source.active && (
                                  <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md font-medium">已禁用</span>
                                )}
                              </span>
                              <p className="text-[10px] font-mono text-slate-400 break-all">{source.url}</p>
                            </div>

                            {/* Toggle switch directly */}
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/epg-sources/${source.id}`, {
                                    method: "PUT",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ active: !source.active }),
                                  });
                                  if (res.ok) {
                                    fetchEpgSources();
                                  }
                                } catch (_) {}
                              }}
                              className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${source.active ? "bg-blue-600" : "bg-slate-200"}`}
                            >
                              <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ${source.active ? "translate-x-4" : "translate-x-0"}`} />
                            </button>
                          </div>

                          {/* Last synced status */}
                          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${
                                source.status === "success" ? "bg-emerald-500" :
                                source.status === "failed" ? "bg-rose-500" : "bg-amber-400"
                              }`} />
                              <span className="font-bold text-slate-700">
                                {source.status === "success" ? "同步成功" :
                                 source.status === "failed" ? "同步失败" : "尚未拉取同步"}
                              </span>
                            </div>
                            {source.message && <p className="text-[10px] text-slate-500 leading-normal">{source.message}</p>}
                            {source.lastSynced && (
                              <p className="text-[9px] text-slate-400 font-mono">上次运行: {new Date(source.lastSynced).toLocaleString()}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t border-slate-100 gap-2">
                          <div className="flex gap-1">
                            <button
                              onClick={async () => {
                                setEpgForm({ id: source.id, name: source.name, url: source.url, active: source.active });
                                setIsEpgFormOpen(true);
                              }}
                              className="px-2.5 py-1.5 text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 text-[10px] font-bold rounded-lg cursor-pointer transition"
                            >
                              编辑配置
                            </button>
                            <button
                              onClick={async () => {
                                if (window.confirm("确定删除该 EPG 源及对应缓存吗？")) {
                                  try {
                                    const res = await fetch(`/api/epg-sources/${source.id}`, { method: "DELETE" });
                                    if (res.ok) {
                                      showFeedback("success", "删除 EPG 来源成功");
                                      fetchEpgSources();
                                    }
                                  } catch (_) {
                                    showFeedback("error", "删除失败");
                                  }
                                }
                              }}
                              className="px-2.5 py-1.5 text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 text-[10px] font-bold rounded-lg cursor-pointer transition"
                            >
                              删除源
                            </button>
                          </div>

                          <button
                            onClick={async () => {
                              setSyncingEpgId(source.id);
                              try {
                                const res = await fetch(`/api/epg-sources/${source.id}/sync`, { method: "POST" });
                                if (res.ok) {
                                  const data = await res.json();
                                  if (data.success) {
                                    showFeedback("success", "EPG 数据拉取并缓存成功！");
                                  } else {
                                    showFeedback("error", `同步失败: ${data.source.message || "未知原因"}`);
                                  }
                                  fetchEpgSources();
                                }
                              } catch (err) {
                                showFeedback("error", "外部网络异常或XML数据源不匹配");
                              } finally {
                                setSyncingEpgId(null);
                              }
                            }}
                            disabled={syncingEpgId === source.id}
                            className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:bg-slate-100 disabled:text-slate-400 text-[10px] font-bold rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                          >
                            {syncingEpgId === source.id ? (
                              <>
                                <span className="w-2.5 h-2.5 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin"></span>
                                <span>同步中...</span>
                              </>
                            ) : (
                              <>
                                <UploadCloud className="w-3 h-3" />
                                <span>立即全量拉取同步</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form Modal for Add/Edit */}
              {isEpgFormOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in" id="epg_modal_overlay">
                  <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl relative border border-slate-100 space-y-5 animate-slide-up" id="epg_modal_box">
                    <div className="flex justify-between items-start pb-3 border-b border-slate-100">
                      <div>
                        <h3 className="font-bold text-slate-800 text-sm">{epgForm.id ? "编辑 EPG 来源" : "添加外部 EPG 节目单来源"}</h3>
                        <p className="text-[10px] text-slate-400 mt-0.5">节目单应当是符合 .xml 格式且内嵌 &lt;tv&gt; 的 XMLTV 文件</p>
                      </div>
                      <button
                        onClick={() => setIsEpgFormOpen(false)}
                        className="text-slate-400 hover:text-slate-600 text-lg cursor-pointer"
                      >
                        &times;
                      </button>
                    </div>

                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!epgForm.name || !epgForm.url) return;
                        setIsEpgLoading(true);
                        try {
                          const urlStr = epgForm.id ? `/api/epg-sources/${epgForm.id}` : "/api/epg-sources";
                          const method = epgForm.id ? "PUT" : "POST";
                          const res = await fetch(urlStr, {
                            method,
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(epgForm),
                          });
                          if (res.ok) {
                            showFeedback("success", epgForm.id ? "更新成功" : "添加成功");
                            setIsEpgFormOpen(false);
                            fetchEpgSources();
                          } else {
                            const errData = await res.json();
                            showFeedback("error", errData.error || "操作失败");
                          }
                        } catch (_) {
                          showFeedback("error", "网络连接失败");
                        } finally {
                          setIsEpgLoading(false);
                        }
                      }}
                      className="space-y-4 text-xs"
                    >
                      <div className="space-y-1">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">EPG 源名称 <span className="text-rose-500">*</span></label>
                        <input
                          type="text"
                          required
                          value={epgForm.name}
                          onChange={(e) => setEpgForm({ ...epgForm, name: e.target.value })}
                          placeholder="例如: 51zmt 电视频道指南"
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">XML 节目源 URL <span className="text-rose-500">*</span></label>
                        <input
                          type="url"
                          required
                          value={epgForm.url}
                          onChange={(e) => setEpgForm({ ...epgForm, url: e.target.value })}
                          placeholder="http://epg.51zmt.top:12182/xml/chinas.xml"
                          className="w-full px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <input
                          type="checkbox"
                          id="epg_active_cb"
                          checked={epgForm.active}
                          onChange={(e) => setEpgForm({ ...epgForm, active: e.target.checked })}
                          className="rounded text-blue-600 focus:ring-blue-500"
                        />
                        <label htmlFor="epg_active_cb" className="font-bold text-slate-600 cursor-pointer text-[11px]">激活此 EPG，并列入全局自动化拉取和交叉编译范畴</label>
                      </div>

                      <div className="pt-4 border-t border-slate-100 flex justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => setIsEpgFormOpen(false)}
                          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl cursor-pointer transition"
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl cursor-pointer transition"
                        >
                          确认保存
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* VIEW: SYSTEM BACKUP & RESTORE MANAGEMENT */}
          
          {activeTab === "cron" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col h-full">
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 tracking-tight flex items-center">
                        <Clock className="w-5 h-5 mr-2 text-indigo-500" />
                        定时任务列表
                      </h2>
                      <p className="text-sm text-slate-500 mt-1">系统内置自动化任务，支持按时间间隔执行</p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-3">
                    {cronJobs.map((job) => (
                      <div 
                        key={job.id} 
                        onClick={() => setSelectedCronJob(job)}
                        className={`p-4 rounded-xl border transition-colors cursor-pointer flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${selectedCronJob?.id === job.id ? 'border-indigo-400 bg-indigo-50/20' : 'border-slate-100 hover:border-slate-300'}`}
                      >
                        <div className="flex items-start gap-4">
                          <div className={`p-2.5 rounded-lg ${job.active ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                            <Clock className="w-5 h-5" />
                          </div>
                          <div>
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                              {job.name}
                              {job.active === 1 ? (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase">激活</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase">未激活</span>
                              )}
                            </h3>
                            <p className="text-xs font-medium text-slate-500 mt-1">
                              开始时间: {job.startTime || "未设置"} | 间隔: {job.intervalMinutes || 0} 分钟
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              下次执行: {job.nextRun ? new Date(job.nextRun).toLocaleString() : "未知"}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={(e) => { e.stopPropagation(); runCronJobManual(job.id); }}
                            className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 font-semibold text-xs rounded-lg transition-colors"
                          >
                            立即执行
                          </button>
                        </div>
                      </div>
                    ))}
                    
                    {cronJobs.length === 0 && (
                      <div className="text-center py-12 text-slate-400 text-sm">暂无定时任务数据</div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col h-full">
                  {selectedCronJob ? (
                    <>
                      <div className="mb-6">
                        <h2 className="text-xl font-bold text-slate-800 tracking-tight flex items-center">
                          <Settings2 className="w-5 h-5 mr-2 text-indigo-500" />
                          配置任务: {selectedCronJob.name}
                        </h2>
                      </div>
                      
                      <div className="space-y-4 mb-8 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">是否启用定时执行</label>
                          <label className="flex items-center cursor-pointer relative">
                            <input type="checkbox" className="sr-only peer" checked={selectedCronJob.active === 1} onChange={(e) => updateCronJob({...selectedCronJob, active: e.target.checked ? 1 : 0})} />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                            <span className="ml-3 text-sm font-semibold text-slate-700">{selectedCronJob.active === 1 ? "已启用" : "已禁用"}</span>
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">初始每天开始时间 (HH:MM)</label>
                          <input 
                            type="time" 
                            value={selectedCronJob.startTime || ""}
                            onChange={(e) => updateCronJob({...selectedCronJob, startTime: e.target.value})}
                            className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 font-medium shadow-sm transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">重复间隔 (分钟)</label>
                          <input 
                            type="number" 
                            min="0"
                            value={selectedCronJob.intervalMinutes || 0}
                            onChange={(e) => updateCronJob({...selectedCronJob, intervalMinutes: parseInt(e.target.value) || 0})}
                            className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 font-medium shadow-sm transition-all"
                          />
                          <p className="text-[10px] text-slate-400 mt-1">例如: 1440 为每天一次，720 为每天两次。</p>
                        </div>
                      </div>

                      <div className="mb-4">
                        <h3 className="text-sm font-bold text-slate-800">执行历史记录 (最近 20 条)</h3>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto space-y-2 max-h-60">
                        {cronLogs.map((log) => (
                          <div key={log.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-start gap-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                {log.status === "success" ? (
                                  <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase">成功</span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 text-[9px] font-black uppercase">失败</span>
                                )}
                                <span className="text-xs font-bold text-slate-600">{new Date(log.runAt).toLocaleString()}</span>
                              </div>
                              <p className="text-xs text-slate-500 font-medium break-all">{log.message}</p>
                            </div>
                          </div>
                        ))}
                        {cronLogs.length === 0 && (
                          <div className="text-center py-8 text-slate-400 text-xs font-medium">暂无运行日志</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-400 text-sm font-medium">
                      请在左侧选择一个定时任务查看详情
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {activeTab === "backup" && (

            <div className="space-y-8 animate-fade-in" id="tab_backup_view">
              
              {/* Header metadata intro */}
              <div className="bg-blue-50/40 border border-blue-100 p-6 rounded-2xl space-y-2 text-xs text-blue-900" id="backup_header_info">
                <h4 className="font-bold flex items-center">
                  <Shield className="w-4 h-4 mr-2 text-blue-600" /> 物理级硬备份与一键防丢灾备系统
                </h4>
                <p className="leading-relaxed">
                  本模块负责管理整站的物理数据库快照，支持手动创建、历史记录还原、一键下载。
                  系统在执行任何还原操作前都会为您<b>自动留存当前的紧急备份包</b>，以保障在恢复冲突或误操作时的系统绝对安全。
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8" id="backup_control_grid">
                
                {/* 1. List of Backups Panel (Col Span 2) */}
                <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 flex flex-col space-y-4" id="backups_list_card">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                    <div>
                      <h3 className="font-bold text-slate-800 text-sm">备份快照控制台</h3>
                      <p className="text-[10px] text-slate-400">保留最近 30 天自动与所有手动创建的节点</p>
                    </div>
                    <button 
                      onClick={fetchBackups}
                      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-bold bg-blue-50 px-2.5 py-1.5 rounded-lg transition"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${backupLoading ? "animate-spin" : ""}`} />
                      刷新列表
                    </button>
                  </div>

                  {backupLoading && backups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
                      <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                      <span className="text-xs font-semibold">正在扫描存储区备份镜像...</span>
                    </div>
                  ) : backups.length === 0 ? (
                    <div className="text-center py-16 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                      <Database className="w-10 h-10 mx-auto text-slate-300" />
                      <p className="mt-2 text-xs font-semibold text-slate-500">尚无任何备份记录，请在右侧创建第一个手动备份</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse" id="backups_table">
                        <thead>
                          <tr className="border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                            <th className="py-3 px-2">备份名称 / 备注</th>
                            <th className="py-3 px-2">容量规格</th>
                            <th className="py-3 px-2">备份类型</th>
                            <th className="py-3 px-2">生成时间</th>
                            <th className="py-3 px-2 text-right">控制台操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs text-slate-600">
                          {backups.map((back) => {
                            const isManual = back.type === "manual";
                            const formattedSize = back.size < 1024 
                              ? `${back.size} B` 
                              : `${(back.size / 1024).toFixed(1)} KB`;
                            const dateObj = new Date(back.createdAt);
                            const displayTime = isNaN(dateObj.getTime()) 
                              ? "未知时间" 
                              : dateObj.toLocaleString("zh-CN", {
                                  year: "numeric",
                                  month: "2-digit",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                });

                            return (
                              <tr key={back.filename} className="hover:bg-slate-50/40 transition">
                                <td className="py-3 px-2">
                                  <div className="font-semibold text-slate-800 truncate max-w-xs" title={back.filename}>
                                    {back.tag}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-mono truncate max-w-xs">
                                    {back.filename}
                                  </div>
                                </td>
                                <td className="py-3 px-2 font-mono">
                                  <div className="text-[11px] font-bold text-slate-700">{formattedSize}</div>
                                  <div className="text-[10px] text-slate-400">
                                    {back.channelCount} 频道 ({back.groupCount} 分组)
                                  </div>
                                </td>
                                <td className="py-3 px-2">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    isManual 
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                                      : "bg-blue-50 text-blue-700 border border-blue-100"
                                  }`}>
                                    {isManual ? "手动硬备份" : "系统自动化"}
                                  </span>
                                </td>
                                <td className="py-3 px-2 text-[11px] font-medium text-slate-500">
                                  {displayTime}
                                </td>
                                <td className="py-3 px-2 text-right space-x-1">
                                  <button
                                    onClick={() => restoreBackup(back.filename)}
                                    className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-2.5 py-1.5 rounded-lg transition text-[11px] inline-flex items-center gap-1"
                                    title="恢复数据"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                    还原
                                  </button>
                                  <button
                                    onClick={(e) => downloadApiFile(`/api/backups/download/${encodeURIComponent(back.filename)}`, back.filename, e)}
                                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg transition text-[11px] inline-flex items-center gap-1 cursor-pointer"
                                    title="下载到本地"
                                  >
                                    <Download className="w-3 h-3" />
                                    下载
                                  </button>
                                  <button
                                    onClick={() => deleteBackup(back.filename)}
                                    className="bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-2.5 py-1.5 rounded-lg transition text-[11px]"
                                    title="永久删除"
                                  >
                                    删除
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* 2. Control Form Sidebar (Col Span 1) */}
                <div className="space-y-6" id="backup_utilities_panel">
                  
                  {/* Create Manual Backup Block */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4 shadow-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <Plus className="w-4 h-4" />
                      </div>
                      <h3 className="font-bold text-slate-800 text-sm">创建手动物理快照</h3>
                    </div>
                    
                    <form onSubmit={createBackup} className="space-y-4 text-xs font-semibold text-slate-600">
                      <div className="space-y-1.5">
                        <label className="text-slate-500">填写快照备注名称 (Tag)</label>
                        <input 
                          type="text"
                          value={manualBackupTag}
                          onChange={(e) => setManualBackupTag(e.target.value)}
                          placeholder="例如: 整理分组之前、极速稳定版备份"
                          className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                          maxLength={30}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={backupLoading}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-2.5 rounded-xl transition text-xs shadow-sm shadow-emerald-500/10 cursor-pointer"
                      >
                        立即生成备份快照
                      </button>
                    </form>
                  </div>

                  {/* Upload Local Custom Backup File Block */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4 shadow-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                        <UploadCloud className="w-4 h-4" />
                      </div>
                      <h3 className="font-bold text-slate-800 text-sm">导入外部备份</h3>
                    </div>
                    
                    <div className="text-xs text-slate-500 leading-relaxed font-semibold font-sans">
                      如果您曾在其他服务器下载了本系统的 JSON 备份镜像，在此处选择上传即可秒级恢复完整的电视频道设置与全量数据线。
                    </div>

                    <div className="relative border-2 border-dashed border-slate-200 rounded-2xl p-4 text-center hover:bg-slate-50/50 transition cursor-pointer">
                      <input 
                        type="file"
                        accept=".json"
                        onChange={handleUploadBackupLocal}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        id="backup_file_upload_input"
                      />
                      <div className="space-y-1 text-slate-500">
                        <Database className="w-6 h-6 mx-auto text-slate-400" />
                        <div className="text-xs font-bold text-indigo-700">点击此处选择备份文件</div>
                        <div className="text-[10px] text-slate-400">仅支持 .json 快照容器格式</div>
                      </div>
                    </div>
                  </div>

                </div>

              </div>
            </div>
          )}

        </div>
      </main>

      {/* ──────────────────────────────────────────────────────── */}
      {/* ALL INTERACTION MODAL POPUPS (CHANNELS/SOURCES/SYNCS)   */}
      {/* ──────────────────────────────────────────────────────── */}
      
      {/* 1. Modal Dialog: Create/Update Channel */}
      {isChannelModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans" id="channel_modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in font-sans">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">{editingChannel ? "修改 IPTV 频道元数据" : "建立新收录 IPTV 频道"}</h3>
              <button className="text-slate-400 hover:text-slate-600 font-bold font-sans" onClick={()=>setIsChannelModalOpen(false)}>✕</button>
            </div>
            
            <form onSubmit={handleSaveChannel} className="space-y-4 text-xs font-semibold text-slate-600">
              <div className="space-y-1.5 font-sans">
                <label>频道标准中文名称 (Standard Name) *</label>
                <input 
                  type="text"
                  required
                  value={channelForm.name}
                  onChange={(e)=>setChannelForm({...channelForm, name: e.target.value})}
                  placeholder="如: CCTV-1 综合"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none placeholder-slate-400 text-slate-800 font-sans"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 font-sans">
                  <label>关联直播分类 (选择一个或多个分组) *</label>
                  <div className="border border-slate-200 rounded-xl bg-slate-50 p-2.5 max-h-32 overflow-y-auto space-y-1" id="group_checkboxes_pnl">
                    {groups.map((g) => {
                      const isChecked = channelForm.groupIds.includes(g.id);
                      return (
                        <label key={g.id} className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-100/50 rounded px-1.5 select-none text-slate-700">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              let newIds = [...channelForm.groupIds];
                              if (checked) {
                                if (!newIds.includes(g.id)) newIds.push(g.id);
                              } else {
                                newIds = newIds.filter(id => id !== g.id);
                              }
                              setChannelForm({ ...channelForm, groupIds: newIds });
                            }}
                            className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                          />
                          <span className="text-[11px] text-slate-700 font-bold">{g.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5 flex flex-col justify-between font-sans">
                  <div>
                    <label>创建并关联新分类 (动态逗号分隔)</label>
                    <input
                      type="text"
                      value={channelForm.newGroupsString}
                      onChange={(e)=>setChannelForm({...channelForm, newGroupsString: e.target.value})}
                      placeholder="如: 黑龙江卫视, 蓝光专区"
                      className="w-full text-xs p-2.5 mt-1 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none placeholder-slate-400 text-slate-800"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium leading-relaxed font-sans">可以直接在这输入想加入的新类型，保存时系统会自动帮您创建组并关联，实现多对多绑定。</p>
                </div>
              </div>

              <div className="space-y-1.5 font-sans">
                <label className="flex justify-between items-center">
                  <span>EPG 节目匹配 ID (epgId) *</span>
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    required
                    value={channelForm.epgId}
                    onChange={(e)=>setChannelForm({...channelForm, epgId: e.target.value})}
                    placeholder="如: cctv1"
                    className="flex-1 text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono placeholder-slate-400 text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => runAiRecommend(channelForm.id || "", channelForm.name)}
                    disabled={aiRecommendLoading}
                    className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs px-3 py-1.5 rounded-xl transition font-bold border border-indigo-200/50 flex items-center justify-center cursor-pointer disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {aiRecommendLoading ? "🤖 AI匹配中..." : "🤖 AI 智能匹配"}
                  </button>
                </div>

                {aiRecommendError && (
                  <p className="text-[10px] text-rose-600 font-bold mt-1 leading-relaxed bg-rose-50 p-2 rounded-lg border border-rose-100 font-sans">{aiRecommendError}</p>
                )}

                {aiRecommends.length > 0 && (
                  <div className="mt-2 bg-indigo-50/30 p-2.5 rounded-xl border border-indigo-100 space-y-2 max-h-48 overflow-y-auto font-sans">
                    <p className="text-[10px] font-bold text-indigo-800">Gemini AI 智能推荐匹配 (点击直接采纳填入)：</p>
                    <div className="flex flex-col gap-1.5 font-sans">
                      {aiRecommends.map((rec) => (
                        <div 
                          key={rec.epgId}
                          onClick={async () => {
                            setChannelForm({ ...channelForm, epgId: rec.epgId });
                            showFeedback("success", `已填充 "${rec.epgId}"`);
                          }}
                          className="bg-white hover:bg-indigo-50 p-2 rounded-lg border border-indigo-100/50 flex justify-between items-center transition cursor-pointer hover:border-indigo-300"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{rec.epgId}</span>
                              <span className="font-bold text-slate-700 text-[10px]">({rec.displayName})</span>
                            </div>
                            <p className="text-[9px] text-slate-400 leading-normal">{rec.reason}</p>
                          </div>
                          <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 font-bold rounded-sm">
                            {(rec.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 font-sans">
                <label>频道台标图片图标 (Logo URL)</label>
                <input 
                  type="url"
                  value={channelForm.logo}
                  onChange={(e)=>setChannelForm({...channelForm, logo: e.target.value})}
                  placeholder="https://..."
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono placeholder-slate-400 text-slate-800"
                />
              </div>

              <div className="space-y-1.5 font-sans">
                <label>匹配兼容等别名 (Comma Separated)</label>
                <input 
                  type="text"
                  value={channelForm.alias}
                  onChange={(e)=>setChannelForm({...channelForm, alias: e.target.value})}
                  placeholder="如: cctv1, 中央一套, CCTV-1 HD"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none placeholder-slate-400 text-slate-800"
                />
                <p className="text-[10px] text-slate-400 font-medium font-sans">导入不同直播源时，只要名字撞到了这些别名，就会自动归为此频道的源。</p>
              </div>

              <div className="flex gap-3 pt-3">
                <button 
                  type="button" 
                  onClick={()=>setIsChannelModalOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer text-center font-bold font-sans"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-50 rounded-xl cursor-pointer text-center font-bold font-sans shadow-md"
                >
                  保存设置
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Modal Dialog: Create/Update Scheduled Sync Subscription */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans" id="sync_modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in font-sans">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800 font-sans">{editingSync ? "修改定时拉取任务" : "建立新增从网络 URL 拉取同步"}</h3>
              <button className="text-slate-400 hover:text-slate-600 font-bold" onClick={()=>setIsSyncModalOpen(false)}>✕</button>
            </div>
            
            <form onSubmit={handleSaveSync} className="space-y-4 text-xs font-semibold text-slate-600">
              <div className="space-y-1.5 font-sans">
                <label>同步任务备注名称 *</label>
                <input 
                  type="text"
                  required
                  value={syncForm.name}
                  onChange={(e)=>setSyncForm({...syncForm, name: e.target.value})}
                  placeholder="如: Github 超速 M3U IPv6 源"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 dark:border-slate-700 focus:outline-none placeholder-slate-400 text-slate-800"
                />
              </div>

              <div className="space-y-1.5 font-sans">
                <label>远程 M3U / TXT 源文件地址 URL *</label>
                <input 
                  type="url"
                  required
                  value={syncForm.url}
                  onChange={(e)=>setSyncForm({...syncForm, url: e.target.value})}
                  placeholder="https://raw.githubusercontent.com/..."
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono placeholder-slate-400 text-slate-800"
                />
                <p className="text-[10px] text-slate-400 font-medium font-sans">支持从 Github 转换 raw url 后直接请求导入新源。</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label>文件类型 (Format Type)</label>
                  <select 
                    value={syncForm.type}
                    onChange={(e)=>setSyncForm({...syncForm, type: e.target.value as "m3u" | "txt"})}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none font-bold text-slate-700 font-sans"
                  >
                    <option value="m3u">M3U Playlist 格式</option>
                    <option value="txt">TVBox TXT 格式</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label>自动定时同步后台自动拉取</label>
                  <div className="flex items-center gap-2.5 h-10">
                    <input 
                      type="checkbox" 
                      checked={syncForm.autoSync}
                      onChange={(e)=>setSyncForm({...syncForm, autoSync: e.target.checked})}
                      className="w-4 h-4 text-indigo-600 rounded"
                    />
                    <span className="font-sans">定时轮询拉取</span>
                  </div>
                </div>
              </div>

              {syncForm.autoSync && (
                <div className="space-y-1.5 animate-fade-in font-sans">
                  <label>自动轮询周期频度 (小时/h)</label>
                  <select 
                    value={syncForm.syncInterval}
                    onChange={(e)=>setSyncForm({...syncForm, syncInterval: Number(e.target.value)})}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none font-semibold text-slate-700"
                  >
                    <option value={1}>每隔 1 小时 (轮询检测)</option>
                    <option value={6}>每隔 6 小时</option>
                    <option value={12}>每隔 12 小时</option>
                    <option value={24}>每隔 24 小时 (每日晚间同步)</option>
                  </select>
                </div>
              )}

              <div className="space-y-1.5 font-sans" id="sync_form_isp_block">
                <label>强制将导入的直播源设置为特定运营商 (ISP)</label>
                <select 
                  value={syncForm.isp}
                  onChange={(e)=>setSyncForm({...syncForm, isp: e.target.value})}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none text-slate-700 font-bold"
                >
                  <option value="">自动解析并智能提取</option>
                  <option value="电信">中国电信</option>
                  <option value="联通">中国联通</option>
                  <option value="移动">中国移动</option>
                  <option value="广电">中国广电</option>
                  <option value="BGP">多线 BGP 专线</option>
                  <option value="其它">其它</option>
                </select>
                <p className="text-[10px] text-slate-400 font-normal">指定后，该订阅拉取产生的所有直播源都将统一且强制被赋予此 ISP 属性。</p>
              </div>

              <div className="flex gap-3 pt-3">
                <button 
                  type="button" 
                  onClick={()=>setIsSyncModalOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer text-center font-bold font-sans"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-50 rounded-xl cursor-pointer text-center font-bold font-sans shadow-md"
                >
                  {editingSync ? "保存修改" : "建立同步订阅"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal Dialog: Create/Update Live Play Source */}
      {isSourceModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" id="source_modal">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">
                {editingSource ? "维护修改直播线路链接" : `为 [ ${selectedChannel?.name} ] 添加新播放线路`}
              </h3>
              <button className="text-slate-400 hover:text-slate-600 font-bold" onClick={()=>setIsSourceModalOpen(false)}>✕</button>
            </div>
            
             <form onSubmit={handleSaveSource} className="space-y-4 text-xs font-semibold text-slate-600">
              <div className="space-y-1.5 font-semibold text-slate-600">
                <label>播放流源链接 (HLS / m3u8 / RTSP / FLV / rtmp) *</label>
                <input 
                  type="text"
                  required
                  value={sourceForm.url}
                  onChange={(e)=>setSourceForm({...sourceForm, url: e.target.value})}
                  placeholder="如 http://... 或 rtsp://..."
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label>提供线路线路的运营商 (ISP)</label>
                  <select
                    value={sourceForm.isp}
                    onChange={(e)=>setSourceForm({...sourceForm, isp: e.target.value})}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none"
                  >
                    <option value="电信">中国电信</option>
                    <option value="联通">中国联通</option>
                    <option value="移动">中国移动</option>
                    <option value="广电">中国广电</option>
                    <option value="BGP">多线 BGP 专线</option>
                    <option value="其它">其它</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label>播放源省份归属 (Province)</label>
                  <input 
                    type="text"
                    required
                    value={sourceForm.province}
                    onChange={(e)=>setSourceForm({...sourceForm, province: e.target.value})}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-3">
                <button 
                  type="button" 
                  onClick={()=>setIsSourceModalOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer text-center font-bold font-sans"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-50 rounded-xl cursor-pointer text-center font-bold font-sans shadow-md"
                >
                  保存直播源
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Modal Dialog: Batch Update Group */}
      {isBatchGroupModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans" id="batch_group_modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in font-sans">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800 font-sans">批量修改/调整频道分类 (共选中 {selectedChannelIds.length} 条频道)</h3>
              <button className="text-slate-400 hover:text-slate-600 font-bold" onClick={()=>setIsBatchGroupModalOpen(false)}>✕</button>
            </div>
            
            <form onSubmit={handleBatchGroupSubmit} className="space-y-4 text-xs font-semibold text-slate-600">
              <div className="space-y-1.5 font-sans">
                <label className="text-slate-700 block col-span-2">操作模式 *</label>
                <div className="flex gap-4 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="batchGroupMode"
                      checked={batchGroupForm.mode === "append"}
                      onChange={() => setBatchGroupForm({ ...batchGroupForm, mode: "append" })}
                      className="w-4 h-4 text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-700">追加分组 (保留并累加分类)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="batchGroupMode"
                      checked={batchGroupForm.mode === "replace"}
                      onChange={() => setBatchGroupForm({ ...batchGroupForm, mode: "replace" })}
                      className="w-4 h-4 text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-700">替换分组 (彻底重置原分类)</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-slate-700 block">选择目标分类 (可单选或多选) *</label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2.5 bg-slate-50/50 border border-slate-200 rounded-xl">
                  {groups.map((group) => {
                    const isGroupChecked = batchGroupForm.groupIds.includes(group.id);
                    return (
                      <label 
                        key={group.id} 
                        className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer select-none transition ${
                          isGroupChecked 
                            ? "bg-blue-50/60 border-blue-200 text-blue-700 font-bold" 
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                          checked={isGroupChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setBatchGroupForm({
                                ...batchGroupForm,
                                groupIds: [...batchGroupForm.groupIds, group.id]
                              });
                            } else {
                              setBatchGroupForm({
                                ...batchGroupForm,
                                groupIds: batchGroupForm.groupIds.filter(id => id !== group.id)
                              });
                            }
                          }}
                        />
                        <span className="truncate">{group.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400 font-medium font-sans leading-relaxed">
                  {batchGroupForm.mode === "append" 
                    ? "追加模式说明：所选频道如果原本不属于这些组，会被追加进去，原有的其他分组关系会被完整保留。" 
                    : "覆盖替换说明：所选频道原有的所有分组关系都将被清除，仅归属于在这个选择框里勾选的新分组。"}
                </p>
              </div>

              <div className="flex gap-3 pt-3">
                <button 
                  type="button" 
                  onClick={() => setIsBatchGroupModalOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer text-center font-bold"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-50 rounded-xl cursor-pointer text-center font-bold shadow-md shadow-indigo-150"
                >
                  确认批量更新分组
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Dialog: Import Sync Subscription backup JSON file or text */}
      {isImportSubscriptionsOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" id="import_subscriptions_modal">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in animate-scale-up">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 font-sans">
                <Upload className="w-4 h-4 text-violet-600" /> 导入 GitHub 周期同步订阅配置
              </h3>
              <button className="text-slate-400 hover:text-slate-600 font-bold font-sans" onClick={()=>setIsImportSubscriptionsOpen(false)}>✕</button>
            </div>
            
            <form onSubmit={handleImportSubscriptions} className="space-y-4 text-xs font-semibold text-slate-600">
              <div className="space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-150">
                <label className="text-slate-700 font-bold block mb-1">导入模式 (Import Strategy)</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input 
                      type="radio"
                      checked={importSubscriptionsMerge === true}
                      onChange={() => setImportSubscriptionsMerge(true)}
                      className="text-indigo-600 focus:ring-indigo-500 rounded-full"
                    />
                    <span>增量合并校验</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input 
                      type="radio" 
                      checked={importSubscriptionsMerge === false}
                      onChange={() => setImportSubscriptionsMerge(false)}
                      className="text-indigo-600 focus:ring-rose-500 rounded-full"
                    />
                    <span className="text-rose-600 font-bold hover:text-rose-800">完全覆盖抹平 (Overwrite)</span>
                  </label>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">粘贴订阅 JSON 备份文本或上传本地备份文件 *</label>
                
                {/* File input directly in modal */}
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-slate-200 border-dashed rounded-xl cursor-pointer bg-slate-50/50 hover:bg-slate-100/50 hover:border-violet-300 transition-all">
                    <div className="flex flex-col items-center justify-center pt-3 pb-3">
                      <Upload className="w-6 h-6 text-violet-500 mb-1" />
                      <p className="mb-0.5 text-[11px] text-slate-600"><span className="font-bold text-violet-600 hover:underline">点击选择本地 JSON 备份文件</span></p>
                      <p className="text-[9px] text-slate-400">仅限 JSON 格式的订阅源配置文件 (.json)</p>
                    </div>
                    <input 
                      type="file" 
                      accept=".json,application/json" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (evt) => {
                            const result = evt.target?.result;
                            if (typeof result === "string") {
                              setImportSubscriptionsContent(result);
                              showFeedback("success", `成功读取文件, 共 ${file.size} 字节`);
                            }
                          };
                          reader.readAsText(file);
                        }
                      }}
                    />
                  </label>
                </div>
                
                <textarea 
                  required
                  rows={8}
                  value={importSubscriptionsContent}
                  onChange={(e)=>setImportSubscriptionsContent(e.target.value)}
                  placeholder='如: [{"name":"央视源", "url":"https://raw.githubusercontent.com/...", "type":"m3u", "autoSync":true, "syncInterval":12}]'
                  className="w-full text-[10px] p-3 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono text-slate-700 leading-normal"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  type="button" 
                  onClick={()=>setIsImportSubscriptionsOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer text-center font-bold"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-50 rounded-xl cursor-pointer text-center font-bold animate-pulse-once"
                >
                  解析并完成订阅导入
                </button>
              </div>
            </form>
          </div>
        </div>
      )}




       {/* 3.2. Modal Dialog: Batch Update Playback Sources ISP / Province */}
      {isBatchSourceModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans" id="batch_source_modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">批量修改 {selectedSourceIds.length} 条播放线路的属性</h3>
              <button 
                className="text-slate-400 hover:text-slate-600 font-bold" 
                onClick={() => setIsBatchSourceModalOpen(false)}
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleBatchSourceUpdateSubmit} className="space-y-4 text-xs font-semibold text-slate-600">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-slate-700 block">目标运营商 (ISP)</label>
                  <select
                    value={batchSourceForm.isp}
                    onChange={(e) => setBatchSourceForm({ ...batchSourceForm, isp: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">-- 保持原样 (不作修改) --</option>
                    <option value="电信">中国电信</option>
                    <option value="联通">中国联通</option>
                    <option value="移动">中国移动</option>
                    <option value="广电">中国广电</option>
                    <option value="BGP">多线 BGP 专线</option>
                    <option value="其它">其它</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-700 block">省份归属 (Province)</label>
                  <input 
                    type="text"
                    value={batchSourceForm.province}
                    onChange={(e) => setBatchSourceForm({ ...batchSourceForm, province: e.target.value })}
                    placeholder="如：浙江、北京、全国 (留空代表：保持原样/不作处理)"
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none"
                  />
                </div>
                
                <p className="text-[10px] text-slate-400 font-medium font-sans mt-2 leading-relaxed">
                  提示：留空或选择默认选项的属性将不会覆盖原有信息，只有填写好的值才会批量应用覆盖。
                </p>
              </div>

              <div className="flex gap-3 pt-3">
                <button 
                  type="button" 
                  onClick={() => setIsBatchSourceModalOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-605 rounded-xl cursor-pointer text-center font-bold"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-50 rounded-xl cursor-pointer text-center font-bold shadow-md shadow-indigo-150"
                >
                  确认批量应用修改
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3.3. Modal Dialog: Global Batch Update Playback Sources ISP / Province / Status */}
      {isBatchGlobalSourceModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans" id="batch_global_source_modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">全域批量修改 {selectedGlobalSourceIds.length} 条播放线路属性</h3>
              <button 
                className="text-slate-400 hover:text-slate-600 font-bold" 
                onClick={() => setIsBatchGlobalSourceModalOpen(false)}
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleGlobalBatchUpdateSubmit} className="space-y-4 text-xs font-semibold text-slate-600">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-slate-700 block">目标运营商 (ISP)</label>
                  <select
                    value={batchGlobalSourceForm.isp}
                    onChange={(e) => setBatchGlobalSourceForm({ ...batchGlobalSourceForm, isp: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-indigo-500 font-bold"
                  >
                    <option value="">-- 保持原样 (不作修改) --</option>
                    <option value="电信">中国电信</option>
                    <option value="联通">中国联通</option>
                    <option value="移动">中国移动</option>
                    <option value="广电">中国广电</option>
                    <option value="BGP">多线 BGP 专线</option>
                    <option value="其它">其它</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-700 block">省份归属 (Province)</label>
                  <input 
                    type="text"
                    value={batchGlobalSourceForm.province}
                    onChange={(e) => setBatchGlobalSourceForm({ ...batchGlobalSourceForm, province: e.target.value })}
                    placeholder="如：浙江、北京、全国 (留空代表：保持原样/不作处理)"
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-bold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-700 block">线路可用状态 (Status)</label>
                  <select
                    value={batchGlobalSourceForm.status}
                    onChange={(e) => setBatchGlobalSourceForm({ ...batchGlobalSourceForm, status: e.target.value })}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:border-indigo-500 font-bold"
                  >
                    <option value="">-- 保持原样 (不作修改) --</option>
                    <option value="active">🟢 保持健康/活跃 (Active)</option>
                    <option value="inactive">🔴 设为故障/失效 (Inactive)</option>
                    <option value="checking">🟡 设为正在测速中 (Checking)</option>
                    <option value="unknown">⚪ 设为未知状态 (Unknown)</option>
                  </select>
                </div>
                
                <p className="text-[10px] text-slate-400 font-medium font-sans mt-2 leading-relaxed">
                  提示：留空或选择默认选项的属性将不会覆盖原有信息，只有指定好的属性值才会批量应用覆盖到所有选定线路。
                </p>
              </div>

              <div className="flex gap-3 pt-3">
                <button 
                  type="button" 
                  onClick={() => setIsBatchGlobalSourceModalOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-605 rounded-xl cursor-pointer text-center font-bold"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-50 rounded-xl cursor-pointer text-center font-bold shadow-md shadow-indigo-150"
                >
                  确认批量应用修改
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Merge Modal */ }
      {isMergeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans" id="merge_modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">合并 {selectedChannelIds.length} 个电视频道</h3>
              <button 
                className="text-slate-400 hover:text-slate-600 font-bold" 
                onClick={() => setIsMergeModalOpen(false)}
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                请选择一个电视频道作为<b>主频道</b>。合并后，主频道的名称、分组将作为基础，其他频道的名称会被加入别名列表，所有播放线路将自动合并并去重。
              </p>
              
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  选择主频道
                </label>
                <select 
                  value={primaryMergeChannelId}
                  onChange={(e) => setPrimaryMergeChannelId(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition"
                >
                  <option value="auto">🌟 自动选择 (推荐完整度最高的)</option>
                  {channels
                    .filter(ch => selectedChannelIds.includes(ch.id))
                    .map(ch => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button 
                type="button"
                onClick={() => setIsMergeModalOpen(false)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 transition cursor-pointer"
              >
                取消
              </button>
              <button 
                type="button"
                onClick={executeMerge}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition cursor-pointer flex items-center gap-1.5"
              >
                确认合并
              </button>
            </div>
          </div>
        </div>
      )}

      {isSettingPasswordModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" id="security_password_modal">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 flex flex-col space-y-5 animate-fade-in">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-extrabold text-slate-800">安全密码校验保护设置</h3>
              </div>
              <button 
                className="text-slate-400 hover:text-slate-600 font-bold transition text-xs" 
                onClick={() => setIsSettingPasswordModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
              启用密码校验保护后，管理及写入操作需要验证，这有助于保障您的 IPTV 频道及配置文件不受随意篡改。
            </p>

            <form onSubmit={handleUpdatePassword} className="space-y-4 text-xs font-semibold text-slate-600">
              {isAuthRequired && (
                <div className="space-y-1.5">
                  <label className="block text-slate-700">当前校验密码 *</label>
                  <input 
                    type="password"
                    required
                    value={passwordForm.oldPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                    placeholder="请输入您当前的管理密码"
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-slate-700">新安全密码 (留空则代表取消密码保卫)</label>
                <input 
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  placeholder="留空表示取消保护"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none"
                />
              </div>

              {passwordForm.newPassword && (
                <div className="space-y-1.5 animate-slide-in">
                  <label className="block text-slate-700">确认新安全密码 *</label>
                  <input 
                    type="password"
                    required
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                    placeholder="请再次属实输入新密码"
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none"
                  />
                </div>
              )}

              <div className="flex gap-2.5 pt-2">
                <button 
                  type="button"
                  onClick={() => setIsSettingPasswordModalOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl transition text-center text-xs font-bold"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition text-center text-xs font-bold shadow-md shadow-indigo-100"
                >
                  保存设置
                </button>
              </div>
            </form>

            {isAuthRequired && (
              <div className="border-t border-slate-100 pt-4 flex flex-col items-center">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="py-2 px-4 border border-rose-100 hover:bg-rose-50 text-rose-600 rounded-xl text-xs font-bold transition flex items-center gap-2"
                >
                  Lock
                  🔒 立即锁定并退出管理会话
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" id="confirm_modal_popup">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-150 space-y-4 flex flex-col animate-fade-in animate-duration-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-black text-slate-800">{confirmModal.title}</h3>
            </div>
            <p className="text-xs text-slate-500 font-semibold leading-relaxed">{confirmModal.message}</p>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="w-1/2 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs rounded-xl font-bold cursor-pointer transition text-center"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                className="w-1/2 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs rounded-xl font-bold cursor-pointer transition text-center shadow-lg shadow-rose-600/10"
              >
                确认继续
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
