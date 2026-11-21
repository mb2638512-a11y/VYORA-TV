import zipfile
import sys

apk = sys.argv[1] if len(sys.argv) > 1 else 'E:/Vyora TV/android/out/VyoraTV-1.0.0.apk'
z = zipfile.ZipFile(apk)
names = z.namelist()
assets = [n for n in names if n.startswith('assets/')]
res = [n for n in names if n.startswith('res/')]
dex = [n for n in names if n.endswith('.dex')]
print('total entries :', len(names))
print('dex           :', dex)
print('res files     :', len(res), res[:6])
print('assets        :', len(assets))
for a in assets[:12]:
    print('   ', a, z.getinfo(a).file_size)
has_index = 'assets/index.html' in names
has_data = 'assets/data/index.json' in names
countries = len([n for n in names if n.startswith('assets/data/channels/')])
print('index.html    :', has_index)
print('data/index    :', has_data)
print('country files :', countries)
print('manifest      :', 'AndroidManifest.xml' in names)
print('resources.arsc:', 'resources.arsc' in names)
