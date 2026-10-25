import { datasetForCoordinate, isInsideOsmCoverage, requireOsmCoverage, type OsmDatasetId } from "./osm-datasets";
import { getOsmDataset } from "./osm-dataset-preference";
import type {
  Coordinate,
  OsmPlaceReference,
  StoredLocation,
} from "./contracts";
import {
  validateCoordinatePair,
  validateStoredLocation,
} from "../database/location.validation";
import { throwIfAborted, withAbort } from "./errors";
import { placeDuplicateReason } from "./place-duplicate";
import "./osm-search.css";
import "../common/SearchableSelect.css";

export interface OsmLocationCandidate {
  id: string;
  name: string;
  address?: string;
  mapsUrl?: string;
  warning?: string;
  location: StoredLocation;
}

export function suggestedOsmLocationName(
  candidate: OsmLocationCandidate,
): string {
  if (candidate.location.source === "osm") return candidate.name;
  const { latitude, longitude } = candidate.location.coordinate;
  return candidate.mapsUrl && candidate.name !== `${latitude}, ${longitude}`
    ? candidate.name
    : "";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serviceBase(): string {
  const configured = import.meta.env.VITE_OSM_SERVICE_URL?.trim();
  if (configured) {
    const url = new URL(configured, window.location.origin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error("OSM 服務必須是沒有帳密的 HTTP/S 網址。");
    }
    return url.href.replace(/\/$/, "");
  }
  if (import.meta.env.DEV) return "/local-map";
  throw new Error(
    "尚未設定 OSM 搜尋／路線服務 VITE_OSM_SERVICE_URL，不會改用 Google。",
  );
}

async function request(
  path: string,
  signal?: AbortSignal,
  payload?: object,
  dataset: OsmDatasetId = getOsmDataset(),
): Promise<unknown> {
  throwIfAborted(signal);
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(serviceBase() + (dataset === 'okinawa' ? '' : `/datasets/${dataset}`) + path, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(payload
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      : {}),
  });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`OSM 服務未回傳有效 JSON（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    throw new Error(
      record(data) && typeof data.error === "string"
        ? data.error
        : `OSM 服務失敗（HTTP ${response.status}）。`,
    );
  }
  return data;
}

function googleMapsUrl(text: string): URL {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); }
  catch { throw new Error("請提供有效的 Google Maps 網址。"); }
  const host = url.hostname.toLowerCase();
  const short = ["maps.app.goo.gl", "goo.gl"].includes(host);
  const google = ["google.com", "google.com.tw", "google.co.jp", "google.co.uk"]
    .some(domain => [domain, `www.${domain}`, `maps.${domain}`].includes(host));
  if ((!short && !google) || !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port ||
    (host === "goo.gl" && !url.pathname.startsWith("/maps/")) ||
    (google && !host.startsWith("maps.") && url.pathname !== "/maps" && !url.pathname.startsWith("/maps/"))) {
    throw new Error("請提供有效的 Google Maps 網址。");
  }
  return url;
}

async function resolveMapUrl(url: URL, signal?: AbortSignal, dataset: OsmDatasetId = getOsmDataset()): Promise<unknown> {
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(
    "https://mapu.retiolus.net/unshortener?" + new URLSearchParams({ link: url.href }),
    { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, credentials: "omit", referrerPolicy: "no-referrer" },
  );
  if (response.status === 429) throw new Error("網址解析服務目前請求過多，請稍後重試。");
  if (!response.ok) throw new Error(`網址解析失敗（HTTP ${response.status}），請稍後重試。`);
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error("網址解析服務未回傳有效 JSON。"); }
  if (!record(data) || typeof data.lat !== "number" || typeof data.long !== "number" ||
    typeof data.name !== "string" || typeof data.full_link !== "string" || typeof data.approximate !== "boolean") {
    throw new Error("網址解析結果格式不正確。");
  }
  validateCoordinatePair(data.lat, data.long);
  return {
    lat: data.lat, lng: data.long, name: data.name, resolved_url: data.full_link,
    inBounds: isInsideOsmCoverage({ latitude: data.lat, longitude: data.long }, dataset),
    locationKind: "url-coordinate", approximate: data.approximate,
  };
}

export function googleMapsNavigationUrl(coordinate: Coordinate): string {
  validateCoordinatePair(coordinate.latitude, coordinate.longitude);
  return `https://www.google.com/maps/dir/?api=1&destination=${coordinate.latitude},${coordinate.longitude}`;
}

