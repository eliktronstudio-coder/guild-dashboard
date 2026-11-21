import { test } from "node:test";
import assert from "node:assert/strict";
import { memberDatabase, cid, id, guild } from "./support/database";

test("member module: upgrade, ownership, main character, history and isolation", async (t) => {
  const { db, as, scalar, members: m, before, after } = await memberDatabase();
  const save = (
    member: string,
    char: string,
    version: number,
    name: string,
    main = false,
    server = "Ария",
  ) =>
    db.query("select public.save_character($1,$2,$3,$4,$5,$6,$7,$8)", [
      member,
      char,
      version,
      name,
      server,
      "Целитель",
      "Исцеление / Сопротивление / Воодушевление",
      main,
    ]);
  await t.test(
    "additive migration preserves existing memberships, identities and roles",
    async () => {
      assert.deepEqual(after, before);
      await as(1);
      assert.equal(
        await scalar("select count(*)::int from public.member_directory"),
        4,
      );
      assert.equal(
        await scalar("select public.has_permission($1,'roles.assign')", [
          guild,
        ]),
        true,
      );
    },
  );
  await t.test(
    "pending and anonymous cannot read or edit characters",
    async () => {
      await as(5);
      assert.equal(
        await scalar("select count(*)::int from public.member_directory"),
        0,
      );
      await assert.rejects(() => save(m[2], cid(1), 0, "Лиса"), /FORBIDDEN/);
      await db.exec("set role anon");
      await assert.rejects(
        () => db.query("select * from public.characters"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "owner edits only own profile; stale forms and direct writes are blocked",
    async () => {
      await as(2);
      await db.query(
        "select public.update_member_profile($1,1,'  Помогаю в рейдах  ','teal')",
        [m[2]],
      );
      assert.equal(
        await scalar("select about from public.memberships where id=$1", [
          m[2],
        ]),
        "Помогаю в рейдах",
      );
      await assert.rejects(
        () =>
          db.query(
            "select public.update_member_profile($1,1,'Перезаписать','gold')",
            [m[2]],
          ),
        /STALE_VERSION/,
      );
      await assert.rejects(
        () =>
          db.query("select public.update_member_profile($1,1,'Чужой','gold')", [
            m[3],
          ]),
        /FORBIDDEN/,
      );
      await assert.rejects(
        () => db.query("update public.memberships set about='Обход'"),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.query(
            "select public.update_member_profile($1,2,'x','url(https://bad.test)')",
            [m[2]],
          ),
        /INVALID_PROFILE/,
      );
    },
  );
  await t.test(
    "first character becomes main; create retries do not duplicate data or audit",
    async () => {
      await as(2);
      await save(m[2], cid(1), 0, "Лиса");
      await save(m[2], cid(1), 0, "Лиса");
      assert.equal(
        await scalar("select count(*)::int from public.characters"),
        1,
      );
      assert.equal(
        await scalar("select is_main from public.characters where id=$1", [
          cid(1),
        ]),
        true,
      );
      await as(1);
      assert.equal(
        await scalar(
          "select count(*)::int from public.audit_log where action='character.created'",
        ),
        1,
      );
      await as(2);
      await assert.rejects(
        () => save(m[2], cid(9), 0, "лиса"),
        /CHARACTER_NAME_UNAVAILABLE/,
      );
    },
  );
  await t.test(
    "switching main is atomic and stale editor cannot overwrite the change",
    async () => {
      await as(2);
      await save(m[2], cid(2), 0, "Лунная Лиса", true);
      assert.equal(
        await scalar(
          "select count(*)::int from public.characters where is_main",
        ),
        1,
      );
      assert.equal(
        await scalar("select name from public.characters where is_main"),
        "Лунная Лиса",
      );
      assert.equal(
        await scalar("select version from public.characters where id=$1", [
          cid(1),
        ]),
        2,
      );
      await assert.rejects(
        () => save(m[2], cid(1), 1, "Перезапись", true),
        /STALE_VERSION/,
      );
      await assert.rejects(
        () => save(m[2], cid(3), 0, "XД", true),
        /INVALID_CHARACTER/,
      );
      assert.equal(
        await scalar("select name from public.characters where is_main"),
        "Лунная Лиса",
      );
    },
  );
  await t.test(
    "foreign character IDs cannot be reassigned, edited or archived",
    async () => {
      await as(3);
      await assert.rejects(
        () => save(m[3], cid(1), 2, "Кража"),
        /CHARACTER_UNAVAILABLE/,
      );
      await assert.rejects(() => save(m[2], cid(1), 2, "Кража"), /FORBIDDEN/);
      await assert.rejects(
        () =>
          db.query(
            "select public.archive_character($1,$2,2,'Удалить чужого')",
            [m[3], cid(1)],
          ),
        /CHARACTER_UNAVAILABLE/,
      );
    },
  );
  await t.test(
    "archive preserves records and promotes replacement; retry is harmless",
    async () => {
      await as(2);
      await db.query(
        "select public.archive_character($1,$2,1,'Больше не играю')",
        [m[2], cid(2)],
      );
      await db.query("select public.archive_character($1,$2,1,'Повтор')", [
        m[2],
        cid(2),
      ]);
      assert.equal(
        await scalar("select name from public.characters where is_main"),
        "Лиса",
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.characters where archived_at is not null",
        ),
        1,
      );
      await as(3);
      assert.equal(
        await scalar("select count(*)::int from public.characters"),
        1,
      );
      await as(1);
      assert.equal(
        await scalar(
          "select count(*)::int from public.audit_log where action='character.archived'",
        ),
        1,
      );
    },
  );
  await t.test(
    "rename keeps UUID/characters stable, records history and rejects conflicts",
    async () => {
      await as(2);
      await db.query(
        "select public.change_member_nickname($1,2,'  Лунный   Ветер ','Изменил ник в игре')",
        [m[2]],
      );
      await db.query(
        "select public.change_member_nickname($1,2,'Лунный Ветер','Повтор')",
        [m[2]],
      );
      assert.equal(
        await scalar("select user_id from public.memberships where id=$1", [
          m[2],
        ]),
        id(2),
      );
      assert.equal(
        await scalar(
          "select membership_id from public.characters where id=$1",
          [cid(1)],
        ),
        m[2],
      );
      assert.equal(
        await scalar("select count(*)::int from public.nickname_history"),
        1,
      );
      assert.equal(
        await scalar("select old_nickname from public.nickname_history"),
        "Лиса",
      );
      await assert.rejects(
        () =>
          db.query(
            "select public.change_member_nickname($1,3,'Другой','Вновь изменил')",
            [m[2]],
          ),
        /NICKNAME_RATE_LIMIT/,
      );
      await as(1);
      await assert.rejects(
        () =>
          db.query(
            "select public.change_member_nickname($1,3,'Ронин','Исправление')",
            [m[2]],
          ),
        /NICKNAME_UNAVAILABLE/,
      );
      assert.equal(
        await scalar("select count(*)::int from public.nickname_history"),
        1,
      );
      await as(3);
      assert.equal(
        await scalar("select count(*)::int from public.nickname_history"),
        0,
      );
    },
  );
  await t.test(
    "officer cannot edit another profile; admin can, but owner is protected",
    async () => {
      await as(1);
      await db.query("select public.assign_member_role($1,'officer')", [m[3]]);
      await as(3);
      await assert.rejects(() => save(m[2], cid(8), 0, "Офицер"), /FORBIDDEN/);
      await as(1);
      await db.query("select public.assign_member_role($1,'admin')", [m[3]]);
      await as(3);
      await save(m[2], cid(8), 0, "Администратор");
      await assert.rejects(
        () => save(m[1], cid(7), 0, "Владелец"),
        /FORBIDDEN/,
      );
    },
  );
  await t.test(
    "cross-guild records stay hidden through the directory view and direct API",
    async () => {
      await db.exec("reset role");
      const foreign = "00000000-0000-4000-8000-000000000002";
      await db.query(
        "insert into public.guilds(id,slug,name) values($1,'other','Other')",
        [foreign],
      );
      const foreignMember = await scalar<string>(
        "insert into public.memberships(guild_id,user_id,nickname) values($1,$2,'Чужая Гильдия') returning id",
        [foreign, id(6)],
      );
      await db.query(
        "insert into public.characters(guild_id,membership_id,name,is_main) values($1,$2,'Чужой',true)",
        [foreign, foreignMember],
      );
      await as(1);
      assert.equal(
        await scalar(
          "select count(*)::int from public.member_directory where guild_id=$1",
          [foreign],
        ),
        0,
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.characters where guild_id=$1",
          [foreign],
        ),
        0,
      );
      await assert.rejects(
        () => save(foreignMember, cid(19), 0, "Вторжение"),
        /FORBIDDEN/,
      );
    },
  );
  await t.test(
    "last character may be archived; next first character becomes main",
    async () => {
      await as(4);
      await save(m[4], cid(20), 0, "Страж");
      await db.query(
        "select public.archive_character($1,$2,1,'Завершил игру')",
        [m[4], cid(20)],
      );
      assert.equal(
        await scalar(
          "select count(*)::int from public.characters where membership_id=$1 and is_main",
          [m[4]],
        ),
        0,
      );
      await save(m[4], cid(21), 0, "Новый Страж");
      assert.equal(
        await scalar(
          "select name from public.characters where membership_id=$1 and is_main",
          [m[4]],
        ),
        "Новый Страж",
      );
    },
  );
  await t.test("blocked user loses profile writes immediately", async () => {
    await as(1);
    await db.query("select public.set_member_blocked($1,true)", [m[2]]);
    await as(2);
    await assert.rejects(() => save(m[2], cid(11), 0, "Обход"), /FORBIDDEN/);
    assert.equal(
      await scalar("select count(*)::int from public.characters"),
      0,
    );
    assert.equal(
      await scalar("select count(*)::int from public.nickname_history"),
      0,
    );
  });
  await db.close();
});
