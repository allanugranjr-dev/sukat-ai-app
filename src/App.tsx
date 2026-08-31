import {
  type ChangeEvent,
  type DependencyList,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import type * as THREE from "three";
import type { OrbitControls as OrbitControlsType } from "three/examples/jsm/controls/OrbitControls.js";
import {
  acceptDressmakerInvitation,
  assignProfileOrganization,
  getSession,
  getNotifications,
  getProfile,
  inviteDressmaker,
  isRole,
  listInvitations,
  listOrganizations,
  markNotificationRead,
  onAuthStateChange,
  revokeDressmakerInvitation,
  resendSignupConfirmation,
  sendPasswordReset,
  signIn,
  signOut,
  signUpCustomer,
  updatePassword,
  updateProfile,
} from "./lib/auth";
import {
  addReviewEvent,
  createFitting,
  createOrganization,
  createOrder,
  createScan,
  getScanBundle,
  listAdminOrders,
  listAdminProfiles,
  listAdminScans,
  listCustomerMeasurementSets,
  listCustomerOrders,
  listCustomerScans,
  listFittingsForOrders,
  listOrgCustomers,
  listOrgOrders,
  listOrgScans,
  updateFittingStatus,
  updateMeasurement,
  updateOrderStatus,
  updateScan,
} from "./lib/data";
import { isHeightValid, parseHeightInches, previousScanPosition, scanSteps, type ScanStep, validateUpload } from "./lib/scanFlow";
import { ellipseRadiiForCircumference, measurementGuideKey, measurementGuideMatches, modelHeightCm, modelMeasurementCm } from "./lib/measurementMapping";
import { invitationState, isRemovableInvitation } from "./lib/invitationLifecycle";
import { requestScanProcessing, processingCopy } from "./lib/reconstructionProvider";
import { createSignedStorageUrl, deleteScanAsset, uploadScanAsset } from "./lib/storage";
import { subscribeToNodeScan } from "./lib/nodeApi";
import { invitationAppOrigin, publicAppOrigin, readableError, supabaseConfig } from "./lib/supabase";
import {
  displayName,
  fittingStatusLabel,
  initials,
  orderStatusLabel,
  scanStatusLabel,
  scanStatusTone,
  type Fitting,
  type Invitation,
  type Measurement,
  type Notification,
  type Order,
  type Organization,
  type Profile,
  type Role,
  type Scan,
  type ScanAsset,
  type ScanBundle,
  type ScanStatus,
} from "./lib/types";

type ThreeModule = typeof import("three");
type OrbitControlsConstructor = typeof import("three/examples/jsm/controls/OrbitControls.js")["OrbitControls"];
type ThreeRuntime = { three: ThreeModule; OrbitControls: OrbitControlsConstructor };

let threeRuntimePromise: Promise<ThreeRuntime> | null = null;

function loadThreeRuntime(): Promise<ThreeRuntime> {
  if (!threeRuntimePromise) {
    threeRuntimePromise = Promise.all([
      import("three"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ]).then(([three, controls]) => ({ three, OrbitControls: controls.OrbitControls }));
  }
  return threeRuntimePromise;
}

type PublicView = "landing" | "signin" | "signup";
type AuthMode = PublicView | "forgot";
type CustomerPage = "overview" | "scan" | "measurements" | "orders" | "fittings" | "profile";
type DressmakerPage = "dashboard" | "customers" | "reviews" | "orders" | "fittings" | "profile";
type AdminPage = "dashboard" | "customers" | "dressmakers" | "invitations" | "orders" | "reports" | "settings";
type Page = CustomerPage | DressmakerPage | AdminPage;
type IconName =
  | "grid" | "scan" | "ruler" | "bag" | "calendar" | "user" | "bell" | "search" | "arrow-right"
  | "arrow-left" | "check" | "lock" | "camera" | "upload" | "shield" | "clock" | "eye" | "rotate"
  | "zoom-in" | "zoom-out" | "expand" | "dress" | "users" | "clipboard" | "inbox" | "chart" | "settings" | "logout"
  | "chevron" | "info" | "refresh" | "plus" | "x" | "menu" | "spark" | "message" | "download"
  | "filter" | "external" | "help" | "mail" | "target" | "play" | "pie" | "database";

const measurementLabels: Record<string, string> = {
  neck: "Neck",
  shoulder: "Shoulder",
  chest: "Chest",
  bust: "Bust",
  waist: "Waist",
  hip: "Hip",
  sleeve: "Sleeve",
  inseam: "Inseam",
  outseam: "Outseam",
  rise: "Rise",
  arm: "Upper arm",
  wrist: "Wrist",
};

function cn(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

function publicAssetPath(path: string): string {
  if (/^(?:https?:)?\/\//i.test(path)) return path;
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}

function Icon({ name, size = 20, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect {...common} x="4" y="4" width="6" height="6" rx="1" /><rect {...common} x="14" y="4" width="6" height="6" rx="1" /><rect {...common} x="4" y="14" width="6" height="6" rx="1" /><rect {...common} x="14" y="14" width="6" height="6" rx="1" /></>,
    scan: <><rect {...common} x="4" y="4" width="6" height="6" rx="1" /><rect {...common} x="14" y="14" width="6" height="6" rx="1" /><path {...common} d="M14 4h2a4 4 0 0 1 4 4v2M10 20H8a4 4 0 0 1-4-4v-2M4 10V8a4 4 0 0 1 4-4h2M20 14v2a4 4 0 0 1-4 4h-2" /></>,
    ruler: <><path {...common} d="m4 16 12-12 4 4L8 20H4z" /><path {...common} d="m12 8 4 4M9 11l2 2M15 5l4 4" /></>,
    bag: <><path {...common} d="M5 8h14l1 12H4L5 8Z" /><path {...common} d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
    calendar: <><rect {...common} x="3" y="5" width="18" height="16" rx="2" /><path {...common} d="M16 3v4M8 3v4M3 10h18" /></>,
    user: <><circle {...common} cx="12" cy="8" r="4" /><path {...common} d="M4 21a8 8 0 0 1 16 0" /></>,
    bell: <><path {...common} d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    search: <><circle {...common} cx="10.8" cy="10.8" r="6.8" /><path {...common} d="m16 16 5 5" /></>,
    "arrow-right": <><path {...common} d="M4 12h16M13 5l7 7-7 7" /></>,
    "arrow-left": <><path {...common} d="M20 12H4M11 5l-7 7 7 7" /></>,
    check: <path {...common} d="m5 12 4 4L19 6" />,
    lock: <><rect {...common} x="5" y="10" width="14" height="10" rx="2" /><path {...common} d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    camera: <><path {...common} d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle {...common} cx="12" cy="13.5" r="3.5" /></>,
    upload: <><path {...common} d="M12 16V4M7 9l5-5 5 5M4 20h16" /></>,
    shield: <><path {...common} d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6z" /><path {...common} d="m8.5 12 2.2 2.2 4.8-5" /></>,
    clock: <><circle {...common} cx="12" cy="12" r="8.5" /><path {...common} d="M12 7v5l3.5 2" /></>,
    eye: <><path {...common} d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" /><circle {...common} cx="12" cy="12" r="2.5" /></>,
    rotate: <><path {...common} d="M20 11a8 8 0 0 0-14.8-4L3 10M3 5v5h5M4 13a8 8 0 0 0 14.8 4L21 14m0 5v-5h-5" /></>,
    "zoom-in": <><circle {...common} cx="10.5" cy="10.5" r="6.5" /><path {...common} d="M16 16l5 5M10.5 7.5v6M7.5 10.5h6" /></>,
    "zoom-out": <><circle {...common} cx="10.5" cy="10.5" r="6.5" /><path {...common} d="M16 16l5 5M7.5 10.5h6" /></>,
    expand: <><path {...common} d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" /><path {...common} d="M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6" /></>,
    dress: <><path {...common} d="M9 4c0 2 1 3 3 3s3-1 3-3M9 4 6 7l-3 3 4 2-1 8h12l-1-8 4-2-3-3-3-3" /></>,
    users: <><circle {...common} cx="9" cy="8" r="3" /><path {...common} d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 6" /></>,
    clipboard: <><rect {...common} x="5" y="4" width="14" height="17" rx="2" /><path {...common} d="M9 4V2h6v2M8 10h8M8 14h5" /></>,
    inbox: <><path {...common} d="M4 4h16v16H4zM4 13h4l2 3h4l2-3h4" /></>,
    chart: <><path {...common} d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    settings: <><circle {...common} cx="12" cy="12" r="3" /><path {...common} d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.6v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.5-1H6v-2.6h.5A1.7 1.7 0 0 0 8 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1L9.4 6l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2H15v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3L18 6l1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v2.6h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>,
    logout: <><path {...common} d="M10 17l5-5-5-5M15 12H3M13 4h6v16h-6" /></>,
    chevron: <path {...common} d="m8 10 4 4 4-4" />,
    info: <><circle {...common} cx="12" cy="12" r="9" /><path {...common} d="M12 11v5M12 8h.01" /></>,
    refresh: <><path {...common} d="M20 11a8 8 0 0 0-14.8-4L3 10M3 5v5h5M4 13a8 8 0 0 0 14.8 4L21 14m0 5v-5h-5" /></>,
    plus: <><path {...common} d="M12 5v14M5 12h14" /></>,
    x: <><path {...common} d="m6 6 12 12M18 6 6 18" /></>,
    menu: <><path {...common} d="M4 7h16M4 12h16M4 17h16" /></>,
    spark: <><path {...common} d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" /></>,
    message: <><path {...common} d="M4 5h16v12H8l-4 4z" /><path {...common} d="M8 9h8M8 13h5" /></>,
    download: <><path {...common} d="M12 3v12M7 10l5 5 5-5M4 20h16" /></>,
    filter: <path {...common} d="M4 6h16M7 12h10M10 18h4" />,
    external: <><path {...common} d="M14 5h5v5M19 5l-8 8" /><path {...common} d="M18 13v5H5V5h5" /></>,
    help: <><circle {...common} cx="12" cy="12" r="9" /><path {...common} d="M9.5 9a2.5 2.5 0 1 1 4.3 1.8c-1.2 1.1-1.8 1.3-1.8 2.7M12 17h.01" /></>,
    mail: <><rect {...common} x="3" y="5" width="18" height="14" rx="2" /><path {...common} d="m4 7 8 6 8-6" /></>,
    target: <><circle {...common} cx="12" cy="12" r="8" /><circle {...common} cx="12" cy="12" r="3" /><path {...common} d="M12 2v2M22 12h-2M12 22v-2M2 12h2" /></>,
    play: <path {...common} d="m9 6 9 6-9 6z" />,
    pie: <><path {...common} d="M12 3a9 9 0 1 0 9 9h-9z" /><path {...common} d="M12 3v9h9" /></>,
    database: <><ellipse {...common} cx="12" cy="5" rx="7" ry="3" /><path {...common} d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" /></>,
  };
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none">{paths[name]}</svg>;
}

function Logo({ inverse = false, compact = false }: { inverse?: boolean; compact?: boolean }) {
  return <div className={cn("brand", inverse && "brand-inverse", compact && "brand-compact")}><i className="brand-mark"><span /></i><strong className="brand-word">Sukat<span>AI</span></strong>{!compact && <small className="brand-tagline">MEASURE WITH INTENTION</small>}</div>;
}

function Badge({ children, tone = "neutral", dot = false }: { children: ReactNode; tone?: "success" | "warning" | "danger" | "teal" | "neutral" | "blue" | "dark"; dot?: boolean }) {
  return <span className={cn("badge", `badge-${tone}`)}>{dot && <i className="badge-dot" />}{children}</span>;
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "gold" | "danger"; icon?: IconName };

function Button({ children, className, variant = "primary", icon, ...props }: ButtonProps) {
  const { type = "button", ...buttonProps } = props;
  return <button type={type} className={cn("button", `button-${variant}`, className)} {...buttonProps}>{children}{icon && <Icon name={icon} size={15} />}</button>;
}

function Avatar({ profile, tone = "teal", size = "md", initialsText }: { profile?: Pick<Profile, "first_name" | "last_name">; tone?: "teal" | "gold" | "navy"; size?: "sm" | "md" | "lg"; initialsText?: string }) {
  return <span className={cn("avatar", `avatar-${tone}`, `avatar-${size}`)}>{initialsText ?? (profile ? initials(profile) : "?")}</span>;
}

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="section-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="section-description">{description}</p>}</div>{action}</div>;
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={cn("panel", className)}>{children}</section>;
}

function LoadingState({ label = "Loading your workspace…" }: { label?: string }) {
  return <div className="data-state loading-state" role="status" aria-live="polite"><span className="loader" aria-hidden="true" /><p>{label}</p></div>;
}

function DataState({ icon = "inbox", title, body, action }: { icon?: IconName; title: string; body: string; action?: ReactNode }) {
  return <div className="data-state"><span className="data-state-icon"><Icon name={icon} size={23} /></span><h3>{title}</h3><p>{body}</p>{action}</div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="data-state error-state" role="alert"><span className="data-state-icon"><Icon name="info" size={23} /></span><h3>We could not load this view</h3><p>{message}</p>{onRetry && <Button variant="secondary" icon="refresh" onClick={onRetry}>Try again</Button>}</div>;
}

function InlineError({ message }: { message: string }) {
  return <div className="form-error" role="alert" aria-live="assertive"><Icon name="info" size={16} /> {message}</div>;
}

function StatusBadge({ status }: { status: ScanStatus }) {
  return <Badge tone={scanStatusTone(status)} dot>{scanStatusLabel(status)}</Badge>;
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function displayMeasurementKey(key: string): string {
  return measurementLabels[key.toLowerCase()] ?? key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayMeasurementValue(measurement: Measurement): string {
  const value = measurement.adjusted_value ?? measurement.value;
  return `${Number(value).toFixed(1)} ${measurement.unit}`;
}

function measurementConfidence(confidence: number | null): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (confidence === null || !Number.isFinite(confidence)) return { label: "Not reported", tone: "neutral" };
  if (confidence >= 80) return { label: "High confidence", tone: "success" };
  if (confidence >= 60) return { label: "Good starting point", tone: "success" };
  if (confidence >= 50) return { label: "Review with tailor", tone: "warning" };
  return { label: "Needs review", tone: "danger" };
}

function measurementConfidenceText(confidence: number | null): string {
  const summary = measurementConfidence(confidence);
  if (confidence === null || !Number.isFinite(confidence)) return summary.label;
  return `${summary.label} · ${confidence.toFixed(0)}%`;
}

function useAsyncData<T>(loader: () => Promise<T>, dependencies: DependencyList, initialValue: T | null = null): { data: T | null; loading: boolean; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loader().then((next) => {
      if (!active) return;
      setData(next);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(readableError(reason));
      setLoading(false);
    });
    return () => { active = false; };
    // The loader is intentionally recreated by the owning view; its explicit inputs are the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision]);
  return { data, loading, error, reload: () => setRevision((value) => value + 1) };
}

function SetupRequiredScreen() {
  return <main className="setup-page"><div className="setup-card"><Logo /><Badge tone="warning" dot>Setup needed</Badge><h1>Connect SukatAI</h1><p>SukatAI needs its sign-in, database, and private photo storage connection before it can open. Add the public project values to <code>.env.local</code>, then restart the Vite server.</p><div className="setup-list"><strong>Required values</strong><code>NEXT_PUBLIC_SUPABASE_URL</code><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></div><p className="setup-note"><Icon name="shield" size={16} /> Keep private service keys and measurement-service keys on the server only.</p></div></main>;
}

function FullPageLoading() {
  return <main className="full-page-loading"><Logo /><LoadingState label="Opening your secure workspace…" /></main>;
}

function LandingPage({ onAuth }: { onAuth: (view: "signin" | "signup") => void }) {
  return <div className="marketing-page">
    <header className="marketing-header"><Logo inverse /><nav className="marketing-nav"><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a><a href="#faq">FAQ</a></nav><div className="marketing-actions"><button type="button" className="text-button light" onClick={() => onAuth("signin")}>Sign in <Icon name="arrow-right" size={15} /></button><Button variant="gold" onClick={() => onAuth("signup")}>Create an account</Button></div></header>
    <section className="hero-section"><div className="hero-copy"><Badge tone="dark" dot>PRIVATE MEASUREMENT WORKSPACE</Badge><h1>Tailoring begins with <em>better information.</em></h1><p className="hero-lede">Guided photo capture creates a secure, reviewable measurement record for the people making your clothes.</p><div className="hero-buttons"><Button variant="gold" onClick={() => onAuth("signup")} icon="arrow-right">Start with your measurements</Button><button type="button" className="hero-play" onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}><span className="play-circle"><Icon name="play" size={13} /></span> See how it works</button></div><div className="hero-trust"><span><Icon name="shield" size={17} /> Private by design</span><span><Icon name="check" size={17} /> Tailor reviewed</span><span><Icon name="clock" size={17} /> Guided in a few minutes</span></div></div></section>
    <div className="logo-band"><span>Built for a clearer garment journey</span><div><span>Independent dressmakers</span><span>Private by default</span><span>Reviewable records</span></div></div>
    <section id="how-it-works" className="how-section"><div className="center-heading"><p className="eyebrow">A calmer measurement journey</p><h2>From camera to confidence.</h2><p>Each step is visible, honest, and designed to keep your information in your hands.</p></div><div className="process-grid"><ProcessCard number="01" icon="scan" title="Capture" copy="Follow simple front, side, and back prompts. Upload instead if a camera is not available." /><ProcessCard number="02" icon="spark" title="Validate" copy="A configured reconstruction provider returns measurements only when the response passes validation." /><ProcessCard number="03" icon="dress" title="Review" copy="Your dressmaker can adjust the record with a reason and keep the review history intact." /><ProcessCard number="04" icon="check" title="Fit" copy="Use a verified measurement set when you are ready to begin an order or fitting." /></div></section>
    <section id="privacy" className="trust-section"><div className="trust-panel"><div className="trust-copy"><p className="eyebrow">Private by default</p><h2>Your body data deserves a careful workflow.</h2><p>Photos stay in a private account. Only approved people can open them, and each link expires after a short time.</p><Button variant="secondary" onClick={() => onAuth("signup")} icon="arrow-right">Create an account</Button></div><div className="trust-points"><TrustPoint icon="lock" title="Private uploads" copy="Front, side, and back photos stay in your account instead of becoming public links." /><TrustPoint icon="ruler" title="Measurements you can review" copy="Returned measurements stay separate from any changes made by a dressmaker." /><TrustPoint icon="shield" title="Access by role" copy="Each person sees only the customers and records they are allowed to see." /></div></div></section>
    <section id="faq" className="faq-section"><div><p className="eyebrow">A few useful answers</p><h2>Made to be straightforward.</h2></div><div className="faq-list"><details open><summary>Do I need a camera?<span>+</span></summary><p>No. The guided capture flow accepts validated JPG, PNG, or WebP uploads for each view.</p></details><details><summary>Are the results exact?<span>+</span></summary><p>Measurement results depend on the configured reconstruction provider and must be reviewed by a dressmaker before they are verified.</p></details><details><summary>Can dressmakers sign up publicly?<span>+</span></summary><p>No. Dressmaker accounts are created through an administrator invitation and a verified Supabase Auth flow.</p></details></div></section>
    <footer className="marketing-footer"><Logo inverse compact /><span>© {new Date().getFullYear()} SukatAI</span><div><a href="#privacy">Privacy</a><a href="#faq">FAQ</a></div></footer>
  </div>;
}

function ProcessCard({ number, icon, title, copy }: { number: string; icon: IconName; title: string; copy: string }) {
  return <article className="process-card"><span className="process-number">{number}</span><span className="process-icon"><Icon name={icon} size={20} /></span><h3>{title}</h3><p>{copy}</p><span className="process-arrow"><Icon name="arrow-right" size={16} /></span></article>;
}

function TrustPoint({ icon, title, copy }: { icon: IconName; title: string; copy: string }) {
  return <div className="trust-point"><span className="trust-icon"><Icon name={icon} size={18} /></span><div><strong>{title}</strong><p>{copy}</p></div></div>;
}

function AuthPage({ mode, notice, onBack, onModeChange, onNotice, onVerification, showBack = mode !== "signin" }: { mode: AuthMode; notice: string; onBack: () => void; onModeChange: (mode: AuthMode) => void; onNotice: (notice: string) => void; onVerification: (email: string) => void; showBack?: boolean }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [consent, setConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const selector = mode === "signup" ? 'input[name="first_name"]' : 'input[type="email"]';
      document.querySelector<HTMLInputElement>(selector)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "forgot") {
        if (!email.trim()) throw new Error("Enter your account email.");
        await sendPasswordReset(email);
        onNotice("If that email belongs to a SukatAI account, a password reset link is on its way.");
        onModeChange("signin");
      } else if (mode === "signin") {
        if (!email.trim() || !password) throw new Error("Enter your email and password.");
        await signIn(email, password);
      } else {
        if (!firstName.trim() || !lastName.trim()) throw new Error("Enter your first and last name.");
        if (!email.trim() || !password) throw new Error("Enter an email and password.");
        if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
        if (password !== confirm) throw new Error("Passwords do not match.");
        if (!consent) throw new Error("Accept the privacy notice to create your customer account.");
        const response = await signUpCustomer({ firstName, lastName, email, password });
        if (!response.data.session) {
          onVerification(email.trim());
        }
      }
    } catch (reason: unknown) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  const heading = mode === "forgot" ? "Reset your password" : mode === "signin" ? "Sign in" : "Create your account";
  return <main className="auth-page auth-page-direct">
    <section className="auth-form-panel" aria-labelledby="auth-title">
      <div className="auth-form-wrap">
        <div className="auth-direct-header"><Logo /></div>

        {showBack && <button type="button" className="auth-back auth-back-direct" onClick={onBack}><Icon name="arrow-left" size={16} /> Back</button>}

        <div className="auth-heading">
          <h1 id="auth-title">{heading}</h1>
          {mode === "forgot" && <p>We will email a secure link to reset your password.</p>}
          {mode === "signin" && <p>Use your SukatAI account to continue.</p>}
          {mode === "signup" && <p>Create a private account for your measurement workroom.</p>}
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && <div className="form-row"><Field label="First name" value={firstName} onChange={setFirstName} placeholder="First name" /><Field label="Last name" value={lastName} onChange={setLastName} placeholder="Last name" /></div>}
          <Field label="Email address" value={email} onChange={setEmail} placeholder={mode === "signup" ? "name@domain.com" : "Email address"} type="email" autoComplete="email" icon={mode === "signin" || mode === "forgot" ? "mail" : undefined} />
          {mode !== "forgot" && <div className="field"><label htmlFor="auth-password">Password</label><div className="input-with-action auth-password-input"><Icon name="lock" size={22} /><input id="auth-password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signin" ? "Password" : "At least 8 characters"} type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}><Icon name="eye" size={22} /></button></div></div>}
          {mode === "signup" && <Field label="Confirm password" value={confirm} onChange={setConfirm} placeholder="Repeat your password" type="password" autoComplete="new-password" />}
          {mode === "signin" && <div className="form-meta"><span /> <button type="button" className="text-button" onClick={() => onModeChange("forgot")}>Forgot password?</button></div>}
          {mode === "signup" && <label className="consent-label"><input name="privacy-consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree to the privacy notice and understand that measurements are estimates requiring professional review.</span></label>}
          {notice && <div className="form-notice" role="status" aria-live="polite"><Icon name="check" size={16} /> {notice}</div>}
          {error && <InlineError message={error} />}
          <Button type="submit" className="auth-submit" icon={busy ? undefined : "arrow-right"} disabled={busy}>{busy ? "Working…" : mode === "forgot" ? "Send reset link" : mode === "signin" ? "Sign in" : "Create account"}</Button>
        </form>

        <div className="auth-divider" aria-hidden="true"><span>or</span></div>
        <div className="auth-switch-card">
          {mode === "forgot" ? <><span>Remember your password?</span><button type="button" onClick={() => onModeChange("signin")}>Sign in</button></> : mode === "signin" ? <><span>New to SukatAI?</span><button type="button" onClick={() => onModeChange("signup")}>Create an account</button></> : <><span>Already have an account?</span><button type="button" onClick={() => onModeChange("signin")}>Sign in</button></>}
        </div>
        <button type="button" className="auth-help-bottom" onClick={() => onNotice("For help, contact your administrator.")}>Need help?</button>
      </div>
    </section>
  </main>;
}

function Field({ label, value, onChange, placeholder, type = "text", autoComplete, id, name, required = false, icon }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; autoComplete?: string; id?: string; name?: string; required?: boolean; icon?: IconName }) {
  const generatedId = useId();
  const inputId = id ?? `field-${generatedId.replaceAll(":", "")}`;
  const generatedName = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const inputName = name ?? (generatedName || inputId);
  const input = <input id={inputId} name={inputName} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type} autoComplete={autoComplete} spellCheck={type === "email" ? false : undefined} required={required} />;
  return <div className="field"><label htmlFor={inputId}>{label}{required && <span aria-hidden="true"> *</span>}</label>{icon ? <div className="field-input-with-icon"><Icon name={icon} size={22} />{input}</div> : input}</div>;
}

export default function App() {
  if (!supabaseConfig.isConfigured) return <SetupRequiredScreen />;
  return <ConfiguredApp />;
}

function ConfiguredApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [publicView, setPublicView] = useState<AuthMode>("signin");
  const [notice, setNotice] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [invitationAuthOpen, setInvitationAuthOpen] = useState(false);
  const [invitationFlowComplete, setInvitationFlowComplete] = useState(false);
  const invitationParams = new URLSearchParams(window.location.search);
  const inviteToken = invitationParams.get("invite") ?? invitationParams.get("token");
  const authHash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const [expiredInvitationCallback] = useState(() => authHash.get("error_code") === "otp_expired" && authHash.get("error") === "access_denied");
  const [supabaseInviteCallback] = useState(() => authHash.get("type") === "invite" || expiredInvitationCallback);
  const accountInvitationId = profile?.role === "dressmaker"
    ? ""
    : typeof session?.user.app_metadata?.sukat_ai_invitation_id === "string"
      ? session.user.app_metadata.sukat_ai_invitation_id
      : typeof session?.user.user_metadata?.invitation_id === "string"
        ? session.user.user_metadata.invitation_id
        : "";
  const invitationFlowRequested = !invitationFlowComplete && Boolean(inviteToken || supabaseInviteCallback || accountInvitationId || expiredInvitationCallback);
  const verificationRequested = new URLSearchParams(window.location.search).get("verify") === "1" || authHash.get("type") === "signup";
  const verificationError = authHash.get("error_description") ?? authHash.get("error_code") ?? authHash.get("error") ?? "";
  const resetRequested = new URLSearchParams(window.location.search).get("reset") === "1" || window.location.hash.includes("type=recovery");

  useEffect(() => {
    if (!invitationFlowRequested) setInvitationAuthOpen(false);
  }, [invitationFlowRequested]);

  useEffect(() => {
    let active = true;
    const hydrate = async (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setProfileError("");
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const nextProfile = await getProfile(nextSession.user.id);
        if (!active) return;
        setProfile(nextProfile);
        setProfileError("");
      } catch (reason: unknown) {
        if (!active) return;
        setProfile(null);
        setProfileError(readableError(reason));
      } finally {
        if (active) setLoading(false);
      }
    };
    void getSession().then((nextSession) => hydrate(nextSession)).catch((reason: unknown) => {
      if (!active) return;
      setProfileError(readableError(reason));
      setLoading(false);
    });
    const unsubscribe = onAuthStateChange((_event, nextSession) => { void hydrate(nextSession); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const refreshProfile = async () => {
    if (!session) return;
    setProfile(await getProfile(session.user.id));
  };

  const clearSpecialUrl = () => {
    const next = new URL(window.location.href);
    next.searchParams.delete("invite");
    next.searchParams.delete("token");
    next.searchParams.delete("reset");
    next.searchParams.delete("verify");
    window.history.replaceState({}, "", `${next.pathname}${next.search}`);
  };
  const finishInvitationFlow = () => {
    setInvitationFlowComplete(true);
    clearSpecialUrl();
  };

  useEffect(() => {
    const handleNativeBack = (event: Event) => {
      if (event.defaultPrevented) return;
      if (invitationFlowRequested && session) {
        finishInvitationFlow();
        event.preventDefault();
        return;
      }
      if (resetRequested && session) {
        clearSpecialUrl();
        void signOut();
        event.preventDefault();
        return;
      }
      if (verificationRequested || verificationEmail) {
        clearSpecialUrl();
        setVerificationEmail("");
        setPublicView("signin");
        event.preventDefault();
        return;
      }
      if (invitationFlowRequested && !session) {
        if (invitationAuthOpen) {
          setInvitationAuthOpen(false);
        } else {
          finishInvitationFlow();
          setPublicView("signin");
        }
        event.preventDefault();
        return;
      }
      if (!session && publicView !== "landing" && publicView !== "signin") {
        setNotice("");
        setPublicView("signin");
        event.preventDefault();
      }
    };

    window.addEventListener("sukatai:native-back", handleNativeBack);
    return () => window.removeEventListener("sukatai:native-back", handleNativeBack);
  }, [
    clearSpecialUrl,
    finishInvitationFlow,
    invitationAuthOpen,
    invitationFlowRequested,
    publicView,
    resetRequested,
    session,
    verificationEmail,
    verificationRequested,
  ]);

  if (loading) return <FullPageLoading />;
  if (invitationFlowRequested && session) return <InvitationAcceptPage token={inviteToken} session={session} profile={profile} onBack={() => { finishInvitationFlow(); setPublicView("signin"); }} onAccepted={async () => { await refreshProfile(); finishInvitationFlow(); }} />;
  if (resetRequested && session) return <PasswordResetPage onComplete={() => { clearSpecialUrl(); void signOut(); }} />;
  if (verificationRequested || verificationEmail) return <EmailVerificationPage email={session?.user.email ?? verificationEmail} verified={Boolean(session?.user.email_confirmed_at) && !verificationError} initialError={verificationError} onBack={() => { clearSpecialUrl(); setVerificationEmail(""); setPublicView("signin"); }} onContinue={() => { clearSpecialUrl(); setVerificationEmail(""); }} />;
  if (invitationFlowRequested && !session && invitationAuthOpen) return <AuthPage mode={publicView === "landing" ? "signin" : publicView} notice={notice} showBack onBack={() => { setNotice(""); setInvitationAuthOpen(false); }} onModeChange={(mode) => { setNotice(""); setPublicView(mode); }} onNotice={setNotice} onVerification={(email) => { setNotice(""); setVerificationEmail(email); }} />;
  if (invitationFlowRequested && !session) return <InvitationWelcomePage session={null} expired={expiredInvitationCallback} onBack={() => { finishInvitationFlow(); setPublicView("signin"); }} onContinue={() => { setNotice(""); setPublicView("signin"); setInvitationAuthOpen(true); }} />;
  if (!session) return <AuthPage mode={publicView === "landing" ? "signin" : publicView} notice={notice} onBack={() => { setNotice(""); setPublicView("signin"); }} onModeChange={(mode) => { setNotice(""); setPublicView(mode); }} onNotice={setNotice} onVerification={(email) => { setNotice(""); setVerificationEmail(email); }} />;
  if (!profile || !isRole(profile.role)) return <ProfileUnavailable message={profileError || "Your authenticated account does not have a valid SukatAI profile."} onSignOut={() => void signOut()} />;
  return <Workspace profile={profile} onProfileChange={setProfile} onSignOut={() => void signOut()} />;
}

function ProfileUnavailable({ message, onSignOut }: { message: string; onSignOut: () => void }) {
  return <main className="setup-page"><div className="setup-card"><Logo /><Badge tone="danger" dot>Profile unavailable</Badge><h1>We need to finish your account setup.</h1><p>{message}</p><p>Apply the SukatAI database migration and ensure the Auth profile trigger is active, then sign in again.</p><Button variant="secondary" onClick={onSignOut} icon="logout">Sign out</Button></div></main>;
}

function PasswordResetPage({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) { setError("Use a password with at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      await updatePassword(password);
      setNotice("Your password has been updated. You can continue securely.");
      window.setTimeout(onComplete, 700);
    } catch (reason: unknown) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };
  return <main className="setup-page"><div className="setup-card reset-card"><Logo /><p className="eyebrow">ACCOUNT RECOVERY</p><h1>Choose a new password.</h1><p>Use a password you have not used elsewhere. Your reset link is single-purpose and expires.</p><form className="auth-form" onSubmit={submit}><Field label="New password" value={password} onChange={setPassword} placeholder="At least 8 characters" type="password" autoComplete="new-password" /><Field label="Confirm password" value={confirm} onChange={setConfirm} placeholder="Repeat your password" type="password" autoComplete="new-password" />{notice && <div className="form-notice"><Icon name="check" size={16} /> {notice}</div>}{error && <InlineError message={error} />}<Button type="submit" disabled={busy} icon={busy ? undefined : "arrow-right"}>{busy ? "Updating…" : "Update password"}</Button></form></div></main>;
}

function EmailVerificationPage({ email, verified, initialError, onBack, onContinue }: { email: string; verified: boolean; initialError: string; onBack: () => void; onContinue: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendEmail, setResendEmail] = useState(email);
  const [cooldown, setCooldown] = useState(0);
  const hasEmail = Boolean(resendEmail.trim());
  const linkNeedsAttention = Boolean(initialError);

  useEffect(() => setResendEmail(email), [email]);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const resend = async () => {
    if (!hasEmail) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await resendSignupConfirmation(resendEmail);
      setNotice("A fresh verification email is on its way. The new link will open this page again.");
      setCooldown(30);
    } catch (reason: unknown) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };

  return <div className="auth-page verification-page">
    <section className="auth-story verification-story">
      <div className="auth-story-inner">
        <Logo inverse />
        <p className="eyebrow">MEASURE WITH INTENTION</p>
        <h1>One small step toward <em>better fit.</em></h1>
        <p>Confirm your email so your private measurement account stays connected to you.</p>
        <div className="story-list"><span><Icon name="mail" size={18} /> One secure verification link</span><span><Icon name="lock" size={18} /> Private account access</span><span><Icon name="arrow-right" size={18} /> Continue when you are ready</span></div>
      </div>
      <span className="story-footer">SukatAI · secure measurement workspace</span>
    </section>
    <section className="auth-form-panel"><div className="auth-form-wrap verification-card">
      <div className="verification-topline"><Badge tone={verified ? "success" : linkNeedsAttention ? "warning" : "teal"} dot>{verified ? "Verified" : linkNeedsAttention ? "Action needed" : "Email confirmation"}</Badge><span>Step 1 of 1</span></div>
      <div className={cn("verification-icon", verified && "verified", linkNeedsAttention && "needs-attention")} aria-hidden="true"><Icon name={verified ? "check" : linkNeedsAttention ? "info" : "mail"} size={26} /></div>
      <div className="auth-heading"><p className="eyebrow">{verified ? "EMAIL VERIFIED" : linkNeedsAttention ? "VERIFICATION LINK" : "CHECK YOUR INBOX"}</p><h2>{verified ? "Your email is verified." : linkNeedsAttention ? "This link needs attention." : "Confirm your email."}</h2><p>{verified ? "Your account is ready. Continue to open your secure SukatAI workroom." : linkNeedsAttention ? <>That link may have expired or already been used. Request a fresh link{hasEmail ? " below" : " to continue"}.</> : <>We sent a confirmation link to <strong>{email || "your email address"}</strong>. Open it to finish creating your account.</>}</p></div>
      {!verified && <div className="verification-steps" aria-label="Email verification steps"><div><span>1</span><p><strong>Open the email</strong><small>Look for the message from SukatAI.</small></p></div><div><span>2</span><p><strong>Confirm your address</strong><small>The link is single-purpose and secure.</small></p></div><div><span>3</span><p><strong>Return to your workroom</strong><small>Your account will be ready to use.</small></p></div></div>}
      {!verified && !hasEmail && <div className="verification-email-field"><Field label="Email address" value={resendEmail} onChange={setResendEmail} placeholder="name@domain.com" type="email" autoComplete="email" /></div>}
      {notice && <div className="form-notice" role="status" aria-live="polite"><Icon name="check" size={16} /> {notice}</div>}
      {error && <InlineError message={error} />}
      {verified ? <Button type="button" onClick={onContinue} icon="arrow-right">Continue to SukatAI</Button> : <div className="verification-actions"><Button type="button" onClick={() => void resend()} disabled={!hasEmail || busy || cooldown > 0} icon="mail">{busy ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend verification email"}</Button><button type="button" className="text-button" onClick={onBack}>Use a different email</button></div>}
      <p className="verification-note"><Icon name="shield" size={15} /> If you do not see the message, check your spam or promotions folder.</p>
    </div></section>
  </div>;
}

function InvitationWelcomePage({ session, expired = false, onBack, onContinue }: { session: Session | null; expired?: boolean; onBack: () => void; onContinue: () => void }) {
  const signedIn = Boolean(session);
  return <div className="auth-page invitation-welcome-page">
    <section className="auth-story invitation-story">
      <div className="invitation-story-top"><Logo inverse /><Badge tone="dark" dot>PRIVATE INVITE</Badge></div>
      <div className="auth-story-inner"><p className="eyebrow">YOUR WORKROOM AWAITS</p><h1>Step into a <em>better workroom.</em></h1><p>Someone has invited you to a private SukatAI dressmaking workspace built for thoughtful, reviewable work.</p><div className="story-list"><span><Icon name="users" size={18} /> See only assigned records</span><span><Icon name="ruler" size={18} /> Measurements a dressmaker can check</span><span><Icon name="lock" size={18} /> Private customer photos</span></div><div className="invitation-story-metrics"><span><strong>01</strong><small>secure invite</small></span><span><strong>07</strong><small>days to accept</small></span><span><strong>1×</strong><small>one-time access</small></span></div></div>
      <span className="story-footer">SukatAI · secure measurement workspace</span>
    </section>
    <section className="auth-form-panel"><div className="auth-form-wrap invitation-card">
      <div className="invitation-card-top"><Badge tone={expired ? "danger" : "warning"} dot>{expired ? "Link expired" : "Invitation only"}</Badge><span><Icon name="clock" size={14} /> {expired ? "Fresh link required" : "Expires in 7 days"}</span></div>
      <div className="verification-icon invite-welcome-icon" aria-hidden="true"><Icon name="mail" size={26} /></div>
      <div className="auth-heading"><p className="eyebrow">{expired ? "INVITATION LINK EXPIRED" : "SECURE INVITATION"}</p><h2>You’ve been invited.</h2><p>{expired ? "This secure email link has expired. Ask the administrator to send a new invitation, then open the fresh email." : signedIn ? <>This invitation is addressed to <strong>{session?.user.email}</strong>. Continue to review it and activate your dressmaker account.</> : "Sign in with the email address that received this invitation to continue."}</p></div>
      <div className="invite-welcome-details"><div><Icon name="shield" size={17} /><span><strong>Checked when accepted</strong><small>SukatAI checks the one-time invitation before giving access.</small></span></div><div><Icon name="users" size={17} /><span><strong>Workroom access</strong><small>See only the customers and records assigned to your organization.</small></span></div></div>
      <div className="invitation-assurance"><Icon name="lock" size={15} /><span>Your invitation is private and can only be used once.</span></div>
      {signedIn ? <Button type="button" onClick={onContinue} icon="arrow-right">Review and activate account</Button> : <Button type="button" onClick={onContinue} icon="arrow-right">{expired ? "Try signing in" : "Continue to sign in"}</Button>}
      <button type="button" className="text-button invitation-back-link" onClick={onBack}>{signedIn ? "Use a different account" : "Return to home"}</button>
    </div></section>
  </div>;
}

function InvitationAcceptPage({ token, session, profile, onBack, onAccepted }: { token: string | null; session: Session | null; profile: Profile | null; onBack: () => void; onAccepted: () => Promise<void> }) {
  const [firstName, setFirstName] = useState(profile?.first_name ?? String(session?.user.user_metadata?.first_name ?? ""));
  const [lastName, setLastName] = useState(profile?.last_name ?? String(session?.user.user_metadata?.last_name ?? ""));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupStarted, setSetupStarted] = useState(false);
  if (!session || !setupStarted) return <InvitationWelcomePage session={session} onBack={onBack} onContinue={() => setSetupStarted(true)} />;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!firstName.trim() || !lastName.trim()) { setError("Enter your first and last name."); return; }
    if (password.length < 8) { setError("Use a password with at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      await updatePassword(password);
      await acceptDressmakerInvitation({ token: token ?? undefined, firstName, lastName });
      await onAccepted();
    } catch (reason: unknown) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  };
  return <div className="auth-page invitation-auth-page"><section className="auth-story"><div className="auth-story-inner"><Logo inverse /><p className="eyebrow">YOUR WORKROOM AWAITS</p><h1>Join your <em>dressmaking team.</em></h1><p>Complete the invitation to activate your role and access only the customers assigned to your organization.</p><div className="story-list"><span><Icon name="shield" size={18} /> Invitation checked securely</span><span><Icon name="users" size={18} /> See only assigned records</span><span><Icon name="lock" size={18} /> Private customer photos</span></div></div></section><section className="auth-form-panel"><div className="auth-form-wrap"><button type="button" className="auth-back auth-back-light" onClick={onBack}><Icon name="arrow-left" size={16} /> Cancel</button><div className="auth-heading"><p className="eyebrow">DRESSMAKER INVITATION</p><h2>Set up your account</h2><p>Signed in as <strong>{session.user.email}</strong>. Choose the credentials you will use for your workroom.</p></div><form className="auth-form" onSubmit={submit}><div className="form-row"><Field label="First name" value={firstName} onChange={setFirstName} placeholder="First name" /><Field label="Last name" value={lastName} onChange={setLastName} placeholder="Last name" /></div><Field label="Password" value={password} onChange={setPassword} placeholder="At least 8 characters" type="password" autoComplete="new-password" /><Field label="Confirm password" value={confirm} onChange={setConfirm} placeholder="Repeat your password" type="password" autoComplete="new-password" />{error && <InlineError message={error} />}<Button type="submit" disabled={busy} icon={busy ? undefined : "arrow-right"}>{busy ? "Activating…" : "Activate dressmaker account"}</Button></form></div></section></div>;
}

const navByRole: Record<Role, Array<{ key: Page; label: string; icon: IconName }>> = {
  customer: [
    { key: "overview", label: "Overview", icon: "grid" },
    { key: "scan", label: "Start a scan", icon: "scan" },
    { key: "measurements", label: "My measurements", icon: "ruler" },
    { key: "orders", label: "Orders", icon: "bag" },
    { key: "fittings", label: "Fittings", icon: "calendar" },
    { key: "profile", label: "Profile", icon: "user" },
  ],
  dressmaker: [
    { key: "dashboard", label: "Dashboard", icon: "grid" },
    { key: "reviews", label: "Measurement reviews", icon: "ruler" },
    { key: "customers", label: "Customers", icon: "users" },
    { key: "orders", label: "Orders", icon: "bag" },
    { key: "fittings", label: "Fittings", icon: "calendar" },
    { key: "profile", label: "Profile", icon: "user" },
  ],
  admin: [
    { key: "dashboard", label: "Dashboard", icon: "grid" },
    { key: "customers", label: "Customers", icon: "users" },
    { key: "dressmakers", label: "Dressmakers", icon: "dress" },
    { key: "invitations", label: "Invitations", icon: "mail" },
    { key: "orders", label: "Orders", icon: "bag" },
    { key: "reports", label: "Reports", icon: "chart" },
    { key: "settings", label: "Settings", icon: "settings" },
  ],
};

const primaryNavByRole: Record<Role, Page[]> = {
  customer: ["overview", "scan", "measurements", "orders"],
  dressmaker: ["dashboard", "reviews", "customers", "orders"],
  admin: ["dashboard", "customers", "orders", "reports"],
};

function Workspace({ profile, onProfileChange, onSignOut }: { profile: Profile; onProfileChange: (profile: Profile) => void; onSignOut: () => void }) {
  const firstPage = profile.role === "customer" ? "overview" : "dashboard";
  const allowedPages = new Set(navByRole[profile.role].map((item) => item.key));
  const initialPage = (() => {
    const historyPage = window.history.state?.sukataiWorkspacePage;
    return typeof historyPage === "string" && allowedPages.has(historyPage as Page) ? historyPage as Page : firstPage as Page;
  })();
  const [page, setPage] = useState<Page>(initialPage);
  const pageRef = useRef<Page>(initialPage);
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, sukataiWorkspace: true, sukataiWorkspacePage: pageRef.current }, "", window.location.href);
    const handlePopState = (event: PopStateEvent) => {
      const historyPage = event.state?.sukataiWorkspacePage;
      const nextPage = typeof historyPage === "string" && allowedPages.has(historyPage as Page) ? historyPage as Page : firstPage as Page;
      pageRef.current = nextPage;
      setPage(nextPage);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [firstPage, profile.role]);
  const navigate = (next: string) => {
    if (!allowedPages.has(next as Page) || pageRef.current === next) return;
    const nextPage = next as Page;
    pageRef.current = nextPage;
    window.history.pushState({ ...window.history.state, sukataiWorkspace: true, sukataiWorkspacePage: nextPage }, "", window.location.href);
    setPage(nextPage);
  };
  let content: ReactNode;
  if (profile.role === "customer") {
    content = page === "scan" ? <CustomerScan profile={profile} onNavigate={navigate} /> : page === "measurements" ? <CustomerMeasurements profile={profile} onNavigate={navigate} /> : page === "orders" ? <CustomerOrders profile={profile} /> : page === "fittings" ? <CustomerFittings profile={profile} /> : page === "profile" ? <ProfilePage profile={profile} onProfileChange={onProfileChange} /> : <CustomerDashboard profile={profile} onNavigate={navigate} />;
  } else if (profile.role === "dressmaker") {
    content = page === "customers" ? <DressmakerCustomers profile={profile} /> : page === "reviews" ? <DressmakerReviews profile={profile} /> : page === "orders" ? <DressmakerOrders profile={profile} /> : page === "fittings" ? <DressmakerFittings profile={profile} /> : page === "profile" ? <ProfilePage profile={profile} onProfileChange={onProfileChange} /> : <DressmakerDashboard profile={profile} onNavigate={navigate} />;
  } else {
    content = page === "customers" ? <AdminCustomers /> : page === "dressmakers" ? <AdminDressmakers /> : page === "invitations" ? <AdminInvitations profile={profile} /> : page === "orders" ? <AdminOrders /> : page === "reports" ? <AdminReports /> : page === "settings" ? <AdminSettings profile={profile} /> : <AdminDashboard />;
  }
  return <AppShell profile={profile} page={page} onNavigate={navigate} onSignOut={onSignOut}>{content}</AppShell>;
}

