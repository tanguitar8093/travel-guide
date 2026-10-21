export * from '../../src/modules/public-itinerary/models'
import type { ItineraryItem, Label, Place, PublicItinerary, Region, Trip } from '../../src/modules/public-itinerary/models'
export interface SeedMarker { key: string; version: number }
export interface PersonalDataset { regions: Region[]; places: Place[]; labels: Label[]; trips: Trip[]; items: ItineraryItem[] }
export interface DemoDataset extends PersonalDataset { publicItineraries: PublicItinerary[] }
