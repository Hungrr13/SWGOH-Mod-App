**Secondary Focus Import**
Use [tools/secondary-focus-generator.js](/C:/Users/Chad/my-app/tools/secondary-focus-generator.js:1) to turn per-character SWGOH.GG secondary-focus rows into suggested `secs` values.

**Input Format**
Create a CSV like [secondary_focus_import.template.csv](/C:/Users/Chad/my-app/references/mod-source/secondary_focus_import.template.csv:1) with these columns:
- `name`
- `stat`
- `avg`
- `usage_pct`

Each row is one stat line from a character's `Secondary Stat Focus` block.

Example:
```csv
name,stat,avg,usage_pct
Admiral Ackbar,Speed,11.4,20.72
Admiral Ackbar,Tenacity%,4.04,8.13
Admiral Ackbar,Health,735.3,7.96
```

**Run It**
Review-only output:
```powershell
node tools/secondary-focus-generator.js --input references/mod-source/secondary_focus_import.csv --out references/mod-source/secondary_focus_suggestions.csv
```

Apply the generated `suggested_secs` back into [chars.js](/C:/Users/Chad/my-app/src/data/chars.js:1):
```powershell
node tools/secondary-focus-generator.js --input references/mod-source/secondary_focus_import.csv --out references/mod-source/secondary_focus_suggestions.csv --apply
```

**Fetch From SWGOH.GG Links**
If you have a list of SWGOH.GG best-mod pages, use [tools/mod-source-secondary-import.js](/C:/Users/Chad/my-app/tools/mod-source-secondary-import.js:1) first.

1. Put links into [mod_source_best_mods_urls.template.txt](/C:/Users/Chad/my-app/references/mod-source/mod_source_best_mods_urls.template.txt:1) format.
2. Save it as `references/mod-source/mod_source_best_mods_urls.txt`
3. Run:

```powershell
node tools/mod-source-secondary-import.js --input references/mod-source/mod_source_best_mods_urls.txt --out references/mod-source/secondary_focus_import.csv
```

**Auto-Build The URL List**
You can generate the URL list directly from the current roster in [chars.js](/C:/Users/Chad/my-app/src/data/chars.js:1):

```powershell
node tools/build-mod-source-best-mod-urls.js --out references/mod-source/mod_source_best_mods_urls.txt
```

That creates `references/mod-source/mod_source_best_mods_urls.txt` with one best-mods link per character, using manual slug overrides for names that do not convert cleanly.

**Open A Batch In Your Browser**
To make saving pages easier, open the links in batches instead of all at once:

```powershell
npm run open:secondaries -- --batch 10 --start 0
```

Examples:
- first 10 tabs: `npm run open:secondaries -- --batch 10 --start 0`
- next 10 tabs: `npm run open:secondaries -- --batch 10 --start 10`
- next 25 tabs: `npm run open:secondaries -- --batch 25 --start 20`

The script opens URLs from [mod_source_best_mods_urls.txt](/C:/Users/Chad/my-app/references/mod-source/mod_source_best_mods_urls.txt:1) in your default browser and prints the next start index to use.

Then feed that output into the generator:

```powershell
node tools/secondary-focus-generator.js --input references/mod-source/secondary_focus_import.csv --out references/mod-source/secondary_focus_suggestions.csv
```

**One Click**
Run the whole flow in one command:

```powershell
npm run refresh:secondaries
```

That will:
1. build `references/mod-source/mod_source_best_mods_urls.txt`
2. fetch each page into `references/mod-source/secondary_focus_import.csv`
3. generate `references/mod-source/secondary_focus_suggestions.csv`
4. apply the generated `suggested_secs` into [chars.js](/C:/Users/Chad/my-app/src/data/chars.js:1)

**Import From Saved HTML**
If you save SWGOH.GG `best-mods` pages locally, you can import them without hitting the site live.

1. Save the pages into a folder like `references/mod-source-html`
2. Run:

```powershell
node tools/import-secondary-focus-from-html.js --dir references/mod-source-html --out references/mod-source/secondary_focus_import.csv
```

3. Then generate and apply:

```powershell
node tools/secondary-focus-generator.js --input references/mod-source/secondary_focus_import.csv --out references/mod-source/secondary_focus_suggestions.csv --apply
```

**Current Scoring**
- `avg` rank is weighted more heavily than `usage_pct`
- flat `Offense / Health / Protection / Defense` get penalized when the matching `%` stat also exists
- only one stat per family survives, so you do not end up with both `Offense` and `Offense%`

**About SWGOH.GG Export**
I did not find an obvious public bulk export for this on SWGOH.GG. The public best-mods pages do expose the `Secondary Stat Focus` rows in page HTML, for example:
- [Tech best-mods page](https://swgoh.gg/units/tech/best-mods/)

That page includes the secondary-focus stats directly in the page content, including stat name, `avg`, and usage percentage. So the practical options are:
- use the link importer script in this repo
- manually build a CSV in this format
- save page HTML and scrape it later