function AppShell({ profile, page, onNavigate, onSignOut, children }: { profile: Profile; page: Page; onNavigate: (page: string) => void; onSignOut: () => void; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLButtonElement | null>(null);
  const notificationWrapRef = useRef<HTMLDivElement | null>(null);
  const notificationButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreWrapRef = useRef<HTMLDivElement | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const notificationPopoverId = `notifications-${useId().replaceAll(":", "")}`;
  const moreMenuId = `workspace-more-${useId().replaceAll(":", "")}`;
  const notificationsState = useAsyncData(() => getNotifications(profile.id), [profile.id], []);
  const notifications = notificationsState.data ?? [];
  const unread = notifications.filter((item) => !item.read_at).length;
  const workspaceLabel = profile.role === "customer" ? "Customer account" : profile.role === "dressmaker" ? "Dressmaker workspace" : "Administrator console";
  const go = (next: string) => { onNavigate(next); setMobileOpen(false); setMoreOpen(false); setNotificationsOpen(false); };
  const primaryItems = navByRole[profile.role].filter((item) => primaryNavByRole[profile.role].includes(item.key));
  const secondaryItems = navByRole[profile.role].filter((item) => !primaryNavByRole[profile.role].includes(item.key));
  const readNotification = async (notification: Notification) => {
    if (notification.read_at) return;
    try { await markNotificationRead(notification.id); notificationsState.reload(); } catch { /* the list remains visible if the update cannot be completed */ }
  };
  useEffect(() => {
    if (!mobileOpen && !notificationsOpen && !moreOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (notificationsOpen && notificationWrapRef.current && !notificationWrapRef.current.contains(target)) setNotificationsOpen(false);
      if (moreOpen && moreWrapRef.current && !moreWrapRef.current.contains(target)) setMoreOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (notificationsOpen) {
        setNotificationsOpen(false);
        notificationButtonRef.current?.focus();
      }
      if (moreOpen) {
        setMoreOpen(false);
        moreTriggerRef.current?.focus();
      }
      if (mobileOpen) {
        setMobileOpen(false);
        mobileMenuRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen, moreOpen, notificationsOpen]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileOpen]);

  useEffect(() => {
    const handleNativeBack = (event: Event) => {
      if (event.defaultPrevented) return;
      if (notificationsOpen) {
        setNotificationsOpen(false);
        event.preventDefault();
        return;
      }
      if (moreOpen) {
        setMoreOpen(false);
        event.preventDefault();
        return;
      }
      if (mobileOpen) {
        setMobileOpen(false);
        event.preventDefault();
        return;
      }
      if (page === "scan") return;
      const firstPage = profile.role === "customer" ? "overview" : "dashboard";
      if (page !== firstPage) {
        onNavigate(firstPage);
        event.preventDefault();
      }
    };

    window.addEventListener("sukatai:native-back", handleNativeBack);
    return () => window.removeEventListener("sukatai:native-back", handleNativeBack);
  }, [mobileOpen, moreOpen, notificationsOpen, onNavigate, page, profile.role]);

  const mobileLabel = (item: { key: Page; label: string }) => item.key === "overview" ? "Home" : item.key === "scan" ? "Scan" : item.key === "measurements" ? "Measurements" : item.key === "reviews" ? "Reviews" : item.key === "orders" ? "Orders" : item.key === "dashboard" ? "Dashboard" : item.label;
  return <div className="app-shell" data-role={profile.role}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside id="workspace-navigation" aria-label={workspaceLabel} className={cn("app-sidebar", mobileOpen && "mobile-open")}>
      <div className="sidebar-brand"><Logo compact inverse /><span className="workspace-label">{workspaceLabel}</span></div>
      <nav className="side-nav" aria-label={`${workspaceLabel} navigation`}>
        {primaryItems.map((item) => <button type="button" key={item.key} aria-label={item.key === "reviews" && unread > 0 ? `${item.label}, ${unread} unread` : item.label} aria-current={page === item.key ? "page" : undefined} className={cn("side-nav-item", page === item.key && "active")} onClick={() => go(item.key)}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.key === "reviews" && unread > 0 && <span className="nav-count" aria-hidden="true">{unread}</span>}</button>)}
        {secondaryItems.length > 0 && <div ref={moreWrapRef} className="side-nav-more">
          <button ref={moreTriggerRef} type="button" className={cn("side-nav-item", "side-nav-more-trigger", moreOpen && "active")} aria-label="Show more workspace pages" aria-expanded={moreOpen} aria-controls={moreMenuId} onClick={() => { setMoreOpen((value) => !value); setNotificationsOpen(false); }}><Icon name="chevron" size={19} /><span>More</span></button>
          {moreOpen && <div id={moreMenuId} className="side-nav-more-menu" role="region" aria-label="More workspace pages">{secondaryItems.map((item) => <button type="button" key={item.key} aria-label={item.label} aria-current={page === item.key ? "page" : undefined} className={cn("side-nav-item", page === item.key && "active")} onClick={() => go(item.key)}><Icon name={item.icon} size={19} /><span>{item.label}</span></button>)}</div>}
        </div>}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><Icon name="lock" size={15} /><span>Private by default<br /><small>Only approved people can view it</small></span></div><button type="button" className="side-nav-item logout" aria-label="Log out" onClick={onSignOut}><Icon name="logout" size={19} /><span>Log out</span></button></div>
    </aside>
    {mobileOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <div className="app-main">
      <header className="app-topbar">
        <button ref={mobileMenuRef} type="button" className="mobile-menu" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="workspace-navigation" onClick={() => setMobileOpen((value) => !value)}><Icon name="menu" size={21} /></button>
        <div className="mobile-topbar-brand"><Logo compact /></div>
        <div className="topbar-context"><span className="eyebrow">{workspaceLabel}</span><strong>{profile.organization_id ? "Your organization is connected" : profile.role === "customer" ? "Your private account" : "Ask an administrator to assign your organization"}</strong></div>
        <div className="topbar-actions">
          <div ref={notificationWrapRef} className="notification-wrap">
            <button ref={notificationButtonRef} type="button" className="icon-button notification-button" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={notificationsOpen} aria-controls={notificationPopoverId} onClick={() => { setNotificationsOpen((value) => !value); setMoreOpen(false); }}><Icon name="bell" size={20} />{unread > 0 && <span aria-hidden="true" />}</button>
            {notificationsOpen && <div id={notificationPopoverId} className="notification-popover" role="region" aria-label="Notifications"><div className="popover-heading"><strong>Notifications</strong><button type="button" className="text-button" onClick={() => { setNotificationsOpen(false); notificationButtonRef.current?.focus(); }}>Close</button></div>{notifications.length === 0 ? <p className="popover-empty">No notifications yet.</p> : notifications.map((notification) => <button type="button" key={notification.id} className={cn("notification-item", !notification.read_at && "unread")} aria-label={notification.read_at ? `Read notification: ${notification.title}` : `Mark notification as read: ${notification.title}`} onClick={() => void readNotification(notification)}><strong>{notification.title}</strong><small>{notification.body}</small><em>{formatDateTime(notification.created_at)}</em></button>)}</div>}
          </div>
          <button type="button" className="topbar-profile" aria-label={`Open ${profile.role === "admin" ? "admin settings" : "profile"}`} onClick={() => go(profile.role === "admin" ? "settings" : "profile")}><Avatar profile={profile} tone={profile.role === "admin" ? "navy" : profile.role === "dressmaker" ? "gold" : "teal"} size="sm" /><span><strong>{displayName(profile)}</strong><small>{profile.email}</small></span><Icon name="chevron" size={15} /></button>
        </div>
      </header>
      <main id="main-content" className="workspace-content" tabIndex={-1}>{children}</main>
      <nav className="mobile-bottom-nav" aria-label={`${workspaceLabel} quick navigation`}>
        {primaryItems.map((item) => <button type="button" key={item.key} aria-current={page === item.key ? "page" : undefined} className={cn(page === item.key && "active")} onClick={() => go(item.key)}><Icon name={item.icon} size={23} /><span>{mobileLabel(item)}</span></button>)}
      </nav>
    </div>
  </div>;
}

type CaptureKey = "front" | "side" | "back";
type CaptureSlot = { key: CaptureKey; label: string; captured: boolean; asset?: ScanAsset };

const captureLabels: Array<{ key: CaptureKey; label: string }> = [
  { key: "front", label: "Front" },
  { key: "side", label: "Side" },
  { key: "back", label: "Back" },
];

function emptyCaptureSlots(): CaptureSlot[] {
  return captureLabels.map((item) => ({ ...item, captured: false }));
}

function captureSlotsFromBundle(bundle: ScanBundle): CaptureSlot[] {
  return captureLabels.map((item) => ({
    ...item,
    captured: bundle.assets.some((asset) => asset.asset_type === item.key),
    asset: bundle.assets.find((asset) => asset.asset_type === item.key),
  }));
}

function storedHeightValue(value: string, unit: "cm" | "ftin", unknownHeight: boolean): number | null {
  if (unknownHeight) return null;
  if (unit === "cm") return Number(value);
  return parseHeightInches(value);
}

function heightForInput(scan: Scan): string {
  if (scan.height_value === null) return "";
  if (scan.height_unit === "cm") return String(scan.height_value);
  const inches = Math.round(scan.height_value);
  return `${Math.floor(inches / 12)}'${inches % 12}`;
}

function CustomerDashboard({ profile, onNavigate }: { profile: Profile; onNavigate: (page: string) => void }) {
  const scansState = useAsyncData(() => listCustomerScans(profile.id), [profile.id], []);
  const ordersState = useAsyncData(() => listCustomerOrders(profile.id), [profile.id], []);
  const scans = scansState.data ?? [];
  const orders = ordersState.data ?? [];
  const activeScan = scans.find((scan) => !["verified", "failed"].includes(scan.status));
  const verifiedScans = scans.filter((scan) => scan.status === "verified");
  const latestScan = activeScan ?? verifiedScans[0];
  const loading = scansState.loading || ordersState.loading;
  const error = scansState.error || ordersState.error;
  return <div className="page-stack"><SectionHeader eyebrow={`CUSTOMER WORKROOM · ${formatDate(new Date())}`} title="Your measurements" description="Start a scan or open your latest measurement record." action={<Button variant="secondary" icon="scan" onClick={() => onNavigate("scan")}>Start a scan</Button>} />{loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => { scansState.reload(); ordersState.reload(); }} /> : <><section className="welcome-banner"><div><Badge tone={verifiedScans.length > 0 ? "success" : "teal"} dot>{verifiedScans.length > 0 ? "MEASUREMENTS READY" : "ACCOUNT READY"}</Badge><h2>{verifiedScans.length > 0 ? "Your checked measurements are ready." : "Start a clearer scan."}</h2><p>{activeScan ? `Your current scan is ${scanStatusLabel(activeScan.status).toLowerCase()}.` : "Create a guided scan when you are ready. Results appear after the service checks your photos."}</p><div className="welcome-actions"><Button onClick={() => onNavigate("scan")} icon="scan">{activeScan ? "Continue scan" : "Start a scan"}</Button>{verifiedScans.length > 0 && <Button variant="secondary" onClick={() => onNavigate("orders")} icon="bag">Start an order</Button>}</div></div><div className="welcome-orbit"><div className="orbit-ring ring-a" /><div className="orbit-ring ring-b" /><span><Icon name="ruler" size={27} /></span></div></section><div className="stats-grid four-stats"><StatCard icon="scan" label="Scans" value={String(scans.length)} detail={activeScan ? scanStatusLabel(activeScan.status) : latestScan ? "Ready to review" : "No active scan"} onClick={() => onNavigate("scan")} /><StatCard icon="ruler" label="Checked sets" value={String(verifiedScans.length)} detail={verifiedScans.length ? "Ready to share" : "Not available yet"} onClick={() => onNavigate("measurements")} /><StatCard icon="bag" label="Orders" value={String(orders.length)} detail={orders.length ? "From your account" : "No orders yet"} onClick={() => onNavigate("orders")} /><StatCard icon="calendar" label="Fittings" value="—" detail="No fitting requests" onClick={() => onNavigate("fittings")} /></div><div className="dashboard-grid"><Panel className="latest-measurement"><div className="panel-heading"><div><p className="eyebrow">LATEST ACTIVITY</p><h2>{latestScan ? latestScan.status === "verified" ? "Latest measurement" : "Current scan" : "No measurements yet"}</h2></div>{latestScan && <StatusBadge status={latestScan.status} />}</div>{latestScan ? <div className="status-card"><span className="status-card-icon"><Icon name={latestScan.status === "verified" ? "ruler" : "scan"} size={22} /></span><div><strong>{latestScan.status === "verified" ? `Measurements checked ${formatDate(latestScan.updated_at)}` : `Scan created ${formatDate(latestScan.created_at)}`}</strong><p>{latestScan.status === "verified" ? "Your checked measurement set is ready to review or share with your dressmaker." : latestScan.status === "processing_queued" || latestScan.status === "processing" ? "Your uploaded views are waiting while the service checks them." : "Continue the guided flow to add or review your views."}</p></div><Button variant="ghost" onClick={() => onNavigate(latestScan.status === "verified" ? "measurements" : "scan")} icon="arrow-right">{latestScan.status === "verified" ? "Open measurements" : "Open scan"}</Button></div> : <DataState icon="ruler" title="No measurements yet" body="Start a scan to create your first private measurement record." action={<Button onClick={() => onNavigate("scan")} icon="scan">Start a scan</Button>} />}</Panel><Panel className="scan-prompt"><p className="eyebrow">HOW IT WORKS</p><h2>A guided path from capture to review.</h2><div className="mini-steps"><span><i>01</i><b>Capture</b><small>Front, side, back</small></span><span><i>02</i><b>Check</b><small>Measurements</small></span><span><i>03</i><b>Review</b><small>Dressmaker check</small></span></div><button type="button" className="text-button" onClick={() => onNavigate("scan")}>Open photo guide <Icon name="arrow-right" size={15} /></button></Panel></div></>}</div>;
}

function StatCard({ icon, label, value, detail, onClick }: { icon: IconName; label: string; value: string; detail: string; onClick?: () => void }) {
  const content = <><span className="stat-icon"><Icon name={icon} size={19} /></span><span className="stat-copy"><small>{label}</small><strong>{value}</strong><em>{detail}</em></span>{onClick && <Icon name="arrow-right" size={15} />}</>;
  return onClick ? <button type="button" className="stat-card stat-card-clickable" onClick={onClick} aria-label={`${label}: ${value}. ${detail}`}>{content}</button> : <div className="stat-card">{content}</div>;
}

function ScanProgress({ step }: { step: ScanStep }) {
  const current = scanSteps.findIndex((item) => item.key === step);
  const currentLabel = scanSteps[current]?.label ?? "Current step";
  return <nav className="scan-progress" aria-label="Scan progress"><p className="sr-only">Step {Math.max(current + 1, 1)} of {scanSteps.length}: {currentLabel}</p><ol>{scanSteps.map((item, index) => <li key={item.key} className={cn("scan-progress-step", index === current && "active", index < current && "complete")} aria-current={index === current ? "step" : undefined}><span aria-hidden="true">{index < current ? <Icon name="check" size={15} /> : index + 1}</span><i aria-hidden="true" /><small>{item.label}</small></li>)}</ol></nav>;
}

function CustomerScan({ profile, onNavigate }: { profile: Profile; onNavigate: (page: string) => void }) {
  const [step, setStep] = useState<ScanStep>("prep");
  const [scanId, setScanId] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [height, setHeight] = useState("");
  const [unit, setUnit] = useState<"cm" | "ftin">(profile.unit_system);
  const [unknownHeight, setUnknownHeight] = useState(false);
  const [prep, setPrep] = useState([false, false, false, false]);
  const [consent, setConsent] = useState([false, false]);
  const [captureIndex, setCaptureIndex] = useState(0);
  const [captures, setCaptures] = useState<CaptureSlot[]>(emptyCaptureSlots());
  const [cameraOn, setCameraOn] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [processingNotice, setProcessingNotice] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  const hydrateBundle = (bundle: ScanBundle) => {
    setScan(bundle.scan);
    setScanId(bundle.scan.id);
    setHeight(heightForInput(bundle.scan));
    setUnit(bundle.scan.height_unit);
    setCaptures(captureSlotsFromBundle(bundle));
    const nextIndex = captureLabels.findIndex((item) => !bundle.assets.some((asset) => asset.asset_type === item.key));
    setCaptureIndex(nextIndex === -1 ? 2 : nextIndex);
  };

  useEffect(() => {
    let active = true;
    listCustomerScans(profile.id).then(async (scans) => {
      const resumable = scans.find((item) => ["draft", "uploaded", "needs_recapture", "processing_queued", "processing", "ready_for_review"].includes(item.status));
      if (resumable) {
        const bundle = await getScanBundle(resumable.id, true);
        if (!active) return;
        hydrateBundle(bundle);
        setStep(bundle.scan.status === "needs_recapture" ? "capture" : bundle.scan.status === "processing_queued" || bundle.scan.status === "processing" ? "processing" : bundle.scan.status === "ready_for_review" ? "results" : bundle.assets.length > 0 ? "capture" : "prep");
      }
    }).catch((reason: unknown) => { if (active) setError(readableError(reason)); }).finally(() => { if (active) setHydrating(false); });
    return () => { active = false; };
  }, [profile.id]);

  useEffect(() => {
    if (cameraOn && videoRef.current) videoRef.current.srcObject = streamRef.current;
  }, [cameraOn]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseCamera();
    };
  }, []);

  /* Keep camera hardware and the video element in sync when leaving the capture step. */
  useEffect(() => {
    if (!cameraOn && videoRef.current) videoRef.current.srcObject = null;
  }, [cameraOn]);

  useEffect(() => {
    const stopCameraForLifecycle = () => {
      if (!streamRef.current) return;
      releaseCamera();
      setCameraOn(false);
    };
    const stopWhenHidden = () => {
      if (document.hidden) stopCameraForLifecycle();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    window.addEventListener("pagehide", stopCameraForLifecycle);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      window.removeEventListener("pagehide", stopCameraForLifecycle);
    };
  }, []);

  function releaseCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function stopCamera() {
    releaseCamera();
    setCameraOn(false);
  }

  const continueFromPrep = async () => {
    setError("");
    if (!prep.every(Boolean) || !consent.every(Boolean)) { setError("Complete the preparation and consent checks before continuing."); return; }
    setBusy(true);
    try {
      const created = await createScan({ customerId: profile.id, organizationId: profile.organization_id, heightValue: null, heightUnit: unit, consentAt: new Date().toISOString(), captureSource: "upload" });
      setScan(created);
      setScanId(created.id);
      setStep("height");
      setNotice("Scan draft created securely.");
    } catch (reason: unknown) { setError(readableError(reason)); } finally { setBusy(false); }
  };

  const continueFromHeight = async () => {
    setError("");
    if (!isHeightValid(height, unit, unknownHeight)) { setError(unit === "cm" ? "Enter a height between 120 and 230 cm, or choose unknown." : "Enter a height between 4'0\" and 7'11\", or choose unknown."); return; }
    if (!scanId) { setError("Your scan draft is missing. Return to preparation and start again."); return; }
    setBusy(true);
    try {
      const updated = await updateScan(scanId, { height_value: storedHeightValue(height, unit, unknownHeight), height_unit: unit });
      setScan(updated);
      setStep("capture");
      setNotice("");
    } catch (reason: unknown) { setError(readableError(reason)); } finally { setBusy(false); }
  };

  const uploadForCurrentSlot = async (file: File, source: "camera" | "upload") => {
    if (!scanId) { setError("Your scan draft is missing. Return to preparation and start again."); return; }
    const validation = validateUpload(file);
    if (!validation.valid) { setError(validation.message); return; }
    const slot = captures[captureIndex];
    if (!slot) return;
    const previousAsset = slot.asset;
    setUploading(true);
    setError("");
    try {
      const asset = await uploadScanAsset({ scanId, customerId: profile.id, organizationId: profile.organization_id, assetType: slot.key, file });
      if (previousAsset) {
        try { await deleteScanAsset(previousAsset); } catch { /* Keep the new capture even if cleanup of the previous asset is delayed. */ }
      }
      const updated = await updateScan(scanId, { status: "uploaded", capture_source: source });
      setScan(updated);
      setCaptures((current) => current.map((item, index) => index === captureIndex ? { ...item, captured: true, asset } : item));
      setNotice(`${slot.label} view uploaded securely.`);
      if (captureIndex < captureLabels.length - 1) setCaptureIndex((index) => index + 1);
    } catch (reason: unknown) { setError(readableError(reason)); } finally { setUploading(false); }
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (file) await uploadForCurrentSlot(file, "upload");
  };

  const startCamera = async () => {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not available in this browser. Use the upload option instead.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      releaseCamera();
      streamRef.current = stream;
      setCameraOn(true);
    } catch (reason: unknown) {
      if (!mountedRef.current) return;
      const cameraErrorName = typeof DOMException !== "undefined" && reason instanceof DOMException ? reason.name : "";
      const cameraMessage = cameraErrorName === "NotAllowedError" || cameraErrorName === "PermissionDeniedError"
        ? "Camera access was denied. Allow camera access in your device settings, or use Upload image instead."
        : cameraErrorName === "NotFoundError"
          ? "No camera was found on this device. Use Upload image instead."
          : cameraErrorName === "NotReadableError" || cameraErrorName === "AbortError"
            ? "The camera is busy or unavailable. Close other camera apps and try again, or use Upload image instead."
            : cameraErrorName === "SecurityError"
              ? "Camera access is unavailable in this context. Use Upload image instead."
              : readableError(reason);
      setError(cameraMessage);
    }
  };

  const captureCameraFrame = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) { setError("The camera is not ready yet. Try again in a moment or upload an image."); return; }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) { setError("The camera frame could not be captured."); return; }
    await uploadForCurrentSlot(new File([blob], `${captures[captureIndex]?.key ?? "capture"}.jpg`, { type: "image/jpeg" }), "camera");
  };

  const completeCapture = async () => {
    setError("");
    if (!scanId || captures.some((item) => !item.captured)) { setError("Upload a front, side, and back view before continuing."); return; }
    stopCamera();
    setBusy(true);
    setStep("processing");
    try {
      await updateScan(scanId, { status: "processing_queued" });
      const result = await requestScanProcessing(scanId);
      setProcessingNotice(result.message);
      if (result.status === "failed") setError(result.message);
      if (result.status === "ready") setStep("results");
    } catch (reason: unknown) { setProcessingNotice(readableError(reason)); } finally { setBusy(false); }
  };

  const goBack = () => {
    const position = previousScanPosition(step, captureIndex);
    setStep(position.step);
    setCaptureIndex(position.captureIndex);
    setError("");
  };

  useEffect(() => {
    const handleNativeBack = (event: Event) => {
      if (event.defaultPrevented) return;
      if (cameraOn) {
        stopCamera();
        event.preventDefault();
        return;
      }
      if (step !== "prep") {
        goBack();
        event.preventDefault();
        return;
      }
      onNavigate("overview");
      event.preventDefault();
    };

    window.addEventListener("sukatai:native-back", handleNativeBack);
    return () => window.removeEventListener("sukatai:native-back", handleNativeBack);
  }, [cameraOn, captureIndex, onNavigate, step]);

  if (hydrating) return <div className="page-stack"><SectionHeader eyebrow="GUIDED SCAN" title="Start a new scan" description="Loading any unfinished scan securely…" /><LoadingState /></div>;
  return <div className="page-stack"><SectionHeader eyebrow="GUIDED SCAN" title="Start a new scan" description="Three guided views, a private upload, and a reviewable result." action={step !== "prep" ? <Button variant="ghost" icon="arrow-left" onClick={goBack}>Back</Button> : <Button variant="secondary" icon="x" onClick={() => onNavigate("overview")}>Exit scan</Button>} /><ScanProgress step={step} />{error && <InlineError message={error} />}{notice && <div className="form-notice scan-notice" role="status" aria-live="polite"><Icon name="check" size={16} /> {notice}</div>}{step === "prep" && <ScanPreparation prep={prep} consent={consent} setPrep={setPrep} setConsent={setConsent} onContinue={continueFromPrep} busy={busy} />}{step === "height" && <ScanHeight height={height} unit={unit} unknownHeight={unknownHeight} setHeight={setHeight} setUnit={setUnit} setUnknownHeight={setUnknownHeight} onContinue={continueFromHeight} busy={busy} />}{step === "capture" && <ScanCapture captures={captures} captureIndex={captureIndex} setCaptureIndex={setCaptureIndex} cameraOn={cameraOn} videoRef={videoRef} uploading={uploading} onStartCamera={() => void startCamera()} onStopCamera={stopCamera} onCapture={() => void captureCameraFrame()} onChooseFile={(event) => void chooseFile(event)} onRemove={async (index) => { const asset = captures[index]?.asset; if (!asset) return; try { await deleteScanAsset(asset); setCaptures((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, captured: false, asset: undefined } : item)); setNotice(`${captures[index].label} view removed.`); } catch (reason: unknown) { setError(readableError(reason)); } }} onContinue={() => void completeCapture()} busy={busy} />}{step === "processing" && scanId && <ScanProcessing scanId={scanId} initialMessage={processingNotice} onBack={() => { setStep("capture"); setCaptureIndex(2); }} onResults={() => setStep("results")} />}{step === "results" && scanId && <ScanResults scanId={scanId} onRecapture={() => { setStep("capture"); setCaptureIndex(0); }} onDashboard={() => onNavigate("overview")} />}</div>;
}

function ScanPreparation({ prep, consent, setPrep, setConsent, onContinue, busy }: { prep: boolean[]; consent: boolean[]; setPrep: (value: boolean[]) => void; setConsent: (value: boolean[]) => void; onContinue: () => void; busy: boolean }) {
  const prepItems = ["Use bright, even lighting.", "Stand far enough back to show your whole body.", "Wear fitted clothing without a bulky jacket.", "Keep your phone steady at chest height."];
  const consentItems = ["I agree to keep these scan photos in my private account.", "I understand that a dressmaker should check the measurements before sewing."];
  return <div className="scan-content"><Panel className="scan-main-card"><p className="eyebrow">STEP 01 · PREPARE</p><h2>Get ready for three photos.</h2><p className="panel-lede">A few simple checks help us create a clearer fit record for you and your dressmaker.</p><div className="checklist" role="group" aria-label="Photo preparation checklist">{prepItems.map((item, index) => <label key={item} className="check-row"><input type="checkbox" checked={prep[index]} onChange={(event) => setPrep(prep.map((value, itemIndex) => itemIndex === index ? event.target.checked : value))} /><span><i aria-hidden="true">{index + 1}</i><strong>{item}</strong></span></label>)}</div><div className="consent-box" role="group" aria-label="Privacy and review agreement"><p className="eyebrow">BEFORE YOU CONTINUE</p>{consentItems.map((item, index) => <label key={item} className="check-label"><input type="checkbox" checked={consent[index]} onChange={(event) => setConsent(consent.map((value, itemIndex) => itemIndex === index ? event.target.checked : value))} /><span>{item}</span></label>)}</div><Button onClick={onContinue} disabled={busy} icon={busy ? undefined : "arrow-right"}>{busy ? "Creating secure draft…" : "Continue to height"}</Button></Panel><Panel className="scan-side-card"><span className="side-card-icon"><Icon name="shield" size={20} /></span><h3>Your photos stay private.</h3><p>Nothing is uploaded until you continue. Each view is saved securely with this scan and shared only with authorized reviewers.</p><div className="side-card-list"><span><Icon name="lock" size={15} /> Private account access</span><span><Icon name="camera" size={15} /> Camera or upload</span><span><Icon name="message" size={15} /> Review when ready</span></div></Panel></div>;
}

function ScanHeight({ height, unit, unknownHeight, setHeight, setUnit, setUnknownHeight, onContinue, busy }: { height: string; unit: "cm" | "ftin"; unknownHeight: boolean; setHeight: (value: string) => void; setUnit: (value: "cm" | "ftin") => void; setUnknownHeight: (value: boolean) => void; onContinue: () => void; busy: boolean }) {
  return <div className="calibration-card"><div className="calibration-visual" aria-hidden="true"><div className="height-grid" /><div className="height-ruler"><span>230</span><span>200</span><span>170</span><span>140</span><span>120</span></div><div className="height-person"><i /><b /><span /><em /><strong /></div><div className="height-line" /></div><div className="calibration-copy"><p className="eyebrow">STEP 02 · HEIGHT</p><h2>Tell us your height.</h2><p>Height helps us size the body model. Use your usual unit, or choose “I don’t know” if you would rather leave it blank.</p><div className="unit-toggle" role="group" aria-label="Height unit"><button type="button" aria-pressed={unit === "cm"} className={unit === "cm" ? "active" : ""} onClick={() => setUnit("cm")}>Centimetres</button><button type="button" aria-pressed={unit === "ftin"} className={unit === "ftin" ? "active" : ""} onClick={() => setUnit("ftin")}>Feet / inches</button></div><div className="field"><label htmlFor="height-value">Height</label><input id="height-value" name="height" aria-describedby="height-help" value={height} onChange={(event) => setHeight(event.target.value)} disabled={unknownHeight} placeholder={unit === "cm" ? "e.g. 170" : "e.g. 5'7\""} /><small id="height-help" className="field-hint">{unit === "cm" ? "Enter between 120 and 230 cm." : "Enter between 4'0\" and 7'11\"."}</small></div><label className="check-label"><input name="height-unknown" type="checkbox" checked={unknownHeight} onChange={(event) => setUnknownHeight(event.target.checked)} /><span>I don’t know my height</span></label><Button onClick={onContinue} disabled={busy} icon={busy ? undefined : "arrow-right"}>{busy ? "Saving height…" : "Continue to photos"}</Button></div></div>;
}

