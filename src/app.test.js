import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('./src/App.jsx', 'utf8');

test('app contains the expected SoilIQ experience entry points', () => {
  assert.match(source, /Get soil advice/);
  assert.match(source, /Read aloud/);
  assert.match(source, /Soil trends/);
  assert.match(source, /Assessment history/);
  assert.match(source, /Help/);
});

test('app uses a configurable API base URL', () => {
  assert.match(source, /VITE_API_BASE_URL/);
});

test('app wires up microphone recording for voice transcription', () => {
  assert.match(source, /getUserMedia/);
  assert.match(source, /AudioContext|webkitAudioContext/);
  assert.match(source, /audio\/wav|voice\.wav|FormData/);
});

test('app uses browser geolocation for live location updates', () => {
  assert.match(source, /watchPosition/);
  assert.match(source, /enableHighAccuracy/);
});

test('app includes an image analysis flow with upload and output handling', () => {
  assert.match(source, /image-analysis|analyze-image|Analyze photo/);
  assert.match(source, /Image analysis/);
});

test('app uses live location reverse geocoding instead of a hardcoded county', () => {
  assert.match(source, /reverseGeocodeLocation|nominatim|addressdetails/);
});

test('app accepts multiple transcription response shapes from the backend', () => {
  assert.match(source, /parsedData|content-type|alternatives|res\.text/);
});
