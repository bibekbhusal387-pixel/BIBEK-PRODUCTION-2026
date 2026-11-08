import React, { useState } from 'react';
import { CableOrder, DensitySettings, LadiDimensionRule } from '../types/cable';
import {
  computeRecordRow,
  expandOrdersForMaterialRequirements,
  exportCsvFile,
  isOrderInsulated,
  isOrderSheathed,
} from '../utils/calculations';
import { FileSpreadsheet, Search, Printer, CheckCircle2, Clock, Check, Layers2 } from 'lucide-react';

interface TabPvcSlipProps {
  orders: CableOrder[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  customOverrides: Record<string, any>;
  onUpdateOverride: (gradeKey: string, field: string, value: any) => void;
  onToggleProcess?: (orderId: number, processKey: 'b' | 'c' | 'i' | 't' | 's') => void;
}

interface CompoundItem {
  name: string;
  stageUsage: 'Insulation' | 'Sheathing' | 'Both';
  qtyTotal: number;
  qtyDeducted: number;
  qtyToExtrude: number;
  totalOrders: number;
  completedOrders: number;
  batches: Set<string>;
}

export const TabPvcSlip: React.FC<TabPvcSlipProps> = ({
  orders,
  densities,
  ladiDimensions,
  customOverrides,
  onUpdateOverride,
}) => {
  const [filterBatch, setFilterBatch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'TO_EXTRUDE' | 'DEDUCTED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const expandedOrders = expandOrdersForMaterialRequirements(orders);
  const uniqueBatches = Array.from(new Set(expandedOrders.map(o => o.batch))).sort();

  // Aggregate compound requirements with step-wise auto-deduction
  const compoundMap: Record<string, CompoundItem> = {};

  expandedOrders.forEach(o => {
    if (filterBatch && o.batch !== filterBatch) return;
    const r = computeRecordRow(o, densities, ladiDimensions);
    const isInsDone = isOrderInsulated(o);
    const isSheathDone = isOrderSheathed(o);

    // Insulation Compound (Step-Wise Auto-Deducted when stage 'i' is completed)
    if (r.reqIns > 0 && o.ins_compound) {
      const name = o.ins_compound.trim();
      if (!compoundMap[name]) {
        compoundMap[name] = {
          name,
          stageUsage: 'Insulation',
          qtyTotal: 0,
          qtyDeducted: 0,
          qtyToExtrude: 0,
          totalOrders: 0,
          completedOrders: 0,
          batches: new Set<string>(),
        };
      }
      compoundMap[name].qtyTotal += r.reqIns;
      if (isInsDone) {
        compoundMap[name].qtyDeducted += r.reqIns;
        compoundMap[name].completedOrders++;
      } else {
        compoundMap[name].qtyToExtrude += r.reqIns;
      }
      compoundMap[name].totalOrders++;
      if (o.batch) compoundMap[name].batches.add(o.batch);
    }

    // Sheath Compound (Step-Wise Auto-Deducted when stage 's' is completed)
    if (r.reqSheath > 0 && o.sheath_compound) {
      const name = o.sheath_compound.trim();
      if (!compoundMap[name]) {
        compoundMap[name] = {
          name,
          stageUsage: 'Sheathing',
          qtyTotal: 0,
          qtyDeducted: 0,
          qtyToExtrude: 0,
          totalOrders: 0,
          completedOrders: 0,
          batches: new Set<string>(),
        };
      } else if (compoundMap[name].stageUsage === 'Insulation') {
        compoundMap[name].stageUsage = 'Both';
      }
      compoundMap[name].qtyTotal += r.reqSheath;
      if (isSheathDone) {
        compoundMap[name].qtyDeducted += r.reqSheath;
        compoundMap[name].completedOrders++;
      } else {
        compoundMap[name].qtyToExtrude += r.reqSheath;
      }
      compoundMap[name].totalOrders++;
      if (o.batch) compoundMap[name].batches.add(o.batch);
    }
  });

  const compoundsList = Object.values(compoundMap).sort((a, b) => a.name.localeCompare(b.name));

  // Overall totals
  let grandTotalGross = 0;
  let grandTotalDeducted = 0;
  let grandTotalToExtrude = 0;
  let grandTotalOrders = 0;
  let grandCompletedOrders = 0;

  compoundsList.forEach(c => {
    grandTotalGross += c.qtyTotal;
    grandTotalDeducted += c.qtyDeducted;
    grandTotalToExtrude += c.qtyToExtrude;
    grandTotalOrders += c.totalOrders;
    grandCompletedOrders += c.completedOrders;
  });

  const overallPct =
    grandTotalGross > 0 ? Math.round((grandTotalDeducted / grandTotalGross) * 100) : 0;

  // Filter compounds based on search query and status filter
  const filteredCompounds = compoundsList.filter(comp => {
    if (statusFilter === 'TO_EXTRUDE' && comp.qtyToExtrude <= 0.001) return false;
    if (statusFilter === 'DEDUCTED' && (comp.qtyDeducted <= 0.001 || comp.qtyToExtrude > 0.001)) {
      return false;
    }

    if (searchQuery.trim()) {
      const ov = customOverrides[comp.name] || {};
      const s = `${comp.name} ${comp.stageUsage} ${ov.remark || ''}`.toLowerCase();
      if (!s.includes(searchQuery.toLowerCase().trim())) return false;
    }

    return true;
  });

  const viewTotalGross = filteredCompounds.reduce((s, c) => s + c.qtyTotal, 0);
  const viewTotalDeducted = filteredCompounds.reduce((s, c) => s + c.qtyDeducted, 0);
  const viewTotalToExtrude = filteredCompounds.reduce((s, c) => s + c.qtyToExtrude, 0);

  const todayStr = '28.10.2026';

  const handleExportCSV = () => {
    const rows = [
      [
        'No.',
        'Date',
        'Compound Name',
        'Process Stage',
        'Status',
        'Unit',
        'Total Gross Req (kg)',
        'Extruded / Deducted (kg)',
        'Requisition Have To Extrude (kg)',
        'Purchase Qty (kg)',
        'Required Date',
        'Remark',
      ],
    ];

    filteredCompounds.forEach((comp, idx) => {
      const ov = customOverrides[comp.name] || {};
      const unit = ov.unit !== undefined ? ov.unit : 'KGS';
      const manualQty = ov.manualQty !== undefined ? ov.manualQty : '';
      const effectiveQty =
        manualQty !== '' ? parseFloat(manualQty) || 0 : Math.round(comp.qtyToExtrude);
      const date = ov.date !== undefined ? ov.date : todayStr;
      const reqDate = ov.reqDate !== undefined ? ov.reqDate : '';
      const remark =
        ov.remark !== undefined
          ? ov.remark
          : comp.qtyToExtrude <= 0.001
          ? 'Completed & auto-deducted'
          : `Active requisition for ${comp.batches.size} batch(es)`;

      const isAllDone = comp.qtyToExtrude <= 0.001;
      const statusText = isAllDone
        ? 'Extruded (Deducted)'
        : comp.qtyDeducted > 0.001
        ? `Partial (${comp.completedOrders}/${comp.totalOrders})`
        : 'Have To Extrude';

      rows.push([
        idx + 1,
        date,
        comp.name,
        comp.stageUsage,
        statusText,
        unit,
        comp.qtyTotal.toFixed(2),
        comp.qtyDeducted.toFixed(2),
        comp.qtyToExtrude.toFixed(2),
        effectiveQty,
        reqDate,
        remark,
      ]);
    });

    rows.push([
      'TOTAL',
      '',
      '',
      '',
      `${grandCompletedOrders}/${grandTotalOrders} Extruded (${overallPct}%)`,
      'KGS',
      viewTotalGross.toFixed(2),
      viewTotalDeducted.toFixed(2),
      viewTotalToExtrude.toFixed(2),
      Math.round(viewTotalToExtrude).toString(),
      '',
      '',
    ]);

    const batchSuffix = filterBatch ? `_${filterBatch.replace(/[/\\\s]/g, '_')}` : '_All_Batches';
    const statusSuffix = statusFilter !== 'ALL' ? `_${statusFilter}` : '';
    exportCsvFile(`Material_Purchase_Requisition_Slip${batchSuffix}${statusSuffix}.csv`, rows);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-4 print-card">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-200 gap-2">
        <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
          <FileSpreadsheet className="w-4 h-4 text-purple-600" />
          <span>📝 MATERIAL PURCHASE REQUISITION SLIP (PVC &amp; Compounds — Step-Wise Auto-Deduction)</span>
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

          <div className="relative">
            <input
              type="text"
              placeholder="Search Compound, Remark..."
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
            ⬇ Export Slip CSV
          </button>

          <button
            onClick={() => window.print()}
            className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
            title="Print current page"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>Print Requisition Slip</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Cards: Gross Compound vs Already Extruded vs Requisition Have To Extrude */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Gross Requisition */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wide">
            <span>Total Compound Req</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold">
              Gross Required
            </span>
          </div>
          <div className="mt-1.5 text-2xl font-black text-slate-900">
            {grandTotalGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-xs font-bold text-slate-500 ml-1">kg</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Total compound for {grandTotalOrders} process executions across {compoundsList.length} compounds
          </div>
        </div>

        {/* Card 2: Already Extruded (Auto-Deducted) */}
        <div className="bg-emerald-50/70 border-2 border-emerald-300 rounded-xl p-3.5 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-bold text-emerald-900 uppercase tracking-wide">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Already Extruded</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-900 text-[10px] font-black">
              ✓ Auto-Deducted
            </span>
          </div>
          <div className="mt-1.5 text-2xl font-black text-emerald-800">
            {grandTotalDeducted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-xs font-bold text-emerald-600 ml-1">kg</span>
          </div>
          <div className="text-[11px] text-emerald-700 mt-1 font-semibold flex items-center justify-between">
            <span>Insulation (I) + Sheath (S) Extruded</span>
            <span>{overallPct}% Extruded</span>
          </div>
        </div>

        {/* Card 3: REQUISITION HAVE TO EXTRUDE / PURCHASE */}
        <div className="bg-gradient-to-br from-amber-50 via-amber-100/60 to-purple-50 border-2 border-amber-400 rounded-xl p-3.5 shadow-xs ring-2 ring-amber-400/30">
          <div className="flex items-center justify-between text-[11px] font-black text-amber-950 uppercase tracking-wide">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
              <span>Have To Extrude</span>
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-black tracking-wider uppercase shadow-2xs">
              ⚡ Active Requisition
            </span>
          </div>
          <div className="mt-1.5 text-2xl font-black text-amber-950">
            {grandTotalToExtrude.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-xs font-bold text-amber-800 ml-1">kg</span>
          </div>
          <div className="text-[11px] text-amber-900 mt-1 font-bold flex items-center justify-between">
            <span>Pending Requisition to Purchase/Extrude</span>
            <span className="bg-amber-200 px-1.5 py-0.2 rounded text-[10.5px]">
              {compoundsList.filter(c => c.qtyToExtrude > 0.001).length} Compounds Left
            </span>
          </div>
        </div>

        {/* Card 4: Progress overview */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wide flex items-center justify-between">
            <span>Step-Wise Extrusion Status</span>
            <Layers2 className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="space-y-1.5 my-1">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-emerald-700 font-extrabold">{overallPct}% Extruded</span>
              <span className="text-amber-800 font-extrabold">{100 - overallPct}% To Extrude</span>
            </div>
            <div className="w-full bg-amber-200 rounded-full h-3 overflow-hidden flex">
              <div
                className="bg-emerald-500 h-full transition-all duration-300"
                style={{ width: `${overallPct}%` }}
                title={`Already Extruded: ${grandTotalDeducted.toFixed(1)} kg`}
              />
              <div
                className="bg-amber-400 h-full transition-all duration-300"
                style={{ width: `${100 - overallPct}%` }}
                title={`Have To Extrude: ${grandTotalToExtrude.toFixed(1)} kg`}
              />
            </div>
          </div>
          <div className="text-[10.5px] text-slate-500">
            Auto-deducted step-wise as Insulation (I) and Sheathing (S) are completed.
          </div>
        </div>
      </div>

      {/* Filter View Selector Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 no-print">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-bold text-slate-700 mr-1">Filter View:</span>

          <button
            type="button"
            onClick={() => setStatusFilter('TO_EXTRUDE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
              statusFilter === 'TO_EXTRUDE'
                ? 'bg-amber-500 text-white shadow-xs ring-2 ring-amber-400/40'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-amber-50 hover:text-amber-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>⚡ Requisition Have To Extrude Only ({compoundsList.filter(c => c.qtyToExtrude > 0.001).length})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('DEDUCTED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
              statusFilter === 'DEDUCTED'
                ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-500/40'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-emerald-50 hover:text-emerald-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>✓ Already Extruded / Auto-Deducted ({compoundsList.filter(c => c.qtyDeducted > 0.001 && c.qtyToExtrude <= 0.001).length})</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            📋 All Compounds ({compoundsList.length})
          </button>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <strong className="text-slate-900">{filteredCompounds.length}</strong> items •{' '}
          Requisition To Extrude: <strong className="text-amber-800">{viewTotalToExtrude.toFixed(2)} kg</strong>
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-2xs">
        <table className="w-full text-xs text-left whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
            <tr>
              <th className="p-2 border-r border-slate-200">No.</th>
              <th className="p-2 border-r border-slate-200">Date</th>
              <th className="p-2 border-r border-slate-200">Compound Name</th>
              <th className="p-2 border-r border-slate-200 text-center">Stage</th>
              <th className="p-2 border-r border-slate-200 text-center">Extrusion Status</th>
              <th className="p-2 border-r border-slate-200 text-center">Unit</th>
              <th className="p-2 border-r border-slate-200 text-right">Total Gross Req (kg)</th>
              <th className="p-2 border-r border-slate-200 text-right text-emerald-800 bg-emerald-50/50">
                Already Extruded (Deducted)
              </th>
              <th className="p-2.5 text-right font-black text-amber-950 bg-amber-100/70 border-r border-slate-200">
                ⚡ REQUISITION HAVE TO EXTRUDE (KG)
              </th>
              <th className="p-2 border-r border-slate-200 text-right">Purchase Qty.</th>
              <th className="p-2 border-r border-slate-200">Required Date</th>
              <th className="p-2">Remark</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredCompounds.length === 0 ? (
              <tr>
                <td colSpan={12} className="p-8 text-center text-slate-400 font-medium">
                  No compound requirements for the selected batch or filter.
                </td>
              </tr>
            ) : (
              filteredCompounds.map((comp, idx) => {
                const ov = customOverrides[comp.name] || {};
                const unit = ov.unit !== undefined ? ov.unit : 'KGS';
                const manualQty = ov.manualQty !== undefined ? ov.manualQty : '';
                const effectiveQty =
                  manualQty !== '' ? parseFloat(manualQty) || 0 : Math.round(comp.qtyToExtrude);
                const date = ov.date !== undefined ? ov.date : todayStr;
                const reqDate = ov.reqDate !== undefined ? ov.reqDate : '';
                const remark =
                  ov.remark !== undefined
                    ? ov.remark
                    : comp.qtyToExtrude <= 0.001
                    ? 'Extrusion completed & auto-deducted'
                    : `Active for ${comp.batches.size} batch(es)`;

                const isAllDone = comp.qtyToExtrude <= 0.001;
                const isPart = comp.completedOrders > 0 && comp.qtyToExtrude > 0.001;

                return (
                  <tr
                    key={comp.name}
                    className={`hover:bg-slate-50 transition-colors ${
                      isAllDone ? 'bg-emerald-50/20' : 'bg-white'
                    }`}
                  >
                    <td className="p-2 border-r border-slate-100 text-slate-500 font-bold">{idx + 1}</td>
                    <td className="p-2 border-r border-slate-100">
                      <input
                        type="text"
                        value={date}
                        onChange={(e) => onUpdateOverride(comp.name, 'date', e.target.value)}
                        className="w-24 px-1.5 py-0.5 border border-slate-300 rounded bg-white text-xs text-slate-800"
                      />
                    </td>
                    <td className="p-2 border-r border-slate-100 font-bold text-slate-900">
                      {comp.name}
                    </td>
                    <td className="p-2 border-r border-slate-100 text-center font-bold">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          comp.stageUsage === 'Insulation'
                            ? 'bg-teal-100 text-teal-900'
                            : comp.stageUsage === 'Sheathing'
                            ? 'bg-purple-100 text-purple-900'
                            : 'bg-indigo-100 text-indigo-900'
                        }`}
                      >
                        {comp.stageUsage}
                      </span>
                    </td>
                    <td className="p-2 border-r border-slate-100 text-center">
                      {isAllDone ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                          <Check className="w-3 h-3 text-emerald-700" />
                          <span>EXTRUDED (DEDUCTED)</span>
                        </span>
                      ) : isPart ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                          <Clock className="w-3 h-3 text-amber-700" />
                          <span>PARTIAL ({comp.completedOrders}/{comp.totalOrders})</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-950 border border-amber-400">
                          <Clock className="w-3 h-3 text-amber-700" />
                          <span>HAVE TO EXTRUDE</span>
                        </span>
                      )}
                    </td>
                    <td className="p-2 border-r border-slate-100 text-center">
                      <input
                        type="text"
                        value={unit}
                        onChange={(e) => onUpdateOverride(comp.name, 'unit', e.target.value)}
                        className="w-16 px-1 py-0.5 border border-slate-300 rounded bg-white text-center text-xs text-slate-800"
                      />
                    </td>
                    <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-800">
                      {comp.qtyTotal.toFixed(2)} kg
                    </td>
                    <td className="p-2 border-r border-slate-100 text-right font-bold text-emerald-700 bg-emerald-50/30">
                      {comp.qtyDeducted > 0 ? `${comp.qtyDeducted.toFixed(2)} kg` : '—'}
                    </td>
                    <td className="p-2.5 border-r border-slate-200 text-right font-black text-amber-950 bg-amber-50">
                      {comp.qtyToExtrude > 0.001 ? (
                        <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-950 font-black shadow-2xs">
                          {comp.qtyToExtrude.toFixed(2)} kg
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-bold text-[11px]">✓ 0.00 kg (Done)</span>
                      )}
                    </td>
                    <td className="p-2 border-r border-slate-100 text-right" title={`Pending: ${comp.qtyToExtrude.toFixed(2)} kg (Gross: ${comp.qtyTotal.toFixed(2)} kg)`}>
                      <input
                        type="number"
                        step="1"
                        value={effectiveQty}
                        onChange={(e) => onUpdateOverride(comp.name, 'manualQty', e.target.value)}
                        placeholder={String(Math.round(comp.qtyToExtrude))}
                        className="w-24 px-1.5 py-0.5 border border-amber-400 bg-amber-50 rounded text-right font-black text-xs text-amber-950 focus:outline-none focus:border-amber-600"
                      />
                    </td>
                    <td className="p-2 border-r border-slate-100">
                      <input
                        type="text"
                        value={reqDate}
                        onChange={(e) => onUpdateOverride(comp.name, 'reqDate', e.target.value)}
                        placeholder="01.12.2026"
                        className="w-24 px-1.5 py-0.5 border border-slate-300 rounded bg-white text-xs text-slate-800"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={remark}
                        onChange={(e) => onUpdateOverride(comp.name, 'remark', e.target.value)}
                        className="w-full min-w-[200px] px-1.5 py-0.5 border border-slate-300 rounded bg-white text-xs text-slate-800"
                      />
                    </td>
                  </tr>
                );
              })
            )}

            {/* Table Footer */}
            <tr className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300 text-xs">
              <td colSpan={6} className="p-2.5 border-r border-slate-200 uppercase">
                TOTAL {statusFilter !== 'ALL' ? `(${statusFilter})` : ''}
              </td>
              <td className="p-2.5 border-r border-slate-200 text-right text-slate-900">
                {viewTotalGross.toFixed(2)} kg
              </td>
              <td className="p-2.5 border-r border-slate-200 text-right text-emerald-800 bg-emerald-100/50">
                {viewTotalDeducted.toFixed(2)} kg
              </td>
              <td className="p-2.5 border-r border-slate-200 text-right font-black text-amber-950 bg-amber-200/80">
                {viewTotalToExtrude.toFixed(2)} kg
              </td>
              <td className="p-2.5 border-r border-slate-200 text-right font-black text-amber-950">
                {Math.round(viewTotalToExtrude)} KGS
              </td>
              <td colSpan={2} className="p-2.5 text-slate-600 text-[11px] font-semibold">
                Auto-deducted step-wise as Insulation (I) and Sheathing (S) are marked done.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-lg text-xs text-purple-950 flex flex-wrap items-center justify-between gap-2">
        <span>
          ℹ️ <strong>Step-Wise Requisition Auto-Deduction Active:</strong> When an order reaches <strong>Insulation (I)</strong>, its insulation compound requirement is auto-deducted. When it reaches <strong>Sheathing (S)</strong>, its outer sheath compound is auto-deducted.
        </span>
        <span className="font-mono text-[10.5px] bg-purple-100 text-purple-900 px-2 py-0.5 rounded font-black border border-purple-300">
          Auto-Synced with Process Pipeline
        </span>
      </div>
    </div>
  );
};
