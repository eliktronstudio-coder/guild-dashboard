---
name: XD Guild Command Center
description: Distressed silver guild seal with precise working surfaces
colors:
  bg: "#090a0b"
  panel: "#131416"
  sidebar: "#0c0d0e"
  field: "#0b0c0d"
  line: "#323437"
  text: "#eeeae3"
  muted: "#aaa9a5"
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
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink-on-silver}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
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
    backgroundColor: "{colors.gold-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
---

# Design System: XD Guild Command Center

## Overview

**Creative North Star: the guild’s distressed silver XD seal.** The user-approved near-black/silver circular grin emblem anchors all application pages. This is a code-led identity, not an approved whole-page UI composition. The pinned brief is [.impeccable/surfaces/silver-identity.md](../.impeccable/surfaces/silver-identity.md); it supersedes the former orange/purple reference and earlier fantasy concepts. The unavailable context launcher was disclosed; product and design sources were read directly.

The seal carries the scratched organic ink. Typography, numbers and working panels remain precise and readable. Auth, permissions, real member data, payroll calculations, saved layouts and protected actions retain their existing behavior.

## Colors

Frontmatter records the implemented dark and light primitives from `apps/web/src/app/silver-ui.css`, imported after the base and reference styles. That final layer owns the current identity. **The legacy `--gold` name now means silver** in dark mode and charcoal in light mode; never restore its historical orange/gold value. The neutral light theme uses ivory surfaces and charcoal text. Red, green and blue remain semantic error, success and information colors; retain textual status labels.

## Typography

Local `next/font/local` WOFF2 files `apps/web/src/app/fonts/cormorant.woff2` and `golos.woff2` expose `--font-cormorant` and `--font-golos`. Cormorant Garamond 600 serves display and route headings; Golos Text serves controls, labels, tables and numeric values. Body is 14px/1.5; dense table labels retain their existing smaller sizes. Headings use −0.02em tracking. Public story headings use clamp(48px, 5.6vw, 76px)/0.98, 47px on mobile; public card headings are 36px. All controls and body use tabular numerals. Older bundled Geist/Unbounded declarations are inherited implementation history, not the current typography authority. Do not add network font requests.

## Layout

Desktop shell uses a 240px grouped sidebar, a minimum 94px route header and 28px page gutters. At max-width 1023px the inherited sidebar is 210px, seal 90px and page gutters 22px. At max-width 767px navigation becomes the labeled expandable drawer with Escape/outside dismissal; the header is minimum 78px, route title 29px, page padding 20px 14px and section padding 18px. A 30px seal remains visible in the mobile header while the drawer is closed. The drawer brand uses a 60px seal; desktop uses 104px. Public layouts collapse with a 24px gap and a 48px mobile brand seal. Preserve existing responsive tables/cards, source controls and saved panel layouts. Salary payout wrappers lose their border/radius below 700px for the existing mobile row layout.

## Elevation & Depth

Working panels and primary buttons are flat, with quiet 1px borders and tonal separation; primary buttons and public cards have no shadow. The enlarged background seal has opacity 0.045 dark / 0.035 light; public story watermark uses 0.18 dark / 0.10 light, with its mobile dark treatment at 0.14. Keep imagery subordinate to amounts and controls. No new canvas, looping effects or expensive blur layer.

## Shapes

Controls use 5px corners, repeated schedule/list rows 6px, notices 8px, table containers 9px and panels/member/character/public cards 12px. The seal supplies the irregular circular form; avoid distressed text, CSS fake metal or extra decorative grain.

## Components

Primary buttons pair `--gold` with `--ink-on-silver`, minimum height 42px and inherited 12px 20px padding. Hover mixes silver 88% with text and changes the border to text. Secondary controls retain panel/text colors and use muted borders and silver-soft hover. Inputs use field/text tokens, 5px corners and silver focus borders. All keyboard focus uses a 2px `--gold` outline with 3px offset. Keep existing disabled/loading/error/empty/permission behavior; never replace unavailable data with decorative zeros.

Active navigation uses silver-soft fill, a quiet line border, text-colored label and silver icon. Text badges retain status labels and semantic status colors. Attendance tracks are 4px, line-colored with silver fill; financial totals remain high contrast. Existing game countdown remains a Moscow-time static weekly rotation, independent of recorded activity and attendance.

Brand assets are `apps/web/public/brand/xd-seal.webp` and `xd-seal-small.webp`; `provenance.json` records the user reference and image preparation. Use the small asset for shared brand/header images with explicit dimensions; larger asset for decorative backgrounds. Decorative images have empty alt text when their link already names XD. Light mode inverts the monochrome seal. The one-time 0.45s ease-out seal resolve goes from 1px soft focus to sharp; light mode and reduced-motion disable it. Existing short control transitions respect reduced motion. WebP assets and local fonts require no paid APIs or external media requests.

## Do's and Don'ts

- **Do** apply the shared silver layer across public, member, finance and administration surfaces in both themes.
- **Do** preserve labels, exact financial values, source actions, Auth/ACL and all later business instructions in PRODUCT.md.
- **Don't** revive the superseded orange/purple reference, historical concept palettes or fantasy banners as visual authority.
- **Don't** infer a UI composition approval from the supplied emblem or turn fixture values into production data.

Validation record supplied by the implementation handoff: 181 tests passed and production build passed; isolated synthetic Auth/DB fixtures exercised 11 routes at 390px/1440px in both themes. Evidence is in `.impeccable/review/silver/`, including `viewport-*.png` captures. No production data changes were made. The original finish review identified four defects; the confirmation verdict resolved those four and marked those fixes ship. This does not claim a separate whole-surface reviewer approval.
