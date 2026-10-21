import { PublicItineraryCatalog } from './shared-catalog'

export const publicCatalog = new PublicItineraryCatalog(`travel-planner-public-catalog:${new URL(import.meta.env.VITE_SUPABASE_URL!).hostname}`)
