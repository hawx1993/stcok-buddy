import { reviewComplianceStructured } from './compliance-critic.js';

export function reviewCompliance(text: string): string {
  return reviewComplianceStructured({ text, evidence: [], findings: [] }).revisedText;
}
