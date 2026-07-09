import { invoke } from "@tauri-apps/api/core";

import type {
  Assay,
  Characterization,
  CharacterizationDetail,
  ExperimentManifest,
  ImportStudyReport,
  Measurement,
  Overview,
  Sample,
  SaveCharacterizationInput,
  Schema,
  Signal,
  SqlResult,
  Study,
  StudyDetail,
  Validate,
} from "@/features/flapjack/core/flapjack-types";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function desktopOnlyError() {
  return Promise.reject(
    new Error("The Flapjack tab is only available in the desktop app."),
  );
}

export function loadOverview() {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<Overview>("flapjack_overview");
}

export function loadStudies() {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<Study[]>("flapjack_studies_list");
}

export function loadStudy(id: number) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<StudyDetail>("flapjack_study_get", { id });
}

export function loadAssays(studyId?: number | null) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<Assay[]>("flapjack_assays_list", { studyId: studyId ?? null });
}

export function loadSamples(assayId: number) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<Sample[]>("flapjack_samples_list", { assayId });
}

export function loadSignals() {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<Signal[]>("flapjack_signals_list");
}

export function loadMeasurements(options: {
  studyId?: number | null;
  assayId?: number | null;
  sampleId?: number | null;
  signalId?: number | null;
  limit?: number | null;
}) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<Measurement[]>("flapjack_measurements_query", {
    studyId: options.studyId ?? null,
    assayId: options.assayId ?? null,
    sampleId: options.sampleId ?? null,
    signalId: options.signalId ?? null,
    limit: options.limit ?? null,
  });
}

export function loadCharacterizations(analysisType?: string | null) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<Characterization[]>("flapjack_characterizations_list", {
    analysisType: analysisType ?? null,
  });
}

export function loadCharacterization(id: number) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<CharacterizationDetail>("flapjack_characterization_get", {
    id,
  });
}

export function executeSql(query: string) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<SqlResult>("flapjack_sql_execute", { query });
}

export function validateSql(query: string) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<Validate>("flapjack_sql_validate", { query });
}

export function loadSqlSchema() {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<Schema>("flapjack_schema_sql");
}

export function loadDbPath() {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<string>("flapjack_db_path");
}

export function importStudy(manifest: ExperimentManifest) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<ImportStudyReport>("flapjack_import_study", { manifest });
}

export function saveCharacterization(run: SaveCharacterizationInput) {
  if (!isTauriRuntime()) {
    return desktopOnlyError();
  }
  return invoke<Characterization>("flapjack_save_characterization", { run });
}
