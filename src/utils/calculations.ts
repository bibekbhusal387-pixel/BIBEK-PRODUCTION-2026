import {
  CableOrder,
  ColourMapRule,
  ComputedRecordRow,
  ContainerPlan,
  DensitySettings,
  LadiDimensionRule,
  PackagingRule,
  SizePackagingRule,
} from '../types/cable';
import { COR_FACTOR, LAY_TIMES } from '../data/defaults';

export function fmtExact(val: number | string | null | undefined, maxDec: number = 6): string {
  if (val === "" || val === null || val === undefined || (typeof val === 'number' && isNaN(val))) {
    return "-";
  }
  const n = Number(val);
  if (isNaN(n) || n === 0) return "-";
  return parseFloat(n.toFixed(maxDec)).toString();
}

export function parseSizeNum(sizeStr: string): number {
  if (!sizeStr) return 0;
  const m = String(sizeStr).trim().match(/^[0-9.]+/);
  return m ? parseFloat(m[0]) : 0;
}

export function parseConductor(condStr: string): { strands: number; dia: number } {
  if (!condStr || !String(condStr).includes('/')) return { strands: 0, dia: 0 };
  const parts = String(condStr).trim().split('/');
  return {
    strands: parseFloat(parts[0]) || 0,
    dia: parseFloat(parts[1]) || 0,
  };
}

export function lookupLadi(sizeNum: number, condStr: string, activeLadi: LadiDimensionRule[]) {
  const cClean = String(condStr).trim();
  const found = activeLadi.find(d => d.size === sizeNum && d.conductor === cClean);
  if (!found) return null;
  const pat = found.pattern;
  const parts = pat.split('+');
  const p1 = parts[0].split('*');
  const sub1 = parseFloat(p1[0]) || 0;
  const cnt1 = parseFloat(p1[1]) || 0;
  let sub2 = 0, cnt2 = 0;
  if (parts.length > 1) {
    const p2 = parts[1].split('*');
    sub2 = parseFloat(p2[0]) || 0;
    cnt2 = parseFloat(p2[1]) || 0;
  }
  return { pattern: pat, sub1, cnt1, sub2, cnt2 };
}

