import Link from "next/link";
export default function Page() {
  return (
    <main id="main" className="legal panel">
      <h1>Страница не найдена</h1>
      <Link href="/dashboard" className="button primary">
        В командный центр
      </Link>
    </main>
  );
}
