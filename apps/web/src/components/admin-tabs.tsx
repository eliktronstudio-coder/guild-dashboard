import Link from "next/link";
export function AdminTabs({ current }: { current: string }) {
  return (
    <nav className="filter-actions admin-tabs" aria-label="Управление гильдией">
      {[
        ["/admin", "Заявки"],
        ["/admin/catalog/loot", "Список дропа"],
        ["/admin/catalog/boss", "Рейд-боссы"],
      ].map(([url, label]) => (
        <Link
          key={url}
          href={url}
          className="button secondary inline"
          aria-current={url === current ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
