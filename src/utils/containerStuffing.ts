import {
  CableOrder,
  ContainerLoadItem,
  ContainerPlan,
  ContainerType,
  DensitySettings,
  LadiDimensionRule,
  PackagingRule,
  SizePackagingRule,
} from '../types/cable';
import {
  computeRecordRow,
  evaluateSpoolSizeForOrder,
  normalizeSpoolKey,
  parseSizeNum,
  resolveExactPalletAndBbnForSpool,
} from './calculations';
import type { StockLedgerResult } from './stockEngine';

export interface ParsedPalletDims {
  lengthIn: number;
  widthIn: number;
  baseHeightIn: number;
  label: string;
}

export interface ParsedSpoolDims {
  flangeDiaIn: number;
  barrelDiaIn: number;
  traverseWidthIn: number;
}

export function computePalletHeightBreakdown(
  spoolStr: string,
  drumsOnPallet: number,
  palletBaseHeight = 5.5,
  flangeClearance = 6
): {
  formula: string;
  result: number;
  traverse: number;
  barrel: number;
  flange: number;
  flangeClearance: number;
  palletBase: number;
  spoolFormatted: string;
} {
  const dims = parseSpoolDimensions(spoolStr);
  const traverse = dims.traverseWidthIn || 16;
  const count = Math.max(1, drumsOnPallet);

  if (count >= 2) {
    const total = traverse * 2 + flangeClearance + palletBaseHeight;
    return {
      formula: `${traverse} + ${traverse} + ${flangeClearance} + ${palletBaseHeight}`,
      result: Number(total.toFixed(1)),
      traverse,
      barrel: dims.barrelDiaIn,
      flange: dims.flangeDiaIn,
      flangeClearance,
      palletBase: palletBaseHeight,
      spoolFormatted: `${dims.flangeDiaIn} × ${dims.barrelDiaIn} × ${traverse}`,
    };
  }

  const total = traverse + flangeClearance + palletBaseHeight;
  return {
    formula: `${traverse} + ${flangeClearance} + ${palletBaseHeight}`,
    result: Number(total.toFixed(1)),
    traverse,
    barrel: dims.barrelDiaIn,
    flange: dims.flangeDiaIn,
    flangeClearance,
    palletBase: palletBaseHeight,
    spoolFormatted: `${dims.flangeDiaIn} × ${dims.barrelDiaIn} × ${traverse}`,
  };
}

export interface StowedPalletUnit {
  palletNumber: number;
  itemId: string;
  itemIndex: number;
  orderId?: number;
  batch: string;
  brandGrade: string;
  sizeCores: string;
  spool: string;
  palletSize: string;
  drumsOnPallet: number;
  maxDrumsPerPallet: number;
  palletLengthIn: number;
  palletWidthIn: number;
  palletBaseHeightIn: number;
  drumFlangeIn: number;
  barrelDiaIn?: number;
  traverseWidthIn?: number;
  heightFormula?: string;
  heightFormulaResult?: number;
  unitHeightIn: number; // palletBaseHeightIn + drumFlangeIn
  grossWeightKg: number;
  palletsPerRowStandard: number; // Math.floor(containerWidthIn / palletWidthIn)
}

export interface FloorSlotPlacement {
  slotIndex: number; // 0, 1, 2 across width (A, B, C)
  slotLabel: string; // 'Left (A)', 'Center (B)', 'Right (C)'
  widthIn: number;
  lengthIn: number;
  bottomPallet: StowedPalletUnit;
  topPallet?: StowedPalletUnit;
  totalStackHeightIn: number;
  topClearanceIn: number;
  totalDrumsInSlot: number;
  totalWeightInSlotKg: number;
}

export interface ContainerRowLayout {
  rowNumber: number;
  slots: FloorSlotPlacement[];
  palletsAcrossWidth: number;
  maxPalletsAcrossForRow: number;
  usedWidthIn: number;
  freeWidthIn: number;
  rowLengthIn: number;
  startLengthIn: number;
  endLengthIn: number;
  endLengthFt: number;
  maxRowHeightIn: number;
  heightClearanceIn: number;
  totalPalletsInRow: number;
  totalDrumsInRow: number;
  totalWeightInRowKg: number;
  fitsWithinLength: boolean;
  fitsWithinHeight: boolean;
}

export interface StandardPalletCapacitySpec {
  palletSize: string;
  widthIn: number;
  lengthIn: number;
  drumsPerPallet: number;
  palletsPerRow: number;
  usedRowWidthIn: number;
  freeRowWidthIn: number;
  maxRowsAlongLength: number;
  maxFloorPallets: number;
  maxFloorDrums: number;
}

