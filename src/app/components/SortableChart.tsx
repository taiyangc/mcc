"use client";
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ReactNode } from 'react';

interface DragHandleProps {
  listeners: ReturnType<typeof useSortable>['listeners'];
  attributes: ReturnType<typeof useSortable>['attributes'];
}

interface SortableChartProps {
  id: string;
  cols?: number;
  rows?: number;
  children: (dragHandleProps: DragHandleProps) => ReactNode;
}

export function SortableChart({ id, cols = 1, rows = 1, children }: SortableChartProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    minHeight: 350 * rows,
    gridColumn: `span ${cols}`,
    gridRow: `span ${rows}`,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative bg-white dark:bg-zinc-900 flex"
    >
      {children({ listeners, attributes })}
    </div>
  );
}
