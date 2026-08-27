import React, { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { SortableLogoCdnItem } from "./SortableLogoCdnItem";
import { LogoCdnSource } from "../types";
import { Plus, RotateCcw, Image as ImageIcon, HelpCircle, Info, Sparkles, ChevronDown, ChevronUp, Zap } from "lucide-react";

interface Props {
  logoSources: LogoCdnSource[];
  setLogoSources: (sources: LogoCdnSource[]) => void;
}

export const DEFAULT_LOGO_CDN_SOURCES: LogoCdnSource[] = [
  {
    id: "fanmingming",
    name: "Fanmingming 官方台标库 (主流央视/卫视/港澳)",
    url: "https://live.fanmingming.com/tv",
    type: "fanmingming",
    enabled: true,
    notes: "适配 CCTV-1~17、各大卫视与港澳频道 (/CCTV1.png、/湖南卫视.png)"
  },
  {
    id: "epg112114",
    name: "112114 官方台标库 (地方台/港台/通用备用库)",
    url: "https://epg.112114.xyz/logo",
    type: "epg112114",
    enabled: true,
    notes: "适配地方台、港澳台与特色频道 (/民视.png、/东森新闻.png)"
  }
];

export const POPULAR_LOGO_PRESETS: { name: string; url: string; type: "fanmingming" | "epg112114" | "custom"; desc: string }[] = [
  {
    name: "Fanmingming 官方台标库 (主流央视/卫视)",
    url: "https://live.fanmingming.com/tv",
    type: "fanmingming",
    desc: "官方原源，覆盖央视、各省卫视、港澳台"
  },
  {
    name: "112114 官方台标库 (地方台/特色频道)",
    url: "https://epg.112114.xyz/logo",
    type: "epg112114",
    desc: "官方原源，覆盖地方台、各省市频道与网络台"
  },
  {
    name: "Fanmingming (jsDelivr CDN 全球加速镜像)",
    url: "https://fastly.jsdelivr.net/gh/fanmingming/live@main/tv",
    type: "fanmingming",
    desc: "适用于国内或部分网络访问原源速度慢时的加速镜像"
  },
  {
    name: "112114 (jsDelivr CDN 全球加速镜像)",
    url: "https://fastly.jsdelivr.net/gh/YanG-1989/m3u@main/logo",
    type: "epg112114",
    desc: "适用于地方台标库的 jsDelivr 全球加速镜像"
  }
];

export function SortableLogoCdnList({ logoSources, setLogoSources }: Props) {
  const [showGuide, setShowGuide] = useState(false);
  const [showPresetsMenu, setShowPresetsMenu] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = logoSources.findIndex((s) => s.id === active.id);
      const newIndex = logoSources.findIndex((s) => s.id === over.id);
      setLogoSources(arrayMove(logoSources, oldIndex, newIndex));
    }
  };

  const updateSource = (idx: number, field: keyof LogoCdnSource, value: any) => {
    const newSources = [...logoSources];
    newSources[idx] = { ...newSources[idx], [field]: value };
    setLogoSources(newSources);
  };

  const removeSource = (idx: number) => {
    const newSources = [...logoSources];
    newSources.splice(idx, 1);
    setLogoSources(newSources);
  };

  const addSource = (preset?: typeof POPULAR_LOGO_PRESETS[0]) => {
    const newId = `logo_cdn_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    if (preset) {
      setLogoSources([
        ...logoSources,
        {
          id: newId,
          name: preset.name,
          url: preset.url,
          type: preset.type,
          enabled: true,
          notes: preset.desc
        }
      ]);
    } else {
      setLogoSources([
        ...logoSources,
        {
          id: newId,
          name: "自定义 CDN 台标库",
          url: "",
          type: "fanmingming",
          enabled: true,
          notes: ""
        }
      ]);
    }
    setShowPresetsMenu(false);
  };

  const resetDefaults = () => {
    setLogoSources(DEFAULT_LOGO_CDN_SOURCES);
  };

  return (
    <div className="space-y-3.5">
      {/* Configuration Description & Guide Banner */}
      <div className="bg-slate-100/90 rounded-2xl p-3.5 border border-slate-200/80 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Info className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>台标库 CDN 解析说明与优先级工作机制</span>
          </div>
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-0.5 cursor-pointer"
          >
            <span>{showGuide ? "收起详细说明" : "查看配置说明"}</span>
            {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        <p className="text-[11px] text-slate-600 leading-relaxed">
          系统在进行<b>频道标准化</b>、<b>AI 智能推导</b>或<b>自动补全 Logo</b> 时，会<b>从上到下</b>按顺序优先采用排在上方且已启用的 CDN 根地址合成台标。
        </p>

        {showGuide && (
          <div className="pt-2 border-t border-slate-200/60 space-y-2 text-[11px] text-slate-600 leading-normal animate-fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white p-2.5 rounded-xl border border-slate-200">
              <div>
                <strong className="text-slate-800 block mb-0.5">1. Fanmingming 命名规则</strong>
                <span className="text-slate-500">
                  用于主流央视（如 <code>CCTV1.png</code>）、卫视（如 <code>湖南卫视.png</code>）和港澳频道。
                </span>
              </div>
              <div>
                <strong className="text-slate-800 block mb-0.5">2. 112114 命名规则</strong>
                <span className="text-slate-500">
                  用于各地方台、港澳台与网络特色频道（如 <code>民视.png</code>、<code>东森新闻.png</code>）。
                </span>
              </div>
            </div>
            <p className="text-[10.5px] text-slate-500">
              💡 <b>提示</b>：若您的播放设备访问 GitHub 官方源速度较慢，可点击下方「预置加速镜像」一键添加 JsDelivr CDN 加速镜像。
            </p>
          </div>
        )}
      </div>

      {/* Preset Quick Actions Bar */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="text-[11px] font-bold text-slate-600 mr-1 flex items-center gap-1">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          快捷填入预置源:
        </span>
        {POPULAR_LOGO_PRESETS.map((preset, pIdx) => {
          const isAlreadyAdded = logoSources.some(s => s.url.trim() === preset.url.trim());
          return (
            <button
              key={pIdx}
              type="button"
              onClick={() => {
                if (!isAlreadyAdded) {
                  addSource(preset);
                }
              }}
              disabled={isAlreadyAdded}
              title={isAlreadyAdded ? "该源已在列表中" : `点击添加: ${preset.url}`}
              className={`px-2.5 py-1 rounded-lg text-[10.5px] font-medium transition flex items-center gap-1 cursor-pointer ${
                isAlreadyAdded 
                  ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed" 
                  : "bg-white text-slate-700 hover:text-emerald-700 hover:bg-emerald-50/70 border border-slate-200 hover:border-emerald-300 shadow-2xs"
              }`}
            >
              <span>+ {preset.name.split(" ")[0]}</span>
              {preset.name.includes("jsDelivr") && <span className="text-[9px] bg-indigo-50 text-indigo-700 px-1 py-0.2 rounded font-bold">加速</span>}
            </button>
          );
        })}
      </div>

      {/* Sortable List */}
      {logoSources.length === 0 ? (
        <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
          <p className="text-xs text-slate-500 font-medium mb-3">暂未配置任何台标库 CDN 根地址</p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => addSource()}
              className="px-3.5 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition flex items-center gap-1.5 touch-press cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              添加台标库源
            </button>
            <button
              type="button"
              onClick={resetDefaults}
              className="px-3.5 py-2 text-xs font-bold text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition flex items-center gap-1.5 touch-press cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              恢复默认推荐源
            </button>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={logoSources.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2.5">
              {logoSources.map((source, idx) => (
                <SortableLogoCdnItem
                  key={source.id}
                  source={source}
                  idx={idx}
                  onUpdate={updateSource}
                  onRemove={removeSource}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Bottom Footer Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1 border-t border-slate-200/70">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => addSource()}
            className="px-3.5 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 border border-emerald-200 rounded-xl transition flex items-center gap-1.5 touch-press cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            添加台标库源
          </button>

          <button
            type="button"
            onClick={resetDefaults}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition flex items-center gap-1 touch-press cursor-pointer shrink-0"
            title="恢复默认推荐的官方台标源"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            重置默认官方源
          </button>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>按住左侧手柄拖拽可调整解析优先级</span>
        </div>
      </div>
    </div>
  );
}
