import React, { useState, useEffect } from "react";
import { 
  Tv, 
  Activity, 
  Compass, 
  CheckCircle, 
  XCircle, 
  Plus, 
  Trash2, 
  Edit2, 
  RefreshCw, 
  Download, 
  Search, 
  Filter, 
  ExternalLink,
  Copy,
  Clock,
  Settings,
  AlertCircle,
  UploadCloud,
  Check,
  Calendar,
  Layers,
  Zap,
  Play,
  FileText,
  Database,
  Shield
} from "lucide-react";
import { Channel, LiveSource, SyncConfig, TestStatus, EpgGuide, Group } from "./types";
import DashboardView from "./components/DashboardView";

export default function App() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [syncConfigs, setSyncConfigs] = useState<SyncConfig[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [testingStatus, setTestingStatus] = useState<TestStatus>({ status: "idle", total: 0, checked: 0, results: [] });
  const [activeTab, setActiveTab] = useState<string>("dashboard"); // dashboard, channels, sync, export, epg
  const [channelSubTab, setChannelSubTab] = useState<"channels" | "groups">("channels");
  
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
    syncInterval: 12
  });

  // Manual Text Import paste box
  const [pasteContent, setPasteContent] = useState("");
  const [pasteType, setPasteType] = useState<"m3u" | "txt">("m3u");
  const [isImportingText, setIsImportingText] = useState(false);

  // EPG preview guide state
  const [epgGuide, setEpgGuide] = useState<EpgGuide | null>(null);
  const [epgLoading, setEpgLoading] = useState(false);

  // Batch channel operations state
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [isBatchGroupModalOpen, setIsBatchGroupModalOpen] = useState(false);
  const [batchGroupForm, setBatchGroupForm] = useState<{ groupIds: string[] }>({ groupIds: [] });

  // Batch live source operations state
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [isBatchSourceModalOpen, setIsBatchSourceModalOpen] = useState(false);
  const [batchSourceForm, setBatchSourceForm] = useState({
    isp: "",
    province: ""
  });

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

  // Playback Export config builder parameters
  const [exportParams, setExportParams] = useState({
    isp: "",
    province: "",
    status: "",
    limit: "",
  });

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
    if (activeTab === "backup") {
      fetchBackups();
    }
  }, [activeTab]);

  // Load Channels, Groups & Configurations
  const fetchData = async () => {
    try {
      const [resChannels, resSync, resGroups] = await Promise.all([
        fetch("/api/channels"),
        fetch("/api/sync-configs"),
        fetch("/api/groups")
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
    } catch (err) {
      showFeedback("error", "连接服务器读取数据失败");
    } finally {
      setLoading(false);
    }
  };

  // Adaptive, resilient polling for testing status
  useEffect(() => {
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
            const resChannels = await fetch("/api/channels");
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
  }, []);

  const showFeedback = (type: "success" | "error" | "info", text: string) => {
    setFeedbackMsg({ type, text });
    setTimeout(() => {
      setFeedbackMsg(null);
    }, 4500);
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
        fetchData();
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
            fetchData();
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
            fetchData();
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

  const openBatchGroupModal = () => {
    if (selectedChannelIds.length === 0) {
      showFeedback("info", "请先选择需要编辑分组的频道");
      return;
    }
    setBatchGroupForm({ groupIds: [] });
    setIsBatchGroupModalOpen(true);
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
          groupIds: batchGroupForm.groupIds
        })
      });

      if (res.ok) {
        showFeedback("success", `成功将已选的 ${selectedChannelIds.length} 个频道的分组更新`);
        setIsBatchGroupModalOpen(false);
        setSelectedChannelIds([]);
        fetchData();
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
            fetchData();
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
            fetchData();
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
        fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "批量更新播放线路失败");
      }
    } catch (e) {
      showFeedback("error", "网络连接异常");
    }
  };

  const openChannelCreate = () => {
    setEditingChannel(null);
    setChannelForm({
      name: "",
      groupIds: groups.length > 0 ? [groups[0].id] : [],
      newGroupsString: "",
      logo: "https://vfiles.gtimg.cn/vupload/20210729/cf2b0d1627514936398.png",
      alias: "",
      epgId: ""
    });
    setIsChannelModalOpen(true);
  };

  const openChannelEdit = (ch: Channel) => {
    setEditingChannel(ch);
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
        fetchData();
      } else {
        const err = await res.json();
        showFeedback("error", err.error || "操作线路失败");
      }
    } catch (e) {
      showFeedback("error", "操作线路出错");
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
            fetchData();
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
        fetchData();
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
            fetchData();
          }
        } catch (e) {
           showFeedback("error", "删除发生问题");
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
        fetchData();
      } else {
        showFeedback("error", data.error || "拉取过程产生错误");
      }
    } catch (e) {
      showFeedback("error", "请求异常，请检查 Github URL 是否通畅");
    }
  };

  const openSyncCreate = () => {
    setEditingSync(null);
    setSyncForm({
      name: "",
      url: "",
      type: "m3u",
      autoSync: true,
      syncInterval: 12
    });
    setIsSyncModalOpen(true);
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
            fetchData();
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
        fetchData();
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
            onClick={() => {
              setActiveTab("channels");
              fetchData();
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

          {/* Quick Stats sidebar banner */}
          <div className="pt-6 border-t border-slate-100 mt-6 px-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">系统健康率</span>
            <div className="mt-2.5 bg-slate-50 rounded-xl p-3 border border-slate-100/50">
              <div className="flex justify-between items-center text-[11px] mb-1 font-semibold text-slate-500">
                <span>总共 {channels.length} 频道</span>
                <span className="text-emerald-600 font-bold">
                  {channels.length ? Math.round((channels.filter(c => c.sources.some(s => s.status === "active")).length / channels.length) * 100) : 0}% 良好率
                </span>
              </div>
              <div className="w-full bg-slate-200/60 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-emerald-500 h-full rounded-full transition-all duration-300" 
                  style={{ width: `${channels.length ? (channels.filter(c => c.sources.some(s => s.status === "active")).length / channels.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Footer Copyable Endpoint info */}
        <div className="p-4 border-t border-slate-100">
          <div className="bg-slate-900 rounded-2xl p-4 text-white">
            <p className="text-[10px] text-slate-400 mb-1 font-mono uppercase tracking-wider">标准 M3U 播放源 URL</p>
            <p className="text-xs font-mono truncate text-blue-300">{getFullHostUrl()}/api/export/m3u</p>
            <button 
              onClick={() => copyTextToClipboard(`${getFullHostUrl()}/api/export/m3u`)}
              className="mt-3 w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold tracking-wide rounded-lg scroll-px-1.5 transition-colors cursor-pointer text-slate-200"
            >
              一键复制源链接
            </button>
          </div>
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
              {activeTab === "sync" && "M3U / TXT 网络同步订阅与自定义文件导入"}
              {activeTab === "export" && "播放接口配置生成工具"}
              {activeTab === "backup" && "数据备份与系统完整恢复"}
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
              </div>

              {channelSubTab === "groups" ? (
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
                            fetchData();
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
                                      fetchData();
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

                            <button
                              onClick={() => {
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
                                        fetchData();
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
              ) : (
                <div className="space-y-6" id="groups_inner_channels_pane">
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
                      filteredChannels.map((ch) => {
                        const isSelected = selectedChannel?.id === ch.id;
                        const isChecked = selectedChannelIds.includes(ch.id);
                        const activeCount = ch.sources.filter(s => s.status === "active").length;
                        return (
                          <div 
                            key={ch.id}
                            onClick={() => {
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
                              <img 
                                src={ch.logo || "https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80"}
                                alt="logo"
                                className="w-8 h-8 rounded-lg object-contain bg-slate-100 p-0.5 shadow-xs flex-shrink-0"
                                onError={(e)=>{ (e.target as HTMLImageElement).src="https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80" }}
                              />
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
                  </div>
                </div>

                {/* Right side playback playline items details view */}
                <div className="lg:col-span-7 space-y-4" id="stream_lines_control_container">
                  {selectedChannel ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5" id="line_manager_main">
                      
                      {/* Sub header for channel detail view */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                          <img 
                            src={selectedChannel.logo} 
                            alt="logo" 
                            className="w-10 h-10 rounded-xl object-contain bg-slate-50 border p-1"
                            onError={(e)=>{ (e.target as HTMLImageElement).src="https://images.unsplash.com/photo-1598257006458-087169a1f08d?auto=format&fit=crop&w=48&h=48&q=80" }}
                          />
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
                            <span className="flex items-center"><Clock className="w-4 h-4 mr-1.5 text-indigo-600" />  EPG 实时节目导视表 [ {epgGuide.epgId} ]</span>
                            <button className="text-[10px] text-slate-400 font-semibold" onClick={()=>setEpgGuide(null)}>关闭预览</button>
                          </div>
                          
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
                              <span className="text-xs font-bold text-slate-500">已接入线路列表 ({selectedChannel.sources.length} 条)</span>
                            </div>
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
                          <div className="space-y-2.5">
                            {selectedChannel.sources.map((src, index) => {
                              const isChecked = selectedSourceIds.includes(src.id);
                              return (
                                <div 
                                  key={src.id} 
                                  className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors ${
                                    isChecked ? "bg-blue-50/20 border-blue-200" :
                                    src.status === "active" ? "bg-emerald-50/15 border-emerald-100" :
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
                                          <span className="text-emerald-700 font-bold bg-emerald-100/50 px-1.5 py-0.5 rounded text-[10px] font-mono">
                                            延迟: {src.latency !== undefined ? `${src.latency}ms` : "在线"}
                                          </span>
                                        )}
                                        {src.status === "inactive" && (
                                          <span className="text-rose-700 font-bold bg-rose-100/50 px-1.5 py-0.5 rounded text-[10px]">
                                            连接超时 (DEAD)
                                          </span>
                                        )}
                                        {src.status === "checking" && (
                                          <span className="text-blue-700 font-bold bg-blue-100 animate-pulse px-1.5 py-0.5 rounded text-[10px]">
                                            正在验证中...
                                          </span>
                                        )}
                                        {src.status === "unknown" && (
                                          <span className="text-slate-500 font-bold bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">
                                            未测试
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
                                    <button 
                                      onClick={() => handleDeleteSource(src.id)}
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
                  <div className="flex justify-between items-center pb-1">
                    <h3 className="font-bold text-slate-800 text-sm">GitHub 直播源自动周期同步</h3>
                    <button 
                      onClick={openSyncCreate}
                      className="text-indigo-600 hover:text-indigo-800 border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/50 px-3.5 py-1.5 rounded-xl font-bold text-[10px] transition cursor-pointer flex items-center"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      添加自动同步订阅
                    </button>
                  </div>

                  <div className="space-y-4 flex-1 overflow-y-auto max-h-[460px]">
                    {syncConfigs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-350">
                        <Compass className="w-14 h-14 stroke-[1]" />
                        <p className="text-xs font-semibold mt-2">暂无安排任何自动化定时同步源</p>
                      </div>
                    ) : (
                      syncConfigs.map((cfg) => (
                        <div key={cfg.id} className="p-4 rounded-xl border border-slate-200 space-y-2.5 bg-slate-50/40">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <p className="text-xs font-bold text-slate-800">{cfg.name}</p>
                              <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-sm">{cfg.url}</p>
                            </div>
                            
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className={`text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                                cfg.autoSync ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                              }`}>
                                {cfg.autoSync ? `定时 ${cfg.syncInterval}h` : "手动触发"}
                              </span>
                              
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                cfg.status === "success" ? "bg-emerald-50 text-emerald-700" :
                                cfg.status === "failed" ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500"
                              }`}>
                                {cfg.status === "success" && "同步顺畅"}
                                {cfg.status === "failed" && "同步断流"}
                                {cfg.status === "never" && "从未触发"}
                              </span>
                            </div>
                          </div>

                          {/* Last synced metadata message banner */}
                          <div className="text-[10px] text-slate-500 bg-white p-2.5 rounded-lg border border-slate-100 flex justify-between items-center gap-2">
                            <span className="truncate">{cfg.message || "准备拉取"}</span>
                            <span className="text-slate-400 font-mono flex-shrink-0">
                              {cfg.lastSynced ? new Date(cfg.lastSynced).toLocaleTimeString() : "未同步"}
                            </span>
                          </div>

                          {/* Quick action controls */}
                          <div className="flex justify-between pt-1">
                            <button 
                              onClick={() => triggerManualSyncRun(cfg.id)}
                              className="text-indigo-600 hover:text-indigo-800 hover:underline text-[11px] font-bold flex items-center cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3 mr-1" /> 立即手动拉取并覆盖同步
                            </button>
                            
                            <div className="flex gap-2">
                              <button 
                                onClick={() => {
                                  setEditingSync(cfg);
                                  setSyncForm({
                                    name: cfg.name,
                                    url: cfg.url,
                                    type: cfg.type,
                                    autoSync: cfg.autoSync,
                                    syncInterval: cfg.syncInterval
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
                        <a 
                          href={`${getFullHostUrl()}/api/export/m3u${getExportQueries()}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 font-bold text-[10px]"
                        >
                          立即下载文件 <ExternalLink className="w-3 h-3" />
                        </a>
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
                        <a 
                          href={`${getFullHostUrl()}/api/export/txt${getExportQueries()}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-orange-600 hover:text-orange-850 hover:underline flex items-center gap-1 font-bold text-[10px]"
                        >
                          下载 TXT 源文件 <ExternalLink className="w-3 h-3" />
                        </a>
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
                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-800 flex items-center">
                          <Calendar className="w-4 h-4 mr-1.5 text-violet-500" /> XMLTV EPG (Electronic Program Guide) Feed
                        </span>
                        <a 
                          href={`${getFullHostUrl()}/api/export/epg.xml`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-violet-600 hover:text-violet-800 hover:underline flex items-center gap-1 font-bold text-[10px]"
                        >
                          打开 XMLTV 文档 <ExternalLink className="w-3 h-3" />
                        </a>
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
                      <p className="text-[10px] text-slate-400">输出完全遵循 xmltv 国际通用规范，电视频道 EPG epgId 动态对应，供您的播放器自动拉取显示精确时间轴海报日程。</p>
                    </div>

                  </div>
                </div>

              </div>
            </div>
          )}

          {/* VIEW: SYSTEM BACKUP & RESTORE MANAGEMENT */}
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
                                  <a
                                    href={`/api/backups/download/${encodeURIComponent(back.filename)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg transition text-[11px] inline-flex items-center gap-1"
                                    title="下载到本地"
                                  >
                                    <Download className="w-3 h-3" />
                                    下载
                                  </a>
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" id="channel_modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">{editingChannel ? "修改 IPTV 频道元数据" : "建立新收录 IPTV 频道"}</h3>
              <button className="text-slate-400 hover:text-slate-600 font-bold" onClick={()=>setIsChannelModalOpen(false)}>✕</button>
            </div>
            
            <form onSubmit={handleSaveChannel} className="space-y-4 text-xs font-semibold text-slate-600">
              <div className="space-y-1.5">
                <label>频道标准中文名称 (Standard Name) *</label>
                <input 
                  type="text"
                  required
                  value={channelForm.name}
                  onChange={(e)=>setChannelForm({...channelForm, name: e.target.value})}
                  placeholder="如: CCTV-1 综合"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label>关联直播分类 (选择一个或多个分组) *</label>
                  <div className="border border-slate-200 rounded-xl bg-slate-50 p-2.5 max-h-32 overflow-y-auto space-y-1" id="group_checkboxes_pnl">
                    {groups.map((g) => {
                      const isChecked = channelForm.groupIds.includes(g.id);
                      return (
                        <label key={g.id} className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-100/50 rounded px-1.5">
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

                <div className="space-y-1.5 flex flex-col justify-between">
                  <div>
                    <label>创建并关联新分类 (动态逗号分隔)</label>
                    <input
                      type="text"
                      value={channelForm.newGroupsString}
                      onChange={(e)=>setChannelForm({...channelForm, newGroupsString: e.target.value})}
                      placeholder="如: 黑龙江卫视, 蓝光专区"
                      className="w-full text-xs p-2.5 mt-1 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium leading-relaxed">可以直接在这输入想加入的新类型，保存时系统会自动帮您创建组并关联，实现多对多绑定。</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label>EPG 节目匹配 ID (epgId) *</label>
                <input 
                  type="text"
                  required
                  value={channelForm.epgId}
                  onChange={(e)=>setChannelForm({...channelForm, epgId: e.target.value})}
                  placeholder="如: cctv1"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label>频道台标图片图标 (Logo URL)</label>
                <input 
                  type="url"
                  value={channelForm.logo}
                  onChange={(e)=>setChannelForm({...channelForm, logo: e.target.value})}
                  placeholder="https://..."
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label>匹配兼容等别名 (Comma Separated)</label>
                <input 
                  type="text"
                  value={channelForm.alias}
                  onChange={(e)=>setChannelForm({...channelForm, alias: e.target.value})}
                  placeholder="如: CCTV1, 中央一套, CCTV-1 HD"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none"
                />
                <p className="text-[10px] text-slate-400 font-medium">导入不同直播源时，只要名字撞到了这些别名，就会自动归为此频道的源。</p>
              </div>

              <div className="flex gap-3 pt-3">
                <button 
                  type="button" 
                  onClick={()=>setIsChannelModalOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer text-center font-bold"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-50 rounded-xl cursor-pointer text-center font-bold"
                >
                  保存设置
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
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer text-center font-bold"
                >
                  放弃取消
                </button>
                <button 
                  type="submit" 
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-50 rounded-xl cursor-pointer text-center font-bold"
                >
                  保存直播源
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Modal Dialog: Create/Update Scheduled Sync Subscription */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" id="sync_modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">{editingSync ? "修改定时拉取任务" : "建立新增从网络 URL 拉取同步"}</h3>
              <button className="text-slate-400 hover:text-slate-600 font-bold" onClick={()=>setIsSyncModalOpen(false)}>✕</button>
            </div>
            
            <form onSubmit={handleSaveSync} className="space-y-4 text-xs font-semibold text-slate-600">
              <div className="space-y-1.5">
                <label>同步任务备注名称 *</label>
                <input 
                  type="text"
                  required
                  value={syncForm.name}
                  onChange={(e)=>setSyncForm({...syncForm, name: e.target.value})}
                  placeholder="如: Github 超速 M3U IPv6 源"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 dark:border-slate-700 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label>远程 M3U / TXT 源文件地址 URL *</label>
                <input 
                  type="url"
                  required
                  value={syncForm.url}
                  onChange={(e)=>setSyncForm({...syncForm, url: e.target.value})}
                  placeholder="https://raw.githubusercontent.com/..."
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:border-indigo-500 bg-slate-50 focus:outline-none font-mono"
                />
                <p className="text-[10px] text-slate-400 font-medium">支持从 Github 转换 raw url 后直接请求导入新源。</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label>文件类型 (Format Type)</label>
                  <select 
                    value={syncForm.type}
                    onChange={(e)=>setSyncForm({...syncForm, type: e.target.value as "m3u" | "txt"})}
                    className="w-full text-xs p-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:outline-none font-bold text-slate-700"
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
                    <span>定时轮询拉取</span>
                  </div>
                </div>
              </div>

              {syncForm.autoSync && (
                <div className="space-y-1.5">
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

              <div className="flex gap-3 pt-3">
                <button 
                  type="button" 
                  onClick={()=>setIsSyncModalOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl cursor-pointer text-center font-bold"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="w-2/3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-50 rounded-xl cursor-pointer text-center font-bold"
                >
                  建立同步订阅
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3.1. Modal Dialog: Batch Update Channel Groups */}
      {isBatchGroupModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 font-sans" id="batch_group_modal">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 flex flex-col animate-fade-in">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">批量设置 {selectedChannelIds.length} 个视讯的分组</h3>
              <button 
                className="text-slate-400 hover:text-slate-600 font-bold" 
                onClick={() => setIsBatchGroupModalOpen(false)}
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleBatchGroupSubmit} className="space-y-4 text-xs font-semibold text-slate-600">
              <div className="space-y-2">
                <label className="text-slate-700 block">选择目标分组 *</label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2.5 bg-slate-50/50 border border-slate-200 rounded-xl">
                  {groups.map((group) => {
                    const isGroupChecked = batchGroupForm.groupIds.includes(group.id);
                    return (
                      <label 
                        key={group.id} 
                        className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer select-none transition ${
                          isGroupChecked 
                            ? "bg-blue-50/60 border-blue-200 text-blue-700" 
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
                                groupIds: [...batchGroupForm.groupIds, group.id]
                              });
                            } else {
                              setBatchGroupForm({
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
                <p className="text-[10px] text-slate-400 font-medium font-sans">
                  提示：选中的频道将被分配到勾选的所有分组中，不在勾选列表中的分组关系将被剥离。
                </p>
              </div>

              <div className="flex gap-3 pt-3">
                <button 
                  type="button" 
                  onClick={() => setIsBatchGroupModalOpen(false)}
                  className="w-1/3 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-605 rounded-xl cursor-pointer text-center font-bold"
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