function ScanCapture({ captures, captureIndex, setCaptureIndex, cameraOn, videoRef, uploading, onStartCamera, onStopCamera, onCapture, onChooseFile, onRemove, onContinue, busy }: { captures: CaptureSlot[]; captureIndex: number; setCaptureIndex: (index: number) => void; cameraOn: boolean; videoRef: React.RefObject<HTMLVideoElement | null>; uploading: boolean; onStartCamera: () => void; onStopCamera: () => void; onCapture: () => void; onChooseFile: (event: ChangeEvent<HTMLInputElement>) => void; onRemove: (index: number) => Promise<void>; onContinue: () => void; busy: boolean }) {
  const current = captures[captureIndex] ?? captures[0];
  const currentUrl = current?.asset?.signedUrl;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return <div className="capture-layout"><Panel className="capture-stage-card"><div className="capture-stage-heading"><div><p className="eyebrow">STEP 03 · PHOTOS</p><h2>{current?.label ?? "Front"} view</h2><p>Keep your whole body in frame. You can replace any photo before submitting.</p></div><Badge tone={current?.captured ? "success" : "teal"} dot>{current?.captured ? "UPLOADED" : "READY"}</Badge></div><p className="sr-only" role="status" aria-live="polite">Viewing {current?.label ?? "Front"} view. {current?.captured ? "This view is uploaded." : "This view is ready for capture."}</p><div className={cn("capture-stage", currentUrl && "has-capture")} role="region" aria-label={`${current?.label ?? "Front"} camera capture area`}>{cameraOn && <video ref={videoRef} autoPlay muted playsInline className="capture-video" aria-label="Live camera preview" />}{!cameraOn && currentUrl && <img className="capture-preview" src={currentUrl} alt={`${current?.label} scan view`} />}{!cameraOn && !currentUrl && <div className="capture-empty"><span><Icon name="camera" size={31} /></span><strong>Camera or upload</strong><small>Your selected view will appear here after a successful upload.</small></div>}{cameraOn && <div className="capture-guide" aria-hidden="true"><span /><span /><span /></div>}</div><div className="capture-controls"><div className="capture-progress"><p className="eyebrow">VIEWS</p><div>{captures.map((slot, index) => <button key={slot.key} type="button" className={cn(index === captureIndex && "current", slot.captured && "done")} aria-current={index === captureIndex ? "step" : undefined} aria-label={`${slot.label} view${slot.captured ? ", uploaded" : ""}`} onClick={() => setCaptureIndex(index)}><i>{slot.captured ? <Icon name="check" size={12} /> : index + 1}</i><small>{slot.label}</small></button>)}</div></div><div className="capture-actions">{cameraOn ? <><Button variant="secondary" onClick={onStopCamera} icon="x">Stop camera</Button><Button onClick={onCapture} disabled={uploading} icon="camera">{uploading ? "Uploading…" : "Capture frame"}</Button></> : <><input ref={fileInputRef} className="sr-only" type="file" aria-label={"Upload " + (current?.label ?? "current") + " scan photo"} accept="image/jpeg,image/png,image/webp" onChange={onChooseFile} /><Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading} icon="upload">{uploading ? "Uploading…" : "Upload image"}</Button><Button variant="ghost" onClick={onStartCamera} disabled={uploading} icon="camera">Use camera</Button></>}</div></div></Panel><div className="capture-side"><Panel className="capture-next"><p className="eyebrow">NEXT STEP</p><h3>{captures.every((slot) => slot.captured) ? "All three views are ready." : `Add the ${captures.find((slot) => !slot.captured)?.label.toLowerCase() ?? "next"} view.`}</h3><p>{captures.every((slot) => slot.captured) ? "Submit these photos when they look clear. We will check the result before showing measurements." : "Move between Front, Side, and Back to add or replace a photo."}</p><Button onClick={onContinue} disabled={busy || uploading || captures.some((slot) => !slot.captured)} icon="arrow-right">{busy ? "Submitting…" : "Submit photos"}</Button></Panel><Panel className="capture-quality"><p className="eyebrow">PHOTO CHECKLIST</p><div className="quality-list"><span><Icon name="check" size={14} /> JPG, PNG, or WebP</span><span><Icon name="check" size={14} /> Maximum 10 MB each</span><span><Icon name="lock" size={14} /> Stored privately</span></div><div className="uploaded-list">{captures.map((slot, index) => <div key={slot.key}><span className={slot.captured ? "uploaded" : "not-uploaded"}><Icon name={slot.captured ? "check" : "clock"} size={12} /></span><span><strong>{slot.label}</strong><small>{slot.captured ? "Uploaded" : "Waiting"}</small></span>{slot.captured && <button type="button" className="icon-button" aria-label={`Remove ${slot.label} view`} onClick={() => void onRemove(index)}><Icon name="x" size={14} /></button>}</div>)}</div></Panel></div></div>;
}

function ScanProcessing({ scanId, initialMessage, onBack, onResults }: { scanId: string; initialMessage: string; onBack: () => void; onResults: () => void }) {
  const [bundle, setBundle] = useState<ScanBundle | null>(null);
  const [error, setError] = useState("");
  const [serviceMessage, setServiceMessage] = useState(initialMessage);
  const [requesting, setRequesting] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const refresh = async () => {
    const next = await getScanBundle(scanId);
    if (!mountedRef.current) return;
    setBundle(next);
    if (next.scan.status === "ready_for_review" || next.scan.status === "verified") onResults();
  };
  useEffect(() => {
    const unsubscribe = subscribeToNodeScan(scanId, (event) => {
      if (!mountedRef.current) return;
      setServiceMessage(event.message);
      void refresh().catch((reason: unknown) => {
        if (mountedRef.current) setError(readableError(reason));
      });
    });
    return unsubscribe;
  }, [scanId]);
  useEffect(() => {
    let active = true;
    const loadAndKickQueuedScan = async () => {
      const next = await getScanBundle(scanId);
      if (!active || !mountedRef.current) return;
      setBundle(next);
      if (next.scan.status === "ready_for_review" || next.scan.status === "verified") {
        onResults();
        return;
      }
      if (next.scan.status !== "processing_queued") return;
      const result = await requestScanProcessing(scanId);
      if (!active || !mountedRef.current) return;
      setServiceMessage(result.message);
      await refresh();
    };
    void loadAndKickQueuedScan().catch((reason: unknown) => { if (active) setError(readableError(reason)); });
    return () => { active = false; };
  }, [scanId]);
  useEffect(() => {
    if (!bundle || !["processing_queued", "processing"].includes(bundle.scan.status)) return undefined;
    const interval = window.setInterval(() => { void refresh().catch((reason: unknown) => { if (mountedRef.current) setError(readableError(reason)); }); }, 5000);
    return () => window.clearInterval(interval);
  }, [bundle?.scan.status, scanId]);
  const retry = async () => {
    setRequesting(true);
    setError("");
    try {
      const result = await requestScanProcessing(scanId);
      if (mountedRef.current) setServiceMessage(result.message);
      await refresh();
    } catch (reason: unknown) { if (mountedRef.current) setError(readableError(reason)); } finally { if (mountedRef.current) setRequesting(false); }
  };
  const status = bundle?.scan.status ?? "processing_queued";
  const copy = processingCopy(status);
  const unavailable = serviceMessage.toLowerCase().includes("unavailable");
  const localMode = bundle?.scan.processing_provider === "local";
  const progressLevel = unavailable || status === "failed" ? "blocked" : status === "processing" ? "processing" : "queued";
  const progressLabel = progressLevel === "blocked" ? "Processing needs your attention" : progressLevel === "processing" ? "Processing is in progress" : "Waiting to start";
  const statusDetail = unavailable
    ? "The processing service is unavailable. Your photos are safe. Try again or return to your uploads."
    : status === "processing"
      ? "We are checking your photos. We’ll move you to review when measurements are ready."
      : "Your photos are stored securely while processing starts. We’ll keep checking for a result.";
  return <div className="processing-layout"><Panel className="processing-card"><div className="processing-visual" aria-hidden="true"><div className="processing-orbit orbit-one" /><div className="processing-orbit orbit-two" /><span className="processing-core"><Icon name={status === "failed" ? "info" : unavailable ? "clock" : "spark"} size={29} /></span><span className="processing-marker marker-one" /><span className="processing-marker marker-two" /><span className="processing-marker marker-three" /></div><div className="processing-copy"><div className="processing-heading"><Badge tone={status === "failed" ? "danger" : unavailable ? "warning" : status === "processing" ? "blue" : "teal"} dot>{status === "failed" ? "FAILED" : unavailable ? "SERVICE UNAVAILABLE" : status === "processing" ? "PROCESSING" : "QUEUED"}</Badge><span>Step 04 of 05</span></div><p className="eyebrow">STEP 04 · PROCESSING</p><h2>{unavailable ? "Processing unavailable" : copy.title}</h2><p className="processing-status" role="status" aria-live="polite">{serviceMessage || copy.body}</p><div className={cn("processing-status-card", progressLevel === "blocked" ? "blocked" : progressLevel === "processing" ? "active" : "queued")} role="status" aria-live="polite"><span className="processing-status-dot" aria-hidden="true" /><div><strong>{progressLabel}</strong><span>{statusDetail}</span></div></div>{status === "failed" && <p className="processing-failure">{bundle?.scan.failure_reason ?? "The processing service did not return a valid result."}</p>}<div className="processing-actions"><Button variant="secondary" onClick={onBack} icon="arrow-left">Back to uploads</Button>{status === "failed" || unavailable ? <Button onClick={() => void retry()} disabled={requesting} icon="refresh">{requesting ? "Retrying…" : "Try processing again"}</Button> : <Button variant="ghost" onClick={() => void refresh()} icon="refresh">Check status</Button>}</div></div></Panel><Panel className="processing-details"><div className="detail-line"><Icon name="lock" size={18} /><span><strong>Photos stored privately</strong><small>Signed access is used for authorized processing and review.</small></span></div><div className="detail-line"><Icon name="target" size={18} /><span><strong>{localMode ? "Demo result clearly labeled" : "No invented results"}</strong><small>{localMode ? "The local simulator is illustrative; a dressmaker must verify the estimates." : "Measurements appear only after provider validation."}</small></span></div><div className="detail-line"><Icon name="clock" size={18} /><span><strong>Current status</strong><small>{scanStatusLabel(status)} · last checked {formatDateTime(bundle?.scan.updated_at)}</small></span></div>{error && <InlineError message={error} />}</Panel></div>;
}

const resultTabOptions: Array<{ key: "measurements" | "photos" | "activity"; label: string }> = [
  { key: "measurements", label: "Measurements" },
  { key: "photos", label: "Private photos" },
  { key: "activity", label: "Activity" },
];

function matchesMeasurementKey(measurement: Measurement, key: string): boolean {
  const normalized = measurement.key.toLowerCase();
  return normalized === key || normalized.startsWith(`${key}_`);
}

function highlightMeasurements(measurements: Measurement[]): Measurement[] {
  const preferred = ["chest", "bust", "waist", "hip", "inseam", "shoulder"];
  const selected: Measurement[] = [];
  preferred.forEach((key) => {
    const match = measurements.find((measurement) => matchesMeasurementKey(measurement, key));
    if (match && !selected.some((item) => item.id === match.id)) selected.push(match);
  });
  return [...selected, ...measurements.filter((measurement) => !selected.some((item) => item.id === measurement.id))].slice(0, 4);
}

function MeasurementHighlights({ measurements, selectedId, onSelect }: { measurements: Measurement[]; selectedId?: string | null; onSelect?: (measurement: Measurement) => void }) {
  const highlights = highlightMeasurements(measurements);
  if (highlights.length === 0) return null;
  return <div className="measurement-highlights" aria-label="Key measurements. Select one to show its guide on the model.">{highlights.map((measurement) => { const content = <><span>{displayMeasurementKey(measurement.key)}</span><strong>{displayMeasurementValue(measurement)}</strong><small>{measurementConfidenceText(measurement.confidence)}</small>{onSelect && <em>Show on model <Icon name="arrow-right" size={12} /></em>}</>; return onSelect ? <button type="button" className={cn("measurement-highlight", selectedId === measurement.id && "selected")} key={measurement.id} aria-pressed={selectedId === measurement.id} aria-label={"Show " + displayMeasurementKey(measurement.key) + " on the 3D model"} onClick={() => onSelect(measurement)}>{content}</button> : <article className="measurement-highlight" key={measurement.id}>{content}</article>; })}</div>;
}

function ScanResults({ scanId, onRecapture, onDashboard }: { scanId: string; onRecapture: () => void; onDashboard: () => void }) {
  const state = useAsyncData(() => getScanBundle(scanId, true), [scanId]);
  const bundle = state.data;
  const [tab, setTab] = useState<"measurements" | "photos" | "activity">("measurements");
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const tabsId = useId();
  const reportedConfidence = bundle?.measurements.flatMap((item) => item.confidence === null ? [] : [item.confidence]) ?? [];
  const averageConfidence = reportedConfidence.length > 0 ? reportedConfidence.reduce((sum, value) => sum + value, 0) / reportedConfidence.length : null;
  const localDemo = bundle?.scan.processing_provider === "local" || bundle?.bodyModel?.provider === "local";
  if (state.loading) return <LoadingState label="Loading your scan result…" />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!bundle) return <ErrorState message="The scan record was not returned." />;
  const requestRecapture = async () => {
    setActionBusy(true); setActionError("");
    try { await updateScan(scanId, { status: "needs_recapture" }); onRecapture(); } catch (reason: unknown) { setActionError(readableError(reason)); } finally { setActionBusy(false); }
  };
  const sendToReview = async () => {
    setActionBusy(true); setActionError("");
    try { await updateScan(scanId, { status: "ready_for_review" }); state.reload(); } catch (reason: unknown) { setActionError(readableError(reason)); } finally { setActionBusy(false); }
  };
  const focusTab = (nextIndex: number) => {
    const nextTab = resultTabOptions[(nextIndex + resultTabOptions.length) % resultTabOptions.length];
    setTab(nextTab.key);
    window.setTimeout(() => document.getElementById(`${tabsId}-${nextTab.key}`)?.focus(), 0);
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") { event.preventDefault(); focusTab(index + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); focusTab(index - 1); }
    if (event.key === "Home") { event.preventDefault(); focusTab(0); }
    if (event.key === "End") { event.preventDefault(); focusTab(resultTabOptions.length - 1); }
  };
  const panelId = `${tabsId}-panel`;
  const reviewSent = bundle.scan.status === "ready_for_review" || bundle.scan.status === "verified";
  const focusMeasurement = (measurement: Measurement) => {
    if (!measurementGuideKey(measurement.key)) return;
    setSelectedMeasurementId(measurement.id);
    setTab("measurements");
    window.setTimeout(() => {
      const modelRegion = document.getElementById("model-3d-region");
      if (!modelRegion) return;
      modelRegion.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      const canvas = modelRegion.querySelector("canvas") as HTMLCanvasElement | null;
      const focusTarget = canvas && canvas.tabIndex >= 0 ? canvas : modelRegion;
      focusTarget.focus({ preventScroll: true });
    }, 0);
  };
  return <div className="results-layout"><Panel className="results-viewer"><div className="viewer-top"><div><p className="eyebrow">SCAN {bundle.scan.id.slice(0, 8).toUpperCase()}</p><h2>3D body model</h2><p className="viewer-subtitle">Drag the model to turn it, or select a measurement to show its guide.</p></div><StatusBadge status={bundle.scan.status} /></div><>{bundle.measurements.length > 0 ? <ModelViewer model={bundle.bodyModel} measurements={bundle.measurements} heightValue={bundle.scan.height_value} heightUnit={bundle.scan.height_unit} focusedMeasurementKey={bundle.measurements.find((measurement) => measurement.id === selectedMeasurementId)?.key ?? null} /> : <div className="model-no-result" role="status"><span className="model-empty-icon"><Icon name="ruler" size={25} /></span><h3>Your model will appear here</h3><p>Measurements will show after processing returns a valid result.</p></div>}</><div className="viewer-note"><Icon name="lock" size={14} /> Model assets are available only through authorized access.</div></Panel><Panel className="results-panel"><div className="results-summary"><span className="result-summary-icon"><Icon name="ruler" size={23} /></span><div className="results-summary-content"><div className="results-summary-heading"><Badge tone={localDemo ? "warning" : "teal"} dot>{bundle.measurements.length > 0 ? localDemo ? "SAMPLE RESULT" : "MEASUREMENT RESULT" : "RESULT PENDING"}</Badge><span>{bundle.measurements.length} measurements</span></div><h3>{bundle.measurements.length > 0 ? localDemo ? "Sample measurements are ready" : "Measurements are ready to check" : "No measurements yet"}</h3><p>{bundle.measurements.length > 0 ? localDemo ? "These are sample measurements. Have a dressmaker check them before tailoring." : "Check the measurements below before sending them to your dressmaker." : "Measurements are not ready yet. The service has not returned a valid result for this scan."}</p></div></div>{bundle.measurements.length > 0 && <MeasurementHighlights measurements={bundle.measurements} selectedId={selectedMeasurementId} onSelect={focusMeasurement} />}<p className="measurement-selection-hint"><Icon name="info" size={15} /> Select any measurement row to show its guide on the model.</p><div className="results-tabs" role="tablist" aria-label="Scan result details">{resultTabOptions.map((option, index) => <button key={option.key} id={`${tabsId}-${option.key}`} type="button" role="tab" aria-selected={tab === option.key} aria-controls={panelId} tabIndex={tab === option.key ? 0 : -1} className={tab === option.key ? "active" : ""} onClick={() => setTab(option.key)} onKeyDown={(event) => onTabKeyDown(event, index)}>{option.label}</button>)}</div><div id={panelId} role="tabpanel" tabIndex={0} aria-labelledby={`${tabsId}-${tab}`} className="results-tab-panel">{tab === "measurements" && <>{bundle.measurements.length === 0 ? <DataState icon="ruler" title="Waiting for measurements" body="This area will fill after the service returns a checked measurement result." /> : <><dl className="result-facts"><div><dt>Measurements</dt><dd>{bundle.measurements.length}</dd></div><div><dt>Height reference</dt><dd>{bundle.scan.height_value === null ? "Not provided" : `${bundle.scan.height_value} ${bundle.scan.height_unit === "cm" ? "cm" : "in"}`}</dd></div><div><dt>Average confidence</dt><dd>{averageConfidence !== null && Number.isFinite(averageConfidence) ? measurementConfidenceText(averageConfidence) : "Not reported"}</dd></div></dl><MeasurementTable measurements={bundle.measurements} selectedId={selectedMeasurementId} onSelect={focusMeasurement} /></>}</>}{tab === "photos" && <PrivatePhotos assets={bundle.assets} />}{tab === "activity" && <ScanActivity scan={bundle.scan} />}</div></Panel><div className="results-actions"><div className="results-action-meta"><span className="action-tip"><Icon name="shield" size={15} /> Check before sharing</span><span className="action-tip"><Icon name="clock" size={15} /> Updated {formatDate(bundle.scan.updated_at)}</span></div><div className="result-action-error">{actionError && <InlineError message={actionError} />}</div><div className="result-buttons"><Button onClick={() => void sendToReview()} disabled={actionBusy || bundle.measurements.length === 0 || reviewSent} icon="arrow-right">{reviewSent ? "Sent to dressmaker" : "Send to dressmaker for review"}</Button><Button variant="secondary" onClick={() => void requestRecapture()} disabled={actionBusy} icon="refresh">Request new photos</Button><Button variant="ghost" onClick={onDashboard}>Back to overview</Button></div></div></div>;
}

function MeasurementTable({ measurements, editable = false, values, onValueChange, selectedId, onSelect }: { measurements: Measurement[]; editable?: boolean; values?: Record<string, string>; onValueChange?: (id: string, value: string) => void; selectedId?: string | null; onSelect?: (measurement: Measurement) => void }) {
  const selectable = Boolean(onSelect);
  return <div className="measurement-table-wrap"><table className="measurement-table"><caption className="sr-only">Body measurements and confidence. Select a measurement name to highlight its guide on the 3D model.</caption><thead><tr><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Confidence</th></tr></thead><tbody>{measurements.map((measurement) => {
    const selected = selectedId === measurement.id;
    const rowSelectable = selectable && measurementGuideKey(measurement.key) !== null;
    const label = displayMeasurementKey(measurement.key);
    const confidence = measurementConfidence(measurement.confidence);
    const select = () => onSelect?.(measurement);
    const handleRowClick = (event: React.MouseEvent<HTMLTableRowElement>) => {
      if (!rowSelectable || (event.target as HTMLElement).closest("button, input, select, textarea")) return;
      select();
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (!rowSelectable || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      select();
    };
    return <tr id={"measurement-row-" + measurement.id} className={cn("measurement-row", selected && "selected")} key={measurement.id} data-selectable={rowSelectable ? "true" : undefined} tabIndex={rowSelectable ? 0 : undefined} aria-selected={rowSelectable ? selected : undefined} aria-disabled={selectable && !rowSelectable ? true : undefined} onClick={rowSelectable ? handleRowClick : undefined} onKeyDown={rowSelectable ? handleKeyDown : undefined}><th scope="row">{rowSelectable ? <button type="button" className="measurement-name-button" aria-label={"Show " + label + " on the 3D model"} aria-controls="model-3d-region" aria-pressed={selected} onClick={(event) => { event.stopPropagation(); select(); }}><span className="table-accent" aria-hidden="true" />{label}</button> : <span className="measurement-name"><span className="table-accent" aria-hidden="true" />{label}</span>}</th><td>{editable ? <div className="adjust-input"><input aria-label={label + " adjusted value"} inputMode="decimal" value={values?.[measurement.id] ?? String(measurement.adjusted_value ?? measurement.value)} onChange={(event) => onValueChange?.(measurement.id, event.target.value)} /><span aria-hidden="true">{measurement.unit}</span></div> : <strong>{displayMeasurementValue(measurement)}</strong>}</td><td><span className={cn("confidence-value", "confidence-" + confidence.tone)}><strong>{confidence.label}</strong>{measurement.confidence !== null && Number.isFinite(measurement.confidence) && <small>{measurement.confidence.toFixed(0)}%</small>}</span></td></tr>;
  })}</tbody></table></div>;
}


function PrivatePhotos({ assets }: { assets: ScanAsset[] }) {
  return assets.length === 0 ? <DataState icon="camera" title="No scan photos" body="The private scan assets are not available for this record." /> : <div className="photo-grid">{assets.map((asset) => <div className="photo-tile" key={asset.id}>{asset.signedUrl ? <img src={asset.signedUrl} alt={`${asset.asset_type} scan view`} loading="lazy" width={640} height={480} /> : <div className="photo-placeholder"><Icon name="lock" size={22} /><span>Signed URL unavailable</span></div>}<div><strong>{asset.asset_type.replace("_", " ")}</strong><Badge tone={asset.quality_status === "passed" ? "success" : "neutral"}>{asset.quality_status}</Badge></div></div>)}</div>;
}

function ScanActivity({ scan }: { scan: Scan }) {
  const events: Array<{ title: string; body: string; date: string | null; done: boolean }> = [
    { title: "Scan created", body: "A private scan draft was created.", date: scan.created_at, done: true },
    { title: "Views uploaded", body: scan.status === "draft" ? "Waiting for front, side, and back views." : "The required views are attached to this scan.", date: scan.status === "draft" ? null : scan.updated_at, done: scan.status !== "draft" },
    { title: "Provider result", body: scanStatusLabel(scan.status), date: ["ready_for_review", "verified", "needs_recapture"].includes(scan.status) ? scan.updated_at : null, done: ["ready_for_review", "verified", "needs_recapture"].includes(scan.status) },
  ];
  return <div className="activity-list">{events.map((event) => <div className={cn("activity-item", event.done && "done")} key={event.title}><span><Icon name={event.done ? "check" : "clock"} size={13} /></span><div><strong>{event.title}</strong><p>{event.body}</p></div><small>{formatDateTime(event.date)}</small></div>)}</div>;
}

type LocalPreviewData = {
  kind?: unknown;
  reference_image?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localPreviewData(model: ScanBundle["bodyModel"]): LocalPreviewData | null {
  if (!model || model.status !== "ready" || model.provider !== "local" || !isRecord(model.preview_data)) return null;
  return model.preview_data.kind === "local-reference-3d-body-scan" ? model.preview_data : null;
}

function localPreviewPath(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/media/") ? publicAssetPath(value) : null;
}

const LOCAL_REFERENCE_IMAGE = publicAssetPath("/media/3d-body-scan-reference-v3.png");
const MODEL_UNITS_PER_CM = 4.3 / 170;

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function createScanSuitTexture(three: ThreeModule): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, "#405b78");
  gradient.addColorStop(0.48, "#2b435f");
  gradient.addColorStop(1, "#182d47");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = "rgba(151, 228, 224, .14)";
  context.lineWidth = 1;
  for (let offset = -256; offset < 512; offset += 22) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset + 256, 256);
    context.stroke();
  }
  context.strokeStyle = "rgba(255, 255, 255, .075)";
  for (let offset = 10; offset < 256; offset += 32) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset, 256);
    context.stroke();
  }
  context.strokeStyle = "rgba(0, 12, 28, .22)";
  for (let offset = 0; offset < 256; offset += 32) {
    context.beginPath();
    context.moveTo(0, offset);
    context.lineTo(256, offset);
    context.stroke();
  }
  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  texture.wrapS = three.RepeatWrapping;
  texture.wrapT = three.RepeatWrapping;
  texture.repeat.set(1.7, 2.6);
  return texture;
}

function addBodySphere(three: ThreeModule, group: THREE.Group, position: [number, number, number], scale: [number, number, number], material: THREE.Material) {
  const mesh = new three.Mesh(new three.SphereGeometry(1, 28, 20), material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

type MeasuredBodyRing = { y: number; width: number; depth: number; x?: number; z?: number };

function createMeasuredSurface(three: ThreeModule, group: THREE.Group, rings: MeasuredBodyRing[], material: THREE.Material) {
  const segments = 64;
  const smoothRings: MeasuredBodyRing[] = [];
  for (let index = 0; index < rings.length - 1; index += 1) {
    const current = rings[index];
    const next = rings[index + 1];
    if (index === 0) smoothRings.push(current);
    for (let step = 1; step <= 3; step += 1) {
      const t = step / 3;
      const blend = t * t * (3 - 2 * t);
      smoothRings.push({
        x: (current.x ?? 0) + ((next.x ?? 0) - (current.x ?? 0)) * blend,
        y: current.y + (next.y - current.y) * t,
        width: current.width + (next.width - current.width) * blend,
        depth: current.depth + (next.depth - current.depth) * blend,
        z: (current.z ?? 0) + ((next.z ?? 0) - (current.z ?? 0)) * blend,
      });
    }
  }
  if (rings.length === 1) smoothRings.push(rings[0]);
  if (smoothRings.length < 2) return null;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringVertex = (ringIndex: number, segment: number) => ringIndex * segments + (segment % segments);
  const minY = smoothRings[0].y;
  const maxY = smoothRings[smoothRings.length - 1].y;
  smoothRings.forEach((ring) => {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      positions.push((ring.x ?? 0) + ring.width * Math.cos(angle), ring.y, (ring.z ?? 0) + ring.depth * Math.sin(angle));
      uvs.push(segment / segments, (ring.y - minY) / Math.max(maxY - minY, 0.001));
    }
  });
  for (let ringIndex = 0; ringIndex < smoothRings.length - 1; ringIndex += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const current = ringVertex(ringIndex, segment);
      const next = ringVertex(ringIndex, segment + 1);
      const upper = ringVertex(ringIndex + 1, segment);
      const upperNext = ringVertex(ringIndex + 1, segment + 1);
      indices.push(current, upper, next, next, upper, upperNext);
    }
  }
  const bottomCenter = positions.length / 3;
  positions.push(smoothRings[0].x ?? 0, smoothRings[0].y, smoothRings[0].z ?? 0);
  const topCenter = positions.length / 3;
  const topRing = smoothRings[smoothRings.length - 1];
  positions.push(topRing.x ?? 0, topRing.y, topRing.z ?? 0);
  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(bottomCenter, ringVertex(0, segment), ringVertex(0, segment + 1));
    indices.push(topCenter, ringVertex(smoothRings.length - 1, segment + 1), ringVertex(smoothRings.length - 1, segment));
  }
  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new three.BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new three.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

