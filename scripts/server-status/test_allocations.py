import json,unittest
from pathlib import Path
from inspect_slurm_resources import allocated_gpu,gpu_count,memory_tracking,normalize
from detailed_status import project_row

class AllocationTests(unittest.TestCase):
 def test_gres_used_despite_missing_gpu_tres(self):
  self.assertEqual(allocated_gpu({'GresUsed':'gpu:A100:2(IDX:0-1)','AllocTRES':'cpu=128'},2),2)
 def test_zero_is_explicit(self):
  self.assertEqual(allocated_gpu({'GresUsed':'gpu:A100:0(IDX:N/A)','AllocTRES':'cpu=128'},2),0)
  self.assertIsNone(allocated_gpu({'AllocTRES':'cpu=128'},2))
 def test_parenthesized_comma_and_multiple_models(self):
  self.assertEqual(gpu_count('gpu:A100:2(IDX:0,2),gpu:H100:1(IDX:3)'),3)
 def test_conflicts_and_bad_counters_are_unknown(self):
  for r in [{'GresUsed':'gpu:A100:2','AllocTRES':'gres/gpu=1'}, {'GresUsed':'gpu:A100:3'}, {'GresUsed':'gpu:A100:-1'}, {'GresUsed':'malformed'}]:
   self.assertIsNone(allocated_gpu(r,2))
 def test_tres_fallback_and_non_gpu_nodes(self):
  self.assertEqual(allocated_gpu({'AllocTRES':'cpu=2,gres/gpu=1'},2),1)
  self.assertEqual(allocated_gpu({},0),0)
 def test_memory_tracking_requires_explicit_select_flag(self):
  self.assertFalse(memory_tracking('CR_CORE'))
  self.assertTrue(memory_tracking('CR_CORE_MEMORY,CR_ONE_TASK_PER_CORE'))
  self.assertTrue(memory_tracking('CR_Memory'))
  self.assertIsNone(memory_tracking(None))
 def test_ram_and_tracking_flag_survive_public_projection(self):
  r={'kind':'slurm_cluster','memory_allocated_bytes':0,'memory_total_bytes':2048,'memory_allocation_tracked':False,'nodes':[]}
  p=project_row(r);self.assertEqual(p['memory_allocated_bytes'],0);self.assertFalse(p['memory_allocation_tracked'])
 def test_missing_ram_does_not_become_zero(self):
  r=normalize('NodeName=SG11 CPUAlloc=1 CPUTot=2 RealMemory=100 State=MIXED Gres=gpu:A100:2 GresUsed=gpu:A100:2(IDX:0-1)','', 'SG11|gpu|mix|2|100|gpu:A100:2',{'nodes':True,'queue':True,'sinfo':True})
  self.assertEqual(r['allocated_gpus'],2);self.assertIsNone(r['memory_allocated_bytes'])
if __name__=='__main__':unittest.main()
