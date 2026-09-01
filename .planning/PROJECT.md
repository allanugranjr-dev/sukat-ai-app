# SukatAI

## What This Is

SukatAI is an existing role-based body-measurement application for customers, tailors/dressmakers, and administrators. A customer provides front and side body views plus a real height reference. The system validates the views, produces calibrated body measurements and an interactive 3D body model, and makes the results available for tailor review and downstream order workflows.

This is a brownfield completion and migration effort. The repository already contains the React/Vite application, local Node/MariaDB and XAMPP adapters, Supabase Auth/Postgres/Storage/Edge Functions, a CPU-first Python reconstruction service, and a Three.js model viewer. The work must improve the active scanner without rebuilding the product or discarding working features.

## Core Value

Customers and tailors receive a useful, clearly qualified set of body measurements from a small number of private photos, with a 3D model whose visual guides correspond to the measurements actually produced by the provider.

## Users

- **Customers:** Sign in, capture or upload private front/side views, provide height, follow validation guidance, monitor processing, and review measurements and the interactive model.
- **Tailors/dressmakers:** Review customer scans and measurements, use them for fitting/order work, and receive the existing invitation/access workflow.
- **Administrators:** Manage users, roles, invitations, and operational records through the existing dashboard and backend permissions.

## Constraints

- Preserve existing UI/UX, routes, authentication, Supabase configuration, database data, storage privacy, role boundaries, dashboards, orders, invitations, uploads, and working APIs.
- Use migrations for schema changes; never reset Supabase or recreate the entire database.
- Keep Node/MariaDB and XAMPP compatibility while maintaining the hosted Supabase path.
- Optimize for the Lenovo ThinkPad L380 (Intel i5-8250U, 16 GB RAM, integrated graphics) on Windows 11 Pro. CPU-first operation is required; CUDA and large reconstruction models must not be required.
- Use at most four active specialist agents. Agents must have disjoint ownership and must not rewrite unrelated code.
- Keep body images and generated models private and authorized through the existing storage boundaries.
- Do not publish a customer-facing accuracy percentage without independent, consented tape-measurement ground truth. Provider quality and fitting error are not accuracy.

## Current System Context

### Validated capabilities

- ✓ React 19/Vite single-page application with customer, tailor/dressmaker, and administrator workflows — existing
- ✓ Supabase authentication, Postgres schema/RLS, private Storage, and Edge Functions — existing
- ✓ Local Node/Express + MariaDB runtime with Socket.IO and private local assets — existing
- ✓ Optional PHP/MySQL XAMPP runtime — existing
- ✓ Front/side scan upload and height capture workflow with processing lifecycle states — existing
- ✓ FastAPI/Python CPU-first validation, silhouette reconstruction, calibration, measurements, and GLB export — existing
- ✓ Three.js interactive model viewer with measurement selection and guide rendering — existing
- ✓ Vitest and pytest test suites plus TypeScript and production build scripts — existing

### Active requirements

- [ ] The active scan path validates front/side images before expensive reconstruction and explains actionable pose or image-quality problems.
- [ ] Measurements are calibrated to the user's supplied height and are persisted with provider/version/provenance metadata.
- [ ] The provider and all backend adapters preserve nullable confidence honestly; the UI must not invent an accuracy or confidence percentage.
- [ ] The system exposes process/input quality separately from independently measured accuracy and clearly labels estimates that lack ground truth.
- [ ] The interactive 3D model uses the provider's measurement method and levels/contours so chest, waist, hip, and other guides align with the values shown to the user.
- [ ] Processing is durable enough to report queued, running, ready, and failed states with safe retry behavior and without losing prior durable results unnecessarily.
- [ ] Node, Supabase, and retained XAMPP paths stay contract-compatible for authentication, authorization, scans, assets, measurements, invitations, and orders.
- [ ] The implementation remains practical on the target CPU and documents resource expectations, provider configuration, and local startup.
- [ ] Automated tests cover measurement normalization, guide geometry, persistence, failure/retry behavior, backend boundaries, and the accuracy-validation limitation.
- [ ] The release can be verified with reproducible typecheck, unit tests, Python tests, and production builds without requiring GPU-only dependencies.

### Out of scope

- Rebuilding SukatAI from scratch or replacing the existing product UI with an unrelated redesign.
- Resetting Supabase, deleting existing data/tables, or removing working customer, tailor, administrator, order, invitation, or storage functionality.
- Claiming “100% accurate,” a fabricated percentage, or a provider confidence score without a documented reference dataset and evaluation protocol.
- Requiring CUDA, a GPU, large heavy reconstruction models, or a cloud-only runtime for local operation.
- Making private body images or model assets publicly accessible to simplify rendering.
- Replacing the existing backend abstraction with a single incompatible backend or adding unrelated features.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Treat the repository as brownfield and migrate in place | Existing authentication, data, UI, and backend modes are valuable and must be preserved | Accepted |
| Use front + side views + real user height as the active CPU-first scan contract | This is the governing migration brief and fits the target laptop | Accepted |
| Keep Supabase as the hosted production path and Node/MariaDB/XAMPP as retained local paths | Users already depend on these runtimes and data boundaries | Accepted |
| Keep confidence null and avoid an accuracy percentage until independent tape references exist | Image-derived fitting loss and process quality cannot prove real-world accuracy | Accepted |
| Align 3D guides to provider-generated contours/levels rather than arbitrary ellipses | The current hip mismatch shows that display geometry and provider measurement methods can diverge | Pending implementation |
| Use no more than four parallel specialist agents with disjoint ownership | Protect limited Codex usage and reduce merge conflicts | Accepted |
| Prefer vertical end-to-end slices for implementation planning | Each phase should produce a testable customer-visible capability | Accepted |

## Risks and Open Questions

- The existing provider measures fitted meshes with CLAD contours while the browser can measure raw rendered mesh loops; an explicit shared contour/landmark contract is needed.
- Existing saved scans may contain older guide metadata and require safe reprocessing or backward-compatible rendering.
- The AI service keeps some result state in process memory, so restart recovery and durable job state need careful treatment without destabilizing the current local path.
- Three backend implementations can drift unless shared contract tests or equivalent acceptance checks are added.
- A true accuracy metric requires a consented reference-measurement dataset, a fixed measurement protocol, and a documented evaluation method; this project does not currently contain that dataset.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. “What This Is” still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Review all sections
2. Recheck the Core Value
3. Audit Out of Scope reasons
4. Update current users, feedback, metrics, and operational state

---
*Last updated: 2026-09-02 after initialization*
