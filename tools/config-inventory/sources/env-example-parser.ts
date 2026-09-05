/**
 * Parses the committed `.env.example` into shape entries.
 *
 * This is PRESENTATION input only: it never establishes a variable's existence,
 * classification, or requiredness (those come from the canonical model). Section
 * headers use the `# --- Section Name ---` delimiter; the nearest preceding
 * header becomes an entry's `section`, and the nearest preceding non-header
 * comment becomes its documented `comment`.
 */

import { readFileSync } from 'node:fs';

/** A single variable declaration parsed from `.env.example`. */
export interface EnvExampleEntry {
  name: string;
  section: string; // from the nearest "# --- X ---" header
  placeholder: string; // the value after '='
  comment?: string; // inline/preceding comment
}

/** Matches a section header line: `# --- Section Name ---`. */
const SECTION_HEADER_PATTERN = /^#\s*---\s*(.+?)\s*---\s*$/;

/** Matches a `KEY=value` declaration line (KEY is a valid env identifier). */
const ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Matches a plain comment line (not a section header). */
const COMMENT_PATTERN = /^#\s?(.*)$/;

const NO_SECTION = 'ungrouped';

/**
 * Parse `.env.example` text into ordered shape entries.
 *
 * @param content - The full text of the `.env.example` file.
 * @returns One entry per `KEY=value` line, in file order.
 */
export function parseEnvExampleContent(content: string): EnvExampleEntry[] {
  const entries: EnvExampleEntry[] = [];
  const lines = content.split(/\r?\n/);

  let currentSection = NO_SECTION;
  let pendingComment: string | undefined;

  for (const line of lines) {
    const sectionMatch = SECTION_HEADER_PATTERN.exec(line);
    if (sectionMatch && sectionMatch[1] !== undefined) {
      currentSection = sectionMatch[1];
      pendingComment = undefined;
      continue;
    }

    const assignmentMatch = ASSIGNMENT_PATTERN.exec(line);
    if (assignmentMatch && assignmentMatch[1] !== undefined) {
      const name = assignmentMatch[1];
      const placeholder = assignmentMatch[2] ?? '';
      const entry: EnvExampleEntry = {
        name,
        section: currentSection,
        placeholder,
        ...(pendingComment !== undefined ? { comment: pendingComment } : {}),
      };
      entries.push(entry);
      pendingComment = undefined;
      continue;
    }

    const commentMatch = COMMENT_PATTERN.exec(line);
    if (commentMatch && commentMatch[1] !== undefined && commentMatch[1].trim().length > 0) {
      pendingComment = commentMatch[1].trim();
      continue;
    }

    // Blank line: reset any pending comment so it does not attach across gaps.
    if (line.trim().length === 0) {
      pendingComment = undefined;
    }
  }

  return entries;
}

/**
 * Read and parse a `.env.example` file from disk.
 *
 * @param path - Absolute path to the `.env.example` file.
 * @returns One entry per `KEY=value` line, in file order.
 */
export function parseEnvExample(path: string): EnvExampleEntry[] {
  return parseEnvExampleContent(readFileSync(path, 'utf8'));
}
