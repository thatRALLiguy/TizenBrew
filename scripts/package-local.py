"""Package prebuilt TizenBrew, optionally including a tested TizenTube snapshot.
Run the service and UI builds first. Output is unsigned; sign in the installer.
"""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

parser = argparse.ArgumentParser()
parser.add_argument("--tizentube", type=Path)
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
app = root / "tizenbrew-app/TizenBrew"
files = {name: app / name for name in ["config.xml", "icon.png"]}
for directory in ["tizenbrew-ui/dist", "service-nextgen/service/dist"]:
    for file in (app / directory).rglob("*"):
        if file.is_file() and "bundled-tizentube" not in file.parts:
            files[file.relative_to(app).as_posix()] = file
assert "tizenbrew-ui/dist/index.html" in files, "Build the UI first"
assert "service-nextgen/service/dist/index.js" in files, "Build the service first"
if args.tizentube:
    for asset in ["package.json", "dist/userScript.js", "dist/service.js"]:
        files["service-nextgen/service/dist/bundled-tizentube/" + asset] = args.tizentube / asset
    for license_file in args.tizentube.glob("LICENSE*"):
        files["licenses/TizenTube/" + license_file.name] = license_file
for license_file in root.glob("LICENSE*"):
    files["licenses/TizenBrew/" + license_file.name] = license_file
# Read every input before writing; a failed build must not produce a partial package.
contents = {name: file.read_bytes() for name, file in files.items()}
manifest = {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}
args.output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(args.output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in contents.items():
        archive.writestr(name, data)
    archive.writestr("build-manifest.json", json.dumps(manifest, indent=2))
with ZipFile(args.output) as archive:
    assert archive.testzip() is None
    for name, digest in manifest.items():
        assert hashlib.sha256(archive.read(name)).hexdigest() == digest
print(str(args.output.resolve()))
print("SHA256 " + hashlib.sha256(args.output.read_bytes()).hexdigest())
