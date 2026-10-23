import { useEffect, useId, useMemo, useRef, useState } from "react";
import { findDuplicatePlace } from "../../database/location.validation";
import { placeDuplicateMessage } from "../../geo/place-duplicate";
import type { FormEvent } from "react";
import type { Label, NewPlace, Place, PlaceIcon, Region } from "../../database";
import { placeIcons } from "../../database";
import { WorkspaceLayout } from "../../common/WorkspaceLayout";
import { placeController } from "./place.controller";
import type { GooglePlaceDetails } from "./google-places.service";
import "./PlaceModule.css";
import { useBulkDelete } from "../../common/useBulkDelete";
import { BulkDeleteToolbar } from "../../common/BulkDeleteToolbar";
import type { BulkOperationResult } from "../../common/bulk-operation";
import { BulkLabelToolbar } from "./BulkLabelToolbar";
import { useHybridDataRevision } from "../../database/useHybridDataRevision";
import type { StoredLocation } from "../../geo/contracts";
import { useMapProvider } from "../../geo/provider-preference";
import {
  googleMapsNavigationUrl,
  suggestedOsmLocationName,
} from "../../geo/osm-service";
import {
  defaultRegionIds,
  regionsForMapProvider,
} from "../../geo/region-provider";
import { OsmSearchHeading } from "../../geo/OsmSearchHeading";

interface PlaceDraft {
  name: string;
  icon?: PlaceIcon;
  mapsUrl: string;
  googlePlaceId?: string;
  location?: StoredLocation;
  notes: string;
  regionIds: string[];
  labelIds: string[];
}

const emptyDraft: PlaceDraft = {
  name: "",
  mapsUrl: "",
  notes: "",
  regionIds: [],
  labelIds: [],
};

function toDraft(place: Place): PlaceDraft {
  return {
    name: place.name,
    icon: place.icon,
    mapsUrl: place.mapsUrl ?? "",
    googlePlaceId: place.googlePlaceId,
    location: place.location,
    notes: place.notes ?? "",
    regionIds: [...place.regionIds],
    labelIds: [...place.labelIds],
  };
}

