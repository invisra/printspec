import type {PrintSpec} from './types.js'; export function normalizePrintSpec(spec:PrintSpec):PrintSpec{return JSON.parse(JSON.stringify({...spec,units:spec.units??'mm'}));}
