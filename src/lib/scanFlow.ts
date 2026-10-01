import type { ScanStatus } from "./types";

export type ScanStep = "prep" | "height" | "capture" | "processing" | "results";

export const scanSteps: Array<{ key: ScanStep; label: string }> = [
  { key: "prep", label: "Prepare" },
  { key: "height", label: "Height" },
  { key: "capture", label: "Photos" },
  { key: "processing", label: "Processing" },
  { key: "results", label: "Review" },
];

export type CustomerScanJourney = {
  badge: string;
  badgeTone: "success" | "warning" | "danger" | "teal" | "blue";
  title: string;
  body: string;
  actionLabel: string;
  destination: "scan" | "scan:new" | "measurements";
};

/**
 * Choose one clear, truthful dashboard action for the customer's newest scan.
 * An actionable scan always takes priority over an older completed record.
 */
export function customerScanJourney(status: ScanStatus | null): CustomerScanJourney {
  switch (status) {
    case "draft":
      return {
        badge: "SCAN IN PROGRESS",
        badgeTone: "teal",
        title: "Finish setting up your scan.",
        body: "Add your height, then upload your front and side views when you are ready.",
        actionLabel: "Continue scan",
        destination: "scan",
      };
    case "uploaded":
      return {
        badge: "PHOTOS READY",
        badgeTone: "teal",
        title: "Your photos are ready to submit.",
        body: "Review the front and side views, then send them for processing when they look right.",
        actionLabel: "Review photos",
        destination: "scan",
      };
    case "processing_queued":
    case "processing":
      return {
        badge: "SCAN PROCESSING",
        badgeTone: "blue",
        title: "We are checking your photos.",
        body: "Your scan updates automatically. You can open it at any time to see the latest saved status.",
        actionLabel: "View processing",
        destination: "scan",
      };
    case "needs_recapture":
      return {
        badge: "NEW PHOTOS NEEDED",
        badgeTone: "warning",
        title: "Your scan needs replacement photos.",
        body: "Open the scan to replace the views that need another try before processing resumes.",
        actionLabel: "Replace photos",
        destination: "scan",
      };
    case "failed":
      return {
        badge: "SCAN NEEDS ATTENTION",
        badgeTone: "danger",
        title: "Your scan needs another try.",
        body: "Open the scan to see the saved feedback, retry it, or replace the photos before trying again.",
        actionLabel: "Fix scan",
        destination: "scan",
      };
    case "ready_to_share":
      return {
        badge: "RESULT READY",
        badgeTone: "success",
        title: "Your measurements are ready to review.",
        body: "Review the returned measurements before sharing them with your dressmaker.",
        actionLabel: "Review measurements",
        destination: "scan",
      };
    case "ready_for_review":
      return {
        badge: "WITH YOUR DRESSMAKER",
        badgeTone: "success",
        title: "Your measurements are ready for review.",
        body: "Your dressmaker can now check this result and use it for the next fitting step.",
        actionLabel: "Open result",
        destination: "scan",
      };
    case "verified":
      return {
        badge: "MEASUREMENTS READY",
        badgeTone: "success",
        title: "Your checked measurements are ready.",
        body: "Open the measurement record whenever you need it for an order or fitting.",
        actionLabel: "Open measurements",
        destination: "measurements",
      };
    default:
      return {
        badge: "ACCOUNT READY",
        badgeTone: "teal",
        title: "Start a clearer scan.",
        body: "Create a guided scan when you are ready. Results appear after the service checks your photos.",
        actionLabel: "Start a scan",
        destination: "scan:new",
      };
  }
}

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
  // Height is the calibration reference for both the silhouette scale and
  // the fitted body. Never let an unknown value reach the provider.
  if (unknownHeight) return false;
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
  if (step === "results") return { step: "capture", captureIndex: 0 };
  if (step === "processing") return { step: "capture", captureIndex: 0 };
  return { step, captureIndex };
}

export function validateUpload(file: { type: string; size: number } | null): {
  valid: boolean;
  message: string;
} {
  if (!file) return { valid: false, message: "Choose an image first." };
  const supported = ["image/jpeg", "image/png", "image/webp"];
  if (!supported.includes(file.type.trim().toLowerCase())) return { valid: false, message: "Use a JPG, PNG, or WebP image." };
  if (file.size <= 0) return { valid: false, message: "The selected image is empty. Choose another image." };
  if (file.size > 10 * 1024 * 1024) return { valid: false, message: "Images must be 10 MB or smaller." };
  return { valid: true, message: "Image is ready to upload." };
}
