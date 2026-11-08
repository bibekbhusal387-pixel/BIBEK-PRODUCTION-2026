import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { DispatchRecord } from '../types/cable';

export interface ReelOrderDetails {
  orderId?: number;
  conductor?: string;
  coreOdMm?: number;
  finalDiaMm?: number;
  insCompound?: string;
  sheathCompound?: string;
  sheathColour?: string;
  spoolSize?: string;
  palletSize?: string;
  cuWeightKg?: number;
  compoundWeightKg?: number;
  tareWeightKg?: number;
  totalOrderLengthM?: number;
  printDetails?: string;
  packingStatus?: string;
  sourceTab?: 'packing' | 'dispatch';
}

export interface DispatchedReelItem {
  id: string;
  drumNo: string;
  dispatchDate: string;
  reelIndex: number;
  totalReelsInRecord: number;
  reelLengthM: number;
  reelNetWeightKg: number;
  reelGrossWeightKg: number;
  record: DispatchRecord;
  orderDetails?: ReelOrderDetails;
}

export type QrPayloadFormat = 'standard' | 'compact' | 'json';

/**
 * Expands a DispatchRecord's drumNos / cartonIds / drumCount into individual DispatchedReelItem entries
 * so every single dispatched reel has its own unique drum number and QR code.
 */
export function expandDispatchedReelsForRecord(record: DispatchRecord): DispatchedReelItem[] {
  const rawStr = (record.drumNos || record.cartonIds || '').trim();
  const count = Math.max(
    1,
    Number(record.drumCount) || Number(record.cartonCount) || 1
  );
  const drumNumbers: string[] = [];

  if (rawStr && rawStr !== '-') {
    // Check for range notation like "JOB NO 33-MYBCAB-120.00-D1..D4" or "PREFIX-D1..4" or "CTN-01..12"
    const rangeMatch = rawStr.match(/^(.*?)-?([A-Za-z]+)(\d+)\.\.[A-Za-z]*(\d+)$/);
    if (rangeMatch) {
      const [, prefix, tag, startStr, endStr] = rangeMatch;
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      const padLen = startStr.length;
      if (!isNaN(start) && !isNaN(end) && end >= start && end - start < 250) {
        for (let i = start; i <= end; i++) {
          const numStr = padLen > 1 ? String(i).padStart(padLen, '0') : String(i);
          drumNumbers.push(prefix ? `${prefix}-${tag}${numStr}` : `${tag}${numStr}`);
        }
      }
    }

    // If not a single range, split by comma / semicolon
    if (drumNumbers.length === 0) {
      const parts = rawStr
        .split(/[,;|]+/)
        .map(s => s.trim())
        .filter(Boolean);

      parts.forEach(part => {
        const subRange = part.match(/^(.*?)-?([A-Za-z]+)(\d+)\.\.[A-Za-z]*(\d+)$/);
        if (subRange) {
          const [, prefix, tag, startStr, endStr] = subRange;
          const start = parseInt(startStr, 10);
          const end = parseInt(endStr, 10);
          const padLen = startStr.length;
          if (!isNaN(start) && !isNaN(end) && end >= start && end - start < 250) {
            for (let i = start; i <= end; i++) {
              const numStr = padLen > 1 ? String(i).padStart(padLen, '0') : String(i);
              drumNumbers.push(prefix ? `${prefix}-${tag}${numStr}` : `${tag}${numStr}`);
            }
            return;
          }
        }
        drumNumbers.push(part.replace(/\.\.\.$/, ''));
      });
    }
  }

  // If count > 1 and only 1 generic string or empty was provided, expand to individual D1..Dn reels
  if (drumNumbers.length === 0) {
    const basePrefix = `${record.batch || 'BATCH'}-${record.brand || 'CABLE'}`
      .replace(/\s+/g, '-')
      .toUpperCase();
    for (let i = 1; i <= count; i++) {
      drumNumbers.push(`${basePrefix}-D${i}`);
    }
  } else if (drumNumbers.length === 1 && count > 1 && !/\d+$/.test(drumNumbers[0])) {
    const base = drumNumbers[0];
    drumNumbers.length = 0;
    for (let i = 1; i <= count; i++) {
      drumNumbers.push(`${base}-D${i}`);
    }
  }

  const totalReels = drumNumbers.length;
  const perReelLen = totalReels > 0 ? Math.round((record.lengthM || 0) / totalReels) : 0;
  const perReelNet =
    totalReels > 0 ? Number(((record.netWeightKg || 0) / totalReels).toFixed(2)) : 0;
  const perReelGross =
    totalReels > 0 ? Number(((record.grossWeightKg || 0) / totalReels).toFixed(2)) : 0;

  return drumNumbers.map((drumNo, idx) => ({
    id: `${record.id}__REEL_${idx + 1}`,
    drumNo,
    dispatchDate: record.date || new Date().toISOString().split('T')[0],
    reelIndex: idx + 1,
    totalReelsInRecord: totalReels,
    reelLengthM: perReelLen,
    reelNetWeightKg: perReelNet,
    reelGrossWeightKg: perReelGross,
    record,
    orderDetails: {
      conductor: record.conductor,
      spoolSize: record.spoolSize,
      palletSize: record.palletSize,
      packingStatus: record.status,
      sourceTab: 'dispatch',
    },
  }));
}

