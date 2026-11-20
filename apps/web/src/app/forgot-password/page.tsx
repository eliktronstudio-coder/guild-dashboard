import Link from "next/link";
import { getConfig } from "@/lib/config";
import { PublicFrame } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { forgotPassword } from "@/app/actions";
export const metadata = { title: "Восстановление доступа" };
export default function Page() {
  const c = getConfig();
  return (
    <PublicFrame
      title={"Вернитесь\nв свою гильдию"}
      subtitle="Доступ восстанавливается только через подтверждённую почту."
    >
      <h2>Восстановить доступ</h2>
      {c.email && c.emailDelivery ? (
        <ActionForm action={forgotPassword} label="Отправить ссылку">
          <label>
            Электронная почта
            <input
              type="email"
              name="email"
              autoComplete="email"
              maxLength={254}
              required
            />
          </label>
        </ActionForm>
      ) : (
        <p className="notice">
          Восстановление через почту пока не подключено. Если вы входили через
          Telegram, используйте тот же аккаунт Telegram.
        </p>
      )}
      <Link className="text-button" href="/login">
        ← К странице входа
      </Link>
    </PublicFrame>
  );
}
