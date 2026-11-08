import {
  CableOrder,
  DensitySettings,
  LadiDimensionRule,
  ManualPackingItem,
  MonthlyStockSnapshot,
  PackagingRule,
  PurchaseItem,
  SizePackagingRule,
  StockItem,
  StockReturnRejection,
} from '../types/cable';
import {
  computeRecordRow,
  evaluateSpoolSizeForOrder,
  expandOrdersForMaterialRequirements,
  isIs694Order,
} from './calculations';
import {
  computeIs694CartonPackingForOrder,
  loadMaruMiracleCartonRules,
  loadVihanTriguardCartonRules,
} from './is694CartonPackaging';

export interface StockLedgerRow extends StockItem {
  key: string;
  subCategory?: string;
  opening: number;
  received: number;
  consumed: number;
  stageConsumedQty?: number;
  activeOrderReqQty?: number;
  availableStock?: number;
  consumedKgs?: number;
  supplierRejections: number;
  scrapRejections: number;
  customerReturns: number;
  lineReturns: number;
  closing: number;
  closingMtrsStr: string;
  closingKgsStr: string;
  isCustom?: boolean;
  customIdx?: number;
  stageSource?: 'B' | 'I' | 'SH' | 'DISPATCH' | 'MANUAL';
  details?: string;
}

export interface StageConsumptionLogItem {
  orderId: number;
  batch: string;
  brand: string;
  size: string;
  cores: number;
  stageKey: 'b' | 'c' | 'i' | 't' | 's';
  stageName: string;
  materialCategory: 'COPPER' | 'INSULATION' | 'SHEATH' | 'DRUM' | 'PALLET';
  materialName: string;
  consumedQty: number;
  unit: string;
  timestamp?: string;
  note: string;
}

export interface StockLedgerResult {
  allRows: StockLedgerRow[];
  rawCopperRows: StockLedgerRow[];
  bunchedCopperRows: StockLedgerRow[];
  insulationRows: StockLedgerRow[];
  sheathingRows: StockLedgerRow[];
  drumRows: StockLedgerRow[];
  palletRows: StockLedgerRow[];
  semiFinishedRows: StockLedgerRow[];
  finishedGoodsRows: StockLedgerRow[];
  customRows: StockLedgerRow[];
  stageConsumptionLogs: StageConsumptionLogItem[];
  totals: {
    totalRawCopperStockKg: number;
    totalInsulationStockKg: number;
    totalSheathingStockKg: number;
    totalFinishedStockMtrs: number;
    totalFinishedStockKg: number;
    totalDispatchedMtrs: number;
    totalDispatchedKg: number;
    totalDrumsAvailable: number;
    totalPalletsAvailable: number;
    totalRejectionsKg: number;
    totalReturnsKg: number;
  };
}

/**
 * Normalizes material compound and size keys for precise opening/closing matching
 */
export function normalizeMaterialKey(category: string, name: string): string {
  return `${category.toUpperCase().trim()}||${name.toUpperCase().trim()}`;
}

/**
 * Extracts single wire strand diameter from a conductor specification.
 * Handles both bunched specifications (e.g. "52/0.260", "30/0.210", "78/0.260", "129/0.260", "294/0.266")
 * and raw strand wire names (e.g. "0.260", "0.210", "0.21 Drawn Strands").
 */
export function extractStrandDiameter(conductor?: string): string {
  if (!conductor) return '0.210';
  const c = conductor.trim();

  // If conductor contains slash: e.g. "52/0.260", "30/0.210", "294/0.266", "7/0.465", "24/0.2"
  if (c.includes('/')) {
    const parts = c.split('/');
    const right = (parts[1] || '').trim();
    const match = right.match(/[0-9]+(?:\.[0-9]+)?/);
    if (match) {
      const num = parseFloat(match[0]);
      if (!isNaN(num)) {
        // Format to standard 3 decimal places e.g. 0.26 -> "0.260", 0.21 -> "0.210", 0.18 -> "0.180"
        return num.toFixed(3);
      }
      return match[0];
    }
  }

  // Normalize "0.21 Drawn Strands" -> "0.210" so 0.210 drawn copper strands are tracked in a single unified ledger row
  if (c.toLowerCase().includes('0.21') && c.toLowerCase().includes('drawn')) {
    return '0.210';
  }

  // Handle decimal starting string: e.g. "0.260", "0.210", "0.266", "0.26", "0.18"
  const decMatch = c.match(/^([0-9]+(?:\.[0-9]+)?)/);
  if (decMatch) {
    const num = parseFloat(decMatch[1]);
    if (!isNaN(num) && num < 5) {
      return num.toFixed(3);
    }
  }

  // Look for inline decimal in description e.g. "Copper 0.260 mm"
  const inlineMatch = c.match(/0\.[0-9]{2,3}/);
  if (inlineMatch) {
    const num = parseFloat(inlineMatch[0]);
    if (!isNaN(num)) {
      return num.toFixed(3);
    }
  }

  return c;
}

/**
 * Normalizes insulation compound strings to canonical grades (e.g. "KI-06", "KI-13", "A 80 UW", "A 80 NATURAL", "TI1", "GRADE A")
 */
export function canonicalInsulationGrade(raw: string): string {
  if (!raw) return 'KI-06';
  const u = raw.toUpperCase().trim();
  if (u.includes('KI-13') || u.includes('KI13') || u.includes('KI 13')) return 'KI-13';
  if (u.includes('KI-06') || u.includes('KI06') || u.includes('KI 06')) return 'KI-06';
  if (u.includes('A 80 UW') || u.includes('A80 UW') || u.includes('A-80 UW') || u.includes('A80UW')) return 'A 80 UW';
  if (u.includes('A 80 NATURAL') || u.includes('A80 NATURAL') || u.includes('A80NATURAL')) return 'A 80 NATURAL';
  if (u.includes('TI1') || u.includes('TI-1') || u.includes('TI 1')) return 'TI1';
  if (u.includes('GRADE A') || u.includes('GRADE-A')) return 'GRADE A';
  return u;
}

/**
 * Normalizes sheathing compound strings to canonical grades (e.g. "KI-05", "ST-1 GREY", "A80 HD BLACK", "ST2")
 */
export function canonicalSheathGrade(raw: string): string {
  if (!raw) return 'KI-05';
  const u = raw.toUpperCase().trim();
  if (u.includes('KI-05') || u.includes('KI05') || u.includes('KI 05')) return 'KI-05';
  if (u.includes('ST-1') || u.includes('ST1') || u.includes('ST 1') || u.includes('GREY') || u.includes('GRAY')) return 'ST-1 GREY';
  if (u.includes('A80 HD') || u.includes('A 80 HD') || u.includes('HD BLACK') || u.includes('ETP A80')) return 'A80 HD BLACK';
  if (u.includes('ST-2') || u.includes('ST2') || u.includes('ST 2')) return 'ST2';
  if (u.includes('A 80 NATURAL') || u.includes('A80 NATURAL')) return 'A 80 NATURAL';
  return u;
}

/**
 * Computes live, fully auto-linked stock balances combining:
 * 1. User Opening Stock
 * 2. Purchase Ledger Inward receipts (Tab 7)
 * 3. Process Card auto-consumption at Stage B (Copper), Stage I (Insulation), Stage SH (Sheathing & Drums/Pallets)
 * 4. Dispatch Outward Deductions (Tab 6 & 6B)
 * 5. Returns & Rejections (Supplier rejections, scrap, customer returns)
 */
