import { xamppRequest } from "./xampp";
import type {
  Fitting,
  Measurement,
  Order,
  Organization,
  Profile,
  Scan,
  ScanBundle,
} from "./types";

export async function createScan(input: {
  customerId: string;
  organizationId: string | null;
  heightValue: number | null;
  heightUnit: "cm" | "ftin";
  consentAt: string;
  captureSource: "camera" | "upload";
}): Promise<Scan> {
  return xamppRequest<Scan>("create_scan", {
    body: {
      customer_id: input.customerId,
      organization_id: input.organizationId,
      height_value: input.heightValue,
      height_unit: input.heightUnit,
      consent_at: input.consentAt,
      capture_source: input.captureSource,
    },
  });
}

export async function updateScan(
  scanId: string,
  updates: Partial<Pick<Scan, "height_value" | "height_unit" | "sex" | "status" | "capture_source" | "failure_reason">>,
): Promise<Scan> {
  return xamppRequest<Scan>("update_scan", { body: { scan_id: scanId, ...updates } });
}

export async function getScanBundle(scanId: string, includeSignedUrls = false): Promise<ScanBundle> {
  return xamppRequest<ScanBundle>("scan_bundle", { body: { scan_id: scanId, include_signed_urls: includeSignedUrls } });
}

export async function listCustomerScans(customerId: string): Promise<Scan[]> {
  return xamppRequest<Scan[]>("customer_scans", { body: { customer_id: customerId } });
}

export async function listCustomerMeasurementSets(customerId: string): Promise<ScanBundle[]> {
  const scans = await listCustomerScans(customerId);
  return Promise.all(scans.map((scan) => getScanBundle(scan.id)));
}

export async function deleteScan(scanId: string): Promise<void> {
  await xamppRequest("delete_scan", { body: { scan_id: scanId } });
}

export async function listCustomerOrders(customerId: string): Promise<Order[]> {
  return xamppRequest<Order[]>("customer_orders", { body: { customer_id: customerId } });
}

export async function listFittingsForOrders(orderIds: string[]): Promise<Fitting[]> {
  if (orderIds.length === 0) return [];
  return xamppRequest<Fitting[]>("fittings_for_orders", { body: { order_ids: orderIds } });
}

export async function listOrgCustomers(organizationId: string): Promise<Profile[]> {
  return xamppRequest<Profile[]>("org_customers", { body: { organization_id: organizationId } });
}

export async function listOrgStaff(organizationId: string): Promise<Profile[]> {
  return xamppRequest<Profile[]>("org_staff", { body: { organization_id: organizationId } });
}

export async function listOrgScans(organizationId: string): Promise<Scan[]> {
  return xamppRequest<Scan[]>("org_scans", { body: { organization_id: organizationId } });
}

export async function listOrgOrders(organizationId: string): Promise<Order[]> {
  return xamppRequest<Order[]>("org_orders", { body: { organization_id: organizationId } });
}

export async function listAdminProfiles(role?: "customer" | "dressmaker" | "admin"): Promise<Profile[]> {
  return xamppRequest<Profile[]>("admin_profiles", { body: { role: role ?? null } });
}

export async function listAdminScans(): Promise<Scan[]> {
  return xamppRequest<Scan[]>("admin_scans");
}

export async function listAdminOrders(): Promise<Order[]> {
  return xamppRequest<Order[]>("admin_orders");
}

export async function updateMeasurement(
  measurementId: string,
  adjustedValue: number | null,
  adjustmentReason: string | null,
  adjustedBy: string,
): Promise<Measurement> {
  return xamppRequest<Measurement>("update_measurement", {
    body: { measurement_id: measurementId, adjusted_value: adjustedValue, adjustment_reason: adjustmentReason, adjusted_by: adjustedBy },
  });
}

export async function addReviewEvent(input: {
  scanId: string;
  actorId: string;
  eventType: "opened" | "adjusted" | "approved" | "recapture_requested" | "photo_accessed" | "deleted";
  payload?: Record<string, unknown>;
}): Promise<void> {
  await xamppRequest("add_review_event", {
    body: { scan_id: input.scanId, actor_id: input.actorId, event_type: input.eventType, payload: input.payload ?? {} },
  });
}

export async function createOrder(input: {
  customerId: string;
  organizationId: string | null;
  scanId: string;
  garmentType: string;
  notes: string;
}): Promise<Order> {
  return xamppRequest<Order>("create_order", {
    body: {
      customer_id: input.customerId,
      organization_id: input.organizationId,
      scan_id: input.scanId,
      garment_type: input.garmentType.trim(),
      notes: input.notes.trim(),
    },
  });
}

export async function updateOrderStatus(orderId: string, status: Order["status"]): Promise<Order> {
  return xamppRequest<Order>("update_order", { body: { order_id: orderId, status } });
}

export async function createFitting(input: {
  orderId: string;
  startsAt: string;
  location: string;
  notes: string;
}): Promise<Fitting> {
  return xamppRequest<Fitting>("create_fitting", {
    body: { order_id: input.orderId, starts_at: input.startsAt, location: input.location.trim(), notes: input.notes.trim() },
  });
}

export async function updateFittingStatus(fittingId: string, status: Fitting["status"]): Promise<Fitting> {
  return xamppRequest<Fitting>("update_fitting", { body: { fitting_id: fittingId, status } });
}

export async function createOrganization(input: { name: string; ownerId: string }): Promise<Organization> {
  return xamppRequest<Organization>("create_organization", { body: { name: input.name.trim(), owner_id: input.ownerId } });
}
