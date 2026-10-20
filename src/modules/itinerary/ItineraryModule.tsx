import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  ItineraryItem,
  Label,
  NewTrip,
  Place,
  Region,
  Trip,
} from "../../database";
import { RouterLink } from "../../router";
import { WorkspaceLayout } from "../../common/WorkspaceLayout";
import { routes } from "../../routes";
import type { LabelTreeNode } from "../label";
import { labelController } from "../label/label.controller";
import { mountGoogleMap } from "../place/google-places.service";
import type {
  GoogleMapHandle,
  GoogleMapMarkerData,
} from "../place/google-places.service";
import { itineraryController as defaultItineraryController } from "./itinerary.controller";
import type { ItineraryController } from "./itinerary.controller";
import type { ItineraryMapData } from "./itinerary-map.service";
import "./ItineraryModule.css";
import { SearchableSelectDialog } from "../../common/SearchableSelectDialog";
import {
  formatTravelDistance,
  transportOptions,
} from "../../common/route-estimate";
import { TripCollaborationPanel } from "./TripCollaborationPanel";
import { useHybridDataRevision } from "../../database/useHybridDataRevision";

type DeleteRouteMapCheck =
  | { tripId: string; status: "loading" }
  | {
      tripId: string;
      status: "ready";
      hasRouteMap: boolean;
      addedPlaceCount: number;
    }
  | { tripId: string; status: "error"; message: string };

interface TripDraft {
  name: string;
  regionId: string;
  startDate: string;
  endDate: string;
}

interface ItemDraft {
  placeId: string;
  date: string;
  arrivalTime: string;
  durationMinutes: string;
  transport: string;
  note: string;
}

const emptyTripDraft: TripDraft = {
  name: "",
  regionId: "",
  startDate: "",
  endDate: "",
};

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toTripDraft(trip: Trip): TripDraft {
  return {
    name: trip.name,
    regionId: trip.regionId,
    startDate: trip.startDate,
    endDate: trip.endDate,
  };
}

function toItemDraft(item: ItineraryItem): ItemDraft {
  return {
    placeId: item.placeId,
    date: item.date,
    arrivalTime: item.arrivalTime ?? "",
    durationMinutes:
      item.durationMinutes === undefined ? "" : String(item.durationMinutes),
    transport: item.transport ?? "",
    note: item.note ?? "",
  };
}

function flattenLabels(nodes: LabelTreeNode[]): Label[] {
  return nodes.flatMap(({ children, ...label }) => [
    label,
    ...flattenLabels(children),
  ]);
}

