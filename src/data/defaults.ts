import {
  BatchHistoryEntry,
  CableOrder,
  ColourMapRule,
  ContainerPlan,
  DailyJournalEntry,
  DensitySettings,
  DispatchedContainerRecord,
  DispatchRecord,
  LadiDimensionRule,
  PackagingRule,
  PurchaseItem,
  SizePackagingRule,
} from '../types/cable';

export const DEFAULT_SIZE_PACKAGING: SizePackagingRule[] = [
  { cores: "1", grade: "H07RN-F", packaging: "1000m / Drum", size: "25.00 SQ MM", spool: "" },
  { cores: "3", grade: "H07RN-F", packaging: "500m / Drum", size: "25.00 SQ MM", spool: "" },
  { cores: "4", grade: "H07RN-F", packaging: "500m / Drum", size: "25.00 SQ MM", spool: "" },
  { cores: "5", grade: "H07RN-F", packaging: "500m / Drum", size: "25.00 SQ MM", spool: "" },
  { cores: "ALL", grade: "H07RN-F", packaging: "1000m / Drum", size: "1.50 SQ MM", spool: "" },
  { cores: "1", grade: "H07RN-F", packaging: "1000m / Drum", size: "10.00 SQ MM", spool: "" },
  { cores: "ALL", grade: "H07RN-F", packaging: "1000m / Drum", size: "6.00 SQ MM", spool: "" },
  { cores: "ALL", grade: "H07RN-F", packaging: "1000m / Drum", size: "4.00 SQ MM", spool: "" },
  { cores: "ALL", grade: "H07RN-F", packaging: "1000m / Drum", size: "2.50 SQ MM", spool: "" },
  { cores: "ALL", grade: "H05RN-F", packaging: "1000m / Drum", size: "0.50 SQ MM", spool: "" },
  { cores: "UPTO 3", grade: "H05RN-F", packaging: "1000m / Drum", size: "1.00 SQ MM", spool: "" },
  { cores: "ALL", grade: "H05RN-F", packaging: "1000m / Drum", size: "0.75 SQ MM", spool: "" },
  { cores: "1", grade: "H07RN-F", packaging: "1000m / Drum", size: "16.00 SQ MM", spool: "" },
  { cores: "2", grade: "H07RN-F", packaging: "500m / Drum", size: "35.00 SQ MM", spool: "" },
  { cores: "1", grade: "H07RN-F", packaging: "1000m / Drum", size: "35.00 SQ MM", spool: "" },
  { cores: "3", grade: "H07RN-F", packaging: "500m / Drum", size: "35.00 SQ MM", spool: "" },
  { cores: "4", grade: "H07RN-F", packaging: "500m / Drum", size: "35.00 SQ MM", spool: "" },
  { cores: "5", grade: "H07RN-F", packaging: "500m / Drum", size: "35.00 SQ MM", spool: "" },
  { cores: "1", grade: "H07RN-F", packaging: "1000m / Drum", size: "50.00 SQ MM", spool: "" },
  { cores: "3", grade: "H07RN-F", packaging: "500m / Drum", size: "50.00 SQ MM", spool: "" },
  { cores: "4", grade: "H07RN-F", packaging: "500m / Drum", size: "50.00 SQ MM", spool: "" },
  { cores: "5", grade: "H07RN-F", packaging: "500m / Drum", size: "50.00 SQ MM", spool: "" },
  { cores: "4", grade: "H07RN-F", packaging: "500m / Drum", size: "70.00 SQ MM", spool: "" },
  { cores: "3", grade: "H07RN-F", packaging: "500m / Drum", size: "10.00 SQ MM", spool: "" },
  { cores: "4", grade: "H07RN-F", packaging: "500m / Drum", size: "10.00 SQ MM", spool: "" },
  { cores: "5", grade: "H07RN-F", packaging: "500m / Drum", size: "10.00 SQ MM", spool: "" },
  { cores: "3", grade: "H07RN-F", packaging: "500m / Drum", size: "16.00 SQ MM", spool: "" },
  { cores: "4", grade: "H07RN-F", packaging: "500m / Drum", size: "16.00 SQ MM", spool: "" },
  { cores: "5", grade: "H07RN-F", packaging: "500m / Drum", size: "16.00 SQ MM", spool: "" },
  { cores: "1", grade: "H07RN-F", packaging: "1000m / Drum", size: "95.00 SQ MM", spool: "" },
  { cores: "1", grade: "H07RN-F", packaging: "1000m / Drum", size: "120.00 SQ MM", spool: "" },
  { cores: "1", grade: "H07RN-F", packaging: "500m / Drum", size: "150.00 SQ MM", spool: "" },
  { cores: "1", grade: "H07RN-F", packaging: "500m / Drum", size: "185.00 SQ MM", spool: "" },
  { cores: "1", grade: "H07RN-F", packaging: "500m / Drum", size: "240.00 SQ MM", spool: "" },
  { cores: "1", grade: "H07RN-F", packaging: "500m / Drum", size: "300.00 SQ MM", spool: "" }
];

