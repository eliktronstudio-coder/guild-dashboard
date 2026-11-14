"use client";
import { useState } from "react";
import { EvidenceInput } from "./evidence-input";
import { ActionForm } from "@/components/action-form";
import { submitClaim } from "@/app/events/claim-actions";
export function ClaimForm({
  eventId,
  requestId,
}: {
  eventId: string;
  requestId: string;
}) {
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ActionForm action={submitClaim} label="Отправить заявку">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="screenshot" value={busy ? "" : image} />
      <p>
        Приложите скрин активности, где виден ваш игровой ник. Администратор
        проверит состав.
      </p>
      <EvidenceInput
        kind="roster"
        onChange={(items) => setImage(items[0]?.image ?? "")}
        onBusyChange={setBusy}
      />
      <p className="caption">
        К заявке прикладывается первый выбранный скриншот.
      </p>
    </ActionForm>
  );
}
