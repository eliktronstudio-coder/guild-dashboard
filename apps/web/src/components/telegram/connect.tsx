"use client";
import { useActionState } from "react";
import { beginLink, type LinkState } from "@/app/account/telegram/actions";
export function ConnectBot({ replace = false }: { replace?: boolean }) {
  const [state, action, pending] = useActionState<LinkState, FormData>(
    beginLink,
    {},
  );
  return (
    <form action={action} className="form-stack">
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="notice success" role="status">
          {state.success}
        </p>
      )}
      {state.url && (
        <a
          className="button primary inline"
          href={state.url}
          target="_blank"
          rel="noreferrer"
        >
          Открыть Telegram →
        </a>
      )}
      <button className="button secondary" disabled={pending}>
        {pending
          ? "Готовим ссылку…"
          : state.url || replace
            ? "Создать новую ссылку"
            : "Начать привязку"}
      </button>
    </form>
  );
}
