//! The Flapjack experiment store for the Flapjack tab: a SQLite database
//! mirroring the `flapjack-data` model (study → assay → sample → measurement
//! plus the registry entities and characterization runs), a read-only SQL
//! console over a second connection, and the typed read/write methods the
//! commands wrap. The embedded Flapjack API server (see `flapjack_server`) opens
//! the same file and also writes it — measurements uploaded through pyFlapjack —
//! so the database is opened in WAL mode, which serializes the two writers.

use std::collections::HashMap;
use std::path::Path;
use std::str::FromStr;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteRow};
use sqlx::{Column, Executor, QueryBuilder, Row, Sqlite, SqliteConnection, SqlitePool, TypeInfo};

use super::dto::{
    AssayDto, CharacterizationDatumDto, CharacterizationDetailDto, CharacterizationDto, CountsDto,
    ImportStudyInput, ImportStudyReportDto, MeasurementDto, OverviewDto, SampleDto,
    SampleSupplementDto, SaveCharacterizationInput, SchemaColumnDto, SchemaDto, SchemaTableDto,
    SignalDto, SignalInput, SqlColumnDto, SqlResultDto, StudyDetailDto, StudyDto,
};

/// The schema, mirroring `flapjack-data`'s SQLite-compatible DDL: lowercase,
/// singular table names; `id INTEGER PRIMARY KEY AUTOINCREMENT`; every other
/// column nullable; no foreign keys. JSON columns are stored as TEXT. The
/// `owner` columns exist for parity with the multi-tenant model and stay NULL
/// on a single-tenant desktop.
const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS study (
  name        TEXT,
  description TEXT,
  public      BOOLEAN,
  owner       TEXT,
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS assay (
  study_id    INTEGER,
  name        TEXT,
  machine     TEXT,
  description TEXT,
  temperature FLOAT,
  owner       TEXT,
  id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS media (
  name TEXT, description TEXT, owner TEXT,
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS strain (
  name TEXT, description TEXT, owner TEXT,
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS chemical (
  name TEXT, description TEXT, pubchemid INTEGER, owner TEXT,
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS supplement (
  name TEXT, chemical_id INTEGER, concentration FLOAT, owner TEXT,
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS dna (
  name TEXT, owner TEXT,
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS vector (
  name TEXT, dna_ids TEXT, owner TEXT,
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS signal (
  name TEXT, description TEXT, color TEXT, kind TEXT, owner TEXT,
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS sample (
  assay_id       INTEGER,
  row            INTEGER,
  col            INTEGER,
  media_id       INTEGER,
  strain_id      INTEGER,
  vector_id      INTEGER,
  supplement_ids TEXT,
  owner          TEXT,
  id             INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS measurement (
  sample_id INTEGER,
  signal_id INTEGER,
  value     FLOAT,
  time      FLOAT,
  owner     TEXT,
  id        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);
CREATE INDEX IF NOT EXISTS ix_measurement_sample ON measurement (sample_id);
CREATE INDEX IF NOT EXISTS ix_measurement_signal ON measurement (signal_id);
CREATE INDEX IF NOT EXISTS ix_measurement_owner  ON measurement (owner);
CREATE INDEX IF NOT EXISTS ix_measurement_sample_signal_time
  ON measurement (sample_id, signal_id, time);

CREATE TABLE IF NOT EXISTS characterization (
  analysis_type TEXT,
  spec          TEXT,
  params_hash   TEXT,
  name          TEXT,
  owner         TEXT,
  id            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);
CREATE INDEX IF NOT EXISTS ix_characterization_params_hash ON characterization (params_hash);
CREATE INDEX IF NOT EXISTS ix_characterization_owner       ON characterization (owner);

CREATE TABLE IF NOT EXISTS characterizationdatum (
  characterization_id INTEGER,
  sample_id           INTEGER,
  signal_id           INTEGER,
  metric              TEXT,
  value               FLOAT,
  time                FLOAT,
  concentration       FLOAT,
  concentration2      FLOAT,
  owner               TEXT,
  id                  INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT
);
CREATE INDEX IF NOT EXISTS ix_characterizationdatum_characterization
  ON characterizationdatum (characterization_id);
"#;

const OVERVIEW_RECENT_LIMIT: i64 = 5;
const MEASUREMENTS_DEFAULT_LIMIT: i64 = 5_000;
const MEASUREMENTS_MAX_LIMIT: i64 = 200_000;
const SQL_MAX_ROWS: usize = 10_000;
const SQL_TIMEOUT: Duration = Duration::from_secs(30);

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The Flapjack store, held as Tauri managed state. Cheap to clone-share via
/// the pooled connections.
pub struct FlapjackStore {
    /// Read/write pool: the only writer of the database.
    pub pool: SqlitePool,
    /// A second pool opened read-only; the SQL workbench binds to it so ad-hoc
    /// SQL can never mutate the store, regardless of the statement.
    pub ro_pool: SqlitePool,
    /// The database file path, handed to the embedded Flapjack API server (which
    /// opens the same file) so it never has to reconstruct the app-data dir.
    pub db_path: String,
}

impl FlapjackStore {
    /// Open (creating and migrating if needed) the Flapjack database at
    /// `db_path`, in WAL mode so the analysis process can read concurrently.
    pub async fn open(db_path: &Path) -> Result<Self, String> {
        let url = format!("sqlite://{}", db_path.display());

        let rw_options = SqliteConnectOptions::from_str(&url)
            .map_err(err)?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePool::connect_with(rw_options).await.map_err(err)?;
        sqlx::raw_sql(SCHEMA_SQL)
            .execute(&pool)
            .await
            .map_err(err)?;

        let ro_options = SqliteConnectOptions::from_str(&url)
            .map_err(err)?
            .read_only(true);
        let ro_pool = SqlitePool::connect_with(ro_options).await.map_err(err)?;

        Ok(Self {
            pool,
            ro_pool,
            db_path: db_path.display().to_string(),
        })
    }

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    pub async fn counts(&self) -> Result<CountsDto, String> {
        sqlx::query_as::<_, CountsDto>(
            "SELECT \
               (SELECT count(*) FROM study) AS studies, \
               (SELECT count(*) FROM assay) AS assays, \
               (SELECT count(*) FROM sample) AS samples, \
               (SELECT count(*) FROM signal) AS signals, \
               (SELECT count(*) FROM measurement) AS measurements, \
               (SELECT count(*) FROM characterization) AS characterizations",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(err)
    }

    pub async fn overview(&self) -> Result<OverviewDto, String> {
        let counts = self.counts().await?;
        let recent_studies = self.studies(Some(OVERVIEW_RECENT_LIMIT)).await?;
        Ok(OverviewDto {
            counts,
            recent_studies,
        })
    }

    pub async fn studies(&self, limit: Option<i64>) -> Result<Vec<StudyDto>, String> {
        let mut qb = QueryBuilder::<Sqlite>::new(
            "SELECT id, COALESCE(name,'') AS name, COALESCE(description,'') AS description, \
             COALESCE(public,0) AS public FROM study ORDER BY id DESC",
        );
        if let Some(limit) = limit {
            qb.push(" LIMIT ").push_bind(limit);
        }
        qb.build_query_as::<StudyDto>()
            .fetch_all(&self.pool)
            .await
            .map_err(err)
    }

    pub async fn study_detail(&self, id: i64) -> Result<StudyDetailDto, String> {
        let study = sqlx::query_as::<_, StudyDto>(
            "SELECT id, COALESCE(name,'') AS name, COALESCE(description,'') AS description, \
             COALESCE(public,0) AS public FROM study WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(err)?
        .ok_or_else(|| format!("study {id} not found"))?;
        let assays = self.assays(Some(id)).await?;
        Ok(StudyDetailDto { study, assays })
    }

    pub async fn assays(&self, study_id: Option<i64>) -> Result<Vec<AssayDto>, String> {
        let mut qb = QueryBuilder::<Sqlite>::new(
            "SELECT a.id AS id, COALESCE(a.study_id,0) AS study_id, COALESCE(a.name,'') AS name, \
             COALESCE(a.machine,'') AS machine, COALESCE(a.description,'') AS description, \
             COALESCE(a.temperature,0) AS temperature, \
             (SELECT count(*) FROM sample s WHERE s.assay_id = a.id) AS sample_count \
             FROM assay a",
        );
        if let Some(study_id) = study_id {
            qb.push(" WHERE a.study_id = ").push_bind(study_id);
        }
        qb.push(" ORDER BY a.id");
        qb.build_query_as::<AssayDto>()
            .fetch_all(&self.pool)
            .await
            .map_err(err)
    }

    pub async fn signals(&self) -> Result<Vec<SignalDto>, String> {
        sqlx::query_as::<_, SignalDto>(
            "SELECT id, COALESCE(name,'') AS name, COALESCE(description,'') AS description, \
             COALESCE(color,'') AS color, kind FROM signal ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(err)
    }

    pub async fn samples(&self, assay_id: i64) -> Result<Vec<SampleDto>, String> {
        let rows = sqlx::query_as::<_, SampleRow>(
            "SELECT s.id AS id, COALESCE(s.assay_id,0) AS assay_id, COALESCE(s.row,0) AS row, \
             COALESCE(s.col,0) AS col, med.name AS media, str.name AS strain, vec.name AS vector, \
             s.supplement_ids AS supplement_ids \
             FROM sample s \
             LEFT JOIN media med ON med.id = s.media_id \
             LEFT JOIN strain str ON str.id = s.strain_id \
             LEFT JOIN vector vec ON vec.id = s.vector_id \
             WHERE s.assay_id = ? ORDER BY s.row, s.col",
        )
        .bind(assay_id)
        .fetch_all(&self.pool)
        .await
        .map_err(err)?;

        let supplements = self.supplement_lookup().await?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let supplement_ids: Vec<i64> = r
                    .supplement_ids
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                let supplements = supplement_ids
                    .into_iter()
                    .filter_map(|sid| supplements.get(&sid).cloned())
                    .map(|(chemical, concentration)| SampleSupplementDto {
                        chemical,
                        concentration,
                    })
                    .collect();
                SampleDto {
                    id: r.id,
                    assay_id: r.assay_id,
                    row: r.row,
                    col: r.col,
                    media: r.media,
                    strain: r.strain,
                    vector: r.vector,
                    supplements,
                }
            })
            .collect())
    }

    /// Preload every supplement joined to its chemical, keyed by supplement id.
    async fn supplement_lookup(&self) -> Result<HashMap<i64, (String, f64)>, String> {
        let rows = sqlx::query(
            "SELECT sup.id AS id, COALESCE(c.name,'') AS chemical, \
             COALESCE(sup.concentration,0) AS concentration \
             FROM supplement sup LEFT JOIN chemical c ON c.id = sup.chemical_id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(err)?;
        let mut map = HashMap::with_capacity(rows.len());
        for row in rows {
            let id: i64 = row.try_get("id").map_err(err)?;
            let chemical: String = row.try_get("chemical").map_err(err)?;
            let concentration: f64 = row.try_get("concentration").map_err(err)?;
            map.insert(id, (chemical, concentration));
        }
        Ok(map)
    }

    pub async fn measurements(
        &self,
        study_id: Option<i64>,
        assay_id: Option<i64>,
        sample_id: Option<i64>,
        signal_id: Option<i64>,
        limit: Option<i64>,
    ) -> Result<Vec<MeasurementDto>, String> {
        let limit = limit
            .unwrap_or(MEASUREMENTS_DEFAULT_LIMIT)
            .clamp(1, MEASUREMENTS_MAX_LIMIT);
        let mut qb = QueryBuilder::<Sqlite>::new(
            "SELECT m.id AS id, COALESCE(m.sample_id,0) AS sample_id, \
             COALESCE(m.signal_id,0) AS signal_id, COALESCE(sig.name,'') AS signal, \
             COALESCE(m.value,0) AS value, COALESCE(m.time,0) AS time \
             FROM measurement m \
             JOIN signal sig ON sig.id = m.signal_id \
             JOIN sample s ON s.id = m.sample_id \
             JOIN assay a ON a.id = s.assay_id WHERE 1 = 1",
        );
        if let Some(v) = study_id {
            qb.push(" AND a.study_id = ").push_bind(v);
        }
        if let Some(v) = assay_id {
            qb.push(" AND s.assay_id = ").push_bind(v);
        }
        if let Some(v) = sample_id {
            qb.push(" AND m.sample_id = ").push_bind(v);
        }
        if let Some(v) = signal_id {
            qb.push(" AND m.signal_id = ").push_bind(v);
        }
        qb.push(" ORDER BY m.sample_id, m.signal_id, m.time LIMIT ")
            .push_bind(limit);
        qb.build_query_as::<MeasurementDto>()
            .fetch_all(&self.pool)
            .await
            .map_err(err)
    }

    pub async fn characterizations(
        &self,
        analysis_type: Option<String>,
    ) -> Result<Vec<CharacterizationDto>, String> {
        let mut qb = QueryBuilder::<Sqlite>::new(
            "SELECT id, COALESCE(analysis_type,'') AS analysis_type, COALESCE(name,'') AS name, \
             COALESCE(params_hash,'') AS params_hash, COALESCE(spec,'{}') AS spec \
             FROM characterization",
        );
        if let Some(analysis_type) = analysis_type {
            qb.push(" WHERE analysis_type = ").push_bind(analysis_type);
        }
        qb.push(" ORDER BY id DESC");
        let rows = qb.build().fetch_all(&self.pool).await.map_err(err)?;
        rows.into_iter().map(characterization_from_row).collect()
    }

    pub async fn characterization_detail(
        &self,
        id: i64,
    ) -> Result<CharacterizationDetailDto, String> {
        let row = sqlx::query(
            "SELECT id, COALESCE(analysis_type,'') AS analysis_type, COALESCE(name,'') AS name, \
             COALESCE(params_hash,'') AS params_hash, COALESCE(spec,'{}') AS spec \
             FROM characterization WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(err)?
        .ok_or_else(|| format!("characterization {id} not found"))?;
        let characterization = characterization_from_row(row)?;
        let data = sqlx::query_as::<_, CharacterizationDatumDto>(
            "SELECT id, COALESCE(characterization_id,0) AS characterization_id, \
             COALESCE(sample_id,0) AS sample_id, COALESCE(signal_id,0) AS signal_id, \
             COALESCE(metric,'') AS metric, COALESCE(value,0) AS value, time, \
             concentration, concentration2 \
             FROM characterizationdatum WHERE characterization_id = ? ORDER BY id",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await
        .map_err(err)?;
        Ok(CharacterizationDetailDto {
            characterization,
            data,
        })
    }

    // -----------------------------------------------------------------------
    // Writes
    // -----------------------------------------------------------------------

    /// Import a whole experiment in one transaction. Registry entities
    /// (media/strain/vector/chemical/signal) are deduplicated by name; samples
    /// and measurements are inserted fresh under a new study and assay.
    pub async fn import_study(
        &self,
        input: ImportStudyInput,
    ) -> Result<ImportStudyReportDto, String> {
        let mut tx = self.pool.begin().await.map_err(err)?;

        let study_id = sqlx::query(
            "INSERT INTO study (name, description, public, owner) VALUES (?, ?, 0, NULL)",
        )
        .bind(&input.study.name)
        .bind(&input.study.description)
        .execute(&mut *tx)
        .await
        .map_err(err)?
        .last_insert_rowid();

        let assay_id = sqlx::query(
            "INSERT INTO assay (study_id, name, machine, description, temperature, owner) \
             VALUES (?, ?, ?, ?, ?, NULL)",
        )
        .bind(study_id)
        .bind(&input.assay.name)
        .bind(&input.assay.machine)
        .bind(&input.assay.description)
        .bind(input.assay.temperature)
        .execute(&mut *tx)
        .await
        .map_err(err)?
        .last_insert_rowid();

        let mut signal_ids: HashMap<String, i64> = HashMap::new();
        for signal in &input.signals {
            let id = upsert_signal(&mut tx, signal).await?;
            signal_ids.insert(signal.name.clone(), id);
        }

        let mut sample_ids: Vec<i64> = Vec::with_capacity(input.samples.len());
        for sample in &input.samples {
            let media_id = match &sample.media {
                Some(name) => Some(
                    upsert_by_name(
                        &mut tx,
                        "media",
                        "INSERT INTO media (name, description, owner) VALUES (?, '', NULL)",
                        name,
                    )
                    .await?,
                ),
                None => None,
            };
            let strain_id = match &sample.strain {
                Some(name) => Some(
                    upsert_by_name(
                        &mut tx,
                        "strain",
                        "INSERT INTO strain (name, description, owner) VALUES (?, '', NULL)",
                        name,
                    )
                    .await?,
                ),
                None => None,
            };
            let vector_id = match &sample.vector {
                Some(name) => Some(
                    upsert_by_name(
                        &mut tx,
                        "vector",
                        "INSERT INTO vector (name, dna_ids, owner) VALUES (?, '[]', NULL)",
                        name,
                    )
                    .await?,
                ),
                None => None,
            };

            let mut supplement_ids: Vec<i64> = Vec::with_capacity(sample.supplements.len());
            for supplement in &sample.supplements {
                let chemical_id = upsert_by_name(
                    &mut tx,
                    "chemical",
                    "INSERT INTO chemical (name, description, owner) VALUES (?, '', NULL)",
                    &supplement.chemical,
                )
                .await?;
                let supplement_id = upsert_supplement(
                    &mut tx,
                    &supplement.chemical,
                    chemical_id,
                    supplement.concentration,
                )
                .await?;
                supplement_ids.push(supplement_id);
            }
            let supplement_ids_json = serde_json::to_string(&supplement_ids).map_err(err)?;

            let sample_id = sqlx::query(
                "INSERT INTO sample \
                 (assay_id, row, col, media_id, strain_id, vector_id, supplement_ids, owner) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
            )
            .bind(assay_id)
            .bind(sample.row)
            .bind(sample.col)
            .bind(media_id)
            .bind(strain_id)
            .bind(vector_id)
            .bind(supplement_ids_json)
            .execute(&mut *tx)
            .await
            .map_err(err)?
            .last_insert_rowid();
            sample_ids.push(sample_id);
        }

        let mut measurement_count: i64 = 0;
        for measurement in &input.measurements {
            let sample_id = *sample_ids.get(measurement.sample_index).ok_or_else(|| {
                format!(
                    "measurement references sample index {} but only {} samples were provided",
                    measurement.sample_index,
                    sample_ids.len()
                )
            })?;
            let signal_id = *signal_ids.get(&measurement.signal).ok_or_else(|| {
                format!(
                    "measurement references unknown signal {}",
                    measurement.signal
                )
            })?;
            sqlx::query(
                "INSERT INTO measurement (sample_id, signal_id, value, time, owner) \
                 VALUES (?, ?, ?, ?, NULL)",
            )
            .bind(sample_id)
            .bind(signal_id)
            .bind(measurement.value)
            .bind(measurement.time)
            .execute(&mut *tx)
            .await
            .map_err(err)?;
            measurement_count += 1;
        }

        tx.commit().await.map_err(err)?;

        Ok(ImportStudyReportDto {
            study_id,
            assay_id,
            sample_count: sample_ids.len() as i64,
            measurement_count,
            signal_count: signal_ids.len() as i64,
        })
    }

    /// Persist a characterization run and its result rows in one transaction.
    pub async fn save_characterization(
        &self,
        input: SaveCharacterizationInput,
    ) -> Result<CharacterizationDto, String> {
        let spec = serde_json::to_string(&input.spec).map_err(err)?;
        let mut tx = self.pool.begin().await.map_err(err)?;
        let id = sqlx::query(
            "INSERT INTO characterization (analysis_type, spec, params_hash, name, owner) \
             VALUES (?, ?, ?, ?, NULL)",
        )
        .bind(&input.analysis_type)
        .bind(&spec)
        .bind(&input.params_hash)
        .bind(&input.name)
        .execute(&mut *tx)
        .await
        .map_err(err)?
        .last_insert_rowid();

        for datum in &input.data {
            sqlx::query(
                "INSERT INTO characterizationdatum \
                 (characterization_id, sample_id, signal_id, metric, value, time, \
                  concentration, concentration2, owner) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
            )
            .bind(id)
            .bind(datum.sample_id)
            .bind(datum.signal_id)
            .bind(&datum.metric)
            .bind(datum.value)
            .bind(datum.time)
            .bind(datum.concentration)
            .bind(datum.concentration2)
            .execute(&mut *tx)
            .await
            .map_err(err)?;
        }
        tx.commit().await.map_err(err)?;

        Ok(CharacterizationDto {
            id,
            analysis_type: input.analysis_type,
            name: input.name,
            params_hash: input.params_hash,
            spec: input.spec,
        })
    }

    // -----------------------------------------------------------------------
    // SQL console (read-only pool)
    // -----------------------------------------------------------------------

    pub async fn sql_execute(&self, query: String) -> Result<SqlResultDto, String> {
        let started = Instant::now();
        let fetch = sqlx::query(&query).fetch_all(&self.ro_pool);
        let rows = tokio::time::timeout(SQL_TIMEOUT, fetch)
            .await
            .map_err(|_| "query timed out".to_string())?
            .map_err(err)?;

        let mut columns: Vec<SqlColumnDto> = Vec::new();
        if let Some(first) = rows.first() {
            for col in first.columns() {
                columns.push(SqlColumnDto {
                    name: col.name().to_string(),
                    column_type: col.type_info().name().to_string(),
                });
            }
        }

        let truncated = rows.len() > SQL_MAX_ROWS;
        let mut out_rows: Vec<Vec<Value>> = Vec::with_capacity(rows.len().min(SQL_MAX_ROWS));
        for row in rows.iter().take(SQL_MAX_ROWS) {
            let mut out = Vec::with_capacity(columns.len());
            for i in 0..columns.len() {
                out.push(value_to_json(row, i));
            }
            out_rows.push(out);
        }

        Ok(SqlResultDto {
            columns,
            row_count: out_rows.len() as u64,
            truncated,
            rows: out_rows,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }

    pub async fn sql_validate(&self, query: String) -> Result<(), String> {
        if query.trim().is_empty() {
            return Ok(());
        }
        let mut conn = self.ro_pool.acquire().await.map_err(err)?;
        (*conn).prepare(&query).await.map(|_| ()).map_err(err)
    }

    pub async fn schema(&self) -> Result<SchemaDto, String> {
        let table_rows = sqlx::query(
            "SELECT name FROM sqlite_master WHERE type = 'table' \
             AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(err)?;

        let mut tables = Vec::with_capacity(table_rows.len());
        for table_row in table_rows {
            let name: String = table_row.try_get("name").map_err(err)?;
            let column_rows = sqlx::query(&format!("PRAGMA table_info('{name}')"))
                .fetch_all(&self.pool)
                .await
                .map_err(err)?;
            let columns = column_rows
                .iter()
                .map(|c| {
                    let col_name: String = c.try_get("name").unwrap_or_default();
                    let col_type: String = c.try_get("type").unwrap_or_default();
                    let notnull: i64 = c.try_get("notnull").unwrap_or(0);
                    SchemaColumnDto {
                        name: col_name,
                        column_type: col_type,
                        nullable: notnull == 0,
                    }
                })
                .collect();
            tables.push(SchemaTableDto { name, columns });
        }
        Ok(SchemaDto { tables })
    }
}

/// A flat sample row before its supplements are resolved.
#[derive(sqlx::FromRow)]
struct SampleRow {
    id: i64,
    assay_id: i64,
    row: i64,
    col: i64,
    media: Option<String>,
    strain: Option<String>,
    vector: Option<String>,
    supplement_ids: Option<String>,
}

fn characterization_from_row(row: SqliteRow) -> Result<CharacterizationDto, String> {
    let spec_text: String = row.try_get("spec").map_err(err)?;
    let spec: Value = serde_json::from_str(&spec_text).unwrap_or(Value::Null);
    Ok(CharacterizationDto {
        id: row.try_get("id").map_err(err)?,
        analysis_type: row.try_get("analysis_type").map_err(err)?,
        name: row.try_get("name").map_err(err)?,
        params_hash: row.try_get("params_hash").map_err(err)?,
        spec,
    })
}

/// Decode a single SQLite cell into JSON, trying integer, then float, then
/// text; blobs are surfaced as a size marker (the Flapjack schema has none).
fn value_to_json(row: &SqliteRow, i: usize) -> Value {
    use sqlx::ValueRef;
    if let Ok(raw) = row.try_get_raw(i) {
        if raw.is_null() {
            return Value::Null;
        }
    }
    if let Ok(v) = row.try_get::<i64, _>(i) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<f64, _>(i) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<String, _>(i) {
        return json!(v);
    }
    if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
        return Value::String(format!("<{} bytes>", v.len()));
    }
    Value::Null
}

/// Look up an entity by name (single-tenant, `owner IS NULL`); insert it with
/// `insert_sql` (a single `?` bound to the name) if absent. Returns its id.
async fn upsert_by_name(
    conn: &mut SqliteConnection,
    table: &str,
    insert_sql: &str,
    name: &str,
) -> Result<i64, String> {
    let select = format!("SELECT id FROM {table} WHERE name = ? AND owner IS NULL LIMIT 1");
    if let Some(id) = sqlx::query_scalar::<_, i64>(&select)
        .bind(name)
        .fetch_optional(&mut *conn)
        .await
        .map_err(err)?
    {
        return Ok(id);
    }
    Ok(sqlx::query(insert_sql)
        .bind(name)
        .execute(&mut *conn)
        .await
        .map_err(err)?
        .last_insert_rowid())
}

async fn upsert_signal(conn: &mut SqliteConnection, signal: &SignalInput) -> Result<i64, String> {
    if let Some(id) = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM signal WHERE name = ? AND owner IS NULL LIMIT 1",
    )
    .bind(&signal.name)
    .fetch_optional(&mut *conn)
    .await
    .map_err(err)?
    {
        return Ok(id);
    }
    Ok(sqlx::query(
        "INSERT INTO signal (name, description, color, kind, owner) VALUES (?, ?, ?, ?, NULL)",
    )
    .bind(&signal.name)
    .bind(&signal.description)
    .bind(&signal.color)
    .bind(&signal.kind)
    .execute(&mut *conn)
    .await
    .map_err(err)?
    .last_insert_rowid())
}

async fn upsert_supplement(
    conn: &mut SqliteConnection,
    name: &str,
    chemical_id: i64,
    concentration: f64,
) -> Result<i64, String> {
    if let Some(id) = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM supplement WHERE chemical_id = ? AND concentration = ? \
         AND owner IS NULL LIMIT 1",
    )
    .bind(chemical_id)
    .bind(concentration)
    .fetch_optional(&mut *conn)
    .await
    .map_err(err)?
    {
        return Ok(id);
    }
    Ok(sqlx::query(
        "INSERT INTO supplement (name, chemical_id, concentration, owner) VALUES (?, ?, ?, NULL)",
    )
    .bind(name)
    .bind(chemical_id)
    .bind(concentration)
    .execute(&mut *conn)
    .await
    .map_err(err)?
    .last_insert_rowid())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flapjack::dto::{
        AssayInput, MeasurementInput, SampleInput, SignalInput, StudyInput, SupplementInput,
    };

    async fn open_temp() -> (tempfile::TempDir, FlapjackStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = FlapjackStore::open(&dir.path().join("flapjack.sqlite3"))
            .await
            .expect("open");
        (dir, store)
    }

    fn sample_manifest() -> ImportStudyInput {
        ImportStudyInput {
            study: StudyInput {
                name: "degradation tags".into(),
                description: "test".into(),
            },
            assay: AssayInput {
                name: "kinetic".into(),
                machine: "Clariostar".into(),
                description: String::new(),
                temperature: 37.0,
            },
            signals: vec![
                SignalInput {
                    name: "GFP".into(),
                    kind: Some("fluorescence".into()),
                    color: String::new(),
                    description: String::new(),
                },
                SignalInput {
                    name: "OD".into(),
                    kind: Some("biomass".into()),
                    color: String::new(),
                    description: String::new(),
                },
            ],
            samples: vec![
                SampleInput {
                    row: 0,
                    col: 0,
                    media: Some("M9".into()),
                    strain: Some("E. coli".into()),
                    vector: Some("pTet-GFP".into()),
                    supplements: vec![SupplementInput {
                        chemical: "aTc".into(),
                        concentration: 0.0,
                    }],
                },
                SampleInput {
                    row: 0,
                    col: 1,
                    media: Some("M9".into()),
                    strain: Some("E. coli".into()),
                    vector: Some("pTet-GFP".into()),
                    supplements: vec![SupplementInput {
                        chemical: "aTc".into(),
                        concentration: 10.0,
                    }],
                },
            ],
            measurements: vec![
                MeasurementInput {
                    sample_index: 0,
                    signal: "GFP".into(),
                    value: 100.0,
                    time: 0.0,
                },
                MeasurementInput {
                    sample_index: 1,
                    signal: "GFP".into(),
                    value: 523.0,
                    time: 2.0,
                },
            ],
        }
    }

    #[tokio::test]
    async fn open_creates_schema() {
        let (_dir, store) = open_temp().await;
        let schema = store.schema().await.unwrap();
        assert!(schema.tables.iter().any(|t| t.name == "measurement"));
        assert!(schema
            .tables
            .iter()
            .any(|t| t.name == "characterizationdatum"));
        let counts = store.counts().await.unwrap();
        assert_eq!(counts.studies, 0);
        assert_eq!(counts.measurements, 0);
    }

    #[tokio::test]
    async fn import_and_query() {
        let (_dir, store) = open_temp().await;
        let report = store.import_study(sample_manifest()).await.unwrap();
        assert_eq!(report.sample_count, 2);
        assert_eq!(report.measurement_count, 2);
        assert_eq!(report.signal_count, 2);

        let counts = store.counts().await.unwrap();
        assert_eq!(counts.studies, 1);
        assert_eq!(counts.samples, 2);
        assert_eq!(counts.measurements, 2);

        // Registry dedup: the shared media/strain/vector collapse to one row each.
        let detail = store.study_detail(report.study_id).await.unwrap();
        assert_eq!(detail.assays.len(), 1);
        assert_eq!(detail.assays[0].sample_count, 2);

        let samples = store.samples(report.assay_id).await.unwrap();
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].media.as_deref(), Some("M9"));
        assert_eq!(samples[1].supplements[0].chemical, "aTc");
        assert_eq!(samples[1].supplements[0].concentration, 10.0);

        let measurements = store
            .measurements(Some(report.study_id), None, None, None, None)
            .await
            .unwrap();
        assert_eq!(measurements.len(), 2);
        assert_eq!(measurements[0].signal, "GFP");
    }

    #[tokio::test]
    async fn sql_console_reads_but_cannot_write() {
        let (_dir, store) = open_temp().await;
        store.import_study(sample_manifest()).await.unwrap();

        let result = store
            .sql_execute("SELECT count(*) AS n FROM measurement".into())
            .await
            .unwrap();
        assert_eq!(result.row_count, 1);
        assert_eq!(result.rows[0][0], json!(2));

        // Writes through the read-only console are refused at the connection level.
        assert!(store
            .sql_execute("CREATE TABLE scratch (x INTEGER)".into())
            .await
            .is_err());
    }
}
