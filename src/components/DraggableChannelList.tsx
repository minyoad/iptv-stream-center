import React, { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { Tv, GripVertical } from "lucide-react";
import { Channel, Group } from "../types";
import { SortableChannelItem } from "./SortableChannelItem";

interface DraggableChannelListProps {
  channels: Channel[];
  selectedChannel: Channel | null;
  selectedChannelIds: string[];
  groups: Group[];
  onSelectChannel: (ch: Channel) => void;
  onDoubleClickChannel: (ch: Channel) => void;
  onToggleCheckChannel: (chId: string, checked: boolean) => void;
  onMoveChannelUp?: (chId: string) => void;
  onMoveChannelDown?: (chId: string) => void;
  onEditChannel: (ch: Channel) => void;
  onDeleteChannel: (chId: string) => void;
  onToggleIsolateChannel?: (chId: string, isolated: boolean) => void;
  onReorderChannels: (activeId: string, overId: string) => void;
}

export const DraggableChannelList: React.FC<DraggableChannelListProps> = ({
  channels,
  selectedChannel,
  selectedChannelIds,
  groups,
  onSelectChannel,
  onDoubleClickChannel,
  onToggleCheckChannel,
  onMoveChannelUp,
  onMoveChannelDown,
  onEditChannel,
  onDeleteChannel,
  onToggleIsolateChannel,
  onReorderChannels,
}) => {
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    const found = channels.find((c) => c.id === id);
    if (found) {
      setActiveChannel(found);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveChannel(null);

    if (over && active.id !== over.id) {
      onReorderChannels(active.id as string, over.id as string);
    }
  };

  const handleDragCancel = () => {
    setActiveChannel(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={channels.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="divide-y divide-slate-100" id="draggable_channels_list">
          {channels.map((ch, index) => (
            <SortableChannelItem
              key={ch.id}
              channel={ch}
              isSelected={selectedChannel?.id === ch.id}
              isChecked={selectedChannelIds.includes(ch.id)}
              groups={groups}
              onSelectChannel={onSelectChannel}
              onDoubleClickChannel={onDoubleClickChannel}
              onToggleCheckChannel={onToggleCheckChannel}
              onMoveUp={
                onMoveChannelUp ? () => onMoveChannelUp(ch.id) : undefined
              }
              onMoveDown={
                onMoveChannelDown ? () => onMoveChannelDown(ch.id) : undefined
              }
              onEditChannel={onEditChannel}
              onDeleteChannel={onDeleteChannel}
              onToggleIsolateChannel={onToggleIsolateChannel}
              isFirst={index === 0}
              isLast={index === channels.length - 1}
            />
          ))}
        </div>
      </SortableContext>

      {/* Modern floating Drag Overlay */}
      <DragOverlay
        dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: {
              active: {
                opacity: "0.5",
              },
            },
          }),
        }}
      >
        {activeChannel ? (
          <div className="p-3 bg-white border-2 border-indigo-500/80 rounded-2xl shadow-2xl flex items-center justify-between ring-4 ring-indigo-500/10 cursor-grabbing opacity-95 scale-[1.02] transition-transform">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="p-1 text-indigo-600 bg-indigo-50 rounded shrink-0">
                <GripVertical className="w-4 h-4" />
              </div>
              {activeChannel.logo ? (
                <img
                  src={activeChannel.logo}
                  alt="logo"
                  className="w-8 h-8 rounded-lg object-contain bg-slate-100 p-0.5 shadow-2xs shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 text-slate-400">
                  <Tv className="w-4 h-4" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate">
                  {activeChannel.name}
                </p>
                <p className="text-[10px] text-slate-400">
                  正在拖拽调序...
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full shrink-0 ml-2">
              {activeChannel.sources.filter((s) => s.status === "active").length}{" "}
              / {activeChannel.sources.length} 有效线路
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
