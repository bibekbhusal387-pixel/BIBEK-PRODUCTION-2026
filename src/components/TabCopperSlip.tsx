import React, { useState } from 'react';
import { CableOrder, DensitySettings, LadiDimensionRule } from '../types/cable';
import {
  computeRecordRow,
  expandOrdersForMaterialRequirements,
  exportCsvFile,
  isOrderBunched,
  parseConductor,
} from '../utils/calculations';
import { Zap, Search, Printer, CheckCircle2, Clock, Check, RotateCcw } from 'lucide-react';

interface TabCopperSlipProps {
  orders: CableOrder[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  notes: string;
  onUpdateNotes: (notes: string) => void;
  onToggleProcess?: (orderId: number, processKey: 'b' | 'c' | 'i' | 't' | 's') => void;
  onNavigateToProcessCard?: (batch: string, brand: string, size: string, orderId?: number) => void;
}

export const TabCopperSlip: React.FC<TabCopperSlipProps> = ({
  orders,
  densities,
  ladiDimensions,
  notes,
  onUpdateNotes,
  onToggleProcess,
  onNavigateToProcessCard,
}) => {
  const [filterBatch, setFilterBatch] = useState('');
  const [bunchFilter, setBunchFilter] = useState<'ALL' | 'TO_BUNCH' | 'BUNCHED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const expandedOrders = expandOrdersForMaterialRequirements(orders);
  const uniqueBatches = Array.from(new Set(expandedOrders.map(o => o.batch))).sort();

  interface JobGroup {
    batch: string;
    brand: string;
    grade: string;
    conductor: string;
    size: string;
    orderLen: number;
    coreLen: number;
    cuTotal: number;
    cuBunched: number;
    cuToBunch: number;
    totalCount: number;
    bunchedCount: number;
    orders: CableOrder[];
    hasPreBunchedStock: boolean;
  }

  const jobMap: Record<string, JobGroup> = {};

  const strandDiaMap: Record<string, { total: number; bunched: number; toBunch: number }> = {
    '0.18': { total: 0, bunched: 0, toBunch: 0 },
    '0.20': { total: 0, bunched: 0, toBunch: 0 },
    '0.21': { total: 0, bunched: 0, toBunch: 0 },
    '0.26': { total: 0, bunched: 0, toBunch: 0 },
    '0.265': { total: 0, bunched: 0, toBunch: 0 },
    '0.266': { total: 0, bunched: 0, toBunch: 0 },
    'Other': { total: 0, bunched: 0, toBunch: 0 },
  };

  expandedOrders.forEach(o => {
    if (filterBatch && o.batch !== filterBatch) return;
    const r = computeRecordRow(o, densities, ladiDimensions);
    const grade = o.grade || 'H05VV-F';
    const cond = o.conductor || '';
    const reqCu = r.reqCu || 0;
    const isBunched = isOrderBunched(o);
    const cuBunched = isBunched ? reqCu : 0;
    const cuToBunch = isBunched ? 0 : reqCu;

    const searchStr = `${o.batch} ${o.brand} ${grade} ${o.size} ${cond}`.toLowerCase();
    if (searchQuery && !searchStr.includes(searchQuery.toLowerCase())) return;

    const key = `${o.batch}||${o.brand}||${grade}||${cond}`;
    if (!jobMap[key]) {
      jobMap[key] = {
        batch: o.batch,
        brand: o.brand,
        grade,
        conductor: cond,
        size: o.size,
        orderLen: 0,
        coreLen: 0,
        cuTotal: 0,
        cuBunched: 0,
        cuToBunch: 0,
        totalCount: 0,
        bunchedCount: 0,
        orders: [],
        hasPreBunchedStock: false,
      };
    }

    jobMap[key].orderLen += r.orderLen;
    jobMap[key].coreLen += r.reqCoreLen;
    jobMap[key].cuTotal += reqCu;
    jobMap[key].cuBunched += cuBunched;
    jobMap[key].cuToBunch += cuToBunch;
    jobMap[key].totalCount++;
    if (isBunched) jobMap[key].bunchedCount++;
    jobMap[key].orders.push(o);
    if (o.bunch_source === 'purchased_stock') {
      jobMap[key].hasPreBunchedStock = true;
    }

    // Strand dia breakdown
    const parsed = parseConductor(cond);
    const dStr =
      parsed.dia > 0
        ? parsed.dia.toFixed(3).replace(/\.0+$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1')
        : '';
    const diaKey = dStr && strandDiaMap[dStr] !== undefined ? dStr : 'Other';

    strandDiaMap[diaKey].total += reqCu;
    strandDiaMap[diaKey].bunched += cuBunched;
    strandDiaMap[diaKey].toBunch += cuToBunch;
  });

  // Calculate overall totals across all grouped jobs
  let totalOrderLenAll = 0;
  let totalCoreLenAll = 0;
  let totalCuAll = 0;
  let totalCuBunchedAll = 0;
  let totalCuToBunchAll = 0;
  let totalBunchedOrdersAll = 0;
  let totalOrdersCountAll = 0;

  Object.values(jobMap).forEach(j => {
    totalOrderLenAll += j.orderLen;
    totalCoreLenAll += j.coreLen;
    totalCuAll += j.cuTotal;
    totalCuBunchedAll += j.cuBunched;
    totalCuToBunchAll += j.cuToBunch;
    totalBunchedOrdersAll += j.bunchedCount;
    totalOrdersCountAll += j.totalCount;
  });

  // Filter jobs based on bunchFilter selection
  const filteredJobs = Object.values(jobMap).filter(j => {
    if (bunchFilter === 'TO_BUNCH') {
      return j.cuToBunch > 0.001;
    }
    if (bunchFilter === 'BUNCHED') {
      return j.cuBunched > 0.001 && j.cuToBunch <= 0.001;
    }
    return true;
  });

  // Filtered totals for current view
  const viewOrderLen = filteredJobs.reduce((s, j) => s + j.orderLen, 0);
  const viewCoreLen = filteredJobs.reduce((s, j) => s + j.coreLen, 0);
  const viewCuTotal = filteredJobs.reduce((s, j) => s + j.cuTotal, 0);
  const viewCuBunched = filteredJobs.reduce((s, j) => s + j.cuBunched, 0);
  const viewCuToBunch = filteredJobs.reduce((s, j) => s + j.cuToBunch, 0);

  // Strand dia totals
  let totalStrandTotal = 0;
  let totalStrandBunched = 0;
  let totalStrandToBunch = 0;
  Object.values(strandDiaMap).forEach(v => {
    totalStrandTotal += v.total;
    totalStrandBunched += v.bunched;
    totalStrandToBunch += v.toBunch;
  });

  const completionPct =
    totalCuAll > 0 ? Math.round((totalCuBunchedAll / totalCuAll) * 100) : 0;

  const handleExportCSV = () => {
    const rows: (string | number)[][] = [
      [
        'Batch / Job Order',
        'Bunch Status',
        'Brand',
        'Grade',
        'Copper Size / Conductor',
        'Total Order Length (m)',
        'Total Core Length (m)',
        'Total Copper Req (kg)',
        'Already Bunched / Deducted (kg)',
        'Requisition Have To Bunch (kg)',
      ],
    ];

    filteredJobs.forEach(j => {
      const isAllBunched = j.cuToBunch <= 0.001;
      const isPartBunched = j.bunchedCount > 0 && j.cuToBunch > 0.001;
      const status = isAllBunched
        ? 'Bunched (Deducted)'
        : isPartBunched
        ? `Partial (${j.bunchedCount}/${j.totalCount})`
        : 'Have To Bunch';

      rows.push([
        j.batch,
        status,
        j.brand,
        j.grade,
        j.conductor,
        j.orderLen,
        j.coreLen,
        j.cuTotal.toFixed(2),
        j.cuBunched.toFixed(2),
        j.cuToBunch.toFixed(2),
      ]);
    });

    rows.push([
      'TOTAL',
      `${totalBunchedOrdersAll}/${totalOrdersCountAll} Bunched (${completionPct}%)`,
      '',
      '',
      '',
      viewOrderLen,
      viewCoreLen,
      viewCuTotal.toFixed(2),
      viewCuBunched.toFixed(2),
      viewCuToBunch.toFixed(2),
    ]);

    const batchSuffix = filterBatch ? `_${filterBatch.replace(/[/\\\s]/g, '_')}` : '_All_Batches';
    const filterSuffix = bunchFilter !== 'ALL' ? `_${bunchFilter}` : '';
    exportCsvFile(`Copper_Requisition_Slip${batchSuffix}${filterSuffix}.csv`, rows);
  };

  const handleToggleBunchForJob = (job: JobGroup) => {
    if (!onToggleProcess || job.orders.length === 0) return;
    // If all are bunched, toggle first one to unbunch; otherwise bunch the unbunched ones
    const allBunched = job.bunchedCount === job.totalCount;
    if (allBunched) {
      job.orders.forEach(o => {
        onToggleProcess(o.id, 'b');
      });
    } else {
      job.orders.forEach(o => {
        if (!isOrderBunched(o)) {
          onToggleProcess(o.id, 'b');
        }
      });
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-5">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-200 gap-2">
        <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
          <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
          <span>🔌 COPPER REQUISITION SLIP &amp; STRAND BREAKDOWN SUMMARY</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap no-print">
          <select
            value={filterBatch}
            onChange={(e) => setFilterBatch(e.target.value)}
            className="text-xs px-2.5 py-1.5 border border-slate-300 rounded font-semibold bg-white"
          >
            <option value="">All Batches / Job Orders ({uniqueBatches.length})</option>
            {uniqueBatches.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          <div className="relative">
            <input
              type="text"
              placeholder="Search Brand, Grade, Copper Size..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs pl-7 pr-2.5 py-1.5 border border-slate-300 rounded w-48 bg-white"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          </div>

          <button
            onClick={handleExportCSV}
            className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold transition-colors"
          >
            ⬇ Export Copper Slip CSV
          </button>

          <button
            onClick={() => window.print()}
            className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
            title="Print current page"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>Print Copper Slip</span>
          </button>
        </div>
      </div>

      {/* KPI Cards: Total Req vs Bunched (Auto-Deducted) vs Requisition Have To Bunch */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Total Gross Required */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wide">
            <span>Total Copper Requisition</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold">
              Gross Required
            </span>
          </div>
          <div className="mt-1.5 text-2xl font-black text-slate-900">
            {totalCuAll.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-xs font-bold text-slate-500 ml-1">kg</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Total for {totalOrdersCountAll} cable orders ({totalOrderLenAll.toLocaleString()} m cable)
          </div>
        </div>

        {/* Card 2: Already Bunched (Auto-Deducted) */}
        <div className="bg-emerald-50/70 border-2 border-emerald-300 rounded-xl p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-bold text-emerald-900 uppercase tracking-wide">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Already Bunched</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-900 text-[10px] font-black">
              ✓ Auto-Deducted
            </span>
          </div>
          <div className="mt-1.5 text-2xl font-black text-emerald-800">
            {totalCuBunchedAll.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-xs font-bold text-emerald-600 ml-1">kg</span>
          </div>
          <div className="text-[11px] text-emerald-700 mt-1 font-semibold flex items-center justify-between">
            <span>{totalBunchedOrdersAll} of {totalOrdersCountAll} Orders Bunched</span>
            <span>{completionPct}% Complete</span>
          </div>
        </div>

        {/* Card 3: REQUISITION THAT HAVE TO BUNCH (Pending) */}
        <div className="bg-gradient-to-br from-amber-50 via-amber-100/60 to-orange-50 border-2 border-amber-400 rounded-xl p-3.5 shadow-xs ring-2 ring-amber-400/30">
          <div className="flex items-center justify-between text-[11px] font-black text-amber-950 uppercase tracking-wide">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
              <span>Have To Bunch</span>
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-black tracking-wider uppercase shadow-2xs">
              ⚡ Active Requisition
            </span>
          </div>
          <div className="mt-1.5 text-2xl font-black text-amber-950">
            {totalCuToBunchAll.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-xs font-bold text-amber-800 ml-1">kg</span>
          </div>
          <div className="text-[11px] text-amber-900 mt-1 font-bold flex items-center justify-between">
            <span>Pending Requisition to Bunch</span>
            <span className="bg-amber-200 px-1.5 py-0.2 rounded text-[10.5px]">
              {totalOrdersCountAll - totalBunchedOrdersAll} Orders Left
            </span>
          </div>
        </div>

        {/* Card 4: Progress Bar & Direct Quick Filter */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
            Bunching Requisition Status
          </div>
          <div className="space-y-1.5 my-1">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-emerald-700 font-extrabold">{completionPct}% Bunched</span>
              <span className="text-amber-800 font-extrabold">{100 - completionPct}% To Bunch</span>
            </div>
            <div className="w-full bg-amber-200 rounded-full h-3 overflow-hidden flex">
              <div
                className="bg-emerald-500 h-full transition-all duration-300"
                style={{ width: `${completionPct}%` }}
                title={`Already Bunched: ${totalCuBunchedAll.toFixed(1)} kg`}
              />
              <div
                className="bg-amber-400 h-full transition-all duration-300"
                style={{ width: `${100 - completionPct}%` }}
                title={`Have To Bunch: ${totalCuToBunchAll.toFixed(1)} kg`}
              />
            </div>
          </div>
          <div className="text-[10.5px] text-slate-500">
            Deductions auto-update when bunching is marked complete or allocated.
          </div>
        </div>
      </div>

      {/* Filter View Selector Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 no-print">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-bold text-slate-700 mr-1">Filter View:</span>

          <button
            type="button"
            onClick={() => setBunchFilter('TO_BUNCH')}
            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
              bunchFilter === 'TO_BUNCH'
                ? 'bg-amber-500 text-white shadow-xs ring-2 ring-amber-400/40'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-amber-50 hover:text-amber-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>⚡ Requisition Have To Bunch Only ({filteredJobs.filter(j => j.cuToBunch > 0.001).length})</span>
          </button>

          <button
            type="button"
            onClick={() => setBunchFilter('BUNCHED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
              bunchFilter === 'BUNCHED'
                ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-500/40'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-emerald-50 hover:text-emerald-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>✓ Already Bunched / Auto-Deducted ({filteredJobs.filter(j => j.cuBunched > 0.001 && j.cuToBunch <= 0.001).length})</span>
          </button>

          <button
            type="button"
            onClick={() => setBunchFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              bunchFilter === 'ALL'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            📋 All Orders ({Object.keys(jobMap).length})
          </button>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <strong className="text-slate-900">{filteredJobs.length}</strong> items •{' '}
          Requisition To Bunch: <strong className="text-amber-800">{viewCuToBunch.toFixed(2)} kg</strong>
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg print-card shadow-2xs">
        <table className="w-full text-xs text-left whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
            <tr>
              <th className="p-2 border-r border-slate-200">Batch / Job Order</th>
              <th className="p-2 border-r border-slate-200 text-center">Bunch Status</th>
              <th className="p-2 border-r border-slate-200">Brand</th>
              <th className="p-2 border-r border-slate-200">Grade</th>
              <th className="p-2 border-r border-slate-200">Copper Size / Conductor</th>
              <th className="p-2 border-r border-slate-200 text-right">Total Order Length (m)</th>
              <th className="p-2 border-r border-slate-200 text-right">Total Core Length (m)</th>
              <th className="p-2 border-r border-slate-200 text-right">Total Copper Req (kg)</th>
              <th className="p-2 border-r border-slate-200 text-right text-emerald-800 bg-emerald-50/50">
                Already Bunched (Deducted)
              </th>
              <th className="p-2.5 text-right font-black text-amber-950 bg-amber-100/70 border-r border-slate-200">
                ⚡ REQUISITION HAVE TO BUNCH (KG)
              </th>
              <th className="p-2 text-center no-print">Quick Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={11} className="p-8 text-center text-slate-400 font-medium">
                  No orders match the current filter or search criteria.
                </td>
              </tr>
            ) : (
              filteredJobs.map((j, idx) => {
                const isAllBunched = j.cuToBunch <= 0.001;
                const isPartBunched = j.bunchedCount > 0 && j.cuToBunch > 0.001;

                return (
                  <tr
                    key={idx}
                    className={`hover:bg-slate-50 transition-colors ${
                      isAllBunched ? 'bg-emerald-50/20' : 'bg-white'
                    }`}
                  >
                    <td className="p-2 border-r border-slate-100 font-bold text-slate-900">
                      {j.batch}
                    </td>

                    <td className="p-2 border-r border-slate-100 text-center">
                      {isAllBunched ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                          <Check className="w-3 h-3 text-emerald-700" />
                          <span>BUNCHED (DEDUCTED)</span>
                        </span>
                      ) : isPartBunched ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                          <Clock className="w-3 h-3 text-amber-700" />
                          <span>PARTIAL ({j.bunchedCount}/{j.totalCount})</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-950 border border-amber-400">
                          <Clock className="w-3 h-3 text-amber-700" />
                          <span>HAVE TO BUNCH</span>
                        </span>
                      )}
                    </td>

                    <td className="p-2 border-r border-slate-100 font-semibold">{j.brand}</td>
                    <td className="p-2 border-r border-slate-100 font-medium text-slate-700">{j.grade}</td>

                    <td className="p-2 border-r border-slate-100 font-mono text-[11px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900">{j.conductor}</span>
                        {j.hasPreBunchedStock && (
                          <span className="px-1.5 py-0.2 rounded bg-purple-100 border border-purple-200 text-purple-900 text-[9px] font-black uppercase">
                            ⚡ Pre-Bunched Stock
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="p-2 border-r border-slate-100 text-right">{j.orderLen.toLocaleString()} m</td>
                    <td className="p-2 border-r border-slate-100 text-right font-semibold text-slate-700">
                      {j.coreLen.toLocaleString()} m
                    </td>

                    <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-800">
                      {j.cuTotal.toFixed(2)} kg
                    </td>

                    <td className="p-2 border-r border-slate-100 text-right font-bold text-emerald-700 bg-emerald-50/30">
                      {j.cuBunched > 0 ? `${j.cuBunched.toFixed(2)} kg` : '—'}
                    </td>

                    <td className="p-2.5 border-r border-slate-200 text-right font-black text-amber-950 bg-amber-50">
                      {j.cuToBunch > 0.001 ? (
                        <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-950 font-black shadow-2xs">
                          {j.cuToBunch.toFixed(2)} kg
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-bold text-[11px]">✓ 0.00 kg (Done)</span>
                      )}
                    </td>

                    <td className="p-2 text-center no-print">
                      <div className="flex items-center justify-center gap-1">
                        {onToggleProcess && (
                          <button
                            type="button"
                            onClick={() => handleToggleBunchForJob(j)}
                            className={`px-2 py-1 rounded text-[10.5px] font-bold cursor-pointer transition-colors shadow-2xs ${
                              isAllBunched
                                ? 'bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-800 border border-slate-300'
                                : 'bg-amber-600 hover:bg-amber-700 text-white font-black'
                            }`}
                            title={isAllBunched ? 'Click to undo Bunching' : 'Click to complete Bunching (auto-deducts copper)'}
                          >
                            {isAllBunched ? (
                              <span className="flex items-center gap-1">
                                <RotateCcw className="w-3 h-3" />
                                <span>Undo</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1">
                                <Check className="w-3 h-3" />
                                <span>Bunch Copper</span>
                              </span>
                            )}
                          </button>
                        )}

                        {onNavigateToProcessCard && (
                          <button
                            type="button"
                            onClick={() =>
                              onNavigateToProcessCard(
                                j.batch,
                                j.brand,
                                j.size,
                                j.orders[0]?.id
                              )
                            }
                            className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-[10.5px] font-semibold cursor-pointer"
                            title="Open Stage 1 Bunching Process Card"
                          >
                            Card ↗
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}

            {/* Table Footer Totals */}
            <tr className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300 text-xs">
              <td colSpan={5} className="p-2.5 border-r border-slate-200 uppercase">
                TOTAL {bunchFilter !== 'ALL' ? `(${bunchFilter})` : ''}
              </td>
              <td className="p-2.5 border-r border-slate-200 text-right">
                {viewOrderLen.toLocaleString()} m
              </td>
              <td className="p-2.5 border-r border-slate-200 text-right">
                {viewCoreLen.toLocaleString()} m
              </td>
              <td className="p-2.5 border-r border-slate-200 text-right text-slate-900">
                {viewCuTotal.toFixed(2)} kg
              </td>
              <td className="p-2.5 border-r border-slate-200 text-right text-emerald-800 bg-emerald-100/50">
                {viewCuBunched.toFixed(2)} kg
              </td>
              <td className="p-2.5 border-r border-slate-200 text-right font-black text-amber-950 bg-amber-200/80">
                {viewCuToBunch.toFixed(2)} kg
              </td>
              <td className="p-2.5 text-center no-print text-[11px] font-bold text-slate-600">
                {bunchFilter === 'ALL' && `${completionPct}% Done`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Strand Dia-wise Breakdown Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 print-card">
        {/* Strand Dia Breakdown Table */}
        <div className="lg:col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-wide">
                Strand Dia-wise Copper Breakdown &amp; Requisition
              </h4>
              <p className="text-[11px] text-slate-500">
                Wire size breakdown showing Total Required, Already Bunched (Auto-Deducted), and Requisition Have To Bunch
              </p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-950 font-black border border-amber-300">
              ⚡ Live Requisition Auto-Deduction
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded bg-white">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] border-b border-slate-200">
                <tr>
                  <th className="p-2 border-r border-slate-200">Copper Size / Dia (mm)</th>
                  <th className="p-2 border-r border-slate-200 text-right">Total Required (kg)</th>
                  <th className="p-2 border-r border-slate-200 text-right text-emerald-700 bg-emerald-50/50">
                    Already Bunched (kg)
                  </th>
                  <th className="p-2 text-right font-black text-amber-950 bg-amber-100/70 border-r border-slate-200">
                    ⚡ REQUISITION HAVE TO BUNCH (KG)
                  </th>
                  <th className="p-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(strandDiaMap).map(([dia, data]) => {
                  if (data.total <= 0) return null;
                  const diaDone = data.toBunch <= 0.001;
                  const diaPct = data.total > 0 ? Math.round((data.bunched / data.total) * 100) : 0;

                  return (
                    <tr key={dia} className="hover:bg-slate-50">
                      <td className="p-2 border-r border-slate-100 font-bold text-slate-900">
                        {dia === 'Other' ? 'Other Wire Dia' : `${dia} mm`}
                      </td>
                      <td className="p-2 border-r border-slate-100 text-right font-semibold text-slate-700">
                        {data.total.toFixed(2)} kg
                      </td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold text-emerald-700 bg-emerald-50/30">
                        {data.bunched > 0 ? `${data.bunched.toFixed(2)} kg` : '—'}
                      </td>
                      <td className="p-2 border-r border-slate-200 text-right font-black text-amber-950 bg-amber-50">
                        {data.toBunch > 0.001 ? (
                          <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-950 font-black">
                            {data.toBunch.toFixed(2)} kg
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-bold">✓ 0.00 kg</span>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                            diaDone
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {diaDone ? '✓ 100% Bunched' : `${diaPct}% Bunched`}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                <tr className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300">
                  <td className="p-2 border-r border-slate-200">TOTAL COPPER WT</td>
                  <td className="p-2 border-r border-slate-200 text-right">
                    {totalStrandTotal.toFixed(2)} kg
                  </td>
                  <td className="p-2 border-r border-slate-200 text-right text-emerald-800 bg-emerald-100/50">
                    {totalStrandBunched.toFixed(2)} kg
                  </td>
                  <td className="p-2 border-r border-slate-200 text-right font-black text-amber-950 bg-amber-200/80">
                    {totalStrandToBunch.toFixed(2)} kg
                  </td>
                  <td className="p-2 text-center text-[10px] text-slate-600">
                    {completionPct}% Complete
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Dispatch / Receiving Notes Card */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-col justify-between space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
              DISPATCH / RECEIVING NOTES:
            </label>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => onUpdateNotes(e.target.value)}
              placeholder="Enter copper bunching notes, delivery supplier remarks, spool/drum specs..."
              className="w-full p-2 border border-slate-300 rounded font-semibold text-xs bg-white text-slate-800 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="p-2.5 rounded-lg bg-blue-50/80 border border-blue-200 text-blue-950 text-xs space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-blue-600" />
              <span>How Auto-Deduction Works:</span>
            </div>
            <p className="text-[11px] text-blue-900">
              When an order's Bunching stage (<strong>B</strong>) is marked done or pre-bunched stock is allocated, its copper weight is instantly deducted from the active Requisition. The pending quantity automatically updates here in real time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