type LimbRadii = [number, number];

function addMeasuredLimb(three: ThreeModule, group: THREE.Group, start: THREE.Vector3, end: THREE.Vector3, startRadii: LimbRadii, endRadii: LimbRadii, material: THREE.Material, measuredRadii?: LimbRadii, measuredPosition = 0.5) {
  const axis = new three.Vector3().subVectors(end, start);
  const length = axis.length();
  if (!length) return null;
  axis.normalize();
  const reference = Math.abs(axis.y) > 0.9 ? new three.Vector3(0, 0, 1) : new three.Vector3(0, 1, 0);
  const widthAxis = new three.Vector3().crossVectors(reference, axis).normalize();
  const depthAxis = new three.Vector3().crossVectors(axis, widthAxis).normalize();
  const segments = 28;
  const rings = 6;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringVertex = (ringIndex: number, segment: number) => ringIndex * segments + (segment % segments);
  for (let ringIndex = 0; ringIndex < rings; ringIndex += 1) {
    const t = ringIndex / (rings - 1);
    const center = start.clone().lerp(end, t);
    const measuredT = clampNumber(measuredPosition, 0.05, 0.95);
    const radiiStart = measuredRadii && t <= measuredT ? startRadii : measuredRadii ? measuredRadii : startRadii;
    const radiiEnd = measuredRadii && t <= measuredT ? measuredRadii : endRadii;
    const localT = measuredRadii && t <= measuredT ? t / measuredT : measuredRadii ? (t - measuredT) / (1 - measuredT) : t;
    const width = radiiStart[0] + (radiiEnd[0] - radiiStart[0]) * localT;
    const depth = radiiStart[1] + (radiiEnd[1] - radiiStart[1]) * localT;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      positions.push(
        center.x + widthAxis.x * width * Math.cos(angle) + depthAxis.x * depth * Math.sin(angle),
        center.y + widthAxis.y * width * Math.cos(angle) + depthAxis.y * depth * Math.sin(angle),
        center.z + widthAxis.z * width * Math.cos(angle) + depthAxis.z * depth * Math.sin(angle),
      );
      uvs.push(segment / segments, t);
    }
  }
  for (let ringIndex = 0; ringIndex < rings - 1; ringIndex += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const current = ringVertex(ringIndex, segment);
      const next = ringVertex(ringIndex, segment + 1);
      const upper = ringVertex(ringIndex + 1, segment);
      const upperNext = ringVertex(ringIndex + 1, segment + 1);
      indices.push(current, upper, next, next, upper, upperNext);
    }
  }
  const startCenter = positions.length / 3;
  positions.push(start.x, start.y, start.z);
  const endCenter = positions.length / 3;
  positions.push(end.x, end.y, end.z);
  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(startCenter, ringVertex(0, segment + 1), ringVertex(0, segment));
    indices.push(endCenter, ringVertex(rings - 1, segment), ringVertex(rings - 1, segment + 1));
  }
  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new three.BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new three.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addMeasuredGuideLine(three: ThreeModule, group: THREE.Group, points: THREE.Vector3[], color: number, key?: string, depthTest = true, aliases: string[] = []) {
  const line = new three.Line(
    new three.BufferGeometry().setFromPoints(points),
    new three.LineBasicMaterial({ color, transparent: true, opacity: 0.96, depthTest, depthWrite: false, polygonOffset: depthTest, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  line.renderOrder = 4;
  line.frustumCulled = false;
  line.userData.guideColor = color;
  if (key) {
    line.userData.measurementKey = key;
    line.userData.measurementKeys = [key, ...aliases];
  }
  group.add(line);
}

function addMeasuredEllipseGuide(three: ThreeModule, group: THREE.Group, center: THREE.Vector3, radii: [number, number], color: number, key?: string, aliases: string[] = []) {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < 64; index += 1) {
    const angle = (index / 64) * Math.PI * 2;
    points.push(new three.Vector3(center.x + radii[0] * Math.cos(angle), center.y, center.z + radii[1] * Math.sin(angle)));
  }
  const line = new three.LineLoop(
    new three.BufferGeometry().setFromPoints(points),
    new three.LineBasicMaterial({ color, transparent: true, opacity: 0.98, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  line.renderOrder = 4;
  line.frustumCulled = false;
  line.userData.guideColor = color;
  if (key) {
    line.userData.measurementKey = key;
    line.userData.measurementKeys = [key, ...aliases];
  }
  group.add(line);
}

function addMeasuredLimbGuide(three: ThreeModule, group: THREE.Group, center: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3, radii: LimbRadii, color: number, key?: string, aliases: string[] = []) {
  const axis = new three.Vector3().subVectors(end, start).normalize();
  const reference = Math.abs(axis.y) < 0.9 ? new three.Vector3(0, 1, 0) : new three.Vector3(1, 0, 0);
  const basisA = new three.Vector3().crossVectors(axis, reference).normalize();
  const basisB = new three.Vector3().crossVectors(axis, basisA).normalize();
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < 40; index += 1) {
    const angle = (index / 40) * Math.PI * 2;
    points.push(center.clone().addScaledVector(basisA, radii[0] * Math.cos(angle)).addScaledVector(basisB, radii[1] * Math.sin(angle)));
  }
  const line = new three.LineLoop(
    new three.BufferGeometry().setFromPoints(points),
    new three.LineBasicMaterial({ color, transparent: true, opacity: 0.98, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  line.renderOrder = 4;
  line.frustumCulled = false;
  line.userData.guideColor = color;
  if (key) {
    line.userData.measurementKey = key;
    line.userData.measurementKeys = [key, ...aliases];
  }
  group.add(line);
}

function createMeasuredBodyModelScene(three: ThreeModule, measurements: Measurement[], heightValue: number | null | undefined, heightUnit: "cm" | "ftin") {
  const root = new three.Group();
  const body = new three.Group();
  const guides = new three.Group();
  const suitTexture = createScanSuitTexture(three);
  const bodyMaterial = new three.MeshPhysicalMaterial({ color: 0x496783, map: suitTexture, roughness: 0.42, metalness: 0.08, clearcoat: 0.28, clearcoatRoughness: 0.24, sheen: 0.4, sheenColor: 0x66d8d2, emissive: 0x0a2039, emissiveIntensity: 0.2 });
  const jointMaterial = new three.MeshPhysicalMaterial({ color: 0x385471, roughness: 0.5, metalness: 0.04, clearcoat: 0.18, clearcoatRoughness: 0.3, emissive: 0x081a30, emissiveIntensity: 0.12 });
  const featureMaterial = new three.MeshStandardMaterial({ color: 0x101d31, roughness: 0.38, metalness: 0.02 });
  const modelUnitsPerCm = MODEL_UNITS_PER_CM;
  const heightCm = clampNumber(modelHeightCm(heightValue, heightUnit), 120, 230);
  const height = heightCm * modelUnitsPerCm;
  const circumference = { dimension: "circumference" as const };
  const length = { dimension: "length" as const };
  const width = { dimension: "width" as const };
  const chestCm = modelMeasurementCm(measurements, ["chest", "bust"], 100.1, circumference);
  const waistCm = modelMeasurementCm(measurements, ["waist"], 82.2, circumference);
  const hipCm = modelMeasurementCm(measurements, ["hip", "hips"], 94.8, circumference);
  const neckCm = modelMeasurementCm(measurements, ["neck"], 37.6, circumference);
  const headCm = modelMeasurementCm(measurements, ["head", "head_circumference"], 59.7, circumference);
  const shoulderCm = modelMeasurementCm(measurements, ["shoulder", "shoulders", "shoulder_breadth"], 52.5, width);
  const bicepLeftCm = modelMeasurementCm(measurements, ["bicep", "upper_arm"], 33.3, { ...circumference, side: "left" });
  const bicepRightCm = modelMeasurementCm(measurements, ["bicep", "upper_arm"], 33.3, { ...circumference, side: "right" });
  const forearmLeftCm = modelMeasurementCm(measurements, ["forearm"], 28.0, { ...circumference, side: "left" });
  const forearmRightCm = modelMeasurementCm(measurements, ["forearm"], 28.0, { ...circumference, side: "right" });
  const wristLeftCm = modelMeasurementCm(measurements, ["wrist"], 17.5, { ...circumference, side: "left" });
  const wristRightCm = modelMeasurementCm(measurements, ["wrist"], 17.5, { ...circumference, side: "right" });
  const thighLeftCm = modelMeasurementCm(measurements, ["thigh"], 55.3, { ...circumference, side: "left" });
  const thighRightCm = modelMeasurementCm(measurements, ["thigh"], 55.3, { ...circumference, side: "right" });
  const calfLeftCm = modelMeasurementCm(measurements, ["calf"], 36.4, { ...circumference, side: "left" });
  const calfRightCm = modelMeasurementCm(measurements, ["calf"], 36.4, { ...circumference, side: "right" });
  const ankleLeftCm = modelMeasurementCm(measurements, ["ankle"], 24.3, { ...circumference, side: "left" });
  const ankleRightCm = modelMeasurementCm(measurements, ["ankle"], 24.3, { ...circumference, side: "right" });
  const footLengthCm = modelMeasurementCm(measurements, ["foot_length", "right_foot_length"], 26.2, length);
  const footWidthCm = modelMeasurementCm(measurements, ["foot_width", "right_foot_width"], 9.7, width);
  const inseamCm = modelMeasurementCm(measurements, ["inseam", "inside_leg_height"], 72.4, length);
  const armLengthCm = modelMeasurementCm(measurements, ["arm", "arm_length", "sleeve"], 57.3, length);
  const neckToPelvisCm = modelMeasurementCm(measurements, ["neck_to_pelvis"], 68.6, length);
  const backToShoulderCm = modelMeasurementCm(measurements, ["back_to_shoulder"], 21.2, length);
  const chestRadii = ellipseRadiiForCircumference(chestCm, 0.72, modelUnitsPerCm);
  const waistRadii = ellipseRadiiForCircumference(waistCm, 0.72, modelUnitsPerCm);
  const hipRadii = ellipseRadiiForCircumference(hipCm, 0.76, modelUnitsPerCm);
  const neckRadii = ellipseRadiiForCircumference(neckCm, 0.82, modelUnitsPerCm);
  const headRadii = ellipseRadiiForCircumference(headCm, 0.88, modelUnitsPerCm);
  const shoulderHalf = shoulderCm * modelUnitsPerCm / 2;
  const shoulderY = height * 0.78;
  const hipY = height * 0.52;
  const neckBaseY = height * 0.84;
  const pelvisY = neckBaseY - neckToPelvisCm * modelUnitsPerCm;
  const crotchY = inseamCm * modelUnitsPerCm;
  const kneeY = Math.max(crotchY * 0.58, height * 0.24);
  const ankleY = height * 0.055;
  const leftLegX = clampNumber(hipRadii[0] * 0.62, 0.16, 0.38);
  const chestY = height * 0.69;
  const waistY = height * 0.62;
  const hipGuideY = height * 0.52;

  root.add(body, guides);
  createMeasuredSurface(three, body, [
    { y: height * 0.43, width: hipRadii[0] * 0.66, depth: hipRadii[1] * 0.66 },
    { y: height * 0.455, width: hipRadii[0] * 0.82, depth: hipRadii[1] * 0.82 },
    { y: height * 0.485, width: hipRadii[0] * 0.98, depth: hipRadii[1] * 0.98 },
    { y: hipY, width: hipRadii[0], depth: hipRadii[1] },
    { y: height * 0.545, width: hipRadii[0] * 0.96, depth: hipRadii[1] * 0.98 },
    { y: height * 0.575, width: waistRadii[0] * 1.05, depth: waistRadii[1] * 1.04 },
    { y: waistY, width: waistRadii[0], depth: waistRadii[1] },
    { y: height * 0.645, width: waistRadii[0] * 1.04, depth: waistRadii[1] * 1.02 },
    { y: height * 0.675, width: chestRadii[0] * 0.98, depth: chestRadii[1] * 0.98 },
    { y: chestY, width: chestRadii[0], depth: chestRadii[1] },
    { y: height * 0.72, width: chestRadii[0] * 1.02, depth: chestRadii[1] * 0.99 },
    { y: height * 0.75, width: chestRadii[0] * 0.97, depth: chestRadii[1] * 0.93 },
    { y: shoulderY, width: Math.max(chestRadii[0] * 0.94, shoulderHalf * 0.84), depth: chestRadii[1] * 0.88 },
    { y: height * 0.795, width: neckRadii[0] * 1.2, depth: neckRadii[1] * 1.16 },
  ], bodyMaterial);
  createMeasuredSurface(three, body, [
    { y: height * 0.79, width: neckRadii[0] * 1.16, depth: neckRadii[1] * 1.14 },
    { y: height * 0.81, width: neckRadii[0] * 1.06, depth: neckRadii[1] * 1.06 },
    { y: height * 0.84, width: neckRadii[0], depth: neckRadii[1] },
    { y: height * 0.87, width: neckRadii[0], depth: neckRadii[1] },
  ], bodyMaterial);

  const headY = height - height * 0.087;
  addBodySphere(three, body, [0, headY, 0], [headRadii[0], height * 0.087, headRadii[1]], bodyMaterial);
  addBodySphere(three, body, [-headRadii[0] * 1.03, headY, 0], [0.04, height * 0.038, 0.034], jointMaterial);
  addBodySphere(three, body, [headRadii[0] * 1.03, headY, 0], [0.04, height * 0.038, 0.034], jointMaterial);
  addBodySphere(three, body, [-headRadii[0] * 0.36, headY + height * 0.015, headRadii[1] * 0.95], [0.04, 0.027, 0.018], featureMaterial);
  addBodySphere(three, body, [headRadii[0] * 0.36, headY + height * 0.015, headRadii[1] * 0.95], [0.04, 0.027, 0.018], featureMaterial);
  addBodySphere(three, body, [0, headY - height * 0.008, headRadii[1] * 1.02], [0.027, 0.045, 0.04], jointMaterial);
  addBodySphere(three, body, [0, headY - height * 0.052, headRadii[1] * 1.0], [0.07, 0.014, 0.012], featureMaterial);
  addBodySphere(three, body, [-headRadii[0] * 0.22, headY - height * 0.018, headRadii[1] * 1.01], [0.055, 0.013, 0.014], featureMaterial);
  addBodySphere(three, body, [headRadii[0] * 0.22, headY - height * 0.018, headRadii[1] * 1.01], [0.055, 0.013, 0.014], featureMaterial);

  const leftShoulder = new three.Vector3(-shoulderHalf * 0.96, shoulderY, 0);
  const rightShoulder = new three.Vector3(shoulderHalf * 0.96, shoulderY, 0);
  const armTotal = armLengthCm * modelUnitsPerCm;
  const armOffset = Math.hypot(shoulderHalf * 0.19, 0.12);
  const armVertical = Math.sqrt(Math.max(armTotal * armTotal - armOffset * armOffset, height * 0.12 * height * 0.12));
  const armUpper = armVertical * 0.48;
  const leftElbow = new three.Vector3(-shoulderHalf * 1.1, shoulderY - armUpper, 0.06);
  const rightElbow = new three.Vector3(shoulderHalf * 1.1, shoulderY - armUpper, 0.06);
  const leftWrist = new three.Vector3(-shoulderHalf * 1.15, shoulderY - armVertical, 0.12);
  const rightWrist = new three.Vector3(shoulderHalf * 1.15, shoulderY - armVertical, 0.12);
  const bicepLeftRadii = ellipseRadiiForCircumference(bicepLeftCm, 0.76, modelUnitsPerCm);
  const bicepRightRadii = ellipseRadiiForCircumference(bicepRightCm, 0.76, modelUnitsPerCm);
  const forearmLeftRadii = ellipseRadiiForCircumference(forearmLeftCm, 0.74, modelUnitsPerCm);
  const forearmRightRadii = ellipseRadiiForCircumference(forearmRightCm, 0.74, modelUnitsPerCm);
  const wristLeftRadii = ellipseRadiiForCircumference(wristLeftCm, 0.72, modelUnitsPerCm);
  const wristRightRadii = ellipseRadiiForCircumference(wristRightCm, 0.72, modelUnitsPerCm);
  addBodySphere(three, body, [-shoulderHalf * 0.91, shoulderY, 0], [height * 0.05, height * 0.055, height * 0.06], bodyMaterial);
  addBodySphere(three, body, [shoulderHalf * 0.91, shoulderY, 0], [height * 0.05, height * 0.055, height * 0.06], bodyMaterial);
  addMeasuredLimb(three, body, leftShoulder, leftElbow, [bicepLeftRadii[0] * 1.12, bicepLeftRadii[1] * 1.12], [bicepLeftRadii[0] * 0.88, bicepLeftRadii[1] * 0.88], bodyMaterial, bicepLeftRadii);
  addMeasuredLimb(three, body, rightShoulder, rightElbow, [bicepRightRadii[0] * 1.12, bicepRightRadii[1] * 1.12], [bicepRightRadii[0] * 0.88, bicepRightRadii[1] * 0.88], bodyMaterial, bicepRightRadii);
  addMeasuredLimb(three, body, leftElbow, leftWrist, [forearmLeftRadii[0] * 1.08, forearmLeftRadii[1] * 1.08], wristLeftRadii, bodyMaterial, forearmLeftRadii);
  addMeasuredLimb(three, body, rightElbow, rightWrist, [forearmRightRadii[0] * 1.08, forearmRightRadii[1] * 1.08], wristRightRadii, bodyMaterial, forearmRightRadii);
  addBodySphere(three, body, leftElbow.toArray() as [number, number, number], [height * 0.042, height * 0.042, height * 0.042], jointMaterial);
  addBodySphere(three, body, rightElbow.toArray() as [number, number, number], [height * 0.042, height * 0.042, height * 0.042], jointMaterial);
  const handLength = height * 0.085;
  const handWidthLeft = wristLeftRadii[0] * 1.5;
  const handWidthRight = wristRightRadii[0] * 1.5;
  addBodySphere(three, body, [leftWrist.x, leftWrist.y - handLength * 0.46, leftWrist.z + 0.02], [handWidthLeft, handLength * 0.52, wristLeftRadii[1] * 1.42], bodyMaterial);
  addBodySphere(three, body, [rightWrist.x, rightWrist.y - handLength * 0.46, rightWrist.z + 0.02], [handWidthRight, handLength * 0.52, wristRightRadii[1] * 1.42], bodyMaterial);
  addBodySphere(three, body, [leftWrist.x - handWidthLeft * 0.75, leftWrist.y - handLength * 0.28, leftWrist.z + 0.1], [height * 0.018, height * 0.045, height * 0.022], jointMaterial);
  addBodySphere(three, body, [rightWrist.x + handWidthRight * 0.75, rightWrist.y - handLength * 0.28, rightWrist.z + 0.1], [height * 0.018, height * 0.045, height * 0.022], jointMaterial);

  const leftHip = new three.Vector3(-leftLegX, hipY, 0);
  const rightHip = new three.Vector3(leftLegX, hipY, 0);
  const leftKnee = new three.Vector3(-leftLegX * 1.04, kneeY, 0.035);
  const rightKnee = new three.Vector3(leftLegX * 1.04, kneeY, 0.035);
  const leftAnkle = new three.Vector3(-leftLegX * 1.06, ankleY, 0.065);
  const rightAnkle = new three.Vector3(leftLegX * 1.06, ankleY, 0.065);
  const thighLeftRadii = ellipseRadiiForCircumference(thighLeftCm, 0.78, modelUnitsPerCm);
  const thighRightRadii = ellipseRadiiForCircumference(thighRightCm, 0.78, modelUnitsPerCm);
  const calfLeftRadii = ellipseRadiiForCircumference(calfLeftCm, 0.74, modelUnitsPerCm);
  const calfRightRadii = ellipseRadiiForCircumference(calfRightCm, 0.74, modelUnitsPerCm);
  const ankleLeftRadii = ellipseRadiiForCircumference(ankleLeftCm, 0.7, modelUnitsPerCm);
  const ankleRightRadii = ellipseRadiiForCircumference(ankleRightCm, 0.7, modelUnitsPerCm);
  addMeasuredLimb(three, body, leftHip, leftKnee, [thighLeftRadii[0] * 1.12, thighLeftRadii[1] * 1.1], [thighLeftRadii[0] * 0.88, thighLeftRadii[1] * 0.9], bodyMaterial, thighLeftRadii);
  addMeasuredLimb(three, body, rightHip, rightKnee, [thighRightRadii[0] * 1.12, thighRightRadii[1] * 1.1], [thighRightRadii[0] * 0.88, thighRightRadii[1] * 0.9], bodyMaterial, thighRightRadii);
  addMeasuredLimb(three, body, leftKnee, leftAnkle, [calfLeftRadii[0] * 1.08, calfLeftRadii[1] * 1.08], ankleLeftRadii, bodyMaterial, calfLeftRadii);
  addMeasuredLimb(three, body, rightKnee, rightAnkle, [calfRightRadii[0] * 1.08, calfRightRadii[1] * 1.08], ankleRightRadii, bodyMaterial, calfRightRadii);
  addBodySphere(three, body, leftKnee.toArray() as [number, number, number], [height * 0.045, height * 0.045, height * 0.045], jointMaterial);
  addBodySphere(three, body, rightKnee.toArray() as [number, number, number], [height * 0.045, height * 0.045, height * 0.045], jointMaterial);
  const footLengthRadius = footLengthCm * modelUnitsPerCm / 2;
  const footWidthRadius = footWidthCm * modelUnitsPerCm / 2;
  addBodySphere(three, body, [leftAnkle.x - height * 0.008, height * 0.04, footLengthRadius], [footWidthRadius, height * 0.04, footLengthRadius], bodyMaterial);
  addBodySphere(three, body, [rightAnkle.x + height * 0.008, height * 0.04, footLengthRadius], [footWidthRadius, height * 0.04, footLengthRadius], bodyMaterial);
  for (const side of [-1, 1] as const) {
    const footX = side * leftLegX * 1.06;
    for (let toe = -1; toe <= 1; toe += 1) {
      addBodySphere(three, body, [footX + toe * footWidthRadius * 0.42, height * 0.032, footLengthRadius * 1.25], [footWidthRadius * 0.24, height * 0.018, footLengthRadius * 0.22], jointMaterial);
    }
  }

  addMeasuredEllipseGuide(three, guides, new three.Vector3(0, neckBaseY, 0), neckRadii, 0x9e9cff, "neck");
  addMeasuredEllipseGuide(three, guides, new three.Vector3(0, headY + height * 0.018, 0), headRadii, 0x72e56f, "head");
  addMeasuredEllipseGuide(three, guides, new three.Vector3(0, chestY, 0), chestRadii, 0x60e8d7, "chest");
  addMeasuredEllipseGuide(three, guides, new three.Vector3(0, waistY, 0), waistRadii, 0x71dbe6, "waist");
  addMeasuredEllipseGuide(three, guides, new three.Vector3(0, hipGuideY, 0), hipRadii, 0xf1d33b, "hip");
  addMeasuredLimbGuide(three, guides, leftShoulder.clone().lerp(leftElbow, 0.5), leftShoulder, leftElbow, bicepLeftRadii, 0x74d96e, "upper_arm_left", ["upper_arm"]);
  addMeasuredLimbGuide(three, guides, rightShoulder.clone().lerp(rightElbow, 0.5), rightShoulder, rightElbow, bicepRightRadii, 0x74d96e, "upper_arm_right", ["upper_arm"]);
  addMeasuredLimbGuide(three, guides, leftElbow.clone().lerp(leftWrist, 0.5), leftElbow, leftWrist, forearmLeftRadii, 0xe969ad, "forearm_left", ["forearm"]);
  addMeasuredLimbGuide(three, guides, rightElbow.clone().lerp(rightWrist, 0.5), rightElbow, rightWrist, forearmRightRadii, 0xe969ad, "forearm_right", ["forearm"]);
  addMeasuredLimbGuide(three, guides, leftHip.clone().lerp(leftKnee, 0.5), leftHip, leftKnee, thighLeftRadii, 0xc3d2e3, "thigh_left", ["thigh"]);
  addMeasuredLimbGuide(three, guides, rightHip.clone().lerp(rightKnee, 0.5), rightHip, rightKnee, thighRightRadii, 0xc3d2e3, "thigh_right", ["thigh"]);
  addMeasuredLimbGuide(three, guides, leftKnee.clone().lerp(leftAnkle, 0.5), leftKnee, leftAnkle, calfLeftRadii, 0x5bd6e2, "calf_left", ["calf"]);
  addMeasuredLimbGuide(three, guides, rightKnee.clone().lerp(rightAnkle, 0.5), rightKnee, rightAnkle, calfRightRadii, 0x5bd6e2, "calf_right", ["calf"]);
  addMeasuredLimbGuide(three, guides, leftWrist, leftElbow, leftWrist, wristLeftRadii, 0xf2b4d9, "wrist_left", ["wrist"]);
  addMeasuredLimbGuide(three, guides, rightWrist, rightElbow, rightWrist, wristRightRadii, 0xf2b4d9, "wrist_right", ["wrist"]);
  addMeasuredEllipseGuide(three, guides, new three.Vector3(leftAnkle.x, ankleY, 0.065), ankleLeftRadii, 0xf5ae2e, "ankle_left", ["ankle"]);
  addMeasuredEllipseGuide(three, guides, new three.Vector3(rightAnkle.x, ankleY, 0.065), ankleRightRadii, 0xf5ae2e, "ankle_right", ["ankle"]);
  const guideDepth = Math.max(chestRadii[1], hipRadii[1]) + 0.18;
  addMeasuredGuideLine(three, guides, [new three.Vector3(-shoulderHalf, shoulderY, guideDepth), new three.Vector3(shoulderHalf, shoulderY, guideDepth)], 0x64e4d3, "shoulder", false);
  const heightGuideX = Math.max(shoulderHalf, chestRadii[0]) + 0.42;
  addMeasuredGuideLine(three, guides, [new three.Vector3(heightGuideX, 0, guideDepth), new three.Vector3(heightGuideX, height, guideDepth)], 0xf04fc5, "height", false);
  addMeasuredGuideLine(three, guides, [new three.Vector3(heightGuideX - 0.08, 0, guideDepth), new three.Vector3(heightGuideX + 0.08, 0, guideDepth)], 0xf04fc5, "height", false);
  addMeasuredGuideLine(three, guides, [new three.Vector3(heightGuideX - 0.08, height, guideDepth), new three.Vector3(heightGuideX + 0.08, height, guideDepth)], 0xf04fc5, "height", false);
  addMeasuredGuideLine(three, guides, [new three.Vector3(-leftLegX * 0.2, crotchY, guideDepth), new three.Vector3(-leftLegX * 0.2, 0, guideDepth)], 0xea4fc0, "inseam", false);
  addMeasuredGuideLine(three, guides, [new three.Vector3(0, pelvisY, guideDepth), new three.Vector3(0, neckBaseY, guideDepth)], 0xc5a4f4, "neck_to_pelvis", false);
  const backToShoulderVerticalCm = Math.min(Math.max(0, (neckBaseY - shoulderY) / modelUnitsPerCm), backToShoulderCm * 0.48);
  const backToShoulderHorizontalCm = Math.sqrt(Math.max(0, backToShoulderCm * backToShoulderCm - backToShoulderVerticalCm * backToShoulderVerticalCm));
  addMeasuredGuideLine(three, guides, [new three.Vector3(0, shoulderY + backToShoulderVerticalCm * modelUnitsPerCm, guideDepth), new three.Vector3(backToShoulderHorizontalCm * modelUnitsPerCm, shoulderY, guideDepth)], 0xb9cbea, "back_to_shoulder", false);
  addMeasuredGuideLine(three, guides, [leftShoulder.clone().setZ(guideDepth + 0.04), leftWrist.clone().setZ(guideDepth + 0.04)], 0xed6a9e, "arm_length_left", false, ["arm_length"]);
  addMeasuredGuideLine(three, guides, [rightShoulder.clone().setZ(guideDepth + 0.04), rightWrist.clone().setZ(guideDepth + 0.04)], 0xed6a9e, "arm_length_right", false, ["arm_length"]);
  addMeasuredEllipseGuide(three, guides, new three.Vector3(leftAnkle.x, height * 0.04, footLengthRadius), [footWidthRadius, footLengthRadius], 0x77d9c9, "foot_length_left", ["foot_length"]);
  addMeasuredEllipseGuide(three, guides, new three.Vector3(rightAnkle.x, height * 0.04, footLengthRadius), [footWidthRadius, footLengthRadius], 0x77d9c9, "foot_length_right", ["foot_length"]);
  addMeasuredGuideLine(three, guides, [new three.Vector3(rightAnkle.x - footWidthRadius, height * 0.08, footLengthRadius * 1.3), new three.Vector3(rightAnkle.x + footWidthRadius, height * 0.08, footLengthRadius * 1.3)], 0x77d9c9, "foot_width_right", false, ["foot_width"]);
  addMeasuredGuideLine(three, guides, [new three.Vector3(leftAnkle.x - footWidthRadius, height * 0.08, footLengthRadius * 1.3), new three.Vector3(leftAnkle.x + footWidthRadius, height * 0.08, footLengthRadius * 1.3)], 0x77d9c9, "foot_width_left", false, ["foot_width"]);
  return { root, body, guides };
}

function disposeThreeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const renderable = object as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    renderable.geometry?.dispose();
    const materials = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : [];
    materials.forEach((material) => {
      const materialWithMap = material as THREE.Material & { map?: THREE.Texture };
      materialWithMap.map?.dispose();
      material.dispose();
    });
  });
}

function InteractiveBodyModel({ referenceImage, measurements = [], heightValue = null, heightUnit = "cm", focusedMeasurementKey = null }: { referenceImage: string; measurements?: Measurement[]; heightValue?: number | null; heightUnit?: "cm" | "ftin"; focusedMeasurementKey?: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);
  const guidesRef = useRef<THREE.Group | null>(null);
  const renderRequestRef = useRef<(() => void) | null>(null);
  const reducedMotionRef = useRef(false);
  const showGuidesRef = useRef(true);
  const hasUserInteractedRef = useRef(false);
  const [viewerState, setViewerState] = useState<"loading" | "ready" | "fallback">("loading");
  const [autoRotate, setAutoRotate] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const instructionsId = useId();
  const focusStatusId = useId();
  const measurementSignature = useMemo(() => measurements.map((measurement) => `${measurement.key}:${measurement.value}:${measurement.adjusted_value ?? ""}:${measurement.unit}`).join("|"), [measurements]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotionPreference = () => setReducedMotion(query.matches);
    syncMotionPreference();
    query.addEventListener?.("change", syncMotionPreference);
    return () => query.removeEventListener?.("change", syncMotionPreference);
  }, []);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
    if (reducedMotion) setAutoRotate(false);
    renderRequestRef.current?.();
  }, [reducedMotion]);

  useEffect(() => {
    let active = true;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let controls: OrbitControlsType | null = null;
    let cleanupRuntime: (() => void) | null = null;
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return () => { active = false; };
    hasUserInteractedRef.current = false;
    setViewerState("loading");

    const setup = async () => {
      try {
        const runtime = await loadThreeRuntime();
        if (!active) return;
        const { three } = runtime;
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);
        renderer = new three.WebGLRenderer({ canvas, antialias: !isMobile, alpha: false, powerPreference: isMobile ? "low-power" : "high-performance", stencil: false });
        const handleContextLost = (event: Event) => {
          event.preventDefault();
          if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
          if (active) setViewerState("fallback");
        };
        renderer.outputColorSpace = three.SRGBColorSpace;
        renderer.toneMapping = three.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = three.PCFSoftShadowMap;
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = true;
        renderer.setClearColor(0x07111f, 1);
        scene = new three.Scene();
        scene.fog = new three.Fog(0x07111f, 8, 15);
        const modelHeight = clampNumber(modelHeightCm(heightValue, heightUnit), 120, 230) * MODEL_UNITS_PER_CM;
        const frameDistance = clampNumber(modelHeight * 1.65, 4.75, 10.75);
        const camera = new three.PerspectiveCamera(35, 1, 0.1, 100);
        camera.position.set(0, modelHeight * 0.52, frameDistance);
        controls = new runtime.OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.enablePan = false;
        controls.enableZoom = true;
        controls.zoomSpeed = 0.75;
        controls.rotateSpeed = 0.62;
        controls.screenSpacePanning = false;
        controls.minDistance = clampNumber(modelHeight * 0.88, 3.75, 5.1);
        controls.maxDistance = clampNumber(modelHeight * 2.15, 8.5, 13);
        controls.minPolarAngle = Math.PI * 0.28;
        controls.maxPolarAngle = Math.PI * 0.68;
        controls.target.set(0, modelHeight * 0.5, 0);
        controls.autoRotate = autoRotate && !reducedMotionRef.current;
        controls.autoRotateSpeed = 0.8;
        controlsRef.current = controls;

        scene.add(new three.HemisphereLight(0xbad6ff, 0x102438, 1.75));
        const keyLight = new three.DirectionalLight(0xffffff, 3.2);
        keyLight.position.set(3.4, 6, 5.2);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        keyLight.shadow.camera.near = 0.5;
        keyLight.shadow.camera.far = 16;
        keyLight.shadow.camera.left = -4;
        keyLight.shadow.camera.right = 4;
        keyLight.shadow.camera.top = 7;
        keyLight.shadow.camera.bottom = -1;
        scene.add(keyLight);
        const fillLight = new three.PointLight(0x557fd2, 4.2, 10, 2);
        fillLight.position.set(-4, 3.5, 3.5);
        scene.add(fillLight);
        const rimLight = new three.PointLight(0x25d5d0, 9, 9, 2);
        rimLight.position.set(-3.4, 2.5, -1.6);
        scene.add(rimLight);

        const floor = new three.Mesh(new three.PlaneGeometry(10, 10), new three.MeshStandardMaterial({ color: 0x07111f, roughness: 0.95, metalness: 0.02 }));
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);
        const grid = new three.GridHelper(8, 18, 0x2a6875, 0x173344);
        grid.position.y = 0.012;
        const gridMaterial = grid.material as THREE.Material;
        gridMaterial.transparent = true;
        gridMaterial.opacity = 0.52;
        scene.add(grid);
        const bodyScene = createMeasuredBodyModelScene(three, measurements, heightValue, heightUnit);
        guidesRef.current = bodyScene.guides;
        bodyScene.guides.visible = showGuidesRef.current;
        scene.add(bodyScene.root);
        const fitCameraToModel = () => {
          if (!renderer || !controls) return;
          const bodyBounds = new three.Box3().setFromObject(bodyScene.body);
          const frameBounds = new three.Box3().setFromObject(bodyScene.root);
          const size = bodyBounds.getSize(new three.Vector3());
          const frameSize = frameBounds.getSize(new three.Vector3());
          const center = bodyBounds.getCenter(new three.Vector3());
          const verticalFov = three.MathUtils.degToRad(camera.fov);
          const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.1));
          const verticalDistance = size.y / (2 * Math.tan(verticalFov / 2));
          const horizontalDistance = frameSize.x / (2 * Math.tan(horizontalFov / 2));
          const depthDistance = frameSize.z * 0.9;
          const distance = Math.max(verticalDistance, horizontalDistance, depthDistance) * 1.2;
          camera.position.set(center.x, center.y, center.z + distance);
          controls.target.copy(center);
          controls.minDistance = clampNumber(distance * 0.55, 2.7, 5.1);
          controls.maxDistance = clampNumber(distance * 2.1, 8.5, 14);
          controls.update();
          controls.saveState();
        };
        const onControlsStart = () => { hasUserInteractedRef.current = true; };
        controls.addEventListener("start", onControlsStart);

        const resize = () => {
          if (!renderer || !scene) return;
          const width = Math.max(1, host.clientWidth);
          const height = Math.max(300, host.clientHeight);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5));
          renderer.setSize(width, height, false);
          if (!hasUserInteractedRef.current) fitCameraToModel();
        };
        const renderFrame = () => {
          if (!active || !renderer || !scene || !controls) { frame = 0; return; }
          if (document.hidden) { frame = 0; return; }
          const changed = controls.update();
          renderer.render(scene, camera);
          frame = 0;
          if ((controls.autoRotate && !reducedMotionRef.current) || changed) frame = window.requestAnimationFrame(renderFrame);
        };
        const requestRender = () => {
          if (!active || document.hidden || frame !== 0) return;
          frame = window.requestAnimationFrame(renderFrame);
        };
        renderRequestRef.current = requestRender;
        controls.addEventListener("change", requestRender);
        resize();
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
        observer?.observe(host);
        const onWindowResize = () => resize();
        const onVisibilityChange = () => {
          if (document.hidden && frame) { window.cancelAnimationFrame(frame); frame = 0; }
          if (!document.hidden) requestRender();
        };
        window.addEventListener("resize", onWindowResize);
        document.addEventListener("visibilitychange", onVisibilityChange);
        cleanupRuntime = () => {
          window.removeEventListener("resize", onWindowResize);
          document.removeEventListener("visibilitychange", onVisibilityChange);
          canvas.removeEventListener("webglcontextlost", handleContextLost, false);
          observer?.disconnect();
          controls?.removeEventListener("change", requestRender);
          controls?.removeEventListener("start", onControlsStart);
        };
        canvas.addEventListener("webglcontextlost", handleContextLost, false);
        requestRender();
        setViewerState("ready");
      } catch {
        controls?.dispose();
        controls = null;
        if (scene) disposeThreeScene(scene);
        scene = null;
        renderer?.dispose();
        renderer = null;
        if (active) setViewerState("fallback");
      }
    };
    void setup();
    return () => {
      active = false;
      if (frame) window.cancelAnimationFrame(frame);
      cleanupRuntime?.();
      renderRequestRef.current = null;
      controls?.dispose();
      controlsRef.current = null;
      guidesRef.current = null;
      if (scene) disposeThreeScene(scene);
      renderer?.dispose();
    };
  }, [heightUnit, heightValue, measurementSignature]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate && !reducedMotion;
      renderRequestRef.current?.();
    }
  }, [autoRotate, reducedMotion]);

  useEffect(() => {
    showGuidesRef.current = showGuides;
    if (guidesRef.current) guidesRef.current.visible = showGuides;
    renderRequestRef.current?.();
  }, [showGuides]);

  useEffect(() => {
    if (focusedMeasurementKey && !showGuides) setShowGuides(true);
  }, [focusedMeasurementKey, showGuides]);

  useEffect(() => {
    const guides = guidesRef.current;
    if (!guides) return;
    const focusedKey = focusedMeasurementKey ? measurementGuideKey(focusedMeasurementKey) : null;
    guides.traverse((object) => {
      const guideKey = object.userData.measurementKey as string | undefined;
      if (!guideKey) return;
      const guideKeys = (object.userData.measurementKeys as string[] | undefined) ?? [guideKey];
      const material = object as unknown as { material?: THREE.Material | THREE.Material[] };
      const materials = Array.isArray(material.material) ? material.material : material.material ? [material.material] : [];
      const isFocused = focusedKey !== null && measurementGuideMatches(focusedMeasurementKey ?? "", guideKeys);
      const guideColor = object.userData.guideColor as number | undefined;
      object.scale.setScalar(isFocused ? 1.06 : 1);
      object.renderOrder = isFocused ? 7 : 4;
      materials.forEach((guideMaterial) => {
        guideMaterial.transparent = true;
        guideMaterial.opacity = focusedKey ? (isFocused ? 1 : 0.16) : 0.96;
        guideMaterial.depthTest = isFocused ? false : true;
        const coloredMaterial = guideMaterial as THREE.Material & { color?: THREE.Color };
        if (coloredMaterial.color && guideColor !== undefined) coloredMaterial.color.set(isFocused ? 0xfff5cf : guideColor);
      });
    });
    renderRequestRef.current?.();
  }, [focusedMeasurementKey, measurementSignature, showGuides, viewerState]);

  const handleCanvasKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const rotation = 0.18;
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    if (event.key === "ArrowLeft") controls.rotateLeft(rotation);
    else if (event.key === "ArrowRight") controls.rotateLeft(-rotation);
    else if (event.key === "ArrowUp") controls.rotateUp(rotation);
    else if (event.key === "ArrowDown") controls.rotateUp(-rotation);
    else if (event.key === "+" || event.key === "=") controls.dollyIn(1.12);
    else if (event.key === "-" || event.key === "_") controls.dollyOut(1.12);
    else if (event.key === "Home") { controls.reset(); }
    else { controls.enableDamping = damping; return; }
    event.preventDefault();
    hasUserInteractedRef.current = true;
    controls.update();
    controls.enableDamping = damping;
    renderRequestRef.current?.();
  };
  const zoomIn = () => { hasUserInteractedRef.current = true; controlsRef.current?.dollyIn(1.12); controlsRef.current?.update(); renderRequestRef.current?.(); };
  const zoomOut = () => { hasUserInteractedRef.current = true; controlsRef.current?.dollyOut(1.12); controlsRef.current?.update(); renderRequestRef.current?.(); };
  const modelHeightLabel = heightValue === null || heightValue === undefined ? "170 cm reference height" : `${modelHeightCm(heightValue, heightUnit).toFixed(1)} cm tall`;
  const focusedMeasurement = focusedMeasurementKey ? measurements.find((measurement) => measurement.key === focusedMeasurementKey) : undefined;
  const focusedMeasurementLabel = focusedMeasurement ? `${displayMeasurementKey(focusedMeasurement.key)} · ${displayMeasurementValue(focusedMeasurement)}` : "No measurement guide selected";

  return (
    <div className="model-3d-viewer">
      <div id="model-3d-region" className="model-3d-stage" role="region" tabIndex={-1} aria-label="Interactive 3D model with measurement guides" data-model-version="v5" aria-busy={viewerState === "loading"}>
        <canvas ref={canvasRef} tabIndex={viewerState === "fallback" ? -1 : 0} aria-hidden={viewerState === "fallback"} aria-label="Interactive 3D body model. Use arrow keys to turn the model." aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - Home" aria-describedby={instructionsId + " " + focusStatusId} onKeyDown={handleCanvasKeyDown} />
        <figure className="model-3d-reference"><img src={referenceImage} alt="Reference body scan illustration" width={540} height={960} loading="lazy" /><figcaption>Reference image</figcaption></figure>
        <div className="model-3d-scale" aria-label="Model size summary"><strong>MEASURED BODY MODEL</strong><span>{modelHeightLabel}</span><small>{measurements.length} measurements used in this model</small></div>
        {viewerState === "loading" && <div className="model-3d-loading" role="status" aria-live="polite"><span className="model-3d-spinner" aria-hidden="true" />Preparing your model…</div>}
        {viewerState === "fallback" && <div className="model-3d-fallback" role="status"><img src={referenceImage} alt="Reference visualization for the body measurement result" width={540} height={960} /><span>Interactive 3D is unavailable on this device. Showing the reference image.</span></div>}
        <span className="model-preview-badge"><Icon name="scan" size={13} /> Interactive 3D model</span>
        <p className={cn("model-3d-focus-status", focusedMeasurement && "active")} id={focusStatusId} role="status" aria-live="polite">{focusedMeasurement ? "Guide shown: " + focusedMeasurementLabel : "Select a measurement name or row to show its guide."}</p>
      </div>
      <div className="model-3d-controls" role="group" aria-label="3D model controls"><button type="button" className={autoRotate ? "active" : ""} onClick={() => setAutoRotate((value) => !value)} disabled={viewerState !== "ready" || reducedMotion} aria-pressed={autoRotate}>{autoRotate ? "Pause rotation" : "Auto rotate"}<Icon name="rotate" size={14} /></button><button type="button" onClick={() => { hasUserInteractedRef.current = true; controlsRef.current?.reset(); renderRequestRef.current?.(); }} disabled={viewerState !== "ready"}><Icon name="refresh" size={14} />Reset view</button><button type="button" onClick={zoomIn} disabled={viewerState !== "ready"}><Icon name="zoom-in" size={14} />Zoom in</button><button type="button" onClick={zoomOut} disabled={viewerState !== "ready"}><Icon name="zoom-out" size={14} />Zoom out</button><button type="button" className={showGuides ? "active" : ""} onClick={() => setShowGuides((value) => !value)} disabled={viewerState !== "ready"} aria-pressed={showGuides}><Icon name="ruler" size={14} />{showGuides ? "Hide guides" : "Show guides"}</button></div>
      <p className="model-3d-hint" id={instructionsId}><Icon name="rotate" size={13} /> Drag to turn the model. Scroll or pinch to zoom. With keyboard focus, use the arrow keys, +/−, or Home.</p>
      {reducedMotion && <p className="model-3d-motion-note" role="status">Auto-rotation is off because reduced motion is enabled.</p>}
    </div>
  );
}

