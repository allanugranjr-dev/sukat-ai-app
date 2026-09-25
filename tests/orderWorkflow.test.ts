import { describe, expect, it } from "vitest";
import { hasOpenOrderForScan, isOpenOrderStatus, orderActionLabel, orderStatusDisplayLabel } from "../src/lib/orderWorkflow";
import type { Order } from "../src/lib/types";

function order(status: Order["status"], scanId = "scan-1"): Order {
  return {
    id: `${status}-order`,
    customer_id: "customer-1",
    organization_id: "org-1",
    dressmaker_id: null,
    scan_id: scanId,
    status,
    garment_type: "Blouse",
    due_date: null,
    notes: null,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
  };
}

describe("order workflow", () => {
  it("only treats active production statuses as open", () => {
    expect(isOpenOrderStatus("new")).toBe(true);
    expect(isOpenOrderStatus("ready_for_pickup")).toBe(true);
    expect(isOpenOrderStatus("completed")).toBe(false);
    expect(isOpenOrderStatus("cancelled")).toBe(false);
  });

  it("blocks a scan when any active order uses it, including mixed history", () => {
    expect(hasOpenOrderForScan([order("completed"), order("new")], "scan-1")).toBe(true);
    expect(hasOpenOrderForScan([order("completed")], "scan-1")).toBe(false);
    expect(hasOpenOrderForScan([order("new", "other-scan")], "scan-1")).toBe(false);
  });

  it("uses clear production action and status labels", () => {
    expect(orderActionLabel("new")).toBe("Review");
    expect(orderActionLabel("accepted")).toBe("In progress");
    expect(orderActionLabel("in_production")).toBe("In progress");
    expect(orderActionLabel("for_fitting")).toBe("Ready to pick up");
    expect(orderActionLabel("ready_for_pickup")).toBe("Complete");
    expect(orderActionLabel("completed")).toBe("Complete");
    expect(orderStatusDisplayLabel("in_production")).toBe("In progress");
  });
});
