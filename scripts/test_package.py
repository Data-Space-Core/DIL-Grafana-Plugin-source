import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("packager", Path(__file__).with_name("package-plugin.py"))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackageTests(unittest.TestCase):
    def test_archive_layout_permissions_and_no_server(self):
        root = Path(__file__).resolve().parents[1]
        archives = packager.package(root)
        self.assertEqual(len(archives), 2)
        for archive in archives:
            plugin_id = next(item for item in packager.PLUGINS if archive.name.startswith(item + "-"))
            binary_prefix = packager.PLUGINS[plugin_id]
            with zipfile.ZipFile(archive) as bundle:
                prefix = plugin_id + "/"
                self.assertTrue(all(name.startswith(prefix) for name in bundle.namelist()))
                self.assertIn(prefix + "module.js", bundle.namelist())
                for target in packager.TARGETS:
                    entry = bundle.getinfo(prefix + binary_prefix + target)
                    self.assertEqual((entry.external_attr >> 16) & 0o777, 0o755)
                for name in bundle.namelist():
                    self.assertNotIn("node_modules", name)
                    self.assertFalse(name.endswith(("compose.yaml", "Dockerfile", "server.py")))
            self.assertTrue(archive.with_suffix(".zip.sha256").is_file())

    def test_missing_binary_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dist").mkdir()
            metadata = {"name": "dataspacelab-dil-datasource", "version": "0.3.0"}
            (root / "package.json").write_text(json.dumps(metadata))
            plugin_dir = root / "dist" / "dataspacelab-dil-datasource"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "plugin.json").write_text(json.dumps({
                "id": metadata["name"], "info": {"version": metadata["version"]},
                "dependencies": {"grafanaDependency": ">=13.0.1"}}))
            with self.assertRaisesRegex(ValueError, "Missing or empty"):
                packager.package_one(root, "dataspacelab-dil-datasource", "gpx_dil_")