export const DEFAULT_PACKAGING_RULES: PackagingRule[] = [
  { spool: "21 X 12 X 15", m1000: "1.00-6.00 mm", m500: "-", pallet: "30X30x6", bbnPerPallet: "4" },
  { spool: "21 X 12 X 19", m1000: "6.10-8.00 mm", m500: "-", pallet: "30X30x6", bbnPerPallet: "4" },
  { spool: "28 X 12 X 15", m1000: "8.10-9.90 mm", m500: "10.60-15.10 mm", pallet: "30X30x6", bbnPerPallet: "2" },
  { spool: "30 X 12 X 19", m1000: "10.00-13.30 mm", m500: "15.2-18.50 mm", pallet: "30X30x6", bbnPerPallet: "2" },
  { spool: "42 x 12 x 16", m1000: "13.40-18.20 mm", m500: "18.60-25 mm", pallet: "42 x 42 x 6", bbnPerPallet: "2" },
  { spool: "42 x 12 x 20", m1000: "18.30-20.0 mm", m500: "25.1-28 mm", pallet: "42 x 42 x 6", bbnPerPallet: "2" },
  { spool: "42 x 12 x 24", m1000: "20.1-22.0 mm", m500: "28.1-30 mm", pallet: "42 x 42 x 6", bbnPerPallet: "1" },
  { spool: "42 x 12 x 30", m1000: "22.1-24.0 mm", m500: "30.1-33.3 mm", pallet: "42 x 42 x 6", bbnPerPallet: "1" },
  { spool: "45 x 12 x 30", m1000: "-", m500: "33.5-36.7 mm", pallet: "45 x 45 x 6", bbnPerPallet: "1" },
  { spool: "60*24*40", m1000: "-", m500: "45-52 mm", pallet: "45 x 45 x 6", bbnPerPallet: "1" }
];

// Clean slate: All system/sample orders removed so only user-entered orders exist
export const INITIAL_ORDERS: CableOrder[] = [];

export const DEFAULT_DENSITIES: DensitySettings = {
  COPPER: 0.00889,
  INSULATION: {
    "A 80 UW": 0.0012,
    "A 80 NATURAL": 0.00125,
    "KI-06": 0.00152,
    "KI-13": 0.00148,
    "TI1": 0.0015,
    "GRADE A": 0.00148,
    "TYPE A": 0.00148,
    "FR": 0.00148
  },
  SHEATH: {
    "KI-05": 0.00148,
    "ST-1 GREY": 0.00144,
    "A80 HD BLACK": 0.00125,
    "A 80 NATURAL": 0.00125,
    "ST2": 0.00148
  }
};

export const DEFAULT_LADI_DIMENSIONS: LadiDimensionRule[] = [
  { size: 10, conductor: "129/0.260", pattern: "22*5+19*1" },
  { size: 10, conductor: "91/0.260", pattern: "22*3+25*1" },
  { size: 16, conductor: "202/0.260", pattern: "23*4+22*5" },
  { size: 25, conductor: "294/0.266", pattern: "42*7" },
  { size: 35, conductor: "420/0.266", pattern: "42*10" },
  { size: 50, conductor: "598/0.266", pattern: "42*13+52*1" },
  { size: 70, conductor: "840/0.266", pattern: "42*20" },
  { size: 95, conductor: "1148/0.266", pattern: "93*8+101*4" },
  { size: 120, conductor: "1443/0.266", pattern: "93*9+101*6" },
  { size: 150, conductor: "1815/0.266", pattern: "93*13+101*6" },
  { size: 185, conductor: "2232/0.266", pattern: "93*24" },
  { size: 240, conductor: "2899/0.266", pattern: "93*29+101*2" },
  { size: 300, conductor: "3627/0.266", pattern: "93*39" }
];

export const LAY_TIMES: Record<number, number> = {
  1: 32, 2: 30, 3: 28, 4: 22, 5: 18, 6: 14, 7: 14, 8: 14, 9: 14, 10: 14,
  11: 14, 12: 14, 13: 14, 14: 14, 15: 14, 16: 14, 17: 14, 18: 14, 19: 14, 20: 14,
  21: 14, 22: 14, 23: 14, 24: 14, 25: 14, 26: 14, 27: 14, 28: 14, 29: 14, 30: 14,
  31: 14, 32: 14, 33: 14, 34: 7.0, 35: 14, 36: 14, 37: 14, 38: 14, 39: 14, 40: 14,
  41: 14, 42: 14, 43: 14, 44: 14, 45: 14, 46: 14, 47: 14, 48: 14, 50: 14, 52: 14, 61: 14
};

