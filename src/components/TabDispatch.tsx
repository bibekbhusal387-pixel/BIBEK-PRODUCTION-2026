import React, { useState, useMemo } from 'react';
import { CableOrder, ContainerPlan, DispatchedContainerRecord, DispatchRecord } from '../types/cable';
import { exportCsvFile } from '../utils/calculations';
import {
  Truck,
  Search,
  Filter,
  Plus,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Package,
  Box,
  Ship,
  MapPin,
  Calendar,
  User,
  FileText,
  Trash2,
  Edit2,
  X,
  AlertCircle,
  ExternalLink,
  QrCode,
} from 'lucide-react';
import {
  DispatchedReelItem,
  expandDispatchedReelsForRecord,
} from '../utils/reelQrCode';
import { ReelQrCodeModal } from './ReelQrCodeModal';

interface TabDispatchProps {
  dispatchRecords: DispatchRecord[];
  dispatchedContainers?: DispatchedContainerRecord[];
  orders?: CableOrder[];
  onAddDispatchRecord: (record: DispatchRecord) => void;
  onUpdateDispatchRecord: (record: DispatchRecord) => void;
  onDeleteDispatchRecord: (id: string) => void;
  onClearAllDispatches?: () => void;
  onNavigateTab?: (tabId: string) => void;
}

