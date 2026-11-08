import React, { useState, useMemo } from 'react';
import {
  CableOrder,
  ContainerLoadItem,
  ContainerPlan,
  DensitySettings,
  LadiDimensionRule,
  PackagingRule,
  PalletDetailCell,
  SizePackagingRule,
} from '../types/cable';
import {
  computeRecordRow,
  evaluateSpoolSizeForOrder,
} from '../utils/calculations';
import {
  computeContainerStuffingPlan,
  getDefaultLoadableLengthFt,
  parseSpoolDimensions,
  resolveContainerItemMaterialStatus,
} from '../utils/containerStuffing';
import type { StockLedgerResult } from '../utils/stockEngine';
import {
  Highlighter,
  RotateCcw,
  Edit3,
  Check,
  PackagePlus,
  Plus,
  Trash2,
} from 'lucide-react';

interface ContainerPlanningSheetFormatProps {
  container: ContainerPlan;
  packagingRules: PackagingRule[];
  orders?: CableOrder[];
  densities?: DensitySettings;
  ladiDimensions?: LadiDimensionRule[];
  sizeRules?: SizePackagingRule[];
  isPrintView?: boolean;
  readOnly?: boolean;
  onUpdateContainer?: (updates: Partial<ContainerPlan>) => void;
  onToggleHighlightItem?: (itemId: string) => void;
  onAddOrderFromSheet?: (orderId: number, customLength?: number, customDrums?: number) => void;
  onUpdateLoadItem?: (
    itemId: string,
    field: keyof ContainerLoadItem,
    value: string | number
  ) => void;
  onDeleteLoadItem?: (itemId: string) => void;
  onOpenLoadOrdersModal?: () => void;
  stockLedger?: StockLedgerResult;
}

/**
 * Formats spool string into asterisk format like "42*12*16" or "21*8*15"
 */
export function formatSpoolAsterisk(spool: string | undefined): string {
  if (!spool) return '-';
  const nums = spool.match(/\d+(\.\d+)?/g);
  if (nums && nums.length >= 3) {
    return `${nums[0]}*${nums[1]}*${nums[2]}`;
  }
  return spool.replace(/\s*[xX×/]\s*/g, '*').trim();
}

/**
 * Formats spool string into slash format like "42/12/16" or "21/8/15" for PALLETS DETAILS
 */
export function formatSpoolSlash(spool: string | undefined): string {
  if (!spool) return '-';
  const nums = spool.match(/\d+(\.\d+)?/g);
  if (nums && nums.length >= 3) {
    return `${nums[0]}/${nums[1]}/${nums[2]}`;
  }
  return spool.replace(/\s*[xX×*]\s*/g, '/').trim();
}

/**
 * Formats cable size like "3C × 1.50 SQ MM" -> "3C X 1.5" (while preserving custom suffixes like " C")
 */
export function formatCableSizeSheet(sizeCores: string | undefined): string {
  if (!sizeCores) return '-';
  const raw = sizeCores.trim();
  // Check if it has SQ MM
  if (/SQ\s*MM/i.test(raw)) {
    const cleaned = raw
      .replace(/SQ\s*MM/gi, '')
      .replace(/[×x*]/g, 'X')
      .replace(/\s+/g, ' ')
      .trim();
    // Simplify trailing .00 to .0 (e.g. 1.50 -> 1.5, 4.00 -> 4.0, 10.00 -> 10.0, 240.00 -> 240)
    return cleaned.replace(/(\d+)\.(\d)0\b/g, '$1.$2').replace(/(\d{3,})\.0+\b/g, '$1');
  }
  return raw.replace(/[×]/g, 'X');
}

/**
 * Automatically builds the 2-column PALLETS DETAILS rows (Left Pallet & Right Pallet per row)
 * matching the factory Excel sheet layout where bottom large drums (e.g. 42/12/16*2) and
 * top stacked smaller drums (e.g. 21/8/15*8) are grouped into each pallet slot.
 */
