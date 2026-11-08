import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  CableOrder,
  ColourMapRule,
  ContainerPlan,
  DailyJournalEntry,
  DensitySettings,
  DispatchedContainerRecord,
  DispatchRecord,
  LadiDimensionRule,
  ManualPackingItem,
  PackagingRule,
  PurchaseItem,
  SizePackagingRule,
  StockReturnRejection,
} from '../types/cable';
import {
  computeRecordRow,
  evaluateSpoolSizeForOrder,
  fmtExact,
  isOrderComplete,
} from './calculations';
import { StockLedgerResult } from './stockEngine';

export interface ExportSheetPdfParams {
  activeTab: string;
  sheetTitle: string;
  orders: CableOrder[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
  colourMap: ColourMapRule[];
  purchaseItems: PurchaseItem[];
  manualPackingItems: ManualPackingItem[];
  containerPlans: ContainerPlan[];
  dispatchedContainers: DispatchedContainerRecord[];
  dispatchRecords: DispatchRecord[];
  dailyJournalEntries: DailyJournalEntry[];
  stockReturns: StockReturnRejection[];
  stockOpenings: Record<string, number>;
  stockLedger?: StockLedgerResult;
}

/**
 * Extracts clean text from a DOM cell, reading current values of <input>, <select>, and <textarea>
 * while ignoring buttons and .no-print elements.
 */
function extractCleanCellText(cell: Element): string {
  const clone = cell.cloneNode(true) as HTMLElement;

  // Remove interactive action buttons or no-print elements inside the cell
  clone
    .querySelectorAll('.no-print, button, svg, [data-pdf-ignore="true"]')
    .forEach(el => el.remove());

  // Replace inputs/selects/textareas in the clone with their live values from the original cell
  const origInputs = Array.from(cell.querySelectorAll('input, select, textarea'));
  const cloneInputs = Array.from(clone.querySelectorAll('input, select, textarea'));

  origInputs.forEach((origEl, idx) => {
    const cloneEl = cloneInputs[idx];
    if (!cloneEl) return;
    let valText = '';
    if (origEl instanceof HTMLInputElement) {
      if (origEl.type === 'checkbox' || origEl.type === 'radio') {
        valText = origEl.checked ? '✓' : '—';
      } else {
        valText = origEl.value || '';
      }
    } else if (origEl instanceof HTMLSelectElement) {
      valText = origEl.options[origEl.selectedIndex]?.text || origEl.value || '';
    } else if (origEl instanceof HTMLTextAreaElement) {
      valText = origEl.value || '';
    }
    const span = document.createElement('span');
    span.textContent = ` ${valText} `;
    cloneEl.replaceWith(span);
  });

  return (clone.textContent || '')
    .replace(/\s+/g, ' ')
    .replace(/[↑↓⇅]/g, '')
    .trim();
}

/**
 * Extracts visible HTML tables from the active <main> container so that any active filters,
 * batch selections, process cards, or custom views are faithfully captured.
 */
function extractVisibleDomTables(): Array<{
  title: string;
  headers: string[];
  rows: string[][];
}> {
  if (typeof document === 'undefined') return [];
  const mainEl = document.querySelector('main');
  if (!mainEl) return [];

  const tables = Array.from(mainEl.querySelectorAll('table'));
  const extracted: Array<{ title: string; headers: string[]; rows: string[][] }> = [];

  tables.forEach((table, tIdx) => {
    // Skip hidden tables
    const style = window.getComputedStyle(table);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    // Find nearest section heading above the table
    let title = `Table ${tIdx + 1}`;
    const card = table.closest('.print-card, section, .bg-white, .border');
    if (card) {
      const headingEl = card.querySelector('h2, h3, h4, .font-extrabold, .font-black, .font-bold');
      if (headingEl && headingEl.textContent) {
        const cleanHeading = headingEl.textContent.replace(/\s+/g, ' ').trim();
        if (cleanHeading.length > 2 && cleanHeading.length <= 110) {
          title = cleanHeading;
        }
      }
    }

    const headerCells = Array.from(table.querySelectorAll('thead tr:last-child th, thead tr:last-child td'));
    let headers = headerCells.map(th => extractCleanCellText(th));

    const bodyRows = Array.from(table.querySelectorAll('tbody tr, tfoot tr'));
    const rows: string[][] = [];

    bodyRows.forEach(tr => {
      const trStyle = window.getComputedStyle(tr);
      if (trStyle.display === 'none') return;
      const cells = Array.from(tr.querySelectorAll('td, th'));
      if (cells.length === 0) return;

      const rowVals: string[] = [];
      cells.forEach(td => {
        const text = extractCleanCellText(td);
        const colSpan = Math.max(1, Number((td as HTMLTableCellElement).colSpan) || 1);
        rowVals.push(text);
        for (let c = 1; c < colSpan; c++) {
          rowVals.push('');
        }
      });

      if (rowVals.some(v => v.length > 0)) {
        rows.push(rowVals);
      }
    });

    if (headers.length === 0 && rows.length > 0) {
      headers = rows[0].map((_, i) => `Col ${i + 1}`);
    }

    // Remove trailing "Action / Actions / Delete" column if all body cells in that column are empty
    if (headers.length > 1 && rows.length > 0) {
      const lastHeader = headers[headers.length - 1].toLowerCase();
      const lastColEmpty = rows.every(r => !r[headers.length - 1] || r[headers.length - 1] === '—');
      if (
        lastColEmpty ||
        lastHeader === 'actions' ||
        lastHeader === 'action' ||
        lastHeader === 'del' ||
        lastHeader === 'delete'
      ) {
        headers = headers.slice(0, -1);
        rows.forEach((r, idx) => {
          rows[idx] = r.slice(0, headers.length);
        });
      }
    }

    if (rows.length > 0) {
      extracted.push({ title, headers, rows });
    }
  });

  return extracted;
}

/**
 * Draws the official PLUTUS corporate PDF header banner and metadata bar on the current page.
 */
function drawPdfHeader(
  doc: jsPDF,
  sheetTitle: string,
  subtitle: string,
  kpiSummary: Array<{ label: string; value: string }>
): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Top dark slate banner
  doc.setFillColor(15, 23, 42);
  doc.rect(8, 7, pageWidth - 16, 15, 'F');

