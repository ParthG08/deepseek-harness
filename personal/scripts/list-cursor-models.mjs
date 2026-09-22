#!/usr/bin/env node
/**
 * List the Cursor models the signed-in account can actually use.
 *
 * dsh-cursor-subscription discovers models live through Cursor's unary
 * `agent.v1.AgentService/GetUsableModels` and only falls back to a hard-coded
 * array when that call fails. This script performs the same read-only call so
 * the real list can be inspected without launching dsh or opening the Web UI.
 *
 * It never prints or copies the OAuth credentials: the access token is read
 * from dsh's credential store, used for one request, and dropped. The script
 * also refuses to run when the stored access token has expired, because
 * refreshing would rotate credentials — sign in through dsh instead.
 *
 * Usage:
 *   node personal/scripts/list-cursor-models.mjs [--filter <substr>]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const PROFILE = process.env.DSH_PROFILE ?? "web";
const PROFILE_DIR = join(DSH_HOME, "profiles", PROFILE);
const CREDENTIALS = join(DSH_HOME, ".credentials.yaml");
const CREDENTIAL_REF = "CURSOR_SUBSCRIPTION_OAUTH";

const PLUGIN_ENTRY = join(PROFILE_DIR, "node_modules", "dsh-cursor-subscription", "lib", "index.js");

function findYaml() {
  const candidates = [
    join(DSH_HOME, "profiles", "node_modules", "yaml", "dist", "index.js"),
    join(PROFILE_DIR, "node_modules", "yaml", "dist", "index.js"),
  ];
  for (const path of candidates) {
    try {
      readFileSync(path);
      return path;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("the `yaml` package was not found; run this from a machine with a dsh profile installed");
}

function readCredential(parse) {
  const doc = parse(readFileSync(CREDENTIALS, "utf8"));
  const raw = doc?.refs?.[CREDENTIAL_REF];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`no ${CREDENTIAL_REF} credential stored — sign in via Settings -> Cursor Subscription`);
  }
  const credential = JSON.parse(raw);
  if (credential?.type !== "oauth" || typeof credential.access !== "string") {
    throw new Error(`${CREDENTIAL_REF} is not a Cursor OAuth credential`);
  }
  return credential;
}

const filterArg = process.argv.indexOf("--filter");
const filter = filterArg === -1 ? undefined : process.argv[filterArg + 1]?.toLowerCase();

const { parse } = await import(findYaml());
const credential = readCredential(parse);
if (!(credential.expires > Date.now())) {
  throw new Error(
    "the stored Cursor access token has expired — open dsh and sign in again so it can refresh (this script never refreshes, to avoid rotating credentials)",
  );
}

const { fetchUsableModels } = await import(PLUGIN_ENTRY);
const models = await fetchUsableModels(credential.access);

const shown = filter === undefined
  ? models
  : models.filter((m) => m.id.toLowerCase().includes(filter) || (m.name ?? "").toLowerCase().includes(filter));

console.log(`${shown.length} of ${models.length} models available to this Cursor account:\n`);
for (const m of shown) {
  const alias = m.displayModelId && m.displayModelId !== m.id ? `  (display: ${m.displayModelId})` : "";
  console.log(`  ${m.id.padEnd(40)} ${m.name ?? ""}${alias}`);
}
