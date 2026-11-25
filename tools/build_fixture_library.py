#!/usr/bin/env python3
"""Build the bundled fixture library from the two big open-source collections.

    git clone --depth 1 https://github.com/OpenLightingProject/open-fixture-library.git /tmp/ofl
    git clone --depth 1 --filter=blob:none --sparse https://github.com/mcallegari/qlcplus.git /tmp/qlc
    (cd /tmp/qlc && git sparse-checkout set resources/fixtures)
    python3 tools/build_fixture_library.py /tmp/ofl /tmp/qlc

Writes apps/desktop/public/fixture-library.json (loaded by Lighting › Patch) and
apps/desktop/public/fixture-library-LICENSES.txt.

Sources and licences:
  * Open Fixture Library — MIT (https://open-fixture-library.org)
  * QLC+ fixture definitions — Apache 2.0 (https://www.qlcplus.org)

Output shape (compact, grouped by manufacturer):
  {"version": 1, "count": N, "manufacturers": {"Chauvet": [
     {"model", "kind", "type", "src", "pan", "tilt", "beam",
      "colors": [[name, dmx, "#rrggbb"], ...], "gobos": [dmx, ...],
      "modes": [{"name", "ch": [[attr, default, label], ...]}]}]}}
`attr` values match the engine's `Attr` enum (snake_case).
"""

import json
import os
import re
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps", "desktop", "public", "fixture-library.json")
LIC = os.path.join(ROOT, "apps", "desktop", "public", "fixture-library-LICENSES.txt")

