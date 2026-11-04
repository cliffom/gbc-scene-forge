/** Generic fixtures for opening and layered visibility measurements; no host-game content. */
import { execFileSync } from 'node:child_process';

export function createOpeningFixture(python: string, root: string) {
  execFileSync(python, [
    '-I',
    '-c',
    `
import sys, base64
from pathlib import Path
from gbc_scene_forge.project.application import Project
from gbc_scene_forge.artwork import layers, editable
p=Project.create(Path(sys.argv[1]),'Artwork opening')
a=p.artwork.documents
for key,w,h,count in [('small',16,16,0),('large',750,1050,0),('layered',384,544,3)]:
    c=a.create(key,key.title(),'sprite',w,h,p.catalog()['revision'])
    raw=bytes([40,90,120,255])*(w*h)
    if count:
        c=layers.edit(c,[layers.item(f'Layer {i}') for i in range(count)])
        c=layers.reseal(c,{item['id']:bytes([40+i*20,90,120,128 if i else 255])*(w*h) for i,item in enumerate(c['descriptor']['layers']['items'])})
    else:
        c.pop('revision'); c['rgba']=base64.b64encode(raw).decode(); c=editable.seal(c)
    a.save(c)
`,
    root,
  ]);
}
