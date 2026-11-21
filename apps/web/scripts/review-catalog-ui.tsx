// Isolated synthetic fixture; never shipped as an application route.
import { createRoot } from "react-dom/client";
import { MemberDirectory } from "../src/components/members/directory";
import { CatalogPhotoInput } from "../src/components/catalog-photo-input";
import { AdminTabs } from "../src/components/admin-tabs";
const member = {
  id: "10000000-0000-4000-8000-000000000001",
  nickname: "Тестовый участник",
  joined_at: "2026-11-01",
  status: "active",
  avatar_style: "gold",
  main_character: null,
  character_class: null,
  specialization: null,
  game_server: null,
  role_codes: ["member"],
  role_names: ["Участник"],
  payout_weight: 100,
  weight_version: 1,
};
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 16, maxWidth: 1100, margin: "auto" }}>
    <AdminTabs current="/admin/catalog/loot" />
    <h1>Список дропа</h1>
    <section className="panel section-panel">
      <div className="catalog-heading">
        <span className="catalog-photo catalog-placeholder">◇</span>
        <div>
          <h2>Тестовый предмет</h2>
          <p>150 зол. / шт.</p>
        </div>
      </div>
      <label>
        Фото
        <CatalogPhotoInput />
      </label>
    </section>
    <h1>Состав</h1>
    <section className="panel section-panel">
      <MemberDirectory
        members={[member]}
        weightAction={async () => ({
          success: "Сохранено в тестовом интерфейсе",
        })}
      />
    </section>
  </main>,
);
