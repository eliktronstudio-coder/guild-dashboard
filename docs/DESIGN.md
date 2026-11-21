---
name: XD Guild Command Center
description: Distressed silver guild seal with restrained crimson actions and realistic blood accents
colors:
  bg: "#070809"
  panel: "#111315"
  sidebar: "#090a0b"
  field: "#0b0c0d"
  line: "#323437"
  text: "#eeeae3"
  muted: "#aaa9a5"
  accent: "#c71936"
  accent-hover: "#b41430"
  accent-soft: "#c7193614"
  accent-text: "#f05c70"
  on-accent: "#fff8f4"
  gold: "#ded9cf"
  gold-soft: "#ded9cf0d"
  red: "#ed9393"
  success: "#91cba7"
  info: "#9ab5d5"
  card-scrim: "#131416f5"
  ink-on-silver: "#171819"
  light-bg: "#eeece7"
  light-panel: "#faf9f5"
  light-sidebar: "#e7e5df"
  light-field: "#f2f0eb"
  light-line: "#cbc8c0"
  light-text: "#252728"
  light-muted: "#66645f"
  light-accent: "#a8132d"
  light-accent-hover: "#900d25"
  light-accent-soft: "#a8132d0d"
  light-accent-text: "#9f102a"
  light-on-accent: "#ffffff"
  light-gold: "#373b3c"
  light-gold-soft: "#373b3c0a"
  light-red: "#a72d37"
  light-success: "#28643c"
  light-info: "#3d6087"
  light-card-scrim: "#faf9f5f5"
  light-ink-on-silver: "#faf9f5"
typography:
  display:
    fontFamily: "Cormorant Garamond, serif"
    fontSize: "clamp(34px, 3.4vw, 48px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  route-title:
    fontFamily: "Cormorant Garamond, serif"
    fontSize: "38px"
    fontWeight: 600
    lineHeight: 1.1
  body:
    fontFamily: "Golos Text, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  section:
    fontFamily: "Cormorant Garamond, serif"
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  control: "5px"
  list-row: "6px"
  notice: "8px"
  table: "9px"
  panel: "12px"
spacing:
  small: "8px"
  control-block: "12px"
  control-inline: "20px"
  section: "24px"
  page: "28px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
  navigation-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
---

# Design System: XD Guild Command Center

## Overview

**Creative North Star: the guild’s distressed silver XD seal, extended with restrained crimson.** The owner approved the third black/scarlet preview, then realistic dark-burgundy drips along the XD grin and upper divider with sparse dried corner marks. The current authority is [.impeccable/surfaces/blood-accent.md](../.impeccable/surfaces/blood-accent.md), extending the [silver baseline](../.impeccable/surfaces/silver-identity.md). This refines the existing application world and layout. The unavailable final conversation mock prevents a pixel-level comparison; no pixel-perfect approval is claimed.

The seal carries scratched silver ink and realistic raster blood material. Typography, numbers and working panels remain precise and readable. Auth, permissions, real member data, payroll calculations, saved layouts and protected actions retain their existing behavior.

## Colors

Frontmatter records the implemented dark and light primitives. `apps/web/src/app/blood-ui.css`, imported after `silver-ui.css`, owns the crimson extension. Crimson drives primary actions, selected navigation, attendance tracks and the Prime chart series; Mini remains silver. Accent text and focus use the brighter readable accent, with darker equivalents in light mode. On-accent text is pale ivory in dark mode and white in light mode.

**The Silver Money Rule.** The legacy `--gold` remains silver in dark mode and charcoal in light mode for financial and neutral roles; never redefine it as crimson or restore historical orange/gold. Red errors, green success and blue information retain semantic labels independently of brand crimson. Light surfaces remain neutral ivory/charcoal.

## Typography

Local `next/font/local` WOFF2 files `apps/web/src/app/fonts/cormorant.woff2` and `golos.woff2` expose `--font-cormorant` and `--font-golos`. Cormorant Garamond 600 serves display and route headings; Golos Text serves controls, labels, tables and numeric values. Body is 14px/1.5; dense table labels retain their existing smaller sizes. Headings use −0.02em tracking. Public story headings use clamp(48px, 5.6vw, 76px)/0.98, 47px on mobile; public card headings are 36px. All controls and body use tabular numerals. Older bundled Geist/Unbounded declarations are inherited implementation history, not the current typography authority. Do not add network font requests.

