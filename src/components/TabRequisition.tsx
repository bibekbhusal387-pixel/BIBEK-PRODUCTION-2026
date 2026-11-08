import React, { useState, useEffect, useMemo } from 'react';
import {
  CableOrder,
  ColourMapRule,
  DensitySettings,
  Is694OperatorLogEntry,
  LadiDimensionRule,
  PackagingRule,
  PurchaseItem,
  SizePackagingRule,
} from '../types/cable';
import {
  calcMaxBobbinLen,
  computeRecordRow,
  evaluateSpoolSizeForOrder,
  fmtExact,
  formatColourSequence,
  getCoilMultiplierByOption,
  getCoreColoursForOrder,
  getIs694ColourCoilsBreakdown,
  getOrderProgressStats,
  getRequiredStagesForOrder,
  getStageLockState,
  Is694ColourCoilItem,
  ProcessStageKey,
} from '../utils/calculations';
import {
  getOrderForProcessCardView,
  releasePartialProductionPlanForOrder,
  resetPartialProductionPlanForOrder,
  loadVihanTriguardCartonRules,
  loadMaruMiracleCartonRules,
  lookupIs694CartonSpec,
  sumMixBreakdown,
  syncOrderWithOperatorProductionLogs,
} from '../utils/is694CartonPackaging';
import { StockLedgerResult, extractStrandDiameter } from '../utils/stockEngine';
import { Printer, CheckCircle2, Clock, Activity, CheckCheck, Zap, Lock, FileText, Plus, Trash2, Box, PackageCheck } from 'lucide-react';

