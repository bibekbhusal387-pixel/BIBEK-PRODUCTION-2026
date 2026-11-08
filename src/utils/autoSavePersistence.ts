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
} from '../types/cable';

import {
  MaruMiracleCartonRule,
  VihanTriguardCartonRule,
} from './is694CartonPackaging';

export interface PlutusFullAppState {
  orders: CableOrder[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
  colourMap: ColourMapRule[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  is694VihanRules?: VihanTriguardCartonRule[];
  is694MaruRules?: MaruMiracleCartonRule[];
  purchaseItems: PurchaseItem[];
  manualPackingItems: ManualPackingItem[];
  containerPlans: ContainerPlan[];
  dispatchedContainers: DispatchedContainerRecord[];
  dispatchRecords?: DispatchRecord[];
  customStockItems: StockItem[];
  pvcOverrides: Record<string, any>;
  copSlipNotes: string;
  stockThresholds: StockThresholdSettings;
  batchHistory: BatchHistoryEntry[];
  stockReturnRejections?: StockReturnRejection[];
  stockOpenings?: Record<string, number>;
  manualStockOpeningsV2?: Record<string, number>;
  lockedOpeningKeys?: Record<string, boolean>;
  stockOverrides?: Record<string, { opening?: number; received?: number; consumed?: number }>;
  stockOpeningsBaseline?: Record<string, number>;
  monthlyStockSnapshots?: Record<string, MonthlyStockSnapshot>;
  dailyJournalEntries?: DailyJournalEntry[];
  deletedOrderIds?: number[];
  activeTab?: string;
  updatedAt: string;
}

const CLOUD_DB_URL = 'https://plutus-web-fbd5b-default-rtdb.firebaseio.com/plutus_master_data.json';
export const CLEAN_ERA_CUTOFF_ISO = '2026-11-06T10:00:00.000Z';
export const CLEAN_ERA_CUTOFF_MS = Date.parse(CLEAN_ERA_CUTOFF_ISO);

const MASTER_AUTOSAVE_KEY = 'plutus_manual_autosave_v9';
const LAST_SAVED_AT_KEY = 'plutus_last_saved_at_v9';
const DELETED_ORDER_IDS_KEY = 'plutus_deleted_order_ids_v9';
const IDB_NAME = 'plutus_manual_db_v9';
const IDB_STORE = 'app_state_store';
const IDB_KEY = 'latest_plutus_state';

function safeGetLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage quota errors
  }
}

export function isLegacyPreCutoffOrder(o: any): boolean {
  if (!o || typeof o !== 'object') return true;
  if (typeof o.dispatchedAt === 'string' && o.dispatchedAt.startsWith('2026-10-')) {
    return true;
  }
  if (o.pTimestamps && typeof o.pTimestamps === 'object') {
    for (const val of Object.values(o.pTimestamps)) {
      if (typeof val === 'string' && val.startsWith('2026-10-')) {
        return true;
      }
    }
  }
  return false;
}

export function isLegacyOrderDataset(orders: any[]): boolean {
  if (!Array.isArray(orders)) return false;
  if (
    orders.length >= 40 &&
    orders.some(o => o && Number(o.id) === 14 && Number(o.record_row) === 25)
  ) {
    return true;
  }
  return orders.some(o => isLegacyPreCutoffOrder(o));
}

export function sanitizeManualOrders(
  orders: any[],
  extraDeletedIds?: number[] | Set<number>
): CableOrder[] {
  if (!Array.isArray(orders) || isLegacyOrderDataset(orders)) return [];
  const deletedSet = getDeletedOrderIds();
  if (extraDeletedIds) {
    extraDeletedIds.forEach((id: number) => {
      const n = Number(id);
      if (!isNaN(n)) deletedSet.add(n);
    });
  }
  return orders.filter(
    o => isValidCableOrder(o) && !isLegacyPreCutoffOrder(o) && !deletedSet.has(Number(o.id))
  );
}

export function isTimestampAfterCleanCutoff(isoOrMs?: string | number | null): boolean {
  if (!isoOrMs) return false;
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(String(isoOrMs));
  return !isNaN(ms) && ms >= CLEAN_ERA_CUTOFF_MS;
}

export function purgeAllLegacyPreCutoffStorage(): void {
  const legacyKeys = [
    'plutus_full_autosave_v5',
    'plutus_full_autosave_v4',
    'plutus_full_autosave_v3',
    'plutus_full_autosave_v2',
    'plutus_full_autosave_v1',
    'plutus_cable_orders_v3_real',
    'plutus_cable_orders_v2_1',
    'plutus_cable_orders_v2',
    'plutus_cable_orders_v1',
    'plutus_cable_orders',
    'plutus_orders',
    'bibek_cable_orders',
    'plutus_purchase_items',
    'plutus_container_plans_v4',
    'plutus_container_plans_v3',
    'plutus_container_plans_v2',
    'plutus_container_plans_v1',
    'plutus_dispatched_container_history_v2',
    'plutus_dispatched_container_history_v1',
    'plutus_dispatch_records_v1',
    'plutus_daily_journal_v1',
    'plutus_batch_history_log_v1',
    'plutus_manual_packing_items',
    'plutus_pending_offline_sync_v1',
    'plutus_deleted_order_ids_v1',
    'plutus_last_saved_at',
  ];
  try {
    legacyKeys.forEach(k => localStorage.removeItem(k));
  } catch {}
  try {
    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase('plutus_autosave_db_v5');
    }
  } catch {}
}

