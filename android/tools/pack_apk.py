"""Package an unsigned APK: take the aapt2-linked base APK and add the dex files."""
import os
import sys
import time
import zipfile

base_apk, dex_dir, out_apk = sys.argv[1], sys.argv[2], sys.argv[3]

if os.path.exists(out_apk):
    os.remove(out_apk)

with zipfile.ZipFile(base_apk) as zin, zipfile.ZipFile(out_apk, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        if item.filename.startswith("META-INF/"):
            continue
        data = zin.read(item.filename)
        info = zipfile.ZipInfo(item.filename, date_time=item.date_time)
        info.compress_type = item.compress_type
        info.external_attr = item.external_attr
        zout.writestr(info, data)

    dex_files = sorted(f for f in os.listdir(dex_dir) if f.endswith(".dex"))
    stamp = time.localtime()[:6]
    for name in dex_files:
        # d8 emits classes.dex, classes2.dex, ... -> keep the same names in the APK
        info = zipfile.ZipInfo(name, date_time=stamp)
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(os.path.join(dex_dir, name), "rb") as fh:
            zout.writestr(info, fh.read())

print(f"packaged {out_apk} with {len(dex_files)} dex file(s)")
