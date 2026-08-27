import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Globe, Link } from "lucide-react";
import { IpGeoApi } from "../types";

interface Props {
  key?: React.Key;
  api: IpGeoApi;
  idx: number;
  onUpdate: (idx: number, field: keyof IpGeoApi, value: any) => void;
  onRemove: (idx: number) => void;
}

export function SortableIpGeoApiItem({ api, idx, onUpdate, onRemove }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: api.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-3 sm:p-3.5 rounded-2xl border transition-all space-y-2.5 ${
        isDragging 
          ? "bg-indigo-50/90 border-indigo-300 shadow-lg scale-[1.01]" 
          : api.enabled 
            ? "bg-white border-slate-200/90 shadow-2xs hover:border-slate-300"
            : "bg-slate-50/70 border-slate-200/60 opacity-80"
      }`}
    >
      {/* Top Row: Drag Handle + Enabled Checkbox + Priority Badge + API Name + Fail Badge + Delete */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Drag Handle */}
          <div 
            {...attributes} 
            {...listeners}
            className="p-1 -ml-1 text-slate-400 hover:text-slate-600 active:text-indigo-600 cursor-grab active:cursor-grabbing touch-none rounded-md hover:bg-slate-100 shrink-0"
            title="按住拖拽调整检测优先级"
          >
            <GripVertical className="w-4 h-4" />
          </div>

          {/* Priority Index Badge */}
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
            #{idx + 1}
          </span>
          
          {/* Enable Toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
            <input 
              type="checkbox"
              checked={api.enabled}
              onChange={(e) => onUpdate(idx, "enabled", e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-slate-300 cursor-pointer"
            />
            <span className={`text-xs font-bold ${api.enabled ? "text-emerald-700" : "text-slate-400"}`}>
              {api.enabled ? "启用" : "禁用"}
            </span>
          </label>
          
          {/* API Name Input */}
          <input 
            type="text"
            value={api.name}
            onChange={(e) => onUpdate(idx, "name", e.target.value)}
            className="flex-1 min-w-[120px] px-2.5 py-1 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none transition"
            placeholder="API 名称 (如: ip-api.com)"
            title="点击可修改名称"
          />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {api.failCount !== undefined && api.failCount > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-md">
              连续失败 {api.failCount} 次
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:bg-rose-100 rounded-lg transition touch-press cursor-pointer"
            title="移除此检测源"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bottom Row: Full-width URL input with Icon & Placeholder */}
      <div className="relative w-full">
        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
          <Link className="w-3.5 h-3.5" />
        </div>
        <input 
          type="text"
          value={api.url}
          onChange={(e) => onUpdate(idx, "url", e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-xs font-mono text-slate-800 bg-slate-50/80 border border-slate-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none transition placeholder:text-slate-400"
          placeholder="接口 URL (例如: http://ip-api.com/json/{{ip}}?lang=zh-CN)"
        />
      </div>
    </div>
  );
}
