import React, { useState, useMemo, useEffect } from 'react';
import {
  CableOrder,
  ContainerLoadItem,
  ContainerPlan,
  ContainerType,
  DensitySettings,
  DispatchedContainerRecord,
  LadiDimensionRule,
  PackagingRule,
  SizePackagingRule,
} from '../types/cable';
import {
  computeRecordRow,
  evaluateSpoolSizeForOrder,
  exportCsvFile,
  parseSizeNum,
  resolveExactPalletAndBbnForSpool,
} from '../utils/calculations';
import {
  computeContainerStuffingPlan,
  getDefaultLoadableLengthFt,
  resolveContainerItemMaterialStatus,
  resolveContainerMaterialReadiness,
  resolveDrumsPerPallet,
} from '../utils/containerStuffing';
import type { StockLedgerResult } from '../utils/stockEngine';
import {
  ContainerPlanningSheetFormat,
  buildAutoPalletDetailsGrid,
} from './ContainerPlanningSheetFormat';
import {
  Ship,
  Plus,
  Trash2,
  Copy,
  Printer,
  FileSpreadsheet,
  Truck,
  PackagePlus,
  Search,
  CheckCircle2,
  AlertTriangle,
  Box,
  Scale,
  Anchor,
  Calendar,
  MapPin,
  History,
  FileText,
} from 'lucide-react';

