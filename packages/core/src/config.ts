import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where Boulot remembers which folder is yours.
 *
 * Without this the app defaults to `~/Boulot` and there is no way to say "I
 * already have one somewhere else" except by setting an environment variable on
 * every launch. Anyone with an existing vault gets offered a fresh empty one
 * instead of their own career, which is the worst possible first impression for
 * the person most likely to have opinions about it.
 *
 * Deliberately not stored in the vault. A pointer that lives inside the thing it
 * points at cannot be found before you know where the thing is.
 */

export interface BoulotConfig {
  /** Absolute path to the folder holding one directory per person. */
  vault: string;
  /**
   * Which person's folder to open.
   *
   * Pinned rather than inferred. A vault can hold more than one career, and
   * alphabetical order is not a sensible way to choose whose CV to edit: it
   * opened on the wrong person's board and would have offered to write into it.
   */
  person: string | null;
}

export function configDir(): string {
  return join(homedir(), ".boulot");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function readConfig(): Partial<BoulotConfig> {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    // A corrupt config must never stop the app booting. Falling back to the
    // default folder is recoverable; refusing to start is not.
    return {};
  }
}

export function writeConfig(patch: Partial<BoulotConfig>): BoulotConfig {
  mkdirSync(configDir(), { recursive: true });
  const next = { ...readConfig(), ...patch } as BoulotConfig;
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

/** The default when nothing has been chosen yet. */
export function defaultVault(): string {
  return join(homedir(), "Boulot");
}

/**
 * Resolve the vault to open, in order of how explicit the instruction was.
 *
 * An environment variable is someone typing it right now, so it wins. A saved
 * config is someone having chosen once. The default is a guess.
 */
export function resolveVault(env = process.env): string {
  return env.BOULOT_VAULT ?? readConfig().vault ?? defaultVault();
}

export function resolvePerson(env = process.env): string | null {
  return env.BOULOT_PERSON ?? readConfig().person ?? null;
}
