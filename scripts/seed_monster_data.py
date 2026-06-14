"""Hand-curated SRD-style monster stat blocks for the dev seed.

Roughly mirrors SRD 5.2.1 bestiary entries — enough breadth (small humanoid
to gargantuan dragon, beasts, fiends, undead, monstrosities) to exercise
every code path of the Monster collection and the future ruler/distance
tool that consumes size.  Full SRD extraction comes in the dedicated
extract-monsters phase; this is the smaller test set seeded into the
"stock" campaign.
"""

from urllib.parse import quote


def _avatar(name: str) -> str:
    """DiceBear `bottts` for monsters — deterministic, no R2 round-trip."""
    return f"https://api.dicebear.com/9.x/bottts/svg?seed={quote(name)}"


def _ability(score: int, save: int = 0) -> dict:
    """Shorthand: derive 5e modifier from score."""
    mod = (score - 10) // 2
    return {"score": score, "mod": mod, "save": save if save else mod}


def _walk(feet: int) -> list[dict]:
    return [{"kind": "walk", "feet": feet, "notes": ""}]


# Ring color by CR tier — green/blue/yellow/orange/red.
def _color_for_cr(cr: float) -> str:
    if cr < 3:
        return "#22c55e"  # green
    if cr < 6:
        return "#3b82f6"  # blue
    if cr < 11:
        return "#eab308"  # yellow
    if cr < 17:
        return "#f97316"  # orange
    return "#ef4444"  # red


# Each entry below is a partial; the seeder fills `campaignId`, `createdBy`,
# `createdAt`, `updatedAt`, `source='srd'`, and computes color from CR.

