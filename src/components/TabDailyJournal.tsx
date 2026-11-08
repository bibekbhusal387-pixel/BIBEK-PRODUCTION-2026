import React, { useState, useMemo } from 'react';
import {
  CableOrder,
  DailyJournalEntry,
  DensitySettings,
  LadiDimensionRule,
} from '../types/cable';
import { DEFAULT_DENSITIES, DEFAULT_LADI_DIMENSIONS } from '../data/defaults';
import { computeRecordRow, exportCsvFile } from '../utils/calculations';
import { extractStrandDiameter } from '../utils/stockEngine';
import {
  Activity,
  CheckCircle2,
  Clock,
  Edit3,
  FileSpreadsheet,
  Gauge,
  Layers,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Scale,
  Search,
  Trash2,
  UserCheck,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

interface TabDailyJournalProps {
  entries: DailyJournalEntry[];
  orders: CableOrder[];
  densities?: DensitySettings;
  ladiDimensions?: LadiDimensionRule[];
  onUpdateEntries: (entries: DailyJournalEntry[]) => void;
  showNotice: (msg: string) => void;
}

const STANDARD_MACHINES = [
  'Bunching Machine #1 (High-Speed 630)',
  'Bunching Machine #2 (Double Twist 500)',
  'Cu Stranding / Ladi Rope Lay Line',
  '65mm High-Speed Core Insulation Extruder',
  '75mm Insulation Extruder Line #1',
  'Core Twisting / Stranding Cage Line',
  '90mm Heavy-Duty Sheathing Extruder',
  '120mm Rubber / H07RN-F Vulcanization Line',
  'Automatic Coiling & Carton Packing Line',
  'Drum Rewinding & Spark Testing Line',
];

const PROCESS_STAGES: DailyJournalEntry['processStage'][] = [
  'Bunching (B)',
  'Cu Stranding (CS)',
  'Insulation (I)',
  'Twisting (TS)',
  'Sheathing (SH)',
  'Packing & Coiling',
];

const STANDARD_SHIFT_HOURS = 12;

const SHIFTS: DailyJournalEntry['shift'][] = [
  'Shift A (Day 08:00-20:00)',
  'Shift B (Night 20:00-08:00)',
];

const DOWNTIME_REASONS = [
  'None / Continuous Run',
  'Spool & Pay-off Bobbin Reloading',
  'Die & Color Changeover',
  'Nozzle & Final Die Centering + Inkjet Setup',
  'Compound Heating / Extruder Purge',
  'Core Bobbin Loading & Talc Powder Refill',
  'Preventive Maintenance / Cleaning',
  'Electrical / Mechanical Breakdown',
  'Waiting for Raw Material / Bobbins',
];

export interface MaterialComparisonMetrics {
  rawMaterialName: string;
  sysCuKg: number;
  sysCompKg: number;
  totalSysKg: number;
  manCuKg: number;
  manCompKg: number;
  totalManKg: number;
  diffCuKg: number;
  diffCompKg: number;
  totalDiffKg: number;
  diffCuPct: number;
  diffCompPct: number;
  totalDiffPct: number;
  scrapKg: number;
  matchedOrderId?: number;
  orderSheetRefLabel?: string;
  orderSheetTargetM?: number;
}

/**
 * Matches a DailyJournalEntry to its corresponding row on the Order Sheet (`orders`).
 */
export function findMatchingOrderFromSheet(
  entry: Pick<DailyJournalEntry, 'orderId' | 'batch' | 'cableSpec'>,
  orders: CableOrder[]
): CableOrder | undefined {
  if (!orders || orders.length === 0) return undefined;

  // 1. Exact orderId match on the Order Sheet
  if (entry.orderId !== undefined && entry.orderId !== null) {
    const byId = orders.find(o => Number(o.id) === Number(entry.orderId));
    if (byId) return byId;
  }

  const batchClean = (entry.batch || '').trim().toUpperCase();
  const specClean = (entry.cableSpec || '').trim().toUpperCase();
  const coresMatch = specClean.match(/(\d+)\s*[CG]\b/);
  const parsedCores = coresMatch ? parseInt(coresMatch[1], 10) : null;

  // 2. Match by Batch + Cores + Size + Conductor on the Order Sheet
  if (batchClean) {
    const batchOrders = orders.filter(o => (o.batch || '').trim().toUpperCase() === batchClean);
    if (batchOrders.length > 0) {
      const exactSpec = batchOrders.find(
        o =>
          specClean.includes((o.size || '').trim().toUpperCase()) &&
          (parsedCores === null || Number(o.cores) === parsedCores) &&
          (!o.conductor || specClean.includes(o.conductor.trim().toUpperCase()))
      );
      if (exactSpec) return exactSpec;

      const byCoresAndSize = batchOrders.find(
        o =>
          specClean.includes((o.size || '').trim().toUpperCase()) &&
          (parsedCores === null || Number(o.cores) === parsedCores)
      );
      if (byCoresAndSize) return byCoresAndSize;

      const bySize = batchOrders.find(o => specClean.includes((o.size || '').trim().toUpperCase()));
      if (bySize) return bySize;

      if (batchOrders.length === 1) return batchOrders[0];
    }
  }

  // 3. Match across all Order Sheet rows by Brand + Cores + Size (handles legacy/edited batch names)
  if (specClean) {
    const byBrandCoresSize = orders.find(
      o =>
        o.brand &&
        specClean.includes(o.brand.trim().toUpperCase()) &&
        specClean.includes((o.size || '').trim().toUpperCase()) &&
        (parsedCores === null || Number(o.cores) === parsedCores)
    );
    if (byBrandCoresSize) return byBrandCoresSize;

    const byCoresSize = orders.find(
      o =>
        specClean.includes((o.size || '').trim().toUpperCase()) &&
        parsedCores !== null &&
        Number(o.cores) === parsedCores
    );
    if (byCoresSize) return byCoresSize;
  }

  // 4. Fallback to first matching batch order on the Order Sheet
  if (batchClean) {
    return orders.find(o => (o.batch || '').trim().toUpperCase() === batchClean);
  }

  return undefined;
}

/**
 * Picks the exact System Required Raw Material (Copper & PVC/Rubber Compound)
 * directly from the Order Sheet (`computeRecordRow(order, densities, ladiDimensions)` -> `reqCu`, `reqIns`, `reqSheath`).
 */
export function calculateEngineeringSystemMaterial(
  order: CableOrder | undefined,
  stage: DailyJournalEntry['processStage'],
  _outputMeters: number,
  _targetMeters: number,
  densities: DensitySettings,
  ladiDimensions: LadiDimensionRule[]
): {
  rawMaterialName: string;
  sysCuKg: number;
  sysCompKg: number;
  orderSheetTargetM: number;
  orderSheetRefLabel: string;
} {
  if (!order) {
    if (stage === 'Bunching (B)' || stage === 'Cu Stranding (CS)') {
      return { rawMaterialName: 'Raw Drawn Copper Wire Strands', sysCuKg: 0, sysCompKg: 0, orderSheetTargetM: 0, orderSheetRefLabel: '' };
    }
    if (stage === 'Insulation (I)') {
      return { rawMaterialName: 'Core Insulation PVC/Rubber Compound + Bunched Copper', sysCuKg: 0, sysCompKg: 0, orderSheetTargetM: 0, orderSheetRefLabel: '' };
    }
    if (stage === 'Sheathing (SH)') {
      return { rawMaterialName: 'Outer Sheath PVC/Rubber Compound', sysCuKg: 0, sysCompKg: 0, orderSheetTargetM: 0, orderSheetRefLabel: '' };
    }
    if (stage === 'Twisting (TS)') {
      return { rawMaterialName: 'Insulated Cores + Binder Tape / Talc', sysCuKg: 0, sysCompKg: 0, orderSheetTargetM: 0, orderSheetRefLabel: '' };
    }
    return { rawMaterialName: 'Finished Cable Coils / Wooden Drums & Cartons', sysCuKg: 0, sysCompKg: 0, orderSheetTargetM: 0, orderSheetRefLabel: '' };
  }

  const rec = computeRecordRow(order, densities, ladiDimensions);
  const strandDia = extractStrandDiameter(order.conductor);
  const orderSheetReqCu = Number((rec.reqCu || 0).toFixed(2));
  const orderSheetReqIns = Number((rec.reqIns || 0).toFixed(2));
  const orderSheetReqSheath = Number((rec.reqSheath || 0).toFixed(2));
  const orderSheetCoreLen = Math.round(rec.reqCoreLen || rec.orderLen || 0);
  const orderSheetCableLen = Math.round(rec.orderLen || 0);
  const orderSheetRefLabel = `Order #${order.id} (R${order.record_row || order.id}) • ${order.batch} • ${order.cores}C×${order.size}`;

  if (stage === 'Bunching (B)' || stage === 'Cu Stranding (CS)') {
    return {
      rawMaterialName: `Raw Copper Wire ${strandDia}mm (${order.conductor})`,
      sysCuKg: orderSheetReqCu,
      sysCompKg: 0,
      orderSheetTargetM: orderSheetCoreLen,
      orderSheetRefLabel,
    };
  }

  if (stage === 'Insulation (I)') {
    const insName = (order.ins_compound || 'PVC Insulation').trim();
    return {
      rawMaterialName: `Ins. Compound (${insName}) + Bunched Cu (${order.conductor})`,
      sysCuKg: orderSheetReqCu,
      sysCompKg: orderSheetReqIns,
      orderSheetTargetM: orderSheetCoreLen,
      orderSheetRefLabel,
    };
  }

  if (stage === 'Sheathing (SH)') {
    const shName = `${order.sheath_compound || 'Sheath Compound'} ${order.sheath_colour || ''}`.trim();
    return {
      rawMaterialName: `Sheath Compound (${shName})`,
      sysCuKg: 0,
      sysCompKg: orderSheetReqSheath,
      orderSheetTargetM: orderSheetCableLen,
      orderSheetRefLabel,
    };
  }

  if (stage === 'Twisting (TS)') {
    return {
      rawMaterialName: `Insulated Cores (${order.cores}C × ${order.size} ${order.ins_compound || ''}) + Binder Tape`,
      sysCuKg: 0,
      sysCompKg: 0,
      orderSheetTargetM: orderSheetCableLen,
      orderSheetRefLabel,
    };
  }

  return {
    rawMaterialName: `Finished Cable (${order.cores}C × ${order.size}) + Drums / Cartons`,
    sysCuKg: 0,
    sysCompKg: 0,
    orderSheetTargetM: orderSheetCableLen,
    orderSheetRefLabel,
  };
}

/**
 * Resolves full System vs. Manual Raw Material Comparison metrics for a DailyJournalEntry.
 * ALWAYS picks System Required (`sysCuKg`, `sysCompKg`) directly from the Order Sheet (`orders`)
 * whenever a matching Order Sheet row exists.
 */
export function resolveEntryMaterialComparison(
  entry: DailyJournalEntry,
  orders: CableOrder[],
  densities: DensitySettings,
  ladiDimensions: LadiDimensionRule[]
): MaterialComparisonMetrics {
  const matchedOrder = findMatchingOrderFromSheet(entry, orders);

  const autoCalc = calculateEngineeringSystemMaterial(
    matchedOrder,
    entry.processStage,
    entry.actualOutputM,
    entry.targetOutputM,
    densities,
    ladiDimensions
  );

  const rawMaterialName =
    entry.rawMaterialName && entry.rawMaterialName.trim() !== ''
      ? entry.rawMaterialName.trim()
      : autoCalc.rawMaterialName;

  const manCuKg = Math.max(0, Number(entry.copperConsumedKg) || 0);
  const manCompKg = Math.max(0, Number(entry.compoundConsumedKg) || 0);

  // If entry has explicit systemRequiredCuKg/CompoundKg (user set or edited), respect user's actual value!
  // Otherwise, pick from Order Sheet calculation if matched, or fallback to manual consumed.
  let sysCuKg = 0;
  let sysCompKg = 0;

  if (entry.systemRequiredCuKg !== undefined && entry.systemRequiredCuKg !== null) {
    sysCuKg = Math.max(0, Number(entry.systemRequiredCuKg) || 0);
  } else if (matchedOrder) {
    if (entry.processStage === 'Insulation (I)') {
      // On Insulation: always pick Order Sheet Req Ins (sysCompKg). If Manual Cu is also logged on Insulation, pick Order Sheet Req Cu.
      sysCompKg = autoCalc.sysCompKg;
      sysCuKg = manCuKg > 0 ? autoCalc.sysCuKg : 0;
    } else {
      sysCuKg = autoCalc.sysCuKg;
      sysCompKg = autoCalc.sysCompKg;
    }
  } else {
    sysCuKg = manCuKg;
  }

  if (entry.systemRequiredCompoundKg !== undefined && entry.systemRequiredCompoundKg !== null) {
    sysCompKg = Math.max(0, Number(entry.systemRequiredCompoundKg) || 0);
  } else if (matchedOrder) {
    sysCompKg = autoCalc.sysCompKg;
  } else {
    sysCompKg = manCompKg;
  }

  const totalSysKg = Number((sysCuKg + sysCompKg).toFixed(2));
  const totalManKg = Number((manCuKg + manCompKg).toFixed(2));

  // Difference = Manual (Actual Input) - Order Sheet System Required
  const diffCuKg = Number((manCuKg - sysCuKg).toFixed(2));
  const diffCompKg = Number((manCompKg - sysCompKg).toFixed(2));
  const totalDiffKg = Number((totalManKg - totalSysKg).toFixed(2));

  const diffCuPct = sysCuKg > 0 ? (diffCuKg / sysCuKg) * 100 : 0;
  const diffCompPct = sysCompKg > 0 ? (diffCompKg / sysCompKg) * 100 : 0;
  const totalDiffPct = totalSysKg > 0 ? (totalDiffKg / totalSysKg) * 100 : 0;

  return {
    rawMaterialName,
    sysCuKg,
    sysCompKg,
    totalSysKg,
    manCuKg,
    manCompKg,
    totalManKg,
    diffCuKg,
    diffCompKg,
    totalDiffKg,
    diffCuPct,
    diffCompPct,
    totalDiffPct,
    scrapKg: Math.max(0, Number(entry.scrapKg) || 0),
    matchedOrderId: matchedOrder?.id,
    orderSheetRefLabel: autoCalc.orderSheetRefLabel,
    orderSheetTargetM: autoCalc.orderSheetTargetM,
  };
}

export function computeEntryEfficiency(entry: DailyJournalEntry) {
  const plannedHrs = Math.max(0.1, Number(entry.plannedShiftHours) || 12);
  const runHrs = Math.max(0, Number(entry.actualRunHours) || 0);
  const availabilityPct = Math.min(100, (runHrs / plannedHrs) * 100);

  const targetM = Math.max(1, Number(entry.targetOutputM) || 1);
  const actualM = Math.max(0, Number(entry.actualOutputM) || 0);
  const performancePct = Math.min(125, (actualM / targetM) * 100);

  const totalMatKg =
    Math.max(0, Number(entry.copperConsumedKg) || 0) +
    Math.max(0, Number(entry.compoundConsumedKg) || 0);
  const scrapKg = Math.max(0, Number(entry.scrapKg) || 0);
  const qualityPct =
    totalMatKg > 0
      ? Math.max(0, Math.min(100, ((totalMatKg - scrapKg) / totalMatKg) * 100))
      : entry.qualityStatus === 'Pass / QC Approved'
      ? 100
      : entry.qualityStatus === 'Minor Rework'
      ? 92
      : 80;

  const cappedPerf = Math.min(100, performancePct);
  const oeePct = (availabilityPct / 100) * (cappedPerf / 100) * (qualityPct / 100) * 100;
  const lineSpeedMPerMin = runHrs > 0 ? actualM / (runHrs * 60) : 0;

  return {
    availabilityPct,
    performancePct,
    qualityPct,
    oeePct,
    lineSpeedMPerMin,
  };
}

export const TabDailyJournal: React.FC<TabDailyJournalProps> = ({
  entries,
  orders,
  densities = DEFAULT_DENSITIES,
  ladiDimensions = DEFAULT_LADI_DIMENSIONS,
  onUpdateEntries,
  showNotice,
}) => {
  const todayStr = () => new Date().toISOString().split('T')[0];

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDate, setFilterDate] = useState<string>('ALL');
  const [filterShift, setFilterShift] = useState<string>('ALL');
  const [filterStage, setFilterStage] = useState<string>('ALL');
  const [printReportDate, setPrintReportDate] = useState<string>(todayStr());

  // New Entry Form state
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [date, setDate] = useState<string>(todayStr());
  const [shift, setShift] = useState<DailyJournalEntry['shift']>('Shift A (Day 08:00-20:00)');
  const [processStage, setProcessStage] = useState<DailyJournalEntry['processStage']>('Bunching (B)');
  const [machineName, setMachineName] = useState<string>(STANDARD_MACHINES[0]);
  const [customMachineName, setCustomMachineName] = useState<string>('');
  const [batch, setBatch] = useState<string>('');
  const [cableSpec, setCableSpec] = useState<string>('');
  const [operatorName, setOperatorName] = useState<string>('');
  const [supervisorName, setSupervisorName] = useState<string>('');
  const [plannedShiftHours, setPlannedShiftHours] = useState<number>(12);
  const [actualRunHours, setActualRunHours] = useState<number>(11);
  const [downtimeHours, setDowntimeHours] = useState<number>(1);
  const [downtimeReason, setDowntimeReason] = useState<string>('Spool & Pay-off Bobbin Reloading');
  const [targetOutputM, setTargetOutputM] = useState<number>(15000);
  const [actualOutputM, setActualOutputM] = useState<number>(14500);
  const [rawMaterialName, setRawMaterialName] = useState<string>('Raw Copper Wire Strands');
  const [systemRequiredCuKg, setSystemRequiredCuKg] = useState<number>(0);
  const [systemRequiredCompoundKg, setSystemRequiredCompoundKg] = useState<number>(0);
  const [copperConsumedKg, setCopperConsumedKg] = useState<number>(0);
  const [compoundConsumedKg, setCompoundConsumedKg] = useState<number>(0);
  const [scrapKg, setScrapKg] = useState<number>(0);
  const [qualityStatus, setQualityStatus] = useState<DailyJournalEntry['qualityStatus']>('Pass / QC Approved');
  const [operatorNotes, setOperatorNotes] = useState<string>('');

  // Inline Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DailyJournalEntry | null>(null);

  // Machine-Wise Comparison Table Manual Editing State
  const [editingMachineKey, setEditingMachineKey] = useState<string | null>(null);
  const [machineEditDraft, setMachineEditDraft] = useState<{
    rawMaterialName: string;
    actualOutputM: number;
    sysCuKg: number;
    manCuKg: number;
    sysCompKg: number;
    manCompKg: number;
  } | null>(null);

  // Helper to recalculate System Required Material in the form when Order, Stage, or Output changes
  const recalculateFormSystemMaterial = (
    orderIdStr: string,
    stageVal: DailyJournalEntry['processStage'],
    actualMVal: number,
    targetMVal: number,
    syncManualToo = false
  ) => {
    const foundOrder = orderIdStr ? orders.find(o => String(o.id) === orderIdStr) : undefined;
    const calc = calculateEngineeringSystemMaterial(
      foundOrder,
      stageVal,
      actualMVal,
      targetMVal,
      densities,
      ladiDimensions
    );
    setRawMaterialName(calc.rawMaterialName);
    setSystemRequiredCuKg(calc.sysCuKg);
    setSystemRequiredCompoundKg(calc.sysCompKg);
    if (syncManualToo) {
      setCopperConsumedKg(calc.sysCuKg);
      setCompoundConsumedKg(calc.sysCompKg);
    }
  };

  // Handle selecting an active order to auto-fill Batch, Spec, Target Length, and System Required Material
  const handleSelectOrder = (orderIdStr: string) => {
    setSelectedOrderId(orderIdStr);
    if (!orderIdStr) return;
    const found = orders.find(o => String(o.id) === orderIdStr);
    if (found) {
      setBatch(found.batch);
      setCableSpec(
        `${found.brand} ${found.grade || ''} — ${found.cores}C × ${found.size} (${found.conductor})`.trim()
      );
      const rec = computeRecordRow(found, densities, ladiDimensions);
      const defaultLen =
        processStage === 'Bunching (B)' ||
        processStage === 'Cu Stranding (CS)' ||
        processStage === 'Insulation (I)'
          ? rec.reqCoreLen || found.order_length
          : found.order_length;

      if (defaultLen > 0) {
        setTargetOutputM(defaultLen);
        setActualOutputM(defaultLen);
        recalculateFormSystemMaterial(orderIdStr, processStage, defaultLen, defaultLen, true);
      } else {
        recalculateFormSystemMaterial(orderIdStr, processStage, actualOutputM, targetOutputM, true);
      }
    }
  };

  const handleStageChangeInForm = (newStage: DailyJournalEntry['processStage']) => {
    setProcessStage(newStage);
    const found = selectedOrderId ? orders.find(o => String(o.id) === selectedOrderId) : undefined;
    if (found) {
      const rec = computeRecordRow(found, densities, ladiDimensions);
      const newLen =
        newStage === 'Bunching (B)' ||
        newStage === 'Cu Stranding (CS)' ||
        newStage === 'Insulation (I)'
          ? rec.reqCoreLen || found.order_length
          : found.order_length;
      if (newLen > 0) {
        setTargetOutputM(newLen);
        setActualOutputM(newLen);
        recalculateFormSystemMaterial(selectedOrderId, newStage, newLen, newLen, true);
        return;
      }
    }
    recalculateFormSystemMaterial(selectedOrderId, newStage, actualOutputM, targetOutputM, false);
  };

  const handleActualOutputChangeInForm = (val: number) => {
    const cleanVal = Math.max(0, val);
    setActualOutputM(cleanVal);
    if (selectedOrderId) {
      recalculateFormSystemMaterial(selectedOrderId, processStage, cleanVal, targetOutputM, false);
    }
  };

  // Auto-sync between 12-Hour Shift Planned Hours, Actual Run Hours, and Downtime Hours
  const handlePlannedHoursChange = (val: number) => {
    const p = Math.max(0, val);
    setPlannedShiftHours(p);
    setDowntimeHours(Math.max(0, Number((p - actualRunHours).toFixed(2))));
  };

  const handleActualRunHoursChange = (val: number) => {
    const r = Math.min(plannedShiftHours, Math.max(0, val));
    setActualRunHours(r);
    setDowntimeHours(Math.max(0, Number((plannedShiftHours - r).toFixed(2))));
  };

  const handleDowntimeHoursChange = (val: number) => {
    const d = Math.min(plannedShiftHours, Math.max(0, val));
    setDowntimeHours(d);
    setActualRunHours(Math.max(0, Number((plannedShiftHours - d).toFixed(2))));
  };

  // Live preview of Manual vs. System Difference inside the New Entry form
  const formDiffCu = Number(((Number(copperConsumedKg) || 0) - (Number(systemRequiredCuKg) || 0)).toFixed(2));
  const formDiffComp = Number(((Number(compoundConsumedKg) || 0) - (Number(systemRequiredCompoundKg) || 0)).toFixed(2));
  const formTotalSys = Number(((Number(systemRequiredCuKg) || 0) + (Number(systemRequiredCompoundKg) || 0)).toFixed(2));
  const formTotalMan = Number(((Number(copperConsumedKg) || 0) + (Number(compoundConsumedKg) || 0)).toFixed(2));
  const formTotalDiff = Number((formTotalMan - formTotalSys).toFixed(2));
  const formTotalDiffPct = formTotalSys > 0 ? (formTotalDiff / formTotalSys) * 100 : 0;

  const handleAddEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const finalMachine = machineName === '__CUSTOM__' ? customMachineName.trim() : machineName;
    if (!finalMachine) {
      showNotice('⚠️ Please select or enter a Machine Name.');
      return;
    }
    if (!operatorName.trim()) {
      showNotice('⚠️ Please enter the Operator Name.');
      return;
    }

    const newEntry: DailyJournalEntry = {
      id: `DJ-${Date.now()}`,
      date: date || todayStr(),
      shift,
      machineName: finalMachine,
      processStage,
      batch: batch.trim() || 'GENERAL',
      orderId: selectedOrderId ? Number(selectedOrderId) : undefined,
      cableSpec: cableSpec.trim() || 'Standard Production Run',
      operatorName: operatorName.trim(),
      supervisorName: supervisorName.trim() || '-',
      plannedShiftHours: Number(plannedShiftHours) || 12,
      actualRunHours: Number(actualRunHours) || 0,
      downtimeHours: Number(downtimeHours) || 0,
      downtimeReason: downtimeReason.trim() || 'None',
      targetOutputM: Number(targetOutputM) || 0,
      actualOutputM: Number(actualOutputM) || 0,
      rawMaterialName: rawMaterialName.trim() || 'Standard Raw Material',
      systemRequiredCuKg: Number(systemRequiredCuKg) || 0,
      systemRequiredCompoundKg: Number(systemRequiredCompoundKg) || 0,
      copperConsumedKg: Number(copperConsumedKg) || 0,
      compoundConsumedKg: Number(compoundConsumedKg) || 0,
      scrapKg: Number(scrapKg) || 0,
      qualityStatus,
      operatorNotes: operatorNotes.trim() || 'Normal shift operation.',
      createdAt: new Date().toISOString(),
    };

    onUpdateEntries([newEntry, ...entries]);
    showNotice(
      `✅ Recorded Daily Production Journal entry for ${newEntry.machineName} (${newEntry.batch} • Diff: ${formTotalDiff >= 0 ? '+' : ''}${formTotalDiff.toFixed(1)} kg).`
    );

    setOperatorNotes('');
    setScrapKg(0);
  };

  const handleStartEdit = (entry: DailyJournalEntry) => {
    const mat = resolveEntryMaterialComparison(entry, orders, densities, ladiDimensions);
    setEditingId(entry.id);
    setEditDraft({
      ...entry,
      rawMaterialName: mat.rawMaterialName,
      systemRequiredCuKg: mat.sysCuKg,
      systemRequiredCompoundKg: mat.sysCompKg,
    });
  };

  const handleSaveEdit = () => {
    if (!editDraft) return;
    const updated = entries.map(item => (item.id === editDraft.id ? editDraft : item));
    onUpdateEntries(updated);
    setEditingId(null);
    setEditDraft(null);
    showNotice(`✅ Updated shift journal entry & material comparison for ${editDraft.batch} (${editDraft.machineName}).`);
  };

  const handleDeleteEntry = (id: string) => {
    const target = entries.find(e => e.id === id);
    onUpdateEntries(entries.filter(e => e.id !== id));
    if (target) {
      showNotice(`🗑️ Removed journal entry for ${target.batch} (${target.machineName}).`);
    }
  };

  // Handlers for Machine-Wise Comparison Table Manual Editing
  const handleStartEditMachine = (mRow: {
    mKey: string;
    rawMaterialsList: string;
    actualOutputM: number;
    sysCuKg: number;
    manCuKg: number;
    sysCompKg: number;
    manCompKg: number;
  }) => {
    setEditingMachineKey(mRow.mKey);
    setMachineEditDraft({
      rawMaterialName: mRow.rawMaterialsList || '',
      actualOutputM: mRow.actualOutputM || 0,
      sysCuKg: mRow.sysCuKg || 0,
      manCuKg: mRow.manCuKg || 0,
      sysCompKg: mRow.sysCompKg || 0,
      manCompKg: mRow.manCompKg || 0,
    });
  };

  const handleSaveEditMachine = (mRow: {
    mKey: string;
    machineName: string;
    processStage: string;
    batchesList: string;
    orderSheetRefsList: string;
    orderId?: number;
    entryIds?: string[];
  }) => {
    if (!machineEditDraft) return;

    if (mRow.entryIds && mRow.entryIds.length > 0) {
      // Update existing journal entries that correspond to this machine row
      const updated = entries.map(e => {
        if (mRow.entryIds?.includes(e.id)) {
          return {
            ...e,
            rawMaterialName: machineEditDraft.rawMaterialName.trim() || e.rawMaterialName,
            actualOutputM: machineEditDraft.actualOutputM,
            systemRequiredCuKg: machineEditDraft.sysCuKg,
            copperConsumedKg: machineEditDraft.manCuKg,
            systemRequiredCompoundKg: machineEditDraft.sysCompKg,
            compoundConsumedKg: machineEditDraft.manCompKg,
          };
        }
        return e;
      });
      onUpdateEntries(updated);
    } else {
      // No existing entry for this order sheet machine row -> create a new journal record!
      const newEntry: DailyJournalEntry = {
        id: `DJ-MACH-${Date.now()}`,
        date: todayStr(),
        shift: 'Shift A (Day 08:00-20:00)',
        machineName: mRow.machineName,
        processStage: mRow.processStage as any,
        batch: mRow.batchesList || 'GENERAL',
        orderId: mRow.orderId,
        cableSpec: mRow.orderSheetRefsList || mRow.machineName,
        operatorName: 'Shift Operator',
        supervisorName: 'Shift Supervisor',
        plannedShiftHours: 12,
        actualRunHours: 11,
        downtimeHours: 1,
        downtimeReason: 'Die & Color Changeover',
        targetOutputM: machineEditDraft.actualOutputM,
        actualOutputM: machineEditDraft.actualOutputM,
        rawMaterialName: machineEditDraft.rawMaterialName.trim() || 'Custom Raw Material',
        systemRequiredCuKg: machineEditDraft.sysCuKg,
        copperConsumedKg: machineEditDraft.manCuKg,
        systemRequiredCompoundKg: machineEditDraft.sysCompKg,
        compoundConsumedKg: machineEditDraft.manCompKg,
        scrapKg: 0,
        qualityStatus: 'Pass / QC Approved',
        operatorNotes: `Manual machine comparison entry for ${mRow.machineName}.`,
        createdAt: new Date().toISOString(),
      };
      onUpdateEntries([newEntry, ...entries]);
    }

    setEditingMachineKey(null);
    setMachineEditDraft(null);
    showNotice(`✅ Saved manual edits for ${mRow.machineName} (${mRow.batchesList})! Difference updated.`);
  };

  // Unique dates for filter dropdown
  const uniqueDates = useMemo(() => {
    const set = new Set<string>();
    entries.forEach(e => {
      if (e.date) set.add(e.date);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [entries]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      if (filterDate !== 'ALL' && e.date !== filterDate) return false;
      if (filterShift !== 'ALL' && e.shift !== filterShift) return false;
      if (filterStage !== 'ALL' && e.processStage !== filterStage) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const mat = resolveEntryMaterialComparison(e, orders, densities, ladiDimensions);
        const hay = `${e.batch} ${e.cableSpec} ${e.machineName} ${e.operatorName} ${e.supervisorName || ''} ${e.operatorNotes} ${e.downtimeReason} ${mat.rawMaterialName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, filterDate, filterShift, filterStage, searchQuery, orders, densities, ladiDimensions]);

  // Aggregate efficiency + System vs Manual Raw Material metrics across filtered entries
  const summaryStats = useMemo(() => {
    if (filteredEntries.length === 0) {
      return {
        totalPlannedHrs: 0,
        totalRunHrs: 0,
        totalDowntimeHrs: 0,
        totalTargetM: 0,
        totalActualM: 0,
        totalSysCuKg: 0,
        totalSysCompKg: 0,
        totalSysKg: 0,
        totalCuKg: 0,
        totalCompKg: 0,
        totalManKg: 0,
        totalDiffCuKg: 0,
        totalDiffCompKg: 0,
        totalDiffKg: 0,
        totalDiffPct: 0,
        totalScrapKg: 0,
        avgAvailabilityPct: 0,
        avgPerformancePct: 0,
        avgQualityPct: 0,
        avgOeePct: 0,
      };
    }

    let totalPlannedHrs = 0;
    let totalRunHrs = 0;
    let totalDowntimeHrs = 0;
    let totalTargetM = 0;
    let totalActualM = 0;
    let totalSysCuKg = 0;
    let totalSysCompKg = 0;
    let totalCuKg = 0;
    let totalCompKg = 0;
    let totalScrapKg = 0;
    let oeeSum = 0;

    filteredEntries.forEach(e => {
      totalPlannedHrs += Number(e.plannedShiftHours) || 0;
      totalRunHrs += Number(e.actualRunHours) || 0;
      totalDowntimeHrs += Number(e.downtimeHours) || 0;
      totalTargetM += Number(e.targetOutputM) || 0;
      totalActualM += Number(e.actualOutputM) || 0;

      const mat = resolveEntryMaterialComparison(e, orders, densities, ladiDimensions);
      totalSysCuKg += mat.sysCuKg;
      totalSysCompKg += mat.sysCompKg;
      totalCuKg += mat.manCuKg;
      totalCompKg += mat.manCompKg;
      totalScrapKg += mat.scrapKg;

      const eff = computeEntryEfficiency(e);
      oeeSum += eff.oeePct;
    });

    const totalSysKg = totalSysCuKg + totalSysCompKg;
    const totalManKg = totalCuKg + totalCompKg;
    const totalDiffCuKg = totalCuKg - totalSysCuKg;
    const totalDiffCompKg = totalCompKg - totalSysCompKg;
    const totalDiffKg = totalManKg - totalSysKg;
    const totalDiffPct = totalSysKg > 0 ? (totalDiffKg / totalSysKg) * 100 : 0;

    const avgAvailabilityPct =
      totalPlannedHrs > 0 ? Math.min(100, (totalRunHrs / totalPlannedHrs) * 100) : 0;
    const avgPerformancePct =
      totalTargetM > 0 ? Math.min(125, (totalActualM / totalTargetM) * 100) : 0;
    const avgQualityPct =
      totalManKg > 0 ? Math.max(0, Math.min(100, ((totalManKg - totalScrapKg) / totalManKg) * 100)) : 100;
    const avgOeePct = oeeSum / filteredEntries.length;

    return {
      totalPlannedHrs,
      totalRunHrs,
      totalDowntimeHrs,
      totalTargetM,
      totalActualM,
      totalSysCuKg,
      totalSysCompKg,
      totalSysKg,
      totalCuKg,
      totalCompKg,
      totalManKg,
      totalDiffCuKg,
      totalDiffCompKg,
      totalDiffKg,
      totalDiffPct,
      totalScrapKg,
      avgAvailabilityPct,
      avgPerformancePct,
      avgQualityPct,
      avgOeePct,
    };
  }, [filteredEntries, orders, densities, ladiDimensions]);

  // Order Sheet Picker state inside Machine-Wise Comparison Panel
  const [comparisonSourceMode, setComparisonSourceMode] = useState<'JOURNAL_LINKED' | 'ALL_ORDER_SHEET'>('JOURNAL_LINKED');
  const [orderSheetBatchFilter, setOrderSheetBatchFilter] = useState<string>('ALL');
  const [quickPickOrderId, setQuickPickOrderId] = useState<string>('');

  const orderSheetBatches = useMemo(() => {
    const s = new Set<string>();
    orders.forEach(o => {
      if (o.batch) s.add(o.batch);
    });
    return Array.from(s).sort();
  }, [orders]);

  // Sync all existing journal entries with exact Order Sheet System Required values
  const handleSyncAllWithOrderSheet = () => {
    const synced = entries.map(entry => {
      const matched = findMatchingOrderFromSheet(entry, orders);
      if (!matched) return entry;
      const calc = calculateEngineeringSystemMaterial(
        matched,
        entry.processStage,
        entry.actualOutputM,
        entry.targetOutputM,
        densities,
        ladiDimensions
      );
      const sysCu =
        entry.processStage === 'Insulation (I)' && !(Number(entry.copperConsumedKg) > 0)
          ? 0
          : calc.sysCuKg;
      return {
        ...entry,
        orderId: matched.id,
        batch: matched.batch,
        cableSpec: `${matched.brand} ${matched.grade || ''} — ${matched.cores}C × ${matched.size} (${matched.conductor})`.trim(),
        targetOutputM: calc.orderSheetTargetM || entry.targetOutputM,
        rawMaterialName: calc.rawMaterialName,
        systemRequiredCuKg: sysCu,
        systemRequiredCompoundKg: calc.sysCompKg,
      };
    });
    onUpdateEntries(synced);
    showNotice('✅ Picked & synchronized all Machine System Required (Cu & PVC Kg) directly from the Order Sheet!');
  };

  // Quick-add Bunching, Insulation, and Sheathing machine comparison rows directly from a selected Order Sheet item
  const handlePickOrderIntoComparison = () => {
    if (!quickPickOrderId) {
      showNotice('⚠️ Please select an Order from the Order Sheet dropdown first.');
      return;
    }
    const found = orders.find(o => String(o.id) === quickPickOrderId);
    if (!found) return;
    const rec = computeRecordRow(found, densities, ladiDimensions);
    const specStr = `${found.brand} ${found.grade || ''} — ${found.cores}C × ${found.size} (${found.conductor})`.trim();
    const strandDia = extractStrandDiameter(found.conductor);
    const nowIso = new Date().toISOString();
    const newRows: DailyJournalEntry[] = [];

    if (rec.reqCu > 0) {
      newRows.push({
        id: `DJ-OS-B-${found.id}-${Date.now()}`,
        date: todayStr(),
        shift: 'Shift A (Day 08:00-20:00)',
        machineName: 'Bunching Machine #1 (High-Speed 630)',
        processStage: 'Bunching (B)',
        batch: found.batch,
        orderId: found.id,
        cableSpec: specStr,
        operatorName: 'Shift Operator',
        supervisorName: 'Shift Supervisor',
        plannedShiftHours: 12,
        actualRunHours: 11,
        downtimeHours: 1,
        downtimeReason: 'Spool & Pay-off Bobbin Reloading',
        targetOutputM: Math.round(rec.reqCoreLen || rec.orderLen),
        actualOutputM: Math.round(rec.reqCoreLen || rec.orderLen),
        rawMaterialName: `Raw Copper Wire ${strandDia}mm (${found.conductor})`,
        systemRequiredCuKg: Number(rec.reqCu.toFixed(2)),
        systemRequiredCompoundKg: 0,
        copperConsumedKg: Number(rec.reqCu.toFixed(2)),
        compoundConsumedKg: 0,
        scrapKg: 0,
        qualityStatus: 'Pass / QC Approved',
        operatorNotes: `Picked System Required Cu (${rec.reqCu.toFixed(2)} kg) from Order Sheet #${found.id} (${found.batch}).`,
        createdAt: nowIso,
      });
    }

    if (rec.reqIns > 0) {
      newRows.push({
        id: `DJ-OS-I-${found.id}-${Date.now() + 1}`,
        date: todayStr(),
        shift: 'Shift A (Day 08:00-20:00)',
        machineName: '75mm Insulation Extruder Line #1',
        processStage: 'Insulation (I)',
        batch: found.batch,
        orderId: found.id,
        cableSpec: specStr,
        operatorName: 'Shift Operator',
        supervisorName: 'Shift Supervisor',
        plannedShiftHours: 12,
        actualRunHours: 11,
        downtimeHours: 1,
        downtimeReason: 'Die & Color Changeover',
        targetOutputM: Math.round(rec.reqCoreLen || rec.orderLen),
        actualOutputM: Math.round(rec.reqCoreLen || rec.orderLen),
        rawMaterialName: `Ins. Compound (${found.ins_compound || 'PVC'})`,
        systemRequiredCuKg: 0,
        systemRequiredCompoundKg: Number(rec.reqIns.toFixed(2)),
        copperConsumedKg: 0,
        compoundConsumedKg: Number(rec.reqIns.toFixed(2)),
        scrapKg: 0,
        qualityStatus: 'Pass / QC Approved',
        operatorNotes: `Picked System Required Insulation (${rec.reqIns.toFixed(2)} kg) from Order Sheet #${found.id} (${found.batch}).`,
        createdAt: nowIso,
      });
    }

    if (rec.reqSheath > 0) {
      newRows.push({
        id: `DJ-OS-SH-${found.id}-${Date.now() + 2}`,
        date: todayStr(),
        shift: 'Shift B (Night 20:00-08:00)',
        machineName: '90mm Heavy-Duty Sheathing Extruder',
        processStage: 'Sheathing (SH)',
        batch: found.batch,
        orderId: found.id,
        cableSpec: specStr,
        operatorName: 'Shift Operator',
        supervisorName: 'Shift Supervisor',
        plannedShiftHours: 12,
        actualRunHours: 11,
        downtimeHours: 1,
        downtimeReason: 'Nozzle & Final Die Centering + Inkjet Setup',
        targetOutputM: Math.round(rec.orderLen),
        actualOutputM: Math.round(rec.orderLen),
        rawMaterialName: `Sheath Compound (${found.sheath_compound || 'Sheath'} ${found.sheath_colour || ''})`.trim(),
        systemRequiredCuKg: 0,
        systemRequiredCompoundKg: Number(rec.reqSheath.toFixed(2)),
        copperConsumedKg: 0,
        compoundConsumedKg: Number(rec.reqSheath.toFixed(2)),
        scrapKg: 0,
        qualityStatus: 'Pass / QC Approved',
        operatorNotes: `Picked System Required Sheath (${rec.reqSheath.toFixed(2)} kg) from Order Sheet #${found.id} (${found.batch}).`,
        createdAt: nowIso,
      });
    }

    onUpdateEntries([...newRows, ...entries]);
    showNotice(
      `✅ Picked Order Sheet #${found.id} (${found.batch} • ${found.cores}C×${found.size}) into Machine Comparison: Cu ${rec.reqCu.toFixed(2)}kg | Ins ${rec.reqIns.toFixed(2)}kg | Sheath ${rec.reqSheath.toFixed(2)}kg!`
    );
  };

  // Machine-Wise Required Raw Material & Manual vs. System Difference Breakdown (Picked from Order Sheet)
  const machineMaterialComparison = useMemo(() => {
    if (comparisonSourceMode === 'ALL_ORDER_SHEET') {
      // Build machine comparison rows directly from the Order Sheet (orders)
      const sheetOrders = orders.filter(
        o => orderSheetBatchFilter === 'ALL' || o.batch === orderSheetBatchFilter
      );
      const rows: {
        mKey: string;
        orderId?: number;
        entryIds: string[];
        machineName: string;
        processStage: string;
        shiftsCount: number;
        plannedHrs: number;
        runHrs: number;
        batchesList: string;
        orderSheetRefsList: string;
        rawMaterialsList: string;
        actualOutputM: number;
        sysCuKg: number;
        manCuKg: number;
        diffCuKg: number;
        sysCompKg: number;
        manCompKg: number;
        diffCompKg: number;
        totalSysKg: number;
        totalManKg: number;
        totalDiffKg: number;
        totalDiffPct: number;
        scrapKg: number;
      }[] = [];

      sheetOrders.forEach(o => {
        const rec = computeRecordRow(o, densities, ladiDimensions);
        const strandDia = extractStrandDiameter(o.conductor);
        const refLabel = `Order #${o.id} (R${o.record_row || o.id}) • ${o.cores}C×${o.size}`;

        // Match any journal entries logged for this Order Sheet row
        const matchingEntries = entries.filter(e => {
          const m = findMatchingOrderFromSheet(e, orders);
          return m?.id === o.id;
        });

        // 1. Bunching Machine (Order Sheet Req Cu)
        if (rec.reqCu > 0) {
          const bEntries = matchingEntries.filter(
            e => e.processStage === 'Bunching (B)' || e.processStage === 'Cu Stranding (CS)'
          );
          const sysCu = Number(rec.reqCu.toFixed(2));
          const manCu = Number(
            bEntries.reduce((s, e) => s + (Number(e.copperConsumedKg) || 0), 0).toFixed(2)
          );
          const diffCu = Number((manCu - sysCu).toFixed(2));
          rows.push({
            mKey: `OS-B-${o.id}`,
            orderId: o.id,
            entryIds: bEntries.map(e => e.id),
            machineName: bEntries[0]?.machineName || 'Bunching Machine #1 (High-Speed 630)',
            processStage: 'Bunching (B)',
            shiftsCount: bEntries.length || 1,
            plannedHrs: bEntries.reduce((s, e) => s + (Number(e.plannedShiftHours) || 12), 0) || 12,
            runHrs: bEntries.reduce((s, e) => s + (Number(e.actualRunHours) || 0), 0),
            batchesList: o.batch,
            orderSheetRefsList: refLabel,
            rawMaterialsList: `Raw Copper Wire ${strandDia}mm (${o.conductor})`,
            actualOutputM: Math.round(rec.reqCoreLen || rec.orderLen),
            sysCuKg: sysCu,
            manCuKg: manCu,
            diffCuKg: diffCu,
            sysCompKg: 0,
            manCompKg: 0,
            diffCompKg: 0,
            totalSysKg: sysCu,
            totalManKg: manCu,
            totalDiffKg: diffCu,
            totalDiffPct: sysCu > 0 ? (diffCu / sysCu) * 100 : 0,
            scrapKg: bEntries.reduce((s, e) => s + (Number(e.scrapKg) || 0), 0),
          });
        }

        // 2. Insulation Extruder (Order Sheet Req Ins)
        if (rec.reqIns > 0) {
          const iEntries = matchingEntries.filter(e => e.processStage === 'Insulation (I)');
          const manCu = Number(
            iEntries.reduce((s, e) => s + (Number(e.copperConsumedKg) || 0), 0).toFixed(2)
          );
          const sysCu = manCu > 0 ? Number(rec.reqCu.toFixed(2)) : 0;
          const sysComp = Number(rec.reqIns.toFixed(2));
          const manComp = Number(
            iEntries.reduce((s, e) => s + (Number(e.compoundConsumedKg) || 0), 0).toFixed(2)
          );
          const diffCu = Number((manCu - sysCu).toFixed(2));
          const diffComp = Number((manComp - sysComp).toFixed(2));
          const totalSys = Number((sysCu + sysComp).toFixed(2));
          const totalMan = Number((manCu + manComp).toFixed(2));
          const totalDiff = Number((totalMan - totalSys).toFixed(2));
          rows.push({
            mKey: `OS-I-${o.id}`,
            orderId: o.id,
            entryIds: iEntries.map(e => e.id),
            machineName: iEntries[0]?.machineName || '75mm Insulation Extruder Line #1',
            processStage: 'Insulation (I)',
            shiftsCount: iEntries.length || 1,
            plannedHrs: iEntries.reduce((s, e) => s + (Number(e.plannedShiftHours) || 12), 0) || 12,
            runHrs: iEntries.reduce((s, e) => s + (Number(e.actualRunHours) || 0), 0),
            batchesList: o.batch,
            orderSheetRefsList: refLabel,
            rawMaterialsList: `Ins. Compound (${o.ins_compound || 'PVC'})`,
            actualOutputM: Math.round(rec.reqCoreLen || rec.orderLen),
            sysCuKg: sysCu,
            manCuKg: manCu,
            diffCuKg: diffCu,
            sysCompKg: sysComp,
            manCompKg: manComp,
            diffCompKg: diffComp,
            totalSysKg: totalSys,
            totalManKg: totalMan,
            totalDiffKg: totalDiff,
            totalDiffPct: totalSys > 0 ? (totalDiff / totalSys) * 100 : 0,
            scrapKg: iEntries.reduce((s, e) => s + (Number(e.scrapKg) || 0), 0),
          });
        }

        // 3. Sheathing Extruder (Order Sheet Req Sheath)
        if (rec.reqSheath > 0) {
          const shEntries = matchingEntries.filter(e => e.processStage === 'Sheathing (SH)');
          const sysComp = Number(rec.reqSheath.toFixed(2));
          const manComp = Number(
            shEntries.reduce((s, e) => s + (Number(e.compoundConsumedKg) || 0), 0).toFixed(2)
          );
          const diffComp = Number((manComp - sysComp).toFixed(2));
          rows.push({
            mKey: `OS-SH-${o.id}`,
            orderId: o.id,
            entryIds: shEntries.map(e => e.id),
            machineName: shEntries[0]?.machineName || '90mm Heavy-Duty Sheathing Extruder',
            processStage: 'Sheathing (SH)',
            shiftsCount: shEntries.length || 1,
            plannedHrs: shEntries.reduce((s, e) => s + (Number(e.plannedShiftHours) || 12), 0) || 12,
            runHrs: shEntries.reduce((s, e) => s + (Number(e.actualRunHours) || 0), 0),
            batchesList: o.batch,
            orderSheetRefsList: refLabel,
            rawMaterialsList: `Sheath Compound (${o.sheath_compound || 'Sheath'} ${o.sheath_colour || ''})`.trim(),
            actualOutputM: Math.round(rec.orderLen),
            sysCuKg: 0,
            manCuKg: 0,
            diffCuKg: 0,
            sysCompKg: sysComp,
            manCompKg: manComp,
            diffCompKg: diffComp,
            totalSysKg: sysComp,
            totalManKg: manComp,
            totalDiffKg: diffComp,
            totalDiffPct: sysComp > 0 ? (diffComp / sysComp) * 100 : 0,
            scrapKg: shEntries.reduce((s, e) => s + (Number(e.scrapKg) || 0), 0),
          });
        }
      });

      return rows;
    }

    const map = new Map<
      string,
      {
        mKey: string;
        orderId?: number;
        entryIds: string[];
        machineName: string;
        processStage: string;
        shiftsCount: number;
        plannedHrs: number;
        runHrs: number;
        batches: Set<string>;
        orderSheetRefs: Set<string>;
        countedOrderIds: Set<number>;
        rawMaterials: Set<string>;
        actualOutputM: number;
        sysCuKg: number;
        manCuKg: number;
        diffCuKg: number;
        sysCompKg: number;
        manCompKg: number;
        diffCompKg: number;
        totalSysKg: number;
        totalManKg: number;
        totalDiffKg: number;
        scrapKg: number;
      }
    >();

    filteredEntries.forEach(entry => {
      if (orderSheetBatchFilter !== 'ALL' && entry.batch !== orderSheetBatchFilter) return;
      const mKey = `${entry.machineName}||${entry.processStage}||${entry.orderId || entry.batch}`;
      const mat = resolveEntryMaterialComparison(entry, orders, densities, ladiDimensions);
      const existing = map.get(mKey) || {
        mKey,
        orderId: entry.orderId,
        entryIds: [],
        machineName: entry.machineName,
        processStage: entry.processStage,
        shiftsCount: 0,
        plannedHrs: 0,
        runHrs: 0,
        batches: new Set<string>(),
        orderSheetRefs: new Set<string>(),
        countedOrderIds: new Set<number>(),
        rawMaterials: new Set<string>(),
        actualOutputM: 0,
        sysCuKg: 0,
        manCuKg: 0,
        diffCuKg: 0,
        sysCompKg: 0,
        manCompKg: 0,
        diffCompKg: 0,
        totalSysKg: 0,
        totalManKg: 0,
        totalDiffKg: 0,
        scrapKg: 0,
      };

      existing.entryIds.push(entry.id);
      if (entry.orderId && !existing.orderId) existing.orderId = entry.orderId;
      existing.shiftsCount += 1;
      existing.plannedHrs += Number(entry.plannedShiftHours) || STANDARD_SHIFT_HOURS;
      existing.runHrs += Number(entry.actualRunHours) || 0;
      if (entry.batch) existing.batches.add(entry.batch);
      if (mat.orderSheetRefLabel) existing.orderSheetRefs.add(mat.orderSheetRefLabel);
      if (mat.rawMaterialName) existing.rawMaterials.add(mat.rawMaterialName);
      existing.actualOutputM += Number(entry.actualOutputM) || 0;

      // Pick System Required once per unique Order Sheet item on this machine/stage
      if (mat.matchedOrderId !== undefined) {
        if (!existing.countedOrderIds.has(mat.matchedOrderId)) {
          existing.countedOrderIds.add(mat.matchedOrderId);
          existing.sysCuKg += mat.sysCuKg;
          existing.sysCompKg += mat.sysCompKg;
        }
      } else {
        existing.sysCuKg += mat.sysCuKg;
        existing.sysCompKg += mat.sysCompKg;
      }

      existing.manCuKg += mat.manCuKg;
      existing.manCompKg += mat.manCompKg;
      existing.scrapKg += mat.scrapKg;

      existing.diffCuKg = Number((existing.manCuKg - existing.sysCuKg).toFixed(2));
      existing.diffCompKg = Number((existing.manCompKg - existing.sysCompKg).toFixed(2));
      existing.totalSysKg = Number((existing.sysCuKg + existing.sysCompKg).toFixed(2));
      existing.totalManKg = Number((existing.manCuKg + existing.manCompKg).toFixed(2));
      existing.totalDiffKg = Number((existing.totalManKg - existing.totalSysKg).toFixed(2));

      map.set(mKey, existing);
    });

    return Array.from(map.values()).map(item => ({
      ...item,
      batchesList: Array.from(item.batches).join(', '),
      orderSheetRefsList: Array.from(item.orderSheetRefs).join(' • '),
      rawMaterialsList: Array.from(item.rawMaterials).join(' • '),
      totalDiffPct: item.totalSysKg > 0 ? (item.totalDiffKg / item.totalSysKg) * 100 : 0,
    }));
  }, [
    comparisonSourceMode,
    orderSheetBatchFilter,
    filteredEntries,
    entries,
    orders,
    densities,
    ladiDimensions,
  ]);

  // Stage-by-stage breakdown for visual efficiency strip
  const stageBreakdown = useMemo(() => {
    return PROCESS_STAGES.map(stage => {
      const matching = filteredEntries.filter(e => e.processStage === stage);
      const runHrs = matching.reduce((s, e) => s + (Number(e.actualRunHours) || 0), 0);
      const plannedHrs = matching.reduce((s, e) => s + (Number(e.plannedShiftHours) || 0), 0);
      const actualM = matching.reduce((s, e) => s + (Number(e.actualOutputM) || 0), 0);
      const avgOee =
        matching.length > 0
          ? matching.reduce((s, e) => s + computeEntryEfficiency(e).oeePct, 0) / matching.length
          : 0;
      return {
        stage,
        logsCount: matching.length,
        runHrs,
        plannedHrs,
        actualM,
        avgOee,
      };
    });
  }, [filteredEntries]);

  const handleExportJournalCsv = () => {
    const headers = [
      'DATE',
      'SHIFT',
      'PROCESS STAGE',
      'MACHINE NAME',
      'BATCH / JOB NO',
      'CABLE SPECIFICATION',
      'REQUIRED RAW MATERIAL',
      'OPERATOR',
      'SUPERVISOR',
      'PLANNED HRS',
      'ACTUAL RUN HRS',
      'DOWNTIME HRS',
      'DOWNTIME REASON',
      'TARGET OUTPUT (M)',
      'ACTUAL OUTPUT (M)',
      'LINE SPEED (M/MIN)',
      'SYSTEM REQ COPPER (KG)',
      'MANUAL COPPER USED (KG)',
      'COPPER DIFF (MAN - SYS KG)',
      'SYSTEM REQ COMPOUND (KG)',
      'MANUAL COMPOUND USED (KG)',
      'COMPOUND DIFF (MAN - SYS KG)',
      'TOTAL SYSTEM REQ (KG)',
      'TOTAL MANUAL USED (KG)',
      'TOTAL DIFF (MAN - SYS KG)',
      'TOTAL DIFF %',
      'SCRAP (KG)',
      'AVAILABILITY %',
      'PERFORMANCE %',
      'QUALITY %',
      'OVERALL OEE %',
      'QUALITY STATUS',
      'OPERATOR NOTES',
    ];
    const rows = filteredEntries.map(e => {
      const eff = computeEntryEfficiency(e);
      const mat = resolveEntryMaterialComparison(e, orders, densities, ladiDimensions);
      return [
        e.date,
        e.shift,
        e.processStage,
        e.machineName,
        e.batch,
        e.cableSpec,
        mat.rawMaterialName,
        e.operatorName,
        e.supervisorName || '-',
        e.plannedShiftHours,
        e.actualRunHours,
        e.downtimeHours,
        e.downtimeReason,
        e.targetOutputM,
        e.actualOutputM,
        eff.lineSpeedMPerMin.toFixed(1),
        mat.sysCuKg.toFixed(2),
        mat.manCuKg.toFixed(2),
        mat.diffCuKg.toFixed(2),
        mat.sysCompKg.toFixed(2),
        mat.manCompKg.toFixed(2),
        mat.diffCompKg.toFixed(2),
        mat.totalSysKg.toFixed(2),
        mat.totalManKg.toFixed(2),
        mat.totalDiffKg.toFixed(2),
        `${mat.totalDiffPct.toFixed(2)}%`,
        mat.scrapKg.toFixed(2),
        `${eff.availabilityPct.toFixed(1)}%`,
        `${eff.performancePct.toFixed(1)}%`,
        `${eff.qualityPct.toFixed(1)}%`,
        `${eff.oeePct.toFixed(1)}%`,
        e.qualityStatus,
        e.operatorNotes,
      ];
    });
    exportCsvFile('PLUTUS_DAILY_PRODUCTION_JOURNAL.csv', [headers, ...rows]);
    showNotice('📊 Exported Daily Production Journal with Machine Raw Material Comparison (Manual vs. System) to CSV!');
  };

  return (
    <div className="space-y-6">
      {/* Top Action & Header Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-5 shadow-md border border-slate-800 flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-emerald-600 rounded-xl shadow-xs">
            <Gauge className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg font-extrabold tracking-wide">
                DAILY PRODUCTION JOURNAL — 12-HOUR SHIFT & MACHINE RAW MATERIAL TRACKER
              </h2>
              <span className="px-2.5 py-0.5 bg-amber-500/20 border border-amber-400/50 text-amber-300 text-[11px] font-extrabold rounded-full">
                12 Hrs / Shift Standard (Shift A 08:00–20:00 • Shift B 20:00–08:00)
              </span>
              <span className="px-2.5 py-0.5 bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[11px] font-bold rounded-full">
                {filteredEntries.length} Shift Logs
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Company 12-Hour Shift standard: Record daily 12-hr shift metrics, machine run-times vs. 12-hr planned shift, required raw material per machine, and Manual vs. System Required material differences.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Print Shift Journal
          </button>
          <button
            type="button"
            onClick={handleExportJournalCsv}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            Export Journal CSV
          </button>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onUpdateEntries([]);
                showNotice('🧹 Cleared all Daily Production Journal shift records. Ready for fresh actual shift entries.');
              }}
              className="px-3 py-2 bg-rose-950/60 hover:bg-rose-900 text-rose-200 border border-rose-800/80 text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
              title="Clear all shift journal records and start completely fresh"
            >
              <Trash2 className="w-4 h-4 text-rose-400" />
              Clear All Entries
            </button>
          )}
        </div>
      </div>

      {/* KPI Efficiency & Material Variance Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 no-print">
        {/* Card 1: Overall Equipment Effectiveness (OEE) */}
        <div className="bg-white border-2 border-emerald-500/80 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              Overall Efficiency (OEE)
            </span>
            <span
              className={`px-2 py-0.5 text-[9px] font-black uppercase rounded ${
                summaryStats.avgOeePct >= 85
                  ? 'bg-emerald-100 text-emerald-800'
                  : summaryStats.avgOeePct >= 75
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {summaryStats.avgOeePct >= 85
                ? 'World-Class ≥85%'
                : summaryStats.avgOeePct >= 75
                ? 'Target Met'
                : 'Needs Focus'}
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">
              {summaryStats.avgOeePct.toFixed(1)}%
            </span>
            <span className="text-[11px] font-semibold text-slate-500">
              Avail × Perf × Quality
            </span>
          </div>
          <div className="mt-2 w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className="bg-emerald-600 h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, summaryStats.avgOeePct)}%` }}
            />
          </div>
        </div>

        {/* Card 2: Machine Run-Time & Availability */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              Machine Availability
            </span>
            <Clock className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">
              {summaryStats.avgAvailabilityPct.toFixed(1)}%
            </span>
            <span className="text-xs font-bold text-blue-700">
              {summaryStats.totalRunHrs.toFixed(1)} / {summaryStats.totalPlannedHrs.toFixed(1)} hrs
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Total Downtime:</span>
            <span className="font-bold text-amber-700">
              {summaryStats.totalDowntimeHrs.toFixed(1)} hrs
            </span>
          </div>
        </div>

        {/* Card 3: Output Achievement & Performance */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              Output Performance
            </span>
            <Activity className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900">
              {summaryStats.avgPerformancePct.toFixed(1)}%
            </span>
            <span className="text-xs font-bold text-indigo-700">
              {summaryStats.totalActualM.toLocaleString()} m
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Target Shift Length:</span>
            <span className="font-bold text-slate-700">
              {summaryStats.totalTargetM.toLocaleString()} m
            </span>
          </div>
        </div>

        {/* Card 4: System Required vs Manual Raw Material */}
        <div className="bg-white border-2 border-indigo-500/70 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-900">
              System vs Manual Material
            </span>
            <Scale className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between text-xs">
            <div>
              <div className="text-[10px] text-slate-500 font-bold">System Req:</div>
              <div className="text-sm font-black text-slate-800">
                {summaryStats.totalSysKg.toFixed(1)} kg
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-indigo-700 font-bold">Manual Used:</div>
              <div className="text-sm font-black text-indigo-950">
                {summaryStats.totalManKg.toFixed(1)} kg
              </div>
            </div>
          </div>
          <div className="mt-1 text-[10px] text-slate-500 flex items-center justify-between border-t border-slate-100 pt-1">
            <span>Cu: {summaryStats.totalCuKg.toFixed(1)}kg</span>
            <span>PVC: {summaryStats.totalCompKg.toFixed(1)}kg</span>
          </div>
        </div>

        {/* Card 5: Manual vs System Difference (Variance) */}
        <div
          className={`bg-white border-2 rounded-xl p-3.5 shadow-xs ${
            Math.abs(summaryStats.totalDiffKg) <= 0.5
              ? 'border-emerald-400'
              : summaryStats.totalDiffKg > 0
              ? 'border-amber-400'
              : 'border-blue-400'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600">
              Manual - System Diff
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                Math.abs(summaryStats.totalDiffKg) <= 0.5
                  ? 'bg-emerald-100 text-emerald-800'
                  : summaryStats.totalDiffKg > 0
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-blue-100 text-blue-900'
              }`}
            >
              {Math.abs(summaryStats.totalDiffKg) <= 0.5
                ? 'Exact Match'
                : summaryStats.totalDiffKg > 0
                ? 'Manual > System'
                : 'Manual < System'}
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span
              className={`text-2xl font-black ${
                Math.abs(summaryStats.totalDiffKg) <= 0.5
                  ? 'text-emerald-700'
                  : summaryStats.totalDiffKg > 0
                  ? 'text-amber-700'
                  : 'text-blue-700'
              }`}
            >
              {summaryStats.totalDiffKg >= 0 ? '+' : ''}
              {summaryStats.totalDiffKg.toFixed(2)} kg
            </span>
            <span className="text-xs font-bold text-slate-500">
              ({summaryStats.totalDiffPct >= 0 ? '+' : ''}
              {summaryStats.totalDiffPct.toFixed(1)}%)
            </span>
          </div>
          <div className="mt-1 text-[10px] text-slate-600 flex items-center justify-between border-t border-slate-100 pt-1">
            <span>
              Cu Diff:{' '}
              <strong>
                {summaryStats.totalDiffCuKg >= 0 ? '+' : ''}
                {summaryStats.totalDiffCuKg.toFixed(1)}kg
              </strong>
            </span>
            <span>
              PVC Diff:{' '}
              <strong>
                {summaryStats.totalDiffCompKg >= 0 ? '+' : ''}
                {summaryStats.totalDiffCompKg.toFixed(1)}kg
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* MACHINE-WISE REQUIRED RAW MATERIAL & MANUAL VS. SYSTEM COMPARISON PANEL */}
      <div className="bg-white border-2 border-indigo-900 rounded-xl shadow-sm overflow-hidden">
        <div className="bg-indigo-950 text-white px-4 py-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-amber-400" />
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xs font-black uppercase tracking-wider">
                    MACHINE-WISE REQUIRED RAW MATERIAL & MANUAL VS. SYSTEM DIFFERENCE COMPARISON
                  </h3>
                  <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 rounded text-[10px] font-extrabold">
                    📋 System Required Picked Directly from Order Sheet (Req Cu • Req Ins • Req Sheath)
                  </span>
                </div>
                <p className="text-[11px] text-indigo-200">
                  Picks engineering System Required Raw Material (Copper & PVC/Rubber Compound) directly from the Order Sheet and compares against Manual Operator Input on each machine.
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-indigo-900 border border-indigo-700 rounded-lg text-[11px] font-bold text-amber-300">
              Formula: Difference = Manual Input (Kg) − Order Sheet System Required (Kg)
            </span>
          </div>

          {/* Order Sheet Picker & Source Mode Toolbar */}
          <div className="pt-2 border-t border-indigo-800/80 flex flex-wrap items-center justify-between gap-2 text-xs no-print">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300">
                Order Sheet View:
              </span>
              <button
                type="button"
                onClick={() => setComparisonSourceMode('JOURNAL_LINKED')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold cursor-pointer transition-all ${
                  comparisonSourceMode === 'JOURNAL_LINKED'
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'bg-indigo-900/80 text-indigo-200 hover:bg-indigo-800'
                }`}
              >
                📋 Logged Machines ({filteredEntries.length} Shifts)
              </button>
              <button
                type="button"
                onClick={() => setComparisonSourceMode('ALL_ORDER_SHEET')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold cursor-pointer transition-all ${
                  comparisonSourceMode === 'ALL_ORDER_SHEET'
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'bg-indigo-900/80 text-indigo-200 hover:bg-indigo-800'
                }`}
              >
                📐 All Order Sheet Items ({orders.length} Orders)
              </button>

              <select
                value={orderSheetBatchFilter}
                onChange={e => setOrderSheetBatchFilter(e.target.value)}
                className="bg-indigo-900 border border-indigo-700 text-white rounded-lg px-2.5 py-1 text-[11px] font-bold"
              >
                <option value="ALL">All Order Sheet Batches ({orderSheetBatches.length})</option>
                {orderSheetBatches.map(b => (
                  <option key={b} value={b}>
                    Batch: {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={quickPickOrderId}
                onChange={e => setQuickPickOrderId(e.target.value)}
                className="bg-indigo-900 border border-indigo-600 text-white rounded-lg px-2.5 py-1 text-[11px] font-semibold max-w-[340px]"
              >
                <option value="">-- Pick Order from Order Sheet to Add Machine Rows --</option>
                {orders.map(o => {
                  const r = computeRecordRow(o, densities, ladiDimensions);
                  return (
                    <option key={o.id} value={String(o.id)}>
                      [{o.batch}] #{o.id} {o.brand} {o.cores}C×{o.size} ({o.order_length}m) — Cu:{' '}
                      {r.reqCu.toFixed(1)}kg | Ins: {r.reqIns.toFixed(1)}kg | SH: {r.reqSheath.toFixed(1)}kg
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={handlePickOrderIntoComparison}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-extrabold cursor-pointer"
              >
                + Pick from Order Sheet
              </button>
              <button
                type="button"
                onClick={handleSyncAllWithOrderSheet}
                className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[11px] font-extrabold cursor-pointer"
                title="Refresh all journal entries with exact System Required (Cu, Ins, Sheath) from the Order Sheet"
              >
                🔄 Sync Order Sheet Req
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-800 border-b-2 border-slate-300 text-[10px] font-extrabold uppercase">
                <th className="border border-slate-300 px-2.5 py-2 text-left">
                  Machine / Extruder Line & Order Sheet Source
                </th>
                <th className="border border-slate-300 px-2.5 py-2 text-left">Stage & 12h Shifts</th>
                <th className="border border-slate-300 px-2.5 py-2 text-left">
                  Required Raw Material Specification
                </th>
                <th className="border border-slate-300 px-2.5 py-2 text-right">Order / Output (Mtrs)</th>
                <th className="border border-slate-300 px-2.5 py-2 text-right bg-amber-50/60">
                  Order Sheet Sys Req Cu (Kg)
                </th>
                <th className="border border-slate-300 px-2.5 py-2 text-right bg-amber-50/60">
                  Manual Cu (Kg)
                </th>
                <th className="border border-slate-300 px-2.5 py-2 text-right bg-amber-100/60">
                  Cu Diff (Man − Sys)
                </th>
                <th className="border border-slate-300 px-2.5 py-2 text-right bg-blue-50/60">
                  Order Sheet Sys Req PVC (Kg)
                </th>
                <th className="border border-slate-300 px-2.5 py-2 text-right bg-blue-50/60">
                  Manual PVC (Kg)
                </th>
                <th className="border border-slate-300 px-2.5 py-2 text-right bg-blue-100/60">
                  PVC Diff (Man − Sys)
                </th>
                <th className="border border-slate-300 px-2.5 py-2 text-right bg-indigo-50">
                  Total Diff (Kg & %)
                </th>
                <th className="border border-slate-300 px-2.5 py-2 text-center">Comparison Status</th>
                <th className="border border-slate-300 px-2.5 py-2 text-center no-print">Manual Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {machineMaterialComparison.length === 0 ? (
                <tr>
                  <td colSpan={13} className="p-4 text-center text-slate-400 font-semibold">
                    No machine logs recorded for the current filter.
                  </td>
                </tr>
              ) : (
                machineMaterialComparison.map((mRow, idx) => {
                  const isEditing = editingMachineKey === mRow.mKey && machineEditDraft !== null;

                  if (isEditing && machineEditDraft) {
                    const liveDiffCu = Number((machineEditDraft.manCuKg - machineEditDraft.sysCuKg).toFixed(2));
                    const liveDiffComp = Number((machineEditDraft.manCompKg - machineEditDraft.sysCompKg).toFixed(2));
                    const liveTotalSys = Number((machineEditDraft.sysCuKg + machineEditDraft.sysCompKg).toFixed(2));
                    const liveTotalMan = Number((machineEditDraft.manCuKg + machineEditDraft.manCompKg).toFixed(2));
                    const liveTotalDiff = Number((liveTotalMan - liveTotalSys).toFixed(2));
                    const liveTotalDiffPct = liveTotalSys > 0 ? (liveTotalDiff / liveTotalSys) * 100 : 0;

                    return (
                      <tr key={idx} className="bg-amber-50/70 border-2 border-amber-400">
                        <td className="border border-slate-300 px-2.5 py-2 font-extrabold text-slate-900">
                          {mRow.machineName}
                          <div className="text-[10px] font-semibold text-indigo-700">
                            Batch: {mRow.batchesList || 'GENERAL'}
                          </div>
                          {mRow.orderSheetRefsList && (
                            <div className="mt-0.5 inline-block px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-[9.5px] font-bold">
                              📋 {mRow.orderSheetRefsList}
                            </div>
                          )}
                          <div className="mt-1 text-[10px] font-black text-amber-700 uppercase">
                            ✏️ Editing Manual vs. System
                          </div>
                        </td>
                        <td className="border border-slate-300 px-2.5 py-2">
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-900 rounded font-bold text-[10px]">
                            {mRow.processStage}
                          </span>
                          <div className="text-[10px] text-slate-600 mt-0.5 font-bold">
                            {mRow.shiftsCount} × 12h shift
                          </div>
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5">
                          <input
                            type="text"
                            value={machineEditDraft.rawMaterialName}
                            onChange={e =>
                              setMachineEditDraft({
                                ...machineEditDraft,
                                rawMaterialName: e.target.value,
                              })
                            }
                            className="w-full px-2 py-1 text-xs font-semibold bg-white border border-amber-300 rounded shadow-inner focus:outline-none focus:ring-1 focus:ring-amber-500"
                            placeholder="Raw Material Spec..."
                          />
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-right">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={machineEditDraft.actualOutputM || ''}
                            onChange={e =>
                              setMachineEditDraft({
                                ...machineEditDraft,
                                actualOutputM: Number(e.target.value) || 0,
                              })
                            }
                            className="w-24 text-right px-2 py-1 text-xs font-black bg-white border border-amber-300 rounded shadow-inner focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-right bg-amber-50/50">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={machineEditDraft.sysCuKg || ''}
                            onChange={e =>
                              setMachineEditDraft({
                                ...machineEditDraft,
                                sysCuKg: Number(e.target.value) || 0,
                              })
                            }
                            className="w-20 text-right px-1.5 py-1 text-xs font-bold bg-white border border-amber-300 rounded"
                            title="System Required Copper (Kg)"
                          />
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-right bg-amber-50/50">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={machineEditDraft.manCuKg || ''}
                            onChange={e =>
                              setMachineEditDraft({
                                ...machineEditDraft,
                                manCuKg: Number(e.target.value) || 0,
                              })
                            }
                            className="w-20 text-right px-1.5 py-1 text-xs font-black bg-white border border-amber-400 text-amber-950 rounded"
                            title="Manual Actual Copper Used (Kg)"
                          />
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-right font-extrabold text-amber-900 bg-amber-100/50">
                          {liveDiffCu >= 0 ? '+' : ''}{liveDiffCu.toFixed(2)} kg
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-right bg-blue-50/50">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={machineEditDraft.sysCompKg || ''}
                            onChange={e =>
                              setMachineEditDraft({
                                ...machineEditDraft,
                                sysCompKg: Number(e.target.value) || 0,
                              })
                            }
                            className="w-20 text-right px-1.5 py-1 text-xs font-bold bg-white border border-blue-300 rounded"
                            title="System Required PVC/Compound (Kg)"
                          />
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-right bg-blue-50/50">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={machineEditDraft.manCompKg || ''}
                            onChange={e =>
                              setMachineEditDraft({
                                ...machineEditDraft,
                                manCompKg: Number(e.target.value) || 0,
                              })
                            }
                            className="w-20 text-right px-1.5 py-1 text-xs font-black bg-white border border-blue-400 text-blue-950 rounded"
                            title="Manual Actual PVC/Compound Used (Kg)"
                          />
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-right font-extrabold text-blue-900 bg-blue-100/50">
                          {liveDiffComp >= 0 ? '+' : ''}{liveDiffComp.toFixed(2)} kg
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-right font-black bg-indigo-50/60">
                          <div>
                            {liveTotalDiff >= 0 ? '+' : ''}{liveTotalDiff.toFixed(2)} kg
                          </div>
                          <div className="text-[10px] font-bold text-slate-600">
                            ({liveTotalDiffPct >= 0 ? '+' : ''}{liveTotalDiffPct.toFixed(1)}%)
                          </div>
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-center">
                          <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-950 text-[10px] font-extrabold">
                            ✏️ Editing
                          </span>
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 text-center no-print">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleSaveEditMachine(mRow)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-extrabold cursor-pointer shadow-xs"
                            >
                              💾 Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMachineKey(null);
                                setMachineEditDraft(null);
                              }}
                              className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded text-[11px] font-bold cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const isExact = Math.abs(mRow.totalDiffKg) <= 0.5;
                  const isExcess = mRow.totalDiffKg > 0.5;
                  return (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="border border-slate-200 px-2.5 py-2 font-extrabold text-slate-900">
                        {mRow.machineName}
                        <div className="text-[10px] font-semibold text-indigo-700">
                          Batch: {mRow.batchesList || 'GENERAL'}
                        </div>
                        {mRow.orderSheetRefsList && (
                          <div className="mt-0.5 inline-block px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-[9.5px] font-bold">
                            📋 {mRow.orderSheetRefsList}
                          </div>
                        )}
                      </td>
                      <td className="border border-slate-200 px-2.5 py-2">
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-900 rounded font-bold text-[10px]">
                          {mRow.processStage}
                        </span>
                        <div className="text-[10px] text-slate-600 mt-0.5 font-bold">
                          {mRow.shiftsCount} × 12h shift ({mRow.runHrs.toFixed(1)}/{mRow.plannedHrs.toFixed(0)}h run)
                        </div>
                      </td>
                      <td className="border border-slate-200 px-2.5 py-2 font-bold text-slate-800">
                        {mRow.rawMaterialsList}
                      </td>
                      <td className="border border-slate-200 px-2.5 py-2 text-right font-black text-slate-900">
                        {mRow.actualOutputM.toLocaleString()} m
                      </td>
                      <td className="border border-slate-200 px-2.5 py-2 text-right font-semibold text-slate-700 bg-amber-50/20">
                        {mRow.sysCuKg > 0 ? `${mRow.sysCuKg.toFixed(2)} kg` : '—'}
                      </td>
                      <td className="border border-slate-200 px-2.5 py-2 text-right font-bold text-amber-950 bg-amber-50/20">
                        {mRow.manCuKg > 0 ? `${mRow.manCuKg.toFixed(2)} kg` : '—'}
                      </td>
                      <td
                        className={`border border-slate-200 px-2.5 py-2 text-right font-extrabold ${
                          Math.abs(mRow.diffCuKg) <= 0.1
                            ? 'text-slate-500'
                            : mRow.diffCuKg > 0
                            ? 'text-amber-700 bg-amber-50/60'
                            : 'text-blue-700 bg-blue-50/40'
                        }`}
                      >
                        {mRow.sysCuKg > 0 || mRow.manCuKg > 0
                          ? `${mRow.diffCuKg >= 0 ? '+' : ''}${mRow.diffCuKg.toFixed(2)} kg`
                          : '—'}
                      </td>
                      <td className="border border-slate-200 px-2.5 py-2 text-right font-semibold text-slate-700 bg-blue-50/20">
                        {mRow.sysCompKg > 0 ? `${mRow.sysCompKg.toFixed(2)} kg` : '—'}
                      </td>
                      <td className="border border-slate-200 px-2.5 py-2 text-right font-bold text-blue-950 bg-blue-50/20">
                        {mRow.manCompKg > 0 ? `${mRow.manCompKg.toFixed(2)} kg` : '—'}
                      </td>
                      <td
                        className={`border border-slate-200 px-2.5 py-2 text-right font-extrabold ${
                          Math.abs(mRow.diffCompKg) <= 0.1
                            ? 'text-slate-500'
                            : mRow.diffCompKg > 0
                            ? 'text-amber-700 bg-amber-50/60'
                            : 'text-blue-700 bg-blue-50/40'
                        }`}
                      >
                        {mRow.sysCompKg > 0 || mRow.manCompKg > 0
                          ? `${mRow.diffCompKg >= 0 ? '+' : ''}${mRow.diffCompKg.toFixed(2)} kg`
                          : '—'}
                      </td>
                      <td
                        className={`border border-slate-200 px-2.5 py-2 text-right font-black ${
                          isExact
                            ? 'text-emerald-700 bg-emerald-50/50'
                            : isExcess
                            ? 'text-amber-800 bg-amber-50/70'
                            : 'text-blue-800 bg-blue-50/70'
                        }`}
                      >
                        {mRow.totalSysKg > 0 || mRow.totalManKg > 0 ? (
                          <>
                            <div>
                              {mRow.totalDiffKg >= 0 ? '+' : ''}
                              {mRow.totalDiffKg.toFixed(2)} kg
                            </div>
                            <div className="text-[10px] font-bold">
                              ({mRow.totalDiffPct >= 0 ? '+' : ''}
                              {mRow.totalDiffPct.toFixed(1)}%)
                            </div>
                          </>
                        ) : (
                          '0.00 kg'
                        )}
                      </td>
                      <td className="border border-slate-200 px-2.5 py-2 text-center">
                        {mRow.totalSysKg === 0 && mRow.totalManKg === 0 ? (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">
                            Assembly / No Extrusion
                          </span>
                        ) : isExact ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                            ✅ Matched Order Sheet
                          </span>
                        ) : isExcess ? (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                            ⚠️ +{mRow.totalDiffKg.toFixed(1)}kg Over System
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-extrabold">
                            🔵 {mRow.totalDiffKg.toFixed(1)}kg Under System
                          </span>
                        )}
                      </td>
                      <td className="border border-slate-200 px-2 py-1.5 text-center no-print">
                        <button
                          type="button"
                          onClick={() => handleStartEditMachine(mRow)}
                          className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded text-[10.5px] cursor-pointer shadow-xs inline-flex items-center gap-1"
                          title="Manually edit Raw Material, Output, and Manual vs System weights for this machine"
                        >
                          ✏️ Edit Manual / Sys
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {machineMaterialComparison.length > 0 && (() => {
              const totOutM = machineMaterialComparison.reduce((s, r) => s + r.actualOutputM, 0);
              const totSysCu = machineMaterialComparison.reduce((s, r) => s + r.sysCuKg, 0);
              const totManCu = machineMaterialComparison.reduce((s, r) => s + r.manCuKg, 0);
              const totDiffCu = totManCu - totSysCu;
              const totSysComp = machineMaterialComparison.reduce((s, r) => s + r.sysCompKg, 0);
              const totManComp = machineMaterialComparison.reduce((s, r) => s + r.manCompKg, 0);
              const totDiffComp = totManComp - totSysComp;
              const totSys = totSysCu + totSysComp;
              const totMan = totManCu + totManComp;
              const totDiff = totMan - totSys;
              const totDiffPct = totSys > 0 ? (totDiff / totSys) * 100 : 0;
              return (
                <tfoot>
                  <tr className="bg-slate-900 text-white font-extrabold text-xs">
                    <td colSpan={3} className="border border-slate-700 px-2.5 py-2 text-right uppercase">
                      TOTAL ORDER SHEET vs MANUAL COMPARISON ({machineMaterialComparison.length} Machine Rows):
                    </td>
                    <td className="border border-slate-700 px-2.5 py-2 text-right">
                      {totOutM.toLocaleString()} m
                    </td>
                    <td className="border border-slate-700 px-2.5 py-2 text-right text-amber-200">
                      {totSysCu.toFixed(2)} kg
                    </td>
                    <td className="border border-slate-700 px-2.5 py-2 text-right text-amber-300">
                      {totManCu.toFixed(2)} kg
                    </td>
                    <td className="border border-slate-700 px-2.5 py-2 text-right text-amber-400">
                      {totDiffCu >= 0 ? '+' : ''}
                      {totDiffCu.toFixed(2)} kg
                    </td>
                    <td className="border border-slate-700 px-2.5 py-2 text-right text-blue-200">
                      {totSysComp.toFixed(2)} kg
                    </td>
                    <td className="border border-slate-700 px-2.5 py-2 text-right text-blue-300">
                      {totManComp.toFixed(2)} kg
                    </td>
                    <td className="border border-slate-700 px-2.5 py-2 text-right text-blue-400">
                      {totDiffComp >= 0 ? '+' : ''}
                      {totDiffComp.toFixed(2)} kg
                    </td>
                    <td className="border border-slate-700 px-2.5 py-2 text-right text-emerald-300">
                      {totDiff >= 0 ? '+' : ''}
                      {totDiff.toFixed(2)} kg ({totDiffPct >= 0 ? '+' : ''}
                      {totDiffPct.toFixed(1)}%)
                    </td>
                    <td className="border border-slate-700 px-2.5 py-2 text-center text-[10px] text-slate-300">
                      Sys: {totSys.toFixed(1)}kg vs Man: {totMan.toFixed(1)}kg
                    </td>
                    <td className="border border-slate-700 px-2 py-2 text-center text-[10px] text-slate-400 no-print">
                      —
                    </td>
                  </tr>
                </tfoot>
              );
            })()}
          </table>
        </div>
      </div>

      {/* Stage-wise Machine Efficiency Bar Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs no-print">
        <div className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
          <Wrench className="w-4 h-4 text-slate-600" />
          <span>Process Stage Run-Time & Efficiency Summary (Click to Filter)</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {stageBreakdown.map(st => (
            <div
              key={st.stage}
              onClick={() => setFilterStage(filterStage === st.stage ? 'ALL' : st.stage)}
              className={`p-3 rounded-lg border cursor-pointer transition-all ${
                filterStage === st.stage
                  ? 'border-blue-600 bg-blue-50/70'
                  : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100/70'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-extrabold text-slate-800">
                <span className="truncate">{st.stage}</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded">
                  {st.logsCount}
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-sm font-black text-slate-900">
                  {st.avgOee > 0 ? `${st.avgOee.toFixed(1)}% OEE` : '—'}
                </span>
                <span className="text-[11px] font-bold text-blue-700">
                  {st.runHrs.toFixed(1)}h run
                </span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Output: <strong className="text-slate-700">{st.actualM.toLocaleString()} m</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* New Daily Shift Entry Form */}
      <form
        onSubmit={handleAddEntry}
        className="bg-white border-2 border-slate-800 rounded-xl shadow-sm overflow-hidden no-print"
      >
        <div className="bg-slate-900 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider">
            <Plus className="w-4 h-4 text-emerald-400" />
            <span>Record Daily Shift Metrics, Required Raw Material & Manual vs. System Comparison</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-300 font-semibold">Auto-Fill from Active Order:</span>
            <select
              value={selectedOrderId}
              onChange={e => handleSelectOrder(e.target.value)}
              className="bg-slate-800 text-white border border-slate-600 rounded px-2.5 py-1 text-xs font-bold"
            >
              <option value="">-- Select Job / Batch to Auto-Fill Material & Spec --</option>
              {orders.map(o => (
                <option key={o.id} value={String(o.id)}>
                  {o.batch} • {o.brand} {o.cores}C×{o.size} ({o.order_length.toLocaleString()}m)
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-4 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            {/* Date */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Shift Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-semibold text-slate-900"
                required
              />
            </div>

            {/* Shift (12-Hour Company Standard) */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                12-Hour Shift (Day / Night)
              </label>
              <select
                value={shift}
                onChange={e => {
                  setShift(e.target.value as DailyJournalEntry['shift']);
                  handlePlannedHoursChange(STANDARD_SHIFT_HOURS);
                }}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-900 bg-amber-50/40"
              >
                {SHIFTS.map(s => (
                  <option key={s} value={s}>
                    {s} — 12 Hrs
                  </option>
                ))}
              </select>
            </div>

            {/* Process Stage */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Process Stage</label>
              <select
                value={processStage}
                onChange={e => handleStageChangeInForm(e.target.value as DailyJournalEntry['processStage'])}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-blue-900 bg-blue-50/40"
              >
                {PROCESS_STAGES.map(st => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            {/* Machine Name */}
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">Machine / Extruder Line</label>
              {machineName === '__CUSTOM__' ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Enter custom machine name..."
                    value={customMachineName}
                    onChange={e => setCustomMachineName(e.target.value)}
                    className="w-full border border-blue-400 rounded-lg px-2.5 py-1.5 font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => setMachineName(STANDARD_MACHINES[0])}
                    className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded font-bold"
                  >
                    List
                  </button>
                </div>
              ) : (
                <select
                  value={machineName}
                  onChange={e => setMachineName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-semibold text-slate-900"
                >
                  {STANDARD_MACHINES.map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value="__CUSTOM__">+ Type Custom Machine Name...</option>
                </select>
              )}
            </div>

            {/* Batch / Job No */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Batch / Job No</label>
              <input
                type="text"
                placeholder="e.g. JOB NO 34"
                value={batch}
                onChange={e => setBatch(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-900"
              />
            </div>

            {/* Cable Specification */}
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                Cable Specification (Brand / Size / Conductor)
              </label>
              <input
                type="text"
                placeholder="e.g. MYBCAB H07RN-F — 5C × 1.50 SQ MM (30/0.210)"
                value={cableSpec}
                onChange={e => setCableSpec(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium text-slate-900"
              />
            </div>

            {/* Operator Name */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Operator Name *</label>
              <input
                type="text"
                placeholder="e.g. Ramesh Kumar"
                value={operatorName}
                onChange={e => setOperatorName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-900"
                required
              />
            </div>

            {/* Supervisor Name */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Shift Supervisor</label>
              <input
                type="text"
                placeholder="e.g. Rajesh Sharma"
                value={supervisorName}
                onChange={e => setSupervisorName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium text-slate-900"
              />
            </div>

            {/* Planned Shift Hours (12 Hrs Standard) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-bold text-slate-700">Shift Duration (Hrs)</label>
                <button
                  type="button"
                  onClick={() => handlePlannedHoursChange(STANDARD_SHIFT_HOURS)}
                  className="text-[9px] font-extrabold text-blue-700 hover:underline cursor-pointer"
                  title="Reset to 12.0 Hrs Company Standard Shift"
                >
                  12h Standard
                </button>
              </div>
              <input
                type="number"
                step="0.5"
                min="1"
                max="24"
                value={plannedShiftHours}
                onChange={e => handlePlannedHoursChange(Number(e.target.value))}
                className="w-full border border-slate-300 bg-slate-50 rounded-lg px-2.5 py-1.5 font-extrabold text-slate-900"
              />
            </div>

            {/* Actual Machine Run Hours */}
            <div>
              <label className="block font-bold text-emerald-800 mb-1">
                Actual Run Time (of {plannedShiftHours}h)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max={plannedShiftHours}
                value={actualRunHours}
                onChange={e => handleActualRunHoursChange(Number(e.target.value))}
                className="w-full border-2 border-emerald-500 bg-emerald-50/40 rounded-lg px-2.5 py-1.5 font-extrabold text-emerald-950"
              />
            </div>

            {/* Downtime Hours */}
            <div>
              <label className="block font-bold text-amber-800 mb-1">
                Downtime (Auto = {plannedShiftHours}h − Run)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max={plannedShiftHours}
                value={downtimeHours}
                onChange={e => handleDowntimeHoursChange(Number(e.target.value))}
                className="w-full border border-amber-400 bg-amber-50/40 rounded-lg px-2.5 py-1.5 font-bold text-amber-900"
              />
            </div>

            {/* Downtime Reason */}
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                Primary Changeover / Downtime Reason
              </label>
              <input
                type="text"
                list="downtime-reasons-list"
                value={downtimeReason}
                onChange={e => setDowntimeReason(e.target.value)}
                placeholder="Select or type reason..."
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium text-slate-900"
              />
              <datalist id="downtime-reasons-list">
                {DOWNTIME_REASONS.map(r => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>

            {/* Target Output (m) */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">Target Output (Mtrs)</label>
              <input
                type="number"
                min="0"
                value={targetOutputM}
                onChange={e => setTargetOutputM(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-900"
              />
            </div>

            {/* Actual Output (m) */}
            <div>
              <label className="block font-bold text-indigo-800 mb-1">Actual Output (Mtrs)</label>
              <input
                type="number"
                min="0"
                value={actualOutputM}
                onChange={e => handleActualOutputChangeInForm(Number(e.target.value))}
                className="w-full border-2 border-indigo-500 bg-indigo-50/40 rounded-lg px-2.5 py-1.5 font-extrabold text-indigo-950"
              />
            </div>

            {/* Quality Status */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">QC / Spark Status</label>
              <select
                value={qualityStatus}
                onChange={e => setQualityStatus(e.target.value as DailyJournalEntry['qualityStatus'])}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-900"
              >
                <option value="Pass / QC Approved">Pass / QC Approved</option>
                <option value="Minor Rework">Minor Rework</option>
                <option value="Hold for Inspection">Hold for Inspection</option>
              </select>
            </div>
          </div>

          {/* Dedicated Machine Raw Material Requirement & Manual vs. System Comparison Box */}
          <div className="bg-indigo-50/70 border-2 border-indigo-200 rounded-xl p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200 pb-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-700" />
                <span className="font-extrabold text-indigo-950 uppercase tracking-wide">
                  Machine Required Raw Material & Manual vs. System Difference
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    recalculateFormSystemMaterial(
                      selectedOrderId,
                      processStage,
                      actualOutputM,
                      targetOutputM,
                      false
                    )
                  }
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Zap className="w-3 h-3" /> Recalculate System Required from Order Formula
                </button>
                <span
                  className={`px-2.5 py-1 rounded-md text-[11px] font-black ${
                    Math.abs(formTotalDiff) <= 0.5
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : formTotalDiff > 0
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-blue-100 text-blue-900 border border-blue-300'
                  }`}
                >
                  Live Diff (Manual − System): {formTotalDiff >= 0 ? '+' : ''}
                  {formTotalDiff.toFixed(2)} kg ({formTotalDiffPct >= 0 ? '+' : ''}
                  {formTotalDiffPct.toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
              {/* Required Raw Material Spec */}
              <div className="sm:col-span-2">
                <label className="block font-bold text-indigo-950 mb-1">
                  Required Raw Material in Machine
                </label>
                <input
                  type="text"
                  value={rawMaterialName}
                  onChange={e => setRawMaterialName(e.target.value)}
                  placeholder="e.g. Raw Copper Wire 0.210mm / Ins. PVC A-80 UW"
                  className="w-full border border-indigo-300 bg-white rounded-lg px-2.5 py-1.5 font-bold text-slate-900"
                />
              </div>

              {/* System Required Copper (Kg) */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  System Req. Cu (Kg)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={systemRequiredCuKg}
                  onChange={e => setSystemRequiredCuKg(Number(e.target.value))}
                  className="w-full border border-slate-300 bg-slate-100/80 rounded-lg px-2.5 py-1.5 font-bold text-slate-800"
                />
              </div>

              {/* Manual Copper Used (Kg) */}
              <div>
                <label className="block font-bold text-amber-900 mb-1">
                  Manual Cu Used (Kg)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={copperConsumedKg}
                  onChange={e => setCopperConsumedKg(Number(e.target.value))}
                  className="w-full border-2 border-amber-500 bg-white rounded-lg px-2.5 py-1.5 font-extrabold text-amber-950"
                />
                <div className="text-[10px] font-bold text-slate-600 mt-0.5">
                  Cu Diff: {formDiffCu >= 0 ? '+' : ''}
                  {formDiffCu.toFixed(2)} kg
                </div>
              </div>

              {/* System Required PVC/Compound (Kg) */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  System Req. PVC (Kg)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={systemRequiredCompoundKg}
                  onChange={e => setSystemRequiredCompoundKg(Number(e.target.value))}
                  className="w-full border border-slate-300 bg-slate-100/80 rounded-lg px-2.5 py-1.5 font-bold text-slate-800"
                />
              </div>

              {/* Manual PVC/Compound Used (Kg) */}
              <div>
                <label className="block font-bold text-blue-900 mb-1">
                  Manual PVC Used (Kg)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={compoundConsumedKg}
                  onChange={e => setCompoundConsumedKg(Number(e.target.value))}
                  className="w-full border-2 border-blue-500 bg-white rounded-lg px-2.5 py-1.5 font-extrabold text-blue-950"
                />
                <div className="text-[10px] font-bold text-slate-600 mt-0.5">
                  PVC Diff: {formDiffComp >= 0 ? '+' : ''}
                  {formDiffComp.toFixed(2)} kg
                </div>
              </div>

              {/* Purge / Scrap Weight (Kg) */}
              <div>
                <label className="block font-bold text-rose-700 mb-1">Purge / Scrap (Kg)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={scrapKg}
                  onChange={e => setScrapKg(Number(e.target.value))}
                  className="w-full border border-rose-300 bg-white rounded-lg px-2.5 py-1.5 font-bold text-rose-900"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-6 gap-3 items-end">
            {/* Operator Notes & Observations */}
            <div className="lg:col-span-5">
              <label className="block font-bold text-slate-700 mb-1">
                Operator Notes, Line Speed & Shift Handover Remarks
              </label>
              <input
                type="text"
                placeholder="e.g. Line speed 55 m/min, die temp 165°C, spark test 6.5kV OK, handover remarks..."
                value={operatorNotes}
                onChange={e => setOperatorNotes(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium text-slate-900"
              />
            </div>

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg shadow-sm flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                Save Shift Entry
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by Batch, Raw Material, Operator, Machine..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg font-medium"
            />
          </div>

          <select
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-700"
          >
            <option value="ALL">All Dates ({uniqueDates.length})</option>
            {uniqueDates.map(d => (
              <option key={d} value={d}>
                Date: {d}
              </option>
            ))}
          </select>

          <select
            value={filterShift}
            onChange={e => setFilterShift(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-700"
          >
            <option value="ALL">All Shifts</option>
            {SHIFTS.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={filterStage}
            onChange={e => setFilterStage(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-700"
          >
            <option value="ALL">All Process Stages</option>
            {PROCESS_STAGES.map(st => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          {(filterDate !== 'ALL' ||
            filterShift !== 'ALL' ||
            filterStage !== 'ALL' ||
            searchQuery.trim() !== '') && (
            <button
              type="button"
              onClick={() => {
                setFilterDate('ALL');
                setFilterShift('ALL');
                setFilterStage('ALL');
                setSearchQuery('');
              }}
              className="text-xs px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Printable Journal Sheet (1 Table Per Page Ready) */}
      <div className="bg-white border-2 border-slate-800 rounded-xl shadow-sm overflow-hidden print-single-page">
        {/* Print & Screen Sheet Title Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-800">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider">
              PLUTUS CABLE PRODUCTION — DAILY SHIFT JOURNAL & RAW MATERIAL COMPARISON LOG
            </h3>
            <p className="text-[11px] text-slate-300">
              Showing {filteredEntries.length} shift records • Overall OEE:{' '}
              <strong>{summaryStats.avgOeePct.toFixed(1)}%</strong> • System Req Material:{' '}
              <strong>{summaryStats.totalSysKg.toFixed(1)} kg</strong> vs Manual Used:{' '}
              <strong>{summaryStats.totalManKg.toFixed(1)} kg</strong> (Diff:{' '}
              <strong>
                {summaryStats.totalDiffKg >= 0 ? '+' : ''}
                {summaryStats.totalDiffKg.toFixed(2)} kg
              </strong>
              )
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-slate-300">Report Date:</span>
            <input
              type="date"
              value={printReportDate}
              onChange={e => setPrintReportDate(e.target.value)}
              className="bg-slate-800 text-white border border-slate-600 rounded px-2 py-0.5 text-xs font-bold"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-800 border-b-2 border-slate-400 text-[10px] font-extrabold uppercase">
                <th className="border border-slate-300 px-2 py-2 text-left">Date & Shift</th>
                <th className="border border-slate-300 px-2 py-2 text-left">Stage & Machine</th>
                <th className="border border-slate-300 px-2 py-2 text-left">
                  Batch, Spec & Required Raw Material
                </th>
                <th className="border border-slate-300 px-2 py-2 text-left">Operator / Sup.</th>
                <th className="border border-slate-300 px-2 py-2 text-center">
                  Run / Plan Hrs
                  <br />
                  <span className="text-[9px] font-semibold text-slate-500">(Availability %)</span>
                </th>
                <th className="border border-slate-300 px-2 py-2 text-left">Downtime & Cause</th>
                <th className="border border-slate-300 px-2 py-2 text-right">
                  Actual / Target (m)
                  <br />
                  <span className="text-[9px] font-semibold text-slate-500">(Speed m/min)</span>
                </th>
                <th className="border border-slate-300 px-2 py-2 text-right bg-indigo-50/60">
                  System Required
                  <br />
                  <span className="text-[9px] font-semibold text-indigo-700">(Cu / PVC Kg)</span>
                </th>
                <th className="border border-slate-300 px-2 py-2 text-right bg-amber-50/60">
                  Manual Used
                  <br />
                  <span className="text-[9px] font-semibold text-amber-800">(Cu / PVC / Scrap)</span>
                </th>
                <th className="border border-slate-300 px-2 py-2 text-right bg-emerald-50/60">
                  Manual vs System Diff
                  <br />
                  <span className="text-[9px] font-semibold text-emerald-800">(Man − Sys Kg & %)</span>
                </th>
                <th className="border border-slate-300 px-2 py-2 text-center">
                  Overall OEE %
                  <br />
                  <span className="text-[9px] font-semibold text-slate-500">& QC Status</span>
                </th>
                <th className="border border-slate-300 px-2 py-2 text-left min-w-[170px]">
                  Operator Notes & Shift Remarks
                </th>
                <th className="border border-slate-300 px-2 py-2 text-center no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-8 text-slate-500 font-semibold">
                    No Daily Production Journal entries match the current filters. Add a shift log above!
                  </td>
                </tr>
              ) : (
                filteredEntries.map(entry => {
                  const isEditing = editingId === entry.id && editDraft !== null;
                  const activeItem = isEditing ? editDraft! : entry;
                  const eff = computeEntryEfficiency(activeItem);
                  const mat = resolveEntryMaterialComparison(
                    activeItem,
                    orders,
                    densities,
                    ladiDimensions
                  );

                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-slate-200 hover:bg-slate-50/80 align-top"
                    >
                      {/* Date & Shift */}
                      <td className="border border-slate-300 px-2 py-2 whitespace-nowrap">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input
                              type="date"
                              value={editDraft.date}
                              onChange={e =>
                                setEditDraft({ ...editDraft, date: e.target.value })
                              }
                              className="w-full border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold"
                            />
                            <select
                              value={editDraft.shift}
                              onChange={e =>
                                setEditDraft({
                                  ...editDraft,
                                  shift: e.target.value as DailyJournalEntry['shift'],
                                })
                              }
                              className="w-full border border-slate-300 rounded px-1 py-0.5 text-[10px]"
                            >
                              {SHIFTS.map(s => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <>
                            <div className="font-extrabold text-slate-900">{entry.date}</div>
                            <div className="text-[10px] font-semibold text-slate-600">
                              {entry.shift}
                            </div>
                          </>
                        )}
                      </td>

                      {/* Stage & Machine */}
                      <td className="border border-slate-300 px-2 py-2">
                        {isEditing ? (
                          <div className="space-y-1">
                            <select
                              value={editDraft.processStage}
                              onChange={e =>
                                setEditDraft({
                                  ...editDraft,
                                  processStage: e.target.value as DailyJournalEntry['processStage'],
                                })
                              }
                              className="w-full border border-slate-300 rounded px-1 py-0.5 text-[10px] font-bold"
                            >
                              {PROCESS_STAGES.map(st => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={editDraft.machineName}
                              onChange={e =>
                                setEditDraft({ ...editDraft, machineName: e.target.value })
                              }
                              className="w-full border border-slate-300 rounded px-1 py-0.5 text-[11px]"
                            />
                          </div>
                        ) : (
                          <>
                            <span className="inline-block px-1.5 py-0.5 bg-blue-100 text-blue-900 font-extrabold rounded text-[10px] mb-0.5">
                              {entry.processStage}
                            </span>
                            <div className="font-bold text-slate-900 leading-snug">
                              {entry.machineName}
                            </div>
                          </>
                        )}
                      </td>

                      {/* Batch, Cable Spec & Required Raw Material */}
                      <td className="border border-slate-300 px-2 py-2">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={editDraft.batch}
                              onChange={e =>
                                setEditDraft({ ...editDraft, batch: e.target.value })
                              }
                              className="w-full border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold"
                              placeholder="Batch"
                            />
                            <input
                              type="text"
                              value={editDraft.cableSpec}
                              onChange={e =>
                                setEditDraft({ ...editDraft, cableSpec: e.target.value })
                              }
                              className="w-full border border-slate-300 rounded px-1 py-0.5 text-[10px]"
                              placeholder="Cable Spec"
                            />
                            <input
                              type="text"
                              value={editDraft.rawMaterialName || ''}
                              onChange={e =>
                                setEditDraft({ ...editDraft, rawMaterialName: e.target.value })
                              }
                              className="w-full border border-indigo-400 bg-indigo-50/40 rounded px-1 py-0.5 text-[10px] font-bold text-indigo-950"
                              placeholder="Required Raw Material"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="font-black text-indigo-950">{entry.batch}</div>
                            <div className="text-[11px] text-slate-600 leading-snug">
                              {entry.cableSpec}
                            </div>
                            <div className="mt-1 inline-block px-1.5 py-0.5 bg-indigo-50 border border-indigo-200 rounded text-[10px] font-bold text-indigo-900">
                              🧱 Req: {mat.rawMaterialName}
                            </div>
                          </>
                        )}
                      </td>

                      {/* Operator / Supervisor */}
                      <td className="border border-slate-300 px-2 py-2">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={editDraft.operatorName}
                              onChange={e =>
                                setEditDraft({ ...editDraft, operatorName: e.target.value })
                              }
                              className="w-full border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold"
                              placeholder="Operator"
                            />
                            <input
                              type="text"
                              value={editDraft.supervisorName || ''}
                              onChange={e =>
                                setEditDraft({ ...editDraft, supervisorName: e.target.value })
                              }
                              className="w-full border border-slate-300 rounded px-1 py-0.5 text-[10px]"
                              placeholder="Supervisor"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="font-bold text-slate-900 flex items-center gap-1">
                              <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>{entry.operatorName}</span>
                            </div>
                            {entry.supervisorName && entry.supervisorName !== '-' && (
                              <div className="text-[10px] text-slate-500">
                                Sup: {entry.supervisorName}
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      {/* Run / Planned Hrs & Availability (12-Hr Shift) */}
                      <td className="border border-slate-300 px-2 py-2 text-center whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex items-center gap-1 justify-center">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max={editDraft.plannedShiftHours || STANDARD_SHIFT_HOURS}
                              value={editDraft.actualRunHours}
                              onChange={e => {
                                const p = Number(editDraft.plannedShiftHours) || STANDARD_SHIFT_HOURS;
                                const r = Math.min(p, Math.max(0, Number(e.target.value)));
                                setEditDraft({
                                  ...editDraft,
                                  actualRunHours: r,
                                  downtimeHours: Math.max(0, Number((p - r).toFixed(2))),
                                });
                              }}
                              className="w-12 border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold text-center"
                            />
                            <span>/</span>
                            <input
                              type="number"
                              step="0.5"
                              min="1"
                              max="24"
                              value={editDraft.plannedShiftHours}
                              onChange={e => {
                                const p = Math.max(1, Number(e.target.value) || STANDARD_SHIFT_HOURS);
                                const r = Math.min(p, Number(editDraft.actualRunHours) || 0);
                                setEditDraft({
                                  ...editDraft,
                                  plannedShiftHours: p,
                                  actualRunHours: r,
                                  downtimeHours: Math.max(0, Number((p - r).toFixed(2))),
                                });
                              }}
                              className="w-12 border border-slate-300 rounded px-1 py-0.5 text-[11px] text-center"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="font-black text-slate-900">
                              {entry.actualRunHours.toFixed(1)} / {entry.plannedShiftHours.toFixed(1)} h
                            </div>
                            <div className="text-[10px] font-bold text-blue-700">
                              {eff.availabilityPct.toFixed(1)}% of 12h Shift
                            </div>
                          </>
                        )}
                      </td>

                      {/* Downtime & Cause */}
                      <td className="border border-slate-300 px-2 py-2">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max={editDraft.plannedShiftHours || STANDARD_SHIFT_HOURS}
                              value={editDraft.downtimeHours}
                              onChange={e => {
                                const p = Number(editDraft.plannedShiftHours) || STANDARD_SHIFT_HOURS;
                                const d = Math.min(p, Math.max(0, Number(e.target.value)));
                                setEditDraft({
                                  ...editDraft,
                                  downtimeHours: d,
                                  actualRunHours: Math.max(0, Number((p - d).toFixed(2))),
                                });
                              }}
                              className="w-16 border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold"
                            />
                            <input
                              type="text"
                              value={editDraft.downtimeReason}
                              onChange={e =>
                                setEditDraft({ ...editDraft, downtimeReason: e.target.value })
                              }
                              className="w-full border border-slate-300 rounded px-1 py-0.5 text-[10px]"
                            />
                          </div>
                        ) : (
                          <>
                            <div
                              className={`font-bold ${
                                entry.downtimeHours > 1.5 ? 'text-rose-700' : 'text-amber-700'
                              }`}
                            >
                              {entry.downtimeHours.toFixed(1)} hrs down
                            </div>
                            <div className="text-[10px] text-slate-600 leading-snug">
                              {entry.downtimeReason}
                            </div>
                          </>
                        )}
                      </td>

                      {/* Actual / Target Output & Line Speed */}
                      <td className="border border-slate-300 px-2 py-2 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="space-y-1">
                            <input
                              type="number"
                              value={editDraft.actualOutputM}
                              onChange={e =>
                                setEditDraft({
                                  ...editDraft,
                                  actualOutputM: Number(e.target.value),
                                })
                              }
                              className="w-20 border border-slate-300 rounded px-1 py-0.5 text-[11px] font-bold text-right"
                            />
                            <input
                              type="number"
                              value={editDraft.targetOutputM}
                              onChange={e =>
                                setEditDraft({
                                  ...editDraft,
                                  targetOutputM: Number(e.target.value),
                                })
                              }
                              className="w-20 border border-slate-300 rounded px-1 py-0.5 text-[10px] text-right"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="font-black text-indigo-950">
                              {entry.actualOutputM.toLocaleString()} /{' '}
                              <span className="text-slate-500 font-semibold">
                                {entry.targetOutputM.toLocaleString()} m
                              </span>
                            </div>
                            <div className="text-[10px] font-bold text-indigo-700">
                              {eff.performancePct.toFixed(1)}% Perf •{' '}
                              {eff.lineSpeedMPerMin.toFixed(1)} m/min
                            </div>
                          </>
                        )}
                      </td>

                      {/* System Required Material (Cu / PVC Kg) */}
                      <td className="border border-slate-300 px-2 py-2 text-right whitespace-nowrap bg-indigo-50/20">
                        {isEditing ? (
                          <div className="space-y-1">
                            <div className="flex items-center justify-end gap-1 text-[10px]">
                              <span className="text-slate-500">Sys Cu:</span>
                              <input
                                type="number"
                                step="0.1"
                                value={editDraft.systemRequiredCuKg ?? 0}
                                onChange={e =>
                                  setEditDraft({
                                    ...editDraft,
                                    systemRequiredCuKg: Number(e.target.value),
                                  })
                                }
                                className="w-16 border border-indigo-300 rounded px-1 py-0.5 text-[10px] font-bold text-right"
                              />
                            </div>
                            <div className="flex items-center justify-end gap-1 text-[10px]">
                              <span className="text-slate-500">Sys PVC:</span>
                              <input
                                type="number"
                                step="0.1"
                                value={editDraft.systemRequiredCompoundKg ?? 0}
                                onChange={e =>
                                  setEditDraft({
                                    ...editDraft,
                                    systemRequiredCompoundKg: Number(e.target.value),
                                  })
                                }
                                className="w-16 border border-indigo-300 rounded px-1 py-0.5 text-[10px] font-bold text-right"
                              />
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="text-[11px] font-bold text-slate-700">
                              Sys Cu: {mat.sysCuKg.toFixed(1)} kg
                            </div>
                            <div className="text-[11px] font-bold text-slate-700">
                              Sys PVC: {mat.sysCompKg.toFixed(1)} kg
                            </div>
                            <div className="text-[10px] font-extrabold text-indigo-800 border-t border-indigo-100 mt-0.5 pt-0.5">
                              Total Sys: {mat.totalSysKg.toFixed(1)} kg
                            </div>
                          </>
                        )}
                      </td>

                      {/* Manual Material & Scrap */}
                      <td className="border border-slate-300 px-2 py-2 text-right whitespace-nowrap bg-amber-50/20">
                        {isEditing ? (
                          <div className="space-y-1">
                            <div className="flex items-center justify-end gap-1 text-[10px]">
                              <span className="text-slate-500">Man Cu:</span>
                              <input
                                type="number"
                                step="0.1"
                                value={editDraft.copperConsumedKg}
                                onChange={e =>
                                  setEditDraft({
                                    ...editDraft,
                                    copperConsumedKg: Number(e.target.value),
                                  })
                                }
                                className="w-16 border border-amber-400 rounded px-1 py-0.5 text-[10px] font-bold text-right"
                              />
                            </div>
                            <div className="flex items-center justify-end gap-1 text-[10px]">
                              <span className="text-slate-500">Man PVC:</span>
                              <input
                                type="number"
                                step="0.1"
                                value={editDraft.compoundConsumedKg}
                                onChange={e =>
                                  setEditDraft({
                                    ...editDraft,
                                    compoundConsumedKg: Number(e.target.value),
                                  })
                                }
                                className="w-16 border border-blue-400 rounded px-1 py-0.5 text-[10px] font-bold text-right"
                              />
                            </div>
                            <div className="flex items-center justify-end gap-1 text-[10px]">
                              <span className="text-rose-600">Scrap:</span>
                              <input
                                type="number"
                                step="0.1"
                                value={editDraft.scrapKg}
                                onChange={e =>
                                  setEditDraft({
                                    ...editDraft,
                                    scrapKg: Number(e.target.value),
                                  })
                                }
                                className="w-16 border border-rose-300 rounded px-1 py-0.5 text-[10px] text-right"
                              />
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="text-[11px] font-bold text-slate-900">
                              Man Cu: {mat.manCuKg.toFixed(1)} kg
                            </div>
                            <div className="text-[11px] font-bold text-slate-900">
                              Man PVC: {mat.manCompKg.toFixed(1)} kg
                            </div>
                            <div className="text-[10px] font-bold text-rose-600 border-t border-amber-100 mt-0.5 pt-0.5">
                              Scrap: {entry.scrapKg.toFixed(1)} kg ({eff.qualityPct.toFixed(1)}% Yield)
                            </div>
                          </>
                        )}
                      </td>

                      {/* Manual vs System Difference */}
                      <td className="border border-slate-300 px-2 py-2 text-right whitespace-nowrap">
                        {mat.totalSysKg === 0 && mat.totalManKg === 0 ? (
                          <span className="text-[10px] text-slate-400 font-semibold">—</span>
                        ) : (
                          <>
                            {mat.sysCuKg > 0 || mat.manCuKg > 0 ? (
                              <div
                                className={`text-[10px] font-bold ${
                                  Math.abs(mat.diffCuKg) <= 0.1
                                    ? 'text-slate-600'
                                    : mat.diffCuKg > 0
                                    ? 'text-amber-700'
                                    : 'text-blue-700'
                                }`}
                              >
                                Cu: {mat.diffCuKg >= 0 ? '+' : ''}
                                {mat.diffCuKg.toFixed(2)} kg
                              </div>
                            ) : null}
                            {mat.sysCompKg > 0 || mat.manCompKg > 0 ? (
                              <div
                                className={`text-[10px] font-bold ${
                                  Math.abs(mat.diffCompKg) <= 0.1
                                    ? 'text-slate-600'
                                    : mat.diffCompKg > 0
                                    ? 'text-amber-700'
                                    : 'text-blue-700'
                                }`}
                              >
                                PVC: {mat.diffCompKg >= 0 ? '+' : ''}
                                {mat.diffCompKg.toFixed(2)} kg
                              </div>
                            ) : null}
                            <div
                              className={`mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-black ${
                                Math.abs(mat.totalDiffKg) <= 0.5
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : mat.totalDiffKg > 0
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-blue-100 text-blue-900'
                              }`}
                            >
                              Net: {mat.totalDiffKg >= 0 ? '+' : ''}
                              {mat.totalDiffKg.toFixed(2)} kg ({mat.totalDiffPct >= 0 ? '+' : ''}
                              {mat.totalDiffPct.toFixed(1)}%)
                            </div>
                          </>
                        )}
                      </td>

                      {/* Overall OEE % & QC Status */}
                      <td className="border border-slate-300 px-2 py-2 text-center whitespace-nowrap">
                        <div
                          className={`inline-block px-2 py-0.5 rounded font-black text-xs ${
                            eff.oeePct >= 85
                              ? 'bg-emerald-100 text-emerald-900 border border-emerald-400'
                              : eff.oeePct >= 75
                              ? 'bg-blue-100 text-blue-900 border border-blue-400'
                              : 'bg-amber-100 text-amber-900 border border-amber-400'
                          }`}
                        >
                          {eff.oeePct.toFixed(1)}% OEE
                        </div>
                        <div className="mt-1 text-[10px] font-bold text-slate-700">
                          {entry.qualityStatus}
                        </div>
                      </td>

                      {/* Operator Notes */}
                      <td className="border border-slate-300 px-2 py-2">
                        {isEditing ? (
                          <textarea
                            rows={2}
                            value={editDraft.operatorNotes}
                            onChange={e =>
                              setEditDraft({ ...editDraft, operatorNotes: e.target.value })
                            }
                            className="w-full border border-slate-300 rounded p-1 text-[11px]"
                          />
                        ) : (
                          <div className="text-[11px] text-slate-700 leading-relaxed">
                            {entry.operatorNotes}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="border border-slate-300 px-2 py-2 text-center whitespace-nowrap no-print">
                        {isEditing ? (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded cursor-pointer"
                              title="Save changes"
                            >
                              <Save className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(null);
                                setEditDraft(null);
                              }}
                              className="p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded cursor-pointer"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleStartEdit(entry)}
                              className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded cursor-pointer"
                              title="Edit Shift Log & Material Comparison"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteEntry(entry.id)}
                              className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded cursor-pointer"
                              title="Delete Shift Log"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredEntries.length > 0 && (
              <tfoot>
                <tr className="bg-slate-900 text-white font-extrabold text-xs">
                  <td colSpan={4} className="border border-slate-700 px-2 py-2 text-right uppercase">
                    TOTAL / SHIFT EFFICIENCY & MATERIAL AVERAGES ({filteredEntries.length} Logs):
                  </td>
                  <td className="border border-slate-700 px-2 py-2 text-center">
                    {summaryStats.totalRunHrs.toFixed(1)} / {summaryStats.totalPlannedHrs.toFixed(1)} h
                    <div className="text-[10px] text-emerald-300">
                      ({summaryStats.avgAvailabilityPct.toFixed(1)}% Avail.)
                    </div>
                  </td>
                  <td className="border border-slate-700 px-2 py-2">
                    {summaryStats.totalDowntimeHrs.toFixed(1)} hrs Total Down
                  </td>
                  <td className="border border-slate-700 px-2 py-2 text-right">
                    {summaryStats.totalActualM.toLocaleString()} /{' '}
                    {summaryStats.totalTargetM.toLocaleString()} m
                    <div className="text-[10px] text-emerald-300">
                      ({summaryStats.avgPerformancePct.toFixed(1)}% Perf.)
                    </div>
                  </td>
                  <td className="border border-slate-700 px-2 py-2 text-right text-indigo-200">
                    Cu: {summaryStats.totalSysCuKg.toFixed(1)}kg • PVC: {summaryStats.totalSysCompKg.toFixed(1)}kg
                    <div className="text-[10px] text-indigo-300">
                      Total Sys: {summaryStats.totalSysKg.toFixed(1)}kg
                    </div>
                  </td>
                  <td className="border border-slate-700 px-2 py-2 text-right text-amber-200">
                    Cu: {summaryStats.totalCuKg.toFixed(1)}kg • PVC: {summaryStats.totalCompKg.toFixed(1)}kg
                    <div className="text-[10px] text-rose-300">
                      Scrap: {summaryStats.totalScrapKg.toFixed(1)}kg ({summaryStats.avgQualityPct.toFixed(1)}% Yield)
                    </div>
                  </td>
                  <td className="border border-slate-700 px-2 py-2 text-right text-emerald-300">
                    {summaryStats.totalDiffKg >= 0 ? '+' : ''}
                    {summaryStats.totalDiffKg.toFixed(2)} kg
                    <div className="text-[10px] text-amber-300">
                      ({summaryStats.totalDiffPct >= 0 ? '+' : ''}
                      {summaryStats.totalDiffPct.toFixed(1)}% vs Sys)
                    </div>
                  </td>
                  <td className="border border-slate-700 px-2 py-2 text-center text-emerald-300 text-sm">
                    {summaryStats.avgOeePct.toFixed(1)}% OEE
                  </td>
                  <td colSpan={2} className="border border-slate-700 px-2 py-2 text-left text-[11px] text-slate-300">
                    Verified Shift Production & Raw Material Comparison
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
