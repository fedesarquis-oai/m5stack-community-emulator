"""Private setup behavior, without opening serial or using actual credentials."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('net',Path(__file__).resolve().parents[1]/'hardware/network_configure.py')
net=importlib.util.module_from_spec(spec);spec.loader.exec_module(net)
class SetupTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  (self.root/'data').mkdir();(self.root/'data/network.json').write_text(json.dumps({'version':1,'services':{'api':{'origin':'https://example.com','bearerToken':True}}}))
 def test_template_is_private_and_never_overwrites(self):
  r=net.prepare(self.root);p=Path(r['path']);self.assertEqual(p.stat().st_mode&0o777,0o600)
  with self.assertRaises(ValueError):net.read_private(p)
  value={'wifi':{'ssid':'test-network','password':'test-private-password'},'persistOnDevice':True,'tokens':{'api':'test-private-token'}}
  p.write_text(json.dumps(value));result=net.prepare(self.root)
  self.assertFalse(result['created']);self.assertNotIn('test-private',json.dumps(result));self.assertEqual(net.read_private(p),value)
 def test_symlink_and_world_readable_files_rejected(self):
  p=Path(net.prepare(self.root)['path']);p.chmod(0o644)
  with self.assertRaises(ValueError):net.read_private(p)
  with self.assertRaises(ValueError):net.prepare(self.root)
  target=self.root/'elsewhere';p.rename(target);p.symlink_to(target)
  with self.assertRaises((OSError,ValueError)):net.read_private(p)
  with self.assertRaises(ValueError):net.prepare(self.root)
 def test_unfilled_token_rejected_before_serial(self):
  p=Path(net.prepare(self.root)['path']);value=json.loads(p.read_text());value['wifi']={'ssid':'test','password':'test-password'};p.write_text(json.dumps(value))
  with self.assertRaises(ValueError):net.read_private(p)
if __name__=='__main__':unittest.main()
