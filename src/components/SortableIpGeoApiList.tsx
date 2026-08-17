import React from "react";
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
import { SortableIpGeoApiItem } from "./SortableIpGeoApiItem";
import { IpGeoApi } from "../types";
import { Plus, RotateCcw, ShieldCheck } from "lucide-react";

interface Props {
  ipGeoApis: IpGeoApi[];
  setIpGeoApis: (apis: IpGeoApi[]) => void;
  autoSwitchGeoApi: boolean;
  setAutoSwitchGeoApi: (val: boolean) => void;
}

const DEFAULT_IP_GEO_APIS: IpGeoApi[] = [
  { id: "ip-api", name: "ip-api.com", url: "http://ip-api.com/json/{{ip}}?lang=zh-CN", enabled: true, failCount: 0 },
  { id: "pconline", name: "太平洋电脑网", url: "https://whois.pconline.com.cn/ipJson.jsp?ip={{ip}}&json=true", enabled: true, failCount: 0 }
];

export function SortableIpGeoApiList({
  ipGeoApis,
  setIpGeoApis,
  autoSwitchGeoApi,
  setAutoSwitchGeoApi,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = ipGeoApis.findIndex((api) => api.id === active.id);
      const newIndex = ipGeoApis.findIndex((api) => api.id === over.id);
      setIpGeoApis(arrayMove(ipGeoApis, oldIndex, newIndex));
    }
  };

  const updateApi = (idx: number, field: keyof IpGeoApi, value: any) => {
    const newApis = [...ipGeoApis];
    newApis[idx] = { ...newApis[idx], [field]: value };
    // If enabling, reset failCount
    if (field === "enabled" && value === true) {
      newApis[idx].failCount = 0;
    }
    setIpGeoApis(newApis);
  };

  const removeApi = (idx: number) => {
    const newApis = [...ipGeoApis];
    newApis.splice(idx, 1);
    setIpGeoApis(newApis);
  };

  const addApi = () => {
    const newId = `api_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setIpGeoApis([
      ...ipGeoApis,
      { id: newId, name: "自定义 API", url: "", enabled: true, failCount: 0 }
    ]);
  };

  const resetDefaults = () => {
    setIpGeoApis(DEFAULT_IP_GEO_APIS);
  };

  return (
    <div className="space-y-3.5">
      {ipGeoApis.length === 0 ? (
        <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
          <p className="text-xs text-slate-500 font-medium mb-3">暂未配置 IP 地理位置检测服务接口</p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={addApi}
              className="px-3.5 py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition flex items-center gap-1.5 touch-press cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              添加检测源
            </button>
            <button
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
          <SortableContext items={ipGeoApis.map(api => api.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2.5">
              {ipGeoApis.map((api, idx) => (
                <SortableIpGeoApiItem
                  key={api.id}
                  api={api}
                  idx={idx}
                  onUpdate={updateApi}
                  onRemove={removeApi}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      
      {/* Action Controls & Options */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2">
          <button
            onClick={addApi}
            className="px-3 py-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 border border-indigo-200 rounded-xl transition flex items-center gap-1.5 touch-press cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            添加检测源
          </button>
          
          <button
            onClick={resetDefaults}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition flex items-center gap-1 touch-press cursor-pointer shrink-0"
            title="恢复系统默认推荐的检测 API"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            重置默认
          </button>
        </div>

        <label className="flex items-start sm:items-center gap-2 cursor-pointer select-none bg-slate-50/70 p-2 sm:p-0 sm:bg-transparent rounded-xl border sm:border-0 border-slate-100">
          <input
            type="checkbox"
            checked={autoSwitchGeoApi}
            onChange={(e) => setAutoSwitchGeoApi(e.target.checked)}
            className="w-4 h-4 mt-0.5 sm:mt-0 text-indigo-600 rounded focus:ring-indigo-500 border-slate-300 cursor-pointer shrink-0"
          />
          <div className="text-xs font-semibold text-slate-700 leading-snug">
            <span className="flex items-center gap-1 text-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 inline shrink-0" />
              自动轮询与智能容灾
            </span>
            <span className="text-[11px] text-slate-500 font-normal block sm:inline sm:ml-1">
              (首选 API 失败时自动轮询下一个，连续失败自动禁用)
            </span>
          </div>
        </label>
      </div>
    </div>
  );
}
