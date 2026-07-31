import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Tv, ChevronUp, ChevronDown, Edit2, Trash2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Channel, Group } from "../types";

interface SortableChannelItemProps {
  channel: Channel;
  isSelected: boolean;
  isChecked: boolean;
  groups: Group[];
  onSelectChannel: (ch: Channel) => void;
  onDoubleClickChannel: (ch: Channel) => void;
  onToggleCheckChannel: (chId: string, checked: boolean) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onEditChannel: (ch: Channel) => void;
  onDeleteChannel: (chId: string) => void;
  onToggleIsolateChannel?: (chId: string, isolated: boolean) => void;
}

export const SortableChannelItem: React.FC<SortableChannelItemProps> = ({
  channel,
  isSelected,
  isChecked,
  groups,
  onSelectChannel,
  onDoubleClickChannel,
  onToggleCheckChannel,
  onMoveUp,
  onMoveDown,
  onEditChannel,
  onDeleteChannel,
  onToggleIsolateChannel,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: channel.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    position: "relative",
    zIndex: isDragging ? 20 : 1,
  };

  const activeCount = channel.sources.filter((s) => s.status === "active").length;
  const groupNames = channel.groupIds
    .map((gId) => groups.find((g) => g.id === gId)?.name)
    .filter(Boolean)
    .join(", ");

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onSelectChannel(channel)}
      onDoubleClick={() => onDoubleClickChannel(channel)}
      className={`p-2 py-2.5 transition-all flex items-center justify-between cursor-pointer border-b border-slate-100/80 group/row ${
        isSelected
          ? "bg-blue-50/70 border-l-4 border-l-blue-600 shadow-2xs"
          : isDragging
          ? "bg-indigo-50/40 border-2 border-dashed border-indigo-300"
          : channel.isolated
          ? "bg-orange-50/20 hover:bg-orange-50/40 border-l-2 border-l-orange-400 opacity-80"
          : "hover:bg-slate-50/80"
      }`}
      id={`channel_sortable_item_${channel.id}`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {/* Drag handle button */}
        <div
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="p-0.5 cursor-grab active:cursor-grabbing text-slate-300 hover:text-indigo-600 hover:bg-indigo-50/80 rounded transition shrink-0 touch-none"
          title="按住拖拽以重新排序"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Multi-select Checkbox */}
        <input
          type="checkbox"
          className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer shrink-0"
          checked={isChecked}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleCheckChannel(channel.id, e.target.checked)}
        />

        {/* Channel Logo */}
        {channel.logo ? (
          <img
            src={channel.logo}
            alt="logo"
            className="w-7 h-7 rounded-lg object-contain bg-slate-100 p-0.5 shadow-2xs shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 text-slate-400 shadow-2xs">
            <Tv className="w-4 h-4" />
          </div>
        )}

        {/* Channel Information */}
        <div className="min-w-[40px] flex-1 shrink">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-bold text-slate-800 break-words line-clamp-2 leading-tight">
              {channel.name}
            </p>
            {channel.isolated && (
              <span className="text-[9px] font-bold bg-orange-100 text-orange-700 border border-orange-200 px-1 py-0.2 rounded shrink-0">
                已隔离
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5 truncate">
            EPG ID:{" "}
            <span className="font-mono text-[9px] text-slate-500 font-bold bg-slate-100 px-1 py-0.5 rounded">
              {channel.epgId || "无"}
            </span>
          </p>
        </div>
      </div>

      {/* Right Actions & Badges */}
      <div className="flex items-center gap-1 shrink ml-1 min-w-0 justify-end">
        {/* Count pill badge */}
        <span className="text-[9px] font-bold bg-slate-100 text-slate-500 px-1 py-0.5 rounded hidden lg:inline-block shrink-0">
          {activeCount}/{channel.sources.length}
        </span>

        {/* Group Name badge */}
        <span
          className="text-[9px] font-semibold bg-blue-50 text-blue-600 px-1 py-0.5 rounded max-w-12 sm:max-w-16 truncate shrink"
          title={groupNames || "其它"}
        >
          {groupNames || "其它"}
        </span>

        {/* Button Actions */}
        <div className="flex items-center gap-0 shrink-0">
          {onToggleIsolateChannel && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleIsolateChannel(channel.id, !channel.isolated);
              }}
              className={`p-1 rounded transition ${
                channel.isolated
                  ? "text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50"
                  : "text-slate-400 hover:text-orange-600 hover:bg-orange-50"
              }`}
              title={channel.isolated ? "解除隔离频道" : "隔离此频道 (防导出)"}
            >
              {channel.isolated ? (
                <ShieldCheck className="w-3.5 h-3.5" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditChannel(channel);
            }}
            className="p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded transition"
            title="编辑"
          >
            <Edit2 className="w-3 h-3" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteChannel(channel.id);
            }}
            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
            title="删除"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