export interface ContainerStuffingPlanResult {
  loadableLengthFt: number;
  loadableLengthIn: number;
  loadableWidthIn: number;
  loadableHeightIn: number;
  allowDoubleStack: boolean;
  totalPallets: number;
  totalFloorSlots: number;
  totalRows: number;
  totalDrums: number;
  usedLengthIn: number;
  usedLengthFt: number;
  remainingLengthIn: number;
  remainingLengthFt: number;
  lengthUtilizationPct: number;
  maxUsedWidthIn: number;
  maxUsedHeightIn: number;
  isLengthExceeded: boolean;
  isHeightExceeded: boolean;
  rows: ContainerRowLayout[];
  itemStowageMap: Record<string, string>; // itemId -> "Row 1..2 (3 Pallets / Row)"
  standardCapacities: StandardPalletCapacitySpec[];
}

export function getDefaultLoadableLengthFt(containerType: ContainerType): number {
  if (containerType === '20FT DRY' || containerType === '20FT OPEN TOP') {
    return 19.2;
  }
  return 38.2;
}

export function parsePalletDimensions(palletStr: string): ParsedPalletDims {
  const nums = (palletStr || '').match(/\d+(\.\d+)?/g);
  if (nums && nums.length >= 2) {
    const l = parseFloat(nums[0]) || 30;
    const w = parseFloat(nums[1]) || l;
    const h = nums.length >= 3 ? parseFloat(nums[2]) || 6 : 6;
    return {
      lengthIn: l,
      widthIn: w,
      baseHeightIn: h,
      label: `${l}″ × ${w}″ × ${h}″`,
    };
  }
  return {
    lengthIn: 30,
    widthIn: 30,
    baseHeightIn: 6,
    label: '30″ × 30″ × 6″',
  };
}

export function parseSpoolDimensions(spoolStr: string): ParsedSpoolDims {
  const nums = (spoolStr || '').match(/\d+(\.\d+)?/g);
  if (nums && nums.length >= 3) {
    return {
      flangeDiaIn: parseFloat(nums[0]) || 30,
      barrelDiaIn: parseFloat(nums[1]) || 12,
      traverseWidthIn: parseFloat(nums[2]) || 15,
    };
  }
  return {
    flangeDiaIn: 30,
    barrelDiaIn: 12,
    traverseWidthIn: 15,
  };
}

export function estimateDrumCbm(spoolStr: string, drumCount: number): number {
  const nums = (spoolStr || '').match(/\d+(\.\d+)?/g);
  if (nums && nums.length >= 3) {
    const flangeIn = parseFloat(nums[0]) || 36;
    const widthIn = parseFloat(nums[2]) || 20;
    const flangeM = flangeIn * 0.0254;
    const widthM = (widthIn + 4) * 0.0254;
    const singleCbm = flangeM * flangeM * widthM * 1.12;
    return Number((singleCbm * drumCount).toFixed(2));
  }
  return Number((0.45 * drumCount).toFixed(2));
}

export function lookupPackagingRuleBySpool(
  spoolStr: string | undefined | null,
  packagingRules: PackagingRule[]
): PackagingRule | undefined {
  const norm = normalizeSpoolKey(spoolStr);
  if (!norm) return undefined;
  return packagingRules.find(r => normalizeSpoolKey(r.spool) === norm);
}

/**
 * Looks up how many drums/bobbins fit on 1 pallet from PackagingRule lookup table
 * or item override.
 */
export function resolveDrumsPerPallet(
  item: ContainerLoadItem,
  packagingRules: PackagingRule[]
): number {
  if (item.drumsPerPallet && item.drumsPerPallet > 0) {
    return Math.max(1, Math.round(item.drumsPerPallet));
  }

  const exact = resolveExactPalletAndBbnForSpool(item.spool, packagingRules);
  if (exact && exact.bbnPerPallet > 0) {
    return exact.bbnPerPallet;
  }

  const palletDims = parsePalletDimensions(item.palletSize);
  if (palletDims.widthIn <= 30) {
    const spoolDims = parseSpoolDimensions(item.spool);
    return spoolDims.flangeDiaIn >= 30 && spoolDims.traverseWidthIn >= 19 ? 2 : 4;
  }
  if (palletDims.widthIn <= 42) {
    return 2;
  }
  return 1;
}

/**
 * Automatically arranges all loaded drums into pallets and packs them into rows
 * across the container's loadable width (default 90"), height (default 89"),
 * and length (default 19.2 ft for 20ft, 38.2 ft for 40ft).
 */