export async function searchOsmLocations(
  query: string,
  signal?: AbortSignal,
  dataset: OsmDatasetId = getOsmDataset(),
): Promise<OsmLocationCandidate[]> {
  throwIfAborted(signal);
  const text = query.trim();
  if (!text) return [];
  if (text.length > 500) throw new Error("搜尋內容過長。");
  const coordinate =
    /^([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?)$/.exec(text);
  if (coordinate) {
    const latitude = Number(coordinate[1]),
      longitude = Number(coordinate[2]);
    validateCoordinatePair(latitude, longitude);
    requireOsmCoverage({ latitude, longitude }, dataset);
    return [
      {
        id: `coordinate:${latitude},${longitude}`,
        name: `${latitude}, ${longitude}`,
        location: {
          source: "user",
          kind: "user-picked",
          coordinate: { latitude, longitude },
        },
      },
    ];
  }
  if (
    /^(?:https?:\/\/|(?:www\.)?(?:maps\.)?google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl(?:\/maps)?\b)/i.test(
      text,
    )
  ) {
    const data = await resolveMapUrl(googleMapsUrl(text), signal, dataset);
    if (
      !record(data) ||
      typeof data.lat !== "number" ||
      typeof data.lng !== "number" ||
      typeof data.inBounds !== "boolean" ||
      typeof data.resolved_url !== "string"
    ) {
      throw new Error("Google Maps 網址解析結果格式不正確。");
    }
    validateCoordinatePair(data.lat, data.lng);
    let resolvedUrl: URL;
    try {
      resolvedUrl = new URL(data.resolved_url);
    } catch {
      throw new Error("Google Maps 網址解析結果格式不正確。");
    }
    const allowedHosts = new Set([
      "maps.app.goo.gl",
      "goo.gl",
      "google.com",
      "www.google.com",
      "maps.google.com",
      "google.co.jp",
      "www.google.co.jp",
      "maps.google.co.jp",
      "google.com.tw",
      "www.google.com.tw",
      "maps.google.com.tw",
      "google.co.uk",
      "www.google.co.uk",
      "maps.google.co.uk",
    ]);
    if (
      !["http:", "https:"].includes(resolvedUrl.protocol) ||
      resolvedUrl.username ||
      resolvedUrl.password ||
      !allowedHosts.has(resolvedUrl.hostname.toLowerCase())
    ) {
      throw new Error("Google Maps 網址解析結果格式不正確。");
    }
    requireOsmCoverage({ latitude: data.lat, longitude: data.lng }, dataset);
    if (!data.inBounds) {
      throw new Error(
        typeof data.warning === "string"
          ? data.warning
          : "此位置超出目前 OSM 圖資範圍。",
      );
    }
    const kind = data.approximate === true ? "approximate-center" : "user-picked";
    const name = typeof data.name === "string" ? data.name.trim() : "";
    return [
      {
        id: `google-url:${data.lat},${data.lng}`,
        name: name || `${data.lat}, ${data.lng}`,
        mapsUrl: resolvedUrl.href,
        ...(kind === "approximate-center"
          ? { warning: "解析服務回傳推估位置，請確認地點座標。" }
          : {}),
        location: {
          source: "user",
          kind,
          coordinate: { latitude: data.lat, longitude: data.lng },
        },
      },
    ];
  }
  if (/^[+-]?\d+[.,\d\s，+-]*$/.test(text))
    throw new Error("請輸入「緯度, 經度」，例如 26.2170, 127.7195。");
  const data = await request(
    "/api/search?q=" + encodeURIComponent(text),
    signal,
    undefined,
    dataset,
  );
  if (!record(data) || !Array.isArray(data.results))
    throw new Error("OSM 搜尋資料格式不正確。");
  const candidates = data.results.map((item: unknown): OsmLocationCandidate => {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      !Array.isArray(item.coordinates) ||
      item.coordinates.length !== 2
    )
      throw new Error("OSM 搜尋結果缺少合法的名稱／位置。");
    const match = /^(?:osm-)?(node|way|relation)[/-]([1-9]\d*)$/.exec(item.id);
    if (!match) throw new Error("OSM 搜尋結果缺少完整的物件類型與識別碼。");
    const reference: OsmPlaceReference = {
      provider: "osm",
      id: `${match[1] as "node" | "way" | "relation"}/${match[2]}`,
    };
    const location: StoredLocation = {
      source: "osm",
      kind: reference.id.startsWith("node/") ? "point" : "approximate-center",
      reference,
      coordinate: {
        latitude: item.coordinates[1],
        longitude: item.coordinates[0],
      },
      ...(typeof data.dataTimestamp === "string" && data.dataTimestamp.trim()
        ? { datasetVersion: data.dataTimestamp }
        : {}),
    };
    validateStoredLocation(location);
    requireOsmCoverage(location.coordinate, dataset);
    return {
      id: reference.id,
      name: item.name,
      location,
      ...(typeof item.address === "string" ? { address: item.address } : {}),
    };
  });
  const unique: OsmLocationCandidate[] = [];
  for (const candidate of candidates) {
    if (!unique.some(existing => placeDuplicateReason(candidate, existing))) {
      unique.push(candidate);
    }
  }
  return unique;
}