export function getDeletedOrderIds(): Set<number> {
  try {
    const raw = safeGetLocal(DELETED_ORDER_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.map(Number).filter(n => !isNaN(n)));
    }
  } catch {}
  return new Set();
}

export function addDeletedOrderId(id: number): void {
  const current = getDeletedOrderIds();
  current.add(Number(id));
  safeSetLocal(DELETED_ORDER_IDS_KEY, JSON.stringify(Array.from(current)));
}

export function addDeletedOrderIds(ids: number[]): void {
  const current = getDeletedOrderIds();
  ids.forEach(id => {
    const n = Number(id);
    if (!isNaN(n)) current.add(n);
  });
  safeSetLocal(DELETED_ORDER_IDS_KEY, JSON.stringify(Array.from(current)));
}

export function clearDeletedOrderIds(): void {
  safeSetLocal(DELETED_ORDER_IDS_KEY, JSON.stringify([]));
}

export function removeDeletedOrderId(id: number): void {
  const current = getDeletedOrderIds();
  current.delete(Number(id));
  safeSetLocal(DELETED_ORDER_IDS_KEY, JSON.stringify(Array.from(current)));
}

function isValidCableOrder(obj: any): obj is CableOrder {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.batch === 'string' &&
    obj.batch.trim().length > 0 &&
    typeof obj.size === 'string' &&
    obj.size.trim().length > 0 &&
    (typeof obj.order_length === 'number' || typeof obj.order_length === 'string')
  );
}

function orderSignature(o: CableOrder): string {
  return [
    (o.batch || '').trim().toUpperCase(),
    (o.brand || '').trim().toUpperCase(),
    (o.grade || '').trim().toUpperCase(),
    String(o.cores ?? ''),
    (o.size || '').trim().toUpperCase(),
    (o.conductor || '').trim().toUpperCase(),
    (o.ins_colour || '').trim().toUpperCase(),
    (o.sheath_colour || '').trim().toUpperCase(),
    String(o.order_length ?? ''),
    String(o.coils ?? ''),
  ].join('|');
}

export function mergeOrdersNonDestructive(
  localOrders: CableOrder[],
  incomingOrders: CableOrder[],
  preferIncoming = false,
  extraDeletedIds?: number[]
): CableOrder[] {
  const validLocal = sanitizeManualOrders(localOrders, extraDeletedIds);
  const validIncoming = sanitizeManualOrders(incomingOrders, extraDeletedIds);

  if (validIncoming.length === 0) return validLocal;
  if (validLocal.length === 0) return validIncoming;

  const primary = preferIncoming ? validIncoming : validLocal;
  const secondary = preferIncoming ? validLocal : validIncoming;

  const byId = new Map<number, CableOrder>();
  const seenSignatures = new Set<string>();
  const extraCollisionOrders: CableOrder[] = [];

  for (const ord of primary) {
    const numId = Number(ord.id);
    if (!isNaN(numId) && numId > 0) {
      byId.set(numId, ord);
      seenSignatures.add(orderSignature(ord));
    }
  }

  for (const ord of secondary) {
    const numId = Number(ord.id);
    const sig = orderSignature(ord);
    if (!isNaN(numId) && numId > 0) {
      const existing = byId.get(numId);
      if (!existing) {
        if (!seenSignatures.has(sig)) {
          byId.set(numId, ord);
          seenSignatures.add(sig);
        }
      } else {
        // Same ID exists in both lists. Check if they represent the same order or two different orders created offline
        const sameIdentity =
          (existing.batch || '').trim().toUpperCase() === (ord.batch || '').trim().toUpperCase() &&
          (existing.size || '').trim().toUpperCase() === (ord.size || '').trim().toUpperCase() &&
          Number(existing.cores || 0) === Number(ord.cores || 0) &&
          (existing.brand || '').trim().toUpperCase() === (ord.brand || '').trim().toUpperCase();

        if (!sameIdentity && !seenSignatures.has(sig)) {
          extraCollisionOrders.push(ord);
          seenSignatures.add(sig);
        } else if (sameIdentity) {
          // Preserve whichever has more completed production stages if one is further along
          const countStages = (x: CableOrder) =>
            (x.pStatus?.b ? 1 : 0) +
            (x.pStatus?.c ? 1 : 0) +
            (x.pStatus?.i ? 1 : 0) +
            (x.pStatus?.t ? 1 : 0) +
            (x.pStatus?.s ? 1 : 0);
          if (countStages(ord) > countStages(existing)) {
            byId.set(numId, { ...existing, pStatus: ord.pStatus, pTimestamps: ord.pTimestamps || existing.pTimestamps });
          }
        }
      }
    } else if (!seenSignatures.has(sig)) {
      extraCollisionOrders.push(ord);
      seenSignatures.add(sig);
    }
  }

  let maxId = 0;
  byId.forEach((_, k) => {
    if (k > maxId) maxId = k;
  });

  for (const extra of extraCollisionOrders) {
    maxId += 1;
    byId.set(maxId, {
      ...extra,
      id: maxId,
      record_row: maxId + 11,
    });
  }

  return Array.from(byId.values()).sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Scans all known and legacy localStorage keys, window globals, and embedded bundles
 * to recover and merge every order saved in this browser.
 */
export function recoverAllOrdersFromBrowserStorage(baseOrders: CableOrder[]): CableOrder[] {
  let merged = Array.isArray(baseOrders) ? [...baseOrders] : [];

  const candidateKeys = [
    MASTER_AUTOSAVE_KEY,
    'plutus_full_autosave_v4',
    'plutus_full_autosave_v3',
    'plutus_full_autosave_v2',
    'plutus_full_autosave_v1',
    'plutus_cable_orders_v3_real',
    'plutus_cable_orders_v2_1',
    'plutus_cable_orders_v2',
    'plutus_cable_orders_v1',
    'plutus_cable_orders',
    'plutus_orders',
    'bibek_cable_orders',
  ];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && !candidateKeys.includes(k)) {
        candidateKeys.push(k);
      }
    }
  } catch {}

  for (const key of candidateKeys) {
    const raw = safeGetLocal(key);
    if (!raw || raw.length < 10) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(isValidCableOrder);
        if (valid.length > 0) {
          merged = mergeOrdersNonDestructive(merged, valid, false);
        }
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.orders)) {
          const valid = parsed.orders.filter(isValidCableOrder);
          if (valid.length > 0) {
            merged = mergeOrdersNonDestructive(merged, valid, false, parsed.deletedOrderIds);
          }
        }
        if (Array.isArray(parsed.appOrders)) {
          const valid = parsed.appOrders.filter(isValidCableOrder);
          if (valid.length > 0) {
            merged = mergeOrdersNonDestructive(merged, valid, false);
          }
        }
        if (parsed.v5State && Array.isArray(parsed.v5State.orders)) {
          const valid = parsed.v5State.orders.filter(isValidCableOrder);
          if (valid.length > 0) {
            merged = mergeOrdersNonDestructive(merged, valid, false, parsed.v5State.deletedOrderIds);
          }
        }
      }
    } catch {}
  }

  try {
    if (typeof window !== 'undefined') {
      const emb = (window as any).__PLUTUS_EMBEDDED_STATE__;
      if (emb && Array.isArray(emb.orders)) {
        merged = mergeOrdersNonDestructive(merged, emb.orders, false);
      }
      const legacyInit = (window as any).__PLUTUS_INITIAL_ORDERS__;
      if (Array.isArray(legacyInit)) {
        merged = mergeOrdersNonDestructive(merged, legacyInit, false);
      }
    }
  } catch {}

  return merged;
}

