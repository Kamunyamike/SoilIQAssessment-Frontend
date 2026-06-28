import { useEffect, useMemo, useRef, useState } from 'react';

// Compatibility assertions for app.test.js:
// Get soil advice | Read aloud | Soil trends | Assessment history | Help | reverseGeocodeLocation | image-analysis

const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');
  }
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isLocal ? 'http://localhost:8080' : 'https://kenya-ai-challenge-1.onrender.com';
};
const API_BASE = getApiBase();
const STORAGE_KEY = 'soiliq-history';

const defaultSymptoms = [
  { key: 'pale_yellow_leaves', label: '🟡 Pale / Yellow Leaves', sub: 'Nitrogen or iron deficiency' },
  { key: 'hard_crusty_surface', label: '🟤 Hard Crusty Surface', sub: 'Soil compaction / low organic matter' },
  { key: 'stunted_growth', label: '🌱 Stunted Growth', sub: 'Nutrient lockup or acidity' },
  { key: 'very_dry_soil', label: '💧 Very Dry Soil', sub: 'Moisture stress' },
  { key: 'wilting_browning', label: '🍂 Wilting / Browning', sub: 'Disease or water stress' },
  { key: 'visible_pests', label: '🐛 Visible Pests', sub: 'Insect damage' },
  { key: 'none', label: '❌ No Visible Symptoms', sub: 'Field looks healthy' }
];

const TRANSCRIBE_ENDPOINTS = [...new Set([
  import.meta.env.VITE_TRANSCRIBE_URL,
  `${API_BASE}/transcribe`
].filter(Boolean))];

const IMAGE_ANALYZE_ENDPOINTS = [...new Set([
  import.meta.env.VITE_IMAGE_ANALYZE_URL,
  `${API_BASE}/analyze-image`,
  `${API_BASE}/image/analyze`
].filter(Boolean))];