/**
 * Builds the scannable QR code text payload containing the reel's unique drum number,
 * dispatch/packing date, and full order details for that specific reel.
 */
export function buildReelQrPayload(
  reel: DispatchedReelItem,
  format: QrPayloadFormat = 'standard'
): string {
  const od = reel.orderDetails;
  if (format === 'compact') {
    return [
      `DRUM NO: ${reel.drumNo}`,
      `BATCH: ${reel.record.batch}`,
      `CABLE: ${reel.record.brand} ${reel.record.sizeCores}`,
      `LENGTH: ${reel.reelLengthM} M`,
      `DATE: ${reel.dispatchDate}`,
    ].join('\n');
  }
  if (format === 'json') {
    return JSON.stringify({
      drumNo: reel.drumNo,
      date: reel.dispatchDate,
      orderId: od?.orderId ?? reel.record.orderId,
      batch: reel.record.batch,
      brand: reel.record.brand,
      grade: reel.record.grade,
      sizeCores: reel.record.sizeCores,
      conductor: od?.conductor || reel.record.conductor || undefined,
      insCompound: od?.insCompound || undefined,
      sheathCompound: od?.sheathCompound || undefined,
      sheathColour: od?.sheathColour || undefined,
      spoolSize: od?.spoolSize || reel.record.spoolSize || undefined,
      palletSize: od?.palletSize || reel.record.palletSize || undefined,
      reelLengthM: reel.reelLengthM,
      totalOrderLengthM: od?.totalOrderLengthM || undefined,
      cuWeightKg: od?.cuWeightKg !== undefined ? Number(od.cuWeightKg.toFixed(2)) : undefined,
      compoundWeightKg:
        od?.compoundWeightKg !== undefined ? Number(od.compoundWeightKg.toFixed(2)) : undefined,
      netWeightKg: reel.reelNetWeightKg,
      grossWeightKg: reel.reelGrossWeightKg,
      status: od?.packingStatus || reel.record.status || 'Packed',
    });
  }

  const lines: string[] = [
    `=== PLUTUS CABLE REEL ORDER TAG ===`,
    `REEL / DRUM NO: ${reel.drumNo}`,
    `BATCH / JOB NO: ${reel.record.batch}`,
    `BRAND & GRADE: ${reel.record.brand} (${reel.record.grade})`,
    `CABLE SIZE: ${reel.record.sizeCores}`,
  ];
  if (od?.conductor || reel.record.conductor) {
    lines.push(`CONDUCTOR: ${od?.conductor || reel.record.conductor}`);
  }
  if (od?.insCompound || od?.sheathCompound) {
    lines.push(
      `COMPOUND: Ins ${od?.insCompound || '-'} / Sheath ${od?.sheathCompound || '-'}${
        od?.sheathColour ? ` (${od.sheathColour})` : ''
      }`
    );
  }
  if (od?.spoolSize || reel.record.spoolSize) {
    lines.push(
      `DRUM / PALLET: ${od?.spoolSize || reel.record.spoolSize}${
        od?.palletSize ? ` | Pallet ${od.palletSize}` : ''
      }`
    );
  }
  lines.push(
    `REEL LENGTH: ${reel.reelLengthM} M (Reel ${reel.reelIndex} of ${reel.totalReelsInRecord}${
      od?.totalOrderLengthM ? ` | Total Order: ${od.totalOrderLengthM} M` : ''
    })`
  );
  if (od?.cuWeightKg !== undefined && od?.compoundWeightKg !== undefined) {
    lines.push(
      `WEIGHT BREAKDOWN: Cu ${od.cuWeightKg.toFixed(2)} kg + Comp ${od.compoundWeightKg.toFixed(
        2
      )} kg + Tare ${(od.tareWeightKg ?? 25).toFixed(1)} kg`
    );
  }
  lines.push(
    `NET / GROSS WT: ${reel.reelNetWeightKg.toFixed(2)} KG / ${reel.reelGrossWeightKg.toFixed(2)} KG`
  );
  if (od?.printDetails) {
    lines.push(`PRINT LEGEND: ${od.printDetails}`);
  }
  lines.push(`DATE: ${reel.dispatchDate}`);
  lines.push(`STATUS: ${od?.packingStatus || reel.record.status || 'Packed'}`);
  return lines.join('\n');
}