// Share one route queue across map geometry and time estimates in this tab.
// Bound simultaneous searches; canceled queued requests are skipped before fetching.
let routeQueue: Promise<unknown> = Promise.resolve();
function requestOsmRoute(payload: object, dataset: OsmDatasetId, signal?: AbortSignal): Promise<unknown> {
  const result = routeQueue.then(() => request("/api/route", signal, payload, dataset));
  routeQueue = result.catch(() => undefined);
  return withAbort(result, signal);
}

export async function routeOsmLocations(
  origin: Coordinate,
  destination: Coordinate,
  transport: string,
  signal?: AbortSignal,
  includeGeometry = false,
  dataset?: OsmDatasetId,
): Promise<{ durationMinutes: number; distanceMeters: number; geometry?: Coordinate[][]; approximate?: boolean }> {
  validateCoordinatePair(origin.latitude, origin.longitude);
  validateCoordinatePair(destination.latitude, destination.longitude);
  const mode =
    transport === "DRIVING"
      ? "car"
      : transport === "WALKING"
        ? "walk"
        : transport === "BICYCLING"
          ? "bike"
          : undefined;
  if (!mode)
    throw new Error("OSM 靜態路線僅支援開車、步行或單車；不會改用 Google。");
  if (
    origin.latitude === destination.latitude &&
    origin.longitude === destination.longitude
  )
    throw new Error("起點與終點相同，請選擇不同的位置。");
  const routeDataset = dataset ?? datasetForCoordinate(origin);
  if (!routeDataset) throw new Error("起點超出已支援的 OSM 圖資範圍。");
  requireOsmCoverage(origin, routeDataset);
  requireOsmCoverage(destination, routeDataset);
  const data = await requestOsmRoute({
    points: [
      [origin.longitude, origin.latitude],
      [destination.longitude, destination.latitude],
    ],
    mode,
  }, routeDataset, signal);
  if (
    !record(data) ||
    typeof data.duration !== "number" ||
    !Number.isFinite(data.duration) ||
    data.duration < 0 ||
    typeof data.distance !== "number" ||
    !Number.isFinite(data.distance) ||
    data.distance < 0
  ) {
    throw new Error("OSM 路線回應沒有合法的時間與距離。");
  }
  if (data.duration === 0 || data.distance === 0) {
    throw new Error("OSM 未取得有效的非零路線，請選擇地點出入口或附近道路後重試。");
  }
  let geometry: Coordinate[][] | undefined;
  if (includeGeometry) {
    if (!Array.isArray(data.legs) || !data.legs.length) throw new Error("OSM 路線缺少道路軌跡。");
    geometry = data.legs.map(leg => {
      if (!record(leg) || !record(leg.geometry) || leg.geometry.type !== 'LineString' || !Array.isArray(leg.geometry.coordinates) || leg.geometry.coordinates.length < 2) throw new Error("OSM 道路軌跡格式無效。");
      return leg.geometry.coordinates.map(point => {
        if (!Array.isArray(point) || point.length < 2) throw new Error("OSM 道路座標格式無效。");
        validateCoordinatePair(point[1], point[0]);
        return { latitude: point[1] as number, longitude: point[0] as number };
      });
    });
  }
  return {
    ...(geometry ? { geometry } : {}),
    ...(data.optimal === false ? { approximate: true } : {}),
    durationMinutes: Math.ceil(data.duration / 60),
    distanceMeters: Math.round(data.distance),
  };
}

