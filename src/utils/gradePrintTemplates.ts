import { CableOrder } from '../types/cable';

const STORAGE_KEY = 'plutus_custom_print_templates_by_grade';

/**
 * Loads custom saved print templates per grade from localStorage
 */
export function loadCustomPrintTemplates(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // Ignore storage errors
  }
  return {};
}

/**
 * Saves a new custom print template for a specific cable grade
 */
export function saveCustomPrintTemplateForGrade(grade: string, template: string): Record<string, string[]> {
  const current = loadCustomPrintTemplates();
  const gKey = (grade || 'GENERAL').trim().toUpperCase();
  const trimmed = template.trim();
  if (!trimmed) return current;

  const existingList = current[gKey] || [];
  if (!existingList.includes(trimmed)) {
    const updated = {
      ...current,
      [gKey]: [trimmed, ...existingList.slice(0, 19)], // Keep up to 20 custom templates per grade
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage errors
    }
    return updated;
  }
  return current;
}

/**
 * Generates an exhaustive, intelligent list of print legend templates for any cable grade,
 * dynamically incorporating current brand, cores, size, and insulation colour.
 */
export function getGradePrintPresets(
  grade: string,
  brand: string,
  cores: number,
  size: string,
  insColour?: string,
  existingOrders: CableOrder[] = [],
  customTemplates: Record<string, string[]> = {}
): string[] {
  const gUpper = (grade || '').trim().toUpperCase();
  const cleanBrand = (brand || '').trim() || 'PLUTUS';
  const cleanSize = (size || '1.50 SQ MM').trim();
  const cNum = Number(cores) || 1;
  const colText = (insColour || '').trim().toUpperCase();
  const colSuffix = colText ? ` ${colText}` : '';

  const results: string[] = [];

  // 1. Grade-Specific Standard Factory Presets
  if (gUpper.includes('IS-694') || gUpper.includes('IS694')) {
    results.push(
      `MARU MIRACLE - FR ${cleanSize} 1100V (ISI LOGO) IS:694 CM/L 0003894486`,
      `VIHAN TRIGUARD - FR ${cleanSize} 1100V IS:694 (ISI LOGO) C/L 8596412`,
      `VIHAN OPTO - FR ${cleanSize} 1100V IS:694 (ISI LOGO)`,
      `${cleanBrand} IS:694 FR ${cleanSize} 1100V (ISI) CM/L 0003894486`,
      `${cleanBrand} IS:694 ${cleanSize} 1100V${colSuffix} (ISI LOGO) 0000 MTR`,
      `${cleanBrand} IS:694 HR FR 1100V ${cleanSize}${colSuffix}`,
      `${cleanBrand} IS-694 1100V ${cleanSize}${colSuffix}`
    );
  } else if (gUpper.includes('H07RN-F')) {
    results.push(
      `MYBCAB CABLE ${cNum}G ${cleanSize} 90°C H07RN-F BS EN 6195 21150 0.6/1KV IEC 60092-353 0000 MTR`,
      `${cleanBrand} H07RN-F ${cNum}G ${cleanSize} 450/750V HAR CE 0000 MTR`,
      `${cleanBrand} H07RN-F ${cNum}X ${cleanSize} 450/750V HEAVY DUTY RUBBER CE`,
      `${cleanBrand} H07RN-F ${cNum}C X ${cleanSize} 450/750V CE 0000 MTR`,
      `${cleanBrand} H07RN-F ${cNum}C X ${cleanSize}`
    );
  } else if (gUpper.includes('H05RN-F')) {
    results.push(
      `${cleanBrand} H05RN-F ${cNum}G ${cleanSize} 300/500V HAR CE 0000 MTR`,
      `${cleanBrand} H05RN-F ${cNum}C X ${cleanSize} 300/500V RUBBER CABLE CE`,
      `${cleanBrand} H05RN-F ${cNum}C X ${cleanSize}`
    );
  } else if (gUpper.includes('H05VV-F')) {
    results.push(
      `EKP H05VV-F ${cNum}G ${cleanSize} 300/500V VDE CE 0000 MTR`,
      `${cleanBrand} H05VV-F ${cNum}G ${cleanSize} 300/500V CE RoHS 0000 MTR`,
      `${cleanBrand} H05VV-F ${cNum}C X ${cleanSize} 300/500V`,
      `${cleanBrand} H05VV-F ${cNum}C X ${cleanSize}`
    );
  } else if (gUpper.includes('YSLY-JZ')) {
    results.push(
      `SANKA YSLY-JZ ${cNum}G ${cleanSize} 300/500V DIN VDE 0281-13 CE 0000 MTR`,
      `${cleanBrand} YSLY-JZ ${cNum}G ${cleanSize} 300/500V CE RoHS 0000 MTR`,
      `${cleanBrand} YSLY-JZ ${cNum}C X ${cleanSize} 300/500V CONTROL CABLE`,
      `${cleanBrand} YSLY-JZ ${cNum}C X ${cleanSize}`
    );
  } else if (gUpper.includes('YSLY-OZ')) {
    results.push(
      `SANKA YSLY-OZ ${cNum}X ${cleanSize} 300/500V DIN VDE 0281-13 CE 0000 MTR`,
      `${cleanBrand} YSLY-OZ ${cNum}X ${cleanSize} 300/500V CE RoHS 0000 MTR`,
      `${cleanBrand} YSLY-OZ ${cNum}C X ${cleanSize} 300/500V`,
      `${cleanBrand} YSLY-OZ ${cNum}C X ${cleanSize}`
    );
  } else if (gUpper.includes('NYY-JZ')) {
    results.push(
      `${cleanBrand} NYY-JZ ${cNum}G ${cleanSize} 0.6/1KV IEC 60502-1 VDE 0276-603 CE 0000 MTR`,
      `${cleanBrand} NYY-JZ ${cNum}C X ${cleanSize} 0.6/1KV CE 0000 MTR`,
      `${cleanBrand} NYY-JZ ${cNum}C X ${cleanSize}`
    );
  } else if (gUpper.includes('NYY-OZ')) {
    results.push(
      `${cleanBrand} NYY-OZ ${cNum}X ${cleanSize} 0.6/1KV IEC 60502-1 VDE 0276-603 CE 0000 MTR`,
      `${cleanBrand} NYY-OZ ${cNum}C X ${cleanSize} 0.6/1KV`,
      `${cleanBrand} NYY-OZ ${cNum}C X ${cleanSize}`
    );
  } else if (gUpper.includes('H07V-R')) {
    results.push(
      `${cleanBrand} H07V-R 1C X ${cleanSize} 450/750V CE RoHS 0000 MTR`,
      `${cleanBrand} H07V-R ${cleanSize} 450/750V${colSuffix}`,
      `${cleanBrand} H07V-R 1C X ${cleanSize}`
    );
  } else if (gUpper.includes('CONTROL')) {
    results.push(
      `${cleanBrand} CONTROL CABLE ${cNum}C X ${cleanSize} 600/1000V IS:1554 / IEC 60502 0000 MTR`,
      `${cleanBrand} CONTROL CABLE ${cNum}C X ${cleanSize} 1100V CE`,
      `${cleanBrand} CONTROL CABLE ${cNum}C X ${cleanSize}`
    );
  } else {
    // Generic standard presets for any custom grade
    results.push(
      `${cleanBrand} ${grade} ${cNum}C X ${cleanSize} 0000 MTR`,
      `${cleanBrand} ${grade} ${cNum}C X ${cleanSize}${colSuffix}`,
      `${grade} ${cNum}C X ${cleanSize}`
    );
  }

  // 2. Custom User-Saved Templates for this Grade
  const savedForGrade = customTemplates[gUpper] || [];
  savedForGrade.forEach(tpl => {
    // Replace placeholders if present
    const hydrated = tpl
      .replace(/\{brand\}/gi, cleanBrand)
      .replace(/\{grade\}/gi, grade)
      .replace(/\{size\}/gi, cleanSize)
      .replace(/\{cores\}/gi, String(cNum))
      .replace(/\{colour\}/gi, colText || 'RED');
    if (!results.includes(hydrated)) {
      results.push(hydrated);
    }
  });

  // 3. Existing orders of the same grade currently in the database
  existingOrders.forEach(o => {
    if ((o.grade || '').trim().toUpperCase() === gUpper && o.print_details) {
      const p = o.print_details.trim();
      if (p && !results.includes(p)) {
        results.push(p);
      }
    }
  });

  return Array.from(new Set(results.filter(Boolean)));
}
