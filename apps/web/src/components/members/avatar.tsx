import { AVATAR_STYLES } from "@/lib/members";
export function MemberAvatar({
  nickname,
  style = "gold",
  large = false,
}: {
  nickname: string;
  style?: string;
  large?: boolean;
}) {
  const color = AVATAR_STYLES.some(([v]) => v === style) ? style : "gold";
  return (
    <span
      className={`avatar avatar-${color}${large ? " avatar-large" : ""}`}
      aria-hidden="true"
    >
      {nickname.slice(0, 1)}
    </span>
  );
}
