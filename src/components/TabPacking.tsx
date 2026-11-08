import React, { useState, useEffect } from 'react';
import {
  CableOrder,
  DensitySettings,
  DispatchRecord,
  LadiDimensionRule,
  ManualPackingItem,
  PackagingRule,
  SizePackagingRule,
} from '../types/cable';
import {
  computeRecordRow,
  evaluateSpoolSizeForOrder,
  exportCsvFile,
  getCoilMultiplierByOption,
  isOrderComplete,
  parseSizeNum,
} from '../utils/calculations';
import {
  computeIs694CartonPackingForOrder,
  computeIs694PackingRowsForOrders,
  ComputedIs694CartonPackingRow,
  downloadIndividualIs694PackingHtml,
  formatMixBreakdownLabel,
  Is694CartonMode,
  Is694CartonStandardKey,
  loadMaruMiracleCartonRules,
  loadVihanTriguardCartonRules,
  lookupIs694CartonSpec,
  MaruMiracleCartonRule,
  saveMaruMiracleCartonRules,
  saveVihanTriguardCartonRules,
  sumMixBreakdown,
  VihanTriguardCartonRule,
} from '../utils/is694CartonPackaging';
import { Is694CartonMasterTables } from './Is694CartonMasterTables';
import {
  Package,
  Plus,
  Download,
  Truck,
  Search,
  Trash2,
  Printer,
  RotateCcw,
  CheckCircle2,
  ArrowUpRight,
  Box,
  Database,
  FileSpreadsheet,
  QrCode,
} from 'lucide-react';
import { DispatchedReelItem } from '../utils/reelQrCode';
import { ReelQrCodeModal } from './ReelQrCodeModal';

