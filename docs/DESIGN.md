---
name: XD Guild Command Center
description: Reference-derived visual system for the Russian-language XD guild interface.
colors:
  background: "#0a080c"
  panel: "#150f16"
  sidebar: "#0e0b0f"
  line: "#2d1d28"
  text: "#ffffff"
  muted: "#ada0ab"
  accent: "#ff9e2c"
  accent-soft: "rgba(255, 158, 44, 0.1)"
  field: "#0e0b10"
  light-background: "#f4f1ee"
  light-panel: "#ffffff"
  light-sidebar: "#faf7f3"
  light-line: "#e6e0e7"
  light-text: "#211b2b"
  light-muted: "#746575"
  light-accent: "#9c651c"
  light-accent-soft: "rgba(201, 138, 46, 0.1)"
typography:
  headline:
    fontFamily: "Unbounded, Geist, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "Unbounded, Geist, sans-serif"
    fontSize: "17px"
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "1.5px"
  money:
    fontFamily: "Geist Mono, monospace"
    fontSize: "13px"
    fontWeight: 600
rounded:
  badge: "6px"
  control: "8px"
  row: "10px"
  navigation: "12px"
  panel: "16px"
spacing:
  compact: "12px"
  mobile-panel: "16px"
  panel: "20px"
  page: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.background}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "20px"
  input:
    backgroundColor: "{colors.field}"
    rounded: "{rounded.control}"
  navigation-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.navigation}"
    padding: "10px 14px"
---

# Design System: XD Guild Command Center

## Overview

The current system transfers the owner-approved visual reference at http://xd.200.165.236.194.sslip.io across the existing application. The pinned reference is the visual authority; source CSS defines implemented values. This is a compact working interface with warm dark surfaces, orange accents, grouped navigation and quiet borders, with a corresponding light theme.

**Key Characteristics:**
- Dense, labeled working panels and tables.
- Geometric headings with neutral interface text and monospaced financial values.
- Limited existing imagery, subordinate to readable data.

The visual transfer is authorized in [the surface contract](../.impeccable/surfaces/reference-ui.md). This document records implementation, not an independently invented creative metaphor. Source order is `globals.css`, `command-fonts.css`, then `reference-ui.css`; the latter owns the shared reference overrides. The historical concept below is retained for provenance and is not current styling authority.

## Colors

### Primary

Warm orange highlights active navigation, attendance tracks, countdown times and financial amounts. In light mode the semantic accent darkens for readable text. Primary filled buttons retain the bright orange fill and dark text in both themes.

### Neutral

Warm near-black background, aubergine panels and subdued borders separate working regions in dark mode. Light mode uses pale warm backgrounds, white panels and dark plum text. The frontmatter lists actual theme values; the field uses the light sidebar value in light mode. Muted text carries supporting labels, never hidden required information. Existing red, green and blue semantic colors remain available from the global stylesheet for errors and class/status distinctions.

**The Reference Rule.** Keep the approved reference authoritative for visual decisions; do not revive archived concept tokens as current values.

## Typography

Local WOFF2 faces provide Geist, Unbounded and Geist Mono. Geist is the body and control family; Unbounded is the heading and prominent countdown family; Geist Mono carries financial amounts with tabular figures. Legacy Golos/Cormorant assets remain loaded but do not define the current shared interface.

The route title is the headline role, reducing to (23px) at the intermediate breakpoint and (18px) on mobile. Section titles reduce to (15px) on mobile. Table text is (13px); uppercase column headings are (10px) with (0.4px) tracking. Public story headings use `clamp(30px, 4vw, 48px)` and (30px) on mobile. Personal attendance values use `clamp(22px, 2.3vw, 36px)` and (24px) on mobile. Small labels support larger named values; they do not replace them.

## Layout

Desktop chrome uses a sticky (240px) full-height sidebar, a sticky header with (84px) minimum height and (24px) content gutters. At widths up to (1023px), the sidebar becomes (210px), gutters (18px). At widths up to (767px), the sidebar becomes a labeled overlay drawer, at most `min(280px, 85vw)`, with a backdrop and Escape/outside dismissal. The mobile header has (78px) minimum height; content padding is (16px 12px 28px). Panels use (20px) padding, reduced to (16px) on mobile.

