import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { Group } from "../types";

interface SortableGroupItemProps {
  group: Group;
  countChannels: number;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (group: Group) => void;
  onToggleIsolateGroup?: (id: string, isolated: boolean) => void;
}

export const SortableGroupItem: React.FC<SortableGroupItemProps> = ({
  group,
  countChannels,
  onRenameGroup,
  onDeleteGroup,
  onToggleIsolateGroup,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 20 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-4 border rounded-2xl flex items-center justify-between transition ${
        isDragging
          ? "border-2 border-dashed border-indigo-400 bg-indigo-50/50 shadow-md"
          : group.isolated
          ? "bg-orange-50/20 border-orange-200 opacity-80"
          : "border-slate-200 bg-slate-50/50 hover:border-slate-300"
      }`}
      id={`group_item_${group.id}`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0 pr-3">
        {/* Drag Handle */}
        <div
          {...attributes}
          {...listeners}
          className="p-1.5 cursor-grab active:cursor-grabbing text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition shrink-0 touch-none"
          title="按住拖拽以重新排序分组"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              defaultValue={group.name}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (!val || val === group.name) return;
                onRenameGroup(group.id, val);
              }}
              className={`font-bold text-slate-800 text-xs bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none hover:bg-slate-200/40 p-0.5 rounded transition ${group.isolated ? 'text-slate-500 line-through decoration-slate-400/50' : ''}`}
            />
            {group.isolated && (
              <span className="text-[9px] font-bold bg-orange-100 text-orange-700 border border-orange-200 px-1 py-0.5 rounded shrink-0">
                不导出
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 font-medium">
            关联频道:{" "}
            <span className="font-mono text-slate-600 font-bold">
              {countChannels}
            </span>{" "}
            个
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {onToggleIsolateGroup && (
          <button
            onClick={() => onToggleIsolateGroup(group.id, !group.isolated)}
            className={`p-2 border rounded-xl transition shadow-2xs cursor-pointer ${
              group.isolated
                ? "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-600"
                : "bg-white hover:bg-orange-50 border-slate-200 text-slate-400 hover:text-orange-600"
            }`}
            title={group.isolated ? "包含在导出列表" : "从导出列表排除"}
          >
            {group.isolated ? (
              <ShieldCheck className="w-3.5 h-3.5" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5" />
            )}
          </button>
        )}

        <button
          onClick={() => onDeleteGroup(group)}
          className="p-2 bg-white hover:bg-rose-50 border border-slate-200 text-slate-400 hover:text-rose-600 rounded-xl transition shadow-2xs cursor-pointer"
          title="删除此分组"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