export function computeContainerStuffingPlan(
  container: ContainerPlan,
  packagingRules: PackagingRule[]
): ContainerStuffingPlanResult {
  const loadableWidthIn =
    container.loadableWidthIn && container.loadableWidthIn > 0
      ? container.loadableWidthIn
      : 90;
  const loadableHeightIn =
    container.loadableHeightIn && container.loadableHeightIn > 0
      ? container.loadableHeightIn
      : 89;
  const loadableLengthFt =
    container.loadableLengthFt && container.loadableLengthFt > 0
      ? container.loadableLengthFt
      : getDefaultLoadableLengthFt(container.containerType);
  const loadableLengthIn = Number((loadableLengthFt * 12).toFixed(1));
  const allowDoubleStack = container.allowDoubleStack ?? true;

  // Step 1: Expand items into individual StowedPalletUnits according to drumsPerPallet
  const allPallets: StowedPalletUnit[] = [];
  let palletCounter = 1;

  container.items.forEach((item, idx) => {
    const totalDrums = Math.max(0, Number(item.drumCount) || 0);
    if (totalDrums <= 0) return;

    const maxDrumsPerPallet = resolveDrumsPerPallet(item, packagingRules);
    const palletDims = parsePalletDimensions(item.palletSize);
    const spoolDims = parseSpoolDimensions(item.spool);
    const unitHeightIn = palletDims.baseHeightIn + spoolDims.flangeDiaIn;
    const palletsPerRowStandard = Math.max(
      1,
      Math.floor(loadableWidthIn / palletDims.widthIn)
    );
    const wtPerDrum = totalDrums > 0 ? (Number(item.grossWt) || 0) / totalDrums : 0;

    let remainingDrums = totalDrums;
    while (remainingDrums > 0) {
      const drumsOnThisPallet = Math.min(remainingDrums, maxDrumsPerPallet);
      remainingDrums -= drumsOnThisPallet;

      const heightCalc = computePalletHeightBreakdown(
        item.spool,
        drumsOnThisPallet,
        palletDims.baseHeightIn || 5.5,
        6
      );

      allPallets.push({
        palletNumber: palletCounter++,
        itemId: item.id,
        itemIndex: idx + 1,
        orderId: item.orderId,
        batch: item.batch,
        brandGrade: item.brandGrade,
        sizeCores: item.sizeCores,
        spool: item.spool,
        palletSize: item.palletSize || `${palletDims.lengthIn}X${palletDims.widthIn}x${palletDims.baseHeightIn}`,
        drumsOnPallet: drumsOnThisPallet,
        maxDrumsPerPallet,
        palletLengthIn: palletDims.lengthIn,
        palletWidthIn: palletDims.widthIn,
        palletBaseHeightIn: palletDims.baseHeightIn,
        drumFlangeIn: spoolDims.flangeDiaIn,
        barrelDiaIn: spoolDims.barrelDiaIn,
        traverseWidthIn: spoolDims.traverseWidthIn,
        heightFormula: heightCalc.formula,
        heightFormulaResult: heightCalc.result,
        unitHeightIn,
        grossWeightKg: Number((drumsOnThisPallet * wtPerDrum + 18).toFixed(1)),
        palletsPerRowStandard,
      });
    }
  });

  // Step 2: Pair pallets vertically if allowDoubleStack is enabled and 2 tiers fit within 89" height
  const floorSlots: Omit<FloorSlotPlacement, 'slotIndex' | 'slotLabel'>[] = [];
  let pIdx = 0;
  while (pIdx < allPallets.length) {
    const bottom = allPallets[pIdx];
    const next = pIdx + 1 < allPallets.length ? allPallets[pIdx + 1] : undefined;

    const canStackNext =
      allowDoubleStack &&
      next !== undefined &&
      next.palletWidthIn <= bottom.palletWidthIn &&
      next.palletLengthIn <= bottom.palletLengthIn &&
      bottom.unitHeightIn + next.unitHeightIn <= loadableHeightIn;

    if (canStackNext && next) {
      const stackHeight = bottom.unitHeightIn + next.unitHeightIn;
      floorSlots.push({
        widthIn: Math.max(bottom.palletWidthIn, next.palletWidthIn),
        lengthIn: Math.max(bottom.palletLengthIn, next.palletLengthIn),
        bottomPallet: bottom,
        topPallet: next,
        totalStackHeightIn: stackHeight,
        topClearanceIn: Math.max(0, loadableHeightIn - stackHeight),
        totalDrumsInSlot: bottom.drumsOnPallet + next.drumsOnPallet,
        totalWeightInSlotKg: Number(
          (bottom.grossWeightKg + next.grossWeightKg).toFixed(1)
        ),
      });
      pIdx += 2;
    } else {
      floorSlots.push({
        widthIn: bottom.palletWidthIn,
        lengthIn: bottom.palletLengthIn,
        bottomPallet: bottom,
        topPallet: undefined,
        totalStackHeightIn: bottom.unitHeightIn,
        topClearanceIn: Math.max(0, loadableHeightIn - bottom.unitHeightIn),
        totalDrumsInSlot: bottom.drumsOnPallet,
        totalWeightInSlotKg: bottom.grossWeightKg,
      });
      pIdx += 1;
    }
  }

  // Step 3: Pack floorSlots into Rows across the 90" loadable width
  const rows: ContainerRowLayout[] = [];

  let currentRowSlots: FloorSlotPlacement[] = [];
  let currentUsedWidth = 0;
  let cumulativeLengthIn = 0;

  const finalizeRow = (slotsToCommit: FloorSlotPlacement[]) => {
    if (slotsToCommit.length === 0) return;
    const rowNumber = rows.length + 1;
    const usedWidthIn = slotsToCommit.reduce((acc, s) => acc + s.widthIn, 0);
    const rowLengthIn = Math.max(...slotsToCommit.map(s => s.lengthIn));
    const startLengthIn = cumulativeLengthIn;
    const endLengthIn = Number((startLengthIn + rowLengthIn).toFixed(1));
    cumulativeLengthIn = endLengthIn;

    const maxRowHeightIn = Math.max(...slotsToCommit.map(s => s.totalStackHeightIn));
    const minSlotWidth = Math.min(...slotsToCommit.map(s => s.widthIn));
    const maxPalletsAcrossForRow = Math.max(
      1,
      Math.floor(loadableWidthIn / minSlotWidth)
    );

    const totalPalletsInRow = slotsToCommit.reduce(
      (acc, s) => acc + 1 + (s.topPallet ? 1 : 0),
      0
    );
    const totalDrumsInRow = slotsToCommit.reduce(
      (acc, s) => acc + s.totalDrumsInSlot,
      0
    );
    const totalWeightInRowKg = Number(
      slotsToCommit.reduce((acc, s) => acc + s.totalWeightInSlotKg, 0).toFixed(1)
    );

    // Label slots as Top and Bottom (matching container cross-section blueprint)
    const labeledSlots = slotsToCommit.map((s, idx) => {
      let label = `Slot ${idx + 1}`;
      if (slotsToCommit.length === 2) {
        label = idx === 0 ? 'Top' : 'Bottom';
      } else if (slotsToCommit.length === 3) {
        label = idx === 0 ? 'Top' : idx === 1 ? 'Center' : 'Bottom';
      } else {
        label = idx === 0 ? 'Top' : `Slot ${idx + 1}`;
      }
      return {
        ...s,
        slotIndex: idx,
        slotLabel: label,
      };
    });

    rows.push({
      rowNumber,
      slots: labeledSlots,
      palletsAcrossWidth: slotsToCommit.length,
      maxPalletsAcrossForRow,
      usedWidthIn,
      freeWidthIn: Math.max(0, Number((loadableWidthIn - usedWidthIn).toFixed(1))),
      rowLengthIn,
      startLengthIn,
      endLengthIn,
      endLengthFt: Number((endLengthIn / 12).toFixed(2)),
      maxRowHeightIn,
      heightClearanceIn: Math.max(
        0,
        Number((loadableHeightIn - maxRowHeightIn).toFixed(1))
      ),
      totalPalletsInRow,
      totalDrumsInRow,
      totalWeightInRowKg,
      fitsWithinLength: endLengthIn <= loadableLengthIn + 0.01,
      fitsWithinHeight: maxRowHeightIn <= loadableHeightIn + 0.01,
    });
  };

  floorSlots.forEach(slot => {
    if (
      currentRowSlots.length > 0 &&
      currentUsedWidth + slot.widthIn > loadableWidthIn
    ) {
      finalizeRow(currentRowSlots);
      currentRowSlots = [];
      currentUsedWidth = 0;
    }

    const slotIdx = currentRowSlots.length;
    currentRowSlots.push({
      ...slot,
      slotIndex: slotIdx,
      slotLabel: slotIdx === 0 ? 'Top' : 'Bottom',
    });
    currentUsedWidth += slot.widthIn;
  });

  if (currentRowSlots.length > 0) {
    finalizeRow(currentRowSlots);
  }

  // Step 4: Build itemStowageMap so each item knows which Row(s) and Pallet(s) it occupies
  const itemRowsTracker: Record<
    string,
    { rows: Set<number>; pallets: number; perRow: number }
  > = {};

  rows.forEach(row => {
    row.slots.forEach(slot => {
      const units = [slot.bottomPallet, ...(slot.topPallet ? [slot.topPallet] : [])];
      units.forEach(u => {
        if (!itemRowsTracker[u.itemId]) {
          itemRowsTracker[u.itemId] = {
            rows: new Set(),
            pallets: 0,
            perRow: u.palletsPerRowStandard,
          };
        }
        itemRowsTracker[u.itemId].rows.add(row.rowNumber);
        itemRowsTracker[u.itemId].pallets += 1;
      });
    });
  });

  const itemStowageMap: Record<string, string> = {};
  Object.entries(itemRowsTracker).forEach(([itemId, info]) => {
    const rowArr = Array.from(info.rows).sort((a, b) => a - b);
    const rowLabel =
      rowArr.length === 1
        ? `Row ${rowArr[0]}`
        : `Row ${rowArr[0]}..${rowArr[rowArr.length - 1]}`;
    itemStowageMap[itemId] = `${rowLabel} (${info.pallets} Plt, ${info.perRow}/Row)`;
  });

  // Step 5: Compute standard reference capacities dynamically from packagingRules + standard defaults
  const palletSpecMap = new Map<
    string,
    { palletSize: string; widthIn: number; lengthIn: number; drumsPerPallet: number }
  >();

  packagingRules.forEach(pr => {
    const pDims = parsePalletDimensions(pr.pallet);
    const key = `${pDims.lengthIn}x${pDims.widthIn}`;
    const bbnMatch = String(pr.bbnPerPallet ?? '').match(/[0-9]+/);
    const bbn = bbnMatch ? Math.max(1, parseInt(bbnMatch[0], 10)) : 2;
    const existing = palletSpecMap.get(key);
    if (!existing || bbn > existing.drumsPerPallet) {
      palletSpecMap.set(key, {
        palletSize: `${pDims.lengthIn} × ${pDims.widthIn} × ${pDims.baseHeightIn} in`,
        widthIn: pDims.widthIn,
        lengthIn: pDims.lengthIn,
        drumsPerPallet: bbn,
      });
    }
  });

  if (palletSpecMap.size === 0) {
    [
      { key: '30x30', palletSize: '30 × 30 × 6 in', widthIn: 30, lengthIn: 30, drumsPerPallet: 4 },
      { key: '42x42', palletSize: '42 × 42 × 6 in', widthIn: 42, lengthIn: 42, drumsPerPallet: 2 },
      { key: '45x45', palletSize: '45 × 45 × 6 in', widthIn: 45, lengthIn: 45, drumsPerPallet: 1 },
    ].forEach(d => palletSpecMap.set(d.key, d));
  }

  const standardSizes = Array.from(palletSpecMap.values()).sort(
    (a, b) => a.widthIn - b.widthIn
  );

  const standardCapacities: StandardPalletCapacitySpec[] = standardSizes.map(s => {
    const palletsPerRow = Math.max(1, Math.floor(loadableWidthIn / s.widthIn));
    const usedRowWidthIn = palletsPerRow * s.widthIn;
    const freeRowWidthIn = Math.max(0, loadableWidthIn - usedRowWidthIn);
    const maxRowsAlongLength = Math.max(0, Math.floor(loadableLengthIn / s.lengthIn));
    const maxFloorPallets = palletsPerRow * maxRowsAlongLength;
    const maxFloorDrums = maxFloorPallets * s.drumsPerPallet;

    return {
      ...s,
      palletsPerRow,
      usedRowWidthIn,
      freeRowWidthIn,
      maxRowsAlongLength,
      maxFloorPallets,
      maxFloorDrums,
    };
  });

  const usedLengthIn = cumulativeLengthIn;
  const usedLengthFt = Number((usedLengthIn / 12).toFixed(2));
  const remainingLengthIn = Number((loadableLengthIn - usedLengthIn).toFixed(1));
  const remainingLengthFt = Number((remainingLengthIn / 12).toFixed(2));
  const lengthUtilizationPct =
    loadableLengthIn > 0
      ? Math.round((usedLengthIn / loadableLengthIn) * 100)
      : 0;
  const maxUsedWidthIn =
    rows.length > 0 ? Math.max(...rows.map(r => r.usedWidthIn)) : 0;
  const maxUsedHeightIn =
    rows.length > 0 ? Math.max(...rows.map(r => r.maxRowHeightIn)) : 0;

  return {
    loadableLengthFt,
    loadableLengthIn,
    loadableWidthIn,
    loadableHeightIn,
    allowDoubleStack,
    totalPallets: allPallets.length,
    totalFloorSlots: floorSlots.length,
    totalRows: rows.length,
    totalDrums: allPallets.reduce((acc, p) => acc + p.drumsOnPallet, 0),
    usedLengthIn,
    usedLengthFt,
    remainingLengthIn,
    remainingLengthFt,
    lengthUtilizationPct,
    maxUsedWidthIn,
    maxUsedHeightIn,
    isLengthExceeded: usedLengthIn > loadableLengthIn + 0.01,
    isHeightExceeded: maxUsedHeightIn > loadableHeightIn + 0.01,
    rows,
    itemStowageMap,
    standardCapacities,
  };
}

