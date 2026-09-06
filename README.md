# Dexo2Scan – Capacitor + ML Kit OCR + Local Invoice Understanding

Mobile app that:

1. Captures paper bills / invoices with the phone camera (or gallery)
2. Runs **on-device OCR** via Google ML Kit (Android) / Apple Vision (iOS) through `@jcesarmobile/capacitor-ocr`
3. Extracts structured JSON (vendor, date, amount, invoice number, items, GSTIN…) using a lightweight offline parser
4. Stores results in **IndexedDB**
5. Builds an **Android APK** automatically with **GitHub Actions**

> **Local LLM note**  
> The extraction step is currently a high-quality rule-based parser that produces the same JSON shape a small Qwen / Gemma model would.  
> To swap in a real on-device model (Gemma 2B/4B-class or Qwen), install `@capgo/capacitor-llm` and replace the body of `extractWithLocalLLM()` in `src/app.js`.

## Tech stack

| Layer              | Technology                                      |
|--------------------|-------------------------------------------------|
| UI                 | HTML + CSS + vanilla JS                         |
| Native bridge      | Capacitor 6                                     |
| Camera             | `@capacitor/camera`                             |
| OCR                | `@jcesarmobile/capacitor-ocr` (ML Kit / Vision) |
| Storage            | IndexedDB                                       |
| Invoice → JSON     | Rule-based (ready for local LLM)                |
| CI / APK           | GitHub Actions → Gradle `assembleDebug`         |

## Quick start (local)

```bash
cd dexo2scan
npm install
mkdir -p www && cp -r src/* www/
npx cap add android
npx cap sync
npx cap open android
```

## Get the APK

GitHub Actions builds on every push to `main`.

1. Open **Actions** tab → latest “Build Android APK” run
2. Download artifact **dexo2scan-debug-apk**

Repo: https://github.com/Harshil1911-python/dexo2scan

## License

MIT