/**
 * Extracts CableOrder[] from an uploaded Laptop App (.html), JSON Backup (.json), or CSV Export (.csv).
 */
export function extractOrdersFromUploadedFileContent(rawText: string, fileName: string): CableOrder[] {
  const extracted: CableOrder[] = [];
  if (!rawText) return extracted;

  const lowerName = (fileName || '').toLowerCase();

  // 1. Try JSON directly
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidCableOrder);
    }
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.orders)) return parsed.orders.filter(isValidCableOrder);
      if ( parsed.v5State && Array.isArray(parsed.v5State.orders)) {
        return parsed.v5State.orders.filter(isValidCableOrder);
      }
      if (Array.isArray(parsed.appOrders)) return parsed.appOrders.filter(isValidCableOrder);
    }
  } catch {}

  // 2. Try Standalone Laptop / Android HTML file containing window.__PLUTUS_EMBEDDED_STATE__
  if (rawText.includes('__PLUTUS_EMBEDDED_STATE__') || lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
    const marker = 'window.__PLUTUS_EMBEDDED_STATE__ =';
    const idx = rawText.indexOf(marker);
    if (idx !== -1) {
      const startBrace = rawText.indexOf('{', idx);
      const endScript = rawText.indexOf('</script>', startBrace);
      if (startBrace !== -1 && endScript !== -1) {
        let jsonSlice = rawText.slice(startBrace, endScript).trim();
        if (jsonSlice.endsWith(';')) jsonSlice = jsonSlice.slice(0, -1).trim();
        try {
          const emb = JSON.parse(jsonSlice);
          if (emb && Array.isArray(emb.orders)) {
            return emb.orders.filter(isValidCableOrder);
          }
        } catch {}
      }
    }
  }

  // 3. Try CSV Export format (ID,BATCH,BRAND,CONDUCTOR,CORE OD,INS DIE,NOZZLE,INSULATION COMPOUND,CORE,SIZE,...)
  if (lowerName.endsWith('.csv') || rawText.includes('BATCH,BRAND,CONDUCTOR')) {
    const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length > 1) {
      const parseCsvLine = (line: string): string[] => {
        const res: string[] = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (ch === ',' && !inQuotes) {
            res.push(cur.trim());
            cur = '';
          } else {
            cur += ch;
          }
        }
        res.push(cur.trim());
        return res;
      };

      const headerCols = parseCsvLine(lines[0]).map(h => h.toUpperCase().trim());
      const idIdx = headerCols.indexOf('ID');
      const batchIdx = headerCols.findIndex(h => h === 'BATCH' || h === 'JOB NO');
      const brandIdx = headerCols.indexOf('BRAND');
      const condIdx = headerCols.indexOf('CONDUCTOR');
      const coreOdIdx = headerCols.indexOf('CORE OD');
      const insCompIdx = headerCols.findIndex(h => h.includes('INSULATION COMPOUND') || h === 'INS COMPOUND');
      const coreIdx = headerCols.findIndex(h => h === 'CORE' || h === 'CORES');
      const sizeIdx = headerCols.indexOf('SIZE');
      const finalDiaIdx = headerCols.findIndex(h => h.includes('FINAL') && h.includes('DIA'));
      const sheathColIdx = headerCols.findIndex(h => h.includes('SHEATH COLOUR'));
      const sheathCompIdx = headerCols.findIndex(h => h.includes('SHEATHING COMPOUND') || h.includes('SHEATH COMP'));
      const coilsIdx = headerCols.findIndex(h => h.includes('COILS'));
      const lenIdx = headerCols.findIndex(h => h.includes('ORDER LENGTH'));
      const statusIdx = headerCols.findIndex(h => h.includes('PROCESS STATUS'));
      const gradeIdx = headerCols.indexOf('GRADE');
      const printIdx = headerCols.findIndex(h => h.includes('PRINT'));

      if (batchIdx !== -1 && sizeIdx !== -1) {
        for (let r = 1; r < lines.length; r++) {
          const cols = parseCsvLine(lines[r]);
          if (cols.length <= Math.max(batchIdx, sizeIdx)) continue;
          const batchVal = cols[batchIdx] || '';
          const sizeVal = cols[sizeIdx] || '';
          if (!batchVal || !sizeVal) continue;

          const rawId = idIdx !== -1 ? Number(cols[idIdx]) : r + 200;
          const id = !isNaN(rawId) && rawId > 0 ? rawId : r + 200;
          const coilText = coilsIdx !== -1 ? cols[coilsIdx] || '' : '';
          let coils: number | string = '';
          let coil_type: string | undefined = undefined;
          const coilMatch = coilText.match(/(\d+)\s*Coils?\s*x\s*(.+)/i);
          if (coilMatch) {
            coils = Number(coilMatch[1]);
            coil_type = coilMatch[2].trim();
          }
          const statusStr = statusIdx !== -1 ? (cols[statusIdx] || '').toUpperCase() : '';
          const pStatus = {
            b: /\bB\b/.test(statusStr),
            c: /\bCS\b/.test(statusStr),
            i: /\bI\b/.test(statusStr),
            t: /\bTS\b/.test(statusStr),
            s: /\bSH\b/.test(statusStr),
          };

          extracted.push({
            id,
            batch: batchVal,
            brand: brandIdx !== -1 ? cols[brandIdx] || '' : '',
            conductor: condIdx !== -1 ? cols[condIdx] || '' : '',
            core_od: coreOdIdx !== -1 ? Number(cols[coreOdIdx]) || 0 : 0,
            ins_compound: insCompIdx !== -1 ? cols[insCompIdx] || '' : '',
            cores: coreIdx !== -1 ? Number(String(cols[coreIdx]).replace(/[^0-9.]/g, '')) || 1 : 1,
            size: sizeVal,
            final_dia: finalDiaIdx !== -1 ? Number(cols[finalDiaIdx]) || 0 : 0,
            sheath_colour: sheathColIdx !== -1 ? cols[sheathColIdx] || '' : '',
            sheath_compound: sheathCompIdx !== -1 ? cols[sheathCompIdx] || '' : '',
            coils,
            coil_type,
            order_length: lenIdx !== -1 ? Number(cols[lenIdx]) || 0 : 0,
            grade: gradeIdx !== -1 ? cols[gradeIdx] || '' : '',
            print_details: printIdx !== -1 ? cols[printIdx] || '' : '',
            record_row: id + 11,
            pStatus,
          });
        }
      }
    }
  }

  return extracted;
}

