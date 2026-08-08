#!/usr/bin/env python3
"""
Albiondle data builder
=======================
Reads Albion Online's official dump files and emits `data.js` (MAPS + ABILITIES).

Required inputs (from https://github.com/ao-data/ao-bin-dumps):
    cluster/world.xml   -> black-zone maps
    items.xml           -> which spells belong to which weapon/armor
    spells.xml          -> spell mechanics (damage school, effects, cooldown, cast)
    localization.xml    -> ability names, descriptions, and the [dmg]/[cc]/... tags

Usage:
    python build_data.py --src ./game_data --outdir .
    python build_data.py --download          # fetch missing dumps into ./game_data first

Outputs two readable JSON files (one record per line):
    maps.json        (276 black-zone maps)
    abilities.json   (active weapon + armor abilities)

Everything you'll want to tweak lives in the CONFIG block below.
"""

import re, json, argparse, os, sys, urllib.request
from collections import Counter, defaultdict, deque

# ============================================================================
# CONFIG  — iterate here
# ============================================================================

RAW_BASE = "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/"
DUMP_FILES = {                       # local name -> path in the repo
    "world.xml":        "cluster/world.xml",
    "items.xml":        "items.xml",
    "spells.xml":       "spells.xml",
    "localization.xml": "localization.xml",
}

# --- maps ---
BLACK_TYPES = {f"OPENPVP_BLACK_{i}" for i in range(1, 7)}   # quality band = the suffix 1..6
BIOME = {"SW": "Swamp", "MN": "Mountain", "HL": "Highland", "FR": "Forest", "ST": "Steppe"}
SMUGGLER_MARKERS = {"LevelMarker_Smugglers_Den", "smuggler_marketplace", "WORLDMAP_MARKER_SMUGGLERS_DEN"}
# feature -> how it is detected (see build_maps)
#   Static Dungeon : an exit with targettype="DungeonGroup"  (group statics only)
#   Castle         : minimap marker  "Castle"
#   Outpost        : minimap marker  "Castle_Outpost"
#   Smuggler's Den : any SMUGGLER_MARKERS marker

# --- weapon lines ---
WEAPON_LINE_NAMES = {
    "sword":"Sword","axe":"Axe","mace":"Mace","hammer":"Hammer","crossbow":"Crossbow",
    "bow":"Bow","spear":"Spear","dagger":"Dagger","quarterstaff":"Quarterstaff","knuckles":"War Gloves",
    "firestaff":"Fire Staff","froststaff":"Frost Staff","arcanestaff":"Arcane Staff","holystaff":"Holy Staff",
    "naturestaff":"Nature Staff","cursestaff":"Cursed Staff",
}
MAGIC_LINES = {"Fire Staff","Frost Staff","Arcane Staff","Holy Staff","Cursed Staff","Nature Staff"}
ARMOR_MAT = {"cloth":"Cloth","leather":"Leather","plate":"Plate"}
ARMOR_PIECE = {"head":"Helmet","armor":"Armor","shoes":"Boots"}

# an ability is a prototype / not-in-game if EVERY item that grants it matches this
PROTO_ITEM = re.compile(r"PROTO|TEST|DEBUG|GAMEMASTER|_GM_|INTERNAL|PLACEHOLDER|QUESTITEM|TUTORIAL", re.I)

# --- tooltip tags (from the [..] markers in localized descriptions) ---
TAG_MARK = {"dmg":"Damage","cc":"Crowd Control","mobility":"Mobility","debuff":"Debuff","buff":"Buff","heal":"Heal"}
TAG_ORDER = ["dmg","cc","mobility","debuff","buff","heal"]

# --- crowd-control kinds (keyword in the [cc] span -> label). knockback/pull/fear -> Forced Movement ---
CC_KEYS = [
    ("stun","Stun"),("root","Root"),("slow","Slow"),("silenc","Silence"),("interrupt","Interrupt"),
    ("sleep","Sleep"),("asleep","Sleep"),
    ("knock","Forced Movement"),("thrown","Forced Movement"),("launch","Forced Movement"),
    ("pull","Forced Movement"),("fear","Forced Movement"),("flee","Forced Movement"),
]
CC_FALLBACK = "Stun"   # used only if a CC-tagged ability yields no keyword

