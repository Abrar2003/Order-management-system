const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const { buildAuditActor } = require("../helpers/permissions");
const TaskType = require("../models/workflow/TaskType.model");

const systemActor = buildAuditActor({
  name: "seedWorkflowTaskTypes",
  role: "system",
});

const DEFAULT_TASK_TYPES = [
  {
    key: "picture_cleaning",
    name: "Picture Cleaning",
    category: "image",
    auto_create_mode: "per_file",
    file_match_rule: {
      extensions: ["jpg", "jpeg", "png", "webp"],
    },
    requires_review: true,
  },
  {
    key: "pis_creation",
    name: "PIS Creation",
    category: "pis",
    auto_create_mode: "once_per_batch",
    requires_review: true,
  },
  {
    key: "autocad_creation",
    name: "AutoCAD Creation",
    category: "cad",
    auto_create_mode: "once_per_batch",
    file_match_rule: {
      extensions: ["dwg", "dxf"],
    },
    requires_review: true,
  },
  {
    key: "three_d_creation",
    name: "3D Creation",
    category: "three_d",
    auto_create_mode: "per_direct_subfolder",
    requires_review: true,
  },
  {
    key: "flat_carton_design",
    name: "Flat Carton Design",
    category: "carton",
    auto_create_mode: "once_per_batch",
    requires_review: true,
  },
  {
    key: "ean_sticker_creation",
    name: "EAN Sticker Creation",
    category: "sticker",
    auto_create_mode: "once_per_batch",
    requires_review: true,
  },
];

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
    preserveExistingEnv: true,
  });

  await connectDB();

  const results = {
    created: 0,
    updated: 0,
  };

  for (const taskType of DEFAULT_TASK_TYPES) {
    const existing = await TaskType.findOne({ key: taskType.key }).lean();
    const nextPayload = {
      ...taskType,
      description: taskType.description || "",
      default_assignees: [],
      default_priority: "normal",
      estimated_minutes: 0,
      is_active: true,
      updated_by: systemActor,
    };

    const update = existing
      ? {
          $set: nextPayload,
        }
      : {
          $set: nextPayload,
          $setOnInsert: {
            created_by: systemActor,
          },
        };

    await TaskType.findOneAndUpdate(
      { key: taskType.key },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (existing) {
      results.updated += 1;
      console.log(`[update] ${taskType.key}`);
    } else {
      results.created += 1;
      console.log(`[create] ${taskType.key}`);
    }
  }

  console.log("Workflow task type seed complete:", results);
};

main()
  .catch((error) => {
    console.error("Workflow task type seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });
