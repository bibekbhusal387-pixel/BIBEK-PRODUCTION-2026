import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  BatchHistoryEntry,
  CableOrder,
  ColourMapRule,
  ContainerPlan,
  DailyJournalEntry,
  DensitySettings,
  DispatchedContainerRecord,
  DispatchRecord,
  LadiDimensionRule,
  ManualPackingItem,
  PackagingRule,
  PurchaseItem,
  SizePackagingRule,
  StockItem,
  StockOpeningSettings,
  StockReturnRejection,
  MonthlyStockSnapshot,
  StockThresholdSettings,
} from './types/cable';
import {
  DEFAULT_BATCH_HISTORY,
  DEFAULT_COLOUR_MAP,
  DEFAULT_CONTAINER_PLANS,
  DEFAULT_DAILY_JOURNAL_ENTRIES,
  DEFAULT_DENSITIES,
  DEFAULT_DISPATCHED_CONTAINERS,
  DEFAULT_DISPATCH_RECORDS,
  DEFAULT_LADI_DIMENSIONS,
  DEFAULT_PACKAGING_RULES,
  DEFAULT_PURCHASE_ITEMS,
  DEFAULT_SIZE_PACKAGING,
  DEFAULT_STOCK_OPENINGS,
  DEFAULT_STOCK_RETURNS,
  INITIAL_ORDERS,
} from './data/defaults';
import {
  applySerialStageToggle,
  computeRecordRow,
  evaluateSpoolSizeForOrder,
  exportCsvFile,
  parseSizeNum,
  STAGE_LABELS,
} from './utils/calculations';
import {
  lookupPackagingRuleBySpool,
  syncContainerPlansWithBackup,
} from './utils/containerStuffing';
import { evaluateStockLevels, DEFAULT_STOCK_THRESHOLDS } from './utils/stockAlerts';
import { computeLiveStockLedger, StockLedgerResult } from './utils/stockEngine';
import {
  downloadPrintableCurrentPage,
  registerPrintInterceptor,
  triggerNativePrintOnly,
} from './utils/printDocument';
import {
  downloadFormattedTablesHtml,
  downloadStandaloneLaptopApp,
  downloadWindowsLaptopLauncher,
  downloadGoogleDriveDocLauncher,
  LIVE_APP_URL,
  getAttachedLiveUrl,
} from './utils/generateStandaloneLaptopApp';
import {
  addDeletedOrderId,
  addDeletedOrderIds,
  BG_SYNC_BROADCAST_CHANNEL,
  BG_SYNC_TAG,
  CLEAN_ERA_CUTOFF_MS,
  clearDeletedOrderIds,
  clearPendingOfflineSyncQueue,
  fetchCloudUpdatedAt,
  fetchStateFromCloud,
  getDeletedOrderIds,
  getLastLocalSavedTimestamp,
  getPendingOfflineSyncStatusSync,
  isTimestampAfterCleanCutoff,
  loadMasterSnapshotFromLocalStorage,
  loadPendingOfflineSyncFromIndexedDB,
  loadStateFromIndexedDB,
  normalizeCleanStateSnapshot,
  PlutusFullAppState,
  purgeAllLegacyPreCutoffStorage,
  pushStateToCloud,
  registerBackgroundSyncServiceWorker,
  removeDeletedOrderId,
  sanitizeManualOrders,
  saveFullStateToLocalStorage,
  saveStateToIndexedDB,
  triggerImmediateBackgroundSyncFlush,
} from './utils/autoSavePersistence';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import {
  DEFAULT_MARU_MIRACLE_CARTON_RULES,
  DEFAULT_VIHAN_TRIGUARD_CARTON_RULES,
  loadMaruMiracleCartonRules,
  loadVihanTriguardCartonRules,
  MaruMiracleCartonRule,
  saveMaruMiracleCartonRules,
  saveVihanTriguardCartonRules,
  VihanTriguardCartonRule,
} from './utils/is694CartonPackaging';
import { StockThresholdModal } from './components/StockThresholdModal';
import { LaptopAppModal } from './components/LaptopAppModal';
import { GoogleDriveModal } from './components/GoogleDriveModal';
import { LockScreen } from './components/LockScreen';
import { User } from 'firebase/auth';
import {
  initAuth,
  googleSignIn,
  saveWorkspaceToFirestore,
  getFirestoreWorkspaceSnapshot,
} from './utils/googleDriveIntegration';
import { TabOrders } from './components/TabOrders';
import { TabCompletedOrders } from './components/TabCompletedOrders';
import { TabRequisition } from './components/TabRequisition';
import { TabRecord } from './components/TabRecord';
import { TabSummary } from './components/TabSummary';
import { TabPacking } from './components/TabPacking';
import { TabPurchase } from './components/TabPurchase';
import { TabPvcSlip } from './components/TabPvcSlip';
import { TabCopperSlip } from './components/TabCopperSlip';
import { TabDrumSlip } from './components/TabDrumSlip';
import { TabStockSlip } from './components/TabStockSlip';
import { TabSettings } from './components/TabSettings';
import { TabDashboard } from './components/TabDashboard';
import { TabContainerPlanning } from './components/TabContainerPlanning';
import { TabDispatch } from './components/TabDispatch';
import { TabDailyJournal } from './components/TabDailyJournal';
import {
  exportActiveSheetToPdf,
  exportAllSheetsWorkbookToPdf,
} from './utils/exportSheetPdf';
import {
  Download,
  FileDown,
  FileSpreadsheet,
  Laptop,
  Lock,
  Printer,
  CheckCircle2,
  X,
  Globe,
  ExternalLink,
  Copy,
  Check,
  Smartphone,
  Wifi,
  WifiOff,
  RefreshCw,
} from 'lucide-react';

const TAB_TITLES: Record<string, string> = {
  dashboard: 'Production Analytics & Operations Dashboard',
  orders: '1. Active Orders Sheet & Engineering Specifications',
  completed: '2. Completed Orders Production Record',
  requisition: '3. Production Requisition & Process Cards (B, CS, I, TS, SH)',
  journal: '3B. Daily Production Journal — Shift Metrics, Machine Run-Times & OEE Efficiency',
  record: '4. Master Engineering & Material Calculation Record',
  summary: '5. Production Material & Drum Requisition Summary',
  packing: '6. Production & Dispatch Packing List (Reel Breakdown)',
  container: '6B. Personal Container Planning & Stuffing Database',
  dispatch: '6C. Master Dispatch Details & Delivery Ledger',
  purchase: '7. Raw Material Purchases & Invoices Ledger',
  pvcslip: '8. Material Purchase Requisition Slip (PVC & Compounds)',
  copslip: '9. Copper Requisition Slip & Strand Breakdown Summary',
  druslip: '10. Drum Size & Pallets Requisition Slip',
  stockslip: '11. Inventory & Stock Management Slip',
  settings: '12. Master Standards & Reference Backup Tables',
};

function safeGetStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeSetStorage(key: string, val: string): void {
  try {
    localStorage.setItem(key, val);
  } catch (e) {}
}

function safeRemoveStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}

// Hydrate localStorage from embedded laptop bundle state ONLY when the bundle was exported
// after the clean era cutoff (2026-11-06T10:00:00.000Z) and is newer than existing local edits.
(function hydrateEmbeddedLaptopState() {
  if (typeof window === 'undefined') return;
  if (!window.__PLUTUS_EMBEDDED_STATE__) return;
  const emb = window.__PLUTUS_EMBEDDED_STATE__;
  const stamp = emb.exportedAt || (emb as any).updatedAt || '';
  if (!isTimestampAfterCleanCutoff(stamp)) {
    return;
  }
  const stampMs = Date.parse(stamp);
  const lastLocalMs = getLastLocalSavedTimestamp();
  const prevStamp = safeGetStorage('plutus_laptop_bundle_stamp_v9');

  const existingOrdersV9 = safeGetStorage('plutus_manual_orders_v9');
  const hasExistingLocalOrders = Boolean(existingOrdersV9 && existingOrdersV9.length > 5);

  const isEmbeddedNewer =
    !hasExistingLocalOrders ||
    (stamp && stamp !== prevStamp && (!lastLocalMs || (stampMs > 0 && stampMs > lastLocalMs)));

  if (isEmbeddedNewer) {
    const normalized = normalizeCleanStateSnapshot({
      ...emb,
      updatedAt: stamp,
    });
    saveFullStateToLocalStorage(normalized, stamp);
    safeSetStorage('plutus_laptop_bundle_stamp_v9', stamp);
  }
})();

