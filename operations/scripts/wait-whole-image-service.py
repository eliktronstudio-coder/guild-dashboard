import json,time,urllib.request
for attempt in range(36):
 try:
  with urllib.request.urlopen('https://xd-gpt-vision.onrender.com/health',timeout=20) as response: value=json.load(response)
  if 'whole-image-roster' in value.get('capabilities',[]):
   print('RENDER_WHOLE_IMAGE_CAPABILITY_READY_NO_INFERENCE',flush=True);break
 except Exception: pass
 print('Waiting for Render whole-image release',attempt+1,flush=True)
 time.sleep(10)
else: raise SystemExit('RENDER_WHOLE_IMAGE_RELEASE_NOT_READY')
