import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { AppView, DetectionResult, EcoAnalysis } from './types';
import { PAPER_DATA_COTTON } from './constants';
import { analyzeWeedImage } from './services/geminiService';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar 
} from 'recharts';
import { 
  Leaf, Upload as UploadIcon, Camera as CameraIcon, BrainCircuit, Activity, Sprout, X, Settings, RefreshCw, ChevronDown,
  Filter, Eye, EyeOff, Smartphone, Laptop
} from 'lucide-react';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);
  const [selectedDataset, setSelectedDataset] = useState<'Cotton' | 'Beet'>('Cotton');
  
  // Dashboard State
  const [chartData] = useState(PAPER_DATA_COTTON);

  // Upload State
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<EcoAnalysis | null>(null);

  // Live State
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null); // Store stream in state
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  
  // Real-time detection state
  const [liveDetections, setLiveDetections] = useState<Array<{id: number, x: number, y: number, w: number, h: number, label: string, conf: number}>>([]);
  const [isLiveInferencing, setIsLiveInferencing] = useState(false);

  // Live Filter State
  const [detectedWeedTypes, setDetectedWeedTypes] = useState<Set<string>>(new Set());
  const [disabledWeedTypes, setDisabledWeedTypes] = useState<Set<string>>(new Set());
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // --- Initialization ---

  const getDevices = useCallback(async () => {
    try {
      // Request permission first to get labels
      await navigator.mediaDevices.getUserMedia({ video: true }); 
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      setVideoDevices(videoInputs);
      
      // If currently selected device is no longer available, reset
      if (selectedDeviceId && !videoInputs.find(d => d.deviceId === selectedDeviceId)) {
          setSelectedDeviceId(videoInputs[0]?.deviceId || '');
      }

      // If no device selected, try to find a back facing or virtual one first
      if (!selectedDeviceId && videoInputs.length > 0) {
         const mobileCam = videoInputs.find(d => 
             d.label.toLowerCase().includes('back') || 
             d.label.toLowerCase().includes('virtual') ||
             d.label.toLowerCase().includes('phone')
         );
         setSelectedDeviceId(mobileCam ? mobileCam.deviceId : videoInputs[0].deviceId);
      }
    } catch (err) {
      console.error("Error fetching devices:", err);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    getDevices();
    
    // Listen for device changes (plugging in phone via Windows Phone Link, etc.)
    const handleDeviceChange = () => {
        console.log("Device change detected, refreshing list...");
        getDevices();
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    
    return () => {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [getDevices]);

  // --- Handlers ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedImage(reader.result as string);
        setAnalysisResult(null); // Reset previous analysis
      };
      reader.readAsDataURL(file);
    }
  };

  const runAnalysis = async () => {
    if (!uploadedImage) return;
    setIsAnalyzing(true);
    
    const base64Data = uploadedImage.split(',')[1];
    
    try {
      const result = await analyzeWeedImage(base64Data, selectedDataset);
      setAnalysisResult(result);
    } catch (err) {
      console.error(err);
      alert("Analysis failed. Please check console.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Toggle Camera Logic - Refined
  const toggleCamera = useCallback(async () => {
    if (stream) {
      // Stop existing stream
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setLiveDetections([]);
      setDetectedWeedTypes(new Set()); // Optional: Clear history on stop
    } else {
      try {
        const constraints = { 
          video: { 
            deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
            width: { ideal: 1280 }, // Lower res for faster transmission
            height: { ideal: 720 }
          } 
        };
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        setStream(newStream);
      } catch (err) {
        console.error("Camera error:", err);
        alert("Unable to access camera. Please check permissions.");
      }
    }
  }, [stream, selectedDeviceId]);

  // Handle switching cameras while active
  const handleDeviceChange = async (newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    if (stream) {
        // Stop current
        stream.getTracks().forEach(track => track.stop());
        // Start new
        try {
            const constraints = { 
              video: { 
                deviceId: { exact: newDeviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 }
              } 
            };
            const newStream = await navigator.mediaDevices.getUserMedia(constraints);
            setStream(newStream);
        } catch (err) {
            console.error("Error switching camera:", err);
            setStream(null);
        }
    }
  };

  // Attach stream to video element when it mounts/updates
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]); 

  // --- REAL-TIME INFERENCE LOOP ---
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    let isMounted = true;

    const captureFrameAndAnalyze = async () => {
       if (!videoRef.current || !stream || isLiveInferencing) return;
       
       setIsLiveInferencing(true);

       try {
         // 1. Capture Frame
         const video = videoRef.current;
         if (video.readyState !== 4) { // HAVE_ENOUGH_DATA
             setIsLiveInferencing(false);
             return;
         }

         const canvas = document.createElement('canvas');
         // Use smaller dimensions for speed optimization
         const scale = 0.5; 
         canvas.width = video.videoWidth * scale;
         canvas.height = video.videoHeight * scale;
         const ctx = canvas.getContext('2d');
         
         if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            // 2. Convert to Base64 (Low quality JPEG for speed)
            const base64 = canvas.toDataURL('image/jpeg', 0.6);
            const data = base64.split(',')[1];

            // 3. Send to Gemini (PD-YOLO Simulation)
            // Explicitly requesting "Beet" context as per LincolnBeet requirement
            const result = await analyzeWeedImage(data, 'Beet');

            if (isMounted && result.detections) {
               // Update known types for filtering
               setDetectedWeedTypes(prev => {
                  const newSet = new Set(prev);
                  let changed = false;
                  result.detections.forEach(d => {
                    if (!newSet.has(d.weedType)) {
                      newSet.add(d.weedType);
                      changed = true;
                    }
                  });
                  return changed ? newSet : prev;
               });

               // 4. Map Detections to Viewport %
               const mappedDetections = result.detections.map((d, i) => {
                   if (!d.bbox || d.bbox.length < 4) return null;
                   const [ymin, xmin, ymax, xmax] = d.bbox;
                   return {
                       id: Date.now() + i,
                       x: xmin * 100,
                       y: ymin * 100,
                       w: (xmax - xmin) * 100,
                       h: (ymax - ymin) * 100,
                       label: d.weedType,
                       conf: d.confidence
                   };
               }).filter(Boolean) as typeof liveDetections;

               setLiveDetections(mappedDetections);
            }
         }
       } catch (err) {
          console.error("Live inference frame drop:", err);
       } finally {
          if (isMounted) setIsLiveInferencing(false);
       }
    };

    if (stream) {
      // Poll every 4 seconds to stay within standard API rate limits (15 RPM for free tier)
      interval = setInterval(captureFrameAndAnalyze, 4000);
    }

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [stream]); // detectedWeedTypes dependency removed to avoid re-creating interval on type update

  // Helper function to generate distinct colors for different weed types
  const getWeedColor = (label: string) => {
    const colors = [
      { border: 'border-red-500', bg: 'bg-red-600', shadow: 'shadow-red-500/40' },
      { border: 'border-orange-500', bg: 'bg-orange-600', shadow: 'shadow-orange-500/40' },
      { border: 'border-amber-500', bg: 'bg-amber-600', shadow: 'shadow-amber-500/40' },
      { border: 'border-purple-500', bg: 'bg-purple-600', shadow: 'shadow-purple-500/40' },
      { border: 'border-pink-500', bg: 'bg-pink-600', shadow: 'shadow-pink-500/40' },
      { border: 'border-blue-500', bg: 'bg-blue-600', shadow: 'shadow-blue-500/40' },
    ];
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
      hash = label.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // Helper to determine icon
  const getDeviceIcon = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes('back') || l.includes('virtual') || l.includes('phone') || l.includes('droid')) {
        return <Smartphone size={16} className="text-emerald-500" />;
    }
    return <Laptop size={16} className="text-slate-500" />;
  };

  // --- Views ---

  const renderDashboard = () => (
    <div className="space-y-8 animate-fadeIn max-w-7xl mx-auto pb-12">
      <header className="mb-12 text-center pt-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold mb-4 border border-emerald-200">
          <Leaf size={16} /> Sustainable Agriculture AI
        </div>
        <h1 className="text-5xl md:text-7xl font-bold text-slate-800 mb-6 tracking-tight">
          PD-YOLO <span className="text-emerald-600">AgriVision</span>
        </h1>
        <p className="text-slate-500 max-w-2xl mx-auto text-lg md:text-xl leading-relaxed">
          Next-generation weed detection utilizing multi-scale feature fusion (PF-FPN).
          Achieving <span className="text-emerald-600 font-bold bg-emerald-50 px-2 rounded">95.0% mAP</span> precision for cleaner, greener fields.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Main Chart */}
        <div className="glass-panel p-8 rounded-3xl md:col-span-8 shadow-xl">
          <div className="flex justify-between items-center mb-8">
             <div>
                <h3 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                  <Activity className="text-emerald-500" /> Performance Benchmark
                </h3>
                <p className="text-slate-400 text-sm mt-1">Comparision on CottonWeedDet12 Dataset</p>
             </div>
             <div className="flex gap-2">
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
                   <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div> Live
                </span>
             </div>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="model" stroke="#64748b" tick={{fill: '#64748b'}} axisLine={false} tickLine={false} dy={10} />
                <YAxis stroke="#64748b" tick={{fill: '#64748b'}} axisLine={false} tickLine={false} />
                <Tooltip 
                  cursor={{fill: '#f1f5f9'}}
                  contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                  itemStyle={{ color: '#1e293b' }}
                />
                <Legend iconType="circle" wrapperStyle={{paddingTop: '20px'}} />
                <Bar dataKey="mAP05" name="mAP@0.5 (%)" fill="#059669" radius={[6, 6, 0, 0]} barSize={40} />
                <Bar dataKey="fps" name="FPS (Speed)" fill="#38bdf8" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="md:col-span-4 space-y-6">
           <div className="glass-panel p-6 rounded-3xl bg-gradient-to-br from-white to-emerald-50/50">
              <h3 className="text-xl font-bold text-slate-800 mb-4">Core Tech</h3>
              <ul className="space-y-4">
                {[
                   { icon: BrainCircuit, color: 'text-purple-500', title: 'PF-FPN', desc: 'Parallel Focusing Feature Pyramid' },
                   { icon: RefreshCw, color: 'text-blue-500', title: 'FFAM & HARFM', desc: 'Adaptive Recalibration Fusion' },
                   { icon: Settings, color: 'text-orange-500', title: 'Dynamic Head', desc: 'Scale-aware Attention' }
                ].map((item, i) => (
                   <li key={i} className="flex items-start gap-3 p-3 rounded-xl hover:bg-white transition-colors">
                      <item.icon className={`${item.color} mt-1`} size={20} />
                      <div>
                         <strong className="block text-slate-700">{item.title}</strong>
                         <span className="text-xs text-slate-500 leading-tight block mt-1">{item.desc}</span>
                      </div>
                   </li>
                ))}
              </ul>
           </div>

           <div className="glass-panel p-6 rounded-3xl flex flex-col items-center justify-center text-center space-y-2">
              <div className="text-4xl font-black text-slate-800">42.5</div>
              <div className="text-sm font-medium text-slate-500 uppercase tracking-wide">FPS on RTX 3050Ti</div>
              <div className="w-full h-1 bg-slate-100 rounded-full mt-2 overflow-hidden">
                 <div className="h-full bg-emerald-500 w-[75%] rounded-full"></div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );

  const renderUpload = () => (
    <div className="max-w-5xl mx-auto space-y-8 animate-fadeIn pb-20">
      <div className="glass-panel p-8 md:p-10 rounded-3xl shadow-xl bg-white/80">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
              <UploadIcon className="text-emerald-600" size={32} /> Batch Analysis
            </h2>
            <p className="text-slate-500 mt-2">Upload high-res field images for precise segmentation.</p>
          </div>
          <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
            <button 
              onClick={() => setSelectedDataset('Cotton')}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${selectedDataset === 'Cotton' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Cotton
            </button>
            <button 
              onClick={() => setSelectedDataset('Beet')}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${selectedDataset === 'Beet' ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Beet
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="space-y-6">
            <div className={`relative rounded-2xl overflow-hidden transition-all bg-slate-50 ${!uploadedImage ? 'border-2 border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/30 h-80' : 'border border-slate-200'}`}>
              {!uploadedImage ? (
                 <label className="cursor-pointer flex flex-col items-center w-full h-full justify-center group">
                    <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                       <UploadIcon size={28} className="text-emerald-500" />
                    </div>
                    <span className="text-slate-600 font-medium">Click to upload field image</span>
                    <span className="text-slate-400 text-xs mt-1">Supports JPG, PNG (Max 10MB)</span>
                    <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                 </label>
              ) : (
                 <div className="relative w-full h-full min-h-[300px] flex items-center justify-center bg-slate-100 group">
                    <img src={uploadedImage} alt="Uploaded" className="max-w-full max-h-[500px] object-contain" />
                    
                    {/* Bounding Box Overlay */}
                    {analysisResult?.detections?.map((det, idx) => {
                       if (!det.bbox) return null;
                       const [ymin, xmin, ymax, xmax] = det.bbox;
                       const color = getWeedColor(det.weedType);
                       return (
                          <div 
                             key={idx}
                             className={`absolute border-2 ${color.border} shadow-sm z-10 pointer-events-none transition-opacity duration-500`}
                             style={{
                                top: `${ymin * 100}%`,
                                left: `${xmin * 100}%`,
                                width: `${(xmax - xmin) * 100}%`,
                                height: `${(ymax - ymin) * 100}%`
                             }}
                          >
                             <div className={`absolute -top-7 left-[-2px] ${color.bg} text-white text-[10px] md:text-xs font-bold px-2 py-1 rounded shadow-md whitespace-nowrap flex items-center gap-1`}>
                                <span>{det.weedType}</span>
                                <span className="bg-white/20 px-1.5 rounded-sm">{Math.round(det.confidence * 100)}%</span>
                             </div>
                          </div>
                       );
                    })}

                    <button 
                       onClick={() => { setUploadedImage(null); setAnalysisResult(null); }}
                       className="absolute top-4 right-4 bg-white/90 p-2.5 rounded-full text-slate-700 hover:text-red-600 shadow-lg hover:shadow-xl transition-all z-20 backdrop-blur-sm opacity-0 group-hover:opacity-100 transform hover:scale-105"
                    >
                       <X size={20} />
                    </button>
                 </div>
              )}
            </div>
            
            <button 
              onClick={runAnalysis}
              disabled={!uploadedImage || isAnalyzing}
              className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all flex items-center justify-center gap-3 ${
                !uploadedImage || isAnalyzing 
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white hover:shadow-emerald-500/30'
              }`}
            >
              {isAnalyzing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Running PD-YOLO Inference...
                </>
              ) : (
                <>
                  <BrainCircuit size={24} /> Detect Weeds
                </>
              )}
            </button>
          </div>

          <div className="relative flex flex-col justify-center">
            {analysisResult ? (
              <div className="space-y-5 animate-slideUp">
                <div className="glass-panel p-6 rounded-2xl border-l-8 border-emerald-500 bg-emerald-50/50">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xs text-emerald-600 font-bold uppercase tracking-wider mb-1">Status Report</h4>
                      <p className="text-2xl font-bold text-slate-800">
                        {analysisResult.detections.length > 0 ? `${analysisResult.detections.length} Weeds Identified` : "Field is Clean"}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded-full shadow-sm">
                      <Leaf className="text-emerald-500" size={24} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                   <div className="glass-panel p-5 rounded-2xl border-l-4 border-amber-500">
                      <h4 className="text-xs text-slate-400 font-bold uppercase mb-2">Yield Impact</h4>
                      <p className="text-3xl font-black text-amber-500">{analysisResult.estimatedYieldLoss}<span className="text-lg text-slate-400 font-normal">%</span></p>
                   </div>
                   <div className="glass-panel p-5 rounded-2xl border-l-4 border-blue-500">
                      <h4 className="text-xs text-slate-400 font-bold uppercase mb-2">Rec. Dosage</h4>
                      <p className="text-3xl font-black text-blue-500">{analysisResult.herbicideDosage} <span className="text-sm text-slate-400 font-medium">ml/m²</span></p>
                   </div>
                </div>

                <div className="glass-panel p-6 rounded-2xl bg-white shadow-sm border border-slate-100">
                  <h4 className="text-sm text-slate-800 font-bold uppercase mb-3 flex items-center gap-2">
                     <Sprout size={16} className="text-emerald-500"/> Agronomist Advice
                  </h4>
                  <p className="text-slate-600 text-sm leading-7">{analysisResult.remediationAdvice}</p>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-slate-400 text-center p-12 border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                <Sprout size={56} className="mb-4 text-emerald-200" />
                <h3 className="text-lg font-semibold text-slate-600 mb-2">Waiting for Analysis</h3>
                <p className="max-w-xs">Upload an image to trigger the generative eco-analysis engine.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderLive = () => (
    <div className="max-w-[1600px] mx-auto animate-fadeIn pb-12 w-full px-4">
      <div className="glass-panel p-1.5 md:p-3 rounded-[2.5rem] relative shadow-2xl bg-white border border-slate-200">
         
         {/* Main Video Area */}
         <div className="relative bg-slate-900 rounded-[2rem] overflow-hidden shadow-inner aspect-[16/9] md:aspect-[21/9] h-[50vh] md:h-[75vh] w-full flex items-center justify-center group">
            {stream ? (
               <>
                 <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover opacity-90" />
                 
                 {/* Filter Toggle Overlay */}
                 <div className="absolute top-6 right-6 z-20">
                     <button 
                        onClick={() => setShowFilterMenu(!showFilterMenu)}
                        className={`p-3 rounded-full shadow-lg border backdrop-blur-md transition-all ${showFilterMenu ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-white/90 border-emerald-100 text-slate-700 hover:text-emerald-600'}`}
                     >
                        <Filter size={20} />
                     </button>
                     
                     {/* Filter Menu */}
                     {showFilterMenu && (
                        <div className="absolute top-14 right-0 w-64 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/50 p-4 animate-fadeIn origin-top-right">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Visible Weeds</h4>
                                <span className="text-xs bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full font-medium">{detectedWeedTypes.size} found</span>
                            </div>
                            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                {Array.from(detectedWeedTypes).length === 0 && (
                                    <p className="text-sm text-slate-400 italic py-2 text-center">Scanning field...</p>
                                )}
                                {Array.from(detectedWeedTypes).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => {
                                            const next = new Set(disabledWeedTypes);
                                            if (next.has(type)) next.delete(type);
                                            else next.add(type);
                                            setDisabledWeedTypes(next);
                                        }}
                                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                                            !disabledWeedTypes.has(type) 
                                            ? 'bg-gradient-to-r from-emerald-50 to-emerald-50/50 text-emerald-800 border border-emerald-200 shadow-sm' 
                                            : 'bg-slate-50 text-slate-400 border border-slate-100 hover:bg-slate-100'
                                        }`}
                                    >
                                        <span className="truncate mr-2">{type}</span>
                                        {!disabledWeedTypes.has(type) ? <Eye size={16} className="text-emerald-500" /> : <EyeOff size={16} />}
                                    </button>
                                ))}
                            </div>
                        </div>
                     )}
                 </div>
               </>
            ) : (
               <div className="text-center p-8">
                  <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl animate-pulse">
                     <CameraIcon size={48} className="text-slate-500" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-300 mb-2">Live Vision Inactive</h3>
                  <p className="text-slate-500">Select a camera source and start the stream</p>
               </div>
            )}
            
            {/* Real-time HUD Layer */}
            {stream && (
               <div className="absolute inset-0 z-10 pointer-events-none">
                  {/* Status Badge */}
                  <div className="absolute top-6 left-6 bg-black/70 backdrop-blur-md pl-3 pr-5 py-2 rounded-full border border-emerald-500/30 flex items-center gap-3 shadow-lg">
                     <div className={`w-3 h-3 rounded-full ${isLiveInferencing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
                     <div className="flex flex-col">
                        <span className="text-xs text-emerald-400 font-bold tracking-widest">
                            {isLiveInferencing ? 'PROCESSING...' : 'LIVE INFERENCE'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono tracking-tight">PD-YOLO / LincolnBeet / Gemini</span>
                     </div>
                  </div>

                  {/* Dynamic Bounding Boxes - FILTERED */}
                  {liveDetections
                    .filter(box => !disabledWeedTypes.has(box.label))
                    .map(box => {
                     const color = getWeedColor(box.label);
                     return (
                     <div 
                        key={box.id}
                        className={`absolute border-2 ${color.border} shadow-[0_0_15px_rgba(0,0,0,0.2)] rounded-sm transition-all duration-300 ease-out`}
                        style={{
                           left: `${box.x}%`,
                           top: `${box.y}%`,
                           width: `${box.w}%`,
                           height: `${box.h}%`,
                        }}
                     >
                        <div className={`absolute -top-8 left-0 ${color.bg} text-white text-xs font-bold px-2 py-1 rounded-sm shadow-sm flex items-center gap-2`}>
                           {box.label}
                           <span className="bg-white/20 px-1 rounded text-[10px]">{Math.round(box.conf * 100)}%</span>
                        </div>
                        {/* Corner Accents */}
                        <div className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 border-white"></div>
                        <div className="absolute -top-1 -right-1 w-2 h-2 border-t-2 border-r-2 border-white"></div>
                        <div className="absolute -bottom-1 -left-1 w-2 h-2 border-b-2 border-l-2 border-white"></div>
                        <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-white"></div>
                     </div>
                  )})}

                  {/* Grid Overlay for "Tech" Feel */}
                  <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.03)_1px,transparent_1px)] bg-[size:100px_100px] pointer-events-none" />
               </div>
            )}
         </div>

         {/* Controls Bar */}
         <div className="absolute bottom-6 left-6 right-6 bg-white/90 backdrop-blur-xl p-4 rounded-2xl flex flex-wrap gap-4 items-center justify-between border border-white/50 shadow-xl">
             <div className="flex items-center gap-4 flex-1 min-w-[300px]">
                {/* Visual Icon for Device Type */}
                <div className="hidden md:flex items-center justify-center w-10 h-10 bg-slate-100 rounded-full border border-slate-200 text-slate-500">
                    {selectedDeviceId 
                        ? getDeviceIcon(videoDevices.find(d => d.deviceId === selectedDeviceId)?.label || '') 
                        : <CameraIcon size={18} />
                    }
                </div>

                <div className="relative flex-1 max-w-sm">
                   <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                   <select 
                      value={selectedDeviceId} 
                      onChange={(e) => handleDeviceChange(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-xl pl-4 pr-10 py-3 appearance-none focus:ring-2 focus:ring-emerald-500 focus:outline-none font-medium truncate"
                   >
                      {videoDevices.map((device, idx) => (
                         <option key={device.deviceId || idx} value={device.deviceId}>
                            {device.label || `Camera Source ${idx + 1}`}
                         </option>
                      ))}
                      {videoDevices.length === 0 && <option>Searching for cameras...</option>}
                   </select>
                </div>
                
                <button 
                    onClick={getDevices}
                    title="Refresh Device List"
                    className="p-3 rounded-xl bg-slate-50 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 border border-slate-200 transition-colors"
                >
                    <RefreshCw size={18} />
                </button>
             </div>

             <button 
                onClick={toggleCamera}
                className={`px-8 py-3 rounded-xl font-bold transition-all shadow-lg flex items-center gap-2 ${
                  stream 
                  ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200' 
                  : 'bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-emerald-500/40'
                }`}
             >
                {stream ? (
                   <>Stop Analysis</>
                ) : (
                   <>Start Live Stream</>
                )}
             </button>
         </div>
      </div>
    </div>
  );

  const renderInsights = () => (
    <div className="max-w-6xl mx-auto animate-fadeIn pb-24">
       <div className="glass-panel p-8 md:p-12 rounded-[2.5rem] mb-8 bg-white shadow-xl relative overflow-hidden">
          {/* Background Decor */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-bl-full -z-10" />
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
             <div className="space-y-6">
               <h2 className="text-4xl font-bold text-slate-800 flex items-center gap-3">
                  <Sprout className="text-emerald-600" size={40} /> Eco-Impact 
               </h2>
               <p className="text-slate-500 text-lg leading-relaxed">
                  Our system goes beyond detection. By leveraging PD-YOLO's high precision for small targets, we calculate the environmental savings of spot-spraying versus blanket application.
               </p>
               
               <div className="grid grid-cols-2 gap-4 mt-8">
                  <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
                     <div className="text-emerald-600 font-bold text-lg mb-1">Yield Gain</div>
                     <div className="text-3xl font-black text-slate-800">+18%</div>
                     <div className="text-xs text-emerald-700/60 mt-2">Early intervention</div>
                  </div>
                  <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                     <div className="text-blue-600 font-bold text-lg mb-1">Chem Reduction</div>
                     <div className="text-3xl font-black text-slate-800">-34%</div>
                     <div className="text-xs text-blue-700/60 mt-2">Targeted dosage</div>
                  </div>
               </div>
             </div>

             <div className="h-[400px] bg-white rounded-3xl p-4 shadow-inner border border-slate-100">
                <ResponsiveContainer width="100%" height="100%">
                   <RadarChart cx="50%" cy="50%" outerRadius="70%" data={[
                      { subject: 'Precision', A: 94.3, fullMark: 100 },
                      { subject: 'Recall', A: 87.0, fullMark: 100 },
                      { subject: 'Speed (FPS)', A: 80, fullMark: 100 }, // Normalized roughly
                      { subject: 'Eco-Save', A: 85, fullMark: 100 },
                      { subject: 'Small Obj', A: 92, fullMark: 100 },
                   ]}>
                      <PolarGrid stroke="#e2e8f0" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 13, fontWeight: 600 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar name="PD-YOLO" dataKey="A" stroke="#059669" strokeWidth={3} fill="#10b981" fillOpacity={0.2} />
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}/>
                   </RadarChart>
                </ResponsiveContainer>
             </div>
          </div>
       </div>
    </div>
  );

  return (
    <div className="min-h-screen relative font-sans">
      {/* Background Gradients */}
      <div className="fixed inset-0 -z-10 bg-slate-50">
         <div className="absolute top-[-10%] right-[-5%] w-[50%] h-[50%] bg-emerald-100/40 rounded-full blur-[120px]" />
         <div className="absolute bottom-[0%] left-[-10%] w-[50%] h-[50%] bg-blue-100/40 rounded-full blur-[120px]" />
      </div>

      <div className="container mx-auto px-4 pt-6 md:pt-10">
        <main>
          {currentView === AppView.DASHBOARD && renderDashboard()}
          {currentView === AppView.UPLOAD && renderUpload()}
          {currentView === AppView.LIVE && renderLive()}
          {currentView === AppView.INSIGHTS && renderInsights()}
        </main>
      </div>

      <Navbar currentView={currentView} setView={setCurrentView} />
    </div>
  );
};

export default App;