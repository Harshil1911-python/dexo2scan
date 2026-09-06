#!/usr/bin/env python3
"""Inject CAMERA + media permissions into AndroidManifest.xml if missing."""
import re
import sys
from pathlib import Path

path = Path("android/app/src/main/AndroidManifest.xml")
if not path.exists():
    print(f"WARNING: {path} not found")
    sys.exit(0)

content = path.read_text(encoding="utf-8")

if "android.permission.CAMERA" in content:
    print("CAMERA permission already present")
    sys.exit(0)

perms = """
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
"""

new_content, n = re.subn(
    r"(<manifest[^>]*>)",
    r"\1" + perms,
    content,
    count=1,
)

if n == 0:
    print("Could not find <manifest> tag")
    sys.exit(1)

path.write_text(new_content, encoding="utf-8")
print("Permissions injected into AndroidManifest.xml")
print(path.read_text(encoding="utf-8")[:800])