# --- buff / debuff buckets (buffovertime `type` -> set of buckets).  Unmapped types are dropped. ---
def bd_bucket(ty, debuff):
    if ty in ("physicalarmor","magicresistance","bonusdefensevsmobs","bonusdefensevsplayers"): return {"Resistances"}
    if "attackdamagebonus" in ty:      return {"Autoattack Damage"}      # "attack" = auto-attack
    if "spelldamagebonus" in ty:       return {"Ability Damage"}         # "spell" = ability
    if ty.startswith("bonusdamagevs"): return {"Damage vs Players/All"}  # flat "damage vs target-type" bonus
    if ty == "attackspeedbonus":       return {"Attack Speed"}
    if ty == "hitpointsmaxbonus":      return {"Max Health"}
    if ty == "healbonus":              return {"Healing Cast"}       # bonus to healing you output
    if ty == "healmodifier":           return {"Healing Received"}   # modifies healing taken (anti-heal etc.)
    if "cooldownreduction" in ty:      return {"Cooldown Rate"}
    if "casttimereduction" in ty:      return {"Cast Rate"}
    if ty == "movespeedbonus":         return None if debuff else {"Movement Speed"}  # enemy move-speed = Slow (CC)
    if ty.startswith("bonusccduration"): return {"CC Duration"}
    if ty == "energycostreduction":    return {"Energy"}
    if ty == "crowdcontrolresistance": return {"CC Resistance"}
    if ty == "attackrangebonus":       return {"Attack Range"}
    if ty == "focusfireprotectionpenetration": return {"Resilience Penetration"}
    return None                        # threatbonus, energyregenerationbonus & everything else -> ignored

# --- immunity sub-types (from cceffectimmunity `type=`) ---
CC_IMMUNITY = {"stun":"Immune to Stun","root":"Immune to Root","slow":"Immune to Slow",
               "silence":"Immune to Silence","forcedmovement":"Immune to Forced Movement"}

# ---- hand-curated lists (NOT derivable from the dumps — edit freely) ----------------------------
# Albion doesn't flag toggle abilities, so list their spell ids here:
TOGGLE_IDS = {
    "ROYAL_MARCH",    # Royal Sandals
    "IMMORTAL",       # Mistwalker Hood
    "ENFEEBLEAURA",   # Guardian Armor
    "HYPER_FOCUS",    # Feyscale Hat
    "QS_SLOWROPE",    # Staff of Balance (E)
}
# There is no data signal for these immunities, so list the abilities that grant them:
DEBUFF_IMMUNITY_IDS = {
    "HYPER_FOCUS",    # Feyscale Hat
}
PURGE_IMMUNITY_IDS = {
    "DEFENSERUN",     # Iron Will
}
# Targeting overrides for the rare ability the auto-rule still gets wrong. Add "SPELL_ID": "Area of Effect"
# (or "Targeted"/"Self cast") as you find them in playtesting.
CAST_RANGE_OVERRIDES = {
    "LEVITATE": "Self cast",          # self-only channel — restores your own HP/energy/resistances
    "OUTOFCOMBATHEAL": "Self cast",   # Mend Wounds — bandages yourself out of combat
    "AUTOFIRE2": "Targeted",          # Auto Fire — focuses one target; its AoE scaling is incidental
}

# hand-added tags for abilities whose tooltip omits a [marker] it should have (keys are marker names)
FORCE_TAGS = {
    "SPINNING_SMASH": {"mobility"},   # Onslaught — spins toward a targeted position (a gap-closer)
}
# ------------------------------------------------------------------------------------------------

# --- cast range: Self (affects only caster) / Single-target (one other) / Area (can hit multiple) ---
# Effect-element targets that count as "affects someone other than the caster".
EFFECT_ELEMS = ("directattributechange","attributechangeovertime","root","stun","silence",
                "knockback","forcedmovement","buffovertime","healovertime","projectile")
TGT_OTHER = {"enemy","enemies","opponent","knockeddownplayer","friendother","friendotherplayers",
             "ally","allies","other","friendall"}   # friendall = "any one ally" (a single-target pick)

# spell-reference attributes to follow when walking a spell's effect tree
REF_ATTRS = ["spell","effect","name","endeffect","chargespell","spellchargesspell",
             "overridespell","collisioneffect","landscapecollisioneffect"]