export async function mountOsmAutocomplete(
  container: HTMLElement,
  onSelect: (candidate: OsmLocationCandidate, query: string) => void,
  _onError: (error: Error) => void,
  options: { label?: string; onInput?: () => void; dataset?: OsmDatasetId } = {},
): Promise<() => void> {
  const dataset = options.dataset ?? getOsmDataset();
  const input = document.createElement("input");
  const results = document.createElement("ul");
  const status = document.createElement("p");
  input.type = "search";
  input.placeholder = "地點名稱, 緯經度, google 地圖連結";
  input.setAttribute("aria-label", options.label ?? "搜尋 OSM 地點");
  input.autocomplete = "off";
  const listId = `osm-results-${crypto.randomUUID()}`;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listId);
  results.id = listId;
  results.className = "osm-search-options";
  results.setAttribute("role", "listbox");
  results.setAttribute("aria-label", options.label ?? "搜尋 OSM 地點");
  results.hidden = true;
  status.setAttribute("role", "status");
  status.className = "osm-search-status";
  status.hidden = true;
  const wrapper = document.createElement("div");
  wrapper.className = "searchable-select";
  wrapper.append(input, results);
  container.classList.add("osm-location-search");
  container.append(wrapper, status);
  let active = true;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;
  let selectedIndex = -1;
  let searching = false;
  function close() {
    results.hidden = true;
    selectedIndex = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function open() {
    if (!results.children.length) return;
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function showMessage(message: string, state: "loading" | "empty" | "error") {
    selectedIndex = -1;
    input.removeAttribute("aria-activedescendant");
    input.setAttribute("aria-busy", String(state === "loading"));
    const row = document.createElement("li");
    row.className = `osm-search-message is-${state}`;
    row.setAttribute("role", "presentation");
    row.setAttribute("aria-disabled", "true");
    row.textContent = message;
    results.replaceChildren(row);
    status.textContent = message;
    status.hidden = false;
    if (document.activeElement === input) open();
  }
  function showSearching() {
    searching = true;
    showMessage("搜尋中...", "loading");
  }
  const search = async (current: number) => {
    const query = input.value.trim();
    if (!query) {
      status.textContent = "";
      return;
    }
    abort = new AbortController();
    showSearching();
    try {
      const candidates = await searchOsmLocations(query, abort.signal, dataset);
      if (!active || current !== revision) return;
      searching = false;
      input.setAttribute("aria-busy", "false");
      status.textContent = "";
      status.hidden = true;
      if (!candidates.length) {
        showMessage("找不到符合的地點，請試試其他名稱。", "empty");
        return;
      }
      results.replaceChildren();
      selectedIndex = -1;
      for (const [index, candidate] of candidates.entries()) {
        const button = document.createElement("li");
        button.id = `${listId}-${index}`;
        button.className = "osm-search-option";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", "false");
        button.textContent = candidate.name;
        button.onmousedown = (event) => event.preventDefault();
        button.onclick = () => {
          if (!active || current !== revision) return;
          input.value = candidate.name;
          close();
          results.replaceChildren();
          status.textContent = "";
          status.hidden = true;
          onSelect(candidate, query);
        };
        results.append(button);
      }
      if (document.activeElement === input) open();
    } catch (cause) {
      if (active && current === revision) {
        searching = false;
        showMessage(cause instanceof Error ? cause.message : "搜尋失敗，請稍後重試。", "error");
        console.error("OSM 地點搜尋失敗", cause);
      }
    }
  };
  input.oninput = () => {
    const current = ++revision;
    clearTimeout(timer);
    abort?.abort();
    results.replaceChildren();
    close();
    status.textContent = "";
    status.hidden = true;
    searching = false;
    input.setAttribute("aria-busy", "false");
    options.onInput?.();
    if (input.value.trim()) {
      showSearching();
      timer = setTimeout(() => void search(current), 300);
    }
  };
  input.onkeydown = (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      ++revision;
      clearTimeout(timer);
      abort?.abort();
      searching = false;
      input.setAttribute("aria-busy", "false");
      results.replaceChildren();
      close();
      status.hidden = true;
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!results.hidden && selectedIndex >= 0) {
        results.querySelectorAll('[role="option"]')
          .item(selectedIndex)
          ?.dispatchEvent(new MouseEvent("click"));
        return;
      }
      clearTimeout(timer);
      abort?.abort();
      results.replaceChildren();
      close();
      void search(++revision);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const choices = Array.from(results.querySelectorAll<HTMLElement>('[role="option"]'));
      if (searching || !choices.length) return;
      open();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      selectedIndex =
        selectedIndex < 0
          ? direction === 1
            ? 0
            : choices.length - 1
          : Math.max(
              0,
              Math.min(choices.length - 1, selectedIndex + direction),
            );
      choices.forEach((element, index) => {
        element.classList.toggle("active", index === selectedIndex);
        element.setAttribute("aria-selected", String(index === selectedIndex));
      });
      const selected = choices[selectedIndex];
      if (selected) {
        input.setAttribute("aria-activedescendant", selected.id);
        selected.scrollIntoView({ block: "nearest" });
      }
    }
  };
  input.onfocus = open;
  input.onblur = close;
  return () => {
    active = false;
    ++revision;
    clearTimeout(timer);
    abort?.abort();
    input.oninput = null;
    input.onkeydown = null;
    input.onfocus = null;
    input.onblur = null;
    wrapper.remove();
    status.remove();
    results.remove();
    container.classList.remove("osm-location-search");
  };
}
