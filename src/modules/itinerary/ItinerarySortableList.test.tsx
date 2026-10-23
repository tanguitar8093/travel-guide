import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ItineraryItem } from "../../database/models";
import { ItinerarySortableList, moveItineraryCard } from "./ItinerarySortableList";

const ids = ["first", "second", "third", "fourth"];
const items: ItineraryItem[] = ids.map((id, order) => ({
  id, order, tripId: "trip", placeId: id, date: "2026-10-23",
}));

it("moves a card to either end or a middle position without losing IDs", () => {
  expect(moveItineraryCard(ids, "first", 3)).toEqual(["second", "third", "fourth", "first"]);
  expect(moveItineraryCard(ids, "fourth", 0)).toEqual(["fourth", "first", "second", "third"]);
  expect(moveItineraryCard(ids, "first", 2)).toEqual(["second", "third", "first", "fourth"]);
  expect(ids).toEqual(["first", "second", "third", "fourth"]);
});

it("clamps keyboard movements at the boundaries and preserves no-op orders", () => {
  expect(moveItineraryCard(ids, "first", -1)).toEqual(ids);
  expect(moveItineraryCard(ids, "fourth", 20)).toEqual(ids);
  expect(moveItineraryCard(ids, "missing", 1)).toEqual(ids);
  expect(moveItineraryCard(ids, "second", 1)).toEqual(ids);
  expect(moveItineraryCard([], "missing", 0)).toEqual([]);
});

it("offers keyboard-accessible drag handles without persisting during rendering", () => {
  const reorder = vi.fn();
  const start = vi.fn();
  const html = renderToStaticMarkup(
    <ItinerarySortableList items={items} disabled={false} getName={item => item.id} onStart={start} onReorder={reorder}>
      {(item, index, ordered) => <div>{item.id}:{index}:{ordered.length}</div>}
    </ItinerarySortableList>,
  );
  expect(html.match(/class="itinerary-order itinerary-drag-handle"/g)).toHaveLength(4);
  expect(html).toContain("長按小卡拖曳排序");
  expect(html).toContain("空白鍵");
  expect(html).toContain("aria-live=\"polite\"");
  expect(reorder).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it.each([true, false])("does not expose reorder controls for disabled or single-card lists (%s)", disabled => {
  const html = renderToStaticMarkup(
    <ItinerarySortableList items={disabled ? items : items.slice(0, 1)} disabled={disabled}
      getName={item => item.id} onStart={vi.fn()} onReorder={vi.fn()}>
      {item => <div>{item.id}</div>}
    </ItinerarySortableList>,
  );
  expect(html).not.toContain("itinerary-drag-handle");
  expect(html).not.toContain("長按小卡");
  expect(html).toContain("itinerary-order");
});