interface TabRequisitionProps {
  orders: CableOrder[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  colourMap: ColourMapRule[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
  selectedBatch: string;
  selectedBrand: string;
  selectedSize: string;
  selectedOrderId?: number;
  purchaseItems?: PurchaseItem[];
  stockLedger?: StockLedgerResult;
  onUseBunchedCopper?: (orderId: number, purchaseItemId: number, customQty?: number) => void;
  onRevertBunchedCopper?: (orderId: number) => void;
  onUpdateOrder: (order: CableOrder) => void;
  onToggleProcess: (orderId: number, processKey: 'b' | 'c' | 'i' | 't' | 's') => void;
}

export const TabRequisition: React.FC<TabRequisitionProps> = ({
  orders,
  densities,
  ladiDimensions,
  colourMap,
  sizeRules,
  packagingRules,
  selectedBatch,
  selectedBrand,
  selectedSize,
  selectedOrderId,
  purchaseItems,
  stockLedger,
  onUseBunchedCopper,
  onRevertBunchedCopper,
  onUpdateOrder,
  onToggleProcess,
}) => {
  const batches = Array.from(new Set(orders.map(o => o.batch))).sort();
  const [batch, setBatch] = useState(selectedBatch || (batches[0] || '07/163'));
  const brandsForBatch = Array.from(new Set(orders.filter(o => o.batch === batch).map(o => o.brand))).sort();
  const [brand, setBrand] = useState(selectedBrand || (brandsForBatch[0] || 'EKP'));
  const gradesForBatchBrand = Array.from(new Set(orders.filter(o => o.batch === batch && o.brand === brand).map(o => o.grade || 'H05VV-F'))).sort();
  const [grade, setGrade] = useState(gradesForBatchBrand[0] || 'H05VV-F');
  const [condSelector, setCondSelector] = useState('');
  
  // Auto-pick today's date in DD/MM/YYYY format
  const getTodayDateStr = () => {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const [dateStr, setDateStr] = useState<string>(() => getTodayDateStr());
  const [isDateManuallyEdited, setIsDateManuallyEdited] = useState<boolean>(false);
  const [printOrientation, setPrintOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [printStageFilter, setPrintStageFilter] = useState<'ALL' | ProcessStageKey>('ALL');
  const [sheathNotes, setSheathNotes] = useState('PRINT CLEARLY EVERY 1 METER; CHECK DIE & NOZZLE CENTERING BEFORE START');
  const [parcelCoilsInput, setParcelCoilsInput] = useState<string>('100');
  const [parcelNotesInput, setParcelNotesInput] = useState<string>('');

  // Keep state synchronized with incoming props when navigated from order table or changed
  useEffect(() => {
    if (selectedOrderId) {
      const targetOrder = orders.find(o => o.id === selectedOrderId);
      if (targetOrder) {
        setBatch(targetOrder.batch);
        setBrand(targetOrder.brand);
        if (targetOrder.grade) setGrade(targetOrder.grade);
        setCondSelector(`ITEM_${targetOrder.id}`);
        return;
      }
    }
    if (selectedBatch && batches.includes(selectedBatch)) {
      setBatch(selectedBatch);
    }
    if (selectedBrand) {
      setBrand(selectedBrand);
    }
  }, [selectedBatch, selectedBrand, selectedOrderId]);

  useEffect(() => {
    if (brandsForBatch.length > 0 && !brandsForBatch.includes(brand)) {
      setBrand(brandsForBatch[0]);
    }
  }, [batch, brandsForBatch]);

  useEffect(() => {
    if (gradesForBatchBrand.length > 0 && !gradesForBatchBrand.includes(grade)) {
      setGrade(gradesForBatchBrand[0]);
    }
  }, [brand, gradesForBatchBrand]);

  useEffect(() => {
    if ((grade || '').toUpperCase().includes('IS-694') && ['c', 't', 's'].includes(printStageFilter)) {
      setPrintStageFilter('ALL');
    }
  }, [grade, printStageFilter]);

  const matchingForSelection = orders.filter(
    o => o.batch === batch && o.brand === brand && (o.grade || 'H05VV-F') === grade
  );

  const uniqueConductors = Array.from(new Set(matchingForSelection.map(o => o.conductor)));

  // Determine matching orders based on condSelector (using active Partial Production Plan Lot when present!)
  let matchingOrders = matchingForSelection.map(o =>
    computeRecordRow(getOrderForProcessCardView(o), densities, ladiDimensions)
  );

  if (condSelector.startsWith('COMBINED_COND_')) {
    const targetCond = condSelector.replace('COMBINED_COND_', '');
    matchingOrders = matchingOrders.filter(o => o.conductor === targetCond);
  } else if (condSelector.startsWith('ITEM_')) {
    const targetId = parseInt(condSelector.replace('ITEM_', ''));
    matchingOrders = matchingOrders.filter(o => o.id === targetId);
  } else if (condSelector && !condSelector.includes('COMBINED')) {
    matchingOrders = matchingOrders.filter(o => o.conductor === condSelector);
  }

  // Serial rule-aware Process Completion calculation across matching orders
  const totalCount = matchingOrders.length;
  const cApplicableOrders = matchingOrders.filter(o => getRequiredStagesForOrder(o, ladiDimensions).c);
  const tApplicableOrders = matchingOrders.filter(o => getRequiredStagesForOrder(o, ladiDimensions).t);
  const sApplicableOrders = matchingOrders.filter(o => getRequiredStagesForOrder(o, ladiDimensions).s);

  const isCRequired = cApplicableOrders.length > 0;
  const isTRequired = tApplicableOrders.length > 0;
  const isSRequired = sApplicableOrders.length > 0;

  const bDoneCount = matchingOrders.filter(o => o.pStatus?.b).length;
  const cDoneCount = cApplicableOrders.filter(o => o.pStatus?.c).length;
  const iDoneCount = matchingOrders.filter(o => o.pStatus?.i).length;
  const tDoneCount = tApplicableOrders.filter(o => o.pStatus?.t).length;
  const sDoneCount = sApplicableOrders.filter(o => o.pStatus?.s).length;

  const bDone = totalCount > 0 && bDoneCount === totalCount;
  const cDone = isCRequired && cDoneCount === cApplicableOrders.length;
  const iDone = totalCount > 0 && iDoneCount === totalCount;
  const tDone = isTRequired && tDoneCount === tApplicableOrders.length;
  const sDone = isSRequired && sDoneCount === sApplicableOrders.length;

  // Serial Unlock checks:
  // 1. Bunching (b) is always first
  // 2. Cu Stranding (c) requires Bunching (b) done (if c is required by rules; if not, sequence moves directly to Insulation)
  // 3. Insulation (i) requires Bunching (b) done AND Cu Stranding (c) done (only if c is required by rules)
  // 4. Twisting (t) requires Insulation (i) done (only if t is required by rules)
  // 5. Sheathing (s) requires Insulation (i) done AND Twisting (t) done (only if t is required by rules)
  const isBUnlocked = true;
  const isCUnlocked = isCRequired && bDone;
  const isIUnlocked = bDone && (!isCRequired || cDone);
  const isTUnlocked = isTRequired && iDone;
  const isSUnlocked = isSRequired && iDone && (!isTRequired || tDone);

  // Toggle all matching orders for a specific stage in serial order
  const toggleAllForCard = (key: 'b' | 'c' | 'i' | 't' | 's') => {
    const targetOrders =
      key === 'c'
        ? cApplicableOrders
        : key === 't'
        ? tApplicableOrders
        : key === 's'
        ? sApplicableOrders
        : matchingOrders;

    if (targetOrders.length === 0) {
      if (matchingOrders[0]) {
        onToggleProcess(matchingOrders[0].id, key);
      }
      return;
    }

    const allDone = targetOrders.every(o => o.pStatus?.[key]);
    targetOrders.forEach(o => {
      if (allDone) {
        if (o.pStatus?.[key]) onToggleProcess(o.id, key);
      } else {
        if (!o.pStatus?.[key]) onToggleProcess(o.id, key);
      }
    });
  };

  // Stage-wise stock calculation for matching orders
  const stageStockSummary = useMemo(() => {
    if (!stockLedger) return null;

    // Stage 1: Bunching - Raw Copper Wire
    const strandDia = matchingOrders[0] ? extractStrandDiameter(matchingOrders[0].conductor) : '';
    const matchingRawCopper = stockLedger.rawCopperRows.filter(r =>
      strandDia ? r.name.includes(strandDia) : true
    );
    const rawCopperStockKg = matchingRawCopper.reduce((s, r) => s + Math.max(0, r.closing || 0), 0);
    const rawCopperAvailKg = matchingRawCopper.reduce(
      (s, r) => s + Math.max(0, r.availableStock !== undefined ? r.availableStock : r.closing),
      0
    );

    // Stage 2: Cu Stranding - Bunched Copper
    const bunchedStockKg = stockLedger.bunchedCopperRows.reduce((s, r) => s + Math.max(0, r.closing || 0), 0);

    // Stage 3: Insulation - PVC Compound
    const insCompoundName = (matchingOrders[0]?.ins_compound || 'KI-06').toUpperCase().trim();
    const matchingIns = stockLedger.insulationRows.filter(r =>
      r.name.toUpperCase().includes(insCompoundName)
    );
    const insCompoundStockKg = matchingIns.reduce((s, r) => s + Math.max(0, r.closing || 0), 0);
    const insCompoundAvailKg = matchingIns.reduce(
      (s, r) => s + Math.max(0, r.availableStock !== undefined ? r.availableStock : r.closing),
      0
    );

    // Stage 4: Twisting - Insulated Cores
    const matchingCores = stockLedger.semiFinishedRows.filter(r => r.key.startsWith('STAGE_I||'));
    const coresStockMtrs = matchingCores.reduce((s, r) => s + Math.max(0, r.closing || 0), 0);

    // Stage 5: Sheathing - Sheath Compound & Drums
    const sheathCompName = (matchingOrders[0]?.sheath_compound || 'ST-1 GREY').toUpperCase().trim();
    const matchingSheath = stockLedger.sheathingRows.filter(r =>
      r.name.toUpperCase().includes(sheathCompName)
    );
    const sheathCompStockKg = matchingSheath.reduce((s, r) => s + Math.max(0, r.closing || 0), 0);
    const sheathCompAvailKg = matchingSheath.reduce(
      (s, r) => s + Math.max(0, r.availableStock !== undefined ? r.availableStock : r.closing),
      0
    );
    const drumStockNos = stockLedger.drumRows.reduce((s, r) => s + Math.max(0, r.closing || 0), 0);

    return {
      strandDia: strandDia || 'Standard',
      rawCopperStockKg,
      rawCopperAvailKg,
      bunchedStockKg,
      insCompoundName,
      insCompoundStockKg,
      insCompoundAvailKg,
      coresStockMtrs,
      sheathCompName,
      sheathCompStockKg,
      sheathCompAvailKg,
      drumStockNos,
    };
  }, [stockLedger, matchingOrders]);

  const handlePrint = () => {
    // Auto-pick today's date on print if empty or not manually customized
    if (!dateStr || !dateStr.trim() || !isDateManuallyEdited) {
      setDateStr(getTodayDateStr());
    }
    window.print();
  };

  const handlePrintStage = (stage: 'ALL' | ProcessStageKey) => {
    // Auto-pick today's date on print if empty or not manually customized
    if (!dateStr || !dateStr.trim() || !isDateManuallyEdited) {
      setDateStr(getTodayDateStr());
    }
    setPrintStageFilter(stage);
    setTimeout(() => {
      window.print();
    }, 80);
  };

  // Helper to render responsive process status badges on card headers
  const renderStageBadge = (
    stageName: string,
    done: boolean,
    doneCount: number,
    applicableTotal: number = totalCount,
    unlocked: boolean = true,
    prereqName?: string
  ) => {
    if (done) {
      return (
        <span className="px-2.5 py-1 rounded bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{stageName} COMPLETED ({doneCount}/{applicableTotal})</span>
        </span>
      );
    }
    if (!unlocked) {
      return (
        <span className="px-2.5 py-1 rounded bg-slate-900/70 text-amber-300 border border-amber-400/40 font-bold text-xs flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          <span>LOCKED — COMPLETE {prereqName || 'PREVIOUS STAGE'} FIRST</span>
        </span>
      );
    }
    if (doneCount > 0) {
      return (
        <span className="px-2.5 py-1 rounded bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs">
          <Clock className="w-3.5 h-3.5" />
          <span>{stageName} IN PROGRESS ({doneCount}/{applicableTotal})</span>
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded bg-slate-700/80 text-slate-200 font-medium text-xs flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        <span>{stageName} READY (0/{applicableTotal})</span>
      </span>
    );
  };

  // Official print/inspection stamp for each card
  const renderOfficialStamp = (stageName: string, done: boolean, doneCount: number, applicableTotal: number = totalCount) => {
    const activeDate = dateStr && dateStr.trim() ? dateStr : getTodayDateStr();
    return (
      <div
        className={`px-3 py-1 rounded border-2 text-center font-mono uppercase tracking-wider text-[10px] leading-tight shrink-0 ${
          done
            ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
            : doneCount > 0
            ? 'border-amber-500 bg-amber-50 text-amber-800'
            : 'border-slate-300 bg-slate-50 text-slate-500'
        }`}
      >
        <div className="font-extrabold text-[10.5px]">
          {done ? '✓ STAGE COMPLETED' : doneCount > 0 ? `⏳ IN PROGRESS (${doneCount}/${applicableTotal})` : '⚪ PENDING'}
        </div>
        <div className="text-[8.5px] opacity-80">{stageName} • {activeDate}</div>
      </div>
    );
  };

  // Inline Editable Date Header for Process Cards (Auto-picks today's date, fully editable on screen & cleanly prints)
  const renderCardDateHeader = () => {
    const activeDate = dateStr && dateStr.trim() ? dateStr : getTodayDateStr();
    return (
      <div className="flex items-center gap-1.5 text-xs text-white">
        <span className="font-bold text-slate-200 text-[11px] uppercase tracking-wide">DATE:</span>
        {/* On screen: inline editable text input */}
        <input
          type="text"
          value={dateStr}
          onChange={(e) => {
            setDateStr(e.target.value);
            setIsDateManuallyEdited(true);
          }}
          placeholder="DD/MM/YYYY"
          className="no-print w-28 px-1.5 py-0.5 rounded font-mono font-bold text-slate-900 bg-white border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs text-center shadow-2xs"
          title="Editable date: type any date or click '⚡ Today' to auto-pick today's date"
        />
        <button
          type="button"
          onClick={() => {
            setDateStr(getTodayDateStr());
            setIsDateManuallyEdited(false);
          }}
          className="no-print px-1.5 py-0.5 text-[10px] bg-white/20 hover:bg-white/30 text-white rounded font-bold cursor-pointer transition-colors shadow-2xs"
          title="Auto-pick today's date"
        >
          ⚡ Today
        </button>
        {/* On print: pristine underlined date text */}
        <span className="print-only underline font-mono font-bold text-black text-xs">
          {activeDate}
        </span>
      </div>
    );
  };

  // Print-only Stage Sheet Header & Sign-off Footer so each printed stage page is a standalone factory job sheet
  const renderPrintStageSheetHeader = (stageTitle: string, stagePageIdx: number, totalStagePages: number) => {
    const activeDate = dateStr && dateStr.trim() ? dateStr : getTodayDateStr();
    return (
      <div className="print-only mb-2 pb-2 border-b-2 border-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-black uppercase tracking-wide text-black">
              ⚡ PLUTUS CABLE PRODUCTION & REQUISITION — OFFICIAL PROCESS CARD
            </div>
            <div className="text-[11px] font-bold text-slate-800">
              {stageTitle} • BATCH: {batch} • BRAND: {brand} • GRADE: {grade}
            </div>
          </div>
          <div className="text-right font-mono text-[10.5px] font-bold text-black border border-slate-800 px-2.5 py-1 rounded">
            <div>SEPARATE STAGE SHEET — PAGE {stagePageIdx} OF {totalStagePages}</div>
            <div>DATE: {activeDate}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderPrintStageSheetFooter = (stageTitle: string) => (
    <div className="print-only mt-3 pt-2 border-t border-slate-400 flex items-center justify-between text-[10px] font-bold text-slate-800">
      <div>STAGE: {stageTitle}</div>
      <div>MACHINE OPERATOR SIGN: ______________________</div>
      <div>QC / IN-CHARGE SIGN: ______________________</div>
    </div>
  );

  if (matchingOrders.length === 0) {
    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-sm font-bold text-slate-800 mb-2">🎛️ Requisition & Process Card Selector</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">1. Batch / Job Order</label>
              <select value={batch} onChange={(e) => setBatch(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white">
                {batches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">2. Brand</label>
              <select value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white">
                {brandsForBatch.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">3. Cable Grade</label>
              <select value={grade} onChange={(e) => setGrade(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white">
                {gradesForBatchBrand.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
          No matching active or completed orders found for this Batch, Brand, and Grade combination.
        </div>
      </div>
    );
  }

  const first = matchingOrders[0];
  const sizeNum = first.sizeNum;
  const reqLen = matchingOrders.reduce((s, r) => s + r.reqCoreLen, 0);
  const totalWt = matchingOrders.reduce((s, r) => s + r.reqCu, 0);
  const totalInsWt = matchingOrders.reduce((s, r) => s + r.reqIns, 0);

  const subOne = Number(first.sub1) || 0;
  const countOne = Number(first.f2) || 0;
  const subTwo = Number(first.sub2) || 0;
  const countTwo = Number(first.h2) || 0;
  const dia = first.dia;
  const density = densities.COPPER;

  const kgpmOne = subOne * dia * dia * 0.785 * density;
  const kgpmTwo = subTwo * dia * dia * 0.785 * density;
  const unitWtOne = reqLen * kgpmOne;
  const unitWtTwo = reqLen * kgpmTwo;

  const maxLenOne = calcMaxBobbinLen(kgpmOne);
  const maxLenTwo = calcMaxBobbinLen(kgpmTwo);

  const fullOne = maxLenOne > 0 ? Math.floor(reqLen / maxLenOne) : 0;
  const remOne = maxLenOne > 0 ? (reqLen % maxLenOne) : 0;
  const lotsPerOne = countOne === 0 ? 0 : (unitWtOne <= 280 ? 1 : (fullOne + (remOne > 0 ? 1 : 0)));

  const fullTwo = maxLenTwo > 0 ? Math.floor(reqLen / maxLenTwo) : 0;
  const remTwo = maxLenTwo > 0 ? (reqLen % maxLenTwo) : 0;
  const lotsPerTwo = countTwo === 0 ? 0 : (unitWtTwo <= 280 ? 1 : (fullTwo + (remTwo > 0 ? 1 : 0)));

  const isSpecial = (sizeNum >= 10 && countOne > 0);
  const oldKgpm = reqLen > 0 ? (totalWt / reqLen) : 0;
  const oldMaxLen = calcMaxBobbinLen(oldKgpm);
  const oldFull = oldMaxLen > 0 ? Math.floor(reqLen / oldMaxLen) : 0;
  const oldRem = oldMaxLen > 0 ? (reqLen % oldMaxLen) : 0;
  const oldLots = totalWt <= 280 ? (reqLen > 0 ? 1 : 0) : (oldFull + (oldRem > 0 ? 1 : 0));

  const totalLots = isSpecial ? (countOne * lotsPerOne + countTwo * lotsPerTwo) : oldLots;
  const bbnList: string[] = [];
  for (let i = 1; i <= totalLots; i++) {
    bbnList.push(`${batch}-${brand}-${sizeNum.toFixed(2)}-${i}`);
  }
  const bbnString = bbnList.join(',  ');

  let condDisplay = first.conductor;
  if (sizeNum > 6 && (subOne > 0 || subTwo > 0)) {
    const p: string[] = [];
    if (subOne > 0) p.push(`${subOne}/${dia.toFixed(3)}`);
    if (subTwo > 0) p.push(`${subTwo}/${dia.toFixed(3)}`);
    condDisplay = p.join(' and ');
  }

  let reqQtyText = '';
  let reqWtText = '';
  if (isSpecial) {
    const pLen: string[] = [];
    const pWt: string[] = [];
    if (countOne > 0) {
      if (unitWtOne <= 280) {
        pLen.push(`${reqLen.toLocaleString()}*${countOne}`);
        pWt.push(`${unitWtOne.toFixed(1)}*${countOne}`);
      } else {
        let sL = `${maxLenOne.toLocaleString()}*${fullOne * countOne}`;
        let sW = `${(maxLenOne * kgpmOne).toFixed(1)}*${fullOne * countOne}`;
        if (remOne > 0) {
          sL += ` + ${remOne.toLocaleString()}*${countOne}`;
          sW += ` + ${(remOne * kgpmOne).toFixed(1)}*${countOne}`;
        }
        pLen.push(sL);
        pWt.push(sW);
      }
    }
    if (countTwo > 0) {
      if (unitWtTwo <= 280) {
        pLen.push(`${reqLen.toLocaleString()}*${countTwo}`);
        pWt.push(`${unitWtTwo.toFixed(1)}*${countTwo}`);
      } else {
        let sL = `${maxLenTwo.toLocaleString()}*${fullTwo * countTwo}`;
        let sW = `${(maxLenTwo * kgpmTwo).toFixed(1)}*${fullTwo * countTwo}`;
        if (remTwo > 0) {
          sL += ` + ${remTwo.toLocaleString()}*${countTwo}`;
          sW += ` + ${(remTwo * kgpmTwo).toFixed(1)}*${countTwo}`;
        }
        pLen.push(sL);
        pWt.push(sW);
      }
    }
    reqQtyText = pLen.join(' + ');
    reqWtText = pWt.join(' + ');
  } else {
    if (totalWt <= 280) {
      reqQtyText = reqLen.toLocaleString();
      reqWtText = totalWt.toFixed(1);
    } else {
      reqQtyText = `${oldMaxLen.toLocaleString()}*${oldFull}` + (oldRem > 0 ? ` + ${oldRem.toLocaleString()}*1` : '');
      reqWtText = `${(oldMaxLen * oldKgpm).toFixed(1)}*${oldFull}` + (oldRem > 0 ? ` + ${(oldRem * oldKgpm).toFixed(1)}*1` : '');
    }
  }

  const bunchLayDisplay = (isSpecial && first.ladiLay) ? first.ladiLay : fmtExact(first.bunchLay, 6);
  const bunchScrap = totalWt * 0.0015;

  // Active colours for insulation
  const activeColoursSet = new Set<string>();
  matchingOrders.forEach(m => {
    const cmap = getCoreColoursForOrder(m.grade, m.cores, colourMap, m.ins_colour);
    Object.keys(cmap).forEach(cName => activeColoursSet.add(cName));
  });
  const uniqueColours = Array.from(activeColoursSet);

  const isIs694Card = matchingOrders.some(m => (m.grade || '').toUpperCase().includes('IS-694'));

  // Build colour-wise coil rows for IS-694 Special Process Card
  const is694OrderColourRows = matchingOrders.flatMap(m => {
    const items = getIs694ColourCoilsBreakdown(m, colourMap);
    return items.map((item, idx) => ({
      order: m,
      item,
      rowKey: `${m.id}-${item.colour}-${idx}`,
    }));
  });

  // Consolidated summary by colour across all matching orders
  const is694ColourSummaryMap = new Map<
    string,
    {
      colour: string;
      coils: number;
      coilOptionsSet: Set<string>;
      orderLenM: number;
      reqCoreLenM: number;
      reqInsKg: number;
      insCompound: string;
      coreOd: number;
      grade: string;
    }
  >();

  is694OrderColourRows.forEach(({ order: m, item }) => {
    const key = item.colour.toUpperCase();
    const existing = is694ColourSummaryMap.get(key);
    if (existing) {
      existing.coils += item.coils;
      if (item.coilType) existing.coilOptionsSet.add(item.coilType);
      existing.orderLenM += item.orderLenM;
      existing.reqCoreLenM += item.reqCoreLenM;
      existing.reqInsKg += item.reqInsKg;
    } else {
      is694ColourSummaryMap.set(key, {
        colour: item.colour.toUpperCase(),
        coils: item.coils,
        coilOptionsSet: new Set(item.coilType ? [item.coilType] : []),
        orderLenM: item.orderLenM,
        reqCoreLenM: item.reqCoreLenM,
        reqInsKg: item.reqInsKg,
        insCompound: m.ins_compound,
        coreOd: m.coreOd,
        grade: m.grade || 'IS-694',
      });
    }
  });
  const is694ConsolidatedColours = Array.from(is694ColourSummaryMap.values());
  const totalIs694Coils = is694ConsolidatedColours.reduce((s, r) => s + r.coils, 0);

  const coreStrandingRows = matchingOrders.filter(m => m.cores > 1);
  const totalSheathWt = matchingOrders.reduce((s, m) => s + m.reqSheath, 0);

  let totalStepsCompleted = 0;
  let totalStepsTarget = 0;
  matchingOrders.forEach(o => {
    const st = getOrderProgressStats(o, ladiDimensions);
    totalStepsCompleted += st.completedCount;
    totalStepsTarget += st.totalRequired;
  });
  const batchPct = totalStepsTarget > 0 ? Math.round((totalStepsCompleted / totalStepsTarget) * 100) : 0;

  const visibleStageKeys: ProcessStageKey[] = isIs694Card
    ? ['b', 'i']
    : [
        'b',
        ...(sizeNum > 6 ? ['c' as const] : []),
        'i',
        ...(coreStrandingRows.length > 0 ? ['t' as const] : []),
        ...(isSRequired ? ['s' as const] : []),
      ];
  const totalStagePages = printStageFilter === 'ALL' ? visibleStageKeys.length : 1;
  const getStagePageNumber = (sk: ProcessStageKey) => {
    if (printStageFilter !== 'ALL') return 1;
    const idx = visibleStageKeys.indexOf(sk);
    return idx >= 0 ? idx + 1 : 1;
  };

  // Matching purchased bunched copper items
  const bunchStagePurchases = (purchaseItems || []).filter(p => {
    if (p.status !== 'received') return false;
    const isBunch = p.stage === 'bunch'
      || (p.description || '').toLowerCase().includes('bunch')
      || (p.description || '').toLowerCase().includes('pre-bunched');
    if (!isBunch) return false;

    // Check if conductor or description matches
    const targetCond = (first?.conductor || '').trim().toLowerCase();
    const pCond = (p.conductor || '').trim().toLowerCase();
    const pDesc = (p.description || '').trim().toLowerCase();

    if (pCond && targetCond && (pCond.includes(targetCond) || targetCond.includes(pCond))) return true;
    if (targetCond && pDesc.includes(targetCond)) return true;
    const strandMatch = targetCond.split('/')[0];
    if (strandMatch && pDesc.includes(`${strandMatch}/`)) return true;
    return true; // Any bunch stage copper can be reviewed
  });

  const totalAvailableBunchedStock = bunchStagePurchases.reduce((acc, p) => {
    const used = p.usedQty || 0;
    return acc + Math.max(0, p.qty - used);
  }, 0);

  return (
    <div className="space-y-6 print-stages-container">
      {/* Selector Card (Hidden on Print) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs no-print">
        <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-2">
          <div className="text-sm font-bold text-slate-900">🎛️ Requisition & Process Card Selector</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={printStageFilter}
              onChange={(e) => setPrintStageFilter(e.target.value as 'ALL' | ProcessStageKey)}
              className="text-xs px-2.5 py-1.5 border border-indigo-300 rounded font-bold bg-indigo-50 text-indigo-900"
              title="Choose whether to display & print all stages (each on its own separate page) or a single stage"
            >
              {isIs694Card ? (
                <>
                  <option value="ALL">📄 All IS-694 Cards (1. Bunching + 2. IS-694 Insulation Only)</option>
                  <option value="b">Stage 1 Only: 1. Copper Bunching</option>
                  <option value="i">Stage 2 Only: 2. IS-694 Insulation &amp; Coiling (FINAL STAGE)</option>
                </>
              ) : (
                <>
                  <option value="ALL">📄 All Stages (1 Stage Per Separate Page)</option>
                  <option value="b">Page 1 Only: 1. Copper Bunching</option>
                  {sizeNum > 6 && <option value="c">Page 2 Only: 2. Cu Stranding (Ladi)</option>}
                  <option value="i">Stage 3 Only: 3. Insulation Process</option>
                  {coreStrandingRows.length > 0 && <option value="t">Stage 4 Only: 4. Core Stranding (Twisting)</option>}
                  <option value="s">Stage 5 Only: 5. Sheathing Process</option>
                </>
              )}
            </select>
            <select
              value={printOrientation}
              onChange={(e) => setPrintOrientation(e.target.value as 'landscape' | 'portrait')}
              className="text-xs px-2.5 py-1.5 border border-slate-300 rounded font-semibold bg-white"
            >
              <option value="landscape">A4 Landscape</option>
              <option value="portrait">A4 Portrait</option>
            </select>
            <button
              onClick={handlePrint}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="Print each stage on a separate page (Purchased Copper Bunch Ability is automatically excluded from print)"
            >
              <Printer className="w-4 h-4" /> Print Separate Stage Pages
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">1. Select Job Order / Batch</label>
            <select
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded bg-white font-semibold"
            >
              {batches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">2. Brand</label>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded bg-white font-semibold"
            >
              {brandsForBatch.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">3. Cable Grade</label>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded bg-white font-semibold"
            >
              {gradesForBatchBrand.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">4. Copper Conductor Size</label>
            <select
              value={condSelector}
              onChange={(e) => setCondSelector(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded bg-white font-semibold"
            >
              {uniqueConductors.length > 1 && (
                <option value="">📦 COMBINED ALL (Same Batch, Grade & Copper)</option>
              )}
              {uniqueConductors.map(c => {
                const grp = matchingForSelection.filter(o => o.conductor === c);
                if (grp.length > 1) {
                  return (
                    <option key={`grp-${c}`} value={`COMBINED_COND_${c}`}>
                      📦 COMBINED (Cu: {c}) [{grp.length} items]
                    </option>
                  );
                }
                return null;
              })}
              {matchingForSelection.map(o => {
                const is694 = (o.grade || '').toUpperCase().includes('IS-694');
                return (
                  <option key={o.id} value={`ITEM_${o.id}`}>
                    Single Cable: {is694 ? o.size : `${o.cores}C × ${o.size}`} (Cu: {o.conductor})
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-bold text-slate-500 uppercase">5. Process Card Date</label>
              <button
                type="button"
                onClick={() => {
                  setDateStr(getTodayDateStr());
                  setIsDateManuallyEdited(false);
                }}
                className="text-[10px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-0.5 cursor-pointer"
                title="Auto-pick today's date"
              >
                ⚡ Pick Today
              </button>
            </div>
            <input
              type="text"
              value={dateStr}
              onChange={(e) => {
                setDateStr(e.target.value);
                setIsDateManuallyEdited(true);
              }}
              placeholder="DD/MM/YYYY"
              className="w-full p-2 border border-slate-300 rounded bg-white font-semibold text-center text-xs"
            />
            <span className="text-[9.5px] text-slate-400 block mt-0.5 text-center">
              Auto-picks today's date for print • Editable
            </span>
          </div>
        </div>

        {/* IS-694 Parcel Order Processing Option & Partial Production Plan Lot Selector */}
        {(isIs694Card || matchingOrders.some(m => m.production_lots && m.production_lots.length > 0)) && (
          <div className="mt-3 p-3.5 rounded-xl bg-gradient-to-r from-indigo-50 via-purple-50 to-rose-50 border-2 border-indigo-400 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded bg-indigo-700 text-white font-black text-[10.5px] uppercase tracking-wide">
                  📦 IS-694 Parcel Order Processing (Partial Production Lot Option)
                </span>
                <span className="text-[11px] font-bold text-indigo-950">
                  Process an IS-694 order in parcels (e.g. release 100 coils now, keep remaining 300 coils on Order Sheet) &amp; select which parcel lot prints on this Process Card
                </span>
              </div>
            </div>

            {matchingOrders.map(m => {
              const rawOrder = orders.find(o => o.id === m.id) || m;
              const hasLots = Boolean(rawOrder.production_lots && rawOrder.production_lots.length > 0);
              const activeVal = hasLots
                ? rawOrder.active_plan_lot_id || rawOrder.production_lots![rawOrder.production_lots!.length - 1].id
                : 'FULL_ORDER';
              const totalOrderCoils =
                rawOrder.total_order_coils ||
                Number(rawOrder.coils || 0) + Number(rawOrder.planned_coils || 0);
              const remainingOrderSheetCoils = Number(rawOrder.coils || 0);
              const plannedCoilsSoFar = Number(rawOrder.planned_coils || 0);

              const handleReleaseParcelFromProcessCard = () => {
                const parcelCoils = Math.round(Number(parcelCoilsInput || 0));
                if (parcelCoils <= 0) return;
                const vihanRules = loadVihanTriguardCartonRules();
                const maruRules = loadMaruMiracleCartonRules();
                const updated = releasePartialProductionPlanForOrder(
                  rawOrder,
                  parcelCoils,
                  vihanRules,
                  maruRules,
                  dateStr,
                  parcelNotesInput.trim() || `Parcel Lot #${(rawOrder.production_lots?.length || 0) + 1}`
                );
                onUpdateOrder(updated);
                setParcelNotesInput('');
              };

              const handleResetParcelsFromProcessCard = () => {
                const updated = resetPartialProductionPlanForOrder(rawOrder);
                onUpdateOrder(updated);
              };

              return (
                <div
                  key={m.id}
                  className="bg-white/95 border border-indigo-200 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-slate-900">
                        {rawOrder.batch} — {rawOrder.brand} {rawOrder.size} ({rawOrder.ins_colour || 'RED'})
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-bold text-[10.5px] border border-slate-300">
                        Total Order: {totalOrderCoils} Coils
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-black text-[10.5px] border border-emerald-300">
                        Active on Process Card: {m.coils} Coils × {m.coil_type || '90 MTR'} ({m.orderLen.toLocaleString()} m)
                      </span>
                      {hasLots && (
                        <>
                          <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-bold text-[10.5px] border border-indigo-300">
                            Planned in Parcel Lots: {plannedCoilsSoFar} Coils ({rawOrder.production_lots?.length || 0} Lots)
                          </span>
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-950 font-black text-[10.5px] border border-amber-300">
                            Remaining on Order Sheet: {remainingOrderSheetCoils} Coils ({rawOrder.order_length.toLocaleString()} m)
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Parcel Release Controls */}
                    {remainingOrderSheetCoils > 1 && (
                      <div className="flex flex-wrap items-center gap-1.5 bg-indigo-50/90 px-2.5 py-1.5 rounded-lg border border-indigo-300">
                        <span className="text-[10px] font-black text-indigo-950 uppercase">
                          Give Parcel Coils:
                        </span>
                        <input
                          type="number"
                          min="1"
                          max={remainingOrderSheetCoils}
                          value={parcelCoilsInput}
                          onChange={e => setParcelCoilsInput(e.target.value)}
                          placeholder="e.g. 100"
                          className="w-20 px-2 py-1 rounded border border-indigo-400 bg-white font-black text-indigo-950 text-center text-xs"
                        />
                        <input
                          type="text"
                          value={parcelNotesInput}
                          onChange={e => setParcelNotesInput(e.target.value)}
                          placeholder="Week 1 / Lot Note"
                          className="w-28 px-2 py-1 rounded border border-indigo-300 bg-white font-semibold text-slate-800 text-xs"
                        />
                        <button
                          type="button"
                          onClick={handleReleaseParcelFromProcessCard}
                          className="px-2.5 py-1 rounded bg-indigo-700 hover:bg-indigo-800 text-white font-black text-[11px] cursor-pointer shadow-2xs"
                        >
                          ⚡ Release Parcel Lot ({parcelCoilsInput || 0} Coils)
                        </button>
                      </div>
                    )}

                    {/* Active Parcel Lot Selector */}
                    {hasLots && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10.5px] font-extrabold text-indigo-900 uppercase">
                          Process Card View:
                        </span>
                        <select
                          value={activeVal}
                          onChange={e =>
                            onUpdateOrder({
                              ...rawOrder,
                              active_plan_lot_id: e.target.value,
                            })
                          }
                          className="px-2.5 py-1 rounded border-2 border-indigo-500 bg-white font-black text-indigo-950 text-xs"
                        >
                          {rawOrder.production_lots!.map(lot => (
                            <option key={lot.id} value={lot.id}>
                              Parcel Lot #{lot.lotNo}
                              {lot.notes ? ` (${lot.notes})` : ''}: {lot.coils} Coils × {lot.coil_type} (
                              {lot.order_length.toLocaleString()} m)
                            </option>
                          ))}
                          <option value="REMAINING">
                            ⏳ Remaining Order Sheet Balance ({rawOrder.coils} Coils /{' '}
                            {rawOrder.order_length.toLocaleString()} m)
                          </option>
                          <option value="FULL_ORDER">
                            📋 Full Combined Order ({totalOrderCoils} Coils)
                          </option>
                        </select>
                        <button
                          type="button"
                          onClick={handleResetParcelsFromProcessCard}
                          title="Merge all parcel lots back into a single full order"
                          className="px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-900 border border-rose-300 font-bold text-[10.5px] cursor-pointer"
                        >
                          ↺ Reset Parcels
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live Process Status Synchronization Banner (Serial-Wise Process Rules) */}
      <div className="bg-white border-2 border-emerald-500/70 rounded-xl p-4 shadow-xs space-y-3 no-print">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 font-bold">
              <Activity className="w-4 h-4" />
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-slate-900">
                  Live Process Status Synchronization (Serial-Wise Rules)
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1 border border-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                  Auto-Synced with Order Sheet
                </span>
              </div>
              <p className="text-[11px] text-slate-600">
                {isIs694Card ? (
                  <>
                    🔒 <strong>IS-694 2-Stage Rule (Carton Dispatch — Drum Size N/A):</strong>{' '}
                    <strong>1. Copper Bunching (B)</strong> ➔{' '}
                    <strong>2. IS-694 Insulation &amp; Colour-Wise Coiling (I)</strong> is the <strong>FINAL STAGE</strong>. When Insulation is completed, the order is 100% Done &amp; automatically attached to <strong>Finished Carton Stock</strong>.
                  </>
                ) : (
                  <>
                    🔒 <strong>Serial Process Rule:</strong> 1. Bunching must be completed first ➔ {isCRequired ? '2. Cu Stranding (required for > 6 SQ MM) ➔ ' : '2. Cu Stranding is skipped by rules (≤ 6 SQ MM) ➔ moves directly to '} 3. Insulation ➔ {isTRequired ? '4. Twisting ➔ ' : '4. Twisting skipped (1-Core) ➔ '} 5. Sheathing.
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Batch Progress:</span>
            <div className="flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
              <span className={`font-extrabold ${batchPct === 100 ? 'text-emerald-700' : 'text-slate-900'}`}>
                {batchPct}%
              </span>
              <span className="text-[10px] text-slate-500 font-semibold">
                ({totalStepsCompleted}/{totalStepsTarget} required steps)
              </span>
            </div>
          </div>
        </div>

        {/* Stages Serial Interactive Pipeline (2 Stages for IS-694, 5 Stages for Multi-Core / Standard Cables) */}
        {isIs694Card ? (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* IS-694 Stage 1: B (Copper Bunching) */}
              <div
                onClick={() => toggleAllForCard('b')}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  bDone
                    ? 'bg-emerald-50 border-emerald-400 text-emerald-950 shadow-2xs'
                    : bDoneCount > 0
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-blue-50/70 border-blue-400 text-slate-900 ring-1 ring-blue-400/40 hover:bg-blue-50'
                }`}
                title="Step 1: Click to toggle Copper Bunching stage for IS-694"
              >
                <div className="flex items-center justify-between text-xs font-extrabold mb-1">
                  <span>1. Copper Bunching (B) — Stage 1 of 2</span>
                  <span>{bDone ? '✓ COMPLETED' : bDoneCount > 0 ? '⏳ IN PROGRESS' : '① START'}</span>
                </div>
                <div className="text-[11px] font-semibold">
                  {bDone ? 'Bunching Completed — Ready for IS-694 Insulation' : bDoneCount > 0 ? `${bDoneCount}/${totalCount} Done` : 'Step 1: Complete Copper Bunching First'}
                </div>
                {stageStockSummary && (
                  <div className="mt-1.5 text-[10px] px-2 py-0.5 rounded bg-amber-100/90 text-amber-950 font-extrabold flex items-center justify-between border border-amber-300/70">
                    <span>📦 Raw Cu ({stageStockSummary.strandDia}mm):</span>
                    <span>{stageStockSummary.rawCopperStockKg.toFixed(1)} kg in Stock</span>
                  </div>
                )}
              </div>

              {/* IS-694 Stage 2: I (IS-694 Insulation & Coiling — FINAL STAGE) */}
              <div
                onClick={() => toggleAllForCard('i')}
                className={`p-3 rounded-lg border transition-all ${
                  iDone
                    ? 'bg-emerald-50 border-emerald-400 text-emerald-950 shadow-2xs cursor-pointer'
                    : !isIUnlocked
                    ? 'bg-slate-50 border-dashed border-slate-300 text-slate-400 cursor-not-allowed'
                    : iDoneCount > 0
                    ? 'bg-amber-50 border-amber-300 text-amber-950 cursor-pointer'
                    : 'bg-rose-50/80 border-rose-400 text-rose-950 ring-1 ring-rose-400/40 cursor-pointer'
                }`}
                title={
                  !isIUnlocked
                    ? 'Locked: Complete 1. Copper Bunching (B) first'
                    : 'FINAL STAGE for IS-694: Completing Insulation marks order 100% Done & attaches Coils/Cartons to Finished Stock'
                }
              >
                <div className="flex items-center justify-between text-xs font-extrabold mb-1">
                  <span>2. IS-694 Insulation &amp; Coiling (I) — FINAL STAGE ★</span>
                  <span>{iDone ? '✓ ATTACHED TO STOCK' : !isIUnlocked ? '🔒 LOCKED' : iDoneCount > 0 ? '⏳ IN PROGRESS' : '② FINAL STEP'}</span>
                </div>
                <div className="text-[11px] font-semibold">
                  {iDone
                    ? `Completed & Attached to Finished Carton Stock (${totalIs694Coils > 0 ? `${totalIs694Coils} Coils` : `${reqLen.toLocaleString()} m`})`
                    : !isIUnlocked
                    ? 'Locked (Complete 1. Bunching First)'
                    : iDoneCount > 0
                    ? `${iDoneCount}/${totalCount} Done`
                    : 'Ready — Final Stage (No Cu Stranding, Twisting, Sheathing or Drum Size)'}
                </div>
                {stageStockSummary && (
                  <div className="mt-1.5 text-[10px] px-2 py-0.5 rounded bg-emerald-100/90 text-emerald-950 font-extrabold flex items-center justify-between border border-emerald-300/70">
                    <span>📦 PVC ({stageStockSummary.insCompoundName}) &amp; Bunched:</span>
                    <span>{stageStockSummary.insCompoundStockKg.toFixed(1)} kg PVC • {stageStockSummary.bunchedStockKg.toFixed(1)} kg Cu</span>
                  </div>
                )}
              </div>
            </div>

            {iDone && (
              <div className="p-2.5 rounded-lg bg-emerald-100/90 border border-emerald-400 text-emerald-950 text-xs font-bold flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>
                    ✅ <strong>IS-694 Final Stage (Insulation) Completed:</strong> Order is 100% Complete, packed in Master Cartons (<strong>Drum Size: N/A</strong>), and automatically attached to <strong>Tab 10: Finished Goods Carton Stock</strong>.
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-black uppercase">
                  📦 Attached to Finished Carton Stock
                </span>
              </div>
            )}
          </div>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {/* Stage 1: B (Always First) */}
          <div
            onClick={() => toggleAllForCard('b')}
            className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
              bDone
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950 shadow-2xs'
                : bDoneCount > 0
                ? 'bg-amber-50 border-amber-300 text-amber-950'
                : 'bg-blue-50/70 border-blue-400 text-slate-900 ring-1 ring-blue-400/40 hover:bg-blue-50'
            }`}
            title="Step 1 (Always First): Click to toggle Bunching stage"
          >
            <div className="flex items-center justify-between text-[11px] font-bold mb-1">
              <span>1. Bunching (B)</span>
              <span>{bDone ? '✓' : bDoneCount > 0 ? '⏳' : '①'}</span>
            </div>
            <div className="text-xs font-semibold">
              {bDone ? 'Completed' : bDoneCount > 0 ? `${bDoneCount}/${totalCount} Done` : 'Step 1: Start Here'}
            </div>
            {stageStockSummary && (
              <div className="mt-1.5 text-[9.5px] px-1.5 py-0.5 rounded bg-amber-100/80 text-amber-900 font-extrabold flex items-center justify-between">
                <span>📦 Raw Cu:</span>
                <span>{stageStockSummary.rawCopperStockKg.toFixed(1)} kg ({stageStockSummary.strandDia}mm)</span>
              </div>
            )}
          </div>

          {/* Stage 2: C (Cu Stranding - Only if required by rules > 6 sq mm) */}
          <div
            onClick={() => isCRequired && toggleAllForCard('c')}
            className={`p-2.5 rounded-lg border transition-all ${
              !isCRequired
                ? 'bg-slate-100/80 border-slate-200 text-slate-400 cursor-not-allowed'
                : cDone
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950 shadow-2xs cursor-pointer'
                : !isCUnlocked
                ? 'bg-slate-50 border-dashed border-slate-300 text-slate-400 cursor-not-allowed'
                : cDoneCount > 0
                ? 'bg-amber-50 border-amber-300 text-amber-950 cursor-pointer'
                : 'bg-blue-50/70 border-blue-400 text-slate-900 ring-1 ring-blue-400/40 cursor-pointer'
            }`}
            title={
              !isCRequired
                ? 'Skipped by rules: Conductor ≤ 6 SQ MM moves directly from Bunching to Insulation'
                : !isCUnlocked
                ? 'Locked: Complete 1. Bunching (B) first'
                : 'Click to toggle Cu Stranding stage'
            }
          >
            <div className="flex items-center justify-between text-[11px] font-bold mb-1">
              <span className={!isCRequired ? 'line-through' : ''}>2. Cu Stranding (CS)</span>
              <span>{!isCRequired ? '—' : cDone ? '✓' : !isCUnlocked ? '🔒' : cDoneCount > 0 ? '⏳' : '②'}</span>
            </div>
            <div className="text-[11px] font-semibold">
              {!isCRequired
                ? 'Not Needed (≤ 6 sq mm)'
                : cDone
                ? 'Completed'
                : !isCUnlocked
                ? 'Locked (Do Bunching 1st)'
                : cDoneCount > 0
                ? `${cDoneCount}/${cApplicableOrders.length} Done`
                : 'Ready (Next Step)'}
            </div>
            {stageStockSummary && (
              <div className="mt-1.5 text-[9.5px] px-1.5 py-0.5 rounded bg-blue-100/80 text-blue-900 font-extrabold flex items-center justify-between">
                <span>📦 Bunched:</span>
                <span>{stageStockSummary.bunchedStockKg.toFixed(1)} kg</span>
              </div>
            )}
          </div>

          {/* Stage 3: I (Insulation - Requires Bunching, plus Cu Stranding if > 6 sq mm) */}
          <div
            onClick={() => toggleAllForCard('i')}
            className={`p-2.5 rounded-lg border transition-all ${
              iDone
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950 shadow-2xs cursor-pointer'
                : !isIUnlocked
                ? 'bg-slate-50 border-dashed border-slate-300 text-slate-400 cursor-not-allowed'
                : iDoneCount > 0
                ? 'bg-amber-50 border-amber-300 text-amber-950 cursor-pointer'
                : 'bg-blue-50/70 border-blue-400 text-slate-900 ring-1 ring-blue-400/40 cursor-pointer'
            }`}
            title={
              !isIUnlocked
                ? `Locked: Complete ${!bDone ? '1. Bunching (B)' : '2. Cu Stranding (CS)'} first`
                : 'Click to toggle Insulation stage'
            }
          >
            <div className="flex items-center justify-between text-[11px] font-bold mb-1">
              <span>3. Insulation (I)</span>
              <span>{iDone ? '✓' : !isIUnlocked ? '🔒' : iDoneCount > 0 ? '⏳' : '③'}</span>
            </div>
            <div className="text-[11px] font-semibold">
              {iDone
                ? 'Completed'
                : !isIUnlocked
                ? `Locked (Do ${!bDone ? 'Bunching' : 'Cu Stranding'} 1st)`
                : iDoneCount > 0
                ? `${iDoneCount}/${totalCount} Done`
                : 'Ready (Next Step)'}
            </div>
            {stageStockSummary && (
              <div className="mt-1.5 text-[9.5px] px-1.5 py-0.5 rounded bg-emerald-100/80 text-emerald-900 font-extrabold flex items-center justify-between">
                <span>📦 Compound:</span>
                <span>{stageStockSummary.insCompoundStockKg.toFixed(1)} kg ({stageStockSummary.insCompoundName})</span>
              </div>
            )}
          </div>

          {/* Stage 4: T (Twisting - Only if cores > 1, requires Insulation) */}
          <div
            onClick={() => isTRequired && toggleAllForCard('t')}
            className={`p-2.5 rounded-lg border transition-all ${
              !isTRequired
                ? 'bg-slate-100/80 border-slate-200 text-slate-400 cursor-not-allowed'
                : tDone
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950 shadow-2xs cursor-pointer'
                : !isTUnlocked
                ? 'bg-slate-50 border-dashed border-slate-300 text-slate-400 cursor-not-allowed'
                : tDoneCount > 0
                ? 'bg-amber-50 border-amber-300 text-amber-950 cursor-pointer'
                : 'bg-blue-50/70 border-blue-400 text-slate-900 ring-1 ring-blue-400/40 cursor-pointer'
            }`}
            title={
              !isTRequired
                ? 'Skipped by rules: Single-Core (1C) cable moves directly to Sheathing'
                : !isTUnlocked
                ? 'Locked: Complete 3. Insulation (I) first'
                : 'Click to toggle Twisting stage'
            }
          >
            <div className="flex items-center justify-between text-[11px] font-bold mb-1">
              <span className={!isTRequired ? 'line-through' : ''}>4. Twisting (TS)</span>
              <span>{!isTRequired ? '—' : tDone ? '✓' : !isTUnlocked ? '🔒' : tDoneCount > 0 ? '⏳' : '④'}</span>
            </div>
            <div className="text-[11px] font-semibold">
              {!isTRequired
                ? 'Not Needed (1-Core)'
                : tDone
                ? 'Completed'
                : !isTUnlocked
                ? 'Locked (Do Insulation 1st)'
                : tDoneCount > 0
                ? `${tDoneCount}/${tApplicableOrders.length} Done`
                : 'Ready (Next Step)'}
            </div>
            {stageStockSummary && (
              <div className="mt-1.5 text-[9.5px] px-1.5 py-0.5 rounded bg-indigo-100/80 text-indigo-900 font-extrabold flex items-center justify-between">
                <span>📦 In Stock:</span>
                <span>{stageStockSummary.coresStockMtrs.toLocaleString()} m Cores</span>
              </div>
            )}
          </div>

          {/* Stage 5: S (Sheathing - Requires Twisting if multi-core, else Insulation) */}
          <div
            onClick={() => isSRequired && toggleAllForCard('s')}
            className={`p-2.5 rounded-lg border transition-all ${
              !isSRequired
                ? 'bg-slate-100/80 border-slate-200 text-slate-400 cursor-not-allowed'
                : sDone
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950 shadow-2xs cursor-pointer'
                : !isSUnlocked
                ? 'bg-slate-50 border-dashed border-slate-300 text-slate-400 cursor-not-allowed'
                : sDoneCount > 0
                ? 'bg-amber-50 border-amber-300 text-amber-950 cursor-pointer'
                : 'bg-blue-50/70 border-blue-400 text-slate-900 ring-1 ring-blue-400/40 cursor-pointer'
            }`}
            title={
              !isSRequired
                ? 'Not required for unsheathed cable'
                : !isSUnlocked
                ? `Locked: Complete ${isTRequired ? '4. Twisting (TS)' : '3. Insulation (I)'} first`
                : 'Click to toggle Sheathing stage'
            }
          >
            <div className="flex items-center justify-between text-[11px] font-bold mb-1">
              <span className={!isSRequired ? 'line-through' : ''}>5. Sheathing (SH)</span>
              <span>{!isSRequired ? '—' : sDone ? '✓' : !isSUnlocked ? '🔒' : sDoneCount > 0 ? '⏳' : '⑤'}</span>
            </div>
            <div className="text-[11px] font-semibold">
              {!isSRequired
                ? 'Not Needed (Unsheathed)'
                : sDone
                ? 'Completed'
                : !isSUnlocked
                ? `Locked (Do ${isTRequired ? 'Twisting' : 'Insulation'} 1st)`
                : sDoneCount > 0
                ? `${sDoneCount}/${sApplicableOrders.length} Done`
                : 'Ready (Next Step)'}
            </div>
            {stageStockSummary && (
              <div className="mt-1.5 text-[9.5px] px-1.5 py-0.5 rounded bg-rose-100/80 text-rose-900 font-extrabold flex items-center justify-between">
                <span>📦 Sheath:</span>
                <span>{stageStockSummary.sheathCompStockKg.toFixed(1)} kg • {stageStockSummary.drumStockNos} Dr</span>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* 1. COPPER BUNCHING */}
      {(printStageFilter === 'ALL' || printStageFilter === 'b') && (
      <div className="border-2 border-slate-800 rounded-lg bg-white overflow-hidden shadow-xs print-card">
        {renderPrintStageSheetHeader('STAGE 1: COPPER BUNCHING PROCESS', getStagePageNumber('b'), totalStagePages)}
        <div className="bg-slate-800 text-white p-3 font-bold text-sm flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span>1. PROCESS CARD FOR COPPER BUNCHING</span>
            {renderStageBadge('BUNCHING', bDone, bDoneCount, totalCount, isBUnlocked)}
            <button
              onClick={() => toggleAllForCard('b')}
              className={`text-xs px-2.5 py-1 rounded font-bold no-print transition-all flex items-center gap-1 cursor-pointer ${
                bDone
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs'
                  : 'bg-slate-200 text-slate-800 hover:bg-slate-300'
              }`}
              title="Toggle Bunching completion for all orders in this card"
            >
              {bDone ? '✓ All Done' : '⏳ Mark Done'}
            </button>
            <button
              type="button"
              onClick={() => handlePrintStage('b')}
              className="text-xs px-2.5 py-1 rounded font-bold bg-blue-600 hover:bg-blue-500 text-white no-print flex items-center gap-1 cursor-pointer"
              title="Print only Stage 1 (Bunching) on a single page"
            >
              <Printer className="w-3 h-3" /> Print Stage 1
            </button>
          </div>
          <div className="flex items-center gap-3">
            {renderOfficialStamp('BUNCHING', bDone, bDoneCount, totalCount)}
            {renderCardDateHeader()}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 p-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
          <div><strong>BATCH NO:</strong> {batch}</div>
          <div><strong>BRAND:</strong> {brand}</div>
          <div><strong>SIZE:</strong> {first.size}</div>
          <div className="sm:col-span-4">
            <strong>BBN NO ({totalLots} Bobbins):</strong>{' '}
            <span className="text-blue-700 font-semibold">{bbnString || '-'}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-gradient-to-r from-slate-50 to-amber-50/40 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-xs text-slate-800">
              ⚡ Copper Bunching Requisition Status:
            </span>
            {bDone ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-400 flex items-center gap-1 shadow-2xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>BUNCHED &amp; AUTO-DEDUCTED FROM ACTIVE REQUISITION</span>
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-100 text-amber-950 border border-amber-400 flex items-center gap-1 shadow-2xs">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <span>REQUISITION HAVE TO BUNCH: {fmtExact(totalWt, 2)} kg</span>
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500 font-semibold no-print">
            {bDone ? '✓ Auto-deducted from Tab 9 Requisition' : '⏳ Pending to bunch on Tab 9 Requisition'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-2.5 border-r border-slate-200">NO OF CONDUCTORS & DIA</th>
                <th className="p-2.5 border-r border-slate-200">REQUIRED QTY (MTRS)</th>
                <th className="p-2.5 border-r border-slate-200 text-right">TOTAL CORE LENGTH (M)</th>
                <th className="p-2.5 border-r border-slate-200 text-right">LAY LENGTH (RECORD)</th>
                <th className="p-2.5 border-r border-slate-200">WEIGHT REQUIRED (KG)</th>
                <th className="p-2.5 border-r border-slate-200 text-right">TOTAL CU WT (KG)</th>
                <th className="p-2.5 border-r border-slate-200 text-right bg-amber-50">REQUISITION TO BUNCH</th>
                <th className="p-2.5 text-right">SCRAP (0.15%)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2.5 border-r border-slate-100 font-bold">{condDisplay}</td>
                <td className="p-2.5 border-r border-slate-100 font-bold">{reqQtyText}</td>
                <td className="p-2.5 border-r border-slate-100 text-right font-semibold">{reqLen.toLocaleString()} m</td>
                <td className="p-2.5 border-r border-slate-100 text-right font-bold">{bunchLayDisplay}</td>
                <td className="p-2.5 border-r border-slate-100 font-bold">{reqWtText}</td>
                <td className="p-2.5 border-r border-slate-100 text-right font-bold text-slate-900">{fmtExact(totalWt, 4)} kg</td>
                <td className="p-2.5 border-r border-slate-100 text-right font-bold bg-amber-50/60">
                  {bDone ? (
                    <span className="text-emerald-700 font-bold">✓ 0.00 kg (Deducted)</span>
                  ) : (
                    <span className="text-amber-950 font-black">{fmtExact(totalWt, 2)} kg</span>
                  )}
                </td>
                <td className="p-2.5 text-right text-slate-600">{fmtExact(bunchScrap, 6)} kg</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Purchased Bunched Copper Stock & Auto-Deduction Stage Conversion (Hidden in Print) */}
        <div className="p-3.5 bg-gradient-to-r from-indigo-50/80 via-purple-50/60 to-emerald-50/80 border-t border-indigo-200 no-print">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-600 text-white font-bold shadow-2xs">
                <Zap className="w-4 h-4" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-extrabold text-indigo-950 uppercase tracking-wide">
                    Purchased Bunched Copper Ability & Stage Conversion
                  </h4>
                  <span className="text-[10px] px-2 py-0.2 rounded-full font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">
                    Conductor: {first.conductor}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600">
                  When copper is purchased in bunch stage, verify available stock below. Allocating it auto-deducts from raw purchases and converts it directly into bunch stage stock.
                </p>
              </div>
            </div>

            {/* Stock Ability Status Indicator */}
            <div>
              {totalAvailableBunchedStock >= totalWt ? (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-lg font-bold text-xs shadow-2xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Sufficient Bunched Stock Available ({totalAvailableBunchedStock.toFixed(2)} kg in stock / {totalWt.toFixed(2)} kg req)</span>
                </div>
              ) : totalAvailableBunchedStock > 0 ? (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg font-bold text-xs shadow-2xs">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <span>Partial Bunched Stock: {totalAvailableBunchedStock.toFixed(2)} kg Available ({totalWt.toFixed(2)} kg required)</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-600 border border-slate-300 rounded-lg font-semibold text-xs">
                  <span>⚪ No Purchased Bunched Stock for {first.conductor} (In-House Bunching Required)</span>
                </div>
              )}
            </div>
          </div>

          {/* Matching Bunch Stage Purchases List & Action Buttons */}
          {bunchStagePurchases.length > 0 ? (
            <div className="space-y-2 mt-2">
              <div className="text-[10.5px] font-bold text-indigo-900 uppercase tracking-tight">
                Available Invoices / Lots in Bunch Stage:
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {bunchStagePurchases.map(p => {
                  const used = p.usedQty || 0;
                  const available = Math.max(0, p.qty - used);
                  const isFullyAllocatedToThisCard = matchingOrders.every(
                    o => o.bunch_source === 'purchased_stock' && o.purchased_copper_id === p.id
                  );

                  return (
                    <div
                      key={p.id}
                      className={`p-2.5 rounded-lg border flex flex-col justify-between gap-2 transition-all ${
                        isFullyAllocatedToThisCard
                          ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-500/20'
                          : available >= totalWt
                          ? 'bg-white border-indigo-200 shadow-2xs'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                            <span className="font-mono text-indigo-700">{p.invoice}</span>
                            <span>•</span>
                            <span>{p.party}</span>
                          </div>
                          <div className="text-[11px] text-slate-600 font-medium">
                            {p.description} {p.conductor ? `[${p.conductor}]` : ''}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-xs font-extrabold text-emerald-700">
                            {available.toFixed(2)} kg free
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Total: {p.qty.toFixed(2)} kg (Used: {used.toFixed(2)} kg)
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                        {isFullyAllocatedToThisCard ? (
                          <div className="flex items-center justify-between w-full">
                            <span className="text-[11px] font-bold text-emerald-800 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Allocated & Converted to Bunched Stage Stock (+{matchingOrders.reduce((s, o) => s + (o.purchased_copper_deducted_qty || 0), 0).toFixed(2)} kg)</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                matchingOrders.forEach(o => {
                                  if (onRevertBunchedCopper && o.purchased_copper_id === p.id) {
                                    onRevertBunchedCopper(o.id);
                                  }
                                });
                              }}
                              className="text-[11px] px-2 py-0.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded font-semibold cursor-pointer"
                              title="Return deducted copper back to raw purchase inventory"
                            >
                              ↩ Revert to Raw
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between w-full">
                            <span className="text-[10.5px] text-slate-500 font-medium">
                              Card Needs: <strong className="text-slate-800">{totalWt.toFixed(2)} kg</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                matchingOrders.forEach(o => {
                                  if (onUseBunchedCopper) {
                                    onUseBunchedCopper(o.id, p.id);
                                  }
                                });
                              }}
                              className={`text-[11px] px-3 py-1 rounded font-bold transition-all flex items-center gap-1 cursor-pointer shadow-2xs ${
                                available >= totalWt
                                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                  : 'bg-amber-600 hover:bg-amber-700 text-white'
                              }`}
                              title="Auto-deduct copper from this purchase and convert to bunch stage stock"
                            >
                              <Zap className="w-3.5 h-3.5" />
                              <span>Use & Auto-Deduct ({Math.min(available, totalWt).toFixed(2)} kg)</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-2 p-2.5 bg-white/70 border border-indigo-200 rounded-lg text-xs text-slate-600">
              💡 To purchase copper in bunch stage, go to <strong>Tab 7: Raw Material Purchases</strong> and record an invoice with Stage set to <em>'⚡ Bunch Stage'</em> and Conductor <em>'{first.conductor}'</em>.
            </div>
          )}
        </div>

        {/* Individual Order Process Status Breakdown (Hidden in Print) */}
        <div className="p-2.5 bg-slate-50 border-t border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2 no-print">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-700 text-[11px] uppercase">Orders in this bunching card:</span>
            {matchingOrders.map(m => {
              const isPurchasedStock = m.bunch_source === 'purchased_stock';
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onToggleProcess(m.id, 'b')}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                    m.pStatus?.b
                      ? isPurchasedStock
                        ? 'bg-indigo-100 text-indigo-900 border border-indigo-300 hover:bg-indigo-200'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200'
                      : 'bg-slate-200 text-slate-700 border border-slate-300 hover:bg-slate-300'
                  }`}
                  title={isPurchasedStock ? `Converted from Purchased Bunched Stock (${m.purchased_copper_deducted_qty?.toFixed(1)} kg)` : 'Click to toggle Bunching status'}
                >
                  {m.pStatus?.b ? (isPurchasedStock ? '⚡' : '✓') : '⏳'} {m.cores}C × {m.size}: {m.pStatus?.b ? (isPurchasedStock ? 'Purchased Bunch Stock (Done)' : 'Bunching Done') : 'Pending'}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] text-slate-500 italic">
            ⚡ Automatically synced with Active Order Sheet
          </span>
        </div>
        {renderPrintStageSheetFooter('STAGE 1: COPPER BUNCHING')}
      </div>
      )}

      {/* 2. COPPER STRANDING (≥ 10 SQ MM — Not applicable for IS-694) */}
      {!isIs694Card && sizeNum > 6 && (printStageFilter === 'ALL' || printStageFilter === 'c') && (
        <div className="border-2 border-slate-700 rounded-lg bg-white overflow-hidden shadow-xs print-card">
          {renderPrintStageSheetHeader('STAGE 2: COPPER STRANDING (LADI)', getStagePageNumber('c'), totalStagePages)}
          <div className="bg-slate-700 text-white p-3 font-bold text-sm flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span>2. PROCESS CARD FOR COPPER STRANDING (LADI STRANDING ≥ 10 SQ MM)</span>
              {renderStageBadge('CU STRANDING', cDone, cDoneCount, cApplicableOrders.length, isCUnlocked, '1. BUNCHING')}
              <button
                onClick={() => toggleAllForCard('c')}
                className={`text-xs px-2.5 py-1 rounded font-bold no-print transition-all flex items-center gap-1 ${
                  cDone
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer'
                    : isCUnlocked
                    ? 'bg-slate-200 text-slate-800 hover:bg-slate-300 cursor-pointer'
                    : 'bg-slate-900/60 text-slate-400 border border-slate-500 cursor-not-allowed'
                }`}
              >
                {cDone ? '✓ All Done' : isCUnlocked ? '⏳ Mark Done' : '🔒 Do Bunching 1st'}
              </button>
              <button
                type="button"
                onClick={() => handlePrintStage('c')}
                className="text-xs px-2.5 py-1 rounded font-bold bg-blue-600 hover:bg-blue-500 text-white no-print flex items-center gap-1 cursor-pointer"
                title="Print only Stage 2 (Cu Stranding) on a single page"
              >
                <Printer className="w-3 h-3" /> Print Stage 2
              </button>
            </div>
            <div className="flex items-center gap-3">
              {renderOfficialStamp('CU STRANDING', cDone, cDoneCount, cApplicableOrders.length)}
              {renderCardDateHeader()}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-gradient-to-r from-slate-50 to-blue-50/40 border-b border-slate-200">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold text-xs text-slate-800">
                ⚡ Cu Stranding Requisition Status:
              </span>
              {cDone ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-400 flex items-center gap-1 shadow-2xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>STRANDED &amp; AUTO-DEDUCTED FROM ACTIVE REQUISITION</span>
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-100 text-blue-950 border border-blue-400 flex items-center gap-1 shadow-2xs">
                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                  <span>REQUISITION HAVE TO STRAND: {reqLen.toLocaleString()} m ({fmtExact(totalWt, 2)} kg)</span>
                </span>
              )}
            </div>
            <span className="text-[11px] text-slate-500 font-semibold no-print">
              {cDone ? '✓ Auto-deducted from Active Process Requisition' : '⏳ Pending to strand on Cu Stranding Requisition'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                <tr>
                  <th className="p-2.5 border-r border-slate-200">SIZE</th>
                  <th className="p-2.5 border-r border-slate-200">CONDUCTOR SIZE</th>
                  <th className="p-2.5 border-r border-slate-200">BBN SEQUENCE (LADI)</th>
                  <th className="p-2.5 border-r border-slate-200 text-right">BUNCH DIA (RECORD)</th>
                  <th className="p-2.5 border-r border-slate-200 text-right">REQUIRED LENGTH (M)</th>
                  <th className="p-2.5 border-r border-slate-200 text-right">LAY LENGTH (RECORD)</th>
                  <th className="p-2.5 border-r border-slate-200 text-right">WEIGHT REQUIRED (KG)</th>
                  <th className="p-2.5 border-r border-slate-200 text-right bg-blue-50 text-blue-950">REQUISITION TO STRAND</th>
                  <th className="p-2.5 border-r border-slate-200 text-right">SCRAP (0.20%)</th>
                  <th className="p-2.5 text-center">STATUS</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-2.5 border-r border-slate-100 font-bold">{first.size}</td>
                  <td className="p-2.5 border-r border-slate-100">{first.conductor}</td>
                  <td className="p-2.5 border-r border-slate-100 font-bold text-blue-700">{first.ladiPattern || '-'}</td>
                  <td className="p-2.5 border-r border-slate-100 text-right">{fmtExact(first.bunchDia, 6)}</td>
                  <td className="p-2.5 border-r border-slate-100 text-right font-bold">{reqLen.toLocaleString()} m</td>
                  <td className="p-2.5 border-r border-slate-100 text-right font-bold">{fmtExact(first.bunchLay, 6)}</td>
                  <td className="p-2.5 border-r border-slate-100 text-right font-bold text-slate-900">{fmtExact(totalWt, 4)} kg</td>
                  <td className="p-2.5 border-r border-slate-100 text-right font-bold bg-blue-50/60">
                    {cDone ? (
                      <span className="text-emerald-700 font-bold">✓ 0 m (Deducted)</span>
                    ) : (
                      <span className="text-blue-950 font-black">{reqLen.toLocaleString()} m ({fmtExact(totalWt, 2)} kg)</span>
                    )}
                  </td>
                  <td className="p-2.5 border-r border-slate-100 text-right text-slate-600">{fmtExact(totalWt * 0.002, 4)} kg</td>
                  <td className="p-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => toggleAllForCard('c')}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all inline-flex items-center gap-1 ${
                        cDone
                          ? 'bg-emerald-600 text-white shadow-2xs cursor-pointer'
                          : isCUnlocked
                          ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer'
                          : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300 cursor-not-allowed'
                      }`}
                    >
                      {cDone ? '✓ Stranding Done' : isCUnlocked ? '⏳ Pending' : '🔒 Complete Bunching 1st'}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {renderPrintStageSheetFooter('STAGE 2: COPPER STRANDING (LADI)')}
        </div>
      )}

      {/* 2. SPECIAL IS-694 PROCESS CARD AFTER BUNCHING (FINAL STAGE — ATTACHES TO FINISHED CARTON STOCK) */}
      {(printStageFilter === 'ALL' || printStageFilter === 'i') && isIs694Card && (
        <div className="border-2 border-rose-800 rounded-lg bg-white overflow-hidden shadow-sm print-card">
          {renderPrintStageSheetHeader('STAGE 2 (FINAL STAGE): SPECIAL IS-694 INSULATION & COLOUR-WISE COILING PROCESS CARD', getStagePageNumber('i'), totalStagePages)}
          <div className="bg-rose-900 text-white p-3 font-bold text-sm flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span>
                2. SPECIAL PROCESS CARD FOR IS-694 GRADE (FINAL STAGE AFTER BUNCHING — INSULATION &amp; COLOUR-WISE COILING)
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[10.5px] font-black uppercase">
                ★ FINAL STAGE • CARTON PACK (DRUM SIZE N/A)
              </span>
              {renderStageBadge('IS-694 INSULATION (FINAL STAGE)', iDone, iDoneCount, totalCount, isIUnlocked, '1. BUNCHING')}
              <button
                onClick={() => toggleAllForCard('i')}
                className={`text-xs px-2.5 py-1 rounded font-bold no-print transition-all flex items-center gap-1 ${
                  iDone
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer'
                    : isIUnlocked
                    ? 'bg-slate-200 text-slate-800 hover:bg-slate-300 cursor-pointer'
                    : 'bg-rose-950/60 text-slate-300 border border-rose-600 cursor-not-allowed'
                }`}
              >
                {iDone ? '✓ Completed & Attached to Stock' : isIUnlocked ? '⏳ Mark Final Stage Done (Attach to Stock)' : '🔒 Do Bunching 1st'}
              </button>
              <button
                type="button"
                onClick={() => handlePrintStage('i')}
                className="text-xs px-2.5 py-1 rounded font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 no-print flex items-center gap-1 cursor-pointer shadow-2xs"
                title="Print Special IS-694 Process Card on a single page"
              >
                <Printer className="w-3 h-3" /> Print Special IS-694 Card
              </button>
            </div>
            <div className="flex items-center gap-3">
              {renderOfficialStamp('IS-694 INSULATION', iDone, iDoneCount, totalCount)}
              {renderCardDateHeader()}
            </div>
          </div>

          {/* Highlighted Mandatory IS-694 Header Fields */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5 p-3 bg-rose-50/70 border-b border-rose-200 text-xs text-slate-800">
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">JOB NO</span>
              <span className="font-black text-sm text-rose-950">{batch}</span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">GRADE</span>
              <span className="font-black text-sm text-rose-800">{first.grade || 'IS-694'}</span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">CORE OD (PVC OD)</span>
              <span className="font-black text-sm text-teal-800">{fmtExact(first.coreOd, 4)} mm</span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">INSULATION COMPOUND</span>
              <span className="font-black text-sm text-slate-900">{first.ins_compound}</span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">REQ. INSULATION COMPOUND</span>
              <span className="font-black text-sm text-rose-700">{fmtExact(totalInsWt, 2)} kg</span>
            </div>
            <div className="bg-white p-2 rounded border border-rose-200">
              <span className="block text-[10px] font-bold text-slate-500 uppercase">TOTAL COILS (COLOUR-WISE)</span>
              <span className="font-black text-sm text-amber-800">
                {totalIs694Coils > 0 ? `${totalIs694Coils} Coils` : `${reqLen.toLocaleString()} m`}
              </span>
            </div>
            <div><strong>BRAND:</strong> {brand}</div>
            <div><strong>CABLE SIZE:</strong> {first.size} ({first.conductor})</div>
            <div><strong>BUNCH DIA:</strong> {fmtExact(first.bunchDia, 4)} mm</div>
            <div><strong>NOZZLE:</strong> <span className="text-teal-700 font-bold">{fmtExact(first.nozzle, 4)} mm</span></div>
            <div><strong>INS. DIE:</strong> <span className="text-teal-700 font-bold">{fmtExact(first.insDie, 4)} mm</span></div>
            <div><strong>BUNCHED CU SPOOL:</strong> {bbnString}</div>
          </div>

          {/* IS-694 Step-Wise Requisition Status Banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-gradient-to-r from-rose-50 to-teal-50/40 border-b border-rose-200">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold text-xs text-rose-950">
                ⚡ IS-694 Insulation &amp; Coiling Requisition Status:
              </span>
              {iDone ? (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-400 flex items-center gap-1 shadow-2xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>INSULATED &amp; AUTO-DEDUCTED FROM PVC &amp; CARTON REQUISITION</span>
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-100 text-amber-950 border border-amber-400 flex items-center gap-1 shadow-2xs">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>
                    REQUISITION HAVE TO INSULATE: {fmtExact(matchingOrders.filter(m => !m.pStatus?.i).reduce((s, m) => s + m.reqIns, 0), 2)} kg PVC ({matchingOrders.filter(m => !m.pStatus?.i).reduce((s, m) => s + m.orderLen, 0).toLocaleString()} m)
                  </span>
                </span>
              )}
            </div>
            <span className="text-[11px] text-slate-500 font-semibold no-print">
              {iDone ? '✓ Auto-deducted from Tab 8 PVC Requisition' : '⏳ Pending to extrude on Tab 8 PVC Requisition'}
            </span>
          </div>

          {/* Order-Sheet Colour-Wise Coiling & Insulation Schedule */}
          <div className="p-3 bg-white">
            <div className="text-xs font-black uppercase text-rose-950 mb-2 flex items-center justify-between flex-wrap gap-1">
              <span>1. IS-694 Order-Sheet Insulation &amp; Colour-Wise Coiling Details (After Bunching)</span>
              <span className="text-[11px] font-bold text-slate-600">
                Includes Blank Columns for Operator to List Out Production Details (Coils Produced, Actual Mtrs, PVC Wt &amp; Sign)
              </span>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-800 font-bold uppercase text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-2 border-r border-slate-200">JOB NO</th>
                    <th className="p-2 border-r border-slate-200">GRADE</th>
                    <th className="p-2 border-r border-slate-200">SIZE &amp; COND.</th>
                    <th className="p-2 border-r border-slate-200 bg-rose-50 text-rose-950">COLOUR (INSULATION)</th>
                    <th className="p-2 border-r border-slate-200 text-right">CORE OD (MM)</th>
                    <th className="p-2 border-r border-slate-200 text-right">DIE / NOZZLE</th>
                    <th className="p-2 border-r border-slate-200">INS. COMPOUND</th>
                    <th className="p-2 border-r border-slate-200 text-right bg-teal-50 text-teal-950">REQ. PVC (KG)</th>
                    <th className="p-2 border-r border-slate-200 text-right bg-amber-50 text-amber-950">REQUISITION TO INSULATE</th>
                    <th className="p-2 border-r border-slate-200 text-center bg-amber-50 text-amber-950">COILING DETAILS (COLOUR-WISE)</th>
                    <th className="p-2 border-r border-slate-200 text-right">ORDER LEN (M)</th>
                    <th className="p-2 border-r border-slate-300 bg-yellow-50/90 text-slate-900 text-center min-w-[115px]">
                      DATE / SHIFT &amp; M/C NO. (OPERATOR)
                    </th>
                    <th className="p-2 border-r border-slate-300 bg-yellow-50/90 text-slate-900 text-center min-w-[130px]">
                      ACTUAL COILS PRODUCED (OPERATOR)
                    </th>
                    <th className="p-2 border-r border-slate-300 bg-yellow-50/90 text-slate-900 text-center min-w-[130px]">
                      ACTUAL MTR / PVC WT (OPERATOR)
                    </th>
                    <th className="p-2 border-r border-slate-300 bg-yellow-50/90 text-slate-900 text-center min-w-[125px]">
                      OPERATOR SIGN &amp; REMARKS
                    </th>
                    <th className="p-2 text-center no-print">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {is694OrderColourRows.map(({ order: m, item, rowKey }) => {
                    const lock = getStageLockState(m, 'i', ladiDimensions);
                    return (
                      <tr key={rowKey} className="hover:bg-rose-50/30">
                        <td className="p-2 border-r border-slate-100 font-black text-slate-900">{m.batch}</td>
                        <td className="p-2 border-r border-slate-100 font-extrabold text-rose-800">{m.grade || 'IS-694'}</td>
                        <td className="p-2 border-r border-slate-100">
                          <div className="font-bold text-slate-900">{m.size}</div>
                          <div className="text-[10px] font-mono text-slate-500">{m.conductor}</div>
                        </td>
                        <td className="p-2 border-r border-slate-100 bg-rose-50/40">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-rose-100 text-rose-950 border border-rose-300 font-black text-xs">
                            🎨 {item.colour}
                          </span>
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-black text-teal-800">
                          {fmtExact(m.coreOd, 4)} mm
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-mono text-[11px] text-slate-700">
                          Die: {fmtExact(m.insDie, 4)} / Noz: {fmtExact(m.nozzle, 4)}
                        </td>
                        <td className="p-2 border-r border-slate-100 font-bold text-slate-900">{m.ins_compound}</td>
                        <td className="p-2 border-r border-slate-100 text-right font-black text-teal-900 bg-teal-50/40">
                          {fmtExact(item.reqInsKg, 2)} kg
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-black bg-amber-50/50">
                          {m.pStatus?.i ? (
                            <span className="text-emerald-700 font-bold">✓ 0 kg (Deducted)</span>
                          ) : (
                            <span className="text-amber-950 font-black">{fmtExact(item.reqInsKg, 2)} kg</span>
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-center bg-amber-50/40">
                          {item.coils > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-950 border border-amber-300 font-black text-xs">
                              {item.coils} Coils × {item.coilType} ({item.colour})
                            </span>
                          ) : (
                            <span className="font-bold text-slate-700">
                              {item.orderLenM.toLocaleString()} m ({item.colour})
                            </span>
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right">
                          <div className="font-bold text-slate-900">{item.orderLenM.toLocaleString()} m</div>
                        </td>
                        {/* Blank Operator Production Columns */}
                        <td className="p-2 border-r border-slate-300 bg-white min-w-[115px] h-9 align-bottom">
                          <div className="border-b border-dotted border-slate-300 w-full h-5" />
                        </td>
                        <td className="p-2 border-r border-slate-300 bg-white min-w-[130px] h-9 align-bottom">
                          <div className="border-b border-dotted border-slate-300 w-full h-5" />
                        </td>
                        <td className="p-2 border-r border-slate-300 bg-white min-w-[130px] h-9 align-bottom">
                          <div className="border-b border-dotted border-slate-300 w-full h-5" />
                        </td>
                        <td className="p-2 border-r border-slate-300 bg-white min-w-[125px] h-9 align-bottom">
                          <div className="border-b border-dotted border-slate-300 w-full h-5" />
                        </td>
                        <td className="p-2 text-center no-print">
                          <button
                            type="button"
                            onClick={() => onToggleProcess(m.id, 'i')}
                            className={`px-2 py-1 rounded text-[10px] font-bold transition-all inline-flex items-center gap-1 ${
                              m.pStatus?.i
                                ? 'bg-emerald-600 text-white shadow-2xs cursor-pointer'
                                : lock.isUnlocked
                                ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer'
                                : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300 cursor-not-allowed'
                            }`}
                          >
                            {m.pStatus?.i ? '✓ Done' : lock.isUnlocked ? '⏳ Pending' : '🔒 Locked'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300">
                  <tr>
                    <td colSpan={7} className="p-2 border-r border-slate-200 text-right uppercase">
                      TOTAL IS-694 INSULATION &amp; COILING SUMMARY (JOB NO: {batch}):
                    </td>
                    <td className="p-2 border-r border-slate-200 text-right text-teal-900 bg-teal-100/70">
                      {fmtExact(totalInsWt, 2)} kg
                    </td>
                    <td className="p-2 border-r border-slate-200 text-right text-amber-950 bg-amber-100/70">
                      {iDone ? '✓ 0.00 kg' : `${fmtExact(matchingOrders.filter(m => !m.pStatus?.i).reduce((s, m) => s + m.reqIns, 0), 2)} kg`}
                    </td>
                    <td className="p-2 border-r border-slate-200 text-center text-amber-950 bg-amber-100/70">
                      {totalIs694Coils > 0 ? `${totalIs694Coils} Total Coils` : '-'}
                    </td>
                    <td className="p-2 border-r border-slate-200 text-right">
                      {matchingOrders.reduce((s, m) => s + m.orderLen, 0).toLocaleString()} m
                    </td>
                    <td className="p-2 border-r border-slate-300 bg-white" />
                    <td className="p-2 border-r border-slate-300 bg-white" />
                    <td className="p-2 border-r border-slate-300 bg-white" />
                    <td className="p-2 border-r border-slate-300 bg-white" />
                    <td className="p-2 text-center no-print">
                      {iDone ? '✓ COMPLETED' : 'IN PROGRESS'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Consolidated Colour-Wise Coiling Summary Table */}
            <div className="mt-4">
              <div className="text-xs font-black uppercase text-slate-800 mb-1.5 flex items-center justify-between flex-wrap gap-1">
                <span>2. Consolidated Colour-Wise Coils &amp; Required Insulation Compound Summary</span>
                <span className="text-[10.5px] font-bold text-slate-600">
                  Blank columns on right for Operator to record colour-wise coils &amp; carton output
                </span>
              </div>
              <div className="overflow-x-auto border border-rose-200 rounded">
                <table className="w-full text-xs text-left">
                  <thead className="bg-rose-50 text-rose-950 font-bold uppercase text-[11px] border-b border-rose-200">
                    <tr>
                      <th className="p-2 border-r border-rose-200">INSULATION COLOUR</th>
                      <th className="p-2 border-r border-rose-200">GRADE</th>
                      <th className="p-2 border-r border-rose-200 text-right">CORE OD</th>
                      <th className="p-2 border-r border-rose-200">INSULATION COMPOUND</th>
                      <th className="p-2 border-r border-rose-200 text-center">PLANNED COILS (COLOUR-WISE)</th>
                      <th className="p-2 border-r border-rose-200 text-center">COIL LENGTH OPTION</th>
                      <th className="p-2 border-r border-rose-200 text-right">ORDER LENGTH (M)</th>
                      <th className="p-2 border-r border-rose-200 text-right">REQ. INSULATION COMPOUND (KG)</th>
                      <th className="p-2 border-r border-rose-200 bg-yellow-50/90 text-slate-900 text-center min-w-[135px]">
                        OPERATOR ACTUAL COILS PRODUCED
                      </th>
                      <th className="p-2 border-r border-rose-200 bg-yellow-50/90 text-slate-900 text-center min-w-[135px]">
                        OPERATOR CARTONS PACKED
                      </th>
                      <th className="p-2 bg-yellow-50/90 text-slate-900 text-center min-w-[150px]">
                        OPERATOR PRODUCTION DETAILS / REMARKS
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-100">
                    {is694ConsolidatedColours.map(row => (
                      <tr key={row.colour} className="hover:bg-rose-50/40">
                        <td className="p-2 border-r border-rose-100 font-black text-rose-950">
                          🎨 {row.colour}
                        </td>
                        <td className="p-2 border-r border-rose-100 font-bold">{row.grade}</td>
                        <td className="p-2 border-r border-rose-100 text-right font-bold">{fmtExact(row.coreOd, 4)} mm</td>
                        <td className="p-2 border-r border-rose-100 font-semibold">{row.insCompound}</td>
                        <td className="p-2 border-r border-rose-100 text-center font-black text-amber-900">
                          {row.coils > 0 ? `${row.coils} Coils` : '-'}
                        </td>
                        <td className="p-2 border-r border-rose-100 text-center font-bold text-slate-700">
                          {Array.from(row.coilOptionsSet).join(', ') || '-'}
                        </td>
                        <td className="p-2 border-r border-rose-100 text-right font-bold">{row.orderLenM.toLocaleString()} m</td>
                        <td className="p-2 border-r border-rose-100 text-right font-black text-teal-800">{fmtExact(row.reqInsKg, 2)} kg</td>
                        <td className="p-2 border-r border-rose-200 bg-white min-w-[135px] h-8" />
                        <td className="p-2 border-r border-rose-200 bg-white min-w-[135px] h-8" />
                        <td className="p-2 bg-white min-w-[150px] h-8" />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 3: Interactive Operator Production Log (Editable Rows -> Auto-Updates Main IS-694 Packing Inventory) */}
            <div className="mt-4">
              {matchingOrders.map(m => {
                const rawOrder = orders.find(o => o.id === m.id) || m;
                const hasLots = Boolean(rawOrder.production_lots && rawOrder.production_lots.length > 0);
                const activeLotId =
                  hasLots &&
                  rawOrder.active_plan_lot_id &&
                  rawOrder.active_plan_lot_id !== 'REMAINING' &&
                  rawOrder.active_plan_lot_id !== 'FULL_ORDER'
                    ? rawOrder.active_plan_lot_id
                    : hasLots
                    ? rawOrder.production_lots![rawOrder.production_lots!.length - 1].id
                    : undefined;
                const activeLot =
                  activeLotId && rawOrder.production_lots
                    ? rawOrder.production_lots.find(l => l.id === activeLotId)
                    : undefined;

                const currentLogs: Is694OperatorLogEntry[] =
                  (activeLot ? activeLot.operator_production_logs : rawOrder.operator_production_logs) || [];

                const vihanRules = loadVihanTriguardCartonRules();
                const maruRules = loadMaruMiracleCartonRules();
                const coilType = (activeLot ? activeLot.coil_type : rawOrder.coil_type) || '90 MTR';
                const mult = getCoilMultiplierByOption(coilType);
                const std =
                  (activeLot ? activeLot.carton_standard : rawOrder.carton_standard) || 'VIHAN_OPTO';
                const spec = lookupIs694CartonSpec(rawOrder.size, std, coilType, vihanRules, maruRules);
                const cpc =
                  Number((activeLot ? activeLot.coils_per_carton : rawOrder.coils_per_carton) || 0) ||
                  sumMixBreakdown(spec.mixPerCarton) ||
                  spec.coilsPerCarton ||
                  16;

                const applyOperatorLogsUpdate = (nextLogs: Is694OperatorLogEntry[]) => {
                  const syncedOrder = syncOrderWithOperatorProductionLogs(
                    rawOrder,
                    nextLogs,
                    vihanRules,
                    maruRules,
                    activeLotId
                  );
                  onUpdateOrder(syncedOrder);
                };

                const handleAddOperatorLogRow = (prefillColours?: Record<string, number>, cartonHint?: string) => {
                  const colourCounts: Record<string, number> = prefillColours || {
                    RED: 0,
                    BLACK: 0,
                    BLUE: 0,
                    YELLOW: 0,
                    GREEN: 0,
                  };
                  const sumCoils = Object.values(colourCounts).reduce((s, v) => s + (Number(v) || 0), 0);
                  const actualCoils = sumCoils;
                  const cartonsPacked = cpc > 0 && actualCoils > 0 ? Number((actualCoils / cpc).toFixed(2)) : 0;
                  const actualLengthM = Number((actualCoils * mult).toFixed(1));
                  const pvcPerM = m.orderLen > 0 ? m.reqIns / m.orderLen : 0;
                  const cuPerM = m.orderLen > 0 ? m.reqCu / m.orderLen : 0;
                  const nextIdx = currentLogs.length + 1;

                  const newEntry: Is694OperatorLogEntry = {
                    id: `OPLOG-${rawOrder.id}-${Date.now()}-${nextIdx}`,
                    date: dateStr,
                    shift: 'DAY',
                    machineNo: 'EXT-01',
                    cartonId: cartonHint || `${rawOrder.batch}-CTN-${String(nextIdx).padStart(2, '0')}`,
                    lotId: activeLotId,
                    colourCounts,
                    actualCoils,
                    cartonsPacked,
                    actualLengthM,
                    actualPvcKg: Number((actualLengthM * pvcPerM).toFixed(2)),
                    actualCuKg: Number((actualLengthM * cuPerM).toFixed(2)),
                    sparkTestOk: 'OK',
                    operatorName: '',
                    remarks: '',
                  };
                  applyOperatorLogsUpdate([...currentLogs, newEntry]);
                };

                const handlePreFillFromPlannedColours = () => {
                  const breakdownItems = getIs694ColourCoilsBreakdown(m, colourMap);
                  const pvcPerM = m.orderLen > 0 ? m.reqIns / m.orderLen : 0;
                  const cuPerM = m.orderLen > 0 ? m.reqCu / m.orderLen : 0;

                  if (rawOrder.carton_mode === 'MIX' || breakdownItems.length > 1) {
                    const colourCounts: Record<string, number> = {
                      RED: 0,
                      BLACK: 0,
                      BLUE: 0,
                      YELLOW: 0,
                      GREEN: 0,
                    };
                    breakdownItems.forEach(bi => {
                      const colKey = bi.colour.toUpperCase().trim();
                      colourCounts[colKey] = (colourCounts[colKey] || 0) + (bi.coils || 0);
                    });
                    const sumCoils = Object.values(colourCounts).reduce((s, v) => s + (Number(v) || 0), 0);
                    const cartonsPacked = cpc > 0 ? Number((sumCoils / cpc).toFixed(2)) : 0;
                    const actualLengthM = Number((sumCoils * mult).toFixed(1));
                    const ctnStart = 1;
                    const ctnEnd = Math.max(1, Math.ceil(cartonsPacked));
                    const cartonIdStr =
                      ctnEnd > 1
                        ? `${rawOrder.batch}-CTN-01..${String(ctnEnd).padStart(2, '0')}`
                        : `${rawOrder.batch}-CTN-${String(ctnStart).padStart(2, '0')}`;

                    const rowEntry: Is694OperatorLogEntry = {
                      id: `OPLOG-${rawOrder.id}-${Date.now()}-1`,
                      date: dateStr,
                      shift: 'DAY',
                      machineNo: 'EXT-01',
                      cartonId: cartonIdStr,
                      lotId: activeLotId,
                      colourCounts,
                      actualCoils: sumCoils,
                      cartonsPacked,
                      actualLengthM,
                      actualPvcKg: Number((actualLengthM * pvcPerM).toFixed(2)),
                      actualCuKg: Number((actualLengthM * cuPerM).toFixed(2)),
                      sparkTestOk: 'OK',
                      operatorName: '',
                      remarks: `Pre-filled from planned ${rawOrder.carton_mode === 'MIX' ? 'MIX' : 'Colour-Wise'} schedule`,
                    };
                    applyOperatorLogsUpdate([rowEntry]);
                  } else {
                    const newEntries: Is694OperatorLogEntry[] = breakdownItems.map((bi, idx) => {
                      const colKey = bi.colour.toUpperCase().trim();
                      const colourCounts: Record<string, number> = {
                        RED: 0,
                        BLACK: 0,
                        BLUE: 0,
                        YELLOW: 0,
                        GREEN: 0,
                        [colKey]: bi.coils || 0,
                      };
                      const actualCoils = bi.coils || 0;
                      const cartonsPacked = cpc > 0 ? Number((actualCoils / cpc).toFixed(2)) : 0;
                      const actualLengthM = bi.orderLenM || Number((actualCoils * mult).toFixed(1));
                      const ctnEnd = Math.max(1, Math.ceil(cartonsPacked));
                      return {
                        id: `OPLOG-${rawOrder.id}-${Date.now()}-${idx + 1}`,
                        date: dateStr,
                        shift: 'DAY',
                        machineNo: 'EXT-01',
                        cartonId: `${rawOrder.batch}-${colKey.slice(0, 2)}-CTN-01..${String(ctnEnd).padStart(2, '0')}`,
                        lotId: activeLotId,
                        colourCounts,
                        actualCoils,
                        cartonsPacked,
                        actualLengthM,
                        actualPvcKg: Number((bi.reqInsKg || actualLengthM * pvcPerM).toFixed(2)),
                        actualCuKg: Number((actualLengthM * cuPerM).toFixed(2)),
                        sparkTestOk: 'OK',
                        operatorName: '',
                        remarks: `${colKey} Coils Packed`,
                      };
                    });
                    applyOperatorLogsUpdate(newEntries);
                  }
                };

                const handleUpdateLogEntry = (
                  entryId: string,
                  updater: (prev: Is694OperatorLogEntry) => Is694OperatorLogEntry
                ) => {
                  const nextLogs = currentLogs.map(entry =>
                    entry.id === entryId ? updater(entry) : entry
                  );
                  applyOperatorLogsUpdate(nextLogs);
                };

                const handleUpdateColourCount = (entryId: string, colour: string, val: number) => {
                  const pvcPerM = m.orderLen > 0 ? m.reqIns / m.orderLen : 0;
                  const cuPerM = m.orderLen > 0 ? m.reqCu / m.orderLen : 0;
                  handleUpdateLogEntry(entryId, prev => {
                    const nextColours = {
                      ...(prev.colourCounts || {}),
                      [colour]: Math.max(0, Math.round(val || 0)),
                    };
                    const sumCoils = Object.values(nextColours).reduce(
                      (s, v) => s + (Number(v) || 0),
                      0
                    );
                    const nextCartons = cpc > 0 ? Number((sumCoils / cpc).toFixed(2)) : prev.cartonsPacked;
                    const nextLen = Number((sumCoils * mult).toFixed(1));
                    return {
                      ...prev,
                      colourCounts: nextColours,
                      actualCoils: sumCoils,
                      cartonsPacked: nextCartons,
                      actualLengthM: nextLen,
                      actualPvcKg: Number((nextLen * pvcPerM).toFixed(2)),
                      actualCuKg: Number((nextLen * cuPerM).toFixed(2)),
                    };
                  });
                };

                const handleDeleteLogEntry = (entryId: string) => {
                  const nextLogs = currentLogs.filter(e => e.id !== entryId);
                  applyOperatorLogsUpdate(nextLogs);
                };

                const totalLoggedCoils = currentLogs.reduce(
                  (s, e) => s + (Number(e.actualCoils) || 0),
                  0
                );
                const totalLoggedCartons = Number(
                  currentLogs.reduce((s, e) => s + (Number(e.cartonsPacked) || 0), 0).toFixed(2)
                );
                const totalLoggedLengthM = Number(
                  currentLogs.reduce((s, e) => s + (Number(e.actualLengthM) || 0), 0).toFixed(1)
                );
                const totalLoggedPvcKg = Number(
                  currentLogs.reduce((s, e) => s + (Number(e.actualPvcKg) || 0), 0).toFixed(2)
                );
                const loggedCartonIds = Array.from(
                  new Set(currentLogs.map(e => (e.cartonId || '').trim()).filter(Boolean))
                );

                return (
                  <div
                    key={`op-log-sec-${m.id}`}
                    className="border-2 border-rose-700 rounded-xl overflow-hidden bg-white shadow-xs mb-3"
                  >
                    <div className="bg-gradient-to-r from-rose-900 via-rose-800 to-amber-900 text-white px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="p-1.5 rounded bg-amber-400 text-slate-950 font-black">
                          <Box className="w-4 h-4" />
                        </span>
                        <div>
                          <div className="text-xs font-black uppercase tracking-wide flex items-center gap-2 flex-wrap">
                            <span>
                              3. Operator Production Log — Job {rawOrder.batch} ({rawOrder.brand} 1C × {rawOrder.size})
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-emerald-400 text-slate-950 text-[10px] font-black">
                              ⚡ Auto-Syncs to Main IS-694 Packing Inventory &amp; Stock
                            </span>
                          </div>
                          <div className="text-[10.5px] text-rose-100">
                            Record actual output quantities, Carton IDs, and Colour Coil Counts below — automatically updates the <strong>IS-694 Individual Packing List</strong>, <strong>Carton Stock</strong>, and <strong>Copper/PVC Stock Deduction</strong>.
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap no-print">
                        <button
                          type="button"
                          onClick={handlePreFillFromPlannedColours}
                          className="px-2.5 py-1 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-[11px] flex items-center gap-1 cursor-pointer shadow-2xs"
                          title="Populate Operator Production Log from planned colour coils"
                        >
                          ⚡ Pre-Fill from Planned Colours ({m.coils || totalIs694Coils} Coils)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddOperatorLogRow()}
                          className="px-2.5 py-1 rounded bg-white hover:bg-rose-50 text-rose-950 font-black text-[11px] flex items-center gap-1 cursor-pointer shadow-2xs"
                        >
                          <Plus className="w-3.5 h-3.5" /> + Add Operator Log Row
                        </button>
                        {currentLogs.length > 0 && (
                          <button
                            type="button"
                            onClick={() => applyOperatorLogsUpdate([])}
                            className="px-2 py-1 rounded bg-rose-950/80 hover:bg-rose-950 text-rose-200 border border-rose-500 text-[10.5px] font-bold cursor-pointer"
                            title="Clear operator log entries"
                          >
                            Clear Log
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Live Operator Log Summary Bar */}
                    <div className="bg-amber-50/80 border-b border-rose-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-rose-900 text-white font-black text-[10.5px]">
                          Standard: {std.replace(/_/g, ' ')} ({cpc} Coils/Carton • {coilType})
                        </span>
                        <span className="px-2 py-0.5 rounded bg-white border border-rose-300 text-rose-950 font-black text-[10.5px]">
                          Logged Output: {totalLoggedCoils} Coils ({totalLoggedCartons} Cartons)
                        </span>
                        <span className="px-2 py-0.5 rounded bg-white border border-teal-300 text-teal-950 font-bold text-[10.5px]">
                          Actual Length: {totalLoggedLengthM.toLocaleString()} m • Actual PVC: {totalLoggedPvcKg.toFixed(2)} kg
                        </span>
                        {loggedCartonIds.length > 0 && (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 border border-emerald-400 text-emerald-950 font-black text-[10.5px]">
                            🏷️ Carton IDs: {loggedCartonIds.join(', ')}
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] font-bold text-emerald-800">
                        {currentLogs.length > 0
                          ? `✅ Synced (${currentLogs.length} Operator Row${currentLogs.length > 1 ? 's' : ''}) → Main IS-694 Packing List`
                          : 'ℹ️ Add or Pre-Fill rows below to record operator output & auto-update IS-694 Packing List'}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead className="bg-slate-100 text-slate-900 font-black uppercase text-[10px] border-b-2 border-slate-300">
                          <tr>
                            <th className="p-2 border-r border-slate-300 text-center w-8">#</th>
                            <th className="p-2 border-r border-slate-300 min-w-[95px]">DATE &amp; SHIFT</th>
                            <th className="p-2 border-r border-slate-300 min-w-[75px]">M/C NO.</th>
                            <th className="p-2 border-r border-slate-300 bg-amber-100/80 text-amber-950 min-w-[140px]">
                              CARTON ID / CARTON NOS.
                            </th>
                            <th className="p-1.5 border-r border-slate-300 bg-red-50 text-red-900 text-center w-14">
                              RED
                            </th>
                            <th className="p-1.5 border-r border-slate-300 bg-slate-200 text-slate-900 text-center w-14">
                              BLACK
                            </th>
                            <th className="p-1.5 border-r border-slate-300 bg-blue-50 text-blue-900 text-center w-14">
                              BLUE
                            </th>
                            <th className="p-1.5 border-r border-slate-300 bg-yellow-100 text-yellow-950 text-center w-14">
                              YELLOW
                            </th>
                            <th className="p-1.5 border-r border-slate-300 bg-emerald-50 text-emerald-900 text-center w-14">
                              GREEN
                            </th>
                            <th className="p-2 border-r border-slate-300 bg-amber-50 text-amber-950 text-center min-w-[90px]">
                              ACTUAL COILS OUTPUT
                            </th>
                            <th className="p-2 border-r border-slate-300 bg-rose-50 text-rose-950 text-center min-w-[90px]">
                              CARTONS PACKED
                            </th>
                            <th className="p-2 border-r border-slate-300 text-right min-w-[95px]">
                              ACTUAL MTR
                            </th>
                            <th className="p-2 border-r border-slate-300 text-right min-w-[95px]">
                              ACTUAL PVC (KG)
                            </th>
                            <th className="p-2 border-r border-slate-300 min-w-[130px]">
                              OPERATOR SIGN &amp; REMARKS
                            </th>
                            <th className="p-2 text-center no-print w-10">DEL</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {currentLogs.map((entry, idx) => (
                            <tr key={entry.id} className="hover:bg-rose-50/30">
                              <td className="p-1.5 border-r border-slate-200 text-center font-black text-slate-700">
                                {idx + 1}
                              </td>
                              <td className="p-1.5 border-r border-slate-200">
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={entry.date}
                                    onChange={e =>
                                      handleUpdateLogEntry(entry.id, prev => ({
                                        ...prev,
                                        date: e.target.value,
                                      }))
                                    }
                                    className="w-20 px-1 py-0.5 border border-slate-300 rounded text-[11px] font-semibold bg-white"
                                    placeholder="DD/MM/YYYY"
                                  />
                                  <select
                                    value={entry.shift}
                                    onChange={e =>
                                      handleUpdateLogEntry(entry.id, prev => ({
                                        ...prev,
                                        shift: e.target.value as 'DAY' | 'NIGHT' | 'GENERAL',
                                      }))
                                    }
                                    className="px-1 py-0.5 border border-slate-300 rounded text-[10px] font-bold bg-white"
                                  >
                                    <option value="DAY">DAY</option>
                                    <option value="NIGHT">NIGHT</option>
                                    <option value="GENERAL">GEN</option>
                                  </select>
                                </div>
                              </td>
                              <td className="p-1.5 border-r border-slate-200">
                                <input
                                  type="text"
                                  value={entry.machineNo}
                                  onChange={e =>
                                    handleUpdateLogEntry(entry.id, prev => ({
                                      ...prev,
                                      machineNo: e.target.value,
                                    }))
                                  }
                                  className="w-16 px-1.5 py-0.5 border border-slate-300 rounded text-[11px] font-bold bg-white text-center"
                                  placeholder="EXT-01"
                                />
                              </td>
                              <td className="p-1.5 border-r border-slate-200 bg-amber-50/40">
                                <input
                                  type="text"
                                  value={entry.cartonId}
                                  onChange={e =>
                                    handleUpdateLogEntry(entry.id, prev => ({
                                      ...prev,
                                      cartonId: e.target.value,
                                    }))
                                  }
                                  className="w-full min-w-[125px] px-1.5 py-0.5 border-2 border-amber-400 rounded text-[11px] font-black text-amber-950 bg-white"
                                  placeholder="e.g. CTN-01..05"
                                  title="Enter Carton ID or Carton Serial Range (auto-synced to IS-694 Packing List)"
                                />
                              </td>
                              {(['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).map(col => (
                                <td key={col} className="p-1 border-r border-slate-200 text-center">
                                  <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={entry.colourCounts?.[col] ?? 0}
                                    onChange={e =>
                                      handleUpdateColourCount(
                                        entry.id,
                                        col,
                                        parseFloat(e.target.value) || 0
                                      )
                                    }
                                    className="w-12 px-1 py-0.5 border border-slate-300 rounded text-center font-black text-xs bg-white focus:border-rose-600"
                                    title={`${col} Coils Produced`}
                                  />
                                </td>
                              ))}
                              <td className="p-1.5 border-r border-slate-200 bg-amber-50/50 text-center">
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={entry.actualCoils}
                                  onChange={e => {
                                    const nextCoils = Math.max(0, Math.round(parseFloat(e.target.value) || 0));
                                    const pvcPerM = m.orderLen > 0 ? m.reqIns / m.orderLen : 0;
                                    const cuPerM = m.orderLen > 0 ? m.reqCu / m.orderLen : 0;
                                    const nextLen = Number((nextCoils * mult).toFixed(1));
                                    const nextCtns = cpc > 0 ? Number((nextCoils / cpc).toFixed(2)) : entry.cartonsPacked;
                                    handleUpdateLogEntry(entry.id, prev => ({
                                      ...prev,
                                      actualCoils: nextCoils,
                                      cartonsPacked: nextCtns,
                                      actualLengthM: nextLen,
                                      actualPvcKg: Number((nextLen * pvcPerM).toFixed(2)),
                                      actualCuKg: Number((nextLen * cuPerM).toFixed(2)),
                                    }));
                                  }}
                                  className="w-16 px-1.5 py-0.5 border border-amber-400 rounded text-center font-black text-xs bg-white text-slate-950"
                                />
                              </td>
                              <td className="p-1.5 border-r border-slate-200 bg-rose-50/50 text-center">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={entry.cartonsPacked}
                                  onChange={e => {
                                    const nextCtns = Math.max(0, parseFloat(e.target.value) || 0);
                                    handleUpdateLogEntry(entry.id, prev => ({
                                      ...prev,
                                      cartonsPacked: nextCtns,
                                    }));
                                  }}
                                  className="w-16 px-1.5 py-0.5 border border-rose-400 rounded text-center font-black text-xs bg-white text-rose-950"
                                />
                              </td>
                              <td className="p-1.5 border-r border-slate-200 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="10"
                                  value={entry.actualLengthM}
                                  onChange={e => {
                                    const nextLen = Math.max(0, parseFloat(e.target.value) || 0);
                                    handleUpdateLogEntry(entry.id, prev => ({
                                      ...prev,
                                      actualLengthM: nextLen,
                                    }));
                                  }}
                                  className="w-20 px-1.5 py-0.5 border border-slate-300 rounded text-right font-bold text-xs bg-white"
                                />
                              </td>
                              <td className="p-1.5 border-r border-slate-200 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  value={entry.actualPvcKg}
                                  onChange={e => {
                                    const nextPvc = Math.max(0, parseFloat(e.target.value) || 0);
                                    handleUpdateLogEntry(entry.id, prev => ({
                                      ...prev,
                                      actualPvcKg: nextPvc,
                                    }));
                                  }}
                                  className="w-18 px-1.5 py-0.5 border border-teal-400 rounded text-right font-bold text-xs bg-teal-50/40 text-teal-950"
                                />
                              </td>
                              <td className="p-1.5 border-r border-slate-200">
                                <input
                                  type="text"
                                  value={entry.remarks || entry.operatorName || ''}
                                  onChange={e =>
                                    handleUpdateLogEntry(entry.id, prev => ({
                                      ...prev,
                                      operatorName: e.target.value,
                                      remarks: e.target.value,
                                    }))
                                  }
                                  className="w-full min-w-[115px] px-1.5 py-0.5 border border-slate-300 rounded text-[11px] bg-white"
                                  placeholder="Operator Name / Sign"
                                />
                              </td>
                              <td className="p-1.5 text-center no-print">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLogEntry(entry.id)}
                                  className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                                  title="Delete operator log row"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}

                          {/* Printable blank rows when printed or when no rows added yet */}
                          {(currentLogs.length === 0 ? [1, 2, 3] : [1, 2]).map(blankIdx => (
                            <tr
                              key={`op-blank-row-${blankIdx}`}
                              className={`h-8 ${currentLogs.length > 0 ? 'print-only' : ''}`}
                            >
                              <td className="p-1.5 border-r border-slate-200 text-center font-bold text-slate-400">
                                {currentLogs.length + blankIdx}
                              </td>
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 border-r border-slate-200 bg-white" />
                              <td className="p-1.5 text-center no-print">
                                {blankIdx === 1 && currentLogs.length === 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleAddOperatorLogRow()}
                                    className="px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-900 font-bold text-[10px] cursor-pointer"
                                  >
                                    + Entry
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {currentLogs.length > 0 && (
                          <tfoot className="bg-rose-50 font-black text-rose-950 border-t-2 border-rose-300">
                            <tr>
                              <td colSpan={4} className="p-2 border-r border-rose-200 text-right uppercase">
                                OPERATOR LOG TOTALS (AUTO-SYNCED TO IS-694 PACKING INVENTORY):
                              </td>
                              {(['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).map(col => {
                                const colTot = currentLogs.reduce(
                                  (s, e) => s + (Number(e.colourCounts?.[col]) || 0),
                                  0
                                );
                                return (
                                  <td
                                    key={col}
                                    className="p-1.5 border-r border-rose-200 text-center font-black bg-white"
                                  >
                                    {colTot > 0 ? colTot : '-'}
                                  </td>
                                );
                              })}
                              <td className="p-2 border-r border-rose-200 text-center bg-amber-100">
                                {totalLoggedCoils} Coils
                              </td>
                              <td className="p-2 border-r border-rose-200 text-center bg-rose-100">
                                {totalLoggedCartons} Ctns
                              </td>
                              <td className="p-2 border-r border-rose-200 text-right">
                                {totalLoggedLengthM.toLocaleString()} m
                              </td>
                              <td className="p-2 border-r border-rose-200 text-right text-teal-900">
                                {totalLoggedPvcKg.toFixed(2)} kg
                              </td>
                              <td className="p-2 border-r border-rose-200 text-[10px] text-emerald-900">
                                {loggedCartonIds.length > 0 ? `IDs: ${loggedCartonIds.join(', ')}` : 'Synced'}
                              </td>
                              <td className="p-2 no-print" />
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {renderPrintStageSheetFooter('SPECIAL IS-694 PROCESS CARD (AFTER BUNCHING)')}
        </div>
      )}

      {/* 3. STANDARD INSULATION PROCESS CARD */}
      {(printStageFilter === 'ALL' || printStageFilter === 'i') && !isIs694Card && (
      <div className="border-2 border-teal-800 rounded-lg bg-white overflow-hidden shadow-xs print-card">
        {renderPrintStageSheetHeader('STAGE 3: INSULATION PROCESS', getStagePageNumber('i'), totalStagePages)}
        <div className="bg-teal-800 text-white p-3 font-bold text-sm flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span>3. PROCESS CARD FOR INSULATION PROCESS (EXACT RECORD SHEET PVC OD, DIE & NOZZLE)</span>
            {renderStageBadge('INSULATION', iDone, iDoneCount, totalCount, isIUnlocked, !bDone ? '1. BUNCHING' : '2. CU STRANDING')}
            <button
              onClick={() => toggleAllForCard('i')}
              className={`text-xs px-2.5 py-1 rounded font-bold no-print transition-all flex items-center gap-1 ${
                iDone
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer'
                  : isIUnlocked
                  ? 'bg-slate-200 text-slate-800 hover:bg-slate-300 cursor-pointer'
                  : 'bg-teal-950/60 text-slate-300 border border-teal-600 cursor-not-allowed'
              }`}
            >
              {iDone ? '✓ All Done' : isIUnlocked ? '⏳ Mark Done' : `🔒 Do ${!bDone ? 'Bunching' : 'Cu Stranding'} 1st`}
            </button>
            <button
              type="button"
              onClick={() => handlePrintStage('i')}
              className="text-xs px-2.5 py-1 rounded font-bold bg-blue-600 hover:bg-blue-500 text-white no-print flex items-center gap-1 cursor-pointer"
              title="Print only Stage 3 (Insulation) on a single page"
            >
              <Printer className="w-3 h-3" /> Print Stage 3
            </button>
          </div>
          <div className="flex items-center gap-3">
            {renderOfficialStamp('INSULATION', iDone, iDoneCount, totalCount)}
            {renderCardDateHeader()}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5 p-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
          <div><strong>BRAND:</strong> {brand}</div>
          <div><strong>BATCH NO:</strong> {batch}</div>
          <div><strong>SIZE:</strong> {first.size}</div>
          <div><strong>COPPER SIZE:</strong> {first.conductor}</div>
          <div><strong>BUNCH DIA:</strong> {fmtExact(first.bunchDia, 6)} mm</div>
          <div><strong>NOZZLE (Col P):</strong> <span className="text-teal-700 font-bold">{fmtExact(first.nozzle, 6)} mm</span></div>
          <div><strong>PVC / CORE OD (Col Q):</strong> <span className="text-teal-700 font-bold">{fmtExact(first.coreOd, 4)} mm</span></div>
          <div><strong>CORE THICKNESS:</strong> {fmtExact(first.coreThickness, 6)} mm</div>
          <div><strong>INS. DIE (Col S):</strong> <span className="text-teal-700 font-bold">{fmtExact(first.insDie, 4)} mm</span></div>
          <div><strong>COMPOUND:</strong> <strong>{first.ins_compound}</strong></div>
          <div><strong>INSULATION REQ:</strong> <span className="text-teal-700 font-bold">{fmtExact(totalInsWt, 4)} kg</span></div>
          <div><strong>COPPER LENGTH:</strong> {reqQtyText} ({reqLen.toLocaleString()} m)</div>
          <div className="sm:col-span-4 md:col-span-6">
            <strong>COPPER SPOOL NO:</strong> {bbnString}
          </div>
        </div>

        {/* Step-Wise Auto-Deduction Status Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-gradient-to-r from-slate-50 to-teal-50/40 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-xs text-slate-800">
              ⚡ Insulation Compound Requisition Status:
            </span>
            {iDone ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-400 flex items-center gap-1 shadow-2xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>INSULATED &amp; AUTO-DEDUCTED FROM PVC REQUISITION</span>
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-teal-100 text-teal-950 border border-teal-400 flex items-center gap-1 shadow-2xs">
                <Clock className="w-3.5 h-3.5 text-teal-700" />
                <span>
                  REQUISITION HAVE TO INSULATE: {fmtExact(matchingOrders.filter(m => !m.pStatus?.i).reduce((s, m) => s + m.reqIns, 0), 2)} kg ({matchingOrders.filter(m => !m.pStatus?.i).reduce((s, m) => s + m.reqCoreLen, 0).toLocaleString()} m cores)
                </span>
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500 font-semibold no-print">
            {iDone ? '✓ Auto-deducted from Tab 8 PVC Requisition' : '⏳ Pending to extrude on Tab 8 PVC Requisition'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-2.5 border-r border-slate-200">CORE COLOUR</th>
                {matchingOrders.map(m => (
                  <th key={m.id} className="p-2.5 border-r border-slate-200 text-right">
                    <div className="font-bold text-slate-800">{m.cores}C × {m.size}</div>
                    <div className="text-[10px] text-slate-500 font-normal">
                      ({m.grade} | PVC OD: {fmtExact(m.coreOd, 4)} | Die: {fmtExact(m.insDie, 4)})
                    </div>
                    {m.coils !== undefined && m.coils !== '' && Number(m.coils) > 0 && (
                      <div className="text-[10px] font-extrabold text-amber-800 mt-0.5">
                        Coils: {m.coils} × {m.coil_type || '100 YARD'}
                      </div>
                    )}
                    {/* Live Order Stage Toggle */}
                    <div className="mt-1 flex justify-end no-print">
                      {(() => {
                        const lock = getStageLockState(m, 'i', ladiDimensions);
                        return (
                          <button
                            type="button"
                            onClick={() => onToggleProcess(m.id, 'i')}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all flex items-center gap-1 ${
                              m.pStatus?.i
                                ? 'bg-emerald-600 text-white shadow-2xs cursor-pointer'
                                : lock.isUnlocked
                                ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer'
                                : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300 cursor-not-allowed'
                            }`}
                            title={
                              lock.isUnlocked
                                ? 'Click to toggle Insulation stage for this specific cable'
                                : `Locked: Complete ${lock.missingPrerequisiteLabel} first`
                            }
                          >
                            {m.pStatus?.i ? '✓ Insulated' : lock.isUnlocked ? '⏳ Pending' : '🔒 Locked'}
                          </button>
                        );
                      })()}
                    </div>
                    <div className="text-[9.5px] font-black mt-1">
                      {m.pStatus?.i ? (
                        <span className="text-emerald-700">✓ Deducted</span>
                      ) : (
                        <span className="text-teal-900">⚡ To Insulate: {fmtExact(m.reqIns, 2)} kg</span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="p-2.5 border-r border-slate-200 text-right">TOTAL CORE LENGTH (M)</th>
                <th className="p-2.5 border-r border-slate-200 text-right">EST. COMPOUND (KG)</th>
                <th className="p-2.5 text-right bg-teal-50 text-teal-950">REQUISITION TO INSULATE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {uniqueColours.map(col => {
                let rowSum = 0;
                return (
                  <tr key={col} className="hover:bg-slate-50">
                    <td className="p-2.5 border-r border-slate-100 font-bold">{col}</td>
                    {matchingOrders.map(m => {
                      const colMap = getCoreColoursForOrder(m.grade, m.cores, colourMap, m.ins_colour);
                      const countForCol = colMap[col] || 0;
                      const singleCoreLen = Math.round(m.orderLen * 1.02);
                      const lenForCol = countForCol * singleCoreLen;
                      rowSum += lenForCol;
                      return (
                        <td key={m.id} className="p-2.5 border-r border-slate-100 text-right font-medium">
                          {lenForCol > 0 ? (
                            <span>
                              {lenForCol.toLocaleString()}
                              {countForCol > 1 && <span className="text-[10px] text-slate-500 ml-1">({singleCoreLen}×{countForCol})</span>}
                            </span>
                          ) : '-'}
                        </td>
                      );
                    })}
                    <td className="p-2.5 border-r border-slate-100 text-right font-bold bg-slate-50">
                      {rowSum > 0 ? `${rowSum.toLocaleString()} m` : '-'}
                    </td>
                    <td className="p-2.5 border-r border-slate-100 text-right font-semibold bg-slate-50 text-teal-800">
                      {reqLen > 0 ? ((totalInsWt * (rowSum / reqLen)).toFixed(2) + ' kg') : '-'}
                    </td>
                    <td className="p-2.5 text-right font-black bg-teal-50/60">
                      {iDone ? (
                        <span className="text-emerald-700 font-bold">✓ 0.00 kg (Deducted)</span>
                      ) : (
                        <span className="text-teal-950 font-black">
                          {reqLen > 0 ? (matchingOrders.filter(m => !m.pStatus?.i).reduce((s, m) => {
                            const colMap = getCoreColoursForOrder(m.grade, m.cores, colourMap, m.ins_colour);
                            const countForCol = colMap[col] || 0;
                            const singleCoreLen = Math.round(m.orderLen * 1.02);
                            const lenForCol = countForCol * singleCoreLen;
                            return s + (m.reqCoreLen > 0 ? m.reqIns * (lenForCol / m.reqCoreLen) : 0);
                          }, 0).toFixed(2) + ' kg') : '-'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
                <td className="p-2.5 border-r border-slate-200">TOTAL / RECORD VALUES</td>
                {matchingOrders.map(m => (
                  <td key={m.id} className="p-2.5 border-r border-slate-200 text-right">
                    <div>{m.reqCoreLen.toLocaleString()} m ({fmtExact(m.reqIns, 2)} kg)</div>
                    <div className="text-[10px] font-black text-teal-900 mt-0.5">
                      {m.pStatus?.i ? '✓ Deducted' : `⚡ To Insulate: ${fmtExact(m.reqIns, 2)} kg`}
                    </div>
                  </td>
                ))}
                <td className="p-2.5 border-r border-slate-200 text-right">{reqLen.toLocaleString()} m</td>
                <td className="p-2.5 border-r border-slate-200 text-right text-teal-800">{fmtExact(totalInsWt, 4)} kg</td>
                <td className="p-2.5 text-right font-black text-teal-950 bg-teal-100/70">
                  {iDone ? '✓ 0.00 kg' : `${fmtExact(matchingOrders.filter(m => !m.pStatus?.i).reduce((s, m) => s + m.reqIns, 0), 2)} kg`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {renderPrintStageSheetFooter('STAGE 3: INSULATION PROCESS')}
      </div>
      )}

      {/* 4. CORE STRANDING (TWISTING — Not applicable for IS-694) */}
      {!isIs694Card && (printStageFilter === 'ALL' || printStageFilter === 't') && (
      <div className="border-2 border-blue-900 rounded-lg bg-white overflow-hidden shadow-xs print-card">
        {renderPrintStageSheetHeader('STAGE 4: CORE STRANDING (TWISTING)', getStagePageNumber('t'), totalStagePages)}
        <div className="bg-blue-900 text-white p-3 font-bold text-sm flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span>4. PROCESS CARD FOR CORE STRANDING (EXACT RECORD SHEET TWISTING DIA, STRANDING DIE & LAY LENGTH)</span>
            {renderStageBadge('TWISTING', tDone, tDoneCount, tApplicableOrders.length, isTUnlocked, '3. INSULATION')}
            {isTRequired && (
              <button
                onClick={() => toggleAllForCard('t')}
                className={`text-xs px-2.5 py-1 rounded font-bold no-print transition-all flex items-center gap-1 ${
                  tDone
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer'
                    : isTUnlocked
                    ? 'bg-slate-200 text-slate-800 hover:bg-slate-300 cursor-pointer'
                    : 'bg-blue-950/60 text-slate-300 border border-blue-700 cursor-not-allowed'
                }`}
              >
                {tDone ? '✓ All Done' : isTUnlocked ? '⏳ Mark Done' : '🔒 Do Insulation 1st'}
              </button>
            )}
            <button
              type="button"
              onClick={() => handlePrintStage('t')}
              className="text-xs px-2.5 py-1 rounded font-bold bg-blue-600 hover:bg-blue-500 text-white no-print flex items-center gap-1 cursor-pointer"
              title="Print only Stage 4 (Twisting) on a single page"
            >
              <Printer className="w-3 h-3" /> Print Stage 4
            </button>
          </div>
          <div className="flex items-center gap-3">
            {renderOfficialStamp('TWISTING', tDone, tDoneCount, tApplicableOrders.length)}
            {renderCardDateHeader()}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
          <div><strong>BATCH NO:</strong> {batch}</div>
          <div><strong>BRAND:</strong> {brand}</div>
          <div><strong>CONDUCTOR SIZE:</strong> {first.size} ({first.conductor})</div>
          <div><strong>PVC CORE OD (Col Q):</strong> {fmtExact(first.coreOd, 4)} mm</div>
        </div>

        {/* Core Stranding / Twisting Step-Wise Requisition Status Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-gradient-to-r from-slate-50 to-blue-50/40 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-xs text-slate-800">
              ⚡ Core Stranding / Twisting Requisition Status:
            </span>
            {tDone ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-400 flex items-center gap-1 shadow-2xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>TWISTED &amp; AUTO-DEDUCTED FROM ACTIVE REQUISITION</span>
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-blue-100 text-blue-950 border border-blue-400 flex items-center gap-1 shadow-2xs">
                <Clock className="w-3.5 h-3.5 text-blue-700" />
                <span>
                  REQUISITION HAVE TO TWIST: {tApplicableOrders.filter(m => !m.pStatus?.t).reduce((s, m) => s + m.orderLen, 0).toLocaleString()} m
                </span>
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500 font-semibold no-print">
            {tDone ? '✓ Auto-deducted from Active Process Requisition' : '⏳ Pending to twist on Twisting Requisition'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-2.5 border-r border-slate-200">CABLE SIZE</th>
                <th className="p-2.5 border-r border-slate-200">GRADE</th>
                <th className="p-2.5 border-r border-slate-200 text-center">NO. OF CORES</th>
                <th className="p-2.5 border-r border-slate-200">CORE COLOUR SEQUENCE</th>
                <th className="p-2.5 border-r border-slate-200 text-right">PVC CORE OD (Q)</th>
                <th className="p-2.5 border-r border-slate-200 text-right">TWISTING DIA (U)</th>
                <th className="p-2.5 border-r border-slate-200 text-right">STRANDING DIE (V)</th>
                <th className="p-2.5 border-r border-slate-200 text-right">LAY LENGTH (W)</th>
                <th className="p-2.5 border-r border-slate-200 text-right">INPUT CORE LEN</th>
                <th className="p-2.5 border-r border-slate-200 text-right">REQ. CABLE LENGTH</th>
                <th className="p-2.5 border-r border-slate-200 text-right bg-blue-50 text-blue-950">REQUISITION TO TWIST</th>
                <th className="p-2.5 text-center">PROCESS STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coreStrandingRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-4 text-center text-slate-400">
                    Single-Core (1C) cable selected — Core Stranding / Twisting not required by rules for 1C.
                  </td>
                </tr>
              ) : (
                coreStrandingRows.map(m => {
                  const lock = getStageLockState(m, 't', ladiDimensions);
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="p-2.5 border-r border-slate-100 font-bold">{m.cores}C × {m.size}</td>
                      <td className="p-2.5 border-r border-slate-100">{m.grade}</td>
                      <td className="p-2.5 border-r border-slate-100 text-center font-bold">{m.cores}</td>
                      <td className="p-2.5 border-r border-slate-100 font-medium text-slate-800">{formatColourSequence(m.grade, m.cores, colourMap)}</td>
                      <td className="p-2.5 border-r border-slate-100 text-right font-bold">{fmtExact(m.coreOd, 4)} mm</td>
                      <td className="p-2.5 border-r border-slate-100 text-right font-bold text-blue-800 bg-blue-50/50">{fmtExact(m.twistingDia, 4)} mm</td>
                      <td className="p-2.5 border-r border-slate-100 text-right font-bold text-blue-800 bg-blue-50/50">{fmtExact(m.strandingDie, 4)} mm</td>
                      <td className="p-2.5 border-r border-slate-100 text-right font-bold">{m.layLength} mm</td>
                      <td className="p-2.5 border-r border-slate-100 text-right font-medium">{Math.round(m.orderLen * 1.02).toLocaleString()} m / core</td>
                      <td className="p-2.5 border-r border-slate-100 text-right font-bold text-slate-900">{m.orderLen.toLocaleString()} m</td>
                      <td className="p-2.5 border-r border-slate-100 text-right font-bold bg-blue-50/60">
                        {m.pStatus?.t ? (
                          <span className="text-emerald-700 font-bold">✓ 0 m (Deducted)</span>
                        ) : (
                          <span className="text-blue-950 font-black">{m.orderLen.toLocaleString()} m</span>
                        )}
                      </td>
                      <td className="p-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => onToggleProcess(m.id, 't')}
                          className={`px-2 py-1 rounded text-[10px] font-bold transition-all inline-flex items-center gap-1 ${
                            m.pStatus?.t
                              ? 'bg-emerald-600 text-white shadow-2xs cursor-pointer'
                              : lock.isUnlocked
                              ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer'
                              : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300 cursor-not-allowed'
                          }`}
                          title={
                            lock.isUnlocked
                              ? 'Click to toggle Twisting stage for this cable'
                              : `Locked: Complete ${lock.missingPrerequisiteLabel} first`
                          }
                        >
                          {m.pStatus?.t ? '✓ Twisted' : lock.isUnlocked ? '⏳ Pending' : '🔒 Do Insulation 1st'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {coreStrandingRows.length > 0 && (
              <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
                <tr>
                  <td colSpan={9} className="p-2.5 border-r border-slate-200 text-right uppercase">
                    TOTAL TWISTING SUMMARY:
                  </td>
                  <td className="p-2.5 border-r border-slate-200 text-right">
                    {coreStrandingRows.reduce((s, m) => s + m.orderLen, 0).toLocaleString()} m
                  </td>
                  <td className="p-2.5 border-r border-slate-200 text-right font-black text-blue-950 bg-blue-100/70">
                    {tDone ? '✓ 0 m' : `${coreStrandingRows.filter(m => !m.pStatus?.t).reduce((s, m) => s + m.orderLen, 0).toLocaleString()} m`}
                  </td>
                  <td className="p-2.5 text-center font-bold">
                    {tDone ? <span className="text-emerald-700">✓ ALL TWISTED</span> : <span className="text-amber-800">IN PROGRESS</span>}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {renderPrintStageSheetFooter('STAGE 4: CORE STRANDING (TWISTING)')}
      </div>
      )}

      {/* 5. SHEATHING PROCESS CARD (Not applicable for IS-694) */}
      {!isIs694Card && (printStageFilter === 'ALL' || printStageFilter === 's') && (
      <div className="border-2 border-amber-900 rounded-lg bg-white overflow-hidden shadow-xs print-card">
        {renderPrintStageSheetHeader('STAGE 5: SHEATHING PROCESS', getStagePageNumber('s'), totalStagePages)}
        <div className="bg-amber-900 text-white p-3 font-bold text-sm flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span>5. PROCESS CARD FOR SHEATHING PROCESS (FINAL OD DETAILS)</span>
            {renderStageBadge('SHEATHING', sDone, sDoneCount, sApplicableOrders.length, isSUnlocked, isTRequired ? '4. TWISTING' : '3. INSULATION')}
            {isSRequired && (
              <button
                onClick={() => toggleAllForCard('s')}
                className={`text-xs px-2.5 py-1 rounded font-bold no-print transition-all flex items-center gap-1 ${
                  sDone
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer'
                    : isSUnlocked
                    ? 'bg-slate-200 text-slate-800 hover:bg-slate-300 cursor-pointer'
                    : 'bg-amber-950/60 text-slate-300 border border-amber-700 cursor-not-allowed'
                }`}
              >
                {sDone ? '✓ All Done' : isSUnlocked ? '⏳ Mark Done' : `🔒 Do ${isTRequired ? 'Twisting' : 'Insulation'} 1st`}
              </button>
            )}
            <button
              type="button"
              onClick={() => handlePrintStage('s')}
              className="text-xs px-2.5 py-1 rounded font-bold bg-blue-600 hover:bg-blue-500 text-white no-print flex items-center gap-1 cursor-pointer"
              title="Print only Stage 5 (Sheathing) on a single page"
            >
              <Printer className="w-3 h-3" /> Print Stage 5
            </button>
          </div>
          <div className="flex items-center gap-3">
            {renderOfficialStamp('SHEATHING', sDone, sDoneCount, sApplicableOrders.length)}
            {renderCardDateHeader()}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-700">
          <div><strong>BATCH NO:</strong> {batch}</div>
          <div><strong>BRAND:</strong> {brand}</div>
          <div><strong>SIZE:</strong> {first.size}</div>
          <div><strong>TOTAL SHEATH REQ (Col AF):</strong> <span className="text-amber-900 font-bold">{fmtExact(totalSheathWt, 4)} kg</span></div>
        </div>

        {/* Sheathing & Packaging Step-Wise Requisition Status Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-gradient-to-r from-slate-50 to-amber-50/40 border-b border-slate-200">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-xs text-slate-800">
              ⚡ Sheathing Compound &amp; Drum Requisition Status:
            </span>
            {sDone ? (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-400 flex items-center gap-1 shadow-2xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>SHEATHED &amp; AUTO-DEDUCTED FROM PVC &amp; DRUM REQUISITION</span>
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-100 text-amber-950 border border-amber-400 flex items-center gap-1 shadow-2xs">
                <Clock className="w-3.5 h-3.5 text-amber-700" />
                <span>
                  REQUISITION HAVE TO SHEATH: {fmtExact(sApplicableOrders.filter(m => !m.pStatus?.s).reduce((s, m) => s + m.reqSheath, 0), 2)} kg PVC ({sApplicableOrders.filter(m => !m.pStatus?.s).reduce((s, m) => s + m.orderLen, 0).toLocaleString()} m)
                </span>
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500 font-semibold no-print">
            {sDone ? '✓ Auto-deducted from Tab 8 PVC & Tab 10 Drum Requisitions' : '⏳ Pending to sheath on Tab 8 PVC & Tab 10 Drum Requisitions'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-2.5 border-r border-slate-200">CABLE SIZE</th>
                <th className="p-2.5 border-r border-slate-200">GRADE</th>
                <th className="p-2.5 border-r border-slate-200">SHEATH COMPOUND</th>
                <th className="p-2.5 border-r border-slate-200">COLOUR</th>
                <th className="p-2.5 border-r border-slate-200">SPOOL SIZE / TYPE</th>
                <th className="p-2.5 border-r border-slate-200">PACKAGING / DRUM LEN</th>
                <th className="p-2.5 border-r border-slate-200 text-center">NO. OF SPOOLS / DRUMS</th>
                <th className="p-2.5 border-r border-slate-200 text-center">PALLET &amp; BBN / PALLET</th>
                <th className="p-2.5 border-r border-slate-200 text-right">STRANDING DIA</th>
                <th className="p-2.5 border-r border-slate-200 text-right">FINAL OD</th>
                <th className="p-2.5 border-r border-slate-200 text-right">ORDER LEN</th>
                <th className="p-2.5 border-r border-slate-200 text-right">REQ SHEATH</th>
                <th className="p-2.5 border-r border-slate-200 text-right bg-amber-50 text-amber-950">REQUISITION TO SHEATH</th>
                <th className="p-2.5 text-center">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {matchingOrders.map(m => {
                const innerDia = m.cores === 1 ? m.coreOd : m.twistingDia;
                const isIs694 = (m.grade || '').toUpperCase().includes('IS-694');
                const hasCoils = m.coils !== undefined && m.coils !== '' && Number(m.coils) > 0;
                const isCoilOrCarton = isIs694 || hasCoils;
                const evalPkg = evaluateSpoolSizeForOrder(
                  m.finalDia,
                  m.orderLen,
                  m.size,
                  m.cores,
                  m.grade,
                  sizeRules,
                  packagingRules,
                  m.spool_size,
                  m.coils,
                  m.coil_type,
                  m.carton_count
                );
                const activePallet = evalPkg.pallet || '30X30x6';
                const pkgText = evalPkg.packaging || "1000m / Drum";
                const mLenMatch = pkgText.match(/[0-9]+/);
                const drumLen = mLenMatch ? parseFloat(mLenMatch[0]) : 1000;
                const spoolCount = isCoilOrCarton ? 0 : (drumLen > 0 ? Math.ceil(m.orderLen / drumLen) : 1);
                const bbnPerPallet = evalPkg.bbnPerPallet || 1;
                const reqPallets = isCoilOrCarton ? 0 : Math.ceil(spoolCount / bbnPerPallet);
                const lock = getStageLockState(m, 's', ladiDimensions);

                return (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="p-2.5 border-r border-slate-100 font-bold">{m.cores}C × {m.size}</td>
                    <td className="p-2.5 border-r border-slate-100">{m.grade}</td>
                    <td className="p-2.5 border-r border-slate-100 font-semibold">{m.sheath_compound || '-'}</td>
                    <td className="p-2.5 border-r border-slate-100 font-semibold">{m.sheath_colour || 'STANDARD'}</td>
                    <td className="p-2.5 border-r border-slate-100">
                      {isCoilOrCarton ? (
                        <span className="px-2 py-0.5 rounded font-black text-[9.5px] bg-rose-100 text-rose-900 border border-rose-300">
                          {isIs694 ? 'N/A (Carton Pack)' : 'N/A (Coils Pack)'}
                        </span>
                      ) : (
                        <input
                          type="text"
                          value={m.spool_size || evalPkg.spool}
                          onChange={(e) => onUpdateOrder({ ...m, spool_size: e.target.value })}
                          className="w-24 px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-xs bg-white"
                        />
                      )}
                    </td>
                    <td className="p-2.5 border-r border-slate-100 font-bold">{pkgText}</td>
                    <td className="p-2.5 border-r border-slate-100 text-center font-bold text-blue-700">
                      {isCoilOrCarton ? (
                        <span className="text-[10px] font-black text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-300">
                          {m.coils ? `${m.coils} Coils` : 'Coils Pack'}
                        </span>
                      ) : (
                        <span>{spoolCount} Drums</span>
                      )}
                    </td>
                    <td className="p-2.5 border-r border-slate-100 text-center">
                      {isCoilOrCarton ? (
                        <span className="text-[10px] font-bold text-slate-400">N/A (Coils/Cartons)</span>
                      ) : (
                        <>
                          <div className="font-bold text-slate-900">{activePallet}</div>
                          <div className="text-[10px] font-bold text-indigo-700">
                            {bbnPerPallet} Bbn/Pallet ({reqPallets} Pallets)
                          </div>
                        </>
                      )}
                    </td>
                    <td className="p-2.5 border-r border-slate-100 text-right">{fmtExact(innerDia, 4)} mm</td>
                    <td className="p-2.5 border-r border-slate-100 text-right font-bold text-amber-900 bg-amber-50/50">{fmtExact(m.finalDia, 4)} mm</td>
                    <td className="p-2.5 border-r border-slate-100 text-right font-bold">{m.orderLen.toLocaleString()} m</td>
                    <td className="p-2.5 border-r border-slate-100 text-right font-bold text-amber-900">{fmtExact(m.reqSheath, 4)} kg</td>
                    <td className="p-2.5 border-r border-slate-100 text-right font-bold bg-amber-50/60">
                      {m.pStatus?.s ? (
                        <span className="text-emerald-700 font-bold">✓ 0 kg (Deducted)</span>
                      ) : (
                        <span className="text-amber-950 font-black">{fmtExact(m.reqSheath, 2)} kg</span>
                      )}
                    </td>
                    <td className="p-2.5 text-center">
                      {!lock.isRequired ? (
                        <span className="text-[10px] text-slate-400 font-semibold">N/A (Unsheathed)</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onToggleProcess(m.id, 's')}
                          className={`px-2 py-1 rounded text-[10px] font-bold transition-all inline-flex items-center gap-1 ${
                            m.pStatus?.s
                              ? 'bg-emerald-600 text-white shadow-2xs cursor-pointer'
                              : lock.isUnlocked
                              ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer'
                              : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300 cursor-not-allowed'
                          }`}
                          title={
                            lock.isUnlocked
                              ? 'Click to toggle Sheathing stage for this cable'
                              : `Locked: Complete ${lock.missingPrerequisiteLabel} first`
                          }
                        >
                          {m.pStatus?.s ? '✓ Sheathed' : lock.isUnlocked ? '⏳ Pending' : `🔒 Do ${m.cores > 1 ? 'Twisting' : 'Insulation'} 1st`}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-300">
              <tr>
                <td colSpan={10} className="p-2.5 border-r border-slate-200 text-right uppercase">
                  TOTAL SHEATHING SUMMARY:
                </td>
                <td className="p-2.5 border-r border-slate-200 text-right font-bold">
                  {matchingOrders.reduce((s, m) => s + m.orderLen, 0).toLocaleString()} m
                </td>
                <td className="p-2.5 border-r border-slate-200 text-right font-bold text-amber-900">
                  {fmtExact(totalSheathWt, 4)} kg
                </td>
                <td className="p-2.5 border-r border-slate-200 text-right font-black text-amber-950 bg-amber-100/70">
                  {sDone ? '✓ 0.00 kg' : `${fmtExact(matchingOrders.filter(m => !m.pStatus?.s).reduce((s, m) => s + m.reqSheath, 0), 2)} kg`}
                </td>
                <td className="p-2.5 text-center font-bold">
                  {sDone ? <span className="text-emerald-700">✓ ALL SHEATHED</span> : <span className="text-amber-800">IN PROGRESS</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Print Legends & Instructions */}
        <div className="p-3.5 bg-amber-50/70 border-t-2 border-dashed border-amber-400">
          <div className="text-xs font-bold text-amber-900 uppercase tracking-wide mb-2 flex items-center justify-between">
            <span>🖨️ CABLE PRINT LEGEND / MARKING DETAILS (ONE LINE PER SIZE)</span>
          </div>

          <div className="space-y-2">
            {matchingOrders.map(m => (
              <div key={m.id} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 items-center">
                <span className="text-xs font-bold text-amber-950">
                  {m.cores}C × {m.size} ({m.grade}):
                </span>
                <input
                  type="text"
                  value={m.print_details || ''}
                  onChange={(e) => onUpdateOrder({ ...m, print_details: e.target.value })}
                  placeholder="Enter cable printing legend..."
                  className="w-full px-2.5 py-1 border border-amber-300 rounded bg-white font-semibold text-xs text-slate-900 focus:outline-none focus:border-amber-600"
                />
              </div>
            ))}
          </div>

          <div className="mt-3 pt-2.5 border-t border-dashed border-amber-300">
            <label className="block text-[11px] font-bold text-amber-900 uppercase mb-1">
              SPECIAL PRINTING / DRUM / PACKING INSTRUCTIONS:
            </label>
            <input
              type="text"
              value={sheathNotes}
              onChange={(e) => setSheathNotes(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-amber-400 rounded bg-white font-semibold text-xs text-slate-800"
            />
          </div>
        </div>
        {renderPrintStageSheetFooter('STAGE 5: SHEATHING PROCESS')}
      </div>
      )}
    </div>
  );
};
