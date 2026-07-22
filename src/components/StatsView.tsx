import React, { useState, useMemo } from 'react';
import { Channel } from '../types';
import { Activity, AlertCircle, CheckCircle, XCircle } from 'lucide-react';

interface StatsViewProps {
  channels: Channel[];
}

export default function StatsView({ channels }: StatsViewProps) {
  const [filterType, setFilterType] = useState<"all" | "unstable">("all");
  const [search, setSearch] = useState("");

  const channelStats = useMemo(() => {
    return channels.map(ch => {
      const total = ch.sources.length;
      const active = ch.sources.filter(s => s.status === 'active' && !s.isolated).length;
      const inactive = ch.sources.filter(s => s.status === 'inactive' && !s.isolated).length;
      const checking = ch.sources.filter(s => s.status === 'checking' && !s.isolated).length;
      const unknown = ch.sources.filter(s => s.status === 'unknown' && !s.isolated).length;
      const isolated = ch.sources.filter(s => s.isolated).length;
      
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
    return channelStats.filter(ch => {
      if (filterType === "unstable" && !ch.stats.isUnstable) return false;
      if (search && !ch.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [channelStats, filterType, search]);

  const totalChannels = channels.length;
  const unstableChannelsCount = channelStats.filter(c => c.stats.isUnstable).length;

  return (
    <div className="space-y-6 animate-fade-in" id="tab_stats_view">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
            <Activity className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">总计频道数</p>
            <p className="text-2xl font-black text-slate-800">{totalChannels}</p>
          </div>
        </div>
        
        <div className="bg-rose-50 p-5 rounded-2xl border border-rose-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
            <AlertCircle className="w-6 h-6 text-rose-500" />
          </div>
          <div>
            <p className="text-xs font-bold text-rose-400 uppercase">不稳定频道 (&lt; 2 有效线路)</p>
            <p className="text-2xl font-black text-rose-700">{unstableChannelsCount}</p>
          </div>
        </div>

        <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <CheckCircle className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <p className="text-xs font-bold text-emerald-600 uppercase">稳定频道</p>
            <p className="text-2xl font-black text-emerald-700">{totalChannels - unstableChannelsCount}</p>
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
                <tr key={ch.id} className={`hover:bg-slate-50 transition-colors \${ch.stats.isUnstable ? "bg-rose-50/20" : ""}`}>
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
                    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-bold \${ch.stats.active > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                      {ch.stats.active}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-bold \${ch.stats.inactive > 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-400"}`}>
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
  );
}
