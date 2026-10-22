"""Admission tests: no hardware, downloads or subprocesses are touched."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('hardware',Path(__file__).resolve().parents[1]/'scripts/hardware.py');hw=importlib.util.module_from_spec(spec);spec.loader.exec_module(hw)
class WorkflowTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  self.patch=patch.object(hw,'ROOT',self.root);self.patch.start();self.addCleanup(self.patch.stop)
  for folder in ['src','hardware','scripts','data']:(self.root/folder).mkdir()
  (self.root/'data/device-profiles.json').write_text(json.dumps(list(hw.PROFILES.values())))
  (self.root/'src/user_app.hpp').write_text('app revision 1');(self.root/'scripts/hardware.py').write_text('recipe revision 1')
  (self.root/'firmware.json').write_text(json.dumps({'version':1,'requires':['display','microphone'],'audioDuplex':'exclusive'}))
 def receipt(self):
  sha=hw.source_hash();folder=self.root/'.build/firmware/cores3se'/sha[:16];(folder/'artifacts').mkdir(parents=True)
  artifacts=[]
  for name,offset in [('device_app.ino.bootloader.bin',0),('device_app.ino.partitions.bin',0x8000),('boot_app0.bin',0xe000),('device_app.ino.bin',0x10000)]:
   p=folder/'artifacts'/name;p.write_bytes(b'bounded firmware');artifacts.append(dict(file=name,offset=offset,bytes=p.stat().st_size,sha256=hw.digest(p)))
  p=folder/'receipt.json';hw.save(p,dict(profile='cores3se',source_sha256=sha,build_id=sha[:16],artifacts=artifacts));return p
 def test_stale_source_cannot_install(self):
  p=self.receipt();hw.reviewed_build(p);(self.root/'src/user_app.hpp').write_text('revision 2')
  with patch.object(hw,'check_chip') as chip:
   with self.assertRaisesRegex(ValueError,'Source changed'):hw.install('port','serial',p,'unused')
   chip.assert_not_called()
 def test_tampered_binary_and_offset_rejected(self):
  p=self.receipt();binary=p.parent/'artifacts/device_app.ino.bin';binary.write_bytes(b'changed')
  with self.assertRaisesRegex(ValueError,'artifact changed'):hw.reviewed_build(p)
  data=json.loads(p.read_text());data['artifacts'][0]['offset']=123;hw.save(p,data)
  with self.assertRaisesRegex(ValueError,'layout'):hw.reviewed_build(p)
 def test_unsupported_app_requirements(self):
  self.assertEqual(hw.requirements()['audioDuplex'],'exclusive')
  p=self.root/'firmware.json';p.write_text(json.dumps(dict(version=1,requires=['ble'])))
  with self.assertRaisesRegex(ValueError,'ble'):hw.requirements()
  p.write_text(json.dumps(dict(version=1,requires=['microphone'],audioDuplex='full')))
  with self.assertRaisesRegex(ValueError,'full duplex'):hw.requirements()
 def test_volume_bounds(self):
  p=self.root/'firmware.json'
  for value in [-1,256,True,1.5,'96']:
   p.write_text(json.dumps(dict(version=1,requires=['speaker'],speakerVolume=value)))
   with self.assertRaisesRegex(ValueError,'speakerVolume'):hw.requirements()
  p.write_text(json.dumps(dict(version=1,requires=['speaker'],speakerVolume=96)))
  self.assertEqual(hw.requirements()['speakerVolume'],96)
 def test_changed_port_identity_is_rejected(self):
  with patch.object(hw,'ports',return_value={'ports':[dict(port='/dev/cu.usbmodem1',serial='aa:bb',vid=0x303a,pid=0x1001)]}):
   with self.assertRaisesRegex(ValueError,'identity'):hw.target('/dev/cu.usbmodem1','another')
 def test_backup_from_different_device_is_rejected(self):
  folder=self.root/'.hardware-backups/first';folder.mkdir(parents=True);(folder/'flash.bin').write_bytes(b'a')
  p=folder/'receipt.json';hw.save(p,dict(usb_serial='other',profile='cores3se',verified=True))
  with self.assertRaisesRegex(ValueError,'Backup does not match'):hw.reviewed_backup(p,'target')
 def test_target_memory_and_capabilities_are_distinct(self):
  atom=hw.profile_config('atoms3r');core=hw.profile_config('cores3se')
  self.assertEqual(atom['flashBytes'],8*1024*1024);self.assertEqual(core['flashBytes'],16*1024*1024)
  self.assertIn('PSRAM=opi',atom['fqbn']);self.assertIn('PSRAM=enabled',core['fqbn'])
  self.assertNotEqual(hw.source_hash('atoms3r'),hw.source_hash('cores3se'))
  p=self.root/'firmware.json'
  p.write_text(json.dumps(dict(version=1,requires=['display','buttons','motion'],audioDuplex='none')))
  hw.requirements('atoms3r')
  with self.assertRaisesRegex(ValueError,'motion'):hw.requirements('cores3se')
  for feature in ['touch','microphone','speaker','tone']:
   p.write_text(json.dumps(dict(version=1,requires=[feature])))
   with self.assertRaisesRegex(ValueError,feature):hw.requirements('atoms3r')
 def test_network_is_supported_on_each_firmware_target(self):
  for profile in ['cores3se','atoms3r','sticks3']:
   (self.root/'firmware.json').write_text(json.dumps(dict(version=1,requires=['network'])))
   hw.requirements(profile)
 def test_network_provisioning_checks_current_and_legacy_receipts(self):
  local=self.root/'.local';local.mkdir()
  legacy=self.root/'prior-build.json';legacy.write_text(json.dumps({'profile':'cores3se'}))
  installed={'serial':'aa:bb','build_id':'build123','receipt':str(legacy)}
  with patch.object(hw,'target'),patch.object(hw,'python',return_value='python'),patch.object(hw.subprocess,'check_output',return_value='{}') as process:
   for profile_field in [{},{'profile':'cores3se'}]:
    (local/'hardware-installed.json').write_text(json.dumps({**installed,**profile_field}))
    hw.network_configure('port','AA:BB','cores3se',forget=True)
    self.assertEqual(process.call_args.args[0][-1],'--forget')
    process.reset_mock()
    with self.assertRaisesRegex(ValueError,'identity/profile'):hw.network_configure('port','aa:bb','sticks3')
    process.assert_not_called()
 def test_network_build_uses_public_configuration_only(self):
  import re
  (self.root/'firmware.json').write_text(json.dumps(dict(version=1,requires=['network'],audioDuplex='none')))
  hw.requirements('atoms3r')
  (self.root/'.local').mkdir();(self.root/'.local/network-credentials.json').write_text('PRIVATE-SENTINEL')
  (self.root/'data/network.json').write_text(json.dumps(dict(version=1,services={'api':dict(origin='http://192.0.2.1:8080',allowInsecure=True,bearerToken=True)})))
  stage=self.root/'stage';stage.mkdir();hw.write_network_config(stage,True)
  header=(stage/'network_config.hpp').read_text();self.assertNotIn('PRIVATE-SENTINEL',header);self.assertIn('http://192.0.2.1:8080',header)
  self.assertNotIn(self.root/'.local/network-credentials.json',hw.source_files())
  before=hw.source_hash('atoms3r');(self.root/'.local/network-credentials.json').write_text('CHANGED-PRIVATE');self.assertEqual(before,hw.source_hash('atoms3r'))
  (self.root/'data/network.json').write_text(json.dumps(dict(version=1,services={'api':dict(origin='https://example.com')})))
  with self.assertRaisesRegex(ValueError,'CA PEM'):hw.write_network_config(stage,True)
 def test_stick_target_has_its_own_identity_and_capabilities(self):
  stick=hw.profile_config('sticks3')
  self.assertEqual(stick['boardEnum'],'board_M5StickS3')
  self.assertEqual(stick['flashBytes'],8*1024*1024)
  self.assertIn('PSRAM=opi',stick['fqbn'])
  self.assertEqual(stick['audioDuplex'],'exclusive')
  self.assertTrue(hw.PROFILES['sticks3']['secondaryButton'])
  for feature in ['display','buttons','motion','microphone','speaker','network']:
   (self.root/'firmware.json').write_text(json.dumps(dict(version=1,requires=[feature])))
   hw.requirements('sticks3')
  for feature in ['touch','ble']:
   (self.root/'firmware.json').write_text(json.dumps(dict(version=1,requires=[feature])))
   with self.assertRaisesRegex(ValueError,feature):hw.requirements('sticks3')
 def test_secondary_diagnostic_rejects_a_board_without_that_button(self):
  with patch.object(hw,'target'),patch.object(hw.subprocess,'check_output') as process:
   with self.assertRaisesRegex(ValueError,'secondary button'):hw.monitor('port','serial',1,'BUTTON2 50','atoms3r')
   process.assert_not_called()
 def test_uiflow_identity_is_not_accepted_as_loader_identity(self):
  with patch.object(hw,'ports',return_value={'ports':[dict(port='port',serial='7ce8b1e3eb4c0000',vid=0x303a,pid=0x832b)]}):
   with self.assertRaisesRegex(ValueError,'green LED'):hw.target('port','7ce8b1e3eb4c0000')
 def test_wrong_profile_build_is_rejected_before_chip_access(self):
  p=self.receipt()
  with patch.object(hw,'check_chip') as chip:
   with self.assertRaises(ValueError):hw.install('port','serial',p,'unused','atoms3r')
   chip.assert_not_called()
if __name__=='__main__':unittest.main()
