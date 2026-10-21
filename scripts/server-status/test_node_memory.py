import copy,datetime as dt,json,unittest
from slurm_node_memory import normalize,observation,master_source,attach
NOW=dt.datetime(2026,10,21,14,0,tzinfo=dt.timezone.utc)
NODES=['SG%02d'%i for i in range(1,17)]
def sample(n,available=198_000_000_000,total=202_000_000_000):
 return {'node':n,'observation':{'hostname':n,'checked_at_utc':NOW.isoformat(),'total_bytes':total,'available_bytes':available}}
def record():return {'status':'ok','nodes':[{'name':n,'memory_total_bytes':140_000_000_000} for n in NODES]}
class MemoryTests(unittest.TestCase):
 def test_complete_sum_physical_not_slurm_configured(self):
  r=record();normalize(r,NODES,[sample(n) for n in NODES],NOW)
  m=r['memory_observation'];self.assertEqual(m['status'],'ok');self.assertEqual(m['observed_count'],16)
  self.assertEqual(m['available_bytes'],16*198_000_000_000);self.assertEqual(m['total_bytes'],16*202_000_000_000)
  self.assertGreater(m['available_bytes'],sum(n['memory_total_bytes'] for n in r['nodes']))
 def test_partial_not_full_sum_and_missing_not_zero(self):
  r=record();normalize(r,NODES,[sample(n) for n in NODES[10:14]],NOW);m=r['memory_observation']
  self.assertEqual(m['status'],'partial');self.assertIsNone(m['available_bytes']);self.assertIsNone(m['total_bytes'])
  self.assertEqual(m['observed_available_bytes'],4*198_000_000_000);self.assertEqual(m['observed_count'],4)
  self.assertNotIn('available_bytes',r['nodes'][0]['memory_observation'])
 def test_duplicate_or_wrong_hostname_is_not_counted(self):
  for rows in [[sample(NODES[0]),sample(NODES[0])],[dict(sample(NODES[0]),observation=sample(NODES[1])['observation'])]]:
   r=record();normalize(r,NODES,rows,NOW);self.assertEqual(r['memory_observation']['observed_count'],0)
 def test_bad_inventory_rejected(self):
  r=record();r['nodes'][-1]['name']='SG01';normalize(r,NODES,[sample(n) for n in NODES],NOW)
  self.assertEqual(r['memory_observation']['status'],'failed')
 def test_invalid_values_and_stale_timestamps(self):
  raw=sample('SG11')['observation']
  for field,value in [('available_bytes',-1),('available_bytes',raw['total_bytes']+1),('available_bytes',True),('total_bytes',0),('available_bytes',None),('checked_at_utc','2026-10-21T13:54:00Z'),('checked_at_utc','2026-10-21T14:06:00Z'),('checked_at_utc','2026-10-21T14:00:00')]:
   self.assertEqual(observation(dict(raw,**{field:value}),'SG11',NOW)['status'],'failed',(field,value))
 def test_real_zero_is_valid(self):self.assertEqual(observation(sample('SG11',0)['observation'],'SG11',NOW)['available_bytes'],0)
 def test_command_injection_and_duplicate_nodes_rejected(self):
  for nodes in [['SG11;id'],['SG11','SG11'],[]]:
   with self.assertRaises(ValueError):master_source(nodes)
 def test_blocked_nodes_are_not_retried(self):
  calls=[];r=record()
  c={'host':'sg','ssh_target':'bossman@example','ssh_port':7777,'memory_nodes':NODES,'memory_query_nodes':['SG11','SG12','SG13','SG14'],'memory_access_blocked':{'SG01':'access_policy','SG02':'host_key_unverified'}}
  def collect(*args,**kwargs):calls.append(kwargs['input_source']);return {'status':'ok','node_memory':[]}
  attach(r,c,collect);self.assertEqual(len(calls),1);self.assertNotIn("'SG01'",calls[0]);self.assertNotIn("'SG02'",calls[0])
  self.assertEqual(r['nodes'][0]['memory_observation']['reason'],'access_policy')
  self.assertEqual(r['nodes'][1]['memory_observation']['reason'],'host_key_unverified')
 def test_public_projection_drops_hidden_memory_fields(self):
  from detailed_status import project_row
  r=record();r.update(host='sg',kind='slurm_cluster');normalize(r,NODES,[sample(n) for n in NODES],NOW)
  r['memory_observation']['secret']='PRIVATE';r['nodes'][0]['memory_observation']['secret']='PRIVATE'
  safe=project_row(r);self.assertNotIn('PRIVATE',json.dumps(safe));self.assertEqual(safe['memory_observation']['observed_count'],16)
if __name__=='__main__':unittest.main()
