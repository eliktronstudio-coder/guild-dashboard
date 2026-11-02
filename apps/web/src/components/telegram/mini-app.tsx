"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { formatGold } from "@/lib/treasury";
import type { MiniAppData, MiniAppPeriod } from "@/lib/telegram/mini-app-types";

type Bridge = { initData: string; ready(): void; expand(): void };
type Stage =
  | "loading"
  | "outside"
  | "error"
  | "forbidden"
  | "expired"
  | "rate_limited"
  | "ready";
const errors = {
  outside: "Откройте кабинет кнопкой меню вашего бота XD в Telegram.",
  error:
    "Не удалось загрузить кабинет. Проверьте соединение и попробуйте снова.",
  forbidden:
    "Доступ не подтверждён. Привяжите этот Telegram в кабинете одобренного участника на сайте; если привязка уже есть, обратитесь к администратору.",
  expired:
    "Время доступа истекло. Закройте мини-приложение и откройте его заново из меню бота.",
  rate_limited:
    "Слишком много обновлений. Подождите минуту и попробуйте снова.",
};
export function MiniApp({
  origin,
  botName,
}: {
  origin: string;
  botName: string;
}) {
  const [period, setPeriod] = useState<MiniAppPeriod>("month");
  const [stage, setStage] = useState<Stage>("loading");
  const [data, setData] = useState<MiniAppData | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signupMessage, setSignupMessage] = useState("");
  const retry = useRef<{
    event: string;
    join: boolean;
    request: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const initData = useRef("");
  const scriptSettled = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!scriptSettled.current) setStage("error");
    }, 10000);
    const visibility = () => setVisible(!document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  function connect() {
    scriptSettled.current = true;
    const bridge = (window as unknown as { Telegram?: { WebApp?: Bridge } })
      .Telegram?.WebApp;
    if (!bridge?.initData) {
      setStage("outside");
      return;
    }
    initData.current = bridge.initData;
    try {
      bridge.ready();
      bridge.expand();
    } catch {
      /* Optional client layout methods. */
    }
    setBridgeReady(true);
  }
  useEffect(() => {
    if (!bridgeReady) return;
    setData(null);
    if (!visible) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), 12000);
    setStage("loading");
    fetch("/api/telegram/mini-app", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: initData.current, period }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setStage(
            response.status === 401
              ? "expired"
              : response.status === 403
                ? "forbidden"
                : response.status === 429
                  ? "rate_limited"
                  : "error",
          );
          return;
        }
        setData(body as MiniAppData);
        setStage("ready");
      })
      .catch(() => {
        if (
          !controller.signal.aborted ||
          controller.signal.reason === "timeout"
        )
          setStage("error");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [bridgeReady, period, revision, visible]);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(
      () => {
        setData(null);
        setStage("expired");
      },
      Math.max(0, data.expires_at * 1000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [data]);
  async function signup(event: string, join: boolean) {
    if (saving) return;
    setSaving(true);
    setSignupMessage("");
    const action =
      retry.current?.event === event && retry.current.join === join
        ? retry.current
        : { event, join, request: crypto.randomUUID() };
    retry.current = action;
    try {
      const response = await fetch("/api/telegram/mini-app", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: initData.current, period, ...action }),
        signal: AbortSignal.timeout(12000),
      });
      if (response.ok) {
        retry.current = null;
        setSignupMessage("Действие обработано. Обновляем текущую запись.");
      } else if (response.status === 401) {
        setData(null);
        setStage("expired");
        return;
      } else if (response.status === 403) {
        setData(null);
        setStage("forbidden");
        return;
      } else {
        setSignupMessage(
          response.status === 429
            ? "Слишком много запросов. Подождите минуту."
            : "Не удалось изменить запись. Событие могло начаться или закрыться.",
        );
      }
    } catch {
      setSignupMessage(
        "Ответ не получен. Обновите данные; повтор того же действия безопасен.",
      );
    } finally {
      setSaving(false);
      setRevision((value) => value + 1);
    }
  }
  const date = (value: string) =>
    new Date(value).toLocaleString("ru-RU", {
      timeZone: "UTC",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onReady={connect}
        onError={() => {
          scriptSettled.current = true;
          setStage("error");
        }}
      />
      <div className="mini-toolbar" role="group" aria-label="Период статистики">
        {(
          [
            ["week", "Неделя"],
            ["month", "Месяц"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className="button secondary"
            aria-pressed={period === value}
            disabled={
              !bridgeReady ||
              stage === "loading" ||
              stage === "expired" ||
              stage === "forbidden"
            }
            onClick={() => setPeriod(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div aria-live="polite" aria-atomic="true">
        {stage === "loading" && (
          <p className="notice" role="status">
            Загружаем ваш кабинет…
          </p>
        )}
        {stage !== "loading" && stage !== "ready" && (
          <section className="panel section-panel mini-message">
            <h2>
              {stage === "outside"
                ? "Кабинет внутри Telegram"
                : "Кабинет пока недоступен"}
            </h2>
            <p>{errors[stage]}</p>
            {(stage === "error" || stage === "rate_limited") && (
              <button
                className="button"
                onClick={() => {
                  if (!bridgeReady) window.location.reload();
                  else setRevision((value) => value + 1);
                }}
              >
                Попробовать снова
              </button>
            )}
          </section>
        )}
      </div>
      {data && (
        <div className="mini-content">
          {signupMessage && (
            <p className="notice" role="status">
              {signupMessage}
            </p>
          )}
          <section className="panel section-panel">
            <p className="eyebrow">ЛИЧНАЯ СТАТИСТИКА</p>
            <h2 className="mini-nickname">{data.nickname}</h2>
            <p className="caption">
              {data.stats.period_from} — {data.stats.period_through} · UTC
            </p>
            <dl className="mini-numbers">
              <div>
                <dt>Посещаемость</dt>
                <dd>
                  {data.stats.percentage === null
                    ? "Нет данных"
                    : `${String(data.stats.percentage).replace(".", ",")}%`}
                </dd>
              </div>
              <div>
                <dt>Посещено событий</dt>
                <dd>
                  {data.stats.present}{" "}
                  <span className="caption">из {data.stats.applicable}</span>
                </dd>
              </div>
            </dl>
            <p className="caption">
              Только подтверждённые учитываемые события. Уважительные причины
              исключены.
            </p>
          </section>
          <section className="panel section-panel">
            <h2>Моё золото</h2>
            <dl className="mini-numbers">
              <div>
                <dt>Начислено за период</dt>
                <dd>{formatGold(data.stats.earned_units)}</dd>
              </div>
              <div>
                <dt>Выплачено за период</dt>
                <dd>{formatGold(data.stats.paid_units)}</dd>
              </div>
              <div className="mini-balance">
                <dt>К получению сейчас · за всё время</dt>
                <dd>
                  {formatGold(data.stats.pending_units)}{" "}
                  <span className="caption">золота</span>
                </dd>
              </div>
            </dl>
            <p className="caption">
              Отменённые записи исключены. Передачу золота выполняют в игре.
            </p>
          </section>
          <section className="panel section-panel">
            <h2>Ближайшие события</h2>
            <p className="caption">
              До 10 предстоящих событий, независимо от периода статистики.
            </p>
            {!data.events.length ? (
              <p className="mini-empty">Пока ничего не запланировано.</p>
            ) : (
              <ul className="mini-events">
                {data.events.map((event) => (
                  <li key={event.id}>
                    <h3>{event.title}</h3>
                    <button
                      className="button secondary"
                      disabled={saving}
                      onClick={() => signup(event.id, !event.signed_up)}
                    >
                      {saving
                        ? "Сохраняем…"
                        : event.signed_up
                          ? "Отменить запись"
                          : "Записаться"}
                    </button>
                    <p className="caption">{date(event.starts_at)} · UTC</p>
                    <p>{event.signed_up ? "Вы записаны" : "Вы не записаны"}</p>
                    <a
                      className="text-button"
                      href={`${origin}/events/${event.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Открыть событие на сайте →
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="caption">Запись не является отметкой присутствия.</p>
          </section>
          <button
            className="button secondary"
            onClick={() => setRevision((value) => value + 1)}
          >
            Обновить данные
          </button>
        </div>
      )}
      <nav className="mini-footer" aria-label="Ссылки кабинета">
        <a
          className="text-button"
          href={`https://t.me/${botName}`}
          target="_blank"
          rel="noreferrer"
        >
          Открыть бота →
        </a>
        <a
          className="text-button"
          href={`${origin}/account/telegram`}
          target="_blank"
          rel="noreferrer"
        >
          Кабинет на сайте →
        </a>
        <p className="caption">
          На сайте потребуется обычный вход. Для обновления доступа к
          мини-приложению откройте его заново из меню бота.
        </p>
      </nav>
    </>
  );
}
