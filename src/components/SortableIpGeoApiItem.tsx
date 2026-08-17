import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
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
      className={`p-3 rounded-xl border transition-all ${
        isDragging 
          ? "bg-indigo-50/90 border-indigo-300 shadow-lg scale-[1.01]" 
          : "bg-white border-slate-200/90 shadow-2xs hover:border-slate-300"
      }`}
    >
      {/* Mobile View: Clean 2-row layout with perfectly aligned controls */}
      <div className="sm:hidden flex flex-col gap-2.5">
        {/* Top Row: Drag Handle + Checkbox + API Name + Actions */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div 
              {...attributes} 
              {...listeners}
              className="p-1.5 -ml-1 text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing touch-none rounded-md hover:bg-slate-100 shrink-0"
              title="按住拖拽排序"
            >
              <GripVertical className="w-4 h-4" />
            </div>
            
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
            
            <input 
              type="text"
              value={api.name}
              onChange={(e) => onUpdate(idx, "name", e.target.value)}
              className="flex-1 min-w-0 px-2.5 py-1 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none transition"
              placeholder="API 名称"
            />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {api.failCount !== undefined && api.failCount > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-md">
                失败 {api.failCount} 次
              </span>
            )}
            <button
              onClick={() => onRemove(idx)}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:bg-rose-100 rounded-lg transition touch-press"
              title="移除此检测源"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Bottom Row: Full-width URL input */}
        <div className="w-full">
          <input 
            type="text"
            value={api.url}
            onChange={(e) => onUpdate(idx, "url", e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono text-slate-700 bg-slate-50/70 border border-slate-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none transition placeholder:text-slate-400"
            placeholder="接口 URL (必须包含 {{ip}} 占位符)"
          />
        </div>
      </div>

      {/* Desktop View (sm:flex): Sleek single-line row */}
      <div className="hidden sm:flex sm:items-center sm:gap-3">
        <div 
          {...attributes} 
          {...listeners}
          className="p-1 text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing touch-none rounded hover:bg-slate-100 shrink-0"
          title="按住拖拽排序"
        >
          <GripVertical className="w-4 h-4" />
        </div>
        
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
        
        <input 
          type="text"
          value={api.name}
          onChange={(e) => onUpdate(idx, "name", e.target.value)}
          className="w-36 px-2.5 py-1.5 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none transition shrink-0"
          placeholder="API 名称"
        />
        
        <input 
          type="text"
          value={api.url}
          onChange={(e) => onUpdate(idx, "url", e.target.value)}
          className="flex-1 px-3 py-1.5 text-xs font-mono text-slate-700 bg-slate-50/70 border border-slate-200 rounded-lg focus:bg-white focus:border-indigo-500 focus:outline-none transition placeholder:text-slate-400"
          placeholder="接口 URL (必须包含 {{ip}} 占位符)"
        />

        {api.failCount !== undefined && api.failCount > 0 && (
          <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-md shrink-0">
            失败 {api.failCount} 次
          </span>
        )}
        
        <button
          onClick={() => onRemove(idx)}
          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition shrink-0"
          title="移除此检测源"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
