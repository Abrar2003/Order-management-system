const path = require('node:path');
const mongoose = require('mongoose');

mongoose.set('autoIndex', false);

const { loadEnvFiles } = require('../config/loadEnv');
const connectDB = require('../config/connectDB');
const Inspector = require('../models/inspector.model');
const {
  buildMigrationAnalysis,
  loadSnapshot,
} = require('./migrateLabels');

const classifyInspector = (analysis = {}) => {
  const blocking = Number(analysis.summary?.blocking_conflict_count ??
    (analysis.conflicts || []).filter((entry) => entry.severity === 'error').length);
  const warnings = Number(analysis.summary?.warning_count ??
    (analysis.conflicts || []).filter((entry) => entry.severity === 'warning').length);
  if (blocking > 0) return 'BLOCKED_CURRENT_STATE';
  if (warnings > 0) return 'REPRESENTABLE_ANOMALIES';
  return 'CLEAN';
};

const buildInventoryReport = (rows = []) => {
  const inspectors = Array.isArray(rows) ? rows : [];
  const conflictsByType = {};
  const serials = new Set();
  const blockingSerials = new Set();
  let totalHistoricalWarnings = 0;
  inspectors.forEach((row) => {
    const analysis = row.analysis || {};
    (analysis.expected?.labels || []).forEach((entry) => serials.add(Number(entry.number)));
    (analysis.conflicts || []).forEach((conflict) => {
      const type = String(conflict.conflict_type || 'unknown');
      conflictsByType[type] = (conflictsByType[type] || 0) + 1;
      if (conflict.severity === 'warning') totalHistoricalWarnings += 1;
      const number = Number(conflict.label_number);
      if (conflict.severity === 'error' && Number.isInteger(number) && number > 0) {
        blockingSerials.add(number);
      }
    });
  });
  const counts = inspectors.reduce(
    (result, row) => {
      const classification = row.classification || classifyInspector(row.analysis);
      if (classification === 'CLEAN') result.clean += 1;
      if (classification === 'REPRESENTABLE_ANOMALIES') result.warning_only += 1;
      if (classification === 'BLOCKED_CURRENT_STATE') result.blocked += 1;
      return result;
    },
    { clean: 0, warning_only: 0, blocked: 0 },
  );
  return {
    inspectors,
    totals: {
      total_inspectors: inspectors.length,
      clean_inspectors: counts.clean,
      warning_only_inspectors: counts.warning_only,
      blocked_inspectors: counts.blocked,
      total_unique_serials: serials.size,
      total_blocking_serials: blockingSerials.size,
      total_historical_warnings: totalHistoricalWarnings,
      conflicts_by_type: Object.fromEntries(
        Object.entries(conflictsByType).sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
  };
};

const main = async () => {
  loadEnvFiles({ cwd: path.resolve(__dirname, '..'), preserveExistingEnv: true });
  await connectDB();
  const inspectorRows = await Inspector.find({}).select('_id').sort({ _id: 1 }).lean();
  const rows = [];
  for (const inspector of inspectorRows) {
    try {
      const snapshot = await loadSnapshot(inspector._id);
      const analysis = buildMigrationAnalysis(snapshot);
      rows.push({
        inspector: {
          document_id: analysis.inspector_id,
          user_id: analysis.inspector_user_id,
        },
        allocated_count: analysis.summary.allocated_count,
        forensic_used_count: analysis.summary.forensic_used_count,
        rejected_count: analysis.summary.rejected_count,
        usage_records: analysis.summary.usage_record_count,
        transaction_count: analysis.summary.transaction_count,
        warning_count: analysis.summary.warning_count,
        blocking_conflict_count: analysis.summary.blocking_conflict_count,
        migration_status: String(snapshot.storageState?.migration_status || 'legacy'),
        classification: classifyInspector(analysis),
        analysis,
      });
    } catch (error) {
      rows.push({
        inspector: { document_id: String(inspector._id) },
        classification: 'BLOCKED_CURRENT_STATE',
        error: error?.message || String(error),
      });
    }
  }
  const report = buildInventoryReport(rows);
  report.inspectors = report.inspectors.map(({ analysis, ...row }) => ({
    ...row,
    conflicts: (analysis?.conflicts || []).slice(0, 100),
    conflict_output_truncated: (analysis?.conflicts || []).length > 100,
  }));
  report.read_only = true;
  console.log(JSON.stringify(report, null, 2));
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('QC label migration audit failed:', error?.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.connection.close(false).catch(() => {});
    });
}

module.exports = { buildInventoryReport, classifyInspector };
