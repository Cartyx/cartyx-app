"""Reference data for player-character generation in the dev seed.

Hand-picked fantasy names + classes + race + a few backstory hooks.  Kept in
its own module so dev_seed.py stays focused on insertion logic, and so the
sample set is easy to expand later.
"""

import random

# 4 player accounts referenced by email; the dev seed finds-or-creates each.
PLAYER_EMAILS = [
    "cartyx.player1@gmail.com",
    "alabeauai@gmail.com",
    "costoda@gmail.com",
    "aalabeau@gmail.com",
]

# 12 unique player portraits (3 campaigns x 4 players). Each player document
# in each campaign gets a different image so portraits never repeat.
PLAYER_IMAGES = [f"/uploads/seed-players/player{i}.jpg" for i in range(1, 13)]

FIRST_NAMES = [
    "Aelar", "Branwen", "Caelum", "Dain", "Elenya", "Faelan", "Galen",
    "Hespera", "Idril", "Jorund", "Kael", "Lirien", "Mardas", "Niven",
    "Oryn", "Perrin", "Quintessa", "Roran", "Sela", "Talen", "Ulric",
    "Vyra", "Wren", "Xanthe", "Yara", "Zephyr",
]
LAST_NAMES = [
    "Stormwind", "Ashvale", "Brightblade", "Cinderfell", "Darkmantle",
    "Emberheart", "Frostgale", "Greymoor", "Hollowbrook", "Ironwood",
    "Joradin", "Kelvane", "Loreweaver", "Moonshadow", "Nightingale",
    "Oakenshield", "Pyrebrook", "Quicksilver", "Ravencroft", "Stormrider",
    "Thornfield", "Valehart", "Winterborn", "Yewfeather",
]
RACES = [
    "Human", "Elf", "Half-Elf", "Dwarf", "Halfling", "Tiefling",
    "Dragonborn", "Gnome", "Half-Orc", "Aasimar", "Genasi", "Tabaxi",
]
CLASSES = [
    "Fighter", "Wizard", "Rogue", "Cleric", "Bard", "Barbarian",
    "Druid", "Monk", "Paladin", "Ranger", "Sorcerer", "Warlock",
]
BACKSTORIES = [
    "Sole survivor of a forgotten northern village, now seeking the truth.",
    "Disgraced noble exiled for refusing to enforce a cruel decree.",
    "Former temple acolyte who lost their faith after a vision.",
    "Bounty hunter retired after one mark turned out to be innocent.",
    "Self-taught mage whose first spell saved their family from raiders.",
    "Pirate's child raised on coastal taverns and bedtime sea-shanties.",
    "Apprentice to a vanished archmage, now hunting for them.",
    "Captured at twelve and raised by mountain bandits before escaping.",
    "Royal courier turned freelancer after delivering a war declaration.",
    "Last initiate of an order destroyed by political intrigue.",
    "Worked as a circus performer until the menagerie collapsed.",
    "Heir to a crumbling estate kept solvent by adventure profits.",
]
COLORS = [
    "#3498db", "#9b59b6", "#e67e22", "#16a085", "#e74c3c", "#f1c40f",
    "#1abc9c", "#34495e", "#d35400", "#27ae60", "#c0392b", "#2980b9",
]


def random_pc(rng: random.Random) -> dict:
    """One randomised PC: first/last name, race, class, color, backstory."""
    return {
        "firstName": rng.choice(FIRST_NAMES),
        "lastName": rng.choice(LAST_NAMES),
        "race": rng.choice(RACES),
        "characterClass": rng.choice(CLASSES),
        "color": rng.choice(COLORS),
        "backstory": rng.choice(BACKSTORIES),
    }
