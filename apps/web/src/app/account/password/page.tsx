import { getAccess } from "@/lib/access";
import { PublicFrame } from "@/components/shell";
import { ActionForm } from "@/components/action-form";
import { updatePassword } from "@/app/actions";
export const metadata = { title: "Новый пароль" };
export default async function Page() {
  await getAccess();
  return (
    <PublicFrame
      title={"Сохраните доступ\nк вашему пути"}
      subtitle="После изменения пароля потребуется снова войти в аккаунт."
    >
      <h2>Новый пароль</h2>
      <ActionForm action={updatePassword} label="Сохранить пароль">
        <label>
          Новый пароль
          <input
            type="password"
            name="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Повторите пароль
          <input
            type="password"
            name="confirmation"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </label>
      </ActionForm>
    </PublicFrame>
  );
}
