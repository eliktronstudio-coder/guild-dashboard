// Isolated review fixture only. Never exposed as an application route or auth bypass.
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberDirectory } from "../src/components/members/directory";
import type { DirectoryMember } from "../src/lib/members";
async function main() {
  const members: DirectoryMember[] = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      nickname: "Лунная Лиса",
      joined_at: "2026-10-31T00:00:00Z",
      status: "active",
      avatar_style: "teal",
      main_character: "Лиса",
      character_class: "Целитель",
      specialization: null,
      game_server: "Ария",
      role_codes: ["member"],
      role_names: ["Участник"],
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      nickname: "Оченьдлинноеимяперсонажатестовое",
      joined_at: "2026-10-30T00:00:00Z",
      status: "active",
      avatar_style: "crimson",
      main_character: null,
      character_class: null,
      specialization: null,
      game_server: null,
      role_codes: ["officer"],
      role_names: ["Офицер"],
    },
  ];
  const css = (await readdir(".next/static/chunks")).filter((n) =>
    n.endsWith(".css"),
  );
  const html = renderToStaticMarkup(
    <html lang="ru">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {css.map((n) => (
          <link key={n} rel="stylesheet" href={`/_next/static/chunks/${n}`} />
        ))}
        <style>
          {
            "@font-face{font-family:ReviewGolos;src:url(/fonts/golos.woff2)}body{--font-golos:ReviewGolos;--font-cormorant:Georgia}main{max-width:1100px;margin:auto;padding:20px}"
          }
        </style>
      </head>
      <body>
        <main>
          <p className="notice">
            Тест интерфейса — вымышленные участники. Это не данные гильдии и не
            страница входа.
          </p>
          <div className="page-heading">
            <h1>Состав гильдии</h1>
          </div>
          <section className="panel section-panel">
            <MemberDirectory members={members} />
          </section>
        </main>
      </body>
    </html>,
  );
  await mkdir("/tmp/xd-member-review", { recursive: true });
  await writeFile("/tmp/xd-member-review/index.html", "<!doctype html>" + html);
  console.log("Review fixture: /tmp/xd-member-review/index.html");
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
