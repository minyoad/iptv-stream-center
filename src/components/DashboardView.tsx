import React from "react";
import { 
  Tv, 
  Activity, 
  Compass, 
  CheckCircle, 
  XCircle, 
  HelpCircle, 
  Play, 
  Upload, 
  CheckSquare, 
  Zap,
  RotateCw
} from "lucide-react";
import { Channel, LiveSource, SyncConfig } from "../types";
import StatsView from "./StatsView";

interface DashboardProps {
  channels: Channel[];
  syncConfigs: SyncConfig[];
  onNavigate: (view: string) => void;
  onTriggerTest: () => void;
  testingStatus: "idle" | "running";
}

export default function DashboardView({
  channels,
  syncConfigs,
  onNavigate,
  onTriggerTest,
  testingStatus,
}: DashboardProps) {
  // Stats calculations
  const totalChannels = channels.filter(c => !c.isolated).length;
  
  let totalSources = 0;
  let activeSources = 0;
  let inactiveSources = 0;
  let unknownSources = 0;

  const ispCounts: Record<string, number> = {
    "电信": 0,
    "联通": 0,
    "移动": 0,
    "广电": 0,
    "BGP": 0,
    "其它": 0,
  };

  const provinceCounts: Record<string, number> = {};

  channels.forEach((channel) => {
    if (channel.isolated) return;
    channel.sources.forEach((s) => {
      if (s.isolated) return;
      
      totalSources++;

      // Status
      if (s.status === "active") activeSources++;
      else if (s.status === "inactive") inactiveSources++;
      else unknownSources++;

      // ISP
      const normalizedIsp = s.isp || "其它";
      if (ispCounts[normalizedIsp] !== undefined) {
        ispCounts[normalizedIsp]++;
      } else {
        ispCounts["其它"]++;
      }

      // Province
      const prov = s.province || "未知";
      provinceCounts[prov] = (provinceCounts[prov] || 0) + 1;
    });
  });

  const activeRatio = totalSources > 0 ? Math.round((activeSources / totalSources) * 100) : 0;

  // Sorted list of top provinces
  const topProvinces = Object.entries(provinceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="space-y-8 animate-fade-in" id="dashboard_view">
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5" id="kpi_grid">
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-xs border border-slate-100 flex items-center space-x-4" id="stat_channels">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl shrink-0">
            <Tv className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-medium text-slate-400">频道总数</p>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-800">{totalChannels}</h3>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-xs border border-slate-100 flex items-center space-x-4" id="stat_sources">
          <div className="p-3 bg-cyan-50 text-cyan-600 rounded-xl shrink-0">
            <Compass className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-medium text-slate-400">直播源线路</p>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-800">{totalSources}</h3>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-xs border border-slate-100 flex items-center space-x-4" id="stat_active_sources">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl shrink-0">
            <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-medium text-slate-400">可用线路数</p>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-800">{activeSources}</h3>
          </div>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-xs border border-slate-100 flex items-center space-x-4" id="stat_active_ratio">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl shrink-0">
            <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-medium text-slate-400">可用性健康率</p>
            <h3 className="text-xl sm:text-2xl font-bold text-slate-800">{activeRatio}%</h3>
          </div>
        </div>
      </div>

      {/* Main Stats Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6" id="dashboard_details_grid">
        {/* Playlists & Line Health Status */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-xs border border-slate-100" id="card_line_status">
          <h4 className="text-sm sm:text-base font-semibold text-slate-800 mb-4 flex items-center">
            <Zap className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5 text-indigo-500" /> 直播线路健康状态
          </h4>
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500 flex items-center">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-2" />
                有效线路
              </span>
              <span className="text-sm font-bold text-slate-700">{activeSources} ({totalSources ? Math.round((activeSources/totalSources)*100) : 0}%)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500 flex items-center">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 mr-2" />
                失效线路
              </span>
              <span className="text-sm font-bold text-slate-700">{inactiveSources} ({totalSources ? Math.round((inactiveSources/totalSources)*100) : 0}%)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500 flex items-center">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400 mr-2" />
                未检测线路
              </span>
              <span className="text-sm font-bold text-slate-700">{unknownSources} ({totalSources ? Math.max(0, 100 - Math.round((activeSources/totalSources)*100) - Math.round((inactiveSources/totalSources)*100)) : 0}%)</span>
            </div>

            {/* Custom SVG gauge bar */}
            <div className="h-3.5 w-full bg-slate-100 rounded-full flex overflow-hidden">
              <div 
                className="bg-emerald-500 h-full transition-all duration-500" 
                style={{ flex: activeSources > 0 ? activeSources : 0 }}
              />
              <div 
                className="bg-rose-500 h-full transition-all duration-500" 
                style={{ flex: inactiveSources > 0 ? inactiveSources : 0 }}
              />
              <div 
                className="bg-slate-300 h-full transition-all duration-500" 
                style={{ flex: unknownSources > 0 ? unknownSources : 0 }}
              />
            </div>
            
            <button
              id="dashboard_test_btn"
              onClick={onTriggerTest}
              disabled={testingStatus === "running"}
              className={`w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center transition ${
                testingStatus === "running" 
                ? "bg-slate-100 text-slate-400 cursor-not-allowed" 
                : "bg-indigo-600 hover:bg-indigo-700 text-white"
              }`}
            >
              <RotateCw className={`w-4 h-4 mr-2 ${testingStatus === "running" ? "animate-spin" : ""}`} />
              {testingStatus === "running" ? "正在大批量并发测速..." : "一键检测全部失效链接"}
            </button>
          </div>
        </div>

        {/* ISP Distribution breakdown */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-xs border border-slate-100" id="card_isp_status">
          <h4 className="text-sm sm:text-base font-semibold text-slate-800 mb-4">网络运营商线路分布 (ISP)</h4>
          <div className="space-y-4">
            {Object.entries(ispCounts).map(([isp, count]) => {
              const pct = totalSources > 0 ? Math.round((count / totalSources) * 100) : 0;
              return (
                <div key={isp} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                    <span>{isp}</span>
                    <span>{count} 条 ({pct}%)</span>
                  </div>
                  <div className="w-full bg-slate-50 h-2 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${
                        isp === "电信" ? "bg-blue-500" :
                        isp === "联通" ? "bg-orange-500" :
                        isp === "移动" ? "bg-green-500" :
                        isp === "广电" ? "bg-red-500" :
                        isp === "BGP" ? "bg-purple-500" : "bg-slate-400"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Region stats breakdown */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-xs border border-slate-100" id="card_region_status">
          <h4 className="text-sm sm:text-base font-semibold text-slate-800 mb-4">主要覆盖省份排行</h4>
          {topProvinces.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-300">
              <HelpCircle className="w-12 h-12 stroke-[1.5]" />
              <p className="text-sm mt-2">暂无省份数据，请导入线路</p>
            </div>
          ) : (
            <div className="space-y-4">
              {topProvinces.map(([prov, count], index) => {
                const pct = totalSources > 0 ? Math.round((count / totalSources) * 100) : 0;
                return (
                  <div key={prov} className="flex items-center space-x-3">
                    <span className="w-6 h-6 flex items-center justify-center bg-indigo-50 text-indigo-700 rounded-full font-mono text-xs font-bold shrink-0">
                      {index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1">
                        <span className="truncate">{prov}省份源</span>
                        <span className="shrink-0">{count} 线路</span>
                      </div>
                      <div className="w-full bg-slate-50 h-2 rounded-full">
                        <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quick Action Cards Grid */}
      <div className="space-y-4" id="quick_actions_area">
        <h3 className="text-base sm:text-lg font-bold text-slate-700">快速设置与操作</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
          <div 
            onClick={() => onNavigate("channels")} 
            className="p-4 sm:p-5 bg-gradient-to-br from-indigo-50 to-white hover:from-indigo-100 hover:to-indigo-50 border border-indigo-100/60 rounded-2xl cursor-pointer transition select-none flex items-start space-x-3.5 group"
          >
            <div className="p-2.5 bg-indigo-500 text-white rounded-xl shrink-0">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-slate-800 group-hover:text-indigo-900 text-sm">频道与线路编辑</p>
              <p className="text-xs text-slate-500 mt-1">手动编辑电视频道名称、分类、别名，并在其下方直观编辑、校验、删除其播放线路列表。</p>
            </div>
          </div>

          <div 
            onClick={() => onNavigate("sync")} 
            className="p-4 sm:p-5 bg-gradient-to-br from-cyan-50 to-white hover:from-cyan-100 hover:to-cyan-50 border border-cyan-100/60 rounded-2xl cursor-pointer transition select-none flex items-start space-x-3.5 group"
          >
            <div className="p-2.5 bg-cyan-600 text-white rounded-xl shrink-0">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-slate-800 group-hover:text-cyan-950 text-sm">自动同步 & 导入</p>
              <p className="text-xs text-slate-500 mt-1">导入 Github 或服务器中的 M3U / TXT 直播源资源，并为自动化周期任务设定更新周期。</p>
            </div>
          </div>

          <div 
            onClick={() => onNavigate("export")} 
            className="p-4 sm:p-5 bg-gradient-to-br from-emerald-50 to-white hover:from-emerald-100 hover:to-emerald-50 border border-emerald-100/60 rounded-2xl cursor-pointer transition select-none flex items-start space-x-3.5 group"
          >
            <div className="p-2.5 bg-emerald-600 text-white rounded-xl shrink-0">
              <CheckSquare className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-slate-800 group-hover:text-emerald-950 text-sm">自定播放源 API 生成</p>
              <p className="text-xs text-slate-500 mt-1">在前端可视化的定制并复制专用的播放源接口，第三方播放器调取时提供高度过滤和低延时最优线路。</p>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-slate-100">
        <StatsView channels={channels} />
      </div>
    </div>
  );
}
