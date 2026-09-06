/**
 * Dexo2Scan – works without a JS bundler.
 * Uses window.Capacitor.Plugins (injected by native bridge).
 */

(function () {
  'use strict';

  // ---------- Capacitor helpers ----------
  function getCapacitor() {
    return window.Capacitor || null;
  }

  function getPlugin(name) {
    const Cap = getCapacitor();
    if (!Cap || !Cap.Plugins) return null;
    return Cap.Plugins[name] || null;
  }

  function isNative() {
    const Cap = getCapacitor();
    return !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  }

  function platform() {
    const Cap = getCapacitor();
    return (Cap && Cap.getPlatform && Cap.getPlatform()) || 'web';
  }

  // Camera result / source enums (same values as @capacitor/camera)
  const CameraResultType = { Uri: 'uri', Base64: 'base64', DataUrl: 'dataUrl' };
  const CameraSource = { Prompt: 'PROMPT', Camera: 'CAMERA', Photos: 'PHOTOS' };

  // ---------- IndexedDB ----------
  const DB_NAME = 'Dexo2ScanDB';
  const STORE = 'invoices';
  const DB_VERSION = 1;

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('date', 'extracted.date', { unique: false });
          store.createIndex('vendor', 'extracted.vendor', { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function saveInvoice(record) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        var req = store.add(Object.assign({}, record, { savedAt: new Date().toISOString() }));
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getAllInvoices() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var store = tx.objectStore(STORE);
        var req = store.getAll();
        req.onsuccess = function () { resolve((req.result || []).reverse()); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function clearInvoices() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        var req = store.clear();
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // ---------- Invoice parser ----------
  function extractInvoiceJSON(rawText) {
    var text = (rawText || '').replace(/\r/g, '');
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

    var amountRegex = /(?:total|amount|grand\s*total|balance\s*due|sum)[^\d]*([₹$€£]?\s*[\d,]+\.?\d*)/i;
    var dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})|(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/;
    var invoiceNoRegex = /(?:invoice\s*(?:no|number|#|num)?|inv\.?\s*#?|bill\s*no)[:\s#]*([A-Z0-9\-\/]+)/i;
    var gstRegex = /(?:GSTIN|GST|TAX\s*ID)[:\s]*([0-9A-Z]{15})/i;

    var vendor = lines[0] || 'Unknown Vendor';
    for (var i = 0; i < Math.min(5, lines.length); i++) {
      var line = lines[i];
      if (line.length > 3 && !/^\d+$/.test(line) && !dateRegex.test(line)) {
        vendor = line;
        break;
      }
    }

    var amountMatch = text.match(amountRegex);
    var dateMatch = text.match(dateRegex);
    var invMatch = text.match(invoiceNoRegex);
    var gstMatch = text.match(gstRegex);

    var items = [];
    var itemLineRegex = /^(.+?)\s+([\d,]+\.?\d*)\s*$/;
    for (var j = 0; j < lines.length; j++) {
      var m = lines[j].match(itemLineRegex);
      if (m && !/total|amount|subtotal|tax|gst/i.test(m[1])) {
        items.push({ description: m[1].trim(), amount: parseFloat(m[2].replace(/,/g, '')) || 0 });
      }
    }

    var result = {
      vendor: vendor.substring(0, 80),
      invoice_number: invMatch ? invMatch[1] : null,
      date: dateMatch ? (dateMatch[1] || dateMatch[2]) : null,
      total_amount: amountMatch ? amountMatch[1].replace(/\s/g, '') : null,
      currency: (text.match(/[₹$€£]/) || ['INR'])[0],
      gstin: gstMatch ? gstMatch[1] : null,
      items: items.slice(0, 20),
      raw_text_preview: text.substring(0, 500),
      confidence: 'rule-based',
      extracted_at: new Date().toISOString()
    };

    Object.keys(result).forEach(function (k) {
      if (result[k] === null || result[k] === '') delete result[k];
    });
    return result;
  }

  // ---------- UI ----------
  function $(sel) { return document.querySelector(sel); }
  var loading = $('#loading');
  var currentImage = null;
  var lastExtracted = null;

  function showLoading(show) {
    if (!loading) return;
    if (show) loading.classList.remove('hidden');
    else loading.classList.add('hidden');
  }

  function showError(msg) {
    console.error(msg);
    alert(msg);
  }

  /** Request camera + photos permissions */
  async function ensureCameraPermissions() {
    var Camera = getPlugin('Camera');
    if (!Camera) {
      throw new Error('Camera plugin not available. Rebuild the app with npx cap sync.');
    }

    // checkPermissions / requestPermissions available on native
    if (typeof Camera.checkPermissions === 'function') {
      var status = await Camera.checkPermissions();
      var needRequest =
        (status.camera && status.camera !== 'granted' && status.camera !== 'limited') ||
        (status.photos && status.photos !== 'granted' && status.photos !== 'limited');

      if (needRequest && typeof Camera.requestPermissions === 'function') {
        status = await Camera.requestPermissions({ permissions: ['camera', 'photos'] });
      }

      if (status.camera === 'denied' || status.photos === 'denied') {
        throw new Error(
          'Camera / Photos permission denied. Open Android Settings → Apps → Dexo2Scan → Permissions and allow Camera & Photos.'
        );
      }
    }
    return Camera;
  }

  async function takePhoto(source) {
    try {
      showLoading(true);

      var Camera = await ensureCameraPermissions();

      var photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: source,
        correctOrientation: true,
        saveToGallery: false
      });

      currentImage = photo;

      // Prefer webPath for <img src>; fallback to path
      var src = photo.webPath || photo.path || '';
      if (!src && photo.dataUrl) src = photo.dataUrl;

      if (!src) {
        throw new Error('No image path returned from camera/gallery.');
      }

      $('#preview-img').src = src;
      $('#preview-section').classList.remove('hidden');
      $('#result-section').classList.add('hidden');
    } catch (err) {
      var msg = (err && (err.message || err.errorMessage)) || String(err);
      // User cancelled – don't show scary alert
      if (/cancel|user cancelled|User cancelled/i.test(msg)) {
        console.log('User cancelled camera/gallery');
      } else {
        showError('Camera/Gallery error: ' + msg);
      }
    } finally {
      showLoading(false);
    }
  }

  async function runOCRAndExtract() {
    if (!currentImage) {
      showError('Take or pick a photo first.');
      return;
    }
    showLoading(true);
    try {
      var rawText = '';
      var Ocr = getPlugin('Ocr') || getPlugin('ImageToText') || getPlugin('CapacitorCommunityImageToText');

      if (Ocr && isNative()) {
        var filename = currentImage.path || currentImage.webPath;
        var data;
        if (typeof Ocr.detectText === 'function') {
          data = await Ocr.detectText({ filename: filename });
        } else if (typeof Ocr.process === 'function') {
          data = await Ocr.process({ image: filename });
        }

        if (data && data.textDetections) {
          rawText = data.textDetections.map(function (d) { return d.text; }).join('\n');
        } else if (data && data.results) {
          rawText = data.results.map(function (r) { return r.text; }).join('\n');
        } else if (data && data.text) {
          rawText = typeof data.text === 'string' ? data.text : (data.text || []).join('\n');
        } else if (data) {
          rawText = JSON.stringify(data);
        }
      } else {
        // Fallback sample so UI still works if OCR plugin name differs
        rawText =
          'OCR plugin not detected on this build.\n\n' +
          'Sample invoice text:\n' +
          'ACME Supplies Pvt Ltd\nInvoice No: INV-2026-0042\nDate: 05/09/2026\n' +
          'Item A  1200.00\nItem B  850.50\nGST 18%  369.09\nTotal Amount: ₹2419.59\n' +
          'GSTIN: 27AABCU9603R1ZM';
      }

      $('#ocr-text').textContent = rawText || '(no text detected)';
      var extracted = extractInvoiceJSON(rawText);
      lastExtracted = {
        imagePath: currentImage.path || currentImage.webPath,
        ocrText: rawText,
        extracted: extracted
      };
      $('#json-output').textContent = JSON.stringify(extracted, null, 2);
      $('#result-section').classList.remove('hidden');
    } catch (err) {
      showError('OCR / Extract error: ' + ((err && err.message) || err));
    } finally {
      showLoading(false);
    }
  }

  async function saveCurrent() {
    if (!lastExtracted) return;
    try {
      await saveInvoice(lastExtracted);
      alert('Saved to device (IndexedDB)');
      await renderHistory();
    } catch (e) {
      showError('Save failed: ' + e.message);
    }
  }

  async function renderHistory() {
    var list = $('#history-list');
    if (!list) return;
    try {
      var items = await getAllInvoices();
      if (!items.length) {
        list.innerHTML = '<p class="meta">No saved invoices yet.</p>';
        return;
      }
      list.innerHTML = items.map(function (item) {
        var e = item.extracted || {};
        return (
          '<div class="history-item" data-id="' + item.id + '">' +
          '<strong>' + (e.vendor || 'Unknown') + '</strong>' +
          '<div class="meta">' +
          (e.invoice_number || '—') + ' · ' + (e.date || '—') + ' · ' + (e.total_amount || '—') +
          '<br><small>' + new Date(item.savedAt).toLocaleString() + '</small>' +
          '</div></div>'
        );
      }).join('');
    } catch (e) {
      list.innerHTML = '<p class="meta">Could not load history.</p>';
    }
  }

  function bindUI() {
    var btnCam = $('#btn-camera');
    var btnGal = $('#btn-gallery');
    var btnProc = $('#btn-process');
    var btnSave = $('#btn-save');
    var btnClear = $('#btn-clear');

    if (btnCam) btnCam.addEventListener('click', function () { takePhoto(CameraSource.Camera); });
    if (btnGal) btnGal.addEventListener('click', function () { takePhoto(CameraSource.Photos); });
    if (btnProc) btnProc.addEventListener('click', runOCRAndExtract);
    if (btnSave) btnSave.addEventListener('click', saveCurrent);
    if (btnClear) {
      btnClear.addEventListener('click', async function () {
        if (confirm('Delete all saved invoices?')) {
          await clearInvoices();
          await renderHistory();
        }
      });
    }
  }

  // Wait for Capacitor bridge (native injects it slightly after DOMContentLoaded)
  function start() {
    bindUI();
    renderHistory();
    console.log('Dexo2Scan ready. Platform:', platform(), 'Native:', isNative());
    console.log('Available plugins:', getCapacitor() && getCapacitor().Plugins ? Object.keys(getCapacitor().Plugins) : 'none');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      // Give native bridge a moment on cold start
      setTimeout(start, 100);
    });
  } else {
    setTimeout(start, 100);
  }
})();