export default function App() {
  // Lock screen state (persisted across restarts unless explicitly locked)
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    try {
      if (window.__PLUTUS_EMBEDDED_STATE__) return true;
      if (safeGetStorage('plutus_unlocked_persistent') === 'false') return false;
      if (
        safeGetStorage('plutus_unlocked_persistent') === 'true' ||
        sessionStorage.getItem('plutus_unlocked') === 'true'
      ) {
        return true;
      }
      return true;
    } catch (e) {
      return true;
    }
  });
  const [appPassword] = useState('Password');

  // Active Tab (restores last opened tab when re-opening the app)
  const [activeTab, setActiveTab] = useState<
    | 'dashboard'
    | 'orders'
    | 'completed'
    | 'requisition'
    | 'journal'
    | 'record'
    | 'summary'
    | 'packing'
    | 'container'
    | 'dispatch'
    | 'purchase'
    | 'pvcslip'
    | 'copslip'
    | 'druslip'
    | 'stockslip'
    | 'settings'
  >(() => {
    const savedTab = safeGetStorage('plutus_last_active_tab');
    if (savedTab && savedTab in TAB_TITLES) {
      return savedTab as any;
    }
    return 'orders';
  });

  // Auto-Save & Cloud Sync status indicator + PWA Background Sync state
  const isOnline = useOnlineStatus();
  const { isInstallable: isPWAInstallable, isInstalled: isPWAInstalled, install: installPWA } = usePWAInstall();
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<string>(() => {
    return safeGetStorage('plutus_last_saved_at_v9') || new Date().toISOString();
  });
  const [syncIndicator, setSyncIndicator] = useState<'saved' | 'saving'>('saved');
  const [pendingOfflineSync, setPendingOfflineSync] = useState<{
    hasPending: boolean;
    editCount: number;
    queuedAt: string | null;
  }>(() => getPendingOfflineSyncStatusSync());
  const [swReady, setSwReady] = useState<boolean>(false);
  const [isBgSyncFlushing, setIsBgSyncFlushing] = useState<boolean>(false);
  const isInitialMountRef = useRef(true);
  const isRestoringExternalRef = useRef(false);
  const isHydrationCompleteRef = useRef(false);
  const laptopFileInputRef = useRef<HTMLInputElement | null>(null);

  // Print Mode state, Google Drive OAuth state & Status Notification Banner
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [isLaptopModalOpen, setIsLaptopModalOpen] = useState(false);
  const [isGoogleDriveModalOpen, setIsGoogleDriveModalOpen] = useState(false);
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveNeedsAuth, setDriveNeedsAuth] = useState<boolean>(true);
  const [targetContainerId, setTargetContainerId] = useState<string | undefined>(undefined);
  const [statusNotice, setStatusNotice] = useState<{
    message: string;
    actionTab?: string;
    actionLabel?: string;
  } | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      user => {
        setDriveUser(user);
        setDriveNeedsAuth(false);
      },
      firebaseUser => {
        setDriveUser(firebaseUser || null);
        setDriveNeedsAuth(true);
        if (firebaseUser) {
          getFirestoreWorkspaceSnapshot(firebaseUser.uid)
            .then(res => {
              if (
                res.payload &&
                isTimestampAfterCleanCutoff(res.payload.updatedAt) &&
                latestStateRef.current.orders.length === 0 &&
                Array.isArray(res.payload.orders) &&
                res.payload.orders.length > 0
              ) {
                const normalized = normalizeCleanStateSnapshot(
                  res.payload,
                  res.payload.updatedAt
                );
                applyRestoredSnapshot(normalized, 'Firebase Firestore Cloud');
                saveFullStateToLocalStorage(normalized, normalized.updatedAt);
              }
            })
            .catch(() => {});
        }
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const handleOpenContainer = (containerId?: string) => {
    if (containerId) {
      setTargetContainerId(containerId);
    }
    setActiveTab('container');
  };

  const showNotice = (
    message: string,
    actionTab?: string,
    actionLabel?: string
  ) => {
    setStatusNotice({ message, actionTab, actionLabel });
    setTimeout(() => {
      setStatusNotice(prev => (prev?.message === message ? null : prev));
    }, 6000);
  };

  useEffect(() => {
    registerPrintInterceptor(() => {
      setIsPrintMode(true);
    });
  }, []);

  useEffect(() => {
    document.body.classList.toggle('print-simulation-mode', isPrintMode);
    return () => {
      document.body.classList.remove('print-simulation-mode');
    };
  }, [isPrintMode]);

  // Requisition card target selection
  const [reqTarget, setReqTarget] = useState<{
    batch: string;
    brand: string;
    size: string;
    orderId?: number;
  }>({
    batch: '',
    brand: '',
    size: '',
    orderId: undefined,
  });

  const userModifiedInSessionRef = useRef(false);

  // Clean-era v9 initialization:
  // Permanently purges all pre-cutoff (before 2026-11-06T10:00:00.000Z) data from localStorage & IndexedDB,
  // while migrating any new manual orders entered after the cutoff today into v9 storage.
  const initialMasterSnap = (() => {
    const isCleanSlateV9 = safeGetStorage('plutus_clean_slate_manual_v9') === 'true';
    if (!isCleanSlateV9) {
      try {
        // Check if the user entered new post-cutoff manual orders in v5 before v9 migration
        let migratedPostCutoffSnap: PlutusFullAppState | null = null;
        const rawV5 = safeGetStorage('plutus_full_autosave_v5');
        if (rawV5) {
          try {
            const parsedV5 = JSON.parse(rawV5);
            if (parsedV5 && typeof parsedV5 === 'object' && isTimestampAfterCleanCutoff(parsedV5.updatedAt)) {
              migratedPostCutoffSnap = normalizeCleanStateSnapshot(parsedV5, parsedV5.updatedAt);
            }
          } catch {}
        }

        // Purge all pre-cutoff keys and old IndexedDB database
        purgeAllLegacyPreCutoffStorage();
        clearDeletedOrderIds();

        const baselineIso = migratedPostCutoffSnap?.updatedAt || new Date(CLEAN_ERA_CUTOFF_MS).toISOString();
        const cleanSnap: PlutusFullAppState = migratedPostCutoffSnap || {
          orders: [],
          sizeRules: DEFAULT_SIZE_PACKAGING,
          packagingRules: DEFAULT_PACKAGING_RULES,
          colourMap: DEFAULT_COLOUR_MAP,
          densities: DEFAULT_DENSITIES,
          ladiDimensions: DEFAULT_LADI_DIMENSIONS,
          purchaseItems: [],
          manualPackingItems: [],
          containerPlans: [],
          dispatchedContainers: [],
          dispatchRecords: [],
          customStockItems: [],
          pvcOverrides: {},
          copSlipNotes: '',
          stockThresholds: DEFAULT_STOCK_THRESHOLDS,
          batchHistory: [],
          stockReturnRejections: [],
          stockOpenings: {},
          manualStockOpeningsV2: {},
          monthlyStockSnapshots: {},
          dailyJournalEntries: [],
          deletedOrderIds: [],
          updatedAt: baselineIso,
        };

        saveFullStateToLocalStorage(cleanSnap, baselineIso);
        safeSetStorage('plutus_clean_slate_manual_v9', 'true');
        return cleanSnap;
      } catch {}
    } else {
      // Ensure any stray legacy keys remain purged on every reopen
      purgeAllLegacyPreCutoffStorage();
    }
    return loadMasterSnapshotFromLocalStorage();
  })();

  // State with clean-era v9 localStorage persistence — respects empty array [] and never restores old data
  const [orders, setOrders] = useState<CableOrder[]>(() => {
    try {
      const deletedSet = getDeletedOrderIds();
      if (initialMasterSnap && Array.isArray(initialMasterSnap.orders)) {
        return sanitizeManualOrders(initialMasterSnap.orders, deletedSet);
      }
      const savedV9 = safeGetStorage('plutus_cable_orders_v9_manual');
      if (savedV9 !== null) {
        const parsed: CableOrder[] = JSON.parse(savedV9);
        if (Array.isArray(parsed)) {
          return sanitizeManualOrders(parsed, deletedSet);
        }
      }
      if (
        window.__PLUTUS_EMBEDDED_STATE__ &&
        isTimestampAfterCleanCutoff((window.__PLUTUS_EMBEDDED_STATE__ as any).updatedAt) &&
        Array.isArray(window.__PLUTUS_EMBEDDED_STATE__.orders)
      ) {
        return sanitizeManualOrders(window.__PLUTUS_EMBEDDED_STATE__.orders, deletedSet);
      }
    } catch (e) {}
    return [];
  });

  const [sizeRules, setSizeRules] = useState<SizePackagingRule[]>(() => {
    try {
      if (initialMasterSnap?.sizeRules?.length) {
        return initialMasterSnap.sizeRules;
      }
      const saved = safeGetStorage('plutus_custom_size_pkg_v3') || safeGetStorage('plutus_custom_size_pkg');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return DEFAULT_SIZE_PACKAGING;
  });

  const [packagingRules, setPackagingRules] = useState<PackagingRule[]>(() => {
    try {
      if (initialMasterSnap?.packagingRules?.length) {
        return initialMasterSnap.packagingRules;
      }
      const saved = safeGetStorage('plutus_custom_packaging_v3') || safeGetStorage('plutus_custom_packaging');
      if (saved) {
        const parsed: PackagingRule[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((r, idx) => {
            if (r.bbnPerPallet !== undefined && r.bbnPerPallet !== '') return r;
            const defMatch =
              DEFAULT_PACKAGING_RULES.find(d => d.spool === r.spool) ||
              DEFAULT_PACKAGING_RULES[idx];
            return {
              ...r,
              bbnPerPallet: defMatch?.bbnPerPallet || '2',
            };
          });
        }
      }
    } catch (e) {}
    return DEFAULT_PACKAGING_RULES;
  });

  const [colourMap, setColourMap] = useState<ColourMapRule[]>(() => {
    try {
      if (initialMasterSnap?.colourMap?.length) {
        return initialMasterSnap.colourMap;
      }
      const saved = safeGetStorage('plutus_colour_map_v3') || safeGetStorage('plutus_colour_map');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return DEFAULT_COLOUR_MAP;
  });

  const [densities, setDensities] = useState<DensitySettings>(() => {
    try {
      if (initialMasterSnap?.densities && typeof initialMasterSnap.densities === 'object') {
        return initialMasterSnap.densities;
      }
      const saved = safeGetStorage('bibek_custom_densities');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return DEFAULT_DENSITIES;
  });

  const [ladiDimensions, setLadiDimensions] = useState<LadiDimensionRule[]>(() => {
    try {
      if (initialMasterSnap?.ladiDimensions?.length) {
        return initialMasterSnap.ladiDimensions;
      }
      const saved = safeGetStorage('bibek_custom_ladi');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return DEFAULT_LADI_DIMENSIONS;
  });

  // IS-694 Master Carton Standards (Vihan Opto/Triguard & Maru Miracle 90m/45m)
  const [is694VihanRules, setIs694VihanRules] = useState<VihanTriguardCartonRule[]>(() => {
    try {
      if (initialMasterSnap?.is694VihanRules && initialMasterSnap.is694VihanRules.length > 0) {
        return initialMasterSnap.is694VihanRules;
      }
    } catch (e) {}
    return loadVihanTriguardCartonRules();
  });

  const [is694MaruRules, setIs694MaruRules] = useState<MaruMiracleCartonRule[]>(() => {
    try {
      if (initialMasterSnap?.is694MaruRules && initialMasterSnap.is694MaruRules.length > 0) {
        return initialMasterSnap.is694MaruRules;
      }
    } catch (e) {}
    return loadMaruMiracleCartonRules();
  });

  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>(() => {
    try {
      if (initialMasterSnap && Array.isArray(initialMasterSnap.purchaseItems)) {
        return initialMasterSnap.purchaseItems;
      }
      const saved = safeGetStorage('plutus_purchase_items_v9');
      if (saved) {
        const parsed: PurchaseItem[] = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return DEFAULT_PURCHASE_ITEMS;
  });

  const [manualPackingItems, setManualPackingItems] = useState<ManualPackingItem[]>(() => {
    try {
      if (initialMasterSnap && Array.isArray(initialMasterSnap.manualPackingItems)) {
        return initialMasterSnap.manualPackingItems;
      }
      const saved = safeGetStorage('plutus_manual_packing_items_v9');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });

  const [containerPlans, setContainerPlans] = useState<ContainerPlan[]>(() => {
    try {
      if (initialMasterSnap && Array.isArray(initialMasterSnap.containerPlans)) {
        return initialMasterSnap.containerPlans;
      }
      const saved = safeGetStorage('plutus_container_plans_v9');
      if (saved) {
        const parsed: ContainerPlan[] = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return DEFAULT_CONTAINER_PLANS;
  });

  const [dispatchedContainers, setDispatchedContainers] = useState<
    DispatchedContainerRecord[]
  >(() => {
    try {
      if (initialMasterSnap && Array.isArray(initialMasterSnap.dispatchedContainers)) {
        return initialMasterSnap.dispatchedContainers;
      }
      const saved = safeGetStorage('plutus_dispatched_container_history_v9');
      if (saved) {
        const parsed: DispatchedContainerRecord[] = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return DEFAULT_DISPATCHED_CONTAINERS;
  });

  const [dispatchRecords, setDispatchRecords] = useState<DispatchRecord[]>(() => {
    try {
      if (initialMasterSnap && Array.isArray(initialMasterSnap.dispatchRecords)) {
        return initialMasterSnap.dispatchRecords;
      }
      const saved = safeGetStorage('plutus_dispatch_records_v9');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return DEFAULT_DISPATCH_RECORDS;
  });

  const [customStockItems, setCustomStockItems] = useState<StockItem[]>(() => {
    try {
      if (initialMasterSnap && Array.isArray(initialMasterSnap.customStockItems)) {
        return initialMasterSnap.customStockItems;
      }
      const saved = safeGetStorage('plutus_stock_management_items_v9');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  });

  const [pvcOverrides, setPvcOverrides] = useState<Record<string, any>>(() => {
    try {
      if (initialMasterSnap?.pvcOverrides && typeof initialMasterSnap.pvcOverrides === 'object') {
        return initialMasterSnap.pvcOverrides;
      }
      const saved = safeGetStorage('plutus_pvc_slip_custom_v9');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  const [copSlipNotes, setCopSlipNotes] = useState<string>(() => {
    if (initialMasterSnap?.copSlipNotes !== undefined) {
      return initialMasterSnap.copSlipNotes;
    }
    const saved = safeGetStorage('cop_slip_notes_v9');
    if (saved !== null) return saved;
    return '';
  });

  const [stockThresholds, setStockThresholds] = useState<StockThresholdSettings>(() => {
    try {
      if (initialMasterSnap?.stockThresholds && typeof initialMasterSnap.stockThresholds === 'object') {
        return initialMasterSnap.stockThresholds;
      }
      const saved = safeGetStorage('plutus_stock_thresholds');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return DEFAULT_STOCK_THRESHOLDS;
  });

  const [isThresholdModalOpen, setIsThresholdModalOpen] = useState(false);

  const [batchHistory, setBatchHistory] = useState<BatchHistoryEntry[]>(() => {
    try {
      if (initialMasterSnap && Array.isArray(initialMasterSnap.batchHistory)) {
        return initialMasterSnap.batchHistory;
      }
      const saved = safeGetStorage('plutus_batch_history_log_v9');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return DEFAULT_BATCH_HISTORY;
  });

  // Stock Management Slip (Tab 11) Enhanced Auto-Linked State
  const [stockReturns, setStockReturns] = useState<StockReturnRejection[]>(() => {
    try {
      if (initialMasterSnap && Array.isArray(initialMasterSnap.stockReturnRejections)) {
        return initialMasterSnap.stockReturnRejections;
      }
      const saved = safeGetStorage('plutus_stock_return_rejections_v9');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return DEFAULT_STOCK_RETURNS;
  });

  const [stockOpenings, setStockOpenings] = useState<Record<string, number>>(() => {
    try {
      const isZeroedV2 = safeGetStorage('plutus_opening_stock_zeroed_v2') === 'true';
      if (!isZeroedV2) {
        safeSetStorage('plutus_stock_openings', JSON.stringify({}));
        safeSetStorage('plutus_stock_openings_manual_v2', JSON.stringify({}));
        safeSetStorage('plutus_stock_openings_baseline', JSON.stringify({}));
        safeSetStorage('plutus_locked_opening_keys_v2', JSON.stringify({}));
        safeSetStorage('plutus_opening_stock_zeroed_v2', 'true');
        return {};
      }
      const savedManualV2 = safeGetStorage('plutus_stock_openings_manual_v2');
      if (savedManualV2) {
        const parsed = JSON.parse(savedManualV2);
        if (parsed && typeof parsed === 'object') return parsed;
      }
      if (
        initialMasterSnap?.manualStockOpeningsV2 &&
        typeof initialMasterSnap.manualStockOpeningsV2 === 'object'
      ) {
        return initialMasterSnap.manualStockOpeningsV2;
      }
    } catch (e) {}
    return DEFAULT_STOCK_OPENINGS;
  });

  const [monthlySnapshots, setMonthlySnapshots] = useState<
    Record<string, MonthlyStockSnapshot>
  >(() => {
    try {
      if (initialMasterSnap?.monthlyStockSnapshots && typeof initialMasterSnap.monthlyStockSnapshots === 'object') {
        return initialMasterSnap.monthlyStockSnapshots;
      }
      const saved = safeGetStorage('plutus_monthly_stock_snapshots');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  const [dailyJournalEntries, setDailyJournalEntries] = useState<DailyJournalEntry[]>(() => {
    try {
      if (initialMasterSnap && Array.isArray(initialMasterSnap.dailyJournalEntries)) {
        return initialMasterSnap.dailyJournalEntries;
      }
      const saved = safeGetStorage('plutus_daily_journal_v9');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return DEFAULT_DAILY_JOURNAL_ENTRIES;
  });

  // Evaluate raw material stock levels against user-defined thresholds in real-time
  const stockEval = evaluateStockLevels(purchaseItems, stockThresholds);

  // Compute Live Stock Ledger across raw materials, compounds, drums, and finished goods
  const liveStockLedger = useMemo(() => {
    return computeLiveStockLedger({
      orders,
      purchaseItems,
      customStockItems,
      manualPackingItems,
      stockReturns,
      stockOpenings,
      densities,
      ladiDimensions,
      sizeRules,
      packagingRules,
    });
  }, [
    orders,
    purchaseItems,
    customStockItems,
    manualPackingItems,
    stockReturns,
    stockOpenings,
    densities,
    ladiDimensions,
    sizeRules,
    packagingRules,
  ]);

  // Persist activeTab immediately so re-opening the app returns to the same tab
  useEffect(() => {
    safeSetStorage('plutus_last_active_tab', activeTab);
  }, [activeTab]);

  // Apply a full restored state snapshot cleanly (strictly sanitized for clean-era v9)
  const applyRestoredSnapshot = (snap: Partial<PlutusFullAppState>, sourceLabel?: string) => {
    if (!snap || typeof snap !== 'object') return;
    isRestoringExternalRef.current = true;

    const normalized = normalizeCleanStateSnapshot(snap, snap.updatedAt);

    setOrders(normalized.orders);
    if (Array.isArray(snap.sizeRules) && snap.sizeRules.length > 0) setSizeRules(snap.sizeRules);
    if (Array.isArray(snap.packagingRules) && snap.packagingRules.length > 0) {
      setPackagingRules(snap.packagingRules);
    }
    if (Array.isArray(snap.colourMap) && snap.colourMap.length > 0) setColourMap(snap.colourMap);
    if (snap.densities) setDensities(snap.densities);
    if (Array.isArray(snap.ladiDimensions) && snap.ladiDimensions.length > 0) {
      setLadiDimensions(snap.ladiDimensions);
    }
    if (Array.isArray(snap.is694VihanRules) && snap.is694VihanRules.length > 0) {
      setIs694VihanRules(snap.is694VihanRules);
      saveVihanTriguardCartonRules(snap.is694VihanRules);
    }
    if (Array.isArray(snap.is694MaruRules) && snap.is694MaruRules.length > 0) {
      setIs694MaruRules(snap.is694MaruRules);
      saveMaruMiracleCartonRules(snap.is694MaruRules);
    }
    setPurchaseItems(normalized.purchaseItems);
    setManualPackingItems(normalized.manualPackingItems);
    setContainerPlans(normalized.containerPlans);
    setDispatchedContainers(normalized.dispatchedContainers);
    setDispatchRecords(normalized.dispatchRecords || []);
    setCustomStockItems(normalized.customStockItems);
    if (normalized.pvcOverrides && typeof normalized.pvcOverrides === 'object') {
      setPvcOverrides(normalized.pvcOverrides);
    }
    if (typeof normalized.copSlipNotes === 'string') setCopSlipNotes(normalized.copSlipNotes);
    if (snap.stockThresholds) setStockThresholds(snap.stockThresholds);
    setBatchHistory(normalized.batchHistory);
    setStockReturns(normalized.stockReturnRejections || []);
    if (snap.manualStockOpeningsV2 && typeof snap.manualStockOpeningsV2 === 'object') {
      setStockOpenings(prev => {
        const merged = { ...snap.manualStockOpeningsV2 };
        Object.keys(prev).forEach(k => {
          if (prev[k] !== undefined) {
            merged[k] = prev[k];
          }
        });
        safeSetStorage('plutus_stock_openings', JSON.stringify(merged));
        safeSetStorage('plutus_stock_openings_manual_v2', JSON.stringify(merged));
        return merged;
      });
    }
    if (snap.monthlyStockSnapshots && typeof snap.monthlyStockSnapshots === 'object') {
      setMonthlySnapshots(snap.monthlyStockSnapshots);
    }
    setDailyJournalEntries(normalized.dailyJournalEntries || []);
    if (normalized.updatedAt) {
      safeSetStorage('plutus_last_saved_at_v9', normalized.updatedAt);
      setLastAutoSavedAt(normalized.updatedAt);
    }
    if (sourceLabel) {
      showNotice(`✅ Auto-restored your saved manual data (${sourceLabel}).`);
    }
    setTimeout(() => {
      isRestoringExternalRef.current = false;
    }, 150);
  };

  const handleUpdateVihanRules = (rules: VihanTriguardCartonRule[]) => {
    setIs694VihanRules(rules);
    saveVihanTriguardCartonRules(rules);
  };

  const handleUpdateMaruRules = (rules: MaruMiracleCartonRule[]) => {
    setIs694MaruRules(rules);
    saveMaruMiracleCartonRules(rules);
  };

  // Keep a ref to the latest complete state for synchronous beforeunload / visibilitychange flushes
  const latestStateRef = useRef<Omit<PlutusFullAppState, 'updatedAt'>>({
    orders,
    sizeRules,
    packagingRules,
    colourMap,
    densities,
    ladiDimensions,
    is694VihanRules,
    is694MaruRules,
    purchaseItems,
    manualPackingItems,
    containerPlans,
    dispatchedContainers,
    dispatchRecords,
    customStockItems,
    pvcOverrides,
    copSlipNotes,
    stockThresholds,
    batchHistory,
    stockReturnRejections: stockReturns,
    stockOpenings,
    manualStockOpeningsV2: stockOpenings,
    monthlyStockSnapshots: monthlySnapshots,
    dailyJournalEntries,
    activeTab,
  });

  latestStateRef.current = {
    orders,
    sizeRules,
    packagingRules,
    colourMap,
    densities,
    ladiDimensions,
    is694VihanRules,
    is694MaruRules,
    purchaseItems,
    manualPackingItems,
    containerPlans,
    dispatchedContainers,
    dispatchRecords,
    customStockItems,
    pvcOverrides,
    copSlipNotes,
    stockThresholds,
    batchHistory,
    stockReturnRejections: stockReturns,
    stockOpenings,
    manualStockOpeningsV2: stockOpenings,
    monthlyStockSnapshots: monthlySnapshots,
    dailyJournalEntries,
    activeTab,
  };

  // Multi-layer Auto-Save on every state change (LocalStorage + IndexedDB + Cloud RTDB)
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    if (!isHydrationCompleteRef.current || isRestoringExternalRef.current) {
      const existingStamp = safeGetStorage('plutus_last_saved_at_v9') || new Date().toISOString();
      saveFullStateToLocalStorage(latestStateRef.current, existingStamp);
      saveStateToIndexedDB({
        ...latestStateRef.current,
        updatedAt: existingStamp,
      });
      setSyncIndicator('saved');
      return;
    }

    const savedIso = saveFullStateToLocalStorage(latestStateRef.current, new Date().toISOString());
    setLastAutoSavedAt(savedIso);
    setSyncIndicator('saving');

    const fullSnap: PlutusFullAppState = {
      ...latestStateRef.current,
      updatedAt: savedIso,
    };

    saveStateToIndexedDB(fullSnap);

    const timer = setTimeout(() => {
      Promise.allSettled([
        pushStateToCloud(fullSnap),
        driveUser ? saveWorkspaceToFirestore(fullSnap) : Promise.resolve(null),
      ]).finally(() => {
        setSyncIndicator('saved');
      });
    }, 600);

    return () => clearTimeout(timer);
  }, [
    orders,
    sizeRules,
    packagingRules,
    colourMap,
    densities,
    ladiDimensions,
    is694VihanRules,
    is694MaruRules,
    purchaseItems,
    manualPackingItems,
    containerPlans,
    dispatchedContainers,
    dispatchRecords,
    customStockItems,
    pvcOverrides,
    copSlipNotes,
    stockThresholds,
    batchHistory,
    stockReturns,
    stockOpenings,
    monthlySnapshots,
    dailyJournalEntries,
  ]);

  // Immediate synchronous flush when user closes window/tab or switches away
  useEffect(() => {
    const flushNow = () => {
      const stamp = safeGetStorage('plutus_last_saved_at_v9') || new Date().toISOString();
      saveFullStateToLocalStorage(latestStateRef.current, stamp);
      const snap: PlutusFullAppState = {
        ...latestStateRef.current,
        updatedAt: stamp,
      };
      saveStateToIndexedDB(snap);
      pushStateToCloud(snap, true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushNow();
      }
    };

    window.addEventListener('beforeunload', flushNow);
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', flushNow);
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Service Worker Background Sync Registration, Message Channel & Automatic Reconnect Flush
  useEffect(() => {
    let mounted = true;
    let bc: BroadcastChannel | null = null;

    // 1. Register Service Worker for Android PWA Background Sync
    registerBackgroundSyncServiceWorker().then(reg => {
      if (mounted && reg) {
        setSwReady(true);
      }
    });

    // 2. Listen for custom window status updates from autoSavePersistence
    const handleSyncStatusEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && mounted) {
        setPendingOfflineSync({
          hasPending: Boolean(detail.hasPending),
          editCount: Number(detail.editCount) || 0,
          queuedAt: detail.queuedAt || null,
        });
      }
    };

    // 3. Handle incoming Service Worker messages (via postMessage or BroadcastChannel)
    const handleSwMessagePayload = (data: any) => {
      if (!data || typeof data !== 'object' || !mounted) return;
      if (data.type === 'PLUTUS_BG_SYNC_STARTED') {
        setIsBgSyncFlushing(true);
        setSyncIndicator('saving');
      } else if (data.type === 'PLUTUS_BG_SYNC_COMPLETED') {
        setIsBgSyncFlushing(false);
        setSyncIndicator('saved');
        clearPendingOfflineSyncQueue(data.pushedUpdatedAt || data.syncedAt);
        setPendingOfflineSync({ hasPending: false, editCount: 0, queuedAt: null });
        if (data.pushedUpdatedAt) {
          setLastAutoSavedAt(data.pushedUpdatedAt);
        }
        if (
          data.mergedState &&
          isTimestampAfterCleanCutoff(data.mergedState.updatedAt) &&
          Array.isArray(data.mergedState.orders)
        ) {
          const normalized = normalizeCleanStateSnapshot(data.mergedState, data.mergedState.updatedAt);
          applyRestoredSnapshot(normalized);
          saveFullStateToLocalStorage(normalized, normalized.updatedAt);
        }
        showNotice(
          `☁️ Background Sync Complete: Automatically pushed ${data.editCount || 1} offline edit(s) to Cloud RTDB!`
        );
      } else if (data.type === 'PLUTUS_BG_SYNC_QUEUED' || data.type === 'PLUTUS_BG_SYNC_ARMED') {
        const latestStatus = getPendingOfflineSyncStatusSync();
        setPendingOfflineSync({
          hasPending: true,
          editCount: data.editCount || latestStatus.editCount || 1,
          queuedAt: data.queuedAt || data.updatedAt || latestStatus.queuedAt || new Date().toISOString(),
        });
      }
    };

    const handleNavigatorSwMessage = (event: MessageEvent) => {
      handleSwMessagePayload(event.data);
    };

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel(BG_SYNC_BROADCAST_CHANNEL);
        bc.onmessage = event => handleSwMessagePayload(event.data);
      }
    } catch {}

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleNavigatorSwMessage);
    }
    window.addEventListener('plutus-offline-sync-status', handleSyncStatusEvent);

    // 4. Immediate automatic flush the moment the device regains connectivity
    const handleRegainedConnectivity = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const status = getPendingOfflineSyncStatusSync();
      const idbPending = await loadPendingOfflineSyncFromIndexedDB();
      if (!status.hasPending && !idbPending) return;

      const countToReport = status.editCount || idbPending?.editCount || 1;
      if (mounted) {
        setIsBgSyncFlushing(true);
        setSyncIndicator('saving');
      }

      const fallbackSnap: PlutusFullAppState = {
        ...latestStateRef.current,
        updatedAt: safeGetStorage('plutus_last_saved_at_v9') || new Date().toISOString(),
      };

      const ok = await triggerImmediateBackgroundSyncFlush(fallbackSnap);
      if (mounted) {
        setIsBgSyncFlushing(false);
        setSyncIndicator('saved');
        if (ok) {
          setPendingOfflineSync({ hasPending: false, editCount: 0, queuedAt: null });
          showNotice(
            `☁️ Connection Restored — Background Sync pushed ${countToReport} offline edit(s) to Cloud RTDB!`
          );
        }
      }
    };

    window.addEventListener('online', handleRegainedConnectivity);
    const conn = typeof navigator !== 'undefined' ? (navigator as any).connection : null;
    if (conn && typeof conn.addEventListener === 'function') {
      conn.addEventListener('change', handleRegainedConnectivity);
    }

    return () => {
      mounted = false;
      if (bc) {
        try {
          bc.close();
        } catch {}
      }
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleNavigatorSwMessage);
      }
      window.removeEventListener('plutus-offline-sync-status', handleSyncStatusEvent);
      window.removeEventListener('online', handleRegainedConnectivity);
      if (conn && typeof conn.removeEventListener === 'function') {
        conn.removeEventListener('change', handleRegainedConnectivity);
      }
    };
  }, []);

  // On startup: verify clean-era IndexedDB, flush any pending post-cutoff offline edits, and sync with Cloud RTDB
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        purgeAllLegacyPreCutoffStorage();

        let localMs = getLastLocalSavedTimestamp();

        // 0. Check if there are queued post-cutoff offline edits in clean-era IndexedDB waiting for Background Sync
        const pendingIdb = await loadPendingOfflineSyncFromIndexedDB();
        if (
          !cancelled &&
          !userModifiedInSessionRef.current &&
          pendingIdb?.state &&
          isTimestampAfterCleanCutoff(pendingIdb.state.updatedAt)
        ) {
          const pendingMs = Date.parse(pendingIdb.state.updatedAt || '');
          if (!isNaN(pendingMs) && pendingMs >= localMs) {
            applyRestoredSnapshot(pendingIdb.state, 'Offline Outbox Queue');
            saveFullStateToLocalStorage(pendingIdb.state, pendingIdb.state.updatedAt);
            localMs = pendingMs;
          }
          setPendingOfflineSync({
            hasPending: true,
            editCount: pendingIdb.editCount || 1,
            queuedAt: pendingIdb.queuedAt || pendingIdb.state.updatedAt,
          });
        }

        // 1. Check clean-era IndexedDB fallback (strictly post-cutoff)
        const idbState = await loadStateFromIndexedDB();
        if (
          !cancelled &&
          !userModifiedInSessionRef.current &&
          idbState &&
          isTimestampAfterCleanCutoff(idbState.updatedAt)
        ) {
          const idbMs = Date.parse(idbState.updatedAt || '');
          const localHasOrders = latestStateRef.current.orders.length > 0;
          const idbHasOrders = Array.isArray(idbState.orders) && idbState.orders.length > 0;
          if (
            !isNaN(idbMs) &&
            Array.isArray(idbState.orders) &&
            ((idbMs > localMs && (idbHasOrders || !localHasOrders)) ||
              (!localHasOrders && idbHasOrders))
          ) {
            applyRestoredSnapshot(idbState, 'Local Database');
            saveFullStateToLocalStorage(idbState, idbState.updatedAt);
            localMs = Math.max(localMs, idbMs);
          }
        }

        // 2. If there are unpushed post-cutoff offline edits and we are now online, push them to Cloud RTDB first!
        if (
          !cancelled &&
          (pendingIdb || getPendingOfflineSyncStatusSync().hasPending) &&
          (typeof navigator === 'undefined' || navigator.onLine)
        ) {
          const stateToFlush: PlutusFullAppState = pendingIdb?.state || {
            ...latestStateRef.current,
            updatedAt: safeGetStorage('plutus_last_saved_at_v9') || new Date().toISOString(),
          };
          const pushed = await pushStateToCloud(stateToFlush);
          if (pushed && !cancelled) {
            setPendingOfflineSync({ hasPending: false, editCount: 0, queuedAt: null });
            showNotice('☁️ Background Sync: Pushed queued offline edits to Cloud RTDB!');
          }
        }

        // 3. Check Cloud Realtime Database for newer post-cutoff auto-saved state
        const cloudResult = await fetchStateFromCloud();
        if (cancelled || userModifiedInSessionRef.current) return;

        const localOrdersCount = latestStateRef.current.orders.length;
        const cloudOrdersCount = cloudResult?.v5State?.orders?.length || 0;

        if (
          cloudResult?.v5State &&
          isTimestampAfterCleanCutoff(cloudResult.v5State.updatedAt) &&
          !getPendingOfflineSyncStatusSync().hasPending &&
          // Never overwrite non-empty local manual orders with an empty Cloud array!
          (cloudOrdersCount > 0 || localOrdersCount === 0) &&
          ((cloudResult.updatedAtMs > localMs && cloudOrdersCount >= localOrdersCount) ||
            (localOrdersCount === 0 && cloudOrdersCount > 0))
        ) {
          applyRestoredSnapshot(cloudResult.v5State, 'Cloud Sync');
          saveFullStateToLocalStorage(cloudResult.v5State, cloudResult.v5State.updatedAt);
          saveStateToIndexedDB(cloudResult.v5State);
        } else if (
          localOrdersCount > 0 &&
          (localMs > (cloudResult?.updatedAtMs || 0) || cloudOrdersCount === 0)
        ) {
          // Local has manual orders that are newer than Cloud (or Cloud was empty) — push local manual orders to Cloud!
          const nowIso = safeGetStorage('plutus_last_saved_at_v9') || new Date().toISOString();
          pushStateToCloud({
            ...latestStateRef.current,
            updatedAt: nowIso,
          });
        }
      } finally {
        if (!cancelled) {
          isHydrationCompleteRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Continuous Real-Time Multi-Device Sync (polls Cloud updatedAt every 4s + on window focus + storage event)
  useEffect(() => {
    let isChecking = false;

    const checkRealtimeCloudUpdates = async () => {
      if (isChecking || isRestoringExternalRef.current || !isHydrationCompleteRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      isChecking = true;
      try {
        // First: if we have unpushed offline edits queued while offline, flush them to Cloud RTDB now!
        const pendingStatus = getPendingOfflineSyncStatusSync();
        if (pendingStatus.hasPending) {
          const snapToFlush: PlutusFullAppState = {
            ...latestStateRef.current,
            updatedAt: safeGetStorage('plutus_last_saved_at_v9') || new Date().toISOString(),
          };
          const flushed = await triggerImmediateBackgroundSyncFlush(snapToFlush);
          if (flushed) {
            setPendingOfflineSync({ hasPending: false, editCount: 0, queuedAt: null });
            showNotice(
              `☁️ Background Sync Complete: Pushed ${pendingStatus.editCount} offline edit(s) to Cloud RTDB!`
            );
          }
          return;
        }

        const cloudMs = await fetchCloudUpdatedAt();
        const localMs = getLastLocalSavedTimestamp();
        if (cloudMs >= CLEAN_ERA_CUTOFF_MS && cloudMs > localMs + 500) {
          const cloudResult = await fetchStateFromCloud();
          if (
            cloudResult?.v5State &&
            isTimestampAfterCleanCutoff(cloudResult.v5State.updatedAt) &&
            cloudResult.updatedAtMs > getLastLocalSavedTimestamp()
          ) {
            applyRestoredSnapshot(cloudResult.v5State);
            saveFullStateToLocalStorage(cloudResult.v5State, cloudResult.v5State.updatedAt);
            await saveStateToIndexedDB(cloudResult.v5State);
            showNotice('🔄 Live Sync: Updated with real-time changes from another device!');
          }
        }
      } catch {
        // ignore transient network errors
      } finally {
        isChecking = false;
      }
    };

    const intervalId = window.setInterval(checkRealtimeCloudUpdates, 4000);

    const handleFocus = () => {
      checkRealtimeCloudUpdates();
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'plutus_manual_autosave_v9' && e.newValue) {
        try {
          const snap = JSON.parse(e.newValue) as PlutusFullAppState;
          const incomingMs = Date.parse(snap.updatedAt || '');
          if (incomingMs >= CLEAN_ERA_CUTOFF_MS && incomingMs > getLastLocalSavedTimestamp()) {
            applyRestoredSnapshot(snap);
          }
        } catch {}
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, []);

  // Automatically propagate any 12. Backup (sizeRules, packagingRules, densities, ladiDimensions)
  // or Order changes into Container Plans and Manual Packing items!
  useEffect(() => {
    setContainerPlans(prev => {
      const next = syncContainerPlansWithBackup(
        prev,
        orders,
        sizeRules,
        packagingRules,
        densities,
        ladiDimensions
      );
      if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
      return next;
    });
  }, [orders, sizeRules, packagingRules, densities, ladiDimensions]);

  useEffect(() => {
    setManualPackingItems(prev => {
      if (!prev || prev.length === 0) return prev;
      let changed = false;
      const next = prev.map(item => {
        const pkgRule = lookupPackagingRuleBySpool(item.spool, packagingRules);
        if (pkgRule) {
          const nextSpool = pkgRule.spool || item.spool;
          const nextPallet = pkgRule.pallet || item.palletSize || '30X30x6';
          if (item.spool !== nextSpool || item.palletSize !== nextPallet) {
            changed = true;
            return {
              ...item,
              spool: nextSpool,
              palletSize: nextPallet,
            };
          }
        }
        return item;
      });
      return changed ? next : prev;
    });
  }, [packagingRules]);

  // Immediate synchronous persistence helper so any manual order entered/edited/deleted
  // is saved in 0ms to LocalStorage, IndexedDB, and Cloud RTDB and never lost on reopen
  const persistOrdersImmediately = (
    nextOrders: CableOrder[],
    extraOverrides?: Partial<PlutusFullAppState>
  ) => {
    userModifiedInSessionRef.current = true;
    const nowIso = new Date().toISOString();
    const nextState: PlutusFullAppState = {
      ...latestStateRef.current,
      ...extraOverrides,
      orders: nextOrders,
      updatedAt: nowIso,
    };
    latestStateRef.current = nextState;
    saveFullStateToLocalStorage(nextState, nowIso);
    setLastAutoSavedAt(nowIso);
    saveStateToIndexedDB(nextState);
    pushStateToCloud(nextState);
  };

  // Order Handlers
  const handleAddOrUpdateOrder = (order: CableOrder) => {
    removeDeletedOrderId(order.id);
    setOrders(prev => {
      const idx = prev.findIndex(o => o.id === order.id);
      const next =
        idx > -1
          ? prev.map((item, i) => (i === idx ? order : item))
          : [...prev, order];
      persistOrdersImmediately(next);
      return next;
    });
  };

  const handleDeleteOrder = (id: number) => {
    addDeletedOrderId(id);
    setOrders(prev => {
      const next = prev.filter(o => o.id !== id);
      persistOrdersImmediately(next);
      return next;
    });
    showNotice(`Deleted Order #${id}.`);
  };

  const handleClearAllOrders = () => {
    const existingIds = orders.map(o => Number(o.id)).filter(n => !isNaN(n));
    addDeletedOrderIds(existingIds);
    setOrders([]);
    setContainerPlans([]);
    setBatchHistory([]);
    persistOrdersImmediately([], {
      containerPlans: [],
      batchHistory: [],
    });
    showNotice('🗑️ Deleted all orders. You can now enter your new manual orders cleanly.');
  };

  const handleDuplicateOrder = (id: number) => {
    const o = orders.find(x => x.id === id);
    if (!o) return;
    const newId = orders.length > 0 ? Math.max(...orders.map(x => x.id)) + 1 : 1;
    removeDeletedOrderId(newId);
    const duplicatedOrder: CableOrder = { ...o, id: newId, record_row: newId + 11 };
    setOrders(prev => {
      const next = [...prev, duplicatedOrder];
      persistOrdersImmediately(next);
      return next;
    });
    showNotice(`Duplicated Order #${id} as Order #${newId}.`);
  };

  // Bunched Copper Allocation & Auto-Deduction Handlers
  const handleUseBunchedCopper = (orderId: number, purchaseItemId: number, customQty?: number) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const purchase = purchaseItems.find(p => p.id === purchaseItemId);
    if (!purchase) return;

    const r = computeRecordRow(order, densities, ladiDimensions);
    const qtyToDeduct = customQty !== undefined ? customQty : (r.reqCu || 0);
    const nowIso = new Date().toISOString();

    setPurchaseItems(prev =>
      prev.map(p => {
        if (p.id !== purchaseItemId) return p;
        const currentUsed = p.usedQty || 0;
        return {
          ...p,
          usedQty: currentUsed + qtyToDeduct,
        };
      })
    );

    setOrders(prev =>
      prev.map(o => {
        if (o.id !== orderId) return o;
        const currentP = o.pStatus || { b: false, c: false, i: false, t: false, s: false };
        return {
          ...o,
          bunch_source: 'purchased_stock',
          purchased_copper_id: purchaseItemId,
          purchased_copper_deducted_qty: qtyToDeduct,
          pStatus: {
            ...currentP,
            b: true,
          },
          pTimestamps: {
            ...(o.pTimestamps || {}),
            b: nowIso,
          },
        };
      })
    );

    setBatchHistory(prev => [
      {
        id: `HIST-${Date.now()}-${order.id}-b`,
        batch: order.batch,
        orderId: order.id,
        brand: order.brand,
        cores: order.cores,
        size: order.size,
        stageKey: 'b',
        stageLabel: STAGE_LABELS.b,
        action: 'completed',
        timestamp: nowIso,
        note: `Allocated ${qtyToDeduct.toFixed(1)} kg from Purchased Bunched Cu (${purchase.invoice})`,
      },
      ...prev,
    ]);
  };

  const handleRevertBunchedCopper = (orderId: number) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || !order.purchased_copper_id) return;

    const pId = order.purchased_copper_id;
    const deductedQty = order.purchased_copper_deducted_qty || 0;
    const nowIso = new Date().toISOString();

    setPurchaseItems(prev =>
      prev.map(p => {
        if (p.id !== pId) return p;
        const currentUsed = p.usedQty || 0;
        return {
          ...p,
          usedQty: Math.max(0, currentUsed - deductedQty),
        };
      })
    );

    setOrders(prev =>
      prev.map(o => {
        if (o.id !== orderId) return o;
        return {
          ...o,
          bunch_source: undefined,
          purchased_copper_id: undefined,
          purchased_copper_deducted_qty: undefined,
          pStatus: {
            b: false,
            c: false,
            i: false,
            t: false,
            s: false,
          },
          pTimestamps: {},
        };
      })
    );

    setBatchHistory(prev => [
      {
        id: `HIST-${Date.now()}-${order.id}-b-rev`,
        batch: order.batch,
        orderId: order.id,
        brand: order.brand,
        cores: order.cores,
        size: order.size,
        stageKey: 'b',
        stageLabel: STAGE_LABELS.b,
        action: 'reset',
        timestamp: nowIso,
        note: 'Reverted purchased bunched copper allocation',
      },
      ...prev,
    ]);
  };

  const handleToggleProcess = (orderId: number, processKey: 'b' | 'c' | 'i' | 't' | 's') => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    if (processKey === 'b' && order.pStatus?.b && order.bunch_source === 'purchased_stock') {
      handleRevertBunchedCopper(orderId);
      return;
    }

    const result = applySerialStageToggle(order, processKey, undefined, ladiDimensions);
    if (!result.allowed) {
      if (result.reason) {
        showNotice(`⚠️ ${result.reason}`);
      }
      return;
    }

    const nowIso = new Date().toISOString();
    const isMarkedCompleted = Boolean(result.pStatus[processKey]);

    setOrders(prev =>
      prev.map(o => {
        if (o.id !== orderId) return o;
        const nextTimestamps = { ...(o.pTimestamps || {}) };
        if (isMarkedCompleted) {
          nextTimestamps[processKey] = nowIso;
        } else {
          delete nextTimestamps[processKey];
          if (result.cascadedResetKeys) {
            for (const rk of result.cascadedResetKeys) {
              delete nextTimestamps[rk];
            }
          }
        }
        return {
          ...o,
          pStatus: result.pStatus,
          pTimestamps: nextTimestamps,
        };
      })
    );

    const newEntries: BatchHistoryEntry[] = [
      {
        id: `HIST-${Date.now()}-${order.id}-${processKey}`,
        batch: order.batch,
        orderId: order.id,
        brand: order.brand,
        cores: order.cores,
        size: order.size,
        stageKey: processKey,
        stageLabel: STAGE_LABELS[processKey],
        action: isMarkedCompleted ? 'completed' : 'reset',
        timestamp: nowIso,
        note:
          !isMarkedCompleted && result.cascadedResetKeys && result.cascadedResetKeys.length > 0
            ? `Also reset dependent: ${result.cascadedResetKeys.map(k => STAGE_LABELS[k]).join(', ')}`
            : `Conductor ${order.conductor}`,
      },
    ];

    setBatchHistory(prev => [...newEntries, ...prev]);

    if (result.cascadedResetKeys && result.cascadedResetKeys.length > 0) {
      showNotice(
        `🔄 Unmarked ${STAGE_LABELS[processKey]} — subsequent dependent stages were automatically reset to maintain serial order.`
      );
    }
  };

  const handleSelectForRequisition = (batch: string, brand: string, size: string, orderId?: number) => {
    setReqTarget({ batch, brand, size, orderId });
    setActiveTab('requisition');
  };

  // Packing list import
  const handleImportOrdersToPacking = (batchChoice: string, sizeChoice: string) => {
    let countAdded = 0;
    const newItems: ManualPackingItem[] = [];

    orders.forEach(o => {
      if ((o.grade || '').toUpperCase().includes('IS-694')) return;
      if (batchChoice && o.batch.toLowerCase() !== batchChoice.toLowerCase()) return;
      if (sizeChoice && !o.size.toLowerCase().includes(sizeChoice.toLowerCase())) return;

      const r = computeRecordRow(o, densities, ladiDimensions);
      const evalPkg = evaluateSpoolSizeForOrder(
        r.finalDia,
        r.orderLen,
        r.size,
        r.cores,
        r.grade,
        sizeRules,
        packagingRules,
        o.spool_size
      );
      const drumLen = (evalPkg.packaging || '').includes('500') ? 500 : 1000;

      let remLen = r.orderLen;
      let spoolIdx = 1;
      while (remLen > 0) {
        const currentLen = Math.min(drumLen, remLen);
        const drumNo = `${o.batch}-${o.brand}-${r.sizeNum.toFixed(2)}-D${spoolIdx}`;
        const cuShare = r.orderLen > 0 ? r.reqCu * (currentLen / r.orderLen) : 0;
        const compShare =
          r.orderLen > 0 ? (r.reqIns + r.reqSheath) * (currentLen / r.orderLen) : 0;
        const totalReelWt = cuShare + compShare + 25;

        const exists =
          manualPackingItems.some(m => m.drumNo === drumNo) ||
          newItems.some(m => m.drumNo === drumNo);

        if (!exists) {
          newItems.push({
            batch: o.batch,
            brandGrade: `${o.brand} ${o.grade || 'H07RN-F'}`,
            sizeCores: `${o.cores}C × ${o.size}`,
            spool: evalPkg.spool,
            drumNo,
            len: currentLen,
            cuWt: cuShare,
            compWt: compShare,
            totalWt: totalReelWt,
            pallet: evalPkg.pallet,
            status: 'Extracted',
            dispatched: false,
          });
          countAdded++;
        }
        remLen -= currentLen;
        spoolIdx++;
      }
    });

    if (countAdded > 0) {
      setManualPackingItems(prev => [...prev, ...newItems]);
      showNotice(`✅ Extracted ${countAdded} reels into the Packing List.`);
    } else {
      showNotice('All matching reels are already in the Packing List.');
    }
  };

  // Dispatch a single Reel / Drum & Auto-Deduct Finished Stock
  const handleDispatchReel = (payload: {
    isManual: boolean;
    manualIdx?: number;
    orderId?: number;
    batch: string;
    sizeCores: string;
    drumNo: string;
    len: number;
    cableWt: number;
  }) => {
    const nowIso = new Date().toISOString();

    if (payload.isManual && payload.manualIdx !== undefined) {
      setManualPackingItems(prev =>
        prev.map((m, idx) =>
          idx === payload.manualIdx
            ? { ...m, status: 'Dispatched', dispatched: true, dispatchedAt: nowIso }
            : m
        )
      );
    }

    // Also find matching order (either by orderId or by batch + sizeCores) to auto-deduct finished stock
    setOrders(prev =>
      prev.map(o => {
        const isTarget =
          payload.orderId !== undefined
            ? o.id === payload.orderId
            : o.batch === payload.batch && `${o.cores}C × ${o.size}` === payload.sizeCores;

        if (!isTarget) return o;

        const r = computeRecordRow(o, densities, ladiDimensions);
        const totalFinishedWt = r.reqCu + r.reqIns + r.reqSheath;
        const existingDrums = o.dispatchedDrums || [];
        if (existingDrums.includes(payload.drumNo)) return o;

        const nextDrums = [...existingDrums, payload.drumNo];
        const nextLen = Math.min(r.orderLen, (o.dispatchedLength || 0) + payload.len);
        const nextWt = Math.min(
          totalFinishedWt,
          (o.dispatchedWeight || 0) + payload.cableWt
        );
        const allDispatched = nextLen >= r.orderLen - 0.5;

        return {
          ...o,
          pStatus: { b: true, c: true, i: true, t: true, s: true },
          dispatchedDrums: nextDrums,
          dispatchedLength: nextLen,
          dispatchedWeight: nextWt,
          dispatched: allDispatched,
          dispatchedAt: nowIso,
        };
      })
    );

    // Also record dispatched item container-wise if it belongs to a planned container
    setDispatchedContainers(prev => {
      const matchingContainers = containerPlans.filter(c =>
        c.items.some(
          it =>
            (payload.orderId !== undefined && it.orderId === payload.orderId) ||
            (it.batch === payload.batch && it.sizeCores === payload.sizeCores)
        )
      );
      if (matchingContainers.length === 0) return prev;
      let next = [...prev];
      matchingContainers.forEach(cont => {
        const matchedItems = cont.items
          .filter(
            it =>
              (payload.orderId !== undefined && it.orderId === payload.orderId) ||
              (it.batch === payload.batch && it.sizeCores === payload.sizeCores)
          )
          .map(it => ({ ...it, dispatchedAt: nowIso }));
        const existingIdx = next.findIndex(
          r => r.containerId === cont.id || r.containerNo === cont.containerNo
        );
        if (existingIdx > -1) {
          const existing = next[existingIdx];
          const mergedItems = [...existing.items];
          matchedItems.forEach(mIt => {
            if (!mergedItems.some(x => x.id === mIt.id)) {
              mergedItems.push(mIt);
            }
          });
          next[existingIdx] = {
            ...existing,
            dispatchedAt: nowIso,
            items: mergedItems,
            totalDrums: mergedItems.reduce((s, i) => s + (Number(i.drumCount) || 0), 0),
            totalLength: mergedItems.reduce((s, i) => s + (Number(i.totalLength) || 0), 0),
            totalNetWt: mergedItems.reduce((s, i) => s + (Number(i.netCableWt) || 0), 0),
            totalGrossWt: mergedItems.reduce((s, i) => s + (Number(i.grossWt) || 0), 0),
          };
        } else {
          const totalDrums = cont.items.reduce((s, i) => s + (Number(i.drumCount) || 0), 0);
          const totalLength = cont.items.reduce((s, i) => s + (Number(i.totalLength) || 0), 0);
          const totalNetWt = cont.items.reduce((s, i) => s + (Number(i.netCableWt) || 0), 0);
          const totalGrossWt = cont.items.reduce((s, i) => s + (Number(i.grossWt) || 0), 0);
          const totalPalletWt = cont.customPalletWeightKg ?? Math.round(totalDrums * 6.8);
          const totalDrumsWt =
            cont.customDrumsWeightKg ??
            Math.max(0, Math.round(totalGrossWt - totalNetWt - totalPalletWt));
          next = [
            {
              id: `DISP-${cont.id}`,
              containerId: cont.id,
              containerNo: cont.containerNo,
              containerType: cont.containerType,
              planningSheetTitle: cont.planningSheetTitle,
              bookingNo: cont.bookingNo,
              sealNo: cont.sealNo,
              shippingLine: cont.shippingLine,
              vesselVoyage: cont.vesselVoyage,
              portOfLoading: cont.portOfLoading,
              destination: cont.destination,
              clientName: cont.clientName,
              plannedStuffingDate: cont.plannedStuffingDate,
              dispatchedAt: nowIso,
              etd: cont.etd,
              totalDrums,
              totalLength,
              totalNetWt,
              totalGrossWt,
              totalPalletWt,
              totalDrumsWt,
              totalCbm: cont.items.reduce((s, i) => s + (Number(i.volumeCbm) || 0), 0),
              customTotalLengthInch: cont.customTotalLengthInch,
              customPalletCells: cont.customPalletCells,
              notes: cont.notes,
              items: cont.items.map(it => ({ ...it, dispatchedAt: nowIso })),
            },
            ...next,
          ];
        }
      });
      return next;
    });

    // Automatically store in 6C Dispatch Details tab
    const matchedOrder = orders.find(o =>
      payload.orderId !== undefined
        ? o.id === payload.orderId
        : o.batch === payload.batch && `${o.cores}C × ${o.size}` === payload.sizeCores
    );
    const matchedManual =
      payload.isManual && payload.manualIdx !== undefined
        ? manualPackingItems[payload.manualIdx]
        : undefined;
    const r = matchedOrder ? computeRecordRow(matchedOrder, densities, ladiDimensions) : null;
    const pkgEval =
      matchedOrder && r
        ? evaluateSpoolSizeForOrder(
            r.finalDia,
            r.orderLen,
            r.size,
            r.cores,
            r.grade,
            sizeRules,
            packagingRules,
            matchedOrder.spool_size
          )
        : null;
    const spool = matchedManual?.spool || pkgEval?.spool || '';
    const pallet = matchedManual?.pallet || pkgEval?.pallet || '30X30x6';
    const tare = matchedManual ? 25 : (Number(matchedOrder?.tare_weight) || 25);
    const gross = payload.cableWt + tare;

    const newDispRecord: DispatchRecord = {
      id: `DSP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      dispatchNo: `DSP-${payload.drumNo ? payload.drumNo.replace(/[^a-zA-Z0-9-]/g, '') : Date.now().toString().slice(-4)}`,
      batch: payload.batch,
      orderId: payload.orderId,
      date: nowIso.split('T')[0],
      clientName: (matchedOrder as any)?.party_name || (matchedOrder as any)?.clientName || 'Production Client',
      destination: (matchedOrder as any)?.destination || 'Factory Dispatch',
      brand: matchedOrder?.brand || matchedManual?.brandGrade || 'MYBCAB',
      grade: matchedOrder?.grade || 'IS-694',
      sizeCores: payload.sizeCores,
      conductor: matchedOrder?.conductor || '',
      packagingType: 'DRUMS',
      drumCount: 1,
      drumNos: payload.drumNo,
      spoolSize: spool,
      palletSize: pallet,
      lengthM: payload.len,
      netWeightKg: payload.cableWt,
      grossWeightKg: gross,
      remarks: `Dispatched Reel ${payload.drumNo} from 6. Packing List`,
      status: 'Dispatched',
      createdAt: nowIso,
    };

    setDispatchRecords(prev => {
      if (
        prev.some(
          r =>
            r.drumNos === payload.drumNo ||
            (Array.isArray(r.drumNos) && r.drumNos.includes(payload.drumNo))
        )
      ) {
        return prev;
      }
      return [newDispRecord, ...prev];
    });

    showNotice(
      `🚚 Dispatched reel ${payload.drumNo} (-${payload.len.toLocaleString()} m / -${payload.cableWt.toFixed(2)} kg auto-deducted from Finished Stock & saved to 6C Dispatch Details)`,
      'dispatch',
      'View Dispatch Details'
    );
  };

  // Undo / Revert a single Reel Dispatch & Restore Finished Stock
  const handleRevertDispatchReel = (payload: {
    isManual: boolean;
    manualIdx?: number;
    orderId?: number;
    drumNo: string;
    len: number;
    cableWt: number;
  }) => {
    if (payload.isManual && payload.manualIdx !== undefined) {
      setManualPackingItems(prev =>
        prev.map((m, idx) =>
          idx === payload.manualIdx
            ? { ...m, status: 'Packed', dispatched: false, dispatchedAt: undefined }
            : m
        )
      );
    }

    if (payload.orderId !== undefined) {
      setOrders(prev =>
        prev.map(o => {
          if (o.id !== payload.orderId) return o;
          const nextDrums = (o.dispatchedDrums || []).filter(d => d !== payload.drumNo);
          const nextLen = Math.max(0, (o.dispatchedLength || 0) - payload.len);
          const nextWt = Math.max(0, (o.dispatchedWeight || 0) - payload.cableWt);
          return {
            ...o,
            dispatchedDrums: nextDrums,
            dispatchedLength: nextLen,
            dispatchedWeight: nextWt,
            dispatched: false,
          };
        })
      );
    }

    // When reverting a reel dispatch, remove from 6C Dispatch Details
    setDispatchRecords(prev =>
      prev.filter(
        r =>
          r.drumNos !== payload.drumNo &&
          !(Array.isArray(r.drumNos) && r.drumNos.includes(payload.drumNo))
      )
    );

    showNotice(
      `↩️ Reverted dispatch for ${payload.drumNo}. Restored +${payload.len.toLocaleString()} m (+${payload.cableWt.toFixed(2)} kg) to Finished Stock.`
    );
  };

  // Dispatch an entire Batch / Size & Auto-Deduct Finished Stock
  const handleDispatchBatch = (batchNo: string, sizeStr?: string) => {
    const nowIso = new Date().toISOString();
    let totalDeductedMtrs = 0;
    let totalDeductedKgs = 0;

    setManualPackingItems(prev =>
      prev.map(m => {
        const matchBatch = batchNo === 'ALL' || m.batch === batchNo;
        const matchSize = !sizeStr || m.sizeCores.includes(sizeStr);
        if (matchBatch && matchSize && !m.dispatched) {
          return {
            ...m,
            status: 'Dispatched',
            dispatched: true,
            dispatchedAt: nowIso,
          };
        }
        return m;
      })
    );

    setOrders(prev =>
      prev.map(o => {
        const matchBatch = batchNo === 'ALL' || o.batch === batchNo;
        const orderSizeCores = `${o.cores}C × ${o.size}`;
        const matchSize =
          !sizeStr || o.size.includes(sizeStr) || orderSizeCores.includes(sizeStr);

        // If batchNo === 'ALL', only dispatch orders that are already in packing (pStatus.s)
        if (batchNo === 'ALL' && !o.pStatus?.s) return o;

        if (matchBatch && matchSize) {
          const r = computeRecordRow(o, densities, ladiDimensions);
          const finishedWt = r.reqCu + r.reqIns + r.reqSheath;
          const newlyDeductedLen = Math.max(0, r.orderLen - (o.dispatchedLength || 0));
          const newlyDeductedWt = Math.max(0, finishedWt - (o.dispatchedWeight || 0));
          totalDeductedMtrs += newlyDeductedLen;
          totalDeductedKgs += newlyDeductedWt;

          // Build all drum serials for this order using exact evaluated drum length
          const evalPkg = evaluateSpoolSizeForOrder(
            r.finalDia,
            r.orderLen,
            r.size,
            r.cores,
            r.grade,
            sizeRules,
            packagingRules,
            o.spool_size
          );
          const drumLen = (evalPkg.packaging || '').includes('500') ? 500 : 1000;
          const drumNumbers: string[] = [];
          let rem = r.orderLen;
          let idx = 1;
          while (rem > 0) {
            drumNumbers.push(
              `${o.batch}-${o.brand}-${parseSizeNum(o.size).toFixed(2)}-D${idx}`
            );
            rem -= drumLen;
            idx++;
          }

          return {
            ...o,
            pStatus: { b: true, c: true, i: true, t: true, s: true },
            dispatched: true,
            dispatchedLength: r.orderLen,
            dispatchedWeight: finishedWt,
            dispatchedDrums: drumNumbers,
            dispatchedAt: nowIso,
          };
        }
        return o;
      })
    );

    // Automatically store in 6C Dispatch Details tab
    const matchingManuals = manualPackingItems.filter(
      m =>
        (batchNo === 'ALL' || m.batch === batchNo) &&
        (!sizeStr || m.sizeCores.includes(sizeStr))
    );
    const drumsList = matchingManuals.map(m => m.drumNo).filter(Boolean);
    const firstMatchedOrder = orders.find(
      o =>
        (batchNo === 'ALL' || o.batch === batchNo) &&
        (!sizeStr || `${o.cores}C × ${o.size}` === sizeStr || o.size.includes(sizeStr))
    );

    const batchDispRecord: DispatchRecord = {
      id: `DSP-BATCH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      dispatchNo: `DSP-BATCH-${batchNo.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now().toString().slice(-4)}`,
      batch: batchNo,
      orderId: firstMatchedOrder?.id,
      date: nowIso.split('T')[0],
      clientName: (firstMatchedOrder as any)?.party_name || (firstMatchedOrder as any)?.clientName || 'Production Client',
      destination: (firstMatchedOrder as any)?.destination || 'Factory Dispatch',
      brand: firstMatchedOrder?.brand || 'MYBCAB',
      grade: firstMatchedOrder?.grade || 'IS-694',
      sizeCores:
        sizeStr ||
        (firstMatchedOrder
          ? `${firstMatchedOrder.cores}C × ${firstMatchedOrder.size}`
          : 'Batch Assorted'),
      conductor: firstMatchedOrder?.conductor || '',
      packagingType: 'DRUMS',
      drumCount: drumsList.length || 1,
      drumNos:
        drumsList.length > 0
          ? drumsList.slice(0, 5).join(', ') +
            (drumsList.length > 5 ? ` (+${drumsList.length - 5} more)` : '')
          : `${batchNo}-D1`,
      lengthM: totalDeductedMtrs || (firstMatchedOrder?.order_length || 0),
      netWeightKg: totalDeductedKgs || 0,
      grossWeightKg: (totalDeductedKgs || 0) + (drumsList.length || 1) * 25,
      remarks: `Batch Dispatch from 6. Packing List (${batchNo}${sizeStr ? ` • ${sizeStr}` : ''})`,
      status: 'Dispatched',
      createdAt: nowIso,
    };

    setDispatchRecords(prev => [batchDispRecord, ...prev]);

    showNotice(
      `🚚 Dispatched Batch "${batchNo}"${sizeStr ? ` (${sizeStr})` : ''} — Auto-deducted ${totalDeductedMtrs.toLocaleString()} m (${totalDeductedKgs.toFixed(2)} kg) from Finished Stock & saved to 6C Dispatch Details!`,
      'dispatch',
      'View Dispatch Details'
    );
  };

  // Dispatch Container & Auto-Deduct Finished Stock for all loaded orders
  const handleDispatchContainerOrders = (
    containerId: string,
    orderIds: number[],
    batches: string[]
  ) => {
    const nowIso = new Date().toISOString();
    let totalDeductedMtrs = 0;
    let totalDeductedKgs = 0;

    setOrders(prev =>
      prev.map(o => {
        const isMatched =
          orderIds.includes(o.id) || (orderIds.length === 0 && batches.includes(o.batch));
        if (!isMatched) return o;

        const r = computeRecordRow(o, densities, ladiDimensions);
        const finishedWt = r.reqCu + r.reqIns + r.reqSheath;
        totalDeductedMtrs += Math.max(0, r.orderLen - (o.dispatchedLength || 0));
        totalDeductedKgs += Math.max(0, finishedWt - (o.dispatchedWeight || 0));

        return {
          ...o,
          pStatus: { b: true, c: true, i: true, t: true, s: true },
          dispatched: true,
          dispatchedLength: r.orderLen,
          dispatchedWeight: finishedWt,
          dispatchedAt: nowIso,
        };
      })
    );

    showNotice(
      `🚢 Container Dispatched! Auto-deducted ${totalDeductedMtrs.toLocaleString()} m (${totalDeductedKgs.toFixed(2)} kg) from Finished Stock.`,
      'stockslip',
      'Verify in Stock Slip'
    );
  };

  // Master Dispatch Records Handlers
  const handleAddDispatchRecord = (rec: DispatchRecord) => {
    setDispatchRecords(prev => [rec, ...prev]);
    showNotice(
      `📦 Recorded Dispatch #${rec.dispatchNo} for ${rec.batch} (${rec.sizeCores})!`
    );
  };

  const handleUpdateDispatchRecord = (rec: DispatchRecord) => {
    setDispatchRecords(prev => {
      const idx = prev.findIndex(r => r.id === rec.id);
      if (idx > -1) {
        return prev.map(r => (r.id === rec.id ? rec : r));
      }
      return [rec, ...prev];
    });
    showNotice(`Updated Dispatch Record #${rec.dispatchNo}.`);
  };

  const handleDeleteDispatchRecord = (id: string) => {
    setDispatchRecords(prev => prev.filter(r => r.id !== id));
    if (id.startsWith('ORD-DSP-')) {
      const orderId = Number(id.replace('ORD-DSP-', ''));
      setOrders(prev =>
        prev.map(o =>
          o.id === orderId
            ? { ...o, dispatched: false, dispatchedDrums: [], dispatchedLength: 0, dispatchedWeight: 0 }
            : o
        )
      );
    }
    showNotice('Deleted dispatch record.');
  };

  const handleClearAllDispatchRecords = () => {
    setDispatchRecords([]);
    showNotice('🗑️ Cleared all dispatch records from 6C Dispatch Details.');
  };

  // Full backup restore (supports JSON backup, v9ManualState, v5State, and embedded state from Laptop .html app)
  const handleRestoreFullBackup = (data: any, sourceLabel = 'Laptop File / Backup') => {
    if (!data || typeof data !== 'object') return;
    const targetSnap = data.v9ManualState || data.v5State || data;
    const normalized = normalizeCleanStateSnapshot(targetSnap, new Date().toISOString());
    applyRestoredSnapshot(normalized, sourceLabel);
    saveFullStateToLocalStorage(normalized, normalized.updatedAt);
    saveStateToIndexedDB(normalized);
    pushStateToCloud(normalized);
  };

  const handleImportLaptopFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const text = String(ev.target?.result || '');
        const marker = 'window.__PLUTUS_EMBEDDED_STATE__ = ';
        const mIdx = text.indexOf(marker);
        if (mIdx !== -1) {
          const start = mIdx + marker.length;
          let depth = 0;
          let inStr = false;
          let esc = false;
          let end = start;
          for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (inStr) {
              if (esc) esc = false;
              else if (ch === '\\') esc = true;
              else if (ch === '"') inStr = false;
            } else {
              if (ch === '"') inStr = true;
              else if (ch === '{') depth++;
              else if (ch === '}') {
                depth--;
                if (depth === 0) {
                  end = i + 1;
                  break;
                }
              }
            }
          }
          const parsedHtmlState = JSON.parse(text.slice(start, end));
          handleRestoreFullBackup(parsedHtmlState, `Laptop App (${file.name})`);
          return;
        }
        const parsedJson = JSON.parse(text);
        handleRestoreFullBackup(parsedJson, file.name);
      } catch {
        showNotice('⚠️ Could not parse selected file. Please select your saved PLUTUS_CABLE_PRODUCTION_LAPTOP_APP.html or .json backup file.');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleForceCloudUpload = async () => {
    setSyncIndicator('saving');
    const localMs = getLastLocalSavedTimestamp();
    const cloudMs = await fetchCloudUpdatedAt();

    // Smart Two-Way Real-Time Sync: if Cloud has newer post-cutoff edits from another device, pull them first!
    if (cloudMs >= CLEAN_ERA_CUTOFF_MS && cloudMs > localMs + 500) {
      const cloudResult = await fetchStateFromCloud();
      if (cloudResult?.v5State && isTimestampAfterCleanCutoff(cloudResult.v5State.updatedAt)) {
        applyRestoredSnapshot(cloudResult.v5State);
        saveFullStateToLocalStorage(cloudResult.v5State, cloudResult.v5State.updatedAt);
        await saveStateToIndexedDB(cloudResult.v5State);
        setSyncIndicator('saved');
        showNotice('🔄 Real-Time Sync: Pulled latest live data from Cloud!');
        return;
      }
    }

    const nowIso = saveFullStateToLocalStorage(latestStateRef.current);
    const fullSnap: PlutusFullAppState = {
      ...latestStateRef.current,
      updatedAt: nowIso,
    };
    await saveStateToIndexedDB(fullSnap);
    const ok = await pushStateToCloud(fullSnap);
    setLastAutoSavedAt(nowIso);
    setSyncIndicator('saved');
    if (ok) {
      showNotice('☁️ Real-Time Sync Active: Saved all data to Local + Cloud storage for all devices!');
    } else {
      showNotice('💾 Saved all data to Local Storage & IndexedDB (offline mode).');
    }
  };

  const handleForceCloudDownload = async () => {
    setSyncIndicator('saving');
    const cloudResult = await fetchStateFromCloud();
    setSyncIndicator('saved');
    if (cloudResult?.v5State && isTimestampAfterCleanCutoff(cloudResult.v5State.updatedAt)) {
      applyRestoredSnapshot(cloudResult.v5State, 'Cloud Master Database');
      saveFullStateToLocalStorage(cloudResult.v5State, cloudResult.v5State.updatedAt);
      await saveStateToIndexedDB(cloudResult.v5State);
    } else {
      showNotice('⚠️ No newer post-cutoff Cloud state found — your current local manual data is active.');
    }
  };

  const handleResetFactoryOrders = () => {
    setOrders(INITIAL_ORDERS);
    setSizeRules(DEFAULT_SIZE_PACKAGING);
    setPackagingRules(DEFAULT_PACKAGING_RULES);
    setColourMap(DEFAULT_COLOUR_MAP);
    setDensities(DEFAULT_DENSITIES);
    setLadiDimensions(DEFAULT_LADI_DIMENSIONS);
    saveVihanTriguardCartonRules(DEFAULT_VIHAN_TRIGUARD_CARTON_RULES);
    saveMaruMiracleCartonRules(DEFAULT_MARU_MIRACLE_CARTON_RULES);
    setContainerPlans(DEFAULT_CONTAINER_PLANS);
    setDispatchedContainers(DEFAULT_DISPATCHED_CONTAINERS);
    showNotice('✅ Factory defaults restored.');
  };

  // Export full CSV
  const handleExportFullCSV = () => {
    const headers = [
      'ID', 'BATCH', 'BRAND', 'CONDUCTOR', 'CORE OD', 'INS DIE', 'NOZZLE',
      'INSULATION COMPOUND', 'CORE', 'SIZE', 'EXT NOZZLE', 'FINAL/CABLE DIA',
      'FINAL DIE', 'SHEATH COLOUR', 'SHEATHING COMPOUND', 'COILS DETAIL',
      'ORDER LENGTH', 'PROCESS STATUS', 'DISPATCH STATUS', 'GRADE', 'PRINT DETAILS'
    ];
    const rows = orders.map(o => {
      const r = computeRecordRow(o, densities, ladiDimensions);
      const coilDetail =
        o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0
          ? `${o.coils} Coils x ${o.coil_type || '100 YARD'}`
          : '';
      return [
        o.id, o.batch, o.brand, o.conductor, r.coreOd, r.insDie, r.nozzle,
        o.ins_compound, o.cores, o.size, r.extNozzle, r.finalDia, r.finalDie,
        o.sheath_colour, o.sheath_compound, coilDetail, r.orderLen,
        r.pStatus ? `${r.pStatus.b ? 'B ' : ''}${r.pStatus.c ? 'CS ' : ''}${r.pStatus.i ? 'I ' : ''}${r.pStatus.t ? 'TS ' : ''}${r.pStatus.s ? 'SH' : ''}`.trim() : 'Active',
        o.dispatched ? `Dispatched (${o.dispatchedLength || r.orderLen}m)` : 'In Stock / Active',
        o.grade, o.print_details || ''
      ];
    });
    exportCsvFile('PLUTUS_ORDERS_AND_RECORD_EXPORT.csv', [headers, ...rows]);
  };

  // Download Full Standalone Interactive Laptop HTML Application (.html)
  const handleDownloadSelfHtml = async () => {
    await downloadStandaloneLaptopApp({
      orders,
      sizeRules,
      packagingRules,
      colourMap,
      densities,
      ladiDimensions,
      purchaseItems,
      manualPackingItems,
      containerPlans,
      dispatchedContainers,
      dispatchRecords,
      customStockItems,
      pvcOverrides,
      copSlipNotes,
      stockThresholds,
      batchHistory,
      stockReturnRejections: stockReturns,
      stockOpenings,
      stockOverrides: (() => {
        try {
          const s = localStorage.getItem('plutus_stock_overrides');
          return s ? JSON.parse(s) : undefined;
        } catch {
          return undefined;
        }
      })(),
      stockOpeningsBaseline: (() => {
        try {
          const s = localStorage.getItem('plutus_stock_openings_baseline');
          return s ? JSON.parse(s) : undefined;
        } catch {
          return undefined;
        }
      })(),
      monthlyStockSnapshots: monthlySnapshots,
      dailyJournalEntries,
    });
    showNotice(
      '💻 Downloaded Standalone Laptop App (PLUTUS_CABLE_PRODUCTION_LAPTOP_APP.html)! Double-click it on your laptop to run the complete system with all your orders, daily shift journal, container plans, and auto-managed stock.'
    );
  };

  const handleDownloadWindowsLauncher = () => {
    const liveUrl = getAttachedLiveUrl();
    downloadWindowsLaptopLauncher(liveUrl);
    showNotice(
      `🖥️ Downloaded Windows Laptop Launcher (Run_PLUTUS_Cable_App_on_Laptop.bat) with Attached Live Cloud URL (${liveUrl})!`
    );
  };

  const handleDownloadFormattedTables = () => {
    downloadFormattedTablesHtml({
      orders,
      sizeRules,
      packagingRules,
      colourMap,
      densities,
      ladiDimensions,
      purchaseItems,
      manualPackingItems,
      containerPlans,
    });
    showNotice('✅ Downloaded Formatted Tables Report (.html) — ready to view or print 1 table per page!');
  };

  const currentDocTitle = TAB_TITLES[activeTab] || 'Production Document';

  const handleExportActiveSheetPdf = () => {
    const fileName = exportActiveSheetToPdf({
      activeTab,
      sheetTitle: currentDocTitle,
      orders,
      densities,
      ladiDimensions,
      sizeRules,
      packagingRules,
      colourMap,
      purchaseItems,
      manualPackingItems,
      containerPlans,
      dispatchedContainers,
      dispatchRecords,
      dailyJournalEntries,
      stockReturns,
      stockOpenings,
      stockLedger: liveStockLedger,
    });
    showNotice(`📄 Downloaded PDF Document: ${fileName}`);
  };

  const handleExportAllSheetsPdfWorkbook = () => {
    const fileName = exportAllSheetsWorkbookToPdf({
      activeTab,
      sheetTitle: currentDocTitle,
      orders,
      densities,
      ladiDimensions,
      sizeRules,
      packagingRules,
      colourMap,
      purchaseItems,
      manualPackingItems,
      containerPlans,
      dispatchedContainers,
      dispatchRecords,
      dailyJournalEntries,
      stockReturns,
      stockOpenings,
      stockLedger: liveStockLedger,
    });
    showNotice(`📚 Downloaded Complete Multi-Sheet PDF Workbook: ${fileName}`);
  };

  const attachedLiveUrl = getAttachedLiveUrl();
  const [copiedHeaderUrl, setCopiedHeaderUrl] = useState(false);
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'file:' ||
      Boolean((window as any).__PLUTUS_EMBEDDED_STATE__) ||
      Boolean((window as any).__PLUTUS_LIVE_URL__));

  const handleCopyAttachedUrl = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(attachedLiveUrl);
      } else {
        const ta = document.createElement('textarea');
        ta.value = attachedLiveUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedHeaderUrl(true);
      showNotice(`🌐 Attached Live Cloud URL copied: ${attachedLiveUrl}`);
      setTimeout(() => setCopiedHeaderUrl(false), 2500);
    } catch {
      showNotice(`🌐 Attached Live Cloud URL: ${attachedLiveUrl}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 antialiased">
      {/* Lock Screen if locked */}
      {!isUnlocked && (
        <LockScreen
          onUnlock={() => {
            safeSetStorage('plutus_unlocked_persistent', 'true');
            setIsUnlocked(true);
          }}
          appPassword={appPassword}
        />
      )}

      {/* Standalone Laptop Edition Top Banner with Attached URL */}
      {isStandalone && (
        <div className="bg-linear-to-r from-emerald-950 via-slate-900 to-indigo-950 text-white px-4 py-2 border-b-2 border-emerald-500 text-xs flex flex-wrap items-center justify-between gap-3 shadow-md no-print">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="px-2 py-0.5 bg-emerald-500 text-slate-950 font-black rounded uppercase text-[10px] tracking-wider shadow-xs">
              💻 Standalone Laptop App
            </span>
            <span className="text-slate-300 font-medium">
              Attached Official Live Cloud URL:
            </span>
            <a
              href={attachedLiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-emerald-300 hover:text-emerald-200 underline font-semibold max-w-[380px] truncate"
              title="Open official Live Cloud Web App"
            >
              {attachedLiveUrl}
            </a>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleCopyAttachedUrl}
              className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
              title="Copy Live Cloud URL to share with another device"
            >
              {copiedHeaderUrl ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-300 font-semibold">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy Live Link</span>
                </>
              )}
            </button>

            <a
              href={attachedLiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold flex items-center gap-1 shadow-xs transition-colors"
              title="Open Live Cloud App in a new tab"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Open Live Cloud App ↗</span>
            </a>

            <button
              type="button"
              onClick={handleForceCloudUpload}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
              title="Push local laptop updates to Cloud database"
            >
              <span>☁️ Sync with Cloud</span>
            </button>
          </div>
        </div>
      )}

      {/* Interactive Print Control Bar (shown when Print is triggered) */}
      {isPrintMode && (
        <div className="print-control-bar sticky top-0 z-50 bg-slate-900 text-white px-4 py-3 shadow-lg border-b-2 border-blue-500 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 bg-blue-600 rounded-lg">
              <Printer className="w-4 h-4 text-white" />
            </span>
            <div>
              <div className="text-xs font-extrabold uppercase tracking-wider text-white">
                Print Preview Mode Active — {currentDocTitle}
              </div>
              <div className="text-[11px] text-slate-300">
                Press <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-600 rounded font-mono text-white">Ctrl+P</kbd> (or <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-600 rounded font-mono text-white">Cmd+P</kbd>) to print directly, or download the ready-to-print sheet below.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => triggerNativePrintOnly()}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-sm"
            >
              <Printer className="w-3.5 h-3.5" /> Open System Printer Dialog
            </button>

            <button
              type="button"
              onClick={handleExportActiveSheetPdf}
              className="text-xs px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" /> Download Sheet as PDF (.pdf)
            </button>

            <button
              type="button"
              onClick={() => downloadPrintableCurrentPage(currentDocTitle)}
              className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" /> Download & Auto-Print Sheet (.html)
            </button>

            <button
              type="button"
              onClick={() => setIsPrintMode(false)}
              className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg font-bold flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> Exit Print View
            </button>
          </div>
        </div>
      )}

      {/* Non-blocking Status Notification Toast */}
      {statusNotice && (
        <div className="no-print fixed bottom-4 right-4 z-50 max-w-md bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{statusNotice.message}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {statusNotice.actionTab && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab(statusNotice.actionTab as any);
                  setStatusNotice(null);
                }}
                className="text-[11px] px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold"
              >
                {statusNotice.actionLabel || 'View'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setStatusNotice(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-slate-900 text-white px-4 py-3 sticky top-0 z-40 shadow-md">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base font-bold tracking-wide flex items-center gap-2">
              <span>⚡ PLUTUS CABLE PRODUCTION & REQUISITION SYSTEM</span>
            </h1>
            <button
              type="button"
              onClick={handleForceCloudUpload}
              className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold cursor-pointer transition-colors flex items-center gap-1.5 ${
                !isOnline || pendingOfflineSync.hasPending
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                  : syncIndicator === 'saving' || isBgSyncFlushing
                  ? 'bg-blue-600 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
              title={
                !isOnline
                  ? `Offline Mode — Service Worker Background Sync (${BG_SYNC_TAG}) armed. ${pendingOfflineSync.editCount} offline edit(s) queued to auto-push on reconnect.`
                  : pendingOfflineSync.hasPending
                  ? `${pendingOfflineSync.editCount} offline edit(s) queued — click to push to Cloud RTDB now.`
                  : `Real-Time Cloud Sync & SW Background Sync Active (Last synced: ${new Date(lastAutoSavedAt).toLocaleTimeString()}). Click to sync now.`
              }
            >
              {!isOnline ? (
                <>
                  <WifiOff className="w-3 h-3 shrink-0" />
                  <span>
                    Offline • {pendingOfflineSync.hasPending ? `${pendingOfflineSync.editCount} Queued for SW Sync` : 'SW Sync Armed'}
                  </span>
                </>
              ) : syncIndicator === 'saving' || isBgSyncFlushing ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                  <span>Syncing to Cloud RTDB...</span>
                </>
              ) : pendingOfflineSync.hasPending ? (
                <>
                  <RefreshCw className="w-3 h-3 shrink-0" />
                  <span>Push {pendingOfflineSync.editCount} Queued Edit(s) to Cloud</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3 h-3 shrink-0" />
                  <span>
                    Live Cloud &amp; SW Sync ({new Date(lastAutoSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
                  </span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleForceCloudDownload}
              className="text-[11px] bg-teal-700 hover:bg-teal-600 px-2.5 py-0.5 rounded-full font-bold cursor-pointer transition-colors"
              title="Pull latest real-time data from Cloud database now"
            >
              🔄 Pull Live Data
            </button>
            {isPWAInstallable && !isPWAInstalled && (
              <button
                type="button"
                onClick={installPWA}
                className="text-[11px] bg-indigo-500 hover:bg-indigo-400 text-white px-2.5 py-0.5 rounded-full font-extrabold cursor-pointer transition-colors flex items-center gap-1 shadow-xs"
                title="Install PLUTUS as a native Android / Desktop PWA with offline Background Sync"
              >
                <Smartphone className="w-3 h-3" />
                <span>📲 Install Android App</span>
              </button>
            )}
            <input
              ref={laptopFileInputRef}
              type="file"
              accept=".html,.htm,.json"
              onChange={handleImportLaptopFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => laptopFileInputRef.current?.click()}
              className="text-[11px] bg-amber-600 hover:bg-amber-500 px-2.5 py-0.5 rounded-full font-bold cursor-pointer transition-colors"
              title="Import orders and records directly from a saved Laptop App (.html) or Backup (.json) file on your computer"
            >
              📂 Import Laptop File (.html/.json)
            </button>
            <span className="hidden xl:inline text-[10px] bg-blue-600 px-2 py-0.5 rounded-full font-semibold max-w-[420px] truncate">
              App Version 5.19 (Real-Time Multi-Device Sync & Google Drive Ready)
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap no-print">
            {/* Real-time Low Stock Badge & Threshold Settings */}
            {stockEval.hasLowStock ? (
              <div className="flex items-center bg-red-950/90 border border-red-500/70 rounded-lg overflow-hidden shadow-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('purchase')}
                  className="text-xs px-2.5 py-1.5 text-red-200 hover:text-white hover:bg-red-900/60 font-bold flex items-center gap-1.5 transition-colors"
                  title="Low raw material stock detected! Click to open Purchase Sheet"
                >
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                  <span>
                    ⚠️ Low Stock ({stockEval.lowItems.length})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsThresholdModalOpen(true)}
                  className="text-[11px] px-2 py-1.5 bg-red-900/80 hover:bg-red-800 text-red-100 border-l border-red-500/50 font-semibold"
                  title="Configure Copper & PVC Low Stock Thresholds"
                >
                  Thresholds
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsThresholdModalOpen(true)}
                className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 rounded font-semibold flex items-center gap-1.5"
                title="Configure Copper & PVC Low Stock Thresholds"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Stock OK (Thresholds)</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportActiveSheetPdf}
              className="text-xs px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded font-extrabold flex items-center gap-1.5 shadow-sm cursor-pointer"
              title={`Export "${currentDocTitle}" as a formatted PDF document`}
            >
              <FileDown className="w-3.5 h-3.5" /> Export Sheet as PDF
            </button>

            <button
              onClick={() => window.print()}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1.5 shadow-sm"
              title="Print current page document"
            >
              <Printer className="w-3.5 h-3.5" /> Print current page
            </button>

            <button
              onClick={handleDownloadSelfHtml}
              className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="Directly download the full interactive standalone Laptop App (.html) to your computer"
            >
              <Download className="w-3.5 h-3.5" /> Download App to Laptop (.html)
            </button>

            {driveNeedsAuth || !driveUser ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await googleSignIn();
                    if (res) {
                      setDriveUser(res.user);
                      setDriveNeedsAuth(false);
                      setIsGoogleDriveModalOpen(true);
                      showNotice(`☁️ Connected to Google Drive as ${res.user.email || res.user.displayName}!`);
                    }
                  } catch {
                    setIsGoogleDriveModalOpen(true);
                  }
                }}
                className="gsi-material-button text-xs px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-900 rounded font-bold flex items-center gap-1.5 shadow-sm cursor-pointer border border-slate-300"
                title="Sign in with Google to save and restore backups directly in your Google Drive"
              >
                <div className="gsi-material-button-state" />
                <div className="gsi-material-button-content-wrapper flex items-center gap-1.5">
                  <div className="gsi-material-button-icon w-3.5 h-3.5">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block', width: '14px', height: '14px' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">Sign in with Google</span>
                  <span style={{ display: 'none' }}>Sign in with Google</span>
                </div>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsGoogleDriveModalOpen(true)}
                className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                title={`Connected to Google Drive (${driveUser.email}). Click to save or restore Google Drive backups.`}
              >
                <Globe className="w-3.5 h-3.5" /> ☁️ Google Drive ({driveUser.email?.split('@')[0]})
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsGoogleDriveModalOpen(true)}
              className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="Open Google Drive Cloud Storage & Backup Manager"
            >
              <Globe className="w-3.5 h-3.5" /> Google Drive Storage
            </button>

            <button
              onClick={() => setIsLaptopModalOpen(true)}
              className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="Open Laptop Download & Google Drive Shortcut Options"
            >
              <Laptop className="w-3.5 h-3.5" /> Run on Laptop
            </button>

            <button
              type="button"
              onClick={() => setIsLaptopModalOpen(true)}
              className="text-xs px-3 py-1.5 bg-indigo-900/90 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/60 rounded font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              title="Attached Official Live Cloud App URL for multi-device sync"
            >
              <Globe className="w-3.5 h-3.5 text-indigo-400" /> Live App URL
            </button>

            <button
              onClick={handleExportFullCSV}
              className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded font-semibold flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel/CSV
            </button>

            <button
              onClick={() => {
                try {
                  sessionStorage.removeItem('plutus_unlocked');
                } catch {}
                safeSetStorage('plutus_unlocked_persistent', 'false');
                setIsUnlocked(false);
              }}
              className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded flex items-center gap-1 border border-slate-700"
              title="Lock system"
            >
              <Lock className="w-3.5 h-3.5" /> Lock
            </button>
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="max-w-[1600px] mx-auto mt-2 pt-2 border-t border-slate-800 flex items-center gap-1 overflow-x-auto no-scrollbar no-print">
          {[
            { id: 'dashboard', label: '📊 Dashboard' },
            { id: 'orders', label: '1. Active Orders' },
            { id: 'completed', label: '2. Completed Orders' },
            { id: 'requisition', label: '3. Process Cards' },
            { id: 'journal', label: '📝 Daily Production Journal' },
            { id: 'record', label: '4. Master Record' },
            { id: 'summary', label: '5. Summary' },
            { id: 'packing', label: '6. Packing List' },
            { id: 'container', label: '6B. Container Planning' },
            { id: 'dispatch', label: '📦 6C. Dispatch Details' },
            { id: 'purchase', label: '7. Purchase Sheet' },
            { id: 'pvcslip', label: '8. PVC Requisition Slip' },
            { id: 'copslip', label: '9. Copper Requisition Slip' },
            { id: 'druslip', label: '10. Drum Requisition Slip' },
            { id: 'stockslip', label: '11. Stock Management Slip' },
            { id: 'settings', label: '12. Backup' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-[1600px] mx-auto p-4 md:p-6 pb-16">
        {/* Print-Only Official Document Header */}
        <div className="print-only mb-4 border-b-2 border-black pb-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-extrabold tracking-wide text-black uppercase">
                ⚡ PLUTUS CABLE PRODUCTION & REQUISITION SYSTEM
              </h1>
              <div className="text-xs font-bold text-black mt-0.5">
                DOCUMENT: {currentDocTitle}
              </div>
            </div>
            <div className="text-right text-[10px] text-black font-semibold">
              <div>
                PRINT DATE: {new Date().toLocaleDateString('en-GB')}{' '}
                {new Date().toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              <div>SYSTEM VERSION: 5.18</div>
            </div>
          </div>
        </div>

        {/* Active Sheet PDF Export & Print Action Bar */}
        <div className="no-print mb-3 bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-2xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 bg-slate-900 text-white text-[10px] font-black rounded uppercase tracking-wider shrink-0">
              Active Sheet
            </span>
            <span className="text-xs font-extrabold text-slate-900 truncate">
              {currentDocTitle}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleExportActiveSheetPdf}
              className="text-xs px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-extrabold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
              title={`Download "${currentDocTitle}" as a professionally formatted PDF document`}
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Download Active Sheet as PDF (.pdf)</span>
            </button>

            <button
              type="button"
              onClick={handleExportAllSheetsPdfWorkbook}
              className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
              title="Download a complete multi-page PDF workbook containing all production sheets"
            >
              <FileDown className="w-3.5 h-3.5 text-rose-400" />
              <span>Export All Sheets Workbook (.pdf)</span>
            </button>
          </div>
        </div>

        {activeTab === 'dashboard' && (
          <TabDashboard
            orders={orders}
            densities={densities}
            ladiDimensions={ladiDimensions}
            sizeRules={sizeRules}
            packagingRules={packagingRules}
            purchaseItems={purchaseItems}
            customStockItems={customStockItems}
            stockThresholds={stockThresholds}
            batchHistory={batchHistory}
            onNavigateTab={tabId => setActiveTab(tabId as any)}
          />
        )}
        {activeTab === 'orders' && (
          <TabOrders
            orders={orders}
            containers={containerPlans}
            densities={densities}
            ladiDimensions={ladiDimensions}
            sizeRules={sizeRules}
            packagingRules={packagingRules}
            colourMap={colourMap}
            is694VihanRules={is694VihanRules}
            is694MaruRules={is694MaruRules}
            batchHistory={batchHistory}
            onClearBatchHistory={(batchName?: string) => {
              if (batchName) {
                setBatchHistory(prev => prev.filter(h => h.batch !== batchName));
              } else {
                setBatchHistory([]);
              }
            }}
            onAddOrUpdateOrder={handleAddOrUpdateOrder}
            onDeleteOrder={handleDeleteOrder}
            onClearAllOrders={handleClearAllOrders}
            onDuplicateOrder={handleDuplicateOrder}
            onToggleProcess={handleToggleProcess}
            onSelectForRequisition={handleSelectForRequisition}
            onOpenContainer={handleOpenContainer}
            onExportCsv={handleExportFullCSV}
            stockLedger={liveStockLedger}
          />
        )}

        {activeTab === 'completed' && (
          <TabCompletedOrders
            orders={orders}
            containers={containerPlans}
            densities={densities}
            ladiDimensions={ladiDimensions}
            onToggleProcess={handleToggleProcess}
            onSelectForRequisition={handleSelectForRequisition}
            onOpenContainer={handleOpenContainer}
            onDeleteOrder={handleDeleteOrder}
            onDuplicateOrder={handleDuplicateOrder}
          />
        )}

        {activeTab === 'requisition' && (
          <TabRequisition
            orders={orders}
            densities={densities}
            ladiDimensions={ladiDimensions}
            colourMap={colourMap}
            sizeRules={sizeRules}
            packagingRules={packagingRules}
            selectedBatch={reqTarget.batch}
            selectedBrand={reqTarget.brand}
            selectedSize={reqTarget.size}
            selectedOrderId={reqTarget.orderId}
            purchaseItems={purchaseItems}
            onUseBunchedCopper={handleUseBunchedCopper}
            onRevertBunchedCopper={handleRevertBunchedCopper}
            onUpdateOrder={handleAddOrUpdateOrder}
            onToggleProcess={handleToggleProcess}
            stockLedger={liveStockLedger}
          />
        )}

        {activeTab === 'journal' && (
          <TabDailyJournal
            entries={dailyJournalEntries}
            orders={orders}
            densities={densities}
            ladiDimensions={ladiDimensions}
            onUpdateEntries={setDailyJournalEntries}
            showNotice={showNotice}
          />
        )}

        {activeTab === 'record' && (
          <TabRecord
            orders={orders}
            densities={densities}
            ladiDimensions={ladiDimensions}
          />
        )}

        {activeTab === 'summary' && (
          <TabSummary
            orders={orders}
            densities={densities}
            ladiDimensions={ladiDimensions}
            sizeRules={sizeRules}
            packagingRules={packagingRules}
          />
        )}

        {activeTab === 'packing' && (
          <TabPacking
            orders={orders}
            manualItems={manualPackingItems}
            densities={densities}
            ladiDimensions={ladiDimensions}
            sizeRules={sizeRules}
            packagingRules={packagingRules}
            is694VihanRules={is694VihanRules}
            is694MaruRules={is694MaruRules}
            onUpdateOrder={handleAddOrUpdateOrder}
            onAddManualItem={item => setManualPackingItems(prev => [...prev, item])}
            onDeleteManualItem={idx =>
              setManualPackingItems(prev => prev.filter((_, i) => i !== idx))
            }
            onImportOrdersToPacking={handleImportOrdersToPacking}
            onDispatchBatch={handleDispatchBatch}
            onDispatchReel={handleDispatchReel}
            onRevertDispatchReel={handleRevertDispatchReel}
            onAddDispatchRecord={handleAddDispatchRecord}
            onNavigateTab={tabId => setActiveTab(tabId as any)}
          />
        )}

        {activeTab === 'container' && (
          <TabContainerPlanning
            containers={containerPlans}
            dispatchedContainers={dispatchedContainers}
            orders={orders}
            densities={densities}
            ladiDimensions={ladiDimensions}
            sizeRules={sizeRules}
            packagingRules={packagingRules}
            initialSelectedContainerId={targetContainerId}
            onUpdateContainers={setContainerPlans}
            onUpdateDispatchedContainers={setDispatchedContainers}
            onDispatchContainerOrders={handleDispatchContainerOrders}
            stockLedger={liveStockLedger}
          />
        )}

        {activeTab === 'dispatch' && (
          <TabDispatch
            dispatchRecords={dispatchRecords}
            dispatchedContainers={dispatchedContainers}
            orders={orders}
            onAddDispatchRecord={handleAddDispatchRecord}
            onUpdateDispatchRecord={handleUpdateDispatchRecord}
            onDeleteDispatchRecord={handleDeleteDispatchRecord}
            onClearAllDispatches={handleClearAllDispatchRecords}
            onNavigateTab={tabId => setActiveTab(tabId as any)}
          />
        )}

        {activeTab === 'purchase' && (
          <TabPurchase
            items={purchaseItems}
            onUpdateItem={(idx, field, val) => {
              setPurchaseItems(prev => {
                const copy = [...prev];
                copy[idx] = { ...copy[idx], [field]: val };
                return copy;
              });
            }}
            onDeleteItem={target => {
              setPurchaseItems(prev =>
                prev.filter((item, idx) => item.id !== target && idx !== target)
              );
            }}
            onAddItem={item => {
              setPurchaseItems(prev => [...prev, { ...item, id: Date.now() }]);
            }}
            onAddMultipleItems={newItems => {
              setPurchaseItems(prev => {
                let startId = Date.now();
                const mapped = newItems.map(item => ({ ...item, id: startId++ }));
                return [...prev, ...mapped];
              });
            }}
            stockThresholds={stockThresholds}
            onUpdateStockThresholds={setStockThresholds}
          />
        )}

        {activeTab === 'pvcslip' && (
          <TabPvcSlip
            orders={orders}
            densities={densities}
            ladiDimensions={ladiDimensions}
            customOverrides={pvcOverrides}
            onUpdateOverride={(gradeKey, field, val) => {
              setPvcOverrides(prev => ({
                ...prev,
                [gradeKey]: {
                  ...(prev[gradeKey] || {}),
                  [field]: val,
                },
              }));
            }}
          />
        )}

        {activeTab === 'copslip' && (
          <TabCopperSlip
            orders={orders}
            densities={densities}
            ladiDimensions={ladiDimensions}
            notes={copSlipNotes}
            onUpdateNotes={setCopSlipNotes}
            onToggleProcess={handleToggleProcess}
            onNavigateToProcessCard={handleSelectForRequisition}
          />
        )}

        {activeTab === 'druslip' && (
          <TabDrumSlip
            orders={orders}
            densities={densities}
            ladiDimensions={ladiDimensions}
            sizeRules={sizeRules}
            packagingRules={packagingRules}
          />
        )}

        {activeTab === 'stockslip' && (
          <TabStockSlip
            orders={orders}
            purchaseItems={purchaseItems}
            customStockItems={customStockItems}
            manualPackingItems={manualPackingItems}
            stockReturns={stockReturns}
            stockOpenings={stockOpenings}
            monthlySnapshots={monthlySnapshots}
            onUpdateStockOpenings={setStockOpenings}
            onUpdateStockReturns={setStockReturns}
            onUpdateMonthlySnapshots={setMonthlySnapshots}
            densities={densities}
            ladiDimensions={ladiDimensions}
            sizeRules={sizeRules}
            packagingRules={packagingRules}
            onUpdateCustomStock={(idx, field, val) => {
              setCustomStockItems(prev => {
                const copy = [...prev];
                copy[idx] = { ...copy[idx], [field]: val };
                return copy;
              });
            }}
            onDeleteCustomStock={idx => {
              setCustomStockItems(prev => prev.filter((_, i) => i !== idx));
            }}
            onAddCustomStock={item => {
              setCustomStockItems(prev => [...prev, item]);
            }}
            onNavigateTab={tabId => setActiveTab(tabId as any)}
            onUpdateOrders={setOrders}
          />
        )}

        {activeTab === 'settings' && (
          <TabSettings
            orders={orders}
            colourMap={colourMap}
            sizeRules={sizeRules}
            packagingRules={packagingRules}
            densities={densities}
            ladiDimensions={ladiDimensions}
            is694VihanRules={is694VihanRules}
            is694MaruRules={is694MaruRules}
            onUpdateColourMap={setColourMap}
            onUpdateSizeRules={setSizeRules}
            onUpdatePackagingRules={setPackagingRules}
            onUpdateDensities={setDensities}
            onUpdateLadiDimensions={setLadiDimensions}
            onUpdateVihanRules={handleUpdateVihanRules}
            onUpdateMaruRules={handleUpdateMaruRules}
            onResetFactoryOrders={handleResetFactoryOrders}
            onRestoreFullBackup={handleRestoreFullBackup}
            onDownloadStandaloneLaptopApp={handleDownloadSelfHtml}
            onForceCloudUpload={handleForceCloudUpload}
            onForceCloudDownload={handleForceCloudDownload}
          />
        )}

        {/* Threshold Modal if open */}
        <StockThresholdModal
          isOpen={isThresholdModalOpen}
          onClose={() => setIsThresholdModalOpen(false)}
          thresholds={stockThresholds}
          onSaveThresholds={setStockThresholds}
          items={purchaseItems}
          onNavigateToPurchase={() => setActiveTab('purchase')}
        />

        {/* Laptop App Download & Install Modal */}
        <LaptopAppModal
          isOpen={isLaptopModalOpen}
          onClose={() => setIsLaptopModalOpen(false)}
          onDownloadStandaloneApp={handleDownloadSelfHtml}
          onDownloadWindowsLauncher={handleDownloadWindowsLauncher}
          onDownloadFormattedTables={handleDownloadFormattedTables}
          isOnline={isOnline}
          swReady={swReady}
          pendingOfflineSync={pendingOfflineSync}
          onTriggerImmediateSync={handleForceCloudUpload}
        />

        {/* Google Drive Cloud Storage & Backup Modal */}
        <GoogleDriveModal
          isOpen={isGoogleDriveModalOpen}
          onClose={() => setIsGoogleDriveModalOpen(false)}
          user={driveUser}
          needsAuth={driveNeedsAuth}
          onAuthChange={(u, _tok, needs) => {
            setDriveUser(u);
            setDriveNeedsAuth(needs);
          }}
          getCurrentFullBackupPayload={() => ({
            ...latestStateRef.current,
            updatedAt: new Date().toISOString(),
          })}
          getCurrentCsvString={() => {
            const headers = [
              'ID', 'BATCH', 'BRAND', 'CONDUCTOR', 'CORE OD', 'INS DIE', 'NOZZLE',
              'INSULATION COMPOUND', 'CORE', 'SIZE', 'EXT NOZZLE', 'FINAL/CABLE DIA',
              'FINAL DIE', 'SHEATH COLOUR', 'SHEATHING COMPOUND', 'COILS DETAIL',
              'ORDER LENGTH', 'PROCESS STATUS', 'DISPATCH STATUS', 'GRADE', 'PRINT DETAILS'
            ];
            const rows = orders.map(o => {
              const r = computeRecordRow(o, densities, ladiDimensions);
              const coilDetail =
                o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0
                  ? `${o.coils} Coils x ${o.coil_type || '100 YARD'}`
                  : '';
              return [
                o.id, o.batch, o.brand, o.conductor, r.coreOd, r.insDie, r.nozzle,
                o.ins_compound, o.cores, o.size, r.extNozzle, r.finalDia, r.finalDie,
                o.sheath_colour, o.sheath_compound, coilDetail, r.orderLen,
                r.pStatus ? `${r.pStatus.b ? 'B ' : ''}${r.pStatus.c ? 'CS ' : ''}${r.pStatus.i ? 'I ' : ''}${r.pStatus.t ? 'TS ' : ''}${r.pStatus.s ? 'SH' : ''}`.trim() : 'Active',
                o.dispatched ? `Dispatched (${o.dispatchedLength || r.orderLen}m)` : 'In Stock / Active',
                o.grade, o.print_details || ''
              ];
            });
            return [headers, ...rows]
              .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
              .join('\n');
          }}
          onRestoreBackupFromDrive={handleRestoreFullBackup}
          showNotice={showNotice}
        />
      </main>
    </div>
  );
}

