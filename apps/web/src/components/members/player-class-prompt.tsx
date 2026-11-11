"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { savePlayerClass } from "@/app/actions";
import { PLAYER_CLASSES } from "@/lib/player-class";

export function PlayerClassPrompt() {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [state, action, pending] = useActionState(savePlayerClass, {});
  useEffect(() => {
    if (state.success) {
      dialog.current?.close();
      router.refresh();
    } else if (!dialog.current?.open) dialog.current?.showModal();
  }, [state.success, router]);
  if (state.success) return null;
  return (
    <dialog
      ref={dialog}
      className="player-class-dialog"
      aria-labelledby="player-class-title"
      aria-describedby="player-class-help"
      onCancel={(e) => e.preventDefault()}
    >
      <p className="eyebrow">ВАШ ИГРОВОЙ ПРОФИЛЬ</p>
      <h2 id="player-class-title">Выберите свой класс</h2>
      <p id="player-class-help" className="muted">
        Укажите, кем вы играете в ArcheAge. Этот выбор сохранится в аккаунте, и
        мы больше не будем спрашивать его при входе.
      </p>
      <form
        action={action}
        className="form-stack"
        onReset={(e) => e.preventDefault()}
      >
        <fieldset disabled={pending}>
          <legend className="caption">Класс игрока · обязательный выбор</legend>
          <div className="player-class-options">
            {PLAYER_CLASSES.map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="playerClass"
                  value={value}
                  required
                  checked={selected === value}
                  onChange={() => setSelected(value)}
                />
                <span>{value}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {state.error && (
          <p className="notice error" role="alert">
            {state.error}
          </p>
        )}
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? "Сохраняем…" : "Сохранить класс"}
          <span aria-hidden="true">↗</span>
        </button>
      </form>
    </dialog>
  );
}
