import React, { useState, useMemo } from "react";
import { Folder, Tv, Radio, Activity, ShieldAlert } from "lucide-react";
import { Group, Channel } from "../types";

export const GROUP_COLOR_PALETTES = [
  {
    name: "indigo",
    badge: "bg-indigo-50/90 text-indigo-700 border-indigo-200/90 hover:bg-indigo-100 hover:border-indigo-300 hover:shadow-xs",
    dot: "bg-indigo-500",
    headerBg: "bg-indigo-600",
    accentText: "text-indigo-600",
    lightBg: "bg-indigo-50/60",
    progressBar: "bg-indigo-500",
  },
  {
    name: "emerald",
    badge: "bg-emerald-50/90 text-emerald-700 border-emerald-200/90 hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-xs",
    dot: "bg-emerald-500",
    headerBg: "bg-emerald-600",
    accentText: "text-emerald-600",
    lightBg: "bg-emerald-50/60",
    progressBar: "bg-emerald-500",
  },
  {
    name: "violet",
    badge: "bg-violet-50/90 text-violet-700 border-violet-200/90 hover:bg-violet-100 hover:border-violet-300 hover:shadow-xs",
    dot: "bg-violet-500",
    headerBg: "bg-violet-600",
    accentText: "text-violet-600",
    lightBg: "bg-violet-50/60",
    progressBar: "bg-violet-500",
  },
  {
    name: "amber",
    badge: "bg-amber-50/90 text-amber-800 border-amber-200/90 hover:bg-amber-100 hover:border-amber-300 hover:shadow-xs",
    dot: "bg-amber-500",
    headerBg: "bg-amber-600",
    accentText: "text-amber-700",
    lightBg: "bg-amber-50/60",
    progressBar: "bg-amber-500",
  },
  {
    name: "rose",
    badge: "bg-rose-50/90 text-rose-700 border-rose-200/90 hover:bg-rose-100 hover:border-rose-300 hover:shadow-xs",
    dot: "bg-rose-500",
    headerBg: "bg-rose-600",
    accentText: "text-rose-600",
    lightBg: "bg-rose-50/60",
    progressBar: "bg-rose-500",
  },
  {
    name: "sky",
    badge: "bg-sky-50/90 text-sky-700 border-sky-200/90 hover:bg-sky-100 hover:border-sky-300 hover:shadow-xs",
    dot: "bg-sky-500",
    headerBg: "bg-sky-600",
    accentText: "text-sky-600",
    lightBg: "bg-sky-50/60",
    progressBar: "bg-sky-500",
  },
  {
    name: "fuchsia",
    badge: "bg-fuchsia-50/90 text-fuchsia-700 border-fuchsia-200/90 hover:bg-fuchsia-100 hover:border-fuchsia-300 hover:shadow-xs",
    dot: "bg-fuchsia-500",
    headerBg: "bg-fuchsia-600",
    accentText: "text-fuchsia-600",
    lightBg: "bg-fuchsia-50/60",
    progressBar: "bg-fuchsia-500",
  },
  {
    name: "teal",
    badge: "bg-teal-50/90 text-teal-700 border-teal-200/90 hover:bg-teal-100 hover:border-teal-300 hover:shadow-xs",
    dot: "bg-teal-500",
    headerBg: "bg-teal-600",
    accentText: "text-teal-600",
    lightBg: "bg-teal-50/60",
    progressBar: "bg-teal-500",
  },
  {
    name: "blue",
    badge: "bg-blue-50/90 text-blue-700 border-blue-200/90 hover:bg-blue-100 hover:border-blue-300 hover:shadow-xs",
    dot: "bg-blue-500",
    headerBg: "bg-blue-600",
    accentText: "text-blue-600",
    lightBg: "bg-blue-50/60",
    progressBar: "bg-blue-500",
  },
  {
    name: "cyan",
    badge: "bg-cyan-50/90 text-cyan-800 border-cyan-200/90 hover:bg-cyan-100 hover:border-cyan-300 hover:shadow-xs",
    dot: "bg-cyan-500",
    headerBg: "bg-cyan-600",
    accentText: "text-cyan-700",
    lightBg: "bg-cyan-50/60",
    progressBar: "bg-cyan-500",
  },
  {
    name: "orange",
    badge: "bg-orange-50/90 text-orange-800 border-orange-200/90 hover:bg-orange-100 hover:border-orange-300 hover:shadow-xs",
    dot: "bg-orange-500",
    headerBg: "bg-orange-600",
    accentText: "text-orange-700",
    lightBg: "bg-orange-50/60",
    progressBar: "bg-orange-500",
  },
  {
    name: "purple",
    badge: "bg-purple-50/90 text-purple-700 border-purple-200/90 hover:bg-purple-100 hover:border-purple-300 hover:shadow-xs",
    dot: "bg-purple-500",
    headerBg: "bg-purple-600",
    accentText: "text-purple-600",
    lightBg: "bg-purple-50/60",
    progressBar: "bg-purple-500",
  },
];

