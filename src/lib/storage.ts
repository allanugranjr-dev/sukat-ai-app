import { validateUpload } from "./scanFlow";
import { isLocalApiMode, requireSupabase, readableError } from "./supabase";
import { xamppRequest } from "./xampp";
import type { AssetType, ScanAsset } from "./types";

function extensionFor(file: File): string {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension && /^[a-z0-9]{2,5}$/.test(extension)) return extension;
  return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
}

export async function uploadScanAsset(input: {
  scanId: string;
  customerId: string;
  organizationId: string | null;
  assetType: Extract<AssetType, "front" | "side" | "back">;
  file: File;
}): Promise<ScanAsset> {
  const validation = validateUpload(input.file);
  if (!validation.valid) throw new Error(validation.message);

  if (isLocalApiMode) {
    const formData = new FormData();
    formData.append("scan_id", input.scanId);
    formData.append("customer_id", input.customerId);
    formData.append("organization_id", input.organizationId ?? "");
    formData.append("asset_type", input.assetType);
    formData.append("file", input.file, input.file.name);
    return xamppRequest<ScanAsset>("upload_scan_asset", { formData });
  }

  const client = requireSupabase();
  const path = `${input.organizationId ?? "unassigned"}/${input.customerId}/${input.scanId}/${input.assetType}-${crypto.randomUUID()}.${extensionFor(input.file)}`;
  const upload = await client.storage.from("scan-captures").upload(path, input.file, {
    contentType: input.file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (upload.error) throw new Error(readableError(upload.error));

  const { data, error } = await client
    .from("scan_assets")
    .insert({
      scan_id: input.scanId,
      asset_type: input.assetType,
      storage_path: path,
      metadata: {
        original_name: input.file.name,
        content_type: input.file.type,
        size_bytes: input.file.size,
        last_modified: input.file.lastModified,
      },
      quality_status: "pending",
    })
    .select("*")
    .single();
  if (error) {
    await client.storage.from("scan-captures").remove([path]);
    throw new Error(readableError(error));
  }

  const signed = await client.storage.from("scan-captures").createSignedUrl(path, 300);
  return { ...(data as ScanAsset), signedUrl: signed.data?.signedUrl };
}

export async function deleteScanAsset(asset: Pick<ScanAsset, "id" | "storage_path">): Promise<void> {
  if (isLocalApiMode) {
    await xamppRequest("delete_scan_asset", { body: { asset_id: asset.id, storage_path: asset.storage_path } });
    return;
  }
  const client = requireSupabase();
  const storageResult = await client.storage.from("scan-captures").remove([asset.storage_path]);
  if (storageResult.error) throw new Error(readableError(storageResult.error));
  const { error } = await client.from("scan_assets").delete().eq("id", asset.id);
  if (error) throw new Error(readableError(error));
}

export async function createSignedStorageUrl(bucket: "scan-captures" | "body-models", path: string, expiresIn = 300): Promise<string> {
  if (isLocalApiMode) return xamppRequest<string>("signed_url", { body: { bucket, path, expires_in: expiresIn } });
  const { data, error } = await requireSupabase().storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw new Error(readableError(error ?? new Error("The private asset URL could not be created.")));
  return data.signedUrl;
}
