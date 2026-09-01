import React, { useState, useMemo, useEffect } from 'react';
import { History, Trash2, MapPin, Globe, Zap, Users, RefreshCw, BarChart2, Filter, Search, Terminal, Laptop, HardDrive } from 'lucide-react';
import { Channel } from '../types';
import { Activity, Copy, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { authFetch as fetch } from "../utils/api";

interface StatsViewProps {
  channels: Channel[];
  initialSubTab?: "client_access" | "current" | "history";
}

export default function StatsView({ channels, initialSubTab = "client_access" }: StatsViewProps) {
  const [filterType, setFilterType] = useState<"all" | "unstable">("all");
  const [search, setSearch] = useState("");
  const [reports, setReports] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"client_access" | "current" | "history">(initialSubTab);
  const [selectedReport, setSelectedReport] = useState<any>(null);

  // Client access statistics state
  const [clientStats, setClientStats] = useState<any>(null);
  const [clientStatsLoading, setClientStatsLoading] = useState(false);
  const [clientEndpointFilter, setClientEndpointFilter] = useState("all");
  const [clientSearchFilter, setClientSearchFilter] = useState("");

  useEffect(() => {
    if (initialSubTab) {
      setActiveTab(initialSubTab);
    }
  }, [initialSubTab]);

  const fetchReports = async () => {
    try {
      const password = localStorage.getItem("iptv_admin_password") || "";
      const res = await fetch("/api/test-reports", {
        headers: { "x-admin-password": password }
      });
      if (res.ok) {
        setReports(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchClientStats = async () => {
    setClientStatsLoading(true);
    try {
      const password = localStorage.getItem("iptv_admin_password") || "";
      const url = new URL("/api/stats/client-access", window.location.origin);
      if (clientEndpointFilter && clientEndpointFilter !== "all") {
        url.searchParams.append("endpoint", clientEndpointFilter);
      }
      if (clientSearchFilter) {
        url.searchParams.append("search", clientSearchFilter);
      }
      url.searchParams.append("limit", "150");

      const res = await fetch(url.toString(), {
        headers: { "x-admin-password": password }
      });
      if (res.ok) {
        const data = await res.json();
        setClientStats(data);
      }
    } catch (e) {
      console.error("[CLIENT STATS FETCH ERROR]", e);
    } finally {
      setClientStatsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "history") {
      fetchReports();
    } else if (activeTab === "client_access") {
      fetchClientStats();
    }
  }, [activeTab, clientEndpointFilter, clientSearchFilter]);

  const handleClearClientLogs = async () => {
    if (!confirm("确定要清空所有客户端访问日志数据吗？清空后无法撤销。")) return;
    try {
      const password = localStorage.getItem("iptv_admin_password") || "";
      const res = await fetch("/api/stats/client-access/clear", {
        method: "POST",
        headers: { "x-admin-password": password }
      });
      if (res.ok) {
        fetchClientStats();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const viewReportDetails = async (id: string) => {
    try {
      const password = localStorage.getItem("iptv_admin_password") || "";
      const res = await fetch(`/api/test-reports/${id}`, {
        headers: { "x-admin-password": password }
      });
      if (res.ok) {
        setSelectedReport(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  const deleteReport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("确定要删除这条测速记录吗？")) {
      try {
        const password = localStorage.getItem("iptv_admin_password") || "";
        const res = await fetch(`/api/test-reports/${id}`, { 
          method: "DELETE",
          headers: { "x-admin-password": password }
        });
        if (res.ok) {
          fetchReports();
          if (selectedReport?.id === id) {
            setSelectedReport(null);
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  const channelStats = useMemo(() => {
    return channels.map(ch => {
      const total = ch.sources.length;
      const active = (ch.sources || []).filter(s => s.status === 'active' && (!s.latency || s.latency < 9999) && !s.isolated).length;
      const inactive = (ch.sources || []).filter(s => (s.status === 'inactive' || (s.latency !== undefined && s.latency >= 9999)) && !s.isolated).length;
      const checking = (ch.sources || []).filter(s => s.status === 'checking' && !s.isolated).length;
      const unknown = (ch.sources || []).filter(s => s.status === 'unknown' && !s.isolated).length;
      const isolated = (ch.sources || []).filter(s => s.isolated).length;
      
      const isUnstable = active < 2;

      return {
        ...ch,
        stats: { total, active, inactive, checking, unknown, isolated, isUnstable }
      };
    }).sort((a, b) => {
      if (a.stats.isUnstable && !b.stats.isUnstable) return -1;
      if (!a.stats.isUnstable && b.stats.isUnstable) return 1;
      return a.stats.active - b.stats.active;
    });
  }, [channels]);

  const filteredStats = useMemo(() => {
    return (channelStats || []).filter(ch => {
      if (filterType === "unstable" && !ch.stats.isUnstable) return false;
      if (search && !ch.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [channelStats, filterType, search]);

  const totalChannels = channels.length;
  const unstableChannelsCount = (channelStats || []).filter(c => c.stats.isUnstable).length;

  const getEndpointBadge = (endpoint: string) => {
    switch (endpoint) {
      case 'm3u':
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">M3U 订阅</span>;
      case 'txt':
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-200">TXT (TVBox)</span>;
      case 'epg_xml':
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">EPG XML</span>;
      case 'epg_gz':
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">EPG XML.GZ</span>;
      case 'epg_guide':
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">EPG 导视</span>;
      case 'play':
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">频道直连</span>;
      case 'client_test_list':
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-teal-100 text-teal-800 border border-teal-200">客户端测速</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700">{endpoint}</span>;
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6 animate-fade-in" id="tab_stats_view">
      {/* Sub-tab Switcher */}
      <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-max overflow-x-auto">
        <button
          onClick={() => setActiveTab("client_access")}
          className={`flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
            activeTab === "client_access"
              ? "bg-white text-indigo-700 shadow-xs"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          客户端接口访问统计
        </button>
        <button
          onClick={() => setActiveTab("current")}
          className={`flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
            activeTab === "current"
              ? "bg-white text-indigo-700 shadow-xs"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          当前频道健康度
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
            activeTab === "history"
              ? "bg-white text-indigo-700 shadow-xs"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <History className="w-3.5 h-3.5" />
          历次并发测速记录
        </button>
      </div>

      {/* 1. CLIENT ACCESS STATS TAB */}
      {activeTab === "client_access" && (
        <div className="space-y-6 animate-fade-in">
          {/* Top Control Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-sm font-black text-slate-800 flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-600" />
                客户端 API 访问统计与监控
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                实时记录播放器、TVBox、EPG 软件及第三方客户端调用的订阅与节目单接口
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-48">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="搜索 IP / 软件 / 归属地..."
                  value={clientSearchFilter}
                  onChange={(e) => setClientSearchFilter(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-indigo-500 bg-white"
                />
              </div>
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={clientEndpointFilter}
                  onChange={(e) => setClientEndpointFilter(e.target.value)}
                  className="text-xs font-semibold text-slate-700 bg-transparent outline-none cursor-pointer"
                >
                  <option value="all">全部接口</option>
                  <option value="m3u">M3U 订阅接口</option>
                  <option value="txt">TXT (TVBox) 接口</option>
                  <option value="epg_xml">EPG XML 节目单</option>
                  <option value="epg_gz">EPG XML.GZ 压缩包</option>
                  <option value="epg_guide">EPG 频道导视</option>
                  <option value="play">频道直连播放</option>
                  <option value="client_test_list">客户端测速接口</option>
                </select>
              </div>
              <button
                onClick={fetchClientStats}
                disabled={clientStatsLoading}
                className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${clientStatsLoading ? "animate-spin" : ""}`} />
                刷新
              </button>
              <button
                onClick={handleClearClientLogs}
                className="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                清空日志
              </button>
            </div>
          </div>

          {/* Overview Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase">累计请求数</p>
                <p className="text-xl font-black text-slate-800">
                  {clientStats?.overview?.totalRequests?.toLocaleString() || 0}
                </p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase">今日请求总数</p>
                <p className="text-xl font-black text-emerald-700">
                  {clientStats?.overview?.todayRequests?.toLocaleString() || 0}
                </p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                <BarChart2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase">24小时请求量</p>
                <p className="text-xl font-black text-sky-700">
                  {clientStats?.overview?.last24hRequests?.toLocaleString() || 0}
                </p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase">独立客户端 IP</p>
                <p className="text-xl font-black text-purple-800">
                  {clientStats?.overview?.uniqueIpsTotal || 0} <span className="text-xs font-normal text-slate-400">(今日 {clientStats?.overview?.uniqueIpsToday || 0})</span>
                </p>
              </div>
            </div>
          </div>

          {/* Visual Breakdown Panels Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Endpoint Breakdown */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
                <HardDrive className="w-4 h-4 text-indigo-500" />
                接口请求类型分布
              </h3>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {clientStats?.byEndpoint?.map((ep: any, idx: number) => {
                  const pct = clientStats.overview.totalRequests > 0 
                    ? Math.round((ep.total / clientStats.overview.totalRequests) * 100) 
                    : 0;
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <div className="flex items-center gap-1.5">
                          {getEndpointBadge(ep.endpoint)}
                        </div>
                        <span className="font-mono text-slate-600 font-bold">
                          {ep.total} 次 <span className="text-[10px] text-slate-400 font-normal">({pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-indigo-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                      </div>
                    </div>
                  );
                })}
                {(!clientStats?.byEndpoint || clientStats.byEndpoint.length === 0) && (
                  <p className="text-xs text-slate-400 text-center py-6">暂无接口统计数据</p>
                )}
              </div>
            </div>

            {/* 2. Client App / Player Distribution */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
                <Laptop className="w-4 h-4 text-emerald-500" />
                播放器客户端分布
              </h3>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {clientStats?.byClientApp?.map((app: any, idx: number) => {
                  const pct = clientStats.overview.totalRequests > 0 
                    ? Math.round((app.total / clientStats.overview.totalRequests) * 100) 
                    : 0;
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-700 truncate max-w-[140px]" title={app.clientApp}>
                          {app.clientApp}
                        </span>
                        <span className="font-mono text-slate-600 font-bold">
                          {app.total} 次 <span className="text-[10px] text-slate-400 font-normal">({pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                      </div>
                    </div>
                  );
                })}
                {(!clientStats?.byClientApp || clientStats.byClientApp.length === 0) && (
                  <p className="text-xs text-slate-400 text-center py-6">暂无播放器数据</p>
                )}
              </div>
            </div>

            {/* 3. Location / ISP Distribution */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 border-b border-slate-100 pb-2">
                <MapPin className="w-4 h-4 text-amber-500" />
                地域与网络运营商分布
              </h3>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {clientStats?.byLocation?.map((loc: any, idx: number) => {
                  const label = `${loc.province || "未知省份"} · ${loc.isp || "未知运营商"}`;
                  const pct = clientStats.overview.totalRequests > 0 
                    ? Math.round((loc.total / clientStats.overview.totalRequests) * 100) 
                    : 0;
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-700 truncate max-w-[150px]" title={label}>
                          {label}
                        </span>
                        <span className="font-mono text-slate-600 font-bold">
                          {loc.total} 次
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-amber-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                      </div>
                    </div>
                  );
                })}
                {(!clientStats?.byLocation || clientStats.byLocation.length === 0) && (
                  <p className="text-xs text-slate-400 text-center py-6">暂无地域数据</p>
                )}
              </div>
            </div>
          </div>

          {/* Recent Access Logs Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-slate-500" />
                实时客户端 API 访问明细
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">
                最近 {clientStats?.recentLogs?.length || 0} 条记录
              </span>
            </div>

            <div className="overflow-x-auto max-h-[550px] overflow-y-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 shadow-xs">
                  <tr className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                    <th className="py-3 px-4 font-bold">访问时间</th>
                    <th className="py-3 px-4">访问接口</th>
                    <th className="py-3 px-4">客户端 IP & 地区</th>
                    <th className="py-3 px-4">播放设备 / UA</th>
                    <th className="py-3 px-4">请求参数</th>
                    <th className="py-3 px-4 text-center">状态码</th>
                    <th className="py-3 px-4 text-right">响应大小</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-650">
                  {clientStats?.recentLogs?.map((log: any) => (
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                        {log.accessTime}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {getEndpointBadge(log.endpoint)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <span className="font-mono font-bold text-slate-800">{log.clientIp}</span>
                          {(log.province || log.isp) && (
                            <span className="text-[10px] text-slate-400 font-medium">
                              {log.province} {log.isp}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col max-w-xs">
                          <span className="font-semibold text-slate-700">{log.clientApp}</span>
                          <span className="text-[10px] text-slate-400 truncate" title={log.userAgent}>
                            {log.userAgent || "-"}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {log.queryParams ? (
                          <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded max-w-[180px] inline-block truncate" title={log.queryParams}>
                            {log.queryParams}
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-bold ${
                          log.statusCode === 200 ? 'bg-emerald-50 text-emerald-600' :
                          log.statusCode === 304 ? 'bg-sky-50 text-sky-600' :
                          'bg-rose-50 text-rose-600'
                        }`}>
                          {log.statusCode}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-500 whitespace-nowrap">
                        {formatBytes(log.responseBytes)}
                      </td>
                    </tr>
                  ))}
                  {(!clientStats?.recentLogs || clientStats.recentLogs.length === 0) && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        <Globe className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-semibold">暂无客户端接口访问日志</p>
                        <p className="text-xs text-slate-400 mt-1">当客户端（TiviMate、TVBox、PotPlayer等）请求 M3U / EPG 接口时将自动产生记录</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. CURRENT HEALTH TAB */}
      {activeTab === "current" && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
          </div>
          <div>
            <p className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase">总计频道数</p>
            <p className="text-xl sm:text-2xl font-black text-slate-800">{totalChannels}</p>
          </div>
        </div>
        
        <div className="bg-rose-50 p-4 sm:p-5 rounded-2xl border border-rose-100 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
            <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 text-rose-500" />
          </div>
          <div>
            <p className="text-[11px] sm:text-xs font-bold text-rose-400 uppercase">不稳定频道 (&lt; 2 有效线路)</p>
            <p className="text-xl sm:text-2xl font-black text-rose-700">{unstableChannelsCount}</p>
          </div>
        </div>

        <div className="bg-emerald-50 p-4 sm:p-5 rounded-2xl border border-emerald-100 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-500" />
          </div>
          <div>
            <p className="text-[11px] sm:text-xs font-bold text-emerald-600 uppercase">稳定频道</p>
            <p className="text-xl sm:text-2xl font-black text-emerald-700">{totalChannels - unstableChannelsCount}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-50/50">
          <h2 className="text-sm font-black text-slate-800 flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-400" /> 线路可用性分析表
          </h2>
          <div className="flex gap-2 w-full sm:w-auto">
            <input 
              type="text" 
              placeholder="搜索频道..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-blue-400 w-full sm:w-48"
            />
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value as any)}
              className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg outline-none focus:border-blue-400 bg-white"
            >
              <option value="all">显示全部频道</option>
              <option value="unstable">仅看不稳定频道 (需补充线路)</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 shadow-sm">
              <tr className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                <th className="py-3.5 px-4 font-bold">频道名称</th>
                <th className="py-3.5 px-4 text-center">总线路数</th>
                <th className="py-3.5 px-4 text-center">🟢 有效可用</th>
                <th className="py-3.5 px-4 text-center">🔴 失效线路</th>
                <th className="py-3.5 px-4 text-center">🟡 测试中/⚪ 未知</th>
                <th className="py-3.5 px-4 text-center">🟠 已隔离</th>
                <th className="py-3.5 px-4 text-right">健康状态评估</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-650">
              {filteredStats.map(ch => (
                <tr key={ch.id} className={`hover:bg-slate-50 transition-colors ${ch.stats.isUnstable ? "bg-rose-50/20" : ""}`}>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      {ch.logo ? (
                        <img src={ch.logo} alt={ch.name} className="w-6 h-6 object-contain rounded bg-slate-50 border border-slate-100 p-0.5" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-400">TV</div>
                      )}
                      <span className="font-bold text-slate-700">{ch.name}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono font-bold">{ch.stats.total}</td>
                  <td className="py-3.5 px-4 text-center">
                    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-bold ${ch.stats.active > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                      {ch.stats.active}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-bold ${ch.stats.inactive > 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-400"}`}>
                      {ch.stats.inactive}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700">
                      {ch.stats.checking + ch.stats.unknown}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-bold bg-orange-50 text-orange-600">
                      {ch.stats.isolated}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    {ch.stats.isUnstable ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-black bg-rose-50 text-rose-600 border border-rose-100">
                        <AlertCircle className="w-3.5 h-3.5" />
                        高危 (需补充线路)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-black bg-emerald-50 text-emerald-600 border border-emerald-100">
                        <CheckCircle className="w-3.5 h-3.5" />
                        健康稳定
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredStats.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-semibold">没有符合条件的数据</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
      )}

      {/* 3. SPEED TEST HISTORY TAB */}
      {activeTab === "history" && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-800 flex items-center gap-2">
                <History className="w-4 h-4 text-slate-400" /> 历次全域测速汇总报告
              </h2>
            </div>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 shadow-sm">
                  <tr className="text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                    <th className="py-3.5 px-4 font-bold">测速时间</th>
                    <th className="py-3.5 px-4 text-center">测试线路总数</th>
                    <th className="py-3.5 px-4 text-center">网络环境</th>
                    <th className="py-3.5 px-4 text-center">🟢 有效</th>
                    <th className="py-3.5 px-4 text-center">🔴 无效</th>
                    <th className="py-3.5 px-4 text-center">可用率</th>
                    <th className="py-3.5 px-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-650">
                  {reports.map((r) => {
                    const passRate = r.totalTested > 0 ? Math.round((r.activeCount / r.totalTested) * 100) : 0;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => viewReportDetails(r.id)}>
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-700">
                          {new Date(r.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold">
                          {r.totalTested}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                           <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-500">
                            <MapPin className="w-3 h-3" />
                            {r.clientProvince || "未知"} · {r.clientIsp || "未知"}
                           </span>
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-emerald-600">
                          {r.activeCount}
                        </td>
                        <td className="py-3.5 px-4 text-center font-bold text-rose-600">
                          {r.inactiveCount}
                        </td>
                        <td className="py-3.5 px-4 text-center font-black">
                          <span className={`${passRate > 50 ? "text-emerald-600" : "text-orange-500"}`}>{passRate}%</span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button onClick={(e) => deleteReport(r.id, e)} className="p-1.5 text-slate-400 hover:text-rose-600 transition rounded-lg hover:bg-rose-50">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {reports.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        <History className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-semibold">暂无历史测速记录</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {selectedReport && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full flex flex-col max-h-[85vh] shadow-2xl overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-500" />
                单次测速详细报告 - {new Date(selectedReport.createdAt).toLocaleString()}
              </h3>
              <button onClick={() => setSelectedReport(null)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex gap-4 border-b border-slate-100 overflow-x-auto text-xs whitespace-nowrap">
               <div className="bg-slate-100 px-3 py-1.5 rounded-lg">总探测线路数: <span className="font-bold">{selectedReport.totalTested}</span></div>
               <div className="bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg">连通可用: <span className="font-bold">{selectedReport.activeCount}</span></div>
               <div className="bg-rose-50 text-rose-700 px-3 py-1.5 rounded-lg">离线阻断: <span className="font-bold">{selectedReport.inactiveCount}</span></div>
               <div className="bg-slate-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />环境: <span className="font-bold">{selectedReport.clientProvince || "未知"} / {selectedReport.clientIsp || "未知"}</span></div>
            </div>
            <div className="overflow-y-auto flex-1 p-4 bg-slate-50">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {selectedReport.details && selectedReport.details.map((item: any, i: number) => {
                  const isOk = item.status === "active";
                  return (
                    <div key={i} className={`p-3 border rounded-xl bg-white text-xs ${isOk ? "border-emerald-100" : "border-rose-100"}`}>
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-mono text-[10px] text-slate-400 truncate w-3/4" title={item.sourceId}>{item.sourceId}</span>
                        <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${isOk ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
                          {isOk ? "PASS" : "FAIL"}
                        </span>
                      </div>
                      {item.url && (
                        <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-150 p-1.5 rounded-lg mb-2">
                          <span className="font-mono text-[10px] text-slate-600 truncate select-all flex-1" title={item.url}>{item.url}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(item.url);
                              alert("已复制 URL");
                            }}
                            className="p-1 text-slate-400 hover:text-indigo-600 bg-white hover:bg-indigo-50 border border-slate-200 rounded transition shrink-0 cursor-pointer"
                            title="拷贝流地址"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {isOk && item.latency !== undefined && (
                        <div className="text-[10px] text-slate-500 font-bold mb-1">
                          首帧延迟: <span className={`${item.latency < 500 ? "text-emerald-500" : item.latency < 1500 ? "text-amber-500" : "text-rose-500"}`}>{item.latency}ms</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
