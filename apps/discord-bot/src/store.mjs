import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import {
  gameNickname,
  nicknameKey,
  aliasKey,
  memoryDecision,
} from "./nickname-memory.mjs";
export function draftStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, "drafts.sqlite");
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(
    "PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated INTEGER NOT NULL)",
  );
  db.exec(`PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS vision_usage(id TEXT PRIMARY KEY,scope TEXT NOT NULL,cache_key TEXT NOT NULL,day TEXT NOT NULL,month TEXT NOT NULL,started INTEGER NOT NULL,status TEXT NOT NULL,cost_micros INTEGER NOT NULL,input_tokens INTEGER,output_tokens INTEGER,error TEXT);
    CREATE TABLE IF NOT EXISTS vision_cache(scope TEXT NOT NULL,cache_key TEXT NOT NULL,payload TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(scope,cache_key));
    CREATE TABLE IF NOT EXISTS nickname_names(scope TEXT NOT NULL,name_key TEXT NOT NULL,nickname TEXT NOT NULL,confirmed INTEGER NOT NULL DEFAULT 1,updated INTEGER NOT NULL,PRIMARY KEY(scope,name_key));
    CREATE TABLE IF NOT EXISTS nickname_confirmations(scope TEXT NOT NULL,id TEXT NOT NULL,source TEXT NOT NULL,actor TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(scope,id));
    CREATE TABLE IF NOT EXISTS nickname_examples(scope TEXT NOT NULL,confirmation TEXT NOT NULL,slot_key TEXT NOT NULL,image_key TEXT NOT NULL,alias TEXT NOT NULL,name_key TEXT NOT NULL,PRIMARY KEY(scope,confirmation,slot_key,alias,name_key),FOREIGN KEY(scope,name_key) REFERENCES nickname_names(scope,name_key) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS nickname_examples_slot ON nickname_examples(scope,slot_key);
    CREATE INDEX IF NOT EXISTS nickname_examples_alias ON nickname_examples(scope,alias);
  `);
  return {
    visionCached(scope, key, now, ttl) {
      const row = db
        .prepare(
          "SELECT payload FROM vision_cache WHERE scope=? AND cache_key=? AND updated>?",
        )
        .get(scope, key, now - ttl);
      return row ? JSON.parse(row.payload) : null;
    },
    visionReserve(scope, key, limits, now = Date.now()) {
      // One SQLite transaction covers all workers/scopes and survives restarts.
      db.exec("BEGIN IMMEDIATE");
      try {
        const cached = db
          .prepare(
            "SELECT payload FROM vision_cache WHERE scope=? AND cache_key=? AND updated>?",
          )
          .get(scope, key, now - limits.cacheTtl);
        if (cached) {
          db.exec("COMMIT");
          return { cached: JSON.parse(cached.payload) };
        }
        const active = db
          .prepare(
            "SELECT count(*) n FROM vision_usage WHERE status='running' AND started>?",
          )
          .get(now - limits.leaseMs).n;
        if (active >= limits.concurrent) throw Error("GPT_BUSY");
        if (
          db
            .prepare(
              "SELECT 1 FROM vision_usage WHERE scope=? AND cache_key=? AND status='running' AND started>?",
            )
            .get(scope, key, now - limits.leaseMs)
        )
          throw Error("GPT_BUSY");
        const day = db
          .prepare("SELECT count(*) n FROM vision_usage WHERE day=?")
          .get(limits.day).n;
        if (day >= limits.daily) throw Error("GPT_DAILY_LIMIT");
        const cost = db
          .prepare(
            "SELECT coalesce(sum(cost_micros),0) n FROM vision_usage WHERE month=?",
          )
          .get(limits.month).n;
        if (cost + limits.reserveMicros > limits.monthlyMicros)
          throw Error("GPT_MONTHLY_LIMIT");
        const id = randomUUID();
        db.prepare(
          "INSERT INTO vision_usage VALUES(?,?,?,?,?,?, 'running',?,NULL,NULL,NULL)",
        ).run(
          id,
          scope,
          key,
          limits.day,
          limits.month,
          now,
          limits.reserveMicros,
        );
        db.exec("COMMIT");
        return { id };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    visionFinish(
      id,
      {
        result = null,
        costMicros,
        inputTokens = null,
        outputTokens = null,
        error = null,
      },
      now = Date.now(),
    ) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db
          .prepare("SELECT * FROM vision_usage WHERE id=? AND status='running'")
          .get(id);
        if (!row) {
          db.exec("COMMIT");
          return;
        }
        db.prepare(
          "UPDATE vision_usage SET status=?,cost_micros=?,input_tokens=?,output_tokens=?,error=? WHERE id=?",
        ).run(
          result ? "completed" : "failed",
          costMicros ?? row.cost_micros,
          inputTokens,
          outputTokens,
          error,
          id,
        );
        if (result)
          db.prepare(
            "INSERT INTO vision_cache VALUES(?,?,?,?) ON CONFLICT(scope,cache_key) DO UPDATE SET payload=excluded.payload,updated=excluded.updated",
          ).run(row.scope, row.cache_key, JSON.stringify(result), now);
        db.prepare(
          "DELETE FROM vision_cache WHERE rowid NOT IN (SELECT rowid FROM vision_cache ORDER BY updated DESC LIMIT 500)",
        ).run();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    knownNicknames(scope) {
      return db
        .prepare(
          "SELECT nickname FROM nickname_names WHERE scope=? ORDER BY updated DESC LIMIT 2000",
        )
        .all(scope)
        .map((r) => r.nickname);
    },
    recallNickname(scope, reading) {
      const exact = reading.key
        ? db
            .prepare(
              "SELECT DISTINCT n.nickname FROM nickname_examples e JOIN nickname_names n USING(scope,name_key) WHERE e.scope=? AND e.slot_key=?",
            )
            .all(scope, reading.key)
        : [];
      const keys = [
        ...new Set(
          [reading.visible, ...(reading.variants ?? [])]
            .map(aliasKey)
            .filter((k) => k.length >= 4),
        ),
      ].slice(0, 20);
      const aliases = keys.length
        ? db
            .prepare(
              "SELECT e.alias,n.nickname,count(DISTINCT e.image_key) AS samples FROM nickname_examples e JOIN nickname_names n USING(scope,name_key) WHERE e.scope=? AND e.alias IN (" +
                keys.map(() => "?").join(",") +
                ") GROUP BY e.alias,e.name_key",
            )
            .all(scope, ...keys)
        : [];
      return memoryDecision(exact, aliases, reading);
    },
    rememberNicknames({
      scope,
      id,
      source,
      actor,
      names = [],
      corrections = [],
    }) {
      const all = [...names, ...corrections.map((c) => c.name)]
          .map(gameNickname)
          .filter(Boolean),
        unique = new Map(all.map((name) => [nicknameKey(name), name]));
      if (!unique.size) return false;
      db.exec("BEGIN IMMEDIATE");
      try {
        if (
          !db
            .prepare(
              "INSERT OR IGNORE INTO nickname_confirmations VALUES(?,?,?,?,?)",
            )
            .run(scope, id, source, actor, Date.now()).changes
        ) {
          db.exec("COMMIT");
          return false;
        }
        for (const [key, name] of unique)
          db.prepare(
            "INSERT INTO nickname_names VALUES(?,?,?,1,?) ON CONFLICT(scope,name_key) DO UPDATE SET nickname=excluded.nickname,confirmed=confirmed+1,updated=excluded.updated",
          ).run(scope, key, name, Date.now());
        for (const c of corrections) {
          const name = gameNickname(c.name);
          if (!name || !c.key || !c.imageKey) continue;
          const aliases = [
            ...new Set([
              "",
              ...(c.variants ?? [])
                .map(aliasKey)
                .filter((a) => a.length >= 3 && a.length <= 100),
            ]),
          ].slice(0, 21);
          for (const alias of aliases)
            db.prepare(
              "INSERT OR IGNORE INTO nickname_examples VALUES(?,?,?,?,?,?)",
            ).run(scope, id, c.key, c.imageKey, alias, nicknameKey(name));
        }
        // The dictionary and examples are bounded, but confirmations remain as retry fences.
        db.prepare(
          "DELETE FROM nickname_names WHERE scope=? AND name_key NOT IN (SELECT name_key FROM nickname_names WHERE scope=? ORDER BY updated DESC LIMIT 5000)",
        ).run(scope, scope);
        db.prepare(
          "DELETE FROM nickname_examples WHERE scope=? AND rowid NOT IN (SELECT rowid FROM nickname_examples WHERE scope=? ORDER BY rowid DESC LIMIT 50000)",
        ).run(scope, scope);
        db.exec("COMMIT");
        return true;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    nicknameMemoryStats(scope) {
      return {
        names: db
          .prepare("SELECT count(*) AS n FROM nickname_names WHERE scope=?")
          .get(scope).n,
        examples: db
          .prepare(
            "SELECT count(*) AS n FROM (SELECT DISTINCT slot_key,name_key FROM nickname_examples WHERE scope=?)",
          )
          .get(scope).n,
      };
    },
    forgetNickname(scope, name) {
      return (
        db
          .prepare("DELETE FROM nickname_names WHERE scope=? AND name_key=?")
          .run(scope, nicknameKey(name)).changes > 0
      );
    },
    get(id) {
      const row = db
        .prepare("SELECT payload FROM drafts WHERE id=? AND updated>?")
        .get(id, Date.now() - 86400000);
      if (!row) throw Error("DRAFT_EXPIRED");
      return JSON.parse(row.payload);
    },
    put(draft) {
      db.prepare("DELETE FROM drafts WHERE updated<?").run(
        Date.now() - 86400000,
      );
      db.prepare(
        "INSERT INTO drafts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated",
      ).run(draft.id, JSON.stringify(draft), Date.now());
    },
    close() {
      db.close();
    },
  };
}
