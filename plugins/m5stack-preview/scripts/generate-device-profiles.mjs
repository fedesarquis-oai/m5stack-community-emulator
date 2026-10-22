import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=new URL('../',import.meta.url);
const profiles=JSON.parse(await fs.readFile(new URL('runtime/data/device-profiles.json',root),'utf8'));
const ids=new Set();
for(const p of profiles){
  assert.match(p.id,/^[a-z0-9]+$/);assert.ok(!ids.has(p.id));ids.add(p.id);
  assert.ok(Number.isInteger(p.width)&&p.width>=128&&p.width<=1024);
  assert.ok(Number.isInteger(p.height)&&p.height>=128&&p.height<=1024);
  assert.ok(['button','touch'].includes(p.primaryInput));
  assert.ok(['none','buzzer','speaker'].includes(p.audioOutput));
  assert.equal(typeof p.microphone,'boolean');assert.equal(typeof p.motion,'boolean');
  assert.equal(p.hardware.microphone,p.microphone);assert.equal(p.hardware.audioOutput,p.audioOutput);
}
const rows=profiles.map(p=>`    {"${p.id}", ${p.width}, ${p.height}, ${p.primaryInput==='touch'}, ${p.motion}, ${p.microphone}, "${p.audioOutput}", ${p.touchHeight??p.height}, ${p.secondaryButton===true}},`).join('\n');
const header=`#pragma once
// Generated from runtime/data/device-profiles.json. Run scripts/generate-device-profiles.mjs.
#include <string_view>
namespace preview {
struct HardwareProfile {
    const char* id; unsigned width, height; bool touch, motion, microphone;
    const char* audio_output; unsigned touch_height; bool secondary_button;
};
inline constexpr HardwareProfile HARDWARE_PROFILES[]={
${rows}
};
inline const HardwareProfile* hardwareProfile(std::string_view id) {
    for(const auto& profile:HARDWARE_PROFILES)if(id==profile.id)return &profile;
    return nullptr;
}
} // namespace preview
`;
const file=new URL('runtime/src/device_profiles.generated.hpp',root);
export async function generateDeviceProfiles({check=false}={}) {
if(check)assert.equal(await fs.readFile(file,'utf8'),header,'Device registry changed; regenerate the C++ table.');
else await fs.writeFile(file,header);
return profiles.length;
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const count=await generateDeviceProfiles({check:process.argv.includes('--check')});
  console.log('Device registry: '+count+' exact profiles verified.');
}
