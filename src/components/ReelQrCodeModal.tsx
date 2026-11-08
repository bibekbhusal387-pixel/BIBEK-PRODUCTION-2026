import React, { useEffect, useState } from 'react';
import {
  QrCode,
  X,
  Calendar,
  Package,
  Copy,
  Check,
  Download,
  FileDown,
  Printer,
  ChevronLeft,
  ChevronRight,
  Truck,
  MapPin,
} from 'lucide-react';
import {
  DispatchedReelItem,
  QrPayloadFormat,
  buildReelQrPayload,
  generateReelQrDataUrl,
  downloadReelQrLabelPdf,
} from '../utils/reelQrCode';

interface ReelQrCodeModalProps {
  reel: DispatchedReelItem | null;
  siblingReels?: DispatchedReelItem[];
  onSelectReel?: (reel: DispatchedReelItem) => void;
  onClose: () => void;
}

export const ReelQrCodeModal: React.FC<ReelQrCodeModalProps> = ({
  reel,
  siblingReels = [],
  onSelectReel,
  onClose,
}) => {
  const [format, setFormat] = useState<QrPayloadFormat>('standard');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedDrum, setCopiedDrum] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  useEffect(() => {
    let active = true;
    if (!reel) return;
    generateReelQrDataUrl(reel, format)
      .then(url => {
        if (active) setQrDataUrl(url);
      })
      .catch(err => {
        console.error('QR generation failed:', err);
      });
    return () => {
      active = false;
    };
  }, [reel, format]);

  if (!reel) return null;

  const payloadText = buildReelQrPayload(reel, format);
  const currentIdx = siblingReels.findIndex(r => r.id === reel.id);

  const handleCopyText = async (text: string, type: 'drum' | 'payload') => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (type === 'drum') {
        setCopiedDrum(true);
        setTimeout(() => setCopiedDrum(false), 2000);
      } else {
        setCopiedPayload(true);
        setTimeout(() => setCopiedPayload(false), 2000);
      }
    } catch {}
  };

  const handleDownloadPng = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    const safeDrum = reel.drumNo.replace(/[^a-zA-Z0-9_-]+/g, '_');
    link.download = `PLUTUS_QR_${safeDrum}_${reel.dispatchDate}.png`;
    link.href = qrDataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 no-print"
      onClick={onClose}
    >
      <div
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl shadow-xs">
              <QrCode className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black tracking-wide uppercase">
                  {reel.orderDetails?.sourceTab === 'packing'
                    ? 'Packing List Reel — Order Details QR Tag'
                    : 'Dispatched Reel QR Code Tag'}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  {reel.orderDetails?.packingStatus || reel.record.status || 'Dispatched'}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Scan with any mobile camera or warehouse scanner to view the complete order details for this specific reel
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Multi-Reel Switcher Bar (if record has >1 reels) */}
        {siblingReels.length > 1 && onSelectReel && (
          <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              disabled={currentIdx <= 0}
              onClick={() => currentIdx > 0 && onSelectReel(siblingReels[currentIdx - 1])}
              className="px-2.5 py-1 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-800 border border-slate-300 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev Reel
            </button>

            <div className="flex items-center gap-1 overflow-x-auto py-0.5 max-w-[340px]">
              {siblingReels.map(sib => (
                <button
                  key={sib.id}
                  type="button"
                  onClick={() => onSelectReel(sib)}
                  className={`px-2 py-0.5 rounded text-[10.5px] font-mono font-extrabold whitespace-nowrap cursor-pointer transition-colors ${
                    sib.id === reel.id
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'bg-white hover:bg-indigo-50 text-slate-700 border border-slate-300'
                  }`}
                >
                  D{sib.reelIndex}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={currentIdx < 0 || currentIdx >= siblingReels.length - 1}
              onClick={() =>
                currentIdx >= 0 &&
                currentIdx < siblingReels.length - 1 &&
                onSelectReel(siblingReels[currentIdx + 1])
              }
              className="px-2.5 py-1 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-800 border border-slate-300 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              Next Reel <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Primary Scannable QR Code + Core Reel Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center bg-slate-50 border border-slate-200 rounded-2xl p-4">
            {/* QR Code Box */}
            <div className="sm:col-span-5 flex flex-col items-center justify-center bg-white border-2 border-slate-900 rounded-xl p-3 shadow-xs">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR Code for ${reel.drumNo}`}
                  className="w-44 h-44 object-contain"
                />
              ) : (
                <div className="w-44 h-44 flex items-center justify-center text-slate-400 font-bold">
                  Generating QR...
                </div>
              )}
              <span className="mt-1.5 text-[10px] font-mono font-extrabold text-slate-600 uppercase tracking-wider">
                Reel {reel.reelIndex} of {reel.totalReelsInRecord}
              </span>
            </div>

            {/* Primary Drum Number & Order / Dispatch Details */}
            <div className="sm:col-span-7 space-y-2.5">
              {/* Unique Drum Number */}
              <div className="bg-indigo-950 text-white rounded-xl p-3 border border-indigo-700 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-300 flex items-center gap-1">
                    <Package className="w-3 h-3" /> Unique Reel / Drum Serial No
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyText(reel.drumNo, 'drum')}
                    className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded text-indigo-200 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    {copiedDrum ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" /> Copy
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono font-black text-sm text-amber-300 mt-1 break-all">
                  {reel.drumNo}
                </div>
              </div>

              {/* Date & Batch / Job Order */}
              <div className="bg-white border-2 border-blue-200 rounded-xl p-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] font-extrabold uppercase text-slate-500">
                      {reel.orderDetails?.sourceTab === 'packing' ? 'Packing / Order Date' : 'Dispatch Date'}
                    </div>
                    <div className="font-mono font-black text-sm text-blue-900">
                      {reel.dispatchDate}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Batch / Job Order</div>
                  <div className="font-mono font-black text-xs text-amber-900 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                    {reel.record.batch}
                  </div>
                </div>
              </div>

              {/* Spec & Order Weight Summary */}
              <div className="grid grid-cols-2 gap-2 bg-white border border-slate-200 rounded-xl p-2.5 text-[11px]">
                <div>
                  <span className="text-slate-500 font-semibold block text-[10px]">Brand &amp; Cable Size</span>
                  <span className="font-black text-slate-900">
                    {reel.record.brand} • {reel.record.sizeCores}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-semibold block text-[10px]">Grade &amp; Conductor</span>
                  <span className="font-bold text-slate-800">
                    {reel.record.grade}
                    {(reel.orderDetails?.conductor || reel.record.conductor)
                      ? ` (${reel.orderDetails?.conductor || reel.record.conductor})`
                      : ''}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-semibold block text-[10px]">Reel Length</span>
                  <span className="font-black text-blue-700">
                    {reel.reelLengthM.toLocaleString()} m
                    {reel.orderDetails?.totalOrderLengthM
                      ? ` (of ${reel.orderDetails.totalOrderLengthM.toLocaleString()} m)`
                      : ''}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-semibold block text-[10px]">Total Reel Weight</span>
                  <span className="font-bold text-slate-900">
                    {reel.reelGrossWeightKg.toFixed(2)} kg (Net: {reel.reelNetWeightKg.toFixed(2)} kg)
                  </span>
                </div>
                {(reel.orderDetails?.spoolSize || reel.record.spoolSize) && (
                  <div>
                    <span className="text-slate-500 font-semibold block text-[10px]">Drum / Spool Size</span>
                    <span className="font-bold text-indigo-800">
                      {reel.orderDetails?.spoolSize || reel.record.spoolSize}
                    </span>
                  </div>
                )}
                {(reel.orderDetails?.palletSize || reel.record.palletSize) && (
                  <div>
                    <span className="text-slate-500 font-semibold block text-[10px]">Pallet Size</span>
                    <span className="font-bold text-slate-800">
                      {reel.orderDetails?.palletSize || reel.record.palletSize}
                    </span>
                  </div>
                )}
                {reel.orderDetails?.cuWeightKg !== undefined && (
                  <div>
                    <span className="text-slate-500 font-semibold block text-[10px]">Copper Weight</span>
                    <span className="font-bold text-amber-800">
                      {reel.orderDetails.cuWeightKg.toFixed(2)} kg
                    </span>
                  </div>
                )}
                {reel.orderDetails?.compoundWeightKg !== undefined && (
                  <div>
                    <span className="text-slate-500 font-semibold block text-[10px]">Compound + Tare Wt</span>
                    <span className="font-bold text-teal-800">
                      {reel.orderDetails.compoundWeightKg.toFixed(2)} kg + {(reel.orderDetails.tareWeightKg ?? 25).toFixed(1)} kg
                    </span>
                  </div>
                )}
              </div>

              {/* Sheath Print Legend / Consignee & Vehicle */}
              <div className="text-[11px] text-slate-600 space-y-0.5 px-1">
                {reel.orderDetails?.insCompound || reel.orderDetails?.sheathCompound ? (
                  <div className="truncate">
                    <strong>Compounds:</strong> Ins: {reel.orderDetails?.insCompound || '-'} | Sheath:{' '}
                    {reel.orderDetails?.sheathCompound || '-'} ({reel.orderDetails?.sheathColour || 'BLACK'})
                  </div>
                ) : null}
                {reel.orderDetails?.printDetails ? (
                  <div className="truncate font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-800">
                    <strong>Print:</strong> {reel.orderDetails.printDetails}
                  </div>
                ) : null}
                <div className="flex items-center gap-1.5 truncate">
                  <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                  <span className="truncate">
                    <strong>Consignee / Status:</strong> {reel.record.clientName || 'Factory Packing List'} (
                    {reel.orderDetails?.packingStatus || reel.record.status || 'Packed'})
                  </span>
                </div>
                <div className="flex items-center gap-1.5 truncate">
                  <Truck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span className="truncate">
                    <strong>Ref / Vehicle:</strong> {reel.record.dispatchNo} •{' '}
                    {reel.record.vehicleOrContainerNo || '-'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* QR Payload Format Selector & Encoded Data Preview */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-100 px-3.5 py-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-extrabold text-slate-700 uppercase">
                QR Code Scannable Data Format
              </span>
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'standard', label: 'Full Reel Tag' },
                    { id: 'compact', label: 'Drum No + Date Only' },
                    { id: 'json', label: 'JSON' },
                  ] as const
                ).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFormat(opt.id)}
                    className={`px-2 py-0.5 rounded text-[10.5px] font-bold cursor-pointer transition-colors ${
                      format === opt.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white hover:bg-slate-200 text-slate-700 border border-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 bg-slate-900 text-emerald-300 font-mono text-[11px] flex items-start justify-between gap-2">
              <pre className="whitespace-pre-wrap break-all flex-1 leading-relaxed">
                {payloadText}
              </pre>
              <button
                type="button"
                onClick={() => handleCopyText(payloadText, 'payload')}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-[10px] font-sans font-bold flex items-center gap-1 shrink-0 cursor-pointer"
              >
                {copiedPayload ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> Copy Data
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleDownloadPng}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download QR (.png)</span>
            </button>
            <button
              type="button"
              onClick={() => downloadReelQrLabelPdf(reel, format)}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Download Reel Label (.pdf)</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-bold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
