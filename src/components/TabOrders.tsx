import React, { useState, useRef, useEffect, useMemo } from 'react';
import { BatchHistoryEntry, CableOrder, ColourMapRule, ContainerPlan, DensitySettings, LadiDimensionRule, PackagingRule, SizePackagingRule } from '../types/cable';
import {
  computeRecordRow,
  evaluateSpoolSizeForOrder,
  fmtExact,
  getContainerAssignmentsForOrder,
  getOrderProgressStats,
  getStageLockState,
  isCoilOrCartonOrder,
  isOrderBunched,
  isOrderComplete,
  isOrderInsulated,
  isOrderSheathed,
  ProcessStageKey,
  STAGE_SHORT_LABELS,
} from '../utils/calculations';
import {
  computeIs694CartonPackingForOrder,
  formatMixBreakdownLabel,
  inferStandardFromBrand,
  Is694CartonMode,
  Is694CartonStandardKey,
  loadMaruMiracleCartonRules,
  loadVihanTriguardCartonRules,
  lookupIs694CartonSpec,
  MaruMiracleCartonRule,
  releasePartialProductionPlanForOrder,
  resetPartialProductionPlanForOrder,
  saveMaruMiracleCartonRules,
  saveVihanTriguardCartonRules,
  sumMixBreakdown,
  VihanTriguardCartonRule,
} from '../utils/is694CartonPackaging';
import {
  getGradePrintPresets,
  loadCustomPrintTemplates,
  saveCustomPrintTemplateForGrade,
} from '../utils/gradePrintTemplates';
import { Is694CartonMasterTables } from './Is694CartonMasterTables';
import { Plus, Search, Edit2, Copy, Trash2, Sliders, CheckCircle2, Clock, X, Filter, Activity, CheckCheck, Printer, Flag, Lock, Ship, Calendar, History, RotateCcw, Link2, Box, Zap, Sparkles, BookmarkPlus, Check, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

type ActiveOrderSortField =
  | 'priority'
  | 'batch'
  | 'status'
  | 'brand'
  | 'conductor'
  | 'coreOd'
  | 'insDie'
  | 'nozzle'
  | 'insCompound'
  | 'cores'
  | 'size'
  | 'extNozzle'
  | 'finalDia'
  | 'finalDie'
  | 'sheathColour'
  | 'sheathComp'
  | 'coils'
  | 'orderLen'
  | 'grade';

interface TabOrdersProps {
  orders: CableOrder[];
  containers?: ContainerPlan[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  sizeRules?: SizePackagingRule[];
  packagingRules?: PackagingRule[];
  colourMap?: ColourMapRule[];
  is694VihanRules?: VihanTriguardCartonRule[];
  is694MaruRules?: MaruMiracleCartonRule[];
  batchHistory?: BatchHistoryEntry[];
  onClearBatchHistory?: (batchName?: string) => void;
  onAddOrUpdateOrder: (order: CableOrder, lockBatch: boolean) => void;
  onDeleteOrder: (id: number) => void;
  onClearAllOrders?: () => void;
  onDuplicateOrder: (id: number) => void;
  onToggleProcess: (orderId: number, processKey: 'b' | 'c' | 'i' | 't' | 's') => void;
  onSelectForRequisition: (batch: string, brand: string, size: string, orderId?: number) => void;
  onOpenContainer?: (containerId?: string) => void;
  onExportCsv: () => void;
  stockLedger?: any;
}

export const TabOrders: React.FC<TabOrdersProps> = ({
  orders,
  containers = [],
  densities,
  ladiDimensions,
  sizeRules = [],
  packagingRules = [],
  colourMap = [],
  is694VihanRules,
  is694MaruRules,
  batchHistory = [],
  onClearBatchHistory,
  onAddOrUpdateOrder,
  onDeleteOrder,
  onClearAllOrders,
  onDuplicateOrder,
  onToggleProcess,
  onSelectForRequisition,
  onOpenContainer,
  onExportCsv,
}) => {
  const [filterBatch, setFilterBatch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [lockBatchMode, setLockBatchMode] = useState(true);
  const [trackingOrderId, setTrackingOrderId] = useState<number | null>(null);
  const [historyBatchView, setHistoryBatchView] = useState<string | null>(null);
  const [printFriendly, setPrintFriendly] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [sortField, setSortField] = useState<ActiveOrderSortField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSortColumn = (field: ActiveOrderSortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortField(null);
        setSortDirection('asc');
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const renderSortIcon = (field: ActiveOrderSortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-70 group-hover:opacity-100 shrink-0 inline-block ml-1" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-blue-600 shrink-0 inline-block ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-blue-600 shrink-0 inline-block ml-1" />
    );
  };

  const formatHistoryTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'SELECT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Form states
  const [editId, setEditId] = useState<number | null>(null);
  const [batch, setBatch] = useState('');
  const [brand, setBrand] = useState('');
  const [grade, setGrade] = useState('H07RN-F');
  const [cores, setCores] = useState(3);
  const [size, setSize] = useState('1.50 SQ MM');
  const [conductor, setConductor] = useState('30/0.210');
  const [coreOd, setCoreOd] = useState('2.8');
  const [insCompound, setInsCompound] = useState('A 80 UW');
  const [finalDia, setFinalDia] = useState('8.7');
  const [sheathCompound, setSheathCompound] = useState('A80 HD BLACK');
  const [sheathColour, setSheathColour] = useState('BLACK');
  const [coils, setCoils] = useState('');
  const [coilType, setCoilType] = useState('100 YARD');
  const [orderLength, setOrderLength] = useState('1000');
  const [printDetails, setPrintDetails] = useState('');
  const [insColour, setInsColour] = useState('');
  const [colourCoilsMap, setColourCoilsMap] = useState<Record<string, string>>({
    RED: '',
    YELLOW: '',
    BLUE: '',
    BLACK: '',
    GREEN: '',
    'YL/GN': '',
    WHITE: '',
    GREY: '',
  });
  const [cartonStandard, setCartonStandard] = useState<Is694CartonStandardKey>('VIHAN_OPTO');
  const [cartonMode, setCartonMode] = useState<Is694CartonMode>('INDIVIDUAL');
  const [cartonCount, setCartonCount] = useState<string>('');
  const [coilsPerCarton, setCoilsPerCarton] = useState<string>('16');
  const [partialPlanCoils, setPartialPlanCoils] = useState<string>('');
  const [partialPlanModalOrderId, setPartialPlanModalOrderId] = useState<number | null>(null);
  const [modalGiveCoilsInput, setModalGiveCoilsInput] = useState<string>('100');
  const [modalLotNotesInput, setModalLotNotesInput] = useState<string>('');
  const [showIs694CartonTables, setShowIs694CartonTables] = useState<boolean>(true);
  const [showIs694OrderSheet, setShowIs694OrderSheet] = useState<boolean>(true);
  const [showIs694StandardsSheet, setShowIs694StandardsSheet] = useState<boolean>(true);
  const [vihanRules, setVihanRules] = useState(() =>
    is694VihanRules && is694VihanRules.length > 0 ? is694VihanRules : loadVihanTriguardCartonRules()
  );
  const [maruRules, setMaruRules] = useState(() =>
    is694MaruRules && is694MaruRules.length > 0 ? is694MaruRules : loadMaruMiracleCartonRules()
  );
  const [isHighPriority, setIsHighPriority] = useState<boolean>(false);
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | 'HIGH'>('ALL');
  const [customPrintTemplates, setCustomPrintTemplates] = useState<Record<string, string[]>>(() =>
    loadCustomPrintTemplates()
  );
  const [inlineEditingPrintOrderId, setInlineEditingPrintOrderId] = useState<number | null>(null);
  const [inlinePrintText, setInlinePrintText] = useState<string>('');

  const activeGradePrintPresets = useMemo(() => {
    return getGradePrintPresets(
      grade,
      brand,
      cores,
      size,
      insColour,
      orders,
      customPrintTemplates
    );
  }, [grade, brand, cores, size, insColour, orders, customPrintTemplates]);

  const handleSaveCustomPrintPreset = () => {
    if (!printDetails.trim()) return;
    const updated = saveCustomPrintTemplateForGrade(grade, printDetails.trim());
    setCustomPrintTemplates(updated);
  };

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

  const IS694_COLOUR_OPTIONS = ['MIX', 'RED', 'YELLOW', 'BLUE', 'BLACK', 'GREEN', 'YL/GN', 'WHITE', 'GREY', 'BROWN'];

  const COIL_OPTIONS = [
    { value: '100 YARD', label: '100 YARD (91.5m)', multiplier: 91.5 },
    { value: '100 MTR', label: '100 MTR', multiplier: 100 },
    { value: '90 MTR', label: '90 MTR', multiplier: 90 },
    { value: '45 MTR', label: '45 MTR', multiplier: 45 },
    { value: '180 MTR', label: '180 MTR', multiplier: 180 },
  ] as const;

  const getCoilMultiplier = (type: string) => {
    const found = COIL_OPTIONS.find(opt => opt.value === type);
    return found ? found.multiplier : 91.5;
  };

  const uniqueBatches = Array.from(new Set(orders.map(o => o.batch))).sort();
  const uniqueBrands = Array.from(new Set(orders.map(o => o.brand))).sort();
  const uniqueConductors = Array.from(new Set(orders.map(o => o.conductor))).sort();
  const uniqueGrades = Array.from(
    new Set([
      'IS-694',
      'H07RN-F',
      'H05RN-F',
      'H05VV-F',
      'YSLY-JZ',
      'YSLY-OZ',
      'NYY-JZ',
      'H07V-R',
      'CONTROL CABLE',
      ...sizeRules.map(r => r.grade).filter(Boolean),
      ...colourMap.map(c => c.grade).filter(Boolean),
      ...orders.map(o => o.grade).filter(Boolean),
    ])
  );

  const insulationCompoundList = Array.from(
    new Set([
      ...Object.keys(densities.INSULATION || {}),
      'KI-06',
      'A 80 UW',
      'A 80 NATURAL',
    ])
  );

  const sheathCompoundList = Array.from(
    new Set([
      ...Object.keys(densities.SHEATH || {}),
      'KI-05',
      'A80 HD BLACK',
      'A 80 NATURAL',
      'ST-1 GREY',
    ])
  );

  const handleSizeOrGradeChange = (newSize: string, newCores: number, newGrade: string) => {
    const isIs694 = newGrade.trim().toUpperCase().includes('IS-694');
    const effectiveCores = isIs694 ? 1 : newCores;
    setSize(newSize);
    setCores(effectiveCores);
    setGrade(newGrade);

    // Auto-fill specs from existing orders
    const match = orders.find(o => o.size === newSize && Number(o.cores) === effectiveCores && o.grade === newGrade)
      || orders.find(o => o.size === newSize && o.grade === newGrade)
      || orders.find(o => o.size === newSize);

    if (match) {
      setConductor(match.conductor);
      setCoreOd(String(match.core_od));
      if (match.ins_compound) setInsCompound(match.ins_compound);
      if (isIs694) {
        setFinalDia('0');
        setSheathCompound('');
        setSheathColour('');
        if (!insColour) setInsColour(match.ins_colour || 'RED');
      } else {
        if (match.final_dia) setFinalDia(String(match.final_dia));
        if (match.sheath_compound) setSheathCompound(match.sheath_compound);
        if (match.sheath_colour) setSheathColour(match.sheath_colour);
      }
    } else if (isIs694 || (effectiveCores === 1 && newGrade === 'H07V-R')) {
      setFinalDia('0');
      setSheathCompound('');
      setSheathColour('');
      if (isIs694 && !insColour) setInsColour('RED');
    }

    if (isIs694) {
      const activeCoilOpt = coilType === '100 YARD' ? '90 MTR' : coilType;
      if (coilType === '100 YARD') setCoilType('90 MTR');
      const spec = lookupIs694CartonSpec(newSize, cartonStandard, activeCoilOpt, vihanRules, maruRules);
      const cpc =
        cartonMode === 'MIX' && sumMixBreakdown(spec.mixPerCarton) > 0
          ? sumMixBreakdown(spec.mixPerCarton)
          : spec.coilsPerCarton;
      setCoilsPerCarton(String(cpc));
      if (cartonStandard === 'MARU_MIRACLE' && spec.maruConductor && spec.maruInsOd) {
        setConductor(spec.maruConductor);
        setCoreOd(String(spec.maruInsOd));
        setInsCompound('KI-13');
      }
    }

    if (!editId) {
      const colSuffix = isIs694 ? ` ${insColour || 'RED'}` : '';
      const corePrefix = isIs694 ? '' : `${effectiveCores}C X `;
      if (isIs694 && cartonStandard === 'MARU_MIRACLE') {
        setPrintDetails(`MARU MIRACLE - FR ${newSize} 1100V (ISI LOGO) IS:694 CM/L 0003894486`);
      } else {
        setPrintDetails(`${brand ? brand + ' ' : ''}${newGrade} ${corePrefix}${newSize}${colSuffix}`);
      }
    }
  };

  const applyIs694CartonCalculation = (
    nextStandard: Is694CartonStandardKey,
    nextMode: Is694CartonMode,
    nextCartonsStr: string,
    nextCpcStr: string,
    activeSize: string = size,
    activeCoilOpt: string = coilType
  ) => {
    const spec = lookupIs694CartonSpec(activeSize, nextStandard, activeCoilOpt, vihanRules, maruRules);
    const resolvedCpc =
      parseFloat(nextCpcStr) > 0
        ? parseFloat(nextCpcStr)
        : nextMode === 'MIX' && sumMixBreakdown(spec.mixPerCarton) > 0
        ? sumMixBreakdown(spec.mixPerCarton)
        : spec.coilsPerCarton;

    const numCartons = parseFloat(nextCartonsStr);
    if (!isNaN(numCartons) && numCartons > 0) {
      if (nextMode === 'MIX' && sumMixBreakdown(spec.mixPerCarton) > 0) {
        const nextMap: Record<string, string> = {
          RED: spec.mixPerCarton.RED > 0 ? String(Math.round(spec.mixPerCarton.RED * numCartons)) : '',
          BLACK: spec.mixPerCarton.BLACK > 0 ? String(Math.round(spec.mixPerCarton.BLACK * numCartons)) : '',
          BLUE: spec.mixPerCarton.BLUE > 0 ? String(Math.round(spec.mixPerCarton.BLUE * numCartons)) : '',
          YELLOW: spec.mixPerCarton.YELLOW > 0 ? String(Math.round(spec.mixPerCarton.YELLOW * numCartons)) : '',
          GREEN: spec.mixPerCarton.GREEN > 0 ? String(Math.round(spec.mixPerCarton.GREEN * numCartons)) : '',
          'YL/GN': '',
          WHITE: '',
          GREY: '',
        };
        setColourCoilsMap(nextMap);
        const activeEntries = Object.entries(nextMap)
          .map(([k, v]) => [k, parseFloat(v) || 0] as [string, number])
          .filter(([, c]) => c > 0);
        const totalCoilsCount = activeEntries.reduce((s, [, c]) => s + c, 0);
        setCoils(String(totalCoilsCount));
        const mult = getCoilMultiplier(activeCoilOpt);
        setOrderLength((totalCoilsCount * mult).toFixed(1).replace(/\.0$/, ''));
        setInsColour(activeEntries.map(([k, c]) => `${k}: ${c}`).join(', '));
      } else {
        const totalCoilsCount = Math.round(numCartons * resolvedCpc);
        setCoils(String(totalCoilsCount));
        const mult = getCoilMultiplier(activeCoilOpt);
        setOrderLength((totalCoilsCount * mult).toFixed(1).replace(/\.0$/, ''));
      }
    }
  };

  const handleColourCoilsMapChange = (colKey: string, val: string, activeCoilOpt: string = coilType) => {
    const updated: Record<string, string> = { ...colourCoilsMap, [colKey]: val };
    setColourCoilsMap(updated);

    const activeEntries = Object.entries(updated)
      .map(([k, v]) => [k, parseFloat(v) || 0] as [string, number])
      .filter(([, count]) => count > 0);

    if (activeEntries.length > 0) {
      const totalCoilsCount = activeEntries.reduce((acc, [, c]) => acc + c, 0);
      setCoils(String(totalCoilsCount));
      const mult = getCoilMultiplier(activeCoilOpt);
      setOrderLength((totalCoilsCount * mult).toFixed(1).replace(/\.0$/, ''));
      const cpcNum = parseFloat(coilsPerCarton) || 0;
      if (cpcNum > 0) {
        setCartonCount((totalCoilsCount / cpcNum).toFixed(2).replace(/\.00$/, ''));
      }
      if (activeEntries.length === 1) {
        setInsColour(activeEntries[0][0]);
      } else {
        setInsColour(activeEntries.map(([k, c]) => `${k}: ${c}`).join(', '));
      }
    }
  };

  const handleCoilsChange = (val: string, selectedType: string = coilType) => {
    setCoils(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      const mult = getCoilMultiplier(selectedType);
      setOrderLength((num * mult).toFixed(1).replace(/\.0$/, ''));
      const isIs694Grade = grade.trim().toUpperCase().includes('IS-694');
      if (isIs694Grade && cartonMode === 'MIX') {
        const spec = lookupIs694CartonSpec(size, cartonStandard, selectedType, vihanRules, maruRules);
        const mixSum = sumMixBreakdown(spec.mixPerCarton);
        const cpcNum = parseFloat(coilsPerCarton) || mixSum || spec.coilsPerCarton || 16;
        const calcCtns = cpcNum > 0 ? num / cpcNum : 0;
        if (calcCtns > 0) {
          setCartonCount(calcCtns.toFixed(2).replace(/\.00$/, ''));
        }
        if (mixSum > 0) {
          const nextMap: Record<string, string> = {
            RED: spec.mixPerCarton.RED > 0 ? String(Math.round((spec.mixPerCarton.RED / mixSum) * num)) : '',
            BLACK: spec.mixPerCarton.BLACK > 0 ? String(Math.round((spec.mixPerCarton.BLACK / mixSum) * num)) : '',
            BLUE: spec.mixPerCarton.BLUE > 0 ? String(Math.round((spec.mixPerCarton.BLUE / mixSum) * num)) : '',
            YELLOW: spec.mixPerCarton.YELLOW > 0 ? String(Math.round((spec.mixPerCarton.YELLOW / mixSum) * num)) : '',
            GREEN: spec.mixPerCarton.GREEN > 0 ? String(Math.round((spec.mixPerCarton.GREEN / mixSum) * num)) : '',
            'YL/GN': '',
            WHITE: '',
            GREY: '',
          };
          setColourCoilsMap(nextMap);
          const activeEntries = Object.entries(nextMap)
            .map(([k, v]) => [k, parseFloat(v) || 0] as [string, number])
            .filter(([, c]) => c > 0);
          if (activeEntries.length > 0) {
            setInsColour(activeEntries.map(([k, c]) => `${k}: ${c}`).join(', '));
          }
        }
        return;
      }
      const cpcNum = parseFloat(coilsPerCarton) || 0;
      if (cpcNum > 0) {
        setCartonCount((num / cpcNum).toFixed(2).replace(/\.00$/, ''));
      }
    }
  };

  const handleSelectMixOptionForIs694 = (
    activeStd: Is694CartonStandardKey = cartonStandard,
    activeSize: string = size,
    activeCoilOpt: string = coilType
  ) => {
    setCartonMode('MIX');
    const spec = lookupIs694CartonSpec(activeSize, activeStd, activeCoilOpt, vihanRules, maruRules);
    const mixCpc =
      sumMixBreakdown(spec.mixPerCarton) > 0
        ? sumMixBreakdown(spec.mixPerCarton)
        : spec.coilsPerCarton || 16;
    setCoilsPerCarton(String(mixCpc));
    const currentCoilsNum = parseFloat(coils);
    const defaultCtns =
      cartonCount && parseFloat(cartonCount) > 0
        ? cartonCount
        : !isNaN(currentCoilsNum) && currentCoilsNum > 0 && mixCpc > 0
        ? (currentCoilsNum / mixCpc).toFixed(2).replace(/\.00$/, '')
        : '1';
    setCartonCount(defaultCtns);
    applyIs694CartonCalculation(activeStd, 'MIX', defaultCtns, String(mixCpc), activeSize, activeCoilOpt);
  };

  const handleCoilTypeChange = (newType: string) => {
    setCoilType(newType);
    if (grade.trim().toUpperCase().includes('IS-694')) {
      const spec = lookupIs694CartonSpec(size, cartonStandard, newType, vihanRules, maruRules);
      const nextCpc =
        cartonMode === 'MIX' && sumMixBreakdown(spec.mixPerCarton) > 0
          ? sumMixBreakdown(spec.mixPerCarton)
          : spec.coilsPerCarton;
      setCoilsPerCarton(String(nextCpc));
      if (cartonCount) {
        applyIs694CartonCalculation(cartonStandard, cartonMode, cartonCount, String(nextCpc), size, newType);
        return;
      }
    }
    const num = parseFloat(coils);
    if (!isNaN(num) && num > 0) {
      const mult = getCoilMultiplier(newType);
      setOrderLength((num * mult).toFixed(1).replace(/\.0$/, ''));
    }
  };

  const handleInlineCoilUpdate = (order: CableOrder, nextCoilsRaw: string, nextCoilType: string) => {
    const parsedCoils = nextCoilsRaw !== '' ? parseFloat(nextCoilsRaw) : '';
    const mult = getCoilMultiplier(nextCoilType);
    const nextOrderLen =
      typeof parsedCoils === 'number' && !isNaN(parsedCoils) && parsedCoils > 0
        ? Number((parsedCoils * mult).toFixed(1))
        : order.order_length;

    onAddOrUpdateOrder(
      {
        ...order,
        coils: typeof parsedCoils === 'number' && !isNaN(parsedCoils) ? parsedCoils : '',
        coil_type: typeof parsedCoils === 'number' && !isNaN(parsedCoils) && parsedCoils > 0 ? nextCoilType : (nextCoilsRaw ? nextCoilType : ''),
        order_length: nextOrderLen,
      },
      true
    );
  };

  const handleInlineInsColourUpdate = (order: CableOrder, newInsCol: string) => {
    if (newInsCol.toUpperCase() === 'MIX' && (order.grade || '').toUpperCase().includes('IS-694')) {
      const std = order.carton_standard || inferStandardFromBrand(order.brand);
      const cType = order.coil_type || '90 MTR';
      const mult = getCoilMultiplier(cType);
      const spec = lookupIs694CartonSpec(order.size, std, cType, vihanRules, maruRules);
      const mixSum = sumMixBreakdown(spec.mixPerCarton);
      const cpc = mixSum > 0 ? mixSum : spec.coilsPerCarton || 16;
      const totalOrderCoils =
        order.coils !== undefined && order.coils !== '' && Number(order.coils) > 0
          ? Number(order.coils)
          : mult > 0
          ? Math.round(order.order_length / mult)
          : cpc;
      const ctns = cpc > 0 ? Number((totalOrderCoils / cpc).toFixed(2)) : 1;
      const bMap: Record<string, number> = {};
      if (mixSum > 0) {
        (['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).forEach(col => {
          const perCtn = spec.mixPerCarton[col] || 0;
          if (perCtn > 0) {
            bMap[col] = Math.round((perCtn / mixSum) * totalOrderCoils);
          }
        });
      }
      const nextInsStr =
        Object.keys(bMap).length > 0
          ? Object.entries(bMap)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
          : 'MIX';
      onAddOrUpdateOrder(
        {
          ...order,
          carton_mode: 'MIX',
          carton_standard: std,
          coils_per_carton: cpc,
          carton_count: ctns,
          coils: totalOrderCoils,
          coil_type: cType,
          order_length: Number((totalOrderCoils * mult).toFixed(1)),
          coil_colour_breakdown: Object.keys(bMap).length > 0 ? bMap : order.coil_colour_breakdown,
          ins_colour: nextInsStr,
        },
        true
      );
      return;
    }

    onAddOrUpdateOrder(
      {
        ...order,
        carton_mode: (order.grade || '').toUpperCase().includes('IS-694') ? 'INDIVIDUAL' : order.carton_mode,
        coil_colour_breakdown: undefined,
        ins_colour: newInsCol,
      },
      true
    );
  };

  const resetForm = () => {
    setEditId(null);
    setBatch('');
    setBrand('');
    setInsColour('');
    setColourCoilsMap({
      RED: '',
      YELLOW: '',
      BLUE: '',
      BLACK: '',
      GREEN: '',
      'YL/GN': '',
      WHITE: '',
      GREY: '',
    });
    setCoils('');
    setPartialPlanCoils('');
    setCoilType('100 YARD');
    setPrintDetails('');
    setIsHighPriority(false);
  };

  const handleOpenPartialPlanModal = (order: CableOrder) => {
    const mult = getCoilMultiplier(order.coil_type || '90 MTR');
    const availCoils =
      order.coils !== undefined && order.coils !== '' && Number(order.coils) >= 0
        ? Number(order.coils)
        : mult > 0
        ? Math.round(order.order_length / mult)
        : 0;
    const defaultGive =
      availCoils >= 400
        ? 100
        : availCoils > 100
        ? 100
        : availCoils > 0
        ? availCoils
        : 100;
    setPartialPlanModalOrderId(order.id);
    setModalGiveCoilsInput(String(defaultGive));
    setModalLotNotesInput('');
  };

  const handleConfirmPartialPlan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partialPlanModalOrderId) return;
    const targetOrder = orders.find(o => o.id === partialPlanModalOrderId);
    if (!targetOrder) return;
    const giveCoils = parseFloat(modalGiveCoilsInput);
    if (isNaN(giveCoils) || giveCoils <= 0) return;

    const updatedOrder = releasePartialProductionPlanForOrder(
      targetOrder,
      giveCoils,
      vihanRules,
      maruRules,
      new Date().toISOString().split('T')[0],
      modalLotNotesInput.trim() || undefined
    );
    onAddOrUpdateOrder(updatedOrder, true);
    setPartialPlanModalOrderId(null);
  };

  const handleResetPartialPlan = (order: CableOrder) => {
    const restored = resetPartialProductionPlanForOrder(order);
    onAddOrUpdateOrder(restored, true);
  };

  const handleEdit = (order: CableOrder) => {
    setEditId(order.id);
    setBatch(order.batch);
    setBrand(order.brand);
    setGrade(order.grade || 'H05VV-F');
    setCores(order.cores);
    setSize(order.size);
    setConductor(order.conductor);
    setCoreOd(String(order.core_od));
    setInsCompound(order.ins_compound);
    setFinalDia(String(order.final_dia || 0));
    setSheathCompound(order.sheath_compound || '');
    setSheathColour(order.sheath_colour || '');
    setInsColour(order.ins_colour || (order.grade?.toUpperCase().includes('IS-694') ? 'RED' : ''));
    setCartonStandard(order.carton_standard || inferStandardFromBrand(order.brand));
    setCartonMode(order.carton_mode || 'INDIVIDUAL');
    setCartonCount(order.carton_count !== undefined ? String(order.carton_count) : '');
    setCoilsPerCarton(order.coils_per_carton !== undefined ? String(order.coils_per_carton) : '16');
    const nextMap: Record<string, string> = {
      RED: '',
      YELLOW: '',
      BLUE: '',
      BLACK: '',
      GREEN: '',
      'YL/GN': '',
      WHITE: '',
      GREY: '',
    };
    if (order.coil_colour_breakdown) {
      Object.entries(order.coil_colour_breakdown).forEach(([k, v]) => {
        if (v > 0) nextMap[k.toUpperCase()] = String(v);
      });
    }
    setColourCoilsMap(nextMap);
    setCoils(order.coils !== undefined && order.coils !== '' ? String(order.coils) : '');
    setPartialPlanCoils('');
    setCoilType(order.coil_type || '100 YARD');
    setOrderLength(String(order.order_length));
    setPrintDetails(order.print_details || '');
    setIsHighPriority(!!(order.is_high_priority || order.priority === 'high'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTogglePriority = (order: CableOrder) => {
    const currentVal = !!(order.is_high_priority || order.priority === 'high');
    const nextVal = !currentVal;
    onAddOrUpdateOrder(
      {
        ...order,
        is_high_priority: nextVal,
        priority: nextVal ? 'high' : 'normal',
      },
      true
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const len = parseFloat(orderLength) || 0;
    if (!batch.trim() || !brand.trim() || !conductor.trim() || !size.trim() || len <= 0) {
      alert('Please fill in Batch, Brand, Conductor, Size, and a valid Order Length.');
      return;
    }

    const breakdownObj: Record<string, number> = {};
    Object.entries(colourCoilsMap).forEach(([k, v]) => {
      const n = parseFloat(v);
      if (!isNaN(n) && n > 0) {
        breakdownObj[k] = n;
      }
    });
    const hasBreakdown = Object.keys(breakdownObj).length > 0;
    const isIs694Grade = grade.trim().toUpperCase().includes('IS-694');
    const resolvedInsColour = insColour.trim() || (isIs694Grade ? 'RED' : '');

    const existing = editId ? orders.find(o => o.id === editId) : undefined;
    let orderObj: CableOrder = {
      ...(existing ? {
        pStatus: existing.pStatus,
        spool_size: existing.spool_size,
        meter_marking: existing.meter_marking,
        notes: existing.notes,
        issued: existing.issued,
        actual_weight: existing.actual_weight,
        tare_weight: existing.tare_weight,
        total_order_coils: existing.total_order_coils,
        total_order_length: existing.total_order_length,
        total_coil_colour_breakdown: existing.total_coil_colour_breakdown,
        planned_coils: existing.planned_coils,
        remaining_coils: existing.remaining_coils,
        production_lots: existing.production_lots,
        active_plan_lot_id: existing.active_plan_lot_id,
      } : {}),
      id: editId || (orders.length > 0 ? Math.max(...orders.map(o => o.id)) + 1 : 1),
      record_row: existing?.record_row || orders.length + 12,
      batch: batch.trim(),
      brand: brand.trim(),
      grade: grade.trim(),
      cores: Number(cores) || 1,
      size: size.trim(),
      conductor: conductor.trim(),
      core_od: parseFloat(coreOd) || 0,
      ins_compound: insCompound.trim(),
      ins_colour: resolvedInsColour || undefined,
      coil_colour_breakdown: hasBreakdown ? breakdownObj : undefined,
      carton_standard: isIs694Grade ? cartonStandard : undefined,
      carton_mode: isIs694Grade ? cartonMode : undefined,
      carton_count: isIs694Grade && parseFloat(cartonCount) > 0 ? parseFloat(cartonCount) : undefined,
      coils_per_carton: isIs694Grade && parseFloat(coilsPerCarton) > 0 ? parseFloat(coilsPerCarton) : undefined,
      final_dia: parseFloat(finalDia) || 0,
      sheath_compound: sheathCompound.trim(),
      sheath_colour: sheathColour.trim(),
      coils: coils ? parseFloat(coils) : '',
      coil_type: coils ? coilType : '',
      order_length: len,
      print_details:
        printDetails.trim() ||
        `${brand.trim()} ${grade.trim()} ${isIs694Grade ? '' : `${cores}C X `}${size.trim()}${
          resolvedInsColour ? ` (${resolvedInsColour})` : ''
        }`,
      print_colour: sheathColour.trim().toUpperCase() === 'WHITE' ? 'BLACK' : 'WHITE',
      is_high_priority: isHighPriority,
      priority: isHighPriority ? 'high' : 'normal',
    };

    // If user entered a Partial Production Plan Coils (e.g., 100 coils out of 400 coils), release it immediately!
    const givePlanNum = parseFloat(partialPlanCoils);
    const totalEnteredCoils = parseFloat(coils);
    if (!isNaN(givePlanNum) && givePlanNum > 0 && !isNaN(totalEnteredCoils) && givePlanNum < totalEnteredCoils) {
      orderObj = releasePartialProductionPlanForOrder(
        orderObj,
        givePlanNum,
        vihanRules,
        maruRules,
        new Date().toISOString().split('T')[0],
        `Partial Production Plan (${givePlanNum} of ${totalEnteredCoils} Coils)`
      );
    }

    onAddOrUpdateOrder(orderObj, lockBatchMode);
    setPartialPlanCoils('');

    if (editId) {
      setEditId(null);
    } else if (!lockBatchMode) {
      resetForm();
    }
  };

  // Filter active orders (not completed)
  const activeOrders = orders.filter(o => !isOrderComplete(o, ladiDimensions));
  const highPriorityCount = activeOrders.filter(o => o.is_high_priority || o.priority === 'high').length;

  const parseCableSizeNumeric = (sizeStr: string): number => {
    const match = String(sizeStr || '').match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  };

  const baseFilteredOrders = activeOrders.filter(o => {
    if (priorityFilter === 'HIGH' && !(o.is_high_priority || o.priority === 'high')) return false;
    if (filterBatch && o.batch !== filterBatch) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const contMatches = getContainerAssignmentsForOrder(o, containers).some(
        ca =>
          ca.containerNo.toLowerCase().includes(q) ||
          (ca.plannedStuffingDate || '').toLowerCase().includes(q) ||
          (ca.bookingNo || '').toLowerCase().includes(q)
      );
      const match = o.batch.toLowerCase().includes(q)
        || o.brand.toLowerCase().includes(q)
        || o.size.toLowerCase().includes(q)
        || (o.grade || '').toLowerCase().includes(q)
        || o.conductor.toLowerCase().includes(q)
        || `${o.cores}c`.includes(q)
        || `${o.cores} c`.includes(q)
        || (o.print_details || '').toLowerCase().includes(q)
        || contMatches;
      if (!match) return false;
    }
    return true;
  });

  const filteredOrders = [...baseFilteredOrders].sort((a, b) => {
    if (!sortField) return 0;
    const dir = sortDirection === 'asc' ? 1 : -1;
    const recA = computeRecordRow(a, densities, ladiDimensions);
    const recB = computeRecordRow(b, densities, ladiDimensions);

    switch (sortField) {
      case 'priority': {
        const pA = a.is_high_priority || a.priority === 'high' ? 1 : 0;
        const pB = b.is_high_priority || b.priority === 'high' ? 1 : 0;
        return (pA - pB) * dir;
      }
      case 'batch':
        return (
          String(a.batch || '').localeCompare(String(b.batch || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
          }) * dir
        );
      case 'status': {
        const stA = getOrderProgressStats(a, ladiDimensions);
        const stB = getOrderProgressStats(b, ladiDimensions);
        if (stA.percentage !== stB.percentage) {
          return (stA.percentage - stB.percentage) * dir;
        }
        return (stA.completedCount - stB.completedCount) * dir;
      }
      case 'brand':
        return (
          String(a.brand || '').localeCompare(String(b.brand || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
          }) * dir
        );
      case 'conductor':
        return (
          String(a.conductor || '').localeCompare(String(b.conductor || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
          }) * dir
        );
      case 'coreOd':
        return ((recA.coreOd || 0) - (recB.coreOd || 0)) * dir;
      case 'insDie':
        return ((recA.insDie || 0) - (recB.insDie || 0)) * dir;
      case 'nozzle':
        return ((recA.nozzle || 0) - (recB.nozzle || 0)) * dir;
      case 'insCompound':
        return String(a.ins_compound || '').localeCompare(String(b.ins_compound || '')) * dir;
      case 'cores':
        return ((a.cores || 0) - (b.cores || 0)) * dir;
      case 'size': {
        const szDiff = parseCableSizeNumeric(a.size) - parseCableSizeNumeric(b.size);
        if (szDiff !== 0) return szDiff * dir;
        return ((a.cores || 0) - (b.cores || 0)) * dir;
      }
      case 'extNozzle':
        return ((recA.extNozzle || 0) - (recB.extNozzle || 0)) * dir;
      case 'finalDia':
        return ((recA.finalDia || 0) - (recB.finalDia || 0)) * dir;
      case 'finalDie':
        return ((recA.finalDie || 0) - (recB.finalDie || 0)) * dir;
      case 'sheathColour':
        return String(a.sheath_colour || '').localeCompare(String(b.sheath_colour || '')) * dir;
      case 'sheathComp':
        return String(a.sheath_compound || '').localeCompare(String(b.sheath_compound || '')) * dir;
      case 'coils':
        return ((Number(a.coils) || 0) - (Number(b.coils) || 0)) * dir;
      case 'orderLen':
        return ((recA.orderLen || 0) - (recB.orderLen || 0)) * dir;
      case 'grade':
        return String(a.grade || '').localeCompare(String(b.grade || '')) * dir;
      default:
        return 0;
    }
  });

  // Calculate KPIs (Overall + Separate IS-694 Summary)
  let totalLen = 0;
  let totalLenCompleted = 0;
  let totalLenPending = 0;
  let totalCu = 0;
  let totalCuBunched = 0;
  let totalCuToBunch = 0;
  let bunchedOrdersCount = 0;
  let totalIns = 0;
  let totalInsDeducted = 0;
  let totalInsToProcess = 0;
  let insOrdersCount = 0;
  let totalSheath = 0;
  let totalSheathDeducted = 0;
  let totalSheathToProcess = 0;
  let sheathOrdersCount = 0;

  let is694ActiveCount = 0;
  let is694TotalCoils = 0;
  let is694TotalCartons = 0;
  let is694TotalLen = 0;
  let is694TotalCu = 0;
  let is694TotalIns = 0;

  filteredOrders.forEach(o => {
    const r = computeRecordRow(o, densities, ladiDimensions);
    const reqCu = r.reqCu || 0;
    const isBunched = isOrderBunched(o);
    const isIns = isOrderInsulated(o);
    const isSheath = isOrderSheathed(o);
    const isCompleted = isOrderComplete(o, ladiDimensions);

    totalLen += r.orderLen;
    if (isCompleted) {
      totalLenCompleted += r.orderLen;
    } else {
      totalLenPending += r.orderLen;
    }

    totalCu += reqCu;
    if (isBunched) {
      totalCuBunched += reqCu;
      bunchedOrdersCount++;
    } else {
      totalCuToBunch += reqCu;
    }

    totalIns += r.reqIns;
    if (isIns) {
      totalInsDeducted += r.reqIns;
      insOrdersCount++;
    } else {
      totalInsToProcess += r.reqIns;
    }

    totalSheath += r.reqSheath;
    if (isSheath) {
      totalSheathDeducted += r.reqSheath;
      sheathOrdersCount++;
    } else {
      totalSheathToProcess += r.reqSheath;
    }

    if ((o.grade || '').toUpperCase().includes('IS-694')) {
      is694ActiveCount++;
      is694TotalLen += r.orderLen;
      is694TotalCu += r.reqCu;
      is694TotalIns += r.reqIns;
      const cr = computeIs694CartonPackingForOrder(o, densities, ladiDimensions, vihanRules, maruRules);
      is694TotalCoils += cr.totalCoils;
      is694TotalCartons += cr.totalCartons;
    }
  });

  // Batch Progress Aggregation (Serial rule-aware required checkpoints per batch)
  const batchProgressList = uniqueBatches.map(b => {
    const bOrders = orders.filter(o => o.batch === b);
    const brands = Array.from(new Set(bOrders.map(o => o.brand))).join(', ');
    const totalOrders = bOrders.length;
    const completedOrders = bOrders.filter(o => isOrderComplete(o, ladiDimensions)).length;
    const countB = bOrders.filter(o => o.pStatus?.b).length;
    const countC = bOrders.filter(o => o.pStatus?.c).length;
    const countI = bOrders.filter(o => o.pStatus?.i).length;
    const countT = bOrders.filter(o => o.pStatus?.t).length;
    const countS = bOrders.filter(o => o.pStatus?.s).length;

    let totalCheckpoints = 0;
    let completedCheckpoints = 0;
    bOrders.forEach(o => {
      const stats = getOrderProgressStats(o, ladiDimensions);
      totalCheckpoints += stats.totalRequired;
      completedCheckpoints += stats.completedCount;
    });

    const percentage = totalCheckpoints > 0 ? Math.round((completedCheckpoints / totalCheckpoints) * 100) : 0;

    return {
      batch: b,
      brand: brands,
      totalOrders,
      completedOrders,
      countB,
      countC,
      countI,
      countT,
      countS,
      totalCheckpoints,
      completedCheckpoints,
      percentage,
    };
  });

  const totalAllOrders = orders.length;
  const completedAllOrders = orders.filter(o => isOrderComplete(o, ladiDimensions)).length;
  let totalAllCheckpoints = 0;
  let completedAllCheckpoints = 0;
  orders.forEach(o => {
    const stats = getOrderProgressStats(o, ladiDimensions);
    totalAllCheckpoints += stats.totalRequired;
    completedAllCheckpoints += stats.completedCount;
  });
  const overallPercentage = totalAllCheckpoints > 0 ? Math.round((completedAllCheckpoints / totalAllCheckpoints) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Input Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs no-print">
        <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-2">
          <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
            <Sliders className="w-4 h-4 text-blue-600" />
            <span>📝 Easy Order Input & Smart Auto-Fill</span>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-blue-900 cursor-pointer">
              <input
                type="checkbox"
                checked={lockBatchMode}
                onChange={(e) => setLockBatchMode(e.target.checked)}
                className="rounded border-slate-300 text-blue-600"
              />
              🔒 Keep Batch, Brand & Grade Locked after Add (Fast Multi-Size Entry)
            </label>
            <button
              type="button"
              onClick={resetForm}
              className="text-xs px-2.5 py-1 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-medium"
            >
              Reset Form
            </button>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 p-2.5 rounded-lg text-xs text-slate-700 mb-3 flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <span className="font-bold text-blue-800 shrink-0">⚡ Exact Record Lookup:</span>
            <span>
              Selecting <b>Size</b>, <b>Cores</b>, and <b>Grade</b> automatically pulls exact <b>Conductor</b>, <b>PVC Core OD</b>, <b>Ins. Die</b>, <b>Nozzle</b>, <b>Ext. Nozzle</b>, <b>Final Cable OD</b>, and <b>Final Die</b> from your master engineering record sheet.
            </span>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-300 shrink-0">
            <Link2 className="w-3 h-3 text-emerald-600" /> Live Linked to Tab 12 Backup Standards
          </span>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 text-xs items-end">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Batch No *</label>
              <input
                type="text"
                list="dlBatches"
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                placeholder="07/163 or JOB NO-31"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none"
              />
              <datalist id="dlBatches">
                {uniqueBatches.map(b => <option key={b} value={b} />)}
              </datalist>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Brand *</label>
              <input
                type="text"
                list="dlBrands"
                value={brand}
                onChange={(e) => {
                  setBrand(e.target.value);
                  const isIs694 = grade.trim().toUpperCase().includes('IS-694');
                  if (!editId) setPrintDetails(`${e.target.value} ${grade} ${isIs694 ? '' : `${cores}C X `}${size}`);
                }}
                placeholder="EKP, MYBCAB, SANKA"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none"
              />
              <datalist id="dlBrands">
                {uniqueBrands.map(b => <option key={b} value={b} />)}
              </datalist>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Cable Grade *</label>
              <select
                value={grade}
                onChange={(e) => handleSizeOrGradeChange(size, cores, e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none"
              >
                {uniqueGrades.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            {!grade.trim().toUpperCase().includes('IS-694') && (
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">No. of Cores *</label>
                <input
                  type="number"
                  min="1"
                  max="61"
                  value={cores}
                  onChange={(e) => handleSizeOrGradeChange(size, parseInt(e.target.value) || 1, grade)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none text-center"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Size (SQ MM) *</label>
              <select
                value={size}
                onChange={(e) => handleSizeOrGradeChange(e.target.value, cores, grade)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none"
              >
                <option value="0.50 SQ MM">0.50 SQ MM</option>
                <option value="0.75 SQ MM">0.75 SQ MM</option>
                <option value="1.00 SQ MM">1.00 SQ MM</option>
                <option value="1.50 SQ MM">1.50 SQ MM</option>
                <option value="2.50 SQ MM">2.50 SQ MM</option>
                <option value="4.00 SQ MM">4.00 SQ MM</option>
                <option value="6.00 SQ MM">6.00 SQ MM</option>
                <option value="10.00 SQ MM">10.00 SQ MM</option>
                <option value="16.00 SQ MM">16.00 SQ MM</option>
                <option value="25.00 SQ MM">25.00 SQ MM</option>
                <option value="35.00 SQ MM">35.00 SQ MM</option>
                <option value="50.00 SQ MM">50.00 SQ MM</option>
                <option value="70.00 SQ MM">70.00 SQ MM</option>
                <option value="95.00 SQ MM">95.00 SQ MM</option>
                <option value="120.00 SQ MM">120.00 SQ MM</option>
                <option value="150.00 SQ MM">150.00 SQ MM</option>
                <option value="185.00 SQ MM">185.00 SQ MM</option>
                <option value="240.00 SQ MM">240.00 SQ MM</option>
                <option value="300.00 SQ MM">300.00 SQ MM</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Conductor (Strands/Dia) *</label>
              <input
                type="text"
                list="dlConductors"
                value={conductor}
                onChange={(e) => setConductor(e.target.value)}
                placeholder="22/0.210"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none"
              />
              <datalist id="dlConductors">
                {uniqueConductors.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">PVC / Core OD (mm) *</label>
              <input
                type="number"
                step="0.01"
                value={coreOd}
                onChange={(e) => setCoreOd(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                Insulation Compound *
              </label>
              <select
                value={insCompound}
                onChange={(e) => setInsCompound(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none"
              >
                {insulationCompoundList.map(comp => {
                  const factor = densities.INSULATION?.[comp];
                  return (
                    <option key={comp} value={comp}>
                      {comp} {factor !== undefined ? `(${Number(factor).toFixed(5)})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className={grade.trim().toUpperCase().includes('IS-694') ? 'ring-2 ring-rose-500 rounded-md p-1.5 bg-rose-50/80' : ''}>
              <label className="block text-[11px] font-bold text-rose-900 uppercase mb-0.5">
                🎨 Insulation Colour / MIX {grade.trim().toUpperCase().includes('IS-694') ? '(IS-694 *)' : '(Optional)'}
              </label>
              <div className="flex gap-1">
                <select
                  value={
                    grade.trim().toUpperCase().includes('IS-694') && cartonMode === 'MIX'
                      ? 'MIX'
                      : IS694_COLOUR_OPTIONS.includes(insColour.toUpperCase())
                      ? insColour.toUpperCase()
                      : ''
                  }
                  onChange={e => {
                    const val = e.target.value;
                    if (val === 'MIX' && grade.trim().toUpperCase().includes('IS-694')) {
                      handleSelectMixOptionForIs694(cartonStandard, size, coilType);
                      return;
                    }
                    if (grade.trim().toUpperCase().includes('IS-694')) {
                      setCartonMode('INDIVIDUAL');
                      setColourCoilsMap({
                        RED: '',
                        YELLOW: '',
                        BLUE: '',
                        BLACK: '',
                        GREEN: '',
                        'YL/GN': '',
                        WHITE: '',
                        GREY: '',
                      });
                    }
                    setInsColour(val);
                    if (grade.trim().toUpperCase().includes('IS-694') && !editId) {
                      setPrintDetails(`${brand ? brand + ' ' : ''}${grade} ${size} ${val}`.trim());
                    }
                  }}
                  className="w-32 px-2 py-1.5 border border-rose-300 rounded bg-white text-slate-900 font-bold focus:border-rose-600 focus:outline-none"
                >
                  <option value="">-- Select --</option>
                  {IS694_COLOUR_OPTIONS.map(col => (
                    <option key={col} value={col}>
                      {col === 'MIX' ? '📦 MIX (Carton Mix)' : col}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={insColour}
                  onChange={e => setInsColour(e.target.value)}
                  placeholder="MIX or RED / YELLOW..."
                  className="flex-1 min-w-0 px-2 py-1.5 border border-rose-300 rounded bg-white text-slate-900 font-bold focus:border-rose-600 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Final / Cable Dia (mm)</label>
              <input
                type="number"
                step="0.01"
                value={finalDia}
                onChange={(e) => setFinalDia(e.target.value)}
                placeholder="0 for 1C"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                Sheathing Compound
              </label>
              <select
                value={sheathCompound}
                onChange={(e) => setSheathCompound(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none"
              >
                {sheathCompoundList.map(comp => {
                  const factor = densities.SHEATH?.[comp];
                  return (
                    <option key={comp} value={comp}>
                      {comp} {factor !== undefined ? `(${Number(factor).toFixed(5)})` : ''}
                    </option>
                  );
                })}
                <option value="">None (Unsheathed)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Sheath Colour</label>
              <input
                type="text"
                value={sheathColour}
                onChange={(e) => setSheathColour(e.target.value)}
                placeholder="WHITE / BLACK / GRAY"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-semibold focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2 bg-amber-50/70 border border-amber-200 rounded-lg p-2">
              <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                <label className="block text-[11px] font-bold text-amber-950 uppercase">
                  Coils Entry &amp; Length Option
                </label>
                <div className="flex flex-wrap items-center gap-1">
                  {COIL_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleCoilTypeChange(opt.value)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors border ${
                        coilType === opt.value
                          ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                          : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-100'
                      }`}
                      title={`Set coil length option to ${opt.label}`}
                    >
                      {opt.value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <span className="block text-[10px] font-semibold text-slate-500 mb-0.5">Coil Option</span>
                  <select
                    value={coilType}
                    onChange={(e) => handleCoilTypeChange(e.target.value)}
                    className="w-full px-2 py-1.5 border border-amber-300 rounded bg-white text-slate-800 font-bold focus:border-amber-600 focus:outline-none"
                  >
                    {COIL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    Total Order Coils (× {getCoilMultiplier(coilType)}m)
                  </span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={coils}
                    onChange={(e) => handleCoilsChange(e.target.value, coilType)}
                    placeholder="e.g. 400"
                    className="w-full px-2.5 py-1.5 border border-amber-300 rounded bg-white text-slate-800 font-bold focus:border-amber-600 focus:outline-none"
                  />
                </div>
                <div>
                  <span className="block text-[10px] font-extrabold text-indigo-900 mb-0.5">
                    ⚡ Partial Plan Coils (Now)
                  </span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={partialPlanCoils}
                    onChange={(e) => setPartialPlanCoils(e.target.value)}
                    placeholder="e.g. 100 (optional)"
                    title="Give a partial production plan now (e.g. 100 out of 400 coils) — 100 coils will show on IS-694 Packing List & Process Card, and 300 coils will remain on the Order Sheet!"
                    className="w-full px-2.5 py-1.5 border-2 border-indigo-400 rounded bg-indigo-50/50 text-indigo-950 font-black focus:border-indigo-600 focus:outline-none"
                  />
                </div>
              </div>
              {parseFloat(partialPlanCoils) > 0 && parseFloat(coils) > parseFloat(partialPlanCoils) && (
                <div className="mt-1.5 px-2.5 py-1 rounded bg-indigo-900 text-white text-[10.5px] font-bold flex flex-wrap items-center justify-between gap-2">
                  <span>
                    ⚡ Partial Production Plan Active: <strong>{partialPlanCoils} Coils</strong> ({(parseFloat(partialPlanCoils) * getCoilMultiplier(coilType)).toLocaleString()} m) → Sent to IS-694 Packing List &amp; Process Card
                  </span>
                  <span className="bg-amber-400 text-slate-950 px-2 py-0.5 rounded font-black">
                    ⏳ Remaining on Order Sheet: {parseFloat(coils) - parseFloat(partialPlanCoils)} Coils ({((parseFloat(coils) - parseFloat(partialPlanCoils)) * getCoilMultiplier(coilType)).toLocaleString()} m)
                  </span>
                </div>
              )}
            </div>

            {grade.trim().toUpperCase().includes('IS-694') && (
              <div className="sm:col-span-2 lg:col-span-6 bg-rose-50/90 border-2 border-rose-300 rounded-lg p-3 shadow-2xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-black text-rose-950 uppercase tracking-wide flex items-center gap-1.5">
                      <Box className="w-4 h-4 text-rose-700" />
                      🎨 Special IS-694 Grade — Master Carton Packing (Individual &amp; Mix Colour Carton) &amp; Coiling Breakdown
                    </span>
                    <p className="text-[11px] text-rose-800">
                      Select Packing Standard (<strong>Vihan Opto</strong>, <strong>Triguard Box/Stack</strong>, or <strong>Maru Miracle</strong>) and Carton Mode (<strong>Individual Colour Carton</strong> vs <strong>Mix Colour Carton</strong>). Entering Cartons auto-calculates Coils &amp; Order Length!
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowIs694CartonTables(prev => !prev)}
                      className="px-2.5 py-1 rounded text-[11px] font-extrabold bg-rose-800 hover:bg-rose-900 text-white shadow-xs cursor-pointer flex items-center gap-1"
                    >
                      <Box className="w-3.5 h-3.5" />
                      {showIs694CartonTables ? 'Hide Master Carton Tables' : '📊 View / Edit IS-694 Carton Packing Standards'}
                    </button>
                  </div>
                </div>

                {/* Carton Packing Standard & Mode Controls (IS-694 Only) */}
                {(() => {
                  const activeSpec = lookupIs694CartonSpec(size, cartonStandard, coilType, vihanRules, maruRules);
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 bg-white p-2.5 rounded-lg border border-rose-200">
                      <div>
                        <label className="block text-[10px] font-black text-rose-950 uppercase mb-0.5">
                          1. Carton Packing Standard
                        </label>
                        <select
                          value={cartonStandard}
                          onChange={e => {
                            const nextStd = e.target.value as Is694CartonStandardKey;
                            setCartonStandard(nextStd);
                            const spec = lookupIs694CartonSpec(size, nextStd, coilType, vihanRules, maruRules);
                            const nextCpc =
                              cartonMode === 'MIX' && sumMixBreakdown(spec.mixPerCarton) > 0
                                ? sumMixBreakdown(spec.mixPerCarton)
                                : spec.coilsPerCarton;
                            setCoilsPerCarton(String(nextCpc));
                            if (nextStd === 'MARU_MIRACLE') {
                              if (!brand || brand === 'MYBCAB' || brand === 'VIHAN OPTO') setBrand('MARU MIRACLE');
                              if (spec.maruConductor) setConductor(spec.maruConductor);
                              if (spec.maruInsOd) setCoreOd(String(spec.maruInsOd));
                              setInsCompound('KI-13');
                              if (!editId) {
                                setPrintDetails(`MARU MIRACLE - FR ${size} 1100V (ISI LOGO) IS:694 CM/L 0003894486`);
                              }
                            } else if (nextStd === 'VIHAN_OPTO' && (!brand || brand === 'MARU MIRACLE')) {
                              setBrand('VIHAN OPTO');
                            } else if (nextStd.startsWith('TRIGUARD') && (!brand || brand === 'MARU MIRACLE')) {
                              setBrand('TRIGUARD');
                            }
                            if (cartonCount) {
                              applyIs694CartonCalculation(nextStd, cartonMode, cartonCount, String(nextCpc), size, coilType);
                            }
                          }}
                          className="w-full px-2 py-1.5 text-xs font-bold border border-rose-300 rounded bg-rose-50/40 text-slate-900"
                        >
                          <option value="VIHAN_OPTO">FOR VIHAN OPTO (90M / 45M / 180M)</option>
                          <option value="TRIGUARD_BOX">FOR TRIGUARD — BOX</option>
                          <option value="TRIGUARD_STACK">FOR TRIGUARD — STACK</option>
                          <option value="MARU_MIRACLE">MARU MIRACLE (90M / 180M + Mix)</option>
                          <option value="CUSTOM">CUSTOM CARTON SPEC</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-rose-950 uppercase mb-0.5">
                          2. Carton Packing Mode
                        </label>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setCartonMode('INDIVIDUAL');
                              const cpc = activeSpec.coilsPerCarton;
                              setCoilsPerCarton(String(cpc));
                              if (cartonCount) {
                                applyIs694CartonCalculation(cartonStandard, 'INDIVIDUAL', cartonCount, String(cpc), size, coilType);
                              }
                            }}
                            className={`px-2 py-1.5 rounded text-[10px] font-extrabold border cursor-pointer ${
                              cartonMode === 'INDIVIDUAL'
                                ? 'bg-rose-700 text-white border-rose-900 shadow-2xs'
                                : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-rose-50'
                            }`}
                          >
                            Individual Colour
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCartonMode('MIX');
                              const mixCpc =
                                sumMixBreakdown(activeSpec.mixPerCarton) > 0
                                  ? sumMixBreakdown(activeSpec.mixPerCarton)
                                  : activeSpec.coilsPerCarton;
                              setCoilsPerCarton(String(mixCpc));
                              const defaultCtns = cartonCount || '1';
                              setCartonCount(defaultCtns);
                              applyIs694CartonCalculation(cartonStandard, 'MIX', defaultCtns, String(mixCpc), size, coilType);
                            }}
                            className={`px-2 py-1.5 rounded text-[10px] font-extrabold border cursor-pointer ${
                              cartonMode === 'MIX'
                                ? 'bg-amber-600 text-white border-amber-800 shadow-2xs'
                                : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-amber-50'
                            }`}
                          >
                            Mix Colour C/S
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-rose-950 uppercase mb-0.5">
                          3. Coils / Master Carton (Editable)
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={coilsPerCarton}
                          onChange={e => {
                            const val = e.target.value;
                            setCoilsPerCarton(val);
                            if (cartonCount) {
                              applyIs694CartonCalculation(cartonStandard, cartonMode, cartonCount, val, size, coilType);
                            }
                          }}
                          className="w-full px-2.5 py-1.5 text-xs font-black border border-rose-300 rounded bg-white text-slate-900 text-center"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-rose-950 uppercase mb-0.5">
                          4. No. of Master Cartons
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={cartonCount}
                          onChange={e => {
                            const val = e.target.value;
                            setCartonCount(val);
                            applyIs694CartonCalculation(cartonStandard, cartonMode, val, coilsPerCarton, size, coilType);
                          }}
                          placeholder="Enter Cartons (e.g. 10)"
                          className="w-full px-2.5 py-1.5 text-xs font-black border-2 border-amber-400 rounded bg-amber-50/50 text-slate-900 text-center focus:border-rose-600 focus:outline-none"
                        />
                      </div>

                      <div className="bg-rose-50/70 p-2 rounded border border-rose-200 flex flex-col justify-center">
                        <span className="text-[9.5px] font-bold text-rose-800 uppercase">
                          Standard Pattern ({size} • {coilType})
                        </span>
                        <span className="text-[11px] font-black text-slate-900 mt-0.5">
                          {cartonMode === 'MIX'
                            ? `Mix C/S: ${formatMixBreakdownLabel(activeSpec.mixPerCarton)} (${sumMixBreakdown(activeSpec.mixPerCarton) || coilsPerCarton} Coils/Ctn)`
                            : `Individual: ${coilsPerCarton} Coils / Master Carton`}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Single Colour or MIX Quick Pick + Per-Colour Coil Inputs */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-black text-rose-900 mr-1">Order Place Colour / MIX Option:</span>
                    {IS694_COLOUR_OPTIONS.map(col => {
                      const isMixBtn = col === 'MIX';
                      const isActive = isMixBtn
                        ? cartonMode === 'MIX'
                        : cartonMode === 'INDIVIDUAL' && insColour.toUpperCase() === col;
                      return (
                        <button
                          key={col}
                          type="button"
                          onClick={() => {
                            if (isMixBtn) {
                              handleSelectMixOptionForIs694(cartonStandard, size, coilType);
                              return;
                            }
                            setCartonMode('INDIVIDUAL');
                            setColourCoilsMap({
                              RED: '',
                              YELLOW: '',
                              BLUE: '',
                              BLACK: '',
                              GREEN: '',
                              'YL/GN': '',
                              WHITE: '',
                              GREY: '',
                            });
                            setInsColour(col);
                            if (!editId && cartonStandard !== 'MARU_MIRACLE') {
                              setPrintDetails(`${brand ? brand + ' ' : ''}${grade} ${size} ${col}`.trim());
                            }
                          }}
                          className={`px-2.5 py-0.5 rounded text-[10px] font-extrabold border cursor-pointer transition-all ${
                            isActive
                              ? isMixBtn
                                ? 'bg-amber-600 text-white border-amber-900 shadow-xs scale-105'
                                : 'bg-rose-700 text-white border-rose-900 shadow-xs scale-105'
                              : isMixBtn
                              ? 'bg-amber-100 text-amber-950 border-amber-400 hover:bg-amber-200'
                              : 'bg-white text-slate-800 border-rose-200 hover:bg-rose-100'
                          }`}
                        >
                          {isMixBtn ? '📦 MIX (Carton Mix)' : col}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 pt-1.5 border-t border-rose-200">
                  {(['RED', 'YELLOW', 'BLUE', 'BLACK', 'GREEN', 'YL/GN', 'WHITE', 'GREY'] as const).map(colKey => {
                    const cCount = parseFloat(colourCoilsMap[colKey] || '0') || 0;
                    const cpcNum = parseFloat(coilsPerCarton) || 0;
                    const colCtns = cpcNum > 0 && cCount > 0 ? (cCount / cpcNum).toFixed(1).replace(/\.0$/, '') : '';
                    return (
                      <div key={colKey} className="bg-white p-1.5 rounded border border-rose-200">
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="text-[10px] font-black text-slate-700">
                            {colKey} Coils
                          </label>
                          {colCtns && cartonMode === 'INDIVIDUAL' && (
                            <span className="text-[9px] font-extrabold text-amber-800 bg-amber-100 px-1 rounded">
                              {colCtns} Ctn
                            </span>
                          )}
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={colourCoilsMap[colKey] || ''}
                          onChange={e => handleColourCoilsMapChange(colKey, e.target.value, coilType)}
                          placeholder="0"
                          className="w-full px-2 py-1 text-xs font-bold border border-slate-300 rounded text-center focus:border-rose-600 focus:outline-none"
                        />
                      </div>
                    );
                  })}
                </div>

                {showIs694CartonTables && (
                  <div className="pt-2 border-t-2 border-rose-300">
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
                      compact
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Order Length (m) *</label>
              <input
                type="number"
                step="0.5"
                value={orderLength}
                onChange={(e) => setOrderLength(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white text-slate-800 font-bold focus:border-blue-500 focus:outline-none"
              />
            </div>

            {((coils !== '' && Number(coils) > 0) || grade.toUpperCase().includes('IS-694')) && (
              <div className="sm:col-span-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-300 text-rose-950 text-xs font-bold flex items-center justify-between">
                <span>📦 <strong>Packaging Mode:</strong> {grade.toUpperCase().includes('IS-694') ? 'IS-694 Master Cartons' : `${coils} Coils × ${coilType}`} — <strong>Drum Size is NOT APPLICABLE</strong> (Order bypasses drum requisition &amp; drum slips).</span>
                <span className="px-2 py-0.5 rounded bg-rose-200 text-rose-900 text-[10px] font-black uppercase">Drum: N/A</span>
              </div>
            )}

            <div className="sm:col-span-2 bg-gradient-to-r from-indigo-50/70 to-slate-50 border border-indigo-200 rounded-lg p-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-[11px] font-bold text-indigo-950 uppercase flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Sheath Print Legend / Marking ({grade} Grade)</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">
                    Grade Presets:
                  </span>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        setPrintDetails(e.target.value);
                      }
                    }}
                    className="px-2 py-1 text-xs font-bold border border-indigo-300 rounded bg-white text-indigo-950 hover:border-indigo-500 focus:border-indigo-600 focus:outline-none max-w-[280px] truncate cursor-pointer shadow-2xs"
                    title={`Select standard or saved print legend for ${grade}`}
                  >
                    <option value="">-- Choose {grade} Print Dropdown List ({activeGradePrintPresets.length}) --</option>
                    {activeGradePrintPresets.map((tpl, i) => (
                      <option key={i} value={tpl}>
                        {tpl}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Editable input field with native datalist autocomplete for the selected grade */}
              <div className="relative">
                <input
                  type="text"
                  list="grade-print-presets-datalist"
                  value={printDetails}
                  onChange={(e) => setPrintDetails(e.target.value)}
                  placeholder={`Enter or select print legend for ${grade} (e.g. ${activeGradePrintPresets[0] || 'BRAND GRADE SIZE'})`}
                  className="w-full px-2.5 py-1.5 pr-28 border border-slate-300 rounded bg-white text-slate-900 font-bold focus:border-indigo-600 focus:outline-none text-xs"
                />
                <datalist id="grade-print-presets-datalist">
                  {activeGradePrintPresets.map((tpl, i) => (
                    <option key={i} value={tpl} />
                  ))}
                </datalist>

                {printDetails.trim() && !activeGradePrintPresets.includes(printDetails.trim()) && (
                  <button
                    type="button"
                    onClick={handleSaveCustomPrintPreset}
                    className="absolute right-1 top-1 bottom-1 px-2 text-[10px] font-extrabold bg-indigo-100 hover:bg-indigo-200 text-indigo-900 rounded border border-indigo-300 flex items-center gap-1 cursor-pointer transition-colors"
                    title={`Save current text as a permanent reusable print preset for ${grade}`}
                  >
                    <BookmarkPlus className="w-3 h-3" />
                    <span>Save Preset</span>
                  </button>
                )}
              </div>

              {/* Quick-Pick One-Click Chips for top templates */}
              {activeGradePrintPresets.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[10px] font-bold text-indigo-800">Quick Pick:</span>
                  {activeGradePrintPresets.slice(0, 4).map((tpl, idx) => {
                    const isSelected = printDetails === tpl;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPrintDetails(tpl)}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-all text-left truncate max-w-[280px] cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-600 text-white border-indigo-700 font-extrabold shadow-2xs'
                            : 'bg-white hover:bg-indigo-100 text-indigo-900 border-indigo-200 font-semibold'
                        }`}
                        title={tpl}
                      >
                        {tpl}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="sm:col-span-2 flex items-center justify-between gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  id="chkHighPriority"
                  checked={isHighPriority}
                  onChange={(e) => setIsHighPriority(e.target.checked)}
                  className="w-4 h-4 text-red-600 rounded border-slate-300 focus:ring-red-500 cursor-pointer"
                />
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Flag className={`w-3.5 h-3.5 ${isHighPriority ? 'fill-red-600 text-red-600' : 'text-slate-400'}`} />
                  Mark as High Priority (Rush / Expedited Production)
                </span>
              </label>
              {isHighPriority && (
                <span className="text-[10px] px-2 py-0.5 rounded font-black bg-red-100 text-red-700 border border-red-200 uppercase tracking-wide">
                  🔥 Urgent Flag Active
                </span>
              )}
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                className={`w-full py-2 text-white rounded font-bold flex items-center justify-center gap-1.5 shadow-xs transition-colors ${
                  isHighPriority ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <Plus className="w-4 h-4" />
                {editId ? `Update #${editId}` : 'Add Order'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 border-l-4 border-l-blue-600 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase">Active Orders</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{filteredOrders.length} Items</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-blue-600 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase flex items-center justify-between">
            <span>Cable Length</span>
            <span className="text-[9.5px] font-black px-1.5 py-0.2 bg-blue-100 text-blue-900 rounded">
              Total: {totalLen.toLocaleString()} m
            </span>
          </div>
          <div className="text-xl font-bold text-slate-900 mt-1">
            {totalLenPending.toLocaleString()} m
            <span className="text-[11px] font-bold text-blue-800 ml-1">To Produce</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between font-medium">
            <span className="text-emerald-700 font-bold">✓ Produced: {totalLenCompleted.toLocaleString()} m</span>
            <span className="text-slate-400">({totalLen > 0 ? Math.round((totalLenCompleted / totalLen) * 100) : 0}%)</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-amber-500 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase flex items-center justify-between">
            <span>Copper Requisition</span>
            <span className="text-[9.5px] font-black px-1.5 py-0.2 bg-amber-100 text-amber-900 rounded">
              Total: {totalCu.toFixed(1)} kg
            </span>
          </div>
          <div className="text-xl font-black text-amber-950 mt-1">
            {totalCuToBunch.toFixed(2)} kg
            <span className="text-[11px] font-bold text-amber-800 ml-1">To Bunch</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between font-medium">
            <span className="text-emerald-700 font-bold">✓ Bunched: {totalCuBunched.toFixed(1)} kg</span>
            <span className="text-slate-400">({bunchedOrdersCount}/{filteredOrders.length} Done)</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-teal-600 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase flex items-center justify-between">
            <span>Insulation Requisition</span>
            <span className="text-[9.5px] font-black px-1.5 py-0.2 bg-teal-100 text-teal-900 rounded">
              Total: {totalIns.toFixed(1)} kg
            </span>
          </div>
          <div className="text-xl font-bold text-teal-950 mt-1">
            {totalInsToProcess.toFixed(2)} kg
            <span className="text-[11px] font-bold text-teal-800 ml-1">To Insulate</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between font-medium">
            <span className="text-emerald-700 font-bold">✓ Extruded: {totalInsDeducted.toFixed(1)} kg</span>
            <span className="text-slate-400">({insOrdersCount}/{filteredOrders.length} Done)</span>
          </div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-purple-600 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase flex items-center justify-between">
            <span>Sheath Requisition</span>
            <span className="text-[9.5px] font-black px-1.5 py-0.2 bg-purple-100 text-purple-900 rounded">
              Total: {totalSheath.toFixed(1)} kg
            </span>
          </div>
          <div className="text-xl font-bold text-purple-950 mt-1">
            {totalSheathToProcess.toFixed(2)} kg
            <span className="text-[11px] font-bold text-purple-800 ml-1">To Sheath</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between font-medium">
            <span className="text-emerald-700 font-bold">✓ Extruded: {totalSheathDeducted.toFixed(1)} kg</span>
            <span className="text-slate-400">({sheathOrdersCount}/{filteredOrders.length} Done)</span>
          </div>
        </div>
      </div>

      {/* Separate IS-694 Grade Order Sheet & Master Carton Packaging Sheet */}
      {is694ActiveCount > 0 && (() => {
        const is694OrdersList = filteredOrders.filter(o =>
          (o.grade || '').toUpperCase().includes('IS-694')
        );
        return (
          <div className="bg-rose-50/90 border-2 border-rose-400 rounded-xl p-3.5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-1 rounded bg-rose-800 text-white text-xs font-black uppercase tracking-wide">
                  📦 IS-694 Grade Order Sheet &amp; Master Carton Packaging (JOB NO 28 &amp; JOB NO 29)
                </span>
                <span className="text-xs font-bold text-rose-950">
                  Final Stage: <strong>2. IS-694 Insulation</strong> (Completing B + I marks order Done &amp; attaches to Finished Carton Stock)
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap no-print">
                <button
                  type="button"
                  onClick={() => setShowIs694OrderSheet(prev => !prev)}
                  className={`px-2.5 py-1 rounded text-xs font-extrabold border transition-colors cursor-pointer ${
                    showIs694OrderSheet
                      ? 'bg-rose-700 text-white border-rose-800'
                      : 'bg-white text-rose-900 border-rose-300 hover:bg-rose-100'
                  }`}
                >
                  {showIs694OrderSheet ? '▼ Hide IS-694 Order Sheet' : '▶ Show IS-694 Order Sheet'} ({is694OrdersList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setShowIs694StandardsSheet(prev => !prev)}
                  className={`px-2.5 py-1 rounded text-xs font-extrabold border transition-colors cursor-pointer ${
                    showIs694StandardsSheet
                      ? 'bg-indigo-700 text-white border-indigo-800'
                      : 'bg-white text-indigo-900 border-indigo-300 hover:bg-indigo-50'
                  }`}
                >
                  {showIs694StandardsSheet
                    ? '▼ Hide IS-694 Master Carton Reference Sheets'
                    : '▶ Show IS-694 Master Carton Reference Sheets'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
              <div className="bg-white p-2 rounded border border-rose-200">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Active IS-694 Orders</div>
                <div className="text-sm font-black text-rose-950">{is694ActiveCount} Order(s)</div>
              </div>
              <div className="bg-white p-2 rounded border border-rose-200">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Active IS-694 Coils</div>
                <div className="text-sm font-black text-amber-800">{is694TotalCoils} Coils</div>
              </div>
              <div className="bg-white p-2 rounded border border-rose-200">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Master Cartons Req.</div>
                <div className="text-sm font-black text-rose-800">{is694TotalCartons} Cartons</div>
              </div>
              <div className="bg-white p-2 rounded border border-rose-200">
                <div className="text-[10px] font-bold text-slate-500 uppercase">IS-694 Wire Length</div>
                <div className="text-sm font-black text-blue-800">{is694TotalLen.toLocaleString()} m</div>
              </div>
              <div className="bg-white p-2 rounded border border-rose-200">
                <div className="text-[10px] font-bold text-slate-500 uppercase">IS-694 Copper Req</div>
                <div className="text-sm font-black text-amber-900">{is694TotalCu.toFixed(2)} kg</div>
              </div>
              <div className="bg-white p-2 rounded border border-rose-200">
                <div className="text-[10px] font-bold text-slate-500 uppercase">IS-694 Insulation Req</div>
                <div className="text-sm font-black text-teal-800">{is694TotalIns.toFixed(2)} kg</div>
              </div>
            </div>

            {showIs694OrderSheet && is694OrdersList.length > 0 && (
              <div className="bg-white border border-rose-300 rounded-lg overflow-hidden shadow-2xs">
                <div className="px-3 py-2 bg-rose-900 text-white flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="font-extrabold flex items-center gap-2">
                    <span>📋 IS-694 Grade Order Sheet — Active Master Carton Orders ({is694OrdersList.length} Orders)</span>
                    <span className="px-2 py-0.5 rounded bg-rose-700 text-rose-100 text-[10px] font-bold">
                      JOB NO 28 (MARU MIRACLE) &amp; JOB NO 29 (VIHAN OPTO / VIHAN TRIGUARD)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 no-print">
                    <button
                      type="button"
                      onClick={() => setFilterBatch(filterBatch === 'JOB NO 28' ? '' : 'JOB NO 28')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                        filterBatch === 'JOB NO 28'
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-rose-800 text-rose-100 hover:bg-rose-700'
                      }`}
                    >
                      Filter JOB NO 28
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterBatch(filterBatch === 'JOB NO 29' ? '' : 'JOB NO 29')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                        filterBatch === 'JOB NO 29'
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-rose-800 text-rose-100 hover:bg-rose-700'
                      }`}
                    >
                      Filter JOB NO 29
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] text-left whitespace-nowrap">
                    <thead className="bg-rose-100/90 text-rose-950 font-extrabold uppercase border-b border-rose-200 select-none">
                      <tr>
                        <th className="p-2 border-r border-rose-200 text-center">#</th>
                        <th
                          onClick={() => handleSortColumn('batch')}
                          className="p-2 border-r border-rose-200 cursor-pointer hover:bg-rose-200/70 transition-colors group"
                          title="Click to sort by Batch"
                        >
                          <span>Batch</span>
                          {renderSortIcon('batch')}
                        </th>
                        <th
                          onClick={() => handleSortColumn('brand')}
                          className="p-2 border-r border-rose-200 cursor-pointer hover:bg-rose-200/70 transition-colors group"
                          title="Click to sort by Brand"
                        >
                          <span>Brand / Standard</span>
                          {renderSortIcon('brand')}
                        </th>
                        <th
                          onClick={() => handleSortColumn('size')}
                          className="p-2 border-r border-rose-200 cursor-pointer hover:bg-rose-200/70 transition-colors group"
                          title="Click to sort by Cable Size (SQ MM)"
                        >
                          <span>Size (SQ MM)</span>
                          {renderSortIcon('size')}
                        </th>
                        <th
                          onClick={() => handleSortColumn('conductor')}
                          className="p-2 border-r border-rose-200 cursor-pointer hover:bg-rose-200/70 transition-colors group"
                          title="Click to sort by Conductor"
                        >
                          <span>Conductor</span>
                          {renderSortIcon('conductor')}
                        </th>
                        <th
                          onClick={() => handleSortColumn('coreOd')}
                          className="p-2 border-r border-rose-200 text-right cursor-pointer hover:bg-rose-200/70 transition-colors group"
                          title="Click to sort by Core OD"
                        >
                          <span>Core OD</span>
                          {renderSortIcon('coreOd')}
                        </th>
                        <th
                          onClick={() => handleSortColumn('insCompound')}
                          className="p-2 border-r border-rose-200 cursor-pointer hover:bg-rose-200/70 transition-colors group"
                          title="Click to sort by Compound"
                        >
                          <span>Compound</span>
                          {renderSortIcon('insCompound')}
                        </th>
                        <th className="p-2 border-r border-rose-200">Colour / Mix C/S Breakdown</th>
                        <th className="p-2 border-r border-rose-200 text-center">Mode</th>
                        <th className="p-2 border-r border-rose-200 text-right">Coils/Ctn</th>
                        <th className="p-2 border-r border-rose-200 text-right">Master Cartons</th>
                        <th
                          onClick={() => handleSortColumn('coils')}
                          className="p-2 border-r border-rose-200 text-right cursor-pointer hover:bg-rose-200/70 transition-colors group"
                          title="Click to sort by Total Coils"
                        >
                          <span>Total Coils</span>
                          {renderSortIcon('coils')}
                        </th>
                        <th
                          onClick={() => handleSortColumn('orderLen')}
                          className="p-2 border-r border-rose-200 text-right cursor-pointer hover:bg-rose-200/70 transition-colors group"
                          title="Click to sort by Wire Length (m)"
                        >
                          <span>Wire Length (m)</span>
                          {renderSortIcon('orderLen')}
                        </th>
                        <th className="p-2 border-r border-rose-200 text-right">Cu Req (kg)</th>
                        <th className="p-2 border-r border-rose-200 text-right">Ins Req (kg)</th>
                        <th
                          onClick={() => handleSortColumn('status')}
                          className="p-2 border-r border-rose-200 text-center cursor-pointer hover:bg-rose-200/70 transition-colors group"
                          title="Click to sort by Stage Progress / Status"
                        >
                          <span>Process (B → I)</span>
                          {renderSortIcon('status')}
                        </th>
                        <th className="p-2 text-center no-print">Edit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rose-100">
                      {is694OrdersList.map((ord, idx) => {
                        const r = computeRecordRow(ord, densities, ladiDimensions);
                        const cr = computeIs694CartonPackingForOrder(
                          ord,
                          densities,
                          ladiDimensions,
                          vihanRules,
                          maruRules
                        );
                        const p = ord.pStatus || { b: false, c: false, i: false, t: false, s: false };
                        const bdEntries = Object.entries(ord.coil_colour_breakdown || {}).filter(
                          ([, v]) => Number(v) > 0
                        );
                        return (
                          <tr key={ord.id} className="hover:bg-rose-50/60">
                            <td className="p-2 border-r border-rose-100 text-center font-bold text-slate-600">
                              {idx + 1}
                            </td>
                            <td className="p-2 border-r border-rose-100 font-extrabold text-slate-900">
                              {ord.batch}
                            </td>
                            <td className="p-2 border-r border-rose-100">
                              <span className="font-extrabold text-rose-950">{ord.brand}</span>
                              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[9.5px] font-bold">
                                {ord.carton_standard || 'STANDARD'}
                              </span>
                            </td>
                            <td className="p-2 border-r border-rose-100 font-extrabold text-blue-900">
                              1C × {ord.size}
                            </td>
                            <td className="p-2 border-r border-rose-100 font-mono font-bold text-slate-800">
                              {ord.conductor}
                            </td>
                            <td className="p-2 border-r border-rose-100 text-right font-bold">
                              {ord.core_od.toFixed(2)} mm
                            </td>
                            <td className="p-2 border-r border-rose-100 font-bold text-teal-800">
                              {ord.ins_compound}
                            </td>
                            <td className="p-2 border-r border-rose-100">
                              {bdEntries.length > 0 ? (
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-950 border border-amber-300 font-black text-[10px]">
                                    MIX:
                                  </span>
                                  {bdEntries.map(([col, cnt]) => (
                                    <span
                                      key={col}
                                      className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-300 font-bold text-[10px]"
                                    >
                                      {col}: {cnt}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300 font-extrabold text-[10px]">
                                  🎨 {ord.ins_colour || 'RED'}
                                </span>
                              )}
                            </td>
                            <td className="p-2 border-r border-rose-100 text-center">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9.5px] font-black uppercase ${
                                  ord.carton_mode === 'MIX'
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-blue-100 text-blue-900'
                                }`}
                              >
                                {ord.carton_mode || 'INDIVIDUAL'}
                              </span>
                            </td>
                            <td className="p-2 border-r border-rose-100 text-right font-bold text-slate-800">
                              {cr.coilsPerCarton}
                            </td>
                            <td className="p-2 border-r border-rose-100 text-right font-black text-rose-800">
                              {cr.totalCartons} Ctn
                            </td>
                            <td className="p-2 border-r border-rose-100 text-right font-black text-amber-900">
                              {cr.totalCoils} ({ord.coil_type || '90 MTR'})
                            </td>
                            <td className="p-2 border-r border-rose-100 text-right font-extrabold text-blue-900">
                              {r.orderLen.toLocaleString()} m
                            </td>
                            <td className="p-2 border-r border-rose-100 text-right font-bold text-amber-900">
                              {r.reqCu.toFixed(2)} kg
                            </td>
                            <td className="p-2 border-r border-rose-100 text-right font-bold text-teal-800">
                              {r.reqIns.toFixed(2)} kg
                            </td>
                            <td className="p-2 border-r border-rose-100 text-center min-w-[165px]">
                              {(() => {
                                const is694DoneCount = (p.b ? 1 : 0) + (p.i ? 1 : 0);
                                const is694Pct = Math.round((is694DoneCount / 2) * 100);
                                return (
                                  <div className="space-y-1">
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => onToggleProcess(ord.id, 'b')}
                                        className={`px-2 py-0.5 rounded text-[10px] font-black cursor-pointer transition-colors ${
                                          p.b
                                            ? 'bg-amber-500 text-white shadow-2xs'
                                            : 'bg-slate-200 text-slate-700 hover:bg-amber-100'
                                        }`}
                                        title="Toggle 1. Bunched (B)"
                                      >
                                        B: Bunched {p.b ? '✓' : ''}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => onToggleProcess(ord.id, 'i')}
                                        className={`px-2 py-0.5 rounded text-[10px] font-black cursor-pointer transition-colors ${
                                          p.i
                                            ? 'bg-teal-600 text-white shadow-2xs'
                                            : 'bg-slate-200 text-slate-700 hover:bg-teal-100'
                                        }`}
                                        title="Toggle 2. IS-694 Insulated (I)"
                                      >
                                        I: Insulated {p.i ? '✓' : ''}
                                      </button>
                                    </div>
                                    {/* Segmented Color-Coded Stage Progress Bar (Bunched + Insulated) */}
                                    <div className="w-36 mx-auto space-y-0.5">
                                      <div className="grid grid-cols-2 gap-1 bg-slate-100 p-0.5 rounded-full border border-slate-200">
                                        <div
                                          onClick={() => onToggleProcess(ord.id, 'b')}
                                          className={`h-2 rounded-l-full transition-all cursor-pointer ${
                                            p.b ? 'bg-amber-500' : 'bg-amber-200/60'
                                          }`}
                                          title={`Stage 1 — Bunched: ${p.b ? 'Completed (100%)' : 'Pending (0%)'}`}
                                        />
                                        <div
                                          onClick={() => onToggleProcess(ord.id, 'i')}
                                          className={`h-2 rounded-r-full transition-all cursor-pointer ${
                                            p.i ? 'bg-teal-500' : p.b ? 'bg-teal-200/70' : 'bg-slate-200'
                                          }`}
                                          title={`Stage 2 — Insulated: ${p.i ? 'Completed (100%)' : 'Pending (0%)'}`}
                                        />
                                      </div>
                                      <div className="flex items-center justify-between text-[9px] font-extrabold px-0.5">
                                        <span className={p.b ? 'text-amber-700' : 'text-slate-400'}>
                                          Bunched {p.b ? '✓' : '·'}
                                        </span>
                                        <span className="text-slate-700">{is694Pct}%</span>
                                        <span className={p.i ? 'text-teal-700' : 'text-slate-400'}>
                                          Insulated {p.i ? '✓' : '·'}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="p-2 text-center no-print">
                              <button
                                type="button"
                                onClick={() => handleEdit(ord)}
                                className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold text-[10px] cursor-pointer"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {showIs694StandardsSheet && (
              <div className="bg-white border border-rose-300 rounded-lg p-3 shadow-2xs no-print">
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
                  compact
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* Visual Batch Production Progress Overview (B, CS, I, TS, SH) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 no-print">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 font-bold">
              <Activity className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Batch Production Progress (B, C, I, T, S Overview)</span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Visual progress bars showing the percentage of completed production processes (Bunching, Stranding, Insulation, Twisting, Sheathing)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryBatchView(historyBatchView === 'ALL' ? null : 'ALL')}
              className={`text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 border transition-all ${
                historyBatchView === 'ALL'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
              }`}
              title="Toggle compact history log for all batches"
            >
              <History className="w-3.5 h-3.5" />
              <span>All Batch History ({batchHistory.length})</span>
            </button>
            <span className="text-xs font-medium text-slate-600">Overall Factory:</span>
            <div className="flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-full">
              <div className="w-20 bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    overallPercentage === 100
                      ? 'bg-emerald-500'
                      : overallPercentage >= 50
                      ? 'bg-blue-600'
                      : overallPercentage > 0
                      ? 'bg-amber-500'
                      : 'bg-slate-300'
                  }`}
                  style={{ width: `${overallPercentage}%` }}
                />
              </div>
              <span className="text-xs font-bold text-slate-900">{overallPercentage}%</span>
              <span className="text-[10px] text-slate-500 font-semibold">
                ({completedAllCheckpoints}/{totalAllCheckpoints})
              </span>
            </div>
          </div>
        </div>

        {/* Batch Progress Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {batchProgressList.map(bp => {
            const isSelected = filterBatch === bp.batch;
            const batchEntries = batchHistory.filter(h => h.batch === bp.batch);
            const isHistoryOpen = historyBatchView === bp.batch;
            const barColor =
              bp.percentage === 100
                ? 'bg-emerald-500'
                : bp.percentage >= 60
                ? 'bg-blue-600'
                : bp.percentage >= 25
                ? 'bg-amber-500'
                : bp.percentage > 0
                ? 'bg-indigo-500'
                : 'bg-slate-200';

            const badgeBg =
              bp.percentage === 100
                ? 'bg-emerald-100 text-emerald-800'
                : bp.percentage >= 60
                ? 'bg-blue-100 text-blue-800'
                : bp.percentage > 0
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-600';

            return (
              <div
                key={bp.batch}
                onClick={() => setFilterBatch(isSelected ? '' : bp.batch)}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/50 shadow-xs ring-2 ring-blue-500/20'
                    : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100/80 hover:border-slate-300'
                }`}
                title="Click to filter active orders by this batch"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-900 text-xs">{bp.batch}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-white border border-slate-200 text-slate-600 font-medium">
                      {bp.brand}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHistoryBatchView(isHistoryOpen ? null : bp.batch);
                      }}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 border transition-colors ${
                        isHistoryOpen
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : batchEntries.length > 0
                          ? 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                      }`}
                      title={`View status change history log for ${bp.batch}`}
                    >
                      <History className="w-2.5 h-2.5" />
                      <span>Log ({batchEntries.length})</span>
                    </button>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${badgeBg}`}>
                      {bp.percentage}%
                    </span>
                  </div>
                </div>

                {/* Progress Bar Track & Fill */}
                <div className="w-full bg-slate-200/90 rounded-full h-2.5 overflow-hidden mb-2 shadow-inner">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${bp.percentage}%` }}
                  />
                </div>

                {/* Checkpoint counts & stages */}
                <div className="flex items-center justify-between text-[10.5px] text-slate-600 mb-1.5 font-medium">
                  <span>
                    {bp.completedOrders}/{bp.totalOrders} orders completed
                  </span>
                  <span className="text-slate-500">
                    {bp.completedCheckpoints}/{bp.totalCheckpoints} process steps
                  </span>
                </div>

                {/* Stage-wise micro indicators */}
                <div className="grid grid-cols-5 gap-1 pt-1.5 border-t border-slate-200/70 text-[9.5px] font-bold text-center">
                  <div className={`p-1 rounded ${bp.countB === bp.totalOrders ? 'bg-emerald-100 text-emerald-800' : bp.countB > 0 ? 'bg-blue-100 text-blue-800' : 'bg-slate-200/70 text-slate-500'}`} title={`Bunching: ${bp.countB}/${bp.totalOrders}`}>
                    B: {bp.countB}/{bp.totalOrders}
                  </div>
                  <div className={`p-1 rounded ${bp.countC === bp.totalOrders ? 'bg-emerald-100 text-emerald-800' : bp.countC > 0 ? 'bg-blue-100 text-blue-800' : 'bg-slate-200/70 text-slate-500'}`} title={`Cu Stranding: ${bp.countC}/${bp.totalOrders}`}>
                    CS: {bp.countC}/{bp.totalOrders}
                  </div>
                  <div className={`p-1 rounded ${bp.countI === bp.totalOrders ? 'bg-emerald-100 text-emerald-800' : bp.countI > 0 ? 'bg-blue-100 text-blue-800' : 'bg-slate-200/70 text-slate-500'}`} title={`Insulation: ${bp.countI}/${bp.totalOrders}`}>
                    I: {bp.countI}/{bp.totalOrders}
                  </div>
                  <div className={`p-1 rounded ${bp.countT === bp.totalOrders ? 'bg-emerald-100 text-emerald-800' : bp.countT > 0 ? 'bg-blue-100 text-blue-800' : 'bg-slate-200/70 text-slate-500'}`} title={`Twisting: ${bp.countT}/${bp.totalOrders}`}>
                    TS: {bp.countT}/{bp.totalOrders}
                  </div>
                  <div className={`p-1 rounded ${bp.countS === bp.totalOrders ? 'bg-emerald-100 text-emerald-800' : bp.countS > 0 ? 'bg-blue-100 text-blue-800' : 'bg-slate-200/70 text-slate-500'}`} title={`Sheathing: ${bp.countS}/${bp.totalOrders}`}>
                    SH: {bp.countS}/{bp.totalOrders}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Compact Batch Status Change History Log Panel */}
        {historyBatchView && (() => {
          const displayedEntries =
            historyBatchView === 'ALL'
              ? batchHistory
              : batchHistory.filter(h => h.batch === historyBatchView);

          return (
            <div className="mt-3 bg-slate-900 text-slate-100 rounded-xl border border-slate-700 overflow-hidden shadow-md">
              <div className="px-4 py-2.5 bg-slate-800/90 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded bg-indigo-500/20 text-indigo-400">
                    <History className="w-4 h-4" />
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <span>
                        Batch Production Status History Log —{' '}
                        {historyBatchView === 'ALL' ? 'All Batches' : historyBatchView}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white">
                        {displayedEntries.length} event{displayedEntries.length === 1 ? '' : 's'}
                      </span>
                    </h4>
                    <p className="text-[10.5px] text-slate-400">
                      Chronological timestamps of Bunching (B), Cu Stranding (CS), Extrusion / Insulation (I), Twisting (TS), and Sheathing (SH) status updates
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Batch Selector Pills inside History Log */}
                  <div className="hidden md:flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setHistoryBatchView('ALL')}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                        historyBatchView === 'ALL'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      All
                    </button>
                    {batchProgressList.map(b => (
                      <button
                        key={b.batch}
                        type="button"
                        onClick={() => setHistoryBatchView(b.batch)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                          historyBatchView === b.batch
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        {b.batch}
                      </button>
                    ))}
                  </div>

                  {onClearBatchHistory && displayedEntries.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        onClearBatchHistory(historyBatchView === 'ALL' ? undefined : historyBatchView)
                      }
                      className="text-[10px] px-2 py-1 rounded bg-slate-700 hover:bg-rose-600 text-slate-300 hover:text-white font-semibold flex items-center gap-1 transition-colors"
                      title="Clear history entries for current view"
                    >
                      <RotateCcw className="w-3 h-3" /> Clear
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setHistoryBatchView(null)}
                    className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white"
                    title="Close history log"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {displayedEntries.length === 0 ? (
                <div className="p-5 text-center text-xs text-slate-400">
                  No status changes recorded yet for{' '}
                  <strong className="text-slate-200">
                    {historyBatchView === 'ALL' ? 'any batch' : historyBatchView}
                  </strong>
                  . Toggle any process stage (B, CS, I, TS, SH) on an order below to log a timestamped entry.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-800">
                  {displayedEntries.map(entry => {
                    const isCompleted = entry.action === 'completed';
                    return (
                      <div
                        key={entry.id}
                        className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-800/60 transition-colors text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              isCompleted
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {isCompleted ? '✓ Completed' : '↺ Reset'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-indigo-300 font-bold text-[10.5px]">
                            {entry.batch}
                          </span>
                          <span className="font-bold text-white">
                            Order #{entry.orderId}
                          </span>
                          <span className="text-slate-300 font-medium">
                            ({entry.brand} • {entry.cores}C × {entry.size})
                          </span>
                          <span className="text-slate-400">→</span>
                          <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold text-[10.5px]">
                            {entry.stageLabel}
                          </span>
                          {entry.note && (
                            <span className="text-[10.5px] text-slate-400 italic">
                              — {entry.note}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono shrink-0">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span>{formatHistoryTimestamp(entry.timestamp)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Global Real-Time Search Bar Card */}
      <div className="bg-white border-2 border-blue-500/80 rounded-xl p-4 shadow-sm space-y-3 no-print">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600 font-bold">
              <Search className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Global Real-Time Search</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                  {filteredOrders.length} of {activeOrders.length} matching
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Filter active orders instantly by Batch Number, Brand, Cable Size, Conductor, or Grade
              </p>
            </div>
          </div>

          {(searchQuery || filterBatch) && (
            <button
              onClick={() => {
                setSearchQuery('');
                setFilterBatch('');
              }}
              className="text-xs px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold flex items-center gap-1 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-slate-500" />
              Reset All Filters
            </button>
          )}
        </div>

        {/* Search input with icons and keyboard shortcut */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Type batch (e.g. 07/163), brand (EKP, MYBCAB), size (1.50 SQ MM, 4.00), conductor (22/0.210)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-24 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 font-medium placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
          />
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery('')}
                className="p-1 hover:bg-slate-200 text-slate-500 rounded-full"
                title="Clear search query (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 bg-slate-200/80 border border-slate-300 rounded shadow-2xs">
                /
              </kbd>
            )}
          </div>
        </div>

        {/* Quick Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1 mr-1">
            <Filter className="w-3 h-3 text-slate-400" /> Quick Filters:
          </span>

          {/* Brands */}
          {uniqueBrands.slice(0, 4).map(b => (
            <button
              key={b}
              onClick={() => setSearchQuery(searchQuery === b ? '' : b)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                searchQuery.toLowerCase() === b.toLowerCase()
                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              🏷️ {b}
            </button>
          ))}

          {/* Popular Sizes */}
          {['1.50 SQ MM', '2.50 SQ MM', '4.00 SQ MM', '10.00 SQ MM'].map(sz => (
            <button
              key={sz}
              onClick={() => setSearchQuery(searchQuery === sz ? '' : sz)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                searchQuery.toLowerCase() === sz.toLowerCase()
                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              ⚡ {sz}
            </button>
          ))}

          {/* Batches */}
          {uniqueBatches.slice(0, 4).map(bt => (
            <button
              key={bt}
              onClick={() => {
                if (filterBatch === bt) {
                  setFilterBatch('');
                } else {
                  setFilterBatch(bt);
                }
              }}
              className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                filterBatch === bt
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              📁 {bt}
            </button>
          ))}
        </div>
      </div>

      {/* Table Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs print-card">
        <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-2">
          <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
            <span>📋 Active Orders ({filteredOrders.length} items)</span>
            <span className="text-xs text-slate-500 font-normal">
              (When all 5 process badges are green, the order moves to Completed Orders)
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setPriorityFilter(priorityFilter === 'HIGH' ? 'ALL' : 'HIGH')}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all no-print ${
                priorityFilter === 'HIGH'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-rose-50 hover:text-rose-700'
              }`}
              title="Filter to show only High Priority orders"
            >
              <Flag className={`w-3.5 h-3.5 ${priorityFilter === 'HIGH' ? 'fill-white text-white' : 'text-rose-500'}`} />
              <span>High Priority ({highPriorityCount})</span>
            </button>

            <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 no-print">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-600" />
              <span className="text-[11px] font-bold text-slate-700">Sort:</span>
              <button
                type="button"
                onClick={() => handleSortColumn('batch')}
                className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                  sortField === 'batch'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-300'
                }`}
              >
                Batch {sortField === 'batch' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </button>
              <button
                type="button"
                onClick={() => handleSortColumn('size')}
                className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                  sortField === 'size'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-300'
                }`}
              >
                Size {sortField === 'size' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </button>
              <button
                type="button"
                onClick={() => handleSortColumn('status')}
                className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                  sortField === 'status'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-300'
                }`}
              >
                Status {sortField === 'status' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
              </button>
              {sortField && (
                <button
                  type="button"
                  onClick={() => {
                    setSortField(null);
                    setSortDirection('asc');
                  }}
                  className="px-1.5 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 text-[10.5px] font-bold cursor-pointer"
                  title="Reset column sorting to default order"
                >
                  Reset
                </button>
              )}
            </div>

            <select
              value={filterBatch}
              onChange={(e) => setFilterBatch(e.target.value)}
              className="text-xs px-2.5 py-1.5 border border-slate-300 rounded font-semibold bg-white"
            >
              <option value="">All Batches</option>
              {uniqueBatches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setPrintFriendly(prev => !prev)}
              className={`text-xs px-2.5 py-1.5 rounded font-bold flex items-center gap-1.5 border transition-colors no-print cursor-pointer ${
                printFriendly
                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-2xs'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
              }`}
              title="Toggle Print-Friendly A4 View (hides ID, Priority, Status, Container, Process Status & Print Details columns)"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{printFriendly ? 'A4 Print-Friendly: ON' : 'A4 Print-Friendly Toggle'}</span>
            </button>

            <button
              onClick={() => window.print()}
              className="text-xs px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 shadow-2xs no-print"
              title="Print current page document"
            >
              <Printer className="w-3.5 h-3.5" /> Print current page
            </button>

            <button
              onClick={onExportCsv}
              className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 rounded font-semibold text-slate-700 flex items-center gap-1 no-print"
            >
              ⬇ Export CSV
            </button>

            {onClearAllOrders && orders.length > 0 && (
              confirmClearAll ? (
                <div className="inline-flex items-center gap-1 bg-rose-50 border border-rose-300 rounded px-2 py-1 no-print">
                  <span className="text-[11px] font-bold text-rose-800">Clear all {orders.length} orders?</span>
                  <button
                    type="button"
                    onClick={() => {
                      onClearAllOrders();
                      setConfirmClearAll(false);
                    }}
                    className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-extrabold cursor-pointer"
                  >
                    Yes, Clear All
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="px-1.5 py-0.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded text-[11px] font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="text-xs px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold flex items-center gap-1 shadow-2xs no-print cursor-pointer"
                  title="Delete all orders from the app"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear All Orders
                </button>
              )
            )}
          </div>
        </div>

        {/* Stage Color-Coding Legend Bar for Individual Order Progress Bars */}
        {!printFriendly && (
          <div className="mb-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-[11px] no-print">
            <div className="font-extrabold text-slate-700 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-indigo-600" />
              <span>Order Stage Progress Bar Color Key:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-900 font-bold text-[10.5px]">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                <span>B: Bunched</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-orange-50 border border-orange-300 text-orange-900 font-bold text-[10.5px]">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />
                <span>CS: Cu Stranded</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-teal-50 border border-teal-300 text-teal-900 font-bold text-[10.5px]">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-500 inline-block" />
                <span>I: Insulated</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-300 text-indigo-900 font-bold text-[10.5px]">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
                <span>TS: Twisted</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-900 font-bold text-[10.5px]">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                <span>SH: Sheathed</span>
              </span>
            </div>
          </div>
        )}

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200 select-none">
              <tr>
                {!printFriendly && <th className="p-2 border-r border-slate-200 text-center w-10">#</th>}
                {!printFriendly && (
                  <th
                    onClick={() => handleSortColumn('priority')}
                    className={`p-2 border-r border-slate-200 text-center w-14 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                      sortField === 'priority' ? 'bg-blue-50 text-blue-900' : ''
                    }`}
                    title="Click to sort by Priority (High / Normal)"
                  >
                    <span>Priority</span>
                    {renderSortIcon('priority')}
                  </th>
                )}
                <th
                  onClick={() => handleSortColumn('batch')}
                  className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'batch' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Batch"
                >
                  <span>Batch</span>
                  {renderSortIcon('batch')}
                </th>
                {!printFriendly && (
                  <th
                    onClick={() => handleSortColumn('status')}
                    className={`p-2 border-r border-slate-200 min-w-[135px] cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                      sortField === 'status' ? 'bg-blue-50 text-blue-900' : ''
                    }`}
                    title="Click to sort by Stage Progress / Status"
                  >
                    <span>Stage Progress</span>
                    {renderSortIcon('status')}
                  </th>
                )}
                <th
                  onClick={() => handleSortColumn('brand')}
                  className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'brand' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Brand"
                >
                  <span>Brand</span>
                  {renderSortIcon('brand')}
                </th>
                <th
                  onClick={() => handleSortColumn('conductor')}
                  className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'conductor' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Conductor"
                >
                  <span>Conductor</span>
                  {renderSortIcon('conductor')}
                </th>
                <th
                  onClick={() => handleSortColumn('coreOd')}
                  className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'coreOd' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by PVC / Core OD"
                >
                  <span>PVC / Core OD</span>
                  {renderSortIcon('coreOd')}
                </th>
                <th
                  onClick={() => handleSortColumn('insDie')}
                  className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'insDie' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Ins. Die"
                >
                  <span>Ins. Die (Rec)</span>
                  {renderSortIcon('insDie')}
                </th>
                <th
                  onClick={() => handleSortColumn('nozzle')}
                  className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'nozzle' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Nozzle"
                >
                  <span>Nozzle (Rec)</span>
                  {renderSortIcon('nozzle')}
                </th>
                <th
                  onClick={() => handleSortColumn('insCompound')}
                  className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'insCompound' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Ins. Compound"
                >
                  <span>Ins. Compound</span>
                  {renderSortIcon('insCompound')}
                </th>
                <th
                  onClick={() => handleSortColumn('cores')}
                  className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'cores' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Number of Cores"
                >
                  <span>Core</span>
                  {renderSortIcon('cores')}
                </th>
                <th
                  onClick={() => handleSortColumn('size')}
                  className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'size' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Cable Size (SQ MM)"
                >
                  <span>Size</span>
                  {renderSortIcon('size')}
                </th>
                {!printFriendly && <th className="p-2 border-r border-slate-200 bg-indigo-50/80 text-indigo-950">🚢 Container &amp; Stuffing Date</th>}
                <th
                  onClick={() => handleSortColumn('extNozzle')}
                  className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'extNozzle' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Ext. Nozzle"
                >
                  <span>Ext. Nozzle</span>
                  {renderSortIcon('extNozzle')}
                </th>
                <th
                  onClick={() => handleSortColumn('finalDia')}
                  className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'finalDia' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Final Dia"
                >
                  <span>Final Dia</span>
                  {renderSortIcon('finalDia')}
                </th>
                <th
                  onClick={() => handleSortColumn('finalDie')}
                  className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'finalDie' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Final Die"
                >
                  <span>Final Die</span>
                  {renderSortIcon('finalDie')}
                </th>
                <th
                  onClick={() => handleSortColumn('sheathColour')}
                  className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'sheathColour' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Sheath Colour"
                >
                  <span>Sheath Colour</span>
                  {renderSortIcon('sheathColour')}
                </th>
                <th
                  onClick={() => handleSortColumn('sheathComp')}
                  className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'sheathComp' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Sheath Compound"
                >
                  <span>Sheath Comp</span>
                  {renderSortIcon('sheathComp')}
                </th>
                <th
                  onClick={() => handleSortColumn('coils')}
                  className={`p-2 border-r border-slate-200 bg-amber-50/90 text-amber-950 text-center cursor-pointer hover:bg-amber-100/80 transition-colors group ${
                    sortField === 'coils' ? 'ring-1 ring-inset ring-blue-400' : ''
                  }`}
                  title="Click to sort by Coils Detail"
                >
                  <span>Coils Detail</span>
                  {renderSortIcon('coils')}
                </th>
                <th className="p-2 border-r border-slate-200 text-center bg-blue-50/80 text-blue-950 min-w-[115px]" title="Drum Size / Spool Packing (Strictly N/A for IS-694 and any cable grade when coils are specified)">Drum Size</th>
                <th
                  onClick={() => handleSortColumn('orderLen')}
                  className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'orderLen' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Order Length (m)"
                >
                  <span>Order Length (m)</span>
                  {renderSortIcon('orderLen')}
                </th>
                {!printFriendly && (
                  <th
                    onClick={() => handleSortColumn('status')}
                    className={`p-2 border-r border-slate-200 text-center min-w-[235px] cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                      sortField === 'status' ? 'bg-blue-50 text-blue-900' : ''
                    }`}
                    title="Click to sort by Stage Progress / Status"
                  >
                    <span>Process Status &amp; Stage Progress Bars</span>
                    {renderSortIcon('status')}
                  </th>
                )}
                <th
                  onClick={() => handleSortColumn('grade')}
                  className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'grade' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Grade"
                >
                  <span>Grade</span>
                  {renderSortIcon('grade')}
                </th>
                {!printFriendly && <th className="p-2 border-r border-slate-200">Sheath Print Details</th>}
                <th className="p-2 text-center no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={printFriendly ? 19 : 25} className="p-8 text-center">
                    <div className="max-w-md mx-auto space-y-2">
                      <div className="inline-flex p-2.5 rounded-full bg-slate-100 text-slate-400">
                        <Search className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-bold text-slate-700">No active orders match your search</p>
                      <p className="text-xs text-slate-500">
                        {searchQuery ? `No results found for "${searchQuery}".` : ''} Try searching for a different batch number, brand (e.g. EKP), cable size (e.g. 1.50 SQ MM), or clearing filters.
                      </p>
                      {(searchQuery || filterBatch || priorityFilter !== 'ALL') && (
                        <button
                          onClick={() => {
                            setSearchQuery('');
                            setFilterBatch('');
                            setPriorityFilter('ALL');
                          }}
                          className="mt-2 text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold shadow-xs inline-flex items-center gap-1.5"
                        >
                          <X className="w-3.5 h-3.5" /> Clear Search & Filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o, idx) => {
                  const rec = computeRecordRow(o, densities, ladiDimensions);
                  const p = o.pStatus || { b: false, c: false, i: false, t: false, s: false };
                  const isHigh = !!(o.is_high_priority || o.priority === 'high');
                  const contAssignments = getContainerAssignmentsForOrder(o, containers);

                  return (
                    <tr
                      key={o.id}
                      className={`transition-colors ${
                        isHigh
                          ? 'bg-rose-50/75 hover:bg-rose-100/70 border-l-4 border-l-rose-500'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      {!printFriendly && <td className="p-2 border-r border-slate-100 text-center">{idx + 1}</td>}
                      {!printFriendly && (
                        <td className="p-2 border-r border-slate-100 text-center">
                          <button
                            type="button"
                            onClick={() => handleTogglePriority(o)}
                            className={`p-1.5 rounded-md transition-all cursor-pointer inline-flex items-center justify-center ${
                              isHigh
                                ? 'bg-rose-100 text-rose-600 hover:bg-rose-200 ring-1 ring-rose-300 shadow-2xs'
                                : 'text-slate-300 hover:text-rose-500 hover:bg-slate-100'
                            }`}
                            title={isHigh ? 'High Priority Order (Click to unmark)' : 'Click to mark as High Priority'}
                          >
                            <Flag className={`w-3.5 h-3.5 ${isHigh ? 'fill-rose-600 text-rose-600' : 'text-slate-400'}`} />
                          </button>
                          {isHigh && (
                            <span className="block text-[8.5px] font-black text-rose-700 uppercase tracking-tight mt-0.5">
                              HIGH
                            </span>
                          )}
                        </td>
                      )}
                      <td className="p-2 border-r border-slate-100 font-bold">
                        <div className="flex items-center gap-1.5">
                          <span className={isHigh ? 'text-rose-950 font-black' : 'text-slate-900'}>{o.batch}</span>
                          {isHigh && (
                            <span className="px-1.5 py-0.2 bg-rose-600 text-white text-[9px] font-extrabold rounded-sm uppercase tracking-wide">
                              Rush
                            </span>
                          )}
                        </div>
                      </td>
                      {!printFriendly && (
                        <td className="p-2 border-r border-slate-100">
                          {(() => {
                            const st = getOrderProgressStats(o, ladiDimensions);
                            const pct = st.percentage;
                            const stageMeta: Record<
                              ProcessStageKey,
                              { name: string; color: string; pill: string }
                            > = {
                              b: {
                                name: 'Bunched',
                                color: 'bg-amber-500',
                                pill: 'bg-amber-100 text-amber-900 border-amber-300',
                              },
                              c: {
                                name: 'Cu Stranded',
                                color: 'bg-orange-500',
                                pill: 'bg-orange-100 text-orange-900 border-orange-300',
                              },
                              i: {
                                name: 'Insulated',
                                color: 'bg-teal-500',
                                pill: 'bg-teal-100 text-teal-900 border-teal-300',
                              },
                              t: {
                                name: 'Twisted',
                                color: 'bg-indigo-500',
                                pill: 'bg-indigo-100 text-indigo-900 border-indigo-300',
                              },
                              s: {
                                name: 'Sheathed',
                                color: 'bg-emerald-500',
                                pill: 'bg-emerald-100 text-emerald-900 border-emerald-300',
                              },
                            };
                            const doneStages = st.requiredKeys.filter(k => Boolean(p[k]));
                            const lastDoneKey =
                              doneStages.length > 0 ? doneStages[doneStages.length - 1] : null;
                            const currentBadge = lastDoneKey
                              ? {
                                  label: `${stageMeta[lastDoneKey].name} ✓`,
                                  cls: stageMeta[lastDoneKey].pill,
                                }
                              : {
                                  label: 'Pending Start',
                                  cls: 'bg-slate-100 text-slate-700 border-slate-300',
                                };
                            return (
                              <div className="space-y-1 min-w-[120px]">
                                <div className="flex items-center justify-between gap-1">
                                  <span
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9.5px] font-extrabold ${currentBadge.cls}`}
                                  >
                                    {currentBadge.label}
                                  </span>
                                  <span className="text-[9.5px] font-black text-slate-700">
                                    {pct}%
                                  </span>
                                </div>
                                {/* Color-coded mini segmented stage bar */}
                                <div className="flex items-center gap-0.5 bg-slate-200/80 p-0.5 rounded-full">
                                  {st.requiredKeys.map(sk => {
                                    const isDone = Boolean(p[sk]);
                                    return (
                                      <div
                                        key={sk}
                                        className={`h-1.5 flex-1 rounded-full transition-all ${
                                          isDone ? stageMeta[sk].color : 'bg-slate-300/70'
                                        }`}
                                        title={`${stageMeta[sk].name}: ${isDone ? 'Completed' : 'Pending'}`}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                      )}
                      <td className="p-2 border-r border-slate-100">{o.brand}</td>
                      <td className="p-2 border-r border-slate-100 font-mono text-[11px]">{o.conductor}</td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-900">{fmtExact(rec.coreOd, 4)}</td>
                      <td className="p-2 border-r border-slate-100 text-right font-semibold text-teal-700">{fmtExact(rec.insDie, 4)}</td>
                      <td className="p-2 border-r border-slate-100 text-right text-teal-700">{fmtExact(rec.nozzle, 4)}</td>
                      <td className="p-2 border-r border-slate-100">
                        <div className="font-semibold text-slate-800">{o.ins_compound}</div>
                        {(o.ins_colour || o.grade?.toUpperCase().includes('IS-694')) && (
                          <div className="mt-1 flex items-center gap-1">
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-extrabold ${
                                o.carton_mode === 'MIX'
                                  ? 'bg-amber-100 text-amber-950 border-amber-400'
                                  : 'bg-rose-100 text-rose-900 border-rose-300'
                              }`}
                            >
                              {o.carton_mode === 'MIX' ? `📦 MIX (${o.ins_colour || 'RD+BK+BL+YL'})` : `🎨 ${o.ins_colour || 'RED'}`}
                            </span>
                            {o.grade?.toUpperCase().includes('IS-694') && (
                              <select
                                value={
                                  o.carton_mode === 'MIX'
                                    ? 'MIX'
                                    : IS694_COLOUR_OPTIONS.includes((o.ins_colour || '').toUpperCase())
                                    ? (o.ins_colour || '').toUpperCase()
                                    : ''
                                }
                                onChange={e => {
                                  if (e.target.value) handleInlineInsColourUpdate(o, e.target.value);
                                }}
                                className="no-print px-1 py-0.5 text-[9.5px] font-bold border border-rose-300 rounded bg-white text-rose-900"
                                title="Change IS-694 Insulation Colour or switch to MIX Carton"
                              >
                                <option value="">Col/Mix</option>
                                {IS694_COLOUR_OPTIONS.map(c => (
                                  <option key={c} value={c}>{c === 'MIX' ? '📦 MIX' : c}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold">
                        {o.grade?.toUpperCase().includes('IS-694') ? '-' : `${o.cores}C`}
                      </td>
                      <td className="p-2 border-r border-slate-100">
                        <div className="font-bold text-slate-900">{o.size}</div>
                        {contAssignments.length > 0 && (
                          <div className="text-[9.5px] font-bold text-indigo-700 mt-0.5">
                            🚢 {contAssignments[0].containerNo} • {contAssignments[0].plannedStuffingDate || 'TBA'}
                          </div>
                        )}
                      </td>
                      {!printFriendly && (
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
                      )}
                      <td className="p-2 border-r border-slate-100 text-right text-amber-800">{fmtExact(rec.extNozzle, 5)}</td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold">{fmtExact(rec.finalDia, 4)}</td>
                      <td className="p-2 border-r border-slate-100 text-right font-semibold text-amber-800">{fmtExact(rec.finalDie, 4)}</td>
                      <td className="p-2 border-r border-slate-100">{o.sheath_colour || '-'}</td>
                      <td className="p-2 border-r border-slate-100">{o.sheath_compound || '-'}</td>
                      <td className="p-2 border-r border-slate-100 bg-amber-50/30 text-center">
                        <div className="flex flex-col items-center gap-1 min-w-[165px]">
                          <div className="flex items-center gap-1 no-print">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={o.coils !== undefined && o.coils !== '' ? o.coils : ''}
                              onChange={(e) =>
                                handleInlineCoilUpdate(o, e.target.value, o.coil_type || '100 YARD')
                              }
                              placeholder="Coils"
                              className="w-14 px-1.5 py-0.5 text-[11px] font-bold text-center border border-amber-300 rounded bg-white text-slate-900 focus:border-amber-600 focus:outline-none"
                              title="Remaining / Active Order Sheet Coils"
                            />
                            <select
                              value={o.coil_type || '100 YARD'}
                              onChange={(e) =>
                                handleInlineCoilUpdate(
                                  o,
                                  o.coils !== undefined && o.coils !== '' ? String(o.coils) : '',
                                  e.target.value
                                )
                              }
                              className="px-1 py-0.5 text-[10px] font-bold border border-amber-300 rounded bg-white text-amber-950 focus:border-amber-600 focus:outline-none"
                              title="Select Coil Length Option"
                            >
                              {COIL_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.value}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleOpenPartialPlanModal(o)}
                              className="px-1.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[9.5px] font-extrabold cursor-pointer shadow-2xs"
                              title="Give Partial Production Plan (e.g., 100 Coils now for IS-694 Packing List & Process Card, keep 300 Coils remaining on Order Sheet)"
                            >
                              ⚡ Give Plan
                            </button>
                          </div>
                          {o.production_lots && o.production_lots.length > 0 ? (
                            <div className="w-full space-y-0.5 text-left bg-indigo-50/90 border border-indigo-300 rounded px-1.5 py-1">
                              <div className="flex items-center justify-between gap-1 text-[9.5px] font-black text-indigo-950">
                                <span>📋 Total Order: {o.total_order_coils || (Number(o.coils || 0) + Number(o.planned_coils || 0))} Coils</span>
                                <button
                                  type="button"
                                  onClick={() => handleResetPartialPlan(o)}
                                  className="text-[9px] text-rose-700 hover:underline font-extrabold no-print"
                                  title="Restore all coils back to Order Sheet"
                                >
                                  ↺ Reset
                                </button>
                              </div>
                              <div className="text-[9.5px] font-extrabold text-emerald-800">
                                ✅ Sent to Packing/Plan: {o.planned_coils || 0} Coils ({o.production_lots.length} {o.production_lots.length === 1 ? 'Lot' : 'Lots'})
                              </div>
                              <div className="text-[10px] font-black text-amber-900 bg-amber-100/90 px-1 py-0.2 rounded border border-amber-300">
                                ⏳ Remaining Here: {o.coils} Coils × {o.coil_type || '90 MTR'}
                              </div>
                            </div>
                          ) : o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0 ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold">
                              {o.coils} Coils × {o.coil_type || '100 YARD'}
                              {o.ins_colour ? ` (${o.ins_colour})` : ''}
                            </span>
                          ) : (
                            <span className="hidden print:inline text-slate-400">-</span>
                          )}
                          {o.coil_colour_breakdown && Object.keys(o.coil_colour_breakdown).length > 0 && (
                            <div className="flex flex-wrap justify-center gap-1 mt-0.5">
                              {Object.entries(o.coil_colour_breakdown).map(([col, cnt]) => (
                                <span
                                  key={col}
                                  className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-900 border border-rose-300 text-[9.5px] font-black"
                                >
                                  {col}: {cnt}
                                </span>
                              ))}
                            </div>
                          )}
                          {o.grade?.toUpperCase().includes('IS-694') && (
                            (() => {
                              const ctnInfo = computeIs694CartonPackingForOrder(
                                o,
                                densities,
                                ladiDimensions,
                                vihanRules,
                                maruRules
                              );
                              return (
                                <div className="mt-0.5 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-950 border border-indigo-200 text-[9.5px] font-extrabold">
                                  📦 {ctnInfo.packingSummaryText}
                                </div>
                              );
                            })()
                          )}
                        </div>
                      </td>
                      <td className="p-2 border-r border-slate-100 text-center bg-slate-50/40">
                        {(() => {
                          const isIs694 = (o.grade || '').toUpperCase().includes('IS-694');
                          const hasCoils = o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0;
                          if (isIs694) {
                            return (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-black text-[9.5px] bg-rose-100 text-rose-900 border border-rose-300"
                                title="IS-694 dispatches in Master Cartons only. Drum Size is not applicable."
                              >
                                N/A (Carton Pack)
                              </span>
                            );
                          }
                          if (hasCoils) {
                            return (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-black text-[9.5px] bg-amber-100 text-amber-950 border border-amber-300"
                                title="Coil details specified. Drum is not applicable for any cable grade when coils are mentioned."
                              >
                                N/A (Coils Pack)
                              </span>
                            );
                          }
                          const evalPkg = evaluateSpoolSizeForOrder(
                            rec.finalDia,
                            rec.orderLen,
                            rec.size,
                            rec.cores,
                            rec.grade,
                            sizeRules || [],
                            packagingRules || [],
                            o.spool_size
                          );
                          return (
                            <div className="space-y-0.5">
                              <span className="font-mono font-extrabold text-blue-900 text-[11px]">
                                {o.spool_size || evalPkg.spool || 'Standard'}
                              </span>
                              <div className="text-[9.5px] font-bold text-slate-500">
                                {evalPkg.packaging || 'Drum'}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-900">
                        <div>{rec.orderLen.toLocaleString()}</div>
                        {o.production_lots && o.production_lots.length > 0 && o.total_order_length && (
                          <div className="text-[9.5px] font-extrabold text-indigo-700">
                            (of {o.total_order_length.toLocaleString()} m)
                          </div>
                        )}
                      </td>
                      {!printFriendly && (
                        <td className="p-2 border-r border-slate-100 text-center min-w-[235px]">
                          {(() => {
                            const stats = getOrderProgressStats(o, ladiDimensions);
                            const orderPct = stats.percentage;
                            const stageKeys: ProcessStageKey[] = ['b', 'c', 'i', 't', 's'];
                            const stageTheme: Record<
                              ProcessStageKey,
                              {
                                fullLabel: string;
                                doneBtn: string;
                                nextBtn: string;
                                barFill: string;
                                barPending: string;
                                textDone: string;
                              }
                            > = {
                              b: {
                                fullLabel: 'Bunched',
                                doneBtn: 'bg-amber-500 text-white shadow-2xs ring-1 ring-amber-600',
                                nextBtn: 'bg-amber-50 text-amber-900 ring-1 ring-amber-400 hover:bg-amber-100',
                                barFill: 'bg-amber-500',
                                barPending: 'bg-amber-200/70',
                                textDone: 'text-amber-700',
                              },
                              c: {
                                fullLabel: 'Cu Stranded',
                                doneBtn: 'bg-orange-500 text-white shadow-2xs ring-1 ring-orange-600',
                                nextBtn: 'bg-orange-50 text-orange-900 ring-1 ring-orange-400 hover:bg-orange-100',
                                barFill: 'bg-orange-500',
                                barPending: 'bg-orange-200/70',
                                textDone: 'text-orange-700',
                              },
                              i: {
                                fullLabel: 'Insulated',
                                doneBtn: 'bg-teal-600 text-white shadow-2xs ring-1 ring-teal-700',
                                nextBtn: 'bg-teal-50 text-teal-900 ring-1 ring-teal-400 hover:bg-teal-100',
                                barFill: 'bg-teal-500',
                                barPending: 'bg-teal-200/70',
                                textDone: 'text-teal-700',
                              },
                              t: {
                                fullLabel: 'Twisted',
                                doneBtn: 'bg-indigo-600 text-white shadow-2xs ring-1 ring-indigo-700',
                                nextBtn: 'bg-indigo-50 text-indigo-900 ring-1 ring-indigo-400 hover:bg-indigo-100',
                                barFill: 'bg-indigo-500',
                                barPending: 'bg-indigo-200/70',
                                textDone: 'text-indigo-700',
                              },
                              s: {
                                fullLabel: 'Sheathed',
                                doneBtn: 'bg-emerald-600 text-white shadow-2xs ring-1 ring-emerald-700',
                                nextBtn: 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-400 hover:bg-emerald-100',
                                barFill: 'bg-emerald-500',
                                barPending: 'bg-emerald-200/70',
                                textDone: 'text-emerald-700',
                              },
                            };

                            return (
                              <div className="space-y-1.5 py-0.5">
                                {/* Row 1: Interactive Color-Coded Stage Toggle Badges */}
                                <div className="flex items-center justify-center gap-1">
                                  {stageKeys.map(sk => {
                                    const lock = getStageLockState(o, sk, ladiDimensions);
                                    const isNext = stats.nextActiveStage === sk;
                                    const shortLabel = STAGE_SHORT_LABELS[sk];
                                    const theme = stageTheme[sk];

                                    if (!lock.isRequired) {
                                      return (
                                        <span
                                          key={sk}
                                          title={`Skipped by rules: ${lock.skipReason}`}
                                          className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold bg-slate-100 text-slate-400 line-through select-none cursor-not-allowed"
                                        >
                                          {shortLabel}
                                        </span>
                                      );
                                    }

                                    return (
                                      <button
                                        key={sk}
                                        type="button"
                                        onClick={() => onToggleProcess(o.id, sk)}
                                        title={
                                          lock.isDone
                                            ? `${theme.fullLabel} (${shortLabel}) Completed${
                                                o.pTimestamps?.[sk]
                                                  ? ` at ${formatHistoryTimestamp(o.pTimestamps[sk]!)}`
                                                  : ''
                                              } (Click to undo)`
                                            : lock.isUnlocked
                                            ? `Next Serial Step: Click to mark ${theme.fullLabel} (${shortLabel}) Done`
                                            : `Locked: Complete ${lock.missingPrerequisiteLabel} first`
                                        }
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-all inline-flex items-center gap-0.5 ${
                                          lock.isDone
                                            ? `${theme.doneBtn} cursor-pointer`
                                            : lock.isUnlocked
                                            ? isNext
                                              ? `${theme.nextBtn} cursor-pointer`
                                              : 'bg-slate-200 text-slate-700 hover:bg-slate-300 cursor-pointer'
                                            : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300 cursor-not-allowed'
                                        }`}
                                      >
                                        {!lock.isDone && !lock.isUnlocked && <Lock className="w-2.5 h-2.5" />}
                                        <span>{shortLabel}</span>
                                        {lock.isDone && <span className="text-[8.5px]">✓</span>}
                                      </button>
                                    );
                                  })}
                                </div>

                                {/* Row 2: Color-Coded Multi-Stage Segmented Progress Bar */}
                                <div className="w-52 mx-auto bg-slate-100 border border-slate-200 rounded-full p-0.5 flex items-center gap-0.5 shadow-2xs">
                                  {stats.requiredKeys.map(sk => {
                                    const lock = getStageLockState(o, sk, ladiDimensions);
                                    const isNext = stats.nextActiveStage === sk;
                                    const theme = stageTheme[sk];
                                    return (
                                      <div
                                        key={sk}
                                        onClick={() => onToggleProcess(o.id, sk)}
                                        className={`h-2 flex-1 first:rounded-l-full last:rounded-r-full transition-all duration-300 cursor-pointer ${
                                          lock.isDone
                                            ? theme.barFill
                                            : isNext
                                            ? `${theme.barPending} animate-pulse`
                                            : 'bg-slate-200'
                                        }`}
                                        title={`${theme.fullLabel} (${STAGE_SHORT_LABELS[sk]}): ${
                                          lock.isDone
                                            ? 'Completed ✓'
                                            : isNext
                                            ? 'In Progress / Next Stage'
                                            : 'Pending'
                                        }`}
                                      />
                                    );
                                  })}
                                </div>

                                {/* Row 3: Stage Names + Overall Color-Coded Progress Bar */}
                                <div className="w-52 mx-auto flex items-center justify-between gap-1.5 text-[9.5px]">
                                  <div className="flex items-center gap-1 truncate">
                                    {stats.requiredKeys.map(sk => {
                                      const isDone = Boolean(p[sk]);
                                      const theme = stageTheme[sk];
                                      return (
                                        <span
                                          key={sk}
                                          className={`font-extrabold ${
                                            isDone ? theme.textDone : 'text-slate-400'
                                          }`}
                                          title={`${theme.fullLabel}: ${isDone ? 'Done' : 'Pending'}`}
                                        >
                                          { theme.fullLabel.split(' ').pop() }
                                          {isDone ? '✓' : ''}
                                        </span>
                                      );
                                    })}
                                  </div>
                                  <span
                                    className={`px-1.5 py-0.2 rounded-full font-black shrink-0 ${
                                      orderPct === 100
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : orderPct >= 60
                                        ? 'bg-teal-100 text-teal-800'
                                        : orderPct > 0
                                        ? 'bg-amber-100 text-amber-900'
                                        : 'bg-slate-100 text-slate-600'
                                    }`}
                                  >
                                    {stats.completedCount}/{stats.totalRequired} ({orderPct}%)
                                  </span>
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                      )}
                      <td className="p-2 border-r border-slate-100">
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-bold">
                          {o.grade}
                        </span>
                      </td>
                      {!printFriendly && (
                        <td className="p-2 border-r border-slate-100 min-w-[170px] max-w-[260px]">
                          {inlineEditingPrintOrderId === o.id ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={inlinePrintText}
                                  onChange={(e) => setInlinePrintText(e.target.value)}
                                  className="w-full px-1.5 py-0.5 text-xs font-bold border-2 border-indigo-400 rounded bg-white text-slate-900 focus:outline-none"
                                  placeholder="Edit print legend"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    onAddOrUpdateOrder({ ...o, print_details: inlinePrintText.trim() }, false);
                                    setInlineEditingPrintOrderId(null);
                                  }}
                                  className="p-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs"
                                  title="Save print legend"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setInlineEditingPrintOrderId(null)}
                                  className="p-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700"
                                  title="Cancel"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              {/* Grade Presets dropdown right in the table */}
                              <select
                                value=""
                                onChange={(e) => {
                                  if (e.target.value) {
                                    setInlinePrintText(e.target.value);
                                  }
                                }}
                                className="w-full px-1 py-0.5 text-[10px] font-bold border border-indigo-300 rounded bg-indigo-50/70 text-indigo-950 cursor-pointer"
                                title={`Choose ${o.grade} preset`}
                              >
                                <option value="">-- Pick {o.grade} Preset --</option>
                                {getGradePrintPresets(
                                  o.grade,
                                  o.brand,
                                  o.cores,
                                  o.size,
                                  o.ins_colour,
                                  orders,
                                  customPrintTemplates
                                ).map((tpl, idx) => (
                                  <option key={idx} value={tpl}>
                                    {tpl}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-1 group">
                              <span
                                className="text-xs font-semibold text-slate-800 truncate"
                                title={o.print_details || 'Click pencil to edit print legend'}
                              >
                                {o.print_details || '-'}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setInlineEditingPrintOrderId(o.id);
                                  setInlinePrintText(o.print_details || '');
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-indigo-600 hover:bg-indigo-50 transition-opacity no-print"
                                title="Edit Print Legend / Choose Grade Preset"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                      <td className="p-2 text-center no-print">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleOpenPartialPlanModal(o)}
                            className="px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 rounded font-extrabold text-[10.5px] flex items-center gap-1 shadow-2xs cursor-pointer"
                            title="Give Partial Production Plan in 2+ times (e.g., 100 Coils now to Packing/Process, keep remaining 300 Coils on Order Sheet)"
                          >
                            ⚡ Plan Lot
                          </button>
                          <button
                            onClick={() => setTrackingOrderId(o.id)}
                            className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded font-semibold text-[11px] flex items-center gap-1 shadow-2xs"
                            title="Quick Process Tracking (Toggle B/C/I/T/S)"
                          >
                            <Activity className="w-3 h-3" /> Track
                          </button>
                          <button
                            onClick={() => onSelectForRequisition(o.batch, o.brand, o.size, o.id)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-semibold text-[11px] flex items-center gap-1 shadow-2xs"
                            title="Open Process Cards for this order"
                          >
                            📇 Cards
                          </button>
                          <button
                            onClick={() => handleTogglePriority(o)}
                            className={`p-1 rounded transition-colors ${
                              isHigh
                                ? 'bg-rose-100 text-rose-600 hover:bg-rose-200'
                                : 'text-slate-400 hover:text-rose-600 hover:bg-slate-100'
                            }`}
                            title={isHigh ? 'Remove High Priority' : 'Mark as High Priority'}
                          >
                            <Flag className={`w-3.5 h-3.5 ${isHigh ? 'fill-rose-600' : ''}`} />
                          </button>
                          <button
                            onClick={() => handleEdit(o)}
                            className="p-1 hover:bg-slate-100 rounded text-slate-600"
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
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

      {/* Process Tracking Quick Modal */}
      {(() => {
        const activeTrackingOrder = trackingOrderId ? orders.find(o => o.id === trackingOrderId) : null;
        if (!activeTrackingOrder) return null;

        const stats = getOrderProgressStats(activeTrackingOrder, ladiDimensions);
        const doneCount = stats.completedCount;
        const totalReq = stats.totalRequired;
        const pct = stats.percentage;

        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden">
              {/* Modal Header */}
              <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="p-1.5 rounded-lg bg-indigo-600 text-white">
                    <Activity className="w-4 h-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <span>Order #{activeTrackingOrder.id} Serial Process Tracking</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {activeTrackingOrder.batch}
                      </span>
                    </h3>
                    <div className="text-[11px] text-slate-400 font-medium">
                      {activeTrackingOrder.brand} • {activeTrackingOrder.cores}C × {activeTrackingOrder.size} ({activeTrackingOrder.conductor})
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setTrackingOrderId(null)}
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4">
                {/* Progress Summary */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-700">Serial Production Progress:</span>
                    <span className={pct === 100 ? 'text-emerald-600 font-extrabold' : 'text-blue-600'}>
                      {pct}% ({doneCount}/{totalReq} Required Stages Done)
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        pct === 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-blue-600' : pct > 0 ? 'bg-amber-500' : 'bg-slate-300'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-600">
                    🔒 <strong>Strict Serial Order:</strong> Bunching must be completed first, followed by Cu Stranding (if required by rules for &gt; 6 SQ MM), otherwise directly to Insulation → Twisting → Sheathing.
                  </p>
                </div>

                {/* 5 Stages Interactive List */}
                <div className="space-y-2">
                  {[
                    { key: 'b' as const, num: '1', name: '1. Copper Bunching (B)', desc: 'Always Step 1: Conductor bunching and spool preparation' },
                    { key: 'c' as const, num: '2', name: '2. Cu Stranding (CS)', desc: 'Ladi copper stranding (Required by rules only for > 6 SQ MM)' },
                    { key: 'i' as const, num: '3', name: '3. Insulation Process (I)', desc: 'Extrusion of PVC insulation over conductor' },
                    { key: 't' as const, num: '4', name: '4. Core Stranding / Twisting (TS)', desc: 'Twisting of insulated cores (Required for multi-core cables)' },
                    { key: 's' as const, num: '5', name: '5. Sheathing Process (SH)', desc: 'Final PVC/Compound jacket extrusion and printing' },
                  ].map(stage => {
                    const lock = getStageLockState(activeTrackingOrder, stage.key, ladiDimensions);
                    const isDone = lock.isDone;
                    const isNext = stats.nextActiveStage === stage.key;

                    return (
                      <div
                        key={stage.key}
                        onClick={() => onToggleProcess(activeTrackingOrder.id, stage.key)}
                        className={`p-3 rounded-lg border flex items-center justify-between gap-3 transition-all ${
                          !lock.isRequired
                            ? 'bg-slate-50 border-slate-200 text-slate-400 opacity-70 cursor-not-allowed'
                            : isDone
                            ? 'bg-emerald-50/80 border-emerald-300 text-slate-900 shadow-2xs cursor-pointer'
                            : lock.isUnlocked
                            ? isNext
                              ? 'bg-blue-50/70 border-blue-400 text-slate-900 ring-1 ring-blue-400/50 cursor-pointer'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer'
                            : 'bg-slate-50 border-dashed border-slate-300 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                              !lock.isRequired
                                ? 'bg-slate-200 text-slate-400'
                                : isDone
                                ? 'bg-emerald-600 text-white'
                                : lock.isUnlocked
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-200 text-slate-500'
                            }`}
                          >
                            {!lock.isRequired ? '—' : isDone ? '✓' : lock.isUnlocked ? stage.num : <Lock className="w-3 h-3" />}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                              <span className={!lock.isRequired ? 'line-through text-slate-400' : ''}>{stage.name}</span>
                              {isNext && (
                                <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-blue-600 text-white font-extrabold uppercase">
                                  Next Serial Step
                                </span>
                              )}
                            </div>
                            <div className="text-[10.5px] text-slate-500">
                              {!lock.isRequired
                                ? `Skipped by rules: ${lock.skipReason}`
                                : !lock.isUnlocked && !isDone
                                ? `🔒 Locked — Complete ${lock.missingPrerequisiteLabel} first`
                                : stage.desc}
                            </div>
                          </div>
                        </div>

                        {!lock.isRequired ? (
                          <span className="text-[10px] px-2 py-1 rounded bg-slate-200/80 text-slate-500 font-bold shrink-0">
                            Not Needed (Rule)
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleProcess(activeTrackingOrder.id, stage.key);
                            }}
                            className={`text-xs px-2.5 py-1 rounded font-bold transition-all shrink-0 flex items-center gap-1 ${
                              isDone
                                ? 'bg-emerald-600 text-white shadow-2xs hover:bg-emerald-700'
                                : lock.isUnlocked
                                ? 'bg-blue-600 text-white shadow-2xs hover:bg-blue-700'
                                : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {isDone ? '✓ Completed' : lock.isUnlocked ? 'Mark Done' : '🔒 Locked'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="bg-slate-50 p-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSelectForRequisition(
                      activeTrackingOrder.batch,
                      activeTrackingOrder.brand,
                      activeTrackingOrder.size,
                      activeTrackingOrder.id
                    );
                    setTrackingOrderId(null);
                  }}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-xs flex items-center gap-1.5 shadow-xs"
                >
                  <span>📇 Open in Process Cards</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTrackingOrderId(null)}
                  className="px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded font-semibold text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Partial Production Plan Release Modal (Give 1 Order in 2+ Times for Process & Packing) */}
      {(() => {
        const targetOrder = partialPlanModalOrderId
          ? orders.find(o => o.id === partialPlanModalOrderId)
          : null;
        if (!targetOrder) return null;

        const coilTypeStr = targetOrder.coil_type || '90 MTR';
        const mult = getCoilMultiplier(coilTypeStr);
        const currentRemCoils =
          Number(targetOrder.coils) > 0
            ? Number(targetOrder.coils)
            : Math.max(0, Math.round((targetOrder.order_length || 0) / mult));
        const prevPlannedCoils = Number(targetOrder.planned_coils) || 0;
        const totalOrderedCoils =
          Number(targetOrder.total_order_coils) > 0
            ? Number(targetOrder.total_order_coils)
            : currentRemCoils + prevPlannedCoils;
        const giveNowCoils = Math.max(
          1,
          Math.min(currentRemCoils || totalOrderedCoils, Math.round(parseFloat(modalGiveCoilsInput) || 0))
        );
        const afterRemainingCoils = Math.max(0, currentRemCoils - giveNowCoils);
        const nextLotNumber = (targetOrder.production_lots?.length || 0) + 1;

        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print">
            <div className="bg-white rounded-xl shadow-2xl border-2 border-indigo-600 max-w-lg w-full overflow-hidden">
              <div className="bg-indigo-950 text-white p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide flex items-center gap-2">
                    <span>⚡ Split / Partial Production Plan (Give Order in 2+ Times)</span>
                  </h3>
                  <p className="text-[11px] text-indigo-200 mt-0.5">
                    Job #{targetOrder.batch} • {targetOrder.brand} • {targetOrder.size} ({targetOrder.grade || 'IS-694'})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPartialPlanModalOrderId(null)}
                  className="p-1 rounded-lg hover:bg-indigo-900 text-indigo-300 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs">
                {/* Summary Boxes */}
                <div className="grid grid-cols-3 gap-2.5 text-center">
                  <div className="p-2.5 rounded-lg bg-slate-100 border border-slate-300">
                    <div className="text-[10px] font-bold uppercase text-slate-500">Total Order</div>
                    <div className="text-base font-black text-slate-900 mt-0.5">
                      {totalOrderedCoils} Coils
                    </div>
                    <div className="text-[10px] font-semibold text-slate-600">
                      {(totalOrderedCoils * mult).toLocaleString()} m ({coilTypeStr})
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-300">
                    <div className="text-[10px] font-bold uppercase text-emerald-700">Already in Plan</div>
                    <div className="text-base font-black text-emerald-900 mt-0.5">
                      {prevPlannedCoils} Coils
                    </div>
                    <div className="text-[10px] font-semibold text-emerald-700">
                      {targetOrder.production_lots?.length || 0} Released Lot(s)
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300">
                    <div className="text-[10px] font-bold uppercase text-amber-800">Available Here</div>
                    <div className="text-base font-black text-amber-950 mt-0.5">
                      {currentRemCoils} Coils
                    </div>
                    <div className="text-[10px] font-semibold text-amber-800">
                      {(currentRemCoils * mult).toLocaleString()} m on Order Sheet
                    </div>
                  </div>
                </div>

                {/* Existing Production Lots */}
                {targetOrder.production_lots && targetOrder.production_lots.length > 0 && (
                  <div className="bg-indigo-50/70 border border-indigo-200 rounded-lg p-3 space-y-1.5">
                    <div className="text-[11px] font-black text-indigo-950 uppercase">
                      📦 Released Production Plan Lots (Shown on IS-694 Packing List &amp; Process Card):
                    </div>
                    <div className="space-y-1">
                      {targetOrder.production_lots.map(lot => (
                        <div
                          key={lot.id}
                          className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded border border-indigo-200 text-[11px]"
                        >
                          <div>
                            <span className="font-black text-indigo-900">
                              Lot #{lot.lotNo}{lot.notes ? ` (${lot.notes})` : ''}:
                            </span>{' '}
                            <span className="font-extrabold text-emerald-800">
                              {lot.coils} Coils × {lot.coil_type} ({lot.order_length.toLocaleString()} m)
                            </span>
                            {lot.carton_count ? (
                              <span className="ml-1.5 px-1.5 py-0.2 rounded bg-rose-100 text-rose-900 font-bold text-[10px]">
                                {lot.carton_count} Cartons
                              </span>
                            ) : null}
                          </div>
                          <span className="text-[10px] text-slate-500 font-semibold">{lot.date}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Input for Next Partial Release */}
                {currentRemCoils > 0 ? (
                  <div className="bg-amber-50/70 border-2 border-amber-400 rounded-lg p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-amber-950 uppercase">
                        ⚡ Give Coils for Lot #{nextLotNumber} Production Plan Now:
                      </label>
                      <div className="flex items-center gap-1">
                        {[25, 50, 100, currentRemCoils]
                          .filter((v, i, a) => v > 0 && v <= currentRemCoils && a.indexOf(v) === i)
                          .map(preset => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setModalGiveCoilsInput(String(preset))}
                              className="px-2 py-0.5 rounded bg-white hover:bg-amber-200 text-amber-950 border border-amber-400 text-[10px] font-extrabold cursor-pointer"
                            >
                              {preset === currentRemCoils ? `All Rem (${preset})` : `${preset} Coils`}
                            </button>
                          ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                          Coils to Release to Packing &amp; Process Card *
                        </label>
                        <input
                          type="number"
                          min="1"
                          max={currentRemCoils}
                          step="1"
                          value={modalGiveCoilsInput}
                          onChange={e => setModalGiveCoilsInput(e.target.value)}
                          className="w-full p-2 border-2 border-indigo-500 rounded bg-white font-black text-sm text-indigo-950"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                          Lot Label / Schedule Note
                        </label>
                        <input
                          type="text"
                          value={modalLotNotesInput}
                          onChange={e => setModalLotNotesInput(e.target.value)}
                          placeholder={`Lot #${nextLotNumber} (This Week Plan)`}
                          className="w-full p-2 border border-slate-300 rounded bg-white font-semibold text-xs"
                        />
                      </div>
                    </div>

                    {/* Live Preview of Split */}
                    <div className="bg-white border border-amber-300 rounded p-2.5 text-[11px] space-y-1">
                      <div className="font-extrabold text-emerald-800">
                        ✅ Will Show on IS-694 Packing List &amp; Process Card (Lot #{nextLotNumber}):{' '}
                        <span className="font-black underline">
                          {giveNowCoils} Coils ({(giveNowCoils * mult).toLocaleString()} m)
                        </span>
                      </div>
                      <div className="font-extrabold text-amber-900">
                        ⏳ Will Remain on Active Orders Sheet for Next Week:{' '}
                        <span className="font-black underline">
                          {afterRemainingCoils} Coils ({(afterRemainingCoils * mult).toLocaleString()} m)
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 font-bold text-center">
                    All {totalOrderedCoils} Coils of this order have been released to Production Plan Lots!
                  </div>
                )}
              </div>

              <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-between gap-2">
                {targetOrder.production_lots && targetOrder.production_lots.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleResetPartialPlan(targetOrder);
                      setPartialPlanModalOrderId(null);
                    }}
                    className="px-3 py-1.5 border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 rounded font-bold text-xs cursor-pointer"
                  >
                    ↺ Reset All Lots back to {totalOrderedCoils} Coils
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPartialPlanModalOrderId(null)}
                    className="px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded font-semibold text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  {currentRemCoils > 0 && (
                    <button
                      type="button"
                      onClick={handleConfirmPartialPlan}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-black text-xs shadow-sm cursor-pointer"
                    >
                      ⚡ Release {giveNowCoils} Coils to Plan &amp; Packing List
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
