#!/usr/bin/env python3
"""
Optional offline helper: same rule-based invoice extractor used in the app.
Useful for unit-testing OCR output or batch processing text files.

Usage:
  python scripts/invoice_parser.py sample_ocr.txt
  echo "ACME ... Total: 1234.56" | python scripts/invoice_parser.py
"""

import re
import json
import sys
from datetime import datetime


def extract_invoice_json(raw_text: str) -> dict:
    text = (raw_text or "").replace("\r", "")
    lines = [l.strip() for l in text.split("\n") if l.strip()]

    amount_re = re.compile(
        r"(?:total|amount|grand\s*total|balance\s*due|sum)[^\d]*([₹$€£]?\s*[\d,]+\.?\d*)",
        re.I,
    )
    date_re = re.compile(
        r"(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})|(\d{4}[/\-\.]\d{1,2}[/\-\.]\d{1,2})"
    )
    inv_re = re.compile(
        r"(?:invoice\s*(?:no|number|#|num)?|inv\.?\s*#?|bill\s*no)[:\s#]*([A-Z0-9\-/]+)",
        re.I,
    )
    gst_re = re.compile(r"(?:GSTIN|GST|TAX\s*ID)[:\s]*([0-9A-Z]{15})", re.I)

    vendor = lines[0] if lines else "Unknown Vendor"
    for line in lines[:5]:
        if len(line) > 3 and not line.isdigit() and not date_re.search(line):
            vendor = line
            break

    amount_m = amount_re.search(text)
    date_m = date_re.search(text)
    inv_m = inv_re.search(text)
    gst_m = gst_re.search(text)

    items = []
    item_re = re.compile(r"^(.+?)\s+([\d,]+\.?\d*)\s*$")
    for line in lines:
        m = item_re.match(line)
        if m and not re.search(r"total|amount|subtotal|tax|gst", m.group(1), re.I):
            try:
                amt = float(m.group(2).replace(",", ""))
            except ValueError:
                amt = 0.0
            items.append({"description": m.group(1).strip(), "amount": amt})

    result = {
        "vendor": vendor[:80],
        "invoice_number": inv_m.group(1) if inv_m else None,
        "date": (date_m.group(1) or date_m.group(2)) if date_m else None,
        "total_amount": amount_m.group(1).replace(" ", "") if amount_m else None,
        "currency": (re.search(r"[₹$€£]", text) or ["INR"])[0],
        "gstin": gst_m.group(1) if gst_m else None,
        "items": items[:20],
        "raw_text_preview": text[:500],
        "confidence": "rule-based",
        "extracted_at": datetime.utcnow().isoformat() + "Z",
    }

    return {k: v for k, v in result.items() if v is not None and v != ""}


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8", errors="ignore") as f:
            text = f.read()
    else:
        text = sys.stdin.read()

    data = extract_invoice_json(text)
    print(json.dumps(data, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
