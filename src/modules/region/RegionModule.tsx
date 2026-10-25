import { useDatasetSyncError } from '../../geo/account-dataset-preference'
import { getOsmDataset, setOsmDataset, useOsmDataset } from '../../geo/osm-dataset-preference'
import { regionOsmDataset, osmDatasets } from '../../geo/osm-datasets'
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { NewRegion, Place, Region, Trip } from "../../database";
import { WorkspaceLayout } from "../../common/WorkspaceLayout";
import { itineraryController } from "../itinerary/itinerary.controller";
import { placeController } from "../place/place.controller";
import { regionController } from "./region.controller";
import type { GooglePlaceDetails } from "../place/google-places.service";
import "./RegionModule.css";
import { useHybridDataRevision } from "../../database/useHybridDataRevision";
import { useMapProvider } from "../../geo/provider-preference";
import { regionsForMapProvider } from "../../geo/region-provider";

interface RegionDraft {
  name: string;
  center?: Region["center"];
  googlePlaceId?: string;
  centerMetadata?: Region["centerMetadata"];
  zoom: number;
}

const emptyDraft: RegionDraft = {
  name: "",
  zoom: 10,
};

function toDraft(region: Region): RegionDraft {
  return {
    name: region.name,
    center: region.center,
    googlePlaceId: region.googlePlaceId,
    centerMetadata: region.centerMetadata,
    zoom: region.zoom,
  };
}

