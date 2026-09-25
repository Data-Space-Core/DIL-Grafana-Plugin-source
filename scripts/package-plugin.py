"""Package only installable plugin files, preserving backend executable bits."""
import hashlib
import json
import shutil
import stat
import zipfile
from pathlib import Path


TARGETS = ("linux_amd64", "linux_arm64", "darwin_amd64", "darwin_arm64", "windows_amd64.exe")
PLUGINS = {
    "dataspacelab-dil-datasource": "gpx_dil_",
    "dataspacelab-dil-dashboard-app": "gpx_dil_share_",
}


def package_one(root, plugin_id, binary_prefix):
    source = root / "dist" / plugin_id
    manifest = json.loads((source / "plugin.json").read_text())
    plugin_id, version = manifest["id"], manifest["info"]["version"]
    if plugin_id not in PLUGINS:
        raise ValueError("Unexpected plugin ID")
    if manifest["dependencies"]["grafanaDependency"] != ">=13.0.1":
        raise ValueError("Unexpected Grafana compatibility range")
    files = [source / "module.js", source / "plugin.json"]
    files += [source / (binary_prefix + target) for target in TARGETS]
    for file in files:
        if not file.is_file() or not file.stat().st_size:
            raise ValueError(f"Missing or empty plugin file: {file.name}")
    output = root / "artifacts"
    staging = output / plugin_id
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(source, staging)
    for binary in staging.glob(binary_prefix + "*"):
        binary.chmod(0o755)
    archive = output / f"{plugin_id}-{version}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(staging.rglob("*")):
            if not path.is_file():
                continue
            entry = zipfile.ZipInfo(path.relative_to(output).as_posix(), (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.compress_type = zipfile.ZIP_DEFLATED
            mode = 0o755 if path.name.startswith(binary_prefix) else 0o644
            entry.external_attr = (stat.S_IFREG | mode) << 16
            bundle.writestr(entry, path.read_bytes())
    with archive.open("rb") as file:
        checksum = hashlib.file_digest(file, "sha256").hexdigest()
    (output / (archive.name + ".sha256")).write_text(f"{checksum}  {archive.name}\n")
    print(archive)
    return archive


def package(root):
    return [package_one(root, plugin_id, prefix) for plugin_id, prefix in PLUGINS.items()]


if __name__ == "__main__":
    package(Path(__file__).resolve().parents[1])