MONSTERS = [
    {
        "name": "Goblin",
        "size": "small",
        "type": "Humanoid",
        "subtype": "Goblinoid",
        "alignment": "Neutral Evil",
        "armorClass": 15,
        "armorClassNote": "leather armor, shield",
        "hitPoints": {"average": 7, "formula": "2d6"},
        "initiativeMod": 2,
        "initiativePassive": 12,
        "speeds": _walk(30),
        "abilities": {
            "str": _ability(8),
            "dex": _ability(14),
            "con": _ability(10),
            "int": _ability(10),
            "wis": _ability(8),
            "cha": _ability(8),
        },
        "skills": [{"name": "Stealth", "modifier": 6}],
        "passivePerception": 9,
        "languages": ["Common", "Goblin"],
        "cr": {"value": 0.25, "xp": 50, "proficiencyBonus": 2},
        "features": [
            {"section": "traits", "name": "Nimble Escape",
             "description": "The goblin can take the Disengage or Hide action as a bonus action on each of its turns."},
            {"section": "actions", "name": "Scimitar",
             "description": "Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6+2) Slashing damage."},
            {"section": "actions", "name": "Shortbow",
             "description": "Ranged Attack Roll: +4, range 80/320 ft. Hit: 5 (1d6+2) Piercing damage."},
        ],
        "tags": ["humanoid", "goblinoid", "low-level"],
    },
    {
        "name": "Orc",
        "size": "medium",
        "type": "Humanoid",
        "subtype": "Orc",
        "alignment": "Chaotic Evil",
        "armorClass": 13,
        "armorClassNote": "hide armor",
        "hitPoints": {"average": 15, "formula": "2d8+6"},
        "initiativeMod": 1,
        "initiativePassive": 10,
        "speeds": _walk(30),
        "abilities": {
            "str": _ability(16),
            "dex": _ability(12),
            "con": _ability(16),
            "int": _ability(7),
            "wis": _ability(11),
            "cha": _ability(10),
        },
        "skills": [{"name": "Intimidation", "modifier": 2}],
        "senses": [{"name": "Darkvision", "range": 60}],
        "passivePerception": 10,
        "languages": ["Common", "Orc"],
        "cr": {"value": 0.5, "xp": 100, "proficiencyBonus": 2},
        "features": [
            {"section": "traits", "name": "Aggressive",
             "description": "As a bonus action, the orc can move up to its speed toward a hostile creature it can see."},
            {"section": "actions", "name": "Greataxe",
             "description": "Melee Attack Roll: +5, reach 5 ft. Hit: 9 (1d12+3) Slashing damage."},
        ],
        "tags": ["humanoid", "orc", "warband"],
    },
    {
        "name": "Skeleton",
        "size": "medium",
        "type": "Undead",
        "subtype": "",
        "alignment": "Lawful Evil",
        "armorClass": 13,
        "armorClassNote": "armor scraps",
        "hitPoints": {"average": 13, "formula": "2d8+4"},
        "initiativeMod": 2,
        "initiativePassive": 12,
        "speeds": _walk(30),
        "abilities": {
            "str": _ability(10),
            "dex": _ability(14),
            "con": _ability(15),
            "int": _ability(6),
            "wis": _ability(8),
            "cha": _ability(5),
        },
        "vulnerabilities": ["bludgeoning"],
        "immunities": ["poison"],
        "conditionImmunities": ["exhaustion", "poisoned"],
        "senses": [{"name": "Darkvision", "range": 60}],
        "passivePerception": 9,
        "languages": ["understands Common but can't speak"],
        "cr": {"value": 0.25, "xp": 50, "proficiencyBonus": 2},
        "features": [
            {"section": "actions", "name": "Shortsword",
             "description": "Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6+2) Piercing damage."},
            {"section": "actions", "name": "Shortbow",
             "description": "Ranged Attack Roll: +4, range 80/320 ft. Hit: 5 (1d6+2) Piercing damage."},
        ],
        "tags": ["undead", "low-level"],
    },
    {
        "name": "Wolf",
        "size": "medium",
        "type": "Beast",
        "subtype": "",
        "alignment": "Unaligned",
        "armorClass": 13,
        "armorClassNote": "natural armor",
        "hitPoints": {"average": 11, "formula": "2d8+2"},
        "initiativeMod": 2,
        "initiativePassive": 13,
        "speeds": _walk(40),
        "abilities": {
            "str": _ability(12),
            "dex": _ability(15),
            "con": _ability(12),
            "int": _ability(3),
            "wis": _ability(12),
            "cha": _ability(6),
        },
        "skills": [
            {"name": "Perception", "modifier": 3},
            {"name": "Stealth", "modifier": 4},
        ],
        "passivePerception": 13,
        "cr": {"value": 0.25, "xp": 50, "proficiencyBonus": 2},
        "features": [
            {"section": "traits", "name": "Keen Hearing and Smell",
             "description": "The wolf has advantage on Wisdom (Perception) checks that rely on hearing or smell."},
            {"section": "traits", "name": "Pack Tactics",
             "description": "The wolf has advantage on an attack roll against a creature if at least one of the wolf’s allies is within 5 feet of the creature."},
            {"section": "actions", "name": "Bite",
             "description": "Melee Attack Roll: +4, reach 5 ft. Hit: 7 (2d4+2) Piercing damage. The target must succeed on a DC 11 Strength save or be knocked prone."},
        ],
        "tags": ["beast", "pack"],
    },
    {
        "name": "Brown Bear",
        "size": "large",
        "type": "Beast",
        "subtype": "",
        "alignment": "Unaligned",
        "armorClass": 11,
        "armorClassNote": "natural armor",
        "hitPoints": {"average": 34, "formula": "4d10+12"},
        "initiativeMod": 0,
        "initiativePassive": 13,
        "speeds": [
            {"kind": "walk", "feet": 40, "notes": ""},
            {"kind": "climb", "feet": 30, "notes": ""},
        ],
        "abilities": {
            "str": _ability(19),
            "dex": _ability(10),
            "con": _ability(16),
            "int": _ability(2),
            "wis": _ability(13),
            "cha": _ability(7),
        },
        "skills": [{"name": "Perception", "modifier": 3}],
        "senses": [{"name": "Keen Smell", "range": None}],
        "passivePerception": 13,
        "cr": {"value": 1, "xp": 200, "proficiencyBonus": 2},
        "features": [
            {"section": "actions", "name": "Multiattack",
             "description": "The bear makes two attacks: one with its bite and one with its claws."},
            {"section": "actions", "name": "Bite",
             "description": "Melee Attack Roll: +5, reach 5 ft. Hit: 8 (1d8+4) Piercing damage."},
            {"section": "actions", "name": "Claws",
             "description": "Melee Attack Roll: +5, reach 5 ft. Hit: 11 (2d6+4) Slashing damage."},
        ],
        "tags": ["beast"],
    },
    {
        "name": "Sprite",
        "size": "tiny",
        "type": "Fey",
        "subtype": "",
        "alignment": "Neutral Good",
        "armorClass": 15,
        "armorClassNote": "leaf armor",
        "hitPoints": {"average": 2, "formula": "1d4"},
        "initiativeMod": 4,
        "initiativePassive": 14,
        "speeds": [
            {"kind": "walk", "feet": 10, "notes": ""},
            {"kind": "fly", "feet": 40, "notes": ""},
        ],
        "abilities": {
            "str": _ability(3),
            "dex": _ability(18),
            "con": _ability(10),
            "int": _ability(14),
            "wis": _ability(13),
            "cha": _ability(11),
        },
        "skills": [
            {"name": "Perception", "modifier": 3},
            {"name": "Stealth", "modifier": 8},
        ],
        "passivePerception": 13,
        "languages": ["Common", "Elvish", "Sylvan"],
        "cr": {"value": 0.25, "xp": 50, "proficiencyBonus": 2},
        "features": [
            {"section": "actions", "name": "Longsword",
             "description": "Melee Attack Roll: +2, reach 5 ft. Hit: 1 Slashing damage."},
            {"section": "actions", "name": "Shortbow",
             "description": "Ranged Attack Roll: +6, range 40/160 ft. Hit: 1 Piercing damage and target makes a DC 10 Constitution save or sleeps for 1 minute."},
        ],
        "tags": ["fey", "tiny"],
    },
    {
        "name": "Bandit",
        "size": "medium",
        "type": "Humanoid",
        "subtype": "any race",
        "alignment": "any non-lawful",
        "armorClass": 12,
        "armorClassNote": "leather armor",
        "hitPoints": {"average": 11, "formula": "2d8+2"},
        "initiativeMod": 1,
        "initiativePassive": 10,
        "speeds": _walk(30),
        "abilities": {
            "str": _ability(11),
            "dex": _ability(12),
            "con": _ability(12),
            "int": _ability(10),
            "wis": _ability(10),
            "cha": _ability(10),
        },
        "passivePerception": 10,
        "languages": ["any one (usually Common)"],
        "cr": {"value": 0.125, "xp": 25, "proficiencyBonus": 2},
        "features": [
            {"section": "actions", "name": "Scimitar",
             "description": "Melee Attack Roll: +3, reach 5 ft. Hit: 4 (1d6+1) Slashing damage."},
            {"section": "actions", "name": "Light Crossbow",
             "description": "Ranged Attack Roll: +3, range 80/320 ft. Hit: 5 (1d8+1) Piercing damage."},
        ],
        "tags": ["humanoid", "encounter"],
    },
    {
        "name": "Owlbear",
        "size": "large",
        "type": "Monstrosity",
        "subtype": "",
        "alignment": "Unaligned",
        "armorClass": 13,
        "armorClassNote": "natural armor",
        "hitPoints": {"average": 59, "formula": "7d10+21"},
        "initiativeMod": 1,
        "initiativePassive": 13,
        "speeds": _walk(40),
        "abilities": {
            "str": _ability(20),
            "dex": _ability(12),
            "con": _ability(17),
            "int": _ability(3),
            "wis": _ability(12),
            "cha": _ability(7),
        },
        "skills": [{"name": "Perception", "modifier": 3}],
        "senses": [
            {"name": "Darkvision", "range": 60},
            {"name": "Keen Sight and Smell", "range": None},
        ],
        "passivePerception": 13,
        "cr": {"value": 3, "xp": 700, "proficiencyBonus": 2},
        "features": [
            {"section": "actions", "name": "Multiattack",
             "description": "The owlbear makes two attacks: one with its beak and one with its claws."},
            {"section": "actions", "name": "Beak",
             "description": "Melee Attack Roll: +7, reach 5 ft. Hit: 10 (1d10+5) Piercing damage."},
            {"section": "actions", "name": "Claws",
             "description": "Melee Attack Roll: +7, reach 5 ft. Hit: 14 (2d8+5) Slashing damage."},
        ],
        "tags": ["monstrosity", "wilderness"],
    },
    {
        "name": "Imp",
        "size": "tiny",
        "type": "Fiend",
        "subtype": "Devil",
        "alignment": "Lawful Evil",
        "armorClass": 13,
        "hitPoints": {"average": 10, "formula": "3d4+3"},
        "initiativeMod": 3,
        "initiativePassive": 13,
        "speeds": [
            {"kind": "walk", "feet": 20, "notes": ""},
            {"kind": "fly", "feet": 40, "notes": ""},
        ],
        "abilities": {
            "str": _ability(6),
            "dex": _ability(17),
            "con": _ability(13),
            "int": _ability(11),
            "wis": _ability(12),
            "cha": _ability(14),
        },
        "skills": [
            {"name": "Deception", "modifier": 4},
            {"name": "Insight", "modifier": 3},
            {"name": "Persuasion", "modifier": 4},
            {"name": "Stealth", "modifier": 5},
        ],
        "resistances": ["cold"],
        "immunities": ["fire", "poison"],
        "conditionImmunities": ["poisoned"],
        "senses": [
            {"name": "Darkvision", "range": 120},
            {"name": "Magic Resistance", "range": None},
        ],
        "passivePerception": 11,
        "languages": ["Common", "Infernal"],
        "cr": {"value": 1, "xp": 200, "proficiencyBonus": 2},
        "features": [
            {"section": "traits", "name": "Shapechanger",
             "description": "The imp can use its action to polymorph into a beast form or back into its true form."},
            {"section": "actions", "name": "Sting (Bite in Beast Form)",
             "description": "Melee Attack Roll: +5, reach 5 ft. Hit: 5 (1d4+3) Piercing damage plus 7 (2d6) Poison damage."},
        ],
        "tags": ["fiend", "devil"],
    },
    {
        "name": "Ogre",
        "size": "large",
        "type": "Giant",
        "subtype": "",
        "alignment": "Chaotic Evil",
        "armorClass": 11,
        "armorClassNote": "hide armor",
        "hitPoints": {"average": 59, "formula": "7d10+21"},
        "initiativeMod": -1,
        "initiativePassive": 8,
        "speeds": _walk(40),
        "abilities": {
            "str": _ability(19),
            "dex": _ability(8),
            "con": _ability(16),
            "int": _ability(5),
            "wis": _ability(7),
            "cha": _ability(7),
        },
        "senses": [{"name": "Darkvision", "range": 60}],
        "passivePerception": 8,
        "languages": ["Common", "Giant"],
        "cr": {"value": 2, "xp": 450, "proficiencyBonus": 2},
        "features": [
            {"section": "actions", "name": "Greatclub",
             "description": "Melee Attack Roll: +6, reach 5 ft. Hit: 13 (2d8+4) Bludgeoning damage."},
            {"section": "actions", "name": "Javelin",
             "description": "Melee or Ranged Attack Roll: +6, reach 5 ft. or range 30/120 ft. Hit: 11 (2d6+4) Piercing damage."},
        ],
        "tags": ["giant", "wilderness"],
    },
    {
        "name": "Hill Giant",
        "size": "huge",
        "type": "Giant",
        "subtype": "",
        "alignment": "Chaotic Evil",
        "armorClass": 13,
        "armorClassNote": "natural armor",
        "hitPoints": {"average": 105, "formula": "10d12+40"},
        "initiativeMod": -1,
        "initiativePassive": 12,
        "speeds": _walk(40),
        "abilities": {
            "str": _ability(21),
            "dex": _ability(8),
            "con": _ability(19),
            "int": _ability(5),
            "wis": _ability(9),
            "cha": _ability(6),
        },
        "skills": [{"name": "Perception", "modifier": 2}],
        "passivePerception": 12,
        "languages": ["Giant"],
        "cr": {"value": 5, "xp": 1800, "proficiencyBonus": 3},
        "features": [
            {"section": "actions", "name": "Multiattack",
             "description": "The giant makes two greatclub attacks."},
            {"section": "actions", "name": "Greatclub",
             "description": "Melee Attack Roll: +8, reach 10 ft. Hit: 18 (3d8+5) Bludgeoning damage."},
            {"section": "actions", "name": "Rock",
             "description": "Ranged Attack Roll: +8, range 60/240 ft. Hit: 21 (3d10+5) Bludgeoning damage."},
        ],
        "tags": ["giant", "hill-giant", "boss"],
    },
    {
        "name": "Young Red Dragon",
        "size": "large",
        "type": "Dragon",
        "subtype": "Chromatic",
        "alignment": "Chaotic Evil",
        "armorClass": 18,
        "armorClassNote": "natural armor",
        "hitPoints": {"average": 178, "formula": "17d10+85"},
        "initiativeMod": 0,
        "initiativePassive": 18,
        "speeds": [
            {"kind": "walk", "feet": 40, "notes": ""},
            {"kind": "climb", "feet": 40, "notes": ""},
            {"kind": "fly", "feet": 80, "notes": ""},
        ],
        "abilities": {
            "str": _ability(23, 6),
            "dex": _ability(10, 4),
            "con": _ability(21, 9),
            "int": _ability(14),
            "wis": _ability(11, 4),
            "cha": _ability(19),
        },
        "skills": [
            {"name": "Perception", "modifier": 8},
            {"name": "Stealth", "modifier": 4},
        ],
        "immunities": ["fire"],
        "senses": [
            {"name": "Blindsight", "range": 30},
            {"name": "Darkvision", "range": 120},
        ],
        "passivePerception": 18,
        "languages": ["Common", "Draconic"],
        "cr": {"value": 10, "xp": 5900, "proficiencyBonus": 4},
        "features": [
            {"section": "actions", "name": "Multiattack",
             "description": "The dragon makes three attacks: one with its bite and two with its claws."},
            {"section": "actions", "name": "Bite",
             "description": "Melee Attack Roll: +10, reach 10 ft. Hit: 17 (2d10+6) Piercing damage plus 3 (1d6) Fire damage."},
            {"section": "actions", "name": "Claw",
             "description": "Melee Attack Roll: +10, reach 5 ft. Hit: 13 (2d6+6) Slashing damage."},
            {"section": "actions", "name": "Fire Breath (Recharge 5–6)",
             "description": "30-foot cone. Each creature in the cone makes a DC 17 Dexterity save, taking 56 (16d6) Fire damage on a failure, half as much on a success."},
        ],
        "tags": ["dragon", "boss", "chromatic"],
    },
    {
        "name": "Beholder",
        "size": "large",
        "type": "Aberration",
        "subtype": "",
        "alignment": "Lawful Evil",
        "armorClass": 18,
        "armorClassNote": "natural armor",
        "hitPoints": {"average": 180, "formula": "19d10+76"},
        "initiativeMod": 2,
        "initiativePassive": 22,
        "speeds": [
            {"kind": "walk", "feet": 0, "notes": ""},
            {"kind": "fly", "feet": 20, "notes": "hover"},
        ],
        "abilities": {
            "str": _ability(10),
            "dex": _ability(14),
            "con": _ability(18, 8),
            "int": _ability(17, 8),
            "wis": _ability(15, 7),
            "cha": _ability(17),
        },
        "skills": [{"name": "Perception", "modifier": 12}],
        "conditionImmunities": ["prone"],
        "senses": [{"name": "Darkvision", "range": 120}],
        "passivePerception": 22,
        "languages": ["Deep Speech", "Undercommon"],
        "cr": {"value": 13, "xp": 10000, "proficiencyBonus": 5},
        "features": [
            {"section": "traits", "name": "Antimagic Cone",
             "description": "The beholder's central eye creates a 150-foot Cone of antimagic in front of it. Spells and magical effects don't function in the Cone."},
            {"section": "actions", "name": "Bite",
             "description": "Melee Attack Roll: +5, reach 5 ft. Hit: 14 (4d6) Piercing damage."},
            {"section": "actions", "name": "Eye Rays",
             "description": "The beholder shoots 3 of the following random eye rays (reroll duplicates), each at a different target within 120 feet (full text omitted for brevity in the sample data)."},
        ],
        "tags": ["aberration", "boss", "iconic"],
    },
    {
        "name": "Ancient Black Dragon",
        "size": "gargantuan",
        "type": "Dragon",
        "subtype": "Chromatic",
        "alignment": "Chaotic Evil",
        "armorClass": 22,
        "armorClassNote": "natural armor",
        "hitPoints": {"average": 367, "formula": "21d20+147"},
        "initiativeMod": 2,
        "initiativePassive": 26,
        "speeds": [
            {"kind": "walk", "feet": 40, "notes": ""},
            {"kind": "fly", "feet": 80, "notes": ""},
            {"kind": "swim", "feet": 40, "notes": ""},
        ],
        "abilities": {
            "str": _ability(27, 8),
            "dex": _ability(14, 9),
            "con": _ability(25, 13),
            "int": _ability(16),
            "wis": _ability(15, 8),
            "cha": _ability(19),
        },
        "skills": [
            {"name": "Perception", "modifier": 16},
            {"name": "Stealth", "modifier": 9},
        ],
        "immunities": ["acid"],
        "senses": [
            {"name": "Blindsight", "range": 60},
            {"name": "Darkvision", "range": 120},
        ],
        "passivePerception": 26,
        "languages": ["Common", "Draconic"],
        "cr": {"value": 21, "xp": 33000, "proficiencyBonus": 7},
        "features": [
            {"section": "actions", "name": "Multiattack",
             "description": "The dragon makes three attacks: one with its bite and two with its claws."},
            {"section": "actions", "name": "Bite",
             "description": "Melee Attack Roll: +15, reach 15 ft. Hit: 19 (2d10+8) Piercing damage plus 9 (2d8) Acid damage."},
            {"section": "actions", "name": "Acid Breath (Recharge 5–6)",
             "description": "90-foot line, 10 feet wide. Each creature in the line makes a DC 22 Dexterity save, taking 67 (15d8) Acid damage on a failure, half as much on a success."},
            {"section": "legendaryActions", "name": "Detect",
             "description": "The dragon makes a Wisdom (Perception) check."},
            {"section": "legendaryActions", "name": "Wing Attack (Costs 2)",
             "description": "The dragon beats its wings; each creature within 15 feet makes a DC 23 Dex save or takes 15 (2d6+8) Bludgeoning damage and is knocked prone."},
        ],
        "tags": ["dragon", "boss", "ancient", "chromatic"],
    },
    {
        "name": "Zombie",
        "size": "medium",
        "type": "Undead",
        "subtype": "",
        "alignment": "Neutral Evil",
        "armorClass": 8,
        "hitPoints": {"average": 22, "formula": "3d8+9"},
        "initiativeMod": -2,
        "initiativePassive": 8,
        "speeds": _walk(20),
        "abilities": {
            "str": _ability(13),
            "dex": _ability(6),
            "con": _ability(16),
            "int": _ability(3),
            "wis": _ability(6, 0),
            "cha": _ability(5),
        },
        "immunities": ["poison"],
        "conditionImmunities": ["poisoned"],
        "senses": [{"name": "Darkvision", "range": 60}],
        "passivePerception": 8,
        "languages": ["understands the languages it knew in life but can't speak"],
        "cr": {"value": 0.25, "xp": 50, "proficiencyBonus": 2},
        "features": [
            {"section": "traits", "name": "Undead Fortitude",
             "description": "If damage reduces the zombie to 0 hit points, it must make a Constitution save (DC 5 + damage). On a success, it drops to 1 hit point instead."},
            {"section": "actions", "name": "Slam",
             "description": "Melee Attack Roll: +3, reach 5 ft. Hit: 4 (1d6+1) Bludgeoning damage."},
        ],
        "tags": ["undead"],
    },
]


