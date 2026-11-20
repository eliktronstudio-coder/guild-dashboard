"use client";
import { useRef, useState } from "react";
export function CatalogPhotoInput({ banner = false }: { banner?: boolean }) {
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
            canvas.width = banner ? 480 : 100;
            canvas.height = banner ? 180 : 100;
            const context = canvas.getContext("2d");
            if (!context) throw new Error();
            const ratio = canvas.width / canvas.height;
            const cropWidth = Math.min(bitmap.width, bitmap.height * ratio);
            const cropHeight = cropWidth / ratio;
            context.drawImage(
              bitmap,
              (bitmap.width - cropWidth) / 2,
              (bitmap.height - cropHeight) / 2,
              cropWidth,
              cropHeight,
              0,
              0,
              canvas.width,
              canvas.height,
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
          width={banner ? 160 : 50}
          height={banner ? 60 : 50}
          className={banner ? "activity-banner-preview" : "catalog-photo"}
        />
      )}
    </>
  );
}