function ModelViewer({ model, measurements = [], heightValue = null, heightUnit = "cm", focusedMeasurementKey = null }: { model: ScanBundle["bodyModel"]; measurements?: Measurement[]; heightValue?: number | null; heightUnit?: "cm" | "ftin"; focusedMeasurementKey?: string | null }) {
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [assetError, setAssetError] = useState("");
  const localPreview = localPreviewData(model);
  useEffect(() => {
    let active = true;
    setAssetUrl(null);
    setAssetError("");
    if (localPreviewData(model)) return () => { active = false; };
    if (!model || model.status !== "ready" || !model.model_url_or_path) return () => { active = false; };
    const path = model.model_url_or_path;
    if (/^https?:\/\//i.test(path)) {
      if (/^https:\/\//i.test(path)) setAssetUrl(path);
      else setAssetError("The provider returned an insecure model URL. Showing the measured preview instead.");
      return () => { active = false; };
    }
    void createSignedStorageUrl("body-models", path).then((url) => { if (active) setAssetUrl(url); }).catch((reason: unknown) => { if (active) setAssetError(readableError(reason)); });
    return () => { active = false; };
  }, [model?.id, model?.status, model?.model_url_or_path]);
  if (localPreview) {
    const referenceImage = localPreviewPath(localPreview.reference_image) ?? LOCAL_REFERENCE_IMAGE;
    return <div className="model-empty model-empty-preview model-local-preview"><InteractiveBodyModel referenceImage={referenceImage} measurements={measurements} heightValue={heightValue} heightUnit={heightUnit} focusedMeasurementKey={focusedMeasurementKey} /><div className="model-preview-copy"><span className="model-empty-icon"><Icon name="scan" size={29} /></span><div><p className="eyebrow">MEASURED BODY MODEL</p><h3>Interactive model made from your measurements</h3><p>We use your height and measurements to size this visual model. It helps you check the result, but it is not a scan-grade 3D body scan. Ask a dressmaker to verify it before tailoring.</p><Badge tone="warning">Check before tailoring</Badge></div></div></div>;
  }
  const providerReady = model?.status === "ready" && Boolean(model.model_url_or_path);
  return <div className="model-empty model-empty-preview model-provider-preview"><InteractiveBodyModel referenceImage={LOCAL_REFERENCE_IMAGE} measurements={measurements} heightValue={heightValue} heightUnit={heightUnit} focusedMeasurementKey={focusedMeasurementKey} /><div className="model-preview-copy"><span className="model-empty-icon"><Icon name="scan" size={29} /></span><div><p className="eyebrow">MEASURED BODY MODEL</p><h3>Interactive 3D body model</h3><p>{providerReady ? "The model stays interactive. Select a measurement to show its guide and compare it with the body. A separate detailed model is available from the secure record." : assetError || "We made this visual model from your returned measurements. A detailed 3D model is not available yet."}</p><Badge tone={providerReady ? "success" : "teal"}>{providerReady ? "Detailed model available" : "Measurements mapped to model"}</Badge>{providerReady && assetUrl && <a className="button button-secondary model-provider-link" href={assetUrl} target="_blank" rel="noreferrer">Open detailed model <Icon name="external" size={15} /></a>}{providerReady && !assetUrl && !assetError && <small className="model-provider-loading">Loading secure model…</small>}</div></div></div>;
}

function CustomerMeasurements({ profile, onNavigate }: { profile: Profile; onNavigate: (page: string) => void }) {
  const state = useAsyncData(() => listCustomerMeasurementSets(profile.id), [profile.id], []);
  const sets = state.data ?? [];
  const actionFor = (bundle: ScanBundle) => {
    if (["draft", "uploaded", "needs_recapture"].includes(bundle.scan.status)) return <Button variant="secondary" onClick={() => onNavigate("scan")} icon="scan">Continue scan</Button>;
    return undefined;
  };
  return <div className="page-stack"><SectionHeader eyebrow="CUSTOMER WORKROOM · MEASUREMENTS" title="My measurements" description="Provider values and tailor adjustments stay attached to their scan." action={<Button variant="secondary" icon="scan" onClick={() => onNavigate("scan")}>Start a new scan</Button>} />{state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : sets.length === 0 ? <Panel><DataState icon="ruler" title="No measurements yet" body="Complete a scan and wait for a valid provider result before measurement values appear here." action={<Button onClick={() => onNavigate("scan")} icon="scan">Start a scan</Button>} /></Panel> : <div className="measurement-history-list">{sets.map((bundle) => <Panel className="history-panel" key={bundle.scan.id}><div className="panel-heading"><div><p className="eyebrow">SCAN {bundle.scan.id.slice(0, 8).toUpperCase()}</p><h2>{formatDate(bundle.scan.updated_at)}</h2></div><StatusBadge status={bundle.scan.status} /></div><div className="history-meta"><span><strong>{bundle.measurements.length}</strong> measurements</span><span><strong>{bundle.bodyModel ? "Model available" : "No model"}</strong></span><span>Updated {formatDateTime(bundle.scan.updated_at)}</span></div>{bundle.measurements.length > 0 ? <MeasurementTable measurements={bundle.measurements} /> : <DataState icon={bundle.scan.status === "failed" ? "info" : "scan"} title={bundle.scan.status === "failed" ? "Scan needs attention" : `${scanStatusLabel(bundle.scan.status)} scan`} body={bundle.scan.status === "needs_recapture" ? "Add new photos to create a clearer measurement result." : "Your measurement values will appear here after processing returns a valid result."} action={actionFor(bundle)} />}</Panel>)}</div>}</div>;
}

function CustomerOrders({ profile }: { profile: Profile }) {
  const ordersState = useAsyncData(() => listCustomerOrders(profile.id), [profile.id], []);
  const scansState = useAsyncData(() => listCustomerScans(profile.id), [profile.id], []);
  const [garmentType, setGarmentType] = useState("");
  const [scanId, setScanId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const orders = ordersState.data ?? [];
  const verifiedScans = (scansState.data ?? []).filter((scan) => scan.status === "verified");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setNotice("");
    if (!garmentType.trim() || !scanId) { setError("Choose a verified measurement set and enter a garment type."); return; }
    setBusy(true);
    try { await createOrder({ customerId: profile.id, organizationId: profile.organization_id, scanId, garmentType, notes }); setGarmentType(""); setScanId(""); setNotes(""); setNotice("Order request created."); ordersState.reload(); } catch (reason: unknown) { setError(readableError(reason)); } finally { setBusy(false); }
  };
  return <div className="page-stack"><SectionHeader eyebrow="CUSTOMER WORKROOM · ORDERS" title="My orders" description="Start a request from a verified measurement set and keep the production status in one place." />{ordersState.loading || scansState.loading ? <LoadingState /> : ordersState.error || scansState.error ? <ErrorState message={ordersState.error || scansState.error} onRetry={() => { ordersState.reload(); scansState.reload(); }} /> : <div className="orders-layout"><Panel className="order-list-panel"><div className="panel-heading"><div><p className="eyebrow">ORDER HISTORY</p><h2>{orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"}` : "No orders yet"}</h2></div><Badge tone="neutral">Customer view</Badge></div>{orders.length === 0 ? <DataState icon="bag" title="No orders yet" body="When a tailor review is verified, you can create an order request from that measurement set." /> : <div className="order-list">{orders.map((order) => <div className="order-card" key={order.id}><span className="order-icon"><Icon name="dress" size={18} /></span><span><strong>{order.garment_type}</strong><small>Requested {formatDate(order.created_at)}</small></span><Badge tone={order.status === "completed" ? "success" : order.status === "cancelled" ? "danger" : "teal"}>{orderStatusLabel(order.status)}</Badge><span className="order-date">Due {formatDate(order.due_date)}</span></div>)}</div>}</Panel><Panel className="new-order-panel"><p className="eyebrow">NEW REQUEST</p><h2>Begin an order.</h2><p>Only verified measurement sets can be attached to a new order request.</p>{verifiedScans.length === 0 ? <DataState icon="ruler" title="Verified set required" body="Ask your dressmaker to review a provider result before starting an order." /> : <form className="simple-form" onSubmit={submit}><div className="field"><label htmlFor="order-scan">Verified measurements</label><select id="order-scan" value={scanId} onChange={(event) => setScanId(event.target.value)}><option value="">Choose a scan</option>{verifiedScans.map((scan) => <option key={scan.id} value={scan.id}>{formatDate(scan.updated_at)} · {scan.id.slice(0, 8)}</option>)}</select></div><Field label="Garment type" value={garmentType} onChange={setGarmentType} placeholder="e.g. Custom blouse" /><div className="field"><label htmlFor="order-notes">Notes</label><textarea id="order-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Tell the dressmaker what you have in mind." /></div>{notice && <div className="form-notice"><Icon name="check" size={15} /> {notice}</div>}{error && <InlineError message={error} />}<Button type="submit" disabled={busy} icon={busy ? undefined : "arrow-right"}>{busy ? "Creating…" : "Create order request"}</Button></form>}</Panel></div>}</div>;
}

function CustomerFittings({ profile }: { profile: Profile }) {
  const ordersState = useAsyncData(() => listCustomerOrders(profile.id), [profile.id], []);
  const fittingsState = useAsyncData(() => listFittingsForOrders((ordersState.data ?? []).map((order) => order.id)), [profile.id, ordersState.data?.map((order) => order.id).join(",") ?? ""], []);
  const orders = ordersState.data ?? [];
  const fittings = fittingsState.data ?? [];
  const orderById = new Map(orders.map((order) => [order.id, order]));
  return <div className="page-stack"><SectionHeader eyebrow="CUSTOMER WORKROOM · FITTINGS" title="Fittings" description="Keep confirmed appointments close to the order they belong to." action={<Badge tone="neutral">Dressmaker scheduled</Badge>} />{ordersState.loading || fittingsState.loading ? <LoadingState /> : ordersState.error || fittingsState.error ? <ErrorState message={ordersState.error || fittingsState.error} onRetry={() => { ordersState.reload(); fittingsState.reload(); }} /> : <Panel className="fitting-history"><div className="panel-heading"><div><p className="eyebrow">APPOINTMENTS</p><h2>{fittings.length ? `${fittings.length} fitting${fittings.length === 1 ? "" : "s"}` : "No fittings scheduled"}</h2></div><Badge tone="neutral">Private schedule</Badge></div>{fittings.length === 0 ? <DataState icon="calendar" title="No fittings scheduled" body="A fitting appointment will appear here when your dressmaker creates or confirms one." /> : <div className="fitting-list">{fittings.map((fitting) => <div className="fitting-row" key={fitting.id}><span className="date-tile"><small>{new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(fitting.starts_at))}</small><strong>{new Intl.DateTimeFormat(undefined, { day: "2-digit" }).format(new Date(fitting.starts_at))}</strong></span><span><strong>{orderById.get(fitting.order_id)?.garment_type ?? "Order"}</strong><small>{formatDateTime(fitting.starts_at)}</small></span><span>{fitting.location ?? "Location to be confirmed"}</span><Badge tone={fitting.status === "confirmed" ? "success" : fitting.status === "cancelled" ? "danger" : "warning"}>{fittingStatusLabel(fitting.status)}</Badge></div>)}</div>}</Panel>}</div>;
}

function ProfilePage({ profile, onProfileChange }: { profile: Profile; onProfileChange: (profile: Profile) => void }) {
  const [firstName, setFirstName] = useState(profile.first_name);
  const [lastName, setLastName] = useState(profile.last_name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [emailNotifications, setEmailNotifications] = useState(profile.email_notifications ?? true);
  const [smsNotifications, setSmsNotifications] = useState(profile.sms_notifications ?? false);
  const [unit, setUnit] = useState(profile.unit_system);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const updated = await updateProfile(profile.id, { first_name: firstName, last_name: lastName, phone: phone.trim() || null, email_notifications: emailNotifications, sms_notifications: smsNotifications, unit_system: unit }); onProfileChange(updated); setPhone(updated.phone ?? ""); setEmailNotifications(updated.email_notifications); setSmsNotifications(updated.sms_notifications); setNotice("Profile and notification preferences updated."); } catch (reason: unknown) { setError(readableError(reason)); } finally { setBusy(false); }
  };
  const passwordReset = async () => {
    setError(""); setNotice("");
    try { await sendPasswordReset(profile.email); setNotice("A password reset link has been sent to your email."); } catch (reason: unknown) { setError(readableError(reason)); }
  };
  return <div className="page-stack"><SectionHeader eyebrow="ACCOUNT" title="Profile" description="Keep your account details and choose how SukatAI should reach you about order updates." /><div className="profile-layout"><Panel className="profile-card"><div className="profile-identity"><Avatar profile={profile} size="lg" /><div><h2>{displayName(profile)}</h2><p>{profile.email}</p><Badge tone={profile.role === "admin" ? "blue" : profile.role === "dressmaker" ? "warning" : "teal"}>{profile.role}</Badge></div></div><form className="profile-fields" onSubmit={save}><Field label="First name" value={firstName} onChange={setFirstName} /><Field label="Last name" value={lastName} onChange={setLastName} /><div className="field"><label htmlFor="profile-unit">Measurement display</label><select id="profile-unit" name="unit-system" value={unit} onChange={(event) => setUnit(event.target.value as "cm" | "ftin")}><option value="cm">Centimetres</option><option value="ftin">Feet / inches</option></select></div><div className="field"><label htmlFor="profile-phone">Mobile number</label><input id="profile-phone" name="phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+639171234567" type="tel" autoComplete="tel" /><small className="field-hint">Use the international format so text delivery works reliably.</small></div><div className="field"><label htmlFor="profile-email">Email address</label><input id="profile-email" name="email" value={profile.email} disabled /></div><div className="notification-preferences"><p className="eyebrow">ORDER UPDATES</p><label className="consent-label"><input name="email-notifications" type="checkbox" checked={emailNotifications} onChange={(event) => setEmailNotifications(event.target.checked)} /><span>Email me when my order is ready for pickup.</span></label><label className="consent-label"><input name="sms-notifications" type="checkbox" checked={smsNotifications} onChange={(event) => setSmsNotifications(event.target.checked)} /><span>Text this number when my order is ready for pickup.</span></label></div>{notice && <div className="form-notice"><Icon name="check" size={15} /> {notice}</div>}{error && <InlineError message={error} />}<Button type="submit" disabled={busy} icon="check">{busy ? "Saving…" : "Save profile"}</Button></form></Panel><Panel className="settings-card"><p className="eyebrow">SECURITY</p><h2>Account access</h2><p>Your email is managed by Supabase Auth. Use a secure reset link when you need to change your password.</p><div className="provider-row"><span><Icon name="mail" size={16} /> Verified email</span><Badge tone="success" dot>Auth managed</Badge></div><Button variant="secondary" onClick={() => void passwordReset()} icon="lock">Send password reset link</Button><div className="data-actions"><button type="button" onClick={() => void signOut()}><Icon name="logout" size={15} /> Sign out of this account</button></div></Panel></div></div>;
}

function OrganizationRequired({ role }: { role: "dressmaker" | "admin" }) {
  return <Panel><DataState icon="users" title="Organization assignment required" body={role === "dressmaker" ? "An administrator must assign this account to an organization before customer and scan records can appear." : "Create or connect an organization before inviting dressmakers and managing organization records."} /></Panel>;
}

function DressmakerDashboard({ profile, onNavigate }: { profile: Profile; onNavigate: (page: string) => void }) {
  if (!profile.organization_id) return <div className="page-stack"><SectionHeader eyebrow="DRESSMAKER WORKROOM" title="Your workroom is almost ready." description="An administrator needs to assign this account to an organization." /><OrganizationRequired role="dressmaker" /></div>;
  const customersState = useAsyncData(() => listOrgCustomers(profile.organization_id!), [profile.organization_id], []);
  const scansState = useAsyncData(() => listOrgScans(profile.organization_id!), [profile.organization_id], []);
  const ordersState = useAsyncData(() => listOrgOrders(profile.organization_id!), [profile.organization_id], []);
  const customers = customersState.data ?? [];
  const scans = scansState.data ?? [];
  const orders = ordersState.data ?? [];
  const queue = scans.filter((scan) => scan.status === "ready_for_review" || scan.status === "needs_recapture");
  const loading = customersState.loading || scansState.loading || ordersState.loading;
  const error = customersState.error || scansState.error || ordersState.error;
  return <div className="page-stack"><SectionHeader eyebrow={`DRESSMAKER WORKROOM · ${formatDate(new Date())}`} title="Tailor workspace" description="Review measurements and keep orders moving." action={<Button variant="secondary" icon="users" onClick={() => onNavigate("customers")}>View customers</Button>} />{loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => { customersState.reload(); scansState.reload(); ordersState.reload(); }} /> : <><div className="stats-grid four-stats"><StatCard icon="users" label="Customers" value={String(customers.length)} detail="Assigned to your organization" /><StatCard icon="ruler" label="Review queue" value={String(queue.length)} detail={queue.length ? "Needs attention" : "Nothing waiting"} /><StatCard icon="bag" label="Orders" value={String(orders.length)} detail="Organization orders" /><StatCard icon="calendar" label="Fittings" value="—" detail="Open the fittings page" /></div><div className="dashboard-grid"><Panel className="review-queue"><div className="panel-heading"><div><p className="eyebrow">MEASUREMENT REVIEWS</p><h2>{queue.length ? `${queue.length} scan${queue.length === 1 ? "" : "s"} waiting` : "Review queue is clear"}</h2></div><Badge tone={queue.length ? "warning" : "success"} dot>{queue.length ? "ACTION NEEDED" : "UP TO DATE"}</Badge></div>{queue.length === 0 ? <DataState icon="ruler" title="No scans ready for review" body="When a customer shares a provider result with your organization, it will appear here." /> : <div className="queue-list">{queue.slice(0, 5).map((scan) => <button type="button" className="queue-row" key={scan.id} onClick={() => onNavigate("reviews")}><span className="queue-icon"><Icon name="ruler" size={17} /></span><span><strong>Scan {scan.id.slice(0, 8)}</strong><small>Updated {formatDateTime(scan.updated_at)}</small></span><StatusBadge status={scan.status} /><Icon name="arrow-right" size={15} /></button>)}</div>}<button type="button" className="text-button" onClick={() => onNavigate("reviews")}>Open review queue <Icon name="arrow-right" size={15} /></button></Panel><Panel className="production-overview"><div className="panel-heading"><div><p className="eyebrow">WORKROOM STATUS</p><h2>Data at a glance</h2></div><Icon name="chart" size={20} /></div><div className="status-list"><span><i className="status-dot teal" /><b>Provider results</b><strong>{scans.filter((scan) => scan.status === "ready_for_review" || scan.status === "verified").length}</strong></span><span><i className="status-dot gold" /><b>Processing</b><strong>{scans.filter((scan) => scan.status === "processing" || scan.status === "processing_queued").length}</strong></span><span><i className="status-dot gray" /><b>Needs recapture</b><strong>{scans.filter((scan) => scan.status === "needs_recapture").length}</strong></span></div><Button variant="secondary" onClick={() => onNavigate("orders")} icon="bag">Open orders</Button></Panel></div></>}</div>;
}

