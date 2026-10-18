import copy
import math
import socket
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from gatekeeper.offline_locality import Resolver, build, distance

HERE = Path(__file__).parent
ARCHIVE = HERE.parent / "fixtures" / "offline-locality" / "geonames-DK.zip"


def row(identity, name, metres=0):
    return [identity, name, math.degrees(metres / 6371008.8), 0.0, "PPL", "2026-01-01"]


class ResolverTests(unittest.TestCase):
    def setUp(self):
        self.rows = [row(1, "Alpha"), row(2, "Beta", 3000)]

    def test_near_is_qualified(self):
        r = Resolver(self.rows).resolve(0, 0)
        self.assertEqual(
            (r["status"], r["displayLabel"], r["method"]),
            ("estimated", "Ved Alpha", "nearest_populated_place"),
        )
        self.assertNotIn("confidence", r)
        self.assertNotIn("country", r)

    def test_range_limit(self):
        for d, expected in [(1999.9, "estimated"), (2000.1, "unknown")]:
            self.assertEqual(
                Resolver([row(1, "A", d), row(2, "B", 6000)]).resolve(0, 0)["status"], expected
            )

    def test_gap_boundary(self):
        for second, expected in [(1499.9, "unknown"), (1500.1, "estimated")]:
            self.assertEqual(
                Resolver([row(1, "A", 500), row(2, "B", second)]).resolve(0, 0)["status"], expected
            )

    def test_ratio_boundary(self):
        for second, expected in [(2999.9, "unknown"), (3000.1, "estimated")]:
            self.assertEqual(
                Resolver([row(1, "A", 1500), row(2, "B", second)]).resolve(0, 0)["status"], expected
            )

    def test_equal_and_duplicate_points_fail(self):
        for rs in [[row(1, "A"), row(2, "B")], [row(1, "A", 1000), row(2, "B", -1000)]]:
            self.assertEqual(Resolver(rs).resolve(0, 0)["status"], "unknown")

    def test_invalid_inputs(self):
        for lat, lon in [
            (True, 0),
            (None, 0),
            ("56", 10),
            (float("nan"), 0),
            (0, float("inf")),
            (91, 0),
            (0, -181),
            (10**1000, 0),
            (0, -(10**1000)),
        ]:
            self.assertEqual(Resolver(self.rows).resolve(lat, lon)["reason"], "invalid_coordinate")

    def test_position_change_no_cache(self):
        r = Resolver(self.rows)
        self.assertEqual(r.resolve(0, 0)["name"], "Alpha")
        self.assertEqual(r.resolve(self.rows[1][2], 0)["name"], "Beta")

    def test_no_runtime_network(self):
        with patch.object(socket, "socket", side_effect=AssertionError("network forbidden")):
            self.assertEqual(Resolver(self.rows).resolve(0, 0)["status"], "estimated")

    def test_input_mutation_not_retained(self):
        r = Resolver(self.rows)
        self.rows[0][1] = "Tampered"
        self.assertEqual(r.resolve(0, 0)["name"], "Alpha")

    def test_malformed_records(self):
        for col, value in [
            (0, True),
            (1, ""),
            (1, "bad\nname"),
            (2, float("nan")),
            (3, 181),
            (4, "PPLH"),
            (5, "2026-02-30"),
        ]:
            rows = copy.deepcopy(self.rows)
            rows[0][col] = value
            with self.assertRaises(ValueError):
                Resolver(rows)
        with self.assertRaises(ValueError):
            Resolver([self.rows[0], self.rows[0]])
        with self.assertRaises(ValueError):
            Resolver([self.rows[0]])

    def test_distance_symmetry(self):
        self.assertAlmostEqual(distance((56, 10), (57, 11)), distance((57, 11), (56, 10)))


class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.folder = Path(cls.temp.name)
        cls.manifest = build(ARCHIVE, cls.folder)
        cls.resolver = Resolver.load(cls.folder, cls.manifest["datasetSha256"])

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_real_schema_count(self):
        self.assertEqual(self.manifest["recordCount"], 6444)
        self.assertEqual(len(self.resolver.records), 6444)

    def test_reproducible_build(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(build(ARCHIVE, folder), self.manifest)

    def test_actual_public_record(self):
        # Public GeoNames record only; not any household position.
        r = self.resolver.resolve(56.0669, 10.16112)
        self.assertEqual((r["name"], r["geonameId"]), ("Mårslet", 2617034))

    def test_actual_public_synthetic_ambiguity(self):
        lon = 10.16112 + 1000 / (111195 * math.cos(math.radians(56.0669)))
        self.assertEqual(self.resolver.resolve(56.0669, lon)["status"], "unknown")

    def test_swapped_public_coordinate_and_remote(self):
        for point in [(10.16112, 56.0669), (0, 0), (-33, 151)]:
            self.assertEqual(self.resolver.resolve(*point)["status"], "unknown")

    def test_pinned_hash_required(self):
        with self.assertRaises(ValueError):
            Resolver.load(self.folder, "0" * 64)

    def test_corrupt_dataset_and_license(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest = build(ARCHIVE, folder)
            p = Path(folder) / "localities.json"
            p.write_bytes(p.read_bytes() + b" ")
            with self.assertRaises(ValueError):
                Resolver.load(folder, manifest["datasetSha256"])
            build(ARCHIVE, folder)
            (Path(folder) / "GEONAMES-README.txt").write_text("wrong")
            with self.assertRaises(ValueError):
                Resolver.load(folder, manifest["datasetSha256"])

    def test_archive_negative_cases(self):
        with zipfile.ZipFile(ARCHIVE) as z:
            first = z.read("DK.txt").decode().splitlines()[0].split("\t")
            license = z.read("readme.txt")
        for kind in ["columns", "country", "duplicate", "coordinate", "date", "license"]:
            fields = list(first)
            if kind == "columns":
                fields = fields[:-1]
            if kind == "country":
                fields[8] = "SE"
            if kind == "coordinate":
                fields[4] = "nan"
            if kind == "date":
                fields[18] = "wrong"
            text = "\t".join(fields) + "\n"
            if kind == "duplicate":
                text *= 2
            with tempfile.TemporaryDirectory() as folder:
                archive = Path(folder) / "bad.zip"
                with zipfile.ZipFile(archive, "w") as z:
                    z.writestr("DK.txt", text)
                    z.writestr("readme.txt", b"wrong" if kind == "license" else license)
                with self.assertRaises(ValueError):
                    build(archive, Path(folder) / "out")


if __name__ == "__main__":
    unittest.main(verbosity=2)
