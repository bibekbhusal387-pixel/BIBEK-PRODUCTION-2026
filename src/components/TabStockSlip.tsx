import React, { useState, useMemo } from 'react';
import {
  CableOrder,
  DensitySettings,
  LadiDimensionRule,
  ManualPackingItem,
  MonthlyStockSnapshot,
  PackagingRule,
  PurchaseItem,
  SizePackagingRule,
  StockItem,
  StockReturnRejection,
} from '../types/cable';
import {
  computeLiveStockLedger,
  extractStrandDiameter,
  normalizeMaterialKey,
  rollMonthClosingToOpening,
  StockLedgerRow,
} from '../utils/stockEngine';
import { exportCsvFile, evaluateSpoolSizeForOrder } from '../utils/calculations';
import {
  Layers,
  Plus,
  Trash2,
  Search,
  Printer,
  CheckCircle2,
  Truck,
  PackageCheck,
  RotateCcw,
  ArrowRightLeft,
  Calendar,
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Edit2,
  Check,
  X,
  History,
  Boxes,
  Box,
  Zap,
  Camera,
  Archive,
  Filter,
} from 'lucide-react';

interface TabStockSlipProps {
  orders: CableOrder[];
  purchaseItems: PurchaseItem[];
  customStockItems: StockItem[];
  manualPackingItems?: ManualPackingItem[];
  stockReturns: StockReturnRejection[];
  stockOpenings: Record<string, number>;
  monthlySnapshots: Record<string, MonthlyStockSnapshot>;
  onUpdateStockOpenings: (openings: Record<string, number>) => void;
  onUpdateStockReturns: (returns: StockReturnRejection[]) => void;
  onUpdateMonthlySnapshots: (snapshots: Record<string, MonthlyStockSnapshot>) => void;
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
  onUpdateCustomStock: (index: number, field: keyof StockItem, value: any) => void;
  onDeleteCustomStock: (index: number) => void;
  onAddCustomStock: (item: StockItem) => void;
  onNavigateTab?: (tabId: string) => void;
  onUpdateOrders?: (orders: CableOrder[]) => void;
}

