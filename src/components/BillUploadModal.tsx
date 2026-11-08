import React, { useState } from 'react';
import { FileText, Zap, X, Check } from 'lucide-react';
import { PurchaseItem } from '../types/cable';

interface BillUploadModalProps {
  imageUrls: string[];
  onClose: () => void;
  onConfirm: (newItems: Omit<PurchaseItem, 'id'>[]) => void;
}

export const BillUploadModal: React.FC<BillUploadModalProps> = ({ imageUrls, onClose, onConfirm }) => {
  const [party, setParty] = useState('FLYTRON ELECTRICALS PVT. LTD.');
  const [invoice, setInvoice] = useState('FE/26-27/397');
  
  const [desc1, setDesc1] = useState('COPPER WIRE (166.830 KGS)');
  const [qty1, setQty1] = useState('166.830');
  const [price1, setPrice1] = useState('1440.00');

  const [desc2, setDesc2] = useState('COPPER WIRE (33.250 KGS)');
  const [qty2, setQty2] = useState('33.250');
  const [price2, setPrice2] = useState('1448.00');

  const loadFlytronPreset = () => {
    setParty('FLYTRON ELECTRICALS PVT. LTD.');
    setInvoice('FE/26-27/397');
    setDesc1('COPPER WIRE (166.830 KGS)');
    setQty1('166.830');
    setPrice1('1440.00');
    setDesc2('COPPER WIRE (33.250 KGS)');
    setQty2('33.250');
    setPrice2('1448.00');
  };

  const loadCompoundPreset = () => {
    setParty('KI COMPOUNDING');
    setInvoice('INV-COMPOUND-01');
    setDesc1('A80 HD BLACK COMPOUND');
    setQty1('500.000');
    setPrice1('145.00');
    setDesc2('');
    setQty2('');
    setPrice2('');
  };

  const handleSave = () => {
    if (!party.trim()) {
      alert('Please enter a valid Party Name.');
      return;
    }

    const q1 = parseFloat(qty1) || 0;
    const p1 = parseFloat(price1) || 0;
    const q2 = parseFloat(qty2) || 0;
    const p2 = parseFloat(price2) || 0;

    const itemsToAdd: Omit<PurchaseItem, 'id'>[] = [];
    const todayStr = new Date().toLocaleDateString('en-GB').split('/').join('.');

    if (q1 > 0 && desc1.trim()) {
      itemsToAdd.push({
        date: todayStr,
        invoice: invoice.trim() || 'INV-001',
        party: party.trim(),
        description: desc1.trim(),
        subQty: '',
        qty: q1,
        price: p1,
        status: 'received'
      });
    }

    if (q2 > 0 && desc2.trim()) {
      itemsToAdd.push({
        date: todayStr,
        invoice: invoice.trim() || 'INV-001',
        party: party.trim(),
        description: desc2.trim(),
        subQty: '',
        qty: q2,
        price: p2,
        status: 'received'
      });
    }

    if (itemsToAdd.length === 0) {
      alert('Please enter at least one valid line item quantity.');
      return;
    }

    onConfirm(itemsToAdd);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 text-slate-800 my-8">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-base">
            <FileText className="w-5 h-5 text-blue-600" />
            <span>Document & Multi-Page Bill Scanner ({imageUrls.length} Page(s))</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-500 mt-2 mb-3">
          Scanned pages are attached below. Use <strong>⚡ Quick Fill</strong> or edit line items, weights, and rates before saving.
        </p>

        {imageUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center bg-slate-100 p-2.5 rounded-lg mb-3 max-h-36 overflow-y-auto">
            {imageUrls.map((url, idx) => (
              <div key={idx} className="border border-blue-400 rounded overflow-hidden max-h-24 bg-white shadow-xs">
                <img src={url} alt={`Scanned page ${idx + 1}`} className="max-h-24 object-contain" />
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 p-2.5 rounded-lg mb-4 flex-wrap">
          <span className="text-xs font-bold text-blue-800 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" /> Quick Fill:
          </span>
          <button
            onClick={loadFlytronPreset}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold px-2.5 py-1 rounded shadow-xs"
          >
            Flytron Invoice (166.83kg & 33.25kg)
          </button>
          <button
            onClick={loadCompoundPreset}
            className="text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold px-2.5 py-1 rounded shadow-xs"
          >
            Compound Bill Preset
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Party / Supplier Name *</label>
            <input
              type="text"
              value={party}
              onChange={(e) => setParty(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm font-semibold focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Invoice Number *</label>
            <input
              type="text"
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm font-semibold focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Line Item 1 */}
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-3">
          <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">Line Item 1 (Primary Item):</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div className="sm:col-span-2">
              <label className="block text-[10px] text-slate-500 uppercase">Description / Size</label>
              <input
                type="text"
                value={desc1}
                onChange={(e) => setDesc1(e.target.value)}
                className="w-full px-2.5 py-1 border border-slate-300 rounded text-xs bg-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase">Weight (KGS)</label>
              <input
                type="number"
                step="0.001"
                value={qty1}
                onChange={(e) => setQty1(e.target.value)}
                className="w-full px-2.5 py-1 border border-slate-300 rounded text-xs font-bold text-blue-700 bg-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase">Rate (₹)</label>
              <input
                type="number"
                step="0.01"
                value={price1}
                onChange={(e) => setPrice1(e.target.value)}
                className="w-full px-2.5 py-1 border border-slate-300 rounded text-xs font-bold text-green-700 bg-white"
              />
            </div>
          </div>
        </div>

        {/* Line Item 2 */}
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-4">
          <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">Line Item 2 (Secondary Item / Rate):</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div className="sm:col-span-2">
              <label className="block text-[10px] text-slate-500 uppercase">Description / Size</label>
              <input
                type="text"
                value={desc2}
                onChange={(e) => setDesc2(e.target.value)}
                className="w-full px-2.5 py-1 border border-slate-300 rounded text-xs bg-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase">Weight (KGS)</label>
              <input
                type="number"
                step="0.001"
                value={qty2}
                onChange={(e) => setQty2(e.target.value)}
                className="w-full px-2.5 py-1 border border-slate-300 rounded text-xs font-bold text-blue-700 bg-white"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 uppercase">Rate (₹)</label>
              <input
                type="number"
                step="0.01"
                value={price2}
                onChange={(e) => setPrice2(e.target.value)}
                className="w-full px-2.5 py-1 border border-slate-300 rounded text-xs font-bold text-green-700 bg-white"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm"
          >
            <Check className="w-4 h-4" /> Confirm & Add to Purchases & Stock
          </button>
        </div>
      </div>
    </div>
  );
};