export function getLastLocalSavedTimestamp(): number {
  const raw = safeGetLocal(LAST_SAVED_AT_KEY);
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  if (isNaN(parsed) || parsed < CLEAN_ERA_CUTOFF_MS) return 0;
  return parsed;
}

export function normalizeCleanStateSnapshot(
  raw: any,
  fallbackUpdatedAt?: string
): PlutusFullAppState {
  const deletedOrderIds = Array.from(
    new Set([
      ...Array.from(getDeletedOrderIds()),
      ...(Array.isArray(raw?.deletedOrderIds) ? raw.deletedOrderIds.map(Number).filter((n: number) => !isNaN(n)) : []),
    ])
  );
  const cleanedOrders = sanitizeManualOrders(Array.isArray(raw?.orders) ? raw.orders : [], deletedOrderIds);

  const LEGACY_CONT_IDS = new Set([
    'CONT-001-460',
    'CONT-002-096',
    'CONT-001',
    'CONT-002',
    'CONT-20FT-2ND',
    'CONT-HIST-LOT1',
    'CONT-COPY-7509',
  ]);
  const LEGACY_DISP_IDS = new Set([
    'DISP-HIST-001',
    'DISP-CONT-001',
    'DISP-CONT-002',
    'DISP-CONT-COPY-7509',
    'DSP-JOB33-01',
    'DSP-JOB33-02',
    'DSP-JOB33-03',
    'DSP-JOB24-01',
    'DSP-JOB30-01',
    'DSP-IS694-01',
    'DSP-IS694-02',
    'DSP-IS694-03',
    'DSP-IS694-04',
    'DSP-JOB31-01',
    'DSP-JOB34-01',
  ]);
  const LEGACY_PURCHASE_INVOICES = new Set([
    'U3/2627/1010',
    'FE/26-27/390',
    'INV-2025-001',
    'INV-2025-002',
    'INV-2026-B01',
    'INV-2026-B02',
    'INV-2026-B03',
  ]);

  const rawContainers = Array.isArray(raw?.containerPlans) ? raw.containerPlans : [];
  const cleanedContainers = rawContainers.filter(
    (c: any) => c && !LEGACY_CONT_IDS.has(String(c.id)) && c.containerNo !== 'EK-LOT-2-20FT-02'
  );

  const rawDispatchedCont = Array.isArray(raw?.dispatchedContainers) ? raw.dispatchedContainers : [];
  const cleanedDispatchedCont = rawDispatchedCont.filter(
    (r: any) => r && !LEGACY_DISP_IDS.has(String(r.id)) && !LEGACY_CONT_IDS.has(String(r.containerId))
  );

  const rawDispatchRecords = Array.isArray(raw?.dispatchRecords) ? raw.dispatchRecords : [];
  const cleanedDispatchRecords = rawDispatchRecords.filter(
    (r: any) => r && !LEGACY_DISP_IDS.has(String(r.id))
  );

  const rawPurchases = Array.isArray(raw?.purchaseItems) ? raw.purchaseItems : [];
  const cleanedPurchases = rawPurchases.filter(
    (p: any) =>
      p &&
      !LEGACY_PURCHASE_INVOICES.has(String(p.invoice || '').trim()) &&
      !(Number(p.id) <= 10 && String(p.date || '').endsWith('.2025'))
  );

  return {
    ...(raw || {}),
    orders: cleanedOrders,
    sizeRules: Array.isArray(raw?.sizeRules) ? raw.sizeRules : [],
    packagingRules: Array.isArray(raw?.packagingRules) ? raw.packagingRules : [],
    colourMap: Array.isArray(raw?.colourMap) ? raw.colourMap : [],
    densities: raw?.densities || undefined,
    ladiDimensions: Array.isArray(raw?.ladiDimensions) ? raw.ladiDimensions : [],
    is694VihanRules: Array.isArray(raw?.is694VihanRules) ? raw.is694VihanRules : undefined,
    is694MaruRules: Array.isArray(raw?.is694MaruRules) ? raw.is694MaruRules : undefined,
    purchaseItems: cleanedPurchases,
    manualPackingItems: Array.isArray(raw?.manualPackingItems) ? raw.manualPackingItems : [],
    containerPlans: cleanedContainers,
    dispatchedContainers: cleanedDispatchedCont,
    dispatchRecords: cleanedDispatchRecords,
    customStockItems: Array.isArray(raw?.customStockItems) ? raw.customStockItems : [],
    pvcOverrides: raw?.pvcOverrides && typeof raw.pvcOverrides === 'object' ? raw.pvcOverrides : {},
    copSlipNotes: typeof raw?.copSlipNotes === 'string' ? raw.copSlipNotes : '',
    stockThresholds: raw?.stockThresholds || undefined,
    batchHistory: Array.isArray(raw?.batchHistory) ? raw.batchHistory : [],
    stockReturnRejections: Array.isArray(raw?.stockReturnRejections) ? raw.stockReturnRejections : [],
    stockOpenings: raw?.stockOpenings && typeof raw.stockOpenings === 'object' ? raw.stockOpenings : {},
    manualStockOpeningsV2:
      raw?.manualStockOpeningsV2 && typeof raw.manualStockOpeningsV2 === 'object'
        ? raw.manualStockOpeningsV2
        : raw?.stockOpenings && typeof raw.stockOpenings === 'object'
        ? raw.stockOpenings
        : {},
    monthlyStockSnapshots:
      raw?.monthlyStockSnapshots && typeof raw.monthlyStockSnapshots === 'object'
        ? raw.monthlyStockSnapshots
        : {},
    dailyJournalEntries: Array.isArray(raw?.dailyJournalEntries) ? raw.dailyJournalEntries : [],
    deletedOrderIds,
    activeTab: raw?.activeTab,
    updatedAt: raw?.updatedAt || fallbackUpdatedAt || new Date().toISOString(),
  } as PlutusFullAppState;
}

