"use client";
import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/lib/identity";
export function ActionForm({
  action,
  children,
  label,
  className = "",
  revision,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode;
  label: string;
  className?: string;
  revision?: string | number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={`form-stack ${className}`}>
      <fieldset key={revision} disabled={pending}>
        {children}
      </fieldset>
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
      <button className="button primary" disabled={pending} type="submit">
        {pending ? "Сохраняем…" : label}
        <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