export function computeLiveStockLedger(params: {
  orders: CableOrder[];
  purchaseItems: PurchaseItem[];
  customStockItems: StockItem[];
  manualPackingItems?: ManualPackingItem[];
  stockReturns: StockReturnRejection[];
  stockOpenings: Record<string, number>;
  stockOverrides?: Record<string, { opening?: number; received?: number; consumed?: number }>;
  selectedMonth?: string; // 'ALL' or 'YYYY-MM'
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
}): StockLedgerResult {
  const {
    orders,
    purchaseItems,
    customStockItems,
    manualPackingItems = [],
    stockReturns,
    stockOpenings,
    stockOverrides = {},
    selectedMonth,
    densities,
    ladiDimensions,
    sizeRules,
    packagingRules,
  } = params;

  // 1. Accumulators for order requirements & stage-wise process consumptions
  const copperRequiredByStrand: Record<string, number> = {};
  const copperStageConsumedByStrand: Record<string, number> = {};
  const copperActiveReqByStrand: Record<string, number> = {};
  const copperBunchedSizesByStrand: Record<string, Set<string>> = {};
  let totalCopperConsumedAtB = 0;

  const insCompoundRequired: Record<string, number> = {};
  const insStageConsumed: Record<string, number> = {};
  const insActiveReq: Record<string, number> = {};

  const sheathCompoundRequired: Record<string, number> = {};
  const sheathStageConsumed: Record<string, number> = {};
  const sheathActiveReq: Record<string, number> = {};

  const drumConsumed: Record<string, { totalReq: number; consumed: number }> = {};
  const palletConsumed: Record<string, { totalReq: number; consumed: number }> = {};

  const bunchStageProduced: Record<string, { mtrs: number; kgs: number }> = {};
  const ladiStageProduced: Record<string, { mtrs: number; kgs: number }> = {};
  const insStageProduced: Record<string, { mtrs: number; kgs: number }> = {};
  const twistStageProduced: Record<string, { mtrs: number; kgs: number }> = {};
  const finishedGoodsProduced: Record<
    string,
    {
      producedMtrs: number;
      producedKgs: number;
      dispatchedMtrs: number;
      dispatchedKgs: number;
      batch: string;
      brandGrade: string;
      isIs694Carton?: boolean;
      coilsCount?: number;
      cartonsCount?: number;
      coilType?: string;
      cartonSummary?: string;
    }
  > = {};

  const vihanRules = loadVihanTriguardCartonRules();
  const maruRules = loadMaruMiracleCartonRules();

  const stageConsumptionLogs: StageConsumptionLogItem[] = [];

  let totalFinishedMtrs = 0;
  let totalFinishedKgs = 0;
  let totalDispMtrs = 0;
  let totalDispKgs = 0;

  // Helper to check if a date string belongs to the selected month (if month filter active)
  const isDateInMonth = (dateStr?: string): boolean => {
    if (!selectedMonth || selectedMonth === 'ALL') return true;
    if (!dateStr) return true; // default to current
    const d = dateStr.trim();
    if (d.startsWith(selectedMonth)) return true;
    const partsM = selectedMonth.split('-');
    if (partsM.length === 2) {
      const [year, month] = partsM;
      if (d.includes('.')) {
        const parts = d.split('.');
        if (parts.length === 3) {
          const pMonth = parts[1].padStart(2, '0');
          const pYear = parts[2].trim();
          return pMonth === month && pYear === year;
        }
      }
      if (d.includes('/')) {
        const parts = d.split('/');
        if (parts.length === 3) {
          const pMonth = parts[1].padStart(2, '0');
          const pYear = parts[2].trim();
          return pMonth === month && pYear === year;
        }
      }
    }
    return true;
  };

  // Expand orders so released IS-694 parcel lots (production_lots) AND remaining order sheet coils
  // AND operator production logs are all included in Copper & PVC requirement deductions!
  const expandedOrders = expandOrdersForMaterialRequirements(orders);

  // Iterate all expanded orders and calculate exact Copper & PVC requirements and stage-wise production
  expandedOrders.forEach(o => {
    const r = computeRecordRow(o, densities, ladiDimensions);
    const p = o.pStatus || { b: false, c: false, i: false, t: false, s: false };
    const timestamps = o.pTimestamps || {};
    const condStrand = (o.conductor || '0.210').trim();
    const is694 = isIs694Order(o);

    // Check if operator production logs specify actual PVC / Copper weights
    const opLogs = o.operator_production_logs || [];
    const opPvcKg = opLogs.reduce((s, l) => s + (Number(l.actualPvcKg) || 0), 0);
    const opCuKg = opLogs.reduce((s, l) => s + (Number(l.actualCuKg) || 0), 0);

    const effCuKg = opCuKg > 0 ? opCuKg : r.reqCu;
    const effInsKg = opPvcKg > 0 ? opPvcKg : r.reqIns;
    const effSheathKg = is694 ? 0 : r.reqSheath;

    // --- 1. COPPER REQUIREMENT & STAGE B DEDUCTION ---
    if (o.bunch_source === 'purchased_stock') {
      if (isDateInMonth(timestamps.b)) {
        stageConsumptionLogs.push({
          orderId: o.id,
          batch: o.batch,
          brand: o.brand,
          size: o.size,
          cores: o.cores,
          stageKey: 'b',
          stageName: p.b ? 'Bunching (B — Completed)' : 'Bunching (B — Order Req)',
          materialCategory: 'COPPER',
          materialName: `Purchased Bunched Copper [Ref #${o.purchased_copper_id}]`,
          consumedQty: o.purchased_copper_deducted_qty || effCuKg,
          unit: 'KG',
          timestamp: timestamps.b,
          note: `Allocated from Purchase Ledger to ${o.batch}`,
        });
      }
    } else if (effCuKg > 0 && isDateInMonth(timestamps.b)) {
      const rawStrand = extractStrandDiameter(condStrand);
      copperRequiredByStrand[rawStrand] = (copperRequiredByStrand[rawStrand] || 0) + effCuKg;
      // An order's stock is ONLY deducted from physical inventory once processed into production (Stage B done or order marked Processing)
      const isCuProcessed = Boolean(p.b || o.is_processed || o.status === 'Processing' || o.status === 'Completed');
      if (isCuProcessed) {
        copperStageConsumedByStrand[rawStrand] =
          (copperStageConsumedByStrand[rawStrand] || 0) + effCuKg;
        totalCopperConsumedAtB += effCuKg;
      } else {
        copperActiveReqByStrand[rawStrand] =
          (copperActiveReqByStrand[rawStrand] || 0) + effCuKg;
      }

      if (!copperBunchedSizesByStrand[rawStrand]) {
        copperBunchedSizesByStrand[rawStrand] = new Set<string>();
      }
      copperBunchedSizesByStrand[rawStrand].add(condStrand);

      stageConsumptionLogs.push({
        orderId: o.id,
        batch: o.batch,
        brand: o.brand,
        size: o.size,
        cores: o.cores,
        stageKey: 'b',
        stageName: p.b ? 'Bunching (B — Completed)' : 'Bunching (B — Order Req Deducted)',
        materialCategory: 'COPPER',
        materialName: `Raw Copper Wire (${rawStrand})`,
        consumedQty: effCuKg,
        unit: 'KG',
        timestamp: timestamps.b,
        note: `${p.b ? 'Stage B Done' : 'Order Requirement'}: Deducted ${effCuKg.toFixed(2)} kg from Raw Copper (${rawStrand}) for ${condStrand} (${is694 ? `1C × ${o.size}` : `${o.cores}C × ${o.size}`} • ${r.reqCoreLen.toLocaleString()} m core)`,
      });
    }

    // Produces Bunched Copper semi-finished stock if Stage B is done and not yet passed through CS/I
    if (p.b && isDateInMonth(timestamps.b) && !p.c && !p.i) {
      const bKey = `Bunched Copper (${is694 ? '1C' : `${o.cores}C`} × ${o.size} - ${o.batch})`;
      if (!bunchStageProduced[bKey]) bunchStageProduced[bKey] = { mtrs: 0, kgs: 0 };
      bunchStageProduced[bKey].mtrs += r.reqCoreLen;
      bunchStageProduced[bKey].kgs += effCuKg;
    }

    // Stage CS: Stranding (Ladi)
    if (p.c && isDateInMonth(timestamps.c) && !p.i) {
      const cKey = `Stranded Ladi Copper (${o.cores}C × ${o.size} - ${o.batch})`;
      if (!ladiStageProduced[cKey]) ladiStageProduced[cKey] = { mtrs: 0, kgs: 0 };
      ladiStageProduced[cKey].mtrs += r.reqCoreLen;
      ladiStageProduced[cKey].kgs += effCuKg;
    }

    // --- 2. INSULATION PVC REQUIREMENT & STAGE I DEDUCTION ---
    const insCompName = canonicalInsulationGrade(o.ins_compound || 'KI-06');
    if (effInsKg > 0 && isDateInMonth(timestamps.i)) {
      insCompoundRequired[insCompName] = (insCompoundRequired[insCompName] || 0) + effInsKg;
      // Deducted from physical stock only when processed (Stage I or Processing status)
      const isInsProcessed = Boolean(p.i || o.is_processed || o.status === 'Processing' || o.status === 'Completed');
      if (isInsProcessed) {
        insStageConsumed[insCompName] = (insStageConsumed[insCompName] || 0) + effInsKg;
      } else {
        insActiveReq[insCompName] = (insActiveReq[insCompName] || 0) + effInsKg;
      }

      if (is694) {
        const ctnInfo = computeIs694CartonPackingForOrder(
          o,
          densities,
          ladiDimensions,
          vihanRules,
          maruRules
        );
        const orderFinishedKgs = effCuKg + effInsKg;

        stageConsumptionLogs.push({
          orderId: o.id,
          batch: o.batch,
          brand: o.brand,
          size: o.size,
          cores: 1,
          stageKey: 'i',
          stageName: p.i
            ? 'IS-694 Insulation & Coiling (FINAL STAGE — Done)'
            : 'IS-694 Insulation & Coiling (Order Req Deducted)',
          materialCategory: 'INSULATION',
          materialName: `Insulation Compound: ${insCompName}`,
          consumedQty: effInsKg,
          unit: 'KG',
          timestamp: timestamps.i,
          note: p.i
            ? `IS-694 Final Stage Completed: Deducted ${effInsKg.toFixed(2)} kg ${insCompName} & attached ${ctnInfo.totalCoils} Coils (${ctnInfo.totalCartons} Master Cartons${ctnInfo.cartonIdsLabel ? ` • IDs: ${ctnInfo.cartonIdsLabel}` : ''}) to Finished Stock`
            : `IS-694 Order Requirement: Deducted ${effInsKg.toFixed(2)} kg ${insCompName} for ${ctnInfo.totalCoils} Coils (${r.orderLen.toLocaleString()} m)`,
        });

        // When IS-694 Insulation (I) is completed (or operator logs are recorded), attach to Finished Carton Stock
        if (p.i || opLogs.length > 0) {
          const colLabel = o.ins_colour ? ` • ${o.ins_colour}` : '';
          const idLabel = ctnInfo.cartonIdsLabel ? ` • Carton IDs: ${ctnInfo.cartonIdsLabel}` : '';
          const fKey = `IS-694 Finished Carton Stock (1C × ${o.size} - ${o.brand} ${o.grade || 'IS-694'} - ${o.batch}) [${ctnInfo.totalCoils} Coils × ${ctnInfo.coilType} = ${ctnInfo.totalCartons} Cartons${colLabel}${idLabel}]`;
          if (!finishedGoodsProduced[fKey]) {
            finishedGoodsProduced[fKey] = {
              producedMtrs: 0,
              producedKgs: 0,
              dispatchedMtrs: 0,
              dispatchedKgs: 0,
              batch: o.batch,
              brandGrade: `${o.brand} ${o.grade || 'IS-694'}`,
              isIs694Carton: true,
              coilsCount: 0,
              cartonsCount: 0,
              coilType: ctnInfo.coilType,
              cartonSummary: ctnInfo.packingSummaryText,
            };
          }

          const dispMtrs = o.dispatched
            ? r.orderLen
            : Math.min(r.orderLen, o.dispatchedLength || 0);
          const dispKgs = o.dispatched
            ? orderFinishedKgs
            : Math.min(
                orderFinishedKgs,
                o.dispatchedWeight !== undefined
                  ? o.dispatchedWeight
                  : r.orderLen > 0
                  ? orderFinishedKgs * (dispMtrs / r.orderLen)
                  : 0
              );

          finishedGoodsProduced[fKey].producedMtrs += r.orderLen;
          finishedGoodsProduced[fKey].producedKgs += orderFinishedKgs;
          finishedGoodsProduced[fKey].dispatchedMtrs += dispMtrs;
          finishedGoodsProduced[fKey].dispatchedKgs += dispKgs;
          finishedGoodsProduced[fKey].coilsCount =
            (finishedGoodsProduced[fKey].coilsCount || 0) + ctnInfo.totalCoils;
          finishedGoodsProduced[fKey].cartonsCount = Number(
            ((finishedGoodsProduced[fKey].cartonsCount || 0) + ctnInfo.totalCartons).toFixed(2)
          );

          totalFinishedMtrs += r.orderLen;
          totalFinishedKgs += orderFinishedKgs;
          totalDispMtrs += dispMtrs;
          totalDispKgs += dispKgs;
        }
      } else {
        stageConsumptionLogs.push({
          orderId: o.id,
          batch: o.batch,
          brand: o.brand,
          size: o.size,
          cores: o.cores,
          stageKey: 'i',
          stageName: p.i ? 'Insulation (I — Completed)' : 'Insulation (I — Order Req Deducted)',
          materialCategory: 'INSULATION',
          materialName: `Insulation Compound: ${insCompName}`,
          consumedQty: effInsKg,
          unit: 'KG',
          timestamp: timestamps.i,
          note: `${p.i ? 'Stage I Done' : 'Order Requirement'}: Deducted ${effInsKg.toFixed(2)} kg from Insulation Stock for ${r.reqCoreLen.toLocaleString()} m core`,
        });

        if (p.i && !p.t && !p.s) {
          const iKey = `Insulated Cores (${o.cores}C × ${o.size} - ${o.grade} - ${o.batch})`;
          if (!insStageProduced[iKey]) insStageProduced[iKey] = { mtrs: 0, kgs: 0 };
          insStageProduced[iKey].mtrs += r.reqCoreLen;
          insStageProduced[iKey].kgs += effCuKg + effInsKg;
        }
      }
    }

    // Stage TS: Twisting / Core Stranding (Not applicable to IS-694)
    if (!is694 && p.t && isDateInMonth(timestamps.t) && !p.s) {
      const tKey = `Twisted Cores (${o.cores}C × ${o.size} - ${o.grade} - ${o.batch})`;
      if (!twistStageProduced[tKey]) twistStageProduced[tKey] = { mtrs: 0, kgs: 0 };
      twistStageProduced[tKey].mtrs += r.orderLen;
      twistStageProduced[tKey].kgs += effCuKg + effInsKg;
    }

    // --- 3. SHEATHING PVC REQUIREMENT, DRUMS & PALLETS (NON-IS-694 ONLY) ---
    if (!is694) {
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
      const spoolName = (evalPkg.spool || '30 X 12 X 15').trim();
      const palletName = (evalPkg.pallet || '30X30x6').trim();
      const bbnPerPallet = evalPkg.bbnPerPallet || 1;
      const pkgText = evalPkg.packaging || '1000m / Drum';
      const mLenMatch = pkgText.match(/[0-9]+/);
      const drumLen = mLenMatch ? parseFloat(mLenMatch[0]) : 1000;
      const spoolCount = drumLen > 0 ? Math.ceil(r.orderLen / drumLen) : 1;
      const palletCount = spoolCount > 0 ? Math.ceil(spoolCount / bbnPerPallet) : 0;

      if (!drumConsumed[spoolName]) drumConsumed[spoolName] = { totalReq: 0, consumed: 0 };
      drumConsumed[spoolName].totalReq += spoolCount;

      if (!palletConsumed[palletName]) palletConsumed[palletName] = { totalReq: 0, consumed: 0 };
      palletConsumed[palletName].totalReq += palletCount;

      const sheathCompName = canonicalSheathGrade(o.sheath_compound || 'KI-05');
      if (effSheathKg > 0 && isDateInMonth(timestamps.s)) {
        sheathCompoundRequired[sheathCompName] =
          (sheathCompoundRequired[sheathCompName] || 0) + effSheathKg;
        // Deducted from physical stock only when processed (Stage SH or Processing status)
        const isSheathProcessed = Boolean(p.s || o.is_processed || o.status === 'Processing' || o.status === 'Completed');
        if (isSheathProcessed) {
          sheathStageConsumed[sheathCompName] =
            (sheathStageConsumed[sheathCompName] || 0) + effSheathKg;
        } else {
          sheathActiveReq[sheathCompName] =
            (sheathActiveReq[sheathCompName] || 0) + effSheathKg;
        }

        stageConsumptionLogs.push({
          orderId: o.id,
          batch: o.batch,
          brand: o.brand,
          size: o.size,
          cores: o.cores,
          stageKey: 's',
          stageName: p.s ? 'Sheathing (SH — Completed)' : 'Sheathing (SH — Order Req Deducted)',
          materialCategory: 'SHEATH',
          materialName: `Sheathing Compound: ${sheathCompName}`,
          consumedQty: effSheathKg,
          unit: 'KG',
          timestamp: timestamps.s,
          note: `${p.s ? 'Stage SH Done' : 'Order Requirement'}: Deducted ${effSheathKg.toFixed(2)} kg from Sheathing Stock for ${r.orderLen.toLocaleString()} m cable (${o.sheath_colour})`,
        });
      }

      // Stage SH Completed -> Consumes Drum(s) & Pallet(s) and produces Finished Cable Drum Stock
      if (p.s && isDateInMonth(timestamps.s)) {
        drumConsumed[spoolName].consumed += spoolCount;
        palletConsumed[palletName].consumed += palletCount;

        stageConsumptionLogs.push({
          orderId: o.id,
          batch: o.batch,
          brand: o.brand,
          size: o.size,
          cores: o.cores,
          stageKey: 's',
          stageName: 'Sheathing (SH) Drumming',
          materialCategory: 'DRUM',
          materialName: `Wooden Drum: ${spoolName}`,
          consumedQty: spoolCount,
          unit: 'NOS',
          timestamp: timestamps.s,
          note: `Auto-deducted ${spoolCount} drum(s) from store`,
        });

        // Produces Finished Goods
        const fKey = `Finished Cable Drum (${o.cores}C × ${o.size} - ${o.brand} ${o.grade} - ${o.batch})`;
        if (!finishedGoodsProduced[fKey]) {
          finishedGoodsProduced[fKey] = {
            producedMtrs: 0,
            producedKgs: 0,
            dispatchedMtrs: 0,
            dispatchedKgs: 0,
            batch: o.batch,
            brandGrade: `${o.brand} ${o.grade}`,
          };
        }
        const orderFinishedKgs = effCuKg + effInsKg + effSheathKg;
        const dispMtrs = o.dispatched
          ? r.orderLen
          : Math.min(r.orderLen, o.dispatchedLength || 0);
        const dispKgs = o.dispatched
          ? orderFinishedKgs
          : Math.min(
              orderFinishedKgs,
              o.dispatchedWeight !== undefined
                ? o.dispatchedWeight
                : r.orderLen > 0
                ? orderFinishedKgs * (dispMtrs / r.orderLen)
                : 0
            );

        finishedGoodsProduced[fKey].producedMtrs += r.orderLen;
        finishedGoodsProduced[fKey].producedKgs += orderFinishedKgs;
        finishedGoodsProduced[fKey].dispatchedMtrs += dispMtrs;
        finishedGoodsProduced[fKey].dispatchedKgs += dispKgs;

        totalFinishedMtrs += r.orderLen;
        totalFinishedKgs += orderFinishedKgs;
        totalDispMtrs += dispMtrs;
        totalDispKgs += dispKgs;
      }
    }
  });

  // Also accumulate manual packing items into finished stock if any
  manualPackingItems.forEach(m => {
    const fKey = `Finished Cable Drum (${m.sizeCores} - ${m.brandGrade} - ${m.batch})`;
    if (!finishedGoodsProduced[fKey]) {
      const netKgs = (m.cuWt || 0) + (m.compWt || 0);
      const isDisp = Boolean(m.dispatched || m.status === 'Dispatched');
      finishedGoodsProduced[fKey] = {
        producedMtrs: m.len || 0,
        producedKgs: netKgs,
        dispatchedMtrs: isDisp ? m.len || 0 : 0,
        dispatchedKgs: isDisp ? netKgs : 0,
        batch: m.batch,
        brandGrade: m.brandGrade,
      };
      totalFinishedMtrs += m.len || 0;
      totalFinishedKgs += netKgs;
      if (isDisp) {
        totalDispMtrs += m.len || 0;
        totalDispKgs += netKgs;
      }
    }
  });

  // 2. Accumulators for Returns & Rejections
  let totalRejectionsKg = 0;
  let totalReturnsKg = 0;

  const returnsMap: Record<
    string,
    {
      supplierRejections: number;
      scrapRejections: number;
      customerReturns: number;
      lineReturns: number;
    }
  > = {};

  stockReturns.forEach(ret => {
    if (selectedMonth && selectedMonth !== 'ALL' && ret.date && !ret.date.startsWith(selectedMonth)) {
      return;
    }
    const matKey = normalizeMaterialKey(ret.category, ret.materialName);
    if (!returnsMap[matKey]) {
      returnsMap[matKey] = {
        supplierRejections: 0,
        scrapRejections: 0,
        customerReturns: 0,
        lineReturns: 0,
      };
    }
    const qty = parseFloat(String(ret.qty)) || 0;
    if (ret.type === 'supplier_rejection') {
      returnsMap[matKey].supplierRejections += qty;
      totalRejectionsKg += qty;
    } else if (ret.type === 'scrap_rejection') {
      returnsMap[matKey].scrapRejections += qty;
      totalRejectionsKg += qty;
    } else if (ret.type === 'customer_return') {
      returnsMap[matKey].customerReturns += qty;
      totalReturnsKg += qty;
    } else if (ret.type === 'line_return') {
      returnsMap[matKey].lineReturns += qty;
      totalReturnsKg += qty;
    }
  });

  // 3. Purchase Items aggregation by category & material
  const purchaseByMat: Record<
    string,
    { category: string; name: string; unit: string; received: number; consumedFromPurchase: number }
  > = {};
  const rawCopperPurchasedByStrand: Record<string, number> = {};
  const insulationPurchasedByGrade: Record<string, { received: number; purchaseDates: string[] }> = {};
  const sheathingPurchasedByGrade: Record<string, { received: number; purchaseDates: string[] }> = {};

  purchaseItems.forEach(p => {
    if (!isDateInMonth(p.date)) {
      return;
    }
    const desc = (p.description || '').trim();
    if (!desc) return;
    const qty = parseFloat(String(p.qty)) || 0;
    const used = parseFloat(String(p.usedQty || 0)) || 0;
    const dUpper = desc.toUpperCase();

    let cat = 'RAW MATERIALS';
    if (p.stage === 'bunch' || dUpper.includes('BUNCH')) {
      cat = 'BUNCHED COPPER (PURCHASED ⚡)';
    } else if (
      p.stage === 'raw' ||
      dUpper.includes('0.2') ||
      dUpper.includes('0.1') ||
      dUpper.includes('0.3') ||
      dUpper.includes('0.4') ||
      dUpper.includes('COPPER') ||
      dUpper.includes('MM²') ||
      dUpper.includes('STRANDS')
    ) {
      cat = 'RAW COPPER (STRAND-WISE)';
      const strand = extractStrandDiameter(p.conductor || desc);
      if (strand && !strand.includes('/')) {
        rawCopperPurchasedByStrand[strand] = (rawCopperPurchasedByStrand[strand] || 0) + qty;
      }
    } else if (
      p.stage === 'compound' ||
      dUpper.includes('KI-06') ||
      dUpper.includes('A 80') ||
      dUpper.includes('A80') ||
      dUpper.includes('TI1') ||
      dUpper.includes('INSULATION')
    ) {
      // Check if it's sheathing compound first if HD Black or KI-05 or ST-1
      if (
        dUpper.includes('KI-05') ||
        dUpper.includes('ST-1') ||
        dUpper.includes('ST1') ||
        dUpper.includes('ST2') ||
        dUpper.includes('HD BLACK') ||
        dUpper.includes('SHEATH')
      ) {
        cat = 'SHEATHING COMPOUND';
        const grade = canonicalSheathGrade(desc);
        if (!sheathingPurchasedByGrade[grade]) {
          sheathingPurchasedByGrade[grade] = { received: 0, purchaseDates: [] };
        }
        sheathingPurchasedByGrade[grade].received += qty;
        if (p.date && !sheathingPurchasedByGrade[grade].purchaseDates.includes(p.date)) {
          sheathingPurchasedByGrade[grade].purchaseDates.push(p.date);
        }
      } else {
        cat = 'INSULATION COMPOUND';
        const grade = canonicalInsulationGrade(desc);
        if (!insulationPurchasedByGrade[grade]) {
          insulationPurchasedByGrade[grade] = { received: 0, purchaseDates: [] };
        }
        insulationPurchasedByGrade[grade].received += qty;
        if (p.date && !insulationPurchasedByGrade[grade].purchaseDates.includes(p.date)) {
          insulationPurchasedByGrade[grade].purchaseDates.push(p.date);
        }
      }
    } else if (
      dUpper.includes('KI-05') ||
      dUpper.includes('ST-1') ||
      dUpper.includes('ST1') ||
      dUpper.includes('ST2') ||
      dUpper.includes('SHEATH') ||
      dUpper.includes('HD BLACK')
    ) {
      cat = 'SHEATHING COMPOUND';
      const grade = canonicalSheathGrade(desc);
      if (!sheathingPurchasedByGrade[grade]) {
        sheathingPurchasedByGrade[grade] = { received: 0, purchaseDates: [] };
      }
      sheathingPurchasedByGrade[grade].received += qty;
      if (p.date && !sheathingPurchasedByGrade[grade].purchaseDates.includes(p.date)) {
        sheathingPurchasedByGrade[grade].purchaseDates.push(p.date);
      }
    } else if (dUpper.includes('DRUM')) {
      cat = 'DRUMS';
    } else if (dUpper.includes('PALLET')) {
      cat = 'PALLETS';
    }

    const key = normalizeMaterialKey(cat, desc);
    if (!purchaseByMat[key]) {
      purchaseByMat[key] = {
        category: cat,
        name: desc,
        unit: 'KGS',
        received: 0,
        consumedFromPurchase: 0,
      };
    }
    purchaseByMat[key].received += qty;
    purchaseByMat[key].consumedFromPurchase += used;
  });

  // 4. Build Detailed Ledger Rows for each category
  const rawCopperRows: StockLedgerRow[] = [];
  const bunchedCopperRows: StockLedgerRow[] = [];
  const insulationRows: StockLedgerRow[] = [];
  const sheathingRows: StockLedgerRow[] = [];
  const drumRows: StockLedgerRow[] = [];
  const palletRows: StockLedgerRow[] = [];
  const semiFinishedRows: StockLedgerRow[] = [];
  const finishedGoodsRows: StockLedgerRow[] = [];
  const customRows: StockLedgerRow[] = [];

  // Helper to get returns for a material key
  const getReturns = (cat: string, name: string) => {
    const k = normalizeMaterialKey(cat, name);
    return returnsMap[k] || {
      supplierRejections: 0,
      scrapRejections: 0,
      customerReturns: 0,
      lineReturns: 0,
    };
  };

  // Helper to get opening stock (strictly 0 unless manually entered by user in stockOpenings)
  const getOpening = (cat: string, name: string, altRowKey?: string): number => {
    if (altRowKey && stockOpenings[altRowKey] !== undefined) return Number(stockOpenings[altRowKey]) || 0;
    const k = normalizeMaterialKey(cat, name);
    if (stockOpenings[k] !== undefined) return Number(stockOpenings[k]) || 0;
    const fallbackKey = `${cat.toUpperCase()}||${name}`;
    if (stockOpenings[fallbackKey] !== undefined) return Number(stockOpenings[fallbackKey]) || 0;
    if (altRowKey && stockOverrides[altRowKey]?.opening !== undefined) {
      return Number(stockOverrides[altRowKey].opening) || 0;
    }
    if (stockOverrides[k]?.opening !== undefined) return Number(stockOverrides[k].opening) || 0;
    if (stockOverrides[fallbackKey]?.opening !== undefined) {
      return Number(stockOverrides[fallbackKey].opening) || 0;
    }
    return 0;
  };

  // --- RAW COPPER STRAND-WISE ROWS ---
  // Seed distinct raw drawn copper conductor wire strands (single drawn wires before bunching)
  const rawCopperStrands = new Set<string>(['0.180', '0.210', '0.260', '0.265', '0.266', 'General Copper']);

  // Add any distinct single strand diameters from active orders (e.g. 52/0.260 -> 0.260, 294/0.266 -> 0.266)
  expandedOrders.forEach(o => {
    if (o.conductor) {
      const strand = extractStrandDiameter(o.conductor);
      if (strand && !strand.includes('/')) {
        rawCopperStrands.add(strand);
      }
    }
  });

  // Add any raw copper strands from purchases
  Object.keys(rawCopperPurchasedByStrand).forEach(s => {
    if (s && !s.includes('/')) {
      rawCopperStrands.add(extractStrandDiameter(s));
    }
  });

  // Add any raw copper strands from openings (excluding bunched conductor specs with slash)
  Object.keys(stockOpenings).forEach(k => {
    if (k.startsWith('RAW_COPPER||')) {
      const s = k.replace('RAW_COPPER||', '').trim();
      if (s && !s.includes('/')) {
        rawCopperStrands.add(extractStrandDiameter(s));
      }
    }
  });

  rawCopperStrands.forEach(strand => {
    const rowKey = `COPPER||${strand}`;
    const legacyRowKey = strand === '0.210' ? 'COPPER||0.21 Drawn Strands' : undefined;
    const pKey = normalizeMaterialKey('RAW COPPER (STRAND-WISE)', strand);
    const pData = purchaseByMat[pKey];
    const calcReceived = (rawCopperPurchasedByStrand[strand] || 0) + (pData?.received || 0);
    const received =
      stockOverrides[rowKey]?.received !== undefined
        ? stockOverrides[rowKey].received!
        : legacyRowKey && stockOverrides[legacyRowKey]?.received !== undefined
        ? stockOverrides[legacyRowKey].received!
        : calcReceived;

    // Stage 1 (Order Entry): Pending orders register as activeReq (Requisition Demand) without modifying physical stock.
    // Stage 2 (Processing): When processed, materials move into stageConsumed and are deducted from physical closing inventory.
    const stageConsumed = copperStageConsumedByStrand[strand] || 0;
    const activeReq = copperActiveReqByStrand[strand] || 0;
    const calcConsumed = stageConsumed;

    const consumed =
      stockOverrides[rowKey]?.consumed !== undefined
        ? stockOverrides[rowKey].consumed!
        : legacyRowKey && stockOverrides[legacyRowKey]?.consumed !== undefined
        ? stockOverrides[legacyRowKey].consumed!
        : calcConsumed;

    const rets = getReturns('COPPER', strand);
    const rawKey = `RAW_COPPER||${strand}`;
    const opening =
      stockOpenings[rawKey] !== undefined
        ? Number(stockOpenings[rawKey]) || 0
        : stockOpenings[rowKey] !== undefined
        ? Number(stockOpenings[rowKey]) || 0
        : getOpening('RAW_COPPER', strand, rowKey);

    // Closing = Opening + Received + Inward Returns - Consumed (Stage 2 Processed) - Rejections
    const closing =
      opening +
      received +
      rets.customerReturns +
      rets.lineReturns -
      consumed -
      rets.supplierRejections -
      rets.scrapRejections;
    const availableStock = Math.max(0, closing - activeReq);

    const bunchedSizes = Array.from(copperBunchedSizesByStrand[strand] || []);
    let remark = 'Ready for Bunching Machine';
    if (consumed > 0 && activeReq > 0) {
      remark = `Deducted ${consumed.toFixed(1)} kg Processed Copper • ${activeReq.toFixed(1)} kg Pending Requisition Demand${
        bunchedSizes.length > 0 ? ` • Sizes: ${bunchedSizes.join(', ')}` : ''
      }`;
    } else if (consumed > 0) {
      remark = `Deducted ${consumed.toFixed(1)} kg Processed Copper (${stageConsumed.toFixed(1)} kg in production)${
        bunchedSizes.length > 0 ? ` • Sizes: ${bunchedSizes.join(', ')}` : ''
      }`;
    } else if (activeReq > 0) {
      remark = `Pending Requisition Demand: ${activeReq.toFixed(1)} kg (Inventory intact until processed)${
        bunchedSizes.length > 0 ? ` • Sizes: ${bunchedSizes.join(', ')}` : ''
      }`;
    }

    const row: StockLedgerRow = {
      key: rowKey,
      category: 'RAW COPPER (STRAND-WISE)',
      name:
        strand === '0.210'
          ? 'Raw Copper Wire (0.210 mm / 0.21 Drawn Strands)'
          : `Raw Copper Wire (${strand})`,
      unit: 'KGS',
      opening,
      received,
      consumed,
      stageConsumedQty: stageConsumed,
      activeOrderReqQty: activeReq,
      availableStock,
      supplierRejections: rets.supplierRejections,
      scrapRejections: rets.scrapRejections,
      customerReturns: rets.customerReturns,
      lineReturns: rets.lineReturns,
      closing,
      closingMtrsStr: '-',
      closingKgsStr: `${closing.toFixed(2)} kg`,
      isWeightOnly: true,
      stageSource: 'B',
      remark,
    };
    rawCopperRows.push(row);
  });

  // --- BUNCHED COPPER ROWS ---
  // Include purchased bunched copper lots
  Object.entries(purchaseByMat).forEach(([, p]) => {
    if (p.category === 'BUNCHED COPPER (PURCHASED ⚡)') {
      const rowKey = `BUNCH_PURCHASE||${p.name}`;
      const rets = getReturns('COPPER', p.name);
      const opening = getOpening('BUNCHED_COPPER', p.name, rowKey);
      const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : p.received;
      const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : p.consumedFromPurchase;
      const closing = opening + received + rets.customerReturns + rets.lineReturns - consumed - rets.supplierRejections - rets.scrapRejections;
      bunchedCopperRows.push({
        key: rowKey,
        category: 'BUNCHED COPPER (PURCHASED ⚡)',
        name: `Purchased Bunched Copper: ${p.name}`,
        unit: 'KGS',
        opening,
        received,
        consumed,
        supplierRejections: rets.supplierRejections,
        scrapRejections: rets.scrapRejections,
        customerReturns: rets.customerReturns,
        lineReturns: rets.lineReturns,
        closing,
        closingMtrsStr: '-',
        closingKgsStr: `${closing.toFixed(2)} kg`,
        isWeightOnly: true,
        stageSource: 'B',
        remark:
          consumed > 0
            ? `Allocated ${consumed.toFixed(1)} kg to Bunch stage`
            : 'Purchased bunched stock ready for line',
      });
    }
  });

  // Also include Copper Bunch Size Copper from active orders and stockOpenings
  const distinctBunchedCopperSizes = new Set<string>();
  expandedOrders.forEach(o => {
    if (o.conductor && o.conductor.includes('/')) {
      const bSpec = `${o.conductor.trim()}${o.size ? ` (${o.size.trim()})` : ''}`;
      distinctBunchedCopperSizes.add(bSpec);
    }
  });
  Object.keys(stockOpenings).forEach(k => {
    if (
      k.startsWith('BUNCHED_COPPER||') &&
      !k.endsWith('||MTRS') &&
      !k.endsWith('||KGS')
    ) {
      const bName = k.replace('BUNCHED_COPPER||', '').trim();
      if (bName) distinctBunchedCopperSizes.add(bName);
    }
  });

  distinctBunchedCopperSizes.forEach(bName => {
    const rowKey = `BUNCHED_COPPER||${bName}`;
    if (!bunchedCopperRows.some(r => r.key === rowKey)) {
      const opening =
        stockOpenings[rowKey] !== undefined
          ? Number(stockOpenings[rowKey]) || 0
          : getOpening('BUNCHED_COPPER', bName, rowKey);
      const openingMtrs = Number(stockOpenings[`${rowKey}||MTRS`]) || 0;
      const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : 0;
      const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : 0;
      const rets = getReturns('COPPER', bName);
      const closing = opening + received + rets.customerReturns + rets.lineReturns - consumed - rets.supplierRejections - rets.scrapRejections;
      // Show row if it has opening/received/consumed or comes from an active order or explicit stockOpenings entry
      if (opening > 0 || openingMtrs > 0 || received > 0 || consumed > 0 || stockOpenings[rowKey] !== undefined || expandedOrders.some(o => `${o.conductor?.trim()}${o.size ? ` (${o.size.trim()})` : ''}` === bName)) {
        bunchedCopperRows.push({
          key: rowKey,
          category: 'BUNCHED COPPER (OPENING ⚡)',
          name: `Copper Bunch Size: ${bName}`,
          unit: openingMtrs > 0 ? 'KGS & MTRS' : 'KGS',
          opening,
          received,
          consumed,
          supplierRejections: rets.supplierRejections,
          scrapRejections: rets.scrapRejections,
          customerReturns: rets.customerReturns,
          lineReturns: rets.lineReturns,
          closing,
          closingMtrsStr: openingMtrs > 0 ? `${openingMtrs.toLocaleString()} m` : '-',
          closingKgsStr: `${closing.toFixed(2)} kg`,
          isWeightOnly: openingMtrs <= 0,
          stageSource: 'B',
          remark:
            openingMtrs > 0
              ? `Opening Bunch Stock: ${opening.toFixed(2)} kg (${openingMtrs.toLocaleString()} m)`
              : 'Copper Bunch Size Opening Stock (Ready for Insulation / Stranding)',
        });
      }
    }
  });

  // Include in-house bunched copper batches produced at B
  Object.entries(bunchStageProduced).forEach(([bName, bObj]) => {
    const rowKey = `BUNCH_STAGE||${bName}`;
    const rets = getReturns('COPPER', bName);
    const opening = getOpening('BUNCHED_STAGE', bName, rowKey);
    const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : bObj.mtrs;
    const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : 0;
    const closing = opening + bObj.kgs + rets.lineReturns - consumed - rets.scrapRejections;
    bunchedCopperRows.push({
      key: rowKey,
      category: 'SEMI-FINISHED (BUNCH STAGE B ⏳)',
      name: bName,
      unit: 'MTRS & KGS',
      opening,
      received,
      consumed,
      supplierRejections: 0,
      scrapRejections: rets.scrapRejections,
      customerReturns: 0,
      lineReturns: rets.lineReturns,
      closing: bObj.mtrs,
      closingMtrsStr: `${bObj.mtrs.toLocaleString()} m`,
      closingKgsStr: `${closing.toFixed(2)} kg`,
      isFinishedDirectWt: true,
      directKgs: closing,
      stageSource: 'B',
      remark: 'Produced by In-House Bunching Machine',
    });
  });

  // --- INSULATION PVC COMPOUNDS ---
  const distinctInsCompounds = new Set<string>(['KI-06', 'KI-13', 'A 80 UW', 'A 80 NATURAL', 'TI1', 'GRADE A']);
  expandedOrders.forEach(o => {
    if (o.ins_compound) distinctInsCompounds.add(canonicalInsulationGrade(o.ins_compound));
  });
  Object.keys(insulationPurchasedByGrade).forEach(g => {
    distinctInsCompounds.add(g);
  });
  Object.keys(stockOpenings).forEach(k => {
    if (k.startsWith('INSULATION||')) {
      distinctInsCompounds.add(canonicalInsulationGrade(k.replace('INSULATION||', '')));
    }
  });

  distinctInsCompounds.forEach(comp => {
    const rowKey = `INSULATION||${comp}`;
    const pKey = normalizeMaterialKey('INSULATION COMPOUND', comp);
    const pData = purchaseByMat[pKey];
    const purchaseInfo = insulationPurchasedByGrade[comp];
    const calcReceived = (purchaseInfo?.received || 0) + (pData && !purchaseInfo ? pData.received : 0);
    const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : calcReceived;

    const stageConsumed = insStageConsumed[comp] || 0;
    const activeReq = insActiveReq[comp] || 0;
    const calcConsumed = stageConsumed;
    const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : calcConsumed;
    const rets = getReturns('INSULATION', comp);
    const opening = getOpening('INSULATION', comp, rowKey);

    const closing = opening + received + rets.customerReturns + rets.lineReturns - consumed - rets.supplierRejections - rets.scrapRejections;
    const availableStock = Math.max(0, closing - activeReq);

    const purchaseDates = purchaseInfo?.purchaseDates || [];
    let remark = 'Ready for Extruder line';
    if (consumed > 0 && activeReq > 0) {
      remark = `Deducted ${consumed.toFixed(1)} kg Processed PVC • ${activeReq.toFixed(1)} kg Pending Requisition Demand`;
    } else if (consumed > 0) {
      remark = `Deducted ${consumed.toFixed(1)} kg Processed PVC Insulation`;
    } else if (activeReq > 0) {
      remark = `Pending Requisition Demand: ${activeReq.toFixed(1)} kg (Inventory intact until processed)`;
    } else if (received > 0) {
      remark = `Inward ${received.toFixed(1)} kg (${purchaseDates.length} purchase${purchaseDates.length > 1 ? 's: ' : ': '}${purchaseDates.join(', ')})`;
    }

    insulationRows.push({
      key: rowKey,
      category: 'INSULATION COMPOUND',
      name: `PVC Insulation Compound: ${comp}`,
      unit: 'KGS',
      opening,
      received,
      consumed,
      stageConsumedQty: stageConsumed,
      activeOrderReqQty: activeReq,
      availableStock,
      supplierRejections: rets.supplierRejections,
      scrapRejections: rets.scrapRejections,
      customerReturns: rets.customerReturns,
      lineReturns: rets.lineReturns,
      closing,
      closingMtrsStr: '-',
      closingKgsStr: `${closing.toFixed(2)} kg`,
      isWeightOnly: true,
      stageSource: 'I',
      remark,
    });
  });

  // --- SHEATHING PVC COMPOUNDS ---
  const distinctSheathCompounds = new Set<string>(['KI-05', 'ST-1 GREY', 'A80 HD BLACK', 'ST2']);
  expandedOrders.forEach(o => {
    if (o.sheath_compound && !isIs694Order(o)) {
      distinctSheathCompounds.add(canonicalSheathGrade(o.sheath_compound));
    }
  });
  Object.keys(sheathingPurchasedByGrade).forEach(g => {
    distinctSheathCompounds.add(g);
  });
  Object.keys(stockOpenings).forEach(k => {
    if (k.startsWith('SHEATH||')) {
      distinctSheathCompounds.add(canonicalSheathGrade(k.replace('SHEATH||', '')));
    }
  });

  distinctSheathCompounds.forEach(comp => {
    const rowKey = `SHEATH||${comp}`;
    const pKey = normalizeMaterialKey('SHEATHING COMPOUND', comp);
    const pData = purchaseByMat[pKey];
    const purchaseInfo = sheathingPurchasedByGrade[comp];
    const calcReceived = (purchaseInfo?.received || 0) + (pData && !purchaseInfo ? pData.received : 0);
    const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : calcReceived;

    const stageConsumed = sheathStageConsumed[comp] || 0;
    const activeReq = sheathActiveReq[comp] || 0;
    const calcConsumed = stageConsumed;
    const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : calcConsumed;
    const rets = getReturns('SHEATH', comp);
    const opening = getOpening('SHEATH', comp, rowKey);

    const closing = opening + received + rets.customerReturns + rets.lineReturns - consumed - rets.supplierRejections - rets.scrapRejections;
    const availableStock = Math.max(0, closing - activeReq);

    const purchaseDates = purchaseInfo?.purchaseDates || [];
    let remark = 'Ready for Sheathing Line';
    if (consumed > 0 && activeReq > 0) {
      remark = `Deducted ${consumed.toFixed(1)} kg Processed Sheath • ${activeReq.toFixed(1)} kg Pending Requisition Demand`;
    } else if (consumed > 0) {
      remark = `Deducted ${consumed.toFixed(1)} kg Processed Sheath Compound`;
    } else if (activeReq > 0) {
      remark = `Pending Requisition Demand: ${activeReq.toFixed(1)} kg (Inventory intact until processed)`;
    } else if (received > 0) {
      remark = `Inward ${received.toFixed(1)} kg (${purchaseDates.length} purchase${purchaseDates.length > 1 ? 's: ' : ': '}${purchaseDates.join(', ')})`;
    }

    sheathingRows.push({
      key: rowKey,
      category: 'SHEATHING COMPOUND',
      name: `PVC Sheathing Compound: ${comp}`,
      unit: 'KGS',
      opening,
      received,
      consumed,
      stageConsumedQty: stageConsumed,
      activeOrderReqQty: activeReq,
      availableStock,
      supplierRejections: rets.supplierRejections,
      scrapRejections: rets.scrapRejections,
      customerReturns: rets.customerReturns,
      lineReturns: rets.lineReturns,
      closing,
      closingMtrsStr: '-',
      closingKgsStr: `${closing.toFixed(2)} kg`,
      isWeightOnly: true,
      stageSource: 'SH',
      remark,
    });
  });

  // --- WOODEN DRUMS (SIZE-WISE) ---
  const distinctDrums = new Set<string>(['28 X 12 X 15', '30 X 12 X 15', '30 X 12 X 19', '36 X 16 X 20']);
  Object.keys(drumConsumed).forEach(d => distinctDrums.add(d));
  Object.keys(stockOpenings).forEach(k => {
    if (k.startsWith('DRUM||')) {
      const d = k.replace('DRUM||', '').trim();
      if (d) distinctDrums.add(d);
    }
  });

  distinctDrums.forEach(dSize => {
    const rowKey = `DRUM||${dSize}`;
    const dat = drumConsumed[dSize] || { totalReq: 0, consumed: 0 };
    const pKey = normalizeMaterialKey('DRUMS', dSize);
    const pData = purchaseByMat[pKey];
    const calcReceived = pData?.received || 0;
    const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : calcReceived;
    const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : dat.consumed;
    const rets = getReturns('DRUMS', dSize);
    const opening = getOpening('DRUM', dSize, rowKey);

    const closing = opening + received + rets.customerReturns + rets.lineReturns - consumed - rets.supplierRejections;

    drumRows.push({
      key: rowKey,
      category: 'DRUMS (SIZE-WISE)',
      name: `Wooden Drum: ${dSize}`,
      unit: 'NOS',
      opening,
      received,
      consumed,
      supplierRejections: rets.supplierRejections,
      scrapRejections: rets.scrapRejections,
      customerReturns: rets.customerReturns,
      lineReturns: rets.lineReturns,
      closing,
      closingMtrsStr: `${Math.round(closing)} Nos`,
      closingKgsStr: '-',
      isNosOnly: true,
      stageSource: 'SH',
      remark:
        consumed > 0
          ? `Auto-deducted ${consumed} drum(s) at Sheathing & Packing`
          : 'Available in Wood Yard',
    });
  });

  // --- PALLETS (SIZE-WISE) ---
  const distinctPallets = new Set<string>(['30X30x6', '36X36x6']);
  Object.keys(palletConsumed).forEach(p => distinctPallets.add(p));
  Object.keys(stockOpenings).forEach(k => {
    if (k.startsWith('PALLET||')) {
      const p = k.replace('PALLET||', '').trim();
      if (p) distinctPallets.add(p);
    }
  });

  distinctPallets.forEach(pSize => {
    const rowKey = `PALLET||${pSize}`;
    const dat = palletConsumed[pSize] || { totalReq: 0, consumed: 0 };
    const pKey = normalizeMaterialKey('PALLETS', pSize);
    const pData = purchaseByMat[pKey];
    const calcReceived = pData?.received || 0;
    const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : calcReceived;
    const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : dat.consumed;
    const rets = getReturns('PALLETS', pSize);
    const opening = getOpening('PALLET', pSize, rowKey);

    const closing = opening + received + rets.customerReturns + rets.lineReturns - consumed - rets.supplierRejections;

    palletRows.push({
      key: rowKey,
      category: 'PALLETS (SIZE-WISE)',
      name: `Wooden Pallet: ${pSize}`,
      unit: 'NOS',
      opening,
      received,
      consumed,
      supplierRejections: rets.supplierRejections,
      scrapRejections: rets.scrapRejections,
      customerReturns: rets.customerReturns,
      lineReturns: rets.lineReturns,
      closing,
      closingMtrsStr: `${Math.round(closing)} Nos`,
      closingKgsStr: '-',
      isNosOnly: true,
      stageSource: 'SH',
      remark:
        consumed > 0
          ? `Auto-deducted ${consumed} pallet(s) at Sheathing & Packing`
          : 'Available in Dispatch Area',
    });
  });

  // --- SEMI-FINISHED CORES (CS, I, TS) ---
  Object.entries(ladiStageProduced).forEach(([cName, cObj]) => {
    const rowKey = `STAGE_CS||${cName}`;
    const opening = stockOverrides[rowKey]?.opening !== undefined ? stockOverrides[rowKey].opening! : 0;
    const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : cObj.mtrs;
    const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : 0;
    const closing = opening + received - consumed;
    semiFinishedRows.push({
      key: rowKey,
      category: 'SEMI-FINISHED (STRANDING STAGE CS ⏳)',
      name: cName,
      unit: 'MTRS & KGS',
      opening,
      received,
      consumed,
      supplierRejections: 0,
      scrapRejections: 0,
      customerReturns: 0,
      lineReturns: 0,
      closing,
      closingMtrsStr: `${closing.toLocaleString()} m`,
      closingKgsStr: `${cObj.kgs.toFixed(2)} kg`,
      isFinishedDirectWt: true,
      directKgs: cObj.kgs,
      stageSource: 'B',
      remark: 'At Conductor Stranding Stage (Ladi)',
    });
  });

  Object.entries(insStageProduced).forEach(([iName, iObj]) => {
    const rowKey = `STAGE_I||${iName}`;
    const opening = stockOverrides[rowKey]?.opening !== undefined ? stockOverrides[rowKey].opening! : 0;
    const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : iObj.mtrs;
    const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : 0;
    const closing = opening + received - consumed;
    semiFinishedRows.push({
      key: rowKey,
      category: 'SEMI-FINISHED (INSULATION STAGE I ⏳)',
      name: iName,
      unit: 'MTRS & KGS',
      opening,
      received,
      consumed,
      supplierRejections: 0,
      scrapRejections: 0,
      customerReturns: 0,
      lineReturns: 0,
      closing,
      closingMtrsStr: `${closing.toLocaleString()} m`,
      closingKgsStr: `${iObj.kgs.toFixed(2)} kg`,
      isFinishedDirectWt: true,
      directKgs: iObj.kgs,
      stageSource: 'I',
      remark: 'At Insulation Core Stage (Extrusion Done)',
    });
  });

  Object.entries(twistStageProduced).forEach(([tName, tObj]) => {
    const rowKey = `STAGE_TS||${tName}`;
    const opening = stockOverrides[rowKey]?.opening !== undefined ? stockOverrides[rowKey].opening! : 0;
    const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : tObj.mtrs;
    const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : 0;
    const closing = opening + received - consumed;
    semiFinishedRows.push({
      key: rowKey,
      category: 'SEMI-FINISHED (TWISTING STAGE TS ⏳)',
      name: tName,
      unit: 'MTRS & KGS',
      opening,
      received,
      consumed,
      supplierRejections: 0,
      scrapRejections: 0,
      customerReturns: 0,
      lineReturns: 0,
      closing,
      closingMtrsStr: `${closing.toLocaleString()} m`,
      closingKgsStr: `${tObj.kgs.toFixed(2)} kg`,
      isFinishedDirectWt: true,
      directKgs: tObj.kgs,
      stageSource: 'I',
      remark: 'At Twisting / Assembly Stage (Ready for Sheath)',
    });
  });

  // Also include any Finished Goods entered directly into stockOpenings that are not in finishedGoodsProduced!
  Object.keys(stockOpenings).forEach(k => {
    if (k.startsWith('FINISHED||') || k.startsWith('FINISHED_GOODS||')) {
      const fName = k.replace(/^FINISHED(_GOODS)?\|\|/, '');
      if (!finishedGoodsProduced[fName]) {
        const isCarton = fName.includes('IS-694') || fName.includes('Carton') || fName.includes('Coil');
        const openingCoils = Number(stockOpenings[`${k}||COILS`]) || Number(stockOpenings[`${k}_COILS`]) || undefined;
        const openingCartons = Number(stockOpenings[`${k}||CARTONS`]) || Number(stockOpenings[`${k}_CARTONS`]) || undefined;
        finishedGoodsProduced[fName] = {
          producedMtrs: 0,
          producedKgs: 0,
          dispatchedMtrs: 0,
          dispatchedKgs: 0,
          batch: 'OPENING-STOCK',
          brandGrade: isCarton ? 'IS-694' : 'FINISHED CABLE',
          isIs694Carton: isCarton,
          coilsCount: openingCoils,
          cartonsCount: openingCartons,
        };
      }
    }
  });

  // --- FINISHED GOODS (WAREHOUSE & DISPATCH DEDUCTIONS) ---
  Object.entries(finishedGoodsProduced).forEach(([fName, fObj]) => {
    const rowKey = `FINISHED||${fName}`;
    const rets = getReturns('FINISHED', fName);
    const opening = getOpening('FINISHED', fName, rowKey);
    const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : fObj.producedMtrs;
    const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : fObj.dispatchedMtrs;

    const openingKg =
      stockOpenings[`${rowKey}||KGS`] !== undefined
        ? Number(stockOpenings[`${rowKey}||KGS`]) || 0
        : stockOpenings[`${rowKey}_KGS`] !== undefined
        ? Number(stockOpenings[`${rowKey}_KGS`]) || 0
        : 0;

    const openingCoils =
      stockOpenings[`${rowKey}||COILS`] !== undefined
        ? Number(stockOpenings[`${rowKey}||COILS`]) || 0
        : fObj.coilsCount || 0;

    const openingCartons =
      stockOpenings[`${rowKey}||CARTONS`] !== undefined
        ? Number(stockOpenings[`${rowKey}||CARTONS`]) || 0
        : fObj.cartonsCount || 0;

    const netProducedMtrs = received + rets.customerReturns;
    const remainingMtrs = opening + netProducedMtrs - consumed;

    const netProducedKgs = (openingKg > 0 ? openingKg : 0) + fObj.producedKgs + (rets.customerReturns > 0 ? (fObj.producedKgs / (fObj.producedMtrs || 1)) * rets.customerReturns : 0);
    const remainingKgs = Math.max(0, netProducedKgs - fObj.dispatchedKgs);

    const isFullyDispatched = consumed > 0 && remainingMtrs <= 0;
    const isPartiallyDispatched = consumed > 0 && remainingMtrs > 0;

    const effectiveCoils = openingCoils > 0 && fObj.producedMtrs === 0 ? openingCoils : fObj.coilsCount;
    const effectiveCartons = openingCartons > 0 && fObj.producedMtrs === 0 ? openingCartons : fObj.cartonsCount;

    finishedGoodsRows.push({
      key: rowKey,
      category: isFullyDispatched
        ? 'FINISHED GOODS (DISPATCHED 🚚)'
        : fObj.isIs694Carton
        ? 'FINISHED GOODS — IS-694 CARTON STOCK (WAREHOUSE ✅)'
        : 'FINISHED GOODS (WAREHOUSE STOCK ✅)',
      name: fName,
      unit: 'MTRS & KGS',
      opening,
      received,
      consumed,
      consumedKgs: fObj.dispatchedKgs,
      supplierRejections: 0,
      scrapRejections: rets.scrapRejections,
      customerReturns: rets.customerReturns,
      lineReturns: rets.lineReturns,
      closing: remainingMtrs,
      closingMtrsStr: fObj.isIs694Carton && effectiveCoils
        ? `${remainingMtrs.toLocaleString()} m (${effectiveCoils} Coils / ${effectiveCartons || 0} Ctns)`
        : `${remainingMtrs.toLocaleString()} m`,
      closingKgsStr: `${remainingKgs.toFixed(2)} kg`,
      isFinishedDirectWt: true,
      directKgs: remainingKgs,
      stageSource: fObj.isIs694Carton ? 'I' : 'DISPATCH',
      remark: isFullyDispatched
        ? `🚚 Dispatched (-${consumed.toLocaleString()} m / -${fObj.dispatchedKgs.toFixed(1)} kg Auto-Deducted)`
        : isPartiallyDispatched
        ? `🚚 Partial Dispatch (-${consumed.toLocaleString()} m / -${fObj.dispatchedKgs.toFixed(1)} kg Deducted)`
        : fObj.isIs694Carton
        ? `📦 Attached to Stock on IS-694 Insulation Completion (Final Stage) • ${fObj.cartonSummary || `${effectiveCoils || 0} Coils / ${effectiveCartons || 0} Master Cartons`}`
        : '✅ In Finished Warehouse (Ready for Dispatch / Container Loading)',
    });
  });

  // --- CUSTOM STOCK ITEMS ---
  customStockItems.forEach((c, cIdx) => {
    const rowKey = `CUSTOM||${c.name}||${cIdx}`;
    const rets = getReturns(c.category, c.name);
    const opening = stockOverrides[rowKey]?.opening !== undefined ? stockOverrides[rowKey].opening! : (c.opening !== undefined ? c.opening : getOpening(c.category, c.name));
    const received = stockOverrides[rowKey]?.received !== undefined ? stockOverrides[rowKey].received! : (c.received || 0);
    const consumed = stockOverrides[rowKey]?.consumed !== undefined ? stockOverrides[rowKey].consumed! : (c.consumed || 0);
    const closing = opening + received + rets.customerReturns + rets.lineReturns - consumed - rets.supplierRejections - rets.scrapRejections;

    const isNos = c.isNosOnly || c.unit.toUpperCase() === 'NOS';
    const isWeight = c.isWeightOnly || c.unit.toUpperCase() === 'KGS';

    customRows.push({
      ...c,
      key: `CUSTOM||${c.name}||${cIdx}`,
      opening,
      received,
      consumed,
      supplierRejections: rets.supplierRejections,
      scrapRejections: rets.scrapRejections,
      customerReturns: rets.customerReturns,
      lineReturns: rets.lineReturns,
      closing,
      closingMtrsStr: isNos ? `${closing} Nos` : isWeight ? '-' : `${closing.toLocaleString()} m`,
      closingKgsStr: isWeight ? `${closing.toFixed(2)} kg` : '-',
      isCustom: true,
      customIdx: cIdx,
    });
  });

  // Consolidated rows list
  const allRows: StockLedgerRow[] = [
    ...rawCopperRows,
    ...bunchedCopperRows,
    ...insulationRows,
    ...sheathingRows,
    ...drumRows,
    ...palletRows,
    ...semiFinishedRows,
    ...finishedGoodsRows,
    ...customRows,
  ];

  // Totals calculations
  let totalRawCopperStockKg = 0;
  rawCopperRows.forEach(r => (totalRawCopperStockKg += r.closing));
  bunchedCopperRows.forEach(r => {
    totalRawCopperStockKg += r.directKgs !== undefined ? r.directKgs : r.closing;
  });

  let totalInsulationStockKg = 0;
  insulationRows.forEach(r => (totalInsulationStockKg += r.closing));

  let totalSheathingStockKg = 0;
  sheathingRows.forEach(r => (totalSheathingStockKg += r.closing));

  let totalDrumsAvailable = 0;
  drumRows.forEach(r => (totalDrumsAvailable += r.closing));

  let totalPalletsAvailable = 0;
  palletRows.forEach(r => (totalPalletsAvailable += r.closing));

  const totalFinishedStockMtrs = Math.max(0, totalFinishedMtrs - totalDispMtrs);
  const totalFinishedStockKg = Math.max(0, totalFinishedKgs - totalDispKgs);

  return {
    allRows,
    rawCopperRows,
    bunchedCopperRows,
    insulationRows,
    sheathingRows,
    drumRows,
    palletRows,
    semiFinishedRows,
    finishedGoodsRows,
    customRows,
    stageConsumptionLogs,
    totals: {
      totalRawCopperStockKg,
      totalInsulationStockKg,
      totalSheathingStockKg,
      totalFinishedStockMtrs,
      totalFinishedStockKg,
      totalDispatchedMtrs: totalDispMtrs,
      totalDispatchedKg: totalDispKgs,
      totalDrumsAvailable,
      totalPalletsAvailable,
      totalRejectionsKg,
      totalReturnsKg,
    },
  };
}

