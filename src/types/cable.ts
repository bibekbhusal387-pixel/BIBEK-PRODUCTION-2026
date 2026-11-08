export interface ProcessStatus {
  b: boolean; // Bunching
  c: boolean; // Cu Stranding (Ladi)
  i: boolean; // Insulation
  t: boolean; // Twisting (Core Stranding)
  s: boolean; // Sheathing
}

export interface BatchHistoryEntry {
  id: string;
  batch: string;
  orderId: number;
  brand: string;
  cores: number | string;
  size: string;
  stageKey: 'b' | 'c' | 'i' | 't' | 's';
  stageLabel: string;
  action: 'completed' | 'reset';
  timestamp: string;
  note?: string;
}

export interface RecordActual {
  sub1: number | string;
  f2: number | string;
  sub2: number | string;
  h2: number | string;
  ladiDia1: number | string;
  ladiDia2: number | string;
  ladiLay: number | string;
  cuArea: number;
  bunchDia: number;
  bunchLay: number;
  nozzle: number;
  coreOd: number;
  coreThickness: number;
  insDie: number;
  insGrade: string;
  twistingDia: number;
  strandingDie: number;
  layLength: number;
  extNozzle: number;
  finalDia: number;
  finalDie: number;
  sheathGrade: string;
  orderLen: number;
  reqCoreLen: number;
  reqCu: number;
  reqIns: number;
  reqSheath: number;
}

export interface Is694OperatorLogEntry {
  id: string;
  date: string;
  shift: string;
  machineNo: string;
  cartonId: string;
  lotId?: string;
  colourCounts: Record<string, number>;
  actualCoils: number;
  cartonsPacked: number;
  actualLengthM: number;
  actualPvcKg: number;
  actualCuKg?: number;
  sparkTestOk?: boolean | string;
  operatorName: string;
  remarks?: string;
}

export interface Is694ProductionLot {
  id: string;
  lotNo: number;
  date: string;
  coils: number;
  coil_type: string;
  order_length: number;
  carton_count?: number;
  coils_per_carton?: number;
  carton_standard?: 'VIHAN_OPTO' | 'TRIGUARD_BOX' | 'TRIGUARD_STACK' | 'MARU_MIRACLE' | 'CUSTOM';
  carton_mode?: 'INDIVIDUAL' | 'MIX';
  coil_colour_breakdown?: Record<string, number>;
  ins_colour?: string;
  notes?: string;
  dispatched?: boolean;
  carton_ids?: string;
  operator_production_logs?: Is694OperatorLogEntry[];
}

export interface CableOrder {
  id: number;
  record_row?: number;
  batch: string;
  brand: string;
  conductor: string;
  core_od: number;
  ins_compound: string;
  ins_colour?: string;
  cores: number;
  size: string;
  final_dia: number;
  sheath_colour: string;
  sheath_compound: string;
  coils?: number | string;
  coil_type?: string;
  total_order_coils?: number;
  planned_coils?: number;
  remaining_coils?: number;
  production_lots?: Is694ProductionLot[];
  active_plan_lot_id?: string;
  coil_colour_breakdown?: Record<string, number>;
  total_coil_colour_breakdown?: Record<string, number>;
  carton_standard?: 'VIHAN_OPTO' | 'TRIGUARD_BOX' | 'TRIGUARD_STACK' | 'MARU_MIRACLE' | 'CUSTOM';
  carton_mode?: 'INDIVIDUAL' | 'MIX';
  carton_count?: number;
  coils_per_carton?: number;
  mix_pattern_per_carton?: Record<string, number>;
  carton_ids?: string;
  operator_production_logs?: Is694OperatorLogEntry[];
  order_length: number;
  total_order_length?: number;
  grade: string;
  print_details: string;
  print_colour?: string;
  pStatus?: ProcessStatus;
  pTimestamps?: Partial<Record<'b' | 'c' | 'i' | 't' | 's', string>>;
  actual_weight?: number | string;
  tare_weight?: number | string;
  spool_size?: string;
  rec_actual?: RecordActual;
  is_high_priority?: boolean;
  priority?: 'high' | 'normal';
  bunch_source?: 'in_house' | 'purchased_stock';
  purchased_copper_id?: number;
  purchased_copper_deducted_qty?: number;
  notes?: string;
  bunchedQtyUsed?: number;
  dispatched?: boolean;
  dispatchedLength?: number;
  dispatchedWeight?: number;
  dispatchedDrums?: string[];
  dispatchedAt?: string;
  meter_marking?: string;
  issued?: boolean;
  status?: 'Pending' | 'Processing' | 'Completed';
  is_processed?: boolean;
  processed_at?: string;
}

