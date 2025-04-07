export type AnalysisResult = {
  errors: PolicyError[];
  handled_errors: PolicyError[];
}

export type PolicyError = {
  args: any[];
  ranges: string[];
  error?: string;
}