import React, { useState, useEffect } from 'react';
import { PurchaseItem, StockThresholdSettings } from '../types/cable';
import { exportCsvFile } from '../utils/calculations';
import {
  ShoppingCart,
  Upload,
  Plus,
  Trash2,
  Search,
  Printer,
  AlertTriangle,
  Sliders,
  CheckCircle2,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { BillUploadModal } from './BillUploadModal';
import {
  evaluateStockLevels,
  classifyPurchaseItem,
  DEFAULT_STOCK_THRESHOLDS,
  LowStockItemDetail,
} from '../utils/stockAlerts';
import { StockThresholdModal } from './StockThresholdModal';

interface TabPurchaseProps {
  items: PurchaseItem[];
  onUpdateItem: (index: number, field: keyof PurchaseItem, value: any) => void;
  onDeleteItem: (index: number) => void;
  onAddItem: (item: Omit<PurchaseItem, 'id'>) => void;
  onAddMultipleItems: (newItems: Omit<PurchaseItem, 'id'>[]) => void;
  stockThresholds?: StockThresholdSettings;
  onUpdateStockThresholds?: (thresholds: StockThresholdSettings) => void;
  initialFilterLowStock?: boolean;
}

export const TabPurchase: React.FC<TabPurchaseProps> = ({
  items,
  onUpdateItem,
  onDeleteItem,
  onAddItem,
  onAddMultipleItems,
  stockThresholds = DEFAULT_STOCK_THRESHOLDS,
  onUpdateStockThresholds,
  initialFilterLowStock = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isThresholdModalOpen, setIsThresholdModalOpen] = useState(false);
  const [uploadModalUrls, setUploadModalUrls] = useState<string[] | null>(null);
  const [filterLowStockOnly, setFilterLowStockOnly] = useState(initialFilterLowStock);

  // Sync if initialFilterLowStock changes from outside (e.g. clicking navbar badge)
  useEffect(() => {
    if (initialFilterLowStock) {
      setFilterLowStockOnly(true);
    }
  }, [initialFilterLowStock]);

  // Evaluate stock levels against thresholds in real-time
  const stockEval = evaluateStockLevels(items, stockThresholds);
  const lowItemIds = new Set(stockEval.lowItems.map(l => l.item.id));

  // Manual Add Form
  const [date, setDate] = useState('28.10.2026');
  const [invoice, setInvoice] = useState('');
  const [party, setParty] = useState('');
  const [description, setDescription] = useState('');
  const [subQty, setSubQty] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [status, setStatus] = useState<'pending' | 'ordered' | 'received'>('received');
  const [stage, setStage] = useState<'raw' | 'bunch' | 'compound' | 'drums' | 'other'>('raw');
  const [conductor, setConductor] = useState('');

  const filtered = items.filter(item => {
    if (filterLowStockOnly && !lowItemIds.has(item.id)) {
      return false;
    }
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const s = `${item.date} ${item.invoice} ${item.party} ${item.description} ${item.status}`.toLowerCase();
    return s.includes(q);
  });


  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArr = Array.from(files);
    let loaded = 0;
    const urls: string[] = [];

    fileArr.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) urls.push(ev.target.result as string);
        loaded++;
        if (loaded === fileArr.length) {
          setUploadModalUrls(urls);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleManualAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = parseFloat(qty) || 0;
    const p = parseFloat(price) || 0;
    if (!party.trim() || !description.trim() || q <= 0) {
      alert('Please fill in Party, Item Description, and valid Quantity.');
      return;
    }

    onAddItem({
      date: date.trim() || '28.10.2026',
      invoice: invoice.trim() || 'INV-001',
      party: party.trim(),
      description: description.trim(),
      subQty: subQty.trim(),
      qty: q,
      price: p,
      status,
      stage,
      conductor: conductor.trim() || undefined,
      usedQty: 0,
    });

    setIsAddModalOpen(false);
    setInvoice('');
    setParty('');
    setDescription('');
    setConductor('');
    setQty('');
    setPrice('');
    setStage('raw');
  };

  const handleExportCSV = () => {
    const rows: (string | number)[][] = [
      ['Date', 'Invoice Number', 'PARTY', 'Material Stage', 'Conductor', 'Item Description', 'Sub Qty', 'Total Qty (kg)', 'Used/Deducted (kg)', 'Available Balance (kg)', 'Unit Price', 'Total Amount', 'Status'],
    ];
    filtered.forEach(i => {
      const totalAmount = i.qty * i.price;
      const used = i.usedQty || 0;
      const avail = Math.max(0, i.qty - used);
      rows.push([
        i.date, i.invoice, i.party, i.stage || 'raw', i.conductor || '', i.description, i.subQty ?? '', i.qty, used, avail, i.price, totalAmount.toFixed(2), i.status
      ]);
    });
    exportCsvFile('PLUTUS_RAW_MATERIAL_PURCHASES.csv', rows);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-4 print-card">
      {/* Header & Actions */}
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-200 gap-2">
        <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
          <ShoppingCart className="w-4 h-4 text-blue-600" />
          <span>🛒 PLUTUS CABLE - RAW MATERIAL PURCHASES & AI BILL / INVOICE UPLOAD</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap no-print">
          <div className="relative">
            <input
              type="text"
              placeholder="Search Party, Item, Invoice..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs pl-7 pr-2.5 py-1.5 border border-slate-300 rounded w-48 bg-white"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          </div>

          <label className="text-xs px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded font-bold flex items-center gap-1 cursor-pointer shadow-xs">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Bill PDF / Document</span>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="text-xs px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" /> Add Purchase Entry
          </button>

          <button
            onClick={handleExportCSV}
            className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold"
          >
            ⬇ Export CSV
          </button>

          <button
            onClick={() => window.print()}
            className="text-xs px-2.5 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold flex items-center gap-1.5 shadow-xs"
            title="Print current page"
          >
            <Printer className="w-3.5 h-3.5 text-slate-600" />
            <span>Print current page</span>
          </button>
        </div>
      </div>

      {/* Real-time Low Stock Alert Banner & Filter Bar */}
      <div className={`p-3 rounded-xl border no-print flex flex-wrap items-center justify-between gap-3 ${
        stockEval.hasLowStock
          ? 'bg-amber-50/90 border-amber-300 text-amber-950'
          : 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
      }`}>
        <div className="flex items-center gap-2.5 flex-wrap">
          {stockEval.hasLowStock ? (
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-red-600 text-white rounded-lg animate-pulse shadow-xs">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <div>
                <div className="text-xs font-bold text-red-950 flex items-center gap-2">
                  <span>⚠️ RAW MATERIAL LOW STOCK ALERT:</span>
                  <span className="bg-red-200/80 text-red-900 px-2 py-0.5 rounded-full text-[11px] font-extrabold border border-red-300">
                    {stockEval.lowItems.length} {stockEval.lowItems.length === 1 ? 'item' : 'items'} below threshold
                  </span>
                </div>
                <div className="text-[11px] text-amber-900 mt-0.5 flex items-center gap-3 font-medium">
                  <span>
                    Copper: <b className={stockEval.copperLowCount > 0 ? 'text-red-700 font-bold' : 'text-slate-800'}>{stockEval.copperLowCount} low</b> ({stockEval.totalCopperAvailable.toFixed(1)} kg avail / limit: {stockThresholds.copperThreshold} kg)
                  </span>
                  <span>•</span>
                  <span>
                    PVC/Compound: <b className={stockEval.pvcLowCount > 0 ? 'text-red-700 font-bold' : 'text-slate-800'}>{stockEval.pvcLowCount} low</b> ({stockEval.totalPvcAvailable.toFixed(1)} kg avail / limit: {stockThresholds.pvcThreshold} kg)
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-emerald-600 text-white rounded-lg shadow-xs">
                <CheckCircle2 className="w-4 h-4" />
              </span>
              <div>
                <div className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                  <span>🟢 RAW MATERIAL STOCK LEVELS HEALTHY</span>
                </div>
                <div className="text-[11px] text-emerald-800 mt-0.5 flex items-center gap-3">
                  <span>Copper Available: <b>{stockEval.totalCopperAvailable.toFixed(1)} kg</b> (limit: {stockThresholds.copperThreshold} kg)</span>
                  <span>•</span>
                  <span>PVC Available: <b>{stockEval.totalPvcAvailable.toFixed(1)} kg</b> (limit: {stockThresholds.pvcThreshold} kg)</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Filter toggle */}
          <div className="flex items-center bg-white border border-slate-300 rounded-lg p-0.5 text-xs shadow-2xs">
            <button
              onClick={() => setFilterLowStockOnly(false)}
              className={`px-2.5 py-1 rounded font-semibold transition-colors ${
                !filterLowStockOnly
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              All Items ({items.length})
            </button>
            <button
              onClick={() => setFilterLowStockOnly(true)}
              className={`px-2.5 py-1 rounded font-bold transition-colors flex items-center gap-1 ${
                filterLowStockOnly
                  ? 'bg-red-600 text-white shadow-xs'
                  : 'text-red-700 hover:bg-red-50'
              }`}
              title="Show only materials that have fallen below safety threshold"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Low Stock Only ({stockEval.lowItems.length})</span>
            </button>
          </div>

          {/* Threshold Settings Modal Trigger */}
          <button
            onClick={() => setIsThresholdModalOpen(true)}
            className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs"
            title="Configure Copper and PVC low stock thresholds"
          >
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
            <span>Thresholds (Cu: {stockThresholds.copperThreshold}kg, PVC: {stockThresholds.pvcThreshold}kg)</span>
          </button>
        </div>
      </div>

      <div className="bg-red-50 border border-red-200 p-2.5 rounded-lg text-xs text-red-900 flex items-start gap-2 no-print">
        <span className="font-bold text-red-800 shrink-0">📂 Document & PDF Upload Only (Camera Disabled):</span>
        <span>
          Direct camera capturing has been disabled. You can upload saved bill PDFs or document image files directly from your device storage. Click <b>Upload Bill PDF / Document</b> above to attach and scan your multi-page invoices.
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs text-left whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
            <tr>
              <th className="p-2 border-r border-slate-200">#</th>
              <th className="p-2 border-r border-slate-200">Date</th>
              <th className="p-2 border-r border-slate-200">Invoice Number</th>
              <th className="p-2 border-r border-slate-200">PARTY</th>
              <th className="p-2 border-r border-slate-200 text-center">Material Stage</th>
              <th className="p-2 border-r border-slate-200">Item Description & Conductor</th>
              <th className="p-2 border-r border-slate-200 text-right">Sub Qty</th>
              <th className="p-2 border-r border-slate-200 text-right">Purchased (kg)</th>
              <th className="p-2 border-r border-slate-200 text-right">Used / Deducted</th>
              <th className="p-2 border-r border-slate-200 text-right">Available Stock</th>
              <th className="p-2 border-r border-slate-200 text-right">Unit Price (₹)</th>
              <th className="p-2 border-r border-slate-200 text-right">Total Amount</th>
              <th className="p-2 border-r border-slate-200">Status</th>
              <th className="p-2 text-center no-print">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((item, idx) => {
              const originalIdx = items.findIndex(it => it.id === item.id);
              const effectiveIdx = originalIdx >= 0 ? originalIdx : idx;
              const totalAmount = item.qty * item.price;
              const stat = item.status;
              const statBg = stat === 'received' ? 'text-green-700' : (stat === 'ordered' ? 'text-blue-700' : 'text-amber-700');
              const isBunch = item.stage === 'bunch'
                || (item.description || '').toLowerCase().includes('bunch')
                || (item.description || '').toLowerCase().includes('pre-bunched');
              const used = item.usedQty || 0;
              const available = Math.max(0, item.qty - used);
              const itemCat = classifyPurchaseItem(item);
              const isLowStock = lowItemIds.has(item.id);
              const targetLimit = itemCat === 'copper' ? stockThresholds.copperThreshold : (itemCat === 'pvc' ? stockThresholds.pvcThreshold : 0);

              const rowClass = isLowStock
                ? 'bg-red-50/70 hover:bg-red-100/60 border-l-4 border-l-red-500 transition-colors'
                : (isBunch ? 'bg-indigo-50/20 hover:bg-slate-50' : 'hover:bg-slate-50');

              return (
                <tr key={item.id} className={rowClass}>
                  <td className="p-2 border-r border-slate-100">{idx + 1}</td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={item.date}
                      onChange={(e) => onUpdateItem(effectiveIdx, 'date', e.target.value)}
                      className="w-20 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={item.invoice}
                      onChange={(e) => onUpdateItem(effectiveIdx, 'invoice', e.target.value)}
                      className="w-24 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white font-semibold"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={item.party}
                      onChange={(e) => onUpdateItem(effectiveIdx, 'party', e.target.value)}
                      className="w-36 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white font-bold"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100 text-center">
                    <select
                      value={item.stage || (isBunch ? 'bunch' : 'raw')}
                      onChange={(e) => onUpdateItem(effectiveIdx, 'stage', e.target.value as any)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        isBunch
                          ? 'bg-purple-100 border-purple-300 text-purple-900 font-extrabold'
                          : 'bg-slate-100 border-slate-200 text-slate-700'
                      }`}
                    >
                      <option value="raw">Raw Copper</option>
                      <option value="bunch">⚡ Bunch Stage</option>
                      <option value="compound">Compound</option>
                      <option value="drums">Drums/Pkg</option>
                      <option value="other">Other</option>
                    </select>
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => onUpdateItem(effectiveIdx, 'description', e.target.value)}
                        className="w-44 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white font-semibold"
                      />
                      {isBunch && item.conductor && (
                        <span className="px-1.5 py-0.5 bg-indigo-100 border border-indigo-200 text-indigo-800 rounded font-mono text-[10px] font-bold">
                          {item.conductor}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2 border-r border-slate-100 text-right">
                    <input
                      type="text"
                      value={item.subQty ?? ''}
                      onChange={(e) => onUpdateItem(effectiveIdx, 'subQty', e.target.value)}
                      className="w-16 px-1.5 py-0.5 border border-slate-300 rounded text-xs text-right bg-white"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={item.qty}
                      onChange={(e) => onUpdateItem(effectiveIdx, 'qty', parseFloat(e.target.value) || 0)}
                      className="w-20 px-1.5 py-0.5 border border-slate-300 rounded text-xs text-right font-bold text-blue-700 bg-white"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100 text-right font-semibold text-amber-800">
                    {used > 0 ? (
                      <span title="Deducted in Process Cards and converted to Bunch Stage Stock">
                        {used.toFixed(2)} kg
                      </span>
                    ) : (
                      <span className="text-slate-400">0.00 kg</span>
                    )}
                  </td>
                  <td className="p-2 border-r border-slate-100 text-right">
                    {isLowStock ? (
                      <div className="flex flex-col items-end">
                        <span
                          className="px-2 py-0.5 rounded font-extrabold text-xs bg-red-100 text-red-900 border border-red-300 flex items-center gap-1 shadow-2xs"
                          title={`Low Stock Warning: ${available.toFixed(2)} kg is below safety threshold of ${targetLimit} kg`}
                        >
                          <AlertTriangle className="w-3 h-3 text-red-600 animate-pulse" />
                          <span>{available.toFixed(2)} kg</span>
                        </span>
                        <span className="text-[9px] text-red-700 font-bold tracking-tight mt-0.5">
                          Below {targetLimit} kg {itemCat === 'copper' ? 'Cu' : 'PVC'}
                        </span>
                      </div>
                    ) : (
                      <span
                        className={`px-2 py-0.5 rounded font-bold text-xs ${
                          available > 0
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {available.toFixed(2)} kg
                      </span>
                    )}
                  </td>
                  <td className="p-2 border-r border-slate-100 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={item.price}
                      onChange={(e) => onUpdateItem(effectiveIdx, 'price', parseFloat(e.target.value) || 0)}
                      className="w-20 px-1.5 py-0.5 border border-slate-300 rounded text-xs text-right font-bold text-green-700 bg-white"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-900">
                    ₹{totalAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <select
                      value={item.status}
                      onChange={(e) => onUpdateItem(effectiveIdx, 'status', e.target.value as any)}
                      className={`px-1.5 py-0.5 border border-slate-300 rounded text-[11px] font-bold bg-white ${statBg}`}
                    >
                      <option value="pending">⏳ pending</option>
                      <option value="ordered">🚚 ordered</option>
                      <option value="received">✅ received</option>
                    </select>
                  </td>
                  <td className="p-2 text-center no-print">
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.id)}
                      className="p-1 hover:bg-red-50 text-red-600 rounded cursor-pointer transition-colors"
                      title={`Delete "${item.party} - ${item.description}"`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Manual Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-slate-800">
            <h3 className="text-base font-bold text-slate-900 mb-3">Add Purchase Entry</h3>
            <form onSubmit={handleManualAddSubmit} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Date</label>
                  <input
                    type="text"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Invoice Number</label>
                  <input
                    type="text"
                    value={invoice}
                    onChange={(e) => setInvoice(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-semibold"
                    placeholder="INV-001"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Party / Supplier Name *</label>
                <input
                  type="text"
                  value={party}
                  onChange={(e) => setParty(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded font-bold"
                  placeholder="e.g. FLYTRON ELECTRICALS PVT. LTD."
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Material Stage / Classification</label>
                  <select
                    value={stage}
                    onChange={(e) => {
                      const newStage = e.target.value as any;
                      setStage(newStage);
                      if (newStage === 'bunch' && !description) {
                        setDescription('Bunched Copper (Bunch Stage Ready)');
                      }
                    }}
                    className="w-full p-2 border border-slate-300 rounded font-bold bg-white text-xs"
                  >
                    <option value="raw">Raw Copper (Drawn Strands / Rod)</option>
                    <option value="bunch">⚡ Bunched Copper (Bunch Stage Ready)</option>
                    <option value="compound">PVC / Rubber Compound</option>
                    <option value="drums">Drums / Packaging</option>
                    <option value="other">Other Material</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                    Conductor Spec {stage === 'bunch' ? '*' : '(Optional)'}
                  </label>
                  <input
                    type="text"
                    value={conductor}
                    onChange={(e) => setConductor(e.target.value)}
                    placeholder="e.g. 22/0.210 or 35/0.210"
                    className="w-full p-2 border border-slate-300 rounded font-semibold text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Item Description *</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded font-semibold"
                  placeholder="e.g. Bunched Copper 22/0.210 (Bunch Stage Ready)"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Sub Qty</label>
                  <input
                    type="text"
                    value={subQty}
                    onChange={(e) => setSubQty(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Quantity (kg) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-bold text-blue-700"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Unit Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-bold text-green-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full p-2 border border-slate-300 rounded font-semibold bg-white"
                >
                  <option value="pending">⏳ pending</option>
                  <option value="ordered">🚚 ordered</option>
                  <option value="received">✅ received</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold"
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adobe Scan Multi-Page Modal */}
      {uploadModalUrls && (
        <BillUploadModal
          imageUrls={uploadModalUrls}
          onClose={() => setUploadModalUrls(null)}
          onConfirm={(newItems) => {
            onAddMultipleItems(newItems);
            setUploadModalUrls(null);
          }}
        />
      )}

      {/* Safety Stock Threshold Settings Modal */}
      <StockThresholdModal
        isOpen={isThresholdModalOpen}
        onClose={() => setIsThresholdModalOpen(false)}
        thresholds={stockThresholds}
        onSaveThresholds={(newThresholds) => {
          if (onUpdateStockThresholds) {
            onUpdateStockThresholds(newThresholds);
          }
        }}
        items={items}
      />
    </div>
  );
};

