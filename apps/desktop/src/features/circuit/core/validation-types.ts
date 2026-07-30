export type StructuralCertificateReport = {
  signedInteractionGraph: Array<[string, string, -1 | 0 | 1]>;
  billOfParts: Array<[string, string]>;
  fullyGrounded: boolean;
  monotone: boolean;
  positiveLoop: boolean;
  negativeLoop: boolean;
  certifies: {
    sensor: boolean;
    switch: boolean;
    oscillator: boolean;
  };
};

export type StructuralValidationResult = {
  evidence: "kernel-checked";
  engine: string;
  source: string;
  elapsedMs: number | null;
  report: StructuralCertificateReport;
};

export type ValidationState = "idle" | "running" | "complete" | "error";

export function parseCertificateReport(
  value: unknown,
): StructuralCertificateReport {
  if (!isRecord(value) || !isRecord(value.certifies)) {
    throw new Error("grn-lean returned an unsupported report.");
  }
  return {
    billOfParts: parsePairs(value.billOfParts),
    certifies: {
      oscillator: value.certifies.oscillator === true,
      sensor: value.certifies.sensor === true,
      switch: value.certifies.switch === true,
    },
    fullyGrounded: value.fullyGrounded === true,
    monotone: value.monotone === true,
    negativeLoop: value.negativeLoop === true,
    positiveLoop: value.positiveLoop === true,
    signedInteractionGraph: parseSignedGraph(value.signedInteractionGraph),
  };
}

function parsePairs(value: unknown): Array<[string, string]> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) =>
    Array.isArray(entry) &&
    typeof entry[0] === "string" &&
    typeof entry[1] === "string"
      ? [[entry[0], entry[1]] as [string, string]]
      : [],
  );
}

function parseSignedGraph(value: unknown): Array<[string, string, -1 | 0 | 1]> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (
      !Array.isArray(entry) ||
      typeof entry[0] !== "string" ||
      typeof entry[1] !== "string" ||
      (entry[2] !== -1 && entry[2] !== 0 && entry[2] !== 1)
    ) {
      return [];
    }
    return [[entry[0], entry[1], entry[2]] as [string, string, -1 | 0 | 1]];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
