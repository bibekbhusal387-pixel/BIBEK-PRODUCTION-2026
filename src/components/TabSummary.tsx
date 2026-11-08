import React, { useState, useMemo } from 'react';
import {
  CableOrder,
  DensitySettings,
  LadiDimensionRule,
  PackagingRule,
  SizePackagingRule,
} from '../types/cable';
import {
  computeRecordRow,
  evaluateSpoolSizeForOrder,
  exportCsvFile,
  isIs694Order,
  isOrderBunched,
  isOrderComplete,
  isOrderDrumCompleted,
  isOrderInsulated,
  isOrderSheathed,
} from '../utils/calculations';
import {
  computeIs694CartonPackingForOrder,
  loadMaruMiracleCartonRules,
  loadVihanTriguardCartonRules,
} from '../utils/is694CartonPackaging';
import {
  BarChart3,
  Printer,
  Table,
  Layers,
  Search,
  Filter,
  Download,
  CheckCircle2,
  Clock,
  Package,
  Layers2,
  FileSpreadsheet,
  FileDown,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface TabSummaryProps {
  orders: CableOrder[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
}

export const TabSummary: React.FC<TabSummaryProps> = ({
  orders,
  densities,
  ladiDimensions,
  sizeRules,
  packagingRules,
}) => {
  // State for view mode: 'master' (Single Unified Table) vs 'split' (4 Separate Tables)
  const [viewMode, setViewMode] = useState<'master' | 'split'>('master');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBatch, setSelectedBatch] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'ACTIVE' | 'DONE'>('ALL');

  // Unique batches for filter dropdown
  const batchList = useMemo(() => {
    const set = new Set<string>();
    orders.forEach(o => {
      if (o.batch) set.add(o.batch);
    });
    return Array.from(set).sort();
  }, [orders]);

  const vihanRules = useMemo(() => loadVihanTriguardCartonRules(), []);
  const maruRules = useMemo(() => loadMaruMiracleCartonRules(), []);

  // Compute computed rows for all orders
  const computedOrders = useMemo(() => {
    return orders.map((o, idx) => {
      const r = computeRecordRow(o, densities, ladiDimensions);
      const grade = o.grade || 'H05VV-F';
      const cond = o.conductor || '';
      const complete = isOrderComplete(o, ladiDimensions);
      const is694 = isIs694Order(o);
      const hasCoils = o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0;
      const isCoilOrCarton = is694 || hasCoils;

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
      const pkgText = evalPkg.packaging || '1000m / Drum';
      const mLenMatch = pkgText.match(/[0-9]+/);
      const drumLen = mLenMatch ? parseFloat(mLenMatch[0]) : 1000;
      const spoolCount = isCoilOrCarton ? 0 : (drumLen > 0 ? Math.ceil(r.orderLen / drumLen) : 1);

      const is694CartonRow = is694
        ? computeIs694CartonPackingForOrder(o, densities, ladiDimensions, vihanRules, maruRules)
        : null;
      const coilsCount = is694CartonRow ? is694CartonRow.totalCoils : Number(o.coils || 0);
      const cartonsCount = is694CartonRow ? is694CartonRow.totalCartons : (Number(o.carton_count) || 0);
      const coilType = is694CartonRow ? is694CartonRow.coilType : (o.coil_type || '100 YARD');

      const totalCompound = (r.reqIns || 0) + (r.reqSheath || 0);
      const totalCableWt = (r.reqCu || 0) + totalCompound;

      const drumSizeLabel = is694
        ? 'N/A (Carton Pack)'
        : hasCoils
        ? 'N/A (Coils Pack)'
        : (evalPkg.spool || 'N/A');
      const palletSizeLabel = is694
        ? (cartonsCount > 0 ? `${cartonsCount} Cartons (${coilsCount} Coils)` : 'Carton Pack')
        : hasCoils
        ? 'N/A (Coils Pack)'
        : (evalPkg.pallet || 'N/A');
      const pkgStandardLabel = is694
        ? `${coilsCount} Coils × ${coilType || '90 MTR'} (${cartonsCount} Cartons)`
        : hasCoils
        ? `${coilsCount} Coils × ${coilType || '100 YARD'}`
        : (evalPkg.packaging || '1000m / Drum');

      const isBunched = isOrderBunched(o);
      const isIns = isOrderInsulated(o);
      const isSheath = isOrderSheathed(o);
      const isDrumDone = isOrderDrumCompleted(o, ladiDimensions);

      const reqCu = r.reqCu || 0;
      const cuBunched = isBunched ? reqCu : 0;
      const cuToBunch = isBunched ? 0 : reqCu;

      const reqIns = r.reqIns || 0;
      const insDeducted = isIns ? reqIns : 0;
      const insToProcess = isIns ? 0 : reqIns;

      const reqSheath = is694 ? 0 : (r.reqSheath || 0);
      const sheathDeducted = isSheath ? reqSheath : 0;
      const sheathToProcess = isSheath ? 0 : reqSheath;

      const compoundDeducted = insDeducted + sheathDeducted;
      const compoundToProcess = insToProcess + sheathToProcess;

      const drumsDeducted = isDrumDone ? spoolCount : 0;
      const drumsToProcess = isDrumDone ? 0 : spoolCount;

      return {
        id: o.id || idx + 1,
        order: o,
        computed: r,
        is694,
        is694CartonRow,
        coilsCount,
        cartonsCount,
        coilType,
        batch: o.batch || '-',
        brand: o.brand || '-',
        grade,
        conductor: cond,
        size: o.size,
        cores: o.cores,
        orderLen: r.orderLen || 0,
        coreLen: r.reqCoreLen || 0,
        reqCu,
        isBunched,
        cuBunched,
        cuToBunch,
        isIns,
        insDeducted,
        insToProcess,
        isSheath,
        sheathDeducted,
        sheathToProcess,
        compoundDeducted,
        compoundToProcess,
        isDrumDone,
        drumsDeducted,
        drumsToProcess,
        insCompound: o.ins_compound || '-',
        reqIns,
        sheathCompound: is694 ? 'N/A (Unsheathed 1C)' : (o.sheath_compound || '-'),
        sheathColour: is694 ? '' : (o.sheath_colour || ''),
        reqSheath,
        totalCompound,
        totalCableWt,
        drumSize: drumSizeLabel,
        palletSize: palletSizeLabel,
        pkgStandard: pkgStandardLabel,
        spoolCount,
        complete,
        pStatus: o.pStatus,
      };
    });
  }, [orders, densities, ladiDimensions, sizeRules, packagingRules, vihanRules, maruRules]);

  // Filtered computed rows for the Master Table
  const filteredRows = useMemo(() => {
    return computedOrders.filter(row => {
      if (selectedBatch !== 'ALL' && row.batch !== selectedBatch) return false;
      if (selectedStatus === 'ACTIVE' && row.complete) return false;
      if (selectedStatus === 'DONE' && !row.complete) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match =
          row.batch.toLowerCase().includes(q) ||
          row.brand.toLowerCase().includes(q) ||
          row.grade.toLowerCase().includes(q) ||
          row.size.toLowerCase().includes(q) ||
          row.conductor.toLowerCase().includes(q) ||
          row.insCompound.toLowerCase().includes(q) ||
          row.sheathCompound.toLowerCase().includes(q) ||
          row.drumSize.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [computedOrders, selectedBatch, selectedStatus, searchQuery]);

  // Separate filtered rows for IS-694 vs Multi-Core / Drum Orders
  const is694FilteredRows = useMemo(() => filteredRows.filter(r => r.is694), [filteredRows]);

  const is694Totals = useMemo(() => {
    return is694FilteredRows.reduce(
      (acc, r) => {
        acc.orderLen += r.orderLen;
        acc.cu += r.reqCu;
        acc.ins += r.reqIns;
        acc.wireWt += r.totalCableWt;
        acc.coils += r.coilsCount;
        acc.cartons += r.cartonsCount;
        acc.grossWt += r.is694CartonRow ? r.is694CartonRow.grossPackingWtKg : r.totalCableWt;
        if (r.complete || r.pStatus?.i) acc.doneCount++;
        return acc;
      },
      { orderLen: 0, cu: 0, ins: 0, wireWt: 0, coils: 0, cartons: 0, grossWt: 0, doneCount: 0 }
    );
  }, [is694FilteredRows]);

  // Totals for Master Table
  const masterTotals = useMemo(() => {
    return filteredRows.reduce(
      (acc, r) => {
        acc.orderLen += r.orderLen;
        if (r.complete) acc.orderLenCompleted += r.orderLen;
        else acc.orderLenPending += r.orderLen;

        acc.coreLen += r.coreLen;
        if (r.isIns) acc.coreLenCompleted += r.coreLen;
        else acc.coreLenPending += r.coreLen;

        acc.cu += r.reqCu;
        acc.cuBunched += r.cuBunched;
        acc.cuToBunch += r.cuToBunch;
        if (r.isBunched) acc.bunchedOrders++;

        acc.ins += r.reqIns;
        acc.insDeducted += r.insDeducted;
        acc.insToProcess += r.insToProcess;
        if (r.isIns) acc.insOrders++;

        acc.sheath += r.reqSheath;
        acc.sheathDeducted += r.sheathDeducted;
        acc.sheathToProcess += r.sheathToProcess;
        if (r.isSheath) acc.sheathOrders++;

        acc.compound += r.totalCompound;
        acc.compoundDeducted += r.compoundDeducted;
        acc.compoundToProcess += r.compoundToProcess;

        acc.cableWt += r.totalCableWt;
        acc.drums += r.spoolCount;
        acc.drumsDeducted += r.drumsDeducted;
        acc.drumsToProcess += r.drumsToProcess;

        acc.cartons += r.cartonsCount;
        acc.coils += r.coilsCount;
        if (r.complete) acc.doneCount++;
        return acc;
      },
      {
        orderLen: 0,
        orderLenCompleted: 0,
        orderLenPending: 0,
        coreLen: 0,
        coreLenCompleted: 0,
        coreLenPending: 0,
        cu: 0,
        cuBunched: 0,
        cuToBunch: 0,
        bunchedOrders: 0,
        ins: 0,
        insDeducted: 0,
        insToProcess: 0,
        insOrders: 0,
        sheath: 0,
        sheathDeducted: 0,
        sheathToProcess: 0,
        sheathOrders: 0,
        compound: 0,
        compoundDeducted: 0,
        compoundToProcess: 0,
        cableWt: 0,
        drums: 0,
        drumsDeducted: 0,
        drumsToProcess: 0,
        cartons: 0,
        coils: 0,
        doneCount: 0,
      }
    );
  }, [filteredRows]);

  // Export Master Unified Summary Sheet CSV
  const handleExportMasterSummary = () => {
    const headers = [
      '#',
      'Batch / Job Order',
      'Status',
      'Brand',
      'Grade',
      'Cable Size & Cores',
      'Conductor / Copper Size',
      'Order Length (m)',
      'Total Core Length (m)',
      'Copper Required (kg)',
      'Insulation Compound',
      'Insulation Req (kg)',
      'Sheath Compound',
      'Sheath Colour',
      'Sheath Req (kg)',
      'Total PVC / Compound (kg)',
      'Total Cable Wt (kg)',
      'Drum / Spool Size',
      'Drums Required (Nos)',
      'Packaging Standard',
      'Pallet Size',
    ];

    const rows = filteredRows.map((r, i) => [
      i + 1,
      r.batch,
      r.complete ? 'Completed' : 'Active',
      r.brand,
      r.grade,
      `${r.cores}C x ${r.size}`,
      r.conductor,
      r.orderLen,
      r.coreLen,
      r.reqCu.toFixed(2),
      r.insCompound,
      r.reqIns.toFixed(2),
      r.sheathCompound,
      r.sheathColour || '-',
      r.reqSheath.toFixed(2),
      r.totalCompound.toFixed(2),
      r.totalCableWt.toFixed(2),
      r.drumSize,
      r.spoolCount,
      r.pkgStandard,
      r.palletSize,
    ]);

    // Summary row
    rows.push([
      'TOTAL',
      `${filteredRows.length} Items`,
      `${masterTotals.doneCount}/${filteredRows.length} Done`,
      '-',
      '-',
      '-',
      '-',
      masterTotals.orderLen,
      masterTotals.coreLen,
      masterTotals.cu.toFixed(2),
      '-',
      masterTotals.ins.toFixed(2),
      '-',
      '-',
      masterTotals.sheath.toFixed(2),
      masterTotals.compound.toFixed(2),
      masterTotals.cableWt.toFixed(2),
      '-',
      masterTotals.drums,
      '-',
      '-',
    ]);

    exportCsvFile('MASTER_PRODUCTION_UNIFIED_SUMMARY_SHEET.csv', [headers, ...rows]);
  };

  const handleDownloadSummaryPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('PLUTUS CABLE PRODUCTION SYSTEM — MASTER PRODUCTION & MATERIAL SUMMARY', 10, 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Batch: ${selectedBatch === 'ALL' ? 'All Batches' : selectedBatch} | Status: ${selectedStatus} | Orders: ${filteredRows.length} | Generated: ${new Date().toLocaleString('en-GB')}`,
      10,
      15
    );

    const headers = [
      '#',
      'Batch',
      'Status',
      'Brand',
      'Grade',
      'Size & Cores',
      'Conductor',
      'Order Len (m)',
      'Core Len (m)',
      'Cu Req (kg)',
      'Ins Comp',
      'Ins Req (kg)',
      'Sheath Comp',
      'Sheath Req (kg)',
      'Total PVC (kg)',
      'Total Wt (kg)',
      'Drum/Pack',
    ];

    const body = filteredRows.map((r, i) => [
      String(i + 1),
      r.batch,
      r.complete ? 'Done' : 'Active',
      r.brand,
      r.grade,
      `${r.cores}C x ${r.size}`,
      r.conductor,
      r.orderLen.toLocaleString(),
      r.coreLen.toLocaleString(),
      r.reqCu.toFixed(2),
      r.insCompound,
      r.reqIns.toFixed(2),
      r.sheathCompound,
      r.reqSheath.toFixed(2),
      r.totalCompound.toFixed(2),
      r.totalCableWt.toFixed(2),
      r.drumSize,
    ]);

    body.push([
      'TOTAL',
      `${filteredRows.length} Items`,
      `${masterTotals.doneCount}/${filteredRows.length} Done`,
      '-',
      '-',
      '-',
      '-',
      masterTotals.orderLen.toLocaleString(),
      masterTotals.coreLen.toLocaleString(),
      masterTotals.cu.toFixed(2),
      '-',
      masterTotals.ins.toFixed(2),
      '-',
      masterTotals.sheath.toFixed(2),
      masterTotals.compound.toFixed(2),
      masterTotals.cableWt.toFixed(2),
      `${masterTotals.drums} Drums`,
    ]);

    autoTable(doc, {
      startY: 18,
      head: [headers],
      body,
      styles: { fontSize: 6.8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 8, right: 8 },
    });

    doc.save(`PLUTUS_Production_Master_Summary_${selectedBatch}.pdf`);
  };

  // -------------------------------------------------------------
  // Data for the 4 decomposed tables (retained in 'split' mode)
  // -------------------------------------------------------------
  const batchPvcMap: Record<string, {
    batch: string;
    brand: string;
    grade: string;
    conductor: string;
    insMap: Record<string, number>;
    sheathMap: Record<string, number>;
    totalIns: number;
    totalSheath: number;
    totalCount: number;
    doneCount: number;
  }> = {};

  const sizeCuMap: Record<string, {
    size: string;
    conductor: string;
    orderLen: number;
    coreLen: number;
    cu: number;
    cuBunched: number;
    cuToBunch: number;
    totalCount: number;
    doneCount: number;
    bunchedCount: number;
  }> = {};

  const sizeDrumMap: Record<string, {
    batch: string;
    grade: string;
    size: string;
    cores: number;
    spool: string;
    totalLen: number;
    totalDrums: number;
    totalCu: number;
    totalIns: number;
    totalSheath: number;
    totalCount: number;
    doneCount: number;
  }> = {};

  const jobDrumMap: Record<string, {
    batch: string;
    brand: string;
    grade: string;
    size: string;
    cores: number;
    conductor: string;
    spool: string;
    totalLen: number;
    totalCoreLen: number;
    totalCu: number;
    totalDrums: number;
    totalCount: number;
    doneCount: number;
  }> = {};

  orders.forEach(o => {
    const r = computeRecordRow(o, densities, ladiDimensions);
    const grade = o.grade || 'H05VV-F';
    const cond = o.conductor || '';
    const complete = isOrderComplete(o);

    // PVC aggregation
    const pvcKey = `${o.batch}||${o.brand}||${grade}||${cond}`;
    if (!batchPvcMap[pvcKey]) {
      batchPvcMap[pvcKey] = {
        batch: o.batch,
        brand: o.brand,
        grade,
        conductor: cond,
        insMap: {},
        sheathMap: {},
        totalIns: 0,
        totalSheath: 0,
        totalCount: 0,
        doneCount: 0,
      };
    }
    if (r.reqIns > 0 && o.ins_compound) {
      batchPvcMap[pvcKey].insMap[o.ins_compound] = (batchPvcMap[pvcKey].insMap[o.ins_compound] || 0) + r.reqIns;
      batchPvcMap[pvcKey].totalIns += r.reqIns;
    }
    if (r.reqSheath > 0 && o.sheath_compound) {
      batchPvcMap[pvcKey].sheathMap[o.sheath_compound] = (batchPvcMap[pvcKey].sheathMap[o.sheath_compound] || 0) + r.reqSheath;
      batchPvcMap[pvcKey].totalSheath += r.reqSheath;
    }
    batchPvcMap[pvcKey].totalCount++;
    if (complete) batchPvcMap[pvcKey].doneCount++;

    // Copper size aggregation
    const isBunched = isOrderBunched(o);
    const orderReqCu = r.reqCu || 0;
    const orderCuBunched = isBunched ? orderReqCu : 0;
    const orderCuToBunch = isBunched ? 0 : orderReqCu;

    const cuKey = `${o.size}||${cond}`;
    if (!sizeCuMap[cuKey]) {
      sizeCuMap[cuKey] = {
        size: o.size,
        conductor: cond,
        orderLen: 0,
        coreLen: 0,
        cu: 0,
        cuBunched: 0,
        cuToBunch: 0,
        totalCount: 0,
        doneCount: 0,
        bunchedCount: 0,
      };
    }
    sizeCuMap[cuKey].orderLen += r.orderLen;
    sizeCuMap[cuKey].coreLen += r.reqCoreLen;
    sizeCuMap[cuKey].cu += orderReqCu;
    sizeCuMap[cuKey].cuBunched += orderCuBunched;
    sizeCuMap[cuKey].cuToBunch += orderCuToBunch;
    sizeCuMap[cuKey].totalCount++;
    if (complete) sizeCuMap[cuKey].doneCount++;
    if (isBunched) sizeCuMap[cuKey].bunchedCount++;

    // Spool evaluation (Only for non-IS-694 orders — IS-694 dispatches in Cartons, Drum Size: N/A)
    const is694 = isIs694Order(o);
    if (!is694) {
      const evalPkg = evaluateSpoolSizeForOrder(r.finalDia, r.orderLen, r.size, r.cores, r.grade, sizeRules, packagingRules, o.spool_size);
      const pkgText = evalPkg.packaging || '1000m / Drum';
      const mLenMatch = pkgText.match(/[0-9]+/);
      const drumLen = mLenMatch ? parseFloat(mLenMatch[0]) : 1000;
      const spoolCount = drumLen > 0 ? Math.ceil(r.orderLen / drumLen) : 1;

      // Size Drum aggregation
      const batchKey = o.batch || '-';
      const sizeDrumKey = `${batchKey}||${grade}||${o.size}||${o.cores}||${evalPkg.spool}`;
      if (!sizeDrumMap[sizeDrumKey]) {
        sizeDrumMap[sizeDrumKey] = {
          batch: batchKey,
          grade,
          size: o.size,
          cores: o.cores,
          spool: evalPkg.spool,
          totalLen: 0,
          totalDrums: 0,
          totalCu: 0,
          totalIns: 0,
          totalSheath: 0,
          totalCount: 0,
          doneCount: 0,
        };
      }
      sizeDrumMap[sizeDrumKey].totalLen += r.orderLen;
      sizeDrumMap[sizeDrumKey].totalDrums += spoolCount;
      sizeDrumMap[sizeDrumKey].totalCu += r.reqCu;
      sizeDrumMap[sizeDrumKey].totalIns += r.reqIns;
      sizeDrumMap[sizeDrumKey].totalSheath += r.reqSheath;
      sizeDrumMap[sizeDrumKey].totalCount++;
      if (complete) sizeDrumMap[sizeDrumKey].doneCount++;

      // Job Drum aggregation
      const jobDrumKey = `${o.batch}||${o.brand}||${grade}||${o.size}||${o.cores}||${cond}`;
      if (!jobDrumMap[jobDrumKey]) {
        jobDrumMap[jobDrumKey] = {
          batch: o.batch,
          brand: o.brand,
          grade,
          size: o.size,
          cores: o.cores,
          conductor: cond,
          spool: evalPkg.spool,
          totalLen: 0,
          totalCoreLen: 0,
          totalCu: 0,
          totalDrums: 0,
          totalCount: 0,
          doneCount: 0,
        };
      }
      jobDrumMap[jobDrumKey].totalLen += r.orderLen;
      jobDrumMap[jobDrumKey].totalCoreLen += r.reqCoreLen;
      jobDrumMap[jobDrumKey].totalCu += r.reqCu;
      jobDrumMap[jobDrumKey].totalDrums += spoolCount;
      jobDrumMap[jobDrumKey].totalCount++;
      if (complete) jobDrumMap[jobDrumKey].doneCount++;
    }
  });

  const sortedCuList = Object.values(sizeCuMap).sort((a, b) => b.cu - a.cu);

  const handleExportPVC = () => {
    const rows: (string | number)[][] = [
      ['Batch No', 'Status', 'Brand', 'Grade', 'Copper Size', 'Insulation Compound', 'Insulation Req (kg)', 'Sheath Compound', 'Sheath Req (kg)', 'Total PVC (kg)'],
    ];
    Object.values(batchPvcMap).forEach(b => {
      const insNames = Object.keys(b.insMap).join('; ') || '-';
      const sheathNames = Object.keys(b.sheathMap).join('; ') || '-';
      const status = b.doneCount === b.totalCount ? 'Done' : `Active (${b.doneCount}/${b.totalCount})`;
      rows.push([
        b.batch, status, b.brand, b.grade, b.conductor, insNames, b.totalIns.toFixed(2), sheathNames, b.totalSheath.toFixed(2), (b.totalIns + b.totalSheath).toFixed(2)
      ]);
    });
    exportCsvFile('PVC_Compound_Summary_Batch_Wise.csv', rows);
  };

  const handleExportCu = () => {
    const rows: (string | number)[][] = [
      ['Cable Size (SQ MM)', 'Status', 'Copper / Conductor Size', 'Total Order Length (m)', 'Total Core Length (m)', 'Total Copper Required (kg)'],
    ];
    sortedCuList.forEach(s => {
      const status = s.doneCount === s.totalCount ? 'Done' : `Active (${s.doneCount}/${s.totalCount})`;
      rows.push([s.size, status, s.conductor, s.orderLen, s.coreLen, s.cu.toFixed(2)]);
    });
    exportCsvFile('Copper_Summary_Size_Conductor_Wise.csv', rows);
  };

  const handleExportSizeDrum = () => {
    const rows: (string | number)[][] = [
      ['Batch / Job Order', 'Status', 'Cable Grade', 'Cable Size & Cores', 'Drum Size', 'Total Order Length (m)', 'Total Drums Required', 'Copper Wt (kg)', 'Insulation Wt (kg)', 'Sheath Wt (kg)', 'Total Cable Wt (kg)'],
    ];
    Object.values(sizeDrumMap).forEach(s => {
      const status = s.doneCount === s.totalCount ? 'Done' : `Active (${s.doneCount}/${s.totalCount})`;
      const totWt = s.totalCu + s.totalIns + s.totalSheath;
      rows.push([
        s.batch, status, s.grade, `${s.cores}C x ${s.size}`, s.spool, s.totalLen, s.totalDrums, s.totalCu.toFixed(2), s.totalIns.toFixed(2), s.totalSheath.toFixed(2), totWt.toFixed(2)
      ]);
    });
    exportCsvFile('Cable_Size_Wise_Drum_Summary.csv', rows);
  };

  const handleExportJobDrum = () => {
    const rows: (string | number)[][] = [
      ['Batch / Job Order', 'Status', 'Brand', 'Grade', 'Cable Size & Cores', 'Copper Size', 'Drum Size', 'Total Order Length (m)', 'Total Core Length (m)', 'Total Drums Required', 'Total Copper Required (kg)'],
    ];
    Object.values(jobDrumMap).forEach(j => {
      const status = j.doneCount === j.totalCount ? 'Done' : `Active (${j.doneCount}/${j.totalCount})`;
      rows.push([
        j.batch, status, j.brand, j.grade, `${j.cores}C x ${j.size}`, j.conductor, j.spool, j.totalLen, j.totalCoreLen, j.totalDrums, j.totalCu.toFixed(2)
      ]);
    });
    exportCsvFile('Job_Order_Grade_Copper_Summary.csv', rows);
  };

  return (
    <div className="space-y-4">
      {/* Print Document Header (Visible ONLY when printing) */}
      <div className="print-only border-b-2 border-slate-900 pb-3 mb-4">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-wide uppercase">
              PLUTUS CABLE PRODUCTION SYSTEM
            </h1>
            <p className="text-xs font-bold text-slate-700">
              {viewMode === 'master'
                ? 'MASTER UNIFIED PRODUCTION SUMMARY SHEET (CONSOLIDATED)'
                : 'PRODUCTION BREAKDOWN SUMMARIES (MULTI-TABLE REPORT)'}
            </p>
          </div>
          <div className="text-right text-[10px] text-slate-600">
            <div>Printed: {new Date().toLocaleString()}</div>
            <div>
              Scope: {selectedBatch === 'ALL' ? 'All Batches' : `Batch ${selectedBatch}`} | Status: {selectedStatus}
            </div>
            <div>Total Orders: {filteredRows.length} items</div>
          </div>
        </div>
      </div>

      {/* Top Controls / View Selector Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 px-4 shadow-xs no-print space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Title & View Switcher */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-blue-50 text-blue-700 rounded-lg">
                <FileSpreadsheet className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Production Master Summary
                </h2>
                <p className="text-xs text-slate-500">
                  Consolidated material requisition, cable length, copper, PVC compound, and drum requirements
                </p>
              </div>
            </div>

            {/* View Mode Toggle Pill */}
            <div className="inline-flex p-1 bg-slate-100 rounded-lg border border-slate-200 text-xs font-semibold ml-2">
              <button
                onClick={() => setViewMode('master')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                  viewMode === 'master'
                    ? 'bg-white text-blue-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Single Master Summary Table reflecting all table data into one comprehensive table"
              >
                <Table className="w-3.5 h-3.5" />
                <span>Single Master Sheet</span>
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors ${
                  viewMode === 'split'
                    ? 'bg-white text-blue-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Separate 4 breakdown tables (PVC, Copper, Size Drum, Job Drum)"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Sub-Tables (4 Breakdowns)</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleDownloadSummaryPdf}
              className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              title="Download Master Summary Sheet as a formatted A4 Landscape PDF"
            >
              <FileDown className="w-3.5 h-3.5" /> Download as PDF
            </button>
            {viewMode === 'master' && (
              <button
                onClick={handleExportMasterSummary}
                className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
                title="Export Master Summary Sheet to CSV"
              >
                <Download className="w-3.5 h-3.5" /> Export Master CSV
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
              title="Print current page document"
            >
              <Printer className="w-3.5 h-3.5" /> Print current page
            </button>
          </div>
        </div>

        {/* Filters Bar (Only for Master View) */}
        {viewMode === 'master' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-xs">
            {/* Search Box */}
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search Batch, Brand, Grade, Size, Conductor, Compound..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Batch Filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-500 font-medium">Batch:</span>
              <select
                value={selectedBatch}
                onChange={e => setSelectedBatch(e.target.value)}
                className="py-1 px-2.5 bg-slate-50 border border-slate-200 rounded-lg font-semibold text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">All Batches ({batchList.length})</option>
                {batchList.map(b => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">Status:</span>
              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value as any)}
                className="py-1 px-2.5 bg-slate-50 border border-slate-200 rounded-lg font-semibold text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">⏳ Active</option>
                <option value="DONE">✅ Completed</option>
              </select>
            </div>

            <div className="ml-auto text-slate-500 text-[11px] font-medium">
              Showing <span className="font-bold text-slate-900">{filteredRows.length}</span> of {computedOrders.length} orders
            </div>
          </div>
        )}
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Orders / Batch</span>
            <Layers2 className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="mt-1 text-base font-black text-slate-900">
            {filteredRows.length}
            <span className="text-xs font-normal text-slate-500 ml-1">
              ({masterTotals.doneCount} done)
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Cable Length</span>
            <span className="text-[9px] font-bold text-slate-400">Total: {masterTotals.orderLen.toLocaleString()} m</span>
          </div>
          <div className="mt-1 text-base font-black text-blue-700">
            {masterTotals.orderLenPending.toLocaleString()}
            <span className="text-xs font-bold text-blue-600 ml-1">m to produce</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            ✓ Produced: <strong className="text-emerald-700">{masterTotals.orderLenCompleted.toLocaleString()} m</strong>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Core Length</span>
            <span className="text-[9px] font-bold text-slate-400">Total: {masterTotals.coreLen.toLocaleString()} m</span>
          </div>
          <div className="mt-1 text-base font-black text-indigo-700">
            {masterTotals.coreLenPending.toLocaleString()}
            <span className="text-xs font-bold text-indigo-600 ml-1">m to insulate</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            ✓ Insulated: <strong className="text-emerald-700">{masterTotals.coreLenCompleted.toLocaleString()} m</strong>
          </div>
        </div>

        <div className="bg-white border-2 border-amber-300/80 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-black uppercase tracking-wider text-amber-900 flex items-center justify-between">
            <span>Copper Requisition</span>
            <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 text-[9px] font-black">
              Total: {masterTotals.cu.toFixed(1)} kg
            </span>
          </div>
          <div className="mt-1 text-base font-black text-amber-950 flex items-baseline gap-1.5">
            <span>{masterTotals.cuToBunch.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</span>
            <span className="text-[10px] font-bold text-amber-800 uppercase tracking-tight">Have to bunch</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between font-medium">
            <span className="text-emerald-700 font-bold">✓ Bunched: {masterTotals.cuBunched.toFixed(1)} kg</span>
            <span className="text-slate-400">({masterTotals.bunchedOrders}/{filteredRows.length} Bunched)</span>
          </div>
        </div>

        <div className="bg-white border-2 border-purple-300/80 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-black uppercase tracking-wider text-purple-900 flex items-center justify-between">
            <span>PVC Compounds</span>
            <span className="px-1.5 py-0.2 rounded bg-purple-100 text-purple-900 text-[9px] font-black">
              Total: {masterTotals.compound.toFixed(1)} kg
            </span>
          </div>
          <div className="mt-1 text-base font-black text-purple-950 flex items-baseline gap-1.5">
            <span>{masterTotals.compoundToProcess.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</span>
            <span className="text-[10px] font-bold text-purple-800 uppercase tracking-tight">To Extrude</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between font-medium">
            <span className="text-emerald-700 font-bold">✓ Extruded: {masterTotals.compoundDeducted.toFixed(1)} kg</span>
            <span className="text-slate-400">(Ins: {masterTotals.insDeducted.toFixed(0)} | Sh: {masterTotals.sheathDeducted.toFixed(0)})</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Gross Cable Wt
          </div>
          <div className="mt-1 text-base font-black text-teal-800">
            {masterTotals.cableWt.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            <span className="text-xs font-bold text-slate-500 ml-1">kg</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            Total Finished Cable Mass
          </div>
        </div>

        <div className="bg-white border-2 border-rose-300/80 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-black uppercase tracking-wider text-rose-900 flex items-center justify-between">
            <span>Drums Requisition</span>
            <span className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-900 text-[9px] font-black">
              Total: {masterTotals.drums}
            </span>
          </div>
          <div className="mt-1 text-base font-black text-rose-950 flex items-baseline gap-1.5">
            <span>{masterTotals.drumsToProcess} Drums</span>
            <span className="text-[10px] font-bold text-rose-800 uppercase tracking-tight">To Prepare</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between font-medium">
            <span className="text-emerald-700 font-bold">✓ Wound: {masterTotals.drumsDeducted} Drums</span>
            {masterTotals.cartons > 0 && (
              <span className="text-amber-800 font-bold">+{masterTotals.cartons} Cartons</span>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* DEDICATED SEPARATE IS-694 SUMMARY (CARTON DISPATCH • DRUM SIZE N/A • FINAL STAGE: INSULATION) */}
      {/* ========================================================= */}
      {is694FilteredRows.length > 0 && (
        <div className="bg-white border-2 border-rose-800 rounded-xl shadow-xs overflow-hidden print-card">
          <div className="p-3 px-4 bg-rose-900 text-white flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Package className="w-4 h-4 text-amber-300" />
              <h3 className="text-sm font-black uppercase tracking-wide">
                📦 Separate IS-694 Summary (Carton Dispatch — Drum Size N/A • Final Stage: Insulation)
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-400 text-slate-950">
                {is694FilteredRows.length} IS-694 Order(s) • {is694Totals.coils} Coils • {is694Totals.cartons} Master Cartons
              </span>
            </div>
            <div className="text-[11px] text-rose-100 font-semibold">
              Final Stage: <strong>2. IS-694 Insulation</strong> (Attaches Completed Order to Finished Carton Stock)
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5 p-3 bg-rose-50/60 border-b border-rose-200 text-xs">
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">IS-694 Orders</span>
              <span className="font-black text-sm text-rose-950">
                {is694FilteredRows.length} ({is694Totals.doneCount} Attached to Stock)
              </span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">Total Coils</span>
              <span className="font-black text-sm text-amber-800">{is694Totals.coils} Coils</span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">Master Cartons</span>
              <span className="font-black text-sm text-rose-800">{is694Totals.cartons} Cartons</span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">Total Wire Length</span>
              <span className="font-black text-sm text-blue-800">{is694Totals.orderLen.toLocaleString()} m</span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">Copper Req (Bunching)</span>
              <span className="font-black text-sm text-amber-900">{is694Totals.cu.toFixed(2)} kg</span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">Insulation PVC Req</span>
              <span className="font-black text-sm text-teal-800">{is694Totals.ins.toFixed(2)} kg</span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">Drum Size</span>
              <span className="font-black text-sm text-slate-700">N/A (Carton Pack)</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead className="bg-rose-100/80 text-rose-950 font-bold uppercase text-[10.5px] border-b border-rose-200">
                <tr>
                  <th className="p-2 border-r border-rose-200">Batch / Job No</th>
                  <th className="p-2 border-r border-rose-200">Final Stage &amp; Stock Status</th>
                  <th className="p-2 border-r border-rose-200">Brand &amp; Size (1C)</th>
                  <th className="p-2 border-r border-rose-200">Conductor</th>
                  <th className="p-2 border-r border-rose-200 text-center">Coils &amp; Coil Option</th>
                  <th className="p-2 border-r border-rose-200 text-center">Master Cartons</th>
                  <th className="p-2 border-r border-rose-200">Colour / Carton Breakdown</th>
                  <th className="p-2 border-r border-rose-200 text-right">Length (m)</th>
                  <th className="p-2 border-r border-rose-200 text-right">Copper (kg)</th>
                  <th className="p-2 border-r border-rose-200 text-right">Ins. PVC (kg)</th>
                  <th className="p-2 border-r border-rose-200 text-right">Net / Gross Wt</th>
                  <th className="p-2 text-center">Drum Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rose-100">
                {is694FilteredRows.map(r => {
                  const cr = r.is694CartonRow;
                  const isAttachedToStock = Boolean(r.pStatus?.i);
                  return (
                    <tr key={`is694-sum-${r.id}`} className="hover:bg-rose-50/40">
                      <td className="p-2 border-r border-slate-100 font-black text-slate-900">{r.batch}</td>
                      <td className="p-2 border-r border-slate-100">
                        {isAttachedToStock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-black">
                            ✅ Insulation Done • Attached to Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                            ⏳ {r.pStatus?.b ? '1. Bunching Done → Pending 2. Insulation (Final)' : 'Pending 1. Bunching & 2. Insulation'}
                          </span>
                        )}
                      </td>
                      <td className="p-2 border-r border-slate-100 font-bold text-rose-950">
                        {r.brand} • 1C × {r.size}
                      </td>
                      <td className="p-2 border-r border-slate-100 font-mono text-[11px]">{r.conductor}</td>
                      <td className="p-2 border-r border-slate-100 text-center font-black text-amber-900 bg-amber-50/40">
                        {r.coilsCount} Coils × {r.coilType || '90 MTR'}
                      </td>
                      <td className="p-2 border-r border-slate-100 text-center font-black text-rose-800 bg-rose-50/40">
                        {r.cartonsCount} Cartons
                        {cr ? <span className="text-[10px] text-slate-500 font-normal ml-1">({cr.coilsPerCarton}/Ctn)</span> : null}
                      </td>
                      <td className="p-2 border-r border-slate-100 text-[11px] font-semibold text-slate-700 max-w-xs truncate" title={cr?.packingSummaryText}>
                        {cr?.packingSummaryText || r.order.ins_colour || 'Standard'}
                      </td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold">{r.orderLen.toLocaleString()} m</td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold text-blue-800">{r.reqCu.toFixed(2)} kg</td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold text-teal-800">{r.reqIns.toFixed(2)} kg</td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-900">
                        {r.totalCableWt.toFixed(2)} / {(cr ? cr.grossPackingWtKg : r.totalCableWt).toFixed(2)} kg
                      </td>
                      <td className="p-2 text-center">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                          N/A (Cartons)
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 1. SINGLE UNIFIED MASTER SUMMARY TABLE (PRIMARY VIEW) */}
      {/* ========================================================= */}
      {viewMode === 'master' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden print-card">
          <div className="p-3 px-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Table className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Single Unified Production Summary Sheet
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                Consolidated All-In-One Table
              </span>
            </div>
            <div className="text-xs text-slate-500 font-medium">
              Reflects PVC Compound, Copper Size, Drum Packaging, and Requisition data
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left whitespace-nowrap border-collapse">
              <thead>
                {/* Primary Group Header */}
                <tr className="bg-slate-800 text-white uppercase text-[10px] font-extrabold tracking-wider text-center">
                  <th colSpan={3} className="p-2 border-r border-slate-700">Identification</th>
                  <th colSpan={4} className="p-2 border-r border-slate-700 bg-slate-850">Cable & Conductor Specs</th>
                  <th colSpan={3} className="p-2 border-r border-slate-700 bg-blue-900/60">Length & Copper</th>
                  <th colSpan={5} className="p-2 border-r border-slate-700 bg-purple-900/60">PVC Compounds (Insulation & Sheathing)</th>
                  <th colSpan={1} className="p-2 border-r border-slate-700 bg-teal-900/60">Gross Cable</th>
                  <th colSpan={3} className="p-2 bg-amber-900/60">Packaging & Drums</th>
                </tr>
                {/* Column Headers */}
                <tr className="bg-slate-100 text-slate-700 font-bold uppercase text-[10.5px] border-b border-slate-200">
                  <th className="p-2.5 border-r border-slate-200 text-center w-10">#</th>
                  <th className="p-2.5 border-r border-slate-200">Batch / Job Order</th>
                  <th className="p-2.5 border-r border-slate-200">Status</th>
                  <th className="p-2.5 border-r border-slate-200">Brand</th>
                  <th className="p-2.5 border-r border-slate-200">Grade</th>
                  <th className="p-2.5 border-r border-slate-200">Cable Size & Cores</th>
                  <th className="p-2.5 border-r border-slate-200">Conductor (Copper)</th>
                  <th className="p-2.5 border-r border-slate-200 text-right">Order Len (m)</th>
                  <th className="p-2.5 border-r border-slate-200 text-right">Core Len (m)</th>
                  <th className="p-2.5 border-r border-slate-200 text-right text-blue-900">Copper Req (kg)</th>
                  <th className="p-2.5 border-r border-slate-200">Insulation Compound</th>
                  <th className="p-2.5 border-r border-slate-200 text-right">Ins Req (kg)</th>
                  <th className="p-2.5 border-r border-slate-200">Sheath Compound</th>
                  <th className="p-2.5 border-r border-slate-200 text-right">Sheath Req (kg)</th>
                  <th className="p-2.5 border-r border-slate-200 text-right text-purple-900">Total PVC (kg)</th>
                  <th className="p-2.5 border-r border-slate-200 text-right text-teal-900">Cable Wt (kg)</th>
                  <th className="p-2.5 border-r border-slate-200">Drum Size</th>
                  <th className="p-2.5 border-r border-slate-200 text-center text-rose-800">Drums (Nos)</th>
                  <th className="p-2.5">Pallet Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={19} className="p-8 text-center text-slate-400 font-medium text-sm">
                      No production orders found matching your filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r, idx) => {
                    return (
                      <tr key={r.id} className="hover:bg-blue-50/40 transition-colors">
                        <td className="p-2 border-r border-slate-100 text-center font-mono text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="p-2 border-r border-slate-100 font-black text-slate-900">
                          {r.batch}
                        </td>
                        <td className="p-2 border-r border-slate-100">
                          {r.complete ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800 border border-green-200">
                              <CheckCircle2 className="w-3 h-3 text-green-600" /> Done
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                              <Clock className="w-3 h-3 text-amber-600" />
                              {r.pStatus ? (
                                <span className="font-mono text-[9.5px]">
                                  {r.pStatus.b ? 'B ' : ''}
                                  {r.pStatus.c ? 'CS ' : ''}
                                  {r.pStatus.i ? 'I ' : ''}
                                  {r.pStatus.t ? 'TS ' : ''}
                                  {r.pStatus.s ? 'SH' : ''}
                                </span>
                              ) : (
                                'Active'
                              )}
                            </span>
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100 font-medium text-slate-800">
                          {r.brand}
                        </td>
                        <td className="p-2 border-r border-slate-100">
                          <span className="px-1.5 py-0.5 bg-slate-100 rounded text-[10.5px] font-bold text-slate-700">
                            {r.grade}
                          </span>
                        </td>
                        <td className="p-2 border-r border-slate-100 font-bold text-slate-900">
                          {r.cores}C × {r.size}
                        </td>
                        <td className="p-2 border-r border-slate-100 font-mono text-[11px] text-slate-700">
                          {r.conductor}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-medium">
                          {r.orderLen.toLocaleString()} m
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-semibold text-slate-700">
                          {r.coreLen.toLocaleString()} m
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-bold bg-blue-50/20">
                          <div className="text-slate-900 font-bold">{r.reqCu.toFixed(2)} kg</div>
                          {r.isBunched ? (
                            <span className="inline-block text-[9px] font-black text-emerald-800 bg-emerald-100 px-1 py-0.2 rounded border border-emerald-300">
                              ✓ Bunched
                            </span>
                          ) : (
                            <span className="inline-block text-[9px] font-black text-amber-900 bg-amber-100 px-1 py-0.2 rounded border border-amber-300">
                              ⚡ To Bunch
                            </span>
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100 font-semibold text-slate-800">
                          {r.insCompound}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-bold bg-teal-50/20">
                          {r.reqIns > 0 ? (
                            <div>
                              <div className="text-slate-900 font-bold">{r.reqIns.toFixed(2)} kg</div>
                              {r.isIns ? (
                                <span className="inline-block text-[9px] font-black text-emerald-800 bg-emerald-100 px-1 py-0.2 rounded border border-emerald-300">
                                  ✓ Insulated
                                </span>
                              ) : (
                                <span className="inline-block text-[9px] font-black text-teal-900 bg-teal-100 px-1 py-0.2 rounded border border-teal-300">
                                  ⚡ To Insulate
                                </span>
                              )}
                            </div>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100 font-semibold text-slate-800">
                          {r.sheathCompound}
                          {r.sheathColour ? (
                            <span className="text-[10px] text-slate-500 font-normal ml-1">
                              ({r.sheathColour})
                            </span>
                          ) : null}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-bold bg-purple-50/20">
                          {r.reqSheath > 0 ? (
                            <div>
                              <div className="text-slate-900 font-bold">{r.reqSheath.toFixed(2)} kg</div>
                              {r.isSheath ? (
                                <span className="inline-block text-[9px] font-black text-emerald-800 bg-emerald-100 px-1 py-0.2 rounded border border-emerald-300">
                                  ✓ Sheathed
                                </span>
                              ) : (
                                <span className="inline-block text-[9px] font-black text-purple-900 bg-purple-100 px-1 py-0.2 rounded border border-purple-300">
                                  ⚡ To Sheath
                                </span>
                              )}
                            </div>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-bold text-purple-700 bg-purple-50/30">
                          {r.totalCompound.toFixed(2)} kg
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-bold text-teal-800 bg-teal-50/30">
                          {r.totalCableWt.toFixed(2)} kg
                        </td>
                        <td className="p-2 border-r border-slate-100 font-medium text-slate-700">
                          {r.is694 ? (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                              N/A (Cartons)
                            </span>
                          ) : (
                            r.drumSize
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-center font-bold text-rose-700 bg-rose-50/30">
                          {r.is694 ? (
                            <span className="text-amber-900 font-black">
                              {r.cartonsCount} Cartons ({r.coilsCount} Coils)
                            </span>
                          ) : (
                            `${r.spoolCount} ${r.spoolCount === 1 ? 'Drum' : 'Drums'}`
                          )}
                        </td>
                        <td className="p-2 font-medium text-slate-600">
                          {r.palletSize}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {/* Grand Totals Footer */}
              <tfoot className="bg-slate-900 text-white font-bold text-[11px]">
                <tr>
                  <td colSpan={3} className="p-2.5 border-r border-slate-700 uppercase tracking-wider">
                    GRAND TOTAL ({filteredRows.length} Orders)
                  </td>
                  <td colSpan={4} className="p-2.5 border-r border-slate-700 text-slate-300 text-right">
                    Total Requirements:
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right">
                    {masterTotals.orderLen.toLocaleString()} m
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right">
                    {masterTotals.coreLen.toLocaleString()} m
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-blue-300">
                    <div>{masterTotals.cu.toFixed(2)} kg</div>
                    <div className="text-[9.5px] text-amber-300 font-bold whitespace-nowrap">
                      To Bunch: {masterTotals.cuToBunch.toFixed(2)} kg
                    </div>
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-slate-400">-</td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-teal-300">
                    <div>{masterTotals.ins.toFixed(2)} kg</div>
                    <div className="text-[9.5px] text-teal-200 font-bold whitespace-nowrap">
                      To Insulate: {masterTotals.insToProcess.toFixed(2)} kg
                    </div>
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-slate-400">-</td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-purple-300">
                    <div>{masterTotals.sheath.toFixed(2)} kg</div>
                    <div className="text-[9.5px] text-purple-200 font-bold whitespace-nowrap">
                      To Sheath: {masterTotals.sheathToProcess.toFixed(2)} kg
                    </div>
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-amber-300">
                    <div>{masterTotals.compound.toFixed(2)} kg</div>
                    <div className="text-[9.5px] text-amber-200 font-bold whitespace-nowrap">
                      To Extrude: {masterTotals.compoundToProcess.toFixed(2)} kg
                    </div>
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-teal-300">
                    {masterTotals.cableWt.toFixed(2)} kg
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-slate-400">-</td>
                  <td className="p-2.5 border-r border-slate-700 text-center text-rose-300">
                    {masterTotals.drums} Drums
                  </td>
                  <td className="p-2.5 text-slate-400">-</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 2. MULTI-TABLE DECOMPOSED BREAKDOWN (SPLIT VIEW) */}
      {/* ========================================================= */}
      {viewMode === 'split' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 1. PVC Compound Required */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs print-card">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
                <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  <span>🧪 PVC Compound Required (Batch-wise & Compound-wise)</span>
                </div>
                <button
                  onClick={handleExportPVC}
                  className="text-xs px-2.5 py-1 border border-slate-300 hover:bg-slate-50 rounded font-semibold text-slate-700 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Export CSV
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="p-2 border-r border-slate-200">Batch No</th>
                      <th className="p-2 border-r border-slate-200">Status</th>
                      <th className="p-2 border-r border-slate-200">Brand, Grade & Copper Size</th>
                      <th className="p-2 border-r border-slate-200">Insulation Compound</th>
                      <th className="p-2 border-r border-slate-200 text-right">Insulation Req (kg)</th>
                      <th className="p-2 border-r border-slate-200">Sheath Compound</th>
                      <th className="p-2 border-r border-slate-200 text-right">Sheath Req (kg)</th>
                      <th className="p-2 text-right">Total PVC (kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.values(batchPvcMap).map((b, idx) => {
                      const insNames = Object.keys(b.insMap).join(', ') || '-';
                      const insVals = Object.values(b.insMap).map(v => `${v.toFixed(2)} kg`).join(', ') || '-';
                      const sheathNames = Object.keys(b.sheathMap).join(', ') || '-';
                      const sheathVals = Object.values(b.sheathMap).map(v => `${v.toFixed(2)} kg`).join(', ') || '-';
                      const tot = b.totalIns + b.totalSheath;
                      const isAllDone = b.doneCount === b.totalCount;

                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2 border-r border-slate-100 font-bold">{b.batch}</td>
                          <td className="p-2 border-r border-slate-100">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isAllDone ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                              {isAllDone ? '✅ Done' : `⏳ ${b.doneCount}/${b.totalCount}`}
                            </span>
                          </td>
                          <td className="p-2 border-r border-slate-100">
                            {b.brand} <span className="px-1 bg-slate-100 rounded text-[10px] font-bold ml-1">{b.grade}</span>
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">Cu: {b.conductor}</div>
                          </td>
                          <td className="p-2 border-r border-slate-100 font-semibold">{insNames}</td>
                          <td className="p-2 border-r border-slate-100 text-right">{insVals}</td>
                          <td className="p-2 border-r border-slate-100 font-semibold">{sheathNames}</td>
                          <td className="p-2 border-r border-slate-100 text-right">{sheathVals}</td>
                          <td className="p-2 text-right font-bold text-slate-900">{tot.toFixed(2)} kg</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 2. Copper Required */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs print-card">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
                <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  <span>🔌 Copper Required (Size & Conductor Size-wise Across All Orders)</span>
                </div>
                <button
                  onClick={handleExportCu}
                  className="text-xs px-2.5 py-1 border border-slate-300 hover:bg-slate-50 rounded font-semibold text-slate-700 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Export CSV
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="p-2 border-r border-slate-200">Cable Size (SQ MM)</th>
                      <th className="p-2 border-r border-slate-200 text-center">Bunch Status</th>
                      <th className="p-2 border-r border-slate-200">Copper / Conductor Size</th>
                      <th className="p-2 border-r border-slate-200 text-right">Total Order Length (m)</th>
                      <th className="p-2 border-r border-slate-200 text-right">Total Core Length (m)</th>
                      <th className="p-2 border-r border-slate-200 text-right">Total Cu Req (kg)</th>
                      <th className="p-2 border-r border-slate-200 text-right text-emerald-800 bg-emerald-50/50">Already Bunched (kg)</th>
                      <th className="p-2 text-right font-black text-amber-950 bg-amber-100/70">⚡ Have To Bunch (kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedCuList.map((s, idx) => {
                      const isBunchedAll = s.cuToBunch <= 0.001;
                      const isPart = s.bunchedCount > 0 && s.cuToBunch > 0.001;
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2 border-r border-slate-100 font-bold">{s.size}</td>
                          <td className="p-2 border-r border-slate-100 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isBunchedAll
                                ? 'bg-emerald-100 text-emerald-800'
                                : isPart
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}>
                              {isBunchedAll ? '✓ Bunched' : isPart ? `⏳ ${s.bunchedCount}/${s.totalCount}` : '⚡ To Bunch'}
                            </span>
                          </td>
                          <td className="p-2 border-r border-slate-100 font-mono text-[11px]">{s.conductor}</td>
                          <td className="p-2 border-r border-slate-100 text-right">{s.orderLen.toLocaleString()} m</td>
                          <td className="p-2 border-r border-slate-100 text-right font-semibold">{s.coreLen.toLocaleString()} m</td>
                          <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-900">{s.cu.toFixed(2)} kg</td>
                          <td className="p-2 border-r border-slate-100 text-right font-bold text-emerald-700 bg-emerald-50/30">
                            {s.cuBunched > 0 ? `${s.cuBunched.toFixed(2)} kg` : '—'}
                          </td>
                          <td className="p-2 text-right font-black text-amber-950 bg-amber-50">
                            {s.cuToBunch > 0.001 ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-950">
                                {s.cuToBunch.toFixed(2)} kg
                              </span>
                            ) : (
                              <span className="text-emerald-700 font-bold text-[11px]">✓ 0.00 kg</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 3. Cable Size-wise Drum & Packaging Summary */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs print-card">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
                <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  <span>📦 Cable Size-wise Drum & Packaging Summary</span>
                </div>
                <button
                  onClick={handleExportSizeDrum}
                  className="text-xs px-2.5 py-1 border border-slate-300 hover:bg-slate-50 rounded font-semibold text-slate-700 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Export CSV
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="p-2 border-r border-slate-200">Batch / Job Order</th>
                      <th className="p-2 border-r border-slate-200">Status</th>
                      <th className="p-2 border-r border-slate-200">Cable Grade</th>
                      <th className="p-2 border-r border-slate-200">Cable Size & Cores</th>
                      <th className="p-2 border-r border-slate-200">Drum Size</th>
                      <th className="p-2 border-r border-slate-200 text-right">Total Order Length (m)</th>
                      <th className="p-2 border-r border-slate-200 text-center">Total Drums Required</th>
                      <th className="p-2 border-r border-slate-200 text-right">Copper Wt (kg)</th>
                      <th className="p-2 border-r border-slate-200 text-right">Insulation Wt (kg)</th>
                      <th className="p-2 border-r border-slate-200 text-right">Sheath Wt (kg)</th>
                      <th className="p-2 text-right">Total Cable Wt (kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.values(sizeDrumMap).map((s, idx) => {
                      const totalCableWt = s.totalCu + s.totalIns + s.totalSheath;
                      const isAllDone = s.doneCount === s.totalCount;
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2 border-r border-slate-100 font-bold">{s.batch}</td>
                          <td className="p-2 border-r border-slate-100">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isAllDone ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                              {isAllDone ? '✅ Done' : `⏳ ${s.doneCount}/${s.totalCount}`}
                            </span>
                          </td>
                          <td className="p-2 border-r border-slate-100 font-medium">{s.grade}</td>
                          <td className="p-2 border-r border-slate-100 font-bold">{s.cores}C × {s.size}</td>
                          <td className="p-2 border-r border-slate-100 font-semibold">{s.spool}</td>
                          <td className="p-2 border-r border-slate-100 text-right">{s.totalLen.toLocaleString()} m</td>
                          <td className="p-2 border-r border-slate-100 text-center font-bold text-blue-700">{s.totalDrums} Drums</td>
                          <td className="p-2 border-r border-slate-100 text-right">{s.totalCu.toFixed(2)} kg</td>
                          <td className="p-2 border-r border-slate-100 text-right">{s.totalIns.toFixed(2)} kg</td>
                          <td className="p-2 border-r border-slate-100 text-right">{s.totalSheath.toFixed(2)} kg</td>
                          <td className="p-2 text-right font-bold text-teal-800">{totalCableWt.toFixed(2)} kg</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. Job Order-wise Drum & Copper Requisition Summary */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs print-card">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
                <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                  <span>📦 Job Order / Batch-wise Drum & Copper Requisition Summary</span>
                </div>
                <button
                  onClick={handleExportJobDrum}
                  className="text-xs px-2.5 py-1 border border-slate-300 hover:bg-slate-50 rounded font-semibold text-slate-700 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Export CSV
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="p-2 border-r border-slate-200">Batch / Job Order</th>
                      <th className="p-2 border-r border-slate-200">Status</th>
                      <th className="p-2 border-r border-slate-200">Brand</th>
                      <th className="p-2 border-r border-slate-200">Grade</th>
                      <th className="p-2 border-r border-slate-200">Cable Size & Cores</th>
                      <th className="p-2 border-r border-slate-200">Copper Size</th>
                      <th className="p-2 border-r border-slate-200">Drum Size</th>
                      <th className="p-2 border-r border-slate-200 text-right">Total Order Length (m)</th>
                      <th className="p-2 border-r border-slate-200 text-right">Total Core Length (m)</th>
                      <th className="p-2 border-r border-slate-200 text-center">Total Drums Required</th>
                      <th className="p-2 text-right">Total Copper Required (kg)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.values(jobDrumMap).map((j, idx) => {
                      const isAllDone = j.doneCount === j.totalCount;
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2 border-r border-slate-100 font-bold">{j.batch}</td>
                          <td className="p-2 border-r border-slate-100">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isAllDone ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                              {isAllDone ? '✅ Done' : `⏳ ${j.doneCount}/${j.totalCount}`}
                            </span>
                          </td>
                          <td className="p-2 border-r border-slate-100">{j.brand}</td>
                          <td className="p-2 border-r border-slate-100 font-medium">{j.grade}</td>
                          <td className="p-2 border-r border-slate-100 font-bold">{j.cores}C × {j.size}</td>
                          <td className="p-2 border-r border-slate-100 font-mono text-[11px]">{j.conductor}</td>
                          <td className="p-2 border-r border-slate-100 font-semibold">{j.spool}</td>
                          <td className="p-2 border-r border-slate-100 text-right">{j.totalLen.toLocaleString()} m</td>
                          <td className="p-2 border-r border-slate-100 text-right font-semibold">{j.totalCoreLen.toLocaleString()} m</td>
                          <td className="p-2 border-r border-slate-100 text-center font-bold text-blue-700">{j.totalDrums} Drums</td>
                          <td className="p-2 text-right font-bold text-teal-800">{j.totalCu.toFixed(2)} kg</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