_VARIANT_SUFFIXES = [
    ("Scout", -0.25, ["scout"]),
    ("Veteran", 1.0, ["veteran"]),
    ("Berserker", 1.0, ["berserker"]),
    ("Captain", 1.5, ["captain", "elite"]),
    ("Champion", 2.0, ["champion", "elite", "boss"]),
    ("Spellcaster", 1.5, ["spellcaster"]),
    ("Shaman", 1.5, ["shaman", "caster"]),
    ("Marauder", 0.5, ["marauder"]),
    ("Hunter", 0.25, ["hunter"]),
    ("Brute", 1.0, ["brute"]),
    ("Outrider", 0.5, ["outrider", "mounted"]),
    ("Sentry", -0.25, ["sentry"]),
    ("Warlord", 2.5, ["warlord", "boss"]),
    ("Acolyte", 0.25, ["acolyte"]),
    ("Initiate", 0.0, ["initiate"]),
    ("Elder", 2.0, ["elder", "ancient"]),
    ("Wraith", 1.5, ["wraith"]),
    ("Renegade", 1.0, ["renegade"]),
]


def _variants_of(spec: dict, n: int) -> list[dict]:
    """Produce `n` named variants of a base monster spec, with mild stat bumps.

    Variants reuse the parent's features/abilities and bump HP+CR by the
    suffix's offset. Keeps the data shape valid while providing volume for
    stress-testing list rendering, search, drag-drop, and filters.
    """
    out = []
    base_cr = spec["cr"]["value"]
    base_hp_avg = spec["hitPoints"]["average"]
    base_hp_formula = spec["hitPoints"]["formula"]
    for i in range(n):
        suffix, cr_delta, extra_tags = _VARIANT_SUFFIXES[i % len(_VARIANT_SUFFIXES)]
        new_cr = max(0.0, base_cr + cr_delta)
        scale = 1.0 + cr_delta * 0.4
        v = dict(spec)
        v["name"] = f"{spec['name']} {suffix}"
        v["cr"] = {
            "value": new_cr,
            "xp": int((spec["cr"]["xp"] or 50) * max(1.0, scale)),
            "proficiencyBonus": spec["cr"].get("proficiencyBonus", 2),
        }
        v["hitPoints"] = {
            "average": max(1, int(base_hp_avg * max(0.4, scale))),
            "formula": base_hp_formula,
        }
        v["tags"] = list(spec.get("tags", [])) + extra_tags
        out.append(v)
    return out