export const TabStockSlip: React.FC<TabStockSlipProps> = ({
  orders,
  purchaseItems,
  customStockItems,
  manualPackingItems = [],
  stockReturns,
  stockOpenings,
  monthlySnapshots,
  onUpdateStockOpenings,
  onUpdateStockReturns,
  onUpdateMonthlySnapshots,
  densities,
  ladiDimensions,
  sizeRules,
  packagingRules,
  onUpdateCustomStock,
  onDeleteCustomStock,
  onAddCustomStock,
  onNavigateTab,
  onUpdateOrders,
}) => {
  // Navigation sub-tabs within Tab 11
  const [activeSubTab, setActiveSubTab] = useState<
    'all' | 'raw' | 'drums' | 'finished' | 'returns' | 'openings' | 'consumption_logs' | 'monthly_report'
  >('all');

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');

  // Modal states
  const [isAddReturnModalOpen, setIsAddReturnModalOpen] = useState(false);
  const [isAddCustomModalOpen, setIsAddCustomModalOpen] = useState(false);
  const [isOpeningManagerOpen, setIsOpeningManagerOpen] = useState(false);

  // Return / Rejection modal state
  const [retCategory, setRetCategory] = useState<
    'COPPER' | 'INSULATION' | 'SHEATH' | 'FINISHED' | 'DRUMS' | 'PALLETS' | 'OTHER'
  >('COPPER');
  const [retMaterialName, setRetMaterialName] = useState('0.21 Drawn Strands');
  const [retType, setRetType] = useState<
    'supplier_rejection' | 'scrap_rejection' | 'customer_return' | 'line_return'
  >('supplier_rejection');
  const [retQty, setRetQty] = useState('');
  const [retUnit, setRetUnit] = useState('KGS');
  const [retReason, setRetReason] = useState('');
  const [retRef, setRetRef] = useState('');
  const [retNotes, setRetNotes] = useState('');

  // Custom Item Modal state
  const [customName, setCustomName] = useState('');
  const [customCat, setCustomCat] = useState('COPPER');
  const [customUnit, setCustomUnit] = useState('KGS');
  const [customOpening, setCustomOpening] = useState('0');
  const [customReceived, setCustomReceived] = useState('0');

  // Manual Add Item / Finished Good to Opening Stock Modal & Inline Bar state
  const [isAddOpeningItemModalOpen, setIsAddOpeningItemModalOpen] = useState(false);
  const [openAddCategory, setOpenAddCategory] = useState<
    'FINISHED_IS694' | 'FINISHED_DRUM' | 'RAW_COPPER' | 'BUNCHED_COPPER' | 'INSULATION' | 'SHEATH' | 'DRUM' | 'PALLET' | 'CUSTOM'
  >('FINISHED_IS694');
  const [openAddSize, setOpenAddSize] = useState('1C × 1.50 SQ MM');
  const [openAddMaterialGrade, setOpenAddMaterialGrade] = useState('VIHAN TRIGUARD (IS-694)');
  const [openAddItemName, setOpenAddItemName] = useState('1C × 1.50 SQ MM - VIHAN TRIGUARD (IS-694)');
  const [openAddMtrs, setOpenAddMtrs] = useState('');
  const [openAddKgs, setOpenAddKgs] = useState('');
  const [openAddCoils, setOpenAddCoils] = useState('');
  const [openAddCartons, setOpenAddCartons] = useState('');
  const [openAddCoilsPerCarton, setOpenAddCoilsPerCarton] = useState('20');
  const [openAddCoilLen, setOpenAddCoilLen] = useState('90');
  const [openAddDrums, setOpenAddDrums] = useState('');
  const [openAddUnit, setOpenAddUnit] = useState('MTRS');

  // Inline Per-Card Quick Add State (Dropdown + Manual Input of Size & Material)
  const [cardCopperSize, setCardCopperSize] = useState('');
  const [cardCopperKg, setCardCopperKg] = useState('');
  const [cardBunchCopperSize, setCardBunchCopperSize] = useState('');
  const [cardBunchCopperKg, setCardBunchCopperKg] = useState('');
  const [cardBunchCopperMtrs, setCardBunchCopperMtrs] = useState('');
  const [cardInsMat, setCardInsMat] = useState('');
  const [cardInsKg, setCardInsKg] = useState('');
  const [cardSheathMat, setCardSheathMat] = useState('');
  const [cardSheathKg, setCardSheathKg] = useState('');
  const [cardDrumSize, setCardDrumSize] = useState('');
  const [cardDrumMat, setCardDrumMat] = useState('');
  const [cardDrumNos, setCardDrumNos] = useState('');
  const [cardPalletSize, setCardPalletSize] = useState('');
  const [cardPalletMat, setCardPalletMat] = useState('');
  const [cardPalletNos, setCardPalletNos] = useState('');
  const [cardIs694Size, setCardIs694Size] = useState('1C × 1.50 SQ MM');
  const [cardIs694Mat, setCardIs694Mat] = useState('VIHAN TRIGUARD');
  const [cardIs694Coils, setCardIs694Coils] = useState('');
  const [cardIs694Cartons, setCardIs694Cartons] = useState('');
  const [cardCableSize, setCardCableSize] = useState('4C × 2.50 SQ.MM');
  const [cardCableMat, setCardCableMat] = useState('MYRCAB H07RN-F');
  const [cardCableMtrs, setCardCableMtrs] = useState('');
  const [cardCableKgs, setCardCableKgs] = useState('');

  // Inline feedback toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => (prev === msg ? null : prev));
    }, 4000);
  };

  // Track which opening stock keys have been manually entered by the user
  const [lockedOpeningKeys, setLockedOpeningKeys] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('plutus_locked_opening_keys_v2');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  // Custom manual stock overrides (Received, Consumed) editable across all sections
  // One-time strip of legacy .opening overrides so all opening stock starts at 0 until manually input
  const [stockOverrides, setStockOverrides] = useState<
    Record<string, { opening?: number; received?: number; consumed?: number }>
  >(() => {
    try {
      const isZeroed = localStorage.getItem('plutus_opening_stock_zeroed_v2_overrides') === 'true';
      const saved = localStorage.getItem('plutus_stock_overrides');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!isZeroed && parsed && typeof parsed === 'object') {
          const cleaned: Record<string, { opening?: number; received?: number; consumed?: number }> = {};
          Object.keys(parsed).forEach(k => {
            if (parsed[k]) {
              const { opening: _ignored, ...rest } = parsed[k];
              cleaned[k] = rest;
            }
          });
          localStorage.setItem('plutus_stock_overrides', JSON.stringify(cleaned));
          localStorage.setItem('plutus_opening_stock_zeroed_v2_overrides', 'true');
          return cleaned;
        }
        return parsed;
      }
      localStorage.setItem('plutus_opening_stock_zeroed_v2_overrides', 'true');
    } catch (e) {}
    return {};
  });

  // Synchronizes both the Master Ledger rowKey (e.g. COPPER||0.210) and Opening Manager key (e.g. RAW_COPPER||0.210)
  const applyUnifiedOpeningKey = (
    baseMap: Record<string, number>,
    rawKey: string,
    val: number
  ): { nextOpenings: Record<string, number>; allKeys: string[] } => {
    const next = { ...baseMap, [rawKey]: val };
    const touchedKeys = [rawKey];
    if (rawKey.startsWith('RAW_COPPER||')) {
      const strand = rawKey.replace('RAW_COPPER||', '');
      const alt = `COPPER||${strand}`;
      next[alt] = val;
      touchedKeys.push(alt);
    } else if (rawKey.startsWith('COPPER||')) {
      const strand = rawKey.replace('COPPER||', '');
      const alt = `RAW_COPPER||${strand}`;
      next[alt] = val;
      touchedKeys.push(alt);
    }
    return { nextOpenings: next, allKeys: touchedKeys };
  };

  const handleUpdateOverride = (
    key: string,
    field: 'opening' | 'received' | 'consumed',
    val: number
  ) => {
    if (field === 'opening') {
      handleUpdateOpening(key, val);
      return;
    }
    const updated = {
      ...stockOverrides,
      [key]: {
        ...(stockOverrides[key] || {}),
        [field]: val,
      },
    };
    setStockOverrides(updated);
    try {
      localStorage.setItem('plutus_stock_overrides', JSON.stringify(updated));
    } catch (e) {}
  };

  // Handlers for manual Opening Stock updates (locks the manual opening so it is never overwritten)
  const handleUpdateOpening = (matKey: string, val: number) => {
    const { nextOpenings, allKeys } = applyUnifiedOpeningKey(stockOpenings, matKey, val);
    onUpdateStockOpenings(nextOpenings);

    const nextLocks = { ...lockedOpeningKeys };
    allKeys.forEach(k => {
      nextLocks[k] = true;
    });
    setLockedOpeningKeys(nextLocks);

    // Also keep stockOverrides[k].opening in sync
    const updatedOverrides = { ...stockOverrides };
    allKeys.forEach(k => {
      updatedOverrides[k] = {
        ...(updatedOverrides[k] || {}),
        opening: val,
      };
    });
    setStockOverrides(updatedOverrides);

    try {
      localStorage.setItem('plutus_stock_openings', JSON.stringify(nextOpenings));
      localStorage.setItem('plutus_stock_openings_manual_v2', JSON.stringify(nextOpenings));
      localStorage.setItem('plutus_stock_openings_baseline', JSON.stringify(nextOpenings));
      localStorage.setItem('plutus_locked_opening_keys_v2', JSON.stringify(nextLocks));
      localStorage.setItem('plutus_stock_overrides', JSON.stringify(updatedOverrides));
    } catch (e) {}
  };

  // Explicitly zero all opening stock when requested by user
  const handleZeroAllOpeningStock = () => {
    onUpdateStockOpenings({});
    setLockedOpeningKeys({});
    const cleanedOverrides: Record<string, { opening?: number; received?: number; consumed?: number }> = {};
    Object.keys(stockOverrides).forEach(k => {
      const { opening: _ignored, ...rest } = stockOverrides[k] || {};
      cleanedOverrides[k] = rest;
    });
    setStockOverrides(cleanedOverrides);
    try {
      localStorage.setItem('plutus_stock_openings', JSON.stringify({}));
      localStorage.setItem('plutus_stock_openings_manual_v2', JSON.stringify({}));
      localStorage.setItem('plutus_stock_openings_baseline', JSON.stringify({}));
      localStorage.setItem('plutus_locked_opening_keys_v2', JSON.stringify({}));
      localStorage.setItem('plutus_stock_overrides', JSON.stringify(cleanedOverrides));
    } catch (e) {}
    showToast('0️⃣ All Opening Stock balances have been reset to 0. You can now manually input each opening balance.');
  };

  // Store current edited stock data as default baseline
  const handleSaveOpeningBaseline = () => {
    try {
      localStorage.setItem('plutus_stock_openings_baseline', JSON.stringify(stockOpenings));
      localStorage.setItem('plutus_stock_openings_manual_v2', JSON.stringify(stockOpenings));
      showToast('🔒 Saved and locked your manually entered Opening Stock balances!');
    } catch (e) {
      showToast('⚠️ Could not save baseline to storage.');
    }
  };

  // Reset to Standard Defaults: Restores the user's last saved edit data baseline without overwriting locked manual entries
  const handleResetToBaseline = () => {
    try {
      localStorage.setItem('plutus_stock_openings_baseline', JSON.stringify(stockOpenings));
    } catch (e) {}
    showToast('🔒 Current manually entered Opening Stock is locked and preserved.');
  };

  // Handler for IS-694 dual input (coils <-> cartons) in Opening Stock
  const handleUpdateIs694Opening = (
    baseKey: string,
    field: 'coils' | 'cartons' | 'mtrs' | 'kgs',
    val: number,
    cpc: number = 16,
    len: number = 90
  ) => {
    const next = { ...stockOpenings };
    const currentCoils = next[`${baseKey}||COILS`] || (next[baseKey] ? Math.round(next[baseKey] / len) : 0);
    const currentCartons = next[`${baseKey}||CARTONS`] || (cpc > 0 ? Number((currentCoils / cpc).toFixed(2)) : 0);

    let nextCoils = currentCoils;
    let nextCartons = currentCartons;
    let nextMtrs = next[baseKey] || 0;

    if (field === 'coils') {
      nextCoils = val;
      nextCartons = cpc > 0 ? Number((val / cpc).toFixed(2)) : 0;
      nextMtrs = val * len;
    } else if (field === 'cartons') {
      nextCartons = val;
      nextCoils = Math.round(val * cpc);
      nextMtrs = nextCoils * len;
    } else if (field === 'mtrs') {
      nextMtrs = val;
      nextCoils = len > 0 ? Math.round(val / len) : 0;
      nextCartons = cpc > 0 ? Number((nextCoils / cpc).toFixed(2)) : 0;
    } else if (field === 'kgs') {
      next[`${baseKey}||KGS`] = val;
    }

    next[baseKey] = nextMtrs;
    next[`${baseKey}||COILS`] = nextCoils;
    next[`${baseKey}||CARTONS`] = nextCartons;

    onUpdateStockOpenings(next);

    const nextLocks = {
      ...lockedOpeningKeys,
      [baseKey]: true,
      [`${baseKey}||COILS`]: true,
      [`${baseKey}||CARTONS`]: true,
    };
    setLockedOpeningKeys(nextLocks);

    try {
      localStorage.setItem('plutus_stock_openings', JSON.stringify(next));
      localStorage.setItem('plutus_stock_openings_manual_v2', JSON.stringify(next));
      localStorage.setItem('plutus_locked_opening_keys_v2', JSON.stringify(nextLocks));
    } catch (e) {}
  };

  // Preset Dropdown Options for Size and Material by Category
  const getCategorySizePresets = (cat: typeof openAddCategory): string[] => {
    switch (cat) {
      case 'FINISHED_IS694':
        return Array.from(
          new Set([
            '1C × 0.50 SQ MM',
            '1C × 0.75 SQ MM',
            '1C × 1.00 SQ MM',
            '1C × 1.50 SQ MM',
            '1C × 2.50 SQ MM',
            '1C × 4.00 SQ MM',
            '1C × 6.00 SQ MM',
            '1C × 10.00 SQ MM',
            '1C × 16.00 SQ MM',
            ...orders.filter(o => (o.grade || '').includes('IS-694')).map(o => `${o.cores}C × ${o.size}`),
          ])
        );
      case 'FINISHED_DRUM':
        return Array.from(
          new Set([
            '1C × 16.00 SQ.MM',
            '1C × 25.00 SQ.MM',
            '1C × 35.00 SQ.MM',
            '1C × 50.00 SQ.MM',
            '1C × 70.00 SQ.MM',
            '1C × 95.00 SQ.MM',
            '1C × 120.00 SQ.MM',
            '1C × 150.00 SQ.MM',
            '1C × 185.00 SQ.MM',
            '1C × 240.00 SQ.MM',
            '2C × 1.50 SQ.MM',
            '2C × 2.50 SQ.MM',
            '3C × 1.50 SQ.MM',
            '3C × 2.50 SQ.MM',
            '3C × 4.00 SQ.MM',
            '3C × 6.00 SQ.MM',
            '4C × 1.50 SQ.MM',
            '4C × 2.50 SQ.MM',
            '4C × 4.00 SQ.MM',
            '4C × 6.00 SQ.MM',
            '4C × 10.00 SQ.MM',
            '4C × 16.00 SQ.MM',
            '4C × 25.00 SQ.MM',
            '5C × 2.50 SQ.MM',
            '5C × 4.00 SQ.MM',
            ...orders.map(o => `${o.cores}C × ${o.size}`),
          ])
        );
      case 'RAW_COPPER':
        return ['0.180', '0.193', '0.200', '0.210', '0.250', '0.260', '0.265', '0.266', '0.300', '0.400', '8.00mm Cu Rod'];
      case 'BUNCHED_COPPER':
        return Array.from(
          new Set([
            '14/0.180 (0.50 SQ MM)',
            '24/0.200 (0.75 SQ MM)',
            '32/0.200 (1.00 SQ MM)',
            '30/0.210 (1.50 SQ MM)',
            '30/0.250 (1.50 SQ MM)',
            '48/0.200 (1.50 SQ MM)',
            '50/0.210 (2.50 SQ MM)',
            '52/0.260 (2.50 SQ MM)',
            '80/0.200 (2.50 SQ MM)',
            '56/0.260 (4.00 SQ MM)',
            '78/0.260 (4.00 SQ MM)',
            '84/0.260 (6.00 SQ MM)',
            '129/0.260 (6.00 SQ MM)',
            '80/0.400 (10.00 SQ MM)',
            '182/0.260 (10.00 SQ MM)',
            '126/0.400 (16.00 SQ MM)',
            '294/0.266 (16.00 SQ MM)',
            '196/0.400 (25.00 SQ MM)',
            '455/0.266 (25.00 SQ MM)',
            '276/0.400 (35.00 SQ MM)',
            '637/0.266 (35.00 SQ MM)',
            '396/0.400 (50.00 SQ MM)',
            '910/0.266 (50.00 SQ MM)',
            '777/0.300 (70.00 SQ MM)',
            '1274/0.266 (70.00 SQ MM)',
            '1729/0.266 (95.00 SQ MM)',
            '2184/0.266 (120.00 SQ MM)',
            ...ladiDimensions.map(l => `${l.conductor} (${l.size} SQ MM)`),
            ...orders
              .filter(o => o.conductor && o.conductor.includes('/'))
              .map(o => `${o.conductor.trim()}${o.size ? ` (${o.size.trim()})` : ''}`),
          ])
        );
      case 'INSULATION':
        return ['Standard Granules (25kg Bag)', 'Extrusion Grade', 'Masterbatch Mix', 'Bulk Silo / Jumbo Bag'];
      case 'SHEATH':
        return ['Standard Granules (25kg Bag)', 'Heavy Duty Sheath Grade', 'Outer Jacket Compound'];
      case 'DRUM':
        return [
          '28 X 12 X 15',
          '30 X 12 X 15',
          '30 X 12 X 19',
          '34 X 12 X 16',
          '36 X 16 X 20',
          '42 X 12 X 16',
          '42 X 12 X 20',
          '42 X 12 X 24',
          '42 X 12 X 30',
          '48 X 16 X 28',
          '54 X 18 X 30',
          '60 X 20 X 32',
        ];
      case 'PALLET':
        return ['30X30x6', '36X36x6', '40X40x6', '42X42x6', '44X44x6', '48X48x6'];
      default:
        return ['Standard Size', 'Custom Size'];
    }
  };

  const getCategoryMaterialPresets = (cat: typeof openAddCategory): string[] => {
    switch (cat) {
      case 'FINISHED_IS694':
        return Array.from(
          new Set([
            'VIHAN TRIGUARD (IS-694)',
            'MARU MIRACLE (IS-694)',
            'TRIGUARD STACK (IS-694)',
            'TRIGUARD BOX (IS-694)',
            'OPTO (IS-694)',
            'PLUTUS (IS-694)',
            ...orders.filter(o => (o.grade || '').includes('IS-694')).map(o => `${o.brand} (${o.grade})`),
          ])
        );
      case 'FINISHED_DRUM':
        return Array.from(
          new Set([
            'MYRCAB H07RN-F',
            'MYBCAB H07RN-F',
            'PLUTUS BS-6500',
            'PLUTUS IS-694',
            'MARU FLEXIBLE',
            ...orders.map(o => `${o.brand} ${o.grade}`),
          ])
        );
      case 'RAW_COPPER':
        return ['Drawn Bare Copper Wire', 'Annealed Copper Wire', 'Electrolytic Grade A Copper', 'Tinned Copper Wire'];
      case 'BUNCHED_COPPER':
        return ['Annealed Bunched Copper', 'Flexible Ladi Copper', 'Tinned Bunched Copper', 'Multi-Strand Bunched Copper'];
      case 'INSULATION':
        return ['KI-06', 'KI-13', 'TI1', 'GRADE A', 'A 80 UW', 'A 80 NATURAL', 'FR PVC', 'FRLS PVC', 'ZHFR', 'XLPE'];
      case 'SHEATH':
        return ['ST-1 GREY', 'ST2', 'KI-05', 'A80 HD BLACK', 'ST-1 BLACK', 'FRLS SHEATH', 'HOFR RUBBER'];
      case 'DRUM':
        return ['Wooden Spool Drum', 'Fumigated Export Drum', 'Heavy Duty Hardwood Drum', 'Steel Flange Drum'];
      case 'PALLET':
        return ['Wooden Dispatch Pallet', 'Heat-Treated ISPM-15 Pallet', 'Heavy Duty 2-Way Pallet', '4-Way Euro Pallet'];
      default:
        return ['General Material', 'Packing Material', 'Consumable'];
    }
  };

  // Sync combined openAddItemName whenever size or material changes
  const syncCombinedOpeningName = (
    cat: typeof openAddCategory,
    sizeVal: string,
    matVal: string
  ) => {
    const s = sizeVal.trim();
    const m = matVal.trim();
    if (cat === 'FINISHED_IS694' || cat === 'FINISHED_DRUM') {
      const combined = s && m ? `${s} - ${m}` : s || m;
      setOpenAddItemName(combined);
      if (cat === 'FINISHED_IS694') {
        const cpc = s.includes('1.50') || s.includes('1.00') || s.includes('0.75') || s.includes('0.50') ? '20' : s.includes('2.50') ? '16' : '10';
        setOpenAddCoilsPerCarton(cpc);
      }
    } else if (cat === 'RAW_COPPER') {
      setOpenAddItemName(s || m);
    } else if (cat === 'BUNCHED_COPPER') {
      setOpenAddItemName(s && m && !m.toLowerCase().includes('annealed') ? `${s} - ${m}` : s || m);
    } else if (cat === 'INSULATION' || cat === 'SHEATH') {
      setOpenAddItemName(m || s);
    } else if (cat === 'DRUM' || cat === 'PALLET') {
      setOpenAddItemName(s && m && !m.toLowerCase().includes('wooden') ? `${s} (${m})` : s || m);
    } else {
      setOpenAddItemName(s && m ? `${m} - ${s}` : m || s);
    }
  };

  // Submit handler for adding a new item or finished good to opening stock
  const handleSaveNewOpeningItem = (e: React.FormEvent) => {
    e.preventDefault();
    const fallbackCombined =
      openAddCategory === 'INSULATION' || openAddCategory === 'SHEATH'
        ? openAddMaterialGrade.trim() || openAddSize.trim()
        : openAddCategory === 'RAW_COPPER' || openAddCategory === 'BUNCHED_COPPER' || openAddCategory === 'DRUM' || openAddCategory === 'PALLET'
        ? openAddSize.trim() || openAddMaterialGrade.trim()
        : `${openAddSize.trim()}${openAddMaterialGrade.trim() ? ` - ${openAddMaterialGrade.trim()}` : ''}`;
    const rawName = (openAddItemName.trim() || fallbackCombined).trim();
    if (!rawName) {
      showToast('⚠️ Please select or manually enter a Size and Material specification.');
      return;
    }

    let finalKey = '';
    const next = { ...stockOpenings };
    const nextLocks = { ...lockedOpeningKeys };

    if (openAddCategory === 'FINISHED_IS694') {
      const coils = parseFloat(openAddCoils) || 0;
      const cartons = parseFloat(openAddCartons) || 0;
      const cpc = parseFloat(openAddCoilsPerCarton) || 16;
      const len = parseFloat(openAddCoilLen) || 90;
      const effectiveCoils = coils > 0 ? coils : Math.round(cartons * cpc);
      const effectiveMtrs = parseFloat(openAddMtrs) || (effectiveCoils * len);
      const effectiveCartons = cartons > 0 ? cartons : (cpc > 0 ? Number((effectiveCoils / cpc).toFixed(2)) : 0);
      const kgs = parseFloat(openAddKgs) || 0;

      finalKey = `FINISHED||${rawName.startsWith('IS-694') ? rawName : `IS-694 Finished Carton Stock (${rawName})`}`;
      next[finalKey] = effectiveMtrs;
      next[`${finalKey}||COILS`] = effectiveCoils;
      next[`${finalKey}||CARTONS`] = effectiveCartons;
      if (kgs > 0) next[`${finalKey}||KGS`] = kgs;
      nextLocks[finalKey] = true;
      nextLocks[`${finalKey}||COILS`] = true;
      nextLocks[`${finalKey}||CARTONS`] = true;
    } else if (openAddCategory === 'FINISHED_DRUM') {
      const mtrs = parseFloat(openAddMtrs) || 0;
      const kgs = parseFloat(openAddKgs) || 0;
      finalKey = `FINISHED||${rawName.startsWith('Finished Cable') ? rawName : `Finished Cable Drum (${rawName})`}`;
      next[finalKey] = mtrs;
      if (kgs > 0) next[`${finalKey}||KGS`] = kgs;
      nextLocks[finalKey] = true;
    } else if (openAddCategory === 'RAW_COPPER') {
      const kgs = parseFloat(openAddKgs) || 0;
      finalKey = `RAW_COPPER||${rawName}`;
      next[finalKey] = kgs;
      next[`COPPER||${rawName}`] = kgs;
      nextLocks[finalKey] = true;
      nextLocks[`COPPER||${rawName}`] = true;
    } else if (openAddCategory === 'BUNCHED_COPPER') {
      const kgs = parseFloat(openAddKgs) || 0;
      const mtrs = parseFloat(openAddMtrs) || 0;
      finalKey = `BUNCHED_COPPER||${rawName}`;
      next[finalKey] = kgs;
      if (mtrs > 0) {
        next[`${finalKey}||MTRS`] = mtrs;
        nextLocks[`${finalKey}||MTRS`] = true;
      }
      nextLocks[finalKey] = true;
    } else if (openAddCategory === 'INSULATION') {
      const kgs = parseFloat(openAddKgs) || 0;
      finalKey = `INSULATION||${rawName.toUpperCase()}`;
      next[finalKey] = kgs;
      nextLocks[finalKey] = true;
    } else if (openAddCategory === 'SHEATH') {
      const kgs = parseFloat(openAddKgs) || 0;
      finalKey = `SHEATH||${rawName.toUpperCase()}`;
      next[finalKey] = kgs;
      nextLocks[finalKey] = true;
    } else if (openAddCategory === 'DRUM') {
      const nos = parseFloat(openAddDrums) || 0;
      finalKey = `DRUM||${rawName}`;
      next[finalKey] = nos;
      nextLocks[finalKey] = true;
    } else if (openAddCategory === 'PALLET') {
      const nos = parseFloat(openAddDrums) || 0;
      finalKey = `PALLET||${rawName}`;
      next[finalKey] = nos;
      nextLocks[finalKey] = true;
    } else {
      const qty = parseFloat(openAddMtrs || openAddKgs || '0') || 0;
      finalKey = `CUSTOM||${rawName}||0`;
      next[finalKey] = qty;
      nextLocks[finalKey] = true;
    }

    onUpdateStockOpenings(next);
    setLockedOpeningKeys(nextLocks);

    try {
      localStorage.setItem('plutus_stock_openings', JSON.stringify(next));
      localStorage.setItem('plutus_stock_openings_manual_v2', JSON.stringify(next));
      localStorage.setItem('plutus_locked_opening_keys_v2', JSON.stringify(nextLocks));
    } catch (e) {}

    setIsAddOpeningItemModalOpen(false);
    setOpenAddItemName('');
    setOpenAddMtrs('');
    setOpenAddKgs('');
    setOpenAddCoils('');
    setOpenAddCartons('');
    setOpenAddDrums('');
    showToast(`✅ Added "${rawName}" to Opening Stock! Balance permanently saved & locked.`);
  };

  // Compute live stock results through stockEngine
  const stockResult = computeLiveStockLedger({
    orders,
    purchaseItems,
    customStockItems,
    manualPackingItems,
    stockReturns,
    stockOpenings,
    stockOverrides,
    selectedMonth,
    densities,
    ladiDimensions,
    sizeRules,
    packagingRules,
  });

  const { totals, stageConsumptionLogs } = stockResult;

  // Extract all available unique categories dynamically from stockResult.allRows
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    stockResult.allRows.forEach(r => {
      if (r.category && r.category.trim()) {
        set.add(r.category.trim());
      }
    });
    return Array.from(set).sort();
  }, [stockResult.allRows]);

  // Filter rows according to sub-tab, category-based dropdown filter, and text search query
  let displayRows: StockLedgerRow[] = stockResult.allRows;
  if (activeSubTab === 'raw') {
    displayRows = [
      ...stockResult.rawCopperRows,
      ...stockResult.bunchedCopperRows,
      ...stockResult.insulationRows,
      ...stockResult.sheathingRows,
    ];
  } else if (activeSubTab === 'drums') {
    displayRows = [...stockResult.drumRows, ...stockResult.palletRows];
  } else if (activeSubTab === 'finished') {
    displayRows = [...stockResult.semiFinishedRows, ...stockResult.finishedGoodsRows];
  }

  // Category-based dropdown filter
  if (categoryFilter !== 'ALL') {
    displayRows = displayRows.filter(r =>
      (r.category || '').toUpperCase().trim() === categoryFilter.toUpperCase().trim()
    );
  }

  // Text search input filter
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    displayRows = displayRows.filter(r =>
      `${r.category || ''} ${r.name || ''} ${r.unit || ''} ${r.remark || ''} ${r.key || ''} ${r.details || ''}`
        .toLowerCase()
        .includes(q)
    );
  }

  // Calculated totals for filtered displayRows (Master Inventory Ledger)
  const displayTotals = useMemo(() => {
    return displayRows.reduce(
      (acc, item) => {
        acc.opening += item.opening || 0;
        acc.received += item.received || 0;
        acc.totalStock += (item.opening || 0) + (item.received || 0);
        acc.consumed += item.consumed || 0;
        acc.rejections += (item.supplierRejections || 0) + (item.scrapRejections || 0);
        acc.returns += (item.customerReturns || 0) + (item.lineReturns || 0);
        acc.closing += item.closing || 0;

        // Accurate physical unit separation:
        if (item.isNosOnly || item.unit === 'NOS') {
          acc.closingNos += item.closing || 0;
        } else if (item.isFinishedDirectWt) {
          // Finished goods & Semi-finished: item.closing is meters, directKgs is weight in kg
          acc.closingMtrs += item.closing || 0;
          acc.closingKgs += item.directKgs || 0;
        } else if (item.isWeightOnly || item.unit === 'KGS') {
          acc.closingKgs += item.closing || 0;
        } else if (item.unit === 'MTRS') {
          acc.closingMtrs += item.closing || 0;
        } else {
          if (item.unit?.toUpperCase().includes('KG')) {
            acc.closingKgs += item.closing || 0;
          } else {
            acc.closingMtrs += item.closing || 0;
          }
        }
        return acc;
      },
      {
        opening: 0,
        received: 0,
        totalStock: 0,
        consumed: 0,
        rejections: 0,
        returns: 0,
        closing: 0,
        closingMtrs: 0,
        closingKgs: 0,
        closingNos: 0,
      }
    );
  }, [displayRows]);

  // Calculated totals for Month Summary Ledger (all rows)
  const monthSummaryTotals = useMemo(() => {
    return stockResult.allRows.reduce(
      (acc, item) => {
        acc.opening += item.opening || 0;
        acc.received += item.received || 0;
        acc.totalStock += (item.opening || 0) + (item.received || 0);
        acc.consumed += item.consumed || 0;
        acc.rejections += (item.supplierRejections || 0) + (item.scrapRejections || 0);
        acc.returns += (item.customerReturns || 0) + (item.lineReturns || 0);
        acc.closing += item.closing || 0;
        return acc;
      },
      {
        opening: 0,
        received: 0,
        totalStock: 0,
        consumed: 0,
        rejections: 0,
        returns: 0,
        closing: 0,
      }
    );
  }, [stockResult.allRows]);

  // Add new Return / Rejection
  const handleSaveReturnRejection = (e: React.FormEvent) => {
    e.preventDefault();
    const qNum = parseFloat(retQty);
    if (isNaN(qNum) || qNum <= 0 || !retMaterialName.trim() || !retReason.trim()) {
      showToast('⚠️ Please fill in all required return/rejection fields.');
      return;
    }

    const newRet: StockReturnRejection = {
      id: `RET-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      category: retCategory,
      materialName: retMaterialName.trim(),
      type: retType,
      qty: qNum,
      unit: retUnit.trim() || 'KGS',
      reason: retReason.trim(),
      batchOrInvoice: retRef.trim(),
      notes: retNotes.trim(),
    };

    onUpdateStockReturns([newRet, ...stockReturns]);
    setIsAddReturnModalOpen(false);
    setRetQty('');
    setRetReason('');
    setRetRef('');
    setRetNotes('');

    const actionDesc =
      retType === 'supplier_rejection'
        ? `Supplier Rejection of ${qNum} ${retUnit} recorded (- deducted from stock)`
        : retType === 'scrap_rejection'
        ? `Production Scrap of ${qNum} ${retUnit} recorded (- deducted from stock)`
        : retType === 'customer_return'
        ? `Customer Return of ${qNum} ${retUnit} added back to stock`
        : `Line Return of ${qNum} ${retUnit} returned to warehouse`;

    showToast(`✅ ${actionDesc}`);
  };

  const handleDeleteReturn = (id: string) => {
    onUpdateStockReturns(stockReturns.filter(r => r.id !== id));
    showToast('🗑️ Deleted return/rejection record.');
  };

  // Add Custom Stock Item
  const handleSaveCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;
    onAddCustomStock({
      category: customCat.toUpperCase(),
      name: customName.trim(),
      unit: customUnit.trim() || 'KGS',
      opening: parseFloat(customOpening) || 0,
      received: parseFloat(customReceived) || 0,
      consumed: 0,
      remark: 'Active Custom Item',
    });
    setIsAddCustomModalOpen(false);
    setCustomName('');
    showToast(`✅ Added custom stock item "${customName.trim()}".`);
  };

  // Monthly Auto-Rollover Handler (preserves any manually input opening stock!)
  const handleExecuteMonthRollover = (sourceMonth: string, targetMonth: string) => {
    const rolled = rollMonthClosingToOpening({
      sourceResult: stockResult,
      sourceMonthKey: sourceMonth,
      targetMonthKey: targetMonth,
      existingSnapshots: monthlySnapshots,
    });

    onUpdateMonthlySnapshots(rolled.updatedSnapshots);
    // Preserve all existing manually entered opening stocks — never overwrite old openings after manual input!
    const preservedOpenings = { ...rolled.newOpeningMap, ...stockOpenings };
    onUpdateStockOpenings(preservedOpenings);
    showToast(
      `🔄 Archived ${sourceMonth} Snapshot for ${targetMonth} (all manually input Opening Stock values preserved untouched).`
    );
  };

  // Generate Monthly Snapshot:
  // Archives current closing stock into monthly snapshots while strictly preserving the user's manual Opening Stock
  const handleGenerateMonthlySnapshot = () => {
    // 1. Determine active source month
    let sourceMonth = selectedMonth;
    if (!sourceMonth || sourceMonth === 'ALL') {
      const now = new Date();
      sourceMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // 2. Determine target next month
    const [yStr, mStr] = sourceMonth.split('-');
    const year = parseInt(yStr, 10) || 2026;
    const month = parseInt(mStr, 10) || 10;
    let nextMonth = month + 1;
    let nextYear = year;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    const targetMonth = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;

    // 3. Archive snapshot without overwriting user's manually entered Opening Stock
    const rolled = rollMonthClosingToOpening({
      sourceResult: stockResult,
      sourceMonthKey: sourceMonth,
      targetMonthKey: targetMonth,
      existingSnapshots: monthlySnapshots,
    });

    onUpdateMonthlySnapshots(rolled.updatedSnapshots);

    try {
      localStorage.setItem('plutus_monthly_stock_snapshots', JSON.stringify(rolled.updatedSnapshots));
    } catch (e) {}

    setSelectedMonth(targetMonth);

    showToast(
      `📸 Monthly Snapshot archived for ${sourceMonth} → ${targetMonth}! Your manually entered Opening Stock values were kept locked and unchanged.`
    );
  };

  // Download Stock Report: Formatted CSV summarizing opening stock, additions, subtractions, and calculated current closing stock
  const handleDownloadStockReport = () => {
    const headers = [
      'Category',
      'Material / Item Name',
      'Unit',
      'Opening Stock',
      'Inward / Received',
      'Total Stock (Opening + Inward)',
      'Additions (Purchases & Returns)',
      'Subtractions (Auto-Consumed, Rejections & Dispatches)',
      'Closing Stock (MTRS)',
      'Closing Stock (KGS / NOS)',
      'Stock Condition / Deficit Alert',
      'Process Stage Auto-Trace / Remarks',
    ];

    const rows: (string | number)[][] = [headers];

    displayRows.forEach(item => {
      const additions = (item.received || 0) + (item.customerReturns || 0) + (item.lineReturns || 0);
      const subtractions =
        (item.consumed || 0) + (item.supplierRejections || 0) + (item.scrapRejections || 0);
      const totalAvailable = (item.opening || 0) + (item.received || 0);

      const condition =
        item.closing < 0
          ? `DEFICIT (Auto-Consumed: ${item.isNosOnly ? item.closingMtrsStr : item.closingKgsStr})`
          : item.closing === 0
          ? 'ZERO BALANCE'
          : 'AVAILABLE IN STOCK (OK)';

      rows.push([
        item.category,
        item.name,
        item.unit,
        item.opening,
        item.received,
        totalAvailable,
        additions,
        subtractions,
        item.closingMtrsStr,
        item.closingKgsStr,
        condition,
        item.remark || '',
      ]);
    });

    // Summary Total row at the bottom of the CSV
    const totalAdditions = displayRows.reduce(
      (a, b) => a + (b.received || 0) + (b.customerReturns || 0) + (b.lineReturns || 0),
      0
    );
    const totalSubtractions = displayRows.reduce(
      (a, b) => a + (b.consumed || 0) + (b.supplierRejections || 0) + (b.scrapRejections || 0),
      0
    );

    rows.push([
      'TOTAL SUMMARY',
      `${displayRows.length} ITEMS`,
      '-',
      displayTotals.opening.toFixed(2),
      displayTotals.received.toFixed(2),
      displayTotals.totalStock.toFixed(2),
      totalAdditions.toFixed(2),
      totalSubtractions.toFixed(2),
      displayTotals.closingMtrs > 0 ? `${displayTotals.closingMtrs.toFixed(1)} M` : '-',
      displayTotals.closingKgs.toFixed(2),
      'NET STOCK BALANCE',
      'All Items Summary',
    ]);

    exportCsvFile(
      `PLUTUS_STOCK_REPORT_${selectedMonth === 'ALL' ? 'ALL_TIME' : selectedMonth}_${new Date().toISOString().split('T')[0]}.csv`,
      rows
    );
    showToast('📊 Downloaded formatted Stock Report CSV with Total Stock column!');
  };

  // Export full stock CSV
  const handleExportCSV = () => {
    const rows: (string | number)[][] = [
      [
        'Category',
        'Material Name',
        'Unit',
        'Opening Stock',
        'Received / Produced',
        'Total Stock (Opening + Received)',
        'Auto-Consumed at Process Stages',
        'Supplier Rejections (-)',
        'Scrap Rejections (-)',
        'Customer/Line Returns (+)',
        'Closing Stock (MTRS)',
        'Closing Stock (KGS)',
        'Status / Stage Link',
      ],
    ];

    displayRows.forEach(item => {
      rows.push([
        item.category,
        item.name,
        item.unit,
        item.opening,
        item.received,
        (item.opening || 0) + (item.received || 0),
        item.consumed,
        item.supplierRejections,
        item.scrapRejections,
        item.customerReturns + item.lineReturns,
        item.closingMtrsStr,
        item.closingKgsStr,
        item.remark || '',
      ]);
    });

    // Append Total Summary row
    rows.push([
      'TOTAL SUMMARY',
      `${displayRows.length} ITEMS`,
      '-',
      displayTotals.opening.toFixed(2),
      displayTotals.received.toFixed(2),
      displayTotals.totalStock.toFixed(2),
      displayTotals.consumed.toFixed(2),
      displayRows.reduce((a, b) => a + (b.supplierRejections || 0), 0).toFixed(2),
      displayRows.reduce((a, b) => a + (b.scrapRejections || 0), 0).toFixed(2),
      displayTotals.returns.toFixed(2),
      displayTotals.closingMtrs > 0 ? `${displayTotals.closingMtrs.toFixed(1)} M` : '-',
      displayTotals.closingKgs.toFixed(2),
      'Master Stock Summary',
    ]);

    exportCsvFile(`PLUTUS_LIVE_STOCK_LEDGER_${new Date().toISOString().split('T')[0]}.csv`, rows);
  };

  // Formatted 1-Table-Per-Page Printable Monthly Report
  const handleDownloadFormattedMonthlyReport = () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>PLUTUS Monthly Stock & Inventory Report</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #fff; color: #0f172a; margin: 0; padding: 12px; }
    .header { background: #0f172a; color: #fff; padding: 12px 18px; border-radius: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
    .title { font-size: 15px; font-weight: 800; text-transform: uppercase; }
    .sub { font-size: 11px; color: #cbd5e1; }
    .print-card { background: #fff; border: 1.5px solid #0f172a; border-radius: 6px; padding: 12px; margin-bottom: 20px; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; }
    .print-card:last-child { page-break-after: auto; break-after: auto; }
    h2 { margin: 0 0 8px 0; font-size: 13px; font-weight: bold; text-transform: uppercase; color: #0f172a; border-bottom: 2px solid #cbd5e1; padding-bottom: 4px; display: flex; justify-content: space-between; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    th, td { border: 1px solid #94a3b8; padding: 4px 6px; text-align: left; }
    th { background: #e2e8f0; font-weight: 700; text-transform: uppercase; font-size: 9.5px; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .font-bold { font-weight: bold; }
    .badge { padding: 2px 5px; border-radius: 4px; font-size: 9px; font-weight: bold; background: #e2e8f0; }
    @media print { .no-print { display: none !important; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header no-print">
    <div>
      <div class="title">⚡ PLUTUS CABLE PRODUCTION — MONTHLY INVENTORY & STOCK REPORT</div>
      <div class="sub">Generated: ${new Date().toLocaleString()} | Period: ${selectedMonth === 'ALL' ? 'Cumulative / All Time' : selectedMonth} | 1 Table Per Page Mode</div>
    </div>
    <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:bold;cursor:pointer;">🖨️ Print Report (1 Table Per Page)</button>
  </div>

  <!-- TABLE 1: RAW COPPER & BUNCHED COPPER STOCK -->
  <div class="print-card">
    <h2>
      <span>1. RAW COPPER & BUNCHED COPPER STOCK LEDGER</span>
      <span>Total Available: ${totals.totalRawCopperStockKg.toFixed(2)} KG</span>
    </h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Material Name & Strand</th>
          <th class="text-center">Unit</th>
          <th class="text-right">Opening Stock</th>
          <th class="text-right">Receipts / Purchase</th>
          <th class="text-right" style="background:#e0e7ff;color:#1e1b4b;font-weight:bold;">Total Stock (Op+Rec)</th>
          <th class="text-right">Auto-Consumed (Stage B)</th>
          <th class="text-right">Supplier Rej (-)</th>
          <th class="text-right">Inward Returns (+)</th>
          <th class="text-right">Closing Balance</th>
          <th>Status / Notes</th>
        </tr>
      </thead>
      <tbody>
        ${[...stockResult.rawCopperRows, ...stockResult.bunchedCopperRows].map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td><strong>${r.name}</strong></td>
          <td class="text-center">${r.unit}</td>
          <td class="text-right">${r.opening.toFixed(2)}</td>
          <td class="text-right">${r.received.toFixed(2)}</td>
          <td class="text-right font-bold" style="background:#e0e7ff;color:#1e1b4b;">${(r.opening + r.received).toFixed(2)}</td>
          <td class="text-right font-bold" style="color:#b45309;">${r.consumed > 0 ? `-${r.consumed.toFixed(2)}` : '0'}</td>
          <td class="text-right">${r.supplierRejections > 0 ? `-${r.supplierRejections.toFixed(2)}` : '0'}</td>
          <td class="text-right">${r.customerReturns + r.lineReturns > 0 ? `+${(r.customerReturns + r.lineReturns).toFixed(2)}` : '0'}</td>
          <td class="text-right font-bold" style="background:#fef3c7;">${r.closingKgsStr}</td>
          <td>${r.remark}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- TABLE 2: PVC INSULATION & SHEATHING COMPOUNDS -->
  <div class="print-card">
    <h2>
      <span>2. PVC INSULATION & SHEATHING COMPOUNDS STOCK LEDGER</span>
      <span>Insulation: ${totals.totalInsulationStockKg.toFixed(2)} KG | Sheathing: ${totals.totalSheathingStockKg.toFixed(2)} KG</span>
    </h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Compound Category & Grade</th>
          <th class="text-center">Unit</th>
          <th class="text-right">Opening Stock</th>
          <th class="text-right">Receipts / Purchase</th>
          <th class="text-right" style="background:#e0e7ff;color:#1e1b4b;font-weight:bold;">Total Stock (Op+Rec)</th>
          <th class="text-right">Auto-Consumed (Stage I / SH)</th>
          <th class="text-right">Supplier Rej (-)</th>
          <th class="text-right">Scrap Rej (-)</th>
          <th class="text-right">Closing Balance</th>
          <th>Extrusion Line Link</th>
        </tr>
      </thead>
      <tbody>
        ${[...stockResult.insulationRows, ...stockResult.sheathingRows].map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td><strong>${r.name}</strong></td>
          <td class="text-center">${r.unit}</td>
          <td class="text-right">${r.opening.toFixed(2)}</td>
          <td class="text-right">${r.received.toFixed(2)}</td>
          <td class="text-right font-bold" style="background:#e0e7ff;color:#1e1b4b;">${(r.opening + r.received).toFixed(2)}</td>
          <td class="text-right font-bold" style="color:#b45309;">${r.consumed > 0 ? `-${r.consumed.toFixed(2)}` : '0'}</td>
          <td class="text-right">${r.supplierRejections > 0 ? `-${r.supplierRejections.toFixed(2)}` : '0'}</td>
          <td class="text-right">${r.scrapRejections > 0 ? `-${r.scrapRejections.toFixed(2)}` : '0'}</td>
          <td class="text-right font-bold" style="background:#f0fdf4;">${r.closingKgsStr}</td>
          <td>${r.remark}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- TABLE 3: WOODEN DRUMS & PALLETS REQUISITION -->
  <div class="print-card">
    <h2>
      <span>3. WOODEN DRUMS & PALLETS REQUISITION STOCK</span>
      <span>Drums Available: ${totals.totalDrumsAvailable} NOS | Pallets: ${totals.totalPalletsAvailable} NOS</span>
    </h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Drum / Pallet Size</th>
          <th class="text-center">Unit</th>
          <th class="text-right">Opening Stock</th>
          <th class="text-right">Receipts / Inward</th>
          <th class="text-right" style="background:#e0e7ff;color:#1e1b4b;font-weight:bold;">Total Stock (Op+Rec)</th>
          <th class="text-right">Auto-Consumed (SH Stage)</th>
          <th class="text-right">Rejections (-)</th>
          <th class="text-right">Closing Available</th>
          <th>Packaging Location</th>
        </tr>
      </thead>
      <tbody>
        ${[...stockResult.drumRows, ...stockResult.palletRows].map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td><strong>${r.name}</strong></td>
          <td class="text-center">${r.unit}</td>
          <td class="text-right">${r.opening}</td>
          <td class="text-right">${r.received}</td>
          <td class="text-right font-bold" style="background:#e0e7ff;color:#1e1b4b;">${r.opening + r.received}</td>
          <td class="text-right font-bold" style="color:#b45309;">${r.consumed > 0 ? `-${r.consumed}` : '0'}</td>
          <td class="text-right">${r.supplierRejections + r.scrapRejections}</td>
          <td class="text-right font-bold" style="background:#eff6ff;">${r.closingMtrsStr}</td>
          <td>${r.remark}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- TABLE 4: FINISHED GOODS & DISPATCH STOCK -->
  <div class="print-card">
    <h2>
      <span>4. FINISHED GOODS & DISPATCH STOCK BALANCE</span>
      <span>Warehouse: ${totals.totalFinishedStockMtrs.toLocaleString()} M (${totals.totalFinishedStockKg.toFixed(2)} KG) | Dispatched: ${totals.totalDispatchedMtrs.toLocaleString()} M</span>
    </h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Finished Cable Batch & Specification</th>
          <th class="text-center">Unit</th>
          <th class="text-right">Produced (SH Complete)</th>
          <th class="text-right">Dispatched (Outward Auto)</th>
          <th class="text-right">Customer Returns (+)</th>
          <th class="text-right">Remaining In Warehouse (M)</th>
          <th class="text-right">Remaining Wt (KG)</th>
          <th>Warehouse Location / Order Status</th>
        </tr>
      </thead>
      <tbody>
        ${stockResult.finishedGoodsRows.map((r, i) => `<tr>
          <td>${i + 1}</td>
          <td><strong>${r.name}</strong></td>
          <td class="text-center">${r.unit}</td>
          <td class="text-right">${r.received.toLocaleString()} m</td>
          <td class="text-right font-bold" style="color:#7c3aed;">-${r.consumed.toLocaleString()} m</td>
          <td class="text-right">${r.customerReturns > 0 ? `+${r.customerReturns.toLocaleString()} m` : '0'}</td>
          <td class="text-right font-bold" style="background:#f5f3ff;">${r.closingMtrsStr}</td>
          <td class="text-right font-bold">${r.closingKgsStr}</td>
          <td>${r.remark}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- TABLE 5: RETURNS & REJECTIONS TRANSACTION REGISTER -->
  <div class="print-card">
    <h2>
      <span>5. RETURNS & REJECTIONS AUDIT REGISTER (${stockReturns.length} TRANSACTIONS)</span>
      <span>Total Rejected / Scrap: ${totals.totalRejectionsKg.toFixed(2)} KG | Returns In: ${totals.totalReturnsKg.toFixed(2)} KG</span>
    </h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Date</th>
          <th>Material Category</th>
          <th>Material Name</th>
          <th>Transaction Type</th>
          <th class="text-right">Quantity</th>
          <th>Reason & Defect Description</th>
          <th>Batch / Invoice Ref</th>
        </tr>
      </thead>
      <tbody>
        ${stockReturns.map((ret, i) => `<tr>
          <td>${i + 1}</td>
          <td>${ret.date}</td>
          <td><span class="badge">${ret.category}</span></td>
          <td><strong>${ret.materialName}</strong></td>
          <td><strong>${ret.type === 'supplier_rejection' ? '🔴 Supplier Rejection' : ret.type === 'scrap_rejection' ? '🟠 Production Scrap' : ret.type === 'customer_return' ? '🟢 Customer Return' : '🔵 Line Return'}</strong></td>
          <td class="text-right font-bold">${ret.qty} ${ret.unit}</td>
          <td>${ret.reason}</td>
          <td>${ret.batchOrInvoice || '-'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PLUTUS_MONTHLY_STOCK_REPORT_${selectedMonth}_${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Downloaded Formatted Monthly Stock Report (.html) — ready to print 1 table per page!');
  };

  return (
    <div className="space-y-4">
      {/* Non-blocking Status Toast */}
      {toastMessage && (
        <div className="sticky top-2 z-50 flex items-center justify-between px-4 py-2.5 bg-slate-900 text-emerald-300 border border-slate-700 rounded-xl shadow-lg text-xs font-bold transition-all">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="p-1 text-slate-400 hover:text-white rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Stock Slip Control Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-4 print-card">
        {/* Top Header & Action Controls */}
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-200 gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-600 rounded-lg text-white">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-extrabold text-slate-900 text-sm tracking-wide">
                11. INVENTORY & STOCK MANAGEMENT SLIP (FULL AUTO-LINKED)
              </h2>
              <div className="text-[11px] text-slate-500 font-medium">
                Auto-Deducts Raw Materials at Process Stages (B, I, SH) • Returns & Rejections • Opening/Closing Rollover
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap no-print">
            {/* Month Filter Selector */}
            <div className="flex items-center bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 gap-1 text-xs font-semibold">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-600">Period:</span>
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="bg-transparent font-bold text-slate-800 outline-none cursor-pointer"
              >
                <option value="ALL">All Time (Cumulative)</option>
                {Array.from(
                  new Set([
                    '2026-10',
                    '2026-11',
                    '2026-12',
                    '2026-09',
                    ...Object.keys(monthlySnapshots),
                  ])
                )
                  .sort()
                  .reverse()
                  .map(mKey => (
                    <option key={mKey} value={mKey}>
                      {mKey === '2026-10'
                        ? 'October 2026 (Current)'
                        : mKey === '2026-11'
                        ? 'November 2026 (Next Month)'
                        : mKey === '2026-09'
                        ? 'September 2026'
                        : `Month ${mKey}`}
                    </option>
                  ))}
              </select>
            </div>

            {/* Category Filter Selector */}
            <div className="flex items-center bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 gap-1 text-xs font-semibold">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-600">Category:</span>
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="bg-transparent font-bold text-slate-800 outline-none cursor-pointer max-w-[170px] truncate"
              >
                <option value="ALL">All Categories ({stockResult.allRows.length})</option>
                {availableCategories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search Material, Category..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="text-xs pl-7 pr-7 py-1.5 border border-slate-300 rounded-lg w-48 bg-white"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Action Buttons */}
            <button
              type="button"
              onClick={handleGenerateMonthlySnapshot}
              className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-all"
              title="Archive current closing stock as opening stock for the next month, and reset production-related stock usage flags"
            >
              <Camera className="w-3.5 h-3.5" /> Generate Monthly Snapshot
            </button>

            <button
              type="button"
              onClick={() => setIsAddReturnModalOpen(true)}
              className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
              title="Record a supplier rejection, scrap waste, or customer return"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" /> + Return / Rejection
            </button>

            <button
              type="button"
              onClick={() => setIsAddCustomModalOpen(true)}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> + Custom Stock Item
            </button>

            <button
              type="button"
              onClick={handleDownloadFormattedMonthlyReport}
              className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
              title="Print 1 table per page formatted report"
            >
              <Printer className="w-3.5 h-3.5" /> Print 1 Table Per Page
            </button>

            <button
              type="button"
              onClick={handleDownloadStockReport}
              className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
              title="Download formatted Stock Report CSV summarizing Opening, Additions, Subtractions, and calculated Closing stock"
            >
              <Download className="w-3.5 h-3.5" /> Download Stock Report
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-semibold flex items-center gap-1 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" /> Export CSV
            </button>
          </div>
        </div>

        {/* Real-time KPI Metric Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div
            className={`rounded-xl p-2.5 border ${
              totals.totalRawCopperStockKg < 0
                ? 'bg-red-50 border-red-200'
                : 'bg-amber-50/70 border-amber-200'
            }`}
          >
            <div
              className={`text-[10px] font-bold uppercase ${
                totals.totalRawCopperStockKg < 0 ? 'text-red-800' : 'text-amber-800'
              }`}
            >
              Raw Copper in Store
            </div>
            <div
              className={`text-sm font-black mt-0.5 ${
                totals.totalRawCopperStockKg < 0 ? 'text-red-700' : 'text-amber-950'
              }`}
            >
              {totals.totalRawCopperStockKg.toFixed(1)} kg
              {totals.totalRawCopperStockKg < 0 && (
                <span className="text-[10px] font-bold block text-red-600">⚠️ Deficit (Auto-Consumed)</span>
              )}
            </div>
            <div
              className={`text-[10px] font-semibold ${
                totals.totalRawCopperStockKg < 0 ? 'text-red-600' : 'text-amber-700'
              }`}
            >
              Opening + Inward - Stage B
            </div>
          </div>

          <div
            className={`rounded-xl p-2.5 border ${
              totals.totalInsulationStockKg < 0
                ? 'bg-red-50 border-red-200'
                : 'bg-blue-50/70 border-blue-200'
            }`}
          >
            <div
              className={`text-[10px] font-bold uppercase ${
                totals.totalInsulationStockKg < 0 ? 'text-red-800' : 'text-blue-800'
              }`}
            >
              PVC Insulation Compound
            </div>
            <div
              className={`text-sm font-black mt-0.5 ${
                totals.totalInsulationStockKg < 0 ? 'text-red-700' : 'text-blue-950'
              }`}
            >
              {totals.totalInsulationStockKg.toFixed(1)} kg
              {totals.totalInsulationStockKg < 0 && (
                <span className="text-[10px] font-bold block text-red-600">⚠️ Deficit (Auto-Consumed)</span>
              )}
            </div>
            <div
              className={`text-[10px] font-semibold ${
                totals.totalInsulationStockKg < 0 ? 'text-red-600' : 'text-blue-700'
              }`}
            >
              KI-06, A80 - Stage I Auto
            </div>
          </div>

          <div
            className={`rounded-xl p-2.5 border ${
              totals.totalSheathingStockKg < 0
                ? 'bg-red-50 border-red-200'
                : 'bg-cyan-50/70 border-cyan-200'
            }`}
          >
            <div
              className={`text-[10px] font-bold uppercase ${
                totals.totalSheathingStockKg < 0 ? 'text-red-800' : 'text-cyan-800'
              }`}
            >
              PVC Sheath Compound
            </div>
            <div
              className={`text-sm font-black mt-0.5 ${
                totals.totalSheathingStockKg < 0 ? 'text-red-700' : 'text-cyan-950'
              }`}
            >
              {totals.totalSheathingStockKg.toFixed(1)} kg
              {totals.totalSheathingStockKg < 0 && (
                <span className="text-[10px] font-bold block text-red-600">⚠️ Deficit (Auto-Consumed)</span>
              )}
            </div>
            <div
              className={`text-[10px] font-semibold ${
                totals.totalSheathingStockKg < 0 ? 'text-red-600' : 'text-cyan-700'
              }`}
            >
              KI-05, ST-1 - Stage SH Auto
            </div>
          </div>

          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-2.5">
            <div className="text-[10px] font-bold uppercase text-emerald-800">
              Finished Warehouse
            </div>
            <div className="text-sm font-black text-emerald-950 mt-0.5">
              {totals.totalFinishedStockMtrs.toLocaleString()} m
            </div>
            <div className="text-[10px] text-emerald-700 font-semibold">
              {totals.totalFinishedStockKg.toFixed(1)} kg ready to load
            </div>
          </div>

          <div className="bg-purple-50/70 border border-purple-200 rounded-xl p-2.5">
            <div className="text-[10px] font-bold uppercase text-purple-800">
              Dispatched Outward
            </div>
            <div className="text-sm font-black text-purple-950 mt-0.5">
              -{totals.totalDispatchedMtrs.toLocaleString()} m
            </div>
            <div className="text-[10px] text-purple-700 font-semibold">
              -{totals.totalDispatchedKg.toFixed(1)} kg auto-deducted
            </div>
          </div>

          <div className="bg-red-50/70 border border-red-200 rounded-xl p-2.5">
            <div className="text-[10px] font-bold uppercase text-red-800">
              Rejections & Scrap
            </div>
            <div className="text-sm font-black text-red-950 mt-0.5">
              {totals.totalRejectionsKg.toFixed(1)} kg
            </div>
            <div className="text-[10px] text-red-700 font-semibold">
              {stockReturns.length} registered return(s)
            </div>
          </div>
        </div>

        {/* Sub-Tabs Navigation Bar */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar border-b border-slate-200 pb-2 no-print">
          {[
            { id: 'all', label: '📋 Master Inventory Ledger', count: stockResult.allRows.length },
            { id: 'raw', label: '🧱 Raw Materials (Copper & PVC)', count: stockResult.rawCopperRows.length + stockResult.insulationRows.length + stockResult.sheathingRows.length },
            { id: 'drums', label: '🪵 Wooden Drums & Pallets', count: stockResult.drumRows.length + stockResult.palletRows.length },
            { id: 'finished', label: '⚡ Semi-Finished & Finished Goods', count: stockResult.finishedGoodsRows.length + stockResult.semiFinishedRows.length },
            { id: 'returns', label: '🔄 Returns & Rejections Ledger', count: stockReturns.length },
            { id: 'openings', label: '⚙️ Opening Stock Manager', count: Object.keys(stockOpenings).length },
            { id: 'consumption_logs', label: '⚡ Live Stage Auto-Deductions', count: stageConsumptionLogs.length },
            { id: 'monthly_report', label: '📅 Monthly Report & Rollover', count: null },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeSubTab === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== null && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    activeSubTab === tab.id ? 'bg-blue-800 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* SUB-TAB: RETURNS & REJECTIONS LEDGER */}
        {activeSubTab === 'returns' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-purple-50 border border-purple-200 rounded-xl">
              <div>
                <div className="text-xs font-extrabold text-purple-950 flex items-center gap-1.5">
                  <ArrowRightLeft className="w-4 h-4 text-purple-700" />
                  <span>Returns & Rejections Audit Register</span>
                </div>
                <div className="text-[11px] text-purple-800 mt-0.5">
                  Record supplier defect rejections, extrusion purge scrap, customer drum returns, and line surplus. All entries automatically adjust stock balances in real time.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddReturnModalOpen(true)}
                className="text-xs px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-lg font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Record New Return / Rejection
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-2 border-r border-slate-200">#</th>
                    <th className="p-2 border-r border-slate-200">Date</th>
                    <th className="p-2 border-r border-slate-200">Category</th>
                    <th className="p-2 border-r border-slate-200">Material Name</th>
                    <th className="p-2 border-r border-slate-200">Type</th>
                    <th className="p-2 border-r border-slate-200 text-right">Quantity</th>
                    <th className="p-2 border-r border-slate-200">Reason / Defect Cause</th>
                    <th className="p-2 border-r border-slate-200">Batch / Invoice Ref</th>
                    <th className="p-2 text-center no-print">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stockReturns.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-4 text-center text-slate-400 font-semibold">
                        No returns or rejections recorded yet. Click "+ Record New Return / Rejection" above.
                      </td>
                    </tr>
                  ) : (
                    stockReturns.map((ret, idx) => {
                      const isDeduct = ret.type === 'supplier_rejection' || ret.type === 'scrap_rejection';
                      return (
                        <tr key={ret.id} className="hover:bg-slate-50">
                          <td className="p-2 border-r border-slate-100">{idx + 1}</td>
                          <td className="p-2 border-r border-slate-100 font-medium text-slate-600">
                            {ret.date}
                          </td>
                          <td className="p-2 border-r border-slate-100">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-800">
                              {ret.category}
                            </span>
                          </td>
                          <td className="p-2 border-r border-slate-100 font-bold text-slate-900">
                            {ret.materialName}
                          </td>
                          <td className="p-2 border-r border-slate-100">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                                ret.type === 'supplier_rejection'
                                  ? 'bg-red-100 text-red-800'
                                  : ret.type === 'scrap_rejection'
                                  ? 'bg-amber-100 text-amber-800'
                                  : ret.type === 'customer_return'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {ret.type === 'supplier_rejection'
                                ? '🔴 Supplier Defect Rejection (-)'
                                : ret.type === 'scrap_rejection'
                                ? '🟠 Production Scrap (-)'
                                : ret.type === 'customer_return'
                                ? '🟢 Customer Return (+)'
                                : '🔵 Line Return (+)'}
                            </span>
                          </td>
                          <td
                            className={`p-2 border-r border-slate-100 text-right font-black ${
                              isDeduct ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            {isDeduct ? '-' : '+'}
                            {ret.qty} {ret.unit}
                          </td>
                          <td className="p-2 border-r border-slate-100 text-slate-700 font-medium">
                            {ret.reason}
                          </td>
                          <td className="p-2 border-r border-slate-100 font-mono text-[11px] text-slate-600">
                            {ret.batchOrInvoice || '-'}
                          </td>
                          <td className="p-2 text-center no-print">
                            <button
                              type="button"
                              onClick={() => handleDeleteReturn(ret.id)}
                              className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                              title="Delete record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-TAB: OPENING STOCK MANAGER */}
        {activeSubTab === 'openings' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <div>
                <div className="text-xs font-extrabold text-amber-950 flex items-center gap-1.5">
                  <Edit2 className="w-4 h-4 text-amber-700" />
                  <span>Opening Stock Input & Configuration Manager (Manual Input Locked 🔒)</span>
                </div>
                <div className="text-[11px] text-amber-800 mt-0.5">
                  All items start at <strong>0 Opening Stock</strong>. Once you manually enter an opening stock value below (or in the Master Ledger table), it is permanently locked and will never be automatically overwritten.
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    const cat = 'BUNCHED_COPPER';
                    setOpenAddCategory(cat);
                    const firstSize = getCategorySizePresets(cat)[0] || '30/0.210 (1.50 SQ MM)';
                    const firstMat = getCategoryMaterialPresets(cat)[0] || 'Annealed Bunched Copper';
                    setOpenAddSize(firstSize);
                    setOpenAddMaterialGrade(firstMat);
                    syncCombinedOpeningName(cat, firstSize, firstMat);
                    setIsAddOpeningItemModalOpen(true);
                  }}
                  className="text-xs px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-extrabold flex items-center gap-1.5 shadow-xs cursor-pointer"
                  title="Directly add Copper Bunch Size Copper to Opening Stock"
                >
                  <Zap className="w-3.5 h-3.5" />
                  ⚡ + Add Copper Bunch Size Opening Stock
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddOpeningItemModalOpen(true)}
                  className="text-xs px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                  title="Manually add any finished good, IS-694 carton wire, or raw material into opening stock"
                >
                  <Plus className="w-3.5 h-3.5" />
                  + Add Item / Finished Good to Opening Stock
                </button>
                <button
                  type="button"
                  onClick={handleSaveOpeningBaseline}
                  className="text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                  title="Locks and saves your manually entered Opening Stock values"
                >
                  🔒 Lock & Save Manual Openings
                </button>
                <button
                  type="button"
                  onClick={handleZeroAllOpeningStock}
                  className="text-xs px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold shadow-xs cursor-pointer"
                  title="Reset all opening stocks to 0"
                >
                  0️⃣ Zero All Opening Stock
                </button>
              </div>
            </div>

            {/* INLINE SIZE & MATERIAL SELECTOR (DROPDOWN + MANUAL INPUT) BAR */}
            <form
              onSubmit={handleSaveNewOpeningItem}
              className="bg-gradient-to-r from-blue-50 via-indigo-50/70 to-amber-50/60 p-3.5 rounded-xl border-2 border-blue-300 shadow-xs space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200 pb-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-blue-700 text-white text-[10px] font-black uppercase">
                    ⚡ Quick Add / Select
                  </span>
                  <span className="text-xs font-black text-slate-900">
                    Add Any Material, Copper Bunch Size, Drum, Pallet, Compound or Finished Good to Opening Stock (Dropdown + Manual Input)
                  </span>
                </div>
                <span className="text-[10.5px] font-bold text-blue-800">
                  Pick from dropdown OR type custom Size &amp; Material manually below
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                {/* 1. Category Selector */}
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-700 uppercase mb-1">
                    1. Category / Section
                  </label>
                  <select
                    value={openAddCategory}
                    onChange={e => {
                      const cat = e.target.value as typeof openAddCategory;
                      setOpenAddCategory(cat);
                      const firstSize = getCategorySizePresets(cat)[0] || '';
                      const firstMat = getCategoryMaterialPresets(cat)[0] || '';
                      setOpenAddSize(firstSize);
                      setOpenAddMaterialGrade(firstMat);
                      syncCombinedOpeningName(cat, firstSize, firstMat);
                    }}
                    className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg font-bold text-xs bg-white text-slate-900"
                  >
                    <option value="FINISHED_IS694">📦 IS-694 Carton Wire (Coils &amp; Cartons)</option>
                    <option value="FINISHED_DRUM">📦 Finished Cable Drum (Mtrs &amp; Kg)</option>
                    <option value="BUNCHED_COPPER">⚡ Copper Bunch Size Copper (KG &amp; MTRS)</option>
                    <option value="RAW_COPPER">⚡ Raw Copper Wire Strands (KG)</option>
                    <option value="DRUM">🪵 Wooden Drums (NOS)</option>
                    <option value="PALLET">🪵 Wooden Pallets (NOS)</option>
                    <option value="INSULATION">🧱 Insulation PVC Compound (KG)</option>
                    <option value="SHEATH">🧱 Sheathing PVC Compound (KG)</option>
                    <option value="CUSTOM">🔧 Custom Material / Item</option>
                  </select>
                </div>

                {/* 2. Size Dropdown + Manual Input */}
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-700 uppercase mb-1">
                    {openAddCategory === 'BUNCHED_COPPER'
                      ? '2. Copper Bunch Size (Dropdown + Manual)'
                      : '2. Size (Dropdown + Manual Input)'}
                  </label>
                  <div className="space-y-1">
                    <select
                      value={getCategorySizePresets(openAddCategory).includes(openAddSize) ? openAddSize : '__MANUAL__'}
                      onChange={e => {
                        const val = e.target.value;
                        if (val !== '__MANUAL__') {
                          setOpenAddSize(val);
                          syncCombinedOpeningName(openAddCategory, val, openAddMaterialGrade);
                        }
                      }}
                      className="w-full px-2 py-1 border border-slate-300 rounded font-bold text-[11px] bg-white text-slate-800"
                    >
                      <option value="__MANUAL__">✏️ Manual / Custom Size Input...</option>
                      {getCategorySizePresets(openAddCategory).map(sz => (
                        <option key={sz} value={sz}>
                          {sz}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={openAddSize}
                      onChange={e => {
                        setOpenAddSize(e.target.value);
                        syncCombinedOpeningName(openAddCategory, e.target.value, openAddMaterialGrade);
                      }}
                      placeholder={
                        openAddCategory === 'BUNCHED_COPPER'
                          ? 'e.g. 52/0.260 (2.50 SQ MM)'
                          : 'Type custom size manually...'
                      }
                      className="w-full px-2 py-1 border border-blue-400 rounded font-extrabold text-xs bg-white text-slate-900"
                    />
                  </div>
                </div>

                {/* 3. Material / Grade Dropdown + Manual Input */}
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-700 uppercase mb-1">
                    3. Material / Brand (Dropdown + Manual)
                  </label>
                  <div className="space-y-1">
                    <select
                      value={
                        getCategoryMaterialPresets(openAddCategory).includes(openAddMaterialGrade)
                          ? openAddMaterialGrade
                          : '__MANUAL__'
                      }
                      onChange={e => {
                        const val = e.target.value;
                        if (val !== '__MANUAL__') {
                          setOpenAddMaterialGrade(val);
                          syncCombinedOpeningName(openAddCategory, openAddSize, val);
                        }
                      }}
                      className="w-full px-2 py-1 border border-slate-300 rounded font-bold text-[11px] bg-white text-slate-800"
                    >
                      <option value="__MANUAL__">✏️ Manual / Custom Material Input...</option>
                      {getCategoryMaterialPresets(openAddCategory).map(mat => (
                        <option key={mat} value={mat}>
                          {mat}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={openAddMaterialGrade}
                      onChange={e => {
                        setOpenAddMaterialGrade(e.target.value);
                        syncCombinedOpeningName(openAddCategory, openAddSize, e.target.value);
                      }}
                      placeholder="Type material / grade / brand..."
                      className="w-full px-2 py-1 border border-blue-400 rounded font-extrabold text-xs bg-white text-slate-900"
                    />
                  </div>
                </div>

                {/* 4. Quantity Input (Adaptive by Category) */}
                <div>
                  {openAddCategory === 'FINISHED_IS694' ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="block text-[9.5px] font-black text-rose-900 uppercase mb-0.5">
                          Coils Input
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={openAddCoils}
                          onChange={e => {
                            const val = e.target.value;
                            setOpenAddCoils(val);
                            const c = parseFloat(val) || 0;
                            const cpc = parseFloat(openAddCoilsPerCarton) || 20;
                            const len = parseFloat(openAddCoilLen) || 90;
                            setOpenAddCartons(c > 0 ? (c / cpc).toFixed(2).replace(/\.00$/, '') : '');
                            setOpenAddMtrs(c > 0 ? String(c * len) : '');
                          }}
                          placeholder="Coils"
                          className="w-full px-2 py-1.5 border-2 border-rose-400 rounded font-black text-xs text-right bg-white text-rose-950"
                        />
                      </div>
                      <div>
                        <label className="block text-[9.5px] font-black text-amber-900 uppercase mb-0.5">
                          Carton Input
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={openAddCartons}
                          onChange={e => {
                            const val = e.target.value;
                            setOpenAddCartons(val);
                            const ctns = parseFloat(val) || 0;
                            const cpc = parseFloat(openAddCoilsPerCarton) || 20;
                            const len = parseFloat(openAddCoilLen) || 90;
                            const coils = Math.round(ctns * cpc);
                            setOpenAddCoils(ctns > 0 ? String(coils) : '');
                            setOpenAddMtrs(ctns > 0 ? String(coils * len) : '');
                          }}
                          placeholder="Cartons"
                          className="w-full px-2 py-1.5 border-2 border-amber-400 rounded font-black text-xs text-right bg-white text-amber-950"
                        />
                      </div>
                    </div>
                  ) : openAddCategory === 'FINISHED_DRUM' ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="block text-[9.5px] font-black text-indigo-900 uppercase mb-0.5">
                          Length (M)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={openAddMtrs}
                          onChange={e => setOpenAddMtrs(e.target.value)}
                          placeholder="Meters"
                          className="w-full px-2 py-1.5 border-2 border-indigo-400 rounded font-black text-xs text-right bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[9.5px] font-black text-slate-700 uppercase mb-0.5">
                          Weight (KG)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={openAddKgs}
                          onChange={e => setOpenAddKgs(e.target.value)}
                          placeholder="Kg"
                          className="w-full px-2 py-1.5 border border-slate-300 rounded font-bold text-xs text-right bg-white"
                        />
                      </div>
                    </div>
                  ) : openAddCategory === 'BUNCHED_COPPER' ? (
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="block text-[9.5px] font-black text-amber-900 uppercase mb-0.5">
                          Weight (KG) *
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={openAddKgs}
                          onChange={e => setOpenAddKgs(e.target.value)}
                          placeholder="Kg"
                          className="w-full px-2 py-1.5 border-2 border-amber-400 rounded font-black text-xs text-right bg-white text-amber-950"
                        />
                      </div>
                      <div>
                        <label className="block text-[9.5px] font-black text-slate-700 uppercase mb-0.5">
                          Length (M, Opt)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={openAddMtrs}
                          onChange={e => setOpenAddMtrs(e.target.value)}
                          placeholder="Meters"
                          className="w-full px-2 py-1.5 border border-slate-300 rounded font-bold text-xs text-right bg-white"
                        />
                      </div>
                    </div>
                  ) : openAddCategory === 'DRUM' || openAddCategory === 'PALLET' ? (
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-700 uppercase mb-1">
                        4. Opening Qty (NOS)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={openAddDrums}
                        onChange={e => setOpenAddDrums(e.target.value)}
                        placeholder="Enter Nos (e.g. 20)"
                        className="w-full px-2.5 py-1.5 border-2 border-emerald-400 rounded-lg font-black text-xs text-right bg-white"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-700 uppercase mb-1">
                        4. Opening Weight (KG)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={openAddKgs}
                        onChange={e => setOpenAddKgs(e.target.value)}
                        placeholder="Enter Kg (e.g. 500)"
                        className="w-full px-2.5 py-1.5 border-2 border-emerald-400 rounded-lg font-black text-xs text-right bg-white"
                      />
                    </div>
                  )}
                </div>

                {/* 5. Submit Button */}
                <div>
                  <button
                    type="submit"
                    className="w-full px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-black text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>+ Add to Opening Stock</span>
                  </button>
                </div>
              </div>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* IS-694 Building Wire & Carton Stock Openings (Dual Coils & Cartons Input) */}
              <div className="bg-slate-50 p-3 rounded-xl border-2 border-rose-300 md:col-span-2 space-y-2">
                <div className="text-xs font-bold text-slate-900 border-b border-rose-200 pb-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-rose-950 font-black">
                    <Box className="w-4 h-4 text-rose-600" />
                    <span>📦 IS-694 Finished Carton Stock (Dual Coils & Cartons Input)</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-rose-100 text-rose-900 font-extrabold">
                    Building Wires (90m Standard)
                  </span>
                </div>

                {/* Inline Size & Material Dropdown + Manual Input inside IS-694 Card */}
                <div className="bg-rose-100/60 p-2 rounded-lg border border-rose-200 grid grid-cols-1 sm:grid-cols-5 gap-1.5 items-end">
                  <div>
                    <label className="text-[9px] font-extrabold text-rose-950 uppercase block">Size (Drop / Manual)</label>
                    <input
                      type="text"
                      list="is694CardSizeList"
                      value={cardIs694Size}
                      onChange={e => setCardIs694Size(e.target.value)}
                      placeholder="e.g. 1C × 1.50 SQ MM"
                      className="w-full px-2 py-1 text-[11px] font-bold bg-white border border-rose-300 rounded"
                    />
                    <datalist id="is694CardSizeList">
                      {getCategorySizePresets('FINISHED_IS694').map(s => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-[9px] font-extrabold text-rose-950 uppercase block">Brand / Material</label>
                    <input
                      type="text"
                      list="is694CardMatList"
                      value={cardIs694Mat}
                      onChange={e => setCardIs694Mat(e.target.value)}
                      placeholder="e.g. VIHAN TRIGUARD"
                      className="w-full px-2 py-1 text-[11px] font-bold bg-white border border-rose-300 rounded"
                    />
                    <datalist id="is694CardMatList">
                      {getCategoryMaterialPresets('FINISHED_IS694').map(m => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-[9px] font-extrabold text-rose-950 uppercase block">Coils Input</label>
                    <input
                      type="number"
                      min="0"
                      value={cardIs694Coils}
                      onChange={e => {
                        const v = e.target.value;
                        setCardIs694Coils(v);
                        const cpc = cardIs694Size.includes('2.50') ? 16 : cardIs694Size.includes('4.00') || cardIs694Size.includes('6.00') ? 10 : 20;
                        const c = parseFloat(v) || 0;
                        setCardIs694Cartons(c > 0 ? (c / cpc).toFixed(2).replace(/\.00$/, '') : '');
                      }}
                      placeholder="Coils"
                      className="w-full px-2 py-1 text-[11px] font-black text-right bg-white border border-rose-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-extrabold text-amber-950 uppercase block">Carton Input</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={cardIs694Cartons}
                      onChange={e => {
                        const v = e.target.value;
                        setCardIs694Cartons(v);
                        const cpc = cardIs694Size.includes('2.50') ? 16 : cardIs694Size.includes('4.00') || cardIs694Size.includes('6.00') ? 10 : 20;
                        const ctns = parseFloat(v) || 0;
                        setCardIs694Coils(ctns > 0 ? String(Math.round(ctns * cpc)) : '');
                      }}
                      placeholder="Cartons"
                      className="w-full px-2 py-1 text-[11px] font-black text-right bg-white border border-amber-300 rounded"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const s = cardIs694Size.trim();
                      const m = cardIs694Mat.trim();
                      if (!s && !m) return;
                      const label = `IS-694 Finished Carton Stock (${s}${m ? ` - ${m}` : ''})`;
                      const key = `FINISHED||${label}`;
                      const cpc = s.includes('2.50') ? 16 : s.includes('4.00') || s.includes('6.00') ? 10 : 20;
                      const coils = parseFloat(cardIs694Coils) || 0;
                      handleUpdateIs694Opening(key, 'coils', coils, cpc, 90);
                      setCardIs694Coils('');
                      setCardIs694Cartons('');
                      showToast(`✅ Added ${label} to Opening Stock!`);
                    }}
                    className="px-2.5 py-1 bg-rose-700 hover:bg-rose-800 text-white rounded font-black text-[11px] cursor-pointer"
                  >
                    + Add IS-694
                  </button>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {Array.from(
                    new Set([
                      ...orders
                        .filter(o => (o.grade || '').toUpperCase().includes('IS-694'))
                        .map(o => `IS-694 Finished Carton Stock (1C × ${o.size} - ${o.brand} ${o.grade || 'IS-694'} - ${o.batch || 'OPENING'})`),
                      ...Object.keys(stockOpenings)
                        .filter(
                          k =>
                            k.startsWith('FINISHED||') &&
                            !k.endsWith('||COILS') &&
                            !k.endsWith('||CARTONS') &&
                            !k.endsWith('||KGS') &&
                            (k.includes('IS-694') || k.includes('Carton') || k.includes('Coil'))
                        )
                        .map(k => k.replace('FINISHED||', '')),
                      'IS-694 Finished Carton Stock (1C × 0.75 SQ MM - VIHAN TRIGUARD)',
                      'IS-694 Finished Carton Stock (1C × 1.00 SQ MM - VIHAN TRIGUARD)',
                      'IS-694 Finished Carton Stock (1C × 1.50 SQ MM - VIHAN TRIGUARD)',
                      'IS-694 Finished Carton Stock (1C × 2.50 SQ MM - VIHAN TRIGUARD)',
                      'IS-694 Finished Carton Stock (1C × 4.00 SQ MM - VIHAN TRIGUARD)',
                      'IS-694 Finished Carton Stock (1C × 6.00 SQ MM - VIHAN TRIGUARD)',
                    ])
                  ).map(itemName => {
                    const baseKey = `FINISHED||${itemName}`;
                    const mtrsVal = stockOpenings[baseKey] ?? 0;
                    const coilsVal = stockOpenings[`${baseKey}||COILS`] ?? (mtrsVal > 0 ? Math.round(mtrsVal / 90) : 0);
                    const cpc = itemName.includes('1.50') || itemName.includes('1.00') || itemName.includes('0.75') ? 20 : itemName.includes('2.50') ? 16 : 10;
                    const cartonsVal = stockOpenings[`${baseKey}||CARTONS`] ?? (cpc > 0 ? Number((coilsVal / cpc).toFixed(2)) : 0);
                    const isLocked = Boolean(lockedOpeningKeys[baseKey] || stockOpenings[baseKey] !== undefined || stockOpenings[`${baseKey}||COILS`] !== undefined);

                    return (
                      <div key={itemName} className="bg-white p-2 rounded-lg border border-slate-200 text-xs space-y-1">
                        <div className="flex items-center justify-between font-bold text-slate-800">
                          <span className="truncate max-w-[340px]" title={itemName}>{itemName}</span>
                          {isLocked && (mtrsVal > 0 || coilsVal > 0) && (
                            <span className="text-[9px] px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold">
                              🔒 Locked
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2 items-center pt-1">
                          <div>
                            <label className="text-[9.5px] font-bold text-slate-500 uppercase block">Coils Input</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="1"
                                min="0"
                                value={coilsVal || ''}
                                onChange={e => handleUpdateIs694Opening(baseKey, 'coils', parseFloat(e.target.value) || 0, cpc, 90)}
                                placeholder="0"
                                className="w-full px-2 py-0.5 text-right font-black border border-rose-300 rounded bg-rose-50/30 text-rose-950"
                              />
                              <span className="text-[10px] text-slate-500 font-semibold">Coils</span>
                            </div>
                          </div>
                          <div>
                            <label className="text-[9.5px] font-bold text-slate-500 uppercase block">Carton Input</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={cartonsVal || ''}
                                onChange={e => handleUpdateIs694Opening(baseKey, 'cartons', parseFloat(e.target.value) || 0, cpc, 90)}
                                placeholder="0"
                                className="w-full px-2 py-0.5 text-right font-black border border-amber-300 rounded bg-amber-50/30 text-amber-950"
                              />
                              <span className="text-[10px] text-slate-500 font-semibold">Ctns</span>
                            </div>
                          </div>
                          <div>
                            <label className="text-[9.5px] font-bold text-slate-500 uppercase block">Eq. Meters</label>
                            <div className="px-2 py-1 text-right font-extrabold text-emerald-800 bg-emerald-50 rounded border border-emerald-200">
                              {mtrsVal.toLocaleString()} m
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Finished Goods Standard Drums Opening Stock */}
              <div className="bg-slate-50 p-3 rounded-xl border-2 border-indigo-200 space-y-2">
                <div className="text-xs font-bold text-slate-900 border-b border-indigo-200 pb-1 flex items-center justify-between">
                  <span className="font-black text-indigo-950">📦 Finished Cable Drums (M & KG)</span>
                  <span className="text-[10px] text-slate-500">Warehouse</span>
                </div>

                {/* Inline Size & Material Dropdown + Manual Input inside Finished Cable Drums Card */}
                <div className="bg-indigo-100/50 p-2 rounded-lg border border-indigo-200 space-y-1.5">
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      list="cableCardSizeList"
                      value={cardCableSize}
                      onChange={e => setCardCableSize(e.target.value)}
                      placeholder="Size (Drop / Manual)"
                      className="w-full px-2 py-1 text-[11px] font-bold bg-white border border-indigo-300 rounded"
                    />
                    <datalist id="cableCardSizeList">
                      {getCategorySizePresets('FINISHED_DRUM').map(s => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                    <input
                      type="text"
                      list="cableCardMatList"
                      value={cardCableMat}
                      onChange={e => setCardCableMat(e.target.value)}
                      placeholder="Brand / Grade"
                      className="w-full px-2 py-1 text-[11px] font-bold bg-white border border-indigo-300 rounded"
                    />
                    <datalist id="cableCardMatList">
                      {getCategoryMaterialPresets('FINISHED_DRUM').map(m => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0"
                      value={cardCableMtrs}
                      onChange={e => setCardCableMtrs(e.target.value)}
                      placeholder="Meters"
                      className="w-20 px-2 py-1 text-[11px] font-black text-right bg-white border border-indigo-300 rounded"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={cardCableKgs}
                      onChange={e => setCardCableKgs(e.target.value)}
                      placeholder="Weight Kg"
                      className="w-20 px-2 py-1 text-[11px] font-bold text-right bg-white border border-slate-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const s = cardCableSize.trim();
                        const m = cardCableMat.trim();
                        if (!s && !m) return;
                        const label = `Finished Cable Drum (${s}${m ? ` - ${m}` : ''})`;
                        const key = `FINISHED||${label}`;
                        const mtrs = parseFloat(cardCableMtrs) || 0;
                        const kgs = parseFloat(cardCableKgs) || 0;
                        const next = { ...stockOpenings, [key]: mtrs };
                        if (kgs > 0) next[`${key}||KGS`] = kgs;
                        onUpdateStockOpenings(next);
                        setLockedOpeningKeys(prev => ({ ...prev, [key]: true }));
                        try {
                          localStorage.setItem('plutus_stock_openings', JSON.stringify(next));
                          localStorage.setItem('plutus_stock_openings_manual_v2', JSON.stringify(next));
                        } catch (err) {}
                        setCardCableMtrs('');
                        setCardCableKgs('');
                        showToast(`✅ Added ${label} to Opening Stock!`);
                      }}
                      className="flex-1 px-2 py-1 bg-indigo-700 hover:bg-indigo-800 text-white rounded font-black text-[11px] cursor-pointer"
                    >
                      + Add Drum
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {Array.from(
                    new Set([
                      ...orders
                        .filter(o => !(o.grade || '').toUpperCase().includes('IS-694'))
                        .map(o => `Finished Cable Drum (${o.cores}C × ${o.size} - ${o.brand} ${o.grade} - ${o.batch || 'OPENING'})`),
                      ...Object.keys(stockOpenings)
                        .filter(
                          k =>
                            k.startsWith('FINISHED||') &&
                            !k.endsWith('||COILS') &&
                            !k.endsWith('||CARTONS') &&
                            !k.endsWith('||KGS') &&
                            !k.includes('IS-694') &&
                            !k.includes('Carton')
                        )
                        .map(k => k.replace('FINISHED||', '')),
                      'Finished Cable Drum (4C × 2.50 SQ.MM - MYRCAB H07RN-F)',
                      'Finished Cable Drum (1C × 120.00 SQ.MM - MYBCAB H07RN-F)',
                      'Finished Cable Drum (1C × 95.00 SQ.MM - MYBCAB H07RN-F)',
                    ])
                  ).map(itemName => {
                    const baseKey = `FINISHED||${itemName}`;
                    const val = stockOpenings[baseKey] ?? 0;
                    const kgVal = stockOpenings[`${baseKey}||KGS`] ?? 0;
                    const isLocked = Boolean(lockedOpeningKeys[baseKey] || stockOpenings[baseKey] !== undefined);

                    return (
                      <div key={itemName} className="bg-white p-2 rounded-lg border border-slate-200 text-xs space-y-1">
                        <div className="flex items-center justify-between font-bold text-slate-800">
                          <span className="truncate max-w-[200px]" title={itemName}>{itemName}</span>
                          {isLocked && val > 0 && (
                            <span className="text-[9px] px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold">
                              🔒
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[9px] font-bold text-slate-500 uppercase block">Length</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="1"
                                min="0"
                                value={val || ''}
                                onChange={e => handleUpdateOpening(baseKey, parseFloat(e.target.value) || 0)}
                                placeholder="0"
                                className="w-full px-2 py-0.5 text-right border border-indigo-300 rounded font-black text-xs bg-indigo-50/20"
                              />
                              <span className="text-[10px] text-slate-500 font-semibold">m</span>
                            </div>
                          </div>
                          <div>
                            <label className="text-[9px] font-bold text-slate-500 uppercase block">Weight</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={kgVal || ''}
                                onChange={e => {
                                  const nextK = parseFloat(e.target.value) || 0;
                                  const next = { ...stockOpenings, [`${baseKey}||KGS`]: nextK };
                                  onUpdateStockOpenings(next);
                                  try {
                                    localStorage.setItem('plutus_stock_openings', JSON.stringify(next));
                                    localStorage.setItem('plutus_stock_openings_manual_v2', JSON.stringify(next));
                                  } catch (err) {}
                                }}
                                placeholder="0"
                                className="w-full px-2 py-0.5 text-right border border-slate-300 rounded font-bold text-xs bg-white"
                              />
                              <span className="text-[10px] text-slate-500 font-semibold">kg</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Copper Strands Openings */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-slate-900 border-b border-slate-200 pb-1 flex items-center justify-between">
                  <span>⚡ Raw Copper Wire Strands (KG)</span>
                  <span className="text-[10px] text-slate-500">Conductor</span>
                </div>

                {/* Inline Dropdown + Manual Input for Copper Size */}
                <div className="bg-amber-50/80 p-2 rounded-lg border border-amber-200 space-y-1.5">
                  <div className="text-[9.5px] font-extrabold text-amber-950 uppercase">
                    Select or Type Copper Strand Size / Material:
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <select
                      value={getCategorySizePresets('RAW_COPPER').includes(cardCopperSize) ? cardCopperSize : ''}
                      onChange={e => {
                        if (e.target.value) setCardCopperSize(e.target.value);
                      }}
                      className="px-1.5 py-1 text-[11px] font-bold bg-white border border-amber-300 rounded text-slate-800"
                    >
                      <option value="">▼ Pick Size...</option>
                      {getCategorySizePresets('RAW_COPPER').map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={cardCopperSize}
                      onChange={e => setCardCopperSize(e.target.value)}
                      placeholder="Or manual size..."
                      className="px-2 py-1 text-[11px] font-bold bg-white border border-amber-400 rounded text-slate-900"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={cardCopperKg}
                      onChange={e => setCardCopperKg(e.target.value)}
                      placeholder="Opening Kg"
                      className="flex-1 px-2 py-1 text-[11px] font-black text-right bg-white border border-amber-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const s = cardCopperSize.trim();
                        if (!s) return;
                        handleUpdateOpening(`RAW_COPPER||${s}`, parseFloat(cardCopperKg) || 0);
                        setCardCopperSize('');
                        setCardCopperKg('');
                        showToast(`✅ Added Copper Size "${s}" to Opening Stock!`);
                      }}
                      className="px-2.5 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded font-black text-[11px] cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {Array.from(
                  new Set([
                    '0.180',
                    '0.210',
                    '0.260',
                    '0.265',
                    '0.266',
                    ...orders
                      .map(o => extractStrandDiameter(o.conductor))
                      .filter(s => Boolean(s) && !s.includes('/')),
                    ...purchaseItems
                      .filter(p => p.stage === 'raw' || !p.stage)
                      .map(p => extractStrandDiameter(p.conductor || p.description))
                      .filter(s => Boolean(s) && !s.includes('/')),
                    ...Object.keys(stockOpenings)
                      .filter(k => k.startsWith('RAW_COPPER||'))
                      .map(k => k.replace('RAW_COPPER||', '').trim())
                      .filter(Boolean),
                    'General Copper',
                  ])
                ).map(strand => {
                  const key = `RAW_COPPER||${strand}`;
                  const altKey = `COPPER||${strand}`;
                  const val = stockOpenings[key] ?? stockOpenings[altKey] ?? 0;
                  const isLocked = Boolean(lockedOpeningKeys[key] || lockedOpeningKeys[altKey] || stockOpenings[key] !== undefined || stockOpenings[altKey] !== undefined);
                  return (
                    <div key={strand} className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-slate-700 truncate flex items-center gap-1">
                        <span>{strand}:</span>
                        {isLocked && val > 0 && (
                          <span className="text-[9px] px-1 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold" title="Manually input opening stock (Locked)">
                            🔒
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          value={val}
                          onChange={e => handleUpdateOpening(key, parseFloat(e.target.value) || 0)}
                          className="w-24 px-2 py-0.5 text-right border border-slate-300 rounded font-bold text-xs bg-white"
                        />
                        <span className="text-[10px] text-slate-500 font-semibold">kg</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Copper Bunch Size Copper Openings (KG & MTRS) */}
              <div className="bg-slate-50 p-3 rounded-xl border-2 border-amber-300 space-y-2">
                <div className="text-xs font-bold text-slate-900 border-b border-amber-200 pb-1 flex items-center justify-between">
                  <span className="font-black text-amber-950">⚡ Copper Bunch Size Copper (KG &amp; MTRS)</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-extrabold">
                    Bunched Conductor
                  </span>
                </div>

                {/* Inline Dropdown + Manual Input for Copper Bunch Size */}
                <div className="bg-amber-100/70 p-2 rounded-lg border border-amber-300 space-y-1.5">
                  <div className="text-[9.5px] font-extrabold text-amber-950 uppercase">
                    Select or Type Copper Bunch Size (Strands/Dia &amp; SQ MM):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    <select
                      value={getCategorySizePresets('BUNCHED_COPPER').includes(cardBunchCopperSize) ? cardBunchCopperSize : ''}
                      onChange={e => {
                        if (e.target.value) setCardBunchCopperSize(e.target.value);
                      }}
                      className="px-1.5 py-1 text-[11px] font-bold bg-white border border-amber-300 rounded text-slate-800"
                    >
                      <option value="">▼ Pick Bunch Size...</option>
                      {getCategorySizePresets('BUNCHED_COPPER').map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      list="bunchCopperSizeDatalist"
                      value={cardBunchCopperSize}
                      onChange={e => setCardBunchCopperSize(e.target.value)}
                      placeholder="Or type e.g. 52/0.260 (2.50 SQ MM)"
                      className="px-2 py-1 text-[11px] font-bold bg-white border border-amber-400 rounded text-slate-900"
                    />
                    <datalist id="bunchCopperSizeDatalist">
                      {getCategorySizePresets('BUNCHED_COPPER').map(s => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </div>
                  <div className="grid grid-cols-3 gap-1 items-center">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={cardBunchCopperKg}
                      onChange={e => setCardBunchCopperKg(e.target.value)}
                      placeholder="Weight (KG)"
                      className="px-2 py-1 text-[11px] font-black text-right bg-white border border-amber-400 rounded text-amber-950"
                    />
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={cardBunchCopperMtrs}
                      onChange={e => setCardBunchCopperMtrs(e.target.value)}
                      placeholder="Meters (Opt)"
                      className="px-2 py-1 text-[11px] font-bold text-right bg-white border border-slate-300 rounded text-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const s = cardBunchCopperSize.trim();
                        if (!s) {
                          showToast('⚠️ Please select or enter a Copper Bunch Size first.');
                          return;
                        }
                        const key = `BUNCHED_COPPER||${s}`;
                        const kgs = parseFloat(cardBunchCopperKg) || 0;
                        const mtrs = parseFloat(cardBunchCopperMtrs) || 0;
                        const next = { ...stockOpenings, [key]: kgs };
                        const nextLocks = { ...lockedOpeningKeys, [key]: true };
                        if (mtrs > 0) {
                          next[`${key}||MTRS`] = mtrs;
                          nextLocks[`${key}||MTRS`] = true;
                        }
                        onUpdateStockOpenings(next);
                        setLockedOpeningKeys(nextLocks);
                        try {
                          localStorage.setItem('plutus_stock_openings', JSON.stringify(next));
                          localStorage.setItem('plutus_stock_openings_manual_v2', JSON.stringify(next));
                          localStorage.setItem('plutus_stock_openings_baseline', JSON.stringify(next));
                          localStorage.setItem('plutus_locked_opening_keys_v2', JSON.stringify(nextLocks));
                        } catch (err) {}
                        setCardBunchCopperSize('');
                        setCardBunchCopperKg('');
                        setCardBunchCopperMtrs('');
                        showToast(`✅ Added Copper Bunch Size "${s}" (${kgs} kg) to Opening Stock!`);
                      }}
                      className="px-2 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded font-black text-[11px] cursor-pointer"
                    >
                      + Add Bunch
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {Array.from(
                    new Set([
                      ...orders
                        .filter(o => o.conductor && o.conductor.includes('/'))
                        .map(o => `${o.conductor.trim()}${o.size ? ` (${o.size.trim()})` : ''}`),
                      ...Object.keys(stockOpenings)
                        .filter(
                          k =>
                            k.startsWith('BUNCHED_COPPER||') &&
                            !k.endsWith('||MTRS') &&
                            !k.endsWith('||KGS')
                        )
                        .map(k => k.replace('BUNCHED_COPPER||', '').trim())
                        .filter(Boolean),
                      '24/0.200 (0.75 SQ MM)',
                      '32/0.200 (1.00 SQ MM)',
                      '30/0.210 (1.50 SQ MM)',
                      '50/0.210 (2.50 SQ MM)',
                      '52/0.260 (2.50 SQ MM)',
                      '56/0.260 (4.00 SQ MM)',
                      '84/0.260 (6.00 SQ MM)',
                      '129/0.260 (6.00 SQ MM)',
                      '182/0.260 (10.00 SQ MM)',
                      '294/0.266 (16.00 SQ MM)',
                    ])
                  ).map(bunchSpec => {
                    const key = `BUNCHED_COPPER||${bunchSpec}`;
                    const kgVal = stockOpenings[key] ?? 0;
                    const mtrsVal = stockOpenings[`${key}||MTRS`] ?? 0;
                    const isLocked = Boolean(
                      lockedOpeningKeys[key] ||
                        stockOpenings[key] !== undefined ||
                        stockOpenings[`${key}||MTRS`] !== undefined
                    );
                    return (
                      <div key={bunchSpec} className="bg-white p-2 rounded-lg border border-slate-200 text-xs space-y-1">
                        <div className="flex items-center justify-between font-bold text-slate-800">
                          <span className="truncate max-w-[205px]" title={bunchSpec}>{bunchSpec}</span>
                          {isLocked && (kgVal > 0 || mtrsVal > 0) && (
                            <span className="text-[9px] px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold" title="Manually input opening stock (Locked)">
                              🔒
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="text-[9px] font-bold text-slate-500 uppercase block">Opening Kg</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={kgVal || ''}
                                onChange={e => handleUpdateOpening(key, parseFloat(e.target.value) || 0)}
                                placeholder="0"
                                className="w-full px-2 py-0.5 text-right border border-amber-300 rounded font-black text-xs bg-amber-50/30 text-amber-950"
                              />
                              <span className="text-[10px] text-slate-500 font-semibold">kg</span>
                            </div>
                          </div>
                          <div>
                            <label className="text-[9px] font-bold text-slate-500 uppercase block">Length (Opt)</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                value={mtrsVal || ''}
                                onChange={e => {
                                  const nextM = parseFloat(e.target.value) || 0;
                                  const next = { ...stockOpenings, [`${key}||MTRS`]: nextM };
                                  const nextLocks = { ...lockedOpeningKeys, [`${key}||MTRS`]: true };
                                  onUpdateStockOpenings(next);
                                  setLockedOpeningKeys(nextLocks);
                                  try {
                                    localStorage.setItem('plutus_stock_openings', JSON.stringify(next));
                                    localStorage.setItem('plutus_stock_openings_manual_v2', JSON.stringify(next));
                                    localStorage.setItem('plutus_locked_opening_keys_v2', JSON.stringify(nextLocks));
                                  } catch (err) {}
                                }}
                                placeholder="0"
                                className="w-full px-2 py-0.5 text-right border border-slate-300 rounded font-bold text-xs bg-white"
                              />
                              <span className="text-[10px] text-slate-500 font-semibold">m</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* PVC Insulation Compounds */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-slate-900 border-b border-slate-200 pb-1 flex items-center justify-between">
                  <span>🧱 Insulation PVC Compounds (KG)</span>
                  <span className="text-[10px] text-slate-500">Extrusion</span>
                </div>

                {/* Inline Dropdown + Manual Input for Insulation Material */}
                <div className="bg-emerald-50/80 p-2 rounded-lg border border-emerald-200 space-y-1.5">
                  <div className="text-[9.5px] font-extrabold text-emerald-950 uppercase">
                    Select or Type Insulation Material / Grade:
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <select
                      value={getCategoryMaterialPresets('INSULATION').includes(cardInsMat) ? cardInsMat : ''}
                      onChange={e => {
                        if (e.target.value) setCardInsMat(e.target.value);
                      }}
                      className="px-1.5 py-1 text-[11px] font-bold bg-white border border-emerald-300 rounded text-slate-800"
                    >
                      <option value="">▼ Pick Material...</option>
                      {getCategoryMaterialPresets('INSULATION').map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={cardInsMat}
                      onChange={e => setCardInsMat(e.target.value)}
                      placeholder="Or manual grade..."
                      className="px-2 py-1 text-[11px] font-bold bg-white border border-emerald-400 rounded text-slate-900"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={cardInsKg}
                      onChange={e => setCardInsKg(e.target.value)}
                      placeholder="Opening Kg"
                      className="flex-1 px-2 py-1 text-[11px] font-black text-right bg-white border border-emerald-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const m = cardInsMat.trim().toUpperCase();
                        if (!m) return;
                        handleUpdateOpening(`INSULATION||${m}`, parseFloat(cardInsKg) || 0);
                        setCardInsMat('');
                        setCardInsKg('');
                        showToast(`✅ Added Insulation Compound "${m}" to Opening Stock!`);
                      }}
                      className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded font-black text-[11px] cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {Array.from(
                  new Set([
                    ...orders.map(o => (o.ins_compound || '').toUpperCase().trim()).filter(Boolean),
                    'KI-06',
                    'KI-13',
                    'A 80 UW',
                    'A 80 NATURAL',
                    'TI1',
                    'GRADE A',
                    ...Object.keys(stockOpenings)
                      .filter(k => k.startsWith('INSULATION||'))
                      .map(k => k.replace('INSULATION||', '').trim())
                      .filter(Boolean),
                  ])
                ).map(comp => {
                  const key = `INSULATION||${comp}`;
                  const val = stockOpenings[key] ?? 0;
                  const isLocked = Boolean(lockedOpeningKeys[key] || stockOpenings[key] !== undefined);
                  return (
                    <div key={comp} className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-slate-700 truncate flex items-center gap-1">
                        <span>{comp}:</span>
                        {isLocked && val > 0 && (
                          <span className="text-[9px] px-1 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold" title="Manually input opening stock (Locked)">
                            🔒
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          value={val}
                          onChange={e => handleUpdateOpening(key, parseFloat(e.target.value) || 0)}
                          className="w-24 px-2 py-0.5 text-right border border-slate-300 rounded font-bold text-xs bg-white"
                        />
                        <span className="text-[10px] text-slate-500 font-semibold">kg</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* PVC Sheathing Compounds */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-slate-900 border-b border-slate-200 pb-1 flex items-center justify-between">
                  <span>🧱 Sheathing PVC Compounds (KG)</span>
                  <span className="text-[10px] text-slate-500">Extrusion</span>
                </div>

                {/* Inline Dropdown + Manual Input for Sheathing Material */}
                <div className="bg-purple-50/80 p-2 rounded-lg border border-purple-200 space-y-1.5">
                  <div className="text-[9.5px] font-extrabold text-purple-950 uppercase">
                    Select or Type Sheathing Material / Grade:
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <select
                      value={getCategoryMaterialPresets('SHEATH').includes(cardSheathMat) ? cardSheathMat : ''}
                      onChange={e => {
                        if (e.target.value) setCardSheathMat(e.target.value);
                      }}
                      className="px-1.5 py-1 text-[11px] font-bold bg-white border border-purple-300 rounded text-slate-800"
                    >
                      <option value="">▼ Pick Material...</option>
                      {getCategoryMaterialPresets('SHEATH').map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={cardSheathMat}
                      onChange={e => setCardSheathMat(e.target.value)}
                      placeholder="Or manual grade..."
                      className="px-2 py-1 text-[11px] font-bold bg-white border border-purple-400 rounded text-slate-900"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={cardSheathKg}
                      onChange={e => setCardSheathKg(e.target.value)}
                      placeholder="Opening Kg"
                      className="flex-1 px-2 py-1 text-[11px] font-black text-right bg-white border border-purple-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const m = cardSheathMat.trim().toUpperCase();
                        if (!m) return;
                        handleUpdateOpening(`SHEATH||${m}`, parseFloat(cardSheathKg) || 0);
                        setCardSheathMat('');
                        setCardSheathKg('');
                        showToast(`✅ Added Sheathing Compound "${m}" to Opening Stock!`);
                      }}
                      className="px-2.5 py-1 bg-purple-700 hover:bg-purple-800 text-white rounded font-black text-[11px] cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {Array.from(
                  new Set([
                    ...orders.map(o => (o.sheath_compound || '').toUpperCase().trim()).filter(Boolean),
                    'KI-05',
                    'ST-1 GREY',
                    'A80 HD BLACK',
                    'ST2',
                    ...Object.keys(stockOpenings)
                      .filter(k => k.startsWith('SHEATH||'))
                      .map(k => k.replace('SHEATH||', '').trim())
                      .filter(Boolean),
                  ])
                ).map(comp => {
                  const key = `SHEATH||${comp}`;
                  const val = stockOpenings[key] ?? 0;
                  const isLocked = Boolean(lockedOpeningKeys[key] || stockOpenings[key] !== undefined);
                  return (
                    <div key={comp} className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-slate-700 truncate flex items-center gap-1">
                        <span>{comp}:</span>
                        {isLocked && val > 0 && (
                          <span className="text-[9px] px-1 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold" title="Manually input opening stock (Locked)">
                            🔒
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          value={val}
                          onChange={e => handleUpdateOpening(key, parseFloat(e.target.value) || 0)}
                          className="w-24 px-2 py-0.5 text-right border border-slate-300 rounded font-bold text-xs bg-white"
                        />
                        <span className="text-[10px] text-slate-500 font-semibold">kg</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Drums & Spools */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-slate-900 border-b border-slate-200 pb-1 flex items-center justify-between">
                  <span>🪵 Wooden Drums (NOS)</span>
                  <span className="text-[10px] text-slate-500">Packaging</span>
                </div>

                {/* Inline Dropdown + Manual Input for Drum Size & Material */}
                <div className="bg-blue-50/80 p-2 rounded-lg border border-blue-200 space-y-1.5">
                  <div className="text-[9.5px] font-extrabold text-blue-950 uppercase">
                    Select or Type Drum Size &amp; Material:
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <select
                      value={getCategorySizePresets('DRUM').includes(cardDrumSize) ? cardDrumSize : ''}
                      onChange={e => {
                        if (e.target.value) setCardDrumSize(e.target.value);
                      }}
                      className="px-1.5 py-1 text-[11px] font-bold bg-white border border-blue-300 rounded text-slate-800"
                    >
                      <option value="">▼ Pick Drum Size...</option>
                      {getCategorySizePresets('DRUM').map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={cardDrumSize}
                      onChange={e => setCardDrumSize(e.target.value)}
                      placeholder="Manual Size (e.g. 48 X 16 X 28)"
                      className="px-2 py-1 text-[11px] font-bold bg-white border border-blue-400 rounded text-slate-900"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <select
                      value={getCategoryMaterialPresets('DRUM').includes(cardDrumMat) ? cardDrumMat : ''}
                      onChange={e => {
                        if (e.target.value) setCardDrumMat(e.target.value);
                      }}
                      className="px-1.5 py-1 text-[11px] font-semibold bg-white border border-slate-300 rounded text-slate-700"
                    >
                      <option value="">▼ Material (Optional)...</option>
                      {getCategoryMaterialPresets('DRUM').map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={cardDrumMat}
                      onChange={e => setCardDrumMat(e.target.value)}
                      placeholder="Or manual material..."
                      className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-300 rounded text-slate-800"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={cardDrumNos}
                      onChange={e => setCardDrumNos(e.target.value)}
                      placeholder="Opening Nos"
                      className="flex-1 px-2 py-1 text-[11px] font-black text-right bg-white border border-blue-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const s = cardDrumSize.trim();
                        const m = cardDrumMat.trim();
                        if (!s && !m) return;
                        const label = s && m && !m.toLowerCase().includes('wooden spool') ? `${s} (${m})` : s || m;
                        handleUpdateOpening(`DRUM||${label}`, parseFloat(cardDrumNos) || 0);
                        setCardDrumSize('');
                        setCardDrumMat('');
                        setCardDrumNos('');
                        showToast(`✅ Added Drum "${label}" to Opening Stock!`);
                      }}
                      className="px-2.5 py-1 bg-blue-700 hover:bg-blue-800 text-white rounded font-black text-[11px] cursor-pointer"
                    >
                      + Add Drum
                    </button>
                  </div>
                </div>

                {Array.from(
                  new Set([
                    '28 X 12 X 15',
                    '30 X 12 X 15',
                    '30 X 12 X 19',
                    '36 X 16 X 20',
                    ...orders
                      .map(o => {
                        const evalPkg = evaluateSpoolSizeForOrder(
                          o.final_dia || 0,
                          o.order_length || 0,
                          o.size || '',
                          o.cores || 1,
                          o.grade || '',
                          sizeRules,
                          packagingRules,
                          o.spool_size
                        );
                        return evalPkg?.spool || '';
                      })
                      .filter(Boolean),
                    ...Object.keys(stockOpenings)
                      .filter(k => k.startsWith('DRUM||'))
                      .map(k => k.replace('DRUM||', '').trim())
                      .filter(Boolean),
                  ])
                ).map(dSize => {
                  const key = `DRUM||${dSize}`;
                  const val = stockOpenings[key] ?? 0;
                  const isLocked = Boolean(lockedOpeningKeys[key] || stockOpenings[key] !== undefined);
                  return (
                    <div key={dSize} className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-slate-700 truncate flex items-center gap-1">
                        <span>{dSize}:</span>
                        {isLocked && val > 0 && (
                          <span className="text-[9px] px-1 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold" title="Manually input opening stock (Locked)">
                            🔒
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          value={val}
                          onChange={e => handleUpdateOpening(key, parseFloat(e.target.value) || 0)}
                          className="w-24 px-2 py-0.5 text-right border border-slate-300 rounded font-bold text-xs bg-white"
                        />
                        <span className="text-[10px] text-slate-500 font-semibold">Nos</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Wooden Pallets */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <div className="text-xs font-bold text-slate-900 border-b border-slate-200 pb-1 flex items-center justify-between">
                  <span>🪵 Wooden Pallets (NOS)</span>
                  <span className="text-[10px] text-slate-500">Dispatch</span>
                </div>

                {/* Inline Dropdown + Manual Input for Pallet Size & Material */}
                <div className="bg-teal-50/80 p-2 rounded-lg border border-teal-200 space-y-1.5">
                  <div className="text-[9.5px] font-extrabold text-teal-950 uppercase">
                    Select or Type Pallet Size &amp; Material:
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <select
                      value={getCategorySizePresets('PALLET').includes(cardPalletSize) ? cardPalletSize : ''}
                      onChange={e => {
                        if (e.target.value) setCardPalletSize(e.target.value);
                      }}
                      className="px-1.5 py-1 text-[11px] font-bold bg-white border border-teal-300 rounded text-slate-800"
                    >
                      <option value="">▼ Pick Pallet Size...</option>
                      {getCategorySizePresets('PALLET').map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={cardPalletSize}
                      onChange={e => setCardPalletSize(e.target.value)}
                      placeholder="Manual Size (e.g. 42X42x6)"
                      className="px-2 py-1 text-[11px] font-bold bg-white border border-teal-400 rounded text-slate-900"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <select
                      value={getCategoryMaterialPresets('PALLET').includes(cardPalletMat) ? cardPalletMat : ''}
                      onChange={e => {
                        if (e.target.value) setCardPalletMat(e.target.value);
                      }}
                      className="px-1.5 py-1 text-[11px] font-semibold bg-white border border-slate-300 rounded text-slate-700"
                    >
                      <option value="">▼ Material (Optional)...</option>
                      {getCategoryMaterialPresets('PALLET').map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={cardPalletMat}
                      onChange={e => setCardPalletMat(e.target.value)}
                      placeholder="Or manual material..."
                      className="px-2 py-1 text-[11px] font-semibold bg-white border border-slate-300 rounded text-slate-800"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={cardPalletNos}
                      onChange={e => setCardPalletNos(e.target.value)}
                      placeholder="Opening Nos"
                      className="flex-1 px-2 py-1 text-[11px] font-black text-right bg-white border border-teal-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const s = cardPalletSize.trim();
                        const m = cardPalletMat.trim();
                        if (!s && !m) return;
                        const label = s && m && !m.toLowerCase().includes('wooden dispatch') ? `${s} (${m})` : s || m;
                        handleUpdateOpening(`PALLET||${label}`, parseFloat(cardPalletNos) || 0);
                        setCardPalletSize('');
                        setCardPalletMat('');
                        setCardPalletNos('');
                        showToast(`✅ Added Pallet "${label}" to Opening Stock!`);
                      }}
                      className="px-2.5 py-1 bg-teal-700 hover:bg-teal-800 text-white rounded font-black text-[11px] cursor-pointer"
                    >
                      + Add Pallet
                    </button>
                  </div>
                </div>

                {Array.from(
                  new Set([
                    '30X30x6',
                    '36X36x6',
                    ...Object.keys(stockOpenings)
                      .filter(k => k.startsWith('PALLET||'))
                      .map(k => k.replace('PALLET||', '').trim())
                      .filter(Boolean),
                  ])
                ).map(pSize => {
                  const key = `PALLET||${pSize}`;
                  const val = stockOpenings[key] ?? 0;
                  const isLocked = Boolean(lockedOpeningKeys[key] || stockOpenings[key] !== undefined);
                  return (
                    <div key={pSize} className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-slate-700 truncate flex items-center gap-1">
                        <span>{pSize}:</span>
                        {isLocked && val > 0 && (
                          <span className="text-[9px] px-1 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold" title="Manually input opening stock (Locked)">
                            🔒
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="any"
                          value={val}
                          onChange={e => handleUpdateOpening(key, parseFloat(e.target.value) || 0)}
                          className="w-24 px-2 py-0.5 text-right border border-slate-300 rounded font-bold text-xs bg-white"
                        />
                        <span className="text-[10px] text-slate-500 font-semibold">Nos</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB: LIVE PROCESS CARD CONSUMPTION TRACKER */}
        {activeSubTab === 'consumption_logs' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
              <div>
                <div className="text-xs font-extrabold text-blue-950 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-blue-700" />
                  <span>Real-Time Process Card Consumption Tracker (Stages B, I, SH)</span>
                </div>
                <div className="text-[11px] text-blue-800 mt-0.5">
                  Whenever an operator marks Bunching (B), Insulation (I), or Sheathing (SH) complete on Tab 3 or Tab 1, the exact raw materials are automatically deducted from the stock below.
                </div>
              </div>
              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('requisition')}
                  className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  Go to 3. Process Cards Tab
                </button>
              )}
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-2 border-r border-slate-200">#</th>
                    <th className="p-2 border-r border-slate-200">Batch & Order</th>
                    <th className="p-2 border-r border-slate-200">Cable Specification</th>
                    <th className="p-2 border-r border-slate-200 text-center">Process Stage</th>
                    <th className="p-2 border-r border-slate-200">Material Deducted</th>
                    <th className="p-2 border-r border-slate-200 text-right">Deducted Qty</th>
                    <th className="p-2 border-r border-slate-200">Completion Timestamp</th>
                    <th className="p-2">Audit Trace</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stageConsumptionLogs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-slate-400 font-semibold">
                        No active stage consumptions yet. Toggle B, I, or SH in Tab 3 Process Cards to see live deductions.
                      </td>
                    </tr>
                  ) : (
                    stageConsumptionLogs.map((log, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-2 border-r border-slate-100">{idx + 1}</td>
                        <td className="p-2 border-r border-slate-100 font-bold text-slate-900">
                          {log.batch} <span className="text-[10px] text-slate-500 font-normal">(#{log.orderId})</span>
                        </td>
                        <td className="p-2 border-r border-slate-100 font-semibold text-slate-800">
                          {log.cores}C × {log.size} - {log.brand}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                              log.stageKey === 'b'
                                ? 'bg-amber-100 text-amber-800'
                                : log.stageKey === 'i'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}
                          >
                            {log.stageName}
                          </span>
                        </td>
                        <td className="p-2 border-r border-slate-100 font-bold text-slate-800">
                          {log.materialName}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-black text-amber-700">
                          -{log.consumedQty.toFixed(1)} {log.unit}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-slate-500 font-mono text-[10.5px]">
                          {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Just Now'}
                        </td>
                        <td className="p-2 text-slate-600 text-[11px]">{log.note}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-TAB: MONTHLY REPORT & AUTO-ROLLOVER */}
        {activeSubTab === 'monthly_report' && (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 border-2 border-emerald-600 rounded-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-emerald-700" />
                  <div>
                    <h3 className="font-extrabold text-emerald-950 text-sm">
                      MONTHLY INVENTORY AUTO-ROLLOVER & REPORTING
                    </h3>
                    <p className="text-xs text-emerald-800 font-medium mt-0.5">
                      On the month-end day, automatically carry forward Closing Stock into the Next Month's Opening Stock.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handleGenerateMonthlySnapshot}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-black flex items-center gap-1.5 shadow-sm cursor-pointer"
                    title="Archive current closing stock as opening stock for the next month, and reset production-related stock usage flags"
                  >
                    <Camera className="w-4 h-4" /> 📸 Generate Monthly Snapshot
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadStockReport}
                    className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-black flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Download className="w-4 h-4" /> Download Stock Report
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExecuteMonthRollover('2026-10', '2026-11')}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" /> 🔄 Auto-Roll October Closing → November Opening
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadFormattedMonthlyReport}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Printer className="w-4 h-4" /> 🖨️ Print Report (1 Table per Page)
                  </button>
                </div>
              </div>
            </div>

            {/* Archived Snapshots Audit Register */}
            {Object.keys(monthlySnapshots).length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase">
                    <Archive className="w-4 h-4 text-indigo-600" />
                    Archived Monthly Stock Snapshots ({Object.keys(monthlySnapshots).length})
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium">
                    Auto-saved across sessions and exports
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(monthlySnapshots).map(([key, snap]) => (
                    <div
                      key={key}
                      className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs flex flex-col justify-between"
                    >
                      <div>
                        <div className="font-extrabold text-slate-900 flex items-center justify-between">
                          <span>Month {snap.monthKey || key}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              snap.isClosed
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {snap.isClosed ? 'Archived Snapshot' : 'Active Opening'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {snap.closedAt
                            ? `Archived: ${new Date(snap.closedAt).toLocaleString()}`
                            : 'Active Opening Balances'}
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-slate-600">
                          {Object.keys(snap.openingMap || {}).length} items tracked
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedMonth(snap.monthKey || key)}
                          className="text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
                        >
                          View Ledger →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Monthly Report Summary Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-900 text-white p-3 font-bold text-xs uppercase flex items-center justify-between">
                <span>Month Summary Ledger (Opening, Receipts, Consumed, Rejections, Closing)</span>
                <span className="text-[11px] text-slate-300 font-normal">
                  Period: {selectedMonth === 'ALL' ? 'Cumulative' : selectedMonth}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10.5px] border-b border-slate-200">
                    <tr>
                      <th className="p-2 border-r border-slate-200">Category</th>
                      <th className="p-2 border-r border-slate-200">Material / Item</th>
                      <th className="p-2 border-r border-slate-200 text-center">Unit</th>
                      <th className="p-2 border-r border-slate-200 text-right bg-slate-200/60">Opening</th>
                      <th className="p-2 border-r border-slate-200 text-right text-blue-700">+ Receipts</th>
                      <th className="p-2 border-r border-slate-200 text-right bg-indigo-50 text-indigo-950 font-bold">
                        Total Stock (Op+Rec)
                      </th>
                      <th className="p-2 border-r border-slate-200 text-right text-amber-700">- Consumed</th>
                      <th className="p-2 border-r border-slate-200 text-right text-red-700">- Rejections</th>
                      <th className="p-2 border-r border-slate-200 text-right text-emerald-700">+ Returns</th>
                      <th className="p-2 border-r border-slate-200 text-right bg-emerald-100/70 font-black text-emerald-950">
                        Closing Stock
                      </th>
                      <th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stockResult.allRows.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="p-2 border-r border-slate-100 text-[10px] font-bold text-slate-500">
                          {item.category}
                        </td>
                        <td className="p-2 border-r border-slate-100 font-bold text-slate-900">
                          {item.name}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-center font-bold text-slate-600">
                          {item.unit}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-medium">
                          {item.opening.toFixed(1)}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-semibold text-blue-700">
                          {item.received > 0 ? `+${item.received.toFixed(1)}` : '0'}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-bold text-indigo-950 bg-indigo-50/50">
                          {((item.opening || 0) + (item.received || 0)).toFixed(1)}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-semibold text-amber-700">
                          {item.consumed > 0 ? `-${item.consumed.toFixed(1)}` : '0'}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right text-red-600 font-semibold">
                          {item.supplierRejections + item.scrapRejections > 0
                            ? `-${(item.supplierRejections + item.scrapRejections).toFixed(1)}`
                            : '0'}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right text-emerald-600 font-semibold">
                          {item.customerReturns + item.lineReturns > 0
                            ? `+${(item.customerReturns + item.lineReturns).toFixed(1)}`
                            : '0'}
                        </td>
                        <td
                          className={`p-2 border-r border-slate-100 text-right font-black ${
                            item.closing < 0
                              ? 'bg-red-100/90 text-red-700 font-black'
                              : 'bg-emerald-50 text-emerald-900'
                          }`}
                        >
                          {item.isNosOnly ? item.closingMtrsStr : item.closingKgsStr}
                        </td>
                        <td className="p-2 text-slate-600 text-[11px]">{item.remark}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-900 text-white font-bold text-xs uppercase border-t-2 border-slate-700">
                    <tr>
                      <td colSpan={3} className="p-2.5 border-r border-slate-700 text-right tracking-wider">
                        TOTAL SUMMARY:
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right text-slate-200">
                        {monthSummaryTotals.opening.toFixed(1)}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right text-blue-300">
                        +{monthSummaryTotals.received.toFixed(1)}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right bg-indigo-950 text-indigo-200 font-black">
                        {monthSummaryTotals.totalStock.toFixed(1)}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right text-amber-300">
                        -{monthSummaryTotals.consumed.toFixed(1)}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right text-red-300">
                        -{monthSummaryTotals.rejections.toFixed(1)}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right text-emerald-300">
                        +{monthSummaryTotals.returns.toFixed(1)}
                      </td>
                      <td className="p-2.5 border-r border-slate-700 text-right text-emerald-300 font-black">
                        {monthSummaryTotals.closing.toFixed(1)}
                      </td>
                      <td className="p-2.5 text-slate-400 text-[11px] normal-case font-normal">
                        {stockResult.allRows.length} items summarized
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* DEFAULT VIEW: MASTER INVENTORY LEDGER TABLE */}
        {activeSubTab !== 'returns' && activeSubTab !== 'openings' && activeSubTab !== 'consumption_logs' && activeSubTab !== 'monthly_report' && (
          <div className="space-y-3">
            {/* INVENTORY TABLE SEARCH & CATEGORY FILTER TOOLBAR */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 no-print">
              <div className="flex items-center gap-2.5 flex-wrap flex-1 min-w-[280px]">
                {/* Search Text Input */}
                <div className="relative flex-1 min-w-[220px] max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search material name, copper strand, PVC grade, drum, cable..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full text-xs pl-9 pr-8 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-2xs font-medium text-slate-800"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer"
                      title="Clear search text"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Category-Based Dropdown Filter */}
                <div className="flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 gap-2 shadow-2xs">
                  <Filter className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <label htmlFor="inv-category-filter" className="text-xs font-bold text-slate-700 shrink-0">
                    Category:
                  </label>
                  <select
                    id="inv-category-filter"
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    className="text-xs font-semibold text-slate-900 bg-transparent outline-none cursor-pointer max-w-[220px] truncate"
                  >
                    <option value="ALL">All Categories ({stockResult.allRows.length})</option>
                    {availableCategories.map(cat => {
                      const count = stockResult.allRows.filter(
                        r => (r.category || '').toUpperCase().trim() === cat.toUpperCase().trim()
                      ).length;
                      return (
                        <option key={cat} value={cat}>
                          {cat} ({count})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Clear / Reset Filters Button (visible when filtering) */}
                {(searchQuery.trim() !== '' || categoryFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setCategoryFilter('ALL');
                    }}
                    className="text-xs px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                    title="Reset all search and category filters"
                  >
                    <X className="w-3 h-3" /> Reset Filters
                  </button>
                )}
              </div>

              {/* Items Counter & Filter Status Indicator */}
              <div className="flex items-center gap-2 text-xs font-medium text-slate-600 ml-auto">
                <span>
                  Showing <strong className="text-blue-700 font-bold">{displayRows.length}</strong> of{' '}
                  <strong className="text-slate-800">{stockResult.allRows.length}</strong> items
                </span>
                {categoryFilter !== 'ALL' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                    {categoryFilter}
                  </span>
                )}
              </div>
            </div>

            {/* Quick Category Shortcut Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 no-print">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1">
                Quick Category:
              </span>
              <button
                type="button"
                onClick={() => setCategoryFilter('ALL')}
                className={`text-[11px] px-2.5 py-1 rounded-full font-bold transition-all cursor-pointer whitespace-nowrap ${
                  categoryFilter === 'ALL'
                    ? 'bg-slate-800 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All ({stockResult.allRows.length})
              </button>
              {availableCategories.slice(0, 6).map(cat => {
                const isSelected = categoryFilter.toUpperCase().trim() === cat.toUpperCase().trim();
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(isSelected ? 'ALL' : cat)}
                    className={`text-[11px] px-2.5 py-1 rounded-full font-bold transition-all cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-2 border-r border-slate-200">#</th>
                    <th className="p-2 border-r border-slate-200">Category</th>
                    <th className="p-2 border-r border-slate-200">Material / Item Name</th>
                    <th className="p-2 border-r border-slate-200 text-center">Unit</th>
                    <th className="p-2 border-r border-slate-200 text-right bg-slate-200/50">Opening Stock</th>
                    <th className="p-2 border-r border-slate-200 text-right text-blue-700">
                      Received / Produced
                    </th>
                    <th className="p-2 border-r border-slate-200 text-right bg-indigo-50/80 text-indigo-950 font-bold">
                      Total Stock (Op + Rec)
                    </th>
                    <th className="p-2 border-r border-slate-200 text-right text-amber-700">
                      Req Deducted / Consumed (B, I, SH)
                    </th>
                    <th className="p-2 border-r border-slate-200 text-right text-red-700">
                      Rejections (-)
                    </th>
                    <th className="p-2 border-r border-slate-200 text-right text-emerald-700">
                      Returns (+)
                    </th>
                    <th className="p-2 border-r border-slate-200 text-right bg-blue-50 text-blue-900 font-bold">
                      Closing (MTRS)
                    </th>
                    <th className="p-2 border-r border-slate-200 text-right bg-amber-50 text-amber-900 font-bold">
                      Closing (KGS / NOS)
                    </th>
                    <th className="p-2 border-r border-slate-200">Status / Stage Trace</th>
                    <th className="p-2 text-center no-print">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayRows.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="p-8 text-center text-slate-400 font-semibold">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Filter className="w-8 h-8 text-slate-300" />
                          <div>No stock items match your search or category filter.</div>
                          {(searchQuery || categoryFilter !== 'ALL') && (
                            <button
                              type="button"
                              onClick={() => {
                                setSearchQuery('');
                                setCategoryFilter('ALL');
                              }}
                              className="mt-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 cursor-pointer"
                            >
                              Clear Filters & Show All Items
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                  displayRows.map((item, idx) => {
                    const cat = (item.category || '').toUpperCase();
                    const badgeBg = cat.includes('DISPATCHED')
                      ? 'bg-purple-100 text-purple-800'
                      : cat.includes('FINISHED')
                      ? 'bg-emerald-100 text-emerald-800'
                      : cat.includes('COPPER')
                      ? 'bg-amber-100 text-amber-800'
                      : cat.includes('DRUM')
                      ? 'bg-orange-100 text-orange-800'
                      : cat.includes('PALLET')
                      ? 'bg-teal-100 text-teal-800'
                      : 'bg-blue-100 text-blue-800';

                    return (
                      <tr key={item.key || idx} className="hover:bg-slate-50">
                        <td className="p-2 border-r border-slate-100">{idx + 1}</td>
                        <td className="p-2 border-r border-slate-100">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${badgeBg}`}>
                            {item.category}
                          </span>
                        </td>
                        <td className="p-2 border-r border-slate-100 font-bold text-slate-900">
                          {item.isCustom && item.customIdx !== undefined ? (
                            <input
                              type="text"
                              value={item.name}
                              onChange={e =>
                                onUpdateCustomStock(item.customIdx!, 'name', e.target.value)
                              }
                              className="w-56 px-1.5 py-0.5 border border-slate-300 rounded font-semibold text-xs bg-white"
                            />
                          ) : (
                            item.name
                          )}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-center font-bold text-slate-600">
                          {item.unit}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right bg-slate-50">
                          <input
                            type="number"
                            step="any"
                            value={item.opening}
                            onChange={e => {
                              const num = parseFloat(e.target.value) || 0;
                              if (item.isCustom && item.customIdx !== undefined) {
                                onUpdateCustomStock(item.customIdx, 'opening', num);
                              } else {
                                handleUpdateOpening(item.key, num);
                              }
                            }}
                            className="w-20 px-1 py-0.5 border border-slate-300 rounded text-right text-xs bg-white font-semibold"
                            title="Click to directly adjust Opening Stock"
                          />
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-semibold text-blue-700">
                          <input
                            type="number"
                            step="any"
                            value={item.received}
                            onChange={e => {
                              const num = parseFloat(e.target.value) || 0;
                              if (item.isCustom && item.customIdx !== undefined) {
                                onUpdateCustomStock(
                                  item.customIdx!,
                                  'received',
                                  num
                                );
                              }
                              handleUpdateOverride(item.key, 'received', num);
                            }}
                            className="w-20 px-1 py-0.5 border border-slate-300 rounded text-right text-xs bg-white font-semibold text-blue-700"
                            title="Click to directly edit Received / Produced stock"
                          />
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-bold text-indigo-950 bg-indigo-50/50">
                          {((item.opening || 0) + (item.received || 0)).toFixed(1)}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-bold text-amber-700">
                          <div className="flex flex-col items-end gap-0.5">
                            <input
                              type="number"
                              step="any"
                              value={item.consumed}
                              onChange={e => {
                                const num = parseFloat(e.target.value) || 0;
                                if (item.isCustom && item.customIdx !== undefined) {
                                  onUpdateCustomStock(
                                    item.customIdx!,
                                    'consumed',
                                    num
                                  );
                                }
                                handleUpdateOverride(item.key, 'consumed', num);
                              }}
                              className={`w-20 px-1 py-0.5 border border-slate-300 rounded text-right text-xs bg-white font-bold ${
                                item.consumed > 0 ? 'text-amber-700' : 'text-slate-600'
                              }`}
                              title="Click to edit Consumed / Deducted stock"
                            />
                            {((item.stageConsumedQty || 0) > 0 || (item.activeOrderReqQty || 0) > 0) && (
                              <span className="text-[9px] font-semibold text-amber-800 bg-amber-50 px-1 py-0.2 rounded">
                                Done: {(item.stageConsumedQty || 0).toFixed(1)} | Req: {(item.activeOrderReqQty || 0).toFixed(1)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-semibold text-red-600">
                          {item.supplierRejections + item.scrapRejections > 0
                            ? `-${(item.supplierRejections + item.scrapRejections).toFixed(1)}`
                            : '0'}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right font-semibold text-emerald-600">
                          {item.customerReturns + item.lineReturns > 0
                            ? `+${(item.customerReturns + item.lineReturns).toFixed(1)}`
                            : '0'}
                        </td>
                        <td
                          className={`p-2 border-r border-slate-100 text-right font-bold ${
                            item.closing < 0
                              ? 'text-red-700 bg-red-100/90 font-black border-red-300'
                              : 'text-blue-900 bg-blue-50/50'
                          }`}
                        >
                          {item.closingMtrsStr}
                        </td>
                        <td
                          className={`p-2 border-r border-slate-100 text-right font-bold ${
                            item.closing < 0
                              ? 'text-red-700 bg-red-100/90 font-black border-red-300'
                              : 'text-amber-900 bg-amber-50/50'
                          }`}
                        >
                          {item.isNosOnly ? item.closingMtrsStr : item.closingKgsStr}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-slate-600">
                          {item.closing < 0 ? (
                            <span className="text-red-700 font-bold">
                              ⚠️ Auto-Consumed Deficit ({item.remark})
                            </span>
                          ) : (
                            item.remark
                          )}
                        </td>
                        <td className="p-2 text-center no-print">
                          {item.isCustom && item.customIdx !== undefined ? (
                            <button
                              onClick={() => onDeleteCustomStock(item.customIdx!)}
                              className="p-1 hover:bg-red-50 text-red-600 rounded cursor-pointer"
                              title="Delete custom stock"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <span className="text-[10px] text-emerald-600 font-bold">
                              Auto-Linked
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="bg-slate-900 text-white font-bold text-xs uppercase border-t-2 border-slate-700">
                <tr>
                  <td colSpan={4} className="p-2.5 border-r border-slate-700 text-right tracking-wider">
                    TOTAL SUMMARY ({displayRows.length} ITEMS):
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-slate-200 font-semibold">
                    {displayTotals.opening.toFixed(1)}
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-blue-300 font-semibold">
                    +{displayTotals.received.toFixed(1)}
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right bg-indigo-950 text-indigo-200 font-black">
                    {displayTotals.totalStock.toFixed(1)}
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-amber-300 font-semibold">
                    -{displayTotals.consumed.toFixed(1)}
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-red-300 font-semibold">
                    -{displayTotals.rejections.toFixed(1)}
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-emerald-300 font-semibold">
                    +{displayTotals.returns.toFixed(1)}
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right text-blue-200 font-bold">
                    {displayTotals.closingMtrs > 0 ? `${displayTotals.closingMtrs.toLocaleString()} M` : '-'}
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-right font-black text-amber-200">
                    {displayTotals.closingKgs > 0
                      ? `${displayTotals.closingKgs.toFixed(1)} kg`
                      : displayTotals.closingNos > 0
                      ? `${displayTotals.closingNos} Nos`
                      : '0.0 kg'}
                  </td>
                  <td className="p-2.5 border-r border-slate-700 text-slate-300 text-[11px] normal-case font-normal">
                    Net Stock Balance
                  </td>
                  <td className="p-2.5 text-center no-print"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      </div>

      {/* MODAL: ADD RETURN / REJECTION */}
      {isAddReturnModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 text-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="text-sm font-extrabold text-slate-900 uppercase flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-purple-600" />
                <span>Record Return or Rejection</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddReturnModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveReturnRejection} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                  Transaction Type *
                </label>
                <select
                  value={retType}
                  onChange={e => {
                    const t = e.target.value as any;
                    setRetType(t);
                    if (t === 'supplier_rejection' || t === 'scrap_rejection') {
                      setRetUnit('KGS');
                    }
                  }}
                  className="w-full p-2 border border-slate-300 rounded font-bold bg-white text-slate-800"
                >
                  <option value="supplier_rejection">🔴 Supplier Defect Rejection (Deducts from Raw Stock)</option>
                  <option value="scrap_rejection">🟠 Production Purge / Extruder Scrap (Deducts from Good Stock)</option>
                  <option value="customer_return">🟢 Customer Cable Return (Adds back to Warehouse Stock)</option>
                  <option value="line_return">🔵 Line Surplus Return (Adds back to Warehouse Stock)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    Category *
                  </label>
                  <select
                    value={retCategory}
                    onChange={e => setRetCategory(e.target.value as any)}
                    className="w-full p-2 border border-slate-300 rounded font-semibold bg-white text-slate-800"
                  >
                    <option value="COPPER">COPPER</option>
                    <option value="INSULATION">INSULATION PVC</option>
                    <option value="SHEATH">SHEATHING PVC</option>
                    <option value="FINISHED">FINISHED CABLE</option>
                    <option value="DRUMS">WOODEN DRUMS</option>
                    <option value="PALLETS">PALLETS</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    Unit
                  </label>
                  <select
                    value={retUnit}
                    onChange={e => setRetUnit(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-bold bg-white text-slate-800"
                  >
                    <option value="KGS">KGS</option>
                    <option value="MTRS">MTRS</option>
                    <option value="NOS">NOS (Pieces)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                  Material / Item Name *
                </label>
                <input
                  type="text"
                  value={retMaterialName}
                  onChange={e => setRetMaterialName(e.target.value)}
                  placeholder="e.g. 0.21 Drawn Strands, KI-06, KI-05, Drum 30x12x15"
                  className="w-full p-2 border border-slate-300 rounded font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    Quantity *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={retQty}
                    onChange={e => setRetQty(e.target.value)}
                    placeholder="e.g. 25.5"
                    className="w-full p-2 border border-slate-300 rounded font-bold text-right"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    Batch / Invoice Ref
                  </label>
                  <input
                    type="text"
                    value={retRef}
                    onChange={e => setRetRef(e.target.value)}
                    placeholder="e.g. INV-305 or JOB NO 24"
                    className="w-full p-2 border border-slate-300 rounded font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                  Reason & Defect Details *
                </label>
                <textarea
                  value={retReason}
                  onChange={e => setRetReason(e.target.value)}
                  placeholder="e.g. Tensile elongation failed in lab test; returned to supplier"
                  rows={2}
                  className="w-full p-2 border border-slate-300 rounded font-medium"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAddReturnModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-lg font-bold shadow-sm"
                >
                  Save & Adjust Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD CUSTOM STOCK ITEM */}
      {isAddCustomModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 text-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-3">
              <h3 className="text-sm font-extrabold text-slate-900 uppercase">
                Add Custom Stock Item
              </h3>
              <button
                type="button"
                onClick={() => setIsAddCustomModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveCustomItem} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Category
                </label>
                <select
                  value={customCat}
                  onChange={e => setCustomCat(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded font-semibold bg-white"
                >
                  <option value="COPPER">COPPER</option>
                  <option value="INSULATION">INSULATION</option>
                  <option value="SHEATH">SHEATH</option>
                  <option value="FINISHED GOODS">FINISHED GOODS</option>
                  <option value="DRUMS">DRUMS</option>
                  <option value="PALLETS">PALLETS</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Material Name *
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={e => setCustomName(e.target.value)}
                  placeholder="e.g. Masterbatch Blue, Packing Film"
                  className="w-full p-2 border border-slate-300 rounded font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                    Unit
                  </label>
                  <input
                    type="text"
                    value={customUnit}
                    onChange={e => setCustomUnit(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded text-center font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                    Opening
                  </label>
                  <input
                    type="number"
                    value={customOpening}
                    onChange={e => setCustomOpening(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded text-right font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                    Received
                  </label>
                  <input
                    type="number"
                    value={customReceived}
                    onChange={e => setCustomReceived(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded text-right font-semibold"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAddCustomModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD ITEM / FINISHED GOOD TO OPENING STOCK */}
      {isAddOpeningItemModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 no-print overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 text-slate-800 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase flex items-center gap-1.5">
                  <Box className="w-4 h-4 text-rose-600" />
                  <span>Add Item / Finished Good to Opening Stock</span>
                </h3>
                <p className="text-[11px] text-slate-500 font-medium">
                  Manually enter any opening stock balance. Values are permanently locked and saved in inventory.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddOpeningItemModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNewOpeningItem} className="space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  1. Inventory Category *
                </label>
                <select
                  value={openAddCategory}
                  onChange={e => {
                    const cat = e.target.value as typeof openAddCategory;
                    setOpenAddCategory(cat);
                    const firstSize = getCategorySizePresets(cat)[0] || '';
                    const firstMat = getCategoryMaterialPresets(cat)[0] || '';
                    setOpenAddSize(firstSize);
                    setOpenAddMaterialGrade(firstMat);
                    syncCombinedOpeningName(cat, firstSize, firstMat);
                  }}
                  className="w-full p-2 border border-slate-300 rounded-lg font-bold bg-white text-slate-900 shadow-2xs"
                >
                  <option value="FINISHED_IS694">📦 FINISHED GOODS: IS-694 Building Wire / Cartons (Dual Coils &amp; Cartons)</option>
                  <option value="FINISHED_DRUM">📦 FINISHED GOODS: Standard Drum Cable (Meters &amp; Kgs)</option>
                  <option value="BUNCHED_COPPER">⚡ COPPER BUNCH SIZE COPPER / BUNCHED COPPER (KG &amp; MTRS)</option>
                  <option value="RAW_COPPER">⚡ RAW COPPER WIRE STRANDS (KG)</option>
                  <option value="INSULATION">🧱 PVC INSULATION COMPOUND (KG)</option>
                  <option value="SHEATH">🧱 PVC SHEATHING COMPOUND (KG)</option>
                  <option value="DRUM">🪵 WOODEN DRUMS (NOS)</option>
                  <option value="PALLET">🪵 WOODEN PALLETS (NOS)</option>
                  <option value="CUSTOM">🔧 CUSTOM STOCK ITEM</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-[10.5px] font-extrabold text-slate-700 uppercase mb-1">
                    {openAddCategory === 'BUNCHED_COPPER'
                      ? '2A. Copper Bunch Size (Dropdown + Manual)'
                      : '2A. Size (Dropdown + Manual Input)'}
                  </label>
                  <select
                    value={getCategorySizePresets(openAddCategory).includes(openAddSize) ? openAddSize : '__MANUAL__'}
                    onChange={e => {
                      if (e.target.value !== '__MANUAL__') {
                        setOpenAddSize(e.target.value);
                        syncCombinedOpeningName(openAddCategory, e.target.value, openAddMaterialGrade);
                      }
                    }}
                    className="w-full p-2 mb-1.5 border border-slate-300 rounded-lg font-bold bg-white text-slate-800"
                  >
                    <option value="__MANUAL__">✏️ Manual / Custom Size...</option>
                    {getCategorySizePresets(openAddCategory).map(sz => (
                      <option key={sz} value={sz}>{sz}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={openAddSize}
                    onChange={e => {
                      setOpenAddSize(e.target.value);
                      syncCombinedOpeningName(openAddCategory, e.target.value, openAddMaterialGrade);
                    }}
                    placeholder={
                      openAddCategory === 'BUNCHED_COPPER'
                        ? 'e.g. 52/0.260 (2.50 SQ MM)'
                        : 'Type custom size manually...'
                    }
                    className="w-full p-2 border border-blue-400 rounded-lg font-bold text-slate-900 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[10.5px] font-extrabold text-slate-700 uppercase mb-1">
                    2B. Material / Grade (Dropdown + Manual)
                  </label>
                  <select
                    value={
                      getCategoryMaterialPresets(openAddCategory).includes(openAddMaterialGrade)
                        ? openAddMaterialGrade
                        : '__MANUAL__'
                    }
                    onChange={e => {
                      if (e.target.value !== '__MANUAL__') {
                        setOpenAddMaterialGrade(e.target.value);
                        syncCombinedOpeningName(openAddCategory, openAddSize, e.target.value);
                      }
                    }}
                    className="w-full p-2 mb-1.5 border border-slate-300 rounded-lg font-bold bg-white text-slate-800"
                  >
                    <option value="__MANUAL__">✏️ Manual / Custom Material...</option>
                    {getCategoryMaterialPresets(openAddCategory).map(mat => (
                      <option key={mat} value={mat}>{mat}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={openAddMaterialGrade}
                    onChange={e => {
                      setOpenAddMaterialGrade(e.target.value);
                      syncCombinedOpeningName(openAddCategory, openAddSize, e.target.value);
                    }}
                    placeholder="Type custom material / brand..."
                    className="w-full p-2 border border-blue-400 rounded-lg font-bold text-slate-900 bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Combined Item Name / Specification (Editable) *
                </label>
                <input
                  type="text"
                  value={openAddItemName}
                  onChange={e => setOpenAddItemName(e.target.value)}
                  placeholder="Combined specification name"
                  className="w-full p-2.5 border border-slate-300 rounded-lg font-bold text-slate-900 bg-white"
                  required
                />
              </div>

              {/* DUAL COILS & CARTONS INPUT FOR IS-694 */}
              {openAddCategory === 'FINISHED_IS694' && (
                <div className="bg-rose-50/70 border border-rose-300 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between text-xs font-black text-rose-950 border-b border-rose-200 pb-1.5">
                    <span>📦 Dual Coils &amp; Cartons Input (IS-694 Building Wire)</span>
                    <span className="text-[10px] bg-rose-200 text-rose-900 px-2 py-0.5 rounded font-extrabold uppercase">
                      Two-Way Auto Calculation
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10.5px] font-bold text-slate-700 uppercase mb-1">
                        Coils per Carton (Std)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={openAddCoilsPerCarton}
                        onChange={e => {
                          const newCpc = e.target.value;
                          setOpenAddCoilsPerCarton(newCpc);
                          const cpcNum = parseFloat(newCpc) || 16;
                          const coilsNum = parseFloat(openAddCoils) || 0;
                          if (coilsNum > 0) {
                            setOpenAddCartons((coilsNum / cpcNum).toFixed(2).replace(/\.00$/, ''));
                          }
                        }}
                        className="w-full p-2 border border-rose-300 rounded bg-white font-bold text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-[10.5px] font-bold text-slate-700 uppercase mb-1">
                        Coil Length (Mtrs)
                      </label>
                      <select
                        value={openAddCoilLen}
                        onChange={e => {
                          const newLen = e.target.value;
                          setOpenAddCoilLen(newLen);
                          const lenNum = parseFloat(newLen) || 90;
                          const coilsNum = parseFloat(openAddCoils) || 0;
                          if (coilsNum > 0) {
                            setOpenAddMtrs(String(coilsNum * lenNum));
                          }
                        }}
                        className="w-full p-2 border border-rose-300 rounded bg-white font-bold text-center"
                      >
                        <option value="90">90 MTR (Standard)</option>
                        <option value="100">100 MTR</option>
                        <option value="45">45 MTR</option>
                        <option value="180">180 MTR</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-black text-rose-950 uppercase mb-1">
                        Option A: Coils Input
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={openAddCoils}
                        onChange={e => {
                          const val = e.target.value;
                          setOpenAddCoils(val);
                          const c = parseFloat(val) || 0;
                          const cpc = parseFloat(openAddCoilsPerCarton) || 16;
                          const len = parseFloat(openAddCoilLen) || 90;
                          if (c > 0) {
                            setOpenAddCartons((c / cpc).toFixed(2).replace(/\.00$/, ''));
                            setOpenAddMtrs(String(c * len));
                          } else {
                            setOpenAddCartons('');
                            setOpenAddMtrs('');
                          }
                        }}
                        placeholder="Enter Coils (e.g. 400)"
                        className="w-full p-2.5 border-2 border-rose-400 rounded-lg font-black text-sm text-center bg-white text-rose-950 focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-black text-amber-950 uppercase mb-1">
                        Option B: Carton Input
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={openAddCartons}
                        onChange={e => {
                          const val = e.target.value;
                          setOpenAddCartons(val);
                          const ctns = parseFloat(val) || 0;
                          const cpc = parseFloat(openAddCoilsPerCarton) || 16;
                          const len = parseFloat(openAddCoilLen) || 90;
                          if (ctns > 0) {
                            const coils = Math.round(ctns * cpc);
                            setOpenAddCoils(String(coils));
                            setOpenAddMtrs(String(coils * len));
                          } else {
                            setOpenAddCoils('');
                            setOpenAddMtrs('');
                          }
                        }}
                        placeholder="Enter Cartons (e.g. 20)"
                        className="w-full p-2.5 border-2 border-amber-400 rounded-lg font-black text-sm text-center bg-white text-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[10.5px] font-bold text-slate-700 uppercase mb-1">
                        Equivalent Cable Meters
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={openAddMtrs}
                        onChange={e => setOpenAddMtrs(e.target.value)}
                        placeholder="Calculated Meters"
                        className="w-full p-2 border border-emerald-300 rounded bg-emerald-50 text-emerald-950 font-black text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-[10.5px] font-bold text-slate-700 uppercase mb-1">
                        Total Weight in Kg (Optional)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={openAddKgs}
                        onChange={e => setOpenAddKgs(e.target.value)}
                        placeholder="e.g. 120.5 kg"
                        className="w-full p-2 border border-slate-300 rounded bg-white font-bold text-center"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STANDARD DRUM FINISHED GOOD INPUT */}
              {openAddCategory === 'FINISHED_DRUM' && (
                <div className="grid grid-cols-2 gap-3 bg-indigo-50/60 p-3 rounded-xl border border-indigo-200">
                  <div>
                    <label className="block text-[11px] font-bold text-indigo-950 uppercase mb-1">
                      Opening Length (Meters) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={openAddMtrs}
                      onChange={e => setOpenAddMtrs(e.target.value)}
                      placeholder="e.g. 2000"
                      className="w-full p-2.5 border-2 border-indigo-300 rounded-lg font-black text-slate-900 bg-white text-center"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-indigo-950 uppercase mb-1">
                      Net Cable Weight (KG)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={openAddKgs}
                      onChange={e => setOpenAddKgs(e.target.value)}
                      placeholder="e.g. 542.4"
                      className="w-full p-2.5 border border-slate-300 rounded-lg font-bold text-slate-900 bg-white text-center"
                    />
                  </div>
                </div>
              )}

              {/* COPPER BUNCH SIZE COPPER (KG & MTRS) */}
              {openAddCategory === 'BUNCHED_COPPER' && (
                <div className="grid grid-cols-2 gap-3 bg-amber-50/70 p-3 rounded-xl border border-amber-300">
                  <div>
                    <label className="block text-[11px] font-bold text-amber-950 uppercase mb-1">
                      Opening Weight (KG) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={openAddKgs}
                      onChange={e => setOpenAddKgs(e.target.value)}
                      placeholder="e.g. 500.0"
                      className="w-full p-2.5 border-2 border-amber-400 rounded-lg font-black text-slate-900 bg-white text-center"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-amber-950 uppercase mb-1">
                      Opening Core Length (Meters, Optional)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={openAddMtrs}
                      onChange={e => setOpenAddMtrs(e.target.value)}
                      placeholder="e.g. 15000"
                      className="w-full p-2.5 border border-slate-300 rounded-lg font-bold text-slate-900 bg-white text-center"
                    />
                  </div>
                </div>
              )}

              {/* RAW MATERIALS (COPPER & PVC COMPOUNDS) */}
              {(openAddCategory === 'RAW_COPPER' ||
                openAddCategory === 'INSULATION' ||
                openAddCategory === 'SHEATH') && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Opening Quantity (KG) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={openAddKgs}
                    onChange={e => setOpenAddKgs(e.target.value)}
                    placeholder="e.g. 1500"
                    className="w-full p-2.5 border-2 border-amber-400 rounded-lg font-black text-slate-900 bg-white text-center"
                    required
                  />
                </div>
              )}

              {/* DRUMS & PALLETS */}
              {(openAddCategory === 'DRUM' || openAddCategory === 'PALLET') && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                    Opening Quantity (NOS / Pieces) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={openAddDrums}
                    onChange={e => setOpenAddDrums(e.target.value)}
                    placeholder="e.g. 25"
                    className="w-full p-2.5 border-2 border-slate-300 rounded-lg font-black text-slate-900 bg-white text-center"
                    required
                  />
                </div>
              )}

              {/* CUSTOM ITEM */}
              {openAddCategory === 'CUSTOM' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                      Unit
                    </label>
                    <input
                      type="text"
                      value={openAddUnit}
                      onChange={e => setOpenAddUnit(e.target.value)}
                      placeholder="e.g. KGS, MTRS, NOS"
                      className="w-full p-2 border border-slate-300 rounded font-bold bg-white text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                      Opening Quantity *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={openAddMtrs}
                      onChange={e => setOpenAddMtrs(e.target.value)}
                      placeholder="0"
                      className="w-full p-2 border-2 border-blue-400 rounded font-black bg-white text-center"
                      required
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAddOpeningItemModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-black shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  🔒 Lock &amp; Save to Opening Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