Dashboard panels retain the existing customizable grid and user-saved layouts. The default ordering presents personal attendance and participation, the game rotation countdown, recent activities and Prime/Mini RB rankings. Reset remains an explicit existing layout control. Member tables retain horizontal overflow on desktop (minimum table width 1080px), with cards on mobile. Schedule and recent-activity lists scroll within bounded panels.

## Elevation & Depth

Working panels are flat: a quiet one-pixel border and contrasting surface provide depth, with no panel shadow. The mobile drawer uses a black (55%) backdrop. Existing primary-button styling retains a faint `0 4px 20px #9a333d15` shadow inherited from the base stylesheet; this is an implementation detail, not a new panel-elevation scale. Reused world imagery is attenuated to opacity (0.035); public imagery uses a scrim, with a stronger light-theme story scrim for legibility.

## Shapes

Panels use generous rounded corners; controls are tighter. Badge, control, row, navigation and panel radii are defined in the frontmatter. Table wrappers and the monogram use the navigation radius. Borders remain one pixel. Attendance tracks are (4px) high with rounded ends. The mobile menu trigger is (40px) square, while the theme toggle is at least (44px) in both dimensions.

## Components

### Buttons and fields

Shared buttons have (44px) minimum height, (13px) text and medium weight. Inputs, textareas and selects have (44px) minimum height and (14px) text; existing activity-specific rules can supply denser controls. Primary fill stays bright orange; secondary buttons use the panel and line colors. The base primary hover remains warm red with white text. Common color/background/border/shadow transitions last (0.18s). Keyboard focus uses a visible orange outline; base element-specific focus rules can retain their established pale-gold outline. Reduced-motion disables animation, transitions and smooth scrolling.

### Navigation

Grouped uppercase labels separate destinations. Links have (46px) minimum height, muted default text and a softly tinted active state with an accent border and `aria-current="page"`. Hover uses the accent tint and primary text. Mobile keeps the same labeled groups in the drawer. Theme selection is persisted with the existing local preference. Do not add simulated language selectors or invented account attributes.

### Cards, chips and data tables

Panels and mobile member cards share the panel surface and border. Role/class chips use compact outlined forms with text labels. Tables preserve clear labels, readable financial figures and source amounts. Icons are inline SVG rather than decorative text glyphs. Empty, loading and permission states must reflect existing application behavior.

### Attendance and salary

Roster attendance combines named rows, percentages, thin tracks and counts. Salary separates exact source amounts and the exact total; use Geist Mono and preserve the current payroll sources and formulas. Financial visibility remains governed by current permissions.

### Game rotation countdown

The schedule is a static weekly game rotation labeled in Moscow time (MSK). A hydrated clock refreshes every (15 seconds), with named days, times and a bounded scroll list. It does not create real scheduled events, registrations or attendance. Real activity records remain separate.

## Do's and Don'ts

### Do:
- **Do** use the approved reference and current theme tokens for shared chrome and working surfaces.
- **Do** preserve current Auth, ACL, real data, payroll formulas and saved layout behavior.
- **Do** reuse existing imagery and keep content readable in both themes and at mobile widths.
- **Do** label the static countdown as the Moscow-time game schedule.

### Don't:
- **Don't** treat historical concept palettes or typography as the current system.
- **Don't** introduce fake translations, balances, levels, roles or unavailable features.
- **Don't** present the static rotation as database events or automatic attendance.

---

# Historical archive — pre-reference concepts

The content below is preserved verbatim as project history. Its references to “current”, “approved”, future implementation or Figma describe the earlier concept stage and are superseded for the present interface by the system above.

# Визуальная концепция

