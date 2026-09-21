/**
 * Runs the pgTAP suites in tests/database against a live database.
 *
 * `supabase test db` is the usual way to do this, but it needs the local
 * Docker stack, and Docker Hub is unreachable from the network this project is
 * developed on. That is why these suites had never once been executed: the
 * only documented way to run them did not work here, so nobody ran them, and
 * they quietly rotted while the schema moved underneath.
 *
 * Each suite runs inside a transaction that is always rolled back, so this is
 * safe against the hosted project. Nothing it creates survives.
 *
 * Usage, from supabase/tests:
 *
 *   npm install
 *   npm test              runs every suite
 *   npm test 02           runs suites whose filename contains "02"
 *
 * Connection details come from the repository root .env, so no credentials are
 * passed on a command line or committed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES = path.join(HERE, 'database');
const ENV = path.join(HERE, '..', '..', '.env');

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, i).trim().replace(/^﻿/, '')] = v;
  }
  return out;
}

/**
 * Built from discrete parts rather than SUPABASE_DB_URL, because the password
 * embedded in that URL has drifted out of date with SUPABASE_DB_PASSWORD and
 * silently fails authentication.
 */
function clientConfig(env) {
  const ref = env.SUPABASE_PROJECT_REF;
  const password = env.SUPABASE_DB_PASSWORD;
  if (!ref || !password) {
    throw new Error(
      'SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD must be set in the repository root .env',
    );
  }
  return {
    host: env.SUPABASE_DB_HOST ?? 'aws-1-eu-west-1.pooler.supabase.com',
    port: Number(env.SUPABASE_DB_PORT ?? 5432),
    user: `postgres.${ref}`,
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  };
}

/**
 * pgTAP emits TAP: a plan line, then "ok N - name" or "not ok N - name".
 * Diagnostics arrive on lines beginning with #, and carry the reason a case
 * failed, so they are kept and attached to the failure they follow.
 *
 * A row is split on newlines before being read, because pgTAP returns a
 * failure and its diagnostics as one value: "not ok 8 - name" with the
 * "# Failed test" lines embedded after a newline. Matching that whole value
 * against a single line anchored pattern matched nothing, so every failing
 * test that explained itself was dropped from the report and only the plan
 * count disagreed. The failures this hid were real: a suite could report
 * "7/8 passed" while the case that failed was never named.
 */
function parseTap(rows) {
  const results = [];
  let plan = null;
  const lines = rows.flatMap((row) => String(row ?? '').split('\n'));
  for (const raw of lines) {
    const line = raw.trimEnd();
    const planMatch = /^1\.\.(\d+)$/.exec(line.trim());
    if (planMatch) {
      plan = Number(planMatch[1]);
      continue;
    }
    const caseMatch = /^(not ok|ok)\s+(\d+)\s*-?\s*(.*)$/.exec(line.trim());
    if (caseMatch) {
      results.push({
        ok: caseMatch[1] === 'ok',
        number: Number(caseMatch[2]),
        name: caseMatch[3] || '(unnamed)',
        diagnostics: [],
      });
      continue;
    }
    if (line.trim().startsWith('#') && results.length > 0) {
      results[results.length - 1].diagnostics.push(line.trim().replace(/^#\s?/, ''));
    }
  }
  return { plan, results };
}

async function runSuite(config, file) {
  const sql = fs.readFileSync(file, 'utf8');
  const client = new pg.Client(config);
  await client.connect();

  try {
    // The suites open their own transaction with begin/rollback. Running them
    // through a single simple query keeps that intact and returns every
    // result set, which is where the TAP output lives.
    const res = await client.query(sql);
    const sets = Array.isArray(res) ? res : [res];
    const lines = [];
    for (const set of sets) {
      for (const row of set.rows ?? []) {
        lines.push(Object.values(row)[0]);
      }
    }
    return parseTap(lines);
  } finally {
    // Belt and braces: if a suite threw before its own rollback, undo anyway.
    try {
      await client.query('rollback');
    } catch {
      /* no transaction open */
    }
    await client.end();
  }
}

const filter = process.argv[2] ?? '';
const files = fs
  .readdirSync(SUITES)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => f.includes(filter))
  .sort()
  .map((f) => path.join(SUITES, f));

if (files.length === 0) {
  console.error(`No suites in ${SUITES}${filter ? ` matching "${filter}"` : ''}`);
  process.exit(1);
}

const config = clientConfig(readEnv(ENV));
let failed = 0;
let total = 0;

for (const file of files) {
  const name = path.basename(file);
  process.stdout.write(`\n${name}\n`);

  let suite;
  try {
    suite = await runSuite(config, file);
  } catch (error) {
    console.error(`  SUITE ERROR  ${error.message.split('\n')[0]}`);
    failed += 1;
    continue;
  }

  for (const c of suite.results) {
    total += 1;
    if (c.ok) {
      console.log(`  ok    ${c.name}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${c.name}`);
      for (const d of c.diagnostics) console.log(`          ${d}`);
    }
  }

  if (suite.plan !== null && suite.plan !== suite.results.length) {
    failed += 1;
    console.log(`  FAIL  plan said ${suite.plan} tests, ${suite.results.length} ran`);
  }
  if (suite.results.length === 0) {
    console.log('  (no assertions produced output)');
  }
}

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
