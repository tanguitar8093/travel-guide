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
import { googleMapsNavigationUrl, suggestedOsmLocationName } from "../../geo/osm-service";
import { regionsForMapProvider } from "../../geo/region-provider";
import { OsmSearchHeading } from "../../geo/OsmSearchHeading";

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
  const [locationWarning, setLocationWarning] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tripTargets, setTripTargets] = useState<Record<string, string>>({});
  const [googleDetails, setGoogleDetails] = useState<GooglePlaceDetails>();
  const [googleDetailsForId, setGoogleDetailsForId] = useState<string>();
  const [googleDetailsErrorForId, setGoogleDetailsErrorForId] =
    useState<string>();
  const autocompleteContainerRef = useRef<HTMLDivElement>(null);

  const providerRegions = regionsForMapProvider(regions, provider);
  const selectedRegion = providerRegions.find((region) => region.id === selectedId);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const reloadBlocked = creating || editing || saving || deleteDialogOpen;
  const linkedPlaces =
    selectedRegion && places.filter((place) => place.regionIds.includes(selectedRegion.id));
  const linkedTrips =
    selectedRegion && trips.filter((trip) => trip.regionId === selectedRegion.id);
  const selectedGooglePlaceId = selectedRegion?.googlePlaceId;
  const visibleGoogleDetails =
    googleDetailsForId === selectedGooglePlaceId ? googleDetails : undefined;
  const googleDetailsLoading = Boolean(
    selectedGooglePlaceId &&
    googleDetailsForId !== selectedGooglePlaceId &&
    googleDetailsErrorForId !== selectedGooglePlaceId,
  );

  async function refresh(preferredId = selectedId) {
    const workspace = await regionController.loadWorkspace();
    const filteredRegions = regionsForMapProvider(workspace.regions, provider);
    const nextRegion =
      filteredRegions.find((region) => region.id === preferredId) ??
      filteredRegions[0];
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
        const filteredRegions = regionsForMapProvider(workspace.regions, provider);
        const firstRegion =
          filteredRegions.find((region) => region.id === selectedIdRef.current) ??
          filteredRegions[0];
        setSelectedId(firstRegion?.id);
        setDraft(firstRegion ? toDraft(firstRegion) : emptyDraft);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "載入區域資料失敗。",
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
          setGoogleDetailsForId(details.id);
          setGoogleDetailsErrorForId(undefined);
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
    if (!editing || provider !== 'osm' || !autocompleteContainerRef.current) return;
    const container = autocompleteContainerRef.current;
    let active = true;
    let dispose: (() => void) | undefined;
    regionController.mountOsmAutocomplete(container, candidate => {
      if (!active) return;
      const { coordinate, ...metadata } = candidate.location;
      setDraft(current => ({
        ...current, center: coordinate, centerMetadata: metadata, googlePlaceId: undefined,
        name: current.name || suggestedOsmLocationName(candidate),
      }));
      setLocationWarning(candidate.warning ?? '');
      setError('');
      document.getElementById('region-user-name')?.focus();
    }, cause => { if (active) setError(cause.message); }, {
      onInput: () => {
        if (active) {
          setLocationWarning('');
          setDraft(current => ({ ...current, center: undefined, centerMetadata: undefined, googlePlaceId: undefined }));
        }
      },
    }).then(unmount => {
      if (active) { dispose = unmount; container.querySelector('input')?.focus(); }
      else unmount();
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'OSM 搜尋無法啟動。'); });
    return () => { active = false; dispose?.(); };
  }, [editing, provider]);

  useEffect(() => {
    if (!selectedGooglePlaceId || provider !== 'google') return;
    let active = true;
    regionController
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
              : "讀取 Google 區域資料失敗。",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [selectedGooglePlaceId, provider]);

  function startCreate() {
    setSelectedId(undefined);
    setDraft(provider === 'osm'
      ? { ...emptyDraft, name: '沖繩', zoom: 8 }
      : emptyDraft);
    setGoogleDetails(undefined);
    setGoogleDetailsForId(undefined);
    setGoogleDetailsErrorForId(undefined);
    setCreating(true);
    setEditing(true);
    setError("");
    setNotice("");
  }

  function selectRegion(region: Region) {
    setSelectedId(region.id);
    setDraft(toDraft(region));
    setCreating(false);
    setEditing(false);
    setGoogleDetails(undefined);
    setGoogleDetailsForId(undefined);
    setGoogleDetailsErrorForId(undefined);
    setError("");
    setNotice("");
  }

  function cancelEdit() {
    setCreating(false);
    setEditing(false);
    setError("");
    setDraft(selectedRegion ? toDraft(selectedRegion) : emptyDraft);
    setGoogleDetails(undefined);
    setGoogleDetailsForId(undefined);
    setGoogleDetailsErrorForId(undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider) { setError(providerError ?? '請先選擇地圖供應商。'); return; }
    setSaving(true);
    setError("");
    setNotice("");
    const input: NewRegion = {
      name: draft.name.trim(),
      ...(provider === 'osm' ? { mapProvider: 'osm' as const } : {}),
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
      setNotice(creating ? "區域已建立。" : "區域變更已儲存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "儲存區域失敗。");
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(region: Region) {
    setSelectedId(region.id);
    setDeleteDialogOpen(true);
    setTripTargets({});
    setError("");
    setNotice("");
  }

  async function handleRemovePlaceRegion(place: Place) {
    if (!selectedRegion) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await placeController.update(place.id, {
        regionIds: place.regionIds.filter((id) => id !== selectedRegion.id),
      });
      await refresh(selectedRegion.id);
      setNotice(`已從「${place.name}」移除此區域。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "解除地點區域關聯失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function handleReassignTrip(trip: Trip) {
    const regionId = tripTargets[trip.id];
    if (!regionId || !selectedRegion) return;
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
      setNotice(`已將行程「${trip.name}」改派至「${regions.find((region) => region.id === regionId)?.name ?? "其他區域"}」。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重新指派行程區域失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteRegion() {
    if (!selectedRegion || linkedPlaces?.length || linkedTrips?.length) return;
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
      setGoogleDetailsForId(undefined);
      setGoogleDetailsErrorForId(undefined);
      setNotice(`區域「${selectedRegion.name}」已刪除。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "刪除區域失敗。");
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
            <h1>區域</h1>
            <p>建立行程使用的區域，也可將收藏地點歸入相同區域。</p>
          </div>
          <button
            type="button"
            className="region-primary"
            onClick={startCreate}
          >
            ＋ 新增區域
          </button>
        </section>
        {(error || providerError) && !deleteDialogOpen && (
          <div className="region-feedback region-error" role="alert">
            {error || providerError}
          </div>
        )}
        {notice && !deleteDialogOpen && (
          <div className="region-feedback region-success" role="status">
            {notice}
          </div>
        )}
        <section className="region-workspace">
          <aside className="region-list-card">
            <div className="region-card-heading">
              <strong>已建立區域</strong>
              <span>{providerRegions.length}</span>
            </div>
            {loading ? (
              <p className="region-empty">正在載入…</p>
            ) : providerRegions.length ? (
              providerRegions.map((region) => (
                <button
                  type="button"
                  key={region.id}
                  className={`region-list-item${selectedId === region.id && !creating ? " selected" : ""}`}
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
              <p className="region-empty">{provider === 'osm' ? '目前沒有本機 OSM 區域資料；請先建立沖繩區域。' : '目前還沒有 Google 地圖區域。'}</p>
            )}
          </aside>

          <section className="region-detail-card">
            {editing ? (
              <form
                className="region-form"
                onSubmit={(event) => void handleSubmit(event)}
              >
                <div className="region-detail-heading">
                  <div>
                    <span>{creating ? "建立目的地區域" : "編輯區域"}</span>
                    <h2>{creating ? "新增區域" : draft.name}</h2>
                  </div>
                </div>
                <div className="region-google-search">
                  <div className="region-search-label">
                    {provider === 'osm' ? <OsmSearchHeading title="搜尋區域中心" /> : '用 Google 地圖選擇區域中心'} <b>*</b>
                  </div>
                  {provider === 'osm' || (provider === 'google' && regionController.isGooglePlacesConfigured()) ? (
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
                  {provider === 'osm' && draft.centerMetadata && draft.center && <div className="region-selected-place">
                    <span>✓ 已選區域中心：{draft.center.latitude}, {draft.center.longitude}</span>
                    <small>來源：{draft.centerMetadata.source}；原 Google 地點連結保留。</small>
                    {locationWarning && <small role="status">{locationWarning}</small>}
                  </div>}
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
                    區域名稱 <b>*</b>
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
                        !provider || (provider === 'osm' ? !draft.centerMetadata || !draft.center : !draft.googlePlaceId && !draft.center)
                      }
                    >
                      {saving ? "儲存中…" : creating ? "建立區域" : "儲存變更"}
                    </button>
                  </div>
                </div>
              </form>
            ) : selectedRegion ? (
              <div className="region-detail">
                <div className="region-detail-heading">
                  <div>
                    <span>區域詳細資料</span>
                    <h2>{selectedRegion.name}</h2>
                  </div>
                  <div className="region-detail-actions">
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
                      刪除區域
                    </button>
                  </div>
                </div>
                {provider === 'osm' && selectedRegion.centerMetadata && selectedRegion.center ? (
                  <section className="region-legacy-location">
                    <span>OSM／自主區域中心：{selectedRegion.center.latitude}, {selectedRegion.center.longitude}（{selectedRegion.centerMetadata.source}）</span>
                    <a className="region-map-link" href={googleMapsNavigationUrl(selectedRegion.center)} target="_blank" rel="noreferrer">
                      在 Google Maps 開啟 ↗
                    </a>
                  </section>
                ) : provider === 'osm' ? (
                  <p className="region-legacy-location">
                    尚無已確認來源的 OSM 區域中心；請編輯並重新選擇，原 Google 地點連結仍保留。
                  </p>
                ) : selectedRegion.googlePlaceId ? (
                  <section className="region-google-summary">
                    <div className="region-google-attribution">
                      Google Maps 地點 <span>Powered by Google Maps</span>
                    </div>
                    {googleDetailsLoading ? (
                      <p>正在向 Google 讀取區域資訊…</p>
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
                        暫時無法載入即時地點資訊；Google place_id 仍已保存。
                      </p>
                    )}
                    <a
                      className="region-map-link"
                      href={
                        visibleGoogleDetails?.googleMapsUri ??
                        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedRegion.name)}&query_place_id=${encodeURIComponent(selectedRegion.googlePlaceId)}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      在 Google Maps 開啟 ↗
                    </a>
                  </section>
                ) : (
                  <p className="region-legacy-location">
                    此區域沿用舊版手動設定的位置。編輯時可搜尋 Google Maps
                    更新位置。
                  </p>
                )}
                <dl className="region-details-grid">
                  <div>
                    <dt>所屬行程</dt>
                    <dd>{usage.trips.get(selectedRegion.id) ?? 0} 個</dd>
                  </div>
                  <div>
                    <dt>收藏地點</dt>
                    <dd>{usage.places.get(selectedRegion.id) ?? 0} 個</dd>
                  </div>
                </dl>
                <p className="region-help">
                  行程建立時需選擇一個區域。若要將地點加入此區域，請到地點模組編輯地點的「所屬區域」。
                </p>
              </div>
            ) : (
              <div className="region-empty-detail">
                <span>◎</span>
                <h2>先建立旅行區域</h2>
                <p>區域可以代表城市、地區或一次旅行的目的地範圍。</p>
                <button
                  type="button"
                  className="region-primary"
                  onClick={startCreate}
                >
                  ＋ 新增區域
                </button>
              </div>
            )}
          </section>
        </section>
      </div>
      {deleteDialogOpen && selectedRegion && (
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
                <span>刪除區域前，先處理關聯資料</span>
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
              移除地點關聯不會刪除地點或標籤。行程必須保留區域，請改派至其他區域。
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
                        {saving ? "處理中…" : "從此區域移除"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="region-linked-empty">沒有地點使用此區域。</p>
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
                          aria-label={`將行程「${trip.name}」改派至其他區域`}
                          value={tripTargets[trip.id] ?? ""}
                          onChange={(event) =>
                            setTripTargets((current) => ({
                              ...current,
                              [trip.id]: event.target.value,
                            }))
                          }
                          disabled={saving}
                        >
                          <option value="">選擇其他區域…</option>
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
                <p className="region-linked-empty">沒有行程使用此區域。</p>
              )}
              {Boolean(linkedTrips?.length) &&
                providerRegions.filter((region) => region.id !== selectedRegion.id)
                  .length === 0 && (
                  <p className="region-no-alternative">
                    目前沒有其他區域可供改派。請先關閉此視窗並建立另一個區域。
                  </p>
                )}
            </section>
            <footer className="region-delete-dialog-actions">
              <span>
                {linkedPlaces?.length || linkedTrips?.length
                  ? "處理完所有關聯後即可刪除。"
                  : "此區域已沒有關聯資料，可以安全刪除。"}
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
                  {saving ? "處理中…" : "刪除區域"}
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
