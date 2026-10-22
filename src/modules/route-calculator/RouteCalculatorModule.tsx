import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { EntityNotFoundError } from "../../database";
import type { Place, RouteMapChanges, Trip } from "../../database";
import { WorkspaceLayout } from "../../common/WorkspaceLayout";
import { AdminInfo } from "../../common/AdminInfo";
import {
  formatTravelDistance,
  transportOptions,
} from "../../common/route-estimate";
import { RouteCalculatorController } from "./route-calculator.controller";
import type {
  RouteCalculationResult,
  RouteEndpoint,
  RouteMapPlace,
  TripMapData,
} from "./route-calculator.service";
import { RouteEndpointField } from "./RouteEndpointField";
import { RoutePreviewMap } from "./RoutePreviewMap";
import {
  isTripMarker,
  markerEndpoint,
  visibleRouteMarkers,
} from "./route-markers";
import "./RouteCalculatorModule.css";
import { useHybridDataRevision } from "../../database/useHybridDataRevision";
import { useMapProvider } from "../../geo/provider-preference";
import { markerKey, storedEndpoint } from "./route-calculator.service";

type Target = "origin" | "destination";
const activeRouteMapStorageKey =
  "travel-planner:route-calculator:active-map-id";

export default function RouteCalculatorModule() {
  const { provider, error: providerError } = useMapProvider();
  const dataRevision = useHybridDataRevision();
  const [controller] = useState(() => new RouteCalculatorController());
  const [places, setPlaces] = useState<Place[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [placesError, setPlacesError] = useState("");
  const [placesAttempt, setPlacesAttempt] = useState(0);
  const [tripsError, setTripsError] = useState("");
  const [tripsAttempt, setTripsAttempt] = useState(0);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [tripId, setTripId] = useState("");
  const [tripData, setTripData] = useState<TripMapData>();
  const [routeMapUnavailable, setRouteMapUnavailable] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [tripLoading, setTripLoading] = useState(true);
  const [tripError, setTripError] = useState("");
  const [mapId, setMapId] = useState("");
  const [mapSaveError, setMapSaveError] = useState("");
  const [mapSelectionError, setMapSelectionError] = useState("");
  const [personal, setPersonal] = useState<RouteMapPlace[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [origin, setOrigin] = useState<RouteEndpoint | null>(null);
  const [destination, setDestination] = useState<RouteEndpoint | null>(null);
  const [transport, setTransport] = useState("DRIVING");
  const [tripSettingsOpen, setTripSettingsOpen] = useState(false);
  const [result, setResult] = useState<RouteCalculationResult>();
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");
  const [endpointErrors, setEndpointErrors] = useState({
    origin: "",
    destination: "",
  });
  const [resolving, setResolving] = useState({
    origin: false,
    destination: false,
  });
  const generation = useRef(0);
  const endpointGeneration = useRef({ origin: 0, destination: 0 });
  const tripGeneration = useRef(0);
  const mapIdRef = useRef("");
  const tripSettingsTrigger = useRef<HTMLDetailsElement>(null);
  const resultDialog = useRef<HTMLDialogElement>(null);
  const resultTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!result) {
      resultDialog.current?.close();
      return;
    }
    resultDialog.current?.showModal();
  }, [result]);
  const mapSaveQueue = useRef(Promise.resolve());
  const configured = provider === 'osm' || (provider === 'google' && controller.isGooglePlacesConfigured());
  const markers = useMemo(
    () => visibleRouteMarkers(personal, tripData, date, hidden),
    [personal, tripData, date, hidden],
  );
  const selected = markers.find(
    (marker) => markerKey(marker) === selectedId,
  );
  const busy = calculating || tripLoading;
  const endpointBusy = busy || resolving.origin || resolving.destination;

  const endpointId = (endpoint: RouteEndpoint | null) => {
    if (!endpoint) return undefined;
    const selection = storedEndpoint(endpoint);
    const marker = [...personal, ...(tripData?.markers ?? [])].find((item) => {
      const candidate = storedEndpoint(markerEndpoint(item));
      return JSON.stringify(candidate) === JSON.stringify(selection);
    });
    if (marker) return markerKey(marker);
    const placeId = endpoint.source === 'saved' ? endpoint.placeId
      : endpoint.source === 'selection' && endpoint.selection.kind === 'place' ? endpoint.selection.placeId : undefined;
    const place = places.find(item => item.id === placeId);
    if (place?.location) {
      const location = place.location;
      return location.source === 'osm' ? `osm:${location.reference.id}` : `coordinate:${location.coordinate.latitude},${location.coordinate.longitude}`;
    }
    if (place?.googlePlaceId) return place.googlePlaceId;
    if (endpoint.source === 'selection' && endpoint.selection.kind === 'location') {
      const value = endpoint.selection.value;
      if (value.kind === 'google') return value.reference.id;
      return value.location.source === 'osm' ? `osm:${value.location.reference.id}` : `coordinate:${value.location.coordinate.latitude},${value.location.coordinate.longitude}`;
    }
    if (endpoint.source === 'google') return endpoint.place.id;
    if (endpoint.source === 'osm') return endpoint.place.id;
    return undefined;
  };
  const originId = endpointId(origin);
  const destinationId = endpointId(destination);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPlacesError("");
    void controller
      .listPlaces()
      .then((records) => {
        if (active) setPlaces(records);
      })
      .catch((cause: unknown) => {
        if (active)
          setPlacesError(
            cause instanceof Error ? cause.message : "載入已存地點失敗。",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [controller, placesAttempt, dataRevision]);

  useEffect(() => {
    let active = true;
    setTripsLoading(true);
    setTripsError("");
    void controller
      .listTrips()
      .then((records) => {
        if (active) setTrips(records);
      })
      .catch((cause: unknown) => {
        if (active)
          setTripsError(
            cause instanceof Error ? cause.message : "載入行程失敗。",
          );
      })
      .finally(() => {
        if (active) setTripsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [controller, tripsAttempt, dataRevision]);

  useEffect(
    () => () => {
      generation.current += 1;
      endpointGeneration.current.origin += 1;
      endpointGeneration.current.destination += 1;
      tripGeneration.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!tripId || tripLoading || tripSettingsOpen) return;
    let active = true;
    void controller
      .loadTripMarkers(tripId)
      .then((records) => {
        if (active) setTripData(records);
      })
      .catch((cause: unknown) => {
        if (active)
          setTripError(
            cause instanceof Error ? cause.message : "更新行程地圖失敗。",
          );
      });
    return () => {
      active = false;
    };
  }, [controller, tripId, tripLoading, tripSettingsOpen, dataRevision, provider]);

  const invalidate = useCallback(() => {
    generation.current += 1;
    setResult(undefined);
    setError("");
    setCalculating(false);
  }, []);

  const rememberMap = useCallback((id: string) => {
    mapIdRef.current = id;
    setMapId(id);
    try {
      window.localStorage.setItem(activeRouteMapStorageKey, id);
      setMapSelectionError("");
    } catch (cause) {
      setMapSelectionError(
        cause instanceof Error
          ? `試算地圖已儲存，但無法記住目前地圖：${cause.message}`
          : "試算地圖已儲存，但無法記住目前地圖。",
      );
    }
  }, []);

  const ensureCurrentMap = useCallback(async () => {
    if (mapIdRef.current) return mapIdRef.current;
    const map = await controller.getOrCreateRouteMap(tripId || undefined);
    rememberMap(map.id);
    return map.id;
  }, [controller, rememberMap, tripId]);

  const saveMapChanges = useCallback(
    async (changes: RouteMapChanges, requestedMapId?: string) => {
      const id = requestedMapId ?? (await ensureCurrentMap());
      const operation = mapSaveQueue.current.then(() =>
        controller.updateRouteMap(id, changes),
      );
      mapSaveQueue.current = operation.catch(() => undefined);
      await operation;
      setMapSaveError("");
    },
    [controller, ensureCurrentMap],
  );

  const changeEndpoint = useCallback(
    (target: Target, value: RouteEndpoint | null) => {
      invalidate();
      const current = ++endpointGeneration.current[target];
      const setter = target === "origin" ? setOrigin : setDestination;
      setter(value);
      setEndpointErrors((errors) => ({ ...errors, [target]: "" }));
      setResolving((state) => ({ ...state, [target]: Boolean(value) }));
      if (!value) {
        const currentMapId = mapIdRef.current;
        if (currentMapId) {
          void saveMapChanges(
            target === "origin"
              ? { originGooglePlaceId: undefined, origin: undefined }
              : { destinationGooglePlaceId: undefined, destination: undefined },
            currentMapId,
          ).catch((cause: unknown) => {
            setEndpointErrors((errors) => ({
              ...errors,
              [target]:
                cause instanceof Error ? cause.message : "儲存試算地圖失敗。",
            }));
          });
        }
        return;
      }
      void controller
        .resolveEndpoint(value)
        .then(async (marker) => {
          if (endpointGeneration.current[target] !== current) return;
          const routeMapId = await ensureCurrentMap();
          if (endpointGeneration.current[target] !== current) return;
          if (!isTripMarker(markerKey(marker), tripData)) {
            await controller.addRouteMapPlace(routeMapId, marker);
          }
          if (endpointGeneration.current[target] !== current) return;
          await saveMapChanges(
            target === "origin"
              ? { originGooglePlaceId: undefined, origin: storedEndpoint(value, marker) }
              : { destinationGooglePlaceId: undefined, destination: storedEndpoint(value, marker) },
            routeMapId,
          );
          if (endpointGeneration.current[target] !== current) return;
          setPersonal((existing) => [
            ...existing.filter(
              (item) => markerKey(item) !== markerKey(marker),
            ),
            marker,
          ]);
          setHidden((ids) => ids.filter((id) => id !== markerKey(marker)));
          setSelectedId(markerKey(marker));
        })
        .catch((cause: unknown) => {
          if (endpointGeneration.current[target] !== current) return;
          setter(null);
          setEndpointErrors((errors) => ({
            ...errors,
            [target]:
              cause instanceof Error
                ? cause.message
                : "載入或儲存地點標記失敗，請重新選擇。",
          }));
        })
        .finally(() => {
          if (endpointGeneration.current[target] === current)
            setResolving((state) => ({ ...state, [target]: false }));
        });
    },
    [controller, ensureCurrentMap, invalidate, saveMapChanges, tripData],
  );
  const changeOrigin = useCallback(
    (value: RouteEndpoint | null) => changeEndpoint("origin", value),
    [changeEndpoint],
  );
  const changeDestination = useCallback(
    (value: RouteEndpoint | null) => changeEndpoint("destination", value),
    [changeEndpoint],
  );

  const removeBinding = useCallback(
    (target: Target) => {
      changeEndpoint(target, null);
    },
    [changeEndpoint],
  );

  const assignMarker = useCallback(
    (target: Target, marker: RouteMapPlace) => {
      invalidate();
      const isOpposite =
        target === "origin"
          ? destinationId === markerKey(marker)
          : originId === markerKey(marker);
      if (isOpposite) {
        void saveMapChanges({
          originGooglePlaceId: undefined,
          destinationGooglePlaceId: undefined,
          origin: storedEndpoint(destination),
          destination: storedEndpoint(origin),
        }).catch((cause: unknown) => {
          setMapSaveError(
            cause instanceof Error ? cause.message : "儲存起點與終點失敗。",
          );
        });
        endpointGeneration.current.origin += 1;
        endpointGeneration.current.destination += 1;
        setResolving({ origin: false, destination: false });
        setEndpointErrors({ origin: "", destination: "" });
        setOrigin(destination);
        setDestination(origin);
        setSelectedId(markerKey(marker));
        return;
      }
      void saveMapChanges(
        target === "origin"
          ? { originGooglePlaceId: undefined, origin: storedEndpoint(markerEndpoint(marker)) }
          : { destinationGooglePlaceId: undefined, destination: storedEndpoint(markerEndpoint(marker)) },
      ).catch((cause: unknown) => {
        setMapSaveError(
          cause instanceof Error ? cause.message : "儲存端點失敗。",
        );
      });
      endpointGeneration.current[target] += 1;
      setResolving((state) => ({ ...state, [target]: false }));
      setEndpointErrors((errors) => ({ ...errors, [target]: "" }));
      if (target === "origin") {
        setOrigin(markerEndpoint(marker));
      } else {
        setDestination(markerEndpoint(marker));
      }
      setSelectedId(markerKey(marker));
    },
    [invalidate, originId, destinationId, origin, destination, saveMapChanges],
  );

  const selectMarker = useCallback(
    (marker: RouteMapPlace) => {
      if (busy) return;
      if (selectedId === markerKey(marker)) {
        setSelectedId("");
        return;
      }
      setSelectedId(markerKey(marker));
    },
    [busy, selectedId],
  );

  function reconcileMarkers(next: RouteMapPlace[]) {
    const remains = (id: string | undefined) =>
      !id || next.some((marker) => markerKey(marker) === id);
    const clearOrigin = !remains(originId);
    const clearDestination = !remains(destinationId);
    if (
      (clearOrigin || clearDestination) &&
      !window.confirm(
        "此操作會移除目前的起點或終點標記，並清除對應欄位與試算結果。原始資料不受影響。確定繼續？",
      )
    )
      return false;
    if (clearOrigin) changeOrigin(null);
    if (clearDestination) changeDestination(null);
    if (!next.some((marker) => markerKey(marker) === selectedId))
      setSelectedId("");
    return true;
  }

  function confirmMapSwitch(next: RouteMapPlace[]) {
    const remains = (id: string | undefined) =>
      !id || next.some((marker) => markerKey(marker) === id);
    if (
      (!remains(originId) || !remains(destinationId)) &&
      !window.confirm(
        "切換試算地圖會顯示該地圖已儲存的端點；目前端點不會被刪除，仍保留在原試算地圖。確定繼續？",
      )
    )
      return false;
    return true;
  }

  const applyRouteMap = useCallback(
    async (
      map: Awaited<
        ReturnType<RouteCalculatorController["getOrCreateRouteMap"]>
      >,
      mapData: Awaited<ReturnType<RouteCalculatorController["loadRouteMap"]>>,
      loadedTripData?: TripMapData,
    ) => {
      invalidate();
      endpointGeneration.current.origin += 1;
      endpointGeneration.current.destination += 1;
      setResolving({ origin: false, destination: false });
      const endpointErrors = { origin: "", destination: "" };
      const storedEndpoints = await Promise.all(
        ["origin", "destination"].map(async (target) => {
          const id =
            target === "origin"
              ? map.originGooglePlaceId
              : map.destinationGooglePlaceId;
          const selection = target === "origin" ? map.origin : map.destination;
          if (!id && !selection) return { target, endpoint: null, marker: undefined };
          try {
            const endpoint: RouteEndpoint = selection ? { source: 'selection', selection } : {
              source: "google",
              place: { id: id! },
            };
            const marker = await controller.resolveEndpoint(endpoint);
            return {
              target,
              endpoint: endpoint.source === 'selection' ? { ...endpoint, name: marker.name } : endpoint,
              marker,
            };
          } catch (cause) {
            endpointErrors[target as Target] =
              cause instanceof Error ? cause.message : "無法載入已儲存的端點。";
            return { target, endpoint: null, marker: undefined };
          }
        }),
      );
      const tripMarkerIds = new Set(
        loadedTripData?.markers.map(markerKey) ?? [],
      );
      const personalMarkers = [...mapData.markers];
      for (const { marker } of storedEndpoints) {
        if (
          marker &&
          !tripMarkerIds.has(markerKey(marker)) &&
          !personalMarkers.some(
            (item) => markerKey(item) === markerKey(marker),
          )
        ) {
          personalMarkers.push(marker);
        }
      }
      mapIdRef.current = map.id;
      rememberMap(map.id);
      setTripId(map.tripId ?? "");
      setTripData(loadedTripData);
      setRouteMapUnavailable(mapData.unavailable);
      const selectedDate =
        map.selectedDate && loadedTripData?.dates.includes(map.selectedDate)
          ? map.selectedDate
          : "";
      setDate(selectedDate);
      setPersonal(personalMarkers);
      setHidden([]);
      setOrigin(
        storedEndpoints.find((item) => item.target === "origin")?.endpoint ??
          null,
      );
      setDestination(
        storedEndpoints.find((item) => item.target === "destination")
          ?.endpoint ?? null,
      );
      setTransport(map.transport);
      setEndpointErrors(endpointErrors);
      setSelectedId("");
      setTripError("");
      if (map.selectedDate && !selectedDate) {
        const operation = mapSaveQueue.current.then(() =>
          controller.updateRouteMap(map.id, { selectedDate: undefined }),
        );
        mapSaveQueue.current = operation.catch(() => undefined);
        void operation.catch((cause: unknown) => {
          setMapSaveError(
            cause instanceof Error
              ? cause.message
              : "清除已失效的日期篩選失敗。",
          );
        });
      }
    },
    [controller, invalidate, rememberMap],
  );

  useEffect(() => {
    let active = true;
    const current = ++tripGeneration.current;
    endpointGeneration.current.origin += 1;
    endpointGeneration.current.destination += 1;
    setOrigin(null);
    setDestination(null);
    setPersonal([]);
    setTripData(undefined);
    setSelectedId("");
    setResolving({ origin: false, destination: false });
    invalidate();
    if (!provider) {
      setTripLoading(false);
      return;
    }
    let savedMapId: string;
    try {
      savedMapId = window.localStorage.getItem(activeRouteMapStorageKey) ?? "";
    } catch (cause) {
      setMapSelectionError(
        cause instanceof Error
          ? `無法讀取上次使用的試算地圖：${cause.message}`
          : "無法讀取上次使用的試算地圖。",
      );
      setTripLoading(false);
      return () => {
        active = false;
      };
    }
    setTripLoading(true);
    void (async () => {
      try {
        const mapId = savedMapId || (await controller.getInitialRouteMap())?.id;
        if (!mapId) return;
        const mapData = await controller.loadRouteMap(mapId);
        const loadedTripData = mapData.map.tripId
          ? await controller.loadTripMarkers(mapData.map.tripId)
          : undefined;
        if (!active || tripGeneration.current !== current) return;
        await applyRouteMap(mapData.map, mapData, loadedTripData);
      } catch (cause) {
        if (active && tripGeneration.current === current) {
          if (cause instanceof EntityNotFoundError) {
            mapIdRef.current = "";
            setMapId("");
            setTripId("");
            try {
              window.localStorage.removeItem(activeRouteMapStorageKey);
            } catch (storageCause) {
              setMapSelectionError(
                storageCause instanceof Error
                  ? `上次使用的試算地圖已不存在，且無法清除記錄：${storageCause.message}`
                  : "上次使用的試算地圖已不存在，且無法清除記錄。",
              );
            }
            setTripError("上次使用的試算地圖已不存在，請重新選擇行程。");
          } else {
            setTripError(
              cause instanceof Error
                ? cause.message
                : "載入已儲存的試算地圖失敗。",
            );
          }
        }
      } finally {
        if (active && tripGeneration.current === current) setTripLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyRouteMap, controller, provider, invalidate]);

  useEffect(() => {
    const close = (event: KeyboardEvent | PointerEvent) => {
      const menu = tripSettingsTrigger.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        menu.open = false;
        menu.querySelector("summary")?.focus();
      } else if (event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, []);

  async function loadTrip(nextId: string) {
    const current = ++tripGeneration.current;
    setTripLoading(true);
    setTripError("");
    try {
      const map = await controller.getOrCreateRouteMap(nextId || undefined);
      const [mapData, data] = await Promise.all([
        controller.loadRouteMap(map.id),
        nextId
          ? controller.loadTripMarkers(nextId)
          : Promise.resolve(undefined),
      ]);
      if (tripGeneration.current !== current) return;
      const nextDate =
        map.selectedDate && data?.dates.includes(map.selectedDate)
          ? map.selectedDate
          : "";
      if (
        !confirmMapSwitch(
          visibleRouteMarkers(mapData.markers, data, nextDate, []),
        )
      )
        return;
      await applyRouteMap(map, mapData, data);
    } catch (cause) {
      if (tripGeneration.current === current)
        setTripError(
          cause instanceof Error
            ? cause.message
            : "行程標記載入失敗，請重新選擇行程。",
        );
    } finally {
      if (tripGeneration.current === current) setTripLoading(false);
    }
  }

  async function removeMarker(marker: RouteMapPlace) {
    if (isTripMarker(markerKey(marker), tripData)) {
      setError("原行程地點不可移除標記。");
      return;
    }
    const nextHidden = [...hidden, markerKey(marker)];
    const nextPersonal = personal.filter(
      (item) => markerKey(item) !== markerKey(marker),
    );
    if (
      !reconcileMarkers(
        visibleRouteMarkers(nextPersonal, tripData, date, nextHidden),
      )
    )
      return;
    try {
      if (!mapIdRef.current) throw new Error("目前沒有已載入的試算地圖。");
      await controller.removeRouteMapPlace(
        mapIdRef.current,
        markerKey(marker),
      );
      setPersonal(nextPersonal);
      setHidden(nextHidden);
      setSelectedId("");
    } catch (cause) {
      setMapSaveError(
        cause instanceof Error ? cause.message : "移除標記失敗。",
      );
    }
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || resolving.origin || resolving.destination) return;
    if (!origin || !destination) {
      setError("請選擇有效的起點與終點。");
      return;
    }
    const current = ++generation.current;
    setCalculating(true);
    setResult(undefined);
    setError("");
    try {
      const next = await controller.calculate({
        origin,
        destination,
        transport,
        provider,
      });
      if (generation.current === current) setResult(next);
    } catch (cause) {
      if (generation.current === current)
        setError(
          cause instanceof Error ? cause.message : "路程計算失敗，請稍後重試。",
        );
    } finally {
      if (generation.current === current) setCalculating(false);
    }
  }

  return (
    <WorkspaceLayout
      active="route-calculator"
      mainClassName="route-calculator-main"
      shellClassName="route-calculator-shell"
    >
      <div className="route-calculator-content">
        <header className="route-calculator-heading">
          <div>
            <h1>路程試算</h1>
            <p>
              使用已存地點或 {provider === 'osm' ? 'OSM' : 'Google'}
              搜尋；也可點選地圖圖釘，在標記資訊中指定起終點。
            </p>
          </div>
        </header>
        {providerError && <p className="route-inline-error" role="alert">{providerError}</p>}
        <div className="route-calculator-workspace">
          <section
            className="route-calculator-panel"
            aria-label="路程試算設定與結果"
          >
            <header className="route-panel-heading route-settings-heading">
              <details
                ref={tripSettingsTrigger}
                className="route-trip-switcher"
                onToggle={(event) => setTripSettingsOpen(event.currentTarget.open)}
              >
                <summary aria-label="切換行程">
                  <span>{tripsLoading ? "正在載入行程…" : trips.find((trip) => trip.id === tripId)?.name ?? (tripId ? "已選行程" : "選擇行程")}</span>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
                </summary>
                <div className="route-trip-options">
                  <div className="route-trip-options-heading">你的行程</div>
                  {[{ id: "", name: "不載入行程", startDate: "", endDate: "" }, ...trips].map((trip) => (
                    <button
                      key={trip.id}
                      type="button"
                      aria-current={trip.id === tripId ? "true" : undefined}
                      disabled={busy || tripsLoading || resolving.origin || resolving.destination || !configured}
                      onClick={() => {
                        if (tripSettingsTrigger.current) {
                          tripSettingsTrigger.current.open = false;
                          tripSettingsTrigger.current.querySelector("summary")?.focus();
                        }
                        void loadTrip(trip.id);
                      }}
                    >
                      <span><strong>{trip.name}</strong>{trip.startDate && <small>{trip.startDate} — {trip.endDate}</small>}</span>
                      {trip.id === tripId && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
              </details>
              {tripId && (
                <label className="route-trip-date">
                  <span>日期範圍</span>
                  <select value={date} disabled={busy || resolving.origin || resolving.destination}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (reconcileMarkers(visibleRouteMarkers(personal, tripData, next, hidden))) {
                        setDate(next);
                        void saveMapChanges({ selectedDate: next || undefined }).catch((cause: unknown) => {
                          setMapSaveError(cause instanceof Error ? cause.message : "儲存日期範圍失敗。");
                        });
                      }
                    }}>
                    <option value="">全部日期</option>
                    {tripData?.dates.map((day) => <option key={day} value={day}>{day}</option>)}
                  </select>
                </label>
              )}
            </header>
            {tripError && (
              <p
                className="route-inline-error route-persistent-error"
                role="alert"
              >
                {tripError}
              </p>
            )}
            {mapSaveError && (
              <p
                className="route-inline-error route-persistent-error"
                role="alert"
              >
                {mapSaveError}
              </p>
            )}
            {mapSelectionError && (
              <p
                className="route-inline-error route-persistent-error"
                role="alert"
              >
                {mapSelectionError}
              </p>
            )}
            <section className="route-marker-panel" aria-label="標記資訊">
              <h2>標記資訊</h2>
              {selected ? (
                <>
                  <p className="route-selected-place">
                    {selected.name}
                    <small>{selected.address}</small>
                  </p>
                  <p className="route-field-hint">
                    來源：
                    {isTripMarker(selectedId, tripData)
                      ? "原行程地點"
                      : "後加地點（不在所選行程）"}
                    {selectedId === originId ? " · 起點" : ""}
                    {selectedId === destinationId ? " · 終點" : ""}
                  </p>
                  <div className="route-marker-actions">
                    <button
                      type="button"
                      className="route-secondary"
                      disabled={busy}
                      onClick={() => setSelectedId("")}
                    >
                      取消選取
                    </button>
                    {!isTripMarker(selectedId, tripData) && (
                      <button
                        type="button"
                        className="route-remove-marker"
                        disabled={endpointBusy}
                        onClick={() => removeMarker(selected)}
                      >
                        移除標記
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="route-field-hint"></p>
              )}
              <details className="route-marker-list">
                <summary>標記清單（{markers.length}）</summary>
                {markers.length ? (
                  <ul>
                    {markers.map((marker) => (
                      <li key={markerKey(marker)}>
                        <button
                          type="button"
                          disabled={busy}
                          aria-pressed={selectedId === markerKey(marker)}
                          onClick={() => selectMarker(marker)}
                        >
                          {marker.name}
                          {markerKey(marker) === originId
                            ? "（起點）"
                            : ""}
                          {markerKey(marker) === destinationId
                            ? "（終點）"
                            : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="route-field-hint">
                    尚無標記，請載入行程或選取搜尋結果。
                  </p>
                )}
              </details>
            </section>
            {loading ? (
              <p className="route-loading" role="status">
                正在載入已存地點…
              </p>
            ) : (
              <form
                className="route-calculator-form"
                onSubmit={(event) => void calculate(event)}
              >
                {placesError && (
                  <div className="route-inline-error" role="alert">
                    {placesError} 仍可使用 Google 搜尋。
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPlacesAttempt((value) => value + 1)}
                    >
                      重試載入地點
                    </button>
                  </div>
                )}
                <RouteEndpointField
                  controller={controller}
                  label="起點"
                  places={places}
                  addedMarkers={markers.filter(
                    (marker) => !isTripMarker(markerKey(marker), tripData),
                  )}
                  value={origin}
                  onChange={changeOrigin}
                  disabled={busy}
                />
                {resolving.origin && (
                  <p className="route-field-hint" role="status">
                    正在載入起點標記…
                  </p>
                )}
                {endpointErrors.origin && (
                  <p className="route-inline-error" role="alert">
                    {endpointErrors.origin}
                  </p>
                )}
                <RouteEndpointField
                  controller={controller}
                  label="終點"
                  places={places}
                  addedMarkers={markers.filter(
                    (marker) => !isTripMarker(markerKey(marker), tripData),
                  )}
                  value={destination}
                  onChange={changeDestination}
                  disabled={busy}
                />
                {resolving.destination && (
                  <p className="route-field-hint" role="status">
                    正在載入終點標記…
                  </p>
                )}
                {endpointErrors.destination && (
                  <p className="route-inline-error" role="alert">
                    {endpointErrors.destination}
                  </p>
                )}
                <label className="route-transport">
                  <span>
                    交通 <b>*</b>
                  </span>
                  <select
                    value={transport}
                    disabled={busy}
                    onChange={(event) => {
                      const next = event.target.value;
                      invalidate();
                      setTransport(next);
                      void saveMapChanges({ transport: next }).catch(
                        (cause: unknown) => {
                          setMapSaveError(
                            cause instanceof Error
                              ? cause.message
                              : "儲存交通方式失敗。",
                          );
                        },
                      );
                    }}
                  >
                    {transportOptions.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}{provider === 'osm' && !['DRIVING', 'WALKING', 'BICYCLING'].includes(option.value) ? '（OSM 不支援）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {!configured && (
                  <p className="route-inline-error" role="alert">
                    {providerError ?? '尚未設定 Google Maps API key，無法計算路程。'}
                  </p>
                )}
                {error && (
                  <p className="route-inline-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="route-primary"
                  type="submit"
                  disabled={
                    busy ||
                    resolving.origin ||
                    resolving.destination ||
                    !configured ||
                    !origin ||
                    !destination
                  }
                >
                  {calculating ? "正在計算…" : "路程計算"}
                </button>
                {result && (
                  <button ref={resultTrigger} type="button" className="route-secondary"
                    onClick={() => resultDialog.current?.showModal()}>
                    試算結果
                  </button>
                )}
              </form>
            )}
            {result && (
              <dialog ref={resultDialog} className="route-result-dialog"
                aria-label="路程試算結果"
                onClose={() => resultTrigger.current?.focus()}
                onClick={(event) => {
                  if (event.target === event.currentTarget) resultDialog.current?.close();
                }}>
                <div className="route-result-dialog-content">
                  <button type="button" className="route-dialog-close"
                    aria-label="關閉試算結果" autoFocus
                    onClick={() => resultDialog.current?.close()}>×</button>
              <section
                className="route-result"
                aria-label="路程試算結果"
                aria-live="polite"
              >
                <h2>試算結果</h2>
                <p>
                  {result.origin.name} → {result.destination.name}
                </p>
                <span>
                  {
                    transportOptions.find(
                      (option) => option.value === result.transport,
                    )?.label
                  }
                </span>
                <dl>
                  <div>
                    <dt>預估時間</dt>
                    <dd>約 {result.durationMinutes} 分鐘</dd>
                  </div>
                  <div>
                    <dt>路線距離</dt>
                    <dd>{formatTravelDistance(result.distanceMeters)}</dd>
                  </div>
                </dl>
                <small>
                  {result.provider === 'osm' ? 'OSM' : 'Google Maps'}
                  路線估算，非保證抵達時間；實際時間受路況與班次影響。修改條件後需重新計算。
                </small>
              </section>
                </div>
              </dialog>
            )}
          </section>
          <RoutePreviewMap
            markers={markers}
            tripData={tripData}
            originId={originId}
            destinationId={destinationId}
            selectedId={selectedId}
            onSelect={selectMarker}
            disabled={busy}
            configured={configured}
            provider={provider}
            actions={
              selected && (
                <>
                  {selectedId !== originId && (
                    <button
                      type="button"
                      className="route-secondary route-map-action-button"
                      disabled={endpointBusy}
                      onClick={() => assignMarker("origin", selected)}
                    >
                      設為起點
                    </button>
                  )}
                  {selectedId !== destinationId && (
                    <button
                      type="button"
                      className="route-secondary route-map-action-button"
                      disabled={endpointBusy}
                      onClick={() => assignMarker("destination", selected)}
                    >
                      設為終點
                    </button>
                  )}
                  {selectedId === originId && (
                    <button
                      type="button"
                      className="route-secondary route-map-action-button"
                      disabled={endpointBusy}
                      onClick={() => removeBinding("origin")}
                    >
                      移除起點
                    </button>
                  )}
                  {selectedId === destinationId && (
                    <button
                      type="button"
                      className="route-secondary route-map-action-button"
                      disabled={endpointBusy}
                      onClick={() => removeBinding("destination")}
                    >
                      移除終點
                    </button>
                  )}
                </>
              )
            }
          />
        </div>
        <AdminInfo>
        <details className="route-trip-notices">
          <summary>資料狀態{tripsError ? " · 行程載入失敗" : ""}{tripLoading ? " · 載入中…" : ""}{(tripData?.unavailable.length ?? 0) + routeMapUnavailable.length > 0 ? " · 部分地點無法顯示" : ""}</summary>
          <div>
                {tripsError && (
                  <div className="route-inline-error" role="alert">
                    {tripsError}
                    <button
                      type="button"
                      onClick={() => setTripsAttempt((value) => value + 1)}
                    >
                      重試
                    </button>
                  </div>
                )}
                {mapId && (
                  <p className="route-field-hint" role="status">
                    目前試算地圖已自動儲存。
                  </p>
                )}
                {!tripsLoading && !tripsError && !trips.length && (
                  <p className="route-field-hint">
                    尚無行程，仍可搜尋地點加入標記。
                  </p>
                )}
                {tripLoading && (
                  <p className="route-field-hint" role="status">
                    正在載入行程地點標記…
                  </p>
                )}
                {tripId && !tripData?.dates.length && (
                  <p className="route-field-hint">此行程尚未安排地點。</p>
                )}
                {!!tripData?.unavailable.length && (
                  <details className="route-unavailable">
                    <summary>
                      {tripData.unavailable.length} 個地點無法顯示
                    </summary>
                    <ul>
                      {tripData.unavailable.map((message, index) => (
                        <li key={index}>{message}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {!!routeMapUnavailable.length && (
                  <details className="route-unavailable">
                    <summary>
                      {routeMapUnavailable.length} 個後加地點無法顯示
                    </summary>
                    <ul>
                      {routeMapUnavailable.map((message, index) => (
                        <li key={index}>{message}</li>
                      ))}
                    </ul>
                  </details>
                )}
          </div>
        </details>
        </AdminInfo>
      </div>
    </WorkspaceLayout>
  );
}