export interface ComputedRecordRow extends CableOrder {
  sizeNum: number;
  strands: number;
  dia: number;
  sub1: number | string;
  f2: number | string;
  sub2: number | string;
  h2: number | string;
  ladiPattern: string;
  ladiDia1: number | string;
  ladiDia2: number | string;
  ladiLay: number | string;
  cuArea: number;
  bunchDia: number;
  bunchLay: number;
  nozzle: number;
  coreOd: number;
  coreThickness: number;
  insDie: number;
  layFactor: number;
  twistingDia: number;
  strandingDie: number;
  layTimes: number;
  layLength: number;
  extNozzle: number;
  finalDia: number;
  finalDie: number;
  orderLen: number;
  reqCoreLen: number;
  reqCu: number;
  reqIns: number;
  reqSheath: number;
}

export interface DensitySettings {
  COPPER: number;
  INSULATION: Record<string, number>;
  SHEATH: Record<string, number>;
}

export interface LadiDimensionRule {
  size: number;
  conductor: string;
  pattern: string;
}

export interface SizePackagingRule {
  grade: string;
  cores: string;
  size: string;
  spool: string;
  packaging: string;
}

export interface PackagingRule {
  spool: string;
  m1000: string;
  m500: string;
  pallet: string;
  bbnPerPallet?: number | string;
}

export interface ColourMapRule {
  grade: string;
  cores: string;
  seq: string;
}

export interface PurchaseItem {
  id: number;
  date: string;
  invoice: string;
  party: string;
  description: string;
  subQty?: number | string;
  qty: number;
  price: number;
  status: 'pending' | 'ordered' | 'received';
  stage?: 'raw' | 'bunch' | 'compound' | 'drums' | 'other';
  conductor?: string;
  usedQty?: number;
}

export interface ManualPackingItem {
  batch: string;
  brandGrade: string;
  sizeCores: string;
  spool: string;
  drumNo: string;
  len: number;
  cuWt: number;
  compWt: number;
  totalWt: number;
  pallet: string;
  palletSize?: string;
  status: string;
  dispatched?: boolean;
  dispatchedAt?: string;
}

export interface StockItem {
  category: string;
  name: string;
  unit: string;
  opening: number;
  received: number;
  consumed: number;
  consumedKgs?: number;
  isNosOnly?: boolean;
  isWeightOnly?: boolean;
  isFinishedDirectWt?: boolean;
  isDualLengthFirst?: boolean;
  isDualUnit?: boolean;
  convFactor?: number;
  directKgs?: number;
  remark?: string;
}

export interface StockReturnRejection {
  id: string;
  date: string;
  category: 'COPPER' | 'INSULATION' | 'SHEATH' | 'FINISHED' | 'DRUMS' | 'PALLETS' | 'OTHER';
  materialName: string;
  type: 'supplier_rejection' | 'scrap_rejection' | 'customer_return' | 'line_return';
  qty: number;
  unit: string;
  reason: string;
  batchOrInvoice?: string;
  recordedBy?: string;
  notes?: string;
}

export interface MonthlyStockSnapshot {
  monthKey: string; // e.g. "2026-10"
  monthLabel: string; // e.g. "October 2026"
  isClosed?: boolean;
  closedAt?: string;
  openingMap: Record<string, number>;
  closingMap?: Record<string, { mtrs: number; kgs: number }>;
}

export type StockOpeningSettings = Record<string, number>;

export interface StockThresholdSettings {
  copperThreshold: number;
  pvcThreshold: number;
}

export type ContainerType = '20FT DRY' | '40FT DRY' | '40FT HC' | '20FT OPEN TOP' | 'CUSTOM';

export interface ContainerLoadItem {
  id: string;
  orderId?: number;
  batch: string;
  brandGrade: string;
  sizeCores: string;
  spool: string;
  drumNo: string;
  drumCount: number;
  drumsPerPallet?: number;
  palletsRequired?: number;
  lengthPerDrum: number;
  totalLength: number;
  netCableWt: number;
  grossWt: number;
  volumeCbm: number;
  palletSize: string;
  stowagePosition: string;
  remarks: string;
  isHighlighted?: boolean;
  dispatchedAt?: string;
}

export interface PalletDetailCell {
  topLine: string;
  bottomLine: string;
}

