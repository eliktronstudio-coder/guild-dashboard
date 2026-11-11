import { PLAYER_CLASSES } from "@/lib/player-class";
export function PlayerClassField() {
  return (
    <label>
      Класс игрока
      <select name="playerClass" required defaultValue="">
        <option value="" disabled>
          Выберите класс
        </option>
        {PLAYER_CLASSES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
}
