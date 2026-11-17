import fs from 'node:fs/promises';
import path from 'node:path';
import index from '../knowledge/accessories/index.json' with {type:'json'};

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
