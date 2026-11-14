const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const dir='/root/xd-archive-import-20261114',input=fs.readFileSync(dir+'/archive-images.enc'),split=input.indexOf(10),header=JSON.parse(input.subarray(0,split));
const key=crypto.privateDecrypt({key:fs.readFileSync(dir+'/private.pem'),padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(header.key,'base64'));
const data=input.subarray(split+1),decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(header.iv,'base64'));decipher.setAuthTag(data.subarray(-16));fs.writeFileSync(dir+'/images.zip',Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]),{mode:0o600});
cp.execFileSync('python3',['-c',`import zipfile,pathlib
root=pathlib.Path('/root/xd-archive-import-20261114')
with zipfile.ZipFile(root/'images.zip') as z:
 for name in z.namelist():
  p=pathlib.PurePosixPath(name)
  if p.is_absolute() or '..' in p.parts: raise ValueError('Unsafe archive')
 z.extractall(root)
print('ARCHIVE_IMAGES_STAGED',len(list((root/'images').glob('*.png'))))`],{stdio:'inherit'});