def all_monster_specs() -> list[dict]:
    """Combine hand-authored monsters with variants for volume."""
    variants_per_base = 9  # 15 base × 9 variants ≈ 135 monsters in total
    out = list(MONSTERS)
    for spec in MONSTERS:
        out.extend(_variants_of(spec, variants_per_base))
    return out


def build_monster_docs(*, campaign_id, gm_id, now, with_variants: bool = False) -> list[dict]:
    """Return full mongoose-shaped Monster documents ready for insertMany.

    When `with_variants=True`, expands each hand-authored stat block into
    multiple lightly-modified variants for volume-testing the wiki list,
    search, and tag/CR filters.
    """
    specs = all_monster_specs() if with_variants else MONSTERS
    docs = []
    for spec in specs:
        cr_value = spec["cr"]["value"]
        # Default fields not in the spec, populated to match the schema.
        doc = {
            "name": spec["name"],
            "size": spec["size"],
            "type": spec.get("type", ""),
            "subtype": spec.get("subtype", ""),
            "alignment": spec.get("alignment", ""),
            "armorClass": spec.get("armorClass", 10),
            "armorClassNote": spec.get("armorClassNote", ""),
            "hitPoints": spec["hitPoints"],
            "initiativeMod": spec.get("initiativeMod", 0),
            "initiativePassive": spec.get("initiativePassive", 10),
            "speeds": spec.get("speeds", []),
            "abilities": spec["abilities"],
            "skills": spec.get("skills", []),
            "resistances": spec.get("resistances", []),
            "immunities": spec.get("immunities", []),
            "vulnerabilities": spec.get("vulnerabilities", []),
            "conditionImmunities": spec.get("conditionImmunities", []),
            "senses": spec.get("senses", []),
            "passivePerception": spec.get("passivePerception", 10),
            "languages": spec.get("languages", []),
            "cr": spec["cr"],
            "features": spec.get("features", []),
            "picture": _avatar(spec["name"]),
            "pictureCrop": None,
            "links": [
                {"name": "D&D Beyond",
                 "url": f"https://www.dndbeyond.com/monsters/{spec['name'].lower().replace(' ', '-')}"},
            ],
            "gmNotes": "",
            "tags": spec.get("tags", []),
            "sessionId": None,
            "color": _color_for_cr(cr_value),
            "source": "srd",
            "isHomebrew": False,
            "campaignId": campaign_id,
            "createdBy": gm_id,
            "createdAt": now,
            "updatedAt": now,
        }
        docs.append(doc)
    return docs