## Layout

Desktop shell uses a 240px grouped sidebar, a minimum 94px route header and 28px page gutters. At max-width 1023px the inherited sidebar is 210px, seal 90px and page gutters 22px. At max-width 767px navigation becomes the labeled expandable drawer with Escape/outside dismissal; the header is minimum 78px, route title 29px, page padding 20px 14px and section padding 18px. A 30px seal remains visible in the mobile header while the drawer is closed. The drawer brand uses a 60px seal; desktop uses 104px. Public layouts collapse with a 24px gap and a 48px mobile brand seal. The header divider is a natural-aspect raster ribbon centered at 480px desktop / 340px mobile. Reserve page-content top padding of 68px / 52px; the divider scrolls with the document and never sticks over content. Preserve existing responsive tables/cards, source controls and saved panel layouts. Salary payout wrappers lose their border/radius below 700px for the existing mobile row layout.

## Elevation & Depth

Working panels and primary buttons are flat, with quiet 1px borders and tonal separation; primary buttons and public cards have no shadow. The enlarged background seal has opacity 0.045 dark / 0.035 light; public story watermark uses 0.18 dark / 0.10 light, with its mobile dark treatment at 0.14. Keep imagery subordinate to amounts and controls. No new canvas, looping effects or expensive blur layer.

## Shapes

Controls use 5px corners, repeated schedule/list rows 6px, notices 8px, table containers 9px and panels/member/character/public cards 12px. The seal supplies the irregular circular form; dark burgundy drips and sparse dried corners use authored raster assets. Preserve their natural aspect ratios; avoid distressed text, CSS fake metal or geometric imitation blood.

## Components

Primary buttons pair `--accent` with `--on-accent`, minimum height 42px and inherited 12px 20px padding. Hover uses `--accent-hover`. Secondary controls retain panel/text colors with accent-soft hover and accent borders. Inputs use field/text tokens, 5px corners and accent focus borders. Keyboard focus retains its 2px outline and 3px offset, colored `--accent-text`. Keep existing disabled/loading/error/empty/permission behavior; never replace unavailable data with decorative zeros.

Active navigation uses accent fill/border with on-accent labels and icons. Text badges retain status labels and semantic colors. Attendance tracks are 4px with accent fill; financial totals remain high contrast. Prime charts use the accent, Mini silver; chart data and formulas are unchanged. Existing game countdown remains a Moscow-time static weekly rotation, independent of recorded activity and attendance.

Shared brand/header assets are `apps/web/public/brand/xd-seal-blood.webp` and `xd-seal-blood-small.webp`; `blood-divider.webp` and `blood-corner.webp` supply decoration. `blood-provenance.json` records source prompts and delivery. Source PNGs remain outside public in `.impeccable/assets/blood/`. Visible alpha bounds (alpha ≥ 8) remove invisible padding before quality-88 WebP encoding while preserving aspect ratio. Original monochrome silver assets remain available for baseline backgrounds. Decorative layers use `pointer-events: none`, sit behind content and have empty alternative text where the link already names XD. Light shared seals use `brightness(0.32)` rather than monochrome inversion. The one-time 0.45s ease-out seal resolve remains disabled in light mode and reduced motion; no canvas or looping decoration. WebP assets and local fonts require no paid APIs or external media requests.

## Do's and Don'ts

- **Do** apply the shared silver world and crimson extension across public, member, finance and administration surfaces in both themes.
- **Do** preserve labels, exact financial values, source actions, Auth/ACL and all later business instructions in PRODUCT.md.
- **Don't** revive the superseded orange/purple reference, historical concept palettes or fantasy banners as visual authority.
- **Don't** infer a UI composition approval from the supplied emblem or turn fixture values into production data.

Validation evidence supplied by the implementation handoff: Actions run `44161070065` passed 181 tests and production build, an 11-route browser matrix at 390px/1440px in both themes, and salary/archive fixture scripts. The later padding/aspect-only correction passed local typecheck/build and the same 11-route matrix. Screenshots are `.impeccable/review/blood/viewport-*.png`. A fresh independent finish review returned ship with no material fixes. The final conversation mock was unavailable for pixel-level comparison. All checks used isolated fixtures; no production mutations were made.