  // Accent blue stripe
  doc.setFillColor(37, 99, 235);
  doc.rect(8, 7, 3, 15, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('PLUTUS CABLE PRODUCTION & REQUISITION SYSTEM', 14, 13.2);

  doc.setFontSize(8.5);
  doc.setTextColor(147, 197, 253);
  doc.text(sheetTitle.toUpperCase(), 14, 18.8);

  const nowStr = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(226, 232, 240);
  doc.text(`Generated: ${nowStr}`, pageWidth - 12, 13, { align: 'right' });
  doc.text('ISO / IS-694 / H05VV-F Engineering & Stock Control', pageWidth - 12, 18.5, {
    align: 'right',
  });

  let cursorY = 25;

  // Subtitle bar
  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(subtitle, 9, cursorY);
  cursorY += 3;

  // Optional KPI boxes
  if (kpiSummary.length > 0) {
    const boxCount = Math.min(kpiSummary.length, 6);
    const gap = 2.5;
    const totalGap = gap * (boxCount - 1);
    const boxWidth = (pageWidth - 16 - totalGap) / boxCount;

    kpiSummary.slice(0, boxCount).forEach((kpi, idx) => {
      const x = 8 + idx * (boxWidth + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(x, cursorY, boxWidth, 10.5, 1.2, 1.2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.2);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label.toUpperCase(), x + 2.5, cursorY + 3.8);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(15, 23, 42);
      doc.text(String(kpi.value), x + 2.5, cursorY + 8.5);
    });
    cursorY += 13.5;
  } else {
    cursorY += 2;
  }

  return cursorY;
}

/**
 * Adds page numbers and official authorization signature footers to every page in the PDF.
 */
function finalizePdfFooters(doc: jsPDF, sheetTitle: string) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(203, 213, 225);
    doc.line(8, pageHeight - 10, pageWidth - 8, pageHeight - 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `PLUTUS Cable Production & Requisition System • ${sheetTitle}`,
      8,
      pageHeight - 5.5
    );
    doc.text(
      'Prepared By: ____________________    Production Head: ____________________    Verified By: ____________________',
      pageWidth / 2,
      pageHeight - 5.5,
      { align: 'center' }
    );
    doc.setFont('helvetica', 'bold');
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 8, pageHeight - 5.5, {
      align: 'right',
    });
  }
}

/**
 * Builds structured tables for a given tab when no DOM table is present or to enrich the export.
 */
