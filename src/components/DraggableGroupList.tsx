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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { GripVertical, Layers } from "lucide-react";
import { Group, Channel } from "../types";
import { SortableGroupItem } from "./SortableGroupItem";

interface DraggableGroupListProps {
  groups: Group[];
  channels: Channel[];
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (group: Group) => void;
  onMoveGroupUp?: (index: number) => void;
  onMoveGroupDown?: (index: number) => void;
  onReorderGroups: (activeId: string, overId: string) => void;
}

export const DraggableGroupList: React.FC<DraggableGroupListProps> = ({
  groups,
  channels,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroupUp,
  onMoveGroupDown,
  onReorderGroups,
}) => {
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);

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
    const found = groups.find((g) => g.id === id);
    if (found) {
      setActiveGroup(found);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveGroup(null);

    if (over && active.id !== over.id) {
      onReorderGroups(active.id as string, over.id as string);
    }
  };

  const handleDragCancel = () => {
    setActiveGroup(null);
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
        items={groups.map((g) => g.id)}
        strategy={rectSortingStrategy}
      >
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          id="groups_cards_grid"
        >
          {groups.map((g, index) => {
            const countChannels = channels.filter((c) =>
              c.groupIds.includes(g.id)
            ).length;
            return (
              <SortableGroupItem
                key={g.id}
                group={g}
                countChannels={countChannels}
                onRenameGroup={onRenameGroup}
                onDeleteGroup={onDeleteGroup}
                onMoveUp={
                  onMoveGroupUp ? () => onMoveGroupUp(index) : undefined
                }
                onMoveDown={
                  onMoveGroupDown ? () => onMoveGroupDown(index) : undefined
                }
                isFirst={index === 0}
                isLast={index === groups.length - 1}
              />
            );
          })}
        </div>
      </SortableContext>

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
        {activeGroup ? (
          <div className="p-4 border-2 border-indigo-500 rounded-2xl bg-white shadow-2xl flex items-center justify-between ring-4 ring-indigo-500/10 scale-[1.02]">
            <div className="flex items-center gap-3">
              <div className="p-1.5 text-indigo-600 bg-indigo-50 rounded-lg shrink-0">
                <GripVertical className="w-4 h-4" />
              </div>
              <div>
                <p className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-500" />
                  {activeGroup.name}
                </p>
                <p className="text-[10px] text-indigo-500 font-medium">
                  正在拖拽调整分组顺序...
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
