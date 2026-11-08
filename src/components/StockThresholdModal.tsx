import React, { useState, useEffect } from 'react';
import { StockThresholdSettings, PurchaseItem } from '../types/cable';
import { evaluateStockLevels, classifyPurchaseItem } from '../utils/stockAlerts';
import { Sliders, AlertTriangle, Check, X, RotateCcw } from 'lucide-react';

interface StockThresholdModalProps {
  isOpen: boolean;
  onClose: () => void;
  thresholds: StockThresholdSettings;
  onSaveThresholds: (newThresholds: StockThresholdSettings) => void;
  items: PurchaseItem[];
  onNavigateToPurchase?: () => void;
}

export const StockThresholdModal: React.FC<StockThresholdModalProps> = ({
  isOpen,
  onClose,
  thresholds = { copperThreshold: 500, pvcThreshold: 300 },
  onSaveThresholds,
  items = [],
  onNavigateToPurchase,
}) => {
  const [copperInput, setCopperInput] = useState<string>(
    String(thresholds?.copperThreshold ?? 500)
  );
  const [pvcInput, setPvcInput] = useState<string>(
    String(thresholds?.pvcThreshold ?? 300)
  );
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Synchronize state when modal is opened or when thresholds prop updates
  useEffect(() => {
    if (isOpen) {
      setCopperInput(String(thresholds?.copperThreshold ?? 500));
      setPvcInput(String(thresholds?.pvcThreshold ?? 300));
      setSavedNotice(null);
    }
  }, [isOpen, thresholds]);

  if (!isOpen) return null;

  const copperThreshold = Math.max(0, parseFloat(copperInput) || 0);
  const pvcThreshold = Math.max(0, parseFloat(pvcInput) || 0);

  const preview = evaluateStockLevels(items, { copperThreshold, pvcThreshold });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = {
      copperThreshold,
      pvcThreshold,
    };
    onSaveThresholds(updated);
    try {
      localStorage.setItem('plutus_stock_thresholds', JSON.stringify(updated));
    } catch (e) {}
    setSavedNotice(`Saved thresholds: Copper ${copperThreshold} kg, PVC ${pvcThreshold} kg`);
    setTimeout(() => {
      onClose();
    }, 600);
  };

  const handleReset = () => {
    setCopperInput('500');
    setPvcInput('300');
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 text-slate-800 border border-slate-200 animate-in fade-in zoom-in duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-lg">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">
                Raw Material Low Stock Thresholds
              </h2>
              <p className="text-xs text-slate-500">
                Define the minimum safety stock levels (kg) for Copper and PVC
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {savedNotice && (
          <div className="mb-3 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg text-xs font-bold flex items-center gap-1.5 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>{savedNotice}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          {/* Copper Threshold Input */}
          <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                Copper Alert Threshold (kg)
              </label>
              <span className="text-[11px] font-semibold text-amber-800">
                {preview.copperLowCount} Copper item(s) below threshold
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="10"
                value={copperInput}
                onChange={(e) => setCopperInput(e.target.value)}
                className="w-32 px-3 py-1.5 text-sm font-bold border border-amber-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                placeholder="500"
              />
              <span className="text-xs font-bold text-slate-600">kg</span>

              {/* Preset buttons */}
              <div className="flex items-center gap-1 ml-auto">
                {[200, 500, 1000, 1500].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setCopperInput(String(val))}
                    className={`px-2 py-1 text-[11px] font-semibold rounded border transition-colors ${
                      copperThreshold === val
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-100/60'
                    }`}
                  >
                    {val}kg
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-amber-900/80">
              Triggers a low stock alert when available Copper (Raw rod, Drawn strands, or Bunched) falls below this limit.
            </p>
          </div>

          {/* PVC / Compound Threshold Input */}
          <div className="bg-blue-50/60 border border-blue-200/80 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-blue-950 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                PVC & Compound Alert Threshold (kg)
              </label>
              <span className="text-[11px] font-semibold text-blue-800">
                {preview.pvcLowCount} PVC item(s) below threshold
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="10"
                value={pvcInput}
                onChange={(e) => setPvcInput(e.target.value)}
                className="w-32 px-3 py-1.5 text-sm font-bold border border-blue-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="300"
              />
              <span className="text-xs font-bold text-slate-600">kg</span>

              {/* Preset buttons */}
              <div className="flex items-center gap-1 ml-auto">
                {[100, 300, 500, 800].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setPvcInput(String(val))}
                    className={`px-2 py-1 text-[11px] font-semibold rounded border transition-colors ${
                      pvcThreshold === val
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white border-blue-200 text-blue-900 hover:bg-blue-100/60'
                    }`}
                  >
                    {val}kg
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-blue-900/80">
              Triggers a low stock alert when available PVC insulation/sheathing compound falls below this limit.
            </p>
          </div>

          {/* Real-time Status Preview */}
          <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/70 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>Alert Status Preview:</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 ${
                  preview.hasLowStock
                    ? 'bg-red-100 text-red-800 border border-red-300'
                    : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                }`}
              >
                {preview.hasLowStock ? (
                  <>
                    <AlertTriangle className="w-3 h-3 text-red-600" />
                    <span>{preview.lowItems.length} Low Stock Item(s)</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span>All Stocks Above Threshold</span>
                  </>
                )}
              </span>
            </div>

            {preview.lowItems.length > 0 && (
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 text-[11px]">
                {preview.lowItems.slice(0, 5).map((l, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-white px-2.5 py-1 rounded border border-slate-200"
                  >
                    <div className="truncate max-w-[240px]">
                      <span className="font-bold text-slate-800">{l.item.party}</span> -{' '}
                      <span className="text-slate-600">{l.item.description}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-bold text-red-600">{l.available.toFixed(1)} kg</span>{' '}
                      <span className="text-slate-400">/ {l.threshold} kg</span>
                    </div>
                  </div>
                ))}
                {preview.lowItems.length > 5 && (
                  <p className="text-[10px] text-center text-slate-500 italic">
                    +{preview.lowItems.length - 5} more item(s) below threshold
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 hover:bg-slate-100 rounded-lg transition-colors font-semibold"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 border border-slate-300 rounded-lg font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Thresholds</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