interface TabPackingProps {
  orders: CableOrder[];
  manualItems: ManualPackingItem[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
  is694VihanRules?: VihanTriguardCartonRule[];
  is694MaruRules?: MaruMiracleCartonRule[];
  onUpdateOrder: (order: CableOrder) => void;
  onAddManualItem: (item: ManualPackingItem) => void;
  onDeleteManualItem: (index: number) => void;
  onImportOrdersToPacking: (batchChoice: string, sizeChoice: string) => void;
  onDispatchBatch: (batch: string, size?: string) => void;
  onDispatchReel?: (payload: {
    isManual: boolean;
    manualIdx?: number;
    orderId?: number;
    batch: string;
    sizeCores: string;
    drumNo: string;
    len: number;
    cableWt: number;
  }) => void;
  onRevertDispatchReel?: (payload: {
    isManual: boolean;
    manualIdx?: number;
    orderId?: number;
    drumNo: string;
    len: number;
    cableWt: number;
  }) => void;
  onAddDispatchRecord?: (record: DispatchRecord) => void;
  onNavigateTab?: (tabId: string) => void;
}

export const TabPacking: React.FC<TabPackingProps> = ({
  orders,
  manualItems,
  densities,
  ladiDimensions,
  sizeRules,
  packagingRules,
  is694VihanRules,
  is694MaruRules,
  onUpdateOrder,
  onAddManualItem,
  onDeleteManualItem,
  onImportOrdersToPacking,
  onDispatchBatch,
  onDispatchReel,
  onRevertDispatchReel,
  onAddDispatchRecord,
  onNavigateTab,
}) => {
  const [filterBatch, setFilterBatch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'active' | 'all' | 'dispatched'>('all');
  const [packingSectionMode, setPackingSectionMode] = useState<'is694_only' | 'drum_only'>(() => {
    const hasIs694 = orders.some(o => (o.grade || '').toUpperCase().includes('IS-694'));
    return hasIs694 ? 'is694_only' : 'drum_only';
  });
  const [selectedIs694RowKey, setSelectedIs694RowKey] = useState<string>('ALL');

  // Manual Reel Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalBatch, setModalBatch] = useState('07/163');
  const [modalBrandGrade, setModalBrandGrade] = useState('EKP H07RN-F');
  const [modalSizeCores, setModalSizeCores] = useState('3C × 2.50 SQ MM');
  const [modalSpool, setModalSpool] = useState('42 x 12 x 20');
  const [modalDrumNo, setModalDrumNo] = useState('07/163-EKP-2.5-D1');
  const [modalLen, setModalLen] = useState('1000');
  const [modalCuWt, setModalCuWt] = useState('50');
  const [modalCompWt, setModalCompWt] = useState('30');
  const [modalPallet, setModalPallet] = useState('30X30x6');

  // Extract Modal
  const [isExtractModalOpen, setIsExtractModalOpen] = useState(false);
  const [extractBatch, setExtractBatch] = useState('');
  const [extractSize, setExtractSize] = useState('');

  // Active Packing List Reel QR Code Modal State
  const [activePackingQrState, setActivePackingQrState] = useState<{
    reel: DispatchedReelItem;
    siblings: DispatchedReelItem[];
  } | null>(null);

  // IS-694 Carton Packing Rules & UI State (Master Packing Data is stored in Tab 12: Backup)
  const [vihanRules, setVihanRules] = useState(() =>
    is694VihanRules && is694VihanRules.length > 0 ? is694VihanRules : loadVihanTriguardCartonRules()
  );
  const [maruRules, setMaruRules] = useState(() =>
    is694MaruRules && is694MaruRules.length > 0 ? is694MaruRules : loadMaruMiracleCartonRules()
  );
  const [showIs694MasterTables, setShowIs694MasterTables] = useState(false);

  useEffect(() => {
    if (is694VihanRules && is694VihanRules.length > 0) {
      setVihanRules(is694VihanRules);
    }
  }, [is694VihanRules]);

  useEffect(() => {
    if (is694MaruRules && is694MaruRules.length > 0) {
      setMaruRules(is694MaruRules);
    }
  }, [is694MaruRules]);

  useEffect(() => {
    const refreshCartonRules = () => {
      setVihanRules(loadVihanTriguardCartonRules());
      setMaruRules(loadMaruMiracleCartonRules());
    };
    window.addEventListener('plutus_is694_carton_rules_updated', refreshCartonRules);
    return () => window.removeEventListener('plutus_is694_carton_rules_updated', refreshCartonRules);
  }, []);

  const uniqueBatches = Array.from(new Set(orders.map(o => o.batch))).sort();
  const uniqueSizes = Array.from(new Set(orders.map(o => o.size))).sort();

  // Filter IS-694 orders for the dedicated IS-694 Carton Packing List
  const is694Orders = orders.filter(o => {
    if (!(o.grade || '').toUpperCase().includes('IS-694')) return false;
    if (filterBatch && o.batch !== filterBatch) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const str = `${o.batch} ${o.brand} ${o.grade} ${o.size} ${o.ins_colour || ''}`.toLowerCase();
      if (!str.includes(q)) return false;
    }
    return true;
  });

  // Compute IS-694 packing rows (automatically uses released Partial Production Plan lots when present!)
  const allIs694PackingRows = computeIs694PackingRowsForOrders(
    is694Orders,
    densities,
    ladiDimensions,
    vihanRules,
    maruRules
  );

  const is694PackingRows =
    selectedIs694RowKey === 'ALL'
      ? allIs694PackingRows
      : allIs694PackingRows.filter(
          r => (r.lot ? `${r.order.id}-${r.lot.id}` : `order-${r.order.id}`) === selectedIs694RowKey
        );

  const is694IndividualModeRows = is694PackingRows.filter(r => r.mode === 'INDIVIDUAL');
  const is694MixModeRows = is694PackingRows.filter(r => r.mode === 'MIX');

  const totalIndCoils = is694IndividualModeRows.reduce((s, r) => s + r.totalCoils, 0);
  const totalIndCartons = is694IndividualModeRows.reduce((s, r) => s + r.totalCartons, 0);
  const totalIndStockCartons = is694IndividualModeRows.reduce((s, r) => s + r.availableCartonStock, 0);

  const totalMixCoils = is694MixModeRows.reduce((s, r) => s + r.totalCoils, 0);
  const totalMixCartons = is694MixModeRows.reduce((s, r) => s + r.totalCartons, 0);
  const totalMixStockCartons = is694MixModeRows.reduce((s, r) => s + r.availableCartonStock, 0);
  const totalMixDispatchedCartons = is694MixModeRows.reduce((s, r) => s + r.dispatchedCartons, 0);

  const handleToggleIs694CartonDispatch = (row: ComputedIs694CartonPackingRow) => {
    const order = row.order;
    const lot = row.lot;
    const nextDispatched = !row.isDispatched;
    const nowIso = new Date().toISOString();

    if (lot && order.production_lots && order.production_lots.length > 0) {
      const updatedLots = order.production_lots.map(l =>
        l.id === lot.id ? { ...l, dispatched: nextDispatched } : l
      );
      const allLotsDispatched = updatedLots.every(l => l.dispatched) && (Number(order.coils) || 0) === 0;
      onUpdateOrder({
        ...order,
        production_lots: updatedLots,
        dispatched: allLotsDispatched,
        dispatchedAt: allLotsDispatched ? nowIso : order.dispatchedAt,
      });
      return;
    }

    onUpdateOrder({
      ...order,
      dispatched: nextDispatched,
      dispatchedAt: nextDispatched ? nowIso : undefined,
      dispatchedLength: nextDispatched ? row.orderLengthM : 0,
      dispatchedWeight: nextDispatched ? row.netWireWtKg : 0,
    });

    if (nextDispatched && onAddDispatchRecord) {
      const is694DispRecord: DispatchRecord = {
        id: `DSP-IS694-${order.id}-${lot?.id || 'main'}-${Date.now()}`,
        dispatchNo: `DSP-CTN-${order.batch.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now().toString().slice(-4)}`,
        batch: order.batch,
        orderId: order.id,
        date: nowIso.split('T')[0],
        clientName: (order as any).party_name || (order as any).clientName || 'Domestic Distributor',
        destination: (order as any).destination || 'Local Dispatch',
        brand: order.brand,
        grade: order.grade || 'IS-694',
        sizeCores: `1C × ${order.size}`,
        conductor: order.conductor,
        packagingType: 'CARTONS',
        cartonCount: row.totalCartons,
        coilsCount: row.totalCoils,
        cartonIds: row.cartonIdsLabel || '',
        lengthM: row.orderLengthM,
        netWeightKg: row.netWireWtKg,
        grossWeightKg: row.grossPackingWtKg,
        status: 'Dispatched',
        remarks: `IS-694 Packing List Dispatch: ${row.standard} • ${row.mode} • ${row.coilType}${
          row.cartonIdsLabel ? ` • Cartons: ${row.cartonIdsLabel}` : ''
        }`,
        createdAt: nowIso,
      };
      onAddDispatchRecord(is694DispRecord);
    }
  };

  const handleUpdateIs694OrderCarton = (
    row: ComputedIs694CartonPackingRow,
    updates: {
      standard?: Is694CartonStandardKey;
      mode?: Is694CartonMode;
      coilType?: string;
      coilsPerCarton?: number;
      cartonCount?: number;
      totalCoils?: number;
      tareWeight?: number;
      cartonIds?: string;
    }
  ) => {
    const order = row.order;
    const lot = row.lot;
    const nextStd = updates.standard || order.carton_standard || 'VIHAN_OPTO';
    const nextMode = updates.mode || order.carton_mode || 'INDIVIDUAL';
    const nextCoilType = updates.coilType || (lot ? lot.coil_type : order.coil_type) || '90 MTR';
    const mult = getCoilMultiplierByOption(nextCoilType);

    const spec = lookupIs694CartonSpec(order.size, nextStd, nextCoilType, vihanRules, maruRules);
    const defaultCpc =
      nextMode === 'MIX' && sumMixBreakdown(spec.mixPerCarton) > 0
        ? sumMixBreakdown(spec.mixPerCarton)
        : spec.coilsPerCarton || 16;

    const nextCpc =
      updates.coilsPerCarton !== undefined && updates.coilsPerCarton > 0
        ? updates.coilsPerCarton
        : order.coils_per_carton && updates.standard === undefined && updates.mode === undefined && updates.coilType === undefined
        ? Number(order.coils_per_carton)
        : defaultCpc;

    const currentRowCoils = lot
      ? Number(lot.coils)
      : Number(order.coils) || Math.round(order.order_length / mult);

    let nextTotalCoils =
      updates.totalCoils !== undefined ? updates.totalCoils : currentRowCoils;

    let nextCartonCount =
      updates.cartonCount !== undefined
        ? updates.cartonCount
        : nextCpc > 0
        ? Number((nextTotalCoils / nextCpc).toFixed(2))
        : 0;

    if (updates.cartonCount !== undefined && updates.cartonCount > 0) {
      nextTotalCoils = Math.round(updates.cartonCount * nextCpc);
    } else if (updates.totalCoils !== undefined && nextCpc > 0) {
      nextCartonCount = Number((updates.totalCoils / nextCpc).toFixed(2));
    } else if ((updates.standard !== undefined || updates.mode !== undefined || updates.coilType !== undefined) && nextCpc > 0) {
      nextCartonCount = Number((nextTotalCoils / nextCpc).toFixed(2));
    }

    const nextOrderLen = Number((nextTotalCoils * mult).toFixed(1));
    let nextBreakdown = lot ? lot.coil_colour_breakdown : order.coil_colour_breakdown;
    let nextInsColour = lot ? lot.ins_colour : order.ins_colour;

    if (nextMode === 'MIX' && sumMixBreakdown(spec.mixPerCarton) > 0 && nextCartonCount > 0) {
      const bMap: Record<string, number> = {};
      (['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).forEach(col => {
        const perCtn = spec.mixPerCarton[col] || 0;
        if (perCtn > 0) {
          bMap[col] = Math.round(perCtn * nextCartonCount);
        }
      });
      if (Object.keys(bMap).length > 0) {
        nextBreakdown = bMap;
        nextInsColour = Object.entries(bMap)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
      }
    }

    // If editing a Partial Production Plan Lot row, update that lot AND recalculate the Order Sheet remaining coils
    if (lot && order.production_lots && order.production_lots.length > 0) {
      const totalOrderCoils =
        Number(order.total_order_coils) ||
        Number(order.coils || 0) + Number(order.planned_coils || 0);
      const updatedLots = order.production_lots.map(l =>
        l.id === lot.id
          ? {
              ...l,
              coils: nextTotalCoils,
              coil_type: nextCoilType,
              order_length: nextOrderLen,
              carton_count: nextCartonCount,
              coil_colour_breakdown: nextBreakdown,
              ins_colour: nextInsColour,
              carton_ids: updates.cartonIds !== undefined ? updates.cartonIds : l.carton_ids,
            }
          : l
      );
      const newPlannedTotal = updatedLots.reduce((s, l) => s + (Number(l.coils) || 0), 0);
      const newRemainingCoils = Math.max(0, totalOrderCoils - newPlannedTotal);
      const newRemainingLen = Number((newRemainingCoils * mult).toFixed(1));

      onUpdateOrder({
        ...order,
        carton_standard: nextStd,
        carton_mode: nextMode,
        coil_type: nextCoilType,
        coils_per_carton: nextCpc,
        production_lots: updatedLots,
        planned_coils: newPlannedTotal,
        remaining_coils: newRemainingCoils,
        coils: newRemainingCoils,
        order_length: newRemainingLen,
        tare_weight: updates.tareWeight !== undefined ? updates.tareWeight : order.tare_weight,
      });
      return;
    }

    onUpdateOrder({
      ...order,
      carton_standard: nextStd,
      carton_mode: nextMode,
      coil_type: nextCoilType,
      coils_per_carton: nextCpc,
      carton_count: nextCartonCount,
      coils: nextTotalCoils,
      order_length: nextOrderLen,
      coil_colour_breakdown: nextBreakdown,
      ins_colour: nextInsColour,
      carton_ids: updates.cartonIds !== undefined ? updates.cartonIds : order.carton_ids,
      tare_weight: updates.tareWeight !== undefined ? updates.tareWeight : order.tare_weight,
    });
  };

  const handleExportIs694CartonCSV = () => {
    const csvRows: (string | number)[][] = [
      [
        'Sr No',
        'Job No / Batch',
        'Parcel / Plan Lot',
        'Brand',
        'Grade',
        'Cable Size (1C)',
        'Conductor',
        'Core OD (mm)',
        'Carton Standard',
        'Carton Mode',
        'Coil Option',
        'Coils / Carton',
        'No. of Coils',
        'Total Master Cartons',
        'Carton IDs (Operator Log)',
        'Available Carton / Mix Carton Stock',
        'Remaining Coils on Order Sheet',
        'Colour-Wise Coils & Cartons / Mix Breakdown',
        'Planned Length (m)',
        'Net Wire Wt (kg)',
        'Gross Carton Wt (kg)',
      ],
    ];
    is694PackingRows.forEach((row, i) => {
      const colStr =
        row.mode === 'MIX'
          ? `Mix Per Carton: ${formatMixBreakdownLabel(row.mixPerCarton)} | No. of Coils: ${row.totalCoils} (${row.colourDetails
              .map(c => `${c.colour}:${c.coils}`)
              .join(', ')}) | Mix Carton Stock: ${row.availableCartonStock} Ctns`
          : row.colourDetails.map(c => `${c.colour}: ${c.coils} Coils (${c.cartons} Cartons)`).join(' | ');
      csvRows.push([
        i + 1,
        row.order.batch,
        row.isPartialPlan ? row.lotLabel || 'Parcel Lot' : 'Full Order',
        row.order.brand,
        row.order.grade || 'IS-694',
        row.order.size,
        row.order.conductor,
        row.order.core_od,
        row.standard,
        row.mode,
        row.coilType,
        row.coilsPerCarton,
        row.totalCoils,
        row.totalCartons,
        row.cartonIdsLabel || '-',
        row.availableCartonStock,
        row.isPartialPlan ? row.remainingCoilsOnOrderSheet : 0,
        colStr,
        row.orderLengthM,
        row.netWireWtKg.toFixed(2),
        row.grossPackingWtKg.toFixed(2),
      ]);
    });
    exportCsvFile('IS694_Individual_Carton_Packing_List.csv', csvRows);
  };

  const handlePrintIndividualIs694Table = () => {
    const titleSuffix =
      selectedIs694RowKey !== 'ALL' && is694PackingRows[0]
        ? `Job ${is694PackingRows[0].order.batch} — ${is694PackingRows[0].order.brand} 1C × ${is694PackingRows[0].order.size} (${is694PackingRows[0].lotLabel || 'IS-694'})`
        : filterBatch
        ? `Batch ${filterBatch} — IS-694 Individual Packing List`
        : 'IS-694 Individual Packing List (Colour-Wise Coils & Cartons + Mix Carton Stock)';
    downloadIndividualIs694PackingHtml(is694PackingRows, titleSuffix);
  };

  const handleCreateManualItem = (e: React.FormEvent) => {
    e.preventDefault();
    const l = parseFloat(modalLen) || 1000;
    const cu = parseFloat(modalCuWt) || 0;
    const comp = parseFloat(modalCompWt) || 0;
    onAddManualItem({
      batch: modalBatch.trim(),
      brandGrade: modalBrandGrade.trim(),
      sizeCores: modalSizeCores.trim(),
      spool: modalSpool.trim(),
      drumNo: modalDrumNo.trim(),
      len: l,
      cuWt: cu,
      compWt: comp,
      totalWt: cu + comp + 25,
      pallet: modalPallet.trim() || '30X30x6',
      status: 'Packed',
      dispatched: false,
    });
    setIsModalOpen(false);
  };

  const handleExtractSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onImportOrdersToPacking(extractBatch.trim(), extractSize.trim());
    setIsExtractModalOpen(false);
  };