function getPlaceMapUrl(place: Place): string | undefined {
  if (place.googlePlaceId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.googlePlaceId)}`;
  }
  return place.mapsUrl;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function addMinutesToTime(
  time: string | undefined,
  durationMinutes: number | undefined,
): { time: string; dayOffset: number } | undefined {
  if (!time || durationMinutes === undefined) return undefined;
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  return {
    time: `${String(Math.floor((totalMinutes % 1440) / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`,
    dayOffset: Math.floor(totalMinutes / 1440),
  };
}

function getPreviousReferenceBaseTime(
  item:
    | Pick<ItineraryItem, "arrivalTime" | "travelDurationMinutes">
    | undefined,
): string | undefined {
  if (!item?.arrivalTime) return undefined;

  const autoReference =
    item.travelDurationMinutes !== undefined
      ? addMinutesToTime(item.arrivalTime, item.travelDurationMinutes)
      : undefined;

  return autoReference?.time ?? item.arrivalTime;
}

function getTripDates(trip: Trip): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${trip.endDate}T00:00:00Z`);
  for (
    let current = Date.parse(`${trip.startDate}T00:00:00Z`);
    current <= end;
    current += 86_400_000
  ) {
    dates.push(new Date(current).toISOString().slice(0, 10));
  }
  return dates;
}

function ItineraryModule({
  sharedNavigation,
  controller = defaultItineraryController,
  sourceRevision = "",
  onCollaborationChange,
  sharedTripIds = [],
  sharedSyncBusy = false,
  onRefreshSharedTrips,
}: {
  sharedNavigation?: ReactNode;
  controller?: ItineraryController;
  sourceRevision?: string;
  onCollaborationChange?(tripId?: string): void;
  sharedTripIds?: readonly string[];
  sharedSyncBusy?: boolean;
  onRefreshSharedTrips?(): Promise<void>;
}) {
  const itineraryController = controller;
  const hybridDataRevision = useHybridDataRevision();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string>();
  const [selectedDate, setSelectedDate] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [tripDraft, setTripDraft] = useState<TripDraft>(emptyTripDraft);
  const [itemDraft, setItemDraft] = useState<ItemDraft>({
    placeId: "",
    date: "",
    arrivalTime: "",
    durationMinutes: "",
    transport: "",
    note: "",
  });
  const [creatingTrip, setCreatingTrip] = useState(false);
  const [editingTrip, setEditingTrip] = useState(false);
  const [deleteTripDialogOpen, setDeleteTripDialogOpen] = useState(false);
  const [deleteRouteMapCheck, setDeleteRouteMapCheck] =
    useState<DeleteRouteMapCheck>();
  const [expandedPlaceNotes, setExpandedPlaceNotes] = useState<Set<string>>(
    () => new Set(),
  );
  const [editingItemId, setEditingItemId] = useState<string>();
  const [addingItem, setAddingItem] = useState(false);
  const [loading, setLoading] = useState(true);
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0);
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingSharedTrip, setRefreshingSharedTrip] = useState(false);
  const [calculatingItemId, setCalculatingItemId] = useState<string>();
  const [dayOrderDraftIds, setDayOrderDraftIds] = useState<string[]>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mapData, setMapData] = useState<ItineraryMapData>();
  const [mapDataRegionId, setMapDataRegionId] = useState<string>();
  const [mapError, setMapError] = useState("");
  const [mapErrorRegionId, setMapErrorRegionId] = useState<string>();
  const [mountedMapRegionId, setMountedMapRegionId] = useState<string>();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapHandleRef = useRef<GoogleMapHandle | undefined>(undefined);
  const mapMarkersFittedRef = useRef(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const focusModeTriggerRef = useRef<HTMLButtonElement>(null);
  const focusModeCloseRef = useRef<HTMLButtonElement>(null);
  const placePickerInputRef = useRef<HTMLButtonElement>(null);
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  const deleteRouteMapCheckGeneration = useRef(0);
  const tripSwitcherRef = useRef<HTMLDetailsElement>(null);
  const tripActionsRef = useRef<HTMLDetailsElement>(null);
  const mapToolsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeMenus(event: PointerEvent | KeyboardEvent) {
      for (const ref of [tripSwitcherRef, tripActionsRef, mapToolsRef]) {
        const menu = ref.current;
        if (!menu?.open) continue;
        if (event instanceof KeyboardEvent) {
          if (event.key !== "Escape" || !menu.contains(document.activeElement))
            continue;
          menu.open = false;
          menu.querySelector("summary")?.focus();
        } else if (
          event.target instanceof Node &&
          !menu.contains(event.target)
        ) {
          menu.open = false;
        }
      }
    }
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeMenus);
    };
  }, []);

  function runTripAction(action: () => void) {
    if (tripActionsRef.current) {
      tripActionsRef.current.open = false;
      tripActionsRef.current.querySelector("summary")?.focus();
    }
    action();
  }

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId);
  const canEditItems =
    !selectedTripId ||
    itineraryController.getAccess(selectedTripId) !== "viewer";
  const canManageTrip =
    !selectedTripId ||
    itineraryController.getAccess(selectedTripId) === "owner";
  const selectedTripIdRef = useRef(selectedTripId);
  selectedTripIdRef.current = selectedTripId;
  const selectedRegionId = selectedTrip?.regionId;
  const selectedRegion = regions.find(
    (region) => region.id === selectedRegionId,
  );
  const visibleMapData =
    mapDataRegionId === selectedRegion?.id ? mapData : undefined;
  const visibleMapError =
    mapErrorRegionId === selectedRegion?.id ? mapError : "";
  const mapLoading = Boolean(
    selectedRegion && mapDataRegionId !== selectedRegion.id && !visibleMapError,
  );
  const tripItems = useMemo(
    () => items.filter((item) => item.tripId === selectedTripId),
    [items, selectedTripId],
  );
  const labelsById = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );
  const dayBaseItems = useMemo(
    () =>
      tripItems
        .filter((item) => item.date === selectedDate)
        .sort((left, right) => left.order - right.order),
    [tripItems, selectedDate],
  );
  const dayItems = useMemo(() => {
    if (!dayOrderDraftIds?.length) {
      return dayBaseItems;
    }

    const idSet = new Set(dayBaseItems.map((item) => item.id));
    if (
      dayOrderDraftIds.length !== dayBaseItems.length ||
      dayOrderDraftIds.some((id) => !idSet.has(id))
    ) {
      return dayBaseItems;
    }

    const itemById = new Map(dayBaseItems.map((item) => [item.id, item]));
    return dayOrderDraftIds
      .map((id) => itemById.get(id))
      .filter((item): item is ItineraryItem => Boolean(item));
  }, [dayBaseItems, dayOrderDraftIds]);
  const hasPendingDayReorder = useMemo(() => {
    if (!dayBaseItems.length || !dayItems.length) return false;
    if (dayBaseItems.length !== dayItems.length) return false;
    return dayBaseItems.some((item, index) => item.id !== dayItems[index]?.id);
  }, [dayBaseItems, dayItems]);
  const previousDraftItem = useMemo(() => {
    if (!itemDraft.date) return undefined;
    const sameDateItems = tripItems
      .filter(
        (item) => item.date === itemDraft.date && item.id !== editingItemId,
      )
      .sort((left, right) => left.order - right.order);
    if (!editingItemId) return sameDateItems[sameDateItems.length - 1];

    const editedItem = tripItems.find((item) => item.id === editingItemId);
    if (!editedItem || editedItem.date !== itemDraft.date) {
      return sameDateItems[sameDateItems.length - 1];
    }
    const originalDay = tripItems
      .filter((item) => item.date === editedItem.date)
      .sort((left, right) => left.order - right.order);
    const itemIndex = originalDay.findIndex(
      (item) => item.id === editingItemId,
    );
    return itemIndex > 0 ? originalDay[itemIndex - 1] : undefined;
  }, [editingItemId, itemDraft.date, tripItems]);
  const referenceArrival = addMinutesToTime(
    previousDraftItem
      ? (getPreviousReferenceBaseTime(previousDraftItem) ??
          previousDraftItem.arrivalTime)
      : undefined,
    previousDraftItem?.durationMinutes,
  );
  const tripPlaces = useMemo(
    () =>
      places.filter(
        (place) =>
          selectedTrip && place.regionIds.includes(selectedTrip.regionId),
      ),
    [places, selectedTrip],
  );
  const dayNumber =
    selectedTrip && selectedDate
      ? Math.floor(
          (Date.parse(`${selectedDate}T00:00:00Z`) -
            Date.parse(`${selectedTrip.startDate}T00:00:00Z`)) /
            86_400_000,
        ) + 1
      : 0;
  const totalDays = selectedTrip
    ? Math.floor(
        (Date.parse(`${selectedTrip.endDate}T00:00:00Z`) -
          Date.parse(`${selectedTrip.startDate}T00:00:00Z`)) /
          86_400_000,
      ) + 1
    : 0;
  const tripDates = selectedTrip ? getTripDates(selectedTrip) : [];
  const startEditItem = useCallback(
    (item: ItineraryItem) => {
      if (itineraryController.getAccess(item.tripId) === "viewer") return;
      itineraryController.beginEdit(item.tripId);
      setItemDraft(toItemDraft(item));
      setEditingItemId(item.id);
      setAddingItem(false);
      setError("");
      setNotice("");
    },
    [itineraryController],
  );
  const scheduledPlaceSequence = useMemo(() => {
    const sequence = new Map<string, number>();
    dayItems.forEach((item, index) => {
      if (!sequence.has(item.placeId)) sequence.set(item.placeId, index + 1);
    });
    return sequence;
  }, [dayItems]);
  const googleMapMarkers = useMemo<GoogleMapMarkerData[]>(
    () =>
      (visibleMapData?.markers ?? []).map((marker) => {
        const matchingItem = dayItems.find(
          (item) => item.placeId === marker.id,
        );
        return {
          ...marker,
          sequence: scheduledPlaceSequence.get(marker.id),
          ...(matchingItem
            ? { onClick: () => startEditItem(matchingItem) }
            : {}),
        };
      }),
    [dayItems, scheduledPlaceSequence, startEditItem, visibleMapData],
  );

  async function refreshWorkspace(preferredTripId = selectedTripId) {
    const [workspace, labelTree] = await Promise.all([
      itineraryController.loadWorkspace(preferredTripId),
      labelController.listTree(),
    ]);
    setTrips(workspace.trips);
    setRegions(workspace.regions);
    setPlaces(workspace.places);
    setLabels(flattenLabels(labelTree));
    const nextTrip =
      workspace.trips.find((trip) => trip.id === preferredTripId) ??
      workspace.trips[0];
    setSelectedTripId(nextTrip?.id);
    if (nextTrip) {
      setTripDraft(toTripDraft(nextTrip));
      setSelectedDate((current) =>
        current >= nextTrip.startDate && current <= nextTrip.endDate
          ? current
          : nextTrip.startDate,
      );
    } else {
      setItems([]);
      setSelectedDate("");
    }
  }

  const hasOpenDraft =
    creatingTrip ||
    editingTrip ||
    addingItem ||
    editingItemId !== undefined ||
    hasPendingDayReorder;

  useEffect(() => {
    if (hasOpenDraft || saving || calculatingItemId || refreshingSharedTrip)
      return;
    let active = true;
    Promise.all([
      itineraryController.loadWorkspace(selectedTripIdRef.current),
      labelController.listTree(),
    ])
      .then(([workspace, labelTree]) => {
        if (!active) return;
        setWorkspaceLoadFailed(false);
        setTrips(workspace.trips);
        setRegions(workspace.regions);
        setPlaces(workspace.places);
        setLabels(flattenLabels(labelTree));
        const nextTrip =
          workspace.trips.find(
            (trip) => trip.id === selectedTripIdRef.current,
          ) ?? workspace.trips[0];
        setSelectedTripId(nextTrip?.id);
        setTripDraft(nextTrip ? toTripDraft(nextTrip) : emptyTripDraft);
        setSelectedDate((current) =>
          nextTrip
            ? current >= nextTrip.startDate && current <= nextTrip.endDate
              ? current
              : nextTrip.startDate
            : "",
        );
        if (!nextTrip) setItems([]);
      })
      .catch((cause: unknown) => {
        if (active) {
          setWorkspaceLoadFailed(true);
          setError(
            cause instanceof Error ? cause.message : "載入行程資料失敗。",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    workspaceReloadKey,
    itineraryController,
    sourceRevision,
    selectedTripId,
    hasOpenDraft,
    saving,
    calculatingItemId,
    refreshingSharedTrip,
    hybridDataRevision,
  ]);

  useEffect(() => {
    if (!selectedTripId) {
      return;
    }
    let active = true;
    itineraryController
      .listItems(selectedTripId)
      .then((nextItems) => {
        if (active) setItems(nextItems);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "載入每日行程失敗。",
          );
      });
    return () => {
      active = false;
    };
  }, [selectedTripId, trips, itineraryController]);

  useEffect(() => {
    setDayOrderDraftIds(undefined);
  }, [selectedTripId, selectedDate]);

  useEffect(() => {
    if (!addingItem || !selectedTripId) return;
    const tripId = selectedTripId;
    let active = true;

    async function refreshAvailablePlaces() {
      try {
        const [workspace, labelTree, nextItems] = await Promise.all([
          itineraryController.loadWorkspace(tripId),
          labelController.listTree(),
          itineraryController.listItems(tripId),
        ]);
        if (!active) return;
        setPlaces(workspace.places);
        setRegions(workspace.regions);
        setTrips(workspace.trips);
        setLabels(flattenLabels(labelTree));
        setItems(nextItems);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "重新載入地點清單失敗。",
          );
        }
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshAvailablePlaces();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [addingItem, selectedTripId, itineraryController]);

  useEffect(() => {
    if (!hasOpenDraft) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasOpenDraft]);

  useEffect(() => {
    if (!deleteTripDialogOpen || saving) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        deleteRouteMapCheckGeneration.current += 1;
        setDeleteTripDialogOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteTripDialogOpen, saving]);

  useEffect(() => {
    if (!focusMode) {
      focusModeTriggerRef.current?.focus();
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    focusModeCloseRef.current?.focus();

    function handleFocusModeKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFocusMode(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        workspaceRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable?.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleFocusModeKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleFocusModeKeyDown);
    };
  }, [focusMode]);

  const mapSourceKey = JSON.stringify([
    selectedRegion,
    places
      .filter(
        (place) =>
          selectedRegionId && place.regionIds.includes(selectedRegionId),
      )
      .map(({ id, name, googlePlaceId, mapsUrl, icon }) => ({
        id,
        name,
        googlePlaceId,
        mapsUrl,
        icon,
      })),
  ]);

  useEffect(() => {
    if (!selectedRegionId) return;
    const regionId = selectedRegionId;
    let active = true;
    itineraryController
      .loadMapData(regionId, selectedTripId)
      .then((nextMapData) => {
        if (!active) return;
        setMapData(nextMapData);
        setMapDataRegionId(regionId);
        setMapError("");
        setMapErrorRegionId(undefined);
      })
      .catch((cause: unknown) => {
        if (active) {
          setMapData(undefined);
          setMapDataRegionId(regionId);
          setMapErrorRegionId(regionId);
          setMapError(
            cause instanceof Error ? cause.message : "載入區域地圖資料失敗。",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [selectedRegionId, selectedTripId, mapSourceKey, itineraryController]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !visibleMapData) return;
    let active = true;
    let handle: GoogleMapHandle | undefined;
    mountGoogleMap(container, {
      center: visibleMapData.center,
      zoom: visibleMapData.zoom,
      ...(visibleMapData.viewport ? { viewport: visibleMapData.viewport } : {}),
    })
      .then((mapHandle) => {
        if (!active) {
          mapHandle.destroy();
          return;
        }
        handle = mapHandle;
        mapHandleRef.current = mapHandle;
        mapMarkersFittedRef.current = false;
        setMountedMapRegionId(visibleMapData.regionId);
      })
      .catch((cause: unknown) => {
        if (active) {
          setMapErrorRegionId(visibleMapData.regionId);
          setMapError(
            cause instanceof Error ? cause.message : "Google 地圖無法載入。",
          );
        }
      });
    return () => {
      active = false;
      handle?.destroy();
      if (mapHandleRef.current === handle) mapHandleRef.current = undefined;
    };
  }, [visibleMapData]);

  useEffect(() => {
    if (mountedMapRegionId === visibleMapData?.regionId) {
      const fitBounds =
        !mapMarkersFittedRef.current && googleMapMarkers.length > 0;
      mapHandleRef.current?.setMarkers(googleMapMarkers, { fitBounds });
      if (fitBounds) mapMarkersFittedRef.current = true;
    }
  }, [googleMapMarkers, mountedMapRegionId, visibleMapData?.regionId]);

  function selectTrip(trip: Trip) {
    if (
      hasOpenDraft &&
      !window.confirm("目前有未儲存的變更，切換行程後會遺失。要繼續嗎？")
    ) {
      return;
    }
    setSelectedTripId(trip.id);
    setSelectedDate(trip.startDate);
    setTripDraft(toTripDraft(trip));
    setCreatingTrip(false);
    setEditingTrip(false);
    setAddingItem(false);
    setEditingItemId(undefined);
    setExpandedPlaceNotes(new Set());
    setError("");
    setNotice("");
  }

  function startCreateTrip() {
    const firstRegion = regions[0];
    const today = localDateString();
    setSelectedTripId(undefined);
    setTripDraft({
      name: "",
      regionId: firstRegion?.id ?? "",
      startDate: today,
      endDate: today,
    });
    setCreatingTrip(true);
    setEditingTrip(true);
    setAddingItem(false);
    setEditingItemId(undefined);
    setError("");
    setNotice("");
  }

  function startEditTrip() {
    if (!selectedTrip) return;
    setTripDraft(toTripDraft(selectedTrip));
    setEditingTrip(true);
    setCreatingTrip(false);
    setAddingItem(false);
    setEditingItemId(undefined);
    setError("");
    setNotice("");
  }

  function cancelTripEdit() {
    setEditingTrip(false);
    setCreatingTrip(false);
    setError("");
    setTripDraft(selectedTrip ? toTripDraft(selectedTrip) : emptyTripDraft);
  }

  async function handleTripSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const input: NewTrip = {
      name: tripDraft.name.trim(),
      regionId: tripDraft.regionId,
      startDate: tripDraft.startDate,
      endDate: tripDraft.endDate,
    };
    try {
      const id = creatingTrip
        ? await itineraryController.createTrip(input)
        : selectedTripId
          ? (await itineraryController.updateTrip(selectedTripId, input),
            selectedTripId)
          : undefined;
      await refreshWorkspace(id);
      setCreatingTrip(false);
      setEditingTrip(false);
      setNotice(creatingTrip ? "行程已建立。" : "行程變更已儲存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "儲存行程失敗。");
    } finally {
      setSaving(false);
    }
  }

  function closeDeleteTripDialog() {
    deleteRouteMapCheckGeneration.current += 1;
    setDeleteTripDialogOpen(false);
  }

  function openDeleteTripDialog() {
    if (!selectedTrip) return;
    const tripId = selectedTrip.id;
    const generation = ++deleteRouteMapCheckGeneration.current;
    setError("");
    setDeleteRouteMapCheck({ tripId, status: "loading" });
    setDeleteTripDialogOpen(true);
    void itineraryController
      .getTripRouteMapSummary(tripId)
      .then((summary) => {
        if (deleteRouteMapCheckGeneration.current === generation) {
          setDeleteRouteMapCheck({ tripId, status: "ready", ...summary });
        }
      })
      .catch((cause: unknown) => {
        if (deleteRouteMapCheckGeneration.current === generation) {
          setDeleteRouteMapCheck({
            tripId,
            status: "error",
            message:
              cause instanceof Error ? cause.message : "讀取試算地圖資料失敗。",
          });
        }
      });
  }

  async function handleDeleteTrip() {
    if (
      !selectedTrip ||
      saving ||
      deleteRouteMapCheck?.tripId !== selectedTrip.id ||
      deleteRouteMapCheck.status !== "ready"
    )
      return;
    const deletingTrip = selectedTrip;
    const routeMapSummary = deleteRouteMapCheck;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await itineraryController.deleteTrip(deletingTrip.id);
      setDeleteTripDialogOpen(false);
      await refreshWorkspace();
      setNotice(
        routeMapSummary.hasRouteMap
          ? `行程「${deletingTrip.name}」、每日安排及試算地圖（含 ${routeMapSummary.addedPlaceCount} 個後加標記）已刪除。`
          : `行程「${deletingTrip.name}」及其行程項目已刪除。`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "刪除行程失敗。");
    } finally {
      setSaving(false);
    }
  }

  function startAddItem() {
    if (!selectedTripId || !canEditItems) return;
    itineraryController.beginEdit(selectedTripId);
    setItemDraft({
      placeId: "",
      date: selectedDate,
      arrivalTime: "",
      durationMinutes: "",
      transport: "",
      note: "",
    });
    setAddingItem(true);
    setEditingItemId(undefined);
    setEditingTrip(false);
    setError("");
    setNotice("");
  }

  function cancelItemEdit() {
    setAddingItem(false);
    setEditingItemId(undefined);
    setError("");
  }

  async function handleItemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTripId) return;
    if (!itemDraft.placeId) {
      setError("請從搜尋結果中選擇地點。");
      placePickerInputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const changes = {
      placeId: itemDraft.placeId,
      date: itemDraft.date,
      ...(itemDraft.arrivalTime
        ? { arrivalTime: itemDraft.arrivalTime }
        : { arrivalTime: undefined }),
      ...(itemDraft.durationMinutes
        ? { durationMinutes: Number(itemDraft.durationMinutes) }
        : { durationMinutes: undefined }),
      ...(itemDraft.transport.trim()
        ? { transport: itemDraft.transport.trim() }
        : { transport: undefined }),
      ...(itemDraft.note.trim()
        ? { note: itemDraft.note.trim() }
        : { note: undefined }),
    };
    try {
      if (editingItemId) {
        const oldItem = items.find((item) => item.id === editingItemId);
        await itineraryController.updateItem(editingItemId, {
          ...changes,
          ...(oldItem?.date !== itemDraft.date
            ? {
                order:
                  tripItems
                    .filter((item) => item.date === itemDraft.date)
                    .reduce(
                      (maximum, item) => Math.max(maximum, item.order),
                      -1,
                    ) + 1,
              }
            : {}),
        });
      } else {
        await itineraryController.addItem({
          tripId: selectedTripId,
          ...changes,
        });
      }
      setItems(await itineraryController.listItems(selectedTripId));
      setDayOrderDraftIds(undefined);
      setSelectedDate(itemDraft.date);
      setAddingItem(false);
      setEditingItemId(undefined);
      await refreshWorkspace(selectedTripId);
      setNotice(editingItemId ? "行程項目已更新。" : "地點已加入每日行程。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "儲存行程項目失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteItem(item: ItineraryItem) {
    itineraryController.beginEdit(item.tripId);
    const placeName =
      places.find((place) => place.id === item.placeId)?.name ?? "此地點";
    if (!window.confirm(`確定要從行程中移除「${placeName}」嗎？`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await itineraryController.deleteItem(item.id);
      setItems(await itineraryController.listItems(item.tripId));
      setDayOrderDraftIds(undefined);
      setNotice(`已從行程移除「${placeName}」。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移除行程項目失敗。");
    } finally {
      setSaving(false);
    }
  }

  function togglePlaceNote(itemId: string) {
    setExpandedPlaceNotes((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function handleCalculateTravelDuration(item: ItineraryItem) {
    if (!selectedTripId) return;
    itineraryController.beginEdit(item.tripId);
    setCalculatingItemId(item.id);
    setError("");
    setNotice("");
    try {
      const estimate = await itineraryController.calculateTravelDuration(
        item.id,
      );
      setItems(await itineraryController.listItems(selectedTripId));
      setDayOrderDraftIds(undefined);
      setNotice(
        `已計算並儲存路程：約 ${estimate.durationMinutes} 分鐘 · ${formatTravelDistance(estimate.distanceMeters)}。`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "計算路程失敗。");
    } finally {
      setCalculatingItemId(undefined);
    }
  }

  function moveItem(item: ItineraryItem, direction: -1 | 1) {
    if (!canEditItems) return;
    if (!hasPendingDayReorder) itineraryController.beginEdit(item.tripId);
    const index = dayItems.findIndex((candidate) => candidate.id === item.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= dayItems.length) return;
    const orderedIds = dayItems.map((candidate) => candidate.id);
    [orderedIds[index], orderedIds[targetIndex]] = [
      orderedIds[targetIndex],
      orderedIds[index],
    ];

    setDayOrderDraftIds(orderedIds);
    setNotice("已暫存順序變更，記得按「儲存排序」。");
  }

  async function saveDayReorder() {
    if (!selectedTripId || !hasPendingDayReorder) return;
    setSaving(true);
    setError("");
    setNotice("");

    try {
      await itineraryController.reorderItems(
        selectedTripId,
        selectedDate,
        dayItems.map((item) => item.id),
      );
      setItems(await itineraryController.listItems(selectedTripId));
      setDayOrderDraftIds(undefined);
      setNotice("當日順序已儲存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "調整地點順序失敗。");
    } finally {
      setSaving(false);
    }
  }

  function cancelDayReorder() {
    setDayOrderDraftIds(undefined);
    setNotice("");
    setError("");
  }

  function changeSelectedDate(date: string) {
    if (
      hasPendingDayReorder &&
      date !== selectedDate &&
      !window.confirm("目前有未儲存的排序變更，切換日期後會遺失。要繼續嗎？")
    ) {
      return;
    }
    setSelectedDate(date);
    setDayOrderDraftIds(undefined);
    setAddingItem(false);
    setEditingItemId(undefined);
    setError("");
    setNotice("");
  }

  const activeItemId = editingItemId;
  const itemFormVisible = addingItem || activeItemId !== undefined;
  const interactionBusy =
    saving || calculatingItemId !== undefined || refreshingSharedTrip;

  async function refreshSharedTrip() {
    if (
      !selectedTripId ||
      !onRefreshSharedTrips ||
      interactionBusy ||
      sharedSyncBusy ||
      hasOpenDraft ||
      collaborationOpen ||
      deleteTripDialogOpen
    )
      return;
    setRefreshingSharedTrip(true);
    setError("");
    setNotice("");
    try {
      await onRefreshSharedTrips();
      setWorkspaceReloadKey((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "重新載入協作行程失敗。",
      );
    } finally {
      setRefreshingSharedTrip(false);
    }
  }

  return (
    <WorkspaceLayout
      active="itinerary"
      shellClassName="itinerary-app-shell"
      mainClassName="itinerary-main"
    >
      {sharedNavigation}
      {placePickerOpen && itemFormVisible && (
        <SearchableSelectDialog
          label="地點"
          options={tripPlaces}
          value={itemDraft.placeId}
          onChange={(placeId) => {
            setItemDraft((current) => ({ ...current, placeId }));
            setError("");
          }}
          onClose={() => {
            setPlacePickerOpen(false);
            placePickerInputRef.current?.focus();
          }}
        />
      )}
      {collaborationOpen && (
        <TripCollaborationPanel
          preferredTripId={selectedTripId}
          onClose={(tripId) => {
            setCollaborationOpen(false);
            setWorkspaceReloadKey((value) => value + 1);
            onCollaborationChange?.(tripId ?? selectedTripId);
          }}
        />
      )}
      <div className="itinerary-content">
        <section className="itinerary-heading">
          <div className="workspace-page-heading-title">
            {trips.length > 1 && !editingTrip && !creatingTrip ? (
              <details
                className="itinerary-trip-switcher"
                ref={tripSwitcherRef}
              >
                <summary
                  aria-label={`切換行程，目前為${selectedTrip?.name ?? "尚未選取"}`}
                >
                  <h1>{selectedTrip?.name ?? "選擇行程"}</h1>
                  <svg
                    className="itinerary-menu-chevron"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path d="m4 6 4 4 4-4" />
                  </svg>
                </summary>
                <div
                  className="itinerary-dropdown itinerary-trip-options"
                  aria-label="切換行程"
                >
                  <div className="itinerary-dropdown-heading">你的行程</div>
                  {trips.map((trip) => (
                    <button
                      key={trip.id}
                      type="button"
                      className="itinerary-trip-option"
                      aria-current={
                        trip.id === selectedTripId ? "true" : undefined
                      }
                      disabled={interactionBusy}
                      onClick={() => {
                        if (tripSwitcherRef.current) {
                          tripSwitcherRef.current.open = false;
                          tripSwitcherRef.current
                            .querySelector("summary")
                            ?.focus();
                        }
                        selectTrip(trip);
                      }}
                    >
                      <span>
                        <strong>{trip.name}</strong>
                        <small>
                          {trip.startDate} — {trip.endDate}
                        </small>
                      </span>
                      {trip.id === selectedTripId && (
                        <span aria-hidden="true">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </details>
            ) : (
              <h1>
                {selectedTrip?.name ??
                  (creatingTrip ? "新增行程" : "開始規劃一趟旅行")}
              </h1>
            )}
            {selectedTrip && (
              <p>
                {selectedTrip.startDate} — {selectedTrip.endDate} <i />{" "}
                {totalDays} 天
              </p>
            )}
          </div>
          <div className="itinerary-heading-actions">
            {selectedTripId &&
              sharedTripIds.includes(selectedTripId) &&
              onRefreshSharedTrips && (
                <button
                  type="button"
                  className="itinerary-secondary itinerary-refresh"
                  aria-label={
                    refreshingSharedTrip
                      ? "正在重新整理協作行程"
                      : "重新整理協作行程"
                  }
                  aria-busy={refreshingSharedTrip}
                  title={
                    hasOpenDraft
                      ? "請先儲存或取消編輯，再重新整理"
                      : "重新整理協作行程"
                  }
                  disabled={
                    loading ||
                    interactionBusy ||
                    sharedSyncBusy ||
                    hasOpenDraft ||
                    collaborationOpen ||
                    deleteTripDialogOpen
                  }
                  onClick={() => void refreshSharedTrip()}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 7v5h-5M4 17v-5h5" />
                    <path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" />
                  </svg>
                </button>
              )}
            <details className="itinerary-action-menu" ref={tripActionsRef}>
              <summary className="itinerary-secondary">
                行程操作
                <svg
                  className="itinerary-menu-chevron"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </summary>
              <div className="itinerary-dropdown itinerary-action-options">
                <button
                  type="button"
                  disabled={interactionBusy}
                  onClick={() => runTripAction(startCreateTrip)}
                >
                  ＋ 新增行程
                </button>
                <hr />
                <button
                  type="button"
                  disabled={interactionBusy}
                  onClick={() =>
                    runTripAction(() => setCollaborationOpen(true))
                  }
                >
                  協作管理
                </button>
                {selectedTrip && canManageTrip && !editingTrip && (
                  <>
                    <button
                      type="button"
                      disabled={interactionBusy}
                      onClick={() => runTripAction(startEditTrip)}
                    >
                      編輯行程
                    </button>
                    <hr />
                    <button
                      type="button"
                      className="itinerary-action-danger"
                      disabled={interactionBusy}
                      onClick={() => runTripAction(openDeleteTripDialog)}
                    >
                      刪除行程
                    </button>
                  </>
                )}
              </div>
            </details>
          </div>
        </section>
        {error && !deleteTripDialogOpen && (
          <div className="itinerary-feedback itinerary-error" role="alert">
            {error}
            {workspaceLoadFailed && (
              <button
                type="button"
                className="itinerary-secondary"
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  setError("");
                  setWorkspaceLoadFailed(false);
                  setWorkspaceReloadKey((value) => value + 1);
                }}
              >
                重新載入
              </button>
            )}
          </div>
        )}
        {notice && (
          <div className="itinerary-feedback itinerary-success" role="status">
            {notice}
          </div>
        )}

        <section
          ref={workspaceRef}
          className={
            focusMode
              ? "itinerary-workspace itinerary-workspace-focused"
              : "itinerary-workspace"
          }
          role={focusMode ? "dialog" : undefined}
          aria-modal={focusMode ? true : undefined}
          aria-label={focusMode ? "當日行程專注檢視" : undefined}
          tabIndex={focusMode ? -1 : undefined}
        >
          <aside className="itinerary-plan-card">
            {focusMode && error && !deleteTripDialogOpen && (
              <div className="itinerary-feedback itinerary-error" role="alert">
                {error}
              </div>
            )}
            {focusMode && notice && (
              <div
                className="itinerary-feedback itinerary-success"
                role="status"
              >
                {notice}
              </div>
            )}
            {editingTrip ? (
              <form
                className="itinerary-trip-form"
                onSubmit={(event) => void handleTripSubmit(event)}
              >
                <div className="itinerary-detail-heading">
                  <div>
                    <span>
                      {creatingTrip ? "開始一趟新旅行" : "調整行程設定"}
                    </span>
                    <h2>{creatingTrip ? "新增行程" : "編輯行程"}</h2>
                  </div>
                </div>
                {regions.length ? (
                  <>
                    <label className="itinerary-field itinerary-field-wide">
                      <span>
                        行程名稱 <b>*</b>
                      </span>
                      <input
                        autoFocus
                        value={tripDraft.name}
                        onChange={(event) =>
                          setTripDraft({
                            ...tripDraft,
                            name: event.target.value,
                          })
                        }
                        maxLength={100}
                        placeholder="例如：京都慢遊"
                        required
                        disabled={saving}
                      />
                    </label>
                    <label className="itinerary-field itinerary-field-wide">
                      <span>
                        所屬區域 <b>*</b>
                      </span>
                      <select
                        value={tripDraft.regionId}
                        onChange={(event) =>
                          setTripDraft({
                            ...tripDraft,
                            regionId: event.target.value,
                          })
                        }
                        required
                        disabled={saving}
                      >
                        <option value="" disabled>
                          選擇區域
                        </option>
                        {regions.map((region) => (
                          <option value={region.id} key={region.id}>
                            {region.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="itinerary-field-grid">
                      <label className="itinerary-field">
                        <span>
                          開始日期 <b>*</b>
                        </span>
                        <input
                          type="date"
                          value={tripDraft.startDate}
                          onChange={(event) =>
                            setTripDraft({
                              ...tripDraft,
                              startDate: event.target.value,
                            })
                          }
                          required
                          disabled={saving}
                        />
                      </label>
                      <label className="itinerary-field">
                        <span>
                          結束日期 <b>*</b>
                        </span>
                        <input
                          type="date"
                          min={tripDraft.startDate}
                          value={tripDraft.endDate}
                          onChange={(event) =>
                            setTripDraft({
                              ...tripDraft,
                              endDate: event.target.value,
                            })
                          }
                          required
                          disabled={saving}
                        />
                      </label>
                    </div>
                    <div className="itinerary-form-actions">
                      <button
                        type="button"
                        className="itinerary-secondary"
                        disabled={saving}
                        onClick={cancelTripEdit}
                      >
                        取消
                      </button>
                      <button
                        type="submit"
                        className="itinerary-primary"
                        disabled={saving || !tripDraft.name.trim()}
                      >
                        {saving
                          ? "儲存中…"
                          : creatingTrip
                            ? "建立行程"
                            : "儲存變更"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="itinerary-no-regions">
                    <strong>建立行程前，需要先有一個區域。</strong>
                    <p>
                      區域可代表城市或旅行目的地；建立後即可選擇它來建立行程。
                    </p>
                    <div className="itinerary-no-regions-actions">
                      <RouterLink
                        className="itinerary-primary itinerary-link-button"
                        to={routes.regions}
                      >
                        前往區域
                      </RouterLink>
                      <button
                        type="button"
                        className="itinerary-secondary"
                        onClick={cancelTripEdit}
                      >
                        返回
                      </button>
                    </div>
                  </div>
                )}
              </form>
            ) : selectedTrip ? (
              <>
                <div className="itinerary-plan-title">
                  <div>
                    <span>每日行程</span>
                    <strong>
                      第 {dayNumber} 天 <small>・{selectedRegion?.name}</small>
                    </strong>
                  </div>
                  <div className="itinerary-plan-title-actions">
                    <span className="itinerary-day-count">
                      {formatDate(selectedDate)} · {totalDays} 天
                    </span>
                    {(focusMode || (!itemFormVisible && !editingTrip)) && (
                      <button
                        ref={
                          focusMode ? focusModeCloseRef : focusModeTriggerRef
                        }
                        type="button"
                        className="itinerary-focus-toggle"
                        aria-label={
                          focusMode ? "離開當日專注模式" : "進入當日專注模式"
                        }
                        title={
                          focusMode
                            ? "離開當日專注模式"
                            : "專注查看當日行程與地圖"
                        }
                        onClick={() => setFocusMode((current) => !current)}
                      >
                        {focusMode ? (
                          <>
                            <span aria-hidden="true">↙</span>
                            <span className="itinerary-focus-toggle-label">
                              返回
                            </span>
                          </>
                        ) : (
                          <svg
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                </div>
                <div className="itinerary-day-strip" aria-label="選擇行程日期">
                  {tripDates.map((date, index) => (
                    <button
                      type="button"
                      key={date}
                      className={date === selectedDate ? "selected" : ""}
                      aria-pressed={date === selectedDate}
                      onClick={() => changeSelectedDate(date)}
                    >
                      <small>
                        {new Intl.DateTimeFormat("zh-TW", {
                          weekday: "short",
                          timeZone: "UTC",
                        }).format(new Date(`${date}T00:00:00Z`)) ||
                          `DAY ${index + 1}`}
                      </small>
                      <strong>{date.slice(8, 10)}</strong>
                    </button>
                  ))}
                </div>

                {itemFormVisible && (
                  <form
                    className="itinerary-item-form"
                    onSubmit={(event) => void handleItemSubmit(event)}
                  >
                    <div className="itinerary-form-title">
                      <strong>
                        {addingItem ? "將地點加入行程" : "編輯每日項目"}
                      </strong>
                      <button
                        type="button"
                        aria-label="關閉"
                        onClick={cancelItemEdit}
                      >
                        ×
                      </button>
                    </div>
                    {tripPlaces.length ? (
                      <>
                        <div className="itinerary-field-grid">
                          <div className="itinerary-field itinerary-place-field">
                            <label htmlFor="itinerary-place-search">
                              地點 <b>*</b>
                            </label>
                            <div className="itinerary-place-picker">
                              <div className="itinerary-place-picker-row">
                                <button
                                  key={editingItemId ?? "new-item"}
                                  ref={placePickerInputRef}
                                  id="itinerary-place-search"
                                  type="button"
                                  className="itinerary-place-select-trigger"
                                  aria-label="選擇地點"
                                  aria-haspopup="dialog"
                                  disabled={saving}
                                  autoFocus
                                  onClick={() => setPlacePickerOpen(true)}
                                >
                                  <span>
                                    {tripPlaces.find(
                                      (place) => place.id === itemDraft.placeId,
                                    )?.name ?? "搜尋或選擇地點"}
                                  </span>
                                  <span aria-hidden="true">⌄</span>
                                </button>
                                <a
                                  className="itinerary-add-place-link"
                                  href={`${routes.places}?create=1`}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label="在新分頁新增地點"
                                  title="在新分頁新增地點"
                                >
                                  <span aria-hidden="true">＋</span>
                                  地點
                                </a>
                              </div>
                            </div>
                          </div>
                          <label className="itinerary-field">
                            <span>
                              日期 <b>*</b>
                            </span>
                            <input
                              type="date"
                              min={selectedTrip.startDate}
                              max={selectedTrip.endDate}
                              value={itemDraft.date}
                              onChange={(event) =>
                                setItemDraft({
                                  ...itemDraft,
                                  date: event.target.value,
                                })
                              }
                              required
                              disabled={saving}
                            />
                          </label>
                          <label className="itinerary-field">
                            <span>預計抵達時間</span>
                            <input
                              type="time"
                              value={itemDraft.arrivalTime}
                              onChange={(event) =>
                                setItemDraft({
                                  ...itemDraft,
                                  arrivalTime: event.target.value,
                                })
                              }
                              disabled={saving}
                            />
                          </label>
                          <label className="itinerary-field">
                            <span>參考抵達時間</span>
                            <input
                              type="text"
                              value={
                                referenceArrival
                                  ? `${referenceArrival.time}${referenceArrival.dayOffset ? `（翌日 +${referenceArrival.dayOffset} 天）` : ""}`
                                  : ""
                              }
                              placeholder={
                                previousDraftItem?.arrivalTime
                                  ? "請先計算路程時間"
                                  : "上一站尚未填寫預計抵達時間"
                              }
                              readOnly
                              aria-readonly="true"
                            />
                            <small>
                              依上一站的抵達時間／參考時間加上停留時間推算，僅供參考。
                            </small>
                          </label>
                          <label className="itinerary-field">
                            <span>停留時間（分鐘）</span>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={itemDraft.durationMinutes}
                              onChange={(event) =>
                                setItemDraft({
                                  ...itemDraft,
                                  durationMinutes: event.target.value,
                                })
                              }
                              placeholder="例如：90"
                              disabled={saving}
                            />
                          </label>
                          <label className="itinerary-field itinerary-field-wide">
                            <span>交通</span>
                            <select
                              value={itemDraft.transport}
                              onChange={(event) =>
                                setItemDraft({
                                  ...itemDraft,
                                  transport: event.target.value,
                                })
                              }
                              disabled={interactionBusy}
                            >
                              <option value="">選擇前往方式</option>
                              {itemDraft.transport &&
                                !transportOptions.some(
                                  (option) =>
                                    option.value === itemDraft.transport,
                                ) && (
                                  <option value={itemDraft.transport}>
                                    舊資料：{itemDraft.transport}
                                  </option>
                                )}
                              {transportOptions.map((option) => (
                                <option value={option.value} key={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <small>
                              此方式用於計算「上一站到這一站」的參考時間與距離。
                            </small>
                          </label>
                          <label className="itinerary-field itinerary-field-wide">
                            <span>備註</span>
                            <textarea
                              rows={3}
                              value={itemDraft.note}
                              onChange={(event) =>
                                setItemDraft({
                                  ...itemDraft,
                                  note: event.target.value,
                                })
                              }
                              maxLength={1000}
                              placeholder="預約資訊、想做的事…"
                              disabled={saving}
                            />
                          </label>
                        </div>
                        <div className="itinerary-form-actions">
                          <button
                            type="button"
                            className="itinerary-secondary"
                            disabled={saving}
                            onClick={cancelItemEdit}
                          >
                            取消
                          </button>
                          <button
                            type="submit"
                            className="itinerary-primary"
                            disabled={saving || !itemDraft.placeId}
                          >
                            {saving
                              ? "儲存中…"
                              : addingItem
                                ? "加入行程"
                                : "儲存項目"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="itinerary-no-places">
                        <p>目前沒有歸入「{selectedRegion?.name}」的地點。</p>
                        <a
                          href={`${routes.places}?create=1`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          前往地點模組新增地點並設定所屬區域。
                        </a>
                      </div>
                    )}
                  </form>
                )}

                {!itemFormVisible && (
                  <>
                    <div className="itinerary-items-heading">
                      <div>
                        <h3>當日安排</h3>
                        <span>{dayItems.length} 個地點</span>
                      </div>
                      <div className="itinerary-items-actions">
                        {hasPendingDayReorder && (
                          <>
                            <button
                              type="button"
                              className="itinerary-secondary"
                              disabled={interactionBusy || itemFormVisible}
                              onClick={cancelDayReorder}
                            >
                              取消排序
                            </button>
                            <button
                              type="button"
                              className="itinerary-primary"
                              disabled={interactionBusy || itemFormVisible}
                              onClick={() => void saveDayReorder()}
                            >
                              儲存排序
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="itinerary-add-button"
                          disabled={
                            interactionBusy || itemFormVisible || !canEditItems
                          }
                          onClick={startAddItem}
                        >
                          ＋地點
                        </button>
                      </div>
                    </div>
                    <div className="itinerary-items-scroll">
                      {dayItems.length ? (
                        <ol className="itinerary-item-list">
                          {dayItems.map((item, index) => {
                            const place = places.find(
                              (candidate) => candidate.id === item.placeId,
                            );
                            const previousItem = dayItems[index - 1];
                            const previousPlace = previousItem
                              ? places.find(
                                  (candidate) =>
                                    candidate.id === previousItem.placeId,
                                )
                              : undefined;
                            const cardReferenceArrival = addMinutesToTime(
                              previousItem
                                ? (getPreviousReferenceBaseTime(previousItem) ??
                                    previousItem.arrivalTime)
                                : undefined,
                              previousItem?.durationMinutes,
                            );
                            const transportLabel = transportOptions.find(
                              (option) => option.value === item.transport,
                            )?.label;
                            const routeReady = Boolean(
                              previousItem &&
                              transportLabel &&
                              previousPlace?.googlePlaceId &&
                              place?.googlePlaceId,
                            );
                            const placeLabels =
                              place?.labelIds.flatMap((labelId) => {
                                const label = labelsById.get(labelId);
                                return label ? [label] : [];
                              }) ?? [];
                            const mapUrl = place
                              ? getPlaceMapUrl(place)
                              : undefined;
                            return (
                              <li className="itinerary-item-row" key={item.id}>
                                <span className="itinerary-order">
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <div className="itinerary-item-copy">
                                  <div className="itinerary-item-title">
                                    <strong>
                                      {place?.icon && (
                                        <span
                                          className="itinerary-place-icon"
                                          aria-hidden="true"
                                        >
                                          {place.icon}
                                        </span>
                                      )}
                                      {place?.name ?? "地點已不存在"}
                                    </strong>
                                    {mapUrl && (
                                      <a
                                        className="itinerary-map-link"
                                        href={mapUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label={`在地圖開啟${place?.name}`}
                                        title="在地圖開啟"
                                      >
                                        ⌖ 地圖 ↗
                                      </a>
                                    )}
                                    {place?.notes?.trim() && (
                                      <button
                                        className="itinerary-place-note-toggle"
                                        type="button"
                                        aria-label={`${expandedPlaceNotes.has(item.id) ? "收合" : "顯示"}${place.name}的地點備註`}
                                        aria-expanded={expandedPlaceNotes.has(
                                          item.id,
                                        )}
                                        aria-controls={`place-note-${item.id}`}
                                        title={`${expandedPlaceNotes.has(item.id) ? "收合" : "顯示"}地點備註`}
                                        onClick={() => togglePlaceNote(item.id)}
                                      >
                                        <svg
                                          aria-hidden="true"
                                          viewBox="0 0 16 16"
                                          focusable="false"
                                        >
                                          <path d="M5 2.5h8v11H5zM3 4h2M3 7h2M3 10h2M3 13h2M7.5 5h3M7.5 7.5h3M7.5 10h2" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                  <div className="itinerary-item-meta">
                                    {item.arrivalTime && (
                                      <span>預計抵達 {item.arrivalTime}</span>
                                    )}
                                    {item.durationMinutes && (
                                      <span>{item.durationMinutes} 分鐘</span>
                                    )}
                                    {transportLabel && (
                                      <span>{transportLabel}</span>
                                    )}
                                    {item.travelDurationMinutes !==
                                      undefined && (
                                      <span>
                                        路程約 {item.travelDurationMinutes} 分鐘
                                        {item.travelDistanceMeters !==
                                          undefined &&
                                          ` · ${formatTravelDistance(item.travelDistanceMeters)}`}
                                        {cardReferenceArrival
                                          ? `（${cardReferenceArrival.time}${cardReferenceArrival.dayOffset ? ` 翌日 +${cardReferenceArrival.dayOffset} 天` : ""}）`
                                          : ""}
                                      </span>
                                    )}
                                  </div>
                                  {placeLabels.length > 0 && (
                                    <div
                                      className="itinerary-item-labels"
                                      aria-label="地點標籤"
                                    >
                                      {placeLabels.slice(0, 3).map((label) => (
                                        <span
                                          className="itinerary-item-label"
                                          key={label.id}
                                        >
                                          <i
                                            style={{
                                              backgroundColor: label.color,
                                            }}
                                            aria-hidden="true"
                                          />
                                          {label.name}
                                        </span>
                                      ))}
                                      {placeLabels.length > 3 && (
                                        <span className="itinerary-item-label-more">
                                          +{placeLabels.length - 3}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {place?.notes?.trim() && (
                                    <div
                                      className="itinerary-place-note"
                                      id={`place-note-${item.id}`}
                                      hidden={!expandedPlaceNotes.has(item.id)}
                                    >
                                      <span>地點備註</span>
                                      <p>{place.notes}</p>
                                    </div>
                                  )}
                                  {item.note && <p>{item.note}</p>}
                                </div>
                                <div className="itinerary-item-actions">
                                  <button
                                    type="button"
                                    aria-label="往前移"
                                    disabled={
                                      interactionBusy ||
                                      !canEditItems ||
                                      index === 0
                                    }
                                    onClick={() => void moveItem(item, -1)}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="往後移"
                                    disabled={
                                      interactionBusy ||
                                      !canEditItems ||
                                      index === dayItems.length - 1
                                    }
                                    onClick={() => void moveItem(item, 1)}
                                  >
                                    ↓
                                  </button>
                                  {previousItem && (
                                    <button
                                      type="button"
                                      className="itinerary-calculate-route"
                                      disabled={
                                        interactionBusy ||
                                        !canEditItems ||
                                        !routeReady
                                      }
                                      title={
                                        !item.transport
                                          ? "先編輯此地點並選擇交通方式"
                                          : !routeReady
                                            ? "兩個地點都需要 Google Maps 搜尋結果"
                                            : undefined
                                      }
                                      onClick={() =>
                                        void handleCalculateTravelDuration(item)
                                      }
                                    >
                                      {calculatingItemId === item.id
                                        ? "計算中…"
                                        : item.travelDurationMinutes !==
                                            undefined
                                          ? "重算路程"
                                          : "計算路程"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    aria-label="編輯項目"
                                    disabled={interactionBusy || !canEditItems}
                                    onClick={() => startEditItem(item)}
                                  >
                                    編輯
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="移除項目"
                                    disabled={interactionBusy || !canEditItems}
                                    onClick={() => void handleDeleteItem(item)}
                                  >
                                    移除
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        !itemFormVisible && (
                          <div className="itinerary-day-empty">
                            <span>⌖</span>
                            <strong>這一天還沒有安排</strong>
                            <p>從已收藏且屬於此區域的地點中加入第一站。</p>
                            <button
                              type="button"
                              className="itinerary-primary"
                              disabled={!tripPlaces.length || !canEditItems}
                              onClick={startAddItem}
                            >
                              ＋地點
                            </button>
                          </div>
                        )
                      )}
                      {!tripPlaces.length && !itemFormVisible && (
                        <p className="itinerary-region-hint">
                          請先到地點模組，將地點加入「{selectedRegion?.name}
                          」區域。
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="itinerary-empty-detail">
                <span>▤</span>
                <h2>{loading ? "正在載入行程…" : "開始規劃一趟旅行"}</h2>
                <p>
                  {loading
                    ? ""
                    : trips.length
                      ? "選擇一個行程，或建立新的旅行計畫。"
                      : "新增行程後，即可按天安排收藏的地點。"}
                </p>
                {!loading && (
                  <button
                    type="button"
                    className="itinerary-primary"
                    onClick={startCreateTrip}
                  >
                    ＋ 新增
                  </button>
                )}
              </div>
            )}
          </aside>

          <section className="itinerary-map-panel" aria-label="行程區域地圖">
            <div className="itinerary-map-heading">
              <div>
                <span>旅行範圍</span>
                <strong>{selectedRegion?.name ?? "尚未選擇區域"}</strong>
              </div>
              <span className="itinerary-map-actions">
                {selectedRegion && (
                  <span className="itinerary-map-place-count">
                    {tripPlaces.length} 個收藏地點
                  </span>
                )}
                <details className="itinerary-action-menu" ref={mapToolsRef}>
                  <summary className="itinerary-secondary">
                    地圖工具
                    <svg
                      className="itinerary-menu-chevron"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <path d="m4 6 4 4 4-4" />
                    </svg>
                  </summary>
                  <div className="itinerary-dropdown itinerary-action-options">
                    <button
                      type="button"
                      title="將地圖調整為顯示全部標記"
                      disabled={
                        !visibleMapData ||
                        Boolean(visibleMapError) ||
                        mountedMapRegionId !== selectedRegionId ||
                        !mapHandleRef.current ||
                        !googleMapMarkers.length
                      }
                      onClick={() => {
                        if (mapToolsRef.current) {
                          mapToolsRef.current.open = false;
                          mapToolsRef.current.querySelector("summary")?.focus();
                        }
                        mapHandleRef.current?.setMarkers(googleMapMarkers, {
                          fitBounds: true,
                        });
                      }}
                    >
                      恢復預設
                    </button>
                    <RouterLink
                      className="itinerary-map-tool-link"
                      to={routes.routeCalculator}
                      aria-label="路程試算"
                      title="路程試算"
                      aria-disabled={
                        interactionBusy ||
                        creatingTrip ||
                        editingTrip ||
                        addingItem ||
                        editingItemId !== undefined ||
                        undefined
                      }
                      onClick={(event) => {
                        if (
                          interactionBusy ||
                          creatingTrip ||
                          editingTrip ||
                          addingItem ||
                          editingItemId !== undefined ||
                          (hasPendingDayReorder &&
                            !window.confirm(
                              "尚有未儲存的排序，離開會放棄排序變更。確定前往路程頁面？",
                            ))
                        ) {
                          event.preventDefault();
                        } else if (mapToolsRef.current) {
                          mapToolsRef.current.open = false;
                        }
                      }}
                    >
                      路程試算
                    </RouterLink>
                  </div>
                </details>
              </span>
            </div>
            <div className="itinerary-map-canvas">
              <div className="itinerary-google-map" ref={mapContainerRef} />
              {!selectedRegion ? (
                <div className="itinerary-map-overlay">
                  <strong>先選擇一個行程區域</strong>
                  <p>地圖會顯示區域範圍及收藏在此區域的地點。</p>
                </div>
              ) : mapLoading ? (
                <div className="itinerary-map-overlay">
                  <strong>正在載入區域地圖…</strong>
                  <p>取得區域範圍與地點位置。</p>
                </div>
              ) : visibleMapError ? (
                <div className="itinerary-map-overlay itinerary-map-overlay-error">
                  <strong>無法顯示區域地圖</strong>
                  <p>{visibleMapError}</p>
                  <RouterLink to={routes.regions}>前往區域</RouterLink>
                </div>
              ) : mountedMapRegionId !== selectedRegion.id ? (
                <div className="itinerary-map-overlay">
                  <strong>正在載入 Google Maps…</strong>
                </div>
              ) : null}
              {visibleMapData?.regionWarning && (
                <div className="itinerary-map-warning" role="status">
                  {visibleMapData.regionWarning}
                </div>
              )}
              {visibleMapData?.unlocatedPlaces.length ? (
                <details className="itinerary-unlocated">
                  <summary>
                    有 {visibleMapData.unlocatedPlaces.length} 個地點無法定位
                  </summary>
                  <ul>
                    {visibleMapData.unlocatedPlaces.map((place) => (
                      <li key={place.id}>
                        <span>
                          <strong>{place.name}</strong>
                          <small>{place.reason}</small>
                        </span>
                        {place.mapsUrl && (
                          <a
                            href={place.mapsUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            開啟地圖 ↗
                          </a>
                        )}
                        <RouterLink to={routes.places}>編輯</RouterLink>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {visibleMapData && (
                <div className="itinerary-map-attribution">
                  Powered by Google Maps
                </div>
              )}
            </div>
            <div className="itinerary-map-footer">
              <span>
                <i className="itinerary-map-legend-dot numbered" /> 當日行程順序
              </span>
              <span>
                <i className="itinerary-map-legend-dot" /> 區域收藏地點
              </span>
              <span>{visibleMapData?.markers.length ?? 0} 個已定位</span>
            </div>
          </section>
        </section>
      </div>
      {deleteTripDialogOpen && selectedTrip && (
        <div
          className="itinerary-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving)
              closeDeleteTripDialog();
          }}
        >
          <section
            className="itinerary-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-trip-title"
          >
            <header className="itinerary-delete-dialog-heading">
              <div>
                <span>刪除行程</span>
                <h2 id="delete-trip-title">
                  確定刪除「{selectedTrip.name}」？
                </h2>
              </div>
              <button
                className="itinerary-dialog-close"
                type="button"
                aria-label="關閉"
                disabled={saving}
                onClick={closeDeleteTripDialog}
              >
                ×
              </button>
            </header>
            <div className="itinerary-delete-warning">
              <strong aria-hidden="true">!</strong>
              <p>
                刪除後無法復原。此操作會一併刪除此行程的每日安排及備註；
                {deleteRouteMapCheck?.status === "ready" &&
                deleteRouteMapCheck.hasRouteMap
                  ? "關聯的試算地圖與後加標記也會一起刪除；收藏地點、標籤與區域不受影響。"
                  : "收藏地點、標籤與區域不受影響。"}
              </p>
            </div>
            {deleteRouteMapCheck?.status === "loading" && (
              <p className="itinerary-feedback" role="status">
                正在確認是否有關聯的試算地圖…
              </p>
            )}
            {deleteRouteMapCheck?.status === "error" && (
              <div className="itinerary-feedback itinerary-error" role="alert">
                無法確認試算地圖是否存在：{deleteRouteMapCheck.message}
                <button
                  type="button"
                  disabled={saving}
                  onClick={openDeleteTripDialog}
                >
                  重試
                </button>
              </div>
            )}
            {deleteRouteMapCheck?.status === "ready" &&
              deleteRouteMapCheck.hasRouteMap && (
                <div className="itinerary-delete-summary">
                  <span>將一併刪除的試算地圖</span>
                  <strong>
                    1 張地圖、{deleteRouteMapCheck.addedPlaceCount} 個後加標記
                  </strong>
                </div>
              )}
            <div className="itinerary-delete-summary">
              <span>將一併刪除的行程項目</span>
              <strong>{tripItems.length} 個地點</strong>
            </div>
            {error && (
              <div
                className="itinerary-feedback itinerary-error itinerary-dialog-error"
                role="alert"
              >
                {error}
              </div>
            )}
            <footer className="itinerary-delete-dialog-actions">
              <button
                type="button"
                className="itinerary-secondary"
                disabled={saving}
                onClick={closeDeleteTripDialog}
              >
                取消
              </button>
              <button
                type="button"
                className="itinerary-delete"
                disabled={
                  saving ||
                  deleteRouteMapCheck?.status !== "ready" ||
                  deleteRouteMapCheck.tripId !== selectedTrip.id
                }
                onClick={() => void handleDeleteTrip()}
              >
                {saving ? "刪除中…" : "刪除行程與項目"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </WorkspaceLayout>
  );
}

export default ItineraryModule;