function RegionModule() {
  const { provider, error: providerError } = useMapProvider();
  const readonly = provider === 'osm';
  const dataset = useOsmDataset();
  const datasetSyncError = useDatasetSyncError();
  const dataRevision = useHybridDataRevision();
  const [regions, setRegions] = useState<Region[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [usage, setUsage] = useState({
    places: new Map<string, number>(),
    trips: new Map<string, number>(),
  });
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<RegionDraft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tripTargets, setTripTargets] = useState<Record<string, string>>({});
  const [googleDetails, setGoogleDetails] = useState<GooglePlaceDetails>();
  const autocompleteContainerRef = useRef<HTMLDivElement>(null);

  const providerRegions = regionsForMapProvider(regions, provider, null);
  const selectedRegion = providerRegions.find((region) => readonly
    ? regionOsmDataset(region) === dataset
    : region.id === selectedId);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const reloadBlocked = creating || editing || saving || deleteDialogOpen;
  const linkedPlaces =
    selectedRegion && places.filter((place) => place.regionIds.includes(selectedRegion.id));
  const linkedTrips =
    selectedRegion && trips.filter((trip) => trip.regionId === selectedRegion.id);
  const selectedGooglePlaceId = selectedRegion?.googlePlaceId;

  async function refresh(preferredId = selectedId) {
    const workspace = await regionController.loadWorkspace();
    const filteredRegions = regionsForMapProvider(workspace.regions, provider, null);
    const nextRegion =
      provider === 'osm'
        ? filteredRegions.find(region => regionOsmDataset(region) === getOsmDataset())
        : filteredRegions.find(region => region.id === preferredId) ?? filteredRegions[0];
    setRegions(workspace.regions);
    setPlaces(workspace.places);
    setTrips(workspace.trips);
    setUsage({
      places: new Map(
        workspace.regions.map((region) => [
          region.id,
          workspace.places.filter((place) =>
            place.regionIds.includes(region.id),
          ).length,
        ]),
      ),
      trips: new Map(
        workspace.regions.map((region) => [
          region.id,
          workspace.trips.filter((trip) => trip.regionId === region.id).length,
        ]),
      ),
    });
    setSelectedId(nextRegion?.id);
    setDraft(nextRegion ? toDraft(nextRegion) : emptyDraft);
  }

  useEffect(() => {
    if (reloadBlocked) return;
    let active = true;
    regionController
      .loadWorkspace()
      .then((workspace) => {
        if (!active) return;
        setRegions(workspace.regions);
        setPlaces(workspace.places);
        setTrips(workspace.trips);
        setUsage({
          places: new Map(
            workspace.regions.map((region) => [
              region.id,
              workspace.places.filter((place) =>
                place.regionIds.includes(region.id),
              ).length,
            ]),
          ),
          trips: new Map(
            workspace.regions.map((region) => [
              region.id,
              workspace.trips.filter((trip) => trip.regionId === region.id)
                .length,
            ]),
          ),
        });
        const filteredRegions = regionsForMapProvider(workspace.regions, provider, null);
        const firstRegion =
          provider === 'osm'
            ? filteredRegions.find(region => regionOsmDataset(region) === getOsmDataset())
            : filteredRegions.find(region => region.id === selectedIdRef.current) ?? filteredRegions[0];
        setSelectedId(firstRegion?.id);
        setDraft(firstRegion ? toDraft(firstRegion) : emptyDraft);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "載入地圖資料失敗。",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dataRevision, reloadBlocked, provider]);

  useEffect(() => {
    if (!editing || provider !== 'google' || !regionController.isGooglePlacesConfigured()) return;
    const container = autocompleteContainerRef.current;
    if (!container) return;

    let active = true;
    let dispose: (() => void) | undefined;
    regionController
      .mountPlaceAutocomplete(
        container,
        (details, query) => {
          if (!active) return;
          setGoogleDetails(details);
          setDraft((current) => ({
            ...current,
            name: current.name || query,
            center: undefined,
            centerMetadata: undefined,
            googlePlaceId: details.id,
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
              : "Google 地點搜尋無法啟動。",
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
    if (!selectedGooglePlaceId || provider !== 'google') return;
    let active = true;
    regionController
      .getGooglePlaceDetails(selectedGooglePlaceId)
      .then((details) => {
        if (active) {
          setGoogleDetails(details);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "讀取 Google 地圖資料失敗。",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [selectedGooglePlaceId, provider]);

  function startCreate() {
    if (readonly) return;
    setSelectedId(undefined);
    setDraft(emptyDraft);
    setGoogleDetails(undefined);
    setCreating(true);
    setEditing(true);
    setError("");
    setNotice("");
  }

  function selectRegion(region: Region) {
    if (provider === 'osm') setOsmDataset(regionOsmDataset(region));
    setSelectedId(region.id);
    setDraft(toDraft(region));
    setCreating(false);
    setEditing(false);
    setGoogleDetails(undefined);
    setError("");
    setNotice("");
  }

  function cancelEdit() {
    setCreating(false);
    setEditing(false);
    setError("");
    setDraft(selectedRegion ? toDraft(selectedRegion) : emptyDraft);
    setGoogleDetails(undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readonly) return;
    if (!provider) { setError(providerError ?? '請先選擇地圖供應商。'); return; }
    setSaving(true);
    setError("");
    setNotice("");
    const input: NewRegion = {
      name: draft.name.trim(),
      ...(draft.googlePlaceId ? { googlePlaceId: draft.googlePlaceId } : {}),
      ...(draft.center ? { center: draft.center } : {}),
      ...(draft.centerMetadata ? { centerMetadata: draft.centerMetadata } : {}),
      zoom: draft.zoom,
    };
    try {
      const id = creating
        ? await regionController.create(input)
        : selectedId
          ? (await regionController.update(selectedId, input), selectedId)
          : undefined;
      await refresh(id);
      setCreating(false);
      setEditing(false);
      setNotice(creating ? "地圖已建立。" : "地圖變更已儲存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "儲存地圖失敗。");
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(region: Region) {
    if (readonly) return;
    setSelectedId(region.id);
    setDeleteDialogOpen(true);
    setTripTargets({});
    setError("");
    setNotice("");
  }

  async function handleRemovePlaceRegion(place: Place) {
    if (readonly || !selectedRegion) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await placeController.update(place.id, {
        regionIds: place.regionIds.filter((id) => id !== selectedRegion.id),
      });
      await refresh(selectedRegion.id);
      setNotice(`已從「${place.name}」移除此地圖。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "解除地點地圖關聯失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function handleReassignTrip(trip: Trip) {
    const regionId = tripTargets[trip.id];
    if (readonly || !regionId || !selectedRegion) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await itineraryController.updateTrip(trip.id, { regionId });
      await refresh(selectedRegion.id);
      setTripTargets((current) => {
        const next = { ...current };
        delete next[trip.id];
        return next;
      });
      setNotice(`已將行程「${trip.name}」改派至「${regions.find((region) => region.id === regionId)?.name ?? "其他地圖"}」。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重新指派行程地圖失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteRegion() {
    if (readonly || !selectedRegion || linkedPlaces?.length || linkedTrips?.length) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await regionController.delete(selectedRegion.id);
      setDeleteDialogOpen(false);
      setEditing(false);
      setCreating(false);
      await refresh();
      setSelectedId(undefined);
      setDraft(emptyDraft);
      setGoogleDetails(undefined);
      setNotice(`地圖「${selectedRegion.name}」已刪除。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "刪除地圖失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <WorkspaceLayout
      active="regions"
      shellClassName="region-app-shell"
      mainClassName="region-main"
    >
      <div className="region-content">
        <section className="region-heading">
          <div className="workspace-page-heading-title">
            <h1>地圖</h1>
            <p>{readonly ? '新增地點與行程會使用此地圖，規劃的行程地點需在此地圖範圍內。' : '建立行程使用的地圖，也可將收藏地點歸入相同地圖。'}</p>
          </div>
          {!readonly && <button
            type="button"
            className="region-primary"
            onClick={startCreate}
          >
            ＋ 新增地圖
          </button>}
        </section>
        {(error || providerError) && !deleteDialogOpen && (
          <div className="region-feedback region-error" role="alert">
            {error || providerError}
          </div>
        )}
        {provider === 'osm' && datasetSyncError && <p className="region-feedback region-error" role="status">{datasetSyncError}</p>}
        {notice && !deleteDialogOpen && (
          <div className="region-feedback region-success" role="status">
            {notice}
          </div>
        )}
        <section className="region-workspace">
          <aside className="region-list-card">
            <div className="region-card-heading">
              <strong>旅行範圍</strong>
              <span>{providerRegions.length}</span>
            </div>
            {loading ? (
              <p className="region-empty">正在載入…</p>
            ) : providerRegions.length ? (
              providerRegions.map((region) => (
                <button
                  type="button"
                  key={region.id}
                  className={`region-list-item${selectedRegion?.id === region.id && !creating ? " selected" : ""}`}
                  aria-pressed={selectedRegion?.id === region.id && !creating}
                  onClick={() => selectRegion(region)}
                >
                  <span className="region-list-icon">◎</span>
                  <span>
                    <strong>{region.name}</strong>
                    <small>
                      {usage.trips.get(region.id) ?? 0} 個行程 ·{" "}
                      {usage.places.get(region.id) ?? 0} 個地點
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="region-empty">{readonly ? '預設地圖尚未載入，請重新整理頁面。' : '目前還沒有 Google 地圖。'}</p>
            )}
          </aside>

          <section className="region-detail-card">
            {editing && !readonly ? (
              <form
                className="region-form"
                onSubmit={(event) => void handleSubmit(event)}
              >
                <div className="region-detail-heading">
                  <div>
                    <span>{creating ? "建立目的地地圖" : "編輯地圖"}</span>
                    <h2>{creating ? "新增地圖" : draft.name}</h2>
                  </div>
                </div>
                <div className="region-google-search">
                  <div className="region-search-label">
                    搜尋 Google Maps 地點以設定地圖中心 <b>*</b>
                  </div>
                  {provider === 'google' && regionController.isGooglePlacesConfigured() ? (
                    <div
                      className="region-autocomplete"
                      ref={autocompleteContainerRef}
                    />
                  ) : (
                    <div className="region-google-help">
                      <strong>尚未設定 Google Places</strong>
                      <span>
                        請在專案根目錄的 .env.local 設定
                        VITE_GOOGLE_MAPS_API_KEY，並重啟開發伺服器。
                      </span>
                      <span>
                        Google Cloud 需啟用 Places API (New) 與 Maps JavaScript
                        API。
                      </span>
                    </div>
                  )}
                  {provider === 'google' && draft.googlePlaceId && (
                    <div className="region-selected-place">
                      <span>✓ 已選擇 Google Maps 地點</span>
                      {googleDetails?.id === draft.googlePlaceId &&
                        googleDetails.formattedAddress && (
                          <small>{googleDetails.formattedAddress}</small>
                        )}
                    </div>
                  )}
                </div>
                <label className="region-field region-field-wide">
                  <span>
                    地圖名稱 <b>*</b>
                  </span>
                  <input
                    id="region-user-name"
                    autoFocus={provider === 'google' && !regionController.isGooglePlacesConfigured()}
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    maxLength={100}
                    placeholder="例如：京都、大阪"
                    required
                    disabled={saving}
                  />
                </label>
                <div className="region-actions">
                  <div>
                    <button
                      type="button"
                      className="region-secondary"
                      disabled={saving}
                      onClick={cancelEdit}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="region-primary"
                      disabled={
                        saving ||
                        !draft.name.trim() ||
                        !provider || (!draft.googlePlaceId && !draft.center)
                      }
                    >
                      {saving ? "儲存中…" : creating ? "建立地圖" : "儲存變更"}
                    </button>
                  </div>
                </div>
              </form>
            ) : selectedRegion ? (
              <div className="region-detail">
                <div className="region-detail-heading">
                  <div>
                    <span>{readonly ? `目前地圖 · ${osmDatasets[regionOsmDataset(selectedRegion)].name}` : '地圖詳細資料'}</span>
                    <h2>{selectedRegion.name}</h2>
                  </div>
                  {!readonly && <div className="region-detail-actions">
                    <button
                      type="button"
                      className="region-secondary"
                      disabled={saving}
                      onClick={() => setEditing(true)}
                    >
                      編輯資料
                    </button>
                    <button
                      type="button"
                      className="region-delete"
                      disabled={saving}
                      onClick={() => handleDelete(selectedRegion)}
                    >
                      刪除地圖
                    </button>
                  </div>}
                </div>
                <dl className="region-details-grid">
                  <div className="region-stat">
                    <svg className="region-stat-icon region-stat-trips" viewBox="0 0 40 40" fill="none" aria-hidden="true">
                      <rect x="6" y="11" width="28" height="24" rx="7" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="2" />
                      <path d="M14 11V8a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3M13 18v10m14-10v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="m17 22 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <dt>所屬行程</dt>
                    <dd>{usage.trips.get(selectedRegion.id) ?? 0} 個</dd>
                  </div>
                  <div className="region-stat">
                    <svg className="region-stat-icon region-stat-places" viewBox="0 0 40 40" fill="none" aria-hidden="true">
                      <path d="M33 17c0 10-13 19-13 19S7 27 7 17a13 13 0 1 1 26 0Z" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <path d="M20 23s-7-4-7-8a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4-7 8-7 8Z" fill="currentColor" />
                    </svg>
                    <dt>收藏地點</dt>
                    <dd>{usage.places.get(selectedRegion.id) ?? 0} 個</dd>
                  </div>
                </dl>
              </div>
            ) : loading ? (
              <div className="region-empty-detail" role="status" aria-live="polite">
                <span aria-hidden="true">◎</span>
                <p>正在載入地圖…</p>
              </div>
            ) : (
              <div className="region-empty-detail">
                <span>◎</span>
                <h2>{readonly ? '預設地圖尚未載入' : '先建立旅行地圖'}</h2>
                <p>{readonly ? '請重新整理頁面以載入預設地圖。' : '地圖可以代表城市、地區或一次旅行的目的地範圍。'}</p>
                {!readonly && <button
                  type="button"
                  className="region-primary"
                  onClick={startCreate}
                >
                  ＋ 新增地圖
                </button>}
              </div>
            )}
          </section>
        </section>
      </div>
      {!readonly && deleteDialogOpen && selectedRegion && (
        <div
          className="region-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving)
              setDeleteDialogOpen(false);
          }}
        >
          <section
            className="region-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="region-delete-title"
          >
            <header className="region-delete-dialog-heading">
              <div>
                <span>刪除地圖前，先處理關聯資料</span>
                <h2 id="region-delete-title">{selectedRegion.name}</h2>
              </div>
              <button
                className="region-dialog-close"
                type="button"
                aria-label="關閉"
                disabled={saving}
                onClick={() => setDeleteDialogOpen(false)}
              >
                ×
              </button>
            </header>
            <p className="region-delete-intro">
              移除地點關聯不會刪除地點或標籤。行程必須保留地圖，請改派至其他地圖。
            </p>
            {error && (
              <div className="region-feedback region-error" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="region-feedback region-success" role="status">
                {notice}
              </div>
            )}
            <section className="region-linked-section" aria-labelledby="linked-places-title">
              <div className="region-linked-heading">
                <h3 id="linked-places-title">收藏地點</h3>
                <span>{linkedPlaces?.length ?? 0}</span>
              </div>
              {linkedPlaces?.length ? (
                <ul className="region-linked-list">
                  {linkedPlaces.map((place) => (
                    <li key={place.id}>
                      <div>
                        <strong>{place.name}</strong>
                        <small>地點與其標籤資料都會保留</small>
                      </div>
                      <button
                        type="button"
                        className="region-secondary"
                        disabled={saving}
                        onClick={() => void handleRemovePlaceRegion(place)}
                      >
                        {saving ? "處理中…" : "從此地圖移除"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="region-linked-empty">沒有地點使用此地圖。</p>
              )}
            </section>
            <section className="region-linked-section" aria-labelledby="linked-trips-title">
              <div className="region-linked-heading">
                <h3 id="linked-trips-title">行程</h3>
                <span>{linkedTrips?.length ?? 0}</span>
              </div>
              {linkedTrips?.length ? (
                <ul className="region-linked-list">
                  {linkedTrips.map((trip) => (
                    <li className="region-linked-trip" key={trip.id}>
                      <div className="region-linked-trip-copy">
                        <strong>{trip.name}</strong>
                        <small>
                          {trip.startDate} 至 {trip.endDate} · 行程內容會保留
                        </small>
                      </div>
                      <div className="region-reassign-controls">
                        <select
                          aria-label={`將行程「${trip.name}」改派至其他地圖`}
                          value={tripTargets[trip.id] ?? ""}
                          onChange={(event) =>
                            setTripTargets((current) => ({
                              ...current,
                              [trip.id]: event.target.value,
                            }))
                          }
                          disabled={saving}
                        >
                          <option value="">選擇其他地圖…</option>
                          {providerRegions
                            .filter((region) => region.id !== selectedRegion.id)
                            .map((region) => (
                              <option value={region.id} key={region.id}>
                                {region.name}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          className="region-secondary"
                          disabled={saving || !tripTargets[trip.id]}
                          onClick={() => void handleReassignTrip(trip)}
                        >
                          改派行程
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="region-linked-empty">沒有行程使用此地圖。</p>
              )}
              {Boolean(linkedTrips?.length) &&
                providerRegions.filter((region) => region.id !== selectedRegion.id)
                  .length === 0 && (
                  <p className="region-no-alternative">
                    目前沒有其他地圖可供改派。請先關閉此視窗並建立另一張地圖。
                  </p>
                )}
            </section>
            <footer className="region-delete-dialog-actions">
              <span>
                {linkedPlaces?.length || linkedTrips?.length
                  ? "處理完所有關聯後即可刪除。"
                  : "此地圖已沒有關聯資料，可以安全刪除。"}
              </span>
              <div>
                <button
                  type="button"
                  className="region-secondary"
                  disabled={saving}
                  onClick={() => setDeleteDialogOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="region-delete"
                  disabled={saving || Boolean(linkedPlaces?.length || linkedTrips?.length)}
                  onClick={() => void confirmDeleteRegion()}
                >
                  {saving ? "處理中…" : "刪除地圖"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </WorkspaceLayout>
  );
}

export default RegionModule;
