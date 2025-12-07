import { PaperComparisonData } from './types';

// Data derived from Table 2 of the PDF (CottonWeedDet12 dataset)
export const PAPER_DATA_COTTON: PaperComparisonData[] = [
  { model: 'Faster-RCNN', precision: 67.1, recall: 78.6, mAP05: 67.1, fps: 7.05 },
  { model: 'SSD', precision: 71.9, recall: 68.8, mAP05: 71.9, fps: 49.9 },
  { model: 'Yolov7-tiny', precision: 92.5, recall: 88.6, mAP05: 94.0, fps: 102.3 },
  { model: 'Yolov8n', precision: 93.8, recall: 87.6, mAP05: 93.3, fps: 109.7 },
  { model: 'RT-DETR', precision: 90.1, recall: 90.3, mAP05: 92.5, fps: 31.8 },
  { model: 'PD-YOLO (Ours)', precision: 94.3, recall: 87.0, mAP05: 95.0, fps: 42.5 },
];

export const LINCOLN_BEET_STATS = {
  description: "Lincoln Beet dataset contains 4405 images with small targets and occlusion.",
  totalBoxes: 39246,
  resolution: "1902x1080",
  challenges: ["Occlusion", "Small Targets", "Illumination Variations"]
};