/**
 * Automatically rolls over closing stock of sourceMonth into the opening stock of targetMonth
 */
export function rollMonthClosingToOpening(params: {
  sourceResult: StockLedgerResult;
  sourceMonthKey: string;
  targetMonthKey: string;
  existingSnapshots: Record<string, MonthlyStockSnapshot>;
}): {
  updatedSnapshots: Record<string, MonthlyStockSnapshot>;
  newOpeningMap: Record<string, number>;
} {
  const { sourceResult, sourceMonthKey, targetMonthKey, existingSnapshots } = params;

  const newOpeningMap: Record<string, number> = {};
  const closingMap: Record<string, { mtrs: number; kgs: number }> = {};

  sourceResult.allRows.forEach(row => {
    newOpeningMap[row.key] = row.closing;
    closingMap[row.key] = {
      mtrs: row.isNosOnly ? 0 : row.closing,
      kgs: row.isNosOnly ? 0 : row.closing,
    };
  });

  const updatedSnapshots: Record<string, MonthlyStockSnapshot> = {
    ...existingSnapshots,
    [sourceMonthKey]: {
      monthKey: sourceMonthKey,
      monthLabel: sourceMonthKey,
      isClosed: true,
      closedAt: new Date().toISOString(),
      openingMap: existingSnapshots[sourceMonthKey]?.openingMap || {},
      closingMap,
    },
    [targetMonthKey]: {
      monthKey: targetMonthKey,
      monthLabel: targetMonthKey,
      isClosed: false,
      openingMap: newOpeningMap,
    },
  };

  return {
    updatedSnapshots,
    newOpeningMap,
  };
}

