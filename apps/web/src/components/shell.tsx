import Link from "next/link";
import { MemberAvatar } from "@/components/members/avatar";
import { signOut } from "@/app/actions";
import { getAccess } from "@/lib/access";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="XD — главная">
      <span className="monogram">
        XD<span>✦</span>
      </span>
      <span>
        GUILD COMMAND<span>ARCH EAGE · ХД</span>
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
          <div className="story-rule">
            <span>月</span> Одна гильдия. Общий путь.
          </div>
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
  const [canReview, canRead] = await Promise.all([
    a.permission("applications.review"),
    a.permission("members.read"),
  ]);
  const links = [
    ["/dashboard", "Обзор", "◈"],
    ["/events", "Активности", "◷"],
    ...(canRead ? [["/members", "Состав", "◎"]] : []),
    ...(canReview ? [["/admin", "Управление", "◇"]] : []),
    ["/account", "Аккаунт", "○"],
  ];
  return (
    <div className="guild-layout">
      <aside className="sidebar">
        <Brand />
        <p className="eyebrow nav-label">КОМАНДНЫЙ ЦЕНТР</p>
        <nav aria-label="Основная навигация">
          {links.map(([href, label, icon]) => (
            <Link
              key={href}
              href={href}
              aria-current={current === href ? "page" : undefined}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" /> XD · ArcheAge
          <form action={signOut}>
            <button className="text-button">Выйти</button>
          </form>
        </div>
      </aside>
      <div className="guild-content">
        <header className="topbar">
          <span>
            Гильдия <strong>XD</strong>
          </span>
          <Link href="/account" className="user-chip">
            <MemberAvatar
              nickname={a.membership?.nickname ?? "XD"}
              style={a.membership?.avatar_style}
            />
            {a.membership?.nickname ?? "Новый игрок"}
          </Link>
        </header>
        <main id="main" className="page-content">
          {children}
        </main>
        <footer className="page-footer">
          XD GUILD COMMAND CENTER <span>XD · Состав и персонажи</span>
        </footer>
      </div>
    </div>
  );
}
