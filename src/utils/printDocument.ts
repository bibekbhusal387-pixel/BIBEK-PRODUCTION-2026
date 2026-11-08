/**
 * Universal Print & Printable Document Generator
 * Handles printing inside sandboxed preview iframes (where native window.print() may be blocked)
 * as well as standalone browser windows.
 */

let nativeWindowPrint: (() => void) | null = null;

export function registerPrintInterceptor(onTriggerPrintMode: () => void) {
  if (typeof window === 'undefined') return;
  if (!nativeWindowPrint) {
    nativeWindowPrint = window.print.bind(window);
  }

  window.print = () => {
    // 1. Activate clean on-screen Print View Mode immediately
    onTriggerPrintMode();

    // 2. Also attempt native browser print in case the browser/iframe allows it
    setTimeout(() => {
      try {
        window.focus();
        if (nativeWindowPrint) {
          nativeWindowPrint();
        }
      } catch (e) {
        // Ignored if sandboxed iframe blocks print
      }
    }, 120);
  };
}

export function triggerNativePrintOnly() {
  try {
    window.focus();
    if (nativeWindowPrint) {
      nativeWindowPrint();
    } else {
      window.print();
    }
  } catch (e) {
    // Ignored
  }
}

/**
 * Generates and downloads a standalone, print-ready HTML document of the current <main> view.
 * When opened on the user's computer, it automatically opens the system print / Save-as-PDF dialog.
 */
export function downloadPrintableCurrentPage(documentTitle: string) {
  const mainEl = document.querySelector('main');
  if (!mainEl) return;

  // Clone main and sync live input/select/textarea values into attributes so they render in static HTML
  const clone = mainEl.cloneNode(true) as HTMLElement;

  const origInputs = mainEl.querySelectorAll('input, select, textarea');
  const cloneInputs = clone.querySelectorAll('input, select, textarea');

  origInputs.forEach((orig, idx) => {
    const target = cloneInputs[idx];
    if (!target) return;
    if (orig instanceof HTMLInputElement) {
      if (orig.type === 'checkbox' || orig.type === 'radio') {
        if (orig.checked) target.setAttribute('checked', 'checked');
        else target.removeAttribute('checked');
      } else {
        target.setAttribute('value', orig.value);
      }
    } else if (orig instanceof HTMLSelectElement) {
      const options = target.querySelectorAll('option');
      options.forEach(opt => {
        if ((opt as HTMLOptionElement).value === orig.value) {
          opt.setAttribute('selected', 'selected');
        } else {
          opt.removeAttribute('selected');
        }
      });
    } else if (orig instanceof HTMLTextAreaElement) {
      target.textContent = orig.value;
    }
  });

  // Remove any .no-print elements from the printable clone
  clone.querySelectorAll('.no-print').forEach(el => el.remove());

  // Collect all active CSS rules from document stylesheets
  let collectedCss = '';
  try {
    Array.from(document.styleSheets).forEach(sheet => {
      try {
        Array.from(sheet.cssRules).forEach(rule => {
          collectedCss += rule.cssText + '\n';
        });
      } catch {
        // Ignore cross-origin sheets if any
      }
    });
  } catch {
    // Fallback
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${documentTitle} - PLUTUS Printable Sheet</title>
  <style>
    ${collectedCss}
    @page {
      size: A4 landscape;
      margin: 6mm;
    }
    body {
      background: #ffffff !important;
      color: #000000 !important;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 12px;
      margin: 0;
    }
    .print-only {
      display: block !important;
    }
    .no-print {
      display: none !important;
    }
    table {
      width: 100% !important;
      border-collapse: collapse !important;
      font-size: 9.5px !important;
      line-height: 1.2 !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    th, td {
      border: 1px solid #94a3b8 !important;
      padding: 3px 5px !important;
    }
    th {
      background: #e2e8f0 !important;
      color: #000000 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    input, select, textarea {
      border: none !important;
      background: transparent !important;
      font-weight: 700 !important;
      font-size: 9.5px !important;
      color: #000 !important;
    }
    .print-card {
      display: block !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      page-break-after: always !important;
      break-after: page !important;
      margin-bottom: 20px !important;
      border: 1.5px solid #000000 !important;
      padding: 10px !important;
      background: #ffffff !important;
    }
    .print-card:last-child {
      page-break-after: auto !important;
      break-after: auto !important;
    }
    @media print {
      .standalone-toolbar { display: none !important; }
      body { padding: 0 !important; }
      .print-card {
        page-break-after: always !important;
        break-after: page !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin-bottom: 0 !important;
      }
      .print-card:last-child {
        page-break-after: auto !important;
        break-after: auto !important;
      }
    }
  </style>
</head>
<body>
  <div class="standalone-toolbar" style="background:#0f172a;color:#fff;padding:12px 20px;margin-bottom:16px;border-radius:8px;display:flex;align-items:center;justify-content:space-between;font-family:sans-serif;">
    <div>
      <strong style="font-size:14px;">⚡ PLUTUS PRINTABLE DOCUMENT READY</strong>
      <span style="font-size:12px;color:#cbd5e1;margin-left:10px;">${documentTitle}</span>
    </div>
    <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:13px;">
      🖨️ Print / Save as PDF Now (Ctrl+P)
    </button>
  </div>
  <main>
    ${clone.innerHTML}
  </main>
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        window.print();
      }, 300);
    });
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = documentTitle.replace(/[^a-zA-Z0-9_-]+/g, '_');
  a.href = url;
  a.download = `PLUTUS_PRINT_${safeName}_${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
