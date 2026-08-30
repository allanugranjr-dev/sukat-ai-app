export type Role = "customer" | "dressmaker" | "admin";

export type ScanStatus =
  | "draft"
  | "uploaded"
  | "processing_queued"
  | "processing"
  | "ready_for_review"
  | "verified"
  | "needs_recapture"
  | "failed";

export type CaptureSource = "camera" | "upload";
export type UnitSystem = "cm" | "ftin";

export interface Profile {
  id: string;
  role: Role;
  organization_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  email_notifications: boolean;
  sms_notifications: boolean;
  avatar_url: string | null;
  unit_system: UnitSystem;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  owner_id: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface Scan {
  id: string;
  customer_id: string;
  organization_id: string | null;
  status: ScanStatus;
  height_value: number | null;
  height_unit: "cm" | "ftin";
  consent_at: string | null;
  capture_source: CaptureSource;
  processing_provider: string | null;
  processing_version: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type AssetType = "front" | "side" | "back" | "detail" | "garment_reference";

export interface ScanAsset {
  id: string;
  scan_id: string;
  asset_type: AssetType;
  storage_path: string;
  metadata: Record<string, unknown>;
  quality_status: "pending" | "passed" | "needs_attention" | "failed";
  created_at: string;
  signedUrl?: string;
}

export interface BodyModel {
  id: string;
  scan_id: string;
  provider: string;
  model_url_or_path: string | null;
  preview_data: Record<string, unknown>;
  status: "queued" | "processing" | "ready" | "failed";
  created_at: string;
}

export interface Measurement {
  id: string;
  scan_id: string;
  key: string;
  value: number;
  unit: "cm" | "in";
  confidence: number | null;
  ai_value: number | null;
  adjusted_value: number | null;
  adjusted_by: string | null;
  adjustment_reason: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScanBundle {
  scan: Scan;
  assets: ScanAsset[];
  measurements: Measurement[];
  bodyModel: BodyModel | null;
}

export interface Order {
  id: string;
  customer_id: string;
  organization_id: string | null;
  dressmaker_id: string | null;
  scan_id: string | null;
  status: "new" | "accepted" | "in_production" | "for_fitting" | "ready_for_pickup" | "completed" | "cancelled";
  garment_type: string;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Fitting {
  id: string;
  order_id: string;
  starts_at: string;
  location: string | null;
  status: "requested" | "confirmed" | "completed" | "reschedule_requested" | "cancelled";
  notes: string | null;
  created_at: string;
}

export interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  invited_role: "dressmaker";
  token_hash: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invited_by: string;
  email_delivery_status?: "pending" | "sent" | "failed" | "not_configured" | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  read_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function displayName(profile: Pick<Profile, "first_name" | "last_name">): string {
  return `${profile.first_name} ${profile.last_name}`.trim();
}

export function initials(profile: Pick<Profile, "first_name" | "last_name">): string {
  return `${profile.first_name.charAt(0)}${profile.last_name.charAt(0)}`.toUpperCase();
}

export function scanStatusLabel(status: ScanStatus): string {
  return {
    draft: "Draft",
    uploaded: "Uploaded",
    processing_queued: "Processing queued",
    processing: "Processing",
    ready_for_review: "Ready for tailor review",
    verified: "Verified",
    needs_recapture: "Needs recapture",
    failed: "Failed",
  }[status];
}

export function scanStatusTone(status: ScanStatus): "success" | "warning" | "danger" | "teal" | "neutral" | "blue" {
  if (status === "verified") return "success";
  if (status === "ready_for_review") return "teal";
  if (status === "needs_recapture" || status === "processing_queued") return "warning";
  if (status === "failed") return "danger";
  if (status === "processing") return "blue";
  return "neutral";
}

export function orderStatusLabel(status: Order["status"]): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function fittingStatusLabel(status: Fitting["status"]): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
