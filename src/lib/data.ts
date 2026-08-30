import { isLocalApiMode, requireSupabase, readableError } from "./supabase";
import { xamppRequest } from "./xampp";
import type {
  BodyModel,
  Fitting,
  Measurement,
  Order,
  Organization,
  Profile,
  Scan,
  ScanAsset,
  ScanBundle,
} from "./types";

function throwIfError(error: unknown): void {
  if (error) throw new Error(readableError(error));
}

export async function createScan(input: {
  customerId: string;
  organizationId: string | null;
  heightValue: number | null;
  heightUnit: "cm" | "ftin";
  consentAt: string;
  captureSource: "camera" | "upload";
}): Promise<Scan> {
  if (isLocalApiMode) {
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
  const { data, error } = await requireSupabase()
    .from("scans")
    .insert({
      customer_id: input.customerId,
      organization_id: input.organizationId,
      height_value: input.heightValue,
      height_unit: input.heightUnit,
      consent_at: input.consentAt,
      capture_source: input.captureSource,
      status: "draft",
    })
    .select("*")
    .single();
  throwIfError(error);
  return data as Scan;
}

export async function updateScan(
  scanId: string,
  updates: Partial<Pick<Scan, "height_value" | "height_unit" | "status" | "capture_source" | "failure_reason">>,
): Promise<Scan> {
  if (isLocalApiMode) return xamppRequest<Scan>("update_scan", { body: { scan_id: scanId, ...updates } });
  const { data, error } = await requireSupabase().from("scans").update(updates).eq("id", scanId).select("*").single();
  throwIfError(error);
  return data as Scan;
}

export async function getScanBundle(scanId: string, includeSignedUrls = false): Promise<ScanBundle> {
  if (isLocalApiMode) return xamppRequest<ScanBundle>("scan_bundle", { body: { scan_id: scanId, include_signed_urls: includeSignedUrls } });
  const client = requireSupabase();
  const [scanResult, assetsResult, measurementsResult, modelResult] = await Promise.all([
    client.from("scans").select("*").eq("id", scanId).single(),
    client.from("scan_assets").select("*").eq("scan_id", scanId).order("asset_type"),
    client.from("measurements").select("*").eq("scan_id", scanId).order("key"),
    client.from("body_models").select("*").eq("scan_id", scanId).maybeSingle(),
  ]);
  throwIfError(scanResult.error);
  throwIfError(assetsResult.error);
  throwIfError(measurementsResult.error);
  throwIfError(modelResult.error);

  let assets = (assetsResult.data ?? []) as ScanAsset[];
  if (includeSignedUrls) {
    assets = await Promise.all(
      assets.map(async (asset) => {
        const { data, error } = await client.storage.from("scan-captures").createSignedUrl(asset.storage_path, 300);
        return error ? asset : { ...asset, signedUrl: data?.signedUrl };
      }),
    );
  }
  return {
    scan: scanResult.data as Scan,
    assets,
    measurements: (measurementsResult.data ?? []) as Measurement[],
    bodyModel: (modelResult.data as BodyModel | null) ?? null,
  };
}

export async function listCustomerScans(customerId: string): Promise<Scan[]> {
  if (isLocalApiMode) return xamppRequest<Scan[]>("customer_scans", { body: { customer_id: customerId } });
  const { data, error } = await requireSupabase()
    .from("scans")
    .select("*")
    .eq("customer_id", customerId)
    .order("updated_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as Scan[];
}

export async function listCustomerMeasurementSets(customerId: string): Promise<ScanBundle[]> {
  const scans = await listCustomerScans(customerId);
  return Promise.all(scans.map((scan) => getScanBundle(scan.id)));
}

export async function listCustomerOrders(customerId: string): Promise<Order[]> {
  if (isLocalApiMode) return xamppRequest<Order[]>("customer_orders", { body: { customer_id: customerId } });
  const { data, error } = await requireSupabase()
    .from("orders")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as Order[];
}

export async function listFittingsForOrders(orderIds: string[]): Promise<Fitting[]> {
  if (orderIds.length === 0) return [];
  if (isLocalApiMode) return xamppRequest<Fitting[]>("fittings_for_orders", { body: { order_ids: orderIds } });
  const { data, error } = await requireSupabase()
    .from("fittings")
    .select("*")
    .in("order_id", orderIds)
    .order("starts_at");
  throwIfError(error);
  return (data ?? []) as Fitting[];
}

export async function listOrgCustomers(organizationId: string): Promise<Profile[]> {
  if (isLocalApiMode) return xamppRequest<Profile[]>("org_customers", { body: { organization_id: organizationId } });
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("role", "customer")
    .order("last_name")
    .order("first_name");
  throwIfError(error);
  return (data ?? []) as Profile[];
}

export async function listOrgStaff(organizationId: string): Promise<Profile[]> {
  if (isLocalApiMode) return xamppRequest<Profile[]>("org_staff", { body: { organization_id: organizationId } });
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .in("role", ["dressmaker", "admin"])
    .order("last_name");
  throwIfError(error);
  return (data ?? []) as Profile[];
}

export async function listOrgScans(organizationId: string): Promise<Scan[]> {
  if (isLocalApiMode) return xamppRequest<Scan[]>("org_scans", { body: { organization_id: organizationId } });
  const { data, error } = await requireSupabase()
    .from("scans")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as Scan[];
}

export async function listOrgOrders(organizationId: string): Promise<Order[]> {
  if (isLocalApiMode) return xamppRequest<Order[]>("org_orders", { body: { organization_id: organizationId } });
  const { data, error } = await requireSupabase()
    .from("orders")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as Order[];
}

export async function listAdminProfiles(role?: "customer" | "dressmaker" | "admin"): Promise<Profile[]> {
  if (isLocalApiMode) return xamppRequest<Profile[]>("admin_profiles", { body: { role: role ?? null } });
  let query = requireSupabase().from("profiles").select("*").order("last_name").order("first_name");
  if (role) query = query.eq("role", role);
  const { data, error } = await query;
  throwIfError(error);
  return (data ?? []) as Profile[];
}

export async function listAdminScans(): Promise<Scan[]> {
  if (isLocalApiMode) return xamppRequest<Scan[]>("admin_scans");
  const { data, error } = await requireSupabase().from("scans").select("*").order("updated_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as Scan[];
}

export async function listAdminOrders(): Promise<Order[]> {
  if (isLocalApiMode) return xamppRequest<Order[]>("admin_orders");
  const { data, error } = await requireSupabase().from("orders").select("*").order("created_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as Order[];
}

export async function updateMeasurement(
  measurementId: string,
  adjustedValue: number | null,
  adjustmentReason: string | null,
  adjustedBy: string,
): Promise<Measurement> {
  if (isLocalApiMode) {
    return xamppRequest<Measurement>("update_measurement", {
      body: { measurement_id: measurementId, adjusted_value: adjustedValue, adjustment_reason: adjustmentReason, adjusted_by: adjustedBy },
    });
  }
  const { data, error } = await requireSupabase()
    .from("measurements")
    .update({
      adjusted_value: adjustedValue,
      adjusted_by: adjustedValue === null ? null : adjustedBy,
      adjustment_reason: adjustedValue === null ? null : adjustmentReason,
    })
    .eq("id", measurementId)
    .select("*")
    .single();
  throwIfError(error);
  return data as Measurement;
}

export async function addReviewEvent(input: {
  scanId: string;
  actorId: string;
  eventType: "opened" | "adjusted" | "approved" | "recapture_requested" | "photo_accessed" | "deleted";
  payload?: Record<string, unknown>;
}): Promise<void> {
  if (isLocalApiMode) {
    await xamppRequest("add_review_event", {
      body: { scan_id: input.scanId, actor_id: input.actorId, event_type: input.eventType, payload: input.payload ?? {} },
    });
    return;
  }
  const { error } = await requireSupabase().from("measurement_review_events").insert({
    scan_id: input.scanId,
    actor_id: input.actorId,
    event_type: input.eventType,
    payload: input.payload ?? {},
  });
  throwIfError(error);
}

export async function createOrder(input: {
  customerId: string;
  organizationId: string | null;
  scanId: string;
  garmentType: string;
  notes: string;
}): Promise<Order> {
  if (isLocalApiMode) {
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
  const { data, error } = await requireSupabase()
    .from("orders")
    .insert({
      customer_id: input.customerId,
      organization_id: input.organizationId,
      scan_id: input.scanId,
      garment_type: input.garmentType.trim(),
      notes: input.notes.trim() || null,
      status: "new",
    })
    .select("*")
    .single();
  throwIfError(error);
  return data as Order;
}

export async function updateOrderStatus(orderId: string, status: Order["status"]): Promise<Order> {
  if (isLocalApiMode) return xamppRequest<Order>("update_order", { body: { order_id: orderId, status } });
  const { data, error } = await requireSupabase().from("orders").update({ status }).eq("id", orderId).select("*").single();
  throwIfError(error);
  return data as Order;
}

export async function createFitting(input: {
  orderId: string;
  startsAt: string;
  location: string;
  notes: string;
}): Promise<Fitting> {
  if (isLocalApiMode) {
    return xamppRequest<Fitting>("create_fitting", {
      body: { order_id: input.orderId, starts_at: input.startsAt, location: input.location.trim(), notes: input.notes.trim() },
    });
  }
  const { data, error } = await requireSupabase()
    .from("fittings")
    .insert({
      order_id: input.orderId,
      starts_at: input.startsAt,
      location: input.location.trim() || null,
      notes: input.notes.trim() || null,
      status: "requested",
    })
    .select("*")
    .single();
  throwIfError(error);
  return data as Fitting;
}

export async function updateFittingStatus(fittingId: string, status: Fitting["status"]): Promise<Fitting> {
  if (isLocalApiMode) return xamppRequest<Fitting>("update_fitting", { body: { fitting_id: fittingId, status } });
  const { data, error } = await requireSupabase().from("fittings").update({ status }).eq("id", fittingId).select("*").single();
  throwIfError(error);
  return data as Fitting;
}

export async function createOrganization(input: { name: string; ownerId: string }): Promise<Organization> {
  if (isLocalApiMode) return xamppRequest<Organization>("create_organization", { body: { name: input.name.trim(), owner_id: input.ownerId } });
  const { data, error } = await requireSupabase()
    .from("organizations")
    .insert({ name: input.name.trim(), owner_id: input.ownerId })
    .select("*")
    .single();
  throwIfError(error);
  return data as Organization;
}
