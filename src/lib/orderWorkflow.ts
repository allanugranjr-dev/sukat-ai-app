import type { Order } from "./types";

export const OPEN_ORDER_STATUSES = [
  "new",
  "accepted",
  "in_production",
  "for_fitting",
  "ready_for_pickup",
] as const satisfies readonly Order["status"][];

export const ORDER_NEXT_STATUS: Partial<Record<Order["status"], Order["status"]>> = {
  new: "accepted",
  accepted: "in_production",
  in_production: "for_fitting",
  for_fitting: "ready_for_pickup",
  ready_for_pickup: "completed",
};

export const ORDER_ACTION_LABELS: Partial<Record<Order["status"], string>> = {
  new: "Review",
  accepted: "In progress",
  in_production: "In progress",
  for_fitting: "Ready to pick up",
  ready_for_pickup: "Complete",
};

export function isOpenOrderStatus(status: Order["status"]): boolean {
  return (OPEN_ORDER_STATUSES as readonly Order["status"][]).includes(status);
}

export function hasOpenOrderForScan(orders: Order[], scanId: string): boolean {
  return orders.some((order) => order.scan_id === scanId && isOpenOrderStatus(order.status));
}

export function orderActionLabel(status: Order["status"]): string {
  return ORDER_ACTION_LABELS[status] ?? (status === "cancelled" ? "Cancelled" : "Complete");
}

export function orderStatusDisplayLabel(status: Order["status"]): string {
  return {
    new: "Review",
    accepted: "In progress",
    in_production: "In progress",
    for_fitting: "Fitting",
    ready_for_pickup: "Ready to pick up",
    completed: "Complete",
    cancelled: "Cancelled",
  }[status];
}
