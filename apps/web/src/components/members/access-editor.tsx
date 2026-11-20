import { ActionForm } from "@/components/action-form";
import { manageMember } from "@/app/actions";
import { ROLE_OPTIONS } from "@/lib/members";
export function AccessEditor({
  memberId,
  blocked,
  currentRole,
  canAssign,
}: {
  memberId: string;
  blocked: boolean;
  currentRole: string;
  canAssign: boolean;
}) {
  return (
    <details className="panel section-panel">
      <summary>Управление доступом</summary>
      <div className="editor-grid">
        <ActionForm
          action={manageMember}
          label={blocked ? "Снять блокировку" : "Заблокировать"}
        >
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="action" value="block" />
          <input type="hidden" name="blocked" value={String(!blocked)} />
          <p className="muted">
            Блокировка немедленно закрывает доступ и отзывает сессии.
          </p>
          <label className="check">
            <input name="confirm" type="checkbox" required />
            <span>Подтверждаю изменение доступа</span>
          </label>
        </ActionForm>
        {canAssign && (
          <ActionForm action={manageMember} label="Назначить роль">
            <input type="hidden" name="memberId" value={memberId} />
            <input type="hidden" name="action" value="role" />
            <label>
              Роль
              <select name="role" defaultValue={currentRole}>
                {ROLE_OPTIONS.filter(([v]) => v !== "owner").map(
                  ([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="check">
              <input name="confirm" type="checkbox" required />
              <span>Подтверждаю назначение</span>
            </label>
          </ActionForm>
        )}
      </div>
    </details>
  );
}