export function normalizeSpoolKey(spool: string | undefined | null): string {
  return (spool || '')
    .replace(/\*/g, 'X')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function resolveExactPalletAndBbnForSpool(
  rawSpool: string,
  packagingRules: PackagingRule[]
): { spool: string; pallet: string; bbnPerPallet: number } {
  const cleanSpool = (rawSpool || '').trim();
  const parseBbnVal = (val: number | string | undefined, fallback: number = 1): number => {
    if (val === undefined || val === null || val === '') return fallback;
    const m = String(val).match(/[0-9]+/);
    const n = m ? parseInt(m[0], 10) : fallback;
    return n > 0 ? n : fallback;
  };

  if (!cleanSpool) {
    return {
      spool: packagingRules[0]?.spool || '21 X 12 X 15',
      pallet: packagingRules[0]?.pallet || '30X30x6',
      bbnPerPallet: parseBbnVal(packagingRules[0]?.bbnPerPallet, 4),
    };
  }

  const normTarget = normalizeSpoolKey(cleanSpool);
  const exactMatch = packagingRules.find(
    r => normalizeSpoolKey(r.spool) === normTarget
  );
  if (exactMatch) {
    return {
      spool: exactMatch.spool || cleanSpool,
      pallet: exactMatch.pallet || '30X30x6',
      bbnPerPallet: parseBbnVal(exactMatch.bbnPerPallet, 1),
    };
  }

  // Smart dimension-based exact pallet & bbn lookup for custom spools (e.g. 21*8*15, 21*8*21, 21*6*16, 15*06*16, 42*16*24)
  const nums = cleanSpool.match(/\d+(\.\d+)?/g);
  if (nums && nums.length >= 3) {
    const flange = parseFloat(nums[0]) || 28;
    const barrel = parseFloat(nums[1]) || 12;
    const traverse = parseFloat(nums[2]) || 15;

    // Look for a rule in packagingRules with the same flange diameter to inherit its pallet size
    const sameFlangeRule = packagingRules.find(r => {
      const rNums = (r.spool || '').match(/\d+(\.\d+)?/g);
      return rNums && rNums.length >= 1 && Math.abs(parseFloat(rNums[0]) - flange) < 0.5;
    });

    if (flange <= 24) {
      const bbn = barrel <= 8 || traverse <= 8 ? 8 : 4;
      return {
        spool: cleanSpool,
        pallet: sameFlangeRule?.pallet || '30X30x6',
        bbnPerPallet: bbn,
      };
    }
    if (flange <= 30) {
      return {
        spool: cleanSpool,
        pallet: sameFlangeRule?.pallet || '30X30x6',
        bbnPerPallet: sameFlangeRule ? parseBbnVal(sameFlangeRule.bbnPerPallet, 2) : 2,
      };
    }
    if (flange <= 42) {
      const bbn = traverse <= 20 && barrel <= 12 ? 2 : 1;
      return {
        spool: cleanSpool,
        pallet: sameFlangeRule?.pallet || '42 x 42 x 6',
        bbnPerPallet: bbn,
      };
    }
    return {
      spool: cleanSpool,
      pallet: sameFlangeRule?.pallet || '45 x 45 x 6',
      bbnPerPallet: 1,
    };
  }

  return {
    spool: cleanSpool,
    pallet: '30X30x6',
    bbnPerPallet: 2,
  };
}

export function isIs694Order(orderOrGrade?: { grade?: string } | string | null): boolean {
  if (!orderOrGrade) return false;
  const g = typeof orderOrGrade === 'string' ? orderOrGrade : (orderOrGrade.grade || '');
  return g.trim().toUpperCase().includes('IS-694');
}

export function isCoilOrCartonOrder(orderOrGrade?: {
  grade?: string;
  coils?: number | string;
  total_order_coils?: number;
  planned_coils?: number;
  carton_count?: number;
  coil_type?: string;
  coil_colour_breakdown?: Record<string, number>;
} | string | null): boolean {
  if (!orderOrGrade) return false;
  if (typeof orderOrGrade === 'string') {
    return orderOrGrade.trim().toUpperCase().includes('IS-694');
  }
  const g = (orderOrGrade.grade || '').trim().toUpperCase();
  if (g.includes('IS-694')) return true;

  const cVal = orderOrGrade.coils;
  if (cVal !== undefined && cVal !== null && cVal !== '') {
    const num = Number(cVal);
    if (!isNaN(num) && num > 0) return true;
    if (typeof cVal === 'string' && cVal.trim().length > 0 && cVal.trim() !== '0') return true;
  }
  if (orderOrGrade.total_order_coils && Number(orderOrGrade.total_order_coils) > 0) return true;
  if (orderOrGrade.planned_coils && Number(orderOrGrade.planned_coils) > 0) return true;
  if (orderOrGrade.carton_count && Number(orderOrGrade.carton_count) > 0) return true;
  if (orderOrGrade.coil_colour_breakdown && Object.keys(orderOrGrade.coil_colour_breakdown).length > 0) return true;
  return false;
}

export function evaluateSpoolSizeForOrder(
  finalDia: number,
  orderLen: number,
  cableSize: string,
  cores: number,
  grade: string,
  sizeRules: SizePackagingRule[],
  packagingRules: PackagingRule[],
  manualSpoolOverride?: string,
  coils?: number | string,
  coilType?: string,
  cartonCount?: number | string
): { spool: string; pallet: string; packaging: string; bbnPerPallet: number } {
  const gClean = (grade || "").trim().toUpperCase();
  const isIs694 = gClean.includes("IS-694");
  const parsedCoils = coils !== undefined && coils !== null && coils !== '' ? Number(coils) : 0;
  const hasCoils = !isNaN(parsedCoils) && parsedCoils > 0;
  const parsedCarton = cartonCount !== undefined && cartonCount !== null && cartonCount !== '' ? Number(cartonCount) : 0;
  const hasCarton = !isNaN(parsedCarton) && parsedCarton > 0;

  // Rule: AT THE ORDER SHEET IF THERE IS MENTION THE COILS DETAIL THEN DRUM WILL NOT APPLICABLE FOR THAT IN ANY CABLE GRADE AND AS WELL AS IF THE GRADE IS MENTION IS-694.
  if (isIs694 || hasCoils || hasCarton) {
    const label = isIs694 ? "N/A (Carton Pack)" : "N/A (Coils Pack)";
    const pkgDesc = isIs694
      ? "Carton / Coils"
      : hasCoils
      ? `${parsedCoils} Coils (${coilType || 'Pack'})`
      : "Coils Pack";
    return {
      spool: label,
      pallet: label,
      packaging: pkgDesc,
      bbnPerPallet: 0,
    };
  }

  const d = parseFloat(String(finalDia)) || 0;
  if (d <= 0 && (!manualSpoolOverride || !manualSpoolOverride.trim())) {
    return { spool: "N/A (Unsheathed)", pallet: "N/A", packaging: "1000m / Drum", bbnPerPallet: 1 };
  }

  let packagingLen = "";
  const cNum = parseInt(String(cores)) || 1;
  const ordNum = parseSizeNum(cableSize);

  const matchesCoreSpec = (rCoresRaw: string, num: number): boolean => {
    const rc = rCoresRaw.trim().toUpperCase();
    if (!rc || rc === "-" || rc === "ALL" || rc === "*") return true;
    if (rc.startsWith("UPTO ") || rc.startsWith("UP TO ")) {
      const lim = parseInt(rc.replace(/UP\s*TO\s*/i, "")) || 3;
      return num <= lim;
    }
    if (rc.startsWith("ABOVE ")) {
      const lim = parseInt(rc.replace("ABOVE ", "")) || 5;
      return num > lim;
    }
    return parseInt(rc) === num;
  };

  // 1. Determine Packaging / Drum Length & Explicit Spool from Backup sizeRules table
  let matchedRule = sizeRules.find(r => {
    const rNum = parseSizeNum(r.size);
    const rGrade = (r.grade || "").trim().toUpperCase();
    const rCores = String(r.cores || "").trim();
    const gradeOk = !rGrade || !gClean || rGrade === gClean || gClean.includes(rGrade) || rGrade.includes(gClean);
    const numOk = ordNum > 0 && rNum > 0 && Math.abs(rNum - ordNum) < 0.01;
    const coreOk = rCores && rCores !== "" && parseInt(rCores) === cNum;
    return gradeOk && numOk && coreOk;
  });

  if (!matchedRule) {
    matchedRule = sizeRules.find(r => {
      const rNum = parseSizeNum(r.size);
      const rGrade = (r.grade || "").trim().toUpperCase();
      const rCores = String(r.cores || "").trim();
      const gradeOk = !rGrade || !gClean || rGrade === gClean || gClean.includes(rGrade) || rGrade.includes(gClean);
      const numOk = ordNum > 0 && rNum > 0 && Math.abs(rNum - ordNum) < 0.01;
      return gradeOk && numOk && matchesCoreSpec(rCores, cNum);
    });
  }

  if (!matchedRule && ordNum > 0) {
    matchedRule = sizeRules.find(
      r => Math.abs(parseSizeNum(r.size) - ordNum) < 0.01 && matchesCoreSpec(String(r.cores || ""), cNum)
    );
  }

  if (matchedRule && matchedRule.packaging && matchedRule.packaging.trim() !== "") {
    packagingLen = matchedRule.packaging.trim();
  }

  // Accurate fallback for packaging length when grade/cores are not explicitly in sizeRules
  if (!packagingLen) {
    if (orderLen === 500) {
      packagingLen = "500m / Drum";
    } else if (cNum === 1) {
      // Single-core up to 120 SQ MM uses 1000m / Drum; 150 SQ MM and above uses 500m / Drum
      packagingLen = ordNum <= 120 ? "1000m / Drum" : "500m / Drum";
    } else {
      // Multi-core up to 6.00 SQ MM (with OD <= 24.0 mm) uses 1000m / Drum; larger multi-core uses 500m / Drum
      packagingLen = ordNum <= 6 && d <= 24.0 ? "1000m / Drum" : "500m / Drum";
    }
  }

  // If order has an explicit manual spool_size override, resolve its exact pallet and bbnPerPallet immediately
  if (manualSpoolOverride && manualSpoolOverride.trim() !== "") {
    const resolved = resolveExactPalletAndBbnForSpool(manualSpoolOverride, packagingRules);
    return {
      spool: resolved.spool,
      pallet: resolved.pallet,
      packaging: packagingLen,
      bbnPerPallet: resolved.bbnPerPallet,
    };
  }

  // 2. Determine Drum Size (Spool Size), Pallet Size, and No. of Bbn / Pallet
  let evaluatedSpool = "";
  let evaluatedPallet = "30X30x6";
  let evaluatedBbnPerPallet = 1;
  const is500m = packagingLen.toLowerCase().includes("500");

  function parseBbn(val: number | string | undefined): number {
    if (val === undefined || val === null || val === "") return 1;
    const m = String(val).match(/[0-9]+/);
    const n = m ? parseInt(m[0], 10) : 1;
    return n > 0 ? n : 1;
  }

  function parseRangeBounds(txt: string): { minVal: number; maxVal: number } | null {
    if (!txt || txt === "-") return null;
    const tLower = txt.toLowerCase();
    if (tLower.includes("upto") || tLower.includes("up to")) {
      const matchMax = tLower.match(/[0-9.]+/);
      return matchMax ? { minVal: 0, maxVal: parseFloat(matchMax[0]) } : null;
    }
    const nums = tLower.match(/[0-9.]+/g);
    if (nums && nums.length >= 2) {
      return {
        minVal: parseFloat(nums[0]),
        maxVal: parseFloat(nums[1]),
      };
    }
    return null;
  }

  function testRange(txt: string, finalD: number) {
    const bounds = parseRangeBounds(txt);
    if (!bounds) return false;
    return finalD >= (bounds.minVal - 0.08) && finalD <= (bounds.maxVal + 0.08);
  }

  // If matchedRule in SizePackagingRule explicitly specifies a Drum Size (spool), apply it first!
  if (matchedRule && matchedRule.spool && matchedRule.spool.trim() !== "") {
    const resolved = resolveExactPalletAndBbnForSpool(matchedRule.spool.trim(), packagingRules);
    return {
      spool: resolved.spool,
      pallet: resolved.pallet,
      packaging: packagingLen,
      bbnPerPallet: resolved.bbnPerPallet,
    };
  }

  // Pass 1: Check primary column matching packaging length
  if (!evaluatedSpool) {
    for (const r of packagingRules) {
      const primaryCol = is500m ? r.m500 : r.m1000;
      if (testRange(primaryCol, d)) {
        evaluatedSpool = r.spool;
        evaluatedPallet = r.pallet;
        evaluatedBbnPerPallet = parseBbn(r.bbnPerPallet);
        break;
      }
    }
  }

  // Pass 2: Secondary column
  if (!evaluatedSpool) {
    for (const r of packagingRules) {
      const secondaryCol = is500m ? r.m1000 : r.m500;
      if (testRange(secondaryCol, d)) {
        evaluatedSpool = r.spool;
        evaluatedPallet = r.pallet;
        evaluatedBbnPerPallet = parseBbn(r.bbnPerPallet);
        break;
      }
    }
  }

  // Pass 3: Gap-free nearest-fit fallback (handles decimals between ranges like 18.25mm, 33.4mm, 37mm)
  if (!evaluatedSpool && packagingRules.length > 0) {
    let bestRule: PackagingRule | null = null;
    let bestDist = Infinity;

    // First look in primary column for the smallest drum whose maxVal >= d, or closest range
    for (const colMode of ['primary', 'secondary'] as const) {
      for (const r of packagingRules) {
        const colTxt = colMode === 'primary' ? (is500m ? r.m500 : r.m1000) : (is500m ? r.m1000 : r.m500);
        const bounds = parseRangeBounds(colTxt);
        if (!bounds) continue;
        let dist = 0;
        if (d < bounds.minVal) {
          dist = bounds.minVal - d;
        } else if (d > bounds.maxVal) {
          // Slightly penalize drums smaller than d so we prefer rounding up to the next larger drum
          dist = (d - bounds.maxVal) * 1.5;
        }
        if (dist < bestDist) {
          bestDist = dist;
          bestRule = r;
        }
      }
      if (bestRule && bestDist <= 2.5) break;
    }

    if (bestRule) {
      evaluatedSpool = bestRule.spool;
      evaluatedPallet = bestRule.pallet;
      evaluatedBbnPerPallet = parseBbn(bestRule.bbnPerPallet);
    }
  }

  if (!evaluatedSpool) {
    evaluatedSpool = packagingRules[0] ? packagingRules[0].spool : "21 X 12 X 15";
    evaluatedPallet = packagingRules[0] ? packagingRules[0].pallet : "30X30x6";
    evaluatedBbnPerPallet = packagingRules[0] ? parseBbn(packagingRules[0].bbnPerPallet) : 4;
  } else {
    const resolved = resolveExactPalletAndBbnForSpool(evaluatedSpool, packagingRules);
    evaluatedSpool = resolved.spool;
    evaluatedPallet = resolved.pallet;
    evaluatedBbnPerPallet = resolved.bbnPerPallet;
  }

  return {
    spool: evaluatedSpool,
    pallet: evaluatedPallet,
    packaging: packagingLen,
    bbnPerPallet: evaluatedBbnPerPallet,
  };
}

function lookupCompoundDensity(
  map: Record<string, number>,
  compoundName: string,
  defaultFallback: number = 0.00148
): number {
  const trimmed = (compoundName || "").trim();
  if (!trimmed) return 0;
  if (map && map[trimmed] !== undefined && Number(map[trimmed]) > 0) {
    return Number(map[trimmed]);
  }
  const norm = trimmed.replace(/\s+/g, " ").toUpperCase();
  if (map) {
    for (const [k, v] of Object.entries(map)) {
      if (k.trim().replace(/\s+/g, " ").toUpperCase() === norm && Number(v) > 0) {
        return Number(v);
      }
    }
  }
  if (norm.includes("A 80") || norm.includes("A80")) return 0.00125;
  if (norm.includes("KI-06") || norm.includes("KI06")) return 0.00152;
  if (norm.includes("KI-13") || norm.includes("KI13") || norm.includes("TI1") || norm.includes("GRADE A")) return 0.00148;
  if (norm.includes("ST-1") || norm.includes("ST1")) return 0.00144;
  return defaultFallback;
}

export function computeRecordRow(
  o: CableOrder,
  densities: DensitySettings,
  activeLadi: LadiDimensionRule[]
): ComputedRecordRow {
  const sizeNum = parseSizeNum(o.size);
  const { strands, dia } = parseConductor(o.conductor);
  const ladi = lookupLadi(sizeNum, o.conductor, activeLadi);
  const cores = parseInt(String(o.cores)) || 1;
  const layFactor = COR_FACTOR[cores] || (cores > 1 ? 2.0 : 0);
  const layTimes = LAY_TIMES[cores] || 14;

  const sub1 = ladi ? ladi.sub1 : "";
  const f2 = ladi ? ladi.cnt1 : "";
  const sub2 = (ladi && ladi.sub2) ? ladi.sub2 : "";
  const h2 = (ladi && ladi.cnt2) ? ladi.cnt2 : "";

  const ladiDia1 = (ladi && Number(sub1) > 0 && dia > 0) ? Math.sqrt(Number(sub1)) * dia * 1.15 : "";
  const ladiDia2 = (ladi && Number(sub2) > 0 && dia > 0) ? Math.sqrt(Number(sub2)) * dia * 1.15 : "";
  const ladiLay = (ladiDia1 !== "" || ladiDia2 !== "") ? Math.round((Number(ladiDia1 !== "" ? ladiDia1 : ladiDia2)) * 32) : "";

  const rawCuArea = (strands > 0 && dia > 0) ? strands * dia * dia * 0.785 : 0;
  const cuArea = rawCuArea > 0 ? rawCuArea : (sizeNum > 0 ? sizeNum : 0);
  const rawBunchDia = (strands > 0 && dia > 0) ? Math.sqrt(strands) * dia * 1.15 : 0;
  const bunchDia = rawBunchDia > 0 ? rawBunchDia : (cuArea > 0 ? Math.sqrt(cuArea / 0.785) * 1.15 : 0);
  const hasLadi = (sub1 !== "" || sub2 !== "");
  const bunchLay = bunchDia > 0 ? bunchDia * (hasLadi ? 16 : 35) : 0;
  const nozzle = bunchDia > 0 ? bunchDia * (1 + 0.087) : 0;
  const rawCoreOd = parseFloat(String(o.core_od)) || 0;
  const coreOd = rawCoreOd > bunchDia ? rawCoreOd : (bunchDia > 0 ? Number((bunchDia + 1.4).toFixed(2)) : rawCoreOd);
  const coreThickness = (coreOd > 0 && bunchDia > 0) ? (coreOd - bunchDia) / 2 : 0;
  const insDie = coreOd > 0 ? coreOd * (1 + 0.008) : 0;

  const twistingDia = (cores > 1 && coreOd > 0 && layFactor > 0) ? coreOd * layFactor : 0;
  const strandingDie = twistingDia > 0 ? twistingDia + 0.1 : 0;
  const layLength = twistingDia > 0 ? Math.round(twistingDia * layTimes) : 0;

  const finalDia = parseFloat(String(o.final_dia)) || 0;
  const sheathComp = (o.sheath_compound || "").trim();
  let extNozzle = 0;
  if (cores === 1 && finalDia > 0 && sheathComp !== "") {
    extNozzle = (coreOd * 1.05) + 1.25 + 1.25;
  } else if (twistingDia > 0) {
    extNozzle = twistingDia * (1 + 0.028);
  }
  const finalDie = finalDia > 0 ? finalDia * (1 + 0.007) : 0;

  const orderLen = Math.round(parseFloat(String(o.order_length)) || 0);
  const reqCoreLen = orderLen > 0 ? Math.round(orderLen * cores * 1.02) : 0;
  const cuDensity = Number(densities.COPPER) || 0.00889;
  const reqCu = reqCoreLen > 0 ? cuArea * cuDensity * reqCoreLen : 0;

  const insDensity = lookupCompoundDensity(densities.INSULATION, o.ins_compound || "", 0.00148);
  const reqIns = (reqCoreLen > 0 && coreOd > 0 && bunchDia > 0)
    ? Math.max(0, (coreOd * coreOd - bunchDia * bunchDia) * 0.785 * insDensity * reqCoreLen)
    : 0;

  const sheathDensity = lookupCompoundDensity(densities.SHEATH, sheathComp, 0.00145);
  const reqSheath = (orderLen > 0 && finalDia > 0 && sheathComp !== "")
    ? Math.max(0, (finalDia * finalDia - (coreOd * coreOd * cores)) * 0.785 * sheathDensity * orderLen)
    : 0;

  return {
    ...o,
    sizeNum, strands, dia,
    sub1, f2, sub2, h2,
    ladiPattern: ladi ? ladi.pattern : "",
    ladiDia1, ladiDia2, ladiLay,
    cuArea, bunchDia, bunchLay, nozzle,
    coreOd, coreThickness, insDie,
    layFactor, twistingDia, strandingDie, layTimes, layLength,
    extNozzle, finalDia, finalDie,
    orderLen, reqCoreLen, reqCu, reqIns, reqSheath
  };
}

/**
 * Expands any order that has Partial Production Plan lots (`production_lots`) so that
 * material requirement & stock deduction calculations include BOTH the released parcel lots
 * AND the remaining order balance on the Order Sheet, as well as any Operator Production Log actuals.
 */
export function expandOrdersForMaterialRequirements(orders: CableOrder[]): CableOrder[] {
  const expanded: CableOrder[] = [];
  orders.forEach(o => {
    const lots = o.production_lots || [];
    if (lots.length > 0) {
      lots.forEach(lot => {
        const lotLogs = lot.operator_production_logs || [];
        const loggedMeters = lotLogs.reduce((s, l) => s + (Number(l.actualLengthM) || 0), 0);
        const loggedCoils = lotLogs.reduce((s, l) => s + (Number(l.actualCoils) || 0), 0);
        expanded.push({
          ...o,
          coils: loggedCoils > 0 ? loggedCoils : lot.coils,
          coil_type: lot.coil_type || o.coil_type,
          order_length: loggedMeters > 0 ? loggedMeters : lot.order_length,
          carton_count: lot.carton_count,
          coil_colour_breakdown: lot.coil_colour_breakdown || o.coil_colour_breakdown,
          ins_colour: lot.ins_colour || o.ins_colour,
          dispatched: lot.dispatched ?? o.dispatched,
          operator_production_logs: lotLogs.length > 0 ? lotLogs : o.operator_production_logs,
        });
      });
      // Also include remaining order_length on the Order Sheet if > 0
      if ((Number(o.order_length) || 0) > 0) {
        expanded.push({
          ...o,
          production_lots: undefined,
          operator_production_logs: undefined,
        });
      }
    } else {
      const logs = o.operator_production_logs || [];
      const loggedMeters = logs.reduce((s, l) => s + (Number(l.actualLengthM) || 0), 0);
      const loggedCoils = logs.reduce((s, l) => s + (Number(l.actualCoils) || 0), 0);
      if (loggedMeters > 0) {
        expanded.push({
          ...o,
          coils: loggedCoils > 0 ? loggedCoils : o.coils,
          order_length: Math.max(Number(o.order_length) || 0, loggedMeters),
        });
      } else {
        expanded.push(o);
      }
    }
  });
  return expanded;
}

export function calcMaxBobbinLen(kgpm: number): number {
  if (!kgpm || kgpm <= 0) return 0;
  const raw = 280 / kgpm;
  if (raw >= 1000) return Math.max(1, Math.floor(raw / 1000) * 1000);
  return Math.max(1, Math.floor(raw));
}

export type ProcessStageKey = 'b' | 'c' | 'i' | 't' | 's';

export const STAGE_SEQUENCE: ProcessStageKey[] = ['b', 'c', 'i', 't', 's'];

export const STAGE_LABELS: Record<ProcessStageKey, string> = {
  b: '1. Bunching (B)',
  c: '2. Cu Stranding (CS)',
  i: '3. Insulation (I)',
  t: '4. Twisting (TS)',
  s: '5. Sheathing (SH)',
};

export const STAGE_SHORT_LABELS: Record<ProcessStageKey, string> = {
  b: 'B',
  c: 'CS',
  i: 'I',
  t: 'TS',
  s: 'SH',
};

/**
 * Determines which production stages are required by engineering rules for a given cable order:
 * - b (Bunching): Always required first (Step 1)
 * - c (Cu Stranding / Ladi): Required ONLY when conductor size > 6 SQ MM (i.e. >= 10 SQ MM or in Ladi rules)
 * - i (Insulation): Always required after Bunching (or after Cu Stranding if c is required)
 * - t (Twisting / Core Stranding): Required ONLY when cores > 1
 * - s (Sheathing): Required when final_dia > 0 or sheath_compound is specified
 */
export function getRequiredStagesForOrder(
  o: Pick<CableOrder, 'size' | 'cores' | 'final_dia' | 'sheath_compound'> & { grade?: string },
  ladiRules?: LadiDimensionRule[]
): Record<ProcessStageKey, boolean> {
  // For IS-694 orders, Bunching (b) -> IS-694 Insulation (i) are the ONLY stages, and Insulation (i) is the FINAL stage!
  if (isIs694Order(o.grade)) {
    return {
      b: true,
      c: false,
      i: true,
      t: false,
      s: false,
    };
  }

  const sizeNum = parseSizeNum(o.size);
  const hasLadiRule = ladiRules
    ? ladiRules.some(l => Math.abs(l.size - sizeNum) < 0.01)
    : sizeNum > 6;
  const needsCuStranding = sizeNum > 6 || hasLadiRule;
  const cores = parseInt(String(o.cores)) || 1;
  const finalDia = parseFloat(String(o.final_dia)) || 0;
  const hasSheath = finalDia > 0 || (o.sheath_compound || '').trim() !== '';

  return {
    b: true,
    c: needsCuStranding,
    i: true,
    t: cores > 1,
    s: hasSheath,
  };
}

export interface StageLockState {
  stageKey: ProcessStageKey;
  isRequired: boolean;
  isUnlocked: boolean;
  isDone: boolean;
  missingPrerequisite?: ProcessStageKey;
  missingPrerequisiteLabel?: string;
  skipReason?: string;
}

export function getStageLockState(
  o: CableOrder,
  stageKey: ProcessStageKey,
  ladiRules?: LadiDimensionRule[]
): StageLockState {
  const reqStages = getRequiredStagesForOrder(o, ladiRules);
  const p = o.pStatus || { b: false, c: false, i: false, t: false, s: false };
  const isRequired = reqStages[stageKey];

  if (!isRequired) {
    let skipReason = 'Not required by rules';
    if (isIs694Order(o.grade)) {
      skipReason = 'Not applicable for IS-694 (Bunching → IS-694 Insulation is the final stage)';
    } else {
      if (stageKey === 'c') skipReason = 'Not required for ≤ 6 SQ MM (moves directly from Bunching to Insulation)';
      if (stageKey === 't') skipReason = 'Not required for 1-Core cable (moves directly to Sheathing)';
      if (stageKey === 's') skipReason = 'Unsheathed single-core cable';
    }
    return {
      stageKey,
      isRequired: false,
      isUnlocked: false,
      isDone: false,
      skipReason,
    };
  }

  const stageIdx = STAGE_SEQUENCE.indexOf(stageKey);
  for (let i = 0; i < stageIdx; i++) {
    const prevKey = STAGE_SEQUENCE[i];
    if (reqStages[prevKey] && !p[prevKey]) {
      return {
        stageKey,
        isRequired: true,
        isUnlocked: false,
        isDone: !!p[stageKey],
        missingPrerequisite: prevKey,
        missingPrerequisiteLabel: STAGE_LABELS[prevKey],
      };
    }
  }

  return {
    stageKey,
    isRequired: true,
    isUnlocked: true,
    isDone: !!p[stageKey],
  };
}

export function applySerialStageToggle(
  o: CableOrder,
  stageKey: ProcessStageKey,
  targetValue?: boolean,
  ladiRules?: LadiDimensionRule[]
): {
  allowed: boolean;
  pStatus: { b: boolean; c: boolean; i: boolean; t: boolean; s: boolean };
  reason?: string;
  cascadedResetKeys?: ProcessStageKey[];
} {
  const currentP = {
    b: !!o.pStatus?.b,
    c: !!o.pStatus?.c,
    i: !!o.pStatus?.i,
    t: !!o.pStatus?.t,
    s: !!o.pStatus?.s,
  };
  const reqStages = getRequiredStagesForOrder(o, ladiRules);
  const lockState = getStageLockState(o, stageKey, ladiRules);

  if (!lockState.isRequired) {
    return {
      allowed: false,
      pStatus: currentP,
      reason: `${STAGE_LABELS[stageKey]} is not required by rules (${lockState.skipReason}).`,
    };
  }

  const nextVal = targetValue !== undefined ? targetValue : !currentP[stageKey];

  if (nextVal) {
    if (!lockState.isUnlocked) {
      return {
        allowed: false,
        pStatus: currentP,
        reason: `Serial Process Rule: Please complete ${lockState.missingPrerequisiteLabel} first before ${STAGE_LABELS[stageKey]}.`,
      };
    }
    return {
      allowed: true,
      pStatus: {
        ...currentP,
        // Ensure non-required stages stay false while setting this required stage true
        c: reqStages.c ? (stageKey === 'c' ? true : currentP.c) : false,
        t: reqStages.t ? (stageKey === 't' ? true : currentP.t) : false,
        s: reqStages.s ? (stageKey === 's' ? true : currentP.s) : false,
        [stageKey]: true,
      },
    };
  } else {
    // Unchecking an earlier stage automatically resets all subsequent stages to maintain strict serial order
    const stageIdx = STAGE_SEQUENCE.indexOf(stageKey);
    const updatedP = { ...currentP, [stageKey]: false };
    const cascadedResetKeys: ProcessStageKey[] = [];
    for (let i = stageIdx + 1; i < STAGE_SEQUENCE.length; i++) {
      const laterKey = STAGE_SEQUENCE[i];
      if (updatedP[laterKey]) {
        cascadedResetKeys.push(laterKey);
      }
      updatedP[laterKey] = false;
    }
    return {
      allowed: true,
      pStatus: updatedP,
      cascadedResetKeys,
    };
  }
}

export function getOrderProgressStats(o: CableOrder, ladiRules?: LadiDimensionRule[]) {
  const reqStages = getRequiredStagesForOrder(o, ladiRules);
  const p = o.pStatus || { b: false, c: false, i: false, t: false, s: false };
  const requiredKeys = STAGE_SEQUENCE.filter(k => reqStages[k]);
  const completedKeys = requiredKeys.filter(k => !!p[k]);
  const totalRequired = requiredKeys.length;
  const completedCount = completedKeys.length;
  const percentage = totalRequired > 0 ? Math.round((completedCount / totalRequired) * 100) : 0;
  const nextActiveStage = requiredKeys.find(k => !p[k]) || null;

  return {
    reqStages,
    requiredKeys,
    completedCount,
    totalRequired,
    percentage,
    nextActiveStage,
  };
}

export function isOrderBunched(o: CableOrder): boolean {
  return Boolean(o.pStatus?.b || o.bunch_source === 'purchased_stock');
}

export function isOrderCuStranded(o: CableOrder): boolean {
  return Boolean(o.pStatus?.c);
}

export function isOrderInsulated(o: CableOrder): boolean {
  return Boolean(o.pStatus?.i);
}

export function isOrderTwisted(o: CableOrder): boolean {
  return Boolean(o.pStatus?.t);
}

export function isOrderSheathed(o: CableOrder): boolean {
  return Boolean(o.pStatus?.s);
}

export function isOrderDrumCompleted(o: CableOrder, ladiRules?: LadiDimensionRule[]): boolean {
  return Boolean(
    isOrderComplete(o, ladiRules) ||
    o.pStatus?.s ||
    ((o.grade || '').toUpperCase().includes('IS-694') && o.pStatus?.i)
  );
}

export function isOrderComplete(o: CableOrder, ladiRules?: LadiDimensionRule[]): boolean {
  if (!o.pStatus) return false;
  const reqStages = getRequiredStagesForOrder(o, ladiRules);
  return STAGE_SEQUENCE.every(k => !reqStages[k] || !!o.pStatus?.[k]);
}

export function getCoreColoursForOrder(
  grade: string,
  cores: number,
  cmap: ColourMapRule[],
  customInsColour?: string
): Record<string, number> {
  const g = (grade || "").trim().toUpperCase();
  const c = parseInt(String(cores)) || 1;

  if (customInsColour && customInsColour.trim() !== "") {
    const raw = customInsColour.trim().toUpperCase();
    const parts = raw.split(/[,;/]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      const customRes: Record<string, number> = {};
      parts.forEach(p => {
        if (p.includes(':') || p.includes('=')) {
          const [colName] = p.split(/[:=]/).map(s => s.trim());
          if (colName) customRes[colName] = (customRes[colName] || 0) + 1;
        } else if (p.includes('*')) {
          const [colName, cntStr] = p.split('*').map(s => s.trim());
          const cnt = parseInt(cntStr) || 1;
          if (colName) customRes[colName] = (customRes[colName] || 0) + cnt;
        } else {
          customRes[p] = (customRes[p] || 0) + 1;
        }
      });
      if (Object.keys(customRes).length > 0) {
        return customRes;
      }
    }
  }

  const matchesCoreSpec = (rawCores: string, num: number): boolean => {
    const rc = (rawCores || "").trim().toUpperCase();
    if (!rc || rc === "ALL" || rc === "*") return true;
    if (rc.startsWith("ABOVE ")) {
      const lim = parseInt(rc.replace("ABOVE ", "")) || 5;
      return num > lim;
    }
    if (rc.startsWith("UPTO ") || rc.startsWith("UP TO ")) {
      const lim = parseInt(rc.replace(/UP\s*TO\s*/i, "")) || 3;
      return num <= lim;
    }
    return parseInt(rc) === num;
  };

  const matchesGradeSpec = (rawGrade: string, targetGrade: string): boolean => {
    const rg = (rawGrade || "").trim().toUpperCase();
    if (!rg || rg === "ALL" || rg === "*") return true;
    return targetGrade === rg || targetGrade.includes(rg) || rg.includes(targetGrade);
  };

  // Pass 1: exact grade + exact core
  let found = cmap.find(
    x => (x.grade || "").trim().toUpperCase() === g && parseInt(String(x.cores || "").trim()) === c
  );
  // Pass 2: matching grade + exact core
  if (!found) {
    found = cmap.find(
      x => matchesGradeSpec(x.grade, g) && parseInt(String(x.cores || "").trim()) === c
    );
  }
  // Pass 3: matching grade + range/wildcard core (ABOVE / UPTO / ALL)
  if (!found) {
    found = cmap.find(
      x => matchesGradeSpec(x.grade, g) && matchesCoreSpec(x.cores, c)
    );
  }
  // Pass 4: fallback by core count only
  if (!found) {
    found = cmap.find(x => parseInt(String(x.cores || "").trim()) === c) ||
            cmap.find(x => matchesCoreSpec(x.cores, c));
  }
  if (!found) {
    if (c === 1) return { "BLACK": 1 };
    return { "YL/GN": 1, "BLACK": c - 1 };
  }

  const parts = found.seq.split(',').map(s => s.trim()).filter(Boolean);
  const res: Record<string, number> = {};
  let restColor: string | null = null;

  parts.forEach(p => {
    const pUpper = p.toUpperCase().trim();
    if (pUpper.includes("REST OF ALL")) {
      const restName = pUpper.replace(/REST\s+OF\s+ALL\s*/i, '').trim();
      restColor = restName || "BLACK";
    } else if (p.includes('*')) {
      const sub = p.split('*');
      const colName = sub[0].trim().toUpperCase();
      const cnt = parseInt(sub[1]) || 1;
      res[colName] = (res[colName] || 0) + cnt;
    } else {
      const colName = p.trim().toUpperCase();
      res[colName] = (res[colName] || 0) + 1;
    }
  });

  if (restColor) {
    const allocated = Object.values(res).reduce((sum, n) => sum + n, 0);
    const remaining = Math.max(0, c - allocated);
    if (remaining > 0) {
      res[restColor] = (res[restColor] || 0) + remaining;
    }
  }

  return res;
}

export function formatColourSequence(
  grade: string,
  cores: number,
  cmap: ColourMapRule[],
  customInsColour?: string
): string {
  const map = getCoreColoursForOrder(grade, cores, cmap, customInsColour);
  return Object.entries(map).map(([col, cnt]) => cnt > 1 ? `${col}*${cnt}` : col).join(", ");
}

export interface Is694ColourCoilItem {
  colour: string;
  coils: number;
  coilType: string;
  orderLenM: number;
  reqCoreLenM: number;
  reqInsKg: number;
}

export function getCoilMultiplierByOption(coilType?: string): number {
  const ct = (coilType || '100 YARD').trim().toUpperCase();
  if (ct.includes('100 YARD')) return 91.5;
  if (ct.includes('100 MTR')) return 100;
  if (ct.includes('90 MTR') || ct === '90MTR') return 90;
  if (ct.includes('45 MTR') || ct === '45MTR') return 45;
  if (ct.includes('180 MTR') || ct === '180MTR') return 180;
  return 91.5;
}

export function getIs694ColourCoilsBreakdown(
  o: ComputedRecordRow,
  cmap: ColourMapRule[]
): Is694ColourCoilItem[] {
  const coilType = o.coil_type || '100 YARD';
  const mult = getCoilMultiplierByOption(coilType);
  const totalCoilsFromOrder =
    o.coils !== undefined && o.coils !== '' && Number(o.coils) > 0
      ? Number(o.coils)
      : mult > 0
      ? Number((o.orderLen / mult).toFixed(1))
      : 0;

  // 1. Check explicit coil_colour_breakdown object first
  if (o.coil_colour_breakdown && typeof o.coil_colour_breakdown === 'object') {
    const entries = Object.entries(o.coil_colour_breakdown).filter(
      ([col, val]) => col.trim() !== '' && Number(val) > 0
    );
    if (entries.length > 0) {
      const sumCoils = entries.reduce((s, [, val]) => s + Number(val), 0);
      return entries.map(([col, val]) => {
        const cCount = Number(val);
        const share = sumCoils > 0 ? cCount / sumCoils : 1 / entries.length;
        return {
          colour: col.trim().toUpperCase(),
          coils: cCount,
          coilType,
          orderLenM: Math.round(o.orderLen * share * 10) / 10,
          reqCoreLenM: Math.round(o.reqCoreLen * share),
          reqInsKg: o.reqIns * share,
        };
      });
    }
  }

  // 2. Check ins_colour string for "RED: 20, YELLOW: 30" or "RED, YELLOW" or "RED"
  const rawInsCol = (o.ins_colour || '').trim().toUpperCase();
  if (rawInsCol) {
    const tokens = rawInsCol.split(/[,;/]+/).map(s => s.trim()).filter(Boolean);
    const parsedPairs: { col: string; count?: number }[] = [];
    tokens.forEach(tok => {
      if (tok.includes(':') || tok.includes('=')) {
        const [cName, cVal] = tok.split(/[:=]/).map(s => s.trim());
        const num = parseFloat(cVal);
        if (cName) {
          parsedPairs.push({ col: cName, count: !isNaN(num) && num > 0 ? num : undefined });
        }
      } else if (tok.includes('*')) {
        const [cName, cVal] = tok.split('*').map(s => s.trim());
        const num = parseFloat(cVal);
        if (cName) {
          parsedPairs.push({ col: cName, count: !isNaN(num) && num > 0 ? num : undefined });
        }
      } else {
        parsedPairs.push({ col: tok });
      }
    });

    if (parsedPairs.length > 0) {
      const hasExplicitCounts = parsedPairs.some(p => p.count !== undefined && p.count > 0);
      if (hasExplicitCounts) {
        const sumCoils = parsedPairs.reduce((s, p) => s + (p.count || 0), 0);
        return parsedPairs.map(p => {
          const cCount = p.count || 0;
          const share = sumCoils > 0 ? cCount / sumCoils : 1 / parsedPairs.length;
          return {
            colour: p.col,
            coils: cCount,
            coilType,
            orderLenM: Math.round(o.orderLen * share * 10) / 10,
            reqCoreLenM: Math.round(o.reqCoreLen * share),
            reqInsKg: o.reqIns * share,
          };
        });
      } else {
        const share = 1 / parsedPairs.length;
        return parsedPairs.map(p => ({
          colour: p.col,
          coils: Math.round(totalCoilsFromOrder * share * 10) / 10,
          coilType,
          orderLenM: Math.round(o.orderLen * share * 10) / 10,
          reqCoreLenM: Math.round(o.reqCoreLen * share),
          reqInsKg: o.reqIns * share,
        }));
      }
    }
  }

  // 3. Fallback to sheath_colour if set, or colourMap
  const fallbackCol =
    (o.sheath_colour || '').trim().toUpperCase() ||
    Object.keys(getCoreColoursForOrder(o.grade, o.cores, cmap))[0] ||
    'RED';

  return [
    {
      colour: fallbackCol,
      coils: totalCoilsFromOrder,
      coilType,
      orderLenM: o.orderLen,
      reqCoreLenM: o.reqCoreLen,
      reqInsKg: o.reqIns,
    },
  ];
}

export interface OrderContainerAssignment {
  containerId: string;
  containerNo: string;
  containerType: string;
  plannedStuffingDate: string;
  etd: string;
  status: ContainerPlan['status'];
  bookingNo: string;
  destination: string;
  clientName: string;
  drumCount: number;
  totalLength: number;
  grossWt: number;
  volumeCbm: number;
  stowagePositions: string[];
}

/**
 * Finds all container plans where a given CableOrder (or its batch + cores + size) is planned/loaded.
 */
export function getContainerAssignmentsForOrder(
  order: CableOrder,
  containers: ContainerPlan[]
): OrderContainerAssignment[] {
  if (!containers || containers.length === 0) return [];

  const orderBatchClean = (order.batch || '').trim().toLowerCase();
  const orderCores = Number(order.cores) || 1;
  const orderSizeNum = parseSizeNum(order.size);
  const orderBrandClean = (order.brand || '').trim().toLowerCase();
  const orderGradeClean = (order.grade || '').trim().toLowerCase();

  const assignments: OrderContainerAssignment[] = [];

  for (const cont of containers) {
    if (!cont.items || cont.items.length === 0) continue;

    const matchingItems = cont.items.filter(item => {
      // 1. Direct orderId match
      if (item.orderId !== undefined && item.orderId === order.id) {
        return true;
      }

      // 2. If item has a different explicit orderId that doesn't match, still check if orderId wasn't set or if user edited batch/sizeCores
      const itemBatchClean = (item.batch || '').trim().toLowerCase();
      if (!itemBatchClean || itemBatchClean !== orderBatchClean) {
        return false;
      }

      // Parse cores and size from item.sizeCores (e.g. "3C × 1.50 SQ MM" or "3C X 1.50 SQ MM")
      const scText = (item.sizeCores || '').trim();
      const coreSizeMatch = scText.match(/(\d+)\s*[cC]\s*[×xX*]\s*([0-9.]+)/);
      if (coreSizeMatch) {
        const itemCores = parseInt(coreSizeMatch[1], 10) || 1;
        const itemSize = parseFloat(coreSizeMatch[2]) || 0;
        if (itemCores !== orderCores || Math.abs(itemSize - orderSizeNum) > 0.01) {
          return false;
        }
      } else {
        const fallbackSize = parseSizeNum(scText);
        if (Math.abs(fallbackSize - orderSizeNum) > 0.01) {
          return false;
        }
      }

      // Check brand/grade compatibility if brandGrade is provided
      const bgClean = (item.brandGrade || '').trim().toLowerCase();
      if (bgClean && orderBrandClean) {
        const brandMatches = bgClean.includes(orderBrandClean);
        const gradeMatches = !orderGradeClean || bgClean.includes(orderGradeClean);
        // If orderId was explicitly pointing to another order of the same size but different grade, require grade match
        if (item.orderId !== undefined && item.orderId !== order.id) {
          return false;
        }
        return brandMatches && gradeMatches;
      }

      return item.orderId === undefined;
    });

    if (matchingItems.length > 0) {
      let drumCount = 0;
      let totalLength = 0;
      let grossWt = 0;
      let volumeCbm = 0;
      const stowagePositions: string[] = [];

      matchingItems.forEach(it => {
        drumCount += Number(it.drumCount) || 0;
        totalLength += Number(it.totalLength) || 0;
        grossWt += Number(it.grossWt) || 0;
        volumeCbm += Number(it.volumeCbm) || 0;
        if (it.stowagePosition && !stowagePositions.includes(it.stowagePosition)) {
          stowagePositions.push(it.stowagePosition);
        }
      });

      assignments.push({
        containerId: cont.id,
        containerNo: cont.containerNo,
        containerType: cont.containerType,
        plannedStuffingDate: cont.plannedStuffingDate,
        etd: cont.etd,
        status: cont.status,
        bookingNo: cont.bookingNo,
        destination: cont.destination,
        clientName: cont.clientName,
        drumCount,
        totalLength,
        grossWt,
        volumeCbm,
        stowagePositions,
      });
    }
  }

  return assignments;
}

export function exportCsvFile(filename: string, rows: (string | number | boolean | null | undefined)[][]) {
  const csvContent = rows
    .map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

