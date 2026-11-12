"use client";

import { saveCategory, setCategoryActive } from "@/modules/inventario/actions";
import { ResourceManager, type Column, type FieldDef } from "@/components/resource-manager";
import { Badge } from "@/components/ui";
import type { Category } from "@/modules/inventario/types";

const columns: Column<Category>[] = [
  { header: "Categoría", cell: (c) => <span className="font-medium text-slate-900">{c.name}</span> },
  { header: "Descripción", cell: (c) => c.description || "—" },
  { header: "Estado", cell: (c) => <Badge tone={c.active ? "green" : "neutral"}>{c.active ? "Activa" : "Inactiva"}</Badge> },
];

const fields: FieldDef[] = [
  { name: "name", label: "Nombre", required: true, wide: true, maxLength: 80 },
  { name: "description", label: "Descripción", type: "textarea", maxLength: 300 },
];

export function CategoriesView({ rows }: { rows: Category[] }) {
  return (
    <ResourceManager
      actions={{ save: saveCategory, setActive: setCategoryActive }}
      module="inventario"
      singular="categoría"
      feminine
      rows={rows}
      columns={columns}
      fields={fields}
      getId={(c) => c.id}
      searchText={(c) => `${c.name} ${c.description}`}
      isActive={(c) => c.active}
      exportable={{
        title: "Categorías",
        filename: "categorias",
        columns: [
          { header: "Categoría", value: (c) => c.name },
          { header: "Descripción", value: (c) => c.description },
          { header: "Estado", value: (c) => (c.active ? "Activa" : "Inactiva") },
        ],
      }}
    />
  );
}