/**
 * Automatically synchronizes all ContainerPlan items whenever Backup rules
 * (sizeRules, packagingRules, densities, ladiDimensions) or Orders are updated.
 */
export function syncContainerPlansWithBackup(
  containers: ContainerPlan[],
  orders: CableOrder[],
  sizeRules: SizePackagingRule[],
  packagingRules: PackagingRule[],
  densities: DensitySettings,
  ladiDimensions: LadiDimensionRule[]
): ContainerPlan[] {
  let anyChanged = false;

  const nextContainers = containers.map(cont => {
    if (!cont.items || cont.items.length === 0) return cont;

    let contChanged = false;
    const syncedItems = cont.items.map(item => {
      // Find matching order if linked
      let matchedOrder: CableOrder | undefined =
        item.orderId !== undefined
          ? orders.find(o => o.id === item.orderId)
          : undefined;

      if (!matchedOrder && item.batch && item.sizeCores) {
        const bClean = item.batch.trim().toLowerCase();
        const coreSizeMatch = item.sizeCores.match(/(\d+)\s*[cC]\s*[×xX*]\s*([0-9.]+)/);
        const itemCores = coreSizeMatch ? parseInt(coreSizeMatch[1], 10) : 0;
        const itemSize = coreSizeMatch ? parseFloat(coreSizeMatch[2]) : parseSizeNum(item.sizeCores);
        matchedOrder = orders.find(
          o =>
            (o.batch || '').trim().toLowerCase() === bClean &&
            (itemCores === 0 || Number(o.cores) === itemCores) &&
            Math.abs(parseSizeNum(o.size) - itemSize) < 0.01
        );
      }

      if (matchedOrder) {
        const r = computeRecordRow(matchedOrder, densities, ladiDimensions);
        const evalPkg = evaluateSpoolSizeForOrder(
          r.finalDia,
          r.orderLen,
          r.size,
          r.cores,
          r.grade,
          sizeRules,
          packagingRules,
          matchedOrder.spool_size
        );

        const nextSpool = evalPkg.spool || item.spool;
        const nextPallet = evalPkg.pallet || item.palletSize;
        const nextBbn = evalPkg.bbnPerPallet || 1;

        const pkgText = evalPkg.packaging || '1000m / Drum';
        const mLenMatch = pkgText.match(/[0-9]+/);
        const drumLen = mLenMatch ? parseFloat(mLenMatch[0]) : 1000;
        const nextDrumCount = drumLen > 0 ? Math.max(1, Math.ceil(r.orderLen / drumLen)) : 1;
        const nextLengthPerDrum = nextDrumCount > 0 ? Math.round(r.orderLen / nextDrumCount) : r.orderLen;
        const nextTotalLength = r.orderLen;
        const nextNetCableWt = Number((r.reqCu + r.reqIns + r.reqSheath).toFixed(2));
        const tarePerDrum = matchedOrder.tare_weight !== undefined ? Number(matchedOrder.tare_weight) || 25 : 25;
        const nextGrossWt = Number((nextNetCableWt + nextDrumCount * tarePerDrum).toFixed(2));
        const nextVolumeCbm = estimateDrumCbm(nextSpool, nextDrumCount);

        if (
          item.spool !== nextSpool ||
          item.palletSize !== nextPallet ||
          item.drumsPerPallet !== nextBbn ||
          item.drumCount !== nextDrumCount ||
          item.lengthPerDrum !== nextLengthPerDrum ||
          item.totalLength !== nextTotalLength ||
          Math.abs((item.netCableWt || 0) - nextNetCableWt) > 0.01 ||
          Math.abs((item.grossWt || 0) - nextGrossWt) > 0.01 ||
          Math.abs((item.volumeCbm || 0) - nextVolumeCbm) > 0.01
        ) {
          contChanged = true;
          return {
            ...item,
            spool: nextSpool,
            palletSize: nextPallet,
            drumsPerPallet: nextBbn,
            drumCount: nextDrumCount,
            lengthPerDrum: nextLengthPerDrum,
            totalLength: nextTotalLength,
            netCableWt: nextNetCableWt,
            grossWt: nextGrossWt,
            volumeCbm: nextVolumeCbm,
          };
        }
        return item;
      }

      // For manual container rows not linked to an order, still sync palletSize & drumsPerPallet by spool
      const pkgRule = lookupPackagingRuleBySpool(item.spool, packagingRules);
      if (pkgRule) {
        const nextSpool = pkgRule.spool || item.spool;
        const nextPallet = pkgRule.pallet || item.palletSize;
        const mBbn = String(pkgRule.bbnPerPallet ?? '').match(/[0-9]+/);
        const nextBbn = mBbn ? Math.max(1, parseInt(mBbn[0], 10)) : item.drumsPerPallet || 1;
        const nextVol = estimateDrumCbm(nextSpool, Number(item.drumCount) || 1);

        if (
          item.spool !== nextSpool ||
          item.palletSize !== nextPallet ||
          item.drumsPerPallet !== nextBbn ||
          Math.abs((item.volumeCbm || 0) - nextVol) > 0.01
        ) {
          contChanged = true;
          return {
            ...item,
            spool: nextSpool,
            palletSize: nextPallet,
            drumsPerPallet: nextBbn,
            volumeCbm: nextVol,
          };
        }
      }

      return item;
    });

    // Recompute row/pallet stowagePositions
    const tempCont = { ...cont, items: syncedItems };
    const stuffingPlan = computeContainerStuffingPlan(tempCont, packagingRules);
    const finalItems = syncedItems.map(it => {
      const nextStowage = stuffingPlan.itemStowageMap[it.id] || it.stowagePosition;
      if (it.stowagePosition !== nextStowage) {
        contChanged = true;
        return { ...it, stowagePosition: nextStowage };
      }
      return it;
    });

    if (contChanged) {
      anyChanged = true;
      return { ...cont, items: finalItems };
    }
    return cont;
  });

  return anyChanged ? nextContainers : containers;
}

