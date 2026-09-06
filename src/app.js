/**
 * Dexo2Scan App
 * - Capacitor Camera for capture
 * - @capacitor-community/image-to-text (ML Kit on Android, Vision on iOS)
 * - Simple rule-based + LLM-style prompt ready invoice parser → JSON
 * - IndexedDB for persistence
 */

import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

let Ocr = null;
try {
  const mod = await import('@capacitor-community/image-to-text');
  Ocr = mod.Ocr || mod.default || mod;
} catch (e) {
  console.warn('OCR plugin not available (web or not installed):', e);
}

const DB_NAME = 'Dexo2ScanDB';
const STORE = 'invoices';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'extracted.date', { unique: false });
        store.createIndex('vendor', 'extracted.vendor', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveInvoice(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.add({ ...record, savedAt: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllInvoices() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.reverse());
    req.onerror = () => reject(req.error);
  });
}

async function clearInvoices() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function extractInvoiceJSON(rawText) {
  const text = (rawText || '').replace(/\r/g, '');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const amountRegex = /(?:total|amount|grand\s*total|balance\s*due|sum)[^\d]*([₹$€£]?\s*[\d,]+\.?\d*)/i;
  const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})|(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/;
  const invoiceNoRegex = /(?:invoice\s*(?:no|number|#|num)?|inv\.?\s*#?|bill\s*no)[:\s#]*([A-Z0-9\-\/]+)/i;
  const gstRegex = /(?:GSTIN|GST|TAX\s*ID)[:\s]*([0-9A-Z]{15})/i;

  let vendor = lines[0] || 'Unknown Vendor';
  for (const line of lines.slice(0, 5)) {
    if (line.length > 3 && !/^\d+$/.test(line) && !dateRegex.test(line)) {
      vendor = line;
      break;
    }
  }

  const amountMatch = text.match(amountRegex);
  const dateMatch = text.match(dateRegex);
  const invMatch = text.match(invoiceNoRegex);
  const gstMatch = text.match(gstRegex);

  const items = [];
  const itemLineRegex = /^(.+?)\s+([\d,]+\.?\d*)\s*$/;
  for (const line of lines) {
    const m = line.match(itemLineRegex);
    if (m && !/total|amount|subtotal|tax|gst/i.test(m[1])) {
      items.push({ description: m[1].trim(), amount: parseFloat(m[2].replace(/,/g, '')) || 0 });
    }
  }

  const result = {
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
  Object.keys(result).forEach(k => { if (result[k] === null || result[k] === '') delete result[k]; });
  return result;
}

async function extractWithLocalLLM(rawText) {
  return extractInvoiceJSON(rawText);
}

const $ = (sel) => document.querySelector(sel);
const loading = $('#loading');
let currentImage = null;
let lastExtracted = null;

function showLoading(show = true) {
  loading.classList.toggle('hidden', !show);
}

async function takePhoto(source = CameraSource.Camera) {
  try {
    showLoading(true);
    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: source,
      correctOrientation: true
    });
    currentImage = photo;
    $('#preview-img').src = photo.webPath || photo.path;
    $('#preview-section').classList.remove('hidden');
    $('#result-section').classList.add('hidden');
  } catch (err) {
    console.error(err);
    alert('Camera error: ' + (err.message || err));
  } finally {
    showLoading(false);
  }
}

async function runOCRAndExtract() {
  if (!currentImage) return;
  showLoading(true);
  try {
    let rawText = '';
    if (Ocr && Capacitor.isNativePlatform()) {
      const filename = currentImage.path || currentImage.webPath;
      const data = await Ocr.detectText({ filename });
      if (data && data.textDetections) {
        rawText = data.textDetections.map(d => d.text).join('\n');
      } else if (data && data.text) {
        rawText = data.text;
      } else {
        rawText = JSON.stringify(data);
      }
    } else {
      rawText = 'OCR plugin requires native platform (Android/iOS).\n\nSample invoice text for testing:\nACME Supplies Pvt Ltd\nInvoice No: INV-2026-0042\nDate: 05/09/2026\nItem A  1200.00\nItem B  850.50\nGST 18%  369.09\nTotal Amount: ₹2419.59\nGSTIN: 27AABCU9603R1ZM';
    }
    $('#ocr-text').textContent = rawText || '(no text detected)';
    const extracted = await extractWithLocalLLM(rawText);
    lastExtracted = { imagePath: currentImage.path || currentImage.webPath, ocrText: rawText, extracted };
    $('#json-output').textContent = JSON.stringify(extracted, null, 2);
    $('#result-section').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    alert('OCR / Extract error: ' + (err.message || err));
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
    alert('Save failed: ' + e.message);
  }
}

async function renderHistory() {
  const list = $('#history-list');
  const items = await getAllInvoices();
  if (!items.length) {
    list.innerHTML = '<p class="meta">No saved invoices yet.</p>';
    return;
  }
  list.innerHTML = items.map(item => {
    const e = item.extracted || {};
    return `<div class="history-item" data-id="${item.id}"><strong>${e.vendor || 'Unknown'}</strong><div class="meta">${e.invoice_number || '—'} · ${e.date || '—'} · ${e.total_amount || '—'}<br><small>${new Date(item.savedAt).toLocaleString()}</small></div></div>`;
  }).join('');
}

$('#btn-camera').addEventListener('click', () => takePhoto(CameraSource.Camera));
$('#btn-gallery').addEventListener('click', () => takePhoto(CameraSource.Photos));
$('#btn-process').addEventListener('click', runOCRAndExtract);
$('#btn-save').addEventListener('click', saveCurrent);
$('#btn-clear').addEventListener('click', async () => {
  if (confirm('Delete all saved invoices?')) {
    await clearInvoices();
    await renderHistory();
  }
});

renderHistory();
console.log('Dexo2Scan ready. Platform:', Capacitor.getPlatform());