  // Compile drum packing rows (Strictly excludes IS-694 orders & items!)
  interface PackingRowItem {
    key: string;
    isManual: boolean;
    manualIdx?: number;
    orderId?: number;
    batch: string;
    rawBatch: string;
    brandGrade: string;
    sizeCores: string;
    spool: string;
    drumNo: string;
    len: number;
    cuWt: number;
    compWt: number;
    calcTotalWt: number;
    tareWt: number;
    actualWt: number | string;
    pallet: string;
    status: string;
    isDispatched: boolean;
  }

  const rows: PackingRowItem[] = [];

  // 1. Auto-include non-coil, non-IS-694 orders where sheathing is complete (p.s is true) or order is complete or dispatched
  // IS-694 and any order with Coils Detail dispatch in cartons/coils, so Drum is strictly N/A!
  orders.forEach(o => {
    const isIs694 = (o.grade || '').toUpperCase().includes('IS-694');
    const hasCoils = o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0;
    if (isIs694 || hasCoils) return;

    const p = o.pStatus || { b: false, c: false, i: false, t: false, s: false };
    if (!p.s && !isOrderComplete(o) && !o.dispatched && !(o.dispatchedDrums && o.dispatchedDrums.length > 0)) {
      return;
    }
    if (filterBatch && o.batch !== filterBatch) return;

    const r = computeRecordRow(o, densities, ladiDimensions);
    const evalPkg = evaluateSpoolSizeForOrder(
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
    );
    if (evalPkg.spool.startsWith('N/A')) return;
    const pkgText = evalPkg.packaging || '1000m / Drum';
    const mLenMatch = pkgText.match(/[0-9]+/);
    const drumLen = mLenMatch ? parseFloat(mLenMatch[0]) : 1000;

    let remLen = r.orderLen;
    let spoolIdx = 1;

    while (remLen > 0) {
      const currentLen = Math.min(drumLen, remLen);
      const drumNo = `${o.batch}-${o.brand}-${parseSizeNum(o.size).toFixed(2)}-D${spoolIdx}`;
      const cuShare = r.orderLen > 0 ? r.reqCu * (currentLen / r.orderLen) : 0;
      const compoundShare =
        r.orderLen > 0 ? (r.reqIns + r.reqSheath) * (currentLen / r.orderLen) : 0;
      const tareWt = o.tare_weight !== undefined ? parseFloat(String(o.tare_weight)) : 25;
      const calcTotal = cuShare + compoundShare + tareWt;
      const actual =
        o.actual_weight !== undefined && o.actual_weight !== '' ? o.actual_weight : '';

      const isDrumDispatched = Boolean(
        o.dispatched || (o.dispatchedDrums && o.dispatchedDrums.includes(drumNo))
      );

      rows.push({
        key: `order-${o.id}-${spoolIdx}`,
        isManual: false,
        orderId: o.id,
        batch: o.batch,
        rawBatch: o.batch,
        brandGrade: `${o.brand} ${o.grade || 'H07RN-F'}`,
        sizeCores: `${o.cores}C × ${o.size}`,
        spool: evalPkg.spool,
        drumNo,
        len: currentLen,
        cuWt: cuShare,
        compWt: compoundShare,
        calcTotalWt: calcTotal,
        tareWt,
        actualWt: actual,
        pallet: evalPkg.pallet || '30X30x6',
        status: isDrumDispatched ? 'Dispatched (Stock Deducted)' : 'Sheath Complete',
        isDispatched: isDrumDispatched,
      });

      remLen -= currentLen;
      spoolIdx++;
    }
  });

  // 2. Include manual / extracted items (excluding any IS-694 items so IS-694 only shows in IS-694 Individual Packing List)
  const existingOrderDrumNos = new Set(rows.map(r => r.drumNo));
  manualItems.forEach((m, mIdx) => {
    if ((m.brandGrade || '').toUpperCase().includes('IS-694')) return;
    if (existingOrderDrumNos.has(m.drumNo)) return;
    if (filterBatch && m.batch !== filterBatch) return;
    const isDisp = Boolean(m.dispatched || m.status === 'Dispatched');
    rows.push({
      key: `manual-${mIdx}`,
      isManual: true,
      manualIdx: mIdx,
      batch: `${m.batch} (Extracted)`,
      rawBatch: m.batch,
      brandGrade: m.brandGrade,
      sizeCores: m.sizeCores,
      spool: m.spool,
      drumNo: m.drumNo,
      len: m.len,
      cuWt: m.cuWt,
      compWt: m.compWt,
      calcTotalWt: m.totalWt,
      tareWt: 25,
      actualWt: m.totalWt,
      pallet: m.pallet || '30X30x6',
      status: isDisp ? 'Dispatched (Stock Deducted)' : m.status || 'Packed',
      isDispatched: isDisp,
    });
  });

  const filteredRows = rows.filter(r => {
    if (viewMode === 'active' && r.isDispatched) return false;
    if (viewMode === 'dispatched' && !r.isDispatched) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const str = `${r.batch} ${r.brandGrade} ${r.sizeCores} ${r.drumNo} ${r.spool} ${r.status}`.toLowerCase();
    return str.includes(q);
  });

  // Calculate summary stats for packing & dispatch
  const readyReels = rows.filter(r => !r.isDispatched);
  const dispatchedReels = rows.filter(r => r.isDispatched);
  const readyLength = readyReels.reduce((s, r) => s + r.len, 0);
  const readyNetWt = readyReels.reduce((s, r) => s + r.cuWt + r.compWt, 0);
  const dispatchedLength = dispatchedReels.reduce((s, r) => s + r.len, 0);
  const dispatchedNetWt = dispatchedReels.reduce((s, r) => s + r.cuWt + r.compWt, 0);

  // Convert each Packing List reel row into a rich DispatchedReelItem with full Order Details for QR scanning
  const buildPackingReelQrItem = (
    r: PackingRowItem,
    reelIdx: number,
    totalCount: number
  ): DispatchedReelItem => {
    const matchedOrder = r.orderId ? orders.find(o => o.id === r.orderId) : undefined;
    const brandParts = (r.brandGrade || '').split(' ');
    const brandName = matchedOrder?.brand || brandParts[0] || 'PLUTUS';
    const gradeName = matchedOrder?.grade || brandParts.slice(1).join(' ') || 'H07RN-F';
    const actGrossWt =
      typeof r.actualWt === 'number'
        ? r.actualWt
        : parseFloat(String(r.actualWt)) || r.calcTotalWt;
    const netWt = Number((r.cuWt + r.compWt).toFixed(2));
    const dateStr =
      matchedOrder?.dispatchedAt?.split('T')[0] ||
      new Date().toISOString().split('T')[0];

    const syntheticRecord: DispatchRecord = {
      id: `PKG-${r.key}`,
      dispatchNo: `PKG-${r.rawBatch.replace(/\s+/g, '')}-${reelIdx}`,
      orderId: r.orderId,
      batch: r.rawBatch,
      date: dateStr,
      clientName: matchedOrder ? `${matchedOrder.brand} Order Reel` : 'Packing List Reel',
      destination: r.isDispatched ? 'Dispatched from Packing List' : 'Ready in Finished Stock',
      brand: brandName,
      grade: gradeName,
      sizeCores: r.sizeCores,
      conductor: matchedOrder?.conductor || '-',
      packagingType: 'DRUMS',
      drumCount: 1,
      drumNos: r.drumNo,
      spoolSize: r.spool,
      palletSize: r.pallet,
      lengthM: r.len,
      netWeightKg: netWt,
      grossWeightKg: Number(actGrossWt.toFixed(2)),
      vehicleOrContainerNo: `Spool: ${r.spool} | Pallet: ${r.pallet}`,
      status: r.isDispatched ? 'Dispatched' : 'Dispatched',
      remarks: matchedOrder?.print_details || r.status,
      createdAt: new Date().toISOString(),
    };

    return {
      id: `QR-${r.key}`,
      drumNo: r.drumNo,
      dispatchDate: dateStr,
      reelIndex: reelIdx,
      totalReelsInRecord: totalCount,
      reelLengthM: r.len,
      reelNetWeightKg: netWt,
      reelGrossWeightKg: Number(actGrossWt.toFixed(2)),
      record: syntheticRecord,
      orderDetails: {
        orderId: r.orderId,
        conductor: matchedOrder?.conductor,
        coreOdMm: matchedOrder?.core_od,
        finalDiaMm: matchedOrder?.final_dia,
        insCompound: matchedOrder?.ins_compound,
        sheathCompound: matchedOrder?.sheath_compound,
        sheathColour: matchedOrder?.sheath_colour,
        spoolSize: r.spool,
        palletSize: r.pallet,
        cuWeightKg: r.cuWt,
        compoundWeightKg: r.compWt,
        tareWeightKg: r.tareWt,
        totalOrderLengthM: matchedOrder?.order_length || r.len,
        printDetails: matchedOrder?.print_details,
        packingStatus: r.status,
        sourceTab: 'packing',
      },
    };
  };