/**
 * Automatically calculates FIFO deductions (`usedQty`) on `purchaseItems` from the Copper and PVC
 * requirements of all active and completed orders (including IS-694 parcel lots & operator production logs),
 * so the Purchase Sheet (Tab 7) and Low-Stock Alert Engine reflect real-time material consumption.
 */
export function syncPurchaseItemsWithOrderRequirements(
  purchaseItems: PurchaseItem[],
  orders: CableOrder[],
  densities: DensitySettings,
  ladiDimensions: LadiDimensionRule[]
): PurchaseItem[] {
  const expandedOrders = expandOrdersForMaterialRequirements(orders);

  const reqCopperByStrand: Record<string, number> = {};
  const reqBunchedById: Record<number, number> = {};
  const reqInsByGrade: Record<string, number> = {};
  const reqSheathByGrade: Record<string, number> = {};

  expandedOrders.forEach(o => {
    const r = computeRecordRow(o, densities, ladiDimensions);
    const is694 = isIs694Order(o);
    const opLogs = o.operator_production_logs || [];
    const opPvcKg = opLogs.reduce((s, l) => s + (Number(l.actualPvcKg) || 0), 0);
    const opCuKg = opLogs.reduce((s, l) => s + (Number(l.actualCuKg) || 0), 0);

    const effCuKg = opCuKg > 0 ? opCuKg : r.reqCu;
    const effInsKg = opPvcKg > 0 ? opPvcKg : r.reqIns;
    const effSheathKg = is694 ? 0 : r.reqSheath;

    if (o.bunch_source === 'purchased_stock' && o.purchased_copper_id) {
      reqBunchedById[o.purchased_copper_id] =
        (reqBunchedById[o.purchased_copper_id] || 0) +
        (o.purchased_copper_deducted_qty || effCuKg);
    } else if (effCuKg > 0) {
      const strand = extractStrandDiameter(o.conductor || '0.210');
      reqCopperByStrand[strand] = (reqCopperByStrand[strand] || 0) + effCuKg;
    }

    if (effInsKg > 0 && o.ins_compound) {
      const g = canonicalInsulationGrade(o.ins_compound);
      reqInsByGrade[g] = (reqInsByGrade[g] || 0) + effInsKg;
    }

    if (effSheathKg > 0 && o.sheath_compound) {
      const g = canonicalSheathGrade(o.sheath_compound);
      reqSheathByGrade[g] = (reqSheathByGrade[g] || 0) + effSheathKg;
    }
  });

  // Track remaining requirement to allocate FIFO across matching received purchase lots
  const remCu = { ...reqCopperByStrand };
  const remIns = { ...reqInsByGrade };
  const remSheath = { ...reqSheathByGrade };

  return purchaseItems.map(p => {
    if (p.status !== 'received') return p;
    const qty = Number(p.qty) || 0;
    if (qty <= 0) return p;

    if (p.stage === 'bunch') {
      const allocated = reqBunchedById[p.id] !== undefined ? reqBunchedById[p.id] : p.usedQty || 0;
      return {
        ...p,
        usedQty: Number(Math.min(qty, allocated).toFixed(2)),
      };
    }

    const desc = (p.description || '').trim();
    const dUpper = desc.toUpperCase();

    if (
      p.stage === 'raw' ||
      dUpper.includes('0.2') ||
      dUpper.includes('0.1') ||
      dUpper.includes('0.3') ||
      dUpper.includes('0.4') ||
      dUpper.includes('COPPER') ||
      dUpper.includes('STRANDS')
    ) {
      const strand = extractStrandDiameter(p.conductor || desc);
      const need = remCu[strand] || 0;
      if (need > 0) {
        const deduct = Math.min(qty, need);
        remCu[strand] = Math.max(0, need - deduct);
        return {
          ...p,
          usedQty: Number(deduct.toFixed(2)),
        };
      }
      return {
        ...p,
        usedQty: 0,
      };
    }

    if (
      dUpper.includes('KI-05') ||
      dUpper.includes('ST-1') ||
      dUpper.includes('ST1') ||
      dUpper.includes('ST2') ||
      dUpper.includes('HD BLACK') ||
      dUpper.includes('SHEATH')
    ) {
      const grade = canonicalSheathGrade(desc);
      const need = remSheath[grade] || 0;
      if (need > 0) {
        const deduct = Math.min(qty, need);
        remSheath[grade] = Math.max(0, need - deduct);
        return {
          ...p,
          usedQty: Number(deduct.toFixed(2)),
        };
      }
      return {
        ...p,
        usedQty: 0,
      };
    }

    if (
      p.stage === 'compound' ||
      dUpper.includes('KI-06') ||
      dUpper.includes('KI-13') ||
      dUpper.includes('A 80') ||
      dUpper.includes('A80') ||
      dUpper.includes('TI1') ||
      dUpper.includes('GRADE A') ||
      dUpper.includes('INSULATION')
    ) {
      const grade = canonicalInsulationGrade(desc);
      const need = remIns[grade] || 0;
      if (need > 0) {
        const deduct = Math.min(qty, need);
        remIns[grade] = Math.max(0, need - deduct);
        return {
          ...p,
          usedQty: Number(deduct.toFixed(2)),
        };
      }
      return {
        ...p,
        usedQty: 0,
      };
    }

    return p;
  });
}

