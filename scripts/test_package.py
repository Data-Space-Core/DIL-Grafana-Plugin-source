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
        archive = packager.package(root)
        with zipfile.ZipFile(archive) as bundle:
            prefix = "dataspacelab-dil-datasource/"
            self.assertTrue(all(name.startswith(prefix) for name in bundle.namelist()))
            self.assertIn(prefix + "module.js", bundle.namelist())
            for target in packager.TARGETS:
                entry = bundle.getinfo(prefix + "gpx_dil_" + target)
                self.assertEqual((entry.external_attr >> 16) & 0o777, 0o755)
            for name in bundle.namelist():
                self.assertNotIn("node_modules", name)
                self.assertFalse(name.endswith(("compose.yaml", "Dockerfile", "server.py")))
        self.assertTrue(archive.with_suffix(".zip.sha256").is_file())

    def test_missing_binary_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dist").mkdir()
            metadata = {"name": "test-datasource", "version": "0.2.0"}
            (root / "package.json").write_text(json.dumps(metadata))
            (root / "dist/plugin.json").write_text(json.dumps({
                "id": metadata["name"], "info": {"version": metadata["version"]},
                "dependencies": {"grafanaDependency": ">=13.0.1"}}))
            with self.assertRaisesRegex(ValueError, "Missing or empty"):
                packager.package(root)
