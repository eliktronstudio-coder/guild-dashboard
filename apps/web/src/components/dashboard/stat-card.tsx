import Link from "next/link";
export function StatCard({
  title,
  value,
  note,
  href,
  art,
}: {
  title: string;
  value: string | number;
  note: React.ReactNode;
  href?: string;
  art?: string;
}) {
  const content = (
    <>
      <p>{title}</p>
      <strong>{value}</strong>
      <span className="caption">{note}</span>
    </>
  );
  return (
    <article
      className={"panel stat command-stat" + (art ? " has-art" : "")}
      style={
        art
          ? {
              backgroundImage: `linear-gradient(90deg,var(--card-scrim),var(--card-scrim)),url(${art})`,
            }
          : undefined
      }
    >
      {href ? <Link href={href}>{content}</Link> : content}
    </article>
  );
}