function buildStructuredTablesForTab(params: ExportSheetPdfParams): Array<{
  title: string;
  headers: string[];
  rows: string[][];
}> {
  const {
    activeTab,
    orders,
    densities,
    ladiDimensions,
    sizeRules,
    packagingRules,
    purchaseItems,
    containerPlans,
    dispatchRecords,
    dailyJournalEntries,
    stockLedger,
  } = params;

  const activeOrders = orders.filter(o => !isOrderComplete(o, ladiDimensions));
  const completedOrders = orders.filter(o => isOrderComplete(o, ladiDimensions));

  if (activeTab === 'orders' || activeTab === 'dashboard') {
    return [
      {
        title: `Active Production Orders (${activeOrders.length} Active / ${orders.length} Total)`,
        headers: [
          '#',
          'Batch',
          'Brand',
          'Grade',
          'Cores × Size',
          'Conductor',
          'Ins Comp',
          'Sheath Col / Comp',
          'Coils / Pack',
          'Order Len (m)',
          'Req Cu (kg)',
          'Req Ins (kg)',
          'Req Sheath (kg)',
          'Stages',
        ],
        rows: (activeOrders.length > 0 ? activeOrders : orders).map((o, idx) => {
          const r = computeRecordRow(o, densities, ladiDimensions);
          const stages = [
            o.pStatus?.b ? 'B✓' : 'B·',
            o.pStatus?.c ? 'CS✓' : 'CS·',
            o.pStatus?.i ? 'I✓' : 'I·',
            o.pStatus?.t ? 'TS✓' : 'TS·',
            o.pStatus?.s ? 'SH✓' : 'SH·',
          ].join(' ');
          const coilInfo =
            o.coils && Number(o.coils) > 0
              ? `${o.coils} × ${o.coil_type || '90 MTR'}`
              : o.spool_size || 'Drum';
          return [
            String(idx + 1),
            o.batch || '-',
            o.brand || '-',
            o.grade || '-',
            `${o.cores}C × ${o.size}`,
            o.conductor || '-',
            `${o.ins_colour ? o.ins_colour + ' / ' : ''}${o.ins_compound || '-'}`,
            `${o.sheath_colour || '-'} / ${o.sheath_compound || '-'}`,
            coilInfo,
            r.orderLen.toLocaleString(),
            fmtExact(r.reqCu, 2),
            fmtExact(r.reqIns, 2),
            fmtExact(r.reqSheath, 2),
            stages,
          ];
        }),
      },
    ];
  }

  if (activeTab === 'completed') {
    return [
      {
        title: `Completed Production Orders (${completedOrders.length} Orders)`,
        headers: [
          '#',
          'Batch',
          'Brand',
          'Grade',
          'Cores × Size',
          'Conductor',
          'Order Len (m)',
          'Req Cu (kg)',
          'Req Ins (kg)',
          'Req Sheath (kg)',
          'Dispatch Status',
        ],
        rows: completedOrders.map((o, idx) => {
          const r = computeRecordRow(o, densities, ladiDimensions);
          return [
            String(idx + 1),
            o.batch || '-',
            o.brand || '-',
            o.grade || '-',
            `${o.cores}C × ${o.size}`,
            o.conductor || '-',
            r.orderLen.toLocaleString(),
            fmtExact(r.reqCu, 2),
            fmtExact(r.reqIns, 2),
            fmtExact(r.reqSheath, 2),
            o.dispatched ? `Dispatched (${o.dispatchedLength || r.orderLen}m)` : 'Completed In Stock',
          ];
        }),
      },
    ];
  }

  if (activeTab === 'record') {
    return [
      {
        title: 'Master Engineering & Material Calculation Record',
        headers: [
          'Batch',
          'Brand',
          'Size',
          'Core',
          'Conductor',
          'Nozzle (P)',
          'Core OD (Q)',
          'Ins Die (S)',
          'Ins Grade',
          'Twist (U)',
          'Strand (V)',
          'Ext Noz (X)',
          'Final Dia (Y)',
          'Final Die (Z)',
          'Sheath Grade',
          'Order Len',
          'Core Len',
          'Cu (kg)',
          'Ins (kg)',
          'Sheath (kg)',
        ],
        rows: orders.map(o => {
          const r = computeRecordRow(o, densities, ladiDimensions);
          return [
            r.batch,
            r.brand,
            r.size,
            String(r.cores),
            r.conductor,
            fmtExact(r.nozzle, 4),
            fmtExact(r.coreOd, 4),
            fmtExact(r.insDie, 4),
            r.ins_compound,
            fmtExact(r.twistingDia, 4),
            fmtExact(r.strandingDie, 4),
            fmtExact(r.extNozzle, 4),
            fmtExact(r.finalDia, 4),
            fmtExact(r.finalDie, 4),
            r.sheath_compound || '-',
            r.orderLen.toLocaleString(),
            r.reqCoreLen.toLocaleString(),
            fmtExact(r.reqCu, 2),
            fmtExact(r.reqIns, 2),
            fmtExact(r.reqSheath, 2),
          ];
        }),
      },
    ];
  }

  if (activeTab === 'summary') {
    return [
      {
        title: 'Production Material & Drum Requisition Summary',
        headers: [
          'Batch',
          'Brand',
          'Grade',
          'Spec',
          'Conductor',
          'Order Len (m)',
          'Core Len (m)',
          'Copper (kg)',
          'Ins PVC (kg)',
          'Sheath PVC (kg)',
          'Total Wt (kg)',
          'Spool / Packaging',
        ],
        rows: orders.map(o => {
          const r = computeRecordRow(o, densities, ladiDimensions);
          const pkg = evaluateSpoolSizeForOrder(
            r.finalDia,
            r.orderLen,
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
          const totalWt = (r.reqCu || 0) + (r.reqIns || 0) + (r.reqSheath || 0);
          return [
            o.batch || '-',
            o.brand || '-',
            o.grade || '-',
            `${o.cores}C × ${o.size}`,
            o.conductor || '-',
            r.orderLen.toLocaleString(),
            r.reqCoreLen.toLocaleString(),
            fmtExact(r.reqCu, 2),
            fmtExact(r.reqIns, 2),
            fmtExact(r.reqSheath, 2),
            fmtExact(totalWt, 2),
            `${pkg.spool || 'Carton/Coil'} (${pkg.packaging || ''})`,
          ];
        }),
      },
    ];
  }

  if (activeTab === 'purchase') {
    return [
      {
        title: 'Raw Material Purchases & Invoices Ledger',
        headers: ['Date', 'Invoice', 'Supplier / Party', 'Material Description', 'Stage', 'Qty', 'Rate', 'Status'],
        rows: purchaseItems.map(p => [
          p.date || '-',
          p.invoice || '-',
          p.party || '-',
          p.description || '-',
          (p.stage || 'raw').toUpperCase(),
          p.qty.toLocaleString(),
          p.price ? p.price.toLocaleString() : '-',
          (p.status || 'received').toUpperCase(),
        ]),
      },
    ];
  }

  if (activeTab === 'journal') {
    return [
      {
        title: 'Daily Production Journal — Shift Metrics & OEE Ledger',
        headers: [
          'Date',
          'Shift',
          'Machine',
          'Stage',
          'Batch',
          'Cable Spec',
          'Operator',
          'Run / Plan (h)',
          'Target (m)',
          'Actual (m)',
          'Cu Used (kg)',
          'PVC Used (kg)',
          'Scrap (kg)',
          'QC Status',
        ],
        rows: dailyJournalEntries.map(e => [
          e.date,
          e.shift,
          e.machineName,
          e.processStage,
          e.batch,
          e.cableSpec,
          e.operatorName,
          `${e.actualRunHours}/${e.plannedShiftHours}h`,
          e.targetOutputM.toLocaleString(),
          e.actualOutputM.toLocaleString(),
          fmtExact(e.copperConsumedKg, 2),
          fmtExact(e.compoundConsumedKg, 2),
          fmtExact(e.scrapKg, 2),
          e.qualityStatus,
        ]),
      },
    ];
  }

  if (activeTab === 'dispatch') {
    return [
      {
        title: 'Master Dispatch Details & Delivery Ledger',
        headers: [
          'Dispatch No',
          'Date',
          'Batch',
          'Client',
          'Destination',
          'Brand / Grade',
          'Spec',
          'Pack Type',
          'Length (m)',
          'Net Wt (kg)',
          'Gross Wt (kg)',
          'Vehicle / Container',
          'Status',
        ],
        rows: dispatchRecords.map(d => [
          d.dispatchNo,
          d.date,
          d.batch,
          d.clientName,
          d.destination,
          `${d.brand} (${d.grade})`,
          d.sizeCores,
          d.packagingType,
          d.lengthM.toLocaleString(),
          fmtExact(d.netWeightKg, 2),
          fmtExact(d.grossWeightKg, 2),
          d.vehicleOrContainerNo || '-',
          d.status,
        ]),
      },
    ];
  }

  if (activeTab === 'container') {
    return containerPlans.map(c => ({
      title: `Container Plan: ${c.containerNo} (${c.containerType}) — ${c.clientName || 'Client'} | ${c.destination || ''}`,
      headers: [
        'Batch',
        'Brand / Grade',
        'Size × Cores',
        'Spool Size',
        'Drum Nos',
        'Drums',
        'Pallets',
        'Total Len (m)',
        'Net Wt (kg)',
        'Gross Wt (kg)',
        'CBM',
      ],
      rows: c.items.map(item => [
        item.batch,
        item.brandGrade,
        item.sizeCores,
        item.spool,
        item.drumNo,
        String(item.drumCount),
        String(item.palletsRequired || '-'),
        item.totalLength.toLocaleString(),
        fmtExact(item.netCableWt, 1),
        fmtExact(item.grossWt, 1),
        fmtExact(item.volumeCbm, 2),
      ]),
    }));
  }

  if (activeTab === 'stockslip' && stockLedger) {
    return [
      {
        title: 'Inventory & Stock Management Ledger',
        headers: [
          'Category',
          'Material / Spec Name',
          'Opening',
          'Received',
          'Consumed / Dispatched',
          'Closing Balance',
          'Status',
        ],
        rows: stockLedger.allRows.map(row => [
          row.category,
          row.name,
          `${fmtExact(row.opening, 2)} ${row.unit}`,
          `${fmtExact(row.received, 2)} ${row.unit}`,
          `${fmtExact(row.consumed, 2)} ${row.unit}`,
          `${fmtExact(row.closing, 2)} ${row.unit}`,
          row.closing < 0 ? 'SHORTAGE' : row.closing === 0 ? 'ZERO' : 'IN STOCK',
        ]),
      },
    ];
  }

  return [];
}

/**
 * Exports the currently active production sheet as a professionally formatted, landscape A4 PDF document.
 */
export function exportActiveSheetToPdf(params: ExportSheetPdfParams): string {
  const { activeTab, sheetTitle, orders, densities, ladiDimensions, purchaseItems } = params;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const totalOrders = orders.length;
  const completedCount = orders.filter(o => isOrderComplete(o, ladiDimensions)).length;
  const activeCount = totalOrders - completedCount;

  let totalOrderLen = 0;
  let totalReqCu = 0;
  let totalReqPvc = 0;
  orders.forEach(o => {
    const r = computeRecordRow(o, densities, ladiDimensions);
    totalOrderLen += r.orderLen || 0;
    totalReqCu += r.reqCu || 0;
    totalReqPvc += (r.reqIns || 0) + (r.reqSheath || 0);
  });

  const kpiSummary = [
    { label: 'Active Sheet', value: sheetTitle.replace(/^[0-9A-Z]+\.\s*/, '').slice(0, 26) },
    { label: 'Total Orders', value: `${totalOrders} (${activeCount} Active / ${completedCount} Done)` },
    { label: 'Total Cable Length', value: `${totalOrderLen.toLocaleString()} m` },
    { label: 'Total Copper Req', value: `${fmtExact(totalReqCu, 1)} kg` },
    { label: 'Total PVC Req', value: `${fmtExact(totalReqPvc, 1)} kg` },
    { label: 'Purchase Invoices', value: `${purchaseItems.length} Entries` },
  ];

  // Extract live visible tables from the active tab DOM first (preserves current filters, search, and process cards)
  const domTables = extractVisibleDomTables();
  const structuredTables = buildStructuredTablesForTab(params);

  // Prefer live DOM tables if present; otherwise use structured data tables
  const tablesToRender =
    domTables.length > 0
      ? domTables
      : structuredTables.length > 0
      ? structuredTables
      : buildStructuredTablesForTab({ ...params, activeTab: 'orders' });

  let cursorY = drawPdfHeader(
    doc,
    sheetTitle,
    `Official Production Sheet Export • ${tablesToRender.length} Table(s) Included`,
    kpiSummary
  );

  if (tablesToRender.length === 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'No orders or rows are currently entered on this sheet. Add orders in Tab 1 (Active Orders) to populate this report.',
      12,
      cursorY + 10
    );
  } else {
    tablesToRender.forEach((tbl, idx) => {
      const pageHeight = doc.internal.pageSize.getHeight();
      if (cursorY > pageHeight - 35) {
        doc.addPage();
        cursorY = 14;
      }

      // Section Title Banner
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(203, 213, 225);
      doc.rect(8, cursorY, doc.internal.pageSize.getWidth() - 16, 6.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `${idx + 1}. ${tbl.title} (${tbl.rows.length} Row${tbl.rows.length === 1 ? '' : 's'})`,
        11,
        cursorY + 4.4
      );
      cursorY += 7.5;

      const colCount = Math.max(tbl.headers.length, 1);
      const fontSize = colCount > 16 ? 5.8 : colCount > 11 ? 6.5 : 7.2;

      autoTable(doc, {
        startY: cursorY,
        head: [tbl.headers],
        body: tbl.rows,
        styles: {
          fontSize,
          cellPadding: colCount > 14 ? 1.2 : 1.7,
          lineColor: [203, 213, 225],
          lineWidth: 0.15,
          textColor: [15, 23, 42],
          overflow: 'linebreak',
        },
        headStyles: {
          fillColor: [30, 41, 59],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        margin: { left: 8, right: 8, top: 12, bottom: 14 },
      });

      cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 15) + 6;
    });
  }

  finalizePdfFooters(doc, sheetTitle);

  const safeSlug = sheetTitle
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `PLUTUS_${safeSlug}_${dateStamp}.pdf`;
  doc.save(fileName);
  return fileName;
}

