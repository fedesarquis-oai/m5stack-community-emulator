import fs from 'node:fs/promises';
import path from 'node:path';
import index from '../knowledge/accessories/index.json' with {type:'json'};

// These names open an inventory of possible matches. They never select a
// physical board, an accessory driver, or a flash target.
const kitNames = new Set([
  'kit', 'hackathon kit', 'm5stack hackathon kit', 'kit contents', 'box contents',
  "what's in the box", "what's in the kit", 'round sticker', 'round stickers',
  'nfc sticker', 'nfc stickers', 'little wrench', 'wrench', 'allen key', 'hex key',
  'dinbase', 'din rail clip', 'mounting clips', 'small pieces',
]);

// This catalog is authoring knowledge, never an executable peripheral registry.
// All filenames come from the reviewed package; a tool query is never a path.
export function accessoryCatalog() {
  return {
    reviewedOn:index.reviewed_on,
    support:{...index.support},
    guideQuery:index.guide_query,
    entries:index.entries.map(({file,aliases,...entry})=>({...entry,
      simulationSupported:false,firmwareAdapterImplemented:false})),
  };
}

export async function accessoryGuide(pluginRoot,query) {
  const key=query.trim().toLowerCase();
  const kitName = key.replaceAll('’', "'").replace(/[?!\.]+$/, '').replace(/\s+/g, ' ').trim();
  if (kitNames.has(kitName)) {
    const guide = await fs.readFile(path.join(pluginRoot, 'skills/m5stack-preview/references/kit-contents.md'), 'utf8');
    return {kind: 'kit_guide', title: 'CoreS3 and StickS3 hackathon kit', guide,
      next: 'Use the matching SKU for detailed wiring and support. Ask for a label or photo if a loose part could be something else.'};
  }
  if(key==='accessories')return {kind:'accessory_catalog',accessories:accessoryCatalog()};
  const entry=index.entries.find(record=>[record.id,record.sku,record.name,...record.aliases]
    .some(value=>value.toLowerCase()===key));
  if(!entry)return null;
  const accessory=JSON.parse(await fs.readFile(path.join(pluginRoot,'knowledge/accessories',entry.file),'utf8'));
  return {kind:'accessory',accessory,simulationSupported:false,firmwareAdapterImplemented:false,
    next:'Confirm the exact host, part revision, connector and power/pin mapping. Read skills/m5stack-preview/references/accessories.md. Documentation alone does not enable this peripheral; keep fixtures labeled and request an adapter extension before changing the shared emulator.'};
}

export function hostAccessoryReferences(profile) {
  return index.entries.filter(entry=>entry.candidate_host_profiles.includes(profile))
    .map(({id,sku,name})=>({id,sku,name,status:'knowledge_only',physicalValidation:'not_run'}));
}
