"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <main id="main" className="legal panel">
      <h1>Не удалось загрузить страницу</h1>
      <p>Повторите попытку. Если ошибка сохраняется, сообщите администрации.</p>
      <button
        className="button primary"
        disabled={pending}
        onClick={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      >
        {pending ? "Загрузка…" : "Повторить"}
      </button>
    </main>
  );
}