export function getGroupColorPalette(groupOrId: string | { id: string; name?: string }) {
  const str = typeof groupOrId === "string" ? groupOrId : (groupOrId.id || groupOrId.name || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % GROUP_COLOR_PALETTES.length;
  return GROUP_COLOR_PALETTES[index];
}

interface GroupBadgeTagProps {
  group: Group | { id: string; name: string };
  allChannels?: Channel[];
  size?: "xs" | "sm" | "md";
  onClick?: (groupId: string) => void;
  showHoverStats?: boolean;
}

export const GroupBadgeTag: React.FC<GroupBadgeTagProps> = ({
  group,
  allChannels = [],
  size = "sm",
  onClick,
  showHoverStats = true,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const palette = useMemo(() => getGroupColorPalette(group), [group.id, group.name]);

  // Calculate detailed statistics for this group
  const stats = useMemo(() => {
    if (!showHoverStats || !allChannels || allChannels.length === 0) {
      return null;
    }

    const groupChannels = allChannels.filter((c) =>
      Array.isArray(c.groupIds) ? c.groupIds.includes(group.id) : false
    );

    const channelCount = groupChannels.length;
    let totalSources = 0;
    let activeSources = 0;
    let isolatedChannels = 0;

    groupChannels.forEach((c) => {
      if (c.isolated) isolatedChannels++;
      const sources = c.sources || [];
      totalSources += sources.length;
      activeSources += sources.filter((s) => s.status === "active" && !s.isolated).length;
    });

    const activeRate = totalSources > 0 ? (activeSources / totalSources) * 100 : 0;
    const sampleChannels = groupChannels.slice(0, 4).map((c) => c.name);

    return {
      channelCount,
      totalSources,
      activeSources,
      isolatedChannels,
      activeRate: activeRate.toFixed(1),
      sampleChannels,
    };
  }, [group.id, allChannels, showHoverStats]);

  const sizeClasses = {
    xs: "text-[9px] px-1.5 py-0.2 rounded border",
    sm: "text-[10.5px] px-2 py-0.5 rounded-md border font-medium",
    md: "text-xs px-2.5 py-1 rounded-lg border font-semibold",
  }[size];

  return (
    <div
      className="relative inline-block group/grouptag"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      id={`group_tag_badge_${group.id}`}
    >
      <button
        type="button"
        onClick={(e) => {
          if (onClick) {
            e.stopPropagation();
            onClick(group.id);
          }
        }}
        className={`inline-flex items-center gap-1.5 transition-all duration-200 cursor-pointer select-none border shrink-0 ${palette.badge} ${sizeClasses}`}
        title={onClick ? `点击按分类 "${group.name}" 筛选` : group.name}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${palette.dot}`} />
        <span className="truncate max-w-[120px] sm:max-w-[180px]">{group.name || "未命名分组"}</span>
      </button>

      {/* Hover Card with Detailed Group Statistics */}
      {showHoverStats && isHovered && stats && (
        <div className="absolute top-full left-0 mt-2 z-[100] w-72 sm:w-80 bg-white rounded-2xl shadow-2xl border border-slate-200/90 p-3.5 space-y-3 font-sans animate-fade-in pointer-events-none origin-top-left">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-2.5 h-2.5 rounded-full ${palette.dot} shrink-0`} />
              <h4 className="text-xs font-bold text-slate-800 truncate">{group.name}</h4>
            </div>
            <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium shrink-0">
              ID: {group.id}
            </span>
          </div>

          {/* Core Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {/* Total Channels */}
            <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Tv className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>关联频道</span>
              </div>
              <span className="font-bold text-slate-800 font-mono">{stats.channelCount} 个</span>
            </div>

            {/* Total Sources */}
            <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Radio className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>有效/总线路</span>
              </div>
              <span className="font-bold text-slate-800 font-mono">
                <span className="text-emerald-600">{stats.activeSources}</span> / {stats.totalSources}
              </span>
            </div>
          </div>

          {/* Active Rate Progress Bar */}
          <div className="space-y-1 bg-slate-50/80 p-2 rounded-xl border border-slate-100">
            <div className="flex justify-between items-center text-[10.5px]">
              <span className="text-slate-500 font-medium flex items-center gap-1">
                <Activity className="w-3 h-3 text-emerald-500" />
                线路健康在线率
              </span>
              <span className="font-bold font-mono text-emerald-700">{stats.activeRate}%</span>
            </div>
            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full ${palette.progressBar} transition-all duration-300 rounded-full`}
                style={{ width: `${Math.min(100, Math.max(0, Number(stats.activeRate)))}%` }}
              />
            </div>
          </div>

          {/* Isolated Status */}
          {stats.isolatedChannels > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-orange-700 bg-orange-50 border border-orange-200/80 p-1.5 rounded-lg">
              <ShieldAlert className="w-3.5 h-3.5 text-orange-600 shrink-0" />
              <span>注意: 该分组包含 {stats.isolatedChannels} 个已隔离频道 (防导出)</span>
            </div>
          )}

          {/* Sample channels */}
          {stats.sampleChannels.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 font-medium block">代表频道预览:</span>
              <div className="flex flex-wrap gap-1">
                {stats.sampleChannels.map((name, idx) => (
                  <span
                    key={idx}
                    className="text-[9.5px] bg-slate-100/90 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200/70 font-medium truncate max-w-[120px]"
                  >
                    {name}
                  </span>
                ))}
                {stats.channelCount > stats.sampleChannels.length && (
                  <span className="text-[9.5px] text-slate-400 self-center">
                    +{stats.channelCount - stats.sampleChannels.length} 更多
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
