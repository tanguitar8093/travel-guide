import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Label, Place } from "../../database";
import { WorkspaceLayout } from "../../common/WorkspaceLayout";
import { labelController } from "./label.controller";
import type { LabelTreeNode } from "./label.service";
import "./LabelModule.css";
import { useBulkDelete } from '../../common/useBulkDelete';
import { BulkDeleteToolbar } from '../../common/BulkDeleteToolbar';
import type { BulkOperationResult } from '../../common/bulk-operation';
import { BulkColorToolbar } from './BulkColorToolbar';

const labelColors = [
  "#e9905a",
  "#d97768",
  "#c4809b",
  "#8b80b5",
  "#758dab",
  "#6c9a79",
  "#b77a53",
  "#5f9b9b",
];

interface LabelDialogState {
  parentId?: string;
}

function flattenTree(nodes: LabelTreeNode[]): LabelTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function filterTree(nodes: LabelTreeNode[], query: string): LabelTreeNode[] {
  if (!query.trim()) {
    return nodes;
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  return nodes.reduce<LabelTreeNode[]>((matches, node) => {
    const children = filterTree(node.children, query);
    if (
      node.name.toLocaleLowerCase().includes(normalizedQuery) ||
      children.length > 0
    ) {
      matches.push({ ...node, children });
    }
    return matches;
  }, []);
}

interface SearchableOption {
  id: string;
  name: string;
  color?: string;
  depth?: number;
}

function SearchableSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selected = options.find((option) => option.id === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = options.filter((option) =>
    option.name.toLocaleLowerCase().includes(normalizedQuery),
  );
  const expanded = open && !disabled;

  function select(option: SearchableOption) {
    onChange(option.id);
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }

  return (
    <div className="label-searchable-select">
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-options`}
        aria-activedescendant={
          expanded && filtered[activeIndex]
            ? `${id}-option-${activeIndex}`
            : undefined
        }
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={expanded ? query : (selected?.name ?? "")}
        onFocus={() => {
          setQuery("");
          setOpen(true);
          setActiveIndex(-1);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery("");
          setActiveIndex(-1);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) =>
              Math.min(
                Math.max(current + (event.key === "ArrowDown" ? 1 : -1), 0),
                filtered.length - 1,
              ),
            );
          } else if (event.key === "Enter" && expanded) {
            event.preventDefault();
            if (filtered[activeIndex]) select(filtered[activeIndex]);
          } else if (event.key === "Escape" && expanded) {
            event.preventDefault();
            setOpen(false);
            setQuery("");
            setActiveIndex(-1);
          }
        }}
      />
      {expanded && (
        <ul id={`${id}-options`} role="listbox" aria-label={label}>
          {filtered.length ? (
            filtered.map((option, index) => (
              <li
                id={`${id}-option-${index}`}
                key={option.id}
                role="option"
                aria-selected={option.id === value}
                className={activeIndex === index ? "active" : ""}
                style={{ paddingInlineStart: 10 + (option.depth ?? 0) * 12 }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(option)}
              >
                {option.color && (
                  <i
                    className="label-searchable-color"
                    style={{ backgroundColor: option.color }}
                    aria-hidden="true"
                  />
                )}
                <span>{option.name}</span>
                {option.id === value && <span aria-hidden="true">✓</span>}
              </li>
            ))
          ) : (
            <li className="label-searchable-empty" role="presentation">
              找不到符合的選項
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function LabelModule() {
  const bulk = useBulkDelete();
  const [bulkMode, setBulkMode] = useState<"delete" | "color">("delete");
  const [bulkColor, setBulkColor] = useState(labelColors[0]);
  const [bulkColorResult, setBulkColorResult] = useState<BulkOperationResult>();
  const bulkColorRunning = useRef(false);
  const [tree, setTree] = useState<LabelTreeNode[]>([]);
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(labelColors[0]);
  const [draftParentId, setDraftParentId] = useState("");
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [activeTab, setActiveTab] = useState<"taxonomy" | "preview">("taxonomy");
  const [previewSearch, setPreviewSearch] = useState("");
  const [matchingPlaces, setMatchingPlaces] = useState<Place[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const [dialog, setDialog] = useState<LabelDialogState | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [dialogColor, setDialogColor] = useState(labelColors[0]);
  const [menuLabelId, setMenuLabelId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [singleSaving, setSaving] = useState(false);
  const saving = singleSaving || bulk.busy;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const flatLabels = useMemo(() => flattenTree(tree), [tree]);
  const selectedLabel = flatLabels.find((label) => label.id === selectedId);
  const visibleTree = useMemo(() => filterTree(tree, search), [tree, search]);
  const descendantIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const selected = flatLabels.find((label) => label.id === selectedId);
    return new Set(
      selected ? flattenTree(selected.children).map((label) => label.id) : [],
    );
  }, [flatLabels, selectedId]);
  const parentChoices = flatLabels.filter(
    (label) => label.id !== selectedId && !descendantIds.has(label.id),
  );

  async function refreshTree(preferredId = selectedId) {
    const nextTree = await labelController.listTree();
    const nextLabels = flattenTree(nextTree);
    const nextSelectedLabel =
      nextLabels.find((label) => label.id === preferredId) ?? nextLabels[0];
    setTree(nextTree);
    setSelectedId(nextSelectedLabel?.id);
    setDraftName(nextSelectedLabel?.name ?? "");
    setDraftColor(nextSelectedLabel?.color ?? labelColors[0]);
    setDraftParentId(nextSelectedLabel?.parentId ?? "");
    setSelectedPlaceId("");
    setExpandedIds(new Set(nextLabels.map((label) => label.id)));
  }

  async function refreshPlaces(
    labelId: string,
    withDescendants = includeDescendants,
  ) {
    const results = await labelController.findPlaces(labelId, withDescendants);
    setMatchingPlaces(results);
  }

  useEffect(() => {
    let active = true;
    Promise.all([labelController.listTree(), labelController.listPlaces()])
      .then(([nextTree, places]) => {
        if (!active) return;
        const labels = flattenTree(nextTree);
        const firstLabel = labels[0];
        setTree(nextTree);
        setAllPlaces(places);
        setSelectedId(firstLabel?.id);
        setDraftName(firstLabel?.name ?? "");
        setDraftColor(firstLabel?.color ?? labelColors[0]);
        setDraftParentId(firstLabel?.parentId ?? "");
        setExpandedIds(new Set(labels.map((label) => label.id)));
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "載入標籤資料失敗。",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    let active = true;
    labelController
      .findPlaces(selectedId, includeDescendants)
      .then((results) => {
        if (active) setMatchingPlaces(results);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "載入地點資料失敗。",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [selectedId, includeDescendants]);

  const displayedPlaces = selectedId ? matchingPlaces : [];
  const filteredPreviewPlaces = displayedPlaces.filter((place) => {
    const query = previewSearch.trim().toLocaleLowerCase();
    return (
      !query ||
      place.name.toLocaleLowerCase().includes(query) ||
      place.notes?.toLocaleLowerCase().includes(query)
    );
  });

  function openCreateDialog(parentId?: string) {
    if (saving) return;
    setDialog({ parentId });
    setDialogName("");
    setDialogColor(labelColors[0]);
    setError("");
    setNotice("");
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!dialog) return;

    setSaving(true);
    setError("");
    try {
      const id = await labelController.create({
        name: dialogName.trim(),
        color: dialogColor,
        ...(dialog.parentId ? { parentId: dialog.parentId } : {}),
      });
      await refreshTree(id);
      setDialog(null);
      setNotice("標籤已建立。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "建立標籤失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    if (!selectedLabel) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await labelController.update(selectedLabel.id, {
        name: draftName.trim(),
        color: draftColor,
        ...(draftParentId
          ? { parentId: draftParentId }
          : { parentId: undefined }),
      });
      await refreshTree(selectedLabel.id);
      setNotice("標籤變更已儲存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "儲存標籤失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkColor() {
    if (saving || bulkColorRunning.current || !bulk.selectedIds.size) return;
    bulkColorRunning.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    setBulkColorResult(undefined);
    try {
      const result = await labelController.updateColorMany([...bulk.selectedIds], bulkColor);
      setBulkColorResult(result);
      bulk.setSelectedIds(new Set(result.failures.map((failure) => failure.id)));
      await refreshTree();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新或重新載入失敗，請重新整理確認結果。");
    } finally {
      bulkColorRunning.current = false;
      setSaving(false);
    }
  }

  async function handleDelete(label: Label) {
    if (saving) return;
    const confirmed = window.confirm(`確定要刪除「${label.name}」嗎？`);
    if (!confirmed) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await labelController.delete(label.id);
      await refreshTree();
      setMenuLabelId(undefined);
      setNotice(`標籤「${label.name}」已刪除。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "刪除標籤失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!selectedId || !selectedPlaceId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await labelController.assignToPlace(selectedPlaceId, selectedId);
      await Promise.all([
        refreshPlaces(selectedId),
        labelController.listPlaces().then(setAllPlaces),
      ]);
      setSelectedPlaceId("");
      setNotice("標籤已套用至地點。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "套用標籤失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveFromPlace(place: Place) {
    if (saving) return;
    if (!selectedId || !place.labelIds.includes(selectedId)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await labelController.removeFromPlace(place.id, selectedId);
      await Promise.all([
        refreshPlaces(selectedId),
        labelController.listPlaces().then(setAllPlaces),
      ]);
      setNotice(`已從「${place.name}」移除此標籤。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除地點標籤失敗。");
    } finally {
      setSaving(false);
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderTree(nodes: LabelTreeNode[], depth = 0) {
    return nodes.map((node) => {
      const expanded = search.trim() ? true : expandedIds.has(node.id);
      return (
        <div className="tree-group" key={node.id}>
          <div
            className={`tree-row ${depth === 0 ? "parent-row" : "child-row"}${selectedId === node.id ? " selected" : ""}`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            {bulk.active && <input className="bulk-select-checkbox" type="checkbox" aria-label={`選取標籤「${node.name}」`} checked={bulk.selectedIds.has(node.id)} disabled={saving} onChange={() => bulk.toggle(node.id)} />}
            {node.children.length > 0 ? (
              <button
                className="chevron tree-toggle"
                type="button"
                aria-label={`${expanded ? "收合" : "展開"}${node.name}`}
                onClick={() => toggleExpanded(node.id)}
              >
                {expanded ? "⌄" : "›"}
              </button>
            ) : (
              <span className="chevron" />
            )}
            <button
              className="tree-select"
              type="button"
              disabled={saving}
              onClick={() => {
                setSelectedId(node.id);
                setDraftName(node.name);
                setDraftColor(node.color);
                setDraftParentId(node.parentId ?? "");
                setSelectedPlaceId("");
                setError("");
                setNotice("");
              }}
              aria-current={selectedId === node.id ? "true" : undefined}
            >
              <span
                className="color-dot"
                style={{ backgroundColor: node.color }}
              />
              <span className="tree-name">{node.name}</span>
            </button>
            <button
              className="row-menu"
              type="button"
              aria-label={`${node.name}操作`}
              aria-expanded={menuLabelId === node.id}
              onClick={() =>
                setMenuLabelId(menuLabelId === node.id ? undefined : node.id)
              }
            >
              ···
            </button>
            {menuLabelId === node.id && (
              <div className="tree-action-menu">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(node.id);
                    setDraftName(node.name);
                    setDraftColor(node.color);
                    setDraftParentId(node.parentId ?? "");
                    setMenuLabelId(undefined);
                  }}
                >
                  編輯標籤
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openCreateDialog(node.id);
                    setMenuLabelId(undefined);
                  }}
                >
                  新增子標籤
                </button>
                <button
                  className="danger-action"
                  type="button"
                  disabled={saving}
                  onClick={() => void handleDelete(node)}
                >
                  刪除標籤
                </button>
              </div>
            )}
          </div>
          {expanded &&
            node.children.length > 0 &&
            renderTree(node.children, depth + 1)}
        </div>
      );
    });
  }

  function renderTaxonomyPanel(previewMode = false) {
    return (
      <div className="panel taxonomy-panel">
        <div className="panel-heading">
          <div>
            <h2>{previewMode ? "選擇標籤" : "標籤分類"}</h2>
            <p>{previewMode ? "選取分類以預覽已套用的地點" : "以階層整理標籤"}</p>
          </div>
          <button
            className="subtle-icon-button"
            type="button"
            aria-label="新增根標籤"
            title="新增根標籤"
            onClick={() => openCreateDialog()}
          >
            ＋
          </button>
        </div>

        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="搜尋標籤"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              className="clear-search"
              type="button"
              onClick={() => setSearch("")}
              aria-label="清除搜尋"
            >
              ×
            </button>
          )}
        </label>

        <div className="tree-list">
          {!previewMode && (bulk.active && bulkMode === "color" ? <BulkColorToolbar
            count={bulk.selectedIds.size}
            hiddenCount={[...bulk.selectedIds].filter((id) => !flattenTree(visibleTree).some((label) => label.id === id)).length}
            disabled={saving || loading}
            canSelect={flattenTree(visibleTree).length > 0}
            color={bulkColor}
            colors={labelColors}
            onColorChange={setBulkColor}
            onSelectAll={() => bulk.setSelectedIds((current) => new Set([...current, ...flattenTree(visibleTree).map((label) => label.id)]))}
            onClear={() => bulk.setSelectedIds(new Set())}
            onApply={() => void handleBulkColor()}
            onExit={bulk.exit}
            result={bulkColorResult}
          /> : <BulkDeleteToolbar
            active={bulk.active} onEnter={() => { setBulkMode("delete"); bulk.enter(); }} onExit={bulk.exit}
            count={bulk.selectedIds.size}
            hiddenCount={[...bulk.selectedIds].filter((id) => !flattenTree(visibleTree).some((label) => label.id === id)).length}
            disabled={saving || loading}
            canSelect={flattenTree(visibleTree).length > 0}
            onSelectAll={() => bulk.setSelectedIds((current) => new Set([...current, ...flattenTree(visibleTree).map((label) => label.id)]))}
            onClear={() => bulk.setSelectedIds(new Set())}
            onDelete={() => { void bulk.remove({ records: flatLabels, entity: '標籤', deleteMany: (ids) => labelController.deleteMany(ids), reload: async () => { await refreshTree(); setAllPlaces(await labelController.listPlaces()); } }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '刪除或重新載入失敗，請重新整理確認結果。')); }}
            result={bulk.result}
            entryActions={<button
              type="button"
              disabled={saving || loading || !flatLabels.length}
              onClick={() => {
                setBulkMode("color");
                setBulkColor(labelColors[0]);
                setBulkColorResult(undefined);
                setError("");
                setNotice("");
                bulk.enter();
              }}
            >批次更新</button>}
          />)}
          <div className="tree-section-label">
            所有標籤 <span>{flatLabels.length}</span>
          </div>
          {loading ? (
            <div className="empty-state">正在載入標籤…</div>
          ) : visibleTree.length ? (
            renderTree(visibleTree)
          ) : (
            <div className="empty-state">
              {search
                ? "找不到符合的標籤。"
                : "目前還沒有標籤，先建立一個分類吧。"}
            </div>
          )}
          <button
            className="add-root-link"
            type="button"
            onClick={() => openCreateDialog()}
          >
            <span>＋</span> 新增分類
          </button>
        </div>

        <div className="tree-footer">
          <span className="footer-dot" />
          可建立多層子標籤
        </div>
      </div>
    );
  }

  return (
    <WorkspaceLayout
      active="labels"
      counts={{ labels: flatLabels.length }}
      shellClassName="app-shell"
      mainClassName="main-content"
    >
      <div className="page-content">
        <section className="page-heading">
          <div className="workspace-page-heading-title">
            <h1>標籤</h1>
            <p>建立分類層級，讓收藏的地點更容易整理與尋找。</p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => openCreateDialog()}
          >
            <span aria-hidden="true">＋</span>
            新增標籤
          </button>
        </section>

        {error && (
          <div className="feedback-message error-message" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="feedback-message success-message" role="status">
            {notice}
          </div>
        )}

        <div className="module-tabs" role="tablist" aria-label="標籤模組頁面">
          <button
            id="taxonomy-tab"
            className={`module-tab${activeTab === "taxonomy" ? " selected" : ""}`}
            type="button"
            role="tab"
            aria-controls="taxonomy-panel"
            aria-selected={activeTab === "taxonomy"}
            onClick={() => setActiveTab("taxonomy")}
          >
            標籤分類
          </button>
          <button
            id="place-preview-tab"
            className={`module-tab${activeTab === "preview" ? " selected" : ""}`}
            type="button"
            role="tab"
            aria-controls="place-preview-panel"
            aria-selected={activeTab === "preview"}
            onClick={() => setActiveTab("preview")}
          >
            地點套用預覽
          </button>
        </div>

        <section
          id="taxonomy-panel"
          className="workspace-grid"
          aria-label="標籤分類"
          role="tabpanel"
          aria-labelledby="taxonomy-tab"
          hidden={activeTab !== "taxonomy"}
        >
          {renderTaxonomyPanel()}
          <div className="detail-column">
            {selectedLabel ? (
              <section className="panel detail-panel">
                <div className="panel-heading detail-heading">
                  <div>
                    <div className="section-kicker">標籤詳細資料</div>
                    <h2>
                      <span
                        className="large-color-dot"
                        style={{ backgroundColor: draftColor }}
                      />
                      {selectedLabel.name}
                    </h2>
                  </div>
                  <div className="detail-heading-actions">
                    <button
                      className="save-button"
                      type="button"
                      disabled={
                        saving ||
                        !draftName.trim() ||
                        (draftName.trim() === selectedLabel.name &&
                          draftColor === selectedLabel.color &&
                          (draftParentId || undefined) === selectedLabel.parentId)
                      }
                      onClick={() => void handleSave()}
                    >
                      {saving ? "儲存中…" : "儲存變更"}
                    </button>
                    <button
                      className="delete-label-button"
                      type="button"
                      aria-label={`刪除${selectedLabel.name}`}
                      title="刪除標籤"
                      disabled={saving}
                      onClick={() => void handleDelete(selectedLabel)}
                    >
                      刪除標籤
                    </button>
                  </div>
                </div>

                <div className="form-fields">
                  <label className="form-field">
                    <span>標籤名稱</span>
                    <input
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      maxLength={60}
                    />
                  </label>

                  <div className="form-field">
                    <span>標籤顏色</span>
                    <div className="color-picker-placeholder">
                      <span
                        className="selected-color"
                        style={{ backgroundColor: draftColor }}
                      />
                      <span>{draftColor}</span>
                    </div>
                    <div className="color-swatches" aria-label="選擇標籤顏色">
                      {labelColors.map((color) => (
                        <button
                          className={`color-swatch${color === draftColor ? " chosen" : ""}`}
                          key={color}
                          type="button"
                          aria-label={`選擇顏色 ${color}`}
                          aria-pressed={color === draftColor}
                          style={{ backgroundColor: color }}
                          onClick={() => setDraftColor(color)}
                        />
                      ))}
                      <label className="custom-color-control" title="自訂顏色">
                        <span>＋</span>
                        <input
                          type="color"
                          aria-label="自訂標籤顏色"
                          value={draftColor}
                          onChange={(event) =>
                            setDraftColor(event.target.value)
                          }
                        />
                      </label>
                    </div>
                  </div>

                  <div className="form-field parent-select-field">
                    <span>上層分類</span>
                    <SearchableSelect
                      key={selectedLabel.id}
                      label="上層分類"
                      placeholder="搜尋或選擇上層分類"
                      value={draftParentId}
                      onChange={setDraftParentId}
                      disabled={saving}
                      options={[
                        { id: "", name: "無（根分類）" },
                        ...parentChoices.map((label) => ({
                          id: label.id,
                          name: label.name,
                          color: label.color,
                          depth: labelDepth(label, flatLabels),
                        })),
                      ]}
                    />
                    <small>
                      調整上層分類即可移動此標籤；不能移到自己的子標籤下。
                    </small>
                  </div>
                </div>

              </section>
            ) : (
              <section className="panel no-selection-panel">
                <div className="empty-state">
                  選取或新增標籤以編輯詳細資料。
                </div>
              </section>
            )}

            <section className="panel usage-panel">
              <div className="usage-heading">
                <div>
                  <h2>套用中的地點</h2>
                  <p>
                    {displayedPlaces.length} 個地點
                    {includeDescendants ? "（包含子標籤）" : "（直接套用）"}
                  </p>
                </div>
                <label className="descendant-toggle">
                  <input
                    type="checkbox"
                    checked={includeDescendants}
                    onChange={(event) =>
                      setIncludeDescendants(event.target.checked)
                    }
                  />
                  包含子標籤
                </label>
              </div>

              {selectedLabel && (
                <form
                  className="assign-place-form"
                  onSubmit={(event) => void handleAssign(event)}
                >
                  <SearchableSelect
                    key={selectedLabel.id}
                    label="選擇要套用標籤的地點"
                    placeholder="搜尋或選擇地點"
                    value={selectedPlaceId}
                    onChange={setSelectedPlaceId}
                    disabled={saving}
                    options={allPlaces.filter(
                      (place) => !place.labelIds.includes(selectedLabel.id),
                    )}
                  />
                  <button
                    className="assign-button"
                    type="submit"
                    disabled={!selectedPlaceId || saving}
                  >
                    套用
                  </button>
                </form>
              )}

              <div className="place-preview-list">
                {displayedPlaces.slice(0, 5).map((place) => {
                  const directlyAssigned =
                    selectedId !== undefined &&
                    place.labelIds.includes(selectedId);
                  const applied = flatLabels.filter((label) =>
                    place.labelIds.includes(label.id),
                  );
                  return (
                    <div className="place-preview" key={place.id}>
                      <div className="place-thumbnail">
                        {place.name.slice(0, 1)}
                      </div>
                      <div className="place-copy">
                        <strong>{place.name}</strong>
                        <span>{place.regionIds.length} 個地區</span>
                      </div>
                      <div className="place-tags">
                        {applied.map((label) => (
                          <span
                            className="place-tag"
                            key={label.id}
                            style={{ color: label.color }}
                          >
                            {label.name}
                          </span>
                        ))}
                      </div>
                      {directlyAssigned && (
                        <button
                          className="remove-place-label"
                          type="button"
                          aria-label={`從${place.name}移除${selectedLabel?.name}`}
                          title="移除這個標籤"
                          disabled={saving}
                          onClick={() => void handleRemoveFromPlace(place)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
                {!displayedPlaces.length && (
                  <div className="empty-state compact-empty">
                    {selectedLabel
                      ? "目前沒有套用此標籤的地點。"
                      : "選取標籤後顯示相關地點。"}
                  </div>
                )}
                {displayedPlaces.length > 5 && (
                  <div className="more-places-note">
                    另有 {displayedPlaces.length - 5} 個地點
                  </div>
                )}
              </div>

              <div className="usage-note">
                <span aria-hidden="true">ⓘ</span>
                父標籤篩選可包含所有層級的子標籤地點。
              </div>
            </section>
          </div>
        </section>

        <section
          id="place-preview-panel"
          className="workspace-grid place-preview-workspace"
          aria-label="地點套用預覽"
          role="tabpanel"
          aria-labelledby="place-preview-tab"
          hidden={activeTab !== "preview"}
        >
          {renderTaxonomyPanel(true)}
          <section className="panel full-preview-panel">
            {selectedLabel ? (
              <>
                <div className="preview-summary">
                  <span
                    className="large-color-dot"
                    style={{ backgroundColor: selectedLabel.color }}
                    aria-hidden="true"
                  />
                  <div className="preview-summary-copy">
                    <h2>{selectedLabel.name}</h2>
                    <p>
                      上層分類：
                      {selectedLabel.parentId
                        ? flatLabels.find((label) => label.id === selectedLabel.parentId)?.name ?? "未知"
                        : "無（根分類）"}
                    </p>
                  </div>
                  <span className="preview-count">
                    {displayedPlaces.length} 個地點
                  </span>
                </div>

                <div className="preview-toolbar">
                  <label className="search-box preview-search">
                    <span aria-hidden="true">⌕</span>
                    <input
                      type="search"
                      placeholder="搜尋已套用的地點"
                      value={previewSearch}
                      onChange={(event) => setPreviewSearch(event.target.value)}
                    />
                    {previewSearch && (
                      <button
                        className="clear-search"
                        type="button"
                        onClick={() => setPreviewSearch("")}
                        aria-label="清除地點搜尋"
                      >
                        ×
                      </button>
                    )}
                  </label>
                  <label className="descendant-toggle">
                    <input
                      type="checkbox"
                      checked={includeDescendants}
                      onChange={(event) => setIncludeDescendants(event.target.checked)}
                    />
                    包含子標籤
                  </label>
                </div>

                <form
                  className="assign-place-form preview-assign-form"
                  onSubmit={(event) => void handleAssign(event)}
                >
                  <SearchableSelect
                    key={selectedLabel.id}
                    label="選擇要套用標籤的地點"
                    placeholder={`搜尋或選擇地點並套用「${selectedLabel.name}」`}
                    value={selectedPlaceId}
                    onChange={setSelectedPlaceId}
                    disabled={saving}
                    options={allPlaces.filter(
                      (place) => !place.labelIds.includes(selectedLabel.id),
                    )}
                  />
                  <button
                    className="assign-button"
                    type="submit"
                    disabled={!selectedPlaceId || saving}
                  >
                    {saving ? "套用中…" : "＋ 套用標籤"}
                  </button>
                </form>

                <div className="preview-list-heading">
                  <strong>已套用此標籤的地點</strong>
                  <span>
                    {filteredPreviewPlaces.length}
                    {previewSearch ? ` / ${displayedPlaces.length}` : ""} 個結果
                  </span>
                </div>
                <div className="full-place-preview-list">
                  {filteredPreviewPlaces.map((place) => {
                    const directlyAssigned = place.labelIds.includes(selectedLabel.id);
                    const appliedLabels = flatLabels.filter((label) =>
                      place.labelIds.includes(label.id),
                    );
                    return (
                      <article className="full-place-preview" key={place.id}>
                        <span className="place-thumbnail" aria-hidden="true">
                          {place.name.slice(0, 1)}
                        </span>
                        <div className="place-copy">
                          <strong>{place.name}</strong>
                          <span>
                            {place.regionIds.length} 個區域
                            {" · "}
                            {place.googlePlaceId ? "Google Maps 地點" : "自訂地圖連結"}
                          </span>
                        </div>
                        <div className="place-tags">
                          {appliedLabels.map((label) => (
                            <span
                              className="place-tag"
                              key={label.id}
                              style={{ color: label.color }}
                            >
                              {label.name}
                            </span>
                          ))}
                        </div>
                        {directlyAssigned && (
                          <button
                            className="remove-place-label"
                            type="button"
                            aria-label={`從${place.name}移除${selectedLabel.name}`}
                            title={`從${place.name}移除此標籤`}
                            disabled={saving}
                            onClick={() => void handleRemoveFromPlace(place)}
                          >
                            ×
                          </button>
                        )}
                      </article>
                    );
                  })}
                  {!filteredPreviewPlaces.length && (
                    <div className="empty-state preview-empty-state">
                      {displayedPlaces.length
                        ? "沒有符合搜尋條件的地點。"
                        : includeDescendants
                          ? "此標籤及其子標籤尚未套用到任何地點。"
                          : "此標籤尚未直接套用到任何地點。"}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="preview-empty">
                {loading ? "正在載入標籤…" : "先建立並選取一個標籤，即可預覽套用的地點。"}
              </div>
            )}
          </section>
        </section>
        <footer className="page-footer">
          標籤與地點資料儲存於此瀏覽器 <span>•</span> 清除網站資料會一併移除
        </footer>
      </div>
      {dialog && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving)
              setDialog(null);
          }}
        >
          <form
            className="label-dialog panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-label-title"
            onSubmit={(event) => void handleCreate(event)}
          >
            <div className="dialog-heading">
              <div>
                <div className="section-kicker">
                  {dialog.parentId ? "建立階層標籤" : "建立分類標籤"}
                </div>
                <h2 id="create-label-title">新增標籤</h2>
              </div>
              <button
                className="subtle-icon-button"
                type="button"
                aria-label="關閉"
                disabled={saving}
                onClick={() => setDialog(null)}
              >
                ×
              </button>
            </div>
            {error && (
              <div className="dialog-error" role="alert">
                {error}
              </div>
            )}
            <label className="form-field">
              <span>標籤名稱</span>
              <input
                autoFocus
                value={dialogName}
                onChange={(event) => setDialogName(event.target.value)}
                maxLength={60}
                placeholder="例如：咖啡廳"
                required
              />
            </label>
            <div className="form-field dialog-color-field">
              <span>標籤顏色</span>
              <div className="color-swatches">
                {labelColors.map((color) => (
                  <button
                    className={`color-swatch${color === dialogColor ? " chosen" : ""}`}
                    key={color}
                    type="button"
                    aria-label={`選擇顏色 ${color}`}
                    aria-pressed={color === dialogColor}
                    style={{ backgroundColor: color }}
                    onClick={() => setDialogColor(color)}
                  />
                ))}
              </div>
            </div>
            {dialog.parentId && (
              <p className="dialog-parent">
                上層分類：
                {flatLabels.find((label) => label.id === dialog.parentId)
                  ?.name ?? "未知"}
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="cancel-button"
                type="button"
                disabled={saving}
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              <button
                className="save-button"
                type="submit"
                disabled={saving || !dialogName.trim()}
              >
                {saving ? "建立中…" : "建立標籤"}
              </button>
            </div>
          </form>
        </div>
      )}
    </WorkspaceLayout>
  );
}

function labelDepth(label: Label, labels: Label[]): number {
  let depth = 0;
  let parentId = label.parentId;
  while (parentId) {
    depth += 1;
    parentId = labels.find((candidate) => candidate.id === parentId)?.parentId;
  }
  return depth;
}

export default LabelModule;