/**
 * Generates a high-resolution PNG Data URL for the reel's QR code.
 */
export async function generateReelQrDataUrl(
  reel: DispatchedReelItem,
  format: QrPayloadFormat = 'standard'
): Promise<string> {
  const payload = buildReelQrPayload(reel, format);
  return await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 340,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}

/**
 * Downloads a printable PDF Reel QR Code Label for the specified dispatched reel.
 */
export async function downloadReelQrLabelPdf(
  reel: DispatchedReelItem,
  format: QrPayloadFormat = 'standard'
): Promise<void> {
  const qrDataUrl = await generateReelQrDataUrl(reel, format);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a6' });
  const w = doc.internal.pageSize.getWidth();

  // Header
  doc.setFillColor(15, 23, 42);
  doc.rect(5, 5, w - 10, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('PLUTUS CABLE — DISPATCHED REEL QR TAG', w / 2, 11, { align: 'center' });
  doc.setFontSize(7);
  doc.setTextColor(147, 197, 253);
  doc.text(`DISPATCH STATUS: ${(reel.record.status || 'DISPATCHED').toUpperCase()}`, w / 2, 16, {
    align: 'center',
  });

  // QR Code Image
  const qrSize = 48;
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect((w - qrSize - 4) / 2, 22, qrSize + 4, qrSize + 4, 2, 2, 'S');
  doc.addImage(qrDataUrl, 'PNG', (w - qrSize) / 2, 24, qrSize, qrSize);

  // Unique Drum Number & Dispatch Date Highlight Box
  let y = 76;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(6, y, w - 12, 18, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('UNIQUE DRUM NUMBER:', 9, y + 4.5);
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(reel.drumNo, 9, y + 9.5);

  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('DISPATCH DATE:', 9, y + 14.5);
  doc.setFontSize(8.5);
  doc.setTextColor(37, 99, 235);
  doc.text(reel.dispatchDate, 32, y + 14.5);

  // Metadata rows
  y += 23;
  const details: Array<[string, string]> = [
    ['Batch / Job No:', reel.record.batch],
    ['Dispatch Ref:', reel.record.dispatchNo],
    ['Cable Spec:', `${reel.record.brand} • ${reel.record.sizeCores} (${reel.record.grade})`],
    ['Reel Length:', `${reel.reelLengthM.toLocaleString()} m (Reel ${reel.reelIndex} of ${reel.totalReelsInRecord})`],
    ['Net / Gross Wt:', `${reel.reelNetWeightKg} kg / ${reel.reelGrossWeightKg} kg`],
    ['Client:', reel.record.clientName || '-'],
    ['Destination:', reel.record.destination || '-'],
    ['Vehicle / Cont:', reel.record.vehicleOrContainerNo || '-'],
  ];

  doc.setFontSize(7.2);
  details.forEach(([label, val]) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(label, 7, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(String(val).slice(0, 38), 32, y);
    y += 5;
  });

  const safeDrum = reel.drumNo.replace(/[^a-zA-Z0-9_-]+/g, '_');
  doc.save(`PLUTUS_REEL_QR_${safeDrum}_${reel.dispatchDate}.pdf`);
}
