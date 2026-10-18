import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BulkDeleteToolbar } from "./BulkDeleteToolbar";

const actions = {
  onSelectAll: () => {},
  onClear: () => {},
  onDelete: () => {},
};

it("shows only the entry action before batch mode is enabled", () => {
  const html = renderToStaticMarkup(
    <BulkDeleteToolbar
      {...actions}
      active={false}
      onEnter={() => {}}
      count={0}
      hiddenCount={0}
      disabled={false}
      canSelect
    />,
  );
  expect(html).toContain("批次刪除");
  expect(html).not.toContain("清除選取");
  expect(html).not.toContain("刪除所選");
  expect(html).not.toContain("已選");
});

it("shows selection actions and an exit action in batch mode", () => {
  const html = renderToStaticMarkup(
    <BulkDeleteToolbar
      {...actions}
      active
      onExit={() => {}}
      count={1}
      hiddenCount={0}
      disabled={false}
      canSelect
    />,
  );
  expect(html).toContain("取消批次刪除");
  expect(html).toContain("清除選取");
  expect(html).toContain("刪除所選（1）");
});

it("shows selection count including hidden results and named failure reasons", () => {
  const html = renderToStaticMarkup(
    <BulkDeleteToolbar
      {...actions}
      count={3}
      hiddenCount={1}
      disabled={false}
      canSelect
      result={{
        deletedIds: ["a"],
        failures: [{ id: "b", name: "咖啡店", message: "咖啡店仍被行程引用" }],
      }}
    />,
  );
  expect(html).toContain("已選 3 筆");
  expect(html).toContain("1 筆不在目前結果中");
  expect(html).toContain("刪除所選（3）");
  expect(html).toContain("成功刪除 1 筆，失敗 1 筆");
  expect(html).toContain("咖啡店仍被行程引用");
  expect(html).toContain("失敗項目保留選取");
});

it("disables all actions while processing and destructive actions with no selection", () => {
  const busy = renderToStaticMarkup(
    <BulkDeleteToolbar
      {...actions}
      count={2}
      hiddenCount={0}
      disabled
      canSelect
    />,
  );
  expect(busy.match(/disabled=""/g)).toHaveLength(3);
  expect(busy).toContain("處理中…");
  const empty = renderToStaticMarkup(
    <BulkDeleteToolbar
      {...actions}
      count={0}
      hiddenCount={0}
      disabled={false}
      canSelect
    />,
  );
  expect(empty.match(/disabled=""/g)).toHaveLength(2);
});
