import React, { useState } from 'react';
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
  isOrderDrumCompleted,
  normalizeSpoolKey,
} from '../utils/calculations';
import { Box, Printer, CheckCircle2, Clock, Check, Layers2 } from 'lucide-react';

interface TabDrumSlipProps {
  orders: CableOrder[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
}

interface SpoolData {
  spool: string;
  pallet: string;
  bbnPerPallet: number;
  totalDrums: number;
  deductedDrums: number;
  toPrepareDrums: number;
  totalPallets: number;
  deductedPallets: number;
  toPreparePallets: number;
  orderCount: number;
  completedOrderCount: number;
}

export const TabDrumSlip: React.FC<TabDrumSlipProps> = ({
  orders,
  densities,
  ladiDimensions,
  sizeRules,
  packagingRules,
}) => {
  const [filterBatch, setFilterBatch] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'TO_PREPARE' | 'DEDUCTED'>('ALL');
  const uniqueBatches = Array.from(new Set(orders.map(o => o.batch))).sort();

  const drumMap: Record<string, SpoolData> = {};
  const canonicalSpoolByNorm: Record<string, string> = {};
  const backupSpoolOrder: string[] = [];

  // Pre-populate all spools, pallets & bbnPerPallet dynamically from 12. Backup (packagingRules)
  packagingRules.forEach(pr => {
    const rawSpool = (pr.spool || '').trim();
    if (!rawSpool) return;
    const norm = normalizeSpoolKey(rawSpool);
    const canonical = canonicalSpoolByNorm[norm] || rawSpool;
    canonicalSpoolByNorm[norm] = canonical;
    if (!backupSpoolOrder.includes(canonical)) {
      backupSpoolOrder.push(canonical);
    }
    const m = String(pr.bbnPerPallet ?? '1').match(/[0-9]+/);
    const bbn = m ? Math.max(1, parseInt(m[0], 10)) : 1;

    if (!drumMap[canonical]) {
      drumMap[canonical] = {
        spool: canonical,
        pallet: pr.pallet || '30X30x6',
        bbnPerPallet: bbn,
        totalDrums: 0,
        deductedDrums: 0,
        toPrepareDrums: 0,
        totalPallets: 0,
        deductedPallets: 0,
        toPreparePallets: 0,
        orderCount: 0,
        completedOrderCount: 0,
      };
    }
  });

  let skippedIs694Count = 0;
  let skippedIs694Coils = 0;
  let skippedCoilsCount = 0;
  let skippedCoilsTotal = 0;

  orders.forEach(o => {
    if (filterBatch && o.batch !== filterBatch) return;
    const isIs694 = (o.grade || '').toUpperCase().includes('IS-694');
    const hasCoils = o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0;

    // Rule: IF THERE IS MENTION THE COILS DETAIL THEN DRUM WILL NOT APPLICABLE FOR THAT IN ANY CABLE GRADE AND AS WELL AS IF THE GRADE IS MENTION IS-694.
    if (isIs694 || hasCoils) {
      if (isIs694) {
        skippedIs694Count++;
        skippedIs694Coils += Number(o.total_order_coils || o.coils || 0);
      } else {
        skippedCoilsCount++;
        skippedCoilsTotal += Number(o.total_order_coils || o.coils || 0);
      }
      return;
    }

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

    const rawSpool = evalPkg.spool || 'Standard Drum';
    const norm = normalizeSpoolKey(rawSpool);
    const spool = canonicalSpoolByNorm[norm] || rawSpool;

    const pkgText = evalPkg.packaging || '1000m / Drum';
    const mLenMatch = pkgText.match(/[0-9]+/);
    const drumLen = mLenMatch ? parseFloat(mLenMatch[0]) : 1000;
    const spoolCount = drumLen > 0 ? Math.ceil(r.orderLen / drumLen) : 1;

    const isDone = isOrderDrumCompleted(o, ladiDimensions);

    if (!drumMap[spool]) {
      drumMap[spool] = {
        spool,
        pallet: evalPkg.pallet || '30X30x6',
        bbnPerPallet: evalPkg.bbnPerPallet || 1,
        totalDrums: 0,
        deductedDrums: 0,
        toPrepareDrums: 0,
        totalPallets: 0,
        deductedPallets: 0,
        toPreparePallets: 0,
        orderCount: 0,
        completedOrderCount: 0,
      };
    }

    drumMap[spool].totalDrums += spoolCount;
    drumMap[spool].orderCount++;
    if (isDone) {
      drumMap[spool].deductedDrums += spoolCount;
      drumMap[spool].completedOrderCount++;
    } else {
      drumMap[spool].toPrepareDrums += spoolCount;
    }
  });

  // Calculate pallets
  Object.values(drumMap).forEach(d => {
    const bbn = d.bbnPerPallet > 0 ? d.bbnPerPallet : 1;
    d.totalPallets = d.totalDrums > 0 ? Math.ceil(d.totalDrums / bbn) : 0;
    d.deductedPallets = d.deductedDrums > 0 ? Math.ceil(d.deductedDrums / bbn) : 0;
    d.toPreparePallets = d.toPrepareDrums > 0 ? Math.ceil(d.toPrepareDrums / bbn) : 0;
  });

  const sortedKeys = Object.keys(drumMap).sort((a, b) => {
    const idxA = backupSpoolOrder.indexOf(a);
    const idxB = backupSpoolOrder.indexOf(b);
    if (idxA > -1 && idxB > -1) return idxA - idxB;
    if (idxA > -1) return -1;
    if (idxB > -1) return 1;
    return a.localeCompare(b);
  });

  // Grand totals
  let grandTotalDrums = 0;
  let grandDeductedDrums = 0;
  let grandToPrepareDrums = 0;
  let grandTotalPallets = 0;
  let grandDeductedPallets = 0;
  let grandToPreparePallets = 0;

  sortedKeys.forEach(k => {
    const d = drumMap[k];
    grandTotalDrums += d.totalDrums;
    grandDeductedDrums += d.deductedDrums;
    grandToPrepareDrums += d.toPrepareDrums;
    grandTotalPallets += d.totalPallets;
    grandDeductedPallets += d.deductedPallets;
    grandToPreparePallets += d.toPreparePallets;
  });

  const overallPct =
    grandTotalDrums > 0 ? Math.round((grandDeductedDrums / grandTotalDrums) * 100) : 0;

  // Filter based on filterMode
  const filteredKeys = sortedKeys.filter(k => {
    const d = drumMap[k];
    if (d.totalDrums === 0 && grandTotalDrums > 0) return false;
    if (filterMode === 'TO_PREPARE' && d.toPrepareDrums <= 0) return false;
    if (filterMode === 'DEDUCTED' && (d.deductedDrums <= 0 || d.toPrepareDrums > 0)) return false;
    return true;
  });

  const handleExportCSV = () => {
    const rows: (string | number)[][] = [
      [
        'DRUM SIZE',
        'STATUS',
        'PALLET SIZE',
        'NO. OF BBN / PALLET',
        'TOTAL DRUMS REQ',
        'ALREADY PREPARED / WOUND',
        'REQUISITION DRUMS TO PREPARE',
        'TOTAL PALLETS REQ',
        'PALLETS TO PREPARE',
      ],
    ];

    filteredKeys.forEach(spool => {
      const d = drumMap[spool];
      const status =
        d.toPrepareDrums === 0 && d.totalDrums > 0
          ? 'Completed (Deducted)'
          : d.deductedDrums > 0
          ? `Partial (${d.deductedDrums}/${d.totalDrums})`
          : 'To Prepare';

      rows.push([
        d.spool,
        status,
        d.pallet,
        d.bbnPerPallet,
        d.totalDrums,
        d.deductedDrums,
        d.toPrepareDrums,
        d.totalPallets,
        d.toPreparePallets,
      ]);
    });

    rows.push([
      'Grand Total',
      `${grandDeductedDrums}/${grandTotalDrums} Prepared (${overallPct}%)`,
      '',
      '',
      grandTotalDrums,
      grandDeductedDrums,
      grandToPrepareDrums,
      grandTotalPallets,
      grandToPreparePallets,
    ]);

    const batchSuffix = filterBatch ? `_${filterBatch.replace(/[/\\\s]/g, '_')}` : '_All_Batches';
    const filterSuffix = filterMode !== 'ALL' ? `_${filterMode}` : '';
    exportCsvFile(`Drum_Requisition_Slip${batchSuffix}${filterSuffix}.csv`, rows);
  };

  return (
    <div className="max-w-4xl mx-auto bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-4 print-card">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-200 gap-2">
        <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
          <Box className="w-4 h-4 text-amber-600" />
          <span>📦 DRUM SIZE &amp; PALLETS REQUISITION SLIP (Step-Wise Auto-Deduction)</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap no-print">
          <select
            value={filterBatch}
            onChange={(e) => setFilterBatch(e.target.value)}
            className="text-xs px-2.5 py-1.5 border border-slate-300 rounded font-bold bg-white text-slate-800"
          >
            <option value="">All Batches / Job Orders ({uniqueBatches.length})</option>
            {uniqueBatches.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          <button
            onClick={handleExportCSV}
            className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold transition-colors"
          >
            ⬇ Export Slip CSV
          </button>

          <button
            onClick={() => window.print()}
            className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
            title="Print current page"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>Print Drum Slip</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Gross Required */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Total Drums Required
          </div>
          <div className="mt-1 text-2xl font-black text-slate-900">
            {grandTotalDrums}
            <span className="text-xs font-bold text-slate-500 ml-1">Drums</span>
          </div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">
            {grandTotalPallets} Pallets Required (Gross)
          </div>
        </div>

        {/* Card 2: Already Prepared / Wound (Auto-Deducted) */}
        <div className="bg-emerald-50/70 border-2 border-emerald-300 rounded-xl p-3 shadow-2xs">
          <div className="flex items-center justify-between text-[10px] font-bold text-emerald-900 uppercase tracking-wider">
            <span>Already Wound / Ready</span>
            <span className="px-1.5 py-0.2 rounded bg-emerald-200 text-emerald-900 text-[9px] font-black">
              ✓ Auto-Deducted
            </span>
          </div>
          <div className="mt-1 text-2xl font-black text-emerald-800">
            {grandDeductedDrums}
            <span className="text-xs font-bold text-emerald-600 ml-1">Drums</span>
          </div>
          <div className="text-[10.5px] text-emerald-700 mt-0.5 font-semibold">
            {grandDeductedPallets} Pallets Wound ({overallPct}% Complete)
          </div>
        </div>

        {/* Card 3: REQUISITION TO PREPARE */}
        <div className="bg-gradient-to-br from-amber-50 via-amber-100/60 to-orange-50 border-2 border-amber-400 rounded-xl p-3 shadow-xs ring-2 ring-amber-400/30">
          <div className="flex items-center justify-between text-[10px] font-black text-amber-950 uppercase tracking-wider">
            <span>Have To Prepare</span>
            <span className="px-1.5 py-0.2 rounded bg-amber-500 text-white text-[9px] font-black uppercase shadow-2xs">
              ⚡ Active Requisition
            </span>
          </div>
          <div className="mt-1 text-2xl font-black text-amber-950">
            {grandToPrepareDrums}
            <span className="text-xs font-bold text-amber-800 ml-1">Drums</span>
          </div>
          <div className="text-[10.5px] text-amber-900 mt-0.5 font-bold">
            {grandToPreparePallets} Pallets Have To Prepare
          </div>
        </div>

        {/* Card 4: Progress overview */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center justify-between">
            <span>Drum Winding Status</span>
            <Layers2 className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="space-y-1 my-1">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-emerald-700 font-extrabold">{overallPct}% Wound</span>
              <span className="text-amber-800 font-extrabold">{100 - overallPct}% Left</span>
            </div>
            <div className="w-full bg-amber-200 rounded-full h-2.5 overflow-hidden flex">
              <div
                className="bg-emerald-500 h-full transition-all duration-300"
                style={{ width: `${overallPct}%` }}
              />
              <div
                className="bg-amber-400 h-full transition-all duration-300"
                style={{ width: `${100 - overallPct}%` }}
              />
            </div>
          </div>
          <div className="text-[10px] text-slate-500">
            Auto-deducted step-wise as final stage is completed.
          </div>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200 no-print">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-bold text-slate-700 mr-1">Filter View:</span>

          <button
            type="button"
            onClick={() => setFilterMode('TO_PREPARE')}
            className={`px-2.5 py-1 rounded text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
              filterMode === 'TO_PREPARE'
                ? 'bg-amber-500 text-white shadow-xs font-black'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-amber-50'
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>⚡ Requisition Have To Prepare Only</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('DEDUCTED')}
            className={`px-2.5 py-1 rounded text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
              filterMode === 'DEDUCTED'
                ? 'bg-emerald-600 text-white shadow-xs font-black'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-emerald-50'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            <span>✓ Already Wound / Auto-Deducted</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('ALL')}
            className={`px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
              filterMode === 'ALL'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            📋 All Drums
          </button>
        </div>

        <div className="text-xs text-slate-500">
          Requisition To Prepare: <strong className="text-amber-800">{grandToPrepareDrums} Drums</strong>
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs text-left whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
            <tr>
              <th className="p-2 border-r border-slate-200">Drum Size</th>
              <th className="p-2 border-r border-slate-200 text-center">Status</th>
              <th className="p-2 border-r border-slate-200">Pallet Size</th>
              <th className="p-2 border-r border-slate-200 text-center">Bbn / Pallet</th>
              <th className="p-2 border-r border-slate-200 text-right">Total Drums Req</th>
              <th className="p-2 border-r border-slate-200 text-right text-emerald-800 bg-emerald-50/50">
                Already Wound (Deducted)
              </th>
              <th className="p-2 text-right font-black text-amber-950 bg-amber-100/70 border-r border-slate-200">
                ⚡ REQUISITION HAVE TO PREPARE (DRUMS)
              </th>
              <th className="p-2 border-r border-slate-200 text-right">Total Pallets Req</th>
              <th className="p-2 text-right font-bold text-amber-950 bg-amber-50">Pallets To Prepare</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredKeys.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-slate-400">
                  No drum requirements matching the current filter.
                </td>
              </tr>
            ) : (
              filteredKeys.map((spool, idx) => {
                const d = drumMap[spool];
                const isAllDone = d.toPrepareDrums === 0 && d.totalDrums > 0;
                const isPart = d.deductedDrums > 0 && d.toPrepareDrums > 0;

                return (
                  <tr
                    key={idx}
                    className={`hover:bg-slate-50 ${
                      isAllDone ? 'bg-emerald-50/20' : 'bg-white'
                    }`}
                  >
                    <td className="p-2 border-r border-slate-100 font-bold text-slate-900">
                      {d.spool}
                    </td>
                    <td className="p-2 border-r border-slate-100 text-center">
                      {isAllDone ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                          <Check className="w-3 h-3 text-emerald-700" />
                          <span>WOUND (DEDUCTED)</span>
                        </span>
                      ) : isPart ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                          <Clock className="w-3 h-3 text-amber-700" />
                          <span>PARTIAL ({d.deductedDrums}/{d.totalDrums})</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-950 border border-amber-400">
                          <Clock className="w-3 h-3 text-amber-700" />
                          <span>TO PREPARE</span>
                        </span>
                      )}
                    </td>
                    <td className="p-2 border-r border-slate-100 font-medium text-slate-700">
                      {d.pallet}
                    </td>
                    <td className="p-2 border-r border-slate-100 text-center font-semibold">
                      {d.bbnPerPallet}
                    </td>
                    <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-800">
                      {d.totalDrums}
                    </td>
                    <td className="p-2 border-r border-slate-100 text-right font-bold text-emerald-700 bg-emerald-50/30">
                      {d.deductedDrums > 0 ? d.deductedDrums : '—'}
                    </td>
                    <td className="p-2 border-r border-slate-200 text-right font-black text-amber-950 bg-amber-50">
                      {d.toPrepareDrums > 0 ? (
                        <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-950 font-black">
                          {d.toPrepareDrums} Drums
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-bold text-[11px]">✓ 0 Drums</span>
                      )}
                    </td>
                    <td className="p-2 border-r border-slate-100 text-right font-semibold text-slate-700">
                      {d.totalPallets}
                    </td>
                    <td className="p-2 text-right font-bold text-amber-950 bg-amber-50">
                      {d.toPreparePallets}
                    </td>
                  </tr>
                );
              })
            )}

            {/* Table Footer */}
            <tr className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300 text-xs">
              <td colSpan={4} className="p-2 border-r border-slate-200 uppercase">
                Grand Total {filterMode !== 'ALL' ? `(${filterMode})` : ''}
              </td>
              <td className="p-2 border-r border-slate-200 text-right">
                {grandTotalDrums}
              </td>
              <td className="p-2 border-r border-slate-200 text-right text-emerald-800 bg-emerald-100/50">
                {grandDeductedDrums}
              </td>
              <td className="p-2 border-r border-slate-200 text-right font-black text-amber-950 bg-amber-200/80">
                {grandToPrepareDrums}
              </td>
              <td className="p-2 border-r border-slate-200 text-right">
                {grandTotalPallets}
              </td>
              <td className="p-2 text-right font-black text-amber-950 bg-amber-200/80">
                {grandToPreparePallets}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {(skippedIs694Count > 0 || skippedCoilsCount > 0) && (
        <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-lg text-xs space-y-1 text-amber-950">
          <div className="font-bold flex items-center gap-1.5">
            <span>📦 Note on IS-694 &amp; Coil Orders:</span>
          </div>
          <p className="text-[11px] text-amber-900">
            {skippedIs694Count > 0 && `${skippedIs694Count} IS-694 order(s) (${skippedIs694Coils.toLocaleString()} coils) `}
            {skippedCoilsCount > 0 && `${skippedCoilsCount} order(s) with coil specs (${skippedCoilsTotal.toLocaleString()} coils) `}
            bypass drum requisition (packed in Master Cartons / Coils, Drum Size: N/A).
          </p>
        </div>
      )}
    </div>
  );
};
