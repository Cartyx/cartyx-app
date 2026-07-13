import type { ClientSession } from 'mongoose';
import { Spell } from '../db/models/Spell';
import { Race } from '../db/models/Race';
import { Rule } from '../db/models/Rule';
import { getSrdSpells, getSrdRaces, getSrdRules } from '../data/srd';

interface ImportArgs {
  campaignId: string;
  gmId: string;
  session?: ClientSession;
}

/**
 * Insert all bundled SRD 5.2.1 content (spells, races, rules) into a campaign.
 * Spells are marked source:'srd' (read-only); races/rules match the dev-seed shape.
 * Runs inside the caller's Mongo session when provided so it commits atomically
 * with campaign creation.
 */
export async function importSrdContent({ campaignId, gmId, session }: ImportArgs) {
  const now = new Date();
  const opts = session ? { session } : {};

  const spellDocs = getSrdSpells().map((s) => ({
    ...s,
    source: 'srd' as const,
    campaignId,
    createdBy: gmId,
    createdAt: now,
    updatedAt: now,
  }));
  const raceDocs = getSrdRaces().map((r) => ({
    ...r,
    campaignId,
    createdBy: gmId,
    createdAt: now,
    updatedAt: now,
  }));
  const ruleDocs = getSrdRules().map((r) => ({
    ...r,
    isPublic: true,
    campaignId,
    createdBy: gmId,
    createdAt: now,
    updatedAt: now,
  }));

  if (spellDocs.length) await Spell.insertMany(spellDocs, opts);
  if (raceDocs.length) await Race.insertMany(raceDocs, opts);
  if (ruleDocs.length) await Rule.insertMany(ruleDocs, opts);

  return { spells: spellDocs.length, races: raceDocs.length, rules: ruleDocs.length };
}