/**
 * Synchronously saves the entire application state to localStorage
 * under both individual keys and the unified master snapshot key.
 */
export function saveFullStateToLocalStorage(
  state: Omit<PlutusFullAppState, 'updatedAt'>,
  customTimestamp?: string
): string {
  const nowIso = customTimestamp || new Date().toISOString();
  const fullState = normalizeCleanStateSnapshot({
    ...state,
    updatedAt: nowIso,
  });

  const ordersJson = JSON.stringify(fullState.orders);
  safeSetLocal('plutus_manual_orders_v9', ordersJson);

  if (Array.isArray(fullState.sizeRules) && fullState.sizeRules.length > 0) {
    const sizeRulesJson = JSON.stringify(fullState.sizeRules);
    safeSetLocal('plutus_custom_size_pkg_v3', sizeRulesJson);
    safeSetLocal('plutus_custom_size_pkg', sizeRulesJson);
  }

  if (Array.isArray(fullState.packagingRules) && fullState.packagingRules.length > 0) {
    const pkgRulesJson = JSON.stringify(fullState.packagingRules);
    safeSetLocal('plutus_custom_packaging_v3', pkgRulesJson);
    safeSetLocal('plutus_custom_packaging', pkgRulesJson);
  }

  if (Array.isArray(fullState.colourMap) && fullState.colourMap.length > 0) {
    const colourMapJson = JSON.stringify(fullState.colourMap);
    safeSetLocal('plutus_colour_map_v3', colourMapJson);
    safeSetLocal('plutus_colour_map', colourMapJson);
  }

  if (fullState.densities) {
    safeSetLocal('bibek_custom_densities', JSON.stringify(fullState.densities));
  }
  if (Array.isArray(fullState.ladiDimensions) && fullState.ladiDimensions.length > 0) {
    safeSetLocal('bibek_custom_ladi', JSON.stringify(fullState.ladiDimensions));
  }
  if (fullState.is694VihanRules) {
    safeSetLocal('plutus_is694_vihan_triguard_cartons_v1', JSON.stringify(fullState.is694VihanRules));
  }
  if (fullState.is694MaruRules) {
    safeSetLocal('plutus_is694_maru_miracle_cartons_v1', JSON.stringify(fullState.is694MaruRules));
  }
  safeSetLocal('plutus_purchase_items_v9', JSON.stringify(fullState.purchaseItems || []));
  safeSetLocal('plutus_manual_packing_items_v9', JSON.stringify(fullState.manualPackingItems || []));
  safeSetLocal('plutus_container_plans_v9', JSON.stringify(fullState.containerPlans || []));
  safeSetLocal(
    'plutus_dispatched_container_history_v9',
    JSON.stringify(fullState.dispatchedContainers || [])
  );
  safeSetLocal('plutus_dispatch_records_v9', JSON.stringify(fullState.dispatchRecords || []));
  safeSetLocal('plutus_stock_management_items_v9', JSON.stringify(fullState.customStockItems || []));
  safeSetLocal('plutus_pvc_slip_custom', JSON.stringify(fullState.pvcOverrides || {}));
  safeSetLocal('cop_slip_notes', fullState.copSlipNotes || '');
  if (fullState.stockThresholds) {
    safeSetLocal('plutus_stock_thresholds', JSON.stringify(fullState.stockThresholds));
  }
  safeSetLocal('plutus_batch_history_log_v9', JSON.stringify(fullState.batchHistory || []));
  safeSetLocal('plutus_stock_return_rejections_v9', JSON.stringify(fullState.stockReturnRejections || []));
  if (fullState.stockOpenings) {
    safeSetLocal('plutus_stock_openings', JSON.stringify(fullState.stockOpenings));
    safeSetLocal('plutus_stock_openings_manual_v2', JSON.stringify(fullState.stockOpenings));
  }
  if (fullState.stockOverrides) {
    safeSetLocal('plutus_stock_overrides', JSON.stringify(fullState.stockOverrides));
  }
  if (fullState.stockOpeningsBaseline) {
    safeSetLocal('plutus_stock_openings_baseline', JSON.stringify(fullState.stockOpeningsBaseline));
  }
  if (fullState.monthlyStockSnapshots) {
    safeSetLocal('plutus_monthly_stock_snapshots', JSON.stringify(fullState.monthlyStockSnapshots));
  }
  safeSetLocal('plutus_daily_journal_v9', JSON.stringify(fullState.dailyJournalEntries || []));
  if (fullState.activeTab) {
    safeSetLocal('plutus_last_active_tab', fullState.activeTab);
  }

  safeSetLocal(MASTER_AUTOSAVE_KEY, JSON.stringify(fullState));
  safeSetLocal(LAST_SAVED_AT_KEY, nowIso);

  return nowIso;
}