export const COR_FACTOR: Record<number, number> = {
  1: 1.0, 2: 2.0, 3: 2.15, 4: 2.4, 5: 2.7, 6: 2.9, 7: 3.0, 8: 3.45, 9: 3.8, 10: 4.0,
  11: 4.0, 12: 4.15, 13: 4.41, 14: 4.41, 15: 4.7, 16: 4.7, 17: 5.0, 18: 4.9, 19: 5.0, 20: 5.33,
  21: 5.33, 22: 5.67, 23: 5.67, 24: 6.0, 25: 6.0, 26: 6.0, 27: 6.15, 28: 6.41, 29: 6.41, 30: 6.41,
  31: 6.7, 32: 6.7, 33: 6.7, 34: 7.0, 35: 7.0, 36: 7.0, 37: 7.0, 38: 7.33, 39: 7.33, 40: 7.33,
  41: 7.67, 42: 7.67, 43: 7.67, 44: 8.0, 45: 8.0, 46: 8.0, 47: 8.0, 48: 8.15, 50: 8.3, 52: 8.4, 61: 9.0
};

export const DEFAULT_COLOUR_MAP: ColourMapRule[] = [
  { cores: "1", grade: "H05VV-F", seq: "BLACK" },
  { cores: "2", grade: "H05VV-F", seq: "BROWN, BLUE" },
  { cores: "3", grade: "H05VV-F", seq: "BROWN, BLUE, YL/GN" },
  { cores: "4", grade: "H05VV-F", seq: "BROWN, BLUE, YL/GN, BLACK" },
  { cores: "5", grade: "H05VV-F", seq: "BROWN, BLUE, YL/GN, BLACK, GRAY" },
  { cores: "7", grade: "H05VV-F", seq: "YL/GN, BLACK*6" },
  { cores: "1", grade: "H07RN-F", seq: "WHITE" },
  { cores: "2", grade: "H07RN-F", seq: "BROWN, BLUE" },
  { cores: "3", grade: "H07RN-F", seq: "BROWN, BLUE, YL/GN" },
  { cores: "4", grade: "H07RN-F", seq: "BROWN, YL/GN, BLACK, GRAY" },
  { cores: "5", grade: "H07RN-F", seq: "BROWN, BLUE, YL/GN, BLACK, GRAY" },
  { cores: "7", grade: "H07RN-F", seq: "YL/GN, BLACK*6" },
  { cores: "12", grade: "H07RN-F", seq: "YL/GN, BLACK*11" },
  { cores: "2", grade: "YSLY-OZ", seq: "BLACK, YL/GN" },
  { cores: "3", grade: "YSLY-JZ", seq: "BLACK*2, YL/GN" },
  { cores: "4", grade: "YSLY-JZ", seq: "BLACK*3, YL/GN" },
  { cores: "5", grade: "YSLY-JZ", seq: "BLACK*4, YL/GN" },
  { cores: "ABOVE 5", grade: "YSLY-JZ", seq: "REST OF ALL BLACK, YL/GN" },
  { cores: "2", grade: "NYY-JZ", seq: "BLACK,YL/GN" },
  { cores: "5", grade: "NYY-JZ", seq: "BLACK*4,YL/GN" },
  { cores: "2", grade: "H05RN-F", seq: "BROWN,BLUE" },
  { cores: "3", grade: "H05RN-F", seq: "BROWN,BLUE,YL/GN" },
  { cores: "2", grade: "CONTROL CABLE", seq: "BLACK, YL/GN" },
  { cores: "3", grade: "CONTROL CABLE", seq: "BLACK*2, YL/GN" },
  { cores: "4", grade: "CONTROL CABLE", seq: "BLACK*3, YL/GN" },
  { cores: "5", grade: "CONTROL CABLE", seq: "BLACK*4, YL/GN" },
  { cores: "ABOVE 5", grade: "CONTROL CABLE", seq: "REST OF ALL BLACK, YL/GN" }
];

export const DEFAULT_PURCHASE_ITEMS: PurchaseItem[] = [];

export const DEFAULT_CONTAINER_PLANS: ContainerPlan[] = [];

export const DEFAULT_DISPATCHED_CONTAINERS: DispatchedContainerRecord[] = [];

export const DEFAULT_BATCH_HISTORY: BatchHistoryEntry[] = [];

export const DEFAULT_STOCK_RETURNS: any[] = [];

export const DEFAULT_STOCK_OPENINGS: Record<string, number> = {};

export const DEFAULT_DISPATCH_RECORDS: DispatchRecord[] = [];

export const DEFAULT_DAILY_JOURNAL_ENTRIES: DailyJournalEntry[] = [];