  const packingReelQrItems: DispatchedReelItem[] = filteredRows.map((r, i) =>
    buildPackingReelQrItem(r, i + 1, filteredRows.length)
  );

  const handleExportCSV = () => {
    const csvRows: (string | number)[][] = [
      [
        'Sr No',
        'Batch / Job Order',
        'Brand & Grade',
        'Cable Size & Cores',
        'Drum Size',
        'Drum Serial No',
        'Length (m)',
        'Copper Wt (kg)',
        'Compound Wt (kg)',
        'Total Reel Wt (kg)',
        'Pallet Size',
        'Status',
      ],
    ];
    filteredRows.forEach((r, idx) => {
      csvRows.push([
        idx + 1,
        r.batch,
        r.brandGrade,
        r.sizeCores,
        r.spool,
        r.drumNo,
        r.len,
        r.cuWt.toFixed(2),
        r.compWt.toFixed(2),
        r.calcTotalWt.toFixed(2),
        r.pallet,
        r.status,
      ]);
    });
    exportCsvFile('Production_Dispatch_Packing_List.csv', csvRows);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-4 print-card">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-200 gap-2">
        <div className="flex items-center gap-2 font-bold text-slate-900 text-sm flex-wrap">
          <Package className="w-4 h-4 text-blue-600" />
          <span>
            {packingSectionMode === 'is694_only'
              ? '📦 IS-694 Individual Packing List Only (Colour-Wise Coils & Cartons + Mix Carton Stock)'
              : '🛞 Standard Drum / Reel Packing List (Non-IS-694 Cables)'}
          </span>
          {/* Strictly Separate Packing List Switcher */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 ml-1 no-print">
            <button
              type="button"
              onClick={() => setPackingSectionMode('is694_only')}
              className={`px-3 py-1 rounded text-[11px] font-extrabold transition-all cursor-pointer ${
                packingSectionMode === 'is694_only'
                  ? 'bg-rose-800 text-white shadow-2xs'
                  : 'text-rose-900 hover:bg-rose-100'
              }`}
            >
              📦 IS-694 Individual Packing List Only ({allIs694PackingRows.length})
            </button>
            <button
              type="button"
              onClick={() => setPackingSectionMode('drum_only')}
              className={`px-3 py-1 rounded text-[11px] font-extrabold transition-all cursor-pointer ${
                packingSectionMode === 'drum_only'
                  ? 'bg-blue-700 text-white shadow-2xs'
                  : 'text-slate-700 hover:bg-slate-200'
              }`}
            >
              🛞 Drum / Reel Packing List ({rows.length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap no-print">
          {packingSectionMode === 'drum_only' && (
            <select
              value={viewMode}
              onChange={e => setViewMode(e.target.value as any)}
              className="text-xs px-2.5 py-1.5 border border-slate-300 rounded font-bold bg-slate-50 text-slate-800"
            >
              <option value="all">All Reels ({rows.length})</option>
              <option value="active">Ready in Stock ({readyReels.length})</option>
              <option value="dispatched">Dispatched ({dispatchedReels.length})</option>
            </select>
          )}

          <select
            value={filterBatch}
            onChange={e => setFilterBatch(e.target.value)}
            className="text-xs px-2.5 py-1.5 border border-slate-300 rounded font-semibold bg-white"
          >
            <option value="">All Batches / Job Orders</option>
            {uniqueBatches.map(b => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <div className="relative">
            <input
              type="text"
              placeholder={packingSectionMode === 'is694_only' ? 'Search IS-694 Job, Brand, Colour...' : 'Search Drum No, Brand, Size...'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="text-xs pl-7 pr-2.5 py-1.5 border border-slate-300 rounded w-48 bg-white"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          </div>

          {packingSectionMode === 'drum_only' && (
            <>
              <button
                onClick={() => setIsModalOpen(true)}
                className="text-xs px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" /> Add Manual Reel
              </button>

              <button
                onClick={() => setIsExtractModalOpen(true)}
                className="text-xs px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded font-bold flex items-center gap-1 shadow-xs"
              >
                <Download className="w-3.5 h-3.5" /> Extract from Order Sheet
              </button>

              {readyReels.length > 0 && (
                <button
                  onClick={() => onDispatchBatch(filterBatch || 'ALL')}
                  className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold flex items-center gap-1 shadow-xs"
                  title="Dispatch all ready reels and auto-deduct from Finished Stock"
                >
                  <Truck className="w-3.5 h-3.5" /> Dispatch All Ready ({readyReels.length})
                </button>
              )}

              <button
                onClick={handleExportCSV}
                className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold flex items-center gap-1"
              >
                ⬇ Export Drum CSV
              </button>
            </>
          )}

          <button
            onClick={() => window.print()}
            className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold flex items-center gap-1.5 shadow-xs"
            title="Print current page"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>Print current page</span>
          </button>
        </div>
      </div>

      {/* Summary Banner: Dedicated IS-694 Summary when viewing IS-694 Individual Packing List, or Drum Summary when viewing Drum List */}
      {packingSectionMode === 'is694_only' ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-rose-50/70 p-3 rounded-xl border-2 border-rose-300">
          <div className="bg-white p-2.5 rounded-lg border border-rose-200 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase text-rose-800">
                🎨 Colour-Wise Coils &amp; Cartons List (Individual)
              </div>
              <div className="text-sm font-black text-rose-950 mt-0.5">
                {totalIndCoils} Coils · {totalIndCartons.toFixed(2).replace(/\.00$/, '')} Cartons
              </div>
              <div className="text-[10px] font-bold text-emerald-700">
                Ready in Carton Stock: {totalIndStockCartons.toFixed(2).replace(/\.00$/, '')} Cartons
              </div>
            </div>
            <Box className="w-6 h-6 text-rose-600 opacity-80" />
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-amber-300 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase text-amber-900 flex items-center gap-1">
                📦 Mix Colour Coils &amp; Mix Carton Stock
              </div>
              <div className="text-sm font-black text-amber-950 mt-0.5">
                No. of Coils: {totalMixCoils} Coils · {totalMixCartons.toFixed(2).replace(/\.00$/, '')} Mix Cartons
              </div>
              <div className="text-[10px] text-emerald-800 font-black">
                Mix Carton Stock Available: {totalMixStockCartons.toFixed(2).replace(/\.00$/, '')} Mix Cartons (Dispatched: {totalMixDispatchedCartons.toFixed(2).replace(/\.00$/, '')})
              </div>
            </div>
            <Package className="w-6 h-6 text-amber-600 opacity-80" />
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-rose-200 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-500">
                IS-694 Master Packing Data (Stored in Backup)
              </div>
              <div className="text-xs font-bold text-slate-800 mt-0.5">
                Vihan Opto, Triguard &amp; Maru Miracle Standards saved in <span className="text-rose-800 font-extrabold">Tab 12: Backup</span>
              </div>
              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('settings')}
                  className="mt-1 text-[11px] font-bold text-rose-700 hover:text-rose-900 flex items-center gap-1 no-print cursor-pointer"
                >
                  Open Master Packing Standards in Backup <ArrowUpRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
          <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-500">
                Ready in Finished Drum Stock
              </div>
              <div className="text-sm font-black text-blue-700 mt-0.5">
                {readyReels.length} Reels · {readyLength.toLocaleString()} m
              </div>
              <div className="text-[10px] text-slate-500">
                Net Cable Weight: {readyNetWt.toFixed(2)} kg
              </div>
            </div>
            <Package className="w-6 h-6 text-blue-500 opacity-80" />
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-emerald-200 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Dispatched Drums (Auto-Deducted from Stock)
              </div>
              <div className="text-sm font-black text-emerald-800 mt-0.5">
                {dispatchedReels.length} Reels · {dispatchedLength.toLocaleString()} m
              </div>
              <div className="text-[10px] text-emerald-600 font-semibold">
                Deducted Weight: -{dispatchedNetWt.toFixed(2)} kg
              </div>
            </div>
            <Truck className="w-6 h-6 text-emerald-600 opacity-80" />
          </div>

          <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-500">
                IS-694 Individual Packing List (Separate View)
              </div>
              <div className="text-xs font-bold text-slate-800 mt-0.5">
                IS-694 orders are shown exclusively in the <span className="text-rose-800 font-extrabold">IS-694 Individual Packing List</span>.
              </div>
              <button
                type="button"
                onClick={() => setPackingSectionMode('is694_only')}
                className="mt-1 text-[11px] font-bold text-rose-700 hover:text-rose-900 flex items-center gap-1 no-print cursor-pointer"
              >
                Switch to IS-694 Individual Packing List ({allIs694PackingRows.length}) <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SPECIAL IS-694 GRADE INDIVIDUAL MASTER CARTON PACKING LIST (SHOWN ONLY IN IS-694 VIEW) */}
      {packingSectionMode === 'is694_only' && (
        <div className="border-2 border-rose-800 rounded-xl bg-white overflow-hidden shadow-xs space-y-4 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-rose-200">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-lg bg-rose-800 text-white shadow-2xs">
                <Box className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-xs sm:text-sm font-black text-rose-950 uppercase tracking-wide flex items-center gap-2 flex-wrap">
                  <span>📦 IS-694 Individual Packing List Only (Colour-Wise Coils &amp; Cartons + Mix Carton Stock)</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                    {is694PackingRows.length} IS-694 Packing Row(s)
                  </span>
                </h3>
                <p className="text-[11px] text-slate-600">
                  Shown exclusively in this <strong>IS-694 Individual Packing List</strong> (Drum Size: N/A). Displays <strong>Colour-Wise Coils &amp; Cartons List</strong> for individual orders, and <strong>No. of Coils &amp; Mix Carton Stock</strong> for Mix orders.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap no-print">
              {/* Individual Order / Lot Selector */}
              <select
                value={selectedIs694RowKey}
                onChange={e => setSelectedIs694RowKey(e.target.value)}
                className="text-xs px-2.5 py-1.5 border-2 border-rose-400 rounded font-extrabold bg-rose-50 text-rose-950"
                title="Generate IS-694 Individual Packing List for all IS-694 orders or a single individual order / parcel lot"
              >
                <option value="ALL">📋 All IS-694 Orders / Parcel Lots ({allIs694PackingRows.length})</option>
                {allIs694PackingRows.map(r => {
                  const rKey = r.lot ? `${r.order.id}-${r.lot.id}` : `order-${r.order.id}`;
                  return (
                    <option key={rKey} value={rKey}>
                      Job #{r.order.batch} • {r.order.brand} 1C × {r.order.size} — {r.totalCoils} Coils ({r.mode === 'MIX' ? 'MIX' : 'COLOUR-WISE'} • {r.isPartialPlan ? r.lotLabel : 'Full Order'})
                    </option>
                  );
                })}
              </select>

              {is694PackingRows.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handlePrintIndividualIs694Table}
                    className="px-3 py-1.5 rounded text-xs font-extrabold bg-rose-800 hover:bg-rose-900 text-white cursor-pointer flex items-center gap-1.5 shadow-2xs"
                    title="Download / Print standalone Individual IS-694 Packing List (.html)"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    🖨️ Print / Download IS-694 Individual Packing List (.html)
                  </button>
                  <button
                    type="button"
                    onClick={handleExportIs694CartonCSV}
                    className="px-2.5 py-1.5 rounded text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer flex items-center gap-1 shadow-2xs"
                  >
                    ⬇ Export IS-694 CSV
                  </button>
                </>
              )}

              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('settings')}
                  className="px-2.5 py-1.5 rounded text-xs font-extrabold bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-300 cursor-pointer flex items-center gap-1"
                  title="Master Packing Data is stored in Tab 12: Backup"
                >
                  <Database className="w-3.5 h-3.5" />
                  Master Packing Data (Backup Tab)
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowIs694MasterTables(prev => !prev)}
                className="px-2 py-1.5 rounded text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 cursor-pointer"
              >
                {showIs694MasterTables ? 'Hide Standards Preview' : 'Quick Standards Preview'}
              </button>
            </div>
          </div>

          {/* 1. Main Editable IS-694 Individual Master Carton Packing List Table */}
          <div className="overflow-x-auto border border-rose-200 rounded-lg">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead className="bg-rose-900 text-white font-bold uppercase text-[10.5px] border-b border-rose-950">
                <tr>
                  <th className="p-2 border-r border-rose-800">#</th>
                  <th className="p-2 border-r border-rose-800">Job No / Batch</th>
                  <th className="p-2 border-r border-rose-800 bg-indigo-950/70">Parcel Lot &amp; Order Sheet Balance</th>
                  <th className="p-2 border-r border-rose-800">Brand &amp; Size (1C)</th>
                  <th className="p-2 border-r border-rose-800">Cond. / Core OD</th>
                  <th className="p-2 border-r border-rose-800 bg-rose-950/50">Carton Packing Standard</th>
                  <th className="p-2 border-r border-rose-800 bg-rose-950/50">Carton Mode (Colour-Wise / Mix)</th>
                  <th className="p-2 border-r border-rose-800 text-center">Coil Option</th>
                  <th className="p-2 border-r border-rose-800 text-center bg-amber-500 text-slate-950">Coils / Carton</th>
                  <th className="p-2 border-r border-rose-800 text-center bg-amber-300 text-slate-950">No. of Coils</th>
                  <th className="p-2 border-r border-rose-800 text-center bg-amber-400 text-slate-950">Total Cartons</th>
                  <th className="p-2 border-r border-rose-800">Colour-Wise Coils &amp; Cartons List / Mix Details</th>
                  <th className="p-2 border-r border-rose-800 text-center bg-emerald-950/70">Carton Stock / Mix Carton Stock</th>
                  <th className="p-2 border-r border-rose-800 text-right">Planned Len (m)</th>
                  <th className="p-2 text-right">Net / Gross Wt (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rose-100">
                {is694PackingRows.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="p-5 text-center text-slate-500 bg-rose-50/20">
                      No <strong>IS-694</strong> orders found for the current filter. Place an order with grade <strong>IS-694</strong> (Individual Colour or <strong>MIX</strong> option) in Tab 1 (Active Orders Sheet) or release a Parcel Production Plan lot to generate its Individual IS-694 Packing List here.
                    </td>
                  </tr>
                ) : (
                  is694PackingRows.map((row, idx) => {
                    const rowKey = row.lot ? `${row.order.id}-${row.lot.id}` : `order-${row.order.id}`;
                    return (
                      <tr key={rowKey} className="hover:bg-rose-50/40">
                        <td className="p-2 border-r border-slate-100 font-bold text-center">{idx + 1}</td>
                        <td className="p-2 border-r border-slate-100 font-black text-slate-900">{row.order.batch}</td>
                        <td className="p-2 border-r border-slate-100 bg-indigo-50/40">
                          {row.isPartialPlan ? (
                            <div className="space-y-0.5">
                              <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-700 text-white text-[10px] font-black">
                                ⚡ {row.lotLabel} ({row.totalCoils} Coils)
                              </div>
                              <div className="text-[10px] font-extrabold text-slate-700">
                                Total Order: <strong>{row.totalOrderedCoils} Coils</strong>
                              </div>
                              <div className="text-[10px] font-black text-amber-900 bg-amber-100 px-1.5 py-0.2 rounded border border-amber-300 inline-block">
                                ⏳ Order Sheet Rem: {row.remainingCoilsOnOrderSheet} Coils
                              </div>
                            </div>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-300 text-[10px] font-extrabold">
                              Full Order ({row.totalCoils} Coils)
                            </span>
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100">
                          <div className="font-black text-rose-950">{row.order.brand} • 1C × {row.order.size}</div>
                          <div className="text-[10px] font-bold text-rose-700">Grade: {row.order.grade || 'IS-694'} • Drum Size: N/A (Cartons)</div>
                          {row.isInsulationDone ? (
                            <div className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-[9.5px] font-black">
                              ✅ Insulation Done — Attached to Carton Stock
                            </div>
                          ) : (
                            <div className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[9.5px] font-bold">
                              ⏳ Pending Final Stage (IS-694 Insulation)
                            </div>
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100">
                          <div className="font-mono font-bold text-slate-800">{row.order.conductor}</div>
                          <div className="text-[10px] text-teal-800 font-bold">OD: {row.order.core_od} mm ({row.order.ins_compound})</div>
                        </td>
                        <td className="p-2 border-r border-slate-100">
                          <select
                            value={row.standard}
                            onChange={e =>
                              handleUpdateIs694OrderCarton(row, {
                                standard: e.target.value as Is694CartonStandardKey,
                              })
                            }
                            className="px-2 py-1 text-[11px] font-bold border border-rose-300 rounded bg-white text-slate-900"
                          >
                            <option value="VIHAN_OPTO">VIHAN OPTO</option>
                            <option value="TRIGUARD_BOX">TRIGUARD BOX</option>
                            <option value="TRIGUARD_STACK">TRIGUARD STACK</option>
                            <option value="MARU_MIRACLE">MARU MIRACLE</option>
                            <option value="CUSTOM">CUSTOM</option>
                          </select>
                        </td>
                        <td className="p-2 border-r border-slate-100">
                          <select
                            value={row.mode}
                            onChange={e =>
                              handleUpdateIs694OrderCarton(row, {
                                mode: e.target.value as Is694CartonMode,
                              })
                            }
                            className={`px-2 py-1 text-[11px] font-extrabold border rounded ${
                              row.mode === 'MIX'
                                ? 'bg-amber-100 text-amber-950 border-amber-400'
                                : 'bg-rose-50 text-rose-950 border-rose-300'
                            }`}
                          >
                            <option value="INDIVIDUAL">COLOUR-WISE INDIVIDUAL CARTON</option>
                            <option value="MIX">MIX COLOUR CARTON (RD+BK+BL+YL+GR)</option>
                          </select>
                        </td>
                        <td className="p-2 border-r border-slate-100 text-center">
                          <select
                            value={row.coilType}
                            onChange={e =>
                              handleUpdateIs694OrderCarton(row, {
                                coilType: e.target.value,
                              })
                            }
                            className="px-1.5 py-1 text-[11px] font-bold border border-slate-300 rounded bg-white text-slate-900"
                          >
                            <option value="90 MTR">90 MTR</option>
                            <option value="45 MTR">45 MTR</option>
                            <option value="180 MTR">180 MTR</option>
                            <option value="100 MTR">100 MTR</option>
                            <option value="100 YARD">100 YARD</option>
                          </select>
                        </td>
                        <td className="p-2 border-r border-slate-100 text-center bg-amber-50/40">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={row.coilsPerCarton}
                            onChange={e =>
                              handleUpdateIs694OrderCarton(row, {
                                coilsPerCarton: parseFloat(e.target.value) || 1,
                              })
                            }
                            className="w-14 px-1.5 py-1 text-xs font-black text-center border border-amber-400 rounded bg-white text-slate-900"
                            title="Editable Coils per Master Carton"
                          />
                        </td>
                        <td className="p-2 border-r border-slate-100 text-center bg-amber-50/30">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.totalCoils}
                            onChange={e =>
                              handleUpdateIs694OrderCarton(row, {
                                totalCoils: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-16 px-1.5 py-1 text-xs font-black text-center border border-amber-400 rounded bg-white text-slate-900"
                            title="Editable No. of Coils for this IS-694 Packing List row"
                          />
                          <div className="text-[9.5px] font-bold text-slate-600 mt-0.5">
                            {row.totalCoils} Coils
                          </div>
                        </td>
                        <td className="p-2 border-r border-slate-100 text-center bg-amber-100/40">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={row.totalCartons}
                            onChange={e =>
                              handleUpdateIs694OrderCarton(row, {
                                cartonCount: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-16 px-1.5 py-1 text-xs font-black text-center border-2 border-rose-500 rounded bg-white text-rose-950"
                            title="Editable Master Carton Count (auto-updates No. of Coils & Order Sheet balance)"
                          />
                          <div className="text-[9.5px] font-black text-rose-900 mt-0.5">
                            {row.mode === 'MIX' ? `${row.totalCartons} Mix Ctns` : `${row.totalCartons} Cartons`}
                          </div>
                          <div className="mt-1">
                            <input
                              type="text"
                              value={row.cartonIdsLabel || ''}
                              onChange={e =>
                                handleUpdateIs694OrderCarton(row, {
                                  cartonIds: e.target.value,
                                })
                              }
                              placeholder="Carton IDs (CTN-01..)"
                              className="w-28 px-1 py-0.5 text-[10px] font-bold text-center border border-amber-400 rounded bg-white text-amber-950"
                              title="Carton IDs / Serial Nos (Synced automatically from IS-694 Process Card Operator Production Log)"
                            />
                          </div>
                        </td>
                        <td className="p-2 border-r border-slate-100">
                          {row.operatorLogs.length > 0 && (
                            <div className="mb-1 flex items-center gap-1 flex-wrap">
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-950 border border-emerald-400 text-[9.5px] font-black">
                                ⚡ Operator Log Synced ({row.operatorLogs.length} Row{row.operatorLogs.length > 1 ? 's' : ''}: {row.operatorLoggedCoils} Coils / {row.operatorLoggedCartons} Ctns)
                              </span>
                              {row.cartonIdsLabel && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-950 border border-amber-400 text-[9.5px] font-black">
                                  🏷️ Carton IDs: {row.cartonIdsLabel}
                                </span>
                              )}
                            </div>
                          )}
                          {row.mode === 'MIX' ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-black text-amber-950 bg-amber-100 px-2 py-0.5 rounded border border-amber-400">
                                  📦 MIX: No. of Coils = {row.totalCoils} Coils ({row.totalCartons} Mix Cartons × {row.coilsPerCarton}/Ctn)
                                </span>
                                <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-300">
                                  1 Mix Ctn = {formatMixBreakdownLabel(row.mixPerCarton)}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {row.colourDetails.map(cd => (
                                  <span
                                    key={cd.colour}
                                    className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-950 border border-rose-300 text-[10px] font-black"
                                  >
                                    {cd.colour}: {cd.coils} Coils
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="text-[10px] font-black text-rose-900 uppercase">
                                🎨 Colour-Wise Coils &amp; Cartons List:
                              </div>
                              <div className="flex flex-col gap-1">
                                {row.colourDetails.map(cd => (
                                  <div
                                    key={cd.colour}
                                    className="inline-flex items-center justify-between gap-2 px-2 py-0.5 rounded bg-rose-50 text-rose-950 border border-rose-200 text-[10px] font-black"
                                  >
                                    <span>🎨 {cd.colour}: <strong>{cd.coils} Coils</strong></span>
                                    <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-950 border border-amber-300">
                                      📦 {cd.cartons} Cartons ({row.coilsPerCarton} Coils/Ctn)
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-center bg-emerald-50/30">
                          {row.mode === 'MIX' ? (
                            <div className="space-y-1">
                              <div className="px-2 py-0.5 rounded bg-amber-100 text-amber-950 border border-amber-400 text-[10px] font-black">
                                📦 Mix Carton Stock: {row.availableCartonStock} Mix Ctns
                              </div>
                              <div className="text-[9.5px] font-bold text-slate-700">
                                No. of Coils: <strong>{row.totalCoils} Coils</strong>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-950 border border-emerald-300 text-[10px] font-black">
                                📦 Carton Stock: {row.availableCartonStock} Ctns
                              </div>
                              <div className="text-[9.5px] font-bold text-slate-700">
                                ({row.totalCoils} Coils)
                              </div>
                            </div>
                          )}
                          <div className="mt-1 no-print">
                            <button
                              type="button"
                              onClick={() => handleToggleIs694CartonDispatch(row)}
                              className={`px-2 py-0.5 rounded text-[9.5px] font-extrabold border cursor-pointer transition-colors ${
                                row.isDispatched
                                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700'
                              }`}
                              title={
                                row.isDispatched
                                  ? 'Undo Carton Dispatch and restore Carton Stock'
                                  : 'Dispatch Cartons and deduct from Finished Carton Stock'
                              }
                            >
                              {row.isDispatched ? '↩ Restore Stock' : '🚚 Dispatch Cartons'}
                            </button>
                          </div>
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-black text-slate-900">
                          {row.orderLengthM.toLocaleString()} m
                        </td>
                        <td className="p-2 text-right">
                          <div className="font-bold text-slate-800">Net: {row.netWireWtKg.toFixed(2)} kg</div>
                          <div className="text-[10px] font-black text-emerald-800">
                            Gross: {row.grossPackingWtKg.toFixed(2)} kg
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {is694PackingRows.length > 0 && (
                <tfoot className="bg-rose-50 font-black text-rose-950 border-t-2 border-rose-300">
                  <tr>
                    <td colSpan={9} className="p-2 text-right uppercase border-r border-rose-200">
                      TOTAL IS-694 INDIVIDUAL PACKING LIST SUMMARY:
                    </td>
                    <td className="p-2 text-center border-r border-rose-200 bg-amber-50">
                      {is694PackingRows.reduce((s, r) => s + r.totalCoils, 0)} Coils
                    </td>
                    <td className="p-2 text-center border-r border-rose-200 bg-amber-100/70">
                      {is694PackingRows.reduce((s, r) => s + r.totalCartons, 0).toFixed(2).replace(/\.00$/, '')} Cartons
                    </td>
                    <td className="p-2 border-r border-rose-200 text-left text-[10px] text-rose-800">
                      Colour-Wise Coils &amp; Cartons + Mix Carton Stock
                    </td>
                    <td className="p-2 text-center border-r border-rose-200 bg-emerald-100/60 text-emerald-950">
                      {is694PackingRows.reduce((s, r) => s + r.availableCartonStock, 0).toFixed(2).replace(/\.00$/, '')} Ctns in Stock
                    </td>
                    <td className="p-2 text-right border-r border-rose-200">
                      {is694PackingRows.reduce((s, r) => s + r.orderLengthM, 0).toLocaleString()} m
                    </td>
                    <td className="p-2 text-right text-emerald-900">
                      {is694PackingRows.reduce((s, r) => s + r.grossPackingWtKg, 0).toFixed(2)} kg
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* 2. Dedicated Colour-Wise Coils & Cartons Breakdown List + Mix Coils & Mix Carton Stock Sub-Tables */}
          {is694PackingRows.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
              {/* Sub-Table A: Colour-Wise Coils and Cartons List */}
              <div className="border border-rose-300 rounded-lg overflow-hidden bg-rose-50/20">
                <div className="bg-rose-800 text-white px-3 py-2 font-black text-xs uppercase flex items-center justify-between">
                  <span>🎨 1. IS-694 Colour-Wise Coils &amp; Cartons List</span>
                  <span className="text-[10px] bg-rose-950 px-2 py-0.5 rounded text-rose-100">
                    {totalIndCoils} Coils • {totalIndCartons.toFixed(2).replace(/\.00$/, '')} Cartons
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left whitespace-nowrap">
                    <thead className="bg-rose-100 text-rose-950 font-extrabold uppercase text-[10px] border-b border-rose-200">
                      <tr>
                        <th className="p-2 border-r border-rose-200">Job No</th>
                        <th className="p-2 border-r border-rose-200">Brand &amp; Size (1C)</th>
                        <th className="p-2 border-r border-rose-200">Insulation Colour</th>
                        <th className="p-2 border-r border-rose-200 text-center">Coils (Colour-Wise)</th>
                        <th className="p-2 border-r border-rose-200 text-center">Coils / Ctn</th>
                        <th className="p-2 border-r border-rose-200 text-center">Cartons (Colour-Wise)</th>
                        <th className="p-2 border-r border-rose-200 text-right">Length (m)</th>
                        <th className="p-2 text-center">Carton Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rose-100 bg-white">
                      {is694IndividualModeRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-3 text-center text-slate-500 text-[11px]">
                            No Individual Colour-Wise IS-694 orders in current selection.
                          </td>
                        </tr>
                      ) : (
                        is694IndividualModeRows.flatMap(row =>
                          row.colourDetails.map((cd, cIdx) => (
                            <tr key={`${row.rowId}-col-${cd.colour}-${cIdx}`} className="hover:bg-rose-50/50">
                              <td className="p-2 border-r border-slate-100 font-black text-slate-900">
                                {row.order.batch}
                                {row.isPartialPlan && (
                                  <span className="ml-1 text-[9px] px-1 py-0.2 rounded bg-indigo-100 text-indigo-900 font-bold">
                                    {row.lotLabel}
                                  </span>
                                )}
                              </td>
                              <td className="p-2 border-r border-slate-100 font-bold text-rose-950">
                                {row.order.brand} • 1C × {row.order.size}
                              </td>
                              <td className="p-2 border-r border-slate-100">
                                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-950 border border-rose-300 font-black text-[10.5px]">
                                  🎨 {cd.colour}
                                </span>
                              </td>
                              <td className="p-2 border-r border-slate-100 text-center font-black text-slate-900">
                                {cd.coils} Coils ({row.coilType})
                              </td>
                              <td className="p-2 border-r border-slate-100 text-center font-bold text-slate-700">
                                {row.coilsPerCarton}
                              </td>
                              <td className="p-2 border-r border-slate-100 text-center font-black text-rose-900 bg-amber-50/60">
                                {cd.cartons} Cartons
                                {cd.looseCoils > 0 && (
                                  <span className="block text-[9px] text-amber-800">
                                    ({cd.fullCartons} Full + {cd.looseCoils} Loose)
                                  </span>
                                )}
                              </td>
                              <td className="p-2 border-r border-slate-100 text-right font-bold">
                                {cd.lengthM.toLocaleString()} m
                              </td>
                              <td className="p-2 text-center">
                                {row.isDispatched ? (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[9.5px] font-bold">
                                    Dispatched
                                  </span>
                                ) : row.isInsulationDone ? (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-[9.5px] font-black">
                                    ✅ {cd.cartons} Ctns in Stock
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[9.5px] font-bold">
                                    ⏳ Pending Insulation
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Sub-Table B: Mix Colour — No. of Coils & Mix Carton Stock */}
              <div className="border border-amber-400 rounded-lg overflow-hidden bg-amber-50/20">
                <div className="bg-amber-600 text-slate-950 px-3 py-2 font-black text-xs uppercase flex items-center justify-between">
                  <span>📦 2. IS-694 Mix Colour — No. of Coils &amp; Mix Carton Stock</span>
                  <span className="text-[10px] bg-amber-950 text-amber-100 px-2 py-0.5 rounded font-extrabold">
                    No. of Coils: {totalMixCoils} • Mix Carton Stock: {totalMixStockCartons.toFixed(2).replace(/\.00$/, '')} Ctns
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left whitespace-nowrap">
                    <thead className="bg-amber-100 text-amber-950 font-extrabold uppercase text-[10px] border-b border-amber-300">
                      <tr>
                        <th className="p-2 border-r border-amber-200">Job No</th>
                        <th className="p-2 border-r border-amber-200">Brand &amp; Size (1C)</th>
                        <th className="p-2 border-r border-amber-200">Mix C/S Pattern / Carton</th>
                        <th className="p-2 border-r border-amber-200 text-center bg-amber-200/70">No. of Coils (Total)</th>
                        <th className="p-2 border-r border-amber-200">Colour Coils in Mix</th>
                        <th className="p-2 border-r border-amber-200 text-center">Planned Mix Cartons</th>
                        <th className="p-2 text-center bg-emerald-100 text-emerald-950">Mix Carton Stock (Available)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100 bg-white">
                      {is694MixModeRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-3 text-center text-slate-500 text-[11px]">
                            No Mix Colour IS-694 orders in current selection. Select <strong>MIX</strong> in Order Placement or switch Mode to <strong>MIX COLOUR CARTON</strong> above.
                          </td>
                        </tr>
                      ) : (
                        is694MixModeRows.map(row => (
                          <tr key={`${row.rowId}-mix`} className="hover:bg-amber-50/40">
                            <td className="p-2 border-r border-slate-100 font-black text-slate-900">
                              {row.order.batch}
                              {row.isPartialPlan && (
                                <span className="ml-1 text-[9px] px-1 py-0.2 rounded bg-indigo-100 text-indigo-900 font-bold">
                                  {row.lotLabel}
                                </span>
                              )}
                            </td>
                            <td className="p-2 border-r border-slate-100 font-bold text-rose-950">
                              {row.order.brand} • 1C × {row.order.size}
                            </td>
                            <td className="p-2 border-r border-slate-100">
                              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-950 border border-amber-300 font-black text-[10px]">
                                1 Ctn = {formatMixBreakdownLabel(row.mixPerCarton)} ({row.coilsPerCarton} Coils)
                              </span>
                            </td>
                            <td className="p-2 border-r border-slate-100 text-center font-black text-amber-950 bg-amber-50">
                              {row.totalCoils} Coils
                            </td>
                            <td className="p-2 border-r border-slate-100">
                              <div className="flex flex-wrap gap-1">
                                {row.colourDetails.map(cd => (
                                  <span
                                    key={cd.colour}
                                    className="px-1.5 py-0.2 rounded bg-rose-50 text-rose-900 border border-rose-200 text-[9.5px] font-extrabold"
                                  >
                                    {cd.colour}: {cd.coils}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-2 border-r border-slate-100 text-center font-black text-slate-900">
                              {row.totalCartons} Mix Cartons
                            </td>
                            <td className="p-2 text-center bg-emerald-50/40">
                              {row.isDispatched ? (
                                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                                  0 Mix Ctns (Dispatched)
                                </span>
                              ) : row.isInsulationDone ? (
                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-950 border border-emerald-400 text-[10px] font-black">
                                  ✅ {row.availableCartonStock} Mix Cartons in Stock ({row.totalCoils} Coils)
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-300 text-[10px] font-bold">
                                  ⏳ Pending Insulation ({row.totalCartons} Mix Ctns)
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Optional Preview of Master Carton Reference Tables (Primary storage is in Tab 12: Backup) */}
          {showIs694MasterTables && (
            <div className="pt-2">
              <Is694CartonMasterTables
                vihanRules={vihanRules}
                maruRules={maruRules}
                onUpdateVihanRules={next => {
                  setVihanRules(next);
                  saveVihanTriguardCartonRules(next);
                }}
                onUpdateMaruRules={next => {
                  setMaruRules(next);
                  saveMaruMiracleCartonRules(next);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Standard Drum / Reel Packing List Table (Shown ONLY when Drum Packing List view is active) */}
      {packingSectionMode === 'drum_only' && (
      <div className="space-y-3">
        {/* Packing List Reels QR Code Quick-Scanner Bar */}
        {packingReelQrItems.length > 0 && (
          <div className="bg-indigo-950 text-white border border-indigo-800 rounded-xl p-3 shadow-xs space-y-2 no-print">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-indigo-600 rounded-lg">
                  <QrCode className="w-4 h-4 text-white" />
                </span>
                <div>
                  <div className="text-xs font-black tracking-wide uppercase flex items-center gap-2">
                    <span>Packing List Reel QR Codes — Scan for Reel Order Details</span>
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full text-[10px] font-extrabold">
                      {packingReelQrItems.length} Unique Reel QR Code(s)
                    </span>
                  </div>
                  <div className="text-[11px] text-indigo-200">
                    Click any reel below (or in the table) to open its unique QR code encoding complete order details (Batch, Brand, Cable Size, Conductor, Compounds, Spool/Pallet, Length &amp; Weights).
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-1">
              {packingReelQrItems.map(qrItem => (
                <button
                  key={qrItem.id}
                  type="button"
                  onClick={() =>
                    setActivePackingQrState({
                      reel: qrItem,
                      siblings: packingReelQrItems,
                    })
                  }
                  className="px-2.5 py-1 bg-slate-900 hover:bg-indigo-600 text-white border border-indigo-500/50 rounded-lg text-[11px] font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  title={`Click to view QR Code & Order Details for Reel ${qrItem.drumNo}`}
                >
                  <QrCode className="w-3 h-3 text-amber-400 shrink-0" />
                  <span className="text-amber-200">{qrItem.drumNo}</span>
                  <span className="text-[9.5px] text-indigo-300 font-sans">
                    ({qrItem.record.sizeCores} • {qrItem.reelLengthM}m)
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs text-left whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
            <tr>
              <th className="p-2 border-r border-slate-200">#</th>
              <th className="p-2 border-r border-slate-200">Batch / Job Order</th>
              <th className="p-2 border-r border-slate-200">Brand & Grade</th>
              <th className="p-2 border-r border-slate-200">Cable Size & Cores</th>
              <th className="p-2 border-r border-slate-200">Drum / Spool Size</th>
              <th className="p-2 border-r border-slate-200">Drum / Reel Serial No</th>
              <th className="p-2 border-r border-slate-200 text-center bg-indigo-50 text-indigo-950 no-print">
                Reel Order QR
              </th>
              <th className="p-2 border-r border-slate-200 text-right">Length (m)</th>
              <th className="p-2 border-r border-slate-200 text-right">Copper Wt (kg)</th>
              <th className="p-2 border-r border-slate-200 text-right">Compound Wt (kg)</th>
              <th className="p-2 border-r border-slate-200 text-right bg-slate-50">
                Total Reel Wt (kg)
              </th>
              <th className="p-2 border-r border-slate-200">Pallet Size</th>
              <th className="p-2 text-center">Dispatch & Stock Deduction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={13} className="p-6 text-center text-slate-400">
                  No packing items found. (Orders appear here automatically when Sheathing is marked complete, or click &ldquo;Extract from Order Sheet&rdquo; above).
                </td>
              </tr>
            ) : (
              filteredRows.map((r, idx) => {
                const act =
                  typeof r.actualWt === 'number'
                    ? r.actualWt
                    : parseFloat(String(r.actualWt)) || r.calcTotalWt;
                const diff = act - r.calcTotalWt;
                const diffColor = Math.abs(diff) > 5 ? 'text-red-600' : 'text-green-700';
                const netCableWt = r.cuWt + r.compWt;
                const qrItem = packingReelQrItems[idx];

                return (
                  <tr
                    key={r.key}
                    className={
                      r.isDispatched
                        ? 'bg-emerald-50/40 text-slate-600'
                        : 'hover:bg-slate-50'
                    }
                  >
                    <td className="p-2 border-r border-slate-100">{idx + 1}</td>
                    <td className="p-2 border-r border-slate-100 font-bold">{r.batch}</td>
                    <td className="p-2 border-r border-slate-100">{r.brandGrade}</td>
                    <td className="p-2 border-r border-slate-100 font-bold">{r.sizeCores}</td>
                    <td className="p-2 border-r border-slate-100 font-semibold">{r.spool}</td>
                    <td className="p-2 border-r border-slate-100">
                      <button
                        type="button"
                        onClick={() =>
                          qrItem &&
                          setActivePackingQrState({
                            reel: qrItem,
                            siblings: packingReelQrItems,
                          })
                        }
                        className="font-mono text-[11px] text-blue-700 hover:text-indigo-900 font-bold inline-flex items-center gap-1.5 hover:underline cursor-pointer"
                        title={`Click to open QR Code & Order Details for Reel ${r.drumNo}`}
                      >
                        <QrCode className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>{r.drumNo}</span>
                      </button>
                    </td>
                    <td className="p-2 border-r border-slate-100 text-center bg-indigo-50/30 no-print">
                      <button
                        type="button"
                        onClick={() =>
                          qrItem &&
                          setActivePackingQrState({
                            reel: qrItem,
                            siblings: packingReelQrItems,
                          })
                        }
                        className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[10.5px] font-extrabold inline-flex items-center gap-1 shadow-2xs cursor-pointer transition-colors"
                        title={`Generate & Scan QR Code showing Order Details for Reel ${r.drumNo}`}
                      >
                        <QrCode className="w-3 h-3" />
                        <span>Reel QR</span>
                      </button>
                    </td>
                    <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-900">
                      {r.len.toLocaleString()} m
                    </td>
                    <td className="p-2 border-r border-slate-100 text-right">
                      {r.cuWt.toFixed(2)} kg
                    </td>
                    <td className="p-2 border-r border-slate-100 text-right">
                      {r.compWt.toFixed(2)} kg
                    </td>
                    <td className="p-2 border-r border-slate-100 text-right bg-slate-50/50">
                      <div className="text-[10px] text-slate-500">
                        Calc: <strong>{r.calcTotalWt.toFixed(2)} kg</strong>
                      </div>
                      {!r.isManual && r.orderId && (
                        <div className="flex items-center justify-end gap-1 mt-0.5 no-print">
                          <span className="text-[10px] text-slate-500">Tare:</span>
                          <input
                            type="number"
                            step="0.5"
                            value={r.tareWt}
                            onChange={e => {
                              const o = orders.find(x => x.id === r.orderId);
                              if (o)
                                onUpdateOrder({
                                  ...o,
                                  tare_weight: parseFloat(e.target.value) || 0,
                                });
                            }}
                            className="w-12 px-1 py-0.5 border border-slate-300 rounded text-right text-[11px]"
                            title="Empty Drum Tare Weight"
                          />
                          <span className="text-[10px] text-slate-500 ml-1">Actual:</span>
                          <input
                            type="number"
                            step="0.5"
                            value={r.actualWt}
                            onChange={e => {
                              const o = orders.find(x => x.id === r.orderId);
                              if (o)
                                onUpdateOrder({
                                  ...o,
                                  actual_weight: e.target.value,
                                });
                            }}
                            placeholder={r.calcTotalWt.toFixed(1)}
                            className="w-16 px-1 py-0.5 border border-amber-300 rounded font-bold text-right text-[11px] bg-amber-50"
                            title="Actual weighed weight"
                          />
                        </div>
                      )}
                      <div className={`text-[10px] font-bold ${diffColor} mt-0.5`}>
                        Diff: {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)} kg
                      </div>
                    </td>
                    <td className="p-2 border-r border-slate-100">{r.pallet}</td>
                    <td className="p-2 text-center">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.isDispatched
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {r.status}
                        </span>

                        {!r.isDispatched ? (
                          <div className="flex items-center gap-1 no-print">
                            <button
                              type="button"
                              onClick={() => {
                                if (onDispatchReel) {
                                  onDispatchReel({
                                    isManual: r.isManual,
                                    manualIdx: r.manualIdx,
                                    orderId: r.orderId,
                                    batch: r.rawBatch,
                                    sizeCores: r.sizeCores,
                                    drumNo: r.drumNo,
                                    len: r.len,
                                    cableWt: netCableWt,
                                  });
                                } else {
                                  onDispatchBatch(r.rawBatch, r.sizeCores);
                                }
                              }}
                              className="text-[11px] px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold flex items-center gap-1 shadow-2xs transition-colors"
                              title="Dispatch this reel & auto-deduct finished stock"
                            >
                              <Truck className="w-3 h-3" /> Dispatch Reel
                            </button>

                            <button
                              type="button"
                              onClick={() => onDispatchBatch(r.rawBatch, r.sizeCores)}
                              className="text-[10px] px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded font-bold border border-blue-200"
                              title="Dispatch entire batch/size & deduct finished stock"
                            >
                              Batch
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (onRevertDispatchReel) {
                                onRevertDispatchReel({
                                  isManual: r.isManual,
                                  manualIdx: r.manualIdx,
                                  orderId: r.orderId,
                                  drumNo: r.drumNo,
                                  len: r.len,
                                  cableWt: netCableWt,
                                });
                              }
                            }}
                            className="text-[10px] px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded font-bold flex items-center gap-1 no-print"
                            title="Undo dispatch and restore finished stock"
                          >
                            <RotateCcw className="w-3 h-3" /> Undo
                          </button>
                        )}

                        {r.isManual && (
                          <button
                            type="button"
                            onClick={() =>
                              r.manualIdx !== undefined && onDeleteManualItem(r.manualIdx)
                            }
                            className="p-1 hover:bg-red-50 text-red-600 rounded no-print"
                            title="Delete manual item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      </div>
      )}

      {/* Manual Reel Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-slate-800">
            <h3 className="text-base font-bold text-slate-900 mb-3">Add Manual Packing Reel</h3>
            <form onSubmit={handleCreateManualItem} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Batch / Job Order *
                </label>
                <input
                  type="text"
                  value={modalBatch}
                  onChange={e => setModalBatch(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Brand & Grade
                </label>
                <input
                  type="text"
                  value={modalBrandGrade}
                  onChange={e => setModalBrandGrade(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                  placeholder="EKP H07RN-F"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Cable Size & Cores
                </label>
                <input
                  type="text"
                  value={modalSizeCores}
                  onChange={e => setModalSizeCores(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                  placeholder="3C × 2.50 SQ MM"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                    Drum Size
                  </label>
                  <input
                    type="text"
                    value={modalSpool}
                    onChange={e => setModalSpool(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                    placeholder="42 x 12 x 20"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                    Drum Serial No
                  </label>
                  <input
                    type="text"
                    value={modalDrumNo}
                    onChange={e => setModalDrumNo(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                    placeholder="07/163-EKP-2.5-D1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                    Length (m)
                  </label>
                  <input
                    type="number"
                    value={modalLen}
                    onChange={e => setModalLen(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                    Cu Wt (kg)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={modalCuWt}
                    onChange={e => setModalCuWt(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                    Compound Wt
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={modalCompWt}
                    onChange={e => setModalCompWt(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold"
                >
                  Save Reel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Extract Modal */}
      {isExtractModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-slate-800">
            <h3 className="text-base font-bold text-slate-900 mb-2">
              Extract / Import from Order Sheet
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Select a specific Batch / Job Order and Size to extract reels into the packing list, or leave blank to import all.
            </p>
            <form onSubmit={handleExtractSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                  Job No / Batch
                </label>
                <select
                  value={extractBatch}
                  onChange={e => setExtractBatch(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white font-semibold"
                >
                  <option value="">All Batches</option>
                  {uniqueBatches.map(b => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                  Cable Size
                </label>
                <select
                  value={extractSize}
                  onChange={e => setExtractSize(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white font-semibold"
                >
                  <option value="">All Sizes</option>
                  {uniqueSizes.map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsExtractModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded font-bold"
                >
                  Extract Now
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Packing List Reel QR Code & Order Details Modal */}
      <ReelQrCodeModal
        reel={activePackingQrState?.reel || null}
        siblingReels={activePackingQrState?.siblings || []}
        onSelectReel={nextReel =>
          setActivePackingQrState(prev =>
            prev ? { ...prev, reel: nextReel } : { reel: nextReel, siblings: [nextReel] }
          )
        }
        onClose={() => setActivePackingQrState(null)}
      />
    </div>
  );
};
