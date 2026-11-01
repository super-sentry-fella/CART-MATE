import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Cpu,
  Play,
  Square,
  Camera,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Info,
  Trash2,
  ChevronRight,
  Eye,
  Check,
  RefreshCw,
  Compass,
  Zap,
  Layers,
  ArrowRight,
  Sliders,
  Award
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Product, VisionSample } from '../types';
import { extractFeatures, classifyFeatures, calculateROI } from '../services/vision';
import { api } from '../services/api';
import { soundEffects } from '../services/audio';

interface VisionTrainingViewProps {
  products: Product[];
  visionSamples: VisionSample[];
  matchDistanceThreshold: number;
  onRefreshDb: () => void;
}

type TrainingStep = 'idle' | 'front' | 'rotated' | 'tilted' | 'finished';

export const VisionTrainingView: React.FC<VisionTrainingViewProps> = ({
  products,
  visionSamples,
  matchDistanceThreshold,
  onRefreshDb
}) => {
  const [activeLabel, setActiveLabel] = useState<string>('_empty');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Target Frame Capacity: 40, 150, 300, or 500 frames!
  const [targetCapacity, setTargetCapacity] = useState<number>(300);

  // Guided Smart Auto-Trainer State
  const [wizardStep, setWizardStep] = useState<TrainingStep>('idle');
  const [stepProgress, setStepProgress] = useState(0);
  const [stepTargetFrames, setStepTargetFrames] = useState(100);
  const [stepInstruction, setStepInstruction] = useState('');
  const [capturedThumbnails, setCapturedThumbnails] = useState<string[]>([]);

  // Manual Continuous Burst State
  const [isBurstActive, setIsBurstActive] = useState(false);
  const [burstCount, setBurstCount] = useState(0);

  // Live Test Mode State
  const [isTestMode, setIsTestMode] = useState(false);
  const [liveTestPrediction, setLiveTestPrediction] = useState<{
    label: string;
    confidence: number;
    distance: number;
  } | null>(null);

  // Accuracy Evaluation State
  const [accuracyResults, setAccuracyResults] = useState<{
    perLabel: Record<string, { correct: number; total: number }>;
    overallPercent: number;
    testedCount: number;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const burstTimer = useRef<any>(null);
  const wizardTimer = useRef<any>(null);

  // Compute stats per label
  const sampleStats: Record<string, { count: number; sessions: Set<number> }> = {};
  for (const s of visionSamples) {
    if (!sampleStats[s.label]) {
      sampleStats[s.label] = { count: 0, sessions: new Set() };
    }
    sampleStats[s.label].count++;
    sampleStats[s.label].sessions.add(s.session);
  }

  // Camera stream setup
  useEffect(() => {
    let stream: MediaStream | null = null;
    const initCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        console.warn('Camera initialization error in training view:', err);
      }
    };

    initCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (wizardTimer.current) clearInterval(wizardTimer.current);
      if (burstTimer.current) clearInterval(burstTimer.current);
    };
  }, []);

  // Update selected product when active label changes
  useEffect(() => {
    const matched = products.find((p) => p.visionLabel === activeLabel);
    setSelectedProduct(matched || null);
  }, [activeLabel, products]);

  // Live Test detection loop on requestAnimationFrame
  useEffect(() => {
    if (!isTestMode) {
      setLiveTestPrediction(null);
      return;
    }

    let isRunning = true;
    const testLoop = () => {
      if (!isRunning) return;
      if (videoRef.current && videoRef.current.videoWidth > 0 && visionSamples.length >= 3) {
        const features = extractFeatures(videoRef.current);
        const classification = classifyFeatures(features, visionSamples, matchDistanceThreshold);
        if (classification) {
          setLiveTestPrediction(classification);
        }
      }
      requestAnimationFrame(testLoop);
    };

    requestAnimationFrame(testLoop);
    return () => {
      isRunning = false;
    };
  }, [isTestMode, visionSamples, matchDistanceThreshold]);

  // Capture thumbnail preview from ROI
  const captureThumbnail = (): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const [rx, ry, rs] = calculateROI(video.videoWidth, video.videoHeight);

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, rx, ry, rs, rs, 0, 0, 64, 64);
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  // 1-Click Guided Smart Auto-Trainer for 300 to 500 frames across 3 sessions
  const startGuidedTrainer = async (targetLabel: string) => {
    setActiveLabel(targetLabel);
    setIsTestMode(false);
    setCapturedThumbnails([]);

    const labelName =
      targetLabel === '_empty'
        ? 'Empty Scan Zone'
        : targetLabel === '_other'
        ? 'Other Objects'
        : selectedProduct?.name || targetLabel;

    // Distribute total target capacity across 3 sessions
    const perAngle = Math.round(targetCapacity / 3);
    setStepTargetFrames(perAngle);

    // Step 1: Front Angle
    setWizardStep('front');
    setStepInstruction(`Step 1 of 3: Hold ${labelName} steady facing camera (${perAngle} frames)`);
    soundEffects.beep();
    await runAngleCapture(targetLabel, 1, 'front', perAngle);

    // Step 2: Rotated Angle
    setWizardStep('rotated');
    setStepInstruction(`Step 2 of 3: Rotate item 90° or show the other side (${perAngle} frames)`);
    soundEffects.beep();
    await new Promise((r) => setTimeout(r, 1200));
    await runAngleCapture(targetLabel, 2, 'rotated', perAngle);

    // Step 3: Tilted / Top Angle
    const remaining = targetCapacity - perAngle * 2;
    setStepTargetFrames(remaining);
    setWizardStep('tilted');
    setStepInstruction(`Step 3 of 3: Tilt item up or shift lighting (${remaining} frames)`);
    soundEffects.beep();
    await new Promise((r) => setTimeout(r, 1200));
    await runAngleCapture(targetLabel, 3, 'tilted', remaining);

    // Finished
    setWizardStep('finished');
    setStepInstruction(`Training complete! ${targetCapacity} frames captured across 3 angle sessions.`);
    soundEffects.complete();

    confetti({
      particleCount: 80,
      spread: 65,
      origin: { y: 0.6 }
    });

    onRefreshDb();
    setTimeout(() => {
      setWizardStep('idle');
      setStepProgress(0);
      setIsTestMode(true);
    }, 2800);
  };

  // Helper for capturing an angle batch at high throughput
  const runAngleCapture = (
    label: string,
    sessionOffset: number,
    stepName: TrainingStep,
    targetFrames: number
  ): Promise<void> => {
    return new Promise((resolve) => {
      const session = Math.floor(Date.now() / 600000) + sessionOffset * 10;
      const buffer: Partial<VisionSample>[] = [];
      let count = 0;

      wizardTimer.current = setInterval(async () => {
        if (!videoRef.current) return;

        const features = extractFeatures(videoRef.current);
        buffer.push({
          label: label.trim().toLowerCase(),
          session,
          features
        });

        count++;
        setStepProgress(count);

        if (count % 3 === 0) {
          soundEffects.shutter();
        }

        // Capture a visual thumbnail periodically
        if (count % 15 === 0) {
          const thumb = captureThumbnail();
          if (thumb) {
            setCapturedThumbnails((prev) => [thumb, ...prev.slice(0, 7)]);
          }
        }

        // Batch upload every 15 frames for fast network transfer
        if (buffer.length >= 15 || count >= targetFrames) {
          const batch = [...buffer];
          buffer.length = 0;
          await api.saveVisionSamples(batch);
        }

        if (count >= targetFrames) {
          clearInterval(wizardTimer.current);
          wizardTimer.current = null;
          onRefreshDb();
          resolve();
        }
      }, 110); // ~9 frames per second
    });
  };

  // Quick 1-Click Empty Baseline Calibrator
  const calibrateEmptyZone = async () => {
    setActiveLabel('_empty');
    setWizardStep('front');
    setStepTargetFrames(60);
    setStepInstruction('Calibrating empty scan zone (60 baseline frames)... keep counter clear');
    setCapturedThumbnails([]);
    soundEffects.beep();

    await runAngleCapture('_empty', 1, 'front', 60);

    setWizardStep('finished');
    setStepInstruction('Empty counter baseline calibrated successfully!');
    soundEffects.complete();
    onRefreshDb();

    setTimeout(() => {
      setWizardStep('idle');
      setStepProgress(0);
    }, 2000);
  };

  // Manual Continuous High-Speed Burst Mode (Captures up to targetCapacity e.g. 500 frames)
  const toggleBurst = () => {
    if (isBurstActive) {
      if (burstTimer.current) {
        clearInterval(burstTimer.current);
        burstTimer.current = null;
      }
      setIsBurstActive(false);
      soundEffects.beep();
      onRefreshDb();
    } else {
      if (!videoRef.current || !activeLabel) return;
      setIsBurstActive(true);
      setBurstCount(0);
      soundEffects.beep();

      const session = Math.floor(Date.now() / 600000);
      const buffer: Partial<VisionSample>[] = [];
      let totalCaptured = 0;

      burstTimer.current = setInterval(async () => {
        if (videoRef.current) {
          const features = extractFeatures(videoRef.current);
          buffer.push({
            label: activeLabel.trim().toLowerCase(),
            session,
            features
          });

          totalCaptured++;
          setBurstCount(totalCaptured);

          if (totalCaptured % 3 === 0) {
            soundEffects.shutter();
          }

          if (totalCaptured % 20 === 0) {
            const thumb = captureThumbnail();
            if (thumb) setCapturedThumbnails((prev) => [thumb, ...prev.slice(0, 7)]);
          }

          if (buffer.length >= 15) {
            const batch = [...buffer];
            buffer.length = 0;
            await api.saveVisionSamples(batch);
            onRefreshDb();
          }

          // Auto-stop when reaching selected targetCapacity (e.g. 300 or 500)
          if (totalCaptured >= targetCapacity) {
            clearInterval(burstTimer.current);
            burstTimer.current = null;
            setIsBurstActive(false);
            soundEffects.complete();
            confetti({ particleCount: 70, spread: 60 });
            onRefreshDb();
          }
        }
      }, 110);
    }
  };

  // Capture Single Frame
  const captureSingleFrame = async () => {
    if (!videoRef.current || !activeLabel) return;
    const features = extractFeatures(videoRef.current);
    const session = Math.floor(Date.now() / 600000);
    await api.saveVisionSamples([
      {
        label: activeLabel.trim().toLowerCase(),
        session,
        features
      }
    ]);
    const thumb = captureThumbnail();
    if (thumb) setCapturedThumbnails((prev) => [thumb, ...prev.slice(0, 7)]);
    soundEffects.shutter();
    onRefreshDb();
  };

  // Run Holdout Cross-Session Accuracy Test
  const testAccuracy = () => {
    if (visionSamples.length < 10) {
      alert('Train at least 2 or 3 items with 20+ samples first to test model accuracy.');
      return;
    }

    const perLabel: Record<string, { correct: number; total: number }> = {};
    let totalTested = 0;
    let totalCorrect = 0;

    const validLabels = Object.keys(sampleStats).filter((l) => sampleStats[l].sessions.size > 1);
    const testSet = visionSamples.filter((s) => validLabels.includes(s.label));

    // Test up to 600 samples across the dataset
    const samplePool = testSet.length > 600 ? testSet.filter(() => Math.random() < 600 / testSet.length) : testSet;

    samplePool.forEach((sample) => {
      const result = classifyFeatures(
        sample.features,
        visionSamples,
        matchDistanceThreshold,
        sample.session
      );

      if (!perLabel[sample.label]) {
        perLabel[sample.label] = { correct: 0, total: 0 };
      }

      perLabel[sample.label].total++;
      totalTested++;

      if (result && result.label === sample.label) {
        perLabel[sample.label].correct++;
        totalCorrect++;
      }
    });

    const overallPercent = totalTested > 0 ? Math.round((totalCorrect / totalTested) * 100) : 0;
    setAccuracyResults({ perLabel, overallPercent, testedCount: totalTested });
    soundEffects.beep();
  };

  // Clear samples for a label
  const clearSamples = async (label: string) => {
    if (confirm(`Reset all camera samples for "${label}"?`)) {
      await api.clearVisionSamples(label);
      soundEffects.beep();
      onRefreshDb();
    }
  };

  // Catalog items to train
  const trainingTargets = [
    { label: '_empty', name: 'Empty Counter Baseline', isBaseline: true },
    { label: '_other', name: 'Random Non-Catalog Items', isBaseline: true },
    ...products.map((p) => ({
      label: p.visionLabel || `item_${p.id}`,
      name: p.name,
      isBaseline: false,
      product: p
    }))
  ];

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 space-y-4">
      {/* Top Banner: 300 - 500 Frames Capacity */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-slate-950 font-bold shadow-md">
            <Zap className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-white">
                Camera Vision Training Studio
              </h2>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Upto 300–500 Frames / Object
              </span>
            </div>
            <p className="text-xs text-slate-400">
              High-density spatial feature extraction allows saving up to 500 frames per object for flawless 360° recognition.
            </p>
          </div>
        </div>

        {/* Target Frame Capacity Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">Target Capacity:</span>
          {[
            { label: '40', val: 40, tip: 'Quick' },
            { label: '150', val: 150, tip: 'Standard' },
            { label: '300', val: 300, tip: 'Deep' },
            { label: '500', val: 500, tip: 'Max Fidelity' }
          ].map((tier) => (
            <button
              key={tier.val}
              onClick={() => {
                setTargetCapacity(tier.val);
                soundEffects.beep();
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                targetCapacity === tier.val
                  ? 'bg-emerald-500 text-slate-950 shadow-md scale-105'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
              title={`${tier.val} frames per object (${tier.tip})`}
            >
              {tier.label}
              <span className="text-[9px] font-sans font-normal opacity-75 ml-1">
                {tier.tip}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main 2-Column Interface: Camera Viewport (Left) & Guided Product Picker (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: Camera & Smart Guided Viewport (6 Cols) */}
        <div className="lg:col-span-6 space-y-3">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            {/* Viewport Header */}
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-850 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-white">
                  {wizardStep !== 'idle'
                    ? 'Deep Guided Training in Progress'
                    : isTestMode
                    ? 'Live Detection Verification'
                    : `Active Target: ${activeLabel}`}
                </span>
              </div>

              <div className="flex items-center gap-1.5 font-mono text-xs">
                <span className="px-2 py-0.5 rounded bg-slate-800 text-emerald-400 font-bold">
                  {sampleStats[activeLabel]?.count || 0} / {targetCapacity} Frames
                </span>
              </div>
            </div>

            {/* Interactive Viewfinder */}
            <div className="relative aspect-4/3 bg-slate-950 flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />

              {/* Target Scan Reticle Overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
                <div
                  className={`w-44 h-44 sm:w-52 sm:h-52 rounded-2xl border-2 relative flex items-center justify-center transition-all ${
                    wizardStep !== 'idle'
                      ? 'border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-500/20'
                      : isTestMode
                      ? 'border-cyan-400 bg-cyan-500/10'
                      : 'border-slate-500/80 border-dashed'
                  }`}
                >
                  {/* Step Progress Ring when Guided Trainer is Running */}
                  {wizardStep !== 'idle' && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full bg-slate-900 border border-emerald-500 text-xs font-mono font-bold text-emerald-400 shadow-xl whitespace-nowrap">
                      {stepProgress} / {stepTargetFrames} Frames
                    </div>
                  )}

                  {/* Corner Targets */}
                  <div className="absolute top-1 left-2 text-[10px] font-mono text-slate-400 font-semibold bg-slate-950/70 px-1 rounded">
                    SCAN ZONE
                  </div>

                  {/* Center Live Detection HUD Pill if in Test Mode */}
                  {isTestMode && liveTestPrediction && (
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-xl bg-slate-950/90 border border-emerald-500/80 text-center shadow-xl">
                      <div className="text-[10px] text-slate-400 font-mono">Recognized:</div>
                      <div className="text-xs font-bold text-emerald-400 font-sans">
                        {liveTestPrediction.label === '?'
                          ? 'Uncertain / Unknown'
                          : liveTestPrediction.label}{' '}
                        ({liveTestPrediction.confidence}%)
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Step Instruction Toast Overlay */}
              {wizardStep !== 'idle' && (
                <div className="absolute bottom-4 left-4 right-4 bg-slate-900/95 backdrop-blur-md border border-emerald-500/60 p-3 rounded-xl shadow-2xl animate-in slide-in-from-bottom-2">
                  <div className="flex items-center justify-between text-xs font-bold text-emerald-300 mb-1.5">
                    <span className="flex items-center gap-1.5 truncate">
                      <Sparkles className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
                      <span className="truncate">{stepInstruction}</span>
                    </span>
                    <span className="font-mono ml-2">
                      {Math.round((stepProgress / stepTargetFrames) * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-emerald-400 h-2 transition-all duration-100"
                      style={{ width: `${Math.min(100, (stepProgress / stepTargetFrames) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Quick Captured Thumbnails Reel */}
            {capturedThumbnails.length > 0 && (
              <div className="px-4 py-2 bg-slate-900 border-t border-slate-800 flex items-center gap-2 overflow-x-auto scrollbar-none">
                <span className="text-[10px] font-mono uppercase text-slate-400 shrink-0">
                  Learned Angles:
                </span>
                {capturedThumbnails.map((thumb, idx) => (
                  <img
                    key={idx}
                    src={thumb}
                    alt="Sample angle"
                    className="w-9 h-9 rounded-lg object-cover border border-slate-700 shrink-0 shadow-sm"
                  />
                ))}
              </div>
            )}

            {/* Viewfinder Action Toolbar */}
            <div className="p-4 bg-slate-850 border-t border-slate-800 space-y-3">
              {/* Primary 1-Click Guided Auto-Trainer for 300 to 500 frames */}
              <button
                type="button"
                onClick={() => startGuidedTrainer(activeLabel)}
                disabled={wizardStep !== 'idle'}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-slate-950" />
                <span>
                  Train {targetCapacity} Frames for "{selectedProduct ? selectedProduct.name : activeLabel}"
                </span>
              </button>

              {/* Secondary Controls: Continuous Burst & 1 Frame */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={toggleBurst}
                  disabled={wizardStep !== 'idle'}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    isBurstActive
                      ? 'bg-rose-500 hover:bg-rose-400 text-white font-bold'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  }`}
                >
                  {isBurstActive ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>
                    {isBurstActive
                      ? `Stop Burst (${burstCount}/${targetCapacity})`
                      : `Continuous High-Speed Burst (up to ${targetCapacity})`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={captureSingleFrame}
                  disabled={wizardStep !== 'idle' || isBurstActive}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>1 Frame</span>
                </button>
              </div>

              {/* Quick Calibration Shortcuts Row */}
              <div className="flex items-center justify-between pt-1 text-xs">
                <button
                  onClick={calibrateEmptyZone}
                  disabled={wizardStep !== 'idle'}
                  className="text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Calibrate Empty Counter (60 frames)</span>
                </button>

                <button
                  onClick={() => setIsTestMode(!isTestMode)}
                  className="text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{isTestMode ? 'Turn Off Test Mode' : 'Verify Detection Live'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Interactive Product Training List & Capacity Meters (6 Cols) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-white">Catalog Objects & Saved Frames</h3>
                <p className="text-xs text-slate-400">
                  Select item and tap <strong>Train</strong>. Each item can store up to <strong>500 frames</strong>.
                </p>
              </div>

              <button
                onClick={testAccuracy}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-teal-500/20 text-teal-300 border border-teal-500/40 hover:bg-teal-500/30 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
                <span>Test Accuracy</span>
              </button>
            </div>

            {/* Accuracy Evaluation Banner */}
            {accuracyResults && (
              <div className="p-3 rounded-xl bg-slate-850 border border-slate-700 text-xs space-y-2 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Overall Model Accuracy:
                  </span>
                  <span className="text-base font-bold font-mono text-emerald-400">
                    {accuracyResults.overallPercent}%
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                  {Object.entries(accuracyResults.perLabel).map(([lbl, stat]) => (
                    <div
                      key={lbl}
                      className="bg-slate-900 px-2 py-1 rounded border border-slate-800 flex justify-between"
                    >
                      <span className="text-slate-300 truncate pr-1">{lbl}:</span>
                      <span className="text-emerald-400 font-bold">
                        {Math.round((stat.correct / stat.total) * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Product Training Cards with 500-Frame Progress Bar */}
            <div className="space-y-2 max-h-[490px] overflow-y-auto pr-1">
              {trainingTargets.map((item) => {
                const stats = sampleStats[item.label] || { count: 0, sessions: new Set() };
                const isSelected = activeLabel === item.label;

                // Capacity percentages relative to 500 max frames
                const percentOf500 = Math.min(100, Math.round((stats.count / 500) * 100));

                // Status Tier
                let tierBadge = (
                  <span className="text-[9px] px-1.5 rounded bg-slate-800 text-slate-400 font-mono">
                    0/500
                  </span>
                );
                if (stats.count >= 450) {
                  tierBadge = (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono font-bold flex items-center gap-0.5 border border-purple-500/30">
                      <Award className="w-2.5 h-2.5" /> Max 500 Frames
                    </span>
                  );
                } else if (stats.count >= 300) {
                  tierBadge = (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold flex items-center gap-0.5 border border-emerald-500/30">
                      <Zap className="w-2.5 h-2.5" /> Deep (300+)
                    </span>
                  );
                } else if (stats.count >= 150) {
                  tierBadge = (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-teal-500/20 text-teal-300 font-mono font-semibold">
                      Precision (150+)
                    </span>
                  );
                } else if (stats.count >= 40) {
                  tierBadge = (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">
                      Standard (40+)
                    </span>
                  );
                } else {
                  tierBadge = (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-mono">
                      Needs Frames
                    </span>
                  );
                }

                return (
                  <div
                    key={item.label}
                    onClick={() => {
                      setActiveLabel(item.label);
                      soundEffects.beep();
                    }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                      isSelected
                        ? 'bg-emerald-950/40 border-emerald-500/70 shadow-md'
                        : 'bg-slate-850 border-slate-800 hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs sm:text-sm font-semibold text-white truncate">
                            {item.name}
                          </span>
                          {item.isBaseline && (
                            <span className="text-[9px] px-1.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">
                              baseline
                            </span>
                          )}
                          {tierBadge}
                        </div>

                        <div className="text-[11px] font-mono text-slate-400 mt-0.5 flex items-center gap-3">
                          <span>Label: <strong className="text-slate-300">{item.label}</strong></span>
                          <span><strong>{stats.count}</strong> / 500 saved</span>
                          <span>{stats.sessions.size} angles</span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startGuidedTrainer(item.label);
                          }}
                          disabled={wizardStep !== 'idle'}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                            isSelected
                              ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                          }`}
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>Train ({targetCapacity})</span>
                        </button>

                        {stats.count > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              clearSamples(item.label);
                            }}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                            title="Reset all frames"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar towards 500 frames */}
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 transition-all duration-200 ${
                          stats.count >= 300
                            ? 'bg-gradient-to-r from-teal-400 to-emerald-400'
                            : stats.count >= 150
                            ? 'bg-teal-400'
                            : stats.count >= 40
                            ? 'bg-amber-400'
                            : 'bg-rose-500'
                        }`}
                        style={{ width: `${percentOf500}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
