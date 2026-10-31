# XD Web — основа платформы

Next.js App Router, TypeScript, Tailwind 4, Supabase SSR/Auth/PostgreSQL. Существующий Express в корне репозитория запускается отдельно и не изменён.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Без подключения Supabase страницы входа и подготовки доступны, операции регистрации отключены. Закрытые страницы направляют на подготовку. Здесь нет демонстрационной авторизации или выдуманной статистики.

`npm run check` проверяет TypeScript, выполняет тесты PostgreSQL/RLS в PGlite и production-сборку. PGlite проверяет настоящие SQL-функции и политики; auth.users/auth.sessions и claims в тесте — локальные fixtures, не действующая Supabase Auth.

[Подключение с телефона](../../docs/SETUP.md) · [Результаты и ограничения](../../docs/STAGE1.md)

В Vercel Root Directory — `apps/web`, Node 24, build — `npm run build`. Проект создаётся отдельно от старого сайта. Миграция предназначена для нового Supabase-проекта. Service-role ключ веб-приложению не нужен.
