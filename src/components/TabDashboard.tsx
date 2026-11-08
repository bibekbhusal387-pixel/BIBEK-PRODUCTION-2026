import React, { useState, useMemo } from 'react';
import {
  BatchHistoryEntry,
  CableOrder,
  DensitySettings,
  LadiDimensionRule,
  PackagingRule,
  PurchaseItem,
  SizePackagingRule,
  StockItem,
  StockThresholdSettings,
} from '../types/cable';
import { computeRecordRow, getRequiredStagesForOrder, isOrderComplete } from '../utils/calculations';
import { DashboardMetricsSummary } from './DashboardMetricsSummary';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  BarChart3,
  PieChart as PieChartIcon,
  Printer,
  Filter,
  CheckCircle2,
  Clock,
  Layers,
  Activity,
  Award,
  Flame,
  Zap,
  Calendar,
} from 'lucide-react';

interface TabDashboardProps {
  orders: CableOrder[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  sizeRules?: SizePackagingRule[];
  packagingRules?: PackagingRule[];
  purchaseItems?: PurchaseItem[];
  customStockItems?: StockItem[];
  stockThresholds?: StockThresholdSettings;
  batchHistory?: BatchHistoryEntry[];
  onNavigateTab?: (tabId: string) => void;
}

// Color palette for processes
const PROCESS_COLORS = {
  B: '#f59e0b', // Amber (Bunching)
  C: '#ea580c', // Orange (Cu Stranding)
  I: '#3b82f6', // Blue (Insulation / Extrusion)
  T: '#8b5cf6', // Purple (Core Twisting)
  S: '#10b981', // Emerald (Sheathing)
};

const BRAND_COLORS = [
  '#2563eb', // Blue
  '#7c3aed', // Violet
  '#059669', // Emerald
  '#d97706', // Amber
  '#dc2626', // Red
  '#0891b2', // Cyan
  '#4f46e5', // Indigo
  '#db2777', // Pink
  '#65a30d', // Lime
];

export const TabDashboard: React.FC<TabDashboardProps> = ({
  orders,
  densities,
  ladiDimensions,
  purchaseItems = [],
  customStockItems = [],
  stockThresholds,
  batchHistory = [],
  onNavigateTab,
}) => {
  const [selectedBatch, setSelectedBatch] = useState<string>('ALL');
  const [barMetric, setBarMetric] = useState<'length' | 'count'>('length');
  const [batch30dViewMode, setBatch30dViewMode] = useState<'total' | 'stacked' | 'produced_only'>('total');
  const [processChartType, setProcessChartType] = useState<'bar_stacked' | 'bar_completed' | 'pie'>('bar_stacked');

  // Unique batches for filtering
  const batches = useMemo(() => {
    const set = new Set<string>();
    orders.forEach(o => {
      if (o.batch) set.add(o.batch);
    });
    return Array.from(set).sort();
  }, [orders]);

  // Filtered orders based on selected batch
  const filteredOrders = useMemo(() => {
    if (selectedBatch === 'ALL') return orders;
    return orders.filter(o => o.batch === selectedBatch);
  }, [orders, selectedBatch]);

  // Active orders (uncompleted)
  const activeOrders = useMemo(() => {
    return filteredOrders.filter(o => !isOrderComplete(o, ladiDimensions));
  }, [filteredOrders, ladiDimensions]);

  const completedOrders = useMemo(() => {
    return filteredOrders.filter(o => isOrderComplete(o, ladiDimensions));
  }, [filteredOrders, ladiDimensions]);

  // 0. Data for Bar Chart: Total Length of Cables Produced per Batch over the Last 30 Days
  const batch30DayStats = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const cutoffMs = thirtyDaysAgo.getTime();

    // Map orderId -> latest activity timestamp (ms) from batchHistory
    const orderHistoryLatestMs: Record<number, number> = {};
    const batchHistoryLatestMs: Record<string, number> = {};

    batchHistory.forEach(entry => {
      const parsedMs = Date.parse(entry.timestamp);
      if (!Number.isNaN(parsedMs)) {
        if (!orderHistoryLatestMs[entry.orderId] || parsedMs > orderHistoryLatestMs[entry.orderId]) {
          orderHistoryLatestMs[entry.orderId] = parsedMs;
        }
        if (entry.batch && (!batchHistoryLatestMs[entry.batch] || parsedMs > batchHistoryLatestMs[entry.batch])) {
          batchHistoryLatestMs[entry.batch] = parsedMs;
        }
      }
    });

    const batchMap: Record<
      string,
      {
        batch: string;
        totalLength: number;
        producedLength: number;
        completedLength: number;
        inProgressLength: number;
        coreLength: number;
        cuWeight: number;
        orderCount: number;
        producedOrderCount: number;
        completedOrderCount: number;
        brandsSet: Set<string>;
        latestTimestampMs: number;
      }
    > = {};

    filteredOrders.forEach(o => {
      const batchName = o.batch?.trim() || 'Unassigned';
      const r = computeRecordRow(o, densities, ladiDimensions);
      const orderLen = r.orderLen || Number(o.order_length) || 0;
      const isDone = isOrderComplete(o, ladiDimensions);
      const hasAnyStageDone = Boolean(
        o.pStatus?.b || o.pStatus?.c || o.pStatus?.i || o.pStatus?.t || o.pStatus?.s
      );

      // Determine order's most recent timestamp if recorded
      const candidateTimestamps: number[] = [];
      if (o.pTimestamps) {
        Object.values(o.pTimestamps).forEach(ts => {
          if (ts) {
            const ms = Date.parse(ts);
            if (!Number.isNaN(ms)) candidateTimestamps.push(ms);
          }
        });
      }
      if (o.dispatchedAt) {
        const ms = Date.parse(o.dispatchedAt);
        if (!Number.isNaN(ms)) candidateTimestamps.push(ms);
      }
      if (orderHistoryLatestMs[o.id]) {
        candidateTimestamps.push(orderHistoryLatestMs[o.id]);
      }

      const latestOrderMs =
        candidateTimestamps.length > 0 ? Math.max(...candidateTimestamps) : undefined;

      // Include order if it falls within the 30-day window (or has no archival timestamp older than 30 days)
      const isWithinLast30Days = latestOrderMs === undefined || latestOrderMs >= cutoffMs;
      if (!isWithinLast30Days) return;

      if (!batchMap[batchName]) {
        batchMap[batchName] = {
          batch: batchName,
          totalLength: 0,
          producedLength: 0,
          completedLength: 0,
          inProgressLength: 0,
          coreLength: 0,
          cuWeight: 0,
          orderCount: 0,
          producedOrderCount: 0,
          completedOrderCount: 0,
          brandsSet: new Set<string>(),
          latestTimestampMs: batchHistoryLatestMs[batchName] || now.getTime(),
        };
      }

      const item = batchMap[batchName];
      item.totalLength += orderLen;
      item.coreLength += r.reqCoreLen || 0;
      item.cuWeight += r.reqCu || 0;
      item.orderCount += 1;

      if (o.brand) {
        item.brandsSet.add(o.brand.trim());
      }
      if (latestOrderMs && latestOrderMs > item.latestTimestampMs) {
        item.latestTimestampMs = latestOrderMs;
      }

      if (isDone) {
        item.completedLength += orderLen;
        item.producedLength += orderLen;
        item.completedOrderCount += 1;
        item.producedOrderCount += 1;
      } else if (hasAnyStageDone) {
        item.producedLength += orderLen;
        item.inProgressLength += orderLen;
        item.producedOrderCount += 1;
      } else {
        item.inProgressLength += orderLen;
      }
    });

    const rows = Object.values(batchMap)
      .map(item => ({
        batch: item.batch,
        totalLength: item.totalLength,
        producedLength: item.producedLength,
        completedLength: item.completedLength,
        inProgressLength: item.inProgressLength,
        coreLength: item.coreLength,
        cuWeight: item.cuWeight,
        orderCount: item.orderCount,
        producedOrderCount: item.producedOrderCount,
        completedOrderCount: item.completedOrderCount,
        brands: Array.from(item.brandsSet).join(', ') || 'Standard',
        lastActivityDate: new Date(item.latestTimestampMs).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
      }))
      .sort((a, b) => b.totalLength - a.totalLength);

    const grandTotalLength = rows.reduce((sum, r) => sum + r.totalLength, 0);
    const grandProducedLength = rows.reduce((sum, r) => sum + r.producedLength, 0);
    const grandCompletedLength = rows.reduce((sum, r) => sum + r.completedLength, 0);
    const grandInProgressLength = rows.reduce((sum, r) => sum + r.inProgressLength, 0);

    return {
      rows,
      grandTotalLength,
      grandProducedLength,
      grandCompletedLength,
      grandInProgressLength,
      windowStartLabel: thirtyDaysAgo.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      windowEndLabel: now.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    };
  }, [filteredOrders, densities, ladiDimensions, batchHistory]);

  // 1. Data for Bar Chart: Total Order Volume by Brand
  const brandData = useMemo(() => {
    const map: Record<string, {
      brand: string;
      totalLength: number;
      orderCount: number;
      activeLength: number;
      completedLength: number;
      coreLength: number;
      cuWeight: number;
    }> = {};

    filteredOrders.forEach(o => {
      const brand = o.brand?.trim() || 'Unknown';
      const r = computeRecordRow(o, densities, ladiDimensions);
      const isDone = isOrderComplete(o, ladiDimensions);

      if (!map[brand]) {
        map[brand] = {
          brand,
          totalLength: 0,
          orderCount: 0,
          activeLength: 0,
          completedLength: 0,
          coreLength: 0,
          cuWeight: 0,
        };
      }

      map[brand].totalLength += r.orderLen || 0;
      map[brand].orderCount += 1;
      map[brand].coreLength += r.reqCoreLen || 0;
      map[brand].cuWeight += r.reqCu || 0;

      if (isDone) {
        map[brand].completedLength += r.orderLen || 0;
      } else {
        map[brand].activeLength += r.orderLen || 0;
      }
    });

    return Object.values(map).sort((a, b) => b.totalLength - a.totalLength);
  }, [filteredOrders, densities, ladiDimensions]);

  // 2. Data for Bar & Pie Charts: Production Progress Status Distribution (Bunching, Cu Stranding, Insulation Extrusion, Twisting, Sheathing) across ALL Active Orders
  const processStageData = useMemo(() => {
    const totalActive = activeOrders.length;
    const stats = {
      b: { done: 0, pending: 0, skipped: 0, doneLen: 0, pendingLen: 0 },
      c: { done: 0, pending: 0, skipped: 0, doneLen: 0, pendingLen: 0 },
      i: { done: 0, pending: 0, skipped: 0, doneLen: 0, pendingLen: 0 },
      t: { done: 0, pending: 0, skipped: 0, doneLen: 0, pendingLen: 0 },
      s: { done: 0, pending: 0, skipped: 0, doneLen: 0, pendingLen: 0 },
    };

    activeOrders.forEach(o => {
      const req = getRequiredStagesForOrder(o, ladiDimensions);
      const len = Number(o.order_length) || 0;
      (['b', 'c', 'i', 't', 's'] as const).forEach(k => {
        if (!req[k]) {
          stats[k].skipped++;
        } else if (o.pStatus?.[k]) {
          stats[k].done++;
          stats[k].doneLen += len;
        } else {
          stats[k].pending++;
          stats[k].pendingLen += len;
        }
      });
    });

    const totalCompletions =
      stats.b.done + stats.c.done + stats.i.done + stats.t.done + stats.s.done;

    const buildStageRow = (
      key: 'b' | 'c' | 'i' | 't' | 's',
      name: string,
      shortStage: string,
      code: string,
      color: string,
      desc: string
    ) => {
      const st = stats[key];
      const reqTotal = st.done + st.pending;
      return {
        name,
        shortStage,
        code,
        count: st.done,
        pendingCount: st.pending,
        skippedCount: st.skipped,
        requiredCount: reqTotal,
        doneLength: st.doneLen,
        pendingLength: st.pendingLen,
        totalActive,
        percentage:
          totalCompletions > 0 ? ((st.done / totalCompletions) * 100).toFixed(1) : '0',
        activePercent:
          reqTotal > 0 ? ((st.done / reqTotal) * 100).toFixed(0) : '0',
        color,
        desc,
      };
    };

    return [
      buildStageRow('b', 'Bunching (B)', 'Bunching', 'B', PROCESS_COLORS.B, 'Copper wire bunching stage'),
      buildStageRow('c', 'Cu Stranding (CS)', 'Cu Stranding', 'CS', PROCESS_COLORS.C, 'Copper ladi & stranding (>6 sqmm)'),
      buildStageRow('i', 'Insulation Extrusion (I)', 'Extrusion (Ins)', 'I', PROCESS_COLORS.I, 'Primary core PVC/rubber extrusion'),
      buildStageRow('t', 'Core Twisting (TS)', 'Core Twisting', 'TS', PROCESS_COLORS.T, 'Multi-core twisting / laying'),
      buildStageRow('s', 'Sheathing (SH)', 'Sheathing', 'SH', PROCESS_COLORS.S, 'Final outer jacket extrusion'),
    ];
  }, [activeOrders, ladiDimensions]);

  // Overall metrics summary
  const summaryMetrics = useMemo(() => {
    let totalLen = 0;
    let totalCoreLen = 0;
    let totalCu = 0;
    let totalCompound = 0;
    let totalStagesDone = 0;
    let totalPossibleStages = 0;

    filteredOrders.forEach(o => {
      const r = computeRecordRow(o, densities, ladiDimensions);
      totalLen += r.orderLen || 0;
      totalCoreLen += r.reqCoreLen || 0;
      totalCu += r.reqCu || 0;
      totalCompound += (r.reqIns || 0) + (r.reqSheath || 0);

      if (!isOrderComplete(o, ladiDimensions)) {
        const req = getRequiredStagesForOrder(o, ladiDimensions);
        (['b', 'c', 'i', 't', 's'] as const).forEach(k => {
          if (req[k]) {
            totalPossibleStages++;
            if (o.pStatus?.[k]) totalStagesDone++;
          }
        });
      }
    });

    const activePipelineProgress =
      totalPossibleStages > 0
        ? Math.round((totalStagesDone / totalPossibleStages) * 100)
        : 0;

    return {
      totalOrders: filteredOrders.length,
      activeCount: activeOrders.length,
      completedCount: completedOrders.length,
      totalLength: totalLen,
      totalCoreLength: totalCoreLen,
      totalCu,
      totalCompound,
      activePipelineProgress,
      totalStagesDone,
      totalPossibleStages,
    };
  }, [filteredOrders, activeOrders, completedOrders, densities, ladiDimensions]);

  // Total stages completed in active orders
  const totalCompletedStagesInActive = useMemo(() => {
    return processStageData.reduce((acc, curr) => acc + curr.count, 0);
  }, [processStageData]);

  return (
    <div className="space-y-4">
      {/* Print Document Header */}
      <div className="print-only border-b-2 border-slate-900 pb-3 mb-4">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-wide uppercase">
              PLUTUS CABLE PRODUCTION SYSTEM
            </h1>
            <p className="text-xs font-bold text-slate-700">
              EXECUTIVE PRODUCTION DASHBOARD & OPERATIONS ANALYTICS
            </p>
          </div>
          <div className="text-right text-[10px] text-slate-600">
            <div>Printed: {new Date().toLocaleString()}</div>
            <div>
              Scope: {selectedBatch === 'ALL' ? 'All Batches' : `Batch ${selectedBatch}`}
            </div>
            <div>Active Orders Analyzed: {activeOrders.length}</div>
          </div>
        </div>
      </div>

      {/* Top Controls Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 px-4 shadow-xs no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="p-2 bg-blue-50 text-blue-700 rounded-lg">
            <Activity className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span>Production Analytics & Operations Dashboard</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                Live Recharts Visualizations
              </span>
            </h2>
            <p className="text-xs text-slate-500">
              Real-time brand order volume distribution and active process stage progress (Bunching, Cu Stranding, Insulation Extrusion, Core Twisting, Sheathing)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Batch Selector */}
          <div className="flex items-center gap-1.5 text-xs">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500 font-semibold">Filter Batch:</span>
            <select
              value={selectedBatch}
              onChange={e => setSelectedBatch(e.target.value)}
              className="py-1 px-2.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">All Batches ({batches.length})</option>
              {batches.map(b => (
                <option key={b} value={b}>
                  Batch {b}
                </option>
              ))}
            </select>
          </div>

          {/* Print button */}
          <button
            onClick={() => window.print()}
            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
            title="Print current page document"
          >
            <Printer className="w-3.5 h-3.5" /> Print current page
          </button>
        </div>
      </div>

      {/* Executive Metrics Summary Component: Total Active Orders, Production Copper Required & Remaining Raw Material Stock Levels */}
      <DashboardMetricsSummary
        orders={filteredOrders}
        densities={densities}
        ladiDimensions={ladiDimensions}
        purchaseItems={purchaseItems}
        customStockItems={customStockItems}
        stockThresholds={stockThresholds}
        selectedBatch={selectedBatch}
        onNavigateTab={onNavigateTab}
      />

      {/* Metric KPI Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Active Orders</span>
            <Clock className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="mt-1 text-lg font-black text-amber-700">
            {summaryMetrics.activeCount}
            <span className="text-xs font-normal text-slate-400 ml-1">
              / {summaryMetrics.totalOrders}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {summaryMetrics.completedCount} orders completed
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Total Volume</span>
            <Zap className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="mt-1 text-lg font-black text-blue-700">
            {summaryMetrics.totalLength.toLocaleString()}
            <span className="text-xs font-bold text-slate-500 ml-1">m</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Core: {summaryMetrics.totalCoreLength.toLocaleString()} m
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Active Progress</span>
            <Flame className="w-3.5 h-3.5 text-rose-500" />
          </div>
          <div className="mt-1 text-lg font-black text-rose-600">
            {summaryMetrics.activePipelineProgress}%
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {summaryMetrics.totalStagesDone} of {summaryMetrics.totalPossibleStages} stages done
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Total Brands</span>
            <Award className="w-3.5 h-3.5 text-purple-500" />
          </div>
          <div className="mt-1 text-lg font-black text-purple-700">
            {brandData.length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Top: {brandData[0]?.brand || '-'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>Copper Req</span>
            <Layers className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="mt-1 text-lg font-black text-amber-700">
            {summaryMetrics.totalCu.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            <span className="text-xs font-bold text-slate-500 ml-1">kg</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Total conductor weight
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>PVC Compounds</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="mt-1 text-lg font-black text-emerald-700">
            {summaryMetrics.totalCompound.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            <span className="text-xs font-bold text-slate-500 ml-1">kg</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Insulation & Sheathing
          </div>
        </div>
      </div>

      {/* NEW VISUAL CARD: Total Length of Cables Produced per Batch over the Last 30 Days */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-3">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Calendar className="w-4 h-4" />
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-slate-900">
                  Total Length of Cables Produced per Batch (Last 30 Days)
                </h3>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {batch30DayStats.windowStartLabel} – {batch30DayStats.windowEndLabel}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Batch-level production cable length output (meters), stage-active volume, and copper consumption over the past 30 days
              </p>
            </div>
          </div>

          {/* View Mode Toggle */}
          <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs font-semibold no-print">
            <button
              onClick={() => setBatch30dViewMode('total')}
              className={`px-2.5 py-1 rounded transition-colors ${
                batch30dViewMode === 'total'
                  ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Total Batch Length (m)
            </button>
            <button
              onClick={() => setBatch30dViewMode('stacked')}
              className={`px-2.5 py-1 rounded transition-colors ${
                batch30dViewMode === 'stacked'
                  ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Completed vs In-Production
            </button>
            <button
              onClick={() => setBatch30dViewMode('produced_only')}
              className={`px-2.5 py-1 rounded transition-colors ${
                batch30dViewMode === 'produced_only'
                  ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Stage-Active / Completed
            </button>
          </div>
        </div>

        {/* 30-Day Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
          <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-2.5">
            <div className="text-[10px] font-bold uppercase text-slate-500">
              30-Day Batch Output Volume
            </div>
            <div className="text-base font-black text-indigo-700 mt-0.5">
              {batch30DayStats.grandTotalLength.toLocaleString()}{' '}
              <span className="text-xs font-semibold text-slate-500">m</span>
            </div>
            <div className="text-[10px] text-slate-500">
              Across {batch30DayStats.rows.length} active production batches
            </div>
          </div>

          <div className="bg-emerald-50/50 border border-emerald-200/70 rounded-lg p-2.5">
            <div className="text-[10px] font-bold uppercase text-emerald-700">
              Stage-Produced / Completed
            </div>
            <div className="text-base font-black text-emerald-700 mt-0.5">
              {batch30DayStats.grandProducedLength.toLocaleString()}{' '}
              <span className="text-xs font-semibold text-emerald-600">m</span>
            </div>
            <div className="text-[10px] text-emerald-600">
              Fully finished: {batch30DayStats.grandCompletedLength.toLocaleString()} m
            </div>
          </div>

          <div className="bg-amber-50/50 border border-amber-200/70 rounded-lg p-2.5">
            <div className="text-[10px] font-bold uppercase text-amber-700">
              In-Production Queue (30d)
            </div>
            <div className="text-base font-black text-amber-700 mt-0.5">
              {batch30DayStats.grandInProgressLength.toLocaleString()}{' '}
              <span className="text-xs font-semibold text-amber-600">m</span>
            </div>
            <div className="text-[10px] text-amber-600">
              Active on factory floor
            </div>
          </div>

          <div className="bg-blue-50/50 border border-blue-200/70 rounded-lg p-2.5">
            <div className="text-[10px] font-bold uppercase text-blue-700">
              Leading Batch (Last 30d)
            </div>
            <div className="text-base font-black text-blue-800 mt-0.5 truncate">
              {batch30DayStats.rows[0]?.batch || '—'}
            </div>
            <div className="text-[10px] text-blue-600">
              {batch30DayStats.rows[0]
                ? `${batch30DayStats.rows[0].totalLength.toLocaleString()} m (${batch30DayStats.rows[0].orderCount} orders)`
                : 'No batches'}
            </div>
          </div>
        </div>

        {/* Recharts BarChart for 30-Day Batch Cable Length */}
        <div className="h-[300px] w-full pt-1">
          {batch30DayStats.rows.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-400 text-xs">
              No batch production records found within the last 30 days.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={batch30DayStats.rows}
                margin={{ top: 15, right: 20, left: 10, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="batch"
                  tick={{ fill: '#334155', fontSize: 11, fontWeight: 700 }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={val =>
                    val >= 1000 ? `${(val / 1000).toFixed(0)}k m` : `${val}m`
                  }
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-lg shadow-xl border border-slate-700 text-xs space-y-1.5 min-w-[220px]">
                          <div className="font-bold text-sm text-indigo-300 border-b border-slate-700 pb-1 flex items-center justify-between gap-3">
                            <span>{data.batch}</span>
                            <span className="text-[11px] font-normal text-slate-300">
                              {data.orderCount} Orders
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Brands:</span>
                            <span className="font-semibold text-white">{data.brands}</span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Total Batch Cable Length:</span>
                            <span className="font-bold text-white">
                              {data.totalLength.toLocaleString()} m
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Stage-Produced Length:</span>
                            <span className="font-semibold text-emerald-400">
                              {data.producedLength.toLocaleString()} m ({data.producedOrderCount} orders)
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Fully Completed Length:</span>
                            <span className="font-semibold text-teal-300">
                              {data.completedLength.toLocaleString()} m ({data.completedOrderCount} orders)
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>In-Production / Scheduled:</span>
                            <span className="font-semibold text-amber-400">
                              {data.inProgressLength.toLocaleString()} m
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-300 border-t border-slate-800 pt-1">
                            <span>Total Core Length:</span>
                            <span className="font-semibold text-slate-200">
                              {data.coreLength.toLocaleString()} m
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Copper Weight Required:</span>
                            <span className="font-bold text-blue-400">
                              {data.cuWeight.toFixed(1)} kg
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-400 text-[10px] pt-0.5">
                            <span>Latest Activity:</span>
                            <span>{data.lastActivityDate}</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  wrapperStyle={{ paddingBottom: 10, fontSize: 11 }}
                />
                {batch30dViewMode === 'total' && (
                  <Bar
                    dataKey="totalLength"
                    name="Total Cable Length Produced / Scheduled (m)"
                    fill="#4f46e5"
                    radius={[6, 6, 0, 0]}
                  >
                    {batch30DayStats.rows.map((_, idx) => (
                      <Cell
                        key={`batch-cell-${idx}`}
                        fill={BRAND_COLORS[idx % BRAND_COLORS.length]}
                      />
                    ))}
                  </Bar>
                )}
                {batch30dViewMode === 'stacked' && (
                  <>
                    <Bar
                      dataKey="completedLength"
                      name="Completed Cable Length (m)"
                      fill="#10b981"
                      stackId="batch30d"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="inProgressLength"
                      name="In-Production / Active Length (m)"
                      fill="#3b82f6"
                      stackId="batch30d"
                      radius={[6, 6, 0, 0]}
                    />
                  </>
                )}
                {batch30dViewMode === 'produced_only' && (
                  <>
                    <Bar
                      dataKey="producedLength"
                      name="Stage-Active / Produced Length (m)"
                      fill="#059669"
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="completedLength"
                      name="Fully Finished Length (m)"
                      fill="#6366f1"
                      radius={[6, 6, 0, 0]}
                    />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Compact Batch Breakdown Table */}
        <div className="mt-3 overflow-x-auto border border-slate-100 rounded-lg">
          <table className="w-full text-[11px] text-left">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="p-1.5 px-2.5">Batch No.</th>
                <th className="p-1.5 px-2">Brand(s)</th>
                <th className="p-1.5 px-2 text-center">Orders</th>
                <th className="p-1.5 px-2 text-right">Total Cable Length</th>
                <th className="p-1.5 px-2 text-right">Stage-Produced</th>
                <th className="p-1.5 px-2 text-right">In-Production Queue</th>
                <th className="p-1.5 px-2 text-right">Total Core Length</th>
                <th className="p-1.5 px-2.5 text-right">Last Activity (30d)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batch30DayStats.rows.map((row, idx) => (
                <tr key={row.batch} className="hover:bg-slate-50">
                  <td className="p-1.5 px-2.5 font-bold text-slate-800 flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                      style={{ backgroundColor: BRAND_COLORS[idx % BRAND_COLORS.length] }}
                    />
                    <span>{row.batch}</span>
                  </td>
                  <td className="p-1.5 px-2 font-semibold text-slate-600">{row.brands}</td>
                  <td className="p-1.5 px-2 text-center font-medium text-slate-600">
                    {row.orderCount}
                  </td>
                  <td className="p-1.5 px-2 text-right font-black text-indigo-700">
                    {row.totalLength.toLocaleString()} m
                  </td>
                  <td className="p-1.5 px-2 text-right font-semibold text-emerald-700">
                    {row.producedLength.toLocaleString()} m
                  </td>
                  <td className="p-1.5 px-2 text-right font-medium text-amber-700">
                    {row.inProgressLength.toLocaleString()} m
                  </td>
                  <td className="p-1.5 px-2 text-right font-medium text-slate-600">
                    {row.coreLength.toLocaleString()} m
                  </td>
                  <td className="p-1.5 px-2.5 text-right text-slate-500">
                    {row.lastActivityDate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Main Charts Row: Brand Volume Bar Chart & Production Progress Status Distribution Bar Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* CHART 1: Total Order Volume by Brand (Bar Chart) */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-2">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-blue-50 text-blue-600 rounded-md">
                <BarChart3 className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Total Order Volume by Brand
                </h3>
                <p className="text-[11px] text-slate-500">
                  Aggregate production cable length (meters) and order counts per brand
                </p>
              </div>
            </div>

            {/* Metric Toggle */}
            <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs font-semibold no-print">
              <button
                onClick={() => setBarMetric('length')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  barMetric === 'length'
                    ? 'bg-white text-blue-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Volume (Meters)
              </button>
              <button
                onClick={() => setBarMetric('count')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  barMetric === 'count'
                    ? 'bg-white text-blue-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Order Count
              </button>
            </div>
          </div>

          {/* Recharts BarChart Container */}
          <div className="h-[300px] w-full pt-2">
            {brandData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                No orders available for selected filter.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={brandData}
                  margin={{ top: 15, right: 20, left: 10, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="brand"
                    tick={{ fill: '#475569', fontSize: 11, fontWeight: 600 }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={val =>
                      barMetric === 'length'
                        ? val >= 1000
                          ? `${(val / 1000).toFixed(0)}k m`
                          : `${val}m`
                        : `${val}`
                    }
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white p-3 rounded-lg shadow-xl border border-slate-700 text-xs space-y-1.5 min-w-[180px]">
                            <div className="font-bold text-sm text-blue-300 border-b border-slate-700 pb-1 flex items-center justify-between">
                              <span>{data.brand}</span>
                              <span className="text-[11px] font-normal text-slate-300">
                                {data.orderCount} Orders
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                              <span>Total Cable Volume:</span>
                              <span className="font-bold text-white">
                                {data.totalLength.toLocaleString()} m
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                              <span>Active Length:</span>
                              <span className="font-semibold text-amber-400">
                                {data.activeLength.toLocaleString()} m
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                              <span>Completed Length:</span>
                              <span className="font-semibold text-emerald-400">
                                {data.completedLength.toLocaleString()} m
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                              <span>Total Core Length:</span>
                              <span className="font-semibold text-white">
                                {data.coreLength.toLocaleString()} m
                              </span>
                            </div>
                            <div className="flex justify-between text-slate-300">
                              <span>Copper Required:</span>
                              <span className="font-bold text-blue-400">
                                {data.cuWeight.toFixed(1)} kg
                              </span>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ paddingBottom: 10, fontSize: 11 }}
                  />
                  {barMetric === 'length' ? (
                    <>
                      <Bar
                        dataKey="completedLength"
                        name="Completed Volume (m)"
                        fill="#10b981"
                        stackId="a"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="activeLength"
                        name="Active Volume (m)"
                        fill="#3b82f6"
                        stackId="a"
                        radius={[4, 4, 0, 0]}
                      />
                    </>
                  ) : (
                    <Bar
                      dataKey="orderCount"
                      name="Total Orders (Nos)"
                      fill="#6366f1"
                      radius={[6, 6, 0, 0]}
                    >
                      {brandData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={BRAND_COLORS[index % BRAND_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  )}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Quick summary table beneath bar chart */}
          <div className="mt-3 overflow-x-auto border border-slate-100 rounded-lg">
            <table className="w-full text-[11px] text-left">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-1.5 px-2">Brand</th>
                  <th className="p-1.5 px-2 text-center">Orders</th>
                  <th className="p-1.5 px-2 text-right">Total Length</th>
                  <th className="p-1.5 px-2 text-right">Active</th>
                  <th className="p-1.5 px-2 text-right">Completed</th>
                  <th className="p-1.5 px-2 text-right">Est. Copper</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {brandData.map((b, idx) => (
                  <tr key={b.brand} className="hover:bg-slate-50">
                    <td className="p-1.5 px-2 font-bold text-slate-800 flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: BRAND_COLORS[idx % BRAND_COLORS.length] }}
                      />
                      {b.brand}
                    </td>
                    <td className="p-1.5 px-2 text-center font-medium text-slate-600">
                      {b.orderCount}
                    </td>
                    <td className="p-1.5 px-2 text-right font-bold text-blue-700">
                      {b.totalLength.toLocaleString()} m
                    </td>
                    <td className="p-1.5 px-2 text-right font-medium text-amber-700">
                      {b.activeLength.toLocaleString()} m
                    </td>
                    <td className="p-1.5 px-2 text-right font-medium text-emerald-700">
                      {b.completedLength.toLocaleString()} m
                    </td>
                    <td className="p-1.5 px-2 text-right font-semibold text-slate-700">
                      {b.cuWeight.toFixed(1)} kg
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* CHART 2: Production Progress Status Distribution (Bunching, Cu Stranding, Insulation Extrusion, Twisting, Sheathing) (Recharts Bar Chart) */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between pb-3 mb-2 border-b border-slate-200 gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-purple-50 text-purple-600 rounded-md">
                  <BarChart3 className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Production Progress Status Distribution
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Bunching, Cu Stranding, Extrusion (Insulation), Twisting &amp; Sheathing across {activeOrders.length} active orders
                  </p>
                </div>
              </div>

              {/* View Mode Toggle: Stacked Bar / Completed Bar / Pie */}
              <div className="inline-flex p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-[11px] font-semibold no-print">
                <button
                  onClick={() => setProcessChartType('bar_stacked')}
                  className={`px-2 py-1 rounded transition-colors ${
                    processChartType === 'bar_stacked'
                      ? 'bg-white text-purple-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Done vs Pending Bar
                </button>
                <button
                  onClick={() => setProcessChartType('bar_completed')}
                  className={`px-2 py-1 rounded transition-colors ${
                    processChartType === 'bar_completed'
                      ? 'bg-white text-purple-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Stage Bar
                </button>
                <button
                  onClick={() => setProcessChartType('pie')}
                  className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${
                    processChartType === 'pie'
                      ? 'bg-white text-purple-700 shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <PieChartIcon className="w-3 h-3" /> Pie
                </button>
              </div>
            </div>

            {/* Recharts BarChart / PieChart Container */}
            <div className="h-[260px] w-full relative pt-1">
              {processChartType === 'pie' ? (
                totalCompletedStagesInActive === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs text-center p-4">
                    <Clock className="w-8 h-8 text-slate-300 mb-2" />
                    <span>No completed process stages yet in currently active orders.</span>
                    <span className="text-[10px] text-slate-400 mt-1">
                      Switch to &ldquo;Done vs Pending Bar&rdquo; or toggle B, CS, I, TS, SH in Active Orders.
                    </span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={processStageData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="count"
                        nameKey="name"
                        label={(props: any) =>
                          `${props.payload?.code || String(props.name || '').split(' ')[0]}: ${props.value}`
                        }
                        labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
                      >
                        {processStageData.map(entry => (
                          <Cell
                            key={entry.code}
                            fill={entry.color}
                            stroke="#ffffff"
                            strokeWidth={2}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-slate-900 text-white p-2.5 rounded-lg shadow-xl border border-slate-700 text-xs min-w-[180px]">
                                <div className="font-bold flex items-center justify-between border-b border-slate-700 pb-1 mb-1">
                                  <span style={{ color: data.color }}>{data.name}</span>
                                  <span className="font-mono text-slate-300">Stage {data.code}</span>
                                </div>
                                <div className="text-[11px] text-slate-400 mb-1">{data.desc}</div>
                                <div className="flex justify-between text-slate-200">
                                  <span>Completed Orders:</span>
                                  <span className="font-bold text-emerald-400">
                                    {data.count} / {data.requiredCount} req
                                  </span>
                                </div>
                                <div className="flex justify-between text-slate-200">
                                  <span>Pending Orders:</span>
                                  <span className="font-bold text-amber-400">{data.pendingCount}</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={processStageData}
                    margin={{ top: 12, right: 16, left: 0, bottom: 16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="shortStage"
                      tick={{ fill: '#334155', fontSize: 11, fontWeight: 700 }}
                      axisLine={{ stroke: '#cbd5e1' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-slate-900 text-white p-3 rounded-lg shadow-xl border border-slate-700 text-xs space-y-1 min-w-[210px]">
                              <div className="font-bold flex items-center justify-between border-b border-slate-700 pb-1 mb-1">
                                <span style={{ color: data.color }}>{data.name}</span>
                                <span className="font-mono text-[11px] text-slate-300">
                                  Stage {data.code}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400 pb-1">{data.desc}</div>
                              <div className="flex justify-between text-slate-200">
                                <span>✓ Completed Orders:</span>
                                <span className="font-bold text-emerald-400">
                                  {data.count} orders ({data.doneLength.toLocaleString()} m)
                                </span>
                              </div>
                              <div className="flex justify-between text-slate-200">
                                <span>⏳ Pending in Queue:</span>
                                <span className="font-bold text-amber-400">
                                  {data.pendingCount} orders ({data.pendingLength.toLocaleString()} m)
                                </span>
                              </div>
                              {data.skippedCount > 0 && (
                                <div className="flex justify-between text-slate-400">
                                  <span>— Rule Skipped:</span>
                                  <span>{data.skippedCount} orders</span>
                                </div>
                              )}
                              <div className="flex justify-between text-slate-200 pt-1 border-t border-slate-800">
                                <span>Stage Completion Rate:</span>
                                <span className="font-bold text-blue-400">{data.activePercent}%</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      wrapperStyle={{ paddingBottom: 8, fontSize: 11 }}
                    />
                    {processChartType === 'bar_stacked' ? (
                      <>
                        <Bar
                          dataKey="count"
                          name="Completed Orders"
                          fill="#10b981"
                          stackId="stage"
                          radius={[0, 0, 0, 0]}
                        />
                        <Bar
                          dataKey="pendingCount"
                          name="Pending / In-Queue"
                          fill="#f59e0b"
                          stackId="stage"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="skippedCount"
                          name="Rule Skipped (N/A)"
                          fill="#cbd5e1"
                          stackId="stage"
                          radius={[4, 4, 0, 0]}
                        />
                      </>
                    ) : (
                      <Bar
                        dataKey="count"
                        name="Completed Active Orders"
                        radius={[6, 6, 0, 0]}
                      >
                        {processStageData.map(entry => (
                          <Cell key={entry.code} fill={entry.color} />
                        ))}
                      </Bar>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Process Stage Progress Breakdown List */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
              <span>Active Orders Stage Completion Rate</span>
              <span className="text-[10px] text-slate-500 font-normal">
                {activeOrders.length} Active Orders
              </span>
            </div>

            <div className="grid grid-cols-1 gap-1.5 text-xs">
              {processStageData.map(p => {
                const percentNum = parseFloat(p.activePercent);
                return (
                  <div
                    key={p.code}
                    className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-[155px]">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="font-bold text-slate-800">{p.name}</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="flex-1 max-w-[150px] bg-slate-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${percentNum}%`,
                          backgroundColor: p.color,
                        }}
                      />
                    </div>

                    <div className="text-right min-w-[110px] text-[11px]">
                      <span className="font-bold text-emerald-700">{p.count} done</span>
                      <span className="text-slate-400 mx-1">•</span>
                      <span className="font-semibold text-amber-700">{p.pendingCount} pending</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Production Pipeline Process Flow Guide */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2.5 flex items-center gap-2">
          <span>🏭 Standard Cable Manufacturing Stage Flow (B → C → I → T → S)</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs">
          <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50/50">
            <div className="font-bold text-amber-900 flex items-center justify-between">
              <span>B • Bunching</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-amber-200 rounded font-black text-amber-800">Stage 1</span>
            </div>
            <p className="text-[11px] text-amber-800 mt-1">
              Bunching of fine copper strands to form flexible conductor cores.
            </p>
          </div>

          <div className="p-2.5 rounded-lg border border-orange-200 bg-orange-50/50">
            <div className="font-bold text-orange-900 flex items-center justify-between">
              <span>C • Stranding</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-orange-200 rounded font-black text-orange-800">Stage 2</span>
            </div>
            <p className="text-[11px] text-orange-800 mt-1">
              Cu ladi forming and conductor compacting per IS/IEC standards.
            </p>
          </div>

          <div className="p-2.5 rounded-lg border border-blue-200 bg-blue-50/50">
            <div className="font-bold text-blue-900 flex items-center justify-between">
              <span>I • Insulation</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-blue-200 rounded font-black text-blue-800">Stage 3</span>
            </div>
            <p className="text-[11px] text-blue-800 mt-1">
              PVC insulation extrusion over copper conductor with spark testing.
            </p>
          </div>

          <div className="p-2.5 rounded-lg border border-purple-200 bg-purple-50/50">
            <div className="font-bold text-purple-900 flex items-center justify-between">
              <span>T • Twisting</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-purple-200 rounded font-black text-purple-800">Stage 4</span>
            </div>
            <p className="text-[11px] text-purple-800 mt-1">
              Core stranding/twisting of insulated cores with specified lay length.
            </p>
          </div>

          <div className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/50">
            <div className="font-bold text-emerald-900 flex items-center justify-between">
              <span>S • Sheathing</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-emerald-200 rounded font-black text-emerald-800">Stage 5</span>
            </div>
            <p className="text-[11px] text-emerald-800 mt-1">
              Outer protective PVC sheathing extrusion, printing & winding on drum.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
