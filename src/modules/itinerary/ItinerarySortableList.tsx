import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import type { ItineraryItem } from "../../database/models";

export const itineraryDragDelay = 100;

export function moveItineraryCard(ids: readonly string[], id: string, index: number): string[] {
  const next = ids.filter(candidate => candidate !== id);
  if (next.length === ids.length) return [...ids];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  return next;
}

interface Props {
  items: ItineraryItem[];
  disabled: boolean;
  getName(item: ItineraryItem): string;
  onStart(): void;
  onReorder(ids: string[]): void;
  children(item: ItineraryItem, index: number, ordered: ItineraryItem[]): ReactNode;
}

interface Drag {
  id: string;
  ids: string[];
  initialIds: string[];
  pointerId?: number;
  x: number;
  y: number;
  left: number;
  width: number;
  offset: number;
  active: boolean;
}

export function ItinerarySortableList(props: Props) {
  const list = useRef<HTMLOListElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const drag = useRef<Drag | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const startAutoScroll = useRef<() => void>(() => {});
  const [preview, setPreview] = useState<Drag>();
  const [pressingId, setPressingId] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const suppressClick = useRef(false);
  const idsKey = JSON.stringify(props.items.map(item => item.id));
  const enabled = !props.disabled && props.items.length > 1;

  function stop(commit: boolean) {
    clearTimeout(timer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    const current = drag.current;
    drag.current = undefined;
    setPressingId(undefined);
    setPreview(undefined);
    if (!current?.active) return;
    const changed = current.ids.some((id, index) => id !== current.initialIds[index]);
    if (commit && changed) latest.current.onReorder(current.ids);
    setAnnouncement(commit ? "已放下卡片；順序變更請按儲存排序。" : "已取消拖曳，順序未變更。");
  }

  useEffect(() => {
    function updatePosition() {
      const current = drag.current;
      const host = list.current;
      if (!current?.active || current.pointerId === undefined || !host) return;
      const rows = [...host.querySelectorAll<HTMLElement>("[data-itinerary-card]")];
      const others = rows.filter(row => row.dataset.itineraryCard !== current.id);
      const index = others.filter(row => current.y > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2).length;
      current.ids = moveItineraryCard(current.ids, current.id, index);
      setPreview(previous =>
        previous?.x === current.x && previous.y === current.y &&
        previous.ids.every((id, position) => id === current.ids[position])
          ? previous : { ...current });
    }
    function tick() {
      const current = drag.current;
      const host = list.current;
      if (!current?.active || current.pointerId === undefined || !host) return;
      const scroller = host.closest<HTMLElement>(".itinerary-items-scroll");
      const scrollable = scroller && scroller.scrollHeight > scroller.clientHeight;
      const bounds = scrollable ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const top = Math.max(0, bounds.top);
      const bottom = Math.min(window.innerHeight, bounds.bottom);
      const speed = current.y < top + 48 ? -10 : current.y > bottom - 48 ? 10 : 0;
      if (speed) {
        if (scrollable) scroller.scrollTop += speed;
        else window.scrollBy(0, speed);
      }
      updatePosition();
      frame.current = requestAnimationFrame(tick);
    }
    function move(event: globalThis.PointerEvent) {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.active) {
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) stop(false);
        return;
      }
      event.preventDefault();
      current.x = event.clientX;
      current.y = event.clientY;
    }
    function end(event: globalThis.PointerEvent) {
      const current = drag.current;
      if (current?.pointerId !== event.pointerId) return;
      if (current.active && event.type === "pointerup") {
        current.x = event.clientX;
        current.y = event.clientY;
        updatePosition();
      }
      stop(event.type === "pointerup");
    }
    function touchMove(event: TouchEvent) {
      if (drag.current?.active) event.preventDefault();
    }
    function key(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault();
        stop(false);
      }
    }
    function cancel() { stop(false); }
    startAutoScroll.current = () => {
      if (drag.current?.active && frame.current === undefined) tick();
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    document.addEventListener("touchmove", touchMove, { passive: false });
    document.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      clearTimeout(timer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      drag.current = undefined;
      startAutoScroll.current = () => {};
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      document.removeEventListener("touchmove", touchMove);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
    };
  }, []);

  useEffect(() => { stop(false); }, [idsKey, enabled]);

  function activate(current: Drag) {
    if (drag.current !== current || latest.current.disabled) return;
    latest.current.onStart();
    setPressingId(undefined);
    current.active = true;
    suppressClick.current = current.pointerId !== undefined;
    window.getSelection()?.removeAllRanges();
    setPreview({ ...current });
    setAnnouncement("已拿起卡片。上下拖曳後放開；鍵盤可用方向鍵移動，空白鍵放下，Escape 取消。");
    if (current.pointerId !== undefined) startAutoScroll.current();
  }

  function pointerDown(event: PointerEvent<HTMLLIElement>, item: ItineraryItem) {
    if (!enabled || !event.isPrimary || event.button !== 0 || drag.current) return;
    const target = event.target;
    if (target instanceof Element && target.closest("a, input, select, textarea, button:not(.itinerary-drag-handle)")) return;
    suppressClick.current = false;
    const rect = event.currentTarget.getBoundingClientRect();
    const ids = latest.current.items.map(candidate => candidate.id);
    const current: Drag = {
      id: item.id, ids, initialIds: [...ids], pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, left: rect.left, width: rect.width,
      offset: event.clientY - rect.top, active: false,
    };
    drag.current = current;
    setPressingId(item.id);
    timer.current = setTimeout(() => activate(current), itineraryDragDelay);
  }

  function keyboard(event: KeyboardEvent<HTMLButtonElement>, item: ItineraryItem) {
    if (!enabled) return;
    const current = drag.current;
    if (event.key === "Tab" && current?.active && current.pointerId === undefined) {
      stop(false);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (current?.active && current.pointerId === undefined) stop(true);
      else if (!current) {
        const ids = latest.current.items.map(candidate => candidate.id);
        const next: Drag = { id: item.id, ids, initialIds: [...ids], x: 0, y: 0, left: 0, width: 0, offset: 0, active: false };
        drag.current = next;
        activate(next);
      }
    } else if (current?.active && current.pointerId === undefined && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = current.ids.indexOf(current.id);
      const target = event.key === "Home" ? 0 : event.key === "End" ? current.ids.length - 1 : index + (event.key === "ArrowUp" ? -1 : 1);
      current.ids = moveItineraryCard(current.ids, current.id, target);
      setPreview({ ...current });
      setAnnouncement(`目前位置 ${current.ids.indexOf(current.id) + 1}，共 ${current.ids.length} 個地點。`);
    }
  }

  const currentPreview = enabled && preview && JSON.stringify(preview.initialIds) === idsKey ? preview : undefined;
  const itemById = new Map(props.items.map(item => [item.id, item]));
  const ordered = currentPreview ? currentPreview.ids.flatMap(id => {
    const item = itemById.get(id);
    return item ? [item] : [];
  }) : props.items;
  const draggedItem = currentPreview ? itemById.get(currentPreview.id) : undefined;
  return <>
    {enabled && <p className="itinerary-sort-hint">長按小卡拖曳排序，放下後按「儲存排序」。</p>}
    <p className="itinerary-sort-status" role="status" aria-live="polite">{announcement}</p>
    <ol ref={list} className={`itinerary-item-list${currentPreview ? " itinerary-list-dragging" : ""}`}
      onClickCapture={event => {
        if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
      }}
      onContextMenu={event => { if (drag.current) event.preventDefault(); }}
      onDragStart={event => event.preventDefault()}>
      {ordered.map((item, index) => <li key={item.id} data-itinerary-card={item.id}
        className={`itinerary-item-row${enabled ? " itinerary-item-sortable" : ""}${enabled && pressingId === item.id ? " itinerary-item-pressing" : ""}${currentPreview?.id === item.id ? " itinerary-item-dragging" : ""}`}
        onPointerDown={event => pointerDown(event, item)}>
        {enabled ? <button type="button" className="itinerary-order itinerary-drag-handle"
          aria-label={`調整${props.getName(item)}順序；長按拖曳，或按空白鍵後用方向鍵移動`}
          aria-pressed={currentPreview?.id === item.id}
          title="長按拖曳排序；鍵盤：空白鍵拿起、方向鍵移動、空白鍵放下"
          onKeyDown={event => keyboard(event, item)}>
          {String(index + 1).padStart(2, "0")}
        </button> : <span className="itinerary-order">{String(index + 1).padStart(2, "0")}</span>}
        {props.children(item, index, ordered)}
      </li>)}
    </ol>
    {draggedItem && currentPreview?.pointerId !== undefined && <div
      className="itinerary-drag-preview" aria-hidden="true"
      style={{ left: currentPreview.left, top: currentPreview.y - currentPreview.offset, width: currentPreview.width }}>
      <span>⠿</span><strong>{props.getName(draggedItem)}</strong>
    </div>}
  </>;
}
