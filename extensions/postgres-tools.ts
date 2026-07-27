/**
 * Shelly extension: PostgreSQL tools
 *
 * Read-only database tools for querying, inspecting schema, and debugging.
 * Connection via DATABASE_URL env var.
 * All queries run in a read-only transaction for safety.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  const databaseUrl = process.env.DATABASE_URL || "";

  if (!databaseUrl) {
    // No database configured -- skip registering tools
    return;
  }

  /** Blocked SQL keywords -- NEVER allow destructive operations */
  const BLOCKED_KEYWORDS = [
    "DROP", "TRUNCATE", "DELETE", "INSERT", "UPDATE", "ALTER",
    "CREATE", "GRANT", "REVOKE", "COPY", "VACUUM",
  ];

  /** Check if a query contains destructive operations */
  function validateQuery(query: string): string | null {
    const upper = query.toUpperCase().replace(/\s+/g, " ").trim();
    for (const keyword of BLOCKED_KEYWORDS) {
      // Match keyword as a whole word (not inside identifiers)
      const pattern = new RegExp(`\\b${keyword}\\b`);
      if (pattern.test(upper)) {
        return `Refused: ${keyword} operations are not allowed. This tool is read-only.`;
      }
    }
    return null;
  }

  /** Run a query via psql and return the output */
  async function runPsql(query: string, options: { readonly?: boolean; format?: string } = {}): Promise<string> {
    const { execSync } = await import("child_process");
    const format = options.format || "aligned";

    // Block destructive queries at the application level
    const blocked = validateQuery(query);
    if (blocked) throw new Error(blocked);

    // Also wrap in read-only transaction as a second layer of safety
    const wrappedQuery = `SET TRANSACTION READ ONLY; ${query}`;

    const formatFlag = format === "csv" ? "--csv" : format === "json" ? "--tuples-only -A" : "";

    try {
      const result = execSync(
        `psql "${databaseUrl}" ${formatFlag} -c "${wrappedQuery.replace(/"/g, '\\"')}"`,
        { encoding: "utf-8", timeout: 30000, env: { ...process.env, PGCONNECT_TIMEOUT: "10" } },
      );
      return result.trim();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`psql error: ${msg}`);
    }
  }

  // ── pg_query: Run a read-only SQL query ──

  pi.registerTool({
    name: "pg_query",
    label: "SQL Query",
    description: "Run a read-only SQL query against the connected PostgreSQL database. Returns results as a table. All queries are wrapped in a read-only transaction for safety -- you cannot INSERT, UPDATE, DELETE, or DROP.",
    promptSnippet: "Run read-only SQL queries against PostgreSQL",
    promptGuidelines: [
      "All queries are automatically read-only. Do not attempt INSERT/UPDATE/DELETE.",
      "Use pg_schema first to understand the database structure before querying.",
      "Keep queries efficient -- add LIMIT for large tables.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "SQL query to execute (SELECT only)" }),
      format: Type.Optional(Type.String({ description: "Output format: aligned (default), csv, or json" })),
    }),
    async execute(_id, params) {
      try {
        const result = await runPsql(params.query, { readonly: true, format: params.format });
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── pg_schema: List tables and their columns ──

  pi.registerTool({
    name: "pg_schema",
    label: "DB Schema",
    description: "List all tables in the database with their columns, types, and nullable status. Optionally filter by schema name.",
    promptSnippet: "Inspect PostgreSQL database schema",
    parameters: Type.Object({
      schema: Type.Optional(Type.String({ description: "Schema name (default: public)" })),
    }),
    async execute(_id, params) {
      const schema = params.schema || "public";
      const query = `
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = '${schema}'
        ORDER BY table_name, ordinal_position
      `;
      try {
        const result = await runPsql(query);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── pg_table_info: Detailed info about a specific table ──

  pi.registerTool({
    name: "pg_table_info",
    label: "Table Info",
    description: "Get detailed information about a specific table: columns, types, constraints, indexes, and foreign keys.",
    promptSnippet: "Describe a PostgreSQL table in detail",
    parameters: Type.Object({
      table: Type.String({ description: "Table name" }),
      schema: Type.Optional(Type.String({ description: "Schema name (default: public)" })),
    }),
    async execute(_id, params) {
      const schema = params.schema || "public";
      const t = params.table;

      const queries = [
        `-- Columns\nSELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${t}' ORDER BY ordinal_position;`,
        `-- Indexes\nSELECT indexname, indexdef FROM pg_indexes WHERE schemaname='${schema}' AND tablename='${t}';`,
        `-- Foreign Keys\nSELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name WHERE tc.table_schema='${schema}' AND tc.table_name='${t}' AND tc.constraint_type='FOREIGN KEY';`,
        `-- Row count estimate\nSELECT reltuples::bigint AS estimated_rows FROM pg_class WHERE relname='${t}';`,
      ];

      try {
        const results: string[] = [];
        for (const q of queries) {
          results.push(await runPsql(q));
        }
        return { content: [{ type: "text", text: results.join("\n\n") }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── pg_explain: Run EXPLAIN ANALYZE ──

  pi.registerTool({
    name: "pg_explain",
    label: "Explain Query",
    description: "Run EXPLAIN ANALYZE on a query to see the execution plan, timing, and row estimates. Useful for debugging slow queries.",
    promptSnippet: "Analyze SQL query performance with EXPLAIN",
    parameters: Type.Object({
      query: Type.String({ description: "SQL query to explain" }),
    }),
    async execute(_id, params) {
      try {
        const result = await runPsql(`EXPLAIN ANALYZE ${params.query}`);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── pg_connections: Show active connections ──

  pi.registerTool({
    name: "pg_connections",
    label: "DB Connections",
    description: "Show active database connections, their state, and what queries they are running.",
    promptSnippet: "Show active PostgreSQL connections",
    parameters: Type.Object({}),
    async execute() {
      const query = `
        SELECT pid, usename, application_name, client_addr, state,
               now() - query_start AS duration, LEFT(query, 100) AS query
        FROM pg_stat_activity
        WHERE state IS NOT NULL
        ORDER BY query_start DESC
        LIMIT 50
      `;
      try {
        const result = await runPsql(query);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });
}
