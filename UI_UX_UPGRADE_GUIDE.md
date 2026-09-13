# UI/UX Design System — Integration Guide

## What This Is

`public/design-system.css` is a standalone, additive design-token and component
library for MEP-Management. It does **not** modify `index.html`, `server.ts`,
or any existing JavaScript logic. It introduces:

- A full color/typography/spacing/radius/shadow token system (light + optional dark mode)
- Reusable component classes: buttons, badges, cards, panels, tables, forms,
  modals, empty states, Kanban board, notification dropdown
- Mobile-first responsive breakpoints (900px, 640px) — addresses the current
  gap where only one breakpoint exists in the live app
- Accessibility baseline: focus-visible rings, prefers-reduced-motion support,
  a `.ds-visually-hidden` utility for screen-reader-only text

## Why It's Delivered Separately (Not Merged Directly)

Editing the existing single-file `index.html` blind — without a way to
render or screenshot the result — carries real risk. Prior work on this repo
already hit this exact problem: earlier UI passes shipped a `.user-chip`
flex bug and a misplaced dropdown that were only caught once a
screenshot-based QA pass was introduced. This file is intentionally additive
so it can be integrated incrementally and verified visually at each step,
rather than risking a large blind rewrite of the live frontend.

## Recommended Integration Steps

1. **Add the stylesheet link** in `index.html`'s `<head>`, after the existing
   inline `<style>` block, so its rules can override conflicting legacy
   styles during migration:
   ```html
   <link rel="stylesheet" href="/design-system.css">
   ```

2. **Migrate one view at a time**, starting with the highest-traffic screens:
   - Dashboard/portfolio cards -> `.ds-card-grid` + `.ds-card`
   - Any CRUD table (RFIs, submittals, punch list) -> `.ds-table-wrap` + `.ds-table`
   - Empty states -> replace ad hoc empty-state markup with `.ds-empty` +
     `.ds-empty-icon` + `.ds-empty-title`
   - Buttons -> `.ds-btn .ds-btn-primary` / `.ds-btn-secondary` / `.ds-btn-danger`
   - Role badges -> `.ds-role-badge .ds-role-{admin|pm|engineer|commercial|qaqc|safety|sub|consultant}`
   - Status badges -> `.ds-badge .ds-badge-{success|warning|danger|info|neutral}`
   - Planner Kanban -> `.ds-kanban` / `.ds-kanban-column` / `.ds-kanban-card`
   - Notification bell -> `.ds-notif-bell` / `.ds-notif-badge` / `.ds-notif-dropdown`

3. **Verify visually after each view migration** — ideally with a
   screenshot-capable tool/session, comparing before/after at both desktop
   and the 900px/640px mobile breakpoints, before moving to the next view.
   Do not migrate all views in a single pass.

4. **Once all views are migrated**, the legacy inline `<style>` rules that
   are now fully superseded can be safely removed from `index.html`, and the
   `@media(max-width:980px)` single breakpoint can be retired in favor of the
   new 900px/640px system.

5. **Dark mode (optional)**: toggling `data-theme="dark"` on the `<html>`
   element activates the dark palette with zero additional CSS changes,
   since every component consumes the semantic color tokens rather than
   hardcoded hex values.

## Design Rationale

- **Token-driven, not hardcoded**: every color, spacing, radius, and shadow
  value is a CSS custom property, matching the architecture that keeps
  monday.com and Odoo visually consistent across dozens of views. Changing
  `--color-brand` or `--space-4` in one place recolors/rescales the entire
  app.
- **Mobile-first breakpoints**: site engineers and foremen are the primary
  daily users of RFIs, punch lists, and daily logs — the 900px/640px
  breakpoints specifically target tablet and phone usage on-site, not just
  desktop office use.
- **Accessibility by default**: focus rings, reduced-motion support, and a
  visually-hidden utility class are built in rather than retrofitted later.
- **Role badge system**: each of the 8 roles (Admin, ProjectManager,
  SiteEngineer, CommercialManager, QAQC, SafetyOfficer, Subcontractor,
  Consultant) gets a distinct, consistent color via `--color-role-*` tokens,
  replacing any remaining ad hoc badge styling.

## What Still Requires Visual QA Before Production Use

This file has not been rendered or screenshotted — it is syntactically
valid CSS following a coherent design-token architecture, but the actual
visual integration into the existing `index.html` structure needs to be
verified against real rendered output (ideally via the screenshot pipeline
already used elsewhere in this repo's commit history) before merging to
`main`.
