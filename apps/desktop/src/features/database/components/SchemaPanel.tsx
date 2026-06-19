import type { ReactNode } from "react";

import { formatRowCount } from "@/features/database/core/cell-format";
import type { TableSchema } from "@/features/database/types";
import { Button } from "@/ui";

type SchemaPanelProps = {
  schema: TableSchema;
};

const schemaTableClassName =
  "w-full border-collapse font-mono text-[12px] leading-[1.4] [&_td]:border-b [&_td]:border-cg-border [&_td]:px-2.5 [&_td]:py-[5px] [&_td]:align-top [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-cg-border [&_th]:bg-cg-titlebar [&_th]:px-2.5 [&_th]:py-[7px] [&_th]:text-left [&_th]:text-[11px] [&_th]:font-bold [&_th]:text-cg-muted";

export function SchemaPanel({ schema }: SchemaPanelProps) {
  return (
    <div className="grid min-h-0 content-start gap-5 overflow-auto pb-4 pr-1">
      <SchemaSection
        title={`Columns (${formatRowCount(schema.columns.length)})`}
      >
        <table className={schemaTableClassName}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Constraints</th>
              <th scope="col">Default</th>
            </tr>
          </thead>
          <tbody>
            {schema.columns.map((column) => (
              <tr key={column.name}>
                <td className="font-bold text-cg-fg">{column.name}</td>
                <td className="text-cg-muted">{column.dataType || "—"}</td>
                <td className="text-cg-muted">
                  {[
                    column.primaryKey ? "PRIMARY KEY" : null,
                    column.notNull ? "NOT NULL" : null,
                    column.hidden ? "HIDDEN" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="text-cg-muted">{column.defaultValue ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SchemaSection>

      {schema.foreignKeys.length > 0 ? (
        <SchemaSection
          title={`Foreign Keys (${formatRowCount(schema.foreignKeys.length)})`}
        >
          <table className={schemaTableClassName}>
            <thead>
              <tr>
                <th scope="col">Columns</th>
                <th scope="col">References</th>
                <th scope="col">On Delete</th>
                <th scope="col">On Update</th>
              </tr>
            </thead>
            <tbody>
              {schema.foreignKeys.map((foreignKey, index) => (
                <tr key={index}>
                  <td>{foreignKey.fromColumns.join(", ")}</td>
                  <td>
                    {foreignKey.table}
                    {foreignKey.toColumns.length > 0
                      ? ` (${foreignKey.toColumns.join(", ")})`
                      : ""}
                  </td>
                  <td className="text-cg-muted">{foreignKey.onDelete}</td>
                  <td className="text-cg-muted">{foreignKey.onUpdate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SchemaSection>
      ) : null}

      {schema.indexes.length > 0 ? (
        <SchemaSection
          title={`Indexes (${formatRowCount(schema.indexes.length)})`}
        >
          <table className={schemaTableClassName}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Columns</th>
                <th scope="col">Properties</th>
              </tr>
            </thead>
            <tbody>
              {schema.indexes.map((index) => (
                <tr key={index.name}>
                  <td>{index.name}</td>
                  <td>{index.columns.join(", ")}</td>
                  <td className="text-cg-muted">
                    {[
                      index.unique ? "UNIQUE" : null,
                      index.partial ? "PARTIAL" : null,
                      index.origin === "pk"
                        ? "primary key"
                        : index.origin === "u"
                          ? "unique constraint"
                          : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SchemaSection>
      ) : null}

      {schema.triggers.length > 0 ? (
        <SchemaSection
          title={`Triggers (${formatRowCount(schema.triggers.length)})`}
        >
          <div className="grid gap-2">
            {schema.triggers.map((trigger) => (
              <DdlBlock ddl={trigger.ddl ?? trigger.name} key={trigger.name} />
            ))}
          </div>
        </SchemaSection>
      ) : null}

      {schema.ddl ? (
        <SchemaSection title="DDL">
          <DdlBlock copyable ddl={schema.ddl} />
        </SchemaSection>
      ) : null}
    </div>
  );
}

function SchemaSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="grid min-w-0 gap-2">
      <h3 className="m-0 text-[11px] font-bold uppercase tracking-[0.06em] text-cg-muted">
        {title}
      </h3>
      <div className="min-w-0 overflow-auto rounded-[7px] border border-cg-border bg-cg-editor">
        {children}
      </div>
    </section>
  );
}

function DdlBlock({
  copyable = false,
  ddl,
}: {
  copyable?: boolean;
  ddl: string;
}) {
  return (
    <div className="relative">
      <pre className="m-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[12px] leading-[1.5] text-cg-fg">
        {ddl}
      </pre>
      {copyable ? (
        <Button
          className="absolute right-2 top-2"
          onClick={() => {
            void navigator.clipboard.writeText(ddl);
          }}
          size="sm"
          variant="subtle"
        >
          Copy
        </Button>
      ) : null}
    </div>
  );
}
