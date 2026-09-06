#!/usr/bin/env python3
"""Inject CAMERA permissions + ML Kit OCR model meta-data into AndroidManifest.xml."""
import re
import sys
from pathlib import Path

path = Path("android/app/src/main/AndroidManifest.xml")
if not path.exists():
    print(f"WARNING: {path} not found")
    sys.exit(0)

content = path.read_text(encoding="utf-8")
changed = False

if "android.permission.CAMERA" not in content:
    perms = """
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
"""
    content, n = re.subn(r"(<manifest[^>]*>)", r"\1" + perms, content, count=1)
    if n:
        changed = True
        print("Camera/media permissions injected")
    else:
        print("Could not find <manifest> tag for permissions")
else:
    print("CAMERA permission already present")

# ML Kit: download OCR model on install from Play (optional but recommended)
meta = (
    '        <meta-data\n'
    '            android:name="com.google.mlkit.vision.DEPENDENCIES"\n'
    '            android:value="ocr" />\n'
)
if "com.google.mlkit.vision.DEPENDENCIES" not in content:
    content2, n2 = re.subn(
        r"(<application[^>]*>)",
        r"\1\n" + meta,
        content,
        count=1,
    )
    if n2:
        content = content2
        changed = True
        print("ML Kit OCR meta-data injected")
    else:
        print("Could not find <application> tag for ML Kit meta-data")
else:
    print("ML Kit meta-data already present")

if changed:
    path.write_text(content, encoding="utf-8")

print("--- AndroidManifest head ---")
print(path.read_text(encoding="utf-8")[:1200])