interface TabContainerPlanningProps {
  containers: ContainerPlan[];
  dispatchedContainers?: DispatchedContainerRecord[];
  orders: CableOrder[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
  initialSelectedContainerId?: string;
  onUpdateContainers: (containers: ContainerPlan[]) => void;
  onUpdateDispatchedContainers?: (records: DispatchedContainerRecord[]) => void;
  onDispatchContainerOrders: (containerId: string, orderIds: number[], batches: string[]) => void;
  stockLedger?: StockLedgerResult;
}

const CONTAINER_SPECS: Record<
  ContainerType,
  { maxWeightKg: number; maxVolumeCbm: number; maxDrums: number; label: string }
> = {
  '20FT DRY': { maxWeightKg: 24000, maxVolumeCbm: 33.2, maxDrums: 20, label: '20ft Standard Dry (33.2 CBM / 24T)' },
  '40FT DRY': { maxWeightKg: 26500, maxVolumeCbm: 67.7, maxDrums: 40, label: '40ft Standard Dry (67.7 CBM / 26.5T)' },
  '40FT HC': { maxWeightKg: 26500, maxVolumeCbm: 76.4, maxDrums: 44, label: '40ft High Cube (76.4 CBM / 26.5T)' },
  '20FT OPEN TOP': { maxWeightKg: 24000, maxVolumeCbm: 32.5, maxDrums: 18, label: '20ft Open Top (32.5 CBM / 24T)' },
  CUSTOM: { maxWeightKg: 28000, maxVolumeCbm: 80.0, maxDrums: 50, label: 'Custom Container / Flat Rack' },
};

/**
 * Estimates CBM volume per drum from spool string like "42 x 12 x 20" (inches)
 */
function estimateDrumCbm(spoolStr: string, drumCount: number): number {
  const nums = (spoolStr || '').match(/\d+(\.\d+)?/g);
  if (nums && nums.length >= 3) {
    const flangeIn = parseFloat(nums[0]) || 36;
    const widthIn = parseFloat(nums[2]) || 20;
    // Convert inches to meters (1 in = 0.0254 m), include pallet clearance (+12%)
    const flangeM = flangeIn * 0.0254;
    const widthM = (widthIn + 4) * 0.0254;
    const singleCbm = flangeM * flangeM * widthM * 1.12;
    return Number((singleCbm * drumCount).toFixed(2));
  }
  return Number((0.45 * drumCount).toFixed(2));
}

export const TabContainerPlanning: React.FC<TabContainerPlanningProps> = ({
  containers,
  dispatchedContainers = [],
  orders,
  densities,
  ladiDimensions,
  sizeRules,
  packagingRules,
  initialSelectedContainerId,
  onUpdateContainers,
  onUpdateDispatchedContainers,
  onDispatchContainerOrders,
  stockLedger,
}) => {
  const [activeViewMode, setActiveViewMode] = useState<'PLANNING' | 'HISTORY'>('PLANNING');
  const [selectedContainerId, setSelectedContainerId] = useState<string>(
    initialSelectedContainerId || containers[0]?.id || ''
  );
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>(
    dispatchedContainers[0]?.id || ''
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [printScope, setPrintScope] = useState<'SINGLE' | 'ALL'>('SINGLE');
  const [printingHistoryRecord, setPrintingHistoryRecord] =
    useState<DispatchedContainerRecord | null>(null);

  useEffect(() => {
    if (initialSelectedContainerId && containers.some(c => c.id === initialSelectedContainerId)) {
      setSelectedContainerId(initialSelectedContainerId);
      setActiveViewMode('PLANNING');
    }
  }, [initialSelectedContainerId, containers]);

  useEffect(() => {
    if (!selectedHistoryId && dispatchedContainers.length > 0) {
      setSelectedHistoryId(dispatchedContainers[0].id);
    }
  }, [dispatchedContainers, selectedHistoryId]);

  const handlePrintIndividualContainer = (contId: string) => {
    setPrintingHistoryRecord(null);
    setSelectedContainerId(contId);
    setPrintScope('SINGLE');
    setTimeout(() => {
      window.print();
    }, 80);
  };

  const handlePrintDispatchedRecord = (rec: DispatchedContainerRecord) => {
    setPrintingHistoryRecord(rec);
    setTimeout(() => {
      window.print();
      setTimeout(() => setPrintingHistoryRecord(null), 500);
    }, 80);
  };

  // Modal to create new container
  const [isNewContainerModalOpen, setIsNewContainerModalOpen] = useState(false);
  const [newContNo, setNewContNo] = useState('');
  const [newContType, setNewContType] = useState<ContainerType>('40FT HC');
  const [newBookingNo, setNewBookingNo] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [newDestination, setNewDestination] = useState('');
  const [newShippingLine, setNewShippingLine] = useState('');
  const [newStuffingDate, setNewStuffingDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  // Modal to import orders/batches into active container
  const [isLoadOrderModalOpen, setIsLoadOrderModalOpen] = useState(false);
  const [importBatchFilter, setImportBatchFilter] = useState<string>('ALL');
  const [selectedOrderIdsToLoad, setSelectedOrderIdsToLoad] = useState<number[]>([]);
  const [showLegacyRawTable, setShowLegacyRawTable] = useState(false);

  // Active selected container
  const activeContainer = useMemo(() => {
    return (
      containers.find(c => c.id === selectedContainerId) ||
      containers[0] ||
      null
    );
  }, [containers, selectedContainerId]);

  // Filtered containers for database list
  const filteredContainers = useMemo(() => {
    return containers.filter(c => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const text = `${c.containerNo} ${c.bookingNo} ${c.sealNo} ${c.clientName} ${c.destination} ${c.shippingLine} ${c.vesselVoyage} ${c.notes}`.toLowerCase();
      const itemMatch = c.items.some(it =>
        `${it.batch} ${it.brandGrade} ${it.sizeCores} ${it.drumNo}`.toLowerCase().includes(q)
      );
      return text.includes(q) || itemMatch;
    });
  }, [containers, searchQuery, statusFilter]);

  // Compute totals for a container
  const computeContainerMetrics = (cont: ContainerPlan) => {
    let totalDrums = 0;
    let totalLength = 0;
    let totalNetWt = 0;
    let totalGrossWt = 0;
    let totalCbm = 0;

    cont.items.forEach(it => {
      totalDrums += Number(it.drumCount) || 0;
      totalLength += Number(it.totalLength) || 0;
      totalNetWt += Number(it.netCableWt) || 0;
      totalGrossWt += Number(it.grossWt) || 0;
      totalCbm += Number(it.volumeCbm) || 0;
    });

    const wtPct =
      cont.maxWeightKg > 0 ? Math.round((totalGrossWt / cont.maxWeightKg) * 100) : 0;
    const cbmPct =
      cont.maxVolumeCbm > 0 ? Math.round((totalCbm / cont.maxVolumeCbm) * 100) : 0;
    const drumPct =
      cont.maxDrums > 0 ? Math.round((totalDrums / cont.maxDrums) * 100) : 0;

    return {
      totalDrums,
      totalLength,
      totalNetWt,
      totalGrossWt,
      totalCbm,
      wtPct,
      cbmPct,
      drumPct,
      isOverweight: totalGrossWt > cont.maxWeightKg,
      isOverVolume: totalCbm > cont.maxVolumeCbm,
    };
  };

  // Update a field on the active container
  const handleUpdateContainerField = <K extends keyof ContainerPlan>(
    containerId: string,
    field: K,
    value: ContainerPlan[K]
  ) => {
    onUpdateContainers(
      containers.map(c => {
        if (c.id !== containerId) return c;
        if (field === 'containerType') {
          const nextType = value as ContainerType;
          const spec = CONTAINER_SPECS[nextType] || CONTAINER_SPECS['40FT HC'];
          return {
            ...c,
            containerType: nextType,
            maxWeightKg: spec.maxWeightKg,
            maxVolumeCbm: spec.maxVolumeCbm,
            maxDrums: spec.maxDrums,
            loadableLengthFt: getDefaultLoadableLengthFt(nextType),
            loadableWidthIn: c.loadableWidthIn || 90,
            loadableHeightIn: c.loadableHeightIn || 89,
          };
        }
        return { ...c, [field]: value };
      })
    );
  };

  const handleUpdateContainerDimensions = (
    containerId: string,
    updates: Partial<ContainerPlan>
  ) => {
    onUpdateContainers(
      containers.map(c => (c.id === containerId ? { ...c, ...updates } : c))
    );
  };

  const handleApplyAutoStowagePositions = (
    containerId: string,
    itemStowageMap: Record<string, string>
  ) => {
    onUpdateContainers(
      containers.map(c => {
        if (c.id !== containerId) return c;
        return {
          ...c,
          items: c.items.map(it => ({
            ...it,
            stowagePosition: itemStowageMap[it.id] || it.stowagePosition,
          })),
        };
      })
    );
  };

  // Create a new container in database
  const handleCreateContainer = (e: React.FormEvent) => {
    e.preventDefault();
    const spec = CONTAINER_SPECS[newContType];
    const nextNum = containers.length + 1;
    const newId = `CONT-${String(nextNum).padStart(3, '0')}-${Date.now().toString().slice(-3)}`;
    const newPlan: ContainerPlan = {
      id: newId,
      containerNo: newContNo.trim() || `TBC-CONT-${String(nextNum).padStart(2, '0')}`,
      containerType: newContType,
      bookingNo: newBookingNo.trim() || `BKG-${new Date().getFullYear()}-${100 + nextNum}`,
      sealNo: 'Pending',
      shippingLine: newShippingLine.trim() || 'TBA',
      vesselVoyage: 'TBA',
      portOfLoading: 'Mundra / Nhava Sheva',
      destination: newDestination.trim() || 'Client Port',
      clientName: newClientName.trim() || 'Direct Export Client',
      plannedStuffingDate: newStuffingDate,
      etd: newStuffingDate,
      maxWeightKg: spec.maxWeightKg,
      maxVolumeCbm: spec.maxVolumeCbm,
      maxDrums: spec.maxDrums,
      status: 'Planning',
      notes: 'Standard export palletization & lashing.',
      items: [],
    };
    onUpdateContainers([...containers, newPlan]);
    setSelectedContainerId(newId);
    setIsNewContainerModalOpen(false);
    setNewContNo('');
    setNewBookingNo('');
    setNewClientName('');
    setNewDestination('');
    setNewShippingLine('');
  };

  // Duplicate container
  const handleDuplicateContainer = (cont: ContainerPlan) => {
    const newId = `CONT-COPY-${Date.now().toString().slice(-4)}`;
    const copy: ContainerPlan = {
      ...JSON.parse(JSON.stringify(cont)),
      id: newId,
      containerNo: `${cont.containerNo}-COPY`,
      status: 'Planning',
    };
    onUpdateContainers([...containers, copy]);
    setSelectedContainerId(newId);
  };

  // Delete container
  const handleDeleteContainer = (containerId: string) => {
    const remaining = containers.filter(c => c.id !== containerId);
    onUpdateContainers(remaining);
    if (selectedContainerId === containerId) {
      setSelectedContainerId(remaining[0]?.id || '');
    }
  };

  // Add manual empty cargo row to active container
  const handleAddManualLoadRow = () => {
    if (!activeContainer) return;
    const newItem: ContainerLoadItem = {
      id: `ITEM-${Date.now()}`,
      batch: 'JOB NO 24',
      brandGrade: 'MYBCAB H07RN-F',
      sizeCores: '3C × 2.50 SQ MM',
      spool: '28 X 12 X 15',
      drumNo: `DRUM-${activeContainer.items.length + 1}`,
      drumCount: 4,
      drumsPerPallet: 4,
      lengthPerDrum: 1000,
      totalLength: 4000,
      netCableWt: 450,
      grossWt: 550,
      volumeCbm: 1.8,
      palletSize: '30X30x6',
      stowagePosition: `Row ${activeContainer.items.length + 1}`,
      remarks: 'Manual Entry',
    };
    const nextItems = [...activeContainer.items, newItem];
    const tempPlan = computeContainerStuffingPlan(
      { ...activeContainer, items: nextItems },
      packagingRules
    );
    const syncedItems = nextItems.map(it => ({
      ...it,
      stowagePosition: tempPlan.itemStowageMap[it.id] || it.stowagePosition,
    }));
    handleUpdateContainerField(activeContainer.id, 'items', syncedItems);
  };

  // Update a specific load item field inside the active container
  const handleUpdateLoadItem = (
    itemId: string,
    field: keyof ContainerLoadItem,
    value: string | number
  ) => {
    if (!activeContainer) return;
    const updatedItems = activeContainer.items.map(it => {
      if (it.id !== itemId) return it;
      const copy = { ...it, [field]: value };
      if (field === 'spool') {
        const resolved = resolveExactPalletAndBbnForSpool(
          String(value || ''),
          packagingRules
        );
        copy.palletSize = resolved.pallet || copy.palletSize;
        copy.drumsPerPallet = resolved.bbnPerPallet || copy.drumsPerPallet;
        copy.volumeCbm = estimateDrumCbm(String(value), Number(copy.drumCount) || 1);
      }
      if (field === 'drumCount' || field === 'lengthPerDrum') {
        const dc = Number(field === 'drumCount' ? value : copy.drumCount) || 0;
        const lpd = Number(field === 'lengthPerDrum' ? value : copy.lengthPerDrum) || 0;
        copy.totalLength = dc * lpd;
        copy.volumeCbm = estimateDrumCbm(copy.spool, dc);
      }
      if (field === 'totalLength') {
        const nextLen = Math.max(0, Number(value) || 0);
        copy.totalLength = nextLen;
        const dc = Math.max(1, Number(copy.drumCount) || 1);
        copy.lengthPerDrum = Math.round(nextLen / dc);
        // Proportionally update netCableWt & grossWt if linked to an Order Sheet row
        const matchedOrder =
          copy.orderId !== undefined
            ? orders.find(o => o.id === copy.orderId)
            : undefined;
        if (matchedOrder) {
          const r = computeRecordRow(matchedOrder, densities, ladiDimensions);
          const fullNetWt = r.reqCu + r.reqIns + r.reqSheath;
          const ratio = r.orderLen > 0 ? nextLen / r.orderLen : 1;
          copy.netCableWt = Number((fullNetWt * ratio).toFixed(2));
          const tarePerDrum =
            matchedOrder.tare_weight !== undefined
              ? Number(matchedOrder.tare_weight) || 25
              : 25;
          copy.grossWt = Number((copy.netCableWt + dc * tarePerDrum).toFixed(2));
        }
      }
      return copy;
    });
    const tempPlan = computeContainerStuffingPlan(
      { ...activeContainer, items: updatedItems },
      packagingRules
    );
    const syncedItems = updatedItems.map(it => ({
      ...it,
      stowagePosition: tempPlan.itemStowageMap[it.id] || it.stowagePosition,
    }));
    handleUpdateContainerField(activeContainer.id, 'items', syncedItems);
  };

  const handleDeleteLoadItem = (itemId: string) => {
    if (!activeContainer) return;
    handleUpdateContainerField(
      activeContainer.id,
      'items',
      activeContainer.items.filter(it => it.id !== itemId)
    );
  };

  // Add a single order directly from the Order Sheet picker inside the 3-Block Container Planning Sheet
  const handleAddSingleOrderFromSheet = (
    orderId: number,
    customLength?: number,
    customDrums?: number
  ) => {
    if (!activeContainer) return;
    const o = orders.find(x => x.id === orderId);
    if (!o) return;
    const r = computeRecordRow(o, densities, ladiDimensions);
    const plannedLen =
      customLength !== undefined && customLength > 0 ? customLength : r.orderLen;
    const isIs694 = (o.grade || '').toUpperCase().includes('IS-694');
    const hasCoils = o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0;
    const isCoilOrCarton = isIs694 || hasCoils;
    const evalPkg = evaluateSpoolSizeForOrder(
      r.finalDia,
      plannedLen,
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
    const pkgText = evalPkg.packaging || '1000m / Drum';
    const mLenMatch = pkgText.match(/[0-9]+/);
    const drumLen = mLenMatch ? parseFloat(mLenMatch[0]) : 1000;
    const drumCount =
      customDrums !== undefined && customDrums > 0
        ? customDrums
        : isCoilOrCarton
        ? (Number(o.carton_count) || Number(o.coils) || 1)
        : drumLen > 0
        ? Math.max(1, Math.ceil(plannedLen / drumLen))
        : 1;
    const lengthPerDrum =
      drumCount > 0 ? Math.round(plannedLen / drumCount) : plannedLen;

    const fullNetWt = r.reqCu + r.reqIns + r.reqSheath;
    const ratio = r.orderLen > 0 ? plannedLen / r.orderLen : 1;
    const netCableWt = Number((fullNetWt * ratio).toFixed(2));
    const tarePerDrum = o.tare_weight !== undefined ? Number(o.tare_weight) || 25 : 25;
    const grossWt = Number((netCableWt + drumCount * tarePerDrum).toFixed(2));
    const spoolVal = isCoilOrCarton
      ? (isIs694 ? 'N/A (Carton Pack)' : 'N/A (Coils Pack)')
      : (o.spool_size || evalPkg.spool || '28 X 12 X 15');
    const palletVal = evalPkg.pallet || (isCoilOrCarton ? 'N/A (Coils/Cartons)' : '30X30x6');
    const volumeCbm = estimateDrumCbm(spoolVal, drumCount);

    const resolvedBbn = resolveDrumsPerPallet(
      {
        id: '',
        batch: o.batch,
        brandGrade: '',
        sizeCores: '',
        spool: spoolVal,
        drumNo: '',
        drumCount,
        lengthPerDrum,
        totalLength: plannedLen,
        netCableWt,
        grossWt,
        volumeCbm,
        palletSize: palletVal,
        stowagePosition: '',
        remarks: '',
      },
      packagingRules
    );

    const newItem: ContainerLoadItem = {
      id: `ORD-${o.id}-${Date.now()}`,
      orderId: o.id,
      batch: o.batch,
      brandGrade: `${o.brand} ${o.grade || 'H07RN-F'}`,
      sizeCores: `${o.cores}C × ${o.size}`,
      spool: spoolVal,
      drumNo: `${o.batch}-${o.brand}-${parseSizeNum(o.size).toFixed(2)}-D1..D${drumCount}`,
      drumCount,
      drumsPerPallet: resolvedBbn,
      lengthPerDrum,
      totalLength: plannedLen,
      netCableWt,
      grossWt,
      volumeCbm,
      palletSize: palletVal,
      stowagePosition: `Section ${activeContainer.items.length + 1}`,
      remarks: o.sheath_colour ? `${o.sheath_colour} Sheath` : 'Planned from Order Sheet',
    };

    const combinedItems = [...activeContainer.items, newItem];
    const autoPlan = computeContainerStuffingPlan(
      { ...activeContainer, items: combinedItems },
      packagingRules
    );
    const itemsWithAutoRows = combinedItems.map(it => ({
      ...it,
      stowagePosition: autoPlan.itemStowageMap[it.id] || it.stowagePosition,
    }));

    handleUpdateContainerField(activeContainer.id, 'items', itemsWithAutoRows);
  };

  // Load selected orders from Order Sheet into active container
  const handleConfirmLoadOrders = () => {
    if (!activeContainer || selectedOrderIdsToLoad.length === 0) return;

    const newLoadItems: ContainerLoadItem[] = [];
    selectedOrderIdsToLoad.forEach((orderId, idx) => {
      const o = orders.find(x => x.id === orderId);
      if (!o) return;
      const r = computeRecordRow(o, densities, ladiDimensions);
      const evalPkg = evaluateSpoolSizeForOrder(
        r.finalDia,
        r.orderLen,
        r.size,
        r.cores,
        r.grade,
        sizeRules,
        packagingRules,
        o.spool_size
      );
      const pkgText = evalPkg.packaging || '1000m / Drum';
      const mLenMatch = pkgText.match(/[0-9]+/);
      const drumLen = mLenMatch ? parseFloat(mLenMatch[0]) : 1000;
      const drumCount = drumLen > 0 ? Math.max(1, Math.ceil(r.orderLen / drumLen)) : 1;
      const lengthPerDrum = drumCount > 0 ? Math.round(r.orderLen / drumCount) : r.orderLen;

      const netCableWt = Number((r.reqCu + r.reqIns + r.reqSheath).toFixed(2));
      const tarePerDrum = o.tare_weight !== undefined ? Number(o.tare_weight) || 25 : 25;
      const grossWt = Number((netCableWt + drumCount * tarePerDrum).toFixed(2));
      const volumeCbm = estimateDrumCbm(evalPkg.spool, drumCount);

      const spoolVal = evalPkg.spool || '28 X 12 X 15';
      const palletVal = evalPkg.pallet || '30X30x6';
      const resolvedBbn = resolveDrumsPerPallet(
        {
          id: '',
          batch: o.batch,
          brandGrade: '',
          sizeCores: '',
          spool: spoolVal,
          drumNo: '',
          drumCount,
          lengthPerDrum,
          totalLength: r.orderLen,
          netCableWt,
          grossWt,
          volumeCbm,
          palletSize: palletVal,
          stowagePosition: '',
          remarks: '',
        },
        packagingRules
      );

      newLoadItems.push({
        id: `ORD-${o.id}-${Date.now()}-${idx}`,
        orderId: o.id,
        batch: o.batch,
        brandGrade: `${o.brand} ${o.grade || 'H07RN-F'}`,
        sizeCores: `${o.cores}C × ${o.size}`,
        spool: spoolVal,
        drumNo: `${o.batch}-${o.brand}-${parseSizeNum(o.size).toFixed(2)}-D1..D${drumCount}`,
        drumCount,
        drumsPerPallet: resolvedBbn,
        lengthPerDrum,
        totalLength: r.orderLen,
        netCableWt,
        grossWt,
        volumeCbm,
        palletSize: palletVal,
        stowagePosition: `Section ${activeContainer.items.length + idx + 1}`,
        remarks: o.sheath_colour ? `${o.sheath_colour} Sheath` : 'Standard Export',
      });
    });

    const combinedItems = [...activeContainer.items, ...newLoadItems];
    const autoPlan = computeContainerStuffingPlan(
      { ...activeContainer, items: combinedItems },
      packagingRules
    );
    const itemsWithAutoRows = combinedItems.map(it => ({
      ...it,
      stowagePosition: autoPlan.itemStowageMap[it.id] || it.stowagePosition,
    }));

    handleUpdateContainerField(activeContainer.id, 'items', itemsWithAutoRows);
    setSelectedOrderIdsToLoad([]);
    setIsLoadOrderModalOpen(false);
  };

  const buildDispatchedRecordFromContainer = (
    cont: ContainerPlan,
    dispatchedAt: string
  ): DispatchedContainerRecord => {
    const m = computeContainerMetrics(cont);
    const totalPalletWt =
      cont.customPalletWeightKg !== undefined
        ? cont.customPalletWeightKg
        : Math.round(m.totalDrums * 6.8);
    const totalDrumsWt =
      cont.customDrumsWeightKg !== undefined
        ? cont.customDrumsWeightKg
        : Math.max(0, Math.round(m.totalGrossWt - m.totalNetWt - totalPalletWt));
    const totalGrossWt =
      cont.customPalletWeightKg !== undefined || cont.customDrumsWeightKg !== undefined
        ? Math.round(m.totalNetWt + totalPalletWt + totalDrumsWt)
        : m.totalGrossWt;

    return {
      id: `DISP-${cont.id}`,
      containerId: cont.id,
      containerNo: cont.containerNo,
      containerType: cont.containerType,
      planningSheetTitle:
        cont.planningSheetTitle ||
        `${cont.containerType.replace(' DRY', '')} COINTANER PLANNING (${cont.containerNo})`,
      bookingNo: cont.bookingNo,
      sealNo: cont.sealNo,
      shippingLine: cont.shippingLine,
      vesselVoyage: cont.vesselVoyage,
      portOfLoading: cont.portOfLoading,
      destination: cont.destination,
      clientName: cont.clientName,
      plannedStuffingDate: cont.plannedStuffingDate,
      dispatchedAt,
      etd: cont.etd,
      totalDrums: m.totalDrums,
      totalLength: m.totalLength,
      totalNetWt: m.totalNetWt,
      totalGrossWt,
      totalPalletWt,
      totalDrumsWt,
      totalCbm: m.totalCbm,
      customTotalLengthInch: cont.customTotalLengthInch,
      customPalletCells: cont.customPalletCells,
      notes: cont.notes,
      items: cont.items.map(it => ({
        ...it,
        dispatchedAt: it.dispatchedAt || dispatchedAt,
      })),
    };
  };

  const archiveContainerToDispatchHistory = (cont: ContainerPlan, dispatchedAt: string) => {
    if (!onUpdateDispatchedContainers) return;
    const record = buildDispatchedRecordFromContainer(cont, dispatchedAt);
    const existsIdx = dispatchedContainers.findIndex(
      r => r.containerId === cont.id || r.containerNo === cont.containerNo
    );
    if (existsIdx > -1) {
      const next = [...dispatchedContainers];
      next[existsIdx] = { ...record, id: next[existsIdx].id };
      onUpdateDispatchedContainers(next);
      setSelectedHistoryId(next[existsIdx].id);
    } else {
      onUpdateDispatchedContainers([record, ...dispatchedContainers]);
      setSelectedHistoryId(record.id);
    }
  };

  // Toggle yellow highlight on a container item row
  const handleToggleHighlightItem = (itemId: string) => {
    if (!activeContainer) return;
    const updatedItems = activeContainer.items.map(it =>
      it.id === itemId ? { ...it, isHighlighted: !it.isHighlighted } : it
    );
    handleUpdateContainerField(activeContainer.id, 'items', updatedItems);
  };

  // Dispatch Container & Auto-Deduct Finished Stock + Save to Dispatched Details Container-wise History
  const handleDispatchContainer = (cont: ContainerPlan) => {
    const nowIso = new Date().toISOString();
    const orderIds = cont.items
      .map(it => it.orderId)
      .filter((id): id is number => id !== undefined);
    const batches = Array.from(new Set(cont.items.map(it => it.batch).filter(Boolean)));

    // Update container status & dispatchedAt timestamp
    const updatedCont: ContainerPlan = {
      ...cont,
      status: 'Dispatched / Shipped',
      dispatchedAt: nowIso,
      items: cont.items.map(it => ({ ...it, dispatchedAt: nowIso })),
    };
    onUpdateContainers(
      containers.map(c => (c.id === cont.id ? updatedCont : c))
    );

    // Store in Dispatched Details (Container-wise History Archive)
    archiveContainerToDispatchHistory(updatedCont, nowIso);

    // Trigger order/finished stock deduction in parent App
    onDispatchContainerOrders(cont.id, orderIds, batches);
  };

  // Export CSV of Dispatched Container History
  const handleExportDispatchedHistoryCSV = () => {
    const rows: (string | number)[][] = [
      [
        'History ID',
        'Container No',
        'Container Type',
        'Planning Title',
        'Dispatched At',
        'Stuffing Date',
        'Client / Consignee',
        'Destination',
        'Booking No',
        'Seal No',
        'Batch / Job',
        'Brand & Grade',
        'Cable Size',
        'Drum Size',
        'No of Drums',
        'Length (m)',
        'Net Wt (kg)',
        'Gross Wt (kg)',
        'Pallet Size',
        'Stowage Position',
      ],
    ];

    dispatchedContainers.forEach(rec => {
      rec.items.forEach(it => {
        rows.push([
          rec.id,
          rec.containerNo,
          rec.containerType,
          rec.planningSheetTitle || '',
          rec.dispatchedAt,
          rec.plannedStuffingDate,
          rec.clientName,
          rec.destination,
          rec.bookingNo,
          rec.sealNo,
          it.batch,
          it.brandGrade,
          it.sizeCores,
          it.spool,
          it.drumCount,
          it.totalLength,
          it.netCableWt,
          it.grossWt,
          it.palletSize,
          it.stowagePosition,
        ]);
      });
    });

    exportCsvFile('PLUTUS_Dispatched_Containers_History.csv', rows);
  };

  // Export CSV of all containers & their stuffing items
  const handleExportContainerCSV = () => {
    const rows: (string | number)[][] = [
      [
        'Container ID',
        'Container No',
        'Type',
        'Status',
        'Booking No',
        'Seal No',
        'Shipping Line',
        'Vessel / Voyage',
        'Client',
        'Destination',
        'Stuffing Date',
        'Batch / Job No',
        'Brand & Grade',
        'Cable Size & Cores',
        'Drum Size',
        'Drum Serials',
        'Drum Count',
        'Total Length (m)',
        'Net Cable Wt (kg)',
        'Gross Wt (kg)',
        'Volume (CBM)',
        'Pallet Size',
        'Stowage Position',
        'Remarks',
      ],
    ];

    containers.forEach(c => {
      if (c.items.length === 0) {
        rows.push([
          c.id,
          c.containerNo,
          c.containerType,
          c.status,
          c.bookingNo,
          c.sealNo,
          c.shippingLine,
          c.vesselVoyage,
          c.clientName,
          c.destination,
          c.plannedStuffingDate,
          '-',
          '-',
          '-',
          '-',
          '-',
          0,
          0,
          0,
          0,
          0,
          '-',
          '-',
          c.notes,
        ]);
      } else {
        c.items.forEach(it => {
          rows.push([
            c.id,
            c.containerNo,
            c.containerType,
            c.status,
            c.bookingNo,
            c.sealNo,
            c.shippingLine,
            c.vesselVoyage,
            c.clientName,
            c.destination,
            c.plannedStuffingDate,
            it.batch,
            it.brandGrade,
            it.sizeCores,
            it.spool,
            it.drumNo,
            it.drumCount,
            it.totalLength,
            it.netCableWt.toFixed(2),
            it.grossWt.toFixed(2),
            it.volumeCbm.toFixed(2),
            it.palletSize,
            it.stowagePosition,
            it.remarks,
          ]);
        });
      }
    });

    exportCsvFile('PLUTUS_Container_Planning_Database.csv', rows);
  };

  const uniqueBatches = Array.from(new Set(orders.map(o => o.batch))).sort();
  const modalFilteredOrders = orders.filter(
    o => importBatchFilter === 'ALL' || o.batch === importBatchFilter
  );

  const filteredHistoryRecords = useMemo(() => {
    if (!historySearchQuery.trim()) return dispatchedContainers;
    const q = historySearchQuery.toLowerCase();
    return dispatchedContainers.filter(rec => {
      const headerText = `${rec.containerNo} ${rec.containerType} ${rec.bookingNo} ${rec.sealNo} ${rec.clientName} ${rec.destination} ${rec.planningSheetTitle || ''}`.toLowerCase();
      const itemMatch = rec.items.some(it =>
        `${it.batch} ${it.brandGrade} ${it.sizeCores} ${it.spool} ${it.drumNo}`.toLowerCase().includes(q)
      );
      return headerText.includes(q) || itemMatch;
    });
  }, [dispatchedContainers, historySearchQuery]);

  const activeHistoryRecord = useMemo(() => {
    return (
      filteredHistoryRecords.find(r => r.id === selectedHistoryId) ||
      filteredHistoryRecords[0] ||
      null
    );
  }, [filteredHistoryRecords, selectedHistoryId]);

  const activeMetrics = activeContainer ? computeContainerMetrics(activeContainer) : null;
  const containersToPrint =
    printScope === 'ALL'
      ? filteredContainers
      : activeContainer
      ? [activeContainer]
      : [];

  return (
    <div className="space-y-4">
      {/* Top Mode Switcher: Active Container Planning vs Dispatched Details (Container-wise History) */}
      <div className="bg-slate-900 text-white rounded-xl p-3 shadow-sm flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveViewMode('PLANNING')}
            className={`text-xs font-extrabold px-3.5 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              activeViewMode === 'PLANNING'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <Ship className="w-4 h-4" />
            <span>📋 Active Container Planning &amp; 3-Block Sheet</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/20 text-white">
              {containers.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveViewMode('HISTORY')}
            className={`text-xs font-extrabold px-3.5 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              activeViewMode === 'HISTORY'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <History className="w-4 h-4" />
            <span>🕓 Dispatched Details — Container-wise History</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/20 text-white">
              {dispatchedContainers.length} Dispatched
            </span>
          </button>
        </div>

        <div className="text-[11px] text-slate-300 font-medium">
          {activeViewMode === 'PLANNING'
            ? 'Every container plan includes the 3-Block Container Planning Sheet (Drum Size, Total Drums & Pallets Details).'
            : 'Permanent container-wise archive of all dispatched containers & items for future historical review.'}
        </div>
      </div>

      {/* Top Header & Database Controls (Hidden during print so only individual container prints) */}
      {activeViewMode === 'PLANNING' && (
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs no-print">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-100">
              <Ship className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>🚢 Personal Container Planning &amp; Stuffing Database</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
                  {containers.length} Containers Saved
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Personally plan container loads, drum stowage, CBM &amp; payload limits, print individual container manifests, and dispatch to auto-deduct finished stock
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap no-print">
            <div className="relative">
              <input
                type="text"
                placeholder="Search Container, Booking, Client..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="text-xs pl-7 pr-2.5 py-1.5 border border-slate-300 rounded-lg w-52 bg-white"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            </div>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg font-semibold bg-white"
            >
              <option value="ALL">All Statuses</option>
              <option value="Planning">Planning</option>
              <option value="Loading / Stuffing">Loading / Stuffing</option>
              <option value="Sealed & Ready">Sealed &amp; Ready</option>
              <option value="Dispatched / Shipped">Dispatched / Shipped</option>
            </select>

            <button
              type="button"
              onClick={() => setIsNewContainerModalOpen(true)}
              className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" /> + New Container Plan
            </button>

            <button
              type="button"
              onClick={handleExportContainerCSV}
              className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-semibold flex items-center gap-1"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" /> Export Database CSV
            </button>

            <button
              type="button"
              onClick={() =>
                setPrintScope(prev => (prev === 'SINGLE' ? 'ALL' : 'SINGLE'))
              }
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-bold transition-colors ${
                printScope === 'SINGLE'
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
              title="Choose whether Print outputs only the selected individual container or all containers on separate pages"
            >
              {printScope === 'SINGLE'
                ? '📄 Print Mode: Individual Container Only'
                : `📚 Print Mode: All Containers (${filteredContainers.length} Pages)`}
            </button>

            {activeContainer && (
              <button
                type="button"
                onClick={() => handlePrintIndividualContainer(activeContainer.id)}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-2xs"
                title={`Print Individual Container Sheet for ${activeContainer.containerNo}`}
              >
                <Printer className="w-3.5 h-3.5" /> Print {activeContainer.containerNo}
              </button>
            )}
          </div>
        </div>

        {/* Container Master Database Table */}
        <div className="mt-3 overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] border-b border-slate-200">
              <tr>
                <th className="p-2 border-r border-slate-200">Container No</th>
                <th className="p-2 border-r border-slate-200">Size / Type</th>
                <th className="p-2 border-r border-slate-200">Booking / Seal No</th>
                <th className="p-2 border-r border-slate-200">Client & Destination</th>
                <th className="p-2 border-r border-slate-200">Vessel / ETD</th>
                <th className="p-2 border-r border-slate-200 text-center">Drums Loaded</th>
                <th className="p-2 border-r border-slate-200 text-right">Gross Wt / Limit</th>
                <th className="p-2 border-r border-slate-200 text-right">Volume CBM</th>
                <th className="p-2 border-r border-slate-200 text-center">Status</th>
                <th className="p-2 text-center no-print">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredContainers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-400">
                    No containers match your filter. Click &ldquo;+ New Container Plan&rdquo; to add one.
                  </td>
                </tr>
              ) : (
                filteredContainers.map(cont => {
                  const m = computeContainerMetrics(cont);
                  const isSelected = activeContainer?.id === cont.id;
                  const statusBadge =
                    cont.status === 'Dispatched / Shipped'
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                      : cont.status === 'Sealed & Ready'
                      ? 'bg-blue-100 text-blue-800 border-blue-200'
                      : cont.status === 'Loading / Stuffing'
                      ? 'bg-amber-100 text-amber-800 border-amber-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200';

                  return (
                    <tr
                      key={cont.id}
                      onClick={() => setSelectedContainerId(cont.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-indigo-50/70 font-semibold'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="p-2 border-r border-slate-100 font-mono font-bold text-indigo-950 flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isSelected ? 'bg-indigo-600' : 'bg-slate-300'
                          }`}
                        />
                        {cont.containerNo}
                      </td>
                      <td className="p-2 border-r border-slate-100">
                        <span className="px-2 py-0.5 rounded bg-slate-200/80 text-slate-800 font-bold text-[10px]">
                          {cont.containerType}
                        </span>
                      </td>
                      <td className="p-2 border-r border-slate-100">
                        <div className="font-bold text-slate-800">{cont.bookingNo}</div>
                        <div className="text-[10px] text-slate-500">Seal: {cont.sealNo}</div>
                      </td>
                      <td className="p-2 border-r border-slate-100">
                        <div className="font-bold text-slate-800">{cont.clientName}</div>
                        <div className="text-[10px] text-slate-500">{cont.destination}</div>
                      </td>
                      <td className="p-2 border-r border-slate-100">
                        <div className="text-slate-800">{cont.vesselVoyage}</div>
                        <div className="text-[10px] text-slate-500">ETD: {cont.etd}</div>
                      </td>
                      <td className="p-2 border-r border-slate-100 text-center">
                        <span className="font-black text-slate-900">{m.totalDrums}</span>
                        <span className="text-[10px] text-slate-400"> / {cont.maxDrums}</span>
                      </td>
                      <td className="p-2 border-r border-slate-100 text-right">
                        <div
                          className={`font-black ${
                            m.isOverweight ? 'text-red-600' : 'text-slate-900'
                          }`}
                        >
                          {m.totalGrossWt.toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                          })}{' '}
                          kg
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {m.wtPct}% of {cont.maxWeightKg.toLocaleString()} kg
                        </div>
                      </td>
                      <td className="p-2 border-r border-slate-100 text-right">
                        <div
                          className={`font-black ${
                            m.isOverVolume ? 'text-red-600' : 'text-indigo-700'
                          }`}
                        >
                          {m.totalCbm.toFixed(2)} CBM
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {m.cbmPct}% of {cont.maxVolumeCbm} CBM
                        </div>
                      </td>
                      <td className="p-2 border-r border-slate-100 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadge}`}
                        >
                          {cont.status}
                        </span>
                      </td>
                      <td
                        className="p-2 text-center no-print"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handlePrintIndividualContainer(cont.id)}
                            className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-bold flex items-center gap-1 shadow-2xs"
                            title={`Print Individual Container Manifest for ${cont.containerNo}`}
                          >
                            <Printer className="w-3 h-3" /> Print
                          </button>
                          {cont.status !== 'Dispatched / Shipped' && (
                            <button
                              type="button"
                              onClick={() => handleDispatchContainer(cont)}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold flex items-center gap-1 shadow-2xs"
                              title="Dispatch Container & Auto-Deduct Finished Stock"
                            >
                              <Truck className="w-3 h-3" /> Dispatch
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDuplicateContainer(cont)}
                            className="p-1 text-slate-600 hover:bg-slate-200 rounded"
                            title="Duplicate Container Plan"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteContainer(cont.id)}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                            title="Delete Container Plan"
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
      )}

      {/* Selected Container Personal Editor & Drum Stuffing Manifest (Interactive Screen View) */}
      {activeViewMode === 'PLANNING' && activeContainer && activeMetrics && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-4 no-print">
          {/* Container Details Editor Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-600 text-white">
                  Active Container Workspace
                </span>
                <h3 className="text-base font-black text-slate-900 font-mono">
                  {activeContainer.containerNo}
                </h3>
                <span className="text-xs font-bold text-slate-500">
                  ({activeContainer.containerType})
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Edit any field below to personally customize container booking details, capacity limits, and drum loading rows.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap no-print">
              <button
                type="button"
                onClick={() => handlePrintIndividualContainer(activeContainer.id)}
                className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-2xs"
                title={`Print Individual Container Manifest for ${activeContainer.containerNo}`}
              >
                <Printer className="w-3.5 h-3.5" /> Print This Container Sheet
              </button>

              <button
                type="button"
                onClick={() => setIsLoadOrderModalOpen(true)}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-2xs"
              >
                <PackagePlus className="w-3.5 h-3.5" /> Load Drums from Orders
              </button>

              <button
                type="button"
                onClick={handleAddManualLoadRow}
                className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add Custom Cargo Row
              </button>

              {activeContainer.items.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    handleUpdateContainerDimensions(activeContainer.id, {
                      items: [],
                      customPalletCells: undefined,
                    });
                  }}
                  className="text-xs px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  title="Clear all drums and cargo items from this container"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear All Cargo Data
                </button>
              )}

              {activeContainer.status !== 'Dispatched / Shipped' && (
                <button
                  type="button"
                  onClick={() => handleDispatchContainer(activeContainer)}
                  className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-2xs"
                >
                  <Truck className="w-3.5 h-3.5" /> Dispatch Container &amp; Deduct Stock
                </button>
              )}
            </div>
          </div>

          {/* Editable Container Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                Container Number
              </label>
              <input
                type="text"
                value={activeContainer.containerNo}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'containerNo',
                    e.target.value
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                Container Type
              </label>
              <select
                value={activeContainer.containerType}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'containerType',
                    e.target.value as ContainerType
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-bold text-slate-900"
              >
                <option value="20FT DRY">20FT DRY</option>
                <option value="40FT DRY">40FT DRY</option>
                <option value="40FT HC">40FT HC</option>
                <option value="20FT OPEN TOP">20FT OPEN TOP</option>
                <option value="CUSTOM">CUSTOM</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                Booking / BL No
              </label>
              <input
                type="text"
                value={activeContainer.bookingNo}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'bookingNo',
                    e.target.value
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-semibold"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                Custom / Line Seal No
              </label>
              <input
                type="text"
                value={activeContainer.sealNo}
                onChange={e =>
                  handleUpdateContainerField(activeContainer.id, 'sealNo', e.target.value)
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-semibold"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                Client / Consignee
              </label>
              <input
                type="text"
                value={activeContainer.clientName}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'clientName',
                    e.target.value
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-semibold"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                Status
              </label>
              <select
                value={activeContainer.status}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'status',
                    e.target.value as ContainerPlan['status']
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-bold text-indigo-900"
              >
                <option value="Planning">Planning</option>
                <option value="Loading / Stuffing">Loading / Stuffing</option>
                <option value="Sealed & Ready">Sealed & Ready</option>
                <option value="Dispatched / Shipped">Dispatched / Shipped</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5 flex items-center gap-1">
                <Anchor className="w-3 h-3 text-slate-400" /> Shipping Line
              </label>
              <input
                type="text"
                value={activeContainer.shippingLine}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'shippingLine',
                    e.target.value
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                Vessel & Voyage
              </label>
              <input
                type="text"
                value={activeContainer.vesselVoyage}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'vesselVoyage',
                    e.target.value
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3 text-slate-400" /> Destination Port
              </label>
              <input
                type="text"
                value={activeContainer.destination}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'destination',
                    e.target.value
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-slate-400" /> Stuffing Date
              </label>
              <input
                type="date"
                value={activeContainer.plannedStuffingDate}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'plannedStuffingDate',
                    e.target.value
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                Max Payload (kg)
              </label>
              <input
                type="number"
                value={activeContainer.maxWeightKg}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'maxWeightKg',
                    parseFloat(e.target.value) || 0
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-bold"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                Max Volume (CBM)
              </label>
              <input
                type="number"
                step="0.1"
                value={activeContainer.maxVolumeCbm}
                onChange={e =>
                  handleUpdateContainerField(
                    activeContainer.id,
                    'maxVolumeCbm',
                    parseFloat(e.target.value) || 0
                  )
                }
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded font-bold"
              />
            </div>
          </div>

          {/* Capacity, Utilization & Material Readiness Gauges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Weight Gauge */}
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 flex items-center gap-1.5">
                  <Scale className="w-4 h-4 text-blue-600" /> Gross Payload Weight
                </span>
                <span
                  className={`font-black ${
                    activeMetrics.isOverweight ? 'text-red-600' : 'text-slate-900'
                  }`}
                >
                  {activeMetrics.totalGrossWt.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}{' '}
                  / {activeContainer.maxWeightKg.toLocaleString()} kg ({activeMetrics.wtPct}%)
                </span>
              </div>
              <div className="mt-2 w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    activeMetrics.isOverweight
                      ? 'bg-red-600'
                      : activeMetrics.wtPct > 85
                      ? 'bg-amber-500'
                      : 'bg-blue-600'
                  }`}
                  style={{ width: `${Math.min(100, activeMetrics.wtPct)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                <span>Net Cable: {activeMetrics.totalNetWt.toFixed(1)} kg</span>
                <span>
                  Remaining Capacity:{' '}
                  {Math.max(
                    0,
                    activeContainer.maxWeightKg - activeMetrics.totalGrossWt
                  ).toFixed(1)}{' '}
                  kg
                </span>
              </div>
            </div>

            {/* Volume CBM Gauge */}
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 flex items-center gap-1.5">
                  <Box className="w-4 h-4 text-indigo-600" /> Space / Volume (CBM)
                </span>
                <span
                  className={`font-black ${
                    activeMetrics.isOverVolume ? 'text-red-600' : 'text-indigo-900'
                  }`}
                >
                  {activeMetrics.totalCbm.toFixed(2)} / {activeContainer.maxVolumeCbm} CBM (
                  {activeMetrics.cbmPct}%)
                </span>
              </div>
              <div className="mt-2 w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    activeMetrics.isOverVolume
                      ? 'bg-red-600'
                      : activeMetrics.cbmPct > 85
                      ? 'bg-amber-500'
                      : 'bg-indigo-600'
                  }`}
                  style={{ width: `${Math.min(100, activeMetrics.cbmPct)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                <span>Total Length: {activeMetrics.totalLength.toLocaleString()} m</span>
                <span>
                  Free Space:{' '}
                  {Math.max(
                    0,
                    activeContainer.maxVolumeCbm - activeMetrics.totalCbm
                  ).toFixed(2)}{' '}
                  CBM
                </span>
              </div>
            </div>

            {/* Drum Capacity & Status */}
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700">Total Drums Stowed</span>
                <span className="font-black text-emerald-800">
                  {activeMetrics.totalDrums} / {activeContainer.maxDrums} Drums (
                  {activeMetrics.drumPct}%)
                </span>
              </div>
              <div className="mt-2 w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 rounded-full transition-all"
                  style={{ width: `${Math.min(100, activeMetrics.drumPct)}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px]">
                {activeMetrics.isOverweight || activeMetrics.isOverVolume ? (
                  <span className="text-red-600 font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Exceeds container limit!
                  </span>
                ) : (
                  <span className="text-emerald-700 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Within safe stuffing limits
                  </span>
                )}
                <span className="text-slate-500">
                  {activeContainer.items.length} line item(s)
                </span>
              </div>
            </div>

            {/* Material Readiness & Stock Status */}
            {(() => {
              const readiness = resolveContainerMaterialReadiness(activeContainer, orders, stockLedger);
              return (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700 flex items-center gap-1.5">
                      <Box className="w-4 h-4 text-indigo-600" /> Material Status
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${readiness.badgeClass}`}>
                      {readiness.overallStatus}
                    </span>
                  </div>
                  <div className="mt-2 w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        readiness.readyPct === 100
                          ? 'bg-emerald-600'
                          : readiness.readyPct > 0
                          ? 'bg-blue-600'
                          : 'bg-amber-500'
                      }`}
                      style={{ width: `${readiness.readyPct}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-600">
                    <span className="font-bold">
                      {readiness.readyItems + readiness.dispatchedItems} of {readiness.totalItems} Items Ready ({readiness.readyPct}%)
                    </span>
                    <span className="text-slate-500 font-bold">
                      {readiness.inProdItems > 0 ? `${readiness.inProdItems} In Prod` : readiness.pendingItems > 0 ? `${readiness.pendingItems} Pending` : 'All Ready'}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Official 3-Block Container Planning Sheet Format (Block 1: Drum Size/Cable Size/Length/No of Drums, Block 2: Drum Size Summary, Block 3: Pallets Details & Weights) */}
          <ContainerPlanningSheetFormat
            container={activeContainer}
            packagingRules={packagingRules}
            orders={orders}
            densities={densities}
            ladiDimensions={ladiDimensions}
            sizeRules={sizeRules}
            isPrintView={false}
            onUpdateContainer={updates =>
              handleUpdateContainerDimensions(activeContainer.id, updates)
            }
            onToggleHighlightItem={handleToggleHighlightItem}
            onAddOrderFromSheet={handleAddSingleOrderFromSheet}
            onUpdateLoadItem={handleUpdateLoadItem}
            onDeleteLoadItem={handleDeleteLoadItem}
            onOpenLoadOrdersModal={() => setIsLoadOrderModalOpen(true)}
            stockLedger={stockLedger}
          />

          {/* Optional Legacy Raw Table Toggle (Released/Hidden by Default) */}
          <div className="flex items-center justify-between py-1.5 px-3 bg-slate-100 rounded-lg border border-slate-200 text-xs text-slate-600 no-print">
            <span className="font-medium text-slate-700">
              Raw Drum Items Table (Released to keep workspace streamlined with 3-Block Sheet &amp; Pallet Diagram)
            </span>
            <button
              type="button"
              onClick={() => setShowLegacyRawTable(prev => !prev)}
              className="text-xs px-2.5 py-1 rounded bg-white hover:bg-slate-200 border border-slate-300 font-bold text-slate-700 cursor-pointer shadow-2xs"
            >
              {showLegacyRawTable ? '▲ Hide Raw Items Table' : '▼ Expand Raw Items Table'}
            </button>
          </div>

          {showLegacyRawTable && (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left whitespace-nowrap">
              <thead className="bg-slate-800 text-white font-bold uppercase text-[10px]">
                <tr>
                  <th className="p-2 border-r border-slate-700">#</th>
                  <th className="p-2 border-r border-slate-700">Batch / Job</th>
                  <th className="p-2 border-r border-slate-700">Brand &amp; Grade</th>
                  <th className="p-2 border-r border-slate-700">Cable Size &amp; Cores</th>
                  <th className="p-2 border-r border-slate-700">Drum Size</th>
                  <th className="p-2 border-r border-slate-700">Drum Serial Range</th>
                  <th className="p-2 border-r border-slate-700 text-center">Drums Qty</th>
                  <th className="p-2 border-r border-slate-700 text-right">Len/Drum (m)</th>
                  <th className="p-2 border-r border-slate-700 text-right">Total Len (m)</th>
                  <th className="p-2 border-r border-slate-700 text-right">Net Wt (kg)</th>
                  <th className="p-2 border-r border-slate-700 text-right">Gross Wt (kg)</th>
                  <th className="p-2 border-r border-slate-700 text-right">Vol (CBM)</th>
                  <th className="p-2 border-r border-slate-700">Pallet Size</th>
                  <th className="p-2 border-r border-slate-700 bg-indigo-900 text-indigo-100 text-center">
                    Drums / Pallet
                  </th>
                  <th className="p-2 border-r border-slate-700 text-center">Material Status</th>
                  <th className="p-2 border-r border-slate-700">Stowage Position</th>
                  <th className="p-2 border-r border-slate-700">Remarks</th>
                  <th className="p-2 text-center no-print">Del</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeContainer.items.length === 0 ? (
                  <tr>
                    <td colSpan={18} className="p-6 text-center text-slate-400">
                      No drums loaded in this container yet. Click &ldquo;Load Drums from Orders&rdquo; or &ldquo;Add Custom Cargo Row&rdquo; above.
                    </td>
                  </tr>
                ) : (
                  activeContainer.items.map((item, idx) => {
                    const effectiveDrumsPerPallet = resolveDrumsPerPallet(
                      item,
                      packagingRules
                    );
                    const palletsNeeded = Math.ceil(
                      (Number(item.drumCount) || 0) / effectiveDrumsPerPallet
                    );

                    return (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="p-1.5 border-r border-slate-100 text-center font-bold text-slate-500">
                          {idx + 1}
                        </td>
                        <td className="p-1.5 border-r border-slate-100">
                          <input
                            type="text"
                            value={item.batch}
                            onChange={e =>
                              handleUpdateLoadItem(item.id, 'batch', e.target.value)
                            }
                            className="w-20 px-1.5 py-0.5 border border-slate-200 rounded font-bold text-slate-900"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100">
                          <input
                            type="text"
                            value={item.brandGrade}
                            onChange={e =>
                              handleUpdateLoadItem(item.id, 'brandGrade', e.target.value)
                            }
                            className="w-28 px-1.5 py-0.5 border border-slate-200 rounded"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100">
                          <input
                            type="text"
                            value={item.sizeCores}
                            onChange={e =>
                              handleUpdateLoadItem(item.id, 'sizeCores', e.target.value)
                            }
                            className="w-32 px-1.5 py-0.5 border border-slate-200 rounded font-bold text-blue-900"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100">
                          <input
                            type="text"
                            value={item.spool}
                            onChange={e =>
                              handleUpdateLoadItem(item.id, 'spool', e.target.value)
                            }
                            className="w-24 px-1.5 py-0.5 border border-slate-200 rounded font-semibold"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100">
                          <input
                            type="text"
                            value={item.drumNo}
                            onChange={e =>
                              handleUpdateLoadItem(item.id, 'drumNo', e.target.value)
                            }
                            className="w-40 px-1.5 py-0.5 border border-slate-200 rounded font-mono text-[11px] text-indigo-700"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100 text-center">
                          <input
                            type="number"
                            min="1"
                            value={item.drumCount}
                            onChange={e =>
                              handleUpdateLoadItem(
                                item.id,
                                'drumCount',
                                parseInt(e.target.value, 10) || 0
                              )
                            }
                            className="w-14 px-1 py-0.5 border border-slate-300 rounded text-center font-black bg-amber-50/50"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100 text-right">
                          <input
                            type="number"
                            value={item.lengthPerDrum}
                            onChange={e =>
                              handleUpdateLoadItem(
                                item.id,
                                'lengthPerDrum',
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-16 px-1 py-0.5 border border-slate-200 rounded text-right"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100 text-right font-bold text-slate-900">
                          {item.totalLength.toLocaleString()} m
                        </td>
                        <td className="p-1.5 border-r border-slate-100 text-right">
                          <input
                            type="number"
                            step="0.1"
                            value={item.netCableWt}
                            onChange={e =>
                              handleUpdateLoadItem(
                                item.id,
                                'netCableWt',
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-20 px-1 py-0.5 border border-slate-200 rounded text-right"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100 text-right">
                          <input
                            type="number"
                            step="0.1"
                            value={item.grossWt}
                            onChange={e =>
                              handleUpdateLoadItem(
                                item.id,
                                'grossWt',
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-20 px-1 py-0.5 border border-blue-200 rounded text-right font-bold bg-blue-50/40"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100 text-right">
                          <input
                            type="number"
                            step="0.05"
                            value={item.volumeCbm}
                            onChange={e =>
                              handleUpdateLoadItem(
                                item.id,
                                'volumeCbm',
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-16 px-1 py-0.5 border border-indigo-200 rounded text-right font-bold text-indigo-800"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100">
                          <input
                            type="text"
                            value={item.palletSize}
                            onChange={e =>
                              handleUpdateLoadItem(item.id, 'palletSize', e.target.value)
                            }
                            className="w-20 px-1 py-0.5 border border-slate-200 rounded"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100 bg-indigo-50/40 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              min="1"
                              value={effectiveDrumsPerPallet}
                              onChange={e =>
                                handleUpdateLoadItem(
                                  item.id,
                                  'drumsPerPallet',
                                  Math.max(1, parseInt(e.target.value, 10) || 1)
                                )
                              }
                              title="No. of Drums in 1 Pallet (from Backup Packaging Spool & Pallet Lookup)"
                              className="w-12 px-1 py-0.5 border border-indigo-300 rounded text-center font-extrabold text-indigo-900 bg-white"
                            />
                            <span className="text-[10px] font-bold text-indigo-700">
                              ({palletsNeeded} Plt)
                            </span>
                          </div>
                        </td>
                        <td className="p-1.5 border-r border-slate-100 text-center">
                          {(() => {
                            const matStatus = resolveContainerItemMaterialStatus(item, orders, stockLedger);
                            return (
                              <div className="flex flex-col items-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${matStatus.badgeClass}`}>
                                  {matStatus.status}
                                </span>
                                {matStatus.stageLabel && (
                                  <span className="text-[9px] text-slate-500 font-bold">{matStatus.stageLabel}</span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="p-1.5 border-r border-slate-100">
                          <input
                            type="text"
                            value={item.stowagePosition}
                            onChange={e =>
                              handleUpdateLoadItem(
                                item.id,
                                'stowagePosition',
                                e.target.value
                              )
                            }
                            className="w-36 px-1.5 py-0.5 border border-slate-200 rounded font-medium text-slate-700"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-100">
                          <input
                            type="text"
                            value={item.remarks}
                            onChange={e =>
                              handleUpdateLoadItem(item.id, 'remarks', e.target.value)
                            }
                            className="w-32 px-1.5 py-0.5 border border-slate-200 rounded text-slate-600"
                          />
                        </td>
                        <td className="p-1.5 text-center no-print">
                          <button
                            type="button"
                            onClick={() => handleDeleteLoadItem(item.id)}
                            className="p-1 text-red-500 hover:bg-red-50 rounded"
                            title="Remove row from container"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {activeContainer.items.length > 0 && (
                <tfoot className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300">
                  <tr>
                    <td colSpan={6} className="p-2 text-right uppercase text-[11px]">
                      Container Stuffing Totals:
                    </td>
                    <td className="p-2 text-center text-indigo-800">
                      {activeMetrics.totalDrums} Drums
                    </td>
                    <td className="p-2"></td>
                    <td className="p-2 text-right">
                      {activeMetrics.totalLength.toLocaleString()} m
                    </td>
                    <td className="p-2 text-right">
                      {activeMetrics.totalNetWt.toFixed(2)} kg
                    </td>
                    <td className="p-2 text-right text-blue-800">
                      {activeMetrics.totalGrossWt.toFixed(2)} kg
                    </td>
                    <td className="p-2 text-right text-indigo-800">
                      {activeMetrics.totalCbm.toFixed(2)} CBM
                    </td>
                    <td colSpan={5} className="p-2 text-[11px] text-slate-600">
                      Notes: {activeContainer.notes}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

          {/* Container Notes Input */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
            <label className="font-bold text-slate-600 whitespace-nowrap">
              Stuffing / Lashing / Fumigation Notes:
            </label>
            <input
              type="text"
              value={activeContainer.notes}
              onChange={e =>
                handleUpdateContainerField(activeContainer.id, 'notes', e.target.value)
              }
              placeholder="Enter special container loading instructions, customs seal notes, or pallet markings..."
              className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
            />
          </div>
        </div>
      )}

      {/* DISPATCHED DETAILS — CONTAINER-WISE HISTORY VIEW (For Future Review) */}
      {activeViewMode === 'HISTORY' && (
        <div className="space-y-4 no-print">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <span className="p-2 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200">
                  <History className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span>🕓 Dispatched Details — Container-wise History Archive</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      {dispatchedContainers.length} Dispatched Containers Stored
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    All dispatched containers and their loaded cable items are permanently stored container-wise here for reviewing dispatch history in the future.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search Dispatched Container, Client, Batch, Size..."
                    value={historySearchQuery}
                    onChange={e => setHistorySearchQuery(e.target.value)}
                    className="text-xs pl-7 pr-2.5 py-1.5 border border-slate-300 rounded-lg w-64 bg-white"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                </div>

                <button
                  type="button"
                  onClick={handleExportDispatchedHistoryCSV}
                  className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-semibold flex items-center gap-1"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" /> Export Dispatched History CSV
                </button>
              </div>
            </div>

            {/* Dispatched Containers Master Register */}
            <div className="mt-3 overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="p-2 border-r border-slate-200">Container No</th>
                    <th className="p-2 border-r border-slate-200">Type</th>
                    <th className="p-2 border-r border-slate-200">Planning Sheet Title</th>
                    <th className="p-2 border-r border-slate-200">Booking / Seal No</th>
                    <th className="p-2 border-r border-slate-200">Client &amp; Destination</th>
                    <th className="p-2 border-r border-slate-200">Stuffing Date</th>
                    <th className="p-2 border-r border-slate-200">Dispatched Date</th>
                    <th className="p-2 border-r border-slate-200 text-center">Total Drums</th>
                    <th className="p-2 border-r border-slate-200 text-right">Total Length</th>
                    <th className="p-2 border-r border-slate-200 text-right">Net / Gross Wt</th>
                    <th className="p-2 text-center">Review / Print</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredHistoryRecords.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="p-6 text-center text-slate-400">
                        No dispatched container history records found. When you click &ldquo;Dispatch&rdquo; on any container plan, its complete container-wise details are archived here automatically.
                      </td>
                    </tr>
                  ) : (
                    filteredHistoryRecords.map(rec => {
                      const isSelected = activeHistoryRecord?.id === rec.id;
                      const dispDate = rec.dispatchedAt
                        ? new Date(rec.dispatchedAt).toLocaleString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '-';
                      return (
                        <tr
                          key={rec.id}
                          onClick={() => setSelectedHistoryId(rec.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-emerald-50/80 font-semibold' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="p-2 border-r border-slate-100 font-mono font-bold text-emerald-950 flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isSelected ? 'bg-emerald-600' : 'bg-slate-300'
                              }`}
                            />
                            {rec.containerNo}
                          </td>
                          <td className="p-2 border-r border-slate-100">
                            <span className="px-2 py-0.5 rounded bg-slate-200/80 text-slate-800 font-bold text-[10px]">
                              {rec.containerType}
                            </span>
                          </td>
                          <td className="p-2 border-r border-slate-100 font-bold text-slate-800">
                            {rec.planningSheetTitle || '-'}
                          </td>
                          <td className="p-2 border-r border-slate-100">
                            <div className="font-bold text-slate-800">{rec.bookingNo}</div>
                            <div className="text-[10px] text-slate-500">Seal: {rec.sealNo}</div>
                          </td>
                          <td className="p-2 border-r border-slate-100">
                            <div className="font-bold text-slate-800">{rec.clientName}</div>
                            <div className="text-[10px] text-slate-500">{rec.destination}</div>
                          </td>
                          <td className="p-2 border-r border-slate-100 font-semibold text-slate-700">
                            {rec.plannedStuffingDate || '-'}
                          </td>
                          <td className="p-2 border-r border-slate-100">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              {dispDate}
                            </span>
                          </td>
                          <td className="p-2 border-r border-slate-100 text-center font-black text-slate-900">
                            {rec.totalDrums} Drums
                          </td>
                          <td className="p-2 border-r border-slate-100 text-right font-bold text-indigo-900">
                            {rec.totalLength.toLocaleString()} m
                          </td>
                          <td className="p-2 border-r border-slate-100 text-right">
                            <div className="font-black text-slate-900">
                              {(rec.totalGrossWt ?? rec.grossWtKg ?? 0).toLocaleString()} kg Gross
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Net: {(rec.totalNetWt ?? rec.netWtKg ?? 0).toLocaleString()} kg
                            </div>
                          </td>
                          <td
                            className="p-2 text-center"
                            onClick={e => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => setSelectedHistoryId(rec.id)}
                                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePrintDispatchedRecord(rec)}
                                className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-bold flex items-center gap-1"
                                title={`Print Dispatched Container Sheet for ${rec.containerNo}`}
                              >
                                <Printer className="w-3 h-3" /> Print
                              </button>
                              {onUpdateDispatchedContainers && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onUpdateDispatchedContainers(
                                      dispatchedContainers.filter(x => x.id !== rec.id)
                                    )
                                  }
                                  className="p-1 text-red-500 hover:bg-red-50 rounded"
                                  title="Delete Dispatched History Entry"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
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

          {/* Selected Dispatched Container Historical Sheet & Items Breakdown */}
          {activeHistoryRecord && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-600 text-white">
                      Dispatched Container Archive Record
                    </span>
                    <h3 className="text-base font-black text-slate-900 font-mono">
                      {activeHistoryRecord.containerNo}
                    </h3>
                    <span className="text-xs font-bold text-slate-500">
                      ({activeHistoryRecord.containerType})
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Client: <strong className="text-slate-800">{activeHistoryRecord.clientName}</strong> | Destination:{' '}
                    <strong className="text-slate-800">{activeHistoryRecord.destination}</strong> | Booking:{' '}
                    <strong className="text-slate-800">{activeHistoryRecord.bookingNo}</strong> | Seal:{' '}
                    <strong className="text-slate-800">{activeHistoryRecord.sealNo}</strong> | Dispatched:{' '}
                    <strong className="text-emerald-700">
                      {new Date(activeHistoryRecord.dispatchedAt).toLocaleString('en-GB')}
                    </strong>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handlePrintDispatchedRecord(activeHistoryRecord)}
                  className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-2xs"
                >
                  <Printer className="w-3.5 h-3.5" /> Print Dispatched Container Sheet
                </button>
              </div>

              {/* 3-Block Container Planning Sheet Snapshot for the Dispatched Container */}
              <ContainerPlanningSheetFormat
                container={{
                  id: activeHistoryRecord.containerId,
                  containerNo: activeHistoryRecord.containerNo,
                  containerType: activeHistoryRecord.containerType,
                  planningSheetTitle: activeHistoryRecord.planningSheetTitle,
                  bookingNo: activeHistoryRecord.bookingNo,
                  sealNo: activeHistoryRecord.sealNo,
                  shippingLine: activeHistoryRecord.shippingLine,
                  vesselVoyage: activeHistoryRecord.vesselVoyage,
                  portOfLoading: activeHistoryRecord.portOfLoading,
                  destination: activeHistoryRecord.destination,
                  clientName: activeHistoryRecord.clientName,
                  plannedStuffingDate: activeHistoryRecord.plannedStuffingDate,
                  etd: activeHistoryRecord.etd,
                  maxWeightKg: 28000,
                  maxVolumeCbm: 67.7,
                  maxDrums: 100,
                  customTotalLengthInch: activeHistoryRecord.customTotalLengthInch,
                  customPalletWeightKg: activeHistoryRecord.totalPalletWt,
                  customDrumsWeightKg: activeHistoryRecord.totalDrumsWt,
                  customPalletCells: activeHistoryRecord.customPalletCells,
                  status: 'Dispatched / Shipped',
                  notes: activeHistoryRecord.notes,
                  items: activeHistoryRecord.items,
                }}
                packagingRules={packagingRules}
                orders={orders}
                stockLedger={stockLedger}
                isPrintView={false}
                readOnly={true}
              />

              {/* Container-wise Dispatched Items Table */}
              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-2">
                  📦 Dispatched Items Breakdown — Container {activeHistoryRecord.containerNo} ({activeHistoryRecord.items.length} Items)
                </h4>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs text-left whitespace-nowrap">
                    <thead className="bg-slate-800 text-white font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-2 border-r border-slate-700 text-center">#</th>
                        <th className="p-2 border-r border-slate-700">Batch / Job</th>
                        <th className="p-2 border-r border-slate-700">Brand &amp; Grade</th>
                        <th className="p-2 border-r border-slate-700">Cable Size</th>
                        <th className="p-2 border-r border-slate-700">Drum Size</th>
                        <th className="p-2 border-r border-slate-700">Drum Serial Range</th>
                        <th className="p-2 border-r border-slate-700 text-center">No of Drums</th>
                        <th className="p-2 border-r border-slate-700 text-right">Length (m)</th>
                        <th className="p-2 border-r border-slate-700 text-right">Net Wt (kg)</th>
                        <th className="p-2 border-r border-slate-700 text-right">Gross Wt (kg)</th>
                        <th className="p-2 border-r border-slate-700">Pallet Size</th>
                        <th className="p-2 border-r border-slate-700">Stowage Position</th>
                        <th className="p-2">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeHistoryRecord.items.map((item, idx) => (
                        <tr
                          key={item.id}
                          className={item.isHighlighted ? 'bg-[#ffff00] font-semibold' : 'hover:bg-slate-50'}
                        >
                          <td className="p-2 border-r border-slate-200 text-center font-bold">
                            {idx + 1}
                          </td>
                          <td className="p-2 border-r border-slate-200 font-bold text-slate-900">
                            {item.batch}
                          </td>
                          <td className="p-2 border-r border-slate-200">{item.brandGrade}</td>
                          <td className="p-2 border-r border-slate-200 font-extrabold text-blue-950">
                            {item.sizeCores}
                          </td>
                          <td className="p-2 border-r border-slate-200 font-mono font-bold">
                            {item.spool}
                          </td>
                          <td className="p-2 border-r border-slate-200 font-mono text-[11px] text-indigo-700">
                            {item.drumNo}
                          </td>
                          <td className="p-2 border-r border-slate-200 text-center font-black">
                            {item.drumCount}
                          </td>
                          <td className="p-2 border-r border-slate-200 text-right font-bold">
                            {item.totalLength.toLocaleString()} m
                          </td>
                          <td className="p-2 border-r border-slate-200 text-right">
                            {Number(item.netCableWt).toFixed(1)} kg
                          </td>
                          <td className="p-2 border-r border-slate-200 text-right font-bold">
                            {Number(item.grossWt).toFixed(1)} kg
                          </td>
                          <td className="p-2 border-r border-slate-200">{item.palletSize}</td>
                          <td className="p-2 border-r border-slate-200">{item.stowagePosition}</td>
                          <td className="p-2">{item.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Print-Only Individual Container Stuffing & Load Plan Sheet */}
      <div className="print-only space-y-6">
        {(printingHistoryRecord
          ? [
              {
                id: printingHistoryRecord.containerId,
                containerNo: printingHistoryRecord.containerNo,
                containerType: printingHistoryRecord.containerType,
                planningSheetTitle: printingHistoryRecord.planningSheetTitle,
                bookingNo: printingHistoryRecord.bookingNo,
                sealNo: printingHistoryRecord.sealNo,
                shippingLine: printingHistoryRecord.shippingLine,
                vesselVoyage: printingHistoryRecord.vesselVoyage,
                portOfLoading: printingHistoryRecord.portOfLoading,
                destination: printingHistoryRecord.destination,
                clientName: printingHistoryRecord.clientName,
                plannedStuffingDate: printingHistoryRecord.plannedStuffingDate,
                etd: printingHistoryRecord.etd,
                maxWeightKg: 28000,
                maxVolumeCbm: 67.7,
                maxDrums: 100,
                customTotalLengthInch: printingHistoryRecord.customTotalLengthInch,
                customPalletWeightKg: printingHistoryRecord.totalPalletWt,
                customDrumsWeightKg: printingHistoryRecord.totalDrumsWt,
                customPalletCells: printingHistoryRecord.customPalletCells,
                status: 'Dispatched / Shipped' as const,
                notes: printingHistoryRecord.notes,
                items: printingHistoryRecord.items,
              },
            ]
          : containersToPrint
        ).map((cont, cIdx, arr) => {
          const pm = computeContainerMetrics(cont);
          const isMultiPage = arr.length > 1;
          return (
            <div
              key={cont.id}
              className="border-2 border-black rounded-lg p-3 bg-white text-black print-card"
            >
              {/* Official Individual Container Sheet Header */}
              <div className="bg-slate-900 text-white px-3 py-2 rounded-t flex items-center justify-between border-b-2 border-black">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                    INDIVIDUAL CONTAINER STUFFING &amp; LOAD MANIFEST
                  </div>
                  <div className="text-base font-black font-mono tracking-wide">
                    CONTAINER NO: {cont.containerNo} ({cont.containerType})
                  </div>
                </div>
                <div className="text-right text-xs font-bold">
                  <div>PLANNED STUFFING DATE: {cont.plannedStuffingDate || 'TBA'}</div>
                  <div className="text-[10px] text-slate-200">
                    STATUS: {cont.status.toUpperCase()} | ETD: {cont.etd || 'TBA'}
                  </div>
                </div>
              </div>

              {/* 3-Block Container Planning Sheet Format (Block 1: Drum Size/Cable Size/Length/No of Drums, Block 2: Drum Size Summary, Block 3: Pallets Details) */}
              <div className="my-3">
                <ContainerPlanningSheetFormat
                  container={cont}
                  packagingRules={packagingRules}
                  orders={orders}
                  stockLedger={stockLedger}
                  isPrintView={true}
                  readOnly={true}
                />
              </div>

              {/* Container Metadata Table */}
              <table className="w-full text-[11px] border-collapse border border-black mt-2">
                <tbody>
                  <tr>
                    <td className="p-1.5 border border-black bg-slate-100 font-bold w-[16%]">
                      Container No:
                    </td>
                    <td className="p-1.5 border border-black font-mono font-extrabold w-[18%]">
                      {cont.containerNo}
                    </td>
                    <td className="p-1.5 border border-black bg-slate-100 font-bold w-[16%]">
                      Size / Type:
                    </td>
                    <td className="p-1.5 border border-black font-bold w-[16%]">
                      {cont.containerType}
                    </td>
                    <td className="p-1.5 border border-black bg-slate-100 font-bold w-[16%]">
                      Stuffing Date:
                    </td>
                    <td className="p-1.5 border border-black font-extrabold w-[18%]">
                      {cont.plannedStuffingDate || '-'}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-1.5 border border-black bg-slate-100 font-bold">
                      Booking / BL No:
                    </td>
                    <td className="p-1.5 border border-black font-semibold">
                      {cont.bookingNo || '-'}
                    </td>
                    <td className="p-1.5 border border-black bg-slate-100 font-bold">
                      Customs / Line Seal:
                    </td>
                    <td className="p-1.5 border border-black font-semibold">
                      {cont.sealNo || '-'}
                    </td>
                    <td className="p-1.5 border border-black bg-slate-100 font-bold">
                      Shipping Line:
                    </td>
                    <td className="p-1.5 border border-black font-semibold">
                      {cont.shippingLine || '-'}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-1.5 border border-black bg-slate-100 font-bold">
                      Client / Consignee:
                    </td>
                    <td className="p-1.5 border border-black font-bold">
                      {cont.clientName || '-'}
                    </td>
                    <td className="p-1.5 border border-black bg-slate-100 font-bold">
                      Destination Port:
                    </td>
                    <td className="p-1.5 border border-black font-bold">
                      {cont.destination || '-'}
                    </td>
                    <td className="p-1.5 border border-black bg-slate-100 font-bold">
                      Vessel / Voyage:
                    </td>
                    <td className="p-1.5 border border-black font-semibold">
                      {cont.vesselVoyage || '-'} (ETD: {cont.etd || '-'})
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Utilization & Capacity Summary Row */}
              <div className="grid grid-cols-4 gap-2 my-2 text-[11px]">
                <div className="p-2 border border-black rounded bg-slate-50">
                  <div className="text-[9.5px] font-bold uppercase text-slate-600">
                    Total Drums Loaded
                  </div>
                  <div className="text-sm font-black">
                    {pm.totalDrums} / {cont.maxDrums} Drums ({pm.drumPct}%)
                  </div>
                </div>
                <div className="p-2 border border-black rounded bg-slate-50">
                  <div className="text-[9.5px] font-bold uppercase text-slate-600">
                    Total Cable Length
                  </div>
                  <div className="text-sm font-black">
                    {pm.totalLength.toLocaleString()} m
                  </div>
                </div>
                <div className="p-2 border border-black rounded bg-slate-50">
                  <div className="text-[9.5px] font-bold uppercase text-slate-600">
                    Gross / Net Payload Wt
                  </div>
                  <div className="text-sm font-black">
                    {pm.totalGrossWt.toFixed(1)} kg Gross ({pm.wtPct}%)
                  </div>
                  <div className="text-[9.5px] font-semibold">
                    Net Cable: {pm.totalNetWt.toFixed(1)} kg | Limit: {cont.maxWeightKg.toLocaleString()} kg
                  </div>
                </div>
                <div className="p-2 border border-black rounded bg-slate-50">
                  <div className="text-[9.5px] font-bold uppercase text-slate-600">
                    Space / Volume (CBM)
                  </div>
                  <div className="text-sm font-black">
                    {pm.totalCbm.toFixed(2)} / {cont.maxVolumeCbm} CBM ({pm.cbmPct}%)
                  </div>
                  <div className="text-[9.5px] font-semibold">
                    Free Space: {Math.max(0, cont.maxVolumeCbm - pm.totalCbm).toFixed(2)} CBM
                  </div>
                </div>
              </div>

              {/* Clean Printable Drum Stuffing Table */}
              <table className="w-full text-[10.5px] text-left border-collapse border border-black mt-2">
                <thead className="bg-slate-200 text-black font-bold uppercase text-[9.5px]">
                  <tr>
                    <th className="p-1.5 border border-black text-center">#</th>
                    <th className="p-1.5 border border-black">Batch / Job</th>
                    <th className="p-1.5 border border-black">Brand &amp; Grade</th>
                    <th className="p-1.5 border border-black">Cable Size &amp; Cores</th>
                    <th className="p-1.5 border border-black">Drum Size</th>
                    <th className="p-1.5 border border-black">Drum Serial Range</th>
                    <th className="p-1.5 border border-black text-center">Drums</th>
                    <th className="p-1.5 border border-black text-right">Len/Drum</th>
                    <th className="p-1.5 border border-black text-right">Total Len (m)</th>
                    <th className="p-1.5 border border-black text-right">Net Wt (kg)</th>
                    <th className="p-1.5 border border-black text-right">Gross Wt (kg)</th>
                    <th className="p-1.5 border border-black text-right">Vol (CBM)</th>
                    <th className="p-1.5 border border-black">Pallet Size</th>
                    <th className="p-1.5 border border-black">Stowage Position</th>
                    <th className="p-1.5 border border-black">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {cont.items.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="p-4 text-center border border-black">
                        No drums loaded in this container plan.
                      </td>
                    </tr>
                  ) : (
                    cont.items.map((item, idx) => (
                      <tr key={item.id} className={item.isHighlighted ? 'bg-[#ffff00]' : ''}>
                        <td className="p-1.5 border border-black text-center font-bold">
                          {idx + 1}
                        </td>
                        <td className="p-1.5 border border-black font-bold">{item.batch}</td>
                        <td className="p-1.5 border border-black font-semibold">
                          {item.brandGrade}
                        </td>
                        <td className="p-1.5 border border-black font-extrabold">
                          {item.sizeCores}
                        </td>
                        <td className="p-1.5 border border-black">{item.spool}</td>
                        <td className="p-1.5 border border-black font-mono text-[10px]">
                          {item.drumNo}
                        </td>
                        <td className="p-1.5 border border-black text-center font-black">
                          {item.drumCount}
                        </td>
                        <td className="p-1.5 border border-black text-right">
                          {item.lengthPerDrum} m
                        </td>
                        <td className="p-1.5 border border-black text-right font-bold">
                          {item.totalLength.toLocaleString()} m
                        </td>
                        <td className="p-1.5 border border-black text-right">
                          {Number(item.netCableWt).toFixed(2)}
                        </td>
                        <td className="p-1.5 border border-black text-right font-bold">
                          {Number(item.grossWt).toFixed(2)}
                        </td>
                        <td className="p-1.5 border border-black text-right font-bold">
                          {Number(item.volumeCbm).toFixed(2)}
                        </td>
                        <td className="p-1.5 border border-black">{item.palletSize}</td>
                        <td className="p-1.5 border border-black font-semibold">
                          {item.stowagePosition}
                        </td>
                        <td className="p-1.5 border border-black">{item.remarks}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {cont.items.length > 0 && (
                  <tfoot className="bg-slate-100 font-black border-t-2 border-black">
                    <tr>
                      <td colSpan={6} className="p-1.5 border border-black text-right uppercase">
                        Individual Container Stuffing Totals:
                      </td>
                      <td className="p-1.5 border border-black text-center">
                        {pm.totalDrums} Drums
                      </td>
                      <td className="p-1.5 border border-black"></td>
                      <td className="p-1.5 border border-black text-right">
                        {pm.totalLength.toLocaleString()} m
                      </td>
                      <td className="p-1.5 border border-black text-right">
                        {pm.totalNetWt.toFixed(2)} kg
                      </td>
                      <td className="p-1.5 border border-black text-right">
                        {pm.totalGrossWt.toFixed(2)} kg
                      </td>
                      <td className="p-1.5 border border-black text-right">
                        {pm.totalCbm.toFixed(2)} CBM
                      </td>
                      <td colSpan={3} className="p-1.5 border border-black text-[10px]">
                        {cont.notes}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>


              {/* Sign-Off Block for Individual Container Sheet */}
              <div className="grid grid-cols-3 gap-4 mt-4 pt-2 text-[10px]">
                <div className="border border-black p-2 rounded">
                  <div className="font-bold uppercase">1. Warehouse / Stuffing Supervisor</div>
                  <div className="mt-5 border-t border-black pt-1 flex justify-between">
                    <span>Signature &amp; Date</span>
                    <span>Drums Verified: {pm.totalDrums}</span>
                  </div>
                </div>
                <div className="border border-black p-2 rounded">
                  <div className="font-bold uppercase">2. Quality Assurance / Inspector</div>
                  <div className="mt-5 border-t border-black pt-1 flex justify-between">
                    <span>Signature &amp; Date</span>
                    <span>Lashing &amp; Pallets OK</span>
                  </div>
                </div>
                <div className="border border-black p-2 rounded">
                  <div className="font-bold uppercase">3. Shipping / Seal Verification</div>
                  <div className="mt-5 border-t border-black pt-1 flex justify-between">
                    <span>Seal No: {cont.sealNo || '_________'}</span>
                    <span>Gate Pass Sign</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal: Create New Container Plan */}
      {isNewContainerModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 text-slate-800">
            <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
              <Ship className="w-5 h-5 text-indigo-600" />
              Create New Container Plan
            </h3>
            <form onSubmit={handleCreateContainer} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">
                  Container No (or TBC Reference) *
                </label>
                <input
                  type="text"
                  placeholder="e.g., MSCU-882910-2 or CONT-EXPORT-03"
                  value={newContNo}
                  onChange={e => setNewContNo(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">
                  Container Size & Type *
                </label>
                <select
                  value={newContType}
                  onChange={e => setNewContType(e.target.value as ContainerType)}
                  className="w-full p-2 border border-slate-300 rounded-lg font-bold"
                >
                  {Object.entries(CONTAINER_SPECS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">
                    Booking / BL No
                  </label>
                  <input
                    type="text"
                    placeholder="BKG-2026-..."
                    value={newBookingNo}
                    onChange={e => setNewBookingNo(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">
                    Shipping Line
                  </label>
                  <input
                    type="text"
                    placeholder="Maersk / MSC / CMA"
                    value={newShippingLine}
                    onChange={e => setNewShippingLine(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">
                    Client / Consignee
                  </label>
                  <input
                    type="text"
                    placeholder="Client Name"
                    value={newClientName}
                    onChange={e => setNewClientName(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">
                    Destination Port
                  </label>
                  <input
                    type="text"
                    placeholder="Jebel Ali / Felixstowe"
                    value={newDestination}
                    onChange={e => setNewDestination(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-0.5">
                  Planned Stuffing Date
                </label>
                <input
                  type="date"
                  value={newStuffingDate}
                  onChange={e => setNewStuffingDate(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsNewContainerModalOpen(false)}
                  className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold"
                >
                  Save Container Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Load Orders into Active Container */}
      {isLoadOrderModalOpen && activeContainer && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full p-5 text-slate-800 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Load Orders / Drums into {activeContainer.containerNo}
                </h3>
                <p className="text-xs text-slate-500">
                  Select orders below to automatically calculate drums, gross weights, pallets, and CBM volume.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-600">Batch:</span>
                <select
                  value={importBatchFilter}
                  onChange={e => setImportBatchFilter(e.target.value)}
                  className="px-2.5 py-1 border border-slate-300 rounded-lg font-bold"
                >
                  <option value="ALL">All Batches</option>
                  {uniqueBatches.map(b => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const allIds = modalFilteredOrders.map(o => o.id);
                    setSelectedOrderIdsToLoad(allIds);
                  }}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded font-semibold"
                >
                  Select All
                </button>
              </div>
            </div>

            <div className="my-3 overflow-y-auto flex-1 border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] sticky top-0">
                  <tr>
                    <th className="p-2 border-r border-slate-200 text-center">Pick</th>
                    <th className="p-2 border-r border-slate-200">Order #</th>
                    <th className="p-2 border-r border-slate-200">Batch</th>
                    <th className="p-2 border-r border-slate-200">Brand & Grade</th>
                    <th className="p-2 border-r border-slate-200">Cores × Size</th>
                    <th className="p-2 border-r border-slate-200 text-right">Order Len</th>
                    <th className="p-2 border-r border-slate-200 text-right">Est. Net Wt</th>
                    <th className="p-2 text-center">Stage Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {modalFilteredOrders.map(o => {
                    const r = computeRecordRow(o, densities, ladiDimensions);
                    const netWt = r.reqCu + r.reqIns + r.reqSheath;
                    const checked = selectedOrderIdsToLoad.includes(o.id);
                    return (
                      <tr
                        key={o.id}
                        onClick={() => {
                          setSelectedOrderIdsToLoad(prev =>
                            prev.includes(o.id)
                              ? prev.filter(x => x !== o.id)
                              : [...prev, o.id]
                          );
                        }}
                        className={`cursor-pointer ${
                          checked ? 'bg-blue-50 font-semibold' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="p-2 border-r border-slate-100 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {}}
                            className="rounded text-blue-600"
                          />
                        </td>
                        <td className="p-2 border-r border-slate-100">#{o.id}</td>
                        <td className="p-2 border-r border-slate-100 font-bold">{o.batch}</td>
                        <td className="p-2 border-r border-slate-100">
                          {o.brand} {o.grade}
                        </td>
                        <td className="p-2 border-r border-slate-100 font-bold">
                          {o.cores}C × {o.size}
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right">
                          {r.orderLen.toLocaleString()} m
                        </td>
                        <td className="p-2 border-r border-slate-100 text-right">
                          {netWt.toFixed(1)} kg
                        </td>
                        <td className="p-2 text-center">
                          {o.dispatched ? (
                            <span className="px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded text-[10px] font-bold">
                              Dispatched
                            </span>
                          ) : o.pStatus?.s ? (
                            <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">
                              Finished
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold">
                              In Production
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200 text-xs">
              <span className="font-bold text-slate-600">
                {selectedOrderIdsToLoad.length} order(s) selected to load
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsLoadOrderModalOpen(false)}
                  className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={selectedOrderIdsToLoad.length === 0}
                  onClick={handleConfirmLoadOrders}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-bold"
                >
                  Load Selected into Container
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
