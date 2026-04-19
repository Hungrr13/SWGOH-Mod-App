export const MOD_TEMPLATE_SOURCE = 'bundled';

export const MOD_TEMPLATE_MANIFEST = {
  version: 1,
  source: MOD_TEMPLATE_SOURCE,
  shapes: [
    { key: 'square', label: 'Square', assetModule: require('../../assets/mod-templates/shapes/square.png'), remoteUrl: null },
    { key: 'arrow', label: 'Arrow', assetModule: require('../../assets/mod-templates/shapes/arrow.png'), remoteUrl: null },
    { key: 'diamond', label: 'Diamond', assetModule: require('../../assets/mod-templates/shapes/diamond.png'), remoteUrl: null },
    { key: 'triangle', label: 'Triangle', assetModule: require('../../assets/mod-templates/shapes/triangle.png'), remoteUrl: null },
    { key: 'circle', label: 'Circle', assetModule: require('../../assets/mod-templates/shapes/circle.png'), remoteUrl: null },
    { key: 'cross', label: 'Cross', assetModule: require('../../assets/mod-templates/shapes/cross.png'), remoteUrl: null },
  ],
  atlases: [
    { key: 'mod-shape-atlas', label: 'Shape Atlas', assetModule: require('../../assets/mod-templates/atlases/mod-shape-atlas.png'), remoteUrl: null },
    { key: 'mod-shape-atlas-faded', label: 'Shape Atlas Faded', assetModule: require('../../assets/mod-templates/atlases/mod-shape-atlas-faded.png'), remoteUrl: null },
    { key: 'mod-icon-atlas', label: 'Set Atlas', assetModule: require('../../assets/mod-templates/atlases/mod-icon-atlas.png'), remoteUrl: null },
    { key: 'mod-icon-atlas-faded', label: 'Set Atlas Faded', assetModule: require('../../assets/mod-templates/atlases/mod-icon-atlas-faded.png'), remoteUrl: null },
    { key: 'modset-background', label: 'Mod Set Background', assetModule: require('../../assets/mod-templates/atlases/modset-background.png'), remoteUrl: null },
    { key: 'empty-mod-shapes', label: 'Empty Mod Shapes', assetModule: require('../../assets/mod-templates/atlases/empty-mod-shapes.png'), remoteUrl: null },
  ],
  shapeSetVariants: [
    { key: 'critchance-square', label: 'Crit Chance Square', assetModule: require('../../assets/mod-templates/shapes-with-sets/critchance_square.png'), remoteUrl: null },
    { key: 'critchance-arrow', label: 'Crit Chance Arrow', assetModule: require('../../assets/mod-templates/shapes-with-sets/critchance_arrow.png'), remoteUrl: null },
    { key: 'critchance-diamond', label: 'Crit Chance Diamond', assetModule: require('../../assets/mod-templates/shapes-with-sets/critchance_diamond.png'), remoteUrl: null },
    { key: 'critchance-triangle', label: 'Crit Chance Triangle', assetModule: require('../../assets/mod-templates/shapes-with-sets/critchance_triangle.png'), remoteUrl: null },
    { key: 'critchance-circle', label: 'Crit Chance Circle', assetModule: require('../../assets/mod-templates/shapes-with-sets/critchance_circle.png'), remoteUrl: null },
    { key: 'critchance-cross', label: 'Crit Chance Cross', assetModule: require('../../assets/mod-templates/shapes-with-sets/critchance_cross.png'), remoteUrl: null },
  ],
};