export const TabDispatch: React.FC<TabDispatchProps> = ({
  dispatchRecords,
  dispatchedContainers = [],
  orders = [],
  onAddDispatchRecord,
  onUpdateDispatchRecord,
  onDeleteDispatchRecord,
  onClearAllDispatches,
  onNavigateTab,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [clientDestFilter, setClientDestFilter] = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'DRUMS' | 'CARTONS' | 'CONTAINER'>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<DispatchRecord | null>(null);
  const [viewingChallanRecord, setViewingChallanRecord] = useState<DispatchRecord | null>(null);
  const [activeQrState, setActiveQrState] = useState<{
    reel: DispatchedReelItem;
    siblings: DispatchedReelItem[];
  } | null>(null);

  // Form state for creating / editing dispatch records
  const [formBatch, setFormBatch] = useState('');
  const [formDispatchNo, setFormDispatchNo] = useState(`DSP-${Date.now().toString().slice(-4)}`);
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formClient, setFormClient] = useState('');
  const [formDestination, setFormDestination] = useState('');
  const [formBrand, setFormBrand] = useState('');
  const [formGrade, setFormGrade] = useState('H07RN-F');
  const [formSizeCores, setFormSizeCores] = useState('');
  const [formConductor, setFormConductor] = useState('');
  const [formPkgType, setFormPkgType] = useState<'DRUMS' | 'CARTONS' | 'COILS' | 'CONTAINER'>('DRUMS');
  const [formDrumCount, setFormDrumCount] = useState<string>('1');
  const [formDrumNos, setFormDrumNos] = useState('');
  const [formSpoolSize, setFormSpoolSize] = useState('');
  const [formPalletSize, setFormPalletSize] = useState('');
  const [formCartonCount, setFormCartonCount] = useState<string>('0');
  const [formCartonIds, setFormCartonIds] = useState('');
  const [formLengthM, setFormLengthM] = useState<string>('');
  const [formNetWeight, setFormNetWeight] = useState<string>('');
  const [formGrossWeight, setFormGrossWeight] = useState<string>('');
  const [formVehicle, setFormVehicle] = useState('');
  const [formSealNo, setFormSealNo] = useState('');
  const [formBookingNo, setFormBookingNo] = useState('');
  const [formChallanNo, setFormChallanNo] = useState('');
  const [formDriver, setFormDriver] = useState('');
  const [formRemarks, setFormRemarks] = useState('');
  const [formStatus, setFormStatus] = useState<'Dispatched' | 'In Transit' | 'Delivered'>('Dispatched');

  // Unified Dispatches list (stored dispatch records + dynamically aggregated dispatched containers + Order Sheet dispatched orders)
  const allDispatches = useMemo(() => {
    const list: DispatchRecord[] = [...dispatchRecords];

    // 1. Merge in any dispatched containers from 6B. Container Planning not already present
    dispatchedContainers.forEach(dc => {
      const existing = list.find(
        r => r.id === dc.id || r.id === `CONT-${dc.id}` || r.dispatchNo === dc.bookingNo
      );
      if (!existing && dc.items && dc.items.length > 0) {
        const totalLen = dc.totalLength || dc.items.reduce((s, it) => s + (it.totalLength || 0), 0);
        const totalNet = dc.totalNetWt || dc.netWtKg || dc.items.reduce((s, it) => s + (it.netCableWt || 0), 0);
        const totalGross = dc.totalGrossWt || dc.grossWtKg || dc.items.reduce((s, it) => s + (it.grossWt || 0), 0);
        const batches = Array.from(new Set(dc.items.map(it => it.batch))).filter(Boolean).join(', ');
        const brands = Array.from(new Set(dc.items.map(it => it.brandGrade))).filter(Boolean).join(', ');
        const sizes = Array.from(new Set(dc.items.map(it => it.sizeCores))).filter(Boolean).join(' | ');

        list.push({
          id: `CONT-${dc.id}`,
          dispatchNo: dc.bookingNo || `CONT-${dc.containerNo}`,
          batch: batches || 'Multi-Batch Container',
          date: dc.plannedStuffingDate || dc.dispatchedAt?.split('T')[0] || new Date().toISOString().split('T')[0],
          clientName: dc.clientName || 'Export Client',
          destination: dc.destination || 'Export Port',
          brand: brands || 'MYBCAB',
          grade: 'Multi-Grade',
          sizeCores: sizes || 'Various Sizes',
          packagingType: 'CONTAINER',
          drumCount: dc.totalDrums || dc.items.reduce((s, it) => s + (it.drumCount || 0), 0),
          drumNos: dc.items.map(it => it.drumNo).filter(Boolean).slice(0, 3).join(', ') + (dc.items.length > 3 ? '...' : ''),
          lengthM: totalLen,
          netWeightKg: totalNet,
          grossWeightKg: totalGross,
          vehicleOrContainerNo: `${dc.containerNo} (${dc.containerType})`,
          sealNo: dc.sealNo,
          bookingNo: dc.bookingNo,
          driverOrOperator: dc.shippingLine || 'Shipping Line',
          remarks: dc.notes || 'Synced from 6B. Container Planning',
          status: 'Dispatched',
          createdAt: dc.dispatchedAt || new Date().toISOString(),
        });
      }
    });

    // 2. Merge in any Order Sheet items marked dispatched: true that do not yet have a ledger entry
    orders.forEach(order => {
      if (!order.dispatched) return;
      const sizeVal = parseFloat(order.size) || 0;
      const sizeStr = sizeVal > 0 ? sizeVal.toFixed(2) : order.size;
      const alreadyRecorded = list.some(
        r =>
          r.orderId === order.id ||
          r.id === `ORD-DSP-${order.id}` ||
          (r.batch === order.batch && r.sizeCores.includes(`${order.cores}C`) && r.sizeCores.includes(sizeStr))
      );
      if (!alreadyRecorded) {
        const sizeLabel = `${order.cores}C × ${sizeStr} SQ MM`;
        const coilsRaw = String(order.coils || '1').toUpperCase();
        const isCoils = coilsRaw.includes('COIL');
        const drumCountNum = !isCoils ? Math.max(1, parseInt(coilsRaw, 10) || 1) : 0;
        const lenM = order.dispatchedLength || order.order_length || 0;
        const estNetWt = order.dispatchedWeight || Number(((lenM / 1000) * Math.max(50, order.cores * sizeVal * 11.2)).toFixed(1));
        list.push({
          id: `ORD-DSP-${order.id}`,
          dispatchNo: `DSP-ORD-${order.id}`,
          orderId: order.id,
          batch: order.batch || `ORDER #${order.id}`,
          date: order.dispatchedAt?.split('T')[0] || new Date().toISOString().split('T')[0],
          clientName: `${order.brand} Order Dispatch`,
          destination: 'Customer / Factory Dispatch',
          brand: order.brand,
          grade: order.grade,
          sizeCores: sizeLabel,
          conductor: order.conductor,
          packagingType: isCoils ? 'COILS' : 'DRUMS',
          drumCount: drumCountNum,
          drumNos: order.dispatchedDrums?.length
            ? order.dispatchedDrums.join(', ')
            : !isCoils
            ? `${order.batch}-${order.brand}-${sizeStr}-D1..D${drumCountNum}`
            : undefined,
          spoolSize: order.spool_size,
          lengthM: lenM,
          netWeightKg: estNetWt,
          grossWeightKg: Number((estNetWt + drumCountNum * 25).toFixed(1)),
          vehicleOrContainerNo: 'Synced from 1. Order Sheet',
          remarks: 'Auto-synced from 1. Order Sheet / 2. Completed Orders (Marked Dispatched)',
          status: 'Dispatched',
          createdAt: order.dispatchedAt || new Date().toISOString(),
        });
      }
    });

    return list;
  }, [dispatchRecords, dispatchedContainers, orders]);

  // Unique batches for filter dropdown
  const uniqueBatches = useMemo(() => {
    return Array.from(new Set(allDispatches.map(r => r.batch))).filter(Boolean).sort();
  }, [allDispatches]);

  // Filtered dispatches
  const filteredDispatches = useMemo(() => {
    return allDispatches.filter(r => {
      if (filterBatch && r.batch !== filterBatch) return false;
      if (filterType !== 'ALL' && r.packagingType !== filterType) return false;
      if (filterStatus !== 'ALL' && r.status !== filterStatus) return false;

      if (clientDestFilter.trim()) {
        const cdQuery = clientDestFilter.toLowerCase().trim();
        const clientOrDest = `${r.clientName || ''} ${r.destination || ''}`.toLowerCase();
        if (!clientOrDest.includes(cdQuery)) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hay = `${r.batch} ${r.dispatchNo} ${r.clientName} ${r.destination} ${r.brand} ${r.grade} ${r.sizeCores} ${r.drumNos || ''} ${r.cartonIds || ''} ${r.vehicleOrContainerNo || ''} ${r.sealNo || ''} ${r.challanNo || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allDispatches, filterBatch, filterType, filterStatus, clientDestFilter, searchQuery]);

  // KPI Metrics
  const metrics = useMemo(() => {
    let totalLen = 0;
    let totalNetWt = 0;
    let totalGrossWt = 0;
    let totalDrums = 0;
    let totalCartons = 0;
    const batchSet = new Set<string>();

    filteredDispatches.forEach(r => {
      totalLen += r.lengthM || 0;
      totalNetWt += r.netWeightKg || 0;
      totalGrossWt += r.grossWeightKg || 0;
      totalDrums += r.drumCount || 0;
      totalCartons += r.cartonCount || 0;
      if (r.batch) batchSet.add(r.batch);
    });

    return {
      totalLen,
      totalNetWt,
      totalGrossWt,
      totalDrums,
      totalCartons,
      batchesCount: batchSet.size,
      recordsCount: filteredDispatches.length,
    };
  }, [filteredDispatches]);

  // Specific lookups for JOB NO 33 (User's high-priority requirement)
  const job33Records = useMemo(() => {
    return allDispatches.filter(r => r.batch.toUpperCase().includes('JOB NO 33') || r.batch.includes('33'));
  }, [allDispatches]);

  const handleOpenNewModal = (prefillBatch?: string) => {
    setEditingRecord(null);
    setFormBatch(prefillBatch || '');
    setFormDispatchNo(`DSP-${Date.now().toString().slice(-4)}`);
    setFormDate(new Date().toISOString().split('T')[0]);
    setFormClient('');
    setFormDestination('');
    setFormBrand('');
    setFormGrade('');
    setFormSizeCores('');
    setFormConductor('');
    setFormPkgType('DRUMS');
    setFormDrumCount('1');
    setFormDrumNos('');
    setFormSpoolSize('');
    setFormPalletSize('');
    setFormCartonCount('0');
    setFormCartonIds('');
    setFormLengthM('0');
    setFormNetWeight('0');
    setFormGrossWeight('0');
    setFormVehicle('');
    setFormSealNo('');
    setFormBookingNo('');
    setFormChallanNo('');
    setFormDriver('');
    setFormRemarks('');
    setFormStatus('Dispatched');
    setIsNewModalOpen(true);
  };

  const handleEditRecord = (rec: DispatchRecord) => {
    setEditingRecord(rec);
    setFormBatch(rec.batch);
    setFormDispatchNo(rec.dispatchNo);
    setFormDate(rec.date);
    setFormClient(rec.clientName);
    setFormDestination(rec.destination);
    setFormBrand(rec.brand);
    setFormGrade(rec.grade);
    setFormSizeCores(rec.sizeCores);
    setFormConductor(rec.conductor || '');
    setFormPkgType(rec.packagingType);
    setFormDrumCount(String(rec.drumCount || 0));
    setFormDrumNos(rec.drumNos || '');
    setFormSpoolSize(rec.spoolSize || '');
    setFormPalletSize(rec.palletSize || '');
    setFormCartonCount(String(rec.cartonCount || 0));
    setFormCartonIds(rec.cartonIds || '');
    setFormLengthM(String(rec.lengthM || 0));
    setFormNetWeight(String(rec.netWeightKg || 0));
    setFormGrossWeight(String(rec.grossWeightKg || 0));
    setFormVehicle(rec.vehicleOrContainerNo || '');
    setFormSealNo(rec.sealNo || '');
    setFormBookingNo(rec.bookingNo || '');
    setFormChallanNo(rec.challanNo || '');
    setFormDriver(rec.driverOrOperator || '');
    setFormRemarks(rec.remarks || '');
    setFormStatus(rec.status);
    setIsNewModalOpen(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: DispatchRecord = {
      id: editingRecord ? editingRecord.id : `DSP-${Date.now()}`,
      dispatchNo: formDispatchNo.trim() || `DSP-${Date.now().toString().slice(-4)}`,
      batch: formBatch.trim() || 'JOB NO 33',
      date: formDate,
      clientName: formClient.trim(),
      destination: formDestination.trim(),
      brand: formBrand.trim(),
      grade: formGrade.trim(),
      sizeCores: formSizeCores.trim(),
      conductor: formConductor.trim(),
      packagingType: formPkgType,
      drumCount: Number(formDrumCount) || 0,
      drumNos: formDrumNos.trim(),
      spoolSize: formSpoolSize.trim(),
      palletSize: formPalletSize.trim(),
      cartonCount: Number(formCartonCount) || 0,
      cartonIds: formCartonIds.trim(),
      lengthM: Number(formLengthM) || 0,
      netWeightKg: Number(formNetWeight) || 0,
      grossWeightKg: Number(formGrossWeight) || 0,
      vehicleOrContainerNo: formVehicle.trim(),
      sealNo: formSealNo.trim(),
      bookingNo: formBookingNo.trim(),
      challanNo: formChallanNo.trim(),
      driverOrOperator: formDriver.trim(),
      remarks: formRemarks.trim(),
      status: formStatus,
      createdAt: editingRecord?.createdAt || new Date().toISOString(),
    };

    if (editingRecord) {
      onUpdateDispatchRecord(payload);
    } else {
      onAddDispatchRecord(payload);
    }
    setIsNewModalOpen(false);
  };

  const handleExportCSV = () => {
    const headers = [
      'Dispatch No',
      'Date',
      'Batch / Job No',
      'Client / Consignee',
      'Destination',
      'Brand',
      'Grade',
      'Cable Size',
      'Conductor',
      'Packaging Type',
      'Drums Count',
      'Drum Serial Nos',
      'Spool Size',
      'Cartons Count',
      'Carton IDs',
      'Dispatched Length (m)',
      'Net Weight (kg)',
      'Gross Weight (kg)',
      'Container / Vehicle No',
      'Seal No',
      'Booking No',
      'Challan No',
      'Officer / Driver',
      'Status',
      'Remarks',
    ];

    const rows: (string | number)[][] = [headers];
    filteredDispatches.forEach(r => {
      rows.push([
        r.dispatchNo,
        r.date,
        r.batch,
        r.clientName,
        r.destination,
        r.brand,
        r.grade,
        r.sizeCores,
        r.conductor || '-',
        r.packagingType,
        r.drumCount || 0,
        r.drumNos || '-',
        r.spoolSize || '-',
        r.cartonCount || 0,
        r.cartonIds || '-',
        r.lengthM,
        r.netWeightKg.toFixed(2),
        r.grossWeightKg.toFixed(2),
        r.vehicleOrContainerNo || '-',
        r.sealNo || '-',
        r.bookingNo || '-',
        r.challanNo || '-',
        r.driverOrOperator || '-',
        r.status,
        r.remarks || '-',
      ]);
    });

    exportCsvFile(`Master_Dispatch_Details_Ledger_${new Date().toISOString().split('T')[0]}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & Title */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 text-white rounded-xl p-4 shadow-md flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600 rounded-lg shadow-sm">
            <Truck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-wide flex items-center gap-2">
              <span>MASTER DISPATCH DETAILS &amp; DELIVERY LEDGER</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-extrabold uppercase">
                Active &amp; Historical Dispatches
              </span>
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Permanent central storage for all finished cable dispatches, container stuffing logs, drum serials, and delivery challans.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap no-print">
          <button
            onClick={() => handleOpenNewModal('JOB NO 33')}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Record New Dispatch</span>
          </button>
          <button
            onClick={handleExportCSV}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Ledger</span>
          </button>
          <button
            onClick={() => setIsClearModalOpen(true)}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            title="Manually clear or delete dispatch records"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Dispatches</span>
          </button>
        </div>
      </div>

      {/* Live Dispatch Data Sources Pipeline Banner */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-2xs no-print">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-black uppercase tracking-wider">
              Where Dispatch Details Come From (4 Connected Sources)
            </span>
            <span className="text-[11px] text-slate-600 font-semibold">
              This ledger automatically collects dispatches from Packing List, Container Planning, Order Sheet, and Manual Challans:
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
          <div
            onClick={() => onNavigateTab && onNavigateTab('packing')}
            className="bg-white border border-slate-200 hover:border-blue-400 rounded-lg p-2.5 cursor-pointer transition-colors flex flex-col justify-between"
          >
            <div>
              <div className="font-black text-blue-900 flex items-center justify-between">
                <span>1. Tab 6: Packing List</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Clicking <strong>"Dispatch Reel"</strong> or <strong>"Dispatch Batch"</strong> in Packing List automatically logs the drum serials &amp; weights here.
              </p>
            </div>
            <div className="mt-1.5 text-[10px] font-bold text-blue-700">Go to 6. Packing List →</div>
          </div>

          <div
            onClick={() => onNavigateTab && onNavigateTab('container-planning')}
            className="bg-white border border-slate-200 hover:border-indigo-400 rounded-lg p-2.5 cursor-pointer transition-colors flex flex-col justify-between"
          >
            <div>
              <div className="font-black text-indigo-900 flex items-center justify-between">
                <span>2. Tab 6B: Container Planning</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-indigo-600" />
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Marking a stuffed 20ft/40ft container as <strong>"Dispatched"</strong> feeds the container, seal no, &amp; drums directly into this ledger.
              </p>
            </div>
            <div className="mt-1.5 text-[10px] font-bold text-indigo-700">
              {dispatchedContainers.length} Dispatched Container(s) Synced →
            </div>
          </div>

          <div
            onClick={() => onNavigateTab && onNavigateTab('orders')}
            className="bg-white border border-slate-200 hover:border-emerald-400 rounded-lg p-2.5 cursor-pointer transition-colors flex flex-col justify-between"
          >
            <div>
              <div className="font-black text-emerald-900 flex items-center justify-between">
                <span>3. Tab 1: Order Sheet</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Orders marked <strong>Dispatched</strong> on the Order Sheet or picked via <strong>Order Sheet Quick-Pick</strong> in "+ Record New Dispatch".
              </p>
            </div>
            <div className="mt-1.5 text-[10px] font-bold text-emerald-700">
              {orders.length} Order Sheet Items Available →
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-between">
            <div>
              <div className="font-black text-amber-900 flex items-center justify-between">
                <span>4. Direct / Pre-Loaded Ledger</span>
                <Truck className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Includes initial sample shipments (e.g. JOB NO 33) or challans added via <strong>+ Record New Dispatch</strong>. Use <strong>Clear Dispatches</strong> to reset.
              </p>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold text-amber-800">{dispatchRecords.length} Stored Record(s)</span>
              <button
                onClick={() => setIsClearModalOpen(true)}
                className="text-[10px] font-extrabold text-rose-600 hover:underline cursor-pointer"
              >
                Clear Sample Data
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* High-Priority Callout Card: JOB NO 33 LATEST DISPATCH DETAILS (shown when JOB NO 33 records exist) */}
      {job33Records.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50 via-rose-50 to-indigo-50 border-2 border-amber-400 rounded-xl p-3.5 shadow-sm space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 pb-2">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-amber-700 text-white font-black text-xs uppercase tracking-wide">
                ⭐ JOB NO 33 DISPATCH DETAILS
              </span>
              <span className="text-xs font-black text-slate-900">
                Found {job33Records.length} Verified Dispatch Record(s) for JOB NO 33
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSearchQuery('JOB NO 33');
                  setFilterBatch('JOB NO 33');
                }}
                className="text-[11px] px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded shadow-2xs cursor-pointer"
              >
                🔍 Filter Only JOB NO 33
              </button>
              <button
                onClick={() => handleOpenNewModal('JOB NO 33')}
                className="text-[11px] px-2.5 py-1 bg-white hover:bg-amber-100 text-amber-900 border border-amber-400 font-extrabold rounded shadow-2xs cursor-pointer"
              >
                + Add Another JOB 33 Dispatch
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
            {job33Records.map(j => {
              const jReels = expandDispatchedReelsForRecord(j);
              return (
                <div
                  key={j.id}
                  className="bg-white/90 border border-amber-300 rounded-lg p-2.5 shadow-2xs space-y-1.5 text-xs hover:border-amber-500 transition-colors"
                >
                  <div className="flex items-center justify-between font-extrabold text-slate-900">
                    <span className="font-mono text-indigo-700">{j.dispatchNo}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 font-black">
                      {j.status}
                    </span>
                  </div>
                  <div className="font-black text-slate-950 text-sm">
                    {j.brand} • {j.sizeCores} ({j.grade})
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-700">
                    <div><strong>Length:</strong> <span className="font-bold text-blue-700">{j.lengthM.toLocaleString()} m</span></div>
                    <div><strong>Packaging:</strong> <span className="font-bold text-amber-900">{j.drumCount ? `${j.drumCount} Drums` : `${j.cartonCount} Cartons`}</span></div>
                    <div><strong>Gross Wt:</strong> {j.grossWeightKg.toFixed(2)} kg</div>
                    <div><strong>Date:</strong> {j.date}</div>
                  </div>
                  <div className="text-[10px] text-slate-600 truncate">
                    <strong>To:</strong> {j.clientName} ({j.destination})
                  </div>
                  <div className="text-[10px] text-slate-600 truncate">
                    <strong>Vehicle/Cont:</strong> {j.vehicleOrContainerNo}
                  </div>
                  <div className="bg-indigo-50/80 p-1.5 rounded border border-indigo-200 space-y-1">
                    <div className="text-[9.5px] font-extrabold text-indigo-950 flex items-center justify-between">
                      <span>Click a Dispatched Reel for QR Code:</span>
                      <QrCode className="w-3 h-3 text-indigo-600" />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {jReels.map(reel => (
                        <button
                          key={reel.id}
                          type="button"
                          onClick={() => setActiveQrState({ reel, siblings: jReels })}
                          className="px-1.5 py-0.5 bg-white hover:bg-indigo-600 hover:text-white text-indigo-900 border border-indigo-300 rounded font-mono text-[9.5px] font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                          title={`Click to view QR Code for Reel ${reel.drumNo} (Dispatched: ${reel.dispatchDate})`}
                        >
                          <QrCode className="w-2.5 h-2.5 shrink-0" />
                          <span>{reel.drumNo}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    <button
                      onClick={() => setViewingChallanRecord(j)}
                      className="text-[10.5px] text-blue-700 hover:text-blue-900 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <FileText className="w-3 h-3" /> View / Print Challan
                    </button>
                    <div className="flex items-center gap-2">
                      {jReels.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setActiveQrState({ reel: jReels[0], siblings: jReels })}
                          className="text-[10.5px] text-indigo-700 hover:text-indigo-900 font-extrabold flex items-center gap-1 cursor-pointer"
                        >
                          <QrCode className="w-3 h-3" /> Reel QR
                        </button>
                      )}
                      <button
                        onClick={() => handleEditRecord(j)}
                        className="text-[10.5px] text-slate-600 hover:text-indigo-600 font-semibold"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* KPI Overview Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
        <div className="bg-white border border-slate-200 border-l-4 border-l-blue-600 rounded-lg p-3">
          <div className="text-[10px] font-bold text-slate-500 uppercase">Total Dispatches</div>
          <div className="text-xl font-black text-slate-900 mt-0.5">{metrics.recordsCount} Shipments</div>
          <div className="text-[10px] text-slate-400 mt-0.5">{metrics.batchesCount} Batches / Jobs</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-blue-600 rounded-lg p-3">
          <div className="text-[10px] font-bold text-slate-500 uppercase">Total Cable Length</div>
          <div className="text-xl font-black text-blue-700 mt-0.5">{(metrics.totalLen / 1000).toFixed(1)} km</div>
          <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{metrics.totalLen.toLocaleString()} m</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-blue-600 rounded-lg p-3">
          <div className="text-[10px] font-bold text-slate-500 uppercase">Total Drums Dispatched</div>
          <div className="text-xl font-black text-indigo-700 mt-0.5">{metrics.totalDrums} Drums</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Spool shipments</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-blue-600 rounded-lg p-3">
          <div className="text-[10px] font-bold text-slate-500 uppercase">Master Cartons</div>
          <div className="text-xl font-black text-rose-700 mt-0.5">{metrics.totalCartons} Cartons</div>
          <div className="text-[10px] text-slate-400 mt-0.5">IS-694 / Coil cartons</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-blue-600 rounded-lg p-3">
          <div className="text-[10px] font-bold text-slate-500 uppercase">Net Cable Weight</div>
          <div className="text-xl font-black text-emerald-700 mt-0.5">{(metrics.totalNetWt / 1000).toFixed(2)} T</div>
          <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{metrics.totalNetWt.toFixed(1)} kg</div>
        </div>
        <div className="bg-white border border-slate-200 border-l-4 border-l-blue-600 rounded-lg p-3">
          <div className="text-[10px] font-bold text-slate-500 uppercase">Gross Dispatch Wt</div>
          <div className="text-xl font-black text-slate-900 mt-0.5">{(metrics.totalGrossWt / 1000).toFixed(2)} T</div>
          <div className="text-[10px] text-slate-400 mt-0.5">With reels &amp; pallets</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-1 min-w-[260px] flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Job No (e.g. JOB NO 33), Brand, Drum No, Container No, Seal No..."
              className="w-full pl-9 pr-7 py-1.5 text-xs border border-slate-300 rounded-lg font-semibold focus:border-blue-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                title="Clear general search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Dedicated Client Name or Destination Filter Input */}
          <div className="relative flex-1 min-w-[230px]">
            <MapPin className="w-4 h-4 text-indigo-600 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={clientDestFilter}
              onChange={(e) => setClientDestFilter(e.target.value)}
              placeholder="Filter by Client Name or Destination (e.g. Export Client, Port)..."
              className="w-full pl-9 pr-7 py-1.5 text-xs border border-indigo-300 bg-indigo-50/40 rounded-lg font-semibold text-slate-900 placeholder:text-slate-500 focus:border-indigo-600 focus:bg-white focus:outline-none"
              title="Filter dispatch records specifically by Client / Consignee Name or Destination"
            />
            {clientDestFilter && (
              <button
                onClick={() => setClientDestFilter('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                title="Clear Client / Destination filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={filterBatch}
            onChange={(e) => setFilterBatch(e.target.value)}
            className="px-2.5 py-1.5 text-xs font-bold border border-slate-300 rounded-lg bg-white text-slate-800"
          >
            <option value="">All Batches ({uniqueBatches.length})</option>
            {uniqueBatches.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-2 py-1.5 text-xs font-bold border border-slate-300 rounded-lg bg-white text-slate-800"
          >
            <option value="ALL">All Packaging Types</option>
            <option value="DRUMS">Drums Only</option>
            <option value="CARTONS">Cartons / Coils</option>
            <option value="CONTAINER">Container Loads</option>
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-2 py-1.5 text-xs font-bold border border-slate-300 rounded-lg bg-white text-slate-800"
          >
            <option value="ALL">All Status</option>
            <option value="Dispatched">Dispatched</option>
            <option value="In Transit">In Transit</option>
            <option value="Delivered">Delivered</option>
          </select>

          {(searchQuery || clientDestFilter || filterBatch || filterType !== 'ALL' || filterStatus !== 'ALL') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setClientDestFilter('');
                setFilterBatch('');
                setFilterType('ALL');
                setFilterStatus('ALL');
              }}
              className="px-2.5 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Selected records floating action bar */}
      {selectedIds.length > 0 && (
        <div className="bg-rose-50 border-2 border-rose-400 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs shadow-xs animate-in fade-in no-print">
          <div className="flex items-center gap-2 font-black text-rose-950">
            <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-[10px] font-black">
              {selectedIds.length}
            </span>
            <span>{selectedIds.length} dispatch record(s) selected for manual clearing</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                selectedIds.forEach(id => onDeleteDispatchRecord(id));
                setSelectedIds([]);
              }}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-lg text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Selected ({selectedIds.length})
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-lg text-xs border border-slate-300 cursor-pointer"
            >
              Cancel Selection
            </button>
          </div>
        </div>
      )}

      {/* Dispatched Reels Quick-Scan QR Code Bar */}
      {filteredDispatches.length > 0 && (
        <div className="bg-indigo-950 text-white border border-indigo-800 rounded-xl p-3 shadow-xs space-y-2 no-print">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-indigo-600 rounded-lg">
                <QrCode className="w-4 h-4 text-white" />
              </span>
              <div>
                <div className="text-xs font-black tracking-wide uppercase flex items-center gap-2">
                  <span>Dispatched Reels QR Code Quick-Scanner</span>
                  <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full text-[10px] font-extrabold">
                    Click Any Reel Below to Scan QR Code
                  </span>
                </div>
                <div className="text-[11px] text-indigo-200">
                  Each QR code encodes the reel&apos;s unique drum number and dispatch date for instant handheld or mobile scanning.
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-1">
            {filteredDispatches.flatMap(rec => {
              const reels = expandDispatchedReelsForRecord(rec);
              return reels.map(reel => (
                <button
                  key={reel.id}
                  type="button"
                  onClick={() => setActiveQrState({ reel, siblings: reels })}
                  className="px-2.5 py-1 bg-slate-900 hover:bg-indigo-600 text-white border border-indigo-500/50 rounded-lg text-[11px] font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                  title={`Click to open QR Code for ${reel.drumNo} (Dispatched: ${reel.dispatchDate})`}
                >
                  <QrCode className="w-3 h-3 text-amber-400 shrink-0" />
                  <span className="text-amber-200">{reel.drumNo}</span>
                  <span className="text-[9.5px] text-indigo-300 font-sans">({reel.dispatchDate})</span>
                </button>
              ));
            })}
          </div>
        </div>
      )}

      {/* Master Dispatch Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden print-card">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-2 border-r border-slate-200 text-center w-8 no-print">
                  <input
                    type="checkbox"
                    checked={
                      selectedIds.length > 0 &&
                      selectedIds.length === filteredDispatches.length
                    }
                    onChange={() => {
                      if (selectedIds.length === filteredDispatches.length) {
                        setSelectedIds([]);
                      } else {
                        setSelectedIds(filteredDispatches.map(r => r.id));
                      }
                    }}
                    className="rounded border-slate-300 cursor-pointer"
                    title="Select all displayed dispatch records"
                  />
                </th>
                <th className="p-2.5 border-r border-slate-200 text-center w-10">#</th>
                <th className="p-2.5 border-r border-slate-200">Dispatch Ref / Date</th>
                <th className="p-2.5 border-r border-slate-200 bg-amber-50 text-amber-950 font-black">Batch / Job No</th>
                <th className="p-2.5 border-r border-slate-200">Client / Consignee</th>
                <th className="p-2.5 border-r border-slate-200">Destination</th>
                <th className="p-2.5 border-r border-slate-200">Brand &amp; Grade</th>
                <th className="p-2.5 border-r border-slate-200">Cable Size &amp; Cores</th>
                <th className="p-2.5 border-r border-slate-200 text-center">Packaging / Qty</th>
                <th className="p-2.5 border-r border-slate-200">Drum Serial Nos / Carton IDs</th>
                <th className="p-2.5 border-r border-slate-200 text-right">Length (m)</th>
                <th className="p-2.5 border-r border-slate-200 text-right">Gross Wt (kg)</th>
                <th className="p-2.5 border-r border-slate-200">Vehicle / Container No</th>
                <th className="p-2.5 border-r border-slate-200 text-center">Status</th>
                <th className="p-2.5 text-center no-print">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDispatches.length === 0 ? (
                <tr>
                  <td colSpan={15} className="p-8 text-center">
                    <div className="max-w-md mx-auto space-y-2">
                      <div className="inline-flex p-3 rounded-full bg-slate-100 text-slate-400">
                        <Truck className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-bold text-slate-800">No dispatch records match your search</p>
                      <p className="text-xs text-slate-500">
                        {searchQuery ? `No results found for "${searchQuery}".` : 'No dispatch entries recorded yet.'} Try searching for a different batch (e.g. JOB NO 33), clearing filters, or recording a new dispatch.
                      </p>
                      <button
                        onClick={() => handleOpenNewModal(searchQuery || 'JOB NO 33')}
                        className="mt-2 text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" /> + Record Dispatch for {searchQuery || 'JOB NO 33'}
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredDispatches.map((r, idx) => {
                  const isJob33 = r.batch.toUpperCase().includes('JOB NO 33') || r.batch.includes('33');
                  const recordReels = expandDispatchedReelsForRecord(r);
                  return (
                    <tr
                      key={r.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        isJob33 ? 'bg-amber-50/40' : ''
                      }`}
                    >
                      <td className="p-2 border-r border-slate-100 text-center no-print">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(r.id)}
                          onChange={() =>
                            setSelectedIds(prev =>
                              prev.includes(r.id)
                                ? prev.filter(x => x !== r.id)
                                : [...prev, r.id]
                            )
                          }
                          className="rounded border-slate-300 cursor-pointer"
                        />
                      </td>
                      <td className="p-2.5 border-r border-slate-100 text-center font-bold text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="p-2.5 border-r border-slate-100">
                        <div className="font-mono font-extrabold text-indigo-950 text-xs">{r.dispatchNo}</div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{r.date}</span>
                        </div>
                      </td>
                      <td className="p-2.5 border-r border-slate-100 bg-amber-50/70">
                        <span className="font-mono font-black text-amber-950 text-xs px-2 py-0.5 rounded bg-amber-200/90 border border-amber-300">
                          {r.batch}
                        </span>
                      </td>
                      <td className="p-2.5 border-r border-slate-100 font-bold text-slate-800 truncate max-w-[170px]" title={r.clientName}>
                        {r.clientName || 'Export Consignee'}
                      </td>
                      <td className="p-2.5 border-r border-slate-100 truncate max-w-[160px] text-slate-700" title={r.destination}>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-rose-500 shrink-0" />
                          <span>{r.destination || 'Client Port'}</span>
                        </div>
                      </td>
                      <td className="p-2.5 border-r border-slate-100">
                        <div className="font-bold text-slate-900">{r.brand}</div>
                        <div className="text-[10px] text-slate-500">{r.grade}</div>
                      </td>
                      <td className="p-2.5 border-r border-slate-100">
                        <div className="font-bold text-slate-900">{r.sizeCores}</div>
                        {r.conductor && <div className="text-[9.5px] font-mono text-slate-500">{r.conductor}</div>}
                      </td>
                      <td className="p-2.5 border-r border-slate-100 text-center">
                        {r.packagingType === 'DRUMS' ? (
                          <button
                            type="button"
                            onClick={() =>
                              recordReels.length > 0 &&
                              setActiveQrState({ reel: recordReels[0], siblings: recordReels })
                            }
                            className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 hover:bg-blue-200 text-blue-900 border border-blue-300 inline-flex items-center gap-1 cursor-pointer transition-colors"
                            title="Click to view QR Code for Dispatched Reels"
                          >
                            <QrCode className="w-3 h-3 text-blue-700" />
                            <span>📦 {r.drumCount || 1} Drums</span>
                          </button>
                        ) : r.packagingType === 'CARTONS' ? (
                          <button
                            type="button"
                            onClick={() =>
                              recordReels.length > 0 &&
                              setActiveQrState({ reel: recordReels[0], siblings: recordReels })
                            }
                            className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 hover:bg-rose-200 text-rose-900 border border-rose-300 inline-flex items-center gap-1 cursor-pointer transition-colors"
                            title="Click to view QR Code"
                          >
                            <QrCode className="w-3 h-3 text-rose-700" />
                            <span>📦 {r.cartonCount} Cartons ({r.coilsCount} Coils)</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              recordReels.length > 0 &&
                              setActiveQrState({ reel: recordReels[0], siblings: recordReels })
                            }
                            className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 hover:bg-indigo-200 text-indigo-900 border border-indigo-300 inline-flex items-center gap-1 cursor-pointer transition-colors"
                            title="Click to view Container Reel QR Codes"
                          >
                            <QrCode className="w-3 h-3 text-indigo-700" />
                            <span>🚢 Container Load</span>
                          </button>
                        )}
                        {r.spoolSize && (
                          <div className="text-[9.5px] font-mono text-slate-500 mt-0.5">
                            {r.spoolSize}
                          </div>
                        )}
                      </td>
                      <td className="p-2.5 border-r border-slate-100 max-w-[280px] whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {recordReels.slice(0, 6).map(reel => (
                            <button
                              key={reel.id}
                              type="button"
                              onClick={() => setActiveQrState({ reel, siblings: recordReels })}
                              className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-600 text-indigo-950 hover:text-white border border-indigo-200 rounded font-mono text-[10px] font-bold inline-flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                              title={`Click to open QR Code for Reel ${reel.drumNo} (Dispatch Date: ${reel.dispatchDate})`}
                            >
                              <QrCode className="w-3 h-3 text-indigo-600 group-hover:text-white shrink-0" />
                              <span>{reel.drumNo}</span>
                            </button>
                          ))}
                          {recordReels.length > 6 && (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveQrState({ reel: recordReels[0], siblings: recordReels })
                              }
                              className="px-1.5 py-0.5 bg-slate-100 hover:bg-indigo-100 text-slate-700 rounded text-[10px] font-bold cursor-pointer"
                            >
                              +{recordReels.length - 6} more QR reels
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="p-2.5 border-r border-slate-100 text-right font-black text-blue-700">
                        {r.lengthM.toLocaleString()} m
                      </td>
                      <td className="p-2.5 border-r border-slate-100 text-right font-bold text-slate-900">
                        {r.grossWeightKg.toFixed(2)} kg
                      </td>
                      <td className="p-2.5 border-r border-slate-100 text-xs">
                        <div className="font-bold text-slate-800">{r.vehicleOrContainerNo || '-'}</div>
                        {r.sealNo && (
                          <div className="text-[9.5px] text-slate-500 font-mono">
                            Seal: {r.sealNo}
                          </div>
                        )}
                      </td>
                      <td className="p-2.5 border-r border-slate-100 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                            r.status === 'Delivered'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : r.status === 'In Transit'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'bg-blue-100 text-blue-800 border border-blue-300'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="p-2.5 text-center no-print">
                        <div className="flex items-center justify-center gap-1">
                          {recordReels.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveQrState({ reel: recordReels[0], siblings: recordReels })
                              }
                              className="p-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white border border-indigo-200 rounded cursor-pointer transition-colors"
                              title="Show Dispatched Reel QR Code"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => setViewingChallanRecord(r)}
                            className="p-1 hover:bg-blue-50 text-blue-600 rounded"
                            title="View / Print Delivery Challan"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleEditRecord(r)}
                            className="p-1 hover:bg-slate-100 text-slate-600 rounded"
                            title="Edit Dispatch Details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {confirmDeleteId === r.id ? (
                            <div className="inline-flex items-center gap-1 bg-rose-50 p-0.5 rounded border border-rose-300 animate-in fade-in">
                              <span className="text-[9px] font-black text-rose-900">Delete?</span>
                              <button
                                onClick={() => {
                                  onDeleteDispatchRecord(r.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="px-1.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white text-[9.5px] font-black rounded cursor-pointer"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[9.5px] font-bold rounded cursor-pointer"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(r.id)}
                              className="p-1 hover:bg-rose-50 text-rose-600 rounded cursor-pointer"
                              title="Delete Dispatch Record"
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

      {/* Record / Edit Dispatch Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-sm">
                  {editingRecord ? `Edit Dispatch #${editingRecord.dispatchNo}` : 'Record New Finished Cable Dispatch'}
                </h3>
              </div>
              <button
                onClick={() => setIsNewModalOpen(false)}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="p-5 space-y-4 text-xs">
              {/* Quick-Pick from 1. Order Sheet */}
              {orders.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <label className="block text-[10px] font-black text-blue-900 uppercase mb-1">
                    ⚡ Quick-Pick Cable from 1. Order Sheet (Auto-Fills Batch, Size, Brand, Grade, Drums &amp; Length)
                  </label>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const ordId = Number(e.target.value);
                      const picked = orders.find(o => o.id === ordId);
                      if (!picked) return;
                      const sizeVal = parseFloat(picked.size) || 0;
                      const sizeStr = sizeVal > 0 ? sizeVal.toFixed(2) : picked.size;
                      const coilsRaw = String(picked.coils || '1').toUpperCase();
                      const isCoils = coilsRaw.includes('COIL');
                      const dCount = !isCoils ? Math.max(1, parseInt(coilsRaw, 10) || 1) : 0;
                      const lenM = picked.order_length || 0;
                      const estNet = Number(((lenM / 1000) * Math.max(50, picked.cores * sizeVal * 11.2)).toFixed(1));
                      setFormBatch(picked.batch);
                      setFormBrand(picked.brand);
                      setFormGrade(picked.grade);
                      setFormSizeCores(`${picked.cores}C × ${sizeStr} SQ MM`);
                      setFormConductor(picked.conductor || '');
                      setFormPkgType(isCoils ? 'COILS' : 'DRUMS');
                      setFormDrumCount(String(dCount));
                      setFormDrumNos(!isCoils ? `${picked.batch}-${picked.brand}-${sizeStr}-D1..D${dCount}` : '');
                      setFormSpoolSize(picked.spool_size || '');
                      setFormLengthM(String(lenM));
                      setFormNetWeight(String(estNet));
                      setFormGrossWeight(String(Number((estNet + dCount * 25).toFixed(1))));
                    }}
                    className="w-full px-2.5 py-1.5 border border-blue-300 rounded font-bold bg-white text-slate-900 focus:border-blue-600 focus:outline-none"
                  >
                    <option value="">-- Select an Order from 1. Order Sheet to Auto-Fill --</option>
                    {orders.map(o => {
                      const sVal = parseFloat(o.size) || 0;
                      const sStr = sVal > 0 ? sVal.toFixed(2) : o.size;
                      return (
                        <option key={o.id} value={o.id}>
                          [{o.batch}] {o.brand} {o.cores}C × {sStr} sqmm ({o.grade}) — {o.order_length}m ({o.coils || '1'} Drums/Coils)
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Batch / Job No *
                  </label>
                  <input
                    type="text"
                    required
                    value={formBatch}
                    onChange={(e) => setFormBatch(e.target.value)}
                    placeholder="e.g. JOB NO 33"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-bold bg-white text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Dispatch Ref / Invoice No *
                  </label>
                  <input
                    type="text"
                    required
                    value={formDispatchNo}
                    onChange={(e) => setFormDispatchNo(e.target.value)}
                    placeholder="e.g. DSP-2026-033-A"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono font-bold bg-white text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Dispatch Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-semibold bg-white text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Client / Consignee Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formClient}
                    onChange={(e) => setFormClient(e.target.value)}
                    placeholder="e.g. Global Marine & Industrial Cables LLC"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-semibold bg-white text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Destination / Port of Delivery *
                  </label>
                  <input
                    type="text"
                    required
                    value={formDestination}
                    onChange={(e) => setFormDestination(e.target.value)}
                    placeholder="e.g. Jebel Ali Port / Dubai UAE"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-semibold bg-white text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Brand</label>
                  <input
                    type="text"
                    value={formBrand}
                    onChange={(e) => setFormBrand(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-bold bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Grade</label>
                  <input
                    type="text"
                    value={formGrade}
                    onChange={(e) => setFormGrade(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-bold bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Size &amp; Cores *</label>
                  <input
                    type="text"
                    required
                    value={formSizeCores}
                    onChange={(e) => setFormSizeCores(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-bold bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Conductor</label>
                  <input
                    type="text"
                    value={formConductor}
                    onChange={(e) => setFormConductor(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-mono bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Packaging Type</label>
                  <select
                    value={formPkgType}
                    onChange={(e) => setFormPkgType(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-bold bg-white text-slate-800"
                  >
                    <option value="DRUMS">DRUMS</option>
                    <option value="CARTONS">CARTONS (IS-694)</option>
                    <option value="COILS">COILS PACK</option>
                    <option value="CONTAINER">CONTAINER LOAD</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    {formPkgType === 'CARTONS' ? 'No. of Master Cartons' : 'No. of Drums / Reels'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formPkgType === 'CARTONS' ? formCartonCount : formDrumCount}
                    onChange={(e) => {
                      if (formPkgType === 'CARTONS') setFormCartonCount(e.target.value);
                      else setFormDrumCount(e.target.value);
                    }}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-bold text-center bg-white text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Total Dispatched Length (m) *
                  </label>
                  <input
                    type="number"
                    required
                    value={formLengthM}
                    onChange={(e) => setFormLengthM(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono font-bold text-right bg-white text-blue-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Drum Serial Nos / Carton IDs
                  </label>
                  <input
                    type="text"
                    value={formPkgType === 'CARTONS' ? formCartonIds : formDrumNos}
                    onChange={(e) => {
                      if (formPkgType === 'CARTONS') setFormCartonIds(e.target.value);
                      else setFormDrumNos(e.target.value);
                    }}
                    placeholder="e.g. JOB NO 33-MYBCAB-120.00-D1..D2"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono bg-white text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                    Spool &amp; Pallet Size
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formSpoolSize}
                      onChange={(e) => setFormSpoolSize(e.target.value)}
                      placeholder="Spool: 42 x 12 x 30"
                      className="w-1/2 px-2 py-1.5 border border-slate-300 rounded bg-white text-slate-900 font-semibold"
                    />
                    <input
                      type="text"
                      value={formPalletSize}
                      onChange={(e) => setFormPalletSize(e.target.value)}
                      placeholder="Pallet: 42 x 42 x 5.5"
                      className="w-1/2 px-2 py-1.5 border border-slate-300 rounded bg-white text-slate-900 font-semibold"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Net Wt (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formNetWeight}
                    onChange={(e) => setFormNetWeight(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-300 rounded text-right font-bold bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Gross Wt (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formGrossWeight}
                    onChange={(e) => setFormGrossWeight(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-300 rounded text-right font-bold bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Vehicle / Container No</label>
                  <input
                    type="text"
                    value={formVehicle}
                    onChange={(e) => setFormVehicle(e.target.value)}
                    placeholder="TBC-CONT-03"
                    className="w-full px-2 py-1 border border-slate-300 rounded bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-bold bg-white text-slate-800"
                  >
                    <option value="Dispatched">Dispatched</option>
                    <option value="In Transit">In Transit</option>
                    <option value="Delivered">Delivered</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Seal No</label>
                  <input
                    type="text"
                    value={formSealNo}
                    onChange={(e) => setFormSealNo(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-mono bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Challan / Gate Pass No</label>
                  <input
                    type="text"
                    value={formChallanNo}
                    onChange={(e) => setFormChallanNo(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-300 rounded font-mono bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Officer / Driver</label>
                  <input
                    type="text"
                    value={formDriver}
                    onChange={(e) => setFormDriver(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-300 rounded bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Remarks / Inspection Notes</label>
                <textarea
                  rows={2}
                  value={formRemarks}
                  onChange={(e) => setFormRemarks(e.target.value)}
                  placeholder="Notes on packaging, testing, and transport clearance..."
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded bg-white font-medium text-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-xs flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{editingRecord ? 'Update Dispatch Record' : 'Save Dispatch Record'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delivery Challan & Gate Pass Printable Modal */}
      {viewingChallanRecord && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-300 max-w-2xl w-full max-h-[95vh] overflow-y-auto p-6 space-y-4 print-challan-document">
            {/* Document Header */}
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
              <div>
                <div className="text-xl font-black text-slate-950 tracking-wide uppercase">
                  PLUTUS CABLE MANUFACTURING &amp; EXPORT LTD
                </div>
                <div className="text-xs text-slate-600 font-medium">
                  Factory &amp; Export Division • Delivery Challan &amp; Factory Gate Pass
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-black text-blue-900 font-mono">
                  {viewingChallanRecord.challanNo || viewingChallanRecord.dispatchNo}
                </div>
                <div className="text-xs text-slate-600">
                  DATE: <span className="font-bold text-slate-900">{viewingChallanRecord.date}</span>
                </div>
              </div>
            </div>

            {/* Consignee and Transport Box */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div>
                <span className="font-bold text-slate-500 uppercase text-[10px] block">CONSIGNEE / BILLED TO:</span>
                <div className="font-extrabold text-slate-900 text-sm mt-0.5">{viewingChallanRecord.clientName}</div>
                <div className="text-slate-600 mt-0.5">{viewingChallanRecord.destination}</div>
                <div className="text-slate-600"><strong>Booking Ref:</strong> {viewingChallanRecord.bookingNo || '-'}</div>
              </div>
              <div>
                <span className="font-bold text-slate-500 uppercase text-[10px] block">TRANSPORT &amp; CONTAINER:</span>
                <div className="font-bold text-slate-900 mt-0.5"><strong>Vehicle / Container:</strong> {viewingChallanRecord.vehicleOrContainerNo || '-'}</div>
                <div className="text-slate-700"><strong>Seal No:</strong> {viewingChallanRecord.sealNo || '-'}</div>
                <div className="text-slate-700"><strong>Officer / Driver:</strong> {viewingChallanRecord.driverOrOperator || '-'}</div>
              </div>
            </div>

            {/* Shipment Items Table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-800 font-bold uppercase text-[10.5px] border-b border-slate-200">
                  <tr>
                    <th className="p-2 border-r border-slate-200">Batch / Job</th>
                    <th className="p-2 border-r border-slate-200">Description of Cable</th>
                    <th className="p-2 border-r border-slate-200 text-center">Packaging</th>
                    <th className="p-2 border-r border-slate-200 text-right">Length (m)</th>
                    <th className="p-2 border-r border-slate-200 text-right">Net Wt (kg)</th>
                    <th className="p-2 text-right">Gross Wt (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="p-2.5 border-r border-slate-200 font-mono font-black text-amber-950 bg-amber-50/40">
                      {viewingChallanRecord.batch}
                    </td>
                    <td className="p-2.5 border-r border-slate-200">
                      <div className="font-black text-slate-900">{viewingChallanRecord.brand} {viewingChallanRecord.sizeCores}</div>
                      <div className="text-[10.5px] text-slate-600">Grade: {viewingChallanRecord.grade} {viewingChallanRecord.conductor ? `(${viewingChallanRecord.conductor})` : ''}</div>
                      {viewingChallanRecord.drumNos && (
                        <div className="text-[10px] font-mono text-indigo-900 mt-0.5">
                          Serials: {viewingChallanRecord.drumNos}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 border-r border-slate-200 text-center">
                      <div className="font-bold text-slate-900">
                        {viewingChallanRecord.drumCount ? `${viewingChallanRecord.drumCount} Drums` : `${viewingChallanRecord.cartonCount} Cartons`}
                      </div>
                      <div className="text-[10px] text-slate-500">{viewingChallanRecord.spoolSize}</div>
                    </td>
                    <td className="p-2.5 border-r border-slate-200 text-right font-black text-blue-800">
                      {viewingChallanRecord.lengthM.toLocaleString()} m
                    </td>
                    <td className="p-2.5 border-r border-slate-200 text-right font-bold text-slate-800">
                      {viewingChallanRecord.netWeightKg.toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right font-black text-slate-900">
                      {viewingChallanRecord.grossWeightKg.toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Remarks */}
            <div className="bg-slate-50 p-2.5 rounded border border-slate-200 text-xs">
              <strong>Remarks / Quality Clearance:</strong> {viewingChallanRecord.remarks || 'Goods dispatched in sound export packing condition.'}
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-4 gap-4 pt-6 text-center text-xs">
              <div className="border-t border-slate-400 pt-1 font-semibold text-slate-700">
                Prepared By (Packing)
              </div>
              <div className="border-t border-slate-400 pt-1 font-semibold text-slate-700">
                Quality Inspection
              </div>
              <div className="border-t border-slate-400 pt-1 font-semibold text-slate-700">
                Security / Gate Out
              </div>
              <div className="border-t border-slate-400 pt-1 font-semibold text-slate-700">
                Receiver / Driver Sign
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 no-print">
              <button
                onClick={() => setViewingChallanRecord(null)}
                className="px-3 py-1.5 border border-slate-300 rounded font-bold text-slate-700"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1.5 shadow-xs"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Delivery Challan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Dispatches Confirmation Modal */}
      {isClearModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 text-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2 text-rose-600 font-black text-base">
                <Trash2 className="w-5 h-5" />
                <span>Clear Dispatch Details Ledger</span>
              </div>
              <button
                onClick={() => setIsClearModalOpen(false)}
                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              How would you like to clear the dispatch details? You can clear all recorded dispatches, or clear only the records matching your active filter.
            </p>

            <div className="space-y-2 pt-1">
              {(filterBatch || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    const idsToDel = filteredDispatches.map(r => r.id);
                    idsToDel.forEach(id => onDeleteDispatchRecord(id));
                    setSelectedIds([]);
                    setIsClearModalOpen(false);
                  }}
                  className="w-full px-3 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-black flex items-center justify-between cursor-pointer"
                >
                  <span>Clear only filtered records ({filteredDispatches.length} records)</span>
                  <Trash2 className="w-4 h-4 text-amber-700" />
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (onClearAllDispatches) {
                    onClearAllDispatches();
                  } else {
                    dispatchRecords.forEach(r => onDeleteDispatchRecord(r.id));
                  }
                  setSelectedIds([]);
                  setIsClearModalOpen(false);
                }}
                className="w-full px-3 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-black flex items-center justify-between shadow-xs cursor-pointer"
              >
                <span>Clear ALL dispatch records ({dispatchRecords.length} records)</span>
                <Trash2 className="w-4 h-4 text-white" />
              </button>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsClearModalOpen(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dispatched Reel QR Code Modal */}
      {activeQrState && (
        <ReelQrCodeModal
          reel={activeQrState.reel}
          siblingReels={activeQrState.siblings}
          onSelectReel={nextReel =>
            setActiveQrState(prev => (prev ? { ...prev, reel: nextReel } : null))
          }
          onClose={() => setActiveQrState(null)}
        />
      )}
    </div>
  );
};