COLOR_ATTR = {
    "red": "red", "green": "green", "blue": "blue", "white": "white", "warm white": "white",
    "cold white": "white", "amber": "amber", "uv": "uv", "cyan": "cyan", "magenta": "magenta",
    "yellow": "yellow", "lime": "lime",
}


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def hex_ok(h):
    return isinstance(h, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", h)


def kind_for(cats, has_gobo, has_zoom, has_pan):
    cats = [c.lower() for c in cats]
    if any("moving head" in c or "scanner" in c for c in cats) or has_pan:
        return "moving_spot" if has_gobo else "moving_wash"
    if any("bar" in c or "pixel" in c or "matrix" in c for c in cats):
        return "strip"
    if any("color changer" in c for c in cats):
        return "wash" if has_zoom else "par"
    return "generic"


def finish(entry, cats):
    attrs = {c[0] for m in entry["modes"] for c in m["ch"]}
    entry["kind"] = kind_for(cats, "gobo" in attrs, "zoom" in attrs, "pan" in attrs)
    entry["type"] = cats[0] if cats else "Other"
    if "pan" not in attrs:
        entry["pan"] = 0
        entry["tilt"] = 0
    return entry


# ───────────────────────────── QLC+ (.qxf)

QLC_PRESET = [
    (r"^PositionPanFine$|^PositionXAxisFine$", "pan_fine"), (r"^PositionTiltFine$|^PositionYAxisFine$", "tilt_fine"),
    (r"^PositionPan$|^PositionXAxis$", "pan"), (r"^PositionTilt$|^PositionYAxis$", "tilt"),
    (r"^Intensity(Master)?DimmerFine$", "dimmer_fine"), (r"^Intensity(Master)?Dimmer$", "dimmer"),
    (r"^IntensityRed$", "red"), (r"^IntensityGreen$", "green"), (r"^IntensityBlue$", "blue"),
    (r"^IntensityWhite$", "white"), (r"^IntensityAmber$", "amber"), (r"^IntensityUV$", "uv"),
    (r"^IntensityCyan$", "cyan"), (r"^IntensityMagenta$", "magenta"), (r"^IntensityYellow$", "yellow"),
    (r"^IntensityLime$", "lime"), (r"^Shutter(Iris)", "iris"), (r"^Shutter|^Strobe", "shutter"),
    (r"^Speed", "speed"), (r"^BeamZoom", "zoom"), (r"^BeamFocus", "focus"), (r"^ColorWheel|^ColorMacro", "color_wheel"),
    (r"^Gobo(Wheel|Index)Fine", "other"), (r"^GoboWheel", "gobo"), (r"^GoboIndex", "gobo_rotation"),
    (r"^Prism", "prism"), (r"^ColorCT", "color_temp"), (r"^NoFunction$", "unused"),
]


def qlc_attr(ch):
    preset = ch.get("Preset")
    name = (ch.get("Name") or "").lower()
    if preset:
        for rx, a in QLC_PRESET:
            if re.search(rx, preset):
                return a
        return "other"
    g = ch.find("q:Group", NS)
    group = g.text if g is not None else "Nothing"
    fine = g is not None and g.get("Byte") == "1"
    if group == "Intensity":
        col = ch.find("q:Colour", NS)
        if col is not None and not fine:
            return COLOR_ATTR.get(col.text.lower(), "other")
        return "dimmer_fine" if fine and col is None else ("other" if fine else "dimmer")
    if group in ("Pan", "Tilt"):
        return group.lower() + ("_fine" if fine else "")
    if fine:
        return "other"
    if group == "Colour":
        return "color_wheel"
    if group == "Gobo":
        return "gobo_rotation" if "rot" in name or "index" in name else "gobo"
    if group == "Shutter":
        return "iris" if "iris" in name else "shutter"
    if group == "Beam":
        for k in ("zoom", "focus", "iris", "frost"):
            if k in name:
                return k
        return "other"
    return {"Speed": "speed", "Prism": "prism", "Effect": "effect", "Maintenance": "control", "Nothing": "unused"}.get(group, "other")


NS = {"q": "http://www.qlcplus.org/FixtureDefinition"}


def qlc_default(ch, attr):
    caps = ch.findall("q:Capability", NS)
    if attr == "shutter":
        for c in caps:
            if c.get("Preset") == "ShutterOpen" or re.search(r"\bopen\b|shutter open|on\b", (c.text or "").lower()):
                return int(c.get("Min", "0"))
    d = ch.get("Default")
    return int(d) if d and d.isdigit() else 0


def parse_qlc(path):
    root = ET.parse(path).getroot()
    man = root.findtext("q:Manufacturer", "", NS).strip()
    model = root.findtext("q:Model", "", NS).strip()
    typ = root.findtext("q:Type", "Other", NS).strip()
    chans = {}
    colors, gobos = [], []
    for ch in root.findall("q:Channel", NS):
        attr = qlc_attr(ch)
        chans[ch.get("Name")] = (attr, qlc_default(ch, attr))
        caps = ch.findall("q:Capability", NS)
        if attr == "color_wheel" and not colors:
            for c in caps:
                if c.get("Preset") == "ColorMacro" and hex_ok(c.get("Res1") or c.get("Color")):
                    colors.append([(c.text or "").strip()[:24], int(c.get("Min")), (c.get("Res1") or c.get("Color")).lower()])
        if attr == "gobo" and not gobos:
            seen = set()
            for c in caps:
                t = (c.text or "").strip().lower()
                if c.get("Preset") in ("GoboMacro", None) and "shake" not in t and t not in seen and ("gobo" in t or "open" in t):
                    seen.add(t)
                    if "open" in t and gobos:
                        continue
                    gobos.append(int(c.get("Min")))
            if gobos and not any("open" in (c.text or "").lower() for c in caps[:1]):
                gobos.insert(0, 0)
    pan = tilt = 0
    beam = 25
    modes = []
    for m in root.findall("q:Mode", NS):
        ch_list = []
        for c in sorted(m.findall("q:Channel", NS), key=lambda e: int(e.get("Number", 0))):
            attr, default = chans.get(c.text, ("other", 0))
            ch_list.append([attr, default, c.text or ""])
        if ch_list:
            modes.append({"name": m.get("Name") or f"{len(ch_list)}ch", "ch": ch_list})
        phys = m.find("q:Physical", NS)
        if phys is not None:
            lens = phys.find("q:Lens", NS)
            focus = phys.find("q:Focus", NS)
            if lens is not None:
                beam = float(lens.get("DegreesMax") or lens.get("DegreesMin") or beam) or beam
            if focus is not None:
                pan = int(focus.get("PanMax") or 0) or pan
                tilt = int(focus.get("TiltMax") or 0) or tilt
    phys = root.find("q:Physical", NS)
    if phys is not None:
        lens = phys.find("q:Lens", NS)
        focus = phys.find("q:Focus", NS)
        if lens is not None:
            beam = float(lens.get("DegreesMax") or lens.get("DegreesMin") or beam) or beam
        if focus is not None:
            pan = int(focus.get("PanMax") or 0) or pan
            tilt = int(focus.get("TiltMax") or 0) or tilt
    if not modes or not man or not model:
        return None
    e = {"model": model, "src": "qlc", "pan": pan or 540, "tilt": tilt or 270, "beam": round(beam or 25, 1), "colors": colors, "gobos": gobos, "modes": modes}
    return man, finish(e, [typ])


# ───────────────────────────── Open Fixture Library (.json)

def ofl_attr(name, d, wheels):
    caps = [d["capability"]] if "capability" in d else d.get("capabilities", [])
    types = [c.get("type") for c in caps if c.get("type") not in ("NoFunction",)]
    if not types:
        return "unused", caps
    t = types[0]
    c0 = next(c for c in caps if c.get("type") == t)
    lname = name.lower()
    if t == "Intensity":
        return "dimmer", caps
    if t == "ColorIntensity":
        return COLOR_ATTR.get(str(c0.get("color", "")).lower(), "other"), caps
    if t in ("Pan", "PanContinuous"):
        return "pan", caps
    if t in ("Tilt", "TiltContinuous"):
        return "tilt", caps
    if t in ("WheelSlot", "WheelShake", "WheelRotation", "WheelSlotRotation"):
        wheel = (c0.get("wheel") or name).lower()
        if "gobo" in wheel:
            return ("gobo_rotation" if t in ("WheelRotation", "WheelSlotRotation") else "gobo"), caps
        if "color" in wheel or "colour" in wheel:
            return "color_wheel", caps
        return "other", caps
    if t == "ShutterStrobe":
        return "shutter", caps
    if t in ("StrobeSpeed", "StrobeDuration"):
        return "strobe", caps
    simple = {"Zoom": "zoom", "Focus": "focus", "Iris": "iris", "IrisEffect": "iris", "Frost": "frost", "Prism": "prism",
              "PrismRotation": "prism", "ColorTemperature": "color_temp", "PanTiltSpeed": "speed", "Speed": "speed",
              "Effect": "effect", "EffectSpeed": "effect", "EffectDuration": "effect", "Maintenance": "control"}
    if t in simple:
        return simple[t], caps
    if "cyan" in lname:
        return "cyan", caps
    if "magenta" in lname:
        return "magenta", caps
    if "yellow" in lname:
        return "yellow", caps
    return "other", caps


def ofl_default(d, attr, caps):
    if attr == "shutter":
        for c in caps:
            if c.get("type") == "ShutterStrobe" and c.get("shutterEffect") == "Open":
                return int((c.get("dmxRange") or [255])[0])
    v = d.get("defaultValue", 0)
    if isinstance(v, (int, float)):
        return max(0, min(255, int(v)))
    if isinstance(v, str) and v.endswith("%"):
        try:
            return round(float(v[:-1]) * 2.55)
        except ValueError:
            return 0
    return 0


def parse_ofl(path, manufacturers):
    d = json.load(open(path, encoding="utf-8"))
    man_key = os.path.basename(os.path.dirname(path))
    man = manufacturers.get(man_key, {}).get("name", man_key)
    wheels = d.get("wheels", {})
    chans = {}
    colors, gobos = [], []
    pan = tilt = 0
    for name, cd in d.get("availableChannels", {}).items():
        attr, caps = ofl_attr(name, cd, wheels)
        chans[name] = (attr, ofl_default(cd, attr, caps))
        for i, alias in enumerate(cd.get("fineChannelAliases", [])):
            fine = {"pan": "pan_fine", "tilt": "tilt_fine", "dimmer": "dimmer_fine"}.get(attr, "other") if i == 0 else "other"
            chans[alias] = (fine, 0)
        if attr == "pan":
            m = re.match(r"(-?\d+)deg", str(caps[-1].get("angleEnd", ""))) if caps else None
            pan = int(m.group(1)) if m else pan
        if attr == "tilt":
            m = re.match(r"(-?\d+)deg", str(caps[-1].get("angleEnd", ""))) if caps else None
            tilt = int(m.group(1)) if m else tilt
        if attr in ("color_wheel", "gobo"):
            wheel_name = next((c.get("wheel") for c in caps if c.get("wheel")), name)
            slots = wheels.get(wheel_name, {}).get("slots", [])
            for c in caps:
                if c.get("type") != "WheelSlot" or "slotNumber" not in c or "dmxRange" not in c:
                    continue
                n = c["slotNumber"]
                if not isinstance(n, int) or n < 1 or n > len(slots):
                    continue
                slot = slots[n - 1]
                if attr == "color_wheel" and slot.get("type") == "Color" and slot.get("colors") and hex_ok(slot["colors"][0]):
                    if not any(x[0] == slot.get("name") for x in colors):
                        colors.append([slot.get("name", f"Color {n}")[:24], c["dmxRange"][0], slot["colors"][0].lower()])
                if attr == "gobo" and slot.get("type") in ("Open", "Gobo") and len(gobos) < 24:
                    if slot.get("type") == "Open" and gobos:
                        continue
                    gobos.append(c["dmxRange"][0])
    modes = []
    for m in d.get("modes", []):
        chs = m.get("channels", [])
        if any(not (c is None or isinstance(c, str)) for c in chs):
            continue  # pixel-matrix modes: not supported yet
        ch_list = []
        for c in chs:
            if c is None:
                ch_list.append(["unused", 0, ""])
            else:
                attr, default = chans.get(c, ("other", 0))
                ch_list.append([attr, default, c])
        if ch_list:
            modes.append({"name": m.get("name") or f"{len(ch_list)}ch", "ch": ch_list})
    lens = d.get("physical", {}).get("lens", {}).get("degreesMinMax")
    beam = float(lens[1]) if lens and lens[1] else 25
    if not modes:
        return None
    e = {"model": d.get("name", "").strip(), "src": "ofl", "pan": abs(pan) or 540, "tilt": abs(tilt) or 270, "beam": round(beam, 1),
         "colors": colors, "gobos": gobos, "modes": modes}
    return man, finish(e, d.get("categories", []))


def main(ofl_dir, qlc_dir):
    lib = {}
    seen = set()
    n_ofl = n_qlc = 0
    manufacturers = json.load(open(os.path.join(ofl_dir, "fixtures", "manufacturers.json"), encoding="utf-8"))
    for dirpath, _, files in os.walk(os.path.join(ofl_dir, "fixtures")):
        for f in sorted(files):
            if not f.endswith(".json") or f == "manufacturers.json":
                continue
            try:
                r = parse_ofl(os.path.join(dirpath, f), manufacturers)
            except Exception as ex:  # one bad file shouldn't stop the build
                print("skip", f, ex, file=sys.stderr)
                continue
            if r:
                man, e = r
                seen.add(norm(man) + "|" + norm(e["model"]))
                lib.setdefault(man, []).append(e)
                n_ofl += 1
    for dirpath, _, files in os.walk(os.path.join(qlc_dir, "resources", "fixtures")):
        for f in sorted(files):
            if not f.endswith(".qxf"):
                continue
            try:
                r = parse_qlc(os.path.join(dirpath, f))
            except Exception as ex:
                print("skip", f, ex, file=sys.stderr)
                continue
            if not r:
                continue
            man, e = r
            key = norm(man) + "|" + norm(e["model"])
            if key in seen:
                continue  # already have it from OFL
            seen.add(key)
            # Merge near-identical manufacturer spellings onto an existing name.
            match = next((m for m in lib if norm(m) == norm(man)), man)
            lib.setdefault(match, []).append(e)
            n_qlc += 1
    for m in lib:
        lib[m].sort(key=lambda e: e["model"].lower())
    out = {"version": 1, "count": n_ofl + n_qlc, "manufacturers": dict(sorted(lib.items(), key=lambda kv: kv[0].lower()))}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
    with open(LIC, "w", encoding="utf-8") as fh:
        fh.write("Fixture definitions in fixture-library.json are converted from:\n\n")
        fh.write("Open Fixture Library — https://open-fixture-library.org — MIT License\n")
        fh.write(open(os.path.join(ofl_dir, "LICENSE"), encoding="utf-8").read())
        fh.write("\n\nQ Light Controller Plus fixture definitions — https://www.qlcplus.org — Apache License 2.0\n")
        fh.write("Copyright (c) Massimo Callegari and the QLC+ contributors. Converted to this app's format.\n")
        fh.write("Full licence text: https://www.apache.org/licenses/LICENSE-2.0\n")
    modes = sum(len(e["modes"]) for v in lib.values() for e in v)
    print(f"{n_ofl} OFL + {n_qlc} QLC+ = {n_ofl + n_qlc} fixtures, {modes} modes, {len(lib)} manufacturers, {os.path.getsize(OUT) // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
