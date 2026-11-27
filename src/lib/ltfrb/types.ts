export type SlotScope = "region" | "province";

export interface FranchiseType {
  id: string;
  code: string;
  specialCode: string | null;
  name: string;
  maxSlots: number | null;
  minSlots: number | null;
  fleetMinSlots: number | null;
}

export interface LtfrbOptionItem {
  id: string;
  code: string;
  name: string;
}

export interface SlotEntry {
  scope: SlotScope;
  slotKey: string;
  franchiseTypeCode: string;
  franchiseTypeName: string;
  regionCode: string;
  regionName: string;
  provinceCode: string | null;
  provinceName: string | null;
  totalSlots: number;
  remaining: number;
  filedApplication: number;
  percentage: number;
}

export interface WatchRule {
  id: string;
  website_id: string;
  user_id: string;
  label: string;
  scope: SlotScope;
  franchise_type_code: string;
  franchise_type_name: string;
  region_code: string | null;
  region_name: string | null;
  province_code: string | null;
  province_name: string | null;
  min_remaining: number;
  notify_email: string;
  cooldown_minutes: number;
  notify_when_available: boolean;
  notify_when_increased: boolean;
  notify_when_decreased: boolean;
  is_active: boolean;
  auto_submit: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertSlotMatch {
  entry: SlotEntry;
  previousRemaining: number | null;
  delta: number;
  reason: "newly_opened" | "slots_increased" | "slots_decreased" | "cooldown_elapsed";
}

export interface UnitDocuments {
  sales_invoice_file?: string | null;
  or_file?: string | null;
  cr_file?: string | null;
  affidavit_file?: string | null;
  delivery_receipt?: string | null;
  unit_photo_file?: string | null;
}

export interface VehicleUnitInput {
  plate_number: string;
  mv_file_number: string;
  make: string;
  series: string;
  year_model: number;
  body_type: string;
  ev_type?: "BEV" | "PHEV" | "HEV";
  engine_number?: string;
  chassis_number: string;
  color?: string;
  documents?: UnitDocuments;
}

export interface ApplicationProfile {
  id: string;
  website_id: string;
  user_id: string;
  account_id: string | null;
  watch_rule_id: string | null;
  profile_name: string;
  franchise_type_code: string;
  region_id: string;
  region_name: string;
  province_id: string | null;
  province_name: string | null;
  route_id: string | null;
  route_name: string | null;
  number_of_units: number;
  is_fleet: boolean;
  units: VehicleUnitInput[];
  custom_documents: Record<string, string>;
  notify_email: string | null;
  lock_status: "idle" | "submitting" | "submitted";
  is_armed: boolean;
  submit_on_slot_increase: boolean;
  submit_at_midnight: boolean;
  submit_hourly: boolean;
  submitted_reference: string | null;
  last_error: string | null;
  last_attempted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionLogRow {
  id: string;
  application_profile_id: string;
  attempted_at: string;
  http_status: number | null;
  result: "success" | "full_slot" | "auth_error" | "validation_error" | "network_error";
  reference_number: string | null;
  message: string | null;
}

export interface RawFranchiseTypeItem {
  id: string;
  attributes: {
    id: string;
    code: string;
    special_code?: string | null;
    name: string;
    max_slots?: number | null;
    min_slots?: number | null;
    fleet_min_slots?: number | null;
  };
}

export interface RawRegionSlotItem {
  region_id: string;
  region_code: string;
  region_name: string;
  total_slots: number;
  remaining: number;
  filed_application: number;
  percentage: number;
  franchise_type: {
    code: string;
    name: string;
  };
}

export interface RawProvinceSlotItem {
  province_id: string;
  province_code: string;
  province_name: string;
  region_code: string;
  region_name: string;
  total_slots: number;
  remaining: number;
  filed_application: number;
  percentage: number;
  franchise_type: {
    code: string;
    name: string;
  };
}
