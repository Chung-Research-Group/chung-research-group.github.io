import copy,datetime as dt,json,sys,unittest
from pathlib import Path
root=Path(__file__).resolve().parent.parent
from slurm_node_gpu import observation,attach,master_source
from detailed_status import project_row

class GPUNodeTests(unittest.TestCase):
 def setUp(self):
  cards=[{'uuid':'GPU-'+str(i),'index':str(i),'name':'NVIDIA A100-PCIE-40GB','memory.total':'40960','memory.free':'40447','memory.used':'1','utilization.gpu':'0'} for i in range(2)]
  self.raw={'nvidia_smi_xml':{'exit_code':0},'hostname':'SG11','gpus':[{'uuid':g['uuid'],'processes':[]} for g in cards],'samples':[{'result':{'exit_code':0},'gpus':copy.deepcopy(cards)} for _ in range(3)]}
  self.raw['completed_at_utc']=dt.datetime.now(dt.timezone.utc).isoformat()
 def test_real_inventory(self):
  o=observation(self.raw,2);self.assertEqual(o['status'],'ok');self.assertEqual(len(o['gpus']),2)
  self.assertEqual([g['memory_total_gib'] for g in o['gpus']],[40,40])
 def test_failed_inventory(self):
  for variant in ['exit','count','duplicate','missing_sample','negative_free','nan_rate','naive_time','old_time']:
   with self.subTest(variant=variant):
    r=copy.deepcopy(self.raw)
    if variant=='exit':r['nvidia_smi_xml']['exit_code']=18
    if variant=='count':r['gpus'].pop()
    if variant=='duplicate':r['gpus'][1]['uuid']=r['gpus'][0]['uuid']
    if variant=='missing_sample':r['samples'].pop()
    if variant=='negative_free':r['samples'][-1]['gpus'][0]['memory.free']='-1'
    if variant=='nan_rate':r['samples'][0]['gpus'][0]['utilization.gpu']='nan'
    if variant=='naive_time':r['completed_at_utc']='2026-10-21T10:00:00'
    if variant=='old_time':r['completed_at_utc']='2026-10-01T10:00:00+00:00'
    self.assertEqual(observation(r,2)['status'],'failed')
    self.assertEqual(observation(r,2)['gpus'],[])
 def test_attach_retains_slurm_allocations(self):
  record={'status':'ok','nodes':[{'name':'SG11','configured_gpus':2,'allocated_gpus':1}]}
  calls=[]
  def collect(*args,**kw):calls.append(args);return {'status':'ok','node_gpu':self.raw}
  attach(record,{'host':'sg','ssh_target':'master','ssh_port':7777,'gpu_nodes':['SG11']},collect,'source')
  self.assertTrue(record['gpu_query_ok']);self.assertEqual(record['nodes'][0]['allocated_gpus'],1);self.assertEqual(len(calls),1)
 def test_attach_failure_cannot_suppress_scheduler(self):
  r={'status':'ok','nodes':[{'name':'SG11','configured_gpus':2}]}
  def collect(*a,**k):raise OSError('offline')
  attach(r,{'host':'sg','ssh_target':'master','ssh_port':7777,'gpu_nodes':['SG11']},collect,'source')
  self.assertEqual(r['status'],'ok');self.assertFalse(r['gpu_query_ok']);self.assertEqual(r['nodes'][0]['gpu_observation']['gpus'],[])
 def test_unapproved_node_is_not_contacted(self):
  r={'status':'ok','nodes':[{'name':'SG12','configured_gpus':2}]}
  def collect(*a,**k):self.fail('unexpected SSH')
  attach(r,{'gpu_nodes':['SG12']},collect,'source')
  self.assertNotIn('gpu_observation',r['nodes'][0])
  with self.assertRaises(ValueError):master_source('SG11;hostname','source')
 def test_public_projection_removes_raw_identity_and_network_fields(self):
  o=observation(self.raw,2)
  o['private']='secret';o['gpus'][0].update(uuid='private-uuid',password='secret')
  r={'kind':'slurm_cluster','nodes':[{'name':'SG11','gpu_observation':o}], 'node_gpu_raw':{'secret':'private'}}
  p=project_row(r);text=json.dumps(p)
  self.assertNotIn('private',text);self.assertNotIn('password',text);self.assertNotIn('uuid',text)
  self.assertEqual(len(p['nodes'][0]['gpu_observation']['gpus']),2)
  self.assertEqual(p['nodes'][0]['gpu_observation']['gpus'][0]['processes'],[])
if __name__=='__main__':unittest.main()
