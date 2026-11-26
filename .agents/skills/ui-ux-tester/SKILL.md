---
name: ui-ux-tester
description: >-
  Specialized UI/UX testing, visual overlap detection, and responsive design audit agent
  for ltfrb-franchise-monitor. Use this skill to audit mobile (375px), tablet (768px), and
  desktop (1024px+) layouts, detect overlapping elements, z-index conflicts, horizontal
  scroll bugs (overflow-x), unconstrained flex/grid containers, senior-adult touch targets,
  and verify no gradients or decorative borders are used.
---

# UI/UX Testing & Responsiveness Agent

This skill provides a methodical framework for auditing, detecting, and fixing UI/UX issues, visual overlaps, responsiveness defects, and senior-accessibility regressions in `ltfrb-franchise-monitor`.

## Core Responsibilities

1. **Visual Overlap Detection**: Catch collisions between fixed/sticky elements (e.g., mobile bottom bar, sticky status bar, action bars) and modal backdrops, dialogs, or page content.
2. **Viewport Responsiveness**: Ensure pages adapt cleanly across mobile (`360px–414px`), tablet (`768px–820px`), and desktop (`1024px+`) without squishing text or buttons.
3. **Z-Index Layering Integrity**: Enforce a strict z-index hierarchy across sticky headers, navigation bars, drawers, modals, and global dialogs.
4. **Horizontal Overflow Prevention**: Eliminate `scrollWidth > clientWidth` defects that cause horizontal wobbling on mobile browsers.
5. **Senior-Adult Touch & Readability Clearance**:
   - Verify minimum `48×48px` (`min-h-12`) interactive targets (exceeding the `44×44px` mobile baseline) with `16px+` spacing between neighboring actions.
   - Ensure modal headers have right clearance (`pr-12`) so titles never collide with close buttons.
   - Enforce project rules from [ltfrb-franchise-monitor](../ltfrb-franchise-monitor/SKILL.md): no gradients (`bg-gradient-*`), no decorative borders (`border`), and no tiny text (`text-xs` / `text-sm`).

---

## Standard Z-Index Hierarchy

| Layer Name | Z-Index Class | Used By |
| :--- | :--- | :--- |
| **Base Content** | `z-0` to `z-10` | Cards, slot tables, forms, relative containers |
| **Sticky In-Page Bars** | `z-20` | Sticky filter rails, last-checked status bar |
| **Desktop Nav / Sidebar** | `z-30` | Top navigation or desktop sidebar |
| **Mobile Bottom Nav / Bar** | `z-40` | Fixed mobile navigation or sticky primary action bar |
| **Floating Action Triggers** | `z-40` | Any floating helper button (must offset `bottom-24` on mobile if bottom nav exists) |
| **Modals & Drawers** | `z-[60]` / `z-[70]` | Confirmation dialogs, application review drawers |
| **Global Alerts & Toasts** | `z-[9999]` | Critical confirmation dialogs, global status notifications |

---

## Viewport Audit Matrix

Verify every new or modified page against these viewport tiers:

- **Mobile Small (`360px - 375px`)**:
  - No horizontal scrolling on the root viewport (`overflow-x-hidden`).
  - Grids must collapse to `grid-cols-1` on mobile (never `grid-cols-2`/`3`/`4` without `sm:` / `md:` prefixes when cards hold `18px+` text).
  - Fixed bottom triggers must clear any bottom navigation bar (`bottom-24 sm:bottom-6`).
  - Modal headers must include `pr-12` to clear close buttons (`top-6 right-6`).
- **Mobile Standard (`390px - 414px`)**:
  - Slot counts (`15 Slots Left`), region names, and buttons fit without wrapping numbers awkwardly across lines.
  - Filter controls stack vertically or wrap cleanly (`flex-wrap gap-3`) instead of squeezing side-by-side.
- **Tablet (`768px - 820px`)**:
  - Smooth transition from mobile layout to tablet/desktop navigation (`md:` breakpoint).
  - Spacious 2-column layouts max; buttons stay full-width or comfortably padded (`min-h-12`).
- **Desktop (`1024px+`)**:
  - Content stays constrained (`max-w-3xl` to `max-w-4xl`) with generous whitespace so senior users do not lose their place scanning across wide screens.

---

## Automated Audit Command

Run the static UI/UX scanner from the project root anytime after `src/` exists:

```bash
npx tsx .agents/skills/ui-ux-tester/scripts/audit_ui.ts
```

Or using the project script:

```bash
npm run test:ui
```

The TypeScript script ([audit_ui.ts](./scripts/audit_ui.ts)) scans `src/` for:
- Disallowed `.js` / `.jsx` / `.mjs` / `.cjs` files (strict TypeScript only).
- Fixed elements at `bottom-6` without `sm:`/`md:` mobile clearance.
- Modal/dialog headers missing right padding (`pr-10` / `pr-12`).
- Hardcoded multi-column grids (`grid-cols-2`/`3`/`4`) missing responsive breakpoints.
- Fixed pixel widths (`w-[...]`) that risk mobile overflow.
- Disallowed `bg-gradient-*` gradients, decorative `border` classes, and tiny `text-xs` / `text-sm` typography.

---

## Manual Verification Checklist

Before finishing any UI component or page:

1. [ ] **Mobile Clearance**: Does any fixed element sit at `bottom-6` without `sm:bottom-6`?
2. [ ] **Modal Close Button**: Does every modal header have `pr-12` clearance and a clear text **"Close"** button or large labeled close target?
3. [ ] **Safe Area Insets**: Does any fixed mobile bottom bar include `pb-[max(0.75rem,env(safe-area-inset-bottom))]`?
4. [ ] **Flex Wrapping & Truncation**: Do flex parents allow clean wrapping (`flex-wrap`) or set `min-w-0` where needed so long province/franchise names do not push buttons off-screen?
5. [ ] **Scroll Containment**: Do inner scrollable containers use `overscroll-contain`?
6. [ ] **Table / Card Mobile Adaptation**: Are slot tables adapted into spacious stacked cards on mobile (`md:hidden`) or safely wrapped without squishing text below `16px`?
7. [ ] **Senior-Friendly Visual Rules**: Zero gradients, zero decorative borders, `18px+` body text, `48px+` touch targets, and plain self-explanatory labels.