/**
 * Exports a comprehensive multi-page PDF Workbook containing all core production sheets.
 */
export function exportAllSheetsWorkbookToPdf(params: ExportSheetPdfParams): string {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const sections: Array<{ tab: string; title: string }> = [
    { tab: 'orders', title: '1. Active Orders & Engineering Specifications' },
    { tab: 'completed', title: '2. Completed Orders Production Record' },
    { tab: 'record', title: '4. Master Engineering & Material Calculation Record' },
    { tab: 'summary', title: '5. Production Material & Drum Requisition Summary' },
    { tab: 'journal', title: '3B. Daily Production Journal' },
    { tab: 'dispatch', title: '6C. Master Dispatch Details & Delivery Ledger' },
    { tab: 'purchase', title: '7. Raw Material Purchases & Invoices Ledger' },
    { tab: 'stockslip', title: '11. Inventory & Stock Management Slip' },
  ];

  let isFirstSection = true;

  sections.forEach(sec => {
    const tables = buildStructuredTablesForTab({
      ...params,
      activeTab: sec.tab,
      sheetTitle: sec.title,
    });
    if (tables.length === 0 || tables.every(t => t.rows.length === 0)) {
      return;
    }

    if (!isFirstSection) {
      doc.addPage();
    }
    isFirstSection = false;

    let cursorY = drawPdfHeader(
      doc,
      sec.title,
      'Complete Production Workbook Export — Multi-Sheet Master PDF',
      []
    );

    tables.forEach(tbl => {
      if (tbl.rows.length === 0) return;
      const colCount = Math.max(tbl.headers.length, 1);
      const fontSize = colCount > 16 ? 5.8 : colCount > 11 ? 6.5 : 7.2;

      autoTable(doc, {
        startY: cursorY,
        head: [tbl.headers],
        body: tbl.rows,
        styles: {
          fontSize,
          cellPadding: colCount > 14 ? 1.2 : 1.7,
          lineColor: [203, 213, 225],
          lineWidth: 0.15,
          textColor: [15, 23, 42],
          overflow: 'linebreak',
        },
        headStyles: {
          fillColor: [30, 41, 59],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        margin: { left: 8, right: 8, top: 12, bottom: 14 },
      });

      cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 15) + 6;
    });
  });

  if (isFirstSection) {
    drawPdfHeader(
      doc,
      'PLUTUS Master Production Workbook',
      'No production rows currently entered.',
      []
    );
  }

  finalizePdfFooters(doc, 'Master Production PDF Workbook');
  const dateStamp = new Date().toISOString().slice(0, 10);
  const fileName = `PLUTUS_COMPLETE_PRODUCTION_WORKBOOK_${dateStamp}.pdf`;
  doc.save(fileName);
  return fileName;
}
