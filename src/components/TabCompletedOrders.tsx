import React, { useState } from 'react';
import { CableOrder, ContainerPlan, DensitySettings, LadiDimensionRule } from '../types/cable';
import { computeRecordRow, fmtExact, getContainerAssignmentsForOrder, getRequiredStagesForOrder, isIs694Order, isOrderComplete } from '../utils/calculations';
import { computeIs694CartonPackingForOrder, loadMaruMiracleCartonRules, loadVihanTriguardCartonRules } from '../utils/is694CartonPackaging';
import { Search, Copy, Trash2, CheckCircle2, Printer, Ship, Calendar, Package, Filter, X } from 'lucide-react';

interface TabCompletedOrdersProps {
  orders: CableOrder[];
  containers?: ContainerPlan[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  onToggleProcess: (orderId: number, processKey: 'b' | 'c' | 'i' | 't' | 's') => void;
  onSelectForRequisition: (batch: string, brand: string, size: string) => void;
  onOpenContainer?: (containerId?: string) => void;
  onDeleteOrder: (id: number) => void;
  onDuplicateOrder: (id: number) => void;
}

export const TabCompletedOrders: React.FC<TabCompletedOrdersProps> = ({
  orders,
  containers = [],
  densities,
  ladiDimensions,
  onToggleProcess,
  onSelectForRequisition,
  onOpenContainer,
  onDeleteOrder,
  onDuplicateOrder,
}) => {
  const [filterBatch, setFilterBatch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const completed = orders.filter(o => isOrderComplete(o, ladiDimensions));
  // Include all batches present in completed orders (as well as any batch in orders so user can check any batch)
  const uniqueBatches = Array.from(
    new Set([...completed.map(o => o.batch), ...orders.map(o => o.batch)].filter(Boolean))
  ).sort();

  const batchCompletedCounts: Record<string, number> = {};
  completed.forEach(o => {
    if (o.batch) {
      batchCompletedCounts[o.batch] = (batchCompletedCounts[o.batch] || 0) + 1;
    }
  });

  const filtered = completed.filter(o => {
    if (filterBatch && o.batch !== filterBatch) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const contMatches = getContainerAssignmentsForOrder(o, containers).some(
        ca =>
          ca.containerNo.toLowerCase().includes(q) ||
          (ca.plannedStuffingDate || '').toLowerCase().includes(q)
      );
      const match = o.batch.toLowerCase().includes(q)
        || o.brand.toLowerCase().includes(q)
        || o.size.toLowerCase().includes(q)
        || (o.grade || '').toLowerCase().includes(q)
        || o.conductor.toLowerCase().includes(q)
        || contMatches;
      if (!match) return false;
    }
    return true;
  });

  const vihanRules = loadVihanTriguardCartonRules();
  const maruRules = loadMaruMiracleCartonRules();

  let totalLen = 0;
  let totalCu = 0;
  let is694DoneCount = 0;
  let is694DoneCoils = 0;
  let is694DoneCartons = 0;
  let is694DoneLen = 0;
  let is694DoneCu = 0;
  let is694DoneIns = 0;

  filtered.forEach(o => {
    const r = computeRecordRow(o, densities, ladiDimensions);
    totalLen += r.orderLen;
    totalCu += r.reqCu;
    if (isIs694Order(o)) {
      is694DoneCount++;
      is694DoneLen += r.orderLen;
      is694DoneCu += r.reqCu;
      is694DoneIns += r.reqIns;
      const cr = computeIs694CartonPackingForOrder(o, densities, ladiDimensions, vihanRules, maruRules);
      is694DoneCoils += cr.totalCoils;
      is694DoneCartons += cr.totalCartons;
    }
  });

  return (
    <div className="space-y-4">
      {/* Batch Filter & Quick Isolation Bar */}
      <div className="bg-white border-2 border-emerald-600/80 rounded-xl p-3.5 shadow-2xs no-print space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Filter className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <span>Filter Completed Orders by Production Batch</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10.5px] font-bold">
                  Showing {filtered.length} of {completed.length} Completed
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Select a specific batch from the dropdown below to isolate its completed orders, total cable length, and processed copper weight
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor="completed-batch-filter" className="text-xs font-extrabold text-slate-700">
                📁 Production Batch:
              </label>
              <select
                id="completed-batch-filter"
                value={filterBatch}
                onChange={(e) => setFilterBatch(e.target.value)}
                className="text-xs px-3 py-1.5 border-2 border-emerald-600 rounded-lg font-extrabold bg-emerald-50/50 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 min-w-[210px] cursor-pointer"
              >
                <option value="">All Production Batches ({completed.length} Completed)</option>
                {uniqueBatches.map(b => (
                  <option key={b} value={b}>
                    {b} ({batchCompletedCounts[b] || 0} Completed)
                  </option>
                ))}
              </select>
            </div>

            {(filterBatch || searchQuery) && (
              <button
                type="button"
                onClick={() => {
                  setFilterBatch('');
                  setSearchQuery('');
                }}
                className="text-xs px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-colors"
                title="Reset batch and search filters"
              >
                <X className="w-3.5 h-3.5" /> Show All Batches
              </button>
            )}
          </div>
        </div>

        {uniqueBatches.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
            <span className="text-[10.5px] font-bold text-slate-500 uppercase mr-1">
              Quick Batch Isolate:
            </span>
            <button
              type="button"
              onClick={() => setFilterBatch('')}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                filterBatch === ''
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All Batches ({completed.length})
            </button>
            {uniqueBatches.map(b => (
              <button
                key={b}
                type="button"
                onClick={() => setFilterBatch(filterBatch === b ? '' : b)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                  filterBatch === b
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                📁 {b} ({batchCompletedCounts[b] || 0})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 border-l-4 border-l-green-600 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase">
            Completed Orders {filterBatch ? `(${filterBatch})` : ''}
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">{filtered.length} Items</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-green-600 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase">Total Cable Length</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{totalLen.toLocaleString()} m</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-green-600 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase">Total Copper Processed</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{totalCu.toFixed(2)} kg</div>
        </div>
      </div>

      {/* Separate Completed IS-694 Carton & Stock Attachment Summary */}
      {is694DoneCount > 0 && (
        <div className="bg-emerald-50/90 border-2 border-emerald-500 rounded-xl p-3 shadow-2xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10.5px] font-black uppercase flex items-center gap-1">
                <Package className="w-3 h-3" /> Separate Completed IS-694 Summary (Attached to Finished Carton Stock)
              </span>
              <span className="text-xs font-bold text-emerald-950">
                Final Stage Completed: <strong>1. Bunching (B) + 2. IS-694 Insulation (I)</strong> • Dispatched in Cartons (<strong>Drum Size: N/A</strong>)
              </span>
            </div>
            <span className="px-2 py-0.5 rounded bg-white border border-emerald-400 text-emerald-900 text-[10.5px] font-black">
              ✅ Auto-Attached to Tab 10: Finished Goods Carton Stock
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            <div className="bg-white p-2 rounded border border-emerald-200">
              <div className="text-[10px] font-bold text-slate-500 uppercase">Completed IS-694</div>
              <div className="text-sm font-black text-emerald-900">{is694DoneCount} Order(s)</div>
            </div>
            <div className="bg-white p-2 rounded border border-emerald-200">
              <div className="text-[10px] font-bold text-slate-500 uppercase">Total Coils in Stock</div>
              <div className="text-sm font-black text-amber-800">{is694DoneCoils} Coils</div>
            </div>
            <div className="bg-white p-2 rounded border border-emerald-200">
              <div className="text-[10px] font-bold text-slate-500 uppercase">Master Cartons in Stock</div>
              <div className="text-sm font-black text-rose-800">{is694DoneCartons} Cartons</div>
            </div>
            <div className="bg-white p-2 rounded border border-emerald-200">
              <div className="text-[10px] font-bold text-slate-500 uppercase">IS-694 Wire Length</div>
              <div className="text-sm font-black text-blue-800">{is694DoneLen.toLocaleString()} m</div>
            </div>
            <div className="bg-white p-2 rounded border border-emerald-200">
              <div className="text-[10px] font-bold text-slate-500 uppercase">Copper Processed</div>
              <div className="text-sm font-black text-amber-900">{is694DoneCu.toFixed(2)} kg</div>
            </div>
            <div className="bg-white p-2 rounded border border-emerald-200">
              <div className="text-[10px] font-bold text-slate-500 uppercase">Insulation Processed</div>
              <div className="text-sm font-black text-teal-800">{is694DoneIns.toFixed(2)} kg</div>
            </div>
          </div>
        </div>
      )}

      {/* Table Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs print-card">
        <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-2">
          <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span>
              ✅ Completed Orders ({filtered.length} items{filterBatch ? ` in ${filterBatch}` : ''})
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={filterBatch}
              onChange={(e) => setFilterBatch(e.target.value)}
              className="text-xs px-2.5 py-1.5 border border-slate-300 rounded font-bold bg-white text-slate-800 cursor-pointer"
              title="Filter Completed Orders by Production Batch"
            >
              <option value="">All Batches ({completed.length})</option>
              {uniqueBatches.map(b => (
                <option key={b} value={b}>
                  {b} ({batchCompletedCounts[b] || 0})
                </option>
              ))}
            </select>

            <div className="relative">
              <input
                type="text"
                placeholder="Search Brand, Size, Container..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-xs pl-7 pr-2.5 py-1.5 border border-slate-300 rounded w-52 bg-white"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            </div>

            <button
              onClick={() => window.print()}
              className="text-xs px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 shadow-2xs no-print"
              title="Print current page document"
            >
              <Printer className="w-3.5 h-3.5" /> Print current page
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-2 border-r border-slate-200">#</th>
                <th className="p-2 border-r border-slate-200">Batch</th>
                <th className="p-2 border-r border-slate-200">Status</th>
                <th className="p-2 border-r border-slate-200">Brand</th>
                <th className="p-2 border-r border-slate-200">Conductor</th>
                <th className="p-2 border-r border-slate-200 text-right">PVC / Core OD</th>
                <th className="p-2 border-r border-slate-200 text-right">Ins. Die (Rec)</th>
                <th className="p-2 border-r border-slate-200 text-right">Nozzle (Rec)</th>
                <th className="p-2 border-r border-slate-200">Ins. Compound</th>
                <th className="p-2 border-r border-slate-200 text-right">Core</th>
                <th className="p-2 border-r border-slate-200">Size</th>
                <th className="p-2 border-r border-slate-200 bg-indigo-50/80 text-indigo-950">🚢 Container &amp; Stuffing Date</th>
                <th className="p-2 border-r border-slate-200 text-right">Ext. Nozzle</th>
                <th className="p-2 border-r border-slate-200 text-right">Final Dia</th>
                <th className="p-2 border-r border-slate-200 text-right">Final Die</th>
                <th className="p-2 border-r border-slate-200">Sheath Colour</th>
                <th className="p-2 border-r border-slate-200">Sheath Comp</th>
                <th className="p-2 border-r border-slate-200 bg-amber-50/90 text-amber-950 text-center">Coils Detail</th>
                <th className="p-2 border-r border-slate-200 text-right">Order Length (m)</th>
                <th className="p-2 border-r border-slate-200 text-center min-w-[140px]">Process Status (B-CS-I-TS-SH)</th>
                <th className="p-2 border-r border-slate-200">Grade</th>
                <th className="p-2 border-r border-slate-200">Sheath Print Details</th>
                <th className="p-2 text-center no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={23} className="p-6 text-center text-slate-400">
                    No completed orders found. Orders will automatically appear here once all required process badges are marked green.
                  </td>
                </tr>
              ) : (
                filtered.map((o, idx) => {
                  const rec = computeRecordRow(o, densities, ladiDimensions);
                  const p = o.pStatus || { b: false, c: false, i: false, t: false, s: false };
                  const contAssignments = getContainerAssignmentsForOrder(o, containers);
                  return (
                    <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-2 border-r border-slate-100">{idx + 1}</td>
                      <td className="p-2 border-r border-slate-100 font-bold">{o.batch}</td>
                      <td className="p-2 border-r border-slate-100">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Done
                        </span>
                      </td>
                      <td className="p-2 border-r border-slate-100">{o.brand}</td>
                      <td className="p-2 border-r border-slate-100 font-mono text-[11px]">{o.conductor}</td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-900">{fmtExact(rec.coreOd, 4)}</td>
                      <td className="p-2 border-r border-slate-100 text-right font-semibold text-teal-700">{fmtExact(rec.insDie, 4)}</td>
                      <td className="p-2 border-r border-slate-100 text-right text-teal-700">{fmtExact(rec.nozzle, 4)}</td>
                      <td className="p-2 border-r border-slate-100">{o.ins_compound}</td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold">{o.cores}C</td>
                      <td className="p-2 border-r border-slate-100">
                        <div className="font-bold text-slate-900">{o.size}</div>
                        {contAssignments.length > 0 && (
                          <div className="text-[9.5px] font-bold text-indigo-700 mt-0.5">
                            🚢 {contAssignments[0].containerNo} • {contAssignments[0].plannedStuffingDate || 'TBA'}
                          </div>
                        )}
                      </td>
                      <td className="p-2 border-r border-slate-100 bg-indigo-50/30">
                        {contAssignments.length > 0 ? (
                          <div className="space-y-1">
                            {contAssignments.map(ca => (
                              <div
                                key={ca.containerId}
                                onClick={() => onOpenContainer && onOpenContainer(ca.containerId)}
                                className="px-2 py-1 rounded-md border border-indigo-200 bg-indigo-50/90 hover:bg-indigo-100 cursor-pointer transition-colors"
                                title={`Planned in ${ca.containerNo} (${ca.containerType}) — Stuffing Date: ${ca.plannedStuffingDate} — Click to open Container Plan`}
                              >
                                <div className="flex items-center justify-between gap-2 font-mono font-extrabold text-[11px] text-indigo-950">
                                  <span className="flex items-center gap-1">
                                    <Ship className="w-3 h-3 text-indigo-600 shrink-0" />
                                    {ca.containerNo}
                                  </span>
                                  <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-white border border-indigo-200 text-indigo-800 font-bold">
                                    {ca.drumCount} Drums
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700 mt-0.5">
                                  <Calendar className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                                  <span>Stuffing: {ca.plannedStuffingDate || 'TBA'}</span>
                                  <span className="text-slate-400">•</span>
                                  <span className="text-[9.5px] text-indigo-700">{ca.status}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-[10px] text-slate-400 italic">Not Planned</span>
                            {onOpenContainer && (
                              <button
                                type="button"
                                onClick={() => onOpenContainer()}
                                className="no-print text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 border border-slate-200 font-semibold"
                                title="Open Container Planning to assign this cable size"
                              >
                                + Plan
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-2 border-r border-slate-100 text-right text-amber-800">{fmtExact(rec.extNozzle, 5)}</td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold">{fmtExact(rec.finalDia, 4)}</td>
                      <td className="p-2 border-r border-slate-100 text-right font-semibold text-amber-800">{fmtExact(rec.finalDie, 4)}</td>
                      <td className="p-2 border-r border-slate-100">{o.sheath_colour || '-'}</td>
                      <td className="p-2 border-r border-slate-100">{o.sheath_compound || '-'}</td>
                      <td className="p-2 border-r border-slate-100 bg-amber-50/30 text-center">
                        {isIs694Order(o) ? (
                          (() => {
                            const cr = computeIs694CartonPackingForOrder(o, densities, ladiDimensions, vihanRules, maruRules);
                            return (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-950 border border-rose-300 text-[10px] font-black">
                                  📦 {cr.totalCartons} Cartons ({cr.totalCoils} Coils × {cr.coilType})
                                </span>
                                <div className="text-[9.5px] font-bold text-emerald-800">
                                  ✅ Attached to Stock • Drum: N/A
                                </div>
                              </div>
                            );
                          })()
                        ) : o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0 ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold">
                            {o.coils} Coils × {o.coil_type || '100 YARD'}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-900">{rec.orderLen.toLocaleString()}</td>
                      <td className="p-2 border-r border-slate-100 text-center">
                        {(() => {
                          if (isIs694Order(o)) {
                            return (
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    title="Stage 1: Copper Bunching"
                                    onClick={() => onToggleProcess(o.id, 'b')}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${p.b ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600'}`}
                                  >
                                    1. B
                                  </button>
                                  <button
                                    type="button"
                                    title="Stage 2 (Final Stage): IS-694 Insulation & Coiling (Attaches to Stock)"
                                    onClick={() => onToggleProcess(o.id, 'i')}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${p.i ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600'}`}
                                  >
                                    2. I (Final)
                                  </button>
                                </div>
                                <span className="text-[9px] font-extrabold text-emerald-800">
                                  📦 Attached to Carton Stock
                                </span>
                              </div>
                            );
                          }
                          const reqStages = getRequiredStagesForOrder(o, ladiDimensions);
                          return (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                title="Copper Bunching"
                                onClick={() => onToggleProcess(o.id, 'b')}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${p.b ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600'}`}
                              >
                                B
                              </button>
                              {reqStages.c ? (
                                <button
                                  type="button"
                                  title="Copper Stranding (Ladi)"
                                  onClick={() => onToggleProcess(o.id, 'c')}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${p.c ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600'}`}
                                >
                                  CS
                                </button>
                              ) : (
                                <span
                                  title="Cu Stranding not needed by rules for ≤ 6 SQ MM"
                                  className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-slate-100 text-slate-400 line-through select-none"
                                >
                                  CS
                                </span>
                              )}
                              <button
                                type="button"
                                title="Insulation"
                                onClick={() => onToggleProcess(o.id, 'i')}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${p.i ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600'}`}
                              >
                                I
                              </button>
                              {reqStages.t ? (
                                <button
                                  type="button"
                                  title="Core Stranding / Twisting"
                                  onClick={() => onToggleProcess(o.id, 't')}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${p.t ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600'}`}
                                >
                                  TS
                                </button>
                              ) : (
                                <span
                                  title="Twisting not needed by rules for 1-Core cable"
                                  className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-slate-100 text-slate-400 line-through select-none"
                                >
                                  TS
                                </span>
                              )}
                              {reqStages.s ? (
                                <button
                                  type="button"
                                  title="Sheathing"
                                  onClick={() => onToggleProcess(o.id, 's')}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${p.s ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600'}`}
                                >
                                  SH
                                </button>
                              ) : (
                                <span
                                  title="Sheathing not needed for unsheathed cable"
                                  className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-slate-100 text-slate-400 line-through select-none"
                                >
                                  SH
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="p-2 border-r border-slate-100">
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-bold">
                          {o.grade}
                        </span>
                      </td>
                      <td className="p-2 border-r border-slate-100 truncate max-w-[180px]" title={o.print_details}>
                        {o.print_details || '-'}
                      </td>
                      <td className="p-2 text-center no-print">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => onSelectForRequisition(o.batch, o.brand, o.size)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold text-[11px]"
                            title="Open Process Cards"
                          >
                            📇 Cards
                          </button>
                          <button
                            onClick={() => onDuplicateOrder(o.id)}
                            className="p-1 hover:bg-slate-100 rounded text-slate-600"
                            title="Duplicate"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteOrder(o.id)}
                            className="p-1 hover:bg-red-50 text-red-600 rounded"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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
    </div>
  );
};