# ============================================================================
# helpers
# ============================================================================
def attrs(s):
    return dict(re.findall(r'(\w+)="([^"]*)"', s))

def hostile_area(blob):
    """True if an area radius (>=2) sits on a hostile (enemy) effect -> a real multi-enemy AoE.
    An ally-only radius (e.g. Shield Charge's ally shield) does NOT count as multi-target."""
    for m in re.finditer(r'<\w+\b([^>]*)', blob):
        at = attrs(m.group(1)); r = at.get("effectarearadius")
        if r and at.get("target") in ("enemy","enemies","opponent"):
            try:
                if float(r) >= 2: return True
            except ValueError:
                pass
    return False

# elements that are beneficial when aimed at allies (heal / HoT / buff / applied buff-spell).
# Deliberately excludes <damageshield>, so a charged ally shield (Shield Charge) stays single-target.
ALLY_HEALBUFF = ("directattributechange","attributechangeovertime","buffovertime","healovertime","applyspell")
ALLY_TARGETS = ("friendall","friendother","friendotherplayers","ally","allies","friend")
def ally_heal_area(blob):
    """True if an area radius (>=2) sits on a friend-targeted heal/buff -> reaches multiple allies."""
    for el in ALLY_HEALBUFF:
        for m in re.finditer(r'<'+el+r'\b([^>]*)', blob):
            at = attrs(m.group(1)); r = at.get("effectarearadius")
            if r and at.get("target") in ALLY_TARGETS:
                try:
                    if float(r) >= 2: return True
                except ValueError:
                    pass
    return False

def load(src, name):
    path = os.path.join(src, name)
    if not os.path.exists(path):
        sys.exit(f"missing input: {path}  (run with --download, or place the dump there)")
    with open(path, encoding="utf-8") as f:
        return f.read()

def download(src):
    os.makedirs(src, exist_ok=True)
    for name, rel in DUMP_FILES.items():
        dst = os.path.join(src, name)
        if os.path.exists(dst):
            print(f"  have {name}"); continue
        print(f"  downloading {name} ...")
        urllib.request.urlretrieve(RAW_BASE + rel, dst)

def write_pretty(path, arr):
    """Write a JSON array with one record per line (readable + clean diffs)."""
    with open(path, "w", encoding="utf-8") as f:
        f.write("[\n")
        f.write(",\n".join("  " + json.dumps(o, ensure_ascii=False) for o in arr))
        f.write("\n]\n")

