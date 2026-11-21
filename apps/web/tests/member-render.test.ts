import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberDirectory } from "../src/components/members/directory";
import type { DirectoryMember } from "../src/lib/members";
test("directory escapes player content and uses stable membership links", () => {
  const member: DirectoryMember = {
    id: "10000000-0000-4000-8000-000000000001",
    nickname: "Лунная Лиса",
    joined_at: "2026-10-31T00:00:00Z",
    status: "active",
    avatar_style: "teal",
    main_character: "Лиса",
    character_class: "<img src=x onerror=alert(1)>",
    specialization: null,
    game_server: "Ария",
    role_codes: ["member"],
    role_names: ["Участник"],
  };
  const html = renderToStaticMarkup(
    createElement(MemberDirectory, { members: [member] }),
  );
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes(`/members/${member.id}`));
  assert.ok(html.includes("directory-mobile"));
  assert.ok(html.includes("directory-desktop"));
});
