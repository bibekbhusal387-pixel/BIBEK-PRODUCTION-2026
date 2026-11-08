import React, { useMemo } from 'react';
import {
  CableOrder,
  DensitySettings,
  LadiDimensionRule,
  PurchaseItem,
  StockItem,
  StockThresholdSettings,
} from '../types/cable';
import { computeRecordRow, isOrderComplete } from '../utils/calculations';
import {
  classifyPurchaseItem,
  DEFAULT_STOCK_THRESHOLDS,
  evaluateStockLevels,
} from '../utils/stockAlerts';
import {
  ClipboardList,
  Layers,
  Package,
  AlertTriangle,
  CheckCircle2,
  Flame,
  ArrowUpRight,
  Flag,
  TrendingUp,
  Scale,
  Boxes,
} from 'lucide-react';

export interface DashboardMetricsSummaryProps {
  orders: CableOrder[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  purchaseItems?: PurchaseItem[];
  customStockItems?: StockItem[];
  stockThresholds?: StockThresholdSettings;
  selectedBatch?: string;
  onNavigateTab?: (tabId: string) => void;
}

export const DashboardMetricsSummary: React.FC<DashboardMetricsSummaryProps> = ({
  orders,
  densities,
  ladiDimensions,
  purchaseItems = [],
  customStockItems = [],
  stockThresholds = DEFAULT_STOCK_THRESHOLDS,
  selectedBatch = 'ALL',
  onNavigateTab,
}) => {
  // 1. Compute Active vs Total Orders and Production Copper / Compound Requirements
  const productionStats = useMemo(() => {
    let activeOrderCount = 0;
    let completedOrderCount = 0;
    let highPriorityActiveCount = 0;

    let activeCableLen = 0;
    let activeCoreLen = 0;
    let totalCableLen = 0;

    let activeCopperReq = 0;
    let pendingStageCopperReq = 0; // Orders where copper stranding/bunching not yet complete
    let completedCopperUsed = 0;
    let totalCopperReq = 0;

    let activePvcReq = 0;
    let totalPvcReq = 0;

    let stagesDoneInActive = 0;

    orders.forEach(order => {
      const rec = computeRecordRow(order, densities, ladiDimensions);
      const complete = isOrderComplete(order);
      const cuKg = rec.reqCu || 0;
      const pvcKg = (rec.reqIns || 0) + (rec.reqSheath || 0);

      totalCableLen += rec.orderLen || 0;
      totalCopperReq += cuKg;
      totalPvcReq += pvcKg;

      if (complete) {
        completedOrderCount++;
        completedCopperUsed += cuKg;
      } else {
        activeOrderCount++;
        if (order.priority === 'high') {
          highPriorityActiveCount++;
        }
        activeCableLen += rec.orderLen || 0;
        activeCoreLen += rec.reqCoreLen || 0;
        activeCopperReq += cuKg;
        activePvcReq += pvcKg;

        // If bunching or copper stranding isn't marked done yet, copper is still needed on floor
        const copperStageDone = Boolean(order.pStatus?.b && order.pStatus?.c);
        if (!copperStageDone && !order.bunchedQtyUsed) {
          pendingStageCopperReq += cuKg;
        }

        if (order.pStatus?.b) stagesDoneInActive++;
        if (order.pStatus?.c) stagesDoneInActive++;
        if (order.pStatus?.i) stagesDoneInActive++;
        if (order.pStatus?.t) stagesDoneInActive++;
        if (order.pStatus?.s) stagesDoneInActive++;
      }
    });

    const totalPossibleActiveStages = activeOrderCount * 5;
    const activeStageProgressPct =
      totalPossibleActiveStages > 0
        ? Math.round((stagesDoneInActive / totalPossibleActiveStages) * 100)
        : 0;

    return {
      totalOrders: orders.length,
      activeOrderCount,
      completedOrderCount,
      highPriorityActiveCount,
      activeCableLen,
      activeCoreLen,
      totalCableLen,
      activeCopperReq,
      pendingStageCopperReq,
      completedCopperUsed,
      totalCopperReq,
      activePvcReq,
      totalPvcReq,
      stagesDoneInActive,
      totalPossibleActiveStages,
      activeStageProgressPct,
    };
  }, [orders, densities, ladiDimensions]);

  // 2. Compute Remaining Raw Material Stock Levels (Purchase Sheet + Custom Stock Items)
  const stockStats = useMemo(() => {
    const evalResult = evaluateStockLevels(purchaseItems, stockThresholds);

    let rawCopperAvailable = 0;
    let bunchedCopperAvailable = 0;
    let copperUsedTotal = 0;

    let pvcUsedTotal = 0;
    let drumsAvailable = 0;
    let drumsPurchased = 0;
    let otherAvailable = 0;

    purchaseItems.forEach(item => {
      const cat = classifyPurchaseItem(item);
      const qty = item.qty || 0;
      const used = item.usedQty || 0;
      const rem = Math.max(0, qty - used);

      if (cat === 'copper') {
        copperUsedTotal += used;
        if (item.stage === 'bunch') {
          bunchedCopperAvailable += rem;
        } else {
          rawCopperAvailable += rem;
        }
      } else if (cat === 'pvc') {
        pvcUsedTotal += used;
      } else if (cat === 'drums') {
        drumsPurchased += qty;
        drumsAvailable += rem;
      } else {
        otherAvailable += rem;
      }
    });

    // Also summarize customStockItems (Stock Management Ledger)
    let customClosingKg = 0;
    let customClosingNos = 0;
    customStockItems.forEach(st => {
      const closing = Math.max(0, (st.opening || 0) + (st.received || 0) - (st.consumed || 0));
      if ((st.unit || '').toLowerCase().includes('kg')) {
        customClosingKg += closing;
      } else {
        customClosingNos += closing;
      }
    });

    // Net balance comparing Remaining Copper Stock vs Active Production Copper Required
    const netCopperBalance = evalResult.totalCopperAvailable - productionStats.activeCopperReq;
    const copperCoveragePct =
      productionStats.activeCopperReq > 0
        ? Math.min(100, Math.round((evalResult.totalCopperAvailable / productionStats.activeCopperReq) * 100))
        : 100;

    const netPvcBalance = evalResult.totalPvcAvailable - productionStats.activePvcReq;
    const pvcCoveragePct =
      productionStats.activePvcReq > 0
        ? Math.min(100, Math.round((evalResult.totalPvcAvailable / productionStats.activePvcReq) * 100))
        : 100;

    const copperRetentionPct =
      evalResult.totalCopperPurchased > 0
        ? Math.min(100, Math.round((evalResult.totalCopperAvailable / evalResult.totalCopperPurchased) * 100))
        : 0;

    const pvcRetentionPct =
      evalResult.totalPvcPurchased > 0
        ? Math.min(100, Math.round((evalResult.totalPvcAvailable / evalResult.totalPvcPurchased) * 100))
        : 0;

    return {
      ...evalResult,
      rawCopperAvailable,
      bunchedCopperAvailable,
      copperUsedTotal,
      pvcUsedTotal,
      drumsAvailable,
      drumsPurchased,
      otherAvailable,
      customClosingKg,
      customClosingNos,
      netCopperBalance,
      copperCoveragePct,
      netPvcBalance,
      pvcCoveragePct,
      copperRetentionPct,
      pvcRetentionPct,
    };
  }, [purchaseItems, customStockItems, stockThresholds, productionStats]);

  return (
    <section
      aria-label="Production & Material Metrics Summary"
      className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden"
    >
      {/* Top Banner Header */}
      <div className="bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
            <Scale className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-white flex items-center gap-2">
              <span>Executive Metrics Summary</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {selectedBatch === 'ALL' ? 'All Production Batches' : `Batch ${selectedBatch}`}
              </span>
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          {stockStats.hasLowStock ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold bg-red-500/20 text-red-300 border border-red-500/40">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              Low Raw Material Alert ({stockStats.lowItems.length} item{stockStats.lowItems.length === 1 ? '' : 's'} below threshold)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Raw Material Stock Above Thresholds
            </span>
          )}
        </div>
      </div>

      {/* 3 Primary Pillar Cards: Active Orders | Copper Required | Remaining Stock Levels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        {/* PILLAR 1: TOTAL ACTIVE ORDERS */}
        <div className="p-4 flex flex-col justify-between bg-gradient-to-br from-blue-50/40 via-white to-white">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded">
                  1. Active Production Queue
                </span>
                <h4 className="text-xs font-bold text-slate-500 mt-1.5">
                  Total Active Orders in Pipeline
                </h4>
              </div>
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
                <ClipboardList className="w-5 h-5" />
              </div>
            </div>

            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="text-3xl font-black text-slate-900 tracking-tight">
                {productionStats.activeOrderCount}
              </span>
              <span className="text-xs font-bold text-slate-500">
                active of {productionStats.totalOrders} total orders
              </span>
              {productionStats.highPriorityActiveCount > 0 && (
                <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-red-100 text-red-700 border border-red-200">
                  <Flag className="w-3 h-3 fill-red-600 text-red-600" />
                  {productionStats.highPriorityActiveCount} High Priority
                </span>
              )}
            </div>

            {/* Active Progress Bar */}
            <div className="mt-3">
              <div className="flex justify-between items-center text-[11px] mb-1">
                <span className="font-semibold text-slate-600 flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-amber-500" />
                  Stage Progress (B · C · I · T · S)
                </span>
                <span className="font-extrabold text-blue-700">
                  {productionStats.activeStageProgressPct}% ({productionStats.stagesDoneInActive}/{productionStats.totalPossibleActiveStages})
                </span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${productionStats.activeStageProgressPct}%` }}
                />
              </div>
            </div>

            {/* Sub-metrics grid */}
            <div className="mt-3 grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center">
              <div className="bg-slate-50 rounded-lg p-2 border border-slate-200/70">
                <div className="text-[10px] text-slate-500 font-semibold">Active Cable</div>
                <div className="text-xs font-black text-slate-800 mt-0.5">
                  {productionStats.activeCableLen.toLocaleString()} m
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 border border-slate-200/70">
                <div className="text-[10px] text-slate-500 font-semibold">Active Core</div>
                <div className="text-xs font-black text-blue-700 mt-0.5">
                  {productionStats.activeCoreLen.toLocaleString()} m
                </div>
              </div>
              <div className="bg-emerald-50/60 rounded-lg p-2 border border-emerald-200/70">
                <div className="text-[10px] text-emerald-700 font-semibold">Completed</div>
                <div className="text-xs font-black text-emerald-800 mt-0.5">
                  {productionStats.completedOrderCount} orders
                </div>
              </div>
            </div>
          </div>

          {onNavigateTab && (
            <div className="mt-3 pt-2 border-t border-slate-100 flex justify-end no-print">
              <button
                type="button"
                onClick={() => onNavigateTab('orders')}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
              >
                View Active Orders Sheet <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* PILLAR 2: TOTAL COPPER REQUIRED FOR PRODUCTION */}
        <div className="p-4 flex flex-col justify-between bg-gradient-to-br from-amber-50/40 via-white to-white">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded">
                  2. Copper Production Demand
                </span>
                <h4 className="text-xs font-bold text-slate-500 mt-1.5">
                  Total Copper Required for Production
                </h4>
              </div>
              <div className="p-2 bg-amber-50 text-amber-600 rounded-lg border border-amber-100">
                <Layers className="w-5 h-5" />
              </div>
            </div>

            <div className="mt-2 flex items-baseline gap-2 flex-wrap">
              <span className="text-3xl font-black text-amber-700 tracking-tight">
                {productionStats.activeCopperReq.toLocaleString(undefined, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
                <span className="text-sm font-bold text-amber-600 ml-1">kg</span>
              </span>
              <span className="text-xs font-semibold text-slate-500">
                for active orders ({productionStats.totalCopperReq.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg total)
              </span>
            </div>

            {/* Stock Coverage Bar against Active Demand */}
            <div className="mt-3">
              <div className="flex justify-between items-center text-[11px] mb-1">
                <span className="font-semibold text-slate-600 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5 text-amber-600" />
                  Copper Stock Coverage vs Active Demand
                </span>
                <span
                  className={`font-extrabold ${
                    stockStats.netCopperBalance >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  {stockStats.copperCoveragePct}% covered
                </span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    stockStats.netCopperBalance >= 0 ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${stockStats.copperCoveragePct}%` }}
                />
              </div>
            </div>

            {/* Breakdown Cards */}
            <div className="mt-3 grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center">
              <div className="bg-amber-50/60 rounded-lg p-2 border border-amber-200/70">
                <div className="text-[10px] text-amber-800 font-semibold">Unstranded Req</div>
                <div className="text-xs font-black text-amber-900 mt-0.5">
                  {productionStats.pendingStageCopperReq.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}{' '}
                  kg
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 border border-slate-200/70">
                <div className="text-[10px] text-slate-500 font-semibold">Available Cu</div>
                <div className="text-xs font-black text-slate-800 mt-0.5">
                  {stockStats.totalCopperAvailable.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}{' '}
                  kg
                </div>
              </div>
              <div
                className={`rounded-lg p-2 border ${
                  stockStats.netCopperBalance >= 0
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : 'bg-red-50/70 border-red-200'
                }`}
              >
                <div
                  className={`text-[10px] font-semibold ${
                    stockStats.netCopperBalance >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {stockStats.netCopperBalance >= 0 ? 'Net Surplus' : 'Net Shortfall'}
                </div>
                <div
                  className={`text-xs font-black mt-0.5 ${
                    stockStats.netCopperBalance >= 0 ? 'text-emerald-800' : 'text-red-700'
                  }`}
                >
                  {stockStats.netCopperBalance >= 0 ? '+' : ''}
                  {stockStats.netCopperBalance.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}{' '}
                  kg
                </div>
              </div>
            </div>
          </div>

          {onNavigateTab && (
            <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between items-center no-print">
              <span className="text-[10px] text-slate-400 font-medium">
                Active PVC Req: {productionStats.activePvcReq.toFixed(1)} kg
              </span>
              <button
                type="button"
                onClick={() => onNavigateTab('copslip')}
                className="text-[11px] font-bold text-amber-700 hover:text-amber-900 flex items-center gap-1 transition-colors"
              >
                Open Copper Requisition Slip <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* PILLAR 3: REMAINING RAW MATERIAL STOCK LEVELS AT A GLANCE */}
        <div className="p-4 flex flex-col justify-between bg-gradient-to-br from-emerald-50/40 via-white to-white">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded">
                  3. Remaining Raw Material Stock
                </span>
                <h4 className="text-xs font-bold text-slate-500 mt-1.5">
                  Warehouse Inventory Levels at a Glance
                </h4>
              </div>
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
                <Package className="w-5 h-5" />
              </div>
            </div>

            {/* Two Primary Material Stock Rows: Copper & PVC Compound */}
            <div className="mt-2.5 space-y-2.5">
              {/* Copper Stock Row */}
              <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-xs font-bold text-slate-800">Copper Stock</span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      (Raw: {stockStats.rawCopperAvailable.toFixed(1)} kg · Bunched:{' '}
                      {stockStats.bunchedCopperAvailable.toFixed(1)} kg)
                    </span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-sm font-black ${
                        stockStats.isTotalCopperLow ? 'text-red-600' : 'text-slate-900'
                      }`}
                    >
                      {stockStats.totalCopperAvailable.toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}{' '}
                      kg
                    </span>
                    <span className="text-[10px] text-slate-400 ml-1">
                      / {stockStats.totalCopperPurchased.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        stockStats.isTotalCopperLow ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                      style={{ width: `${stockStats.copperRetentionPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">
                    Min: {stockThresholds.copperThreshold} kg
                  </span>
                </div>
              </div>

              {/* PVC / Compound Stock Row */}
              <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs font-bold text-slate-800">PVC / Compounds</span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      (Used: {stockStats.pvcUsedTotal.toFixed(1)} kg)
                    </span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-sm font-black ${
                        stockStats.isTotalPvcLow ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {stockStats.totalPvcAvailable.toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}{' '}
                      kg
                    </span>
                    <span className="text-[10px] text-slate-400 ml-1">
                      / {stockStats.totalPvcPurchased.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        stockStats.isTotalPvcLow ? 'bg-red-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${stockStats.pvcRetentionPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">
                    Min: {stockThresholds.pvcThreshold} kg
                  </span>
                </div>
              </div>
            </div>

            {/* Secondary Stock Strip: Drums & Ledger Stock */}
            <div className="mt-2.5 grid grid-cols-2 gap-2 text-center">
              <div className="bg-slate-50 rounded-lg p-1.5 border border-slate-200/70 flex items-center justify-between px-2.5">
                <span className="text-[10px] font-semibold text-slate-500 flex items-center gap-1">
                  <Boxes className="w-3 h-3 text-indigo-500" /> Drums Stock
                </span>
                <span className="text-xs font-black text-slate-800">
                  {stockStats.drumsAvailable} / {stockStats.drumsPurchased} Nos
                </span>
              </div>
              <div className="bg-slate-50 rounded-lg p-1.5 border border-slate-200/70 flex items-center justify-between px-2.5">
                <span className="text-[10px] font-semibold text-slate-500">Ledger Closing</span>
                <span className="text-xs font-black text-slate-800">
                  {stockStats.customClosingKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg
                </span>
              </div>
            </div>
          </div>

          {onNavigateTab && (
            <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between no-print">
              <button
                type="button"
                onClick={() => onNavigateTab('stockslip')}
                className="text-[11px] font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 transition-colors"
              >
                Stock Ledger <ArrowUpRight className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('purchase')}
                className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 transition-colors"
              >
                Manage Purchase Stock <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
