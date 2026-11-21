import "server-only";
import descriptions from "@/data/drop-descriptions.json";
export type DropDescription = {
  name: string;
  sourceName: string;
  url: string;
  text: string;
};
const byId: Record<string, DropDescription> = descriptions;
const normalize = (name: string) =>
  name.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
const byName = new Map(
  Object.values(byId).map((item) => [normalize(item.name), item]),
);
export function dropDescription(item: {
  catalog_id?: string | null;
  name: string;
}): DropDescription | null {
  return (
    (item.catalog_id ? byId[item.catalog_id] : undefined) ??
    byName.get(normalize(item.name)) ??
    null
  );
}