function flattenLabels(labels: Label[]): Label[] {
  const byParent = new Map<string | undefined, Label[]>();
  for (const label of labels) {
    const children = byParent.get(label.parentId) ?? [];
    children.push(label);
    byParent.set(label.parentId, children);
  }
  const ordered: Label[] = [];
  const visit = (parentId: string | undefined) => {
    for (const label of byParent.get(parentId) ?? []) {
      ordered.push(label);
      visit(label.id);
    }
  };
  visit(undefined);
  return ordered;
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

function getPlaceInitial(name: string): string {
  return Array.from(name.trim())[0] ?? "地";
}

interface SearchableChoice {
  id: string;
  name: string;
  color?: string;
  depth?: number;
}

function SearchableMultiSelect({
  label,
  options,
  selectedIds,
  onToggle,
  disabled,
  placeholder,
}: {
  label: string;
  options: SearchableChoice[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled: boolean;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery
      ? options.filter((option) =>
          option.name.toLocaleLowerCase().includes(normalizedQuery),
        )
      : options;
  }, [options, query]);
  const selectedOptions = options.filter((option) =>
    selectedIds.includes(option.id),
  );

  function toggleOption(id: string) {
    onToggle(id);
    setOpen(true);
    inputRef.current?.focus();
  }

  return (
    <div className="place-search-multi-select">
      <div className="place-search-input-wrap">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActiveIndex(-1);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) =>
                Math.min(current + 1, filteredOptions.length - 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) =>
                Math.min(Math.max(current - 1, 0), filteredOptions.length - 1),
              );
            } else if (
              event.key === "Enter" &&
              open &&
              filteredOptions[activeIndex]
            ) {
              event.preventDefault();
              toggleOption(filteredOptions[activeIndex].id);
            } else if (event.key === "Escape") {
              setOpen(false);
              setActiveIndex(-1);
            } else if (
              event.key === "Backspace" &&
              !query &&
              selectedOptions.length
            ) {
              onToggle(selectedOptions[selectedOptions.length - 1].id);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
        />
        <span className="place-search-input-icon" aria-hidden="true">
          ⌕
        </span>
      </div>

      {selectedOptions.length > 0 && (
        <div className="place-selected-choices" aria-label={`已選${label}`}>
          {selectedOptions.map((option) => (
            <span className="place-selected-choice" key={option.id}>
              {option.color && (
                <span
                  className="filter-color-dot"
                  style={{ backgroundColor: option.color }}
                  aria-hidden="true"
                />
              )}
              <span className="place-selected-choice-name">{option.name}</span>
              <button
                type="button"
                aria-label={`移除${option.name}`}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onToggle(option.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="place-search-results">
          <div className="place-search-results-heading">
            <span>
              {query.trim()
                ? `符合項目 ${filteredOptions.length}`
                : `全部項目 ${filteredOptions.length}`}
            </span>
            {selectedOptions.length > 0 && (
              <span>已選 {selectedOptions.length}</span>
            )}
          </div>
          <ul
            id={listId}
            className="place-search-options"
            role="listbox"
            aria-label={`${label}選項`}
            aria-multiselectable="true"
          >
            {filteredOptions.length ? (
              filteredOptions.map((option, index) => {
                const selected = selectedIds.includes(option.id);
                return (
                  <li
                    id={`${listId}-option-${index}`}
                    key={option.id}
                    role="option"
                    aria-selected={selected}
                    className={activeIndex === index ? "active" : ""}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => toggleOption(option.id)}
                  >
                    <span
                      className={`place-search-check${selected ? " selected" : ""}`}
                      aria-hidden="true"
                    >
                      {selected ? "✓" : ""}
                    </span>
                    {option.color && (
                      <span
                        className="filter-color-dot"
                        style={{ backgroundColor: option.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className="place-search-option-name"
                      style={{
                        paddingInlineStart: `${(option.depth ?? 0) * 10}px`,
                      }}
                    >
                      {option.name}
                    </span>
                  </li>
                );
              })
            ) : (
              <li className="place-search-no-results" role="presentation">
                沒有符合的項目
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function PlaceModule() {
  const dataRevision = useHybridDataRevision();
  const bulk = useBulkDelete();
  const [bulkMode, setBulkMode] = useState<"delete" | "label">("delete");
  const [bulkLabelId, setBulkLabelId] = useState("");
  const [bulkLabelResult, setBulkLabelResult] = useState<BulkOperationResult>();
  const bulkLabelRunning = useRef(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [filteredPlaces, setFilteredPlaces] = useState<Place[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string>();
  const [draft, setDraft] = useState<PlaceDraft>(emptyDraft);
  const { provider, error: providerError } = useMapProvider();
  const providerRegions = regionsForMapProvider(regions, provider);
  const [googleDetails, setGoogleDetails] = useState<GooglePlaceDetails | null>(
    null,
  );
  const [googleDetailsForId, setGoogleDetailsForId] = useState<string>();
  const [googleDetailsErrorForId, setGoogleDetailsErrorForId] =
    useState<string>();
  const autocompleteContainerRef = useRef<HTMLDivElement>(null);
  const createFromLinkRef = useRef(
    new URLSearchParams(window.location.search).get("create") === "1",
  );
  const [filterText, setFilterText] = useState("");
  const [selectedFilterLabelIds, setSelectedFilterLabelIds] = useState<
    string[]
  >([]);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [singleSaving, setSaving] = useState(false);
  const saving = singleSaving || bulk.busy;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const resultsHeadingRef = useRef<HTMLDivElement>(null);
  const resultsToggleRef = useRef<HTMLButtonElement>(null);

  function collapseResultsFromBottom() {
    setResultsCollapsed(true);
    resultsToggleRef.current?.focus({ preventScroll: true });
    resultsHeadingRef.current?.scrollIntoView({ block: "nearest" });
  }
  const selectedPlaceIdRef = useRef(selectedPlaceId);
  selectedPlaceIdRef.current = selectedPlaceId;
  const reloadBlocked = editing || creating || saving;
  const searchOptionsRef = useRef({
    search: filterText,
    labelIds: selectedFilterLabelIds,
    includeDescendants,
  });
  searchOptionsRef.current = {
    search: filterText,
    labelIds: selectedFilterLabelIds,
    includeDescendants,
  };

  const orderedLabels = useMemo(() => flattenLabels(labels), [labels]);
  const selectedPlace = places.find((place) => place.id === selectedPlaceId);
  const coordinateChanged =
    creating ||
    !selectedPlace?.location ||
    selectedPlace.location.coordinate.latitude !==
      draft.location?.coordinate.latitude ||
    selectedPlace.location.coordinate.longitude !==
      draft.location?.coordinate.longitude;
  const duplicatePlace = coordinateChanged || selectedPlace?.name !== draft.name
    ? findDuplicatePlace(
        places,
        draft,
        creating ? undefined : selectedPlaceId,
      )
    : undefined;
  const locationSaveError =
    provider === "osm" && !draft.location
      ? ""
      : duplicatePlace
        ? placeDuplicateMessage(duplicatePlace.place.name, duplicatePlace.reason)
        : "";
  const selectedGooglePlaceId = selectedPlace?.googlePlaceId;
  const draftGoogleDetails =
    googleDetailsForId === draft.googlePlaceId ? googleDetails : null;
  const visibleGoogleDetails =
    googleDetailsForId === selectedGooglePlaceId ? googleDetails : null;
  const googleDetailsLoading = Boolean(
    selectedGooglePlaceId &&
    googleDetailsForId !== selectedGooglePlaceId &&
    googleDetailsErrorForId !== selectedGooglePlaceId,
  );
  async function reloadPlaces(preferredId = selectedPlaceId) {
    const [workspace, nextFilteredPlaces] = await Promise.all([
      placeController.loadWorkspace(),
      placeController.search({
        search: filterText,
        labelIds: selectedFilterLabelIds,
        includeDescendants,
      }),
    ]);
    setPlaces(workspace.places);
    setLabels(workspace.labels);
    setRegions(workspace.regions);
    setFilteredPlaces(nextFilteredPlaces);

    const nextSelection =
      workspace.places.find((place) => place.id === preferredId) ??
      nextFilteredPlaces[0] ??
      workspace.places[0];
    setSelectedPlaceId(nextSelection?.id);
    if (nextSelection) setDraft(toDraft(nextSelection));
    else setDraft(emptyDraft);
  }

  useEffect(() => {
    if (reloadBlocked) return;
    let active = true;
    Promise.all([
      placeController.loadWorkspace(),
      placeController.search(searchOptionsRef.current),
    ])
      .then(([workspace, results]) => {
        if (!active) return;
        setPlaces(workspace.places);
        setLabels(workspace.labels);
        setRegions(workspace.regions);
        setFilteredPlaces(results);
        if (createFromLinkRef.current) {
          createFromLinkRef.current = false;
          setCreating(true);
          setEditing(true);
          setSelectedPlaceId(undefined);
          setDraft(emptyDraft);
          const url = new URL(window.location.href);
          url.searchParams.delete("create");
          window.history.replaceState(
            null,
            "",
            `${url.pathname}${url.search}${url.hash}`,
          );
        } else {
          const next =
            workspace.places.find(
              (place) => place.id === selectedPlaceIdRef.current,
            ) ?? results[0];
          setSelectedPlaceId(next?.id);
          setDraft(next ? toDraft(next) : emptyDraft);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "載入地點資料失敗。",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dataRevision, reloadBlocked]);

  useEffect(() => {
    if (
      !editing ||
      provider !== "google" ||
      !placeController.isGooglePlacesConfigured()
    )
      return;
    const container = autocompleteContainerRef.current;
    if (!container) return;

    let active = true;
    let dispose: (() => void) | undefined;
    placeController
      .mountPlaceAutocomplete(
        container,
        (details, query) => {
          if (!active) return;
          setGoogleDetails(details);
          setGoogleDetailsForId(details.id);
          setGoogleDetailsErrorForId(undefined);
          setDraft((current) => ({
            ...current,
            name: current.name || query,
            googlePlaceId: details.id,
            mapsUrl: "",
            location: undefined,
          }));
          setError("");
        },
        (cause) => {
          if (active) setError(cause.message);
        },
      )
      .then((unmount) => {
        if (active) {
          dispose = unmount;
          container
            .querySelector<HTMLElement>("gmp-place-autocomplete")
            ?.focus();
        } else unmount();
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Google Places 搜尋無法啟動。",
          );
        }
      });

    return () => {
      active = false;
      dispose?.();
      container.replaceChildren();
    };
  }, [editing, provider]);

  useEffect(() => {
    if (!editing || provider !== "osm" || !autocompleteContainerRef.current)
      return;
    const container = autocompleteContainerRef.current;
    let active = true;
    let dispose: (() => void) | undefined;
    placeController
      .mountOsmAutocomplete(
        container,
        (candidate) => {
          if (!active) return;
          setDraft((current) => ({
            ...current,
            location: candidate.location,
            googlePlaceId: undefined,
            regionIds: defaultRegionIds(regions, provider),
            mapsUrl: candidate.mapsUrl ?? current.mapsUrl,
            name: current.name || suggestedOsmLocationName(candidate),
          }));
          setNotice(candidate.warning ?? "");
          setError("");
          document.getElementById("place-user-name")?.focus();
        },
        (cause) => {
          if (active) setError(cause.message);
        },
        {
          onInput: () => {
            if (active) {
              setError("");
              setNotice("");
              setDraft((current) => ({
                ...current,
                location: undefined,
                googlePlaceId: undefined,
                mapsUrl: "",
              }));
            }
          },
        },
      )
      .then((unmount) => {
        if (active) {
          dispose = unmount;
          container.querySelector("input")?.focus();
        } else unmount();
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "OSM 搜尋無法啟動。",
          );
      });
    return () => {
      active = false;
      dispose?.();
    };
  }, [editing, provider]);

  useEffect(() => {
    if (!selectedGooglePlaceId || provider !== "google") return;

    let active = true;
    placeController
      .getGooglePlaceDetails(selectedGooglePlaceId)
      .then((details) => {
        if (active) {
          setGoogleDetails(details);
          setGoogleDetailsForId(selectedGooglePlaceId);
          setGoogleDetailsErrorForId(undefined);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setGoogleDetailsErrorForId(selectedGooglePlaceId);
          setError(
            cause instanceof Error
              ? cause.message
              : "讀取 Google 地點資料失敗。",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [selectedGooglePlaceId, provider]);

  useEffect(() => {
    let active = true;
    placeController
      .search({
        search: filterText,
        labelIds: selectedFilterLabelIds,
        includeDescendants,
      })
      .then((results) => {
        if (!active) return;
        setFilteredPlaces(results);
        if (
          !creating &&
          !editing &&
          selectedPlaceId &&
          !results.some((place) => place.id === selectedPlaceId)
        ) {
          setSelectedPlaceId(results[0]?.id);
          if (results[0]) setDraft(toDraft(results[0]));
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "搜尋地點失敗。");
        }
      });
    return () => {
      active = false;
    };
  }, [
    filterText,
    selectedFilterLabelIds,
    includeDescendants,
    selectedPlaceId,
    creating,
    editing,
    places,
  ]);

  function selectPlace(place: Place) {
    if (saving) return;
    setSelectedPlaceId(place.id);
    setDraft(toDraft(place));
    setEditing(false);
    setCreating(false);
    setError("");
    setNotice("");
    setGoogleDetails(null);
    setGoogleDetailsForId(undefined);
    setGoogleDetailsErrorForId(undefined);
  }

  function startCreate() {
    if (saving) return;
    bulk.exit();
    setCreating(true);
    setEditing(true);
    setSelectedPlaceId(undefined);
    setDraft({ ...emptyDraft, regionIds: defaultRegionIds(regions, provider) });
    setGoogleDetails(null);
    setGoogleDetailsForId(undefined);
    setGoogleDetailsErrorForId(undefined);
    setFilterText("");
    setSelectedFilterLabelIds([]);
    setError("");
    setNotice("");
  }

  function startEditing() {
    if (saving) return;
    if (!selectedPlace) return;
    bulk.exit();
    setDraft(toDraft(selectedPlace));
    setEditing(true);
    setCreating(false);
    setError("");
    setNotice("");
  }

  function cancelEditing() {
    setEditing(false);
    setCreating(false);
    setError("");
    if (selectedPlace) setDraft(toDraft(selectedPlace));
    else setDraft(emptyDraft);
    setGoogleDetails(null);
    setGoogleDetailsForId(undefined);
    setGoogleDetailsErrorForId(undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider) {
      setError(providerError ?? "請先選擇地圖供應商。");
      return;
    }
    if (locationSaveError) {
      setError(locationSaveError);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const input: NewPlace = {
      name: draft.name.trim(),
      ...(draft.icon ? { icon: draft.icon } : {}),
      ...(draft.mapsUrl.trim() ? { mapsUrl: draft.mapsUrl.trim() } : {}),
      ...(draft.googlePlaceId ? { googlePlaceId: draft.googlePlaceId } : {}),
      ...(draft.location ? { location: draft.location } : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
      regionIds: draft.regionIds,
      labelIds: draft.labelIds,
    };

    try {
      let savedId = selectedPlaceId;
      if (creating) {
        savedId = await placeController.create(input);
      } else if (selectedPlaceId) {
        await placeController.update(selectedPlaceId, input);
      }
      await reloadPlaces(savedId);
      setCreating(false);
      setEditing(false);
      setNotice(creating ? "地點已建立。" : "地點變更已儲存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "儲存地點失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkLabel() {
    if (
      saving ||
      editing ||
      bulkLabelRunning.current ||
      !bulk.selectedIds.size ||
      !labels.some((label) => label.id === bulkLabelId)
    )
      return;
    bulkLabelRunning.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    setBulkLabelResult(undefined);
    try {
      const result = await placeController.assignLabelMany(
        [...bulk.selectedIds],
        bulkLabelId,
      );
      setBulkLabelResult(result);
      bulk.setSelectedIds(
        new Set(result.failures.map((failure) => failure.id)),
      );
      await reloadPlaces();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "套用標籤或重新載入失敗，請重新整理確認結果。",
      );
    } finally {
      bulkLabelRunning.current = false;
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (saving) return;
    if (!selectedPlace) return;
    if (!window.confirm(`確定要刪除「${selectedPlace.name}」嗎？`)) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await placeController.delete(selectedPlace.id);
      await reloadPlaces();
      setNotice(`地點「${selectedPlace.name}」已刪除。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "刪除地點失敗。");
    } finally {
      setSaving(false);
    }
  }

  function toggleInDraft(field: "labelIds" | "regionIds", id: string) {
    setDraft((current) => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((currentId) => currentId !== id)
        : [...current[field], id],
    }));
  }

  function toggleFilterLabel(id: string) {
    setSelectedFilterLabelIds((current) =>
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id],
    );
  }

  const formDisabled = !editing || saving;

  return (
    <WorkspaceLayout
      active="places"
      counts={{ places: places.length }}
      shellClassName="app-shell place-app-shell"
      mainClassName="main-content"
    >
      <div className="page-content place-page-content">
        <section className="page-heading">
          <div className="workspace-page-heading-title">
            <h1>地點</h1>
            <p>
              搜尋並收藏想去的地點，套用標籤與區域，規劃行程時即可快速挑選。
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={startCreate}
          >
            <span aria-hidden="true">＋</span>
            地點
          </button>
        </section>

        {(error || providerError) && (
          <div className="feedback-message error-message" role="alert">
            {error || providerError}
          </div>
        )}
        {notice && (
          <div className="feedback-message success-message" role="status">
            {notice}
          </div>
        )}

        <section className="place-workspace">
          <aside className="panel place-browser-panel">
            <div className="panel-heading">
              <div>
                <h2>已收藏地點</h2>
                <p>共 {places.length} 個地點</p>
              </div>
            </div>
            <label className="search-box place-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="搜尋地點或備註"
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
              />
              {filterText && (
                <button
                  type="button"
                  className="clear-search"
                  aria-label="清除搜尋"
                  onClick={() => setFilterText("")}
                >
                  ×
                </button>
              )}
            </label>

            <div className="place-filter-section">
              <div className="filter-title">
                依標籤篩選 <span>符合任一標籤</span>
              </div>
              {orderedLabels.length ? (
                <div className="label-filter-list">
                  {orderedLabels.map((label) => (
                    <label className="label-filter-option" key={label.id}>
                      <input
                        type="checkbox"
                        checked={selectedFilterLabelIds.includes(label.id)}
                        onChange={() => toggleFilterLabel(label.id)}
                      />
                      <span
                        className="filter-color-dot"
                        style={{ backgroundColor: label.color }}
                      />
                      <span>
                        {"　".repeat(labelDepth(label, labels))}
                        {label.name}
                      </span>
                    </label>
                  ))}
                  <label className="descendant-toggle">
                    <input
                      type="checkbox"
                      checked={includeDescendants}
                      onChange={(event) =>
                        setIncludeDescendants(event.target.checked)
                      }
                    />
                    包含所選標籤的子標籤
                  </label>
                </div>
              ) : (
                <div className="filter-empty">尚無標籤分類。</div>
              )}
            </div>

            <div className="place-list-heading" ref={resultsHeadingRef}>
              <span>搜尋結果</span>
              <div className="place-results-actions">
                <span>{filteredPlaces.length}</span>
                <button
                  ref={resultsToggleRef}
                  type="button"
                  className="place-results-toggle"
                  aria-expanded={!resultsCollapsed}
                  aria-controls="place-search-results"
                  onClick={() => setResultsCollapsed((value) => !value)}
                >
                  {resultsCollapsed ? "展開" : "收起"}
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d={resultsCollapsed ? "m4 6 4 4 4-4" : "m4 10 4-4 4 4"}
                    />
                  </svg>
                </button>
              </div>
            </div>
            <div className="place-list">
              {bulk.active && bulkMode === "label" ? (
                <BulkLabelToolbar
                  count={bulk.selectedIds.size}
                  hiddenCount={
                    [...bulk.selectedIds].filter(
                      (id) => !filteredPlaces.some((place) => place.id === id),
                    ).length
                  }
                  disabled={saving || loading || editing}
                  canSelect={filteredPlaces.length > 0}
                  labels={orderedLabels}
                  labelId={bulkLabelId}
                  onLabelChange={setBulkLabelId}
                  onSelectAll={() =>
                    bulk.setSelectedIds(
                      (current) =>
                        new Set([
                          ...current,
                          ...filteredPlaces.map((place) => place.id),
                        ]),
                    )
                  }
                  onClear={() => bulk.setSelectedIds(new Set())}
                  onApply={() => void handleBulkLabel()}
                  onExit={bulk.exit}
                  result={bulkLabelResult}
                />
              ) : (
                <BulkDeleteToolbar
                  active={bulk.active}
                  onEnter={() => {
                    setBulkMode("delete");
                    bulk.enter();
                  }}
                  onExit={bulk.exit}
                  count={bulk.selectedIds.size}
                  hiddenCount={
                    [...bulk.selectedIds].filter(
                      (id) => !filteredPlaces.some((place) => place.id === id),
                    ).length
                  }
                  disabled={saving || loading || editing}
                  canSelect={filteredPlaces.length > 0}
                  onSelectAll={() =>
                    bulk.setSelectedIds(
                      (current) =>
                        new Set([
                          ...current,
                          ...filteredPlaces.map((place) => place.id),
                        ]),
                    )
                  }
                  onClear={() => bulk.setSelectedIds(new Set())}
                  onDelete={() => {
                    void bulk
                      .remove({
                        records: places,
                        entity: "地點",
                        deleteMany: (ids) => placeController.deleteMany(ids),
                        reload: () => reloadPlaces(),
                      })
                      .catch((cause: unknown) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "刪除或重新載入失敗，請重新整理確認結果。",
                        ),
                      );
                  }}
                  result={bulk.result}
                  entryActions={
                    <button
                      type="button"
                      disabled={
                        saving ||
                        loading ||
                        editing ||
                        !filteredPlaces.length ||
                        !labels.length
                      }
                      onClick={() => {
                        setBulkMode("label");
                        setBulkLabelId("");
                        setBulkLabelResult(undefined);
                        setError("");
                        setNotice("");
                        bulk.enter();
                      }}
                    >
                      批次更新
                    </button>
                  }
                />
              )}
              <div id="place-search-results" hidden={resultsCollapsed}>
                {loading ? (
                  <div className="empty-state">正在載入地點…</div>
                ) : filteredPlaces.length ? (
                  filteredPlaces.map((place) => {
                    const placeLabels = labels.filter((label) =>
                      place.labelIds.includes(label.id),
                    );
                    return (
                      <div
                        className={bulk.active ? "place-bulk-row" : undefined}
                        key={place.id}
                      >
                        {bulk.active && (
                          <input
                            className="bulk-select-checkbox"
                            type="checkbox"
                            aria-label={`選取地點「${place.name}」`}
                            checked={bulk.selectedIds.has(place.id)}
                            disabled={saving || editing}
                            onChange={() => bulk.toggle(place.id)}
                          />
                        )}
                        <button
                          className={`place-list-item${place.id === selectedPlaceId && !creating ? " active" : ""}`}
                          type="button"
                          key={place.id}
                          onClick={() => selectPlace(place)}
                          disabled={saving}
                        >
                          <span className="place-list-avatar">
                            {getPlaceInitial(place.name)}
                          </span>
                          <span className="place-list-copy">
                            <strong>
                              {place.icon && (
                                <span
                                  className="place-name-icon"
                                  aria-hidden="true"
                                >
                                  {place.icon}
                                </span>
                              )}
                              {place.name}
                            </strong>
                            <span>
                              {provider === "osm"
                                ? place.location
                                  ? "地圖座標"
                                  : "尚無地圖座標"
                                : place.googlePlaceId
                                  ? "Google Maps 地點"
                                  : "自訂地圖連結"}
                            </span>
                            <span className="place-list-tags">
                              {placeLabels.slice(0, 3).map((label) => (
                                <i
                                  key={label.id}
                                  style={{ backgroundColor: label.color }}
                                  title={label.name}
                                />
                              ))}
                              {placeLabels.length
                                ? `${placeLabels.length} 個標籤`
                                : "尚無標籤"}
                            </span>
                          </span>
                          <span className="list-chevron">›</span>
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    {places.length
                      ? "沒有符合條件的地點。"
                      : "還沒有收藏地點，先新增一個吧。"}
                  </div>
                )}
                {!loading && filteredPlaces.length > 0 && (
                  <div className="place-results-footer">
                    <button
                      type="button"
                      className="place-results-toggle"
                      aria-expanded={!resultsCollapsed}
                      aria-controls="place-search-results"
                      onClick={collapseResultsFromBottom}
                    >
                      收起
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="m4 10 4-4 4 4" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </aside>

          <section className="panel place-detail-panel">
            {editing ? (
              <form
                className="place-form"
                onSubmit={(event) => void handleSubmit(event)}
              >
                <div className="place-detail-heading">
                  <div>
                    <div className="section-kicker">
                      {creating ? "新增收藏地點" : "編輯地點資料"}
                    </div>
                    <h2>
                      {!creating && draft.icon && (
                        <span className="place-name-icon" aria-hidden="true">
                          {draft.icon}
                        </span>
                      )}
                      {creating ? "建立地點" : draft.name || "編輯地點"}
                    </h2>
                  </div>
                  <div className="place-form-heading-actions">
                    <button
                      className="cancel-button"
                      type="button"
                      disabled={saving}
                      onClick={cancelEditing}
                    >
                      取消
                    </button>
                    <button
                      className="save-button"
                      type="submit"
                      disabled={
                        saving ||
                        !provider ||
                        !draft.name.trim() ||
                        Boolean(locationSaveError)
                      }
                    >
                      {saving ? "儲存中…" : creating ? "建立地點" : "儲存變更"}
                    </button>
                  </div>
                </div>

                <div className="place-form-grid">
                  <div className="google-place-search place-name-field">
                    <span className="search-field-label">
                      {provider === "osm" ? (
                        <OsmSearchHeading />
                      ) : (
                        "Google Maps 搜尋"
                      )}
                    </span>
                    {provider === "osm" ||
                    (provider === "google" &&
                      placeController.isGooglePlacesConfigured()) ? (
                      <>
                        <div
                          className="google-autocomplete"
                          ref={autocompleteContainerRef}
                        />
                        <small>
                          {provider === "osm"
                            ? ""
                            : "選擇結果可連結或更換 Google 地點；資料庫只保存 place_id，地點名稱請填寫你自己的名稱。"}
                        </small>
                      </>
                    ) : (
                      <div className="google-key-help">
                        <strong>尚未設定 Google Places</strong>
                        <span>
                          在專案根目錄建立 .env.local，加入
                          VITE_GOOGLE_MAPS_API_KEY=你的新金鑰，並重啟開發伺服器。
                        </span>
                        <span>
                          Google Cloud 需啟用 Places API (New) 與 Maps
                          JavaScript API。
                        </span>
                      </div>
                    )}
                    {locationSaveError && (
                      <p className="form-inline-error" role="alert">
                        {locationSaveError}
                      </p>
                    )}
                    {provider === "osm" && draft.location && (
                      <div className="google-selection">
                        <span>
                          ✓ 地圖座標：{draft.location.coordinate.latitude},{" "}
                          {draft.location.coordinate.longitude}
                        </span>
                        {draft.location.kind === "approximate-center" && (
                          <small>代表中心，請確認入口。</small>
                        )}
                        {notice && <small role="status">{notice}</small>}
                      </div>
                    )}
                    {provider === "google" && draft.googlePlaceId && (
                      <>
                        <div className="google-selection">
                          {draftGoogleDetails?.displayName && (
                            <strong>{draftGoogleDetails.displayName}</strong>
                          )}
                          {draftGoogleDetails?.formattedAddress ? (
                            <span>{draftGoogleDetails.formattedAddress}</span>
                          ) : (
                            <span>目前已連結 Google Maps 地點。</span>
                          )}
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              setDraft((current) => ({
                                ...current,
                                googlePlaceId: undefined,
                              }));
                            }}
                          >
                            解除 Google 地點連結
                          </button>
                        </div>
                        <div className="google-attribution">
                          Powered by Google Maps
                        </div>
                      </>
                    )}
                  </div>
                  <label className="form-field place-name-field">
                    <span>
                      地點名稱（自行命名） <b>*</b>
                    </span>
                    <input
                      id="place-user-name"
                      autoFocus={
                        provider === "google" &&
                        !placeController.isGooglePlacesConfigured()
                      }
                      value={draft.name}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value })
                      }
                      maxLength={100}
                      placeholder="例如：首里城"
                      required
                      disabled={formDisabled}
                    />
                  </label>

                  {provider === "osm" || !draft.googlePlaceId ? (
                    <label className="form-field place-url-field">
                      <span>
                        地圖網址{" "}
                        {provider !== "osm" && !draft.googlePlaceId && <b>*</b>}
                      </span>
                      <input
                        type="url"
                        value={draft.mapsUrl}
                        onChange={(event) =>
                          setDraft({ ...draft, mapsUrl: event.target.value })
                        }
                        placeholder="https://maps.google.com/..."
                        required={provider !== "osm" && !draft.googlePlaceId}
                        disabled={formDisabled}
                      />
                      <small>
                        {provider === "osm"
                          ? "選填：Google 地圖連結或其他導航網址；不會取代已選地圖座標。"
                          : "若未選 Google 搜尋結果，請貼上 Google Maps 分享連結或其他地圖網址。"}
                      </small>
                    </label>
                  ) : (
                    <p className="place-url-note">
                      已連結 Google 地點，地圖連結會即時取得，無需另外填寫網址。
                    </p>
                  )}

                  {provider !== "osm" && (
                    <fieldset className="place-choice-field">
                      <legend>所屬區域</legend>
                      {providerRegions.length ? (
                        <SearchableMultiSelect
                          label="所屬區域"
                          options={providerRegions.map((region) => ({
                            id: region.id,
                            name: region.name,
                          }))}
                          selectedIds={draft.regionIds}
                          onToggle={(id) => toggleInDraft("regionIds", id)}
                          disabled={formDisabled}
                          placeholder="搜尋或選擇區域"
                        />
                      ) : (
                        <small>目前沒有區域，可先不指定。</small>
                      )}
                    </fieldset>
                  )}

                  <fieldset className="place-choice-field">
                    <legend>標籤</legend>
                    {orderedLabels.length ? (
                      <SearchableMultiSelect
                        label="標籤"
                        options={orderedLabels.map((label) => ({
                          id: label.id,
                          name: label.name,
                          color: label.color,
                          depth: labelDepth(label, labels),
                        }))}
                        selectedIds={draft.labelIds}
                        onToggle={(id) => toggleInDraft("labelIds", id)}
                        disabled={formDisabled}
                        placeholder="搜尋或選擇標籤"
                      />
                    ) : (
                      <small>尚無標籤，請先到標籤模組建立分類。</small>
                    )}
                  </fieldset>

                  <fieldset className="place-icon-field">
                    <legend>地點圖示（選填）</legend>
                    <div className="place-icon-options">
                      <button
                        type="button"
                        className={`place-icon-option place-icon-none${draft.icon ? "" : " selected"}`}
                        aria-pressed={!draft.icon}
                        onClick={() => setDraft({ ...draft, icon: undefined })}
                        disabled={formDisabled}
                      >
                        無
                      </button>
                      {placeIcons.map((icon) => (
                        <button
                          type="button"
                          className={`place-icon-option${draft.icon === icon ? " selected" : ""}`}
                          key={icon}
                          aria-label={`選擇圖示 ${icon}`}
                          aria-pressed={draft.icon === icon}
                          onClick={() => setDraft({ ...draft, icon })}
                          disabled={formDisabled}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <label className="form-field place-notes-field">
                    <span>備註</span>
                    <textarea
                      rows={4}
                      value={draft.notes}
                      onChange={(event) =>
                        setDraft({ ...draft, notes: event.target.value })
                      }
                      placeholder="營業時間、預約方式或想記下的資訊…"
                      disabled={formDisabled}
                    />
                  </label>
                </div>

                {error && (
                  <div className="form-inline-error" role="alert">
                    {error}
                  </div>
                )}
                <div className="place-form-actions">
                  <button
                    className="cancel-button"
                    type="button"
                    disabled={saving}
                    onClick={cancelEditing}
                  >
                    取消
                  </button>
                  <button
                    className="save-button"
                    type="submit"
                    disabled={
                      saving ||
                      !provider ||
                      !draft.name.trim() ||
                      Boolean(locationSaveError)
                    }
                  >
                    {saving ? "儲存中…" : creating ? "建立地點" : "儲存變更"}
                  </button>
                </div>
              </form>
            ) : selectedPlace ? (
              <div className="place-readonly">
                <div className="place-detail-heading">
                  <div>
                    <div className="section-kicker">地點詳細資料</div>
                    <h2>
                      {selectedPlace.icon && (
                        <span className="place-name-icon" aria-hidden="true">
                          {selectedPlace.icon}
                        </span>
                      )}
                      {selectedPlace.name}
                    </h2>
                  </div>
                  <div className="place-detail-actions">
                    <button
                      className="primary-button small-action-button"
                      type="button"
                      disabled={saving}
                      onClick={startEditing}
                    >
                      編輯資料
                    </button>
                    <button
                      className="delete-place-button"
                      type="button"
                      disabled={saving}
                      onClick={() => void handleDelete()}
                    >
                      刪除地點
                    </button>
                  </div>
                </div>

                {provider === "osm" && (
                  <section className="place-map-card">
                    {selectedPlace.location ? (
                      <>
                        <span>地圖座標</span>
                        <p>
                          {selectedPlace.location.coordinate.latitude},{" "}
                          {selectedPlace.location.coordinate.longitude}
                        </p>
                        <a
                          className="maps-link"
                          href={
                            selectedPlace.mapsUrl ||
                            googleMapsNavigationUrl(
                              selectedPlace.location.coordinate,
                            )
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          導航 ↗
                        </a>
                      </>
                    ) : (
                      <p>
                        此地點尚無地圖座標。編輯並選取 OSM
                        搜尋結果或自行確認的座標；原 Google 連結不會被刪除。
                      </p>
                    )}
                  </section>
                )}
                {provider === "google" && selectedPlace.googlePlaceId && (
                  <section className="google-place-summary">
                    <div className="google-live-heading">
                      Google Maps 地點 <span>Powered by Google Maps</span>
                    </div>
                    {googleDetailsLoading ? (
                      <p>正在向 Google 讀取最新地點資訊…</p>
                    ) : visibleGoogleDetails ? (
                      <>
                        {visibleGoogleDetails.displayName && (
                          <strong>{visibleGoogleDetails.displayName}</strong>
                        )}
                        {visibleGoogleDetails.formattedAddress && (
                          <p>{visibleGoogleDetails.formattedAddress}</p>
                        )}
                      </>
                    ) : (
                      <p>
                        暫時無法載入即時資料；place_id 仍已保存，請確認網路與
                        API 設定。
                      </p>
                    )}
                    <a
                      className="maps-link"
                      href={
                        visibleGoogleDetails?.googleMapsUri ??
                        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedPlace.name)}&query_place_id=${encodeURIComponent(selectedPlace.googlePlaceId)}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      導航 ↗
                    </a>
                  </section>
                )}

                {provider === "google" && !selectedPlace.googlePlaceId && (
                  <div className="place-map-card">
                    <span>自訂地圖位置</span>
                    {selectedPlace.mapsUrl && (
                      <a
                        className="maps-link"
                        href={selectedPlace.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        導航 ↗
                      </a>
                    )}
                  </div>
                )}

                <div className="place-info-grid">
                  <section className="place-info-section">
                    <h3>標籤</h3>
                    {selectedPlace.labelIds.length ? (
                      <div className="place-info-tags">
                        {labels
                          .filter((label) =>
                            selectedPlace.labelIds.includes(label.id),
                          )
                          .map((label) => (
                            <span className="place-info-tag" key={label.id}>
                              <i style={{ backgroundColor: label.color }} />
                              {label.name}
                            </span>
                          ))}
                      </div>
                    ) : (
                      <p className="muted-value">尚未套用標籤</p>
                    )}
                  </section>
                  {provider !== "osm" && (
                    <section className="place-info-section">
                      <h3>所屬區域</h3>
                      {selectedPlace.regionIds.length ? (
                        <div className="place-info-tags">
                          {regionsForMapProvider(regions, provider)
                            .filter((region) =>
                              selectedPlace.regionIds.includes(region.id),
                            )
                            .map((region) => (
                              <span className="region-info-tag" key={region.id}>
                                {region.name}
                              </span>
                            ))}
                        </div>
                      ) : (
                        <p className="muted-value">尚未指定區域</p>
                      )}
                    </section>
                  )}
                  <section className="place-info-section notes-info-section">
                    <h3>備註</h3>
                    <p
                      className={
                        selectedPlace.notes ? "place-notes-text" : "muted-value"
                      }
                    >
                      {selectedPlace.notes || "沒有備註"}
                    </p>
                  </section>
                </div>
              </div>
            ) : (
              <div className="place-empty-detail">
                <div className="empty-detail-icon">⌖</div>
                <h2>
                  {places.length ? "選擇一個地點" : "開始建立你的地點資料庫"}
                </h2>
                <p>
                  {places.length
                    ? "從左側選擇地點以查看詳細資料。"
                    : "儲存想去的地點，之後就能快速加入旅行行程。"}
                </p>
                {!places.length && (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={startCreate}
                  >
                    ＋地點
                  </button>
                )}
              </div>
            )}
          </section>
        </section>

        <footer className="page-footer">
          地點資料儲存於此瀏覽器 <span>•</span> 後續行程模組可直接選用
        </footer>
      </div>
    </WorkspaceLayout>
  );
}

export default PlaceModule;