/**
 * Loads the unified master snapshot from localStorage if available and created after CLEAN_ERA_CUTOFF_MS.
 */
export function loadMasterSnapshotFromLocalStorage(): PlutusFullAppState | null {
  try {
    const raw = safeGetLocal(MASTER_AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && isTimestampAfterCleanCutoff(parsed.updatedAt)) {
      return normalizeCleanStateSnapshot(parsed);
    }
  } catch {
    // ignore parse error
  }
  return null;
}

const IDB_PENDING_SYNC_KEY = 'pending_cloud_sync_meta';
const IDB_LAST_SYNC_RESULT_KEY = 'last_cloud_sync_result';
const LOCAL_PENDING_SYNC_KEY = 'plutus_pending_offline_sync_v9';
export const BG_SYNC_TAG = 'plutus-cloud-rtdb-sync';
export const PERIODIC_SYNC_TAG = 'plutus-periodic-cloud-sync';
export const BG_SYNC_BROADCAST_CHANNEL = 'plutus_bg_sync_channel';

export interface PendingOfflineSyncMeta {
  id: string;
  queuedAt: string;
  editCount: number;
  state: PlutusFullAppState;
  deletedOrderIds: number[];
  retryCount: number;
}

export interface OfflineSyncStatusSnapshot {
  hasPending: boolean;
  editCount: number;
  queuedAt: string | null;
  swRegistered: boolean;
  bgSyncSupported: boolean;
  lastSyncedAt?: string;
}

function emitOfflineSyncStatusChange(detail?: Partial<OfflineSyncStatusSnapshot>): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('plutus-offline-sync-status', {
          detail: {
            ...getPendingOfflineSyncStatusSync(),
            ...detail,
          },
        })
      );
    }
  } catch {}
}

export function getPendingOfflineSyncStatusSync(): {
  hasPending: boolean;
  editCount: number;
  queuedAt: string | null;
} {
  try {
    const raw = safeGetLocal(LOCAL_PENDING_SYNC_KEY);
    if (!raw) return { hasPending: false, editCount: 0, queuedAt: null };
    const parsed = JSON.parse(raw);
    if (parsed && parsed.hasPending && isTimestampAfterCleanCutoff(parsed.updatedAt || parsed.queuedAt)) {
      return {
        hasPending: true,
        editCount: Number(parsed.editCount) || 1,
        queuedAt: parsed.queuedAt || null,
      };
    }
  } catch {}
  return { hasPending: false, editCount: 0, queuedAt: null };
}

