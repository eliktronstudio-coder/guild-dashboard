import { Sidebar } from "@/components/navigation/sidebar";
import { NavIcon } from "@/components/navigation/nav-icon";
import { GUILD_ID, getConfig, PERIOD_CLOSING_ENABLED } from "@/lib/config";
import { canAttachEmailLogin } from "@/lib/email-login";
import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import { MemberAvatar } from "@/components/members/avatar";
import { signOut } from "@/app/actions";
import { getAccess } from "@/lib/access";
import { PlayerClassPrompt } from "@/components/members/player-class-prompt";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="XD — главная">
      <img
        className="guild-seal"
        src="/brand/xd-seal-small.webp"
        alt=""
        width={96}
        height={96}
      />
      <span className="brand-name">
        XD GUILD<span>ARCH EAGE · ХД</span>
      </span>
    </Link>
  );
}
export function PublicFrame({
  children,
  eyebrow = "XD · ARCH EAGE",
  title,
  subtitle,
}: {
  children: React.ReactNode;
  eyebrow?: string;
  title: string;
  subtitle: string;
}) {
  return (
    <main className="public-layout" id="main">
      <div className="public-story">
        <Brand />
        <div className="story-copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <div className="story-rule">Одна гильдия. Общий путь.</div>
        </div>
        <p className="caption">Гавань под луной · XD / ХД</p>
      </div>
      <section className="public-card">{children}</section>
    </main>
  );
}
export async function GuildShell({
  children,
  current,
}: {
  children: React.ReactNode;
  current: string;
}) {
  const a = await getAccess();
  const [
    canReview,
    canRead,
    canReadTreasury,
    canAttend,
    canAllocate,
    canClose,
  ] = await Promise.all([
    a.permission("applications.review"),
    a.permission("members.read"),
    a.permission("treasury.read"),
    a.permission("attendance.manage"),
    a.permission("treasury.allocate"),
    a.permission("periods.close"),
  ]);
  const claims = canAttend
    ? await a.client
        .from("participation_claims")
        .select("id", { count: "exact", head: true })
        .eq("guild_id", GUILD_ID)
        .eq("status", "pending")
    : null;
  const sections = [
    {
      label: "Обзор",
      links: [
        ["/dashboard", "Главная", "home"],
        ["/statistics", "Статистика", "chart"],
        ["/events", "Активности", "activity"],
        ...(canRead ? [["/members", "Состав", "members"]] : []),
        ...(a.membership?.status === "active"
          ? [[`/members/${a.membership.id}`, "Мой профиль", "user"]]
          : []),
      ],
    },
    {
      label: "Экономика",
      links: [
        ...(canReadTreasury ? [["/treasury", "Казна", "treasury"]] : []),
        ["/payments", "Выплаты", "payments"],
        ...(PERIOD_CLOSING_ENABLED && (canAllocate || canClose)
          ? [["/archive", "Архив и закрытие", "archive"]]
          : []),
      ],
    },
    {
      label: "Инструменты",
      links: [
        ...(canRead ? [["/rb-purchase", "Покупка РБ", "tool"]] : []),
        ["/account", "Аккаунт", "settings"],
      ],
    },
    {
      label: "Управление",
      links: [
        ...(canReview ? [["/admin", "Управление", "admin"]] : []),
        ...(canAttend
          ? [
              [
                "/admin/participation",
                `Заявки на участие (${claims?.count ?? 0})`,
                "claims",
              ],
            ]
          : []),
      ],
    },
  ];
  const selected = sections
    .flatMap((s) => s.links)
    .find(([href]) => href === current);
  const title = selected?.[1] ?? "Гильдия XD";
  const group =
    sections.find((s) => s.links.some(([href]) => href === current))?.label ??
    "Обзор";
  return (
    <div className="guild-layout">
      {a.membership?.status === "active" && !a.membership.class_selected_at && (
        <PlayerClassPrompt />
      )}
      <Sidebar>
        <Brand />
        <nav aria-label="Основная навигация">
          {sections
            .filter((section) => section.links.length)
            .map((section) => (
              <div className="nav-section" key={section.label}>
                <p className="nav-label">{section.label}</p>
                {section.links.map(([href, label, icon]) => (
                  <Link
                    key={href}
                    href={href}
                    prefetch={false}
                    aria-label={label}
                    aria-current={current === href ? "page" : undefined}
                  >
                    <NavIcon name={icon} />
                    <span className="nav-text">{label}</span>
                  </Link>
                ))}
              </div>
            ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" /> XD · ArcheAge
          <form action={signOut}>
            <button className="text-button">Выйти</button>
          </form>
        </div>
      </Sidebar>
      <div className="guild-content">
        <header className="topbar">
          <div className="route-heading">
            <span>{title}</span>
            <small>
              {group} / {title}
            </small>
          </div>
          <img
            className="topbar-seal"
            src="/brand/xd-seal-small.webp"
            alt=""
            width={32}
            height={32}
          />
          <ThemeToggle />
          <Link
            href="/account"
            className="user-chip"
            aria-label="Открыть аккаунт"
          >
            <MemberAvatar
              nickname={a.membership?.nickname ?? "XD"}
              style={a.membership?.avatar_style}
            />
            <span className="user-chip-name">
              {a.membership?.nickname ?? "Новый игрок"}
            </span>
          </Link>
        </header>
        <main id="main" className="page-content">
          {current !== "/account" &&
            getConfig().email &&
            canAttachEmailLogin(a.user) && (
              <p className="notice">
                Сохраните доступ без Telegram:{" "}
                <Link href="/account/email">подключите email и пароль</Link> к
                текущему аккаунту. Данные сохранятся.
              </p>
            )}
          {children}
        </main>
        <footer className="page-footer">
          XD GUILD COMMAND CENTER <span>XD · Состав и персонажи</span>
        </footer>
      </div>
    </div>
  );
}
