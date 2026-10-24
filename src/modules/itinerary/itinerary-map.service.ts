import { places, regions } from "../../database";
import type { Place, Region } from "../../database";
import type { GeoProvider } from "../../geo/contracts";
import { getMapProvider } from "../../geo/provider-preference";
import { osmDatasets, regionOsmDataset, type OsmDatasetId } from "../../geo/osm-datasets";
import { validateLocationMetadata, validateStoredLocation } from "../../database/location.validation";
import {
  getGooglePlaceDetails,
  type GoogleMapMarkerData,
  type GoogleMapPosition,
  type GoogleMapViewport,
} from "../place/google-places.service";

export interface UnlocatedMapPlace {
  id: string;
  name: string;
  mapsUrl?: string;
  reason: string;
}

export interface ItineraryMapData {
  provider?: GeoProvider;
  osmDataset?: OsmDatasetId;
  regionId: string;
  center: GoogleMapPosition;
  zoom: number;
  viewport?: GoogleMapViewport;
  markers: GoogleMapMarkerData[];
  unlocatedPlaces: UnlocatedMapPlace[];
  regionWarning?: string;
}

function positionFromLegacyRegion(
  region: Region,
): GoogleMapPosition | undefined {
  if (!region.center) return undefined;
  return {
    lat: region.center.latitude,
    lng: region.center.longitude,
  };
}

export class ItineraryMapService {
  async loadMapData(regionId: string): Promise<ItineraryMapData> {
    const provider = getMapProvider();
    const [region, regionPlaces] = await Promise.all([
      regions.getById(regionId),
      places.findByRegionId(regionId),
    ]);
    if (!region) {
      throw new Error(`區域 "${regionId}" 不存在，無法載入行程地圖。`);
    }
    return this.loadRecords(region, regionPlaces, provider);
  }

  async loadRecords(region: Region, regionPlaces: Place[], provider = getMapProvider()): Promise<ItineraryMapData> {
    if (provider === 'osm') return this.loadOsmRecords(region, regionPlaces);
    let center = positionFromLegacyRegion(region);
    let viewport: GoogleMapViewport | undefined;
    let regionWarning: string | undefined;
    if (region.googlePlaceId) {
      try {
        const details = await getGooglePlaceDetails(region.googlePlaceId);
        if (details.location) {
          center = details.location;
          viewport = details.viewport;
        } else {
          regionWarning = `Google 沒有提供「${region.name}」的地圖中心位置。`;
        }
      } catch (cause) {
        if (!center) {
          throw cause instanceof Error
            ? cause
            : new Error(`讀取區域「${region.name}」的位置失敗。`);
        }
        regionWarning =
          cause instanceof Error
            ? `無法更新區域「${region.name}」的位置：${cause.message}`
            : `無法更新區域「${region.name}」的位置。`;
      }
    }

    if (!center) {
      throw new Error(
        `區域「${region.name}」沒有可用的地圖中心，請到區域重新選擇 Google Maps 地點。`,
      );
    }

    const resolvedPlaces = await Promise.all(
      regionPlaces.map((place) => this.resolvePlace(place)),
    );
    return {
      regionId: region.id,
      center,
      zoom: region.zoom,
      ...(viewport ? { viewport } : {}),
      markers: resolvedPlaces.flatMap((result) =>
        result.marker ? [result.marker] : [],
      ),
      unlocatedPlaces: resolvedPlaces.flatMap((result) =>
        result.unlocated ? [result.unlocated] : [],
      ),
      ...(regionWarning ? { regionWarning } : {}),
    };
  }

  private loadOsmRecords(region: Region, regionPlaces: Place[]): ItineraryMapData {
    const dataset = regionOsmDataset(region);
    const definition = osmDatasets[dataset];
    let center = { lat: definition.center.latitude, lng: definition.center.longitude };
    let regionWarning: string | undefined;
    const hasCenter = region.center !== undefined && region.centerMetadata !== undefined;
    if (region.center !== undefined && region.centerMetadata !== undefined) {
      validateLocationMetadata(region.centerMetadata);
      validateStoredLocation({ ...region.centerMetadata, coordinate: region.center });
      center = { lat: region.center.latitude, lng: region.center.longitude };
    } else {
      regionWarning = `區域「${region.name}」尚無已確認來源的位置；先顯示${definition.name}圖資範圍，不會查詢 Google 或自動補座標。`;
    }
    const markers: GoogleMapMarkerData[] = [];
    const unlocatedPlaces: UnlocatedMapPlace[] = [];
    for (const place of regionPlaces) {
      if (place.location !== undefined) {
        try {
          validateStoredLocation(place.location);
          markers.push({
            id: place.id, title: place.name,
            position: { lat: place.location.coordinate.latitude, lng: place.location.coordinate.longitude },
          });
          continue;
        } catch (cause) {
          unlocatedPlaces.push({
            id: place.id, name: place.name, mapsUrl: place.mapsUrl,
            reason: cause instanceof Error ? cause.message : '位置資料無法驗證。',
          });
          continue;
        }
      }
      unlocatedPlaces.push({
        id: place.id, name: place.name, mapsUrl: place.mapsUrl,
        reason: place.googlePlaceId
          ? '目前只有 Google 地點識別碼，尚未補上地圖座標。'
          : '尚未儲存地圖座標；地圖網址不會自動轉成座標。',
      });
    }
    return {
      provider: 'osm', osmDataset: dataset, regionId: region.id, center, zoom: hasCenter ? region.zoom : 9,
      ...(!hasCenter ? { viewport: definition.bounds } : {}),
      markers, unlocatedPlaces, ...(regionWarning ? { regionWarning } : {}),
    };
  }

  private async resolvePlace(
    place: Place,
  ): Promise<{ marker?: GoogleMapMarkerData; unlocated?: UnlocatedMapPlace }> {
    if (!place.googlePlaceId) {
      return {
        unlocated: {
          id: place.id,
          name: place.name,
          ...(place.mapsUrl ? { mapsUrl: place.mapsUrl } : {}),
          reason: "只有自訂地圖網址，無法可靠取得圖釘座標。",
        },
      };
    }

    try {
      const details = await getGooglePlaceDetails(place.googlePlaceId);
      if (!details.location) {
        return {
          unlocated: {
            id: place.id,
            name: place.name,
            ...(place.mapsUrl ? { mapsUrl: place.mapsUrl } : {}),
            reason: "Google Places 沒有提供此地點的位置。",
          },
        };
      }
      return {
        marker: {
          id: place.id,
          title: place.name,
          position: details.location,
        },
      };
    } catch (cause) {
      return {
        unlocated: {
          id: place.id,
          name: place.name,
          ...(place.mapsUrl ? { mapsUrl: place.mapsUrl } : {}),
          reason:
            cause instanceof Error
              ? cause.message
              : "讀取 Google 地點位置失敗。",
        },
      };
    }
  }
}
