import {
  authorizeDiscord,
  boundedJson,
  decryptDiscordToken,
  discordAdmin,
  discordContext,
} from "@/lib/discord/server";
import { parseActivityPayload } from "@/lib/activity-workspace";
import { isUuid } from "@/lib/members";
export const runtime = "nodejs";
const response = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  if (!authorizeDiscord(request))
    return response({ error: "UNAUTHORIZED" }, 401);
  if ((await params).operation !== "runtime")
    return response({ error: "NOT_FOUND" }, 404);
  try {
    const application = new URL(request.url).searchParams.get("application");
    if (application && !/^\d{17,22}$/.test(application))
      return response({ error: "INVALID_INPUT" }, 400);
    const { data, error } = await discordAdmin().rpc("discord_runtime", {
      p_application: application,
    });
    if (error) return response({ error: "DISCORD_DATABASE_UNAVAILABLE" }, 503);
    return response(
      data?.enabled && data.encrypted_token
        ? {
            enabled: true,
            server: data.server,
            channel: data.channel,
            token: decryptDiscordToken(data.encrypted_token),
          }
        : { enabled: false },
    );
  } catch {
    return response({ error: "DISCORD_NOT_CONFIGURED" }, 503);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  if (!authorizeDiscord(request))
    return response({ error: "UNAUTHORIZED" }, 401);
  try {
    const operation = (await params).operation,
      body = await boundedJson(request),
      context = discordContext(body.context);
    if (operation === "context") {
      const { data, error } = await discordAdmin().rpc(
        "discord_import_context",
        context,
      );
      return error
        ? response(
            {
              error: [
                "DISCORD_CHANNEL_FORBIDDEN",
                "DISCORD_CONNECTION_OWNER_UNAVAILABLE",
              ].includes(error.message)
                ? error.message
                : "FORBIDDEN",
            },
            403,
          )
        : response(data);
    }
    if (operation !== "import") return response({ error: "NOT_FOUND" }, 404);
    if (!isUuid(body.request) || !/^\d{17,22}$/.test(body.message))
      return response({ error: "INVALID_INPUT" }, 400);
    const parsed = parseActivityPayload(JSON.stringify(body.activity));
    if (!("payload" in parsed))
      return response(
        { error: "INVALID_ACTIVITY", message: parsed.error },
        400,
      );
    const { data, error } = await discordAdmin().rpc(
      "record_discord_activity",
      {
        ...context,
        p_message: body.message,
        p_request: body.request,
        p_payload: parsed.payload,
      },
    );
    if (error) {
      const known = [
        "CATALOG_STALE",
        "REQUEST_CONFLICT",
        "INVALID_ROSTER",
        "DISCORD_CHANNEL_FORBIDDEN",
        "DISCORD_CONNECTION_OWNER_UNAVAILABLE",
        "EVENT_IN_FUTURE",
        "ROSTER_CONFIRMATION_REQUIRED",
      ];
      return response(
        {
          error: known.includes(error.message)
            ? error.message
            : "IMPORT_FAILED",
        },
        409,
      );
    }
    return response({
      event_id: data,
      url: `${process.env.APP_ORIGIN}/events/${data}`,
    });
  } catch {
    return response({ error: "INVALID_REQUEST" }, 400);
  }
}
