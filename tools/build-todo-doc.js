const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType, ShadingType,
} = require('docx');

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function todoRow(status, area, description, notes) {
  const cellProps = (fill) => ({
    borders: BORDERS,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
  });
  const statusFill = {
    OPEN: 'FFF4CE',
    'IN PROGRESS': 'D9E7FF',
    DONE: 'D5F0D5',
    BLOCKED: 'FADBD8',
  }[status] || undefined;
  return new TableRow({
    children: [
      new TableCell({
        ...cellProps(statusFill),
        width: { size: 1400, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun({ text: status, bold: true })] })],
      }),
      new TableCell({
        ...cellProps(),
        width: { size: 2000, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun(area)] })],
      }),
      new TableCell({
        ...cellProps(),
        width: { size: 3500, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun(description)] })],
      }),
      new TableCell({
        ...cellProps(),
        width: { size: 2460, type: WidthType.DXA },
        children: [new Paragraph({ children: [new TextRun(notes || '')] })],
      }),
    ],
  });
}

function headerRow() {
  const h = (text) => new TableCell({
    borders: BORDERS,
    shading: { fill: '2E4A6A', type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF' })] })],
  });
  return new TableRow({
    tableHeader: true,
    children: [
      Object.assign(h('Status'), { options: { width: { size: 1400, type: WidthType.DXA } } }),
      Object.assign(h('Area'), { options: { width: { size: 2000, type: WidthType.DXA } } }),
      Object.assign(h('Description'), { options: { width: { size: 3500, type: WidthType.DXA } } }),
      Object.assign(h('Notes'), { options: { width: { size: 2460, type: WidthType.DXA } } }),
    ],
  });
}

const rows = [
  headerRow(),
  todoRow(
    'OPEN',
    'Options menu',
    'Restore Premium option + test button that was in the options menu',
    'Lost in recent rebrand / scaffolding work. Find in git history and reinstate.',
  ),
  todoRow(
    'IN PROGRESS',
    'Shape classifier',
    'Verify Circle-reads-as-Cross fix — diagnostic Canny edge-blank in bottom-left ellipse (unconditional, remove portrait-bubble guard)',
    'Release APK rebuilt 2026-04-20 18:41 with diagnostic + debug-dir relocation. Need fresh scan with new APK. Pulls kept crashing the chat with large PNGs — see Tooling row.',
  ),
  todoRow(
    'OPEN',
    'Shape classifier',
    'Inner cavity mask shows notch at top on Circle — investigate if portrait-removal or pip-cleanup clipping the rim',
    'See shape-classifier-candidate-inner-mask.png from the Apr 20 Circle scan.',
  ),
  todoRow(
    'IN PROGRESS',
    'Tooling / debug',
    'Pull-debug workflow keeps breaking Claude when large shape PNGs get sampled — add size cap / text-first flow',
    'Shape classifier now writes debug to <getExternalFilesDir>/overlay-debug. Next: update pull_debug.ps1 to always grab the .txt first + downscale PNGs before they land in tools/debug_out/, so Claude never reads raw 100KB+ crops.',
  ),
  todoRow(
    'DONE',
    'UI / shape icons',
    'Shape icons on Slice/Finder pickers now use assets/shapes PNGs and were bumped 22 \u2192 28',
    'ModShapeIcon.js was already wired to assets/shapes/*.png. Bumped size on SliceScreen.js:278 and FinderScreen.js:597. Archive on next sweep.',
  ),
  todoRow(
    'DONE',
    'Ally code / privacy',
    'AllyCodePanel placeholder changed from the owner\u2019s real ally code to 123-456-789',
    'Change captured in the staged diff for AllyCodePanel.js (489-758-819 \u2192 123-456-789). Archive on next sweep.',
  ),
  todoRow(
    'OPEN',
    'Repo hygiene',
    'Decide fate of references/mod-source-html/*_files/ (SWGOH.GG webpack bundles)',
    'Carried over from READMEBEFOREEDITING.md follow-ups. Parsers never touch them; deleting would shrink repo meaningfully.',
  ),
  todoRow(
    'OPEN',
    'Slice screen / layout',
    'Shrink the Best Character Fit card and place a "Your Characters" card next to it (premium-only)',
    'Two-card row. "Your Characters" populated from ally-code roster; gated behind premium.',
  ),
  todoRow(
    'OPEN',
    'Slice screen / suggestions',
    'Reduce total number of suggested characters — 140 is too high',
    'Pick a sane cap (e.g. top 20–30 by fit score) and sort by best match.',
  ),
  todoRow(
    'OPEN',
    'Slice screen / scoring',
    'Investigate suggestion scoring — likely only comparing set + primary, ignoring secondaries',
    'Audit scoring path. Secondaries should weight into fit score; otherwise suggestions are noisy.',
  ),
  todoRow(
    'OPEN',
    'Roster / premium',
    'Pull user mods via ally code and flag empty slots + upgrade opportunities (premium)',
    'Premium: badge on character when a slot is empty OR an existing mod is an upgrade. Also show a "not unlocked" notifier next to locked characters.',
  ),
];

const table = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [1400, 2000, 3500, 2460],
  rows,
});

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('ModForge \u2014 Working TODO')] }),
      new Paragraph({ children: [new TextRun({ text: 'Living list. Update status as items move. Add new rows at the bottom.', italics: true, color: '555555' })] }),
      new Paragraph({ children: [new TextRun('')] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Active items')] }),
      table,
      new Paragraph({ children: [new TextRun('')] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Status legend')] }),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: 'OPEN ', bold: true }), new TextRun('\u2014 not started')] }),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: 'IN PROGRESS ', bold: true }), new TextRun('\u2014 actively working')] }),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: 'BLOCKED ', bold: true }), new TextRun('\u2014 waiting on something external')] }),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text: 'DONE ', bold: true }), new TextRun('\u2014 completed; leave in doc for one pass, then archive')] }),
    ],
  }],
});

const out = path.resolve(__dirname, '..', 'docs', 'TODO.docx');
fs.mkdirSync(path.dirname(out), { recursive: true });
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(out, buffer);
  console.log('Wrote ' + out);
});
