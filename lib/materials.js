// Workpiece materials as the catalog's recommended-cutting-data tables name them (e.g. HP catalog
// printed pages 130–133), grouped by ISO material group. Example grades are the ones printed beside
// each material. No cutting values are stored here.
export const ISO_COLORS = { P: '#1b9be0', M: '#f2c500', K: '#d9302c', N: '#5cc23a', S: '#f08a1c', H: '#8a949c' };
export const ISO_NAMES = { P: 'Steel', M: 'Stainless steel', K: 'Cast iron', N: 'Non-ferrous', S: 'Heat-resistant alloys & titanium', H: 'Hardened steel' };

export const MATERIALS = [
  { id: 'low-carbon', iso: 'P', name: 'Low carbon steel', grades: '1018, 1020, 12L14, A36', hardness: 'up to 28 Rc' },
  { id: 'medium-carbon', iso: 'P', name: 'Medium carbon steel', grades: '1045, 1140, 1145', hardness: '28–38 Rc' },
  { id: 'alloy', iso: 'P', name: 'Alloy steel', grades: '4130, 4140, 4340', hardness: '28–44 Rc' },
  { id: 'die-tool', iso: 'P', name: 'Die / tool steel', grades: 'A2, D2, H13, P20', hardness: '28–44 Rc' },
  { id: 'ss-free', iso: 'M', name: 'Stainless — free machining', grades: '303, 416, 430F', hardness: 'up to 28 Rc' },
  { id: 'ss-austenitic', iso: 'M', name: 'Stainless — austenitic', grades: '304, 304L, 316', hardness: 'up to 28 Rc' },
  { id: 'ss-difficult', iso: 'M', name: 'Stainless — difficult to machine', grades: '316L, 317, 321, Nitronics', hardness: 'up to 28 Rc' },
  { id: 'ss-ph', iso: 'M', name: 'Stainless — precipitation hardened', grades: '15-5 PH, 17-4 PH, 13-8 PH', hardness: '' },
  { id: 'cobalt-chrome', iso: 'M', name: 'Cobalt chrome alloys', grades: '', hardness: '' },
  { id: 'duplex', iso: 'M', name: 'Duplex / super duplex', grades: '2205, 2507', hardness: '' },
  { id: 'gray-iron', iso: 'K', name: 'Gray cast iron', grades: 'ASTM A48 class 20–40', hardness: 'up to 240 HB' },
  { id: 'ductile-iron', iso: 'K', name: 'Ductile / malleable iron', grades: '60-40-18, 65-45-12', hardness: 'over 240 HB' },
  { id: 'aluminum', iso: 'N', name: 'Aluminum alloys', grades: '6061, 7075, 2024', hardness: '' },
  { id: 'high-si-al', iso: 'N', name: 'Aluminum, over 10% silicon', grades: 'cast alloys', hardness: '' },
  { id: 'copper-brass', iso: 'N', name: 'Copper, brass, bronze', grades: '', hardness: '' },
  { id: 'plastics', iso: 'N', name: 'Plastics & composites', grades: '', hardness: '' },
  { id: 'high-temp', iso: 'S', name: 'High-temp alloys', grades: 'Inconel 718, Waspaloy, Hastelloy', hardness: 'up to 42 Rc' },
  { id: 'titanium', iso: 'S', name: 'Titanium alloys', grades: '6Al-4V', hardness: 'up to 42 Rc' },
  { id: 'hardened-45', iso: 'H', name: 'Hardened steel 45–50 Rc', grades: 'A2, D2', hardness: '45–50 Rc' },
  { id: 'hardened-50', iso: 'H', name: 'Hardened steel 50–55 Rc', grades: 'A2, D2', hardness: '50–55 Rc' },
  { id: 'hardened-55', iso: 'H', name: 'Hardened steel over 55 Rc', grades: '', hardness: '55+ Rc' },
];
export const materialById = id => MATERIALS.find(m => m.id === id) || null;

// Machining operations as M.A. Ford's website names its application icons. Used only to match
// series to the job (from the website's application listing); they do not set ae/ap.
export const OPERATIONS = [
  { id: 'hem', name: 'High efficiency milling', web: 'High Efficiency Milling' },
  { id: 'rough', name: 'Traditional roughing', web: 'Traditional Roughing' },
  { id: 'slot', name: 'Slotting', web: 'Slotting' },
  { id: 'finish', name: 'Finishing', web: 'Finishing' },
  { id: '3d', name: '3D surfacing', web: '3D Surfacing' },
];
// Engagement quick picks (ae, ap as multiples of D), like the grid in M.A. Ford's app. The user picks one; nothing is applied automatically.
export const ENGAGEMENT_PRESETS = [
  [0.05, 2], [0.1, 2], [0.2, 2], [0.3, 1.5], [0.5, 1.5], [0.1, 1], [1, 0.25], [1, 0.5], [1, 1],
];