# ============================================================================
# MAPS
# ============================================================================
def build_maps(world_xml):
    clusters = {}
    for m in re.finditer(r'<cluster ([^>]*)>', world_xml):
        a = attrs(m.group(1)); cid, t = a.get("id"), a.get("type")
        if not cid or not t: continue                # skip typeless stub references
        wmp = a.get("worldmapposition","").split()
        clusters[cid] = {"name":a.get("displayname"), "type":t, "file":a.get("file",""),
                         "wx":float(wmp[0]) if len(wmp)==2 else None,
                         "wy":float(wmp[1]) if len(wmp)==2 else None}
    is_town = lambda t: ("PORTALCITY" in t or "REST" in t)
    towns = {cid for cid,c in clusters.items() if is_town(c["type"])}

    def portal_edge(px, py):
        # Maps are axis-aligned squares in local coords, displayed rotated 45deg as diamonds. A portal's
        # diamond edge is the square side it sits on (its dominant coordinate):
        #   top (y+) -> NE,  right (x+) -> SE,  bottom (y-) -> SW,  left (x-) -> NW
        if abs(px) >= abs(py):
            return "SE" if px > 0 else "NW"
        return "NE" if py > 0 else "SW"

    zones, adj = {}, set()
    for m in re.finditer(r'<cluster ([^>]*?)>(.*?)</cluster>', world_xml, re.S):
        h = attrs(m.group(1))
        if h.get("type") not in BLACK_TYPES: continue
        cid = h["id"]; c = clusters[cid]; body = m.group(2); f = h["file"]
        biome = BIOME.get((re.search(r'_([A-Z]{2})_AUTO_', f) or [None,None])[1]) if re.search(r'_([A-Z]{2})_AUTO_', f) else None
        tier  = (re.search(r'_(T\d)_', f) or [None,None])[1]
        marks = set(re.findall(r'<marker type="([^"]+)"', body))
        exits = list(re.finditer(r'<exit ([^>]*?)/>', body))
        feats = []
        if any('targettype="DungeonGroup"' in e.group(0) for e in exits): feats.append("Static Dungeon")
        if "Castle" in marks:          feats.append("Castle")
        if "Castle_Outpost" in marks:  feats.append("Outpost")
        if marks & SMUGGLER_MARKERS:   feats.append("Smuggler's Den")
        # directional neighbours: the diamond edge the portal to that neighbour is on (+ edges for the town BFS)
        dc, tmp = Counter(), {}
        for e in exits:
            ea = attrs(e.group(1)); tid = ea.get("targetid","")
            if "@" not in tid: continue
            tgt = tid.split("@")[1]; tc = clusters.get(tgt)
            if not tc: continue
            if tc["type"] in BLACK_TYPES or is_town(tc["type"]): adj.add((cid,tgt))
            if tc["type"] in BLACK_TYPES and ea.get("targettype")=="Cluster" and ea.get("pos"):
                try:
                    px, py = map(float, ea["pos"].split())
                except ValueError:
                    continue
                d = portal_edge(px, py); dc[d]+=1; tmp[d]=tgt
        nbrs = {d:tmp[d] for d in tmp if dc[d]==1}   # keep only edges with a single portal (unambiguous)
        zones[cid] = {"id":cid, "name":c["name"], "biome":biome, "tier":tier,
                      "quality":int(h["type"].split("_")[-1]), "features":sorted(feats),
                      "wx":c["wx"], "wy":c["wy"], "nbrs":nbrs}

    # nearest town by gate-path (BFS over black<->black and black<->town edges)
    G = defaultdict(set)
    for a,b in adj: G[a].add(b); G[b].add(a)
    def nearest(start):
        dist={}; seen={start}; q=deque([(start,0)])
        while q:
            n,d=q.popleft()
            for nb in G[n]:
                if nb in seen: continue
                seen.add(nb)
                if nb in towns: dist[nb]=d+1
                q.append((nb,d+1))
        if not dist: return None
        md=min(dist.values()); cand=[t for t,dd in dist.items() if dd==md]
        sx,sy=clusters[start]["wx"],clusters[start]["wy"]
        cand.sort(key=lambda t:((clusters[t]["wx"]-sx)**2+(clusters[t]["wy"]-sy)**2, clusters[t]["name"]))
        return clusters[cand[0]]["name"]
    for cid,z in zones.items(): z["town"]=nearest(cid)

    ordered = sorted(zones.values(), key=lambda z:z["name"])
    idx = {z["id"]:i for i,z in enumerate(ordered)}
    out=[]
    for z in ordered:
        d = {dr:idx[t] for dr,t in z["nbrs"].items() if t in idx}
        out.append({"n":z["name"], "q":z["quality"], "t":int(z["tier"][1:]),
                    "b":z["biome"], "f":z["features"], "c":z["town"], "d":d})
    return out

# ============================================================================
# ABILITIES
# ============================================================================
def parse_spells(spells_xml):
    S = {}
    for m in re.finditer(r'<activespell ([^>]*?)(?:/>|>(.*?)</activespell>)', spells_xml, re.S):
        h = attrs(m.group(1))
        if h.get("uniquename"): S[h["uniquename"]] = (h, m.group(2) or "")
    return S

def subtree(uid, S):
    """Return every (head_attrs, body) in the spell's effect tree, following spell refs."""
    seen=set(); pairs=[]
    def go(u):
        if u in seen or u not in S: return
        seen.add(u); h,b = S[u]; pairs.append((h,b))
        for a in REF_ATTRS:
            for r in re.findall(a+r'="([^"]+)"', b):
                if r in S: go(r)
    go(uid)
    return pairs

