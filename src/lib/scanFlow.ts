export type ScanStep = "prep" | "height" | "capture" | "processing" | "results";

export const scanSteps: Array<{ key: ScanStep; label: string }> = [
  { key: "prep", label: "Prepare" },
  { key: "height", label: "Height" },
  { key: "capture", label: "Photos" },
  { key: "processing", label: "Processing" },
  { key: "results", label: "Review" },
];

/** Parse the supported feet/inches entry formats into total inches. */
export function parseHeightInches(value: string): number | null {
  const match = value.trim().match(/^(\d)\s*(?:(?:ft|feet)\s*|'\s*|\s+)(\d{1,2})?\s*(?:(?:in|inches)|")?\s*$/i);
  if (!match) return null;
  const feet = Number(match[1]);
  const inches = Number(match[2] ?? 0);
  if (!Number.isInteger(feet) || !Number.isInteger(inches) || inches > 11) return null;
  return feet * 12 + inches;
}

export function isHeightValid(value: string, unit: "cm" | "ftin", unknownHeight: boolean): boolean {
  if (unknownHeight) return true;
  if (unit === "cm") {
    const number = Number(value);
    return Number.isFinite(number) && number >= 120 && number <= 230;
  }
  const totalInches = parseHeightInches(value);
  return totalInches !== null && totalInches >= 48 && totalInches <= 95;
}

export function previousScanPosition(step: ScanStep, captureIndex: number): {
  step: ScanStep;
  captureIndex: number;
} {
  if (step === "capture" && captureIndex > 0) {
    return { step: "capture", captureIndex: captureIndex - 1 };
  }
  if (step === "capture") return { step: "height", captureIndex: 0 };
  if (step === "height") return { step: "prep", captureIndex: 0 };
  if (step === "processing") return { step: "capture", captureIndex: 2 };
  return { step, captureIndex };
}

export function validateUpload(file: { type: string; size: number } | null): {
  valid: boolean;
  message: string;
} {
  if (!file) return { valid: false, message: "Choose an image first." };
  const supported = ["image/jpeg", "image/png", "image/webp"];
  if (!supported.includes(file.type.trim().toLowerCase())) return { valid: false, message: "Use a JPG, PNG, or WebP image." };
  if (file.size > 10 * 1024 * 1024) return { valid: false, message: "Images must be 10 MB or smaller." };
  return { valid: true, message: "Image is ready to upload." };
}