export interface OrderStockRequirementItem {
  category: 'COPPER' | 'INSULATION' | 'SHEATH' | 'DRUM';
  materialName: string;
  requiredQty: number;
  availableQty: number;
  deficit: number;
  isSufficient: boolean;
  unit: string;
}

export interface OrderStockCheckResult {
  canProcess: boolean;
  items: OrderStockRequirementItem[];
  shortageCount: number;
  shortageSummary: string;
}

/**
 * Validates stock sufficiency before allowing an order to transition from
 * Stage 1 (Pending Requisition) to Stage 2 (Order Processing & Stock Deduction).
 */
export function validateOrderStockAvailability(
  order: CableOrder,
  liveStockLedger: StockLedgerResult,
  densities: DensitySettings,
  ladiDimensions: LadiDimensionRule[]
): OrderStockCheckResult {
  const r = computeRecordRow(order, densities, ladiDimensions);
  const items: OrderStockRequirementItem[] = [];

  // 1. Raw Copper Requirement Check
  const condStrand = (order.conductor || '0.210').trim();
  const rawStrand = extractStrandDiameter(condStrand);
  const reqCu = r.reqCu || 0;
  if (reqCu > 0 && order.bunch_source !== 'purchased_stock') {
    const cuRow = liveStockLedger.rawCopperRows.find(
      row => row.key === `COPPER||${rawStrand}` || row.name.includes(rawStrand)
    );
    const available = cuRow ? Math.max(0, cuRow.closing) : 0;
    const deficit = Math.max(0, reqCu - available);
    items.push({
      category: 'COPPER',
      materialName: `Raw Copper Wire (${rawStrand})`,
      requiredQty: reqCu,
      availableQty: available,
      deficit,
      isSufficient: deficit <= 0.05,
      unit: 'KG',
    });
  }

  // 2. Insulation Compound Requirement Check
  const reqIns = r.reqIns || 0;
  if (reqIns > 0) {
    const compName = canonicalInsulationGrade(order.ins_compound || 'KI-06');
    const insRow = liveStockLedger.insulationRows.find(
      row => row.key === `INSULATION||${compName}` || row.name.includes(compName)
    );
    const available = insRow ? Math.max(0, insRow.closing) : 0;
    const deficit = Math.max(0, reqIns - available);
    items.push({
      category: 'INSULATION',
      materialName: `PVC Insulation (${compName})`,
      requiredQty: reqIns,
      availableQty: available,
      deficit,
      isSufficient: deficit <= 0.05,
      unit: 'KG',
    });
  }

  // 3. Sheathing Compound Requirement Check (for Sheathed Multi-Core Cables)
  const is694 = isIs694Order(order);
  if (!is694) {
    const reqSheath = r.reqSheath || 0;
    if (reqSheath > 0) {
      const compName = canonicalSheathGrade(order.sheath_compound || 'KI-05');
      const sheathRow = liveStockLedger.sheathingRows.find(
        row => row.key === `SHEATH||${compName}` || row.name.includes(compName)
      );
      const available = sheathRow ? Math.max(0, sheathRow.closing) : 0;
      const deficit = Math.max(0, reqSheath - available);
      items.push({
        category: 'SHEATH',
        materialName: `PVC Sheathing (${compName})`,
        requiredQty: reqSheath,
        availableQty: available,
        deficit,
        isSufficient: deficit <= 0.05,
        unit: 'KG',
      });
    }
  }

  const shortages = items.filter(it => !it.isSufficient);
  const shortageSummary = shortages
    .map(
      s =>
        `${s.materialName}: Required ${s.requiredQty.toFixed(1)} ${s.unit}, Available ${s.availableQty.toFixed(1)} ${s.unit} (Deficit: ${s.deficit.toFixed(1)} ${s.unit})`
    )
    .join('; ');

  return {
    canProcess: shortages.length === 0,
    items,
    shortageCount: shortages.length,
    shortageSummary,
  };
}