def build_localization(loc_xml, spell_ids, desctag):
    want_name = {"@SPELLS_"+s for s in spell_ids}
    want_desc = set(desctag.values()) | {"@SPELLS_"+s+"_DESC" for s in spell_ids}
    names, descs = {}, {}
    for tu in re.finditer(r'<tu tuid="(@SPELLS_[A-Z0-9_]+)">(.*?)</tu>', loc_xml, re.S):
        tuid = tu.group(1)
        if tuid not in want_name and tuid not in want_desc: continue
        en = re.search(r'xml:lang="EN-US">\s*<seg>(.*?)</seg>', tu.group(2), re.S)
        if not en: continue
        (descs if tuid.endswith("_DESC") else names)[tuid] = en.group(1)
    return names, descs

def clean_desc(txt):
    if not txt: return ""
    t = re.sub(r'\[/?[a-z]+\]', '', txt)          # strip [dmg] [/dmg] ...
    t = re.sub(r'\$\$[^$]*\$', 'X', t)            # $$VAR$  -> X
    t = re.sub(r'\$[^$]*\$', 'X', t)              # $var$   -> X
    t = re.sub(r'\{\d+\}', 'X', t)                # {2}     -> X
    return re.sub(r'\s+', ' ', t).strip()

def target_class(t):
    t = (t or "").lower()
    if any(k in t for k in ("enemy","enemies","opponent")): return "enemy"
    if any(k in t for k in ("self","caster","ally","allies","group","friend")): return "self"
    return "?"

