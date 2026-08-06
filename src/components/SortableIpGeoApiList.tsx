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
import { Plus } from "lucide-react";

interface Props {
  ipGeoApis: IpGeoApi[];
  setIpGeoApis: (apis: IpGeoApi[]) => void;
  autoSwitchGeoApi: boolean;
  setAutoSwitchGeoApi: (val: boolean) => void;
}

export function SortableIpGeoApiList({
  ipGeoApis,
  setIpGeoApis,
  autoSwitchGeoApi,
  setAutoSwitchGeoApi,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
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
      { id: newId, name: "新增 API", url: "", enabled: true, failCount: 0 }
    ]);
  };

  return (
    <div className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ipGeoApis.map(api => api.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
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
      
      <button
        onClick={addApi}
        className="px-3 py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-lg transition-colors flex items-center gap-1.5"
      >
        <Plus className="w-4 h-4" />
        添加检测源
      </button>

      <label className="flex items-center gap-2 cursor-pointer mt-2 pl-1">
        <input
          type="checkbox"
          checked={autoSwitchGeoApi}
          onChange={(e) => setAutoSwitchGeoApi(e.target.checked)}
          className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-slate-300"
        />
        <span className="text-xs font-bold text-slate-700">自动切换备用源 (当首选 API 失败或返回为空时自动轮询下一个，连续失败自动禁用)</span>
      </label>
    </div>
  );
}
