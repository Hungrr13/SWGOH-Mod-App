# Debug Crop Labels

Create `tools/set-classifier/debug-crops/set-labels.json` to export a reusable training dataset for the set classifier.

Use:

```json
{
  "samples": [
    {
      "file": "Arrow Sets/1776212846702-set.png",
      "set": "Health",
      "profile": "arrow",
      "notes": "Optional"
    }
  ]
}
```

Notes:
- `file` can be a plain filename or a relative path under `tools/set-classifier/debug-crops/`.
- `profile` supports `generic`, `arrow`, and `triangle`.
- `set` accepts full names or common aliases:
  - `health`
  - `defense`, `def`
  - `speed`, `spd`
  - `crit dmg`, `critdamage`, `critdmg`
  - `crit chance`, `critchance`
  - `potency`, `pot`
  - `tenacity`, `tenc`
  - `offense`, `off`

Export with:

```powershell
npm run export:set-dataset
```

Generated output:
- `tools/set-classifier/training-data/manifest.json`
- profile/set sample folders under `tools/set-classifier/training-data/`