export interface ContainerItemMaterialStatus {
  status: 'In Stock (Ready)' | 'In Production' | 'Pending Production' | 'Dispatched';
  badgeClass: string;
  stageLabel?: string;
  details: string;
  isReady: boolean;
  orderId?: number;
}

export function resolveContainerItemMaterialStatus(
  item: ContainerLoadItem,
  orders: CableOrder[] = [],
  stockLedger?: StockLedgerResult
): ContainerItemMaterialStatus {
  if (item.dispatchedAt) {
    return {
      status: 'Dispatched',
      badgeClass: 'bg-cyan-100 text-cyan-900 border-cyan-300',
      details: `Dispatched on ${item.dispatchedAt.split('T')[0]}`,
      isReady: true,
      orderId: item.orderId,
    };
  }

  // Find matching order
  let matchedOrder: CableOrder | undefined =
    item.orderId !== undefined ? orders.find(o => o.id === item.orderId) : undefined;

  if (!matchedOrder && item.batch && item.sizeCores) {
    const bClean = item.batch.trim().toLowerCase();
    const coreSizeMatch = item.sizeCores.match(/(\d+)\s*[cC]\s*[×xX*]\s*([0-9.]+)/);
    const itemCores = coreSizeMatch ? parseInt(coreSizeMatch[1], 10) : 0;
    const itemSize = coreSizeMatch ? parseFloat(coreSizeMatch[2]) : parseSizeNum(item.sizeCores);
    matchedOrder = orders.find(
      o =>
        (o.batch || '').trim().toLowerCase() === bClean &&
        (itemCores === 0 || Number(o.cores) === itemCores) &&
        Math.abs(parseSizeNum(o.size) - itemSize) < 0.01
    );
  }

  if (matchedOrder) {
    if (matchedOrder.dispatched) {
      return {
        status: 'Dispatched',
        badgeClass: 'bg-cyan-100 text-cyan-900 border-cyan-300',
        details: 'Order marked dispatched on Order Sheet',
        isReady: true,
        orderId: matchedOrder.id,
      };
    }

    const pStatus = matchedOrder.pStatus;
    const isCompleted =
      matchedOrder.status === 'Completed' ||
      Boolean(pStatus?.s) ||
      (matchedOrder.cores === 1 && Boolean(pStatus?.i) && matchedOrder.grade?.includes('IS-694'));

    if (isCompleted) {
      return {
        status: 'In Stock (Ready)',
        badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
        details: `100% Produced • Ready in Finished Stock for Stuffing (${matchedOrder.order_length}m)`,
        isReady: true,
        orderId: matchedOrder.id,
      };
    }

    const isProcessing =
      matchedOrder.status === 'Processing' ||
      Boolean(pStatus?.b) ||
      Boolean(pStatus?.c) ||
      Boolean(pStatus?.i) ||
      Boolean(pStatus?.t);

    if (isProcessing) {
      let currentStage = 'Stage 1: Bunching';
      if (pStatus?.t) currentStage = 'Stage 5: Sheathing';
      else if (pStatus?.i) currentStage = matchedOrder.cores > 1 ? 'Stage 4: Twisting' : 'Stage 5: Sheathing';
      else if (pStatus?.c) currentStage = 'Stage 3: Insulation';
      else if (pStatus?.b) currentStage = 'Stage 2/3: Stranding/Insulation';

      return {
        status: 'In Production',
        badgeClass: 'bg-blue-100 text-blue-900 border-blue-300',
        stageLabel: currentStage,
        details: `Under Manufacturing (${currentStage})`,
        isReady: false,
        orderId: matchedOrder.id,
      };
    }

    return {
      status: 'Pending Production',
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
      details: 'Awaiting Requisition / Production Start',
      isReady: false,
      orderId: matchedOrder.id,
    };
  }

  // Fallback: Check if finished stock exists in stock ledger
  if (stockLedger?.finishedGoodsRows) {
    const stockRow = stockLedger.finishedGoodsRows.find(
      r => item.sizeCores.includes(r.name) || (item.batch && r.name.includes(item.batch))
    );
    if (stockRow && stockRow.closing >= (Number(item.totalLength) || 0)) {
      return {
        status: 'In Stock (Ready)',
        badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
        details: `Available in Finished Stock (${stockRow.closing.toLocaleString()}m in warehouse)`,
        isReady: true,
      };
    }
  }

  return {
    status: 'In Stock (Ready)',
    badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    details: 'Custom Cargo / Ready for Stuffing',
    isReady: true,
  };
}

