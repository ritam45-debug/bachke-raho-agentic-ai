"""Bundle sample_data/aureon/*.csv into frontend/src/preview/demoData.json for the in-browser preview build."""
import csv, json
from pathlib import Path
root = Path(__file__).resolve().parent.parent
src = root / "sample_data" / "aureon"
out = {p.stem: list(csv.DictReader(open(p, encoding="utf-8"))) for p in sorted(src.glob("*.csv"))}
(root / "frontend" / "src" / "preview" / "demoData.json").write_text(json.dumps(out), encoding="utf-8")
print({k: len(v) for k, v in out.items()})
