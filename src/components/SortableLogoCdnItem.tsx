import React, { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Image as ImageIcon, CheckCircle2, AlertCircle, Link, Sparkles } from "lucide-react";
import { LogoCdnSource } from "../types";

interface Props {
  key?: React.Key;
  source: LogoCdnSource;
  idx: number;
  onUpdate: (idx: number, field: keyof LogoCdnSource, value: any) => void;
  onRemove: (idx: number) => void;
}

export function SortableLogoCdnItem({ source, idx, onUpdate, onRemove }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: source.id });

  const [imgLoadStatus, setImgLoadStatus] = useState<"loading" | "success" | "error">("loading");

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  const sampleFileName = source.type === "fanmingming" ? "CCTV1.png" : source.type === "epg112114" ? "民视.png" : "CCTV1.png";
  const cleanUrl = (source.url || "").trim().replace(/\/+$/, "");
  const sampleLogoUrl = cleanUrl ? `${cleanUrl}/${sampleFileName}` : "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-3 sm:p-3.5 rounded-2xl border transition-all space-y-2.5 ${
        isDragging 
          ? "bg-indigo-50/90 border-indigo-300 shadow-lg scale-[1.01]" 
          : source.enabled 
            ? "bg-white border-slate-200/90 shadow-2xs hover:border-slate-300" 
            : "bg-slate-50/70 border-slate-200/60 opacity-80"
      }`}
    >
      {/* Top Row: Drag Handle + Checkbox + Title Input + Format Type + Delete Action */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Drag Handle */}
          <div 
            {...attributes} 
            {...listeners}
            className="p-1 -ml-1 text-slate-400 hover:text-slate-600 active:text-indigo-600 cursor-grab active:cursor-grabbing touch-none rounded-md hover:bg-slate-100 shrink-0"
            title="按住拖拽调整优先级排序"
          >
            <GripVertical className="w-4 h-4" />
          </div>

          {/* Priority Index Badge */}
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
            #{idx + 1}
          </span>
          
          {/* Enable/Disable Toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
            <input 
              type="checkbox"
              checked={source.enabled}
              onChange={(e) => onUpdate(idx, "enabled", e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 border-slate-300 cursor-pointer"
            />
            <span className={`text-xs font-bold ${source.enabled ? "text-emerald-700" : "text-slate-400"}`}>
              {source.enabled ? "启用" : "禁用"}
            </span>
          </label>
          
          {/* Editable Title/Name Input */}
          <input 
            type="text"
            value={source.name}
            onChange={(e) => onUpdate(idx, "name", e.target.value)}
            className="flex-1 min-w-[120px] px-2.5 py-1 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none transition"
            placeholder="台标源名称 (如: Fanmingming 官方库)"
            title="点击可自由修改标题"
          />
        </div>

        {/* Format Selector Dropdown & Delete Button */}
        <div className="flex items-center gap-1.5 shrink-0">
          <select
            value={source.type}
            onChange={(e) => onUpdate(idx, "type", e.target.value)}
            className="text-[11px] font-semibold py-1 px-2 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500"
            title="台标文件命名格式规则"
          >
            <option value="fanmingming">Fanmingming (央视/卫视)</option>
            <option value="epg112114">112114 (地方台/通用)</option>
            <option value="custom">自定义命名规则</option>
          </select>

          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:bg-rose-100 rounded-lg transition touch-press cursor-pointer shrink-0"
            title="移除此台标库源"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Middle Row: Live Sample Logo Preview + CDN Root URL Input */}
      <div className="flex items-center gap-2">
        {/* Sample Icon Live Connectivity Probe */}
        {sampleLogoUrl ? (
          <div className="relative group shrink-0" title={`测试范例: ${sampleFileName} (状态: ${imgLoadStatus === 'success' ? '加载正常' : imgLoadStatus === 'error' ? '无法访问/加载失败' : '测试中'})`}>
            <img
              src={sampleLogoUrl}
              alt="preview"
              referrerPolicy="no-referrer"
              className="w-8 h-8 object-contain rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-2xs hover:scale-125 transition-transform"
              onLoad={() => setImgLoadStatus("success")}
              onError={() => setImgLoadStatus("error")}
            />
            <span 
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                imgLoadStatus === "success" ? "bg-emerald-500" : imgLoadStatus === "error" ? "bg-rose-500" : "bg-amber-400"
              }`} 
              title={imgLoadStatus === "success" ? "图片可正常访问" : "图片访问失败，请检查网络或CDN地址"}
            />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-slate-400 shrink-0" title="请输入有效 CDN 根地址以预览范例">
            <ImageIcon className="w-4 h-4" />
          </div>
        )}

        {/* CDN Root URL Input */}
        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
            <Link className="w-3.5 h-3.5" />
          </div>
          <input 
            type="text"
            value={source.url}
            onChange={(e) => {
              onUpdate(idx, "url", e.target.value);
              setImgLoadStatus("loading");
            }}
            className="w-full pl-8 pr-3 py-1.5 text-xs font-mono text-slate-800 bg-slate-50/80 border border-slate-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:outline-none transition placeholder:text-slate-400"
            placeholder={
              source.type === "fanmingming"
                ? "如 https://live.fanmingming.com/tv"
                : source.type === "epg112114"
                ? "如 https://epg.112114.xyz/logo"
                : "如 https://your-cdn-mirror.com/logo"
            }
          />
        </div>
      </div>

      {/* Bottom Row: Explanation & Preset Quick-Fill Pills */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5 text-[11px]">
        <div className="text-slate-500 flex items-center gap-1">
          <span className="font-medium text-slate-600">
            {source.type === "fanmingming" && "💡 拼接规则: 根地址/{频道名}.png (如 /CCTV1.png、/湖南卫视.png)"}
            {source.type === "epg112114" && "💡 拼接规则: 根地址/{频道名}.png (如 /民视.png、/东森新闻.png)"}
            {source.type === "custom" && "💡 拼接规则: 根地址/{频道名}.png"}
          </span>
        </div>

        {/* Quick preset suggestions if URL is empty or user wants to switch */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {!source.url && (
            <>
              {source.type === "fanmingming" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdate(idx, "url", "https://live.fanmingming.com/tv");
                      setImgLoadStatus("loading");
                    }}
                    className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold transition cursor-pointer"
                  >
                    填入官方源
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdate(idx, "url", "https://fastly.jsdelivr.net/gh/fanmingming/live@main/tv");
                      setImgLoadStatus("loading");
                    }}
                    className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold transition cursor-pointer"
                  >
                    填入 jsDelivr 加速源
                  </button>
                </>
              )}
              {source.type === "epg112114" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdate(idx, "url", "https://epg.112114.xyz/logo");
                      setImgLoadStatus("loading");
                    }}
                    className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold transition cursor-pointer"
                  >
                    填入官方源
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdate(idx, "url", "https://fastly.jsdelivr.net/gh/YanG-1989/m3u@main/logo");
                      setImgLoadStatus("loading");
                    }}
                    className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold transition cursor-pointer"
                  >
                    填入 jsDelivr 加速源
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
