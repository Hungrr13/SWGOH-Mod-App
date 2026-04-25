import { SLICE_REF, decodeModSet, decodePrimary } from '../constants/modData';
import { CHARS as RAW_CHARS } from './chars';

const seen = new Set();

export const DECODED_CHARS = RAW_CHARS.filter(c => {
  if (seen.has(c.name)) return false;
  seen.add(c.name);
  return true;
}).map(c => ({
  ...c,
  arrow: decodePrimary(c.arrow),
  triangle: decodePrimary(c.triangle),
  circle: decodePrimary(c.circle),
  cross: decodePrimary(c.cross),
  modSet: decodeModSet(c.modSet),
  buTri: c.buTri ? decodePrimary(c.buTri) : undefined,
  buCir: c.buCir ? decodePrimary(c.buCir) : undefined,
  buCro: c.buCro ? decodePrimary(c.buCro) : undefined,
  buArr: c.buArr ? decodePrimary(c.buArr) : undefined,
  buSet: c.buSet ? decodeModSet(c.buSet) : undefined,
}));

export const ENGINE_SLICE_REF = SLICE_REF.map(r => ({
  stat: r.s,
  max5: r.m5,
  max6: r.m6,
  good: r.g,
  great: r.gr,
}));