def build_abilities(items_xml, spells_xml, loc_xml):
    # ---- which spells come from which items (for line/slot/piece + prototype filter) ----
    weapon, armor, sources = {}, defaultdict(lambda:{"pieces":set(),"mats":set()}), defaultdict(list)
    for wm in re.finditer(r'<weapon ([^>]*?)>(.*?)</weapon>', items_xml, re.S):
        h = attrs(wm.group(1)); u = h.get("uniquename","")
        if h.get("shopcategory")!="weapons" or not re.match(r"^T\d_", u): continue
        line = h.get("shopsubcategory1")
        if line not in WEAPON_LINE_NAMES: continue
        for cs in re.finditer(r'<craftspell ([^>]*?)/>', wm.group(2)):
            a = attrs(cs.group(1)); sp = a.get("uniquename","")
            if not a.get("slots") or sp.startswith("PASSIVE"): continue
            weapon.setdefault(sp, {"line":WEAPON_LINE_NAMES[line]}); sources[sp].append(u)
    for em in re.finditer(r'<equipmentitem ([^>]*?)>(.*?)</equipmentitem>', items_xml, re.S):
        h = attrs(em.group(1)); u = h.get("uniquename",""); slot = h.get("slottype")
        if slot not in ARMOR_PIECE or not re.match(r"^T\d_", u): continue
        mat = next((ARMOR_MAT[m] for m in ARMOR_MAT if (h.get("shopsubcategory1","") or "").startswith(m)), None)
        if not mat: continue
        for sp in re.findall(r'<craftspell uniquename="([^"]+)"', em.group(2)):
            if sp.startswith("PASSIVE"): continue
            armor[sp]["pieces"].add(ARMOR_PIECE[slot]); armor[sp]["mats"].add(mat); sources[sp].append(u)

    all_ids = set(weapon) | set(armor)
    # keep only abilities with at least one real (non-prototype) source item
    kept = {sp for sp in all_ids if any(not PROTO_ITEM.search(u) for u in sources[sp])}

    # ---- spell table + localization ----
    S = parse_spells(spells_xml)
    desctag = {sp: S[sp][0].get("descriptionlocatag","") for sp in kept if sp in S}
    names, descs = build_localization(loc_xml, kept, desctag)
    def raw_desc(sp):
        return descs.get(desctag.get(sp) or ("@SPELLS_"+sp+"_DESC")) or descs.get("@SPELLS_"+sp+"_DESC")

    abilities = []
    for sp in kept:
        name = names.get("@SPELLS_"+sp)
        if not name: continue                      # no display name -> skip
        is_weapon = sp in weapon
        pairs = subtree(sp, S)
        blob = "".join(b for _,b in pairs)
        head = S.get(sp, ({},""))[0]
        rd = raw_desc(sp) or ""

        # tags (from [..] markers, plus any hand-added ones)
        found = {t for t in re.findall(r'\[([a-z]+)\]', rd) if t in TAG_MARK}
        found |= FORCE_TAGS.get(sp, set())
        tags = [TAG_MARK[t] for t in TAG_ORDER if t in found]

        # damage school
        school=set()
        for h,b in pairs:
            for dm in re.finditer(r'<(?:directattributechange|attributechangeovertime)([^>]*)/?>', b):
                at = attrs(dm.group(1))
                if at.get("attribute","").lower() in ("health","hitpoints"):
                    ch = at.get("change") or at.get("changepersecond") or at.get("value") or ""
                    if ch.startswith("-") and at.get("effecttype"):
                        school.add("Magical" if at["effecttype"]=="magic" else "Physical")
        if len(school) > 1:   # effect tree is ambiguous (a shared sub-effect drags in a stray school)
            spans = " ".join(re.findall(r'\[dmg\](.*?)\[/dmg\]', rd, re.S|re.I)).lower()  # trust the tooltip
            tip = set()
            if "physical" in spans: tip.add("Physical")
            if "magic" in spans:    tip.add("Magical")
            if tip: school = tip
        if "Damage" in tags and not school:
            school = {"Magical"} if (is_weapon and weapon[sp]["line"] in MAGIC_LINES) else {"Physical"}

        # buff / debuff kinds (direction-aware)
        bf,db=set(),set()
        for m in re.finditer(r'<buffovertime([^>]*)/?>', blob):
            at=attrs(m.group(1)); ty=at.get("type")
            if not ty: continue
            tgt=target_class(at.get("target")); neg=(at.get("value","") or at.get("valuepersecond","")).startswith("-")
            if tgt=="self" and not neg:
                b=bd_bucket(ty,False)
                if b: bf |= b
            elif tgt=="enemy":
                b=bd_bucket(ty,True)
                if b: db |= b
        for m in re.finditer(r'<attributechangeovertime([^>]*)/?>', blob):
            at=attrs(m.group(1))
            if at.get("attribute","").lower() in ("health","hitpoints"):
                (db.add("DoT") if (at.get("changepersecond") or at.get("change") or "").startswith("-") else bf.add("HoT"))
        if "damageshield" in blob.lower(): bf.add("Shield")

        # immunity sub-types (buff)
        imm=set()
        if "<invincibility" in blob: imm.add("Immune to Damage")
        for t in re.findall(r'<cceffectimmunity[^>]*type="([^"]+)"', blob):
            if t in CC_IMMUNITY: imm.add(CC_IMMUNITY[t])
        if sp in DEBUFF_IMMUNITY_IDS: imm.add("Immune to Debuffs")
        if sp in PURGE_IMMUNITY_IDS:  imm.add("Immune to Purge")
        if imm: bf.add("Immunity")

        if "Buff" not in tags: bf=set(); imm=set()
        if "Debuff" not in tags: db=set()

        # crowd-control kinds (from localized [cc] spans)
        cc=set()
        if "Crowd Control" in tags:
            spans = re.findall(r'\[cc\](.*?)\[/cc\]', rd, re.S|re.I)
            text = (" ".join(spans) if spans else rd).lower()
            for key,lab in CC_KEYS:
                if key in text: cc.add(lab)
            if not cc: cc.add(CC_FALLBACK)

        # cooldown + IP scaling. The root's recastdelay is the cooldown for a normal ability. For a
        # combo / multi-part ability the root's recastdelay is 0 (the delay *between* parts) and the
        # real total cooldown sits on a later part -> follow the spell= continuation chain and take the
        # largest recastdelay from parts belonging to this same ability (shared id stem), which avoids
        # grabbing cooldowns from unrelated referenced spells (e.g. Mimic -> TAR_RING).
        def _rc(h):
            try: return float(h.get("recastdelay") or 0)
            except ValueError: return 0.0
        cd = _rc(head); ip = bool(head.get("itempowerrecastdelaymodifier"))
        if cd == 0.0:
            stem = sp.rsplit("_",1)[0] if "_" in sp else sp
            seen=set()
            def _chain(u):
                nonlocal cd, ip
                if u in seen or u not in S: return
                seen.add(u); h,b = S[u]
                if u.startswith(stem):
                    v = _rc(h)
                    if v > cd: cd = v; ip = bool(h.get("itempowerrecastdelaymodifier"))
                for r in re.findall(r'\bspell="([^"]+)"', b):
                    if r in S: _chain(r)
            _chain(sp)

        # cast type
        main_body = S.get(sp,({},""))[1]
        if sp in TOGGLE_IDS:
            ct = "Toggle"
        elif "<channelingspell" in main_body:
            ct = "Channeled"
        elif float(head.get("castingtime","0") or 0) > 0:
            ct = "Cast time"
        else:
            ct = "Instant"

        # cast range. "Affects someone else" comes from offensive tags + effect targets; "can hit
        # multiple" is read from per-target scaling / area (semantically reliable). Main-spell target
        # keywords are deliberately NOT used — target="all" is overloaded (self-stacks, "all debuffs").
        tgts=set()
        for el in EFFECT_ELEMS:
            for m in re.finditer(r'<'+el+r'\b([^>]*)', blob):
                t=attrs(m.group(1)).get("target")
                if t: tgts.add(t)
        tag_offense = any(x in tags for x in ("Damage","Crowd Control","Debuff"))
        # a reflect shield is cast on yourself; its "damage" is only reflected when hit, not actively
        # aimed at anyone (e.g. Deflecting Spin, Inferno Shield, Retaliate) -> Self, not Single-target.
        reflect_shield = (tag_offense and "reflectdamage" in blob.lower()
                          and head.get("target")=="self" and not (tgts & TGT_OTHER))
        affects_other = ((tag_offense and not reflect_shield)
                         or bool(tgts & TGT_OTHER)
                         or head.get("target") in TGT_OTHER)   # ability cast directly on an ally/enemy (e.g. Shield Charge)
        multi = bool(re.search(r'targetcount(?:value|duration)bonusfactor="[0-9.]*[1-9]', blob)
                     or re.search(r'<spelleffectarea\b', blob)
                     or re.search(r'maxtargets="(?:[2-9]|\d\d)"', blob)
                     or re.search(r'deletewhenmaxtargetshit="(?:[2-9]|\d\d)"', blob)
                     or hostile_area(blob)
                     or ally_heal_area(blob))
        cr = "Self cast" if not affects_other else ("Area of Effect" if multi else "Targeted")
        if sp in CAST_RANGE_OVERRIDES: cr = CAST_RANGE_OVERRIDES[sp]

        entry = {"id":sp, "n":name, "t":"w" if is_weapon else "a", "tags":tags,
                 "dmg":sorted(school), "bf":sorted(bf), "db":sorted(db), "imm":sorted(imm), "cc":sorted(cc),
                 "cd":cd, "ip":ip, "ct":ct, "cr":cr, "desc":clean_desc(rd)}
        if is_weapon: entry["l"] = weapon[sp]["line"]
        else: entry["p"] = (sorted(armor[sp]["pieces"]) or ["Armor"])[0]   # Helmet / Armor / Boots
        abilities.append(entry)

    abilities.sort(key=lambda a:a["n"])
    return abilities