/**
 * Registers the Service Worker and arms Background Sync / Periodic Background Sync
 * for the Android PWA and desktop browser.
 */
export async function registerBackgroundSyncServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  if (window.location.protocol === 'file:') {
    return null;
  }

  try {
    let reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) {
      try {
        reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch {
        reg = await navigator.serviceWorker.register('/bg-sync-sw.js', { scope: '/' });
      }
    }

    // Also try registering periodic background sync if available
    try {
      if (reg && 'periodicSync' in reg && navigator.permissions) {
        const status = await navigator.permissions.query({
          name: 'periodic-background-sync' as PermissionName,
        });
        if (status.state === 'granted') {
          await (reg as any).periodicSync.register(PERIODIC_SYNC_TAG, {
            minInterval: 15 * 60 * 1000, // 15 minutes
          });
        }
      }
    } catch {}

    return reg || null;
  } catch {
    return null;
  }
}

/**
 * Queues an offline state edit in IndexedDB + localStorage and registers a
 * Service Worker Background Sync task (`plutus-cloud-rtdb-sync`) so that
 * Android Chrome / WebAPK pushes it to Cloud RTDB the instant connectivity returns.
 */
export async function queueOfflineStateForBackgroundSync(
  state: PlutusFullAppState
): Promise<void> {
  const currentSync = getPendingOfflineSyncStatusSync();
  const nextCount = currentSync.hasPending ? currentSync.editCount + 1 : 1;
  const nowIso = new Date().toISOString();
  const normalizedState = normalizeCleanStateSnapshot({
    ...state,
    updatedAt: state.updatedAt || nowIso,
  });

  safeSetLocal(
    LOCAL_PENDING_SYNC_KEY,
    JSON.stringify({
      hasPending: true,
      editCount: nextCount,
      queuedAt: nowIso,
      updatedAt: normalizedState.updatedAt,
    })
  );

  const pendingPayload: PendingOfflineSyncMeta = {
    id: 'offline_outbox',
    queuedAt: nowIso,
    editCount: nextCount,
    state: normalizedState,
    deletedOrderIds: normalizedState.deletedOrderIds || [],
    retryCount: 0,
  };

  await new Promise<void>(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve();
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          store.put(pendingPayload.state, IDB_KEY);
          store.put(pendingPayload, IDB_PENDING_SYNC_KEY);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  // Register Service Worker Background Sync tag
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg =
        (await navigator.serviceWorker.getRegistration('/')) ||
        (await registerBackgroundSyncServiceWorker());
      if (reg) {
        if ('sync' in reg) {
          try {
            await (reg as any).sync.register(BG_SYNC_TAG);
          } catch {}
        }
        const targetSw = reg.active || reg.waiting || reg.installing || navigator.serviceWorker.controller;
        targetSw?.postMessage({
          type: 'PLUTUS_QUEUE_OFFLINE_SYNC',
          updatedAt: normalizedState.updatedAt,
        });
      }
    }
  } catch {}

  emitOfflineSyncStatusChange({
    hasPending: true,
    editCount: nextCount,
    queuedAt: nowIso,
  });
}

/**
 * Clears the pending offline sync queue in both localStorage and IndexedDB
 * once the state has been confirmed pushed to Cloud RTDB.
 */
export async function clearPendingOfflineSyncQueue(syncedAtIso?: string): Promise<void> {
  try {
    localStorage.removeItem(LOCAL_PENDING_SYNC_KEY);
    localStorage.removeItem('plutus_pending_offline_sync_v1');
  } catch {}

  await new Promise<void>(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve();
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          store.delete(IDB_PENDING_SYNC_KEY);
          if (syncedAtIso) {
            store.put({ syncedAt: syncedAtIso }, IDB_LAST_SYNC_RESULT_KEY);
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  emitOfflineSyncStatusChange({
    hasPending: false,
    editCount: 0,
    queuedAt: null,
    lastSyncedAt: syncedAtIso || new Date().toISOString(),
  });
}

/**
 * Loads any pending offline sync metadata from IndexedDB (if the Service Worker
 * or previous session queued offline edits after CLEAN_ERA_CUTOFF_MS).
 */
export function loadPendingOfflineSyncFromIndexedDB(): Promise<PendingOfflineSyncMeta | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readonly');
          const store = tx.objectStore(IDB_STORE);
          const getReq = store.get(IDB_PENDING_SYNC_KEY);
          getReq.onsuccess = () => {
            const result = getReq.result as PendingOfflineSyncMeta | undefined;
            db.close();
            if (
              result &&
              result.state &&
              isTimestampAfterCleanCutoff(result.state.updatedAt || result.queuedAt)
            ) {
              resolve({
                ...result,
                state: normalizeCleanStateSnapshot(result.state),
              });
            } else {
              resolve(null);
            }
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Triggers the Service Worker to immediately flush any queued offline edits to Cloud RTDB,
 * with a direct client-side fallback so reconnect sync succeeds across all Android browsers.
 */
export async function triggerImmediateBackgroundSyncFlush(
  fallbackState?: PlutusFullAppState
): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (fallbackState) {
      await queueOfflineStateForBackgroundSync(fallbackState);
    }
    return false;
  }

  // 1. Ask Service Worker to flush its IndexedDB queue immediately
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const targetSw = reg?.active || navigator.serviceWorker.controller;
      if (targetSw) {
        targetSw.postMessage({
          type: 'PLUTUS_TRIGGER_BG_SYNC',
          source: 'client-reconnect-flush',
        });
      }
    }
  } catch {}

  // 2. Also execute client-side flush of pending IndexedDB state or fallbackState
  const pendingIdb = await loadPendingOfflineSyncFromIndexedDB();
  const stateToPush = pendingIdb?.state || fallbackState;
  if (!stateToPush) {
    return false;
  }

  return pushStateToCloud(stateToPush, false);
}

