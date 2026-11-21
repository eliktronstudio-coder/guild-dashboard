import { ActionForm } from "@/components/action-form";
import { saveCharacter, archiveCharacter } from "@/app/members/actions";
import type { Character } from "@/lib/members";
export function CharacterEditor({
  memberId,
  characterId,
  character,
}: {
  memberId: string;
  characterId: string;
  character?: Character;
}) {
  return (
    <ActionForm
      action={saveCharacter}
      revision={character?.version ?? 0}
      label={character ? "Сохранить персонажа" : "Добавить персонажа"}
    >
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="characterId" value={characterId} />
      <input type="hidden" name="version" value={character?.version ?? 0} />
      <div className="field-grid">
        <label>
          Имя персонажа
          <input
            name="name"
            defaultValue={character?.name}
            minLength={2}
            maxLength={32}
            required
            autoComplete="off"
          />
        </label>
        <label>
          Игровой сервер
          <input
            name="server"
            defaultValue={character?.game_server}
            maxLength={60}
            placeholder="Название вашего сервера"
          />
        </label>
        <label>
          Класс
          <input
            name="characterClass"
            defaultValue={character?.character_class}
            maxLength={80}
            placeholder="Название класса в вашей версии игры"
          />
        </label>
        <label>
          Специализация
          <input
            name="specialization"
            defaultValue={character?.specialization}
            maxLength={120}
            placeholder="Ветки талантов или роль"
          />
        </label>
      </div>
      {character?.is_main ? (
        <>
          <input type="hidden" name="main" value="on" />
          <p className="caption">
            Это основной персонаж. Чтобы сменить его, выберите другого основным.
          </p>
        </>
      ) : (
        <label className="check">
          <input type="checkbox" name="main" />
          <span>Сделать основным персонажем</span>
        </label>
      )}
      <p className="caption">
        Первый персонаж становится основным автоматически. Его класс и сервер
        видны в составе.
      </p>
    </ActionForm>
  );
}
export function CharacterArchiveForm({
  memberId,
  character,
}: {
  memberId: string;
  character: Character;
}) {
  return (
    <ActionForm
      action={archiveCharacter}
      revision={character.version}
      label="Перенести в архив"
    >
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="characterId" value={character.id} />
      <input type="hidden" name="version" value={character.version} />
      <label>
        Причина
        <textarea
          name="reason"
          required
          minLength={3}
          maxLength={500}
          rows={2}
        />
      </label>
      <label className="check">
        <input type="checkbox" name="confirm" required />
        <span>
          Перенести {character.name} в архив. Если это основной персонаж,
          основным станет первый из оставшихся.
        </span>
      </label>
    </ActionForm>
  );
}
