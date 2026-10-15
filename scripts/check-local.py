import subprocess,json,time,pathlib,re
root=pathlib.Path(__file__).resolve().parents[1]; (root/'dist').mkdir(exist_ok=True); out=root/'dist/worker-local-results.json';results=[]
def docker(*args,check=True):
 p=subprocess.run(['docker',*args],capture_output=True,text=True,timeout=30)
 if check and p.returncode:raise RuntimeError(p.stderr+p.stdout)
 return p
for mode in ['normal','worker']:
 name='staticphp-local-'+mode+'-'+str(__import__('os').getpid())
 try:
  docker('run','-d','--name',name,'--platform','linux/arm64','--read-only','--tmpfs','/tmp:rw,nosuid,size=64m','--cap-drop','ALL','--security-opt','no-new-privileges','-e','FRANKENPHP_MODE='+mode,'staticphp-lambda-web-poc:worker-check')
  for _ in range(100):
   p=docker('logs',name);logs=p.stdout+p.stderr
   if '"event":"ready"' in logs:break
   if 'startup_timeout' in logs:raise RuntimeError(logs)
   time.sleep(.1)
  else:raise RuntimeError('not ready: '+logs)
  smoke=docker('exec',name,'node','scripts/smoke.js');print(mode,'HTTP smoke passed',flush=True)
  comparison=docker('exec','-e','EXPECT_MODE='+mode,name,'node','scripts/compare-modes.js');sample=json.loads(comparison.stdout);print(json.dumps(sample),flush=True)
  docker('stop','--timeout','1',name)
  p=docker('logs',name);logs=p.stdout+p.stderr
  events=[json.loads(line) for line in logs.splitlines() if line.startswith('{"event"')]
  assert any(e['event']=='child_exit' and e['code']==0 for e in events)
  record={'mode':mode,'state_comparison':sample,'launcher_events':events,'exit_code':docker('inspect','--format','{{.State.ExitCode}}',name).stdout.strip()}
  if mode=='worker':
   assert re.search(r'"worker_threads"\s*:\s*1',logs),logs
   assert not re.search(r'"worker_threads"\s*:\s*[2-9]',logs)
   docker('start',name)
   # The second comparison starts a new worker and must reset state to 1.
   for _ in range(100):
    p=docker('logs',name)
    if (p.stdout+p.stderr).count('"event":"ready"')==2:break
    time.sleep(.1)
   restarted=docker('exec','-e','EXPECT_MODE=worker',name,'node','scripts/compare-modes.js')
   sample2=json.loads(restarted.stdout);assert sample2['samples'][0]['boot_id']!=sample['samples'][0]['boot_id']
   record['after_restart']=sample2;print('worker restart resets state',flush=True)
   docker('stop','--timeout','1',name)
  results.append(record);out.write_text(json.dumps(results,indent=2)+'\n')
 finally:docker('rm','-f',name,check=False)
print('Both modes passed; containers removed',flush=True)