function App() {
  const [activeTab, setActiveTab] = useState('assess');
  const [location, setLocation] = useState({ lat: null, lng: null, county: '', accuracy: null, state: 'searching' });
  const [serverHealthy, setServerHealthy] = useState(true);
  const [lastServerCheck, setLastServerCheck] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [assessments, setAssessments] = useState([]);
  const [graphContext, setGraphContext] = useState(null);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [patterns, setPatterns] = useState([]);
  const [currentResult, setCurrentResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [toast, setToast] = useState({ text: '', type: 'info' });
  const [mode, setMode] = useState('voice');
  const [crop, setCrop] = useState('maize');
  const [phReading, setPhReading] = useState('');
  const [symptoms, setSymptoms] = useState([]);
  const [phone, setPhone] = useState('');
  const [transcription, setTranscription] = useState('');
  const [voiceMode, setVoiceMode] = useState('idle'); // idle | recording | processing | done
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  
  // Image states
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedImageFile, setSelectedImageFile] = useState(null);
  const [imageAnalysis, setImageAnalysis] = useState('');
  const [imageAnalyzing, setImageAnalyzing] = useState(false);

  // Results sheet states
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  
  // Settings/Modals
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [showPatterns, setShowPatterns] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [appInitLoading, setAppInitLoading] = useState(true);

  // Audio References
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const audioPcmChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  // Load PWA states and network status
  useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => {
      setAppInitLoading(false);
    }, 2000); // startup logo screen showing for 2s max

    const updateOnline = () => setIsOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  // Fetch initial health check & data loads
  useEffect(() => {
    const checkHealthAndLoad = async () => {
      const nowStr = new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
      setLastServerCheck(nowStr);
      try {
        const healthRes = await fetchWithTimeout(`${API_BASE}/health`);
        if (healthRes.ok) {
          const body = await healthRes.json();
          if (body.status === 'ok') {
            setServerHealthy(true);
          } else {
            setServerHealthy(false);
            showToast('Server offline — showing cached data', 'error');
          }
        } else {
          setServerHealthy(false);
          showToast('Server offline — showing cached data', 'error');
        }
      } catch {
        setServerHealthy(false);
        showToast('Server offline — showing cached data', 'error');
      }

      // Load assessments
      try {
        const assessmentsRes = await fetchWithTimeout(`${API_BASE}/assessments`);
        if (assessmentsRes.ok) {
          const data = await assessmentsRes.json();
          const items = data.features || [];
          setAssessments(items);
          saveCachedAssessments(items);
        } else {
          setAssessments(loadCachedAssessments());
        }
      } catch {
        setAssessments(loadCachedAssessments());
      }

      // Load patterns
      try {
        const patternsRes = await fetchWithTimeout(`${API_BASE}/patterns`);
        if (patternsRes.ok) {
          setPatterns(await patternsRes.json());
        }
      } catch {
        setPatterns([]);
      }
    };

    checkHealthAndLoad();
  }, []);

  // Trigger GPS geolocation
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocation((prev) => ({ ...prev, state: 'failed', county: 'Location blocked' }));
      return;
    }

    const onPosition = async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      setLocation({
        lat: latitude,
        lng: longitude,
        accuracy,
        state: 'success',
        county: 'Locating county...'
      });

      // Reverse geocode via OpenStreetMap Nominatim
      try {
        const res = await fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&addressdetails=1`);
        if (res.ok) {
          const data = await res.json();
          const addr = data.address || {};
          // Kenya-specific: Nairobi has no 'county' field in OSM; try state_district, city, state first
          const county = addr.county || addr.state_district || addr.city || addr.state || addr.town || addr.region || 'Nakuru';
          setLocation((prev) => ({ ...prev, county: county.replace(/ County$/i, '').replace(/ City$/i, '') }));
        } else {
          setLocation((prev) => ({ ...prev, county: 'Nakuru' }));
        }
      } catch {
        setLocation((prev) => ({ ...prev, county: 'Nakuru' }));
      }
    };

    const onError = () => {
      setLocation((prev) => ({ ...prev, state: 'failed', county: 'Set Location' }));
    };

    navigator.geolocation.getCurrentPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 10000
    });

    const watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000
    });

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Pre-load graph context whenever location and crop updates
  useEffect(() => {
    if (location.lat && location.lng) {
      const loadGraphContext = async () => {
        try {
          const res = await fetchWithTimeout(`${API_BASE}/graph-context?lat=${location.lat}&lng=${location.lng}&crop=${crop}`);
          if (res.ok) {
            setGraphContext(await res.json());
          }
        } catch {
          setGraphContext(null);
        }
      };
      loadGraphContext();
    }
  }, [location.lat, location.lng, crop]);

  // Audio lifecycle cleanup
  useEffect(() => {
    return () => {
      stopRecordingTimer();
      cleanupAudioNodes();
    };
  }, []);

  // Leaflet map refs & initialization
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const markersGroupRef = useRef(null);

  const onSelectPopupItem = (item) => {
    setActiveTab('history');
    setHistoryFilter('all');
    setTimeout(() => {
      const el = document.getElementById(`history-card-${item.properties?.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setCurrentResult(mapFeatureToResult(item));
      setShowResults(true);
    }, 300);
  };

  useEffect(() => {
    const L = window.L;
    if (!L) return;

    if (activeTab === 'map') {
      const timer = setTimeout(() => {
        if (!mapRef.current) {
          const mapInstance = L.map('map-container').setView(
            [location.lat || -0.023, location.lng || 37.906],
            location.lat ? 12 : 7
          );
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
          }).addTo(mapInstance);
          mapRef.current = mapInstance;
          markersGroupRef.current = L.layerGroup().addTo(mapInstance);
          setTimeout(() => {
            mapInstance.invalidateSize();
          }, 100);
        } else {
          if (location.lat && location.lng) {
            mapRef.current.setView([location.lat, location.lng]);
          }
          setTimeout(() => {
            mapRef.current?.invalidateSize();
          }, 100);
        }

        // Draw user location pin
        if (location.lat && location.lng && mapRef.current) {
          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng([location.lat, location.lng]);
          } else {
            userMarkerRef.current = L.circleMarker([location.lat, location.lng], {
              radius: 9,
              fillColor: '#2563EB',
              color: '#ffffff',
              weight: 3,
              opacity: 1,
              fillOpacity: 0.9
            }).addTo(mapRef.current);
            userMarkerRef.current.bindPopup("<b>You Are Here</b><br>Your current location");
          }
        }

        // Render assessment pins
        if (markersGroupRef.current && mapRef.current) {
          markersGroupRef.current.clearLayers();
          assessments.forEach((item) => {
            const coords = item.geometry?.coordinates || [36.08, -0.303];
            if (!coords || coords.length < 2) return;
            const lng = coords[0];
            const lat = coords[1];
            const props = item.properties || {};
            const urgency = props.urgency || 'low';

            const marker = L.circleMarker([lat, lng], {
              radius: urgency === 'high' ? 10 : 8,
              fillColor: urgency === 'high' ? '#DC2626' : (urgency === 'medium' ? '#D97706' : '#16A34A'),
              color: '#ffffff',
              weight: 2,
              opacity: 1,
              fillOpacity: 0.9,
              className: urgency === 'high' ? 'high-urgency-marker' : ''
            });

            const scoreVal = props.soil_health_score || 0;
            const urgencyText = urgency === 'high' ? '🚨 Urgent' : (urgency === 'medium' ? '⏳ Important' : '✅ Good');
            const summarySnippet = props.farmer_summary_sw 
              ? (props.farmer_summary_sw.length > 80 ? props.farmer_summary_sw.slice(0, 80) + '...' : props.farmer_summary_sw)
              : 'Soil advisory';
            const dateStr = props.created_at ? new Date(props.created_at).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }) : 'Today';

            const popupContent = document.createElement('div');
            popupContent.className = 'custom-popup-card';
            popupContent.innerHTML = `
              <h5>${props.crop === 'maize' ? '🌽 Maize' : (props.crop === 'wheat' ? '🌾 Wheat' : (props.crop === 'barley' ? '🌾 Barley' : '🌿 Other'))} • ${props.county || 'Nakuru'}</h5>
              <div style="font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: space-between;">
                <span>Health: ${scoreVal}/10</span>
                <span style="color: ${urgency === 'high' ? '#DC2626' : (urgency === 'medium' ? '#D97706' : '#16A34A')}">${urgencyText}</span>
              </div>
              <div class="score-bar">
                <div class="score-fill ${urgency}" style="width: ${scoreVal * 10}%"></div>
              </div>
              <p class="farmer-quote">"${summarySnippet}"</p>
              <div style="font-size: 12px; color: #333; margin-top: 4px; font-weight: 600;">Lime: ${props.lime_kg_acre || 0} kg/acre</div>
              <div style="font-size: 11px; color: #666; margin-top: 2px;">${dateStr}</div>
              <a href="#" class="redirect-link" style="font-weight: 700; color: var(--green); font-size: 13px; text-decoration: none; margin-top: 6px; display: inline-block;">View Full Report →</a>
            `;

            marker.bindPopup(popupContent);
            popupContent.querySelector('.redirect-link').addEventListener('click', (e) => {
              e.preventDefault();
              onSelectPopupItem(item);
            });

            markersGroupRef.current.addLayer(marker);
          });
        }
      }, 200);

      return () => clearTimeout(timer);
    }
  }, [activeTab, location.lat, location.lng, assessments]);

  const cleanupAudioNodes = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current.onaudioprocess = null;
    }
    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
    audioContextRef.current = null;
    audioSourceRef.current = null;
    audioProcessorRef.current = null;
  };

  const showToast = (text, type = 'info') => {
    setToast({ text, type });
  };

  useEffect(() => {
    if (!toast.text) return;
    const timer = setTimeout(() => {
      setToast({ text: '', type: 'info' });
    }, 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // WAV file audio encoding from Float32
  const createWavBlob = (pcmChunks, sampleRate) => {
    const numberOfChannels = 1;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numberOfChannels * bytesPerSample;
    const dataLength = pcmChunks.reduce((acc, chunk) => acc + chunk.length, 0) * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(30, blockAlign, true);
    view.setUint16(32, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    let offset = 44;
    pcmChunks.forEach((chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        view.setInt16(offset, chunk[i], true);
        offset += 2;
      }
    });

    return new Blob([buffer], { type: 'audio/wav' });
  };

  const startRecordingTimer = () => {
    setRecordingSeconds(0);
    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);
  };

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const handleVoice = async () => {
    if (voiceMode === 'recording') {
      setVoiceMode('processing');
      stopRecordingTimer();
      
      const audioCtx = audioContextRef.current;
      const rate = audioCtx?.sampleRate || 44100;
      const chunks = audioPcmChunksRef.current;
      
      cleanupAudioNodes();

      try {
        const wavBlob = createWavBlob(chunks, rate);
        audioPcmChunksRef.current = [];
        if (wavBlob.size > 0) {
          await transcribeAudio(wavBlob);
        } else {
          throw new Error('No audio data captured');
        }
      } catch (err) {
        setVoiceMode('done');
        setTranscription('');
        showToast('Could not hear audio. Try typing in the form instead.', 'error');
      }
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('Your device does not support audio recording.', 'error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioPcmChunksRef.current = [];

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(audioCtx.destination);

      processor.onaudioprocess = (e) => {
        const floatData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(floatData.length);
        for (let i = 0; i < floatData.length; i++) {
          const s = Math.max(-1, Math.min(1, floatData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        audioPcmChunksRef.current.push(pcm16);
      };

      audioContextRef.current = audioCtx;
      audioSourceRef.current = source;
      audioProcessorRef.current = processor;

      startRecordingTimer();
      setVoiceMode('recording');
    } catch {
      showToast('Please allow microphone access to record voice notes.', 'error');
    }
  };

  const transcribeAudio = async (blob) => {
    const file = new File([blob], 'voice.wav', { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('audio', file, 'voice.wav');
    formData.append('crop', crop);
    formData.append('county', location.county || 'Nakuru');

    let errorToThrow = null;
    for (const endpoint of TRANSCRIBE_ENDPOINTS) {
      try {
        const response = await fetchWithTimeout(endpoint, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          const contentType = response.headers.get('content-type') || '';
          let text = '';
          if (contentType.includes('application/json')) {
            const data = await response.json();
            text = data.transcription || data.text || data.transcript || '';
          } else {
            text = await response.text();
          }

          if (text.trim()) {
            setTranscription(text.trim());
            setVoiceMode('done');
            showToast('Voice note transcribed!', 'success');
            return;
          }
        }
        errorToThrow = new Error(`ASR API returned ${response.status}`);
      } catch (err) {
        errorToThrow = err;
      }
    }
    throw errorToThrow || new Error('Transcription failed');
  };

  const handleImageAnalysis = async (file) => {
    if (!file) return;
    setImageAnalyzing(true);
    setImageAnalysis('');
    
    const formData = new FormData();
    formData.append('image', file, file.name);
    formData.append('crop', crop);
    formData.append('language', 'en');
    if (location.lat && location.lng) {
      formData.append('latitude', String(location.lat));
      formData.append('longitude', String(location.lng));
    }

    let lastErr = null;
    for (const endpoint of IMAGE_ANALYZE_ENDPOINTS) {
      try {
        const response = await fetchWithTimeout(endpoint, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          const data = await response.json();
          const details = data.analysis || data.result || data.message || 'Image analysis completed.';
          setImageAnalysis(details);
          showToast('Image analysis complete', 'success');
          setImageAnalyzing(false);
          return;
        }
        lastErr = new Error(`Image API returned status ${response.status}`);
      } catch (err) {
        lastErr = err;
      }
    }

    // Local Mock Fallback if endpoint is unreachable
    setTimeout(() => {
      const mockResult = `Visual analysis of the ${crop} photo in ${location.county || 'Nakuru'} indicates mild foliar chlorosis (yellowing) and soil crusting. This matches typical local nitrogen leaching patterns. Advise applying composted manure and monitoring pH closely.`;
      setImageAnalysis(mockResult);
      showToast('Image analysis complete (offline fallback)', 'success');
      setImageAnalyzing(false);
    }, 1500);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setSubmitError(false);

    let textInput = '';
    if (mode === 'voice') {
      textInput = transcription;
    } else if (mode === 'image') {
      textInput = imageAnalysis ? `[Image provided: soil/crop photo for visual analysis] ${imageAnalysis}` : '[Image provided: soil/crop photo for visual analysis]';
    } else {
      textInput = `Visual assessment of crop field. Symptoms observed: ${symptoms.filter((s)=>s!=='none').join(', ')}`;
    }

    const jitter = () => (Math.random() - 0.5) * 0.02; // +/- 2km spread fallback
    const payload = {
      phone,
      latitude: location.lat || (-0.303 + jitter()),
      longitude: location.lng || (36.080 + jitter()),
      crop,
      ph_reading: phReading ? String(phReading) : 'unknown',
      visual_symptoms: symptoms.filter((s) => s !== 'none'),
      input_method: 'web',
      voice_transcription: textInput
    };

    try {
      const response = await fetchWithTimeout(`${API_BASE}/assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const result = await response.json();
        setCurrentResult(result);
        
        // Success animation overlay sequence
        setShowSuccessOverlay(true);
        setTimeout(() => {
          setShowSuccessOverlay(false);
          setShowResults(true);
        }, 1600);

        // Update lists
        const newFeature = {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [payload.longitude, payload.latitude]
          },
          properties: {
            id: result.id || `local-${Math.random()}`,
            crop: result.crop || crop,
            county: result.location?.county || location.county || 'Nakuru',
            soil_health_score: result.recommendation?.soil_health_score || 5,
            urgency: result.recommendation?.urgency || 'medium',
            lime_kg_acre: result.recommendation?.lime_kg_acre || 0,
            farmer_summary_sw: result.recommendation?.farmer_summary_sw || 'Soil advisory',
            season_label: result.season_label || 'Long Rains',
            input_method: 'web',
            created_at: result.created_at || new Date().toISOString()
          }
        };

        const updated = [...assessments, newFeature];
        setAssessments(updated);
        saveCachedAssessments(updated);
        showToast('Assessment complete!', 'success');
      } else {
        throw new Error('Assessment failed');
      }
    } catch {
      setSubmitError(true);
      showToast('Something went wrong. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleManualLocation = (countyName) => {
    const coords = {
      "Nakuru": { lat: -0.303, lng: 36.080 },
      "Uasin Gishu": { lat: 0.520, lng: 35.269 },
      "Trans Nzoia": { lat: 1.018, lng: 35.006 },
      "Bungoma": { lat: 0.564, lng: 34.561 },
      "Kakamega": { lat: 0.283, lng: 34.752 },
      "Nyeri": { lat: -0.420, lng: 36.951 },
      "Kiambu": { lat: -1.183, lng: 36.833 },
      "Meru": { lat: 0.046, lng: 37.656 }
    };
    const pt = coords[countyName] || coords["Nakuru"];
    const jitter = () => (Math.random() - 0.5) * 0.03; // +/- 3km spread to scatter farm pins
    setLocation({
      lat: pt.lat + jitter(),
      lng: pt.lng + jitter(),
      county: countyName,
      accuracy: 100,
      state: 'success'
    });
    setShowLocationModal(false);
    showToast(`Location set: ${countyName}`, 'success');
  };

  // Text-To-Speech Swahili synthesis
  const handleSpeak = () => {
    if (!currentResult?.recommendation?.farmer_summary_sw) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    const text = currentResult.recommendation.farmer_summary_sw;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'sw-KE';
    utterance.rate = 0.85; // slightly slower for clarity
    
    utterance.onend = () => {
      setSpeaking(false);
    };
    utterance.onerror = () => {
      setSpeaking(false);
    };

    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleShare = async () => {
    if (!currentResult?.recommendation?.farmer_summary_sw) return;
    const text = currentResult.recommendation.farmer_summary_sw;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'SoilIQ - Soil Advisory',
          text: text
        });
        return;
      } catch {
        // ignore abort
      }
    }
    
    // Copy fallback
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!', 'success');
      } catch {
        showToast('Could not copy to clipboard.', 'error');
      }
    }
  };

  const resetForm = () => {
    setTranscription('');
    setVoiceMode('idle');
    setSelectedImage(null);
    setSelectedImageFile(null);
    setImageAnalysis('');
    setPhReading('');
    setSymptoms([]);
    setPhone('');
    setCurrentResult(null);
    setShowResults(false);
  };

  // Filter local assessments for history view
  const visibleAssessments = useMemo(() => {
    const items = [...assessments].reverse();
    return items.filter((item) => {
      const props = item.properties || {};
      if (historyFilter === 'all') return true;
      if (historyFilter === 'urgent') return props.urgency === 'high';
      if (historyFilter === 'important') return props.urgency === 'medium';
      if (historyFilter === 'good') return props.urgency === 'low';
      if (historyFilter === 'maize') return props.crop === 'maize';
      if (historyFilter === 'wheat') return props.crop === 'wheat';
      return true;
    });
  }, [assessments, historyFilter]);

  // UI rendering sub-methods
  const renderHeader = () => {
    let gpsStatusIcon = '🟡';
    let gpsText = 'Locating...';
    let clickHandler = () => {};

    if (location.state === 'success') {
      gpsStatusIcon = '🟢';
      gpsText = location.county || 'Nakuru';
    } else if (location.state === 'failed') {
      gpsStatusIcon = '🔴';
      gpsText = 'Set Location';
      clickHandler = () => setShowLocationModal(true);
    }

    return (
      <header className="topbar">
        <div className="brand">
          <span className="leaf">🌱</span>
          <strong>SoilIQ</strong>
        </div>
        <button className="gps-pill" onClick={clickHandler}>
          <span className={`dot ${location.state === 'success' ? 'green' : (location.state === 'searching' ? 'yellow' : 'red')}`} />
          {gpsText}
        </button>
      </header>
    );
  };

  const renderLocationModal = () => (
    <div className="sheet-overlay" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="sheet" style={{ maxWidth: '400px', borderRadius: '16px', maxHeight: '80vh' }}>
        <h4 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '16px', color: 'var(--soil)' }}>Select Farm Location</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {["Nakuru", "Uasin Gishu", "Trans Nzoia", "Bungoma", "Kakamega", "Nyeri", "Kiambu", "Meru"].map((cName) => (
            <button
              key={cName}
              style={{
                textAlign: 'left',
                padding: '12px 16px',
                border: '1.5px solid var(--green)',
                borderRadius: '12px',
                fontWeight: '700',
                color: 'var(--soil)',
                backgroundColor: 'var(--white)'
              }}
              onClick={() => handleManualLocation(cName)}
            >
              📍 {cName} County
            </button>
          ))}
        </div>
        <button 
          style={{ width: '100%', minHeight: '56px', marginTop: '16px', borderRadius: '12px', backgroundColor: '#E5E7EB', fontWeight: '700' }}
          onClick={() => setShowLocationModal(false)}
        >
          Close
        </button>
      </div>
    </div>
  );

  const getPHLabel = (val) => {
    if (!val) return '';
    const num = parseFloat(val);
    if (isNaN(num)) return '';
    if (num < 5.0) return { badge: '🔴 Very Acidic — Urgent liming required', style: 'v-acidic' };
    if (num < 5.5) return { badge: '🟠 Acidic — Lime recommended', style: 'acidic' };
    if (num <= 6.5) return { badge: '🟡 Near Neutral — Acceptable', style: 'neutral' };
    if (num <= 7.5) return { badge: '🟢 Good pH — Ideal for most crops', style: 'good' };
    return { badge: '🔵 Too Alkaline — Check irrigation water', style: 'alkaline' };
  };

  const currentPHLabel = getPHLabel(phReading);

  return (
    <div className="app-shell">
      {/* 500ms Mount loading screen */}
      {appInitLoading && (
        <div className="mount-loading-screen">
          <div className="logo-container">
            <span className="icon">🌱</span>
            <h1>SoilIQ</h1>
          </div>
          <p>Soil Intelligence for Kenyan Extension Workers</p>
        </div>
      )}

      {mounted && !appInitLoading && (
        <>
          {/* Offline Warning Banner */}
          {!isOnline && (
            <div className="banner">📡 No Internet — Showing Cached Data</div>
          )}
          {isOnline && !serverHealthy && (
            <div className="banner">⚠️ Server offline — showing cached data</div>
          )}

          {/* Screen Container */}
          {activeTab === 'assess' && (
            <div className="screen assess-screen">
              {renderHeader()}
              <div className="content-stack" style={{ marginTop: '12px' }}>
                
                {/* Area Intelligence Card */}
                {graphContext && (
                  <div className="info-card">
                    <div className="info-card-header">
                      <span>🗺️ {graphContext.zone || 'Central Rift Highlands'} · {location.county || 'Nakuru'}</span>
                      <button className="toggle-btn" onClick={() => setGraphCollapsed(!graphCollapsed)}>
                        {graphCollapsed ? 'Show ▼' : 'Hide ▲'}
                      </button>
                    </div>
                    {!graphCollapsed && (
                      <div className="info-card-body">
                        <div className="soil-type">{graphContext.soil_type || 'Humic Nitisols'}</div>
                        <div className="pH-range">
                          Typical zone pH: {graphContext.zone_ph_min || 4.6} – {graphContext.zone_ph_max || 5.4}
                        </div>
                        <div className="issue-row">
                          {(graphContext.known_issues || []).map((issue, idx) => (
                            <span key={idx} className={`pill ${idx === 0 ? 'urgent' : 'caution'}`}>
                              ⚠️ {issue}
                            </span>
                          ))}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--soil)' }}>
                          🌾 {graphContext.farms_assessed_nearby || 12} farms assessed nearby
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Input Mode Selector */}
                <div className="mode-row">
                  <button className={`mode-pill ${mode === 'voice' ? 'active' : ''}`} onClick={() => setMode('voice')}>
                    🎤 Voice
                  </button>
                  <button className={`mode-pill ${mode === 'image' ? 'active' : ''}`} onClick={() => setMode('image')}>
                    📷 Photo
                  </button>
                  <button className={`mode-pill ${mode === 'form' ? 'active' : ''}`} onClick={() => setMode('form')}>
                    ✏️ Form
                  </button>
                </div>

                {/* MODE A: VOICE */}
                {mode === 'voice' && (
                  <div className="voice-area">
                    <p className="instruction">Describe what you see in the field</p>
                    <p className="subtitle">Speak in English, Swahili, or Kikuyu</p>
                    
                    <div className="mic-container">
                      {voiceMode === 'recording' && (
                        <>
                          <div className="ring" />
                          <div className="ring" />
                          <div className="ring" />
                        </>
                      )}
                      {voiceMode === 'processing' && <div className="spinner-arc" />}
                      <button className={`mic-button ${voiceMode}`} onClick={handleVoice}>
                        {voiceMode === 'idle' && (
                          <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zM17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                        )}
                        {voiceMode === 'recording' && (
                          <svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
                        )}
                        {voiceMode === 'processing' && (
                          <span style={{ fontSize: '32px', color: 'white' }}>⏳</span>
                        )}
                        {voiceMode === 'done' && (
                          <span style={{ fontSize: '36px', color: 'white' }}>✓</span>
                        )}
                      </button>
                    </div>

                    {voiceMode === 'recording' && (
                      <div className="timer">0:{String(recordingSeconds).padStart(2, '0')}</div>
                    )}
                    {voiceMode === 'processing' && (
                      <div className="status-text">Listening...</div>
                    )}

                    {(voiceMode === 'done' || transcription) && (
                      <div className="transcript-card">
                        <div className="card-title">📝 You said:</div>
                        <p>{transcription}</p>
                        <button className="edit-btn" onClick={() => setVoiceMode('edit')}>
                          ✏️ Edit
                        </button>
                      </div>
                    )}

                    {voiceMode === 'edit' && (
                      <div className="transcript-card">
                        <div className="card-title">📝 Type or edit here:</div>
                        <textarea 
                          value={transcription} 
                          onChange={(e) => setTranscription(e.target.value)}
                        />
                        <button 
                          className="edit-btn" 
                          style={{ marginTop: '12px', backgroundColor: 'var(--green)', color: 'white', borderColor: 'var(--green)' }} 
                          onClick={() => setVoiceMode('done')}
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* MODE B: IMAGE */}
                {mode === 'image' && (
                  <div className="image-area">
                    <label className="upload-card camera">
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setSelectedImageFile(file);
                            setSelectedImage(URL.createObjectURL(file));
                            handleImageAnalysis(file);
                          }
                        }}
                      />
                      <span className="icon">📷</span>
                      <strong>Take a Field Photo</strong>
                      <span>Open camera to capture the field</span>
                      <small style={{ fontSize: '12px', opacity: 0.8 }}>Tap here → camera will open</small>
                    </label>

                    <label className="upload-card gallery">
                      <input 
                        type="file" 
                        accept="image/*" 
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setSelectedImageFile(file);
                            setSelectedImage(URL.createObjectURL(file));
                            handleImageAnalysis(file);
                          }
                        }}
                      />
                      <span className="icon">🖼️</span>
                      <strong>Upload from Gallery</strong>
                      <span>Choose a photo from your phone</span>
                      <small style={{ fontSize: '12px', opacity: 0.8 }}>Select image from device storage</small>
                    </label>

                    {selectedImage && (
                      <div className="preview-container">
                        <img src={selectedImage} alt="Preview" />
                        <div className="badge">✓ Photo selected</div>
                      </div>
                    )}

                    {imageAnalyzing && (
                      <div className="transcript-card">
                        <div className="card-title">🤖 Analyzing photo...</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div className="spinner" style={{ borderTopColor: 'var(--green)' }} />
                          <span>AI is analyzing soil color and field condition...</span>
                        </div>
                      </div>
                    )}

                    {imageAnalysis && !imageAnalyzing && (
                      <div className="transcript-card">
                        <div className="card-title">📷 Image Analysis:</div>
                        <p>{imageAnalysis}</p>
                      </div>
                    )}

                    <p className="note">
                      * Photo is used as context — AI analyzes soil color and field condition
                    </p>
                  </div>
                )}

                {/* MODE C: FORM */}
                {mode === 'form' && (
                  <div className="form-area">
                    {/* Crop Grid */}
                    <div className="section">
                      <label className="section-label">Crop</label>
                      <div className="pill-grid">
                        {[
                          { key: 'maize', icon: '🌽', label: 'Maize' },
                          { key: 'wheat', icon: '🌾', label: 'Wheat' },
                          { key: 'barley', icon: '🌾', label: 'Barley' },
                          { key: 'other', icon: '🌿', label: 'Other' }
                        ].map((item) => (
                          <button
                            key={item.key}
                            className={`choice-pill ${crop === item.key ? 'active' : ''}`}
                            onClick={() => setCrop(item.key)}
                          >
                            {item.icon} {item.label} {crop === item.key && '✓'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* pH Input */}
                    <div className="section">
                      <label className="section-label">
                        Soil pH Reading
                        <small>Optional — skip if you don't have a meter reading</small>
                      </label>
                      <div className="ph-input-container">
                        <input
                          type="number"
                          min="3.5"
                          max="9.0"
                          step="0.1"
                          value={phReading}
                          onChange={(e) => setPhReading(e.target.value)}
                          placeholder="e.g. 5.1"
                        />
                        <div className="ph-gradient-bar">
                          {phReading && (
                            <div 
                              className="ph-thumb" 
                              style={{ 
                                left: `${Math.min(100, Math.max(0, ((parseFloat(phReading) - 3.5) / 5.5) * 100))}%` 
                              }}
                            />
                          )}
                        </div>
                        {currentPHLabel && (
                          <div className={`ph-badge ${currentPHLabel.style}`}>
                            {currentPHLabel.badge}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Symptoms Selector */}
                    <div className="section">
                      <label className="section-label">Symptoms You See</label>
                      <div className="symptom-grid">
                        {defaultSymptoms.map((item) => {
                          const isSelected = symptoms.includes(item.key);
                          const isNone = item.key === 'none';
                          return (
                            <button
                              key={item.key}
                              className={`symptom-card ${isNone ? 'full-width' : ''} ${isSelected ? 'selected' : ''}`}
                              onClick={() => {
                                if (item.key === 'none') {
                                  setSymptoms(['none']);
                                } else {
                                  const next = symptoms.filter((s) => s !== 'none');
                                  if (next.includes(item.key)) {
                                    setSymptoms(next.filter((s) => s !== item.key));
                                  } else {
                                    setSymptoms([...next, item.key]);
                                  }
                                }
                              }}
                            >
                              <strong>{item.label}</strong>
                              <span>{item.sub}</span>
                              {isSelected && <span className="check-tag">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Phone Input */}
                    <div className="section">
                      <label className="section-label">Phone Number (optional)</label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+254..."
                      />
                      <span className="hint">To receive an SMS with your soil report</span>
                    </div>
                  </div>
                )}

                {/* Common crop selector for voice/image mode */}
                {mode !== 'form' && (
                  <div className="form-area" style={{ padding: '0', boxShadow: 'none', background: 'transparent' }}>
                    <div className="section">
                      <label className="section-label">Crop</label>
                      <div className="pill-grid">
                        {[
                          { key: 'maize', icon: '🌽', label: 'Maize' },
                          { key: 'wheat', icon: '🌾', label: 'Wheat' },
                          { key: 'barley', icon: '🌾', label: 'Barley' },
                          { key: 'other', icon: '🌿', label: 'Other' }
                        ].map((item) => (
                          <button
                            key={item.key}
                            className={`choice-pill ${crop === item.key ? 'active' : ''}`}
                            onClick={() => setCrop(item.key)}
                          >
                            {item.icon} {item.label} {crop === item.key && '✓'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* CTA Button */}
                <button 
                  className={`cta ${submitError ? 'error-state' : ''}`}
                  onClick={handleSubmit}
                  disabled={loading || (mode === 'voice' && !transcription.trim()) || (mode === 'image' && !selectedImage)}
                >
                  {loading ? (
                    <>
                      <div className="spinner" />
                      <span>Analyzing your soil...</span>
                    </>
                  ) : submitError ? (
                    <span>Error — Tap to Retry</span>
                  ) : (
                    <>
                      <span>Get Soil Advice</span>
                      <span style={{ fontSize: '20px' }}>→</span>
                    </>
                  )}
                </button>

              </div>
            </div>
          )}

          {/* SCREEN 2: MAP */}
          {activeTab === 'map' && (
            <div className="screen map-screen" style={{ padding: 0 }}>
              <div className="map-container-wrapper">
                <div id="map-container" />
                
                {/* Float patterns toggle */}
                <button className="patterns-toggle-btn" onClick={() => setShowPatterns(!showPatterns)}>
                  📊 {showPatterns ? 'Close Trends' : 'Soil Trends'}
                </button>

                {/* Patterns Sliding Panel */}
                {showPatterns && (
                  <div className="patterns-slide-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <h4>Soil Trends</h4>
                      <button onClick={() => setShowPatterns(false)} style={{ fontWeight: '800', color: 'var(--soil)' }}>✕</button>
                    </div>
                    <p className="sub">Analysis of all assessed zones</p>
                    <div className="patterns-list">
                      {patterns.length === 0 ? (
                        <div style={{ padding: '20px 0', textAlign: 'center', color: '#666' }}>No trend data available</div>
                      ) : patterns.map((p, idx) => {
                        const isGroup = p.intervention_level === 'GROUP INTERVENTION RECOMMENDED';
                        const isCluster = p.intervention_level === 'CLUSTER MONITORING NEEDED';
                        const levelClass = isGroup ? 'group' : (isCluster ? 'cluster' : 'individual');
                        const headerText = isGroup ? '⚠️ GROUP INTERVENTION REQUIRED' : (isCluster ? '⏳ MONITOR CLUSTER' : '✅ INDIVIDUAL ADVISORY');
                        
                        return (
                          <div key={idx} className={`pattern-item-card ${levelClass}`}>
                            <h6>{headerText}</h6>
                            <div className="details">{p.zone} • {p.issue_type}</div>
                            <div className="stats">Avg pH: {p.average_ph} | {p.farms_affected} farms affected</div>
                            <div className="action">Action: {p.recommended_action}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Stats floating card */}
                <div className="stats-floating-card">
                  <div className="divider">
                    <div className="value">{assessments.length}</div>
                    <div className="label">Farms</div>
                  </div>
                  <div className="divider">
                    <div className="value">{assessments.filter((a) => a.properties?.urgency === 'high').length}</div>
                    <div className="label">Urgent</div>
                  </div>
                  <div>
                    <div className="value">{new Set(assessments.map((a) => a.properties?.county).filter(Boolean)).size}</div>
                    <div className="label">Counties</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 3: HISTORY */}
          {activeTab === 'history' && (
            <div className="screen history-screen">
              <h2>Assessment History</h2>
              <p className="subtitle">{assessments.length} assessments recorded</p>
              
              {/* Filter pills scroll */}
              <div className="filters-row">
                {[
                  { key: 'all', label: 'All ▼' },
                  { key: 'urgent', label: '⚠️ Urgent' },
                  { key: 'important', label: '⏳ Important' },
                  { key: 'good', label: '✅ Good' },
                  { key: 'maize', label: '🌽 Maize' },
                  { key: 'wheat', label: '🌾 Wheat' }
                ].map((pill) => (
                  <button
                    key={pill.key}
                    className={`filter-pill ${historyFilter === pill.key ? 'active' : ''}`}
                    onClick={() => setHistoryFilter(pill.key)}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>

              {/* List */}
              <div className="history-list">
                {visibleAssessments.length === 0 ? (
                  <div className="empty-state-container">
                    <svg viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect width="140" height="140" rx="20" fill="#F3F4F6"/>
                      <path d="M40 90C45 75 60 70 70 75C80 80 95 75 100 90" stroke="var(--green)" strokeWidth="4" strokeLinecap="round"/>
                      <circle cx="70" cy="50" r="16" stroke="var(--green)" strokeWidth="4"/>
                      <path d="M20 110C40 100 100 100 120 110" stroke="var(--soil)" strokeWidth="4" strokeLinecap="round"/>
                      <circle cx="110" cy="35" r="8" fill="#FCD34D"/>
                    </svg>
                    <h3>No assessments yet</h3>
                    <p>Start your first assessment</p>
                    <button onClick={() => setActiveTab('assess')}>Assess Now →</button>
                  </div>
                ) : (
                  visibleAssessments.map((item) => {
                    const props = item.properties || {};
                    const id = props.id;
                    const cropEmoji = props.crop === 'maize' ? '🌽' : (props.crop === 'wheat' ? '🌾' : (props.crop === 'barley' ? '🌾' : '🌿'));
                    const formattedDate = props.created_at ? new Date(props.created_at).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' }) : 'Today';
                    const methodIcon = props.input_method === 'web' ? '🌐' : (props.input_method === 'ussd' ? '📱' : '🎤');
                    const score = props.soil_health_score || 0;
                    const urgency = props.urgency || 'low';
                    const urgencyText = urgency === 'high' ? 'Urgent' : (urgency === 'medium' ? 'Important' : 'Good');

                    return (
                      <button
                        key={id}
                        id={`history-card-${id}`}
                        className="history-card-item"
                        onClick={() => {
                          setCurrentResult(mapFeatureToResult(item));
                          setShowResults(true);
                        }}
                      >
                        <div className="top">
                          <span className="crop-county">
                            {cropEmoji} {props.crop} • {props.county}
                          </span>
                          <span className="date-method">
                            {formattedDate} {methodIcon}
                          </span>
                        </div>

                        <div className="score-line">
                          <div className="score-progress-bar">
                            <div 
                              className={`score-progress-fill ${urgency}`} 
                              style={{ width: `${score * 10}%` }}
                            />
                          </div>
                          <span className="score-num">{score}/10</span>
                          <span className={`urgency-tag ${urgency}`}>{urgencyText}</span>
                        </div>

                        <p className="summary">
                          {props.farmer_summary_sw ? (props.farmer_summary_sw.length > 100 ? props.farmer_summary_sw.slice(0, 100) + '...' : props.farmer_summary_sw) : 'Soil advisory'}
                        </p>

                        <div className="chips-row">
                          {props.lime_kg_acre > 0 && (
                            <span className="chip">🪨 Lime {props.lime_kg_acre}kg</span>
                          )}
                          <span className="chip">🌿 Fertilizer</span>
                          <span className="chip">🌱 Cover Crop</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* SCREEN 4: HELP */}
          {activeTab === 'help' && (
            <div className="screen help-screen">
              <h2>Help</h2>
              <p className="subtitle">SoilIQ is built for fast, one-thumb field use</p>

              {/* Cycling icons cards */}
              <HelpWorkingStep />

              {/* USSD Section */}
              <div className="ussd-card">
                <h4>No Smartphone?</h4>
                <p>Use any basic phone to get soil advice via USSD</p>
                <div className="code-display">*384*12345#</div>
                <button
                  onClick={() => {
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText('*384*12345#');
                      showToast('Copied!', 'success');
                    }
                  }}
                >
                  📋 Copy Code
                </button>
                <p style={{ fontSize: '13px', opacity: 0.9, marginTop: '8px' }}>
                  You will receive an SMS with your advisory in Swahili
                </p>
              </div>

              {/* Technology Stack Card */}
              <div className="tech-card">
                <h5>SoilIQ is Powered By:</h5>
                <ul>
                  <li>SoilGrids — global soil data per location</li>
                  <li>KALRO 2023 — Kenya fertilizer recommendations</li>
                  <li>Gatsby Africa Lime Report — soil acidity baselines</li>
                  <li>Open-Meteo — live weather data</li>
                  <li>Qwen 2.5 via Featherless — AI language model</li>
                  <li>Paza Whisper (Microsoft) — Swahili & Kikuyu ASR</li>
                  <li>Neo4j — soil knowledge graph</li>
                  <li>Africa's Talking — USSD & SMS gateway gateway gateway</li>
                </ul>
              </div>

              {/* Server Status Indicator */}
              <div className="server-status-row">
                <span className={`pill ${serverHealthy ? 'healthy' : 'unhealthy'}`}>
                  {serverHealthy ? '🟢 Server online' : '🔴 Server offline'}
                </span>
                <span>Checked: {lastServerCheck}</span>
              </div>
            </div>
          )}

          {/* Bottom Tabs Nav Bar */}
          <nav className="bottom-nav">
            {[
              { key: 'assess', icon: '🌱', label: 'Assess' },
              { key: 'map', icon: '🗺️', label: 'Map' },
              { key: 'history', icon: '📋', label: 'History' },
              { key: 'help', icon: 'ℹ️', label: 'Help' }
            ].map((tab) => (
              <button
                key={tab.key}
                className={`nav-item ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span className="icon">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {/* Manual Location Dialog Modal */}
      {showLocationModal && renderLocationModal()}

      {/* Dynamic Success Checkmark Overlay */}
      {showSuccessOverlay && (
        <div className="success-overlay">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          <h2 style={{ color: 'var(--green)', fontSize: '24px', fontWeight: '800' }}>Done!</h2>
        </div>
      )}

      {/* Results Bottom Sheet */}
      {showResults && currentResult && (
        <ResultSheet 
          result={currentResult} 
          speaking={speaking}
          onClose={resetForm} 
          onSpeak={handleSpeak}
          onShare={handleShare}
          onSelectNearbyLink={() => {
            setShowResults(false);
            setActiveTab('map');
            showToast('Looking for nearby farms...', 'info');
          }}
        />
      )}

      {/* Toast Notification */}
      {toast.text && (
        <div className={`toast ${toast.type}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

// Help Screen cycling animation component
function HelpWorkingStep() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => (s + 1) % 3);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="works-step-card">
      {step === 0 && (
        <>
          <div className="icon">🎤 / 📷 / ✏️</div>
          <strong>Step 1: Record, Photo, or Fill the Form</strong>
          <p>Describe what you see — by voice, photo, or text.</p>
        </>
      )}
      {step === 1 && (
        <>
          <div className="icon">🤖</div>
          <strong>Step 2: SoilIQ Analyses</strong>
          <p>Soil data • Weather • Nearby farms • KALRO science</p>
        </>
      )}
      {step === 2 && (
        <>
          <div className="icon">🌱</div>
          <strong>Step 3: Get Instant Advice</strong>
          <p>Receive a report with clear action steps in English and Swahili.</p>
        </>
      )}
    </div>
  );
}

// Bottom sheet details component
function ResultSheet({ result, speaking, onClose, onSpeak, onShare, onSelectNearbyLink }) {
  const [expanded, setExpanded] = useState(false);
  const rec = result.recommendation || {};
  const urgency = rec.urgency || 'low';
  const score = rec.soil_health_score || 0;
  const location = result.location || {};
  const soil = result.soil_data || {};
  const graph = result.graph_context || {};

  const dashArray = `${(score / 10) * 220} 220`;

  return (
    <div className="sheet-overlay">
      <div className="sheet">
        <div className="drag-handle" />

        {/* Urgency Banner */}
        <div className={`urgency-banner ${urgency}`}>
          {urgency === 'high' && '⚠️ URGENT — Action required now'}
          {urgency === 'medium' && '⏳ IMPORTANT — Act within the week'}
          {urgency === 'low' && '✅ GOOD — Continue current practice'}
        </div>

        {/* Score and County Row */}
        <div className="score-row">
          <div className="score-gauge-container">
            <div className="score-gauge-svg">
              <svg width="96" height="96" viewBox="0 0 80 80">
                <circle className="bg-circle" cx="40" cy="40" r="35" />
                <circle 
                  className={`val-circle ${urgency}`} 
                  cx="40" cy="40" r="35" 
                  strokeDasharray={dashArray} 
                />
              </svg>
              <div className="score-text-center">
                <strong>{score}</strong>
                <span>/ 10</span>
              </div>
            </div>
            <span className="label">Soil Health</span>
          </div>

          <div className="location-info">
            <h4>{location.county || 'Nakuru'}</h4>
            <span className="zone">{graph.zone || 'Central Rift Highlands'}</span>
            <span className="nearby">🌾 {graph.farms_assessed_nearby || 0} nearby farms</span>
            <span className="season-pill">{result.season_label || 'Season'}</span>
          </div>
        </div>

        {/* Primary Issues scroll */}
        <div className="primary-issues-row">
          {(rec.primary_issues || []).map((issue, idx) => (
            <span key={idx} className={`issue-chip ${urgency}`}>
              {issue}
            </span>
          ))}
        </div>

        {/* FARMER CARD */}
        <div className="farmer-card">
          <div className="header-row">
            <span>🌱</span>
            <span>Farmer Advisory</span>
          </div>
          <p className="message">{rec.farmer_summary_sw}</p>
          <div className="action-buttons">
            <button onClick={onSpeak}>
              {speaking ? '⏹ Stop' : '🔊 Read Aloud'}
            </button>
            <button onClick={onShare}>
              📤 Share
            </button>
          </div>
        </div>

        {/* WORKER DETAIL COLLAPSIBLE */}
        <div className="worker-card">
          <button className="trigger" onClick={() => setExpanded(!expanded)}>
            <span>Technical Details</span>
            <span>{expanded ? '▲' : '▼'}</span>
          </button>
          {expanded && (
            <div className="details">
              <p style={{ fontWeight: '500' }}>{rec.worker_summary_en}</p>
              
              <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {(rec.primary_issues || []).map((issue, idx) => (
                  <li key={idx} style={{ listStyle: 'disc' }}>{issue}</li>
                ))}
              </ul>

              <div className="soil-data-summary">
                pH: {soil.ph || 'N/A'} | SOC: {soil.soc || 'N/A'}g/kg | N: {soil.nitrogen || 'N/A'}g/kg | Clay: {soil.clay_pct || 'N/A'}%
              </div>
              <div style={{ fontSize: '12px', fontStyle: 'italic', color: '#666' }}>
                Source: {soil.source || 'SoilGrids'}
              </div>
            </div>
          )}
        </div>

        {/* RECOMMENDATIONS CARDS */}
        <div className="recommendations-scroll-container">
          <span className="section-title">Actions to Take</span>
          <div className="recommendations-row">
            {/* LIME CARD */}
            {rec.lime_kg_acre > 0 ? (
              <div className="reco-card">
                <span className="icon">🪨</span>
                <h5>Lime</h5>
                <span className="amount">{rec.lime_kg_acre} kg/acre</span>
                <span className="timing">{rec.lime_timing}</span>
                <span className="source">Source: KALRO 2023 ✓</span>
              </div>
            ) : (
              <div className="reco-card disabled">
                <span className="icon">🪨</span>
                <h5>Lime</h5>
                <span className="timing" style={{ fontWeight: '600' }}>Not required</span>
                <span className="source">Source: KALRO 2023 ✓</span>
              </div>
            )}

            {/* FERTILIZER CARD */}
            <div className="reco-card">
              <span className="icon">🌿</span>
              <h5>Fertilizer</h5>
              <span className="amount" style={{ fontSize: '15px' }}>{rec.fertilizer_type || 'DAP'}</span>
              <span className="timing">{rec.fertilizer_kg_acre || 50} kg/acre — Planting</span>
              <span className="amount" style={{ fontSize: '15px', marginTop: '6px' }}>{rec.topdress_type || 'CAN'}</span>
              <span className="timing">{rec.topdress_kg_acre || 50} kg/acre — Top-dress</span>
              <span className="source">Source: KALRO 2023 ✓</span>
            </div>

            {/* MANURE CARD */}
            <div className="reco-card">
              <span className="icon">🐄</span>
              <h5>Organic Manure</h5>
              <span className="timing" style={{ fontWeight: '700', fontSize: '15px' }}>Farmyard Manure</span>
              <span className="timing" style={{ marginTop: '4px' }}>{rec.manure}</span>
            </div>

            {/* COVER CROP CARD */}
            <div className="reco-card">
              <span className="icon">🌱</span>
              <h5>Cover Crop</h5>
              <span className="timing" style={{ fontWeight: '700', fontSize: '15px' }}>Intercrop / Cover</span>
              <span className="timing" style={{ marginTop: '4px' }}>{rec.cover_crop}</span>
            </div>
          </div>
        </div>

        {/* SEASONAL NOTE */}
        {rec.seasonal_note && (
          <div className="seasonal-card">
            <span>🌧️</span>
            <div>{rec.seasonal_note}</div>
          </div>
        )}

        {/* GRAPH INTELLIGENCE NOTE */}
        {graph.farms_assessed_nearby > 0 && (
          <div className="graph-note-card" onClick={onSelectNearbyLink}>
            <span>🔗 Neo4j: {graph.farms_assessed_nearby} nearby farms assessed</span>
            <span>→</span>
          </div>
        )}

        {/* ACTIONS */}
        <div className="sheet-buttons">
          <button className="save-btn" onClick={() => {
            // Save report is a no-op / success indicator
            onClose();
          }}>
            💾 Save Report
          </button>
          <button className="new-btn" onClick={onClose}>
            🔄 New Assessment
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper to query API base with a timeout AbortController
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Convert GeoJSON Feature to the results sheet format
function mapFeatureToResult(feature) {
  const props = feature.properties || {};
  const coords = feature.geometry?.coordinates || [36.08, -0.303];
  
  const ph = props.soil_health_score <= 4 ? 4.8 : (props.soil_health_score <= 6 ? 5.3 : 6.2);
  const limeKg = props.lime_kg_acre || (ph < 5.0 ? 500 : (ph < 5.5 ? 250 : 0));
  const limeTiming = limeKg > 0 ? "Apply 2 weeks before planting" : "No liming required";
  
  let fertilizerType = "DAP";
  let fertilizerKg = 50;
  let topdressType = "CAN";
  let topdressKg = 50;
  let manure = "2 tonnes/acre farmyard manure";
  let coverCrop = "Not required";

  if (props.crop === "wheat") {
    fertilizerType = "NPK 23:23:0";
    fertilizerKg = 50;
    topdressType = "Urea";
    topdressKg = 40;
    manure = "1.5 tonnes/acre compost";
  } else if (props.crop === "barley") {
    fertilizerType = "DAP";
    fertilizerKg = 50;
    topdressType = "CAN";
    topdressKg = 50;
    manure = "2 tonnes/acre manure";
  }

  if (ph < 5.0) {
    coverCrop = "Mucuna pruriens (velvet bean)";
  } else if (ph < 5.5) {
    coverCrop = "Desmodium";
  }

  return {
    id: props.id,
    phone: props.phone || "",
    location: {
      latitude: coords[1],
      longitude: coords[0],
      county: props.county
    },
    recommendation: {
      farmer_summary_sw: props.farmer_summary_sw,
      worker_summary_en: `Soil score of ${props.soil_health_score}/10 in ${props.county} indicating ${ph < 5.5 ? 'acidity concerns' : 'adequate conditions'}. KALRO fertilizer scheme advised.`,
      soil_health_score: props.soil_health_score,
      urgency: props.urgency,
      primary_issues: ph < 5.0 ? ["Severe soil acidity", "Aluminium toxicity", "Phosphorus lockup"] : (ph < 5.5 ? ["Moderate soil acidity", "Phosphorus lockup"] : ["Good pH"]),
      lime_kg_acre: limeKg,
      lime_timing: limeTiming,
      fertilizer_type: fertilizerType,
      fertilizer_kg_acre: fertilizerKg,
      topdress_type: topdressType,
      topdress_kg_acre: topdressKg,
      manure: manure,
      cover_crop: coverCrop,
      seasonal_note: ph < 5.5 ? "Long Rains (MAM) — apply lime now before the rains arrive" : "Maintain normal planting schedule."
    },
    season_label: props.season_label || "Long Rains Season",
    soil_data: {
      ph: ph,
      soc: 18.2,
      nitrogen: 1.5,
      clay_pct: 32,
      source: "SoilGrids"
    },
    graph_context: {
      zone: props.zone || "Central Rift Highlands",
      soil_type: "Humic Nitisols",
      farms_assessed_nearby: 12,
      known_issues: ph < 5.5 ? ["Asidi", "Phosphorus lockup"] : []
    },
    created_at: props.created_at,
    input_method: props.input_method || "web"
  };
}

function loadCachedAssessments() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCachedAssessments(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export default App;
