import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { mountWorkspaceMap } from "../../geo/workspace-map";
import type { GeoProvider } from "../../geo/contracts";
import type { GoogleMapHandle } from "../place/google-places.service";
import type { RouteMapPlace, TripMapData } from "./route-calculator.service";
import { isTripMarker, markerKey, routeMarkerColors } from "./route-markers";

interface Props {
  markers: RouteMapPlace[];
  originId?: string;
  destinationId?: string;
  selectedId: string;
  onSelect: (marker: RouteMapPlace) => void;
  disabled: boolean;
  configured: boolean;
  actions: ReactNode;
  tripData?: TripMapData;
  provider?: GeoProvider;
}

export function RoutePreviewMap({
  markers,
  originId,
  destinationId,
  selectedId,
  onSelect,
  disabled,
  configured,
  actions,
  tripData,
  provider = 'google',
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<GoogleMapHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [fit, setFit] = useState(0);
  const lastFit = useRef(-1);
  const previousIds = useRef("");
  const interaction = useRef({ disabled, onSelect });
  interaction.current = { disabled, onSelect };
  const mapMarkers = useMemo(
    () => markers.map((marker) => {
      const id = markerKey(marker);
      const tripMarker = isTripMarker(id, tripData);
      return {
        id,
        position: marker.position,
        title: `${marker.name}（${tripMarker ? "原行程地點" : "後加地點"}）${id === originId ? "（起點）" : ""}${id === destinationId ? "（終點）" : ""}${id === selectedId ? "（已選取）" : ""}`,
        color: tripMarker ? routeMarkerColors.trip : routeMarkerColors.added,
        enlarged: id === selectedId,
        sequence: id === originId ? 1 : id === destinationId ? 2 : undefined,
        onClick: () => {
          if (!interaction.current.disabled) interaction.current.onSelect(marker);
        },
      };
    }),
    [markers, tripData, originId, destinationId, selectedId],
  );

  useEffect(() => {
    if (!container.current || !configured) {
      setReady(false);
      return;
    }
    let active = true;
    let owned: GoogleMapHandle | undefined;
    let failed = false;
    const abort = new AbortController();
    setReady(false);
    setError("");
    const host = document.createElement("div");
    host.className = "route-map-host itinerary-google-map";
    container.current.replaceChildren(host);
    const fail = (cause: unknown) => {
      if (!active) return;
      failed = true;
      setReady(false);
      setError(cause instanceof Error ? cause.message : "地圖載入失敗。");
      owned?.destroy();
      if (map.current === owned) map.current = null;
    };
    void mountWorkspaceMap(provider, host, {
      center: { lat: 25.033, lng: 121.5654 },
      zoom: 10,
      maxZoom: 17,
      signal: abort.signal,
    }, fail)
      .then((handle) => {
        if (!active || failed) {
          handle.destroy();
          return;
        }
        owned = handle;
        map.current = handle;
        previousIds.current = "";
        lastFit.current = -1;
        setReady(true);
      })
      .catch(fail);
    return () => {
      active = false;
      abort.abort();
      owned?.destroy();
      if (map.current === owned) map.current = null;
      host.remove();
    };
  }, [configured, attempt, provider]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const ids = mapMarkers
      .map(marker => marker.id)
      .sort()
      .join("|");
    const shouldFit = ids !== previousIds.current || fit !== lastFit.current;
    try {
      map.current.setMarkers(mapMarkers, { fitBounds: shouldFit });
      previousIds.current = ids;
      lastFit.current = fit;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "地點標記更新失敗。");
      setReady(false);
    }
  }, [mapMarkers, ready, fit]);

  return (
    <section className="route-calculator-map" aria-label="路程試算地圖">
      <header className="route-panel-heading">
        <div className="route-map-title">
          <h2>地圖預覽</h2>
          <div className="route-map-actions">
            {actions}
            <button
              type="button"
              className="route-secondary route-map-action-button"
              disabled={!ready || !markers.length}
              onClick={() => setFit((value) => value + 1)}
            >
              查看全程
            </button>
            <button
              type="button"
              className="route-secondary route-map-action-button"
              disabled={!ready}
              onClick={() => {
                try { map.current?.resetView(); }
                catch (cause) {
                  setError(cause instanceof Error ? cause.message : "恢復地圖視野失敗。");
                  setReady(false);
                }
              }}
            >
              {provider === 'osm' ? '沖繩全景' : '恢復預設'}
            </button>
          </div>
        </div>
      </header>
      <div className="route-map-body">
        <div className="route-map-canvas" ref={container} />
        {(!configured || !ready) && (
          <div className="route-map-message" role={error ? "alert" : "status"}>
            {!configured
              ? "尚未設定 Google Maps API key。"
              : error || "正在載入地圖…"}
            {error && (
              <button
                type="button"
                className="route-secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                重試地圖
              </button>
            )}
          </div>
        )}
      </div>
      <footer className="route-marker-legend" aria-label="標記圖例與數量">
        <span>
          <i
            style={{ backgroundColor: routeMarkerColors.trip }}
            aria-hidden="true"
          />
          原行程
        </span>
        <span>
          <i
            style={{ backgroundColor: routeMarkerColors.added }}
            aria-hidden="true"
          />
          後加地點
        </span>
        <span aria-live="polite">{markers.length} 個標記</span>
        <span>1 起點 · 2 終點</span>
      </footer>
    </section>
  );
}
