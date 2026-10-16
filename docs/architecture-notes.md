# Architecture Note Key

| ID | 類別與重點成員 |
| --- | --- |
| N1 | `App`: `pathname`；fn: 依路徑切換模組，預設回到行程頁。`usePathname`: 讀取 `window.location.pathname`。 |
| N2 | `AuthProvider`: state `session`, `status`, `errorMessage`; fn `signInWithPassword`, `signOut`, `clearError`。`AuthGate`: state `email`, `password`, `formErrorMessage`, `isSubmitting`; fn `handleSubmit`。`WorkspaceLayout`: state `sidebarPinned`, `sidebarHovered`, `isSigningOut`; fn `toggleSidebar`, `closeOnMobileNavigation`。`RouterLink`: fn 攔截左鍵導覽並 `pushState`。 |
| N3 | `LabelModule`: state `tree`, `selectedId`, `search`, `dialog`, `loading`, `saving`; fn `refreshTree`, `refreshPlaces`, `handleCreate`, `handleSave`, `handleDelete`, `handleAssign`。`LabelController`: `service`. `LabelService`: fn `listTree`, `findPlaces`, `assignToPlace`, `removeFromPlace`, `listPlaces`。 |
| N4 | `PlaceModule`: state `places`, `labels`, `regions`, `selectedPlaceId`, `draft`, `filters`, `googleDetails`; fn `reloadPlaces`, `selectPlace`, `startCreate`, `handleSave`, `handleDelete`。`PlaceController`: `service`. `PlaceService`: fn `loadWorkspace`, `search`, `getGooglePlaceDetails`, `mountPlaceAutocomplete`。 |
| N5 | `RegionModule`: state `regions`, `places`, `trips`, `usage`, `selectedId`, `draft`, `googleDetails`; fn `refresh`, `startCreate`, `selectRegion`, `handleSubmit`, `handleDelete`。`RegionController`: `service`. `RegionService`: fn `loadWorkspace`, `create`, `update`, `delete`, `mountPlaceAutocomplete`。 |
| N6 | `ItineraryModule`: state `trips`, `regions`, `places`, `selectedTripId`, `selectedDate`, `draft`, `items`, `mapData`; fn `reloadWorkspace`, `handleCreateTrip`, `handleSaveTrip`, `handleAddItem`, `handleReorder`, `handleCalculateTravelDuration`。`ItineraryController`: `service`. `ItineraryService`: fn `loadWorkspace`, `loadMapData`, `addItem`, `calculateTravelDuration`, `reorderItems`。`ItineraryMapService`: fn `loadMapData`, `resolvePlace`。 |
| N7 | `DataManagementModule`: state `databaseMode`, `backup`, `fileName`, `busy`, `error`, `notice`; fn `handleExport`, `handleFileSelected`, `handleImport`, `handleClearAllData`, `handleTransferLocalToSupabase`, `handleTransferSupabaseToLocal`。`DataManagementController`: `service`. `DataManagementService`: fn `exportBackup`, `parseBackup`, `replaceAllData`, `clearAllData`, `transferLocalToSupabase`, `transferSupabaseToLocal`。 |
| N8 | `database/index.ts`: `activeBackend()` 與各 repository 門面。`runtime.ts`: `currentDatabaseMode`; fn `getDatabaseMode`, `setDatabaseMode`, `subscribeDatabaseMode`。`TravelDatabase`: tables `regions`, `places`, `labels`, `trips`, `itineraryItems`; migrations `version 1 → 4`。IndexedDB 與 Supabase repositories 各自提供同名 CRUD 與查詢能力。 |

## 補充

這張圖刻意只畫到類別層級，不展開 helper、表單欄位處理、樣板化的 UI 細節，也不把單純轉呼叫的薄 wrapper 當成重點。
