import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailLoginInput,
  canAttachEmailLogin,
  attachEmailLogin,
  type EmailLoginAccount,
} from "../src/lib/email-login";
const telegram: EmailLoginAccount = {
  id: "original-auth-user-id",
  identities: [{ provider: "custom:telegram" }],
  user_metadata: { game_nickname: "Старый ник", existing_setting: true },
};
function form(
  email = " Player@Example.test ",
  password = "example-password-123",
) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    email,
    password,
    confirmation: password,
    confirm: "on",
    userId: "attacker-supplied-id",
    nickname: "Другой ник",
  }))
    f.set(k, v);
  return f;
}
test("email login adds credentials to the original verified account ID, preserves metadata and never uses a supplied ID or nickname", async () => {
  const before = structuredClone(telegram);
  let updates = 0;
  const dataOnSite = {
    membership: {
      user_id: telegram.id,
      nickname: "Старый ник",
      role: "member",
    },
    attendance: [1, 2, 3],
    awards: [150, 200],
  };
  const snapshot = structuredClone(dataOnSite);
  const result = await attachEmailLogin(
    telegram,
    emailLoginInput(form()),
    async (id, attrs) => {
      updates++;
      assert.equal(id, telegram.id);
      assert.equal(attrs.email, "player@example.test");
      assert.equal(attrs.email_confirm, true);
      assert.equal(attrs.user_metadata.game_nickname, "Старый ник");
      assert.equal(attrs.user_metadata.existing_setting, true);
      assert.equal(attrs.user_metadata.email_ownership_verified, false);
      assert.equal("password" in attrs.user_metadata, false);
      return {
        data: {
          user: {
            ...telegram,
            email: attrs.email,
            identities: [...telegram.identities!, { provider: "email" }],
          },
        },
        error: null,
      };
    },
  );
  assert.equal(result.success, true);
  assert.equal(updates, 1);
  assert.deepEqual(telegram, before);
  assert.deepEqual(dataOnSite, snapshot);
});
test("never overwrites an existing email identity or auto-merges accounts on an occupied address", async () => {
  let updates = 0;
  const update = async () => {
    updates++;
    return { data: { user: null }, error: { code: "email_exists" } };
  };
  assert.ok(
    (
      await attachEmailLogin(
        {
          ...telegram,
          identities: [{ provider: "custom:telegram" }, { provider: "email" }],
        },
        emailLoginInput(form()),
        update,
      )
    ).error,
  );
  assert.equal(updates, 0);
  assert.ok(
    (await attachEmailLogin(telegram, emailLoginInput(form()), update)).error,
  );
  assert.equal(updates, 1);
  assert.equal(
    canAttachEmailLogin({ id: "other", identities: [{ provider: "google" }] }),
    false,
  );
  assert.equal(canAttachEmailLogin({ id: "none" }), false);
});
test("validates email, password confirmation, consent and returned account identity", async () => {
  for (const [k, v] of [
    ["email", "invalid"],
    ["password", "short"],
    ["confirmation", "different-password"],
    ["confirm", ""],
  ]) {
    const f = form();
    f.set(k, v);
    let called = false;
    const result = await attachEmailLogin(
      telegram,
      emailLoginInput(f),
      async () => {
        called = true;
        return { data: { user: null }, error: null };
      },
    );
    assert.ok(result.error);
    assert.equal(called, false);
  }
  const wrong = await attachEmailLogin(
    telegram,
    emailLoginInput(form()),
    async () => ({
      data: {
        user: { ...telegram, id: "different", email: "player@example.test" },
      },
      error: null,
    }),
  );
  assert.ok(wrong.error);
});