Актуальное решение F-03 от 2026-10-31: F1 «Гавань под луной» выбран основным фоном ArcheAge × Japan. B0 + S1 сохранены. F2 «Святилище над облаками» оставлен как архивная альтернатива. Материалы — background-study/README.md. Кадрирование и сила затемнения уточняются на полных экранах. Перенос в Figma заблокирован лимитом MCP Starter. Старые предложения ниже сохраняются как история этапа 0.

**Предложение A — «Лунное святилище» (рекомендуется).** Фотореалистичный ночной пейзаж: тории у горного озера, луна, туман, мокрый камень и тёплые фонари. Мотив кицунэ — в геометрии эмблемы; фантазийность концентрируется в баннере и входе. Таблицы остаются строгими.

**Предложение B — «Алая печать».** Та же фотографическая основа и система рабочих компонентов; угловатые панели, более тёплый красный оттенок, тонкие линии, более плотная композиция. Ощущение самурайского штаба. Переключение в автономном макете показывает отличие.

## Знак XD

Оригинальная векторная монограмма: пересечение X и открытая геометрия D внутри контура, напоминающего уши и маску кицунэ. Ни игровых гербов, ни чужих изображений. В макете знак построен путями SVG; это эскиз для утверждения, не результат проверки товарных знаков.

Три масштаба: полный знак + XD + подпись в шапке; квадратный знак 48–96 px для входа/Telegram; упрощённая монограмма без контура для favicon 16/32 px. Минимальный отступ вокруг — четверть ширины. Золото/серебро на графите, одноцветная версия. Никаких мелких надписей внутри фавиконки. Экспорт ICO/PNG и тест читаемости 16 px — этап 1.

## Токены первоначальной концепции

Эта таблица сохраняет исходное предложение. Актуальные варианты палитры F-03 находятся в Figma и docs/FIGMA.md; окончательный выбор ещё открыт.

| Токен | Значение | Назначение |
|---|---|---|
| background | #10141D | Основа |
| surface | #181E29 | Таблицы, панели |
| surface-raised | #202735 | Выбор, поля |
| primary | #9A333D | Главное действие с белым текстом |
| gold | #C6A36A | Награды, тонкие линии, числа казны |
| text | #D8DDE6 | Основной текст |
| muted | #A5AEBD | Вторичный текст |
| teal | #304C56 | Подложки и атмосфера, не мелкий текст |
| danger-text | #FFADB4 | Ошибки на тёмном фоне |
| success-text | #9FD6BB | Подтверждённые состояния |

Красный #9A333D не применять как маленький текст на графите: контраст недостаточен. Ошибка = цвет + подпись + иконка; состояние не кодируется только цветом. Цель WCAG AA: 4.5:1 обычный текст, 3:1 крупный текст и значимые границы элементов.

Утверждённая типографика продукта (F-01 B0, F-02 S1): Cormorant Garamond SemiBold для крупных атмосферных заголовков 56/60 desktop и 36/40 mobile; Golos Text для интерфейса. Страница 28/36 desktop и 24/32 mobile, блок 20/28, текст/поля 16/24, кнопки 16/24 Medium, таблицы/пояснения 14/20; 12/18 только для второстепенных меток. Локальные WOFF2 и лицензии включить на этапе реализации; запасные шрифты — Georgia/serif для заголовков, system-ui для интерфейса. Старый HTML-макет использует системный шрифт и Georgia, поэтому не является актуальным эталоном типографики. Текущий эталон — Figma, docs/FIGMA.md. Табличные цифры — tabular-nums. Не использовать псевдояпонский шрифт для русского текста.

Сетка 4/8 px, поля 24–32 desktop / 16 mobile; радиус 8–12 px для A, 3–6 для B; тонкие рамки и сдержанные тени. Область нажатия минимум 44 px. Focus-ring золотой. Hover 120–180 ms, reduced-motion выключает анимацию. Контент остаётся читаемым без фонового изображения и без blur.

## Компоненты

Button primary/secondary/quiet/danger; Input с label, подсказкой и ошибкой; Checkbox; Badge с текстом статуса; StatCard; DataTable; MobileMemberCard; EmptyState/ErrorState/LoadingSkeleton; ConfirmDialog; FilterBar; EventCard; Chart с доступной таблицей; Pagination; Navigation desktop/mobile.

