import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";
import express from "express";
import multer from "multer";
import nodemailer from "nodemailer";
import { Server } from "socket.io";

import { canonicalAppUrl, config } from "./config.mjs";
import {
  closeDatabase,
  execute,
  initializeDatabase,
  row,
  rows,
  transaction,
} from "./database.mjs";
import { isAiProviderEnabled, processWithAiService } from "./aiService.mjs";
import { claimScanAttempt, failScanAttempt, promoteScanAttempt, safeProcessingErrorMessage, scanAttemptResponse, stageScanAttempt } from "./scanProcessingAttempt.mjs";

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const app = express();
app.disable("x-powered-by");
const httpServer = http.createServer(app);
let io;
const processingJobs = new Map();
let processingQueue = Promise.resolve();
const scanRecoveryIntervalMs = 60_000;
let scanRecoveryTimer = null;
const sessionCookieName = "sukatai_node";

// Lightweight in-memory rate limiter for authentication actions. Keeps per-key
// hit counts in a sliding window so sign-in / sign-up / password-reset cannot be
// brute-forced. Deployments behind multiple instances should add a shared store,
// but this closes the wide-open single-instance case with no new dependency.
const rateLimitBuckets = new Map();
const authRateLimit = { windowMs: 15 * 60 * 1000, max: 10 };

function rateLimitHit(key) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + authRateLimit.windowMs });
    return { limited: false, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > authRateLimit.max) {
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

// Periodically drop expired buckets so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (now >= bucket.resetAt) rateLimitBuckets.delete(key);
  }
}, authRateLimit.windowMs).unref?.();

const rateLimitedActions = new Set(["sign_in", "sign_up", "password_reset_request", "password_reset_confirm", "verify_otp", "resend_otp"]);