export function buildAutoPalletDetailsGrid(
  container: ContainerPlan,
  packagingRules: PackagingRule[]
): { left: PalletDetailCell; right: PalletDetailCell }[] {
  const plan = computeContainerStuffingPlan(container, packagingRules);

  // Separate small/stackable drums (flange <= 24") and large base drums (flange > 24")
  // so that if both exist, we can also pair them cleanly into pallet cells
  const smallDrumPool: { spoolSlash: string; count: number }[] = [];
  const basePalletUnits: { label: string; isSmallOnly?: boolean }[] = [];

  // Aggregate drums by spool size in order
  const spoolGroups: { spool: string; spoolSlash: string; flangeIn: number; totalDrums: number; bbnPerPallet: number }[] = [];
  container.items.forEach(it => {
    const dc = Math.max(0, Number(it.drumCount) || 0);
    if (dc <= 0) return;
    const slash = formatSpoolSlash(it.spool);
    const dims = parseSpoolDimensions(it.spool);
    const existing = spoolGroups.find(g => g.spoolSlash === slash);
    // Determine bbnPerPallet for this spool
    const norm = (it.spool || '').replace(/\*/g, 'X').replace(/\s+/g, '').toUpperCase();
    const pkgRule = packagingRules.find(
      r => (r.spool || '').replace(/\*/g, 'X').replace(/\s+/g, '').toUpperCase() === norm
    );
    const bbnMatch = String(pkgRule?.bbnPerPallet ?? it.drumsPerPallet ?? '').match(/[0-9]+/);
    const bbn = bbnMatch
      ? Math.max(1, parseInt(bbnMatch[0], 10))
      : dims.flangeDiaIn <= 24
      ? 8
      : dims.flangeDiaIn >= 42 && dims.traverseWidthIn >= 24
      ? 1
      : 2;

    if (existing) {
      existing.totalDrums += dc;
    } else {
      spoolGroups.push({
        spool: it.spool,
        spoolSlash: slash,
        flangeIn: dims.flangeDiaIn,
        totalDrums: dc,
        bbnPerPallet: bbn,
      });
    }
  });

  // Check if there are both small drums (<= 24") and large drums (> 24")
  const hasSmallAndLarge =
    spoolGroups.some(g => g.flangeIn <= 24) && spoolGroups.some(g => g.flangeIn > 24);

  if (hasSmallAndLarge) {
    // Group small drums into top-tier bundles of up to 8 (like 21/8/15*8, 21/8/21*8)
    const smallFlat: string[] = [];
    const largeFlat: { slash: string; bbn: number }[] = [];

    spoolGroups.forEach(g => {
      if (g.flangeIn <= 24) {
        for (let i = 0; i < g.totalDrums; i++) {
          smallFlat.push(g.spoolSlash);
        }
      } else {
        for (let i = 0; i < g.totalDrums; i++) {
          largeFlat.push({ slash: g.spoolSlash, bbn: g.bbnPerPallet });
        }
      }
    });

    const formatBundle = (arr: string[]): string => {
      const counts: Record<string, number> = {};
      const order: string[] = [];
      arr.forEach(s => {
        if (!counts[s]) order.push(s);
        counts[s] = (counts[s] || 0) + 1;
      });
      return order
        .map(s => (counts[s] > 1 || order.length > 1 ? `${s}*${counts[s]}` : s))
        .join(' + ');
    };

    // Pack large drums into bottom pallets (1 drum if bbn===1 like 42/12/24 or 42/12/30, else 2 drums like 42/12/16*2)
    let lIdx = 0;
    while (lIdx < largeFlat.length) {
      const first = largeFlat[lIdx];
      if (first.bbn === 1) {
        basePalletUnits.push({ label: first.slash });
        lIdx += 1;
      } else {
        const second = lIdx + 1 < largeFlat.length && largeFlat[lIdx + 1].bbn > 1 ? largeFlat[lIdx + 1] : null;
        if (second) {
          if (first.slash === second.slash) {
            basePalletUnits.push({ label: `${first.slash}*2` });
          } else {
            basePalletUnits.push({ label: `${first.slash}+${second.slash}` });
          }
          lIdx += 2;
        } else {
          basePalletUnits.push({ label: `${first.slash}*1` });
          lIdx += 1;
        }
      }
    }

    // Pack small drums into chunks of 8 to sit on top of base pallets, or standalone bottom pallets if base runs out
    const smallBundles: string[] = [];
    for (let i = 0; i < smallFlat.length; i += 8) {
      const chunk = smallFlat.slice(i, i + 8);
      smallBundles.push(formatBundle(chunk));
    }

    const cells: PalletDetailCell[] = [];
    const totalBase = basePalletUnits.length;
    for (let i = 0; i < totalBase; i++) {
      const topStr = i < smallBundles.length ? smallBundles[i] : '';
      cells.push({
        topLine: topStr,
        bottomLine: basePalletUnits[i].label,
      });
    }
    // Any remaining small bundles become their own pallet cells
    for (let i = totalBase; i < smallBundles.length; i++) {
      cells.push({
        topLine: '',
        bottomLine: smallBundles[i],
      });
    }

    // Pair cells into 2 columns per row (Left & Right)
    const gridRows: { left: PalletDetailCell; right: PalletDetailCell }[] = [];
    for (let i = 0; i < cells.length; i += 2) {
      gridRows.push({
        left: cells[i] || { topLine: '', bottomLine: '' },
        right: cells[i + 1] || { topLine: '', bottomLine: '' },
      });
    }
    return gridRows;
  }

  // Standard case: convert plan.rows slots into 2-column pallet detail rows
  const allCells: PalletDetailCell[] = [];
  plan.rows.forEach(row => {
    row.slots.forEach(slot => {
      const bottomSlash = formatSpoolSlash(slot.bottomPallet.spool);
      const bottomLabel = `${bottomSlash}*${slot.bottomPallet.drumsOnPallet}`;
      const topLabel = slot.topPallet
        ? `${formatSpoolSlash(slot.topPallet.spool)}*${slot.topPallet.drumsOnPallet}`
        : '';
      allCells.push({
        topLine: topLabel,
        bottomLine: bottomLabel,
      });
    });
  });

  if (allCells.length === 0) {
    return [{ left: { topLine: '-', bottomLine: '-' }, right: { topLine: '-', bottomLine: '-' } }];
  }

  const gridRows: { left: PalletDetailCell; right: PalletDetailCell }[] = [];
  for (let i = 0; i < allCells.length; i += 2) {
    gridRows.push({
      left: allCells[i] || { topLine: '', bottomLine: '' },
      right: allCells[i + 1] || { topLine: '', bottomLine: '' },
    });
  }
  return gridRows;
}

