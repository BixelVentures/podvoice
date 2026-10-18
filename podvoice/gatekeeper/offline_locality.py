"""Offline locality estimate; never address or city-boundary verification."""

import datetime as dt
import hashlib
import json
import math
import zipfile
from pathlib import Path

CODES = frozenset({"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5", "PPLC", "PPLF"})
METHOD = "nearest_populated_place"
SCHEMA = "podview.offline-localities.v1"
LICENSE = "https://creativecommons.org/licenses/by/4.0/"
SOURCE = "https://download.geonames.org/export/dump/DK.zip"


def canonical(value):
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def coordinate(value, limit):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or abs(value) > limit
        or not math.isfinite(value)
    ):
        raise ValueError("invalid_coordinate")
    return float(value)


def validate_rows(rows):
    seen = set()
    if not isinstance(rows, list) or len(rows) < 2:
        raise ValueError("insufficient_records")
    for row in rows:
        if not isinstance(row, list) or len(row) != 6:
            raise ValueError("invalid_record")
        identity, name, lat, lon, code, modified = row
        if type(identity) is not int or identity <= 0 or identity in seen:
            raise ValueError("invalid_id")
        seen.add(identity)
        if (
            not isinstance(name, str)
            or not name.strip()
            or name != name.strip()
            or len(name) > 200
            or not name.isprintable()
        ):
            raise ValueError("invalid_name")
        coordinate(lat, 90)
        coordinate(lon, 180)
        if code not in CODES:
            raise ValueError("invalid_code")
        if not isinstance(modified, str) or dt.date.fromisoformat(modified).isoformat() != modified:
            raise ValueError("invalid_date")
    return rows


def build(archive, destination):
    """Explicit build-time input only; no fetch, credentials or runtime updater."""
    raw = Path(archive).read_bytes()
    with zipfile.ZipFile(archive) as z:
        info = z.getinfo("DK.txt")
        if info.file_size > 20_000_000 or z.getinfo("readme.txt").file_size > 100_000:
            raise ValueError("oversized_archive")
        data, license_text = z.read("DK.txt"), z.read("readme.txt")
    if b"Creative Commons Attribution 4.0" not in license_text:
        raise ValueError("license_not_verified")
    records, all_ids = [], set()
    for line in data.decode("utf-8").splitlines():
        fields = line.split("\t")
        if len(fields) != 19:
            raise ValueError("invalid_columns")
        identity = int(fields[0])
        if identity <= 0 or identity in all_ids:
            raise ValueError("invalid_id")
        all_ids.add(identity)
        if fields[8] != "DK":
            raise ValueError("unexpected_country")
        # Validate even excluded records so damaged input cannot hide in filters.
        name = fields[1]
        if not name or name != name.strip() or len(name) > 200 or not name.isprintable():
            raise ValueError("invalid_name")
        lat, lon = coordinate(float(fields[4]), 90), coordinate(float(fields[5]), 180)
        if dt.date.fromisoformat(fields[18]).isoformat() != fields[18]:
            raise ValueError("invalid_date")
        if fields[6] == "P" and fields[7] in CODES:
            records.append([identity, name, lat, lon, fields[7], fields[18]])
    records.sort(key=lambda r: r[0])
    validate_rows(records)
    payload = {"schema": SCHEMA, "country": "DK", "records": records}
    body = canonical(payload)
    manifest = {
        "schema": SCHEMA,
        "sourceUrl": SOURCE,
        "sourceArchiveSha256": hashlib.sha256(raw).hexdigest(),
        "datasetSha256": hashlib.sha256(body).hexdigest(),
        "licenseSha256": hashlib.sha256(license_text).hexdigest(),
        "license": LICENSE,
        "credit": "GeoNames",
        "method": METHOD,
        "sourceZipTimestamp": list(info.date_time),
        "recordCount": len(records),
        "datasetBytes": len(body),
        "archiveBytes": len(raw),
        "transformation": "DK populated-place allowlist; six fields; ID sorted; no coordinate rounding",
        "codes": sorted(CODES),
    }
    target = Path(destination)
    target.mkdir(parents=True, exist_ok=True)
    (target / "localities.json").write_bytes(body)
    (target / "manifest.json").write_bytes(canonical(manifest))
    (target / "GEONAMES-README.txt").write_bytes(license_text)
    (target / "CREDITS.txt").write_text(
        "GeoNames — "
        + SOURCE
        + "\nCC BY 4.0 — "
        + LICENSE
        + "\nDerived local populated-place subset; nearest-place estimates, not city boundaries.\n",
        encoding="utf-8",
    )
    return manifest


def distance(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(min(1.0, max(0.0, h))))


class Resolver:
    def __init__(self, records, dataset_hash="synthetic"):
        self.records = tuple(tuple(row) for row in validate_rows(records))
        self.dataset_hash = dataset_hash

    @classmethod
    def load(cls, folder, expected_dataset_hash):
        """Expected hash must come from trusted release metadata, not this bundle."""
        folder = Path(folder)
        body = (folder / "localities.json").read_bytes()
        if len(body) > 10_000_000 or hashlib.sha256(body).hexdigest() != expected_dataset_hash:
            raise ValueError("dataset_integrity")
        manifest = json.loads((folder / "manifest.json").read_bytes())
        license_text = (folder / "GEONAMES-README.txt").read_bytes()
        if (
            manifest.get("datasetSha256") != expected_dataset_hash
            or manifest.get("license") != LICENSE
            or manifest.get("credit") != "GeoNames"
            or hashlib.sha256(license_text).hexdigest() != manifest.get("licenseSha256")
        ):
            raise ValueError("invalid_provenance")
        payload = json.loads(body)
        if (
            set(payload) != {"schema", "country", "records"}
            or payload["schema"] != SCHEMA
            or payload["country"] != "DK"
        ):
            raise ValueError("invalid_schema")
        result = cls(payload["records"], expected_dataset_hash)
        if manifest.get("recordCount") != len(result.records):
            raise ValueError("invalid_count")
        return result

    def resolve(self, latitude, longitude):
        try:
            point = (coordinate(latitude, 90), coordinate(longitude, 180))
        except (ValueError, TypeError):
            return {"status": "unknown", "reason": "invalid_coordinate"}
        ranked = sorted((distance(point, (r[2], r[3])), r[0], r) for r in self.records)
        first, second = ranked[:2]
        d1, d2 = first[0], second[0]
        if d1 > 2000 or d2 < 2 * d1 or d2 - d1 < 1000:
            return {"status": "unknown", "reason": "distant_or_ambiguous"}
        row = first[2]
        return {
            "status": "estimated",
            "name": row[1],
            "displayLabel": "Ved " + row[1],
            "method": METHOD,
            "source": "GeoNames",
            "geonameId": row[0],
            "distanceMetres": d1,
            "runnerUpDistanceMetres": d2,
            "datasetSha256": self.dataset_hash,
            "recordModifiedAt": row[5],
        }
