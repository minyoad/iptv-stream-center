import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { IpGeoApi } from "../types"; // Will move IpGeoApi to types.ts

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
      className={`flex flex-col sm:flex-row items-center gap-3 p-3 border rounded-xl transition-colors ${
        isDragging ? "bg-indigo-50 border-indigo-200 shadow-md" : "bg-slate-50 border-slate-100"
      }`}
    >
      <div 
        {...attributes} 
        {...listeners}
        className="p-1 text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-5 h-5" />
      </div>
      
      <input 
        type="checkbox"
        checked={api.enabled}
        onChange={(e) => onUpdate(idx, "enabled", e.target.checked)}
        className="w-4 h-4 text-indigo-600 rounded cursor-pointer"
      />
      
      <div className="flex-1 w-full flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <input 
          type="text"
          value={api.name}
          onChange={(e) => onUpdate(idx, "name", e.target.value)}
          className="w-full sm:w-1/3 min-w-[150px] px-2 py-1 text-xs font-bold text-slate-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:outline-none transition-colors"
          placeholder="API 名称"
        />
        <input 
          type="text"
          value={api.url}
          onChange={(e) => onUpdate(idx, "url", e.target.value)}
          className="w-full sm:flex-1 px-3 py-2 text-[11px] font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-white"
          placeholder="URL (包含 {{ip}} 占位符)"
        />
      </div>
      
      <button
        onClick={() => onRemove(idx)}
        className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
        title="移除"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
