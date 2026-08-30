export type ScanStep = "prep" | "height" | "capture" | "processing" | "results";

export const scanSteps: Array<{ key: ScanStep; label: string }> = [
  { key: "prep", label: "Consent" },
  { key: "height", label: "Height" },
  { key: "capture", label: "Capture" },
  { key: "processing", label: "Process" },
  { key: "results", label: "Results" },
];

export function isHeightValid(value: string, unit: "cm" | "ftin", unknownHeight: boolean): boolean {
  if (unknownHeight) return true;
  if (unit === "cm") {
    const number = Number(value);
    return Number.isFinite(number) && number >= 120 && number <= 230;
  }
  const match = value.trim().match(/^(\d)\s*(?:ft|')?\s*(\d{1,2})?/i);
  if (!match) return false;
  const feet = Number(match[1]);
  const inches = Number(match[2] ?? 0);
  return feet >= 4 && feet <= 7 && inches >= 0 && inches <= 11;
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
  if (!supported.includes(file.type)) return { valid: false, message: "Use a JPG, PNG, or WebP image." };
  if (file.size > 10 * 1024 * 1024) return { valid: false, message: "Images must be smaller than 10 MB." };
  return { valid: true, message: "Image is ready to upload." };
}