function clientIp(req) {
  // Only honor the client-supplied X-Forwarded-For when a trusted proxy is
  // configured; otherwise it is attacker-controlled and would let a client mint
  // a fresh rate-limit bucket per request by rotating the header. When trusted,
  // use the LAST hop the proxy appended (the real client as the proxy saw it),
  // not the first, which a client can prepend.
  if (config.trustProxy) {
    const chain = String(req.headers["x-forwarded-for"] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    if (chain.length > 0) return chain[chain.length - 1];
  }
  return req.socket?.remoteAddress || "unknown";
}

// A fixed bcrypt hash used to spend the same time on a missing account as on a
// real one, so response timing does not reveal whether an email is registered.
const dummyPasswordHash = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO3n8n8n8n8n8n8n8n8n8n8n8n8n8n8n8";
const allowedScanStatuses = [
  "draft",
  "uploaded",
  "processing_queued",
  "processing",
  "ready_to_share",
  "ready_for_review",
  "verified",
  "needs_recapture",
  "failed",
];
const allowedOrderStatuses = ["new", "accepted", "in_production", "for_fitting", "ready_for_pickup", "completed", "cancelled"];
const openOrderStatuses = ["new", "accepted", "in_production", "for_fitting", "ready_for_pickup"];
const orderTransitions = {
  new: ["accepted", "cancelled"],
  accepted: ["in_production", "cancelled"],
  in_production: ["for_fitting", "cancelled"],
  for_fitting: ["ready_for_pickup", "cancelled"],
  ready_for_pickup: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};
const allowedFittingStatuses = ["requested", "confirmed", "completed", "reschedule_requested", "cancelled"];
const allowedReviewEvents = ["opened", "adjusted", "approved", "recapture_requested", "photo_accessed", "deleted"];
const customerScanStatuses = ["draft", "uploaded", "processing_queued", "ready_for_review", "needs_recapture"];
const staffScanStatuses = ["verified", "needs_recapture"];
const getActions = new Set(["health", "session", "profile", "notifications", "organizations", "invitations", "admin_scans", "admin_orders", "asset", "scan_processing_status"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function hasImageSignature(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function sendData(res, data, status = 200) {
  res.status(status).json({ ok: true, data });
}

function sendError(res, error) {
  const status = error instanceof ApiError ? error.status : 500;
  if (status >= 500) {
    const logMessage = error instanceof ApiError ? error.message : safeProcessingErrorMessage(error instanceof Error ? error.message : "");
    console.error("SukatAI Node API error:", logMessage);
  }
  if (res.headersSent) return;
  const defaultMessage = "The Node.js API could not complete the request.";
  const message = status >= 500
    ? defaultMessage
    : error instanceof ApiError && error.message ? error.message : defaultMessage;
  res.status(status).json({
    ok: false,
    message,
  });
}

function requestData(req) {
  return req.method === "GET" ? req.query ?? {} : req.body ?? {};
}

function stringInput(data, key, fallback = null) {
  const value = data?.[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return fallback;
}

function numberInput(data, key, fallback = null) {
  const value = data?.[key];
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanInput(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function jsonValue(value) {
  if (value && typeof value === "object" && !Buffer.isBuffer(value) && !(value instanceof Date)) return value;
  if (typeof value !== "string" || value === "") return {};
  try {
    const decoded = JSON.parse(value);
    return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? decoded : {};
  } catch {
    return {};
  }
}

function jsonParameter(value) {
  return JSON.stringify(value && typeof value === "object" ? value : {});
}

function mysqlDateTime(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new ApiError("The supplied date is invalid.", 400);
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
  const parsed = new Date(text.includes(" ") && !text.includes("T") ? `${text.replace(" ", "T")}Z` : text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function generateOtpCode() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

async function issueOtp(userId) {
  const code = generateOtpCode();
  await execute(
    "UPDATE users SET otp_hash = ?, otp_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), otp_attempts = 0, otp_last_sent_at = UTC_TIMESTAMP() WHERE id = ?",
    [hashToken(code), userId],
  );
  return code;
}

async function sendOtpEmail(user, code) {
  const subject = "Your SukatAI verification code";
  const firstName = escapeHtml(user.first_name ?? "");
  const greetingName = firstName ? ` ${firstName}` : "";
  const text = `Hi${user.first_name ? ` ${user.first_name}` : ""},\n\nYour SukatAI verification code is ${code}. It expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.`;
  const html = `<p>Hi${greetingName},</p><p>Your SukatAI verification code is <strong style="font-size:20px;letter-spacing:2px">${code}</strong>.</p><p>It expires in 10 minutes.</p><p>If you did not request this, you can ignore this email.</p>`;
  return await sendEmail({ to: user.email, subject, text, html });
}

// Password-reset code. Reuses the long-existing reset_token_hash / reset_expires_at
// columns to store the hashed code + expiry, plus reset_attempts / reset_last_sent_at
// for the same 5-try lockout and 45s cooldown the verification OTP uses.
async function issueResetCode(userId) {
  const code = generateOtpCode();
  await execute(
    "UPDATE users SET reset_token_hash = ?, reset_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), reset_attempts = 0, reset_last_sent_at = UTC_TIMESTAMP() WHERE id = ?",
    [hashToken(code), userId],
  );
  return code;
}

async function sendResetEmail(user, code) {
  const subject = "Your SukatAI password reset code";
  const firstName = escapeHtml(user.first_name ?? "");
  const greetingName = firstName ? ` ${firstName}` : "";
  const text = `Hi${user.first_name ? ` ${user.first_name}` : ""},\n\nYour SukatAI password reset code is ${code}. It expires in 10 minutes.\n\nIf you did not request a password reset, you can ignore this email and your password stays unchanged.`;
  const html = `<p>Hi${greetingName},</p><p>Your SukatAI password reset code is <strong style="font-size:20px;letter-spacing:2px">${code}</strong>.</p><p>It expires in 10 minutes.</p><p>If you did not request a password reset, you can ignore this email and your password stays unchanged.</p>`;
  return await sendEmail({ to: user.email, subject, text, html });
}

function devCodeAllowed(sendResult) {
  return !config.isProduction && sendResult && sendResult.status === "not_configured";
}

function otpVerificationPayload(email, sendResult, code) {
  return {
    email,
    expires_in_seconds: 600,
    delivery: sendResult?.status ?? "unknown",
    ...(devCodeAllowed(sendResult) ? { dev_code: code } : {}),
  };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePhone(value) {
  const phone = String(value ?? "").trim().replace(/[\s().-]/g, "");
  if (!phone) return null;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new ApiError("Enter a phone number in international format, for example +639171234567.", 400);
  }
  return phone;
}

function providerForChannel(channel) {
  return channel === "email" ? config.notifications.emailProvider : config.notifications.smsProvider;
}

// The SMTP transport is created lazily and cached: nodemailer pools the
// connection, so re-creating it per send would defeat keep-alive and re-auth
// against Gmail on every OTP email.
let smtpTransport = null;
function smtpTransporter() {
  if (smtpTransport) return smtpTransport;
  const { smtp } = config.notifications;
  smtpTransport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  return smtpTransport;
}

// Gmail rejects a From that is not the authenticated mailbox, so when the
// operator has not set an explicit SUKATAI_EMAIL_FROM (the config default is a
// Resend sandbox address) fall back to the SMTP username with a display name.
function smtpFromAddress() {
  const { emailFrom, smtp } = config.notifications;
  if (emailFrom && !emailFrom.includes("resend.dev")) return emailFrom;
  return `SukatAI <${smtp.user}>`;
}

async function sendEmailViaSmtp({ to, subject, text, html }) {
  const { smtp } = config.notifications;
  if (!smtp.host || !smtp.user || !smtp.pass) {
    return { status: "not_configured", provider: "smtp", error: "SMTP email configuration is incomplete." };
  }
  try {
    const info = await smtpTransporter().sendMail({ from: smtpFromAddress(), to, subject, text, html });
    return { status: "sent", provider: "smtp", providerMessageId: typeof info?.messageId === "string" ? info.messageId : null, error: null };
  } catch (error) {
    return { status: "failed", provider: "smtp", error: `Email delivery failed: ${error instanceof Error ? error.message.slice(0, 260) : "smtp error"}` };
  }
}

async function sendEmail({ to, subject, text, html }) {
  const { emailProvider, emailApiKey, emailFrom } = config.notifications;
  if (emailProvider === "smtp") {
    return sendEmailViaSmtp({ to, subject, text, html });
  }
  if (emailProvider !== "resend") {
    return { status: "not_configured", provider: emailProvider || "console", error: "Email delivery is not configured." };
  }
  if (!emailApiKey || !emailFrom) {
    return { status: "not_configured", provider: "resend", error: "Resend email configuration is incomplete." };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${emailApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: emailFrom, to: [to], subject, text, html }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload?.message === "string" ? payload.message : `HTTP ${response.status}`;
      return { status: "failed", provider: "resend", error: `Email delivery failed: ${detail.slice(0, 300)}` };
    }
    return { status: "sent", provider: "resend", providerMessageId: typeof payload?.id === "string" ? payload.id : null, error: null };
  } catch (error) {
    return { status: "failed", provider: "resend", error: `Email delivery failed: ${error instanceof Error ? error.message.slice(0, 260) : "network error"}` };
  }
}

async function sendSms({ to, body }) {
  const { smsProvider, twilioAccountSid, twilioAuthToken, twilioFromNumber } = config.notifications;
  if (smsProvider !== "twilio") {
    return { status: "not_configured", provider: smsProvider || "console", error: "SMS delivery is not configured." };
  }
  if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
    return { status: "not_configured", provider: "twilio", error: "Twilio SMS configuration is incomplete." };
  }
  try {
    const encodedCredentials = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64");
    const form = new URLSearchParams({ From: twilioFromNumber, To: to, Body: body });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodedCredentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload?.message === "string" ? payload.message : `HTTP ${response.status}`;
      return { status: "failed", provider: "twilio", error: `SMS delivery failed: ${detail.slice(0, 300)}` };
    }
    return { status: "sent", provider: "twilio", providerMessageId: typeof payload?.sid === "string" ? payload.sid : null, error: null };
  } catch (error) {
    return { status: "failed", provider: "twilio", error: `SMS delivery failed: ${error instanceof Error ? error.message.slice(0, 260) : "network error"}` };
  }
}

async function createDelivery({ notificationId = null, userId = null, eventKey, channel, destination }) {
  const existing = await row("SELECT * FROM notification_deliveries WHERE event_key = ? AND channel = ? LIMIT 1", [eventKey, channel]);
  if (existing) return existing;
  const id = randomUUID();
  try {
    await execute(
      "INSERT INTO notification_deliveries (id, notification_id, user_id, event_key, channel, destination, status, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, notificationId, userId, eventKey, channel, destination, "pending", providerForChannel(channel)],
    );
  } catch (error) {
    if (!isDuplicateError(error)) throw error;
  }
  return row("SELECT * FROM notification_deliveries WHERE event_key = ? AND channel = ? LIMIT 1", [eventKey, channel]);
}

async function dispatchDelivery(delivery, message) {
  if (!delivery || delivery.status !== "pending") return delivery;
  const result = delivery.channel === "email" ? await sendEmail(message) : await sendSms(message);
  await execute(
    `UPDATE notification_deliveries SET status = ?, provider = ?, provider_message_id = ?, error = ?, sent_at = ${result.status === "sent" ? "UTC_TIMESTAMP()" : "NULL"} WHERE id = ?`,
    [result.status, result.provider, result.providerMessageId ?? null, result.error ?? null, delivery.id],
  );
  return { ...delivery, ...result };
}

async function ensureOrderReadyNotification(order, customer) {
  const eventKey = `order-ready:${order.id}`;
  let notification = await row("SELECT * FROM notifications WHERE event_key = ? LIMIT 1", [eventKey]);
  if (!notification) {
    const id = randomUUID();
    const title = "Your order is ready";
    const body = `${order.garment_type} is ready for pickup. Please contact your dressmaker for collection details.`;
    try {
      await execute(
        "INSERT INTO notifications (id, user_id, type, title, body, metadata, event_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, customer.id, "order_ready", title, body, jsonParameter({ order_id: order.id, status: order.status }), eventKey],
      );
    } catch (error) {
      if (!isDuplicateError(error)) throw error;
    }
    notification = await row("SELECT * FROM notifications WHERE event_key = ? LIMIT 1", [eventKey]);
  }
  return notification;
}

async function dispatchOrderReadyNotifications(orderId) {
  const order = await row(
    "SELECT o.*, u.id AS customer_user_id, u.first_name, u.last_name, u.email, u.phone, u.email_notifications, u.sms_notifications FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.id = ? LIMIT 1",
    [orderId],
  );
  if (!order) return;
  const customer = {
    id: order.customer_user_id,
    first_name: order.first_name,
    last_name: order.last_name,
    email: order.email,
    phone: order.phone,
    email_notifications: order.email_notifications,
    sms_notifications: order.sms_notifications,
  };
  const notification = await ensureOrderReadyNotification(order, customer);
  const appUrl = config.notifications.publicAppUrl;
  const customerName = customer.first_name || "there";
  const orderLink = appUrl ? `\nOpen SukatAI: ${appUrl}` : "";
  const text = `Hi ${customerName}, your ${order.garment_type} order is ready for pickup. Please contact your dressmaker for collection details.${orderLink}`;
  const html = `<p>Hi ${escapeHtml(customerName)},</p><p>Your <strong>${escapeHtml(order.garment_type)}</strong> order is ready for pickup.</p><p>Please contact your dressmaker for collection details.</p>${appUrl ? `<p><a href="${escapeHtml(appUrl)}">Open SukatAI</a></p>` : ""}`;
  const deliveries = [];
  if (customer.email && (customer.email_notifications === undefined || booleanInput(customer.email_notifications))) {
    deliveries.push({
      delivery: await createDelivery({ notificationId: notification.id, userId: customer.id, eventKey: `order-ready:${order.id}`, channel: "email", destination: customer.email }),
      message: { to: customer.email, subject: `SukatAI: ${order.garment_type} is ready`, text, html },
    });
  }
  if (customer.phone && booleanInput(customer.sms_notifications)) {
    deliveries.push({
      delivery: await createDelivery({ notificationId: notification.id, userId: customer.id, eventKey: `order-ready:${order.id}`, channel: "sms", destination: customer.phone }),
      message: { to: customer.phone, body: `SukatAI: Your ${order.garment_type} order is ready for pickup. Contact your dressmaker for details.` },
    });
  }
  const results = [];
  for (const item of deliveries) results.push(await dispatchDelivery(item.delivery, item.message));
  await execute("UPDATE notifications SET metadata = ? WHERE id = ?", [jsonParameter({ order_id: order.id, status: order.status, deliveries: results.map((result) => ({ channel: result?.channel, status: result?.status })) }), notification.id]);
}

async function dispatchInvitationEmail({ invitationId, invitedBy, email, organizationName, inviteUrl }) {
  const eventKey = `invitation:${invitationId}`;
  const delivery = await createDelivery({ notificationId: null, userId: invitedBy, eventKey, channel: "email", destination: email });
  const text = `You have been invited to join ${organizationName} on SukatAI as a dressmaker. Open this link within 7 days to activate your account:\n${inviteUrl}`;
  const html = `<p>You have been invited to join <strong>${escapeHtml(organizationName)}</strong> on SukatAI as a dressmaker.</p><p>This secure invitation expires in 7 days.</p><p><a href="${escapeHtml(inviteUrl)}">Accept the invitation</a></p><p>If the button does not work, copy this link:</p><p>${escapeHtml(inviteUrl)}</p>`;
  const result = await dispatchDelivery(delivery, { to: email, subject: `Invitation to join ${organizationName} on SukatAI`, text, html });
  return { status: result?.status ?? "pending", provider: result?.provider ?? providerForChannel("email"), error: result?.error ?? null };
}

function publicUser(user) {
  const created = isoDate(user.created_at) ?? new Date().toISOString();
  const updated = isoDate(user.updated_at) ?? created;
  const verifiedAt = user.email_verified ? (isoDate(user.verified_at) ?? created) : null;
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: verifiedAt,
    phone: user.phone ?? "",
    confirmed_at: verifiedAt,
    last_sign_in_at: updated,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { first_name: user.first_name, last_name: user.last_name },
    identities: [],
    created_at: created,
    updated_at: updated,
  };
}

function sessionPayload(user) {
  const expiresAt = Math.floor(Date.now() / 1000) + config.sessionHours * 60 * 60;
  return {
    access_token: "node-session-cookie",
    token_type: "cookie",
    expires_in: config.sessionHours * 60 * 60,
    expires_at: expiresAt,
    refresh_token: "node-session-cookie",
    user: publicUser(user),
  };
}

function profileResponse(user) {
  return {
    id: user.id,
    role: user.role,
    organization_id: user.organization_id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    phone: user.phone ?? null,
    email_verified: Boolean(user.email_verified),
    email_notifications: user.email_notifications === undefined || user.email_notifications === null ? true : booleanInput(user.email_notifications),
    sms_notifications: user.sms_notifications === undefined || user.sms_notifications === null ? false : booleanInput(user.sms_notifications),
    avatar_url: user.avatar_url,
    unit_system: user.unit_system,
    created_at: isoDate(user.created_at),
    updated_at: isoDate(user.updated_at),
  };
}

function organizationResponse(organization) {
  return {
    id: organization.id,
    name: organization.name,
    owner_id: organization.owner_id,
    settings: jsonValue(organization.settings),
    created_at: isoDate(organization.created_at),
  };
}

async function activeOrganizationId() {
  const active = await row(
    "SELECT id FROM organizations WHERE JSON_UNQUOTE(JSON_EXTRACT(settings, '$.active')) = 'true' ORDER BY created_at, id LIMIT 1",
  );
  if (active?.id) return active.id;
  const organizations = await rows("SELECT id FROM organizations ORDER BY created_at, id LIMIT 2");
  return organizations.length === 1 ? organizations[0].id : null;
}

async function ensureActiveOrganizationMarker() {
  const active = await row(
    "SELECT id FROM organizations WHERE JSON_UNQUOTE(JSON_EXTRACT(settings, '$.active')) = 'true' ORDER BY created_at, id LIMIT 1",
  );
  if (active?.id) return active.id;
  const first = await row("SELECT id FROM organizations ORDER BY created_at, id LIMIT 1");
  if (!first?.id) return null;
  await execute("UPDATE organizations SET settings = JSON_SET(COALESCE(settings, JSON_OBJECT()), '$.active', true) WHERE id = ?", [first.id]);
  return first.id;
}

function scanResponse(scan) {
  return {
    id: scan.id,
    customer_id: scan.customer_id,
    organization_id: scan.organization_id,
    status: scan.status,
    height_value: scan.height_value === null ? null : Number(scan.height_value),
    height_unit: scan.height_unit,
    sex: scan.sex ?? "neutral",
    consent_at: isoDate(scan.consent_at),
    capture_source: scan.capture_source,
    processing_provider: scan.processing_provider,
    processing_version: scan.processing_version,
    processing_attempts: scan.processing_attempts === undefined || scan.processing_attempts === null ? 0 : Number(scan.processing_attempts),
    processing_attempt_id: scan.processing_attempt_id ?? null,
    processing_started_at: isoDate(scan.processing_started_at),
    processing_completed_at: isoDate(scan.processing_completed_at),
    processing_error_code: scan.processing_error_code ?? null,
    processing_status: scan.processing_status ?? (scan.status === "failed" ? "failed" : ["ready_to_share", "ready_for_review", "verified"].includes(scan.status) ? "completed" : scan.status === "processing" ? "processing" : "queued"),
    processing_progress: scan.processing_progress === undefined || scan.processing_progress === null ? 0 : Number(scan.processing_progress),
    processing_progress_reported: Boolean(scan.processing_progress_reported),
    processing_error: (scan.processing_error || scan.failure_reason)
      ? safeProcessingErrorMessage(scan.processing_error ?? scan.failure_reason)
      : null,
    failure_reason: scan.failure_reason ? safeProcessingErrorMessage(scan.failure_reason) : null,
    created_at: isoDate(scan.created_at),
    updated_at: isoDate(scan.updated_at),
  };
}

function assetResponse(asset, signedUrl = null) {
  const result = {
    id: asset.id,
    scan_id: asset.scan_id,
    asset_type: asset.asset_type,
    storage_path: asset.storage_path,
    metadata: jsonValue(asset.metadata),
    quality_status: asset.quality_status,
    created_at: isoDate(asset.created_at),
  };
  if (signedUrl !== null) result.signedUrl = signedUrl;
  return result;
}

function bodyModelResponse(model) {
  return {
    id: model.id,
    scan_id: model.scan_id,
    provider: model.provider,
    model_url_or_path: model.model_url_or_path,
    preview_data: jsonValue(model.preview_data),
    status: model.status,
    created_at: isoDate(model.created_at),
  };
}

function measurementResponse(measurement) {
  return {
    id: measurement.id,
    scan_id: measurement.scan_id,
    key: measurement.key,
    value: Number(measurement.value),
    unit: measurement.unit,
    confidence: measurement.confidence === null ? null : Number(measurement.confidence),
    method: measurement.measurement_method ?? null,
    source: measurement.measurement_source ?? null,
    ai_value: measurement.ai_value === null ? null : Number(measurement.ai_value),
    adjusted_value: measurement.adjusted_value === null ? null : Number(measurement.adjusted_value),
    adjusted_by: measurement.adjusted_by,
    adjustment_reason: measurement.adjustment_reason,
    verified_at: isoDate(measurement.verified_at),
    created_at: isoDate(measurement.created_at),
    updated_at: isoDate(measurement.updated_at),
  };
}

function orderResponse(order) {
  return {
    id: order.id,
    customer_id: order.customer_id,
    organization_id: order.organization_id,
    dressmaker_id: order.dressmaker_id,
    scan_id: order.scan_id,
    status: order.status,
    garment_type: order.garment_type,
    due_date: dateOnly(order.due_date),
    notes: order.notes,
    created_at: isoDate(order.created_at),
    updated_at: isoDate(order.updated_at),
  };
}

function fittingResponse(fitting) {
  return {
    id: fitting.id,
    order_id: fitting.order_id,
    starts_at: isoDate(fitting.starts_at),
    location: fitting.location,
    status: fitting.status,
    notes: fitting.notes,
    created_at: isoDate(fitting.created_at),
  };
}

function invitationResponse(invitation) {
  return {
    id: invitation.id,
    organization_id: invitation.organization_id,
    email: invitation.email,
    invited_role: invitation.invited_role,
    token_hash: invitation.token_hash,
    expires_at: isoDate(invitation.expires_at),
    accepted_at: isoDate(invitation.accepted_at),
    revoked_at: isoDate(invitation.revoked_at),
    invited_by: invitation.invited_by,
    email_delivery_status: invitation.email_delivery_status ?? null,
    created_at: isoDate(invitation.created_at),
  };
}

function notificationResponse(notification) {
  return {
    id: notification.id,
    user_id: notification.user_id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    read_at: isoDate(notification.read_at),
    metadata: jsonValue(notification.metadata),
    created_at: isoDate(notification.created_at),
  };
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      return [key, decodeURIComponent(value)];
    } catch {
      return [key, value];
    }
  }).filter(([key]) => key));
}

function setSessionCookie(res, token) {
  const attributes = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${config.cookieSameSite}`,
    `Max-Age=${config.sessionHours * 60 * 60}`,
  ];
  if (config.cookieSecure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function clearSessionCookie(res) {
  const attributes = [`${sessionCookieName}=`, "Path=/", "HttpOnly", `SameSite=${config.cookieSameSite}`, "Max-Age=0"];
  if (config.cookieSecure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

async function userBySessionToken(token) {
  if (!token) return null;
  return row(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() LIMIT 1",
    [hashToken(token)],
  );
}

async function currentUser(req) {
  if (Object.prototype.hasOwnProperty.call(req, "nodeUser")) return req.nodeUser;
  const token = parseCookies(req.headers.cookie ?? "")[sessionCookieName] ?? "";
  req.nodeUser = await userBySessionToken(token);
  return req.nodeUser;
}

async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw new ApiError("Sign in is required for this action.", 401);
  return user;
}

async function requireAdmin(req) {
  const user = await requireUser(req);
  if (user.role !== "admin") throw new ApiError("Administrator access is required.", 403);
  return user;
}

function requireOrganizationStaff(user, organizationId) {
  if (user.role === "admin") return;
  if (!organizationId || user.role !== "dressmaker" || user.organization_id !== organizationId) {
    throw new ApiError("You do not have access to this organization.", 403);
  }
}

async function createSession(res, userId) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + config.sessionHours * 60 * 60 * 1000);
  await execute(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    [hashToken(token), userId, mysqlDateTime(expires)],
  );
  setSessionCookie(res, token);
  return token;
}

async function findScan(scanId) {
  return row("SELECT * FROM scans WHERE id = ? LIMIT 1", [scanId]);
}

async function requireScan(scanId, user) {
  const scan = await findScan(scanId);
  if (!scan) throw new ApiError("Scan not found.", 404);
  const allowed = scan.customer_id === user.id
    || user.role === "admin"
    || (user.role === "dressmaker" && scan.organization_id !== null && scan.organization_id === user.organization_id && ["ready_for_review", "verified", "needs_recapture"].includes(scan.status));
  if (!allowed) throw new ApiError("You do not have access to this scan.", 403);
  return scan;
}

function requestOrigin(req) {
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const protocol = forwarded || (config.cookieSecure ? "https" : "http");
  return `${protocol}://${req.headers.host ?? `127.0.0.1:${config.port}`}`;
}

function invitationRedirectUrl(req, value) {
  let redirect;
  try {
    redirect = new URL(value || `${canonicalAppUrl}/`, requestOrigin(req));
  } catch {
    throw new ApiError("The invitation redirect URL is invalid.", 400);
  }
  const localOrigin = /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/i.test(redirect.origin);
  if (localOrigin) {
    redirect = new URL(`${redirect.pathname}${redirect.search}${redirect.hash}`, `${canonicalAppUrl}/`);
  }
  const configuredOrigin = config.notifications.publicAppUrl ? new URL(config.notifications.publicAppUrl).origin : null;
  const allowed = new Set([canonicalAppUrl, requestOrigin(req), configuredOrigin, ...config.allowedOrigins].filter(Boolean));
  if (!['http:', 'https:'].includes(redirect.protocol) || !allowed.has(redirect.origin)) {
    throw new ApiError("The invitation redirect URL is not an allowed application origin.", 400);
  }
  return redirect;
}

function apiUrl(req, action, parameters = {}) {
  const url = new URL("/api", requestOrigin(req));
  url.searchParams.set("action", action);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.toString();
}

function publicAssetUrl(req, assetPath) {
  return new URL(`/${String(assetPath).replace(/^\/+/, "")}`, requestOrigin(req)).toString();
}

function normalizedStoragePath(value) {
  const relative = String(value ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!relative || /[\u0000-\u001f\u007f]/.test(relative) || relative.split("/").some((part) => !part || part === "." || part === "..")) throw new ApiError("Invalid storage path.", 400);
  return relative;
}

function scanProcessingResponse(scan) {
  const response = scanResponse(scan);
  return {
    scan_id: response.id,
    status: response.processing_status,
    progress: response.processing_progress,
    progress_reported: response.processing_progress_reported,
    processing_attempt_id: response.processing_attempt_id,
    error_code: response.processing_error_code,
    error: response.processing_error,
    updated_at: response.updated_at,
  };
}

async function storageDirectory(relativePath) {
  const relative = normalizedStoragePath(relativePath);
  const root = path.resolve(config.storageDirectory);
  const directory = path.resolve(root, relative);
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new ApiError("Invalid storage directory.", 400);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

async function storageFile(relativePath) {
  const relative = normalizedStoragePath(relativePath);
  const root = path.resolve(config.storageDirectory);
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new ApiError("Invalid storage path.", 400);
  try {
    await fs.access(file);
  } catch {
    throw new ApiError("Stored asset was not found.", 404);
  }
  return file;
}

async function serveAsset(req, res) {
  const user = await requireUser(req);
  const assetPath = normalizedStoragePath(stringInput(req.query ?? {}, "path", "") ?? "");
  let scanId = null;
  const asset = await row(
    "SELECT a.*, s.customer_id, s.organization_id FROM scan_assets a JOIN scans s ON s.id = a.scan_id WHERE a.storage_path = ? LIMIT 1",
    [assetPath],
  );
  if (asset) {
    scanId = asset.scan_id;
  } else {
    const model = await row(
      "SELECT bm.*, s.customer_id, s.organization_id FROM body_models bm JOIN scans s ON s.id = bm.scan_id WHERE bm.model_url_or_path = ? LIMIT 1",
      [assetPath],
    );
    if (!model) throw new ApiError("Stored asset was not found.", 404);
    scanId = model.scan_id;
  }
  await requireScan(scanId, user);
  const file = await storageFile(assetPath);
  const extension = path.extname(file).toLowerCase();
  const contentTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
  };
  res.setHeader("Content-Type", contentTypes[extension] ?? "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(file).replaceAll('"', "")}"`);
  res.sendFile(file);
}

async function emitScanUpdate(scanId, status, message) {
  if (!io) return;
  const scan = await findScan(scanId);
  io.to(`scan:${scanId}`).emit("scan:status", {
    scanId,
    status,
    message,
    updatedAt: isoDate(scan?.updated_at) ?? new Date().toISOString(),
  });
}

async function processScanJob(scanId) {
  const aiEnabled = isAiProviderEnabled();
  const processingProvider = aiEnabled ? config.reconstruction.provider : null;
  let attemptId = null;
  try {
    const scan = await findScan(scanId);
    if (!scan) return;
    const assets = await rows("SELECT * FROM scan_assets WHERE scan_id = ?", [scanId]);
    const types = new Set(assets.map((asset) => asset.asset_type));
    await execute(
      "UPDATE scans SET processing_status = ?, processing_progress = ?, processing_progress_reported = ?, processing_error_code = NULL, processing_error = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status NOT IN ('ready_to_share', 'ready_for_review', 'verified')",
      ["validating", 0, 0, scanId],
    );
    if (["front", "side"].some((required) => !types.has(required))) {
      const result = await execute(
        "UPDATE scans SET status = ?, processing_status = ?, processing_progress = ?, processing_progress_reported = ?, failure_reason = ?, processing_error_code = ?, processing_error = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status NOT IN ('ready_to_share', 'ready_for_review', 'verified')",
        ["failed", "failed", 0, 0, "Front and side views are required.", "missing_assets", "Front and side views are required.", scanId],
      );
      if (result.affectedRows > 0) await emitScanUpdate(scanId, "failed", "Front and side views are required.");
      return;
    }

    if (!aiEnabled) throw new ApiError("No reconstruction provider is configured. This scan cannot be completed from reference measurements.", 503);

    const claim = await execute(
      "UPDATE scans SET status = ?, processing_status = ?, processing_progress = ?, processing_progress_reported = ?, processing_provider = ?, processing_attempt_id = NULL, processing_attempts = COALESCE(processing_attempts, 0) + 1, processing_started_at = UTC_TIMESTAMP(), processing_completed_at = NULL, processing_error_code = NULL, processing_error = NULL, failure_reason = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status IN ('uploaded', 'processing_queued', 'failed', 'draft', 'needs_recapture', 'processing')",
      ["processing", "processing", 0, 0, processingProvider, scanId],
    );
    if (claim.affectedRows === 0) {
      const current = await findScan(scanId);
      if (!current || current.status !== "processing") return;
    }
    await emitScanUpdate(scanId, "processing", "Processing has started. Your uploaded views are being checked.");
    const current = await findScan(scanId);
    if (!current || current.status !== "processing") return;

    const attempt = await claimScanAttempt({
      scanId,
      attemptNumber: Math.max(1, Number(current.processing_attempts ?? 1)),
      provider: processingProvider,
      processingVersion: null,
    });
    attemptId = attempt?.id ?? null;

    if (aiEnabled) {
      let lastProviderProgress = current.processing_progress_reported ? Number(current.processing_progress ?? 0) : null;
      let lastProviderProgressReported = Boolean(current.processing_progress_reported);
      let lastProviderStatus = "processing";
      let lastProviderMessage = "";
      const reportProviderProgress = async ({ status, progress, message }) => {
        const hasProgress = progress !== null && Number.isFinite(progress);
        const receivedProgress = hasProgress ? Math.min(99, Math.max(0, progress)) : null;
        const regressed = receivedProgress !== null && lastProviderProgress !== null && receivedProgress < lastProviderProgress;
        const nextProgress = receivedProgress === null ? lastProviderProgress : Math.max(lastProviderProgress ?? 0, receivedProgress);
        const nextProgressReported = lastProviderProgressReported || receivedProgress !== null;
        const nextStatus = regressed ? lastProviderStatus : status;
        const nextMessage = regressed ? "" : (message ?? "");
        if (nextProgress === lastProviderProgress && nextProgressReported === lastProviderProgressReported && nextStatus === lastProviderStatus && nextMessage === lastProviderMessage) return;
        lastProviderProgress = nextProgress;
        lastProviderProgressReported = nextProgressReported;
        lastProviderStatus = nextStatus;
        lastProviderMessage = nextMessage;
        try {
          const update = await execute(
            "UPDATE scans SET processing_status = ?, processing_progress = COALESCE(?, processing_progress), processing_progress_reported = ?, processing_error = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'processing' AND processing_attempt_id = ?",
            [nextStatus, nextProgress, nextProgressReported ? 1 : 0, scanId, attemptId],
          );
          if (update.affectedRows > 0 && nextMessage) await emitScanUpdate(scanId, nextStatus, nextMessage);
        } catch (progressError) {
          // Progress is an observability enhancement; a transient status-write
          // failure must not turn a valid provider result into a failed scan.
          console.error(`Could not persist provider progress for ${scanId}:`, progressError);
        }
      };
      const providerResult = await processWithAiService(current, assets, { onProgress: reportProviderProgress, attemptId });
      if (!providerResult) throw new ApiError("The reconstruction provider is not configured.", 503);
      await reportProviderProgress({ status: "processing", progress: 98, message: "Saving measurements and the private body model." });
      const previewData = {
        kind: "provider-glb",
        source: "configured reconstruction provider",
        provider: processingProvider,
        processing_attempt_id: attemptId,
        scan_quality: providerResult.quality,
        quality_issues: providerResult.qualityIssues,
        reconstruction: providerResult.reconstruction,
        measurement_provenance: providerResult.measurements.map((measurement) => ({
          key: measurement.key,
          method: measurement.method,
          source: measurement.source,
        })),
      };
      await stageScanAttempt(attemptId, {
        measurements: providerResult.measurements,
        modelPath: providerResult.modelPath,
        quality: providerResult.quality,
        qualityIssues: providerResult.qualityIssues,
        reconstruction: providerResult.reconstruction,
        processingVersion: providerResult.processingVersion,
      });
      await transaction(async (connection) => {
        // Replace the complete promoted set in one transaction. Upserting
        // alone leaves measurements from an older provider result behind
        // when the new provider returns a smaller or different key set.
        await connection.query("DELETE FROM measurements WHERE scan_id = ?", [scanId]);
        await connection.query("DELETE FROM body_models WHERE scan_id = ?", [scanId]);
        for (const measurement of providerResult.measurements) {
          await connection.query(
            "INSERT INTO measurements (id, scan_id, `key`, value, unit, confidence, measurement_method, measurement_source, ai_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), unit = VALUES(unit), confidence = VALUES(confidence), measurement_method = VALUES(measurement_method), measurement_source = VALUES(measurement_source), ai_value = VALUES(ai_value), updated_at = UTC_TIMESTAMP()",
            [randomUUID(), scanId, measurement.key, measurement.value, "cm", measurement.confidence, measurement.method?.slice(0, 40) ?? null, measurement.source?.slice(0, 120) ?? null, measurement.ai_value ?? measurement.value],
          );
        }
        await connection.query(
          "INSERT INTO body_models (id, scan_id, provider, model_url_or_path, preview_data, status) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE provider = VALUES(provider), model_url_or_path = VALUES(model_url_or_path), preview_data = VALUES(preview_data), status = VALUES(status)",
          [randomUUID(), scanId, processingProvider, providerResult.modelPath, jsonParameter(previewData), "ready"],
        );
        const finalUpdate = await connection.query(
          "UPDATE scans SET status = ?, processing_status = ?, processing_progress = ?, processing_progress_reported = ?, processing_provider = ?, processing_version = ?, processing_attempt_id = ?, processing_completed_at = UTC_TIMESTAMP(), processing_error_code = NULL, processing_error = NULL, failure_reason = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'processing' AND processing_attempt_id = ?",
          ["ready_to_share", "completed", 100, 1, processingProvider, providerResult.processingVersion, attemptId, scanId, attemptId],
        );
        if (finalUpdate.affectedRows === 0) throw new ApiError("The scan changed while it was being processed.", 409);
        await promoteScanAttempt(connection, attemptId);
      });
      await emitScanUpdate(scanId, "ready_to_share", "Your measurement result is ready. Review it before sharing it with your dressmaker.");
      return;
    }

  } catch (error) {
    const failureMessage = safeProcessingErrorMessage(error instanceof Error ? error.message : "The reconstruction provider could not complete this scan.");
    console.error(`Scan processing failed for ${scanId}:`, failureMessage);
    try {
      const latest = await findScan(scanId);
      const failureProgress = Math.min(99, Math.max(0, Number(latest?.processing_progress ?? 0)));
      const failureWhere = attemptId
        ? "id = ? AND status NOT IN ('ready_to_share', 'ready_for_review', 'verified') AND processing_attempt_id = ?"
        : "id = ? AND status NOT IN ('ready_to_share', 'ready_for_review', 'verified')";
      const failureParams = ["failed", "failed", failureProgress, failureMessage.slice(0, 1000), aiEnabled ? "provider_failed" : "provider_not_configured", failureMessage.slice(0, 1000), scanId];
      if (attemptId) failureParams.push(attemptId);
      const result = await execute(
        `UPDATE scans SET status = ?, processing_status = ?, processing_progress = ?, failure_reason = ?, processing_error_code = ?, processing_error = ?, updated_at = UTC_TIMESTAMP() WHERE ${failureWhere}`,
        failureParams,
      );
      try {
        await failScanAttempt(attemptId, aiEnabled ? "provider_failed" : "provider_not_configured", failureMessage);
      } catch (attemptError) {
        console.error("Could not persist scan attempt failure:", attemptError);
      }
      if (result.affectedRows > 0) await emitScanUpdate(scanId, "failed", failureMessage.slice(0, 1000));
    } catch (updateError) {
      console.error("Could not persist scan processing failure:", updateError);
    }
  }
}

function queueScanProcessing(scanId) {
  if (processingJobs.has(scanId)) return false;
  // MariaDB can deadlock when two provider retries delete/replace child rows
  // in parallel. Serialize the short database commit phase by running scan
  // jobs through one queue while still keeping the caller asynchronous.
  const job = processingQueue
    .then(() => processScanJob(scanId))
    .finally(() => processingJobs.delete(scanId));
  processingJobs.set(scanId, job);
  processingQueue = job.catch(() => undefined);
  void job;
  return true;
}

async function resumePendingScans() {
  const queued = await rows(
    "SELECT id FROM scans WHERE status = 'processing_queued' OR (status = 'processing' AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)) ORDER BY updated_at ASC LIMIT 20",
  );
  const resumed = queued.filter((scan) => queueScanProcessing(scan.id)).length;
  if (resumed > 0) console.log(`Resumed ${resumed} pending scan${resumed === 1 ? "" : "s"}.`);
}

function isDuplicateError(error) {
  return Boolean(error && (error.errno === 1062 || error.code === "ER_DUP_ENTRY"));
}

function isAllowedOrderTransition(currentStatus, nextStatus) {
  return currentStatus === nextStatus || orderTransitions[currentStatus]?.includes(nextStatus) === true;
}

async function handleAction(req, res) {
  const action = stringInput(req.query ?? {}, "action", "") ?? "";
  if (req.method !== "POST" && !getActions.has(action)) throw new ApiError("Use POST for this action.", 405);
  const data = requestData(req);

  // Throttle authentication actions per client IP to block brute-force and
  // account-enumeration bursts before any credential work runs.
  if (rateLimitedActions.has(action)) {
    const { limited, retryAfterSeconds } = rateLimitHit(`${action}:${clientIp(req)}`);
    if (limited) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      throw new ApiError("Too many attempts. Please wait a few minutes and try again.", 429);
    }
  }

  switch (action) {
    case "health":
      await execute("SELECT 1");
      return sendData(res, { backend: "node", database: "mariadb", realtime: "socket.io" });

    case "scan_processing_status": {
      const user = await requireUser(req);
      const scan = await requireScan(stringInput(data, "scan_id", "") ?? "", user);
      return sendData(res, scanProcessingResponse(scan));
    }

    case "session": {
      const user = await currentUser(req);
      return sendData(res, user ? sessionPayload(user) : null);
    }

    case "sign_in": {
      const email = (stringInput(data, "email", "") ?? "").toLowerCase();
      const password = stringInput(data, "password", "") ?? "";
      const user = await row("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
      // Always run a bcrypt comparison, even when the account does not exist, so
      // the response time does not reveal whether an email is registered.
      const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? dummyPasswordHash);
      if (!user || !passwordMatches) throw new ApiError("The email or password is incorrect.", 401);
      // Unverified accounts cannot sign in: issue a fresh OTP and route the
      // client to the verification screen instead of minting a session.
      if (!user.email_verified) {
        const code = await issueOtp(user.id);
        const send = await sendOtpEmail(user, code);
        return sendData(res, { session: null, user: publicUser(user), verification: otpVerificationPayload(user.email, send, code) });
      }
      await createSession(res, user.id);
      return sendData(res, { session: sessionPayload(user), user: publicUser(user) });
    }

    case "sign_up": {
      const firstName = stringInput(data, "first_name", "") ?? "";
      const lastName = stringInput(data, "last_name", "") ?? "";
      const email = (stringInput(data, "email", "") ?? "").toLowerCase();
      const password = stringInput(data, "password", "") ?? "";
      if (!firstName || !lastName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError("Enter a valid name and email address.", 400);
      if (password.length < 8) throw new ApiError("Use a password with at least 8 characters.", 400);
      const id = randomUUID();
      const organizationId = await activeOrganizationId();
      try {
        await execute(
          "INSERT INTO users (id, role, organization_id, first_name, last_name, email, password_hash, unit_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [id, "customer", organizationId, firstName.slice(0, 80), lastName.slice(0, 80), email, await bcrypt.hash(password, 12), "cm"],
        );
      } catch (error) {
        if (isDuplicateError(error)) throw new ApiError("An account with that email already exists.", 409);
        throw error;
      }
      const user = await row("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
      // Do not sign the account in yet. Issue a one-time code and require the
      // user to verify their email before a session is minted.
      const code = await issueOtp(id);
      const send = await sendOtpEmail(user, code);
      return sendData(res, { session: null, user: publicUser(user), verification: otpVerificationPayload(email, send, code) });
    }

    case "verify_otp": {
      const email = (stringInput(data, "email", "") ?? "").toLowerCase();
      const code = (stringInput(data, "code", "") ?? "").trim();
      // Reject empty input before touching state so a blank submission does not
      // consume one of the 5 lockout attempts (matches the PHP mirror).
      if (!email || !code) throw new ApiError("Enter your email and verification code.", 400);
      const fresh = await row(
        "SELECT id, otp_hash, otp_attempts, (otp_expires_at > UTC_TIMESTAMP()) AS not_expired FROM users WHERE email = ? LIMIT 1",
        [email],
      );
      if (!fresh || !fresh.otp_hash) throw new ApiError("Request a new verification code.", 400);
      if (!fresh.not_expired) {
        await execute("UPDATE users SET otp_hash = NULL, otp_expires_at = NULL WHERE id = ?", [fresh.id]);
        throw new ApiError("That code has expired. Request a new one.", 400);
      }
      if (fresh.otp_attempts >= 5) throw new ApiError("Too many incorrect attempts. Request a new code.", 429);
      if (hashToken(code) !== fresh.otp_hash) {
        await execute("UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?", [fresh.id]);
        throw new ApiError("That code is incorrect.", 400);
      }
      await execute(
        "UPDATE users SET email_verified = 1, verified_at = UTC_TIMESTAMP(), otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?",
        [fresh.id],
      );
      const user = await row("SELECT * FROM users WHERE id = ? LIMIT 1", [fresh.id]);
      await createSession(res, fresh.id);
      return sendData(res, { session: sessionPayload(user), user: publicUser(user) });
    }

    case "resend_otp": {
      const email = (stringInput(data, "email", "") ?? "").toLowerCase();
      const candidate = await row(
        "SELECT id, email_verified, (otp_last_sent_at IS NULL OR otp_last_sent_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 SECOND)) AS can_send FROM users WHERE email = ? LIMIT 1",
        [email],
      );
      // Anti-enumeration: the response must NOT reveal whether the account
      // exists, is already verified, or is in cooldown. Re-issue only when the
      // account exists, is unverified, and the cooldown passed, but always
      // return the SAME fixed shape ("delivery: accepted") regardless. The only
      // extra field is dev_code, which is already hard-gated to a non-production
      // build with an unconfigured mailer, where the code is shown on screen by
      // design and enumeration is not a concern.
      const response = { ok: true, verification: { email, expires_in_seconds: 600, delivery: "accepted" } };
      if (candidate && !candidate.email_verified && candidate.can_send) {
        const user = await row("SELECT * FROM users WHERE id = ? LIMIT 1", [candidate.id]);
        const code = await issueOtp(user.id);
        const send = await sendOtpEmail(user, code);
        if (devCodeAllowed(send)) response.verification.dev_code = code;
      }
      return sendData(res, response);
    }

    case "sign_out": {
      const token = parseCookies(req.headers.cookie ?? "")[sessionCookieName] ?? "";
      if (token) await execute("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
      clearSessionCookie(res);
      return sendData(res, true);
    }

    case "profile":
      return sendData(res, profileResponse(await requireUser(req)));

    case "profile_update": {
      const user = await requireUser(req);
      const firstName = stringInput(data, "first_name", user.first_name) ?? user.first_name;
      const lastName = stringInput(data, "last_name", user.last_name) ?? user.last_name;
      const unit = stringInput(data, "unit_system", user.unit_system) ?? user.unit_system;
      const phone = normalizePhone(stringInput(data, "phone", user.phone ?? ""));
      const emailNotifications = data.email_notifications === undefined ? booleanInput(user.email_notifications ?? true) : booleanInput(data.email_notifications);
      const smsNotifications = data.sms_notifications === undefined ? booleanInput(user.sms_notifications ?? false) : booleanInput(data.sms_notifications);
      if (!firstName || !lastName || !["cm", "ftin"].includes(unit)) throw new ApiError("Profile values are invalid.", 400);
      if (smsNotifications && !phone) throw new ApiError("Add a phone number before enabling text notifications.", 400);
      await execute("UPDATE users SET first_name = ?, last_name = ?, phone = ?, email_notifications = ?, sms_notifications = ?, unit_system = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [firstName.slice(0, 80), lastName.slice(0, 80), phone, emailNotifications ? 1 : 0, smsNotifications ? 1 : 0, unit, user.id]);
      return sendData(res, profileResponse(await row("SELECT * FROM users WHERE id = ? LIMIT 1", [user.id])));
    }

    case "password_reset_request": {
      const email = (stringInput(data, "email", "") ?? "").toLowerCase();
      const candidate = await row(
        "SELECT id, (reset_last_sent_at IS NULL OR reset_last_sent_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 SECOND)) AS can_send FROM users WHERE email = ? LIMIT 1",
        [email],
      );
      // Anti-enumeration: always return the same fixed shape whether or not the
      // account exists or is in cooldown. A code is issued + emailed only for a
      // real account past its 45s cooldown. dev_code is hard-gated to a
      // non-production build with an unconfigured mailer (where the reset code is
      // shown on screen by design, so enumeration is moot).
      const response = { ok: true, verification: { email, expires_in_seconds: 600, delivery: "accepted" } };
      if (candidate && candidate.can_send) {
        const user = await row("SELECT * FROM users WHERE id = ? LIMIT 1", [candidate.id]);
        const code = await issueResetCode(user.id);
        const send = await sendResetEmail(user, code);
        if (devCodeAllowed(send)) response.verification.dev_code = code;
      }
      return sendData(res, response);
    }

    case "password_reset_confirm": {
      const email = (stringInput(data, "email", "") ?? "").toLowerCase();
      const code = (stringInput(data, "code", "") ?? "").trim();
      const password = stringInput(data, "password", "") ?? "";
      // Reject empty code/email before touching state so a blank submission does
      // not consume a lockout attempt (matches verify_otp and the PHP mirror).
      if (!email || !code) throw new ApiError("Enter your email and reset code.", 400);
      if (password.length < 8) throw new ApiError("Use a password with at least 8 characters.", 400);
      const fresh = await row(
        "SELECT id, reset_token_hash, reset_attempts, (reset_expires_at > UTC_TIMESTAMP()) AS not_expired FROM users WHERE email = ? LIMIT 1",
        [email],
      );
      if (!fresh || !fresh.reset_token_hash) throw new ApiError("Request a new reset code.", 400);
      if (!fresh.not_expired) {
        await execute("UPDATE users SET reset_token_hash = NULL, reset_expires_at = NULL WHERE id = ?", [fresh.id]);
        throw new ApiError("That code has expired. Request a new one.", 400);
      }
      if (fresh.reset_attempts >= 5) throw new ApiError("Too many incorrect attempts. Request a new code.", 429);
      if (hashToken(code) !== fresh.reset_token_hash) {
        await execute("UPDATE users SET reset_attempts = reset_attempts + 1 WHERE id = ?", [fresh.id]);
        throw new ApiError("That code is incorrect.", 400);
      }
      // Correct code: set the new password, clear the reset state, and — since a
      // verified reset code proves control of the mailbox — also mark the email
      // verified so a never-verified account is not left unable to sign in.
      await execute(
        "UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires_at = NULL, reset_attempts = 0, reset_last_sent_at = NULL, email_verified = 1, verified_at = COALESCE(verified_at, UTC_TIMESTAMP()), otp_hash = NULL, otp_expires_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?",
        [await bcrypt.hash(password, 12), fresh.id],
      );
      // Invalidate every existing session for this account, then mint a fresh one
      // so a reset both signs the user in and logs out any other device.
      await execute("DELETE FROM sessions WHERE user_id = ?", [fresh.id]);
      const user = await row("SELECT * FROM users WHERE id = ? LIMIT 1", [fresh.id]);
      await createSession(res, fresh.id);
      return sendData(res, { session: sessionPayload(user), user: publicUser(user) });
    }

    case "password_update": {
      // Session-based password change (used by the dressmaker invitation
      // acceptance flow, where the invitee is already signed in). The
      // forgot-password path is password_reset_request + password_reset_confirm.
      const user = await requireUser(req);
      const password = stringInput(data, "password", "") ?? "";
      if (password.length < 8) throw new ApiError("Use a password with at least 8 characters.", 400);
      await execute("UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?", [await bcrypt.hash(password, 12), user.id]);
      return sendData(res, publicUser(await row("SELECT * FROM users WHERE id = ? LIMIT 1", [user.id])));
    }

    case "assign_profile_organization": {
      await requireAdmin(req);
      const profileId = stringInput(data, "profile_id", "") ?? "";
      let organizationId = stringInput(data, "organization_id");
      if (!profileId) throw new ApiError("profile_id is required.", 400);
      if (organizationId) {
        if (!await row("SELECT id FROM organizations WHERE id = ? LIMIT 1", [organizationId])) throw new ApiError("Organization not found.", 404);
      } else {
        organizationId = null;
      }
      await execute("UPDATE users SET organization_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [organizationId, profileId]);
      const profile = await row("SELECT * FROM users WHERE id = ? LIMIT 1", [profileId]);
      if (!profile) throw new ApiError("Profile not found.", 404);
      return sendData(res, profileResponse(profile));
    }

    case "notifications": {
      const user = await requireUser(req);
      const notifications = await rows("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20", [user.id]);
      return sendData(res, notifications.map(notificationResponse));
    }

    case "mark_notification_read": {
      const user = await requireUser(req);
      const notificationId = stringInput(data, "notification_id", "") ?? "";
      await execute("UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?", [notificationId, user.id]);
      return sendData(res, true);
    }

    case "organizations": {
      const user = await requireUser(req);
      const organizations = user.role === "admin"
        ? await rows("SELECT * FROM organizations ORDER BY name")
        : await rows("SELECT * FROM organizations WHERE owner_id = ? OR id = ? ORDER BY name", [user.id, user.organization_id]);
      return sendData(res, organizations.map(organizationResponse));
    }

    case "invitations": {
      await requireAdmin(req);
      return sendData(res, (await rows("SELECT i.*, d.status AS email_delivery_status FROM dressmaker_invitations i LEFT JOIN notification_deliveries d ON d.event_key = CONCAT('invitation:', i.id) AND d.channel = 'email' ORDER BY i.created_at DESC")).map(invitationResponse));
    }

    case "revoke_dressmaker_invitation": {
      await requireAdmin(req);
      const invitationId = stringInput(data, "invitation_id", "") ?? "";
      if (!isUuid(invitationId)) throw new ApiError("A valid invitation ID is required.", 400);
      const invitation = await row("SELECT id, accepted_at, revoked_at, expires_at, (expires_at <= UTC_TIMESTAMP()) AS is_expired FROM dressmaker_invitations WHERE id = ? LIMIT 1", [invitationId]);
      if (!invitation) throw new ApiError("Invitation not found.", 404);
      if (invitation.accepted_at) throw new ApiError("Accepted invitations cannot be removed.", 409);
      const remove = await execute("DELETE FROM dressmaker_invitations WHERE id = ? AND accepted_at IS NULL", [invitationId]);
      if (remove.affectedRows === 0) {
        const current = await row("SELECT accepted_at FROM dressmaker_invitations WHERE id = ? LIMIT 1", [invitationId]);
        if (current?.accepted_at) throw new ApiError("Accepted invitations cannot be removed.", 409);
        if (!current) return sendData(res, { removed: true, already_removed: true });
        throw new ApiError("The invitation could not be removed. Please try again.", 409);
      }
      return sendData(res, { removed: true });
    }

    case "invite_dressmaker": {
      const user = await requireAdmin(req);
      const email = (stringInput(data, "email", "") ?? "").toLowerCase();
      const organizationId = stringInput(data, "organization_id", "") ?? "";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !organizationId) throw new ApiError("Enter a valid email and organization.", 400);
      const organization = await row("SELECT id, name FROM organizations WHERE id = ? LIMIT 1", [organizationId]);
      if (!organization) throw new ApiError("Organization not found.", 404);
      const redirect = stringInput(data, "redirect_to", "") ?? "";
      const inviteUrl = invitationRedirectUrl(req, redirect);
      const token = randomBytes(24).toString("hex");
      const invitationId = randomUUID();
      await execute("INSERT INTO dressmaker_invitations (id, organization_id, email, invited_role, token_hash, expires_at, invited_by) VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY), ?)", [invitationId, organizationId, email, "dressmaker", hashToken(token), user.id]);
      inviteUrl.searchParams.set("invite", token);
      const delivery = await dispatchInvitationEmail({ invitationId, invitedBy: user.id, email, organizationName: organization.name, inviteUrl: inviteUrl.toString() });
      return sendData(res, { invitation_id: invitationId, invite_url: inviteUrl.toString(), email_status: delivery.status, email_provider: delivery.provider, email_error: delivery.error });
    }

    case "accept_dressmaker_invitation": {
      const user = await requireUser(req);
      const token = stringInput(data, "token", "") ?? "";
      const firstName = stringInput(data, "first_name", user.first_name) ?? user.first_name;
      const lastName = stringInput(data, "last_name", user.last_name) ?? user.last_name;
      if (!token || !firstName || !lastName) throw new ApiError("Invitation token and name are required.", 400);
      await transaction(async (connection) => {
        const invitations = await connection.query("SELECT * FROM dressmaker_invitations WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE", [hashToken(token)]);
        const invitation = invitations[0] ?? null;
        if (!invitation) throw new ApiError("This invitation is invalid, expired, or already accepted.", 400);
        if (String(user.email).toLowerCase() !== String(invitation.email).toLowerCase()) throw new ApiError("Sign in with the email address that received this invitation.", 403);
        if (user.role !== "customer" && !(user.role === "dressmaker" && user.organization_id === invitation.organization_id)) {
          throw new ApiError("This account cannot accept a dressmaker invitation.", 403);
        }
        await connection.query("UPDATE users SET role = ?, organization_id = ?, first_name = ?, last_name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", ["dressmaker", invitation.organization_id, firstName.slice(0, 80), lastName.slice(0, 80), user.id]);
        const accepted = await connection.query("UPDATE dressmaker_invitations SET accepted_at = UTC_TIMESTAMP() WHERE id = ? AND accepted_at IS NULL", [invitation.id]);
        if (accepted.affectedRows !== 1) throw new ApiError("This invitation is invalid, expired, or already accepted.", 400);
      });
      return sendData(res, { accepted: true });
    }

    case "create_scan": {
      const user = await requireUser(req);
      const heightValue = numberInput(data, "height_value");
      const heightUnit = stringInput(data, "height_unit", "cm") ?? "cm";
      const captureSource = stringInput(data, "capture_source", "upload") ?? "upload";
      if (!['cm', 'ftin'].includes(heightUnit) || !['camera', 'upload'].includes(captureSource)) throw new ApiError("Scan setup values are invalid.", 400);
      const id = randomUUID();
      await execute("INSERT INTO scans (id, customer_id, organization_id, status, height_value, height_unit, consent_at, capture_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, user.id, user.organization_id, "draft", heightValue, heightUnit, mysqlDateTime(stringInput(data, "consent_at")), captureSource]);
      return sendData(res, scanResponse(await findScan(id)));
    }

    case "update_scan": {
      const user = await requireUser(req);
      const scan = await requireScan(stringInput(data, "scan_id", "") ?? "", user);
      const isCustomer = scan.customer_id === user.id;
      if (!isCustomer) requireOrganizationStaff(user, scan.organization_id);
      const suppliedFields = Object.keys(data).filter((field) => field !== "scan_id");
      const allowedFields = isCustomer ? ["height_value", "height_unit", "sex", "status", "capture_source", "failure_reason"] : ["status"];
      if (suppliedFields.some((field) => !allowedFields.includes(field))) {
        throw new ApiError(isCustomer ? "The scan update contains unsupported fields." : "Dressmakers can only update the review status of a scan.", 403);
      }
      const fields = [];
      const values = [];
      if (Object.prototype.hasOwnProperty.call(data, "height_value")) {
        fields.push("height_value = ?");
        values.push(numberInput(data, "height_value"));
      }
      if (Object.prototype.hasOwnProperty.call(data, "height_unit")) {
        const value = stringInput(data, "height_unit");
        if (!['cm', 'ftin'].includes(value)) throw new ApiError("The height unit is invalid.", 400);
        fields.push("height_unit = ?"); values.push(value);
      }
      if (Object.prototype.hasOwnProperty.call(data, "sex")) {
        const value = stringInput(data, "sex");
        if (!['male', 'female', 'neutral'].includes(value)) throw new ApiError("The body type is invalid.", 400);
        fields.push("sex = ?"); values.push(value);
      }
      for (const field of ["status", "capture_source", "failure_reason"]) {
        if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
        const value = stringInput(data, field);
        if (field === "status" && !allowedScanStatuses.includes(value)) throw new ApiError("The scan status is invalid.", 400);
        if (field === "status" && isCustomer && value === "processing_queued" && scan.status === "processing") {
          throw new ApiError("This scan is already being processed. Wait for the current result or retry it from the processing screen.", 409);
        }
        if (field === "status" && isCustomer && value === "ready_for_review" && value !== scan.status && scan.status !== "ready_to_share") {
          throw new ApiError("This result can only be shared after processing is complete.", 403);
        }
        if (field === "status" && value !== scan.status && !(isCustomer ? customerScanStatuses : staffScanStatuses).includes(value)) {
          throw new ApiError(isCustomer ? "Customers cannot set a staff or provider status." : "Dressmakers can only verify or request recapture for a scan.", 403);
        }
        if (field === "capture_source" && !['camera', 'upload'].includes(value)) throw new ApiError("The capture source is invalid.", 400);
        fields.push(`${field} = ?`); values.push(value);
      }
      if (fields.length > 0) {
        values.push(scan.id);
        await execute(`UPDATE scans SET ${fields.join(", ")}, updated_at = UTC_TIMESTAMP() WHERE id = ?`, values);
        const next = await findScan(scan.id);
        if (next) await emitScanUpdate(scan.id, next.status, `Scan status updated to ${next.status}.`);
      }
      return sendData(res, scanResponse(await findScan(scan.id)));
    }

    case "scan_bundle": {
      const user = await requireUser(req);
      const scan = await requireScan(stringInput(data, "scan_id", "") ?? "", user);
      const assets = await rows("SELECT * FROM scan_assets WHERE scan_id = ? ORDER BY asset_type", [scan.id]);
      const includeUrls = booleanInput(data.include_signed_urls);
      const assetResults = assets.map((asset) => assetResponse(asset, includeUrls ? apiUrl(req, "asset", { path: asset.storage_path }) : null));
      const measurements = await rows("SELECT * FROM measurements WHERE scan_id = ? ORDER BY `key`", [scan.id]);
      const model = await row("SELECT * FROM body_models WHERE scan_id = ? LIMIT 1", [scan.id]);
      const attempt = scan.processing_attempt_id
        ? await row("SELECT * FROM scan_processing_attempts WHERE id = ? LIMIT 1", [scan.processing_attempt_id])
        : null;
      return sendData(res, {
        scan: scanResponse(scan),
        assets: assetResults,
        measurements: measurements.map(measurementResponse),
        bodyModel: model ? bodyModelResponse(model) : null,
        processingAttempt: scanAttemptResponse(attempt),
      });
    }

    case "customer_scans": {
      const user = await requireUser(req);
      return sendData(res, (await rows("SELECT * FROM scans WHERE customer_id = ? ORDER BY updated_at DESC", [user.id])).map(scanResponse));
    }

    case "customer_orders": {
      const user = await requireUser(req);
      return sendData(res, (await rows("SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC", [user.id])).map(orderResponse));
    }

    case "fittings_for_orders": {
      const user = await requireUser(req);
      const ids = Array.isArray(data.order_ids) ? data.order_ids.filter((value) => typeof value === "string") : [];
      if (ids.length === 0) return sendData(res, []);
      const placeholders = ids.map(() => "?").join(",");
      const fittings = await rows(`SELECT f.* FROM fittings f JOIN orders o ON o.id = f.order_id WHERE f.order_id IN (${placeholders}) AND (o.customer_id = ? OR o.organization_id = ? OR o.dressmaker_id = ?) ORDER BY f.starts_at`, [...ids, user.id, user.organization_id, user.id]);
      return sendData(res, fittings.map(fittingResponse));
    }

    case "org_customers":
    case "org_staff":
    case "org_scans":
    case "org_orders": {
      const user = await requireUser(req);
      const organizationId = stringInput(data, "organization_id", "") ?? "";
      requireOrganizationStaff(user, organizationId);
      if (action === "org_customers") return sendData(res, (await rows("SELECT * FROM users WHERE organization_id = ? AND role = 'customer' ORDER BY last_name, first_name", [organizationId])).map(profileResponse));
      if (action === "org_staff") return sendData(res, (await rows("SELECT * FROM users WHERE organization_id = ? AND role IN ('dressmaker', 'admin') ORDER BY last_name, first_name", [organizationId])).map(profileResponse));
      if (action === "org_scans") {
        const query = user.role === "admin"
          ? "SELECT * FROM scans WHERE organization_id = ? ORDER BY updated_at DESC"
          : "SELECT * FROM scans WHERE organization_id = ? AND status IN ('ready_for_review', 'verified', 'needs_recapture') ORDER BY updated_at DESC";
        return sendData(res, (await rows(query, [organizationId])).map(scanResponse));
      }
      return sendData(res, (await rows("SELECT * FROM orders WHERE organization_id = ? ORDER BY created_at DESC", [organizationId])).map(orderResponse));
    }

    case "admin_profiles": {
      await requireAdmin(req);
      const role = stringInput(data, "role");
      if (role && !['customer', 'dressmaker', 'admin'].includes(role)) throw new ApiError("The profile role is invalid.", 400);
      const profiles = role
        ? await rows("SELECT * FROM users WHERE role = ? ORDER BY last_name, first_name", [role])
        : await rows("SELECT * FROM users ORDER BY last_name, first_name");
      return sendData(res, profiles.map(profileResponse));
    }

    case "admin_scans":
      await requireAdmin(req);
      return sendData(res, (await rows("SELECT * FROM scans ORDER BY updated_at DESC")).map(scanResponse));

    case "admin_orders":
      await requireAdmin(req);
      return sendData(res, (await rows("SELECT * FROM orders ORDER BY created_at DESC")).map(orderResponse));

    case "update_measurement": {
      const user = await requireUser(req);
      const measurementId = stringInput(data, "measurement_id", "") ?? "";
      const measurement = await row("SELECT m.*, s.organization_id, s.customer_id FROM measurements m JOIN scans s ON s.id = m.scan_id WHERE m.id = ? LIMIT 1", [measurementId]);
      if (!measurement) throw new ApiError("Measurement not found.", 404);
      requireOrganizationStaff(user, measurement.organization_id);
      const adjusted = numberInput(data, "adjusted_value");
      const reason = adjusted === null ? null : stringInput(data, "adjustment_reason");
      await execute("UPDATE measurements SET adjusted_value = ?, adjusted_by = ?, adjustment_reason = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [adjusted, adjusted === null ? null : user.id, reason, measurementId]);
      return sendData(res, measurementResponse(await row("SELECT * FROM measurements WHERE id = ? LIMIT 1", [measurementId])));
    }

    case "add_review_event": {
      const user = await requireUser(req);
      const scan = await requireScan(stringInput(data, "scan_id", "") ?? "", user);
      requireOrganizationStaff(user, scan.organization_id);
      const eventType = stringInput(data, "event_type", "") ?? "";
      if (!allowedReviewEvents.includes(eventType)) throw new ApiError("The review event is invalid.", 400);
      await execute("INSERT INTO measurement_review_events (id, scan_id, actor_id, event_type, payload) VALUES (?, ?, ?, ?, ?)", [randomUUID(), scan.id, user.id, eventType, jsonParameter(data.payload)]);
      return sendData(res, true);
    }

    case "create_order": {
      const user = await requireUser(req);
      const scanId = stringInput(data, "scan_id", "") ?? "";
      const scan = await findScan(scanId);
      if (!scan || scan.customer_id !== user.id) throw new ApiError("A customer-owned scan is required.", 403);
      if (scan.status !== "verified") throw new ApiError("Only verified measurements can be attached to an order.", 400);
      const garment = stringInput(data, "garment_type", "") ?? "";
      if (garment.length < 2) throw new ApiError("Enter a garment type.", 400);
      const activeOrder = await row(
        `SELECT id FROM orders WHERE customer_id = ? AND scan_id = ? AND status IN (${openOrderStatuses.map(() => "?").join(", ")}) LIMIT 1`,
        [user.id, scanId, ...openOrderStatuses],
      );
      if (activeOrder) throw new ApiError("This measurement set already has an active order. Complete or cancel that order before creating another.", 409);
      const id = randomUUID();
      try {
        await execute("INSERT INTO orders (id, customer_id, organization_id, scan_id, status, garment_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, user.id, user.organization_id, scanId, "new", garment.slice(0, 120), stringInput(data, "notes")]);
      } catch (error) {
        if (isDuplicateError(error)) throw new ApiError("This measurement set already has an active order. Complete or cancel that order before creating another.", 409);
        throw error;
      }
      return sendData(res, orderResponse(await row("SELECT * FROM orders WHERE id = ? LIMIT 1", [id])));
    }

    case "update_order": {
      const user = await requireUser(req);
      const orderId = stringInput(data, "order_id", "") ?? "";
      const order = await row("SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId]);
      if (!order) throw new ApiError("Order not found.", 404);
      if (order.customer_id !== user.id) requireOrganizationStaff(user, order.organization_id);
      const status = stringInput(data, "status", "") ?? "";
      if (!allowedOrderStatuses.includes(status)) throw new ApiError("The order status is invalid.", 400);
      if (order.customer_id === user.id && status !== order.status) throw new ApiError("Only your dressmaker can update the production status.", 403);
      if (!isAllowedOrderTransition(order.status, status)) throw new ApiError("That order status change is not available from the current stage.", 409);
      const update = await execute("UPDATE orders SET status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status = ?", [status, orderId, order.status]);
      if (update.affectedRows > 0 && status === "ready_for_pickup" && order.status !== status) await dispatchOrderReadyNotifications(orderId);
      return sendData(res, orderResponse(await row("SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId])));
    }

    case "create_fitting": {
      const user = await requireUser(req);
      const orderId = stringInput(data, "order_id", "") ?? "";
      const order = await row("SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId]);
      if (!order) throw new ApiError("Order not found.", 404);
      requireOrganizationStaff(user, order.organization_id);
      const startsAt = mysqlDateTime(stringInput(data, "starts_at"));
      if (!startsAt) throw new ApiError("A fitting date is required.", 400);
      const id = randomUUID();
      await execute("INSERT INTO fittings (id, order_id, starts_at, location, status, notes) VALUES (?, ?, ?, ?, ?, ?)", [id, orderId, startsAt, stringInput(data, "location"), "requested", stringInput(data, "notes")]);
      return sendData(res, fittingResponse(await row("SELECT * FROM fittings WHERE id = ? LIMIT 1", [id])));
    }

    case "update_fitting": {
      const user = await requireUser(req);
      const fittingId = stringInput(data, "fitting_id", "") ?? "";
      const fitting = await row("SELECT f.*, o.customer_id, o.organization_id FROM fittings f JOIN orders o ON o.id = f.order_id WHERE f.id = ? LIMIT 1", [fittingId]);
      if (!fitting) throw new ApiError("Fitting not found.", 404);
      requireOrganizationStaff(user, fitting.organization_id);
      const status = stringInput(data, "status", "") ?? "";
      if (!allowedFittingStatuses.includes(status)) throw new ApiError("The fitting status is invalid.", 400);
      await execute("UPDATE fittings SET status = ? WHERE id = ?", [status, fittingId]);
      return sendData(res, fittingResponse(await row("SELECT * FROM fittings WHERE id = ? LIMIT 1", [fittingId])));
    }

    case "create_organization": {
      const user = await requireAdmin(req);
      const name = stringInput(data, "name", "") ?? "";
      if (name.length < 2) throw new ApiError("Enter an organization name.", 400);
      const id = randomUUID();
      await execute("INSERT INTO organizations (id, name, owner_id, settings) VALUES (?, ?, ?, ?)", [id, name.slice(0, 120), user.id, "{}"]);
      await ensureActiveOrganizationMarker();
      return sendData(res, organizationResponse(await row("SELECT * FROM organizations WHERE id = ? LIMIT 1", [id])));
    }

    case "upload_scan_asset": {
      const user = await requireUser(req);
      const scanId = stringInput(req.body ?? {}, "scan_id", "") ?? "";
      const scan = await findScan(scanId);
      if (!scan || scan.customer_id !== user.id) throw new ApiError("Only the scan owner can upload capture views.", 403);
      const assetType = stringInput(req.body ?? {}, "asset_type", "") ?? "";
      if (!['front', 'side', 'back'].includes(assetType)) throw new ApiError("The capture view is invalid.", 400);
      if (!req.file) throw new ApiError("The image upload did not complete.", 400);
      const allowedMimeTypes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      const extension = allowedMimeTypes[req.file.mimetype];
      if (!extension || !hasImageSignature(req.file.buffer, req.file.mimetype)) throw new ApiError("Use a valid JPG, PNG, or WebP image.", 400);
      const relativeDirectory = `scan-captures/${scan.organization_id ?? "unassigned"}/${scan.customer_id}/${scan.id}`;
      const directory = await storageDirectory(relativeDirectory);
      const relativePath = `${relativeDirectory}/${assetType}-${randomUUID()}.${extension}`;
      const destination = path.join(directory, path.basename(relativePath));
      await fs.writeFile(destination, req.file.buffer, { mode: 0o600 });
      try {
        await execute("INSERT INTO scan_assets (id, scan_id, asset_type, storage_path, metadata, quality_status) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), scan.id, assetType, relativePath, jsonParameter({ original_name: path.basename(req.file.originalname), content_type: req.file.mimetype, size_bytes: req.file.size, last_modified: null }), "pending"]);
      } catch (error) {
        await fs.rm(destination, { force: true });
        if (isDuplicateError(error)) throw new ApiError("That scan view already has an upload. Remove it before uploading another.", 409);
        throw error;
      }
      const asset = await row("SELECT * FROM scan_assets WHERE storage_path = ? LIMIT 1", [relativePath]);
      return sendData(res, assetResponse(asset, apiUrl(req, "asset", { path: relativePath })));
    }

    case "delete_scan_asset": {
      const user = await requireUser(req);
      const assetId = stringInput(data, "asset_id", "") ?? "";
      const asset = await row("SELECT a.*, s.customer_id, s.organization_id FROM scan_assets a JOIN scans s ON s.id = a.scan_id WHERE a.id = ? LIMIT 1", [assetId]);
      if (!asset) throw new ApiError("Scan asset not found.", 404);
      if (asset.customer_id !== user.id && user.role !== "admin") throw new ApiError("You cannot delete this scan asset.", 403);
      try {
        const file = await storageFile(asset.storage_path);
        await fs.rm(file, { force: true });
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
      await execute("DELETE FROM scan_assets WHERE id = ?", [assetId]);
      return sendData(res, true);
    }

    case "delete_scan": {
      const user = await requireUser(req);
      const scanId = stringInput(data, "scan_id", "") ?? "";
      const scan = await findScan(scanId);
      if (!scan) throw new ApiError("Scan not found.", 404);
      if (scan.customer_id !== user.id && user.role !== "admin") throw new ApiError("You cannot remove this scan.", 403);
      if (!["draft", "failed"].includes(scan.status)) throw new ApiError("Only draft or failed scans can be removed.", 409);
      const linkedOrder = await row("SELECT id FROM orders WHERE scan_id = ? LIMIT 1", [scanId]);
      if (linkedOrder) throw new ApiError("This scan is attached to an order and cannot be removed.", 409);
      const assets = await rows("SELECT storage_path FROM scan_assets WHERE scan_id = ?", [scanId]);
      const model = await row("SELECT model_url_or_path FROM body_models WHERE scan_id = ? LIMIT 1", [scanId]);
      for (const asset of assets) {
        try { await fs.rm(await storageFile(asset.storage_path), { force: true }); } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
      }
      if (model?.model_url_or_path && !/^https?:\/\//i.test(model.model_url_or_path) && model.model_url_or_path !== "local-reference-3d-body-scan") {
        try { await fs.rm(await storageFile(model.model_url_or_path), { force: true }); } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
      }
      await transaction(async (connection) => {
        await connection.query("DELETE FROM measurement_review_events WHERE scan_id = ?", [scanId]);
        await connection.query("DELETE FROM measurements WHERE scan_id = ?", [scanId]);
        await connection.query("DELETE FROM body_models WHERE scan_id = ?", [scanId]);
        await connection.query("DELETE FROM scan_assets WHERE scan_id = ?", [scanId]);
        await connection.query("DELETE FROM scan_processing_attempts WHERE scan_id = ?", [scanId]);
        const result = await connection.query("DELETE FROM scans WHERE id = ? AND status IN ('draft', 'failed')", [scanId]);
        if (result.affectedRows !== 1) throw new ApiError("The scan changed before it could be removed.", 409);
      });
      return sendData(res, true);
    }

    case "signed_url": {
      const user = await requireUser(req);
      const bucket = stringInput(data, "bucket", "") ?? "";
      const assetPath = stringInput(data, "path", "") ?? "";
      if (bucket === "body-models" && assetPath === "local-reference-3d-body-scan") return sendData(res, publicAssetUrl(req, "media/3d-body-scan-reference-v3.png"));
      if (bucket === "scan-captures") {
        const asset = await row("SELECT a.*, s.customer_id, s.organization_id FROM scan_assets a JOIN scans s ON s.id = a.scan_id WHERE a.storage_path = ? LIMIT 1", [assetPath]);
        if (!asset) throw new ApiError("Stored asset was not found.", 404);
        await requireScan(asset.scan_id, user);
        return sendData(res, apiUrl(req, "asset", { path: assetPath }));
      }
      if (bucket === "body-models") {
        const model = await row("SELECT bm.*, s.customer_id, s.organization_id FROM body_models bm JOIN scans s ON s.id = bm.scan_id WHERE bm.model_url_or_path = ? LIMIT 1", [assetPath]);
        if (!model) throw new ApiError("Body model was not found.", 404);
        await requireScan(model.scan_id, user);
        return sendData(res, apiUrl(req, "asset", { path: assetPath }));
      }
      throw new ApiError("The storage bucket is invalid.", 400);
    }

    case "asset":
      return serveAsset(req, res);

    case "process_scan": {
      const user = await requireUser(req);
      const scan = await requireScan(stringInput(data, "scan_id", "") ?? "", user);
      if (["ready_to_share", "ready_for_review", "verified"].includes(scan.status)) {
        return sendData(res, { status: scan.status, message: scan.status === "ready_to_share" ? "Your scan result is ready to review and share." : "Your scan result is already ready for review." });
      }
      // Processing requests are retried by the browser while the page is
      // opening. Reuse the durable job instead of resetting an active scan,
      // which used to make its final promotion fail with a stale-status error.
      if (scan.status === "processing_queued" || scan.status === "processing") {
        if (!processingJobs.has(scan.id)) queueScanProcessing(scan.id);
        const current = await findScan(scan.id);
        return sendData(res, scanProcessingResponse(current ?? scan), scan.status === "processing_queued" ? 202 : 200);
      }
      const assets = await rows("SELECT * FROM scan_assets WHERE scan_id = ?", [scan.id]);
      const types = new Set(assets.map((asset) => asset.asset_type));
      if (["front", "side"].some((required) => !types.has(required))) {
        const result = await execute("UPDATE scans SET status = ?, processing_status = ?, processing_progress = ?, processing_progress_reported = ?, failure_reason = ?, processing_error_code = ?, processing_error = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status NOT IN ('ready_to_share', 'ready_for_review', 'verified')", ["failed", "failed", 0, 0, "Front and side views are required.", "missing_assets", "Front and side views are required.", scan.id]);
        if (result.affectedRows > 0) await emitScanUpdate(scan.id, "failed", "Front and side views are required.");
        if (result.affectedRows === 0) {
          const current = await findScan(scan.id);
          if (["ready_to_share", "ready_for_review", "verified"].includes(current?.status)) return sendData(res, { status: current.status, message: current.status === "ready_to_share" ? "Your scan result is ready to review and share." : "Your scan result is already ready for review." });
        }
        return sendData(res, { status: "failed", message: "Front and side views are required." });
      }
      const heightCm = Number(scan.height_value) * (scan.height_unit === "ftin" ? 2.54 : 1);
      if (!Number.isFinite(heightCm) || heightCm <= 0) {
        const message = "A valid height is required before processing a scan.";
        await execute("UPDATE scans SET status = ?, processing_status = ?, processing_progress = ?, processing_progress_reported = ?, failure_reason = ?, processing_error_code = ?, processing_error = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status NOT IN ('ready_to_share', 'ready_for_review', 'verified')", ["failed", "failed", 0, 0, message, "invalid_height", message, scan.id]);
        await emitScanUpdate(scan.id, "failed", message);
        return sendData(res, { status: "failed", message });
      }
      const queuedUpdate = await execute("UPDATE scans SET status = ?, processing_status = ?, processing_progress = ?, processing_progress_reported = ?, processing_attempt_id = NULL, processing_error_code = NULL, processing_error = NULL, failure_reason = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status IN ('uploaded', 'failed', 'draft', 'needs_recapture')", ["processing_queued", "queued", 0, 0, scan.id]);
      if (queuedUpdate.affectedRows === 0) {
        const current = await findScan(scan.id);
        if (["ready_to_share", "ready_for_review", "verified"].includes(current?.status)) {
          return sendData(res, { status: current.status, message: current.status === "ready_to_share" ? "Your scan result is ready to review and share." : "Your scan result is already ready for review." });
        }
        if (current && (current.status === "processing_queued" || current.status === "processing")) {
          if (!processingJobs.has(current.id)) queueScanProcessing(current.id);
          return sendData(res, scanProcessingResponse(current), current.status === "processing_queued" ? 202 : 200);
        }
        throw new ApiError("This scan is not ready to process.", 409);
      }
      queueScanProcessing(scan.id);
      return sendData(res, { status: "queued", progress: 0, progress_reported: false, message: "Scan processing has been queued." }, 202);
    }

    default:
      throw new ApiError("Unknown Node API action.", 404);
  }
}

function allowedOrigin(origin) {
  return !origin || config.allowedOrigins.includes(origin);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigin(origin)) return sendError(res, new ApiError("The request origin is not allowed.", 403));
  if (allowedOrigin(origin)) {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  // Clickjacking + transport hardening applied to every response (the SPA HTML
  // and JSON API included), not only the asset route.
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    // Vite injects an inline module bootstrap; styles.css and Google Fonts.
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss: https:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "));
  // HSTS only makes sense once the deployment is HTTPS (cookieSecure signals it).
  if (config.cookieSecure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

app.use(express.json({ limit: "1mb" }));
app.all(["/api", "/api/", "/api/index.php"], (req, res) => {
  upload.single("file")(req, res, (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE") return sendError(res, new ApiError("Images must be smaller than 10 MB.", 400));
      return sendError(res, new ApiError("The image upload did not complete.", 400));
    }
    void handleAction(req, res).catch((error) => sendError(res, error));
  });
});

app.get("/api/asset", (req, res) => {
  void serveAsset(req, res).catch((error) => sendError(res, error));
});

app.use(express.static(config.publicDirectory, { index: false }));
app.use(express.static(config.distDirectory, { index: false }));
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api") && req.accepts("html")) {
    return res.sendFile(path.join(config.distDirectory, "index.html"), (error) => {
      if (error) next(error);
    });
  }
  return next();
});
app.use((req, res) => {
  if (req.path.startsWith("/api")) return sendError(res, new ApiError("Node API route not found.", 404));
  return res.status(404).send("Not found");
});

io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, allowedOrigin(origin)),
    credentials: true,
  },
});

io.use(async (socket, next) => {
  try {
    const token = parseCookies(socket.handshake.headers.cookie ?? "")[sessionCookieName] ?? "";
    const user = await userBySessionToken(token);
    if (!user) return next(new Error("Sign in is required for live scan updates."));
    socket.data.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
});

io.on("connection", (socket) => {
  socket.on("scan:join", async (payload, acknowledgement) => {
    try {
      const scanId = typeof payload?.scanId === "string" ? payload.scanId : "";
      await requireScan(scanId, socket.data.user);
      socket.join(`scan:${scanId}`);
      if (typeof acknowledgement === "function") acknowledgement({ ok: true });
    } catch (error) {
      if (typeof acknowledgement === "function") acknowledgement({ ok: false, message: error instanceof Error ? error.message : "Unable to join scan updates." });
    }
  });
  socket.on("scan:leave", (payload) => {
    if (typeof payload?.scanId === "string") socket.leave(`scan:${payload.scanId}`);
  });
});

export async function startServer() {
  await initializeDatabase({ applySchema: true });
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, "127.0.0.1", resolve);
  });
  console.log(`SukatAI Node API listening at http://127.0.0.1:${config.port}`);
  console.log(`MariaDB database: ${config.db.name}@${config.db.host}:${config.db.port}`);
  console.log("Socket.IO live updates are enabled.");
  await resumePendingScans();
  scanRecoveryTimer = setInterval(() => {
    void resumePendingScans().catch((error) => console.error("Could not recover pending scans:", error));
  }, scanRecoveryIntervalMs);
  scanRecoveryTimer.unref?.();
}

async function stopServer() {
  if (scanRecoveryTimer) {
    clearInterval(scanRecoveryTimer);
    scanRecoveryTimer = null;
  }
  await new Promise((resolve) => httpServer.close(resolve));
  await closeDatabase();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(async (error) => {
    console.error("Could not start SukatAI Node API:", error);
    await closeDatabase();
    process.exitCode = 1;
  });
  process.once("SIGINT", () => { void stopServer().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void stopServer().finally(() => process.exit(0)); });
}
