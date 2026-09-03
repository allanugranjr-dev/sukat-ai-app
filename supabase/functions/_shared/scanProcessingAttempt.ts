type SupabaseAdmin = {
  from: (table: string) => any;
};

export type ProcessingAttemptRow = {
  id: string;
  attempt_number: number;
  status: string;
};

const ACTIVE_STATUSES = ["queued", "validating", "processing", "retrying"];

function safeMessage(value: unknown, fallback: string): string {
  const message = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return message.slice(0, 1000);
}

export async function findActiveProcessingAttempt(client: SupabaseAdmin, scanId: string): Promise<ProcessingAttemptRow | null> {
  const { data, error } = await client
    .from("scan_processing_attempts")
    .select("id,attempt_number,status")
    .eq("scan_id", scanId)
    .in("status", ACTIVE_STATUSES)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("The scan processing attempt could not be loaded.");
  return data as ProcessingAttemptRow | null;
}

export async function claimProcessingAttempt(
  client: SupabaseAdmin,
  scanId: string,
  attemptNumber: number,
  provider: string,
): Promise<ProcessingAttemptRow> {
  const active = await findActiveProcessingAttempt(client, scanId);
  if (active) {
    const { error: repairError } = await client.from("scans").update({ processing_attempt_id: active.id }).eq("id", scanId).is("processing_attempt_id", null);
    if (repairError) throw new Error("The scan processing attempt could not be linked.");
    return active;
  }

  const id = crypto.randomUUID();
  const { data: created, error: createError } = await client
    .from("scan_processing_attempts")
    .insert({
      id,
      scan_id: scanId,
      attempt_number: attemptNumber,
      status: "processing",
      provider,
      idempotency_key: `${scanId}:${attemptNumber}`,
      claim_token: crypto.randomUUID(),
      started_at: new Date().toISOString(),
    })
    .select("id,attempt_number,status")
    .single();
  if (createError) {
    const raced = await findActiveProcessingAttempt(client, scanId);
    if (raced) return raced;
    throw new Error("The scan processing attempt could not be created.");
  }

  const { error: linkError } = await client.from("scans").update({ processing_attempt_id: id }).eq("id", scanId);
  if (linkError) throw new Error("The scan processing attempt could not be linked.");
  return created as ProcessingAttemptRow;
}

export async function stageProcessingAttempt(
  client: SupabaseAdmin,
  attemptId: string,
  values: {
    processingVersion: string | null;
    quality: unknown;
    qualityIssues: unknown;
    reconstruction: unknown;
    measurements: unknown;
    modelPath: string | null;
  },
): Promise<void> {
  const { data, error } = await client.from("scan_processing_attempts").update({
    status: "processing",
    processing_version: values.processingVersion,
    quality: values.quality ?? null,
    quality_issues: values.qualityIssues ?? [],
    reconstruction: values.reconstruction ?? {},
    staged_measurements: values.measurements ?? [],
    staged_model_path: values.modelPath,
  }).eq("id", attemptId).eq("status", "processing").eq("is_promoted", false).select("id").maybeSingle();
  if (error || !data) throw new Error("The provider result could not be staged for promotion.");
}

export async function promoteProcessingAttempt(client: SupabaseAdmin, attemptId: string): Promise<void> {
  const { data, error } = await client.from("scan_processing_attempts").update({
    status: "promoted",
    is_promoted: true,
    promoted_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }).eq("id", attemptId).eq("status", "processing").eq("is_promoted", false).select("id").maybeSingle();
  if (error || !data) throw new Error("The scan processing attempt could not be promoted.");
}

export async function failProcessingAttempt(client: SupabaseAdmin, attemptId: string | null, errorCode: string, errorMessage: string): Promise<void> {
  if (!attemptId) return;
  await client.from("scan_processing_attempts").update({
    status: "failed",
    error_code: safeMessage(errorCode, "processing_failed").slice(0, 80),
    error_message: safeMessage(errorMessage, "The scan could not be completed."),
    completed_at: new Date().toISOString(),
  }).eq("id", attemptId).eq("is_promoted", false);
}