function DressmakerCustomers({ profile }: { profile: Profile }) {
  if (!profile.organization_id) return <div className="page-stack"><SectionHeader eyebrow="CUSTOMERS" title="Customer directory" description="Customer records appear after organization assignment." /><OrganizationRequired role="dressmaker" /></div>;
  const customersState = useAsyncData(() => listOrgCustomers(profile.organization_id!), [profile.organization_id], []);
  const scansState = useAsyncData(() => listOrgScans(profile.organization_id!), [profile.organization_id], []);
  const [query, setQuery] = useState("");
  const customers = customersState.data ?? [];
  const scans = scansState.data ?? [];
  const filtered = customers.filter((customer) => `${customer.first_name} ${customer.last_name} ${customer.email}`.toLowerCase().includes(query.toLowerCase()));
  const scansFor = (customerId: string) => scans.filter((scan) => scan.customer_id === customerId);
  return <div className="page-stack"><SectionHeader eyebrow="DRESSMAKER WORKROOM · CUSTOMERS" title="Customer directory" description="Only customers assigned to your organization are visible here." action={<Button variant="secondary" icon="refresh" onClick={() => { customersState.reload(); scansState.reload(); }}>Refresh</Button>} />{customersState.loading || scansState.loading ? <LoadingState /> : customersState.error || scansState.error ? <ErrorState message={customersState.error || scansState.error} onRetry={() => { customersState.reload(); scansState.reload(); }} /> : <Panel className="directory-panel"><div className="directory-toolbar"><div><p className="eyebrow">ASSIGNED CUSTOMERS</p><h2>{customers.length ? `${customers.length} customer${customers.length === 1 ? "" : "s"}` : "No assigned customers"}</h2></div><label className="inline-search"><Icon name="search" size={16} /><input name="customer-search" aria-label="Search customers" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customers…" /></label></div>{customers.length === 0 ? <DataState icon="users" title="No assigned customers" body="Customer accounts become visible when an administrator or workflow assigns them to this organization." /> : <div className="directory-table"><div className="directory-head"><span>Customer</span><span>Email</span><span>Scans</span><span>Latest status</span><span>Joined</span><span>Access</span></div>{filtered.map((customer) => { const customerScans = scansFor(customer.id); const latest = customerScans[0]; return <div className="directory-row" key={customer.id}><span className="customer-cell"><Avatar profile={customer} size="sm" /><strong>{displayName(customer)}</strong></span><span>{customer.email}</span><span>{customerScans.length}</span><span>{latest ? <StatusBadge status={latest.status} /> : "No scans"}</span><span>{formatDate(customer.created_at)}</span><span className="teal-text">Organization-scoped</span></div>; })}</div>}</Panel>}</div>;
}

function DressmakerReviews({ profile }: { profile: Profile }) {
  if (!profile.organization_id) return <div className="page-stack"><SectionHeader eyebrow="MEASUREMENT REVIEWS" title="Review queue" description="Review access is scoped to your assigned organization." /><OrganizationRequired role="dressmaker" /></div>;
  const scansState = useAsyncData(() => listOrgScans(profile.organization_id!), [profile.organization_id], []);
  const customersState = useAsyncData(() => listOrgCustomers(profile.organization_id!), [profile.organization_id], []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scans = (scansState.data ?? []).filter((scan) => ["ready_for_review", "needs_recapture", "verified"].includes(scan.status));
  const customers = customersState.data ?? [];
  const selected = scans.find((scan) => scan.id === selectedId) ?? scans[0];
  const selectedState = useAsyncData(() => selected ? getScanBundle(selected.id, true) : Promise.resolve(null), [selected?.id ?? ""], null);
  const bundle = selectedState.data;
  useEffect(() => {
    if (!selected && scans.length) setSelectedId(scans[0].id);
  }, [selected?.id, scans.length]);
  useEffect(() => {
    if (!bundle) return;
    setValues(Object.fromEntries(bundle.measurements.map((measurement) => [measurement.id, String(measurement.adjusted_value ?? measurement.value)])));
  }, [bundle?.scan.id, bundle?.measurements.length]);
  const customer = selected ? customers.find((item) => item.id === selected.customer_id) : undefined;
  const refresh = () => { scansState.reload(); selectedState.reload(); };
  const saveAdjustments = async () => {
    if (!bundle) return;
    setBusy(true); setError("");
    try {
      const changed = bundle.measurements.filter((measurement) => values[measurement.id] !== String(measurement.adjusted_value ?? measurement.value));
      for (const measurement of changed) {
        const nextValue = Number(values[measurement.id]);
        if (!Number.isFinite(nextValue) || nextValue <= 0) throw new Error(`Enter a valid value for ${displayMeasurementKey(measurement.key)}.`);
        await updateMeasurement(measurement.id, nextValue, reason.trim() || null, profile.id);
      }
      if (changed.length) await addReviewEvent({ scanId: bundle.scan.id, actorId: profile.id, eventType: "adjusted", payload: { count: changed.length, reason: reason.trim() || null } });
      setReason(""); refresh();
    } catch (reasonValue: unknown) { setError(readableError(reasonValue)); } finally { setBusy(false); }
  };
  const markReview = async (status: "verified" | "needs_recapture") => {
    if (!bundle) return;
    setBusy(true); setError("");
    try { await updateScan(bundle.scan.id, { status }); await addReviewEvent({ scanId: bundle.scan.id, actorId: profile.id, eventType: status === "verified" ? "approved" : "recapture_requested", payload: {} }); refresh(); } catch (reasonValue: unknown) { setError(readableError(reasonValue)); } finally { setBusy(false); }
  };
  return <div className="page-stack"><SectionHeader eyebrow="DRESSMAKER WORKROOM · REVIEWS" title="Measurement reviews" description="Open a customer scan, inspect private photos, and record any adjustment with a reason." action={<Button variant="secondary" icon="refresh" onClick={refresh}>Refresh queue</Button>} />{scansState.loading || customersState.loading ? <LoadingState /> : scansState.error || customersState.error ? <ErrorState message={scansState.error || customersState.error} onRetry={() => { scansState.reload(); customersState.reload(); }} /> : <><div className="review-switcher">{scans.length === 0 ? <DataState icon="ruler" title="No scans ready for review" body="Customer scans shared with this organization will appear here." /> : scans.map((scan) => <button type="button" key={scan.id} className={cn("review-switcher-item", selected?.id === scan.id && "active")} onClick={() => setSelectedId(scan.id)}><strong>{customers.find((item) => item.id === scan.customer_id) ? displayName(customers.find((item) => item.id === scan.customer_id)!) : `Customer ${scan.customer_id.slice(0, 6)}`}</strong><span>{scanStatusLabel(scan.status)} · {formatDate(scan.updated_at)}</span></button>)}</div>{bundle && <div className="review-workspace"><Panel className="review-preview"><div className="panel-heading"><div><p className="eyebrow">PRIVATE SCAN VIEWS</p><h2>{customer ? displayName(customer) : "Customer scan"}</h2></div><StatusBadge status={bundle.scan.status} /></div><PrivatePhotos assets={bundle.assets} /><div className="review-customer-card"><Avatar profile={customer} tone="gold" size="sm" /><div><strong>{customer?.email ?? "Authenticated customer"}</strong><small>Scan updated {formatDateTime(bundle.scan.updated_at)}</small></div></div><p className="review-access-note"><Icon name="lock" size={14} /> Access is signed and scoped to this organization.</p></Panel><Panel className="review-editor"><p className="eyebrow">REVIEWABLE MEASUREMENTS</p><h2>Adjust only with context.</h2><p className="muted-copy">Provider values remain visible beside any adjusted value. A reason is saved with the review event.</p>{bundle.measurements.length === 0 ? <DataState icon="ruler" title="No provider measurements" body="This scan does not have a valid provider result to review." /> : <><MeasurementTable measurements={bundle.measurements} editable values={values} onValueChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))} /><div className="field note-field"><label htmlFor="review-reason">Adjustment reason <small>optional until a value changes</small></label><textarea id="review-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain what you checked or adjusted." /></div>{error && <InlineError message={error} />}<div className="review-actions"><Button variant="secondary" onClick={() => void saveAdjustments()} disabled={busy}>{busy ? "Saving…" : "Save adjustments"}</Button><Button variant="danger" onClick={() => void markReview("needs_recapture")} disabled={busy} icon="refresh">Request recapture</Button><Button onClick={() => void markReview("verified")} disabled={busy || bundle.scan.status === "verified"} icon="check">Verify measurements</Button></div></>}</Panel><Panel className="audit-panel"><div className="panel-heading"><div><p className="eyebrow">MODEL READINESS</p><h2>3D viewer handoff</h2></div><Badge tone={bundle.bodyModel?.status === "ready" ? "success" : "neutral"} dot>{bundle.bodyModel?.status === "ready" ? "MODEL AVAILABLE" : "NO MODEL"}</Badge></div><ModelViewer model={bundle.bodyModel} measurements={bundle.measurements} heightValue={bundle.scan.height_value} heightUnit={bundle.scan.height_unit} /></Panel></div>}</>}</div>;
}