export const ContainerPlanningSheetFormat: React.FC<ContainerPlanningSheetFormatProps> = ({
  container,
  packagingRules,
  orders = [],
  densities,
  ladiDimensions,
  sizeRules = [],
  isPrintView = false,
  readOnly = false,
  onUpdateContainer,
  onToggleHighlightItem,
  onAddOrderFromSheet,
  onUpdateLoadItem,
  onDeleteLoadItem,
  onOpenLoadOrdersModal,
  stockLedger,
}) => {
  const [isEditingCells, setIsEditingCells] = useState(false);
  const [quickBatch, setQuickBatch] = useState<string>('ALL');
  const [quickOrderId, setQuickOrderId] = useState<number>(0);
  const [quickLength, setQuickLength] = useState<string>('');
  const [quickDrums, setQuickDrums] = useState<string>('');

  const availableBatches = useMemo(() => {
    return Array.from(new Set(orders.map(o => o.batch))).sort();
  }, [orders]);

  const batchFilteredOrders = useMemo(() => {
    return orders.filter(o => quickBatch === 'ALL' || o.batch === quickBatch);
  }, [orders, quickBatch]);

  const selectedQuickOrder = useMemo(() => {
    return (
      batchFilteredOrders.find(o => o.id === quickOrderId) ||
      batchFilteredOrders[0] ||
      null
    );
  }, [batchFilteredOrders, quickOrderId]);

  const handleSelectQuickOrder = (orderId: number) => {
    setQuickOrderId(orderId);
    const o = orders.find(x => x.id === orderId);
    if (o && densities && ladiDimensions) {
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
      const pkgText = evalPkg.packaging || '1000m / Drum';
      const mLenMatch = pkgText.match(/[0-9]+/);
      const drumLen = mLenMatch ? parseFloat(mLenMatch[0]) : 1000;
      const dCount = drumLen > 0 ? Math.max(1, Math.ceil(r.orderLen / drumLen)) : 1;
      setQuickLength(String(r.orderLen));
      setQuickDrums(String(dCount));
    }
  };

  const handleQuickAddOrder = () => {
    const targetOrder = selectedQuickOrder;
    if (!targetOrder || !onAddOrderFromSheet) return;
    const customLen = quickLength ? parseFloat(quickLength) : undefined;
    const customDrums = quickDrums ? parseInt(quickDrums, 10) : undefined;
    onAddOrderFromSheet(targetOrder.id, customLen, customDrums);
  };

  // 1. Compute main table totals
  const totalLength = container.items.reduce(
    (acc, it) => acc + (Number(it.totalLength) || 0),
    0
  );
  const totalDrums = container.items.reduce(
    (acc, it) => acc + (Number(it.drumCount) || 0),
    0
  );

  // 2. Compute Drum Size Summary Table (preserving order of appearance)
  const drumSizeSummary: { drumSize: string; count: number }[] = [];
  container.items.forEach(it => {
    const dSize = formatSpoolAsterisk(it.spool);
    const cnt = Number(it.drumCount) || 0;
    const existing = drumSizeSummary.find(x => x.drumSize.toUpperCase() === dSize.toUpperCase());
    if (existing) {
      existing.count += cnt;
    } else {
      drumSizeSummary.push({ drumSize: dSize, count: cnt });
    }
  });

  // 3. Compute Pallets Details Grid & Weights
  const autoGridRows = buildAutoPalletDetailsGrid(container, packagingRules);
  const defaultLengthFt =
    container.loadableLengthFt && container.loadableLengthFt > 0
      ? container.loadableLengthFt
      : getDefaultLoadableLengthFt(container.containerType);
  const defaultLengthInch = Math.round(defaultLengthFt * 12); // 19.2 * 12 = 230 INCH; 38.2 * 12 = 458 INCH
  const totalLengthInch =
    container.customTotalLengthInch !== undefined && container.customTotalLengthInch > 0
      ? container.customTotalLengthInch
      : defaultLengthInch;

  const netWtKg = Math.round(
    container.items.reduce((acc, it) => acc + (Number(it.netCableWt) || 0), 0)
  );

  // Estimate default pallet weight & drum weight if not overridden
  const totalPalletCount = autoGridRows.reduce(
    (acc, r) => acc + (r.left.bottomLine && r.left.bottomLine !== '-' ? 1 : 0) + (r.right.bottomLine && r.right.bottomLine !== '-' ? 1 : 0),
    0
  );
  const defaultPalletWtKg = Math.round(totalPalletCount * 38.9);
  const defaultDrumsWtKg = Math.round(
    container.items.reduce((acc, it) => {
      const diff = (Number(it.grossWt) || 0) - (Number(it.netCableWt) || 0);
      return acc + (diff > 0 ? diff : (Number(it.drumCount) || 0) * 33.5);
    }, 0)
  );

  const palletWtKg =
    container.customPalletWeightKg !== undefined
      ? container.customPalletWeightKg
      : defaultPalletWtKg;
  const drumsWtKg =
    container.customDrumsWeightKg !== undefined
      ? container.customDrumsWeightKg
      : defaultDrumsWtKg;
  const grossWtKg = Math.round(netWtKg + palletWtKg + drumsWtKg);

  const defaultTitle =
    container.planningSheetTitle && container.planningSheetTitle.trim() !== ''
      ? container.planningSheetTitle
      : `${container.containerType.replace(' DRY', '')} COINTANER PLANNING — ${container.containerNo}`;

  const canEdit = !isPrintView && !readOnly && Boolean(onUpdateContainer);

  const handleCellChange = (
    rowIdx: number,
    side: 'left' | 'right',
    part: 'topLine' | 'bottomLine',
    val: string
  ) => {
    if (!onUpdateContainer) return;
    const key = `${rowIdx}_${side}`;
    const autoCell = autoGridRows[rowIdx]?.[side] || { topLine: '', bottomLine: '' };
    const existingCell = container.customPalletCells?.[key] || autoCell;
    const nextMap: Record<string, PalletDetailCell> = {
      ...(container.customPalletCells || {}),
      [key]: {
        ...existingCell,
        [part]: val,
      },
    };
    onUpdateContainer({ customPalletCells: nextMap });
  };

  return (
    <div
      className={`bg-white ${
        isPrintView
          ? 'p-1 text-black'
          : 'border-2 border-slate-300 rounded-xl p-4 shadow-xs'
      }`}
    >
      {/* Top Toolbar & Manual Order Sheet Picker in Interactive View */}
      {!isPrintView && (
        <div className="space-y-3 pb-3 mb-4 border-b border-slate-200 no-print">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-[#0f2c59] text-white">
                Official Container Planning Sheet Format
              </span>
              <span className="ml-2 text-xs text-slate-600 font-medium">
                Plan container directly from your Order Sheet data in the 3-Block Layout (Drum &amp; Cable List • Drum Size Totals • Pallets Details)
              </span>
            </div>
            {canEdit && (
              <div className="flex items-center gap-2 flex-wrap">
                {onOpenLoadOrdersModal && (
                  <button
                    type="button"
                    onClick={onOpenLoadOrdersModal}
                    className="text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1 shadow-2xs"
                  >
                    <PackagePlus className="w-3.5 h-3.5" /> Select Multiple Orders from Order Sheet
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsEditingCells(prev => !prev)}
                  className={`text-xs px-2.5 py-1 rounded border font-bold flex items-center gap-1 transition-colors ${
                    isEditingCells
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                  }`}
                >
                  {isEditingCells ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Done Editing Sheet
                    </>
                  ) : (
                    <>
                      <Edit3 className="w-3.5 h-3.5" /> Edit Rows / Pallets / Weights
                    </>
                  )}
                </button>
                {container.items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onUpdateContainer) {
                        onUpdateContainer({ items: [], customPalletCells: undefined });
                      }
                    }}
                    className="text-xs px-2.5 py-1 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                    title="Clear all drum items and pallet details from this container"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear Sheet Data
                  </button>
                )}
                {container.customPalletCells &&
                  Object.keys(container.customPalletCells).length > 0 && (
                    <button
                      type="button"
                      onClick={() => onUpdateContainer?.({ customPalletCells: undefined })}
                      className="text-xs px-2 py-1 rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold flex items-center gap-1"
                      title="Reset Pallet Details cells to automatic calculation"
                    >
                      <RotateCcw className="w-3 h-3" /> Reset Auto Pallets
                    </button>
                  )}
              </div>
            )}
          </div>

          {/* Quick Add Row from Order Sheet */}
          {canEdit && orders.length > 0 && onAddOrderFromSheet && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 flex flex-wrap items-end gap-2 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-0.5">
                  1. Filter Order Sheet Batch
                </label>
                <select
                  value={quickBatch}
                  onChange={e => {
                    const b = e.target.value;
                    setQuickBatch(b);
                    const firstInBatch = orders.find(o => b === 'ALL' || o.batch === b);
                    if (firstInBatch) handleSelectQuickOrder(firstInBatch.id);
                  }}
                  className="px-2 py-1 border border-slate-300 rounded bg-white font-bold text-slate-800"
                >
                  <option value="ALL">All Batches ({orders.length})</option>
                  {availableBatches.map(b => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex-1 min-w-[240px]">
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-0.5">
                  2. Select Cable Size from Order Sheet
                </label>
                <select
                  value={selectedQuickOrder?.id || ''}
                  onChange={e => handleSelectQuickOrder(Number(e.target.value))}
                  className="w-full px-2 py-1 border border-slate-300 rounded bg-white font-semibold text-slate-900"
                >
                  {batchFilteredOrders.map(o => {
                    const r =
                      densities && ladiDimensions
                        ? computeRecordRow(o, densities, ladiDimensions)
                        : null;
                    const isIs694 = (o.grade || '').toUpperCase().includes('IS-694');
                    const hasCoils = o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0;
                    const evalPkg =
                      r
                        ? evaluateSpoolSizeForOrder(
                            r.finalDia,
                            r.orderLen,
                            r.size,
                            r.cores,
                            r.grade,
                            sizeRules,
                            packagingRules,
                            o.spool_size,
                            o.coils,
                            o.coil_type,
                            o.carton_count
                          )
                        : null;
                    const spoolStr = isIs694
                      ? 'N/A (Carton Pack)'
                      : hasCoils
                      ? 'N/A (Coils Pack)'
                      : formatSpoolAsterisk(o.spool_size || evalPkg?.spool || '28*12*15');
                    return (
                      <option key={o.id} value={o.id}>
                        #{o.id} [{o.batch}] — {o.cores}C X {o.size.replace(/SQ\s*MM/i, '').trim()} ({o.order_length}m | Drum: {spoolStr})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-0.5">
                  Length (m)
                </label>
                <input
                  type="number"
                  placeholder={String(selectedQuickOrder?.order_length || 1000)}
                  value={quickLength}
                  onChange={e => setQuickLength(e.target.value)}
                  className="w-24 px-2 py-1 border border-slate-300 rounded bg-white font-mono font-bold text-right"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-0.5">
                  No of Drums
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder="Auto"
                  value={quickDrums}
                  onChange={e => setQuickDrums(e.target.value)}
                  className="w-20 px-2 py-1 border border-slate-300 rounded bg-white font-mono font-bold text-center"
                />
              </div>

              <button
                type="button"
                onClick={handleQuickAddOrder}
                className="px-3 py-1.5 bg-[#0f2c59] hover:bg-slate-800 text-white rounded font-bold flex items-center gap-1 shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" /> Add from Order Sheet
              </button>
            </div>
          )}
        </div>
      )}

      <div className="max-w-2xl mx-auto space-y-5 font-sans text-black">
        {/* =====================================================================
            BLOCK 1: MAIN CONTAINER PLANNING TABLE (drum size | cable size | length | no of drums)
           ===================================================================== */}
        <table className="w-full border-collapse border-2 border-black text-xs">
          <thead>
            <tr>
              <th
                colSpan={canEdit && !isPrintView ? 6 : 4}
                className="border-2 border-black py-1.5 px-2 text-center font-extrabold text-sm uppercase tracking-wide bg-white text-black"
              >
                {canEdit && isEditingCells ? (
                  <input
                    type="text"
                    value={defaultTitle}
                    onChange={e =>
                      onUpdateContainer?.({ planningSheetTitle: e.target.value })
                    }
                    className="w-full text-center font-extrabold text-sm uppercase border border-blue-400 rounded px-2 py-0.5 bg-blue-50/40"
                  />
                ) : (
                  defaultTitle
                )}
              </th>
            </tr>
            <tr className="bg-[#0f2c59] text-white font-bold text-xs">
              <th className="border border-black py-1 px-2 text-left w-[25%]">
                drum size
              </th>
              <th className="border border-black py-1 px-2 text-left w-[33%]">
                cable size
              </th>
              <th className="border border-black py-1 px-2 text-right w-[20%]">
                length
              </th>
              <th className="border border-black py-1 px-2 text-right w-[14%]">
                no of drums
              </th>
              <th className="border border-black py-1 px-2 text-center w-[20%]">
                material status
              </th>
              {canEdit && !isPrintView && (
                <>
                  <th className="border border-black py-1 px-1 text-center w-8 no-print">
                    HL
                  </th>
                  <th className="border border-black py-1 px-1 text-center w-8 no-print">
                    Del
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {container.items.length === 0 ? (
              <tr>
                <td
                  colSpan={canEdit && !isPrintView ? 7 : 5}
                  className="border border-black p-4 text-center text-slate-500 italic"
                >
                  No orders loaded in this container plan yet. Select orders from your Order Sheet above to plan this container.
                </td>
              </tr>
            ) : (
              container.items.map(it => {
                const isYellow =
                  Boolean(it.isHighlighted) ||
                  /\bC$/i.test((it.sizeCores || '').trim());
                const matStatus = resolveContainerItemMaterialStatus(it, orders, stockLedger);
                return (
                  <tr
                    key={it.id}
                    className={
                      isYellow
                        ? 'bg-[#ffff00] text-black font-semibold'
                        : 'bg-white text-black'
                    }
                  >
                    <td className="border border-black py-0.5 px-2 font-semibold">
                      {canEdit && isEditingCells && onUpdateLoadItem ? (
                        <input
                          type="text"
                          value={formatSpoolAsterisk(it.spool)}
                          onChange={e =>
                            onUpdateLoadItem(it.id, 'spool', e.target.value)
                          }
                          className="w-full px-1 py-0.5 border border-slate-300 rounded font-semibold bg-white"
                        />
                      ) : (
                        formatSpoolAsterisk(it.spool)
                      )}
                    </td>
                    <td className="border border-black py-0.5 px-2">
                      {canEdit && isEditingCells && onUpdateLoadItem ? (
                        <input
                          type="text"
                          value={formatCableSizeSheet(it.sizeCores)}
                          onChange={e =>
                            onUpdateLoadItem(it.id, 'sizeCores', e.target.value)
                          }
                          className="w-full px-1 py-0.5 border border-slate-300 rounded bg-white"
                        />
                      ) : (
                        formatCableSizeSheet(it.sizeCores)
                      )}
                    </td>
                    <td className="border border-black py-0.5 px-2 text-right font-mono">
                      {canEdit && isEditingCells && onUpdateLoadItem ? (
                        <input
                          type="number"
                          value={Number(it.totalLength) || 0}
                          onChange={e =>
                            onUpdateLoadItem(
                              it.id,
                              'totalLength',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="w-20 px-1 py-0.5 border border-slate-300 rounded text-right font-mono bg-white"
                        />
                      ) : (
                        Number(it.totalLength) || 0
                      )}
                    </td>
                    <td className="border border-black py-0.5 px-2 text-right font-mono">
                      {canEdit && isEditingCells && onUpdateLoadItem ? (
                        <input
                          type="number"
                          min="1"
                          value={Number(it.drumCount) || 0}
                          onChange={e =>
                            onUpdateLoadItem(
                              it.id,
                              'drumCount',
                              parseInt(e.target.value, 10) || 1
                            )
                          }
                          className="w-16 px-1 py-0.5 border border-slate-300 rounded text-right font-mono bg-white"
                        />
                      ) : (
                        Number(it.drumCount) || 0
                      )}
                    </td>
                    <td className="border border-black py-0.5 px-2 text-center">
                      <div className="flex flex-col items-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${matStatus.badgeClass}`}>
                          {matStatus.status}
                        </span>
                        {matStatus.stageLabel && (
                          <span className="text-[9px] text-slate-600 font-bold leading-tight mt-0.5">
                            {matStatus.stageLabel}
                          </span>
                        )}
                      </div>
                    </td>
                    {canEdit && !isPrintView && (
                      <>
                        <td className="border border-black py-0.5 px-1 text-center no-print bg-white">
                          <button
                            type="button"
                            onClick={() => onToggleHighlightItem?.(it.id)}
                            className={`p-0.5 rounded transition-colors ${
                              isYellow
                                ? 'bg-yellow-300 text-slate-900'
                                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                            title="Toggle Yellow Row Highlight"
                          >
                            <Highlighter className="w-3 h-3" />
                          </button>
                        </td>
                        <td className="border border-black py-0.5 px-1 text-center no-print bg-white">
                          <button
                            type="button"
                            onClick={() => onDeleteLoadItem?.(it.id)}
                            className="p-0.5 text-red-500 hover:bg-red-50 rounded"
                            title="Remove row from container plan"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })
            )}
            {/* Blank spacer row before TOTAL just like the Excel sheet */}
            <tr className="h-4 bg-white">
              <td className="border border-black"></td>
              <td className="border border-black"></td>
              <td className="border border-black"></td>
              <td className="border border-black"></td>
              <td className="border border-black"></td>
              {canEdit && !isPrintView && (
                <>
                  <td className="border border-black no-print"></td>
                  <td className="border border-black no-print"></td>
                </>
              )}
            </tr>
          </tbody>
          <tfoot>
            <tr className="bg-white font-bold text-black">
              <td className="border-t border-b-2 border-l-2 border-r border-black py-1 px-2"></td>
              <td className="border-t border-b-2 border-r border-black py-1 px-2 uppercase">
                TOTAL
              </td>
              <td className="border-t border-b-2 border-r border-black py-1 px-2 text-right font-mono">
                {totalLength}
              </td>
              <td className="border-t border-b-2 border-r border-black py-1 px-2 text-right font-mono">
                {totalDrums}
              </td>
              <td className="border-t border-b-2 border-r-2 border-black py-1 px-2 text-center text-[10px] text-slate-700 font-bold uppercase">
                {container.items.length > 0 ? 'STATUS VERIFIED' : '-'}
              </td>
              {canEdit && !isPrintView && (
                <>
                  <td className="border border-black no-print"></td>
                  <td className="border border-black no-print"></td>
                </>
              )}
            </tr>
          </tfoot>
        </table>

        {/* =====================================================================
            BLOCK 2: DRUM SIZE SUMMARY TABLE (DRUM SIZE | TOTAL DRUMS)
           ===================================================================== */}
        <table className="w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-white font-semibold text-black">
              <th className="border border-black py-0.5 px-2 text-center w-[45%]">
                DRUM SIZE
              </th>
              <th className="border border-black py-0.5 px-2 text-center w-[55%]">
                TOTAL DRUMS
              </th>
            </tr>
          </thead>
          <tbody>
            {drumSizeSummary.map(row => (
              <tr key={row.drumSize} className="bg-white text-black">
                <td className="border border-black py-0.5 px-2 text-center">
                  {row.drumSize}
                </td>
                <td className="border border-black py-0.5 px-2 text-center font-mono">
                  {row.count}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-white font-semibold text-black">
              <td className="border border-black py-0.5 px-2 text-center uppercase">
                TOTAL
              </td>
              <td className="border border-black py-0.5 px-2 text-center font-mono font-bold">
                {totalDrums}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* =====================================================================
            BLOCK 3: PALLETS DETAILS & WEIGHT SUMMARY TABLE
           ===================================================================== */}
        <table className="w-full border-collapse border-2 border-black text-xs">
          <thead>
            <tr className="bg-white">
              <th
                colSpan={3}
                className="border-2 border-black py-1 px-2 text-center font-bold uppercase tracking-wide text-black"
              >
                PALLETS DETAILS
              </th>
            </tr>
          </thead>
          <tbody>
            {autoGridRows.map((row, rIdx) => {
              const leftKey = `${rIdx}_left`;
              const rightKey = `${rIdx}_right`;
              const leftCell = container.customPalletCells?.[leftKey] || row.left;
              const rightCell = container.customPalletCells?.[rightKey] || row.right;

              return (
                <tr key={rIdx} className="bg-white text-black">
                  {rIdx === 0 && (
                    <td
                      rowSpan={autoGridRows.length}
                      className="border-2 border-black p-2 text-center align-middle w-[22%] font-semibold"
                    >
                      <div className="uppercase leading-snug">TOTAL LENGTH</div>
                      {canEdit && isEditingCells ? (
                        <div className="mt-1 flex items-center justify-center gap-1">
                          <input
                            type="number"
                            value={totalLengthInch}
                            onChange={e =>
                              onUpdateContainer?.({
                                customTotalLengthInch: parseInt(e.target.value, 10) || 0,
                              })
                            }
                            className="w-16 text-center border border-blue-400 rounded px-1 py-0.5 font-bold bg-blue-50/40"
                          />
                          <span>INCH</span>
                        </div>
                      ) : (
                        <div className="mt-0.5 font-bold">{totalLengthInch} INCH</div>
                      )}
                    </td>
                  )}

                  {/* Left Column Pallet Slot */}
                  <td className="border border-black py-1 px-2 text-center align-middle w-[39%]">
                    {canEdit && isEditingCells ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          placeholder="Top tier (e.g. 21/8/15*8)"
                          value={leftCell.topLine}
                          onChange={e =>
                            handleCellChange(rIdx, 'left', 'topLine', e.target.value)
                          }
                          className="w-full text-center text-[11px] border border-slate-300 rounded px-1 py-0.5"
                        />
                        <input
                          type="text"
                          placeholder="Bottom tier (e.g. 42/12/16*2)"
                          value={leftCell.bottomLine}
                          onChange={e =>
                            handleCellChange(rIdx, 'left', 'bottomLine', e.target.value)
                          }
                          className="w-full text-center text-[11px] border border-slate-300 rounded px-1 py-0.5 font-semibold"
                        />
                      </div>
                    ) : (
                      <div className="leading-snug">
                        {leftCell.topLine && (
                          <div className="text-[11px]">{leftCell.topLine}</div>
                        )}
                        <div className="text-[11.5px] font-medium">
                          {leftCell.bottomLine || '-'}
                        </div>
                      </div>
                    )}
                  </td>

                  {/* Right Column Pallet Slot */}
                  <td className="border border-black py-1 px-2 text-center align-middle w-[39%]">
                    {canEdit && isEditingCells ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          placeholder="Top tier (e.g. 21/8/21*8)"
                          value={rightCell.topLine}
                          onChange={e =>
                            handleCellChange(rIdx, 'right', 'topLine', e.target.value)
                          }
                          className="w-full text-center text-[11px] border border-slate-300 rounded px-1 py-0.5"
                        />
                        <input
                          type="text"
                          placeholder="Bottom tier (e.g. 42/12/24)"
                          value={rightCell.bottomLine}
                          onChange={e =>
                            handleCellChange(rIdx, 'right', 'bottomLine', e.target.value)
                          }
                          className="w-full text-center text-[11px] border border-slate-300 rounded px-1 py-0.5 font-semibold"
                        />
                      </div>
                    ) : (
                      <div className="leading-snug">
                        {rightCell.topLine && (
                          <div className="text-[11px]">{rightCell.topLine}</div>
                        )}
                        <div className="text-[11.5px] font-medium">
                          {rightCell.bottomLine || '-'}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-white text-black font-semibold">
              <td colSpan={2} className="border border-black py-1 px-2 text-center">
                NET WT: {netWtKg} KG
              </td>
              <td className="border border-black py-1 px-2 text-center">
                {canEdit && isEditingCells ? (
                  <span className="inline-flex items-center gap-1">
                    <span>PALLET WT:</span>
                    <input
                      type="number"
                      value={palletWtKg}
                      onChange={e =>
                        onUpdateContainer?.({
                          customPalletWeightKg: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-16 text-center border border-blue-400 rounded px-1 py-0.2 bg-blue-50/40 font-bold"
                    />
                    <span>KG</span>
                  </span>
                ) : (
                  <>PALLET WT: {palletWtKg} KG</>
                )}
              </td>
            </tr>
            <tr className="bg-white text-black font-semibold">
              <td
                colSpan={2}
                className="border-t border-b-2 border-l-2 border-r border-black py-1 px-2 text-center"
              >
                GROSS WT: {grossWtKg} KG
              </td>
              <td className="border-t border-b-2 border-r-2 border-black py-1 px-2 text-center">
                {canEdit && isEditingCells ? (
                  <span className="inline-flex items-center gap-1">
                    <span>DRUMS WT :</span>
                    <input
                      type="number"
                      value={drumsWtKg}
                      onChange={e =>
                        onUpdateContainer?.({
                          customDrumsWeightKg: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-16 text-center border border-blue-400 rounded px-1 py-0.2 bg-blue-50/40 font-bold"
                    />
                    <span>KG</span>
                  </span>
                ) : (
                  <>DRUMS WT : {drumsWtKg}. KG</>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
