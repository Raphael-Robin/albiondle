import json
from pathlib import Path
import requests

RENDER_URL = "https://render.albiononline.com/v1/spell/{id}.png"

def fetch_ability_icon(ability_id, path, size=217, overwrite=False):
    """Fetch an ability icon from Albion's render API and save it.

    ability_id : spell unique name, e.g. "ASSASSINSPIRIT"
    path       : a directory (saves <id>.png inside) OR a full .png file path
    size       : icon size in px (default 217)
    overwrite  : if False, skip when the file already exists
    Returns (Path, status_string)
    """
    dest = Path(path)
    if dest.suffix.lower() != ".png":            # path is a directory
        dest = dest / f"{ability_id}.png"

    # Check if the file already exists and overwrite is False
    if dest.exists() and not overwrite:
        print(f"SKIP {ability_id}: File already exists at {dest}")
        return dest, "skipped"

    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        r = requests.get(RENDER_URL.format(id=ability_id),
                         params={"size": size}, timeout=20)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"MISS {ability_id}: {e}")
        return None, "failed"

    dest.write_bytes(r.content)
    print(f"SAVED {ability_id} -> {dest}")
    return dest, "downloaded"


with open("abilities.json", "r") as f:
    data = json.load(f)
    ids = [ability["id"] for ability in data]
    
    # Target directory path
    icons_dir = Path(r"C:/Users/Raphael Robin/dev/albiondle/icons")
    
    for ability_id in ids:
        fetch_ability_icon(ability_id, icons_dir)