export function resolveContainerMaterialReadiness(
  container: ContainerPlan,
  orders: CableOrder[] = [],
  stockLedger?: StockLedgerResult
): {
  totalItems: number;
  readyItems: number;
  inProdItems: number;
  pendingItems: number;
  dispatchedItems: number;
  readyPct: number;
  overallStatus: 'Ready for Stuffing' | 'In Production' | 'Pending Production' | 'Dispatched';
  badgeClass: string;
} {
  const items = container.items || [];
  if (items.length === 0) {
    return {
      totalItems: 0,
      readyItems: 0,
      inProdItems: 0,
      pendingItems: 0,
      dispatchedItems: 0,
      readyPct: 0,
      overallStatus: 'Pending Production',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
    };
  }

  let readyItems = 0;
  let inProdItems = 0;
  let pendingItems = 0;
  let dispatchedItems = 0;

  items.forEach(it => {
    const st = resolveContainerItemMaterialStatus(it, orders, stockLedger);
    if (st.status === 'Dispatched') dispatchedItems++;
    else if (st.status === 'In Stock (Ready)') readyItems++;
    else if (st.status === 'In Production') inProdItems++;
    else pendingItems++;
  });

  const total = items.length;
  const effectiveReady = readyItems + dispatchedItems;
  const readyPct = Math.round((effectiveReady / total) * 100);

  let overallStatus: 'Ready for Stuffing' | 'In Production' | 'Pending Production' | 'Dispatched' = 'Pending Production';
  let badgeClass = 'bg-amber-100 text-amber-900 border-amber-300';

  if (dispatchedItems === total) {
    overallStatus = 'Dispatched';
    badgeClass = 'bg-cyan-100 text-cyan-900 border-cyan-300';
  } else if (effectiveReady === total) {
    overallStatus = 'Ready for Stuffing';
    badgeClass = 'bg-emerald-100 text-emerald-900 border-emerald-300';
  } else if (inProdItems > 0 || readyItems > 0) {
    overallStatus = 'In Production';
    badgeClass = 'bg-blue-100 text-blue-900 border-blue-300';
  }

  return {
    totalItems: total,
    readyItems,
    inProdItems,
    pendingItems,
    dispatchedItems,
    readyPct,
    overallStatus,
    badgeClass,
  };
}

