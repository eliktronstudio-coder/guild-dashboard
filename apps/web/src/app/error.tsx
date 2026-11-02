"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="legal panel">
      <h1>Не удалось загрузить страницу</h1>
      <p>Повторите попытку. Если ошибка сохраняется, сообщите администрации.</p>
      <button className="button primary" onClick={reset}>
        Повторить
      </button>
    </main>
  );
}