function DressmakerOrders({ profile }: { profile: Profile }) {
  if (!profile.organization_id) return <div className="page-stack"><SectionHeader eyebrow="ORDERS" title="Order board" description="Order access is scoped to your assigned organization." /><OrganizationRequired role="dressmaker" /></div>;
  const state = useAsyncData(() => listOrgOrders(profile.organization_id!), [profile.organization_id], []);
  const orders = state.data ?? [];
  const advance: Partial<Record<Order["status"], Order["status"]>> = { new: "accepted", accepted: "in_production", in_production: "for_fitting", for_fitting: "ready_for_pickup", ready_for_pickup: "completed" };
  const update = async (order: Order) => { const next = advance[order.status]; if (!next) return; try { await updateOrderStatus(order.id, next); state.reload(); } catch { /* the error remains visible after the next reload */ } };
  return <div className="page-stack"><SectionHeader eyebrow="DRESSMAKER WORKROOM · ORDERS" title="Order board" description="Move organization orders through their real production status." action={<Button variant="secondary" icon="refresh" onClick={state.reload}>Refresh</Button>} />{state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : <Panel className="order-list-panel"><div className="panel-heading"><div><p className="eyebrow">ORGANIZATION ORDERS</p><h2>{orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"}` : "No orders yet"}</h2></div><Badge tone="neutral">Role-scoped</Badge></div>{orders.length === 0 ? <DataState icon="bag" title="No orders yet" body="Customer order requests assigned to this organization will appear here." /> : <div className="order-list">{orders.map((order) => <div className="order-card" key={order.id}><span className="order-icon"><Icon name="dress" size={18} /></span><span><strong>{order.garment_type}</strong><small>Created {formatDate(order.created_at)} · Customer {order.customer_id.slice(0, 8)}</small></span><Badge tone={order.status === "completed" ? "success" : order.status === "cancelled" ? "danger" : "teal"}>{orderStatusLabel(order.status)}</Badge><Button variant="ghost" onClick={() => void update(order)} disabled={!advance[order.status]} icon="arrow-right">{advance[order.status] ? "Advance" : "Complete"}</Button></div>)}</div>}</Panel>}</div>;
}

function DressmakerFittings({ profile }: { profile: Profile }) {
  if (!profile.organization_id) return <div className="page-stack"><SectionHeader eyebrow="FITTINGS" title="Fitting schedule" description="Fitting access is scoped to your assigned organization." /><OrganizationRequired role="dressmaker" /></div>;
  const ordersState = useAsyncData(() => listOrgOrders(profile.organization_id!), [profile.organization_id], []);
  const orderIds = ordersState.data?.map((order) => order.id) ?? [];
  const fittingsState = useAsyncData(() => listFittingsForOrders(orderIds), [profile.organization_id, orderIds.join(",")], []);
  const orders = ordersState.data ?? [];
  const fittings = fittingsState.data ?? [];
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const [orderId, setOrderId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [location, setLocation] = useState("");
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setFormError(""); setFormNotice("");
    if (!orderId || !startsAt) { setFormError("Choose an order and appointment time."); return; }
    setBusy(true);
    try { await createFitting({ orderId, startsAt: new Date(startsAt).toISOString(), location, notes: "" }); setFormNotice("Fitting request created."); setOrderId(""); setStartsAt(""); setLocation(""); fittingsState.reload(); } catch (reason: unknown) { setFormError(readableError(reason)); } finally { setBusy(false); }
  };
  const update = async (fitting: Fitting, status: Fitting["status"]) => { try { await updateFittingStatus(fitting.id, status); fittingsState.reload(); } catch (reason: unknown) { setFormError(readableError(reason)); } };
  return <div className="page-stack"><SectionHeader eyebrow="DRESSMAKER WORKROOM · FITTINGS" title="Fitting schedule" description="Create and confirm appointments against organization orders." action={<Button variant="secondary" icon="refresh" onClick={() => { ordersState.reload(); fittingsState.reload(); }}>Refresh</Button>} />{ordersState.loading || fittingsState.loading ? <LoadingState /> : ordersState.error || fittingsState.error ? <ErrorState message={ordersState.error || fittingsState.error} onRetry={() => { ordersState.reload(); fittingsState.reload(); }} /> : <div className="fitting-layout"><Panel className="schedule-table-panel"><div className="panel-heading"><div><p className="eyebrow">UPCOMING & PAST</p><h2>{fittings.length ? `${fittings.length} appointment${fittings.length === 1 ? "" : "s"}` : "No appointments"}</h2></div></div>{fittings.length === 0 ? <DataState icon="calendar" title="No appointments" body="Create the first fitting request from an organization order." /> : <div className="schedule-list">{fittings.map((fitting) => <div className="schedule-item" key={fitting.id}><strong>{formatDateTime(fitting.starts_at)}</strong><span><b>{orderById.get(fitting.order_id)?.garment_type ?? "Order"}</b><small>{fitting.location ?? "Location to be confirmed"}</small></span><Badge tone={fitting.status === "confirmed" ? "success" : fitting.status === "cancelled" ? "danger" : "warning"}>{fittingStatusLabel(fitting.status)}</Badge>{fitting.status === "requested" && <Button variant="ghost" onClick={() => void update(fitting, "confirmed")} icon="check">Confirm</Button>}</div>)}</div>}</Panel><Panel className="invite-form-panel"><span className="invite-form-icon"><Icon name="calendar" size={20} /></span><p className="eyebrow">NEW APPOINTMENT</p><h2>Schedule a fitting.</h2><p>Create a requested appointment for one of the organization’s orders.</p><form className="simple-form" onSubmit={create}><div className="field"><label htmlFor="fitting-order">Order</label><select id="fitting-order" value={orderId} onChange={(event) => setOrderId(event.target.value)}><option value="">Choose an order</option>{orders.filter((order) => order.status !== "cancelled" && order.status !== "completed").map((order) => <option key={order.id} value={order.id}>{order.garment_type} · {order.id.slice(0, 8)}</option>)}</select></div><div className="field"><label htmlFor="fitting-time">Starts at</label><input id="fitting-time" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></div><Field label="Location" value={location} onChange={setLocation} placeholder="Studio or address" />{formNotice && <div className="form-notice"><Icon name="check" size={15} /> {formNotice}</div>}{formError && <InlineError message={formError} />}<Button type="submit" disabled={busy} icon="calendar">{busy ? "Creating…" : "Create fitting request"}</Button></form></Panel></div>}</div>;
}

type AdminSnapshot = { customers: Profile[]; dressmakers: Profile[]; admins: Profile[]; scans: Scan[]; orders: Order[]; invitations: Invitation[] };

function loadAdminSnapshot(): Promise<AdminSnapshot> {
  return Promise.all([listAdminProfiles("customer"), listAdminProfiles("dressmaker"), listAdminProfiles("admin"), listAdminScans(), listAdminOrders(), listInvitations()]).then(([customers, dressmakers, admins, scans, orders, invitations]) => ({ customers, dressmakers, admins, scans, orders, invitations }));
}

function AdminDashboard() {
  const state = useAsyncData(loadAdminSnapshot, [], null);
  const snapshot = state.data;
  if (state.loading) return <div className="page-stack"><SectionHeader eyebrow="ADMIN CONSOLE" title="Admin dashboard" description="Manage users, invitations, and activity." /><LoadingState /></div>;
  if (state.error || !snapshot) return <div className="page-stack"><SectionHeader eyebrow="ADMIN CONSOLE" title="Admin dashboard" description="Manage users, invitations, and activity." /><ErrorState message={state.error || "The administrative snapshot was not returned."} onRetry={state.reload} /></div>;
  const pending = snapshot.scans.filter((scan) => scan.status === "ready_for_review" || scan.status === "needs_recapture");
  const processing = snapshot.scans.filter((scan) => scan.status === "processing" || scan.status === "processing_queued");
  return <div className="page-stack"><SectionHeader eyebrow={`ADMIN CONSOLE · ${formatDate(new Date())}`} title="Admin dashboard" description="Manage users, invitations, and activity." action={<Button variant="secondary" icon="refresh" onClick={state.reload}>Refresh data</Button>} /><div className="stats-grid six-stats"><StatCard icon="users" label="Customers" value={String(snapshot.customers.length)} detail="Auth profiles" /><StatCard icon="dress" label="Dressmakers" value={String(snapshot.dressmakers.length)} detail="Invited accounts" /><StatCard icon="scan" label="Scans" value={String(snapshot.scans.length)} detail="All statuses" /><StatCard icon="ruler" label="Review queue" value={String(pending.length)} detail="Needs staff action" /><StatCard icon="bag" label="Orders" value={String(snapshot.orders.length)} detail="All organizations" /><StatCard icon="mail" label="Invitations" value={String(snapshot.invitations.length)} detail="Invitation records" /></div><div className="admin-chart-grid"><Panel className="activity-chart"><div className="panel-heading"><div><p className="eyebrow">SCAN PIPELINE</p><h2>Current statuses</h2></div><Icon name="chart" size={20} /></div>{snapshot.scans.length === 0 ? <DataState icon="scan" title="No scan activity yet" body="Live scan statuses will appear here once customers create and upload scans." /> : <div className="admin-status-grid">{(["draft", "uploaded", "processing_queued", "processing", "ready_for_review", "verified", "needs_recapture", "failed"] as ScanStatus[]).map((status) => <div key={status}><span>{scanStatusLabel(status)}</span><strong>{snapshot.scans.filter((scan) => scan.status === status).length}</strong><i style={{ width: `${snapshot.scans.length ? Math.max(2, snapshot.scans.filter((scan) => scan.status === status).length / snapshot.scans.length * 100) : 2}%` }} /></div>)}</div>}</Panel><Panel className="status-chart"><div className="panel-heading"><div><p className="eyebrow">PROCESSING</p><h2>Provider queue</h2></div><Badge tone={processing.length ? "warning" : "success"} dot>{processing.length ? "IN PROGRESS" : "CLEAR"}</Badge></div><div className="admin-queue-number"><strong>{processing.length}</strong><span>scan{processing.length === 1 ? "" : "s"} waiting for a provider state</span></div><p className="muted-copy">Results are counted only when the processing service writes a validated measurement set.</p></Panel></div><div className="admin-lower-grid"><Panel className="system-activity"><div className="panel-heading"><div><p className="eyebrow">RECENT SCANS</p><h2>Latest records</h2></div></div>{snapshot.scans.length === 0 ? <DataState icon="database" title="No records" body="There are no scan records to display." /> : <div className="system-list">{snapshot.scans.slice(0, 6).map((scan) => <div className="system-row" key={scan.id}><span className="system-icon"><Icon name="scan" size={15} /></span><span><strong>{scan.id.slice(0, 12)}</strong><small>Customer {scan.customer_id.slice(0, 8)}</small></span><StatusBadge status={scan.status} /><small>{formatDate(scan.updated_at)}</small></div>)}</div>}</Panel><Panel className="attention-panel"><div className="panel-heading"><div><p className="eyebrow">ADMIN ACTIONS</p><h2>Needs attention</h2></div></div>{pending.length === 0 ? <DataState icon="check" title="Nothing urgent" body="The current scan review queue is clear." /> : <div className="attention-list">{pending.slice(0, 5).map((scan) => <div className="attention-row" key={scan.id}><span><Icon name="ruler" size={15} /></span><strong>!</strong><small>{scanStatusLabel(scan.status)}<br />Scan {scan.id.slice(0, 8)}</small></div>)}</div>}</Panel></div></div>;
}

function AdminCustomers() {
  const state = useAsyncData(() => listAdminProfiles("customer"), [], []);
  return <AdminPeoplePage title="Customers" eyebrow="ADMIN CONSOLE · CUSTOMERS" description="All customer profiles visible to administrators." profiles={state.data ?? []} loading={state.loading} error={state.error} reload={state.reload} role="customer" />;
}

function AdminDressmakers() {
  const state = useAsyncData(() => listAdminProfiles("dressmaker"), [], []);
  return <AdminPeoplePage title="Dressmakers" eyebrow="ADMIN CONSOLE · DRESSMAKERS" description="Invitation-created dressmaker accounts and organization assignments." profiles={state.data ?? []} loading={state.loading} error={state.error} reload={state.reload} role="dressmaker" />;
}

function AdminPeoplePage({ title, eyebrow, description, profiles, loading, error, reload, role }: { title: string; eyebrow: string; description: string; profiles: Profile[]; loading: boolean; error: string; reload: () => void; role: "customer" | "dressmaker" }) {
  const [query, setQuery] = useState("");
  const organizationsState = useAsyncData(listOrganizations, [], []);
  const [assignmentError, setAssignmentError] = useState("");
  const filtered = profiles.filter((profile) => `${profile.first_name} ${profile.last_name} ${profile.email}`.toLowerCase().includes(query.toLowerCase()));
  const organizations = organizationsState.data ?? [];
  const assign = async (profile: Profile, organizationId: string) => {
    setAssignmentError("");
    try { await assignProfileOrganization(profile.id, organizationId || null); reload(); } catch (reason: unknown) { setAssignmentError(readableError(reason)); }
  };
  return <div className="page-stack"><SectionHeader eyebrow={eyebrow} title={title} description={description} action={<Button variant="secondary" icon="refresh" onClick={() => { reload(); organizationsState.reload(); }}>Refresh</Button>} />{loading || organizationsState.loading ? <LoadingState /> : error || organizationsState.error ? <ErrorState message={error || organizationsState.error} onRetry={() => { reload(); organizationsState.reload(); }} /> : <Panel className="admin-table-panel"><div className="directory-toolbar"><div><p className="eyebrow">LIVE AUTH PROFILES</p><h2>{profiles.length ? `${profiles.length} ${role}${profiles.length === 1 ? "" : "s"}` : `No ${role}s yet`}</h2></div><label className="inline-search"><Icon name="search" size={16} /><input name={`${role}-search`} aria-label={`Search ${role}s`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${role}s…`} /></label></div>{assignmentError && <InlineError message={assignmentError} />}{profiles.length === 0 ? <DataState icon="users" title={`No ${role}s yet`} body={role === "dressmaker" ? "Dressmaker accounts appear after an administrator invitation is accepted." : "Customer accounts appear after public Supabase Auth registration."} /> : <div className="admin-user-table"><div className="directory-head"><span>Name</span><span>Email</span><span>Organization</span><span>Unit</span><span>Created</span><span>Role</span></div>{filtered.map((profile) => <div className="directory-row" key={profile.id}><span className="customer-cell"><Avatar profile={profile} tone={role === "dressmaker" ? "gold" : "teal"} size="sm" /><strong>{displayName(profile)}</strong></span><span>{profile.email}</span><span><select className="compact-select" aria-label={`Assign ${displayName(profile)} to an organization`} value={profile.organization_id ?? ""} onChange={(event) => void assign(profile, event.target.value)}><option value="">Unassigned</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></span><span>{profile.unit_system}</span><span>{formatDate(profile.created_at)}</span><span><Badge tone={role === "dressmaker" ? "warning" : "teal"}>{profile.role}</Badge></span></div>)}</div>}</Panel>}</div>;
}

function AdminInvitations({ profile }: { profile: Profile }) {
  const organizationsState = useAsyncData(listOrganizations, [], []);
  const invitationsState = useAsyncData(listInvitations, [], []);
  const organizations = organizationsState.data ?? [];
  const invitations = invitationsState.data ?? [];
  const [email, setEmail] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [removeNotice, setRemoveNotice] = useState("");
  useEffect(() => { if (!organizationId && organizations[0]) setOrganizationId(organizations[0].id); }, [organizationId, organizations]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setNotice(""); setInviteUrl(""); setRemoveError(""); setRemoveNotice("");
    if (!email.trim() || !organizationId) { setError("Enter an email and choose an organization."); return; }
    setBusy(true);
    try {
      const result = await inviteDressmaker({ email, organizationId, redirectTo: `${invitationAppOrigin()}/?invite=` });
      const noticeMessage = result.emailStatus === "sent"
        ? "Invitation created and sent by email."
        : result.emailStatus === "existing_account"
          ? "Invitation created for an existing account. Supabase cannot send a second account invite, so share the secure link below. The recipient should sign in with this email before accepting."
          : result.emailError || "Invitation created. Email delivery is not configured yet, so share the secure link below.";
      setNotice(noticeMessage);
      setInviteUrl(result.inviteUrl ?? "");
      setEmail("");
      invitationsState.reload();
    } catch (reason: unknown) { setError(readableError(reason)); } finally { setBusy(false); }
  };
  const removeInvitation = async (invitation: Invitation) => {
    if (!isRemovableInvitation(invitation) || removingId) return;
    if (!window.confirm(`Remove the invitation for ${invitation.email}? This permanently deletes the invitation and its secure token.`)) return;
    setRemovingId(invitation.id); setRemoveError(""); setRemoveNotice(""); setError(""); setNotice(""); setInviteUrl("");
    try {
      await revokeDressmakerInvitation(invitation.id);
      setEmail(invitation.email);
      setOrganizationId(invitation.organization_id);
      setRemoveNotice(`Invitation removed from Supabase. You can send a new invitation to ${invitation.email}.`);
      invitationsState.reload();
    } catch (reason: unknown) {
      setRemoveError(readableError(reason));
    } finally {
      setRemovingId("");
    }
  };
  const organizationName = (id: string) => organizations.find((organization) => organization.id === id)?.name ?? id.slice(0, 8);
  return <div className="page-stack">
    <SectionHeader eyebrow="ADMIN CONSOLE · INVITATIONS" title="Invite a dressmaker" description="Create an organization-scoped invitation and send it to the dressmaker’s email address." action={<Button variant="secondary" icon="refresh" onClick={() => { organizationsState.reload(); invitationsState.reload(); }}>Refresh</Button>} />
    {organizationsState.loading || invitationsState.loading ? <LoadingState /> : organizationsState.error || invitationsState.error ? <ErrorState message={organizationsState.error || invitationsState.error} onRetry={() => { organizationsState.reload(); invitationsState.reload(); }} /> : <div className="invitation-layout">
      <Panel className="invite-form-panel">
        <span className="invite-form-icon"><Icon name="mail" size={20} /></span>
        <p className="eyebrow">INVITATION-ONLY ACCESS</p>
        <h2>Send a secure invite.</h2>
        <p>The invite is stored with a one-time hashed token and delivered through the configured email provider.</p>
        {organizations.length === 0 ? <DataState icon="users" title="Create an organization first" body="An organization is required before a dressmaker can be invited." /> : <form className="simple-form" onSubmit={submit}>
          <Field label="Dressmaker email" value={email} onChange={setEmail} placeholder="dressmaker@domain.com" type="email" />
          <div className="field"><label htmlFor="invite-organization">Organization</label><select id="invite-organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></div>
          <div className="invite-lock-note"><Icon name="lock" size={15} /> The raw invitation token is never stored in the database.</div>
          {notice && <div className="form-notice"><Icon name="check" size={15} /> {notice}</div>}
          {inviteUrl && <div className="field invite-link-field"><label htmlFor="invite-link">Secure invite link</label><input id="invite-link" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /></div>}
          {error && <InlineError message={error} />}
          <Button type="submit" disabled={busy} icon="mail">{busy ? "Creating invite…" : "Create invitation"}</Button>
        </form>}
      </Panel>
      <Panel className="invitation-list">
        <div className="panel-heading"><div><p className="eyebrow">INVITATION LOG</p><h2>{invitations.length ? `${invitations.length} invitation${invitations.length === 1 ? "" : "s"}` : "No invitations yet"}</h2></div><Badge tone="neutral">Delivery logged</Badge></div>
        {removeNotice && <div className="form-notice invitation-action-message" role="status"><Icon name="check" size={15} /> {removeNotice}</div>}
        {removeError && <InlineError message={removeError} />}
        {invitations.length === 0 ? <DataState icon="mail" title="No invitations yet" body="Invitation records created by administrators will appear here." /> : invitations.map((invitation) => {
          const state = invitationState(invitation);
          return <div className="invitation-row" key={invitation.id}>
            <Avatar initialsText={invitation.email.slice(0, 2).toUpperCase()} tone="gold" size="sm" />
            <div><strong>{invitation.email}</strong><small>{organizationName(invitation.organization_id)} · Created {formatDate(invitation.created_at)}</small></div>
            <span className="invite-expiry">Expires {formatDate(invitation.expires_at)}</span>
            <Badge tone={state === "Accepted" ? "success" : state === "Pending" ? "warning" : "neutral"}>{state}</Badge>
            {invitation.email_delivery_status && <Badge tone={invitation.email_delivery_status === "sent" ? "success" : invitation.email_delivery_status === "failed" ? "danger" : "warning"}>{invitation.email_delivery_status === "sent" ? "Email sent" : invitation.email_delivery_status === "not_configured" ? "Email not configured" : "Email " + invitation.email_delivery_status}</Badge>}
            {isRemovableInvitation(invitation) && <Button variant="ghost" icon="x" className="invitation-remove" onClick={() => void removeInvitation(invitation)} disabled={Boolean(removingId)} aria-label={`Remove invitation for ${invitation.email}`}>{removingId === invitation.id ? "Removing…" : "Remove"}</Button>}
          </div>;
        })}
      </Panel>
    </div>}
  </div>;
}

function AdminOrders() {
  const state = useAsyncData(listAdminOrders, [], []);
  const orders = state.data ?? [];
  const advance: Partial<Record<Order["status"], Order["status"]>> = { new: "accepted", accepted: "in_production", in_production: "for_fitting", for_fitting: "ready_for_pickup", ready_for_pickup: "completed" };
  const update = async (order: Order) => { const next = advance[order.status]; if (!next) return; try { await updateOrderStatus(order.id, next); state.reload(); } catch { state.reload(); } };
  return <div className="page-stack"><SectionHeader eyebrow="ADMIN CONSOLE · ORDERS" title="All orders" description="Live order records across the organizations you administer." action={<Button variant="secondary" icon="refresh" onClick={state.reload}>Refresh</Button>} />{state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : <Panel className="admin-table-panel"><div className="panel-heading"><div><p className="eyebrow">ORDER RECORDS</p><h2>{orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"}` : "No orders yet"}</h2></div><Badge tone="neutral">Live data</Badge></div>{orders.length === 0 ? <DataState icon="bag" title="No orders yet" body="Customer requests will appear here after a verified measurement set is attached." /> : <div className="order-list">{orders.map((order) => <div className="order-card" key={order.id}><span className="order-icon"><Icon name="dress" size={18} /></span><span><strong>{order.garment_type}</strong><small>Customer {order.customer_id.slice(0, 8)} · Organization {order.organization_id?.slice(0, 8) ?? "Unassigned"}</small></span><Badge tone={order.status === "completed" ? "success" : order.status === "cancelled" ? "danger" : "teal"}>{orderStatusLabel(order.status)}</Badge><span className="order-date">{formatDate(order.created_at)}</span><Button variant="ghost" onClick={() => void update(order)} disabled={!advance[order.status]} icon="arrow-right">{advance[order.status] ? "Advance" : "Complete"}</Button></div>)}</div>}</Panel>}</div>;
}

function AdminReports() {
  const state = useAsyncData(loadAdminSnapshot, [], null);
  const snapshot = state.data;
  if (state.loading) return <div className="page-stack"><SectionHeader eyebrow="ADMIN CONSOLE · REPORTS" title="Reports" description="Aggregate live records without making up activity." /><LoadingState /></div>;
  if (state.error || !snapshot) return <div className="page-stack"><SectionHeader eyebrow="ADMIN CONSOLE · REPORTS" title="Reports" description="Aggregate live records without making up activity." /><ErrorState message={state.error || "The report data was not returned."} onRetry={state.reload} /></div>;
  const statuses = (["draft", "uploaded", "processing_queued", "processing", "ready_for_review", "verified", "needs_recapture", "failed"] as ScanStatus[]).map((status) => ({ status, count: snapshot.scans.filter((scan) => scan.status === status).length }));
  const orderStatuses = (["new", "accepted", "in_production", "for_fitting", "ready_for_pickup", "completed", "cancelled"] as Order["status"][]).map((status) => ({ status, count: snapshot.orders.filter((order) => order.status === status).length }));
  return <div className="page-stack"><SectionHeader eyebrow="ADMIN CONSOLE · REPORTS" title="Reports" description="Use current Supabase records to understand pipeline health." action={<Button variant="secondary" icon="refresh" onClick={state.reload}>Refresh</Button>} /><div className="reports-grid"><Panel className="category-chart"><div className="panel-heading"><div><p className="eyebrow">SCAN STATUSES</p><h2>Measurement pipeline</h2></div><Icon name="scan" size={20} /></div>{snapshot.scans.length === 0 ? <DataState icon="scan" title="No scan data" body="Status reporting begins when customers create scans." /> : <div className="report-bars">{statuses.map((item) => <div className="report-bar-row" key={item.status}><span>{scanStatusLabel(item.status)}</span><strong>{item.count}</strong><i><b style={{ width: `${Math.max(item.count ? 7 : 2, item.count / snapshot.scans.length * 100)}%` }} /></i></div>)}</div>}</Panel><Panel className="confidence-chart"><div className="panel-heading"><div><p className="eyebrow">ORDER STATUSES</p><h2>Production pipeline</h2></div><Icon name="bag" size={20} /></div>{snapshot.orders.length === 0 ? <DataState icon="bag" title="No order data" body="Order reporting begins after a customer creates a request." /> : <div className="report-bars">{orderStatuses.map((item) => <div className="report-bar-row" key={item.status}><span>{orderStatusLabel(item.status)}</span><strong>{item.count}</strong><i><b style={{ width: `${Math.max(item.count ? 7 : 2, item.count / snapshot.orders.length * 100)}%` }} /></i></div>)}</div>}</Panel><Panel className="performance-table"><div className="panel-heading"><div><p className="eyebrow">ACCOUNT COVERAGE</p><h2>Current totals</h2></div><Badge tone="neutral">Calculated from live rows</Badge></div><div className="performance-grid"><span>Metric</span><span>Count</span><span>Latest created</span><span>Access</span><strong>Customers</strong><strong>{snapshot.customers.length}</strong><span>{formatDate(snapshot.customers.at(-1)?.created_at)}</span><span>Admin query</span><strong>Dressmakers</strong><strong>{snapshot.dressmakers.length}</strong><span>{formatDate(snapshot.dressmakers.at(-1)?.created_at)}</span><span>Admin query</span><strong>Invitations</strong><strong>{snapshot.invitations.length}</strong><span>{formatDate(snapshot.invitations.at(-1)?.created_at)}</span><span>Admin query</span></div><div className="report-metric-cards" aria-label="Account coverage summary"><article><span><Icon name="users" size={18} /></span><strong>Customers</strong><b>{snapshot.customers.length}</b><small>Latest {formatDate(snapshot.customers.at(-1)?.created_at)}</small></article><article><span><Icon name="dress" size={18} /></span><strong>Dressmakers</strong><b>{snapshot.dressmakers.length}</b><small>Latest {formatDate(snapshot.dressmakers.at(-1)?.created_at)}</small></article><article><span><Icon name="mail" size={18} /></span><strong>Invitations</strong><b>{snapshot.invitations.length}</b><small>Latest {formatDate(snapshot.invitations.at(-1)?.created_at)}</small></article></div></Panel></div></div>;
}

function AdminSettings({ profile }: { profile: Profile }) {
  const organizationsState = useAsyncData(listOrganizations, [], []);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setNotice("");
    if (!name.trim()) { setError("Enter an organization name."); return; }
    setBusy(true);
    try { await createOrganization({ name, ownerId: profile.id }); setName(""); setNotice("Organization created."); organizationsState.reload(); } catch (reason: unknown) { setError(readableError(reason)); } finally { setBusy(false); }
  };
  return <div className="page-stack"><SectionHeader eyebrow="ADMIN CONSOLE · SETTINGS" title="Settings" description="Manage organization records and inspect the connection required by this workspace." action={<Button variant="secondary" icon="refresh" onClick={organizationsState.reload}>Refresh</Button>} />{organizationsState.loading ? <LoadingState /> : organizationsState.error ? <ErrorState message={organizationsState.error} onRetry={organizationsState.reload} /> : <div className="settings-layout"><Panel className="settings-card"><p className="eyebrow">ORGANIZATIONS</p><h2>Organization access</h2><p>Organizations scope dressmaker access to customers, scans, orders, and fitting records.</p>{(organizationsState.data ?? []).length === 0 ? <DataState icon="users" title="No organizations yet" body="Create the first organization to begin inviting dressmakers." /> : <div className="organization-list">{(organizationsState.data ?? []).map((organization) => <div className="organization-row" key={organization.id}><span className="organization-icon"><Icon name="users" size={16} /></span><span><strong>{organization.name}</strong><small>{organization.id}</small></span><Badge tone="teal">Active</Badge></div>)}</div>}<form className="simple-form settings-form" onSubmit={create}><Field label="New organization name" value={name} onChange={setName} placeholder="Organization name" />{notice && <div className="form-notice"><Icon name="check" size={15} /> {notice}</div>}{error && <InlineError message={error} />}<Button type="submit" disabled={busy} icon="plus">{busy ? "Creating…" : "Create organization"}</Button></form></Panel><Panel className="settings-card"><p className="eyebrow">SYSTEM CONNECTION</p><h2>Required services</h2><p>Secrets stay outside the browser. The public client uses the Supabase URL and anon key, while invitation and reconstruction functions use server-side secrets.</p><div className="provider-row"><span><Icon name="database" size={16} /> Supabase URL</span><Badge tone="success" dot>Configured</Badge></div><div className="provider-row"><span><Icon name="lock" size={16} /> Auth persistence</span><Badge tone="success" dot>Enabled</Badge></div><div className="provider-row"><span><Icon name="scan" size={16} /> Reconstruction</span><Badge tone="warning" dot>Server-side status</Badge></div></Panel></div>}</div>;
}
