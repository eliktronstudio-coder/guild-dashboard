"use client";
import { useRef, useState } from "react";
export function CatalogPhotoInput() {
  const generation = useRef(0);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={async (event) => {
          const current = ++generation.current;
          const file = event.target.files?.[0];
          setError("");
          if (!file) {
            setValue("");
            return;
          }
          if (file.size > 10 * 1024 * 1024) {
            setValue("invalid");
            setError("Выберите фото до 10 МБ.");
            return;
          }
          setValue("processing");
          try {
            const bitmap = await createImageBitmap(file);
            const canvas = document.createElement("canvas");
            canvas.width = 100;
            canvas.height = 100;
            const context = canvas.getContext("2d");
            if (!context) throw new Error();
            const side = Math.min(bitmap.width, bitmap.height);
            context.drawImage(
              bitmap,
              (bitmap.width - side) / 2,
              (bitmap.height - side) / 2,
              side,
              side,
              0,
              0,
              100,
              100,
            );
            bitmap.close();
            if (current === generation.current)
              setValue(canvas.toDataURL("image/png"));
          } catch {
            if (current !== generation.current) return;
            setValue("invalid");
            setError("Не удалось открыть фото. Выберите PNG, JPEG или WebP.");
          }
        }}
      />
      <input type="hidden" name="photoData" value={value} />
      {value === "processing" && (
        <span role="status">Подготавливаем фото…</span>
      )}
      {error && <span role="alert">{error}</span>}
      {value.startsWith("data:") && (
        <img
          src={value}
          alt="Предпросмотр фото"
          width={50}
          height={50}
          className="catalog-photo"
        />
      )}
    </>
  );
}
