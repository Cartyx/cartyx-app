import type { FeatureSection, MonsterSize } from './schemas/monsters';

export interface AbilityScore {
  score: number;
  mod: number;
  save: number;
}

export interface MonsterSpeed {
  kind: 'walk' | 'fly' | 'swim' | 'climb' | 'burrow';
  feet: number;
  notes: string;
}

export interface MonsterSkill {
  name: string;
  modifier: number;
}

export interface MonsterSense {
  name: string;
  range: number | null;
}

export interface MonsterFeature {
  section: FeatureSection;
  name: string;
  description: string;
}

export interface MonsterLink {
  name: string;
  url: string;
}

export interface MonsterCR {
  value: number;
  xp: number;
  proficiencyBonus: number;
}

export interface MonsterPictureCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonsterListItem {
  id: string;
  campaignId: string;
  createdBy: string;
  name: string;
  size: MonsterSize;
  type: string;
  subtype: string;
  alignment: string;
  cr: MonsterCR;
  picture: string;
  tags: string[];
  sessionId: string | null;
  color: string;
  source: 'srd' | 'custom';
  isHomebrew: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MonsterData extends MonsterListItem {
  armorClass: number;
  armorClassNote: string;
  hitPoints: { average: number; formula: string };
  initiativeMod: number;
  initiativePassive: number;
  speeds: MonsterSpeed[];
  abilities: {
    str: AbilityScore;
    dex: AbilityScore;
    con: AbilityScore;
    int: AbilityScore;
    wis: AbilityScore;
    cha: AbilityScore;
  };
  skills: MonsterSkill[];
  resistances: string[];
  immunities: string[];
  vulnerabilities: string[];
  conditionImmunities: string[];
  senses: MonsterSense[];
  passivePerception: number;
  languages: string[];
  features: MonsterFeature[];
  pictureCrop: MonsterPictureCrop | null;
  links: MonsterLink[];
  gmNotes: string;
}