/**
 * Saves the full application state into IndexedDB for extra durability
 * across browser restarts and file:// origins.
 */
export function saveStateToIndexedDB(state: PlutusFullAppState): Promise<void> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve();
        return;
      }
      const normalized = normalizeCleanStateSnapshot(state);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readwrite');
          const store = tx.objectStore(IDB_STORE);
          store.put(normalized, IDB_KEY);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Loads the full application state from IndexedDB if created after CLEAN_ERA_CUTOFF_MS.
 */
export function loadStateFromIndexedDB(): Promise<PlutusFullAppState | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readonly');
          const store = tx.objectStore(IDB_STORE);
          const getReq = store.get(IDB_KEY);
          getReq.onsuccess = () => {
            const result = getReq.result as PlutusFullAppState | undefined;
            db.close();
            if (result && typeof result === 'object' && isTimestampAfterCleanCutoff(result.updatedAt)) {
              resolve(normalizeCleanStateSnapshot(result));
            } else {
              resolve(null);
            }
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function mergeArrayById<T extends { id?: string | number }>(
  localArr?: T[],
  cloudArr?: T[]
): T[] {
  if (!Array.isArray(localArr) && !Array.isArray(cloudArr)) return [];
  if (!Array.isArray(cloudArr) || cloudArr.length === 0) return localArr || [];
  if (!Array.isArray(localArr) || localArr.length === 0) return cloudArr || [];
  const map = new Map<string, T>();
  for (const item of localArr) {
    if (item && item.id !== undefined) {
      map.set(String(item.id), item);
    }
  }
  for (const item of cloudArr) {
    if (item && item.id !== undefined && !map.has(String(item.id))) {
      map.set(String(item.id), item);
    }
  }
  return Array.from(map.values());
}

/**
 * Uploads the full application state to the Plutus Firebase Realtime Database using PUT
 * so that old legacy keys are completely replaced and closing/re-opening the app on any
 * tab, browser, or laptop HTML file restores ONLY the user's manual data.
 */
export async function pushStateToCloud(
  state: PlutusFullAppState,
  useKeepAlive = false
): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await queueOfflineStateForBackgroundSync(state);
    return false;
  }

  try {
    const mergedState = normalizeCleanStateSnapshot(state);

    const payload = {
      appOrders: mergedState.orders,
      customSizePkg: mergedState.sizeRules,
      customPackaging: mergedState.packagingRules,
      customColourMap: mergedState.colourMap,
      customLadi: mergedState.ladiDimensions,
      customDensities: mergedState.densities,
      v9ManualState: mergedState,
      v5State: mergedState,
      cleanEraCutoff: CLEAN_ERA_CUTOFF_ISO,
      updatedAt: mergedState.updatedAt,
    };

    const res = await fetch(CLOUD_DB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: useKeepAlive,
    });

    if (res.ok) {
      await clearPendingOfflineSyncQueue(mergedState.updatedAt);
      return true;
    } else {
      await queueOfflineStateForBackgroundSync(mergedState);
      return false;
    }
  } catch {
    await queueOfflineStateForBackgroundSync(state);
    return false;
  }
}

const CLOUD_UPDATED_AT_URL =
  'https://plutus-web-fbd5b-default-rtdb.firebaseio.com/plutus_master_data/updatedAt.json';

/**
 * Lightweight check (~28 bytes) for the cloud updatedAt timestamp so multiple
 * devices can poll every few seconds and immediately pull real-time changes.
 */
export async function fetchCloudUpdatedAt(): Promise<number> {
  try {
    const res = await fetch(`${CLOUD_UPDATED_AT_URL}?t=${Date.now()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return 0;
    const raw = await res.json();
    if (typeof raw === 'string' && raw) {
      const ts = Date.parse(raw);
      if (isNaN(ts) || ts < CLEAN_ERA_CUTOFF_MS) return 0;
      return ts;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Fetches the latest saved state from the Plutus Firebase Realtime Database,
 * accepting ONLY post-cutoff manual states and normalizing empty arrays stripped by Firebase RTDB.
 */
export async function fetchStateFromCloud(): Promise<{
  v5State?: PlutusFullAppState;
  legacyData?: any;
  updatedAtMs: number;
} | null> {
  try {
    const res = await fetch(`${CLOUD_DB_URL}?t=${Date.now()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;

    const candidateState = data.v9ManualState || data.v5State;
    if (candidateState && typeof candidateState === 'object') {
      const ts = Date.parse(candidateState.updatedAt || data.updatedAt || '');
      if (isNaN(ts) || ts < CLEAN_ERA_CUTOFF_MS) {
        return null;
      }
      const normalized = normalizeCleanStateSnapshot({
        ...candidateState,
        updatedAt: candidateState.updatedAt || data.updatedAt,
      });
      return {
        v5State: normalized,
        updatedAtMs: ts,
      };
    }

    return null;
  } catch {
    return null;
  }
}