# ============================================================================
# main
# ============================================================================
def main():
    ap = argparse.ArgumentParser(description="Build Albiondle data from Albion dumps.")
    ap.add_argument("--src", default="game_data", help="folder with world.xml/items.xml/spells.xml/localization.xml")
    ap.add_argument("--outdir", default=".", help="folder to write maps.json and abilities.json into")
    ap.add_argument("--download", action="store_true", help="fetch missing dumps into --src first")
    args = ap.parse_args()

    if args.download: download(args.src)

    print("building maps ...")
    maps = build_maps(load(args.src, "world.xml"))
    print(f"  {len(maps)} black-zone maps")
    print("building abilities ...")
    abilities = build_abilities(load(args.src,"items.xml"), load(args.src,"spells.xml"), load(args.src,"localization.xml"))
    print(f"  {len(abilities)} abilities ({sum(a['t']=='w' for a in abilities)} weapon, {sum(a['t']=='a' for a in abilities)} armor)")

    os.makedirs(args.outdir, exist_ok=True)
    mp = os.path.join(args.outdir, "maps.json")
    ap_ = os.path.join(args.outdir, "abilities.json")
    write_pretty(mp, maps)
    write_pretty(ap_, abilities)
    print(f"wrote {mp}  ({os.path.getsize(mp):,} bytes)")
    print(f"wrote {ap_}  ({os.path.getsize(ap_):,} bytes)")

if __name__ == "__main__":
    main()