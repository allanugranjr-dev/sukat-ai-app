import { validateUpload } from "./scanFlow";
import { xamppRequest } from "./xampp";
import type { AssetType, ScanAsset } from "./types";

export async function uploadScanAsset(input: {
  scanId: string;
  customerId: string;
  organizationId: string | null;
  assetType: Extract<AssetType, "front" | "side" | "back">;
  file: File;
}): Promise<ScanAsset> {
  const validation = validateUpload(input.file);
  if (!validation.valid) throw new Error(validation.message);

  const formData = new FormData();
  formData.append("scan_id", input.scanId);
  formData.append("customer_id", input.customerId);
  formData.append("organization_id", input.organizationId ?? "");
  formData.append("asset_type", input.assetType);
  formData.append("file", input.file, input.file.name);
  return xamppRequest<ScanAsset>("upload_scan_asset", { formData });
}

export async function deleteScanAsset(asset: Pick<ScanAsset, "id" | "storage_path">): Promise<void> {
  await xamppRequest("delete_scan_asset", { body: { asset_id: asset.id, storage_path: asset.storage_path } });
  return;
}

export async function createSignedStorageUrl(bucket: "scan-captures" | "body-models", path: string, expiresIn = 300): Promise<string> {
  return xamppRequest<string>("signed_url", { body: { bucket, path, expires_in: expiresIn } });
}
