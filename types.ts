export enum AppView {
  DASHBOARD = 'DASHBOARD',
  UPLOAD = 'UPLOAD',
  LIVE = 'LIVE',
  INSIGHTS = 'INSIGHTS'
}

export interface PaperComparisonData {
  model: string;
  precision: number;
  recall: number;
  mAP05: number;
  fps: number;
}

export interface DetectionResult {
  weedType: string;
  confidence: number;
  bbox?: number[]; // [ymin, xmin, ymax, xmax] normalized coordinates (0-1)
  description: string;
}

export interface EcoAnalysis {
  cropContext: 'Cotton' | 'Beet' | 'Unknown';
  weedDensity: 'Low' | 'Medium' | 'High';
  remediationAdvice: string;
  estimatedYieldLoss: number; // percentage
  herbicideDosage: number; // ml per sq meter (simulated precision ag)
  detections: DetectionResult[];
}