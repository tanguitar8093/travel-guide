import type { Coordinate, StoredLocation } from "./contracts";

export interface NamedLocation {
  readonly name: string;
  readonly location?: StoredLocation;
}

export type PlaceDuplicateReason = "nearby" | "name";

export function coordinateDistanceMeters(
  left: Coordinate,
  right: Coordinate,
): number {
  const radians = Math.PI / 180;
  const latitudeDifference = (right.latitude - left.latitude) * radians;
  const longitudeDifference = (right.longitude - left.longitude) * radians;
  const arc =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(left.latitude * radians) *
      Math.cos(right.latitude * radians) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, arc))));
}

export function placeDuplicateReason(
  left: NamedLocation,
  right: NamedLocation,
): PlaceDuplicateReason | undefined {
  if (
    left.location &&
    right.location &&
    coordinateDistanceMeters(
      left.location.coordinate,
      right.location.coordinate,
    ) < 50
  ) {
    return "nearby";
  }
  const name = left.name.trim().replace(/\s+/g, " ").toLowerCase();
  if (name && name === right.name.trim().replace(/\s+/g, " ").toLowerCase())
    return "name";
  return undefined;
}

export function placeDuplicateMessage(
  name: string,
  reason: PlaceDuplicateReason,
): string {
  return reason === "nearby"
    ? `和「${name}」距離不到 50 公尺`
    : `和「${name}」名稱相同，地點重複`;
}