Все состояния должны быть спроектированы: idle, focus, disabled с причиной, loading, success, error, empty, permission denied. В макете показана часть состояний; библиотека и её проверка появятся на этапе 1.

## Экраны

- **Вход:** на широком экране 55% атмосферный блок, 45% форма; Telegram основной, email альтернативный только при готовой инфраструктуре. Нет ложного «письмо отправлено». Мобильный вход — короткая шапка и форма.
- **Регистрация:** после проверки входа, обязательный ник, подсказка о точном игровом имени, отдельные согласия, понятная отправка. После — экран ожидания с ником, возможностью выхода и объяснением следующего шага.
- **Главная:** атмосферный баннер и компактные статистические карточки; ниже события/личные показатели, затем графики. В первом релизе только доступные реальные сведения; будущие метрики не показываются нулями.
- **Состав:** ник и статус важнее декора; desktop-таблица с фиксируемым ником, выбором колонок и фильтрами. Mobile — карточки с раскрываемыми дополнительными полями. Финансовые данные только по правам.
- **Активности:** карточки и календарь, явно указанный часовой пояс. **Казна:** золото как тонкий акцент, крупные числа и строгие таблицы. **Администрирование:** плотный функциональный интерфейс; действие с ником, причиной и подтверждением.
- **Телефон:** 4 основных пункта + «Ещё», safe-area, кнопки доступны большим пальцем. Админ-пункты внутри «Ещё», а не отдельная перегруженная панель. В макете нижнее меню переключает только демонстрируемые экраны.

## Демонстрационные материалы

`concept/index.html` — интерактивный документ дизайна, не приложение. Примерные ники, даты и показатели не получены из гильдии. Кнопки входа только переключают макет; отправка явно показывает «Демонстрация». Никакие данные не отправляются и не сохраняются. Векторный пейзаж заменён двумя оригинальными фотореалистичными изображениями, созданными для проекта. Это сгенерированные изображения в фотографическом стиле, не снимки реальных объектов. Знак XD остаётся векторным для читаемости в малом размере. WebP-фоны встроены в HTML; внешних сетевых зависимостей нет.


## Уточнение владельца — концепция 02

Принято 2026-10-30: вместо рисованной иллюстрации использовать картинки, добавить лёгкие анимации и переходы. Направление A/B и архитектура по-прежнему на согласовании.

- Главная: фотореалистичные тории у ночного озера; вход/регистрация: каменная кицунэ на лестнице святилища. Изображения созданы через image_gen; происхождение описано в `concept/assets/README.md`.
- Фон медленно меняет масштаб 1.025 → 1.075 за 24–30 секунд и слегка смещается. Туман — прозрачные градиенты с анимацией transform/opacity без размытия; на телефонах отключён.
- Между экранами: мягкое исчезновение 140 мс и появление со смещением 10 px за 260 мс. Native View Transitions при наличии; fallback Web Animations 240 мс.
- Карточки и кнопки: короткий отклик 160–180 мс, подъём карточки до 3 px только при мыши. Табличные числа не пересчитываются декоративной анимацией.
- Кнопка «Движение: вкл/выкл» останавливает фон, туман, hover-движения и переходы. `prefers-reduced-motion` принудительно отключает движение; настройка реагирует на изменение без перезагрузки. В скрытой вкладке фоновые анимации приостановлены.
- Адаптивные WebP: главная ≈127 КБ desktop / 42 КБ mobile, вход ≈210 / 100 КБ. Изображения встроены для автономного просмотра, поэтому весь HTML весит около 1.1 МБ и содержит оба размера; это не экономия сетевого трафика на телефоне. В рабочей версии изображения будут отдельными кешируемыми файлами с загрузкой нужного размера.
- Эффекты не меняют размеры элементов, не перекрывают кнопки и не требуют видео, canvas, WebGL или дополнительных библиотек.