export interface ContainerPlan {
  id: string;
  containerNo: string;
  containerType: ContainerType;
  planningSheetTitle?: string;
  bookingNo: string;
  sealNo: string;
  shippingLine: string;
  vesselVoyage: string;
  portOfLoading: string;
  destination: string;
  clientName: string;
  plannedStuffingDate: string;
  etd: string;
  maxWeightKg: number;
  maxVolumeCbm: number;
  maxDrums: number;
  loadableHeightIn?: number;
  loadableWidthIn?: number;
  loadableLengthFt?: number;
  allowDoubleStack?: boolean;
  customTotalLengthInch?: number;
  customPalletWeightKg?: number;
  customDrumsWeightKg?: number;
  customPalletCells?: Record<string, PalletDetailCell>;
  dispatchedAt?: string;
  status: 'Planning' | 'Loading / Stuffing' | 'Sealed & Ready' | 'Dispatched / Shipped';
  notes: string;
  items: ContainerLoadItem[];
}

export interface DispatchedContainerRecord {
  id: string;
  containerId: string;
  containerNo: string;
  containerType: ContainerType;
  planningSheetTitle?: string;
  bookingNo: string;
  sealNo: string;
  shippingLine: string;
  vesselVoyage: string;
  portOfLoading: string;
  destination: string;
  clientName: string;
  plannedStuffingDate: string;
  etd: string;
  dispatchedAt: string;
  totalDrums: number;
  totalLength: number;
  netWtKg?: number;
  palletWtKg?: number;
  drumsWtKg?: number;
  grossWtKg?: number;
  totalNetWt?: number;
  totalGrossWt?: number;
  totalPalletWt?: number;
  totalDrumsWt?: number;
  totalCbm?: number;
  customTotalLengthInch?: number;
  totalLengthInch?: number;
  notes: string;
  items: ContainerLoadItem[];
  customPalletCells?: Record<string, PalletDetailCell>;
}

export interface DispatchRecord {
  id: string;
  dispatchNo: string; // e.g. "DSP-33-01" or "DC-2026-33"
  batch: string; // e.g. "JOB NO 33"
  orderId?: number;
  date: string; // e.g. "2026-10-28" or "28/10/2026"
  clientName: string; // e.g. "Global Marine & Industrial Cables"
  destination: string; // e.g. "Jebel Ali / Dubai Port"
  brand: string; // e.g. "MYBCAB" or "SANKA"
  grade: string; // e.g. "H07RN-F" or "IS-694" or "YSLY-JZ"
  sizeCores: string; // e.g. "1C × 120.00 SQ MM"
  conductor?: string;
  packagingType: 'DRUMS' | 'CARTONS' | 'COILS' | 'CONTAINER';
  drumCount?: number;
  drumNos?: string; // e.g. "JOB NO 33-MYBCAB-120.00-D1..D2"
  spoolSize?: string; // e.g. "42 X 12 X 30"
  palletSize?: string; // e.g. "42 x 42 x 6"
  cartonCount?: number;
  cartonIds?: string; // e.g. "CTN-01..12"
  coilsCount?: number;
  lengthM: number;
  netWeightKg: number;
  grossWeightKg: number;
  vehicleOrContainerNo?: string; // e.g. "TBC-CONT-03" or "TRUCK RJ-14-GA-8592"
  sealNo?: string;
  bookingNo?: string;
  challanNo?: string;
  driverOrOperator?: string;
  remarks?: string;
  status: 'Dispatched' | 'In Transit' | 'Delivered';
  createdAt?: string;
}

export interface DailyJournalEntry {
  id: string;
  date: string;
  shift: 'Shift A (Day 08:00-20:00)' | 'Shift B (Night 20:00-08:00)' | string;
  machineName: string;
  processStage: 'Bunching (B)' | 'Cu Stranding (CS)' | 'Insulation (I)' | 'Twisting (TS)' | 'Sheathing (SH)' | 'Packing & Coiling';
  batch: string;
  orderId?: number;
  cableSpec: string;
  operatorName: string;
  supervisorName?: string;
  plannedShiftHours: number;
  actualRunHours: number;
  downtimeHours: number;
  downtimeReason: string;
  targetOutputM: number;
  actualOutputM: number;
  rawMaterialName?: string;
  systemRequiredCuKg?: number;
  systemRequiredCompoundKg?: number;
  copperConsumedKg: number;
  compoundConsumedKg: number;
  scrapKg: number;
  qualityStatus: 'Pass / QC Approved' | 'Minor Rework' | 'Hold for Inspection';
  operatorNotes: string;
  createdAt?: string;
}

